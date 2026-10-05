"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { authorize, requestMeta } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { parseTimeToMinutes } from "@/lib/time/business-date";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use HH:MM (24-hour).").transform(parseTimeToMinutes);
const money = z.coerce.number().int("Whole shillings only.").min(0, "Cannot be negative.");
const optionalText = z.string().trim().max(300).transform((v) => v || null);
const checkbox = z.preprocess((v) => v === "on" || v === "true", z.boolean());

const SettingsSchema = z.object({
  hotelName: z.string().trim().min(2, "Hotel name is required.").max(120),
  tagline: optionalText,
  addressLine: optionalText,
  postalAddress: optionalText,
  city: optionalText,
  country: optionalText,
  phone: optionalText,
  email: z.union([z.literal(""), z.string().trim().email("Enter a valid email.")]).transform((v) => v || null),
  website: optionalText,
  whatsapp: optionalText,
  mapUrl: z.union([z.literal(""), z.string().trim().url("Enter a full URL.")]).transform((v) => v || null),
  businessDayStart: time,
  standardCheckIn: time,
  checkout: time,
  lateArrival: time,
  expenseApprovalThreshold: money,
  purchaseApproverMustDiffer: checkbox,
  bankName: optionalText,
  bankAccountName: optionalText,
  bankAccountNumber: optionalText,
  bankBranch: optionalText,
  bankSwift: optionalText,
  mobileMoneyName: optionalText,
  mobileMoneyNumber: optionalText,
  mobileMoneyAccountName: optionalText,
  invoiceTerms: z.string().trim().max(1000).transform((v) => v || null),
  thankYouMessage: z.string().trim().max(1500).transform((v) => v || null),
  thankYouSignoff: z.string().trim().max(200).transform((v) => v || null),
  thankYouPromoTitle: z.string().trim().max(120).transform((v) => v || null),
  thankYouPromoText: z.string().trim().max(400).transform((v) => v || null),
  thankYouRebookText: z.string().trim().max(300).transform((v) => v || null),
  instagramUrl: z.union([z.literal(""), z.string().trim().url("Enter the full Instagram link.")]).transform((v) => v || null),
  facebookUrl: z.union([z.literal(""), z.string().trim().url("Enter the full Facebook link.")]).transform((v) => v || null),
  invoiceDefaultDueDays: z.coerce.number().int().min(0).max(365),
  taxName: optionalText,
  taxRatePercent: z.union([z.literal(""), z.coerce.number().min(0).max(100)]).transform((v) => (v === "" ? null : v)),
  taxIncludedInRates: checkbox,
  reportEnabled: checkbox,
  shiftReportEnabled: checkbox,
  reportRecipients: z.string().max(2000),
  publicBookingEnabled: checkbox,
  maxAdvanceBookingDays: z.coerce.number().int().min(1).max(730),
  wifiNetwork: optionalText,
  wifiPassword: optionalText,
  receptionHours: optionalText,
  breakfastHours: optionalText,
  restaurantHours: optionalText,
  barHours: optionalText,
  lateCheckoutFee: money,
  roomServiceFee: money,
  earlyDeparturePolicy: z.enum(["CHARGE_USED_NIGHTS", "CHARGE_ONE_EXTRA_NIGHT", "CHARGE_FULL_STAY"]),
  unpaidHoldHours: z.coerce.number().int().min(0).max(720),
  noShowCutoff: time,
  noShowAutoRelease: checkbox,
  dateChangePayNow: checkbox,
  dateChangeExcessPolicy: z.enum(["NO_REFUND", "CREDIT"]),
  notifyBookingCreated: checkbox,
  notifyCheckIn: checkbox,
  notifyCheckOut: checkbox,
  notifyOrders: checkbox,
  publicOrderingEnabled: checkbox,
  orderPrepMinutes: z.union([z.literal(""), z.coerce.number().int().min(1).max(240)]).transform((v) => (v === "" ? null : v)),
  noShowPolicy: z.enum(["RETAIN_PAYMENT", "REFUND_DUE"]),
  airportTransferPrice: z.union([z.literal(""), z.coerce.number().int().min(0)]).transform((v) => (v === "" ? null : v)),
});

/** "Name, +255710000000" per line → [{ name, phone, channel }] */
function parseRecipients(text: string) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      const [name, phone, apiKeyRef] = line.split(",").map((p) => p.trim());
      if (!phone || !/^\+?\d{9,15}$/.test(phone.replace(/\s/g, ""))) {
        throw new AppError(`Report recipient line ${i + 1}: use "Name, +2557XXXXXXXX".`, "VALIDATION", { reportRecipients: "Invalid recipient" });
      }
      return { name, phone: phone.replace(/\s/g, ""), channel: "WHATSAPP_CALLMEBOT", apiKeyRef: apiKeyRef || null };
    });
}

export async function updateSettingsAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("settings.manage");
    const input = parseInput(SettingsSchema, formData);
    const recipients = parseRecipients(input.reportRecipients);

    const data = {
      hotelName: input.hotelName,
      tagline: input.tagline,
      addressLine: input.addressLine,
      postalAddress: input.postalAddress,
      city: input.city,
      country: input.country,
      phone: input.phone,
      email: input.email,
      website: input.website,
      whatsapp: input.whatsapp,
      mapUrl: input.mapUrl,
      businessDayStartMinutes: input.businessDayStart,
      standardCheckInMinutes: input.standardCheckIn,
      checkoutMinutes: input.checkout,
      lateArrivalMinutes: input.lateArrival,
      expenseApprovalThreshold: input.expenseApprovalThreshold,
      purchaseApproverMustDiffer: input.purchaseApproverMustDiffer,
      bankName: input.bankName,
      bankAccountName: input.bankAccountName,
      bankAccountNumber: input.bankAccountNumber,
      bankBranch: input.bankBranch,
      bankSwift: input.bankSwift,
      mobileMoneyName: input.mobileMoneyName,
      mobileMoneyNumber: input.mobileMoneyNumber,
      mobileMoneyAccountName: input.mobileMoneyAccountName,
      invoiceTerms: input.invoiceTerms,
      thankYouMessage: input.thankYouMessage, thankYouSignoff: input.thankYouSignoff, thankYouPromoTitle: input.thankYouPromoTitle,
      thankYouPromoText: input.thankYouPromoText, thankYouRebookText: input.thankYouRebookText, instagramUrl: input.instagramUrl, facebookUrl: input.facebookUrl,
      invoiceDefaultDueDays: input.invoiceDefaultDueDays,
      taxName: input.taxName,
      taxRatePercent: input.taxRatePercent,
      taxIncludedInRates: input.taxIncludedInRates,
      reportEnabled: input.reportEnabled,
      shiftReportEnabled: input.shiftReportEnabled,
      reportRecipients: recipients,
      publicBookingEnabled: input.publicBookingEnabled,
      maxAdvanceBookingDays: input.maxAdvanceBookingDays,
      wifiNetwork: input.wifiNetwork,
      wifiPassword: input.wifiPassword,
      receptionHours: input.receptionHours,
      breakfastHours: input.breakfastHours,
      restaurantHours: input.restaurantHours,
      barHours: input.barHours,
      lateCheckoutFee: input.lateCheckoutFee,
      roomServiceFee: input.roomServiceFee,
      earlyDeparturePolicy: input.earlyDeparturePolicy,
      unpaidHoldHours: input.unpaidHoldHours,
      noShowCutoffMinutes: input.noShowCutoff,
      noShowAutoRelease: input.noShowAutoRelease,
      dateChangePayNow: input.dateChangePayNow,
      dateChangeExcessPolicy: input.dateChangeExcessPolicy,
      guestNotifications: { bookingCreated: input.notifyBookingCreated, checkIn: input.notifyCheckIn, checkOut: input.notifyCheckOut, orders: input.notifyOrders },
      publicOrderingEnabled: input.publicOrderingEnabled,
      orderPrepMinutes: input.orderPrepMinutes,
      noShowPolicy: input.noShowPolicy,
      airportTransferPrice: input.airportTransferPrice,
      updatedById: user.id,
    };

    if (data.businessDayStartMinutes > 8 * 60) {
      throw new AppError("The business day must start between 00:00 and 08:00.", "VALIDATION", { businessDayStart: "Too late" });
    }
    if (data.checkoutMinutes <= data.businessDayStartMinutes) {
      throw new AppError("Checkout time must be after the business-day start.", "VALIDATION", { checkout: "Must be after business-day start" });
    }

    const { ipAddress } = await requestMeta();
    await db.$transaction(async (tx) => {
      const before = await tx.hotelSettings.findUniqueOrThrow({ where: { id: 1 } });
      const after = await tx.hotelSettings.update({ where: { id: 1 }, data });
      const changed = Object.fromEntries(
        Object.keys(data)
          .filter((k) => k !== "updatedById" && JSON.stringify(before[k as keyof typeof before]) !== JSON.stringify(after[k as keyof typeof after]))
          .map((k) => [k, [before[k as keyof typeof before], after[k as keyof typeof after]]]),
      );
      if (Object.keys(changed).length === 0) return;
      await audit(tx, { userId: user.id, label: user.fullName, ipAddress }, {
        action: "settings.updated",
        entityType: "HotelSettings",
        entityId: "1",
        before: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v[0]])),
        after: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v[1]])),
      });
    });
    revalidatePath("/", "layout");
    return null;
  }, "Settings saved.");
}

// ─────────── Configurable lookup lists ───────────

const LIST_KINDS = ["bookingSource", "paymentMethod", "expenseCategory", "revenueCategory"] as const;
type ListKind = (typeof LIST_KINDS)[number];

const LIST_LABEL: Record<ListKind, string> = {
  bookingSource: "Booking source",
  paymentMethod: "Payment method",
  expenseCategory: "Expense category",
  revenueCategory: "Revenue category",
};

const AddItemSchema = z.object({
  kind: z.enum(LIST_KINDS),
  name: z.string().trim().min(2, "Name is required.").max(60),
  revenueKind: z.enum(["RESTAURANT", "BAR", "OTHER"]).optional(),
});

const toCode = (name: string) => name.toUpperCase().replace(/[^A-Z0-9]+/g, "_").replace(/^_|_$/g, "");

// Prisma delegates share the same shape for these lookup tables.
function delegate(kind: ListKind) {
  return {
    bookingSource: db.bookingSource,
    paymentMethod: db.paymentMethod,
    expenseCategory: db.expenseCategory,
    revenueCategory: db.revenueCategory,
  }[kind] as unknown as {
    findUnique(args: { where: { code?: string; id?: string } }): Promise<{ id: string; name: string; isActive: boolean; isSystem?: boolean } | null>;
    count(): Promise<number>;
    create(args: { data: Record<string, unknown> }): Promise<{ id: string }>;
    update(args: { where: { id: string }; data: Record<string, unknown> }): Promise<{ id: string }>;
  };
}

export async function addListItemAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("settings.manage");
    const input = parseInput(AddItemSchema, formData);
    const code = toCode(input.name);
    if (!code) throw new AppError("Use letters or numbers in the name.");
    const model = delegate(input.kind);
    if (await model.findUnique({ where: { code } })) {
      throw new AppError(`${LIST_LABEL[input.kind]} "${input.name}" already exists.`, "CONFLICT");
    }
    const data: Record<string, unknown> = { code, name: input.name, sortOrder: (await model.count()) + 1 };
    if (input.kind === "revenueCategory") data.kind = input.revenueKind ?? "OTHER";
    const created = await model.create({ data });
    const { ipAddress } = await requestMeta();
    await audit(db, { userId: user.id, label: user.fullName, ipAddress }, {
      action: "settings.list_item_added", entityType: input.kind, entityId: created.id, after: data,
    });
    revalidatePath("/staff/settings");
    return null;
  }, "Added.");
}

const UpdateItemSchema = z.object({
  kind: z.enum(LIST_KINDS),
  id: z.string().min(1),
  name: z.string().trim().min(2).max(60).optional(),
  isActive: z.enum(["true", "false"]).transform((v) => v === "true").optional(),
});

export async function updateListItemAction(input: z.input<typeof UpdateItemSchema>): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("settings.manage");
    const data = parseInput(UpdateItemSchema, input);
    const model = delegate(data.kind);
    const existing = await model.findUnique({ where: { id: data.id } });
    if (!existing) throw new AppError("Item not found.", "NOT_FOUND");
    if (existing.isSystem && data.isActive === false) {
      throw new AppError(`"${existing.name}" is required by the system and cannot be disabled.`);
    }
    const patch: Record<string, unknown> = {};
    if (data.name !== undefined) patch.name = data.name;
    if (data.isActive !== undefined) patch.isActive = data.isActive;
    await model.update({ where: { id: data.id }, data: patch });
    const { ipAddress } = await requestMeta();
    await audit(db, { userId: user.id, label: user.fullName, ipAddress }, {
      action: "settings.list_item_updated", entityType: data.kind, entityId: data.id,
      before: { name: existing.name, isActive: existing.isActive }, after: patch,
    });
    revalidatePath("/staff/settings");
    return null;
  }, "Saved.");
}
