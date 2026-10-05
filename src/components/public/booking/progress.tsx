import { cn } from "@/lib/utils";
import { typeScale } from "../kit/tokens";

export const BOOKING_STEPS = ["Dates & guests", "Choose room", "Details & arrival", "Review", "Request sent"] as const;

/**
 * 5-step booking progress: one quiet line ("Step 2 of 5 · Choose room") over five hairline
 * segments that fill in gold; the step names show under the segments on desktop.
 * `current` is 1-based. `last` renames the final step (a booking that is made, not just
 * requested, ends on "Booked"). Follows the surrounding tone.
 */
export function BookingProgress({ current, last, className }: { current: 1 | 2 | 3 | 4 | 5; last?: string; className?: string }) {
  const steps: readonly string[] = last ? [...BOOKING_STEPS.slice(0, -1), last] : BOOKING_STEPS;
  return (
    <nav aria-label="Booking progress" className={className}>
      <p className={cn(typeScale.meta, "text-pub-muted lg:sr-only")}>
        Step {current} of {steps.length} · <span className="text-pub-fg">{steps[current - 1]}</span>
      </p>
      <ol className="mt-3 grid grid-cols-5 gap-1.5 sm:gap-2 lg:mt-0">
        {steps.map((label, i) => {
          const n = i + 1;
          const done = n < current;
          const active = n === current;
          return (
            <li key={label} className="min-w-0" aria-current={active ? "step" : undefined}>
              <span aria-hidden="true" className="block h-[3px] overflow-hidden rounded-full bg-pub-line">
                <span
                  className={cn(
                    "block h-full origin-left rounded-full bg-gold transition-transform duration-700 ease-pub motion-reduce:transition-none",
                    done ? "scale-x-100 opacity-60" : active ? "scale-x-100" : "scale-x-0",
                  )}
                />
              </span>
              <span aria-hidden="true" className={cn(typeScale.meta, "mt-2.5 hidden truncate lg:block", active ? "text-pub-fg" : "text-pub-muted")}>
                {label}
              </span>
              <span className="sr-only">
                {n}. {label}
                {done ? " (completed)" : active ? " (current step)" : ""}
              </span>
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
