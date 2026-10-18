import { createElement, isValidElement, type FunctionComponent, type ReactElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return {
    redirect: m.redirectMock, notFound: () => { throw new Error("NOT_FOUND"); },
    useRouter: () => ({ refresh() {}, push() {}, replace() {}, back() {}, prefetch() {} }), usePathname: () => "/", useSearchParams: () => new URLSearchParams(),
  };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn(), revalidateTag: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), after: () => undefined }));
// The signed-in person for pages and actions: a manager who may see everything (what is under test is the line, not the permission).
const signedIn = vi.hoisted(() => ({ user: null as unknown }));
vi.mock("@/server/auth", async (importOriginal) => ({
  ...(await importOriginal<Record<string, unknown>>()),
  requirePagePermission: vi.fn(async () => signedIn.user),
  authorize: vi.fn(async () => signedIn.user),
}));

import { db } from "@/server/db";
import { ALL_PERMISSIONS } from "@/lib/permissions";
import { checkIn, createReservation } from "@/server/services/reservations";
import { roomControl, type RoomEvent } from "@/server/services/room-control";
import { generateThankYouNote } from "@/server/services/thank-you";
import { getArrivalsSummary } from "@/server/services/front-desk";
import { saveDailyListCopy, withDoneBy } from "@/server/services/daily-lists";
import { createGroupBooking } from "@/server/services/groups";
import { createRestaurantOrder } from "@/server/services/restaurant";
import { createServiceRequest, acceptServiceRequest, updateServiceRequest } from "@/server/services/requests";
import { roomHistoryAction } from "@/app/staff/(app)/rooms/actions";
import ReservationPage from "@/app/staff/(app)/reservations/[id]/page";
import ThankYouPage from "@/app/staff/(app)/reservations/[id]/thank-you/page";
import RoomPage from "@/app/staff/(app)/rooms/[id]/page";
import GroupPage from "@/app/staff/(app)/groups/[id]/page";
import RequestsPage from "@/app/staff/(app)/requests/page";
import DailyListPage from "@/app/staff/(app)/lists/[kind]/page";
import { ArrivalsSummary } from "@/components/staff/reception/arrivals-summary";
import { RequestCard, type RequestView } from "@/app/staff/(app)/requests/request-forms";
import { ListWorkspace } from "@/components/staff/lists/list-workspace";
import { StatusChangeList } from "@/components/staff/rooms/room-panels";
import { I18nProvider } from "@/i18n/client";
import type { Catalog } from "@/i18n/translate";
import type { Locale } from "@/i18n/config";
import { DoneByDeveloper } from "@/components/staff/done-by-developer";
import { addDays, businessDateOf, toDbDate, zonedInstant } from "@/lib/time/business-date";
import { makeT } from "@/i18n/translate";
import zhFixes from "@/i18n/catalog/zh-CN/staff/developer-fixes";
import { managerActor, receptionistActor, resetBusinessData, roomType } from "../support/helpers";
import { browser, resolveAsync } from "../support/developer";

/**
 * "DONE BY DEVELOPER" on the lines that say who made a RECORD of the stay, the room and the guest requests (owner, 2026-10-18: "if he opens admin and
 * does an activity it should show the Developer did it, just like the others"). The stored staff member is NOT changed (Asha stays the one who checked
 * the guest in, for shifts and counts); the Developer's audit row — written while he works as someone — is what adds a small tag NEXT TO her name.
 * Rows are made directly as audit() writes them (the work-as remap itself is proved in developer-workas.test.ts), one second after the record they describe
 * (in the app it is a few milliseconds).
 */

const TZ = "Africa/Dar_es_Salaam";
const today = () => businessDateOf(new Date());
const LABEL = "Nino (Developer) as Neema (Receptionist)";
const AS_NAME = { id: "u-neema", name: "Neema", role: "Receptionist" };
const TAG = "Done by Developer · as Neema";
const ZH_TAG = "由开发者操作 · 以 Neema 的身份";
const zhCatalog: Catalog = { ...zhFixes };
const zh = makeT("zh-CN", zhCatalog);
const BAD = /undefined|NaN|\[object/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

let devId: string;
let deskName: string;
let deskUser: { id: string; fullName: string };
let desk: Awaited<ReturnType<typeof receptionistActor>>;
beforeAll(async () => {
  browser.reset();
  const mgr = await managerActor();
  devId = mgr.userId!; // stands for the Developer's own account in the audit rows
  desk = await receptionistActor();
  // In the app the stored author IS the person he works as, so the desk account is Neema here (named back in afterAll).
  deskUser = await db.user.findUniqueOrThrow({ where: { id: desk.userId! }, select: { id: true, fullName: true } });
  await db.user.update({ where: { id: deskUser.id }, data: { fullName: "Neema" } });
  deskName = "Neema";
  signedIn.user = {
    id: mgr.userId, email: "manager@vegas.test", fullName: mgr.label, locale: "en", roleCode: "MANAGER", roleName: "Manager", actorType: "STAFF", mustChangePassword: false,
    soundOff: false, permissions: new Set(ALL_PERMISSIONS), actorId: mgr.userId, actorName: mgr.label, workAs: null,
  };
});
beforeEach(resetBusinessData);
afterAll(resetBusinessData);
afterAll(async () => { await db.user.update({ where: { id: deskUser.id }, data: { fullName: deskUser.fullName } }); });

const at = (d: Date, ms = 1_000) => new Date(d.getTime() + ms);
/** The Developer's entry for a record, as audit() writes it while he works as Neema. */
const devRow = (entityType: string, entityId: string, action: string, createdAt: Date, over: Record<string, unknown> = {}) => db.auditLog.create({
  data: {
    entityType, entityId, action, actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: LABEL, userId: devId, after: { actingAs: AS_NAME },
    businessDate: toDbDate(today()), createdAt, ...over,
  } as never,
});
const staffRow = (entityType: string, entityId: string, action: string, createdAt: Date) => db.auditLog.create({
  data: { entityType, entityId, action, actorType: "STAFF", actorRole: "RECEPTIONIST", actorLabel: deskName, userId: desk.userId, after: null, businessDate: toDbDate(today()), createdAt } as never,
});

/** A booking by Asha at the desk, checked in by her. */
async function stay(name: string, roomIndex = 0) {
  const dd = await roomType("DOUBLE_DELUXE");
  const t = today();
  const room = dd.rooms[roomIndex];
  await db.room.update({ where: { id: room.id }, data: { status: "READY" } });
  const r = await createReservation({
    sourceCode: "PHONE", guest: { fullName: name, phone: "0715 111 999" }, stay: { kind: "overnight", arrivalDate: addDays(t, -1), departureDate: addDays(t, 1) },
    rooms: [{ roomTypeId: dd.id, roomId: room.id, adults: 1, children: 0, discountPerNight: 0 }],
  }, desk, zonedInstant(addDays(t, -1), 12 * 60, TZ));
  await checkIn(r.id, desk, null, zonedInstant(addDays(t, -1), 15 * 60, TZ));
  const full = await db.reservation.findUniqueOrThrow({ where: { id: r.id }, include: { rooms: true } });
  return { id: full.id, room, rr: full.rooms[0], createdAt: full.createdAt, checkedInAt: full.rooms[0].checkedInAt! };
}
/** …and the Developer's entries for what Asha's stored name says (made, checked in, a room move). */
async function byDeveloper(s: Awaited<ReturnType<typeof stay>>) {
  await devRow("Reservation", s.id, "reservation.created", at(s.createdAt));
  await devRow("Reservation", s.id, "reservation.checked_in", at(s.checkedInAt));
  const other = (await roomType("DOUBLE_DELUXE")).rooms[5];
  const move = await db.roomAssignment.create({ data: { reservationRoomId: s.rr.id, fromRoomId: s.room.id, toRoomId: other.id, reason: "Noisy room", changedById: desk.userId, changedAt: new Date(Date.now() - 600_000) } });
  await devRow("Reservation", s.id, "reservation.room_changed", at(move.changedAt));
  return { move, other };
}
const html = async (node: ReactNode) => renderToStaticMarkup((await resolveAsync(node)) as ReactElement);
/** Every element in a (resolved) page tree whose type has this function name. */
function findAll(node: ReactNode, name: string, out: ReactElement<Record<string, unknown>>[] = []): ReactElement<Record<string, unknown>>[] {
  if (Array.isArray(node)) { node.forEach((n) => findAll(n, name, out)); return out; }
  if (!isValidElement(node)) return out;
  const el = node as ReactElement<Record<string, unknown>>;
  if (typeof el.type === "function" && (el.type as { name?: string }).name === name) out.push(el);
  const kids = (el.props as { children?: ReactNode } | null)?.children;
  if (kids !== undefined) findAll(kids, name, out);
  return out;
}
const Provider = I18nProvider as FunctionComponent<{ locale: Locale; catalog: Catalog | null; children?: ReactNode }>;
const inZh = (el: ReactElement) => renderToStaticMarkup(createElement(Provider, { locale: "zh-CN", catalog: zhCatalog }, el));

// ───────────────────────────────────── the booking page ─────────────────────────────────────
describe("the booking page: booked by, in, room moves, orders", () => {
  it("a booking the Developer made and checked in while working as Neema: the tag sits beside Asha's stored name; her name is unchanged", async () => {
    const s = await stay("Dev Guest");
    const { move } = await byDeveloper(s);
    const page = await html(await ReservationPage({ params: Promise.resolve({ id: s.id }), searchParams: Promise.resolve({}) } as never));
    expect(page).toContain(deskName);
    // booked by / in / room move: three tags, each next to the stored name (the History list below carries the same entries, tagged too)
    expect(page.split(TAG).length - 1).toBeGreaterThanOrEqual(3);
    expect(page).toMatch(new RegExp(`booked [^<]* by ${esc(deskName)}<span[^>]*>${TAG}</span>`));
    expect(page).toMatch(new RegExp(`In [^<]* by ${esc(deskName)}<span[^>]*>${TAG}</span>`));
    expect(page).toContain("Noisy room");
    expect(page).not.toMatch(BAD);
    expect(move.changedAt).toBeTruthy();
  });

  it("a booking only Asha handled shows no tag at all, and a lookup that fails shows no tag and no error", async () => {
    const s = await stay("Plain Guest");
    await staffRow("Reservation", s.id, "reservation.created", at(s.createdAt));
    await staffRow("Reservation", s.id, "reservation.checked_in", at(s.checkedInAt));
    const page = await html(await ReservationPage({ params: Promise.resolve({ id: s.id }), searchParams: Promise.resolve({}) } as never));
    expect(page).toContain(deskName);
    expect(page).not.toContain("Done by Developer");
    // the Developer-marks lookup breaks (and only that one): the screen still opens, with no tag
    const s2 = await stay("Broken Lookup", 1);
    await byDeveloper(s2);
    const real = db.auditLog.findMany.bind(db.auditLog) as (a: { where?: { actorType?: string } }) => Promise<unknown>;
    const spy = vi.spyOn(db.auditLog, "findMany").mockImplementation(((a: { where?: { actorType?: string } }) => (a?.where?.actorType === "DEVELOPER" ? Promise.reject(new Error("db down")) : real(a))) as never);
    try {
      const broken = await html(await ReservationPage({ params: Promise.resolve({ id: s2.id }), searchParams: Promise.resolve({}) } as never));
      expect(broken).toContain(deskName);
      // the lookup that marks the author lines failed: no tag beside the stored names (the History list reads the audit row itself, so it still names the Developer)
      expect(broken).not.toMatch(new RegExp(`by ${esc(deskName)}<span[^>]*>Done by Developer`));
    } finally { spy.mockRestore(); }
  });

  it("a check-in marked for another time (a second room checked in later by Asha) does not borrow the Developer's tag", async () => {
    const s = await stay("Two Rooms");
    // the Developer's check-in entry is for a moment two hours away from this check-in: no match
    await devRow("Reservation", s.id, "reservation.checked_in", at(s.checkedInAt, 2 * 3600_000));
    const page = await html(await ReservationPage({ params: Promise.resolve({ id: s.id }), searchParams: Promise.resolve({}) } as never));
    expect(page).not.toMatch(new RegExp(`In [^<]* by ${esc(deskName)}<span[^>]*>Done by Developer`));
  });

  it("an order the Developer took for the room while working as Neema: the tag sits after the name on the order line; a guest's own phone order and Asha's order have none", async () => {
    const s = await stay("Orders Guest");
    const mk = () => createRestaurantOrder({ type: "ROOM_SERVICE", reservationId: s.id, settlement: "ROOM", items: [{ menuItemId: "mi_main_courses_chicken_biryani", quantity: 1 }] }, desk);
    const byDev = await mk();
    const byAsha = await mk();
    const rowOf = (id: string) => db.restaurantOrder.findUniqueOrThrow({ where: { id } });
    await devRow("RestaurantOrder", byDev.id, "restaurant_order.created", at((await rowOf(byDev.id)).createdAt));
    await staffRow("RestaurantOrder", byAsha.id, "restaurant_order.created", at((await rowOf(byAsha.id)).createdAt));
    const page = await html(await ReservationPage({ params: Promise.resolve({ id: s.id }), searchParams: Promise.resolve({}) } as never));
    const devNo = (await rowOf(byDev.id)).number, ashaNo = (await rowOf(byAsha.id)).number;
    const line = (no: string) => page.slice(page.indexOf(no), page.indexOf("</p>", page.indexOf(no)));
    expect(line(devNo)).toContain(TAG);
    expect(line(devNo)).toContain(` · ${deskName}`);
    expect(line(ashaNo)).not.toContain("Done by Developer");
    expect(page.split(TAG).length - 1).toBe(1);
  });

  it("the thank-you versions: the tooltip of a version the Developer made says so after the name", async () => {
    const s = await stay("Thanks Guest");
    await db.reservation.update({ where: { id: s.id }, data: { status: "CHECKED_OUT" } });
    const note = await generateThankYouNote(s.id, { userId: desk.userId!, label: deskName });
    await devRow("Reservation", s.id, "thank_you.generated", at(note.createdAt));
    const later = await generateThankYouNote(s.id, { userId: desk.userId!, label: deskName }, "A corrected charge");
    await db.thankYouNote.update({ where: { id: later.id }, data: { createdAt: new Date(Date.now() + 3600_000) } }); // made an hour later by Asha herself
    const el = (await resolveAsync(await ThankYouPage({ params: Promise.resolve({ id: s.id }), searchParams: Promise.resolve({}) } as never))) as ReactElement;
    const titles: string[] = [];
    const walk = (n: ReactNode) => {
      if (Array.isArray(n)) return n.forEach(walk);
      if (!isValidElement(n)) return;
      const p = n.props as { title?: unknown; children?: ReactNode };
      if (typeof p.title === "string" && p.title.includes(deskName)) titles.push(p.title);
      walk(p.children);
    };
    walk(el);
    expect(titles).toHaveLength(2);
    const first = titles.find((x) => !x.includes("A corrected charge"))!;
    const second = titles.find((x) => x.includes("A corrected charge"))!;
    expect(first).toContain(`${deskName} · ${TAG}`);
    expect(second).toContain(deskName);
    expect(second).not.toContain("Done by Developer");
    expect(later.version).toBe(2);
  });
});

// ───────────────────────────────────── the room page ─────────────────────────────────────
describe("the room page and the room timeline", () => {
  it("a stay the Developer checked in: its events carry the tag; Asha's own stay in another room does not; a Developer's change line is never cut at the bracket", async () => {
    const dev = await stay("Dev Stay", 0);
    const plain = await stay("Plain Stay", 1);
    await byDeveloper(dev);
    // a status change of the room (made by the check-in) the Developer made, and the staff's own for the other room
    const hist = await db.roomStatusHistory.findMany({ where: { roomId: dev.room.id }, orderBy: { changedAt: "asc" } });
    expect(hist.length).toBeGreaterThan(0);
    const occupied = hist.find((h) => h.toStatus === "OCCUPIED")!;
    await devRow("Room", dev.room.id, "room.status_changed", at(occupied.changedAt, 20));
    // an audit-derived "change" line: the Developer's, and Asha's
    await devRow("Reservation", dev.id, "reservation.extended", new Date(), { after: { actingAs: AS_NAME, nights: 1 } });
    await staffRow("Reservation", plain.id, "reservation.extended", new Date());

    const c = (await roomControl(dev.room.id, today()))!;
    const ev = (kind: RoomEvent["kind"]) => c.timeline.filter((e) => e.kind === kind);
    expect(ev("in")).toHaveLength(1);
    expect(ev("in")[0].by).toBe(deskName);
    expect(ev("in")[0].doneBy).toBe(TAG);
    expect(ev("status").filter((e) => e.doneBy)).toHaveLength(1);
    expect(ev("status").find((e) => e.doneBy)!.title).toContain("Occupied");
    expect(ev("move")[0].doneBy).toBe(TAG);
    expect(c.stay!.checkedInDoneBy).toBe(TAG);
    const change = ev("change")[0];
    expect(change.by).toBe(LABEL); // the whole label: the Developer, as Neema (not "Nino", not cut at the bracket)
    expect(change.by).not.toBe(signedIn.user && (signedIn.user as { fullName: string }).fullName);

    const p = (await roomControl(plain.room.id, today()))!;
    expect(p.timeline.every((e) => !e.doneBy)).toBe(true);
    expect(p.stay!.checkedInDoneBy).toBeNull();
    expect(p.timeline.find((e) => e.kind === "change")!.by).toBe(deskName);
  });

  it("for a reader who uses 中文 the server-made tag is in 中文 (and again in English for the next reader)", async () => {
    const dev = await stay("Dev Stay", 0);
    await byDeveloper(dev);
    browser.cookies.set("vlh-lang", "zh-CN");
    try {
      const c = (await roomControl(dev.room.id, today()))!;
      expect(c.stay!.checkedInDoneBy).toBe(ZH_TAG);
      expect(c.timeline.filter((e) => e.doneBy).every((e) => e.doneBy === ZH_TAG)).toBe(true);
    } finally { browser.cookies.delete("vlh-lang"); }
    expect((await roomControl(dev.room.id, today()))!.stay!.checkedInDoneBy).toBe(TAG);
  });

  it("the room page draws the tag beside the name (timeline and the 'Checked in' fact)", async () => {
    const dev = await stay("Dev Stay", 0);
    await byDeveloper(dev);
    const page = await html(await RoomPage({ params: Promise.resolve({ id: dev.room.id }), searchParams: Promise.resolve({}) } as never));
    expect(page).toContain(TAG);
    expect(page).toMatch(new RegExp(`by ${esc(deskName)}<span[^>]*>${TAG}</span>`));
    expect(page).not.toMatch(BAD);
    // the same page for a room only staff worked in: no tag
    const plain = await stay("Plain Stay", 2);
    const clean = await html(await RoomPage({ params: Promise.resolve({ id: plain.room.id }), searchParams: Promise.resolve({}) } as never));
    expect(clean).not.toContain("Done by Developer");
  });

  it("the room card's status list (fed by the action) shows the tag; with none, nothing", async () => {
    const dev = await stay("Dev Stay", 0);
    const hist = await db.roomStatusHistory.findFirstOrThrow({ where: { roomId: dev.room.id, toStatus: "OCCUPIED" } });
    await devRow("Room", dev.room.id, "room.status_changed", at(hist.changedAt, 20));
    const res = await roomHistoryAction({ roomId: dev.room.id });
    if (!res.ok) throw new Error(res.error);
    const rows = res.data.statuses;
    const marked = rows.filter((r) => r.doneBy);
    expect(marked).toHaveLength(1);
    expect(marked[0].doneBy).toBe(TAG);
    const withTag = renderToStaticMarkup(createElement(StatusChangeList, { rows }));
    expect(withTag).toContain(TAG);
    expect(withTag).not.toMatch(BAD);
    expect(renderToStaticMarkup(createElement(StatusChangeList, { rows: rows.map((r) => ({ ...r, doneBy: null })) }))).not.toContain("Done by Developer");
    // in 中文 the same list reads the tag it was given (it arrives already translated)
    expect(inZh(createElement(StatusChangeList, { rows: rows.map((r) => ({ ...r, doneBy: r.doneBy ? ZH_TAG : null })) }))).toContain(ZH_TAG);
  });
});

// ───────────────────────────────────── a group booking ─────────────────────────────────────
describe("a group booking: booked by", () => {
  it("the group the Developer made while working as Neema shows the tag after 'booked … by Asha'; Asha's own group does not", async () => {
    const mk = async (name: string, i: number) => {
      const dd = await roomType("DOUBLE_DELUXE");
      return createGroupBooking({
        name, type: "FAMILY", contact: { fullName: "Group Contact", phone: "0713000009" }, sourceCode: "PHONE", billing: "COMBINED",
        arrivalDate: addDays(today(), 5), departureDate: addDays(today(), 7), rooms: [{ roomTypeId: dd.id, guest: { fullName: `Member ${i}` }, adults: 1, children: 0 }],
      }, desk);
    };
    const a = await mk("Dev Group", 1);
    const b = await mk("Asha Group", 2);
    const ga = await db.bookingGroup.findUniqueOrThrow({ where: { id: a.id } });
    await devRow("BookingGroup", a.id, "group.created", at(ga.createdAt));
    await staffRow("BookingGroup", b.id, "group.created", at(ga.createdAt));
    const pageA = await html(await GroupPage({ params: Promise.resolve({ id: a.id }), searchParams: Promise.resolve({}) } as never));
    expect(pageA).toMatch(new RegExp(`by ${esc(deskName)}<span[^>]*>${TAG}</span>`));
    const pageB = await html(await GroupPage({ params: Promise.resolve({ id: b.id }), searchParams: Promise.resolve({}) } as never));
    expect(pageB).toContain(deskName);
    expect(pageB).not.toContain("Done by Developer");
  });
});

// ───────────────────────────────────── arrivals ─────────────────────────────────────
describe("the arrivals list: Booked by", () => {
  it("a booking the Developer made shows the tag beside 'Booked by Asha'; Asha's own does not", async () => {
    const dd = await roomType("DOUBLE_DELUXE");
    const mk = async (name: string, i: number) => createReservation({
      sourceCode: "PHONE", guest: { fullName: name, phone: `07150000${i}0` }, stay: { kind: "overnight", arrivalDate: today(), departureDate: addDays(today(), 1) },
      rooms: [{ roomTypeId: dd.id, roomId: dd.rooms[i].id, adults: 1, children: 0, discountPerNight: 0 }],
    }, desk);
    const a = await mk("Arrives By Dev", 0);
    const b = await mk("Arrives By Asha", 1);
    const ra = await db.reservation.findUniqueOrThrow({ where: { id: a.id } });
    await devRow("Reservation", a.id, "reservation.created", at(ra.createdAt));
    await staffRow("Reservation", b.id, "reservation.created", at(ra.createdAt));
    const s = await getArrivalsSummary(today());
    const out = await html(createElement(ArrivalsSummary as unknown as FunctionComponent<Record<string, unknown>>, { s, today: today(), canCheckIn: false, show: 10 }));
    expect(out).toContain("Arrives By Dev");
    expect(out).toContain("Arrives By Asha");
    expect(out.split(TAG).length - 1).toBe(1);
    expect(out).toMatch(new RegExp(`Booked by ${esc(deskName)}</span><span[^>]*>${TAG}</span>`));
    expect(out).not.toMatch(BAD);
  });
});

// ───────────────────────────────────── the day's lists ─────────────────────────────────────
describe("the printed daily lists: made by", () => {
  it("the copy the Developer printed carries the tag on the screen; the stored name and the paper are not touched", async () => {
    const actor = { id: desk.userId!, fullName: deskName, roleName: "Receptionist" };
    const c1 = await saveDailyListCopy("HOUSEKEEPING", actor);
    const c2 = await saveDailyListCopy("HOUSEKEEPING", actor);
    await devRow("DailyList", c1.id, "daily_list.printed", at(new Date()));
    const [m1, m2] = await withDoneBy([c1, c2]);
    expect(m1.doneBy).toBe(TAG);
    expect(m2.doneBy).toBeNull();
    expect(m1.generatedBy).toBe(`${deskName} (Receptionist)`); // the stored name, exactly as printed
    expect(m1.data).toEqual(c1.data);
    // a lookup that fails leaves the copies as they were
    const spy = vi.spyOn(db.auditLog, "findMany").mockRejectedValue(new Error("db down"));
    try { expect((await withDoneBy([c1]))[0].doneBy).toBeUndefined(); } finally { spy.mockRestore(); }

    // the page hands the open copy and the list of copies to the workspace with the tag already in
    const el = (await resolveAsync(await DailyListPage({ params: Promise.resolve({ kind: "housekeeping" }), searchParams: Promise.resolve({ copy: c1.id }) } as never))) as ReactElement;
    const [ws] = findAll(el, "ListWorkspace");
    const props = ws.props as { copy: { doneBy?: string | null }; copies: { id: string; doneBy?: string | null }[] };
    expect(props.copy.doneBy).toBe(TAG);
    expect(props.copies.find((x) => x.id === c1.id)!.doneBy).toBe(TAG);
    expect(props.copies.find((x) => x.id === c2.id)!.doneBy).toBeNull();

    // drawn: the sentence of the open copy and the chip of each copy
    const drawn = renderToStaticMarkup(createElement(ListWorkspace, ws.props as never));
    expect(drawn.split(TAG).length - 1).toBe(2);
    expect(drawn).not.toMatch(BAD);
    const plain = renderToStaticMarkup(createElement(ListWorkspace, { ...(ws.props as object), copy: { ...(props.copy as object), doneBy: null }, copies: props.copies.map((x) => ({ ...x, doneBy: null })) } as never));
    expect(plain).not.toContain("Done by Developer");
    const cn = inZh(createElement(ListWorkspace, { ...(ws.props as object), copy: { ...(props.copy as object), doneBy: ZH_TAG }, copies: props.copies.map((x) => ({ ...x, doneBy: x.doneBy ? ZH_TAG : null })) } as never));
    expect(cn).toContain(ZH_TAG);
    expect(cn).not.toMatch(BAD);
  });
});

// ───────────────────────────────────── guest requests ─────────────────────────────────────
describe("guest requests: logged by, on it, finished", () => {
  async function requests() {
    const s = await stay("Request Guest");
    const mine = { userId: desk.userId!, label: deskName, permissions: desk.permissions };
    const a = await createServiceRequest({ reservationId: s.id, type: "TOWELS", priority: "NORMAL", description: "2 towels" }, mine);
    const b = await createServiceRequest({ reservationId: s.id, type: "CLEANING", priority: "NORMAL", description: "Clean the room" }, mine);
    const c = await createServiceRequest({ reservationId: s.id, type: "GENERAL", priority: "NORMAL", description: "Done already" }, mine);
    await acceptServiceRequest(b.id, mine);
    await acceptServiceRequest(c.id, mine);
    await updateServiceRequest(c.id, { status: "COMPLETED" }, mine);
    const rows = await db.serviceRequest.findMany({ where: { id: { in: [a.id, b.id, c.id] } } });
    const row = (id: string) => rows.find((r) => r.id === id)!;
    return { a: row(a.id), b: row(b.id), c: row(c.id) };
  }

  it("the Developer logged one, accepted one and finished one while working as Neema: the three tags sit beside the stored names", async () => {
    const { a, b, c } = await requests();
    await devRow("ServiceRequest", a.id, "request.created", at(a.createdAt));
    await devRow("ServiceRequest", b.id, "request.accepted", at(b.acceptedAt!));
    await devRow("ServiceRequest", c.id, "request.updated", at(c.completedAt!));
    const el = (await resolveAsync(await RequestsPage())) as ReactElement;
    const views = findAll(el, "RequestCard").map((x) => (x.props as { r: RequestView }).r);
    const view = (id: string) => views.find((v) => v.id === id)!;
    expect(view(a.id).loggedDoneBy).toBe(TAG);
    expect(view(b.id).onItDoneBy).toBe(TAG);
    expect(view(c.id).finishedDoneBy).toBe(TAG);
    // each only on its own line
    expect(view(a.id).onItDoneBy).toBeNull();
    expect(view(b.id).loggedDoneBy).toBeNull();
    expect(view(c.id).loggedDoneBy).toBeNull();

    const draw = (v: RequestView, t?: "zh") => {
      const card = createElement(RequestCard, { r: v, meId: "someone", now: Date.now(), staff: [], manage: true, boss: false });
      return t ? inZh(card) : renderToStaticMarkup(card);
    };
    const logged = draw(view(a.id));
    expect(logged).toMatch(new RegExp(`Logged by [^<]*<span[^>]*>${TAG}</span>`));
    expect(draw(view(b.id))).toContain(TAG);
    expect(draw(view(c.id))).toContain(TAG);
    for (const v of views) expect(draw({ ...v, loggedDoneBy: null, onItDoneBy: null, finishedDoneBy: null })).not.toContain("Done by Developer");
    expect(draw({ ...view(a.id), loggedDoneBy: ZH_TAG }, "zh")).toContain(ZH_TAG);
    for (const v of views) expect(draw(v)).not.toMatch(BAD);
  });

  it("requests only Asha handled show no tag; the Developer's entry for an older step does not mark a newer one", async () => {
    const { a, b, c } = await requests();
    await staffRow("ServiceRequest", a.id, "request.created", at(a.createdAt));
    // the Developer accepted b long ago (not near its accepted time): no tag
    await devRow("ServiceRequest", b.id, "request.accepted", at(b.acceptedAt!, 3600_000));
    const el = (await resolveAsync(await RequestsPage())) as ReactElement;
    const views = findAll(el, "RequestCard").map((x) => (x.props as { r: RequestView }).r);
    expect(views.length).toBe(3);
    for (const v of views) {
      expect(v.loggedDoneBy ?? null).toBeNull();
      expect(v.onItDoneBy ?? null).toBeNull();
      expect(v.finishedDoneBy ?? null).toBeNull();
    }
    expect(c.status).toBe("COMPLETED");
  });
});

describe("the tag itself", () => {
  it("is the one small component with the words it was given, in English and in 中文", () => {
    expect(renderToStaticMarkup(createElement(DoneByDeveloper, { text: zh("Done by Developer · as {name}", { name: "Neema" }) }))).toContain(ZH_TAG);
  });
});
