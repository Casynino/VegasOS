import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { orderItemName } from "@/i18n/content";
import type { T } from "@/i18n/translate";
import { ONLINE_RECORDER_ID } from "@/server/services/online-recorder";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Armchair, ArrowLeft, ArrowRightLeft, BedDouble, Check, ChefHat, CircleCheck, Clock, Flame, HandPlatter, Package, Plus, Printer, Receipt, ShoppingBag, UserRoundCheck, UserRoundSearch, UserRoundX, UtensilsCrossed, Wallet, X } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { inHouseGuestIds, isHotelOrder, portalAccess } from "../../portal/data";
import { db } from "@/server/db";
import { deliveryPlace, orderHistory, ORDER_SOURCE, STATUS_LABEL, TYPE_LABEL } from "@/server/services/restaurant";
import { sessionNo } from "@/server/services/dining-core";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Order history") };
}
export const dynamic = "force-dynamic";

const TZ = "Africa/Dar_es_Salaam";
const time = (t: T, d: Date) => d.toLocaleTimeString(t.intl, { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const day = (t: T, d: Date) => d.toLocaleDateString(t.intl, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: TZ });
const gap = (t: T, a: Date | null, b: Date | null) => (a && b ? t("{n} min", { n: Math.max(0, Math.round((b.getTime() - a.getTime()) / 60000)) }) : "—");
const STEP: Record<string, { text: string; icon: typeof Check; tone: string }> = {
  PENDING: { text: msg("Order created"), icon: Receipt, tone: "bg-sky-500" },
  ACCEPTED: { text: msg("Accepted"), icon: ChefHat, tone: "bg-sky-500" },
  PREPARING: { text: msg("Started preparing"), icon: Flame, tone: "bg-amber-500" },
  READY: { text: msg("Marked ready"), icon: Check, tone: "bg-emerald-500" },
  OUT_FOR_DELIVERY: { text: msg("Started serving"), icon: HandPlatter, tone: "bg-violet-500" },
  DELIVERED: { text: msg("Served"), icon: CircleCheck, tone: "bg-violet-500" },
  COMPLETED: { text: msg("Completed"), icon: CircleCheck, tone: "bg-slate-500" },
  COLLECTED: { text: msg("Collected"), icon: CircleCheck, tone: "bg-slate-500" },
  CANCELLED: { text: msg("Cancelled"), icon: X, tone: "bg-rose-500" },
};
/** A sale's kind, as words ("room service"). */
const SALE_KIND: Record<string, string> = { RESTAURANT: msg("restaurant"), BAR: msg("bar"), OTHER: msg("other"), ROOM_SERVICE: msg("room service"), TRANSPORT: msg("transport") };
const first = (n: string | null | undefined) => n?.replace(/\s*\(.*\)/, "").split(" ")[0] ?? null;

/** One change of who serves the order, in words: a waiter started serving it, a transfer, the manager's choice… */
function assignmentLine(t: T, a: { kind: string; via: string; reason: string | null; fromUser: { fullName: string } | null; toUser: { fullName: string } | null }) {
  const from = first(a.fromUser?.fullName), to = first(a.toUser?.fullName);
  const why = a.reason ? ` — ${a.reason}` : "";
  const closed = a.via === "SHIFT_CLOSE" && !/shift closed/i.test(a.reason ?? "") ? ` ${t("(shift closed)")}` : "";
  if (a.kind === "TAKEN") return { text: a.via === "PIN" ? t("{name} is serving it (ID on the restaurant screen)", { name: to ?? t("A waiter") }) : t("{name} is serving it", { name: to ?? t("A waiter") }), icon: UserRoundCheck, tone: "bg-emerald-600" };
  if (a.kind === "TRANSFER") return { text: `${t("Transferred {from} → {to}", { from: from ?? "—", to: to ?? "—" })}${why}${closed}`, icon: ArrowRightLeft, tone: "bg-sky-500" };
  if (a.kind === "ROUTED") return { text: a.via === "ROOM" ? t("Went to {name} — the room's waiter", { name: to ?? "—" }) : t("Went to {name} — the table's waiter", { name: to ?? "—" }), icon: a.via === "ROOM" ? BedDouble : Armchair, tone: "bg-violet-500" };
  if (a.kind === "RELEASED" || !to) return { text: `${from ? t("{name} is no longer serving", { name: from }) : t("The waiter is no longer serving")}${why}${closed}`, icon: UserRoundX, tone: "bg-slate-500" };
  return { text: `${from ? t("The manager moved it from {from} to {to}", { from, to }) : t("The manager gave it to {name}", { name: to })}${why}${closed}`, icon: ArrowRightLeft, tone: "bg-amber-500" };
}

/** An order's full story: what was ordered, how it is paid, and every step with who (and their role) and when. */
export default async function OrderHistoryPage({ params }: PageProps<"/staff/restaurant/orders/[id]">) {
  const user = await requirePagePermission("restaurant.orders", "kitchen.orders", "restaurant.menu");
  const t = await getT();
  const o = await orderHistory((await params).id);
  // Reception opens the hotel's own orders only.
  if (!o || (portalAccess(user).role === "desk" && !isHotelOrder(o, await inHouseGuestIds()))) notFound();
  const money = can(user, "restaurant.orders") || can(user, "restaurant.menu");
  const food = o.items.filter((i) => i.type !== "DRINK"), drinks = o.items.filter((i) => i.type === "DRINK");
  const customer = o.customerName ?? o.reservation?.guest.fullName ?? t("Walk-in customer");
  // The table it belongs to ("Outside 3 · Session #12"), and where its bill is.
  const [session, waiters] = await Promise.all([
    o.sessionId ? db.diningSession.findUnique({ where: { id: o.sessionId }, select: { number: true } }) : null,
    // Who served it — every change kept (taken in charge, transferred, handed by the manager).
    db.waiterAssignment.findMany({
      where: { orderId: o.id }, orderBy: { at: "asc" },
      select: { id: true, kind: true, via: true, reason: true, byLabel: true, byRole: true, at: true, fromUser: { select: { fullName: true } }, toUser: { select: { fullName: true } } },
    }),
  ]);
  const table = o.type === "DINE_IN" && (o.location?.name ?? o.tableLabel) ? [t(o.location?.name ?? o.tableLabel ?? ""), session ? t("Session {no}", { no: sessionNo(session.number) }) : null].filter(Boolean).join(" · ") : null;
  const billing = o.status === "CANCELLED" ? t("Nothing to pay (cancelled)")
    : o.settlement === "ROOM" ? (o.roomNumber ? t("On Room {room}'s bill", { room: o.roomNumber }) : t("On a room bill"))
    : o.paymentStatus === "PAID" ? t("Paid at the restaurant")
    : o.paymentStatus === "PENDING_CONFIRMATION" ? t("Paid — waiting for reception")
    : t("To pay · {amount}", { amount: formatTZS(Math.max(0, o.total - o.paidAmount)) });

  return (
    <div className="mx-auto w-full max-w-5xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Link href="/staff/restaurant" className={buttonVariants({ variant: "ghost", size: "sm" })}><ArrowLeft />{t("Restaurant")}</Link>
        {o.status !== "CANCELLED" && <Link href={`/staff/restaurant-bill?order=${o.id}`} className={buttonVariants({ size: "sm" })}><Printer />{["COMPLETED", "COLLECTED"].includes(o.status) ? t("Print / download receipt") : t("Print / download bill")}</Link>}
      </div>

      <section className="overflow-hidden rounded-3xl border border-white/10 bg-linear-to-r from-[#2a1d10] via-[#1c1610] to-[#141a24] p-5 text-white sm:p-6">
        <p className="font-mono text-xs text-white/60">{t("ORDER #{no} · {number}", { no: o.number.replace(/^ORD-\d{4}-0*/, ""), number: o.number })}</p>
        <div className="mt-1 flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="font-display text-3xl font-semibold sm:text-4xl">{deliveryPlace(o, t)}</h1>
            <p className="text-sm text-white/70">
              {o.guestId && can(user, "guests.view") ? <Link href={`/staff/guests/${o.guestId}`} className="font-medium text-white hover:underline">{customer}</Link> : customer} · {o.type === "ROOM_SERVICE" ? t("Room service") : `${t("Restaurant")} · ${t(TYPE_LABEL[o.type])}`} · {t("from {source}", { source: t(ORDER_SOURCE[o.source] ?? o.source) })}
            </p>
            {(table || money) && (
              <p className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-sm">
                {table && <span className="inline-flex items-center gap-1.5"><UtensilsCrossed className="size-3.5 text-white/55" /><span className="text-white/55">{t("Table:")}</span>{table}</span>}
                {money && <span className="inline-flex items-center gap-1.5">{o.settlement === "ROOM" ? <BedDouble className="size-3.5 text-white/55" /> : <Wallet className="size-3.5 text-white/55" />}<span className="text-white/55">{t("Billing:")}</span>{billing}</span>}
              </p>
            )}
          </div>
          <span className={cn("rounded-full px-3 py-1 text-sm font-bold", o.status === "CANCELLED" ? "bg-rose-500/25 text-rose-100" : ["COMPLETED", "COLLECTED"].includes(o.status) ? "bg-white/15" : "bg-amber-400 text-[#1a1206]")}>{t(STATUS_LABEL[o.status])}</span>
        </div>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm sm:grid-cols-4">
          {[[t("Created"), `${time(t, o.createdAt)} · ${day(t, o.createdAt)}`], [t("Waited to accept"), gap(t, o.createdAt, o.acceptedAt)], [t("Preparation"), gap(t, o.acceptedAt, o.readyAt)], [t("Serving"), gap(t, o.readyAt, o.deliveredAt)]].map(([k, v]) => (
            <div key={k} className="rounded-2xl bg-white/[0.07] px-3 py-2 ring-1 ring-white/10"><p className="text-[11px] text-white/55">{k}</p><p className="font-semibold">{v}</p></div>
          ))}
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
        <div className="space-y-5">
          <section className="rounded-3xl border border-border/70 bg-card p-5">
            <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground"><UtensilsCrossed className="size-4" />{t("What was ordered")}</h2>
            {[[t("Food"), food], [t("Drinks"), drinks]].filter(([, xs]) => (xs as typeof food).length).map(([title, xs]) => (
              <div key={title as string} className="mt-3">
                <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{title as string}</p>
                <ul className="mt-1 divide-y divide-border/60">
                  {(xs as typeof food).map((i) => (
                    <li key={i.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                      <span><span className="font-semibold tabular-nums">{i.quantity} ×</span> {orderItemName(i, t)}{i.preparedAt && <span className="ml-2 text-[11px] text-emerald-600 dark:text-emerald-400">{t("done {time}", { time: time(t, i.preparedAt) })}</span>}</span>
                      {money && <span className="shrink-0 tabular-nums text-muted-foreground">{formatTZS(i.lineTotal)}</span>}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
            {o.notes && <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-800 dark:text-amber-200">“{o.notes}”</p>}
            {money && (
              <dl className="mt-3 space-y-1 border-t border-dashed border-border pt-3 text-sm">
                {o.foodSubtotal > 0 && <div className="flex justify-between text-muted-foreground"><dt>{t("Food")}</dt><dd className="tabular-nums">{formatTZS(o.foodSubtotal)}</dd></div>}
                {o.drinksSubtotal > 0 && <div className="flex justify-between text-muted-foreground"><dt>{t("Drinks")}</dt><dd className="tabular-nums">{formatTZS(o.drinksSubtotal)}</dd></div>}
                {o.serviceFee > 0 && <div className="flex justify-between text-muted-foreground"><dt>{t("Room service")}</dt><dd className="tabular-nums">{formatTZS(o.serviceFee)}</dd></div>}
                <div className="flex justify-between text-base font-semibold"><dt>{t("Total")}</dt><dd className="tabular-nums">{formatTZS(o.total)}</dd></div>
                <p className="text-[11px] text-muted-foreground">{t("Prices as they were when the order was placed.")}</p>
              </dl>
            )}
          </section>

          {money && (
            <section className="rounded-3xl border border-border/70 bg-card p-5">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground"><Wallet className="size-4" />{t("Payment")}</h2>
              <p className={cn("mt-3 flex items-center gap-2 rounded-xl px-3 py-2 text-sm font-medium",
                o.settlement === "ROOM" ? "bg-violet-500/10 text-violet-800 dark:text-violet-200" : o.paymentStatus === "PAID" ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200" : o.paymentStatus === "PENDING_CONFIRMATION" ? "bg-amber-500/10 text-amber-800 dark:text-amber-200" : "bg-rose-500/10 text-rose-800 dark:text-rose-200")}>
                {o.settlement === "ROOM" ? <BedDouble className="size-4" /> : <Wallet className="size-4" />}
                {o.settlement === "ROOM" ? t("On Room {room}'s bill — paid at check-out", { room: o.roomNumber ?? "" })
                  : o.paymentStatus === "PAID" ? t("Paid {amount}", { amount: formatTZS(o.paidAmount) })
                  : o.paymentStatus === "PENDING_CONFIRMATION" ? t("Paid {amount} — waiting for reception to confirm", { amount: formatTZS(o.paidAmount) })
                  : o.paymentStatus === "PARTIALLY_PAID" ? t("Part-paid · {paid} paid · {due} due", { paid: formatTZS(o.paidAmount), due: formatTZS(o.total - o.paidAmount) })
                  : o.paymentStatus === "REFUNDED" ? t("Paid, then reversed / refunded") : o.status === "CANCELLED" ? t("Not paid (cancelled)") : t("Not paid yet")}
              </p>
              {o.payments.length > 0 && (
                <ul className="mt-3 space-y-2">
                  {o.payments.map((p) => p.account.code === "NTZS" ? (
                    // Paid by mobile money from a phone: "Paid · TZS 1,000", how and when — nothing technical (owner, 2026-10-05).
                    <li key={p.id} className={cn("rounded-xl border border-border/70 px-3 py-2 text-xs", p.status !== "POSTED" && "opacity-70")}>
                      <p className={cn("flex justify-between gap-2 text-sm font-semibold", p.status !== "POSTED" && "line-through")}><span>{p.status !== "POSTED" ? t("Reversed") : t("Paid")}</span><span className="tabular-nums">{formatTZS(p.amount)}</span></p>
                      <p className="text-muted-foreground">{t("Mobile money")}{p.collectedBy && p.collectedById !== ONLINE_RECORDER_ID ? ` · ${t("sent by {name}", { name: p.collectedBy.fullName.replace(/\s*\(.*\)/, "") })}` : ` · ${t("from the customer's phone")}`} · {time(t, p.collectedAt)} · {day(t, p.collectedAt)}</p>
                      {p.status !== "POSTED" && <p className="text-rose-600 dark:text-rose-300">{p.reverseReason ?? t("Reversed")}</p>}
                    </li>
                  ) : (
                    <li key={p.id} className={cn("rounded-xl border border-border/70 px-3 py-2 text-xs", p.status !== "POSTED" && "opacity-70")}>
                      <p className={cn("flex justify-between gap-2 text-sm font-semibold", p.status !== "POSTED" && "line-through")}><span>{t(p.account.name)}{p.reference ? ` · ${t("ref {reference}", { reference: p.reference })}` : ""}</span><span className="tabular-nums">{formatTZS(p.amount)}</span></p>
                      <p className="text-muted-foreground">{p.atCounter
                        ? <>{t("Recorded at the Restaurant Counter")}{p.handedOverBy ? ` · ${t("brought by {name}", { name: p.handedOverBy.fullName.replace(/\s*\(.*\)/, "") })}` : ""}</>
                        : <>{t("Collected by {name}", { name: p.collectedBy?.fullName.replace(/\s*\(.*\)/, "") ?? "—" })}{p.collectedByRole ? ` (${t(p.collectedByRole)})` : ""}</>} · {time(t, p.collectedAt)} · {day(t, p.collectedAt)}</p>
                      <p className={p.status !== "POSTED" ? "text-rose-600 dark:text-rose-300" : p.confirmedAt ? "text-emerald-700 dark:text-emerald-300" : "text-amber-700 dark:text-amber-300"}>
                        {p.status !== "POSTED" ? `${p.reverseReason ?? t("Reversed")}${p.reversedBy ? ` — ${p.reversedBy.fullName.replace(/\s*\(.*\)/, "")}` : ""}`
                          : p.confirmedAt ? `${p.confirmedBy ? `${t("Confirmed by {name}", { name: p.confirmedBy.fullName.replace(/\s*\(.*\)/, "") })}${p.confirmedByRole ? ` (${t(p.confirmedByRole)})` : ""}` : p.online ? t("Paid online — recorded automatically") : t("Confirmed")} · ${time(t, p.confirmedAt)}` : t("Waiting to be confirmed")}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
              {o.reservation && <Link href={`/staff/reservations/${o.reservation.id}`} className="mt-2 inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"><Package className="size-4" />{o.reservation.reference} · {t("the guest's bill")}</Link>}
              {o.sales.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {o.sales.map((s) => <li key={s.id} className={cn("flex justify-between gap-2", s.isVoided && "line-through")}><span>{t(SALE_KIND[s.kind] ?? s.kind.toLowerCase().replace("_", " "))} · {t(s.account.name)} · {s.recordedBy.fullName.replace(/\s*\(.*\)/, "")}</span><span className="tabular-nums">{formatTZS(s.amount)}</span></li>)}
                </ul>
              )}
              {o.charges.length > 0 && (
                <ul className="mt-3 space-y-1 text-xs text-muted-foreground">
                  {o.charges.map((c) => <li key={c.id} className={cn("flex justify-between gap-2", c.isVoided && "line-through")}><span className="truncate">{c.description}</span><span className="shrink-0 tabular-nums">{formatTZS(c.amount)}</span></li>)}
                </ul>
              )}
            </section>
          )}

          <section className="rounded-3xl border border-border/70 bg-card p-5">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground"><HandPlatter className="size-4" />{t("Waiters")}</h2>
              {!["COMPLETED", "COLLECTED", "CANCELLED"].includes(o.status) && (o.assignedTo
                ? <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 px-2.5 py-0.5 text-xs font-semibold text-emerald-700 dark:text-emerald-300"><UserRoundCheck className="size-3.5" />{t("Waiter · {name}", { name: first(o.assignedTo.fullName) })}</span>
                : <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 px-2.5 py-0.5 text-xs font-semibold text-amber-700 dark:text-amber-300"><UserRoundSearch className="size-3.5" />{t("No waiter yet")}</span>)}
            </div>
            {waiters.length === 0 ? <p className="mt-3 text-sm text-muted-foreground">{o.assignedTo ? t("{name} is serving it.", { name: first(o.assignedTo.fullName) }) : t("No waiter on this order.")}</p> : (
              <ol className="mt-3 space-y-2.5">
                {waiters.map((a) => {
                  const line = assignmentLine(t, a);
                  return (
                    <li key={a.id} className="flex gap-2.5">
                      <span className={cn("mt-0.5 grid size-6 shrink-0 place-items-center rounded-full text-white", line.tone)}><line.icon className="size-3.5" /></span>
                      <span className="min-w-0 leading-tight">
                        <span className="block text-sm font-medium">{line.text}</span>
                        <span className="block text-xs text-muted-foreground">
                          {time(t, a.at)} · {day(t, a.at)}{!["TAKEN", "ROUTED"].includes(a.kind) && a.byLabel ? ` · ${t("by {name}", { name: first(a.byLabel.split(" · ")[0]) })}${a.byRole ? ` (${t(a.byRole)})` : ""}` : ""}
                        </span>
                      </span>
                    </li>
                  );
                })}
              </ol>
            )}
          </section>
        </div>

        <section className="rounded-3xl border border-border/70 bg-card p-5">
          <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-muted-foreground"><Clock className="size-4" />{t("History")}</h2>
          <ol className="relative mt-4 space-y-4 border-l border-border pl-6">
            {o.events.map((e) => {
              const same = e.from === e.to;
              const accepted = e.from === "PENDING" && e.to === "PREPARING";
              const reopened = !same && e.from && e.to === "PENDING";
              const st = accepted ? { text: t("Accepted — preparing"), icon: ChefHat, tone: "bg-amber-500" }
                : reopened ? { text: t("More items — back to the kitchen"), icon: Plus, tone: "bg-sky-500" }
                : same ? {
                  text: e.note ?? t("Updated"),
                  icon: /no longer/i.test(e.note ?? "") ? UserRoundX : /^(Transferred|Table transferred|Handed to|The manager gave|The manager moved)/.test(e.note ?? "") ? ArrowRightLeft : /in charge|is serving|^Goes to/.test(e.note ?? "") ? UserRoundCheck
                    : e.note?.startsWith("Pa") ? Wallet : e.note?.startsWith("Charged") || e.note?.startsWith("Removed from") || e.note?.startsWith("Taken off") ? BedDouble : e.note?.startsWith("Added") ? Plus : /printed|downloaded/.test(e.note ?? "") ? Printer : ShoppingBag,
                  tone: /no longer/i.test(e.note ?? "") ? "bg-slate-500" : /^(Transferred|Table transferred|Handed to|The manager gave|The manager moved)/.test(e.note ?? "") ? "bg-sky-500" : e.note?.startsWith("Payment reversed") ? "bg-rose-500" : e.note?.includes("waiting for reception") ? "bg-amber-500" : e.note?.startsWith("Added") ? "bg-sky-500" : "bg-emerald-600",
                } : { ...(STEP[e.to] ?? STEP.PENDING), text: t((STEP[e.to] ?? STEP.PENDING).text) };
              return (
                <li key={e.id} className="relative">
                  <span className={cn("absolute -left-[35px] grid size-6 place-items-center rounded-full text-white ring-4 ring-card", st.tone)}><st.icon className="size-3.5" /></span>
                  <p className="text-sm font-semibold">{st.text}{!same && e.to === "PENDING" && e.note ? ` · ${e.note}` : ""}{!same && e.to !== "PENDING" && e.note ? ` — ${e.note}` : ""}</p>
                  <p className="text-xs text-muted-foreground">
                    {time(t, e.at)} · {day(t, e.at)}{e.byLabel ? ` · ${e.byLabel.replace(/\s*\(.*\)/, "")}` : ""}{e.byRole ? ` (${t(e.byRole)})` : ""}
                    {!same && e.from && <span> · {t(STATUS_LABEL[e.from])} → {t(STATUS_LABEL[e.to])}</span>}
                  </p>
                </li>
              );
            })}
          </ol>
          {o.status === "CANCELLED" && o.cancelReason && <p className="mt-4 rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">{o.cancelledBy ? t("Cancelled by {name}: {reason}", { name: o.cancelledBy.fullName, reason: o.cancelReason }) : t("Cancelled: {reason}", { reason: o.cancelReason })}</p>}
        </section>
      </div>
    </div>
  );
}
