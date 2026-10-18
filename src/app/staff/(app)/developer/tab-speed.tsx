import { CalendarCheck, CircleAlert, CircleCheck, Gauge, ScrollText } from "lucide-react";
import type { T } from "@/i18n/translate";
import type { SpeedData } from "@/server/services/developer-health";
import type { CheckResult } from "@/server/services/developer-checks";
import { Panel } from "@/components/dashboard/kit";
import { RankBars } from "./console-charts";
import { bytesText, num, Quiet, StatBlock, Tag, type TagTone } from "./console-ui";

/**
 * SPEED & SIZE (as the owner's other console has it): three figures first (the database's answer, a real screen's query, the size of the
 * permanent diary), then real questions timed now, how big the database is and which tables are the biggest, the rules that must always be
 * true and what is running right now — and, at the bottom, how many records the system holds. Only COUNTS of the hotel's records are shown,
 * never a record.
 */

/** Under this many milliseconds the database is fast; over the second one it is slow. */
const FAST_MS = 150;
const SLOW_MS = 400;

/** The tag for a timing: "Fast" under 150 ms, "Okay" under 400, "Slow" over; no answer at all is its own word. */
function speedTag(t: T, ms: number | null): { label: string; tone: TagTone } {
  if (ms === null) return { label: t("No answer"), tone: "rose" };
  return ms < FAST_MS ? { label: t("Fast"), tone: "emerald" } : ms < SLOW_MS ? { label: t("Okay"), tone: "amber" } : { label: t("Slow"), tone: "rose" };
}

/** The probe that loads a real screen's list, found by the English name the service gives it. */
const BOOKINGS_PROBE = "Load newest 50 bookings";

const tone = (ms: number | null) => (ms === null ? "bg-rose-500" : ms < FAST_MS ? "bg-emerald-500" : ms < SLOW_MS ? "bg-amber-500" : "bg-rose-500");
const text = (ms: number | null) => (ms === null ? "text-rose-600 dark:text-rose-400" : ms < FAST_MS ? "text-emerald-600 dark:text-emerald-400" : ms < SLOW_MS ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400");

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums">{value}</dd>
    </div>
  );
}

export function SpeedTab({ t, s, dataChecks = [] }: { t: T; s: SpeedData; dataChecks?: CheckResult[] }) {
  const avg = s.latency.average;
  const maxMs = Math.max(SLOW_MS, ...s.probes.map((p) => p.ms ?? 0));
  const maxRows = Math.max(1, ...s.tables.map((x) => x.rows ?? 0));
  const d = s.deployment;
  const checks = dataChecks.filter((c) => c.state !== "unknown" && !(c.state === "ok" && c.skipped));

  const avgTag = speedTag(t, avg);
  const bookingsProbe = s.probes.find((p) => p.label === BOOKINGS_PROBE);
  const bookingsMs = bookingsProbe?.ms ?? null;
  const bookingsTag = bookingsMs === null ? { label: t("No answer"), tone: "rose" as TagTone } : bookingsMs < SLOW_MS ? { label: t("Fine"), tone: "emerald" as TagTone } : { label: t("Slow"), tone: "rose" as TagTone };
  const auditLines = s.holds.find((h) => h.key === "audit")?.rows ?? null;
  // What the system holds: the biggest first; a count that could not be read is named under the bars, never drawn as a zero.
  // (the labels are looked up as "holds::Guests" first: here a guest is a record, not a head count)
  const holdRows = s.holds.flatMap((h) => (h.rows === null ? [] : [{ key: h.key, label: t.ctx("holds", h.label), value: h.rows }])).sort((a, b) => b.value - a.value);
  const holdUnread = s.holds.filter((h) => h.rows === null).map((h) => t.ctx("holds", h.label));

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatBlock
          icon={Gauge} label={t("Database answer")} value={avg === null ? "—" : t("{ms} ms", { ms: avg })}
          caption={s.latency.slowest === null ? t("no answer") : t("slowest of {n}: {ms} ms", { n: s.latency.samples.length, ms: s.latency.slowest })}
          warn={avg !== null && avg >= SLOW_MS} tag={avgTag.label} tagTone={avgTag.tone}
          note={t("How long the database takes to answer the simplest question, measured just now. Under {fast} ms is fast; over {slow} ms, pages will feel slow.", { fast: FAST_MS, slow: SLOW_MS })}
        />
        <StatBlock
          icon={CalendarCheck} label={t("Bookings list")} value={bookingsMs === null ? "—" : t("{ms} ms", { ms: bookingsMs })} caption={t("the newest 50 bookings")}
          warn={bookingsMs !== null && bookingsMs >= SLOW_MS} tag={bookingsProbe ? bookingsTag.label : undefined} tagTone={bookingsTag.tone}
          note={t("How long a real screen's query takes. If it grows far above the figure beside it as data grows, the screen needs an index or a smaller page.")}
        />
        <StatBlock
          icon={ScrollText} label={t("Audit lines")} value={num(t, auditLines)} caption={t("in the permanent diary")}
          tag={t.ctx("data", "Size")} tagTone="slate"
          note={t("Every action is kept for good, so this only grows. It is cheap to keep, but it is the table to watch first.")}
        />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-3">
        <Panel
          title={t("Database speed")} subtitle={t("Each bar is one typical thing the app does. Shorter is faster.")}
          action={<Tag tone={avg === null ? "rose" : avg < FAST_MS ? "emerald" : avg < SLOW_MS ? "amber" : "rose"}>{avg === null ? t("No answer") : t("average {ms} ms", { ms: avg })}</Tag>}
        >
          {s.probes.every((p) => p.ms === null) ? <Quiet>{t("The database did not answer.")}</Quiet> : (
            <>
              <ul className="space-y-3">
                {s.probes.map((p) => (
                  <li key={p.label}>
                    <div className="flex items-baseline justify-between gap-3 text-sm"><span>{t(p.label)}</span><span className={`tabular-nums ${text(p.ms)}`}>{p.ms === null ? t("no answer") : t("{ms} ms", { ms: p.ms })}</span></div>
                    <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden><div className={`h-full rounded-full ${tone(p.ms)}`} style={{ width: `${Math.max(3, ((p.ms ?? maxMs) / maxMs) * 100)}%` }} /></div>
                  </li>
                ))}
              </ul>
              <p className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-emerald-500" aria-hidden />{t("under {n} ms is fast", { n: FAST_MS })}</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-amber-500" aria-hidden />{t("{a}–{b} ms is okay", { a: FAST_MS, b: SLOW_MS })}</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-2 rounded-full bg-rose-500" aria-hidden />{t("over {n} ms is slow", { n: SLOW_MS })}</span>
              </p>
            </>
          )}
        </Panel>

        <Panel
          title={t("Database size")} subtitle={t("The biggest tables, and roughly how many rows each holds.")}
          action={s.databaseBytes !== null ? <span className="rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{t("{size} total", { size: bytesText(t, s.databaseBytes) })}</span> : undefined}
        >
          {s.tables.every((x) => x.rows === null) ? <Quiet>{t("This could not be read just now.")}</Quiet> : (
            <ul className="space-y-3">
              {s.tables.map((x) => (
                <li key={x.label}>
                  <div className="flex items-baseline justify-between gap-3 text-sm"><span>{t(x.label)}</span><span className="tabular-nums text-muted-foreground">{bytesText(t, x.bytes)}</span></div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-muted" aria-hidden>{x.rows !== null && <div className="h-full rounded-full bg-sky-500" style={{ width: `${Math.max(3, (x.rows / maxRows) * 100)}%` }} />}</div>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t("about {n} rows", { n: num(t, x.rows) })}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel title={t("Data checks")} subtitle={t("Rules that must always be true. If one fails, numbers on screen may be wrong.")}>
            {checks.length === 0 ? <Quiet>{t("This could not be read just now.")}</Quiet> : (
              <ul className="space-y-2.5">
                {checks.map((c) => (
                  <li key={c.id} className="flex items-start gap-2 text-sm" title={t(c.what.key, c.what.vars)}>
                    {c.state === "ok" ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-rose-600 dark:text-rose-400" aria-hidden />}
                    <span className="min-w-0 flex-1">{t(c.title.key, c.title.vars)}</span>
                    <Tag tone={c.state === "ok" ? "emerald" : c.state === "fix" ? "rose" : "amber"}>{c.state === "ok" ? t("OK") : c.state === "fix" ? t("Fix now") : t("Look at it")}</Tag>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          <Panel title={t("This deployment")} subtitle={t("What is running right now.")}>
            <dl className="divide-y divide-border/60">
              <Row label={t("Build")} value={d.commit ?? "—"} />
              <Row label={t("Environment")} value={d.environment ?? "—"} />
              <Row label={t("Node")} value={d.node} />
              <Row label={t("Database link")} value={d.databaseLink ? t(d.databaseLink) : "—"} />
              <Row label={t("Your session")} value={t("Ends after {n} hours", { n: d.sessionHours })} />
              <Row label={t("Working as someone")} value={t("Ends after {n} hours", { n: d.workAsHours })} />
            </dl>
          </Panel>
        </div>
      </div>

      <Panel
        title={t("What the system holds")}
        subtitle={s.auditSince ? t("Records in the database. The audit log reaches back to {date}.", { date: t.date(s.auditSince) }) : t("Records in the database.")}
      >
        {holdRows.length === 0 ? <Quiet>{t("This could not be read just now.")}</Quiet> : (
          <>
            <RankBars t={t} rows={holdRows} color="#3987e5" caption={t("What the system holds")} empty={t("Nothing yet")} />
            {holdUnread.length > 0 && <p className="mt-3 text-xs text-muted-foreground">{holdUnread.join(", ")}: {t("This could not be read just now.")}</p>}
          </>
        )}
      </Panel>
    </div>
  );
}
