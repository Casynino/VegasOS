import { CircleAlert, CircleCheck } from "lucide-react";
import type { ReactNode } from "react";
import type { T } from "@/i18n/translate";
import type { SpeedData } from "@/server/services/developer-health";
import type { CheckResult } from "@/server/services/developer-checks";
import { Panel } from "@/components/dashboard/kit";
import { bytesText, num, Tag } from "./console-ui";

/**
 * SPEED & SIZE, laid out like the owner's other console (Target Express, 2026-10-18: "copy this look exactly"): three equal panels in a row —
 * the database's speed (six real questions timed now, one bar each), the database's size (the biggest tables, with about how many rows each
 * holds) and what is running right now — and under them the rules that must always be true. Only counts and sizes of the system's own tables
 * are drawn: the hotel's records (guests, bookings, payments…) are the hotel's work, not the system's.
 */

/** Under this many milliseconds the database is fast; over the second one it is slow. */
const FAST_MS = 150;
const SLOW_MS = 400;

const tone = (ms: number | null) => (ms === null ? "bg-rose-500" : ms < FAST_MS ? "bg-emerald-500" : ms < SLOW_MS ? "bg-amber-500" : "bg-rose-500");
const text = (ms: number | null) => (ms === null ? "text-rose-600 dark:text-rose-400" : ms < FAST_MS ? "text-emerald-600 dark:text-emerald-400" : ms < SLOW_MS ? "text-amber-600 dark:text-amber-400" : "text-rose-600 dark:text-rose-400");
const CHECK_ORDER = { fix: 0, look: 1, unknown: 2, ok: 3 } as const;

/** An empty panel, drawn like the owner's other console: the title and subtitle stay, and ONE short quiet line says why there is nothing. */
function Empty({ children }: { children: ReactNode }) {
  return <p className="py-5 text-center text-sm text-muted-foreground">{children}</p>;
}

/** One line of "This deployment": a quiet name on the left, the value on the right (a build or a version in the code font). */
function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={mono ? "break-all text-right font-mono text-[13px]" : "text-right font-medium"}>{value}</dd>
    </div>
  );
}

export function SpeedTab({ t, s, dataChecks = [] }: { t: T; s: SpeedData; dataChecks?: CheckResult[] }) {
  const avg = s.latency.average;
  const maxMs = Math.max(SLOW_MS, ...s.probes.map((p) => p.ms ?? 0));
  // The biggest first (the bar is the size on disk); a table whose size could not be read goes last and has no bar.
  const tables = s.tables.map((x, i) => ({ ...x, i })).sort((a, b) => (b.bytes ?? -1) - (a.bytes ?? -1) || a.i - b.i);
  const maxBytes = Math.max(1, ...s.tables.map((x) => x.bytes ?? 0));
  const d = s.deployment;
  // The ones that need a person first; the checks that do not apply here are left out.
  const checks = dataChecks.filter((c) => c.state !== "unknown" && !(c.state === "ok" && c.skipped)).sort((a, b) => CHECK_ORDER[a.state] - CHECK_ORDER[b.state]);
  const unread = <span className="text-muted-foreground" title={t("This could not be read just now.")}>—</span>;

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-3">
        <Panel
          level={3} title={t("Database speed")} subtitle={t("Each bar is one typical thing the app does. Shorter is faster.")}
          action={<Tag tone={avg === null ? "rose" : avg < FAST_MS ? "emerald" : avg < SLOW_MS ? "amber" : "rose"}>{avg === null ? t("No answer") : t("average {ms} ms", { ms: avg })}</Tag>}
        >
          {s.probes.every((p) => p.ms === null) ? <Empty>{t("The database did not answer.")}</Empty> : (
            <>
              <ul className="space-y-3.5">
                {s.probes.map((p) => (
                  <li key={p.label}>
                    <div className="flex items-baseline justify-between gap-3 text-sm"><span>{t(p.label)}</span><span className={`tabular-nums ${text(p.ms)}`}>{p.ms === null ? t("no answer") : t("{ms} ms", { ms: p.ms })}</span></div>
                    <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden><div className={`h-full rounded-full ${tone(p.ms)}`} style={{ width: `${Math.max(3, ((p.ms ?? maxMs) / maxMs) * 100)}%` }} /></div>
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
          level={3} title={t("Database size")} subtitle={t("The biggest tables, and roughly how many rows each holds.")}
          action={s.databaseBytes !== null ? <span className="shrink-0 rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{t("{size} total", { size: bytesText(t, s.databaseBytes) })}</span> : undefined}
        >
          {s.tables.every((x) => x.rows === null && x.bytes === null) ? <Empty>{t("This could not be read just now.")}</Empty> : (
            <ul className="space-y-3.5">
              {tables.map((x) => (
                <li key={x.label}>
                  <div className="flex items-baseline justify-between gap-3 text-sm">
                    <span className="min-w-0">{t(x.label)}</span>
                    <span className="shrink-0 tabular-nums text-muted-foreground">{bytesText(t, x.bytes)}</span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-muted" aria-hidden>{x.bytes !== null && <div className="h-full rounded-full bg-cyan-500" style={{ width: `${Math.max(3, (x.bytes / maxBytes) * 100)}%` }} />}</div>
                  <p className="mt-1 text-xs tabular-nums text-muted-foreground">{x.rows === null ? unread : t("about {n} rows", { n: num(t, x.rows) })}</p>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        <Panel level={3} title={t("This deployment")} subtitle={t("What is running right now.")}>
          <dl>
            <Row label={t("Build")} value={d.commit ?? "—"} mono />
            <Row label={t("Environment")} value={d.environment ?? "—"} />
            <Row label={t("Node")} value={d.node} mono />
            <Row label={t("Database link")} value={d.databaseLink ? t(d.databaseLink) : "—"} />
            <Row label={t("Your session")} value={t("Ends after {n} hours", { n: d.sessionHours })} />
            <Row label={t("Working as someone")} value={t("Ends after {n} hours", { n: d.workAsHours })} />
          </dl>
        </Panel>
      </div>

      <Panel
        level={3} title={t("Data checks")}
        subtitle={<span title={t("Rules that must always be true. If one fails, numbers on screen may be wrong.")}>{t("Rules that must always be true.")}</span>}
      >
        {checks.length === 0 ? <Empty>{t("This could not be read just now.")}</Empty> : (
          <ul aria-label={t("Data checks")} className="grid gap-x-8 gap-y-2.5 md:grid-cols-2">
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
    </div>
  );
}
