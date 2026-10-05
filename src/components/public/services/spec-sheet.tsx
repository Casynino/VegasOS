import { cn } from "@/lib/utils";
import { HudLabel } from "../kit/hud";

/**
 * A spec sheet for a glass panel: hairline rows with a mono label and a serif value — the
 * Meeting Room's capacity, price, hours… Real figures only (from the database and settings).
 */
export function SpecRows({ rows, className }: { rows: { label: string; value: React.ReactNode }[]; className?: string }) {
  return (
    <dl className={cn("border-t border-pub-line", className)}>
      {rows.map((r) => (
        <div key={r.label} className="flex items-baseline justify-between gap-6 border-b border-pub-line py-3.5">
          <dt className="shrink-0">
            <HudLabel tick={false}>{r.label}</HudLabel>
          </dt>
          <dd className="min-w-0 text-right font-display text-[1.25rem] leading-tight text-pub-fg lining-nums tabular-nums sm:text-[1.375rem]">
            {r.value}
          </dd>
        </div>
      ))}
    </dl>
  );
}
