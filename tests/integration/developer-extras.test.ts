import { randomInt } from "node:crypto";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});

import { db } from "@/server/db";
import { getCurrentUser, type CurrentUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import { businessDayConfig, getSettings } from "@/server/settings";
import { businessDateOf, toDbDate } from "@/lib/time/business-date";
import { formatMinutesLabel } from "@/lib/format";
import { makeT } from "@/i18n/translate";
import zhExtras from "@/i18n/catalog/zh-CN/staff/developer-extras";
import { NOT_WORK_ACTIONS, settingsTab, type SettingsTab as SettingsData } from "@/server/services/developer-console";
import { crashData, healthReport, speedData, type CrashData, type SpeedData } from "@/server/services/developer-health";
import { SecurityTab } from "@/app/staff/(app)/developer/tab-crashes";
import { SpeedTab } from "@/app/staff/(app)/developer/tab-speed";
import { SettingsTab } from "@/app/staff/(app)/developer/tab-settings";
import { browser, makeSession, makeUser, removeMadeUsers, thrownBy, type MadeUser } from "../support/developer";

/**
 * Developer Home, the parts that follow the owner's other console (Sign-ins & security, Speed & size, Settings, and the health card's
 * "actions today"), against a real database. Every figure is checked against rows THIS file made: by-address grouping uses addresses that
 * exist nowhere else and a far-future window, and the other figures are a change before/after (other files leave rows of their own).
 */

const TAG = `EX${Date.now()}`;
const ip = (k: string) => `ex-${TAG}-${k}`;
/** A hotel day nobody else has written anything on (the audit trail cannot be cleaned, so the window is new on every run). */
const NOW = new Date(Date.UTC(2200 + randomInt(0, 700), randomInt(0, 12), randomInt(1, 28), 9, 0, 0));
const ago = (from: Date, ms: number) => new Date(from.getTime() - ms);
const H = 3600_000, D = 24 * H;

let dev: MadeUser, rec: MadeUser, boss: MadeUser;
let devUser: CurrentUser;
let cfg: ReturnType<typeof businessDayConfig>;
const as = async (u: MadeUser) => { browser.reset(); await makeSession(u.id); return (await getCurrentUser()) as CurrentUser; };

const put = (action: string, at: Date, o: { type?: string; userId?: string | null; entityId?: string | null; ip?: string | null } = {}) =>
  db.auditLog.create({
    data: {
      actorLabel: "ex-test", actorType: o.type ?? "STAFF", userId: o.userId ?? null, action, entityType: "User", entityId: o.entityId ?? null,
      ipAddress: o.ip ?? null, businessDate: toDbDate(businessDateOf(at, cfg)), createdAt: at,
    } as never,
  });

let before: CrashData, after: CrashData;
const savedSettings: { reportEnabled?: boolean; roomReportEnabled?: boolean; reportRecipients?: unknown; unpaidHoldHours?: number; onlinePayEnabled?: boolean } = {};
const madeAccounts: string[] = [];

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Extras Dev" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Asha Extras" });
  boss = await makeUser("OWNER", { fullName: "Boss Extras" });
  devUser = await as(dev);
  cfg = businessDayConfig(await getSettings());
  const s = await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } });
  Object.assign(savedSettings, { reportEnabled: s.reportEnabled, roomReportEnabled: s.roomReportEnabled, reportRecipients: s.reportRecipients, unpaidHoldHours: s.unpaidHoldHours, onlinePayEnabled: s.onlinePayEnabled });

  before = await crashData(devUser, NOW);
  // address A: 4 tries on 3 different accounts; B: 2 tries on one account; C: 1 try (2 days back); a try with no address; an address whose tries are 10 days old; 2 tries 16 days old
  await put("auth.login_failed", ago(NOW, 1 * H), { type: "SYSTEM", entityId: rec.id, ip: ip("a") });
  await put("auth.login_failed", ago(NOW, 2 * H), { type: "SYSTEM", entityId: boss.id, ip: ip("a") });
  await put("auth.login_failed", ago(NOW, 3 * H), { type: "SYSTEM", entityId: dev.id, ip: ip("a") });
  await put("auth.login_failed", ago(NOW, 30 * H), { type: "SYSTEM", entityId: rec.id, ip: ip("a") });
  await put("auth.login_failed", ago(NOW, 5 * H), { type: "SYSTEM", entityId: rec.id, ip: ip("b") });
  await put("auth.login_failed", ago(NOW, 6 * H), { type: "SYSTEM", entityId: rec.id, ip: ip("b") });
  await put("auth.login_failed", ago(NOW, 2 * D), { type: "SYSTEM", entityId: boss.id, ip: ip("c") });
  await put("auth.login_failed", ago(NOW, 4 * H), { type: "SYSTEM", entityId: boss.id, ip: null });
  for (let i = 0; i < 5; i++) await put("auth.login_failed", ago(NOW, 10 * D + i * H), { type: "SYSTEM", entityId: rec.id, ip: ip("old") });
  await put("auth.login_failed", ago(NOW, 16 * D), { type: "SYSTEM", entityId: rec.id, ip: ip("older") });
  await put("auth.login_failed", ago(NOW, 16 * D + H), { type: "SYSTEM", entityId: rec.id, ip: ip("older") });
  // successful sign-ins: 3 inside 14 days, 1 outside; a sign-out and a refused action are not sign-ins
  await put("auth.login", ago(NOW, 1 * D), { userId: rec.id });
  await put("auth.login", ago(NOW, 3 * D), { userId: boss.id });
  await put("auth.login", ago(NOW, 12 * D), { type: "DEVELOPER", userId: dev.id });
  await put("auth.login", ago(NOW, 16 * D), { userId: rec.id });
  await put("auth.logout", ago(NOW, 1 * D), { userId: rec.id });
  after = await crashData(devUser, NOW);
});

afterAll(async () => {
  browser.reset();
  await db.hotelSettings.update({ where: { id: 1 }, data: savedSettings as never });
  await db.moneyAccount.deleteMany({ where: { id: { in: madeAccounts.splice(0) } } });
  await removeMadeUsers();
});

describe("Sign-ins & security: failed tries by address, and the 14-day figures", () => {
  it("groups the wrong tries of the last 7 days by address: tries, different accounts tried, last try — the most tries first", async () => {
    const mine = after.byAddress!.filter((r) => r.ip.includes(TAG));
    expect(mine.map((r) => r.ip)).toEqual([ip("a"), ip("b"), ip("c")]);
    expect(mine[0]).toMatchObject({ tries: 4, accounts: 3 });
    expect(mine[0].last.getTime()).toBe(ago(NOW, 1 * H).getTime());
    expect(mine[1]).toMatchObject({ tries: 2, accounts: 1 });
    expect(mine[1].last.getTime()).toBe(ago(NOW, 5 * H).getTime());
    expect(mine[2]).toMatchObject({ tries: 1, accounts: 1 });
    // tries 10 days or more back are outside the 7 days; a try with no address on record has nothing to group by
    expect(after.byAddress!.map((r) => r.ip)).not.toContain(ip("old"));
    expect(after.byAddress!.map((r) => r.ip)).not.toContain(ip("older"));
    expect(after.byAddress!.every((r) => r.ip.length > 0)).toBe(true);
    expect(after.byAddress!.length).toBeLessThanOrEqual(8);
    for (let i = 1; i < after.byAddress!.length; i++) expect(after.byAddress![i - 1].tries).toBeGreaterThanOrEqual(after.byAddress![i].tries);
    // counts only: an address, how many, how many accounts, when — never an account, a name or a password
    expect(Object.keys(after.byAddress![0]).sort()).toEqual(["accounts", "ip", "last", "tries"]);
    expect(JSON.stringify(after.byAddress)).not.toMatch(/password|Asha|Boss Extras/i);
  });

  it("failed sign-ins in 14 days and successful sign-ins in 14 days are counted from the audit rows; what is older, a sign-out and other actions are not", () => {
    // failed, in 14 days: A 4 + B 2 + C 1 + no-address 1 + the five 10 days back; the two 16 days back are out
    expect(after.failed14d! - before.failed14d!).toBe(13);
    // in 7 days: A 4 + B 2 + C 1 + no-address 1 (the five 10 days back are out of the 7)
    expect(after.failed!.last7d - before.failed!.last7d).toBe(8);
    expect(after.successful14d! - before.successful14d!).toBe(3);
    // every field the page already had is still there
    expect(Object.keys(after).sort()).toEqual(["byAddress", "denied", "deniedByDay", "failed", "failed14d", "paused", "successful14d", "system"]);
    expect(Object.keys(after.failed!).sort()).toEqual(["byAccount", "byDay", "last24h", "last7d", "latest", "own24h"]);
  });
});

describe("Speed & size: the bookings question and what the system holds", () => {
  it("has a sixth timed question (the newest 50 bookings) and the average covers all six", async () => {
    const s = await speedData(devUser);
    expect(s.probes).toHaveLength(6);
    expect(s.probes[5].label).toBe("Load newest 50 bookings");
    expect(s.probes.every((p) => p.ms !== null && p.ms > 0)).toBe(true);
    expect(s.latency.samples).toHaveLength(6);
    expect(s.latency.average).toBe(Math.round(s.latency.samples.reduce((a, b) => a + b, 0) / 6));
    // the older figures are untouched
    expect(s.tables.map((t) => t.label)).toEqual(["Audit trail entries", "Sign-in sessions", "Messages sent", "System events"]);
  });

  it("'What the system holds' are counts that equal the direct counts — and the audit log reaches back to its oldest day", async () => {
    const s = await speedData(devUser);
    expect(s.holds.map((h) => h.label)).toEqual(["Guests", "Bookings", "Booked rooms", "Payments", "Restaurant orders", "Invoices", "Audit lines", "Guest messages", "Report messages"]);
    const direct: Record<string, number> = {
      guests: await db.guest.count(), bookings: await db.reservation.count(), bookedRooms: await db.reservationRoom.count(), payments: await db.payment.count(),
      orders: await db.restaurantOrder.count(), invoices: await db.invoice.count(), audit: await db.auditLog.count(), guestMessages: await db.guestMessage.count(), messages: await db.notificationDelivery.count(),
    };
    for (const h of s.holds) expect(h.rows, h.key).toBe(direct[h.key]);
    expect(s.holds.find((h) => h.key === "audit")!.rows).toBe(s.tables[0].rows);
    const oldest = await db.auditLog.findFirst({ orderBy: { businessDate: "asc" }, select: { businessDate: true } });
    expect(s.auditSince).toBe(oldest!.businessDate.toISOString().slice(0, 10));
    // nothing but numbers: no record, no name
    expect(Object.keys(s.holds[0]).sort()).toEqual(["key", "label", "rows"]);
  });

  it("a question or a count that fails leaves only its own figure empty; the rest still draw", async () => {
    const spies = [
      vi.spyOn(db.reservation, "findMany").mockRejectedValue(new Error("boom")),
      vi.spyOn(db.guest, "count").mockRejectedValue(new Error("boom")),
    ];
    try {
      const s = await speedData(devUser);
      expect(s.probes[5].ms).toBeNull();
      expect(s.probes.slice(0, 5).every((p) => p.ms !== null)).toBe(true);
      expect(s.latency.samples).toHaveLength(5);
      expect(s.holds.find((h) => h.key === "guests")!.rows).toBeNull();
      expect(s.holds.find((h) => h.key === "payments")!.rows).toEqual(expect.any(Number));
    } finally { for (const x of spies) x.mockRestore(); }
  });
});

describe("Settings: how the hotel is set up, and who is on the team", () => {
  it("the rows come from the hotel's settings and from counts — and never an account number, a phone or a key", async () => {
    await db.hotelSettings.update({
      where: { id: 1 },
      data: {
        reportEnabled: false, roomReportEnabled: true, unpaidHoldHours: 6, onlinePayEnabled: false,
        reportRecipients: [{ name: "Boss Extras", phone: "+255700123456", apiKeyRef: "CALLMEBOT_KEY_EXTRAS" }, { name: "MD Extras", phone: "+255700654321" }],
      } as never,
    });
    const settings = await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } });
    const countAccounts = () => db.moneyAccount.count({ where: { isActive: true, acceptsPayments: true } });
    const accountsBefore = await countAccounts();
    const account = (k: string, o: { isActive?: boolean; acceptsPayments?: boolean }) => db.moneyAccount.create({
      data: { code: `EX-${TAG}-${k}`, name: `Extras ${k}`, kind: "BANK", accountNumber: `ACCNO-${TAG}-${k}`, holderName: `Holder ${TAG} ${k}`, ...o },
    }).then((a) => { madeAccounts.push(a.id); return a; });
    await account("open", {});
    await account("closed", { isActive: false });
    await account("nopay", { acceptsPayments: false });

    const s = await settingsTab(devUser, null);
    const h = s.hotel;
    expect(h.dayStart).toBe(formatMinutesLabel(settings.businessDayStartMinutes));
    expect(h.timezone).toBe(settings.timezone);
    expect(h.dailyReport).toBe(false);
    expect(h.roomReport).toBe(true);
    expect(h.unpaidHoldHours).toBe(6);
    expect(h.onlinePayment).toBe(false);
    expect(h.reportRecipients).toBe(2);
    expect(h.guestRooms).toEqual({
      active: await db.room.count({ where: { isActive: true, roomType: { category: "GUEST_ROOM" } } }),
      total: await db.room.count({ where: { roomType: { category: "GUEST_ROOM" } } }),
    });
    expect(h.guestRooms!.active).toBeLessThanOrEqual(h.guestRooms!.total);
    expect(h.roomTypes).toBe(await db.roomType.count({ where: { isActive: true } }));
    // only an open account that takes payments is counted
    expect(h.paymentAccounts).toBe(await countAccounts());
    expect(h.paymentAccounts).toBe(accountsBefore + 1);
    // nothing secret in anything the console returns
    const json = JSON.stringify(s);
    for (const needle of ["+255700123456", "+255700654321", "CALLMEBOT_KEY_EXTRAS", `ACCNO-${TAG}`, `Holder ${TAG}`, "Boss Extras", "MD Extras"]) expect(json).not.toContain(needle);
    // the older fields are all still there
    expect(Object.keys(s).sort()).toEqual(["config", "env", "hotel", "identity", "recorded", "team"]);
  });

  it("the team is the active accounts by role: inactive accounts are not counted and the system role is left out", async () => {
    const roleCount = (team: NonNullable<SettingsData["team"]>, code: string) => team.find((r) => r.code === code)?.active ?? 0;
    const t0 = (await settingsTab(devUser, null)).team!;
    await makeUser("RECEPTIONIST", { fullName: "Second Extras" });
    await makeUser("RECEPTIONIST", { fullName: "Closed Extras", isActive: false });
    await makeUser("SYSTEM_ONLINE", { fullName: "System Extras" });
    const t1 = (await settingsTab(devUser, null)).team!;
    expect(roleCount(t1, "RECEPTIONIST")).toBe(roleCount(t0, "RECEPTIONIST") + 1);
    expect(t1.map((r) => r.code)).not.toContain("SYSTEM_ONLINE");
    expect(t1.every((r) => r.active > 0)).toBe(true);
    for (let i = 1; i < t1.length; i++) expect(t1[i - 1].active).toBeGreaterThanOrEqual(t1[i].active);
    expect(t1.reduce((n, r) => n + r.active, 0)).toBe(await db.user.count({ where: { isActive: true, role: { code: { not: "SYSTEM_ONLINE" } } } }));
    expect(Object.keys(t1[0]).sort()).toEqual(["active", "code", "name"]);
  });
});

describe("The health card: actions today", () => {
  it("counts work saved in the last 24 hours by staff and the Developer — sign-ins, looking, refusals and notes are not work", async () => {
    const h0 = await healthReport(devUser);
    expect(h0.actionsToday).toEqual(expect.any(Number));
    const now = new Date();
    await put("reservation.created", now, { type: "STAFF", userId: rec.id });
    await put("guest.message_sent", ago(now, 2 * H), { type: "STAFF", userId: rec.id });
    await put("user.updated", ago(now, 3 * H), { type: "DEVELOPER", userId: dev.id });
    // not work, whoever did it
    for (const action of NOT_WORK_ACTIONS) await put(action, ago(now, 60_000), { type: "STAFF", userId: rec.id });
    await put("developer.viewed", ago(now, 60_000), { type: "DEVELOPER", userId: dev.id });
    // not staff or Developer, and older than 24 hours
    await put("system.cleanup", ago(now, 60_000), { type: "SYSTEM" });
    await put("reservation.created", ago(now, 30 * H), { type: "STAFF", userId: rec.id });
    const h1 = await healthReport(devUser);
    expect(h1.actionsToday! - h0.actionsToday!).toBe(3);
  });

  it("is empty (not zero) when it cannot be read", async () => {
    const spy = vi.spyOn(db.auditLog, "count").mockRejectedValue(new Error("boom"));
    try {
      const h = await healthReport(devUser);
      expect(h.actionsToday).toBeNull();
      expect(h.database.online).toBe(true);
    } finally { spy.mockRestore(); }
  });
});

describe("only the Developer may read it", () => {
  it("refuses everyone else", async () => {
    for (const who of [rec, boss]) {
      const user = await as(who);
      for (const call of [() => crashData(user), () => speedData(user), () => settingsTab(user, null), () => healthReport(user)]) {
        const e = await thrownBy(call);
        expect(e).toBeInstanceOf(AppError);
        expect((e as AppError).code).toBe("FORBIDDEN");
      }
    }
  });
});

describe("what is drawn, in English and in 中文", () => {
  const en = makeT("en", null);
  const zh = makeT("zh-CN", zhExtras);
  const when = (x: Date) => x.toISOString().slice(0, 16).replace("T", " ");
  let speed: SpeedData;
  let settings: SettingsData;
  beforeAll(async () => { speed = await speedData(devUser); settings = await settingsTab(devUser, null); });

  const draw = (t: typeof en) => ({
    security: renderToStaticMarkup(createElement(SecurityTab, { t, c: after, when, now: NOW })),
    speed: renderToStaticMarkup(createElement(SpeedTab, { t, s: speed })),
    settings: renderToStaticMarkup(createElement(SettingsTab, { t, s: settings, when })),
  });
  const clean = (html: string) => { expect(html).not.toContain("undefined"); expect(html).not.toContain("NaN"); };

  it("English: the three parts say what the owner asked, with the figures filled in", () => {
    const h = draw(en);
    for (const html of Object.values(h)) clean(html);
    for (const w of ["Failed sign-ins", "Successful sign-ins", "Locked out now", "Failed tries by address", "One address trying many accounts is a warning sign.", "Your Developer sign-in", "Page crashes", "Refused to you"]) expect(h.security, w).toContain(w);
    expect(h.security).toContain("in 14 days");
    expect(h.security).toContain("after 20 wrong tries in 15 minutes");
    expect(h.security).toContain(ip("a"));
    expect(h.security).toContain(ip("b"));
    for (const w of ["Database answer", "Bookings list", "Audit lines", "in the permanent diary", "Load newest 50 bookings", "Database speed", "Database size", "Data checks", "This deployment", "What the system holds", "The audit log reaches back to"]) expect(h.speed, w).toContain(w);
    expect(h.speed).toContain("Under 150 ms is fast; over 400 ms, pages will feel slow.");
    for (const w of ["Guests", "Bookings", "Booked rooms", "Payments", "Restaurant orders", "Invoices", "Guest messages", "Report messages"]) expect(h.speed, w).toContain(w);
    for (const w of ["How the hotel is set up", "Business day starts", "Time zone", "Guest rooms in use", "Room types", "Payment accounts open", "Report recipients", "Daily report", "Room report", "Unpaid booking hold", "Online payment", "What the system needs to run", "Who is on the team", "Active accounts by role.", "Your session", "What you cannot do"]) expect(h.settings, w).toContain(w);
    expect(h.settings).toContain("04:00");
  });

  it("中文: the same parts, in Chinese, with no hole left in a sentence", () => {
    const h = draw(zh);
    for (const html of Object.values(h)) clean(html);
    for (const w of ["按地址统计的失败尝试", "登录成功", "当前被锁定", "14 天内", "20 次后"]) expect(h.security, w).toContain(w);
    for (const w of ["数据库响应", "预订列表", "审计记录条数", "系统中的数据量", "住客", "低于 150 毫秒算快"]) expect(h.speed, w).toContain(w);
    for (const w of ["酒店的设置", "时区", "系统运行所需的设置", "团队成员", "按角色统计的在用账户。"]) expect(h.settings, w).toContain(w);
    // no placeholder is left unfilled in the Chinese either
    for (const html of Object.values(h)) expect(html).not.toMatch(/\{(n|m|a|b|ms|fast|slow|date)\}/);
  });

  it("a part that could not be read says so in plain words, and never draws a zero or NaN", () => {
    const c: CrashData = { ...after, failed: null, failed14d: null, successful14d: null, byAddress: null, paused: null, deniedByDay: null };
    const s: SpeedData = {
      ...speed, probes: speed.probes.map((p) => ({ ...p, ms: null })), latency: { samples: [], average: null, slowest: null },
      tables: speed.tables.map((x) => ({ ...x, rows: null, bytes: null })), databaseBytes: null, holds: speed.holds.map((x) => ({ ...x, rows: null })), auditSince: null,
    };
    const st: SettingsData = {
      ...settings, team: null,
      hotel: { dayStart: null, timezone: null, guestRooms: null, roomTypes: null, paymentAccounts: null, reportRecipients: null, dailyReport: null, roomReport: null, unpaidHoldHours: null, onlinePayment: null },
    };
    for (const t of [en, zh]) {
      const html = [
        renderToStaticMarkup(createElement(SecurityTab, { t, c, when, now: NOW })),
        renderToStaticMarkup(createElement(SpeedTab, { t, s })),
        renderToStaticMarkup(createElement(SettingsTab, { t, s: st, when })),
      ];
      for (const x of html) { clean(x); expect(x).toContain(t("This could not be read just now.")); }
    }
    // a hold-up of zero hours is not "0 hours": the booking keeps its room until the arrival day
    const zero = renderToStaticMarkup(createElement(SettingsTab, { t: en, s: { ...settings, hotel: { ...settings.hotel, unpaidHoldHours: 0 } }, when }));
    expect(zero).toContain("until the arrival day");
  });

  it("every Chinese line keeps the placeholders of its English", () => {
    const holes = (x: string) => [...x.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const [key, value] of Object.entries(zhExtras)) expect(holes(value), key).toBe(holes(key.includes("::") ? key.split("::")[1] : key));
  });
});
