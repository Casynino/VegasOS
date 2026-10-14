import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));

import { db } from "@/server/db";
import type { HotelSettings } from "@/generated/prisma/client";
import { DEVELOPER_LOCKED_SETTINGS } from "@/lib/permissions";
import { formatRecipientLine } from "@/lib/report-recipients";
import { addListItemAction, updateListItemAction, updateSettingsAction } from "@/app/staff/(app)/settings/actions";
import { checkAllOnlinePaymentsAction, checkOnlinePaymentAction, saveOnlinePaySettingsAction } from "@/app/staff/(app)/finance/online/actions";
import { ONLINE_SERVICES } from "@/server/services/online-pay";
import { auditOf, browser, makeSession, makeUser, removeMadeUsers, type MadeUser } from "../support/developer";

/**
 * What the Developer can NOT change even with "settings.manage" (owner, 2026-10-14), proven on the server against a real database:
 *   - saving the hotel settings: a Developer's change to where guests pay, a money limit, a fee or policy, or where the reports go
 *     is refused (FORBIDDEN), NOTHING in that save is written, and the refusal is in the audit trail; a save that leaves them as they are works;
 *   - the Boss and the MD change all of them as before; a reason is optional for staff and, when the form carries it, 5+ characters for the Developer;
 *   - the payment-method list, the online-payment switches and "Check with nTZS" (which records a payment) are refused for the Developer only.
 */

let dev: MadeUser;
let boss: MadeUser;
let md: MadeUser;
let original: HotelSettings;
const madeLists: { kind: "paymentMethod" | "bookingSource"; id: string }[] = [];

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Dev Rights" });
  boss = await makeUser("OWNER", { fullName: "Boss Rights" });
  md = await makeUser("ADMIN", { fullName: "MD Rights" });
  original = await db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } });
  // A stored state with something in every money field, so "unchanged" has to be recognised for a Decimal, a list of people and the rest.
  await db.hotelSettings.update({
    where: { id: 1 },
    data: {
      bankName: "Test Bank", bankAccountName: "Vegas Test", bankAccountNumber: "0150-111-222", bankBranch: "Mlimani", bankSwift: "TESTTZTZ",
      mobileMoneyName: "Lipa", mobileMoneyNumber: "5551234", mobileMoneyAccountName: "Vegas Lipa", invoiceTerms: "Pay within 14 days.",
      expenseApprovalThreshold: 150000, financeAuthorizationLimit: 3000000, purchaseApproverMustDiffer: true,
      lateCheckoutFee: 10000, roomServiceFee: 2500, airportTransferPrice: 60000, taxName: "VAT", taxRatePercent: "18", taxIncludedInRates: true,
      earlyDeparturePolicy: "CHARGE_USED_NIGHTS", noShowPolicy: "RETAIN_PAYMENT", dateChangeExcessPolicy: "NO_REFUND", dateChangePayNow: true,
      reportEnabled: true, shiftReportEnabled: true,
      reportRecipients: [{ name: "Boss", phone: "+255710000001", channel: "WHATSAPP_CALLMEBOT", apiKeyRef: "BOSS_KEY", lang: "en" }, { name: "MD", phone: "+255710000002", channel: "WHATSAPP_CALLMEBOT", apiKeyRef: null, lang: "zh-CN" }],
    },
  });
});
afterAll(async () => {
  // The settings go back exactly as they were found.
  const restored = Object.fromEntries(Object.entries(original).filter(([k]) => k !== "id" && k !== "updatedAt"));
  await db.hotelSettings.update({ where: { id: 1 }, data: restored as never });
  for (const l of madeLists) {
    if (l.kind === "paymentMethod") await db.paymentMethod.delete({ where: { id: l.id } }).catch(() => undefined);
    else await db.bookingSource.delete({ where: { id: l.id } }).catch(() => undefined);
  }
  await removeMadeUsers();
});
beforeEach(async () => {
  browser.reset();
  await db.session.deleteMany({ where: { userId: { in: [dev.id, boss.id, md.id] } } });
});

const signIn = (u: MadeUser) => makeSession(u.id, { createdMinAgo: 5, seenMinAgo: 1 });
const hhmm = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const settings = () => db.hotelSettings.findUniqueOrThrow({ where: { id: 1 } });

/** The settings form exactly as the browser would send it for what is stored right now (so a save with no edit changes nothing), with edits on top (null = box unticked). */
async function form(edits: Record<string, string | null> = {}): Promise<FormData> {
  const s = await settings();
  const breakfast = await db.hotelService.findUnique({ where: { code: "BREAKFAST" } });
  const f: Record<string, string | null> = {};
  const text: Record<string, string | null> = {
    hotelName: s.hotelName, tagline: s.tagline, addressLine: s.addressLine, postalAddress: s.postalAddress, city: s.city, country: s.country, phone: s.phone, email: s.email,
    website: s.website, whatsapp: s.whatsapp, mapUrl: s.mapUrl, bankName: s.bankName, bankAccountName: s.bankAccountName, bankAccountNumber: s.bankAccountNumber,
    bankBranch: s.bankBranch, bankSwift: s.bankSwift, mobileMoneyName: s.mobileMoneyName, mobileMoneyNumber: s.mobileMoneyNumber, mobileMoneyAccountName: s.mobileMoneyAccountName,
    invoiceTerms: s.invoiceTerms, thankYouMessage: s.thankYouMessage, thankYouSignoff: s.thankYouSignoff, thankYouPromoTitle: s.thankYouPromoTitle, thankYouPromoText: s.thankYouPromoText,
    thankYouRebookText: s.thankYouRebookText, instagramUrl: s.instagramUrl, facebookUrl: s.facebookUrl, tiktokUrl: s.tiktokUrl, taxName: s.taxName, wifiNetwork: s.wifiNetwork,
    wifiPassword: s.wifiPassword, receptionHours: s.receptionHours, breakfastLocation: s.breakfastLocation, breakfastNote: s.breakfastNote, restaurantHours: s.restaurantHours, barHours: s.barHours,
    taxRatePercent: s.taxRatePercent?.toString() ?? null, financeAuthorizationLimit: s.financeAuthorizationLimit?.toString() ?? null, orderPrepMinutes: s.orderPrepMinutes?.toString() ?? null,
    airportTransferPrice: s.airportTransferPrice?.toString() ?? null,
  };
  for (const [k, v] of Object.entries(text)) f[k] = v ?? "";
  Object.assign(f, {
    businessDayStart: hhmm(s.businessDayStartMinutes), standardCheckIn: hhmm(s.standardCheckInMinutes), checkout: hhmm(s.checkoutMinutes), lateArrival: hhmm(s.lateArrivalMinutes),
    breakfastStart: hhmm(s.breakfastStartMinutes), breakfastEnd: hhmm(s.breakfastEndMinutes), noShowCutoff: hhmm(s.noShowCutoffMinutes),
    expenseApprovalThreshold: String(s.expenseApprovalThreshold), invoiceDefaultDueDays: String(s.invoiceDefaultDueDays), maxAdvanceBookingDays: String(s.maxAdvanceBookingDays),
    lateCheckoutFee: String(s.lateCheckoutFee), roomServiceFee: String(s.roomServiceFee), unpaidHoldHours: String(s.unpaidHoldHours),
    earlyDeparturePolicy: s.earlyDeparturePolicy, occupiedRoomService: s.occupiedRoomService, dateChangeExcessPolicy: s.dateChangeExcessPolicy, noShowPolicy: s.noShowPolicy,
    reportRecipients: (s.reportRecipients as { name?: string; phone: string; apiKeyRef?: string | null; lang?: string | null }[]).map(formatRecipientLine).join("\n"),
  });
  const notify = (s.guestNotifications ?? {}) as Record<string, boolean>;
  const ticked: Record<string, boolean> = {
    purchaseApproverMustDiffer: s.purchaseApproverMustDiffer, taxIncludedInRates: s.taxIncludedInRates, reportEnabled: s.reportEnabled, shiftReportEnabled: s.shiftReportEnabled,
    publicBookingEnabled: s.publicBookingEnabled, breakfastIncluded: !!breakfast && breakfast.isActive && breakfast.isPublic, noShowAutoRelease: s.noShowAutoRelease,
    dateChangePayNow: s.dateChangePayNow, notifyBookingCreated: !!notify.bookingCreated, notifyCheckIn: !!notify.checkIn, notifyCheckOut: !!notify.checkOut, notifyOrders: !!notify.orders,
    publicOrderingEnabled: s.publicOrderingEnabled, ...Object.fromEntries(s.breakfastDays.length ? [0, 1, 2, 3, 4, 5, 6].map((d) => [`breakfastDay${d}`, s.breakfastDays.includes(d)]) : []),
  };
  for (const [k, on] of Object.entries(ticked)) f[k] = on ? "on" : null;
  Object.assign(f, edits);
  const fd = new FormData();
  for (const [k, v] of Object.entries(f)) if (v !== null) fd.append(k, v);
  return fd;
}

/** What to type into the form to change each locked setting (a box: "flip" it). */
const EDIT: Record<string, string> = {
  bankName: "Other Bank", bankAccountName: "Someone Else", bankAccountNumber: "9999-000", bankBranch: "Elsewhere", bankSwift: "EVILTZTZ",
  mobileMoneyName: "Other Wallet", mobileMoneyNumber: "7770000", mobileMoneyAccountName: "Someone Else", invoiceTerms: "Pay into my account.",
  expenseApprovalThreshold: "99999999", financeAuthorizationLimit: "99999999", purchaseApproverMustDiffer: "flip",
  lateCheckoutFee: "1", roomServiceFee: "1", airportTransferPrice: "1", taxName: "No tax", taxRatePercent: "0", taxIncludedInRates: "flip",
  earlyDeparturePolicy: "CHARGE_FULL_STAY", noShowPolicy: "REFUND_DUE", dateChangeExcessPolicy: "CREDIT", dateChangePayNow: "flip",
  reportEnabled: "flip", shiftReportEnabled: "flip", reportRecipients: "Intruder, +255700000001",
};

async function editFor(key: string): Promise<Record<string, string | null>> {
  if (EDIT[key] !== "flip") return { [key]: EDIT[key] };
  const current = (await form()).get(key);
  return { [key]: current ? null : "on" };
}

const FIELDS = [...DEVELOPER_LOCKED_SETTINGS] as (keyof Awaited<ReturnType<typeof settings>>)[];
/** The locked settings as a person means them (the recipients as typed: a language of "en" is the same as none; a Decimal as its text). */
const lockedOf = (s: Awaited<ReturnType<typeof settings>>) => JSON.stringify(FIELDS.map((k) => {
  const v = s[k];
  if (k === "reportRecipients") return (v as { name?: string; phone: string; apiKeyRef?: string | null; lang?: string | null }[]).map((r) => [r.name ?? "", r.phone, r.apiKeyRef ?? "", r.lang === "zh-CN" ? "zh" : ""]);
  return v === null || typeof v !== "object" ? v : String(v);
}));
const refusals = (id: string) => auditOf(id, "developer.denied");

describe("the Developer saving the hotel settings", () => {
  it("every locked setting is covered by this test", () => {
    expect(Object.keys(EDIT).sort()).toEqual([...DEVELOPER_LOCKED_SETTINGS].sort());
  });

  it("a save that leaves the money settings as they are works — and the reason it was given for is kept in the audit trail", async () => {
    await signIn(dev);
    const before = lockedOf(await settings());
    const r = await updateSettingsAction(null, await form({ tagline: `Dev tagline ${randomUUID().slice(0, 6)}`, wifiNetwork: "dev-wifi", reason: "Tidying the guest wifi name" }));
    expect(r.ok).toBe(true);
    const after = await settings();
    expect(after.wifiNetwork).toBe("dev-wifi");
    expect(lockedOf(after)).toBe(before);
    const rows = (await auditOf(dev.id, "settings.updated")).slice(-1);
    expect(rows[0]).toMatchObject({ actorType: "DEVELOPER", actorRole: "DEVELOPER" });
    expect(rows[0].after).toMatchObject({ wifiNetwork: "dev-wifi", reason: "Tidying the guest wifi name" });
    expect(rows[0].after).not.toHaveProperty("bankAccountNumber");
  });

  it("a form with no reason field still saves for the Developer (the field is asked for only when the form carries it)", async () => {
    await signIn(dev);
    const r = await updateSettingsAction(null, await form({ wifiNetwork: "dev-wifi-2" }));
    expect(r.ok).toBe(true);
    expect((await settings()).wifiNetwork).toBe("dev-wifi-2");
  });

  it("when the form carries a reason, the Developer must give 5+ characters — and nothing is saved without it", async () => {
    await signIn(dev);
    for (const reason of ["", "   ", "abcd"]) {
      const r = await updateSettingsAction(null, await form({ wifiNetwork: "no-reason", reason }));
      expect(r).toMatchObject({ ok: false, code: "VALIDATION" });
      expect((await settings()).wifiNetwork).not.toBe("no-reason");
    }
    expect((await updateSettingsAction(null, await form({ wifiNetwork: "with-reason", reason: "abcde" }))).ok).toBe(true);
    expect((await settings()).wifiNetwork).toBe("with-reason");
  });

  it.each(DEVELOPER_LOCKED_SETTINGS.map((k) => [k]))("%s: a change is refused, nothing else in that save is written, and the refusal is in the audit trail", async (key) => {
    await signIn(dev);
    const before = await settings();
    const deniedBefore = (await refusals(dev.id)).length;
    const refusedBefore = (await auditOf(dev.id, "settings.update.refused")).length;
    const r = await updateSettingsAction(null, await form({ ...(await editFor(key)), tagline: "Sneaky tagline", reason: "Testing the lock" }));
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
    if (!r.ok) expect(Object.keys(r.fieldErrors ?? {})).toContain(key);
    const after = await settings();
    expect(lockedOf(after)).toBe(lockedOf(before));
    expect(after.tagline).toBe(before.tagline);
    expect(after.updatedAt.getTime()).toBe(before.updatedAt.getTime());
    const denied = (await refusals(dev.id)).slice(deniedBefore);
    expect(denied).toHaveLength(1);
    expect(denied[0]).toMatchObject({ actorType: "DEVELOPER", entityType: "Permission", entityId: "settings.manage" });
    const detail = (await auditOf(dev.id, "settings.update.refused")).slice(refusedBefore);
    expect(detail).toHaveLength(1);
    expect(Object.keys(detail[0].before as object)).toEqual([key]);
  });

  it("several locked changes in one save: all refused together, none written", async () => {
    await signIn(dev);
    const before = lockedOf(await settings());
    const r = await updateSettingsAction(null, await form({ bankAccountNumber: "1", mobileMoneyNumber: "2", expenseApprovalThreshold: "3", financeAuthorizationLimit: "4" }));
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
    if (!r.ok) expect(Object.keys(r.fieldErrors ?? {}).sort()).toEqual(["bankAccountNumber", "expenseApprovalThreshold", "financeAuthorizationLimit", "mobileMoneyNumber"]);
    expect(lockedOf(await settings())).toBe(before);
  });
});

describe("everyone else keeps changing these settings exactly as before", () => {
  it("the Boss and the MD change where guests pay, the limits, the fees and the report recipients — no reason needed", async () => {
    for (const [who, tag] of [[boss, "B"], [md, "M"]] as const) {
      browser.reset();
      await signIn(who);
      const r = await updateSettingsAction(null, await form({
        bankAccountNumber: `ACC-${tag}`, mobileMoneyNumber: `LIPA-${tag}`, expenseApprovalThreshold: tag === "B" ? "250000" : "260000", financeAuthorizationLimit: "4000000",
        lateCheckoutFee: "11000", reportRecipients: `Boss, +25571000000${tag === "B" ? 1 : 3}`,
      }));
      expect(r.ok, `${who.role}`).toBe(true);
      const s = await settings();
      expect([s.bankAccountNumber, s.mobileMoneyNumber, s.financeAuthorizationLimit, s.lateCheckoutFee]).toEqual([`ACC-${tag}`, `LIPA-${tag}`, 4000000, 11000]);
      const row = (await auditOf(who.id, "settings.updated")).slice(-1)[0];
      expect(row).toMatchObject({ actorType: "STAFF", actorRole: who.role });
      expect(row.after).not.toHaveProperty("reason");
      expect(await refusals(who.id)).toHaveLength(0);
    }
  });

  it("a reason is optional for staff and, when given, is kept (even a short one)", async () => {
    await signIn(boss);
    expect((await updateSettingsAction(null, await form({ roomServiceFee: "3100", reason: "ok" }))).ok).toBe(true);
    const row = (await auditOf(boss.id, "settings.updated")).slice(-1)[0];
    expect(row.after).toMatchObject({ roomServiceFee: 3100, reason: "ok" });
    expect((await updateSettingsAction(null, await form({ roomServiceFee: "3200", reason: "" }))).ok).toBe(true);
  });
});

describe("payment methods, online payment and 'Check with nTZS'", () => {
  const named = (p: string) => `${p} ${randomUUID().slice(0, 6)}`;
  const fd = (kind: string, name: string) => { const f = new FormData(); f.set("kind", kind); f.set("name", name); return f; };

  it("the Developer adds ordinary list items (booking sources), but is refused the payment methods — and the Boss still adds both", async () => {
    await signIn(dev);
    const src = await addListItemAction(null, fd("bookingSource", named("Devtest source")));
    expect(src.ok).toBe(true);
    const created = await db.bookingSource.findFirst({ where: { name: { startsWith: "Devtest source" } }, orderBy: { sortOrder: "desc" } });
    if (created) madeLists.push({ kind: "bookingSource", id: created.id });

    const deniedBefore = (await refusals(dev.id)).length;
    const name = named("Devtest method");
    expect(await addListItemAction(null, fd("paymentMethod", name))).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await db.paymentMethod.count({ where: { name } })).toBe(0);
    expect((await refusals(dev.id)).length).toBe(deniedBefore + 1);

    browser.reset();
    await signIn(boss);
    expect((await addListItemAction(null, fd("paymentMethod", name))).ok).toBe(true);
    const made = await db.paymentMethod.findFirstOrThrow({ where: { name } });
    madeLists.push({ kind: "paymentMethod", id: made.id });

    browser.reset();
    await signIn(dev);
    expect(await updateListItemAction({ kind: "paymentMethod", id: made.id, isActive: "false" })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect((await db.paymentMethod.findUniqueOrThrow({ where: { id: made.id } })).isActive).toBe(true);
    browser.reset();
    await signIn(boss);
    expect((await updateListItemAction({ kind: "paymentMethod", id: made.id, isActive: "false" })).ok).toBe(true);
  });

  it("the Developer cannot switch online payment on or off; the Boss can", async () => {
    await signIn(dev);
    const before = (await settings()).onlinePayEnabled;
    const services = Object.fromEntries(ONLINE_SERVICES.map((s) => [s.key, true]));
    const deniedBefore = (await refusals(dev.id)).length;
    expect(await saveOnlinePaySettingsAction({ enabled: !before, services })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect((await settings()).onlinePayEnabled).toBe(before);
    const denied = (await refusals(dev.id)).slice(deniedBefore);
    expect(denied).toHaveLength(1);
    expect(denied[0].entityId).toBe("settings.manage");

    browser.reset();
    await signIn(boss);
    expect(await saveOnlinePaySettingsAction({ enabled: before, services })).toMatchObject({ ok: true });
    expect((await settings()).onlinePayEnabled).toBe(before);
  });

  it("'Check with nTZS' and 'Check all' record a payment: the Developer is refused before anything is looked up; the Boss is not refused", async () => {
    await signIn(dev);
    const deniedBefore = (await refusals(dev.id)).length;
    expect(await checkOnlinePaymentAction({ id: "x".repeat(12) })).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await checkAllOnlinePaymentsAction()).toMatchObject({ ok: false, code: "FORBIDDEN" });
    const denied = (await refusals(dev.id)).slice(deniedBefore);
    expect(denied).toHaveLength(2);
    expect(denied.map((d) => d.entityId)).toEqual(["finance.view,payments.record,revenue.record", "finance.view,payments.record,revenue.record"]);

    browser.reset();
    await signIn(boss);
    // The Boss gets as far as the payment (which does not exist): "not found", never "forbidden".
    expect(await checkOnlinePaymentAction({ id: "x".repeat(12) })).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await refusals(boss.id)).toHaveLength(0);
  });
});
