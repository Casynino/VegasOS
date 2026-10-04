import "server-only";
import { db } from "../db";
import { EARNED_NIGHT } from "./reservation-financials";
import { addDays, diffDays, eachDate, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { MEETING_OPEN_HOURS } from "@/lib/meeting";

/**
 * One room's performance for the manager's and the MD's room card: this month (what it earned,
 * nights sold, occupancy, its rank among the rooms), the last 14 nights and its latest guests.
 * Same rules as Finance → Rooms: nights of stays checked in or out.
 */
export async function roomInsight(roomId: string, today: BusinessDate) {
  const monthFrom = `${today.slice(0, 8)}01`;
  const from14 = addDays(today, -13);
  const from = monthFrom < from14 ? monthFrom : from14;
  const meeting = (await db.roomType.findMany({ where: { category: "MEETING_ROOM" }, select: { id: true } })).map((t) => t.id);
  const [nights, ranking, stays] = await Promise.all([
    db.roomNight.findMany({
      where: { roomId, businessDate: { gte: toDbDate(from), lte: toDbDate(today) }, ...EARNED_NIGHT },
      select: { businessDate: true, netAmount: true, discountAmount: true, isDayUse: true, reservationRoomId: true },
    }),
    db.roomNight.groupBy({
      by: ["roomId"], where: { businessDate: { gte: toDbDate(monthFrom), lte: toDbDate(today) }, ...EARNED_NIGHT, roomTypeId: { notIn: meeting } },
      _sum: { netAmount: true },
    }),
    db.reservationRoom.findMany({
      where: { roomId, status: { notIn: ["CANCELLED", "NO_SHOW"] }, arrivalDate: { lte: toDbDate(today) } }, orderBy: { startAt: "desc" }, take: 6,
      select: {
        id: true, status: true, arrivalDate: true, departureDate: true, nights: true, isDayUse: true, netAmount: true,
        reservation: { select: { id: true, reference: true, guest: { select: { id: true, fullName: true } } } },
      },
    }),
  ]);
  const inMonth = nights.filter((n) => fromDbDate(n.businessDate) >= monthFrom);
  const earned = inMonth.reduce((t, n) => t + n.netAmount, 0);
  const sold = inMonth.filter((n) => !n.isDayUse).length;
  const dayUse = inMonth.filter((n) => n.isDayUse).length;
  const days = diffDays(monthFrom, today) + 1;
  const ranked = [...ranking].sort((a, b) => (b._sum.netAmount ?? 0) - (a._sum.netAmount ?? 0));
  const rank = ranked.findIndex((r) => r.roomId === roomId);
  const rooms = await db.room.count({ where: { isActive: true, roomType: { category: "GUEST_ROOM" } } });
  return {
    month: {
      label: new Date(`${today}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" }),
      earned, nights: sold, dayUse, days,
      discount: inMonth.reduce((t, n) => t + n.discountAmount, 0),
      occupancy: Math.round((sold / days) * 100),
      averageRate: sold + dayUse ? Math.round(earned / (sold + dayUse)) : 0,
      guests: new Set(inMonth.map((n) => n.reservationRoomId)).size,
      rank: rank >= 0 ? rank + 1 : null, rooms,
      best: ranked[0]?._sum.netAmount ?? 0,
    },
    last14: eachDate(from14, addDays(today, 1)).map((d) => {
      const on = nights.filter((n) => fromDbDate(n.businessDate) === d);
      return { d, amount: on.reduce((t, n) => t + n.netAmount, 0), sold: on.length > 0 };
    }),
    stays: stays.map((s) => ({
      id: s.id, reservationId: s.reservation.id, reference: s.reservation.reference, guestId: s.reservation.guest.id, guest: s.reservation.guest.fullName,
      from: fromDbDate(s.arrivalDate), to: fromDbDate(s.departureDate), nights: s.nights, dayUse: s.isDayUse, amount: s.netAmount, status: s.status,
    })),
  };
}
export type RoomInsight = Awaited<ReturnType<typeof roomInsight>>;

/**
 * The meeting room's card for managers and the MD: this month (income, bookings, hours used of the
 * open hours, cancellations), hours booked over the last 14 days and the latest meetings.
 */
export async function meetingInsight(roomId: string, today: BusinessDate) {
  const monthFrom = `${today.slice(0, 8)}01`;
  const from14 = addDays(today, -13);
  const from = monthFrom < from14 ? monthFrom : from14;
  const [bookings, nights, latest] = await Promise.all([
    db.reservationRoom.findMany({
      where: { roomId, arrivalDate: { gte: toDbDate(from), lte: toDbDate(today) } },
      select: { status: true, startAt: true, endAt: true, arrivalDate: true },
    }),
    db.roomNight.findMany({ where: { roomId, businessDate: { gte: toDbDate(monthFrom), lte: toDbDate(today) }, ...EARNED_NIGHT }, select: { netAmount: true } }),
    db.reservationRoom.findMany({
      where: { roomId, status: { not: "CANCELLED" }, arrivalDate: { lte: toDbDate(today) } }, orderBy: { startAt: "desc" }, take: 6,
      select: { id: true, status: true, startAt: true, endAt: true, arrivalDate: true, netAmount: true, reservation: { select: { id: true, reference: true, companyName: true, guest: { select: { fullName: true } } } } },
    }),
  ]);
  const hours = (b: { startAt: Date; endAt: Date }) => Math.max(0, (b.endAt.getTime() - b.startAt.getTime()) / 3_600_000);
  const live = (b: { status: string }) => b.status !== "CANCELLED" && b.status !== "NO_SHOW";
  const month = bookings.filter((b) => fromDbDate(b.arrivalDate) >= monthFrom);
  const used = month.filter(live).reduce((t, b) => t + hours(b), 0);
  const days = diffDays(monthFrom, today) + 1;
  const open = days * MEETING_OPEN_HOURS;
  const income = nights.reduce((t, n) => t + n.netAmount, 0);
  const count = month.filter((b) => b.status !== "CANCELLED").length;
  return {
    month: {
      label: new Date(`${today}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", timeZone: "UTC" }),
      income, bookings: count, completed: month.filter((b) => b.status === "CHECKED_OUT").length,
      cancelled: month.filter((b) => b.status === "CANCELLED").length, noShows: month.filter((b) => b.status === "NO_SHOW").length,
      hours: Math.round(used * 10) / 10, openHours: open, utilisation: open ? Math.round((used / open) * 100) : 0,
      perBooking: count ? Math.round(income / count) : 0,
    },
    last14: eachDate(from14, addDays(today, 1)).map((d) => {
      const on = bookings.filter((b) => fromDbDate(b.arrivalDate) === d && live(b));
      return { d, hours: Math.round(on.reduce((t, b) => t + hours(b), 0) * 10) / 10 };
    }),
    latest: latest.map((b) => ({
      id: b.id, reservationId: b.reservation.id, reference: b.reservation.reference, who: b.reservation.companyName ?? b.reservation.guest.fullName,
      date: fromDbDate(b.arrivalDate), startAt: b.startAt.toISOString(), endAt: b.endAt.toISOString(), amount: b.netAmount, status: b.status,
    })),
  };
}
export type MeetingInsight = Awaited<ReturnType<typeof meetingInsight>>;
