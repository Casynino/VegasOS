import { shimmer } from "@/components/public/booking/results-skeleton";
import { Section } from "@/components/public/kit";
import fx from "@/components/public/room-fx.module.css";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";

// On the night band the sweep stays faint.
const night = cn(shimmer, "after:opacity-20");

/**
 * While a /book step loads: the same night band and console work area as the page (no jump),
 * with neutral placeholders that suit every step — the HUD progress line and a console card.
 */
export default async function BookLoading() {
  const t = await getT();
  return (
    <div className="flex flex-1 flex-col" role="status" aria-live="polite">
      <span className="sr-only">{t("Loading your booking…")}</span>
      <Section tone="night" first space="sm" width="wide" glow="top" stars className="pb-10 sm:pb-12 lg:pb-12">
        <div className="space-y-4" aria-hidden="true">
          <div className={cn(night, "h-3 w-28 rounded-sm")} />
          <div className={cn(night, "h-10 w-72 max-w-full rounded-sm sm:h-14 sm:w-[28rem]")} />
          <div className={cn(night, "h-4 w-full max-w-md rounded-sm")} />
        </div>
      </Section>
      <Section as="div" space="sm" width="wide" atmosphere="calm" pattern="grid" className="flex-1 pb-20 sm:pb-24 lg:pb-28">
        <div aria-hidden="true">
          <div className={cn(shimmer, "h-3 w-40 rounded-sm lg:hidden")} />
          <div className="mt-4 grid grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:mt-0">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="flex items-center">
                <span className="size-7 shrink-0 rounded-full border border-pub-line sm:size-8" />
                {i < 4 && <span className="mx-1.5 h-px flex-1 bg-pub-line sm:mx-2.5" />}
              </div>
            ))}
          </div>
          <div className={cn(fx.card, "relative mt-8 max-w-4xl p-5 sm:p-7 lg:mt-12")}>
            <div className={cn(shimmer, "mb-6 h-3 w-36 rounded-sm")} />
            <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-4 sm:gap-x-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <div className={cn(shimmer, "h-2.5 w-16 rounded-sm")} />
                  <div className={cn(shimmer, "h-12 rounded-[0.625rem]")} />
                </div>
              ))}
              <div className={cn(shimmer, "col-span-2 h-10 rounded-full sm:col-start-3")} />
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
