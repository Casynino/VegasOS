import type { ReactNode } from "react";
import { Bug, ChevronDown, CircleCheck, Clock, KeyRound, Lock, LockOpen, ShieldAlert, Timer, TriangleAlert, UserX, Users } from "lucide-react";
import type { T } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { LOGIN_LIMITS, type CrashData } from "@/server/services/developer-health";
import { FAILED_SIGN_IN_ROWS_PER_HOUR } from "@/server/services/auth-login";
import type { DeniedEntry } from "@/server/services/developer-console";
import type { ErrorGroup, SystemEvents, WebhookStatus, JobStatus } from "@/server/services/system-events";
import { Panel } from "@/components/dashboard/kit";
import { BarChart, type BarColumn } from "./console-charts";
import { EmptyLine, MiniTable, SCROLL_ABOVE, TABLE_BLEED, type MiniRow } from "./mini-table";
import { agoText, dayLabel, num, Quiet, StatBlock, Tag, type TagTone } from "./console-ui";

/**
 * ERRORS & JOBS and SIGN-INS & SECURITY, drawn like the owner's Target console (2026-10-18: "copy this look exactly"): four figure cards, then
 * the panels — each with its title, one line under it, and its table or list running edge to edge. What the system recorded about ITSELF
 * (unexpected server errors, grouped; the automatic jobs; the webhooks), then failed sign-ins, paused sign-ins and what was refused to the Developer.
 * An error is shown as the system stored it: scrubbed (emails, numbers, keys, links' addresses and request bodies taken out), with the top of the
 * code path as "file:line".
 * Rules (owner): nothing said twice and no paragraph (an explanation is a hover text); a panel with nothing to show keeps its title and subtitle and
 * says so in ONE short centred line (no tall empty box, no empty chart frame); a list of more than a few rows scrolls inside its panel.
 */

const FAILED = "#d95926";
const REFUSED = "#c0392b";

/** A scrolling list: about 24 rem visible, the rest by scrolling (keyboard reachable). */
const SCROLL_LIST = "max-h-[24rem] overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold";

/** A panel's title or subtitle with its longer explanation as the hover text. */
const Titled = ({ text, hint }: { text: string; hint?: string }) => <span title={hint}>{text}</span>;

/** A status in a table: a small rounded pill in normal case (the cards' tags are capitals). */
const StatusPill = ({ tone, children }: { tone: TagTone; children: ReactNode }) => (
  <Tag tone={tone} className="normal-case tracking-normal text-xs font-medium">{children}</Tag>
);

/** The count of a panel's list, small, on the right of its heading. */
const CountBadge = ({ n }: { n: number }) => <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{n}</span>;

/** A long source name kept to one short line for a card. */
const shorten = (text: string, max = 40) => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/** Every other day is written under its bar (today always), so the labels never touch, even on a phone. */
const dayTick = (i: number, count: number) => (count - 1 - i) % 2 === 0;

// ───────────────────────────────────────────── what was refused to the Developer ─────────────────────────────────────────────
/** "Refused to you": a green line when nothing was refused, else the list of refusals. */
export function DeniedPanel({ t, rows, when }: { t: T; rows: DeniedEntry[]; when: (x: Date) => string }) {
  return (
    <Panel
      level={3} title={t("Refused to you")} subtitle={t("The last times a page or an action was refused to the Developer account.")}
      action={rows.length > 0 ? <CountBadge n={rows.length} /> : undefined} bodyClassName={TABLE_BLEED}
    >
      {rows.length === 0 ? (
        <div className="border-t border-border/60 pt-4 sm:px-6 sm:pb-6">
          <p className="flex items-center gap-2.5 rounded-xl bg-emerald-500/[0.09] px-4 py-3 text-sm text-emerald-800 dark:text-emerald-200">
            <CircleCheck className="size-4 shrink-0" aria-hidden />{t("Nothing was refused to a Developer account.")}
          </p>
        </div>
      ) : (
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
      )}
    </Panel>
  );
}

// ───────────────────────────────────────────── server errors ─────────────────────────────────────────────
/** How long a job took: "850 ms" or "12.4 s". */
const took = (t: T, ms: number) => (ms < 1000 ? t("{n} ms", { n: ms }) : t("{n} s", { n: (ms / 1000).toLocaleString(t.intl, { maximumFractionDigits: 1 }) }));

function ErrorRow({ t, g, when, now }: { t: T; g: ErrorGroup; when: (x: Date) => string; now: Date }) {
  return (
    <details className="group min-w-0 border-b border-border/60 last:border-b-0">
      <summary className="flex cursor-pointer list-none items-start gap-3 py-3.5 marker:content-none hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold sm:px-6 [&::-webkit-details-marker]:hidden">
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
      <div className="space-y-3 pb-4 pt-1 text-sm sm:px-6">
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

/** "Server errors": the list of different errors (it scrolls), or ONE green line when the system recorded none. */
export function ErrorsPanel({ t, system, when, now }: { t: T; system: SystemEvents | null; when: (x: Date) => string; now: Date }) {
  const groups = system?.errorGroups ?? [];
  const scrolls = groups.length > SCROLL_ABOVE - 3;
  return (
    <Panel
      level={3} title={t("Server errors")} bodyClassName={TABLE_BLEED}
      subtitle={t("Last 30 days, one line for each different error. A repeat adds to its count; emails and numbers are taken out.")}
      action={groups.length > 0 ? <CountBadge n={groups.length} /> : undefined}
    >
      {!system ? (
        <EmptyLine>{t("This could not be read just now.")}</EmptyLine>
      ) : groups.length === 0 ? (
        <EmptyLine tone="good" hint={t("Mistakes people make, like a wrong password or a refused action, are not errors and are not recorded here.")}>
          {t("Nothing yet. No unexpected server error has been recorded.")}
        </EmptyLine>
      ) : (
        <div {...(scrolls ? { tabIndex: 0, role: "region", "aria-label": t("Server errors") } : {})} className={cn("border-t border-border/60", scrolls && SCROLL_LIST)}>
          {groups.map((g) => <ErrorRow key={g.id} t={t} g={g} when={when} now={now} />)}
        </div>
      )}
    </Panel>
  );
}

// ───────────────────────────────────────────── jobs and webhooks ─────────────────────────────────────────────
/** "04:05 · 06:15" (the hotel's clock, from the system) in plain words: "Every day 06:05", or "Every day" with the times under it. */
function runsAt(t: T, schedule: string): ReactNode {
  if (!schedule) return null;
  if (!schedule.includes("·")) return <span className="whitespace-nowrap tabular-nums">{t("Every day {time}", { time: schedule })}</span>;
  return (
    <span className="block min-w-0">
      <span className="block">{t("Every day")}</span>
      <span className="block max-w-[15rem] text-xs tabular-nums text-muted-foreground">{schedule}</span>
    </span>
  );
}

export function JobsPanel({ t, jobs, when, now }: { t: T; jobs: JobStatus[] | null; when: (x: Date) => string; now: Date }) {
  return (
    <Panel
      level={3} title={t("Automatic jobs")} bodyClassName={TABLE_BLEED}
      subtitle={<Titled text={t("What the system runs by itself on a timer. Hotel time. A job writes a line each time it runs.")} hint={t("Late means the job has not run for 1.5 times the longest gap between two of its scheduled runs.")} />}
    >
      {!jobs ? <EmptyLine>{t("This could not be read just now.")}</EmptyLine> : jobs.length === 0 ? <EmptyLine>{t("Nothing yet. No automatic job is set up.")}</EmptyLine> : (
        <MiniTable
          keepEmpty label={t("Automatic jobs")}
          cols={[{ label: t("Job") }, { label: t("Runs at") }, { label: t("Last run") }, { label: t("Last time it went well") }, { label: t("Last result") }, { label: t("Took"), num: true }, { label: t("On time?"), right: true }]}
          rows={jobs.map((j) => ({
            key: j.job,
            cells: [
              <span key="j" className="block min-w-0"><span className="block font-medium">{t(j.label)}</span><span className="block break-all font-mono text-[11px] text-muted-foreground">{j.job}</span></span>,
              runsAt(t, j.schedule),
              j.lastRunAt
                ? <span key="r" className="block"><span className="block whitespace-nowrap">{agoText(t, j.lastRunAt, now)}</span><span className="block whitespace-nowrap text-xs text-muted-foreground">{when(j.lastRunAt)}</span></span>
                : <span key="r" className="text-muted-foreground">{t("Not recorded yet")}</span>,
              j.lastOkAt ? <span key="o" className="whitespace-nowrap" title={when(j.lastOkAt)}>{agoText(t, j.lastOkAt, now)}</span> : null,
              j.lastStatus === null ? null : (
                <span key="st" className="block min-w-0">
                  <StatusPill tone={j.lastStatus === "OK" ? "emerald" : "rose"}>{j.lastStatus === "OK" ? t("Went well") : t("Failed")}</StatusPill>
                  {j.lastError && <span className="mt-1 block break-words text-xs text-muted-foreground">{j.lastError}</span>}
                </span>
              ),
              j.lastDurationMs === null ? null : took(t, j.lastDurationMs),
              j.overdue ? <StatusPill key="od" tone="rose">{t("Late")}</StatusPill>
                : j.lastStatus === "FAILED" ? <StatusPill key="od" tone="rose">{t("Failed")}</StatusPill>
                : j.lastRunAt ? <StatusPill key="od" tone="emerald">{t("On time")}</StatusPill>
                : <StatusPill key="od" tone="slate">{t("Not recorded yet")}</StatusPill>,
            ],
          }))}
        />
      )}
    </Panel>
  );
}

/** "webhook:ntzs" in plain words. */
const hookName = (t: T, source: string) => (/ntzs/i.test(source) ? t("nTZS payment messages") : source);

export function WebhooksPanel({ t, hooks, when }: { t: T; hooks: WebhookStatus[] | null; when: (x: Date) => string }) {
  return (
    <Panel
      level={3} bodyClassName={TABLE_BLEED}
      title={<Titled
        text={t("Messages from other services (webhooks)")}
        hint={`${t("What nTZS tells the system about payments. When none arrive, payments are found only by asking nTZS.")} ${t("Anyone on the internet can call the payment address. A call with a wrong signature is refused and shown here, apart; it never counts as nTZS failing.")}`}
      />}
      subtitle={t("What other services, such as nTZS, tell the system. The last 7 days.")}
    >
      {!hooks ? <EmptyLine>{t("This could not be read just now.")}</EmptyLine> : (
        <MiniTable
          keepEmpty label={t("Messages from other services (webhooks)")}
          cols={[{ label: t("From") }, { label: t("Last accepted") }, { label: t("Last failed") }, { label: t("Accepted, 7 days"), num: true }, { label: t("Failed, 7 days"), num: true }, { label: t("Refused (bad signature), 7 days"), num: true }]}
          rows={hooks.map((h) => ({
            key: h.source,
            cells: [
              <span key="n" className="block min-w-0"><span className="block font-medium">{hookName(t, h.source)}</span><span className="block break-all font-mono text-[11px] text-muted-foreground">{h.source}</span></span>,
              h.lastOkAt ? <span key="o" className="whitespace-nowrap">{when(h.lastOkAt)}</span> : <span key="o" className="text-muted-foreground">{t("None yet")}</span>,
              h.lastFailedAt ? <span key="f" className="whitespace-nowrap">{when(h.lastFailedAt)}</span> : null,
              num(t, h.ok7d),
              <span key="n7" className={h.failed7d > 0 ? "font-semibold text-rose-700 dark:text-rose-300" : undefined}>{num(t, h.failed7d)}</span>,
              num(t, h.refused7d),
            ],
          }))}
        />
      )}
    </Panel>
  );
}

/** Server errors, the automatic jobs and the messages other services send: four figures, then the three panels. */
export function ErrorsTab({ t, c, when, now = new Date() }: { t: T; c: CrashData; when: (x: Date) => string; now?: Date }) {
  const sys = c.system;
  if (!sys) return <Quiet>{t("This could not be read just now.")}</Quiet>;
  const late = sys.jobs.filter((j) => j.overdue).length;
  const failedJobs = sys.jobs.filter((j) => j.lastStatus === "FAILED").length;
  const goodJobs = sys.jobs.filter((j) => j.lastRunAt !== null && !j.overdue && j.lastStatus !== "FAILED").length;
  const newestError = sys.errorGroups[0] ?? null;
  // the job that ran most lately
  const newestRun = sys.jobs.reduce<JobStatus | null>((a, j) => (j.lastRunAt && (!a || !a.lastRunAt || j.lastRunAt > a.lastRunAt) ? j : a), null);
  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatBlock
          icon={Bug} label={t("Server errors")} value={num(t, sys.errors24h)} caption={t("different errors in 24 hours")} warn={sys.errors24h > 0}
          tag={sys.errors24h > 0 ? t("Look at it") : t("Quiet")} tagTone={sys.errors24h ? "amber" : "emerald"}
          note={t("Errors the server did not expect. The same error again counts once here; its line below says how many times.")}
        />
        <StatBlock
          icon={Timer} label={t("Automatic jobs")} value={t("{ok} of {n}", { ok: goodJobs, n: sys.jobs.length })} caption={t("on time and well")}
          warn={!!(late || failedJobs)}
          tag={late ? t("Late") : failedJobs ? t("Failed") : goodJobs === sys.jobs.length && goodJobs > 0 ? t("All on time") : t("Not recorded yet")}
          tagTone={late || failedJobs ? "rose" : goodJobs === sys.jobs.length && goodJobs > 0 ? "emerald" : "slate"}
          note={t("Late: {late}. Failed on the last run: {failed}.", { late, failed: failedJobs })}
        />
        <StatBlock
          icon={TriangleAlert} label={t("Last error")} value={newestError ? agoText(t, newestError.lastSeenAt, now) : t("None")}
          caption={newestError ? shorten(newestError.source) : t("nothing recorded yet")} tag={t("Server")} tagTone="slate"
          note={newestError ? when(newestError.lastSeenAt) : undefined}
        />
        <StatBlock
          icon={Clock} label={t("Last job run")} value={newestRun?.lastRunAt ? agoText(t, newestRun.lastRunAt, now) : t("None yet")}
          caption={newestRun?.lastRunAt ? t(newestRun.label) : t("waiting for the first run")} tag={t("Schedule")} tagTone="slate"
          note={newestRun?.lastRunAt ? when(newestRun.lastRunAt) : undefined}
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
 * "Failed tries by address": the addresses the wrong tries came from (most first), each with the accounts that were tried there lately.
 * One address trying many accounts is a warning sign. A try with no address on record cannot be grouped: it is one last row, with only
 * the account names (the numbers would be a guess).
 */
function AddressPanel({ t, c, when, now }: { t: T; c: CrashData; when: (x: Date) => string; now: Date }) {
  const latest = c.failed?.latest ?? [];
  const namesAt = new Map<string, string[]>();
  const loose: typeof latest = [];
  for (const r of latest) {
    if (!r.ip) { loose.push(r); continue; }
    const list = namesAt.get(r.ip) ?? [];
    if (!list.includes(r.name)) list.push(r.name);
    namesAt.set(r.ip, list);
  }
  const names = (list: string[]) => (list.length > 0 ? <span className="mt-0.5 block break-words text-[11px] text-muted-foreground">{list.join(", ")}</span> : null);
  const rows: MiniRow[] = (c.byAddress ?? []).map((r) => ({
    key: r.ip,
    cells: [
      <span key="a" className="block min-w-0"><span className="block break-all font-mono text-xs">{r.ip}</span>{names(namesAt.get(r.ip) ?? [])}</span>,
      <span key="t" className="font-semibold">{num(t, r.tries)}</span>,
      <span key="c" className={r.accounts > 1 ? "font-semibold text-amber-700 dark:text-amber-300" : undefined}>{num(t, r.accounts)}</span>,
      <span key="l" className="whitespace-nowrap text-muted-foreground">{agoText(t, r.last, now)}</span>,
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
        <span key="l" className="whitespace-nowrap text-muted-foreground">{when(loose.reduce((a, r) => (r.at > a ? r.at : a), loose[0].at))}</span>,
      ],
    });
  }
  return (
    <Panel
      level={3} title={t("Failed tries by address")} subtitle={t("Last 7 days. One address trying many accounts is a warning sign.")}
      bodyClassName={TABLE_BLEED}
    >
      {c.byAddress === null ? <EmptyLine>{t("This could not be read just now.")}</EmptyLine> : rows.length === 0 ? (
        <EmptyLine>{t("Nothing yet. No wrong try with an address in the last 7 days.")}</EmptyLine>
      ) : (
        <MiniTable label={t("Failed tries by address")} cols={[{ label: t("Address") }, { label: t("Tries"), num: true }, { label: t("Accounts"), num: true }, { label: t("Last"), right: true }]} rows={rows} />
      )}
    </Panel>
  );
}

/** "Latest failed tries": the newest wrong tries, the same account from the same place within a minute merged into one line (×N). */
function LatestPanel({ t, c, when, now }: { t: T; c: CrashData; when: (x: Date) => string; now: Date }) {
  const latest = c.failed?.latest ?? [];
  return (
    <Panel
      level={3} title={t("Latest failed tries")} bodyClassName={TABLE_BLEED}
      subtitle={<Titled
        text={t("Latest refused attempts. Passwords are never stored. Repeats within a minute are merged (×N).")}
        hint={t("Only real accounts are written down — an email nobody holds is not. At most {n} tries for one account are written down each hour; if there are more, one line says so and the numbers here are lower than the real tries.", { n: FAILED_SIGN_IN_ROWS_PER_HOUR })}
      />}
    >
      {latest.length === 0 ? <EmptyLine>{t("Nothing yet. No account was tried wrongly in the last 7 days.")}</EmptyLine> : (
        <ul className="divide-y divide-border/60 border-t border-border/60 text-sm">
          {latest.map((r) => (
            <li key={r.id} className="py-3 sm:px-6">
              <span className="block break-words font-medium leading-tight">{r.name}{r.times > 1 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">×{r.times}</span>}</span>
              <span className="mt-0.5 block text-xs text-muted-foreground" title={when(r.at)}>{agoText(t, r.at, now)}{r.ip ? <> · <span className="font-mono">{r.ip}</span></> : null}</span>
            </li>
          ))}
        </ul>
      )}
    </Panel>
  );
}

/**
 * Failed and successful sign-ins, the Developer's own lock and the places locked out, then the chart of wrong tries per day beside the
 * latest tries, the addresses beside what was refused to the Developer, and the Developer's own sign-in in one line.
 */
export function SecurityTab({ t, c, when, now = new Date() }: { t: T; c: CrashData; when: (x: Date) => string; now?: Date }) {
  const f = c.failed;
  const paused = c.paused ? c.paused.developer + c.paused.staff : null;
  const developerLocked = c.paused ? c.paused.developer > 0 : null;
  const perDay = c.perDay;
  const columns: BarColumn[] | null = perDay
    ? perDay.map((d, i, all) => ({
        key: d.date, tick: dayTick(i, all.length) ? dayLabel(t, d.date) : "", name: dayLabel(t, d.date),
        values: { failed: d.failed, denied: d.denied }, emphasise: i === all.length - 1,
      }))
    : null;
  const hasChart = !!perDay?.some((d) => d.failed + d.denied > 0);
  const chartTitle = t("Failed sign-ins and refused Developer actions per day");

  return (
    <div className="space-y-4">
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatBlock
          icon={UserX} label={t("Failed sign-ins")} value={num(t, c.failed14d)} caption={t("in 14 days")} warn={!!f?.last24h}
          tag={c.failed14d === null ? undefined : c.failed14d > 0 ? t("Look at it") : t("Quiet")} tagTone={c.failed14d ? "amber" : "emerald"}
          note={t("Wrong password or a blocked account. A few are typing mistakes; a spike on one day, or many tries from one address, means someone is guessing.")}
        />
        <StatBlock
          icon={Users} label={t("Successful sign-ins")} value={num(t, c.successful14d)} caption={t("in 14 days")}
          tag={c.successful14d === null ? undefined : t("Sign-ins")} tagTone="sky"
          note={t("Each time someone signed in with the right password, staff together.")}
        />
        <StatBlock
          icon={developerLocked ? Lock : LockOpen} label={t("Developer sign-in locked")} value={developerLocked === null ? "—" : developerLocked ? t("Yes") : t("No")}
          caption={t("after {n} wrong tries in {m} minutes", { n: LOGIN_LIMITS.developerEmail, m: LOGIN_LIMITS.windowMinutes })} warn={!!developerLocked}
          tag={developerLocked === null ? undefined : developerLocked ? t("Locked") : t("Open")} tagTone={developerLocked ? "rose" : "emerald"}
          note={t("The Developer account is refused for {m} minutes after {n} wrong passwords, even if the right one is tried next. It opens again by itself.", { n: LOGIN_LIMITS.developerEmail, m: LOGIN_LIMITS.windowMinutes })}
        />
        <StatBlock
          icon={ShieldAlert} label={t("Locked out now")} value={num(t, paused)} caption={t("after {n} wrong tries in {m} minutes", { n: LOGIN_LIMITS.staffPlace, m: LOGIN_LIMITS.windowMinutes })} warn={!!paused}
          tag={paused === null ? undefined : paused ? t("Look at it") : t("None")} tagTone={paused ? "amber" : "emerald"}
          note={t("An address is refused for {m} minutes after {n} wrong passwords, even if the right one is tried next. It opens again by itself.", { n: LOGIN_LIMITS.staffPlace, m: LOGIN_LIMITS.windowMinutes })}
        />
      </div>

      {!f ? (
        <>
          <Quiet>{t("This could not be read just now.")}</Quiet>
          <DeniedPanel t={t} rows={c.denied} when={when} />
        </>
      ) : (
        <>
          <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
            <Panel
              level={3} title={chartTitle} bodyClassName={hasChart ? undefined : TABLE_BLEED}
              subtitle={f.last24h ? t("{n} wrong tries in the last 24 hours.", { n: f.last24h }) : t("No failed sign-ins in the last 24 hours.")}
            >
              {!columns ? <EmptyLine>{t("This could not be read just now.")}</EmptyLine> : hasChart ? (
                <BarChart
                  t={t} columns={columns} grouped caption={chartTitle} empty={t("No failed sign-ins in the last 14 days.")}
                  series={[{ key: "failed", label: t("Failed sign-ins"), color: FAILED }, { key: "denied", label: t("Developer actions refused"), color: REFUSED }]}
                />
              ) : (
                <EmptyLine>{t("Nothing yet. No failed sign-in and no refused Developer action in the last 14 days.")}</EmptyLine>
              )}
            </Panel>
            <LatestPanel t={t} c={c} when={when} now={now} />
          </div>
          <div className="grid gap-4 lg:grid-cols-2">
            <AddressPanel t={t} c={c} when={when} now={now} />
            <DeniedPanel t={t} rows={c.denied} when={when} />
          </div>
          <div className={cn("flex items-start gap-4 rounded-2xl border px-5 py-4", f.own24h > 0 ? "border-amber-500/35 bg-amber-500/[0.07]" : "border-emerald-500/30 bg-emerald-500/[0.07]")}>
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", f.own24h > 0 ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300")} aria-hidden><KeyRound className="size-[18px]" /></span>
            <div className="min-w-0 text-sm">
              <p className="font-semibold">{t("Your Developer sign-in")}</p>
              <p className="mt-0.5 text-muted-foreground">
                {f.own24h > 0
                  ? t.plural(f.own24h, "{n} wrong-password try on your account in the last 24 hours.", "{n} wrong-password tries on your account in the last 24 hours.")
                  : t("No wrong-password tries on your account in the last 24 hours.")}
              </p>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

/** Both together (the old "Crashes & sign-ins" page): the errors, then the sign-ins. */
export function CrashesTab({ t, c, when, now = new Date() }: { t: T; c: CrashData; when: (x: Date) => string; now?: Date }) {
  return (
    <div className="space-y-6">
      <ErrorsTab t={t} c={c} when={when} now={now} />
      <SecurityTab t={t} c={c} when={when} now={now} />
    </div>
  );
}
