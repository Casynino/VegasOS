import type { ReactNode } from "react";
import { Bug, ChevronDown, KeyRound, ShieldAlert, Timer, Webhook } from "lucide-react";
import type { T } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { LOGIN_LIMITS, type CrashData } from "@/server/services/developer-health";
import { FAILED_SIGN_IN_ROWS_PER_HOUR } from "@/server/services/auth-login";
import type { DeniedEntry } from "@/server/services/developer-console";
import type { ErrorGroup, JobStatus, SystemEvents, WebhookStatus } from "@/server/services/system-events";
import { Panel } from "@/components/dashboard/kit";
import { BarChart, type BarColumn } from "./console-charts";
import { MiniTable, type MiniRow } from "./mini-table";
import { SummaryChips, type Chip } from "./summary-chips";
import { agoText, dayLabel, num, Quiet, StatBlock, Tag } from "./console-ui";

/**
 * ERRORS & JOBS and SIGN-INS & SECURITY: what the system recorded about ITSELF (unexpected server errors, grouped; the automatic jobs; the
 * webhooks), then failed sign-ins, paused sign-ins and what was refused to the Developer. An error is shown as the system stored it:
 * scrubbed (emails, numbers, keys, links' addresses and request bodies taken out), with the top of the code path as "file:line".
 * Owner (2026-10-18): nothing repeated and no empty boxes. A list or chart with nothing to show is NOT drawn (the figures above it already
 * say "0"); a long list scrolls inside its panel with about six rows visible; an explanation is a hover text, not a paragraph.
 */

const FAILED = "#d95926";

/** A scrolling list: about six collapsed rows visible, the rest by scrolling (keyboard reachable). */
const SCROLL_LIST = "max-h-[21.5rem] overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold";

/** A panel title with its longer explanation as the hover text. */
const Titled = ({ text, hint }: { text: string; hint?: string }) => <span title={hint}>{text}</span>;

// ───────────────────────────────────────────── what was refused to the Developer ─────────────────────────────────────────────
/** "Refused to you": drawn ONLY when something was refused (nothing refused = nothing to draw). */
export function DeniedPanel({ t, rows, when }: { t: T; rows: DeniedEntry[]; when: (x: Date) => string }) {
  if (rows.length === 0) return null;
  return (
    <Panel title={t("Refused to you")} subtitle={t("The last {n} times a page or an action was refused to a Developer account.", { n: rows.length })}>
      <MiniTable
        label={t("Refused to you")}
        cols={[{ label: t("When") }, { label: t("Who") }, { label: t("What was refused") }, { label: t("The right it needs") }]}
        rows={rows.map((r) => ({
          key: r.id,
          cells: [
            <span key="w" className="whitespace-nowrap">{when(r.at)}</span>,
            r.who,
            r.kind || r.path ? (
              <span key="k" className="block min-w-0">
                {r.kind ? (r.kind === "page" ? t("A page") : t("An action")) : null}
                {r.path && <span className="block break-all font-mono text-[11px] text-muted-foreground">{r.path}</span>}
              </span>
            ) : null,
            r.needs.length === 0 ? null : (
              <span key="n" className="block min-w-0">
                {r.needs.map((n) => (
                  <span key={n.code} className="block min-w-0 leading-snug">
                    <span className="font-mono text-xs">{n.code}</span>
                    {n.description && <span className="block text-xs text-muted-foreground">{t(n.description)}</span>}
                  </span>
                ))}
              </span>
            ),
          ],
        }))}
      />
    </Panel>
  );
}

// ───────────────────────────────────────────── server errors ─────────────────────────────────────────────
/** How long a job took: "850 ms" or "12.4 s". */
const took = (t: T, ms: number) => (ms < 1000 ? t("{n} ms", { n: ms }) : t("{n} s", { n: (ms / 1000).toLocaleString(t.intl, { maximumFractionDigits: 1 }) }));

function ErrorRow({ t, g, when, now }: { t: T; g: ErrorGroup; when: (x: Date) => string; now: Date }) {
  return (
    <details className="group min-w-0 rounded-2xl border border-border/70 bg-card">
      <summary className="flex cursor-pointer list-none items-start gap-3 rounded-2xl p-3 marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:px-4 [&::-webkit-details-marker]:hidden">
        <span className="mt-0.5 grid h-7 min-w-9 shrink-0 place-items-center rounded-lg bg-rose-500/12 px-2 text-xs font-semibold tabular-nums text-rose-700 dark:text-rose-300" title={t("Times seen")}>{num(t, g.count)}×</span>
        <span className="min-w-0 flex-1 leading-snug">
          <span className="block break-words text-sm font-semibold text-foreground">{g.message || t("(no message)")}</span>
          <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <Tag tone="slate">{t.ctx("error-kind", g.kind)}</Tag>
            <span className="break-all font-mono">{g.source}</span>
            <span>{t("last seen {ago}", { ago: agoText(t, g.lastSeenAt, now) })}</span>
          </span>
        </span>
        <ChevronDown className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-3 border-t border-border/60 px-4 pb-4 pt-3 text-sm">
        <p className="text-xs text-muted-foreground">{t("First seen {first} · last seen {last}", { first: when(g.firstSeenAt), last: when(g.lastSeenAt) })}</p>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("What it means")}</p>
          <p className="mt-1 leading-relaxed text-foreground/90">{t(g.hint.what)}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("What to fix")}</p>
          <p className="mt-1 leading-relaxed text-foreground/90">{t(g.hint.todo)}</p>
        </div>
        {g.frames.length > 0 && (
          <div>
            <p
              className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground"
              title={g.frames.some((f) => /^(src|app|pages)\//.test(f)) ? undefined : t("These lines are in the built code: the hosting does not keep the original file names. The message and the place named above tell where to look.")}
            >{t("Where in the code")}</p>
            <ul className="mt-1 space-y-0.5 break-all font-mono text-xs text-foreground/90">{g.frames.map((f) => <li key={f}>{f}</li>)}</ul>
          </div>
        )}
      </div>
    </details>
  );
}

/** "Server errors": drawn ONLY when the system recorded an error (none = the figure above already says 0; no empty box). */
export function ErrorsPanel({ t, system, when, now }: { t: T; system: SystemEvents | null; when: (x: Date) => string; now: Date }) {
  if (!system || system.errorGroups.length === 0) return null;
  return (
    <Panel
      title={<Titled text={t("Server errors")} hint={t("Last 30 days, one line for each different error. A repeat adds to its count; personal details are taken out.")} />}
      subtitle={t("Last 30 days, one line for each different error.")}
    >
      <div tabIndex={0} role="region" aria-label={t("Server errors")} className={cn("space-y-2", SCROLL_LIST)}>
        {system.errorGroups.map((g) => <ErrorRow key={g.id} t={t} g={g} when={when} now={now} />)}
      </div>
    </Panel>
  );
}

// ───────────────────────────────────────────── jobs and webhooks ─────────────────────────────────────────────
export function JobsPanel({ t, jobs, when, now }: { t: T; jobs: JobStatus[] | null; when: (x: Date) => string; now: Date }) {
  if (!jobs) return <Quiet>{t("This could not be read just now.")}</Quiet>;
  // No run recorded at all and nothing late: ONE quiet line, not a table full of dashes. A job that never ran and is late still gets its row.
  if (jobs.every((j) => j.lastRunAt === null && !j.overdue)) return <Quiet>{t("No automatic job has run since the system started recording.")}</Quiet>;
  return (
    <Panel
      title={<Titled text={t("Automatic jobs")} hint={t("What the system runs by itself on a timer. Late means not run for 1.5 times its longest gap. Hotel time.")} />}
      subtitle={t("Runs by itself on a timer. Hotel time.")}
    >
      <MiniTable
        label={t("Automatic jobs")}
        cols={[{ label: t("Job") }, { label: t("Runs at") }, { label: t("Last run") }, { label: t("Last time it went well") }, { label: t("Last result") }, { label: t("Took"), num: true }, { label: t("On time?") }]}
        rows={jobs.map((j) => ({
          key: j.job,
          cells: [
            <span key="j" className="block min-w-0"><span className="font-medium">{t(j.label)}</span> <span className="break-all font-mono text-[11px] text-muted-foreground">{j.job}</span></span>,
            j.schedule ? <span key="s" className="tabular-nums">{j.schedule}</span> : null,
            j.lastRunAt ? <span key="r" className="block">{when(j.lastRunAt)} <span className="text-[11px] text-muted-foreground">{agoText(t, j.lastRunAt, now)}</span></span> : <span key="r" className="text-muted-foreground">{t("Not recorded yet")}</span>,
            // the same moment as the last run is not said twice: this column is for a job whose last run failed
            j.lastOkAt && j.lastOkAt.getTime() !== j.lastRunAt?.getTime() ? <span key="o" className="whitespace-nowrap">{when(j.lastOkAt)}</span> : null,
            j.lastStatus === null ? null : (
              <span key="st" className="block min-w-0">
                <Tag tone={j.lastStatus === "OK" ? "emerald" : "rose"}>{j.lastStatus === "OK" ? t("Went well") : t("Failed")}</Tag>
                {j.lastError && <span className="mt-1 block break-words text-xs text-muted-foreground">{j.lastError}</span>}
              </span>
            ),
            j.lastDurationMs === null ? null : took(t, j.lastDurationMs),
            <Tag key="od" tone={j.overdue ? "rose" : j.lastRunAt ? "emerald" : "slate"}>{j.overdue ? t("Late") : j.lastRunAt ? t("On time") : t("Not recorded yet")}</Tag>,
          ],
        }))}
      />
    </Panel>
  );
}

/** "webhook:ntzs" in plain words. */
const hookName = (t: T, source: string) => (/ntzs/i.test(source) ? t("nTZS payment messages") : source);

export function WebhooksPanel({ t, hooks, when }: { t: T; hooks: WebhookStatus[] | null; when: (x: Date) => string }) {
  if (!hooks) return <Quiet>{t("This could not be read just now.")}</Quiet>;
  // Nothing has ever arrived from any service: one quiet line, not a row of "None yet" and zeros.
  if (hooks.every((h) => h.lastOkAt === null && h.lastFailedAt === null && h.ok7d + h.failed7d + h.refused7d === 0)) return <Quiet>{t("No message from other services has arrived yet.")}</Quiet>;
  return (
    <Panel title={t("Messages from other services (webhooks)")} subtitle={t("Last 7 days")}>
      <MiniTable
        label={t("Messages from other services (webhooks)")}
        cols={[{ label: t("From") }, { label: t("Last accepted") }, { label: t("Last failed") }, { label: t("Accepted, 7 days"), num: true }, { label: t("Failed, 7 days"), num: true }, { label: t("Refused (bad signature), 7 days"), num: true }]}
        rows={hooks.map((h) => ({
          key: h.source,
          cells: [
            <span key="n" className="block min-w-0"><span className="font-medium">{hookName(t, h.source)}</span> <span className="break-all font-mono text-[11px] text-muted-foreground">{h.source}</span></span>,
            h.lastOkAt ? <span key="o" className="whitespace-nowrap">{when(h.lastOkAt)}</span> : <span key="o" className="text-muted-foreground">{t("None yet")}</span>,
            h.lastFailedAt ? <span key="f" className="whitespace-nowrap">{when(h.lastFailedAt)}</span> : null,
            num(t, h.ok7d),
            // a column of zeros is not drawn: the cards above already say "none failed"
            h.failed7d > 0 ? <span key="n7" className="font-semibold text-rose-700 dark:text-rose-300">{num(t, h.failed7d)}</span> : null,
            h.refused7d > 0 ? num(t, h.refused7d) : null,
          ],
        }))}
      />
    </Panel>
  );
}

/** Server errors, the automatic jobs and the messages other services send: four figures, then only the lists that have something to say. */
export function ErrorsTab({ t, c, when, now = new Date() }: { t: T; c: CrashData; when: (x: Date) => string; now?: Date }) {
  const sys = c.system;
  if (!sys) return <Quiet>{t("This could not be read just now.")}</Quiet>;
  const late = sys.jobs.filter((j) => j.overdue).length;
  const failedJobs = sys.jobs.filter((j) => j.lastStatus === "FAILED").length;
  const goodJobs = sys.jobs.filter((j) => j.lastRunAt !== null && !j.overdue && j.lastStatus !== "FAILED").length;
  const hook = sys.webhooks.find((w) => /ntzs/i.test(w.source)) ?? null;
  return (
    <div className="space-y-3">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatBlock
          icon={Bug} label={t("Server errors")} value={num(t, sys.errors24h)} caption={t("different errors in 24 hours")} warn={sys.errors24h > 0}
          tag={sys.errors24h > 0 ? t("Look at it") : t("Quiet")} tagTone={sys.errors24h ? "amber" : "emerald"}
          note={t("Errors the server did not expect. The same error again counts once here; its line below says how many times.")}
        />
        <StatBlock
          icon={Timer} label={t("Automatic jobs")} value={t("{ok} of {n}", { ok: goodJobs, n: sys.jobs.length })} caption={t("on time and well")}
          warn={!!(late || failedJobs)}
          tag={late || failedJobs ? t("Look at it") : goodJobs === sys.jobs.length ? t("On time") : t("Not recorded yet")} tagTone={late || failedJobs ? "rose" : goodJobs === sys.jobs.length ? "emerald" : "slate"}
          note={t("Late: {late}. Failed on the last run: {failed}.", { late, failed: failedJobs })}
        />
        <StatBlock
          icon={Webhook} label={t("nTZS messages")} value={num(t, hook?.ok7d)} caption={t("accepted in 7 days")} warn={!!hook?.failed7d}
          tag={hook ? (hook.failed7d > 0 ? t("{n} failed", { n: hook.failed7d }) : t("None failed")) : undefined} tagTone={hook?.failed7d ? "rose" : "emerald"}
          note={t("What nTZS tells the system about payments. When none arrive, payments are found only by asking nTZS.")}
        />
        <StatBlock
          icon={ShieldAlert} label={t("Refused calls")} value={num(t, hook?.refused7d)} caption={t("bad signature, 7 days")}
          tag={hook ? t("Not a failure") : undefined} tagTone="slate"
          note={t("Anyone on the internet can call the payment address. A call with a wrong signature is refused and shown here, apart; it never counts as nTZS failing.")}
        />
      </div>
      <ErrorsPanel t={t} system={sys} when={when} now={now} />
      <JobsPanel t={t} jobs={sys.jobs} when={when} now={now} />
      <WebhooksPanel t={t} hooks={sys.webhooks} when={when} />
    </div>
  );
}

// ───────────────────────────────────────────── failed sign-ins ─────────────────────────────────────────────
/**
 * "Failed tries": ONE list of the addresses the wrong tries came from (most first), each with the accounts that were tried there lately.
 * One address trying many accounts is a warning sign. A try with no address on record cannot be grouped: it is one last row, with only
 * the account names (the numbers would be a guess). Drawn ONLY when there is something.
 */
function failedTriesPanel(t: T, c: CrashData, when: (x: Date) => string): ReactNode {
  const latest = c.failed?.latest ?? [];
  const namesAt = new Map<string, string[]>();
  const loose: typeof latest = [];
  for (const r of latest) {
    if (!r.ip) { loose.push(r); continue; }
    const list = namesAt.get(r.ip) ?? [];
    if (!list.includes(r.name)) list.push(r.name);
    namesAt.set(r.ip, list);
  }
  const names = (list: string[]) => (list.length > 0 ? <span className="block break-words text-[11px] text-muted-foreground">{list.join(", ")}</span> : null);
  const rows: MiniRow[] = (c.byAddress ?? []).map((r) => ({
    key: r.ip,
    cells: [
      <span key="a" className="block min-w-0"><span className="block break-all font-mono text-xs">{r.ip}</span>{names(namesAt.get(r.ip) ?? [])}</span>,
      <span key="c" className={r.accounts > 1 ? "font-semibold text-amber-700 dark:text-amber-300" : undefined}>{num(t, r.accounts)}</span>,
      <span key="t" className="font-semibold">{num(t, r.tries)}</span>,
      <span key="l" className="whitespace-nowrap text-xs text-muted-foreground">{when(r.last)}</span>,
    ],
  }));
  if (loose.length > 0) {
    const list = [...new Set(loose.map((r) => r.name))];
    rows.push({
      key: "no-address",
      cells: [
        <span key="a" className="block min-w-0"><span className="block text-xs text-muted-foreground">{t("No address on record")}</span>{names(list)}</span>,
        // not counted: only the latest tries are known here, so a number would be lower than the real one
        null, null,
        <span key="l" className="whitespace-nowrap text-xs text-muted-foreground">{when(loose.reduce((a, r) => (r.at > a ? r.at : a), loose[0].at))}</span>,
      ],
    });
  }
  if (rows.length === 0) return null;
  return (
    <Panel
      key="tries"
      title={<Titled
        text={t("Failed tries")}
        hint={`${t("One address trying many accounts is a warning sign.")} ${t("Only real accounts are written down — an email nobody holds is not. At most {n} tries for one account are written down each hour; if there are more, one line says so and the numbers here are lower than the real tries.", { n: FAILED_SIGN_IN_ROWS_PER_HOUR })}`}
      />}
      subtitle={t("Last 7 days")}
    >
      <MiniTable
        label={t("Failed tries")}
        cols={[{ label: t("Address") }, { label: t("Accounts tried"), num: true }, { label: t("Tries"), num: true }, { label: t("Last try") }]}
        rows={rows}
      />
    </Panel>
  );
}

/**
 * Failed and successful sign-ins, paused sign-ins, and what was refused to the Developer: ONE line of chips, the Developer's own sign-in as
 * one slim line, then only the panels that have something to show (a chart and a list of wrong tries, a list of refusals). Nothing wrong
 * = just the line.
 */
export function SecurityTab({ t, c, when }: { t: T; c: CrashData; when: (x: Date) => string; now?: Date }) {
  const f = c.failed;
  const paused = c.paused ? c.paused.developer + c.paused.staff : null;
  const refusedWeek = c.deniedByDay ? c.deniedByDay.reduce((n, d) => n + d.count, 0) : 0;
  const columns: BarColumn[] | null = f
    ? f.byDay.map((d, i, all) => ({
        key: d.date, tick: dayLabel(t, d.date), name: dayLabel(t, d.date),
        values: { failed: d.count, denied: c.deniedByDay?.[i]?.count ?? 0 }, emphasise: i === all.length - 1,
      }))
    : null;

  const chips: Chip[] = [
    {
      key: "failed", text: t("Failed sign-ins in 14 days: {n}", { n: num(t, c.failed14d) }), tone: c.failed14d ? "amber" : "slate",
      title: t("Wrong password or a blocked account. A few are typing mistakes; a spike on one day, or many tries from one address, means someone is guessing."),
    },
    { key: "ok", text: t("Successful: {n}", { n: num(t, c.successful14d) }), title: t("Each time someone signed in with the right password, staff together.") },
    {
      key: "locked", text: t("Locked out now: {n}", { n: num(t, paused) }), tone: paused ? "amber" : "slate",
      title: t("An address is refused for {m} minutes after {n} wrong passwords, even if the right one is tried next. It opens again by itself.", { n: LOGIN_LIMITS.staffPlace, m: LOGIN_LIMITS.windowMinutes }),
    },
  ];
  if (c.denied.length > 0) chips.push({ key: "refused", text: t("Refused to you: {n}", { n: c.denied.length }), tone: "amber" });
  if (f && f.last7d === 0) chips.push({ key: "quiet", text: t("No wrong tries in the last 7 days"), tone: "emerald" });

  const panels: ReactNode[] = [];
  if (f && columns && (f.last7d > 0 || refusedWeek > 0)) {
    panels.push(
      <Panel key="chart" title={t("Failed sign-ins and refused Developer actions per day")} subtitle={f.last24h ? t("{n} wrong tries in the last 24 hours.", { n: f.last24h }) : t("No failed sign-ins in the last 24 hours.")}>
        <BarChart
          t={t} columns={columns} grouped caption={t("Failed sign-ins and refused Developer actions per day")} empty={t("No failed sign-ins in the last 7 days.")}
          series={[{ key: "failed", label: t("Failed sign-ins"), color: FAILED }, { key: "denied", label: t("Developer actions refused"), color: "#c0392b" }]}
        />
      </Panel>,
    );
  }
  const tries = f ? failedTriesPanel(t, c, when) : null;
  if (tries) panels.push(tries);
  if (c.denied.length > 0) panels.push(<DeniedPanel key="denied" t={t} rows={c.denied} when={when} />);

  return (
    <div className="space-y-3">
      <SummaryChips label={t("Sign-ins & security")} items={chips} />
      <p className="flex items-start gap-2 text-sm text-muted-foreground">
        <KeyRound className="mt-0.5 size-4 shrink-0" aria-hidden />
        <span>
          <span className="font-medium text-foreground">{t("Your Developer sign-in")}</span>{" · "}
          {f && f.own24h > 0
            ? t("{n} wrong-password tries on your account in the last 24 hours. After {max} wrong tries from one place it locks for {min} minutes.", { n: f.own24h, max: LOGIN_LIMITS.developerEmail, min: LOGIN_LIMITS.windowMinutes })
            : t("No wrong-password tries on your account in the last 24 hours. After {max} wrong tries from one place it locks for {min} minutes.", { max: LOGIN_LIMITS.developerEmail, min: LOGIN_LIMITS.windowMinutes })}
        </span>
      </p>
      {!f && <Quiet>{t("This could not be read just now.")}</Quiet>}
      {panels.length > 0 && (
        <div className="grid items-start gap-3 lg:grid-cols-2">
          {panels.map((p, i) => <div key={i} className={cn("min-w-0", panels.length % 2 === 1 && i === panels.length - 1 && "lg:col-span-2")}>{p}</div>)}
        </div>
      )}
    </div>
  );
}

/** Both together (the old "Crashes & sign-ins" page): the errors, then the sign-ins. */
export function CrashesTab({ t, c, when, now = new Date() }: { t: T; c: CrashData; when: (x: Date) => string; now?: Date }) {
  return (
    <div className="space-y-4">
      <ErrorsTab t={t} c={c} when={when} now={now} />
      <SecurityTab t={t} c={c} when={when} now={now} />
    </div>
  );
}
