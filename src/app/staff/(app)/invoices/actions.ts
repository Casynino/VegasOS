"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { authorize, requestMeta, type CurrentUser } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { cancelInvoice, createInvoiceForReservation, createManualInvoice, issueInvoice, recordInvoicePayment, voidInvoice } from "@/server/services/invoices";
import { billCompanyNow, recordCompanyPayment } from "@/server/services/company-billing";
import { audit } from "@/server/audit";
import { db } from "@/server/db";
import { msg, msgf } from "@/i18n/msg";

async function actor(user: CurrentUser) {
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, ipAddress, permissions: user.permissions };
}

export async function invoiceReservationAction(input: { reservationId: string }) {
  const res = await runAction(async () => {
    const user = await authorize("invoices.manage");
    return createInvoiceForReservation(input.reservationId, await actor(user));
  });
  if (res.ok) redirect(`/staff/invoices/${res.data.id}`);
  return res;
}

const Line = z.object({
  description: z.string().trim().max(200),
  quantity: z.coerce.number().int().min(1),
  unitAmount: z.coerce.number().int().min(0),
  discountAmount: z.coerce.number().int().min(0).default(0),
});

export async function createManualInvoiceAction(input: { corporateCustomerId: string; notes?: string; lines: z.input<typeof Line>[] }): Promise<ActionResult<{ id: string }>> {
  const res = await runAction(async () => {
    const user = await authorize("invoices.manage");
    const data = parseInput(z.object({ corporateCustomerId: z.string().min(1, msg("Choose a company.")), notes: z.string().max(1000).optional(), lines: z.array(Line).min(1) }), input);
    const inv = await createManualInvoice({ corporateCustomerId: data.corporateCustomerId, notes: data.notes, lines: data.lines }, await actor(user));
    return { id: inv.id };
  });
  if (res.ok) redirect(`/staff/invoices/${res.data.id}`);
  return res;
}

export async function issueInvoiceAction(input: { invoiceId: string; dueDate?: string }) {
  return runAction(async () => {
    const user = await authorize("invoices.manage");
    // A group's running bill becomes its final invoice only by finalizing the group (after everyone has left).
    const running = await db.invoice.findFirst({ where: { id: input.invoiceId, status: "DRAFT", groupId: { not: null } }, select: { group: { select: { name: true } } } });
    if (running) throw new AppError(msgf("This is {group}'s running bill. It becomes the final invoice when you finalize the group, after every room has checked out — for the charges so far, print the group statement.", { group: running.group!.name }));
    await issueInvoice(input.invoiceId, await actor(user), input.dueDate || null);
    revalidatePath(`/staff/invoices/${input.invoiceId}`);
    return null;
  }, msg("Invoice issued."));
}

export async function cancelInvoiceAction(input: { invoiceId: string; reason: string }) {
  return runAction(async () => {
    const user = await authorize("invoices.manage");
    await cancelInvoice(input.invoiceId, input.reason ?? "", await actor(user));
    revalidatePath(`/staff/invoices/${input.invoiceId}`);
    return null;
  }, msg("Invoice cancelled."));
}

export async function invoicePaymentAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("payments.record");
    const data = parseInput(z.object({
      invoiceId: z.string().min(1), amount: z.coerce.number().int().positive(msg("Enter an amount.")),
      accountId: z.string().min(1, msg("Choose where the money was received.")), reference: z.string().trim().max(80).optional(),
      receivedOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional().or(z.literal("")).transform((v) => v || null),
      notes: z.string().trim().max(300).optional(),
    }), formData);
    await recordInvoicePayment(data, await actor(user));
    revalidatePath(`/staff/invoices/${data.invoiceId}`);
    return null;
  }, msg("Payment recorded."));
}

export async function voidInvoiceAction(input: { invoiceId: string; reason: string }) {
  return runAction(async () => {
    const user = await authorize("invoices.manage");
    await voidInvoice(input.invoiceId, input.reason ?? "", await actor(user));
    revalidatePath("/staff", "layout");
    return null;
  }, msg("Invoice voided. Any stays on it owe those lines again."));
}

const CompanyPay = z.object({
  companyId: z.string().min(1),
  amount: z.coerce.number().int().positive(msg("Enter the amount received.")),
  accountId: z.string().min(1, msg("Choose where the money was received.")),
  reference: z.string().trim().max(80).optional(),
  invoiceIds: z.array(z.string()).max(200).optional(),
});

/** The company pays: spread over its unpaid invoices, oldest first (or the invoices ticked). */
export async function companyPaymentAction(input: z.input<typeof CompanyPay>): Promise<ActionResult<{ applied: { invoice: string; amount: number }[] }>> {
  return runAction(async () => {
    const user = await authorize("payments.record");
    const d = parseInput(CompanyPay, input);
    const res = await recordCompanyPayment(d, await actor(user));
    revalidatePath("/staff", "layout");
    return res;
  }, msg("Payment recorded."));
}

/** Move a company-billed stay's company part onto an invoice now (without checking out). */
export async function billCompanyNowAction(input: { reservationId: string; mode?: "ISSUE" | "OPEN" | null }) {
  return runAction(async () => {
    const user = await authorize("invoices.manage");
    const res = await billCompanyNow(input.reservationId, await actor(user), input.mode ?? null);
    revalidatePath("/staff", "layout");
    return res;
  }, msg("Billed to the company."));
}

const SendLog = z.object({
  entityType: z.enum(["Invoice", "BookingGroup", "Reservation"]),
  entityId: z.string().min(1),
  channel: z.enum(["WHATSAPP", "EMAIL", "COPY"]),
  to: z.string().trim().max(200).optional(),
  what: z.string().trim().max(120),
  /** The message text (kept on the guest's history for a thank-you note). */
  body: z.string().max(4000).optional(),
});

/** Record that an invoice or statement was sent (WhatsApp / email opened on this device, or the text copied). */
export async function logSendAction(input: z.input<typeof SendLog>) {
  return runAction(async () => {
    const user = await authorize("invoices.view", "reservations.view");
    const d = parseInput(SendLog, input);
    await audit(db, await actor(user), {
      action: d.entityType === "Invoice" ? "invoice.sent" : d.entityType === "Reservation" ? "thank_you.sent" : "group.statement_sent", entityType: d.entityType, entityId: d.entityId,
      after: { what: d.what, channel: d.channel, to: d.to ?? null },
    });
    if (d.entityType === "Reservation") {
      const r = await db.reservation.findUnique({ where: { id: d.entityId }, select: { guestId: true } });
      if (r) await db.guestMessage.create({ data: { guestId: r.guestId, reservationId: d.entityId, type: "THANK_YOU", channel: d.channel, to: d.to || null, body: d.body ?? d.what, sentById: user.id } });
    }
    return null;
  });
}
