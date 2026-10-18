import { CircleAlert, CircleCheck } from "lucide-react";
import type { T } from "@/i18n/translate";
import type { SpeedData } from "@/server/services/developer-health";
import type { CheckResult } from "@/server/services/developer-checks";
import { Panel } from "@/components/dashboard/kit";
import { bytesText, num, Quiet, Tag } from "./console-ui";

/**
 * SPEED & SIZE (as the owner's other console has it): real questions timed now, how big the database is and which tables are the biggest, the
 * rules that must always be true, and what is running right now. Only the system's own tables are counted; never the hotel's records.
 */

/** Under this many milliseconds the database is fast; over the second one it is slow. */
const FAST_MS = 150;
const SLOW_MS = 400;

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

  return (
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
  );
}
