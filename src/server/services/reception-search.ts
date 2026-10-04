import "server-only";
import { listGroups } from "./groups";
import { db } from "../db";
import type { Prisma } from "@/generated/prisma/client";

/**
 * Forgiving front-desk search: every word of a name must appear (any order,
 * any case), phone numbers match on their last 9 digits whatever the format,
 * references match partially, and a room number finds whoever holds it.
 */
export async function receptionSearch(raw: string) {
  const q = raw.trim().slice(0, 80);
  if (q.length < 2) return null;
  const words = q.split(/\s+/).filter(Boolean).slice(0, 4);
  const digits = q.replace(/\D/g, "");
  const phoneLike = digits.length >= 6 && digits.length >= q.replace(/[\s+()-]/g, "").length - 1;
  const phoneTail = phoneLike ? digits.slice(-9) : null;
  const room = /^[A-Za-z]?\d{2,4}$/.test(q) ? q.toUpperCase() : null;

  const nameMatch = { AND: words.map((w) => ({ fullName: { contains: w, mode: "insensitive" as const } })) };
  const resWhere: Prisma.ReservationWhereInput = {
    OR: [
      { reference: { contains: q, mode: "insensitive" } },
      { externalReference: { contains: q, mode: "insensitive" } },
      { guest: nameMatch },
      // Anyone sharing the room, the group it belongs to, and invoice numbers.
      { guests: { some: { guest: nameMatch } } },
      { group: { OR: [{ name: { contains: q, mode: "insensitive" } }, { reference: { contains: q, mode: "insensitive" } }] } },
      { invoices: { some: { number: { contains: q, mode: "insensitive" } } } },
      { invoiceItems: { some: { invoice: { number: { contains: q, mode: "insensitive" } } } } },
      // Company (meeting room bookings, company stays) and room type ("meeting room").
      { companyName: { contains: q, mode: "insensitive" } },
      { corporateCustomer: { companyName: { contains: q, mode: "insensitive" } } },
      { rooms: { some: { roomType: { name: { contains: q, mode: "insensitive" } } } } },
      ...(phoneTail ? [{ guest: { phone: { contains: phoneTail } } }] : []),
      ...(room ? [{ rooms: { some: { room: { number: room } } } }] : []),
      // A date (2026-09-30) finds bookings running that day.
      ...(/^\d{4}-\d{2}-\d{2}$/.test(q) ? [{ arrivalDate: { lte: new Date(`${q}T00:00:00Z`) }, departureDate: { gte: new Date(`${q}T00:00:00Z`) } }] : []),
    ],
  };

  const [reservations, guests, requests, groups] = await Promise.all([
    db.reservation.findMany({
      where: resWhere,
      include: {
        guest: { select: { fullName: true, phone: true } }, source: { select: { name: true } }, group: { select: { id: true, name: true, reference: true } },
        rooms: { where: { status: { not: "CANCELLED" } }, include: { room: { select: { number: true } }, roomType: { select: { name: true, category: true } } } },
      },
      orderBy: { arrivalDate: "desc" },
      take: 40,
    }),
    phoneTail || words.length
      ? db.guest.findMany({
          where: { deletedAt: null, OR: [nameMatch, ...(phoneTail ? [{ phone: { contains: phoneTail } }] : [])] },
          include: {
            _count: { select: { reservations: { where: { status: "CHECKED_OUT" } } } },
            reservations: { where: { status: "CHECKED_OUT" }, orderBy: { departureDate: "desc" }, take: 1, select: { departureDate: true } },
          },
          orderBy: { updatedAt: "desc" },
          take: 10,
        })
      : Promise.resolve([]),
    db.bookingRequest.findMany({
      where: {
        status: { in: ["NEW", "REVIEWING", "CONTACTED", "CONFIRMED"] },
        OR: [{ reference: { contains: q, mode: "insensitive" } }, nameMatch, ...(phoneTail ? [{ phone: { contains: phoneTail } }] : [])],
      },
      include: { roomType: { select: { name: true } } },
      take: 10,
    }),
    listGroups({ q, view: "all", today: "1970-01-01", take: 10 }),
  ]);

  // Room-number search on in-house/arriving stays should not surface years of history for that room.
  const rank = (s: string) => (s === "CHECKED_IN" ? 0 : s === "CONFIRMED" || s === "RESERVED" ? 1 : s === "INQUIRY" ? 2 : 3);
  const sorted = reservations
    .filter((r) => !room || rank(r.status) < 3 || r.reference.toUpperCase().includes(q.toUpperCase()) || words.some((w) => r.guest.fullName.toLowerCase().includes(w.toLowerCase())))
    .sort((a, b) => rank(a.status) - rank(b.status));

  return { q, reservations: sorted, guests, requests, groups };
}
