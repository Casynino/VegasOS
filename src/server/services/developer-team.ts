import "server-only";
import { db } from "../db";
import { businessDayConfig, getSettings } from "../settings";
import { addDays, businessDateOf, businessRangeBounds, toDbDate } from "@/lib/time/business-date";
import { DEVELOPER_ROLE_CODE } from "@/lib/permissions";
import { assertConsoleAccess, NOT_WORK_ACTIONS, safe, type ConsoleUser } from "./developer-console";
import { SYSTEM_ROLE } from "./staff-accounts";

/**
 * THE TEAM (owner, 2026-10-18; the "People & my actions" part of the Developer Home): everyone with a staff account, how many things they
 * did in the last 7 hotel days, and when they last signed in. Read-only, for awareness. Only COUNTS of actions and a time: never what the
 * work was about, never a guest, an amount or a payment. The Developer's own account and the system account are not part of the team.
 */
export const TEAM_DAYS = 7;
/** The most people the table lists (a hotel has far fewer; this only guards the page). */
export const TEAM_LIMIT = 80;
/** The most accounts read before they are sorted and cut to TEAM_LIMIT. */
const TEAM_READ = 300;

export interface TeamMember {
  id: string;
  name: string;
  /** The role's English name (the page shows it through t()). */
  roleName: string;
  /** Actions that count as work, made in the last 7 hotel days (sign-ins, looking and refused tries are not counted). */
  actions7d: number;
  /** The later of the last sign-in and the last time any of the person's sessions was seen; null = never. */
  lastSignInAt: Date | null;
}

export interface TeamData { members: TeamMember[]; days: number }

/**
 * The team table. null when it could not be read (the part then says so instead of showing zeros that would be wrong).
 * Two queries, whatever the size of the team: the accounts (with their newest session), then ONE grouped count of their actions.
 */
export async function teamData(user: ConsoleUser, now = new Date()): Promise<TeamData | null> {
  assertConsoleAccess(user);
  const settings = await safe(() => getSettings());
  if (!settings) return null;
  const cfg = businessDayConfig(settings);
  const today = businessDateOf(now, cfg);
  const first = addDays(today, -(TEAM_DAYS - 1));
  const { start } = businessRangeBounds(first, today, cfg);

  // Everyone except the Developer and the system account; switched-off accounts are listed too (the table lists, it does not judge).
  const usersRaw = await safe(() => db.user.findMany({
    where: { role: { code: { notIn: [DEVELOPER_ROLE_CODE, SYSTEM_ROLE] } } },
    select: { id: true, fullName: true, lastLoginAt: true, role: { select: { name: true } }, sessions: { orderBy: { lastSeenAt: "desc" }, take: 1, select: { lastSeenAt: true } } },
    orderBy: { fullName: "asc" }, take: TEAM_READ,
  }));
  if (!usersRaw) return null;

  const people = usersRaw
    .map((u) => ({ u, roleName: u.role.name }))
    .sort((a, b) => a.roleName.localeCompare(b.roleName) || a.u.fullName.localeCompare(b.u.fullName) || a.u.id.localeCompare(b.u.id))
    .slice(0, TEAM_LIMIT);
  const ids = people.map((p) => p.u.id);

  // The same filter as "most active people" on the Activity part: staff work only, in the last 7 hotel days.
  const counts = ids.length
    ? await safe(() => db.auditLog.groupBy({
        by: ["userId"],
        where: {
          actorType: "STAFF", action: { notIn: [...NOT_WORK_ACTIONS] }, userId: { in: ids },
          createdAt: { gte: start }, businessDate: { gte: toDbDate(first), lte: toDbDate(today) },
        },
        _count: { _all: true },
      }))
    : [];
  if (!counts) return null;
  const done = new Map(counts.flatMap((c) => (c.userId ? [[c.userId, c._count._all] as const] : [])));

  return {
    days: TEAM_DAYS,
    members: people.map(({ u, roleName }) => {
      const seen = [u.lastLoginAt, u.sessions[0]?.lastSeenAt].filter((d): d is Date => !!d);
      return {
        id: u.id, name: u.fullName, roleName, actions7d: done.get(u.id) ?? 0,
        lastSignInAt: seen.length ? new Date(Math.max(...seen.map((d) => d.getTime()))) : null,
      };
    }),
  };
}
