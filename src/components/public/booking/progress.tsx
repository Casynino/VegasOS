import { Check } from "lucide-react";
import { cn } from "@/lib/utils";

export const BOOKING_STEPS = ["Dates & guests", "Choose room", "Details & arrival", "Review", "Request sent"] as const;

/** 5-step booking progress indicator. `current` is 1-based. */
export function BookingProgress({ current, className }: { current: 1 | 2 | 3 | 4 | 5; className?: string }) {
  return (
    <nav aria-label="Booking progress" className={className}>
      <p className="mb-3 text-sm text-tone/60 sm:hidden">
        Step {current} of {BOOKING_STEPS.length} · <span className="font-medium text-tone">{BOOKING_STEPS[current - 1]}</span>
      </p>
      <ol className="flex items-center gap-2 sm:gap-3">
        {BOOKING_STEPS.map((label, i) => {
          const n = i + 1;
          const done = n < current;
          const active = n === current;
          return (
            <li key={label} className="flex flex-1 items-center gap-2 sm:gap-3" aria-current={active ? "step" : undefined}>
              <span
                className={cn(
                  "grid size-8 shrink-0 place-items-center rounded-full border text-xs font-medium transition-colors duration-500",
                  done && "border-gold bg-gold text-[#15120e]",
                  active && "border-tone bg-[#15120e] text-gold",
                  !done && !active && "border-tone/20 text-tone/50",
                )}
              >
                {done ? <Check className="size-4" aria-hidden="true" /> : n}
                <span className="sr-only">{done ? " (completed)" : active ? " (current step)" : ""}</span>
              </span>
              <span className={cn("hidden whitespace-nowrap text-sm lg:inline", active ? "font-medium text-tone" : "text-tone/55")}>{label}</span>
              {n < BOOKING_STEPS.length && (
                <span className="h-px flex-1 bg-[#15120e]/15" aria-hidden="true">
                  <span className={cn("block h-px bg-gold transition-all duration-700", done ? "w-full" : "w-0")} />
                </span>
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
