import "server-only";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { db } from "../db";
import { businessDayConfig, getSettings } from "../settings";
import { msgf, type Localized } from "@/i18n/msg";
import { addDays, businessDateOf } from "@/lib/time/business-date";
import { deliveryErrorKind, scrubEventText } from "@/lib/console-scrub";
import type { PermissionCode } from "@/lib/permissions";
import { assertConsoleAccess, CONSOLE_HREF, systemDiagnostics, type ConsoleUser, type Diagnostics } from "./developer-console";
import { reportTroubles } from "./report-health";
import { SYSTEM_ROLE } from "./staff-accounts";
import { loadSystemEvents, type SystemEvents } from "./system-events";

/**
 * THE SYSTEM CHECKS (owner, 2026-10-18). THE DEVELOPER DOES NOT DO OPERATIONS: he never deals with shifts, orders, guests' bills, who
 * owes what, requests, stock levels, approvals or cleaning — that is Reception, the managers, Finance, the kitchen and the Boss. His job
 * is to make sure the SYSTEM works and everything is OK. So every check here is about the system itself:
 *   - the data does not contradict itself (a contradiction is a SYSTEM bug, never someone's to-do),
 *   - the automatic jobs run, and the integrations (nTZS, WhatsApp) deliver,
 *   - the settings and keys are right, and there are no unexpected server errors.
 * A fact about the hotel's work (a shift open for long, a guest who left owing, an order waiting, a request unanswered, an expense waiting
 * for approval, low or negative stock, a dirty room, an account that never signed in) is NOT a check. It may only be a plain read-only
 * number on the Hotel and Money tabs.
 *
 * Read-only: nothing here ever changes hotel data. Every check is isolated: one that cannot be run becomes "unknown" ("could not be
 * checked") and never breaks the others. Every query is bounded (a count, a `take`, a date window). Nothing personal is ever returned:
 * examples are codes and numbers only (room numbers, booking references, order numbers, job names) — never a name, a phone or an email.
 */

// ───────────────────────────────────────────── thresholds (each with its reason) ─────────────────────────────────────────────
export const CHECK_LIMITS = {
  /** An unpaid hold is released by the scheduled job; vercel.json's longest gap between runs is 11 hours, so past it + 1 hour the job is not working. */
  holdReleaseGraceHours: 12,
  /** A booking's totals are read only for stays that ended no longer ago than this (older ones are closed and cannot change any more). */
  totalsWindowDays: 120,
  /** Restaurant orders are read only for the last days (an older order cannot be paid any more). */
  ordersWindowDays: 60,
  /** nTZS: the sweep gives a prompt up after 2 h (PROMPT_EXPIRES_MS in mobile-payments.ts) and runs at least every 11 h (the cron's longest gap): still pending after both = not working. */
  onlinePendingHours: 14,
  /** A withdrawal to a phone or a Lipa number is paid out in minutes: still open after 2 hours is stuck (the brief). */
  withdrawalPhoneHours: 2,
  /** A bank payout can take a few working days, weekends included: open for more than four days is stuck. */
  withdrawalBankHours: 96,
  /** One or two failed messages are a wrong number; three or more in a day are the provider (key, quota or number). */
  messagesFailedLook: 3,
  /** A webhook that failed this many times in 7 days is broken, not unlucky. */
  webhookFailedFix: 3,
  /** nTZS payments with no webhook at all for this long: it is not reaching us. */
  webhookSilentDays: 7,
  /** An error seen this many times in all (and again in the last day) is a bug that is still there, not a one-off. */
  errorRepeats: 3,
  /** More failed sign-ins than this in 24 hours is worth a look (the rate limits stop a few typing mistakes at 5–8). */
  failedSignInsLook: 20,
  /** The Developer refused this many times in 24 hours is not a typing mistake (a few are by design: the Developer never writes money). */
  deniedLook: 10,
  /** How many example codes a result carries. */
  examples: 5,
  /** How many checks run at the same time (the database pool is small). */
  parallel: 5,
  /** A check that has not answered by then is "could not be checked". */
  timeoutMs: 8_000,
  /** All the checks together: the page never waits longer than this for them (a check still running then is "could not be checked"). */
  totalMs: 10_000,
} as const;

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// ───────────────────────────────────────────── the result ─────────────────────────────────────────────
/** "Data" = the system's own records contradicting each other (a bug of the system, never someone's work to do). */
export type CheckGroup = "Data" | "People" | "Setup" | "Jobs & errors";
export type CheckState = "ok" | "look" | "fix" | "unknown";

export interface CheckResult {
  /** Stable name (also the id of the attention card when it needs attention). */
  id: string;
  group: CheckGroup;
  title: Localized;
  state: CheckState;
  /** How many things were found (0 when all is well; 0 when it could not be checked). The same number is `summary.vars.n`. */
  count: number;
  summary: Localized;
  /** What it means, in plain words. */
  what: Localized;
  /** What to fix. */
  todo: Localized;
  /** Who fixes it: the Developer, or the system owner for keys and billing. */
  who: Localized;
  /** The page where it is fixed or looked at, when there is one this Developer may open. */
  link?: { href: string; label: Localized };
  /** Codes and numbers only (room numbers, booking references, order numbers, job names), at most five. */
  examples?: string[];
  /** True when the check did not apply here or was not needed (reports switched off, not the live site, caused by a problem above): it is not counted as "fine". */
  skipped?: boolean;
}

type Settings = Awaited<ReturnType<typeof getSettings>>;

interface Ctx {
  user: ConsoleUser;
  now: Date;
  settings: Settings;
  diag: Diagnostics;
  /** null = the log of system events could not be read. */
  events: SystemEvents | null;
}

type Found = {
  state: "look" | "fix"; count: number; summary: Localized; examples?: string[];
  /** A title that says more than the check's own (the report checks name what went wrong). */
  title?: Localized; what?: Localized; todo?: Localized; who?: Localized; link?: CheckResult["link"] | null;
};
type Outcome = { state: "ok"; summary?: Localized; skipped?: boolean } | Found | { state: "unknown"; why: Localized };

interface Def {
  id: string;
  group: CheckGroup;
  title: Localized;
  what: Localized;
  todo: Localized;
  who: Localized;
  allClear: Localized;
  link?: (c: Ctx) => CheckResult["link"] | undefined;
  run: (c: Ctx) => Promise<Outcome>;
}

// ───────────────────────────────────────────── small helpers ─────────────────────────────────────────────
const link = (c: Ctx, needs: PermissionCode | null, href: string, label: Localized): CheckResult["link"] | undefined =>
  needs === null || c.user.permissions.has(needs) ? { href, label } : undefined;
const crashesTab = `${CONSOLE_HREF.home}#errors`;
const messagesTab = `${CONSOLE_HREF.home}#messages`;

/** A code or a number — never a sentence: letters, digits and . _ : / # - only, no spaces, no "@". */
function code(raw: unknown): string | null {
  if (typeof raw !== "string" && typeof raw !== "number") return null;
  const s = String(raw).replace(/[^A-Za-z0-9._:/#-]/g, "").slice(0, 40);
  return s.length > 0 ? s : null;
}
const codes = (raw: unknown[]): string[] => [...new Set(raw.map(code).filter((x): x is string => !!x))].slice(0, CHECK_LIMITS.examples);
const tail = (id: string) => `…${id.slice(-6)}`;

const WHO_DEV = () => msgf("The Developer.", {});

/** A count and its examples as a raw list of one column (the `total` is carried on every row so one query gives both). */
interface Listed { code: string | null; total: bigint | number }
const totalOf = (rows: Listed[]) => (rows.length ? Number(rows[0].total) : 0);

// ───────────────────────────────────────────── 1. rooms ─────────────────────────────────────────────
const roomOccupiedNoStay: Def = {
  id: "room-occupied-no-stay", group: "Data",
  title: msgf("Rooms marked occupied", {}),
  allClear: msgf("Every room marked occupied has a guest checked in.", {}),
  what: msgf("A room's status says a guest is in it, but no stay is checked in to that room. The room cannot be sold, and the room lists and the reports disagree with the front desk.", {}),
  todo: msgf("Find how the status got out of step (a check-out or a room move that stopped half way, or a status changed outside the normal screens). Look at the room's history in Audit, fix the cause, then correct the room's status with a data fix: a room with a guest in it cannot be changed by hand.", {}),
  who: WHO_DEV(),
  link: (c) => link(c, "rooms.view", "/staff/rooms", msgf("Open Rooms", {})) ?? { href: CONSOLE_HREF.audit, label: msgf("Open Audit", {}) },
  async run() {
    const where = { isActive: true, status: "OCCUPIED" as const, reservationRooms: { none: { status: "CHECKED_IN" as const } } };
    const [count, rows] = await Promise.all([
      db.room.count({ where }),
      db.room.findMany({ where, select: { number: true }, orderBy: { number: "asc" }, take: CHECK_LIMITS.examples }),
    ]);
    if (!count) return { state: "ok" };
    return {
      state: "fix", count, examples: codes(rows.map((r) => r.number)),
      summary: count === 1 ? msgf("{n} room is marked occupied with nobody checked in.", { n: count }) : msgf("{n} rooms are marked occupied with nobody checked in.", { n: count }),
    };
  },
};

const stayRoomNotOccupied: Def = {
  id: "stay-room-not-occupied", group: "Data",
  title: msgf("Rooms of checked-in guests", {}),
  allClear: msgf("The room of every checked-in guest is marked occupied.", {}),
  what: msgf("A guest is checked in, but the room's status is not \"occupied\" (it may show as clean, dirty or free). Housekeeping, the room lists and the front desk could treat the room as empty.", {}),
  todo: msgf("Find how the room's status changed while the guest was in it (Audit shows every status change), fix the cause, then correct the status with a data fix.", {}),
  who: WHO_DEV(),
  link: (c) => link(c, "rooms.view", "/staff/rooms", msgf("Open Rooms", {})) ?? { href: CONSOLE_HREF.audit, label: msgf("Open Audit", {}) },
  async run() {
    const where = { status: "CHECKED_IN" as const, room: { status: { not: "OCCUPIED" as const } } };
    const [count, rows] = await Promise.all([
      db.reservationRoom.count({ where }),
      db.reservationRoom.findMany({ where, select: { room: { select: { number: true } } }, orderBy: { checkedInAt: "desc" }, take: CHECK_LIMITS.examples }),
    ]);
    if (!count) return { state: "ok" };
    return {
      state: "fix", count, examples: codes(rows.map((r) => r.room.number)),
      summary: count === 1 ? msgf("{n} checked-in stay is in a room that is not marked occupied.", { n: count }) : msgf("{n} checked-in stays are in rooms that are not marked occupied.", { n: count }),
    };
  },
};

const roomTwoStays: Def = {
  id: "room-two-stays", group: "Data",
  title: msgf("One guest per room", {}),
  allClear: msgf("No room has two stays checked in at once.", {}),
  what: msgf("Two stays are checked in to the same room at the same time. The database is built to make this impossible, so the rule that guards it has been broken.", {}),
  todo: msgf("Treat it as a serious data bug. Look at both stays in Business, find how the second check-in got through, and fix it. Reception can tell which guest is really in the room.", {}),
  who: WHO_DEV(),
  link: () => ({ href: CONSOLE_HREF.business, label: msgf("Open Business", {}) }),
  async run() {
    const rows = await db.$queryRaw<Listed[]>`
      SELECT g.number AS code, count(*) OVER () AS total FROM (
        SELECT r."number" FROM "reservation_rooms" rr JOIN "rooms" r ON r."id" = rr."roomId"
        WHERE rr."status" = 'CHECKED_IN' GROUP BY r."id", r."number" HAVING count(*) > 1
      ) g ORDER BY g.number LIMIT ${CHECK_LIMITS.examples}`;
    const count = totalOf(rows);
    if (!count) return { state: "ok" };
    return {
      state: "fix", count, examples: codes(rows.map((r) => r.code)),
      summary: count === 1 ? msgf("{n} room has two stays checked in at once.", { n: count }) : msgf("{n} rooms have two stays checked in at once.", { n: count }),
    };
  },
};

// ───────────────────────────────────────────── 2. money records that must agree ─────────────────────────────────────────────
const reservationTotals: Def = {
  id: "reservation-totals", group: "Data",
  title: msgf("Booking totals", {}),
  allClear: msgf("Every booking's totals match its charges and payments.", {}),
  what: msgf("A booking keeps its totals (the bill, what was paid, what is left). They are always worked out again from the room nights, the charges and the posted payments. For these bookings the stored totals disagree with those records, so a screen or a report may show a wrong balance.", {}),
  todo: msgf("Do not change any money record. Find why the totals were not worked out again after the last change (the booking's history is in Audit), fix that in the code, and let the system work the totals out again.", {}),
  who: WHO_DEV(),
  link: () => ({ href: CONSOLE_HREF.business, label: msgf("Open Business", {}) }),
  async run(c) {
    const since = addDays(businessDateOf(c.now, businessDayConfig(c.settings)), -CHECK_LIMITS.totalsWindowDays);
    const rows = await db.$queryRaw<Listed[]>`
      SELECT r."reference" AS code, count(*) OVER () AS total FROM "reservations" r
      WHERE r."departureDate" >= ${since}::date AND (
        r."balanceAmount" <> r."netAmount" - r."paidAmount" - r."companyBilledAmount"
        OR r."netAmount" <> r."grossAmount" - r."discountAmount" + r."chargesAmount"
        OR r."paidAmount" <> COALESCE((SELECT SUM(CASE WHEN p."kind" = 'PAYMENT' THEN p."amount" ELSE -p."amount" END)
             FROM "payments" p WHERE p."reservationId" = r."id" AND p."status" = 'POSTED' AND p."invoiceId" IS NULL), 0)
        OR r."chargesAmount" <> COALESCE((SELECT SUM(ch."amount") FROM "reservation_charges" ch WHERE ch."reservationId" = r."id" AND ch."isVoided" = false), 0)
      ) ORDER BY r."updatedAt" DESC LIMIT ${CHECK_LIMITS.examples}`;
    const count = totalOf(rows);
    if (!count) return { state: "ok" };
    return {
      state: "fix", count, examples: codes(rows.map((r) => r.code)),
      summary: count === 1 ? msgf("{n} booking has totals that do not match its charges and payments.", { n: count }) : msgf("{n} bookings have totals that do not match their charges and payments.", { n: count }),
    };
  },
};

const orderPayments: Def = {
  id: "order-payments", group: "Data",
  title: msgf("Restaurant order payments", {}),
  allClear: msgf("Every restaurant order's paid amount matches its posted payments.", {}),
  what: msgf("An order's paid amount and payment status are always worked out from its posted payments. For these orders they disagree: an order shows as paid with no payment behind it, or it has a payment but does not show as paid.", {}),
  todo: msgf("Look at the order and its payments in Business, find why the order was not updated after its last payment, and fix the cause. Never edit a payment to hide the difference.", {}),
  who: WHO_DEV(),
  link: () => ({ href: CONSOLE_HREF.business, label: msgf("Open Business", {}) }),
  async run(c) {
    const since = addDays(businessDateOf(c.now, businessDayConfig(c.settings)), -CHECK_LIMITS.ordersWindowDays);
    const rows = await db.$queryRaw<Listed[]>`
      SELECT o."number" AS code, count(*) OVER () AS total FROM "restaurant_orders" o
      WHERE o."isGift" = false AND o."businessDate" >= ${since}::date AND (
        o."paidAmount" <> COALESCE((SELECT SUM(p."amount") FROM "restaurant_order_payments" p WHERE p."orderId" = o."id" AND p."status" = 'POSTED'), 0)
        OR (o."paymentStatus" IN ('PAID', 'PARTIALLY_PAID', 'PENDING_CONFIRMATION')
            AND NOT EXISTS (SELECT 1 FROM "restaurant_order_payments" p WHERE p."orderId" = o."id" AND p."status" = 'POSTED'))
      ) ORDER BY o."updatedAt" DESC LIMIT ${CHECK_LIMITS.examples}`;
    const count = totalOf(rows);
    if (!count) return { state: "ok" };
    return {
      state: "fix", count, examples: codes(rows.map((r) => r.code)),
      summary: count === 1 ? msgf("{n} order's paid amount does not match its payments.", { n: count }) : msgf("{n} orders' paid amounts do not match their payments.", { n: count }),
    };
  },
};

const onlinePending: Def = {
  id: "online-pending", group: "Data",
  title: msgf("Online payments confirmed by nTZS", {}),
  allClear: msgf("No online payment is stuck waiting for nTZS.", {}),
  what: msgf("A customer's mobile-money prompt is still \"waiting\" long after it should have been settled. The system gives a prompt up after 2 hours and asks nTZS again on every scheduled run, so one still waiting means the confirmation never arrived and the check that should have found it is not working.", {}),
  todo: msgf("Check that the nTZS key is set and valid, that the scheduled jobs run (the Errors & jobs part) and that the nTZS webhook arrives. Only when the system works again does Finance settle the payment itself.", {}),
  who: msgf("The Developer; the system owner for the nTZS key.", {}),
  link: (c) => link(c, "finance.view", "/staff/finance/online", msgf("Open Online payments", {})) ?? { href: crashesTab, label: msgf("Open Errors & jobs", {}) },
  async run(c) {
    const where = { provider: "NTZS", status: "PENDING" as const, completedAt: null, createdAt: { lt: new Date(c.now.getTime() - CHECK_LIMITS.onlinePendingHours * HOUR) } };
    const [count, rows] = await Promise.all([
      db.mobilePayment.count({ where }),
      db.mobilePayment.findMany({ where, select: { id: true }, orderBy: { createdAt: "asc" }, take: CHECK_LIMITS.examples }),
    ]);
    if (!count) return { state: "ok" };
    return {
      state: "fix", count, examples: codes(rows.map((r) => tail(r.id))),
      summary: count === 1 ? msgf("{n} online payment has been waiting for nTZS for over {h} hours.", { n: count, h: CHECK_LIMITS.onlinePendingHours }) : msgf("{n} online payments have been waiting for nTZS for over {h} hours.", { n: count, h: CHECK_LIMITS.onlinePendingHours }),
    };
  },
};

const withdrawalsStuck: Def = {
  id: "withdrawals", group: "Data",
  title: msgf("Withdrawals finish at nTZS", {}),
  allClear: msgf("No withdrawal is stuck at nTZS.", {}),
  what: msgf("A withdrawal was sent to nTZS and is still not finished long after it should be (2 hours for a phone or a Lipa number, four days for a bank). Either nTZS is not answering, or the system is not asking it.", {}),
  todo: msgf("Check the nTZS key, the scheduled jobs (the Errors & jobs part) and the nTZS dashboard for the withdrawal. After the cause is fixed, the Boss or Finance settles the withdrawal itself.", {}),
  who: msgf("The Developer; the system owner for the nTZS account.", {}),
  link: (c) => link(c, "withdrawals.manage", "/staff/finance/withdraw", msgf("Open Withdrawals", {})) ?? { href: crashesTab, label: msgf("Open Errors & jobs", {}) },
  async run(c) {
    const phoneBefore = new Date(c.now.getTime() - CHECK_LIMITS.withdrawalPhoneHours * HOUR);
    const bankBefore = new Date(c.now.getTime() - CHECK_LIMITS.withdrawalBankHours * HOUR);
    // How long it has been with nTZS: since it was sent (a price can be confirmed some time after it was asked for).
    const sentBefore = (before: Date) => ({ OR: [{ submittedAt: { lt: before } }, { submittedAt: null, createdAt: { lt: before } }] });
    // AWAITING_APPROVAL and IN_REVIEW are nTZS's own checks of a payout (they can take days): the wait is theirs, not a failure of the system.
    const where = {
      status: { in: ["SUBMITTING", "UNKNOWN", "PROCESSING"] as ("SUBMITTING" | "UNKNOWN" | "PROCESSING")[] }, reconciledAt: null,
      OR: [
        { destinationKind: { not: "BANK" }, ...sentBefore(phoneBefore) },
        { destinationKind: "BANK", ...sentBefore(bankBefore) },
      ],
    };
    const [count, rows] = await Promise.all([
      db.withdrawal.count({ where }),
      db.withdrawal.findMany({ where, select: { id: true, number: true }, orderBy: { createdAt: "asc" }, take: CHECK_LIMITS.examples }),
    ]);
    if (!count) return { state: "ok" };
    return {
      state: "fix", count, examples: codes(rows.map((r) => r.number ?? tail(r.id))),
      summary: count === 1 ? msgf("{n} withdrawal is not finished at nTZS.", { n: count }) : msgf("{n} withdrawals are not finished at nTZS.", { n: count }),
    };
  },
};

// ───────────────────────────────────────────── 3. stock ─────────────────────────────────────────────
const stockMovements: Def = {
  id: "stock-movements", group: "Data",
  title: msgf("Stock against its movements", {}),
  allClear: msgf("Every stock item's quantity equals the total of its movements.", {}),
  what: msgf("The stock on hand of an item is the total of its posted stock movements, and only a movement may change it. For these items the quantity differs from that total, so something changed a quantity without a movement.", {}),
  todo: msgf("Find what changed the quantity directly (Audit shows the item's history) and fix it. Do not edit movements; they are never changed.", {}),
  who: WHO_DEV(),
  link: () => ({ href: CONSOLE_HREF.business, label: msgf("Open Business", {}) }),
  async run() {
    const rows = await db.$queryRaw<Listed[]>`
      SELECT COALESCE(i."sku", 'item-' || right(i."id", 6)) AS code, count(*) OVER () AS total FROM "inventory_items" i
      WHERE abs(i."quantity" - COALESCE((SELECT SUM(m."change") FROM "inventory_movements" m WHERE m."itemId" = i."id" AND m."status" = 'POSTED'), 0)) > 0.0015
      ORDER BY i."updatedAt" DESC LIMIT ${CHECK_LIMITS.examples}`;
    const count = totalOf(rows);
    if (!count) return { state: "ok" };
    return {
      state: "fix", count, examples: codes(rows.map((r) => r.code)),
      summary: count === 1 ? msgf("{n} stock item does not match its movements.", { n: count }) : msgf("{n} stock items do not match their movements.", { n: count }),
    };
  },
};

const auditProtected: Def = {
  id: "audit-protected", group: "Data",
  title: msgf("The audit trail cannot be changed", {}),
  allClear: msgf("The database refuses any change or removal of an audit line.", {}),
  what: msgf("Every action is written to the audit trail, and the database itself refuses to change or delete a line of it. That protection is missing, so a line could be altered and the trail could no longer be trusted.", {}),
  todo: msgf("Apply the database update that creates the audit guard (the migration of the Developer account) again, and check the update log in Settings.", {}),
  who: WHO_DEV(),
  async run() {
    const rows = await db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM pg_trigger t JOIN pg_class c ON c.oid = t.tgrelid WHERE t.tgname = 'audit_logs_no_change' AND c.relname = 'audit_logs' AND NOT t.tgisinternal AND t.tgenabled <> 'D'`;
    return (rows[0]?.n ?? 0) > 0 ? { state: "ok" } : { state: "fix", count: 1, summary: msgf("The audit trail is not protected by the database.", { n: 1 }) };
  },
};

// ───────────────────────────────────────────── 4. the hold-release job ─────────────────────────────────────────────
const holdsNotReleased: Def = {
  id: "holds-not-released", group: "Jobs & errors",
  title: msgf("Unpaid booking holds are released", {}),
  allClear: msgf("Unpaid booking holds are released on time.", {}),
  what: msgf("An unpaid booking keeps its room only until its hold time; the scheduled job then releases the room. These bookings are long past that time and still hold their room, so the release is not working.", {}),
  todo: msgf("Open the Errors & jobs part: did the daily job run, and did it fail? Check the cron secret and the server logs for the \"booking states\" step.", {}),
  who: WHO_DEV(),
  link: () => ({ href: crashesTab, label: msgf("Open Errors & jobs", {}) }),
  async run(c) {
    const lapsed = new Date(c.now.getTime() - CHECK_LIMITS.holdReleaseGraceHours * HOUR);
    // The same rule the release uses (booking-holds.ts expireUnpaidHolds), a long time later.
    const where = {
      status: "RESERVED" as const, holdUntil: { lt: lapsed }, paidAmount: { lte: 0 },
      mobilePayments: { none: { status: "PENDING" as const, completedAt: null, expiresAt: { gt: c.now } } },
    };
    const [count, rows] = await Promise.all([
      db.reservation.count({ where }),
      db.reservation.findMany({ where, select: { reference: true }, orderBy: { holdUntil: "asc" }, take: CHECK_LIMITS.examples }),
    ]);
    if (!count) return { state: "ok" };
    return {
      state: "fix", count, examples: codes(rows.map((r) => r.reference)),
      summary: count === 1 ? msgf("{n} unpaid booking still holds its room long after its hold time.", { n: count }) : msgf("{n} unpaid bookings still hold their rooms long after their hold time.", { n: count }),
    };
  },
};

// ───────────────────────────────────────────── 5. jobs, webhooks, messages, reports, errors ─────────────────────────────────────────────
const jobsOverdue: Def = {
  id: "jobs-overdue", group: "Jobs & errors",
  title: msgf("Automatic jobs run on time", {}),
  allClear: msgf("Every automatic job ran when it should.", {}),
  what: msgf("The system runs jobs by itself on a timer: the daily and room reports, the clean-up of old sessions, checking online payments and withdrawals, releasing held rooms. A job that did not run when it should means that work is not being done.", {}),
  todo: msgf("Check that the cron secret is set, that the jobs are listed under Cron Jobs in Vercel and that the last deploy kept vercel.json. The Errors & jobs part shows the last run of each job.", {}),
  who: msgf("The Developer; the system owner for the hosting plan.", {}),
  link: () => ({ href: crashesTab, label: msgf("Open Errors & jobs", {}) }),
  async run(c) {
    if (!c.events) return { state: "unknown", why: msgf("Could not be checked: the log of system events could not be read.", {}) };
    const jobs = c.events.jobs;
    // `overdue` already allows for a brand-new recording (a job never seen is late only once it has had time to run since it began).
    const late = jobs.filter((j) => j.overdue);
    if (!late.length) {
      // Nothing is late, but nothing has been seen either: that is not "all well", it is "too early to say".
      if (jobs.length > 0 && jobs.every((j) => j.lastRunAt === null)) return { state: "unknown", why: msgf("Could not be checked: no run of any job has been recorded yet.", {}) };
      return { state: "ok" };
    }
    return {
      state: "fix", count: late.length, examples: codes(late.map((j) => j.job)),
      summary: late.length === 1 ? msgf("{n} automatic job did not run on time.", { n: late.length }) : msgf("{n} automatic jobs did not run on time.", { n: late.length }),
    };
  },
};

const jobsFailed: Def = {
  id: "jobs-failed", group: "Jobs & errors",
  title: msgf("Automatic jobs finish without errors", {}),
  allClear: msgf("The last run of every automatic job ended well.", {}),
  what: msgf("A job ran but ended with an error. Its work may be only half done. (A step that fails does not stop the daily report, but the step's own work is not done.)", {}),
  todo: msgf("Open the Errors & jobs part for the job's last error, find the cause in the code or the logs, and deploy the fix.", {}),
  who: WHO_DEV(),
  link: () => ({ href: crashesTab, label: msgf("Open Errors & jobs", {}) }),
  async run(c) {
    if (!c.events) return { state: "unknown", why: msgf("Could not be checked: the log of system events could not be read.", {}) };
    const failed = c.events.jobs.filter((j) => j.lastStatus === "FAILED");
    if (!failed.length) return { state: "ok" };
    return {
      state: "fix", count: failed.length, examples: codes(failed.map((j) => j.job)),
      summary: failed.length === 1 ? msgf("{n} automatic job failed on its last run.", { n: failed.length }) : msgf("{n} automatic jobs failed on their last run.", { n: failed.length }),
    };
  },
};

/** The nTZS row of the webhook log (its source is "webhook:ntzs"). */
const ntzsHook = (e: SystemEvents) => e.webhooks.find((w) => /ntzs/i.test(w.source));

const webhooksFailing: Def = {
  id: "webhooks-failing", group: "Jobs & errors",
  title: msgf("nTZS messages are accepted", {}),
  allClear: msgf("The messages nTZS sends about payments are accepted.", {}),
  what: msgf("nTZS tells the system about a payment with a signed message (a webhook). The system refused or could not process some of them. Payments are then found only when the system asks nTZS itself, which is slower for the customer.", {}),
  todo: msgf("Check that the webhook secret on the server is the one in the nTZS dashboard, and that nTZS calls this site's address. The Errors & jobs part shows the last failure.", {}),
  who: msgf("The Developer; the system owner for the nTZS settings.", {}),
  link: () => ({ href: crashesTab, label: msgf("Open Errors & jobs", {}) }),
  async run(c) {
    if (!c.events) return { state: "unknown", why: msgf("Could not be checked: the log of system events could not be read.", {}) };
    const w = ntzsHook(c.events);
    if (!w || w.failed7d === 0) return { state: "ok" };
    // Broken, not unlucky: several failures AND the last receipt failed (or none ever worked).
    const stillFailing = !w.lastOkAt || (w.lastFailedAt !== null && w.lastFailedAt > w.lastOkAt);
    return {
      state: w.failed7d >= CHECK_LIMITS.webhookFailedFix && stillFailing ? "fix" : "look", count: w.failed7d, examples: codes([w.source]),
      summary: w.failed7d === 1 ? msgf("{n} message from nTZS failed in the last 7 days.", { n: w.failed7d }) : msgf("{n} messages from nTZS failed in the last 7 days.", { n: w.failed7d }),
    };
  },
};

const webhooksSilent: Def = {
  id: "webhooks-silent", group: "Jobs & errors",
  title: msgf("nTZS messages are arriving", {}),
  allClear: msgf("nTZS messages arrive when online payments are made.", {}),
  what: msgf("Online payments were completed in the last 7 days, but not one message from nTZS arrived. The payments were still found by asking nTZS, but slowly — the webhook is probably not reaching this site.", {}),
  todo: msgf("In the nTZS dashboard check that the webhook points at this site's address and is switched on, and that the site address setting on the server is right.", {}),
  who: msgf("The Developer; the system owner for the nTZS settings.", {}),
  link: () => ({ href: crashesTab, label: msgf("Open Errors & jobs", {}) }),
  async run(c) {
    if (!c.events) return { state: "unknown", why: msgf("Could not be checked: the log of system events could not be read.", {}) };
    // Without the key or the secret the setup checks already say so.
    if (!c.diag.ntzs.configured || !c.diag.ntzs.webhookSecret) return { state: "ok", skipped: true, summary: msgf("Not checked here: the nTZS key or the webhook secret is not set (see Setup).", {}) };
    const since = new Date(c.now.getTime() - CHECK_LIMITS.webhookSilentDays * DAY);
    const paid = await db.mobilePayment.count({ where: { provider: "NTZS", status: "COMPLETED", completedAt: { gte: since } } });
    if (!paid) return { state: "ok" };
    const w = ntzsHook(c.events);
    if ((w?.ok7d ?? 0) + (w?.failed7d ?? 0) > 0) return { state: "ok" };
    // Silence only means something once a whole week has been recorded.
    const [first] = await db.$queryRaw<{ at: Date | null }[]>`SELECT min("firstSeenAt") AS at FROM "system_events"`;
    if (!first?.at || first.at > since) return { state: "unknown", why: msgf("Could not be checked: the system has been recording for less than {n} days.", { n: CHECK_LIMITS.webhookSilentDays }) };
    return { state: "look", count: paid, summary: paid === 1 ? msgf("{n} online payment was completed in 7 days and no message from nTZS arrived.", { n: paid }) : msgf("{n} online payments were completed in 7 days and no message from nTZS arrived.", { n: paid }) };
  },
};

/** deliveryErrorKind's word for "the provider does not accept this phone number" (see console-scrub.ts). */
const NOT_ACCEPTED = "Phone number not accepted";

const messagesFailing: Def = {
  id: "deliveries-failed", group: "Jobs & errors",
  title: msgf("WhatsApp messages are delivered", {}),
  allClear: msgf("WhatsApp messages are going out.", {}),
  what: msgf("Several WhatsApp messages failed in the last 24 hours. A single one is usually a wrong number; several mean the provider: a missing or wrong key, the message limit, or a number the provider refuses. Reports and guest messages then do not reach their people.", {}),
  todo: msgf("Check the WhatsApp (CallMeBot) keys on the server and the provider's limits. The Messages & reports part shows the kind of trouble for each failed message. When it works again, the Boss, the MD or a manager can send the reports again.", {}),
  who: msgf("The Developer; the system owner for the provider key.", {}),
  link: () => ({ href: messagesTab, label: msgf("Open Messages & reports", {}) }),
  async run(c) {
    const since = new Date(c.now.getTime() - DAY);
    const [rows, sent] = await Promise.all([
      db.notificationDelivery.findMany({ where: { status: "FAILED", updatedAt: { gte: since } }, select: { purpose: true, lastError: true }, orderBy: { updatedAt: "desc" }, take: 300 }),
      db.notificationDelivery.count({ where: { status: { in: ["SENT", "DELIVERED"] }, sentAt: { gte: since } } }),
    ]);
    // A phone number the provider does not accept is a wrong number typed for a person, not a failure of the system. (Only the KIND of trouble is read; the provider's words never leave this function.)
    const system = rows.filter((r) => deliveryErrorKind(r.lastError) !== NOT_ACCEPTED);
    const failed = system.length;
    if (failed < CHECK_LIMITS.messagesFailedLook) return { state: "ok" };
    const byPurpose = new Map<string, number>();
    for (const r of system) byPurpose.set(r.purpose, (byPurpose.get(r.purpose) ?? 0) + 1);
    return {
      // Nothing at all got through in the day: the provider is down for us. Otherwise some do, and it needs a look.
      state: sent === 0 ? "fix" : "look", count: failed, examples: codes([...byPurpose].sort((a, b) => b[1] - a[1]).map(([purpose]) => purpose)),
      summary: failed === 1 ? msgf("{n} message failed in the last 24 hours.", { n: failed }) : msgf("{n} messages failed in the last 24 hours.", { n: failed }),
    };
  },
};

function reportCheck(which: "daily" | "room"): Def {
  const daily = which === "daily";
  return {
    id: daily ? "report-daily" : "report-room", group: "Jobs & errors",
    title: daily ? msgf("The daily report reaches the Boss", {}) : msgf("The room report reaches the Boss", {}),
    allClear: daily ? msgf("The last closed day's daily report reached the Boss, or is not due yet.", {}) : msgf("The last closed day's room report reached the Boss, or is not due yet.", {}),
    what: daily
      ? msgf("The Boss gets the daily report on WhatsApp every morning. The last one is late, so the Boss is missing yesterday's figures. Either the job did not run or the send failed.", {})
      : msgf("The Boss gets the room report on WhatsApp early every morning. The last one is late. Either the job did not run or the send failed.", {}),
    todo: msgf("Find why: did the job run (the Errors & jobs part), and does WhatsApp work (the key and the recipients)? The Developer cannot make or send financial reports: the Boss, the MD or a manager sends it again from Reports once the cause is fixed.", {}),
    who: msgf("The Developer; the system owner for the provider key.", {}),
    link: (c) => link(c, "reports.view", daily ? "/staff/reports/daily" : "/staff/reports/room", msgf("Open the report", {})) ?? { href: crashesTab, label: msgf("Open Errors & jobs", {}) },
    async run(c) {
      const enabled = daily ? c.settings.reportEnabled : c.settings.reportEnabled && c.settings.roomReportEnabled;
      const hasRecipients = (((c.settings.reportRecipients as unknown as unknown[]) ?? []).length) > 0;
      if (!enabled || !hasRecipients) return { state: "ok", skipped: true, summary: msgf("Not checked here: this report is switched off or nobody is set to receive it.", {}) };
      const t = await reportTroubles(c.now);
      const trouble = daily ? t.daily : t.room;
      if (!trouble) return { state: "ok" };
      const k = trouble.kind;
      const dailyId = daily ? t.daily?.id ?? null : null;
      const reportLink = link(c, "reports.view", dailyId ? `/staff/reports/daily/${dailyId}` : daily ? "/staff/reports/daily" : "/staff/reports/room", msgf("Open the report", {}));
      return {
        state: "fix", count: 1,
        title: daily
          ? (k === "missing" ? msgf("The daily report was not made", {}) : msgf("The daily report did not reach the Boss", {}))
          : (k === "missing" ? msgf("The room report was not made", {}) : msgf("The room report did not reach the Boss", {})),
        summary: k === "missing"
          ? (daily ? msgf("It was not made at 07:00 for the day that closed.", { n: 1 }) : msgf("It was not made at 06:30 for the day that closed.", { n: 1 }))
          : k === "unsent" ? msgf("The report is saved but has not been sent yet.", { n: 1 }) : msgf("A send was tried and failed. The report is saved.", { n: 1 }),
        link: reportLink,
      };
    },
  };
}

const serverErrors: Def = {
  id: "errors-server", group: "Jobs & errors",
  title: msgf("Unexpected server errors", {}),
  allClear: msgf("No unexpected server error in the last 24 hours.", {}),
  what: msgf("Something in the code failed in a way nobody expected (a screen, an action, a route or a job). The person using it saw an error. The same error again and again is a bug that is still there.", {}),
  todo: msgf("Open the Errors & jobs part: each error is grouped with how often and when, what kind it is and where in the code. Fix the cause and deploy.", {}),
  who: WHO_DEV(),
  link: () => ({ href: crashesTab, label: msgf("Open Errors & jobs", {}) }),
  async run(c) {
    if (!c.events) return { state: "unknown", why: msgf("Could not be checked: the log of system events could not be read.", {}) };
    const since = c.now.getTime() - DAY;
    // A failure inside an automatic job or a webhook is already said (once) by the checks of the jobs and of nTZS: not counted twice here.
    const own = c.events.errorGroups.filter((g) => !g.source.startsWith("cron:") && !g.source.startsWith("webhook:"));
    const recent = own.filter((g) => g.lastSeenAt.getTime() >= since);
    if (!recent.length) return { state: "ok" };
    // One error that came once is "look". The same error again and again (counted over its whole life, and seen again in the last day) is a bug that is still there.
    const repeating = recent.some((g) => g.count >= CHECK_LIMITS.errorRepeats);
    const n = recent.length;
    return {
      state: repeating ? "fix" : "look", count: n,
      examples: codes(recent.map((g) => scrubEventText(g.source, 40))),
      summary: n === 1 ? msgf("{n} server error in the last 24 hours.", { n }) : msgf("{n} server errors in the last 24 hours.", { n }),
    };
  },
};

// ───────────────────────────────────────────── 6. set-up ─────────────────────────────────────────────
const cronSecret: Def = {
  id: "cron-secret", group: "Setup",
  title: msgf("Secret of the scheduled jobs", {}),
  allClear: msgf("The scheduled jobs have their secret.", {}),
  what: msgf("The daily report, the room report, shift reports, the checks of online payments and withdrawals and the clean-up of old sessions are started by a timer. The timer must show a secret the server knows; without one the server turns every run away, so none of it happens.", {}),
  todo: msgf("Set the cron secret in the Vercel project settings, then deploy again. This page never shows the secret itself.", {}),
  who: msgf("The Developer, in the hosting settings.", {}),
  async run(c) {
    return c.diag.cron.secretConfigured ? { state: "ok" } : { state: "fix", count: 1, title: msgf("The scheduled jobs have no secret", {}), summary: msgf("Reports and clean-up run on a timer and the server will refuse them.", { n: 1 }) };
  },
};

const siteAddress: Def = {
  id: "site-address", group: "Setup",
  title: msgf("The site's own address", {}),
  allClear: msgf("The site's address is set.", {}),
  what: msgf("Links in WhatsApp messages (a guest's stay link, a payment link, a report link) are built from the site's address. Without it a link made by a scheduled job carries the hosting's own address (…vercel.app) instead of the hotel's website.", {}),
  todo: msgf("Set NEXT_PUBLIC_SITE_URL in the Vercel project settings to the live address (https://www.vegashoteltz.com) and deploy again.", {}),
  who: msgf("The Developer, in the hosting settings.", {}),
  async run(c) {
    // Only the live site needs it: a computer used for testing builds its links from the request itself.
    if (c.diag.deployment.environment !== "production") return { state: "ok", skipped: true, summary: msgf("Only needed on the live site.", {}) };
    return process.env.NEXT_PUBLIC_SITE_URL?.trim() ? { state: "ok" } : { state: "look", count: 1, summary: msgf("The live site has no address set, so links made by scheduled jobs carry the hosting's own address.", { n: 1 }) };
  },
};

const recipients: Def = {
  id: "whatsapp-none", group: "Setup",
  title: msgf("Report recipients", {}),
  allClear: msgf("Someone is set to receive the Boss reports.", {}),
  what: msgf("The daily, room and shift reports go to the people listed as report recipients. With reports switched on and nobody listed, nothing is sent.", {}),
  todo: msgf("The Boss or the MD adds a recipient in Settings (the Developer cannot change where financial reports go).", {}),
  who: msgf("The Boss or the MD.", {}),
  link: (c) => link(c, "settings.manage", "/staff/settings", msgf("Open Settings", {})),
  async run(c) {
    if (!c.settings.reportEnabled || !c.diag.whatsapp) return { state: "ok", skipped: true, summary: msgf("Not checked here: reports are switched off.", {}) };
    return c.diag.whatsapp.recipients === 0 ? { state: "look", count: 1, title: msgf("Nobody is set to receive the Boss reports", {}), summary: msgf("Reports are switched on but the list of recipients is empty.", { n: 1 }) } : { state: "ok" };
  },
};

const whatsappKeys: Def = {
  id: "whatsapp-keys", group: "Setup",
  title: msgf("WhatsApp keys of the recipients", {}),
  allClear: msgf("Every report recipient can be reached.", {}),
  what: msgf("The Boss reports go by WhatsApp (CallMeBot). A recipient can only be reached when their own key is set on the server, or when the default key is set.", {}),
  todo: msgf("Set the missing key in the server settings on Vercel, or ask the Boss to check the recipient's number and key name. This page never shows a key.", {}),
  who: msgf("The Developer, in the hosting settings; the system owner for the provider account.", {}),
  link: (c) => link(c, "settings.manage", "/staff/settings", msgf("Open Settings", {})),
  async run(c) {
    const w = c.diag.whatsapp;
    if (!c.settings.reportEnabled || !w || w.recipients === 0) return { state: "ok", skipped: true, summary: msgf("Not checked here: reports are switched off or nobody is set to receive them.", {}) };
    if (w.recipientsReady >= w.recipients) return { state: "ok" };
    return { state: "look", count: w.recipients - w.recipientsReady, title: msgf("WhatsApp cannot reach everyone", {}), summary: msgf("{ready} of {total} recipients can be reached.", { ready: w.recipientsReady, total: w.recipients, n: w.recipients - w.recipientsReady }) };
  },
};

const ntzsKey: Def = {
  id: "ntzs-off", group: "Setup",
  title: msgf("The nTZS key", {}),
  allClear: msgf("Online payment has what it needs, or is switched off.", {}),
  what: msgf("Pay online is switched on in the settings, but the server has no nTZS key to talk to nTZS with, so customers who press it get an error.", {}),
  todo: msgf("Set the nTZS key in the server settings on Vercel and deploy again, or ask the MD to switch online payment off.", {}),
  who: msgf("The Developer, in the hosting settings; the system owner for the nTZS account.", {}),
  link: (c) => link(c, "settings.manage", "/staff/settings", msgf("Open Settings", {})),
  async run(c) {
    return c.settings.onlinePayEnabled && !c.diag.ntzs.configured ? { state: "fix", count: 1, title: msgf("Online payment (nTZS) is switched on but not set up", {}), summary: msgf("The server has no nTZS key, so customers cannot pay online.", { n: 1 }) } : { state: "ok" };
  },
};

const ntzsWebhookSecret: Def = {
  id: "ntzs-webhook", group: "Setup",
  title: msgf("The nTZS webhook secret", {}),
  allClear: msgf("The nTZS webhook secret is set.", {}),
  what: msgf("nTZS tells the system about a payment through a signed message. Without the webhook secret those messages are refused, so a payment is only found when the system next asks nTZS — a delay for the customer.", {}),
  todo: msgf("Set the nTZS webhook secret in the server settings on Vercel and deploy again.", {}),
  who: msgf("The Developer, in the hosting settings.", {}),
  async run(c) {
    return c.diag.ntzs.configured && !c.diag.ntzs.webhookSecret ? { state: "look", count: 1, title: msgf("The nTZS webhook secret is missing", {}), summary: msgf("Payments are found by asking nTZS, not by nTZS telling us.", { n: 1 }) } : { state: "ok" };
  },
};

const paymentAccount: Def = {
  id: "payment-account", group: "Setup",
  title: msgf("A payment account", {}),
  allClear: msgf("There is a payment account that takes payments.", {}),
  what: msgf("Every payment is recorded into one of the hotel's payment accounts (cash, mobile money, bank). With none that takes payments, no payment can be recorded at all.", {}),
  todo: msgf("The Boss or the MD adds or switches on a payment account under Finance → Accounts (the Developer never touches money settings).", {}),
  who: msgf("The Boss or the MD.", {}),
  link: (c) => link(c, "finance.view", "/staff/finance/accounts", msgf("Open Accounts", {})),
  async run() {
    const n = await db.moneyAccount.count({ where: { isActive: true, acceptsPayments: true } });
    return n > 0 ? { state: "ok" } : { state: "fix", count: 1, summary: msgf("No payment account takes payments.", { n: 1 }) };
  },
};

const migrationsFailed: Def = {
  id: "migrations", group: "Setup",
  title: msgf("Database updates finished", {}),
  allClear: msgf("Every database update that was started finished.", {}),
  what: msgf("The database is changed by numbered updates. One was started and did not finish, or was undone, so the database may not match the code that is running.", {}),
  todo: msgf("Do not deploy anything else until it is looked at. Check the update log, fix the cause, then run the database update step again.", {}),
  who: WHO_DEV(),
  async run(c) {
    const m = c.diag.migrations;
    if (!m) return { state: "unknown", why: msgf("Could not be checked: the database's update log could not be read.", {}) };
    if (m.failed === 0 && m.rolledBack === 0) return { state: "ok" };
    return { state: "fix", count: m.failed + m.rolledBack, summary: msgf("{failed} not finished, {back} undone.", { failed: m.failed, back: m.rolledBack, n: m.failed + m.rolledBack }) };
  },
};

const migrationsPending: Def = {
  id: "migrations-pending", group: "Setup",
  title: msgf("Database is up to date with the code", {}),
  allClear: msgf("Every database update in the code has been applied.", {}),
  what: msgf("The code carries numbered database updates. Some of them have not been applied to this database, so the code may use a table or a column that is not there yet and fail.", {}),
  todo: msgf("Run the database update step (migrate deploy) against this database, then check again.", {}),
  who: WHO_DEV(),
  async run() {
    let folders: string[];
    try {
      const dir = path.join(process.cwd(), "prisma", "migrations");
      folders = (await readdir(dir, { withFileTypes: true })).filter((d) => d.isDirectory()).map((d) => d.name);
    } catch {
      return { state: "unknown", why: msgf("Could not be checked: the migration folders are not on this server.", {}) };
    }
    const done = await db.$queryRaw<{ name: string }[]>`SELECT migration_name AS name FROM _prisma_migrations WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    const have = new Set(done.map((d) => d.name));
    const pending = folders.filter((f) => !have.has(f)).sort();
    if (!pending.length) return { state: "ok" };
    return {
      state: "fix", count: pending.length, examples: codes(pending.slice(0, CHECK_LIMITS.examples)),
      summary: pending.length === 1 ? msgf("{n} database update in the code has not been applied.", { n: pending.length }) : msgf("{n} database updates in the code have not been applied.", { n: pending.length }),
    };
  },
};

// ───────────────────────────────────────────── 7. accounts and rights, and security ─────────────────────────────────────────────
const bossAccount: Def = {
  id: "boss-account", group: "People",
  title: msgf("An active Boss account", {}),
  allClear: msgf("There is an active Boss account.", {}),
  what: msgf("The Boss receives the reports and the warnings about the Developer's work. With no active Boss account nobody is told, and nobody holds the top authority.", {}),
  todo: msgf("Add a Boss account from Access → Add an account, or ask the MD to switch the Boss's account back on.", {}),
  who: msgf("The Developer (Add an account) or the MD.", {}),
  link: () => ({ href: CONSOLE_HREF.access, label: msgf("Open Access", {}) }),
  async run() {
    const n = await db.user.count({ where: { isActive: true, role: { code: "OWNER" } } });
    return n > 0 ? { state: "ok" } : { state: "fix", count: 1, summary: msgf("No Boss account is switched on.", { n: 1 }) };
  },
};

const rolesNoRights: Def = {
  id: "roles-no-rights", group: "People",
  title: msgf("Roles with no rights", {}),
  allClear: msgf("Every role that has people holds some rights.", {}),
  what: msgf("A role holds no rights at all, yet people with that role are switched on. They can sign in but can do nothing, usually because the role's rights were lost in an update or a set-up step.", {}),
  todo: msgf("The Boss or the MD gives the role its rights in Staff & roles (the Developer cannot change roles or rights). Find out what removed them so it does not happen again.", {}),
  who: msgf("The Boss or the MD; the Developer finds the cause.", {}),
  // (no link: the page that fixes it needs a right the Developer never holds)
  async run() {
    const roles = await db.role.findMany({
      where: { code: { not: SYSTEM_ROLE }, permissions: { none: {} }, users: { some: { isActive: true } } },
      select: { code: true }, orderBy: { code: "asc" }, take: 20,
    });
    if (!roles.length) return { state: "ok" };
    return {
      state: "fix", count: roles.length, examples: codes(roles.map((r) => r.code)),
      summary: roles.length === 1 ? msgf("{n} role with people in it holds no rights.", { n: roles.length }) : msgf("{n} roles with people in them hold no rights.", { n: roles.length }),
    };
  },
};

const failedSignIns: Def = {
  id: "failed-sign-ins", group: "People",
  title: msgf("Failed sign-ins", {}),
  allClear: msgf("Failed sign-ins are at a normal level.", {}),
  what: msgf("A few typing mistakes a day are normal. Many in one day can mean someone is guessing passwords. The sign-in limits stop the guessing, but it is worth knowing.", {}),
  todo: msgf("Open the Errors & jobs part to see which accounts were tried and how often. If one account is tried again and again, tell the Boss or the MD.", {}),
  who: msgf("The Developer, with the Boss or the MD if an account is being attacked.", {}),
  link: () => ({ href: crashesTab, label: msgf("Open Errors & jobs", {}) }),
  async run(c) {
    const n = await db.auditLog.count({ where: { action: "auth.login_failed", createdAt: { gte: new Date(c.now.getTime() - DAY) } } });
    if (n <= CHECK_LIMITS.failedSignInsLook) return { state: "ok", summary: msgf("{n} in 24 hours, which is normal.", { n }) };
    return { state: "look", count: n, summary: msgf("{n} failed sign-ins in 24 hours.", { n }) };
  },
};

const developerRefusals: Def = {
  id: "denied", group: "People",
  title: msgf("Refusals to the Developer", {}),
  allClear: msgf("The Developer account was not refused more than a few times.", {}),
  what: msgf("A page or an action was refused to the Developer account several times. For money this is by design — the Developer never writes money. Many refusals can mean a screen or a script keeps reaching for something it must not.", {}),
  todo: msgf("See the list in the Errors & jobs part: it shows what was refused and which right it needed. Nothing is broken unless the same thing is tried again and again.", {}),
  who: WHO_DEV(),
  link: () => ({ href: crashesTab, label: msgf("Open Errors & jobs", {}) }),
  async run(c) {
    const n = await db.auditLog.count({ where: { action: "developer.denied", createdAt: { gte: new Date(c.now.getTime() - DAY) } } });
    if (n < CHECK_LIMITS.deniedLook) return { state: "ok", summary: msgf("{n} in 24 hours.", { n }) };
    return { state: "look", count: n, summary: msgf("{n} Developer actions were refused in 24 hours.", { n }) };
  },
};

/** Every check, in the order they are listed. */
export const DEFINITIONS: readonly Def[] = [
  serverErrors, jobsOverdue, jobsFailed, webhooksFailing, webhooksSilent, messagesFailing, reportCheck("daily"), reportCheck("room"),
  roomOccupiedNoStay, stayRoomNotOccupied, roomTwoStays,
  reservationTotals, orderPayments, onlinePending, withdrawalsStuck,
  stockMovements, auditProtected, holdsNotReleased,
  cronSecret, siteAddress, recipients, whatsappKeys, ntzsKey, ntzsWebhookSecret, paymentAccount, migrationsFailed, migrationsPending,
  bossAccount, rolesNoRights, failedSignIns, developerRefusals,
];

/** The ids of every check (a test and the page read them). */
export const CHECK_IDS: readonly string[] = DEFINITIONS.map((d) => d.id);

// ───────────────────────────────────────────── running them ─────────────────────────────────────────────
function withTimeout<T>(run: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const late = new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("timeout")), ms); });
  return Promise.race([run, late]).finally(() => clearTimeout(timer));
}

async function runOne(def: Def, c: Ctx, deadline: number): Promise<CheckResult> {
  const base = { id: def.id, group: def.group, title: def.title, what: def.what, todo: def.todo, who: def.who };
  try {
    // Each check has its own limit, and all of them together have one: the page never waits longer than CHECK_LIMITS.totalMs.
    const out = await withTimeout(def.run(c), Math.max(0, Math.min(CHECK_LIMITS.timeoutMs, deadline - Date.now())));
    if (out.state === "ok") return { ...base, state: "ok", count: 0, summary: out.summary ?? def.allClear, link: def.link?.(c), ...(out.skipped && { skipped: true }) };
    if (out.state === "unknown") return { ...base, state: "unknown", count: 0, summary: out.why };
    return {
      ...base, state: out.state, count: out.count, summary: out.summary,
      ...(out.title && { title: out.title }), ...(out.what && { what: out.what }), ...(out.todo && { todo: out.todo }), ...(out.who && { who: out.who }),
      link: out.link === undefined ? def.link?.(c) : out.link ?? undefined,
      ...(out.examples && out.examples.length > 0 && { examples: out.examples.slice(0, CHECK_LIMITS.examples) }),
    };
  } catch {
    // The reason is never the error's own text (it can hold a value): only that the check could not read what it needed.
    return { ...base, state: "unknown", count: 0, summary: msgf("Could not be checked: the check could not read what it needs.", {}) };
  }
}

async function inPool<T, R>(items: readonly T[], size: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(size, items.length) }, async () => {
    for (;;) {
      const i = next++;
      if (i >= items.length) return;
      out[i] = await fn(items[i]);
    }
  }));
  return out;
}

/**
 * One cause is shown (and counted) once. A missing cron secret, or a missing nTZS key, is also why other checks go red: the jobs do not
 * run, the reports are late, the holds are not released. While the cause is a "fix", the checks that follow from it are set aside
 * (skipped, with the reason) so the page shows one card for it, not six; when it is fixed they are checked again.
 */
const FOLLOWS: Record<string, readonly string[]> = {
  "cron-secret": ["jobs-overdue", "jobs-failed", "report-daily", "report-room", "holds-not-released", "online-pending", "withdrawals"],
  "ntzs-off": ["webhooks-failing", "webhooks-silent", "online-pending", "withdrawals"],
};

function followFromCause(results: CheckResult[]): CheckResult[] {
  const causes = new Set(results.filter((r) => r.state === "fix" && FOLLOWS[r.id]).map((r) => r.id));
  if (causes.size === 0) return results;
  const covered = new Set([...causes].flatMap((id) => FOLLOWS[id]));
  return results.map((r) => (covered.has(r.id) && (r.state === "fix" || r.state === "look")
    ? { id: r.id, group: r.group, title: r.title, what: r.what, todo: r.todo, who: r.who, state: "ok" as const, count: 0, skipped: true, summary: msgf("Not counted again: it follows from a problem above.", {}) }
    : r));
}

export interface RunOptions {
  /** Already read by the caller (the health report reads them once for all of its parts). */
  diag?: Diagnostics;
  events?: SystemEvents | null;
}

/**
 * Every system check, now. Developer only (the same door as the rest of the console). A check that fails becomes "unknown" and never
 * breaks the others. Nothing is written. Results are in the order of DEFINITIONS; the page groups them by state.
 */
export async function runChecks(developer: ConsoleUser, now = new Date(), opts: RunOptions = {}): Promise<CheckResult[]> {
  assertConsoleAccess(developer);
  const settings = await getSettings();
  const diag = opts.diag ?? (await systemDiagnostics(developer, now));
  const events = opts.events !== undefined ? opts.events : await loadSystemEvents(developer as Parameters<typeof loadSystemEvents>[0], now).catch(() => null);
  const ctx: Ctx = { user: developer, now, settings, diag, events };
  const deadline = Date.now() + CHECK_LIMITS.totalMs;
  return followFromCause(await inPool(DEFINITIONS, CHECK_LIMITS.parallel, (def) => runOne(def, ctx, deadline)));
}
