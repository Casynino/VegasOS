import Link from "next/link";
import { CircleCheck, KeyRound, Search, ShieldAlert, ShieldCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";
import { AUDIT_DEVELOPER_HREF, CONSOLE_HREF, type Inspection, type PeopleTab as PeopleData } from "@/server/services/developer-console";
import { auditWordsFor } from "@/server/services/audit-trail";
import { Panel } from "@/components/dashboard/kit";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import type { TeamData } from "@/server/services/developer-team";
import { agoText, num, Quiet, roleColours, Tag } from "./console-ui";
import { FillScroll } from "./fill-scroll";

/**
 * PEOPLE & MY ACTIONS: the accounts by role in ONE strip (counts of accounts, never what anyone did), the team table (who did how many things
 * this week and when they last signed in: counts and a time only; it scrolls inside its panel), the Developer's own last six REAL actions (looking
 * is not listed) with one slim note beside it, and "can this person do this?" (read-only; every look is written to the audit trail by the service).
 * Owner, 2026-10-18: "do not be repetitive, no spaces, well arranged": the people appear once (the strip counts, the table names), notes once.
 */

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function InspectionResult({ r, t }: { r: Inspection; t: T }) {
  if (!r.ok) {
    return <p role="alert" className="mt-4 rounded-2xl border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2 text-sm text-amber-800 dark:text-amber-200">{t(r.problem)}</p>;
  }
  return (
    <div className="mt-4 space-y-3" aria-live="polite">
      <div className={cn("rounded-2xl border px-4 py-3", r.has ? "border-emerald-500/40 bg-emerald-500/[0.07]" : "border-border bg-muted/40")}>
        <p className="flex items-center gap-2 text-base font-semibold">
          {r.has ? <CircleCheck className="size-5 text-emerald-600" aria-hidden /> : <ShieldAlert className="size-5 text-muted-foreground" aria-hidden />}
          {r.has ? t("Yes — {name} can do this", { name: r.person.name }) : t("No — {name} cannot do this", { name: r.person.name })}
        </p>
        <p className="mt-1 break-words text-sm">{t(r.right.description)}</p>
        <p className="mt-0.5 font-mono text-xs text-muted-foreground">{r.right.code}</p>
        <p className="mt-2 text-sm">
          {r.grantedBy ? t("Given by the role {role}.", { role: t(r.grantedBy.name) }) : t("The role {role} does not give it.", { role: t(r.person.roleName) })}
          {!r.person.active && <span className="text-muted-foreground"> {t("This account is not active, so it cannot sign in.")}</span>}
        </p>
        {r.right.developerOnly && <p className="mt-1 text-xs text-muted-foreground">{t("Only the Developer role holds this right. It cannot be given to any other role.")}</p>}
        {r.right.developerMoneyRight && <p className="mt-1 text-xs text-muted-foreground">{t("The Developer role never holds this right, because it writes money.")}</p>}
        {r.right.developerAccountRight && <p className="mt-1 text-xs text-muted-foreground">{t("The Developer role never holds this right: only the Boss and the MD create or change accounts, passwords, roles and rights.")}</p>}
      </div>

      <p className="text-sm"><span className="text-muted-foreground">{t("Roles that hold this right:")}</span>{" "}{r.rolesWithRight.length ? r.rolesWithRight.map((x) => t(x.name)).join(", ") : t("none")}</p>

      <details className="group rounded-2xl border border-border/70 px-3 py-2">
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium"><KeyRound className="size-4 text-muted-foreground" aria-hidden />{t("Everything {name} can do ({n} rights)", { name: r.person.name, n: r.rights.length })}</summary>
        <ul className="mt-3 grid gap-x-6 gap-y-2 sm:grid-cols-2">
          {r.rights.map((x) => (
            <li key={x.code} className="min-w-0 text-sm leading-snug">
              <span className="font-mono text-xs">{x.code}</span>
              {x.description && <span className="block text-xs text-muted-foreground">{t(x.description)}</span>}
            </li>
          ))}
        </ul>
      </details>
    </div>
  );
}

/**
 * THE TEAM: every staff account with the number of things done in the last 7 hotel days and the last time they were in. Counts and a time only.
 * The table scrolls inside its panel (about 7 rows show, the header stays) so 14 or 40 people never make the page long.
 */
function TeamTable({ t, team, now, timezone }: { t: T; team: TeamData | null; now: Date; timezone: string }) {
  const rows = team?.members ?? [];
  return (
    <Panel
      title={t("The team")} subtitle={t("What each person did this week, and when they last signed in.")}
      className="flex flex-col" bodyClassName="flex flex-1 flex-col"
    >
      {!team ? <Quiet>{t("This could not be read just now.")}</Quiet> : rows.length === 0 ? <Quiet>{t("No staff accounts yet.")}</Quiet> : (
        <FillScroll label={t("The team")} maxH="max-h-80" minH="lg:min-h-[20rem]" className="rounded-xl">
          <table data-stack className="w-full min-w-[520px] text-sm">
            <thead className="sticky top-0 z-10 bg-card text-left text-xs text-muted-foreground">
              <tr>
                <th className="py-2 pr-4 font-medium shadow-[inset_0_-1px_0_var(--border)]">{t("Person")}</th><th className="py-2 pr-4 font-medium shadow-[inset_0_-1px_0_var(--border)]">{t("Role")}</th>
                <th className="py-2 pr-4 text-right font-medium shadow-[inset_0_-1px_0_var(--border)]">{t("Actions (7 days)")}</th><th className="py-2 text-right font-medium shadow-[inset_0_-1px_0_var(--border)]">{t("Last in")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((m) => (
                <tr key={m.id} className="align-middle">
                  <td className="py-2.5 pr-4 font-medium">{m.name}</td>
                  <td className="py-2.5 pr-4 text-muted-foreground">{t(m.roleName)}</td>
                  <td className={cn("py-2.5 pr-4 text-right tabular-nums", m.actions7d === 0 && "text-muted-foreground")}>{num(t, m.actions7d)}</td>
                  <td className="whitespace-nowrap py-2.5 text-right text-muted-foreground" title={m.lastSignInAt ? t.dateTime(m.lastSignInAt, timezone) : undefined}>{m.lastSignInAt ? agoText(t, m.lastSignInAt, now) : t("Never signed in")}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </FillScroll>
      )}
    </Panel>
  );
}

export function PeopleTab({ t, data, person, right, inspection, when, timezone, team, now = new Date() }: {
  t: T; data: PeopleData; person: string; right: string; inspection: Inspection | null; when: (x: Date) => string; timezone: string;
  /** The team table: undefined = not shown, null = could not be read. */
  team?: TeamData | null; now?: Date;
}) {
  const accounts = data.roles.reduce((n, r) => n + r.total, 0);
  const active = data.roles.reduce((n, r) => n + r.active, 0);
  const recent = data.myActions.slice(0, 6);
  const colours = roleColours(data.roles.map((r) => r.code));
  const link = "shrink-0 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";
  return (
    <div className="space-y-4">
      {/* the accounts, in one strip: how many, and how many of each role */}
      <section className="flex flex-wrap items-center gap-x-4 gap-y-2 rounded-3xl border border-border/70 bg-card px-4 py-3 shadow-[0_2px_4px_rgba(15,23,42,0.03)] sm:px-6">
        <h2 className="text-base font-semibold" title={t("{n} active", { n: active })}>{t("{n} accounts", { n: accounts })}</h2>
        <ul className="flex min-w-0 flex-1 flex-wrap gap-1.5">
          {data.roles.map((r) => (
            <li key={r.code} title={t("{n} active", { n: r.active })} className="inline-flex items-center gap-1.5 rounded-full bg-muted px-2.5 py-1 text-xs">
              <span className="size-2 shrink-0 rounded-full" style={{ background: colours[r.code] }} aria-hidden />
              <span>{t(r.name)}</span><span className="font-semibold tabular-nums">{r.total}</span>
            </li>
          ))}
        </ul>
        <Link href={CONSOLE_HREF.access} className={link}>{t("Open Access")}</Link>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        {team !== undefined && <TeamTable t={t} team={team} now={now} timezone={timezone} />}
        <div className={cn("space-y-4", team === undefined && "lg:col-span-2")}>
          <Panel title={t("Your recent actions")} action={<Link href={AUDIT_DEVELOPER_HREF} className={link}>{t("See all")}</Link>}>
            {recent.length === 0 ? <Quiet>{t("No actions yet (looking is not listed).")}</Quiet> : (
              <ul className="divide-y divide-border/60">
                {recent.map((a) => (
                  <li key={a.id} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0" title={when(a.at)}>
                    <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", a.failed ? "bg-rose-500" : "bg-sky-500")} aria-hidden />
                    <span className="min-w-0 flex-1 text-sm leading-snug">
                      <span className="block font-medium">{capital(auditWordsFor(a.action, a.target, t))}{a.failed && <> <Tag tone="rose">{t("Failed")}</Tag></>}</span>
                      <span className="block text-xs text-muted-foreground">{agoText(t, a.at, now)}{a.actingAs ? ` · ${t("as {name}", { name: a.actingAs.name })}` : ""}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
          {/* the two rules of the Developer's own doing, in one slim card (the full wording is on hover) */}
          <div
            className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card px-4 py-3 text-sm"
            title={t("Touch money (record, approve, pay or withdraw), open accounts, change roles, reset or change passwords, suspend people, or start or close a shift. Everything else you may do as them, and it is all recorded as you. This stops Work as from being used to take over an account.")}
          >
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-emerald-600 dark:text-emerald-300" aria-hidden />
            <p className="min-w-0 leading-relaxed text-muted-foreground">
              <span className="font-medium text-foreground">{t("Everything you do is on record, also as someone else, and cannot be edited or deleted.")}</span>{" "}
              {t("As someone else you cannot touch money, accounts, roles, passwords or shifts.")}
            </p>
          </div>
        </div>
      </div>

      <Panel title={t("Who can do what")} subtitle={t("Pick a person and a right to see if that person has it.")}>
        <form method="get" action="/staff/developer#people" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            {t("Person")}
            <NativeSelect name="person" defaultValue={person} className="h-10 text-sm text-foreground">
              <option value="">{t("Choose a person")}</option>
              {data.people.map((p) => <option key={p.id} value={p.id}>{p.name} · {t(p.roleName)}{p.active ? "" : ` · ${t("not active")}`}</option>)}
            </NativeSelect>
          </label>
          <label className="grid gap-1.5 text-xs font-medium text-muted-foreground">
            {t("Right")}
            <NativeSelect name="right" defaultValue={right} className="h-10 text-sm text-foreground">
              <option value="">{t("Choose a right")}</option>
              {data.rights.map((r) => <option key={r.code} value={r.code}>{r.code}</option>)}
            </NativeSelect>
          </label>
          <Button type="submit" size="lg" className="h-10 gap-2 px-4"><Search className="size-4" aria-hidden />{t("Check")}</Button>
        </form>
        {inspection && <InspectionResult r={inspection} t={t} />}
      </Panel>
    </div>
  );
}
