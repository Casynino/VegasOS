import Link from "next/link";
import { Banknote, BedDouble, Bike, ChevronDown, ChevronRight, CreditCard, Landmark, Receipt, ShoppingBag, Smartphone, Store, UtensilsCrossed, Wallet } from "lucide-react";
import type { CollectionRow, CollectionStatus, PlaceKind, ToCollectRow } from "@/server/services/collections";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { msg } from "@/i18n/msg";
import { getT } from "@/i18n/server";
import { englishT, type T } from "@/i18n/translate";
import { ConfirmOnlineButton, ConfirmPaymentButton, NotReceivedButton } from "./confirm-payment-button";

/**
 * The lines of the Collections page — every payment and every order still to collect, each one
 * saying plainly where (table, room, counter, take away), who served it, who recorded the money,
 * who brought it, how and into which account, and where it stands.
 */

export const STATUS: Record<CollectionStatus, { label: string; tone: string }> = {
  COLLECTED: { label: msg("Paid"), tone: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  TO_CONFIRM: { label: msg("To confirm"), tone: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  REVERSED: { label: msg("Reversed"), tone: "bg-rose-500/12 text-rose-700 dark:text-rose-300" },
};
const REFUND = { label: msg("Refund"), tone: "bg-sky-500/12 text-sky-700 dark:text-sky-300" };
const ONLINE = { label: msg("Paid by phone"), tone: "bg-sky-500/12 text-sky-700 dark:text-sky-300" };
const NOT_RECEIVED = { label: msg("Not received"), tone: "bg-rose-500/12 text-rose-700 dark:text-rose-300" };
/** An online payment the Counter (or reception) may still say never arrived: the order can still be declined. */
const DECLINABLE = ["PENDING", "ACCEPTED", "PREPARING"];

/**
 * A place or a "what" the services say in English ("Room 305", "Order #19", "Booking VLH-…", "Front desk") — in the
 * reader's words. Display only: anything else (a typed description, a name) is shown as it is; `configured` also
 * looks up the hotel's own labels (a location's name).
 */
const SAID = new Set(["Room service", "Take away", "Pickup", "Restaurant", "Front desk", "Payment", "Sale", "Transport", "Rooms & bills", "Invoices", "Staff"]);
export function said(t: T, v: string, configured = false): string {
  if (SAID.has(v)) return t(v);
  let m: RegExpMatchArray | null;
  if ((m = v.match(/^Room ([0-9][0-9A-Za-z, -]*)$/))) return t("Room {number}", { number: m[1] });
  if ((m = v.match(/^Table (\d+)$/))) return t("Table {table}", { table: m[1] });
  if ((m = v.match(/^Orders? (#\d+(?:, #\d+)*)$/))) return m[1].includes(",") ? t("Orders {numbers}", { numbers: m[1] }) : t("Order {number}", { number: m[1] });
  if ((m = v.match(/^Booking (\S+)$/))) return t("Booking {reference}", { reference: m[1] });
  if ((m = v.match(/^Meeting room (\S+)$/))) return t("Meeting room {reference}", { reference: m[1] });
  if ((m = v.match(/^Invoice (\S+)$/))) return t("Invoice {number}", { number: m[1] });
  if ((m = v.match(/^Trip (\S+)$/))) return t("Trip {reference}", { reference: m[1] });
  if ((m = v.match(/^Take away · (.+)$/))) return t("Take away · {address}", { address: m[1] });
  return configured ? t(v) : v;
}
/** Who recorded or brought the money: a person's name as it is; the Counter, "You" and "Paid by phone" in the reader's words. */
const who = (t: T, v: string) => (v === "Restaurant Counter" || v === "Paid by phone" || v === "You" ? t(v) : v);

const PLACE_ICON: Record<PlaceKind, typeof Store> = {
  TABLE: UtensilsCrossed, COUNTER: Store, ROOM: BedDouble, TAKEAWAY: Bike, PICKUP: ShoppingBag, RESTAURANT: UtensilsCrossed,
};

/** Where: an icon for the kind of place, and its name ("Table 4 — Inside", "Room 305"). */
function Place({ kind, children, className }: { kind: PlaceKind | "STAY" | "SALE" | null; children: React.ReactNode; className?: string }) {
  const Icon = kind === "STAY" ? BedDouble : kind === "SALE" || !kind ? Receipt : PLACE_ICON[kind];
  return (
    <span className={cn("inline-flex min-w-0 items-center gap-1 font-medium", className)}>
      <Icon className="size-3.5 shrink-0 text-[oklch(0.62_0.11_80)] dark:text-[oklch(0.8_0.11_82)]" />
      <span className="truncate">{children}</span>
    </span>
  );
}

/** How a payment came in, as an icon on a tinted chip: cash, mobile money, card, bank. */
const HOW_TONE = (how: string) => /cash/i.test(how) ? "bg-emerald-500/12 text-emerald-300" : /card/i.test(how) ? "bg-violet-500/12 text-violet-300" : /bank/i.test(how) ? "bg-amber-500/12 text-amber-300" : /mobile/i.test(how) ? "bg-sky-500/12 text-sky-300" : "bg-muted text-muted-foreground";
function HowIcon({ how }: { how: string }) {
  const Icon = /cash/i.test(how) ? Banknote : /card/i.test(how) ? CreditCard : /bank/i.test(how) ? Landmark : /mobile/i.test(how) ? Smartphone : Wallet;
  return <Icon />;
}

/** The column names above the payment lines (wide screens only). */
/** The line's columns on a computer — with "Served by" only when waiters are on the list (restaurant payments). */
const COLS_WAITER = "lg:grid-cols-[3.25rem_minmax(0,1.5fr)_minmax(0,0.8fr)_minmax(0,1fr)_minmax(0,1.1fr)_8.5rem_1rem]";
const COLS_PLAIN = "lg:grid-cols-[3.25rem_minmax(0,1.7fr)_minmax(0,1fr)_minmax(0,1.1fr)_8.5rem_1rem]";
// Staff on their own shift: no "Collected by" column (it is always them).
const COLS_WAITER_MINE = "lg:grid-cols-[3.25rem_minmax(0,1.7fr)_minmax(0,0.9fr)_minmax(0,1.1fr)_8.5rem_1rem]";
const COLS_PLAIN_MINE = "lg:grid-cols-[3.25rem_minmax(0,2fr)_minmax(0,1.1fr)_8.5rem_1rem]";
const SOURCE_TONE: Record<string, string> = {
  ROOMS: "bg-sky-500/15 text-sky-700 dark:text-sky-300", RESTAURANT: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", SALES: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
};
const cols = (waiters: boolean, collector: boolean) => (collector ? (waiters ? COLS_WAITER : COLS_PLAIN) : waiters ? COLS_WAITER_MINE : COLS_PLAIN_MINE);

export async function PaymentColumns({ waiters = true, collector = true }: { waiters?: boolean; /** The "Collected by" column (not on a person's own shift). */ collector?: boolean }) {
  const t = await getT();
  return (
    <div className={cn("hidden gap-x-3 px-4 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground lg:grid", cols(waiters, collector))}>
      <span>{t("Time")}</span><span>{waiters ? t("Order · place · customer") : t("For · room · customer")}</span>{waiters && <span>{t("Served by")}</span>}{collector && <span>{t("Collected by")}</span>}<span>{t("Paid into")}</span><span className="text-right">{t("Amount")}</span><span />
    </div>
  );
}

/** One labelled fact on a line: "Served by Asha". */
function Fact({ k, v, quiet }: { k: string; v: React.ReactNode; quiet?: boolean }) {
  return (
    <span className="min-w-0 max-w-full [overflow-wrap:anywhere]">
      <span className="text-muted-foreground">{k} </span>
      <span className={cn("font-medium", quiet ? "text-muted-foreground" : "text-foreground/90")}>{v}</span>
    </span>
  );
}

function Row({ k, v }: { k: string; v: React.ReactNode }) {
  return <div className="flex gap-2"><dt className="w-28 shrink-0 text-muted-foreground">{k}</dt><dd className="min-w-0">{v}</dd></div>;
}

/** 7 → "7 min", 75 → "1 h 15", 1126 → "18 h", 3000 → "2 days". */
export const openFor = (min: number, t: T = englishT) => (min < 1 ? t("just now") : min < 60 ? t("{min} min", { min }) : min < 600 ? t("{h} h {m}", { h: Math.floor(min / 60), m: String(min % 60).padStart(2, "0") }) : min < 2880 ? t("{h} h", { h: Math.round(min / 60) }) : t("{n} days", { n: Math.round(min / 1440) }));

/**
 * One payment: the line (time · order · place · customer, then served by · recorded by · brought by ·
 * method · account · reference, the status and the amount) and — opened — everything it relates to.
 * `confirm` puts a Confirm button on a payment waiting for confirmation.
 */
export async function PaymentRow({ r, meId, confirm, waiters = true, collector = true }: { r: CollectionRow; meId: string; confirm: boolean; /** Show the "Served by" column (restaurant payments on the list). */ waiters?: boolean; /** Show who collected it (not on a person's own shift — it is them). */ collector?: boolean }) {
  const t = await getT();
  const s = r.notReceived ? NOT_RECEIVED : r.status === "REVERSED" ? STATUS.REVERSED : r.refund ? REFUND : r.online && r.status === "COLLECTED" ? ONLINE : STATUS[r.status];
  const notReceivable = confirm && r.online && r.status === "COLLECTED" && !!r.orderId && DECLINABLE.includes(r.order?.status ?? "");
  const restaurant = r.source === "RESTAURANT";
  const recordedBy = r.online ? r.recordedBy : r.atCounter ? "Restaurant Counter" : r.collectorId === meId ? "You" : r.paidOnline && !r.paidOnline.creditedTo ? "Paid by phone" : r.recordedBy;
  const placeKind = restaurant ? r.placeKind : r.stay ? "STAY" : "SALE";
  return (
    <li>
      <details className="group">
        <summary className={cn("grid cursor-pointer list-none grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-muted/25 [&::-webkit-details-marker]:hidden", cols(waiters, collector))}>
          {/* Time, with how it was paid */}
          <span className="flex items-center gap-2.5 lg:block">
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl lg:hidden [&_svg]:size-4", HOW_TONE(r.how))}><HowIcon how={r.how} /></span>
            <span className="hidden text-xs tabular-nums text-muted-foreground lg:block">{t.time(r.at)}</span>
          </span>
          {/* What and where */}
          <span className="min-w-0">
            <span className="flex min-w-0 items-center gap-2 text-sm">
              {/* Hotel or restaurant money — at a glance */}
              <span className={cn("shrink-0 rounded-md px-1.5 py-px text-[10px] font-bold uppercase tracking-wider", SOURCE_TONE[r.source])}>{r.source === "ROOMS" ? t("Hotel") : r.source === "RESTAURANT" ? t("Restaurant") : t("Sale")}</span>
              {r.href
                ? <Link href={r.href} className={cn("font-semibold underline-offset-2 hover:underline", r.orderNo ? "shrink-0" : "min-w-0 truncate")}>{r.orderNo ? t("Order {number}", { number: r.orderNo }) : said(t, r.what)}</Link>
                : <span className="min-w-0 truncate font-semibold">{said(t, r.what)}</span>}
              <Place kind={placeKind} className="min-w-0">{said(t, r.place, restaurant)}</Place>
            </span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">
              <span className="lg:hidden">{t.time(r.at)} · </span>{r.customer ?? t("Customer")}
              <span className="lg:hidden">{restaurant ? ` · ${t("served by {name}", { name: r.servedBy ?? t("no waiter") })}` : ""} · {t(r.account)}</span>
            </span>
          </span>
          {/* Served by (restaurant only) */}
          {waiters && <span className="hidden min-w-0 truncate text-sm lg:block">{restaurant ? (r.servedBy ? r.servedBy : <span className="text-muted-foreground">{t("No waiter")}</span>) : <span className="text-muted-foreground">—</span>}</span>}
          {/* Collected by (and who brought it) — paid online: nobody typed it in */}
          {collector && (
            <span className="hidden min-w-0 leading-tight lg:block">
              <span className={cn("block truncate text-sm", recordedBy === "You" && "font-semibold")}>{r.online && !r.atCounter ? t("Paid by phone") : who(t, recordedBy)}</span>
              {r.broughtBy && <span className="block truncate text-[11px] text-muted-foreground">{t("brought by {name}", { name: r.broughtBy })}</span>}
              {r.paidOnline && <span className="block truncate text-[11px] text-sky-300">{r.paidOnline.creditedTo ? t("paid by phone · counted at check-in") : r.paidOnline.waiting ? t("not checked in yet") : t("by the guest, online")}</span>}
            </span>
          )}
          {/* How, into which account */}
          <span className="hidden min-w-0 items-center gap-2.5 lg:flex">
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl [&_svg]:size-3.5", HOW_TONE(r.how))}><HowIcon how={r.how} /></span>
            <span className="min-w-0 leading-tight">
              <span className="block truncate text-sm">{t(r.account)}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{t(r.method)}{r.reference ? ` · ${t("ref {reference}", { reference: r.reference })}` : ""}</span>
            </span>
          </span>
          {/* Amount, where it stands, and the one thing to do */}
          <span className="flex flex-col items-end gap-1">
            <span className={cn("text-sm font-semibold tabular-nums", r.status === "REVERSED" && "text-muted-foreground line-through", r.refund && "text-sky-700 dark:text-sky-300")}>{formatTZS(r.amount)}</span>
            <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold", s.tone)}>{t(s.label)}</span>
            {confirm && r.status === "TO_CONFIRM" && restaurant && <ConfirmPaymentButton paymentId={r.id} label={`${formatTZS(r.amount)} · ${r.orderNo ?? said(t, r.what)}`} />}
            {notReceivable && <NotReceivedButton orderId={r.orderId!} label={`${formatTZS(r.amount)} · ${t("Order {number}", { number: r.orderNo })}`} account={t(r.account)} />}
          </span>
          <ChevronDown className="hidden size-4 shrink-0 text-muted-foreground transition group-open:rotate-180 lg:block" />
        </summary>
        <div className="grid gap-3 border-t border-border/50 bg-muted/20 px-4 py-3 text-xs sm:grid-cols-2">
          <dl className="space-y-1">
            <Row k={t("For")} v={r.href ? <Link href={r.href} className="font-medium underline-offset-2 hover:underline">{r.orderNo ? t("Order {number}", { number: r.orderNo }) : r.stay?.reference ?? said(t, r.what)}</Link> : said(t, r.what)} />
            <Row k={restaurant ? t("Place") : r.stay ? t("Room") : t("Place")} v={said(t, r.place, restaurant)} />
            {r.order?.visit && <Row k={t("Table visit")} v={r.order.visit} />}
            <Row k={t("Customer")} v={r.customer ? `${r.customer}${r.order?.phone ? ` · ${r.order.phone}` : ""}` : r.order?.phone ?? "—"} />
            {restaurant && <Row k={t("Served by")} v={r.servedByFull ?? t("No waiter")} />}
            {r.order && <Row k={t("Order total")} v={`${formatTZS(r.order.total)} · ${r.order.due ? t("{amount} still to pay", { amount: formatTZS(r.order.due) }) : t("nothing left to pay")}`} />}
            {r.stay && <Row k={t("Bill")} v={`${formatTZS(r.stay.net)} · ${r.stay.balance > 0 ? t("{amount} still owed", { amount: formatTZS(r.stay.balance) }) : t("settled")}`} />}
            <Row k={t("This payment")} v={`${formatTZS(r.amount)}${r.fee ? ` ${t("(incl. room-service fee {fee})", { fee: formatTZS(r.fee) })}` : ""} · ${t(r.method)} · ${t(r.account)}${r.reference ? ` · ${t("ref {reference}", { reference: r.reference })}` : ""}`} />
            {r.paidOnline
              ? <Row k={t("Paid")} v={`${t("By the guest, from their phone (mobile money)")} · ${t.dateTime(r.paidOnline.paidAt)}${r.paidOnline.creditedTo ? ` — ${t("counted for {name} at check-in", { name: r.paidOnline.creditedToId === meId ? t("you") : r.paidOnline.creditedTo })}${r.paidOnline.creditedAt ? ` · ${t.dateTime(r.paidOnline.creditedAt)}` : ""}` : r.paidOnline.waiting ? ` — ${t("not checked in yet: it counts for whoever checks them in")}` : ""}`} />
              : r.online
              ? <Row k={collector ? t("Collected by") : t("Paid")} v={`${collector ? t("The customer paid from their phone — recorded by itself") : t("Paid by phone")} · ${t.date(r.day)} ${t.time(r.at)}`} />
              : !collector
              ? <Row k={t("Time")} v={`${t.date(r.day)} ${t.time(r.at)}`} />
              : r.atCounter
              ? <Row k={t("Collected by")} v={`${t("Restaurant Counter")} · ${t.date(r.day)} ${t.time(r.at)}`} />
              : <Row k={t("Collected by")} v={`${who(t, r.recordedBy)}${r.role ? ` (${t(r.role)})` : ""} · ${t.date(r.day)} ${t.time(r.at)}`} />}
            {r.broughtBy && <Row k={t("Brought by")} v={r.broughtBy} />}
            {r.status === "COLLECTED" && r.confirmedBy && r.confirmedAt !== r.at && <Row k={t("Confirmed by")} v={`${r.confirmedBy}${r.confirmedAt ? ` · ${t.time(r.confirmedAt)}` : ""}`} />}
            {r.status === "TO_CONFIRM" && <Row k={t("Confirmation")} v={t("Waiting — not counted as paid until confirmed")} />}
            {r.status === "REVERSED" && <Row k={t("Reversed")} v={`${r.reversedBy ? t("by {name}", { name: r.reversedBy }) : ""}${r.reversedAt ? ` · ${t.dateTime(r.reversedAt)}` : ""}${r.reverseReason ? ` — ${r.reverseReason}` : ""}`} />}
          </dl>
          {r.order ? (
            <div className="space-y-2">
              <ul className="space-y-0.5">
                {r.order.items.map((i, n) => <li key={n} className="flex justify-between gap-2"><span className="truncate">{i.qty} × {t(i.name)}</span><span className="tabular-nums text-muted-foreground">{i.total.toLocaleString("en-US")}</span></li>)}
              </ul>
              {r.order.payments.length > 1 && (
                <div className="rounded-xl border border-border/60 p-2">
                  <p className="mb-1 font-semibold text-muted-foreground">{t("Payments on this order")}</p>
                  {r.order.payments.map((x) => (
                    <p key={x.id} className={cn("flex justify-between gap-2", x.reversed && "text-muted-foreground line-through", x.id === r.id && "font-semibold")}>
                      <span>{t.time(x.at)}{collector ? ` · ${who(t, x.by)}` : ""}</span><span className="tabular-nums">{x.amount.toLocaleString("en-US")}</span>
                    </p>
                  ))}
                </div>
              )}
            </div>
          ) : r.stay ? (
            <dl className="space-y-1">
              <Row k={t("Booking")} v={r.stay.reference} />
              <Row k={t("Guest")} v={r.stay.company ? `${r.stay.guest} · ${r.stay.company}` : r.stay.guest} />
              {r.stay.rooms && <Row k={t("Rooms")} v={r.stay.rooms} />}
            </dl>
          ) : null}
        </div>
      </details>
    </li>
  );
}

/**
 * One order still to pay: when it came in and how long it has been open · order · place · customer,
 * then served by · where it stands · total · paid — and what is still due. Paid online (a proof was
 * sent): "Paid online · to confirm", never "to collect". The whole line opens the order.
 */
export async function ToCollectLine({ r, today }: { r: ToCollectRow; today: string }) {
  const t = await getT();
  return (
    <li>
      <Link href={r.href} className="group flex items-start gap-3 px-4 py-3 transition-colors hover:bg-muted/30">
        <span className="w-14 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
          <span className="block">{r.day === today ? t.time(r.createdAt) : t.dateTime(r.createdAt)}</span>
          <span className="block text-[10.5px]">{openFor(r.minutes, t)}</span>
        </span>
        <span className="min-w-0 flex-1 space-y-1">
          <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
            <span className="font-semibold group-hover:underline">{t("Order {number}", { number: r.orderNo })}</span>
            <Place kind={r.placeKind}>{said(t, r.place, true)}</Place>
            {r.customer && <span className="min-w-0 truncate text-muted-foreground">· {r.customer}</span>}
          </span>
          <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] leading-relaxed">
            <Fact k={t("Served by")} v={r.servedBy ?? t("No waiter")} quiet={!r.servedBy} />
            <Fact k={t("Now")} v={t(r.step)} />
            <Fact k={t("Total")} v={formatTZS(r.total)} />
            {r.paid > 0 && <Fact k={t("Paid")} v={formatTZS(r.paid)} />}
            {r.online && <Fact k={t("Paid online to")} v={`${r.online.account ? t(r.online.account) : t("an account")}${r.online.reference ? ` · ${t("ref {reference}", { reference: r.online.reference })}` : ""}`} />}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className={cn("text-sm font-semibold tabular-nums", r.online ? "text-sky-700 dark:text-sky-300" : "text-amber-700 dark:text-amber-300")}>{formatTZS(r.due)}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold", r.online ? "bg-sky-500/12 text-sky-700 dark:text-sky-300" : "bg-amber-500/15 text-amber-800 dark:text-amber-300")}>
            {r.online ? t("Paid online · to confirm") : t("To collect")}
          </span>
        </span>
        <ChevronRight className="mt-0.5 size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5" />
      </Link>
    </li>
  );
}

/**
 * One order the customer paid online (LIPA), waiting for the check: when they paid · order · place ·
 * customer, then served by · paid to which account · their code, the amount — and Confirm (the Counter,
 * reception) once the money is seen in the account. A new order is accepted only after that.
 */
export async function OnlineLine({ r, today, confirm }: { r: ToCollectRow; today: string; confirm: boolean }) {
  const t = await getT();
  const paidAt = r.online?.at ?? r.createdAt;
  return (
    <li className="flex items-start gap-3 px-4 py-3">
      <span className="w-14 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">
        <span className="block">{r.day === today ? t.time(paidAt) : t.dateTime(paidAt)}</span>
        <span className="block text-[10.5px]">{openFor(r.minutes, t)}</span>
      </span>
      <span className="min-w-0 flex-1 space-y-1">
        <span className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <Link href={r.href} className="font-semibold underline-offset-2 hover:underline">{t("Order {number}", { number: r.orderNo })}</Link>
          <Place kind={r.placeKind}>{said(t, r.place, true)}</Place>
          {r.customer && <span className="min-w-0 truncate text-muted-foreground">· {r.customer}</span>}
        </span>
        <span className="flex flex-wrap gap-x-3 gap-y-0.5 text-[11.5px] leading-relaxed">
          <Fact k={t("Served by")} v={r.servedBy ?? t("No waiter yet")} quiet={!r.servedBy} />
          <Fact k={t("Paid to")} v={r.online?.account ? t(r.online.account) : t("not said")} quiet={!r.online?.account} />
          <Fact k={t("Ref")} v={r.online?.reference ?? "—"} quiet={!r.online?.reference} />
          <Fact k={t("Order")} v={r.status === "PENDING" ? t("waits for this check") : t(r.step)} />
          {r.online && <a href={r.online.proofUrl} target="_blank" rel="noreferrer" className="font-medium text-sky-700 underline-offset-2 hover:underline dark:text-sky-300">{t("View proof")}</a>}
        </span>
      </span>
      <span className="flex shrink-0 flex-col items-end gap-1">
        <span className="text-sm font-semibold tabular-nums text-sky-700 dark:text-sky-300">{formatTZS(r.due)}</span>
        <span className="rounded-full bg-sky-500/12 px-2 py-0.5 text-[10.5px] font-semibold text-sky-700 dark:text-sky-300">{t("Paid online · to check")}</span>
        {confirm && r.online?.accountId && <ConfirmOnlineButton orderId={r.id} accountId={r.online.accountId} reference={r.online.reference} label={`${formatTZS(r.due)} · ${t("Order {number}", { number: r.orderNo })}`} />}
      </span>
    </li>
  );
}
