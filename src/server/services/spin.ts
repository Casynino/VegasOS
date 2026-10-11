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
import {
  GIFTS_PER_STAY, GIFT_DECLINED, afterSpin, budgetLeft, dayPartOf, greetingName, oddsFor, spinBudgetOf, spinEnd, spinRunsOn, spinStop, spinTierOf, spinsLeft, wheelFor,
  type DayPart, type Prize, type Slot, type SpinEnd, type SpinKind, type SpinState, type SpinTierChoice, type SpinWhere,
} from "@/lib/spin";

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
 * One stay: its spins, at most two gifts, at most one bonus spin (`lib/spin.ts`). A spin ends on a gift, on "try
 * again", or on the bonus spin. How it ends is chosen and saved before the wheel moves; the phone only plays back
 * where it stopped. All the gifts of one stay together never cost more than the stay's budget, and the database
 * refuses it too.
 *
 * The guest plays to the end (or says "finish now"), and then all their gifts go to the restaurant together, as ONE
 * order — a real order in the restaurant's own workflow, never a charge, a payment or income. A gift the guest does
 * not want is simply left out of it.
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
 * The stay's game — made once, the first time the guest opens the wheel, with the spins and the budget of that
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
      guestName: stay.reservation.guest.fullName, tier, spinsAllowed: Math.max(1, s.spinsPerStay), budget: Math.max(0, spinBudgetOf(tier, s)), prizesAllowed: GIFTS_PER_STAY,
    },
  });
}

const stateOf = (s: SpinSession): SpinState => ({
  spinsAllowed: s.spinsAllowed, spinsUsed: s.spinsUsed, bonusAwarded: s.bonusAwarded, bonusUsed: s.bonusUsed,
  prizesAllowed: s.prizesAllowed, prizesWon: s.prizesWon, budget: s.budget, valueUsed: s.valueUsed,
});

export type SpinBonus = "NONE" | "AVAILABLE" | "USED";
const bonusOf = (s: SpinState): SpinBonus => (s.bonusUsed ? "USED" : s.bonusAwarded ? "AVAILABLE" : "NONE");
const kindOf = (k: string): SpinKind => (k === "FREE_SPIN" || k === "TRY_AGAIN" ? k : "GIFT");
const endWord = (w: string | null): SpinEnd => (w === "PRIZES" || w === "BUDGET" || w === "GUEST" ? w : "SPINS");

// ───────────────────────── The gifts ─────────────────────────

/** A menu item the hotel gives as a gift. `ready` = on the menu and in stock at this very moment. */
export type Gift = Prize & { price: number; category: string; nameI18n: Record<string, string>; image: string | null; ready: boolean };

/**
 * Every gift the hotel offers: food and soft drinks on the menu, within the price the hotel allows (or chosen by the
 * Admin). Never anything from the bar. One that is switched off on the menu for now, or whose ingredients have run
 * out, is still a gift of the hotel — just not `ready`: it is promised to nobody until it is back.
 */
async function giftCatalog(tx: Client, s: { spinMaxItemPrice: number }): Promise<Gift[]> {
  const items = await tx.menuItem.findMany({
    where: { isActive: true, category: { isActive: true, revenueKind: { not: "BAR" } } },
    select: {
      id: true, name: true, price: true, isAvailable: true, category: { select: { name: true } }, image: { select: { id: true, url: true } },
      spinPrize: { select: { enabled: true, valueOverride: true, weight: true } },
      recipe: { select: { quantity: true, unit: true, item: { select: { quantity: true, unit: true, isActive: true } } } },
    },
    orderBy: [{ price: "asc" }, { id: "asc" }],
  });
  const offered = items.filter((m) => (m.spinPrize ? m.spinPrize.enabled : m.price <= s.spinMaxItemPrice));
  const names = await menuNamesNow(tx, offered);
  return offered.map((m) => ({
    id: m.id, name: m.name, price: m.price, category: m.category.name, value: Math.max(0, m.spinPrize?.valueOverride ?? m.price), weight: Math.max(1, m.spinPrize?.weight ?? 1),
    nameI18n: names.get(m.id) ?? {}, image: m.image ? mediaUrl(m.image) : null,
    // A dish whose ingredients have run out is not promised to anyone.
    ready: m.isAvailable && m.recipe.every((l) => {
      if (!l.item.isActive) return true;
      const need = convertQty(l.quantity, l.unit, l.item.unit);
      return need === null || l.item.quantity >= need;
    }),
  }));
}

/** What can be given away right now. */
const giftsNow = async (tx: Client, s: { spinMaxItemPrice: number }) => (await giftCatalog(tx, s)).filter((g) => g.ready);

/** One segment of the wheel as the phone draws it. "Try again" and the bonus spin carry no name — the screen words them. */
export type Segment = { kind: SpinKind; id: string; name: string; nameI18n: Record<string, string>; image: string | null };

/**
 * The wheel of a stay's next spin — the same on every phone and every reload: only what can really happen now
 * (gifts that are ready and fit the budget, "try again", and the bonus spin while it has not come up).
 */
function wheelNow(session: SpinSession, catalog: Gift[], s: Pick<HotelSettings, "spinGiftChance" | "spinFreeSpinChance">, before: { kind: string; menuItemId: string | null }[]) {
  const state = stateOf(session);
  const odds = oddsFor({ gift: s.spinGiftChance, freeSpin: s.spinFreeSpinChance }, state);
  const won = new Set(before.flatMap((r) => (r.kind === "GIFT" && r.menuItemId ? [r.menuItemId] : [])));
  const slots = wheelFor(catalog.filter((g) => g.ready), state, odds, won, `${session.id}:${before.length + 1}`);
  const byId = new Map(catalog.map((g) => [g.id, g]));
  const segment = (slot: Slot): Segment => {
    if (slot.kind !== "GIFT") return { kind: slot.kind, id: "", name: "", nameI18n: {}, image: null };
    const g = byId.get(slot.prize.id)!;
    return { kind: "GIFT", id: g.id, name: g.name, nameI18n: g.nameI18n, image: g.image };
  };
  return { state, odds, slots, segments: slots.map(segment), byId };
}

/** Staff hear about a wheel with nothing to give — once in a while, not on every tap. */
async function alertNoGiftTx(tx: Client, session: SpinSession, now: Date) {
  const recent = await tx.auditLog.findFirst({ where: { action: "spin.no_gift", entityId: session.id, createdAt: { gte: new Date(now.getTime() - 30 * 60_000) } }, select: { id: true } });
  if (recent) return;
  const state = stateOf(session);
  await audit(tx, { userId: null, label: "system" }, {
    action: "spin.no_gift", entityType: "SpinSession", entityId: session.id,
    after: { room: session.roomNumber, guest: session.guestName, spinsLeft: spinsLeft(state), budgetLeft: budgetLeft(state) },
  });
}

// ───────────────────────── What the guest sees ─────────────────────────

/** A gift a stay has won. */
export type Won = {
  id: string; spinNumber: number;
  /** The stay's first gift, or its second. */
  prizeNumber: number;
  name: string; nameI18n: Record<string, string>; image: string | null;
  /** What the gift is worth (TZS). */
  value: number;
  where: SpinWhere | null; orderNumber: string | null; orderStatus: string | null;
  /** The guest said "no, thank you" — it was left out of the order. */
  declined: boolean;
};
export type SpinView =
  | { open: false }
  | {
    open: true; firstName: string; roomNumber: string; introSeen: boolean;
    /** Morning, afternoon or evening at the hotel — for the greeting. */
    dayPart: DayPart;
    /** The stay's own spins. The bonus spin is counted apart. */
    spinsAllowed: number; spinsUsed: number;
    bonus: SpinBonus;
    /** Spins still to play: the stay's own, plus the bonus spin while it waits. */
    spinsLeft: number;
    prizesAllowed: number; prizesWon: number;
    /** The stay's gift budget and what its gifts are worth so far (TZS). */
    budget: number; valueUsed: number;
    /** Every spin played, in order. */
    played: { kind: SpinKind; bonus: boolean }[];
    /** Switched off (or outside its dates) after the guest began: what they won stays, no new spins. */
    paused: boolean;
    /** Nothing can be given right now (staff have been told). The spins are kept. */
    noGift: boolean;
    /** The game is over, and why. */
    over: SpinEnd | null;
    wheel: Segment[];
    /** Every gift won, and those still to be sent to the restaurant (all together, when the guest has finished). */
    gifts: Won[]; pending: Won[];
    allowRoom: boolean; allowRestaurant: boolean;
  };

const RESULT = { menuItem: { select: { image: { select: { id: true, url: true } } } }, order: { select: { number: true, status: true } } } as const;
type ResultRow = {
  id: string; spinNumber: number; prizeNumber: number | null; name: string; nameI18n: unknown; value: number; fulfilment: string | null;
  menuItem: { image: { id: string; url: string | null } | null } | null; order: { number: string; status: string } | null;
};
const won = (r: ResultRow): Won => ({
  id: r.id, spinNumber: r.spinNumber, prizeNumber: r.prizeNumber ?? r.spinNumber, name: r.name, nameI18n: (r.nameI18n ?? {}) as Record<string, string>,
  image: r.menuItem?.image ? mediaUrl(r.menuItem.image) : null, value: r.value,
  where: r.fulfilment === "ROOM" || r.fulfilment === "RESTAURANT" ? r.fulfilment : null,
  orderNumber: r.order?.number ?? null, orderStatus: r.order?.status ?? null, declined: r.fulfilment === GIFT_DECLINED,
});
const waiting = (r: { kind: string; orderId: string | null; fulfilment: string | null }) => r.kind === "GIFT" && !r.orderId && !r.fulfilment;

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
  const giftRows = rows.filter((r) => r.kind === "GIFT");
  // Switched off before the guest won anything: there is nothing to show.
  if (!running && !giftRows.length) return { open: false };
  const catalog = await giftCatalog(db, settings);
  const state = stateOf(session);
  const over = session.endedAt ? endWord(session.endedWhy) : spinEnd(state, catalog);
  const wheel = running && !over ? wheelNow(session, catalog, settings, rows).segments : [];
  const noGift = running && !over && !wheel.length;
  if (noGift) await alertNoGiftTx(db, session, now).catch(() => null);
  return {
    open: true, firstName: greetingName(session.guestName), roomNumber: session.roomNumber, dayPart: dayPartOf(localParts(now, settings.timezone).hour),
    introSeen: !!session.introSeenAt || rows.length > 0,
    spinsAllowed: state.spinsAllowed, spinsUsed: state.spinsUsed, bonus: bonusOf(state), spinsLeft: over ? 0 : spinsLeft(state),
    prizesAllowed: state.prizesAllowed, prizesWon: state.prizesWon, budget: state.budget, valueUsed: state.valueUsed,
    played: rows.map((r) => ({ kind: kindOf(r.kind), bonus: r.bonus })),
    paused: !running, noGift, over, wheel,
    gifts: giftRows.map(won), pending: giftRows.filter(waiting).map(won),
    allowRoom: settings.spinAllowRoom, allowRestaurant: settings.spinAllowRestaurant,
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
  /** How the spin ended: a gift, the bonus spin, or nothing this time. */
  kind: SpinKind;
  gift: Won | null;
  wheel: Segment[];
  /** The segment the wheel stops on. */
  index: number;
  spinNumber: number;
  /** This spin was the stay's bonus spin. */
  bonusSpin: boolean;
  spinsAllowed: number; spinsUsed: number; bonus: SpinBonus; spinsLeft: number;
  prizesAllowed: number; prizesWon: number; budget: number; valueUsed: number;
  /** The game ended with this spin, and why. */
  over: SpinEnd | null;
};

const outcome = (r: { kind: SpinKind; spinNumber: number; bonus: boolean }, gift: Won | null, wheel: Segment[], index: number, s: SpinState, over: SpinEnd | null): SpinOutcome => ({
  kind: r.kind, gift, wheel, index, spinNumber: r.spinNumber, bonusSpin: r.bonus,
  spinsAllowed: s.spinsAllowed, spinsUsed: s.spinsUsed, bonus: bonusOf(s), spinsLeft: over ? 0 : spinsLeft(s),
  prizesAllowed: s.prizesAllowed, prizesWon: s.prizesWon, budget: s.budget, valueUsed: s.valueUsed, over,
});

async function spinTx(tx: Tx, room: SpinRoom, clientKey: string, now: Date, ip?: string | null): Promise<SpinOutcome | "NO_GIFT" | "OVER"> {
  // Only for the guest checked in to this room now — looked up here, never taken from the phone.
  const stay = await lockStayTx(tx, room.id);
  if (!stay) throw closed();
  const settings = await getSettingsTx(tx);

  // Asked twice (a lost answer, a double tap, a replayed request): the spin already decided, never a new one.
  const prior = await tx.spinResult.findUnique({ where: { clientKey }, include: { ...RESULT, session: true } });
  if (prior) {
    if (prior.session.reservationRoomId !== stay.id) throw closed();
    const kind = kindOf(prior.kind);
    const gift = kind === "GIFT" ? won(prior) : null;
    const kept = Array.isArray(prior.wheel) ? (prior.wheel as unknown as Segment[]) : [];
    const at = prior.stopIndex ?? -1;
    // A spin from before wheels were kept: the wheel is just what it won.
    const replay = at >= 0 && at < kept.length
      ? { wheel: kept, index: at }
      : { wheel: [{ kind, id: prior.menuItemId ?? "", name: kind === "GIFT" ? prior.name : "", nameI18n: gift?.nameI18n ?? {}, image: gift?.image ?? null }], index: 0 };
    return outcome({ kind, spinNumber: prior.spinNumber, bonus: prior.bonus }, gift, replay.wheel, replay.index, stateOf(prior.session), prior.session.endedAt ? endWord(prior.session.endedWhy) : null);
  }

  if (!runs(settings, now)) throw new AppError("Spin to Win is not running right now.", "FORBIDDEN");
  const session = await sessionTx(tx, stay, room, settings);
  if (!session) throw closed();

  // Two gifts won, no spin left, or nothing fits what is left of the budget: the game is over — no spin is taken.
  const catalog = await giftCatalog(tx, settings);
  const ended = session.endedAt ? endWord(session.endedWhy) : spinEnd(stateOf(session), catalog);
  if (ended) {
    if (!session.endedAt) await tx.spinSession.update({ where: { id: session.id }, data: { endedAt: now, endedWhy: ended } });
    return "OVER";
  }

  // Checked again at this very moment: on the menu, available, in stock, and inside what the stay has left.
  const before = await tx.spinResult.findMany({ where: { sessionId: session.id }, select: { kind: true, menuItemId: true } });
  const { state, odds, slots, segments, byId } = wheelNow(session, catalog, settings, before);
  const stop = spinStop(slots, odds, (n) => (n > 1 ? randomInt(n) : 0));
  const gift = stop?.slot.kind === "GIFT" ? byId.get(stop.slot.prize.id) ?? null : null;
  if (!stop || (stop.slot.kind === "GIFT" && (!gift || state.valueUsed + gift.value > state.budget))) {
    // Nothing can be given right now: no spin is used. Staff are told.
    await alertNoGiftTx(tx, session, now);
    return "NO_GIFT";
  }

  const kind = stop.slot.kind;
  const next = afterSpin(state, { kind, value: gift?.value ?? 0 });
  const over = spinEnd(next, catalog);
  const spinNumber = before.length + 1;
  const row = await tx.spinResult.create({
    data: {
      sessionId: session.id, spinNumber, clientKey, kind, bonus: next.usedBonus, prizeNumber: gift ? state.prizesWon + 1 : null,
      menuItemId: gift?.id ?? null, name: gift ? gift.name : kind === "FREE_SPIN" ? "Bonus spin" : "Try again", nameI18n: gift ? gift.nameI18n : undefined, value: gift?.value ?? 0,
      wheel: segments, stopIndex: stop.index, createdAt: now,
    },
  });
  // The stay moves on from exactly where it was read — never twice from the same place.
  const moved = await tx.spinSession.updateMany({
    where: { id: session.id, spinsUsed: session.spinsUsed, bonusAwarded: session.bonusAwarded, bonusUsed: session.bonusUsed, prizesWon: session.prizesWon, valueUsed: session.valueUsed, endedAt: null },
    data: { spinsUsed: next.spinsUsed, bonusAwarded: next.bonusAwarded, bonusUsed: next.bonusUsed, prizesWon: next.prizesWon, valueUsed: next.valueUsed, ...(over ? { endedAt: now, endedWhy: over } : {}) },
  });
  if (moved.count !== 1) throw new AppError("Please try again.", "CONFLICT");

  await audit(tx, guestActor(ip), {
    action: kind === "GIFT" ? "spin.won" : kind === "FREE_SPIN" ? "spin.free_spin" : "spin.try_again", entityType: "SpinSession", entityId: session.id,
    after: {
      room: room.number, guest: session.guestName, reservation: stay.reservation.reference, spin: spinNumber, bonusSpin: next.usedBonus,
      ...(gift ? { gift: gift.name, value: gift.value, giftNumber: `${next.prizesWon} / ${next.prizesAllowed}`, usedOfBudget: `${next.valueUsed} / ${next.budget}` } : {}),
      spinsLeft: over ? 0 : spinsLeft(next), ...(over ? { gameOver: over } : {}),
    },
  });
  const mine: Won | null = gift
    ? { id: row.id, spinNumber, prizeNumber: next.prizesWon, name: gift.name, nameI18n: gift.nameI18n, image: gift.image, value: gift.value, where: null, orderNumber: null, orderStatus: null, declined: false }
    : null;
  return outcome({ kind, spinNumber, bonus: next.usedBonus }, mine, segments, stop.index, next, over);
}

/**
 * One spin. `clientKey` names this press of the button: the first request with it decides how the spin ends, every
 * later one gets that same answer back. No spin is used unless the wheel could really be played.
 */
export async function spinOnce(token: string, clientKey: string, now = new Date(), ip?: string | null): Promise<SpinOutcome> {
  const code = await roomForSpinQr(token);
  if (!code) throw closed();
  const run = () => db.$transaction((tx) => spinTx(tx, code.room, clientKey, now, ip));
  // Two requests landing together: one of them made the spin — the other is answered from it.
  const out = await run().catch((e) => { if (isUniqueViolation(e)) return run(); throw e; });
  if (out === "NO_GIFT") throw new AppError("Our gifts are being restocked — please try again a little later, or ask reception. Your spin has not been used.", "UNAVAILABLE");
  if (out === "OVER") throw new AppError("Your game for this stay is complete.", "CONFLICT");
  return out;
}

// ───────────────────────── The gifts go to the restaurant — once, together ─────────────────────────

/**
 * The guest has finished: every gift they won goes to the restaurant as ONE order — to their room, or to enjoy at
 * the restaurant. `skip` names the gifts they do not want ("no, thank you"): those are left out, nothing is prepared
 * for them. Sending ends the game — a guest who still had spins has chosen to finish now.
 * Asked twice (a second tap, a second phone): the same one order, never another.
 * `seen` = every waiting gift the phone showed. A gift won since (a second phone, an answer lost on the way) is never
 * sent unseen: the guest looks again, with all their gifts in front of them.
 */
export async function sendGifts(token: string, where: SpinWhere, skip: string[], now = new Date(), ip?: string | null, seen?: string[]) {
  const code = await roomForSpinQr(token);
  if (!code) throw closed();
  return db.$transaction(async (tx) => {
    // Gifts are only for the guest checked in to this room now.
    const stay = await lockStayTx(tx, code.room.id);
    if (!stay) throw closed();
    const session = await tx.spinSession.findUnique({ where: { reservationRoomId: stay.id } });
    if (!session) throw closed();
    const rows = await tx.spinResult.findMany({ where: { sessionId: session.id, kind: "GIFT" }, orderBy: { spinNumber: "asc" }, include: { order: { select: { number: true } } } });
    const pending = rows.filter(waiting);
    if (!pending.length) {
      // Already sent: the order that was made, not a second one.
      const sent = rows.filter((r) => r.orderId);
      if (!sent.length && !rows.length) throw new AppError("There is no gift to send yet.", "CONFLICT");
      return { sent: sent.length, skipped: 0, orderNumber: sent[sent.length - 1]?.order?.number ?? null };
    }
    if (seen && pending.some((r) => !seen.includes(r.id))) throw new AppError("You have won another gift — please look again.", "CONFLICT");
    const settings = await getSettingsTx(tx);
    const take = pending.filter((r) => !skip.includes(r.id));
    const leave = pending.filter((r) => skip.includes(r.id));
    if (take.length && !(where === "ROOM" ? settings.spinAllowRoom : settings.spinAllowRestaurant)) throw new AppError("That choice is not available right now — please pick the other one.", "VALIDATION");

    const order = take.length
      ? await createGiftOrderTx(tx, { reservationId: stay.reservationId, roomNumber: code.room.number, gifts: take.map((r) => ({ menuItemId: r.menuItemId!, value: r.value })), where, clientKey: `stay:${session.id}:${take[0].id}` }, now)
      : null;
    if (order) {
      const done = await tx.spinResult.updateMany({ where: { id: { in: take.map((r) => r.id) }, orderId: null, fulfilment: null }, data: { fulfilment: where, orderId: order.id, claimedAt: now } });
      if (done.count !== take.length) throw new AppError("Please try again.", "CONFLICT");
    }
    if (leave.length) await tx.spinResult.updateMany({ where: { id: { in: leave.map((r) => r.id) }, orderId: null, fulfilment: null }, data: { fulfilment: GIFT_DECLINED, claimedAt: now } });

    // Sending is the end of the game: by its own rules if it was already over, else because the guest said so.
    const why = session.endedAt ? null : spinEnd(stateOf(session), await giftCatalog(tx, settings)) ?? "GUEST";
    await tx.spinSession.update({ where: { id: session.id }, data: { ...(order ? { fulfilment: where } : {}), ...(why ? { endedAt: now, endedWhy: why } : {}) } });

    const base = { room: code.room.number, guest: session.guestName, reservation: stay.reservation.reference };
    if (order) await audit(tx, guestActor(ip), {
      action: "spin.sent", entityType: "SpinSession", entityId: session.id,
      after: { ...base, gifts: take.map((r) => r.name).join(", "), value: take.reduce((t, r) => t + r.value, 0), where, order: order.number, ...(why === "GUEST" ? { finishedEarly: true } : {}) },
    });
    if (leave.length) await audit(tx, guestActor(ip), {
      action: "spin.declined", entityType: "SpinSession", entityId: session.id,
      after: { ...base, gift: leave.map((r) => r.name).join(", "), value: leave.reduce((t, r) => t + r.value, 0) },
    });
    return { sent: take.length, skipped: leave.length, orderNumber: (order?.number ?? null) as string | null };
  });
}

// ───────────────────────── Staff: cards, settings, what was given ─────────────────────────

/** A gift won and not refused. (A plain "not DECLINED" would also drop the gifts still waiting to be sent.) */
const KEPT_GIFT = { kind: "GIFT", OR: [{ fulfilment: null }, { fulfilment: { not: GIFT_DECLINED } }] };

/** A stay's game as the room card words it: the bonus spin is a spin too, and a refused gift is not a gift taken. */
function cardSession(s: { spinsUsed: number; spinsAllowed: number; bonusAwarded: boolean; bonusUsed: boolean; endedAt: Date | null; results: { id: string }[] } | null) {
  if (!s) return null;
  return { spinsUsed: s.spinsUsed + (s.bonusUsed ? 1 : 0), spinsAllowed: s.spinsAllowed + (s.bonusAwarded ? 1 : 0), gifts: s.results.length, endedAt: s.endedAt };
}

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
        select: { reservation: { select: { guest: { select: { fullName: true } } } }, spinSession: { select: { spinsUsed: true, spinsAllowed: true, valueUsed: true, budget: true, prizesWon: true, prizesAllowed: true, bonusAwarded: true, bonusUsed: true, endedAt: true, results: { where: KEPT_GIFT, select: { id: true } } } } },
      },
    },
  });
  return rooms.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true })).map((r) => ({
    id: r.id, number: r.number, floor: r.floor, type: r.roomType.name, tier: spinTierOf(r),
    qr: r.spinQr, guest: r.reservationRooms[0]?.reservation.guest.fullName ?? null, session: cardSession(r.reservationRooms[0]?.spinSession ?? null),
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
  /** Out of 100 spins, how many end on a gift and how many on the bonus spin. The rest are "try again". */
  giftChance: number; freeSpinChance: number;
  allowRoom: boolean; allowRestaurant: boolean; startsOn: BusinessDate | null; endsOn: BusinessDate | null;
};

const settingsOf = (s: HotelSettings): SpinSettingsInput => ({
  enabled: s.spinEnabled, spinsPerStay: s.spinsPerStay, budgetStandard: s.spinBudgetStandard, budgetPremium: s.spinBudgetPremium, maxItemPrice: s.spinMaxItemPrice,
  giftChance: s.spinGiftChance, freeSpinChance: s.spinFreeSpinChance,
  allowRoom: s.spinAllowRoom, allowRestaurant: s.spinAllowRestaurant,
  startsOn: s.spinStartsOn ? fromDbDate(s.spinStartsOn) : null, endsOn: s.spinEndsOn ? fromDbDate(s.spinEndsOn) : null,
});

/** The switch and the numbers. They shape the stays that begin spinning from now on — a stay already spinning keeps its own. */
export async function saveSpinSettings(input: SpinSettingsInput, actor: Actor) {
  if (!canManage(actor)) throw new AppError("Only the Admin can change Spin to Win.", "FORBIDDEN");
  if (!input.allowRoom && !input.allowRestaurant) throw new AppError("Leave at least one way for guests to enjoy a gift: in the room, or at the restaurant.", "VALIDATION");
  if (input.startsOn && input.endsOn && input.endsOn < input.startsOn) throw new AppError("The last day is before the first day.", "VALIDATION", { endsOn: "Check the dates" });
  if (input.giftChance + input.freeSpinChance > 100) throw new AppError("The gift chance and the bonus spin chance together cannot be more than 100.", "VALIDATION", { freeSpinChance: "Too high" });
  await db.$transaction(async (tx) => {
    const before = settingsOf(await getSettingsTx(tx));
    await tx.hotelSettings.update({
      where: { id: 1 },
      data: {
        spinEnabled: input.enabled, spinsPerStay: input.spinsPerStay, spinBudgetStandard: input.budgetStandard, spinBudgetPremium: input.budgetPremium,
        spinMaxItemPrice: input.maxItemPrice, spinGiftChance: input.giftChance, spinFreeSpinChance: input.freeSpinChance, spinAllowRoom: input.allowRoom, spinAllowRestaurant: input.allowRestaurant,
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
  // Given = a gift sent to the restaurant, or still waiting with its guest in the hotel. One left behind at check-out
  // was never ordered or served, so it is not a cost.
  const given = { kind: "GIFT", OR: [{ fulfilment: { not: GIFT_DECLINED } }, { fulfilment: null, session: { reservationRoom: { status: "CHECKED_IN" as const } } }] };
  // Won, and still not sent to the restaurant: the game is over, or the guest has left it for a while.
  const waitingLong = { OR: [{ session: { endedAt: { not: null } } }, { createdAt: { lt: new Date(now.getTime() - 20 * 60_000) } }] };
  const [gifts, types, recent, dayTotal, monthTotal, noGift, unsent] = await Promise.all([
    giftsNow(db, s),
    db.roomType.findMany({ where: { category: "GUEST_ROOM", isActive: true }, select: { id: true, name: true, code: true, category: true, spinTier: true }, orderBy: { sortOrder: "asc" } }),
    db.spinResult.findMany({
      where: { kind: "GIFT" }, orderBy: { createdAt: "desc" }, take: 60,
      select: {
        id: true, createdAt: true, spinNumber: true, prizeNumber: true, name: true, value: true, fulfilment: true,
        session: { select: { roomNumber: true, guestName: true, prizesAllowed: true, reservationRoom: { select: { status: true } } } }, order: { select: { number: true, status: true } },
      },
    }),
    db.spinResult.aggregate({ where: { createdAt: { gte: day.start, lt: day.end }, ...given }, _count: true, _sum: { value: true } }),
    db.spinResult.aggregate({ where: { createdAt: { gte: month.start, lt: month.end }, ...given }, _count: true, _sum: { value: true } }),
    db.auditLog.findMany({ where: { action: "spin.no_gift", createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, createdAt: true, after: true } }),
    db.spinResult.findMany({
      where: { kind: "GIFT", orderId: null, fulfilment: null, session: { reservationRoom: { status: "CHECKED_IN" } }, ...waitingLong }, orderBy: { createdAt: "asc" }, take: 60,
      select: { sessionId: true, createdAt: true, name: true, session: { select: { roomNumber: true, guestName: true } } },
    }),
  ]);
  // One line for a stay, with all its gifts — they go to the restaurant together.
  const stays = new Map<string, { id: string; at: Date; room: string; guest: string; gifts: string[] }>();
  for (const u of unsent) {
    const stay = stays.get(u.sessionId) ?? { id: u.sessionId, at: u.createdAt, room: u.session.roomNumber, guest: u.session.guestName, gifts: [] };
    stay.gifts.push(u.name);
    if (u.createdAt > stay.at) stay.at = u.createdAt;
    stays.set(u.sessionId, stay);
  }
  return {
    settings: settingsOf(s), running: runs(s, now), today, tomorrow: addDays(today, 1),
    gifts: gifts.map((g) => ({ id: g.id, name: g.name, category: g.category, price: g.price, value: g.value })),
    types: types.map((t) => ({ id: t.id, name: t.name, chosen: t.spinTier, tier: spinTierOf({ spinTier: null, roomType: t }) })),
    recent, unclaimed: [...stays.values()].sort((a, b) => b.at.getTime() - a.at.getTime()),
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
