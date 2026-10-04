"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, Loader2, Smartphone, X } from "lucide-react";
import { cancelPromptAction, mobilePayAvailableAction, promptStatusAction, sendOrdersPromptAction, sendStayPromptAction } from "@/app/staff/(app)/mobile-pay/actions";
import { cn } from "@/lib/utils";

const fmt = (n: number) => `TZS ${Math.round(n).toLocaleString("en-US")}`;
const POLL_MS = 4000;
const GIVE_UP_MS = 10 * 60_000;

// Asked once per page: is nTZS set up, and does this person take payments?
let availability: Promise<boolean> | null = null;
function useMobilePayAvailable() {
  const [ok, setOk] = useState(false);
  useEffect(() => {
    let alive = true;
    (availability ??= mobilePayAvailableAction().catch(() => false)).then((v) => { if (alive) setOk(v); });
    return () => { alive = false; };
  }, []);
  return ok;
}

type Target = { kind: "stay"; reservationId: string } | { kind: "orders"; orderIds: string[]; handedOverById?: string | null };
type Waiting = { id: string; amount: number; phone: string; status: string; note: string | null };

/**
 * SEND TO PHONE — a mobile-money prompt (nTZS) to the customer's phone: M-Pesa, Airtel Money, Mixx by Yas, HaloPesa…
 * They approve it on their phone; the payment is recorded by itself (on the guest's bill, or the order / table bill)
 * and the screen updates. Shown only where nTZS is set up and to those who take payments.
 */
export function SendToPhone({ target, amount, phone = "", editableAmount = false, who, onPaid, className }: {
  target: Target;
  /** The amount to ask for (a guest's bill: up to what they owe, changeable when `editableAmount`). */
  amount: number;
  /** The customer's number, when known (it can be changed). */
  phone?: string | null;
  editableAmount?: boolean;
  /** "Asha" — used in the waiting line. */
  who?: string | null;
  onPaid?: () => void;
  className?: string;
}) {
  const available = useMobilePayAvailable();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [number, setNumber] = useState(phone ?? "");
  const [ask, setAsk] = useState(String(Math.max(0, Math.round(amount))));
  const [waiting, setWaiting] = useState<Waiting | null>(null);
  const [pending, start] = useTransition();
  const startedAt = useRef(0);
  const lastAmount = useRef(amount);
  useEffect(() => {
    if (lastAmount.current !== amount) { lastAmount.current = amount; setAsk(String(Math.max(0, Math.round(amount)))); }
  }, [amount]);

  // Follow the prompt until it is paid, refused or given up — one question at a time (a slow nTZS never piles up
  // requests, and "paid" is announced once).
  const waitingId = waiting?.status === "PENDING" ? waiting.id : null;
  const onPaidRef = useRef(onPaid);
  useEffect(() => { onPaidRef.current = onPaid; });
  useEffect(() => {
    if (!waitingId) return;
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      if (Date.now() - startedAt.current > GIVE_UP_MS) {
        setWaiting((w) => (w && w.id === waitingId ? { ...w, note: "Still not confirmed — check again later; it is recorded by itself if they pay." } : w));
        return;
      }
      const r = await promptStatusAction({ id: waitingId }).catch(() => null);
      if (stopped) return;
      if (r?.ok && r.data.status !== "PENDING") {
        setWaiting((w) => (w && w.id === r.data.id ? { ...w, status: r.data.status, note: r.data.note } : w));
        if (r.data.status === "COMPLETED") {
          if (r.data.note) toast.warning("Mobile money received — needs attention", { description: r.data.note, duration: 15000 });
          else toast.success(`${fmt(r.data.amount)} received by mobile money — recorded.`, { duration: 9000 });
          router.refresh();
          onPaidRef.current?.();
        } else if (r.data.status === "FAILED" || r.data.status === "EXPIRED") toast.error(r.data.note ?? "The customer did not pay.", { duration: 9000 });
        return;
      }
      timer = setTimeout(tick, POLL_MS);
    };
    timer = setTimeout(tick, POLL_MS);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [waitingId, router]);

  if (!available) return null;
  const amt = Number(ask) || 0;

  function send() {
    start(async () => {
      const r = target.kind === "stay"
        ? await sendStayPromptAction({ reservationId: target.reservationId, amount: editableAmount ? amt : Math.round(amount), phone: number || undefined })
        : await sendOrdersPromptAction({ orderIds: target.orderIds, phone: number, handedOverById: target.handedOverById ?? null });
      if (!r.ok) { toast.error(r.error, { duration: 9000 }); return; }
      startedAt.current = Date.now();
      setWaiting({ id: r.data.id, amount: r.data.amount, phone: r.data.phone, status: r.data.status, note: null });
    });
  }
  function cancel() {
    if (!waiting) return;
    start(async () => {
      const r = await cancelPromptAction({ id: waiting.id });
      if (r.ok) setWaiting(null); else toast.error(r.error);
    });
  }

  if (waiting) {
    const s = waiting.status;
    return (
      <div className={cn("rounded-xl border p-3 text-sm", s === "COMPLETED" ? "border-emerald-500/40 bg-emerald-500/[0.07]" : s === "PENDING" ? "border-sky-500/40 bg-sky-500/[0.06]" : "border-rose-500/40 bg-rose-500/[0.06]", className)} role="status" aria-live="polite">
        <div className="flex items-start gap-2.5">
          <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg", s === "COMPLETED" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300" : s === "PENDING" ? "bg-sky-500/15 text-sky-600 dark:text-sky-300" : "bg-rose-500/15 text-rose-600 dark:text-rose-300")}>
            {s === "COMPLETED" ? <Check className="size-4" /> : s === "PENDING" ? <Loader2 className="size-4 animate-spin" /> : <X className="size-4" />}
          </span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block font-semibold">
              {s === "COMPLETED" ? (waiting.note ? "Received — needs attention" : `Paid · ${fmt(waiting.amount)} recorded`) : s === "PENDING" ? `Waiting for ${who ? who.split(" ")[0] : "the customer"} to approve…` : s === "CANCELLED" ? "Stopped waiting" : "Not paid"}
            </span>
            <span className="text-xs text-muted-foreground">
              {s === "PENDING" ? `${fmt(waiting.amount)} prompt sent to ${waiting.phone} — they enter their PIN on the phone. This updates by itself.` : waiting.note ?? `${fmt(waiting.amount)} · ${waiting.phone}`}
            </span>
          </span>
          {s === "PENDING" && <button type="button" onClick={cancel} disabled={pending} className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted-foreground ring-1 ring-border hover:bg-muted hover:text-foreground">Cancel</button>}
          {s !== "PENDING" && <button type="button" onClick={() => { setWaiting(null); setOpen(false); setAsk(String(Math.max(0, Math.round(amount)))); }} className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold ring-1 ring-border hover:bg-muted">{s === "COMPLETED" ? "New prompt" : "Try again"}</button>}
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className={cn("flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-sky-500/50 px-3 py-2 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-500/[0.06] dark:text-sky-300", className)}>
        <Smartphone className="size-4" />Send to phone · mobile money{amount > 0 ? ` · ${fmt(editableAmount ? amt : amount)}` : ""}
      </button>
    );
  }

  return (
    <div className={cn("space-y-2 rounded-xl border border-sky-500/40 bg-sky-500/[0.05] p-3", className)}>
      <div className="flex items-center justify-between gap-2">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><Smartphone className="size-4 text-sky-600 dark:text-sky-300" />Send a payment prompt</p>
        <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>
      </div>
      <p className="text-[11px] text-muted-foreground">M-Pesa, Airtel Money, Mixx by Yas, HaloPesa… The customer approves it on their phone; the payment is recorded by itself.</p>
      <div className={cn("grid gap-2", editableAmount && "grid-cols-2")}>
        <input value={number} onChange={(e) => setNumber(e.target.value)} type="tel" inputMode="tel" placeholder="Their number, e.g. 0712 345 678" aria-label="Mobile-money number"
          className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-sky-500/30" />
        {editableAmount && (
          <input value={ask} onChange={(e) => setAsk(e.target.value.replace(/\D/g, ""))} inputMode="numeric" aria-label="Amount (TZS)"
            className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm tabular-nums outline-none focus:ring-2 focus:ring-sky-500/30" />
        )}
      </div>
      <button type="button" onClick={send} disabled={pending || (!number.trim() && target.kind === "orders") || (editableAmount && amt <= 0)}
        className="flex h-10 w-full items-center justify-center gap-1.5 rounded-lg bg-sky-600 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:opacity-60">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}Send prompt · {fmt(editableAmount ? amt : amount)}
      </button>
    </div>
  );
}
