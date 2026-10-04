"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BedDouble, Check, CreditCard, Loader2, MapPin, Plus, Receipt, ShieldCheck, ShoppingBag, Smartphone, UserRound, UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";
import { identifyAtTableAction, placeTableOrderAction } from "@/app/t/[token]/actions";
import { addItemsByTrackAction, placeOnlineOrderAction } from "@/app/order/actions";
import { placeRoomQrOrderAction } from "@/app/r/[token]/actions";
import { placeStayOrderAction } from "@/app/stay/[token]/actions";
import type { CartLine } from "./restaurant-app";
import { phoneLabel, rememberAddress, whoForOrder, type Who } from "./who";
import { NO_PAYMENT, PayFirst, payFirstReady, type PayFirstValue, type PayOption } from "./pay-first";

/**
 * How this place sends its order — the existing order actions. `online`: "Pay online" (nTZS) is offered here — then
 * paying now is online (the prompt on the customer's phone); otherwise paying now is with the proof of payment.
 */
export type CheckoutConfig =
  | { kind: "spot"; token: string; spot: "TABLE" | "COUNTER" | "MAIN"; payTo: PayOption[]; online?: boolean }
  | { kind: "public"; table: string | null; fromQr: boolean; payTo: PayOption[]; online?: boolean }
  | { kind: "room"; target: { kind: "stay" | "room"; token: string }; where: string; guest?: string; payTo?: PayOption[]; online?: boolean }
  | { kind: "more"; token: string; number: string };

const tzs = (v: number) => `TZS ${v.toLocaleString("en-US")}`;
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("");
const field = "mt-1 block h-11 w-full rounded-xl border border-(--vr-line) bg-white px-3.5 text-[16px] sm:text-[14px] outline-none transition placeholder:text-(--vr-muted)/70 focus:border-(--vr-gold) focus:ring-4 focus:ring-(--vr-gold)/15";
const label = "block text-[12.5px] font-medium text-(--vr-ink)/80";
const heading = "text-[11px] font-semibold uppercase tracking-[0.16em] text-(--vr-muted)";

/** Eat here, or take out — brought to the address the customer gives. */
type Kind = "DINE_IN" | "TAKEAWAY";
const KINDS: { v: Kind; label: string; icon: typeof UtensilsCrossed }[] = [
  { v: "DINE_IN", label: "Eat here", icon: UtensilsCrossed },
  { v: "TAKEAWAY", label: "Take out", icon: ShoppingBag },
];
const addressOk = (a: string) => a.trim().length >= 5;

/** On the bill (table / room — paid later) or paid now (mobile money or bank, with the screenshot). */
type PayWay = "BILL" | "NOW";
const paidFirstOf = (pay: PayFirstValue, total: number) => ({ proofId: pay.proofId!, accountId: pay.accountId!, reference: pay.reference.trim() || undefined, expectedTotal: total });
const PAY_FIRST_MISSING = "Pay first — choose the account, add the screenshot and tick “I have paid”.";
const PAY_PHONE_MISSING = "Enter your mobile-money number to pay online.";
/** A Tanzanian mobile-money number (0712 345 678, +255 712 345 678…) — the server checks it again. */
const payPhoneOk = (p: string) => /^(?:\+?255|0)?[67]\d{8}$/.test(p.replace(/[\s-]/g, ""));

/** Where the customer goes once the order is in: paying online — the payment page; otherwise the order's page. */
function afterOrder(res: { track: string | null; pay: string | null; payError: string | null }) {
  if (res.pay) return `/pay/${res.pay}`;
  return res.track ? `/order/${res.track}?new=1${res.payError ? "&pay=0" : ""}` : null;
}

function PayWayPicker({ way, setWay, bill, billHint, online }: { way: PayWay; setWay: (w: PayWay) => void; bill: string; billHint: string; online?: boolean }) {
  const options: { v: PayWay; label: string; hint: string; icon: typeof Receipt }[] = [
    { v: "BILL", label: bill, hint: billHint, icon: Receipt },
    online ? { v: "NOW", label: "Pay online", hint: "Mobile money, now", icon: Smartphone } : { v: "NOW", label: "Pay now", hint: "Mobile money or bank", icon: Smartphone },
  ];
  return (
    <div>
      <p className={heading}>How will you pay?</p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        {options.map((o) => (
          <button key={o.v} type="button" onClick={() => setWay(o.v)} aria-pressed={way === o.v}
            className={cn("flex items-center gap-2.5 rounded-2xl p-2.5 text-left ring-1 transition", way === o.v ? "bg-(--vr-dark) text-white ring-(--vr-dark)" : "bg-(--vr-bg) ring-(--vr-line) hover:ring-(--vr-gold)")}>
            <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", way === o.v ? "bg-(--vr-gold) text-(--vr-ink)" : "bg-white text-(--vr-gold-ink)")}><o.icon className="size-4" /></span>
            <span className="min-w-0 leading-tight">
              <span className="block text-[13px] font-semibold">{o.label}</span>
              <span className={cn("block text-[11px]", way === o.v ? "text-white/65" : "text-(--vr-muted)")}>{o.hint}</span>
            </span>
          </button>
        ))}
      </div>
    </div>
  );
}

/** Who is ordering — given before the first item went in; "Change" asks again. */
function WhoCard({ who, sub, onChange }: { who: Who | null; sub?: string; onChange?: () => void }) {
  if (!who) {
    return (
      <button type="button" onClick={onChange} className="flex w-full items-center gap-3 rounded-2xl bg-(--vr-gold-soft) p-3 text-left ring-1 ring-(--vr-gold)/40">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--vr-dark) text-(--vr-gold)"><UserRound className="size-4" /></span>
        <span className="min-w-0 flex-1 text-[13.5px] font-semibold">Add your name and number</span>
        <span className="text-[12px] font-semibold text-(--vr-gold-ink)">Add</span>
      </button>
    );
  }
  return (
    <div className="flex items-center gap-3 rounded-2xl bg-(--vr-bg) p-3 ring-1 ring-(--vr-line)">
      <span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--vr-dark) font-display text-[17px] font-semibold text-(--vr-gold)">{who.name.charAt(0).toUpperCase()}</span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[14px] font-semibold">{who.name}</span>
        <span className="mt-0.5 block truncate text-[12.5px] tabular-nums text-(--vr-muted)">{sub ?? phoneLabel(who.phone)}</span>
      </span>
      {onChange && <button type="button" onClick={onChange} className="h-8 shrink-0 rounded-full bg-(--vr-card) px-3 text-[12px] font-medium ring-1 ring-(--vr-line) transition hover:ring-(--vr-gold)">Change</button>}
    </div>
  );
}

function Notes({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className={label}>Note for the kitchen <span className="font-normal text-(--vr-muted)">· optional</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} maxLength={300} rows={2} placeholder="No onions, extra ice…"
        className="mt-1 block w-full resize-none rounded-xl border border-(--vr-line) bg-white px-3.5 py-2.5 text-[16px] outline-none sm:text-[14px] transition placeholder:text-(--vr-muted)/70 focus:border-(--vr-gold) focus:ring-4 focus:ring-(--vr-gold)/15" />
    </label>
  );
}

function KindPicker({ kind, setKind }: { kind: Kind; setKind: (k: Kind) => void }) {
  return (
    <div>
      <p className={heading}>How would you like it?</p>
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-full bg-(--vr-bg) p-1">
        {KINDS.map((k) => (
          <button key={k.v} type="button" onClick={() => setKind(k.v)} aria-pressed={kind === k.v}
            className={cn("flex h-9 items-center justify-center gap-1.5 rounded-full text-[13px] font-medium transition", kind === k.v ? "bg-(--vr-dark) text-white" : "text-(--vr-ink)/70 hover:text-(--vr-ink)")}>
            <k.icon className={cn("size-3.5", kind === k.v ? "text-(--vr-gold)" : "")} />{k.label}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Take out: where to bring it. */
function DeliveryAddress({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <label className={label}>
      <span className="flex items-center gap-1.5"><MapPin className="size-3.5 text-(--vr-gold-ink)" />Delivery address</span>
      <textarea value={value} onChange={(e) => onChange(e.target.value)} maxLength={200} rows={2} autoComplete="street-address"
        placeholder="e.g. Mikocheni B, Plot 45, near the pharmacy"
        className={cn("mt-1 block w-full resize-none rounded-xl border bg-white px-3.5 py-2.5 text-[16px] outline-none transition placeholder:text-(--vr-muted)/70 focus:ring-4 focus:ring-(--vr-gold)/15 sm:text-[14px]",
          value && !addressOk(value) ? "border-amber-400" : "border-(--vr-line) focus:border-(--vr-gold)")} />
      <span className="mt-1 block text-[11.5px] font-normal text-(--vr-muted)">Street, house or building, and a landmark — we bring your order here.</span>
    </label>
  );
}

function Submit({ pending, disabled, onClick, children }: { pending: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" disabled={pending || disabled} onClick={onClick}
      className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-(--vr-dark) text-[14.5px] font-semibold text-white shadow-[0_14px_30px_-18px_rgba(29,23,18,0.9)] transition hover:bg-black disabled:opacity-50">
      {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}{children}
    </button>
  );
}

/** The error, "Place order" and a line under it — stuck to the bottom of the order, always in view. */
function Footer({ error, children, hint }: { error: string | null; children: React.ReactNode; hint?: string }) {
  return (
    <div className="sticky bottom-0 z-10 -mx-5 space-y-2 border-t border-(--vr-line) bg-(--vr-card) px-5 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-3">
      <Problem error={error} />
      {children}
      {hint && <p className="text-center text-[11.5px] text-(--vr-muted)">{hint}</p>}
    </div>
  );
}

function Problem({ error }: { error: string | null }) {
  return error ? <p role="alert" className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800 ring-1 ring-rose-200">{error} Your order was not sent — please try again.</p> : null;
}

function PayNote({ children }: { children: React.ReactNode }) {
  return <p className="flex items-start gap-2 text-[12px] leading-snug text-(--vr-muted)"><CreditCard className="mt-px size-3.5 shrink-0 text-(--vr-gold-ink)" />{children}</p>;
}

/** Pay online: the number the payment request goes to — the customer approves it on their phone with their PIN. */
function PayOnline({ total, phone, onChange }: { total: number; phone: string; onChange: (v: string) => void }) {
  return (
    <div className="space-y-2.5 rounded-2xl bg-(--vr-bg) p-3.5 ring-1 ring-(--vr-line)">
      <div className="flex items-center justify-between gap-3">
        <p className="flex items-center gap-2 text-[13.5px] font-semibold"><Smartphone className="size-4 text-(--vr-gold-ink)" />Pay online</p>
        <p className="text-[14px] font-semibold tabular-nums">{tzs(total)}</p>
      </div>
      <label className={label}>Mobile-money number
        <input value={phone} onChange={(e) => onChange(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="e.g. 0712 345 678"
          className={cn(field, phone && !payPhoneOk(phone) && "border-amber-400")} />
      </label>
      <p className="text-[11.5px] leading-snug text-(--vr-muted)">M-Pesa, Airtel Money, Tigo Pesa or HaloPesa — a payment request comes to this phone; approve it with your PIN.</p>
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-(--vr-muted)"><ShieldCheck className="size-3.5 text-(--vr-gold-ink)" />Secure payment powered by NTZS</p>
    </div>
  );
}

/** The details this place needs, and "Place order" — then the order's own page (status, bill). */
export function Checkout({ config, lines, total, who, onWho, onDone, seated }: {
  config: CheckoutConfig; lines: CartLine[]; total: number; who: Who | null; onWho: () => void; onDone: () => void;
  /** At a table: the seated customer (their table, one bill) — null until they said who they are. */
  seated?: { name: string; table: string } | null;
}) {
  const items = lines.map((l) => ({ menuItemId: l.option.id, quantity: l.qty }));
  switch (config.kind) {
    case "spot": return <SpotCheckout config={config} items={items} total={total} who={who} onWho={onWho} onDone={onDone} seated={seated} />;
    case "public": return <PublicCheckout config={config} items={items} total={total} who={who} onWho={onWho} onDone={onDone} />;
    case "room": return <RoomCheckout config={config} items={items} total={total} onDone={onDone} />;
    case "more": return <MoreCheckout config={config} items={items} total={total} onDone={onDone} />;
  }
}

type Items = { menuItemId: string; quantity: number }[];

/**
 * A table, the counter or the main restaurant QR: who is ordering (found again by phone). At a
 * table or the counter they eat here — on the bill, or paid now. Only the main restaurant QR also
 * offers take out (delivered, always paid first). An open order here can take the new items.
 */
function SpotCheckout({ config, items, total, who, onWho, onDone, seated }: {
  config: Extract<CheckoutConfig, { kind: "spot" }>; items: Items; total: number; who: Who | null; onWho: () => void; onDone: () => void;
  seated?: { name: string; table: string } | null;
}) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [kind, setKind] = useState<Kind>("DINE_IN");
  const [way, setWay] = useState<PayWay>("BILL");
  const [where, setWhere] = useState("");
  const [address, setAddress] = useState(who?.address ?? "");
  const [pay, setPay] = useState<PayFirstValue>(NO_PAYMENT);
  const [payPhone, setPayPhone] = useState(who?.phone ?? "");
  const [trap, setTrap] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [found, setFound] = useState<{ phone: string; order: { number: string; total: number; track: string; items: number } | null } | null>(null);
  const [joinOpen, setJoinOpen] = useState(true);
  const [pending, start] = useTransition();
  const main = config.spot === "MAIN";
  // A table: the customer's session holds all their orders (one bill) — no joining old orders by phone.
  const atTable = config.spot === "TABLE";

  // An open order at the counter for this phone? Offer to add to it.
  const phone = who?.phone ?? null;
  useEffect(() => {
    if (main || atTable || !phone) return;
    let live = true;
    identifyAtTableAction({ token: config.token, phone }).then((res) => { if (live) setFound({ phone, order: res.ok ? res.data.active : null }); });
    return () => { live = false; };
  }, [phone, config.token, main, atTable]);
  const open = found && found.phone === phone ? found.order : null;
  const takeOut = main && kind === "TAKEAWAY";
  const payNow = takeOut || way === "NOW";
  const joining = !!open && joinOpen && !payNow;
  const online = !!config.online;
  const payReady = !payNow || (online ? payPhoneOk(payPhone) : payFirstReady(pay));
  const ready = (atTable ? !!seated : !!who) && (!takeOut || addressOk(address)) && payReady;

  const send = () => start(async () => {
    setError(null);
    if (atTable ? !seated : !who) { onWho(); return; }
    if (joining && open) {
      const res = await addItemsByTrackAction({ token: open.track, items });
      if (!res.ok) { setError(res.error); return; }
      onDone(); router.push(`/order/${open.track}?added=1`);
      return;
    }
    const clientKey = key ?? newKey(); setKey(clientKey);
    if (takeOut && !addressOk(address)) { setError("Please add the delivery address."); return; }
    if (!payReady) { setError(online ? PAY_PHONE_MISSING : PAY_FIRST_MISSING); return; }
    const res = await placeTableOrderAction({
      token: config.token, clientKey, items, notes: notes.trim() || undefined, ...(who && !atTable ? whoForOrder(who) : {}),
      kind: takeOut ? "TAKEAWAY" : "DINE_IN", where: main && !takeOut ? where : undefined, deliveryAddress: takeOut ? address.trim() : undefined,
      paidFirst: payNow && !online ? paidFirstOf(pay, total) : undefined, payOnline: payNow && online ? { phone: payPhone.trim() } : undefined, website: trap,
    });
    if (!res.ok) {
      setError(res.error);
      // Their table's session ended (paid and closed) or this phone was never seated: say who they are again.
      if (res.fieldErrors?.seat) { router.refresh(); onWho(); }
      return;
    }
    if (takeOut) rememberAddress(address);
    onDone(); router.push(afterOrder(res.data)!);
  });

  return (
    <div className="mt-4 space-y-3.5">
      {atTable
        ? seated ? <WhoCard who={{ name: seated.name, phone: "" }} sub={`${seated.table} · your table · one bill`} /> : <WhoCard who={null} onChange={onWho} />
        : <WhoCard who={who} onChange={onWho} />}
      {main && <KindPicker kind={kind} setKind={setKind} />}
      {!takeOut && <PayWayPicker way={way} setWay={setWay} bill={main ? "Pay after" : "Add to my bill"} billHint="Pay when you are done" online={online} />}
      {open && !payNow && (
        <div className="space-y-1.5 rounded-2xl bg-(--vr-gold-soft) p-3">
          <p className="text-[12.5px] font-semibold text-(--vr-gold-ink)">You have an open order here — #{open.number} · {tzs(open.total)}</p>
          {[[true, `Add these to order #${open.number}`, "Same order, same bill"], [false, "Start a new order", "A separate order and bill"]].map(([v, t, s]) => (
            <button key={String(v)} type="button" onClick={() => setJoinOpen(v as boolean)} aria-pressed={joinOpen === v}
              className={cn("flex w-full items-center gap-3 rounded-xl bg-white px-3 py-2.5 text-left ring-1 transition", joinOpen === v ? "ring-2 ring-(--vr-dark)" : "ring-(--vr-line)")}>
              <span className={cn("grid size-5 shrink-0 place-items-center rounded-full border-2", joinOpen === v ? "border-(--vr-dark) bg-(--vr-dark) text-white" : "border-(--vr-line)")}>{joinOpen === v && <Check className="size-3" strokeWidth={3} />}</span>
              <span className="leading-tight"><span className="block text-[13px] font-semibold">{t as string}</span><span className="text-[11.5px] text-(--vr-muted)">{s as string}</span></span>
            </button>
          ))}
        </div>
      )}
      {takeOut && <DeliveryAddress value={address} onChange={setAddress} />}
      {payNow && (online ? <PayOnline total={total} phone={payPhone} onChange={setPayPhone} /> : <PayFirst total={total} accounts={config.payTo} value={pay} onChange={setPay} />)}
      {main && !takeOut && !joining && <label className={label}>Where are you sitting? <span className="font-normal text-(--vr-muted)">· optional</span><input value={where} onChange={(e) => setWhere(e.target.value)} placeholder="e.g. by the window" className={field} /></label>}
      {!joining && <Notes value={notes} onChange={setNotes} />}
      <input value={trap} onChange={(e) => setTrap(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden className="hidden" name="website" />
      <PayNote>{payNow && online ? (takeOut ? "Paid online first — once your payment is confirmed, your order starts and we bring it to you." : "Approve the payment on your phone — your order starts as soon as it is paid.")
        : takeOut ? "Paid first — your order starts right away and we bring it to you. If the payment does not reach us, we call you."
        : payNow ? "Paid now — your order starts right away. If the payment does not reach us, we call you."
        : "Order more any time — ask for your bill when you are done. Cash, card or mobile money."}</PayNote>
      <Footer error={error} hint="Straight to our kitchen and bar — follow it on the next page.">
        <Submit pending={pending} disabled={!ready} onClick={send}>{joining ? `Add to order #${open?.number} · ${tzs(total)}` : payNow && online ? `Order & pay online · ${tzs(total)}` : payNow ? `Place paid order · ${tzs(total)}` : `Place order · ${tzs(total)}`}</Submit>
      </Footer>
    </div>
  );
}

/** The public menu (website / menu QR): who is ordering and how they want it. */
function PublicCheckout({ config, items, total, who, onWho, onDone }: {
  config: Extract<CheckoutConfig, { kind: "public" }>; items: Items; total: number; who: Who | null; onWho: () => void; onDone: () => void;
}) {
  const router = useRouter();
  const [kind, setKind] = useState<Kind>("DINE_IN");
  const [table, setTable] = useState(config.table ?? "");
  const [address, setAddress] = useState(who?.address ?? "");
  const [pay, setPay] = useState<PayFirstValue>(NO_PAYMENT);
  const [payPhone, setPayPhone] = useState(who?.phone ?? "");
  const [way, setWay] = useState<PayWay>("BILL");
  const takeOut = kind === "TAKEAWAY";
  const payNow = takeOut || way === "NOW";
  const online = !!config.online;
  const payReady = !payNow || (online ? payPhoneOk(payPhone) : payFirstReady(pay));
  const ready = !!who && (!takeOut || addressOk(address)) && payReady;
  const [notes, setNotes] = useState("");
  const [trap, setTrap] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = () => start(async () => {
    setError(null);
    if (!who) { onWho(); return; }
    const clientKey = key ?? newKey(); setKey(clientKey);
    if (takeOut && !addressOk(address)) { setError("Please add the delivery address."); return; }
    if (!payReady) { setError(online ? PAY_PHONE_MISSING : PAY_FIRST_MISSING); return; }
    const res = await placeOnlineOrderAction({
      clientKey, items, notes: notes.trim() || undefined, ...whoForOrder(who),
      kind, tableLabel: takeOut ? undefined : table, deliveryAddress: takeOut ? address.trim() : undefined,
      paidFirst: payNow && !online ? paidFirstOf(pay, total) : undefined, payOnline: payNow && online ? { phone: payPhone.trim() } : undefined, fromQr: config.fromQr, website: trap,
    });
    if (!res.ok) { setError(res.error); return; }
    if (takeOut) rememberAddress(address);
    onDone(); router.push(afterOrder(res.data)!);
  });
  return (
    <div className="mt-4 space-y-3.5">
      <WhoCard who={who} onChange={onWho} />
      <KindPicker kind={kind} setKind={setKind} />
      {takeOut
        ? <DeliveryAddress value={address} onChange={setAddress} />
        : <>
            <PayWayPicker way={way} setWay={setWay} bill="Pay after" billHint="Pay when you are done" online={online} />
            <label className={label}>Table <span className="font-normal text-(--vr-muted)">· optional</span><input value={table} onChange={(e) => setTable(e.target.value)} placeholder="e.g. Table 4" className={field} /></label>
          </>}
      {payNow && (online ? <PayOnline total={total} phone={payPhone} onChange={setPayPhone} /> : <PayFirst total={total} accounts={config.payTo} value={pay} onChange={setPay} />)}
      <Notes value={notes} onChange={setNotes} />
      <input value={trap} onChange={(e) => setTrap(e.target.value)} tabIndex={-1} autoComplete="off" aria-hidden className="hidden" name="website" />
      <PayNote>{payNow && online ? (takeOut ? "Paid online first — once your payment is confirmed, your order starts and we bring it to you." : "Approve the payment on your phone — your order starts as soon as it is paid.") : takeOut ? "Paid first — your order starts right away and we bring it to you. If the payment does not reach us, we call you." : payNow ? "Paid now — your order starts right away. If the payment does not reach us, we call you." : "You pay after your meal — cash, card or mobile money."}</PayNote>
      <p className="flex items-start gap-2 text-[12px] text-(--vr-muted)"><BedDouble className="mt-px size-3.5 shrink-0" />Staying with us? Scan the QR card in your room to order to your room bill.</p>
      <Footer error={error}>
        <Submit pending={pending} disabled={!ready} onClick={send}>{payNow && online ? "Order & pay online" : payNow ? "Place paid order" : "Place order"} · {tzs(total)}</Submit>
      </Footer>
    </div>
  );
}

/** A room (its QR, or the guest's stay link): the stay is known — on the room bill, or paid now; never take out. */
function RoomCheckout({ config, items, total, onDone }: { config: Extract<CheckoutConfig, { kind: "room" }>; items: Items; total: number; onDone: () => void }) {
  const router = useRouter();
  const [notes, setNotes] = useState("");
  const [way, setWay] = useState<PayWay>("BILL");
  const [pay, setPay] = useState<PayFirstValue>(NO_PAYMENT);
  const [payPhone, setPayPhone] = useState("");
  const [key, setKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const payNow = way === "NOW";
  const online = !!config.online;
  const payReady = !payNow || (online ? payPhoneOk(payPhone) : payFirstReady(pay));
  const send = () => start(async () => {
    setError(null);
    if (!payReady) { setError(online ? PAY_PHONE_MISSING : PAY_FIRST_MISSING); return; }
    const clientKey = key ?? newKey(); setKey(clientKey);
    const body = {
      token: config.target.token, items, notes: notes.trim() || undefined, clientKey,
      paidFirst: payNow && !online ? paidFirstOf(pay, total) : undefined, payOnline: payNow && online ? { phone: payPhone.trim() } : undefined,
    };
    const res = config.target.kind === "room" ? await placeRoomQrOrderAction(body) : await placeStayOrderAction(body);
    if (!res.ok) { setError(res.error); return; }
    onDone();
    const next = afterOrder(res.data);
    if (next) router.push(next); else router.refresh();
  });
  return (
    <div className="mt-4 space-y-3.5">
      {config.guest && <WhoCard who={{ name: config.guest, phone: "" }} sub={config.where.replace(/^the /, "The ")} />}
      <PayWayPicker way={way} setWay={setWay} bill="Bill to my room" billHint="Settle at check-out" online={online} />
      {payNow && (online ? <PayOnline total={total} phone={payPhone} onChange={setPayPhone} /> : <PayFirst total={total} accounts={config.payTo ?? []} value={pay} onChange={setPay} />)}
      <p className="flex items-start gap-2 rounded-xl bg-(--vr-gold-soft) px-3 py-2.5 text-[12.5px] text-(--vr-gold-ink)"><BedDouble className="mt-0.5 size-4 shrink-0" />
        {payNow ? `Delivered to ${config.where} — ${online ? "paid online" : "paid now"}, so it is not added to your room bill.` : `Delivered to ${config.where} and added to your room bill — you settle everything at check-out.`}
      </p>
      <Notes value={notes} onChange={setNotes} />
      <Footer error={error}>
        <Submit pending={pending} disabled={!payReady} onClick={send}>{payNow && online ? "Order & pay online" : payNow ? "Place paid order" : "Place order"} · {tzs(total)}</Submit>
      </Footer>
    </div>
  );
}

/** "Order more": the new items join the customer's open order. */
function MoreCheckout({ config, items, total, onDone }: { config: Extract<CheckoutConfig, { kind: "more" }>; items: Items; total: number; onDone: () => void }) {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const send = () => start(async () => {
    setError(null);
    const res = await addItemsByTrackAction({ token: config.token, items });
    if (!res.ok) { setError(res.error); return; }
    onDone(); router.push(`/order/${config.token}?added=1`);
  });
  return (
    <div className="mt-4 space-y-3.5">
      <p className="flex items-start gap-2 rounded-xl bg-(--vr-gold-soft) px-3 py-2.5 text-[12.5px] text-(--vr-gold-ink)"><Plus className="mt-0.5 size-4 shrink-0" />These join order #{config.number} — the same order and the same bill.</p>
      <Footer error={error}>
        <Submit pending={pending} onClick={send}>Add to order #{config.number} · {tzs(total)}</Submit>
      </Footer>
    </div>
  );
}
