"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, BedDouble, Check, Loader2, Lock, MapPin, Minus, Phone, Plus, ShoppingBag, Smartphone, Trash2, UserRound, UtensilsCrossed, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { identifyCustomerAction, placeOnlineOrderAction } from "@/app/order/actions";
import { phoneLabel, rememberAddress, useWho, useWhoForm, whoForOrder, type Who } from "@/components/restaurant/who";
import { NetworkMarks } from "@/components/payments/networks";
import { buttonClass } from "./kit/button";
import { field, typeScale } from "./kit/tokens";

const n = (v: number) => v.toLocaleString("en-US");
/** A Tanzanian mobile-money number (0712 345 678, +255 712 345 678…) — the server checks it again. */
const payPhoneOk = (p: string) => /^(?:\+?255|0)?[67]\d{8}$/.test(p.replace(/[\s-]/g, ""));

/**
 * The menu's sheets (a dish, your order, who is ordering): a bottom sheet on phones, a centred
 * card from 640px, on the page's paper tone (white in the light theme, warm dark in the dark one).
 * Put data-tone="paper" on the dialog with it.
 */
export const SHEET =
  "m-auto w-full overflow-hidden border-0 bg-pub-raised p-0 text-pub-fg shadow-[0_40px_120px_-30px_rgb(0_0_0/0.75)] backdrop:bg-[#0b0906]/75 backdrop:backdrop-blur-[3px] " +
  "max-sm:mb-0 max-sm:mt-auto max-sm:max-w-none max-sm:rounded-t-[1.25rem] sm:rounded-[1.25rem] " +
  "open:animate-in open:fade-in-0 max-sm:open:slide-in-from-bottom-10 sm:open:zoom-in-95 motion-reduce:open:animate-none";

/** The round close button of a sheet. */
export const SHEET_CLOSE =
  "grid size-11 shrink-0 place-items-center rounded-full border border-pub-line text-pub-fg transition-colors duration-200 hover:border-pub-fg/50 hover:bg-pub-fg/[0.04] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none";

/** A line in the order: one menu item (one size of a drink), as the menu shows it. */
export type OrderLine = { id: string; name: string; price: number; qty: number; image: string | null };
/** Eat here, or take out — brought to the address the customer gives. */
type Kind = "DINE_IN" | "TAKEAWAY";
const KINDS: { v: Kind; label: string; hint: string; icon: typeof UtensilsCrossed }[] = [
  { v: "DINE_IN", label: "Eat here", hint: "At the restaurant or bar", icon: UtensilsCrossed },
  { v: "TAKEAWAY", label: "Take out", hint: "We deliver it to you", icon: ShoppingBag },
];

/** One side of a two-way choice (Eat here / Take out, Pay after / Pay now): a hairline tile, gold when chosen. */
const choice = (on: boolean) =>
  cn(
    "relative flex min-h-[4.25rem] flex-col items-start justify-center gap-1 rounded-[0.75rem] border px-3.5 py-3 text-left transition-[border-color,background-color,box-shadow] duration-200 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none",
    on ? "border-gold bg-gold/[0.08] shadow-[inset_0_0_0_1px_var(--gold)]" : "border-pub-line hover:border-pub-fg/40",
  );

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

/** "+ Add" — then "− 2 +" once it is in the order. A quiet outline (gold on hover), never a column of gold pills. */
export function AddControl({ qty, name, onChange, size = "md", disabled }: { qty: number; name: string; onChange: (qty: number) => void; size?: "sm" | "md"; disabled?: boolean }) {
  const h = size === "sm" ? "h-10" : "h-11";
  if (disabled) return <span className={cn(typeScale.meta, "shrink-0 px-1 text-pub-muted")}>Not today</span>;
  return (
    <AnimatePresence mode="popLayout" initial={false}>
      {qty === 0 ? (
        <motion.button key="add" type="button" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }} whileTap={{ scale: 0.94 }}
          onClick={(e) => { e.stopPropagation(); onChange(1); }} aria-label={`Add ${name}`}
          className={cn(h, typeScale.cta, size === "sm" ? "px-4" : "px-5",
            "inline-flex shrink-0 items-center gap-1.5 rounded-full border border-pub-fg/25 text-pub-fg transition-colors duration-200 hover:border-gold hover:bg-gold/10 hover:text-pub-eyebrow focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none")}>
          <Plus className="size-3.5" strokeWidth={2.25} aria-hidden="true" />Add
        </motion.button>
      ) : (
        <motion.span key="qty" initial={{ opacity: 0, scale: 0.85 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0.85 }}
          className={cn(h, "inline-flex shrink-0 items-center rounded-full bg-pub-fg text-[var(--pub-surface)] shadow-[0_10px_24px_-14px_rgb(0_0_0/0.7)]")} onClick={(e) => e.stopPropagation()}>
          <button type="button" onClick={() => onChange(qty - 1)} aria-label={`One less ${name}`} className={cn(h, "grid aspect-square place-items-center rounded-full transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold")}>{qty === 1 ? <Trash2 className="size-3.5" aria-hidden="true" /> : <Minus className="size-4" aria-hidden="true" />}</button>
          <span key={qty} className="w-5 text-center font-display text-[1.0625rem] font-semibold tabular-nums lining-nums motion-safe:animate-[vlh-pop_0.3s_ease-out]">{qty}</span>
          <button type="button" disabled={qty >= 20} onClick={() => onChange(qty + 1)} aria-label={`One more ${name}`} className={cn(h, "grid aspect-square place-items-center rounded-full text-gold transition-colors hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold disabled:opacity-40")}><Plus className="size-4" strokeWidth={2.25} aria-hidden="true" /></button>
        </motion.span>
      )}
    </AnimatePresence>
  );
}

/** The bar at the bottom once something is in the order — the page's own bottom bar (the footer keeps room for it). */
export function BasketPill({ order, onOpen }: { order: MenuOrder; onOpen: () => void }) {
  return (
    <AnimatePresence>
      {order.count > 0 && (
        <motion.div initial={{ y: 90, opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: 90, opacity: 0 }} transition={{ type: "spring", stiffness: 320, damping: 30 }}
          data-pub-bottom-bar="" className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))]">
          <button type="button" onClick={onOpen}
            className="mx-auto flex h-14 w-full max-w-md items-center gap-3 rounded-full border border-gold/35 bg-[#0f0c09]/95 py-1.5 pl-1.5 pr-5 text-[#f3ece0] shadow-[0_24px_60px_-18px_rgb(0_0_0/0.85)] backdrop-blur-md transition-[border-color,box-shadow] duration-300 hover:border-gold/70 hover:shadow-[0_24px_60px_-18px_rgb(0_0_0/0.85),0_0_32px_-8px_oklch(0.72_0.12_80/0.45)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none">
            <span className="relative grid size-11 shrink-0 place-items-center rounded-full border border-gold/50 text-gold">
              <ShoppingBag className="size-[1.125rem]" strokeWidth={1.8} aria-hidden="true" />
              <span key={order.count} className="absolute -right-1 -top-1 grid size-5 place-items-center rounded-full bg-[#f3ece0] text-[10px] font-bold text-[#16110a] ring-2 ring-[#0f0c09] motion-safe:animate-[vlh-pop_0.3s_ease-out]">{order.count}</span>
            </span>
            <span className="min-w-0 flex-1 text-left leading-tight">
              <span className={cn(typeScale.cta, "block")}>View your order</span>
              <span className="mt-1 block truncate text-xs text-white/60">{order.count} item{order.count === 1 ? "" : "s"}<span className="hidden sm:inline"> · send it to the kitchen</span></span>
            </span>
            <span className="whitespace-nowrap font-display text-[1.125rem] font-medium tabular-nums lining-nums text-gold"><span className="mr-1 font-sans text-[11px] font-medium tracking-[0.16em] text-gold/80">TZS</span>{n(order.subtotal)}</span>
          </button>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/**
 * Sending the order from the website — the same order as from a table or the menu QR: the
 * lines (change anything), how you want it, who you are (a returning customer is found by
 * phone), how to pay, a note, and send. Paying now is ONLY mobile money through nTZS (owner,
 * 2026-10-05: "any online payment is nTZS, nothing more") — first and pre-selected; the prompt
 * comes to their phone and the payment page follows. Take out is always paid first, so with
 * mobile money off it cannot be ordered here. Never account numbers or screenshots.
 */
export function OrderDrawer({ open, order, onClose, online }: { open: boolean; order: MenuOrder; onClose: () => void; online: boolean }) {
  const ref = useRef<HTMLDialogElement>(null);
  const router = useRouter();
  const who = order.who;
  const [kind, setKind] = useState<Kind>("DINE_IN");
  const [table, setTable] = useState("");
  const [addressIn, setAddress] = useState<string | null>(null);
  const address = addressIn ?? who?.address ?? "";
  const takeOut = kind === "TAKEAWAY";
  const addressOk = address.trim().length >= 5;
  // Pay now first (mobile money); paying after is one tap away. The number starts as theirs.
  const [payNowIn, setPayNow] = useState(online);
  const payNow = takeOut || (online && payNowIn);
  const [payPhoneIn, setPayPhone] = useState<string | null>(null);
  const payPhone = payPhoneIn ?? who?.phone ?? "";
  const payReady = !payNow || (online && payPhoneOk(payPhone));
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
    if (!payReady) { setError(online ? "Enter your mobile-money number to pay now, e.g. 0712 345 678." : "Take out is paid first by mobile money, which is not available right now — choose Eat here, or call us."); return; }
    const clientKey = key ?? (() => { const b = crypto.getRandomValues(new Uint8Array(16)); return Array.from(b, (x) => x.toString(16).padStart(2, "0")).join(""); })();
    setKey(clientKey);
    const res = await placeOnlineOrderAction({
      clientKey, items: order.lines.map((l) => ({ menuItemId: l.id, quantity: l.qty })), notes: notes.trim() || undefined,
      ...whoForOrder(who), kind, tableLabel: takeOut ? undefined : table, deliveryAddress: takeOut ? address.trim() : undefined,
      payOnline: payNow ? { phone: payPhone.trim() } : undefined, website: trap,
    });
    if (!res.ok) { setError(res.error); return; }
    if (takeOut) rememberAddress(address);
    order.clear(); setKey(null);
    // Paying now: the payment page (waiting for the prompt → paid). Otherwise the order's own page.
    router.push(res.data.pay ? `/pay/${res.data.pay}` : `/order/${res.data.track}?new=1${res.data.payError ? "&pay=0" : ""}`);
  });

  return (
    <dialog ref={ref} aria-labelledby="order-title" data-tone="paper" onClose={onClose} onClick={(e) => { if (e.target === e.currentTarget && !pending) ref.current?.close(); }}
      className={cn(SHEET, "max-w-[36rem]")}>
      <div className="flex max-h-[92dvh] flex-col">
        <header className="flex items-center justify-between gap-3 border-b border-pub-line px-5 py-4 sm:px-7 sm:py-5">
          <div className="min-w-0">
            <p className={cn(typeScale.eyebrow, "text-pub-eyebrow")}>Restaurant & bar</p>
            <h2 id="order-title" className="mt-2 font-display text-[1.75rem] font-medium leading-none">Your order</h2>
          </div>
          <button type="button" onClick={() => ref.current?.close()} aria-label="Close" className={SHEET_CLOSE}><X className="size-5" strokeWidth={1.6} aria-hidden="true" /></button>
        </header>

        <div className="space-y-7 overflow-y-auto overscroll-contain px-5 py-5 sm:px-7 sm:py-6">
          {/* What they ordered */}
          <div>
            <ul className="border-t border-pub-line">
              {order.lines.map((l) => (
                <li key={l.id} className="flex items-center gap-3.5 border-b border-pub-line py-3">
                  {l.image
                    // eslint-disable-next-line @next/next/no-img-element
                    ? <img src={l.image} alt="" className="size-12 shrink-0 rounded-[0.375rem] object-cover" />
                    : <span className="grid size-12 shrink-0 place-items-center rounded-[0.375rem] bg-pub-fg/[0.05]"><UtensilsCrossed className="size-4 text-pub-faint" aria-hidden="true" /></span>}
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="line-clamp-2 font-display text-[1.125rem] leading-tight">{l.name}</span>
                    <span className="mt-0.5 block text-xs tabular-nums text-pub-muted">TZS {n(l.price)} each · TZS {n(l.price * l.qty)}</span>
                  </span>
                  <AddControl qty={l.qty} name={l.name} size="sm" onChange={(q) => order.setQty(l.id, q)} />
                </li>
              ))}
            </ul>
            <p className="flex items-baseline justify-between pt-4">
              <span className={cn(typeScale.meta, "text-pub-muted")}>Total</span>
              <span className="font-display text-[1.625rem] font-medium leading-none tabular-nums lining-nums"><span className="mr-1.5 font-sans text-[11px] font-medium tracking-[0.16em] text-pub-muted">TZS</span>{n(order.subtotal)}</span>
            </p>
          </div>

          {/* Who — given before the first item went in */}
          <div>
            <p className={field.label}>Ordering as</p>
            {who ? (
              <div className="flex items-center gap-3 rounded-[0.75rem] border border-pub-line p-3">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#15120e] font-display text-lg text-gold">{who.name.charAt(0).toUpperCase()}</span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block truncate font-medium">{who.name}</span>
                  <span className="text-sm tabular-nums text-pub-muted">{phoneLabel(who.phone)}</span>
                </span>
                <button type="button" onClick={order.askWho} className={buttonClass({ variant: "secondary", size: "sm", className: "px-4" })}>Change</button>
              </div>
            ) : (
              <button type="button" onClick={order.askWho} className="flex w-full items-center gap-3 rounded-[0.75rem] border border-dashed border-pub-fg/30 p-3 text-left transition-colors duration-200 hover:border-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none">
                <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#15120e] text-gold"><UserRound className="size-5" strokeWidth={1.6} aria-hidden="true" /></span>
                <span className="font-medium">Add your name and number</span>
              </button>
            )}
            <input value={trap} onChange={(e) => setTrap(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden className="hidden" name="website" />
          </div>

          {/* How */}
          <div>
            <p className={field.label}>How would you like it?</p>
            <div className="grid grid-cols-2 gap-2.5">
              {KINDS.map((k) => (
                <button key={k.v} type="button" onClick={() => setKind(k.v)} aria-pressed={kind === k.v} className={choice(kind === k.v)}>
                  <span className="flex items-center gap-2">
                    <k.icon className={cn("size-4", kind === k.v ? "text-pub-eyebrow" : "text-pub-muted")} strokeWidth={1.7} aria-hidden="true" />
                    <span className="text-[15px] font-medium leading-tight">{k.label}</span>
                  </span>
                  <span className="text-xs leading-tight text-pub-muted">{k.hint}</span>
                  {kind === k.v && <Check className="absolute right-3 top-3 size-3.5 text-pub-eyebrow" strokeWidth={2.5} aria-hidden="true" />}
                </button>
              ))}
            </div>
            {takeOut ? (
              <label className="mt-4 block"><span className={cn(field.label, "flex items-center gap-1.5")}><MapPin className="size-3.5" aria-hidden="true" />Delivery address</span>
                <textarea value={address} onChange={(e) => setAddress(e.target.value)} maxLength={200} rows={2} autoComplete="street-address"
                  placeholder="e.g. Mikocheni B, Plot 45, near the pharmacy" className={cn(field.textarea, "min-h-20")} />
                <span className={cn(field.hint, "block")}>Street, house or building, and a landmark — we bring your order here.</span></label>
            ) : (
              <label className="mt-4 block"><span className={field.label}>Table <span className="normal-case tracking-normal text-pub-muted">(optional)</span></span>
                <input value={table} onChange={(e) => setTable(e.target.value)} placeholder="e.g. Table 3 outside" className={field.input} /></label>
            )}
          </div>

          {/* How to pay — Pay now (mobile money) first; take out has only Pay now. */}
          {online ? (
            <div>
              <p className={field.label}>Payment</p>
              <div className={cn("grid gap-2.5", !takeOut && "grid-cols-2")}>
                {([[true, "Pay now", null], ...(takeOut ? [] : [[false, "Pay after", "When you are done"]])] as [boolean, string, string | null][]).map(([v, l, h]) => {
                  const on = v ? payNow : !payNow;
                  return (
                    <button key={String(v)} type="button" onClick={() => setPayNow(v)} aria-pressed={on} className={choice(on)}>
                      <span className="flex items-center gap-2">
                        {v && <Smartphone className={cn("size-4", on ? "text-pub-eyebrow" : "text-pub-muted")} strokeWidth={1.7} aria-hidden="true" />}
                        <span className="text-[15px] font-medium leading-tight">{l}</span>
                      </span>
                      {h ? <span className="text-xs leading-tight text-pub-muted">{h}</span> : <NetworkMarks label={null} compact className="w-full max-w-[11rem]" />}
                      {on && <Check className="absolute right-3 top-3 size-3.5 text-pub-eyebrow" strokeWidth={2.5} aria-hidden="true" />}
                    </button>
                  );
                })}
              </div>
              {payNow && (
                <label className="mt-4 block"><span className={field.label}>Mobile-money number</span>
                  <input value={payPhone} onChange={(e) => setPayPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678"
                    aria-invalid={payPhone !== "" && !payPhoneOk(payPhone)} className={cn(field.input, "tabular-nums")} />
                  <span className={cn(field.hint, "flex items-start gap-1.5")}><Lock className="mt-0.5 size-3 shrink-0 text-pub-eyebrow" aria-hidden="true" /><span>A payment request comes to this phone — enter your PIN. Secure payment by <span className="font-semibold tracking-wide text-pub-fg">NTZS</span></span></span>
                </label>
              )}
            </div>
          ) : takeOut ? (
            <p role="note" className="rounded-[0.75rem] border border-gold/40 bg-gold/[0.08] px-4 py-3 text-sm leading-relaxed">Take out is paid first by mobile money, which is not available right now — choose Eat here, or call us.</p>
          ) : null}

          <label className="block"><span className={field.label}>Anything we should know? <span className="normal-case tracking-normal text-pub-muted">(optional)</span></span>
            <textarea value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} rows={2} placeholder="No onions, extra ice, bring it at 8 pm…" className={cn(field.textarea, "min-h-20")} /></label>

          <div className="space-y-2.5 border-t border-pub-line pt-5 text-sm leading-relaxed text-pub-muted">
            <p className="flex items-start gap-3"><Smartphone className="mt-0.5 size-4 shrink-0 text-pub-eyebrow" strokeWidth={1.6} aria-hidden="true" />{takeOut ? "Paid first by mobile money — once it is paid, your order starts and we bring it to you." : payNow ? "Paid now by mobile money — your order starts as soon as it is paid." : "Pay after your meal. Order more any time."}</p>
            <p className="flex items-start gap-3"><BedDouble className="mt-0.5 size-4 shrink-0 text-pub-eyebrow" strokeWidth={1.6} aria-hidden="true" />Staying with us? Scan the QR card in your room to order to your room bill.</p>
          </div>
          {error && <p role="alert" className="rounded-[0.75rem] border border-pub-error/30 bg-pub-error/[0.08] px-4 py-3 text-sm text-pub-error">{error} Your order was not sent — please try again.</p>}
        </div>

        <footer className="border-t border-pub-line px-5 pb-[max(1rem,env(safe-area-inset-bottom))] pt-4 sm:px-7">
          <button type="button" disabled={pending || order.count === 0 || !who || (takeOut && !addressOk) || !payReady} onClick={submit}
            className={buttonClass({ variant: "primary", full: true, className: "h-auto min-h-10 whitespace-normal px-5 py-2.5 text-center leading-snug tabular-nums" })}>
            {pending ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : payNow ? <Lock className="size-4" strokeWidth={2} aria-hidden="true" /> : <Check className="size-4" strokeWidth={2.25} aria-hidden="true" />}{payNow ? `Pay TZS ${n(order.subtotal)} now` : `Send my order · TZS ${n(order.subtotal)}`}
          </button>
          <p className="mt-2.5 text-center text-xs text-pub-muted">{payNow ? "Check your phone for the payment request — then follow your order on the next page." : "It goes straight to our kitchen and bar — you can follow it on the next page."}</p>
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
    <dialog ref={ref} aria-labelledby="who-title" data-tone="paper" onClose={order.cancelWho} onClick={(e) => { if (e.target === e.currentTarget) ref.current?.close(); }}
      className={cn(SHEET, "max-w-[30rem]")}>
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
    <form className="max-h-[92dvh] overflow-y-auto px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-5 sm:px-8 sm:pb-8 sm:pt-7" onSubmit={(e) => { e.preventDefault(); if (f.result) order.confirmWho(f.result); }}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className={cn(typeScale.eyebrow, "text-pub-eyebrow")}>Restaurant & bar</p>
          <h2 id="who-title" className="mt-2 font-display text-[1.75rem] font-medium leading-none">Who is ordering?</h2>
        </div>
        <button type="button" onClick={onClose} aria-label="Close" className={SHEET_CLOSE}><X className="size-5" strokeWidth={1.6} aria-hidden="true" /></button>
      </div>
      <p className="mt-3 text-sm leading-relaxed text-pub-muted">Your number and name — so we know whose order it is, and can tell you when it is ready.</p>

      <label className="mt-6 block"><span className={field.label}>Phone (WhatsApp)</span>
        <span className="relative block">
          <Phone className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-pub-faint" aria-hidden="true" />
          <input value={f.phone} onChange={(e) => f.setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" autoFocus className={cn(field.input, "pl-11 pr-11 tabular-nums")} />
          <span className="absolute right-4 top-1/2 -translate-y-1/2">
            {f.step === "checking" ? <Loader2 className="size-4 animate-spin text-pub-faint" aria-hidden="true" />
              : f.step === "known" || f.step === "new" ? <span className="grid size-5 place-items-center rounded-full bg-gold text-[#16110a]"><Check className="size-3" strokeWidth={3} aria-hidden="true" /></span> : null}
          </span>
        </span>
      </label>

      {f.step === "known" && (
        <div className="mt-3 flex items-center gap-3 rounded-[0.75rem] border border-pub-line bg-pub-fg/[0.03] p-3">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[#15120e] font-display text-lg text-gold">{f.knownName!.charAt(0).toUpperCase()}</span>
          <span className="min-w-0 flex-1 leading-tight"><span className="block text-sm text-pub-muted">Welcome back</span><span className="block truncate font-medium">{f.knownName}</span></span>
          <button type="button" onClick={f.notMe} className="min-h-11 shrink-0 px-1 text-sm font-medium underline decoration-pub-line underline-offset-4 hover:decoration-gold">Not you?</button>
        </div>
      )}
      {f.step === "new" && (
        <label className="mt-4 block"><span className={field.label}>Your name</span>
          <input value={f.name} onChange={(e) => f.setName(e.target.value)} autoComplete="name" autoCapitalize="words" placeholder="e.g. Asha" autoFocus maxLength={80} className={field.input} /></label>
      )}

      {item && (
        <p className="mt-5 flex items-center gap-3 text-sm text-pub-muted">
          {item.image
            // eslint-disable-next-line @next/next/no-img-element
            ? <img src={item.image} alt="" className="size-10 shrink-0 rounded-[0.375rem] object-cover" />
            : <span className="grid size-10 shrink-0 place-items-center rounded-[0.375rem] bg-pub-fg/[0.05]"><UtensilsCrossed className="size-4 text-pub-faint" aria-hidden="true" /></span>}
          <span>Then <strong className="font-medium text-pub-fg">{item.name}</strong> goes in your order.</span>
        </p>
      )}
      <button type="submit" disabled={!f.result} className={buttonClass({ variant: "primary", full: true, className: "mt-6" })}>
        {f.step === "checking" ? <><Loader2 className="size-4 animate-spin" aria-hidden="true" />Checking…</> : <>Continue<ArrowRight className="size-4" strokeWidth={1.8} aria-hidden="true" /></>}
      </button>
      <p className="mt-3 text-center text-xs text-pub-muted">Asked once on this device · used only for your orders and bill</p>
    </form>
  );
}
