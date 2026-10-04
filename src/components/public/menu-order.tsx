"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, BedDouble, Check, CreditCard, Loader2, MapPin, Minus, Phone, Plus, ShoppingBag, Trash2, UserRound, UtensilsCrossed, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { identifyCustomerAction, placeOnlineOrderAction } from "@/app/order/actions";
import { phoneLabel, rememberAddress, useWho, useWhoForm, whoForOrder, type Who } from "@/components/restaurant/who";
import { NO_PAYMENT, PayFirst, payFirstReady, type PayFirstValue, type PayOption } from "@/components/restaurant/pay-first";
import { eyebrow, fieldInput, fieldLabel, fieldTextarea, goldText, pillGold, type } from "./ui";

const n = (v: number) => v.toLocaleString("en-US");

/** A line in the order: one menu item (one size of a drink), as the menu shows it. */
export type OrderLine = { id: string; name: string; price: number; qty: number; image: string | null };
/** Eat here, or take out — brought to the address the customer gives. */
type Kind = "DINE_IN" | "TAKEAWAY";
const KINDS: { v: Kind; label: string; hint: string; icon: typeof UtensilsCrossed }[] = [
  { v: "DINE_IN", label: "Eat here", hint: "At the restaurant or bar", icon: UtensilsCrossed },
  { v: "TAKEAWAY", label: "Take out", hint: "We deliver it to you", icon: ShoppingBag },
];

/**
 * The website menu's basket: menu item id → how many (the same ids the restaurant takes orders with).
 * Like at a table: before the first item goes in, the customer says who they are (phone, then name).
 */
export function useMenuOrder(items: { id: string; name: string; price: number; available: boolean; image: string | null }[]) {
  const [basket, setBasket] = useState<Record<string, number>>({});
  const byId = useMemo(() => new Map(items.map((i) => [i.id, i])), [items]);
  const [who, setWho] = useWho();
  const [asking, setAsking] = useState<{ id: string; qty: number } | "change" | null>(null);
  const apply = (id: string, qty: number) => setBasket((b) => {
    const next = { ...b };
    if (qty <= 0) delete next[id]; else next[id] = Math.min(20, qty);
    return next;
  });
  const setQty = (id: string, qty: number) => {
    if (!who && qty > (basket[id] ?? 0)) setAsking({ id, qty });
    else apply(id, qty);
  };
  const askingFor = asking && asking !== "change" ? byId.get(asking.id) ?? null : null;
  const lines: OrderLine[] = Object.entries(basket).flatMap(([id, qty]) => {
    const i = byId.get(id);
    return i ? [{ id, name: i.name, price: i.price, qty, image: i.image }] : [];
  });
  return {
    basket, lines, setQty, qty: (id: string) => basket[id] ?? 0, clear: () => setBasket({}),
    count: lines.reduce((t, l) => t + l.qty, 0), subtotal: lines.reduce((t, l) => t + l.qty * l.price, 0),
    who, asking: asking !== null, askingFor, askWho: () => setAsking("change"), cancelWho: () => setAsking(null),
    confirmWho: (w: Who) => { setWho(w); if (asking && asking !== "change") apply(asking.id, asking.qty); setAsking(null); },
  };
}
export type MenuOrder = ReturnType<typeof useMenuOrder>;

/** "+ Add" — then "− 2 +" once it is in the order. */
export function AddControl({ qty, name, onChange, size = "md", disabled }: { qty: number; name: string; onChange: (qty: number) => void; size?: "sm" | "md"; disabled?: boolean }) {
  const h = size === "sm" ? "h-9" : "h-11";
  if (disabled) return <span className="shrink-0 rounded-full bg-paper-deep px-3 py-1.5 text-xs font-medium text-tone/60">Not today</span>;
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {qty === 0 ? (
        <motion.button key="add" type="button" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} whileTap={{ scale: 0.9 }}
          onClick={(e) => { e.stopPropagation(); onChange(1); }} aria-label={`Add ${name}`}
          className={cn(h, "inline-flex shrink-0 items-center gap-1.5 rounded-full bg-gold px-4 text-sm font-semibold text-[#1a140c] shadow-[0_8px_22px_-10px_oklch(0.72_0.12_80/0.9)] transition hover:brightness-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 focus-visible:ring-offset-paper")}>
          <Plus className="size-4" strokeWidth={2.5} />Add
        </motion.button>
      ) : (
        <motion.span key="qty" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}
          className={cn(h, "inline-flex shrink-0 items-center rounded-full bg-tone text-paper shadow-[0_8px_22px_-12px_rgba(20,15,10,0.7)]")} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => onChange(qty - 1)} aria-label={`One less ${name}`} className={cn(h, "grid aspect-square place-items-center rounded-full transition hover:bg-white/10")}>{qty === 1 ? <Trash2 className="size-3.5" /> : <Minus className="size-4" />}</button>
          <span key={qty} className="w-5 text-center text-sm font-bold tabular-nums motion-safe:animate-[vlh-pop_0.3s_ease-out]">{qty}</span>
          <button type="button" disabled={qty >= 20} onClick={() => onChange(qty + 1)} aria-label={`One more ${name}`} className={cn(h, "grid aspect-square place-items-center rounded-full text-gold transition hover:bg-white/10 disabled:opacity-40")}><Plus className="size-4" strokeWidth={2.5} /></button>
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** The bar at the bottom once something is in the order. */
export function BasketPill({ order, onOpen }: { order: MenuOrder; onOpen: () => void }) {
  return (
    <AnimatePresence>
      {order.count > 0 && (
        <motion.div initial={{ y: 90, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 90, opacity: 0 }} transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="fixed inset-x-0 bottom-0 z-40 px-3 pb-[calc(0.85rem+env(safe-area-inset-bottom))]">
          <button type="button" onClick={onOpen}
            className="mx-auto flex h-16 w-full max-w-xl items-center gap-3 rounded-full bg-[#15120e] py-2 pl-2 pr-5 text-white shadow-[0_24px_60px_-18px_rgba(0,0,0,0.85)] ring-1 ring-gold/40 transition hover:ring-gold">
            <span className="relative grid size-12 shrink-0 place-items-center rounded-full bg-gold text-[#1a140c]">
              <ShoppingBag className="size-5" />
              <span key={order.count} className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-white text-[10px] font-bold text-[#1a140c] motion-safe:animate-[vlh-pop_0.3s_ease-out]">{order.count}</span>
            </span>
            <span className="min-w-0 flex-1 text-left leading-tight">
              <span className="block text-[15px] font-semibold">View your order</span>
              <span className="block truncate text-xs text-white/60">{order.count} item{order.count === 1 ? "" : "s"}<span className="hidden sm:inline"> · send it to the kitchen</span></span>
            </span>
            <span className="text-base font-semibold tabular-nums text-gold">TZS {n(order.subtotal)}</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Sending the order from the website — the same order as from a table or the menu QR: the
 * lines (change anything), how you want it, who you are (a returning customer is found by
 * phone), a note, and send. It goes straight to the restaurant portal; you follow it next.
 */
export function OrderDrawer({ open, order, onClose, payTo }: { open: boolean; order: MenuOrder; onClose: () => void; payTo: PayOption[] }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const who = order.who;
  const [kind, setKind] = useState<Kind>("DINE_IN");
  const [table, setTable] = useState("");
  const [addressIn, setAddress] = useState<string | null>(null);
  const address = addressIn ?? who?.address ?? "";
  const takeOut = kind === "TAKEAWAY";
  const addressOk = address.trim().length >= 5;
  const [pay, setPay] = useState<PayFirstValue>(NO_PAYMENT);
  const [payNowIn, setPayNow] = useState(false);
  const payNow = takeOut || payNowIn;
  const [notes, setNotes] = useState("");
  const [trap, setTrap] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [key, setKey] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  useEffect(() => { if (open && order.count === 0) onClose(); }, [open, order.count, onClose]);

  const submit = () => start(async () => {
    setError(null);
    if (!who) { order.askWho(); return; }
    if (takeOut && !addressOk) { setError("Please add the delivery address."); return; }
    if (payNow && !payFirstReady(pay)) { setError("Pay first — choose the account, add the screenshot and tick “I have paid”."); return; }
    const clientKey = key ?? (() => { const b = crypto.getRandomValues(new Uint8Array(16)); return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""); })();
    setKey(clientKey);
    const res = await placeOnlineOrderAction({
      clientKey, items: order.lines.map((l) => ({ menuItemId: l.id, quantity: l.qty })), notes: notes.trim() || undefined,
      ...whoForOrder(who), kind, tableLabel: takeOut ? undefined : table, deliveryAddress: takeOut ? address.trim() : undefined,
      paidFirst: payNow ? { proofId: pay.proofId!, accountId: pay.accountId!, reference: pay.reference.trim() || undefined, expectedTotal: order.subtotal } : undefined, website: trap,
    });
    if (!res.ok) { setError(res.error); return; }
    if (takeOut) rememberAddress(address);
    order.clear(); setKey(null);
    router.push(`/order/${res.data.track}?new=1`);
  });

  return (
    <dialog ref={ref} aria-labelledby="order-title" onClose={onClose} onClick={(e) => { if (e.target === e.currentTarget && !pending) ref.current?.close(); }}
      className="m-auto w-full max-w-[36rem] overflow-hidden border-0 bg-panel p-0 text-tone shadow-2xl backdrop:bg-[#0d0b08]/70 backdrop:backdrop-blur-sm max-sm:mb-0 max-sm:mt-auto max-sm:max-w-none max-sm:rounded-t-[2rem] sm:rounded-[2rem] open:animate-in open:fade-in-0 max-sm:open:slide-in-from-bottom-10 sm:open:zoom-in-95 motion-reduce:open:animate-none">
      <div className="flex max-h-[92dvh] flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-tone/10 px-6 py-5">
          <div>
            <p className={cn(eyebrow, goldText)}>Restaurant & bar</p>
            <h2 id="order-title" className={cn("mt-1", type.h3)}>Your order</h2>
          </div>
          <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className="grid size-10 place-items-center rounded-full bg-paper-deep transition hover:bg-tone hover:text-paper"><X className="size-5" /></button>
        </header>

        <div className="space-y-6 overflow-y-auto overscroll-contain px-6 py-5">
          {/* What they ordered */}
          <ul className="divide-y divide-tone/10 rounded-2xl border border-tone/10">
            {order.lines.map((l) => (
              <li key={l.id} className="flex items-center gap-3 px-3 py-2.5">
                {l.image
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={l.image} alt="" className="size-12 shrink-0 rounded-xl object-cover" />
                  : <span className="grid size-12 shrink-0 place-items-center rounded-xl bg-paper-deep"><UtensilsCrossed className="size-4 text-tone/40" /></span>}
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="line-clamp-2 font-display text-lg leading-tight">{l.name}</span>
                  <span className="text-xs tabular-nums text-tone/55">TZS {n(l.price)} each · TZS {n(l.price * l.qty)}</span>
                </span>
                <AddControl qty={l.qty} name={l.name} size="sm" onChange={(q) => order.setQty(l.id, q)} />
              </li>
            ))}
            <li className="flex items-baseline justify-between px-4 py-3.5">
              <span className="text-[11px] font-semibold uppercase tracking-[0.2em]">Total</span>
              <span className="text-xl font-semibold tabular-nums">TZS {n(order.subtotal)}</span>
            </li>
          </ul>

          {/* Who — given before the first item went in */}
          <div>
            <p className={fieldLabel}>Ordering as</p>
            {who ? (
              <div className="flex items-center gap-3 rounded-2xl border border-tone/10 p-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-tone font-display text-lg text-gold">{who.name.charAt(0).toUpperCase()}</span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate font-semibold">{who.name}</span>
                  <span className="text-sm tabular-nums text-tone/60">{phoneLabel(who.phone)}</span>
                </span>
                <button type="button" onClick={order.askWho} className="rounded-full border border-tone/15 px-3.5 py-1.5 text-sm font-medium transition hover:border-tone/40">Change</button>
              </div>
            ) : (
              <button type="button" onClick={order.askWho} className="flex w-full items-center gap-3 rounded-2xl bg-paper-deep p-3 text-left">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-tone text-gold"><UserRound className="size-5" /></span>
                <span className="font-semibold">Add your name and number</span>
              </button>
            )}
            <input value={trap} onChange={(e) => setTrap(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden className="hidden" name="website" />
          </div>

          {/* How */}
          <div>
            <p className={fieldLabel}>How would you like it?</p>
            <div className="grid grid-cols-2 gap-2">
              {KINDS.map((k) => (
                <button key={k.v} type="button" onClick={() => setKind(k.v)} aria-pressed={kind === k.v}
                  className={cn("flex flex-col items-start gap-1.5 rounded-2xl border p-3 text-left transition", kind === k.v ? "border-tone bg-tone text-paper" : "border-tone/15 hover:border-tone/40")}>
                  <k.icon className={cn("size-5", kind === k.v ? "text-gold" : "text-accent-ink")} />
                  <span className="text-sm font-semibold leading-tight">{k.label}</span>
                  <span className={cn("text-[11px] leading-tight", kind === k.v ? "text-paper/70" : "text-tone/55")}>{k.hint}</span>
                </button>
              ))}
            </div>
            {takeOut ? (
              <label className="mt-3 block"><span className={cn(fieldLabel, "flex items-center gap-1.5")}><MapPin className="size-3.5" />Delivery address</span>
                <textarea value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} rows={2} autoComplete="street-address"
                  placeholder="e.g. Mikocheni B, Plot 45, near the pharmacy" className={cn(fieldTextarea, "min-h-20")} />
                <span className="mt-1.5 block text-xs text-tone/55">Street, house or building, and a landmark — we bring your order here.</span></label>
            ) : (
              <>
                <div className="mt-3 grid grid-cols-2 gap-2">
                  {([[false, "Pay after", "When you are done"], [true, "Pay now", "Mobile money or bank"]] as const).map(([v, l, h]) => (
                    <button key={String(v)} type="button" onClick={() => setPayNow(v)} aria-pressed={payNowIn === v}
                      className={cn("rounded-2xl border px-3 py-2.5 text-left transition", payNowIn === v ? "border-tone bg-tone text-paper" : "border-tone/15 hover:border-tone/40")}>
                      <span className="block text-sm font-semibold leading-tight">{l}</span>
                      <span className={cn("text-[11px]", payNowIn === v ? "text-paper/70" : "text-tone/55")}>{h}</span>
                    </button>
                  ))}
                </div>
                <label className="mt-3 block"><span className={fieldLabel}>Table <span className="normal-case tracking-normal text-tone/45">(optional)</span></span>
                  <input value={table} onChange={(e) => setTable(e.target.value)} placeholder="e.g. Table 3 outside" className={fieldInput} /></label>
              </>
            )}
          </div>

          {payNow && <div className="vr"><PayFirst total={order.subtotal} accounts={payTo} value={pay} onChange={setPay} /></div>}

          <label className="block"><span className={fieldLabel}>Anything we should know? <span className="normal-case tracking-normal text-tone/45">(optional)</span></span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} rows={2} placeholder="No onions, extra ice, bring it at 8 pm…" className={cn(fieldTextarea, "min-h-20")} /></label>

          <div className="space-y-2 text-sm text-tone/70">
            <p className="flex items-start gap-2.5"><CreditCard className="mt-0.5 size-4 shrink-0 text-accent-ink" />{takeOut ? "Paid first — your order starts right away and we bring it to you. If the payment does not reach us, we call you." : payNow ? "Paid now — your order starts right away. If the payment does not reach us, we call you." : "Pay after your meal — cash, card or mobile money. Order more any time."}</p>
            <p className="flex items-start gap-2.5"><BedDouble className="mt-0.5 size-4 shrink-0 text-accent-ink" />Staying with us? Scan the QR card in your room to order to your room bill.</p>
          </div>
          {error && <p role="alert" className="rounded-xl bg-red-700/10 px-4 py-3 text-sm text-red-800 dark:text-red-300">{error} Your order was not sent — please try again.</p>}
        </div>

        <footer className="border-t border-tone/10 px-6 py-4">
          <button type="button" disabled={pending || order.count === 0 || !who || (takeOut && !addressOk) || (payNow && !payFirstReady(pay))} onClick={submit} className={cn(pillGold, "h-14 w-full text-[15px] font-semibold")}>
            {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-5" />}Send my order · TZS {n(order.subtotal)}
          </button>
          <p className="mt-2 text-center text-xs text-tone/55">It goes straight to our kitchen and bar — you can follow it on the next page.</p>
        </footer>
      </div>
    </dialog>
  );
}

/**
 * Before the first item goes in the order: who is ordering. The phone first — someone we know
 * is greeted by name and continues; someone new adds their name. Then the item goes in.
 */
export function WhoDialog({ order }: { order: MenuOrder }) {
  const ref = useRef<HTMLDialogElement>(null);
  const open = order.asking;
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (open && !d.open) d.showModal();
    if (!open && d.open) d.close();
  }, [open]);
  return (
    <dialog ref={ref} aria-labelledby="who-title" onClose={order.cancelWho} onClick={(e) => { if (e.target === e.currentTarget) ref.current?.close(); }}
      className="m-auto w-full max-w-[30rem] overflow-hidden border-0 bg-panel p-0 text-tone shadow-2xl backdrop:bg-[#0d0b08]/70 backdrop:backdrop-blur-sm max-sm:mb-0 max-sm:mt-auto max-sm:max-w-none max-sm:rounded-t-[2rem] sm:rounded-[2rem] open:animate-in open:fade-in-0 max-sm:open:slide-in-from-bottom-10 sm:open:zoom-in-95 motion-reduce:open:animate-none">
      {open && <WhoForm order={order} onClose={() => ref.current?.close()} />}
    </dialog>
  );
}

function WhoForm({ order, onClose }: { order: MenuOrder; onClose: () => void }) {
  const lookup = useCallback(async (phone: string) => {
    const res = await identifyCustomerAction({ phone });
    return res.ok ? res.data.name : null;
  }, []);
  const f = useWhoForm(order.who, lookup);
  const item = order.askingFor;
  return (
    <form className="max-h-[92dvh] overflow-y-auto px-6 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-6 sm:px-8 sm:pb-8" onSubmit={(e) => { e.preventDefault(); if (f.result) order.confirmWho(f.result); }}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={cn(eyebrow, goldText)}>Restaurant & bar</p>
          <h2 id="who-title" className={cn("mt-1", type.h3)}>Who is ordering?</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className="grid size-10 shrink-0 place-items-center rounded-full bg-paper-deep transition hover:bg-tone hover:text-paper"><X className="size-5" /></button>
      </div>
      <p className="mt-2 text-sm text-tone/65">Your number and name — so we know whose order it is, and can tell you when it is ready.</p>

      <label className="mt-6 block"><span className={fieldLabel}>Phone (WhatsApp)</span>
        <span className="relative block">
          <Phone className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-tone/45" />
          <input value={f.phone} onChange={(e) => f.setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" autoFocus className={cn(fieldInput, "pl-11 pr-11 tabular-nums")} />
          <span className="absolute right-4 top-1/2 -translate-y-1/2">
            {f.step === "checking" ? <Loader2 className="size-4 animate-spin text-tone/50" />
              : f.step === "known" || f.step === "new" ? <span className="grid size-5 place-items-center rounded-full bg-emerald-600 text-white"><Check className="size-3" strokeWidth={3} /></span> : null}
          </span>
        </span>
      </label>

      {f.step === "known" && (
        <div className="mt-3 flex items-center gap-3 rounded-2xl bg-paper-deep p-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-tone font-display text-lg text-gold">{f.knownName!.charAt(0).toUpperCase()}</span>
          <span className="min-w-0 flex-1 leading-tight"><span className="block text-sm text-tone/60">Welcome back</span><span className="block truncate font-semibold">{f.knownName}</span></span>
          <button type="button" onClick={f.notMe} className="shrink-0 text-sm font-medium underline underline-offset-2">Not you?</button>
        </div>
      )}
      {f.step === "new" && (
        <label className="mt-4 block"><span className={fieldLabel}>Your name</span>
          <input value={f.name} onChange={(e) => f.setName(e.target.value)} autoComplete="name" autoCapitalize="words" placeholder="e.g. Asha" autoFocus maxLength={80} className={fieldInput} /></label>
      )}

      {item && (
        <p className="mt-5 flex items-center gap-3 text-sm text-tone/65">
          {item.image
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={item.image} alt="" className="size-10 shrink-0 rounded-lg object-cover" />
            : <span className="grid size-10 shrink-0 place-items-center rounded-lg bg-paper-deep"><UtensilsCrossed className="size-4 text-tone/40" /></span>}
          <span>Then <strong className="font-semibold text-tone">{item.name}</strong> goes in your order.</span>
        </p>
      )}
      <button type="submit" disabled={!f.result} className={cn(pillGold, "mt-5 h-13 w-full text-[15px] font-semibold disabled:opacity-50")}>
        {f.step === "checking" ? <><Loader2 className="size-4 animate-spin" />Checking…</> : <>Continue<ArrowRight className="size-4" /></>}
      </button>
      <p className="mt-2.5 text-center text-xs text-tone/55">Asked once on this device · used only for your orders and bill</p>
    </form>
  );
}
