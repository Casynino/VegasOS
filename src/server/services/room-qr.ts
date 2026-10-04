import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "../db";
import { audit } from "../audit";
import { AppError } from "../errors";
import { mediaUrl } from "./media";
import { placeOrderForStay, stayView, type StayOrderInput } from "./guest-comms";
import { createGuestRequest } from "./requests";

type Actor = { userId?: string | null; label?: string; ipAddress?: string | null; permissions?: ReadonlySet<string> };

/**
 * Room QR codes — every room (guest rooms and the meeting room) has one permanent QR.
 * It belongs to the room, never to a guest: each scan looks up, on the server, the stay
 * checked in to that room *now* and opens it — today NINO's, tomorrow the next guest's.
 * Orders from the QR go to whoever is checked in to that room at that moment (never a
 * room number sent by the phone). A free room shows the room, its status and the menu.
 */

export const newQrToken = () => randomBytes(9).toString("base64url");
const canManage = (a: Actor) => !!(a.permissions?.has("rooms.manage") || a.permissions?.has("restaurant.menu"));

// ───────────────────────── The codes ─────────────────────────

/** The room behind a scanned QR (and whether its code is switched on). */
export async function roomForQr(token: string) {
  if (!/^[A-Za-z0-9_-]{8,24}$/.test(token)) return null;
  const code = await db.roomQrCode.findUnique({
    where: { token },
    select: { active: true, room: { select: { id: true, number: true, isActive: true, status: true, roomType: { select: { name: true, category: true } } } } },
  });
  if (!code || !code.room.isActive) return null;
  return { roomId: code.room.id, number: code.room.number, type: code.room.roomType.name, status: code.room.status, meeting: code.room.roomType.category === "MEETING_ROOM", active: code.active };
}

/** Every room with its QR (made the first time a room is listed). */
export async function roomQrCodes() {
  const missing = await db.room.findMany({ where: { isActive: true, qrCode: null }, select: { id: true } });
  for (const r of missing) await db.roomQrCode.create({ data: { roomId: r.id, token: newQrToken() } });
  const rooms = await db.room.findMany({
    where: { isActive: true },
    select: {
      id: true, number: true, floor: true, status: true, roomType: { select: { name: true, category: true } },
      qrCode: { select: { token: true, active: true, regeneratedAt: true, createdAt: true, scanCount: true, lastScannedAt: true } },
      reservationRooms: { where: { status: "CHECKED_IN" }, take: 1, select: { reservation: { select: { guest: { select: { fullName: true } } } } } },
    },
  });
  return rooms.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
}

/** A new QR for a room (e.g. a card was taken): the old one stops working at once; past orders are untouched. */
export async function regenerateRoomQr(roomId: string, actor: Actor, now = new Date()) {
  if (!canManage(actor)) throw new AppError("Only a manager can change room QR codes.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    const room = await tx.room.findUnique({ where: { id: roomId }, select: { number: true, qrCode: { select: { token: true } } } });
    if (!room) throw new AppError("Room not found.", "NOT_FOUND");
    const token = newQrToken();
    await tx.roomQrCode.upsert({
      where: { roomId }, create: { roomId, token, generatedById: actor.userId ?? null },
      update: { token, regeneratedAt: now, generatedById: actor.userId ?? null, active: true, revokedAt: null },
    });
    await audit(tx, actor, { action: room.qrCode ? "room_qr.regenerated" : "room_qr.generated", entityType: "Room", entityId: roomId, before: { room: room.number }, after: { room: room.number } });
    return token;
  });
}

/** Switch a room's QR off (e.g. the room is closed) or back on. */
export async function setRoomQrActive(roomId: string, active: boolean, actor: Actor, now = new Date()) {
  if (!canManage(actor)) throw new AppError("Only a manager can change room QR codes.", "FORBIDDEN");
  await db.$transaction(async (tx) => {
    const code = await tx.roomQrCode.findUnique({ where: { roomId }, include: { room: { select: { number: true } } } });
    if (!code) throw new AppError("This room has no QR yet.", "NOT_FOUND");
    await tx.roomQrCode.update({ where: { roomId }, data: { active, revokedAt: active ? null : now } });
    await audit(tx, actor, { action: active ? "room_qr.enabled" : "room_qr.disabled", entityType: "Room", entityId: roomId, before: { room: code.room.number, active: code.active }, after: { room: code.room.number, active } });
  });
}

// ───────────────────────── Scanning ─────────────────────────

/** The stay checked in to this room right now (a guest's stay, or a meeting in use). */
export async function activeStayInRoom(roomId: string) {
  const rr = await db.reservationRoom.findFirst({
    where: { roomId, status: "CHECKED_IN", reservation: { status: "CHECKED_IN" } },
    orderBy: { checkedInAt: "desc" },
    select: { reservationId: true },
  });
  return rr?.reservationId ?? null;
}

/**
 * What a scan of this QR opens: the stay checked in to the room now, or — when the room is
 * free — the room itself (type, status, price, photos). Counts the scan.
 */
export async function scanRoomQr(token: string, now = new Date()) {
  const room = await roomForQr(token);
  if (!room) return null;
  if (!room.active) return { room, stay: null, info: null };
  await db.roomQrCode.update({ where: { token }, data: { scanCount: { increment: 1 }, lastScannedAt: now } });
  const reservationId = await activeStayInRoom(room.roomId);
  const stay = reservationId ? await stayView({ id: reservationId }) : null;
  const r = await db.room.findUniqueOrThrow({
    where: { id: room.roomId },
    select: {
      roomType: {
        select: {
          name: true, slug: true, baseRate: true, maxAdults: true, maxChildren: true, bedType: true, sizeSqm: true, shortDescription: true, images: true,
          media: { where: { isActive: true }, take: 3, orderBy: { sortOrder: "asc" }, select: { id: true, url: true } },
          amenities: { select: { amenity: { select: { name: true } } }, take: 8 },
        },
      },
    },
  });
  const t = r.roomType;
  const imgs = Array.isArray(t.images) ? (t.images as unknown[]).filter((x): x is string => typeof x === "string") : [];
  return {
    room, stay,
    info: {
      type: t.name, slug: t.slug, price: t.baseRate, adults: t.maxAdults, children: t.maxChildren, bed: t.bedType, size: t.sizeSqm, blurb: t.shortDescription,
      photo: imgs[0] ?? (t.media[0] ? mediaUrl(t.media[0]) : null), amenities: t.amenities.map((a) => a.amenity.name),
    },
  };
}

/** An order from the room QR: for the stay checked in to that room at this moment — found here, not sent by the phone. */
export async function placeRoomQrOrder(token: string, input: StayOrderInput, now = new Date()) {
  const room = await roomForQr(token);
  if (!room || !room.active) throw new AppError("This QR code is not active — please contact reception.", "VALIDATION");
  const reservationId = await activeStayInRoom(room.roomId);
  if (!reservationId) throw new AppError(`No one is checked in to ${room.meeting ? "the meeting room" : `Room ${room.number}`} right now — please contact reception to order.`, "VALIDATION");
  return placeOrderForStay(reservationId, input, "ROOM_QR", now, { roomId: room.roomId });
}

/** The guest asks for something from the room's QR: for the stay checked in to that room now. */
export async function askFromRoomQr(token: string, input: Parameters<typeof createGuestRequest>[1], now = new Date()) {
  const room = await roomForQr(token);
  if (!room || !room.active) throw new AppError("This QR code is not active — please contact reception.", "VALIDATION");
  const reservationId = await activeStayInRoom(room.roomId);
  if (!reservationId) throw new AppError(`No one is checked in to ${room.meeting ? "the meeting room" : `Room ${room.number}`} right now — please contact reception.`, "VALIDATION");
  return createGuestRequest(reservationId, input, "ROOM_QR", now, { roomId: room.roomId });
}
