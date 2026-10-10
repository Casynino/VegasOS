import "server-only";
import { randomBytes } from "node:crypto";
import { db, type Tx } from "../db";
import { audit } from "../audit";
import { AppError, isExclusionViolation, isUniqueViolation } from "../errors";
import { getSettingsTx, stayConfig } from "../settings";
import { resolveGuest, type GuestInput } from "./guests";
import { cancelReservation, checkIn, checkOut, createReservationTx, type Actor } from "./reservations";
import { recalculateGroup, recalculateReservation } from "./reservation-financials";
import { assertCompanyCredit, billCompanyTx } from "./company-billing";
import { createInvoiceForReservation, issueInvoice, issueInvoiceTx, nextInvoiceNumber, syncInvoice } from "./invoices";
import { resolveAccountTx } from "./payment-accounts";
import { expireUnpaidHolds } from "./booking-holds";
import { CHECK_IN_READY } from "@/lib/room-status";
import { businessDateOf, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import type { GroupBilling, GroupType, Prisma } from "@/generated/prisma/client";
import { msg, msgf, type Localized, type MsgVars } from "@/i18n/msg";
import { getT } from "@/i18n/server";
import { englishT } from "@/i18n/translate";

/**
 * GroupBookingService — rooms that belong together (a company's staff, a
 * family, an event) under one group. It never replaces the reservations:
 * every room is its own Reservation with its own guest(s), dates, price,
 * folio, check-in and check-out. The group links them, knows who pays (its
 * company, or its contact person) and holds the group invoices.
 *
 *   Group ─┬─ Reservation → Room 201 → Director
 *          ├─ Reservation → Room 202 → Employee A
 *          └─ Group invoice(s) → lines per room and guest → payments
 *
 * Money is never counted twice: income comes from each room's nights and
 * charges; a group invoice only moves what is owed from the rooms to the payer,
 * and a group payment settles that invoice.
 */

const REF = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const groupRef = () => `GRP-${Array.from(randomBytes(6), (b) => REF[b % REF.length]).join("")}`;
const OPEN_ROOM = ["INQUIRY", "RESERVED", "CONFIRMED", "CHECKED_IN"] as const;

export interface GroupRoomInput {
  roomTypeId: string;
  roomId?: string | null;
  /** The main guest of this room; omitted = the group's contact person. */
  guest?: GuestInput | null;
  /** Others sharing the room (spouse, children…). */
  occupants?: GuestInput[];
  adults: number;
  children: number;
  discountPerNight?: number | null;
  discountReason?: string | null;
  /** This room pays its own bill instead of the group. */
  ownBill?: boolean;
  /** Food & drinks from the menu and typed-in extras for this room (on its bill, pre-ordered). */
  menuItems?: { menuItemId: string; quantity: number }[] | null;
  charges?: { type: string; item: string; qty: number; unitPrice: number }[] | null;
  /** Different dates for this room (default: the group's). */
  arrivalDate?: BusinessDate | null;
  departureDate?: BusinessDate | null;
}

/** The group's billing profile — printed on its invoices when there is no company account. */
export interface GroupProfile {
  address?: string | null;
  billingAddress?: string | null;
  taxId?: string | null;
  vrn?: string | null;
  registrationNo?: string | null;
  /** Where invoices and statements are sent. */
  billingEmail?: string | null;
  billingNotes?: string | null;
}
const cleanProfile = (p: GroupProfile | null | undefined) => {
  const t = (v: string | null | undefined) => v?.trim() || null;
  return p ? {
    address: t(p.address), billingAddress: t(p.billingAddress), taxId: t(p.taxId), vrn: t(p.vrn), registrationNo: t(p.registrationNo),
    billingEmail: t(p.billingEmail)?.toLowerCase() ?? null, billingNotes: t(p.billingNotes),
  } : {};
};

export interface CreateGroupInput {
  name: string;
  type: GroupType;
  profile?: GroupProfile | null;
  corporateCustomerId?: string | null;
  contact: GuestInput;
  sourceCode: string;
  billing: GroupBilling;
  paymentTermDays?: number | null;
  notes?: string | null;
  arrivalDate: BusinessDate;
  departureDate: BusinessDate;
  rooms: GroupRoomInput[];
  specialRequests?: string | null;
  creditOverride?: { reason: string } | null;
}

/**
 * A room guest: matched by phone/email like any guest — unless that phone
 * belongs to someone with another name (a parent's phone given for a child),
 * then a separate guest is kept so nobody is merged into someone else.
 */
async function roomGuest(tx: Tx, g: GuestInput): Promise<string> {
  if (g.id) return resolveGuest(tx, g);
  const id = await resolveGuest(tx, g);
  const found = await tx.guest.findUniqueOrThrow({ where: { id }, select: { fullName: true } });
  if (found.fullName.trim().toLowerCase() === g.fullName.trim().toLowerCase()) return id;
  const created = await tx.guest.create({
    data: {
      fullName: g.fullName.trim(), phone: null, email: null, idType: g.idType?.trim() || null, idNumber: g.idNumber?.trim() || null,
      nationality: g.nationality?.trim() || null, notes: g.phone ? `Phone given: ${g.phone}` : null,
    },
  });
  return created.id;
}

async function addOccupantsTx(tx: Tx, reservationId: string, occupants: GuestInput[]) {
  for (const o of occupants) {
    if (!o.fullName?.trim()) continue;
    const guestId = await roomGuest(tx, o);
    await tx.reservationGuest.upsert({ where: { reservationId_guestId: { reservationId, guestId } }, update: {}, create: { reservationId, guestId, isPrimary: false } });
  }
}

/** Create a group and all its rooms in one go — every room checked for availability, or nothing is booked. */
export async function createGroupBooking(input: CreateGroupInput, actor: Actor, now = new Date()) {
  if (!actor.userId) throw new AppError("Sign in required.", "UNAUTHENTICATED");
  const name = input.name.trim();
  if (name.length < 2) throw new AppError("Give the group a name (company or family).", "VALIDATION", { name: msg("Required") });
  if (!input.contact.fullName?.trim()) throw new AppError("Enter the contact person.", "VALIDATION", { "contact.fullName": msg("Required") });
  if (input.rooms.length === 0) throw new AppError("Add at least one room.");
  if (input.rooms.length > 60) throw new AppError("A group can hold at most 60 rooms.");
  await expireUnpaidHolds(now);
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      return await db.$transaction((tx) => createGroupTx(tx, { ...input, name }, actor, now), { timeout: 60_000, maxWait: 10_000 });
    } catch (e) {
      if (isUniqueViolation(e) && String((e as Error).message ?? "").includes("reference")) continue;
      if (isExclusionViolation(e)) throw new AppError("One of the rooms was just booked by someone else. Check the rooms and try again.", "UNAVAILABLE");
      throw e;
    }
  }
  throw new AppError("Could not create the group. Please try again.");
}

async function createGroupTx(tx: Tx, input: CreateGroupInput, actor: Actor, now: Date) {
  const source = await tx.bookingSource.findUnique({ where: { code: input.sourceCode } });
  if (!source || !source.isActive) throw new AppError("Choose a valid booking source.", "VALIDATION", { sourceCode: msg("Invalid") });
  if (source.code === "HOTEL_QR") throw new AppError("Hotel QR bookings are made by guests from the QR — choose how this group booked.", "VALIDATION", { sourceCode: msg("Invalid") });
  const company = input.corporateCustomerId ? await tx.corporateCustomer.findUnique({ where: { id: input.corporateCustomerId } }) : null;
  if (input.corporateCustomerId && (!company || company.status !== "ACTIVE")) throw new AppError("That company account is not active.");
  const contactGuestId = await resolveGuest(tx, input.contact);

  const group = await tx.bookingGroup.create({
    data: {
      reference: groupRef(), name: input.name, type: input.type, corporateCustomerId: company?.id ?? null, contactGuestId,
      sourceId: source.id, billing: input.billing, paymentTermDays: input.paymentTermDays ?? null, notes: input.notes?.trim() || null,
      ...cleanProfile(input.profile),
      arrivalDate: toDbDate(input.arrivalDate), departureDate: toDbDate(input.departureDate), createdById: actor.userId ?? null,
    },
  });

  const made: { reference: string; room: string; guest: string; net: number }[] = [];
  for (const [i, room] of input.rooms.entries()) {
    // Resolve the room's guest first, so a shared phone never merges two people.
    const guestId = room.guest?.fullName?.trim() ? await roomGuest(tx, room.guest) : contactGuestId;
    const guest = room.guest?.fullName?.trim() ? { ...room.guest, id: guestId } : { ...input.contact, id: contactGuestId };
    const r = await createReservationTx(tx, {
      sourceCode: source.code,
      guest,
      groupId: group.id,
      corporateCustomerId: room.ownBill ? null : company?.id ?? null,
      billing: room.ownBill ? { billTo: "GUEST" } : { billTo: "GROUP", paymentTermDays: input.paymentTermDays ?? null },
      stay: { kind: "overnight", arrivalDate: room.arrivalDate ?? input.arrivalDate, departureDate: room.departureDate ?? input.departureDate },
      rooms: [{ roomTypeId: room.roomTypeId, roomId: room.roomId ?? null, adults: room.adults, children: room.children, discountPerNight: room.discountPerNight ?? null, discountReason: room.discountReason ?? null }],
      // The group guarantees its rooms; a room paying its own bill is held like any unpaid booking.
      status: room.ownBill ? "RESERVED" : "CONFIRMED",
      menuItems: room.menuItems ?? null, charges: room.charges ?? null,
      specialRequests: input.specialRequests?.trim() || null,
      internalNotes: `Group ${group.reference} · ${input.name} (room ${i + 1} of ${input.rooms.length})`,
    }, actor, now);
    await addOccupantsTx(tx, r.id, room.occupants ?? []);
    made.push({ reference: r.reference, room: r.rooms[0]?.room.number ?? "—", guest: room.guest?.fullName?.trim() || input.contact.fullName, net: r.netAmount });
  }
  await recalculateGroup(tx, group.id);

  // One credit check for the whole group (the rooms the company pays for).
  if (company) {
    const companyPart = (await tx.reservation.aggregate({ where: { groupId: group.id, billTo: "GROUP" }, _sum: { netAmount: true } }))._sum.netAmount ?? 0;
    await assertCompanyCredit(tx, { companyId: company.id, amount: companyPart, override: input.creditOverride, reference: group.reference }, actor);
  }
  await audit(tx, actor, {
    action: "group.created", entityType: "BookingGroup", entityId: group.id,
    after: { reference: group.reference, name: group.name, type: group.type, company: company?.companyName ?? null, payer: company?.companyName ?? input.contact.fullName, billing: group.billing, rooms: made },
  });
  return group;
}

/** Add one more room to a group (same rules: availability checked, the group pays unless "own bill"). */
export async function addRoomToGroup(groupId: string, room: GroupRoomInput, actor: Actor, now = new Date()) {
  await expireUnpaidHolds(now);
  return db.$transaction(async (tx) => {
    const g = await tx.bookingGroup.findUnique({ where: { id: groupId }, include: { source: true, contactGuest: true } });
    if (!g) throw new AppError("Group not found.", "NOT_FOUND");
    if (g.status === "CANCELLED") throw new AppError("This group is cancelled.");
    const arrival = room.arrivalDate ?? fromDbDate(g.arrivalDate);
    const departure = room.departureDate ?? fromDbDate(g.departureDate);
    const guest = room.guest?.fullName?.trim() ? { ...room.guest, id: await roomGuest(tx, room.guest) } : { id: g.contactGuestId, fullName: g.contactGuest.fullName };
    const r = await createReservationTx(tx, {
      sourceCode: g.source.code, guest, groupId: g.id,
      corporateCustomerId: room.ownBill ? null : g.corporateCustomerId,
      billing: room.ownBill ? { billTo: "GUEST" } : { billTo: "GROUP", paymentTermDays: g.paymentTermDays },
      stay: { kind: "overnight", arrivalDate: arrival, departureDate: departure },
      rooms: [{ roomTypeId: room.roomTypeId, roomId: room.roomId ?? null, adults: room.adults, children: room.children, discountPerNight: room.discountPerNight ?? null, discountReason: room.discountReason ?? null }],
      status: room.ownBill ? "RESERVED" : "CONFIRMED",
      internalNotes: `Group ${g.reference} · ${g.name}`,
    }, actor, now);
    await addOccupantsTx(tx, r.id, room.occupants ?? []);
    if (g.corporateCustomerId && !room.ownBill) {
      await assertCompanyCredit(tx, { companyId: g.corporateCustomerId, amount: r.netAmount, reference: g.reference }, actor);
    }
    await recalculateGroup(tx, g.id);
    await audit(tx, actor, { action: "group.room_added", entityType: "BookingGroup", entityId: g.id, after: { reservation: r.reference, room: r.rooms[0]?.room.number, guest: room.guest?.fullName ?? g.contactGuest.fullName } });
    return r;
  }, { timeout: 30_000, maxWait: 10_000 });
}

/** Put an existing booking into a group (or take it out). */
export async function setReservationGroup(reservationId: string, groupId: string | null, actor: Actor) {
  return db.$transaction(async (tx) => {
    const r = await tx.reservation.findUnique({ where: { id: reservationId }, include: { group: true } });
    if (!r) throw new AppError("Reservation not found.", "NOT_FOUND");
    if (groupId && !(await tx.bookingGroup.findUnique({ where: { id: groupId } }))) throw new AppError("Group not found.", "NOT_FOUND");
    if (!groupId && r.billTo === "GROUP") {
      if (r.companyBilledAmount !== 0) throw new AppError("This room is already on the group's invoice — void that invoice first.");
      await tx.reservation.update({ where: { id: r.id }, data: { billTo: "GUEST", corporateCustomerId: null } });
    }
    await tx.reservation.update({ where: { id: r.id }, data: { groupId } });
    if (r.groupId) await recalculateGroup(tx, r.groupId);
    if (groupId) await recalculateGroup(tx, groupId);
    await audit(tx, actor, { action: groupId ? "group.room_linked" : "group.room_unlinked", entityType: "Reservation", entityId: r.id, before: { group: r.group?.reference ?? null }, after: { group: groupId } });
  });
}

export async function updateGroup(
  groupId: string,
  input: {
    name?: string; notes?: string | null; billing?: GroupBilling; paymentTermDays?: number | null;
    type?: GroupType; profile?: GroupProfile | null;
    /** The group leader — our contact, and the one who pays when there is no company. */
    contact?: GuestInput | null;
    /** The company that gets the invoice (null = the leader pays); undefined = unchanged. */
    corporateCustomerId?: string | null;
    creditOverride?: { reason: string } | null;
  },
  actor: Actor,
) {
  return db.$transaction(async (tx) => {
    const g = await tx.bookingGroup.findUnique({ where: { id: groupId }, include: { corporateCustomer: true, contactGuest: true } });
    if (!g) throw new AppError("Group not found.", "NOT_FOUND");
    const companyId = input.corporateCustomerId === undefined ? g.corporateCustomerId : input.corporateCustomerId || null;
    const leaderId = input.contact?.fullName?.trim() ? await resolveGuest(tx, input.contact) : g.contactGuestId;
    // Who the invoice is made out to: the company, or the group itself (the leader is only the contact person).
    if (companyId !== g.corporateCustomerId) {
      const invoiced = await tx.invoice.count({ where: { groupId: g.id, status: { notIn: ["CANCELLED", "VOID"] } } });
      const payer = g.corporateCustomer?.companyName ?? g.name;
      if (invoiced) {
        throw new AppError(invoiced === 1
          ? msgf("The group already has an invoice made out to {payer}. Void it first (with a reason) to change who pays.", { payer })
          : msgf("The group already has {n} invoices made out to {payer}. Void them first (with a reason) to change who pays.", { n: invoiced, payer }));
      }
    }
    const data: Prisma.BookingGroupUpdateInput = {};
    if (input.name !== undefined) {
      if (input.name.trim().length < 2) throw new AppError("Give the group a name.", "VALIDATION", { name: msg("Required") });
      data.name = input.name.trim();
    }
    if (input.notes !== undefined) data.notes = input.notes?.trim() || null;
    if (input.type) data.type = input.type;
    if (input.profile) Object.assign(data, cleanProfile(input.profile));
    if (input.billing) data.billing = input.billing;
    if (input.paymentTermDays !== undefined) data.paymentTermDays = input.paymentTermDays;
    if (leaderId !== g.contactGuestId) data.contactGuest = { connect: { id: leaderId } };
    if (companyId !== g.corporateCustomerId) {
      const company = companyId ? await tx.corporateCustomer.findUnique({ where: { id: companyId } }) : null;
      if (companyId && (!company || company.status !== "ACTIVE")) throw new AppError("That company account is not active.");
      data.corporateCustomer = companyId ? { connect: { id: companyId } } : { disconnect: true };
      // The group's rooms follow the new payer; rooms paying their own bill are not touched.
      await tx.reservation.updateMany({ where: { groupId: g.id, billTo: "GROUP" }, data: { corporateCustomerId: companyId } });
      if (company) {
        const owed = (await tx.reservation.aggregate({ where: { groupId: g.id, billTo: "GROUP", status: { notIn: ["CANCELLED", "NO_SHOW"] } }, _sum: { balanceAmount: true } }))._sum.balanceAmount ?? 0;
        await assertCompanyCredit(tx, { companyId: company.id, amount: owed, override: input.creditOverride, reference: g.reference }, actor);
      }
    }
    await tx.bookingGroup.update({ where: { id: g.id }, data });
    await recalculateGroup(tx, g.id);
    await audit(tx, actor, {
      action: "group.updated", entityType: "BookingGroup", entityId: g.id,
      before: { name: g.name, billing: g.billing, terms: g.paymentTermDays, notes: g.notes, company: g.corporateCustomer?.companyName ?? null, leader: g.contactGuest.fullName },
      after: { name: input.name, type: input.type, billing: input.billing, terms: input.paymentTermDays, notes: input.notes, company: companyId, leader: input.contact?.fullName ?? undefined, profile: input.profile ? cleanProfile(input.profile) : undefined },
    });
  });
}

// ───────────────────────── Occupants (people sharing a room) ─────────────────────────

export async function addOccupant(reservationId: string, guest: GuestInput, actor: Actor) {
  if (!guest.fullName?.trim()) throw new AppError("Enter the guest's name.", "VALIDATION", { fullName: msg("Required") });
  return db.$transaction(async (tx) => {
    const r = await tx.reservation.findUnique({ where: { id: reservationId } });
    if (!r) throw new AppError("Reservation not found.", "NOT_FOUND");
    await addOccupantsTx(tx, reservationId, [guest]);
    await audit(tx, actor, { action: "reservation.occupant_added", entityType: "Reservation", entityId: reservationId, after: { reference: r.reference, guest: guest.fullName.trim() } });
  });
}

export async function removeOccupant(reservationId: string, guestId: string, actor: Actor) {
  return db.$transaction(async (tx) => {
    const link = await tx.reservationGuest.findUnique({ where: { reservationId_guestId: { reservationId, guestId } }, include: { guest: true } });
    if (!link) throw new AppError("Guest not found on this booking.", "NOT_FOUND");
    if (link.isPrimary) throw new AppError("The main guest cannot be removed — change the booking's guest instead.");
    await tx.reservationGuest.delete({ where: { reservationId_guestId: { reservationId, guestId } } });
    await audit(tx, actor, { action: "reservation.occupant_removed", entityType: "Reservation", entityId: reservationId, after: { guest: link.guest.fullName } });
  });
}

// ───────────────────────── Group check-in / check-out ─────────────────────────

export interface RoomResult { reservationId: string; reference: string; room: string; guest: string; ok: boolean; message: string }

/** A room's outcome while it is worked out: `message` is the English (kept in the audit); `said` keeps its values to show it in the reader's words. */
type Said = RoomResult & { said?: { key: string; vars: MsgVars } };
const words = (m: Localized) => ({ message: m.text, said: { key: m.key, vars: m.vars } });
/** Why a room was not done, from the error (with its values when it has them). */
const fromError = (e: unknown, fallback: string) => (e instanceof AppError ? { message: e.message, said: e.i18n } : { message: fallback });
/** The rooms' outcomes in the language of the person who acted (English for jobs and tests). */
async function inReaderWords(out: Said[]): Promise<RoomResult[]> {
  const t = await getT().catch(() => englishT);
  return out.map(({ said, ...x }) => ({ ...x, message: said ? t(said.key, said.vars) : t(x.message) }));
}

async function members(groupId: string, reservationIds?: string[] | null) {
  const g = await db.bookingGroup.findUnique({ where: { id: groupId } });
  if (!g) throw new AppError("Group not found.", "NOT_FOUND");
  const rs = await db.reservation.findMany({
    where: { groupId, ...(reservationIds?.length ? { id: { in: reservationIds } } : {}) },
    include: { guest: { select: { fullName: true } }, rooms: { include: { room: true } } },
    orderBy: { createdAt: "asc" },
  });
  return { g, rs };
}

/**
 * Check in every chosen room that is due and ready. A room that is not ready
 * (still being cleaned, under maintenance) is skipped and reported — it never
 * blocks the others.
 */
export async function checkInGroup(groupId: string, actor: Actor, reservationIds?: string[] | null, now = new Date()): Promise<RoomResult[]> {
  const { rs } = await members(groupId, reservationIds);
  const settings = await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } });
  const today = businessDateOf(now, stayConfig(settings));
  const out: Said[] = [];
  for (const r of rs) {
    const rr = r.rooms.find((x) => x.status === "RESERVED" || x.status === "CONFIRMED");
    const base = { reservationId: r.id, reference: r.reference, room: r.rooms[0]?.room.number ?? "—", guest: r.guest.fullName };
    if (!rr) { if (reservationIds?.length) out.push({ ...base, ok: false, message: r.status === "CHECKED_IN" ? msg("Already in") : msg("Nothing to check in") }); continue; }
    if (fromDbDate(rr.arrivalDate) > today) { out.push({ ...base, ok: false, ...words(msgf("Arrives {date}", { date: fromDbDate(rr.arrivalDate) })) }); continue; }
    if (!CHECK_IN_READY.includes(rr.room.status)) {
      const why = rr.room.status === "MAINTENANCE" || rr.room.status === "OUT_OF_SERVICE" ? msg("Room under maintenance — change the room")
        : rr.room.status === "OCCUPIED" ? msg("The previous guest has not checked out yet") : msg("Room not ready — still being cleaned");
      out.push({ ...base, ok: false, message: why });
      continue;
    }
    try {
      await checkIn(r.id, actor, null, now);
      out.push({ ...base, ok: true, message: msg("Checked in") });
    } catch (e) {
      const why = fromError(e, msg("Could not check in"));
      // Early check-in clashes with the room's previous booking (it ends at its checkout time).
      out.push({ ...base, ok: false, ...(/just booked by someone else/.test(why.message) ? { message: msg("Another guest's booking holds this room until their checkout — check in later, or change the room") } : why) });
    }
  }
  await db.$transaction((tx) => recalculateGroup(tx, groupId));
  await audit(db, actor, { action: "group.checked_in", entityType: "BookingGroup", entityId: groupId, after: { done: out.filter((x) => x.ok).map((x) => x.room), skipped: out.filter((x) => !x.ok).map((x) => `${x.room}: ${x.message}`) } });
  return inReaderWords(out);
}

/**
 * Check out the chosen rooms. Rooms the group pays for move their bill to the
 * group's invoice. A room that pays its own bill and still owes is NOT checked
 * out — unless a manager accepts it, with a reason (recorded).
 */
export async function checkOutGroup(
  groupId: string, actor: Actor, reservationIds: string[],
  opts: { allowBalance?: boolean; overrideReason?: string | null; earlyReason?: string | null } = {}, now = new Date(),
): Promise<RoomResult[]> {
  if (!reservationIds.length) throw new AppError("Choose the rooms to check out.");
  const { rs } = await members(groupId, reservationIds);
  const out: Said[] = [];
  for (const r of rs) {
    const base = { reservationId: r.id, reference: r.reference, room: r.rooms[0]?.room.number ?? "—", guest: r.guest.fullName };
    if (!r.rooms.some((x) => x.status === "CHECKED_IN")) { out.push({ ...base, ok: false, message: msg("Not in the hotel") }); continue; }
    try {
      await checkOut(r.id, actor, { allowBalance: !!opts.allowBalance, overrideReason: opts.overrideReason ?? null, earlyReason: opts.earlyReason ?? null }, now);
      out.push({ ...base, ok: true, message: r.billTo === "GROUP" ? msg("Checked out — bill on the group invoice") : msg("Checked out") });
    } catch (e) {
      out.push({ ...base, ok: false, ...fromError(e, msg("Could not check out")) });
    }
  }
  await db.$transaction((tx) => recalculateGroup(tx, groupId));
  await audit(db, actor, {
    action: "group.checked_out", entityType: "BookingGroup", entityId: groupId,
    after: { done: out.filter((x) => x.ok).map((x) => x.room), notDone: out.filter((x) => !x.ok).map((x) => `${x.room}: ${x.message}`), ...(opts.allowBalance && { overrideReason: opts.overrideReason, by: actor.label }) },
  });
  return inReaderWords(out);
}

export async function cancelGroup(groupId: string, actor: Actor, reason: string) {
  if (!reason.trim()) throw new AppError("A cancellation reason is required.", "VALIDATION", { reason: msg("Required") });
  const { rs } = await members(groupId);
  const out: Said[] = [];
  for (const r of rs.filter((x) => ["INQUIRY", "RESERVED", "CONFIRMED"].includes(x.status))) {
    const base = { reservationId: r.id, reference: r.reference, room: r.rooms[0]?.room.number ?? "—", guest: r.guest.fullName };
    try { await cancelReservation(r.id, actor, reason); out.push({ ...base, ok: true, message: msg("Cancelled") }); }
    catch (e) { out.push({ ...base, ok: false, ...fromError(e, msg("Could not cancel")) }); }
  }
  await db.$transaction((tx) => recalculateGroup(tx, groupId));
  await audit(db, actor, { action: "group.cancelled", entityType: "BookingGroup", entityId: groupId, after: { reason, rooms: out.map((x) => `${x.room}: ${x.message}`) } });
  return inReaderWords(out);
}

// ───────────────────────── Group invoices & payments ─────────────────────────

/**
 * Invoice chosen rooms now:
 *  - COMBINED: one invoice for all the chosen rooms (each line keeps its room & guest);
 *  - SEPARATE: one invoice per room.
 * Rooms the group pays for are billed to the group's payer; a room paying its own
 * bill gets its own guest invoice. Nothing already invoiced is billed again.
 */
export async function invoiceGroupRooms(groupId: string, reservationIds: string[], mode: "COMBINED" | "SEPARATE", actor: Actor) {
  if (!actor.userId) throw new AppError("Sign in required.", "UNAUTHENTICATED");
  if (!reservationIds.length) throw new AppError("Tick the rooms to put on the invoice.");
  const { g, rs } = await members(groupId, reservationIds);
  const groupRooms = rs.filter((r) => r.billTo === "GROUP" && !["CANCELLED", "INQUIRY"].includes(r.status));
  const ownRooms = rs.filter((r) => r.billTo !== "GROUP" && !["CANCELLED", "INQUIRY", "NO_SHOW"].includes(r.status));
  const made: { id: string; number: string; amount: number }[] = [];

  if (groupRooms.length) {
    await db.$transaction(async (tx) => {
      for (const r of groupRooms) await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${r.id} FOR UPDATE`;
      const settings = await getSettingsTx(tx);
      const today = businessDateOf(new Date(), stayConfig(settings));
      if (mode === "COMBINED") {
        const inv = await tx.invoice.create({
          data: {
            number: await nextInvoiceNumber(tx, today), groupId: g.id, corporateCustomerId: g.corporateCustomerId, guestId: g.corporateCustomerId ? null : g.contactGuestId,
            createdById: actor.userId!, status: "DRAFT", paymentTermDays: g.paymentTermDays, notes: `${g.name} — group ${g.reference}`,
          },
        });
        for (const r of groupRooms) await billCompanyTx(tx, r.id, actor, { invoiceId: inv.id, includeInHouse: true });
        const lines = await tx.invoiceItem.count({ where: { invoiceId: inv.id } });
        if (lines === 0) throw new AppError("Everything on these rooms is already invoiced.");
        await syncInvoice(tx, inv.id);
        made.push({ id: inv.id, number: inv.number, amount: (await tx.invoice.findUniqueOrThrow({ where: { id: inv.id } })).netAmount });
      } else {
        for (const r of groupRooms) {
          const res = await billCompanyTx(tx, r.id, actor, { mode: "ISSUE", includeInHouse: true });
          if (res) made.push({ id: res.id, number: res.number, amount: res.amount });
        }
      }
    }, { timeout: 30_000, maxWait: 10_000 });
    // A combined invoice made here is issued straight away (the group's running draft stays open for later checkouts).
    for (const m of made) {
      const inv = await db.invoice.findUniqueOrThrow({ where: { id: m.id } });
      if (inv.status === "DRAFT") await issueInvoice(inv.id, actor);
    }
  }
  for (const r of ownRooms) {
    const inv = await createInvoiceForReservation(r.id, actor);
    made.push({ id: inv.id, number: inv.number, amount: inv.netAmount });
  }
  if (!made.length) throw new AppError("There is nothing new to invoice on these rooms.");
  await audit(db, actor, { action: "group.invoiced", entityType: "BookingGroup", entityId: groupId, after: { mode, rooms: rs.map((r) => r.rooms[0]?.room.number), invoices: made.map((m) => m.number) } });
  return made;
}

/**
 * The payer pays the group (all or part): spread over the group's issued
 * invoices, oldest first — or only the ones chosen. One payment, recorded once.
 */
export async function recordGroupPayment(
  groupId: string,
  input: { amount: number; accountId?: string | null; methodId?: string | null; reference?: string | null; invoiceIds?: string[] | null },
  actor: Actor,
) {
  if (!actor.userId) throw new AppError("Sign in required.", "UNAUTHENTICATED");
  if (!Number.isInteger(input.amount) || input.amount <= 0) throw new AppError("Enter the amount received.", "VALIDATION", { amount: msg("Invalid") });
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "booking_groups" WHERE "id" = ${groupId} FOR UPDATE`;
    const g = await tx.bookingGroup.findUnique({ where: { id: groupId } });
    if (!g) throw new AppError("Group not found.", "NOT_FOUND");
    const { account, method } = await resolveAccountTx(tx, input);
    const open = await tx.invoice.findMany({
      where: { groupId, status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] }, balanceAmount: { gt: 0 }, ...(input.invoiceIds?.length ? { id: { in: input.invoiceIds } } : {}) },
      orderBy: [{ dueDate: "asc" }, { issueDate: "asc" }, { number: "asc" }],
    });
    const owed = open.reduce((s, i) => s + i.balanceAmount, 0);
    if (owed === 0) {
      const draft = await tx.invoice.count({ where: { groupId, status: "DRAFT" } });
      throw new AppError(draft ? msg("The group's invoice is still open (a draft). Issue it first, then record the payment.") : msg("This group has no unpaid invoices."));
    }
    if (input.amount > owed) throw new AppError(msgf("That is more than the group owes on its invoices (TZS {amount}).", { amount: owed.toLocaleString("en-TZ") }), "VALIDATION", { amount: msg("Too much") });
    const settings = await getSettingsTx(tx);
    const now = new Date();
    const businessDate = toDbDate(businessDateOf(now, stayConfig(settings)));
    let left = input.amount;
    const applied: { invoice: string; amount: number }[] = [];
    for (const inv of open) {
      if (left === 0) break;
      const part = Math.min(left, inv.balanceAmount);
      await tx.payment.create({
        data: {
          amount: part, methodId: method.id, accountId: account.id, reference: input.reference?.trim() || null, receivedAt: now, businessDate,
          invoiceId: inv.id, corporateCustomerId: inv.corporateCustomerId, recordedById: actor.userId!, notes: `Group ${g.reference}`,
        },
      });
      await syncInvoice(tx, inv.id);
      applied.push({ invoice: inv.number, amount: part });
      left -= part;
    }
    await audit(tx, actor, { action: "payment.group", entityType: "BookingGroup", entityId: groupId, after: { amount: input.amount, account: account.name, method: method.code, reference: input.reference ?? null, applied } });
    return { applied };
  });
}

// ───────────────────────── Final group bill ─────────────────────────

const LEFT_OR_OFF = ["CHECKED_OUT", "CANCELLED", "NO_SHOW", "INQUIRY"];

/**
 * Finalize the group's bill once every room the group pays for has left: any
 * charge not yet on the group's bill is added, and the running bill (draft)
 * becomes the final group invoice — issued with its due date. Never earlier:
 * while rooms are still staying, staff print a statement instead.
 */
export async function finalizeGroup(groupId: string, actor: Actor, now = new Date()) {
  if (!actor.userId) throw new AppError("Sign in required.", "UNAUTHENTICATED");
  const res = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT "id" FROM "booking_groups" WHERE "id" = ${groupId} FOR UPDATE`;
    const g = await tx.bookingGroup.findUnique({ where: { id: groupId }, include: { reservations: { select: { id: true, status: true, billTo: true, rooms: { select: { room: { select: { number: true } } } } } } } });
    if (!g) throw new AppError("Group not found.", "NOT_FOUND");
    if (g.finalizedAt) throw new AppError("This group's bill is already final. Late charges can still be invoiced from the rooms list.");
    const groupRooms = g.reservations.filter((r) => r.billTo === "GROUP" && !["CANCELLED", "NO_SHOW", "INQUIRY"].includes(r.status));
    const staying = g.reservations.filter((r) => r.billTo === "GROUP" && !LEFT_OR_OFF.includes(r.status));
    if (staying.length) {
      const rooms = staying.map((r) => r.rooms[0]?.room.number ?? "?").join(", ");
      throw new AppError(staying.length === 1
        ? msgf("Room {rooms} has not checked out yet. Finalize when everyone has left — print a statement for the charges so far.", { rooms })
        : msgf("Rooms {rooms} have not checked out yet. Finalize when everyone has left — print a statement for the charges so far.", { rooms }));
    }
    // The running bill is rebuilt from every room's folio as it is now: a corrected or voided charge
    // appears once, at its latest value — never twice, never as the old line plus a correction.
    const running = g.billing === "COMBINED" ? await tx.invoice.findMany({ where: { groupId, status: "DRAFT" }, orderBy: { createdAt: "asc" } }) : [];
    if (running.length) {
      await tx.invoiceItem.deleteMany({ where: { invoiceId: { in: running.map((d) => d.id) } } });
      if (running.length > 1) await tx.payment.updateMany({ where: { invoiceId: { in: running.slice(1).map((d) => d.id) } }, data: { invoiceId: running[0].id } });
      for (const r of groupRooms) await recalculateReservation(tx, r.id);
    }
    // Everything the group pays for, not yet on an issued invoice, onto the group's bill.
    for (const r of groupRooms) {
      await tx.$queryRaw`SELECT "id" FROM "reservations" WHERE "id" = ${r.id} FOR UPDATE`;
      await billCompanyTx(tx, r.id, actor, { mode: g.billing === "COMBINED" ? "OPEN" : "ISSUE", includeInHouse: true, now });
    }
    // The running bill becomes the final group invoice.
    let finalInvoice: { id: string; number: string; amount: number } | null = null;
    for (const d of await tx.invoice.findMany({ where: { groupId, status: "DRAFT" }, orderBy: { createdAt: "asc" } })) {
      await syncInvoice(tx, d.id);
      const fresh = await tx.invoice.findUniqueOrThrow({ where: { id: d.id } });
      if (fresh.netAmount === 0) {
        await tx.payment.updateMany({ where: { invoiceId: d.id, reservationId: { not: null } }, data: { invoiceId: null } });
        await tx.invoice.update({ where: { id: d.id }, data: { status: "CANCELLED", cancelledAt: now, cancelReason: "Nothing to bill when the group was finalized" } });
        continue;
      }
      await issueInvoiceTx(tx, d.id, actor);
      finalInvoice ??= { id: d.id, number: d.number, amount: fresh.netAmount };
    }
    await tx.bookingGroup.update({ where: { id: groupId }, data: { finalizedAt: now, finalizedById: actor.userId, finalInvoiceId: finalInvoice?.id ?? null } });
    await recalculateGroup(tx, groupId);
    const live = await tx.invoice.findMany({ where: { groupId, status: { notIn: ["CANCELLED", "VOID", "DRAFT"] } }, select: { number: true, netAmount: true } });
    // Who checked out the last guest, and when — kept with the final invoice.
    const last = await tx.reservationRoom.findFirst({
      where: { reservation: { groupId, billTo: "GROUP" }, checkedOutAt: { not: null } }, orderBy: { checkedOutAt: "desc" },
      select: { checkedOutAt: true, room: { select: { number: true } }, checkedOutBy: { select: { fullName: true } }, reservation: { select: { guest: { select: { fullName: true } } } } },
    });
    await audit(tx, actor, {
      action: "group.finalized", entityType: "BookingGroup", entityId: groupId,
      after: {
        reference: g.reference, finalInvoice: finalInvoice?.number ?? null, amount: finalInvoice?.amount ?? 0, invoices: live.map((i) => `${i.number}: ${i.netAmount}`), rooms: groupRooms.length,
        lastCheckout: last ? `Room ${last.room.number} · ${last.reservation.guest.fullName} · by ${last.checkedOutBy?.fullName ?? "—"} · ${last.checkedOutAt!.toISOString()}` : null,
      },
    });
    return { finalInvoice, invoices: live.length };
  }, { timeout: 60_000, maxWait: 10_000 });
  return res;
}

// ───────────────────────── Views ─────────────────────────

/** Everything the group page shows: header, rooms with guests & money, the group folio and invoices. */
export async function getGroup(groupId: string) {
  const g = await db.bookingGroup.findUnique({
    where: { id: groupId },
    include: {
      corporateCustomer: true, contactGuest: true, source: true, createdBy: { select: { fullName: true } }, finalizedBy: { select: { fullName: true } },
      reservations: {
        orderBy: { createdAt: "asc" },
        include: {
          guest: { select: { id: true, fullName: true, phone: true } },
          guests: { include: { guest: { select: { id: true, fullName: true, phone: true, idNumber: true, nationality: true } } } },
          rooms: { include: { room: true, roomType: true } },
          charges: { where: { isVoided: false }, select: { kind: true, amount: true, description: true, category: true, businessDate: true } },
          invoiceItems: { where: { invoice: { status: { notIn: ["CANCELLED", "VOID"] } } }, select: { netAmount: true, invoice: { select: { id: true, number: true, status: true } } } },
          invoices: { where: { status: { notIn: ["CANCELLED", "VOID"] } }, select: { id: true, number: true, status: true } },
          payments: { where: { status: "POSTED" }, select: { amount: true, kind: true } },
        },
      },
      invoices: { orderBy: { createdAt: "asc" }, include: { payments: { where: { status: "POSTED" }, select: { amount: true, kind: true } } } },
    },
  });
  if (!g) return null;
  const sum = <T,>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0);
  const rooms = g.reservations.map((r) => {
    const rr = r.rooms[0];
    const kinds = (k: string) => sum(r.charges.filter((c) => c.kind === k), (c) => c.amount);
    const invoices = [...new Map([...r.invoiceItems.map((i) => i.invoice), ...r.invoices].map((i) => [i.id, i])).values()];
    return {
      id: r.id, reference: r.reference, status: r.status, billTo: r.billTo,
      room: rr ? { number: rr.room.number, type: rr.roomType.name, status: rr.room.status, roomId: rr.roomId, floor: rr.room.floor } : null,
      arrival: fromDbDate(r.arrivalDate), departure: fromDbDate(r.departureDate), nights: rr?.nights ?? 0,
      startAt: rr?.startAt ?? null, endAt: rr?.endAt ?? null, checkedInAt: rr?.checkedInAt ?? null, checkedOutAt: rr?.checkedOutAt ?? null,
      guest: r.guest,
      occupants: r.guests.filter((x) => !x.isPrimary).map((x) => x.guest),
      adults: r.adults, children: r.children,
      rate: rr?.ratePerNight ?? 0, discount: rr?.discountPerNight ?? 0,
      roomCharge: r.grossAmount - r.discountAmount, extras: r.chargesAmount, roomGross: r.grossAmount, discountAmount: r.discountAmount,
      byKind: { restaurant: kinds("RESTAURANT"), bar: kinds("BAR"), roomService: kinds("ROOM_SERVICE"), transport: kinds("TRANSPORT"), other: kinds("OTHER") },
      total: r.netAmount, paid: r.paidAmount, billed: r.companyBilledAmount, balance: r.balanceAmount,
      invoices,
    };
  });
  const live = rooms.filter((r) => r.status !== "CANCELLED" && r.status !== "NO_SHOW");
  const invoices = g.invoices.map((i) => ({
    id: i.id, number: i.number, status: i.status, net: i.netAmount, paid: i.paidAmount, balance: i.balanceAmount,
    dueDate: i.dueDate ? fromDbDate(i.dueDate) : null, verifyToken: i.verifyToken,
  }));
  const liveInvoices = invoices.filter((i) => i.status !== "CANCELLED" && i.status !== "VOID");
  const groupRooms = rooms.filter((r) => r.billTo === "GROUP");
  const groupLive = groupRooms.filter((r) => !["CANCELLED", "NO_SHOW", "INQUIRY"].includes(r.status));
  const stayState: "UPCOMING" | "IN_HOUSE" | "COMPLETED" | "CANCELLED" = live.length === 0 ? "CANCELLED"
    : live.some((r) => r.status === "CHECKED_IN") ? "IN_HOUSE" : live.every((r) => r.status === "CHECKED_OUT") ? "COMPLETED"
      : live.some((r) => r.status === "CHECKED_OUT") ? "IN_HOUSE" : "UPCOMING";
  const ownRooms = rooms.filter((r) => r.billTo !== "GROUP");
  const totals = {
    rooms: live.length, guests: sum(live, (r) => r.adults + r.children),
    checkedIn: live.filter((r) => r.status === "CHECKED_IN").length, checkedOut: live.filter((r) => r.status === "CHECKED_OUT").length,
    roomCharges: sum(rooms, (r) => r.roomCharge),
    restaurant: sum(rooms, (r) => r.byKind.restaurant), bar: sum(rooms, (r) => r.byKind.bar), roomService: sum(rooms, (r) => r.byKind.roomService),
    transport: sum(rooms, (r) => r.byKind.transport), other: sum(rooms, (r) => r.byKind.other),
    total: sum(rooms, (r) => r.total),
    /** Before discounts (rooms + extras), and the discounts given. */
    gross: sum(rooms, (r) => r.roomGross + r.extras),
    discount: sum(rooms, (r) => r.discountAmount),
    paid: sum(rooms, (r) => r.paid) + sum(liveInvoices, (i) => i.paid),
    /** Group-paid rooms: still on the rooms (billed to the group at checkout or when invoiced). */
    toInvoice: sum(groupRooms, (r) => Math.max(0, r.balance)),
    /** On group invoices, not paid yet. */
    invoicedUnpaid: sum(liveInvoices, (i) => Math.max(0, i.balance)),
    /** Rooms paying their own bill: what their guests still owe. */
    ownRoomsOwe: sum(ownRooms, (r) => Math.max(0, r.balance)),
  };
  const outstanding = totals.toInvoice + totals.invoicedUnpaid + totals.ownRoomsOwe;
  const finalInv = invoices.find((i) => i.id === g.finalInvoiceId) ?? null;
  const partlyOut = groupLive.some((r) => r.status === "CHECKED_OUT") && groupLive.some((r) => r.status !== "CHECKED_OUT");
  const readyToFinalize = !g.finalizedAt && groupLive.length > 0 && groupLive.every((r) => r.status === "CHECKED_OUT");
  /** Where the group is, for reception and finance: stay first, then the final bill and its payment. */
  const billingStatus: GroupBillingStatus = stayState === "CANCELLED" ? "CANCELLED"
    : g.finalizedAt
      ? (outstanding <= 0 ? "CLOSED" : finalInv?.status === "OVERDUE" ? "OUTSTANDING" : (finalInv?.paid ?? 0) > 0 || totals.paid > 0 ? "PARTIALLY_PAID" : "FINAL_INVOICE_GENERATED")
      : readyToFinalize ? "READY_FOR_FINAL_INVOICE"
        : stayState === "COMPLETED" ? (outstanding <= 0 ? "CLOSED" : "OUTSTANDING")
          : partlyOut ? "PARTIALLY_CHECKED_OUT" : stayState === "UPCOMING" ? "UPCOMING" : "ACTIVE";
  // Every payment for the group: on its invoices, and deposits paid on its rooms (each listed once).
  const payments = await db.payment.findMany({
    where: { OR: [{ invoiceId: { in: g.invoices.map((i) => i.id) } }, { reservationId: { in: g.reservations.map((r) => r.id) } }] },
    include: {
      account: { select: { name: true } }, method: { select: { name: true } }, recordedBy: { select: { fullName: true } },
      invoice: { select: { id: true, number: true } }, reservation: { select: { reference: true, rooms: { select: { room: { select: { number: true } } }, take: 1 } } },
    },
    orderBy: { receivedAt: "desc" },
  });
  return {
    id: g.id, reference: g.reference, name: g.name, type: g.type, status: g.status, billing: g.billing, notes: g.notes, paymentTermDays: g.paymentTermDays,
    billingStatus,
    payments: payments.map((p) => ({
      id: p.id, at: p.receivedAt, amount: p.amount, refund: p.kind === "REFUND", reversed: p.status !== "POSTED", reference: p.reference,
      account: p.account?.name ?? p.method.name, by: p.recordedBy.fullName, invoice: p.invoice, room: p.reservation?.rooms[0]?.room.number ?? null,
      deposit: !!p.reservationId,
    })),
    /** After the final invoice: what the rooms' bills changed since (to put on an adjustment invoice). */
    changedSinceFinal: g.finalizedAt ? sum(groupRooms.filter((r) => r.status !== "CANCELLED"), (r) => r.balance) : 0,
    company: g.corporateCustomer ? { id: g.corporateCustomer.id, name: g.corporateCustomer.companyName, terms: g.corporateCustomer.paymentTermDays } : null,
    contact: { id: g.contactGuest.id, fullName: g.contactGuest.fullName, phone: g.contactGuest.phone, email: g.contactGuest.email },
    payer: g.corporateCustomer?.companyName ?? g.name,
    profile: {
      address: g.address, billingAddress: g.billingAddress, taxId: g.taxId, vrn: g.vrn, registrationNo: g.registrationNo,
      billingEmail: g.billingEmail, billingNotes: g.billingNotes,
    },
    companyProfile: g.corporateCustomer ? {
      address: g.corporateCustomer.address, billingAddress: g.corporateCustomer.billingAddress, taxId: g.corporateCustomer.taxId, vrn: g.corporateCustomer.vrn,
      registrationNo: g.corporateCustomer.registrationNo, email: g.corporateCustomer.email, phone: g.corporateCustomer.phone, contactPerson: g.corporateCustomer.contactPerson,
    } : null,
    /** Stay: coming, in the hotel, or completed (every room left). */
    stay: stayState,
    finalizedAt: g.finalizedAt, finalizedBy: g.finalizedBy?.fullName ?? null, finalInvoiceId: g.finalInvoiceId,
    /** Everyone the group pays for has left and the bill is not final yet. */
    readyToFinalize,
    source: g.source.name, createdBy: g.createdBy?.fullName ?? null, createdAt: g.createdAt,
    arrival: fromDbDate(g.arrivalDate), departure: fromDbDate(g.departureDate),
    rooms, invoices, totals: { ...totals, outstanding, staying: live.filter((r) => ["RESERVED", "CONFIRMED", "CHECKED_IN"].includes(r.status)).length },
  };
}
export type GroupView = NonNullable<Awaited<ReturnType<typeof getGroup>>>;
export type GroupBillingStatus = "UPCOMING" | "ACTIVE" | "PARTIALLY_CHECKED_OUT" | "READY_FOR_FINAL_INVOICE" | "FINAL_INVOICE_GENERATED" | "PARTIALLY_PAID" | "OUTSTANDING" | "CLOSED" | "CANCELLED";

/** Groups for the list page and the front desk: search, and "arriving today" / "in house" / "coming". */
export async function listGroups(opts: { q?: string | null; view?: "today" | "inhouse" | "upcoming" | "all"; today: BusinessDate; take?: number }) {
  const d = toDbDate(opts.today);
  const q = opts.q?.trim();
  const where: Prisma.BookingGroupWhereInput = q ? {
    OR: [
      { reference: { contains: q, mode: "insensitive" } }, { name: { contains: q, mode: "insensitive" } },
      { contactGuest: { fullName: { contains: q, mode: "insensitive" } } }, { contactGuest: { phone: { contains: q.replace(/\D/g, "").slice(-9) || q } } },
      { corporateCustomer: { companyName: { contains: q, mode: "insensitive" } } },
      { reservations: { some: { OR: [{ reference: { contains: q, mode: "insensitive" } }, { guest: { fullName: { contains: q, mode: "insensitive" } } }, { guests: { some: { guest: { fullName: { contains: q, mode: "insensitive" } } } } }, { rooms: { some: { room: { number: q } } } }] } } },
      { invoices: { some: { number: { contains: q, mode: "insensitive" } } } },
    ],
  } : opts.view === "today" ? { status: "ACTIVE", reservations: { some: { arrivalDate: d, status: { in: [...OPEN_ROOM, "CHECKED_OUT"] } } } }
    : opts.view === "inhouse" ? { reservations: { some: { status: "CHECKED_IN" } } }
      : opts.view === "upcoming" ? { status: "ACTIVE", arrivalDate: { gt: d } }
        : {};
  const rows = await db.bookingGroup.findMany({
    where, take: opts.take ?? 100,
    orderBy: opts.view === "all" || q ? { createdAt: "desc" } : { arrivalDate: "asc" },
    include: {
      corporateCustomer: { select: { companyName: true } }, contactGuest: { select: { fullName: true, phone: true } },
      reservations: { select: { status: true, adults: true, children: true, netAmount: true, balanceAmount: true, billTo: true, arrivalDate: true } },
      invoices: { where: { status: { notIn: ["CANCELLED", "VOID"] } }, select: { balanceAmount: true, status: true } },
    },
  });
  return rows.map((g) => {
    const live = g.reservations.filter((r) => r.status !== "CANCELLED" && r.status !== "NO_SHOW");
    return {
      id: g.id, reference: g.reference, name: g.name, type: g.type, status: g.status, billing: g.billing, finalized: !!g.finalizedAt,
      payer: g.corporateCustomer?.companyName ?? g.name, contact: g.contactGuest.fullName, phone: g.contactGuest.phone,
      arrival: fromDbDate(g.arrivalDate), departure: fromDbDate(g.departureDate),
      rooms: live.length, guests: live.reduce((s, r) => s + r.adults + r.children, 0),
      arrivingToday: live.filter((r) => r.arrivalDate.getTime() === d.getTime()).length,
      checkedIn: live.filter((r) => r.status === "CHECKED_IN").length,
      checkedOut: live.filter((r) => r.status === "CHECKED_OUT").length,
      pending: live.filter((r) => r.status === "RESERVED" || r.status === "CONFIRMED" || r.status === "INQUIRY").length,
      total: g.reservations.reduce((s, r) => s + r.netAmount, 0),
      outstanding: g.reservations.reduce((s, r) => s + Math.max(0, r.balanceAmount), 0) + g.invoices.reduce((s, i) => s + Math.max(0, i.balanceAmount), 0),
    };
  });
}
export type GroupRow = Awaited<ReturnType<typeof listGroups>>[number];
