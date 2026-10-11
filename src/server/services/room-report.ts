import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "../db";
import { getSettings, businessDayConfig } from "../settings";
import { addDays, businessDateOf, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { buildDailyReport } from "./daily-report";
import { buildRoomReportData, type RoomReportData } from "./room-report-data";
import { deliverToRecipients } from "./report-delivery";
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

/** The short executive message the Boss gets on WhatsApp (with the secure link to the full report). */
export function renderRoomReportText(r: RoomReportData, hotelName: string, link: string | null): string {
  const p = r.perf, m = r.money;
  const byType = new Map<string, { rooms: string[]; nights: number; net: number }>();
  for (const x of r.sales) { const t = byType.get(x.type) ?? { rooms: [], nights: 0, net: 0 }; t.rooms.push(x.room); t.nights += x.nights; t.net += x.total; byType.set(x.type, t); }
  const byNumber = (a: string, b: string) => a.localeCompare(b, undefined, { numeric: true });
  const typeLines = byType.size ? [...byType].map(([name, t]) => `  • ${name}: ${t.rooms.length} room${t.rooms.length === 1 ? "" : "s"} (${t.rooms.sort(byNumber).join(", ")}) · ${t.nights} night${t.nights === 1 ? "" : "s"} · TZS ${fmt(t.net)}`).join("\n") : null;
  const rateLine = r.rates.length ? r.rates.map((g) => `  • TZS ${fmt(g.rate)} × ${g.nights} night${g.nights === 1 ? "" : "s"}`).join("\n") : null;
  const lines = [
    `*${hotelName.toUpperCase()}*`,
    "*DAILY ROOM REPORT*",
    `Reporting date: ${dayText(r.date)}`,
    "",
    "*ROOM PERFORMANCE*",
    `Rooms occupied during the period: ${p.occupied} of ${r.guestRooms}`,
    `New check-ins (new room sales): ${p.newSales}`,
    `Previous stays continuing: ${p.continuing}`,
    `Checked out: ${p.checkedOut}`,
    `Currently available: ${p.available}`,
    `Occupancy: ${p.occupancyPct}%`,
    "",
    "*ROOM REVENUE*",
    `Expected room revenue (new sales): TZS ${fmt(m.expected)}`,
    `Collected: TZS ${fmt(m.collected)}`,
    `Outstanding: TZS ${fmt(m.outstanding)}`,
    "",
    "*ROOM SALES BREAKDOWN*",
    `Room nights sold: ${p.nightsSold}`,
    typeLines ? "By room type:" : null,
    typeLines,
    `Different rates sold: ${r.rates.length}`,
    rateLine,
    `Total new room revenue: TZS ${fmt(m.expected)}`,
    "",
    "*REPORT*",
    `Generated: ${whenText(r.generatedAt, r.timezone)}`,
    `Period: ${periodText(r)}`,
    link ? "" : null,
    link ? "*VIEW FULL DAILY ROOM REPORT*" : null,
    link,
    "",
    `${hotelName}`,
    "Automated Management Report",
  ];
  return lines.filter((l) => l !== null).join("\n").replace(/\n{3,}/g, "\n\n");
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
  const text = renderRoomReportText(report.data as unknown as RoomReportData, settings.hotelName, roomReportLink(report.shareToken));
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
