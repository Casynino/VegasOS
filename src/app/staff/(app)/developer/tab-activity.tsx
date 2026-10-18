import type { ReactNode } from "react";
import { Monitor, Smartphone } from "lucide-react";
import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";
import { ONLINE_MINUTES, type ActivityData } from "@/server/services/developer-activity";
import { Panel } from "@/components/dashboard/kit";
import { auditWordsFor } from "@/server/services/audit-trail";
import { BarChart, RankBars, type BarColumn } from "./console-charts";
import { agoText, dayLabel, roleColours } from "./console-ui";
import { FillScroll } from "./fill-scroll";

/**
 * ACTIVITY: who is using the system and WHO IS DOING WHAT — the team's latest actions in plain words, who is online, the latest sign-ins, the
 * sign-ins and the work per day, the busiest hours and the kinds of record the work is about. Never an amount or a guest's name.
 * Every figure is shown ONCE on the page (owner, 2026-10-18: "do not be repetitive"): the counts of the last 24 hours are in the health card at
 * the top, the people (role, work in 7 days, last sign-in) in the team table of the next part — so there are no stat cards and no ranking of
 * people here. A panel with nothing to show is NOT drawn as an empty box: one quiet line at the end names what has nothing yet.
 */
const capital = (x: string) => x.charAt(0).toUpperCase() + x.slice(1);

const TEAM = "#3987e5";
const DEVELOPER = "#c98500";
const HOURS = "#199e70";
const WORK = "#c98500";
/** How many names "Online right now" writes before "and n more". */
const ONLINE_SHOWN = 5;

/** Every other day is written under its bar (today always), so the labels never touch, even on a phone. */
const dayTick = (i: number, count: number) => (count - 1 - i) % 2 === 0;

interface ChartPanel { key: string; title: string; hover?: string; subtitle: string; body: ReactNode }

export function ActivityTab({ t, a, now, timezone }: { t: T; a: ActivityData; now: Date; timezone: string }) {
  const hourName = (h: number) => `${String(h).padStart(2, "0")}:00`;
  const colours = roleColours(a.roles.map((r) => r.code));
  const none = t("Nothing yet.");
  // Panels with nothing to show are not drawn: their names go into one quiet line at the end.
  const empty: string[] = [];
  const unread: string[] = [];
  const missing = (title: string, data: unknown[] | null, hasContent: boolean): boolean => {
    if (data === null) { unread.push(title); return true; }
    if (!hasContent) { empty.push(title); return true; }
    return false;
  };

  // ── row 1: who did what (wide) | online right now over the recent sign-ins ──
  const latest = a.latest ?? [];
  const online = a.online ?? [];
  const recent = a.recentSignIns ?? [];
  const titleLatest = t("Who did what, just now");
  const titleOnline = t("Online right now");
  const titleRecent = t("Recent sign-ins");
  const showLatest = !missing(titleLatest, a.latest, latest.length > 0);
  const showOnline = !missing(titleOnline, a.online, online.length > 0);
  const showRecent = !missing(titleRecent, a.recentSignIns, recent.length > 0);
  const side = showOnline || showRecent;

  // ── the charts: drawn only when they have something to draw ──
  const signInColumns: BarColumn[] | null = a.signInsPerDay?.map((d, i, all) => ({
    key: d.date, tick: dayTick(i, all.length) ? dayLabel(t, d.date) : "", name: dayLabel(t, d.date), values: d.byRole, emphasise: d.date === a.today,
  })) ?? null;
  const actionColumns: BarColumn[] | null = a.actionsPerDay?.map((d, i, all) => ({
    key: d.date, tick: dayTick(i, all.length) ? dayLabel(t, d.date) : "", name: dayLabel(t, d.date), values: { team: d.team, developer: d.developer }, emphasise: d.date === a.today,
  })) ?? null;
  const hourColumns: BarColumn[] | null = a.busiestHours?.map((h) => ({
    key: String(h.hour), tick: h.hour % 3 === 0 ? `${h.hour}h` : "", name: hourName(h.hour), values: { count: h.count },
  })) ?? null;
  const dayRule = t("A day runs from {start} to {start} the next morning (hotel time).", { start: a.dayStart });

  const charts: ChartPanel[] = [];
  const titleSignIns = t("Sign-ins per day");
  if (!missing(titleSignIns, signInColumns, !!a.signInsPerDay?.some((d) => d.total > 0))) {
    charts.push({
      key: "sign-ins", title: titleSignIns, hover: dayRule, subtitle: t("Last 14 days, by role. Hover a bar for the numbers."),
      body: <BarChart t={t} columns={signInColumns!} series={a.roles.map((r) => ({ key: r.code, label: t(r.name), color: colours[r.code] }))} caption={titleSignIns} empty={none} />,
    });
  }
  const titleActions = t("Actions per day");
  if (!missing(titleActions, actionColumns, !!a.actionsPerDay?.some((d) => d.total > 0))) {
    charts.push({
      key: "actions", title: titleActions,
      hover: `${t("Everything the team and you saved in the audit trail, 14 days. Sign-ins, just looking and refused attempts are not counted.")} ${dayRule}`,
      subtitle: t("Last 14 days: what the team and you saved."),
      body: <BarChart t={t} columns={actionColumns!} series={[{ key: "team", label: t("Team"), color: TEAM }, { key: "developer", label: t("Developer"), color: DEVELOPER }]} caption={titleActions} empty={none} />,
    });
  }
  const titleHours = t("Busiest hours of the day");
  if (!missing(titleHours, hourColumns, !!a.busiestHours?.some((h) => h.count > 0))) {
    charts.push({
      key: "hours", title: titleHours,
      subtitle: a.busiestHour !== null ? t("Hotel time, last 14 days. The peak is around {hour}.", { hour: hourName(a.busiestHour) }) : t("Hotel time, last 14 days."),
      body: <BarChart t={t} columns={hourColumns!} series={[{ key: "count", label: t("Actions"), color: HOURS }]} caption={titleHours} empty={none} />,
    });
  }
  const titleWhere = t("Where the work happens");
  if (!missing(titleWhere, a.where, (a.where?.length ?? 0) > 0)) {
    charts.push({
      key: "where", title: titleWhere, subtitle: t("Actions by area, last 7 days."),
      body: <RankBars t={t} rows={a.where!.map((w) => ({ key: w.label, label: t(w.label), value: w.count }))} color={WORK} caption={titleWhere} empty={none} />,
    });
  }

  return (
    <div className="space-y-4">
      {(showLatest || side) && (
        <div className={cn("grid gap-4", showLatest && side ? "lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]" : !showLatest && showOnline && showRecent ? "lg:grid-cols-2" : "")}>
          {showLatest && (
            <Panel
              title={<span title={t("The team's latest actions: who did it, in what role, and when. Never an amount or a guest's name.")}>{titleLatest}</span>}
              className="flex flex-col" bodyClassName="-mx-4 -mb-4 flex flex-1 flex-col sm:-mx-6 sm:-mb-6"
            >
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
            </Panel>
          )}

          {side && (
            <div className={showLatest ? "space-y-4" : "contents"}>
              {showOnline && (
                <Panel
                  title={<span title={t("Used the system in the last {n} minutes.", { n: ONLINE_MINUTES })}>{titleOnline}</span>}
                  action={<span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{online.length}</span>}
                >
                  <ul className="flex flex-wrap gap-x-4 gap-y-1.5 text-sm">
                    {online.slice(0, ONLINE_SHOWN).map((u) => (
                      <li key={u.id} className="flex items-baseline gap-1.5" title={agoText(t, u.lastSeenAt, now)}>
                        <span className="size-1.5 shrink-0 self-center rounded-full bg-emerald-500" aria-hidden />
                        <span className="font-medium">{u.name}</span><span className="text-xs text-muted-foreground">{t(u.roleName)}</span>
                      </li>
                    ))}
                    {online.length > ONLINE_SHOWN && <li className="text-xs text-muted-foreground">{t("and {n} more", { n: online.length - ONLINE_SHOWN })}</li>}
                  </ul>
                </Panel>
              )}
              {showRecent && (
                <Panel title={<span title={t("Addresses are shown only here, only to the Developer.")}>{titleRecent}</span>}>
                  <ul className="divide-y divide-border/60">
                    {recent.map((r) => (
                      <li key={r.id} className="py-2 leading-tight first:pt-0 last:pb-0">
                        <div className="flex items-baseline justify-between gap-3 text-sm">
                          <span className="min-w-0 truncate"><span className="font-medium">{r.name}</span>{r.roleName && <span className="ml-1.5 text-xs text-muted-foreground">{t(r.roleName)}</span>}</span>
                          <span className="shrink-0 whitespace-nowrap text-xs text-muted-foreground" title={t.dateTime(r.at, timezone)}>{agoText(t, r.at, now)}</span>
                        </div>
                        <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                          {r.device?.phone ? <Smartphone className="size-3.5 shrink-0" aria-hidden /> : <Monitor className="size-3.5 shrink-0" aria-hidden />}
                          <span className="truncate">{r.device?.label}{r.device && r.ip && " · "}{r.ip && <span className="font-mono">{r.ip}</span>}{!r.device && !r.ip && "—"}</span>
                        </p>
                      </li>
                    ))}
                  </ul>
                </Panel>
              )}
            </div>
          )}
        </div>
      )}

      {charts.length > 0 && (
        <div className="grid gap-4 lg:grid-cols-2">
          {charts.map((c, i) => (
            <Panel
              key={c.key} className={cn(charts.length % 2 === 1 && i === charts.length - 1 && "lg:col-span-2")}
              title={c.hover ? <span title={c.hover}>{c.title}</span> : c.title} subtitle={c.subtitle}
            >
              {c.body}
            </Panel>
          ))}
        </div>
      )}

      {(unread.length > 0 || empty.length > 0) && (
        <p className="px-1 text-sm text-muted-foreground">
          {unread.length > 0 && t("Could not be read just now: {list}.", { list: unread.join(", ") })}
          {unread.length > 0 && empty.length > 0 && " "}
          {empty.length > 0 && t("Nothing to show yet for: {list}.", { list: empty.join(", ") })}
        </p>
      )}
    </div>
  );
}
