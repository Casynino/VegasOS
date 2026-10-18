import { Bug, ChevronDown, KeyRound, Lock, ShieldAlert, Timer, UserCheck, Webhook } from "lucide-react";
import type { T } from "@/i18n/translate";
import { LOGIN_LIMITS, type AddressTries, type CrashData } from "@/server/services/developer-health";
import { FAILED_SIGN_IN_ROWS_PER_HOUR } from "@/server/services/auth-login";
import type { DeniedEntry } from "@/server/services/developer-console";
import type { ErrorGroup, JobStatus, SystemEvents, WebhookStatus } from "@/server/services/system-events";
import { Panel } from "@/components/dashboard/kit";
import { BarChart, type BarColumn } from "./console-charts";
import { DataTable, Dash } from "./console-table";
import { agoText, dayLabel, num, Quiet, StatBlock, Tag } from "./console-ui";

/**
 * CRASHES & SIGN-INS: what the system recorded about ITSELF (unexpected server errors, grouped; the automatic jobs; the webhooks), then
 * failed sign-ins, paused sign-ins and what was refused to the Developer. An error is shown as the system stored it: scrubbed (emails,
 * numbers, keys, links' addresses and request bodies taken out), with the top of the code path as "file:line".
 */

const FAILED = "#d95926";

export function DeniedPanel({ t, rows, when }: { t: T; rows: DeniedEntry[]; when: (x: Date) => string }) {
  return (
    <Panel title={t("Refused to you")} subtitle={t("The last {n} times a page or an action was refused to a Developer account.", { n: 20 })}>
      {rows.length === 0 ? (
        <p className="rounded-2xl bg-emerald-500/[0.07] px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">{t("Nothing was refused to a Developer account.")}</p>
      ) : (
        <details className="group rounded-2xl border border-border/60 bg-muted/30">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
            <span>{t("Show the {n} refusals", { n: rows.length })}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>
        <div className="overflow-x-auto border-t border-border/60 px-3">
          <table data-stack className="w-full min-w-[640px] text-sm">
            <thead className="text-left text-xs text-muted-foreground">
              <tr className="border-b border-border/70">
                <th className="py-2 pr-4 font-medium">{t("When")}</th><th className="py-2 pr-4 font-medium">{t("Who")}</th>
                <th className="py-2 pr-4 font-medium">{t("What was refused")}</th><th className="py-2 font-medium">{t("The right it needs")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r) => (
                <tr key={r.id} className="align-top">
                  <td className="py-2.5 pr-4 whitespace-nowrap">{when(r.at)}</td>
                  <td className="py-2.5 pr-4">{r.who}</td>
                  <td className="py-2.5 pr-4">
                    {r.kind ? (r.kind === "page" ? t("A page") : t("An action")) : "—"}
                    {r.path && <span className="block break-all font-mono text-[11px] text-muted-foreground">{r.path}</span>}
                  </td>
                  <td className="py-2.5">
                    {r.needs.length === 0 ? "—" : r.needs.map((n) => (
                      <span key={n.code} className="block min-w-0 leading-snug">
                        <span className="font-mono text-xs">{n.code}</span>
                        {n.description && <span className="block text-xs text-muted-foreground">{t(n.description)}</span>}
                      </span>
                    ))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        </details>
      )}
    </Panel>
  );
}


/** How long a job took: "850 ms" or "12.4 s". */
const took = (t: T, ms: number | null) => (ms === null ? "—" : ms < 1000 ? t("{n} ms", { n: ms }) : t("{n} s", { n: (ms / 1000).toLocaleString(t.intl, { maximumFractionDigits: 1 }) }));

function ErrorRow({ t, g, when, now }: { t: T; g: ErrorGroup; when: (x: Date) => string; now: Date }) {
  return (
    <details className="group min-w-0 rounded-2xl border border-border/70 bg-card">
      <summary className="flex cursor-pointer list-none items-start gap-3 rounded-2xl p-3.5 marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:p-4 [&::-webkit-details-marker]:hidden">
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
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("Where in the code")}</p>
            <ul className="mt-1 space-y-0.5 break-all font-mono text-xs text-foreground/90">{g.frames.map((f) => <li key={f}>{f}</li>)}</ul>
            {!g.frames.some((f) => /^(src|app|pages)\//.test(f)) && <p className="mt-1 text-xs text-muted-foreground">{t("These lines are in the built code: the hosting does not keep the original file names. The message and the place named above tell where to look.")}</p>}
          </div>
        )}
      </div>
    </details>
  );
}

export function ErrorsPanel({ t, system, when, now }: { t: T; system: SystemEvents | null; when: (x: Date) => string; now: Date }) {
  return (
    <Panel title={t("Server errors")} subtitle={t("Last 30 days, one line for each different error. A repeat adds to its count; personal details are taken out.")}>
      {!system ? (
        <Quiet>{t("This could not be read just now.")}</Quiet>
      ) : system.errorGroups.length === 0 ? (
        <div className="space-y-1">
          <p className="rounded-2xl bg-emerald-500/[0.07] px-3 py-2 text-sm font-medium text-emerald-800 dark:text-emerald-200">{t("Nothing yet")}</p>
          <p className="px-1 text-xs text-muted-foreground">{t("No unexpected server error has been recorded. (Mistakes people make, like a wrong password or a refused action, are not errors and are not recorded here.)")}</p>
        </div>
      ) : (
        <div className="space-y-2">{system.errorGroups.map((g) => <ErrorRow key={g.id} t={t} g={g} when={when} now={now} />)}</div>
      )}
    </Panel>
  );
}

export function JobsPanel({ t, jobs, when, now }: { t: T; jobs: JobStatus[] | null; when: (x: Date) => string; now: Date }) {
  return (
    <Panel title={t("Automatic jobs")} subtitle={t("What the system runs by itself on a timer. Late means not run for 1.5 times its longest gap. Hotel time.")}>
      {!jobs ? <Quiet>{t("This could not be read just now.")}</Quiet> : (
        <DataTable
          empty={t("Nothing yet")}
          cols={[{ label: t("Job") }, { label: t("Runs at") }, { label: t("Last run") }, { label: t("Last time it went well") }, { label: t("Last result") }, { label: t("Took"), num: true }, { label: t("On time?") }]}
          rows={jobs.map((j) => ({
            key: j.job,
            cells: [
              <span key="j" className="block min-w-0"><span className="block font-medium">{t(j.label)}</span><span className="block break-all font-mono text-[11px] text-muted-foreground">{j.job}</span></span>,
              j.schedule ? <span key="s" className="tabular-nums">{j.schedule}</span> : <Dash key="s" />,
              j.lastRunAt ? <span key="r" className="whitespace-nowrap">{when(j.lastRunAt)}<span className="block text-[11px] text-muted-foreground">{agoText(t, j.lastRunAt, now)}</span></span> : <span key="r" className="text-muted-foreground">{t("Not recorded yet")}</span>,
              j.lastOkAt ? <span key="o" className="whitespace-nowrap">{when(j.lastOkAt)}</span> : <Dash key="o" />,
              j.lastStatus === null ? <Dash key="st" /> : (
                <span key="st" className="block min-w-0">
                  <Tag tone={j.lastStatus === "OK" ? "emerald" : "rose"}>{j.lastStatus === "OK" ? t("Went well") : t("Failed")}</Tag>
                  {j.lastError && <span className="mt-1 block break-words text-xs text-muted-foreground">{j.lastError}</span>}
                </span>
              ),
              took(t, j.lastDurationMs),
              <Tag key="od" tone={j.overdue ? "rose" : j.lastRunAt ? "emerald" : "slate"}>{j.overdue ? t("Late") : j.lastRunAt ? t("On time") : t("Not recorded yet")}</Tag>,
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
    <Panel title={t("Messages from other services (webhooks)")} subtitle={t("What other services, such as nTZS, tell the system. The last 7 days.")}>
      {!hooks ? <Quiet>{t("This could not be read just now.")}</Quiet> : (
        <DataTable
          empty={t("Nothing yet")}
          cols={[{ label: t("From") }, { label: t("Last accepted") }, { label: t("Last failed") }, { label: t("Accepted, 7 days"), num: true }, { label: t("Failed, 7 days"), num: true }, { label: t("Refused (bad signature), 7 days"), num: true }]}
          rows={hooks.map((h) => ({
            key: h.source,
            cells: [
              <span key="n" className="block min-w-0"><span className="block font-medium">{hookName(t, h.source)}</span><span className="block break-all font-mono text-[11px] text-muted-foreground">{h.source}</span></span>,
              h.lastOkAt ? <span key="o" className="whitespace-nowrap">{when(h.lastOkAt)}</span> : <span key="o" className="text-muted-foreground">{t("None yet")}</span>,
              h.lastFailedAt ? <span key="f" className="whitespace-nowrap">{when(h.lastFailedAt)}</span> : <Dash key="f" />,
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

/** Server errors, the automatic jobs and the messages other services send: four figures, then the three lists. */
export function ErrorsTab({ t, c, when, now = new Date() }: { t: T; c: CrashData; when: (x: Date) => string; now?: Date }) {
  const sys = c.system;
  const late = sys ? sys.jobs.filter((j) => j.overdue).length : null;
  const failedJobs = sys ? sys.jobs.filter((j) => j.lastStatus === "FAILED").length : null;
  const goodJobs = sys ? sys.jobs.filter((j) => j.lastRunAt !== null && !j.overdue && j.lastStatus !== "FAILED").length : 0;
  const hook = sys?.webhooks.find((w) => /ntzs/i.test(w.source)) ?? null;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatBlock
          icon={Bug} label={t("Server errors")} value={num(t, sys?.errors24h)} caption={t("different errors in 24 hours")} warn={!!sys?.errors24h}
          tag={sys ? (sys.errors24h > 0 ? t("Look at it") : t("Quiet")) : undefined} tagTone={sys?.errors24h ? "amber" : "emerald"}
          note={t("Errors the server did not expect. The same error again counts once here; its line below says how many times.")}
        />
        <StatBlock
          icon={Timer} label={t("Automatic jobs")} value={sys ? t("{ok} of {n}", { ok: goodJobs, n: sys.jobs.length }) : "—"} caption={t("on time and well")}
          warn={!!(late || failedJobs)}
          tag={sys ? (late || failedJobs ? t("Look at it") : goodJobs === sys.jobs.length ? t("On time") : t("Not recorded yet")) : undefined} tagTone={late || failedJobs ? "rose" : goodJobs === sys?.jobs.length ? "emerald" : "slate"}
          note={t("Late: {late}. Failed on the last run: {failed}.", { late: late ?? 0, failed: failedJobs ?? 0 })}
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
      <JobsPanel t={t} jobs={sys?.jobs ?? null} when={when} now={now} />
      <WebhooksPanel t={t} hooks={sys?.webhooks ?? null} when={when} />
    </div>
  );
}

/**
 * "Failed tries by address": the addresses the wrong tries came from, the most first. One address trying many accounts is a warning sign.
 * A small table of its own (no minimum width) so it fits beside the chart; on a phone each row becomes a small card.
 */
function AddressPanel({ t, rows, when }: { t: T; rows: AddressTries[] | null; when: (x: Date) => string }) {
  return (
    <Panel title={t("Failed tries by address")} subtitle={t("Last 7 days. One address trying many accounts is a warning sign.")}>
      {!rows ? <Quiet>{t("This could not be read just now.")}</Quiet> : rows.length === 0 ? <Quiet>{t("No wrong tries with an address in the last 7 days.")}</Quiet> : (
        <table data-stack className="w-full text-sm">
          <thead className="text-left text-xs text-muted-foreground">
            <tr className="border-b border-border/70">
              <th scope="col" className="py-2 pr-3 font-medium">{t("Address")}</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">{t("Tries")}</th>
              <th scope="col" className="py-2 pr-3 text-right font-medium">{t("Accounts")}</th>
              <th scope="col" className="py-2 font-medium">{t("Last")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {rows.map((r) => (
              <tr key={r.ip} className="align-top">
                <td data-label={t("Address")} className="min-w-0 break-all py-2.5 pr-3 font-mono text-xs">{r.ip}</td>
                <td data-label={t("Tries")} className="whitespace-nowrap py-2.5 pr-3 text-right font-semibold tabular-nums">{r.tries.toLocaleString(t.intl)}</td>
                <td data-label={t("Accounts")} className={`whitespace-nowrap py-2.5 pr-3 text-right tabular-nums ${r.accounts > 1 ? "font-semibold text-amber-700 dark:text-amber-300" : ""}`}>{r.accounts.toLocaleString(t.intl)}</td>
                <td data-label={t("Last")} className="py-2.5 text-xs text-muted-foreground">{when(r.last)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("Only real accounts are written down — an email nobody holds is not. At most {n} tries for one account are written down each hour; if there are more, one line says so and the numbers here are lower than the real tries.", { n: FAILED_SIGN_IN_ROWS_PER_HOUR })}</p>
    </Panel>
  );
}

/** Failed and successful sign-ins, locked-out places, where the wrong tries came from, the latest tries, and what was refused to the Developer. */
export function SecurityTab({ t, c, when, now = new Date() }: { t: T; c: CrashData; when: (x: Date) => string; now?: Date }) {
  const f = c.failed;
  const paused = c.paused ? c.paused.developer + c.paused.staff : null;
  const columns: BarColumn[] | null = f
    ? f.byDay.map((d, i, all) => ({
        key: d.date, tick: dayLabel(t, d.date), name: dayLabel(t, d.date),
        values: { failed: d.count, denied: c.deniedByDay?.[i]?.count ?? 0 }, emphasise: i === all.length - 1,
      }))
    : null;
  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        <StatBlock
          icon={KeyRound} label={t("Failed sign-ins")} value={num(t, c.failed14d)} caption={t("in 14 days")} warn={!!f?.last24h}
          tag={c.failed14d === null ? undefined : c.failed14d > 0 ? t("Look at it") : t("Quiet")} tagTone={c.failed14d ? "amber" : "emerald"}
          note={t("Wrong password or a blocked account. A few are typing mistakes; a spike on one day, or many tries from one address, means someone is guessing.")}
        />
        <StatBlock
          icon={UserCheck} label={t("Successful sign-ins")} value={num(t, c.successful14d)} caption={t("in 14 days")}
          tag={c.successful14d === null ? undefined : t("Sign-ins")} tagTone="slate"
          note={t("Each time someone signed in with the right password, staff together.")}
        />
        <StatBlock
          icon={Lock} label={t("Locked out now")} value={num(t, paused)} caption={t("after {n} wrong tries in {m} minutes", { n: LOGIN_LIMITS.staffPlace, m: LOGIN_LIMITS.windowMinutes })} warn={!!paused}
          tag={paused === null ? undefined : paused ? t("Look at it") : t("None")} tagTone={paused ? "amber" : "emerald"}
          note={t("An address is refused for {m} minutes after {n} wrong passwords, even if the right one is tried next. It opens again by itself.", { n: LOGIN_LIMITS.staffPlace, m: LOGIN_LIMITS.windowMinutes })}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("Failed sign-ins and refused Developer actions per day")} subtitle={f?.last24h ? t("{n} wrong tries in the last 24 hours.", { n: f.last24h }) : t("No failed sign-ins in the last 24 hours.")}>
          {columns
            ? <BarChart t={t} columns={columns} grouped caption={t("Failed sign-ins and refused Developer actions per day")} empty={t("No failed sign-ins in the last 7 days.")}
                series={[{ key: "failed", label: t("Failed sign-ins"), color: FAILED }, { key: "denied", label: t("Developer actions refused"), color: "#c0392b" }]} />
            : <Quiet>{t("This could not be read just now.")}</Quiet>}
        </Panel>
        <AddressPanel t={t} rows={c.byAddress} when={when} />
      </div>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel title={t("Latest failed tries")} subtitle={t("Latest refused attempts. Passwords are never stored. Repeats within a minute are merged (×N).")}>
          {!f ? <Quiet>{t("This could not be read just now.")}</Quiet> : f.latest.length === 0 ? <Quiet>{t("No account was tried wrongly in the last 7 days.")}</Quiet> : (
            <ul className="divide-y divide-border/60 text-sm">
              {f.latest.map((r) => (
                <li key={r.id} className="py-2.5">
                  <span className="block font-medium leading-tight">{r.name}{r.times > 1 && <span className="ml-1.5 text-xs font-normal text-muted-foreground">×{r.times}</span>}</span>
                  <span className="block text-xs text-muted-foreground" title={when(r.at)}>{agoText(t, r.at, now)}{r.ip ? <> · <span className="font-mono">{r.ip}</span></> : null}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("Only real accounts are written down — an email nobody holds is not. At most {n} tries for one account are written down each hour; if there are more, one line says so and the numbers here are lower than the real tries.", { n: FAILED_SIGN_IN_ROWS_PER_HOUR })}</p>
        </Panel>
        <div className="space-y-3">
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
            <KeyRound className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
            <div className="min-w-0 text-sm">
              <p className="font-semibold">{t("Your Developer sign-in")}</p>
              <p className="mt-1 leading-relaxed text-muted-foreground">
                {f && f.own24h > 0
                  ? t("{n} wrong-password tries on your account in the last 24 hours. After {max} wrong tries from one place it locks for {min} minutes.", { n: f.own24h, max: LOGIN_LIMITS.developerEmail, min: LOGIN_LIMITS.windowMinutes })
                  : t("No wrong-password tries on your account in the last 24 hours. After {max} wrong tries from one place it locks for {min} minutes.", { max: LOGIN_LIMITS.developerEmail, min: LOGIN_LIMITS.windowMinutes })}
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 rounded-2xl border border-sky-500/30 bg-sky-500/[0.06] p-4">
            <Bug className="mt-0.5 size-5 shrink-0 text-sky-700 dark:text-sky-300" aria-hidden />
            <div className="min-w-0 text-sm">
              <p className="font-semibold">{t("Page crashes")}</p>
              <p className="mt-1 leading-relaxed text-muted-foreground">{t("An unexpected error on a page, an action or a job is written down by the system itself: see Errors & jobs, with how often, when and where in the code.")}</p>
            </div>
          </div>
        </div>
      </div>

      <DeniedPanel t={t} rows={c.denied} when={when} />
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
