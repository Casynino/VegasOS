"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Loader2, ShieldCheck, Smartphone } from "lucide-react";
import type { ActionResult } from "@/server/errors";
import { cn } from "@/lib/utils";
import { NetworkMarks } from "@/components/payments/networks";
import { useT } from "@/i18n/client";

const tzs = (v: number) => `TZS ${v.toLocaleString("en-US")}`;
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("");
const phoneOk = (p: string) => /^(?:\+?255|0)?[67]\d{8}$/.test(p.replace(/[\s-]/g, ""));

/**
 * PAY ONLINE above the guest's bill (stay link, room QR card): what they owe, from their phone (nTZS) — the amount is
 * worked out on the server. A payment already on its way is opened again rather than asked twice.
 */
export function BillPayOnline({ due, live, action, bare = false }: {
  due: number;
  /** The payment page of a payment on its way now. */
  live: string | null;
  action: (input: { phone: string; clientKey: string }) => Promise<ActionResult<{ pay: string }>>;
  /** Inside a sheet that has its own title and card: the form only, without its card and "Pay your bill now" row. */
  bare?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [number, setNumber] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const key = useRef("");

  if (live) {
    return (
      <Link href={`/pay/${live}`} className="flex items-center gap-3 rounded-2xl bg-[#1d1712] p-4 font-sans text-white print:hidden">
        <Loader2 className="size-5 shrink-0 animate-spin text-[#d8b26a]" />
        <span className="min-w-0 flex-1 text-sm leading-tight"><span className="block font-semibold">{t("Your payment is on its way")}</span><span className="text-white/65">{t("Approve it on your phone — tap to follow it")}</span></span>
        <span className="text-xs font-semibold text-[#d8b26a]">{t("Open")}</span>
      </Link>
    );
  }

  const pay = () => start(async () => {
    setError(null);
    if (!phoneOk(number)) { setError(t("Enter your mobile-money number, e.g. {example}.", { example: "0712 345 678" })); return; }
    key.current ||= newKey();
    const r = await action({ phone: number.trim(), clientKey: key.current });
    if (!r.ok) { setError(r.error); key.current = ""; return; }
    router.push(`/pay/${r.data.pay}`);
  });

  return (
    <section className={cn("space-y-3 font-sans print:hidden", !bare && "rounded-2xl bg-white p-4 shadow-sm ring-1 ring-black/5")}>
      {!bare && (
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-[15px] font-semibold"><Smartphone className="size-4 text-[#9a7428]" />{t("Pay your bill now")}</p>
          <p className="text-[15px] font-semibold tabular-nums">{tzs(due)}</p>
        </div>
      )}
      <label className="block text-[12.5px] font-medium text-black/70">{t("Mobile-money number")}
        <input value={number} onChange={(e) => setNumber(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder={t("e.g. {example}", { example: "0712 345 678" })}
          className={cn("mt-1 block h-11 w-full rounded-xl border border-black/15 bg-white px-3.5 text-[16px] outline-none transition placeholder:text-black/35 focus:border-[#b8913e] focus:ring-4 focus:ring-[#b8913e]/15 sm:text-[14px]", number && !phoneOk(number) && "border-amber-400")} />
      </label>
      {error && <p role="alert" className="rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-800 ring-1 ring-rose-200">{error}</p>}
      <button type="button" onClick={pay} disabled={pending}
        className="flex h-12 w-full items-center justify-center gap-2 rounded-full bg-[#1d1712] text-[14.5px] font-semibold text-white transition hover:bg-black disabled:opacity-60">
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Smartphone className="size-4" />}{t("Pay {amount} now", { amount: tzs(due) })}
      </button>
      <NetworkMarks center />
      <p className="text-center text-[11.5px] text-black/55">{t("You will get a payment request on your phone — enter your PIN to pay.")}</p>
      <p className="flex items-center justify-center gap-1.5 text-[11px] font-medium text-black/50"><ShieldCheck className="size-3.5 text-[#9a7428]" />{t("Secure payment powered by NTZS")}</p>
    </section>
  );
}
