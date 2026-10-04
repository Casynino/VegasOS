import { CalendarCheck, ConciergeBell, Clock, DoorOpen, Trophy } from "lucide-react";
import { db } from "@/server/db";
import { addDays, businessDateOf, businessDayBounds, eachDate, toDbDate, type BusinessDate, type BusinessDayConfig } from "@/lib/time/business-date";
import { cn } from "@/lib/utils";

const CHECK_INS = ["reservation.checked_in", "reservation.walk_in"];

/**
 * A receptionist's own last 7 hotel days, from her records — guests she checked in and out, guest requests she
 * handled, hours on shift — for the start-shift page. Facts about her own work, never a score or a ranking. No money:
 * staff see money one shift at a time (owner, 2026-10-04).
 */
export async function myWeek(userId: string, today: BusinessDate, cfg: BusinessDayConfig) {
  const from = addDays(today, -6);
  const days = eachDate(from, addDays(today, 1));
  const start = businessDayBounds(from, cfg).start;
  const [shifts, logs] = await Promise.all([
    db.actualShift.findMany({ where: { userId, department: "RECEPTION", startedAt: { gte: start } }, select: { startedAt: true, endedAt: true } }),
    db.auditLog.groupBy({ by: ["businessDate", "action"], where: { userId, businessDate: { gte: toDbDate(from) }, action: { in: [...CHECK_INS, "reservation.checked_out", "request.accepted", "complaint.resolved"] } }, _count: true }),
  ]);
  const now = new Date();
  const of = (d: Date) => businessDateOf(d, cfg);
  const rows = days.map((d) => {
    const count = (actions: string[]) => logs.filter((l) => l.businessDate.toISOString().slice(0, 10) === d && actions.includes(l.action)).reduce((t, l) => t + l._count, 0);
    return {
      day: d,
      checkIns: count(CHECK_INS), checkOuts: count(["reservation.checked_out"]), requests: count(["request.accepted", "complaint.resolved"]),
      minutes: shifts.filter((s) => of(s.startedAt) === d).reduce((t, s) => t + Math.max(0, Math.round(((s.endedAt ?? now).getTime() - s.startedAt.getTime()) / 60000)), 0),
    };
  });
  const sum = (k: "requests" | "checkIns" | "checkOuts" | "minutes") => rows.reduce((t, r) => t + r[k], 0);
  return { rows, today, totals: { requests: sum("requests"), checkIns: sum("checkIns"), checkOuts: sum("checkOuts"), minutes: sum("minutes"), shifts: shifts.length } };
}
type Week = Awaited<ReturnType<typeof myWeek>>;

const dur = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const wd = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", timeZone: "UTC" });
const hours = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h${m % 60 ? ` ${m % 60}m` : ""}` : `${m}m`);

/** One small bar chart: a bar per day, today marked, the value on hover (and above the best day). */
function Bars({ rows, value, today, fmt, tone, label, empty }: { rows: Week["rows"]; value: (r: Week["rows"][number]) => number; today: string; fmt: (n: number) => string; tone: string; label: string; empty: string }) {
  const max = Math.max(1, ...rows.map(value));
  if (!rows.some(value)) return <p className="grid h-36 place-items-center rounded-2xl border border-dashed border-border/80 px-4 text-center text-xs text-muted-foreground">{empty}</p>;
  const best = rows.reduce((b, r) => (value(r) > value(b) ? r : b), rows[0]);
  return (
    <div role="img" aria-label={`${label}: ${rows.map((r) => `${wd(r.day)} ${fmt(value(r))}`).join(", ")}`} className="flex h-40 items-end gap-1.5 pt-6">
      {rows.map((r) => {
        const v = value(r);
        const h = v ? Math.max(6, Math.round((v / max) * 100)) : 0;
        return (
          <div key={r.day} className="group relative flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1.5">
            {/* the value: on hover, and above the best day */}
            {/* Every bar area is the same height: the value floats above its own bar (always on the best day, on hover for the rest) */}
            <div className="relative flex w-full flex-1 items-end">
              <div className={cn("relative w-full rounded-t-[4px] transition-[filter] group-hover:brightness-110", v ? tone : "")} style={{ height: `${h}%` }}>
                <span className={cn("pointer-events-none absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap rounded-md px-1.5 py-0.5 text-[10.5px] font-semibold tabular-nums transition",
                  r === best && v > 0 ? "text-foreground" : "z-10 bg-foreground text-background opacity-0 group-hover:opacity-100")}>{fmt(v)}</span>
              </div>
            </div>
            <span className={cn("h-px w-full", "bg-border")} />
            <span className={cn("text-[10.5px] font-medium", r.day === today ? "font-semibold text-[oklch(0.55_0.11_75)] dark:text-[#f0cf86]" : "text-muted-foreground")}>{r.day === today ? "Today" : wd(r.day)}</span>
          </div>
        );
      })}
    </div>
  );
}

/** YOUR WEEK — her own last 7 days: what she recorded and who she welcomed, with a few plain facts. */
export function MyWeek({ week }: { week: Week }) {
  const { rows, totals, today } = week;
  const guests = (r: Week["rows"][number]) => r.checkIns + r.checkOuts;
  const busiest = rows.reduce((b, r) => (guests(r) > guests(b) ? r : b), rows[0]);
  const longest = rows.reduce((b, r) => (r.minutes > b.minutes ? r : b), rows[0]);
  const worked = rows.filter((r) => r.minutes > 0).length;
  const facts = [
    { icon: Clock, tone: "bg-sky-500/12 text-sky-600 dark:text-sky-300", label: "On shift", value: dur(totals.minutes), sub: `${worked} of 7 days` },
    { icon: DoorOpen, tone: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300", label: "Guests checked in", value: String(totals.checkIns), sub: `${totals.checkOuts} checked out` },
    { icon: ConciergeBell, tone: "bg-violet-500/12 text-violet-600 dark:text-violet-300", label: "Guest requests", value: String(totals.requests), sub: "you took care of" },
  ];
  const highlights = [
    guests(busiest) > 0 && `Your busiest day: ${wd(busiest.day)} — ${busiest.checkIns} in, ${busiest.checkOuts} out`,
    longest.minutes > 0 && `Your longest day: ${wd(longest.day)} — ${hours(longest.minutes)} on shift`,
    worked >= 5 && `You worked ${worked} of the last 7 days`,
  ].filter((x): x is string => !!x);

  return (
    <section className="rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="flex items-center gap-2 text-base font-semibold"><CalendarCheck className="size-4 text-[oklch(0.62_0.11_78)]" />Your week</h2>
          <p className="text-xs text-muted-foreground">Your own work over the last 7 hotel days — from your records.</p>
        </div>
      </div>
      <div className="mt-4 grid gap-2.5 sm:grid-cols-3">
        {facts.map((f) => (
          <div key={f.label} className="flex items-center gap-3 rounded-2xl bg-muted/40 px-3.5 py-3 ring-1 ring-inset ring-border/60">
            <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", f.tone)}><f.icon className="size-[18px]" /></span>
            <div className="min-w-0 leading-tight">
              <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{f.label}</p>
              <p className="mt-0.5 text-lg font-semibold tabular-nums [overflow-wrap:anywhere]">{f.value}</p>
              <p className="truncate text-[11px] text-muted-foreground">{f.sub}</p>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-5 grid gap-6 md:grid-cols-2">
        <div>
          <p className="mb-2 text-xs font-semibold">Hours on shift <span className="font-normal text-muted-foreground">· per day</span></p>
          <Bars rows={rows} value={(r) => r.minutes} today={today} fmt={hours} tone="bg-[oklch(0.72_0.12_80)]" label="Hours on shift" empty="Your shifts show here, day by day." />
        </div>
        <div>
          <p className="mb-2 text-xs font-semibold">Guests you checked in & out <span className="font-normal text-muted-foreground">· per day</span></p>
          <Bars rows={rows} value={guests} today={today} fmt={String} tone="bg-emerald-500" label="Guests checked in and out" empty="Guests you check in and out show here, day by day." />
        </div>
      </div>
      {highlights.length > 0 && (
        <ul className="mt-5 flex flex-wrap gap-2">
          {highlights.map((h) => (
            <li key={h} className="inline-flex items-center gap-1.5 rounded-full bg-[oklch(0.75_0.12_80)]/12 px-3 py-1.5 text-xs font-medium text-[oklch(0.45_0.09_75)] dark:text-[#f0cf86]"><Trophy className="size-3.5" />{h}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
