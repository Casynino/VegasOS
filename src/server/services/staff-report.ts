import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "../db";
import { audit } from "../audit";
import { isUniqueViolation } from "../errors";
import { businessDayConfig, getSettings } from "../settings";
import { addDays, businessDateOf, businessRangeBounds, diffDays, eachDate, fromDbDate, localParts, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { formatBusinessDate } from "@/lib/format";
import { worksWaiterShift } from "@/lib/permissions";
import { Prisma } from "@/generated/prisma/client";
import { factLine, personFacts, shiftDuration, type ShiftFact, type ShiftReportData } from "./shift-report";
import { deliverToRecipients, MAX_ATTEMPTS } from "./report-delivery";
import { dailyByKind, dailyMoney, guestMovement, occupancy, outstanding, profitLoss, restaurantSummary, type Range } from "./reporting";

/**
 * WEEKLY AND MONTHLY STAFF REPORTS — one person's work over a week (Monday → Sunday hotel days) or a calendar month,
 * counted from their own records exactly as a shift report is (the same `personFacts`), with their shifts, hours, a day
 * by day series and how it compares with the period before. Plus the TEAM digest: everyone side by side, which the boss
 * gets by WhatsApp with a private link, opened by the business itself for the period (income by department, money in,
 * expenses, rooms, the restaurant) — the same figures as Finance and the daily report. Made automatically once the period
 * has ended, once (`key`), and frozen. Facts only — never a score or a ranking.
 */

export type PeriodKind = "WEEK" | "MONTH";
const SHARE_DAYS = 45;
const newToken = () => randomBytes(24).toString("base64url");
const json = (v: unknown) => v as Prisma.InputJsonValue;

export type PeriodFact = ShiftFact & { prev?: number };
export interface PersonPeriodData {
  v: 1; kind: PeriodKind; from: BusinessDate; to: BusinessDate; label: string; live?: boolean;
  person: { id: string; name: string; role: string };
  department: "RECEPTION" | "RESTAURANT";
  totals: { shifts: number; minutes: number; days: number };
  headline: PeriodFact[];
  groups: ShiftReportData["groups"];
  money: ShiftReportData["money"];
  records: ShiftReportData["records"];
  days: { date: BusinessDate; minutes: number; a: number; b: number; money: number }[];
  /** What `a` and `b` count in the day series (guests checked in / out, or orders handled / served). */
  series: { a: string; b: string };
  shifts: { id: string; businessDate: BusinessDate; startedAt: string; endedAt: string | null; minutes: number; reportId: string | null; headline: ShiftFact[] }[];
}
/** The business over the period (and the same figures for the period before) — from the reporting services. */
export interface BusinessPeriod {
  revenue: { total: number; prev: number; rooms: number; restaurant: number; bar: number; roomService: number; meeting: number; transport: number; other: number; discounts: number; refunds: number };
  received: number; prevReceived: number; expenses: number; prevExpenses: number; result: number; prevResult: number; outstanding: number;
  rooms: { occupancy: number; prevOccupancy: number; roomNights: number; sellable: number; adr: number };
  guests: { checkIns: number; checkOuts: number; newBookings: number; cancellations: number; noShows: number };
  restaurant: { orders: number; prevOrders: number; sales: number; averageOrder: number; best: { name: string; drink: boolean; quantity: number; amount: number }[] };
  expensesByCategory: { name: string; amount: number }[];
  days: { date: BusinessDate; rooms: number; food: number; other: number; total: number; occupancy: number; received: number; expenses: number }[];
}
export interface TeamPeriodData {
  v: 1; kind: PeriodKind; from: BusinessDate; to: BusinessDate; label: string;
  /** The business itself (reports made before Oct 2026 have none). */
  business?: BusinessPeriod;
  people: { userId: string; name: string; role: string; department: "RECEPTION" | "RESTAURANT"; reportId: string; token: string; shifts: number; minutes: number; headline: ShiftFact[] }[];
}

// ───────────────────────── Periods ─────────────────────────

const monthEnd = (from: BusinessDate) => { const [y, m] = from.split("-").map(Number); return addDays(`${m === 12 ? y + 1 : y}-${String(m === 12 ? 1 : m + 1).padStart(2, "0")}-01` as BusinessDate, -1); };
/** The week (Monday → Sunday) or month a hotel day falls in. */
export function periodOf(kind: PeriodKind, day: BusinessDate) {
  if (kind === "MONTH") { const from = `${day.slice(0, 7)}-01` as BusinessDate; return { from, to: monthEnd(from) }; }
  const dow = new Date(`${day}T00:00:00Z`).getUTCDay() || 7;
  const from = addDays(day, 1 - dow);
  return { from, to: addDays(from, 6) };
}
/** The last week / month that has fully ended by `today`. */
export function lastCompleted(kind: PeriodKind, today: BusinessDate) {
  const cur = periodOf(kind, today);
  return periodOf(kind, addDays(cur.from, -1));
}
/**
 * What a period is compared with: the week or month before — for a period "so far", the same part of it (Monday to
 * the same weekday; the 1st to the same day of the month).
 */
export function previousPeriod(kind: PeriodKind, from: BusinessDate, to: BusinessDate): { from: BusinessDate; to: BusinessDate } {
  if (kind === "WEEK") return { from: addDays(from, -7), to: addDays(to, -7) };
  const pFrom = periodOf("MONTH", addDays(from, -1)).from;
  const pEnd = periodOf("MONTH", pFrom).to;
  if (to >= periodOf("MONTH", from).to) return { from: pFrom, to: pEnd }; // a whole month: the whole month before
  const pTo = addDays(pFrom, diffDays(from, to));
  return { from: pFrom, to: pTo > pEnd ? pEnd : pTo };
}
export function periodLabel(kind: PeriodKind, from: BusinessDate, to: BusinessDate) {
  if (kind === "MONTH") return new Date(`${from}T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  return `${formatBusinessDate(from)} – ${formatBusinessDate(to)}`;
}

// ───────────────────────── One person's period ─────────────────────────

/** One person's week or month, from their records (`to` may be today: "so far"). */
export async function buildPersonPeriod(userId: string, kind: PeriodKind, from: BusinessDate, to: BusinessDate, opts: { live?: boolean } = {}): Promise<PersonPeriodData> {
  const settings = await getSettings();
  const cfg = businessDayConfig(settings);
  const now = new Date();
  const { start, end: fullEnd } = businessRangeBounds(from, to, cfg);
  const end = fullEnd > now ? now : fullEnd;
  const user = await db.user.findUniqueOrThrow({ where: { id: userId }, select: { id: true, fullName: true, role: { select: { name: true, permissions: { select: { permission: { select: { code: true } } } } } } } });
  const shifts = await db.actualShift.findMany({
    where: { userId, startedAt: { gte: start, lt: end } }, orderBy: { startedAt: "asc" },
    select: { id: true, department: true, businessDate: true, startedAt: true, endedAt: true, report: { select: { id: true, data: true } } },
  });
  const codes = new Set(user.role.permissions.map((p) => p.permission.code));
  const restaurantShifts = shifts.filter((x) => x.department === "RESTAURANT").length;
  const department: "RECEPTION" | "RESTAURANT" = shifts.length ? (restaurantShifts * 2 > shifts.length ? "RESTAURANT" : "RECEPTION") : worksWaiterShift(codes) ? "RESTAURANT" : "RECEPTION";
  const subject = (a: Date, b: Date) => ({ id: null, userId, startedAt: a, endedAt: b, businessDate: toDbDate(from), closingNote: null, closedById: null, closeReason: null, closedBy: null });

  // The period before, for comparison: the week / month before (so far: the same part of it, up to the same moment).
  const p = previousPeriod(kind, from, to);
  const pb = businessRangeBounds(p.from, p.to, cfg);
  const prevEnd = new Date(Math.min(pb.end.getTime(), pb.start.getTime() + (end.getTime() - start.getTime())));
  const [facts, prev] = await Promise.all([
    personFacts(subject(start, end), department, { period: true }),
    personFacts(subject(pb.start, prevEnd), department, { period: true }).catch(() => null),
  ]);
  const prevBy = new Map((prev?.headline ?? []).map((f) => [f.label, f.value]));

  // Day by day: hours on shift, the two main counts, money they recorded.
  const days = eachDate(from, addDays(to, 1)).filter((d) => !opts.live || d <= businessDateOf(now, cfg));
  const of = (d: Date) => businessDateOf(d, cfg);
  const minutesOf = (x: { startedAt: Date; endedAt: Date | null }) => Math.max(0, Math.round(((x.endedAt ?? now).getTime() - x.startedAt.getTime()) / 60000));
  const [logs, pays, orderPays, sales, served, handledSteps] = await Promise.all([
    department === "RECEPTION"
      ? db.auditLog.groupBy({ by: ["businessDate", "action"], where: { userId, createdAt: { gte: start, lt: end }, action: { in: ["reservation.checked_in", "reservation.walk_in", "meeting.started", "reservation.checked_out", "meeting.completed"] } }, _count: true })
      : Promise.resolve([]),
    db.payment.findMany({ where: { recordedById: userId, status: "POSTED", kind: "PAYMENT", createdAt: { gte: start, lt: end } }, select: { amount: true, createdAt: true } }),
    db.restaurantOrderPayment.findMany({ where: { collectedById: userId, status: "POSTED", collectedAt: { gte: start, lt: end } }, select: { amount: true, collectedAt: true } }),
    db.revenueTransaction.findMany({ where: { recordedById: userId, orderPaymentId: null, isVoided: false, createdAt: { gte: start, lt: end } }, select: { amount: true, createdAt: true } }),
    department === "RESTAURANT" ? db.restaurantOrder.findMany({ where: { deliveredById: userId, deliveredAt: { gte: start, lt: end } }, select: { deliveredAt: true } }) : Promise.resolve([]),
    department === "RESTAURANT" ? db.restaurantOrderEvent.findMany({ where: { byId: userId, at: { gte: start, lt: end } }, select: { orderId: true, at: true } }) : Promise.resolve([]),
  ]);
  const count = (d: string, actions: string[]) => logs.filter((l) => fromDbDate(l.businessDate) === d && actions.includes(l.action)).reduce((t, l) => t + l._count, 0);
  const series = department === "RECEPTION" ? { a: "Guests checked in", b: "Guests checked out" } : { a: "Orders handled", b: "Orders served" };
  const dayRows = days.map((d) => ({
    date: d,
    minutes: shifts.filter((x) => fromDbDate(x.businessDate) === d).reduce((t, x) => t + minutesOf(x), 0),
    a: department === "RECEPTION" ? count(d, ["reservation.checked_in", "reservation.walk_in", "meeting.started"]) : new Set(handledSteps.filter((e) => of(e.at) === d).map((e) => e.orderId)).size,
    b: department === "RECEPTION" ? count(d, ["reservation.checked_out", "meeting.completed"]) : served.filter((o) => o.deliveredAt && of(o.deliveredAt) === d).length,
    money: pays.filter((p) => of(p.createdAt) === d).reduce((t, p) => t + p.amount, 0) + orderPays.filter((p) => of(p.collectedAt) === d).reduce((t, p) => t + p.amount, 0) + sales.filter((p) => of(p.createdAt) === d).reduce((t, p) => t + p.amount, 0),
  }));
  const totalMinutes = shifts.reduce((t, x) => t + minutesOf(x), 0);

  return {
    v: 1, kind, from, to, label: periodLabel(kind, from, to), live: opts.live || undefined,
    person: { id: user.id, name: user.fullName, role: user.role.name }, department,
    totals: { shifts: shifts.length, minutes: totalMinutes, days: dayRows.filter((d) => d.minutes > 0).length },
    headline: [
      { label: "Shifts", value: shifts.length, prev: undefined },
      { label: "Hours on shift", value: Math.round(totalMinutes / 6) / 10 },
      ...facts.headline.map((f) => ({ ...f, prev: prevBy.get(f.label) ?? 0 })),
    ],
    groups: facts.groups, money: facts.money, records: facts.records,
    days: dayRows, series,
    shifts: shifts.map((x) => {
      const rep = x.report?.data as unknown as ShiftReportData | undefined;
      return {
        id: x.id, businessDate: fromDbDate(x.businessDate), startedAt: x.startedAt.toISOString(), endedAt: x.endedAt?.toISOString() ?? null, minutes: minutesOf(x),
        reportId: x.report?.id ?? null, headline: rep?.headline?.slice(0, 3) ?? [],
      };
    }),
  };
}

export function renderPersonPeriodText(d: PersonPeriodData, hotelName: string, link?: string | null) {
  const what = d.kind === "WEEK" ? "Weekly staff report" : "Monthly staff report";
  const lines = [
    `*${hotelName.toUpperCase()}*`, `*${what}*`, "", `*${d.person.name}* — ${d.person.role}`, d.label, "",
    `${d.totals.shifts} shift${d.totals.shifts === 1 ? "" : "s"} · ${shiftDuration(d.totals.minutes)} on shift`,
    ...d.headline.slice(2, 9).map((f) => `• ${factLine(f)}`),
  ];
  const tail = link ? `\n\n*Full report:* ${link}` : "";
  return lines.join("\n").slice(0, 3500 - tail.length) + tail;
}

// ───────────────────────── Making, keeping and sending ─────────────────────────

async function staffReportLink(token: string) {
  try {
    const { siteOrigin } = await import("../site-origin");
    return `${await siteOrigin()}/staff-report/${token}`;
  } catch {
    const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
    return base ? `${base}/staff-report/${token}` : null;
  }
}

/** One person's report for a period that has ended — made once (the key), then the same report is returned. */
export async function generatePersonPeriodReport(userId: string, kind: PeriodKind, from: BusinessDate, to: BusinessDate) {
  const key = `${kind}:${from}:${userId}`;
  const existing = await db.staffReport.findUnique({ where: { key } });
  if (existing) return existing;
  const settings = await getSettings();
  const data = await buildPersonPeriod(userId, kind, from, to);
  const token = newToken();
  try {
    const r = await db.staffReport.create({
      data: {
        key, kind, fromDate: toDbDate(from), toDate: toDbDate(to), userId, department: data.department, data: json(data),
        summaryText: renderPersonPeriodText(data, settings.hotelName, await staffReportLink(token)), shareToken: token, shareExpiresAt: new Date(Date.now() + SHARE_DAYS * 86_400_000),
      },
    });
    await audit(db, { label: "system" }, { action: "report.staff_period_generated", entityType: "StaffReport", entityId: r.id, after: { kind, from, to, person: data.person.name } });
    return r;
  } catch (e) {
    if (isUniqueViolation(e)) return db.staffReport.findUniqueOrThrow({ where: { key } });
    throw e;
  }
}

/** The business over a week or month (or so far), with the week / month before for comparison. */
export async function buildBusinessPeriod(kind: PeriodKind, from: BusinessDate, to: BusinessDate): Promise<BusinessPeriod> {
  const r: Range = { from, to };
  const p: Range = previousPeriod(kind, from, to);
  const [pl, prevPl, occ, prevOcc, moves, food, prevFood, byKind, money, prevMoney, owed] = await Promise.all([
    profitLoss(r), profitLoss(p), occupancy(r), occupancy(p), guestMovement(r), restaurantSummary(r), restaurantSummary(p), dailyByKind(r), dailyMoney(r), dailyMoney(p), outstanding(),
  ]);
  const rev = pl.revenue;
  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((t, x) => t + f(x), 0);
  const received = sum(money, (x) => x.received);
  return {
    revenue: {
      total: rev.netRevenue, prev: prevPl.netRevenue, rooms: rev.rooms.net, restaurant: rev.restaurant, bar: rev.bar, roomService: rev.roomService,
      meeting: rev.meeting, transport: rev.transport, other: rev.other, discounts: rev.discounts, refunds: rev.refunds,
    },
    received, prevReceived: sum(prevMoney, (x) => x.received),
    expenses: pl.expenses, prevExpenses: prevPl.expenses, result: pl.estimatedProfit, prevResult: prevPl.estimatedProfit, outstanding: owed.total,
    rooms: { occupancy: Math.round(occ.occupancy * 10) / 10, prevOccupancy: Math.round(prevOcc.occupancy * 10) / 10, roomNights: occ.roomNights, sellable: occ.sellableNights, adr: occ.roomsSold ? Math.round(rev.rooms.net / occ.roomsSold) : 0 },
    guests: { checkIns: moves.checkIns, checkOuts: moves.checkOuts, newBookings: moves.newBookings, cancellations: moves.cancellations, noShows: moves.noShows },
    restaurant: { orders: food.orders, prevOrders: prevFood.orders, sales: food.sales, averageOrder: food.averageOrder, best: food.best },
    expensesByCategory: pl.expenseSummary.byCategory.slice(0, 6).map((c) => ({ name: c.name, amount: c.amount })),
    days: byKind.map((k) => {
      const m = money.find((x) => x.date === k.date);
      return {
        date: k.date, rooms: k.rooms, food: k.restaurant + k.bar + k.roomService, other: k.meeting + k.transport + k.other, total: k.total,
        occupancy: Math.round((occ.series.find((x) => x.date === k.date)?.occupancy ?? 0) * 10) / 10, received: m?.received ?? 0, expenses: m?.expenses ?? 0,
      };
    }),
  };
}

const fmtN = (n: number) => Math.round(n).toLocaleString("en-US");
/** "+12%" / "−5%" against the period before (nothing when there is no base to compare with). */
const vsPrev = (cur: number, prev: number) => (prev > 0 && cur !== prev ? ` (${cur > prev ? "+" : "−"}${Math.round(Math.abs(cur - prev) / prev * 100)}%)` : "");

export function renderTeamText(d: TeamPeriodData, hotelName: string, link?: string | null) {
  const what = d.kind === "WEEK" ? "Weekly report" : "Monthly report";
  const b = d.business;
  const tz = (v: number) => `TZS ${v < 0 ? "−" : ""}${fmtN(Math.abs(v))}`;
  const deptLines = b ? ([
    ["Rooms", b.revenue.rooms], ["Restaurant", b.revenue.restaurant], ["Bar", b.revenue.bar], ["Room service", b.revenue.roomService],
    ["Meeting room", b.revenue.meeting], ["Transport", b.revenue.transport], ["Other", b.revenue.other],
  ] as const).filter(([, v]) => v !== 0).map(([k, v]) => `  ${k}: ${fmtN(v)}`) : [];
  const business = b ? [
    `*Revenue ${tz(b.revenue.total)}*${vsPrev(b.revenue.total, b.revenue.prev)}`,
    ...(deptLines.length ? deptLines : ["  No revenue recorded"]),
    ...(b.revenue.refunds ? [`  (refunds: −${fmtN(b.revenue.refunds)})`] : []),
    `*Money received:* ${tz(b.received)}`,
    `*Expenses:* ${tz(b.expenses)}`,
    `*Net operating result:* ${tz(b.result)}`,
    `*Occupancy:* ${b.rooms.occupancy}% · ${b.rooms.roomNights} room nights${b.rooms.adr ? ` · avg rate ${fmtN(b.rooms.adr)}` : ""}`,
    `*Check-ins:* ${b.guests.checkIns} · *Check-outs:* ${b.guests.checkOuts} · *New bookings:* ${b.guests.newBookings}`,
    `*Restaurant & bar:* ${b.restaurant.orders} order${b.restaurant.orders === 1 ? "" : "s"} · ${tz(b.restaurant.sales)}`,
    `*Outstanding (all, today):* ${tz(b.outstanding)}`,
    "",
  ] : [];
  const dept = (k: "RECEPTION" | "RESTAURANT", title: string) => {
    const xs = d.people.filter((p) => p.department === k);
    if (!xs.length) return [];
    return [`*${title}*`, ...xs.map((p) => `• ${p.name.replace(/\s*\(.*\)/, "")}: ${p.shifts} shift${p.shifts === 1 ? "" : "s"}, ${shiftDuration(p.minutes)}${p.headline.length ? ` — ${p.headline.slice(0, 2).map(factLine).join(", ")}` : ""}`), ""];
  };
  const lines = [
    `*${hotelName.toUpperCase()}*`, `*${what}*`, d.label, "", ...business,
    "*The team*", ...dept("RECEPTION", "Reception"), ...dept("RESTAURANT", "Restaurant"), d.people.length ? null : "No shift was worked.",
  ].filter((x): x is string => x !== null);
  const tail = link ? `\n*Full report:* ${link}` : "";
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").slice(0, 3500 - tail.length) + tail;
}
/**
 * The period's reports: one per person who worked a shift in it, and the team digest the boss gets. Made once; a later
 * run only sends what has not reached the boss yet.
 */
export async function generateTeamPeriodReport(kind: PeriodKind, from: BusinessDate, to: BusinessDate, opts: { deadline?: number } = {}) {
  const key = `${kind}:${from}:TEAM`;
  const existing = await db.staffReport.findUnique({ where: { key } });
  if (existing) return existing;
  const settings = await getSettings();
  const { start, end } = businessRangeBounds(from, to, businessDayConfig(settings));
  // A shift still open from the last night of the period: wait for it (up to 8 h — the 07:35 or 10:00 run) so the
  // report has the whole period.
  const stillOpen = await db.actualShift.count({ where: { startedAt: { gte: start, lt: end }, endedAt: null } });
  if (stillOpen && Date.now() - end.getTime() < 8 * 3_600_000) return null;
  const workers = await db.actualShift.findMany({ where: { startedAt: { gte: start, lt: end } }, distinct: ["userId"], select: { userId: true } });
  const people: TeamPeriodData["people"] = [];
  for (const w of workers) {
    if (opts.deadline && Date.now() > opts.deadline) return null; // the next run carries on
    const r = await generatePersonPeriodReport(w.userId, kind, from, to);
    const d = r.data as unknown as PersonPeriodData;
    people.push({ userId: w.userId, name: d.person.name, role: d.person.role, department: d.department, reportId: r.id, token: r.shareToken, shifts: d.totals.shifts, minutes: d.totals.minutes, headline: d.headline.slice(2, 6) });
  }
  people.sort((a, b) => a.department.localeCompare(b.department) || a.name.localeCompare(b.name));
  if (opts.deadline && Date.now() > opts.deadline) return null; // the next run carries on
  const data: TeamPeriodData = { v: 1, kind, from, to, label: periodLabel(kind, from, to), business: await buildBusinessPeriod(kind, from, to), people };
  const token = newToken();
  try {
    const r = await db.staffReport.create({
      data: {
        key, kind, fromDate: toDbDate(from), toDate: toDbDate(to), userId: null, department: null, data: json(data),
        summaryText: renderTeamText(data, settings.hotelName, await staffReportLink(token)), shareToken: token, shareExpiresAt: new Date(Date.now() + SHARE_DAYS * 86_400_000),
      },
    });
    await audit(db, { label: "system" }, { action: "report.staff_team_generated", entityType: "StaffReport", entityId: r.id, after: { kind, from, to, people: people.length } });
    return r;
  } catch (e) {
    if (isUniqueViolation(e)) return db.staffReport.findUniqueOrThrow({ where: { key } });
    throw e;
  }
}

export async function deliverStaffReport(reportId: string, opts: { force?: boolean; manual?: boolean; deadline?: number } = {}) {
  const r = await db.staffReport.findUniqueOrThrow({ where: { id: reportId }, include: { deliveries: true } });
  return deliverToRecipients({ link: { staffReportId: r.id }, purpose: "STAFF_REPORT", text: r.summaryText, generatedAt: r.generatedAt, deliveries: r.deliveries, force: opts.force, manual: opts.manual, deadline: opts.deadline });
}

/** The boss gets the weekly and monthly reports from the morning run on (07:00) — never in the night. */
export const PERIOD_SEND_HOUR = 7;

/**
 * The scheduled run: the last full week and the last full month get their reports (once), and the weekly / monthly report
 * (the business and the team) goes to the boss from the morning on. Messages that have not reached the boss yet are tried
 * again. Stops starting new work after `budgetMs`.
 */
export async function runStaffPeriodJob(now = new Date(), budgetMs = 15_000, sendBy?: number) {
  const deadline = Date.now() + budgetMs;
  const settings = await getSettings();
  const cfg = businessDayConfig(settings);
  const today = businessDateOf(now, cfg);
  const morning = localParts(now, cfg.timezone).hour >= PERIOD_SEND_HOUR;
  const made: string[] = [];
  for (const kind of ["WEEK", "MONTH"] as const) {
    if (Date.now() > deadline) break;
    const { from, to } = lastCompleted(kind, today);
    const before = await db.staffReport.findUnique({ where: { key: `${kind}:${from}:TEAM` }, select: { id: true } });
    const team = before ?? (await generateTeamPeriodReport(kind, from, to, { deadline }));
    if (!team) continue;
    if (!before) made.push(`${kind}:${from}`);
    // Only the period just ended goes to the boss (an old one found late is kept, not pushed).
    if (settings.shiftReportEnabled && morning) await deliverStaffReport(team.id, { deadline: sendBy ?? deadline }).catch((e) => console.error("[staff-report] send failed", team.id, e));
  }
  return { made };
}

/** The boss's link: a report behind a valid, unexpired token (null otherwise). */
export async function staffReportByToken(token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return null;
  const r = await db.staffReport.findUnique({ where: { shareToken: token }, select: { id: true, kind: true, userId: true, data: true, generatedAt: true, shareExpiresAt: true } });
  if (!r) return null;
  return { ...r, expired: r.shareExpiresAt <= now };
}

export { MAX_ATTEMPTS };
