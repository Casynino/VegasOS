import { cn } from "@/lib/utils";
import { LocalTime } from "../cinema/local-time";
import { GlassPanel, HOTEL_COORDS, HudLabel } from "../kit/hud";

const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" });

const pad = (n: number) => String(n).padStart(2, "0");

/** "● Dar es Salaam · 19:42 local time" — the hotel's real local time, kept current on the client. */
export function LocalTimeLabel({ city = "Dar es Salaam", short = false, className }: { city?: string; short?: boolean; className?: string }) {
  return (
    <HudLabel live className={className}>
      {city} · <LocalTime initial={TIME.format(new Date())} />
      {short ? <span className="sr-only"> local time</span> : " local time"}
    </HudLabel>
  );
}

export type HudRow = { label: string; value?: string };

/**
 * The glass HUD card that floats over a dining hero on desktop: the live local time, a serif line
 * and a few rows of real data (opening hours from Settings, the meals, shelves and counts from the
 * live menu). Rows without a value are numbered ("01 Breakfast"). Nothing here is invented.
 */
export function HeroPanel({ title, rows, note, className }: { title: string; rows: HudRow[]; note?: React.ReactNode; className?: string }) {
  const numbered = rows.every((r) => !r.value);
  return (
    <GlassPanel hud padding="md" className={cn("w-full max-w-[22rem]", className)}>
      <LocalTimeLabel short className="text-white/75" />
      <p className="mt-5 font-display text-[1.75rem] font-medium leading-[1.1] text-balance">{title}</p>
      {rows.length > 0 && (
        <ul className={cn("mt-4 border-t border-white/12", numbered && "grid gap-x-5 xl:grid-cols-2")}>
          {rows.map((r, i) => (
            <li key={r.label} className="flex min-w-0 items-baseline gap-3 border-b border-white/12 py-2.5">
              {numbered && <span className="font-mono text-[10px] tracking-[0.16em] text-gold/80">{pad(i + 1)}</span>}
              <span className="min-w-0 flex-1 truncate text-[14px] text-white/85">{r.label}</span>
              {r.value && <span className="shrink-0 font-mono text-[11px] tracking-[0.08em] text-white/70 tabular-nums">{r.value}</span>}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-4 flex items-center justify-between gap-4">
        {note ? <p className="min-w-0 text-[12.5px] leading-snug text-white/65">{note}</p> : <span />}
        <HudLabel tick={false} className="shrink-0 text-white/55">{HOTEL_COORDS.label}</HudLabel>
      </div>
    </GlassPanel>
  );
}
