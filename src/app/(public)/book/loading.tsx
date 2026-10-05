import { shimmer } from "@/components/public/booking/results-skeleton";
import { Section } from "@/components/public/kit";
import { cn } from "@/lib/utils";

// On the night band the sweep stays faint.
const night = cn(shimmer, "after:opacity-20");

/**
 * While a /book step loads: the same night band and paper work area as the page (no jump),
 * with neutral placeholders that suit every step — the progress line and a form-shaped block.
 */
export default function BookLoading() {
  return (
    <div className="flex flex-1 flex-col" role="status" aria-live="polite">
      <span className="sr-only">Loading your booking…</span>
      <Section tone="night" first space="sm" width="wide" glow="top" className="pb-10 sm:pb-12 lg:pb-12">
        <div className="space-y-4" aria-hidden="true">
          <div className={cn(night, "h-3 w-28 rounded-sm")} />
          <div className={cn(night, "h-10 w-72 max-w-full rounded-sm sm:h-14 sm:w-[28rem]")} />
          <div className={cn(night, "h-4 w-full max-w-md rounded-sm")} />
        </div>
      </Section>
      <Section as="div" space="sm" width="wide" className="flex-1 pb-20 sm:pb-24 lg:pb-24">
        <div aria-hidden="true">
          <div className={cn(shimmer, "h-3 w-40 rounded-sm")} />
          <div className="mt-3 grid grid-cols-5 gap-1.5 sm:gap-2">
            {[0, 1, 2, 3, 4].map((i) => (
              <div key={i} className="h-[3px] rounded-full bg-pub-line" />
            ))}
          </div>
          <div className="mt-8 max-w-4xl rounded-[1rem] border border-pub-line p-5 sm:p-7 lg:mt-10">
            <div className="grid grid-cols-2 gap-x-3 gap-y-5 sm:grid-cols-4 sm:gap-x-4">
              {[0, 1, 2, 3].map((i) => (
                <div key={i} className="space-y-2">
                  <div className={cn(shimmer, "h-2.5 w-16 rounded-sm")} />
                  <div className={cn(shimmer, "h-12 rounded-[0.625rem]")} />
                </div>
              ))}
              <div className={cn(shimmer, "col-span-2 h-12 rounded-full sm:col-start-3")} />
            </div>
          </div>
        </div>
      </Section>
    </div>
  );
}
