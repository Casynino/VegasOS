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
import {
  BOOKING_REQUEST_STATUS_WORDS, GUEST_REQUEST_STATUS_WORDS, messageKindWords, requestsGlance, type RequestsGlance,
} from "@/server/services/developer-requests";
import { GUEST_MESSAGE_TYPES } from "@/lib/guest-messages";
import { RequestsGlanceTab } from "@/app/staff/(app)/developer/tab-requests";
import commonZh from "@/i18n/catalog/zh-CN/common";
import staffZh from "@/i18n/catalog/zh-CN/staff";
import requestsZh from "@/i18n/catalog/zh-CN/staff/developer-requests";
import { makeT } from "@/i18n/translate";
import { eat } from "../support/helpers";
import { browser, makeSession, makeUser, removeMadeUsers, thrownBy, type MadeUser } from "../support/developer";

/**
 * THE "MESSAGES & REQUESTS" PART of the Developer Home (owner, 2026-10-18), against a real database. Developer-only and read-only;
 * counts and plain words only. Every figure is compared with a direct count of the rows THIS file makes: the messages sit in a
 * far-away year (a window no other test file's rows reach), and the "all time" figures are compared with the database itself and
 * with the change they show when rows are added.
 */

const NOW = eat("2047-06-10T12:00:00");
const TODAY = "2047-06-10";
const SECRET = { guest: "Zzuxley Quuxbert", phone: "+255799424242", body: "ZZBODY-Kilimanjaro-secret-words", request: "ZZREQUEST-towels-under-the-bed", booking: "Zzbook Fernweh", bookingPhone: "+255788515151", special: "ZZSPECIAL-late-arrival-note" };

let dev: MadeUser, rec: MadeUser, boss: MadeUser, md: MadeUser, mgr: MadeUser, fin: MadeUser;
const as = async (u: MadeUser) => { browser.reset(); await makeSession(u.id); return (await getCurrentUser()) as CurrentUser; };

const made = { guests: [] as string[], messages: [] as string[], requests: [] as string[], bookings: [] as string[] };
const t = makeT("en", null);
const zhCatalog = { ...commonZh, ...staffZh, ...requestsZh };
const zh = makeT("zh-CN", zhCatalog);
const html = (g: RequestsGlance, tr = t) => renderToStaticMarkup(createElement(RequestsGlanceTab, { t: tr, g, when: (d: Date) => tr.dateTime(d, "Africa/Dar_es_Salaam") }));
const escape = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

const rowsOf = async () => ({
  messages: await db.guestMessage.count(), requests: await db.serviceRequest.count(), bookings: await db.bookingRequest.count(), audit: await db.auditLog.count(), guests: await db.guest.count(),
});

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Requests Dev" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Asha Requests" });
  boss = await makeUser("OWNER", { fullName: "Boss Requests" });
  md = await makeUser("ADMIN", { fullName: "MD Requests" });
  mgr = await makeUser("MANAGER", { fullName: "Manager Requests" });
  fin = await makeUser("FINANCE", { fullName: "Finance Requests" });
});
afterAll(async () => {
  browser.reset();
  vi.restoreAllMocks();
  await db.guestMessage.deleteMany({ where: { id: { in: made.messages } } }).catch(() => undefined);
  await db.serviceRequest.deleteMany({ where: { id: { in: made.requests } } }).catch(() => undefined);
  await db.bookingRequest.deleteMany({ where: { id: { in: made.bookings } } }).catch(() => undefined);
  await db.guest.deleteMany({ where: { id: { in: made.guests } } }).catch(() => undefined);
  await removeMadeUsers();
});

async function addMessages() {
  const guest = await db.guest.create({ data: { fullName: SECRET.guest, phone: SECRET.phone } });
  made.guests.push(guest.id);
  const put = async (at: string, type: string, status: "SENT" | "FAILED") => {
    const m = await db.guestMessage.create({ data: { guestId: guest.id, type, channel: "WHATSAPP", to: SECRET.phone, body: `${SECRET.body} ${type}`, status, error: status === "FAILED" ? "provider said no" : null, createdAt: eat(at) } });
    made.messages.push(m.id);
  };
  // In the 14 hotel days (05-28 04:00 → 06-10 end): sent 6, failed 1.
  await put("2047-06-10T10:00:00", "BOOKING_CONFIRMED", "SENT");
  await put("2047-06-10T11:00:00", "BOOKING_CONFIRMED", "SENT");
  await put("2047-06-09T03:59:00", "WELCOME", "SENT"); // before 04:00: still the hotel day of 8 June
  await put("2047-06-09T04:01:00", "WELCOME", "SENT"); // after 04:00: the hotel day of 9 June
  await put("2047-06-05T09:00:00", "THANK_YOU", "FAILED");
  await put("2047-06-05T09:30:00", "BOOKING_CONFIRMED", "SENT");
  await put("2047-05-29T08:00:00", "PAYMENT_FAILED", "SENT"); // a kind the list does not name
  // Older than 14 days but inside 30, and older than 30.
  await put("2047-05-20T08:00:00", "BOOKING_REMINDER", "SENT");
  await put("2047-05-20T09:00:00", "not a code!", "SENT");
  await put("2047-04-01T08:00:00", "BOOKING_CONFIRMED", "SENT");
}

async function addRequests() {
  const source = await db.bookingSource.findFirstOrThrow();
  const type = await db.roomType.findFirstOrThrow();
  const day = new Date(`${TODAY}T00:00:00Z`);
  const ask = async (status: "NEW" | "ASSIGNED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED", from: "GUEST_LINK" | "ROOM_QR" | "STAFF") => {
    const r = await db.serviceRequest.create({ data: { type: "TOWELS", description: `${SECRET.request} ${status}`, status, source: from, businessDate: day } });
    made.requests.push(r.id);
  };
  await ask("NEW", "GUEST_LINK");
  await ask("NEW", "ROOM_QR");
  await ask("ASSIGNED", "STAFF");
  await ask("IN_PROGRESS", "ROOM_QR");
  await ask("COMPLETED", "STAFF");
  await ask("CANCELLED", "GUEST_LINK");
  let n = 0;
  const book = async (status: "NEW" | "REVIEWING" | "CONVERTED" | "REJECTED") => {
    n += 1;
    const r = await db.bookingRequest.create({
      data: {
        reference: `VLH-REQ-T${status.slice(0, 2)}${n}${Date.now() % 100000}`, manageToken: `tok-${status}-${n}-${Date.now()}`, status, sourceId: source.id, fullName: SECRET.booking, phone: SECRET.bookingPhone,
        checkInDate: new Date("2047-07-01T00:00:00Z"), checkOutDate: new Date("2047-07-03T00:00:00Z"), roomTypeId: type.id, specialRequests: SECRET.special, businessDate: day,
      },
    });
    made.bookings.push(r.id);
  };
  await book("NEW");
  await book("REVIEWING");
  await book("CONVERTED");
  await book("REJECTED");
}

describe("the door: the Developer account only, and not while working as someone", () => {
  it.each([["receptionist", () => rec], ["Boss", () => boss], ["MD", () => md], ["manager", () => mgr], ["Finance", () => fin]])("the %s is refused", async (_n, who) => {
    const e = await thrownBy(async () => requestsGlance(await as(who()), NOW));
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe("FORBIDDEN");
  });

  it("the Developer reads it — but not while working as another person", async () => {
    const user = await as(dev);
    expect((await requestsGlance(user, NOW)).days).toHaveLength(14);
    const e = await thrownBy(() => requestsGlance({ ...user, workAs: { id: "someone" } } as never, NOW));
    expect(e).toBeInstanceOf(AppError);
    expect((e as AppError).code).toBe("FORBIDDEN");
  });
});

describe("the figures equal the rows", () => {
  it("messages: the card, the days and the kinds are the rows, on the hotel's day (04:00 → 04:00)", async () => {
    await addMessages();
    const g = await requestsGlance(await as(dev), NOW);
    expect(g.today).toBe(TODAY);
    expect(g.dayStart).toBe("04:00");
    expect(g.days[0]).toBe("2047-05-28");
    expect(g.days[13]).toBe(TODAY);

    // the card = the rows of the 14 days (the two older ones are not in it)
    expect(g.cards.messages).toEqual({ sent: 6, failed: 1 });
    const direct = await db.guestMessage.count({ where: { status: "SENT", createdAt: { gte: eat("2047-05-28T04:00:00"), lt: eat("2047-06-11T04:00:00") } } });
    expect(g.cards.messages!.sent).toBe(direct);

    // per day: the chart adds up to the card, and the 04:00 edge puts a message on the right day
    const perDay = Object.fromEntries(g.messagesPerDay!.map((d) => [d.date, d]));
    expect(g.messagesPerDay).toHaveLength(14);
    expect(g.messagesPerDay!.reduce((n, d) => n + d.sent, 0)).toBe(6);
    expect(g.messagesPerDay!.reduce((n, d) => n + d.failed, 0)).toBe(1);
    expect(perDay["2047-06-10"]).toMatchObject({ sent: 2, failed: 0 });
    expect(perDay["2047-06-09"]).toMatchObject({ sent: 1, failed: 0 }); // 04:01
    expect(perDay["2047-06-08"]).toMatchObject({ sent: 1, failed: 0 }); // 03:59 of the 9th belongs to the 8th
    expect(perDay["2047-06-05"]).toMatchObject({ sent: 1, failed: 1 });
    expect(perDay["2047-05-29"]).toMatchObject({ sent: 1, failed: 0 });

    // by kind, last 30 days: plain words, the failed ones counted apart, nothing older than 30 days, nothing raw
    const kinds = Object.fromEntries(g.messageKinds!.map((k) => [k.label, k]));
    expect(kinds["Booking confirmed"]).toEqual({ label: "Booking confirmed", count: 3, failed: 0 });
    expect(kinds["Welcome / check-in"]).toMatchObject({ count: 2, failed: 0 });
    expect(kinds["Thank-you note"]).toMatchObject({ count: 1, failed: 1 });
    expect(kinds["Arrival reminder"]).toMatchObject({ count: 1 });
    expect(kinds["Payment failed"]).toMatchObject({ count: 1 }); // an unnamed code, spread into words
    expect(kinds["Other"]).toMatchObject({ count: 1 }); // text that is not a code is never shown
    expect(g.messageKinds!.reduce((n, k) => n + k.count, 0)).toBe(9); // 10 rows, one is 70 days old
    const counts = g.messageKinds!.map((k) => k.count);
    expect([...counts].sort((a, b) => b - a)).toEqual(counts); // biggest first
    expect(JSON.stringify(g)).not.toContain("not a code");
  });

  it("requests: every figure is the database's own count, and rows added show as exactly that change", async () => {
    const before = await requestsGlance(await as(dev), NOW);
    await addRequests();
    const g = await requestsGlance(await as(dev), NOW);

    // the database's own counts
    const total = await db.serviceRequest.count();
    const fromPhone = await db.serviceRequest.count({ where: { source: { in: ["GUEST_LINK", "ROOM_QR"] } } });
    const open = await db.serviceRequest.count({ where: { status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS"] } } });
    expect(g.cards.guestRequests).toEqual({ total, fromPhone, open });
    const bookingTotal = await db.bookingRequest.count();
    const bookingOpen = await db.bookingRequest.count({ where: { status: { in: ["NEW", "REVIEWING", "CONTACTED", "CONFIRMED"] } } });
    expect(g.cards.bookingRequests).toEqual({ total: bookingTotal, open: bookingOpen });
    expect(g.cards.waiting).toEqual({
      guestRequests: await db.serviceRequest.count({ where: { status: { in: ["NEW", "ASSIGNED"] } } }),
      bookingRequests: await db.bookingRequest.count({ where: { status: "NEW" } }),
      total: expect.any(Number),
    });
    expect(g.cards.waiting!.total).toBe(g.cards.waiting!.guestRequests + g.cards.waiting!.bookingRequests);

    // the change: six guest requests (4 from a phone, 4 open, 3 waiting) and four booking requests (2 open, 1 waiting)
    expect(g.cards.guestRequests!.total - before.cards.guestRequests!.total).toBe(6);
    expect(g.cards.guestRequests!.fromPhone - before.cards.guestRequests!.fromPhone).toBe(4);
    expect(g.cards.guestRequests!.open - before.cards.guestRequests!.open).toBe(4);
    expect(g.cards.waiting!.guestRequests - before.cards.waiting!.guestRequests).toBe(3);
    expect(g.cards.bookingRequests!.total - before.cards.bookingRequests!.total).toBe(4);
    expect(g.cards.bookingRequests!.open - before.cards.bookingRequests!.open).toBe(2);
    expect(g.cards.waiting!.bookingRequests - before.cards.waiting!.bookingRequests).toBe(1);

    // by status: plain words, each the database's count, adding up to the card, biggest first, none with nothing in it
    const word = (rows: { status: string; label: string; count: number }[] | null) => Object.fromEntries(rows!.map((r) => [r.status, r]));
    const guest = word(g.guestRequestsByStatus);
    for (const status of ["NEW", "ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"] as const) {
      expect(guest[status]?.count ?? 0).toBe(await db.serviceRequest.count({ where: { status } }));
      expect(guest[status]?.label ?? GUEST_REQUEST_STATUS_WORDS[status]).toBe(GUEST_REQUEST_STATUS_WORDS[status]);
    }
    expect(g.guestRequestsByStatus!.reduce((n, r) => n + r.count, 0)).toBe(total);
    expect(guest.IN_PROGRESS.label).toBe("Accepted");
    const book = word(g.bookingRequestsByStatus);
    for (const status of ["NEW", "REVIEWING", "CONTACTED", "CONFIRMED", "CONVERTED", "REJECTED", "CANCELLED"] as const) {
      expect(book[status]?.count ?? 0).toBe(await db.bookingRequest.count({ where: { status } }));
    }
    expect(g.bookingRequestsByStatus!.reduce((n, r) => n + r.count, 0)).toBe(bookingTotal);
    expect(book.CONVERTED.label).toBe("Made into a booking");
    for (const rows of [g.guestRequestsByStatus!, g.bookingRequestsByStatus!]) {
      const counts = rows.map((r) => r.count);
      expect([...counts].sort((a, b) => b - a)).toEqual(counts);
      expect(counts.every((c) => c > 0)).toBe(true);
    }
  });

  it("a kind the list does not name is spread into words, and anything that is not a code is just 'Other'", () => {
    for (const [code, words] of Object.entries(GUEST_MESSAGE_TYPES)) expect(messageKindWords(code)).toBe(words);
    expect(messageKindWords("PAYMENT_FAILED")).toBe("Payment failed");
    expect(messageKindWords("SOMETHING_NEW")).toBe("Something new");
    expect(messageKindWords("")).toBe("Other");
    expect(messageKindWords("Hello guest, your room is 12")).toBe("Other");
    expect(messageKindWords("constructor")).toBe("Other");
    expect(messageKindWords("A".repeat(60))).toBe("Other");
  });
});

describe("nothing personal, nothing changed", () => {
  it("no guest name, phone, message words or request words in the data or the page — and reading it changes no row", async () => {
    const user = await as(dev);
    const before = await rowsOf();
    const g = await requestsGlance(user, NOW);
    const page = html(g) + html(g, zh);
    const after = await rowsOf();
    expect(after).toEqual(before); // no message, request, booking request, guest or audit row was written
    for (const word of [SECRET.guest, SECRET.phone, SECRET.body, SECRET.request, SECRET.booking, SECRET.bookingPhone, SECRET.special, "Zzuxley", "Kilimanjaro", "provider said no", "799424242", "788515151"]) {
      expect(JSON.stringify(g)).not.toContain(word);
      expect(page).not.toContain(word);
    }
    expect(JSON.stringify(g)).not.toMatch(/TZS|amount|balance|password|secret/i);
  });
});

describe("one failed question leaves the rest", () => {
  it("a message count that fails leaves that card empty and everything else drawn; the page says it could not be read", async () => {
    const spy = vi.spyOn(db.guestMessage, "count").mockRejectedValue(new Error("db down"));
    try {
      const g = await requestsGlance(await as(dev), NOW);
      expect(g.cards.messages).toBeNull();
      expect(g.cards.guestRequests).not.toBeNull();
      expect(g.cards.bookingRequests).not.toBeNull();
      expect(g.messagesPerDay).not.toBeNull();
      expect(g.messageKinds).not.toBeNull();
      const page = html(g);
      expect(page).toContain("This could not be read just now.");
      expect(page).not.toMatch(/undefined|NaN/);
    } finally { spy.mockRestore(); }
  });

  it("requests that fail leave the messages, and the other way round", async () => {
    const user = await as(dev);
    const a = vi.spyOn(db.serviceRequest, "groupBy").mockRejectedValue(new Error("db down"));
    const b = vi.spyOn(db.guestMessage, "groupBy").mockRejectedValue(new Error("db down"));
    try {
      const g = await requestsGlance(user, NOW);
      expect(g.cards.guestRequests).toBeNull();
      expect(g.guestRequestsByStatus).toBeNull();
      expect(g.messageKinds).toBeNull();
      expect(g.cards.messages).not.toBeNull();
      expect(g.bookingRequestsByStatus).not.toBeNull();
      expect(g.cards.waiting).not.toBeNull();
      const page = html(g) + html(g, zh);
      expect(page).not.toMatch(/undefined|NaN/);
      expect(page).toContain("无法读取"); // the Chinese page says it too (whatever the catalog's exact wording)
    } finally { a.mockRestore(); b.mockRestore(); }
  });
});

describe("the page", () => {
  const empty: RequestsGlance = {
    today: TODAY, dayStart: "04:00", days: [], cards: { messages: { sent: 0, failed: 0 }, waiting: { guestRequests: 0, bookingRequests: 0, total: 0 }, guestRequests: { total: 0, fromPhone: 0, open: 0 }, bookingRequests: { total: 0, open: 0 } },
    messagesPerDay: Array.from({ length: 14 }, (_, i) => ({ date: `2047-06-${String(i + 1).padStart(2, "0")}`, sent: 0, failed: 0 })), messageKinds: [], guestRequestsByStatus: [], bookingRequestsByStatus: [],
  };

  it("shows the four figures and the four panels in order, in English", async () => {
    const g = await requestsGlance(await as(dev), NOW);
    const page = html(g);
    const order = ["Messages sent (14 days)", "Waiting for staff", "Guest requests", "Booking requests", "Messages to guests per day", "What the messages were", "Guest requests by status", "Booking requests by status"];
    let at = -1;
    for (const s of order) {
      const i = page.indexOf(escape(s), at + 1);
      expect(i, s).toBeGreaterThan(at);
      at = i;
    }
    for (const s of ["to guests", "Outbound", "Inbox", "All time", "Last 14 days, Tanzania time.", "By kind, last 30 days.", "Every request ever raised, by where it stands.", "People asking to book from the website, by where the request stands.", "Booking confirmed", "Welcome / check-in", "Given to someone", "Made into a booking"]) {
      expect(page, s).toContain(escape(s));
    }
    expect(page).toMatch(/\d+ asked from the guest(&#x27;|')s phone/);
    expect(page).toMatch(/\d+ still open/);
    expect(page).not.toMatch(/undefined|NaN/);
    // read-only: nothing to press, nothing to type into
    expect(page).not.toMatch(/<(button|form|input|textarea|select)\b/);
    expect(page).not.toMatch(/sparkle/i);
  });

  it("is in Chinese with no English left over, and no undefined / NaN", async () => {
    const g = await requestsGlance(await as(dev), NOW);
    const page = html(g, zh);
    expect(page).not.toMatch(/undefined|NaN/);
    expect(page).toContain("已发消息（14 天）");
    expect(page).toContain("等待员工处理");
    expect(page).toContain("已转为预订");
    // every plain sentence of the part is translated — none shows in English
    for (const s of ["Messages sent (14 days)", "Waiting for staff", "Outbound", "Inbox", "Messages to guests per day", "What the messages were", "By kind, last 30 days.", "Guest requests by status", "Booking requests by status",
      "Every request ever raised, by where it stands.", "People asking to book from the website, by where the request stands.", "Booking confirmed", "Welcome / check-in", "Given to someone", "Made into a booking", "Accepted", "Being reviewed", "Last 14 days, Tanzania time.", "Sent", "Failed"]) {
      expect(page, s).not.toContain(escape(s));
    }
  });

  it("the Chinese file has every string of the part, with the same {placeholders} as the English", () => {
    const keys = [
      "Messages & requests", "What guests ask for and are told. Reception's work, not yours.", "Messages sent (14 days)", "to guests", "Outbound", "Waiting for staff", "nobody has taken them yet", "Inbox",
      "{n} asked from the guest's phone", "{n} still open", "Messages to guests per day", "No messages sent in 14 days.", "What the messages were", "By kind, last 30 days.", "No messages in 30 days.",
      "Guest requests by status", "Every request ever raised, by where it stands.", "Booking requests by status", "People asking to book from the website, by where the request stands.",
      ...Object.values(GUEST_REQUEST_STATUS_WORDS), ...Object.values(BOOKING_REQUEST_STATUS_WORDS), "Guest requests", "Booking requests", "All time", "Sent", "Failed", "No requests yet.", "This could not be read just now.", "{n} failed",
    ];
    for (const k of keys) expect(zh.has(k), k).toBe(true);
    const slots = (s: string) => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort().join(",");
    for (const [en, cn] of Object.entries(requestsZh)) {
      expect(cn.length, en).toBeGreaterThan(0);
      expect(slots(cn), en).toBe(slots(en));
    }
    // the plain words of the message kinds are translated too
    for (const words of Object.values(GUEST_MESSAGE_TYPES)) expect(zh.has(words), words).toBe(true);
  });

  it("empty states say what is empty, in both languages", () => {
    const en = html(empty);
    for (const s of ["No messages sent in 14 days.", "No messages in 30 days.", "No requests yet."]) expect(en, s).toContain(s);
    expect(en).not.toMatch(/undefined|NaN/);
    const cn = html(empty, zh);
    expect(cn).toContain("14 天内没有发出消息。");
    expect(cn).toContain("30 天内没有消息。");
    expect(cn).toContain("暂无申请。");
    expect(cn).not.toMatch(/undefined|NaN/);
  });

  it("a part that could not be read says so instead of drawing a zero", () => {
    const unreadable: RequestsGlance = { ...empty, cards: { messages: null, waiting: null, guestRequests: null, bookingRequests: null }, messagesPerDay: null, messageKinds: null, guestRequestsByStatus: null, bookingRequestsByStatus: null };
    const page = html(unreadable);
    expect(page.match(/This could not be read just now\./g)!.length).toBeGreaterThanOrEqual(8);
    expect(page).not.toMatch(/undefined|NaN/);
    expect(page).toContain("—");
    expect(page).not.toContain("No requests yet.");
  });
});
