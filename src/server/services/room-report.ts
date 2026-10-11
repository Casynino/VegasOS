import "server-only";
import { db } from "../db";
import { getSettings, businessDayConfig } from "../settings";
import { addDays, businessDateOf, toDbDate } from "@/lib/time/business-date";
import { buildDailyReport, type DailyReportData } from "./daily-report";
import { deliverToRecipients } from "./report-delivery";
import { englishT } from "@/i18n/translate";
import { Prisma } from "@/generated/prisma/client";

export const ROOM_REPORT_HOUR = 6;
export const ROOM_REPORT_MINUTE = 30;

const fmt = (n: number) => Math.round(n).toLocaleString("en-TZ");

export function renderRoomReportText(r: DailyReportData, hotelName: string, link: string | null): string {
  const date = englishT.date(r.businessDate);
  const rooms = r.rooms;
  const inHouse = r.guests.inHouse;
  const checkIns = r.guests.checkIns;
  const checkOuts = r.guests.checkOuts;
  const continuing = Math.max(0, inHouse - checkIns);
  const total = rooms?.total ?? null;
  const pct = r.hotel.occupancy;
  const adr = rooms?.adr;

  const lines = [
    `*${hotelName.toUpperCase()}*`,
    `*Room report* · ${date}`,
    link ? `Full report: ${link}` : null,
    "",
    `*Occupancy:* ${inHouse}${total ? `/${total}` : ""} rooms — ${pct}%${adr ? ` · avg TZS ${fmt(adr)}` : ""}`,
    `*New check-ins:* ${checkIns} · *Continuing:* ${continuing} · *Check-outs:* ${checkOuts}`,
    "",
    `*Room revenue:* TZS ${fmt(r.revenue.roomNet)}`,
    r.money.outstanding > 0 ? `*Outstanding:* TZS ${fmt(r.money.outstanding)}` : null,
  ];
  return lines.filter((l) => l !== null).join("\n").replace(/\n{3,}/g, "\n\n").slice(0, 1200);
}

function roomReportLink(date: string): string {
  const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? "https://www.vegashoteltz.com";
  return `${base}/staff/reports?r=rooms&from=${date}&to=${date}`;
}

/** Send (or resend) the room report for an already-stored daily report record. */
export async function deliverRoomReport(reportId: string, opts: { force?: boolean; manual?: boolean; deadline?: number } = {}) {
  const [report, settings] = await Promise.all([
    db.dailyReport.findUniqueOrThrow({ where: { id: reportId }, include: { deliveries: { where: { purpose: "ROOM_REPORT" } } } }),
    getSettings(),
  ]);
  const link = roomReportLink(report.businessDate.toISOString().slice(0, 10));
  const text = renderRoomReportText(report.data as unknown as DailyReportData, settings.hotelName, link);
  return deliverToRecipients({
    link: { dailyReportId: report.id },
    purpose: "ROOM_REPORT",
    text,
    generatedAt: report.generatedAt,
    deliveries: report.deliveries,
    force: opts.force,
    manual: opts.manual,
    deadline: opts.deadline,
  });
}

/** Send (or resend) the room report for a specific business date. Creates the daily report record if needed. */
export async function deliverRoomReportByDate(date: string, opts: { force?: boolean; manual?: boolean; deadline?: number } = {}) {
  const [settings, data] = await Promise.all([getSettings(), buildDailyReport(date)]);
  let report = await db.dailyReport.findUnique({
    where: { businessDate: toDbDate(date) },
    include: { deliveries: { where: { purpose: "ROOM_REPORT" } } },
  });
  if (!report) {
    const json = (v: unknown) => v as Prisma.InputJsonValue;
    report = await db.dailyReport.create({
      data: { businessDate: toDbDate(date), data: json(data), summaryText: "", generatedBy: "room-report" },
      include: { deliveries: { where: { purpose: "ROOM_REPORT" } } },
    });
  }
  const link = roomReportLink(date);
  const text = renderRoomReportText(data, settings.hotelName, link);
  return deliverToRecipients({
    link: { dailyReportId: report.id },
    purpose: "ROOM_REPORT",
    text,
    generatedAt: report.generatedAt,
    deliveries: report.deliveries,
    force: opts.force,
    manual: opts.manual,
    deadline: opts.deadline,
  });
}

export async function runRoomReportJob(now = new Date(), deadline?: number) {
  const settings = await getSettings();
  const cfg = businessDayConfig(settings);
  if (!settings.reportEnabled) return { skipped: "disabled" };
  const today = businessDateOf(now, cfg);
  const reportDate = addDays(today, -1);

  // Build the previous day's data fresh (the 7 AM daily report may not exist yet at 6:30 AM).
  const data = await buildDailyReport(reportDate);

  // Get or create a daily report record so deliveries have a row to link to.
  // If the 7 AM job later runs, it regenerates this record in-place (same id, deliveries intact).
  let report = await db.dailyReport.findUnique({
    where: { businessDate: toDbDate(reportDate) },
    include: { deliveries: { where: { purpose: "ROOM_REPORT" } } },
  });
  if (!report) {
    const json = (v: unknown) => v as Prisma.InputJsonValue;
    report = await db.dailyReport.create({
      data: { businessDate: toDbDate(reportDate), data: json(data), summaryText: "", generatedBy: "room-report" },
      include: { deliveries: { where: { purpose: "ROOM_REPORT" } } },
    });
  }

  const link = roomReportLink(reportDate);
  const text = renderRoomReportText(data, settings.hotelName, link);
  return deliverToRecipients({
    link: { dailyReportId: report.id },
    purpose: "ROOM_REPORT",
    text,
    generatedAt: report.generatedAt,
    deliveries: report.deliveries,
    deadline,
  });
}
