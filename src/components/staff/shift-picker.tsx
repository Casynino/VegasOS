import Link from "next/link";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";

type PickShift = { id: string; startedAt: Date; endedAt: Date | null };

/**
 * One shift at a time (staff see their own money and work shift by shift — managers see every period): this shift
 * first, then the ones before it, newest first. Each chip says the day and the hours.
 */
export async function ShiftPicker({ shifts, current, href, timezone, className }: { shifts: PickShift[]; current: string | null; href: (id: string) => string; timezone: string; className?: string }) {
  if (!shifts.length) return null;
  const t = await getT();
  const clock = (d: Date) => new Intl.DateTimeFormat(t.intl, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(d);
  const day = (d: Date) => new Intl.DateTimeFormat(t.intl, { weekday: "short", day: "numeric", month: "short", timeZone: timezone }).format(d);
  return (
    <nav aria-label={t("Your shifts")} className={cn("-mx-1 max-w-[calc(100%+0.5rem)] overflow-x-auto px-1 [scrollbar-width:none] sm:max-w-none", className)}>
      <div className="flex w-max gap-1.5">
        {shifts.map((s, i) => {
          const on = s.id === current;
          const open = !s.endedAt;
          return (
            <Link key={s.id} href={href(s.id)} aria-current={on ? "page" : undefined}
              className={cn("flex min-w-[8.5rem] flex-col rounded-2xl border px-3 py-2 text-left transition",
                on ? "border-[oklch(0.75_0.12_80)] bg-[oklch(0.72_0.12_80/0.12)] ring-1 ring-[oklch(0.75_0.12_80/0.45)]" : "border-border/70 bg-card hover:bg-muted/40")}>
              <span className={cn("flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider", on ? "text-[oklch(0.55_0.11_75)] dark:text-[#f0cf86]" : "text-muted-foreground")}>
                {open && <span className="size-1.5 animate-pulse rounded-full bg-emerald-500" />}
                {open ? t("This shift") : i === 0 || (i === 1 && !shifts[0].endedAt) ? t("Last shift") : day(s.startedAt)}
              </span>
              <span className="mt-0.5 text-sm font-semibold tabular-nums">{clock(s.startedAt)} → {s.endedAt ? clock(s.endedAt) : t("now")}</span>
              <span className="text-[10.5px] text-muted-foreground">{day(s.startedAt)}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
