"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Check, Loader2, Lock, Receipt, RotateCcw, Smartphone, X } from "lucide-react";
import type { CustomerPayView } from "@/server/services/online-pay";
import { cancelPayAction, payStatusAction, retryPayAction } from "../actions";
import { cn } from "@/lib/utils";
import { NetworkMarks } from "@/components/payments/networks";

const tzs = (n: number) => `TZS ${Math.round(n).toLocaleString("en-US")}`;
const POLL_MS = 3000;
/** Not completed on our side: nTZS is still asked now and then for a while (a late approval shows "paid" by itself). */
const LATE_POLL_MS = 10_000, LATE_FOR_MS = 5 * 60_000;

/** Waiting → paid / not completed — follows the payment by itself; "paid" only once the hotel's server confirmed it. */
export function PayStatus({ initial }: { initial: CustomerPayView }) {
  const router = useRouter();
  const [v, setV] = useState(initial);
  const [pending, start] = useTransition();
  const [phone, setPhone] = useState("");
  const [error, setError] = useState<string | null>(null);
  const key = useRef<string>("");

  useEffect(() => {
    if (v.status === "PAID") return;
    const late = v.status !== "PENDING", since = Date.now();
    let stopped = false, timer: ReturnType<typeof setTimeout> | undefined;
    const tick = async () => {
      const r = await payStatusAction({ token: v.token }).catch(() => null);
      if (stopped) return;
      if (r?.ok && r.data.status !== v.status) { setV(r.data); return; }
      if (late && Date.now() - since > LATE_FOR_MS) return;
      timer = setTimeout(tick, late ? LATE_POLL_MS : POLL_MS);
    };
    timer = setTimeout(tick, late ? LATE_POLL_MS : POLL_MS);
    return () => { stopped = true; if (timer) clearTimeout(timer); };
  }, [v.status, v.token]);

  // "I have paid": ask nTZS again now.
  const recheck = () => start(async () => {
    setError(null);
    const r = await payStatusAction({ token: v.token });
    if (!r.ok) { setError(r.error); return; }
    setV(r.data);
    if (r.data.status !== "PAID") setError("Not received yet. If money left your account, it shows here by itself within a few minutes.");
  });

  const retry = () => start(async () => {
    setError(null);
    key.current ||= crypto.randomUUID();
    const r = await retryPayAction({ token: v.token, phone: phone.trim() || undefined, clientKey: key.current });
    if (!r.ok) { setError(r.error); key.current = ""; return; }
    // The last attempt went through after all: the same page, now paid.
    if (r.data.token === v.token) { const s = await payStatusAction({ token: v.token }); if (s.ok) setV(s.data); return; }
    router.replace(`/pay/${r.data.token}`);
  });
  const cancel = () => start(async () => {
    await cancelPayAction({ token: v.token });
    const r = await payStatusAction({ token: v.token });
    if (r.ok) setV(r.data);
  });

  const paid = v.status === "PAID";
  const waiting = v.status === "PENDING";
  return (
    <section className="mt-2 overflow-hidden rounded-3xl bg-(--vr-card) shadow-[0_18px_40px_-28px_rgba(0,0,0,0.5)] ring-1 ring-(--vr-line)">
      <div className={cn("px-5 pb-5 pt-6 text-center", paid ? "bg-emerald-50" : waiting ? "" : "bg-rose-50/60")}>
        <span className={cn("mx-auto grid size-16 place-items-center rounded-full", paid ? "bg-emerald-500 text-white" : waiting ? "bg-(--vr-gold-soft) text-(--vr-gold-ink)" : "bg-rose-100 text-rose-600")}>
          {paid ? <Check className="size-8" strokeWidth={3} /> : waiting ? <Smartphone className="size-7" /> : <X className="size-8" />}
        </span>
        <h1 className="mt-4 font-display text-[26px] font-semibold leading-tight">
          {paid ? "Payment successful" : waiting ? "Approve on your phone" : "Payment not completed"}
        </h1>
        <p className="mt-1 text-[28px] font-bold tabular-nums">{tzs(v.amount)}</p>
        <p className="text-sm text-(--vr-muted)">{v.what}</p>
      </div>

      <div className="space-y-4 px-5 py-5">
        {waiting && (
          <>
            <ol className="space-y-2.5 text-[14px]">
              <li className="flex gap-3"><Step n={1} />A payment request was sent to <strong className="tabular-nums">{v.phone}</strong>.</li>
              <li className="flex gap-3"><Step n={2} />Open it on your phone and enter your mobile-money PIN.</li>
              <li className="flex gap-3"><Step n={3} />This page confirms by itself — you can leave it open.</li>
            </ol>
            <p className="flex items-center justify-center gap-2 rounded-2xl bg-(--vr-bg) px-3 py-2.5 text-[13px] text-(--vr-muted)"><Loader2 className="size-4 animate-spin" />Waiting for your approval…</p>
            <button type="button" onClick={cancel} disabled={pending} className="w-full text-center text-[13px] font-medium text-(--vr-muted) underline-offset-4 hover:underline">Cancel — I will pay another way</button>
          </>
        )}
        {paid && (
          <>
            <dl className="divide-y divide-(--vr-line) rounded-2xl ring-1 ring-(--vr-line)">
              <Row k="Amount" v={tzs(v.amount)} />
              <Row k="For" v={v.what} />
              <Row k="Paid" v={v.paidAt ? new Date(v.paidAt).toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—"} />
              <Row k="Reference" v={v.reference} mono />
              <Row k="Method" v="Mobile money · online" />
            </dl>
            <div className="grid gap-2">
              {v.back && <Link href={v.back.href} className="flex h-12 items-center justify-center rounded-full bg-(--vr-dark) text-[15px] font-semibold text-white">{v.back.label}</Link>}
              {v.receipt && <Link href={v.receipt} className="flex h-11 items-center justify-center gap-2 rounded-full ring-1 ring-(--vr-line) text-[14px] font-medium"><Receipt className="size-4" />Receipt</Link>}
            </div>
          </>
        )}
        {v.canRetry && (
          <>
            <p className="text-center text-[14px] text-(--vr-muted)">{v.message} If you approved it and money left your account, it shows here by itself — otherwise try again.</p>
            <button type="button" onClick={recheck} disabled={pending} className="flex h-11 w-full items-center justify-center gap-2 rounded-full text-[14px] font-medium ring-1 ring-(--vr-line) disabled:opacity-60">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <Check className="size-4" />}I have paid — check again
            </button>
            <label className="block text-[12.5px] font-medium text-(--vr-ink)/80">Mobile-money number <span className="font-normal text-(--vr-muted)">· {v.phone} if left empty</span>
              <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" placeholder="0712 345 678"
                className="mt-1 block h-12 w-full rounded-xl border border-(--vr-line) bg-white px-3.5 text-[16px] outline-none focus:border-(--vr-gold) focus:ring-4 focus:ring-(--vr-gold)/15" />
            </label>
            {error && <p className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-700">{error}</p>}
            <button type="button" onClick={retry} disabled={pending} className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-(--vr-dark) text-[15px] font-semibold text-white disabled:opacity-60">
              {pending ? <Loader2 className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}Try again · {tzs(v.amount)}
            </button>
            {v.back && <Link href={v.back.href} className="block text-center text-[13px] font-medium text-(--vr-muted) underline-offset-4 hover:underline">{v.back.label}</Link>}
          </>
        )}
      </div>
      <div className="space-y-2 border-t border-(--vr-line) bg-(--vr-bg) px-4 py-3">
        <NetworkMarks center label={null} />
        <p className="flex items-center justify-center gap-1.5 text-[11.5px] text-(--vr-muted)"><Lock className="size-3.5" />Secure payment powered by <span className="font-semibold tracking-wide text-(--vr-ink)/80">NTZS</span></p>
      </div>
    </section>
  );
}

function Step({ n }: { n: number }) {
  return <span className="grid size-6 shrink-0 place-items-center rounded-full bg-(--vr-dark) text-[12px] font-bold text-white">{n}</span>;
}
function Row({ k, v, mono }: { k: string; v: string; mono?: boolean }) {
  return <div className="flex items-baseline justify-between gap-3 px-4 py-2.5 text-[14px]"><dt className="text-(--vr-muted)">{k}</dt><dd className={cn("text-right font-medium", mono && "font-mono text-[13px]")}>{v}</dd></div>;
}
