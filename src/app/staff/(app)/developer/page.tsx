import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, CircleAlert, KeyRound, Search, ShieldAlert, ShieldCheck, Users } from "lucide-react";
import { currentSessionTokenHash, requestMeta, requirePagePermission } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { developerConsole, inspectPermission, type DeniedEntry, type Diagnostics, type Inspection } from "@/server/services/developer-console";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { Panel } from "@/components/dashboard/kit";
import { PageHeader } from "@/components/staff/page-header";
import { Button } from "@/components/ui/button";
import { NativeSelect } from "@/components/ui/native-select";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Developer console") };
}
export const dynamic = "force-dynamic";

const str = (v: unknown) => (typeof v === "string" ? v : "");

/**
 * THE DEVELOPER CONSOLE — for the Developer account only. Read-only: who you are signed in as, whether the system is healthy
 * (yes / no and counters — never a key or a password), the refusals you met, and "can this person do this?". Everything is
 * looked up on the server in src/server/services/developer-console.ts, which checks again that you are the Developer.
 */
export default async function DeveloperConsolePage({ searchParams }: PageProps<"/staff/developer">) {
  const user = await requirePagePermission("developer.access");
  const sp = await searchParams;
  const person = str(sp.person).trim();
  const right = str(sp.right).trim();
  const [t, settings, sessionHash, meta] = await Promise.all([getT(), getSettings(), currentSessionTokenHash(), requestMeta()]);
  const data = await developerConsole(user, sessionHash);
  // A look at someone's rights is itself written to the audit trail (by the service).
  const inspection: Inspection | null = person || right ? await inspectPermission(user, { userId: person, code: right }, { ipAddress: meta.ipAddress }) : null;
  const when = (d: Date) => t.dateTime(d, settings.timezone);

  return (
    <div className="w-full space-y-5">
      <PageHeader
        eyebrow={t("Developer")}
        title={t("Developer console")}
        description={t("Read-only. Nothing here changes anything, and no password, key or secret is ever shown. Your visits to sensitive pages and every look at someone's rights are kept in the audit trail.")}
        actions={<Link href={data.auditHref} className="text-sm font-medium underline underline-offset-4 hover:text-foreground">{t("Open the audit trail of Developer actions")}</Link>}
      />

      <IdentityPanel identity={data.identity} t={t} when={when} />
      <SystemPanel d={data.diagnostics} t={t} when={when} />
      <DeniedPanel rows={data.denied} t={t} when={when} />

      <Panel title={t("Who can do what")} subtitle={t("Pick a person and a right: you see yes or no, which role gives it, and everything that person can do.")}>
        <form method="get" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[1fr_1fr_auto] lg:items-end">
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
          <Button type="submit" size="lg" className="h-10 gap-2 px-4"><Search className="size-4" aria-hidden="true" />{t("Check")}</Button>
        </form>
        {inspection && <InspectionResult r={inspection} t={t} />}
      </Panel>
    </div>
  );
}

// ───────────────────────────────────────────── you ─────────────────────────────────────────────
function minutesWords(t: T, total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? t("{h} h {m} min", { h, m }) : t("{m} min", { m });
}

function IdentityPanel({ identity, t, when }: { identity: Awaited<ReturnType<typeof developerConsole>>["identity"]; t: T; when: (d: Date) => string }) {
  const s = identity.session;
  return (
    <Panel title={t("You")} subtitle={t("The account you are signed in as, taken from the server — not from the page.")}>
      <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
        <Info label={t("Name")} value={identity.name} />
        <Info label={t("Account type")} value={t("Developer account")} />
        <Info label={t("Role")} value={t(identity.roleName)} />
        <Info label={t("Signed in at")} value={s ? when(s.startedAt) : "—"} />
        <Info
          label={t("Time left")}
          value={s ? minutesWords(t, s.minutesLeft) : "—"}
          hint={s ? (s.endsBecause === "idle" ? t("Signs out at {time} unless you keep working (after {n} minutes without use).", { time: when(s.endsAt), n: s.idleMinutes }) : t("Signs out at {time} at the latest ({n} hours after signing in).", { time: when(s.endsAt), n: s.limitHours })) : undefined}
        />
        <Info label={t("Rights you hold")} value={String(identity.rightsCount)} />
      </dl>
      {identity.heldButDenied.length > 0 && (
        <p role="alert" className="mt-3 flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          <span>{t("This account holds {n} money right(s) the Developer role is meant never to hold: {codes}. Fix the role.", { n: identity.heldButDenied.length, codes: identity.heldButDenied.join(", ") })}</span>
        </p>
      )}
      <div className="mt-4">
        <h3 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-emerald-600" aria-hidden="true" />{t("Rights you do not hold (money)")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t(identity.reason)}</p>
        <ul className="mt-2 grid gap-x-6 gap-y-1.5 text-sm sm:grid-cols-2">
          {identity.notHeld.map((r) => (
            <li key={r.code} className="min-w-0 leading-snug">
              <span className="break-words">{t(r.description)}</span>
              <span className="block font-mono text-[11px] text-muted-foreground">{r.code}</span>
            </li>
          ))}
        </ul>
      </div>
    </Panel>
  );
}

function Info({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="min-w-0 rounded-2xl bg-muted/40 px-3 py-2">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="mt-0.5 break-words font-medium">{value}</dd>
      {hint && <dd className="mt-0.5 text-xs text-muted-foreground">{hint}</dd>}
    </div>
  );
}

// ───────────────────────────────────────────── the system ─────────────────────────────────────────────
function Fact({ ok, label, value, note }: { ok: boolean; label: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-2xl bg-muted/40 px-3 py-2">
      {ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden="true" /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />}
      <div className="min-w-0 leading-tight">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 break-words text-sm">{value}</dd>
        {note && <dd className="mt-0.5 break-words text-xs text-muted-foreground">{note}</dd>}
      </div>
    </div>
  );
}

function Count({ label, value, sub, warn }: { label: string; value: number | null; sub?: string; warn?: boolean }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card p-3 sm:p-4">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold tabular-nums", warn && "text-amber-700 dark:text-amber-300")}>{value ?? "—"}</p>
      {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}

function SystemPanel({ d, t, when }: { d: Diagnostics; t: T; when: (x: Date) => string }) {
  const m = d.migrations;
  const w = d.whatsapp;
  const c = d.counts;
  return (
    <Panel title={t("System checks")} subtitle={t("Checked {when}. Only yes / no and numbers — a key or a password is never read out.", { when: when(d.checkedAt) })}>
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Fact ok={d.database.reachable} label={t("Database")} value={d.database.reachable ? t("Reachable") : t("Not reachable")} />
        <Fact
          ok={!!m && m.failed === 0} label={t("Database updates (migrations)")}
          value={m ? t("{n} applied", { n: m.applied }) : t("Could not be read")}
          note={m ? [m.latest ? t("Latest: {name}", { name: m.latest }) : null, m.failed > 0 ? t("{n} failed or not finished", { n: m.failed }) : null].filter(Boolean).join(" · ") || undefined : undefined}
        />
        <Fact
          ok={d.ntzs.configured} label={t("Online payment (nTZS)")}
          value={d.ntzs.configured ? (d.ntzs.live ? t("Set on the server (live)") : t("Set on the server (test)")) : t("Not set up")}
          note={d.ntzs.webhookSecret ? t("Webhook secret is set") : t("Webhook secret is missing")}
        />
        <Fact
          ok={!!w && w.recipients > 0 && w.recipientsReady === w.recipients} label={t("WhatsApp reports (CallMeBot)")}
          value={w ? (w.recipients === 0 ? t("No report recipients are set") : t("{ready} of {total} recipients can be reached", { ready: w.recipientsReady, total: w.recipients })) : t("Could not be read")}
          note={w ? (w.defaultKey ? t("The default key is set") : t("No default key is set")) : undefined}
        />
        <Fact ok={d.cron.secretConfigured} label={t("Scheduled reports (cron secret)")} value={d.cron.secretConfigured ? t("Set") : t("Missing")} />
        <Fact
          ok={!!d.deployment.commit} label={t("Deployment")}
          value={d.deployment.commit ? t("Commit {sha}", { sha: d.deployment.commit }) : t("Commit not known")}
          note={d.deployment.environment ? t("Environment: {name}", { name: d.deployment.environment }) : undefined}
        />
      </dl>

      <div className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Count label={t("Active staff accounts")} value={c?.staffTotal ?? null} />
        <Count label={t("Open shifts")} value={c?.openShifts ?? null} />
        <Count label={t("Withdrawals not settled")} value={c?.unsettledWithdrawals ?? null} warn={!!c && c.unsettledWithdrawals > 0} sub={t("sent, answer not known yet")} />
        <Count label={t("Failed messages")} value={c?.failedMessages24h ?? null} warn={!!c && c.failedMessages24h > 0} sub={t("in the last 24 hours")} />
      </div>
      {c && c.staffByRole.length > 0 && (
        <div className="mt-4">
          <h3 className="flex items-center gap-2 text-sm font-semibold"><Users className="size-4 text-muted-foreground" aria-hidden="true" />{t("Active staff by role")}</h3>
          <ul className="mt-2 flex flex-wrap gap-x-5 gap-y-1 text-sm">
            {c.staffByRole.map((r) => <li key={r.code}>{t(r.name)} <span className="font-semibold tabular-nums">{r.count}</span></li>)}
          </ul>
        </div>
      )}
    </Panel>
  );
}

// ───────────────────────────────────────────── refusals ─────────────────────────────────────────────
function DeniedPanel({ rows, t, when }: { rows: DeniedEntry[]; t: T; when: (x: Date) => string }) {
  return (
    <Panel title={t("Refused to you")} subtitle={t("The last {n} times a page or an action was refused to a Developer account.", { n: 20 })}>
      {rows.length === 0 ? (
        <p className="rounded-2xl bg-emerald-500/[0.07] px-3 py-2 text-sm text-emerald-800 dark:text-emerald-200">{t("Nothing was refused to a Developer account.")}</p>
      ) : (
        <div className="overflow-x-auto">
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
      )}
    </Panel>
  );
}

// ───────────────────────────────────────────── the inspector's answer ─────────────────────────────────────────────
function InspectionResult({ r, t }: { r: Inspection; t: T }) {
  if (!r.ok) {
    return <p role="alert" className="mt-4 rounded-2xl border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2 text-sm text-amber-800 dark:text-amber-200">{t(r.problem)}</p>;
  }
  return (
    <div className="mt-4 space-y-3" aria-live="polite">
      <div className={cn("rounded-2xl border px-4 py-3", r.has ? "border-emerald-500/40 bg-emerald-500/[0.07]" : "border-border bg-muted/40")}>
        <p className="flex items-center gap-2 text-base font-semibold">
          {r.has ? <CheckCircle2 className="size-5 text-emerald-600" aria-hidden="true" /> : <ShieldAlert className="size-5 text-muted-foreground" aria-hidden="true" />}
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
        <summary className="flex cursor-pointer items-center gap-2 text-sm font-medium"><KeyRound className="size-4 text-muted-foreground" aria-hidden="true" />{t("Everything {name} can do ({n} rights)", { name: r.person.name, n: r.rights.length })}</summary>
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
