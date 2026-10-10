"use client";

import { useState } from "react";
import Link from "next/link";
import { Building2, CalendarCheck, Check, CircleCheck, Loader2, Lock, Phone, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import { NetworkMarks } from "@/components/payments/networks";
import type { QrPayOptions } from "@/server/services/hotel-qr";
import { useT } from "@/i18n/client";
import { caps, card, darkButton, goldButton, input, lightButton } from "./ui";
import { dayShort, payPhoneOk, tzs, type LastBooking } from "./lib";

export type PayWay = "ONLINE" | "HOTEL";

/** "Secure payment by NTZS" — under every Pay now. */
export function SecureLine({ className }: { className?: string }) {
  const t = useT();
  return (
    <p className={cn("flex items-center justify-center gap-1.5 text-[11.5px] font-medium text-(--vr-muted)", className)}>
      <Lock className="size-3 shrink-0 text-(--vr-gold-ink)" />{t.rich("Secure payment by <b>NTZS</b>", { b: (c) => <span className="font-semibold tracking-wide text-(--vr-ink)/80">{c}</span> })}
    </p>
  );
}

/**
 * HOW TO PAY — "Pay now" first and chosen (a payment request to the guest's phone, nTZS: the room is held while they
 * pay and the booking is confirmed only when nTZS confirms the money); "Pay later" only when the hotel offers it: the
 * booking is saved but the room is NOT held until it is paid (owner, 2026-10-05) — said plainly. The request goes to
 * the phone typed above unless the guest gives another number. The amount is never sent from here.
 */
export function PayChoice({ pay, way, onWay, payPhone, onPayPhone, payError, samePhone }: {
  pay: QrPayOptions; way: PayWay; onWay: (w: PayWay) => void;
  payPhone: string; onPayPhone: (v: string | null) => void; payError: string | null;
  /** The request goes to the phone typed above (no other number given). */
  samePhone: boolean;
}) {
  const t = useT();
  const [other, setOther] = useState(!samePhone);
  const online = way === "ONLINE";
  const both = pay.online && pay.atHotel;
  return (
    <section aria-labelledby="pay-title">
      <h2 id="pay-title" className={caps}>{t("How to pay")}</h2>
      <div role="radiogroup" aria-labelledby="pay-title" className={cn(card, "mt-2 overflow-hidden")}>
        {pay.online && (
          <WayRow on={online} onSelect={() => onWay("ONLINE")} icon={Smartphone} title={t("Pay now")} sub={t("Mobile money · confirmed at once")} marks single={!both}>
            <div className="space-y-2.5">
              {!other && payPhoneOk(payPhone) ? (
                <p className="flex items-center justify-between gap-3 rounded-xl bg-(--vr-card) px-3.5 py-2.5 text-[13px] ring-1 ring-(--vr-line)">
                  <span className="min-w-0 leading-tight">
                    <span className="block text-[11.5px] text-(--vr-muted)">{t("Payment request to")}</span>
                    <span className="mt-0.5 block font-semibold tabular-nums">{payPhone}</span>
                  </span>
                  <button type="button" onClick={() => setOther(true)} className="shrink-0 text-[12.5px] font-semibold text-(--vr-gold-ink) hover:underline">{t("Change")}</button>
                </p>
              ) : (
                <div>
                  <label htmlFor="qr-pay-phone" className="text-[12px] font-medium text-(--vr-ink)/75">{t("Mobile-money number")}</label>
                  <span className="relative mt-1 block">
                    <Phone className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-(--vr-muted)" />
                    <input id="qr-pay-phone" value={payPhone} onChange={(e) => onPayPhone(e.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678"
                      aria-invalid={!!payError} className={cn(input, "pl-10 font-medium tabular-nums")} />
                    {payPhoneOk(payPhone) && <CircleCheck className="pointer-events-none absolute right-3.5 top-1/2 size-[18px] -translate-y-1/2 text-emerald-600" />}
                  </span>
                  {payError ? <p role="alert" className="mt-1 text-[12px] font-medium text-rose-700">{t(payError)}</p>
                    : <p className="mt-1 text-[11.5px] text-(--vr-muted)">{t("The payment request comes to this phone.")}</p>}
                </div>
              )}
              {payError && !other && <p role="alert" className="text-[12px] font-medium text-rose-700">{t(payError)}</p>}
              <p className="text-[12px] leading-snug text-(--vr-muted)">{t("Approve it on your phone with your PIN. We keep the room for {minutes} minutes while you pay.", { minutes: pay.onlineHoldMinutes })}</p>
            </div>
          </WayRow>
        )}
        {pay.atHotel && (
          // Said as it is: the booking is saved, but nothing is held until it is paid — whoever pays first gets the room.
          <WayRow on={!online} onSelect={() => onWay("HOTEL")} icon={Building2} title={t("Pay later")} sub={t("The room is not held until it is paid")} single={!both}>
            <p className="text-[12.5px] leading-snug text-(--vr-muted)">
              {t("We send you the booking. The room stays free for others until it is paid — pay any time from your booking to secure it.")}
            </p>
          </WayRow>
        )}
      </div>
    </section>
  );
}

function WayRow({ on, onSelect, icon: Icon, title, sub, marks, single, children }: {
  on: boolean; onSelect: () => void; icon: typeof Smartphone; title: string; sub: string; marks?: boolean; single?: boolean; children?: React.ReactNode;
}) {
  return (
    <div className={cn("border-b border-(--vr-line) transition-colors last:border-b-0", on && !single ? "bg-(--vr-gold-soft)/50" : !single && "hover:bg-(--vr-bg)/70")}>
      <button type="button" role="radio" aria-checked={on} onClick={onSelect} className="flex w-full items-center gap-3 px-4 py-3.5 text-left">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-full transition", on ? "bg-(--vr-dark) text-(--vr-gold)" : "bg-(--vr-bg) text-(--vr-gold-ink) ring-1 ring-(--vr-line)")}><Icon className="size-[18px]" /></span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="block text-[15px] font-semibold">{title}</span>
          <span className="mt-0.5 block text-[12.5px] text-(--vr-muted)">{sub}</span>
          {marks && <NetworkMarks label={null} compact className="mt-1.5" />}
        </span>
        {!single && (
          <span aria-hidden className={cn("grid size-[22px] shrink-0 place-items-center rounded-full border-2 transition", on ? "border-(--vr-dark) bg-(--vr-dark) text-white" : "border-(--vr-line) bg-white")}>
            {on && <Check className="size-3" strokeWidth={3.5} />}
          </span>
        )}
      </button>
      {on && children && <div className="px-4 pb-4 pl-[68px]">{children}</div>}
    </div>
  );
}

/**
 * The booking was just made in this tab (Back from the payment page lands here): what it is and where to go on —
 * finish paying, or the booking's own page. Never the form again.
 */
export function BookedView({ last, busy }: { last: LastBooking; busy: boolean }) {
  const t = useT();
  return (
    <div className="mx-auto grid min-h-[80svh] max-w-md place-items-center px-4 py-10">
      <div className={cn(card, "w-full overflow-hidden text-center")}>
        <div className="bg-(--vr-dark) px-5 pb-6 pt-7 text-white">
          <span className="mx-auto grid size-14 place-items-center rounded-full bg-(--vr-gold) text-(--vr-ink)"><CalendarCheck className="size-6" /></span>
          <p className={cn(caps, "mt-4 text-white/55")}>{t("Booking reference")}</p>
          <p className="mt-1 font-display text-[34px] font-semibold leading-none tracking-wide text-(--vr-gold)">{last.reference}</p>
          <p className="mt-2.5 text-[13px] text-white/70">{t("Room {number}", { number: last.room })} · {t(last.typeName)}</p>
          <p className="text-[13px] text-white/70">{dayShort(last.checkIn, t)} → {dayShort(last.checkOut, t)} · {tzs(last.total)}</p>
        </div>
        <div className="space-y-2 p-4">
          {busy ? (
            <p className="flex h-12 items-center justify-center gap-2 text-[14px] text-(--vr-muted)"><Loader2 className="size-4 animate-spin" />{last.payUrl ? t("Opening the payment…") : t("Opening your booking…")}</p>
          ) : (
            <>
              {last.payWay === "ONLINE" && last.payUrl && <Link href={last.payUrl} className={cn(goldButton, "h-12 w-full text-[14.5px]")}><Lock className="size-4" />{t("Continue to payment")}</Link>}
              <Link href={last.confirmUrl} className={cn(last.payWay === "ONLINE" && last.payUrl ? lightButton : darkButton, "h-12 w-full text-[14.5px]")}>{t("View booking")}</Link>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
