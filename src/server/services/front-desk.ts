import "server-only";
import { timeRange } from "@/lib/meeting";
import { expireUnpaidHolds, refreshBookingStates } from "./booking-holds";
import { db } from "../db";
import { arrivalReminderMessage, meetingReminderMessage } from "@/lib/wa-messages";
import { prettyPhone } from "@/lib/guest-messages";
import { siteOrigin } from "../site-origin";
import type { Prisma } from "@/generated/prisma/client";
import { getSettings, stayConfig } from "../settings";
import { findAvailableRooms } from "./availability";
import { CHECK_IN_READY } from "@/lib/room-status";
import { overnightStay } from "@/lib/time/stay";
import { addDays, formatMinutes, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";

/**
 * Everything an incoming receptionist needs at the start of a shift, and the
 * live front-desk picture during it. One query set, used by the Today page and
 * the handover screen.
 */

export async function getFrontDeskSnapshot(today: BusinessDate) {
  await refreshBookingStates();
  const d = toDbDate(today);
  const guestSel = { select: { fullName: true, phone: true } } as const;
  const roomsSel = { include: { room: { select: { number: true } }, roomType: { select: { name: true } } } } as const;

  const [arrivals, inHouse, unpaidCheckedOut, roomsByStatus, maintenance, cleaning, awaitingApproval, unpaidAll] = await Promise.all([
    db.reservation.findMany({
      where: { arrivalDate: d, status: { in: ["RESERVED", "CONFIRMED", "INQUIRY"] } },
      include: { guest: guestSel, rooms: roomsSel, source: { select: { name: true } }, trips: { where: { status: { not: "CANCELLED" } }, select: { flightNumber: true, pickupAt: true } } },
      orderBy: [{ eta: "asc" }, { createdAt: "asc" }],
    }),
    db.reservation.findMany({
      where: { status: "CHECKED_IN" },
      include: { guest: guestSel, rooms: roomsSel },
      orderBy: { departureDate: "asc" },
    }),
    db.reservation.findMany({
      where: { status: "CHECKED_OUT", balanceAmount: { gt: 0 } },
      include: { guest: guestSel, corporateCustomer: { select: { companyName: true } } },
      orderBy: { departureDate: "desc" },
      take: 20,
    }),
    // Guest rooms only — the meeting room is never part of room counts or occupancy.
    db.room.groupBy({ by: ["status"], where: { isActive: true, roomType: { category: "GUEST_ROOM" } }, _count: true }),
    db.room.findMany({ where: { isActive: true, status: { in: ["MAINTENANCE", "OUT_OF_SERVICE"] } }, select: { id: true, number: true, status: true, statusNote: true } }),
    db.room.findMany({ where: { isActive: true, status: { in: ["DIRTY", "CLEANING"] } }, select: { id: true, number: true, status: true } }),
    db.expense.count({ where: { status: "PENDING_APPROVAL" } }),
    db.reservation.aggregate({ where: { status: "CHECKED_OUT", balanceAmount: { gt: 0 } }, _count: true, _sum: { balanceAmount: true } }),
  ]);

  // Guests to check out (a meeting in use is completed from the Meeting room / booking, not checked out).
  const departures = inHouse.filter((r) => r.kind === "STAY" && r.departureDate <= d);
  const statusCount = Object.fromEntries(roomsByStatus.map((s) => [s.status, s._count])) as Record<string, number>;
  const totalRooms = roomsByStatus.reduce((s, x) => s + x._count, 0);

  return {
    arrivals,
    inHouse,
    departures,
    unpaidInHouse: inHouse.filter((r) => r.balanceAmount > 0),
    unpaidCheckedOut,
    /** Everyone who left owing — all of them (the list above shows the latest 20). */
    unpaidAfterCheckout: { count: unpaidAll._count, amount: unpaidAll._sum.balanceAmount ?? 0 },
    guestNotes: [...arrivals, ...inHouse].filter((r) => r.specialRequests || r.internalNotes),
    statusCount,
    totalRooms,
    maintenance,
    cleaning,
    awaitingApproval,
  };
}

export type FrontDeskSnapshot = Awaited<ReturnType<typeof getFrontDeskSnapshot>>;

/**
 * Reception board: today's arrivals with the rooms each one can go into right
 * now (same type, free for the stay, housekeeping status), departures, who is
 * in house and tonight's sellable rooms. Drives one-click ASSIGN & CHECK IN.
 */
export async function getReceptionBoard(today: BusinessDate, now = new Date()) {
  await refreshBookingStates(now);
  const d = toDbDate(today);
  const settings = await getSettings();
  const [arrivals, requestsDue, tonightFree] = await Promise.all([
    findArrivals({ lte: d }, d),
    db.bookingRequest.findMany({
      where: { status: { in: ["NEW", "REVIEWING", "CONTACTED", "CONFIRMED"] }, checkInDate: { lte: d }, checkOutDate: { gt: d } },
      include: { roomType: { select: { name: true } }, source: { select: { name: true } } },
      orderBy: { createdAt: "asc" },
    }),
    (async () => {
      try {
        const stay = overnightStay({ arrivalDate: today, departureDate: addDays(today, 1) }, stayConfig(settings));
        return (await findAvailableRooms({ stay })).filter((r) => r.status === "AVAILABLE" || r.status === "READY").length;
      } catch {
        return null;
      }
    })(),
  ]);

  const arrivalCards = await toArrivalCards(arrivals, now);

  return { arrivals: arrivalCards, requestsDue, tonightFree };
}

export type ReceptionBoard = Awaited<ReturnType<typeof getReceptionBoard>>;

/**
 * Bookings still to check in whose first night falls in `arrival`, with guest, source, rooms and pickup — also those
 * booked online to pay later (no room held: at the desk they take any free room and pay).
 */
const WAITING: ("RESERVED" | "CONFIRMED" | "INQUIRY")[] = ["RESERVED", "CONFIRMED", "INQUIRY"];
function findArrivals(arrival: { lte?: Date; gte?: Date; gt?: Date }, stillStayingOn: Date, extra: Prisma.ReservationWhereInput = {}) {
  return db.reservation.findMany({
    where: {
      ...extra,
      status: { in: WAITING },
      // Still staying on that day — a short-time (day-use) booking leaves the same day it arrives.
      rooms: { some: { status: { in: WAITING }, arrivalDate: arrival, OR: [{ departureDate: { gt: stillStayingOn } }, { isDayUse: true, departureDate: { gte: stillStayingOn } }] } },
    },
    include: {
      guest: { select: { id: true, fullName: true, phone: true, email: true, idType: true, idNumber: true, nationality: true, _count: { select: { reservations: true } } } },
      source: { select: { name: true } },
      rooms: { where: { status: { in: WAITING } }, include: { room: { select: { id: true, number: true, status: true } }, roomType: { select: { id: true, name: true } } } },
      trips: { where: { status: { not: "CANCELLED" } }, select: { flightNumber: true, pickupAt: true } },
    },
    orderBy: [{ arrivalDate: "asc" }, { eta: "asc" }, { createdAt: "asc" }],
  });
}

/**
 * Adds, per booked room, the rooms the guest can take at the desk: every free room of the same type, then
 * free rooms of other types at the same price (the booked rate is kept on a move). A guest booked for a later
 * day is offered rooms free from TODAY for the same nights — they check in early from this screen.
 */
async function toArrivalCards(arrivals: Awaited<ReturnType<typeof findArrivals>>, now: Date, withOptions = true, today?: BusinessDate) {
  const [types, settings] = withOptions && arrivals.length
    ? await Promise.all([db.roomType.findMany({ select: { id: true, name: true, baseRate: true } }), getSettings()])
    : [[], null];
  const typeOf = new Map(types.map((t) => [t.id, t]));
  return Promise.all(arrivals.map(async (r) => ({
    ...r,
    rooms: await Promise.all(r.rooms.map(async (rr) => {
      const arrival = fromDbDate(rr.arrivalDate);
      const early = !!today && !!settings && !rr.isDayUse && arrival > today;
      const stay = early
        ? overnightStay({ arrivalDate: today!, departureDate: addDays(today!, Math.max(1, rr.nights)) }, stayConfig(settings!))
        : { startAt: rr.startAt < now ? rr.startAt : now, endAt: rr.endAt, arrivalDate: arrival, departureDate: fromDbDate(rr.departureDate), isDayUse: rr.isDayUse };
      const booked = typeOf.get(rr.roomTypeId);
      const free = withOptions ? await findAvailableRooms({ stay, excludeReservationRoomId: rr.id }) : [];
      const freeNow = free.some((o) => o.id === rr.room.id);
      // Booked to pay later: its room was never held — a guest who paid first may have it now (on the booking's own
      // dates: a room only busy today, while the guest asks to come early, was not taken from them; nor a room someone
      // is still in).
      const freeOnItsDates = rr.status === "INQUIRY" && withOptions && !freeNow && early && (await findAvailableRooms({
        stay: { startAt: rr.startAt, endAt: rr.endAt, arrivalDate: arrival, departureDate: fromDbDate(rr.departureDate), isDayUse: rr.isDayUse }, roomIds: [rr.room.id],
      })).length > 0;
      const taken = rr.status === "INQUIRY" && withOptions && !freeNow && !freeOnItsDates && rr.room.status !== "OCCUPIED";
      // Not held and not free for these nights (someone in it, or today only for an early arrival): not offered as ready.
      const busy = rr.status === "INQUIRY" && withOptions && !freeNow && !taken;
      const options = free
        .filter((o) => o.roomTypeId === rr.roomTypeId || (!!booked && typeOf.get(o.roomTypeId)?.baseRate === booked.baseRate))
        .sort((a, b) => Number(b.roomTypeId === rr.roomTypeId) - Number(a.roomTypeId === rr.roomTypeId) || a.number.localeCompare(b.number, undefined, { numeric: true }));
      return {
        id: rr.id, roomTypeName: rr.roomType.name, arrival, departure: fromDbDate(rr.departureDate),
        nights: rr.nights, adults: rr.adults, children: rr.children, ratePerNight: rr.ratePerNight, discountPerNight: rr.discountPerNight,
        current: { id: rr.room.id, number: rr.room.number, status: rr.room.status, ready: !taken && !busy && CHECK_IN_READY.includes(rr.room.status), type: rr.roomType.name, sameType: true, taken, busy },
        options: options.map((o) => ({
          id: o.id, number: o.number, status: o.status, ready: CHECK_IN_READY.includes(o.status),
          type: typeOf.get(o.roomTypeId)?.name ?? rr.roomType.name, sameType: o.roomTypeId === rr.roomTypeId,
        })),
      };
    })),
  })));
}

/**
 * The check-in desk: every booking waiting to arrive. `due` = can be checked in
 * now (arriving today, or late from an earlier day); `upcoming` = the next
 * `days` days, shown for preparation (dates must change to check in early).
 */
export async function getCheckInList(today: BusinessDate, now = new Date(), days = 14) {
  await expireUnpaidHolds(now);
  const d = toDbDate(today);
  const [due, upcoming] = await Promise.all([
    findArrivals({ lte: d }, d).then((r) => toArrivalCards(r, now)),
    findArrivals({ gt: d, lte: toDbDate(addDays(today, days)) }, d).then((r) => toArrivalCards(r, now, false)),
  ]);
  return { due, upcoming };
}
export type CheckInArrival = Awaited<ReturnType<typeof getCheckInList>>["due"][number];

/** One waiting booking with its free-room options (for the check-in workspace), or null. */
export async function getCheckInBooking(reservationId: string, today: BusinessDate, now = new Date()) {
  await expireUnpaidHolds(now);
  const d = toDbDate(today);
  const rows = await findArrivals({ lte: toDbDate(addDays(today, 366)) }, d, { id: reservationId });
  return rows.length ? (await toArrivalCards(rows, now, true, today))[0] : null;
}

/** Arrivals and departures per day for a month (YYYY-MM) — powers the dashboard calendars. */
export async function getMonthMovements(month: string) {
  const [y, m] = month.split("-").map(Number);
  const from = new Date(Date.UTC(y, m - 1, 1));
  const to = new Date(Date.UTC(y, m, 1));
  const live = { status: { notIn: ["CANCELLED", "NO_SHOW", "INQUIRY"] as ("CANCELLED" | "NO_SHOW" | "INQUIRY")[] } };
  const [arr, dep] = await Promise.all([
    db.reservationRoom.groupBy({ by: ["arrivalDate"], where: { ...live, arrivalDate: { gte: from, lt: to } }, _count: true }),
    db.reservationRoom.groupBy({ by: ["departureDate"], where: { ...live, departureDate: { gte: from, lt: to } }, _count: true }),
  ]);
  return {
    arrivals: Object.fromEntries(arr.map((a) => [fromDbDate(a.arrivalDate), a._count])) as Record<string, number>,
    departures: Object.fromEntries(dep.map((d) => [fromDbDate(d.departureDate), d._count])) as Record<string, number>,
  };
}

/**
 * Arrivals today at a glance: expected, checked in, late arrival (guest told us),
 * no-show needing action — plus the reminder message for each expected guest.
 */
export async function getArrivalsSummary(today: BusinessDate) {
  const d = toDbDate(today);
  const settings = await getSettings();
  const [expected, checkedIn, noShows] = await Promise.all([
    db.reservation.findMany({
      where: { status: { in: WAITING }, arrivalDate: { lte: d } },
      select: {
        id: true, reference: true, eta: true, lateArrivalNotedAt: true, lateArrivalNote: true, status: true, paidAmount: true, arrivalDate: true, departureDate: true,
        balanceAmount: true, netAmount: true, billTo: true, holdUntil: true, kind: true, companyName: true, group: { select: { name: true } },
        manageToken: true, adults: true, children: true,
        guest: { select: { fullName: true, phone: true } }, source: { select: { name: true } }, corporateCustomer: { select: { companyName: true } }, createdBy: { select: { fullName: true } },
        rooms: { where: { status: { notIn: ["CANCELLED"] } }, select: { nights: true, startAt: true, endAt: true, room: { select: { number: true } }, roomType: { select: { name: true, category: true } } } },
      },
      orderBy: [{ arrivalDate: "asc" }, { eta: "asc" }],
    }),
    db.reservationRoom.count({ where: { arrivalDate: d, status: { in: ["CHECKED_IN", "CHECKED_OUT"] } } }),
    db.reservation.findMany({
      where: { status: "NO_SHOW", rooms: { some: { status: "NO_SHOW", releasedAt: null } } },
      select: { id: true, reference: true, paidAmount: true, arrivalDate: true, guest: { select: { fullName: true, phone: true } }, rooms: { select: { room: { select: { number: true } } } } },
    }),
  ]);
  const dateLabel = new Date(`${today}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "long", timeZone: "UTC" });
  // The arrival-day message: the full booking (src/lib/wa-messages.ts) — unless the hotel wrote its own text in Settings.
  let origin = "";
  try { origin = await siteOrigin(); } catch { origin = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ?? ""; }
  const hotel = { name: settings.hotelName, phone: prettyPhone(settings.whatsapp || settings.phone) || null };
  const weekday = (d: Date) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" }).format(d);
  const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
  const people = expected.map((r) => ({
    id: r.id, reference: r.reference, name: r.kind === "MEETING" ? r.companyName ?? r.guest.fullName : r.guest.fullName, phone: r.guest.phone, eta: r.eta, rooms: r.rooms.map((x) => x.room.number),
    /** A meeting room booking: its time (Start meeting instead of check-in). */
    meeting: r.kind === "MEETING" && r.rooms[0] ? { time: timeRange(r.rooms[0].startAt, r.rooms[0].endAt), contact: r.companyName ? r.guest.fullName : null } : null,
    late: !!r.lateArrivalNotedAt, lateNote: r.lateArrivalNote, paid: r.paidAmount > 0, pending: r.status === "RESERVED",
    /** Booked online to pay later: not paid, no room held (at the desk: any free room, and the payment). */
    notHeld: r.status === "INQUIRY",
    // For the "to check in" list on the front desk.
    roomTypes: r.rooms.map((x) => ({ number: x.room.number, type: x.roomType.name, meeting: x.roomType.category === "MEETING_ROOM" })),
    arrival: fromDbDate(r.arrivalDate), departure: fromDbDate(r.departureDate), nights: r.rooms.reduce((m, x) => Math.max(m, x.nights), 0),
    source: r.source.name, company: r.group ? `Group: ${r.group.name}` : r.corporateCustomer?.companyName ?? null, bookedBy: r.createdBy?.fullName ?? null,
    billTo: r.billTo, holdUntil: r.holdUntil, paidAmount: r.paidAmount, balance: r.balanceAmount, net: r.netAmount,
    // The arrival-day reminder, always in the one Vegas format (owner, 2026-10-06: no old short texts anywhere).
    reminder: r.kind === "MEETING" && r.rooms[0]
      ? meetingReminderMessage({
        hotel, name: r.guest.fullName, room: r.rooms[0].roomType.name, ref: r.reference, date: dateLabel,
        time: timeRange(r.rooms[0].startAt, r.rooms[0].endAt), attendees: r.adults || null,
        money: { total: r.netAmount, paid: r.paidAmount, balance: r.balanceAmount, company: r.billTo !== "GUEST" ? r.corporateCustomer?.companyName ?? r.companyName ?? "the company" : null },
        bookingUrl: origin ? `${origin}/booking/${encodeURIComponent(r.reference)}?token=${encodeURIComponent(r.manageToken)}` : null,
      })
        : arrivalReminderMessage({
          hotel, name: r.guest.fullName,
          stay: {
            ref: r.reference, roomType: [...new Set(r.rooms.map((x) => x.roomType.name))].join(", ") || "—",
            checkIn: `${weekday(r.arrivalDate)} · from ${formatMinutes(settings.standardCheckInMinutes)}`,
            checkOut: `${weekday(r.departureDate)} · by ${formatMinutes(settings.checkoutMinutes)}`,
            nights: r.rooms.reduce((m, x) => Math.max(m, x.nights), 0) || null,
            guests: `${plural(r.adults, "adult", "adults")}${r.children ? `, ${plural(r.children, "child", "children")}` : ""}`,
          },
          money: { total: r.netAmount, paid: r.paidAmount, balance: r.balanceAmount, company: r.billTo !== "GUEST" ? r.corporateCustomer?.companyName ?? r.companyName ?? "the company" : null },
          bookingUrl: origin ? `${origin}/booking/${encodeURIComponent(r.reference)}?token=${encodeURIComponent(r.manageToken)}` : null,
          payUrl: origin ? `${origin}/booking/${encodeURIComponent(r.reference)}?token=${encodeURIComponent(r.manageToken)}` : null,
        }),
  }));
  return {
    expected: people.filter((p) => !p.late),
    late: people.filter((p) => p.late),
    checkedIn,
    noShows: noShows.map((r) => ({ id: r.id, reference: r.reference, name: r.guest.fullName, phone: r.guest.phone, paid: r.paidAmount, rooms: r.rooms.map((x) => x.room.number), arrival: r.arrivalDate })),
    total: people.length + checkedIn,
  };
}

/**
 * Arrival-day reminders through the configured provider (runs with the daily job).
 * Channel "MANUAL" = no automatic sending; reception uses the "Remind" button.
 */
export async function sendArrivalReminders(today: BusinessDate, deadline?: number) {
  const settings = await getSettings();
  if (settings.arrivalReminderChannel === "MANUAL") return { sent: 0, skipped: "manual" as const };
  const { sendMessage } = await import("./messaging");
  const s = await getArrivalsSummary(today);
  let sent = 0;
  for (const p of [...s.expected, ...s.late]) {
    if (!p.phone) continue;
    // The scheduled run's time limit: a send that might not finish waits for the next run.
    if (deadline && deadline - Date.now() < 16_000) break;
    const r = await db.reservation.findUnique({ where: { id: p.id }, select: { reminderSentAt: true } });
    if (r?.reminderSentAt) continue;
    const out = await sendMessage({ channel: settings.arrivalReminderChannel, to: p.phone, text: p.reminder });
    await db.notificationDelivery.create({
      data: {
        reservationId: p.id, purpose: "ARRIVAL_REMINDER", channel: settings.arrivalReminderChannel, recipient: p.phone,
        status: out.ok ? "SENT" : "FAILED", attempts: 1, lastError: out.error ?? null, providerResponse: out.response ?? null, sentAt: out.ok ? new Date() : null,
      },
    });
    if (out.ok) { await db.reservation.update({ where: { id: p.id }, data: { reminderSentAt: new Date() } }); sent++; }
  }
  return { sent };
}
