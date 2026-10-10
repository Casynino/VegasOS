"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { createPortal } from "react-dom";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { KnownCustomerNote, useKnownCustomer } from "@/components/staff/known-customer";
import { CustomerFinder } from "@/components/staff/customer-finder";
import { motion } from "motion/react";
import {
  ArrowRightLeft, BedDouble, BellRing, CalendarClock, CalendarPlus, Check, ChevronRight, CircleMinus, Clock, Download, ExternalLink, FileDown, HandCoins, HandPlatter, History, House, Loader2, Lock, Minus, Phone, Plus, Power, Printer,
  QrCode, Receipt, RefreshCw, ShoppingBag, Store, TreePalm, UserPlus, UserRoundCheck, UserX, Users, UtensilsCrossed, Wallet, X,
} from "lucide-react";
import { QrPrintCard as PrintCard, saveFile as save, snapQrCard as snap, type Printable } from "@/components/staff/qr/qr-print-card";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { jpegFromDataUrl, jpegsToPdf } from "@/lib/jpeg-pdf";
import type { PayAccount } from "@/lib/pay-account";
import { cn } from "@/lib/utils";
import type { FloorPlace, SessionOrder, SessionView, TableStay } from "@/server/services/dining-sessions";
import { payBillAction, regenerateLocationQrAction, setLocationQrActiveAction } from "../actions";
import { RemoveItemDialog } from "@/components/staff/remove-item-dialog";
import { BlockedBody, TableAvailability, TableSetupButtons, TableWaiter } from "./table-setup";
import { ChangeWhoPays, ChargeTableToRoom, onRoomBill, roomBill, roomsOnBill, stayRooms } from "./room-billing";
import { BillDiscount } from "@/components/staff/manager-decisions";
import { AccountPicker } from "../portal/order-card";
import { useLiveOrders } from "@/components/staff/sounds";
import { useIsRestaurantDevice, useWaiterPin, type WaiterPinValue } from "@/components/staff/waiter-pin";
import { TransferDialog } from "@/components/staff/transfer-dialog";
import { BroughtBySelect } from "@/components/staff/brought-by-select";
import { OtherWays, SendToPhone } from "@/components/staff/mobile-pay";
import { takeTableAction, transferTableAction } from "../waiter-actions";
import { type HotelGuest, ReservationDialog, type TableOption } from "../reservations/reservation-form";
import {
  addMemberAction, closeSessionAction, moveSessionAction, requestBillAction, seatCustomerAction, seatReservationAction, sessionDetailAction, setGuestsAction, tableHistoryAction,
  takeSessionPaymentAction,
} from "./actions";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";
import { orderItemName } from "@/i18n/content";
import { englishT, type T } from "@/i18n/translate";

export type TablePlace = Omit<FloorPlace, "qrToken"> & { url: string; qr: string };
type Line = SessionOrder["items"][number];
type Can = {
  take: boolean; add: boolean; remove: boolean; void: boolean; seat: boolean; pay: boolean; /** Managers, the MD, the owner: discounts on a bill. */ decide?: boolean;
  /** Waiters and reception: put the table's bill on the customer's own room. */
  room?: boolean;
  /** Reception, managers, the MD: check who is staying — another guest's room, and change who pays an order (with the reason). */
  stays?: boolean;
  /** A waiter (or the shared screen, with the PIN): take charge of a table nobody has. */
  charge?: boolean;
  /** Transfer a table to a colleague: "own" — only the viewer's own tables (a waiter); "any" — the shared screen (the PIN says who) and managers. */
  hand?: "own" | "any";
};

const noop = () => () => {};
const tick = (cb: () => void) => { const t = setInterval(cb, 30_000); return () => clearInterval(t); };
const AREA: Record<string, string> = { INSIDE: msg("Inside"), OUTSIDE: msg("Outside") };
const STATUS: Record<string, { label: string; tone: string }> = {
  PENDING: { label: msg("New"), tone: "bg-sky-500/15 text-sky-300" }, ACCEPTED: { label: msg("Accepted"), tone: "bg-amber-500/15 text-amber-300" },
  PREPARING: { label: msg("Preparing"), tone: "bg-amber-500/15 text-amber-300" }, READY: { label: msg("Ready to serve"), tone: "bg-emerald-500/15 text-emerald-300" },
  OUT_FOR_DELIVERY: { label: msg("Serving"), tone: "bg-violet-500/15 text-violet-300" }, DELIVERED: { label: msg("Served"), tone: "bg-teal-500/15 text-teal-300" },
  COMPLETED: { label: msg("Done"), tone: "bg-muted text-muted-foreground" }, COLLECTED: { label: msg("Done"), tone: "bg-muted text-muted-foreground" }, CANCELLED: { label: msg("Cancelled"), tone: "bg-rose-500/12 text-rose-300" },
};
const ADDABLE = ["PENDING", "ACCEPTED", "PREPARING", "DELIVERED"];
const clock = (t: T, iso: string) => new Date(iso).toLocaleTimeString(t.intl, { hour: "2-digit", minute: "2-digit" });
const dayClock = (t: T, iso: string) => new Date(iso).toLocaleString(t.intl, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const tzs = (v: number) => `TZS ${v.toLocaleString("en-US")}`;
const num = (v: number) => v.toLocaleString("en-US");
const shortNo = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;
const sessNo = (n: string) => `#${n.replace(/^TS-\d{4}-0*/, "")}`;
const people = (t: T, n: number) => t.plural(n, "{n} person", "{n} people");
const shortName = (name: string) => { const [f, ...r] = name.trim().split(/\s+/); return r.length ? `${f} ${r[0].charAt(0)}.` : f; };
const firstName = (name: string) => name.replace(/\s*\(.*\)/, "").trim().split(/\s+/)[0];
/** "Table 3", "Counter", "Restaurant" — in the reader's language (English for the printed QR card). */
const title = (c: TablePlace, t: T = englishT) => (c.kind === "TABLE" ? t("Table {table}", { table: String(c.number) }) : c.kind === "COUNTER" ? t("Counter") : t("Restaurant"));
const areaName = (t: T, area: string) => (AREA[area] ? t(AREA[area]) : area);
const placeName = (c: TablePlace, t: T) => (c.kind === "MAIN" ? t("Restaurant QR") : `${title(c, t)}${c.area ? ` · ${areaName(t, c.area)}` : ""}`);
const printable = (c: TablePlace): Printable => ({
  id: c.id, kind: c.kind === "TABLE" ? "table" : c.kind === "COUNTER" ? "counter" : "restaurant",
  title: title(c), area: c.area ? AREA[c.area] : undefined, url: c.url, qr: c.qr,
});
/** "12 min", "1 h 05" */
const since = (t: T, iso: string | null, nowMin: number) => {
  if (!iso || !nowMin) return null;
  const m = Math.max(0, nowMin - Math.floor(new Date(iso).getTime() / 60000));
  return m < 60 ? t("{n} min", { n: m }) : t("{h} h {m}", { h: Math.floor(m / 60), m: String(m % 60).padStart(2, "0") });
};

/** What a table is doing — the floor's colours. */
type TState = "free" | "reserved" | "seated" | "ordering" | "bill" | "paid" | "blocked";
const STATE: Record<TState, { label: string; pill: string; dot: string; tile: string; chair: string; table: string; num: string }> = {
  free: { label: msg("Free"), pill: "bg-muted/70 text-muted-foreground", dot: "bg-muted-foreground/50", tile: "border-border/60 bg-card/80 hover:border-foreground/20", chair: "fill-muted-foreground/25 group-hover:fill-muted-foreground/40", table: "fill-white/[0.035] stroke-white/15 group-hover:stroke-white/25", num: "text-foreground/85" },
  reserved: { label: msg("Reserved"), pill: "bg-violet-500/15 text-violet-300", dot: "bg-violet-400", tile: "border-violet-500/40 bg-linear-to-b from-violet-500/[0.09] to-card/80", chair: "fill-violet-400/55", table: "fill-violet-500/10 stroke-violet-400/55", num: "text-violet-100" },
  seated: { label: msg("Seated"), pill: "bg-sky-500/15 text-sky-300", dot: "bg-sky-400", tile: "border-sky-500/40 bg-linear-to-b from-sky-500/[0.09] to-card/80", chair: "fill-sky-400/70", table: "fill-sky-500/12 stroke-sky-400/55", num: "text-sky-100" },
  ordering: { label: msg("Ordering"), pill: "bg-emerald-500/15 text-emerald-300", dot: "bg-emerald-400", tile: "border-emerald-500/40 bg-linear-to-b from-emerald-500/[0.10] to-card/80", chair: "fill-emerald-400/75", table: "fill-emerald-500/15 stroke-emerald-400/60", num: "text-emerald-100" },
  bill: { label: msg("Bill asked"), pill: "bg-amber-500/15 text-amber-300", dot: "bg-amber-400", tile: "border-amber-500/50 bg-linear-to-b from-amber-500/[0.12] to-card/80", chair: "fill-amber-400/75", table: "fill-amber-500/15 stroke-amber-400/60", num: "text-amber-100" },
  paid: { label: msg("Paid · clear table"), pill: "bg-teal-500/15 text-teal-300", dot: "bg-teal-400", tile: "border-teal-500/40 bg-linear-to-b from-teal-500/[0.09] to-card/80", chair: "fill-teal-400/70", table: "fill-teal-500/12 stroke-teal-400/55", num: "text-teal-100" },
  // A manager blocked it for now: not available / under maintenance.
  blocked: { label: msg("Not available"), pill: "bg-amber-500/12 text-amber-300", dot: "bg-amber-500", tile: "border-dashed border-amber-500/40 bg-card/60", chair: "fill-amber-400/20", table: "fill-amber-500/[0.06] stroke-amber-400/40", num: "text-amber-100/70" },
};
function stateOf(p: TablePlace): TState {
  const s = p.session;
  if (s) return s.status === "PAID" || (s.status === "AWAITING_PAYMENT" && s.money.due === 0) ? "paid" : s.status === "AWAITING_PAYMENT" ? "bill" : s.money.orders ? "ordering" : "seated";
  if (p.loose.length) return "ordering";
  if (p.blocked) return "blocked";
  if (p.next?.holding) return "reserved";
  return "free";
}
/** One person's open orders together (the counter: many customers at once, each with their own orders and bill). */
type Person = { key: string; name: string; phone: string | null; orders: SessionOrder[]; total: number; due: number; since: string };
function peopleOf(orders: SessionOrder[], unnamed: string): Person[] {
  const m = new Map<string, Person>();
  for (const o of orders) {
    const p = m.get(o.customerKey) ?? { key: o.customerKey, name: o.customer ?? unnamed, phone: o.phone, orders: [], total: 0, due: 0, since: o.at };
    p.orders.push(o); p.total += o.total; p.due += o.due;
    m.set(o.customerKey, p);
  }
  return [...m.values()];
}
type Waiter = { id: string; name: string };
/** Who serves a table now: the customer's own waiter (their session) first, else the table's waiter. */
const servedBy = (p: TablePlace): Waiter | null => (p.session ? p.session.waiter ?? p.waiter : p.waiter);
const dueOf = (p: TablePlace) => (p.session ? p.session.money.due : p.loose.reduce((t, o) => t + o.due, 0));
const busy = (p: TablePlace) => !!p.session || p.loose.length > 0;
/** Nothing left to pay: "Paid", "On the room" — or both. Room money is never called paid. */
const settledWord = (m: { paid: number; onRoom: number }) => (m.onRoom ? (m.paid ? msg("Paid · rest on the room") : msg("On the room")) : msg("Paid"));
/** What orders not in a session paid, and what went on a room bill. */
const looseMoney = (orders: SessionOrder[]) => ({ paid: orders.reduce((t, o) => t + o.paid, 0), onRoom: orders.reduce((t, o) => t + (o.onRoom && o.status !== "CANCELLED" ? o.total : 0), 0) });
/** The customer's room at the table: a small chip — "Room 305". */
function RoomChip({ stays, className }: { stays: TableStay[]; className?: string }) {
  const t = useT();
  return <span className={cn("inline-flex shrink-0 items-center gap-0.5 rounded-full bg-violet-500/15 px-1.5 py-px text-[10.5px] font-semibold text-violet-300", className)}><BedDouble className="size-3" />{t("Room {room}", { room: stayRooms(stays) })}</span>;
}
/** Who serves the table: "Waiter · Nino" (green when it is you) — or "No waiter yet". `dark` for the table window's header. */
function WaiterChip({ w, mine, dark, className }: { w: Waiter | null; mine?: boolean; dark?: boolean; className?: string }) {
  const t = useT();
  const tone = !w ? (dark ? "bg-amber-400/15 text-amber-200 ring-1 ring-amber-300/20" : "bg-amber-500/12 text-amber-300")
    : mine ? (dark ? "bg-emerald-400/15 text-emerald-200 ring-1 ring-emerald-300/20" : "bg-emerald-500/15 text-emerald-300")
    : dark ? "bg-white/10 text-white/80 ring-1 ring-white/15" : "bg-muted/70 text-foreground/80";
  return (
    <span title={w ? (mine ? t("{name} serves this table (you)", { name: w.name }) : t("{name} serves this table", { name: w.name })) : t("Nobody is serving this table yet")}
      className={cn("inline-flex min-w-0 max-w-full items-center gap-1 rounded-full px-1.5 py-px text-[10.5px] font-semibold", tone, className)}>
      {w ? <UserRoundCheck className="size-3 shrink-0" /> : <HandPlatter className="size-3 shrink-0" />}
      <span className="truncate">{w ? t("Waiter · {name}", { name: firstName(w.name) }) : t("No waiter yet")}</span>
    </span>
  );
}

/**
 * THE RESTAURANT FLOOR — every table drawn as a table, coloured by what it is doing: free,
 * reserved, seated, ordering, bill asked, paid. Tap a table to open it: the customer, their whole
 * bill (every order), add or take off items, move them, take the payment, close the table — or
 * seat someone / reserve it; and its QR card. Updates by itself within seconds.
 */
export function TablesBoard({ places, hotel, phone, canManage, canSetUp = canManage, can, accounts, today, autoPrint, autoOpen, switchedOff = [], meId = null, device = false, hotelGuests = null }: {
  places: TablePlace[]; hotel: string; phone: string | null; canManage: boolean;
  /** Reception: reserve tables only for these guests staying in the hotel. */
  hotelGuests?: HotelGuest[] | null;
  /** Managers and the MD: add tables, take them out of use, block / reopen them. */
  canSetUp?: boolean; can: Can; accounts: PayAccount[]; today: string; autoPrint?: string | null;
  /** Tables switched off (managers can switch them back on). */
  switchedOff?: { id: string; name: string }[];
  /** Opened as ?table=<id> (e.g. from the manager's home): that table's panel opens straight away. */
  autoOpen?: string | null;
  /** Who is looking — their own tables show as theirs. */
  meId?: string | null;
  /** The shared restaurant screen: nothing is "mine" here — each waiter says who they are with their ID. */
  device?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  useLiveOrders(refresh, 4000);
  const [only, setOnly] = useState<string[] | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(autoOpen ?? null);
  const [confirm, setConfirm] = useState<TablePlace | null>(null);
  const [reserving, setReserving] = useState<string | null | false>(false);
  const [pending, start] = useTransition();
  const onClient = useSyncExternalStore(noop, () => true, () => false);
  const nowMin = useSyncExternalStore(tick, () => Math.floor(Date.now() / 60000), () => 0);
  const spots = places.filter((c) => c.kind !== "MAIN");
  const main = places.find((c) => c.kind === "MAIN") ?? null;
  const tables = spots.filter((c) => c.kind === "TABLE");
  const tableOptions: TableOption[] = tables.map((x) => ({ id: x.id, name: x.name, area: x.area, number: x.number }));
  const inUse = spots.filter(busy);
  const reserved = spots.filter((c) => !busy(c) && !c.blocked && c.next?.holding).length;
  const blockedCount = spots.filter((c) => !busy(c) && c.blocked).length;
  const toCollect = spots.reduce((sum, c) => sum + dueOf(c), 0);
  const money = can.pay || spots.some((c) => (c.session?.money.total ?? 0) > 0);
  const opened = places.find((c) => c.id === openId) ?? null;
  const areas = [...new Set(spots.map((c) => c.area ?? ""))];
  const me = device ? null : meId;

  const print = (ids: string[] | null) => {
    setOnly(ids);
    const reset = () => { setOnly(null); window.removeEventListener("afterprint", reset); };
    window.addEventListener("afterprint", reset);
    setTimeout(() => window.print(), 80);
  };
  // Opened as ?print=<id> (e.g. "Print" on the restaurant QR): print that card once.
  const printed = useRef(false);
  useEffect(() => {
    if (!autoPrint || !onClient || printed.current) return;
    printed.current = true;
    const imgs = [...document.querySelectorAll("#qr-print-area img")] as HTMLImageElement[];
    void Promise.all(imgs.map((i) => i.decode().catch(() => null))).then(() => print([autoPrint]));
  }, [autoPrint, onClient]);
  const downloadOne = async (c: TablePlace) => {
    const node = document.getElementById(`qr-${c.id}`);
    if (!node) return;
    setBusyId(c.id);
    try { save(await snap(node), `${c.name.replace(/\W+/g, "-")}-QR.jpg`); } catch { toast.error(t("Could not make the image — try again.")); } finally { setBusyId(null); }
  };
  const downloadAll = async () => {
    setBusyId("all");
    try {
      const pages = [];
      for (const c of places.filter((x) => x.qrActive)) {
        const node = document.getElementById(`qr-${c.id}`);
        if (node) pages.push(await jpegFromDataUrl(await snap(node)));
      }
      const href = URL.createObjectURL(new Blob([jpegsToPdf(pages, 298)], { type: "application/pdf" }));
      save(href, "Restaurant-table-QR-cards.pdf");
      setTimeout(() => URL.revokeObjectURL(href), 10_000);
    } catch { toast.error(t("Could not make the PDF — try again.")); } finally { setBusyId(null); }
  };
  const regenerate = (c: TablePlace) => start(async () => {
    const res = await regenerateLocationQrAction({ id: c.id });
    if (res.ok) { toast.success(res.message ?? t("New QR made.")); setConfirm(null); router.refresh(); } else toast.error(res.error);
  });
  const toggle = (c: TablePlace) => start(async () => {
    const res = await setLocationQrActiveAction({ id: c.id, active: !c.qrActive });
    if (res.ok) { toast.success(res.message ?? t("Saved.")); router.refresh(); } else toast.error(res.error);
  });

  return (
    <div className="w-full space-y-4">
      <style>{`@media print { @page { size: A4; margin: 8mm; } body > *:not(#qr-print-area) { display: none !important; } #qr-print-area { position: static !important; width: auto !important; } }`}</style>

      {/* The top: one tidy card */}
      <header className="relative overflow-hidden rounded-3xl border border-border/70 bg-card">
        <div aria-hidden className="pointer-events-none absolute -right-20 -top-24 size-64 rounded-full bg-emerald-500/[0.08] blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-4 px-4 py-4 sm:px-5">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-[oklch(0.85_0.1_84)] to-[oklch(0.68_0.12_76)] text-[oklch(0.2_0.03_60)] shadow-[0_10px_24px_-14px_oklch(0.7_0.12_80)]"><UtensilsCrossed className="size-5" /></span>
          <div className="min-w-[11rem] flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[oklch(0.8_0.11_82)]">{t("Restaurant")}</p>
            <h1 className="font-display text-[26px] font-semibold leading-tight">{t("Tables")}</h1>
          </div>
          <dl className="flex items-stretch divide-x divide-border/70 rounded-2xl bg-background/40 ring-1 ring-border/60 max-sm:w-full max-sm:[&>div]:flex-1">
            {[
              { label: t("In use"), value: String(inUse.length), tone: inUse.length ? "text-emerald-300" : "text-muted-foreground/70" },
              { label: t("Reserved"), value: String(reserved), tone: reserved ? "text-violet-300" : "text-muted-foreground/70" },
              { label: t("Free"), value: String(spots.length - inUse.length - reserved - blockedCount), tone: "text-foreground" },
              ...(blockedCount ? [{ label: t("Blocked"), value: String(blockedCount), tone: "text-amber-300" }] : []),
              ...(money ? [{ label: can.pay ? t("To collect") : t("Unpaid"), value: toCollect ? `${num(Math.round(toCollect / 1000))}k` : "0", tone: toCollect ? "text-rose-300" : "text-muted-foreground/70" }] : []),
            ].map((x) => (
              <div key={x.label} className="px-3.5 py-2 text-center sm:px-4">
                <dd className={cn("text-[22px] font-semibold leading-none tabular-nums", x.tone)}>{x.value}</dd>
                <dt className="mt-1 whitespace-nowrap text-[11px] text-muted-foreground">{x.label}</dt>
              </div>
            ))}
          </dl>
        </div>
        <div className="relative flex flex-wrap items-center justify-between gap-2 border-t border-border/60 px-4 py-2.5 sm:px-5">
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
            {(["free", "reserved", "seated", "ordering", "bill", "paid"] as TState[]).map((k) => (
              <span key={k} className="inline-flex items-center gap-1.5"><span className={cn("size-2 rounded-full", STATE[k].dot)} />{t(STATE[k].label)}</span>
            ))}
          </div>
          <div className="flex flex-wrap gap-1.5">
            {can.seat && <Button size="sm" onClick={() => setReserving(null)}><CalendarPlus />{t("Reserve a table")}</Button>}
            {can.seat && <Link href="/staff/restaurant/reservations" className={buttonVariants({ size: "sm", variant: "outline" })}><CalendarClock />{t("Reservations")}</Link>}
            {canSetUp && <TableSetupButtons switchedOff={switchedOff} />}
            {main && <Button size="sm" variant="outline" onClick={() => setOpenId(main.id)}><QrCode />{t("Restaurant QR")}</Button>}
            <Button size="sm" variant="outline" onClick={() => print(places.filter((c) => c.qrActive).map((c) => c.id))}><Printer />{t("Print QR cards")}</Button>
            <Button size="sm" variant="outline" disabled={!!busyId} onClick={downloadAll}>{busyId === "all" ? <Loader2 className="animate-spin" /> : <FileDown />}{t("Download all")}</Button>
          </div>
        </div>
      </header>

      {/* The floor: one panel per area */}
      <section className={cn("grid items-stretch gap-4", areas.length > 1 && "xl:grid-cols-2")}>
        {areas.map((area) => {
          const here = spots.filter((c) => (c.area ?? "") === area);
          const tbls = here.filter((c) => c.kind === "TABLE");
          const counters = here.filter((c) => c.kind !== "TABLE");
          const busyHere = here.filter(busy).length;
          const AreaIcon = area === "OUTSIDE" ? TreePalm : House;
          return (
            <div key={area} className="relative flex flex-col overflow-hidden rounded-3xl border border-border/70 bg-card/50">
              <div aria-hidden className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.055)_1px,transparent_0)] [background-size:22px_22px]" />
              <header className="relative flex items-center gap-3 border-b border-border/60 bg-card/70 px-4 py-3">
                <span className="grid size-9 place-items-center rounded-xl bg-[oklch(0.72_0.12_80/0.14)] text-[oklch(0.84_0.11_82)] ring-1 ring-[oklch(0.72_0.12_80/0.3)]"><AreaIcon className="size-[18px]" /></span>
                <div className="min-w-0 flex-1">
                  <p className="font-semibold leading-tight">{AREA[area] ? t(AREA[area]) : t("Other places")}</p>
                  <p className="text-[11px] text-muted-foreground">{t.plural(tbls.length, "{n} table", "{n} tables")}{counters.length ? ` · ${counters.length === 1 ? t("the counter") : t("{n} counters", { n: counters.length })}` : ""}</p>
                </div>
                <div className="flex items-center gap-3 text-xs text-muted-foreground">
                  <span className="flex items-center gap-1.5"><span className={cn("size-2 rounded-full", busyHere ? "bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.18)]" : "bg-muted-foreground/40")} />{t("{n} in use", { n: busyHere })}</span>
                  <span className="flex items-center gap-1.5"><span className="size-2 rounded-full bg-muted-foreground/40" />{t("{n} free", { n: here.length - busyHere })}</span>
                </div>
              </header>
              <div className={cn("relative grid flex-1 auto-rows-fr gap-3 p-3 sm:p-4", tbls.length > 9 ? "grid-cols-2 sm:grid-cols-4" : tbls.length > 4 ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2")}>
                {tbls.map((c, i) => <TableTile key={c.id} c={c} i={i} nowMin={nowMin} meId={me} onOpen={() => setOpenId(c.id)} />)}
              </div>
              {counters.length > 0 && (
                <div className="relative space-y-3 px-3 pb-3 sm:px-4 sm:pb-4">
                  {counters.map((c) => <CounterTile key={c.id} c={c} nowMin={nowMin} onOpen={() => setOpenId(c.id)} />)}
                </div>
              )}
            </div>
          );
        })}
      </section>

      {/* Every card, out of sight (at the page root, so printing shows only them) — for "Print", "Download all" and each download */}
      {onClient && createPortal(<section id="qr-print-area" aria-hidden className="pointer-events-none fixed -left-[10000px] top-0 w-[1000px]">
        <div className="grid grid-cols-3 gap-5 print:grid-cols-2 print:gap-[6mm]">
          {places.map((c) => (
            <div key={c.id} className={cn("w-full max-w-[320px] print:max-w-none print:break-inside-avoid", ((only && !only.includes(c.id)) || !c.qrActive || !only) && "print:hidden")}>
              <PrintCard card={printable(c)} hotel={hotel} phone={phone} />
            </div>
          ))}
        </div>
      </section>, document.body)}

      {opened && (
        <TableDialog c={opened} places={spots} hotel={hotel} phone={phone} canManage={canManage} canSetUp={canSetUp} can={can} accounts={accounts} busy={busyId} pending={pending} nowMin={nowMin} meId={me}
          onClose={() => setOpenId(null)} onOpen={setOpenId} onPrint={() => print([opened.id])} onDownload={() => downloadOne(opened)}
          onNewQr={() => setConfirm(opened)} onToggle={() => toggle(opened)} onReserve={() => setReserving(opened.id)} />
      )}

      <ReservationDialog open={reserving !== false} onClose={() => setReserving(false)} tables={tableOptions} today={today} table={reserving || null} hotelGuests={hotelGuests} />

      <Dialog open={!!confirm} onOpenChange={(o) => !o && setConfirm(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<QrCode />} eyebrow={t("QR card")} tone="gold">
            <DialogTitle>{t("New QR for {name}?", { name: confirm ? t(confirm.name) : "" })}</DialogTitle>
            <DialogDescription>{t("The card there now stops working at once — print the new card and replace it. Orders already placed keep their table. Use this if a card went missing or was copied.")}</DialogDescription>
          </DialogHeader>
          <div className="flex gap-2">
            <Button disabled={pending} onClick={() => confirm && regenerate(confirm)}>{pending && <Loader2 className="animate-spin" />}{t("Make a new QR")}</Button>
            <Button variant="ghost" onClick={() => setConfirm(null)}>{t("Keep the current one")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** A table drawn from above: the table with its number and six chairs — the people there lit in the table's colour. */
function TableArt({ n, state, lit }: { n: number | null; state: TState; lit: number }) {
  const t = useT();
  const st = STATE[state];
  const chairs: [number, number, number, number][] = [[44, 4, 20, 10], [76, 4, 20, 10], [44, 86, 20, 10], [76, 86, 20, 10], [8, 40, 10, 20], [122, 40, 10, 20]];
  const on = state !== "free";
  return (
    <div className="relative mx-auto aspect-[140/100] h-full max-h-[118px] min-h-[76px]">
      <svg viewBox="0 0 140 100" className="absolute inset-0 size-full" aria-hidden>
        {chairs.map(([x, y, w, h], k) => (
          <rect key={k} x={x} y={y} width={w} height={h} rx="5" className={cn("transition-colors", on && (state === "reserved" || k < lit) ? st.chair : STATE.free.chair)} />
        ))}
        <rect x="24" y="19" width="92" height="62" rx="16" strokeWidth="1.5" className={cn("transition-colors", st.table)} />
      </svg>
      <span className="absolute inset-0 grid place-items-center">
        <span className="text-center leading-none">
          <span className={cn("block text-[9px] font-semibold uppercase tracking-[0.24em]", on ? "opacity-80" : "text-muted-foreground/70", on && st.num)}>{t("Table")}</span>
          <span className={cn("mt-0.5 block font-display text-[30px] font-semibold tabular-nums", st.num)}>{n}</span>
        </span>
      </span>
    </div>
  );
}

function TableTile({ c, i, nowMin, meId, onOpen }: { c: TablePlace; i: number; nowMin: number; meId: string | null; onOpen: () => void }) {
  const t = useT();
  const state = stateOf(c);
  const st = STATE[state];
  const s = c.session;
  const due = dueOf(c);
  const time = since(t, s?.startedAt ?? c.loose[0]?.at ?? null, nowMin);
  const showMoney = (s?.money.total ?? c.loose[0]?.total ?? 0) > 0;
  const who = s ? `${shortName(s.customer.name)} · ${people(t, s.guestCount)}` : c.loose[0] ? `${c.loose[0].customer ?? t("Customer")} · ${t.plural(c.loose.length, "{n} order", "{n} orders")}` : null;
  const pill = state === "blocked" ? (c.blocked?.as === "MAINTENANCE" ? t("Maintenance") : t("Not available"))
    : state === "reserved" && c.next ? t("Reserved · {time}", { time: clock(t, c.next.at) }) : state === "free" ? (c.qrActive ? t("Free") : t("QR off"))
    : state === "paid" ? (s?.money.onRoom ? t("Clear table") : s?.money.orders ? t("Paid · clear table") : t("Done · clear table")) : time ? `${t(st.label)} · ${time}` : t(st.label);
  // Settled through the room: say so ("On the room"), never "Paid".
  const held = s ? s.money : looseMoney(c.loose);
  const settled = !due && held.onRoom ? t(settledWord(held)) : null;
  // Who serves it: always with a customer ("No waiter yet" too), otherwise only when the table has its own waiter.
  const waiter = servedBy(c);
  const showWaiter = !!s || (!!waiter && state !== "blocked");
  return (
    <motion.button type="button" onClick={onOpen} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.025 }}
      className={cn("group relative flex min-h-[188px] flex-col rounded-2xl border p-3 text-left transition hover:-translate-y-0.5 hover:shadow-[0_16px_34px_-22px_rgba(0,0,0,0.95)]", st.tile, !c.qrActive && state === "free" && "opacity-55")}>
      <div className="flex items-center justify-between gap-2">
        <span className={cn("inline-flex min-w-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[10.5px] font-semibold", st.pill)}>
          <span className={cn("size-1.5 shrink-0 rounded-full", st.dot, (state === "bill" || state === "ordering") && "animate-pulse")} />
          <span className="truncate">{pill}</span>
        </span>
        {busy(c) && showMoney && (settled
          ? <span title={settled} className="min-w-0 truncate text-[11.5px] font-semibold text-violet-300">{settled}</span>
          : <span className={cn("shrink-0 text-[11.5px] font-semibold tabular-nums", due ? "text-rose-300" : "text-emerald-300")}>{due ? num(due) : t("Paid")}</span>)}
      </div>
      <div className="flex flex-1 items-center py-2"><TableArt n={c.number} state={state} lit={s?.guestCount ?? (c.loose.length ? 2 : 0)} /></div>
      {s && s.stays.length > 0 ? (
        // The customer is staying with us: their room, with them.
        <p className="flex min-w-0 items-center justify-center gap-1.5 text-[11.5px] text-foreground/85">
          <span className="truncate">{shortName(s.customer.name)} · {people(t, s.guestCount)}</span><RoomChip stays={s.stays} />
        </p>
      ) : (
        <p className={cn("truncate text-center text-[11.5px]", state === "free" ? "text-muted-foreground/70" : "text-foreground/85")}>
          {who ?? (state === "reserved" && c.next ? `${shortName(c.next.name)} · ${people(t, c.next.guests)}` : c.next ? t("Booked {time} · {name}", { time: clock(t, c.next.at), name: shortName(c.next.name) }) : t("Ready for customers"))}
        </p>
      )}
      {showWaiter && <span className="mt-1.5 flex justify-center"><WaiterChip w={waiter} mine={!!meId && waiter?.id === meId} /></span>}
    </motion.button>
  );
}

/** The counter drawn as a bar with its stools (no sessions — many people sit there at once). */
function CounterTile({ c, nowMin, onOpen }: { c: TablePlace; nowMin: number; onOpen: () => void }) {
  const t = useT();
  const on = c.loose.length > 0;
  const due = dueOf(c);
  const time = since(t, c.loose[0]?.at ?? null, nowMin);
  const crowd = peopleOf(c.loose, t("Customer"));
  return (
    <button type="button" onClick={onOpen}
      className={cn("group relative flex w-full items-center gap-4 rounded-2xl border p-3 text-left transition hover:-translate-y-0.5",
        on ? "border-emerald-500/40 bg-linear-to-r from-emerald-500/[0.10] to-card/80" : "border-border/60 bg-card/80 hover:border-foreground/20", !c.qrActive && "opacity-55")}>
      <span className={cn("grid size-11 shrink-0 place-items-center rounded-xl", on ? "bg-emerald-500/20 text-emerald-200" : "bg-muted text-muted-foreground")}><Store className="size-5" /></span>
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold">{t("Counter")}</p>
        <p className="truncate text-[11.5px] text-muted-foreground">{on ? `${people(t, crowd.length)} · ${crowd.slice(0, 3).map((x) => shortName(x.name)).join(", ")}${crowd.length > 3 ? ` +${crowd.length - 3}` : ""}${time ? ` · ${time}` : ""}` : c.qrActive ? t("Free · anyone can sit and order") : t("QR off")}</p>
      </div>
      <div aria-hidden className="hidden flex-1 flex-col gap-1.5 sm:flex">
        <span className={cn("h-3 rounded-full", on ? "bg-emerald-500/25 ring-1 ring-emerald-400/40" : "bg-white/[0.05] ring-1 ring-white/12")} />
        <span className="flex justify-around px-3">{Array.from({ length: 6 }, (_, k) => <span key={k} className={cn("size-2.5 rounded-full", on && k < crowd.length ? "bg-emerald-400/75" : "bg-muted-foreground/25")} />)}</span>
      </div>
      <span className="shrink-0 text-right">
        <span className={cn("block rounded-full px-2 py-0.5 text-[10.5px] font-semibold", on ? "bg-emerald-500/15 text-emerald-300" : "bg-muted/70 text-muted-foreground")}>{on ? t("{n} here", { n: crowd.length }) : t("Free")}</span>
        {on && c.loose[0].total > 0 && <span className={cn("mt-1 block text-[11.5px] font-semibold tabular-nums", due ? "text-rose-300" : looseMoney(c.loose).onRoom ? "text-violet-300" : "text-emerald-300")}>{due ? num(due) : t(settledWord(looseMoney(c.loose)))}</span>}
      </span>
    </button>
  );
}

// ───────────────────────── A table, opened ─────────────────────────

function TableDialog({ c, places, hotel, phone, canManage, canSetUp, can, accounts, busy: busyId, pending, nowMin, meId, onClose, onOpen, onPrint, onDownload, onNewQr, onToggle, onReserve }: {
  c: TablePlace; places: TablePlace[]; hotel: string; phone: string | null; canManage: boolean; canSetUp: boolean; can: Can; accounts: PayAccount[]; busy: string | null; pending: boolean; nowMin: number; meId: string | null;
  onClose: () => void; onOpen: (id: string) => void; onPrint: () => void; onDownload: () => void; onNewQr: () => void; onToggle: () => void; onReserve: () => void;
}) {
  const t = useT();
  const [history, setHistory] = useState<false | { id?: string }>(false);
  const isMain = c.kind === "MAIN";
  const state = c.kind === "TABLE" ? stateOf(c) : c.loose.length ? "ordering" : "free";
  const s = c.session;
  const time = since(t, s?.startedAt ?? c.loose[0]?.at ?? null, nowMin);
  const showMoney = can.pay || (s?.money.total ?? 0) > 0 || c.loose.some((o) => o.total > 0);
  const held = s ? s.money : looseMoney(c.loose);
  const waiter = servedBy(c);
  const showWaiter = c.kind === "TABLE" && (!!s || (!!waiter && !c.blocked));
  const glow = state === "free" ? "bg-[oklch(0.75_0.13_80)]/20" : state === "reserved" ? "bg-violet-500/25" : state === "bill" ? "bg-amber-500/25" : state === "seated" ? "bg-sky-500/25" : "bg-emerald-500/20";

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="flex max-h-[92svh] flex-col gap-0 overflow-hidden p-0 max-md:overflow-y-auto sm:max-w-4xl">
        {/* Who and where */}
        <div className="relative shrink-0 overflow-hidden bg-[#15110c] px-5 py-4 text-white">
          <div aria-hidden className={cn("pointer-events-none absolute -right-16 -top-20 size-56 rounded-full blur-3xl", glow)} />
          <div className="relative flex items-center gap-3.5 pr-8">
            <span className={cn("grid size-14 shrink-0 place-items-center rounded-2xl text-lg font-bold tabular-nums ring-1", state === "free" ? "bg-white/10 text-white/80 ring-white/15" : cn(STATE[state as TState].pill, "ring-white/10"))}>
              {c.kind === "TABLE" ? `T${c.number}` : isMain ? <QrCode className="size-6" /> : <Store className="size-6" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#f0cf86]">
                {isMain ? t("The restaurant's own QR") : `${c.area ? areaName(t, c.area) : ""} · ${c.kind === "COUNTER" ? t("Counter") : t("Table")} · ${state === "paid" && held.onRoom ? t("{state} · clear table", { state: t(settledWord(held)) }) : t(STATE[state as TState].label)}`}
              </p>
              <DialogTitle className="mt-0.5 truncate text-2xl text-white">{isMain ? t("Restaurant QR") : s ? s.customer.name : title(c, t)}</DialogTitle>
              <DialogDescription className="mt-1 text-xs text-white/60">
                {isMain ? t("For the entrance, the bar and reception — anyone scans it to order: eat here, or take away (paid first).")
                  : s ? `${title(c, t)} · ${t("session {no}", { no: sessNo(s.number) })} · ${t("since {time}", { time: clock(t, s.startedAt) })}${time ? ` (${time})` : ""} · ${people(t, s.guestCount)}`
                  : c.kind === "COUNTER" ? (c.loose.length ? `${t("{people} at the counter", { people: people(t, peopleOf(c.loose, "").length) })} · ${t.plural(c.loose.length, "{n} open order", "{n} open orders")}` : t("Anyone can sit and order — each with their own bill"))
                  : c.loose.length ? `${time ? t("In use for {time}", { time }) : t("In use")} · ${t.plural(c.loose.length, "{n} open order", "{n} open orders")}`
                  : state === "blocked" ? `${c.blocked?.as === "MAINTENANCE" ? t("Under maintenance") : t("Not available")}${c.blocked?.reason ? ` — ${c.blocked.reason}` : ""}`
                  : state === "reserved" && c.next ? t("Reserved for {name} at {time}", { name: c.next.name, time: clock(t, c.next.at) }) : c.qrActive ? t("Free — ready for customers") : t("QR switched off")}
              </DialogDescription>
              {/* Who serves them — and, staying with us: whose room, and who pays their food */}
              {(showWaiter || (s && s.stays.length > 0)) && (
                <p className="mt-1.5 flex flex-wrap gap-1.5">
                  {showWaiter && <WaiterChip w={waiter} mine={!!meId && waiter?.id === meId} dark className="px-2 py-0.5 text-[11px]" />}
                  {s?.stays.map((x) => (
                    <span key={x.id} className="inline-flex items-center gap-1 rounded-full bg-violet-400/15 px-2 py-0.5 text-[11px] font-semibold text-violet-200 ring-1 ring-violet-300/20">
                      <BedDouble className="size-3" />{shortName(x.guestName)} · {t("Room {room}", { room: x.rooms })}{x.foodPayer && <span className="font-normal text-violet-200/70">· {t("{payer} food", { payer: x.foodPayer })}</span>}
                    </span>
                  ))}
                </p>
              )}
            </div>
            {showMoney && busy(c) ? (
              <div className="hidden shrink-0 text-right sm:block">
                {/* Nothing to pay: paid, or on the room bill — room money is never called paid */}
                <p className={cn("text-[22px] font-semibold leading-none tabular-nums", dueOf(c) ? "text-rose-200" : held.onRoom && !held.paid ? "text-violet-200" : "text-emerald-200")}>{dueOf(c) ? num(dueOf(c)) : held.onRoom && !held.paid ? t("On the room") : t("Paid")}</p>
                <p className="mt-1 text-[11px] text-white/55">{dueOf(c) ? t("TZS to pay") : held.onRoom ? (held.paid ? t("the rest on {bill}", { bill: roomBill(roomsOnBill(s ? s.orders : c.loose), t) }) : roomBill(roomsOnBill(s ? s.orders : c.loose), t)) : t("nothing to pay")}</p>
              </div>
            ) : (
              <div className="hidden shrink-0 text-right sm:block">
                <p className="text-[22px] font-semibold leading-none tabular-nums">{c.doneToday}</p>
                <p className="mt-1 text-[11px] text-white/55">{t.plural(c.doneToday, "customer today", "customers today")}</p>
              </div>
            )}
          </div>
        </div>

        <div className="grid md:min-h-0 md:flex-1 md:grid-cols-[minmax(0,1fr)_236px]">
          <div className="flex flex-col md:min-h-0 md:border-r md:border-border/60">
            {s ? <SessionBody s={s} c={c} places={places} can={can} accounts={accounts} meId={meId} onOpen={onOpen} />
              : c.kind === "COUNTER" ? <CounterBody c={c} can={can} accounts={accounts} />
              : c.kind === "TABLE" && !c.loose.length && c.blocked ? <BlockedBody id={c.id} name={c.name} blocked={c.blocked} canReopen={canSetUp} onHistory={() => setHistory({})} />
              : c.kind === "TABLE" && !c.loose.length ? <FreeBody c={c} can={can} onReserve={onReserve} onHistory={(id) => setHistory({ id })} />
              : <LooseBody c={c} can={can} />}
          </div>

          {/* Its QR card, and the table's past customers */}
          <aside className="hidden space-y-2.5 overflow-y-auto p-4 md:block">
            <div className="relative">
              <PrintCard card={{ ...printable(c), id: `dlg-${c.id}` }} hotel={hotel} phone={phone} />
              {!c.qrActive && <div className="absolute inset-0 grid place-items-center rounded-[22px] bg-black/60 text-sm font-semibold text-white">{t("QR switched off")}</div>}
            </div>
            <QrButtons c={c} canManage={canManage} canSetUp={canSetUp} busy={busyId} pending={pending} onPrint={onPrint} onDownload={onDownload} onNewQr={onNewQr} onToggle={onToggle} />
            {c.kind === "TABLE" && <Button size="sm" variant="outline" className="w-full" onClick={() => setHistory({})}><History />{t("Past customers")}{c.doneToday ? ` · ${t("{n} today", { n: c.doneToday })}` : ""}</Button>}
          </aside>
          <div className="border-t border-border/60 p-4 md:hidden">
            <p className="mb-3 flex items-center gap-1.5 text-xs font-semibold text-muted-foreground"><QrCode className="size-3.5" />{isMain ? t("This restaurant's QR card") : c.kind === "COUNTER" ? t("This counter's QR card") : t("This table's QR card")}</p>
            <div className="relative mx-auto mb-3 w-full max-w-[220px]">
              <PrintCard card={{ ...printable(c), id: `m-${c.id}` }} hotel={hotel} phone={phone} />
              {!c.qrActive && <div className="absolute inset-0 grid place-items-center rounded-[22px] bg-black/60 text-sm font-semibold text-white">{t("QR switched off")}</div>}
            </div>
            <QrButtons c={c} canManage={canManage} canSetUp={canSetUp} busy={busyId} pending={pending} onPrint={onPrint} onDownload={onDownload} onNewQr={onNewQr} onToggle={onToggle} />
            {c.kind === "TABLE" && <Button size="sm" variant="outline" className="mt-2 w-full" onClick={() => setHistory({})}><History />{t("Past customers")}</Button>}
          </div>
        </div>
        {history && <HistoryDialog c={c} startId={history.id} onClose={() => setHistory(false)} />}
      </DialogContent>
    </Dialog>
  );
}

/** A customer at the table: who, how many, their whole bill (every order), the timeline — and everything to do. */
function SessionBody({ s, c, places, can, accounts, meId, onOpen }: { s: SessionView; c: TablePlace; places: TablePlace[]; can: Can; accounts: PayAccount[]; meId: string | null; onOpen: (id: string) => void }) {
  const t = useT();
  const router = useRouter();
  const [taking, setTaking] = useState<{ order: SessionOrder; line: Line } | null>(null);
  const [moving, setMoving] = useState(false);
  const [paying, setPaying] = useState(false);
  const [adding, setAdding] = useState(false);
  const [timeline, setTimeline] = useState(false);
  // BILL TO a room: "own" — a room of someone at the table; "other" — another guest's room (reception, managers).
  const [charging, setCharging] = useState<"own" | "other" | null>(null);
  const [pending, start] = useTransition();
  const m = s.money;
  const showMoney = can.pay || m.total > 0;
  const rooms = roomsOnBill(s.orders);
  const canTakeOff = (l: Line) => can.remove && !l.paid && (!l.made || can.void);
  const run = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>, ok: string) => start(async () => {
    const res = await fn();
    if (res.ok) { toast.success(res.message ?? ok); router.refresh(); } else toast.error(res.error ?? t("Could not save."));
  });
  const guests = (n: number) => run(() => setGuestsAction({ sessionId: s.id, guestCount: n }), t("Saved."));
  // The table is cleared by hand, once they have left — and only when nothing is left to pay.
  const [clearing, setClearing] = useState(false);
  const canClear = m.due === 0;
  const clearBlock = t("{amount} still to pay — clear the table once the bill is fully paid", { amount: tzs(m.due) });

  return (
    <>
      <div className="space-y-3 p-4 sm:p-5 md:min-h-0 md:flex-1 md:overflow-y-auto">
        {/* The customer */}
        <section className="rounded-2xl border border-border/70 bg-muted/15 p-3">
          <div className="flex flex-wrap items-center gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[oklch(0.72_0.12_80/0.18)] font-display text-lg font-semibold text-[oklch(0.86_0.1_84)]">{s.customer.name.charAt(0).toUpperCase()}</span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="truncate text-sm font-semibold">{s.customer.name}{s.reservation && <span className="ml-1.5 rounded-full bg-violet-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-violet-300">{s.reservation}</span>}</p>
              {s.customer.phone ? <a href={`tel:${s.customer.phone}`} className="inline-flex items-center gap-1 text-xs tabular-nums text-muted-foreground hover:text-foreground"><Phone className="size-3" />{s.customer.phone}</a> : <span className="text-xs text-muted-foreground">{t("Session {no}", { no: sessNo(s.number) })}</span>}
            </div>
            <span className="inline-flex items-center gap-1 rounded-xl border border-border px-1 py-0.5">
              <Button size="icon" variant="ghost" className="size-7" disabled={!can.seat || pending || s.guestCount <= 1} onClick={() => guests(s.guestCount - 1)} aria-label={t("Fewer people")}><Minus /></Button>
              <span className="flex items-center gap-1 px-1 text-sm font-semibold tabular-nums"><Users className="size-3.5 text-muted-foreground" />{s.guestCount}</span>
              <Button size="icon" variant="ghost" className="size-7" disabled={!can.seat || pending || s.guestCount >= 60} onClick={() => guests(s.guestCount + 1)} aria-label={t("More people")}><Plus /></Button>
            </span>
          </div>
          {(s.members.length > 1 || can.seat) && (
            <div className="mt-2.5 flex flex-wrap items-center gap-1.5 border-t border-border/50 pt-2.5">
              {s.members.map((x) => (
                <span key={x.id} className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px]", x.primary ? "bg-[oklch(0.72_0.12_80/0.16)] text-[oklch(0.86_0.1_84)]" : "bg-muted text-foreground/85")}>
                  {x.name}{x.primary && <span className="text-[9px] uppercase tracking-wider opacity-70">· {t("pays")}</span>}
                </span>
              ))}
              {can.seat && <button type="button" onClick={() => setAdding(true)} className="inline-flex items-center gap-1 rounded-full border border-dashed border-border px-2 py-0.5 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"><UserPlus className="size-3" />{t("Add person")}</button>}
            </div>
          )}
          {s.billRequestedAt && (
            <p className={cn("mt-2.5 flex items-center gap-2 rounded-xl px-2.5 py-1.5 text-xs font-medium", s.status === "PAID" ? "bg-teal-500/12 text-teal-200" : "bg-amber-500/12 text-amber-200")}>
              <BellRing className="size-3.5" />{s.status === "PAID" ? (m.onRoom ? (m.paid ? t("Paid, the rest on {bill} — clear the table when they leave", { bill: roomBill(rooms, t) }) : t("All on {bill} — clear the table when they leave", { bill: roomBill(rooms, t) })) : t("Paid in full — clear the table when they leave"))
              : m.due ? (can.pay ? t("Bill asked at {time} — record the payment", { time: clock(t, s.billRequestedAt) }) : t("Bill asked at {time} — bring the payment to the Counter", { time: clock(t, s.billRequestedAt) })) : t("Done at {time} — clear the table when they leave", { time: clock(t, s.billRequestedAt) })}
            </p>
          )}
        </section>

        {/* Who serves them: take charge, transfer — managers put a waiter in charge */}
        {c.kind === "TABLE" && <InCharge c={c} s={s} can={can} meId={meId} />}

        {/* The numbers — what is on a room bill is shown apart, never as paid */}
        <dl className={cn("grid grid-cols-3 gap-2", showMoney && m.onRoom ? "sm:grid-cols-6" : "sm:grid-cols-5")}>
          {[
            { k: t("Orders"), v: String(m.orders) }, { k: t("Items"), v: String(m.items) },
            ...(showMoney ? [
              { k: t("Total"), v: num(m.total) }, { k: t("Paid"), v: num(m.paid), tone: m.paid ? "text-emerald-300" : "" },
              ...(m.onRoom ? [{ k: onRoomBill(rooms, t), v: num(m.onRoom), tone: "text-violet-300" }] : []),
              { k: t("To pay"), v: num(m.due), tone: m.due ? "text-rose-300" : "text-emerald-300" },
            ] : []),
          ].map((x) => (
            <div key={x.k} className="min-w-0 rounded-xl border border-border/60 bg-muted/10 px-2.5 py-2">
              <dt title={x.k} className="truncate text-[10.5px] text-muted-foreground">{x.k}</dt>
              <dd className={cn("text-base font-semibold tabular-nums", "tone" in x && x.tone)}>{x.v}</dd>
            </div>
          ))}
        </dl>

        {/* Every order */}
        {s.orders.length === 0 && <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{t("Seated — no order yet. They can order from the table's QR, or you can order for them here.")}</p>}
        {s.orders.map((o) => <OrderBlock key={o.id} o={o} can={can} canTakeOff={canTakeOff} onTakeOff={(line) => setTaking({ order: o, line })} stays={s.stays} />)}

        {can.decide && <BillDiscount sessionId={s.id} due={m.due} />}

        {/* The timeline */}
        <section className="rounded-2xl border border-border/60">
          <button type="button" onClick={() => setTimeline(!timeline)} className="flex w-full items-center justify-between px-3 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <span className="flex items-center gap-1.5"><Clock className="size-3.5" />{t("Timeline · {n}", { n: s.timeline.length })}</span><span>{timeline ? t("Hide") : t("Show")}</span>
          </button>
          {timeline && <Timeline items={s.timeline} />}
        </section>
      </div>

      {/* The table's actions — one slim row of pills */}
      <div className="z-10 flex shrink-0 flex-wrap items-center gap-2 border-t border-border/70 bg-card/95 px-4 py-3 backdrop-blur max-md:sticky max-md:bottom-0 sm:px-5">
        {can.take && <Pill href={`/staff/restaurant/pos?table=${c.id}`} tone="gold" solid icon={<ShoppingBag />}>{t("Add order")}</Pill>}
        {s.orders.length > 0 && <Pill href={`/staff/restaurant-bill?order=${s.orders[0].id}&scope=table`} tone="gold" icon={<Receipt />}>{t("Bill")}</Pill>}
        {can.seat && <Pill onClick={() => setMoving(true)} tone="sky" icon={<ArrowRightLeft />}>{t("Move")}</Pill>}
        {can.seat && s.status === "ACTIVE" && m.orders > 0 && <Pill onClick={() => run(() => requestBillAction({ sessionId: s.id }), t("Waiting for the payment."))} disabled={pending} tone="amber" icon={<BellRing />}>{t("Bill asked")}</Pill>}
        <span className="hidden flex-1 sm:block" />
        {/* BILL TO: pay at the restaurant (Take payment) — or the customer's own room */}
        {can.room && m.due > 0 && s.stays.length > 0 && <Pill onClick={() => setCharging("own")} tone="violet" icon={<BedDouble />}>{s.stays.length === 1 ? t("Charge to Room {room}", { room: s.stays[0].rooms }) : t("Charge to a room")}</Pill>}
        {can.room && can.stays && m.due > 0 && s.stays.length === 0 && (
          <button type="button" onClick={() => setCharging("other")} className="inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[12px] font-medium text-violet-300 transition hover:bg-violet-500/10 hover:text-violet-200"><BedDouble className="size-3.5" />{t("Another guest's room…")}</button>
        )}
        {can.pay && m.due > 0 && <Pill onClick={() => setPaying(true)} tone="emerald" solid icon={<Wallet />}>{t("Receive payment · {amount}", { amount: num(m.due) })}</Pill>}
        {/* A waiter never takes the payment here: the Restaurant Counter records it */}
        {!can.pay && m.due > 0 && <span className="inline-flex h-9 shrink-0 items-center gap-1.5 px-1 text-[12px] font-medium text-muted-foreground"><HandCoins className="size-3.5" />{t("The Restaurant Counter records the payment")}</span>}
        {can.seat && (canClear
          ? <Pill onClick={() => setClearing(true)} tone={m.orders ? "teal" : "rose"} icon={m.orders ? <Check /> : <UserX />}>{m.orders ? t("Clear table") : t("Remove")}</Pill>
          : <span title={clearBlock} className="inline-flex h-9 shrink-0 cursor-not-allowed items-center gap-2 rounded-full border border-dashed border-border/80 pl-1 pr-3 text-[12px] text-muted-foreground">
              <span className="grid size-7 place-items-center rounded-full bg-muted/60"><Lock className="size-3.5" /></span>{t("Clear after payment")}
            </span>)}
      </div>

      {taking && <TakeOff order={taking.order} line={taking.line} onClose={() => setTaking(null)} />}
      {moving && <MoveTable s={s} from={c} places={places} onClose={() => setMoving(false)} onMoved={(id) => { setMoving(false); onOpen(id); }} />}
      {paying && <PayDialog s={s} accounts={accounts} waiterId={s.waiter?.id ?? c.waiter?.id ?? null} onClose={() => setPaying(false)} />}
      {charging && <ChargeTableToRoom s={s} another={charging === "other"} canCheck={!!can.stays} onClose={() => setCharging(null)} />}
      {adding && <AddPerson s={s} onClose={() => setAdding(false)} />}
      {clearing && <ClearTable s={s} onClose={() => setClearing(false)} />}
    </>
  );
}

/**
 * Who serves the customer at this table. A waiter takes charge of a table nobody has, and hands their
 * own to a colleague on shift, saying why — on the restaurant screen with their PIN, so it is recorded
 * under them, never the screen. Managers put a waiter in charge, or hand the table to anyone.
 */
function InCharge({ c, s, can, meId }: { c: TablePlace; s: SessionView; can: Can; meId: string | null }) {
  const t = useT();
  const router = useRouter();
  const askPin = useWaiterPin();
  const device = useIsRestaurantDevice();
  const [handing, setHanding] = useState(false);
  // The PIN is kept only while the transfer window is open (a shared screen); a failed try asks again.
  const pin = useRef<WaiterPinValue | undefined>(undefined);
  const [pending, start] = useTransition();
  const w = s.waiter ?? c.waiter;
  const mine = !!meId && w?.id === meId;
  const canHand = !!w && (can.hand === "any" || (can.hand === "own" && mine));
  const take = async () => {
    const p = await askPin(t("Serve {table}", { table: title(c, t) }));
    if (p === null) return;
    start(async () => {
      const r = await takeTableAction({ locationId: c.id, pin: p });
      if (r.ok) {
        const vars = { name: device && r.data.waiter ? firstName(r.data.waiter) : "", table: title(c, t) };
        toast.success(device && r.data.waiter
          ? (r.data.orders ? t.plural(r.data.orders, "{name} is serving {table} and its {n} order.", "{name} is serving {table} and its {n} orders.", vars) : t("{name} is serving {table}.", vars))
          : (r.data.orders ? t.plural(r.data.orders, "You're serving {table} and its {n} order.", "You're serving {table} and its {n} orders.", vars) : t("You're serving {table}.", vars)));
        router.refresh();
      } else toast.error(r.error);
    });
  };
  // On the Counter the table is handed on for its waiter (no code) — the transfer window picks who takes it.
  const hand = () => {
    pin.current = device && w ? { waiterId: w.id } : undefined;
    setHanding(true);
  };
  const closeHand = (o: boolean) => { setHanding(o); if (!o) pin.current = undefined; };
  const beforeTransfer = async () => true;
  const dialog = w && (
    <TransferDialog open={handing} onOpenChange={closeHand} title={t("Transfer {table}", { table: title(c, t) })} what={t("{table} — {name}, {people}, and their open orders", { table: title(c, t), name: s.customer.name, people: people(t, s.guestCount) })}
      exceptId={w.id} anyone={!!can.decide} onDone={() => router.refresh()}
      beforeTransfer={beforeTransfer}
      onTransfer={async (toWaiterId, reason) => {
        return transferTableAction({ locationId: c.id, toWaiterId, reason, pin: pin.current });
      }} />
  );
  if (can.decide) return <><TableWaiter locationId={c.id} waiter={w} onTransfer={w ? hand : undefined} />{dialog}</>;
  if (!can.charge && !can.hand) return null;
  const who = w ? firstName(w.name) : "";
  return (
    <section className={cn("flex flex-wrap items-center gap-3 rounded-2xl border p-3", !w ? "border-amber-500/35 bg-amber-500/[0.07]" : mine ? "border-emerald-500/30 bg-emerald-500/[0.06]" : "border-border/70 bg-muted/10")}>
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", !w ? "bg-amber-500/15 text-amber-300" : mine ? "bg-emerald-500/15 text-emerald-300" : "bg-muted text-muted-foreground")}>
        {w ? <UserRoundCheck className="size-[18px]" /> : <HandPlatter className="size-[18px]" />}
      </span>
      <div className="min-w-0 flex-1 leading-tight">
        <p className="flex items-center gap-1.5 text-sm font-semibold">{w ? t("Waiter · {name}", { name: who }) : t("No waiter yet")}{mine && <span className="rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[10px] font-semibold text-emerald-300">{t("You")}</span>}</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {!w ? (device ? t("Nobody is serving this table yet — tap Serve and choose the waiter.") : t("Nobody is serving this table yet — serve it and its orders come to you."))
            : mine ? t("You're serving this table — its orders and the bill are with you.")
            : device ? t("{name} is serving this table — tap Transfer to hand it on.", { name: who })
            : t("{name} is serving this table — ask {name} (or a manager) to transfer it.", { name: who })}
        </p>
      </div>
      {!w && can.charge && <Pill onClick={take} disabled={pending} tone="gold" solid icon={pending ? <Loader2 className="animate-spin" /> : <HandPlatter />}>{t("Serve this table")}</Pill>}
      {canHand && <Pill onClick={hand} tone="sky" icon={<ArrowRightLeft />}>{t("Transfer table")}</Pill>}
      {dialog}
    </section>
  );
}

type Tone = "gold" | "sky" | "amber" | "emerald" | "teal" | "rose" | "violet";
const CHIP: Record<Tone, string> = {
  gold: "bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.86_0.1_84)]", sky: "bg-sky-500/15 text-sky-300", amber: "bg-amber-500/15 text-amber-300",
  emerald: "bg-emerald-500/15 text-emerald-300", teal: "bg-teal-500/15 text-teal-300", rose: "bg-rose-500/15 text-rose-300", violet: "bg-violet-500/15 text-violet-300",
};
const SOLID: Partial<Record<Tone, string>> = {
  gold: "bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-[oklch(0.2_0.03_60)] ring-1 ring-inset ring-white/30 shadow-[0_8px_20px_-12px_oklch(0.7_0.12_80)] hover:brightness-105",
  emerald: "bg-emerald-600 text-white shadow-[0_8px_20px_-12px_rgba(16,185,129,0.8)] hover:bg-emerald-500",
};
/** A slim pill with a round icon chip — the table's actions. */
function Pill({ href, onClick, tone, solid, icon, disabled, children }: { href?: string; onClick?: () => void; tone: Tone; solid?: boolean; icon: React.ReactNode; disabled?: boolean; children: React.ReactNode }) {
  const cls = cn("inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-full pl-1 pr-3.5 text-[13px] font-semibold transition disabled:opacity-50",
    solid ? SOLID[tone] : "border border-border/80 bg-background/40 text-foreground/90 hover:border-border hover:bg-muted/60 hover:text-foreground");
  const chip = <span className={cn("grid size-7 place-items-center rounded-full [&_svg]:size-3.5", solid ? "bg-black/10" : CHIP[tone], solid && tone === "emerald" && "bg-white/15")}>{icon}</span>;
  return href
    ? <Link href={href} className={cls}>{chip}{children}</Link>
    : <button type="button" onClick={onClick} disabled={disabled} className={cls}>{chip}{children}</button>;
}

/**
 * One order: its lines, and whose bill it is on. Reception, managers and the MD (`can.stays`) can
 * change who pays it, with the reason — `stays` are the rooms of the people at its table.
 */
function OrderBlock({ o, can, canTakeOff, onTakeOff, stays = [] }: { o: SessionOrder; can: Can; canTakeOff: (l: Line) => boolean; onTakeOff: (l: Line) => void; stays?: TableStay[] }) {
  const t = useT();
  const [billing, setBilling] = useState(false);
  const st = STATUS[o.status] ?? STATUS.PENDING;
  const rounds = [...new Set(o.items.map((l) => l.round))];
  const cancelled = o.status === "CANCELLED";
  // On a room — or not paid at all yet (a part-paid order has its rest taken as a payment).
  const canChangeBill = !!can.stays && !cancelled && o.total > 0 && (!!o.onRoom || (o.paid === 0 && o.due > 0));
  return (
    <article className={cn("overflow-hidden rounded-2xl border border-border/70 bg-muted/15", cancelled && "opacity-55")}>
      <header className="flex items-center gap-2 border-b border-border/60 bg-muted/25 px-3.5 py-2.5">
        <span className="font-mono text-sm font-semibold">{shortNo(o.number)}</span>
        <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">{o.customer ?? t("Customer")} · {clock(t, o.at)}</span>
        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", st.tone)}>{t(st.label)}</span>
      </header>
      <ul className="divide-y divide-border/40">
        {o.items.map((l, k) => (
          <li key={l.id}>
            {rounds.length > 1 && (k === 0 || o.items[k - 1].round !== l.round) && (
              <p className="bg-muted/20 px-3.5 py-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{l.round === 1 ? t("First order") : t("Added · round {n}", { n: l.round })}</p>
            )}
            <div className="flex items-center gap-3 px-3.5 py-2">
              <span className="w-7 shrink-0 text-sm font-semibold tabular-nums text-[oklch(0.84_0.11_82)]">{l.qty}×</span>
              <span className="min-w-0 flex-1">
                <span className={cn("block truncate text-sm", cancelled && "line-through")}>{orderItemName(l, t)}</span>
                {(l.made || l.paid) && (
                  <span className="mt-0.5 flex gap-1.5 text-[10.5px]">
                    {l.made && <span className="inline-flex items-center gap-0.5 text-emerald-300/90"><Check className="size-3" />{t("Made")}</span>}
                    {l.paid && <span className="text-sky-300/90">{t("Paid")}</span>}
                  </span>
                )}
              </span>
              {l.total > 0 && <span className="shrink-0 text-sm tabular-nums text-foreground/90">{num(l.total)}</span>}
              {!["COMPLETED", "COLLECTED", "CANCELLED"].includes(o.status) && canTakeOff(l) ? (
                <button type="button" onClick={() => onTakeOff(l)} aria-label={t("Remove {dish}", { dish: orderItemName(l, t) })} title={t("Remove from the order")}
                  className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground/70 transition hover:bg-rose-500/12 hover:text-rose-300"><CircleMinus className="size-4" /></button>
              ) : can.remove ? <span className="size-8 shrink-0" /> : null}
            </div>
          </li>
        ))}
      </ul>
      <footer className="flex flex-wrap items-center gap-1.5 border-t border-border/60 px-3.5 py-2.5">
        <Link href={`/staff/restaurant/orders/${o.id}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-muted"><History className="size-3.5" />{t("Open")}</Link>
        {can.add && ADDABLE.includes(o.status) && <Link href={`/staff/restaurant/pos?add=${o.id}`} className="inline-flex h-8 items-center gap-1 rounded-lg bg-sky-500/12 px-2.5 text-xs font-semibold text-sky-300 hover:bg-sky-500/20"><Plus className="size-3.5" />{t("Add items")}</Link>}
        {canChangeBill && <Button size="sm" variant="ghost" className="h-8 text-xs text-violet-300 hover:text-violet-200" aria-expanded={billing} onClick={() => setBilling(!billing)}><BedDouble />{t("Change who pays")}</Button>}
        {o.total > 0 && !cancelled && (
          <span className="ml-auto text-right text-sm font-semibold tabular-nums">
            {tzs(o.total)}
            <span className={cn("ml-1.5 text-xs font-medium", o.onRoom ? "text-violet-300" : o.due ? "text-rose-300" : "text-emerald-300")}>· {o.onRoom ? onRoomBill(o.onRoom, t) : o.due ? t("{amount} to pay", { amount: num(o.due) }) : t("paid")}</span>
          </span>
        )}
      </footer>
      {billing && canChangeBill && <ChangeWhoPays o={o} stays={stays} onClose={() => setBilling(false)} />}
    </article>
  );
}

function Timeline({ items }: { items: SessionView["timeline"] }) {
  const t = useT();
  const tone = (k: string) => k === "PAYMENT" || k === "PAID" || k === "CLOSED" ? "bg-emerald-400" : k === "MOVED" ? "bg-sky-400" : k === "BILL_REQUESTED" ? "bg-amber-400" : k.includes("CANCEL") || k.includes("REVERSED") ? "bg-rose-400" : "bg-[oklch(0.8_0.11_82)]";
  return (
    <ol className="relative space-y-2.5 border-t border-border/50 px-3 py-3">
      {items.map((x, k) => (
        <li key={k} className="flex gap-2.5 text-sm">
          <span className="w-11 shrink-0 pt-0.5 text-[11px] tabular-nums text-muted-foreground">{clock(t, x.at)}</span>
          {/* Put on a room bill / taken off it: the bed, like a payment's dot */}
          <span className="flex w-3.5 shrink-0 justify-center">
            {x.kind === "CHARGED_TO_ROOM" || x.kind === "OFF_ROOM"
              ? <BedDouble className={cn("mt-[3px] size-3.5", x.kind === "OFF_ROOM" ? "text-sky-300" : "text-violet-300")} />
              : <span className={cn("mt-1.5 size-2 rounded-full", tone(x.kind))} />}
          </span>
          <span className="min-w-0 flex-1 leading-snug">{x.text}{x.by && <span className="text-xs text-muted-foreground"> · {x.by}</span>}</span>
        </li>
      ))}
    </ol>
  );
}

type PastRow = { id: string; number: string; status: string; customer: string; table: string; guests: number; startedAt: string; closedAt: string | null; total: number };

/**
 * A free table: the table itself (who was here today, what is booked next), seat a customer now
 * — or the reservation that is due — reserve it for later, take an order; and who sat here lately.
 */
function FreeBody({ c, can, onReserve, onHistory }: { c: TablePlace; can: Can; onReserve: () => void; onHistory: (id?: string) => void }) {
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null);
  // The number finds the customer: a known one's name fills itself in.
  const autoName = useRef("");
  const known = useKnownCustomer(phone, (k) => { if (!name.trim() || name === autoName.current) { autoName.current = k.name; setName(k.name); } });
  const [guests, setGuests] = useState(2);
  const [reservedWarn, setReservedWarn] = useState<string | null>(null);
  const [recent, setRecent] = useState<PastRow[] | null>(null);
  const [pending, start] = useTransition();
  const r = c.next;
  useEffect(() => {
    let live = true;
    void tableHistoryAction({ locationId: c.id }).then((res) => { if (live) setRecent(res.ok ? res.data.slice(0, 4) : []); });
    return () => { live = false; };
  }, [c.id]);
  // On the shared restaurant screen the waiter seating them says who they are — asked before the
  // transition starts (the PIN window cannot open inside it), and again for "seat anyway".
  const askPin = useWaiterPin();
  const seat = async (override = false) => {
    const first = name.trim().split(/\s+/)[0];
    const pin = await askPin(first ? t("Seat {name} at {table}", { name: first, table: title(c, t) }) : t("Seat the customer at {table}", { table: title(c, t) }));
    if (pin === null) return;
    start(async () => {
      const res = await seatCustomerAction({ locationId: c.id, name, phone, guestCount: guests, override, pin, guestId: chosen && name.trim() === chosen.name ? chosen.id : null });
      if (res.ok) { toast.success(t("{name} seated at {table}.", { name: name.trim().split(/\s+/)[0], table: title(c, t) })); router.refresh(); return; }
      // The service marks the field "Reserved" — the answer comes in the reader's language.
      if (res.fieldErrors?.locationId === "Reserved" || res.fieldErrors?.locationId === t("Reserved")) { setReservedWarn(res.error); return; }
      toast.error(res.error);
    });
  };
  const seatReservation = async () => {
    if (!r) return;
    const pin = await askPin(t("Seat {name}", { name: r.name }));
    if (pin === null) return;
    start(async () => {
      const res = await seatReservationAction({ id: r.id, pin });
      if (res.ok) { toast.success(t("{name} seated.", { name: r.name })); router.refresh(); } else toast.error(res.error);
    });
  };
  const ready = name.trim().length >= 2 && phone.replace(/\D/g, "").length >= 9;
  const field = "h-11 w-full rounded-xl border border-border/80 bg-background/60 pl-10 pr-3 text-sm outline-none transition placeholder:text-muted-foreground/60 focus:border-[oklch(0.78_0.12_80)] focus:ring-4 focus:ring-[oklch(0.78_0.12_80/0.15)]";

  return (
    <div className="space-y-3.5 p-4 sm:p-5 md:min-h-0 md:flex-1 md:overflow-y-auto">
      {/* The table itself */}
      <section className="relative flex items-center gap-4 overflow-hidden rounded-2xl border border-border/70 bg-linear-to-br from-white/[0.04] to-transparent p-3.5">
        <div aria-hidden className="pointer-events-none absolute inset-0 [background-image:radial-gradient(circle_at_1px_1px,rgba(255,255,255,0.05)_1px,transparent_0)] [background-size:18px_18px]" />
        <div className="relative h-[88px] w-[124px] shrink-0"><TableArt n={c.number} state={r?.holding ? "reserved" : "free"} lit={0} /></div>
        <div className="relative min-w-0 flex-1">
          <p className="flex items-center gap-2 text-[15px] font-semibold">
            <span className={cn("size-2 rounded-full", r?.holding ? "bg-violet-400" : c.qrActive ? "bg-emerald-400 shadow-[0_0_0_3px_rgba(52,211,153,0.18)]" : "bg-muted-foreground/50")} />
            {r?.holding ? t("Held for a reservation") : c.qrActive ? t("Free — ready for customers") : t("Free · its QR is switched off")}
          </p>
          <p className="mt-0.5 text-xs leading-snug text-muted-foreground">{can.decide ? t("Customers scan the table's QR and it becomes theirs — or a waiter seats them.") : t("Customers scan the table's QR and it becomes theirs — or seat them here.")}</p>
          <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
            <span className="inline-flex items-center gap-1 rounded-full bg-muted/70 px-2 py-0.5 text-muted-foreground"><Users className="size-3" />{t.plural(c.doneToday, "{n} customer today", "{n} customers today")}</span>
            {r && <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/12 px-2 py-0.5 text-violet-300"><CalendarClock className="size-3" />{r.holding ? t("Reserved {time}", { time: clock(t, r.at) }) : t("Next {time}", { time: clock(t, r.at) })} · {shortName(r.name)}</span>}
          </div>
        </div>
      </section>

      {/* The reservation that is due (or the next one) */}
      {r && (
        <section className={cn("flex flex-wrap items-center gap-3 rounded-2xl border p-3.5", r.holding ? "border-violet-500/45 bg-violet-500/[0.08]" : "border-border/70 bg-muted/10")}>
          <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-200"><CalendarClock className="size-5" /></span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-violet-300">{r.holding ? t("Reserved now") : t("Next reservation")} · {r.reference}</p>
            <p className="mt-0.5 truncate text-sm font-semibold">{r.name}</p>
            <p className="text-xs text-muted-foreground">{dayClock(t, r.at)} · {people(t, r.guests)}{r.phone ? ` · ${r.phone}` : ""}</p>
          </div>
          {can.seat && !can.decide && <Button disabled={pending} onClick={seatReservation} className="bg-violet-600 text-white hover:bg-violet-500"><Users />{t("They came — seat")}</Button>}
        </section>
      )}

      {/* Managers and the MD don't seat customers — they put a waiter in charge of the table (and reserve it). */}
      {can.decide && <TableWaiter locationId={c.id} waiter={c.waiter} free />}

      {/* Seat someone */}
      {can.seat && !can.decide && (
        <section className="rounded-2xl border border-border/70 bg-muted/10 p-3.5 sm:p-4">
          <div className="flex items-start gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-[oklch(0.72_0.12_80/0.16)] text-[oklch(0.86_0.1_84)]"><UserPlus className="size-[18px]" /></span>
            <div className="min-w-0">
              <h3 className="text-sm font-semibold">{t("Seat a customer")}</h3>
              <p className="text-xs text-muted-foreground">{t("Their phone number first — we know returning customers. The table is theirs until the bill is paid.")}</p>
            </div>
          </div>
          <CustomerFinder className="mt-3.5" onPick={(c) => { setChosen({ id: c.id, name: c.name }); if (c.phone) setPhone(c.phone); setName(c.name); }} />
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            <label className="relative block">
              <span className="sr-only">{t("Phone")}</span>
              <Phone className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" placeholder={t("Phone · 0712 345 678")} maxLength={30} autoComplete="off" className={cn(field, "tabular-nums")} />
            </label>
            <label className="relative block">
              <span className="sr-only">{t("Customer's name")}</span>
              <Users className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Customer's name")} maxLength={80} autoComplete="off" className={field} />
            </label>
            <KnownCustomerNote phone={phone} lookup={known} className="sm:col-span-2" />
          </div>
          <div className="mt-3">
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("How many people?")}</p>
            <div className="flex flex-wrap items-center gap-1.5">
              {[1, 2, 3, 4, 5, 6].map((k) => (
                <button key={k} type="button" onClick={() => setGuests(k)} aria-pressed={guests === k}
                  className={cn("grid size-10 place-items-center rounded-xl border text-sm font-semibold tabular-nums transition",
                    guests === k ? "border-[oklch(0.78_0.12_80)] bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.9_0.08_84)] ring-2 ring-[oklch(0.78_0.12_80/0.25)]" : "border-border/80 bg-background/40 hover:bg-muted")}>{k}</button>
              ))}
              <span className={cn("inline-flex h-10 items-center gap-0.5 rounded-xl border px-1", guests > 6 ? "border-[oklch(0.78_0.12_80)] bg-[oklch(0.72_0.12_80/0.18)]" : "border-border/80 bg-background/40")}>
                <button type="button" onClick={() => setGuests(Math.max(1, guests - 1))} aria-label={t("Fewer")} className="grid size-8 place-items-center rounded-lg hover:bg-muted"><Minus className="size-3.5" /></button>
                <span className="w-9 text-center text-sm font-semibold tabular-nums">{guests > 6 ? guests : "7+"}</span>
                <button type="button" onClick={() => setGuests(Math.min(60, Math.max(7, guests + 1)))} aria-label={t("More")} className="grid size-8 place-items-center rounded-lg hover:bg-muted"><Plus className="size-3.5" /></button>
              </span>
            </div>
          </div>
          <button type="button" disabled={pending || !ready} onClick={() => seat()}
            className="mt-3.5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-sm font-semibold text-[oklch(0.2_0.03_60)] shadow-[0_10px_24px_-16px_oklch(0.7_0.12_80)] ring-1 ring-inset ring-white/30 transition hover:brightness-105 disabled:opacity-40 disabled:shadow-none">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Users className="size-4" />}
            {ready ? t("Seat {name} · {people}", { name: name.trim().split(/\s+/)[0], people: people(t, guests) }) : t("Seat customer")}
          </button>
          {reservedWarn && (
            <div className="mt-2.5 flex flex-wrap items-center gap-2 rounded-xl bg-violet-500/10 px-3 py-2 text-xs text-violet-100">
              <p className="min-w-0 flex-1">{reservedWarn}</p>
              <Button size="sm" variant="outline" disabled={pending} onClick={() => seat(true)}>{t("Seat anyway")}</Button>
            </div>
          )}
        </section>
      )}

      {/* More */}
      {can.seat && (
        <div className="grid gap-2 sm:grid-cols-2">
          <button type="button" onClick={onReserve} className="group flex items-center gap-3 rounded-2xl border border-border/70 bg-muted/10 p-3 text-left transition hover:border-violet-400/50 hover:bg-violet-500/[0.06]">
            <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-violet-500/15 text-violet-200"><CalendarPlus className="size-[18px]" /></span>
            <span className="min-w-0 flex-1 leading-tight"><span className="block text-sm font-semibold">{t("Reserve this table")}</span><span className="text-xs text-muted-foreground">{t("Book it for later")}</span></span>
            <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5" />
          </button>
          {can.take && c.qrActive && (
            <Link href={`/staff/restaurant/pos?table=${c.id}`} className="group flex items-center gap-3 rounded-2xl border border-border/70 bg-muted/10 p-3 transition hover:border-emerald-400/50 hover:bg-emerald-500/[0.06]">
              <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/15 text-emerald-200"><ShoppingBag className="size-[18px]" /></span>
              <span className="min-w-0 flex-1 leading-tight"><span className="block text-sm font-semibold">{t("New order here")}</span><span className="text-xs text-muted-foreground">{t("The first order seats them")}</span></span>
              <ChevronRight className="size-4 text-muted-foreground transition group-hover:translate-x-0.5" />
            </Link>
          )}
        </div>
      )}
      {!can.seat && <p className="rounded-2xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">{t("Customers scan the table's QR to order.")}</p>}

      {/* Who sat here lately */}
      <section>
        <div className="mb-1.5 flex items-center justify-between">
          <h3 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{t("Recently at this table")}</h3>
          {recent && recent.length > 0 && <button type="button" onClick={() => onHistory()} className="text-xs text-muted-foreground hover:text-foreground">{t("See all →")}</button>}
        </div>
        {recent === null ? (
          <div className="space-y-1.5">{[0, 1].map((k) => <div key={k} className="h-12 animate-pulse rounded-xl bg-muted/30" />)}</div>
        ) : recent.length === 0 ? (
          <p className="rounded-xl border border-dashed border-border/70 px-3 py-4 text-center text-xs text-muted-foreground">{t("No customers here yet.")}</p>
        ) : (
          <ul className="divide-y divide-border/50 overflow-hidden rounded-xl border border-border/60">
            {recent.map((x) => (
              <li key={x.id}>
                <button type="button" onClick={() => onHistory(x.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition hover:bg-muted/40">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">{x.customer.charAt(0).toUpperCase()}</span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate font-medium">{x.customer}</span>
                    <span className="text-xs text-muted-foreground">{dayClock(t, x.startedAt)}{x.closedAt ? ` – ${clock(t, x.closedAt)}` : ""} · {people(t, x.guests)}</span>
                  </span>
                  {x.total > 0 && <span className="shrink-0 text-xs font-semibold tabular-nums">{num(x.total)}</span>}
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold", x.status === "CLOSED" ? "bg-emerald-500/12 text-emerald-300" : "bg-muted text-muted-foreground")}>{x.status === "CLOSED" ? t("Done") : t("Left")}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

/**
 * The counter: anyone sits anywhere — each customer scans the QR, gives their name and number and
 * orders, as often as they like. Everyone here is their own card: their orders, what they owe,
 * their payment.
 */
function CounterBody({ c, can, accounts }: { c: TablePlace; can: Can; accounts: PayAccount[] }) {
  const t = useT();
  const [taking, setTaking] = useState<{ order: SessionOrder; line: Line } | null>(null);
  const [paying, setPaying] = useState<Person | null>(null);
  const crowd = peopleOf(c.loose, t("Customer"));
  const canTakeOff = (l: Line) => can.remove && !l.paid && (!l.made || can.void);
  return (
    <div className="space-y-3 p-4 sm:p-5 md:min-h-0 md:flex-1 md:overflow-y-auto">
      {can.decide && <BillDiscount orderIds={c.loose.map((o) => o.id)} due={c.loose.reduce((sum, o) => sum + o.due, 0)} />}
      <p className="flex items-start gap-2.5 rounded-2xl border border-border/60 bg-muted/10 px-3.5 py-2.5 text-xs leading-snug text-muted-foreground">
        <Store className="mt-px size-4 shrink-0 text-[oklch(0.84_0.11_82)]" />
        {t("Anyone can sit at the counter. Each customer scans the counter's QR, gives their name and number once, and orders — everyone has their own orders and their own bill.")}
      </p>
      {crowd.length === 0 ? (
        <div className="grid place-items-center rounded-2xl border border-dashed border-border px-4 py-10 text-center">
          <Users className="size-6 text-muted-foreground/60" />
          <p className="mt-2 text-sm font-medium">{t("Nobody at the counter right now")}</p>
          <p className="text-xs text-muted-foreground">{t("When customers order here, each one shows up with their name.")}</p>
        </div>
      ) : crowd.map((p, i) => (
        <PersonCard key={p.key} p={p} n={i + 1} can={can} canTakeOff={canTakeOff} onTakeOff={(order, line) => setTaking({ order, line })} onPay={() => setPaying(p)} />
      ))}
      {can.take && c.qrActive && (
        <Link href={`/staff/restaurant/pos?table=${c.id}`} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-sm font-semibold text-[oklch(0.2_0.03_60)] ring-1 ring-inset ring-white/30 hover:brightness-105">
          <ShoppingBag className="size-4" />{crowd.length ? t("New order for someone else") : t("New order here")}
        </Link>
      )}
      {taking && <TakeOff order={taking.order} line={taking.line} onClose={() => setTaking(null)} />}
      {paying && <PayPerson p={paying} accounts={accounts} waiterId={servedBy(c)?.id ?? null} onClose={() => setPaying(null)} />}
    </div>
  );
}

/** One customer at the counter: who, their orders, what they owe — pay it, or see their bill. */
function PersonCard({ p, n, can, canTakeOff, onTakeOff, onPay }: {
  p: Person; n: number; can: Can; canTakeOff: (l: Line) => boolean; onTakeOff: (o: SessionOrder, l: Line) => void; onPay: () => void;
}) {
  const t = useT();
  const [open, setOpen] = useState(n <= 2);
  const items = p.orders.reduce((sum, o) => sum + o.items.reduce((u, l) => u + l.qty, 0), 0);
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-muted/10">
      <div className="flex flex-wrap items-center gap-3 px-3.5 py-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[oklch(0.72_0.12_80/0.18)] font-display text-lg font-semibold text-[oklch(0.86_0.1_84)]">{p.name.charAt(0).toUpperCase()}</span>
        <button type="button" onClick={() => setOpen(!open)} className="min-w-0 flex-1 text-left leading-tight">
          <span className="block truncate text-sm font-semibold">{p.name}</span>
          <span className="text-xs text-muted-foreground">{p.phone ? `${p.phone} · ` : ""}{t.plural(p.orders.length, "{n} order", "{n} orders")} · {t.plural(items, "{n} item", "{n} items")} · {t("since {time}", { time: clock(t, p.since) })}</span>
        </button>
        {p.total > 0 && (
          <span className="text-right leading-tight">
            <span className="block text-sm font-semibold tabular-nums">{num(p.total)}</span>
            <span className={cn("text-[11px]", p.due ? "text-rose-300" : looseMoney(p.orders).onRoom ? "text-violet-300" : "text-emerald-300")}>{p.due ? t("{amount} to pay", { amount: num(p.due) }) : t(settledWord(looseMoney(p.orders)))}</span>
          </span>
        )}
        <div className="flex w-full gap-1.5 sm:w-auto">
          {can.pay && p.due > 0 && <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500" onClick={onPay}><Wallet />{t("Receive payment")}</Button>}
          <Link href={`/staff/restaurant-bill?order=${p.orders[0].id}&scope=order`} className={buttonVariants({ size: "sm", variant: "outline" })}><Receipt />{t("Bill")}</Link>
          <Button size="sm" variant="ghost" onClick={() => setOpen(!open)}>{open ? t("Hide") : t("Orders")}</Button>
        </div>
      </div>
      {open && (
        <div className="space-y-2 border-t border-border/60 p-2.5">
          {p.orders.map((o) => <OrderBlock key={o.id} o={o} can={can} canTakeOff={canTakeOff} onTakeOff={(l) => onTakeOff(o, l)} />)}
        </div>
      )}
    </section>
  );
}

/** One counter customer's orders paid into one account — recorded by the Restaurant Counter (or reception), never a waiter. */
function PayPerson({ p, accounts, waiterId, onClose }: { p: Person; accounts: PayAccount[]; waiterId: string | null; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [broughtBy, setBroughtBy] = useState("");
  const [pending, start] = useTransition();
  const pay = () => start(async () => {
    const res = await payBillAction({ ids: p.orders.filter((o) => o.due > 0).map((o) => o.id), accountId, reference: reference.trim() || undefined, handedOverById: broughtBy || null });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(t("{name} paid {amount}.", { name: p.name, amount: tzs(res.data.total) }));
    onClose(); router.refresh();
  });
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader icon={<Wallet />} eyebrow={t("Counter")} tone="emerald">
          <DialogTitle>{t("{name} pays — {amount}", { name: p.name, amount: tzs(p.due) })}</DialogTitle>
          <DialogDescription>{t.plural(p.orders.length, "At the counter · {n} order. Everything they still owe is paid into the account you choose.", "At the counter · {n} orders. Everything they still owe is paid into the account you choose.")}</DialogDescription>
        </DialogHeader>
        {/* The main way: a prompt to the customer's phone for everything they still owe (nTZS). */}
        {p.due > 0 && <SendToPhone target={{ kind: "orders", orderIds: p.orders.filter((o) => o.due > 0).map((o) => o.id), handedOverById: broughtBy || null }}
          amount={p.due} phone={p.phone} who={p.name} onPaid={onClose} primary />}
        <OtherWays fold={p.due > 0}>
          <div className="space-y-3">
            <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} />
            <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} placeholder={t("Reference (M-Pesa / card slip) — optional")} className="font-mono uppercase placeholder:font-sans placeholder:normal-case" />
            <BroughtBySelect value={broughtBy} onChange={setBroughtBy} prefill={waiterId} />
            <div className="flex gap-2">
              <Button className="h-10 flex-1 bg-emerald-600 text-white hover:bg-emerald-500" disabled={pending || !accountId} onClick={pay}>{pending ? <Loader2 className="animate-spin" /> : <Wallet />}{t("Paid {amount}", { amount: tzs(p.due) })}</Button>
              <Button variant="ghost" className="h-10" onClick={onClose}>{t("Cancel")}</Button>
            </div>
          </div>
        </OtherWays>
      </DialogContent>
    </Dialog>
  );
}

/** The main QR (and old orders at a table from before sessions): its open orders, as before. */
function LooseBody({ c, can }: { c: TablePlace; can: Can }) {
  const t = useT();
  const [taking, setTaking] = useState<{ order: SessionOrder; line: Line } | null>(null);
  const canTakeOff = (l: Line) => can.remove && !l.paid && (!l.made || can.void);
  return (
    <div className="space-y-3 p-4 sm:p-5 md:min-h-0 md:flex-1 md:overflow-y-auto">
      {c.kind === "MAIN" ? <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{t("Print it and put it where customers can see it — the entrance, the bar, reception. Orders from it come straight to the Orders board.")}</p>
        : c.loose.length === 0 ? <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">{t("Nobody here right now.")}</p>
        : c.loose.map((o) => <OrderBlock key={o.id} o={o} can={can} canTakeOff={canTakeOff} onTakeOff={(line) => setTaking({ order: o, line })} />)}
      {c.kind !== "MAIN" && (
        <div className="flex gap-2">
          {c.loose.length > 0 && <Link href={`/staff/restaurant-bill?order=${c.loose[0].id}&scope=table`} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg border border-[oklch(0.72_0.12_80/0.45)] text-sm font-semibold text-[oklch(0.86_0.1_84)] hover:bg-[oklch(0.72_0.12_80/0.1)]"><Receipt className="size-4" />{t("Bill")}</Link>}
          {can.take && c.qrActive && <Link href={`/staff/restaurant/pos?table=${c.id}`} className="inline-flex h-10 flex-1 items-center justify-center gap-1.5 rounded-lg bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-sm font-semibold text-[oklch(0.2_0.03_60)] hover:brightness-105"><ShoppingBag className="size-4" />{t("New order here")}</Link>}
        </div>
      )}
      {taking && <TakeOff order={taking.order} line={taking.line} onClose={() => setTaking(null)} />}
    </div>
  );
}

function QrButtons({ c, canManage, canSetUp, busy: busyId, pending, onPrint, onDownload, onNewQr, onToggle }: {
  c: TablePlace; canManage: boolean; canSetUp: boolean; busy: string | null; pending: boolean; onPrint: () => void; onDownload: () => void; onNewQr: () => void; onToggle: () => void;
}) {
  const t = useT();
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="sm" variant="outline" disabled={!c.qrActive} onClick={onPrint}><Printer />{t("Print")}</Button>
        <Button size="sm" variant="outline" disabled={!!busyId} onClick={onDownload}>{busyId === c.id ? <Loader2 className="animate-spin" /> : <Download />}{t("Download")}</Button>
      </div>
      <a href={c.url} target="_blank" rel="noopener" className="flex h-8 items-center justify-center gap-1.5 rounded-lg text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"><ExternalLink className="size-3.5" />{t("See what customers see")}</a>
      {canManage && (
        <div className="grid grid-cols-2 gap-1.5 border-t border-border/60 pt-2">
          <Button size="sm" variant="ghost" className="text-xs" onClick={onNewQr}><RefreshCw />{t("New QR")}</Button>
          <Button size="sm" variant="ghost" className="text-xs" disabled={pending} onClick={onToggle}><Power />{c.qrActive ? t("QR off") : t("QR on")}</Button>
        </div>
      )}
      {canSetUp && c.kind === "TABLE" && !c.session && !c.loose.length && !c.blocked && <TableAvailability id={c.id} name={c.name} />}
    </div>
  );
}

/** Take a line (or some of it) off an order, with a reason. */
function TakeOff({ order, line, onClose }: { order: SessionOrder; line: Line; onClose: () => void }) {
  return <RemoveItemDialog order={{ id: order.id, number: order.number, customer: order.customer, lines: order.items.length }} line={{ id: line.id, name: line.name, qty: line.qty, price: line.price, made: line.made }} onClose={onClose} />;
}

/** The customer moves: pick a free table — the same session, bill and history go with them. */
function MoveTable({ s, from, places, onClose, onMoved }: { s: SessionView; from: TablePlace; places: TablePlace[]; onClose: () => void; onMoved: (id: string) => void }) {
  const t = useT();
  const router = useRouter();
  const [to, setTo] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [warn, setWarn] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const targets = places.filter((p) => p.kind === "TABLE" && p.id !== from.id);
  const dest = targets.find((p) => p.id === to);
  const areas = [...new Set(targets.map((p) => p.area ?? ""))];
  const submit = (override = false) => start(async () => {
    if (!to) return;
    const res = await moveSessionAction({ sessionId: s.id, locationId: to, reason: reason.trim() || undefined, override });
    if (res.ok) { toast.success(t("{name} moved to {table}.", { name: s.customer.name, table: t(res.data.to) })); router.refresh(); onMoved(to); return; }
    // The service marks the field "Reserved" — the answer comes in the reader's language.
    if (res.fieldErrors?.locationId === "Reserved" || res.fieldErrors?.locationId === t("Reserved")) { setWarn(res.error); return; }
    toast.error(res.error);
  });
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader icon={<ArrowRightLeft />} eyebrow={title(from, t)} tone="gold">
          <DialogTitle>{t("Move {name} to another table", { name: s.customer.name })}</DialogTitle>
          <DialogDescription>{t("From {place}. The same session goes with them — every order, payment and the bill. Orders still coming go to the new table; the old table is free at once.", { place: placeName(from, t) })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {areas.map((a) => (
            <div key={a}>
              <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">{AREA[a] ? t(AREA[a]) : t("Other")}</p>
              <div className="grid grid-cols-3 gap-1.5 sm:grid-cols-6">
                {targets.filter((p) => (p.area ?? "") === a).map((p) => {
                  const st = stateOf(p);
                  const taken = busy(p);
                  const sel = to === p.id;
                  return (
                    <button key={p.id} type="button" disabled={taken} onClick={() => { setTo(p.id); setWarn(null); }} aria-pressed={sel}
                      className={cn("flex flex-col items-center rounded-xl border px-1 py-2 transition disabled:cursor-not-allowed disabled:opacity-40",
                        sel ? "border-[oklch(0.8_0.11_82)] bg-[oklch(0.72_0.12_80/0.16)] ring-2 ring-[oklch(0.8_0.11_82)]/40" : "border-border hover:bg-muted/50")}>
                      <span className="text-sm font-semibold">T{p.number}</span>
                      <span className={cn("mt-0.5 text-[10px]", taken ? "text-rose-300" : st === "reserved" ? "text-violet-300" : "text-muted-foreground")}>{taken ? t("In use") : st === "reserved" ? t("Reserved") : t("Free")}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={t("Why? (optional — e.g. wanted to sit inside)")} />
        {warn && <div className="rounded-xl bg-violet-500/10 px-3 py-2 text-xs text-violet-100"><p>{warn}</p><Button size="sm" variant="outline" className="mt-2" disabled={pending} onClick={() => submit(true)}>{t("Move anyway")}</Button></div>}
        <div className="flex gap-2">
          <Button disabled={pending || !to} onClick={() => submit()}>{pending ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />}{dest ? t("Move to {place}", { place: placeName(dest, t) }) : t("Choose a table")}</Button>
          <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The whole bill paid into one account — then the table is free (or once the last order is served). Recorded by the
 * Restaurant Counter (or reception), never a waiter; on the Counter it may note the waiter who brought the money.
 */
function PayDialog({ s, accounts, waiterId, onClose }: { s: SessionView; accounts: PayAccount[]; waiterId: string | null; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [accountId, setAccountId] = useState("");
  const [reference, setReference] = useState("");
  const [broughtBy, setBroughtBy] = useState("");
  const [pending, start] = useTransition();
  const pay = () => start(async () => {
    const res = await takeSessionPaymentAction({ sessionId: s.id, accountId, reference: reference.trim() || undefined, handedOverById: broughtBy || null });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(t("Paid {amount} — clear the table when they leave.", { amount: tzs(res.data.amount) }));
    onClose(); router.refresh();
  });
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader icon={<Wallet />} eyebrow={t(s.table)} tone="emerald">
          <DialogTitle>{t("Receive the payment — {amount}", { amount: tzs(s.money.due) })}</DialogTitle>
          <DialogDescription>{s.customer.name} · {t(s.table)} · {t.plural(s.money.orders, "{n} order. Everything still due on the table is paid into the account you choose.", "{n} orders. Everything still due on the table is paid into the account you choose.")}</DialogDescription>
        </DialogHeader>
        {/* The main way: a prompt to the customer's phone for everything still due on the table (nTZS). */}
        {s.money.due > 0 && <SendToPhone target={{ kind: "orders", orderIds: s.orders.filter((o) => o.due > 0 && !o.onRoom).map((o) => o.id), handedOverById: broughtBy || null }}
          amount={s.money.due} phone={s.customer.phone} who={s.customer.name} onPaid={onClose} primary />}
        <OtherWays fold={s.money.due > 0}>
          <div className="space-y-3">
            <AccountPicker accounts={accounts} value={accountId} onChange={setAccountId} />
            <Input value={reference} onChange={(e) => setReference(e.target.value)} maxLength={80} placeholder={t("Reference (M-Pesa / card slip) — optional")} className="font-mono uppercase placeholder:font-sans placeholder:normal-case" />
            <BroughtBySelect value={broughtBy} onChange={setBroughtBy} prefill={waiterId} />
            <div className="flex gap-2">
              <Button className="h-10 flex-1 bg-emerald-600 text-white hover:bg-emerald-500" disabled={pending || !accountId} onClick={pay}>{pending ? <Loader2 className="animate-spin" /> : <Wallet />}{t("Paid {amount}", { amount: tzs(s.money.due) })}</Button>
              <Button variant="ghost" className="h-10" onClick={onClose}>{t("Cancel")}</Button>
            </div>
          </div>
        </OtherWays>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Clear the table — only once you have seen them leave. The table is free for the next customer;
 * everything they had stays in the table's history.
 */
function ClearTable({ s, onClose }: { s: SessionView; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const none = s.money.orders === 0;
  const first = s.customer.name.split(" ")[0];
  // Orders never marked served (the customer got them and left before the screen was updated).
  const unserved = s.orders.filter((o) => ["PENDING", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"].includes(o.status));
  const clear = () => start(async () => {
    const res = await closeSessionAction({ sessionId: s.id, serveRemaining: unserved.length > 0 });
    if (res.ok) { toast.success(t("{table} is clear — free for the next customer.", { table: t(s.table) })); onClose(); router.refresh(); } else toast.error(res.error);
  });
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        {/* The content has no padding (p-0): the band starts at the edge without the usual pull-out. */}
        <DialogHeader icon={none ? <UserX /> : <Check />} eyebrow={t(s.table)} tone={none ? "rose" : "emerald"} className="mx-0 mt-0">
          <DialogTitle>{none ? t("Remove {name} from {table}?", { name: first, table: t(s.table) }) : t("Clear {table}?", { table: t(s.table) })}</DialogTitle>
          <DialogDescription>{none ? t("They have not ordered anything — the table is freed for someone else.") : t("Only when {name} has left the table.", { name: first })}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3 p-5">
          {!none && (
            <dl className="grid grid-cols-3 gap-2 text-center">
              {[[msg("Orders"), String(s.money.orders)], [msg("Total"), num(s.money.total)], [msg("To pay"), "0"]].map(([k, v]) => (
                <div key={k} className="rounded-xl border border-border/60 bg-muted/10 px-2 py-2"><dt className="text-[10.5px] text-muted-foreground">{t(k)}</dt><dd className={cn("font-semibold tabular-nums", k === "To pay" && "text-emerald-300")}>{v}</dd></div>
              ))}
            </dl>
          )}
          {unserved.length > 0 && (
            <div className="rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs text-amber-100 ring-1 ring-amber-400/25">
              <p className="font-semibold">{t.plural(unserved.length, "This order was never marked served:", "These orders were never marked served:")}</p>
              <ul className="mt-1 space-y-0.5">
                {unserved.map((o) => <li key={o.id}>{shortNo(o.number)} · {t((STATUS[o.status] ?? STATUS.PENDING).label)} · {o.items.map((l) => `${l.qty}× ${orderItemName(l, t)}`).join(", ")}</li>)}
              </ul>
              <p className="mt-1.5 text-amber-100/80">{t.plural(unserved.length, "Clearing marks it served — it is written in the order's history. If they did not get it, open the order instead.", "Clearing marks them served — it is written in the order's history. If they did not get it, open the order instead.")}</p>
            </div>
          )}
          <p className="text-sm text-muted-foreground">{none ? t("Their phone stops ordering at this table.") : `${s.money.onRoom ? (s.money.paid ? t("Everything is paid or on {bill}.", { bill: roomBill(roomsOnBill(s.orders), t) }) : t("Everything is on {bill}.", { bill: roomBill(roomsOnBill(s.orders), t) })) : t("Everything is paid.")} ${t("The table becomes free for the next customer — their orders and payments stay in the table's history.")}`}</p>
          <div className="flex gap-2">
            <Button className={cn("h-10 flex-1 text-white", none ? "bg-rose-600 hover:bg-rose-500" : "bg-teal-600 hover:bg-teal-500")} disabled={pending} onClick={clear}>
              {pending ? <Loader2 className="animate-spin" /> : none ? <UserX /> : <Check />}{none ? t("Remove from the table") : unserved.length ? t("They got everything — clear") : t("Yes, they left — clear it")}
            </Button>
            <Button variant="ghost" className="h-10" onClick={onClose}>{t("Not yet")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** Someone else at the table (a friend who wants to order from the QR too). */
function AddPerson({ s, onClose }: { s: SessionView; onClose: () => void }) {
  const t = useT();
  const router = useRouter();
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null);
  const autoName = useRef("");
  const known = useKnownCustomer(phone, (k) => { if (!name.trim() || name === autoName.current) { autoName.current = k.name; setName(k.name); } });
  const [pending, start] = useTransition();
  const add = () => start(async () => {
    const res = await addMemberAction({ sessionId: s.id, name, phone, guestId: chosen && name.trim() === chosen.name ? chosen.id : null });
    if (res.ok) { toast.success(t("{name} added — they can order from the QR too, on this table's bill.", { name })); onClose(); router.refresh(); } else toast.error(res.error);
  });
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader icon={<UserPlus />} eyebrow={t(s.table)} tone="gold">
          <DialogTitle>{t("Add someone to {table}", { table: t(s.table) })}</DialogTitle>
          <DialogDescription>{t("They join {name}'s table: they can scan the QR and order too — everything stays on this one bill, which {first} pays.", { name: s.customer.name, first: s.customer.name.split(" ")[0] })}</DialogDescription>
        </DialogHeader>
        <CustomerFinder inline onPick={(c) => { setChosen({ id: c.id, name: c.name }); if (c.phone) setPhone(c.phone); setName(c.name); }} />
        <div className="grid gap-2 sm:grid-cols-2">
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" placeholder={t("Their phone")} maxLength={30} className="tabular-nums" autoFocus />
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={t("Their name")} maxLength={80} />
          <KnownCustomerNote phone={phone} lookup={known} className="sm:col-span-2" />
        </div>
        <div className="flex gap-2">
          <Button disabled={pending || name.trim().length < 2 || phone.trim().length < 9} onClick={add}>{pending ? <Loader2 className="animate-spin" /> : <UserPlus />}{t("Add to the table")}</Button>
          <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A table's past customers — open one to see everything they had. */
function HistoryDialog({ c, startId, onClose }: { c: TablePlace; startId?: string; onClose: () => void }) {
  const t = useT();
  const [rows, setRows] = useState<PastRow[] | null>(null);
  const [openS, setOpenS] = useState<SessionView | null>(null);
  const [loading, setLoading] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    void tableHistoryAction({ locationId: c.id }).then((res) => { if (live) setRows(res.ok ? res.data : []); });
    if (startId) void sessionDetailAction({ id: startId }).then((res) => { if (live && res.ok && res.data) setOpenS(res.data); });
    return () => { live = false; };
  }, [c.id, startId]);
  const show = async (id: string) => {
    setLoading(id);
    const res = await sessionDetailAction({ id });
    setLoading(null);
    if (res.ok && res.data) setOpenS(res.data); else toast.error(res.ok ? t("Not found.") : res.error);
  };
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        {openS ? (
          <>
            <DialogHeader icon={<Receipt />} eyebrow={t("Table history")} tone="gold">
              <DialogTitle>{openS.customer.name} · {t("session {no}", { no: sessNo(openS.number) })}</DialogTitle>
              <DialogDescription>{t(openS.table)} · {dayClock(t, openS.startedAt)}{openS.closedAt ? ` → ${clock(t, openS.closedAt)}` : ""} · {people(t, openS.guestCount)}{openS.closedBy ? ` · ${t("closed by {name}", { name: openS.closedBy })}` : ""}</DialogDescription>
              <button type="button" onClick={() => setOpenS(null)} className="mt-1 inline-flex w-fit items-center gap-1 rounded-full bg-white/10 px-2.5 py-1 text-xs text-white/70 ring-1 ring-white/15 hover:text-white"><X className="size-3" />{t("Back to the list")}</button>
            </DialogHeader>
            {openS.money.total > 0 && (
              <p className="text-sm">
                {t.rich("Total <b>{total}</b> · paid <paid>{paid}</paid>", { b: (x) => <b className="tabular-nums">{x}</b>, paid: (x) => <b className="tabular-nums text-emerald-300">{x}</b> }, { total: tzs(openS.money.total), paid: tzs(openS.money.paid) })}
                {openS.money.onRoom > 0 && <> · {t.rich("on {bill} <b>{amount}</b>", { b: (x) => <b className="tabular-nums text-violet-300">{x}</b> }, { bill: roomBill(roomsOnBill(openS.orders), t), amount: tzs(openS.money.onRoom) })}</>}
              </p>
            )}
            <div className="space-y-2">{openS.orders.map((o) => <OrderBlock key={o.id} o={o} can={{ take: false, add: false, remove: false, void: false, seat: false, pay: false }} canTakeOff={() => false} onTakeOff={() => {}} />)}</div>
            <div className="rounded-2xl border border-border/60"><Timeline items={openS.timeline} /></div>
          </>
        ) : (
          <>
            <DialogHeader icon={<History />} eyebrow={t("Table history")} tone="gold">
              <DialogTitle>{t("{place} — past customers", { place: placeName(c, t) })}</DialogTitle>
              <DialogDescription>{t("Every customer who sat here, newest first. Their orders and payments stay with them.")}</DialogDescription>
            </DialogHeader>
            {rows === null ? <p className="flex items-center gap-2 py-6 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("Loading…")}</p>
              : rows.length === 0 ? <p className="rounded-2xl border border-dashed border-border px-4 py-8 text-center text-sm text-muted-foreground">{t("Nobody yet.")}</p>
              : (
                <ul className="divide-y divide-border/50 rounded-2xl border border-border/60">
                  {rows.map((r) => (
                    <li key={r.id}>
                      <button type="button" onClick={() => show(r.id)} className="flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm hover:bg-muted/40">
                        <span className="w-10 shrink-0 font-mono text-xs font-semibold">{sessNo(r.number)}</span>
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className="block truncate font-medium">{r.customer}</span>
                          <span className="text-xs text-muted-foreground">{dayClock(t, r.startedAt)}{r.closedAt ? ` – ${clock(t, r.closedAt)}` : ""} · {people(t, r.guests)}{r.table !== c.name ? ` · ${t("moved to {table}", { table: t(r.table) })}` : ""}</span>
                        </span>
                        {r.total > 0 && <span className="shrink-0 text-xs font-semibold tabular-nums">{num(r.total)}</span>}
                        <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold", r.status === "CLOSED" ? "bg-emerald-500/12 text-emerald-300" : "bg-muted text-muted-foreground")}>{r.status === "CLOSED" ? t("Done") : t("Cancelled")}</span>
                        {loading === r.id && <Loader2 className="size-3.5 animate-spin" />}
                      </button>
                    </li>
                  ))}
                </ul>
              )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
