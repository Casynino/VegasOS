import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { typeScale } from "../kit/tokens";
import fx from "../room-fx.module.css";

export const BOOKING_STEPS = ["Dates & guests", "Choose room", "Details & arrival", "Review", "Request sent"] as const;

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * 5-step booking progress as a HUD line: numbered nodes joined by hairlines that fill in gold up
 * to the current step (its connector draws in once); the current node is ringed, with a softly
 * pinging dot. Phones read "Step 02 / 05 · Choose room" above the nodes; desktop names every step
 * under its node. `current` is 1-based. `last` renames the final step (a booking that is made,
 * not just requested, ends on "Booked"). Follows the surrounding tone.
 */
export function BookingProgress({ current, last, className }: { current: 1 | 2 | 3 | 4 | 5; last?: string; className?: string }) {
  const steps: readonly string[] = last ? [...BOOKING_STEPS.slice(0, -1), last] : BOOKING_STEPS;
  return (
    <nav aria-label="Booking progress" className={className}>
      <p className={cn(typeScale.meta, "flex items-center gap-2.5 text-pub-muted lg:sr-only")}>
        <span className="font-mono text-pub-eyebrow">
          Step {pad2(current)} / {pad2(steps.length)}
        </span>
        <span aria-hidden="true" className="h-px w-4 bg-pub-line" />
        <span className="text-pub-fg">{steps[current - 1]}</span>
      </p>
      <ol className="mt-4 grid grid-cols-[repeat(4,minmax(0,1fr))_auto] lg:mt-0">
        {steps.map((label, i) => {
          const n = i + 1;
          const done = n < current;
          const active = n === current;
          return (
            <li key={label} className="min-w-0" aria-current={active ? "step" : undefined}>
              <div aria-hidden="true" className="flex items-center">
                <span
                  className={cn(
                    "relative grid size-7 shrink-0 place-items-center rounded-full border font-mono text-[10px] font-medium tabular-nums sm:size-8 sm:text-[11px]",
                    done && "border-pub-eyebrow/70 bg-pub-eyebrow/10 text-pub-eyebrow",
                    active &&
                      "border-pub-eyebrow bg-pub-eyebrow/12 text-pub-fg shadow-[0_0_0_4px_color-mix(in_oklab,var(--pub-eyebrow)_14%,transparent),0_0_22px_-4px_color-mix(in_oklab,var(--pub-eyebrow)_55%,transparent)]",
                    !done && !active && "border-pub-line text-pub-muted",
                  )}
                >
                  {done ? <Check className="size-3.5" strokeWidth={2} /> : pad2(n)}
                  {active && (
                    <span className="pub-live-dot absolute -right-0.5 -top-0.5 inline-block size-1.5 rounded-full bg-gold after:absolute after:inset-0 after:rounded-full after:bg-gold" />
                  )}
                </span>
                {n < steps.length && (
                  <span className="relative mx-1.5 h-px min-w-2 flex-1 overflow-hidden bg-pub-line sm:mx-2.5">
                    {done && <span className="absolute inset-0 bg-pub-eyebrow/70" />}
                    {active && <span className={cn(fx.drawIn, "absolute inset-y-0 left-0 w-1/2 bg-linear-to-r from-pub-eyebrow to-transparent")} />}
                  </span>
                )}
              </div>
              <span
                aria-hidden="true"
                className={cn(typeScale.meta, "mt-3 hidden truncate pr-3 lg:block", active ? "text-pub-fg" : done ? "text-pub-eyebrow" : "text-pub-muted")}
              >
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
