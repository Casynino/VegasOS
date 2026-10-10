import "server-only";
import { refreshBookingStates } from "./booking-holds";
import { db, type Tx } from "../db";
import { audit, type AuditActor } from "../audit";
import { AppError } from "../errors";
import { getSettings, businessDayConfig } from "../settings";
import { businessDateOf, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { BLOCKED_STATUSES, MANUAL_TRANSITIONS, ROOM_STATUS_META } from "@/lib/room-status";
import type { RoomStatus } from "@/generated/prisma/enums";
import { getT } from "@/i18n/server";
import { msg, msgf } from "@/i18n/msg";
import { DEFAULT_LOCALE } from "@/i18n/config";
import { englishT, type T } from "@/i18n/translate";

/** The translator of whoever is asking (their own language) — English outside a request (jobs, tests). For words that go inside a message. */
export const readerT = async (): Promise<T> => (await getT().catch(() => null)) ?? englishT;
/** A room status inside a sentence: the English word as it always was ("dirty", "out of service"); in another language, the status's own name. */
export const roomStatusWord = (t: T, status: RoomStatus, english: string) => (t.locale === DEFAULT_LOCALE ? english : t(ROOM_STATUS_META[status].label));

/**
 * RoomService — housekeeping/maintenance status, with history and dated
 * blocks. Check-in/out change status through `setRoomStatusTx` inside the
 * reservation transaction so both commit together.
 */
export async function setRoomStatusTx(
  tx: Tx,
  roomId: string,
  to: RoomStatus,
  actor: AuditActor,
  note?: string | null,
): Promise<void> {
  const room = await tx.room.findUniqueOrThrow({ where: { id: roomId } });
  if (room.status === to) return;
  const now = new Date();
  await tx.room.update({ where: { id: roomId }, data: { status: to, statusNote: note ?? null, statusChangedAt: now } });
  await tx.roomStatusHistory.create({
    data: { roomId, fromStatus: room.status, toStatus: to, note: note ?? null, changedById: actor.userId ?? null, changedAt: now },
  });

  const settings = await getSettings();
  const today: BusinessDate = businessDateOf(now, businessDayConfig(settings));
  // Leaving a blocked state closes the open block (end = today, exclusive → room sellable today).
  if (BLOCKED_STATUSES.includes(room.status)) {
    await tx.roomBlock.updateMany({
      where: { roomId, endDate: null },
      data: { endDate: toDbDate(today), closedAt: now },
    });
  }
  if (BLOCKED_STATUSES.includes(to)) {
    await tx.roomBlock.create({
      data: {
        roomId, type: to === "MAINTENANCE" ? "MAINTENANCE" : "OUT_OF_SERVICE",
        startDate: toDbDate(today), reason: note ?? null, createdById: actor.userId ?? null,
      },
    });
  }
  await audit(tx, actor, {
    action: "room.status_changed", entityType: "Room", entityId: roomId,
    before: { number: room.number, status: room.status }, after: { number: room.number, status: to, note },
  });
}

export async function changeRoomStatus(
  roomId: string,
  to: RoomStatus,
  actor: AuditActor & { permissions: ReadonlySet<string> },
  note?: string | null,
): Promise<{ warning?: string }> {
  return db.$transaction(async (tx) => {
    const room = await tx.room.findUnique({ where: { id: roomId } });
    if (!room || !room.isActive) throw new AppError("Room not found.", "NOT_FOUND");
    if (!MANUAL_TRANSITIONS[room.status].includes(to)) {
      if (room.status === "OCCUPIED") throw new AppError("This room has a guest in it. Check the guest out to change its status.");
      const t = await readerT();
      throw new AppError(msgf("A room cannot be changed from {from} to {to} manually.", {
        from: roomStatusWord(t, room.status, room.status.toLowerCase()), to: roomStatusWord(t, to, to.toLowerCase()),
      }));
    }
    // Reception may put a room under maintenance; taking it out of service is a manager's call.
    if (to === "OUT_OF_SERVICE" && !actor.permissions.has("rooms.block")) {
      throw new AppError("Only a manager can take a room out of service.", "FORBIDDEN");
    }
    if (BLOCKED_STATUSES.includes(to) && !note?.trim()) {
      throw new AppError("Say what needs fixing (e.g. AC, plumbing).", "VALIDATION", { note: msg("Reason required") });
    }
    await setRoomStatusTx(tx, roomId, to, actor, note);

    if (BLOCKED_STATUSES.includes(to)) {
      const upcoming = await tx.reservationRoom.count({
        where: { roomId, status: { in: ["RESERVED", "CONFIRMED"] }, endAt: { gt: new Date() } },
      });
      if (upcoming > 0) {
        const t = await readerT();
        return { warning: t("Room {room} has {n} upcoming booking(s) — reassign them to another room.", { room: room.number, n: upcoming }) };
      }
    }
    return {};
  });
}

export interface RoomBoardRoom {
  id: string;
  number: string;
  floor: number | null;
  status: RoomStatus;
  displayStatus: RoomStatus; // RESERVED when an arrival is assigned today
  statusNote: string | null;
  statusChangedAt: Date;
  roomType: { id: string; name: string; baseRate: number; photo: string | null; category: "GUEST_ROOM" | "MEETING_ROOM" };
  currentStay: StayInfo | null;
  arrivalToday: StayInfo | null;
  /** Next bookings on this room after today (up to 3), soonest first. */
  upcoming: {
    reservationId: string; reservationRoomId: string; reference: string; arrivalDate: string; departureDate: string; nights: number; eta: string | null;
    /** Meeting rooms: the booked time and company. */
    startAt: string; endAt: string; company: string | null; status: string; balance: number;
    guest: { fullName: string; phone: string | null; idType: string | null; idNumber: string | null; nationality: string | null };
  }[];
  /** A guest who did not arrive (no-show) still holding this room — a manager can release it. */
  heldNoShow: { reservationId: string; reference: string; guestName: string; arrivalDate: string; paid: number } | null;
  /** Closures planned for dates ahead (and a dated one running now). */
  closures: { id: string; from: string; until: string; type: string; reason: string | null }[];
  /** The waiter a manager put in charge of this room's room service. */
  serviceWaiter: { id: string; name: string } | null;
}

export interface StayInfo {
  reservationRoomId: string;
  reservationId: string;
  reference: string;
  guestName: string;
  guestPhone: string | null;
  status: string;
  startAt: Date;
  endAt: Date;
  arrivalDate: string;
  departureDate: string;
  balance: number;
  isDayUse: boolean;
  ratePerNight: number;
  discountPerNight: number;
  nights: number;
  /** A manager allowed the guest to leave owing (up to this much) — reception may check them out. */
  leaveOwing: { upTo: number; reason: string } | null;
  /** In the room now: the table the guest (or someone sharing the room) is at right now — "Outside 3". */
  table: string | null;
  /** In the room now: restaurant & room-service orders on this room's bill (TZS). */
  restaurantOnRoom: number;
}

/** Live room board for the given business date. */
export async function getRoomBoard(today: BusinessDate): Promise<RoomBoardRoom[]> {
  await refreshBookingStates(); // unpaid bookings past their hold time no longer hold rooms
  const rooms = await db.room.findMany({
    where: { isActive: true },
    orderBy: [{ floor: "asc" }, { number: "asc" }],
    include: {
      roomType: { select: { id: true, name: true, baseRate: true, images: true, category: true } },
      serviceWaiter: { select: { id: true, fullName: true } },
      reservationRooms: {
        where: {
          OR: [
            { status: "CHECKED_IN" },
            { status: { in: ["RESERVED", "CONFIRMED"] }, arrivalDate: toDbDate(today) },
          ],
        },
        include: { reservation: { include: { guest: { select: { fullName: true, phone: true } }, guests: { select: { guestId: true } } } } },
        orderBy: { startAt: "asc" },
      },
    },
  });

  // Guests in the rooms now: the table they are at, and their restaurant on the room bill — one query each for the whole board.
  const staying = rooms.flatMap((r) => r.reservationRooms.filter((rr) => rr.status === "CHECKED_IN").map((rr) => rr.reservation));
  const people = [...new Set(staying.flatMap((x) => [x.guestId, ...x.guests.map((g) => g.guestId)]))];
  const [sessions, food] = staying.length ? await Promise.all([
    db.diningSession.findMany({
      where: { openAtId: { not: null }, OR: [{ guestId: { in: people } }, { members: { some: { guestId: { in: people } } } }] },
      orderBy: { startedAt: "desc" },
      select: { guestId: true, members: { select: { guestId: true } }, location: { select: { name: true } } },
    }),
    db.reservationCharge.groupBy({ by: ["reservationId"], where: { reservationId: { in: [...new Set(staying.map((x) => x.id))] }, restaurantOrderId: { not: null }, isVoided: false }, _sum: { amount: true } }),
  ]) : [[], []];
  const tableOf = (x: (typeof staying)[number]) => {
    const ids = new Set([x.guestId, ...x.guests.map((g) => g.guestId)]);
    return sessions.find((s) => ids.has(s.guestId) || s.members.some((m) => ids.has(m.guestId)))?.location.name ?? null;
  };

  const toStay = (rr: (typeof rooms)[number]["reservationRooms"][number]): StayInfo => ({
    reservationRoomId: rr.id,
    reservationId: rr.reservationId,
    reference: rr.reservation.reference,
    guestName: rr.reservation.companyName ?? rr.reservation.guest.fullName,
    guestPhone: rr.reservation.guest.phone,
    status: rr.status,
    startAt: rr.startAt,
    endAt: rr.endAt,
    arrivalDate: rr.arrivalDate.toISOString().slice(0, 10),
    departureDate: rr.departureDate.toISOString().slice(0, 10),
    balance: rr.reservation.balanceAmount,
    isDayUse: rr.isDayUse,
    ratePerNight: rr.ratePerNight,
    discountPerNight: rr.discountPerNight,
    nights: rr.nights,
    leaveOwing: rr.reservation.leaveOwingAt && rr.reservation.leaveOwingUpTo != null ? { upTo: rr.reservation.leaveOwingUpTo, reason: rr.reservation.leaveOwingReason ?? "" } : null,
    table: rr.status === "CHECKED_IN" ? tableOf(rr.reservation) : null,
    restaurantOnRoom: rr.status === "CHECKED_IN" ? food.find((f) => f.reservationId === rr.reservationId)?._sum.amount ?? 0 : 0,
  });

  const later = await db.reservationRoom.findMany({
    where: { status: { in: ["RESERVED", "CONFIRMED"] }, arrivalDate: { gte: toDbDate(today) }, roomId: { in: rooms.map((r) => r.id) } },
    include: { reservation: { select: { id: true, reference: true, eta: true, companyName: true, balanceAmount: true, guest: { select: { fullName: true, phone: true, idType: true, idNumber: true, nationality: true } } } } },
    orderBy: [{ arrivalDate: "asc" }, { startAt: "asc" }],
  });
  const upcomingFor = (roomId: string) => later.filter((x) => x.roomId === roomId).slice(0, 4).map((x) => ({
    reservationId: x.reservation.id, reservationRoomId: x.id, reference: x.reservation.reference, eta: x.reservation.eta,
    arrivalDate: x.arrivalDate.toISOString().slice(0, 10), departureDate: x.departureDate.toISOString().slice(0, 10), nights: x.nights,
    startAt: x.startAt.toISOString(), endAt: x.endAt.toISOString(), company: x.reservation.companyName, status: x.status, balance: x.reservation.balanceAmount,
    guest: x.reservation.guest,
  }));

  const [held, blocks] = await Promise.all([
    db.reservationRoom.findMany({
      where: { status: "NO_SHOW", releasedAt: null, endAt: { gt: new Date() }, roomId: { in: rooms.map((r) => r.id) } },
      select: { roomId: true, arrivalDate: true, reservation: { select: { id: true, reference: true, paidAmount: true, companyName: true, guest: { select: { fullName: true } } } } },
    }),
    db.roomBlock.findMany({ where: { endDate: { gt: toDbDate(today) }, roomId: { in: rooms.map((r) => r.id) } }, orderBy: { startDate: "asc" } }),
  ]);

  return rooms.map((r) => {
    const current = r.reservationRooms.find((rr) => rr.status === "CHECKED_IN");
    const h = held.find((x) => x.roomId === r.id);
    const arrival = r.reservationRooms.find((rr) => rr.status !== "CHECKED_IN");
    const displayStatus: RoomStatus =
      !current && arrival && (r.status === "AVAILABLE" || r.status === "READY") ? "RESERVED" : r.status;
    return {
      id: r.id,
      number: r.number,
      floor: r.floor,
      status: r.status,
      displayStatus,
      statusNote: r.statusNote,
      statusChangedAt: r.statusChangedAt,
      roomType: { id: r.roomType.id, name: r.roomType.name, baseRate: r.roomType.baseRate, category: r.roomType.category, photo: (Array.isArray(r.roomType.images) ? (r.roomType.images as string[])[0] : null) ?? null },
      currentStay: current ? toStay(current) : null,
      arrivalToday: arrival ? toStay(arrival) : null,
      upcoming: upcomingFor(r.id),
      heldNoShow: h ? { reservationId: h.reservation.id, reference: h.reservation.reference, guestName: h.reservation.companyName ?? h.reservation.guest.fullName, arrivalDate: h.arrivalDate.toISOString().slice(0, 10), paid: h.reservation.paidAmount } : null,
      closures: blocks.filter((b) => b.roomId === r.id).map((b) => ({ id: b.id, from: b.startDate.toISOString().slice(0, 10), until: b.endDate!.toISOString().slice(0, 10), type: b.type, reason: b.reason })),
      serviceWaiter: r.serviceWaiter ? { id: r.serviceWaiter.id, name: r.serviceWaiter.fullName } : null,
    };
  });
}
