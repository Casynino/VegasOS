import "server-only";
import { db } from "../db";
import { businessDayConfig, getSettings } from "../settings";
import { Prisma } from "@/generated/prisma/client";
import { formatMinutesLabel } from "@/lib/format";
import { addDays, businessDateOf, businessRangeBounds, eachDate, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { deviceLabel } from "@/lib/device-label";
import { DEVELOPER_ROLE_CODE } from "@/lib/permissions";
import { assertConsoleAccess, NOT_WORK_ACTIONS, safe, short, type ConsoleUser } from "./developer-console";
import { SYSTEM_ROLE } from "./staff-accounts";

/**
 * WHO IS USING THE SYSTEM (owner, 2026-10-18): sign-ins per day, how much the team saves per day and at which hours, the latest sign-ins with
 * their device and place, who is online right now, and the accounts that do not use the system. It counts and names PEOPLE and times — never what
 * the work was about (no kinds of record, no amounts, no guests): the Developer is not part of the hotel's operations, he looks after the system.
 */
const HOUR = 3600_000;
const DAY = 24 * HOUR;
export const ACTIVITY_DAYS = 14;
export const NOT_USING_DAYS = 30;
export const RECENT_SIGN_INS = 12;
/** "Online right now" = used the system in the last this-many minutes. */
export const ONLINE_MINUTES = 10;

export interface ActivityData {
  today: BusinessDate;
  /** When a hotel day starts, as "04:00" (a day runs from then to the same time next morning). */
  dayStart: string;
  /** The last 14 hotel days, oldest first, ending today. */
  days: BusinessDate[];
  stats: {
    peopleSignedIn24h: number | null;
    peopleSignedIn7d: number | null;
    teamActions24h: number | null;
    developerActions24h: number | null;
    signIns24h: number | null;
    failedSignIns24h: number | null;
    /** The busiest hour of the day (0–23) over the last 14 days, null when nothing was done. */
    busiestHour: number | null;
  };
  /** The roles that signed in during the 14 days (the chart's series), most sign-ins first. */
  roles: { code: string; name: string }[];
  signInsPerDay: { date: BusinessDate; total: number; byRole: Record<string, number> }[] | null;
  actionsPerDay: { date: BusinessDate; team: number; developer: number; total: number }[] | null;
  /** 24 hotel hours, 0–23. */
  busiestHours: { hour: number; count: number }[] | null;
  /** Who has used the system in the last 10 minutes (a name, a role, when). */
  online: { id: string; name: string; roleName: string; lastSeenAt: Date }[] | null;
  recentSignIns: { id: string; name: string; roleCode: string | null; roleName: string | null; device: { label: string; phone: boolean } | null; ip: string | null; at: Date }[] | null;
  notUsing: { id: string; name: string; roleName: string; lastUsedAt: Date | null }[] | null;
  notUsingTotal: number;
}

/** "Chrome · Mac" from a user-agent (browser first, then the device). */
const deviceOf = (ua: string | null): { label: string; phone: boolean } | null => {
  if (!ua) return null;
  const d = deviceLabel(ua);
  return { label: d.label.split(" · ").reverse().join(" · "), phone: d.phone };
};

export async function activityData(user: ConsoleUser, now = new Date()): Promise<ActivityData> {
  assertConsoleAccess(user);
  const settings = await getSettings();
  const cfg = businessDayConfig(settings);
  const today = businessDateOf(now, cfg);
  const days = eachDate(addDays(today, -(ACTIVITY_DAYS - 1)), addDays(today, 1));
  const { start: start14, end: end14 } = businessRangeBounds(days[0], today, cfg);
  const since24 = new Date(now.getTime() - DAY);
  const since7d = new Date(now.getTime() - 7 * DAY);
  const people = { actorType: { in: ["STAFF", "DEVELOPER"] }, action: { notIn: [...NOT_WORK_ACTIONS] } };

  const [roles, logins, sessions24, byDayRaw, hoursRaw, onlineRaw, recentRaw, usersRaw, failed24, team24, dev24] = await Promise.all([
    safe(() => db.role.findMany({ select: { code: true, name: true } })),
    safe(() => db.auditLog.findMany({
      where: { action: "auth.login", createdAt: { gte: start14, lt: end14 } },
      select: { userId: true, actorRole: true, businessDate: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5000,
    })),
    safe(() => db.session.findMany({ where: { createdAt: { gte: since24 } }, select: { userId: true }, take: 2000 })),
    safe(() => db.auditLog.groupBy({
      by: ["businessDate", "actorType"],
      where: { ...people, businessDate: { gte: toDbDate(days[0]), lte: toDbDate(today) }, createdAt: { gte: start14, lt: end14 } },
      _count: { _all: true },
    })),
    safe(() => db.$queryRaw<{ hour: number; n: number }[]>`
      SELECT EXTRACT(HOUR FROM (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${cfg.timezone}))::int AS hour, count(*)::int AS n
      FROM "audit_logs"
      WHERE "businessDate" >= ${days[0]}::date AND "businessDate" <= ${today}::date
        AND "createdAt" >= ${start14.toISOString()}::timestamp AND "createdAt" < ${end14.toISOString()}::timestamp
        AND "actorType" IN ('STAFF', 'DEVELOPER')
        AND "action" NOT IN (${Prisma.join([...NOT_WORK_ACTIONS])})
      GROUP BY 1`),
    safe(() => db.session.findMany({
      where: { lastSeenAt: { gte: new Date(now.getTime() - ONLINE_MINUTES * 60_000) }, expiresAt: { gt: now }, workAsUserId: null },
      select: { lastSeenAt: true, user: { select: { id: true, fullName: true, role: { select: { code: true, name: true } } } } }, orderBy: { lastSeenAt: "desc" }, take: 40,
    })),
    safe(() => db.auditLog.findMany({
      where: { action: "auth.login" }, orderBy: { createdAt: "desc" }, take: RECENT_SIGN_INS,
      select: { id: true, userId: true, actorLabel: true, actorRole: true, ipAddress: true, createdAt: true },
    })),
    safe(() => db.user.findMany({
      where: { isActive: true, role: { code: { notIn: [DEVELOPER_ROLE_CODE, SYSTEM_ROLE] } } },
      select: { id: true, fullName: true, lastLoginAt: true, createdAt: true, role: { select: { name: true } }, sessions: { orderBy: { lastSeenAt: "desc" }, take: 1, select: { lastSeenAt: true } } },
      orderBy: { fullName: "asc" }, take: 300,
    })),
    safe(() => db.auditLog.count({ where: { action: "auth.login_failed", createdAt: { gte: since24 } } })),
    safe(() => db.auditLog.count({ where: { ...people, actorType: "STAFF", createdAt: { gte: since24 } } })),
    safe(() => db.auditLog.count({ where: { ...people, actorType: "DEVELOPER", createdAt: { gte: since24 } } })),
  ]);

  // ── sign-ins ──
  const roleName = new Map((roles ?? []).map((r) => [r.code, r.name]));
  let signInsPerDay: ActivityData["signInsPerDay"] = null;
  let roleList: ActivityData["roles"] = [];
  if (logins) {
    const perDay = new Map<BusinessDate, Record<string, number>>(days.map((d) => [d, {}]));
    const totals: Record<string, number> = {};
    for (const l of logins) {
      const code = l.actorRole ?? "UNKNOWN";
      const bucket = perDay.get(fromDbDate(l.businessDate));
      if (!bucket) continue;
      bucket[code] = (bucket[code] ?? 0) + 1;
      totals[code] = (totals[code] ?? 0) + 1;
    }
    roleList = Object.keys(totals).sort((a, b) => totals[b] - totals[a] || a.localeCompare(b)).map((code) => ({ code, name: roleName.get(code) ?? code }));
    signInsPerDay = days.map((date) => {
      const byRole = perDay.get(date) ?? {};
      return { date, total: Object.values(byRole).reduce((n, v) => n + v, 0), byRole };
    });
  }
  const loginIds = (since: Date) => (logins ?? []).filter((l) => l.createdAt >= since).map((l) => l.userId);
  const distinct = (ids: (string | null)[]) => new Set(ids.filter((id): id is string => !!id)).size;
  const peopleSignedIn24h = logins && sessions24 ? distinct([...loginIds(since24), ...sessions24.map((s) => s.userId)]) : null;
  const peopleSignedIn7d = logins ? distinct(loginIds(since7d)) : null;
  const signIns24h = logins ? loginIds(since24).length : null;

  // ── actions per day ──
  let actionsPerDay: ActivityData["actionsPerDay"] = null;
  if (byDayRaw) {
    const perDay = new Map<BusinessDate, { team: number; developer: number }>(days.map((d) => [d, { team: 0, developer: 0 }]));
    for (const r of byDayRaw) {
      const bucket = perDay.get(fromDbDate(r.businessDate));
      if (!bucket) continue;
      if (r.actorType === "DEVELOPER") bucket.developer += r._count._all;
      else bucket.team += r._count._all;
    }
    actionsPerDay = days.map((date) => { const b = perDay.get(date)!; return { date, ...b, total: b.team + b.developer }; });
  }

  // ── busiest hours ──
  let busiestHours: ActivityData["busiestHours"] = null;
  let busiestHour: number | null = null;
  if (hoursRaw) {
    const counts = Array.from({ length: 24 }, () => 0);
    for (const r of hoursRaw) if (r.hour >= 0 && r.hour < 24) counts[r.hour] += Number(r.n);
    busiestHours = counts.map((count, hour) => ({ hour, count }));
    const peak = Math.max(...counts);
    busiestHour = peak > 0 ? counts.indexOf(peak) : null;
  }

  // ── online right now (each person once, newest first; the system's own account is not a person) ──
  let online: ActivityData["online"] = null;
  if (onlineRaw) {
    const seen = new Map<string, { id: string; name: string; roleName: string; lastSeenAt: Date }>();
    for (const s of onlineRaw) {
      if (s.user.role.code === SYSTEM_ROLE) continue;
      if (!seen.has(s.user.id)) seen.set(s.user.id, { id: s.user.id, name: s.user.fullName, roleName: s.user.role.name, lastSeenAt: s.lastSeenAt });
    }
    online = [...seen.values()];
  }

  // ── recent sign-ins (the audit entry is permanent; the device comes from the session while it still exists) ──
  let recentSignIns: ActivityData["recentSignIns"] = null;
  if (recentRaw) {
    const ids = [...new Set(recentRaw.map((r) => r.userId).filter((id): id is string => !!id))];
    const oldest = recentRaw.length ? new Date(Math.min(...recentRaw.map((r) => r.createdAt.getTime())) - 5 * 60_000) : now;
    const [users, sessions] = ids.length
      ? await Promise.all([
          safe(() => db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, role: { select: { code: true, name: true } } } })),
          safe(() => db.session.findMany({ where: { userId: { in: ids }, createdAt: { gte: oldest } }, select: { userId: true, userAgent: true, ipAddress: true, createdAt: true }, take: 300 })),
        ])
      : [[], []];
    const who = new Map((users ?? []).map((u) => [u.id, u]));
    recentSignIns = recentRaw.map((r) => {
      const u = r.userId ? who.get(r.userId) : undefined;
      // The session made at that sign-in: the same person, within a minute.
      const session = (sessions ?? [])
        .filter((s) => s.userId === r.userId && Math.abs(s.createdAt.getTime() - r.createdAt.getTime()) <= 60_000)
        .sort((a, b) => Math.abs(a.createdAt.getTime() - r.createdAt.getTime()) - Math.abs(b.createdAt.getTime() - r.createdAt.getTime()))[0];
      return {
        id: r.id, name: u?.fullName ?? short(r.actorLabel, 120) ?? "—", roleCode: u?.role.code ?? r.actorRole, roleName: u?.role.name ?? (r.actorRole ? roleName.get(r.actorRole) ?? r.actorRole : null),
        device: deviceOf(session?.userAgent ?? null), ip: short(r.ipAddress ?? session?.ipAddress, 64), at: r.createdAt,
      };
    });
  }

  // ── not using the system (never signed in, or not for 30 days; a shared screen counts as in use while its session is) ──
  let notUsing: ActivityData["notUsing"] = null;
  let notUsingTotal = 0;
  if (usersRaw) {
    const cutoff = new Date(now.getTime() - NOT_USING_DAYS * DAY);
    const idle = usersRaw
      .map((u) => {
        const seen = [u.lastLoginAt, u.sessions[0]?.lastSeenAt].filter((d): d is Date => !!d);
        return { id: u.id, name: u.fullName, roleName: u.role.name, lastUsedAt: seen.length ? new Date(Math.max(...seen.map((d) => d.getTime()))) : null };
      })
      .filter((u) => !u.lastUsedAt || u.lastUsedAt < cutoff)
      .sort((a, b) => (a.lastUsedAt?.getTime() ?? 0) - (b.lastUsedAt?.getTime() ?? 0));
    notUsingTotal = idle.length;
    notUsing = idle.slice(0, 12);
  }

  return {
    today, dayStart: formatMinutesLabel(cfg.businessDayStartMinutes), days,
    stats: { peopleSignedIn24h, peopleSignedIn7d, teamActions24h: team24, developerActions24h: dev24, signIns24h, failedSignIns24h: failed24, busiestHour },
    roles: roleList, signInsPerDay, actionsPerDay, busiestHours, online, recentSignIns, notUsing, notUsingTotal,
  };
}

