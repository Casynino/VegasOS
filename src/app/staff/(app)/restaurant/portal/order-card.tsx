"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { motion } from "motion/react";
import { ArrowRight, ArrowRightLeft, Ban, Banknote, BanknoteX, BedDouble, Bike, Check, CircleMinus, Plus, Printer, ShieldCheck, Undo2, CheckCheck, CircleCheck, CreditCard, HandCoins, HandPlatter, History, Landmark, Loader2, MessageCircle, Phone, Receipt, ShoppingBag, Smartphone, Store, UtensilsCrossed, UserRoundCheck, Wallet, Wine, X, MapPin, Download, Eye, Image as ImageIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { TransferDialog } from "@/components/staff/transfer-dialog";
import { useWaiterPin, type WaiterPinValue } from "@/components/staff/waiter-pin";
import { BroughtBySelect } from "@/components/staff/brought-by-select";
import type { PayAccount } from "@/lib/pay-account";
import { cn } from "@/lib/utils";
import { IconAction, WhatsAppGlyph } from "./icon-action";
import { chargeOrderToRoomAction, confirmOrderPaymentAction, declineOrderAction, markPaymentNotReceivedAction, recordOrderPaymentAction, reverseOrderPaymentAction, setItemPreparedAction, setOrderPhoneAction, setOrderStatusAction } from "../actions";
import { validPhone } from "@/lib/guest-messages";
import { logGuestMessageAction } from "@/app/staff/(app)/guests/actions";
import { BillTo, OrderCardActions } from "../order-card-actions";
import { takeChargeAction, transferOrderAction } from "../waiter-actions";
import { ChangeWhoPays, ManagerOrderTools } from "./manager-order-tools";
import type { PortalOrder, PortalPerms, PortalRole, PortalStay, RoomChoice } from "./types";
import { RemoveItemDialog } from "@/components/staff/remove-item-dialog";

export const TYPE: Record<string, { label: string; icon: typeof BedDouble }> = {
  ROOM_SERVICE: { label: "Room service", icon: BedDouble }, DINE_IN: { label: "Restaurant", icon: UtensilsCrossed },
  TAKEAWAY: { label: "Takeaway", icon: ShoppingBag }, PICKUP: { label: "Pickup", icon: Store },
};
export const clock = (iso: string) => new Date(iso).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
/** 7 → "7 min", 75 → "1 h 15", 1126 → "18 h", 3000 → "2 days". */
export const since = (min: number) => (min < 1 ? "now" : min < 60 ? `${min} min` : min < 600 ? `${Math.floor(min / 60)} h ${min % 60}` : min < 2880 ? `${Math.round(min / 60)} h` : `${Math.round(min / 1440)} days`);
export const shortNo = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;
const tzs = (v: number) => `TZS ${v.toLocaleString("en-US")}`;
const first = (n: string | null) => (n ? n.replace(/\s*\(.*\)/, "").split(" ")[0] : null);
export const allPrepared = (o: PortalOrder) => o.items.every((i) => i.prepared);

/** The status colour: a thin edge, a soft tint and the place tile (like the reception room cards). */
export const ACCENT: Record<string, { bar: string; tint: string; tile: string }> = {
  PENDING: { bar: "bg-sky-500", tint: "from-sky-500/[0.07]", tile: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  ACCEPTED: { bar: "bg-amber-500", tint: "from-amber-500/[0.07]", tile: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  PREPARING: { bar: "bg-amber-500", tint: "from-amber-500/[0.07]", tile: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  READY: { bar: "bg-emerald-500", tint: "from-emerald-500/[0.07]", tile: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" },
  OUT_FOR_DELIVERY: { bar: "bg-violet-500", tint: "from-violet-500/[0.07]", tile: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  DELIVERED: { bar: "bg-rose-500", tint: "from-rose-500/[0.06]", tile: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
  COMPLETED: { bar: "bg-slate-400", tint: "from-slate-500/[0.05]", tile: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
  COLLECTED: { bar: "bg-slate-400", tint: "from-slate-500/[0.05]", tile: "bg-slate-500/15 text-slate-700 dark:text-slate-300" },
  CANCELLED: { bar: "bg-rose-400", tint: "from-rose-500/[0.05]", tile: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
};
/** What goes in the tile: the room number, the table number, or an icon. */
export function tileText(o: PortalOrder): React.ReactNode {
  if (o.type === "ROOM_SERVICE" && o.room) return o.room.split(",")[0].trim();
  if (o.location?.kind === "TABLE" && o.location.number) return `T${o.location.number}`;
  const table = o.table?.match(/^\s*(?:table\s*)?(\d{1,3})\s*$/i)?.[1];
  if (o.type === "DINE_IN" && table) return `T${table}`;
  const Icon = (TYPE[o.type] ?? TYPE.DINE_IN).icon;
  return <Icon className="size-5" />;
}

const STATUS_WORD: Record<string, string> = {
  PENDING: "New", ACCEPTED: "Accepted", PREPARING: "Preparing", READY: "Ready to serve", OUT_FOR_DELIVERY: "Serving", DELIVERED: "Served · to pay",
  COMPLETED: "Completed", COLLECTED: "Completed", CANCELLED: "Cancelled",
};
const STATUS_TONE: Record<string, string> = {
  PENDING: "bg-sky-500/15 text-sky-300", ACCEPTED: "bg-amber-500/15 text-amber-300", PREPARING: "bg-amber-500/15 text-amber-300", READY: "bg-emerald-500/15 text-emerald-300",
  OUT_FOR_DELIVERY: "bg-violet-500/15 text-violet-300", DELIVERED: "bg-rose-500/15 text-rose-300", COMPLETED: "bg-white/10 text-white/70", COLLECTED: "bg-white/10 text-white/70", CANCELLED: "bg-rose-500/15 text-rose-300",
};

/** An icon for a payment account by its name: cash, mobile money, card, or a bank. */
const accountIcon = (name: string) => (/cash/i.test(name) ? Banknote : /m-?pesa|tigo|airtel|halo|mixx|mobile|lipa/i.test(name) ? Smartphone : /card|pos|visa|master/i.test(name) ? CreditCard : Landmark);

/**
 * How the order is paid, as a small tinted badge — separate from where it is in the kitchen (paid + preparing is normal):
 * Unpaid · Payment pending · Part-paid · Paid · <account> · Paid online (from the customer's proof) · Charged to room · Refunded.
 */
export function payBadge(o: PortalOrder) {
  if (o.payments.some((p) => p.notReceived)) {
    // Money taken at the Counter on top (items added later) was reversed too — that part is owed back.
    const back = o.payments.filter((p) => p.status !== "POSTED" && !p.notReceived).reduce((t, p) => t + p.amount, 0);
    return { text: back ? `Payment not received · ${tzs(back)} to give back` : "Payment not received", tone: "bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300" };
  }
  if (o.payment === "REFUNDED") return { text: "Refunded", tone: "bg-slate-500/10 text-slate-600 ring-slate-500/20 dark:text-slate-300" };
  // Paid online first: recorded automatically from the customer's proof — never collected again.
  if (o.payments.some((p) => p.online && p.status === "POSTED") && o.payment === "PAID") return { text: `Paid online${o.paidTo ? ` · ${o.paidTo}` : ""}`, tone: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300" };
  if (o.awaitsPayment && o.status !== "CANCELLED") return { text: "Paid online · to confirm", tone: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300" };
  if (o.settlement === "ROOM") return { text: `Charged to room${o.room ? ` · Room ${o.room}` : ""}`, tone: "bg-violet-500/10 text-violet-700 ring-violet-500/20 dark:text-violet-300" };
  if (o.payment === "PAID") return { text: `Paid${o.paidTo ? ` · ${o.paidTo}` : ""}`, tone: "bg-emerald-500/10 text-emerald-700 ring-emerald-500/20 dark:text-emerald-300" };
  if (o.payment === "PENDING_CONFIRMATION") return { text: "Payment pending", tone: "bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300" };
  if (o.payment === "PARTIALLY_PAID") return { text: `Part-paid · ${tzs(o.due ?? 0)} due`, tone: "bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300" };
  return { text: o.due != null && o.status !== "CANCELLED" ? `Unpaid · ${tzs(o.due)}` : "Unpaid", tone: "bg-rose-500/10 text-rose-700 ring-rose-500/20 dark:text-rose-300" };
}

/** The badge as this person reads it: someone who does not record payments (a waiter) sees that the Counter confirms an online payment. */
export function payBadgeFor(o: PortalOrder, perms: PortalPerms, role?: PortalRole) {
  if (o.awaitsPayment && o.status !== "CANCELLED" && !perms.pay && role !== "manager") return { text: "Paid online · the Counter confirms it", tone: "bg-sky-500/10 text-sky-700 ring-sky-500/20 dark:text-sky-300" };
  return payBadge(o);
}

/**
 * One order as a clean ticket: where it goes, who for, what is in it (food, drinks),
 * the note, how it is paid — and the one button this person presses next.
 */
export function OrderCard({ o, perms, now, fresh, accounts, rooms, drag, roomy, role, sheetOnly, onClose, meId }: {
  o: PortalOrder; perms: PortalPerms; now: number; fresh: boolean; accounts: PayAccount[];
  /** The signed-in person — their own order can be transferred from their phone. */
  meId?: string | null;
  /** Every staying room — sent only to reception and managers (they check stays); empty for waiters, who get the order's own stays. */
  rooms: RoomChoice[];
  /** Reception ("desk") gets its own buttons: text the customer, record the payment. */
  role?: PortalRole;
  drag?: { onStart: () => void; onEnd: () => void } | null;
  /** Opened large (e.g. tapped on Take an order): words on every button, extra actions on their own row. */
  roomy?: boolean;
  /** Show just the opened order (the side sheet), e.g. tapped on Take an order; onClose when it shuts. */
  sheetOnly?: boolean;
  onClose?: () => void;
}) {
  const router = useRouter();
  const askPin = useWaiterPin();
  const [pending, start] = useTransition();
  const [transfer, setTransfer] = useState(false);
  const transferPin = useRef<WaiterPinValue | undefined>(undefined);
  const [ticks, setTicks] = useState<Record<string, boolean>>({});
  const [deliver, setDeliver] = useState(false);
  const [sheet, setSheetState] = useState(!!sheetOnly);
  const [payFocus, setPayFocus] = useState(false);
  const [payingNow, setPayingNow] = useState(false);
  const topRef = useRef<HTMLDivElement>(null);
  const payRef = useRef<HTMLDivElement>(null);
  const setSheet = (v: boolean) => { setSheetState(v); if (!v) { setPayFocus(false); setPayingNow(false); if (onClose) setTimeout(onClose, 200); } };
  const [changeBill, setChangeBill] = useState(false);
  const [declining, setDeclining] = useState(false);
  const [why, setWhy] = useState("");
  const [soldOut, setSoldOut] = useState<string[]>([]);
  // Paid first: the account and code the customer gave are ready to record.
  const [account, setAccount] = useState((o.proof?.accountId && accounts.some((a) => a.id === o.proof!.accountId) ? o.proof.accountId : accounts[0]?.id) ?? "");
  const [reference, setReference] = useState(o.proof?.reference ?? "");
  const [viewProof, setViewProof] = useState(false);
  // On the Restaurant Counter: the waiter who brought the money (optional — the Counter records the payment).
  const [broughtBy, setBroughtBy] = useState("");
  const [reversing, setReversing] = useState<PortalOrder["payments"][number] | null>(null);
  const [reverseWhy, setReverseWhy] = useState("");
  const t = TYPE[o.type] ?? TYPE.DINE_IN;
  const accent = ACCENT[o.status] ?? ACCENT.PENDING;
  const done = ["COMPLETED", "COLLECTED", "CANCELLED"].includes(o.status);
  const waited = Math.max(0, Math.round((now - new Date(o.createdAt).getTime()) / 60000));
  const timerTone = o.readyAt || done ? "text-muted-foreground" : waited >= 25 ? "text-rose-600 dark:text-rose-400" : waited >= 15 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground";
  const food = o.items.filter((i) => i.type !== "DRINK"), drinks = o.items.filter((i) => i.type === "DRINK");
  const itemCount = o.items.reduce((t, i) => t + i.quantity, 0);
  const prepared = (id: string, v: boolean) => ticks[id] ?? v;
  const left = o.items.filter((i) => !prepared(i.id, i.prepared)).length;
  // One restaurant: the Mpishi and the waiters prepare any order (food, drinks or both); reception never.
  const drinksOnly = o.items.length > 0 && o.items.every((i) => i.type === "DRINK");
  const canPrep = perms.cook || (drinksOnly && perms.bar);
  const desk = role === "desk";
  // A waiter on their own phone: they accept; drinks only they bring themselves (no ticking, no "Ready"),
  // food goes to the kitchen — the Mpishi ticks it and marks it ready. The Counter and the cook work as before.
  const waiterPhone = perms.serve && !perms.device && !perms.watch && !perms.pay && role !== "cook";
  const canTick = canPrep && !desk && !waiterPhone && (o.status === "ACCEPTED" || o.status === "PREPARING");
  // Money still due on a direct order (never for the cook — they see no money).
  const due = o.due ?? 0;
  const unpaid = due > 0;
  const toConfirm = o.payments.filter((p) => p.status === "POSTED" && !p.confirmedAt);
  // Paid online first (the customer's proof): recorded automatically as it comes in. Only when nothing could be recorded
  // from the proof does it wait for the Counter (or reception) to confirm it once — never collected again.
  const online = o.awaitsPayment && !!o.proof && unpaid;
  const confirmsOnline = online && perms.pay;
  // Waiting for that check: nobody accepts it until the Counter (or reception) has checked the account.
  const checkPay = o.status === "PENDING" && o.awaitsPayment;
  // Paid online (recorded automatically): the Counter or reception says "Payment not received" if the money never
  // reached the account — the payment is taken off (not counted, no refund) and the order declined. Not once it is ready.
  const paidOnline = o.payments.filter((p) => p.online && p.status === "POSTED");
  // Only those who check the accounts (the Counter, reception) say a payment never arrived — never a waiter or the Mpishi.
  const checksMoney = perms.pay && perms.confirm && !perms.watch;
  const canNotReceived = paidOnline.length > 0 && checksMoney && ["PENDING", "ACCEPTED", "PREPARING"].includes(o.status);
  const [notIn, setNotIn] = useState(false);
  // Money taken at the Counter on top of the online payment (items added later) — reversed with it, owed back.
  const counterTaken = o.payments.filter((p) => p.status === "POSTED" && !p.online).reduce((t, p) => t + p.amount, 0);
  // Taking an item off the order (with a reason): whoever takes orders, before the kitchen made it; once made, a manager.
  // A paid item never (the server checks again).
  const [removing, setRemoving] = useState<PortalOrder["items"][number] | null>(null);
  const madeItem = (i: PortalOrder["items"][number]) => i.prepared || ["READY", "OUT_FOR_DELIVERY", "DELIVERED"].includes(o.status);
  const canRemove = (i: PortalOrder["items"][number]) => !done && !i.paid && !o.awaitsPayment && o.total != null
    && ((perms.waiter && !perms.watch) || perms.cancelLate) && (!madeItem(i) || perms.cancelLate);
  const pay = payBadgeFor(o, perms, role);
  // One waiter answers for each open order: a waiter moving on one nobody has (Accept, Take order…) makes it theirs —
  // on the restaurant screen with their PIN — and hands their own to a colleague with the reason. The Mpishi and reception only see who it is.
  const worker = perms.serve && !perms.watch && role !== "cook" && (!!perms.device || !desk);
  const canTransfer = worker && !done && !!o.assignedTo && (!!perms.device || o.assignedTo.id === meId);
  const waiterName = o.assignedTo ? first(o.assignedTo.name) : null;
  const canAdd = perms.serve && ["PENDING", "ACCEPTED", "PREPARING", "DELIVERED"].includes(o.status);
  // The customer ordered more: the new round first, what was served before in one quiet line.
  const current = o.round > 1 ? o.items.filter((i) => i.round === o.round) : o.items;
  const earlier = o.round > 1 ? o.items.filter((i) => i.round < o.round) : [];

  const step = async (status: string, withPay?: { accountId: string; reference?: string; handedOverById?: string | null }) => {
    // On the Restaurant Counter the waiter says who they are (their ID) only when nobody has the order yet: pressing
    // the step makes it theirs. Money paid with the step is recorded by the Counter itself — never under a waiter.
    const pin = perms.device && !o.assignedTo ? await askPin(`${shortNo(o.number)} · ${o.place}`) : undefined;
    if (pin === null) return;
    start(async () => {
      const res = await setOrderStatusAction({ id: o.id, status: status as never, pay: withPay, pin });
      if (res.ok) { setDeliver(false); if (withPay) setBroughtBy(""); router.refresh(); } else toast.error(res.error, { duration: 8000 });
    });
  };
  // On the Counter the order is handed on for its waiter (no code) — the transfer window picks who takes it.
  // The Counter gives an order nobody has to a waiter on shift (picked from the list) — it is theirs at once.
  const assignWaiter = async () => {
    const pin = await askPin(`${shortNo(o.number)} · ${o.place}`);
    if (!pin) return;
    start(async () => {
      const r = await takeChargeAction({ orderId: o.id, pin });
      if (r.ok) { toast.success(`${shortNo(o.number)} is ${r.data.waiter.split(" ")[0]}'s now.`); router.refresh(); } else toast.error(r.error, { duration: 8000 });
    });
  };
  const openTransfer = () => {
    transferPin.current = perms.device && o.assignedTo ? { waiterId: o.assignedTo.id } : undefined;
    setTransfer(true);
  };
  const beforeTransfer = async () => true;
  const submitTransfer = async (to: string, reason: string) => {
    const res = await transferOrderAction({ orderId: o.id, toWaiterId: to, reason, pin: transferPin.current });
    return res;
  };
  const tick = (id: string, value: boolean) => {
    setTicks((m) => ({ ...m, [id]: value }));
    start(async () => {
      const res = await setItemPreparedAction({ orderId: o.id, itemId: id, prepared: value });
      if (res.ok) router.refresh(); else { setTicks((m) => ({ ...m, [id]: !value })); toast.error(res.error); }
    });
  };

  const row = (i: PortalOrder["items"][number]) => {
    const on = prepared(i.id, i.prepared);
    const inner = (
      <>
        {i.image ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={i.image} alt="" draggable={false} className={cn("size-7 shrink-0 rounded-md object-cover", canTick && on && "opacity-40 grayscale")} />
        ) : <span className="grid size-7 shrink-0 place-items-center rounded-md bg-muted text-muted-foreground">{i.type === "DRINK" ? <Wine className="size-3" /> : <UtensilsCrossed className="size-3" />}</span>}
        <span className="w-5 shrink-0 text-xs font-semibold tabular-nums text-muted-foreground">{i.quantity}×</span>
        <span className={cn("min-w-0 flex-1 truncate text-[13px] leading-tight", canTick && on && "text-muted-foreground line-through")}>{i.name}</span>
        {canTick && <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border-2 transition", on ? "border-emerald-500 bg-emerald-500 text-white" : "border-border text-transparent")}><Check className="size-3" strokeWidth={3} /></span>}
      </>
    );
    return (
      <li key={i.id}>
        {canTick ? (
          <button type="button" onClick={() => tick(i.id, !on)} aria-pressed={on} aria-label={`${i.name} ${on ? "done" : "not done"}`}
            className="-mx-1 flex w-[calc(100%+0.5rem)] items-center gap-2 rounded-lg px-1 py-0.5 text-left transition hover:bg-muted/70">{inner}</button>
        ) : <div className="flex items-center gap-2 py-px">{inner}</div>}
      </li>
    );
  };
  const group = (title: string) => <li key={title} className="pt-1 text-[9.5px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/70 first:pt-0">{title}</li>;

  // The one thing to press next — only for whoever does that step.
  const decline = () => start(async () => {
    const res = await declineOrderAction({ id: o.id, reason: why, soldOut });
    if (res.ok) { toast.success(res.message ?? "Declined."); setDeclining(false); router.refresh(); } else toast.error(res.error);
  });
  // The official payment: recorded by whoever is signed in (the Restaurant Counter, reception) — on the Counter it
  // may note the waiter who brought the money.
  const record = (fromRoom = false) => start(async () => {
    const res = await recordOrderPaymentAction({ id: o.id, accountId: account, reference: reference.trim() || undefined, fromRoom, handedOverById: broughtBy || null });
    if (res.ok) { toast.success(`Paid — ${tzs(fromRoom ? o.total ?? 0 : due)}${picked ? ` · ${picked.name}` : ""}.`); setReference(""); setBroughtBy(""); setPayingNow(false); router.refresh(); } else toast.error(res.error);
  });
  // Paid online: recorded once from the customer's proof (their account and code) — it shows Paid online.
  const onlineAccount = o.proof?.accountId ?? account;
  const confirmOnline = () => start(async () => {
    const res = await recordOrderPaymentAction({ id: o.id, accountId: onlineAccount, reference: o.proof?.reference ?? (reference.trim() || undefined) });
    if (res.ok) { toast.success(`Paid online — ${tzs(due)}${o.proof?.account ? ` · ${o.proof.account}` : ""} confirmed.${o.status === "PENDING" ? " The order can be accepted now." : ""}`); router.refresh(); } else toast.error(res.error);
  });
  // The money never reached the account: the online payment is taken off and the order declined.
  const notReceived = () => start(async () => {
    const res = await markPaymentNotReceivedAction({ id: o.id });
    if (res.ok) { toast.success(res.message ?? "Payment not received — order declined."); setNotIn(false); setSheet(false); router.refresh(); } else toast.error(res.error);
  });
  const confirmPay = (paymentId: string) => start(async () => {
    const res = await confirmOrderPaymentAction({ paymentId });
    if (res.ok) { toast.success("Payment confirmed."); router.refresh(); } else toast.error(res.error);
  });
  const reverse = () => start(async () => {
    if (!reversing) return;
    const res = await reverseOrderPaymentAction({ paymentId: reversing.id, reason: reverseWhy });
    if (res.ok) { toast.success("Payment reversed — the amount is due again."); setReversing(null); router.refresh(); } else toast.error(res.error);
  });
  const picked = accounts.find((a) => a.id === account);
  const canDecline = canPrep && !desk && ["PENDING", "ACCEPTED", "PREPARING"].includes(o.status);
  // Delivered and on the customer's own room in one go: the room first, then the step.
  const deliverToRoom = (s: PortalStay) => start(async () => {
    const res = await chargeOrderToRoomAction({ id: o.id, reservationId: s.id });
    if (!res.ok) { toast.error(res.error, { duration: 8000 }); return; }
    const d = await setOrderStatusAction({ id: o.id, status: "DELIVERED" });
    if (d.ok) toast.success(`Served — on Room ${s.rooms}'s bill.`); else toast.error(d.error, { duration: 8000 });
    setDeliver(false); router.refresh();
  });
  // BILL TO for a pay-later order nobody has paid yet: the restaurant, or the customer's room.
  const billRoom = unpaid && !o.paid && perms.waiter && !online;
  // The customer's own staying rooms only — another guest's room is a manager's decision (Change who pays), never the card's.
  const roomBill = { stays: o.stays, rooms: perms.watch ? rooms : null };
  let action: React.ReactNode = null;
  // Reception's job on every order: keep the customer told, and collect the money — two round icons on the card.
  const deskIcons = desk ? (
    <div className="flex shrink-0 items-center gap-1.5">
      <TextCustomer o={o} icon />
      {unpaid && o.status !== "CANCELLED" && perms.pay
        ? <IconAction tip={online ? `Confirm online payment · ${tzs(due)}` : `Record payment · ${tzs(due)}`} onClick={() => { setPayFocus(true); setSheet(true); }}
            className="bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-[oklch(0.2_0.03_60)] shadow-[0_8px_18px_-10px_oklch(0.7_0.12_80)] ring-1 ring-inset ring-white/30 hover:brightness-105">{online ? <ShieldCheck /> : <Wallet />}</IconAction>
        : toConfirm.length > 0 && perms.confirm
          ? <IconAction tip="Confirm the waiter's payment" onClick={() => { setPayFocus(true); setSheet(true); }}
              className="bg-amber-500/15 text-amber-200 ring-1 ring-inset ring-amber-400/45 hover:bg-amber-500/25"><ShieldCheck /></IconAction>
          : null}
    </div>
  ) : null;
  // The Restaurant Counter: an order paid online waits for its one confirmation — a round icon on the card opens it.
  const counterIcon = !desk && confirmsOnline && !checkPay && o.status !== "CANCELLED" ? (
    <IconAction tip={`Confirm online payment · ${tzs(due)}`} onClick={() => { setPayFocus(true); setSheet(true); }}
      className="bg-sky-500/15 text-sky-700 ring-1 ring-inset ring-sky-500/40 hover:bg-sky-500/25 dark:text-sky-200"><ShieldCheck /></IconAction>
  ) : null;
  const declineButton = (
    <motion.button type="button" whileTap={{ scale: 0.97 }} onClick={() => { if (checkPay) setWhy("Payment not received"); setDeclining(true); }}
      className="flex h-9 shrink-0 items-center gap-2 rounded-full border border-rose-500/30 bg-rose-500/[0.06] pl-1 pr-3.5 text-[12.5px] font-semibold text-rose-600 transition hover:bg-rose-500/12 dark:text-rose-300">
      <span className="grid size-7 place-items-center rounded-full bg-rose-500/15 [&_svg]:size-3.5"><X strokeWidth={2.75} /></span>Decline
    </motion.button>
  );
  if (desk) action = null;
  // Paid online: the Counter checks the money is in the account first — then it can be accepted. Not in: decline it.
  else if (checkPay && perms.pay) action = (
    <div className="flex gap-2">
      <motion.button type="button" whileTap={{ scale: 0.97 }} onClick={() => { setPayFocus(true); setSheet(true); }}
        className="group flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full bg-sky-600 pl-1 pr-3.5 text-[12.5px] font-semibold text-white shadow-[0_8px_18px_-12px_rgb(2_132_199)] transition hover:bg-sky-500">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-white/15 [&_svg]:size-3.5"><ShieldCheck /></span>
        <span className="flex-1 truncate text-left">Check payment</span>
        <ArrowRight className="size-3.5 shrink-0 opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
      </motion.button>
      {canPrep && declineButton}
    </div>
  );
  else if (checkPay) action = (
    <div className="flex gap-2">
      <p className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full border border-dashed border-sky-500/40 bg-sky-500/[0.06] pl-1 pr-3.5 text-[12.5px] font-medium text-sky-800 dark:text-sky-200">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-sky-500/15 [&_svg]:size-3.5"><ShieldCheck /></span><span className="truncate">Paid online · the Counter checks it first</span>
      </p>
      {canPrep && declineButton}
    </div>
  );
  else if (o.status === "PENDING" && !canPrep) action = (
    <p className="flex h-9 items-center gap-2 rounded-full border border-dashed border-border/80 bg-muted/25 pl-1 pr-3.5 text-[12.5px] font-medium text-muted-foreground">
      <span className="grid size-7 place-items-center rounded-full bg-muted [&_svg]:size-3.5"><UtensilsCrossed /></span>Waiting for the Mpishi
    </p>
  );
  else if (o.status === "PENDING" && canPrep) action = (
    <div className="flex gap-2">
      <motion.button type="button" whileTap={{ scale: 0.97 }} disabled={pending} onClick={() => step("PREPARING")}
        className="group flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full pl-1 pr-3.5 text-[12.5px] font-semibold transition disabled:opacity-60 bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-[oklch(0.2_0.03_60)] shadow-[0_8px_18px_-12px_oklch(0.7_0.12_80)] ring-1 ring-inset ring-white/30 hover:brightness-105">
        <span className="grid size-7 shrink-0 place-items-center rounded-full bg-black/10 [&_svg]:size-3.5">{pending ? <Loader2 className="animate-spin" /> : <Check strokeWidth={2.75} />}</span>
        <span className="flex-1 text-left">Accept</span>
        <ArrowRight className="size-3.5 shrink-0 opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100" />
      </motion.button>
      {declineButton}
    </div>
  );
  // Accepted drinks (no kitchen): the waiter brings them — Served in one tap (the payment or room bill is asked as for any serve).
  else if ((o.status === "PREPARING" || o.status === "ACCEPTED") && waiterPhone && drinksOnly) action = (
    <Primary pending={pending} onClick={() => (unpaid && !online ? setDeliver(true) : step("DELIVERED"))} icon={<CircleCheck />}>Served</Primary>
  );
  // Accepted food: with the kitchen — the Mpishi makes it and marks it ready; it stays this waiter's.
  else if ((o.status === "PREPARING" || o.status === "ACCEPTED") && waiterPhone) action = (
    <p className="flex h-9 items-center gap-2 rounded-full border border-dashed border-amber-500/40 bg-amber-500/[0.06] pl-1 pr-3.5 text-[12.5px] font-medium text-amber-800 dark:text-amber-200">
      <span className="grid size-7 place-items-center rounded-full bg-amber-500/15 [&_svg]:size-3.5"><UtensilsCrossed /></span>With the kitchen · {left ? `${o.items.length - left} of ${o.items.length} made` : "almost ready"}
    </p>
  );
  // Accepting starts the preparing: tick the items, then Ready.
  else if ((o.status === "PREPARING" || o.status === "ACCEPTED") && canPrep) action = <Primary pending={pending} disabled={left > 0} onClick={() => step("READY")} icon={<Check strokeWidth={2.5} />}>{left > 0 ? `Tick the items · ${left} left` : "Ready"}</Primary>;
  else if (o.status === "READY" && perms.serve) action = <Primary pending={pending} onClick={() => step("OUT_FOR_DELIVERY")} icon={<HandPlatter />}>Serve</Primary>;
  else if (o.status === "OUT_FOR_DELIVERY" && perms.serve) action = <Primary pending={pending} onClick={() => (unpaid && !online ? setDeliver(true) : step("DELIVERED"))} icon={<CircleCheck />}>Served</Primary>;
  // Served, not paid yet: the waiter gives the bill and takes the customer's money to the Counter — the Counter records it.
  else if (o.status === "DELIVERED" && perms.serve && !perms.pay && !perms.watch && unpaid && !online) action = (
    <p className="flex h-9 items-center gap-2 rounded-full border border-dashed border-[oklch(0.75_0.12_80/0.45)] bg-[oklch(0.72_0.12_80/0.06)] pl-1 pr-3.5 text-[12.5px] font-medium text-[oklch(0.5_0.1_75)] dark:text-[oklch(0.84_0.1_82)]">
      <span className="grid size-7 place-items-center rounded-full bg-[oklch(0.72_0.12_80/0.16)] [&_svg]:size-3.5"><HandCoins /></span>Bring the payment to the Counter
    </p>
  );

  const people = [
    o.acceptedAt && `accepted ${clock(o.acceptedAt)}${o.acceptedBy ? ` · ${first(o.acceptedBy)}` : ""}`,
    o.readyAt && `ready ${clock(o.readyAt)}${o.readyBy ? ` · ${first(o.readyBy)}` : ""}`,
    o.takenAt && `serving ${clock(o.takenAt)}${o.takenBy ? ` · ${first(o.takenBy)}` : ""}`,
    o.deliveredAt && `served ${clock(o.deliveredAt)}${o.deliveredBy ? ` · ${first(o.deliveredBy)}` : ""}`,
  ].filter(Boolean);
  // The opened order: the record (label → value), and how far it has come.
  const placed = new Date(o.createdAt);
  const details: [string, React.ReactNode][] = [
    ["Order", <span key="n" className="font-mono">{o.number}</span>],
    ["Placed", `${placed.toDateString() === new Date(now).toDateString() ? "Today" : placed.toLocaleDateString("en-GB", { day: "numeric", month: "short" })} · ${clock(o.createdAt)}`],
    ["Customer", o.customer ?? "Walk-in customer"],
    ...(o.phone ? [["Phone", <a key="p" href={`tel:${o.phone}`} className="font-mono hover:underline">{o.phone}</a>]] as [string, React.ReactNode][] : []),
    [o.type === "ROOM_SERVICE" ? "Room" : o.type === "DINE_IN" ? "Table" : o.address ? "Deliver to" : "Collect at", o.type === "ROOM_SERVICE" ? o.room ?? "—" : o.type === "DINE_IN" ? (o.table ?? "—").replace(/^table\s*/i, "") : o.address ?? o.place],
    ...(o.reservation ? [["Booking", <Link key="b" href={`/staff/reservations/${o.reservation.id}`} className="font-mono hover:underline">{o.reservation.reference}</Link>]] as [string, React.ReactNode][] : []),
    ["Came from", o.sourceLabel],
    ["Placed by", o.createdBy ? o.createdBy.replace(/\s*\(.*\)/, "") : "The customer"],
    ...(o.assignedTo || !done ? [["Waiter", o.assignedTo ? o.assignedTo.name.replace(/\s*\(.*\)/, "") : <span key="w" className="text-amber-700 dark:text-amber-300">No waiter yet</span>]] as [string, React.ReactNode][] : []),
    ...(o.complaints.total ? [["Complaints", <span key="c" className={o.complaints.open ? "font-semibold text-rose-300" : ""}>{o.complaints.open ? `${o.complaints.open} open` : "resolved"}</span>]] as [string, React.ReactNode][] : []),
    ...(o.total != null ? [
      ["Payment", pay.text],
      ["Total", o.paid && o.paid < o.total ? `${tzs(o.total)} · ${tzs(o.paid)} paid` : tzs(o.total)],
    ] as [string, React.ReactNode][] : []),
  ];
  const sum = (xs: PortalOrder["items"]) => xs.reduce((s, i) => s + (i.lineTotal ?? 0), 0);
  const stages = [
    { label: "Received", at: o.createdAt, who: null },
    { label: "Accepted", at: o.acceptedAt, who: o.acceptedBy },
    { label: "Ready", at: o.readyAt, who: o.readyBy },
    { label: "Serving", at: o.takenAt, who: o.takenBy },
    { label: "Served", at: o.deliveredAt, who: o.deliveredBy },
  ];
  const reached = ({ PENDING: 0, ACCEPTED: 1, PREPARING: 1, READY: 2, OUT_FOR_DELIVERY: 3, DELIVERED: 4, COMPLETED: 4, COLLECTED: 4 } as Record<string, number>)[o.status] ?? -1;

  const showSecondary = perms.waiter && !done && (desk ? unpaid || o.status === "PENDING" || o.status === "ACCEPTED" || perms.cancelLate : unpaid || !!o.update || o.status === "PENDING" || o.status === "ACCEPTED" || perms.cancelLate);
  // The payment is always shown to those who see money (a paid order can still be preparing).
  const showPay = o.total != null;
  const secondary = (
    <OrderCardActions id={o.id} number={o.number} total={o.total != null ? tzs(unpaid ? due : o.total) : ""} next={null} nextLabel={null}
      unpaid={unpaid} canCancel={o.status === "PENDING" || o.status === "ACCEPTED" || perms.cancelLate}
      pay={perms.pay && !desk && !online ? { accounts, waiterId: o.assignedTo?.id ?? null } : null} room={unpaid && !o.paid && !online ? roomBill : null} update={desk ? null : o.update} labelled={roomy}
      cancelNote={o.settlement === "ROOM" ? "Its items come off the guest's room bill (kept on record as cancelled)." : o.paid === 0 ? "Nothing was paid yet — it is kept on record as cancelled." : "Its payment is reversed and its sale voided (kept on record as cancelled). Give any refund separately."} />
  );

  // "Pay at the restaurant": the account, the reference, who brought it (on the Counter) and the button.
  const payForm = (
    <>
      <p className="mb-1.5 mt-3.5 text-xs font-semibold text-muted-foreground">How are they paying?</p>
      <AccountPicker accounts={accounts} value={account} onChange={setAccount} />
      <label className="mb-1.5 mt-3.5 block text-xs font-semibold text-muted-foreground" htmlFor={`ref-${o.id}`}>Reference (M-Pesa code, card slip) — optional</label>
      <Input id={`ref-${o.id}`} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. SGH4K2L9PQ" className="h-10 font-mono text-sm uppercase placeholder:normal-case" />
      <BroughtBySelect value={broughtBy} onChange={setBroughtBy} prefill={o.assignedTo?.id} className="mt-3.5" />
      <div className="mt-3.5 flex items-center gap-3">
        <motion.button type="button" whileTap={{ scale: 0.98 }} disabled={pending || !account} onClick={() => record(payingNow)}
          className="flex h-11 min-w-0 flex-1 items-center justify-center gap-2 rounded-xl px-3 bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-sm font-semibold text-[oklch(0.2_0.03_60)] shadow-[0_10px_24px_-14px_oklch(0.7_0.12_80)] ring-1 ring-inset ring-white/30 hover:brightness-105 disabled:opacity-60">
          {pending ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <Wallet className="size-4 shrink-0" />}<span className="truncate">Record {tzs(payingNow ? o.total ?? 0 : due)}{picked ? ` · ${picked.name}` : ""}</span>
        </motion.button>
        {payingNow && <button type="button" onClick={() => setPayingNow(false)} className="shrink-0 px-2 text-sm font-medium text-muted-foreground hover:text-foreground">Leave it</button>}
      </div>
    </>
  );
  // Someone who does not record payments (a waiter, a manager watching): what is due, and who records it.
  const servedUnpaid = o.status === "DELIVERED" && perms.serve && !perms.watch;
  const notPaid = (
    <div className={cn("rounded-2xl bg-rose-500/10 px-3.5 py-3 ring-1 ring-inset ring-rose-500/20", billRoom && "mt-3")}>
      <p className="text-sm font-medium text-rose-700 dark:text-rose-300">Not paid yet · {tzs(due)}</p>
      <p className="mt-0.5 text-xs text-muted-foreground">The Restaurant Counter records the payment{servedUnpaid ? " — bring the payment to the Counter." : "."}</p>
    </div>
  );

  return (
    <motion.div layout layoutId={o.id} id={`order-${o.id}`}
      initial={{ opacity: 0, y: -10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, scale: 0.97 }}
      transition={{ type: "spring", stiffness: 420, damping: 34 }} className="scroll-mt-28 [&:target>article]:border-[oklch(0.75_0.12_80)] [&:target>article]:ring-4 [&:target>article]:ring-[oklch(0.75_0.12_80/0.3)]">
      {!sheetOnly && <article draggable={!!drag} onDragStart={(e) => { e.dataTransfer.effectAllowed = "move"; drag?.onStart(); }} onDragEnd={() => drag?.onEnd()}
        className={cn("rounded-xl border bg-card p-3 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-all duration-150 hover:-translate-y-px hover:shadow-[0_12px_26px_-18px_rgba(15,23,42,0.55)] dark:bg-[oklch(0.22_0.008_60)]",
          fresh ? "border-[oklch(0.75_0.12_80)] ring-4 ring-[oklch(0.75_0.12_80/0.25)]" : "border-border/60", drag && "cursor-grab active:cursor-grabbing")}>
        <header role="button" tabIndex={0} title="Open the order" onClick={() => setSheet(true)} onKeyDown={(e) => { if (e.key === "Enter") setSheet(true); }}
          className="-m-1 flex cursor-pointer items-start gap-2.5 rounded-lg p-1 transition hover:bg-muted/40">
          <span className={cn("grid h-9 min-w-9 shrink-0 place-items-center rounded-lg px-1 text-xs font-bold tabular-nums [&_svg]:size-4", accent.tile)}>{tileText(o)}</span>
          <div className="min-w-0 flex-1 leading-tight">
            <div className="flex items-baseline justify-between gap-2">
              <p className="truncate text-sm font-semibold">{o.place}</p>
              <span suppressHydrationWarning className={cn("shrink-0 text-[11px] font-medium tabular-nums", timerTone)}>{done ? (o.doneAt ? clock(o.doneAt) : "") : since(waited)}</span>
            </div>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">{o.customer ? `${o.customer} · ` : ""}{o.sourceLabel} · {shortNo(o.number)}</p>
          </div>
        </header>

        <ul onClick={canTick ? undefined : () => setSheet(true)} className={cn("mt-2.5 space-y-0.5 border-t border-border/50 pt-2.5", !canTick && "cursor-pointer")}>
          {o.round > 1 && current.length > 0 && group(`More · added ${clock(current[0].addedAt)}`)}
          {o.round > 1 ? current.map(row) : food.length > 0 && drinks.length > 0 ? [group("Food"), ...food.map(row), group("Drinks"), ...drinks.map(row)] : o.items.map(row)}
          {earlier.length > 0 && (
            <li key="earlier" className="truncate pt-1 text-[11px] text-muted-foreground"><CheckCheck className="mr-1 inline size-3 text-emerald-400" />Served before: {earlier.map((i) => `${i.quantity}× ${i.name}`).join(" · ")}</li>
          )}
        </ul>

        {o.proof && <ProofStrip proof={o.proof} onOpen={() => setViewProof(true)} />}
        {canNotReceived && (
          <button type="button" onClick={() => setNotIn(true)}
            className="mt-1.5 flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-rose-500/30 bg-rose-500/[0.05] text-[11.5px] font-semibold text-rose-600 transition hover:bg-rose-500/12 dark:text-rose-300">
            <X className="size-3.5" />Payment not received — decline
          </button>
        )}
        {o.address && <p className="mt-2 flex items-start gap-1.5 rounded-lg bg-sky-500/10 px-2.5 py-1.5 text-[11px] font-medium text-sky-900 dark:text-sky-200"><MapPin className="mt-px size-3 shrink-0" /><span><span className="font-semibold">Deliver to:</span> {o.address}</span></p>}
        {o.notes && <p className="mt-2 rounded-lg bg-amber-500/10 px-2.5 py-1.5 text-[11px] font-medium text-amber-900 dark:text-amber-200">“{o.notes}”</p>}
        {o.cancelReason && <p className="mt-2 rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-[11px] text-rose-800 dark:text-rose-200">Cancelled: {o.cancelReason}</p>}

        {(showPay || deskIcons || (showSecondary && !roomy)) && (
          <div className="mt-2 flex items-center gap-2">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {showPay && <span className={cn("inline-flex items-center rounded-full px-2 py-px text-[10px] font-semibold ring-1 ring-inset", pay.tone)}>{pay.text}</span>}
              {showPay && o.status === "OUT_FOR_DELIVERY" && <span className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-px text-[10px] font-semibold"><Bike className="size-2.5" />{o.address ? "Deliver to the address" : o.type === "ROOM_SERVICE" ? `To ${o.place}` : `Serve at ${o.place}`}</span>}
              {showPay && o.status === "DELIVERED" && <span className="rounded-full bg-muted px-2 py-px text-[10px] font-semibold">{online ? "Served · paid online" : !unpaid ? "Served" : perms.pay ? "Served · waiting for payment" : "Served · pay at the Counter"}</span>}
            </div>
            {deskIcons}
            {counterIcon}
            {/* The waiter's round icons: WhatsApp, room bill, cancel, record payment */}
            {showSecondary && !roomy && secondary}
          </div>
        )}

        {action && <div className="mt-2.5">{action}</div>}

        {/* Who answers for it — everyone sees it, the Mpishi too */}
        {!done && (
          <div className="mt-2 flex items-center gap-1.5">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-1">
              {o.assignedTo
                ? <span className="inline-flex max-w-full items-center gap-1 truncate rounded-full bg-emerald-500/12 px-2 py-px text-[10px] font-semibold text-emerald-700 dark:text-emerald-300"><UserRoundCheck className="size-2.5 shrink-0" />Waiter · {waiterName ?? "—"}</span>
                : <span className="rounded-full bg-amber-500/12 px-2 py-px text-[10px] font-semibold text-amber-700 dark:text-amber-300">No waiter yet</span>}
              {!o.assignedTo && perms.device && !done && (
                <button type="button" disabled={pending} onClick={assignWaiter}
                  className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-[10.5px] font-semibold text-[oklch(0.55_0.11_75)] ring-1 ring-inset ring-[oklch(0.75_0.12_80/0.45)] transition hover:bg-[oklch(0.72_0.12_80/0.12)] dark:text-[oklch(0.84_0.11_82)] [&_svg]:size-3">
                  <UserRoundCheck />Assign waiter
                </button>
              )}
              {o.complaints.open > 0 && <span className="rounded-full bg-rose-500/15 px-2 py-px text-[10px] font-semibold text-rose-700 dark:text-rose-300">Complaint open</span>}
            </div>
            {canTransfer && (
              <button type="button" onClick={openTransfer}
                className="inline-flex h-7 shrink-0 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold text-muted-foreground ring-1 ring-inset ring-border transition hover:bg-muted hover:text-foreground [&_svg]:size-3.5">
                <ArrowRightLeft />Transfer
              </button>
            )}
          </div>
        )}
        <footer className="mt-2 flex items-center gap-1.5">
          <p suppressHydrationWarning className="min-w-0 flex-1 truncate text-[10px] text-muted-foreground" title={people.join(" · ")}>
            In {clock(o.createdAt)}{people.length ? ` · ${people[people.length - 1]}` : ""}
          </p>
          <div className="flex shrink-0 items-center gap-1">
            {canDecline && o.status !== "PENDING" && <MiniIcon tip="Decline the order" onClick={() => setDeclining(true)} tone="text-rose-500 hover:bg-rose-500/12 dark:text-rose-300"><X /></MiniIcon>}
            {canAdd && <MiniIcon tip="Add items — the customer wants more" href={`/staff/restaurant/pos?add=${o.id}`} tone="text-sky-600 hover:bg-sky-500/12 dark:text-sky-300"><Plus /></MiniIcon>}
            {o.status !== "CANCELLED" && <MiniIcon tip={done ? "Receipt — print or download" : "Bill — print or download"} href={`/staff/restaurant-bill?order=${o.id}`} tone="text-[oklch(0.55_0.11_75)] hover:bg-[oklch(0.72_0.12_80/0.12)] dark:text-[oklch(0.8_0.11_82)]"><Receipt /></MiniIcon>}
            <MiniIcon tip="History — every step" href={`/staff/restaurant/orders/${o.id}`} tone="text-muted-foreground hover:bg-muted hover:text-foreground"><History /></MiniIcon>
          </div>
        </footer>
        {showSecondary && roomy && <div className="mt-2 border-t border-border/60 pt-2">{secondary}</div>}
      </article>}

      {/* The whole order, opened: every detail, the money, and this person's buttons */}
      <Dialog open={sheet} onOpenChange={setSheet}>
        <DialogContent initialFocus={payFocus ? payRef : topRef}
          className="max-h-[92svh] gap-0 overflow-y-auto rounded-2xl p-0 ring-white/10 sm:max-w-[560px] [&>[data-slot=dialog-close]]:top-4 [&>[data-slot=dialog-close]]:right-4">
          {/* Where it goes, and where it is */}
          <DialogHeader ref={topRef} tabIndex={-1} icon={<span className="text-sm font-bold tabular-nums">{tileText(o)}</span>} eyebrow="Restaurant" tone="gold" className="mx-0 mt-0 outline-none">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <DialogTitle className="font-semibold tracking-tight">{o.place}</DialogTitle>
              <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-bold", STATUS_TONE[o.status] ?? "bg-white/10")}>{o.status === "DELIVERED" ? (online ? "Served · paid online" : unpaid ? STATUS_WORD.DELIVERED : "Served") : o.status === "OUT_FOR_DELIVERY" && (o.type === "ROOM_SERVICE" || o.address) ? "On the way" : STATUS_WORD[o.status] ?? o.status}</span>
            </div>
            <DialogDescription>{t.label} · Order {shortNo(o.number)} · {done ? `closed ${o.doneAt ? clock(o.doneAt) : ""}` : `${since(waited)} ${waited < 1 ? "" : "ago"}`}</DialogDescription>
          </DialogHeader>

          {/* The record, like a folio: label over value */}
          <dl className="mx-5 mt-4 grid grid-cols-2 gap-x-6 gap-y-3.5 rounded-2xl bg-muted/50 p-4 ring-1 ring-inset ring-white/[0.04]">
            {details.map(([label, value]) => (
              <div key={label} className="min-w-0">
                <dt className="text-xs text-muted-foreground">{label}</dt>
                <dd className="mt-0.5 break-words text-sm font-semibold">{value}</dd>
              </div>
            ))}
          </dl>
          {perms.waiter && o.status !== "CANCELLED" && (
            <div className="mx-5 mt-2.5 grid grid-cols-2 gap-2 [&_a]:h-9 [&_button]:h-9">
              <TextCustomer o={o} />
              {o.phone
                ? <a href={`tel:${o.phone}`} className="inline-flex items-center justify-center gap-1.5 rounded-lg border border-border/70 text-xs font-semibold hover:bg-muted"><Phone className="size-3.5" />Call {first(o.customer) ?? "the customer"}</a>
                : <span />}
            </div>
          )}

          {/* How far it has come */}
          <div className="px-5 pt-5">
            <ol className="relative grid grid-cols-5">
              <span aria-hidden className="absolute left-[10%] right-[10%] top-[13px] h-0.5 rounded-full bg-border" />
              {o.status !== "CANCELLED" && <span aria-hidden className="absolute left-[10%] top-[13px] h-0.5 rounded-full bg-emerald-500 transition-all duration-500" style={{ width: `${(Math.max(0, reached) / 4) * 80}%` }} />}
              {stages.map((s, i) => {
                const on = o.status === "CANCELLED" ? !!s.at : i <= reached;
                return (
                  <li key={s.label} className="relative min-w-0 text-center">
                    <span className={cn("mx-auto grid size-7 place-items-center rounded-full text-[11px] font-bold ring-4 ring-popover",
                      on ? "bg-emerald-500 text-white" : i === reached + 1 && o.status !== "CANCELLED" ? "border-2 border-amber-400 bg-popover text-amber-300" : "border-2 border-border bg-popover text-muted-foreground")}>
                      {on ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
                    </span>
                    <p className={cn("mt-1.5 truncate text-[11px] font-semibold", on ? "text-foreground" : "text-muted-foreground")}>{s.label}</p>
                    <p suppressHydrationWarning className="truncate text-[10px] text-muted-foreground">{s.at ? `${clock(s.at)}${s.who ? ` · ${first(s.who)}` : ""}` : on ? "✓" : "—"}</p>
                  </li>
                );
              })}
            </ol>
            {o.cancelReason && <p className="mt-3 rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-300 ring-1 ring-inset ring-rose-500/20">{o.cancelReason}</p>}
          </div>

          {/* What they ordered */}
          <div className="px-5 pt-5">
            <div className="flex items-center justify-between border-b border-border/70 pb-2 text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
              <span>What they ordered</span>
              {canTick ? <span className="normal-case tracking-normal">{left ? `Tick each one done · ${left} left` : "All done — mark it ready"}</span> : o.total != null && <span>Amount</span>}
            </div>
            <ul className="divide-y divide-border/50">
              {(food.length && drinks.length ? [["Food", food], ["Drinks", drinks]] as const : [[null, o.items]] as const).map(([label, items]) => [
                label && <li key={label} className="pb-1 pt-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-[oklch(0.8_0.11_82)]">{label}</li>,
                ...items.map((i) => {
                  const on = prepared(i.id, i.prepared);
                  return (
                    <li key={i.id} className="flex items-center gap-3 py-2.5">
                      {i.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={i.image} alt="" className={cn("size-11 shrink-0 rounded-lg object-cover", canTick && on && "opacity-40 grayscale")} />
                      ) : <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground">{i.type === "DRINK" ? <Wine className="size-4" /> : <UtensilsCrossed className="size-4" />}</span>}
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className={cn("block truncate text-sm font-medium", canTick && on && "text-muted-foreground line-through")}>{i.name}</span>
                        <span className="text-xs text-muted-foreground tabular-nums">{i.quantity} × {i.unitPrice != null ? tzs(i.unitPrice) : i.type === "DRINK" ? "drink" : "food"}</span>
                      </span>
                      {i.lineTotal != null && <span className="shrink-0 text-sm font-semibold tabular-nums">{i.lineTotal.toLocaleString("en-US")}</span>}
                      {canRemove(i) && (
                        <button type="button" onClick={() => setRemoving(i)} aria-label={`Remove ${i.name}`} title="Remove from the order"
                          className="grid size-8 shrink-0 place-items-center rounded-lg text-muted-foreground/70 transition hover:bg-rose-500/12 hover:text-rose-500 dark:hover:text-rose-300"><CircleMinus className="size-4" /></button>
                      )}
                      {canTick && (
                        <button type="button" onClick={() => tick(i.id, !on)} aria-pressed={on} aria-label={`${i.name} ${on ? "done" : "not done"}`}
                          className={cn("grid size-8 shrink-0 place-items-center rounded-full border-2 transition", on ? "border-emerald-500 bg-emerald-500 text-white" : "border-border text-transparent hover:border-emerald-500/60")}><Check className="size-4" strokeWidth={3} /></button>
                      )}
                    </li>
                  );
                }),
              ])}
            </ul>
            {o.notes && <p className="mt-1 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-200 ring-1 ring-inset ring-amber-500/20">Note: “{o.notes}”</p>}
            {o.total != null && (
              <dl className="ml-auto mt-3 max-w-[280px] space-y-1 text-sm">
                {food.length > 0 && drinks.length > 0 && <>
                  <div className="flex justify-between text-muted-foreground"><dt>Food</dt><dd className="tabular-nums">{sum(food).toLocaleString("en-US")}</dd></div>
                  <div className="flex justify-between text-muted-foreground"><dt>Drinks</dt><dd className="tabular-nums">{sum(drinks).toLocaleString("en-US")}</dd></div>
                </>}
                {!!o.serviceFee && <div className="flex justify-between text-muted-foreground"><dt>Room service</dt><dd className="tabular-nums">{o.serviceFee.toLocaleString("en-US")}</dd></div>}
                <div className="flex items-baseline justify-between border-t border-border/70 pt-2"><dt className="text-xs font-bold uppercase tracking-[0.16em]">Total</dt><dd className="text-lg font-bold tabular-nums">{tzs(o.total)}</dd></div>
              </dl>
            )}
          </div>

          {/* The money: where it stands — and, for reception, taking it (any time) */}
          {o.total != null && o.status !== "CANCELLED" && (
            <div ref={payRef} tabIndex={-1} className="scroll-mt-4 px-5 pt-5 outline-none">
              {/* Every payment: how much, into which account, who recorded it (the Restaurant Counter, or an older waiter's) and who confirmed it */}
              {o.payments.length > 0 && (
                <div className="mb-3 space-y-2">
                  <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">Payments</p>
                  {o.payments.map((p) => {
                    const Icon = accountIcon(p.account);
                    const reversed = p.status !== "POSTED";
                    return (
                      <div key={p.id} className={cn("rounded-2xl p-3 ring-1 ring-inset", reversed ? "bg-muted/30 ring-white/5" : p.confirmedAt ? "bg-emerald-500/[0.08] ring-emerald-500/20" : "bg-amber-500/[0.08] ring-amber-500/25")}>
                        <div className="flex items-center gap-3">
                          <span className={cn("grid size-9 shrink-0 place-items-center rounded-full", reversed ? "bg-muted text-muted-foreground" : p.confirmedAt ? "bg-emerald-500 text-white" : "bg-amber-500/25 text-amber-200")}>
                            {reversed ? <Undo2 className="size-4" /> : p.confirmedAt ? <Check className="size-4" strokeWidth={3} /> : <Icon className="size-4" />}
                          </span>
                          <div className="min-w-0 flex-1 leading-tight">
                            <p className={cn("text-sm font-semibold tabular-nums", reversed && "text-muted-foreground line-through")}>{tzs(p.amount)} · {p.account}</p>
                            <p suppressHydrationWarning className="truncate text-xs text-muted-foreground">
                              {p.atCounter ? "Recorded at the Restaurant Counter" : `Collected by ${first(p.collectedBy) ?? "—"}${p.collectedRole ? ` (${p.collectedRole})` : ""}`}{p.handedOverBy ? ` · brought by ${first(p.handedOverBy)}` : ""} · {clock(p.collectedAt)}{p.reference ? ` · Ref ${p.reference}` : ""}
                            </p>
                            <p suppressHydrationWarning className={cn("truncate text-xs", reversed ? "text-rose-300" : p.confirmedAt ? "text-emerald-300/80" : "text-amber-300")}>
                              {reversed ? p.reverseReason ?? "Reversed" : p.confirmedAt ? `${p.online && !p.confirmedBy ? "Paid online — recorded automatically" : p.atCounter && p.confirmedBy === p.collectedBy ? "Confirmed at the Restaurant Counter" : `Confirmed by ${first(p.confirmedBy) ?? "—"}`} · ${clock(p.confirmedAt)}` : "Waiting to be confirmed"}
                            </p>
                          </div>
                        </div>
                        {!reversed && ((perms.confirm && !p.confirmedAt) || perms.cancelLate) && (
                          <div className="mt-2.5 flex gap-2 pl-12">
                            {perms.confirm && !p.confirmedAt && (
                              <button type="button" disabled={pending} onClick={() => confirmPay(p.id)} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-amber-400 px-3 text-xs font-semibold text-[#1b1611] hover:brightness-105 disabled:opacity-60"><ShieldCheck className="size-3.5" />Confirm — money received</button>
                            )}
                            {perms.cancelLate && (
                              <button type="button" onClick={() => { setReverseWhy(""); setReversing(p); }} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-xs font-medium text-muted-foreground hover:bg-rose-500/10 hover:text-rose-300"><Undo2 className="size-3.5" />Reverse</button>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
              {o.settlement === "ROOM" && !payingNow && (
                <div className="flex items-center gap-3 rounded-2xl bg-violet-500/10 p-3.5 ring-1 ring-inset ring-violet-500/20">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-violet-500/25 text-violet-200"><BedDouble className="size-4" /></span>
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="text-sm font-semibold text-violet-200">On {o.room ? `Room ${o.room}'s` : "the room"} bill</p>
                    <p className="text-xs text-violet-200/70">{o.reservation?.staying ? "Settled with the stay at check-out" : "Settled with the stay"}</p>
                  </div>
                  {perms.pay && o.reservation?.staying && (
                    <button type="button" onClick={() => setPayingNow(true)} className="shrink-0 rounded-lg border border-violet-400/30 px-2.5 py-1.5 text-xs font-semibold text-violet-100 hover:bg-violet-500/15">Guest pays now</button>
                  )}
                </div>
              )}
              {o.settlement === "ROOM" && !payingNow && perms.waiter && perms.verify && o.reservation?.staying && (
                <div className="mt-2">
                  <button type="button" onClick={() => setChangeBill((v) => !v)} className="text-xs font-semibold text-violet-700 hover:underline dark:text-violet-300">{changeBill ? "Keep it on the room" : "Change who pays"}</button>
                  {changeBill && <div className="mt-2 rounded-2xl border border-border/70 p-3"><ChangeWhoPays o={o} rooms={perms.watch ? rooms : []} onDone={() => setChangeBill(false)} /></div>}
                </div>
              )}
              {/* Paid online — recorded automatically from the customer's proof; "Payment not received" if it never arrived */}
              {paidOnline.length > 0 && o.proof && (
                <div className="rounded-2xl border border-sky-500/30 bg-sky-500/[0.06] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">Paid online — recorded automatically</p>
                      <p className="text-xs text-muted-foreground">Counted as paid{o.proof.account ? ` into ${o.proof.account}` : ""}. If the money is not in the account, say so — the order is declined and nothing is counted.</p>
                    </div>
                    <p className="shrink-0 text-right text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Paid<span className="block text-xl font-bold normal-case tracking-tight text-sky-700 tabular-nums dark:text-sky-200">{tzs(paidOnline.reduce((t, p) => t + p.amount, 0))}</span></p>
                  </div>
                  <ProofPanel proof={o.proof} onOpen={() => setViewProof(true)} note="Recorded automatically — check it reached the account." />
                  {canNotReceived ? (
                    <button type="button" onClick={() => setNotIn(true)}
                      className="mt-3 flex h-10 w-full items-center justify-center gap-1.5 rounded-xl border border-rose-500/35 text-sm font-semibold text-rose-600 transition hover:bg-rose-500/10 dark:text-rose-300">
                      <X className="size-4" />Payment not received — decline the order
                    </button>
                  ) : perms.pay && perms.confirm && !perms.watch && !done && (
                    <p className="mt-3 text-xs text-muted-foreground">Already ready — if the money never arrived, a manager reverses the payment.</p>
                  )}
                </div>
              )}
              {online && !confirmsOnline && (
                <div className="flex items-start gap-3 rounded-2xl bg-sky-500/10 p-3.5 ring-1 ring-inset ring-sky-500/20">
                  <span className="grid size-9 shrink-0 place-items-center rounded-full bg-sky-500/20 text-sky-700 dark:text-sky-200"><Smartphone className="size-4" /></span>
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className="text-sm font-semibold text-sky-800 dark:text-sky-200">Paid online — the Counter confirms it</p>
                    <p className="mt-0.5 text-xs text-muted-foreground">The customer paid first{o.proof?.account ? ` to ${o.proof.account}` : ""}. The Restaurant Counter confirms it from the proof — do not collect it again.{checkPay ? " The order is accepted once the money is confirmed." : ""}</p>
                  </div>
                  <button type="button" onClick={() => setViewProof(true)} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold hover:bg-muted"><Eye className="size-3.5" />View</button>
                </div>
              )}
              {/* Paid online: the Counter (or reception) checks the money is in and confirms it once — never a second payment */}
              {confirmsOnline && o.proof && (
                <div className="rounded-2xl border border-sky-500/30 bg-sky-500/[0.06] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">Paid online — confirm it</p>
                      <p className="text-xs text-muted-foreground">{checkPay
                        ? <>Check the money is in {o.proof.account ?? "the account"}. In: confirm it — then the order can be accepted. Not in: decline the order.</>
                        : <>Check the money is in {o.proof.account ?? "the account"}, then confirm it once. It is not collected again.</>}</p>
                    </div>
                    <p className="shrink-0 text-right text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">To confirm<span className="block text-xl font-bold normal-case tracking-tight text-sky-700 tabular-nums dark:text-sky-200">{tzs(due)}</span></p>
                  </div>
                  <ProofPanel proof={o.proof} onOpen={() => setViewProof(true)} />
                  {!o.proof.accountId && (
                    <>
                      <p className="mb-1.5 mt-3.5 text-xs font-semibold text-muted-foreground">Paid to — the customer did not say</p>
                      <AccountPicker accounts={accounts} value={account} onChange={setAccount} />
                    </>
                  )}
                  <motion.button type="button" whileTap={{ scale: 0.98 }} disabled={pending || !onlineAccount} onClick={confirmOnline}
                    className="mt-3.5 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-sky-600 px-3 text-sm font-semibold text-white shadow-[0_10px_24px_-14px_rgb(2_132_199)] transition hover:bg-sky-500 disabled:opacity-60">
                    {pending ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <ShieldCheck className="size-4 shrink-0" />}
                    <span className="truncate">Confirm online payment · {tzs(due)}{o.proof.account ? ` · ${o.proof.account}` : ""}</span>
                  </motion.button>
                  {checkPay && canPrep && (
                    <button type="button" onClick={() => { setWhy("Payment not received"); setDeclining(true); }}
                      className="mt-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-xl text-xs font-semibold text-rose-600 hover:bg-rose-500/10 dark:text-rose-300">
                      <X className="size-3.5" />Not in the account — decline the order
                    </button>
                  )}
                </div>
              )}
              {perms.pay && !online && (unpaid || (payingNow && o.settlement === "ROOM")) && (
                <div className="rounded-2xl border border-[oklch(0.75_0.12_80/0.35)] bg-[oklch(0.72_0.12_80/0.06)] p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold">{payingNow ? "Guest pays now" : "Record the payment"}</p>
                      <p className="text-xs text-muted-foreground">{payingNow ? `It comes off ${o.room ? `Room ${o.room}'s` : "the room"} bill.` : done || o.status === "DELIVERED" ? "Served — waiting for this payment." : "Any time — before or after it is served."}</p>
                    </div>
                    <p className="shrink-0 text-right text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{o.paid ? "Still due" : "To collect"}<span className="block text-xl font-bold normal-case tracking-tight text-[oklch(0.87_0.09_84)] tabular-nums">{tzs(payingNow ? o.total : due)}</span></p>
                  </div>
                  {billRoom && !payingNow
                    ? <div className="mt-3.5"><BillTo id={o.id} total={tzs(due)} stays={roomBill.stays} rooms={roomBill.rooms} onDone={() => router.refresh()}>{payForm}</BillTo></div>
                    : payForm}
                </div>
              )}
              {unpaid && !perms.pay && !online && (billRoom
                ? <BillTo id={o.id} total={tzs(due)} stays={roomBill.stays} rooms={roomBill.rooms} onDone={() => router.refresh()}>{notPaid}</BillTo>
                : notPaid)}
            </div>
          )}

          {perms.watch && <div className="px-5"><ManagerOrderTools o={o} done={done} rooms={perms.verify ? rooms : null} /></div>}

          {/* This person's buttons — always in reach */}
          <div className="sticky bottom-0 mt-5 space-y-2 border-t border-border/70 bg-popover/95 px-5 py-4 backdrop-blur">
            {!desk && action && !(checkPay && perms.pay) && <div className="[&_button]:h-10 [&_button]:rounded-xl [&_button]:text-sm [&_p]:h-10 [&_p]:text-sm">{action}</div>}
            <div className="flex flex-wrap items-center gap-2">
              {o.status !== "CANCELLED" && <Link href={`/staff/restaurant-bill?order=${o.id}`} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-border px-3 text-xs font-semibold text-[oklch(0.84_0.11_82)] hover:bg-muted"><Receipt className="size-3.5" />{done ? "Receipt" : "Bill"} · print / download</Link>}
              {canAdd && <Link href={`/staff/restaurant/pos?add=${o.id}`} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-sky-500/40 px-3 text-xs font-semibold text-sky-300 hover:bg-sky-500/10"><Plus className="size-3.5" />Add items</Link>}
              {o.status !== "CANCELLED" && <Link href={`/staff/restaurant-slip?order=${o.id}`} className="inline-flex h-9 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"><Printer className="size-3.5" />Order slip</Link>}
              <Link href={`/staff/restaurant/orders/${o.id}`} className="inline-flex h-9 flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl border border-border px-3 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"><History className="size-3.5" />Every step</Link>
              {canTransfer && <button type="button" onClick={openTransfer} className="inline-flex h-9 items-center gap-1.5 whitespace-nowrap rounded-xl border border-border px-3 text-xs font-semibold hover:bg-muted"><ArrowRightLeft className="size-3.5" />Transfer</button>}
              {canDecline && o.status !== "PENDING" && <button type="button" onClick={() => setDeclining(true)} className="inline-flex h-9 items-center gap-1.5 rounded-xl px-3 text-xs font-semibold text-rose-300 hover:bg-rose-500/10"><X className="size-3.5" />Decline</button>}
              {(perms.waiter || perms.watch) && !done && (o.status === "PENDING" || o.status === "ACCEPTED" || perms.cancelLate) && (
                <div className="[&_button]:h-9 [&_button]:rounded-xl">
                  <OrderCardActions id={o.id} number={o.number} total={o.total != null ? tzs(o.total) : ""} next={null} nextLabel={null} unpaid={false} canCancel labelled
                    pay={null} room={null} update={null}
                    cancelNote={o.settlement === "ROOM" ? "Its items come off the guest's room bill (kept on record as cancelled)." : o.paid === 0 ? "Nothing was paid yet — it is kept on record as cancelled." : "Its payment is reversed and its sale voided (kept on record as cancelled). Give any refund separately."} />
                </div>
              )}
            </div>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={!!reversing} onOpenChange={(v) => { if (!v) setReversing(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Undo2 />} eyebrow="Payments" tone="rose">
            <DialogTitle>Reverse this payment?</DialogTitle>
            <DialogDescription>
              {reversing ? `${tzs(reversing.amount)} · ${reversing.account}` : ""} — its sales are voided (kept on record) and the amount is due again. Give any money back separately.
            </DialogDescription>
          </DialogHeader>
          <Input value={reverseWhy} onChange={(e) => setReverseWhy(e.target.value)} placeholder="Why? e.g. recorded on the wrong order" />
          <Button variant="destructive" disabled={pending || !reverseWhy.trim()} onClick={reverse}>{pending && <Loader2 className="animate-spin" />}Reverse the payment</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={declining} onOpenChange={setDeclining}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Ban />} eyebrow="Restaurant" tone="rose">
            <DialogTitle>Decline the order for {o.place}?</DialogTitle>
            <DialogDescription>It leaves the board and reception sees it as declined, with your reason, so they can tell the customer.{o.settlement === "ROOM" ? " It comes off the room bill."
              : checksMoney && paidOnline.length && /^payment not received/i.test(why.trim()) ? " The online payment is taken off — not counted, and no refund (the money never came)."
              : o.settlement === "PAY_NOW" ? " It was paid — reception gives the money back."
              : checkPay ? " The customer's online payment is not confirmed — nothing is recorded as paid." : ""}</DialogDescription>
          </DialogHeader>
          <div className="flex flex-wrap gap-1.5">
            {[...(checksMoney ? ["Payment not received"] : []), "Out of stock", "Kitchen is closing", "Too busy right now", "Can't make it as asked"].map((r) => (
              <button key={r} type="button" onClick={() => setWhy(r)}
                className={cn("rounded-full border px-3 py-1.5 text-xs font-medium transition", why === r ? "border-rose-500 bg-rose-500/10 text-rose-700 dark:text-rose-300" : "border-border hover:bg-muted")}>{r}</button>
            ))}
          </div>
          <Input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Or say why…" />
          {o.items.some((i) => i.menuItemId) && (
            <div>
              <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Ran out? Mark it sold out so nobody orders it again</p>
              <ul className="space-y-1">
                {o.items.filter((i) => i.menuItemId).map((i) => {
                  const on = soldOut.includes(i.menuItemId!);
                  return (
                    <li key={i.id}>
                      <button type="button" onClick={() => setSoldOut((xs) => (on ? xs.filter((x) => x !== i.menuItemId) : [...xs, i.menuItemId!]))} aria-pressed={on}
                        className={cn("flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-1.5 text-left text-sm transition", on ? "border-rose-500/60 bg-rose-500/10" : "border-border hover:bg-muted")}>
                        <span className={cn("grid size-5 shrink-0 place-items-center rounded-md border-2", on ? "border-rose-500 bg-rose-500 text-white" : "border-border text-transparent")}><Check className="size-3" strokeWidth={3} /></span>
                        <span className="flex-1 truncate">{i.name}</span>
                        {on && <span className="text-[11px] font-semibold text-rose-600 dark:text-rose-300">Sold out</span>}
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          )}
          <Button variant="destructive" disabled={pending || !why.trim()} onClick={decline}>{pending && <Loader2 className="animate-spin" />}Decline order</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={notIn} onOpenChange={setNotIn}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<BanknoteX />} eyebrow="Online payment" tone="rose">
            <DialogTitle>Payment not received?</DialogTitle>
            <DialogDescription>
              The customer&apos;s {tzs(paidOnline.reduce((t, p) => t + p.amount, 0))}{o.proof?.account ? ` to ${o.proof.account}` : ""}{o.proof?.reference ? ` (code ${o.proof.reference})` : ""} is not in the account?
              It is taken off — not counted, no refund — and the order for {o.place} is declined. The customer is told.
              {counterTaken > 0 && <> The {tzs(counterTaken)} taken at the Counter for it is reversed too — give that back.</>}
            </DialogDescription>
          </DialogHeader>
          {o.proof && <button type="button" onClick={() => setViewProof(true)} className="inline-flex h-9 items-center justify-center gap-1.5 rounded-xl border border-border text-sm font-medium hover:bg-muted"><Eye className="size-4" />See the customer&apos;s screenshot</button>}
          <div className="flex gap-2">
            <Button variant="destructive" disabled={pending} onClick={notReceived}>{pending ? <Loader2 className="animate-spin" /> : <X />}Not received — decline</Button>
            <Button variant="ghost" onClick={() => setNotIn(false)}>It is there</Button>
          </div>
        </DialogContent>
      </Dialog>

      {removing && (
        <RemoveItemDialog order={{ id: o.id, number: o.number, customer: o.customer, lines: o.items.length }}
          line={{ id: removing.id, name: removing.name, qty: removing.quantity, price: removing.unitPrice, made: madeItem(removing) }} onClose={() => setRemoving(null)} />
      )}

      {o.proof && <ProofViewer proof={o.proof} place={o.place} open={viewProof} onOpenChange={setViewProof} />}

      {canTransfer && (
        <TransferDialog open={transfer} onOpenChange={(v) => { setTransfer(v); if (!v) transferPin.current = undefined; }}
          title={`Transfer ${shortNo(o.number)}`} what={`${shortNo(o.number)} · ${o.place}`} exceptId={o.assignedTo?.id}
          onTransfer={submitTransfer} beforeTransfer={beforeTransfer}
          onDone={() => router.refresh()} />
      )}

      <Dialog open={deliver} onOpenChange={setDeliver}>
        <DialogContent className="max-h-[92svh] gap-0 overflow-y-auto p-0 sm:max-w-[480px]">
          {/* Where it goes, and what */}
          <DialogHeader icon={<span className="text-[15px] font-bold">{tileText(o)}</span>} eyebrow={o.address ? "Deliver to" : "Serving"} tone="violet" className="mx-0 mt-0">
            <DialogTitle className={o.address ? "line-clamp-2" : "truncate"}>{o.address ?? o.place}</DialogTitle>
            <DialogDescription className="truncate">
              {shortNo(o.number)} · {itemCount} item{itemCount === 1 ? "" : "s"}{o.customer ? ` · ${first(o.customer)}` : ""}{o.phone ? ` · ${o.phone}` : ""}
            </DialogDescription>
            <ul className="mt-2.5 flex flex-wrap gap-1.5">
              {o.items.slice(0, 6).map((i) => (
                <li key={i.id} className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-white/10 py-0.5 pl-0.5 pr-2.5 text-xs ring-1 ring-white/15">
                  {i.image
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={i.image} alt="" className="size-5 shrink-0 rounded-full object-cover" />
                    : <span className="grid size-5 shrink-0 place-items-center rounded-full bg-white/10 text-white/70">{i.type === "DRINK" ? <Wine className="size-3" /> : <UtensilsCrossed className="size-3" />}</span>}
                  <span className="truncate"><strong className="font-semibold">{i.quantity}×</strong> {i.name}</span>
                </li>
              ))}
              {o.items.length > 6 && <li className="rounded-full px-2 py-0.5 text-xs text-white/70 ring-1 ring-white/15">+{o.items.length - 6} more</li>}
            </ul>
          </DialogHeader>

          <div className="space-y-4 border-t border-border/60 px-5 py-4">
            {/* The money */}
            {o.total != null && (
              <div className="flex items-center justify-between gap-3 rounded-2xl bg-[oklch(0.72_0.12_80/0.08)] px-4 py-3 ring-1 ring-inset ring-[oklch(0.75_0.12_80/0.3)]">
                <div>
                  <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{!perms.pay ? "To pay at the Counter" : o.paid ? "Still to collect" : "To collect"}</p>
                  <p className="text-2xl font-bold tracking-tight tabular-nums text-[oklch(0.87_0.09_84)]">{tzs(due)}</p>
                </div>
                {o.paid
                  ? <p className="text-right text-xs leading-relaxed text-muted-foreground">Total {tzs(o.total)}<br />Paid {tzs(o.paid)}</p>
                  : <span className="grid size-10 place-items-center rounded-full bg-[oklch(0.72_0.12_80/0.15)] text-[oklch(0.87_0.09_84)]"><Wallet className="size-5" /></span>}
              </div>
            )}
            {perms.pay && (
              <>
                <div>
                  <p className="mb-1.5 text-xs font-semibold text-muted-foreground">How are they paying?</p>
                  <AccountPicker accounts={accounts} value={account} onChange={setAccount} />
                </div>
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-muted-foreground" htmlFor={`dref-${o.id}`}>Reference (M-Pesa code, card slip) — optional</label>
                  <Input id={`dref-${o.id}`} value={reference} onChange={(e) => setReference(e.target.value)} placeholder="e.g. SGH4K2L9PQ" className="h-10 font-mono text-sm uppercase placeholder:normal-case" />
                </div>
                {deliver && <BroughtBySelect value={broughtBy} onChange={setBroughtBy} prefill={o.assignedTo?.id} />}
              </>
            )}
          </div>

          {/* Paid now, or later */}
          <div className="space-y-2 border-t border-border/60 bg-muted/25 px-5 py-4">
            {perms.pay && (
              <motion.button type="button" whileTap={{ scale: 0.98 }} disabled={pending || !account} onClick={() => step("DELIVERED", { accountId: account, reference: reference || undefined, handedOverById: broughtBy || null })}
                className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] px-3 text-sm font-semibold text-[oklch(0.2_0.03_60)] shadow-[0_10px_24px_-14px_oklch(0.7_0.12_80)] ring-1 ring-inset ring-white/30 hover:brightness-105 disabled:opacity-60">
                {pending ? <Loader2 className="size-4 shrink-0 animate-spin" /> : <CheckCheck className="size-4 shrink-0" />}
                <span className="truncate">Paid{o.total != null ? ` ${tzs(due)}` : ""}{picked ? ` · ${picked.name}` : ""} — served</span>
              </motion.button>
            )}
            {/* Or on the customer's own room (theirs, or of someone at their table) — never any other room */}
            {billRoom && o.stays.map((s) => (
              <button key={s.id} type="button" disabled={pending} onClick={() => deliverToRoom(s)}
                className="flex min-h-11 w-full items-center justify-center gap-2 rounded-xl border border-violet-500/35 bg-violet-500/[0.08] px-3 py-1.5 text-sm font-medium text-violet-800 transition hover:bg-violet-500/15 disabled:opacity-60 dark:text-violet-200">
                <BedDouble className="size-4 shrink-0" />
                <span className="min-w-0 leading-tight">
                  <span className="block truncate">Charge to Room {s.rooms} — served</span>
                  <span className="block truncate text-[11px] font-normal opacity-75">Customer: {s.guestName} · Room {s.rooms}{s.foodPayer ? ` · ${s.foodPayer}` : ""}</span>
                </span>
              </button>
            ))}
            <button type="button" disabled={pending} onClick={() => step("DELIVERED")}
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-border bg-background/40 px-3 text-sm font-medium transition hover:bg-muted disabled:opacity-60">
              <HandPlatter className="size-4 shrink-0 text-muted-foreground" />{perms.pay ? "Served — they pay later" : "Served — they pay at the Counter"}
            </button>
            <p className="pt-0.5 text-center text-[11px] leading-snug text-muted-foreground">
              {perms.pay ? "Paying later: it stays on the board as “Served · to pay” until the payment is recorded." : "The Restaurant Counter records the payment — bring the payment to the Counter."}
            </p>
          </div>
        </DialogContent>
      </Dialog>
    </motion.div>
  );
}

/** On the card: the customer paid first — their screenshot, small; tap to see it. */
function ProofStrip({ proof, onOpen }: { proof: NonNullable<PortalOrder["proof"]>; onOpen: () => void }) {
  return (
    <button type="button" onClick={onOpen} className="mt-2 flex w-full items-center gap-2 rounded-lg bg-amber-500/10 p-1.5 pr-2.5 text-left ring-1 ring-inset ring-amber-500/25 transition hover:bg-amber-500/15">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={proof.url} alt="" className="size-9 shrink-0 rounded-md bg-black/20 object-cover" />
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block text-[11px] font-semibold text-amber-800 dark:text-amber-200">Paid online — payment screenshot</span>
        <span className="block truncate text-[10.5px] text-muted-foreground">{[proof.account, proof.reference].filter(Boolean).join(" · ") || "Tap to check it"}</span>
      </span>
      <span className="shrink-0 text-[10.5px] font-semibold text-amber-800 dark:text-amber-200">View</span>
    </button>
  );
}

/** In the order and Deliver windows: the screenshot bigger, what the customer said, view / download. */
function ProofPanel({ proof, onOpen, note = "check it in the account, then confirm it." }: { proof: NonNullable<PortalOrder["proof"]>; onOpen: () => void; note?: string }) {
  return (
    <div className="mt-3.5 flex gap-3 rounded-xl bg-background/50 p-2.5 ring-1 ring-inset ring-amber-500/30">
      <button type="button" onClick={onOpen} className="shrink-0 overflow-hidden rounded-lg" aria-label="See the payment screenshot">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={proof.url} alt="Payment screenshot" className="h-24 w-[72px] bg-black/20 object-cover transition hover:opacity-90" />
      </button>
      <div className="min-w-0 flex-1 leading-snug">
        <p className="text-[13px] font-semibold text-amber-800 dark:text-amber-200">The customer paid online</p>
        <p className="mt-0.5 text-xs text-muted-foreground">
          {proof.account ? <>To <span className="font-medium text-foreground">{proof.account}</span></> : "Account not given"}{proof.reference && <> · code <span className="font-mono text-foreground">{proof.reference}</span></>}
          <span className="block">Sent {clock(proof.at)} — {note}</span>
        </p>
        <div className="mt-2 flex gap-1.5">
          <button type="button" onClick={onOpen} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold hover:bg-muted"><Eye className="size-3.5" />View</button>
          <a href={`${proof.url}?download=1`} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-border px-2.5 text-xs font-semibold hover:bg-muted"><Download className="size-3.5" />Download</a>
        </div>
      </div>
    </div>
  );
}

/** The screenshot, full size — and download. */
function ProofViewer({ proof, place, open, onOpenChange }: { proof: NonNullable<PortalOrder["proof"]>; place: string; open: boolean; onOpenChange: (v: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        <DialogHeader icon={<ImageIcon />} eyebrow="Paid online" tone="emerald" className="mx-0 mt-0">
          <DialogTitle>Payment screenshot</DialogTitle>
          <DialogDescription className="truncate">{[place, proof.account, proof.reference].filter(Boolean).join(" · ")}</DialogDescription>
        </DialogHeader>
        <div className="bg-black">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={proof.url} alt="Payment screenshot" className="mx-auto max-h-[70svh] w-full object-contain" />
        </div>
        <div className="flex gap-2 px-5 py-3.5">
          <a href={`${proof.url}?download=1`} className="inline-flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-sm font-semibold text-[oklch(0.2_0.03_60)]"><Download className="size-4" />Download</a>
          <a href={proof.url} target="_blank" rel="noopener" className="inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-border px-4 text-sm font-medium hover:bg-muted"><Eye className="size-4" />Full size</a>
        </div>
      </DialogContent>
    </Dialog>
  );
}


/** "How are they paying?" — the hotel's accounts as cards (cash, mobile money, the bank…): one tap. */
export function AccountPicker({ accounts, value, onChange }: { accounts: PayAccount[]; value: string; onChange: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {accounts.map((a) => {
        const Icon = accountIcon(a.name);
        const on = value === a.id;
        return (
          <button key={a.id} type="button" onClick={() => onChange(a.id)} aria-pressed={on}
            className={cn("flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition",
              on ? "border-[oklch(0.78_0.12_80)] bg-[oklch(0.72_0.12_80/0.14)] shadow-[0_0_0_1px_oklch(0.78_0.12_80/0.4)]" : "border-border/80 bg-background/40 hover:bg-muted")}>
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", on ? "bg-[oklch(0.78_0.12_80)] text-[oklch(0.2_0.03_60)]" : "bg-muted text-muted-foreground")}><Icon className="size-4" /></span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13px] font-semibold">{a.name}</span>
              <span className="block truncate font-mono text-[10px] text-muted-foreground">{a.number ?? (/cash/i.test(a.name) ? "In hand" : "—")}</span>
            </span>
            {on && <Check className="size-3.5 shrink-0 text-[oklch(0.84_0.11_82)]" strokeWidth={3} />}
          </button>
        );
      })}
    </div>
  );
}

/** The main button: small, the hotel's gold, the same for every step. */
/** A small round icon (link or button) with its name on hover — the card's footer. */
function MiniIcon({ tip, href, onClick, tone, children }: { tip: string; href?: string; onClick?: () => void; tone: string; children: React.ReactNode }) {
  const cls = cn("grid size-7 place-items-center rounded-full transition [&_svg]:size-3.5", tone);
  return (
    <span className="group/mi relative">
      {href ? <Link href={href} aria-label={tip} className={cls}>{children}</Link> : <button type="button" onClick={onClick} aria-label={tip} className={cls}>{children}</button>}
      <span role="tooltip" className="pointer-events-none absolute bottom-full right-0 z-30 mb-1.5 translate-y-1 whitespace-nowrap rounded-lg bg-popover px-2 py-1 text-[11px] font-medium text-popover-foreground opacity-0 shadow-lg ring-1 ring-border transition group-hover/mi:translate-y-0 group-hover/mi:opacity-100">{tip}</span>
    </span>
  );
}

function Primary({ pending, disabled, onClick, icon, children }: { pending: boolean; disabled?: boolean; onClick: () => void; icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <motion.button type="button" whileTap={disabled ? undefined : { scale: 0.97 }} disabled={pending || disabled} onClick={onClick}
      className={cn("group flex h-9 w-full items-center gap-2 rounded-full pl-1 pr-3.5 text-[12.5px] font-semibold transition",
        disabled ? "cursor-not-allowed border border-dashed border-border/80 bg-muted/25 text-muted-foreground" : "bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-[oklch(0.2_0.03_60)] shadow-[0_8px_18px_-12px_oklch(0.7_0.12_80)] ring-1 ring-inset ring-white/30 hover:brightness-105")}>
      <span className={cn("grid size-7 shrink-0 place-items-center rounded-full [&_svg]:size-3.5", disabled ? "bg-muted" : "bg-black/10")}>{pending ? <Loader2 className="animate-spin" /> : icon}</span>
      <span className="min-w-0 flex-1 truncate text-left">{children}</span>
      {!disabled && <ArrowRight className="size-3.5 shrink-0 opacity-60 transition group-hover:translate-x-0.5 group-hover:opacity-100" />}
    </motion.button>
  );
}

const waDigits = (phone: string) => { const d = phone.replace(/\D/g, ""); return d.startsWith("0") ? `255${d.slice(1)}` : d; };
/** What the customer hears now, by the order's step. */
const TELL: Record<string, string> = {
  PENDING: "Order received", ACCEPTED: "Being prepared", PREPARING: "Being prepared", READY: "It's ready", OUT_FOR_DELIVERY: "On its way",
  DELIVERED: "Thank you", COMPLETED: "Thank you", COLLECTED: "Thank you", CANCELLED: "Say sorry",
};

/** Send the customer this step's update on WhatsApp (from this device) — logged, so it shows "Told". */
export function TextCustomer({ o, icon }: { o: PortalOrder; icon?: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  if (!o.update) return <AddPhone o={o} icon={icon} />;
  const u = o.update;
  const send = () => {
    window.open(`https://wa.me/${waDigits(u.to)}?text=${encodeURIComponent(u.text)}`, "_blank", "noopener");
    start(async () => {
      const res = await logGuestMessageAction({ restaurantOrderId: o.id, type: u.type as never, channel: "WHATSAPP", to: u.to, body: u.text });
      if (res.ok) router.refresh(); else toast.error(res.error);
    });
  };
  const who = first(o.customer) ?? "the customer";
  if (icon) {
    return o.told ? (
      <IconAction tip={`Told on WhatsApp · send again to ${who}`} onClick={send}
        className="bg-emerald-500/10 text-emerald-300 ring-1 ring-inset ring-emerald-500/35 hover:bg-emerald-500/15">
        <WhatsAppGlyph /><span className="absolute -right-0.5 -top-0.5 grid size-3.5 place-items-center rounded-full bg-emerald-500 text-[#06240f] ring-2 ring-card"><Check className="size-2!" strokeWidth={4} /></span>
      </IconAction>
    ) : (
      <IconAction tip={`WhatsApp ${who}: ${TELL[o.status] ?? "an update"}`} onClick={send} disabled={pending}
        className="bg-[#25D366] text-white shadow-[0_8px_18px_-10px_#25D366] hover:brightness-105">
        {pending ? <Loader2 className="animate-spin" /> : <WhatsAppGlyph />}
      </IconAction>
    );
  }
  return o.told ? (
    <button type="button" onClick={send} title={`Told on WhatsApp · send again to ${u.to}`}
      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-emerald-500/30 bg-emerald-500/[0.07] text-xs font-semibold text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300 [&_svg]:size-3.5">
      <CheckCheck />Told
    </button>
  ) : (
    <motion.button type="button" whileTap={{ scale: 0.96 }} onClick={send} disabled={pending} title={`WhatsApp ${u.to}: ${TELL[o.status] ?? "update"}`}
      className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg bg-[#25D366] text-xs font-semibold text-[#073b1f] hover:brightness-105 disabled:opacity-60 [&_svg]:size-3.5">
      {pending ? <Loader2 className="animate-spin" /> : <MessageCircle />}{TELL[o.status] ?? "Text"}
    </motion.button>
  );
}

/** An order without the customer's phone (older ones): reception adds it, then can text them. */
function AddPhone({ o, icon }: { o: PortalOrder; icon?: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState("");
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    const res = await setOrderPhoneAction({ id: o.id, phone });
    if (res.ok) { toast.success(res.message ?? "Phone added."); setOpen(false); router.refresh(); } else toast.error(res.error);
  });
  return (
    <>
      {icon ? (
        <IconAction tip="Add the customer's phone to text them" onClick={() => setOpen(true)}
          className="border border-dashed border-amber-500/60 text-amber-300 hover:bg-amber-500/10">
          <Phone /><span className="absolute -right-0.5 -top-0.5 grid size-3.5 place-items-center rounded-full bg-amber-400 text-[#2a1a02] ring-2 ring-card"><Plus className="size-2!" strokeWidth={4} /></span>
        </IconAction>
      ) : (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex h-8 items-center justify-center gap-1.5 rounded-lg border border-dashed border-amber-500/50 text-xs font-semibold text-amber-700 hover:bg-amber-500/10 dark:text-amber-300 [&_svg]:size-3.5">
          <Phone />Add phone
        </button>
      )}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader icon={<Phone />} eyebrow="Customer" tone="sky">
            <DialogTitle>Customer&apos;s phone · {o.place}</DialogTitle>
            <DialogDescription>Every order needs the customer&apos;s phone for updates and receipts. It is saved on the customer too.</DialogDescription>
          </DialogHeader>
          <Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" placeholder="0712 345 678" autoFocus />
          <Button disabled={pending || !validPhone(phone)} onClick={save}>{pending && <Loader2 className="animate-spin" />}Save phone</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
