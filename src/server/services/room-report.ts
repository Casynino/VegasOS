import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "../db";
import { getSettings, businessDayConfig } from "../settings";
import { addDays, businessDateOf, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { buildDailyReport } from "./daily-report";
import { buildRoomReportData, withDayMoney, type RoomReportData } from "./room-report-data";
import { deliverToRecipients } from "./report-delivery";
import { reportMessage, roomRanges } from "@/lib/wa-fit";
import { Prisma } from "@/generated/prisma/client";

export const ROOM_REPORT_HOUR = 6;
export const ROOM_REPORT_MINUTE = 30;

const fmt = (n: number) => Math.round(n).toLocaleString("en-US");
const newToken = () => randomBytes(24).toString("base64url");
const json = (v: unknown) => v as Prisma.InputJsonValue;

/** "11 Oct 2026" */
const dayText = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const whenText = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(iso));
const periodText = (r: RoomReportData) => `${whenText(r.periodStart, r.timezone)} → ${whenText(r.periodEnd, r.timezone)}`;
export { dayText as roomReportDayText, whenText as roomReportWhenText, periodText as roomReportPeriodText };

/**
 * The Boss's WhatsApp message: the day in a few lines, then the link to the full report at the bottom — short enough
 * that the link always arrives (see `reportMessage`). Room numbers are written out while they fit, then as ranges.
 */
export function renderRoomReportText(r: RoomReportData, hotelName: string, link: string | null): string {
  const p = r.perf, m = r.money, day = r.day;
  const tz = (v: number) => `${v < 0 ? "− " : ""}TZS ${fmt(Math.abs(v))}`;
  const byType = new Map<string, string[]>();
  for (const x of r.sales) byType.set(x.type, [...(byType.get(x.type) ?? []), x.room]);
  const byNumber = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  const types = [...byType].map(([name, rooms]) => ({ name, rooms: [...rooms].sort(byNumber) }));
  const rm = r.rooms;
  const sold = (rooms: (list: string[]) => string | null, amount = true) => (types.length ? [
    "",
    rm && amount ? `*Rooms sold today* · ${tz(m.expected)}` : "*Rooms sold today*",
    ...types.map((t) => { const list = rooms(t.rooms); return list ? `• ${t.name} (${t.rooms.length}): ${list}` : `• ${t.name}: ${t.rooms.length} room${t.rooms.length === 1 ? "" : "s"}`; }),
  ] : []);
  const head = [
    `*${hotelName.toUpperCase()}*`,
    `*Daily room report* · ${dayText(r.date)}`,
    "",
    `*Rooms occupied:* ${p.occupied} of ${r.guestRooms} (${p.occupancyPct}%)`,
    `*New check-ins:* ${p.newSales}`,
    `*Continuing stays:* ${p.continuing}`,
    `*Checked out:* ${p.checkedOut}`,
    "",
    ...(day ? [
      `*Income:* ${tz(day.income.total)}`,
      `*Expenses:* ${tz(day.expenses.total)}`,
      `*Net profit:* ${tz(day.profit)}`,
      `*Money received:* ${tz(day.received)}`,
      `*Still owed:* ${tz(day.owed)}`,
    ] : [
      `*Room income:* ${tz(m.recognized)}`,
      `*Money received:* ${tz(m.collected)}`,
      `*Still owed:* ${tz(m.outstanding)}`,
    ]),
  ];
  // What room guests paid, kept apart from the hotel's money: a payment for an earlier day's room is said so, never
  // shown as a new sale. Money given back is said beside it, never taken off silently. One line — what each guest
  // still owes is in the full report, with the rooms.
  const beside = rm ? [
    rm.received.earlier ? `${tz(rm.received.earlier)} for earlier days` : null,
    rm.received.refunds ? `${tz(rm.received.refunds)} given back` : null,
  ].filter(Boolean).join(", ") : "";
  const guests = rm ? ["", `*Room guests paid:* ${tz(rm.received.total)}${beside ? ` (${beside})` : ""}`] : [];
  return reportMessage([
    [...head, ...guests, ...sold((list) => list.join(", "))],
    [...head, ...guests, ...sold(roomRanges)],
    // The Boss reads rooms by number: on the fullest days the room numbers stay before anything else.
    [...head, ...sold(roomRanges)],
    [...head, ...sold(roomRanges, false)],
    [...head, ...guests, ...sold(() => null)],
    [...head, ...guests],
    head,
  ], link, "Full report:");
}

export function roomReportLink(token: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://www.vegashoteltz.com";
  return `${base}/room-report/${token}`;
}

/**
 * Make (or, with a reason, re-make) the day's room report. One per business day: calling it again returns the stored
 * report; regenerating keeps the earlier version in its history and the same link.
 */
export async function ensureRoomReport(date: BusinessDate, o: { by?: string; automatic?: boolean; regenerate?: boolean; reason?: string | null } = {}) {
  const existing = await db.roomReport.findUnique({ where: { businessDate: toDbDate(date) } });
  if (existing && !o.regenerate) return existing;
  const data = await buildRoomReportData(date);
  const generatedBy = o.by ?? "system";
  if (!existing) {
    try {
      return await db.roomReport.create({
        data: { businessDate: toDbDate(date), data: json(data), generatedBy, automatic: !!o.automatic, shareToken: newToken(), generatedAt: new Date(data.generatedAt) },
      });
    } catch {
      return db.roomReport.findUniqueOrThrow({ where: { businessDate: toDbDate(date) } });
    }
  }
  const history = [...(existing.history as unknown as unknown[]), { version: existing.version, generatedAt: existing.generatedAt, generatedBy: existing.generatedBy, reason: existing.reason, data: existing.data }];
  return db.roomReport.update({
    where: { id: existing.id },
    data: { data: json(data), version: existing.version + 1, generatedAt: new Date(data.generatedAt), generatedBy, automatic: !!o.automatic, reason: o.reason ?? null, history: json(history), revokedAt: null },
  });
}

/** The delivery rows hang on the day's daily-report record (made empty here if the 07:00 job has not made it yet). */
async function deliveryAnchor(date: BusinessDate) {
  const key = { businessDate: toDbDate(date) };
  const include = { deliveries: { where: { purpose: "ROOM_REPORT" } } } as const;
  const found = await db.dailyReport.findUnique({ where: key, include });
  if (found) return found;
  const data = await buildDailyReport(date);
  try {
    return await db.dailyReport.create({ data: { ...key, data: json(data), summaryText: "", generatedBy: "room-report" }, include });
  } catch {
    return db.dailyReport.findUniqueOrThrow({ where: key, include });
  }
}

/** Send (or resend) the room report for a business date. Makes the report first if it does not exist. */
export async function deliverRoomReportByDate(date: BusinessDate, opts: { force?: boolean; manual?: boolean; deadline?: number; automatic?: boolean; by?: string } = {}) {
  const [settings, report, anchor] = await Promise.all([
    getSettings(), ensureRoomReport(date, { automatic: opts.automatic, by: opts.by }), deliveryAnchor(date),
  ]);
  if (report.revokedAt) await db.roomReport.update({ where: { id: report.id }, data: { revokedAt: null } });
  const text = renderRoomReportText(await withDayMoney(report.data as unknown as RoomReportData), settings.hotelName, roomReportLink(report.shareToken));
  return deliverToRecipients({
    link: { dailyReportId: anchor.id }, purpose: "ROOM_REPORT", text, generatedAt: report.generatedAt, deliveries: anchor.deliveries,
    force: opts.force, manual: opts.manual, deadline: opts.deadline,
  });
}

/** Send the room report kept with a daily-report record (same day). */
export async function deliverRoomReport(dailyReportId: string, opts: { force?: boolean; manual?: boolean; deadline?: number } = {}) {
  const r = await db.dailyReport.findUniqueOrThrow({ where: { id: dailyReportId }, select: { businessDate: true } });
  return deliverRoomReportByDate(r.businessDate.toISOString().slice(0, 10), opts);
}

/** The scheduled run (06:30 Dar es Salaam, and again to retry): builds yesterday's report once, sends it, never twice. */
export async function runRoomReportJob(now = new Date(), deadline?: number) {
  const settings = await getSettings();
  const cfg = businessDayConfig(settings);
  if (!settings.reportEnabled || !settings.roomReportEnabled) return { skipped: "disabled" };
  const reportDate = addDays(businessDateOf(now, cfg), -1);
  return deliverRoomReportByDate(reportDate, { automatic: true, deadline });
}
