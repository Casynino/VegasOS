"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check, ChevronDown, Loader2, Smartphone, X } from "lucide-react";
import { NetworkMarks } from "@/components/payments/networks";
import { cancelPromptAction, mobilePayAvailableAction, promptStatusAction, sendOrdersPromptAction, sendStayPromptAction } from "@/app/staff/(app)/mobile-pay/actions";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

const fmt = (n: number) => `TZS ${Math.round(n).toLocaleString("en-US")}`;
const POLL_MS = 4000;
const GIVE_UP_MS = 10 * 60_000;

// Asked once per page: is nTZS set up, and does this person take payments?
let availability: Promise<boolean> | null = null;
export function useMobilePayAvailable() {
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
export function SendToPhone({ target, amount, phone = "", editableAmount = false, who, onPaid, className, resume = null, primary = false }: {
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
  /** A prompt already sent (e.g. as the booking was made): followed from the start. */
  resume?: { id: string; amount: number; phone: string } | null;
  /** The main way to pay here (owner, 2026-10-05: nTZS first, cash/LIPA/bank as other ways): shown open, ready to send. */
  primary?: boolean;
}) {
  const t = useT();
  const available = useMobilePayAvailable();
  const router = useRouter();
  const [open, setOpen] = useState(primary);
  const [number, setNumber] = useState(phone ?? "");
  const [ask, setAsk] = useState(String(Math.max(0, Math.round(amount))));
  const [waiting, setWaiting] = useState<Waiting | null>(resume ? { ...resume, status: "PENDING", note: null } : null);
  const [pending, start] = useTransition();
  const startedAt = useRef(0);
  useEffect(() => { if (resume && !startedAt.current) startedAt.current = Date.now(); }, [resume]);
  const lastAmount = useRef(amount);
  useEffect(() => {
    if (lastAmount.current !== amount) { lastAmount.current = amount; setAsk(String(Math.max(0, Math.round(amount)))); }
  }, [amount]);

  // Follow the prompt until it is paid, refused or given up — one question at a time (a slow nTZS never piles up
  // requests, and "paid" is announced once).
  const waitingId = waiting?.status === "PENDING" ? waiting.id : null;
  const onPaidRef = useRef(onPaid);
  useEffect(() => { onPaidRef.current = onPaid; });
  // The translator for the follow-up below (read when it speaks, so a language switch never restarts the polling).
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; });
  useEffect(() => {
    if (!waitingId) return;
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      if (stopped) return;
      const t = tRef.current;
      // After a while it is asked less often — never given up (a late approval still shows "paid" here).
      const late = Date.now() - startedAt.current > GIVE_UP_MS;
      if (late) setWaiting((w) => (w && w.id === waitingId && !w.note ? { ...w, note: t("Not paid yet. If they pay later, it is still recorded automatically.") } : w));
      const r = await promptStatusAction({ id: waitingId }).catch(() => null);
      if (stopped) return;
      if (r?.ok && r.data.status !== "PENDING") {
        setWaiting((w) => (w && w.id === r.data.id ? { ...w, status: r.data.status, note: r.data.note } : w));
        if (r.data.status === "COMPLETED") {
          if (r.data.note) toast.warning(t("Mobile money received — please check"), { description: r.data.note, duration: 15000 });
          else toast.success(t("Paid — {amount} received by mobile money.", { amount: fmt(r.data.amount) }), { duration: 9000 });
          router.refresh();
          onPaidRef.current?.();
        } else if (r.data.status === "FAILED" || r.data.status === "EXPIRED") toast.error(r.data.note ?? t("Not paid — the request was declined or timed out."), { duration: 9000 });
        return;
      }
      timer = setTimeout(tick, late ? 20_000 : POLL_MS);
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
      setWaiting({ id: r.data.id, amount: r.data.amount, phone: r.data.phone, status: r.data.status, note: r.data.note });
    });
  }
  function cancel() {
    if (!waiting) return;
    start(async () => {
      const r = await cancelPromptAction({ id: waiting.id });
      if (!r.ok) { toast.error(r.error); return; }
      // They had just paid: it is recorded — not cancelled, and not collected again.
      if (r.data.status === "COMPLETED") {
        setWaiting((w) => (w ? { ...w, status: "COMPLETED", note: r.data.note } : w));
        toast.success(t("Paid — {amount} received by mobile money.", { amount: fmt(r.data.amount) }), { duration: 9000 });
        router.refresh();
        onPaidRef.current?.();
      } else setWaiting(null);
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
              {s === "COMPLETED" ? (waiting.note ? t("Received — please check") : t("Paid · {amount} received", { amount: fmt(waiting.amount) })) : s === "PENDING" ? (who ? t("Waiting for {name} to pay…", { name: who.split(" ")[0] }) : t("Waiting for the customer to pay…")) : s === "CANCELLED" ? t("Request cancelled") : s === "EXPIRED" ? t("Request expired — not paid") : t("Not paid")}
            </span>
            <span className="text-xs text-muted-foreground">
              {s === "PENDING" ? waiting.note ?? t("Payment request for {amount} sent to {phone}. They confirm it with their PIN — this updates automatically.", { amount: fmt(waiting.amount), phone: waiting.phone }) : waiting.note ?? `${fmt(waiting.amount)} · ${waiting.phone}`}
            </span>
          </span>
          {s === "PENDING" && <button type="button" onClick={cancel} disabled={pending} className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold text-muted-foreground ring-1 ring-border hover:bg-muted hover:text-foreground">{t("Cancel request")}</button>}
          {s !== "PENDING" && <button type="button" onClick={() => { setWaiting(null); setOpen(false); setAsk(String(Math.max(0, Math.round(amount)))); }} className="shrink-0 rounded-lg px-2 py-1 text-[11px] font-semibold ring-1 ring-border hover:bg-muted">{s === "COMPLETED" ? t("New request") : t("Send again")}</button>}
        </div>
      </div>
    );
  }

  if (!open) {
    return (
      <button type="button" onClick={() => setOpen(true)}
        className={cn("flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-sky-500/50 px-3 py-2 text-sm font-medium text-sky-700 transition-colors hover:bg-sky-500/[0.06] dark:text-sky-300", className)}>
        <Smartphone className="size-4" />{t("Request mobile money")}{amount > 0 ? ` · ${fmt(editableAmount ? amt : amount)}` : ""}
      </button>
    );
  }

  return (
    // Compact (owner, 2026-10-05: "nice, not too big"): one line saying what it is, then the number and the button.
    <div className={cn("space-y-2 rounded-xl border border-sky-500/30 bg-sky-500/[0.04] p-2.5", className)}>
      <div className="flex items-center gap-2">
        <Smartphone className="size-4 shrink-0 text-sky-500" />
        <span className="text-sm font-semibold">{t("Mobile money")}</span>
        {/* A definite width, so the marks shrink inside it (container query) instead of spilling out. */}
        <div className="ml-auto w-44 min-w-0 max-w-[55%]"><NetworkMarks label={null} compact className="justify-end" /></div>
        {!primary && <button type="button" onClick={() => setOpen(false)} aria-label={t("Close")} className="grid size-7 shrink-0 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>}
      </div>
      <div className="flex flex-wrap gap-2">
        <input value={number} onChange={(e) => setNumber(e.target.value)} type="tel" inputMode="tel" placeholder={t("Phone, e.g. 0712 345 678")} aria-label={t("Customer's phone number")}
          className="h-9 min-w-[10rem] flex-1 rounded-lg border border-border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-sky-500/30" />
        {editableAmount && (
          <input value={ask} onChange={(e) => setAsk(e.target.value.replace(/\D/g, ""))} inputMode="numeric" aria-label={t("Amount (TZS)")}
            className="h-9 w-28 rounded-lg border border-border bg-background px-3 text-sm tabular-nums outline-none focus:ring-2 focus:ring-sky-500/30" />
        )}
        <button type="button" onClick={send} disabled={pending || (!number.trim() && target.kind === "orders") || (editableAmount && amt <= 0)}
          className="flex h-9 shrink-0 grow items-center justify-center gap-1.5 rounded-lg bg-sky-600 px-3.5 text-sm font-semibold text-white transition hover:bg-sky-500 disabled:opacity-60 sm:grow-0">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}{t("Send request · {amount}", { amount: fmt(editableAmount ? amt : amount) })}
        </button>
      </div>
    </div>
  );
}

/**
 * The other ways to take the money (cash, LIPA, bank…) — under "Send to phone", folded away while nTZS is the main way
 * (owner, 2026-10-05). Where nTZS is not set up they show as before.
 */
export function OtherWays({ children, label = msg("Other payment methods"), className, fold = true }: {
  children: React.ReactNode; label?: string; className?: string;
  /** False when no prompt is offered above (nothing owed): the ways by hand are shown as they are. */
  fold?: boolean;
}) {
  const t = useT();
  const available = useMobilePayAvailable();
  const [open, setOpen] = useState(false);
  if (!available || !fold) return <div className={className}>{children}</div>;
  return (
    <div className={className}>
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex w-full items-center gap-2 py-1.5 text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground transition hover:text-foreground">
        <span className="h-px flex-1 bg-border" />{t(label)}<ChevronDown className={cn("size-3.5 transition", open && "rotate-180")} /><span className="h-px flex-1 bg-border" />
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}
