import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { typeScale } from "../kit/tokens";

/**
 * One option in a quiet list of choices (a transport service, a package, a way to pay): a hairline
 * row with a soft gold edge when chosen — never a heavy card. kind="radio" inside a radiogroup
 * (one of), "toggle" for a pressed button. `children` open under the chosen row (e.g. the
 * mobile-money number under "Pay now"). Tone-aware.
 */
export function ChoiceRow({
  on,
  onSelect,
  kind = "toggle",
  icon,
  title,
  sub,
  meta,
  className,
  children,
}: {
  on: boolean;
  onSelect: () => void;
  kind?: "radio" | "toggle";
  icon?: React.ReactNode;
  title: React.ReactNode;
  /** One quiet line under the title. */
  sub?: React.ReactNode;
  /** A last line, e.g. the price. */
  meta?: React.ReactNode;
  className?: string;
  children?: React.ReactNode;
}) {
  const state = kind === "radio" ? ({ role: "radio", "aria-checked": on } as const) : ({ "aria-pressed": on } as const);
  return (
    <div
      className={cn(
        "rounded-[0.75rem] border transition-[border-color,background-color] duration-200 motion-reduce:transition-none",
        on ? "border-gold/70 bg-gold/[0.07]" : "border-pub-line hover:border-pub-fg/30",
        className,
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        {...state}
        className="flex min-h-14 w-full items-start gap-4 rounded-[0.75rem] px-4 py-4 text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold"
      >
        {icon && (
          <span
            aria-hidden="true"
            className={cn(
              "grid size-10 shrink-0 place-items-center rounded-full transition-colors duration-200 motion-reduce:transition-none",
              on ? "bg-gold text-[#16110a]" : "bg-pub-fg/[0.06] text-pub-eyebrow",
            )}
          >
            {icon}
          </span>
        )}
        <span className="min-w-0 flex-1 pt-0.5">
          <span className={cn(typeScale.item, "block text-pub-fg")}>{title}</span>
          {sub && <span className="mt-1 block text-[13px] leading-snug text-pub-muted">{sub}</span>}
          {meta && <span className="mt-2 block">{meta}</span>}
        </span>
        <span
          aria-hidden="true"
          className={cn(
            "mt-1 grid size-5 shrink-0 place-items-center rounded-full border transition-colors duration-200 motion-reduce:transition-none",
            on ? "border-gold bg-gold text-[#16110a]" : "border-pub-fg/25",
          )}
        >
          {on && <Check className="size-3" strokeWidth={3} />}
        </span>
      </button>
      {on && children && <div className="px-4 pb-4">{children}</div>}
    </div>
  );
}
