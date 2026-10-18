import type { ReactNode } from "react";
import { Clock, LogIn, Monitor, Smartphone, UserX, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";
import { ONLINE_MINUTES, type ActivityData } from "@/server/services/developer-activity";
import { Panel } from "@/components/dashboard/kit";
import { auditWordsFor } from "@/server/services/audit-trail";
import { BarChart, RankBars, type BarColumn } from "./console-charts";
import { agoText, dayLabel, num, roleColours, StatBlock, Tag } from "./console-ui";
import { FillScroll } from "./fill-scroll";

/**
 * ACTIVITY (copied from the Activity part of the owner's Target / ORA consoles, 2026-10-18: "nice table, nice charts, nice cards, no drama"):
 * four figures, who did what just now, the sign-ins and the work per day, the busiest hours and the kinds of record the work is about, then the
 * table of the latest sign-ins beside who is online, the most active people and the accounts nobody uses. Never an amount or a guest's name.
 * Every panel is always drawn the way Target draws it: its title and subtitle, and when it has nothing (or could not be read) ONE short quiet line,
 * never an empty frame. A long list scrolls inside its panel (a labelled region the keyboard reaches), so 40 people never make the page long.
 * An explanation is a hover text, never a paragraph on the page.
 */
const capital = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

const TEAM = "#3987e5";
const DEVELOPER = "#c98500";
const HOURS = "#199e70";
const WORK = "#c98500";
const PEOPLE = "#1aa3b8";

/** Every other day is written under its bar (today always), so the labels never touch, even on a phone. */
const dayTick = (i: number, count: number) => (count - 1 - i) % 2 === 0;

/** More rows than this and a list scrolls inside its panel. */
const SCROLL_ABOVE = 8;

/** The one short, quiet, centred line a panel without anything to show draws under its title and subtitle (Target's way; never a tall empty box). */
function PanelNote({ children }: { children: ReactNode }) {
  return <p className="px-2 py-5 text-center text-sm text-muted-foreground">{children}</p>;
}

/** A list that scrolls inside its panel when it is longer than SCROLL_ABOVE rows (a labelled region, reachable by keyboard). */
function ScrollList({ label, rows, children }: { label: string; rows: number; children: ReactNode }) {
  const scrolls = rows > SCROLL_ABOVE;
  return (
    <div
      {...(scrolls ? { tabIndex: 0, role: "region", "aria-label": label } : {})}
      className={cn(scrolls && "max-h-96 overflow-y-auto overscroll-contain focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold")}
    >
      {children}
    </div>
  );
}

/** A round avatar with the first letter of the name (Target's look: a quiet grey circle). */
function Avatar({ name }: { name: string }) {
  return <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold text-foreground/80" aria-hidden>{(name.trim().charAt(0) || "?").toUpperCase()}</span>;
}

/** One line of a small list: "Name · role" (the role small and muted), and a note at the right. */
function PersonLine({ name, role, children }: { name: string; role?: string | null; children: ReactNode }) {
  return (
    <li className="flex items-center gap-3 py-2.5 first:pt-0 last:pb-0">
      <span className="min-w-0 flex-1 truncate text-sm"><span className="font-medium">{name}</span>{role && <span className="text-xs text-muted-foreground"> · {role}</span>}</span>
      {children}
    </li>
  );
}

export function ActivityTab({ t, a, now, timezone }: { t: T; a: ActivityData; now: Date; timezone: string }) {
  const s = a.stats;
  const hourName = (h: number) => `${String(h).padStart(2, "0")}:00`;
  const colours = roleColours(a.roles.map((r) => r.code));
  const unread = t("This could not be read just now.");
  const none = t("Nothing yet.");
  const dayRule = t("A day runs from {start} to {start} the next morning (hotel time).", { start: a.dayStart });

  /** A panel of a chart: the chart when there is something to draw, otherwise the title, the subtitle and ONE quiet line. */
  const chartPanel = (key: string, title: string, subtitle: string, hover: string | undefined, data: unknown[] | null, hasContent: boolean, emptyLine: string, body: () => ReactNode) => (
    <Panel key={key} level={3} title={hover ? <span title={hover}>{title}</span> : title} subtitle={subtitle}>
      {data === null ? <PanelNote>{unread}</PanelNote> : !hasContent ? <PanelNote>{emptyLine}</PanelNote> : body()}
    </Panel>
  );

  const signInColumns: BarColumn[] | null = a.signInsPerDay?.map((d, i, all) => ({
    key: d.date, tick: dayTick(i, all.length) ? dayLabel(t, d.date) : "", name: dayLabel(t, d.date), values: d.byRole, emphasise: d.date === a.today,
  })) ?? null;
  const actionColumns: BarColumn[] | null = a.actionsPerDay?.map((d, i, all) => ({
    key: d.date, tick: dayTick(i, all.length) ? dayLabel(t, d.date) : "", name: dayLabel(t, d.date), values: { team: d.team, developer: d.developer }, emphasise: d.date === a.today,
  })) ?? null;
  const hourColumns: BarColumn[] | null = a.busiestHours?.map((h) => ({
    key: String(h.hour), tick: h.hour % 3 === 0 ? `${h.hour}h` : "", name: hourName(h.hour), values: { count: h.count },
  })) ?? null;

  const latest = a.latest ?? [];
  const online = a.online ?? [];
  const recent = a.recentSignIns ?? [];
  const active = a.mostActive ?? [];
  const idle = a.notUsing ?? [];
  const titleLatest = t("Who did what, just now");
  const titleRecent = t("Recent sign-ins");
  const titleOnline = t("Online right now");
  const titleActive = t("Most active people");
  const titleIdle = t("Not using the system");
  const gutter = "-mx-4 -mb-4 sm:-mx-6 sm:-mb-6";

  return (
    <div className="space-y-4">
      {/* ── the four figures ── */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatBlock
          icon={Users} label={t("Signed in today")} value={num(t, s.peopleSignedIn24h)} caption={t("different people in 24 hours")}
          tag={t.ctx("console", "Live")} tagTone="sky"
          note={s.peopleSignedIn7d !== null ? t("{n} different people signed in over the last 7 days. If this drops to zero on a working day, check that sign-in still works.", { n: s.peopleSignedIn7d }) : undefined}
        />
        <StatBlock
          icon={Clock} label={t("Actions in 14 days")} value={num(t, s.teamActions14d)} caption={t("by the team")}
          tag={t("Activity")} tagTone="sky"
          note={a.busiestHour !== null
            ? t("Each sale, payment, approval or stock move counts as one action. Busiest hour: {hour} (hotel time).", { hour: hourName(a.busiestHour) })
            : t("Each sale, payment, approval or stock move counts as one action. Nothing was saved in the last 14 days.")}
        />
        <StatBlock
          icon={LogIn} label={t("Sign-ins in 14 days")} value={num(t, s.signIns14d)} caption={t("successful sign-ins")}
          tag={t("Sign-ins")} tagTone="sky"
          note={t("Each time someone signs in with the right password. The chart below shows which roles they were.")}
        />
        <StatBlock
          icon={UserX} label={t("Failed sign-ins (24h)")} value={num(t, s.failedSignIns24h)} caption={t("wrong password or blocked account")} warn={!!s.failedSignIns24h}
          tag={s.failedSignIns24h ? t("Look at it") : t("Normal")} tagTone={s.failedSignIns24h ? "amber" : "emerald"}
          note={t("A few typing mistakes are normal. Many in a day can mean someone is guessing passwords. The details are in the Errors & jobs part.")}
        />
      </div>

      {/* ── who did what, just now ── */}
      <Panel
        level={3}
        title={<span title={t("The team's latest actions: who did it, in what role, and when. Never an amount or a guest's name.")}>{titleLatest}</span>}
        subtitle={t("The team's latest actions, newest first.")}
        className="flex flex-col" bodyClassName={a.latest !== null && latest.length > 0 ? cn("flex flex-1 flex-col", gutter) : undefined}
      >
        {a.latest === null ? <PanelNote>{unread}</PanelNote> : latest.length === 0 ? <PanelNote>{t("Nothing was saved by the team yet.")}</PanelNote> : (
          <FillScroll label={titleLatest} className="border-t border-border/60">
            <ul>
              {latest.map((r) => (
                <li key={r.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-baseline gap-x-4 gap-y-0.5 border-b border-border/60 px-4 py-2.5 last:border-b-0 sm:grid-cols-[minmax(0,12rem)_minmax(0,1fr)_auto] sm:px-6">
                  <span className="min-w-0 text-sm leading-tight"><span className="font-medium">{r.name}</span>{r.roleName && <span className="block text-xs text-muted-foreground">{t(r.roleName)}</span>}</span>
                  <span className="col-span-2 order-3 min-w-0 text-sm text-foreground/90 sm:order-none sm:col-span-1">{capital(auditWordsFor(r.action, null, t))}</span>
                  <span className="shrink-0 whitespace-nowrap text-right text-xs text-muted-foreground" title={t.dateTime(r.at, timezone)}>{agoText(t, r.at, now)}</span>
                </li>
              ))}
            </ul>
          </FillScroll>
        )}
      </Panel>

      {/* ── sign-ins and actions per day ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {chartPanel("sign-ins", t("Sign-ins per day"), t("Last 14 days, by role. Hover a bar for the numbers."), dayRule, a.signInsPerDay, !!a.signInsPerDay?.some((d) => d.total > 0), t("Nobody signed in during these 14 days."), () => (
          <BarChart t={t} columns={signInColumns!} series={a.roles.map((r) => ({ key: r.code, label: t(r.name), color: colours[r.code] }))} caption={t("Sign-ins per day")} empty={none} />
        ))}
        {chartPanel(
          "actions", t("Actions per day"), t("Last 14 days: what the team and you saved."),
          `${t("Everything the team and you saved in the audit trail, 14 days. Sign-ins, just looking and refused attempts are not counted.")} ${dayRule}`,
          a.actionsPerDay, !!a.actionsPerDay?.some((d) => d.total > 0), t("Nothing was saved during these 14 days."), () => (
            <BarChart t={t} columns={actionColumns!} series={[{ key: "team", label: t("Team"), color: TEAM }, { key: "developer", label: t("Developer"), color: DEVELOPER }]} caption={t("Actions per day")} empty={none} />
          ),
        )}
      </div>

      {/* ── the busiest hours and where the work happens ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        {chartPanel(
          "hours", t("Busiest hours of the day"),
          a.busiestHour !== null ? t("Hotel time, last 14 days. The peak is around {hour}.", { hour: hourName(a.busiestHour) }) : t("Hotel time, last 14 days."),
          undefined, a.busiestHours, !!a.busiestHours?.some((h) => h.count > 0), t("Nothing was saved during these 14 days."), () => (
            <BarChart t={t} columns={hourColumns!} series={[{ key: "count", label: t("Actions"), color: HOURS }]} caption={t("Busiest hours of the day")} empty={none} />
          ),
        )}
        {chartPanel("where", t("Where the work happens"), t("Actions by area, last 7 days."), undefined, a.where, (a.where?.length ?? 0) > 0, t("Nothing was saved in the last 7 days."), () => (
          <RankBars t={t} rows={a.where!.map((w) => ({ key: w.label, label: t(w.label), value: w.count }))} color={WORK} caption={t("Where the work happens")} empty={none} />
        ))}
      </div>

      {/* ── the table of the latest sign-ins | who is online, who does the most, who does not use the system ── */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]">
        <Panel
          level={3} title={<span title={t("Addresses are shown only here, only to the Developer.")}>{titleRecent}</span>}
          subtitle={t("Successful sign-ins, newest first: who, on what device, from where.")}
          className="flex flex-col" bodyClassName={a.recentSignIns !== null && recent.length > 0 ? cn("flex flex-1 flex-col", gutter) : undefined}
        >
          {a.recentSignIns === null ? <PanelNote>{unread}</PanelNote> : recent.length === 0 ? <PanelNote>{t("Nobody has signed in yet.")}</PanelNote> : (
            <FillScroll label={titleRecent} maxH="max-h-96" minH="lg:min-h-[24rem]" className="border-t border-border/60">
              <table data-stack className="w-full min-w-[520px] text-sm">
                <caption className="sr-only">{titleRecent}</caption>
                <thead>
                  <tr className="text-left text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                    {[t("Person"), t("Device"), t("From")].map((h, i) => (
                      <th key={h} scope="col" className={cn("sticky top-0 z-10 bg-card py-2.5 pr-4 font-medium shadow-[inset_0_-1px_0_var(--border)]", i === 0 && "pl-4 sm:pl-6")}>{h}</th>
                    ))}
                    <th scope="col" className="sticky top-0 z-10 bg-card py-2.5 pr-4 text-right font-medium shadow-[inset_0_-1px_0_var(--border)] sm:pr-6">{t("When")}</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border/60">
                  {recent.map((r) => (
                    <tr key={r.id} className="align-middle">
                      <td data-label={t("Person")} className="py-3 pl-4 pr-4 sm:pl-6">
                        <span className="flex items-center gap-3">
                          <Avatar name={r.name} />
                          <span className="min-w-0 leading-tight"><span className="block truncate font-medium">{r.name}</span>{r.roleName && <span className="block truncate text-xs text-muted-foreground">{t(r.roleName)}</span>}</span>
                        </span>
                      </td>
                      <td data-label={t("Device")} className="py-3 pr-4">
                        {r.device
                          ? <span className="inline-flex items-center gap-2 whitespace-nowrap">{r.device.phone ? <Smartphone className="size-4 shrink-0 text-muted-foreground" aria-hidden /> : <Monitor className="size-4 shrink-0 text-muted-foreground" aria-hidden />}{r.device.label}</span>
                          : <span className="text-muted-foreground" title={t("Session ended")}>—</span>}
                      </td>
                      <td data-label={t("From")} className="py-3 pr-4 font-mono text-xs text-foreground/80">{r.ip ?? <span className="font-sans text-sm text-muted-foreground">—</span>}</td>
                      <td data-label={t("When")} className="whitespace-nowrap py-3 pr-4 text-right text-muted-foreground sm:pr-6" title={t.dateTime(r.at, timezone)}>{agoText(t, r.at, now)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </FillScroll>
          )}
        </Panel>

        <div className="space-y-4">
          <Panel
            level={3} title={titleOnline} subtitle={t("Used the system in the last {n} minutes.", { n: ONLINE_MINUTES })}
            action={a.online ? <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{online.length}</span> : undefined}
          >
            {a.online === null ? <PanelNote>{unread}</PanelNote> : online.length === 0 ? <PanelNote>{t("Nobody at the moment.")}</PanelNote> : (
              <ScrollList label={titleOnline} rows={online.length}>
                <ul className="divide-y divide-border/60">
                  {online.map((u) => (
                    <PersonLine key={u.id} name={u.name} role={t(u.roleName)}>
                      <span className="flex shrink-0 items-center gap-1.5 text-xs text-muted-foreground"><span className="size-1.5 rounded-full bg-emerald-500" aria-hidden />{agoText(t, u.lastSeenAt, now)}</span>
                    </PersonLine>
                  ))}
                </ul>
              </ScrollList>
            )}
          </Panel>

          <Panel level={3} title={titleActive} subtitle={t("Actions saved in the last 7 days.")}>
            {a.mostActive === null ? <PanelNote>{unread}</PanelNote> : active.length === 0 ? <PanelNote>{t("Nothing was saved in the last 7 days.")}</PanelNote> : (
              <RankBars t={t} rows={active.map((p) => ({ key: p.userId, label: p.name, value: p.count, note: p.roleName ? t(p.roleName) : undefined }))} color={PEOPLE} caption={titleActive} empty={none} />
            )}
          </Panel>

          <Panel level={3} title={titleIdle} subtitle={t("Active accounts that never signed in, or not for 30+ days.")}>
            {a.notUsing === null ? <PanelNote>{unread}</PanelNote> : idle.length === 0 ? <PanelNote>{t("Everyone has signed in within 30 days.")}</PanelNote> : (
              <>
                <ScrollList label={titleIdle} rows={idle.length}>
                  <ul className="divide-y divide-border/60">
                    {idle.map((u) => (
                      <PersonLine key={u.id} name={u.name} role={t(u.roleName)}>
                        {u.lastUsedAt
                          ? <span className="shrink-0 text-xs text-muted-foreground" title={t.dateTime(u.lastUsedAt, timezone)}>{agoText(t, u.lastUsedAt, now)}</span>
                          : <Tag tone="amber">{t("Never")}</Tag>}
                      </PersonLine>
                    ))}
                  </ul>
                </ScrollList>
                {a.notUsingTotal > idle.length && <p className="mt-2 text-xs text-muted-foreground">{t("and {n} more", { n: a.notUsingTotal - idle.length })}</p>}
              </>
            )}
          </Panel>
        </div>
      </div>
    </div>
  );
}
