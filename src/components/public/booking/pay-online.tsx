"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LoaderCircle, ShieldCheck, Smartphone } from "lucide-react";
import { payBookingOnlineAction } from "@/app/(public)/booking/[reference]/actions";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ArrowBadge } from "../pill-link";
import { pillGold } from "../ui";

const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("");
const phoneOk = (p: string) => /^(?:\+?255|0)?[67]\d{8}$/.test(p.replace(/[\s-]/g, ""));

/**
 * PAY ONLINE on the booking's private page: what is still owed, from the guest's phone (nTZS) — the amount is worked
 * out on the server. A payment already on its way is opened again rather than asked twice.
 */
export function BookingPayOnline({ reference, token, due, phone, live, held }: {
  reference: string; token: string; due: number; phone: string;
  /** The payment page of a payment on its way now. */
  live: string | null;
  /** "15:40" — the room is held until then (a booking made while paying online). */
  held?: string | null;
}) {
  const router = useRouter();
  const [number, setNumber] = useState(phone);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const key = useRef("");

  if (live) {
    return (
      <Link href={`/pay/${live}`} className="flex items-center gap-3 rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10 transition hover:ring-gold/50">
        <LoaderCircle className="size-5 shrink-0 animate-spin text-gold" aria-hidden="true" />
        <span className="min-w-0 flex-1 text-sm leading-tight"><span className="block font-medium">Your payment is on its way</span><span className="text-white/60">Approve it on your phone — tap to follow it</span></span>
        <span className="text-xs font-medium text-gold">Open</span>
      </Link>
    );
  }

  const pay = () => start(async () => {
    setError(null);
    if (!phoneOk(number)) { setError("Enter your mobile-money number, e.g. 0712 345 678."); return; }
    key.current ||= newKey();
    const r = await payBookingOnlineAction({ reference, token, phone: number.trim(), clientKey: key.current });
    if (!r.ok) { setError(r.error); key.current = ""; return; }
    router.push(`/pay/${r.data.pay}`);
  });

  return (
    <div className="space-y-3 rounded-2xl bg-white/[0.06] p-4 ring-1 ring-white/10">
      <p className="flex items-center gap-2 text-sm font-medium"><Smartphone className="size-4 text-gold" aria-hidden="true" />Pay online</p>
      {held && <p className="text-xs text-white/65">We hold your room until {held} — pay now to confirm it.</p>}
      <label className="block">
        <span className="mb-1.5 block text-[11px] font-medium uppercase tracking-[0.18em] text-white/60">Mobile-money number</span>
        <input value={number} onChange={(e) => setNumber(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="e.g. 0712 345 678"
          aria-invalid={number !== "" && !phoneOk(number)}
          className="block h-12 w-full rounded-xl border border-white/15 bg-white/[0.07] px-4 text-base text-white placeholder:text-white/35 transition-colors focus:border-gold/70 focus:outline-none focus:ring-3 focus:ring-gold/30 aria-invalid:border-amber-400" />
      </label>
      {error && <p role="alert" className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-900">{error}</p>}
      <button type="button" onClick={pay} disabled={pending} className={cn(pillGold, "h-12 w-full justify-between py-1.5 pl-6 pr-1.5")}>
        <span className="relative inline-flex items-center gap-2">
          {pending ? <LoaderCircle className="size-4 animate-spin" aria-hidden="true" /> : <Smartphone className="size-4" aria-hidden="true" />}Pay {formatTZS(due)}
        </span>
        <ArrowBadge />
      </button>
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-white/55"><ShieldCheck className="size-3.5 text-gold" aria-hidden="true" />Secure payment powered by NTZS</p>
    </div>
  );
}
