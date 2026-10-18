import { Clock, LogIn, Monitor, Smartphone, UserX, Users } from "lucide-react";
import type { T } from "@/i18n/translate";
import { ONLINE_MINUTES, signInsByRole, type ActivityData } from "@/server/services/developer-activity";
import { Panel } from "@/components/dashboard/kit";
import { auditWordsFor } from "@/server/services/audit-trail";
import { BarChart, RankBars, type BarColumn } from "./console-charts";
import { agoText, dayLabel, num, Quiet, roleColours, StatBlock } from "./console-ui";

/** ACTIVITY: who is using the system and WHO IS DOING WHAT — the team's latest actions in plain words, the kinds of record the work is about, the most active people, sign-ins, who is online, accounts nobody uses. Never an amount or a guest's name. */
const capital = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

const TEAM = "#3987e5";
const DEVELOPER = "#c98500";
const HOURS = "#199e70";
const WORK = "#c98500";
const PEOPLE = "#8466e0";
const SIGN_INS = "#c98500";

/** Every other day is written under its bar (today always), so the labels never touch, even on a phone. */
const dayTick = (i: number, count: number) => (count - 1 - i) % 2 === 0;

export function ActivityTab({ t, a, now, timezone }: { t: T; a: ActivityData; now: Date; timezone: string }) {
  const s = a.stats;
  const hourName = (h: number) => `${String(h).padStart(2, "0")}:00`;
  const colours = roleColours(a.roles.map((r) => r.code));
  const signInRoles = signInsByRole(a);

  const signInColumns: BarColumn[] | null = a.signInsPerDay?.map((d, i, all) => ({
    key: d.date, tick: dayTick(i, all.length) ? dayLabel(t, d.date) : "", name: dayLabel(t, d.date), values: d.byRole, emphasise: d.date === a.today,
  })) ?? null;
  const actionColumns: BarColumn[] | null = a.actionsPerDay?.map((d, i, all) => ({
    key: d.date, tick: dayTick(i, all.length) ? dayLabel(t, d.date) : "", name: dayLabel(t, d.date), values: { team: d.team, developer: d.developer }, emphasise: d.date === a.today,
  })) ?? null;
  const hourColumns: BarColumn[] | null = a.busiestHours?.map((h) => ({
    key: String(h.hour), tick: h.hour % 3 === 0 ? `${h.hour}h` : "", name: hourName(h.hour), values: { count: h.count },
  })) ?? null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatBlock
          icon={Users} label={t("People signed in")} value={num(t, s.peopleSignedIn24h)} caption={t("different people in 24 hours")}
          tag={t.ctx("console", "Live")} tagTone="emerald"
          note={s.peopleSignedIn7d !== null ? t("{n} different people signed in over the last 7 days. If this drops to zero on a working day, check that sign-in still works.", { n: s.peopleSignedIn7d }) : undefined}
        />
        <StatBlock
          icon={Clock} label={t("Actions by the team")} value={num(t, s.teamActions24h)} caption={t("saved by staff in 24 hours")}
          tag={t("Activity")} tagTone="sky"
          note={s.busiestHour !== null
            ? t("Each sale, payment, approval or stock move counts as one action. Busiest hour: {hour} (hotel time).", { hour: hourName(s.busiestHour) })
            : t("Each sale, payment, approval or stock move counts as one action. Nothing was saved in the last 14 days.")}
        />
        <StatBlock
          icon={LogIn} label={t("Sign-ins")} value={num(t, s.signIns24h)} caption={t("successful sign-ins in 24 hours")}
          tag={t("Sign-ins")} tagTone="gold"
          note={t("Each time someone signs in with the right password. The chart below shows which roles they were.")}
        />
        <StatBlock
          icon={UserX} label={t("Failed sign-ins")} value={num(t, s.failedSignIns24h)} caption={t("wrong tries in 24 hours")} warn={!!s.failedSignIns24h}
          tag={s.failedSignIns24h ? t("Look at it") : t("Quiet")} tagTone={s.failedSignIns24h ? "amber" : "emerald"}
          note={t("A few typing mistakes are normal. Many in a day can mean someone is guessing passwords. The details are in the Errors & jobs part.")}
        />
      </div>

      <Panel title={t("Who did what, just now")} subtitle={t("The team's latest actions: who did it, in what role, and when. Never an amount or a guest's name.")} bodyClassName="-mx-4 -mb-4 sm:-mx-6 sm:-mb-6">
        {!a.latest ? <div className="px-4 pb-4 sm:px-6 sm:pb-6"><Quiet>{t("This could not be read just now.")}</Quiet></div> : a.latest.length === 0 ? <div className="px-4 pb-4 sm:px-6 sm:pb-6"><Quiet>{t("Nothing was saved by the team yet.")}</Quiet></div> : (
          <ul className="border-t border-border/60">
            {a.latest.map((r) => (
              <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 border-b border-border/60 px-4 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,14rem)_minmax(0,1fr)_auto] sm:px-6">
                <span className="min-w-0 text-sm leading-tight"><span className="font-medium">{r.name}</span>{r.roleName && <span className="block text-xs text-muted-foreground">{t(r.roleName)}</span>}</span>
                <span className="col-span-2 order-3 min-w-0 text-sm text-foreground/90 sm:order-none sm:col-span-1">{capital(auditWordsFor(r.action, null, t))}</span>
                <span className="shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground" title={t.dateTime(r.at, timezone)}>{agoText(t, r.at, now)}</span>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("Sign-ins per day")} subtitle={t("The last 14 days, coloured by who signed in. A day runs from {start} to {start} the next morning (hotel time). Hover a bar for exact numbers; the table below has them all.", { start: a.dayStart })}>
          {signInColumns
            ? <BarChart t={t} columns={signInColumns} series={a.roles.map((r) => ({ key: r.code, label: t(r.name), color: colours[r.code] }))} caption={t("Sign-ins per day")} empty={t("Nobody signed in during these 14 days.")} />
            : <Quiet>{t("This could not be read just now.")}</Quiet>}
        </Panel>
        <Panel title={t("Actions per day")} subtitle={t("Everything the team and you saved in the audit trail, 14 days. Sign-ins, just looking and refused attempts are not counted.")}>
          {actionColumns
            ? <BarChart t={t} columns={actionColumns} series={[{ key: "team", label: t("Team"), color: TEAM }, { key: "developer", label: t("Developer"), color: DEVELOPER }]} caption={t("Actions per day")} empty={t("Nothing was saved during these 14 days.")} />
            : <Quiet>{t("This could not be read just now.")}</Quiet>}
        </Panel>
        <Panel title={t("Busiest hours of the day")} subtitle={s.busiestHour !== null ? t("When the team works (hotel time, last 14 days). The peak is around {hour}.", { hour: hourName(s.busiestHour) }) : t("When the team works (hotel time, last 14 days).")}>
          {hourColumns
            ? <BarChart t={t} columns={hourColumns} series={[{ key: "count", label: t("Actions"), color: HOURS }]} caption={t("Busiest hours of the day")} empty={t("Nothing was saved during these 14 days.")} />
            : <Quiet>{t("This could not be read just now.")}</Quiet>}
        </Panel>
        <Panel title={t("Where the work happens")} subtitle={t("Actions by area, last 7 days. Counts only.")}>
          {a.where
            ? <RankBars t={t} rows={a.where.map((w) => ({ key: w.label, label: t(w.label), value: w.count }))} color={WORK} caption={t("Where the work happens")} empty={t("Nothing was saved in the last 7 days.")} />
            : <Quiet>{t("This could not be read just now.")}</Quiet>}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <div className="space-y-4">
        <Panel title={t("Recent sign-ins")} subtitle={t("The last {n} sign-ins: who, on what device, from where. Addresses are shown only here, only to the Developer.", { n: 12 })}>
          {!a.recentSignIns ? <Quiet>{t("This could not be read just now.")}</Quiet> : a.recentSignIns.length === 0 ? <Quiet>{t("Nobody has signed in yet.")}</Quiet> : (
            <div className="overflow-x-auto">
              <table data-stack className="w-full min-w-[560px] text-sm">
                <thead className="text-left text-xs text-muted-foreground">
                  <tr className="border-b border-border/70">
                    <th className="py-2 pr-4 font-medium">{t("Person")}</th><th className="py-2 pr-4 font-medium">{t("Device")}</th>
                    <th className="py-2 pr-4 font-medium">{t("From")}</th><th className="py-2 text-right font-medium">{t("When")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {a.recentSignIns.map((r) => (
                    <tr key={r.id} className="align-middle">
                      <td className="py-2.5 pr-4">
                        <span className="block font-medium leading-tight">{r.name}</span>
                        {r.roleName && <span className="block text-xs text-muted-foreground">{t(r.roleName)}</span>}
                      </td>
                      <td className="py-2.5 pr-4">
                        {r.device ? <span className="inline-flex items-center gap-1.5">{r.device.phone ? <Smartphone className="size-3.5 text-muted-foreground" aria-hidden /> : <Monitor className="size-3.5 text-muted-foreground" aria-hidden />}{r.device.label}</span> : <span className="text-muted-foreground">{t("Session ended")}</span>}
                      </td>
                      <td className="py-2.5 pr-4 font-mono text-xs">{r.ip ?? "—"}</td>
                      <td className="whitespace-nowrap py-2.5 text-right text-muted-foreground" title={t.dateTime(r.at, timezone)}>{agoText(t, r.at, now)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>
        <Panel title={t("Who signs in")} subtitle={t("Sign-ins in the last 14 days, by kind of account.")}>
          {signInRoles
            ? <RankBars t={t} rows={signInRoles.map((r) => ({ key: r.code, label: r.code === "UNKNOWN" ? t("Other") : t(r.name), value: r.count, color: colours[r.code] }))} color={SIGN_INS} caption={t("Who signs in")} empty={t("Nobody signed in during these 14 days.")} />
            : <Quiet>{t("This could not be read just now.")}</Quiet>}
        </Panel>
        </div>

        <div className="space-y-4">
          <Panel title={t("Online right now")} subtitle={t("Used the system in the last {n} minutes.", { n: ONLINE_MINUTES })} action={a.online ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{a.online.length}</span> : undefined}>
          {!a.online ? <Quiet>{t("This could not be read just now.")}</Quiet> : a.online.length === 0 ? <Quiet>{t("Nobody at the moment.")}</Quiet> : (
            <ul className="divide-y divide-border/60 text-sm">
              {a.online.map((u) => (
                <li key={u.id} className="flex items-baseline justify-between gap-3 py-2">
                  <span className="min-w-0"><span className="font-medium">{u.name}</span><span className="ml-1.5 text-xs text-muted-foreground">{t(u.roleName)}</span></span>
                  <span className="shrink-0 text-xs text-muted-foreground">{agoText(t, u.lastSeenAt, now)}</span>
                </li>
              ))}
            </ul>
          )}
          </Panel>
          <Panel title={t("Most active people")} subtitle={t("Actions saved in the last 7 days.")}>
            {a.mostActive
              ? <RankBars t={t} rows={a.mostActive.map((p) => ({ key: p.userId, label: p.name, value: p.count, note: p.developer ? t("Developer") : undefined }))} color={PEOPLE} caption={t("Most active people")} empty={t("Nothing was saved in the last 7 days.")} />
              : <Quiet>{t("This could not be read just now.")}</Quiet>}
          </Panel>
          <Panel title={t("Not using the system")} subtitle={t("Active accounts that never signed in, or not for 30+ days.")}>
            {!a.notUsing ? <Quiet>{t("This could not be read just now.")}</Quiet> : a.notUsing.length === 0 ? <Quiet>{t("Everyone has signed in within 30 days.")}</Quiet> : (
              <>
                <ul className="divide-y divide-border/60 text-sm">
                  {a.notUsing.map((u) => (
                    <li key={u.id} className="flex items-baseline justify-between gap-3 py-2">
                      <span className="min-w-0"><span className="font-medium">{u.name}</span><span className="ml-1.5 text-xs text-muted-foreground">{t(u.roleName)}</span></span>
                      <span className="shrink-0 text-xs text-muted-foreground" title={u.lastUsedAt ? t.dateTime(u.lastUsedAt, timezone) : undefined}>{u.lastUsedAt ? agoText(t, u.lastUsedAt, now) : t("Never signed in")}</span>
                    </li>
                  ))}
                </ul>
                {a.notUsingTotal > a.notUsing.length && <p className="mt-2 text-xs text-muted-foreground">{t("and {n} more", { n: a.notUsingTotal - a.notUsing.length })}</p>}
              </>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
