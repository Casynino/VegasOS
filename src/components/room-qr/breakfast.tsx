"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ChevronRight, Coffee } from "lucide-react";
import type { BreakfastNow } from "@/lib/breakfast";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { SheetHead } from "./parts";

/**
 * The stay's complimentary breakfast as the guest's page shows it — worked out on the server from the hotel's breakfast
 * schedule (Settings) and the hotel's own clock. Only there when this stay really comes with breakfast.
 */
export type BreakfastInfo = {
  /** "6:00 AM – 10:30 AM", "6:00 AM", "10:30 AM" — written for the guest's language. */
  hours: string; start: string; end: string;
  /** "Every day", or the serving days by name. */
  days: string; everyDay: boolean;
  /** Where today's breakfast stands (only while the guest is staying). */
  now: BreakfastNow | null;
  /** When that can change — the page asks the server again then (never the phone's clock). */
  changesInMs: number;
  /** Only what the hotel has written in Settings — nothing is made up. */
  location: string | null; note: string | null;
};

/** The few words about today, in hotel time. */
function useToday(b: BreakfastInfo) {
  const t = useT();
  return b.now === "NOW" ? t("Being served now, until {time}", { time: b.end })
    : b.now === "LATER" ? t("Served today from {time}", { time: b.start })
    : b.now === "FINISHED" ? (b.everyDay ? t("Finished for today — back tomorrow from {time}", { time: b.start }) : t("Finished for today"))
    : b.now === "NOT_TODAY" ? t("Not served today")
    : null;
}

/**
 * Breakfast on the guest's room page: one slim line under the quick links — included, and when. A tap opens the
 * rest. Kept small on purpose so the bill stays right below (owner, 2026-10-11).
 */
export function BreakfastCard({ breakfast: b, onMore, className }: { breakfast: BreakfastInfo; onMore: () => void; className?: string }) {
  const t = useT();
  const router = useRouter();
  const serving = b.now === "NOW";
  // "Being served now" comes from the server: ask again when the serving window opens or closes.
  useEffect(() => {
    if (b.now === null) return;
    const id = window.setTimeout(() => router.refresh(), b.changesInMs + 5_000);
    return () => window.clearTimeout(id);
  }, [b.now, b.changesInMs, router]);

  return (
    <button type="button" id="breakfast" onClick={onMore} className={cn("flex min-h-14 w-full scroll-mt-3 items-center gap-3 rounded-2xl bg-(--vr-card) px-3 py-2 text-left ring-1 ring-(--vr-line) transition active:scale-[0.99]", className)}>
      <span aria-hidden className="grid size-9 shrink-0 place-items-center rounded-full bg-(--vr-gold-soft) text-(--vr-gold-ink)"><Coffee className="size-[17px]" /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[13.5px] font-semibold leading-tight">{t("Your breakfast is on us")}</span>
        <span className={cn("mt-0.5 flex items-center gap-1.5 text-[12px] leading-tight text-(--vr-muted)", serving && "text-emerald-700")}>
          {serving && <span className="size-1.5 shrink-0 rounded-full bg-emerald-500 motion-safe:animate-[vlh-glow_2.4s_ease-in-out_infinite]" />}
          <span className="truncate tabular-nums">{serving ? t("Being served now, until {time}", { time: b.end }) : <>{b.hours} · {b.days}</>}</span>
        </span>
      </span>
      <ChevronRight className="size-4 shrink-0 text-(--vr-muted)" />
    </button>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-3">
      <dt className="shrink-0 text-[13px] text-(--vr-muted)">{label}</dt>
      <dd className="min-w-0 text-right text-[14px] font-medium">{children}</dd>
    </div>
  );
}

/** Everything about breakfast in one sheet — the guest's guide to it. */
export function BreakfastPanel({ breakfast: b }: { breakfast: BreakfastInfo }) {
  const t = useT();
  const today = useToday(b);
  return (
    <>
      <SheetHead title={t("Breakfast")} text={t("Complimentary — it comes with your room stay.")} />
      <dl className="mt-4 divide-y divide-(--vr-line) border-y border-(--vr-line)">
        <Row label={t("Hours")}><span className="tabular-nums">{b.hours}</span></Row>
        <Row label={t("Days")}>{b.days}</Row>
        {today && <Row label={t("Today")}><span className={cn(b.now === "NOW" && "text-emerald-700")}>{today}</span></Row>}
        {b.location && <Row label={t("Where")}>{t(b.location)}</Row>}
        <Row label={t("Price")}>{t("Included — nothing to pay")}</Row>
      </dl>
      {b.note && <p className="mt-3 text-[13.5px] leading-snug">{t(b.note)}</p>}
      <p className="mt-3 text-[12.5px] leading-snug text-(--vr-muted)">{t("Other food and drinks from the menu are ordered and charged as usual.")}</p>
    </>
  );
}
