"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { authorize, requestMeta, type CurrentUser } from "@/server/auth";
import { AppError, runAction } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { db } from "@/server/db";
import {
  addOccupant, addRoomToGroup, cancelGroup, checkInGroup, checkOutGroup, createGroupBooking, finalizeGroup, invoiceGroupRooms, recordGroupPayment,
  removeOccupant, updateGroup,
} from "@/server/services/groups";
import type { Actor } from "@/server/services/reservations";
import { msg } from "@/i18n/msg";

async function actor(user: CurrentUser): Promise<Actor> {
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, ipAddress, permissions: user.permissions };
}
function refresh(groupId?: string) {
  revalidatePath("/staff", "layout");
  if (groupId) revalidatePath(`/staff/groups/${groupId}`);
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg("Choose a date."));
const person = z.object({
  id: z.string().optional().nullable(),
  fullName: z.string().trim().max(120),
  phone: z.string().trim().max(30).optional(),
  email: z.union([z.literal(""), z.string().trim().email(msg("Enter a valid email."))]).optional(),
  idType: z.string().trim().max(40).optional(),
  idNumber: z.string().trim().max(60).optional(),
  nationality: z.string().trim().max(60).optional(),
});
const room = z.object({
  roomTypeId: z.string().min(1, msg("Choose a room type.")),
  roomId: z.string().optional().nullable(),
  guest: person.nullable().optional(),
  occupants: z.array(person).max(10).default([]),
  adults: z.coerce.number().int().min(1).max(10),
  children: z.coerce.number().int().min(0).max(10),
  discountPerNight: z.coerce.number().int().min(0).optional().nullable(),
  discountReason: z.string().trim().max(200).optional().nullable(),
  ownBill: z.boolean().optional(),
  menuItems: z.array(z.object({ menuItemId: z.string().min(1), quantity: z.number().int().min(1).max(99) })).max(60).optional().nullable(),
  charges: z.array(z.object({ type: z.string().max(30), item: z.string().trim().min(1, msg("Name each extra.")).max(120), qty: z.number().int().min(1).max(99), unitPrice: z.number().int().min(1, msg("Give each extra a price.")) })).max(40).optional().nullable(),
  /** This room's own dates (default: the group's). */
  arrivalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
  departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().nullable(),
});
const clean = <T extends { email?: string | undefined }>(p: T) => ({ ...p, email: p.email || null });
const GROUP_TYPE = z.enum(["COMPANY", "FAMILY", "ORGANIZATION", "GOVERNMENT", "EVENT", "OTHER"]);
const Profile = z.object({
  address: z.string().trim().max(300).optional(),
  billingAddress: z.string().trim().max(300).optional(),
  taxId: z.string().trim().max(40).optional(),
  vrn: z.string().trim().max(40).optional(),
  registrationNo: z.string().trim().max(60).optional(),
  billingEmail: z.union([z.literal(""), z.string().trim().email(msg("Enter a valid invoice email."))]).optional(),
  billingNotes: z.string().trim().max(500).optional(),
});

const CreateSchema = z.object({
  name: z.string().trim().min(2, msg("Give the group a name.")).max(120),
  type: GROUP_TYPE,
  profile: Profile.optional(),
  corporateCustomerId: z.string().optional().nullable(),
  contact: person.extend({ fullName: z.string().trim().min(2, msg("Enter the contact person.")).max(120) }),
  sourceCode: z.string().min(1, msg("Choose how they booked.")),
  billing: z.enum(["COMBINED", "SEPARATE"]),
  paymentTermDays: z.coerce.number().int().min(0).max(180).nullable().optional(),
  notes: z.string().trim().max(1000).optional(),
  arrivalDate: date,
  departureDate: date,
  rooms: z.array(room).min(1, msg("Add at least one room.")).max(60),
  specialRequests: z.string().trim().max(1000).optional(),
  creditOverride: z.object({ reason: z.string().trim().min(3, msg("Say why the company may go over its limit.")).max(300) }).nullable().optional(),
});

export async function createGroupAction(input: z.input<typeof CreateSchema>) {
  return runAction(async () => {
    const user = await authorize("reservations.create");
    const d = parseInput(CreateSchema, input);
    const g = await createGroupBooking({
      ...d, contact: clean(d.contact),
      rooms: d.rooms.map((r) => ({ ...r, guest: r.guest?.fullName ? clean(r.guest) : null, occupants: r.occupants.filter((o) => o.fullName).map(clean) })),
    }, await actor(user));
    refresh(g.id);
    return { id: g.id, reference: g.reference };
  }, msg("Group booked."));
}

export async function addGroupRoomAction(input: { groupId: string } & z.input<typeof room>) {
  return runAction(async () => {
    const user = await authorize("reservations.create");
    const r = parseInput(room, input);
    const res = await addRoomToGroup(input.groupId, { ...r, guest: r.guest?.fullName ? clean(r.guest) : null, occupants: r.occupants.filter((o) => o.fullName).map(clean) }, await actor(user));
    refresh(input.groupId);
    return { reference: res.reference };
  }, msg("Room added to the group."));
}

export async function groupCheckInAction(input: { groupId: string; reservationIds?: string[] }) {
  return runAction(async () => {
    const user = await authorize("reservations.check_in");
    const res = await checkInGroup(input.groupId, await actor(user), input.reservationIds ?? null);
    refresh(input.groupId);
    return res;
  });
}

export async function groupCheckOutAction(input: { groupId: string; reservationIds: string[]; allowBalance?: boolean; overrideReason?: string; earlyReason?: string }) {
  return runAction(async () => {
    const user = await authorize("reservations.check_out");
    if (input.allowBalance && !user.permissions.has("reservations.checkout_override")) throw new AppError("Only a manager can let a room leave owing money.", "FORBIDDEN");
    if (input.allowBalance && !input.overrideReason?.trim()) throw new AppError("Give the reason for letting them leave owing.", "VALIDATION", { overrideReason: msg("Required") });
    const res = await checkOutGroup(input.groupId, await actor(user), input.reservationIds, {
      allowBalance: !!input.allowBalance, overrideReason: input.overrideReason?.trim() || null, earlyReason: input.earlyReason?.trim() || null,
    });
    refresh(input.groupId);
    return res;
  });
}

export async function groupInvoiceAction(input: { groupId: string; reservationIds: string[]; mode: "COMBINED" | "SEPARATE" }) {
  return runAction(async () => {
    const user = await authorize("invoices.manage");
    const res = await invoiceGroupRooms(input.groupId, input.reservationIds, input.mode === "SEPARATE" ? "SEPARATE" : "COMBINED", await actor(user));
    refresh(input.groupId);
    revalidatePath("/staff/invoices");
    return res;
  });
}

export async function groupPaymentAction(input: { groupId: string; amount: number; accountId: string; reference?: string; invoiceIds?: string[] }) {
  return runAction(async () => {
    const user = await authorize("payments.record");
    const res = await recordGroupPayment(input.groupId, {
      amount: Math.round(Number(input.amount)), accountId: input.accountId, reference: input.reference ?? null, invoiceIds: input.invoiceIds ?? null,
    }, await actor(user));
    refresh(input.groupId);
    revalidatePath("/staff/payments");
    return res;
  }, msg("Payment recorded."));
}

export async function updateGroupAction(input: {
  groupId: string; name?: string; notes?: string; billing?: "COMBINED" | "SEPARATE"; paymentTermDays?: number | null;
  contact?: { fullName: string; phone?: string } | null; corporateCustomerId?: string | null; creditReason?: string | null;
  type?: z.input<typeof GROUP_TYPE>; profile?: z.input<typeof Profile>;
}) {
  return runAction(async () => {
    const user = await authorize("reservations.edit");
    const profile = input.profile ? parseInput(Profile, input.profile) : undefined;
    const type = input.type ? parseInput(GROUP_TYPE, input.type) : undefined;
    // The contact comes from the details: the company account's contact person when a company is set, else what was typed.
    const company = input.corporateCustomerId ? await db.corporateCustomer.findUnique({ where: { id: input.corporateCustomerId }, select: { contactPerson: true, phone: true, email: true } }) : null;
    const contact = company?.contactPerson ? { fullName: company.contactPerson, phone: company.phone, email: company.email }
      : input.contact?.fullName.trim() ? { fullName: input.contact.fullName.trim(), phone: input.contact.phone?.trim() || null } : null;
    await updateGroup(input.groupId, {
      name: input.name, notes: input.notes, billing: input.billing, paymentTermDays: input.paymentTermDays, type, profile,
      contact, corporateCustomerId: input.corporateCustomerId,
      creditOverride: input.creditReason?.trim() && user.permissions.has("corporate.manage") ? { reason: input.creditReason.trim() } : null,
    }, await actor(user));
    refresh(input.groupId);
    return null;
  }, msg("Group updated."));
}

/** Everyone has left: make the final group invoice from every room's bill. */
export async function finalizeGroupAction(input: { groupId: string }) {
  return runAction(async () => {
    const user = await authorize("invoices.manage", "reservations.check_out");
    const res = await finalizeGroup(input.groupId, await actor(user));
    refresh(input.groupId);
    return res;
  }, msg("Group bill finalized — the final invoice is ready."));
}

export async function cancelGroupAction(input: { groupId: string; reason: string }) {
  return runAction(async () => {
    const user = await authorize("reservations.cancel");
    const res = await cancelGroup(input.groupId, await actor(user), input.reason ?? "");
    refresh(input.groupId);
    return res;
  });
}

export async function addOccupantAction(input: { reservationId: string } & z.input<typeof person>) {
  return runAction(async () => {
    const user = await authorize("reservations.edit", "reservations.check_in");
    const p = parseInput(person, input);
    await addOccupant(input.reservationId, clean(p), await actor(user));
    revalidatePath(`/staff/reservations/${input.reservationId}`);
    return null;
  }, msg("Guest added to the room."));
}

export async function removeOccupantAction(input: { reservationId: string; guestId: string }) {
  return runAction(async () => {
    const user = await authorize("reservations.edit", "reservations.check_in");
    await removeOccupant(input.reservationId, input.guestId, await actor(user));
    revalidatePath(`/staff/reservations/${input.reservationId}`);
    return null;
  }, msg("Guest removed from the room."));
}
