"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { authorize, logDeveloperDenied, requestMeta, type CurrentUser } from "@/server/auth";
import { DEVELOPER_LOCKED_SETTINGS } from "@/lib/permissions";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { parseTimeToMinutes } from "@/lib/time/business-date";
import { parseRecipientLine } from "@/lib/report-recipients";
import { msg, msgf } from "@/i18n/msg";
import { getT } from "@/i18n/server";

const time = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, msg("Use HH:MM (24-hour).")).transform(parseTimeToMinutes);
const money = z.coerce.number().int(msg("Whole shillings only.")).min(0, msg("Cannot be negative."));
const optionalMoney = z.union([z.literal(""), money]).transform((v) => (v === "" ? null : v));
const optionalText = z.string().trim().max(300).transform((v) => v || null);
const checkbox = z.preprocess((v) => v === "on" || v === "true", z.boolean());

const SettingsSchema = z.object({
  hotelName: z.string().trim().min(2, msg("Hotel name is required.")).max(120),
  tagline: optionalText,
  addressLine: optionalText,
  postalAddress: optionalText,
  city: optionalText,
  country: optionalText,
  phone: optionalText,
  email: z.union([z.literal(""), z.string().trim().email(msg("Enter a valid email."))]).transform((v) => v || null),
  website: optionalText,
  whatsapp: optionalText,
  mapUrl: z.union([z.literal(""), z.string().trim().url(msg("Enter a full URL."))]).transform((v) => v || null),
  businessDayStart: time,
  standardCheckIn: time,
  checkout: time,
  lateArrival: time,
  expenseApprovalThreshold: money,
  purchaseApproverMustDiffer: checkbox,
  financeAuthorizationLimit: optionalMoney,
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
  instagramUrl: z.union([z.literal(""), z.string().trim().url(msg("Enter the full Instagram link."))]).transform((v) => v || null),
  facebookUrl: z.union([z.literal(""), z.string().trim().url(msg("Enter the full Facebook link."))]).transform((v) => v || null),
  tiktokUrl: z.union([z.literal(""), z.string().trim().url(msg("Enter the full TikTok link."))]).transform((v) => v || null),
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
  breakfastIncluded: checkbox,
  breakfastStart: time,
  breakfastEnd: time,
  breakfastDay0: checkbox, breakfastDay1: checkbox, breakfastDay2: checkbox, breakfastDay3: checkbox,
  breakfastDay4: checkbox, breakfastDay5: checkbox, breakfastDay6: checkbox,
  breakfastLocation: optionalText,
  breakfastNote: z.string().trim().max(400).transform((v) => v || null),
  restaurantHours: optionalText,
  barHours: optionalText,
  lateCheckoutFee: money,
  roomServiceFee: money,
  earlyDeparturePolicy: z.enum(["CHARGE_USED_NIGHTS", "CHARGE_ONE_EXTRA_NIGHT", "CHARGE_FULL_STAY"]),
  occupiedRoomService: z.enum(["DAILY", "ON_REQUEST"]),
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

/** "Name, +255710000000, KEY, zh" per line → [{ name, phone, channel, apiKeyRef, lang? }] (no language word = English). */
function parseRecipients(text: string) {
  return text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .map((line, i) => {
      const r = parseRecipientLine(line);
      if (!r) {
        throw new AppError(msgf("Report recipient line {line}: use \"Name, +2557XXXXXXXX\".", { line: i + 1 }), "VALIDATION", { reportRecipients: msg("Invalid recipient") });
      }
      return { name: r.name, phone: r.phone, channel: "WHATSAPP_CALLMEBOT", apiKeyRef: r.apiKeyRef, ...(r.lang ? { lang: r.lang } : {}) };
    });
}

const LOCKED_SETTINGS: ReadonlySet<string> = new Set(DEVELOPER_LOCKED_SETTINGS);

/** Thrown inside the save when the Developer's form would change a money setting: the whole save is rolled back, nothing is written. */
class LockedSettingsRefused extends Error {
  constructor(readonly fields: string[], readonly attempted: Record<string, { from: unknown; to: unknown }>) { super("locked settings"); }
}

/** A setting as the form can say it, so a save that changes nothing is never mistaken for a change (a Decimal and a number, the recipients as typed). */
function asTyped(key: string, v: unknown): unknown {
  if (v === null || v === undefined || v === "") return null;
  if (key === "reportRecipients") {
    return (Array.isArray(v) ? v : []).map((r) => {
      const x = (r ?? {}) as { name?: string | null; phone?: string | null; apiKeyRef?: string | null; lang?: string | null };
      return [x.name ?? "", String(x.phone ?? "").replace(/\s/g, ""), x.apiKeyRef ?? "", x.lang === "zh-CN" ? "zh-CN" : ""].join("|");
    }).sort();
  }
  if (typeof v === "object" && typeof (v as { toNumber?: unknown }).toNumber === "function") return (v as { toNumber(): number }).toNumber(); // a Prisma Decimal
  return v;
}
const sameSetting = (key: string, a: unknown, b: unknown) => JSON.stringify(asTyped(key, a)) === JSON.stringify(asTyped(key, b));

/** The Developer's refused attempt, in the audit trail: the usual refusal entry, and one that names the settings and what it tried to put there. */
async function logLockedSettingsRefused(user: CurrentUser, e: LockedSettingsRefused) {
  await logDeveloperDenied(user, ["settings.manage"], "action");
  try {
    const { ipAddress } = await requestMeta();
    await audit(db, { userId: user.id, label: user.fullName, ipAddress }, {
      action: "settings.update.refused", entityType: "HotelSettings", entityId: "1",
      before: Object.fromEntries(Object.entries(e.attempted).map(([k, v]) => [k, v.from])),
      after: { refused: Object.fromEntries(Object.entries(e.attempted).map(([k, v]) => [k, v.to])), why: "The Developer cannot change where guests pay, the money limits or the fees and policies" },
    });
  } catch { /* the audit trail must never break a request */ }
}

export async function updateSettingsAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("settings.manage");
    const input = parseInput(SettingsSchema, formData);
    const recipients = parseRecipients(input.reportRecipients);
    // Why the settings were changed: optional for staff; the Developer must say why whenever the form carries the field (the audit entry keeps it).
    const rawReason = formData.get("reason");
    const reason = typeof rawReason === "string" ? rawReason.trim().slice(0, 300) : "";
    if (user.actorType === "DEVELOPER" && formData.has("reason") && reason.length < 5) {
      throw new AppError("Say why you are changing the settings (at least 5 characters).", "VALIDATION", { reason: msg("Required — at least 5 characters") });
    }
    // 0 = Sunday … 6 = Saturday.
    const breakfastDays = [input.breakfastDay0, input.breakfastDay1, input.breakfastDay2, input.breakfastDay3, input.breakfastDay4, input.breakfastDay5, input.breakfastDay6]
      .flatMap((on, day) => (on ? [day] : []));

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
      financeAuthorizationLimit: input.financeAuthorizationLimit,
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
      thankYouPromoText: input.thankYouPromoText, thankYouRebookText: input.thankYouRebookText, instagramUrl: input.instagramUrl, facebookUrl: input.facebookUrl, tiktokUrl: input.tiktokUrl,
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
      breakfastStartMinutes: input.breakfastStart,
      breakfastEndMinutes: input.breakfastEnd,
      breakfastDays,
      breakfastLocation: input.breakfastLocation,
      breakfastNote: input.breakfastNote,
      restaurantHours: input.restaurantHours,
      barHours: input.barHours,
      lateCheckoutFee: input.lateCheckoutFee,
      roomServiceFee: input.roomServiceFee,
      earlyDeparturePolicy: input.earlyDeparturePolicy,
      occupiedRoomService: input.occupiedRoomService,
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
      throw new AppError("The business day must start between 00:00 and 08:00.", "VALIDATION", { businessDayStart: msg("Too late") });
    }
    if (data.checkoutMinutes <= data.businessDayStartMinutes) {
      throw new AppError("Checkout time must be after the business-day start.", "VALIDATION", { checkout: msg("Must be after business-day start") });
    }

    if (data.breakfastEndMinutes <= data.breakfastStartMinutes) {
      throw new AppError("Breakfast must end after it starts.", "VALIDATION", { breakfastEnd: msg("Must be after the start") });
    }
    if (breakfastDays.length === 0) {
      throw new AppError("Pick at least one day breakfast is served.", "VALIDATION", { breakfastDays: msg("Pick at least one day") });
    }

    const { ipAddress } = await requestMeta();
    await db.$transaction(async (tx) => {
      const before = await tx.hotelSettings.findUniqueOrThrow({ where: { id: 1 } });
      // The Developer never changes where guests pay, a money limit, a fee or policy, or where the reports go — checked here, against what is
      // stored right now, before anything is written. A save that leaves these as they are goes through as always.
      if (user.actorType === "DEVELOPER") {
        const attempted: Record<string, { from: unknown; to: unknown }> = {};
        for (const [k, to] of Object.entries(data)) {
          const from = before[k as keyof typeof before];
          if (LOCKED_SETTINGS.has(k) && !sameSetting(k, from, to)) attempted[k] = { from, to };
        }
        if (Object.keys(attempted).length) throw new LockedSettingsRefused(Object.keys(attempted), attempted);
      }
      const after = await tx.hotelSettings.update({ where: { id: 1 }, data });
      const changed: Record<string, unknown[]> = Object.fromEntries(
        Object.keys(data)
          .filter((k) => k !== "updatedById" && JSON.stringify(before[k as keyof typeof before]) !== JSON.stringify(after[k as keyof typeof after]))
          .map((k) => [k, [before[k as keyof typeof before], after[k as keyof typeof after]]]),
      );
      // "Breakfast is included with room stays" is the hotel's Breakfast service, switched on or off — never a charge.
      const service = await tx.hotelService.findUnique({ where: { code: "BREAKFAST" } });
      const wasIncluded = !!service && service.isActive && service.isPublic;
      if (wasIncluded !== input.breakfastIncluded) {
        if (service) await tx.hotelService.update({ where: { id: service.id }, data: { isActive: input.breakfastIncluded, isPublic: input.breakfastIncluded } });
        else await tx.hotelService.create({ data: { code: "BREAKFAST", name: "Breakfast included", description: "Breakfast is included with every room booking.", category: "DINING", icon: "Coffee", isChargeable: false } });
        changed.breakfastIncluded = [wasIncluded, input.breakfastIncluded];
      }
      if (Object.keys(changed).length === 0) return;
      await audit(tx, { userId: user.id, label: user.fullName, ipAddress }, {
        action: "settings.updated",
        entityType: "HotelSettings",
        entityId: "1",
        before: Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v[0]])),
        after: { ...Object.fromEntries(Object.entries(changed).map(([k, v]) => [k, v[1]])), ...(reason ? { reason } : {}) },
      });
    }).catch(async (e: unknown) => {
      if (!(e instanceof LockedSettingsRefused)) throw e;
      await logLockedSettingsRefused(user, e);
      throw new AppError(
        "The Developer account cannot change where guests pay, the approval limits, the fees and policies that decide what a guest owes, or where the reports go. Ask the Boss or the MD to change them.",
        "FORBIDDEN", Object.fromEntries(e.fields.map((f) => [f, msg("Boss or MD only")])),
      );
    });
    revalidatePath("/", "layout");
    return null;
  }, msg("Settings saved."));
}

// ─────────── Configurable lookup lists ───────────

const LIST_KINDS = ["bookingSource", "paymentMethod", "expenseCategory", "revenueCategory"] as const;
type ListKind = (typeof LIST_KINDS)[number];

const LIST_LABEL: Record<ListKind, string> = {
  bookingSource: msg("Booking source"),
  paymentMethod: msg("Payment method"),
  expenseCategory: msg("Expense category"),
  revenueCategory: msg("Revenue category"),
};

const AddItemSchema = z.object({
  kind: z.enum(LIST_KINDS),
  name: z.string().trim().min(2, msg("Name is required.")).max(60),
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

/** The list of payment methods decides how guests can pay: the Developer does not change it (the refusal is audited). Nobody else is affected. */
async function refuseDeveloperPaymentMethods(user: CurrentUser) {
  if (user.actorType !== "DEVELOPER") return;
  await logDeveloperDenied(user, ["settings.manage"], "action");
  throw new AppError("The Developer account cannot change the payment methods. Ask the Boss or the MD.", "FORBIDDEN");
}

export async function addListItemAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("settings.manage");
    const input = parseInput(AddItemSchema, formData);
    if (input.kind === "paymentMethod") await refuseDeveloperPaymentMethods(user);
    const code = toCode(input.name);
    if (!code) throw new AppError("Use letters or numbers in the name.");
    const model = delegate(input.kind);
    if (await model.findUnique({ where: { code } })) {
      throw new AppError(msgf("{what} \"{name}\" already exists.", { what: (await getT())(LIST_LABEL[input.kind]), name: input.name }), "CONFLICT");
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
  }, msg("Added."));
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
    if (data.kind === "paymentMethod") await refuseDeveloperPaymentMethods(user);
    const model = delegate(data.kind);
    const existing = await model.findUnique({ where: { id: data.id } });
    if (!existing) throw new AppError("Item not found.", "NOT_FOUND");
    if (existing.isSystem && data.isActive === false) {
      throw new AppError(msgf("\"{name}\" is required by the system and cannot be disabled.", { name: existing.name }));
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
  }, msg("Saved."));
}
