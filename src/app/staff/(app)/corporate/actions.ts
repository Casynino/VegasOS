"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { authorize, requestMeta } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { normalizePhone } from "@/server/services/guests";
import { BILLING_GROUP_CODES } from "@/lib/billing";
import { msg, msgf } from "@/i18n/msg";

const opt = (n: number) => z.string().trim().max(n).transform((v) => v || null);
const Schema = z.object({
  id: z.string().optional(),
  companyName: z.string().trim().min(2, msg("Company name is required.")).max(150),
  contactPerson: opt(100),
  phone: opt(30),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email(msg("Enter a valid email."))]).transform((v) => v || null),
  address: opt(250),
  taxId: opt(40),
  vrn: opt(40),
  registrationNo: opt(60),
  creditLimit: z.union([z.literal(""), z.coerce.number().int().min(0)]).transform((v) => (v === "" ? null : v)),
  paymentTermDays: z.coerce.number().int().min(0).max(180),
  billingNotes: opt(1000),
  billingAddress: opt(300),
  // An invoice is always for the whole bill.
  defaultBillTo: z.literal("COMPANY").default("COMPANY"),
  defaultCovers: z.array(z.enum(BILLING_GROUP_CODES)).max(0).default([]),
  consolidateInvoices: z.preprocess((v) => v === "on" || v === "true" || v === true, z.boolean()),
  status: z.enum(["ACTIVE", "ON_HOLD", "INACTIVE"]).default("ACTIVE"),
});

export async function saveCorporateAction(_prev: unknown, formData: FormData): Promise<ActionResult<{ id: string }>> {
  const res = await runAction(async () => {
    const user = await authorize("corporate.manage");
    const { id, ...data } = parseInput(Schema, { ...Object.fromEntries(formData), defaultCovers: formData.getAll("defaultCovers") });
    const clean = { ...data, phone: normalizePhone(data.phone) };
    const { ipAddress } = await requestMeta();
    const actor = { userId: user.id, label: user.fullName, ipAddress };
    return db.$transaction(async (tx) => {
      if (id) {
        const before = await tx.corporateCustomer.findUnique({ where: { id } });
        if (!before) throw new AppError("Not found.", "NOT_FOUND");
        await tx.corporateCustomer.update({ where: { id }, data: clean });
        await audit(tx, actor, { action: "corporate.updated", entityType: "CorporateCustomer", entityId: id,
          before: { companyName: before.companyName, status: before.status, creditLimit: before.creditLimit, paymentTermDays: before.paymentTermDays, billing: before.defaultBillTo, consolidate: before.consolidateInvoices },
          after: { companyName: clean.companyName, status: clean.status, creditLimit: clean.creditLimit, paymentTermDays: clean.paymentTermDays, billing: clean.defaultBillTo, consolidate: clean.consolidateInvoices } });
        return { id };
      }
      const c = await tx.corporateCustomer.create({ data: clean });
      await audit(tx, actor, { action: "corporate.created", entityType: "CorporateCustomer", entityId: c.id, after: { companyName: c.companyName } });
      return { id: c.id };
    });
  }, msg("Corporate account saved."));
  revalidatePath("/staff/corporate", "layout");
  if (res.ok && !formData.get("id")) redirect(`/staff/corporate/${res.data.id}`);
  return res;
}

// ───────────────────────── Quick add & employees (front desk too) ─────────────────────────

const Employee = z.object({
  fullName: z.string().trim().max(120),
  phone: z.string().trim().max(30).optional(),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email(msg("Enter a valid email."))]).optional(),
  idType: z.string().trim().max(40).optional(),
  idNumber: z.string().trim().max(60).optional(),
});
type EmployeeInput = z.infer<typeof Employee>;

/** A company employee is a guest linked to the company — booked like any guest, ID optional until check-in. */
async function addEmployeeTx(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], companyId: string, e: EmployeeInput) {
  const phone = normalizePhone(e.phone);
  const email = e.email?.trim().toLowerCase() || null;
  // Same phone or email and the same name = the same person: link them rather than add a copy.
  const existing = phone || email ? await tx.guest.findFirst({
    where: { fullName: { equals: e.fullName.trim(), mode: "insensitive" }, OR: [...(phone ? [{ phone }] : []), ...(email ? [{ email }] : [])] },
  }) : null;
  const data = {
    corporateCustomerId: companyId,
    ...(e.idType?.trim() && { idType: e.idType.trim() }), ...(e.idNumber?.trim() && { idNumber: e.idNumber.trim() }),
  };
  if (existing) return tx.guest.update({ where: { id: existing.id }, data });
  return tx.guest.create({ data: { fullName: e.fullName.trim(), phone, email, ...data } });
}

const QuickCompany = z.object({
  companyName: z.string().trim().min(2, msg("Company name is required.")).max(150),
  contactPerson: z.string().trim().max(100).optional(),
  phone: z.string().trim().max(30).optional(),
  email: z.union([z.literal(""), z.string().trim().toLowerCase().email(msg("Enter a valid email."))]).optional(),
  taxId: z.string().trim().max(40).optional(),
  vrn: z.string().trim().max(40).optional(),
  registrationNo: z.string().trim().max(60).optional(),
  address: z.string().trim().max(250).optional(),
  paymentTermDays: z.coerce.number().int().min(0).max(180).default(30),
  kind: z.enum(["COMPANY", "FAMILY", "ORGANIZATION", "GOVERNMENT", "EVENT", "OTHER"]).default("COMPANY"),
  employees: z.array(Employee).max(100).default([]),
});

/**
 * Add a company in one simple step — reception, managers and admins. Money settings
 * (credit limit, suspending the account) stay with managers on the company page.
 */
export async function quickAddCompanyAction(input: z.input<typeof QuickCompany>) {
  const res = await runAction(async () => {
    const user = await authorize("corporate.manage", "reservations.create");
    const d = parseInput(QuickCompany, input);
    const { ipAddress } = await requestMeta();
    const actor = { userId: user.id, label: user.fullName, ipAddress };
    const dup = await db.corporateCustomer.findFirst({ where: { companyName: { equals: d.companyName, mode: "insensitive" } }, select: { id: true } });
    if (dup) throw new AppError(msgf("{company} is already an account.", { company: d.companyName }), "CONFLICT", { companyName: msg("Exists") });
    return db.$transaction(async (tx) => {
      const c = await tx.corporateCustomer.create({
        data: {
          companyName: d.companyName, contactPerson: d.contactPerson || null, phone: normalizePhone(d.phone), email: d.email || null,
          taxId: d.taxId || null, vrn: d.vrn || null, registrationNo: d.registrationNo || null, address: d.address || null, paymentTermDays: d.paymentTermDays, kind: d.kind,
        },
      });
      const staff = [];
      for (const e of d.employees.filter((e) => e.fullName.length >= 2)) {
        const g = await addEmployeeTx(tx, c.id, e);
        staff.push({ id: g.id, fullName: g.fullName, phone: g.phone, idType: g.idType, idNumber: g.idNumber });
      }
      await audit(tx, actor, { action: "corporate.created", entityType: "CorporateCustomer", entityId: c.id, after: { companyName: c.companyName, employees: staff.map((e) => e.fullName) } });
      return { id: c.id, companyName: c.companyName, terms: c.paymentTermDays, available: null, staff, contact: { name: c.contactPerson, phone: c.phone, email: c.email }, kind: c.kind };
    });
  }, msg("Company added."));
  if (res.ok) revalidatePath("/staff/corporate", "layout");
  return res;
}

export async function addEmployeeAction(input: { companyId: string } & z.input<typeof Employee>) {
  return runAction(async () => {
    const user = await authorize("corporate.manage", "reservations.create", "guests.manage");
    const e = parseInput(Employee.extend({ fullName: z.string().trim().min(2, msg("Enter the employee's name.")).max(120) }), input);
    const { ipAddress } = await requestMeta();
    const g = await db.$transaction(async (tx) => {
      const c = await tx.corporateCustomer.findUnique({ where: { id: input.companyId } });
      if (!c) throw new AppError("Company not found.", "NOT_FOUND");
      const g = await addEmployeeTx(tx, c.id, e);
      await audit(tx, { userId: user.id, label: user.fullName, ipAddress }, { action: "corporate.employee_added", entityType: "CorporateCustomer", entityId: c.id, after: { guest: g.fullName, phone: g.phone } });
      return g;
    });
    revalidatePath(`/staff/corporate/${input.companyId}`);
    return { id: g.id, fullName: g.fullName, phone: g.phone, idType: g.idType, idNumber: g.idNumber };
  }, msg("Employee added."));
}

export async function removeEmployeeAction(input: { companyId: string; guestId: string }) {
  return runAction(async () => {
    const user = await authorize("corporate.manage", "reservations.create", "guests.manage");
    const { ipAddress } = await requestMeta();
    await db.$transaction(async (tx) => {
      const g = await tx.guest.findFirst({ where: { id: input.guestId, corporateCustomerId: input.companyId } });
      if (!g) throw new AppError("Not an employee of this company.", "NOT_FOUND");
      await tx.guest.update({ where: { id: g.id }, data: { corporateCustomerId: null } });
      await audit(tx, { userId: user.id, label: user.fullName, ipAddress }, { action: "corporate.employee_removed", entityType: "CorporateCustomer", entityId: input.companyId, after: { guest: g.fullName } });
    });
    revalidatePath(`/staff/corporate/${input.companyId}`);
    return null;
  }, msg("Removed from the company (the guest's history is kept)."));
}
