import type { ReactNode } from "react";
import { ChevronDown, CircleAlert, ShieldCheck } from "lucide-react";
import type { T } from "@/i18n/translate";
import type { Diagnostics, EnvSetting, HotelSetup, SettingsTab as SettingsData, TeamRole } from "@/server/services/developer-console";
import { Panel } from "@/components/dashboard/kit";
import { RankBars } from "./console-charts";
import { num, Quiet, Tag } from "./console-ui";

/**
 * SETTINGS: how the hotel is set up (the numbers prices and bills are worked out from), what the system needs to run (yes / no and counters —
 * never a key or a password) and who is on the team (counts by role); then your own session and limits and the rights the Developer role does
 * NOT hold (money, and why).
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

/** One line of "How the hotel is set up": a bold name, a short muted line saying what it is, and the value on the right. */
function SetupRow({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <li className="flex items-start justify-between gap-4 border-b border-border/60 px-4 py-3.5 last:border-b-0 sm:px-6">
      <span className="min-w-0 text-sm leading-snug">
        <span className="block font-medium">{label}</span>
        <span className="mt-0.5 block text-xs text-muted-foreground">{hint}</span>
      </span>
      <span className="shrink-0 pt-0.5 text-right text-sm font-semibold tabular-nums">{children}</span>
    </li>
  );
}

const Unread = ({ t }: { t: T }) => <span className="font-normal text-muted-foreground" title={t("This could not be read just now.")}>—</span>;

/** "How the hotel is set up": values from the hotel's settings and plain counts — never an account number, a key or a name. */
function HotelPanel({ t, h }: { t: T; h: HotelSetup }) {
  const onOff = (v: boolean | null) => (v === null ? <Unread t={t} /> : <Tag tone={v ? "emerald" : "slate"}>{v ? t("On") : t("Off")}</Tag>);
  const count = (v: number | null) => (v === null ? <Unread t={t} /> : num(t, v));
  const unread = Object.values(h).every((v) => v === null);
  return (
    <Panel title={t("How the hotel is set up")} subtitle={t("The numbers prices and bills are worked out from.")} bodyClassName="-mx-4 -mb-4 sm:-mx-6 sm:-mb-6">
      {unread ? <div className="px-4 pb-4 sm:px-6 sm:pb-6"><Quiet>{t("This could not be read just now.")}</Quiet></div> : (
        <ul className="border-t border-border/60">
          <SetupRow label={t("Business day starts")} hint={t("Every figure is counted from this hour to the same hour next morning.")}>{h.dayStart ?? <Unread t={t} />}</SetupRow>
          <SetupRow label={t("Time zone")} hint={t("The clock the hotel's days and times follow.")}>{h.timezone ?? <Unread t={t} />}</SetupRow>
          <SetupRow label={t("Guest rooms in use")} hint={t("Rooms that can be sold.")}>{h.guestRooms ? t("{a} of {b}", { a: h.guestRooms.active, b: h.guestRooms.total }) : <Unread t={t} />}</SetupRow>
          <SetupRow label={t("Room types")} hint={t("The kinds of room, each with its own price.")}>{count(h.roomTypes)}</SetupRow>
          <SetupRow label={t("Payment accounts open")} hint={t("Cash, mobile money and bank accounts payments can go into.")}>{count(h.paymentAccounts)}</SetupRow>
          <SetupRow label={t("Report recipients")} hint={t("Who the Boss reports are sent to.")}>{count(h.reportRecipients)}</SetupRow>
          <SetupRow label={t("Daily report")} hint={t("Whether the Boss gets the daily report each morning.")}>{onOff(h.dailyReport)}</SetupRow>
          <SetupRow label={t("Room report")} hint={t("Whether the Boss gets the room report each morning.")}>{onOff(h.roomReport)}</SetupRow>
          <SetupRow label={t("Unpaid booking hold")} hint={t("How long a booking keeps its room without payment.")}>
            {h.unpaidHoldHours === null ? <Unread t={t} /> : h.unpaidHoldHours === 0 ? t("until the arrival day") : t.plural(h.unpaidHoldHours, "{n} hour", "{n} hours")}
          </SetupRow>
          <SetupRow label={t("Online payment")} hint={t("Whether guests can pay online.")}>{onOff(h.onlinePayment)}</SetupRow>
        </ul>
      )}
    </Panel>
  );
}

/** The settings the system runs on: each by NAME with "Set" or "Not set" — a key or a password is never read out. */
function EnvPanel({ t, env, d }: { t: T; env: EnvSetting[]; d: Diagnostics }) {
  const m = d.migrations;
  const missing = env.filter((e) => e.required && !e.set).length;
  const setCount = env.filter((e) => e.set).length;
  const updatesOk = !!m && m.failed === 0 && m.rolledBack === 0;
  return (
    <Panel
      title={t("What the system needs to run")} subtitle={missing === 0 ? t("All required settings are in place. Only whether a setting exists is shown, never its value.") : t("{n} required settings are missing. Only whether a setting exists is shown, never its value.", { n: missing })}
      action={<Tag tone={missing === 0 ? "emerald" : "rose"}>{t("{a} of {b} set", { a: setCount, b: env.length })}</Tag>}
      bodyClassName="-mx-4 -mb-4 sm:-mx-6 sm:-mb-6"
    >
      <ul className="border-t border-border/60">
        {env.map((e) => (
          <li key={e.key} className="flex items-start justify-between gap-3 border-b border-border/60 px-4 py-3.5 sm:px-6">
            <span className="min-w-0 text-sm leading-snug">
              <span className="block font-medium">{t(e.label)}</span>
              <span className="block break-all font-mono text-[11px] text-muted-foreground">{e.key}</span>
              <span className="mt-1 block text-xs text-muted-foreground">{t(e.description)}</span>
            </span>
            <Tag tone={e.set ? "emerald" : e.required ? "rose" : "slate"}>{e.set ? t("Set") : e.required ? t("Missing") : t("Not set")}</Tag>
          </li>
        ))}
        <li className="flex items-start justify-between gap-3 px-4 py-3.5 sm:px-6">
          <span className="min-w-0 text-sm leading-snug">
            <span className="block font-medium">{t("Database updates (migrations)")}</span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {m ? [t("{n} applied", { n: m.applied }), m.latest ? t("Latest: {name}", { name: m.latest }) : null, m.failed > 0 ? t("{n} failed or not finished", { n: m.failed }) : null, m.rolledBack > 0 ? t("{n} undone", { n: m.rolledBack }) : null].filter(Boolean).join(" · ") : t("Could not be read")}
            </span>
          </span>
          <Tag tone={updatesOk ? "emerald" : "rose"}>{updatesOk ? t("OK") : t("Look at it")}</Tag>
        </li>
      </ul>
    </Panel>
  );
}

/** "Who is on the team": active accounts by role — a count, never who. */
function TeamPanel({ t, team }: { t: T; team: TeamRole[] | null }) {
  return (
    <Panel title={t("Who is on the team")} subtitle={t("Active accounts by role.")}>
      {!team ? <Quiet>{t("This could not be read just now.")}</Quiet> : (
        <RankBars t={t} rows={team.map((r) => ({ key: r.code, label: t(r.name), value: r.active }))} color="#8466e0" caption={t("Who is on the team")} empty={t("No active accounts.")} />
      )}
    </Panel>
  );
}

export function SettingsTab({ t, s, when }: { t: T; s: SettingsData; when: (x: Date) => string }) {
  const id = s.identity;
  const ses = id.session;
  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <HotelPanel t={t} h={s.hotel} />
        <div className="space-y-4">
          <EnvPanel t={t} env={s.env} d={s.config} />
          <TeamPanel t={t} team={s.team} />
        </div>
      </div>

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
    </div>
  );
}
