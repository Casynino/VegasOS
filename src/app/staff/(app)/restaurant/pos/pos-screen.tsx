"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { AnimatePresence, LayoutGroup, motion, MotionConfig } from "motion/react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BedDouble, Check, ChefHat, CircleCheck, CircleDollarSign, HandPlatter, LayoutGrid, Loader2, Maximize2, Minus, NotebookPen, Phone, Plus, Printer, ReceiptText, Search, ShoppingBag, Smartphone, Store, Trash2, UserRound, UtensilsCrossed, Wine, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatTZS } from "@/lib/format";
import { accountDetail, type PayAccount } from "@/lib/pay-account";
import { cn } from "@/lib/utils";
import type { OrderingMenu } from "@/server/services/restaurant";
import { addOrderItemsAction, createOrderAction, setOrderStatusAction } from "../actions";
import { sendOrdersPromptAction } from "../../mobile-pay/actions";
import { SendToPhone, useMobilePayAvailable } from "@/components/staff/mobile-pay";
import { NetworkMarks } from "@/components/payments/networks";
import { validPhone } from "@/lib/guest-messages";
import { KnownCustomerNote, useKnownCustomer } from "@/components/staff/known-customer";
import { CustomerFinder } from "@/components/staff/customer-finder";
import { StayingGuestPicker } from "@/components/staff/staying-guest-picker";
import { useIsRestaurantDevice, useWaiterPin } from "@/components/staff/waiter-pin";
import { WaiterChips } from "@/components/staff/waiter-chips";
import { ACCENT, allPrepared, OrderCard, payBadgeFor, shortNo, since, tileText } from "../portal/order-card";
import type { PortalOrder, PortalPerms, PortalRole, PortalStay } from "../portal/types";

/** An open order the customer can still add to (picked from its table / room, or opened with "Add"). */
export type Addable = { id: string; number: string; place: string; locationId: string | null; reservationId: string | null; customer: string | null; total: number | null; status: string; items: number };
/** A table / the counter, for picking where a dine-in order goes. */
export type PosLocation = { id: string; kind: string; area: string | null; number: number | null; name: string; busy: boolean };

/** A table's or a room's bill still open — new orders for them add to it. */
export type OpenBill = {
  key: string; kind: "table" | "room"; label: string; table: string | null; reservationId: string | null; who: string | null; phone: string | null; orders: number; total: number | null; due: number | null; orderId: string;
  /** A table: the hotel rooms of the people seated there — the only rooms a waiter may put its bill on. */
  stays: PortalStay[];
};
/** A staying guest as the till sees them (room service, reception's room bills): the room and the name — never their phone or balance. */
export type PosGuest = { id: string; reference: string; name: string; rooms: string; hasPhone: boolean };
type Sent = {
  id: string; number: string; total: number; place: string; lines: { name: string; qty: number; price: number }[]; settlement: string; again: boolean; added?: boolean;
  /** Paid by a prompt to the customer's phone (nTZS): the prompt being followed — or why it did not go. */
  prompt?: { id: string; amount: number; phone: string } | null; promptError?: string | null; promptPhone?: string;
};
/** "Send to phone" among the ways to pay now — the main way (nTZS); the accounts are for money taken by hand. */
const PROMPT = "__ntzs_prompt__";
type OrderType = "DINE_IN" | "TAKEAWAY" | "PICKUP" | "ROOM_SERVICE";
type Settlement = "PAY_NOW" | "ROOM" | "UNPAID";

const TYPES: { v: OrderType; label: string; icon: typeof UtensilsCrossed }[] = [
  { v: "DINE_IN", label: "Dine in", icon: UtensilsCrossed },
  { v: "TAKEAWAY", label: "Takeaway", icon: ShoppingBag },
  { v: "PICKUP", label: "Pickup", icon: Store },
  { v: "ROOM_SERVICE", label: "Room service", icon: BedDouble },
];
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const field = "h-10 w-full rounded-xl border border-border bg-background px-3 text-sm outline-none focus:border-foreground/30";

/** The till: open orders on a line, the menu with photos, and the ticket being built. */
export function PosScreen({ menu, guests, accounts, fee, canPay, roomBills, verify, line, bills, perms, role, waiter, locations, addable, startAdd, startTable = null, meId = null }: {
  menu: OrderingMenu; guests: PosGuest[]; accounts: PayAccount[]; fee: number; canPay: boolean; line: PortalOrder[]; bills: OpenBill[]; perms: PortalPerms; role: PortalRole; waiter: string;
  /** Takes room bills and room service (restaurant.orders) — not the Mpishi alone. */
  roomBills: boolean;
  /** Checks who is staying (reception, managers): any staying room for any order. Everyone who takes orders picks the
   *  staying guest for room service; a waiter's dine-in room bill goes only on the customer's own room. */
  verify: boolean;
  locations: PosLocation[]; addable: Addable[]; startAdd: string | null;
  /** Opened from a table ("Take an order here"): that table is picked. */
  startTable?: string | null;
  /** The signed-in person (their own orders on the line show as theirs). */
  meId?: string | null;
}) {
  const [type, setType] = useState<OrderType>("DINE_IN");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cat, setCat] = useState("all");
  const [q, setQ] = useState("");
  const [guestId, setGuestId] = useState("");
  // A waiter's room bill: one of the customer's own stays (never picked for them).
  const [stayId, setStayId] = useState("");
  /** Reception putting it on another guest's room: why. */
  const [roomReason, setRoomReason] = useState("");
  const [locationId, setLocationId] = useState(startTable ?? "");
  // On the shared Restaurant Counter: the waiter who serves this order (chosen here, or asked when sending).
  const device = useIsRestaurantDevice();
  const [waiterId, setWaiterId] = useState("");
  // Adding to an open order instead of a new one (the customer wants more).
  const [joinId, setJoinId] = useState<string | null>(startAdd);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  // The customer picked in the search — sent while the name is still theirs (a typed new name = someone else).
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null);
  // The number finds the customer: a known one's name fills itself in.
  const autoName = useRef("");
  const known = useKnownCustomer(guestId && (role === "desk" || type === "ROOM_SERVICE") ? "" : phone, (k) => { if (!name.trim() || name === autoName.current) { autoName.current = k.name; setName(k.name); } });
  // "Different customer" at a table that already has one (kept per table).
  const [otherAt, setOtherAt] = useState<string | null>(null);
  const [notes, setNotes] = useState("");
  const [settlementPick, setSettlement] = useState<Settlement>(canPay ? "PAY_NOW" : "UNPAID");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  // Paying now, the main way is a prompt to the customer's phone (nTZS) — chosen as soon as it is available.
  const mobileOk = useMobilePayAvailable() && canPay;
  const [promptPhone, setPromptPhone] = useState<string | null>(null);
  const pickedAccount = useRef(false);
  useEffect(() => { if (mobileOk && !pickedAccount.current) setAccountId(PROMPT); }, [mobileOk]);
  const [reference, setReference] = useState("");
  const [pending, start] = useTransition();
  const [sent, setSent] = useState<Sent | null>(null);
  const router = useRouter();
  const askPin = useWaiterPin();

  const all = useMemo(() => menu.flatMap((c) => c.items.map((i) => ({ ...i, category: c.name }))), [menu]);
  const needle = q.trim().toLowerCase();
  const shown = all.filter((i) => (needle ? `${i.name} ${i.category}`.toLowerCase().includes(needle) : cat === "all" || menu.find((c) => c.id === cat)?.items.some((x) => x.id === i.id)));
  const lines = Object.entries(cart).map(([id, qty]) => ({ item: all.find((i) => i.id === id)!, qty })).filter((l) => l.item && l.qty > 0);
  const food = lines.filter((l) => l.item.type === "FOOD").reduce((s, l) => s + l.item.price * l.qty, 0);
  const drinks = lines.filter((l) => l.item.type !== "FOOD").reduce((s, l) => s + l.item.price * l.qty, 0);
  const serviceFee = type === "ROOM_SERVICE" && !joinId ? fee : 0;
  const total = food + drinks + serviceFee;
  const count = lines.reduce((s, l) => s + l.qty, 0);
  // The staying guest the order is for: room service (anyone who takes orders picks them from the list), or reception /
  // managers picking the room. A waiter's dine-in room bill is never picked from the list.
  const guest = type === "ROOM_SERVICE" || verify ? guests.find((g) => g.id === guestId) ?? null : null;
  // Room service is for a guest staying here, picked from the list — the order is theirs and goes to their room.
  const forStay = type === "ROOM_SERVICE" && roomBills;
  // Reception sells only to hotel guests (owner, 2026-10-04): every order — dine in, takeaway, room service — is
  // for a guest staying here. Anyone else orders at the restaurant.
  const hotelOnly = role === "desk";
  const outside = type === "TAKEAWAY" || type === "PICKUP";
  // Every order has the customer's phone (updates, receipts): the staying guest's (on the booking), or typed in.
  const guestHasPhone = !!guest?.hasPhone;
  const joining = addable.find((a) => a.id === joinId) ?? null;
  const location = locations.find((l) => l.id === locationId) ?? null;
  // An open order already at the picked table / for the picked guest: offer to add to it.
  const openHere = joining ? null : type === "DINE_IN" && location ? addable.find((a) => a.locationId === location.id) ?? null : guest ? addable.find((a) => a.reservationId === guest.id) ?? null : null;
  const who = joining ? `${joining.place}${joining.customer ? ` · ${joining.customer}` : ""}` : guest ? `Room ${guest.rooms} · ${guest.name}` : (outside ? name : type === "ROOM_SERVICE" ? name : location?.name ?? name) || (hotelOnly || type === "ROOM_SERVICE" ? "Hotel guest — pick the room" : outside ? "Takeaway customer" : "Walk-in customer");
  // The open bill this order adds to: the table (dine in) or the guest's room.
  const tableBills = bills.filter((b) => b.kind === "table");
  const openBill = type === "DINE_IN" && location
    ? tableBills.find((b) => b.table?.toLowerCase() === location.name.toLowerCase()) ?? null
    : guest ? bills.find((b) => b.kind === "room" && b.reservationId === guest.id) ?? null : null;
  // The table already has a customer (its open bill): the new order is theirs — no need to type them again,
  // and they stay the customer even when the bill goes on a room.
  // (Reception's order is always the picked hotel guest's — never someone else's at that table.)
  const tableCustomer = type === "DINE_IN" && !hotelOnly && (!guest || verify) && openBill?.kind === "table" && openBill.phone ? { name: openBill.who, phone: openBill.phone } : null;
  const sameCustomer = !!tableCustomer && otherAt !== location?.id;
  // The customer's own rooms: the stays of the people at the table, and of the number typed in (the customer lookup's room).
  const tableStays = type === "DINE_IN" && openBill?.kind === "table" ? openBill.stays : [];
  // (A customer picked in the search is that person — another one sharing the number never lends them a room.)
  const lookupIsSomeoneElse = !!chosen && name.trim() === chosen.name && !!known.customer && known.customer.id !== chosen.id;
  const phoneStays: PortalStay[] = sameCustomer || lookupIsSomeoneElse ? [] : known.customer?.staying ?? [];
  const ownStays = [...tableStays, ...phoneStays.filter((x) => !tableStays.some((t) => t.id === x.id))];
  // No active checked-in room = a normal restaurant customer (owner, 2026-10-04): a waiter or the Counter gets
  // "Room bill" and room service only for a customer staying here — their own stay, found by their phone or their table.
  const roomAllowed = verify || ownStays.length > 0 || forStay;
  const settlement: Settlement = settlementPick === "ROOM" && !roomAllowed ? (canPay ? "PAY_NOW" : "UNPAID") : settlementPick;
  // A waiter's dine-in / takeaway room bill goes only to the customer's own room — never one picked from a list.
  const roomByStay = !verify && !forStay && settlement === "ROOM";
  const needsGuest = hotelOnly || forStay || (verify && settlement === "ROOM");
  const stay = roomByStay ? ownStays.find((x) => x.id === stayId) ?? null : null;
  const noRoom = !sameCustomer && !validPhone(phone) ? "Add the customer's phone first — then their room shows." : known.looking ? "Checking the customer's room…" : "No room for this customer — pay at the restaurant.";
  const phoneOk = guestHasPhone || sameCustomer || validPhone(phone);
  // "Send to phone": the number the prompt goes to (the customer's, unless changed).
  const viaPhone = settlement === "PAY_NOW" && accountId === PROMPT;
  const promptNumber = (promptPhone ?? (sameCustomer ? tableCustomer?.phone ?? "" : phone)).trim();
  // Reception chose a room that is not the (known) customer's own: the reason is required.
  const otherGuestsRoom = verify && !hotelOnly && !forStay && settlement === "ROOM" && !!guest && (sameCustomer || validPhone(phone)) && !ownStays.some((x) => x.id === guest.id);
  const ready = lines.length > 0 && (joining ? true : (!needsGuest || !!guest) && (!roomByStay || !!stay) && phoneOk && (settlement !== "PAY_NOW" || !!accountId) && (!viaPhone || validPhone(promptNumber)) && (!otherGuestsRoom || roomReason.trim().length >= 3));
  const tile = guest ? guest.rooms.split(",")[0] : type === "DINE_IN" && location?.number ? `T${location.number}` : null;
  const TypeIcon = TYPES.find((t) => t.v === type)?.icon ?? UtensilsCrossed;

  const add = (id: string, d: number) => setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(99, (c[id] ?? 0) + d)) }));
  const pickType = (t: OrderType) => {
    setType(t);
    if (t === "ROOM_SERVICE" && !canPay && settlement === "PAY_NOW") setSettlement(roomBills ? "ROOM" : "UNPAID");
    // Room service is for the staying guest picked from the list: an earlier customer's number or name never carries over.
    if (t === "ROOM_SERVICE" && t !== type) { setPhone(""); setName(""); setChosen(null); }
  };
  const reset = () => { setCart({}); setQ(""); setNotes(""); setLocationId(""); setJoinId(null); setName(""); setPhone(""); setChosen(null); setReference(""); setGuestId(""); setStayId(""); setRoomReason(""); };
  // Reception: the customer's own rooms first in the list.
  const ownIds = new Set(ownStays.map((x) => x.id));
  // Room service for everyone who takes orders (the staying guest is picked from the list); "Room bill" only for a
  // customer staying here.
  const types = TYPES.filter((t) => t.v !== "ROOM_SERVICE" || roomBills);
  const settlements = ([canPay && ["PAY_NOW", "Pay now"], roomBills && roomAllowed && ["ROOM", "Room bill"], ["UNPAID", type === "ROOM_SERVICE" ? "On delivery" : "Pay later"]].filter(Boolean) as [Settlement, string][]);

  async function send() {
    if (joining) {
      // On the shared Restaurant Counter: the waiter chosen above — or asked now.
      const pin = waiterId ? { waiterId } : await askPin(`Add to ${joining.number.replace(/^ORD-\d{4}-0*/, "#")}`);
      if (pin === null) return;
      start(async () => {
        const res = await addOrderItemsAction({ id: joining.id, items: lines.map((l) => ({ menuItemId: l.item.id, quantity: l.qty })), pin });
        if (res.ok) {
          setSent({ id: joining.id, number: joining.number, total: res.data.total, place: who, settlement: "", added: true, again: true,
            lines: lines.map((l) => ({ name: l.item.name, qty: l.qty, price: l.item.price })) });
          setCart({}); setWaiterId("");
          router.refresh();
        } else toast.error(res.error, { duration: 8000 });
      });
      return;
    }
    // On the shared Restaurant Counter the waiter making the order says who they are (the order is theirs) —
    // paid now, the payment is the Counter's own record (the waiter is noted as the one who brought it).
    const pin = waiterId ? { waiterId } : await askPin(settlement === "PAY_NOW" && !viaPhone ? "New order — the payment is recorded at the Counter" : "New order");
    if (pin === null) return;
    start(async () => {
      const res = await createOrderAction({
        // Send to phone: the order goes in unpaid and the prompt follows — paid on the phone, recorded by itself.
        type, settlement: viaPhone ? "UNPAID" : settlement, pin, items: lines.map((l) => ({ menuItemId: l.item.id, quantity: l.qty })),
        reservationId: guest?.id ?? stay?.id ?? null, locationId: type === "DINE_IN" ? location?.id ?? null : null, tableLabel: null,
        // The table's customer stays the customer — the room is only where the bill goes.
        customerName: sameCustomer ? tableCustomer.name : guest ? null : name || null,
        customerPhone: sameCustomer ? tableCustomer.phone : guestHasPhone ? null : phone || null, notes: notes || null,
        customerId: !sameCustomer && !guest && chosen && name.trim() === chosen.name ? chosen.id : null,
        accountId: settlement === "PAY_NOW" && !viaPhone ? accountId : null, reference: settlement === "PAY_NOW" && !viaPhone ? reference || null : null,
        reason: otherGuestsRoom ? roomReason.trim() : null, forStay,
      });
      if (res.ok) {
        let prompt: Sent["prompt"] = null, promptError: string | null = null;
        if (viaPhone) {
          const p = await sendOrdersPromptAction({ orderIds: [res.data.id], phone: promptNumber, handedOverById: null });
          if (p.ok) prompt = { id: p.data.id, amount: p.data.amount, phone: p.data.phone }; else promptError = p.error;
        }
        setSent({ id: res.data.id, number: res.data.number, total: res.data.total, place: who, settlement: viaPhone ? "PROMPT" : settlement, prompt, promptError, promptPhone: promptNumber,
          lines: lines.map((l) => ({ name: l.item.name, qty: l.qty, price: l.item.price })), again: type === "DINE_IN" ? !!location || !!guest : !!guest });
        setCart({}); setNotes(""); setReference(""); setWaiterId("");
        router.refresh();
      }
      else { if (res.fieldErrors?.pin) setWaiterId(""); toast.error(res.error, { duration: 8000 }); }
    });
  }

  const settleNote = settlement === "ROOM"
    ? roomByStay
      ? stay ? `Goes on Room ${stay.rooms}'s bill — no money now, it is collected at check-out.` : ownStays.length ? "Charge it to the customer's own room — only after they agree." : noRoom
      : guest ? `Goes on Room ${guest.rooms}'s bill — no money now, it is collected at check-out.` : "Pick the guest's room above."
    : settlement === "UNPAID" ? (type === "ROOM_SERVICE"
      ? `The guest pays when it arrives — ${canPay ? "record the payment then." : "the Restaurant Counter records the payment."}`
      : `The customer pays when it is served — ${canPay ? "record the payment on the order then." : "the Restaurant Counter records the payment."}`)
    : viaPhone ? "The customer gets a payment request on their phone and confirms it with their PIN. It is recorded automatically."
    : "Paid now — the money goes into the account you pick.";

  return (
    <div className="space-y-4 pb-24 lg:pb-0">
      <OrderLine orders={line} perms={perms} role={role} meId={meId} accounts={canPay ? accounts : []} rooms={verify ? guests.map((g) => ({ id: g.id, label: `Room ${g.rooms} — ${g.name}` })) : []} />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_380px] 2xl:grid-cols-[minmax(0,1fr)_420px]">
        {/* The menu */}
        <section className="min-w-0 space-y-3">
          <div className="relative">
            <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the menu — biryani, Safari, Hennessy…" className="h-12 w-full rounded-2xl border border-border bg-card pl-11 pr-10 text-sm shadow-sm outline-none focus:border-foreground/30" />
            {q && <button type="button" onClick={() => setQ("")} aria-label="Clear" className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="size-4" /></button>}
          </div>
          {!needle && (
            <div className="-mx-1 flex gap-2 overflow-x-auto px-1 pb-1">
              {[{ id: "all", name: "All", type: "ALL", n: all.length }, ...menu.map((c) => ({ id: c.id, name: c.name, type: c.type as string, n: c.items.length }))].map((c) => {
                const Icon = c.type === "ALL" ? LayoutGrid : c.type === "DRINK" ? Wine : UtensilsCrossed;
                const on = cat === c.id;
                return (
                  <button key={c.id} type="button" onClick={() => setCat(c.id)} aria-pressed={on}
                    className={cn("inline-flex h-10 shrink-0 items-center gap-2 rounded-full border pl-1.5 pr-3.5 text-sm font-medium transition",
                      on ? "border-transparent bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-[oklch(0.2_0.03_60)] shadow-[0_8px_18px_-12px_oklch(0.7_0.12_80)]" : "border-border/70 bg-card text-foreground/85 hover:bg-muted/60")}>
                    <span className={cn("grid size-7 place-items-center rounded-full", on ? "bg-black/10" : "bg-muted text-muted-foreground")}><Icon className="size-3.5" /></span>
                    {c.name}<span className={cn("text-[11px] tabular-nums", on ? "text-black/55" : "text-muted-foreground")}>{c.n}</span>
                  </button>
                );
              })}
            </div>
          )}
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
            {shown.map((i) => {
              const qty = cart[i.id] ?? 0;
              return (
                <motion.article key={i.id} layout="position" whileTap={i.isAvailable ? { scale: 0.98 } : undefined}
                  className={cn("group flex flex-col rounded-2xl border bg-card p-2 transition-shadow duration-200 dark:bg-[oklch(0.22_0.008_60)]",
                    !i.isAvailable ? "opacity-55" : qty ? "border-[oklch(0.75_0.12_80)] shadow-[0_12px_28px_-18px_oklch(0.7_0.12_80)] ring-2 ring-[oklch(0.75_0.12_80/0.25)]" : "border-border/60 hover:shadow-[0_14px_30px_-20px_rgba(15,23,42,0.6)]")}>
                  <button type="button" disabled={!i.isAvailable} onClick={() => add(i.id, 1)} className="block text-left disabled:cursor-not-allowed">
                    <div className="relative aspect-[4/3] overflow-hidden rounded-xl bg-muted">
                      {i.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={i.image} alt="" loading="lazy" decoding="async" className="size-full object-cover transition duration-500 group-hover:scale-[1.06]" />
                      ) : (
                        <div className="grid size-full place-items-center bg-linear-to-br from-amber-100 via-orange-100 to-rose-100 dark:from-amber-950/60 dark:via-stone-900 dark:to-rose-950/40">
                          {i.type === "FOOD" ? <UtensilsCrossed className="size-7 text-amber-700/50 dark:text-amber-300/40" /> : <Wine className="size-7 text-rose-700/50 dark:text-rose-300/40" />}
                        </div>
                      )}
                      {!i.isAvailable && <span className="absolute inset-x-0 bottom-0 bg-black/75 py-1 text-center text-[10px] font-semibold uppercase tracking-wider text-white">Sold out</span>}
                      <AnimatePresence>
                        {qty > 0 && (
                          <motion.span key={qty} initial={{ scale: 0.4, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ scale: 0.4, opacity: 0 }} transition={{ type: "spring", stiffness: 520, damping: 22 }}
                            className="absolute right-1.5 top-1.5 grid size-7 place-items-center rounded-full bg-[oklch(0.8_0.11_82)] text-xs font-bold text-[#1b1611] shadow-lg">{qty}</motion.span>
                        )}
                      </AnimatePresence>
                    </div>
                    <div className="px-1 pt-2">
                      <p className="line-clamp-2 min-h-[2.4em] text-[13px] font-semibold leading-tight">{i.name}</p>
                      <p className="mt-0.5 truncate text-[10px] uppercase tracking-wider text-muted-foreground">{i.category}</p>
                    </div>
                  </button>
                  <div className="mt-auto flex items-center justify-between gap-1.5 px-1 pb-0.5 pt-2">
                    <span className="whitespace-nowrap text-[13px] font-bold tabular-nums">{formatTZS(i.price)}</span>
                    {!i.isAvailable ? null : qty ? <Stepper small qty={qty} onMinus={() => add(i.id, -1)} onPlus={() => add(i.id, 1)} /> : (
                      <motion.button type="button" whileTap={{ scale: 0.88 }} onClick={() => add(i.id, 1)} aria-label={`Add ${i.name}`}
                        className="grid size-8 place-items-center rounded-full bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-[oklch(0.2_0.03_60)] shadow-[0_6px_14px_-8px_oklch(0.7_0.12_80)] transition hover:brightness-105"><Plus className="size-4" /></motion.button>
                    )}
                  </div>
                </motion.article>
              );
            })}
            {shown.length === 0 && <p className="col-span-full rounded-3xl border border-dashed border-border py-12 text-center text-sm text-muted-foreground">Nothing matches “{q}”.</p>}
          </div>
        </section>

        {/* The ticket */}
        <aside id="pos-ticket" className="flex scroll-mt-4 flex-col overflow-hidden rounded-3xl border border-border/70 bg-card shadow-sm lg:sticky lg:top-4 lg:max-h-[calc(100svh-2rem)]">
          <header className="flex items-center gap-3 border-b border-border/60 px-4 py-3.5">
            <span className="grid h-11 min-w-11 shrink-0 place-items-center rounded-xl bg-[oklch(0.72_0.12_80/0.18)] px-1.5 text-sm font-bold tabular-nums text-[oklch(0.5_0.11_75)] dark:text-[oklch(0.84_0.11_82)]">{tile ?? <TypeIcon className="size-5" />}</span>
            <div className="min-w-0 flex-1 leading-tight">
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{joining ? `Adding to order ${shortNo(joining.number)}` : "New order"} · {waiter}</p>
              <p className="truncate text-base font-semibold">{who}</p>
              <p className="text-[11px] text-muted-foreground">{joining ? `${plural(joining.items, "item")} so far${joining.total != null ? ` · ${formatTZS(joining.total)}` : ""}` : TYPES.find((t) => t.v === type)?.label}{count ? ` · +${plural(count, "item")}` : ""}{!joining && openBill ? ` · adds to the open bill` : ""}</p>
            </div>
            {count > 0 && <motion.span key={total} initial={{ scale: 0.85, opacity: 0.6 }} animate={{ scale: 1, opacity: 1 }} className="shrink-0 rounded-full bg-foreground px-2.5 py-1 text-xs font-bold tabular-nums text-background">{formatTZS(total)}</motion.span>}
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
            {joining ? (
              <Block icon={UserRound} title="Adding to an open order">
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="flex items-center gap-3 rounded-2xl border border-sky-500/35 bg-sky-500/[0.07] p-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-sky-500/15 text-sky-300"><Plus className="size-5" /></span>
                  <span className="min-w-0 flex-1 text-xs leading-tight">
                    <span className="block text-sm font-semibold">Order {shortNo(joining.number)} · {joining.place}</span>
                    <span className="text-muted-foreground">{joining.customer ?? "Customer"} · the new items join this order{joining.status === "DELIVERED" ? " and go back to the kitchen" : ""}; its bill updates by itself.</span>
                  </span>
                  <button type="button" onClick={() => setJoinId(null)} className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted-foreground ring-1 ring-border hover:bg-muted hover:text-foreground">New order</button>
                </motion.div>
              </Block>
            ) : (
            <Block icon={UserRound} title="Customer">
              <div className={cn("grid gap-1 rounded-2xl bg-muted/70 p-1", types.length === 4 ? "grid-cols-4" : "grid-cols-3")}>
                {types.map((t) => (
                  <button key={t.v} type="button" onClick={() => pickType(t.v)} aria-pressed={type === t.v}
                    className={cn("flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium transition", type === t.v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    <t.icon className="size-4" />{t.label}
                  </button>
                ))}
              </div>
              {type === "DINE_IN" && (
                <div className="mt-2 space-y-1.5 rounded-2xl border border-border/80 bg-background p-2">
                  {([["INSIDE", "Inside"], ["OUTSIDE", "Outside"]] as const).map(([area, label]) => {
                    const row = locations.filter((l) => l.kind === "TABLE" && l.area === area);
                    if (!row.length) return null;
                    return (
                      <div key={area} className="flex items-center gap-1.5">
                        <span className="w-14 shrink-0 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</span>
                        <div className="grid flex-1 grid-cols-6 gap-1">
                          {row.map((l) => {
                            const on = locationId === l.id;
                            return (
                              <button key={l.id} type="button" onClick={() => setLocationId(on ? "" : l.id)} aria-pressed={on} title={`${l.name}${l.busy ? " — has an open order" : ""}`}
                                className={cn("relative h-9 rounded-lg text-sm font-semibold tabular-nums transition", on ? "bg-[oklch(0.72_0.12_80)] text-[oklch(0.2_0.03_60)] shadow-sm" : "bg-muted/60 hover:bg-muted")}>
                                {l.number}
                                {l.busy && <span className={cn("absolute right-1 top-1 size-1.5 rounded-full", on ? "bg-[oklch(0.2_0.03_60)]" : "bg-emerald-400")} />}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                  {locations.filter((l) => l.kind === "COUNTER").map((l) => (
                    <button key={l.id} type="button" onClick={() => setLocationId(locationId === l.id ? "" : l.id)} aria-pressed={locationId === l.id}
                      className={cn("flex h-9 w-full items-center justify-center gap-1.5 rounded-lg text-sm font-semibold transition", locationId === l.id ? "bg-[oklch(0.72_0.12_80)] text-[oklch(0.2_0.03_60)]" : "bg-muted/60 hover:bg-muted")}>
                      <Store className="size-3.5" />{l.name}{l.busy && <span className="size-1.5 rounded-full bg-emerald-400" />}
                    </button>
                  ))}
                  <p className="px-1 text-[10px] text-muted-foreground">{location ? `${location.name} — tap again to clear` : "Pick the table (a green dot = someone is there) — or leave it for the restaurant."}</p>
                </div>
              )}
              {openHere && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 flex items-center gap-2.5 rounded-xl border border-sky-500/35 bg-sky-500/[0.07] px-3 py-2">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-sky-500/15 text-sky-300"><ReceiptText className="size-4" /></span>
                  <span className="min-w-0 flex-1 text-xs leading-tight">
                    <span className="block font-semibold">Open order {shortNo(openHere.number)}{openHere.customer ? ` · ${openHere.customer}` : ""}</span>
                    <span className="text-muted-foreground">{plural(openHere.items, "item")}{openHere.total != null ? ` · ${formatTZS(openHere.total)}` : ""} — the same customer? Add to it.</span>
                  </span>
                  <button type="button" onClick={() => setJoinId(openHere.id)} className="shrink-0 rounded-lg bg-sky-500 px-2.5 py-1.5 text-[11px] font-semibold text-white hover:brightness-110">Add to it</button>
                </motion.div>
              )}
              {openBill && (
                <motion.div initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0 }} className="mt-2 flex items-center gap-2.5 rounded-xl border border-emerald-500/30 bg-emerald-500/[0.07] px-3 py-2">
                  <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"><ReceiptText className="size-4" /></span>
                  <span className="min-w-0 flex-1 text-xs leading-tight">
                    <span className="block font-semibold">{openBill.orders ? `${openBill.label} has an open bill` : `${openBill.who ?? "A customer"} is seated at ${openBill.label}`}</span>
                    <span className="text-muted-foreground">{openBill.orders ? `${plural(openBill.orders, "order")}${openBill.total != null ? ` · ${formatTZS(openBill.total)} so far` : ""} — this order adds to it` : "This order starts their table's bill"}</span>
                  </span>
                  {openBill.total != null && openBill.orderId && <Link href={`/staff/restaurant-bill?order=${openBill.orderId}`} className="shrink-0 rounded-lg bg-background px-2 py-1 text-[11px] font-semibold ring-1 ring-border hover:bg-muted">Bill</Link>}
                </motion.div>
              )}
              {(hotelOnly || forStay) && !guest ? (
                <p className="mt-2 flex items-start gap-2 rounded-xl bg-violet-500/[0.08] px-3 py-2 text-xs text-violet-800 ring-1 ring-inset ring-violet-500/25 dark:text-violet-200">
                  <BedDouble className="mt-0.5 size-3.5 shrink-0" />{hotelOnly ? "Reception orders are for guests staying in the hotel — pick their room below. Anyone else orders at the restaurant." : "Room service goes to a guest staying in the hotel — pick their room below."}
                </p>
              ) : sameCustomer ? (
                <div className="mt-2 flex items-center gap-2.5 rounded-xl border border-border/80 bg-background px-3 py-2">
                  <span className="grid size-8 shrink-0 place-items-center rounded-full bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"><UserRound className="size-4" /></span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-sm font-semibold">{tableCustomer.name ?? "The table's customer"}</span>
                    <span className="text-[11px] text-muted-foreground">{tableCustomer.phone} · already at this table{tableStays.length ? ` · Room ${tableStays.map((x) => x.rooms).join(", ")}` : ""}</span>
                  </span>
                  <button type="button" onClick={() => setOtherAt(location?.id ?? null)} className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted-foreground ring-1 ring-border hover:bg-muted hover:text-foreground">Different customer</button>
                </div>
              ) : guestHasPhone ? (
                <p className="mt-2 flex items-center gap-1.5 rounded-xl bg-emerald-500/[0.07] px-3 py-2 text-xs text-emerald-700 dark:text-emerald-300"><Phone className="size-3.5" />Updates go to {guest?.name.split(" ")[0]} · the phone on their booking</p>
              ) : (
                <>
                  {/* A customer we already have: search and tap — the phone and name fill in. */}
                  {!guest && <CustomerFinder className="mt-2" onPick={(c) => { setChosen({ id: c.id, name: c.name }); if (c.phone) setPhone(c.phone); setName(c.name); }} />}
                  <div className="mt-2 grid grid-cols-2 gap-2">
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" required placeholder={guest ? `${guest.name.split(" ")[0]}'s phone (required)` : "Phone (required)"}
                      className={cn(field, guest && "col-span-2", phone && !validPhone(phone) && "border-rose-500/60")} />
                    {!guest && <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" className={field} />}
                  </div>
                  {!guest && <KnownCustomerNote phone={phone} lookup={known} className="mt-2" />}
                  {tableCustomer && <button type="button" onClick={() => setOtherAt(null)} className="mt-1.5 text-[11px] font-medium text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">Same customer as the table ({tableCustomer.name ?? tableCustomer.phone})</button>}
                </>
              )}
              {(needsGuest || (type === "DINE_IN" && verify)) && (
                <div className="mt-2 space-y-2">
                  <StayingGuestPicker guests={guests} value={guestId || null} onChange={(id) => { setGuestId(id); if (forStay && id !== guestId) { setPhone(""); setName(""); setChosen(null); } }} ownIds={ownIds} required={needsGuest} />
                  {guest && otherGuestsRoom && (
                    <div className="rounded-xl border border-amber-500/40 bg-amber-500/[0.06] p-2.5">
                      <p className="text-[11px] font-medium text-amber-700 dark:text-amber-300">This is not the customer&apos;s own room — say why it goes on it.</p>
                      <input value={roomReason} onChange={(e) => setRoomReason(e.target.value)} placeholder="Why? e.g. the guest in this room pays for their friend" className="mt-1 h-9 w-full rounded-lg border border-border bg-transparent px-2 text-sm outline-none" />
                    </div>
                  )}
                </div>
              )}
            </Block>
            )}

            {/* The shared Restaurant Counter: who serves this order — it is theirs, the kitchen sees it with their name. */}
            {device && (
              <Block icon={HandPlatter} title="Waiter">
                <WaiterChips value={waiterId} onChange={setWaiterId} />
              </Block>
            )}

            <Block icon={ReceiptText} title="Order details" action={lines.length > 0 && <button type="button" onClick={() => setCart({})} className="text-xs font-medium text-muted-foreground hover:text-rose-600">Clear</button>}>
              {lines.length === 0 ? (
                <p className="rounded-2xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">Tap a dish or drink to add it</p>
              ) : (
                <ul className="space-y-2">
                  {lines.map((l) => (
                    <li key={l.item.id} className="flex items-center gap-2.5 rounded-2xl bg-muted/40 p-2">
                      {l.item.image ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={l.item.image} alt="" className="size-11 shrink-0 rounded-xl object-cover" />
                      ) : <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-muted">{l.item.type === "FOOD" ? <UtensilsCrossed className="size-4 text-muted-foreground" /> : <Wine className="size-4 text-muted-foreground" />}</span>}
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="block truncate text-sm font-medium">{l.item.name}</span>
                        <span className="text-[11px] tabular-nums text-muted-foreground">{formatTZS(l.item.price * l.qty)}</span>
                      </span>
                      <Stepper qty={l.qty} onMinus={() => add(l.item.id, -1)} onPlus={() => add(l.item.id, 1)} />
                      <button type="button" aria-label={`Remove ${l.item.name}`} onClick={() => add(l.item.id, -99)} className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-background hover:text-rose-600"><Trash2 className="size-3.5" /></button>
                    </li>
                  ))}
                </ul>
              )}
              <div className="mt-2 flex items-center gap-2 rounded-xl border border-border bg-background px-3">
                <NotebookPen className="size-3.5 shrink-0 text-muted-foreground" />
                <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note for the kitchen — no onions, extra spicy…" className="h-9 w-full bg-transparent text-xs outline-none" />
              </div>
            </Block>

            {!joining && <Block icon={CircleDollarSign} title="Payment">
              <div className={cn("grid gap-1 rounded-2xl bg-muted/70 p-1", settlements.length === 3 ? "grid-cols-3" : settlements.length === 2 ? "grid-cols-2" : "grid-cols-1")}>
                {settlements.map(([v, label]) => (
                  <button key={v} type="button" onClick={() => setSettlement(v)} aria-pressed={settlement === v}
                    className={cn("rounded-xl py-2 text-sm font-medium transition", settlement === v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{label}</button>
                ))}
              </div>
              <p className={cn("mt-2 rounded-xl px-3 py-2 text-xs", settlement === "ROOM" && !(roomByStay && !ownStays.length) ? "bg-violet-500/10 text-violet-800 dark:text-violet-200" : settlement !== "PAY_NOW" ? "bg-rose-500/10 text-rose-800 dark:text-rose-200" : "bg-emerald-500/10 text-emerald-800 dark:text-emerald-200")}>{settleNote}</p>
              {/* A waiter's room bill: the customer's own rooms only — tap one (only after they agree) */}
              {roomByStay && ownStays.length > 0 && (
                <div className="mt-2 grid gap-1.5">
                  {ownStays.map((x) => {
                    const on = stayId === x.id;
                    return (
                      <button key={x.id} type="button" onClick={() => setStayId(on ? "" : x.id)} aria-pressed={on}
                        className={cn("flex items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left leading-tight transition", on ? "border-violet-500 bg-violet-500/10" : "border-border hover:bg-muted")}>
                        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", on ? "bg-violet-500 text-white" : "bg-violet-500/12 text-violet-700 dark:text-violet-300")}><BedDouble className="size-4" /></span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-semibold">{settlement === "ROOM" ? "Charge to" : "Room service to"} Room {x.rooms}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">Customer: {x.guestName} · Room {x.rooms}{x.foodPayer ? ` · ${x.foodPayer}` : ""}</span>
                        </span>
                        {on && <Check className="size-3.5 shrink-0 text-violet-600 dark:text-violet-300" />}
                      </button>
                    );
                  })}
                </div>
              )}
              {settlement === "PAY_NOW" && (
                <div className="mt-2 space-y-2">
                  {mobileOk && (
                    <div className={cn("rounded-2xl border p-3 transition", viaPhone ? "border-sky-500/60 bg-sky-500/[0.08]" : "border-border")}>
                      <button type="button" onClick={() => { pickedAccount.current = true; setAccountId(PROMPT); }} aria-pressed={viaPhone} className="flex w-full items-center gap-2.5 text-left">
                        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", viaPhone ? "bg-sky-600 text-white" : "bg-sky-500/12 text-sky-600 dark:text-sky-300")}><Smartphone className="size-4" /></span>
                        <span className="min-w-0 flex-1 leading-tight"><span className="block text-sm font-semibold">Mobile money</span><NetworkMarks label={null} compact className="mt-1" /></span>
                        {viaPhone && <Check className="size-4 shrink-0 text-sky-600 dark:text-sky-300" />}
                      </button>
                      {viaPhone && (
                        <input value={promptPhone ?? (sameCustomer ? tableCustomer?.phone ?? "" : phone)} onChange={(e) => setPromptPhone(e.target.value)} type="tel" inputMode="tel" aria-label="Customer's phone number"
                          placeholder="Phone number, e.g. 0712 345 678" className={cn(field, "mt-2.5 h-10 tabular-nums")} />
                      )}
                    </div>
                  )}
                  {mobileOk && <p className="pt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Other payment methods</p>}
                  <div className="grid grid-cols-2 gap-1.5">
                    {accounts.map((a) => (
                      <button key={a.id} type="button" onClick={() => { pickedAccount.current = true; setAccountId(a.id); }} aria-pressed={accountId === a.id}
                        className={cn("flex items-center justify-between rounded-xl border px-2.5 py-1.5 text-left text-xs leading-tight", accountId === a.id ? "border-emerald-500 bg-emerald-500/10" : "border-border hover:bg-muted")}>
                        <span className="min-w-0"><span className="block truncate font-medium">{a.name}</span><span className="font-mono text-[10px] text-muted-foreground">{a.number ?? "—"}</span></span>
                        {accountId === a.id && <Check className="size-3.5 shrink-0 text-emerald-600" />}
                      </button>
                    ))}
                  </div>
                  {accountDetail(accounts.find((a) => a.id === accountId)) && <p className="truncate text-[11px] text-muted-foreground">{accountDetail(accounts.find((a) => a.id === accountId))}</p>}
                  {!viaPhone && <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Reference (M-Pesa code / card slip) — optional" className={cn(field, "h-9 font-mono text-xs")} />}
                </div>
              )}
            </Block>}
          </div>

          <footer className="space-y-3 border-t border-border/70 bg-muted/30 p-4">
            <dl className="space-y-1 text-sm">
              {food > 0 && <div className="flex justify-between text-muted-foreground"><dt>Food</dt><dd className="tabular-nums">{formatTZS(food)}</dd></div>}
              {drinks > 0 && <div className="flex justify-between text-muted-foreground"><dt>Drinks</dt><dd className="tabular-nums">{formatTZS(drinks)}</dd></div>}
              {serviceFee > 0 && <div className="flex justify-between text-muted-foreground"><dt>Room service fee</dt><dd className="tabular-nums">{formatTZS(serviceFee)}</dd></div>}
              <div className="flex items-end justify-between pt-1"><dt className="text-sm font-semibold">Total</dt><dd className="text-2xl font-bold tabular-nums">{formatTZS(total)}</dd></div>
            </dl>
            <motion.button type="button" whileTap={{ scale: 0.98 }} disabled={!ready || pending} onClick={() => void send()}
              className={cn("flex h-12 w-full items-center justify-center gap-2 rounded-2xl text-[15px] font-semibold transition [&_svg]:size-4",
                ready ? "bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-[oklch(0.2_0.03_60)] shadow-[0_10px_24px_-12px_oklch(0.7_0.12_80)] ring-1 ring-inset ring-white/30 hover:brightness-105" : "bg-muted text-muted-foreground")}>
              {pending ? <Loader2 className="animate-spin" /> : joining ? <Plus /> : <ChefHat />}{lines.length ? joining ? `Add to ${shortNo(joining.number)} · ${formatTZS(total)}` : `Send to kitchen · ${formatTZS(total)}` : "Add items to the order"}
            </motion.button>
            {lines.length > 0 && !ready && <p className="text-center text-[11px] text-muted-foreground">{needsGuest && !guest ? (hotelOnly ? "Pick the hotel guest's room first — reception orders are for guests staying here." : "Choose the guest's room first.") : roomByStay && !stay ? (ownStays.length ? (settlement === "ROOM" ? "Tap the customer's room to charge it." : "Tap the customer's room — the food goes there.") : noRoom) : !phoneOk ? "Add the customer's phone — every order needs one." : viaPhone ? "Enter the customer's phone number to send the payment request." : "Choose the account the money goes into."}</p>}
          </footer>
        </aside>
      </div>

      {/* Sent: the order's summary — print its bill, add more for the same table / room, or start fresh */}
      <Dialog open={!!sent} onOpenChange={(v) => { if (!v) setSent(null); }}>
        <DialogContent className="sm:max-w-sm">
          {sent && (
            <div className="space-y-4">
              <DialogHeader eyebrow={sent.place} tone="gold"
                icon={<motion.span initial={{ scale: 0.3, rotate: -20, opacity: 0 }} animate={{ scale: 1, rotate: 0, opacity: 1 }} transition={{ type: "spring", stiffness: 380, damping: 18 }} className="grid place-items-center"><Check strokeWidth={3} /></motion.span>}>
                <DialogTitle>{sent.added ? `Added to order #${sent.number.replace(/^ORD-\d{4}-0*/, "")}` : `Order #${sent.number.replace(/^ORD-\d{4}-0*/, "")} sent to the kitchen`}</DialogTitle>
              </DialogHeader>
              <ul className="divide-y divide-dashed divide-border rounded-2xl border border-border/70 bg-muted/30 px-3 text-sm">
                {sent.lines.map((l) => (
                  <li key={l.name} className="flex justify-between gap-2 py-1.5"><span className="truncate"><span className="font-semibold tabular-nums">{l.qty}×</span> {l.name}</span><span className="shrink-0 tabular-nums text-muted-foreground">{(l.qty * l.price).toLocaleString("en-US")}</span></li>
                ))}
                <li className="flex justify-between py-2 font-semibold"><span>{sent.added ? "Order total now" : "Total"}</span><span className="tabular-nums">{formatTZS(sent.total)}</span></li>
              </ul>
              {sent.settlement === "PROMPT" ? (
                <>
                  {sent.promptError && <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">The payment request was not sent: {sent.promptError} Send it again below.</p>}
                  <SendToPhone target={{ kind: "orders", orderIds: [sent.id] }} amount={sent.total} phone={sent.promptPhone ?? ""} resume={sent.prompt ?? null} />
                </>
              ) : <p className="text-center text-xs text-muted-foreground">{sent.added ? "The kitchen has the new items — the bill shows everything." : sent.settlement === "ROOM" ? "On the room bill — paid at check-out." : sent.settlement === "PAY_NOW" ? "Paid." : "Not paid yet — print the bill for the customer when they are ready to pay."}</p>}
              <div className="grid gap-2">
                <Link href={`/staff/restaurant-bill?order=${sent.id}`} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-sm font-semibold text-[oklch(0.2_0.03_60)] ring-1 ring-inset ring-white/30 hover:brightness-105"><Printer className="size-4" />Print / download bill</Link>
                {sent.again && <Button variant="outline" className="h-11" onClick={() => setSent(null)}><Plus />Add more for {sent.place}</Button>}
                <Button variant="ghost" className="h-10" onClick={() => { reset(); setSent(null); }}>New order</Button>
              </div>
            </div>
          )}
        </DialogContent>
      </Dialog>

      {/* Phone: the ticket is below the menu — jump to it. */}
      {count > 0 && (
        <a href="#pos-ticket" className="fixed inset-x-3 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-30 flex h-14 items-center justify-between rounded-2xl bg-foreground px-4 text-background shadow-2xl lg:hidden">
          <span className="flex items-center gap-2 text-sm font-semibold"><span className="grid size-7 place-items-center rounded-full bg-amber-500 text-xs font-bold text-black">{count}</span>Review order</span>
          <span className="font-bold tabular-nums">{formatTZS(total)}</span>
        </a>
      )}
    </div>
  );
}

function Block({ icon: Icon, title, action, children }: { icon: typeof UserRound; title: string; action?: React.ReactNode; children: React.ReactNode }) {
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><Icon className="size-3.5" />{title}</p>
        {action}
      </div>
      {children}
    </section>
  );
}

function Stepper({ qty, onMinus, onPlus, small }: { qty: number; onMinus: () => void; onPlus: () => void; small?: boolean }) {
  const btn = small ? "size-6" : "size-7";
  return (
    <span className="inline-flex shrink-0 items-center rounded-full border border-border bg-background p-0.5">
      <button type="button" onClick={onMinus} aria-label="One less" className={cn("grid place-items-center rounded-full hover:bg-muted", btn)}><Minus className="size-3.5" /></button>
      <span className={cn("text-center text-sm font-bold tabular-nums", small ? "w-5" : "w-6")}>{qty}</span>
      <button type="button" onClick={onPlus} aria-label="One more" className={cn("grid place-items-center rounded-full bg-amber-500 text-black hover:bg-amber-400", btn)}><Plus className="size-3.5" /></button>
    </span>
  );
}

/** What this person presses next on a strip card (null = open the order to act on it). */
function quickStep(o: PortalOrder, perms: PortalPerms, role: PortalRole): { status: string; label: string; icon: React.ReactNode } | "open" | null {
  const due = (o.due ?? 0) > 0;
  if (role === "desk") return due || (o.update && !o.told) || o.payments.some((p) => p.status === "POSTED" && !p.confirmedAt) ? "open" : null;
  // The Mpishi and the waiters prepare any order; someone with only the bar permission, drinks-only orders.
  const prep = perms.cook || (o.items.length > 0 && o.items.every((i) => i.type === "DRINK") && perms.bar);
  // Paid online: accepted only once the Counter has confirmed the money is in the account.
  if (o.status === "PENDING" && o.awaitsPayment) return perms.pay ? "open" : null;
  if (o.status === "PENDING" && prep) return { status: "PREPARING", label: "Accept", icon: <ChefHat /> };
  // A waiter on their own phone: accepted drinks they bring themselves (Served); food is with the kitchen.
  const waiterPhone = perms.serve && !perms.device && !perms.watch && !perms.pay && role !== "cook";
  if ((o.status === "PREPARING" || o.status === "ACCEPTED") && waiterPhone) {
    const drinks = o.items.length > 0 && o.items.every((i) => i.type === "DRINK");
    return drinks ? ((o.due ?? 0) > 0 ? "open" : { status: "DELIVERED", label: "Served", icon: <CircleCheck /> }) : null;
  }
  if ((o.status === "PREPARING" || o.status === "ACCEPTED") && prep) return allPrepared(o) ? { status: "READY", label: "Ready", icon: <Check /> } : "open";
  if (o.status === "READY" && perms.serve) return { status: "OUT_FOR_DELIVERY", label: "Serve", icon: <HandPlatter /> };
  if (o.status === "OUT_FOR_DELIVERY" && perms.serve) return due ? "open" : { status: "DELIVERED", label: "Served", icon: <CircleCheck /> };
  if (o.status === "DELIVERED" && perms.serve) return "open";
  return null;
}
const DESK_LABEL = (o: PortalOrder) => (o.update && !o.told ? "Text customer" : (o.due ?? 0) > 0 ? (o.awaitsPayment ? "Confirm online payment" : "Take payment") : "Confirm payment");
/** The strip button that opens the order: payment words only for those who record payments (the Counter) — never a waiter. */
const openLabel = (o: PortalOrder, perms: PortalPerms) => {
  const due = (o.due ?? 0) > 0;
  if (o.status === "PENDING" && o.awaitsPayment && perms.pay) return "Check payment";
  // A waiter's accepted drinks: they bring them (Served asks how it is paid).
  if ((o.status === "PREPARING" || o.status === "ACCEPTED") && perms.serve && !perms.device && !perms.watch && !perms.pay) return "Served";
  if (o.status === "PREPARING") return "Tick items";
  if (o.status === "OUT_FOR_DELIVERY") return due && perms.pay && !o.awaitsPayment ? "Mark served & record payment" : "Mark served";
  if (o.status === "DELIVERED") return !due || !perms.pay ? "Open the order" : o.awaitsPayment ? "Confirm online payment" : "Take payment";
  return "Open";
};
const PILL: Record<string, { label: string; dot: string }> = {
  PENDING: { label: "New", dot: "bg-sky-500" }, ACCEPTED: { label: "Accepted", dot: "bg-amber-500" }, PREPARING: { label: "Preparing", dot: "bg-amber-500" },
  READY: { label: "Ready to serve", dot: "bg-emerald-500" }, OUT_FOR_DELIVERY: { label: "Serving", dot: "bg-violet-500" }, DELIVERED: { label: "Served · to pay", dot: "bg-rose-500" },
};
/** Each person sees their own work first: new orders for the Mpishi, ready ones for waiters. */
const RANK: Record<PortalRole, string[]> = {
  cook: ["PENDING", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", "DELIVERED"],
  waiter: ["READY", "DELIVERED", "OUT_FOR_DELIVERY", "PENDING", "ACCEPTED", "PREPARING"],
  desk: ["DELIVERED", "READY", "OUT_FOR_DELIVERY", "PENDING", "ACCEPTED", "PREPARING"],
  manager: ["PENDING", "READY", "DELIVERED", "ACCEPTED", "PREPARING", "OUT_FOR_DELIVERY"],
};

/** Open orders on a line: one tap does your next step; tap the card for everything you can do. */
function OrderLine({ orders, perms, role, meId, accounts, rooms }: { orders: PortalOrder[]; perms: PortalPerms; role: PortalRole; meId: string | null; accounts: PayAccount[]; rooms: { id: string; label: string }[] }) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);
  const open = orders.find((x) => x.id === openId) ?? null;
  const n = (s: string[]) => orders.filter((x) => s.includes(x.status)).length;
  const ranked = [...orders].sort((a, b) => RANK[role].indexOf(a.status) - RANK[role].indexOf(b.status) || a.createdAt.localeCompare(b.createdAt));
  return (
    <section className="rounded-2xl border border-border/60 bg-muted/30 p-2.5 dark:bg-white/[0.02]">
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-1.5 pb-2.5">
        <p className="text-[13px] font-semibold">Open orders <span className="ml-1 font-normal text-muted-foreground">{orders.length}</span></p>
        <div className="ml-auto flex flex-wrap items-center gap-3 text-[11px] text-muted-foreground">
          {([["New", ["PENDING"], "bg-sky-500"], ["Preparing", ["ACCEPTED", "PREPARING"], "bg-amber-500"], ["Ready", ["READY"], "bg-emerald-500"], ["Serving", ["OUT_FOR_DELIVERY", "DELIVERED"], "bg-violet-500"]] as const).map(([label, st, dot]) => (
            <span key={label} className="inline-flex items-center gap-1.5"><span className={cn("size-1.5 rounded-full", dot)} /><strong className="font-semibold tabular-nums text-foreground">{n([...st])}</strong>{label}</span>
          ))}
          <Link href="/staff/restaurant" className="font-semibold text-[oklch(0.55_0.11_75)] hover:underline dark:text-[oklch(0.8_0.11_82)]">Full board →</Link>
        </div>
      </header>
      <MotionConfig reducedMotion="user">
        <LayoutGroup>
          <div className="-mx-0.5 flex snap-x gap-3 overflow-x-auto px-0.5 pb-2 pt-1 [scrollbar-width:thin]">
            {ranked.length === 0 && <p className="w-full py-6 text-center text-sm text-muted-foreground">No open orders — new ones appear here by themselves.</p>}
            <AnimatePresence initial mode="popLayout">
              {ranked.map((o, i) => <LineCard key={o.id} index={i} o={o} perms={perms} role={role} now={now} onOpen={() => setOpenId(o.id)} />)}
            </AnimatePresence>
          </div>
        </LayoutGroup>
      </MotionConfig>

      {open && <OrderCard key={open.id} o={open} perms={perms} role={role} meId={meId} now={now} fresh={false} accounts={accounts} rooms={rooms} roomy sheetOnly onClose={() => setOpenId(null)} />}
    </section>
  );
}

/** Where the order is on its way: New → Preparing → Ready → Out (one segment each). */
const STAGE: Record<string, number> = { PENDING: 0, ACCEPTED: 1, PREPARING: 1, READY: 2, OUT_FOR_DELIVERY: 3, DELIVERED: 3 };
const STAGE_COLOR = ["bg-sky-500", "bg-amber-500", "bg-emerald-500", "bg-violet-500"];
const STAGE_GLOW = ["bg-sky-500/20", "bg-amber-500/20", "bg-emerald-500/20", "bg-violet-500/20"];

function LineCard({ o, index, perms, role, now, onOpen }: { o: PortalOrder; index: number; perms: PortalPerms; role: PortalRole; now: number; onOpen: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const step = quickStep(o, perms, role);
  const accent = ACCENT[o.status] ?? ACCENT.PENDING;
  const pill = PILL[o.status] ?? PILL.PENDING;
  const stage = STAGE[o.status] ?? 0;
  const waited = Math.max(0, Math.round((now - new Date(o.createdAt).getTime()) / 60000));
  const count = o.items.reduce((t, i) => t + i.quantity, 0);
  const photos = o.items.filter((i) => i.image).slice(0, 3);
  const pay = o.total != null ? payBadgeFor(o, perms, role) : null;
  // On the restaurant screen, an order nobody has asks the waiter's PIN first — pressing the step makes it theirs.
  const askPin = useWaiterPin();
  const run = async (status: string) => {
    const pin = perms.device && !o.assignedTo ? await askPin(`${o.number.replace(/^ORD-\d{4}-0*/, "#")} · ${o.place}`) : undefined;
    if (pin === null) return;
    start(async () => {
      const res = await setOrderStatusAction({ id: o.id, status: status as never, pin });
      if (res.ok) router.refresh(); else { toast.error(res.error, { duration: 8000 }); onOpen(); }
    });
  };
  return (
    <motion.article layout layoutId={`line-${o.id}`}
      initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0, y: -8, scale: 0.92 }}
      transition={{ type: "spring", stiffness: 360, damping: 30, delay: Math.min(index, 8) * 0.035 }}
      whileHover={{ y: -3 }}
      className="group relative flex w-72 shrink-0 snap-start flex-col overflow-hidden rounded-2xl border border-border/60 bg-card p-3 shadow-[0_1px_2px_rgba(15,23,42,0.06)] transition-shadow hover:shadow-[0_18px_34px_-20px_rgba(15,23,42,0.6)] dark:bg-[oklch(0.22_0.008_60)]">
      {/* A soft glow in the status colour, top right */}
      <span aria-hidden className={cn("pointer-events-none absolute -right-10 -top-12 size-28 rounded-full opacity-60 blur-2xl transition-opacity group-hover:opacity-90", STAGE_GLOW[stage])} />

      {/* Progress: New → Preparing → Ready → Out */}
      <div className="relative mb-3 flex gap-1" aria-label={`Step ${stage + 1} of 4: ${pill.label}`}>
        {STAGE_COLOR.map((c, i) => (
          <span key={c} className="h-1 flex-1 overflow-hidden rounded-full bg-muted">
            <motion.span className={cn("block h-full rounded-full", c)} initial={false}
              animate={{ width: i < stage ? "100%" : i === stage ? "55%" : "0%" }} transition={{ duration: 0.6, ease: "easeOut" }} />
          </span>
        ))}
      </div>

      <button type="button" onClick={onOpen} className="relative flex items-start gap-2.5 text-left">
        <span className={cn("grid h-10 min-w-10 shrink-0 place-items-center rounded-xl px-1 text-xs font-bold tabular-nums [&_svg]:size-4", accent.tile)}>{tileText(o)}</span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex items-baseline justify-between gap-2">
            <span className="truncate text-[15px] font-semibold tracking-tight">{o.place}</span>
            <span suppressHydrationWarning className={cn("shrink-0 text-[11px] font-medium tabular-nums", !o.readyAt && waited >= 25 ? "text-rose-600 dark:text-rose-400" : !o.readyAt && waited >= 15 ? "text-amber-600 dark:text-amber-400" : "text-muted-foreground")}>{since(waited)}</span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">{o.customer ?? "Walk-in"} · {shortNo(o.number)}</span>
        </span>
      </button>

      {/* What is in it: the food photos and a short list */}
      <button type="button" onClick={onOpen} className="relative mt-2.5 flex items-center gap-2 rounded-xl bg-muted/50 px-2 py-1.5 text-left transition hover:bg-muted">
        <span className="flex shrink-0 -space-x-2">
          {photos.length ? photos.map((i, k) => (
            <motion.img key={i.id} src={i.image!} alt="" className="size-7 rounded-full object-cover ring-2 ring-card"
              initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} transition={{ delay: 0.08 + k * 0.05, type: "spring", stiffness: 420, damping: 22 }} />
          )) : <span className="grid size-7 place-items-center rounded-full bg-card text-muted-foreground ring-2 ring-card">{o.items.every((i) => i.type === "DRINK") ? <Wine className="size-3.5" /> : <UtensilsCrossed className="size-3.5" />}</span>}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs">
          <span className="font-semibold">{count} item{count === 1 ? "" : "s"}</span>
          <span className="text-muted-foreground"> · {o.items.map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.name}`).join(", ")}</span>
        </span>
      </button>

      <div className="relative mt-2.5 flex min-w-0 items-center gap-1.5 text-[10px] font-semibold">
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-muted px-2 py-0.5">
          <span className="relative flex size-1.5">
            {o.status === "PENDING" && <span className={cn("absolute inline-flex size-full animate-ping rounded-full opacity-70", pill.dot)} />}
            <span className={cn("relative inline-flex size-1.5 rounded-full", pill.dot)} />
          </span>
          {o.status === "DELIVERED" && o.awaitsPayment ? "Served · paid online" : pill.label}{o.status === "PREPARING" ? ` · ${o.items.filter((i) => i.prepared).length}/${o.items.length}` : ""}
        </span>
        {pay && <span className={cn("truncate rounded-full px-2 py-0.5 ring-1 ring-inset", pay.tone)}>{pay.text}</span>}
      </div>

      <div className="relative mt-3 flex items-center gap-1.5">
        {step && step !== "open" ? (
          <motion.button type="button" disabled={pending} onClick={() => run(step.status)} whileTap={{ scale: 0.96 }}
            className="relative flex h-8 flex-1 items-center justify-center gap-1.5 overflow-hidden rounded-lg bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-xs font-semibold text-[oklch(0.2_0.03_60)] shadow-[0_6px_14px_-10px_oklch(0.7_0.12_80)] ring-1 ring-inset ring-white/30 transition hover:brightness-105 disabled:opacity-60 [&_svg]:size-3.5">
            {/* a light sweep across the gold on hover */}
            <span aria-hidden className="pointer-events-none absolute inset-y-0 -left-1/2 w-1/2 -skew-x-12 bg-white/35 opacity-0 transition-all duration-700 group-hover:left-full group-hover:opacity-100" />
            {pending ? <Loader2 className="animate-spin" /> : step.icon}{step.label}
          </motion.button>
        ) : (
          <motion.button type="button" onClick={onOpen} whileTap={{ scale: 0.97 }} className={cn("flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg text-xs font-semibold transition",
            step === "open" ? "bg-foreground text-background hover:opacity-90" : "bg-muted text-muted-foreground hover:text-foreground")}>
            {step === "open" ? (role === "desk" ? DESK_LABEL(o) : openLabel(o, perms)) : "View order"}
          </motion.button>
        )}
        {step && <button type="button" onClick={onOpen} aria-label="Open order" title="Open the order" className="grid size-8 shrink-0 place-items-center rounded-lg border border-border/70 text-muted-foreground transition hover:bg-muted hover:text-foreground"><Maximize2 className="size-3.5" /></button>}
      </div>
    </motion.article>
  );
}
