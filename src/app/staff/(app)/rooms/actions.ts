"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { authorize, requestMeta } from "@/server/auth";
import { AppError, isUniqueViolation, runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { changeRoomStatus } from "@/server/services/rooms";
import { meetingInsight, roomInsight, type MeetingInsight, type RoomInsight } from "@/server/services/room-insight";
import { businessToday } from "@/server/settings";

const STATUSES = ["AVAILABLE", "READY", "DIRTY", "CLEANING", "MAINTENANCE", "OUT_OF_SERVICE"] as const;

const StatusSchema = z.object({
  roomId: z.string().min(1),
  status: z.enum(STATUSES),
  note: z.string().trim().max(300).optional(),
});

export async function changeRoomStatusAction(input: z.input<typeof StatusSchema>): Promise<ActionResult<{ warning?: string }>> {
  return runAction(async () => {
    const user = await authorize("rooms.status.update");
    const data = parseInput(StatusSchema, input);
    const { ipAddress } = await requestMeta();
    const result = await changeRoomStatus(
      data.roomId, data.status,
      { userId: user.id, label: user.fullName, ipAddress, permissions: user.permissions },
      data.note || null,
    );
    revalidatePath("/staff/rooms");
    revalidatePath("/staff");
    return result;
  }, "Room status updated.");
}

// ─────────── Room types & rates ───────────

const RoomTypeSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(2).max(60),
  baseRate: z.coerce.number().int("Whole shillings only.").min(1000, "Rate looks too low."),
  displayRateUsd: z.union([z.literal(""), z.coerce.number().int().min(0)]).transform((v) => (v === "" ? null : v)),
  maxAdults: z.coerce.number().int().min(1).max(10),
  maxChildren: z.coerce.number().int().min(0).max(10),
  bedType: z.string().trim().max(60).transform((v) => v || null),
  sizeSqm: z.union([z.literal(""), z.coerce.number().int().min(1).max(500)]).transform((v) => (v === "" ? null : v)),
  shortDescription: z.string().trim().max(200).transform((v) => v || null),
  description: z.string().trim().max(2000).transform((v) => v || null),
  images: z.string().max(4000),
  isPublic: z.preprocess((v) => v === "on", z.boolean()),
  isActive: z.preprocess((v) => v === "on", z.boolean()),
  amenityIds: z.array(z.string()).default([]),
});

export async function updateRoomTypeAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("rooms.manage");
    const input = parseInput(RoomTypeSchema, formData);
    const images = input.images.split("\n").map((s) => s.trim()).filter(Boolean);
    if (images.some((i) => !i.startsWith("/images/") && !i.startsWith("https://"))) {
      throw new AppError("Image paths must start with /images/ or https://", "VALIDATION", { images: "Invalid path" });
    }
    const { ipAddress } = await requestMeta();
    await db.$transaction(async (tx) => {
      const before = await tx.roomType.findUnique({ where: { id: input.id }, include: { amenities: true } });
      if (!before) throw new AppError("Room type not found.", "NOT_FOUND");
      // Room prices belong to Admin (Settings → Room pricing).
      if (before.baseRate !== input.baseRate && !user.permissions.has("pricing.manage")) {
        throw new AppError("Only Admin can change room prices (Settings → Room pricing).", "FORBIDDEN", { baseRate: "Admin only" });
      }
      const { id, amenityIds, ...fields } = input;
      await tx.roomType.update({ where: { id }, data: { ...fields, images } });
      await tx.roomTypeAmenity.deleteMany({ where: { roomTypeId: id } });
      if (amenityIds.length) {
        await tx.roomTypeAmenity.createMany({ data: amenityIds.map((amenityId) => ({ roomTypeId: id, amenityId })) });
      }
      const actor = { userId: user.id, label: user.fullName, ipAddress };
      if (before.baseRate !== input.baseRate) {
        await audit(tx, actor, {
          action: "pricing.rate_changed", entityType: "RoomType", entityId: id,
          before: { name: before.name, baseRate: before.baseRate }, after: { name: input.name, baseRate: input.baseRate },
        });
      }
      await audit(tx, actor, {
        action: "room_type.updated", entityType: "RoomType", entityId: id,
        before: { name: before.name, maxAdults: before.maxAdults, isPublic: before.isPublic, isActive: before.isActive },
        after: { name: input.name, maxAdults: input.maxAdults, isPublic: input.isPublic, isActive: input.isActive },
      });
    });
    revalidatePath("/staff/rooms", "layout");
    revalidatePath("/", "layout");
    return null;
  }, "Room type saved. New rates apply to new bookings only.");
}

// ─────────── Rooms (inventory) ───────────

const RoomSchema = z.object({
  id: z.string().optional(),
  number: z.string().trim().regex(/^[A-Za-z0-9-]{1,10}$/, "Use letters/numbers, up to 10 characters."),
  roomTypeId: z.string().min(1, "Choose a room type."),
  floor: z.union([z.literal(""), z.coerce.number().int().min(-2).max(50)]).transform((v) => (v === "" ? null : v)),
  notes: z.string().trim().max(300).transform((v) => v || null),
  isActive: z.preprocess((v) => v === undefined ? true : v === "on", z.boolean()),
});

export async function saveRoomAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("rooms.manage");
    const input = parseInput(RoomSchema, formData);
    const { ipAddress } = await requestMeta();
    const actor = { userId: user.id, label: user.fullName, ipAddress };
    try {
      await db.$transaction(async (tx) => {
        const type = await tx.roomType.findUnique({ where: { id: input.roomTypeId } });
        if (!type) throw new AppError("Room type not found.", "NOT_FOUND");
        if (!input.id) {
          const room = await tx.room.create({
            data: { number: input.number, roomTypeId: type.id, floor: input.floor, notes: input.notes },
          });
          await audit(tx, actor, { action: "room.created", entityType: "Room", entityId: room.id, after: { number: room.number, type: type.name } });
          return;
        }
        const before = await tx.room.findUnique({ where: { id: input.id }, include: { roomType: true } });
        if (!before) throw new AppError("Room not found.", "NOT_FOUND");
        if (!input.isActive && before.isActive) {
          const future = await tx.reservationRoom.count({
            where: { roomId: before.id, status: { in: ["RESERVED", "CONFIRMED", "CHECKED_IN"] }, endAt: { gt: new Date() } },
          });
          if (future > 0) throw new AppError(`Room ${before.number} has ${future} current/upcoming booking(s). Reassign them first.`, "CONFLICT");
        }
        if (before.roomTypeId !== type.id) {
          const future = await tx.reservationRoom.count({
            where: { roomId: before.id, status: { in: ["RESERVED", "CONFIRMED", "CHECKED_IN"] }, endAt: { gt: new Date() } },
          });
          if (future > 0) throw new AppError(`Room ${before.number} has upcoming bookings; change its type after they finish or reassign them.`, "CONFLICT");
        }
        await tx.room.update({
          where: { id: before.id },
          data: { number: input.number, roomTypeId: type.id, floor: input.floor, notes: input.notes, isActive: input.isActive },
        });
        await audit(tx, actor, {
          action: "room.updated", entityType: "Room", entityId: before.id,
          before: { number: before.number, type: before.roomType.name, floor: before.floor, isActive: before.isActive },
          after: { number: input.number, type: type.name, floor: input.floor, isActive: input.isActive },
        });
      });
    } catch (e) {
      if (isUniqueViolation(e)) throw new AppError(`Room number ${input.number} already exists.`, "CONFLICT", { number: "Already exists" });
      throw e;
    }
    revalidatePath("/staff/rooms", "layout");
    revalidatePath("/staff");
    return null;
  }, formData.get("id") ? "Room updated." : "Room added to inventory.");
}

/** The room's recent bookings and status changes — shown right in the room card. */
export async function roomHistoryAction(input: { roomId: string }) {
  return runAction(async () => {
    await authorize("rooms.view");
    const [stays, statuses] = await Promise.all([
      db.reservationRoom.findMany({
        where: { roomId: input.roomId, status: { notIn: ["CANCELLED"] } }, orderBy: { startAt: "desc" }, take: 8,
        select: {
          id: true, status: true, startAt: true, endAt: true, arrivalDate: true, departureDate: true, nights: true, isDayUse: true, netAmount: true,
          reservation: { select: { id: true, reference: true, kind: true, companyName: true, guest: { select: { fullName: true } } } },
        },
      }),
      db.roomStatusHistory.findMany({ where: { roomId: input.roomId }, orderBy: { changedAt: "desc" }, take: 8, include: { changedBy: { select: { fullName: true } } } }),
    ]);
    return {
      stays: stays.map((s) => ({
        id: s.id, reservationId: s.reservation.id, reference: s.reservation.reference, status: s.status, meeting: s.reservation.kind === "MEETING",
        guest: s.reservation.kind === "MEETING" ? s.reservation.companyName ?? s.reservation.guest.fullName : s.reservation.guest.fullName,
        from: s.arrivalDate.toISOString().slice(0, 10), to: s.departureDate.toISOString().slice(0, 10), startAt: s.startAt.toISOString(), endAt: s.endAt.toISOString(),
        nights: s.nights, isDayUse: s.isDayUse, net: s.netAmount,
      })),
      statuses: statuses.map((h) => ({ id: h.id, from: h.fromStatus, to: h.toStatus, at: h.changedAt.toISOString(), by: h.changedBy?.fullName ?? null, note: h.note })),
    };
  });
}

/** The manager's / MD's room card: how the room performs this month, its last 14 nights and latest guests. */
export async function roomInsightAction(input: { roomId: string }): Promise<ActionResult<RoomInsight>> {
  return runAction(async () => {
    await authorize("reports.view", "finance.view");
    return roomInsight(z.string().min(1).max(40).parse(input.roomId), await businessToday());
  });
}

/** The meeting room's card for managers and the MD: this month, the last 14 days, the latest meetings. */
export async function meetingInsightAction(input: { roomId: string }): Promise<ActionResult<MeetingInsight>> {
  return runAction(async () => {
    await authorize("reports.view", "finance.view");
    return meetingInsight(z.string().min(1).max(40).parse(input.roomId), await businessToday());
  });
}
