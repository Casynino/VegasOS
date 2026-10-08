"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, Smartphone } from "lucide-react";
import { payOrderOnlineAction } from "@/app/order/actions";
import { cn } from "@/lib/utils";
import { useWho } from "./who";
import { NetworkMarks } from "@/components/payments/networks";
import { useT } from "@/i18n/client";

const tzs = (v: number) => `TZS ${v.toLocaleString("en-US")}`;
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("");
const phoneOk = (p: string) => /^(?:\+?255|0)?[67]\d{8}$/.test(p.replace(/[\s-]/g, ""));

/**
 * PAY ONLINE on the order's own page: what is still due, paid from the customer's phone (nTZS) — the amount is worked
 * out on the server. A payment already on its way is opened again instead of asking twice.
 */
export function PayOrderOnline({ token, due, live, failed, waits }: {
  token: string; due: number;
  /** The payment page of a payment on its way now. */
  live: string | null;
  /** Ordered with Pay online, and the payment request did not start. */
  failed?: boolean;
  /** Take out: the order starts once it is paid. */
  waits?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [who] = useWho();
  const [phone, setPhone] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(failed ? t("The payment request did not go through — please try again.") : null);
  const [pending, start] = useTransition();
  const key = useRef("");
  const number = phone ?? who?.phone ?? "";

  if (live) {
    return (
      <Link href={`/pay/${live}`} className="mt-4 flex items-center gap-3 rounded-[24px] bg-(--vr-dark) p-4 text-white ring-1 ring-(--vr-dark)">
        <span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--vr-gold) text-(--vr-ink)"><Loader2 className="size-5 animate-spin" /></span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[15px] font-semibold">{t("Your payment is on its way")}</span>
          <span className="text-xs text-white/70">{t("Approve it on your phone — tap to follow it")}</span>
        </span>
        <span className="text-xs font-semibold text-(--vr-gold)">{t("Open")}</span>
      </Link>
    );
  }

  const pay = () => start(async () => {
    setError(null);
    if (!phoneOk(number)) { setError(t("Enter your mobile-money number, e.g. 0712 345 678.")); return; }
    key.current ||= newKey();
    const r = await payOrderOnlineAction({ token, phone: number.trim(), clientKey: key.current });
    if (!r.ok) { setError(r.error); key.current = ""; return; }
    router.push(`/pay/${r.data.pay}`);
  });

  return (
    <section className="mt-4 space-y-3 rounded-[28px] bg-(--vr-card) p-5 ring-1 ring-(--vr-line)">
      <div className="flex items-start justify-between gap-3">
        <div className="leading-tight">
          <h2 className="flex items-center gap-2 font-display text-2xl font-semibold"><Smartphone className="size-5 text-(--vr-gold-ink)" />{t("Pay now")}</h2>
          <p className="mt-1 text-xs text-(--vr-muted)">{waits ? t("We start your order once it is paid.") : t("Mobile money from your phone — no need to wait for the bill.")}</p>
        </div>
        <p className="shrink-0 text-lg font-semibold tabular-nums">{tzs(due)}</p>
      </div>
      <label className="block text-[12.5px] font-medium text-(--vr-ink)/80">{t("Mobile-money number")}
        <input value={number} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder={t("e.g. {example}", { example: "0712 345 678" })}
          className={cn("mt-1 block h-11 w-full rounded-xl border border-(--vr-line) bg-white px-3.5 text-[16px] outline-none transition placeholder:text-(--vr-muted)/70 focus:border-(--vr-gold) focus:ring-4 focus:ring-(--vr-gold)/15 sm:text-[14px]", number && !phoneOk(number) && "border-amber-400")} />
      </label>
      {error && <p role="alert" className="rounded-xl bg-rose-50 px-3.5 py-2.5 text-[13px] text-rose-800 ring-1 ring-rose-200">{error}</p>}
      <button type="button" onClick={pay} disabled={pending}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-(--vr-dark) text-[14.5px] font-semibold text-white transition hover:bg-black disabled:opacity-60">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}{t("Pay {amount} now", { amount: tzs(due) })}
      </button>
      <NetworkMarks center />
      <p className="text-center text-[11.5px] leading-snug text-(--vr-muted)">{t("You will get a payment request on your phone — enter your PIN to pay.")}</p>
      <p className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-(--vr-muted)"><ShieldCheck className="size-3.5 text-(--vr-gold-ink)" />{t("Secure payment powered by NTZS")}</p>
    </section>
  );
}
