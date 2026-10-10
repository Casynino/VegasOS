"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgePercent, Loader2, X } from "lucide-react";
import { changeDiscountAction } from "@/app/staff/(app)/reservations/actions";
import { DESK_DISCOUNT_CHOICES, DESK_DISCOUNT_MAX, MANAGER_DISCOUNT_CHOICES } from "@/lib/discounts";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

const REASONS = [msg("Long stay"), msg("Returning guest"), msg("Paid in advance"), msg("Corporate / group"), msg("Walk-in offer")];

/**
 * The discount buttons used everywhere (booking, walk-in, check-in, add nights,
 * checkout): No discount · 10k · 20k, plus bigger amounts for managers and an
 * "Other" box. `max` is the most this user may give per night (null = no limit).
 */
export function DiscountChips({ value, onChange, rate, max, current, usual, size = "sm" }: {
  value: number; onChange: (perNight: number) => void; rate: number; max: number | null;
  /** Discount the stay has now (marked "now"). */ current?: number;
  /** The hotel's standard discount (marked "usual"). */ usual?: number;
  size?: "sm" | "xs";
}) {
  const t = useT();
  const [other, setOther] = useState("");
  const choices = ([...DESK_DISCOUNT_CHOICES, ...(max == null ? MANAGER_DISCOUNT_CHOICES : [])] as number[]).filter((v) => v < rate && (max == null || v <= max));
  const onChip = (choices as number[]).includes(value);
  const chip = cn("rounded-full border font-medium tabular-nums transition-colors", size === "xs" ? "px-2.5 py-0.5 text-[11px]" : "px-3 py-1 text-xs");
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-1.5">
        {choices.map((v) => (
          <button key={v} type="button" aria-pressed={value === v} onClick={() => { setOther(""); onChange(v); }}
            className={cn(chip, value === v ? "border-emerald-600 bg-emerald-600 text-white" : "border-border bg-card hover:bg-muted")}>
            {v === 0 ? t("No discount") : t("{n}k off", { n: (v / 1000).toLocaleString("en-US") })}
            {v > 0 && v === current ? <span className="ml-1 opacity-75">· {t("now")}</span> : v > 0 && v === usual ? <span className="ml-1 opacity-75">· {t("usual")}</span> : null}
          </button>
        ))}
        <Input aria-label={t("Other discount per night")} type="number" min={0} max={max ?? rate} step={1000} placeholder={t("Other")}
          value={other || (!onChip && value > 0 ? String(value) : "")}
          onChange={(e) => {
            setOther(e.target.value);
            onChange(Math.max(0, Math.min(max ?? rate, rate, Math.round(Number(e.target.value) || 0))));
          }}
          className={cn("w-24 rounded-full bg-card px-3", size === "xs" ? "h-6 text-[11px]" : "h-7 text-xs")} />
      </div>
      {max != null && <p className="text-[11px] text-muted-foreground">{t("Most {amount} off per night.", { amount: formatTZS(max) })}</p>}
    </div>
  );
}

/**
 * Give (or change / remove) a room discount on an open stay. The server
 * recalculates the price, balance and folio, and logs who gave it and why.
 */
export function DiscountEditor({ reservationId, room, canEdit, defaultOpen = false, onSaved, max = DESK_DISCOUNT_MAX }: {
  reservationId: string;
  room: { id: string; number: string; ratePerNight: number; discountPerNight: number; nights: number };
  canEdit: boolean;
  defaultOpen?: boolean;
  onSaved?: () => void;
  /** Most this user may give per night; null = no desk limit (manager). */
  max?: number | null;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(defaultOpen);
  const [value, setValue] = useState(room.discountPerNight);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const nights = Math.max(1, room.nights);
  const newNight = room.ratePerNight - value;
  const changed = value !== room.discountPerNight;

  function save() {
    start(async () => {
      const res = await changeDiscountAction({ reservationId, reservationRoomId: room.id, discountPerNight: value, reason });
      if (res.ok) {
        toast.success(value ? t("Discount saved — {amount} off per night.", { amount: formatTZS(value) }) : t("Discount removed."));
        setOpen(false); setReason(""); router.refresh(); onSaved?.();
      } else toast.error(res.error, { duration: 9000 });
    });
  }

  const current = room.discountPerNight > 0
    ? t.rich("Discount <b>{amount}/night</b> · {total} off", { b: (c) => <strong className="text-emerald-600 dark:text-emerald-400">{c}</strong> }, { amount: formatTZS(room.discountPerNight), total: formatTZS(room.discountPerNight * nights) })
    : t("No discount · {amount}/night", { amount: formatTZS(room.ratePerNight) });

  if (!open) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">{current}</span>
        {canEdit && (
          <button type="button" onClick={() => { setValue(room.discountPerNight); setOpen(true); }} className="inline-flex items-center gap-1 rounded-full border border-emerald-500/40 px-3 py-1 font-semibold text-emerald-700 transition-colors hover:bg-emerald-500/10 dark:text-emerald-300">
            <BadgePercent className="size-3.5" />{room.discountPerNight > 0 ? t("Change discount") : t("Give discount")}
          </button>
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-3">
      <div className="flex items-center justify-between">
        <p className="flex items-center gap-1.5 text-sm font-semibold"><BadgePercent className="size-4 text-emerald-600" />{t("Discount · Room {room}", { room: room.number })}</p>
        <button type="button" aria-label={t("Close")} onClick={() => setOpen(false)} className="rounded-full p-1 text-muted-foreground hover:bg-muted"><X className="size-4" /></button>
      </div>

      <DiscountChips value={value} onChange={setValue} rate={room.ratePerNight} max={max} current={room.discountPerNight} />

      <p className="rounded-xl bg-card px-3 py-2 text-sm">
        {t.rich("<b>{amount}/night</b> · room total <b>{total}</b>", { b: (c) => <strong>{c}</strong> }, { amount: formatTZS(newNight), total: formatTZS(newNight * nights) })}
        {changed && <span className="text-muted-foreground"> {t("(was {amount})", { amount: formatTZS((room.ratePerNight - room.discountPerNight) * nights) })}</span>}
      </p>

      {changed && (
        <div className="flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setReason(reason === r ? "" : r)} className={cn("rounded-full border px-2.5 py-0.5 text-[11px]", reason === r ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted")}>{t(r)}</button>
          ))}
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Reason (optional)")} className="h-7 min-w-40 flex-1 rounded-full bg-card px-3 text-xs" />
        </div>
      )}

      <Button className="w-full" disabled={pending || !changed} onClick={save}>
        {pending && <Loader2 className="animate-spin" />}{value === 0 && room.discountPerNight > 0 ? t("Remove discount") : t("Save discount")}
      </Button>
    </div>
  );
}
