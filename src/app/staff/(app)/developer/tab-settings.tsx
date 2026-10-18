import type { ReactNode } from "react";
import { ChevronDown, CircleAlert } from "lucide-react";
import type { T } from "@/i18n/translate";
import type { Diagnostics, EnvSetting, HotelSetup, SettingsTab as SettingsData } from "@/server/services/developer-console";
import { Panel } from "@/components/dashboard/kit";
import { num, Quiet, Tag } from "./console-ui";

/**
 * SETTINGS: what the system needs to run (yes / no and counters — never a key or a password) next to how the hotel is set up (the numbers
 * prices and bills are worked out from), each setting on ONE line (what it is for is the hover text); and, under them, one slim strip about
 * your own session with the rights the Developer role does NOT hold (money, and why). Accounts by role are in People, not here.
 */

function minutesWords(t: T, total: number) {
  const h = Math.floor(total / 60);
  const m = total % 60;
  return h > 0 ? t("{h} h {m} min", { h, m }) : t("{m} min", { m });
}

/** One line of "How the hotel is set up": the name on the left, the value on the right; what it is for is the hover text. */
function SetupRow({ label, hint, children }: { label: string; hint: string; children: ReactNode }) {
  return (
    <li title={hint} className="flex items-center justify-between gap-4 border-b border-border/60 px-4 py-2 last:border-b-0 sm:px-6">
      <span className="min-w-0 text-sm">{label}</span>
      <span className="shrink-0 text-right text-sm font-semibold tabular-nums">{children}</span>
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
  const row = "flex items-center justify-between gap-3 border-b border-border/60 px-4 py-2 last:border-b-0 sm:px-6";
  return (
    <Panel
      title={t("What the system needs to run")}
      subtitle={<span title={missing === 0 ? t("All required settings are in place. Only whether a setting exists is shown, never its value.") : t("{n} required settings are missing. Only whether a setting exists is shown, never its value.", { n: missing })}>{missing === 0 ? t("All required settings are in place.") : t("{n} required settings are missing.", { n: missing })}</span>}
      action={<Tag tone={missing === 0 ? "emerald" : "rose"}>{t("{a} of {b} set", { a: setCount, b: env.length })}</Tag>}
      bodyClassName="-mx-4 -mb-4 sm:-mx-6 sm:-mb-6"
    >
      <ul className="border-t border-border/60">
        {env.map((e) => (
          <li key={e.key} title={t(e.description)} className={row}>
            <span className="min-w-0 text-sm">
              <span className="font-medium">{t(e.label)}</span>
              <span className="ml-2 break-all font-mono text-[11px] text-muted-foreground">{e.key}</span>
            </span>
            <Tag tone={e.set ? "emerald" : e.required ? "rose" : "slate"}>{e.set ? t("Set") : e.required ? t("Missing") : t("Not set")}</Tag>
          </li>
        ))}
        <li className={row}>
          <span className="min-w-0 text-sm">
            <span className="font-medium">{t("Database updates (migrations)")}</span>
            <span className="ml-2 break-all text-[11px] text-muted-foreground">
              {m ? [t("{n} applied", { n: m.applied }), m.latest ? t("Latest: {name}", { name: m.latest }) : null, m.failed > 0 ? t("{n} failed or not finished", { n: m.failed }) : null, m.rolledBack > 0 ? t("{n} undone", { n: m.rolledBack }) : null].filter(Boolean).join(" · ") : t("Could not be read")}
            </span>
          </span>
          <Tag tone={updatesOk ? "emerald" : "rose"}>{updatesOk ? t("OK") : t("Look at it")}</Tag>
        </li>
      </ul>
    </Panel>
  );
}

const Dot = () => <span className="text-muted-foreground/60" aria-hidden>·</span>;

/**
 * ONE slim strip about your own session, taken from the server — not from the page: who you are, when you signed in, how long is left,
 * how many rights you hold; and, folded away in the same strip, the rights the Developer role does not hold (money and accounts) and why.
 */
function YouStrip({ t, id, when }: { t: T; id: SettingsData["identity"]; when: (x: Date) => string }) {
  const ses = id.session;
  const timeHint = ses ? (ses.endsBecause === "idle" ? t("Signs out at {time} unless you keep working (after {n} minutes without use).", { time: when(ses.endsAt), n: ses.idleMinutes }) : t("Signs out at {time} at the latest ({n} hours after signing in).", { time: when(ses.endsAt), n: ses.limitHours })) : undefined;
  return (
    <section aria-label={t("Your session")} className="rounded-2xl border border-border/70 bg-card px-4 py-3 shadow-[0_1px_2px_rgba(15,23,42,0.04)] sm:px-5">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
        <p className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5 text-sm">
          <span className="font-semibold">{t("You: {name}", { name: id.name })}</span>
          <Dot /><span>{t(id.roleName)}</span>
          {ses && <><Dot /><span className="text-muted-foreground">{t("signed in {time}", { time: when(ses.startedAt) })}</span><Dot /><span className="text-muted-foreground" title={timeHint}>{t("{time} left", { time: minutesWords(t, ses.minutesLeft) })}</span></>}
          <Dot /><span className="text-muted-foreground">{t.plural(id.rightsCount, "{n} right", "{n} rights")}</span>
        </p>
        <details className="group ml-auto open:ml-0 open:w-full">
          <summary
            title={`${t(id.reason)} ${t(id.accountsReason)}`}
            className="flex cursor-pointer list-none items-center justify-end gap-1.5 text-sm font-medium text-muted-foreground marker:content-none hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold group-open:justify-start [&::-webkit-details-marker]:hidden"
          >
            <span>{t("Rights you do not hold ({n})", { n: id.notHeld.length })}</span>
            <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="mt-2 grid gap-x-6 gap-y-1.5 border-t border-border/60 pt-3 text-sm sm:grid-cols-2">
            {id.notHeld.map((r) => (
              <li key={r.code} className="min-w-0 leading-snug">
                <span className="break-words">{t(r.description)}</span>
                <span className="block font-mono text-[11px] text-muted-foreground">{r.code}</span>
              </li>
            ))}
          </ul>
        </details>
      </div>
      {id.heldButDenied.length > 0 && (
        <p role="alert" className="mt-2 flex items-start gap-2 rounded-2xl border border-amber-500/40 bg-amber-500/[0.07] px-3 py-2 text-sm text-amber-800 dark:text-amber-200">
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>{t("This account holds {n} right(s) about money or accounts that the Developer role is meant never to hold: {codes}. Fix the role.", { n: id.heldButDenied.length, codes: id.heldButDenied.join(", ") })}</span>
        </p>
      )}
    </section>
  );
}

export function SettingsTab({ t, s, when }: { t: T; s: SettingsData; when: (x: Date) => string }) {
  return (
    <div className="space-y-4">
      <div className="grid items-start gap-4 lg:grid-cols-2">
        <EnvPanel t={t} env={s.env} d={s.config} />
        <HotelPanel t={t} h={s.hotel} />
      </div>
      <YouStrip t={t} id={s.identity} when={when} />
    </div>
  );
}
