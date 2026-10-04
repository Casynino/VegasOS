import "server-only";
import { db, type Tx } from "../db";
import { audit, type AuditActor } from "../audit";
import { AppError } from "../errors";
import { getSettingsTx, stayConfig } from "../settings";
import { businessDateOf, toDbDate } from "@/lib/time/business-date";
import type { RequestPriority, RequestStatus, RequestType } from "@/generated/prisma/enums";

/**
 * Guest service requests (towels, cleaning, maintenance, restaurant, transport…). They work like an order: one comes in
 * (the guest asks from their phone, or reception logs it), someone ACCEPTS it ("I'm on it"), then marks it DONE. A manager
 * can assign one to a person; that person accepts it (owner, 2026-10-04: reception handles most of them).
 */

type Actor = AuditActor & { userId: string };

const OPEN: RequestStatus[] = ["NEW", "ASSIGNED", "IN_PROGRESS"];

/** Who can be given a request: active staff whose role handles requests (reception first). */
export async function requestHandlers() {
  const users = await db.user.findMany({
    where: { isActive: true, role: { permissions: { some: { permission: { code: "requests.manage" } } } } },
    select: { id: true, fullName: true, role: { select: { code: true, name: true } } },
    orderBy: { fullName: "asc" },
  });
  return users
    .map((u) => ({ id: u.id, fullName: u.fullName, role: u.role.name }))
    .sort((a, b) => Number(!/recep/i.test(a.role)) - Number(!/recep/i.test(b.role)));
}
export type RequestHandler = Awaited<ReturnType<typeof requestHandlers>>[number];

/** Someone who can take a request: active, with a role that handles requests. */
async function assigneeTx(tx: Tx, userId: string) {
  const u = await tx.user.findFirst({
    where: { id: userId, isActive: true, role: { permissions: { some: { permission: { code: "requests.manage" } } } } },
    select: { id: true, fullName: true },
  });
  if (!u) throw new AppError("That person cannot take guest requests.", "VALIDATION");
  return u;
}

const NEXT: Record<RequestStatus, RequestStatus[]> = {
  NEW: ["ASSIGNED", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
  ASSIGNED: ["IN_PROGRESS", "COMPLETED", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED", "CANCELLED"],
  COMPLETED: [],
  CANCELLED: [],
};

export async function createServiceRequest(
  input: { reservationId?: string | null; roomId?: string | null; type: RequestType; priority: RequestPriority; description: string; assignedToId?: string | null; orderId?: string | null },
  actor: Actor,
) {
  if (!input.description.trim()) throw new AppError("Describe the request.", "VALIDATION", { description: "Required" });
  return db.$transaction(async (tx) => {
    const settings = await getSettingsTx(tx);
    if (input.assignedToId) await assigneeTx(tx, input.assignedToId);
    let roomId = input.roomId ?? null;
    let guestId: string | null = null;
    // A complaint about a restaurant order: linked to it (and to the stay, for a room order).
    if (input.orderId) {
      const o = await tx.restaurantOrder.findUnique({ where: { id: input.orderId }, select: { reservationId: true, guestId: true } });
      if (!o) throw new AppError("Order not found.", "NOT_FOUND");
      input = { ...input, reservationId: input.reservationId ?? o.reservationId };
      guestId = o.guestId ?? null;
    }
    if (input.reservationId) {
      const r = await tx.reservation.findUnique({ where: { id: input.reservationId }, include: { rooms: { where: { status: "CHECKED_IN" } } } });
      if (!r) throw new AppError("Reservation not found.");
      guestId = r.guestId;
      roomId ??= r.rooms[0]?.roomId ?? null;
    }
    const req = await tx.serviceRequest.create({
      data: {
        reservationId: input.reservationId ?? null, roomId, guestId, type: input.type, priority: input.priority, orderId: input.orderId ?? null,
        description: input.description.trim(), assignedToId: input.assignedToId || null,
        status: input.assignedToId ? "ASSIGNED" : "NEW", createdById: actor.userId,
        businessDate: toDbDate(businessDateOf(new Date(), stayConfig(settings))),
      },
    });
    // Maintenance requests also surface as a handover note so the next shift sees them.
    if (input.type === "MAINTENANCE") {
      await tx.shiftHandoverNote.create({ data: { businessDate: req.businessDate, kind: "MAINTENANCE", body: `Maintenance request: ${req.description}`, authorId: actor.userId, isImportant: input.priority === "URGENT" || input.priority === "HIGH" } });
    }
    await audit(tx, actor, { action: input.type === "COMPLAINT" ? "complaint.logged" : "request.created", entityType: "ServiceRequest", entityId: req.id, after: { type: req.type, priority: req.priority, roomId, description: req.description, ...(req.orderId && { orderId: req.orderId }) } });
    return req;
  });
}

export async function updateServiceRequest(id: string, input: { status?: RequestStatus; assignedToId?: string | null; resolution?: string | null }, actor: Actor) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "service_requests" WHERE "id" = ${id} FOR UPDATE`;
    const r = await tx.serviceRequest.findUnique({ where: { id } });
    if (!r) throw new AppError("Request not found.", "NOT_FOUND");
    const data: Record<string, unknown> = {};
    if (input.assignedToId !== undefined && (input.assignedToId || null) !== r.assignedToId) {
      if (!OPEN.includes(r.status)) throw new AppError("This request is already closed.");
      if (input.assignedToId) await assigneeTx(tx, input.assignedToId);
      data.assignedToId = input.assignedToId || null;
      // Given to someone: they accept it themselves. Taken off everyone: back to New.
      data.status = input.assignedToId ? "ASSIGNED" : "NEW";
      data.acceptedAt = null;
    }
    if (input.status && input.status !== (data.status ?? r.status)) {
      const from = (data.status ?? r.status) as RequestStatus;
      if (!NEXT[from].includes(input.status)) throw new AppError(`A ${from.toLowerCase().replace("_", " ")} request cannot become ${input.status.toLowerCase().replace("_", " ")}.`);
      data.status = input.status;
      if (input.status === "IN_PROGRESS") { data.acceptedAt = new Date(); data.assignedToId ??= r.assignedToId ?? actor.userId; }
      if (input.status === "COMPLETED") data.completedAt = new Date();
    }
    // A complaint is closed with what was done about it.
    if (input.resolution?.trim()) data.resolution = input.resolution.trim();
    if (r.type === "COMPLAINT" && data.status === "COMPLETED" && !data.resolution && !r.resolution) {
      throw new AppError("Say how the complaint was resolved (e.g. meal replaced, 20% off the bill).", "VALIDATION", { resolution: "Required" });
    }
    if (!Object.keys(data).length) return;
    await tx.serviceRequest.update({ where: { id }, data });
    await audit(tx, actor, { action: r.type === "COMPLAINT" && data.status === "COMPLETED" ? "complaint.resolved" : "request.updated", entityType: "ServiceRequest", entityId: id, before: { status: r.status, assignedToId: r.assignedToId }, after: data });
  });
}

/**
 * "I'm on it": the person accepts the request — it becomes theirs and in progress (like accepting an order). A request
 * assigned to someone else can be taken over (recorded); one someone is already on cannot be taken from them here.
 */
export async function acceptServiceRequest(id: string, actor: Actor) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "service_requests" WHERE "id" = ${id} FOR UPDATE`;
    const r = await tx.serviceRequest.findUnique({ where: { id }, include: { assignedTo: { select: { fullName: true } } } });
    if (!r) throw new AppError("Request not found.", "NOT_FOUND");
    if (r.status === "IN_PROGRESS") {
      if (r.assignedToId === actor.userId) return r;
      throw new AppError(`${r.assignedTo?.fullName ?? "Someone"} is already on it.`, "CONFLICT");
    }
    if (!OPEN.includes(r.status)) throw new AppError("This request is already closed.");
    await assigneeTx(tx, actor.userId);
    const tookOver = r.assignedToId && r.assignedToId !== actor.userId ? { from: r.assignedToId, fromName: r.assignedTo?.fullName ?? null } : null;
    const done = await tx.serviceRequest.update({ where: { id }, data: { status: "IN_PROGRESS", assignedToId: actor.userId, acceptedAt: new Date() } });
    await audit(tx, actor, { action: "request.accepted", entityType: "ServiceRequest", entityId: id, before: { status: r.status, assignedToId: r.assignedToId }, after: { status: "IN_PROGRESS", assignedToId: actor.userId, ...(tookOver && { tookOver }) } });
    return done;
  });
}

const GUEST_LIMIT = 5; // requests per stay per 30 minutes from the guest's phone

/**
 * The guest asks from their phone (stay link or room QR) — only while checked in. It lands on reception's Requests as
 * New (the bell rings) for someone to accept. The room QR's own room is used; a room moved since the scan is refused.
 */
export async function createGuestRequest(
  reservationId: string,
  input: { type: "TOWELS" | "CLEANING" | "MAINTENANCE" | "GENERAL"; description?: string | null; clientKey?: string | null },
  source: "GUEST_LINK" | "ROOM_QR",
  now = new Date(),
  opts: { roomId?: string } = {},
) {
  if (input.clientKey) {
    const same = await db.serviceRequest.findUnique({ where: { clientKey: input.clientKey } });
    if (same) return same; // the same tap sent twice
  }
  const label = { TOWELS: "Extra towels", CLEANING: "Please clean the room", MAINTENANCE: "Something is not working", GENERAL: "The guest needs help" }[input.type];
  const note = input.description?.trim().slice(0, 300) || "";
  if (input.type === "GENERAL" && note.length < 2) throw new AppError("Tell us what you need.", "VALIDATION", { description: "Required" });
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${reservationId} FOR UPDATE`;
    const r = await tx.reservation.findUnique({
      where: { id: reservationId },
      select: { id: true, status: true, reference: true, guestId: true, rooms: { where: { status: "CHECKED_IN" }, select: { roomId: true } } },
    });
    if (!r) throw new AppError("This stay was not found.", "NOT_FOUND");
    if (r.status !== "CHECKED_IN") throw new AppError("Requests open when you have checked in. Please call reception.", "VALIDATION");
    if (opts.roomId && !r.rooms.some((x) => x.roomId === opts.roomId)) throw new AppError("No one is checked in to this room right now — please call reception.", "VALIDATION");
    const recent = await tx.serviceRequest.count({ where: { reservationId: r.id, source: { in: ["GUEST_LINK", "ROOM_QR"] }, createdAt: { gte: new Date(now.getTime() - 30 * 60_000) } } });
    if (recent >= GUEST_LIMIT) throw new AppError("Several requests were sent just now — please call reception for more.", "VALIDATION");
    const settings = await getSettingsTx(tx);
    const req = await tx.serviceRequest.create({
      data: {
        reservationId: r.id, roomId: opts.roomId ?? r.rooms[0]?.roomId ?? null, guestId: r.guestId, type: input.type,
        priority: input.type === "MAINTENANCE" ? "HIGH" : "NORMAL", description: note ? (input.type === "GENERAL" ? note : `${label} — ${note}`) : label,
        status: "NEW", source, clientKey: input.clientKey ?? null, createdById: null,
        businessDate: toDbDate(businessDateOf(now, stayConfig(settings))),
      },
    });
    await audit(tx, { userId: null, label: `Guest (${source === "ROOM_QR" ? "room QR" : "online"}) · ${r.reference}` }, { action: "request.created", entityType: "ServiceRequest", entityId: req.id, after: { type: req.type, priority: req.priority, roomId: req.roomId, description: req.description, source } });
    return req;
  });
}
