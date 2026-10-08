"use client";

import { useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { ArrowRight, LoaderCircle, Lock, Smartphone } from "lucide-react";
import type { ActionResult } from "@/server/errors";
import { useT } from "@/i18n/client";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button, HudLabel, field, toneAttr } from "./kit";
import { NetworkMarks } from "@/components/payments/networks";

const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("");
const phoneOk = (p: string) => /^(?:\+?255|0)?[67]\d{8}$/.test(p.replace(/[\s-]/g, ""));

/**
 * PAY ONLINE on the website's private pages (a booking, a trip, an invoice): what is still owed, from the customer's
 * phone (nTZS); the amount is worked out on the server (`action` is bound to that page's link). A payment already on
 * its way is opened again rather than asked twice.
 * tone "night" (default) is a dark panel of its own, for dark surfaces; "inherit" follows the section it sits in.
 * `flush` drops the panel (no border, fill or padding) when it already sits inside one, e.g. an invoice receipt.
 */
export function PayOnlineCard({ due, phone, live, held, action, tone = "night", flush = false, className }: {
  due: number; phone: string;
  action: (input: { phone: string; clientKey: string }) => Promise<ActionResult<{ pay: string }>>;
  /** The payment page of a payment on its way now. */
  live: string | null;
  /** "15:40" — the room is held until then (a booking made while paying online). */
  held?: string | null;
  tone?: "night" | "inherit";
  flush?: boolean;
  className?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [number, setNumber] = useState(phone);
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const key = useRef("");
  const night = tone === "night";
  const toneProps = night ? toneAttr("night") : {};
  // A quiet panel with a gold hairline along its top edge (the site's HUD signature).
  const shell = cn(
    "relative rounded-[0.875rem] border border-pub-line text-pub-fg before:pointer-events-none before:absolute before:inset-x-[12%] before:-top-px before:h-px before:bg-linear-to-r before:from-transparent before:via-gold/70 before:to-transparent",
    night ? "bg-night-raised bg-[linear-gradient(160deg,rgb(255_255_255/0.05),transparent_45%)]" : "bg-pub-fg/[0.03]",
    className,
  );

  if (live) {
    return (
      <Link
        href={`/pay/${live}`}
        {...toneProps}
        className={cn(
          shell,
          "group flex min-h-16 items-center gap-3.5 p-4 transition-colors duration-200 hover:border-gold/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none",
        )}
      >
        <LoaderCircle className="size-5 shrink-0 text-pub-eyebrow motion-safe:animate-spin" aria-hidden="true" />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[15px] font-medium">{t("Your payment is on its way")}</span>
          <span className="mt-0.5 block text-[13px] text-pub-muted">{t("Approve it on your phone — tap to follow it")}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-1 text-[13px] font-medium text-pub-eyebrow">
          {t("Open")}
          <ArrowRight className="size-3.5 transition-transform duration-300 ease-pub group-hover:translate-x-0.5 motion-reduce:transition-none" strokeWidth={1.8} aria-hidden="true" />
        </span>
      </Link>
    );
  }

  const pay = () => start(async () => {
    setError(null);
    if (!phoneOk(number)) { setError(t("Enter your mobile-money number, e.g. 0712 345 678.")); return; }
    key.current ||= newKey();
    const r = await action({ phone: number.trim(), clientKey: key.current });
    if (!r.ok) { setError(r.error); key.current = ""; return; }
    router.push(`/pay/${r.data.pay}`);
  });

  return (
    <div {...toneProps} className={cn(flush ? cn("text-pub-fg", className) : cn(shell, "p-4 sm:p-5"), "space-y-4")}>
      <div>
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-2 text-[15px] font-medium">
            <Smartphone className="size-4 text-pub-eyebrow" strokeWidth={1.6} aria-hidden="true" />{t("Pay now")}
          </p>
          <HudLabel tick={false}>{t("Mobile money")}</HudLabel>
        </div>
        {held && <p className="mt-1.5 text-[13px] leading-relaxed text-pub-muted">{t("We hold your room until {time} — pay now to confirm it.", { time: held })}</p>}
      </div>
      <label className="block">
        <span className={field.label}>{t("Mobile-money number")}</span>
        <input
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          placeholder={t("e.g. 0712 345 678")}
          aria-invalid={number !== "" && !phoneOk(number)}
          className={cn(field.input, "tabular-nums")}
        />
      </label>
      {error && (
        <p role="alert" className="rounded-[0.625rem] border border-pub-error/30 bg-pub-error/[0.08] px-3 py-2.5 text-sm leading-snug text-pub-error">
          {error}
        </p>
      )}
      <Button onClick={pay} disabled={pending} full>
        <span className="inline-flex items-center gap-2 tabular-nums">
          {pending ? <LoaderCircle className="size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" /> : <Smartphone className="size-4 shrink-0" aria-hidden="true" />}
          {t("Pay {amount}", { amount: formatTZS(due) })}
        </span>
      </Button>
      <p className="text-[13px] leading-relaxed text-pub-muted">{t("You will get a payment request on your phone — enter your PIN to pay.")}</p>
      <div className="flex min-w-0 items-center gap-2">
        <span className="shrink-0 text-[10.5px] font-medium text-pub-muted">{t("Works with")}</span>
        <NetworkMarks label={null} className="min-w-0 flex-1" />
      </div>
      <p className="flex items-center gap-1.5 text-[11px] font-medium text-pub-muted">
        <Lock className="size-3 shrink-0 text-pub-eyebrow" aria-hidden="true" />{t.rich("Secure payment by <b>NTZS</b>", { b: (c) => <span className="font-semibold tracking-wide text-pub-fg">{c}</span> })}
      </p>
    </div>
  );
}
