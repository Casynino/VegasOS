import { ChevronDown, CircleAlert, CircleCheck, ShieldCheck } from "lucide-react";
import type { T } from "@/i18n/translate";
import type { Diagnostics, SettingsTab as SettingsData } from "@/server/services/developer-console";
import { Panel } from "@/components/dashboard/kit";
import { num, Quiet } from "./console-ui";

/**
 * SETTINGS: your own session and limits, the rights the Developer role does NOT hold (money, and why), what the system is set up with
 * (yes / no and counters — never a key or a password), and the plain facts about what is written down about you.
 */

function minutesWords(t: T, total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? t("{h} h {m} min", { h, m }) : t("{m} min", { m });
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

function Fact({ ok, label, value, note }: { ok: boolean; label: string; value: string; note?: string }) {
  return (
    <div className="flex min-w-0 items-start gap-2 rounded-2xl bg-muted/40 px-3 py-2">
      {ok ? <CircleCheck className="mt-0.5 size-4 shrink-0 text-emerald-600" aria-hidden /> : <CircleAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden />}
      <div className="min-w-0 leading-tight">
        <dt className="text-xs text-muted-foreground">{label}</dt>
        <dd className="mt-0.5 break-words text-sm">{value}</dd>
        {note && <dd className="mt-0.5 break-words text-xs text-muted-foreground">{note}</dd>}
      </div>
    </div>
  );
}

function ConfigPanel({ t, d, when }: { t: T; d: Diagnostics; when: (x: Date) => string }) {
  const m = d.migrations;
  const w = d.whatsapp;
  return (
    <Panel title={t("System set-up")} subtitle={t("Checked {when}. Only yes / no and numbers — a key or a password is never read out.", { when: when(d.checkedAt) })}>
      <dl className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        <Fact ok={d.database.reachable} label={t("Database")} value={d.database.reachable ? t("Reachable") : t("Not reachable")} note={d.database.ms !== null ? t("{ms} ms to answer", { ms: d.database.ms }) : undefined} />
        <Fact
          ok={!!m && m.failed === 0 && m.rolledBack === 0} label={t("Database updates (migrations)")}
          value={m ? t("{n} applied", { n: m.applied }) : t("Could not be read")}
          note={m ? [m.latest ? t("Latest: {name}", { name: m.latest }) : null, m.failed > 0 ? t("{n} failed or not finished", { n: m.failed }) : null, m.rolledBack > 0 ? t("{n} undone", { n: m.rolledBack }) : null].filter(Boolean).join(" · ") || undefined : undefined}
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
    </Panel>
  );
}

export function SettingsTab({ t, s, when }: { t: T; s: SettingsData; when: (x: Date) => string }) {
  const id = s.identity;
  const ses = id.session;
  return (
    <div className="space-y-4">
      <Panel title={t("Your session")} subtitle={t("The account you are signed in as, taken from the server — not from the page.")}>
        <dl className="grid gap-2 text-sm sm:grid-cols-2 lg:grid-cols-3">
          <Info label={t("Name")} value={id.name} />
          <Info label={t("Account type")} value={t("Developer account")} />
          <Info label={t("Role")} value={t(id.roleName)} />
          <Info label={t("Signed in at")} value={ses ? when(ses.startedAt) : "—"} />
          <Info
            label={t("Time left")} value={ses ? minutesWords(t, ses.minutesLeft) : "—"}
            hint={ses ? (ses.endsBecause === "idle" ? t("Signs out at {time} unless you keep working (after {n} minutes without use).", { time: when(ses.endsAt), n: ses.idleMinutes }) : t("Signs out at {time} at the latest ({n} hours after signing in).", { time: when(ses.endsAt), n: ses.limitHours })) : undefined}
          />
          <Info label={t("Rights you hold")} value={num(t, id.rightsCount)} />
        </dl>
        {id.heldButDenied.length > 0 && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            <span>{t("This account holds {n} right(s) about money or accounts that the Developer role is meant never to hold: {codes}. Fix the role.", { n: id.heldButDenied.length, codes: id.heldButDenied.join(", ") })}</span>
          </p>
        )}
        <p className="mt-3 text-xs text-muted-foreground">{t("Work as ends by itself after 4 hours, or when this session ends — whichever comes first. The end is written to the audit trail the next time you open a page, or when the session is removed.")}</p>
      </Panel>

      <Panel title={t("What you cannot do")} subtitle={t("The Developer role never writes money and never creates or changes accounts. This is by design, and it is checked on the server — not only hidden on the screen.")}>
        <h3 className="flex items-center gap-2 text-sm font-semibold"><ShieldCheck className="size-4 text-emerald-600" aria-hidden />{t("Rights you do not hold (money and accounts)")}</h3>
        <p className="mt-1 text-xs text-muted-foreground">{t(id.reason)}</p>
        <p className="mt-1 text-xs text-muted-foreground">{t(id.accountsReason)}</p>
        <details className="group mt-3 rounded-2xl border border-border/60 bg-muted/30">
          <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2.5 text-sm font-medium marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
            <span>{t("Show the {n} rights", { n: id.notHeld.length })}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="grid gap-x-6 gap-y-1.5 border-t border-border/60 px-4 py-3 text-sm sm:grid-cols-2">
            {id.notHeld.map((r) => (
              <li key={r.code} className="min-w-0 leading-snug">
                <span className="break-words">{t(r.description)}</span>
                <span className="block font-mono text-[11px] text-muted-foreground">{r.code}</span>
              </li>
            ))}
          </ul>
        </details>
        <p className="mt-3 text-xs text-muted-foreground">{t("The same wall holds while you work as someone: you hold their rights minus these, and the decisions about money stay refused.")}</p>
      </Panel>

      <ConfigPanel t={t} d={s.config} when={when} />

      <Panel title={t("What is written down about you")} subtitle={t("Nothing you do here is secret from the owner. This is the whole list.")}>
        <ul className="space-y-2 text-sm leading-relaxed text-foreground/90">
          <li>{t("Every page you open is written to the audit trail, once per page every 10 minutes. Only the sign-in page and the “no access” page are left out.")}</li>
          <li>{t("Everything you change is kept as a Developer action. While you work as someone it reads like “Nino (Developer) as Neema (Reception)” — under your name, never theirs.")}</li>
          <li>{t("Developer entries cannot be edited or deleted — the database refuses it. The only change the system ever makes to an older line is marking a cancelled check-in as cancelled.")}</li>
          <li>{t("The Boss and the other report recipients are told on WhatsApp every time you start working as someone, and the audit trail records whether they were reached.")}</li>
          <li>{t("An export or a download is written down before the file is sent, and refused if it cannot be written.")}</li>
          <li>{t("Every refusal you meet is kept, and every look at what a person can do.")}</li>
        </ul>
        {s.recorded ? (
          <dl className="mt-4 grid grid-cols-3 gap-2">
            <Info label={t("Last 24 hours")} value={num(t, s.recorded.last24h)} />
            <Info label={t("Last 7 days")} value={num(t, s.recorded.last7d)} />
            <Info label={t("Ever")} value={num(t, s.recorded.total)} />
          </dl>
        ) : <div className="mt-3"><Quiet>{t("This could not be read just now.")}</Quiet></div>}
        <p className="mt-2 text-xs text-muted-foreground">{t("Entries of yours in the audit trail (every kind).")}</p>
      </Panel>
    </div>
  );
}
