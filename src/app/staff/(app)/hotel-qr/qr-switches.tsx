"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowRight, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { setHotelQrSettingsAction } from "./actions";

export type QrSetupView = {
  bookingOn: boolean; payAtHotel: boolean; payOnline: boolean; onlinePaySwitchedOn: boolean; ntzsConnected: boolean;
  unpaidHoldHours: number; onlineHoldMinutes: number;
  /** Pay at the hotel only for stays up to maxNights, and (with no hold time) arrivals up to toArrivalMaxDays ahead. */
  holdLimits: { maxNights: number; toArrivalMaxDays: number };
};

/**
 * The Admin's switches for the Hotel QR — booking from the QR, and paying at the hotel — saved as soon as they are
 * flipped. Paying online follows the hotel's own online-payment switch (Finance → Online payments). Managers see
 * them without changing them.
 */
export function QrSwitches({ setup, canManage, canOpenFinance }: { setup: QrSetupView; canManage: boolean; canOpenFinance: boolean }) {
  const router = useRouter();
  const [state, setState] = useState({ enabled: setup.bookingOn, payAtHotel: setup.payAtHotel });
  const [saving, setSaving] = useState<"enabled" | "payAtHotel" | null>(null);
  const [, start] = useTransition();

  const flip = (key: "enabled" | "payAtHotel", value: boolean) => {
    const before = state;
    setState((s) => ({ ...s, [key]: value }));
    setSaving(key);
    start(async () => {
      const res = await setHotelQrSettingsAction({ [key]: value });
      setSaving(null);
      if (!res.ok) { setState(before); toast.error(res.error); return; }
      setState({ enabled: res.data.enabled, payAtHotel: res.data.payAtHotel });
      toast.success(key === "enabled"
        ? (value ? "Booking from the QR is on." : "Booking from the QR is off — the QR still shows the hotel, and guests are asked to call reception.")
        : (value ? "Guests may now reserve and pay at the hotel." : "Pay at the hotel is off — guests pay online to book."));
      router.refresh();
    });
  };

  // Said as it is: a held room is released when not paid in time — "pay when they arrive" only without a hold time.
  const h = setup.unpaidHoldHours;
  const lim = setup.holdLimits;
  const payAtHotelHint = h > 0
    ? `Guests may reserve now and pay later — the room is held for ${h} hour${h === 1 ? "" : "s"}, then released if not paid. Stays over ${lim.maxNights} nights, or when many rooms already wait for payment, pay now.`
    : `Guests may reserve now and pay when they arrive — the room is held until the arrival day's cut-off. Up to ${lim.toArrivalMaxDays} days ahead and ${lim.maxNights} nights; beyond that they pay now.`;
  const noWayToPay = state.enabled && !state.payAtHotel && !setup.payOnline;

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-border/70 rounded-2xl border border-border/70">
        <li className="px-3.5 py-3">
          <Toggle label="Booking from the QR" on={state.enabled} busy={saving === "enabled"} disabled={!canManage} onChange={(v) => flip("enabled", v)}
            hint={state.enabled ? "Guests can book a room from any working QR." : "Off: the QR still shows the hotel and its rooms, but guests are asked to call reception to book."} />
        </li>
        <li className="px-3.5 py-3">
          <Toggle label="Pay at the hotel" on={state.payAtHotel} busy={saving === "payAtHotel"} disabled={!canManage} onChange={(v) => flip("payAtHotel", v)}
            hint={payAtHotelHint} />
        </li>
        <li className="flex items-start justify-between gap-3 px-3.5 py-3">
          <span className="min-w-0 leading-tight">
            <span className="block text-sm font-medium">Pay online</span>
            <span className="text-xs text-muted-foreground">
              {!setup.ntzsConnected ? "NTZS is not connected yet."
                : setup.onlinePaySwitchedOn ? `Secure payment by NTZS. The room is held ${setup.onlineHoldMinutes} minutes while the guest pays; the booking is confirmed only when NTZS confirms the money.`
                  : "Switched off for room bookings in Online payments."}
            </span>
            {canOpenFinance && (
              <Link href="/staff/finance/online" className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[oklch(0.55_0.11_75)] hover:underline dark:text-[oklch(0.84_0.11_82)]">
                Change in Finance → Online payments<ArrowRight className="size-3" />
              </Link>
            )}
          </span>
          <span className={cn("mt-0.5 inline-flex shrink-0 items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] font-semibold", setup.payOnline ? "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>
            <span className={cn("size-1.5 rounded-full", setup.payOnline ? "bg-emerald-500" : "bg-muted-foreground")} />{setup.payOnline ? "On" : "Off"}
          </span>
        </li>
      </ul>
      {noWayToPay && (
        <p className="flex items-start gap-2 rounded-xl border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0" />No way to pay is on — guests cannot finish a booking. Switch on Pay at the hotel, or online payment for room bookings.
        </p>
      )}
      {!canManage && <p className="text-xs text-muted-foreground">Only the Admin changes these.</p>}
    </div>
  );
}

function Toggle({ label, hint, on, onChange, disabled, busy }: { label: string; hint: string; on: boolean; onChange: (v: boolean) => void; disabled?: boolean; busy?: boolean }) {
  return (
    <label className={cn("flex items-start justify-between gap-3", disabled ? "cursor-not-allowed" : "cursor-pointer")}>
      <span className="min-w-0 leading-tight">
        <span className="block text-sm font-medium">{label}</span>
        <span className="text-xs text-muted-foreground">{hint}</span>
      </span>
      <span className="mt-0.5 flex shrink-0 items-center gap-2">
        {busy && <Loader2 className="size-3.5 animate-spin text-muted-foreground" />}
        <button type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled || busy} onClick={() => onChange(!on)}
          className={cn("relative h-6 w-11 shrink-0 rounded-full p-0 transition-colors disabled:opacity-60", on ? "bg-emerald-600" : "bg-muted-foreground/30")}>
          <span className={cn("absolute left-0.5 top-0.5 size-5 rounded-full bg-white shadow transition-transform", on ? "translate-x-5" : "translate-x-0")} />
        </button>
      </span>
    </label>
  );
}
