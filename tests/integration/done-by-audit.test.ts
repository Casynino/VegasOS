import { createElement, type FunctionComponent, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), after: () => undefined }));
// The Boss's WhatsApp notice: captured, never sent.
vi.mock("@/server/services/report-delivery", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), tellBossSoon: vi.fn() }));

import { db, rawDb } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { DEFAULT_ROLES } from "@/lib/permissions";
import { sha256 } from "@/server/work-as-session";
import { tellBossSoon } from "@/server/services/report-delivery";
import { cancelCheckIn, checkIn, createReservation, checkInCancelledText } from "@/server/services/reservations";
import { bookingTimeline, financeHistory, groupTimeline } from "@/server/services/finance-history";
import { guestTimeline } from "@/server/services/guest-comms";
import { hotelQrHistory } from "@/server/services/booking-qr";
import { buildReport } from "@/server/services/reports";
import { commandCenter } from "@/server/services/command-center";
import { queryAuditTrail, type AuditFilter, type AuditRow, type AuditViewer } from "@/server/services/audit-trail";
import { loadActivity } from "@/app/staff/(app)/activity/data";
import { AuditList } from "@/app/staff/(app)/audit/audit-rows";
import { ActedAsLine, AuditDetail } from "@/app/staff/(app)/activity/audit-detail";
import { I18nProvider } from "@/i18n/client";
import type { Catalog } from "@/i18n/translate";
import type { Locale } from "@/i18n/config";
import { DoneByDeveloper } from "@/components/staff/done-by-developer";
import { lineWho, actedAsName } from "@/lib/audit-line-who";
import { addDays, businessDateOf, toDbDate } from "@/lib/time/business-date";
import { englishT, makeT } from "@/i18n/translate";
import zhFixes from "@/i18n/catalog/zh-CN/staff/developer-fixes";
import zhAudit from "@/i18n/catalog/zh-CN/staff/done-by-audit";
import { managerActor, resetBusinessData, roomType } from "../support/helpers";
import { browser, makeSession, makeUser, removeMadeUsers, type MadeUser } from "../support/developer";

/**
 * "DONE BY DEVELOPER" on the lines that are made from the AUDIT TRAIL (owner, 2026-10-18: "if he opens admin and does an activity it should
 * show the Developer did it, just like the others"). The audit row is the mark: a Developer working as Neema is stored as the DEVELOPER, with the
 * label "Nino (Developer) as Neema (Receptionist)" and after.actingAs. Every list below must (1) name the Developer, the WHOLE label, never cut at the
 * bracket, (2) carry the words of the small tag beside the name, (3) leave a plain staff line exactly as it was.
 * Rows are made directly (the remap that writes them is proved in developer-workas.test.ts), except two flows that run through the real
 * work-as session: cancelling a check-in, and the booking's history.
 */

const TZ = "Africa/Dar_es_Salaam";
const DAY = "2041-05-05";
const AT = (minutes: number) => new Date(Date.UTC(2041, 4, 5, 9, 0) + minutes * 60_000);
const LABEL = "Nino (Developer) as Neema (Receptionist)";
const AS_NAME = { id: "u-neema", name: "Neema", role: "Receptionist" };
const TAG = "Done by Developer · as Neema";
const zh = makeT("zh-CN", { ...zhFixes, ...zhAudit, Receptionist: "前台" });
const BOSS: AuditViewer = { permissions: new Set<string>(DEFAULT_ROLES.OWNER.permissions) };

let devUser: MadeUser;
let rec: MadeUser;
let mgr: MadeUser;
let seq = 0;
const uid = () => `da-${Date.now().toString(36)}-${++seq}-${Math.random().toString(36).slice(2, 8)}`;

beforeAll(async () => {
  await resetBusinessData();
  [devUser, rec, mgr] = await Promise.all([
    makeUser("DEVELOPER", { fullName: "Dev Done By" }), makeUser("RECEPTIONIST", { fullName: "Neema Reception" }), makeUser("MANAGER", { fullName: "Mosi Manager" }),
  ]);
});
afterAll(async () => {
  browser.reset(); // no work-as left in the browser: removing accounts is exactly what the fence forbids while working as someone
  await rawDb.session.deleteMany({ where: { userId: { in: [devUser.id, rec.id, mgr.id] } } });
  await resetBusinessData();
  await removeMadeUsers();
});
beforeEach(() => {
  vi.mocked(tellBossSoon).mockClear();
  browser.reset();
});

/** A Developer's entry written while working as Neema (as audit() writes it). */
const devRow = (entityType: string, entityId: string, action: string, over: Record<string, unknown> = {}) => db.auditLog.create({
  data: {
    entityType, entityId, action, actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: LABEL, userId: devUser.id,
    after: { actingAs: AS_NAME }, businessDate: toDbDate(DAY), createdAt: AT(seq++), ...over,
  } as never,
});
/** A staff member's entry: the account's own name (and the role in brackets when only a label is written). */
const staffRow = (entityType: string, entityId: string, action: string, over: Record<string, unknown> = {}) => db.auditLog.create({
  data: {
    entityType, entityId, action, actorType: "STAFF", actorRole: "RECEPTIONIST", actorLabel: rec.fullName, userId: rec.id,
    after: null, businessDate: toDbDate(DAY), createdAt: AT(seq++), ...over,
  } as never,
});
const text = (x: unknown) => JSON.stringify(x);

// ───────────────────────────────────── the shared words ─────────────────────────────────────
describe("who an audit line says did it, and the tag beside the name", () => {
  it("a Developer working as someone: the whole label and the tag; in English and in Chinese", () => {
    const r = lineWho(englishT, { actorType: "DEVELOPER", actorLabel: LABEL, after: { actingAs: AS_NAME }, user: { fullName: "Nino" } });
    expect(r).toEqual({ name: LABEL, developer: true, asName: "Neema", as: "Neema (Receptionist)", doneBy: TAG });
    const cn = lineWho(zh, { actorType: "DEVELOPER", actorLabel: LABEL, after: { actingAs: AS_NAME } });
    expect(cn.doneBy).toBe("由开发者操作 · 以 Neema 的身份");
    expect(cn.name).toBe(LABEL);
  });

  it("the brackets are never cut from a Developer's line, even where a staff name loses its role", () => {
    expect(lineWho(englishT, { actorType: "DEVELOPER", actorLabel: LABEL }, { plain: true }).name).toBe(LABEL);
    expect(lineWho(englishT, { actorType: "STAFF", actorLabel: "Neema (Receptionist)" }, { plain: true }).name).toBe("Neema");
    expect(lineWho(englishT, { actorType: "STAFF", actorLabel: "Neema (Receptionist)" }).name).toBe("Neema (Receptionist)");
    expect(lineWho(englishT, { actorType: "STAFF", actorLabel: "x", user: { fullName: "Neema Reception" } }).name).toBe("Neema Reception");
  });

  it("no tag for anyone else: staff, the system, the website, the Developer on his own account, a row with no label", () => {
    for (const row of [
      { actorType: "STAFF", actorLabel: "Neema", after: null }, { actorType: "SYSTEM", actorLabel: "system" }, { actorType: "WEBSITE", actorLabel: "website" },
      { actorType: "DEVELOPER", actorLabel: "Nino", after: null }, { actorType: "DEVELOPER", actorLabel: null }, {},
    ]) expect(lineWho(englishT, row).doneBy, text(row)).toBeNull();
    expect(lineWho(englishT, { actorType: "DEVELOPER", actorLabel: "Nino" }).name).toBe("Nino (Developer)");
    expect(lineWho(englishT, {}).name).toBeNull();
  });

  it("who he acted as comes from after.actingAs, else from the label; junk is ignored", () => {
    expect(actedAsName({ actingAs: { name: " Asha ", id: "x" } }, LABEL)).toBe("Asha");
    expect(actedAsName({ actingAs: "nope" }, LABEL)).toBe("Neema");
    expect(actedAsName(null, "Nino (Developer) as Neema Tarimo (Front Desk Receptionist)")).toBe("Neema Tarimo");
    expect(actedAsName(null, "Nino")).toBeNull();
    expect(actedAsName([1, 2], undefined)).toBeNull();
  });

  it("the tag is the one small component, with the words it was given", () => {
    const html = renderToStaticMarkup(createElement(DoneByDeveloper, { text: TAG }));
    expect(html).toContain(TAG);
    expect(html).not.toMatch(/undefined|NaN/);
  });
});

// ───────────────────────────────────── the Boss's Audit page ─────────────────────────────────────
describe("the Boss's Audit page", () => {
  const MOD = "DaAuditMod";
  const filter: AuditFilter = { actor: "ALL", userId: "", action: "", module: MOD, from: DAY, to: DAY, page: 1 };
  let rows: AuditRow[];
  const draw = (r: AuditRow[], t = makeT("en", null)) => renderToStaticMarkup(createElement(AuditList, { rows: r, t, timezone: TZ }));

  beforeAll(async () => {
    await devRow(MOD, "as-1", "da.as_neema");
    await devRow(MOD, "own-1", "da.own", { actorLabel: "Nino", after: null });
    await staffRow(MOD, "staff-1", "da.staff");
    rows = (await queryAuditTrail(BOSS, filter)).rows;
  });

  it("a Developer who worked as Neema: the whole name, the tag beside it, and 'Acted as' in the details", () => {
    const html = draw(rows);
    const one = html.split("data-entry").filter((x) => x.includes("da.as_neema"))[0];
    expect(one).toContain(LABEL);                                  // the whole label, not cut at the bracket
    expect(one).toContain(TAG);
    expect(one).toContain("Acted as");
    expect(one).toContain("Neema (Receptionist)");
    expect(one).toContain("data-actor-type=\"DEVELOPER\"");        // the badge stays
    expect(html).toContain("border-l-fuchsia-600");                // and the Boss page's own colour
  });

  it("the Developer on his own account and a staff member's line carry no tag and no 'Acted as'", () => {
    const html = draw(rows);
    for (const marker of ["da.own", "da.staff"]) {
      const one = html.split("data-entry").filter((x) => x.includes(marker))[0];
      expect(one, marker).toBeTruthy();
      expect(one, marker).not.toContain("Done by Developer");
      expect(one, marker).not.toContain("Acted as");
    }
    expect(html.split("data-entry").filter((x) => x.includes("da.staff"))[0]).toContain(rec.fullName);
  });

  it("in Chinese the tag and the fact are in Chinese; nothing says undefined or NaN", () => {
    const html = draw(rows, zh);
    expect(html).toContain("由开发者操作 · 以 Neema 的身份");
    expect(html).toContain("代为操作的对象");
    expect(html).toContain("Neema (前台)");
    expect(html).not.toMatch(/undefined|NaN/);
    expect(draw(rows)).not.toMatch(/undefined|NaN/);
  });
});

describe("the Activity page's rows and detail", () => {
  beforeAll(async () => {
    await devRow("DaActMod", "a1", "dacta.as_neema");
    await devRow("DaActMod", "a2", "dacta.own", { actorLabel: "Nino", after: null });
    await staffRow("DaActMod", "a3", "dacta.staff");
  });

  it("the Boss sees the Developer's whole label and who he acted as; own-account and staff rows are as before", async () => {
    const { rows, developers } = await loadActivity(BOSS, { from: DAY, to: DAY, area: "dacta", page: 1 });
    expect(developers).toBe(true);
    const by = (a: string) => rows.find((r) => r.action === a)!;
    expect(by("dacta.as_neema")).toMatchObject({ who: LABEL, actorType: "DEVELOPER", actedAs: { name: "Neema", role: "Receptionist" } });
    expect(by("dacta.own")).toMatchObject({ who: devUser.fullName, actedAs: null });
    expect(by("dacta.staff")).toMatchObject({ who: rec.fullName, actedAs: null });
  });

  it("a viewer who may not see Developer actions gets none of those rows (nothing leaks through the new field)", async () => {
    const manager: AuditViewer = { permissions: new Set<string>(DEFAULT_ROLES.MANAGER.permissions) };
    const { rows, developers } = await loadActivity(manager, { from: DAY, to: DAY, area: "dacta", page: 1 });
    expect(developers).toBe(false);
    expect(rows.map((r) => r.action)).toEqual(["dacta.staff"]);
    expect(text(rows)).not.toContain("Neema (Receptionist)");
  });

  it("the details dialog: the 'Acted as' line and the tag, with and without, in both languages (the dialog itself draws a button)", () => {
    const Provider = I18nProvider as FunctionComponent<{ locale: Locale; catalog: Catalog | null; children?: ReactNode }>;
    const line = (props: { actedAs?: string | null; doneBy?: string | null }, zhCn = false) => renderToStaticMarkup(
      zhCn ? createElement(Provider, { locale: "zh-CN", catalog: { ...zhFixes, ...zhAudit } }, createElement(ActedAsLine, props)) : createElement(ActedAsLine, props),
    );
    const en = line({ actedAs: "Neema (Receptionist)", doneBy: TAG });
    expect(en).toContain("Acted as");
    expect(en).toContain("Neema (Receptionist)");
    expect(en).toContain(TAG);
    const cn = line({ actedAs: "Neema (前台)", doneBy: "由开发者操作 · 以 Neema 的身份" }, true);
    expect(cn).toContain("代为操作的对象");
    expect(cn).toContain("由开发者操作 · 以 Neema 的身份");
    for (const none of [line({}), line({ actedAs: null, doneBy: null }), line({}, true)]) expect(none).toBe("");
    for (const html of [en, cn]) expect(html).not.toMatch(/undefined|NaN/);
    for (const props of [{ actedAs: "Neema (Receptionist)", doneBy: TAG }, { actedAs: null, doneBy: null }, {}]) {
      const html = renderToStaticMarkup(createElement(AuditDetail, { action: "dacta.x", before: null, after: { a: 1 }, ...props }));
      expect(html).toContain("<button");
      expect(html).not.toMatch(/undefined|NaN/);
    }
  });
});

// ───────────────────────────────────── booking, group and money history ─────────────────────────────────────
describe("the history of a booking, a group and Finance's edit history", () => {
  it("booking timeline: the Developer's line carries the whole label and the tag; a staff line is as before", async () => {
    const id = uid();
    await devRow("Reservation", id, "reservation.checked_in");
    await staffRow("Reservation", id, "reservation.checked_out");
    const items = await bookingTimeline(id);
    expect(items).toHaveLength(2);
    const d = items.find((i) => i.label.includes("checked the guest in"))!;
    const s = items.find((i) => i.label.includes("checked the guest out"))!;
    expect(d).toMatchObject({ who: LABEL, doneBy: TAG });
    expect(s).toMatchObject({ who: rec.fullName, doneBy: null });
  });

  it("group timeline: the same", async () => {
    const id = uid();
    await devRow("BookingGroup", id, "group.created");
    await staffRow("BookingGroup", id, "group.updated");
    const items = await groupTimeline(id);
    expect(items.find((i) => i.label.includes("created the group"))).toMatchObject({ who: LABEL, doneBy: TAG });
    expect(items.find((i) => i.label.includes("changed the group"))).toMatchObject({ who: rec.fullName, doneBy: null });
  });

  it("Finance's edit history: the Developer's line, a Developer on his own account, and a staff line", async () => {
    const asNeema = await devRow("Reservation", uid(), "reservation.cancelled");
    const own = await devRow("Reservation", uid(), "reservation.no_show", { actorLabel: "Nino", after: null });
    const staff = await staffRow("Reservation", uid(), "reservation.confirmed");
    const items = await financeHistory({ from: DAY, to: DAY, group: "bookings" });
    const by = (id: string) => items.find((i) => i.id === id)!;
    expect(by(asNeema.id)).toMatchObject({ who: LABEL, doneBy: TAG });
    expect(by(own.id)).toMatchObject({ who: "Nino (Developer)", doneBy: null });
    expect(by(staff.id)).toMatchObject({ who: rec.fullName, doneBy: null });
    // the search on the page finds the Developer's line by the person he acted as
    expect((await financeHistory({ from: DAY, to: DAY, group: "bookings", q: "Neema (Receptionist)" })).map((i) => i.id)).toContain(asNeema.id);
  });
});

// ───────────────────────────────────── the guest's history ─────────────────────────────────────
describe("a customer's history", () => {
  it("'details updated' and the billing lines name the Developer whole and carry the tag; staff lines lose only the role, as before", async () => {
    const guest = await db.guest.create({ data: { fullName: "Done By Guest" } });
    const order = await db.restaurantOrder.create({ data: { number: `ORD-DA-${uid()}`, type: "DINE_IN", settlement: "PAY_NOW", foodSubtotal: 5_000, drinksSubtotal: 0, total: 5_000, businessDate: toDbDate(DAY), guestId: guest.id } });
    await devRow("Guest", guest.id, "guest.updated", { createdAt: AT(1) });
    await staffRow("Guest", guest.id, "guest.updated", { createdAt: AT(2) });
    await devRow("RestaurantOrder", order.id, "restaurant_order.billing_changed", {
      createdAt: AT(30), before: { billing: "Restaurant" }, after: { actingAs: AS_NAME, billing: "Room 305", amount: 5_000, reason: "Guest asked" },
    });
    await staffRow("RestaurantOrder", order.id, "restaurant_order.billing_changed", {
      createdAt: AT(60), actorLabel: "Neema (Receptionist)", userId: null, before: { billing: "Room 305" }, after: { billing: "Restaurant", amount: 5_000, reason: "Paid at the desk" },
    });

    const { events } = await guestTimeline(guest.id);
    const changes = events.filter((e) => e.kind === "change");
    expect(changes.find((e) => e.detail === LABEL)).toMatchObject({ doneBy: TAG });
    expect(changes.find((e) => e.detail === rec.fullName)).toMatchObject({ doneBy: null });

    const billing = events.filter((e) => e.kind === "billing");
    expect(billing).toHaveLength(2);
    const dev = billing.find((e) => e.detail?.includes("Guest asked"))!;
    const staff = billing.find((e) => e.detail?.includes("Paid at the desk"))!;
    expect(dev.detail).toBe(`by ${LABEL} (Guest asked)`);  // never cut at the bracket
    expect(dev.doneBy).toBe(TAG);
    expect(staff.detail).toBe("by Neema (Paid at the desk)");  // a staff name loses its role, as it always did
    expect(staff.doneBy).toBeNull();
  });
});

// ───────────────────────────────────── the manager's alerts, the Hotel QR, the reports ─────────────────────────────────────
describe("alerts, the Hotel QR history and the reports", () => {
  it("the manager's alert 'order on another customer's room … by {name}' names the Developer whole", async () => {
    const today = businessDateOf(new Date());
    const t = await roomType("DOUBLE_DELUXE");
    const m = await managerActor();
    const r = await createReservation({
      sourceCode: "PHONE", guest: { fullName: "Room Owner Guest", phone: "0715100900" },
      stay: { kind: "overnight", arrivalDate: today, departureDate: addDays(today, 1) },
      rooms: [{ roomTypeId: t.id, roomId: t.rooms[5].id, adults: 1, children: 0 }],
    }, m);
    const order = await db.restaurantOrder.create({
      data: { number: `ORD-DA-${uid()}`, type: "ROOM_SERVICE", settlement: "ROOM", reservationId: r.id, roomNumber: t.rooms[5].number, foodSubtotal: 7_000, drinksSubtotal: 0, total: 7_000, businessDate: toDbDate(today), customerName: "Someone Else" },
    });
    const put = (label: string, type: string, over: Record<string, unknown> = {}) => db.auditLog.create({
      data: { entityType: "RestaurantOrder", entityId: order.id, action: "restaurant_order.charged_to_room", actorType: type, actorLabel: label, userId: type === "DEVELOPER" ? devUser.id : rec.id, businessDate: toDbDate(today), createdAt: new Date(), ...over } as never,
    });
    const alertOf = async () => {
      const c = await commandCenter({ today, now: new Date(), tablesWaiting: [], tables: { seated: 0, bill: 0, free: 0, total: 0 }, shiftOpen: null, expensesPending: { count: 0, amount: 0 }, reportTroubles: { daily: null, room: null } });
      return c.decisions.find((d) => d.id === `room-other-${order.id}`)!;
    };

    await put("Neema (Receptionist)", "STAFF", { after: { roomOfAnotherGuest: "Room Owner Guest", reason: "Guest said so" } });
    expect((await alertOf()).detail).toContain("by Neema Reception"); // the account's own name, as before
    await put(LABEL, "DEVELOPER", { createdAt: new Date(Date.now() + 5_000), after: { actingAs: AS_NAME, roomOfAnotherGuest: "Room Owner Guest", reason: "Guest said so" } });
    expect((await alertOf()).detail).toContain(`by ${LABEL}`);
    expect((await alertOf()).detail).not.toContain("by Nino ·");
  });

  it("the Hotel QR 'what was changed' list: the Developer's line is whole and tagged, a staff line keeps losing its role", async () => {
    const qr = uid();
    const a = await devRow("BookingQrCode", qr, "hotel_qr.created");
    const b = await staffRow("BookingQrCode", qr, "hotel_qr.renamed", { actorLabel: "Neema (Receptionist)", userId: null });
    const list = await hotelQrHistory(await managerActor(), 200);
    expect(list.find((h) => h.id === a.id)).toMatchObject({ by: LABEL, doneBy: TAG });
    expect(list.find((h) => h.id === b.id)).toMatchObject({ by: "Neema", doneBy: null });
  });

  it("Reports → Cancellations: 'items removed from orders' names the Developer whole, a staff name loses its role", async () => {
    const orderId = uid();
    const removed = (over: Record<string, unknown>) => ({ before: { item: "Beer @ 5000" }, after: { amount: 5_000, removed: 1, reason: "Wrong order" }, ...over });
    await devRow("RestaurantOrder", orderId, "restaurant_order.item_removed", removed({ after: { actingAs: AS_NAME, amount: 5_000, removed: 1, reason: "By Neema's account" } }));
    await staffRow("RestaurantOrder", orderId, "restaurant_order.item_removed", removed({ actorLabel: "Asha (Receptionist)", userId: null, after: { amount: 3_000, removed: 1, reason: "By staff" } }));
    const rep = await buildReport("voids", { from: DAY, to: DAY }, addDays(DAY, 1));
    const block = rep.blocks.find((b) => b.kind === "table" && b.title === "Items removed from orders");
    const rowsOf = (block && "rows" in block ? block.rows : []) as unknown[][];
    const dev = rowsOf.find((r) => r.includes("By Neema's account"))!;
    const staff = rowsOf.find((r) => r.includes("By staff"))!;
    expect(dev, text(rowsOf)).toBeTruthy();
    expect(dev).toContain(LABEL);
    expect(staff).toContain("Asha");
    expect(staff).not.toContain("Asha (Receptionist)");
  });
});

// ───────────────────────────────────── through the real work-as session ─────────────────────────────────────
describe("cancelling a check-in while working as the receptionist (the Boss's WhatsApp notice) and the booking's history", () => {
  const today = () => businessDateOf(new Date());
  async function devAs(target: MadeUser | null) {
    browser.reset();
    const token = await makeSession(devUser.id, { createdMinAgo: 1, seenMinAgo: 0 });
    if (target) await rawDb.session.update({ where: { tokenHash: sha256(token) }, data: { workAsUserId: target.id, workAsStartedAt: new Date(Date.now() - 60_000) } });
  }
  async function asStaff(u: MadeUser) {
    browser.reset();
    await makeSession(u.id, { createdMinAgo: 1, seenMinAgo: 0 });
  }
  async function actorOfSession() {
    const u = await getCurrentUser();
    if (!u) throw new Error("not signed in");
    return { userId: u.id, label: u.fullName, role: u.roleName, permissions: u.permissions as ReadonlySet<string> };
  }
  /** The text the Boss was sent for the last notice (the app hands the sender a function; here it is called with English). */
  const noticeText = () => {
    const calls = vi.mocked(tellBossSoon).mock.calls;
    const make = calls[calls.length - 1][0] as unknown as (t: typeof englishT, s: { hotelName: string; timezone: string }) => string;
    return make(englishT, { hotelName: "Vegas", timezone: TZ });
  };
  let n = 0;
  async function checkedIn() {
    if (!(await db.actualShift.count({ where: { userId: rec.id, endedAt: null } }))) {
      await db.actualShift.create({ data: { department: "RECEPTION", businessDate: toDbDate(today()), userId: rec.id, startedAt: new Date(Date.now() - 3_600_000) } });
    }
    const t = await roomType("DOUBLE_DELUXE");
    const r = await createReservation({
      sourceCode: "PHONE", guest: { fullName: `Notice Guest ${n}`, phone: `0715200${String(100 + n)}` },
      stay: { kind: "overnight", arrivalDate: today(), departureDate: addDays(today(), 1) },
      rooms: [{ roomTypeId: t.id, roomId: t.rooms[10 + n++].id, adults: 1, children: 0 }],
    }, await managerActor());
    await asStaff(rec);
    await checkIn(r.id, await actorOfSession(), null, new Date());
    return r;
  }

  it("the Developer cancelling as Neema: the notice says who really cancelled; the audit line and the booking history say it too", async () => {
    const r = await checkedIn();
    await devAs(rec);
    const done = await cancelCheckIn(r.id, await actorOfSession(), "Wrong guest at the desk");
    const role = (await db.user.findUniqueOrThrow({ where: { id: rec.id }, include: { role: true } })).role.name;
    const label = `${devUser.fullName} (Developer) as ${rec.fullName} (${role})`;
    expect(done.by).toBe(label);
    expect(noticeText()).toContain(`Cancelled by: ${label} ·`);
    expect(checkInCancelledText(done, englishT, "Vegas", TZ)).toContain(label);

    const row = await db.auditLog.findFirstOrThrow({ where: { entityId: r.id, action: "reservation.checkin_cancelled" } });
    expect(row).toMatchObject({ actorType: "DEVELOPER", actorLabel: label, userId: devUser.id });
    const line = (await bookingTimeline(r.id)).find((i) => i.label.includes("cancelled the check-in"))!;
    expect(line).toMatchObject({ who: label, doneBy: `Done by Developer · as ${rec.fullName}` });
    // the other lines of the same booking (made by the Manager, checked in by Neema) are untouched
    const others = (await bookingTimeline(r.id)).filter((i) => !i.label.includes("cancelled the check-in"));
    expect(others.length).toBeGreaterThan(1);
    expect(others.every((i) => i.doneBy === null && !i.who.includes("(Developer)"))).toBe(true);
  });

  it("Neema cancelling it herself, and the Developer on his own account: the notice is as it was", async () => {
    const own = await checkedIn();
    await asStaff(rec);
    expect((await cancelCheckIn(own.id, await actorOfSession(), "Wrong guest at the desk")).by).toBe(rec.fullName);
    expect(noticeText()).toContain(`Cancelled by: ${rec.fullName} ·`);

    const dev = await checkedIn();
    await devAs(null);
    const done = await cancelCheckIn(dev.id, await actorOfSession(), "Wrong guest at the desk");
    expect(done.by).toBe(devUser.fullName);
    expect(noticeText()).toContain(`Cancelled by: ${devUser.fullName} ·`);
    expect(noticeText()).not.toContain("as Nino");
  });
});
