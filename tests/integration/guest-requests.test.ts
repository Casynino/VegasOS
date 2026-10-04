import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { checkIn, createReservation } from "@/server/services/reservations";
import { acceptServiceRequest, createGuestRequest, createServiceRequest, updateServiceRequest } from "@/server/services/requests";
import { askFromStay } from "@/server/services/guest-comms";
import { staffAlerts } from "@/server/services/staff-alerts";
import { addDays, businessDateOf, zonedInstant } from "@/lib/time/business-date";
import { managerActor as anyManager, receptionistActor as anyReceptionist, resetBusinessData, roomType } from "../support/helpers";

// Requests are always handled by a signed-in person.
const managerActor = async () => { const a = await anyManager(); return { ...a, userId: a.userId! }; };
const receptionistActor = async () => { const a = await anyReceptionist(); return { ...a, userId: a.userId! }; };

/**
 * Guest requests work like orders (owner, 2026-10-04): one comes in — the guest asks from their phone, or reception logs
 * it — someone accepts it, then marks it done. A manager can give one to a person, who accepts it themselves.
 */
const TZ = "Africa/Dar_es_Salaam";
const today = () => businessDateOf(new Date());

beforeEach(async () => { await resetBusinessData(); });

async function stay(name: string, opts: { checkedIn?: boolean; arrival?: number } = {}) {
  const dd = await roomType("DOUBLE_DELUXE");
  const from = addDays(today(), opts.arrival ?? -1);
  const r = await createReservation({
    sourceCode: "PHONE", guest: { fullName: name, phone: "0712 900 900" }, stay: { kind: "overnight", arrivalDate: from, departureDate: addDays(from, 3) },
    rooms: [{ roomTypeId: dd.id, roomId: dd.rooms[0].id, adults: 1, children: 0, discountPerNight: 0 }],
  }, await managerActor(), zonedInstant(addDays(today(), -2), 12 * 60, TZ));
  if (opts.checkedIn ?? true) await checkIn(r.id, await managerActor(), null, zonedInstant(from, 15 * 60, TZ));
  return db.reservation.findUniqueOrThrow({ where: { id: r.id } });
}
const clientKey = (n: number) => n.toString(16).padStart(32, "0");

describe("the guest asks from their phone", () => {
  it("lands as New, from the guest — once per tap, only while checked in, and not too many at once", async () => {
    const s = await stay("Asking Guest");
    const token = (await db.reservation.update({ where: { id: s.id }, data: { guestToken: "t".repeat(24) } })).guestToken!;
    const r = await askFromStay(token, { type: "TOWELS", description: "2 more please", clientKey: clientKey(1) });
    expect(r).toMatchObject({ status: "NEW", source: "GUEST_LINK", createdById: null, guestId: s.guestId, description: "Extra towels — 2 more please" });
    // The same tap sent twice: one request.
    expect((await askFromStay(token, { type: "TOWELS", description: "2 more please", clientKey: clientKey(1) })).id).toBe(r.id);
    // "Something else" needs words.
    await expect(askFromStay(token, { type: "GENERAL" })).rejects.toThrow(/what you need/);
    for (let i = 2; i <= 5; i++) await askFromStay(token, { type: "CLEANING", clientKey: clientKey(i) });
    await expect(askFromStay(token, { type: "CLEANING", clientKey: clientKey(9) })).rejects.toThrow(/call reception/);
    // Reception's bell rings for it.
    const recep = await receptionistActor();
    expect((await staffAlerts(recep.permissions as Set<string>, recep.userId)).some((a) => a.id.startsWith(`request:${r.id}`) && a.text.startsWith("The guest asks"))).toBe(true);
  });

  it("a booking not checked in yet cannot send requests", async () => {
    const s = await stay("Future Guest", { checkedIn: false, arrival: 3 });
    await expect(createGuestRequest(s.id, { type: "TOWELS" }, "GUEST_LINK")).rejects.toThrow(/checked in/);
  });
});

describe("accept, then done — like an order", () => {
  it("anyone at reception accepts a New request; then it is theirs and nobody else can take it from them here", async () => {
    const s = await stay("Towel Guest");
    const recep = await receptionistActor();
    const mgr = await managerActor();
    const r = await createGuestRequest(s.id, { type: "TOWELS" }, "GUEST_LINK");
    const a = await acceptServiceRequest(r.id, recep);
    expect(a).toMatchObject({ status: "IN_PROGRESS", assignedToId: recep.userId });
    expect(a.acceptedAt).toBeInstanceOf(Date);
    await expect(acceptServiceRequest(r.id, mgr)).rejects.toThrow(/already on it/);
    await updateServiceRequest(r.id, { status: "COMPLETED" }, recep);
    const done = await db.serviceRequest.findUniqueOrThrow({ where: { id: r.id } });
    expect(done.status).toBe("COMPLETED");
    expect(done.completedAt).toBeInstanceOf(Date);
    await expect(acceptServiceRequest(r.id, recep)).rejects.toThrow(/closed/);
    expect(await db.auditLog.count({ where: { entityId: r.id, action: "request.accepted" } })).toBe(1);
  });

  it("a manager gives it to a receptionist: it rings for her until she accepts; given to someone else it starts over", async () => {
    const s = await stay("Repair Guest");
    const recep = await receptionistActor();
    const mgr = await managerActor();
    const r = await createServiceRequest({ reservationId: s.id, type: "MAINTENANCE", priority: "HIGH", description: "AC not cooling" }, mgr);
    await updateServiceRequest(r.id, { assignedToId: recep.userId }, mgr);
    expect((await db.serviceRequest.findUniqueOrThrow({ where: { id: r.id } })).status).toBe("ASSIGNED");
    const alerts = await staffAlerts(recep.permissions as Set<string>, recep.userId);
    expect(alerts.find((a) => a.id.startsWith(`request:${r.id}:ASSIGNED:`))?.text).toMatch(/^Given to you — Maintenance/);
    await acceptServiceRequest(r.id, recep);
    expect((await staffAlerts(recep.permissions as Set<string>, recep.userId)).some((a) => a.id.startsWith(`request:${r.id}`))).toBe(false);
    // Handed to the manager while in progress: back to "given, not accepted"; taken off everyone: New again.
    await updateServiceRequest(r.id, { assignedToId: mgr.userId }, recep);
    expect(await db.serviceRequest.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "ASSIGNED", assignedToId: mgr.userId, acceptedAt: null });
    await updateServiceRequest(r.id, { assignedToId: null }, mgr);
    expect(await db.serviceRequest.findUniqueOrThrow({ where: { id: r.id } })).toMatchObject({ status: "NEW", assignedToId: null });
  });

  it("taking over one given to someone else is recorded; only people who handle requests can be given one", async () => {
    const s = await stay("Takeover Guest");
    const recep = await receptionistActor();
    const mgr = await managerActor();
    const r = await createServiceRequest({ reservationId: s.id, type: "CLEANING", priority: "NORMAL", description: "Clean after 14:00", assignedToId: mgr.userId }, mgr);
    await acceptServiceRequest(r.id, recep);
    const log = await db.auditLog.findFirstOrThrow({ where: { entityId: r.id, action: "request.accepted" } });
    expect(log.after).toMatchObject({ tookOver: { from: mgr.userId } });
    const driver = await db.user.findFirst({ where: { role: { code: "DRIVER" } } });
    if (driver) await expect(updateServiceRequest(r.id, { assignedToId: driver.id }, mgr)).rejects.toThrow(/cannot take guest requests/);
  });
});
