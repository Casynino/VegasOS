import "server-only";
import { randomBytes, randomInt } from "node:crypto";
import { db, type Tx } from "../db";
import type { HotelSettings, SpinSession } from "@/generated/prisma/client";
import { audit } from "../audit";
import { AppError, isUniqueViolation } from "../errors";
import { getSettings, getSettingsTx, stayConfig } from "../settings";
import { addDays, businessDateOf, businessDayBounds, businessRangeBounds, fromDbDate, localParts, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { convertQty } from "@/lib/inventory";
import { msg } from "@/i18n/msg";
import { mediaUrl } from "./media";
import { createGiftOrderTx } from "./restaurant";
import { menuNamesNow } from "./translations";
import { GIFT_DECLINED, dayPartOf, greetingName, pickPrize, spinBudgetOf, spinRunsOn, spinTierOf, wheelFor, wheelSpent, type DayPart, type Prize, type SpinTierChoice, type SpinWhere } from "@/lib/spin";

/**
 * Spin to Win — a little something extra for a guest staying in a room.
 *
 * The card in the room carries the room's own Spin QR. It belongs to the room and says nothing about a guest; the
 * spins and the gifts belong to the stay. So every scan, every spin and every gift is checked here, on the server,
 * against who is checked in to that room at that very moment:
 *  - nobody checked in (a free room, a checked-out guest, a wrong or switched-off code) → no wheel and no gift;
 *  - a new guest starts fresh — nothing is inherited from the guest before;
 *  - a reload, a second phone, a second tap never give another spin: the count lives in the database, and each
 *    spin carries a key that is answered once and replayed after that.
 *
 * The prize is chosen and saved before the wheel moves; the phone only plays back where it stopped. All the gifts of
 * one stay together never cost more than the stay's budget (`lib/spin.ts`), and the database refuses it too.
 * A gift is a real menu item sent through the restaurant's own orders — never a charge, a payment or income.
 *
 * A guest may also say "no, thank you" to a gift: nothing is ordered, the spin stays used, and the gift is not
 * counted among the gifts given.
 */

type Actor = { userId?: string | null; label?: string; ipAddress?: string | null; permissions?: ReadonlySet<string> };
type Client = Tx | typeof db;

const newToken = () => randomBytes(9).toString("base64url");
const canManage = (a: Actor) => !!a.permissions?.has("spin.manage");
const guestActor = (ip?: string | null): Actor => ({ userId: null, label: "Guest", ipAddress: ip ?? null });

const CLOSED = msg("Spin to Win is for guests checked in to this room.");
const closed = () => new AppError(CLOSED, "FORBIDDEN");

const runs = (s: HotelSettings, now: Date) =>
  spinRunsOn(businessDateOf(now, stayConfig(s)), {
    spinEnabled: s.spinEnabled,
    spinStartsOn: s.spinStartsOn ? fromDbDate(s.spinStartsOn) : null,
    spinEndsOn: s.spinEndsOn ? fromDbDate(s.spinEndsOn) : null,
  });

// ───────────────────────── The room's card ─────────────────────────

const ROOM = { id: true, number: true, isActive: true, spinTier: true, roomType: { select: { name: true, code: true, category: true, spinTier: true } } } as const;

/** The room behind a scanned Spin QR — nothing when the code is unknown, switched off, or the room is closed. */
async function roomForSpinQr(token: string) {
  if (!/^[A-Za-z0-9_-]{8,24}$/.test(token)) return null;
  const code = await db.spinQrCode.findUnique({ where: { token }, select: { id: true, active: true, room: { select: ROOM } } });
  if (!code || !code.active || !code.room.isActive) return null;
  return { codeId: code.id, room: code.room };
}
type SpinRoom = NonNullable<Awaited<ReturnType<typeof roomForSpinQr>>>["room"];

/** Who is checked in to the room right now (a night stay — not a short-time stay). */
function stayNow(tx: Client, roomId: string) {
  return tx.reservationRoom.findFirst({
    where: { roomId, status: "CHECKED_IN", isDayUse: false, reservation: { status: "CHECKED_IN" } },
    orderBy: { checkedInAt: "desc" },
    select: { id: true, reservationId: true, reservation: { select: { reference: true, guest: { select: { fullName: true } } } } },
  });
}

/**
 * The same, with the stay held until the transaction ends: a check-out, a room move or a second spin from another
 * phone waits its turn — and is then judged on what is true after this one.
 */
async function lockStayTx(tx: Tx, roomId: string) {
  const found = await stayNow(tx, roomId);
  if (!found) return null;
  await tx.$queryRaw`SELECT "id" FROM "reservation_rooms" WHERE "id" = ${found.id} FOR UPDATE`;
  const still = await stayNow(tx, roomId);
  return still && still.id === found.id ? still : null;
}

/**
 * The stay's spins — made once, the first time the guest opens the wheel, with the spins and the budget of that
 * moment. A later change of settings, a longer stay or a move to another room never adds a spin.
 */
async function sessionTx(tx: Tx, stay: NonNullable<Awaited<ReturnType<typeof stayNow>>>, room: SpinRoom, s: HotelSettings) {
  const have = await tx.spinSession.findUnique({ where: { reservationRoomId: stay.id } });
  if (have) return have.roomId === room.id ? have : tx.spinSession.update({ where: { id: have.id }, data: { roomId: room.id, roomNumber: room.number } });
  const tier = spinTierOf(room);
  if (!tier) return null;
  return tx.spinSession.create({
    data: {
      reservationRoomId: stay.id, reservationId: stay.reservationId, roomId: room.id, roomNumber: room.number,
      guestName: stay.reservation.guest.fullName, tier, spinsAllowed: Math.max(1, s.spinsPerStay), budget: Math.max(0, spinBudgetOf(tier, s)),
    },
  });
}

// ───────────────────────── The gifts ─────────────────────────

export type Gift = Prize & { price: number; category: string; nameI18n: Record<string, string>; image: string | null };

/**
 * What can be given away right now: food and soft drinks that are on the menu and available, within the price the
 * hotel allows (or chosen by the Admin), with their ingredients in the stores. Never anything from the bar.
 */
async function giftsNow(tx: Client, s: { spinMaxItemPrice: number }): Promise<Gift[]> {
  const items = await tx.menuItem.findMany({
    where: { isActive: true, isAvailable: true, category: { isActive: true, revenueKind: { not: "BAR" } } },
    select: {
      id: true, name: true, price: true, category: { select: { name: true } }, image: { select: { id: true, url: true } },
      spinPrize: { select: { enabled: true, valueOverride: true, weight: true } },
      recipe: { select: { quantity: true, unit: true, item: { select: { quantity: true, unit: true, isActive: true } } } },
    },
    orderBy: [{ price: "asc" }, { id: "asc" }],
  });
  const ok = items.filter((m) => {
    if (m.spinPrize ? !m.spinPrize.enabled : m.price > s.spinMaxItemPrice) return false;
    // A dish whose ingredients have run out is not promised to anyone.
    return m.recipe.every((l) => {
      if (!l.item.isActive) return true;
      const need = convertQty(l.quantity, l.unit, l.item.unit);
      return need === null || l.item.quantity >= need;
    });
  });
  const names = await menuNamesNow(tx, ok);
  return ok.map((m) => ({
    id: m.id, name: m.name, price: m.price, category: m.category.name, value: Math.max(0, m.spinPrize?.valueOverride ?? m.price), weight: Math.max(1, m.spinPrize?.weight ?? 1),
    nameI18n: names.get(m.id) ?? {}, image: m.image ? mediaUrl(m.image) : null,
  }));
}

export type Segment = { id: string; name: string; nameI18n: Record<string, string>; image: string | null };
const segment = (g: Gift): Segment => ({ id: g.id, name: g.name, nameI18n: g.nameI18n, image: g.image });

/** The wheel of one spin of a stay — the same on every phone and every reload, only gifts that can be won now. */
function wheelOf(gifts: Gift[], session: Pick<SpinSession, "id" | "budget" | "spinsAllowed">, before: { menuItemId: string; value: number; fulfilment: string | null }[]) {
  // A gift the guest refused is not spent, but on the wheel it counts as the smallest gift: refusing never wins a bigger one.
  const given = wheelSpent(before.map((r) => ({ value: r.value, declined: r.fulfilment === GIFT_DECLINED })), gifts);
  const left = { budget: session.budget - given, spins: session.spinsAllowed - before.length };
  const wheel = wheelFor(gifts, left, new Set(before.map((r) => r.menuItemId)), `${session.id}:${before.length + 1}`);
  const byId = new Map(gifts.map((g) => [g.id, g]));
  return wheel.map((p) => byId.get(p.id)!);
}

/** Staff hear about a wheel with nothing to give — once in a while, not on every tap. */
async function alertNoGiftTx(tx: Client, session: Pick<SpinSession, "id" | "roomNumber" | "guestName" | "budget" | "valueUsed" | "spinsUsed" | "spinsAllowed">, now: Date) {
  const recent = await tx.auditLog.findFirst({ where: { action: "spin.no_gift", entityId: session.id, createdAt: { gte: new Date(now.getTime() - 30 * 60_000) } }, select: { id: true } });
  if (recent) return;
  await audit(tx, { userId: null, label: "system" }, {
    action: "spin.no_gift", entityType: "SpinSession", entityId: session.id,
    after: { room: session.roomNumber, guest: session.guestName, spinsLeft: session.spinsAllowed - session.spinsUsed, budgetLeft: session.budget - session.valueUsed },
  });
}

// ───────────────────────── What the guest sees ─────────────────────────

export type Won = {
  id: string; spinNumber: number; name: string; nameI18n: Record<string, string>; image: string | null;
  where: SpinWhere | null; orderNumber: string | null; orderStatus: string | null;
  /** The guest said "no, thank you" — nothing was ordered. */
  declined: boolean;
};
export type SpinView =
  | { open: false }
  | {
    open: true; firstName: string; roomNumber: string; spinsAllowed: number; spinsUsed: number; introSeen: boolean;
    /** Morning, afternoon or evening at the hotel — for the greeting. */
    dayPart: DayPart;
    /** Switched off (or outside its dates) after the guest began: what they won stays, no new spins. */
    paused: boolean;
    /** Nothing can be given right now (staff have been told). */
    noGift: boolean;
    wheel: Segment[]; results: Won[];
    /** A gift won and not yet asked for (or refused): where would the guest like it? */
    pending: Won | null;
    allowRoom: boolean; allowRestaurant: boolean; sameForAll: SpinWhere | null;
  };

const RESULT = { menuItem: { select: { image: { select: { id: true, url: true } } } }, order: { select: { number: true, status: true } } } as const;
type ResultRow = { id: string; spinNumber: number; name: string; nameI18n: unknown; fulfilment: string | null; menuItem: { image: { id: string; url: string | null } | null }; order: { number: string; status: string } | null };
const won = (r: ResultRow): Won => ({
  id: r.id, spinNumber: r.spinNumber, name: r.name, nameI18n: (r.nameI18n ?? {}) as Record<string, string>,
  image: r.menuItem.image ? mediaUrl(r.menuItem.image) : null,
  where: r.fulfilment === "ROOM" || r.fulfilment === "RESTAURANT" ? r.fulfilment : null,
  orderNumber: r.order?.number ?? null, orderStatus: r.order?.status ?? null, declined: r.fulfilment === GIFT_DECLINED,
});

/** The page behind the room's Spin QR. Closed (one quiet page, no reasons given) unless a guest is checked in. */
export async function spinView(token: string, now = new Date(), opts: { count?: boolean } = {}): Promise<SpinView> {
  const code = await roomForSpinQr(token);
  if (!code) return { open: false };
  if (opts.count !== false) await db.spinQrCode.update({ where: { id: code.codeId }, data: { scanCount: { increment: 1 }, lastScannedAt: now } }).catch(() => null);
  const settings = await getSettings();
  const running = runs(settings, now);
  const stay = await stayNow(db, code.room.id);
  if (!stay) return { open: false };
  let session = await db.spinSession.findUnique({ where: { reservationRoomId: stay.id } });
  if (!session || session.roomId !== code.room.id) {
    if (!session && !running) return { open: false };
    const make = () => db.$transaction(async (tx) => {
      const held = await lockStayTx(tx, code.room.id);
      return held ? sessionTx(tx, held, code.room, settings) : null;
    });
    session = await make().catch((e) => { if (isUniqueViolation(e)) return make(); throw e; });
  }
  if (!session) return { open: false };
  const rows = await db.spinResult.findMany({ where: { sessionId: session.id }, orderBy: { spinNumber: "asc" }, include: RESULT });
  // Switched off before the guest won anything: there is nothing to show.
  if (!running && !rows.length) return { open: false };
  const left = session.spinsAllowed - session.spinsUsed;
  const wheel = running && left > 0 ? wheelOf(await giftsNow(db, settings), session, rows) : [];
  const noGift = running && left > 0 && !wheel.length;
  if (noGift) await alertNoGiftTx(db, session, now).catch(() => null);
  const results = rows.map(won);
  return {
    open: true, firstName: greetingName(session.guestName), roomNumber: session.roomNumber, dayPart: dayPartOf(localParts(now, settings.timezone).hour),
    spinsAllowed: session.spinsAllowed, spinsUsed: session.spinsUsed, introSeen: !!session.introSeenAt || session.spinsUsed > 0,
    paused: !running, noGift, wheel: wheel.map(segment), results, pending: results.find((r) => !r.orderNumber && !r.declined) ?? null,
    allowRoom: settings.spinAllowRoom, allowRestaurant: settings.spinAllowRestaurant,
    sameForAll: session.fulfilment === "ROOM" || session.fulfilment === "RESTAURANT" ? session.fulfilment : null,
  };
}

/** The guest has read the welcome. */
export async function beginSpin(token: string, now = new Date()) {
  const code = await roomForSpinQr(token);
  const stay = code && await stayNow(db, code.room.id);
  if (!stay) throw closed();
  await db.spinSession.updateMany({ where: { reservationRoomId: stay.id, introSeenAt: null }, data: { introSeenAt: now } });
}

// ───────────────────────── One spin ─────────────────────────

export type SpinOutcome = {
  result: Won; wheel: Segment[];
  /** The segment the wheel stops on. */
  index: number;
  spinsUsed: number; spinsAllowed: number;
};

async function spinTx(tx: Tx, room: SpinRoom, clientKey: string, now: Date, ip?: string | null): Promise<SpinOutcome | "NO_GIFT"> {
  // Only for the guest checked in to this room now — looked up here, never taken from the phone.
  const stay = await lockStayTx(tx, room.id);
  if (!stay) throw closed();
  const settings = await getSettingsTx(tx);

  // Asked twice (a lost answer, a double tap, a replayed request): the spin already decided, never a new one.
  const prior = await tx.spinResult.findUnique({ where: { clientKey }, include: { ...RESULT, session: true } });
  if (prior) {
    if (prior.session.reservationRoomId !== stay.id) throw closed();
    const before = await tx.spinResult.findMany({ where: { sessionId: prior.sessionId, spinNumber: { lt: prior.spinNumber } }, select: { menuItemId: true, value: true, fulfilment: true } });
    const wheel = wheelOf(await giftsNow(tx, settings), prior.session, before).map(segment);
    let index = wheel.findIndex((g) => g.id === prior.menuItemId);
    if (index < 0) { index = 0; wheel.splice(0, wheel.length ? 1 : 0, { id: prior.menuItemId, name: prior.name, nameI18n: (prior.nameI18n ?? {}) as Record<string, string>, image: prior.menuItem.image ? mediaUrl(prior.menuItem.image) : null }); }
    return { result: won(prior), wheel, index, spinsUsed: prior.session.spinsUsed, spinsAllowed: prior.session.spinsAllowed };
  }

  if (!runs(settings, now)) throw new AppError("Spin to Win is not running right now.", "FORBIDDEN");
  const session = await sessionTx(tx, stay, room, settings);
  if (!session) throw closed();
  if (session.spinsUsed >= session.spinsAllowed) throw new AppError("You have used all your spins for this stay.", "CONFLICT");
  const before = await tx.spinResult.findMany({ where: { sessionId: session.id }, orderBy: { spinNumber: "asc" }, select: { menuItemId: true, value: true, orderId: true, fulfilment: true } });
  if (before.some((r) => !r.orderId && r.fulfilment !== GIFT_DECLINED)) throw new AppError("First choose where you would like your last gift.", "CONFLICT");

  // Checked again at this very moment: on the menu, available, in stock, and inside what the stay has left.
  const gifts = wheelOf(await giftsNow(tx, settings), session, before);
  const prize = pickPrize(gifts, (n) => randomInt(n));
  const gift = prize && gifts.find((g) => g.id === prize.id);
  if (!gift || session.valueUsed + gift.value > session.budget) {
    // Nothing fits: no spin is used. Staff are told.
    await alertNoGiftTx(tx, session, now);
    return "NO_GIFT";
  }

  const spinNumber = session.spinsUsed + 1;
  const row = await tx.spinResult.create({ data: { sessionId: session.id, spinNumber, clientKey, menuItemId: gift.id, name: gift.name, nameI18n: gift.nameI18n, value: gift.value, createdAt: now } });
  const moved = await tx.spinSession.updateMany({ where: { id: session.id, spinsUsed: session.spinsUsed, valueUsed: session.valueUsed }, data: { spinsUsed: { increment: 1 }, valueUsed: { increment: gift.value } } });
  if (moved.count !== 1) throw new AppError("Please try again.", "CONFLICT");

  // "The same for all my gifts": the gift goes straight to the restaurant, the way the guest chose.
  const where = session.fulfilment === "ROOM" || session.fulfilment === "RESTAURANT" ? session.fulfilment : null;
  const allowed = where && (where === "ROOM" ? settings.spinAllowRoom : settings.spinAllowRestaurant);
  const order = allowed ? await createGiftOrderTx(tx, { reservationId: stay.reservationId, roomNumber: room.number, menuItemId: gift.id, value: gift.value, where: where!, clientKey }, now) : null;
  if (order) await tx.spinResult.update({ where: { id: row.id }, data: { fulfilment: where, orderId: order.id, claimedAt: now } });

  await audit(tx, guestActor(ip), {
    action: "spin.won", entityType: "SpinSession", entityId: session.id,
    after: { room: room.number, guest: session.guestName, reservation: stay.reservation.reference, spin: spinNumber, of: session.spinsAllowed, gift: gift.name, value: gift.value, usedOfBudget: `${session.valueUsed + gift.value} / ${session.budget}`, order: order?.number ?? null },
  });
  return {
    result: { id: row.id, spinNumber, name: gift.name, nameI18n: gift.nameI18n, image: gift.image, where: order ? where : null, orderNumber: order?.number ?? null, orderStatus: order?.status ?? null, declined: false },
    wheel: gifts.map(segment), index: gifts.findIndex((g) => g.id === gift.id), spinsUsed: spinNumber, spinsAllowed: session.spinsAllowed,
  };
}

/**
 * One spin. `clientKey` names this press of the button: the first request with it decides the prize, every later
 * one gets that same prize back. Nothing is used up unless a gift was really given.
 */
export async function spinOnce(token: string, clientKey: string, now = new Date(), ip?: string | null): Promise<SpinOutcome> {
  const code = await roomForSpinQr(token);
  if (!code) throw closed();
  const run = () => db.$transaction((tx) => spinTx(tx, code.room, clientKey, now, ip));
  // Two requests landing together: one of them made the spin — the other is answered from it.
  const out = await run().catch((e) => { if (isUniqueViolation(e)) return run(); throw e; });
  if (out === "NO_GIFT") throw new AppError("Our gifts are being restocked — please try again a little later, or ask reception. Your spin has not been used.", "UNAVAILABLE");
  return out;
}

/** Where the guest would like a gift they won: to their room, or at the restaurant. Asked once per gift. */
export async function claimGift(token: string, resultId: string, where: SpinWhere, sameForAll: boolean, now = new Date(), ip?: string | null) {
  const code = await roomForSpinQr(token);
  if (!code) throw closed();
  return db.$transaction(async (tx) => {
    const stay = await lockStayTx(tx, code.room.id);
    if (!stay) throw closed();
    const r = await tx.spinResult.findUnique({ where: { id: resultId }, include: { session: true, order: { select: { number: true } } } });
    if (!r || r.session.reservationRoomId !== stay.id) throw new AppError("That gift was not found.", "NOT_FOUND");
    // Already asked for (a second tap): the same order, not a second one.
    if (r.orderId) return { where: (r.fulfilment === "RESTAURANT" ? "RESTAURANT" : "ROOM") as SpinWhere, orderNumber: r.order?.number ?? null };
    if (r.fulfilment === GIFT_DECLINED) throw new AppError("You chose not to take this gift.", "CONFLICT");
    const settings = await getSettingsTx(tx);
    if (!(where === "ROOM" ? settings.spinAllowRoom : settings.spinAllowRestaurant)) throw new AppError("That choice is not available right now — please pick the other one.", "VALIDATION");
    const order = await createGiftOrderTx(tx, { reservationId: stay.reservationId, roomNumber: code.room.number, menuItemId: r.menuItemId, value: r.value, where, clientKey: r.clientKey }, now);
    await tx.spinResult.update({ where: { id: r.id }, data: { fulfilment: where, orderId: order.id, claimedAt: now } });
    if (sameForAll) await tx.spinSession.update({ where: { id: r.sessionId }, data: { fulfilment: where } });
    await audit(tx, guestActor(ip), {
      action: "spin.claimed", entityType: "SpinSession", entityId: r.sessionId,
      after: { room: code.room.number, guest: r.session.guestName, gift: r.name, value: r.value, where, order: order.number, sameForAll },
    });
    return { where, orderNumber: order.number as string | null };
  });
}

/**
 * "No, thank you": the guest does not want a gift they won. Nothing is prepared and nothing is ordered. The spin
 * stays used — a refused gift is never swapped for another — and what it was worth goes back to the stay's budget:
 * the hotel gives away only what a guest takes, so the spins still to come are not made smaller by a "no".
 */
export async function declineGift(token: string, resultId: string, now = new Date(), ip?: string | null) {
  const code = await roomForSpinQr(token);
  if (!code) throw closed();
  return db.$transaction(async (tx) => {
    const stay = await lockStayTx(tx, code.room.id);
    if (!stay) throw closed();
    const r = await tx.spinResult.findUnique({ where: { id: resultId }, include: { session: true } });
    if (!r || r.session.reservationRoomId !== stay.id) throw new AppError("That gift was not found.", "NOT_FOUND");
    // Said twice (a second tap): still just the one "no".
    if (r.fulfilment === GIFT_DECLINED) return { declined: true };
    // Already asked for — the kitchen may be making it. Reception can help.
    if (r.orderId) throw new AppError("This gift is already being prepared — please ask reception if you no longer want it.", "CONFLICT");
    const done = await tx.spinResult.updateMany({ where: { id: r.id, orderId: null, fulfilment: null }, data: { fulfilment: GIFT_DECLINED, claimedAt: now } });
    if (done.count !== 1) throw new AppError("Please try again.", "CONFLICT");
    // Not given, so not spent: the stay's budget gets it back (read under the stay's lock, so no other spin is in between).
    await tx.spinSession.update({ where: { id: r.sessionId }, data: { valueUsed: Math.max(0, r.session.valueUsed - r.value) } });
    await audit(tx, guestActor(ip), {
      action: "spin.declined", entityType: "SpinSession", entityId: r.sessionId,
      after: { room: code.room.number, guest: r.session.guestName, reservation: stay.reservation.reference, spin: r.spinNumber, of: r.session.spinsAllowed, gift: r.name, value: r.value },
    });
    return { declined: true };
  });
}

// ───────────────────────── Staff: cards, settings, what was given ─────────────────────────

/** Every guest room with its Spin QR (made the first time the rooms are listed). The meeting room has none. */
export async function spinQrCodes() {
  const guestRooms = { isActive: true, roomType: { category: "GUEST_ROOM" as const } };
  const missing = await db.room.findMany({ where: { ...guestRooms, spinQr: null }, select: { id: true } });
  for (const r of missing) await db.spinQrCode.create({ data: { roomId: r.id, token: newToken() } }).catch((e) => { if (!isUniqueViolation(e)) throw e; });
  const rooms = await db.room.findMany({
    where: guestRooms,
    select: {
      ...ROOM, floor: true,
      spinQr: { select: { token: true, active: true, regeneratedAt: true, scanCount: true, lastScannedAt: true } },
      reservationRooms: {
        where: { status: "CHECKED_IN", isDayUse: false, reservation: { status: "CHECKED_IN" } }, take: 1, orderBy: { checkedInAt: "desc" },
        select: { reservation: { select: { guest: { select: { fullName: true } } } }, spinSession: { select: { spinsUsed: true, spinsAllowed: true, valueUsed: true, budget: true } } },
      },
    },
  });
  return rooms.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })).map((r) => ({
    id: r.id, number: r.number, floor: r.floor, type: r.roomType.name, tier: spinTierOf(r),
    qr: r.spinQr, guest: r.reservationRooms[0]?.reservation.guest.fullName ?? null, session: r.reservationRooms[0]?.spinSession ?? null,
  }));
}

/** A new Spin QR for a room (a card went missing): the old one stops at once. Spins already used stay used. */
export async function regenerateSpinQr(roomId: string, actor: Actor, now = new Date()) {
  if (!canManage(actor)) throw new AppError("Only the Admin can change Spin to Win cards.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    const room = await tx.room.findUnique({ where: { id: roomId }, select: { number: true } });
    if (!room) throw new AppError("Room not found.", "NOT_FOUND");
    const token = newToken();
    await tx.spinQrCode.upsert({
      where: { roomId }, create: { roomId, token, generatedById: actor.userId ?? null },
      update: { token, active: true, generatedById: actor.userId ?? null, regeneratedAt: now, scanCount: 0, lastScannedAt: null },
    });
    await audit(tx, actor, { action: "spin_qr.regenerated", entityType: "Room", entityId: roomId, after: { room: room.number } });
    return token;
  });
}

export async function setSpinQrActive(roomId: string, active: boolean, actor: Actor) {
  if (!canManage(actor)) throw new AppError("Only the Admin can change Spin to Win cards.", "FORBIDDEN");
  await db.$transaction(async (tx) => {
    const code = await tx.spinQrCode.findUnique({ where: { roomId }, select: { active: true, room: { select: { number: true } } } });
    if (!code) throw new AppError("This room has no Spin to Win card yet.", "NOT_FOUND");
    if (code.active === active) return;
    await tx.spinQrCode.update({ where: { roomId }, data: { active } });
    await audit(tx, actor, { action: active ? "spin_qr.enabled" : "spin_qr.disabled", entityType: "Room", entityId: roomId, after: { room: code.room.number } });
  });
}

export type SpinSettingsInput = {
  enabled: boolean; spinsPerStay: number; budgetStandard: number; budgetPremium: number; maxItemPrice: number;
  allowRoom: boolean; allowRestaurant: boolean; startsOn: BusinessDate | null; endsOn: BusinessDate | null;
};

const settingsOf = (s: HotelSettings): SpinSettingsInput => ({
  enabled: s.spinEnabled, spinsPerStay: s.spinsPerStay, budgetStandard: s.spinBudgetStandard, budgetPremium: s.spinBudgetPremium, maxItemPrice: s.spinMaxItemPrice,
  allowRoom: s.spinAllowRoom, allowRestaurant: s.spinAllowRestaurant,
  startsOn: s.spinStartsOn ? fromDbDate(s.spinStartsOn) : null, endsOn: s.spinEndsOn ? fromDbDate(s.spinEndsOn) : null,
});

/** The switch and the numbers. They shape the stays that begin spinning from now on — a stay already spinning keeps its own. */
export async function saveSpinSettings(input: SpinSettingsInput, actor: Actor) {
  if (!canManage(actor)) throw new AppError("Only the Admin can change Spin to Win.", "FORBIDDEN");
  if (!input.allowRoom && !input.allowRestaurant) throw new AppError("Leave at least one way for guests to enjoy a gift: in the room, or at the restaurant.", "VALIDATION");
  if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) throw new AppError("The last day is before the first day.", "VALIDATION", { endsOn: "Check the dates" });
  await db.$transaction(async (tx) => {
    const before = settingsOf(await getSettingsTx(tx));
    await tx.hotelSettings.update({
      where: { id: 1 },
      data: {
        spinEnabled: input.enabled, spinsPerStay: input.spinsPerStay, spinBudgetStandard: input.budgetStandard, spinBudgetPremium: input.budgetPremium,
        spinMaxItemPrice: input.maxItemPrice, spinAllowRoom: input.allowRoom, spinAllowRestaurant: input.allowRestaurant,
        spinStartsOn: input.startsOn ? toDbDate(input.startsOn) : null, spinEndsOn: input.endsOn ? toDbDate(input.endsOn) : null,
      },
    });
    await audit(tx, actor, { action: before.enabled === input.enabled ? "spin.settings" : input.enabled ? "spin.enabled" : "spin.disabled", entityType: "HotelSettings", entityId: "1", before, after: input });
  });
}

/** A room type's tier (Standard, Premium, or no Spin to Win) — for the stays that begin spinning from now on. */
export async function setSpinTier(target: { roomTypeId: string } | { roomId: string }, tier: SpinTierChoice | null, actor: Actor) {
  if (!canManage(actor)) throw new AppError("Only the Admin can change Spin to Win.", "FORBIDDEN");
  await db.$transaction(async (tx) => {
    if ("roomTypeId" in target) {
      const t = await tx.roomType.update({ where: { id: target.roomTypeId }, data: { spinTier: tier }, select: { name: true } });
      await audit(tx, actor, { action: "spin.tier", entityType: "RoomType", entityId: target.roomTypeId, after: { roomType: t.name, tier: tier ?? "default" } });
    } else {
      const r = await tx.room.update({ where: { id: target.roomId }, data: { spinTier: tier }, select: { number: true } });
      await audit(tx, actor, { action: "spin.tier", entityType: "Room", entityId: target.roomId, after: { room: r.number, tier: tier ?? "default" } });
    }
  });
}

/** The Spin to Win page for staff: the switch and numbers, what can be won now, what was given, what needs a look. */
export async function spinBoard(now = new Date()) {
  const s = await getSettings();
  const cfg = stayConfig(s);
  const today = businessDateOf(now, cfg);
  const day = businessDayBounds(today, cfg);
  const month = businessRangeBounds(`${today.slice(0, 7)}-01`, today, cfg);
  const since = new Date(now.getTime() - 24 * 3600_000);
  // Given = won and not refused. (A plain "not DECLINED" would also drop the gifts still waiting for a choice.)
  const given = { OR: [{ fulfilment: null }, { fulfilment: { not: GIFT_DECLINED } }] };
  const [gifts, types, recent, dayTotal, monthTotal, noGift, unclaimed] = await Promise.all([
    giftsNow(db, s),
    db.roomType.findMany({ where: { category: "GUEST_ROOM", isActive: true }, select: { id: true, name: true, code: true, category: true, spinTier: true }, orderBy: { sortOrder: "asc" } }),
    db.spinResult.findMany({
      orderBy: { createdAt: "desc" }, take: 60,
      select: { id: true, createdAt: true, spinNumber: true, name: true, value: true, fulfilment: true, session: { select: { roomNumber: true, guestName: true, spinsAllowed: true } }, order: { select: { number: true, status: true } } },
    }),
    db.spinResult.aggregate({ where: { createdAt: { gte: day.start, lt: day.end }, ...given }, _count: true, _sum: { value: true } }),
    db.spinResult.aggregate({ where: { createdAt: { gte: month.start, lt: month.end }, ...given }, _count: true, _sum: { value: true } }),
    db.auditLog.findMany({ where: { action: "spin.no_gift", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, createdAt: true, after: true } }),
    db.spinResult.findMany({
      where: { orderId: null, fulfilment: null, session: { reservationRoom: { status: "CHECKED_IN" } } }, orderBy: { createdAt: "desc" }, take: 20,
      select: { id: true, createdAt: true, name: true, session: { select: { roomNumber: true, guestName: true } } },
    }),
  ]);
  return {
    settings: settingsOf(s), running: runs(s, now), today, tomorrow: addDays(today, 1),
    gifts: gifts.map((g) => ({ id: g.id, name: g.name, category: g.category, price: g.price, value: g.value })),
    types: types.map((t) => ({ id: t.id, name: t.name, chosen: t.spinTier, tier: spinTierOf({ spinTier: null, roomType: t }) })),
    recent, unclaimed,
    given: { today: { count: dayTotal._count, value: dayTotal._sum.value ?? 0 }, month: { count: monthTotal._count, value: monthTotal._sum.value ?? 0 } },
    noGift: noGift.map((a) => ({ id: a.id, at: a.createdAt, ...((a.after ?? {}) as { room?: string; guest?: string }) })),
  };
}

// ───────────────────────── Staff: which menu items are gifts ─────────────────────────

export type GiftChoice = "RULE" | "ALWAYS" | "NEVER";

/**
 * Every food and soft-drink item on the menu, and whether it is a gift right now — with the reason when it is not
 * (above the price limit, switched off on the menu, an ingredient has run out, or the Admin said never).
 */
export async function spinGiftList() {
  const s = await getSettings();
  const [items, now] = await Promise.all([
    db.menuItem.findMany({
      where: { isActive: true, category: { isActive: true, revenueKind: { not: "BAR" } } },
      select: { id: true, name: true, price: true, isAvailable: true, category: { select: { name: true } }, spinPrize: { select: { enabled: true, valueOverride: true, weight: true } } },
      orderBy: [{ price: "asc" }, { name: "asc" }],
    }),
    giftsNow(db, s),
  ]);
  const live = new Set(now.map((g) => g.id));
  return items.map((m) => {
    const choice: GiftChoice = m.spinPrize ? (m.spinPrize.enabled ? "ALWAYS" : "NEVER") : "RULE";
    const wanted = choice === "ALWAYS" || (choice === "RULE" && m.price <= s.spinMaxItemPrice);
    return {
      id: m.id, name: m.name, category: m.category.name, price: m.price, choice,
      value: Math.max(0, m.spinPrize?.valueOverride ?? m.price), valueOverride: m.spinPrize?.valueOverride ?? null, weight: Math.max(1, m.spinPrize?.weight ?? 1),
      gift: live.has(m.id),
      why: live.has(m.id) ? null : choice === "NEVER" ? ("NEVER" as const) : !wanted ? ("PRICE" as const) : !m.isAvailable ? ("OFF_MENU" as const) : ("NO_STOCK" as const),
    };
  });
}

/** The Admin's word on one menu item: by the price rule, always a gift, or never — and what it is worth, how often it comes up. */
export async function setSpinPrize(input: { menuItemId: string; choice: GiftChoice; valueOverride: number | null; weight: number }, actor: Actor) {
  if (!canManage(actor)) throw new AppError("Only the Admin can change Spin to Win.", "FORBIDDEN");
  await db.$transaction(async (tx) => {
    const item = await tx.menuItem.findUnique({ where: { id: input.menuItemId }, select: { name: true, category: { select: { revenueKind: true } } } });
    if (!item) throw new AppError("That menu item was not found.", "NOT_FOUND");
    if (item.category.revenueKind === "BAR" && input.choice === "ALWAYS") throw new AppError("Drinks from the bar are never Spin to Win gifts.", "VALIDATION");
    // By the price rule = nothing of its own (its menu price is its value, and it comes up like the others).
    if (input.choice === "RULE") await tx.spinPrize.deleteMany({ where: { menuItemId: input.menuItemId } });
    else {
      const data = { enabled: input.choice === "ALWAYS", valueOverride: input.choice === "ALWAYS" ? input.valueOverride : null, weight: input.choice === "ALWAYS" ? input.weight : 1 };
      await tx.spinPrize.upsert({ where: { menuItemId: input.menuItemId }, create: { menuItemId: input.menuItemId, ...data }, update: data });
    }
    await audit(tx, actor, { action: "spin.prize", entityType: "MenuItem", entityId: input.menuItemId, after: { item: item.name, choice: input.choice, value: input.valueOverride, weight: input.weight } });
  });
}
