import "server-only";
import { db } from "../db";
import { businessDayConfig, getSettings } from "../settings";
import { Prisma } from "@/generated/prisma/client";
import { msg, msgf, type Localized } from "@/i18n/msg";
import { formatMinutesLabel } from "@/lib/format";
import { addDays, businessDateOf, businessDayBounds, businessRangeBounds, eachDate, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { deviceLabel } from "@/lib/device-label";
import { DEVELOPER_ROLE_CODE } from "@/lib/permissions";
import {
  assertConsoleAccess, CONSOLE_HREF, NOT_WORK_ACTIONS, recentDenied, safe, short, systemDiagnostics, type ConsoleUser, type DeniedEntry,
} from "./developer-console";
import { DEVELOPER_TRIES, DEVELOPER_WINDOW_SECONDS } from "./auth-login";
import { SYSTEM_ROLE } from "./staff-accounts";
import { consoleFrame } from "./developer-frame";
import { runChecks, type CheckResult } from "./developer-checks";
import { loadSystemEvents, type SystemEvents } from "./system-events";

/**
 * WHAT THE DEVELOPER CONSOLE MEASURES (owner, 2026-10-17): the health of the system, who is using it, how fast the database is and
 * who failed to sign in. Everything here is built from FACTS found in the database or in the server's set-up (a key is "set" or "not
 * set" — never what it is). Nothing is invented: a part that cannot be read is left out and the rest still shows.
 *
 * Every function checks, again, that the caller is the Developer account holding "developer.access" and not working as someone else
 * (assertConsoleAccess). Every query is bounded: a date window, a `take`, a count — never a scan of a whole table into memory.
 *
 * Days are the hotel's own days (04:00 → 04:00, from the settings); "hours of the day" are the hotel's wall-clock hours.
 */

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// ───────────────────────────────────────────── 1. the health score ─────────────────────────────────────────────
/**
 * THE SCORE RULE (kept this simple on purpose — the console explains it under "How is this worked out?"):
 *   start at 100
 *   the database does not answer          −60   (its own card is NOT counted again as a "fix now")
 *   each "fix now" item                   −10   (a system check that says "fix", or a set-up fact that is wrong)
 *   each "look at" item                    −5   (a system check that says "look")
 *   "for information" items                −0   (and a check that could not be run costs nothing either)
 *   never below 0
 * Only SYSTEM facts count (the data contradicts itself, a job or an integration fails, a key or a setting is wrong, the server threw an
 * error). The hotel's own work (a shift open for long, a guest who owes, an order waiting, low stock, a request unanswered) never does:
 * the Developer does not do operations.
 */
export const SCORE = { start: 100, databaseOffline: 60, fixNow: 10, lookAt: 5 } as const;
/** The id of the card that says the database does not answer (its cost is the −60, not an extra −10). */
export const DATABASE_ITEM_ID = "database";

export type Severity = "fix" | "look" | "info";
export type Verdict = "offline" | "fix" | "look" | "well";

export function healthScore(input: { databaseOnline: boolean; items: { id: string; severity: Severity }[] }): number {
  let score: number = SCORE.start;
  if (!input.databaseOnline) score -= SCORE.databaseOffline;
  for (const it of input.items) {
    if (it.id === DATABASE_ITEM_ID) continue;
    if (it.severity === "fix") score -= SCORE.fixNow;
    else if (it.severity === "look") score -= SCORE.lookAt;
  }
  return Math.max(0, score);
}

export function healthVerdict(databaseOnline: boolean, counts: { fix: number; look: number }): Verdict {
  return !databaseOnline ? "offline" : counts.fix > 0 ? "fix" : counts.look > 0 ? "look" : "well";
}

// ───────────────────────────────────────────── 2. the attention items ─────────────────────────────────────────────
export interface HealthItem {
  id: string;
  severity: Severity;
  title: Localized;
  /** One line, shown on the closed card. */
  summary: Localized;
  /** What it means, in plain words. */
  what: Localized;
  /** What to do about it. */
  todo: Localized;
  /** Who fixes it: the Developer, or the system owner for keys and billing (null on the few items that say it in their text). */
  who?: Localized | null;
  /** Codes and numbers that show where to look (room numbers, booking references, job names). Never a name. */
  examples?: string[];
  /** A page that helps — only when this Developer may open it (never a link that would be refused). */
  link: { href: string; label: Localized } | null;
}

/** An open reception or waiter shift older than this is shown as "long" on the Hotel tab (a plain number there; it is not a Developer problem). */
export const SHIFT_OPEN_LIMIT_HOURS = 14;
/** A "work as" session open longer than this is mentioned (the 4-hour cap ends it by itself). */
export const WORK_AS_LONG_MINUTES = 60;
/**
 * Wrong tries in 15 minutes before a sign-in is paused. The Developer account's own lock is read from where it is enforced
 * (services/auth-login.ts); the shared limits per email and per address are the numbers written in src/app/staff/(auth)/login/actions.ts.
 */
export const LOGIN_LIMITS = { developerEmail: DEVELOPER_TRIES, staffEmail: 8, staffPlace: 20, windowMinutes: DEVELOPER_WINDOW_SECONDS / 60 } as const;

export interface HealthReport {
  checkedAt: Date;
  database: { online: boolean; ms: number | null };
  /** Distinct people who signed in during the hotel's day today. null = could not be read. */
  signedInToday: number | null;
  /** Real work saved in the last 24 hours (sign-ins and the Developer's own looking are not work). null = could not be read. */
  actionsToday: number | null;
  /** How many DIFFERENT unexpected server errors were seen in the last 24 hours (the headline figure). null = could not be read. */
  serverErrors24h: number | null;
  failedSignIns24h: number | null;
  /** Every system check, just now (the Problems part shows them; the attention cards are the ones that say "fix" or "look"). Empty while the database is down. */
  checks: CheckResult[];
  /** Fix now first, then look at, then for information. */
  items: HealthItem[];
  counts: { fix: number; look: number; info: number };
  score: number;
  verdict: Verdict;
}

/** A check that needs attention, as an attention card. */
function itemOfCheck(c: CheckResult): HealthItem {
  return {
    id: c.id, severity: c.state === "fix" ? "fix" : "look",
    title: c.title, summary: c.summary, what: c.what, todo: c.todo, who: c.who, examples: c.examples,
    link: c.link ?? null,
  };
}

export async function healthReport(user: ConsoleUser, now = new Date()): Promise<HealthReport> {
  assertConsoleAccess(user);
  const settings = await getSettings();
  const cfg = businessDayConfig(settings);
  const today = businessDateOf(now, cfg);
  const dayBounds = businessDayBounds(today, cfg);
  const since24 = new Date(now.getTime() - DAY);

  const diag = await systemDiagnostics(user, now);
  const online = diag.database.reachable;

  // Everything else needs the database: when it does not answer, only that card is shown.
  const facts = online ? await Promise.all([
    safe(() => loadSystemEvents(user as Parameters<typeof loadSystemEvents>[0], now)),
    safe(() => db.auditLog.count({ where: { action: "auth.login_failed", createdAt: { gte: since24 } } })),
    safe(() => db.auditLog.count({ where: { action: "developer.denied", createdAt: { gte: since24 } } })),
    safe(() => db.session.findMany({ where: { workAsUserId: { not: null } }, select: { workAsStartedAt: true }, take: 50 })),
    safe(() => db.auditLog.count({ where: { action: "developer.work_as_started", createdAt: { gte: since24 } } })),
    safe(async () => {
      const [logins, sessions] = await Promise.all([
        db.auditLog.findMany({ where: { action: "auth.login", createdAt: { gte: dayBounds.start, lt: dayBounds.end } }, select: { userId: true }, take: 2000 }),
        db.session.findMany({ where: { createdAt: { gte: dayBounds.start, lt: dayBounds.end } }, select: { userId: true }, take: 2000 }),
      ]);
      return new Set([...logins.map((l) => l.userId), ...sessions.map((s) => s.userId)].filter((id): id is string => !!id)).size;
    }),
    safe(() => db.auditLog.count({
      where: {
        createdAt: { gte: since24 }, businessDate: { gte: toDbDate(addDays(today, -2)), lte: toDbDate(addDays(today, 1)) },
        actorType: { in: ["STAFF", "DEVELOPER"] }, action: { notIn: [...NOT_WORK_ACTIONS] },
      },
    })),
  ]) : null;
  const [events, failedSignIns, denied24, workAsOpen, workAsStarted24, signedInToday, actionsToday] = facts ?? [null, null, null, null, null, null, null];
  // The system checks (data that contradicts itself, jobs, integrations, set-up, errors) — read once here for the cards, the score and the Problems part.
  const checks: CheckResult[] = online ? (await safe(() => runChecks(user, now, { diag, events: events as SystemEvents | null }))) ?? [] : [];

  const items: HealthItem[] = [];
  const add = (it: HealthItem) => items.push(it);

  if (!online) {
    add({
      id: DATABASE_ITEM_ID, severity: "fix",
      title: msgf("The database is not answering", {}),
      summary: msgf("Nothing can be read or saved until it answers.", {}),
      what: msgf("All of the hotel's records live in the database. The console just asked it a trivial question and got no answer.", {}),
      todo: msgf("Look at the database provider's status page and the connection setting on Vercel. Staff cannot work until it is back.", {}),
      who: msgf("The Developer; the system owner for the database plan.", {}),
      link: null,
    });
  }

  // ── every system check that says "fix" or "look" is a card (an "ok" one never is) ──
  for (const c of checks) if (c.state === "fix" || c.state === "look") add(itemOfCheck(c));
  const carded = new Set(items.map((i) => i.id));
  // A check that could not be run is information, once, with a pointer to the Problems part for which one and why.
  const unknown = checks.filter((c) => c.state === "unknown").length;
  if (unknown > 0) {
    add({
      id: "checks-unknown", severity: "info",
      title: unknown === 1 ? msgf("{n} check could not be run", { n: unknown }) : msgf("{n} checks could not be run", { n: unknown }),
      summary: msgf("Not counted against the score.", {}),
      what: msgf("A check could not read what it needs (a part of the database or a service did not answer, the system has not been recording for long enough yet, or the file it compares with is not on this server). It is not a problem found; it is something not known.", {}),
      todo: msgf("Open the Problems part to see which checks and why. If it stays like that, find out what stops the check.", {}),
      who: null,
      link: { href: `${CONSOLE_HREF.home}#problems`, label: msgf("Open Problems", {}) },
    });
  }

  // ── for information ──
  if (online && !diag.ntzs.configured && !settings.onlinePayEnabled) {
    add({
      id: "ntzs-not-set", severity: "info",
      title: msgf("Online payment (nTZS) is not set up", {}),
      summary: msgf("It is switched off, so nothing is wrong.", {}),
      what: msgf("The server has no nTZS key and online payment is off in the settings, so customers pay at the hotel.", {}),
      todo: msgf("Nothing to do unless the hotel wants to take online payments.", {}),
      link: null,
    });
  }
  // (The two facts below are checks too, once they are above their limits; below it they stay plain information, never twice.)
  if (failedSignIns && !carded.has("failed-sign-ins")) {
    add({
      id: "failed-sign-ins", severity: "info",
      title: failedSignIns === 1 ? msgf("{n} failed sign-in in 24 hours", { n: failedSignIns }) : msgf("{n} failed sign-ins in 24 hours", { n: failedSignIns }),
      summary: msgf("Wrong-password tries. After {dev} wrong tries in 15 minutes a Developer sign-in is paused ({staff} for staff).", { dev: LOGIN_LIMITS.developerEmail, staff: LOGIN_LIMITS.staffEmail }),
      what: msgf("A few typing mistakes are normal. Many in a day can mean someone is guessing passwords. The table in the Errors & jobs part shows which accounts were tried and how often.", {}),
      todo: msgf("If one account is tried again and again, tell the Boss or the MD.", {}),
      link: null,
    });
  }
  if (denied24 && !carded.has("denied")) {
    add({
      id: "denied", severity: "info",
      title: denied24 === 1 ? msgf("{n} Developer action was refused in 24 hours", { n: denied24 }) : msgf("{n} Developer actions were refused in 24 hours", { n: denied24 }),
      summary: msgf("The Developer role does not hold the right they needed.", {}),
      what: msgf("A page or an action was refused to a Developer account. For money this is by design — the Developer never writes money. If it surprised you, the list shows which right was needed.", {}),
      todo: msgf("See the list in the Errors & jobs part. Nothing is broken.", {}),
      link: null,
    });
  }
  const longWorkAs = (workAsOpen ?? []).filter((s) => s.workAsStartedAt && now.getTime() - s.workAsStartedAt.getTime() > WORK_AS_LONG_MINUTES * 60_000);
  if (longWorkAs.length > 0) {
    const oldest = Math.max(...longWorkAs.map((s) => Math.floor((now.getTime() - s.workAsStartedAt!.getTime()) / 60_000)));
    add({
      id: "work-as-long", severity: "info",
      title: longWorkAs.length === 1 ? msgf("{n} work-as session has run over an hour", { n: longWorkAs.length }) : msgf("{n} work-as sessions have run over an hour", { n: longWorkAs.length }),
      summary: msgf("The longest began {minutes} minutes ago and ends by itself after 4 hours.", { minutes: oldest }),
      what: msgf("A Developer is still working as someone else's account. It ends by itself when the Developer session ends or 4 hours after it started.", {}),
      todo: msgf("If it was forgotten, press Stop on the bar at the top of the screen.", {}),
      link: null,
    });
  }
  if (workAsStarted24) {
    add({
      id: "work-as-used", severity: "info",
      title: workAsStarted24 === 1 ? msgf("Work as was used {n} time in 24 hours", { n: workAsStarted24 }) : msgf("Work as was used {n} times in 24 hours", { n: workAsStarted24 }),
      summary: msgf("The Boss is told on WhatsApp every time it starts.", {}),
      what: msgf("Each start is written to the audit trail under the Developer's own name, and the Boss and the other report recipients are told.", {}),
      todo: msgf("Nothing to do. Open Audit to see each one.", {}),
      link: null,
    });
  }

  const order: Record<Severity, number> = { fix: 0, look: 1, info: 2 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);
  const counts = { fix: items.filter((i) => i.severity === "fix").length, look: items.filter((i) => i.severity === "look").length, info: items.filter((i) => i.severity === "info").length };

  return {
    checkedAt: now,
    database: { online, ms: diag.database.ms },
    signedInToday, actionsToday,
    serverErrors24h: events ? (events as SystemEvents).errors24h : null,
    failedSignIns24h: failedSignIns,
    checks,
    items, counts,
    score: healthScore({ databaseOnline: online, items }),
    verdict: healthVerdict(online, counts),
  };
}

// ───────────────────────────────────────────── 3. activity ─────────────────────────────────────────────
export const ACTIVITY_DAYS = 14;
export const WORK_DAYS = 7;
export const NOT_USING_DAYS = 30;
export const RECENT_SIGN_INS = 12;

/** Plain names for the kinds of record the audit trail writes about (what the entry is about). Anything else is the record's own name, spaced out. */
const MODULE_WORDS: Record<string, string> = {
  Reservation: msg("Bookings and stays"), ReservationRoom: msg("Bookings and stays"), BookingGroup: msg("Group bookings"), BookingRequest: msg("Booking requests"),
  TableReservation: msg("Table bookings"), BookingQrCode: msg("Hotel QR"),
  RestaurantOrder: msg("Restaurant orders"), DiningSession: msg("Restaurant tables"), RestaurantLocation: msg("Restaurant tables"), MenuItem: msg("Menu"), MenuCategory: msg("Menu"), SpinSession: msg("Spin to Win"),
  Payment: msg("Payments"), MobilePayment: msg("Online payments"), Withdrawal: msg("Withdrawals"), CashHandover: msg("Cash handovers"), CashCount: msg("Cash handovers"),
  Expense: msg("Expenses"), ExpenseItem: msg("Expenses"), Invoice: msg("Invoices"), SupplierInvoice: msg("Supplier invoices"), RevenueTransaction: msg("Income"), LedgerEntry: msg("Ledger"), MoneyAccount: msg("Money accounts"),
  StockRequest: msg("Stock requests"), InventoryItem: msg("Stock items"), InventoryMovement: msg("Stock movements"), InventoryDepartment: msg("Stock items"), InventoryCategory: msg("Stock items"), Supplier: msg("Suppliers"), Asset: msg("Assets"),
  Room: msg("Rooms"), RoomType: msg("Rooms"), Guest: msg("Customers"), CorporateCustomer: msg("Companies"), ServiceRequest: msg("Guest requests"), ContactMessage: msg("Messages"),
  ActualShift: msg("Shifts"), ShiftSchedule: msg("Shifts"), ShiftHandoverNote: msg("Shifts"), DailyList: msg("Daily lists"),
  DailyReport: msg("Reports"), RoomReport: msg("Reports"), ShiftReport: msg("Reports"), StaffReport: msg("Reports"),
  TransportTrip: msg("Transport"), TransportService: msg("Transport"), Vehicle: msg("Transport"),
  User: msg("Staff accounts"), Role: msg("Roles and rights"), Permission: msg("Roles and rights"), HotelSettings: msg("Settings"), HotelService: msg("Hotel services"),
  Promotion: msg("Prices"), PriceRule: msg("Prices"), SiteContent: msg("Website"), MediaAsset: msg("Website"), Page: msg("Pages looked at"),
};
/** The kind of record in plain English ("Restaurant orders"); an unknown one is spaced out ("Some thing" → its own words). */
export const moduleWords = (entityType: string): string =>
  MODULE_WORDS[entityType] ?? (entityType.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim() || msg("Other"));

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
  /** The kinds of record the work was about in the last 7 days, most first (several kinds with the same plain name are added together). */
  where: { label: string; count: number }[] | null;
  mostActive: { userId: string; name: string; roleName: string | null; developer: boolean; count: number }[] | null;
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
  const start7 = businessRangeBounds(addDays(today, -(WORK_DAYS - 1)), today, cfg).start;
  const since24 = new Date(now.getTime() - DAY);
  const since7d = new Date(now.getTime() - 7 * DAY);
  const people = { actorType: { in: ["STAFF", "DEVELOPER"] }, action: { notIn: [...NOT_WORK_ACTIONS] } };

  const [roles, logins, sessions24, byDayRaw, hoursRaw, whereRaw, activeRaw, recentRaw, usersRaw, failed24, team24, dev24] = await Promise.all([
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
    safe(() => db.auditLog.groupBy({
      by: ["entityType"],
      where: { ...people, createdAt: { gte: start7 }, businessDate: { gte: toDbDate(addDays(today, -(WORK_DAYS - 1))), lte: toDbDate(today) } },
      _count: { id: true }, orderBy: { _count: { id: "desc" } }, take: 40,
    })),
    safe(() => db.auditLog.groupBy({
      by: ["userId"],
      where: { ...people, userId: { not: null }, createdAt: { gte: start7 }, businessDate: { gte: toDbDate(addDays(today, -(WORK_DAYS - 1))), lte: toDbDate(today) } },
      _count: { id: true }, orderBy: { _count: { id: "desc" } }, take: 8,
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

  // ── where the work happens ──
  let where: ActivityData["where"] = null;
  if (whereRaw) {
    const byLabel = new Map<string, number>();
    for (const r of whereRaw) { const label = moduleWords(r.entityType); byLabel.set(label, (byLabel.get(label) ?? 0) + r._count.id); }
    where = [...byLabel].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 8);
  }

  // ── most active people ──
  let mostActive: ActivityData["mostActive"] = null;
  if (activeRaw) {
    const ids = activeRaw.map((r) => r.userId).filter((id): id is string => !!id);
    const names = ids.length ? (await safe(() => db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, role: { select: { code: true, name: true } } } }))) ?? [] : [];
    const byId = new Map(names.map((u) => [u.id, u]));
    mostActive = activeRaw.flatMap((r) => {
      const u = r.userId ? byId.get(r.userId) : undefined;
      return u ? [{ userId: u.id, name: u.fullName, roleName: u.role.name, developer: u.role.code === DEVELOPER_ROLE_CODE, count: r._count.id }] : [];
    });
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
    roles: roleList, signInsPerDay, actionsPerDay, busiestHours, where, mostActive, recentSignIns, notUsing, notUsingTotal,
  };
}

// ───────────────────────────────────────────── 4. speed and size ─────────────────────────────────────────────
export const SPEED_SAMPLES = 3;
/** The biggest tables, counted (counts only — no row is read). */
const BIG_TABLES = [
  { table: "audit_logs", label: msg("Audit trail entries") },
  { table: "sessions", label: msg("Sign-in sessions") },
  { table: "reservations", label: msg("Bookings") },
  { table: "payments", label: msg("Payments") },
  { table: "notification_deliveries", label: msg("Messages sent") },
] as const;

export interface SpeedData {
  /** New records per hotel day for the last 14 days, so growth can be seen (counted on the day each record was made). null = could not be read. */
  growth: { dayStart: string; days: { date: BusinessDate; reservations: number; payments: number; orders: number; audit: number }[] } | null;
  latency: { samples: number[]; average: number | null; slowest: number | null };
  tables: { label: string; rows: number | null; bytes: number | null }[];
  databaseBytes: number | null;
  deployment: { commit: string | null; environment: string | null };
}

export async function speedData(user: ConsoleUser, now = new Date()): Promise<SpeedData> {
  assertConsoleAccess(user);
  const samples: number[] = [];
  for (let i = 0; i < SPEED_SAMPLES; i++) {
    const started = performance.now();
    const ok = (await safe(() => db.$queryRaw`SELECT 1`)) !== null;
    if (ok) samples.push(Math.max(1, Math.round(performance.now() - started)));
  }
  const [counts, sizes, dbSize, diag, growth] = await Promise.all([
    Promise.all([
      safe(() => db.auditLog.count()), safe(() => db.session.count()), safe(() => db.reservation.count()), safe(() => db.payment.count()), safe(() => db.notificationDelivery.count()),
    ]),
    safe(() => db.$queryRaw<{ name: string; bytes: bigint }[]>`
      SELECT c.relname AS name, pg_total_relation_size(c.oid)::bigint AS bytes
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN (${Prisma.join(BIG_TABLES.map((t) => t.table))})`),
    safe(() => db.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database())::bigint AS bytes`),
    systemDiagnostics(user, now),
    // Each record is counted on the hotel day it was made (the day column every one of these tables keeps), never on a UTC day.
    safe(async (): Promise<NonNullable<SpeedData["growth"]>> => {
      const frame = await consoleFrame(now);
      const range = { gte: toDbDate(frame.days[0]), lte: toDbDate(frame.today) };
      const [reservations, payments, orders, audit] = await Promise.all([
        db.reservation.groupBy({ by: ["businessDate"], where: { businessDate: range }, _count: true }),
        db.payment.groupBy({ by: ["businessDate"], where: { businessDate: range }, _count: true }),
        db.restaurantOrder.groupBy({ by: ["businessDate"], where: { businessDate: range }, _count: true }),
        db.auditLog.groupBy({ by: ["businessDate"], where: { businessDate: range }, _count: true }),
      ]);
      const n = (rows: { businessDate: Date; _count: number }[], date: BusinessDate) => rows.find((r) => fromDbDate(r.businessDate) === date)?._count ?? 0;
      return { dayStart: frame.dayStart, days: frame.days.map((date) => ({ date, reservations: n(reservations, date), payments: n(payments, date), orders: n(orders, date), audit: n(audit, date) })) };
    }),
  ]);
  const sizeOf = new Map((sizes ?? []).map((s) => [s.name, Number(s.bytes)]));
  return {
    growth,
    latency: { samples, average: samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : null, slowest: samples.length ? Math.max(...samples) : null },
    tables: BIG_TABLES.map((t, i) => ({ label: t.label, rows: counts[i], bytes: sizeOf.get(t.table) ?? null })),
    databaseBytes: dbSize?.[0] ? Number(dbSize[0].bytes) : null,
    deployment: diag.deployment,
  };
}

// ───────────────────────────────────────────── 5. crashes and sign-ins ─────────────────────────────────────────────
export interface CrashData {
  /** What the system recorded about itself: unexpected server errors (grouped), the automatic jobs and the webhooks. null = could not be read. */
  system: SystemEvents | null;
  failed: {
    last24h: number;
    last7d: number;
    /** The last 7 hotel days, oldest first. */
    byDay: { date: BusinessDate; count: number }[];
    /** The accounts most often tried, with how many failed tries (7 days). */
    byAccount: { name: string; count: number }[];
  } | null;
  /** Sign-in places or emails paused right now (their wrong tries went over the limit in the last 15 minutes): the Developer account's own lock, and the shared ones. Counts only — never the email or the address. */
  paused: { developer: number; staff: number } | null;
  denied: DeniedEntry[];
}

/**
 * Which limit a rate-limit key is counted against (null: not a sign-in key). The Developer account's own lock is "login:email:dev:…";
 * every sign-in is also counted per email ("login:email:…") and per address ("login:ip:…").
 */
export function loginLimitOf(key: string): { developer: boolean; limit: number } | null {
  if (key.startsWith("login:email:dev:")) return { developer: true, limit: LOGIN_LIMITS.developerEmail };
  if (key.startsWith("login:email:")) return { developer: false, limit: LOGIN_LIMITS.staffEmail };
  if (key.startsWith("login:ip:")) return { developer: false, limit: LOGIN_LIMITS.staffPlace };
  return null;
}

export async function crashData(user: ConsoleUser, now = new Date()): Promise<CrashData> {
  assertConsoleAccess(user);
  const cfg = businessDayConfig(await getSettings());
  const today = businessDateOf(now, cfg);
  const days = eachDate(addDays(today, -6), addDays(today, 1));
  const since24 = new Date(now.getTime() - DAY);
  const { start, end } = businessRangeBounds(days[0], today, cfg);

  const [system, failedRows, buckets, denied] = await Promise.all([
    safe(() => loadSystemEvents(user as Parameters<typeof loadSystemEvents>[0], now)),
    safe(() => db.auditLog.findMany({
      where: { action: "auth.login_failed", createdAt: { gte: start, lt: end } },
      select: { businessDate: true, entityId: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5000,
    })),
    safe(() => db.rateLimitBucket.findMany({
      where: { key: { startsWith: "login:" }, windowStart: { gte: new Date(now.getTime() - LOGIN_LIMITS.windowMinutes * 60_000) } },
      select: { key: true, count: true }, take: 500,
    })),
    recentDenied(user, 20),
  ]);

  let failed: CrashData["failed"] = null;
  if (failedRows) {
    const perDay = new Map<BusinessDate, number>(days.map((d) => [d, 0]));
    const perAccount = new Map<string, number>();
    for (const r of failedRows) {
      const d = fromDbDate(r.businessDate);
      if (perDay.has(d)) perDay.set(d, (perDay.get(d) ?? 0) + 1);
      if (r.entityId) perAccount.set(r.entityId, (perAccount.get(r.entityId) ?? 0) + 1);
    }
    const top = [...perAccount].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const users = top.length ? (await safe(() => db.user.findMany({ where: { id: { in: top.map(([id]) => id) } }, select: { id: true, fullName: true } }))) ?? [] : [];
    const name = new Map(users.map((u) => [u.id, u.fullName]));
    failed = {
      last24h: failedRows.filter((r) => r.createdAt >= since24).length,
      last7d: failedRows.length,
      byDay: days.map((date) => ({ date, count: perDay.get(date) ?? 0 })),
      byAccount: top.flatMap(([id, count]) => (name.has(id) ? [{ name: name.get(id)!, count }] : [])),
    };
  }

  let paused: CrashData["paused"] = null;
  if (buckets) {
    let developer = 0, staff = 0;
    for (const b of buckets) {
      const l = loginLimitOf(b.key);
      if (!l || b.count <= l.limit) continue;
      if (l.developer) developer++; else staff++;
    }
    paused = { developer, staff };
  }

  return { system, failed, paused, denied };
}
