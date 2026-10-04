import "server-only";
import { randomBytes } from "node:crypto";
import { db, type Tx } from "../db";
import { audit } from "../audit";
import { AppError } from "../errors";
import { fromDbDate } from "@/lib/time/business-date";
import type { StaySnapshot } from "@/lib/thank-you";
import { guestEventOn } from "@/lib/guest-messages";
import type { Prisma } from "@/generated/prisma/client";

type Actor = { userId?: string | null; label?: string; ipAddress?: string | null };

/**
 * GuestThankYouService — the note a guest takes home at check-out: their stay
 * and final figures, from the finished reservation (never typed by staff).
 * Each note is saved as a version with a snapshot of the stay; making it again
 * after an authorized correction adds a new version and keeps the old ones.
 */

/** The guest's own stay, as the note shows it (no other guest's or room's charges, no internal accounting). */
export async function staySnapshot(tx: Tx | typeof db, reservationId: string): Promise<StaySnapshot> {
  const r = await tx.reservation.findUnique({
    where: { id: reservationId },
    include: {
      guest: { select: { fullName: true, phone: true, email: true } },
      rooms: { where: { status: { not: "CANCELLED" } }, include: { room: { select: { number: true } }, roomType: { select: { name: true } } }, orderBy: { arrivalDate: "asc" } },
      charges: { where: { isVoided: false }, select: { kind: true, amount: true } },
      payments: { where: { status: "POSTED" }, select: { amount: true, kind: true } },
      corporateCustomer: { select: { companyName: true } },
      group: { select: { name: true, contactGuest: { select: { fullName: true } }, corporateCustomer: { select: { companyName: true } } } },
    },
  });
  if (!r) throw new AppError("Reservation not found.", "NOT_FOUND");
  const kind = (k: string) => r.charges.filter((c) => c.kind === k).reduce((t, c) => t + c.amount, 0);
  const charges = {
    room: r.grossAmount, restaurant: kind("RESTAURANT"), bar: kind("BAR"), roomService: kind("ROOM_SERVICE"), transport: kind("TRANSPORT"),
    other: r.charges.filter((c) => !["RESTAURANT", "BAR", "ROOM_SERVICE", "TRANSPORT"].includes(c.kind)).reduce((t, c) => t + c.amount, 0),
  };
  const subtotal = Object.values(charges).reduce((t, v) => t + v, 0);
  const paid = r.payments.reduce((t, p) => t + (p.kind === "REFUND" ? -p.amount : p.amount), 0);
  const balance = Math.max(0, r.balanceAmount);
  const payer = r.billTo === "GROUP" && r.group ? r.group.corporateCustomer?.companyName ?? r.group.name : r.billTo !== "GUEST" ? r.corporateCustomer?.companyName ?? null : null;
  const settled = Math.max(0, r.netAmount - paid - balance);
  const times = (xs: (Date | null)[]) => xs.filter((d): d is Date => !!d).map((d) => d.toISOString()).sort();
  return {
    guest: { name: r.guest.fullName, phone: r.guest.phone, email: r.guest.email },
    reference: r.reference,
    rooms: r.rooms.map((x) => ({ number: x.room.number, type: x.roomType.name, nights: x.isDayUse ? 0 : x.nights, rate: x.ratePerNight, dayUse: x.isDayUse })),
    arrival: fromDbDate(r.arrivalDate), departure: fromDbDate(r.departureDate),
    checkedInAt: times(r.rooms.map((x) => x.checkedInAt))[0] ?? null,
    checkedOutAt: times(r.rooms.map((x) => x.checkedOutAt)).at(-1) ?? null,
    nights: r.rooms.reduce((m, x) => Math.max(m, x.isDayUse ? 0 : x.nights), 0),
    guests: r.adults + r.children,
    group: r.group ? { name: r.group.name, contact: r.group.contactGuest.fullName } : null,
    company: r.corporateCustomer?.companyName ?? r.companyName ?? null,
    charges, subtotal, discount: r.discountAmount, adjustments: r.netAmount - (subtotal - r.discountAmount), total: r.netAmount,
    paid, billedTo: payer && settled > 0 ? { name: payer, amount: settled } : null, balance,
  };
}

/** Make the guest's thank-you note (a new version when it already exists). */
export async function generateThankYouNote(reservationId: string, actor: Actor, reason?: string | null) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${reservationId} FOR UPDATE`;
    const r = await tx.reservation.findUnique({ where: { id: reservationId }, select: { status: true, kind: true, reference: true, guest: { select: { fullName: true } } } });
    if (!r) throw new AppError("Reservation not found.", "NOT_FOUND");
    if (r.status !== "CHECKED_OUT") throw new AppError("The thank-you note is made when the guest has checked out.");
    const last = await tx.thankYouNote.findFirst({ where: { reservationId }, orderBy: { version: "desc" }, select: { version: true } });
    if (last && !reason?.trim()) throw new AppError("Say why the note is being made again (e.g. a corrected charge).", "VALIDATION", { reason: "Required" });
    const snapshot = await staySnapshot(tx, reservationId);
    const note = await tx.thankYouNote.create({
      data: {
        reservationId, version: (last?.version ?? 0) + 1, token: randomBytes(18).toString("base64url"),
        snapshot: snapshot as unknown as Prisma.InputJsonValue, reason: reason?.trim() || null, createdById: actor.userId ?? null,
      },
    });
    await audit(tx, actor, {
      action: last ? "thank_you.regenerated" : "thank_you.generated", entityType: "Reservation", entityId: reservationId,
      after: { version: note.version, reference: r.reference, guest: r.guest.fullName, rooms: snapshot.rooms.map((x) => x.number), total: snapshot.total, reason: note.reason },
    });
    return note;
  });
}

/** At check-out: the first note is made by itself — it never holds up the check-out. */
export async function thankYouAfterCheckout(reservationId: string, actor: Actor) {
  try {
    const r = await db.reservation.findUnique({ where: { id: reservationId }, select: { status: true, kind: true, _count: { select: { thankYouNotes: true } } } });
    if (!r || r.status !== "CHECKED_OUT" || r.kind !== "STAY" || r._count.thankYouNotes > 0) return null;
    const settings = await db.hotelSettings.findFirst({ select: { guestNotifications: true } });
    if (!guestEventOn(settings?.guestNotifications, "checkOut")) return null;
    return await generateThankYouNote(reservationId, actor);
  } catch (e) {
    console.error("thank-you note", reservationId, e);
    return null;
  }
}

export async function thankYouNotes(reservationId: string) {
  return db.thankYouNote.findMany({ where: { reservationId }, orderBy: { version: "desc" }, include: { createdBy: { select: { fullName: true } } } });
}

export async function thankYouByToken(token: string) {
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) return null;
  return db.thankYouNote.findUnique({ where: { token } });
}
