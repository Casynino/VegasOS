import { getT } from "@/i18n/server";
import { cn } from "@/lib/utils";
import fx from "../room-fx.module.css";

/** A quiet shimmer block that follows the tone (and is softer in the dark theme). */
export const shimmer = "vlh-shimmer bg-pub-fg/[0.07] after:opacity-60 pub-dark:after:opacity-15";

/** Shimmer placeholder while live availability is loading — the shape of the result cards. */
export async function ResultsSkeleton({ rows = 3 }: { rows?: number }) {
  const t = await getT();
  return (
    <div role="status" aria-live="polite">
      <span className="sr-only">{t("Checking live availability…")}</span>
      <div className="flex items-center gap-3 border-b border-pub-line pb-4" aria-hidden="true">
        <span className="pub-live-dot relative inline-block size-1.5 rounded-full bg-gold after:absolute after:inset-0 after:rounded-full after:bg-gold" />
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-pub-muted sm:text-[11px]">{t("Checking live availability")}</span>
      </div>
      <div className="mt-6 space-y-5 sm:mt-8 sm:space-y-6">
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className={cn(fx.card, "relative grid gap-5 p-3 sm:gap-6 sm:p-4 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-8 lg:p-5")}>
            <div className={cn(shimmer, "aspect-[16/9] rounded-[0.375rem] sm:aspect-[3/2] lg:aspect-[4/3]")} />
            <div className="flex flex-col gap-4 px-1.5 pb-1.5 md:py-2">
              <div className={cn(shimmer, "h-8 w-1/2 rounded-sm")} />
              <div className={cn(shimmer, "h-3 w-2/3 rounded-sm")} />
              <div className={cn(shimmer, "h-4 w-5/6 rounded-sm")} />
              <div className="mt-auto flex items-end justify-between gap-4 border-t border-dashed border-pub-line pt-5">
                <div className={cn(shimmer, "h-9 w-36 rounded-sm")} />
                <div className={cn(shimmer, "h-10 w-36 rounded-full")} />
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
