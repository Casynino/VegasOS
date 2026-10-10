import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight, ArrowUpRight, BedDouble, Banknote, Clock, CreditCard, Landmark, RotateCcw, Search, ShieldCheck, Smartphone, Store, Undo2, UtensilsCrossed, Wallet } from "lucide-react";
import { can, getMyOpenShift, requirePagePermission } from "@/server/auth";
import { onlineAttentionRows, onlinePayments } from "@/server/services/online-payments-admin";
import { MobileMoneyList } from "./mobile-money";
import { MobileMoneyAttention, type AttentionRow } from "../mobile-pay/attention";
import { inHouseGuestIds, isDeskUser } from "@/server/desk";
import { isRestaurantDevice, needsOwnShift } from "@/lib/permissions";
import { db } from "@/server/db";
import { businessToday, getSettings } from "@/server/settings";
import { ShiftPicker } from "@/components/staff/shift-picker";
import {
  ALL_SOURCES, collectionCounts, collectionRows, collectionTotals, collectors, NO_WAITER, onlineTotals, paidOnlineAwaitingCheckIn, SOURCE_LABEL, stillToCollect,
  type CollectionFilter, type CollectionRow, type MoneySource, type StillToCollect,
} from "@/server/services/collections";
import { waitersToAssign } from "@/server/services/restaurant";
import { formatTZS } from "@/lib/format";
import { shiftLabel } from "@/lib/shift-label";
import { ALL_TIME_FROM, PeriodPicker, readPeriod } from "@/components/staff/finance/finance-nav";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/translate";
import { AutoSelect } from "@/components/staff/finance/auto-select";
import { cn } from "@/lib/utils";
import { OnlineLine, PaymentColumns, PaymentRow, said, ToCollectLine } from "./collection-lines";

/** How far back reception and the Restaurant Counter see mobile-money requests: the last five days (owner), up to now. */
const RECENT_DAYS = 5;
const RECENT_MOBILE_MS = RECENT_DAYS * 24 * 3600_000;
function recentMobileWindow() {
  const end = new Date();
  return { start: new Date(end.getTime() - RECENT_MOBILE_MS), end };
}
export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Collections") };
}
export const dynamic = "force-dynamic";

const SRC_KEY: Record<string, MoneySource> = { restaurant: "RESTAURANT", rooms: "ROOMS", sales: "SALES" };
const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");
/** The period in words: "All time", one day, or "from – to" (as the finance bar says it), in the reader's language. */
const periodText = (t: T, p: { key?: string; from: string; to: string }) => (p.key === "all" ? t("All time") : p.from === p.to ? t.date(p.from, true) : t.dateRange(p.from, p.to));

/**
 * COLLECTIONS — the money actually collected from customers, from the payment records themselves:
 * a receptionist's room, booking and invoice payments, the restaurant payments they took and other
 * sales. Today, any day, month or year back — or one shift. Each person sees only their own;
 * managers, the MD and the owner pick anyone. The Restaurant Counter (the one shared account, the
 * restaurant's official payment station) sees "Restaurant collections": every food and drink
 * payment, each named "Restaurant Counter" (never a person) with the waiter who brought the money
 * when noted — never room or other money. Waiters are not collectors: they serve, and have no
 * collections of their own. Room charges and refunds are shown apart; reversed payments stay on the
 * record, not counted. Not the ledger.
 *
 * Views (tabs): All payments · Paid (confirmed) · To confirm · Still to collect (open orders with
 * money due — any day) · Reversed. Every restaurant line says which table or room, who served it,
 * who recorded the money and who brought it. Whoever confirms restaurant payments (the Counter,
 * reception) sees every payment waiting for confirmation, with a Confirm button; managers watch.
 */
export default async function CollectionsPage({ searchParams }: PageProps<"/staff/collections">) {
  // shifts.view keeps a receptionist's own history open even off shift (it is read-only and their own).
  const user = await requirePagePermission("revenue.record", "payments.record", "shifts.view", "dashboard.manager", "dashboard.owner", "dashboard.admin", "finance.view");
  // The Restaurant Counter: the restaurant's official payment station — it sees the whole restaurant's
  // collections (restaurant payments only), never per waiter: waiters serve, they do not collect.
  const device = isRestaurantDevice(user.permissions);
  const supervisor = !device && (can(user, "dashboard.manager") || can(user, "dashboard.owner") || can(user, "dashboard.admin") || can(user, "finance.view"));
  const takesRoomMoney = !device && can(user, "payments.record");
  // Staff (reception) see their money shift by shift — this shift and the ones before; the Counter one day at a time.
  // Weeks, months, years and all time are for managers, the MD and the owner (owner, 2026-10-04).
  const staffView = !device && !supervisor;
  // Confirming is work: the Counter and reception do it — a receptionist only inside their open shift (off shift the
  // page is their own read-only history); managers, the MD and the owner watch.
  const offShift = needsOwnShift(user.permissions) && !(await getMyOpenShift(user.id));
  const confirms = can(user, "restaurant.payments.confirm") && !supervisor && !offShift;
  // An order paid online (LIPA) is confirmed by recording it once from the customer's proof.
  const confirmsOnline = confirms && can(user, "revenue.record");
  const sp = await searchParams;
  const [today, settings, t] = await Promise.all([businessToday(), getSettings(), getT()]);

  // One shift: its person's records inside its time (a receptionist: only their own shifts — this one by default).
  const shiftId = str(sp.shift);
  const myShifts = staffView ? await db.actualShift.findMany({ where: { userId: user.id, department: "RECEPTION" }, orderBy: { startedAt: "desc" }, take: 12, include: { user: { select: { id: true, fullName: true } } } }) : [];
  const shift = staffView ? myShifts.find((x) => x.id === shiftId) ?? myShifts.find((x) => !x.endedAt) ?? myShifts[0] ?? null
    : shiftId ? await db.actualShift.findUnique({ where: { id: shiftId }, include: { user: { select: { id: true, fullName: true } } } }) : null;
  const ownShift = shift && (supervisor || shift.userId === user.id) ? shift : null;
  const window = ownShift ? { start: ownShift.startedAt, end: ownShift.endedAt ?? new Date() } : null;

  // Managers: every payment, newest first, unless a period is picked. Staff: today only (when they have no shift yet).
  // The Counter: one day at a time.
  const asked = readPeriod(sp, today, device ? "today" : "all", { allTime: supervisor });
  const p = staffView ? readPeriod({ period: "today" }, today, "today") : device && asked.from !== asked.to ? { ...asked, key: "custom" as const, from: asked.to } : asked;
  const picked = str(sp.w);
  // A person only ever sees their own collections — whatever the address says. The Counter always sees
  // the whole restaurant (no one person's), whatever ?w= says.
  const collectorId = ownShift ? ownShift.userId
    : device ? null
    : supervisor ? (picked && picked !== "all" ? picked : null) : user.id;
  const src = device ? null : SRC_KEY[str(sp.src)] ?? null;
  // One waiter's orders (who served them): restaurant only — rooms and other sales have no waiter.
  const servedById = str(sp.served) || null;
  const sources: MoneySource[] = device || servedById ? ["RESTAURANT"] : src ? [src] : supervisor || takesRoomMoney ? ALL_SOURCES : ["RESTAURANT"];
  const restaurant = sources.includes("RESTAURANT");
  const accountId = str(sp.account) || null;
  const methodId = str(sp.method) || null;
  const status = (["COLLECTED", "TO_CONFIRM", "REVERSED"] as const).find((s) => s === sp.status) ?? null;
  // Still to collect: open orders now (any day) — not for one past shift, and only with the restaurant shown.
  const collecting = restaurant && !ownShift && !staffView && sp.view === "collect";
  // Mobile money: every payment request in the same time and places — paid, waiting or not paid (and why).
  const mobileView = sp.view === "mobile";
  const mobileFilter = (["paid", "waiting", "unpaid"] as const).find((x) => x === sp.ms) ?? "all";
  const PURPOSES: Record<MoneySource, string[]> = { ROOMS: ["RESERVATION", "INVOICE"], RESTAURANT: ["RESTAURANT"], SALES: ["TRANSPORT"] };
  const purposes = sources.flatMap((x) => PURPOSES[x]);
  const q = str(sp.q).trim();
  const page = Math.max(1, Number(sp.page) || 1);

  const base: CollectionFilter = { from: p.from, to: p.to, window, collectorId, accountId, methodId, q, sources, servedById };
  // To confirm is work, not history: every payment still waiting, from any day (one past shift: its own).
  const waiting: CollectionFilter = ownShift || staffView ? base : { ...base, from: ALL_TIME_FROM, to: today };
  // Whoever confirms sees every restaurant payment waiting for confirmation — whoever recorded it.
  // (The Counter already sees the whole restaurant.)
  const queue: CollectionFilter = confirms && !ownShift && !device ? { ...waiting, collectorId: null, sources: ["RESTAURANT"] } : waiting;
  const listFilter: CollectionFilter = status === "TO_CONFIRM" ? { ...queue, status } : { ...base, status };

  // Hotel (rooms & bookings) and restaurant money side by side — whichever one the list shows.
  const canSplit = !device && !servedById && (supervisor || takesRoomMoney);
  const [list, counts, queueCounts, totals, open, people, waiters, accounts, methods, onlineT, everySource] = await Promise.all([
    collecting || mobileView ? Promise.resolve(null) : collectionRows({ ...listFilter, page }),
    collectionCounts(base),
    queue === base ? Promise.resolve(null) : collectionCounts(queue),
    collectionTotals(p.from, p.to, { window, collectorIds: collectorId ? [collectorId] : null, accountId, methodId, sources, servedById }),
    // Reception: the hotel's open orders only (a restaurant customer's is the Counter's to collect).
    restaurant && !ownShift && !staffView ? stillToCollect({ servedById, q, hotel: isDeskUser(user) ? await inHouseGuestIds() : null }) : Promise.resolve(null),
    supervisor ? collectors(p.from, p.to, ALL_SOURCES) : Promise.resolve([]),
    restaurant ? waitersToAssign() : Promise.resolve([]),
    db.moneyAccount.findMany({ where: { acceptsPayments: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.paymentMethod.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    // The summary cards cover the whole period (the search only narrows the list).
    restaurant ? onlineTotals({ ...base, q: null, sources: ["RESTAURANT"] }) : Promise.resolve(null),
    canSplit && src ? collectionTotals(p.from, p.to, { window, collectorIds: collectorId ? [collectorId] : null, accountId, methodId, sources: ALL_SOURCES, servedById }) : Promise.resolve(null),
  ]);
  // Hotel money guests paid online before arriving: shown to reception until the guest is checked in (then it is the
  // collection of whoever checks them in). Not for the Counter, nor for one past shift.
  const awaiting = !device && (takesRoomMoney || supervisor) && sources.includes("ROOMS") && !(ownShift?.endedAt) ? await paidOnlineAwaitingCheckIn() : null;
  // Reception and the Counter see only what is going on now — the last five days (owner, 2026-10-05); the whole list,
  // any period, stays with managers and the admin (here with a period, and Finance → Online payments).
  const recentOnly = !supervisor;
  const phonePays = await onlinePayments({
    from: p.from, to: p.to, status: "all", purpose: null, q, purposes,
    window: recentOnly ? recentMobileWindow() : window,
  });
  const phonePaid = phonePays.filter((r) => r.status === "COMPLETED");
  const tot = collectorId ? totals.of(collectorId) : totals.all;
  const split = canSplit ? (everySource ? (collectorId ? everySource.of(collectorId) : everySource.all) : tot) : null;
  const bySrc = (k: MoneySource) => split?.bySource.find((x) => x.source === k)?.amount ?? 0;
  // Paid online (LIPA), waiting for the check — open orders, any day. They are to confirm, never to collect.
  const online = open?.rows.filter((r) => r.online) ?? [];
  const toCollectRows = open?.rows.filter((r) => !r.online) ?? [];
  const onlineAmount = online.reduce((s, r) => s + r.due, 0);
  const toConfirmCount = (queueCounts ?? counts).toConfirm + online.length;
  const who = ownShift ? ownShift.user.fullName.replace(/\s*\(.*\)/, "")
    : collectorId ? people.find((x) => x.id === collectorId)?.name ?? (collectorId === user.id ? user.fullName.replace(/\s*\(.*\)/, "") : t("This person")) : null;
  const mine = !device && collectorId === user.id;
  const waiterName = servedById === NO_WAITER ? t("No waiter") : servedById ? waiters.find((w) => w.id === servedById)?.name.replace(/\s*\(.*\)/, "") ?? open?.byWaiter.find((w) => w.id === servedById)?.name ?? t("One waiter") : null;

  const keep: Record<string, string> = Object.fromEntries(Object.entries({
    period: p.key === "custom" ? "" : p.key, from: p.key === "custom" ? p.from : "", to: p.key === "custom" ? p.to : "", shift: ownShift?.id ?? "",
    w: supervisor ? picked : "", src: device ? "" : str(sp.src), account: accountId ?? "", method: methodId ?? "", served: servedById ?? "",
    status: status ?? "", view: collecting ? "collect" : mobileView ? "mobile" : "", ms: mobileView && mobileFilter !== "all" ? mobileFilter : "", q,
  }).filter(([, v]) => v));
  const link = (extra: Record<string, string>) => `?${new URLSearchParams(Object.entries({ ...keep, ...extra }).filter(([, v]) => v))}`;
  const tab = (extra: { status?: string; view?: string }) => link({ status: extra.status ?? "", view: extra.view ?? "", page: "" });

  const rows = list?.rows ?? [];
  const days = rows.reduce<{ day: string; rows: CollectionRow[]; total: number }[]>((out, r) => {
    const last = out[out.length - 1];
    const counted = r.status === "REVERSED" ? 0 : r.amount;
    if (last && last.day === r.day) { last.rows.push(r); last.total += counted; } else out.push({ day: r.day, rows: [r], total: counted });
    return out;
  }, []);
  const anyDayQueue = status === "TO_CONFIRM" && !ownShift;
  const heading = collecting ? t("Still to collect — open now, any day")
    : anyDayQueue ? t("Waiting for confirmation — any day")
    : ownShift ? `${t(shiftLabel(ownShift.startedAt))} · ${t.dateTime(ownShift.startedAt)} → ${ownShift.endedAt ? t.time(ownShift.endedAt) : t("now (open)")}`
    : p.key === "all" ? t("Every payment — all time") : periodText(t, p);
  const queueNote = status === "TO_CONFIRM" && confirms && !ownShift && (list?.count ?? 0) > 0;

  const listing = !collecting && !mobileView;
  const TABS = [
    { key: "all", label: t("All payments"), count: counts.all, href: tab({}), on: listing && !status, tone: "" },
    { key: "paid", label: t("Paid"), count: counts.paid, href: tab({ status: "COLLECTED" }), on: listing && status === "COLLECTED", tone: "bg-emerald-500" },
    // Nobody confirms payments by hand any more: the tab is only there when something old still waits.
    ...((restaurant || queue !== base) && (toConfirmCount > 0 || status === "TO_CONFIRM") ? [{ key: "confirm", label: t("To confirm"), count: toConfirmCount, href: tab({ status: "TO_CONFIRM" }), on: listing && status === "TO_CONFIRM", tone: "bg-amber-500" }] : []),
    ...(open ? [{ key: "collect", label: t("Still to collect"), count: toCollectRows.length, href: tab({ view: "collect" }), on: collecting, tone: "bg-[oklch(0.76_0.12_80)]" }] : []),
    { key: "reversed", label: t("Reversed"), count: counts.reversed, href: tab({ status: "REVERSED" }), on: listing && status === "REVERSED", tone: "bg-rose-500" },
    // Every mobile-money request here — paid or not (not called "online payments": staff send them too).
    ...(phonePays.length || mobileView ? [{ key: "mobile", label: t("Mobile money"), count: phonePays.length, href: tab({ view: "mobile" }), on: mobileView, tone: "bg-sky-500" }] : []),
  ];

  const title = device ? t("Restaurant collections") : mine ? t("Collections") : who ? t("Collections · {name}", { name: who }) : t("Collections · everyone");
  // The accounts in one fixed colour each (by their place in the list — never by rank), for the bar and its legend.
  const accountTone = (name: string) => ACCOUNT_TONES[Math.max(0, tot.byAccount.findIndex((a) => a.name === name)) % ACCOUNT_TONES.length];
  const share = (v: number) => (tot.collected > 0 ? Math.round((v / tot.collected) * 100) : 0);

  // "Served by" only means something for restaurant payments — a page of room payments shows who collected each one.
  const waiterRows = rows.some((r) => r.source === "RESTAURANT");
  // nTZS mobile money that needs a person (those who take payments, and managers); the Counter sees the restaurant's.
  const takesPay = can(user, "payments.record") || can(user, "revenue.record");
  const attention: AttentionRow[] = takesPay || supervisor
    ? await onlineAttentionRows(device ? "RESTAURANT" : undefined)
    : [];

  return (
    <div className="w-full space-y-4">
      <MobileMoneyAttention rows={attention} />
      {/* Title and period */}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.4rem,2vw,1.75rem)] font-semibold tracking-tight">{title}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{heading}</p>
        </div>
        {staffView
          ? ownShift && <Link href={`/staff/shifts/${ownShift.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted"><Clock className="size-4" />{t("Shift details")}</Link>
          : ownShift
            ? <Link href={`/staff/shifts/${ownShift.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted"><RotateCcw className="size-4" />{t("Back to the shift")}</Link>
            : !collecting && !anyDayQueue && <PeriodPicker allTime={supervisor} dayOnly={device} current={p.key} from={p.from} to={p.to} keep={Object.fromEntries(Object.entries(keep).filter(([k]) => !["period", "from", "to", "day", "page"].includes(k)))} />}
      </header>
      {/* Staff: their shifts — this one first, then the ones before */}
      {staffView && <ShiftPicker shifts={myShifts} current={ownShift?.id ?? null} timezone={settings.timezone} href={(id) => link({ shift: id, page: "", status: "", view: "" })} />}

      {/* Hotel and restaurant money, each on its own — tap one to see only its payments */}
      {split && (() => {
        const parts = [
          { key: "", label: t("Everything"), sub: t("Hotel and restaurant"), amount: split.collected, icon: Wallet, tone: "bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.84_0.11_82)]" },
          { key: "rooms", label: t("Hotel · rooms & bookings"), sub: t("Stays, bookings, room bills"), amount: bySrc("ROOMS"), icon: BedDouble, tone: "bg-sky-500/15 text-sky-300" },
          { key: "restaurant", label: t("Restaurant & bar"), sub: t("Food and drinks"), amount: bySrc("RESTAURANT"), icon: UtensilsCrossed, tone: "bg-emerald-500/15 text-emerald-300" },
          ...(bySrc("SALES") > 0 || src === "SALES" ? [{ key: "sales", label: t("Other sales"), sub: t("Sold at the desk"), amount: bySrc("SALES"), icon: Store, tone: "bg-violet-500/15 text-violet-300" }] : []),
        ];
        const on = (k: string) => (k ? SRC_KEY[k] === src : !src);
        return (
          <nav aria-label={t("Hotel or restaurant")} className={cn("grid gap-2 sm:gap-3", parts.length > 3 ? "grid-cols-2 lg:grid-cols-4" : "grid-cols-1 sm:grid-cols-3")}>
            {parts.map((x) => {
              const Icon = x.icon;
              return (
                <Link key={x.key || "all"} href={link({ src: x.key, page: "", status: "", view: "" })} aria-current={on(x.key) ? "page" : undefined}
                  className={cn("flex items-center gap-3 rounded-2xl border px-4 py-3 transition", on(x.key) ? "border-[oklch(0.75_0.12_80)] bg-[oklch(0.72_0.12_80/0.12)] ring-1 ring-[oklch(0.75_0.12_80/0.5)]" : "border-border/70 bg-card hover:bg-muted/40")}>
                  <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl [&_svg]:size-[18px]", x.tone)}><Icon /></span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-xs font-semibold text-muted-foreground">{x.label}</span>
                    <span className="block truncate text-lg font-semibold tabular-nums">{formatTZS(x.amount)}</span>
                    <span className="block truncate text-[11px] text-muted-foreground">{x.key && split.collected > 0 ? `${Math.round((x.amount / split.collected) * 100)}% · ` : ""}{x.sub}</span>
                  </span>
                </Link>
              );
            })}
          </nav>
        );
      })()}

      {/* The summary: what came in and how — then online, still to collect, room bills, reversed */}
      <section className="grid gap-3 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div className="flex flex-col rounded-3xl border border-border/70 bg-card p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                <span className="grid size-7 place-items-center rounded-lg bg-emerald-500/15 text-emerald-300 [&_svg]:size-3.5"><Banknote /></span>
                {device ? t("The restaurant collected") : mine ? t("You collected") : who ? t("{name} collected", { name: who }) : t("Collected")}
              </p>
              <p className="mt-3 text-4xl font-semibold leading-none tracking-tight tabular-nums">{formatTZS(tot.collected)}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                {t.plural(tot.payments, "{n} payment", "{n} payments")}{waiterName ? ` · ${t("served by {name}", { name: waiterName })}` : ""}{tot.refunds ? ` · ${t("{refunded} refunded — {kept} kept", { refunded: formatTZS(tot.refunds), kept: formatTZS(tot.net) })}` : ""}
              </p>
            </div>
          </div>

          {tot.byAccount.length > 0 ? (
            <div className="mt-5">
              <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("Into which account")}</p>
              <div className="flex h-2.5 gap-0.5 overflow-hidden rounded-full bg-muted" role="img" aria-label={tot.byAccount.map((a) => `${t(a.name)} ${share(a.amount)}%`).join(", ")}>
                {tot.byAccount.map((a) => <span key={a.name} className="h-full first:rounded-l-full last:rounded-r-full" style={{ width: `${Math.max(2, share(a.amount))}%`, background: accountTone(a.name) }} />)}
              </div>
              <ul className="mt-3 grid gap-x-6 gap-y-1.5 sm:grid-cols-2">
                {tot.byAccount.map((a) => (
                  <li key={a.name} className="flex items-center justify-between gap-3 text-sm">
                    <span className="flex min-w-0 items-center gap-2"><span className="size-2 shrink-0 rounded-full" style={{ background: accountTone(a.name) }} /><span className="truncate">{t(a.name)}</span></span>
                    <span className="shrink-0 tabular-nums"><span className="font-medium">{a.amount.toLocaleString("en-US")}</span><span className="ml-1.5 text-xs text-muted-foreground">{share(a.amount)}%</span></span>
                  </li>
                ))}
              </ul>
              {!split && tot.bySource.length > 1 && <p className="mt-3 border-t border-border/60 pt-2.5 text-xs text-muted-foreground">{tot.bySource.map((x) => `${t(x.label)} ${x.amount.toLocaleString("en-US")}`).join(" · ")}</p>}
            </div>
          ) : null}
          {tot.byKind.length > 0 ? (
            <div className="mt-auto pt-5">
              <p className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("How it was paid")}</p>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(auto-fit,minmax(9rem,1fr))]">
                {tot.byKind.map((k) => {
                  const Icon = /cash/i.test(k.name) ? Banknote : /card/i.test(k.name) ? CreditCard : /bank/i.test(k.name) ? Landmark : /mobile/i.test(k.name) ? Smartphone : Wallet;
                  return (
                    <div key={k.name} className="flex items-center gap-2.5 rounded-2xl bg-muted/40 px-3 py-2.5 ring-1 ring-inset ring-border/60">
                      <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-background/60 text-muted-foreground [&_svg]:size-4"><Icon /></span>
                      <span className="min-w-0 leading-tight">
                        <span className="block truncate text-[11px] text-muted-foreground">{t(k.name)}</span>
                        <span className="block text-sm font-semibold tabular-nums">{k.amount.toLocaleString("en-US")}</span>
                        <span className="block text-[11px] tabular-nums text-muted-foreground">{t("{pct}% of it", { pct: share(k.amount) })}</span>
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="mt-5 rounded-2xl border border-dashed border-border/80 px-4 py-5 text-center text-sm text-muted-foreground">
              {ownShift ? t("No payments in this shift yet.") : p.key === "today" ? t("No payments today yet.") : t("No payments in this period yet.")}{supervisor && p.key !== "all" && !ownShift ? <> <Link href={link({ period: "all", from: "", to: "", page: "" })} className="font-medium text-foreground underline-offset-2 hover:underline">{t("See every payment")}</Link></> : null}
            </p>
          )}
        </div>

        <div className="grid grid-cols-2 gap-3">
          {restaurant && onlineT && (!collectorId || onlineT.count > 0 || onlineT.notReceived > 0) ? (
            <Stat icon={Smartphone} tone="bg-sky-500/15 text-sky-300" label={t("Paid by phone")} value={formatTZS(onlineT.amount)}
              sub={onlineT.count || onlineT.notReceived
                ? <>{t.plural(onlineT.count, "{n} order", "{n} orders")} · {t("automatic")}{onlineT.notReceived ? <span className="text-rose-300"> · {t("{n} not received", { n: onlineT.notReceived })}</span> : null}</>
                : t("None in this period")} />
          ) : <Stat icon={RotateCcw} tone="bg-muted text-muted-foreground" label={t("Refunds given")} value={formatTZS(tot.refunds)} sub={tot.refundCount ? t.plural(tot.refundCount, "{n} refund", "{n} refunds") : t("None")} />}
          {open
            ? <Stat icon={Clock} tone="bg-amber-500/15 text-amber-300" label={t("Still to collect")} value={formatTZS(open.toCollect.amount)} href={tab({ view: "collect" })}
                sub={open.toCollect.count ? `${t.plural(open.toCollect.count, "{n} open order", "{n} open orders")} · ${t("any day")}` : t("Nothing open")} />
            : <Stat icon={Wallet} tone="bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.84_0.11_82)]" label={t("Showing")} value={sources.length === ALL_SOURCES.length ? t("Every source") : sources.map((x) => t(SOURCE_LABEL[x])).join(" · ")} sub={staffView ? t("Tap Hotel or Restaurant above") : t("Change it with Source below")} />}
          {restaurant
            ? <Stat icon={BedDouble} tone="bg-violet-500/15 text-violet-300" label={t("On room bills")} value={formatTZS(tot.roomCharges)}
                sub={accountId || methodId ? t("Not for one account") : tot.roomOrders ? `${t.plural(tot.roomOrders, "{n} order", "{n} orders")} · ${t("paid at check-out")}` : t("None in this period")} />
            : <Stat icon={Wallet} tone="bg-emerald-500/15 text-emerald-300" label={t("Kept after refunds")} value={formatTZS(tot.net)} sub={t.plural(tot.payments, "{n} payment", "{n} payments")} />}
          <Stat icon={Undo2} tone="bg-rose-500/15 text-rose-300" label={t("Reversed")} value={formatTZS(tot.reversed)} href={tot.reversedCount ? tab({ status: "REVERSED" }) : undefined}
            sub={tot.reversedCount ? `${t.plural(tot.reversedCount, "{n} payment", "{n} payments")} · ${t("not counted")}` : t("None")} />
        </div>
      </section>

      {/* Paid online before arriving — waiting for check-in */}
      {awaiting && awaiting.count > 0 && (
        <section aria-labelledby="awaiting-title" className="rounded-3xl border border-sky-500/30 bg-sky-500/[0.06] p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="awaiting-title" className="flex items-center gap-2 font-semibold"><Smartphone className="size-4 text-sky-400" />{t("Paid online · not checked in yet")}</h2>
            <p className="text-sm tabular-nums"><span className="font-semibold">{formatTZS(awaiting.amount)}</span> <span className="text-muted-foreground">· {t.plural(awaiting.count, "{n} payment", "{n} payments")}</span></p>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("Guests paid by mobile money before arriving. It goes into your collections when you check them in.")}</p>
          {/* The 5 newest; the rest one tap away (owner, 2026-10-05: "only 5 on the list — if we want more we view more"). */}
          <ul className="mt-3 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
            {awaiting.rows.slice(0, 5).map((a) => <AwaitingLine key={a.id} a={a} checkIn={takesRoomMoney} />)}
          </ul>
          {awaiting.rows.length > 5 && (
            <details className="group mt-2">
              <summary className="inline-flex h-9 cursor-pointer list-none items-center gap-1.5 rounded-xl px-3 text-sm font-medium text-sky-300 hover:bg-sky-500/10 [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">{t("View {n} more", { n: awaiting.rows.length - 5 })}</span><span className="hidden group-open:inline">{t("Show fewer")}</span>
              </summary>
              <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
                {awaiting.rows.slice(5).map((a) => <AwaitingLine key={a.id} a={a} checkIn={takesRoomMoney} />)}
              </ul>
            </details>
          )}
        </section>
      )}

      {/* Paid by phone lately — the money customers sent from their phones, whatever the hotel day (owner, 2026-10-05:
          "if the customer pays we must see those transactions"). The 5 newest; the rest one tap away. */}
      {recentOnly && !mobileView && phonePaid.length > 0 && (
        <section aria-labelledby="phone-paid-title" className="rounded-3xl border border-emerald-500/25 bg-emerald-500/[0.05] p-4 sm:p-5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
            <h2 id="phone-paid-title" className="flex items-center gap-2 font-semibold"><Smartphone className="size-4 text-emerald-400" />{t("Paid by phone · last {days} days", { days: RECENT_DAYS })}</h2>
            <p className="text-sm tabular-nums"><span className="font-semibold text-emerald-300">{formatTZS(phonePaid.reduce((sum, r) => sum + r.amount, 0))}</span> <span className="text-muted-foreground">· {t.plural(phonePaid.length, "{n} payment", "{n} payments")}</span></p>
          </div>
          <ul className="mt-3 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
            {phonePaid.slice(0, 5).map((r) => <PhonePaidLine key={r.id} r={r} timezone={settings.timezone} />)}
          </ul>
          {phonePaid.length > 5 && (
            <details className="group mt-2">
              <summary className="inline-flex h-9 cursor-pointer list-none items-center rounded-xl px-3 text-sm font-medium text-emerald-300 hover:bg-emerald-500/10 [&::-webkit-details-marker]:hidden">
                <span className="group-open:hidden">{t("View {n} more", { n: phonePaid.length - 5 })}</span><span className="hidden group-open:inline">{t("Show fewer")}</span>
              </summary>
              <ul className="mt-2 divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/60 bg-card">
                {phonePaid.slice(5).map((r) => <PhonePaidLine key={r.id} r={r} timezone={settings.timezone} />)}
              </ul>
            </details>
          )}
        </section>
      )}

      {/* The views and the filters, in one panel */}
      <section className="rounded-3xl border border-border/70 bg-card p-2">
        <nav aria-label={t("Views")} className="overflow-x-auto [scrollbar-width:none]">
          <div className="flex w-max gap-1">
            {TABS.map((x) => (
              <Link key={x.key} href={x.href} aria-current={x.on ? "page" : undefined}
                className={cn("inline-flex h-9 items-center gap-2 rounded-xl px-3 text-sm font-medium transition-colors",
                  x.on ? "bg-[oklch(0.72_0.12_80/0.14)] text-foreground ring-1 ring-inset ring-[oklch(0.75_0.12_80/0.45)]" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                {x.tone && <span className={cn("size-1.5 rounded-full", x.tone)} />}
                {x.label}
                <span className={cn("rounded-full px-1.5 text-[11px] font-semibold tabular-nums", x.on ? "bg-background/60 text-foreground" : "bg-muted",
                  x.key === "confirm" && x.count > 0 && "bg-amber-500/15 text-amber-300")}>{x.count}</span>
              </Link>
            ))}
          </div>
        </nav>
        <form className="mt-2 flex flex-wrap gap-2 border-t border-border/60 px-1 pb-1 pt-3">
          {Object.entries(keep).filter(([k]) => ["period", "from", "to", "shift", "status", "view", ...(collecting ? ["w", "src", "account", "method"] : [])].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <div className="relative min-w-60 flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input name="q" defaultValue={q} placeholder={collecting ? t("Order number, customer, phone, table, room, waiter…") : device ? t("Customer, order number, table, room, reference, waiter…") : t("Customer, booking or order number, table, room, waiter, reference…")} className="h-10 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-sm" />
          </div>
          {/* Reception sees a few things on its own shift (the cards say hotel or restaurant); managers get every filter. */}
          {!staffView && waiters.length > 0 && <AutoSelect name="served" value={servedById ?? ""} label={t("Served by")} options={[{ value: "", label: t("Served by — every waiter") }, ...waiters.map((w) => ({ value: w.id, label: t("Served by {name}", { name: w.name.replace(/\s*\(.*\)/, "") }) })), { value: NO_WAITER, label: t("No waiter") }]} />}
          {!collecting && supervisor && !ownShift && <AutoSelect name="w" value={str(sp.w)} label={t("Recorded by")} options={[{ value: "", label: t("Recorded by — everyone") }, ...people.map((x) => ({ value: x.id, label: `${x.name} · ${t(x.role)}` }))]} />}
          {!collecting && !staffView && (supervisor || takesRoomMoney) && <AutoSelect name="src" value={str(sp.src)} label={t("Source")} options={[{ value: "", label: t("Every source") }, { value: "rooms", label: t(SOURCE_LABEL.ROOMS) }, { value: "restaurant", label: t(SOURCE_LABEL.RESTAURANT) }, { value: "sales", label: t(SOURCE_LABEL.SALES) }]} />}
          {!collecting && !staffView && <AutoSelect name="method" value={methodId ?? ""} label={t("Method")} options={[{ value: "", label: t("Every method") }, ...methods.map((m) => ({ value: m.id, label: t(m.name) }))]} />}
          {!collecting && !staffView && <AutoSelect name="account" value={accountId ?? ""} label={t("Account")} options={[{ value: "", label: t("Every account") }, ...accounts.map((a) => ({ value: a.id, label: t(a.name) }))]} />}
        </form>
      </section>

      {mobileView ? (
        <MobileMoneyList rows={phonePays} filter={mobileFilter} href={(f) => link({ view: "mobile", ms: f === "all" ? "" : f, page: "" })} timezone={settings.timezone}
          scope={`${recentOnly ? t("the last {days} days", { days: RECENT_DAYS }) : ownShift ? t("this shift") : p.key === "all" ? t("all time") : periodText(t, p).toLowerCase()} · ${sources.length === ALL_SOURCES.length ? t("hotel & restaurant") : sources.map((x) => t(SOURCE_LABEL[x])).join(", ").toLowerCase()}`} />
      ) : collecting && open ? (
        <ToCollect open={open} rows={toCollectRows} today={today} servedById={servedById} link={link} confirmHref={tab({ status: "TO_CONFIRM" })} />
      ) : list && (
        <>
          {status !== "TO_CONFIRM" && online.length > 0 && (
            <Link href={tab({ status: "TO_CONFIRM" })} className="group flex items-center gap-3 rounded-2xl border border-sky-500/30 bg-sky-500/[0.07] px-4 py-2.5 text-sm transition-colors hover:bg-sky-500/12">
              <ShieldCheck className="size-4 shrink-0 text-sky-600 dark:text-sky-300" />
              <span className="min-w-0 flex-1"><span className="font-semibold">{t.plural(online.length, "{n} online payment to check", "{n} online payments to check")} · {formatTZS(onlineAmount)}</span><span className="text-muted-foreground"> — {t("paid by LIPA, not counted until confirmed")}</span></span>
              <ArrowRight className="size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" />
            </Link>
          )}
          {status === "TO_CONFIRM" && online.length > 0 && (
            <section className="overflow-hidden rounded-3xl border border-sky-500/30 bg-card">
              <header className="border-b border-border/60 bg-sky-500/[0.06] px-4 py-2.5">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-sm font-semibold">{t("Paid online — check the account")}<span className="ml-2 text-xs font-normal text-muted-foreground">{t.plural(online.length, "{n} order", "{n} orders")} · {t("open now, any day")}</span></p>
                  <p className="text-sm font-semibold tabular-nums text-sky-700 dark:text-sky-300">{formatTZS(onlineAmount)}</p>
                </div>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {t("The customer paid by LIPA and sent proof. Confirm only once the money is in the account — a new order is accepted after that. Not in? Decline the order on the board. Money paid at the Counter needs no check.")}
                </p>
              </header>
              <ul className="divide-y divide-border/50">
                {online.map((r) => <OnlineLine key={r.id} r={r} today={today} confirm={confirmsOnline} />)}
              </ul>
            </section>
          )}
          {(list.count > 0 || !(status === "TO_CONFIRM" && online.length > 0)) && <p className="text-xs text-muted-foreground">
            {list.count ? t.plural(list.count, "Showing {from}–{to} of {n} payment", "Showing {from}–{to} of {n} payments", { from: (list.page - 1) * 100 + 1, to: (list.page - 1) * 100 + list.rows.length }) : t("No payments")} · {t("newest first")}
            {servedById && (supervisor || takesRoomMoney) && src !== "RESTAURANT" ? ` · ${t("restaurant only — rooms and other sales have no waiter")}` : ""}
          </p>}
          {queueNote && (
            <p className="rounded-2xl border border-amber-500/25 bg-amber-500/8 px-4 py-2.5 text-xs text-amber-900 dark:text-amber-200">
              {t("Every restaurant payment waiting for confirmation — whoever recorded it. Confirm one once the money is in its account; until then it is not counted as paid.")}
            </p>
          )}

          {rows.length > 0 && <PaymentColumns waiters={waiterRows} collector={!staffView} />}
          {rows.length === 0 ? (status === "TO_CONFIRM" && online.length > 0 ? null : <p className="rounded-3xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">{status === "TO_CONFIRM" ? t("Nothing waiting for confirmation.")
            : p.key !== "all" && !ownShift && !q && !accountId && !methodId && !servedById
              ? <>{p.key === "today" ? t("No payments today.") : t("No payments in this period.")} <Link href={link({ period: "all", from: "", to: "", page: "" })} className="font-semibold text-foreground underline-offset-2 hover:underline">{t("See every payment — all time")}</Link></>
              : t("No payments for these filters.")}</p>) : days.map((d) => (
            <section key={d.day} className="overflow-hidden rounded-3xl border border-border/70 bg-card">
              <header className="flex items-baseline justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-2.5">
                <p className="text-sm font-semibold">{t.date(d.day, true)}<span className="ml-2 text-xs font-normal text-muted-foreground">{t.plural(d.rows.length, "{n} payment", "{n} payments")}</span></p>
                <p className={cn("text-sm font-semibold tabular-nums", status === "TO_CONFIRM" ? "text-amber-700 dark:text-amber-300" : "text-emerald-600 dark:text-emerald-400")}>{formatTZS(d.total)}</p>
              </header>
              <ul className="divide-y divide-border/50">
                {d.rows.map((r) => <PaymentRow key={`${r.source}-${r.id}`} r={r} meId={user.id} confirm={confirms} waiters={waiterRows} collector={!staffView} />)}
              </ul>
            </section>
          ))}

          {list.pages > 1 && (
            <div className="flex items-center justify-between text-sm">
              <span className="text-muted-foreground">{t("Page {page} of {pages}", { page: list.page, pages: list.pages })}</span>
              <div className="flex gap-2">
                {list.page > 1 && <Link className="rounded-xl border border-border px-3 py-1.5 font-medium hover:bg-muted" href={link({ page: String(list.page - 1) })}>{t("Newer")}</Link>}
                {list.page < list.pages && <Link className="rounded-xl border border-border px-3 py-1.5 font-medium hover:bg-muted" href={link({ page: String(list.page + 1) })}>{t("Older")}</Link>}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}

/**
 * STILL TO COLLECT — the total at the top ("TZS 136,000 · 8 orders"), what each waiter's orders
 * still have to pay (tap to see only theirs), then every open order, oldest first.
 */
async function ToCollect({ open, rows, today, servedById, link, confirmHref }: {
  open: StillToCollect; rows: StillToCollect["rows"]; today: string; servedById: string | null; link: (extra: Record<string, string>) => string; confirmHref: string;
}) {
  const t = await getT();
  return (
    <>
      <section className="rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"><Clock className="size-3.5 text-amber-500" />{t("Still to collect")}</p>
            <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{formatTZS(open.toCollect.amount)}</p>
            <p className="text-xs text-muted-foreground">
              {t.plural(open.toCollect.count, "{n} order not paid yet — not on a room bill", "{n} orders not paid yet — not on a room bill")}
              {open.online.count > 0 && <> · <Link href={confirmHref} className="font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-300">{t("{amount} paid online, to check ({orders})", { amount: formatTZS(open.online.amount), orders: t.plural(open.online.count, "{n} order", "{n} orders") })}</Link></>}
            </p>
          </div>
        </div>
        {open.byWaiter.length > 0 && (
          <div className="mt-4">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("By waiter serving")}</p>
            <div className="flex flex-wrap gap-1.5">
              {servedById && <Link href={link({ served: "", page: "" })} className="rounded-full border border-border/80 bg-background/50 px-2.5 py-1 text-[11px] font-medium hover:bg-muted">{t("Every waiter")}</Link>}
              {open.byWaiter.map((w) => (
                <Link key={w.id} href={link({ served: w.id, page: "" })}
                  className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium tabular-nums transition-colors",
                    servedById === w.id ? "border-[oklch(0.72_0.11_80)] bg-[oklch(0.84_0.11_82)]/20 text-foreground" : "border-border/80 bg-background/50 hover:bg-muted",
                    w.id === NO_WAITER && "text-muted-foreground")}>
                  {w.id === NO_WAITER ? t("No waiter") : w.name} · {t.plural(w.orders, "{n} order", "{n} orders")} · {formatTZS(w.amount)}
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      {rows.length === 0
        ? <p className="rounded-3xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">{servedById ? t("Nothing to collect for this waiter — every open order is paid or on a room bill.") : t("Nothing to collect — every open order is paid or on a room bill.")}</p>
        : (
          <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
            <header className="flex items-baseline justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-2.5">
              <p className="text-sm font-semibold">{t("Open orders")}<span className="ml-2 text-xs font-normal text-muted-foreground">{t.plural(rows.length, "{n} order", "{n} orders")} · {t("oldest first")}</span></p>
              <p className="text-sm font-semibold tabular-nums text-amber-700 dark:text-amber-300">{formatTZS(rows.reduce((s, r) => s + r.due, 0))}</p>
            </header>
            <ul className="divide-y divide-border/50">
              {rows.map((r) => <ToCollectLine key={r.id} r={r} today={today} />)}
            </ul>
          </section>
        )}
    </>
  );
}

/** One figure in the summary: a coloured icon chip, the label, the value and one line under it (a link when it opens a view). */
function Stat({ icon: Icon, tone, label, value, sub, href }: { icon: typeof Wallet; tone: string; label: string; value: string; sub: React.ReactNode; href?: string }) {
  const body = (
    <>
      <div className="flex items-center justify-between gap-2">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl [&_svg]:size-4", tone)}><Icon /></span>
        {href && <ArrowUpRight className="size-4 text-muted-foreground transition group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-foreground" />}
      </div>
      <p className="mt-3 truncate text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 text-lg font-semibold leading-tight tracking-tight tabular-nums [overflow-wrap:anywhere] sm:text-xl">{value}</p>
      <div className="mt-0.5 truncate text-xs text-muted-foreground">{sub}</div>
    </>
  );
  const box = "group min-w-0 rounded-3xl border border-border/70 bg-card p-4";
  return href ? <Link href={href} className={cn(box, "transition-colors hover:border-border hover:bg-muted/30")}>{body}</Link> : <div className={box}>{body}</div>;
}

/** The accounts' colours, one each in the order the summary lists them (several accounts never share one). */
const ACCOUNT_TONES = ["oklch(0.8 0.12 82)", "oklch(0.72 0.12 230)", "oklch(0.74 0.13 160)", "oklch(0.7 0.13 300)", "oklch(0.72 0.14 25)", "oklch(0.78 0.1 120)", "oklch(0.72 0.08 200)", "oklch(0.75 0.12 340)"];

/** One guest who paid by mobile money before arriving: who, the booking and room, when it was paid — and Check in. */
async function AwaitingLine({ a, checkIn }: { a: Awaited<ReturnType<typeof paidOnlineAwaitingCheckIn>>["rows"][number]; checkIn: boolean }) {
  const t = await getT();
  // "Deluxe · 305, Standard · 306": the room type in the reader's words, the number as it is.
  const room = a.room.split(", ").map((x) => { const [type, no] = x.split(" · "); return no ? `${t(type)} · ${no}` : x; }).join(", ");
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{a.guest} <span className="font-normal text-muted-foreground">· {a.reference}</span></span>
        <span className="block truncate text-xs text-muted-foreground">{room}{a.arrival ? ` · ${t("arrives {date}", { date: t.date(a.arrival) })}` : ""} · {t("paid {time}", { time: t.dateTime(a.paidAt) })}{a.balance > 0 ? ` · ${t("{amount} still owed", { amount: formatTZS(a.balance) })}` : ` · ${t("fully paid")}`}</span>
      </span>
      <span className="text-sm font-semibold tabular-nums text-sky-300">{formatTZS(a.amount)}</span>
      {checkIn && <Link href={`/staff/check-in?id=${a.reservationId}#workspace`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted">{t("Check in")}<ArrowRight className="size-3.5" /></Link>}
    </li>
  );
}

/** One payment a customer sent from their phone: what it was for, who, when — and the amount, paid. */
async function PhonePaidLine({ r, timezone }: { r: Awaited<ReturnType<typeof onlinePayments>>[number]; timezone: string }) {
  const t = await getT();
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-2.5">
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{r.href ? <Link href={r.href} className="underline-offset-2 hover:underline">{said(t, r.what)}</Link> : said(t, r.what)}<span className="font-normal text-muted-foreground"> · {r.customer ?? t("Customer")}</span></span>
        <span className="block truncate text-xs text-muted-foreground">{t("paid {time}", { time: t.dateTime(r.paidAt ?? r.at, timezone) })} · {r.by === "Customer, online" ? t("from the customer's phone") : t("sent by {name}", { name: r.by === "Staff" ? t("Staff") : r.by })}</span>
      </span>
      <span className="text-sm font-semibold tabular-nums text-emerald-300">{formatTZS(r.amount)}</span>
      <span className="rounded-full bg-emerald-500/12 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">{t("Paid")}</span>
    </li>
  );
}

