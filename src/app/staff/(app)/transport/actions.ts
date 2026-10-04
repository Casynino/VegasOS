"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { authorize, requestMeta, type CurrentUser } from "@/server/auth";
import { AppError, isUniqueViolation, runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import {
  adjustTripPrice, chargeTripToRoom, confirmTrip, createTransportRequest, payTripDirect, recordDriver, saveTransportService, setTripStatus, transportServices,
} from "@/server/services/transport";

async function actor(user: CurrentUser) {
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, ipAddress, permissions: user.permissions };
}
function refresh(reservationId?: string | null) {
  revalidatePath("/staff/transport");
  revalidatePath("/staff/driver");
  revalidatePath("/staff/payments");
  revalidatePath("/staff/finance", "layout");
  if (reservationId) revalidatePath(`/staff/reservations/${reservationId}`);
}
const tripReservation = async (id: string) => (await db.transportTrip.findUnique({ where: { id }, select: { reservationId: true } }))?.reservationId ?? null;

const RequestSchema = z.object({
  serviceId: z.string().min(1, "Choose a service."),
  optionId: z.string().optional(),
  passengerName: z.string().trim().min(2, "Enter the guest's name.").max(120),
  passengerPhone: z.string().trim().min(7, "A phone number is needed.").max(30),
  passengerEmail: z.string().trim().email("Enter a valid email.").max(120).optional().or(z.literal("")),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Choose a date."),
  time: z.string().regex(/^\d{2}:\d{2}$/, "Choose a time."),
  airport: z.string().trim().max(120).optional(),
  pickupLocation: z.string().trim().max(200).optional(),
  destination: z.string().trim().max(200).optional(),
  flightNumber: z.string().trim().max(20).optional(),
  passengers: z.coerce.number().int().min(1, "At least 1 guest.").max(40),
  bags: z.coerce.number().int().min(0).max(60).optional(),
  reservationId: z.string().optional(),
  reservationRef: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(600).optional(),
  confirmNow: z.boolean().optional(),
});

/** Phone / WhatsApp / walk-up / a staying guest: the same request the website makes (starts pending; can be confirmed at once). */
export async function createTransportRequestAction(input: z.input<typeof RequestSchema>): Promise<ActionResult<{ reference: string }>> {
  return runAction(async () => {
    const user = await authorize("transport.request", "transport.manage");
    const d = parseInput(RequestSchema, input);
    const a = await actor(user);
    const trip = await createTransportRequest({ ...d, passengerEmail: d.passengerEmail || null, reservationId: d.reservationId || null }, { source: "STAFF", actor: a });
    if (d.confirmNow) await confirmTrip(trip.id, a);
    refresh(trip.reservationId);
    return { reference: trip.reference };
  });
}

export async function confirmTripAction(input: { tripId: string }) {
  return runAction(async () => {
    const user = await authorize("transport.request", "transport.manage");
    await confirmTrip(input.tripId, await actor(user));
    refresh(await tripReservation(input.tripId));
    return null;
  }, "Transport confirmed.");
}

export async function recordDriverAction(input: { tripId: string; driverId?: string; driverName?: string; driverPhone?: string; vehicleId?: string; vehicleName?: string; vehiclePlate?: string }) {
  return runAction(async () => {
    const user = await authorize("transport.request", "transport.manage");
    await recordDriver(input.tripId, {
      driverId: input.driverId || null, driverName: input.driverName, driverPhone: input.driverPhone,
      vehicleId: input.vehicleId || null, vehicleName: input.vehicleName, vehiclePlate: input.vehiclePlate,
    }, await actor(user));
    refresh();
    return null;
  }, "Driver saved.");
}

export async function tripStatusAction(input: { tripId: string; status: "CONFIRMED" | "EN_ROUTE" | "PICKED_UP" | "COMPLETED" | "CANCELLED" | "NO_SHOW"; reason?: string }) {
  return runAction(async () => {
    const user = await authorize("transport.manage", "transport.request", "transport.driver");
    await setTripStatus(input.tripId, input.status, await actor(user), input.reason);
    refresh(await tripReservation(input.tripId));
    return null;
  }, "Trip updated.");
}

export async function adjustTripPriceAction(input: { tripId: string; price: number; reason: string }) {
  return runAction(async () => {
    const user = await authorize("transport.manage");
    await adjustTripPrice(input.tripId, Math.round(Number(input.price)), input.reason ?? "", await actor(user));
    refresh();
    return null;
  }, "Price changed.");
}

export async function chargeTripToRoomAction(input: { tripId: string; reservationId?: string }) {
  return runAction(async () => {
    const user = await authorize("payments.record");
    const r = await chargeTripToRoom(input.tripId, await actor(user), input.reservationId || null);
    refresh(r.reservationId);
    return r;
  });
}

export async function payTripDirectAction(input: { tripId: string; accountId: string; reference?: string }) {
  return runAction(async () => {
    const user = await authorize("payments.record");
    await payTripDirect(input.tripId, { accountId: input.accountId, reference: input.reference }, await actor(user));
    refresh();
    return null;
  }, "Payment recorded.");
}

/** A trip's history (who did what, when) for its detail card. */
export async function tripHistoryAction(input: { tripId: string }) {
  return runAction(async () => {
    await authorize("transport.view", "transport.manage");
    const rows = await db.auditLog.findMany({ where: { entityType: "TransportTrip", entityId: input.tripId }, orderBy: { createdAt: "asc" }, select: { id: true, action: true, actorLabel: true, createdAt: true, after: true } });
    return rows.map((r) => ({ id: r.id, action: r.action, by: r.actorLabel, at: r.createdAt.toISOString(), reason: (r.after as { reason?: string } | null)?.reason ?? null }));
  });
}

export async function saveTransportServiceAction(input: {
  id: string; name: string; description?: string; price: number; isActive: boolean; isPublic: boolean;
  options?: { id?: string; name: string; description?: string; price: number; isActive?: boolean }[];
}) {
  return runAction(async () => {
    const user = await authorize("transport.manage", "settings.manage");
    await saveTransportService({ ...input, price: Math.round(Number(input.price)), options: input.options?.map((o) => ({ ...o, price: Math.round(Number(o.price)) })) }, await actor(user));
    refresh();
    revalidatePath("/transport");
    return null;
  }, "Price saved.");
}

const VehicleSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(2, "Vehicle name is required.").max(60),
  plateNumber: z.string().trim().max(20).transform((v) => v.toUpperCase() || null),
  capacity: z.coerce.number().int().min(1).max(60),
  isActive: z.preprocess((v) => v === undefined ? true : v === "on", z.boolean()),
});

export async function saveVehicleAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("transport.manage");
    const { id, ...d } = parseInput(VehicleSchema, formData);
    try {
      const v = id ? await db.vehicle.update({ where: { id }, data: d }) : await db.vehicle.create({ data: d });
      await audit(db, { userId: user.id, label: user.fullName }, { action: id ? "vehicle.updated" : "vehicle.created", entityType: "Vehicle", entityId: v.id, after: d });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError("A vehicle with this plate already exists.", "CONFLICT", { plateNumber: "Duplicate" });
      throw e;
    }
    refresh();
    return null;
  }, "Vehicle saved.");
}

/** What the transport request form needs for one guest — opened right from the room card. */
export async function transportFormAction(input: { reservationId: string }) {
  return runAction(async () => {
    await authorize("transport.request", "transport.manage");
    const [services, r] = await Promise.all([
      transportServices(),
      db.reservation.findUnique({ where: { id: input.reservationId }, include: { guest: true, rooms: { where: { status: { not: "CANCELLED" } }, include: { room: { select: { number: true } } } } } }),
    ]);
    if (!r) throw new AppError("Booking not found.", "NOT_FOUND");
    const staying = r.status === "CHECKED_IN";
    return {
      services: services.map((s) => ({
        id: s.id, name: s.name, description: s.description, type: s.type, price: s.price, isActive: s.isActive, isPublic: s.isPublic,
        options: s.options.map((o) => ({ id: o.id, name: o.name, description: o.description, price: o.price, isActive: o.isActive })),
      })),
      booking: { id: r.id, name: r.guest.fullName, phone: r.guest.phone, email: r.guest.email, label: `Room ${r.rooms.map((x) => x.room.number).join(", ")} · ${staying ? "in the hotel" : r.reference}`, staying },
    };
  });
}
