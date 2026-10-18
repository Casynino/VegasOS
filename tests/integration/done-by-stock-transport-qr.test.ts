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
import { createBookingQr } from "@/server/services/booking-qr";
import { logContact, setRequestStatus, submitBookingRequest } from "@/server/services/booking-requests";
import { confirmTrip, createTransportRequest } from "@/server/services/transport";
import { createStockRequest, cancelStockRequest } from "@/server/services/stock-requests";
import { assetHistory, assetsData, moveAsset, recentMovements, reportWaste, saveAsset, saveInventoryItem, takeStock } from "@/server/services/inventory";
import { BookingRequestView } from "@/app/staff/(app)/booking-requests/[id]/request-view";
import HotelQrPage from "@/app/staff/(app)/hotel-qr/page";
import TransportPage from "@/app/staff/(app)/transport/page";
import StockRequestsPage from "@/app/staff/(app)/stock-requests/page";
import { tripHistoryAction } from "@/app/staff/(app)/transport/actions";
import { QrCodes, type QrCodeView } from "@/app/staff/(app)/hotel-qr/qr-codes";
import { TripSource, type TripView } from "@/app/staff/(app)/transport/transport-forms";
import { RequestRows } from "@/app/staff/(app)/stock-requests/stock-requests";
import { Timeline } from "@/app/staff/(app)/stock-requests/request-dialog";
import { MovementList } from "@/app/staff/(app)/inventory/item-sheet";
import { WasteView } from "@/app/staff/(app)/inventory/waste-view";
import { MoveList } from "@/app/staff/(app)/assets/assets-view";
import { I18nProvider } from "@/i18n/client";
import type { Catalog } from "@/i18n/translate";
import type { Locale } from "@/i18n/config";
import type { StockReqView, Viewer } from "@/lib/stock-requests";
import { addDays, businessDateOf, toDbDate } from "@/lib/time/business-date";
import zhFixes from "@/i18n/catalog/zh-CN/staff/developer-fixes";
import { chefActor, managerActor, receptionistActor, resetBusinessData } from "../support/helpers";
import { browser, resolveAsync } from "../support/developer";

/**
 * "DONE BY DEVELOPER" on the lines that say who made a record of the Hotel QR, website booking requests, transport, stock requests, stock movements and
 * assets (owner, 2026-10-18: "if he opens admin and does an activity it should show the Developer did it, just like the others"). The stored person is NOT
 * changed; the Developer's audit row — written while he works as someone — adds a small tag NEXT TO the name, for every reader. Rows are made directly as
 * audit() writes them (the work-as remap is proved in developer-workas.test.ts), at the moment of the record they describe.
 */

const today = () => businessDateOf(new Date());
const LABEL = "Nino (Developer) as Neema (Receptionist)";
const AS_NAME = { id: "u-neema", name: "Neema", role: "Receptionist" };
const TAG = "Done by Developer · as Neema";
const ZH_TAG = "由开发者操作 · 以 Neema 的身份";
const zhCatalog: Catalog = { ...zhFixes };
const BAD = /undefined|NaN|\[object/;
const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const HOUR = 3_600_000;

let devId: string;
let deskName: string;
let mgrName: string;
let desk: Awaited<ReturnType<typeof receptionistActor>>;
let mgr: Awaited<ReturnType<typeof managerActor>>;
const madeQr: string[] = [];
beforeAll(async () => {
  browser.reset();
  mgr = await managerActor();
  devId = mgr.userId!; // stands for the Developer's own account in the audit rows
  desk = await receptionistActor();
  deskName = desk.label!;
  mgrName = mgr.label!;
  signedIn.user = {
    id: mgr.userId, email: "manager@vegas.test", fullName: mgrName, locale: "en", roleCode: "MANAGER", roleName: "Manager", actorType: "STAFF", mustChangePassword: false,
    soundOff: false, permissions: new Set(ALL_PERMISSIONS), actorId: mgr.userId, actorName: mgrName, workAs: null,
  };
});
beforeEach(async () => {
  await resetBusinessData();
  await db.bookingRequest.deleteMany();
  await db.$executeRawUnsafe(`TRUNCATE "transport_trips" CASCADE`);
});
afterAll(async () => {
  await resetBusinessData();
  await db.bookingQrCode.deleteMany({ where: { id: { in: madeQr } } });
});

const at = (d: Date, ms = 1_000) => new Date(d.getTime() + ms);
const devRow = (entityType: string, entityId: string, action: string, createdAt: Date) => db.auditLog.create({
  data: {
    entityType, entityId, action, actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: LABEL, userId: devId, after: { actingAs: AS_NAME },
    businessDate: toDbDate(today()), createdAt,
  } as never,
});
const staffRow = (entityType: string, entityId: string, action: string, createdAt: Date) => db.auditLog.create({
  data: { entityType, entityId, action, actorType: "STAFF", actorRole: "RECEPTIONIST", actorLabel: deskName, userId: desk.userId, after: null, businessDate: toDbDate(today()), createdAt } as never,
});
const html = async (node: ReactNode) => renderToStaticMarkup((await resolveAsync(node)) as ReactElement);
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
const staffActor = () => ({ userId: desk.userId!, label: deskName, permissions: desk.permissions });

// ───────────────────────────────────── Hotel QR ─────────────────────────────────────
describe("Hotel QR: made by", () => {
  it("a code the Developer made while working as Neema shows the tag after 'made … by'; a code made by the manager does not", async () => {
    const a = await createBookingQr({ label: "Dev gate" }, mgr);
    const b = await createBookingQr({ label: "Plain gate" }, mgr);
    madeQr.push(a.id, b.id);
    const qa = await db.bookingQrCode.findUniqueOrThrow({ where: { id: a.id } });
    await devRow("BookingQrCode", a.id, "hotel_qr.created", at(qa.createdAt));
    await staffRow("BookingQrCode", b.id, "hotel_qr.created", at(qa.createdAt));
    const el = (await resolveAsync(await HotelQrPage({ searchParams: Promise.resolve({}) } as never))) as ReactElement;
    const [qr] = findAll(el, "QrCodes");
    const codes = (qr.props as { codes: QrCodeView[] }).codes;
    expect(codes.find((c) => c.id === a.id)!.madeDoneBy).toBe(TAG);
    expect(codes.find((c) => c.id === b.id)!.madeDoneBy).toBeNull();
    // the cards, drawn
    const drawn = renderToStaticMarkup(createElement(QrCodes, qr.props as never));
    expect(drawn.split(TAG).length - 1).toBe(1);
    expect(drawn).toMatch(new RegExp(`by ${esc(mgrName)}</p>|by ${esc(mgrName)}<span[^>]*>${TAG}</span>`));
    expect(drawn).not.toMatch(BAD);
    const props = qr.props as { codes: QrCodeView[] };
    const zhDrawn = inZh(createElement(QrCodes, { ...props, codes: props.codes.map((c) => ({ ...c, madeDoneBy: c.madeDoneBy ? ZH_TAG : null })) } as never));
    expect(zhDrawn).toContain(ZH_TAG);
    expect(renderToStaticMarkup(createElement(QrCodes, { ...props, codes: props.codes.map((c) => ({ ...c, madeDoneBy: null })) } as never))).not.toContain("Done by Developer");
  });
});

// ───────────────────────────────────── booking requests ─────────────────────────────────────
describe("a website booking request: history lines and 'Handled by'", () => {
  const sel = () => ({ checkIn: addDays(today(), 3), checkOut: addDays(today(), 5), typeSlug: "double-deluxe", rooms: 1, adults: 2, children: 0 });
  const view = async (id: string) => html(await BookingRequestView({ id, user: signedIn.user as never }));

  it("a step and the final decision the Developer made while working as Neema carry the tag; Asha's own steps do not", async () => {
    const r = await submitBookingRequest(sel(), { fullName: "Web Guest", phone: "0712 000 111" }, null);
    const req = await db.bookingRequest.findUniqueOrThrow({ where: { reference: r.reference } });
    await setRequestStatus(req.id, "REVIEWING", staffActor() as never, "looking at it");
    await logContact(req.id, { note: "Called the guest, agreed" }, staffActor() as never);
    await setRequestStatus(req.id, "REJECTED", staffActor() as never, "no room");
    const events = await db.bookingRequestEvent.findMany({ where: { requestId: req.id }, orderBy: { createdAt: "asc" } });
    const reviewing = events.find((e) => e.type === "STATUS_CHANGED" && e.toStatus === "REVIEWING")!;
    const contacted = events.find((e) => e.type === "CONTACTED")!;
    const rejected = events.find((e) => e.type === "STATUS_CHANGED" && e.toStatus === "REJECTED")!;
    // spread the steps apart (in the app they are minutes apart), then the Developer's entries for two of them
    await db.bookingRequestEvent.update({ where: { id: reviewing.id }, data: { createdAt: new Date(Date.now() - 3 * HOUR) } });
    await db.bookingRequestEvent.update({ where: { id: contacted.id }, data: { createdAt: new Date(Date.now() - 2 * HOUR) } });
    await devRow("BookingRequest", req.id, "booking_request.status_changed", at(new Date(Date.now() - 3 * HOUR)));
    await devRow("BookingRequest", req.id, "booking_request.contacted", at(new Date(Date.now() - 2 * HOUR)));
    expect(rejected.createdAt.getTime()).toBeGreaterThan(Date.now() - 60_000);
    const page = await view(req.id);
    // two steps are the Developer's; the rejection (and so "Handled by") is Asha's own
    expect(page.split(TAG).length - 1).toBe(2);
    expect(page).toMatch(new RegExp(`${esc(deskName)}<span[^>]*>${TAG}</span>`));
    const handled = page.slice(page.indexOf("Handled by"), page.indexOf("Handled by") + 600);
    expect(handled).toContain(deskName);
    expect(handled).not.toContain("Done by Developer");
    expect(page).not.toMatch(BAD);

    // the decision itself by the Developer: "Handled by" carries the tag
    await devRow("BookingRequest", req.id, "booking_request.status_changed", at(rejected.createdAt));
    const again = await view(req.id);
    const row = again.slice(again.indexOf("Handled by"), again.indexOf("Handled by") + 700);
    expect(row).toContain(TAG);
    expect(again.split(TAG).length - 1).toBe(4); // the rejection line, "Handled by", and the two earlier steps
  });

  it("a request nobody but staff touched shows no tag", async () => {
    const r = await submitBookingRequest(sel(), { fullName: "Plain Web Guest", phone: "0712 000 222" }, null);
    const req = await db.bookingRequest.findUniqueOrThrow({ where: { reference: r.reference } });
    await setRequestStatus(req.id, "REVIEWING", staffActor() as never);
    expect(await view(req.id)).not.toContain("Done by Developer");
  });
});

// ───────────────────────────────────── transport ─────────────────────────────────────
describe("transport: confirmed by, and the trip's history", () => {
  async function trip(name: string) {
    const svc = await db.transportService.findUniqueOrThrow({ where: { code: "AIRPORT_PICKUP" } });
    await db.transportService.update({ where: { id: svc.id }, data: { isActive: true, isPublic: true, price: 40_000 } });
    const actor = { ...mgr, permissions: new Set(ALL_PERMISSIONS) as ReadonlySet<string> };
    const t = await createTransportRequest({
      serviceId: svc.id, passengerName: name, passengerPhone: "+255 700 000 001", date: addDays(today(), 1), time: "18:30", airport: "Julius Nyerere International Airport (DAR)",
      flightNumber: "TK603", passengers: 2, bags: 2,
    }, { source: "STAFF", actor });
    await confirmTrip(t.id, actor);
    return db.transportTrip.findUniqueOrThrow({ where: { id: t.id } });
  }

  it("the trip the Developer confirmed while working as Neema carries the tag beside 'confirmed by'; one a manager confirmed does not", async () => {
    const a = await trip("Dev Trip");
    const b = await trip("Plain Trip");
    await devRow("TransportTrip", a.id, "transport.confirmed", at(a.confirmedAt!));
    await staffRow("TransportTrip", b.id, "transport.confirmed", at(a.confirmedAt!));
    const el = (await resolveAsync(await TransportPage({ searchParams: Promise.resolve({ tab: "confirmed" }) } as never))) as ReactElement;
    const trips = findAll(el, "TripRowButton").map((x) => (x.props as { trip: TripView }).trip);
    expect(trips).toHaveLength(2);
    const ta = trips.find((x) => x.id === a.id)!, tb = trips.find((x) => x.id === b.id)!;
    expect(ta.confirmedDoneBy).toBe(TAG);
    expect(tb.confirmedDoneBy).toBeNull();
    expect(ta.confirmedBy).toBe(mgrName); // the stored name is unchanged
    const drawn = renderToStaticMarkup(createElement(TripSource, { trip: ta }));
    expect(drawn).toContain(`confirmed by ${mgrName}`);
    expect(drawn).toContain(TAG);
    expect(drawn).not.toMatch(BAD);
    expect(renderToStaticMarkup(createElement(TripSource, { trip: tb }))).not.toContain("Done by Developer");
    expect(inZh(createElement(TripSource, { trip: { ...ta, confirmedDoneBy: ZH_TAG } }))).toContain(ZH_TAG);
  });

  it("the trip's history names the Developer in full (never cut at the bracket) and a staff member by name", async () => {
    const a = await trip("History Trip");
    await devRow("TransportTrip", a.id, "transport.price_adjusted", new Date());
    const res = await tripHistoryAction({ tripId: a.id });
    if (!res.ok) throw new Error(res.error);
    const by = res.data.map((h) => h.by);
    expect(by).toContain(LABEL);
    expect(by).toContain(mgrName);
    expect(by.every((x) => x !== "Nino")).toBe(true);
  });
});

// ───────────────────────────────────── stock requests ─────────────────────────────────────
describe("purchase requests: asked by, and the steps the asker takes", () => {
  it("a request the Developer asked for, and one he cancelled, while working as Neema: the tag beside the stored name in the list and in the history; Asha's own have none", async () => {
    const chef = await chefActor();
    const chefName = chef.label!;
    const ask = async (item: string, when: Date) => createStockRequest({ department: "KITCHEN", urgent: false, reason: "Weekend", items: [{ name: item, quantity: 10, unit: "kg" }] }, chef, when);
    const t0 = new Date(Date.now() - 4 * HOUR);
    const dev = await ask("Beef", t0);
    const plain = await ask("Rice", new Date(Date.now() - 3 * HOUR));
    const gone = await ask("Flour", new Date(Date.now() - 2 * HOUR));
    const cancelAt = new Date(Date.now() - 1 * HOUR);
    await cancelStockRequest(gone.id, "no longer needed", chef, cancelAt);
    await devRow("StockRequest", dev.id, "stock_request.created", at(t0));
    await staffRow("StockRequest", plain.id, "stock_request.created", at(new Date(Date.now() - 3 * HOUR)));
    await devRow("StockRequest", gone.id, "stock_request.cancelled", at(cancelAt));

    const el = (await resolveAsync(await StockRequestsPage())) as ReactElement;
    const [sr] = findAll(el, "StockRequests");
    const p = sr.props as { open: StockReqView[]; closed: StockReqView[]; me: Viewer };
    const all = [...p.open, ...p.closed];
    const v = (id: string) => all.find((x) => x.id === id)!;
    expect(v(dev.id).byDoneBy).toBe(TAG);
    expect(v(plain.id).byDoneBy).toBeNull();
    expect(v(gone.id).byDoneBy).toBeNull();
    expect(v(dev.id).events.every((e) => e.action !== "SUBMITTED" || e.doneBy === TAG)).toBe(true);
    expect(v(gone.id).events.find((e) => e.action === "CANCELLED")!.doneBy).toBe(TAG);
    expect(v(gone.id).events.find((e) => e.action === "SUBMITTED")!.doneBy).toBeNull();
    expect(v(plain.id).events.every((e) => !e.doneBy)).toBe(true);
    expect(v(dev.id).by).toBe(chefName); // the stored asker is unchanged

    const list = renderToStaticMarkup(createElement(RequestRows, { list: all, me: p.me, onOpen: () => undefined }));
    expect(list.split(TAG).length - 1).toBe(1);
    expect(list).not.toMatch(BAD);
    expect(renderToStaticMarkup(createElement(RequestRows, { list: all.map((x) => ({ ...x, byDoneBy: null })), me: p.me, onOpen: () => undefined }))).not.toContain("Done by Developer");
    expect(inZh(createElement(RequestRows, { list: all.map((x) => ({ ...x, byDoneBy: x.byDoneBy ? ZH_TAG : null })), me: p.me, onOpen: () => undefined }))).toContain(ZH_TAG);

    const history = renderToStaticMarkup(createElement(Timeline, { events: v(gone.id).events }));
    expect(history.split(TAG).length - 1).toBe(1);
    expect(history).not.toMatch(BAD);
    expect(renderToStaticMarkup(createElement(Timeline, { events: v(plain.id).events }))).not.toContain("Done by Developer");
    expect(inZh(createElement(Timeline, { events: v(gone.id).events.map((e) => ({ ...e, doneBy: e.doneBy ? ZH_TAG : null })) }))).toContain(ZH_TAG);
  });
});

// ───────────────────────────────────── stock movements and assets ─────────────────────────────────────
describe("stock movements and the asset register", () => {
  it("stock the Developer took out and waste he reported while working as Neema carry the tag; the cook's own do not", async () => {
    const chef = await chefActor();
    const chefName = chef.label!;
    const beef = (await saveInventoryItem({ name: "Beef", categoryId: "invcat_food", departmentId: "invdep_kitchen", unit: "KG", openingQuantity: 100, costPerUnit: 1000 }, mgr)).id;
    const t1 = new Date(Date.now() - 4 * HOUR), t2 = new Date(Date.now() - 3 * HOUR), t3 = new Date(Date.now() - 2 * HOUR), t4 = new Date(Date.now() - HOUR);
    await takeStock({ itemId: beef, quantity: 5, reason: "KITCHEN_USAGE" }, chef, t1);
    await takeStock({ itemId: beef, quantity: 3, reason: "KITCHEN_USAGE" }, chef, t2);
    await reportWaste({ itemId: beef, quantity: 2, reason: "SPOILED" }, chef, t3);
    await reportWaste({ itemId: beef, quantity: 1, reason: "SPOILED" }, chef, t4);
    const wastes = await db.inventoryMovement.findMany({ where: { itemId: beef, kind: "WASTE" }, orderBy: { recordedAt: "asc" } });
    await devRow("InventoryItem", beef, "inventory.used", at(t1));
    await staffRow("InventoryItem", beef, "inventory.used", at(t2));
    await devRow("InventoryMovement", wastes[0].id, "inventory.waste_reported", at(t3));
    await staffRow("InventoryMovement", wastes[1].id, "inventory.waste_reported", at(t4));

    const rows = await recentMovements({ itemId: beef });
    const byKind = (k: string) => rows.filter((m) => m.kind === k).sort((a, b) => a.at.localeCompare(b.at));
    const uses = byKind("USE"), waste = byKind("WASTE");
    expect(uses.map((m) => m.doneBy)).toEqual([TAG, null]);
    expect(waste.map((m) => m.doneBy)).toEqual([TAG, null]);
    expect(uses[0].by).toBe(chefName); // the stored person is unchanged

    const list = renderToStaticMarkup(createElement(MovementList, { rows }));
    expect(list.split(TAG).length - 1).toBe(2);
    expect(list).not.toMatch(BAD);
    expect(renderToStaticMarkup(createElement(MovementList, { rows: rows.map((m) => ({ ...m, doneBy: null })) }))).not.toContain("Done by Developer");
    expect(inZh(createElement(MovementList, { rows: rows.map((m) => ({ ...m, doneBy: m.doneBy ? ZH_TAG : null })) }))).toContain(ZH_TAG);

    const pending = await recentMovements({ kind: "WASTE", status: "PENDING" });
    const waiting = renderToStaticMarkup(createElement(WasteView, { pending, recent: [], approver: false }));
    expect(waiting).toMatch(new RegExp(`Reported by ${esc(chefName)}[^<]*<span[^>]*>${TAG}</span>`));
    expect(waiting.split(TAG).length - 1).toBe(1);
    expect(inZh(createElement(WasteView, { pending: pending.map((m) => ({ ...m, doneBy: m.doneBy ? ZH_TAG : null })), recent: [], approver: false }))).toContain(ZH_TAG);
  });

  it("an asset the Developer moved while working as Neema carries the tag in its history and in the latest moves; a move by the manager does not", async () => {
    const chairs = await saveAsset({ name: "Chairs", category: "Furniture", location: "Restaurant", quantity: 20, purchaseCost: 2_000_000, condition: "GOOD", status: "IN_USE" }, mgr);
    const t1 = new Date(Date.now() - 3 * HOUR), t2 = new Date(Date.now() - HOUR);
    await moveAsset({ assetId: chairs.id, to: "Meeting room" }, mgr, t1);
    await devRow("Asset", chairs.id, "asset.moved", at(t1));
    await moveAsset({ assetId: chairs.id, to: "Lobby" }, mgr, t2);
    await staffRow("Asset", chairs.id, "asset.moved", at(t2));

    const history = (await assetHistory(chairs.id)).filter((m) => m.kind === "MOVED");
    expect(history.map((m) => [m.to, m.doneBy])).toEqual([["Lobby", null], ["Meeting room", TAG]]);
    const drawn = renderToStaticMarkup(createElement(MoveList, { rows: history }));
    expect(drawn.split(TAG).length - 1).toBe(1);
    expect(drawn).not.toMatch(BAD);
    expect(renderToStaticMarkup(createElement(MoveList, { rows: history.map((m) => ({ ...m, doneBy: null })) }))).not.toContain("Done by Developer");
    expect(inZh(createElement(MoveList, { rows: history.map((m) => ({ ...m, doneBy: m.doneBy ? ZH_TAG : null })) }))).toContain(ZH_TAG);

    const latest = (await assetsData()).moves.filter((m) => m.kind === "MOVED");
    expect(latest.map((m) => m.doneBy).sort()).toEqual([null, TAG].sort());
  });

  it("a lookup that fails shows no tag and no error", async () => {
    const chef = await chefActor();
    const beef = (await saveInventoryItem({ name: "Beef", categoryId: "invcat_food", departmentId: "invdep_kitchen", unit: "KG", openingQuantity: 10, costPerUnit: 1000 }, mgr)).id;
    const t1 = new Date(Date.now() - HOUR);
    await takeStock({ itemId: beef, quantity: 1, reason: "KITCHEN_USAGE" }, chef, t1);
    await devRow("InventoryItem", beef, "inventory.used", at(t1));
    const real = db.auditLog.findMany.bind(db.auditLog) as (a: { where?: { actorType?: string } }) => Promise<unknown>;
    const spy = vi.spyOn(db.auditLog, "findMany").mockImplementation(((a: { where?: { actorType?: string } }) => (a?.where?.actorType === "DEVELOPER" ? Promise.reject(new Error("db down")) : real(a))) as never);
    try {
      const rows = await recentMovements({ itemId: beef });
      expect(rows.some((m) => m.kind === "USE")).toBe(true);
      expect(rows.every((m) => !m.doneBy)).toBe(true);
    } finally { spy.mockRestore(); }
  });
});
