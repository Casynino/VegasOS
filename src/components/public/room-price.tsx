import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";

/** "From TZS X / night" with the standard website discount shown against the base rate. */
export function RoomPrice({
  baseRate,
  net,
  tone = "light",
  size = "md",
  label = "From",
}: {
  baseRate: number;
  net: number;
  tone?: "light" | "dark";
  size?: "md" | "lg";
  label?: string;
}) {
  const dark = tone === "dark";
  const discounted = net < baseRate;
  return (
    <p className={cn("leading-tight", dark ? "text-white" : "text-tone")}>
      <span className={cn("block text-[11px] uppercase tracking-[0.22em]", dark ? "text-white/60" : "text-tone/60")}>
        {label} {discounted && <span className="sr-only">(website rate)</span>}
      </span>
      <span className="mt-1 flex flex-wrap items-baseline gap-x-2">
        <span className={cn("font-display font-semibold", size === "lg" ? "text-4xl" : "text-2xl")}>{formatTZS(net)}</span>
        {discounted && (
          <s className={cn("text-sm", dark ? "text-white/50" : "text-tone/50")}>
            <span className="sr-only">instead of </span>
            {formatTZS(baseRate)}
          </s>
        )}
        <span className={cn("text-sm", dark ? "text-white/60" : "text-tone/60")}>/ night</span>
      </span>
    </p>
  );
}
