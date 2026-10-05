import { cn } from "@/lib/utils";
import { field } from "../kit/tokens";

/**
 * A labelled form field in the public style (kit `field` recipes): label above, the control, then
 * an error or a quiet hint. `required` adds a small gold asterisk (decorative — give the control
 * aria-required). Tone-aware: it reads on paper and on night sections alike.
 */
export function Field({
  label,
  error,
  hint,
  required = false,
  className,
  children,
}: {
  label: React.ReactNode;
  error?: string;
  hint?: React.ReactNode;
  required?: boolean;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <label className={cn("block min-w-0", className)}>
      <span className={field.label}>
        {label}
        {required && (
          <span aria-hidden="true" className="ml-1 text-pub-eyebrow">
            *
          </span>
        )}
      </span>
      {children}
      {error ? <span className={cn(field.error, "block")}>{error}</span> : hint ? <span className={cn(field.hint, "block")}>{hint}</span> : null}
    </label>
  );
}

/**
 * The heading of a form step, as the fieldset's legend: a gold step number and a serif line
 * ("1  When is your meeting?"). Without `step` it is a smaller sub-step ("Choose a package").
 */
export function StepLegend({
  step,
  hint,
  className,
  children,
}: {
  step?: number;
  /** A quiet note after the title ("by time and distance"). */
  hint?: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <legend
      className={cn(
        "mb-5 font-display leading-tight text-pub-fg",
        step ? "text-[1.375rem] sm:text-[1.5rem]" : "text-[1.2rem]",
        className,
      )}
    >
      {step && <span className="mr-3 text-pub-eyebrow lining-nums">{step}</span>}
      {children}
      {hint && <span className="ml-2 font-sans text-[13px] text-pub-muted">· {hint}</span>}
    </legend>
  );
}
