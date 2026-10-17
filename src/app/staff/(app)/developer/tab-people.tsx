import { CircleCheck, KeyRound, Search, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";
import type { Inspection, PeopleTab as PeopleData } from "@/server/services/developer-console";
import { Panel } from "@/components/dashboard/kit";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";
import { Quiet, Tag } from "./console-ui";

/**
 * PEOPLE & MY ACTIONS: "can this person do this?" (read-only; every look is written to the audit trail by the service) and the
 * Developer's own last 30 actions, from the audit trail.
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

export function PeopleTab({ t, data, person, right, inspection, when, timezone }: {
  t: T; data: PeopleData; person: string; right: string; inspection: Inspection | null; when: (x: Date) => string; timezone: string;
}) {
  return (
    <div className="space-y-4">
      <Panel title={t("Who can do what")} subtitle={t("Pick a person and a right: you see yes or no, which role gives it, and everything that person can do.")}>
        <form method="get" action="/staff/developer#console-tabs" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
          <input type="hidden" name="tab" value="people" />
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

      <Panel title={t("My last {n} actions", { n: 30 })} subtitle={t("From the audit trail: what you did and looked at, newest first. Nobody can change this list.")}>
        {data.myActions.length === 0 ? <Quiet>{t("You have no actions on record yet.")}</Quiet> : (
          <div className="overflow-x-auto">
            <table data-stack className="w-full min-w-[560px] text-sm">
              <thead className="text-left text-xs text-muted-foreground">
                <tr className="border-b border-border/70">
                  <th className="py-2 pr-4 font-medium">{t("When")}</th><th className="py-2 pr-4 font-medium">{t("What was done")}</th><th className="py-2 font-medium">{t("As")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60">
                {data.myActions.map((a) => (
                  <tr key={a.id} className="align-top">
                    <td className="whitespace-nowrap py-2.5 pr-4 text-muted-foreground" title={t.dateTime(a.at, timezone)}>{when(a.at)}</td>
                    <td className="py-2.5 pr-4">
                      <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span className="font-medium">{capital(t(a.words))}</span>
                        {a.failed && <Tag tone="rose">{t("Failed")}</Tag>}
                      </span>
                      <span className="block break-all font-mono text-[11px] text-muted-foreground">{a.path ?? a.action}</span>
                    </td>
                    <td className="py-2.5">{a.actingAs ? <span>{a.actingAs.name}{a.actingAs.role && <span className="block text-xs text-muted-foreground">{t(a.actingAs.role)}</span>}</span> : <span className="text-muted-foreground">{t("Yourself")}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </div>
  );
}
