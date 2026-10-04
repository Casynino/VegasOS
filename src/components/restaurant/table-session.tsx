"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import { ArrowRight, BedDouble, BellRing, Check, ChevronLeft, Hand, Loader2, Receipt, ShieldCheck, Smartphone, UtensilsCrossed, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { imDoneAction, payTableBillOnlineAction } from "@/app/t/[token]/actions";
import { useWho } from "./who";
import { NetworkMarks } from "@/components/payments/networks";
import type { GuestTable } from "@/server/services/dining-sessions";
import { Sheet } from "./restaurant-app";

const tzs = (v: number) => `TZS ${v.toLocaleString("en-US")}`;
const STATUS_WORD: Record<string, string> = {
  PENDING: "Received", ACCEPTED: "Preparing", PREPARING: "Preparing", READY: "Ready", OUT_FOR_DELIVERY: "On its way", DELIVERED: "Served", COMPLETED: "Served", COLLECTED: "Served", CANCELLED: "Cancelled",
};
type Mine = NonNullable<GuestTable["mine"]>;
/** "the room bill (Room 305)" — what went on a hotel room, paid at check-out (maybe a friend's room, so never "yours"). */
const yourRoom = (m: Mine) => `the room bill${m.room ? ` (Room ${m.room})` : ""}`;

/**
 * Under the banner at a table: whose table it is and their running bill — "Your bill" and
 * "I'm done". Someone else's table or a reserved one gets a short, polite note (no names).
 * What went on their hotel room bill is shown as that — never as paid.
 */
export function TableSessionCard({ table, placeLabel }: { table: GuestTable; placeLabel: string }) {
  const [bill, setBill] = useState(false);
  if (table.state === "in_use") {
    return <Note icon={<Hand className="size-4" />}>{placeLabel} is being used by another customer. With them? Ask your waiter to add you to the table.</Note>;
  }
  if (table.state === "reserved") {
    return <Note icon={<BellRing className="size-4" />}>{placeLabel} is reserved. Please ask a waiter to seat you.</Note>;
  }
  if (table.state !== "mine" || !table.mine) return null;
  const m = table.mine;
  const asked = m.billRequested;
  // Settled once the bill was asked for: paid, on their room bill — or both.
  const settled = asked && !m.due && m.orders.length > 0;
  return (
    <>
      <section className="mt-2.5 overflow-hidden rounded-2xl bg-(--vr-card) ring-1 ring-(--vr-line)">
        <div className="flex items-center gap-3 px-3.5 py-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--vr-dark) font-display text-[17px] font-semibold text-(--vr-gold)">{m.name.charAt(0).toUpperCase()}</span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate text-[14px] font-semibold">Welcome, {m.name}</p>
            <p className="truncate text-[12px] text-(--vr-muted)">{m.table} · your table{table.movedTo ? " now" : ""}</p>
          </div>
          <button type="button" onClick={() => setBill(true)} className="shrink-0 text-right leading-tight">
            <span className="block text-[11px] text-(--vr-muted)">{m.orders.length ? `${m.orders.length} order${m.orders.length === 1 ? "" : "s"}` : "Your bill"}</span>
            <span className="block text-[15px] font-semibold tabular-nums">{tzs(m.total)}</span>
          </button>
        </div>
        {m.onRoom > 0 && !settled && (
          <p className="flex items-center gap-2 border-t border-(--vr-line) px-3.5 py-2 text-[12.5px] text-(--vr-muted)">
            <BedDouble className="size-3.5 shrink-0 text-(--vr-gold-ink)" /><span>On {yourRoom(m)} · <strong className="font-semibold tabular-nums text-(--vr-ink)">{tzs(m.onRoom)}</strong> — paid at check-out</span>
          </p>
        )}
        {asked && (
          <p className="flex items-center gap-2 border-t border-(--vr-line) bg-(--vr-gold-soft) px-3.5 py-2 text-[12.5px] font-medium text-(--vr-gold-ink)">
            {m.onRoom > 0 && settled ? <BedDouble className="size-3.5 shrink-0" /> : <BellRing className="size-3.5 shrink-0" />}
            {m.due ? `Your waiter is bringing the bill · ${tzs(m.due)} to pay`
              : !m.orders.length ? "Thank you — see you again soon!"
              : m.onRoom ? `${m.paid ? "Paid, the rest on" : "On"} ${yourRoom(m)} · ${tzs(m.onRoom)} — thank you! Take your time.`
              : "Paid — thank you! Take your time."}
          </p>
        )}
        {m.due > 0 && (table.pay?.live || table.pay?.offered) && <PayBillOnline due={m.due} live={table.pay.live} />}
        <div className="grid grid-cols-2 gap-px border-t border-(--vr-line) bg-(--vr-line)">
          <button type="button" onClick={() => setBill(true)} className="flex h-11 items-center justify-center gap-1.5 bg-(--vr-card) text-[13px] font-semibold transition hover:bg-(--vr-bg)">
            <Receipt className="size-4 text-(--vr-gold-ink)" />Your bill
          </button>
          <DoneButton disabled={asked} />
        </div>
      </section>
      <BillSheet open={bill} onClose={() => setBill(false)} mine={m} />
    </>
  );
}

function Note({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <p className="mt-2.5 flex items-start gap-2.5 rounded-2xl bg-(--vr-gold-soft) px-3.5 py-3 text-[13px] leading-snug text-(--vr-gold-ink) ring-1 ring-(--vr-gold)/30">
      <span className="mt-px shrink-0">{icon}</span><span>{children}</span>
    </p>
  );
}

const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("");
const phoneOk = (p: string) => /^(?:\+?255|0)?[67]\d{8}$/.test(p.replace(/[\s-]/g, ""));

/** "Pay my bill online": everything due at the table, from the customer's phone (nTZS) — no need to wait for the waiter. */
function PayBillOnline({ due, live }: { due: number; live: string | null }) {
  const router = useRouter();
  const [who] = useWho();
  const [open, setOpen] = useState(false);
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const key = useRef("");
  const number = phone ?? who?.phone ?? "";
  if (live) {
    return (
      <Link href={`/pay/${live}`} className="flex items-center gap-2 border-t border-(--vr-line) bg-(--vr-dark) px-3.5 py-2.5 text-[12.5px] font-semibold text-white">
        <Loader2 className="size-4 shrink-0 animate-spin text-(--vr-gold)" /><span className="flex-1">Your payment is on its way — approve it on your phone</span><span className="text-(--vr-gold)">Open</span>
      </Link>
    );
  }
  const pay = () => start(async () => {
    setError(null);
    if (!phoneOk(number)) { setError("Enter your mobile-money number, e.g. 0712 345 678."); return; }
    key.current ||= newKey();
    const r = await payTableBillOnlineAction({ phone: number.trim(), clientKey: key.current });
    if (!r.ok) { setError(r.error); key.current = ""; return; }
    router.push(`/pay/${r.data.pay}`);
  });
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-2 border-t border-(--vr-line) bg-(--vr-dark) px-3.5 py-2.5 text-left text-[12.5px] font-semibold text-white">
        <Smartphone className="size-4 shrink-0 text-(--vr-gold)" /><span className="flex-1">Pay my bill now · {tzs(due)}</span><ArrowRight className="size-3.5 text-(--vr-gold)" />
      </button>
      <AnimatePresence>
        {open && (
          <motion.div className="fixed inset-0 z-50 grid place-items-end bg-[#1d1712]/50 p-4 backdrop-blur-[2px] sm:place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setOpen(false)}>
            <motion.div role="dialog" aria-modal="true" aria-label="Pay your bill now" onClick={(e) => e.stopPropagation()} initial={{ y: 24 }} animate={{ y: 0 }} exit={{ y: 24 }}
              className="vr w-full max-w-sm space-y-3 rounded-3xl bg-(--vr-card) p-5 text-(--vr-ink) shadow-2xl">
              <div className="flex items-start justify-between gap-3">
                <span className="grid size-11 place-items-center rounded-full bg-(--vr-dark) text-(--vr-gold)"><Smartphone className="size-5" /></span>
                <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid size-9 place-items-center rounded-full ring-1 ring-(--vr-line)"><X className="size-4" /></button>
              </div>
              <div>
                <h2 className="font-display text-[24px] font-semibold leading-tight">Pay your bill now</h2>
                <p className="mt-1 text-[13px] text-(--vr-muted)">Everything still to pay at your table · <strong className="tabular-nums text-(--vr-ink)">{tzs(due)}</strong></p>
              </div>
              <label className="block text-[12.5px] font-medium text-(--vr-ink)/80">Mobile-money number
                <input value={number} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="e.g. 0712 345 678"
                  className={cn("mt-1 block h-11 w-full rounded-xl border border-(--vr-line) bg-white px-3.5 text-[16px] outline-none transition focus:border-(--vr-gold) focus:ring-4 focus:ring-(--vr-gold)/15 sm:text-[14px]", number && !phoneOk(number) && "border-amber-400")} />
              </label>
              {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800 ring-1 ring-rose-200">{error}</p>}
              <button type="button" disabled={pending} onClick={pay} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-(--vr-dark) text-[14px] font-semibold text-white disabled:opacity-60">
                {pending ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4 text-(--vr-gold)" />}Pay {tzs(due)}
              </button>
              <NetworkMarks center />
              <p className="text-center text-[11.5px] text-(--vr-muted)">A prompt comes to your phone — enter your PIN to approve.</p>
              <p className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-(--vr-muted)"><ShieldCheck className="size-3.5 text-(--vr-gold-ink)" />Secure payment powered by NTZS</p>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** "I'm done": ask once, then the waiter brings the bill (ordering more is still possible). */
function DoneButton({ disabled }: { disabled: boolean }) {
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const done = () => start(async () => {
    setError(null);
    const res = await imDoneAction();
    if (!res.ok) { setError(res.error); return; }
    setAsking(false);
    router.refresh();
  });
  return (
    <>
      <button type="button" disabled={disabled} onClick={() => setAsking(true)}
        className="flex h-11 items-center justify-center gap-1.5 bg-(--vr-card) text-[13px] font-semibold transition hover:bg-(--vr-bg) disabled:text-(--vr-muted)">
        {disabled ? <><Check className="size-4 text-emerald-600" />Bill asked</> : <><Hand className="size-4 text-(--vr-gold-ink)" />I&apos;m done</>}
      </button>
      <AnimatePresence>
        {asking && (
          <motion.div className="fixed inset-0 z-50 grid place-items-end bg-[#1d1712]/50 p-4 backdrop-blur-[2px] sm:place-items-center" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={() => setAsking(false)}>
            <motion.div role="dialog" aria-modal="true" aria-label="Ask for the bill" onClick={(e) => e.stopPropagation()} initial={{ y: 24 }} animate={{ y: 0 }} exit={{ y: 24 }}
              className="vr w-full max-w-sm rounded-3xl bg-(--vr-card) p-5 text-(--vr-ink) shadow-2xl">
              <span className="grid size-11 place-items-center rounded-full bg-(--vr-dark) text-(--vr-gold)"><Receipt className="size-5" /></span>
              <h2 className="mt-3 font-display text-[24px] font-semibold leading-tight">Ready for the bill?</h2>
              <p className="mt-1 text-[13px] leading-snug text-(--vr-muted)">Your waiter brings it to your table — cash, card or mobile money. You can still order more.</p>
              {error && <p role="alert" className="mt-3 rounded-xl bg-rose-50 px-3 py-2 text-[12.5px] text-rose-800 ring-1 ring-rose-200">{error}</p>}
              <div className="mt-4 grid grid-cols-[auto_1fr] gap-2">
                <button type="button" onClick={() => setAsking(false)} className="h-11 rounded-full px-4 text-[13px] font-medium ring-1 ring-(--vr-line)">Not yet</button>
                <button type="button" disabled={pending} onClick={done} className="flex h-11 items-center justify-center gap-2 rounded-full bg-(--vr-dark) text-[13.5px] font-semibold text-white disabled:opacity-60">
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4 text-(--vr-gold)" />}Yes, bring the bill
                </button>
              </div>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </>
  );
}

/** Everything they ordered at the table so far — every order, the total, what is paid, what is on their room bill and what is left. */
function BillSheet({ open, onClose, mine }: { open: boolean; onClose: () => void; mine: Mine }) {
  return (
    <Sheet open={open} onClose={onClose} label="Your bill" wide>
      <div className="flex items-center gap-3 border-b border-(--vr-line) px-4 pb-3 pt-[max(0.9rem,env(safe-area-inset-top))] sm:px-5 sm:pt-4">
        <button type="button" onClick={onClose} aria-label="Back to the menu" className="grid size-10 shrink-0 place-items-center rounded-full bg-(--vr-bg) hover:bg-(--vr-line) sm:order-last sm:size-8">
          <ChevronLeft className="size-5 sm:hidden" /><X className="hidden size-4 sm:block" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[22px] font-semibold leading-none">Your bill</h2>
          <p className="mt-1 truncate text-[12px] text-(--vr-muted)">{mine.table} · {mine.name}</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-5">
        {mine.orders.length === 0 ? (
          <div className="mt-6 flex flex-col items-center rounded-2xl border border-dashed border-(--vr-line) px-4 py-8 text-center">
            <span className="grid size-11 place-items-center rounded-full bg-(--vr-gold-soft) text-(--vr-gold-ink)"><UtensilsCrossed className="size-5" /></span>
            <p className="mt-3 text-[14px] font-semibold">Nothing ordered yet</p>
            <p className="mt-0.5 text-[12.5px] text-(--vr-muted)">Tap <strong className="text-(--vr-ink)">+</strong> on anything you like.</p>
          </div>
        ) : mine.orders.map((o) => (
          <section key={o.number} className="border-b border-(--vr-line) py-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-[13px] font-semibold">Order {o.number}</p>
              {o.track
                ? <Link href={`/order/${o.track}`} className={cn("inline-flex items-center gap-1 text-[12px] font-medium", o.status === "DELIVERED" || o.status === "COMPLETED" ? "text-emerald-700" : "text-(--vr-gold-ink)")}>{STATUS_WORD[o.status] ?? o.status}<ArrowRight className="size-3" /></Link>
                : <span className="text-[12px] text-(--vr-muted)">{STATUS_WORD[o.status] ?? o.status}</span>}
            </div>
            <ul className="mt-1.5 space-y-1 text-[13px]">
              {o.items.map((i, k) => (
                <li key={k} className="flex justify-between gap-3"><span className="min-w-0"><span className="tabular-nums text-(--vr-gold-ink)">{i.qty}×</span> {i.name}</span><span className="shrink-0 tabular-nums text-(--vr-muted)">{(i.qty * i.price).toLocaleString("en-US")}</span></li>
              ))}
            </ul>
          </section>
        ))}
        <dl className="mt-3 space-y-1 text-[13px]">
          <div className="flex justify-between"><dt className="text-(--vr-muted)">Total</dt><dd className="font-semibold tabular-nums">{tzs(mine.total)}</dd></div>
          {mine.paid > 0 && <div className="flex justify-between"><dt className="text-(--vr-muted)">Paid</dt><dd className="tabular-nums text-emerald-700">{tzs(mine.paid)}</dd></div>}
          {mine.onRoom > 0 && (
            <div className="flex justify-between gap-3">
              <dt className="flex items-center gap-1.5 text-(--vr-muted)"><BedDouble className="size-3.5 shrink-0 text-(--vr-gold-ink)" />On {yourRoom(mine)}</dt>
              <dd className="shrink-0 tabular-nums">{tzs(mine.onRoom)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between pt-1"><dt className="font-semibold">To pay</dt><dd className="text-[18px] font-semibold tabular-nums">{tzs(mine.due)}</dd></div>
        </dl>
        <p className="mt-3 text-[12px] leading-snug text-(--vr-muted)">
          {mine.onRoom > 0 && <>What is on the room bill is paid at check-out. </>}Order as often as you like — everything goes on this one bill. Tap “I&apos;m done” when you are ready to pay.
        </p>
      </div>
    </Sheet>
  );
}
