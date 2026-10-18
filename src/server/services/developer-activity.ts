import "server-only";
import { db } from "../db";
import { businessDayConfig, getSettings } from "../settings";
import { Prisma } from "@/generated/prisma/client";
import { msg } from "@/i18n/msg";
import { formatMinutesLabel } from "@/lib/format";
import { addDays, businessDateOf, businessRangeBounds, eachDate, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { deviceLabel } from "@/lib/device-label";
import { assertConsoleAccess, NOT_WORK_ACTIONS, safe, short, type ConsoleUser } from "./developer-console";
import { SYSTEM_ROLE } from "./staff-accounts";

/**
 * WHO IS USING THE SYSTEM (owner, 2026-10-18): sign-ins per day, how much the team saves per day and at which hours, the latest sign-ins with
 * their device and place, who is online right now — and WHO IS DOING WHAT (owner, 2026-10-18: "I want to know what the system is doing, who is
 * doing what"): the kinds of record the team's actions were about (counts of actions only) and the team's latest actions in plain words. Never
 * an amount, a guest's name or a payment: the Developer sees WHO does WHAT in the system, not the hotel's figures (those stay out: the owner said
 * so three times). Each figure is kept ONCE on the page (owner, 2026-10-18: "do not be repetitive"): the numbers of people, sign-ins and actions
 * of the last 24 hours are in the health card, the people and their last sign-in in the team table, so they are not read again here.
 */
export const ACTIVITY_DAYS = 14;
export const RECENT_SIGN_INS = 5;
/** "Online right now" = used the system in the last this-many minutes. */
export const ONLINE_MINUTES = 10;

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

export const WORK_DAYS = 7;
/** How many kinds of record "Where the work happens" lists (the six biggest: a short list reads at once and sits level with the hours chart beside it). */
export const WHERE_SHOWN = 6;
/** How many of the team's latest actions "who did what, just now" lists. */
export const LATEST_ACTIONS = 30;

export interface ActivityData {
  today: BusinessDate;
  /** When a hotel day starts, as "04:00" (a day runs from then to the same time next morning). */
  dayStart: string;
  /** The last 14 hotel days, oldest first, ending today. */
  days: BusinessDate[];
  /** The busiest hour of the day (0–23) over the last 14 days, null when nothing was done. */
  busiestHour: number | null;
  /** The roles that signed in during the 14 days (the chart's series), most sign-ins first. */
  roles: { code: string; name: string }[];
  signInsPerDay: { date: BusinessDate; total: number; byRole: Record<string, number> }[] | null;
  actionsPerDay: { date: BusinessDate; team: number; developer: number; total: number }[] | null;
  /** 24 hotel hours, 0–23. */
  busiestHours: { hour: number; count: number }[] | null;
  /** The kinds of record the work was about in the last 7 days, most first (several kinds with the same plain name are added together). Counts of actions only. */
  where: { label: string; count: number }[] | null;
  /** The team's latest actions, newest first: who, in what role, what they did (as the audit trail words it) and when. Never an amount or a guest's name. */
  latest: { id: string; name: string; roleName: string | null; action: string; at: Date }[] | null;
  /** Who has used the system in the last 10 minutes (a name, a role, when). */
  online: { id: string; name: string; roleName: string; lastSeenAt: Date }[] | null;
  recentSignIns: { id: string; name: string; roleCode: string | null; roleName: string | null; device: { label: string; phone: boolean } | null; ip: string | null; at: Date }[] | null;
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
  const people = { actorType: { in: ["STAFF", "DEVELOPER"] }, action: { notIn: [...NOT_WORK_ACTIONS] } };

  const [roles, logins, byDayRaw, hoursRaw, whereRaw, latestRaw, onlineRaw, recentRaw] = await Promise.all([
    safe(() => db.role.findMany({ select: { code: true, name: true } })),
    safe(() => db.auditLog.findMany({
      where: { action: "auth.login", createdAt: { gte: start14, lt: end14 } },
      select: { actorRole: true, businessDate: true }, orderBy: { createdAt: "desc" }, take: 5000,
    })),
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
    safe(() => db.auditLog.findMany({
      where: { ...people, actorType: "STAFF" }, orderBy: { createdAt: "desc" }, take: LATEST_ACTIONS,
      select: { id: true, userId: true, actorLabel: true, actorRole: true, action: true, createdAt: true },
    })),
    safe(() => db.session.findMany({
      where: { lastSeenAt: { gte: new Date(now.getTime() - ONLINE_MINUTES * 60_000) }, expiresAt: { gt: now }, workAsUserId: null },
      select: { lastSeenAt: true, user: { select: { id: true, fullName: true, role: { select: { code: true, name: true } } } } }, orderBy: { lastSeenAt: "desc" }, take: 40,
    })),
    safe(() => db.auditLog.findMany({
      where: { action: "auth.login" }, orderBy: { createdAt: "desc" }, take: RECENT_SIGN_INS,
      select: { id: true, userId: true, actorLabel: true, actorRole: true, ipAddress: true, createdAt: true },
    })),
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
    where = [...byLabel].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, WHERE_SHOWN);
  }

  // ── who did what, just now (the team's latest actions) ──
  let latest: ActivityData["latest"] = null;
  if (latestRaw) {
    const ids = [...new Set(latestRaw.map((r) => r.userId).filter((id): id is string => !!id))];
    const people2 = ids.length ? (await safe(() => db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, role: { select: { name: true } } } }))) ?? [] : [];
    const who = new Map(people2.map((u) => [u.id, u]));
    latest = latestRaw.map((r) => {
      const u = r.userId ? who.get(r.userId) : undefined;
      return { id: r.id, name: u?.fullName ?? short(r.actorLabel, 120) ?? "—", roleName: u?.role.name ?? (r.actorRole ? roleName.get(r.actorRole) ?? r.actorRole : null), action: r.action, at: r.createdAt };
    });
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

  return {
    today, dayStart: formatMinutesLabel(cfg.businessDayStartMinutes), days,
    busiestHour,
    roles: roleList, signInsPerDay, actionsPerDay, busiestHours, where, latest, online, recentSignIns,
  };
}

