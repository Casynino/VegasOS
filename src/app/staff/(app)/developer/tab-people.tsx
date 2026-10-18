import Link from "next/link";
import { Calculator, CircleCheck, ConciergeBell, KeyRound, Search, ShieldAlert, ShieldCheck, Terminal, UserCog, Users, UtensilsCrossed, Wallet, Car, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";
import { AUDIT_DEVELOPER_HREF, CONSOLE_HREF, type Inspection, type PeopleTab as PeopleData } from "@/server/services/developer-console";
import { auditWordsFor } from "@/server/services/audit-trail";
import { Panel } from "@/components/dashboard/kit";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { agoText, Tag } from "./console-ui";

/**
 * PEOPLE & MY ACTIONS (copied from the owner's Target console, 2026-10-18: "copy this look exactly"): the accounts grouped by what they do — a
 * row for each role with its icon, what it is for, how many are active and how many accounts it has (counts of accounts, never what anyone did) —
 * then the Developer's own last six REAL actions (looking is not listed) beside the two notes (everything is on record; what cannot be done while
 * working as someone), and "can this person do this?" (read-only; every look is written to the audit trail by the service).
 * The team table and the strip of accounts by role that were here before are gone: "Most active people" and "Not using the system" in the Activity
 * part and the role rows below carry the same facts, once.
 */

const capital = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One icon for each kind of role (any role not listed here gets the people icon). */
const ROLE_ICON: Record<string, LucideIcon> = {
  OWNER: ShieldCheck, ADMIN: ShieldCheck, MANAGER: UserCog, FINANCE: Wallet, ACCOUNTANT: Calculator, RECEPTIONIST: ConciergeBell,
  RESTAURANT: UtensilsCrossed, RESTAURANT_SCREEN: UtensilsCrossed, KITCHEN: UtensilsCrossed, DRIVER: Car, DEVELOPER: Terminal,
};

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

export function PeopleTab({ t, data, person, right, inspection, when, timezone, now = new Date() }: {
  t: T; data: PeopleData; person: string; right: string; inspection: Inspection | null; when: (x: Date) => string; timezone: string; now?: Date;
}) {
  const accounts = data.roles.reduce((n, r) => n + r.total, 0);
  const active = data.roles.reduce((n, r) => n + r.active, 0);
  const recent = data.myActions.slice(0, 6);
  const link = "shrink-0 text-xs font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";
  return (
    <div className="space-y-4">
      {/* the accounts, grouped by what they do (Target's look): icon, role, what it is for, how many are active, how many accounts */}
      <Panel
        level={3} title={t("{n} accounts", { n: accounts })} subtitle={t("Grouped by what they do. Open Access to work as any of them.")}
        action={<Link href={CONSOLE_HREF.access} className={link}>{t("Open Access")}</Link>}
        bodyClassName="-mx-4 -mb-4 sm:-mx-6 sm:-mb-6"
      >
        <ul className="grid border-t border-border/60 sm:grid-cols-2">
          {data.roles.map((r) => {
            const Icon = ROLE_ICON[r.code] ?? Users;
            return (
              <li key={r.code} className="flex items-center gap-3 border-b border-border/60 px-4 py-3 sm:px-6 sm:odd:border-r">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground" aria-hidden><Icon className="size-[18px]" /></span>
                <span className="min-w-0 flex-1 leading-snug">
                  <span className="block text-sm font-semibold">{t(r.name)}</span>
                  {r.description && <span className="block truncate text-xs text-muted-foreground" title={t(r.description)}>{t(r.description)}</span>}
                </span>
                <span className={cn("shrink-0 rounded-full px-2.5 py-0.5 text-xs font-medium", r.active > 0 ? "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" : "bg-muted text-muted-foreground")}>{t("{n} active", { n: r.active })}</span>
                <span className="w-7 shrink-0 text-right text-xl font-semibold tabular-nums">{r.total}</span>
              </li>
            );
          })}
          <li className="flex items-center gap-3 px-4 py-3 text-sm text-muted-foreground sm:col-span-2 sm:px-6">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted" aria-hidden><Users className="size-[18px]" /></span>
            {t("{n} accounts in all, {m} active.", { n: accounts, m: active })}
          </li>
        </ul>
      </Panel>

      <div className="grid items-start gap-4 lg:grid-cols-2">
        <Panel
          level={3} title={t("Your recent actions")} subtitle={t("The last things recorded under your name.")}
          action={<Link href={AUDIT_DEVELOPER_HREF} className={link}>{t("See all")}</Link>}
          bodyClassName={recent.length > 0 ? "-mx-4 -mb-4 sm:-mx-6 sm:-mb-6" : undefined}
        >
          {recent.length === 0 ? <p className="px-2 py-5 text-center text-sm text-muted-foreground">{t("No actions yet (looking is not listed).")}</p> : (
            <ul className="border-t border-border/60">
              {recent.map((a) => (
                <li key={a.id} className="flex items-start gap-3 border-b border-border/60 px-4 py-3 last:border-b-0 sm:px-6" title={when(a.at)}>
                  <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", a.failed ? "bg-rose-500" : "bg-sky-500")} aria-hidden />
                  <span className="min-w-0 flex-1 text-sm leading-snug">
                    <span className="block font-medium">{capital(auditWordsFor(a.action, a.target, t))}{a.failed && <> <Tag tone="rose">{t("Failed")}</Tag></>}</span>
                    <span className="block text-xs text-muted-foreground" title={t.dateTime(a.at, timezone)}>{agoText(t, a.at, now)}{a.actingAs ? ` · ${t("as {name}", { name: a.actingAs.name })}` : ""}</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
        <div className="space-y-4">
          <div className="flex items-start gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
            <ShieldCheck className="mt-0.5 size-5 shrink-0 text-emerald-700 dark:text-emerald-300" aria-hidden />
            <div className="min-w-0 text-sm">
              <p className="font-semibold">{t("Everything you do is on record")}</p>
              <p className="mt-1 leading-relaxed text-muted-foreground">{t("Your name is attached to every action, including when you work as someone else. The records cannot be edited or deleted — not even by you.")}</p>
            </div>
          </div>
          <div
            className="flex items-start gap-3 rounded-2xl border border-amber-500/35 bg-amber-500/[0.07] p-4"
            title={t("Touch money (record, approve, pay or withdraw), open accounts, change roles, reset or change passwords, suspend people, or start or close a shift. Everything else you may do as them, and it is all recorded as you. This stops Work as from being used to take over an account.")}
          >
            <KeyRound className="mt-0.5 size-5 shrink-0 text-amber-700 dark:text-amber-300" aria-hidden />
            <div className="min-w-0 text-sm">
              <p className="font-semibold">{t("What you cannot do while working as someone")}</p>
              <p className="mt-1 leading-relaxed text-muted-foreground">{t("As someone else you cannot touch money, accounts, roles, passwords or shifts.")}</p>
            </div>
          </div>
        </div>
      </div>

      <Panel level={3} title={t("Who can do what")} subtitle={t("Pick a person and a right to see if that person has it.")}>
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
