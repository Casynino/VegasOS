import { cn } from "@/lib/utils";
import { HudLabel } from "../kit/hud";

/**
 * The header strip of a booking / request console: a HUD status on the left (a pinging dot when
 * the console talks to the live system) and the step track on the right ("01 When — 02 Details —
 * 03 Pay"), lit up to the step the guest has reached. Decorative for screen readers: the form's
 * own fieldset legends carry the steps.
 */
export function ConsoleHead({
  live,
  label,
  steps,
  reached = 1,
  className,
}: {
  /** Status text with a pinging dot (only for a real live connection, e.g. live availability). */
  live?: string;
  /** Status text without the dot. */
  label?: string;
  steps: string[];
  /** How many steps are open (1-based). */
  reached?: number;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap items-center justify-between gap-x-6 gap-y-3 border-b border-pub-line px-5 py-4 sm:px-7", className)}>
      {live ? <HudLabel live>{live}</HudLabel> : label ? <HudLabel>{label}</HudLabel> : <span />}
      <ol aria-hidden="true" className="flex min-w-0 items-center gap-2 font-mono text-[10px] font-medium uppercase tracking-[0.18em] sm:gap-3">
        {steps.map((s, i) => {
          const on = i < reached;
          return (
            <li key={s} className="flex items-center gap-2 sm:gap-3">
              {i > 0 && <span className={cn("h-px w-3 sm:w-5", on ? "bg-pub-eyebrow/70" : "bg-pub-line")} />}
              <span className={cn("transition-colors duration-300 motion-reduce:transition-none", on ? "text-pub-eyebrow" : "text-pub-muted/70")}>
                {String(i + 1).padStart(2, "0")}
                <span className="hidden min-[400px]:inline"> {s}</span>
              </span>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
