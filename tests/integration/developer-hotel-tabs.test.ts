import { readFileSync } from "node:fs";
import path from "node:path";
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
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => unknown) => { void Promise.resolve().then(fn); },
}));

import { db } from "@/server/db";
import { getCurrentUser, type CurrentUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import { CONSOLE_TABS, parseTab } from "@/server/services/developer-console";
import { cronHotelTime, messagesData, MESSAGE_ROWS } from "@/server/services/developer-messages";
import { speedData } from "@/server/services/developer-health";
import { reportTroubles } from "@/server/services/report-health";
import { MAX_ATTEMPTS } from "@/server/services/report-delivery";
import { BUSINESS_VIEW_ACTION, noteBusinessView } from "@/server/services/developer-business";
import { BarChart } from "@/app/staff/(app)/developer/console-charts";
import { formatTZS } from "@/lib/format";
import { toDbDate } from "@/lib/time/business-date";
import { getSettings } from "@/server/settings";
import { reportTrouble } from "@/lib/report-trouble";
import DeveloperHomePage from "@/app/staff/(app)/developer/page";
import { MessagesTab } from "@/app/staff/(app)/developer/tab-messages";
import { makeT } from "@/i18n/translate";
import { eat, resetBusinessData } from "../support/helpers";
import { browser, makeSession, makeUser, redirectOf, removeMadeUsers, resolveAsync, thrownBy, type MadeUser } from "../support/developer";

/**
 * THE MESSAGES & REPORTS part of the Developer home (owner, 2026-10-18), and the page that holds the system parts only — the Hotel,
 * Money and Activity parts were taken out because the Developer's job is the SYSTEM, not the hotel's operations — against a real database. They are read-only and Developer-only; every figure that the Boss's reports have is the same number as the
 * shared service gives; days are the hotel's (04:00 → 04:00); nothing secret or personal beyond a masked phone and a name is read.
 * Time is passed in (`now`), a far-away year keeps these rows apart from every other test file's.
 */

const NOW = eat("2041-03-10T12:00:00");
const TODAY = "2041-03-10";
const t = makeT("en", null);
const when = (d: Date) => t.dateTime(d, "Africa/Dar_es_Salaam");

let dev: MadeUser, rec: MadeUser, boss: MadeUser, md: MadeUser, mgr: MadeUser, fin: MadeUser;

async function as(u: MadeUser) {
  browser.reset();
  await makeSession(u.id);
  return (await getCurrentUser()) as CurrentUser;
}

let savedSettings: Record<string, unknown> = {};
const SETTING_KEYS = ["unpaidHoldHours", "reportEnabled", "roomReportEnabled", "reportRecipients", "liveSince"] as const;
const setSettings = (data: Record<string, unknown>) => db.hotelSettings.update({ where: { id: 1 }, data: data as never });

/** Take away every row the earlier test files and this one left in the tables these tabs read. */
async function wipe() {
  await resetBusinessData();
  await db.$executeRawUnsafe(`TRUNCATE "room_reports", "service_requests", "booking_requests", "payment_corrections", "restaurant_order_items", "revenue_transactions" CASCADE`);
  await db.notificationDelivery.deleteMany();
  await db.guestMessage.deleteMany();
}

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Tabs Dev" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Asha Tabs (Reception)" });
  boss = await makeUser("OWNER", { fullName: "Boss Tabs" });
  md = await makeUser("ADMIN", { fullName: "MD Tabs" });
  mgr = await makeUser("MANAGER", { fullName: "Manager Tabs" });
  fin = await makeUser("FINANCE", { fullName: "Finance Tabs" });
  const s = await getSettings();
  savedSettings = Object.fromEntries(SETTING_KEYS.map((k) => [k, (s as unknown as Record<string, unknown>)[k]]));
});
afterAll(async () => {
  browser.reset();
  vi.useRealTimers();
  await setSettings(savedSettings).catch(() => undefined);
  await wipe().catch(() => undefined);
  await db.bookingQrCode.deleteMany({ where: { label: "Tabs test QR" } }).catch(() => undefined);
  await removeMadeUsers();
});

// ───────────────────────────────────────────── 1. only the Developer ─────────────────────────────────────────────
describe("the door: the Developer account only", () => {
  it("the old ?tab= names are the parts of the page, and ?tab= finds each (anything else is the first)", () => {
    expect([...CONSOLE_TABS]).toEqual(["problems", "activity", "messages", "speed", "crashes", "settings", "people"]);
    for (const tab of ["problems", "activity", "messages"]) expect(parseTab(tab)).toBe(tab);
    // the Hotel and Money parts were taken out (the owner: "all this data are operation data, the developer does not need it")
    for (const tab of ["hotel", "money", "Hotel"]) expect(parseTab(tab)).toBe("problems");
  });

  it.each([["receptionist", () => rec], ["Boss", () => boss], ["MD", () => md], ["manager", () => mgr], ["Finance", () => fin]])("the %s is refused by every new function", async (_n, who) => {
    const user = await as(who());
    for (const call of [() => messagesData(user, NOW), () => speedData(user, NOW)]) {
      const e = await thrownBy(call);
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("FORBIDDEN");
    }
  });

  it("a Developer working as someone is shut out too", async () => {
    const user = await as(dev);
    const working = { ...user, workAs: { developerId: dev.id, developerName: dev.fullName, startedAt: new Date() } } as unknown as CurrentUser;
    for (const call of [() => messagesData(working, NOW), () => speedData(working, NOW)]) {
      expect(((await thrownBy(call)) as AppError).code).toBe("FORBIDDEN");
    }
  });
});

// ───────────────────────────────────────────── 4. MESSAGES & REPORTS ─────────────────────────────────────────────
describe("the Messages & reports tab", () => {
  let msgs: Awaited<ReturnType<typeof messagesData>>;
  const KEY = "ABCDEF1234567890ABCDEF99";
  const BODY = "SECRET-MESSAGE-BODY-xyz";

  beforeAll(async () => {
    await wipe();
    await setSettings({ reportEnabled: true, roomReportEnabled: true, reportRecipients: [{ name: "Boss", phone: "+255700000412", channel: "WHATSAPP_CALLMEBOT", apiKeyRef: null }], liveSince: null });
    const day = (d: string) => toDbDate(d);
    const daily = (d: string, generated: string, automatic = true) => db.dailyReport.create({ data: { businessDate: day(d), data: {}, summaryText: "report text", generatedAt: eat(generated), automatic } });
    // 03-09 (the last closed day): daily made and sent; room made but its send failed
    const d9 = await daily("2041-03-09", "2041-03-10T07:00:00");
    await db.roomReport.create({ data: { businessDate: day("2041-03-09"), data: {}, shareToken: "room-tok-0309", generatedAt: eat("2041-03-10T06:30:00"), automatic: true } });
    await db.notificationDelivery.create({ data: { dailyReportId: d9.id, purpose: "DAILY_REPORT", channel: "WHATSAPP_CALLMEBOT", recipient: "+255700000412", status: "SENT", attempts: 1, sentAt: eat("2041-03-10T07:01:00"), createdAt: eat("2041-03-10T07:00:30"), updatedAt: eat("2041-03-10T07:01:00") } });
    await db.notificationDelivery.create({ data: { dailyReportId: d9.id, purpose: "ROOM_REPORT", channel: "WHATSAPP_CALLMEBOT", recipient: "+255700000412", status: "FAILED", attempts: 2, lastError: `CallMeBot: Invalid apikey=${KEY} for +255700000412`, createdAt: eat("2041-03-10T06:31:00"), updatedAt: eat("2041-03-10T06:32:00") } });
    // 03-08: daily made but never sent; no room report · 03-07 and earlier: nothing
    await daily("2041-03-08", "2041-03-09T07:00:00", false);

    const del = (n: number, status: string, over: Record<string, unknown> = {}) => db.notificationDelivery.create({
      data: { purpose: n % 3 === 0 ? "ARRIVAL_REMINDER" : "SHIFT_REPORT", channel: "WHATSAPP_CALLMEBOT", recipient: `+25570000${String(1000 + n)}`, status, attempts: n % 4 === 0 ? MAX_ATTEMPTS : 1,
        lastError: status === "FAILED" ? `CallMeBot request failed: timeout on number 255700001000 token=${KEY}` : null,
        createdAt: new Date(NOW.getTime() - n * 3600_000), updatedAt: new Date(NOW.getTime() - n * 3600_000), sentAt: status === "SENT" ? new Date(NOW.getTime() - n * 3600_000) : null, ...over } as never,
    });
    for (let n = 1; n <= 10; n++) await del(n, "FAILED");
    for (let n = 11; n <= 14; n++) await del(n, "PENDING");
    for (let n = 15; n <= 18; n++) await del(n, "SENT");
    for (let n = 30; n <= 34; n++) await del(n, "FAILED"); // older than a day, still inside the week: 20 failed or waiting in all
    // the hotel day on the chart: 03:30 on the 10th belongs to the 9th, 04:30 to the 10th
    await del(40, "SENT", { createdAt: eat("2041-03-10T03:30:00"), sentAt: eat("2041-03-10T03:30:00"), updatedAt: eat("2041-03-10T03:30:00"), recipient: "+255700004030" });
    await del(41, "SENT", { createdAt: eat("2041-03-10T04:30:00"), sentAt: eat("2041-03-10T04:30:00"), updatedAt: eat("2041-03-10T04:30:00"), recipient: "+255700004130" });
    // guest messages — their words are never read
    const guest = await db.guest.create({ data: { fullName: "Message Guest", phone: "+255711000999" } });
    for (const [status, ago] of [["SENT", 1], ["SENT", 5], ["FAILED", 2], ["SENT", 30]] as const) {
      await db.guestMessage.create({ data: { guestId: guest.id, type: "WELCOME", channel: "WHATSAPP", to: "+255711000999", body: BODY, status, createdAt: new Date(NOW.getTime() - ago * 3600_000) } });
    }
    msgs = await messagesData(await as(dev), NOW);
  }, 300_000);

  it("the last closed day's two reports say what the Boss's home says (the same function), in plain states", async () => {
    const troubles = await reportTroubles(NOW);
    expect(msgs.lastClosed!.date).toBe("2041-03-09");
    expect(msgs.lastClosed!.daily.trouble).toBe(troubles.daily?.kind ?? null);
    expect(msgs.lastClosed!.room.trouble).toBe(troubles.room?.kind ?? null);
    expect(msgs.lastClosed!.daily.state).toBe("ok");
    expect(msgs.lastClosed!.room.state).toBe("failed");
    expect(msgs.lastClosed!.room.trouble).toBe("failed");
  });

  it("the table of closed days: 7 days, newest first; made / sent / not made, version, automatic or by a person", () => {
    const rows = msgs.reportDays!;
    expect(rows.map((r) => r.date)).toEqual(["2041-03-09", "2041-03-08", "2041-03-07", "2041-03-06", "2041-03-05", "2041-03-04", "2041-03-03"]);
    expect(rows[0].daily).toMatchObject({ state: "ok", version: 1, automatic: true });
    expect(rows[0].daily.sentAt!.getTime()).toBe(eat("2041-03-10T07:01:00").getTime());
    expect(rows[0].room).toMatchObject({ state: "failed", automatic: true, sentAt: null });
    expect(rows[1].daily).toMatchObject({ state: "unsent", automatic: false });
    expect(rows[1].room.state).toBe("missing");
    expect(rows[2].daily.state).toBe("missing");
    expect(rows.slice(2).every((r) => r.daily.state === "missing" && r.room.state === "missing")).toBe(true);
    // every state is the pure rule's answer
    const settings = { enabled: true, hasRecipients: true } as const;
    expect(reportTrouble({ ...settings, late: true, report: null })).toBe("missing");
  });

  it("reports switched off, or nobody to receive them, are 'switched off' — not a trouble", async () => {
    await setSettings({ reportEnabled: false });
    const off = await messagesData(await as(dev), NOW);
    expect(off.reportDays!.every((r) => r.daily.state === "off" && r.room.state === "off")).toBe(true);
    await setSettings({ reportEnabled: true, reportRecipients: [] });
    const nobody = await messagesData(await as(dev), NOW);
    expect(nobody.reportDays![0].daily.state).toBe("off");
    await setSettings({ reportRecipients: [{ name: "Boss", phone: "+255700000412", channel: "WHATSAPP_CALLMEBOT", apiKeyRef: null }] });
  });

  it("deliveries in 24 hours: sent, failed and waiting are counted by the rules the health card uses", async () => {
    expect(msgs.deliveries24h!.failed).toBe(await db.notificationDelivery.count({ where: { status: "FAILED", updatedAt: { gte: new Date(NOW.getTime() - 24 * 3600_000) } } }));
    expect(msgs.deliveries24h).toEqual({ sent: await db.notificationDelivery.count({ where: { status: { in: ["SENT", "DELIVERED"] }, sentAt: { gte: new Date(NOW.getTime() - 24 * 3600_000) } } }), failed: msgs.deliveries24h!.failed, waiting: 4 });
    expect(msgs.deliveries24h!.sent).toBe(1 /* the daily report */ + 4 /* 15–18 h ago */ + 2 /* the two edge ones */ + 0);
  });

  it("failed deliveries: those with tries left and those given up (last 7 days)", async () => {
    const week = await db.notificationDelivery.findMany({ where: { status: "FAILED", createdAt: { gte: new Date(NOW.getTime() - 7 * 24 * 3600_000) } }, select: { attempts: true } });
    const gaveUp = week.filter((d) => d.attempts >= MAX_ATTEMPTS).length;
    expect(gaveUp).toBe(3); // numbers 4, 8 and 32 had every try
    expect(msgs.retry).toEqual({ underMax: week.length - gaveUp, atMax: gaveUp });
    expect(week.length).toBe(16); // 10 failed, 5 older failed ones, and the room report's failed send (waiting ones are not "failed")
    expect(msgs.maxAttempts).toBe(MAX_ATTEMPTS);
  });

  it("guest messages in 24 hours come from the guests' own log", () => {
    expect(msgs.guestMessages24h).toEqual({ sent: 2, failed: 1 });
  });

  it("deliveries per day are on the hotel day: 03:30 on the 10th is the 9th, 04:30 is the 10th", async () => {
    expect(msgs.perDay).toHaveLength(14);
    const inDay = (from: string, to: string, status: string[]) => db.notificationDelivery.count({ where: { status: { in: status as never[] }, createdAt: { gte: eat(from), lt: eat(to) } } });
    const nine = msgs.perDay!.find((d) => d.date === "2041-03-09")!;
    const ten = msgs.perDay!.find((d) => d.date === TODAY)!;
    // the hotel day is 04:00 → 04:00 — counted here from the instants themselves, not from the calendar date
    expect(nine.sent).toBe(await inDay("2041-03-09T04:00:00", "2041-03-10T04:00:00", ["SENT", "DELIVERED"]));
    expect(ten.sent).toBe(await inDay("2041-03-10T04:00:00", "2041-03-11T04:00:00", ["SENT", "DELIVERED"]));
    expect(ten.failed).toBe(await inDay("2041-03-10T04:00:00", "2041-03-11T04:00:00", ["FAILED"]));
    expect(nine.failed + ten.failed).toBeGreaterThan(0);
    // the 03:30 delivery is on the 9th, the 04:30 one on the 10th, though both are the 10th on the calendar
    const edge = await db.notificationDelivery.findMany({ where: { recipient: { in: ["+255700004030", "+255700004130"] } }, select: { recipient: true, createdAt: true } });
    expect(edge).toHaveLength(2);
    expect(nine.sent).toBeGreaterThanOrEqual(1);
    expect(ten.sent).toBeGreaterThanOrEqual(1);
    // nothing is lost between the days: the fourteen days add up to every delivery of the window
    const all = msgs.perDay!.reduce((n, d) => n + d.sent + d.failed + d.pending, 0);
    expect(all).toBe(await db.notificationDelivery.count({ where: { createdAt: { gte: eat("2041-02-25T04:00:00") } } }));
  });

  it("deliveries by purpose: reports, shift reports, guest messages (reminders + the log); counts and failures", async () => {
    const weekStart = eat("2041-03-04T04:00:00");
    const by = Object.fromEntries(msgs.byPurpose!.map((p) => [p.key, p]));
    expect(by.DAILY_REPORT).toMatchObject({ count: 1, failed: 0 });
    expect(by.ROOM_REPORT).toMatchObject({ count: 1, failed: 1 });
    expect(by.SHIFT_REPORT.count).toBe(await db.notificationDelivery.count({ where: { purpose: "SHIFT_REPORT", createdAt: { gte: weekStart } } }));
    const reminders = await db.notificationDelivery.count({ where: { purpose: "ARRIVAL_REMINDER", createdAt: { gte: weekStart } } });
    expect(by.GUEST.count).toBe(reminders + 4); // the reminders and the four messages in the guests' log
    expect(by.GUEST.failed).toBe((await db.notificationDelivery.count({ where: { purpose: "ARRIVAL_REMINDER", status: "FAILED", createdAt: { gte: weekStart } } })) + 1);
    const counts = msgs.byPurpose!.map((p) => p.count);
    expect(counts).toEqual([...counts].sort((a, b) => b - a));
  });

  it("failed or waiting deliveries: the newest 15, a phone as its last three digits, only the KIND of trouble (never the provider's words)", () => {
    expect(msgs.problems).toHaveLength(MESSAGE_ROWS.problems);
    const first = msgs.problems![0];
    expect(first.recipient).toMatch(/^•••• \d{3}$/);
    // the provider's reply is not returned at all — not even trimmed
    for (const p of msgs.problems!) expect(Object.keys(p).sort(), p.id).toEqual(["at", "atMax", "attempts", "id", "kind", "purpose", "recipient", "reminder", "status"]);
    const failed = msgs.problems!.find((p) => p.status === "FAILED" && !p.reminder)!;
    expect(failed.kind).toBe("The provider did not answer");
    expect(msgs.problems!.every((p) => ["FAILED", "PENDING"].includes(p.status))).toBe(true);
    expect(msgs.problems!.find((p) => p.status === "PENDING")!.kind).toBe("Not sent yet");
    // "all tries used" means exactly that, and only a failed delivery can have it; fewer tries promises nothing
    expect(msgs.problems!.find((p) => p.attempts >= MAX_ATTEMPTS && !p.reminder)!.atMax).toBe(true);
    expect(msgs.problems!.filter((p) => p.status === "PENDING").every((p) => !p.atMax)).toBe(true);
    const times = msgs.problems!.map((p) => p.at.getTime());
    expect(times).toEqual([...times].sort((a, b) => b - a));
  });

  it("never returns a message's words, a key or a full phone number", () => {
    const json = JSON.stringify(msgs);
    for (const w of [BODY, KEY, "255700000412", "255700001000", "+255711000999", "report text"]) expect(json, w).not.toContain(w);
  });

  it("a provider reply that echoes the hotel's own message never reaches the data or the page: only the kind of trouble", async () => {
    const secret = "SECRET-ECHOED-WORDS Dear Asha your balance is TZS 45,000";
    const row = await db.notificationDelivery.create({ data: {
      purpose: "SHIFT_REPORT", channel: "WHATSAPP_CALLMEBOT", recipient: "+255700000777", status: "FAILED", attempts: 2,
      lastError: `CallMeBot: Message to: +255700000777 Text to send: ${secret} apikey="${KEY}" APIKey is invalid`,
      createdAt: new Date(NOW.getTime() - 60_000), updatedAt: new Date(NOW.getTime() - 60_000),
    } });
    try {
      const d = await messagesData(await as(dev), NOW);
      const line = d.problems!.find((p) => p.id === row.id)!;
      expect(line).toBeTruthy();
      expect(line.kind).toBe("The provider refused it");
      const html = renderToStaticMarkup(createElement(MessagesTab, { t, d, when }));
      expect(html).toContain("The provider refused it");
      for (const [where, text] of [["data", JSON.stringify(d)], ["markup", html]] as const) {
        for (const w of ["SECRET-ECHOED-WORDS", "Dear Asha", "45,000", "Text to send", "Message to", KEY, "255700000777", "APIKey"]) expect(text, `${where}: ${w}`).not.toContain(w);
      }
    } finally { await db.notificationDelivery.delete({ where: { id: row.id } }); }
  });

  it("an arrival reminder that failed on several runs is ONE line per reservation (each run makes a new row and none is ever tried again)", async () => {
    const mk = (rec: string, resId: string, minutesAgo: number) => db.notificationDelivery.create({ data: {
      purpose: "ARRIVAL_REMINDER", channel: "WHATSAPP_CALLMEBOT", recipient: rec, reservationId: resId, status: "FAILED", attempts: 1, lastError: "CallMeBot: APIKey is invalid",
      createdAt: new Date(NOW.getTime() - minutesAgo * 60_000), updatedAt: new Date(NOW.getTime() - minutesAgo * 60_000),
    } });
    const rows = [await mk("+255700005551", "res-rem-1", 10), await mk("+255700005551", "res-rem-1", 20), await mk("+255700005551", "res-rem-1", 30), await mk("+255700005552", "res-rem-2", 40)];
    try {
      const d = await messagesData(await as(dev), NOW);
      const one = d.problems!.filter((p) => p.recipient === "•••• 551");
      expect(one).toHaveLength(1);
      expect(one[0]).toMatchObject({ reminder: true, attempts: 3, atMax: false, status: "FAILED", id: rows[0].id });
      const two = d.problems!.filter((p) => p.recipient === "•••• 552");
      expect(two).toHaveLength(1);
      expect(two[0]).toMatchObject({ reminder: true, attempts: 1 });
      expect(d.problems).toHaveLength(MESSAGE_ROWS.problems);
      // a reminder line makes no promise about tries: it carries neither tag
      const html = renderToStaticMarkup(createElement(MessagesTab, { t, d: { ...d, problems: one }, when }));
      const table = html.slice(html.indexOf("Failed or waiting deliveries"), html.indexOf("When the automatic jobs run"));
      expect(table).toContain("•••• 551");
      expect(table).not.toContain("fewer than");
      expect(table).not.toContain("no more automatic tries");
    } finally { await db.notificationDelivery.deleteMany({ where: { id: { in: rows.map((r) => r.id) } } }); }
  });

  it("the words say what is true: 'fewer than {max} tries' promises no retry, and the report that was sent is 'Sent', not 'On time'", () => {
    const html = renderToStaticMarkup(createElement(MessagesTab, { t, d: msgs, when }));
    expect(html).toContain(`fewer than ${MAX_ATTEMPTS} tries`);
    expect(html).toContain("no more automatic tries");
    expect(html).toContain("Failed deliveries, 7 days");
    for (const w of ["will be tried again by themselves", "tries left", "given up", "being tried", "On time", "trimmed and cleaned"]) expect(html, w).not.toContain(w);
    expect(msgs.lastClosed!.daily.state).toBe("ok");
    expect(html).toMatch(/Daily report<\/p>[\s\S]{0,2000}?>Sent</);
    // a stacked chart's picture says each part of a day, not only the sum
    expect(html).toMatch(/aria-label="Deliveries per day: [^"]*\(Sent \d+/);
  });

  it("lateness is decided from the DUE INSTANT: 06:00 / 07:30 / 09:00 as before, and 02:00 (before the hotel day turns) counts the report due the morning before", async () => {
    // closed day = the 10th (no report was made for it); the room report is due on the 11th at 07:00, the daily report at 08:00
    for (const [at, daily, room] of [["2041-03-11T06:00:00", "waiting", "waiting"], ["2041-03-11T07:30:00", "waiting", "missing"], ["2041-03-11T09:00:00", "missing", "missing"], ["2041-03-12T02:00:00", "missing", "missing"]] as const) {
      const now = eat(at);
      const d = await messagesData(await as(dev), now);
      const troubles = await reportTroubles(now);
      expect(d.lastClosed!.date, at).toBe("2041-03-10");
      expect(d.reportDays![0].daily.state, `${at} daily`).toBe(daily);
      expect(d.reportDays![0].room.state, `${at} room`).toBe(room);
      // the same answer as the Boss's home gives
      expect(d.lastClosed!.daily.trouble, `${at} daily`).toBe(troubles.daily?.kind ?? null);
      expect(d.lastClosed!.room.trouble, `${at} room`).toBe(troubles.room?.kind ?? null);
    }
    // 02:00 on the 10th: the hotel day is still the 9th, so the last closed day is the 8th (made, never sent; no room report), both due the morning of the 9th
    const early = eat("2041-03-10T02:00:00");
    const d = await messagesData(await as(dev), early);
    expect(d.lastClosed!.date).toBe("2041-03-08");
    expect(d.lastClosed!.daily.state).toBe("unsent");
    expect(d.lastClosed!.room.state).toBe("missing");
    const troubles = await reportTroubles(early);
    expect(d.lastClosed!.daily.trouble).toBe(troubles.daily?.kind);
    expect(troubles.daily?.kind).toBe("unsent");
    expect(troubles.room?.kind).toBe("missing");
  });

  it("the automatic jobs' proof is the newest report the job ITSELF made; a hand-made one never replaces it and is shown apart", async () => {
    const day = (d: string) => toDbDate(d);
    const hand = await db.dailyReport.create({ data: { businessDate: day("2041-03-10"), data: {}, summaryText: "made by hand", generatedAt: eat("2041-03-10T11:00:00"), automatic: false } });
    const handRoom = await db.roomReport.create({ data: { businessDate: day("2041-03-10"), data: {}, shareToken: "room-tok-by-hand", generatedAt: eat("2041-03-10T11:05:00"), automatic: false } });
    try {
      const d = await messagesData(await as(dev), NOW);
      const daily = d.jobs!.find((j) => j.path === "/api/cron/daily-report")!;
      const room = d.jobs!.find((j) => j.path === "/api/cron/room-report")!;
      expect(daily.lastMadeAt!.getTime()).toBe(eat("2041-03-10T07:00:00").getTime());
      expect(daily.lastDate).toBe("2041-03-09");
      expect(daily.lastByPerson).toEqual({ at: eat("2041-03-10T11:00:00"), date: "2041-03-10" });
      expect(room.lastMadeAt!.getTime()).toBe(eat("2041-03-10T06:30:00").getTime());
      expect(room.lastByPerson).toEqual({ at: eat("2041-03-10T11:05:00"), date: "2041-03-10" });
    } finally {
      await db.dailyReport.delete({ where: { id: hand.id } });
      await db.roomReport.delete({ where: { id: handRoom.id } });
    }
  });

  it("the automatic jobs are read from vercel.json, in hotel time, with the newest report as the proof", () => {
    const file = JSON.parse(readFileSync(path.join(process.cwd(), "vercel.json"), "utf8")) as { crons: { path: string; schedule: string }[] };
    const times = (p: string) => file.crons.filter((c) => c.path === p).map((c) => { const [m, h] = c.schedule.split(" ").map(Number); return `${String((h + 3) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}`; }).sort();
    const daily = msgs.jobs!.find((j) => j.path === "/api/cron/daily-report")!;
    const room = msgs.jobs!.find((j) => j.path === "/api/cron/room-report")!;
    expect(daily.times).toEqual(times("/api/cron/daily-report"));
    expect(daily.times).toEqual(["04:05", "06:15", "07:00", "07:35", "10:00", "21:00", "21:20"]);
    expect(room.times).toEqual(["06:30", "06:50", "08:00"]);
    expect(msgs.jobs).toHaveLength(new Set(file.crons.map((c) => c.path)).size);
    expect(daily.lastMadeAt!.getTime()).toBe(eat("2041-03-10T07:00:00").getTime());
    expect(daily.lastDate).toBe("2041-03-09");
    expect(room.lastMadeAt!.getTime()).toBe(eat("2041-03-10T06:30:00").getTime());
    expect(cronHotelTime("5 1 * * *", "Africa/Dar_es_Salaam")).toBe("04:05");
    expect(cronHotelTime("*/5 * * * *", "Africa/Dar_es_Salaam")).toBeNull();
  });

  it("a part that cannot be read is left out and the rest still draws", async () => {
    const spy = vi.spyOn(await import("@/server/services/report-health"), "reportTroubles").mockRejectedValue(new Error("boom"));
    try {
      const d = await messagesData(await as(dev), NOW);
      expect(d.lastClosed).toBeNull();
      expect(d.reportDays).not.toBeNull();
      expect(d.deliveries24h).not.toBeNull();
      const html = renderToStaticMarkup(createElement(MessagesTab, { t, d, when }));
      expect(html).toContain("Deliveries per day");
      expect(html).not.toContain("undefined");
    } finally { spy.mockRestore(); }
  });

  it("the tab draws: states in plain words, masked phones, the schedule, the numbers table", () => {
    const html = renderToStaticMarkup(createElement(MessagesTab, { t, d: msgs, when }));
    for (const w of ["WhatsApp deliveries, 24 hours", "Daily report", "Room report", "Sent", "Send failed", "Failed deliveries, 7 days", "Deliveries per day",
      "The last closed days: reports", "Failed or waiting deliveries", "•••• ", "Show the numbers", "data-stack", "Not sent", "Not made"]) {
      expect(html, w).toContain(w);
    }
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
    expect(html).not.toContain("255700000412");
  });
});

// ───────────────────────────────────────────── 6. the page ─────────────────────────────────────────────
describe("the Developer home draws every part on one page, in the owner's arrangement", () => {
  const draw = async (search: Record<string, string> = {}) => renderToStaticMarkup((await resolveAsync(await DeveloperHomePage({ searchParams: Promise.resolve(search) } as never))) as never);

  it("Activity, the business for awareness (Hotel, Money, Messages & requests), People & my actions, then The system — each part its own anchor, one under the other, no tabs and no jump row — counts only, nothing of the hotel's detail", async () => {
    await wipe();
    await as(dev);
    const html = await draw();
    const ids = ["activity", "hotel", "money", "requests", "people", "problems", "errors", "messages", "speed", "security", "settings"];
    for (const id of ids) expect(html, id).toContain(`id="${id}"`);
    const at = ids.map((id) => html.indexOf(`id="${id}"`));
    expect(at).toEqual([...at].sort((x, y) => x - y)); // in this order on the page
    expect(html).not.toContain('aria-label="Jump to"');
    expect(html).toContain("The business, for awareness");
    expect(html).toContain("The system");
    expect(html.indexOf("The business, for awareness")).toBeLessThan(html.indexOf('id="people"'));
    expect(html.indexOf('id="people"')).toBeLessThan(html.indexOf("The system"));
    for (const text of ["Bookings in the system", "Bills issued", "Messages sent (14 days)", "Rooms with a guest"]) expect(html, text).toContain(text);
    // the detail the owner rejected stays out: no lists of payments, no accounts' balances, no today's arrivals with names
    for (const text of ["What is happening in the hotel", "Where the money is", "Received today", "Money accounts", "The last payments", "Today&#x27;s arrivals"]) expect(html, text).not.toContain(text);
    for (const text of ["Is the Boss getting his reports and messages?", "Deliveries per day"]) expect(html, text).toContain(text);
    expect(html).toContain("Nothing yet");
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  }, 120_000);

  it("is read in Chinese by a Chinese-speaking Developer", async () => {
    await db.user.update({ where: { id: dev.id }, data: { preferredLanguage: "zh-CN" } });
    try {
      await as(dev);
      const html = await draw();
      for (const w of ["暂无", "老板是否收到了报告和消息？", "登录与安全", "错误与自动任务"]) expect(html, w).toContain(w);
      expect(html).not.toContain("Is the Boss getting his reports and messages?");
      expect(html).not.toContain("Sign-ins & security");
      expect(html).not.toContain("undefined");
      expect(html).not.toContain("NaN");
    } finally { await db.user.update({ where: { id: dev.id }, data: { preferredLanguage: "en" } }); }
  }, 120_000);

  it("a person who is not the Developer is sent to 'forbidden'", async () => {
    await as(rec);
    expect(await redirectOf(() => draw())).toBe("/staff/forbidden");
  });

  it("a look at Hotel, Money or Messages is written like a look at a Business tab: once in 10 minutes, apart from Business' own tabs", async () => {
    const user = await as(dev);
    const mine = () => db.auditLog.findMany({ where: { userId: dev.id, action: BUSINESS_VIEW_ACTION }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
    // a clean diary (the one maintenance path, inside a transaction)
    await db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT set_config('vegas.audit_maintenance', 'on', true)`);
      await tx.auditLog.deleteMany({ where: { userId: dev.id, action: BUSINESS_VIEW_ACTION } });
    });
    await draw(); await draw(); // twice: the refresh is not written again
    const rows = await mine();
    // the parts that show hotel data are written (Hotel, Money, Messages & reports, Messages & requests); the system parts are not
    expect(rows.map((r) => r.entityId).sort()).toEqual(["home:hotel", "home:messages", "home:money", "home:requests"]);
    for (const r of rows) {
      expect(r).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", entityType: "Business", action: "developer.business_viewed", actorLabel: dev.fullName });
      expect(r.after).toEqual({ tab: (r.entityId ?? "").replace("home:", ""), area: "home" });
    }
    expect(await mine()).toHaveLength(4);
    // Business' own Money tab is its own entry (it is not swallowed by the home's, and the home's is not swallowed by it)
    expect(await noteBusinessView(user, "money")).toBe("logged");
    expect((await mine()).map((r) => r.entityId).sort()).toEqual(["home:hotel", "home:messages", "home:money", "home:requests", "money"]);
    // the entry never counts as work
    const { NOT_WORK_ACTIONS } = await import("@/server/services/developer-console");
    expect(NOT_WORK_ACTIONS).toContain(BUSINESS_VIEW_ACTION);
  });

  it("a note that cannot be written never blocks the part", async () => {
    await as(dev);
    await db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(`SELECT set_config('vegas.audit_maintenance', 'on', true)`);
      await tx.auditLog.deleteMany({ where: { userId: dev.id, action: BUSINESS_VIEW_ACTION } });
    });
    const spy = vi.spyOn(db.auditLog, "findFirst").mockRejectedValue(new Error("diary down"));
    const logged = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      const html = await draw();
      expect(html).toContain("Is the Boss getting his reports and messages?");
    } finally { spy.mockRestore(); logged.mockRestore(); }
  });
});

// ───────────────────────────────────────────── 7. the charts' words ─────────────────────────────────────────────
describe("a chart's spoken summary and hover text name every part", () => {
  const series = [{ key: "cash", label: "Cash", color: "#111111" }, { key: "mobile", label: "Mobile money", color: "#222222" }];
  const columns = [
    { key: "a", tick: "9 Mar", name: "9 Mar", values: { cash: 10_000, mobile: 20_000 } },
    { key: "b", tick: "10 Mar", name: "10 Mar", values: { cash: -2_000, mobile: 0 } }, // a cash refund and nothing else
    { key: "c", tick: "11 Mar", name: "11 Mar", values: { cash: 0, mobile: 0 } },
  ];

  it("a refund is named, so a day that is only a refund does not read as nothing", () => {
    const html = renderToStaticMarkup(createElement(BarChart, { t, columns, series, caption: "Money received per day", empty: "Nothing", format: formatTZS, negative: "refund" }));
    expect(html).toContain('aria-label="Money received per day: 9 Mar TZS 30,000 (Cash TZS 10,000 · Mobile money TZS 20,000), 10 Mar TZS -2,000 (Cash refund TZS -2,000), 11 Mar TZS 0"');
    expect(html).toContain('title="10 Mar: TZS -2,000 — Cash refund TZS -2,000"');
    expect(html).toContain('title="9 Mar: TZS 30,000 — Cash TZS 10,000 · Mobile money TZS 20,000"');
  });

});
