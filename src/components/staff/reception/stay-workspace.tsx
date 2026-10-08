"use client";

import Link from "next/link";
import { Fragment, useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  AlertTriangle, BedDouble, CalendarPlus, CheckCircle2, Clock, Loader2, LogOut, Plus, Receipt, Info, Wallet, FileText, Users, UtensilsCrossed,
} from "lucide-react";
import {
  changeDatesAction, extendStayAction, previewCheckOutAction, previewDateChangeAction, previewExtensionAction, recordPaymentAction, settleCheckOutAction,
} from "@/app/staff/(app)/reservations/actions";
import { chargeOrderToRoomAction } from "@/app/staff/(app)/restaurant/actions";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Initials } from "@/components/dashboard/kit";
import { DiscountChips, DiscountEditor } from "./discount-editor";
import { DESK_DISCOUNT_MAX } from "@/lib/discounts";
import { OtherWays, SendToPhone } from "@/components/staff/mobile-pay";
import { ChargeComposer, GuestTab, type RecentItem, type TabCharge } from "./room-charges";
import type { BillMenu } from "@/server/services/restaurant";
import { CompanyBillBox } from "./company-bill-box";
import type { CheckOutPreview } from "@/server/services/reservations";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  AlertDialog, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { AccountSelect } from "@/components/staff/finance/account-select";
import type { PayAccount } from "@/lib/pay-account";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";

export interface StayWorkspaceData {
  id: string;
  reference: string;
  guest: string;
  phone: string | null;
  company: string | null;
  source: string;
  state: "IN_HOUSE" | "DUE_TODAY" | "OVERDUE";
  checkoutAt: string; // ISO — expected checkout instant (includes approved late checkout)
  today: string;
  rooms: {
    id: string; number: string; type: string; checkedInAt: string | null; checkedInBy: string | null; endAt: string;
    arrival: string; departure: string; nights: number; gross: number; net: number; ratePerNight: number; discountPerNight: number;
  }[];
  folio: { label: string; amount: number }[];
  gross: number;
  discount: number;
  total: number;
  paid: number;
  balance: number;
  payments: { id: string; amount: number; refund: boolean; method: string; at: string; by: string; reference: string | null }[];
  tab: TabCharge[];
  /** A manager allowed this guest to leave owing (up to this much) — reception may then check them out. */
  leaveOwing?: { upTo: number; reason: string; by: string } | null;
}

const TZ = "Africa/Dar_es_Salaam";
const dt = (t: T, iso: string) => new Intl.DateTimeFormat(t.intl, { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(new Date(iso));
const time = (t: T, iso: string) => t.time(iso, TZ);
/** Where an open order is ("at Outside 3", "for room service") — as the server words it, in this person's language. */
const whereAt = (t: T, at: string) => (at.startsWith("at ") ? t("at {place}", { place: t(at.slice(3)) }) : t(at));
/** "Restaurant — Outside 3 · #184" / "Room service · #12": the kind of order in this person's language. */
const orderLabel = (t: T, label: string) => label.replace(/^(Room service|Restaurant)/, (k) => t(k));

type Preview = CheckOutPreview;

function Box({ icon, title, action, children, className }: { icon: React.ReactNode; title: string; action?: React.ReactNode; children: React.ReactNode; className?: string }) {
  return (
    <section className={cn("rounded-3xl border border-border/70 bg-card p-4 sm:p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground [&_svg]:size-3.5">{icon}{title}</h3>
        {action}
      </div>
      {children}
    </section>
  );
}

/**
 * Put a customer's open restaurant order on this room's bill (reception). The server checks the
 * room is the customer's own (or someone's at their table) — the order keeps its table; the room
 * is only where the bill is collected.
 */
export function PutOnRoomButton({ orderId, reservationId, room, className }: { orderId: string; reservationId: string; room: string; className?: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const put = () => start(async () => {
    const res = await chargeOrderToRoomAction({ id: orderId, reservationId });
    if (res.ok) { toast.success(room ? t("On Room {room}'s bill now.", { room }) : t("On the room bill now.")); router.refresh(); }
    else toast.error(res.error, { duration: 9000 });
  });
  return (
    <Button type="button" size="sm" variant="outline" disabled={pending} onClick={put} className={cn("h-7 shrink-0 bg-card px-2.5 text-xs", className)}>
      {pending ? <Loader2 className="animate-spin" /> : <BedDouble />}{t("Put on this room")}
    </Button>
  );
}

/**
 * At check-out: restaurant orders of this guest (or someone sharing the room) still open and
 * NOT on the room bill — "Nino still has TZS 20,000 open at Outside 3". A reminder only: it
 * never blocks the check-out. Reception can put each one on this room.
 */
export function OpenOrdersNote({ reservationId, room, orders, canCharge }: {
  reservationId: string; room: string; orders: CheckOutPreview["openOrders"]; canCharge: boolean;
}) {
  const t = useT();
  if (!orders.length) return null;
  return (
    <div className="space-y-2 rounded-xl border border-amber-500/40 bg-amber-500/[0.08] p-3 text-xs text-amber-900 dark:text-amber-200">
      {orders.map((o) => (
        <div key={o.id} className="flex flex-wrap items-center gap-2">
          <UtensilsCrossed className="size-3.5 shrink-0" />
          <span className="min-w-0 flex-1">{t.rich("<b>{customer}</b> still has <m>{amount}</m> open {at} — not on the room", { b: (c) => <strong>{c}</strong>, m: (c) => <strong className="tabular-nums">{c}</strong> }, { customer: o.customer, amount: formatTZS(o.amount), at: whereAt(t, o.at) })} <span className="opacity-70">· {t("Order #{n}", { n: o.number.replace(/^ORD-\d{4}-0*/, "") })}</span></span>
          {canCharge && <PutOnRoomButton orderId={o.id} reservationId={reservationId} room={room} />}
        </div>
      ))}
      <p className="text-[11px] opacity-75">{canCharge ? t("Check-out is not blocked — put it on this room, or they pay it at the restaurant.") : t("Check-out is not blocked — they pay it at the restaurant.")}</p>
    </div>
  );
}

const plusDays = (d: string, n: number) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
type Alt = { id: string; number: string; type: string; baseRate: number; sameType?: boolean; extraAmount?: number; perNight?: number };

/**
 * The stay's length: add nights (+1, +2… or a date) or take some off (−1 night) — the server works out the
 * price and whether the room is free. If the room is booked next, the guest moves with everything (same
 * booking, same account) to the free room picked here — each one shown with its price, a dearer one too.
 */
export function ExtendStay({ reservationId, today, room, canDiscount = false, discountMax = DESK_DISCOUNT_MAX }: {
  reservationId: string; today: string; canDiscount?: boolean; discountMax?: number | null;
  /** `arrival` lets nights be taken off too (a later checkout, not before tomorrow). */
  room: { id: string; number: string; departure: string; endAt: string; ratePerNight?: number; discountPerNight?: number; nights?: number; arrival?: string };
}) {
  const t = useT();
  const s = { id: reservationId, today };
  const router = useRouter();
  const [date, setDate] = useState("");
  const [p, setP] = useState<{ extraNights: number; extraAmount: number; currentRoomAvailable: boolean; alternatives: Alt[] } | null>(null);
  // Taking nights off: what comes off the bill.
  const [cut, setCut] = useState<{ nights: number; difference: number; balanceAfter: number } | null>(null);
  const [moveTo, setMoveTo] = useState("");
  const [loading, startLoad] = useTransition();
  const [saving, startSave] = useTransition();
  const [error, setError] = useState<string | null>(null);
  // Optional discount given with the extension (per night, whole stay). null = keep as it is.
  const [disc, setDisc] = useState<number | null>(null);
  const [discReason, setDiscReason] = useState("");
  const rate = room.ratePerNight ?? 0;
  const curDisc = room.discountPerNight ?? 0;
  const withDiscount = canDiscount && rate > 0 && room.nights != null;
  const newDisc = disc ?? curDisc;
  const pickDisc = (v: number) => setDisc(v === curDisc ? null : v);
  // Past checkout (overdue): count from today — "+1 night" is until tomorrow.
  const base = room.departure > s.today ? room.departure : s.today;
  const tomorrow = plusDays(s.today, 1);
  const canCut = !!room.arrival && plusDays(room.departure, -1) >= tomorrow;

  function choose(d: string) {
    setDate(d); setP(null); setCut(null); setError(null); setMoveTo("");
    if (!d || d === room.departure) return;
    startLoad(async () => {
      if (d < room.departure) {
        const res = await previewDateChangeAction({ reservationRoomId: room.id, arrivalDate: room.arrival!, departureDate: d });
        if (res.ok) setCut({ nights: res.data.current.nights - res.data.proposed.nights, difference: res.data.difference, balanceAfter: res.data.balanceAfter }); else setError(res.error);
        return;
      }
      const res = await previewExtensionAction({ reservationRoomId: room.id, newDeparture: d });
      if (res.ok) { setP(res.data); setMoveTo(res.data.alternatives[0]?.id ?? ""); } else setError(res.error);
    });
  }
  function confirm() {
    startSave(async () => {
      const res = await extendStayAction({
        reservationId: s.id, reservationRoomId: room.id, newDeparture: date, moveToRoomId: p?.currentRoomAvailable ? null : moveTo,
        ...(disc != null && { discountPerNight: disc, discountReason: discReason }),
      });
      if (res.ok) {
        const moved = !p?.currentRoomAvailable ? p?.alternatives.find((a) => a.id === moveTo) : null;
        toast.success(moved ? t("Moved to Room {room} — checkout {date}.", { room: moved.number, date: t.date(date) }) : t("Stay extended — new checkout {date}.", { date: t.date(date) }), disc != null ? { description: disc ? t("Discount {amount} per night.", { amount: formatTZS(disc) }) : t("Discount removed.") } : { description: t("The new nights are on the bill.") });
        setDate(""); setP(null); setDisc(null); setDiscReason(""); router.refresh();
      }
      else toast.error(res.error, { duration: 9000 });
    });
  }
  function shorten() {
    startSave(async () => {
      const res = await changeDatesAction({ reservationId: s.id, reservationRoomId: room.id, arrivalDate: room.arrival!, departureDate: date });
      if (res.ok) { toast.success(t("Stay shortened — checkout {date}.", { date: t.date(date) }), { description: t("The nights taken off are off the bill.") }); setDate(""); setCut(null); router.refresh(); }
      else toast.error(res.error, { duration: 9000 });
    });
  }

  const chip = "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors";
  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 text-sm">
        <div className="rounded-2xl bg-muted/60 p-3"><p className="text-xs text-muted-foreground">{t("Checkout now")}</p><p className="font-semibold">{t.date(room.departure)} · {time(t, room.endAt)}</p></div>
        <div className="space-y-1">
          <Label htmlFor={`ext-${room.id}`} className="text-xs text-muted-foreground">{t("New checkout date")}</Label>
          <Input id={`ext-${room.id}`} type="date" min={canCut ? tomorrow : plusDays(base, 1)} value={date} onChange={(e) => choose(e.target.value)} className="h-11" />
        </div>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {canCut && (() => { const d = plusDays(room.departure, -1); return (
          <button type="button" onClick={() => choose(d)} className={cn(chip, date === d ? "border-rose-500 bg-rose-500 text-white" : "border-rose-500/40 text-rose-700 hover:bg-rose-500/10 dark:text-rose-300")}>{t("−1 night")}</button>
        ); })()}
        {[1, 2, 3, 7].map((n) => {
          const d = plusDays(base, n);
          return <button key={n} type="button" onClick={() => choose(d)} className={cn(chip, date === d ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>{t.plural(n, "+{n} night", "+{n} nights")}</button>;
        })}
      </div>
      {loading && <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{t("Checking room {room}…", { room: room.number })}</p>}
      {error && <p className="text-xs text-destructive">{error}</p>}
      {cut && (
        <div className="space-y-3 rounded-2xl border border-rose-500/30 bg-rose-500/[0.05] p-3 text-sm">
          <dl className="grid grid-cols-2 gap-y-1.5">
            <dt className="text-muted-foreground">{t("New checkout")}</dt><dd className="text-right font-semibold">{t.date(date)} · {time(t, room.endAt)}</dd>
            <dt className="text-muted-foreground">{t("Nights taken off")}</dt><dd className="text-right font-semibold">{cut.nights}</dd>
            <dt className="text-muted-foreground">{t("Off the bill")}</dt><dd className="text-right font-semibold text-emerald-700 dark:text-emerald-400">− {formatTZS(Math.abs(cut.difference))}</dd>
            <dt className="text-muted-foreground">{t("Balance after")}</dt><dd className="text-right font-semibold">{cut.balanceAfter < 0 ? t("Credit {amount}", { amount: formatTZS(-cut.balanceAfter) }) : formatTZS(cut.balanceAfter)}</dd>
          </dl>
          <Button className="w-full" variant="outline" disabled={saving} onClick={shorten}>{saving ? <Loader2 className="animate-spin" /> : <CalendarPlus />}{cut.nights === 1 ? t("Take the night off") : t("Take {n} nights off", { n: cut.nights })}</Button>
        </div>
      )}
      {p && (
        <div className="space-y-3 rounded-2xl border border-border/70 p-3 text-sm">
          <dl className="grid grid-cols-2 gap-y-1.5">
            <dt className="text-muted-foreground">{t("New checkout")}</dt><dd className="text-right font-semibold">{t.date(date)} · {time(t, room.endAt)}</dd>
            <dt className="text-muted-foreground">{t("Extra nights")}</dt><dd className="text-right font-semibold">{p.extraNights}</dd>
            {withDiscount && disc != null ? (() => {
              const total = room.nights! + p.extraNights;
              const change = total * (rate - newDisc) - room.nights! * (rate - curDisc);
              return <>
                <dt className="text-muted-foreground">{t("Price per night")}</dt><dd className="text-right font-semibold"><span className="mr-1.5 text-xs font-normal text-muted-foreground line-through">{formatTZS(rate - curDisc)}</span>{formatTZS(rate - newDisc)}</dd>
                <dt className="text-muted-foreground">{t("Change to the bill")}</dt><dd className="text-right font-semibold">{change >= 0 ? "+" : "−"} {formatTZS(Math.abs(change))}</dd>
              </>;
            })() : <><dt className="text-muted-foreground">{t("Added to the bill")}</dt><dd className="text-right font-semibold">+ {formatTZS(p.currentRoomAvailable ? p.extraAmount : (p.alternatives.find((a) => a.id === moveTo)?.extraAmount ?? p.extraAmount))}</dd></>}
          </dl>
          {withDiscount && p.currentRoomAvailable && (
            <div className="space-y-2 rounded-xl border border-emerald-500/25 bg-emerald-500/5 p-2.5">
              <p className="flex items-center justify-between gap-2 text-xs">
                <span className="font-semibold">{t("Discount per night")}</span>
                <span className="text-muted-foreground">{t("{n} nights · {rate} rate", { n: room.nights! + p.extraNights, rate: formatTZS(rate) })}</span>
              </p>
              <DiscountChips size="xs" value={newDisc} rate={rate} max={discountMax} current={curDisc} onChange={(v) => pickDisc(v)} />
              {disc != null && <Input value={discReason} onChange={(e) => setDiscReason(e.target.value)} placeholder={t("Reason (optional) — e.g. long stay, regular guest")} className="h-8 text-xs" />}
            </div>
          )}
          {p.currentRoomAvailable ? (
            <p className="flex items-center gap-1.5 text-xs text-emerald-700 dark:text-emerald-400"><CheckCircle2 className="size-3.5" />{t("Room {room} is free for the extra nights.", { room: room.number })}</p>
          ) : (
            <div className="space-y-2">
              <p className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"><AlertTriangle className="mt-0.5 size-3.5 shrink-0" />{t("Room {room} is booked for those nights. Move the guest — with their bill, charges and payments — to a free room:", { room: room.number })}</p>
              {p.alternatives.length ? (
                <div role="radiogroup" aria-label={t("Move to room")} className="grid gap-1.5 sm:grid-cols-2">
                  {p.alternatives.map((a) => {
                    const on = moveTo === a.id;
                    const more = (a.perNight ?? 0) - p.extraAmount / Math.max(1, p.extraNights);
                    return (
                      <button key={a.id} type="button" role="radio" aria-checked={on} onClick={() => setMoveTo(a.id)}
                        className={cn("flex min-w-0 items-center gap-2.5 rounded-xl border px-3 py-2 text-left transition", on ? "border-[oklch(0.75_0.12_80)] bg-[oklch(0.72_0.12_80/0.14)] ring-1 ring-[oklch(0.75_0.12_80/0.6)]" : "border-border/70 hover:bg-muted")}>
                        <span className="grid size-9 shrink-0 place-items-center rounded-lg bg-muted text-xs font-bold tabular-nums">{a.number}</span>
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className="block truncate text-xs font-semibold">{t(a.type)}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">{a.perNight != null ? `${formatTZS(a.perNight)}${t("/night")}` : formatTZS(a.baseRate)}</span>
                        </span>
                        <span className={cn("shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold", Math.abs(more) < 1 ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : more > 0 ? "bg-amber-500/14 text-amber-800 dark:text-amber-300" : "bg-sky-500/12 text-sky-700 dark:text-sky-300")}>
                          {Math.abs(more) < 1 ? t("Same price") : more > 0 ? `+${formatTZS(Math.round(more)).replace("TZS ", "")}${t("/night")}` : `−${formatTZS(Math.round(-more)).replace("TZS ", "")}${t("/night")}`}
                        </span>
                      </button>
                    );
                  })}
                </div>
              ) : <p className="text-xs text-destructive">{t("No other room is free for those dates.")}</p>}
            </div>
          )}
          <Button className="w-full" disabled={saving || (!p.currentRoomAvailable && !moveTo)} onClick={confirm}>
            {saving ? <Loader2 className="animate-spin" /> : <CalendarPlus />}{p.currentRoomAvailable ? (p.extraNights === 1 ? t("Add the night") : t("Add {n} nights", { n: p.extraNights })) : t("Move to Room {room} & add the nights", { room: p.alternatives.find((a) => a.id === moveTo)?.number ?? "" })}
          </Button>
        </div>
      )}
    </div>
  );
}

/**
 * One guest's stay — the reception's single place to extend, add charges,
 * take payments and check out. The checkout button adapts to the situation
 * (paid → CHECK OUT; owing → RECORD PAYMENT & CHECK OUT; overdue → shown).
 */
export function StayWorkspace({ s, methods, perms, recent, menu = null, menuPayNow = false }: {
  s: StayWorkspaceData;
  methods: PayAccount[];
  recent: RecentItem[];
  /** The restaurant & bar menu, to pick food & drinks onto the bill. */
  menu?: BillMenu | null; menuPayNow?: boolean;
  /** `order`: may put a guest's open restaurant order on the room (default: whoever takes payments). */
  perms: { pay: boolean; extend: boolean; override: boolean; discount: boolean; discountMax: number | null; void: boolean; order?: boolean };
}) {
  const t = useT();
  const router = useRouter();
  const [chargeOverstay, setChargeOverstay] = useState<boolean | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [earlyReason, setEarlyReason] = useState("");
  const [pay, setPay] = useState({ accountId: methods[0]?.id ?? "", amount: "", reference: "" });
  const [leaveOwing, setLeaveOwing] = useState(false);
  const [overrideReason, setOverrideReason] = useState("");
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [panel, setPanel] = useState<"charge" | "pay" | null>(null);
  const [pending, start] = useTransition();

  // Work out the exact final bill (server-side) whenever the stay or the overstay choice changes.
  useEffect(() => {
    let alive = true;
    previewCheckOutAction({ reservationId: s.id, chargeOverstay: chargeOverstay ?? true }).then((res) => {
      if (!alive) return;
      if (res.ok) { setPreview(res.data); setPreviewError(null); setPay((p) => ({ ...p, amount: res.data.balance > 0 ? String(res.data.balance) : "" })); }
      else setPreviewError(res.error);
    });
    return () => { alive = false; };
  }, [s.id, s.total, s.paid, chargeOverstay]);

  const roomsLabel = s.rooms.map((r) => r.number).join(", ");
  const finalBalance = preview?.balance ?? s.balance;
  // One balance everywhere on this page: the final one (extra nights included) once it is worked out.
  const bal = finalBalance;
  const owes = finalBalance > 0;
  const amount = Number(pay.amount) || 0;
  const coversAll = amount >= finalBalance;
  // Stayed past checkout: the extra nights are on the bill by themselves (a manager may let them off).
  const needsOverstayChoice = false;
  const overstayCharged = (preview?.overstayNights ?? 0) > 0 && chargeOverstay !== false;
  const needsEarly = !!preview?.early && !earlyReason.trim();
  // Company-billed stay: the company's part goes on its invoice; the guest settles only what is left.
  const billed = preview?.company?.billedNow ?? 0;
  const group = preview?.group ?? null;
  const [invoiceMode, setInvoiceMode] = useState<"ISSUE" | "OPEN" | null>(null);
  const mode = invoiceMode ?? (preview?.company?.consolidate ? "OPEN" : "ISSUE");
  // The manager said yes beforehand: the guest may leave owing up to that amount (no manager at the desk needed).
  const approvedOwing = owes && !!s.leaveOwing && finalBalance <= s.leaveOwing.upTo;
  const willLeaveOwing = owes && ((leaveOwing && perms.override) || approvedOwing) && (!pay.accountId || !coversAll);
  const blocked = !preview || needsOverstayChoice || needsEarly
    || (owes && !(perms.pay && amount > 0 && coversAll) && !(leaveOwing && perms.override && overrideReason.trim()) && !approvedOwing);

  function finish() {
    start(async () => {
      const withPayment = owes && perms.pay && amount > 0 ? { amount: Math.min(amount, finalBalance), accountId: pay.accountId, reference: pay.reference || undefined } : null;
      const res = await settleCheckOutAction({
        reservationId: s.id, chargeOverstay: chargeOverstay ?? true, earlyReason: earlyReason || undefined,
        allowBalance: leaveOwing || approvedOwing, overrideReason: overrideReason || undefined, payment: withPayment,
        invoiceMode: preview?.company && !preview.group ? mode : null,
      });
      setConfirmOpen(false);
      // The last room of a group: straight to the final group invoice (the receptionist confirms it there).
      if (res.ok) router.push(group?.last ? `/staff/groups/${group.id}?final=1` : `/staff/check-out?done=${s.id}`);
      else toast.error(res.error, { duration: 9000 });
    });
  }

  const stateBadge = s.state === "OVERDUE"
    ? <span className="rounded-full bg-rose-500/15 px-2.5 py-1 text-rose-700 dark:text-rose-300">{t("Checkout overdue")}</span>
    : s.state === "DUE_TODAY"
      ? <span className="rounded-full bg-amber-500/15 px-2.5 py-1 text-amber-800 dark:text-amber-300">{t("Leaving today · {time}", { time: time(t, s.checkoutAt) })}</span>
      : <span className="rounded-full bg-emerald-500/12 px-2.5 py-1 text-emerald-700 dark:text-emerald-300">{t("In house")}</span>;

  return (
    <article id="workspace" className="scroll-mt-24 space-y-4">
      {/* Header */}
      <header className="overflow-hidden rounded-3xl border border-border/70 bg-card">
        <div className="flex flex-wrap items-center gap-3 px-4 py-4 sm:px-6">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-[#17130e] text-center text-[#f0cf86] dark:bg-gold dark:text-[#17130e]">
            <span className="text-[9px] font-semibold uppercase leading-none opacity-70">{t("Room")}<span className="block text-base leading-tight">{roomsLabel}</span></span>
          </span>
          <Initials name={s.guest} className="size-10 text-xs" />
          <div className="min-w-0 flex-1">
            <h2 className="truncate text-lg font-semibold">{s.guest}</h2>
            <p className="truncate text-xs text-muted-foreground">{s.rooms.map((r) => t(r.type)).join(", ")} · <span className="font-mono">{s.reference}</span>{s.company ? ` · ${t("billed to {company}", { company: s.company })}` : ""}</p>
          </div>
          <div className="text-xs font-medium">{stateBadge}</div>
          <Link href={`/staff/stay-bill?reservation=${s.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-[oklch(0.75_0.13_80)]/50 bg-[oklch(0.75_0.13_80)]/10 px-3 text-sm font-semibold hover:bg-[oklch(0.75_0.13_80)]/20">
            <FileText className="size-4" />{t("Room bill")}
          </Link>
        </div>
        <dl className="grid grid-cols-2 border-t border-border/70 text-sm sm:grid-cols-4">
          <div className="px-4 py-3 sm:px-6"><dt className="text-xs text-muted-foreground">{t("Checked in")}</dt><dd className="font-semibold">{s.rooms[0]?.checkedInAt ? dt(t, s.rooms[0].checkedInAt) : "—"}</dd></div>
          <div className="px-4 py-3 sm:px-6"><dt className="text-xs text-muted-foreground">{t("Checkout")}</dt><dd className={cn("font-semibold", s.state === "OVERDUE" && "text-rose-600 dark:text-rose-400")}>{dt(t, s.checkoutAt)}</dd></div>
          <div className="px-4 py-3 sm:px-6"><dt className="text-xs text-muted-foreground">{t("Nights")}</dt><dd className="font-semibold">{s.rooms.reduce((a, r) => Math.max(a, r.nights), 0)}</dd></div>
          <div className="px-4 py-3 sm:px-6"><dt className="text-xs text-muted-foreground">{overstayCharged ? t("To pay now") : t("Balance")}</dt><dd className={cn("text-base font-bold tabular-nums", bal > 0 ? "text-rose-600 dark:text-rose-400" : bal < 0 ? "text-amber-700 dark:text-amber-400" : "text-emerald-600 dark:text-emerald-400")}>{bal > 0 ? formatTZS(bal) : bal < 0 ? t("Credit {amount}", { amount: formatTZS(-bal) }) : t("Paid")}</dd></div>
        </dl>
        {s.state === "OVERDUE" && (
          <p className="flex items-start gap-2 border-t border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 sm:px-6 dark:text-rose-300">
            <AlertTriangle className="mt-0.5 size-4 shrink-0" />{t("Checkout time passed at {time}.", { time: time(t, s.checkoutAt) })}{(preview?.overstayNights ?? 0) > 0 ? ` ${t.plural(preview!.overstayNights, "The {n} extra night is on the bill already.", "The {n} extra nights are on the bill already.")}` : ""} {t("Check the guest out below — or add nights if they are staying on.")}
          </p>
        )}
      </header>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* Account */}
        <Box icon={<Receipt />} title={t("Account")}
          action={perms.pay && <div className="flex gap-1.5">
            <Button size="sm" variant={panel === "charge" ? "default" : "outline"} onClick={() => setPanel(panel === "charge" ? null : "charge")}><Plus />{t("Add to room")}</Button>
            {s.balance > 0 && <Button size="sm" variant={panel === "pay" ? "default" : "outline"} onClick={() => setPanel(panel === "pay" ? null : "pay")}><Wallet />{t("Record payment")}</Button>}
          </div>}>
          <dl className="space-y-2 text-sm">
            {s.rooms.map((r) => (
              <div key={r.id} className="flex justify-between gap-3"><dt className="text-muted-foreground">{t("Room {room}", { room: r.number })} · {t.plural(r.nights, "{n} night", "{n} nights")}</dt><dd className="tabular-nums">{formatTZS(r.gross)}</dd></div>
            ))}
            {s.folio.map((f) => <div key={f.label} className="flex justify-between gap-3"><dt className="text-muted-foreground">{t(f.label)}</dt><dd className="tabular-nums">{formatTZS(f.amount)}</dd></div>)}
            {overstayCharged && <div className="flex justify-between gap-3 text-rose-700 dark:text-rose-300"><dt>{t("Extra nights · stayed past checkout ({n})", { n: preview!.overstayNights })}</dt><dd className="tabular-nums">{formatTZS(preview!.overstayAmount)}</dd></div>}
            {s.discount > 0 && <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t("Discount")}</dt><dd className="tabular-nums text-emerald-600 dark:text-emerald-400">− {formatTZS(s.discount)}</dd></div>}
            <div className="flex justify-between gap-3 border-t border-border pt-2 font-semibold"><dt>{t("Total")}</dt><dd className="tabular-nums">{formatTZS(preview?.total ?? s.total)}</dd></div>
            <div className="flex justify-between gap-3"><dt className="text-muted-foreground">{t("Paid")}</dt><dd className="tabular-nums text-emerald-700 dark:text-emerald-400">{formatTZS(preview?.paid ?? s.paid)}</dd></div>
            <div className={cn("flex items-center justify-between gap-3 rounded-2xl px-4 py-3 text-lg font-bold", bal > 0 ? "bg-rose-500/10 text-rose-700 dark:text-rose-300" : bal < 0 ? "bg-amber-500/10 text-amber-800 dark:text-amber-300" : "bg-emerald-500/10 text-emerald-700 dark:text-emerald-300")}>
              <dt>{bal < 0 ? t("Credit (refund due)") : bal > 0 ? t("Balance to pay") : t("All paid")}</dt><dd className="tabular-nums">{bal === 0 ? formatTZS(0) : formatTZS(Math.abs(bal))}</dd>
            </div>
          </dl>
          <div className="mt-3 space-y-2">
            {s.rooms.map((r) => (
              <DiscountEditor key={r.id} reservationId={s.id} canEdit={perms.discount} max={perms.discountMax}
                room={{ id: r.id, number: r.number, ratePerNight: r.ratePerNight, discountPerNight: r.discountPerNight, nights: r.nights }} />
            ))}
          </div>

          {panel === "charge" && (
            <div className="mt-4 rounded-2xl border border-border/70 p-3">
              <ChargeComposer reservationId={s.id} roomLabel={roomsLabel} recent={recent} methods={methods} canPay={perms.pay} menu={menu} menuPayNow={menuPayNow} onPosted={() => setPanel(null)} />
            </div>
          )}
          {panel === "pay" && (<>
            {/* The main way: a prompt to the guest's phone (nTZS, outside any form). Cash, LIPA or bank folded below. */}
            {s.balance > 0 && <SendToPhone target={{ kind: "stay", reservationId: s.id }} amount={s.balance} editableAmount phone={s.phone} who={s.guest} onPaid={() => setPanel(null)} className="mt-4" primary />}
            <OtherWays className="mt-2" fold={s.balance > 0}>
            <ActionForm action={recordPaymentAction} resetOnSuccess onSuccess={() => { setPanel(null); router.refresh(); }} className="space-y-2 rounded-2xl border border-border/70 p-3">
              {({ pending: p, fieldErrors: e }) => (
                <>
                  <input type="hidden" name="reservationId" value={s.id} />
                  <p className="text-sm font-semibold">{t("Record a payment")}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <div><Input name="amount" type="number" min={1} step={1000} defaultValue={s.balance} aria-label={t("Amount")} /><FieldError message={e?.amount} /></div>
                    <AccountSelect name="accountId" accounts={methods} />
                  </div>
                  <Input name="reference" placeholder={t("Reference (M-Pesa code, receipt…)")} aria-label={t("Reference")} />
                  <Button type="submit" className="w-full" disabled={p}>{p && <Loader2 className="animate-spin" />}{t("Save payment")}</Button>
                </>
              )}
            </ActionForm>
            </OtherWays>
          </>)}

          {s.tab.length > 0 && (
            <div className="mt-4 border-t border-dashed border-border pt-3">
              <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("Extras on the room")}</p>
              <GuestTab reservationId={s.id} charges={s.tab} canVoid={perms.void} />
            </div>
          )}
          {s.payments.length > 0 && (
            <ul className="mt-4 space-y-1.5 border-t border-dashed border-border pt-3 text-xs">
              {s.payments.map((p) => (
                <li key={p.id} className="flex justify-between gap-2">
                  <span className="text-muted-foreground">{dt(t, p.at)} · {t(p.method)}{p.reference ? ` · ${p.reference}` : ""} · {p.by}</span>
                  <span className={cn("font-semibold tabular-nums", p.refund ? "text-rose-600" : "text-emerald-600 dark:text-emerald-400")}>{p.refund ? "−" : "+"}{formatTZS(p.amount)}</span>
                </li>
              ))}
            </ul>
          )}
        </Box>

        {/* Extend */}
        <Box icon={<CalendarPlus />} title={t("Nights — add or take off")}>
          {perms.extend ? s.rooms.map((r) => (
            <div key={r.id} className={cn(s.rooms.length > 1 && "mb-4")}>
              {s.rooms.length > 1 && <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold"><BedDouble className="size-4" />{t("Room {room}", { room: r.number })}</p>}
              <ExtendStay reservationId={s.id} today={s.today} room={r} canDiscount={perms.discount} discountMax={perms.discountMax} />

            </div>
          )) : <p className="text-sm text-muted-foreground">{t("Ask a supervisor to extend this stay.")}</p>}
          <p className="mt-3 flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-0.5 size-3.5 shrink-0" />{t("Same booking, same account: payments and charges stay. Added nights go on the balance; nights taken off come off it. If the room is booked next, the guest moves with everything.")}</p>
        </Box>
      </div>

      {/* Check out */}
      <Box icon={<LogOut />} title={t("Check out")} className="border-foreground/10">
        {previewError ? <p className="text-sm text-destructive">{previewError}</p> : !preview ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("Working out the final bill…")}</p>
        ) : (
          <div className="space-y-4">
            {preview.overstayNights > 0 && (
              <div className="space-y-2 rounded-2xl border border-rose-500/30 bg-rose-500/[0.06] p-3">
                <p className="flex items-start gap-2 text-sm">
                  <CalendarPlus className="mt-0.5 size-4 shrink-0 text-rose-600 dark:text-rose-400" />
                  <span>{t.rich("Stayed <b>{nights}</b> past checkout —", { b: (c) => <strong>{c}</strong> }, { nights: t.plural(preview.overstayNights, "{n} night", "{n} nights") })} {chargeOverstay === false
                    ? <span className="text-muted-foreground">{t("not charged (manager).")}</span>
                    : t.rich("<b>{amount}</b> is on the bill already.", { b: (c) => <strong className="tabular-nums">{c}</strong> }, { amount: formatTZS(preview.overstayAmount) })}</span>
                </p>
                {perms.override && (
                  <label className="flex items-center gap-2 pl-6 text-xs text-muted-foreground">
                    <input type="checkbox" checked={chargeOverstay === false} onChange={(e) => setChargeOverstay(e.target.checked ? false : null)} />{t("Don't charge the extra nights (manager decision)")}
                  </label>
                )}
              </div>
            )}
            {preview.early && (
              <div className="space-y-1.5">
                <Label htmlFor="early" className="text-sm">{t("Leaving before the booked date — why? *")}</Label>
                <Input id="early" value={earlyReason} onChange={(e) => setEarlyReason(e.target.value)} placeholder={t("Change of plans, complaint, emergency…")} />
                <p className="text-xs text-muted-foreground">{t("Unused nights are removed from the bill (the hotel's early-departure policy applies).")}</p>
              </div>
            )}

            {/* The final bill, line by line — worked out by the system. */}
            <dl className="space-y-1 rounded-2xl border border-border/70 p-4 text-sm">
              {([
                [msg("Room charges"), preview.gross],
                [msg("Restaurant"), preview.chargesByKind.restaurant],
                [msg("Room service"), preview.chargesByKind.roomService],
                [msg("Bar & minibar"), preview.chargesByKind.bar],
                [msg("Transport"), preview.chargesByKind.transport],
                [msg("Other charges"), preview.chargesByKind.other],
                [msg("Discount on the bill"), preview.chargesByKind.discount],
              ] as const).filter(([, v], i) => i === 0 || v !== 0).map(([k, v]) => (
                <Fragment key={k}>
                  <div className="flex justify-between"><dt className="text-muted-foreground">{t(k)}</dt><dd className="tabular-nums">{formatTZS(v)}</dd></div>
                  {/* Each table's order on the bill: "Restaurant — Outside 3 · #184". */}
                  {k === "Restaurant" && preview.orders.filter((o) => !o.roomService).map((o) => (
                    <div key={o.id} className="flex justify-between gap-3 pl-3 text-xs text-muted-foreground"><dt className="truncate">{orderLabel(t, o.label)}</dt><dd className="tabular-nums">{formatTZS(o.amount)}</dd></div>
                  ))}
                </Fragment>
              ))}
              {preview.discount > 0 && <div className="flex justify-between text-emerald-600 dark:text-emerald-400"><dt>{t("Discounts")}</dt><dd className="tabular-nums">− {formatTZS(preview.discount)}</dd></div>}
              <div className="flex justify-between border-t border-border pt-1 font-semibold"><dt>{t("Total")}</dt><dd className="tabular-nums">{formatTZS(preview.total)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{t("Paid")}</dt><dd className="tabular-nums">{formatTZS(preview.paid)}</dd></div>
              {preview.company && preview.company.billedBefore + billed !== 0 && <div className="flex justify-between"><dt className="text-muted-foreground">{t("On {company}'s invoice", { company: preview.company.name })}</dt><dd className="tabular-nums">{formatTZS(preview.company.billedBefore + billed)}</dd></div>}
            </dl>

            <OpenOrdersNote reservationId={s.id} room={roomsLabel} orders={preview.openOrders} canCharge={perms.order ?? false} />

            <div className={cn("flex flex-wrap items-end justify-between gap-4 rounded-2xl p-4", owes ? "bg-rose-500/10" : "bg-emerald-500/10")}>
              <div>
                <p className="text-xs font-semibold uppercase tracking-wider">{owes ? t("Payment required — pay balance to check out") : t("Ready to check out")}</p>
                <p className="text-xs uppercase tracking-wider text-muted-foreground">{preview.company ? t("Guest pays") : t("Outstanding")}</p>
                <p className={cn("text-3xl font-bold tabular-nums", owes ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>{formatTZS(Math.max(0, finalBalance))}</p>
                {preview.total !== s.total && <p className="text-xs text-muted-foreground">{t("Final total {total} (was {was})", { total: formatTZS(preview.total), was: formatTZS(s.total) })}</p>}
              </div>
              {billed !== 0 && <p className="max-w-xs text-right text-xs text-muted-foreground">{owes ? t("{amount} goes on {company}'s invoice — the guest pays the rest.", { amount: formatTZS(billed), company: preview.company!.name }) : t("{amount} goes on {company}'s invoice — nothing more for the guest to pay.", { amount: formatTZS(billed), company: preview.company!.name })}</p>}
            </div>
            {group ? (
              <div className={cn("space-y-1.5 rounded-xl border p-3 text-xs", group.last ? "border-violet-500/40 bg-violet-500/[0.08]" : "border-[oklch(0.75_0.13_80)]/40 bg-[oklch(0.75_0.13_80)]/[0.07]")}>
                <p className="flex items-center gap-1.5 text-sm font-semibold"><Users className="size-4" />{group.last ? t("Final group check-out") : t("Group check-out in progress")}</p>
                <p className="text-muted-foreground">
                  {t.rich("Group <b>{name}</b> · <ref>{reference}</ref> — {amount} goes on the group's bill to <b>{payer}</b>. The guest pays nothing.", { b: (c) => <strong className="text-foreground">{c}</strong>, ref: (c) => <span className="font-mono">{c}</span> }, { name: group.name, reference: group.reference, amount: formatTZS(billed), payer: group.payer })}
                </p>
                <p className="font-medium">
                  {group.finalized ? t("The group's final invoice is already made — this becomes an adjustment on the group page.")
                    : group.last ? t("This is the last active guest in this group. After check-out, all room, restaurant, bar and service charges go on one final invoice.")
                      : t.plural(group.remaining, "{n} other room of the group still staying or to come — the final invoice waits for the last one.", "{n} other rooms of the group still staying or to come — the final invoice waits for the last one.")}
                </p>
              </div>
            ) : preview.company && billed !== 0 && <CompanyBillBox company={preview.company} mode={mode} onMode={setInvoiceMode} />}

            {owes && perms.pay && (
              <div className="grid gap-2 sm:grid-cols-3">
                <div className="space-y-1"><Label htmlFor="pay-method" className="text-xs">{t("Payment method")}</Label>
                  <AccountSelect id="pay-method" accounts={methods} value={pay.accountId} onChange={(v) => setPay({ ...pay, accountId: v })} /></div>
                <div className="space-y-1"><Label htmlFor="pay-amount" className="text-xs">{t("Amount received (TZS)")}</Label>
                  <Input id="pay-amount" type="number" min={0} step={1000} value={pay.amount} onChange={(e) => setPay({ ...pay, amount: e.target.value })} className="h-10" /></div>
                <div className="space-y-1"><Label htmlFor="pay-ref" className="text-xs">{t("Reference")}</Label>
                  <Input id="pay-ref" value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder={t("M-Pesa code, receipt…")} className="h-10" /></div>
              </div>
            )}
            {owes && perms.override && (
              <div className="space-y-2">
                <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={leaveOwing} onChange={(e) => setLeaveOwing(e.target.checked)} />{amount > 0 && !coversAll ? t("Let the guest leave owing the rest (manager)") : t("Let the guest leave owing the balance (manager)")}</label>
                {leaveOwing && <Input value={overrideReason} onChange={(e) => setOverrideReason(e.target.value)} placeholder={t("Why? e.g. pays by bank transfer tomorrow *")} />}
              </div>
            )}
            {owes && s.leaveOwing && (
              <p className={cn("rounded-xl px-3 py-2 text-xs", approvedOwing ? "bg-emerald-500/10 text-emerald-800 dark:text-emerald-300" : "bg-amber-500/10 text-amber-800 dark:text-amber-300")}>
                {approvedOwing
                  ? t.rich("<b>{name}</b> allowed this guest to leave owing (up to TZS {amount}) — {reason}. You can check them out without the full payment; the rest stays on their account.", { b: (c) => <strong>{c}</strong> }, { name: s.leaveOwing.by, amount: s.leaveOwing.upTo.toLocaleString("en-US"), reason: s.leaveOwing.reason })
                  : t("A manager allowed leaving owing up to TZS {amount}, but the guest now owes more. Receive a payment, or ask the manager again.", { amount: s.leaveOwing.upTo.toLocaleString("en-US") })}
              </p>
            )}
            {owes && !perms.override && !approvedOwing && amount > 0 && !coversAll && (
              <p className="text-xs text-amber-700 dark:text-amber-400">{t("The full balance must be paid to check out — or a manager can allow the guest to leave owing (on the room card).")}</p>
            )}

            <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
              <p className="text-xs text-muted-foreground">
                {needsOverstayChoice ? t("Choose whether to charge the extra nights.") : needsEarly ? t("Give the reason for leaving early.") : t("Room {room} will be sent to cleaning.", { room: roomsLabel })}
              </p>
              <Button size="lg" className="h-12 px-6 text-base font-semibold" disabled={blocked || pending} onClick={() => setConfirmOpen(true)}>
                {billed !== 0 && !owes ? <FileText /> : <LogOut />}
                {owes && amount > 0 ? t("Record payment & check out") : group ? (group.last ? t("Final group check-out") : t("Check out · bill to group")) : billed !== 0 ? (mode === "ISSUE" ? t("Check out & issue invoice") : t("Check out & bill company")) : t("Check out guest")}
              </Button>
            </div>
          </div>
        )}
      </Box>

      <AlertDialog open={confirmOpen} onOpenChange={setConfirmOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t("Check out {guest} from Room {room}?", { guest: s.guest, room: roomsLabel })}</AlertDialogTitle>
            <AlertDialogDescription render={<div />}>
              <div className="space-y-1 text-sm">
                {group ? <p>{t.rich("On the group's bill ({payer}): <b>{amount}</b>", { b: (c) => <strong>{c}</strong> }, { payer: group.payer, amount: formatTZS(billed) })}{group.last && <>{" — "}{t("the last room: you'll confirm the final invoice next.")}</>}</p>
                  : billed !== 0 && <p>{mode === "ISSUE"
                    ? t.rich("Invoice for {company}: <b>{amount}</b>", { b: (c) => <strong>{c}</strong> }, { company: preview?.company?.name ?? "", amount: formatTZS(billed) })
                    : t.rich("Added to the open invoice for {company}: <b>{amount}</b>", { b: (c) => <strong>{c}</strong> }, { company: preview?.company?.name ?? "", amount: formatTZS(billed) })}</p>}
                {owes && amount > 0 && <p>{t.rich("Payment: <b>{amount}</b> by {method}", { b: (c) => <strong>{c}</strong> }, { amount: formatTZS(Math.min(amount, finalBalance)), method: (() => { const n = methods.find((m) => m.id === pay.accountId)?.name; return n ? t(n) : ""; })() })}</p>}
                <p>{t.rich("Guest balance after: <b>{amount}</b>", { b: (c) => <strong>{c}</strong> }, { amount: formatTZS(Math.max(0, finalBalance - (owes ? Math.min(amount, finalBalance) : 0))) })}{willLeaveOwing ? ` ${t("(left owing)")}` : ""}</p>
                <p className="flex items-center gap-1.5"><Clock className="size-3.5" />{t("Room will be sent to cleaning.")}</p>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={pending}>{t("Cancel")}</AlertDialogCancel>
            <Button onClick={finish} disabled={pending}>{pending && <Loader2 className="animate-spin" />}{owes && amount > 0 ? t("Confirm payment & check out") : billed !== 0 && mode === "ISSUE" ? t("Confirm & issue invoice") : t("Confirm checkout")}</Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </article>
  );
}
