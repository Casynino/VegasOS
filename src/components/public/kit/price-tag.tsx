import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { typeScale } from "./tokens";

const SIZE = {
  sm: "text-[1.375rem]",
  md: "text-[1.75rem]",
  lg: "text-[clamp(2rem,1.6rem+1.2vw,2.5rem)]",
} as const;

/**
 * "TZS 80,000 / night" — the amount in the display serif, currency and unit small.
 * Only real amounts from the database or settings. `was` shows a struck-through earlier
 * price (e.g. the base rate when the website rate is lower).
 */
export function PriceTag({
  amount,
  unit = "night",
  from = false,
  was,
  currency = "TZS",
  size = "md",
  note,
  className,
}: {
  amount: number;
  /** "night", "day", "trip", "person"… or null for none. */
  unit?: string | null;
  from?: boolean;
  was?: number | null;
  currency?: string;
  size?: keyof typeof SIZE;
  /** A small line under the price, e.g. "Breakfast included". */
  note?: React.ReactNode;
  className?: string;
}) {
  return (
    <p className={cn("flex flex-wrap items-baseline gap-x-1.5 gap-y-1 text-pub-fg", className)}>
      {from && <span className={cn(typeScale.meta, "mr-0.5 text-pub-muted")}>From</span>}
      <span className={cn(typeScale.meta, "text-pub-muted")}>{currency}</span>
      <span className={cn(typeScale.price, SIZE[size], "leading-none")}>{formatNumber(amount)}</span>
      {unit && <span className="text-[13px] text-pub-muted">/ {unit}</span>}
      {was != null && was > amount && (
        <s className="ml-1 text-[13px] text-pub-muted">
          <span className="sr-only">instead of </span>
          {currency} {formatNumber(was)}
        </s>
      )}
      {note && <span className={cn(typeScale.meta, "basis-full pt-1 text-pub-muted")}>{note}</span>}
    </p>
  );
}
