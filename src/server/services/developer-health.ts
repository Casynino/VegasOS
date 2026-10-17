import "server-only";
import { db } from "../db";
import { businessDayConfig, getSettings } from "../settings";
import { Prisma } from "@/generated/prisma/client";
import { msg, msgf, type Localized } from "@/i18n/msg";
import { formatMinutesLabel } from "@/lib/format";
import { addDays, businessDateOf, businessDayBounds, businessRangeBounds, eachDate, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { deviceLabel } from "@/lib/device-label";
import { DEVELOPER_ROLE_CODE, type PermissionCode } from "@/lib/permissions";
import {
  assertConsoleAccess, NOT_WORK_ACTIONS, recentDenied, safe, short, systemDiagnostics, type ConsoleUser, type DeniedEntry,
} from "./developer-console";
import { DEVELOPER_TRIES, DEVELOPER_WINDOW_SECONDS } from "./auth-login";
import { reportTroubles } from "./report-health";
import { SYSTEM_ROLE } from "./staff-accounts";

/**
 * WHAT THE DEVELOPER CONSOLE MEASURES (owner, 2026-10-17): the health of the system, who is using it, how fast the database is and
 * who failed to sign in. Everything here is built from FACTS found in the database or in the server's set-up (a key is "set" or "not
 * set" — never what it is). Nothing is invented: a part that cannot be read is left out and the rest still shows.
 *
 * Every function checks, again, that the caller is the Developer account holding "developer.access" and not working as someone else
 * (assertConsoleAccess). Every query is bounded: a date window, a `take`, a count — never a scan of a whole table into memory.
 *
 * Days are the hotel's own days (04:00 → 04:00, from the settings); "hours of the day" are the hotel's wall-clock hours.
 */

const HOUR = 3600_000;
const DAY = 24 * HOUR;

// ───────────────────────────────────────────── 1. the health score ─────────────────────────────────────────────
/**
 * THE SCORE RULE (kept this simple on purpose — the console explains it under "How is this worked out?"):
 *   start at 100
 *   the database does not answer          −60   (its own card is NOT counted again as a "fix now")
 *   each "fix now" item                   −10
 *   each "look at" item                    −5
 *   "for information" items                −0
 *   never below 0
 */
export const SCORE = { start: 100, databaseOffline: 60, fixNow: 10, lookAt: 5 } as const;
/** The id of the card that says the database does not answer (its cost is the −60, not an extra −10). */
export const DATABASE_ITEM_ID = "database";

export type Severity = "fix" | "look" | "info";
export type Verdict = "offline" | "fix" | "look" | "well";

export function healthScore(input: { databaseOnline: boolean; items: { id: string; severity: Severity }[] }): number {
  let score: number = SCORE.start;
  if (!input.databaseOnline) score -= SCORE.databaseOffline;
  for (const it of input.items) {
    if (it.id === DATABASE_ITEM_ID) continue;
    if (it.severity === "fix") score -= SCORE.fixNow;
    else if (it.severity === "look") score -= SCORE.lookAt;
  }
  return Math.max(0, score);
}

export function healthVerdict(databaseOnline: boolean, counts: { fix: number; look: number }): Verdict {
  return !databaseOnline ? "offline" : counts.fix > 0 ? "fix" : counts.look > 0 ? "look" : "well";
}

// ───────────────────────────────────────────── 2. the attention items ─────────────────────────────────────────────
export interface HealthItem {
  id: string;
  severity: Severity;
  title: Localized;
  /** One line, shown on the closed card. */
  summary: Localized;
  /** What it means, in plain words. */
  what: Localized;
  /** What to do about it, and who does it. */
  todo: Localized;
  /** A page that helps — only when this Developer may open it (never a link that would be refused). */
  link: { href: string; label: Localized } | null;
}

/** An open reception or waiter shift older than this is probably forgotten (the Boss's home uses the same 14 hours). */
export const SHIFT_OPEN_LIMIT_HOURS = 14;
/** Something waiting for a person for longer than this is an "alert waiting". */
export const ALERT_WAITING_HOURS = 24;
/** An account made more than this many days ago that never signed in is worth a word. */
export const NEVER_SIGNED_IN_DAYS = 3;
/** A "work as" session open longer than this is mentioned (the 4-hour cap ends it by itself). */
export const WORK_AS_LONG_MINUTES = 60;
/** An unsettled withdrawal older than this is a "fix now" (nTZS normally answers within seconds). */
export const WITHDRAWAL_STUCK_MINUTES = 30;
/**
 * Wrong tries in 15 minutes before a sign-in is paused. The Developer account's own lock is read from where it is enforced
 * (services/auth-login.ts); the shared limits per email and per address are the numbers written in src/app/staff/(auth)/login/actions.ts.
 */
export const LOGIN_LIMITS = { developerEmail: DEVELOPER_TRIES, staffEmail: 8, staffPlace: 20, windowMinutes: DEVELOPER_WINDOW_SECONDS / 60 } as const;

export interface HealthReport {
  checkedAt: Date;
  database: { online: boolean; ms: number | null };
  /** Distinct people who signed in during the hotel's day today. null = could not be read. */
  signedInToday: number | null;
  /** Real work saved in the last 24 hours (sign-ins and the Developer's own looking are not work). null = could not be read. */
  actionsToday: number | null;
  /** Things waiting more than a day for a person: guest requests and stock requests. null = could not be read. */
  alerts: { total: number; guestRequests: number; stockRequests: number } | null;
  failedSignIns24h: number | null;
  /** Fix now first, then look at, then for information. */
  items: HealthItem[];
  counts: { fix: number; look: number; info: number };
  score: number;
  verdict: Verdict;
}

const link = (user: ConsoleUser, needs: PermissionCode, href: string, label: Localized): HealthItem["link"] => (user.permissions.has(needs) ? { href, label } : null);

/** A name list for a sentence: "Asha, Juma and 2 more". */
function nameList(names: string[], total: number): string {
  const shown = names.slice(0, 3);
  const rest = total - shown.length;
  return rest > 0 ? `${shown.join(", ")} +${rest}` : shown.join(", ");
}

export async function healthReport(user: ConsoleUser, now = new Date()): Promise<HealthReport> {
  assertConsoleAccess(user);
  const settings = await getSettings();
  const cfg = businessDayConfig(settings);
  const today = businessDateOf(now, cfg);
  const dayBounds = businessDayBounds(today, cfg);
  const since24 = new Date(now.getTime() - DAY);

  const diag = await systemDiagnostics(user, now);
  const online = diag.database.reachable;

  // Everything else needs the database: when it does not answer, only that card is shown.
  const facts = online ? await Promise.all([
    safe(() => reportTroubles(now)),
    safe(() => db.mobilePayment.count({ where: { attentionAt: { not: null }, resolvedAt: null } })),
    safe(() => db.withdrawal.count({
      where: { OR: [
        { status: { in: ["SUBMITTING", "UNKNOWN"] }, createdAt: { lt: new Date(now.getTime() - WITHDRAWAL_STUCK_MINUTES * 60_000) } },
        { attentionAt: { not: null }, reconciledAt: null },
      ] },
    })),
    safe(() => db.actualShift.findMany({
      where: { endedAt: null, startedAt: { lt: new Date(now.getTime() - SHIFT_OPEN_LIMIT_HOURS * HOUR) } },
      select: { department: true, user: { select: { fullName: true } } }, orderBy: { startedAt: "asc" }, take: 20,
    })),
    safe(async () => {
      const cutoff = new Date(now.getTime() - ALERT_WAITING_HOURS * HOUR);
      const [guestRequests, stockRequests] = await Promise.all([
        db.serviceRequest.count({ where: { status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS"] }, createdAt: { lt: cutoff } } }),
        db.stockRequest.count({ where: { status: { in: ["SUBMITTED", "PENDING_APPROVAL"] }, updatedAt: { lt: cutoff } } }),
      ]);
      return { total: guestRequests + stockRequests, guestRequests, stockRequests };
    }),
    safe(() => db.auditLog.count({ where: { action: "auth.login_failed", createdAt: { gte: since24 } } })),
    safe(() => db.auditLog.count({ where: { action: "developer.denied", createdAt: { gte: since24 } } })),
    safe(async () => {
      const cutoff = new Date(now.getTime() - NEVER_SIGNED_IN_DAYS * DAY);
      const rows = await db.user.findMany({
        where: { isActive: true, lastLoginAt: null, createdAt: { lt: cutoff }, role: { code: { notIn: [DEVELOPER_ROLE_CODE, SYSTEM_ROLE] } } },
        select: { fullName: true }, orderBy: { createdAt: "asc" }, take: 50,
      });
      return rows.map((r) => r.fullName);
    }),
    safe(() => db.session.findMany({ where: { workAsUserId: { not: null } }, select: { workAsStartedAt: true }, take: 50 })),
    safe(() => db.auditLog.count({ where: { action: "developer.work_as_started", createdAt: { gte: since24 } } })),
    safe(async () => {
      const [logins, sessions] = await Promise.all([
        db.auditLog.findMany({ where: { action: "auth.login", createdAt: { gte: dayBounds.start, lt: dayBounds.end } }, select: { userId: true }, take: 2000 }),
        db.session.findMany({ where: { createdAt: { gte: dayBounds.start, lt: dayBounds.end } }, select: { userId: true }, take: 2000 }),
      ]);
      return new Set([...logins.map((l) => l.userId), ...sessions.map((s) => s.userId)].filter((id): id is string => !!id)).size;
    }),
    safe(() => db.auditLog.count({
      where: {
        createdAt: { gte: since24 }, businessDate: { gte: toDbDate(addDays(today, -2)), lte: toDbDate(addDays(today, 1)) },
        actorType: { in: ["STAFF", "DEVELOPER"] }, action: { notIn: [...NOT_WORK_ACTIONS] },
      },
    })),
  ]) : null;
  const [troubles, mobileNeedPerson, withdrawalsStuck, longShifts, alerts, failedSignIns, denied24, neverSignedIn, workAsOpen, workAsStarted24, signedInToday, actionsToday] =
    facts ?? [null, null, null, null, null, null, null, null, null, null, null, null];

  const items: HealthItem[] = [];
  const add = (it: HealthItem) => items.push(it);

  // ── fix now ──
  if (!online) {
    add({
      id: DATABASE_ITEM_ID, severity: "fix",
      title: msgf("The database is not answering", {}),
      summary: msgf("Nothing can be read or saved until it answers.", {}),
      what: msgf("All of the hotel's records live in the database. The console just asked it a trivial question and got no answer.", {}),
      todo: msgf("Look at the database provider's status page and the connection setting on Vercel. Staff cannot work until it is back.", {}),
      link: null,
    });
  }
  if (troubles?.daily) {
    const k = troubles.daily.kind;
    add({
      id: "report-daily", severity: "fix",
      title: k === "missing" ? msgf("The daily report was not made", {}) : msgf("The daily report did not reach the Boss", {}),
      summary: k === "missing" ? msgf("It was not made at 07:00 for the day that closed.", {}) : k === "unsent" ? msgf("The report is saved but has not been sent yet.", {}) : msgf("A send was tried and failed. The report is saved.", {}),
      what: msgf("The Boss gets the daily report on WhatsApp every morning. This one is late, so the Boss is missing yesterday's figures.", {}),
      todo: msgf("Ask the Boss, the MD or a manager to make or send it again from Reports (the Developer cannot make or send financial reports). If it keeps failing, check the WhatsApp key and the recipients.", {}),
      link: link(user, "reports.view", troubles.daily.id ? `/staff/reports/daily/${troubles.daily.id}` : "/staff/reports/daily", msgf("Open the report", {})),
    });
  }
  if (troubles?.room) {
    const k = troubles.room.kind;
    add({
      id: "report-room", severity: "fix",
      title: k === "missing" ? msgf("The room report was not made", {}) : msgf("The room report did not reach the Boss", {}),
      summary: k === "missing" ? msgf("It was not made at 06:30 for the day that closed.", {}) : k === "unsent" ? msgf("The report is saved but has not been sent yet.", {}) : msgf("A send was tried and failed. The report is saved.", {}),
      what: msgf("The Boss gets the room report on WhatsApp early every morning. This one is late.", {}),
      todo: msgf("Ask the Boss, the MD or a manager to make or send it again from Reports. If it keeps failing, check the WhatsApp key and the recipients.", {}),
      link: link(user, "reports.view", "/staff/reports/room", msgf("Open the report", {})),
    });
  }
  if (online && !diag.cron.secretConfigured) {
    add({
      id: "cron-secret", severity: "fix",
      title: msgf("The scheduled jobs have no secret", {}),
      summary: msgf("Reports and clean-up run on a timer and the server will refuse them.", {}),
      what: msgf("The daily report, the room report, shift reports and the clean-up of old sessions are started by a timer. The timer must show a secret the server knows; without one the server turns every run away, so none of it happens.", {}),
      todo: msgf("Set the cron secret in the Vercel project settings, then deploy again. This page never shows the secret itself.", {}),
      link: null,
    });
  }
  if (mobileNeedPerson) {
    add({
      id: "mobile-payments", severity: "fix",
      title: mobileNeedPerson === 1 ? msgf("{n} mobile payment needs a person", { n: mobileNeedPerson }) : msgf("{n} mobile payments need a person", { n: mobileNeedPerson }),
      summary: msgf("Money came in that the system could not record by itself.", {}),
      what: msgf("A customer paid by mobile money but the payment could not be matched on its own — more than was owed, the bill changed, or it could not be recorded. It stays on the list until someone settles it.", {}),
      todo: msgf("Finance, the Boss or the MD settles it under Online payments. The Developer never touches money.", {}),
      link: null,
    });
  }
  if (withdrawalsStuck) {
    add({
      id: "withdrawals", severity: "fix",
      title: withdrawalsStuck === 1 ? msgf("{n} withdrawal is not settled", { n: withdrawalsStuck }) : msgf("{n} withdrawals are not settled", { n: withdrawalsStuck }),
      summary: msgf("Nobody knows yet whether nTZS paid it out.", {}),
      what: msgf("A withdrawal was sent to nTZS and its answer has not come, or it needs a person to settle it. No new withdrawal can be made until this one is settled.", {}),
      todo: msgf("The Boss or Finance checks it under Withdrawals and settles it from what nTZS shows.", {}),
      link: null,
    });
  }
  const m = diag.migrations;
  if (m && (m.failed > 0 || m.rolledBack > 0)) {
    add({
      id: "migrations", severity: "fix",
      title: msgf("A database update did not finish", {}),
      summary: msgf("{failed} not finished, {back} undone.", { failed: m.failed, back: m.rolledBack }),
      what: msgf("The database is changed by numbered updates. One was started and did not finish, or was undone, so the database may not match the code that is running.", {}),
      todo: msgf("Do not deploy anything else until it is looked at. Check the update log, fix the cause, then run the database update step again.", {}),
      link: null,
    });
  }

  // ── look at ──
  if (longShifts && longShifts.length > 0) {
    const names = [...new Set(longShifts.map((s) => s.user.fullName.replace(/\s*\(.*\)/, "")))];
    add({
      id: "shifts-long", severity: "look",
      title: longShifts.length === 1 ? msgf("{n} shift has been open over {h} hours", { n: longShifts.length, h: SHIFT_OPEN_LIMIT_HOURS }) : msgf("{n} shifts have been open over {h} hours", { n: longShifts.length, h: SHIFT_OPEN_LIMIT_HOURS }),
      summary: msgf("Still open: {names}.", { names: nameList(names, names.length) }),
      what: msgf("A reception or waiter shift is still open long after a normal shift would end. Most likely it was forgotten. A reception shift that stays open holds one of the two places at the desk.", {}),
      todo: msgf("Ask the person to close it, or let a manager close it with a reason.", {}),
      link: link(user, "shifts.view", "/staff/shifts/all", msgf("Open Shifts", {})),
    });
  }
  const w = diag.whatsapp;
  if (online && w && settings.reportEnabled) {
    if (w.recipients === 0) {
      add({
        id: "whatsapp-none", severity: "look",
        title: msgf("Nobody is set to receive the Boss reports", {}),
        summary: msgf("Reports are switched on but the list of recipients is empty.", {}),
        what: msgf("The daily, room and shift reports go to the people listed as report recipients. With nobody listed, nothing is sent.", {}),
        todo: msgf("The Boss or the MD adds a recipient in Settings (the Developer cannot change where financial reports go).", {}),
        link: null,
      });
    } else if (w.recipientsReady < w.recipients) {
      add({
        id: "whatsapp-keys", severity: "look",
        title: msgf("WhatsApp cannot reach everyone", {}),
        summary: msgf("{ready} of {total} recipients can be reached.", { ready: w.recipientsReady, total: w.recipients }),
        what: msgf("The Boss reports go by WhatsApp (CallMeBot). A recipient can only be reached when their own key is set on the server, or when the default key is set.", {}),
        todo: msgf("Set the missing key in the server settings on Vercel, or ask the Boss to check the recipient's number and key name. This page never shows a key.", {}),
        link: null,
      });
    }
  }
  if (online && !diag.ntzs.configured && settings.onlinePayEnabled) {
    add({
      id: "ntzs-off", severity: "look",
      title: msgf("Online payment (nTZS) is switched on but not set up", {}),
      summary: msgf("The server has no nTZS key, so customers cannot pay online.", {}),
      what: msgf("Pay online is switched on in the settings, but the server has no nTZS key to talk to nTZS with.", {}),
      todo: msgf("Set the nTZS key in the server settings on Vercel and deploy again, or ask the MD to switch online payment off.", {}),
      link: null,
    });
  } else if (online && diag.ntzs.configured && !diag.ntzs.webhookSecret) {
    add({
      id: "ntzs-webhook", severity: "look",
      title: msgf("The nTZS webhook secret is missing", {}),
      summary: msgf("Payments are found by asking nTZS, not by nTZS telling us.", {}),
      what: msgf("nTZS tells the system about a payment through a signed message. Without the webhook secret those messages are refused, so a payment is only found when the system next asks nTZS — a delay for the customer.", {}),
      todo: msgf("Set the nTZS webhook secret in the server settings on Vercel and deploy again.", {}),
      link: null,
    });
  }
  const failedMessages = online ? diag.counts?.failedMessages24h ?? 0 : 0;
  if (failedMessages > 0) {
    add({
      id: "deliveries-failed", severity: "look",
      title: failedMessages === 1 ? msgf("{n} message failed in the last 24 hours", { n: failedMessages }) : msgf("{n} messages failed in the last 24 hours", { n: failedMessages }),
      summary: msgf("WhatsApp messages that were tried and did not go.", {}),
      what: msgf("Each failed message is kept with its error. The usual causes are a missing or wrong provider key, or a phone number the provider could not reach.", {}),
      todo: msgf("Check the WhatsApp key and the phone numbers. Reports can be sent again by the Boss, the MD or a manager.", {}),
      link: link(user, "reports.view", "/staff/reports", msgf("Open Reports", {})),
    });
  }
  if (alerts && alerts.total > 0) {
    add({
      id: "alerts-waiting", severity: "look",
      title: alerts.total === 1 ? msgf("{n} request has been waiting over a day", { n: alerts.total }) : msgf("{n} requests have been waiting over a day", { n: alerts.total }),
      summary: msgf("Guest requests: {guests}. Stock requests: {stock}. Nobody has dealt with them.", { guests: alerts.guestRequests, stock: alerts.stockRequests }),
      what: msgf("These ask someone to act — a guest request still open, a stock request or a purchase waiting for a decision — and a day has gone by. A request nobody answers is usually a person who does not know it is there.", {}),
      todo: msgf("Tell the person who handles it, or ask a manager to assign it.", {}),
      link: alerts.guestRequests >= alerts.stockRequests ? link(user, "requests.view", "/staff/requests", msgf("Open Requests", {})) : link(user, "inventory.request", "/staff/stock-requests", msgf("Open Stock requests", {})),
    });
  }

  // ── for information ──
  if (online && !diag.ntzs.configured && !settings.onlinePayEnabled) {
    add({
      id: "ntzs-not-set", severity: "info",
      title: msgf("Online payment (nTZS) is not set up", {}),
      summary: msgf("It is switched off, so nothing is wrong.", {}),
      what: msgf("The server has no nTZS key and online payment is off in the settings, so customers pay at the hotel.", {}),
      todo: msgf("Nothing to do unless the hotel wants to take online payments.", {}),
      link: null,
    });
  }
  if (failedSignIns) {
    add({
      id: "failed-sign-ins", severity: "info",
      title: failedSignIns === 1 ? msgf("{n} failed sign-in in 24 hours", { n: failedSignIns }) : msgf("{n} failed sign-ins in 24 hours", { n: failedSignIns }),
      summary: msgf("Wrong-password tries. After {dev} wrong tries in 15 minutes a Developer sign-in is paused ({staff} for staff).", { dev: LOGIN_LIMITS.developerEmail, staff: LOGIN_LIMITS.staffEmail }),
      what: msgf("A few typing mistakes are normal. Many in a day can mean someone is guessing passwords. The table on the Crashes and sign-ins tab shows which accounts were tried and how often.", {}),
      todo: msgf("If one account is tried again and again, tell the person and ask them to change their password.", {}),
      link: null,
    });
  }
  if (neverSignedIn && neverSignedIn.length > 0) {
    add({
      id: "never-signed-in", severity: "info",
      title: neverSignedIn.length === 1 ? msgf("{n} account has never signed in", { n: neverSignedIn.length }) : msgf("{n} accounts have never signed in", { n: neverSignedIn.length }),
      summary: msgf("Made over {days} days ago: {names}.", { days: NEVER_SIGNED_IN_DAYS, names: nameList(neverSignedIn, neverSignedIn.length) }),
      what: msgf("These staff accounts are active but nobody has used them. They may have lost their login details, or the person may not need an account.", {}),
      todo: msgf("Ask the person to sign in, or switch the account off if it is not needed.", {}),
      link: null,
    });
  }
  if (denied24) {
    add({
      id: "denied", severity: "info",
      title: denied24 === 1 ? msgf("{n} Developer action was refused in 24 hours", { n: denied24 }) : msgf("{n} Developer actions were refused in 24 hours", { n: denied24 }),
      summary: msgf("The Developer role does not hold the right they needed.", {}),
      what: msgf("A page or an action was refused to a Developer account. For money this is by design — the Developer never writes money. If it surprised you, the list shows which right was needed.", {}),
      todo: msgf("See the list on the Crashes and sign-ins tab. Nothing is broken.", {}),
      link: null,
    });
  }
  const longWorkAs = (workAsOpen ?? []).filter((s) => s.workAsStartedAt && now.getTime() - s.workAsStartedAt.getTime() > WORK_AS_LONG_MINUTES * 60_000);
  if (longWorkAs.length > 0) {
    const oldest = Math.max(...longWorkAs.map((s) => Math.floor((now.getTime() - s.workAsStartedAt!.getTime()) / 60_000)));
    add({
      id: "work-as-long", severity: "info",
      title: longWorkAs.length === 1 ? msgf("{n} work-as session has run over an hour", { n: longWorkAs.length }) : msgf("{n} work-as sessions have run over an hour", { n: longWorkAs.length }),
      summary: msgf("The longest began {minutes} minutes ago and ends by itself after 4 hours.", { minutes: oldest }),
      what: msgf("A Developer is still working as someone else's account. It ends by itself when the Developer session ends or 4 hours after it started.", {}),
      todo: msgf("If it was forgotten, press Stop on the bar at the top of the screen.", {}),
      link: null,
    });
  }
  if (workAsStarted24) {
    add({
      id: "work-as-used", severity: "info",
      title: workAsStarted24 === 1 ? msgf("Work as was used {n} time in 24 hours", { n: workAsStarted24 }) : msgf("Work as was used {n} times in 24 hours", { n: workAsStarted24 }),
      summary: msgf("The Boss is told on WhatsApp every time it starts.", {}),
      what: msgf("Each start is written to the audit trail under the Developer's own name, and the Boss and the other report recipients are told.", {}),
      todo: msgf("Nothing to do. Open Audit to see each one.", {}),
      link: null,
    });
  }

  const order: Record<Severity, number> = { fix: 0, look: 1, info: 2 };
  items.sort((a, b) => order[a.severity] - order[b.severity]);
  const counts = { fix: items.filter((i) => i.severity === "fix").length, look: items.filter((i) => i.severity === "look").length, info: items.filter((i) => i.severity === "info").length };

  return {
    checkedAt: now,
    database: { online, ms: diag.database.ms },
    signedInToday, actionsToday, alerts, failedSignIns24h: failedSignIns,
    items, counts,
    score: healthScore({ databaseOnline: online, items }),
    verdict: healthVerdict(online, counts),
  };
}

// ───────────────────────────────────────────── 3. activity ─────────────────────────────────────────────
export const ACTIVITY_DAYS = 14;
export const WORK_DAYS = 7;
export const NOT_USING_DAYS = 30;
export const RECENT_SIGN_INS = 12;

/** Plain names for the kinds of record the audit trail writes about (what the entry is about). Anything else is the record's own name, spaced out. */
const MODULE_WORDS: Record<string, string> = {
  Reservation: msg("Bookings and stays"), ReservationRoom: msg("Bookings and stays"), BookingGroup: msg("Group bookings"), BookingRequest: msg("Booking requests"),
  TableReservation: msg("Table bookings"), BookingQrCode: msg("Hotel QR"),
  RestaurantOrder: msg("Restaurant orders"), DiningSession: msg("Restaurant tables"), RestaurantLocation: msg("Restaurant tables"), MenuItem: msg("Menu"), MenuCategory: msg("Menu"), SpinSession: msg("Spin to Win"),
  Payment: msg("Payments"), MobilePayment: msg("Online payments"), Withdrawal: msg("Withdrawals"), CashHandover: msg("Cash handovers"), CashCount: msg("Cash handovers"),
  Expense: msg("Expenses"), ExpenseItem: msg("Expenses"), Invoice: msg("Invoices"), SupplierInvoice: msg("Supplier invoices"), RevenueTransaction: msg("Income"), LedgerEntry: msg("Ledger"), MoneyAccount: msg("Money accounts"),
  StockRequest: msg("Stock requests"), InventoryItem: msg("Stock items"), InventoryMovement: msg("Stock movements"), InventoryDepartment: msg("Stock items"), InventoryCategory: msg("Stock items"), Supplier: msg("Suppliers"), Asset: msg("Assets"),
  Room: msg("Rooms"), RoomType: msg("Rooms"), Guest: msg("Customers"), CorporateCustomer: msg("Companies"), ServiceRequest: msg("Guest requests"), ContactMessage: msg("Messages"),
  ActualShift: msg("Shifts"), ShiftSchedule: msg("Shifts"), ShiftHandoverNote: msg("Shifts"), DailyList: msg("Daily lists"),
  DailyReport: msg("Reports"), RoomReport: msg("Reports"), ShiftReport: msg("Reports"), StaffReport: msg("Reports"),
  TransportTrip: msg("Transport"), TransportService: msg("Transport"), Vehicle: msg("Transport"),
  User: msg("Staff accounts"), Role: msg("Roles and rights"), Permission: msg("Roles and rights"), HotelSettings: msg("Settings"), HotelService: msg("Hotel services"),
  Promotion: msg("Prices"), PriceRule: msg("Prices"), SiteContent: msg("Website"), MediaAsset: msg("Website"), Page: msg("Pages looked at"),
};
/** The kind of record in plain English ("Restaurant orders"); an unknown one is spaced out ("Some thing" → its own words). */
export const moduleWords = (entityType: string): string =>
  MODULE_WORDS[entityType] ?? (entityType.replace(/([a-z0-9])([A-Z])/g, "$1 $2").trim() || msg("Other"));

export interface ActivityData {
  today: BusinessDate;
  /** When a hotel day starts, as "04:00" (a day runs from then to the same time next morning). */
  dayStart: string;
  /** The last 14 hotel days, oldest first, ending today. */
  days: BusinessDate[];
  stats: {
    peopleSignedIn24h: number | null;
    peopleSignedIn7d: number | null;
    teamActions24h: number | null;
    developerActions24h: number | null;
    signIns24h: number | null;
    failedSignIns24h: number | null;
    /** The busiest hour of the day (0–23) over the last 14 days, null when nothing was done. */
    busiestHour: number | null;
  };
  /** The roles that signed in during the 14 days (the chart's series), most sign-ins first. */
  roles: { code: string; name: string }[];
  signInsPerDay: { date: BusinessDate; total: number; byRole: Record<string, number> }[] | null;
  actionsPerDay: { date: BusinessDate; team: number; developer: number; total: number }[] | null;
  /** 24 hotel hours, 0–23. */
  busiestHours: { hour: number; count: number }[] | null;
  /** The kinds of record the work was about in the last 7 days, most first (several kinds with the same plain name are added together). */
  where: { label: string; count: number }[] | null;
  mostActive: { userId: string; name: string; roleName: string | null; developer: boolean; count: number }[] | null;
  recentSignIns: { id: string; name: string; roleCode: string | null; roleName: string | null; device: { label: string; phone: boolean } | null; ip: string | null; at: Date }[] | null;
  notUsing: { id: string; name: string; roleName: string; lastUsedAt: Date | null }[] | null;
  notUsingTotal: number;
}

/** "Chrome · Mac" from a user-agent (browser first, then the device). */
const deviceOf = (ua: string | null): { label: string; phone: boolean } | null => {
  if (!ua) return null;
  const d = deviceLabel(ua);
  return { label: d.label.split(" · ").reverse().join(" · "), phone: d.phone };
};

export async function activityData(user: ConsoleUser, now = new Date()): Promise<ActivityData> {
  assertConsoleAccess(user);
  const settings = await getSettings();
  const cfg = businessDayConfig(settings);
  const today = businessDateOf(now, cfg);
  const days = eachDate(addDays(today, -(ACTIVITY_DAYS - 1)), addDays(today, 1));
  const { start: start14, end: end14 } = businessRangeBounds(days[0], today, cfg);
  const start7 = businessRangeBounds(addDays(today, -(WORK_DAYS - 1)), today, cfg).start;
  const since24 = new Date(now.getTime() - DAY);
  const since7d = new Date(now.getTime() - 7 * DAY);
  const people = { actorType: { in: ["STAFF", "DEVELOPER"] }, action: { notIn: [...NOT_WORK_ACTIONS] } };

  const [roles, logins, sessions24, byDayRaw, hoursRaw, whereRaw, activeRaw, recentRaw, usersRaw, failed24, team24, dev24] = await Promise.all([
    safe(() => db.role.findMany({ select: { code: true, name: true } })),
    safe(() => db.auditLog.findMany({
      where: { action: "auth.login", createdAt: { gte: start14, lt: end14 } },
      select: { userId: true, actorRole: true, businessDate: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5000,
    })),
    safe(() => db.session.findMany({ where: { createdAt: { gte: since24 } }, select: { userId: true }, take: 2000 })),
    safe(() => db.auditLog.groupBy({
      by: ["businessDate", "actorType"],
      where: { ...people, businessDate: { gte: toDbDate(days[0]), lte: toDbDate(today) }, createdAt: { gte: start14, lt: end14 } },
      _count: { _all: true },
    })),
    safe(() => db.$queryRaw<{ hour: number; n: number }[]>`
      SELECT EXTRACT(HOUR FROM (("createdAt" AT TIME ZONE 'UTC') AT TIME ZONE ${cfg.timezone}))::int AS hour, count(*)::int AS n
      FROM "audit_logs"
      WHERE "businessDate" >= ${days[0]}::date AND "businessDate" <= ${today}::date
        AND "createdAt" >= ${start14.toISOString()}::timestamp AND "createdAt" < ${end14.toISOString()}::timestamp
        AND "actorType" IN ('STAFF', 'DEVELOPER')
        AND "action" NOT IN (${Prisma.join([...NOT_WORK_ACTIONS])})
      GROUP BY 1`),
    safe(() => db.auditLog.groupBy({
      by: ["entityType"],
      where: { ...people, createdAt: { gte: start7 }, businessDate: { gte: toDbDate(addDays(today, -(WORK_DAYS - 1))), lte: toDbDate(today) } },
      _count: { id: true }, orderBy: { _count: { id: "desc" } }, take: 40,
    })),
    safe(() => db.auditLog.groupBy({
      by: ["userId"],
      where: { ...people, userId: { not: null }, createdAt: { gte: start7 }, businessDate: { gte: toDbDate(addDays(today, -(WORK_DAYS - 1))), lte: toDbDate(today) } },
      _count: { id: true }, orderBy: { _count: { id: "desc" } }, take: 8,
    })),
    safe(() => db.auditLog.findMany({
      where: { action: "auth.login" }, orderBy: { createdAt: "desc" }, take: RECENT_SIGN_INS,
      select: { id: true, userId: true, actorLabel: true, actorRole: true, ipAddress: true, createdAt: true },
    })),
    safe(() => db.user.findMany({
      where: { isActive: true, role: { code: { notIn: [DEVELOPER_ROLE_CODE, SYSTEM_ROLE] } } },
      select: { id: true, fullName: true, lastLoginAt: true, createdAt: true, role: { select: { name: true } }, sessions: { orderBy: { lastSeenAt: "desc" }, take: 1, select: { lastSeenAt: true } } },
      orderBy: { fullName: "asc" }, take: 300,
    })),
    safe(() => db.auditLog.count({ where: { action: "auth.login_failed", createdAt: { gte: since24 } } })),
    safe(() => db.auditLog.count({ where: { ...people, actorType: "STAFF", createdAt: { gte: since24 } } })),
    safe(() => db.auditLog.count({ where: { ...people, actorType: "DEVELOPER", createdAt: { gte: since24 } } })),
  ]);

  // ── sign-ins ──
  const roleName = new Map((roles ?? []).map((r) => [r.code, r.name]));
  let signInsPerDay: ActivityData["signInsPerDay"] = null;
  let roleList: ActivityData["roles"] = [];
  if (logins) {
    const perDay = new Map<BusinessDate, Record<string, number>>(days.map((d) => [d, {}]));
    const totals: Record<string, number> = {};
    for (const l of logins) {
      const code = l.actorRole ?? "UNKNOWN";
      const bucket = perDay.get(fromDbDate(l.businessDate));
      if (!bucket) continue;
      bucket[code] = (bucket[code] ?? 0) + 1;
      totals[code] = (totals[code] ?? 0) + 1;
    }
    roleList = Object.keys(totals).sort((a, b) => totals[b] - totals[a] || a.localeCompare(b)).map((code) => ({ code, name: roleName.get(code) ?? code }));
    signInsPerDay = days.map((date) => {
      const byRole = perDay.get(date) ?? {};
      return { date, total: Object.values(byRole).reduce((n, v) => n + v, 0), byRole };
    });
  }
  const loginIds = (since: Date) => (logins ?? []).filter((l) => l.createdAt >= since).map((l) => l.userId);
  const distinct = (ids: (string | null)[]) => new Set(ids.filter((id): id is string => !!id)).size;
  const peopleSignedIn24h = logins && sessions24 ? distinct([...loginIds(since24), ...sessions24.map((s) => s.userId)]) : null;
  const peopleSignedIn7d = logins ? distinct(loginIds(since7d)) : null;
  const signIns24h = logins ? loginIds(since24).length : null;

  // ── actions per day ──
  let actionsPerDay: ActivityData["actionsPerDay"] = null;
  if (byDayRaw) {
    const perDay = new Map<BusinessDate, { team: number; developer: number }>(days.map((d) => [d, { team: 0, developer: 0 }]));
    for (const r of byDayRaw) {
      const bucket = perDay.get(fromDbDate(r.businessDate));
      if (!bucket) continue;
      if (r.actorType === "DEVELOPER") bucket.developer += r._count._all;
      else bucket.team += r._count._all;
    }
    actionsPerDay = days.map((date) => { const b = perDay.get(date)!; return { date, ...b, total: b.team + b.developer }; });
  }

  // ── busiest hours ──
  let busiestHours: ActivityData["busiestHours"] = null;
  let busiestHour: number | null = null;
  if (hoursRaw) {
    const counts = Array.from({ length: 24 }, () => 0);
    for (const r of hoursRaw) if (r.hour >= 0 && r.hour < 24) counts[r.hour] += Number(r.n);
    busiestHours = counts.map((count, hour) => ({ hour, count }));
    const peak = Math.max(...counts);
    busiestHour = peak > 0 ? counts.indexOf(peak) : null;
  }

  // ── where the work happens ──
  let where: ActivityData["where"] = null;
  if (whereRaw) {
    const byLabel = new Map<string, number>();
    for (const r of whereRaw) { const label = moduleWords(r.entityType); byLabel.set(label, (byLabel.get(label) ?? 0) + r._count.id); }
    where = [...byLabel].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count || a.label.localeCompare(b.label)).slice(0, 8);
  }

  // ── most active people ──
  let mostActive: ActivityData["mostActive"] = null;
  if (activeRaw) {
    const ids = activeRaw.map((r) => r.userId).filter((id): id is string => !!id);
    const names = ids.length ? (await safe(() => db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, role: { select: { code: true, name: true } } } }))) ?? [] : [];
    const byId = new Map(names.map((u) => [u.id, u]));
    mostActive = activeRaw.flatMap((r) => {
      const u = r.userId ? byId.get(r.userId) : undefined;
      return u ? [{ userId: u.id, name: u.fullName, roleName: u.role.name, developer: u.role.code === DEVELOPER_ROLE_CODE, count: r._count.id }] : [];
    });
  }

  // ── recent sign-ins (the audit entry is permanent; the device comes from the session while it still exists) ──
  let recentSignIns: ActivityData["recentSignIns"] = null;
  if (recentRaw) {
    const ids = [...new Set(recentRaw.map((r) => r.userId).filter((id): id is string => !!id))];
    const oldest = recentRaw.length ? new Date(Math.min(...recentRaw.map((r) => r.createdAt.getTime())) - 5 * 60_000) : now;
    const [users, sessions] = ids.length
      ? await Promise.all([
          safe(() => db.user.findMany({ where: { id: { in: ids } }, select: { id: true, fullName: true, role: { select: { code: true, name: true } } } })),
          safe(() => db.session.findMany({ where: { userId: { in: ids }, createdAt: { gte: oldest } }, select: { userId: true, userAgent: true, ipAddress: true, createdAt: true }, take: 300 })),
        ])
      : [[], []];
    const who = new Map((users ?? []).map((u) => [u.id, u]));
    recentSignIns = recentRaw.map((r) => {
      const u = r.userId ? who.get(r.userId) : undefined;
      // The session made at that sign-in: the same person, within a minute.
      const session = (sessions ?? [])
        .filter((s) => s.userId === r.userId && Math.abs(s.createdAt.getTime() - r.createdAt.getTime()) <= 60_000)
        .sort((a, b) => Math.abs(a.createdAt.getTime() - r.createdAt.getTime()) - Math.abs(b.createdAt.getTime() - r.createdAt.getTime()))[0];
      return {
        id: r.id, name: u?.fullName ?? short(r.actorLabel, 120) ?? "—", roleCode: u?.role.code ?? r.actorRole, roleName: u?.role.name ?? (r.actorRole ? roleName.get(r.actorRole) ?? r.actorRole : null),
        device: deviceOf(session?.userAgent ?? null), ip: short(r.ipAddress ?? session?.ipAddress, 64), at: r.createdAt,
      };
    });
  }

  // ── not using the system (never signed in, or not for 30 days; a shared screen counts as in use while its session is) ──
  let notUsing: ActivityData["notUsing"] = null;
  let notUsingTotal = 0;
  if (usersRaw) {
    const cutoff = new Date(now.getTime() - NOT_USING_DAYS * DAY);
    const idle = usersRaw
      .map((u) => {
        const seen = [u.lastLoginAt, u.sessions[0]?.lastSeenAt].filter((d): d is Date => !!d);
        return { id: u.id, name: u.fullName, roleName: u.role.name, lastUsedAt: seen.length ? new Date(Math.max(...seen.map((d) => d.getTime()))) : null };
      })
      .filter((u) => !u.lastUsedAt || u.lastUsedAt < cutoff)
      .sort((a, b) => (a.lastUsedAt?.getTime() ?? 0) - (b.lastUsedAt?.getTime() ?? 0));
    notUsingTotal = idle.length;
    notUsing = idle.slice(0, 12);
  }

  return {
    today, dayStart: formatMinutesLabel(cfg.businessDayStartMinutes), days,
    stats: { peopleSignedIn24h, peopleSignedIn7d, teamActions24h: team24, developerActions24h: dev24, signIns24h, failedSignIns24h: failed24, busiestHour },
    roles: roleList, signInsPerDay, actionsPerDay, busiestHours, where, mostActive, recentSignIns, notUsing, notUsingTotal,
  };
}

// ───────────────────────────────────────────── 4. speed and size ─────────────────────────────────────────────
export const SPEED_SAMPLES = 3;
/** The biggest tables, counted (counts only — no row is read). */
const BIG_TABLES = [
  { table: "audit_logs", label: msg("Audit trail entries") },
  { table: "sessions", label: msg("Sign-in sessions") },
  { table: "reservations", label: msg("Bookings") },
  { table: "payments", label: msg("Payments") },
  { table: "notification_deliveries", label: msg("Messages sent") },
] as const;

export interface SpeedData {
  latency: { samples: number[]; average: number | null; slowest: number | null };
  tables: { label: string; rows: number | null; bytes: number | null }[];
  databaseBytes: number | null;
  deployment: { commit: string | null; environment: string | null };
}

export async function speedData(user: ConsoleUser, now = new Date()): Promise<SpeedData> {
  assertConsoleAccess(user);
  const samples: number[] = [];
  for (let i = 0; i < SPEED_SAMPLES; i++) {
    const started = performance.now();
    const ok = (await safe(() => db.$queryRaw`SELECT 1`)) !== null;
    if (ok) samples.push(Math.max(1, Math.round(performance.now() - started)));
  }
  const [counts, sizes, dbSize, diag] = await Promise.all([
    Promise.all([
      safe(() => db.auditLog.count()), safe(() => db.session.count()), safe(() => db.reservation.count()), safe(() => db.payment.count()), safe(() => db.notificationDelivery.count()),
    ]),
    safe(() => db.$queryRaw<{ name: string; bytes: bigint }[]>`
      SELECT c.relname AS name, pg_total_relation_size(c.oid)::bigint AS bytes
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN (${Prisma.join(BIG_TABLES.map((t) => t.table))})`),
    safe(() => db.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database())::bigint AS bytes`),
    systemDiagnostics(user, now),
  ]);
  const sizeOf = new Map((sizes ?? []).map((s) => [s.name, Number(s.bytes)]));
  return {
    latency: { samples, average: samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : null, slowest: samples.length ? Math.max(...samples) : null },
    tables: BIG_TABLES.map((t, i) => ({ label: t.label, rows: counts[i], bytes: sizeOf.get(t.table) ?? null })),
    databaseBytes: dbSize?.[0] ? Number(dbSize[0].bytes) : null,
    deployment: diag.deployment,
  };
}

// ───────────────────────────────────────────── 5. crashes and sign-ins ─────────────────────────────────────────────
export interface CrashData {
  /** This system has no error tracking: said plainly on the tab. */
  errorTracking: false;
  failed: {
    last24h: number;
    last7d: number;
    /** The last 7 hotel days, oldest first. */
    byDay: { date: BusinessDate; count: number }[];
    /** The accounts most often tried, with how many failed tries (7 days). */
    byAccount: { name: string; count: number }[];
  } | null;
  /** Sign-in places or emails paused right now (their wrong tries went over the limit in the last 15 minutes): the Developer account's own lock, and the shared ones. Counts only — never the email or the address. */
  paused: { developer: number; staff: number } | null;
  denied: DeniedEntry[];
}

/**
 * Which limit a rate-limit key is counted against (null: not a sign-in key). The Developer account's own lock is "login:email:dev:…";
 * every sign-in is also counted per email ("login:email:…") and per address ("login:ip:…").
 */
export function loginLimitOf(key: string): { developer: boolean; limit: number } | null {
  if (key.startsWith("login:email:dev:")) return { developer: true, limit: LOGIN_LIMITS.developerEmail };
  if (key.startsWith("login:email:")) return { developer: false, limit: LOGIN_LIMITS.staffEmail };
  if (key.startsWith("login:ip:")) return { developer: false, limit: LOGIN_LIMITS.staffPlace };
  return null;
}

export async function crashData(user: ConsoleUser, now = new Date()): Promise<CrashData> {
  assertConsoleAccess(user);
  const cfg = businessDayConfig(await getSettings());
  const today = businessDateOf(now, cfg);
  const days = eachDate(addDays(today, -6), addDays(today, 1));
  const since24 = new Date(now.getTime() - DAY);
  const { start, end } = businessRangeBounds(days[0], today, cfg);

  const [failedRows, buckets, denied] = await Promise.all([
    safe(() => db.auditLog.findMany({
      where: { action: "auth.login_failed", createdAt: { gte: start, lt: end } },
      select: { businessDate: true, entityId: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5000,
    })),
    safe(() => db.rateLimitBucket.findMany({
      where: { key: { startsWith: "login:" }, windowStart: { gte: new Date(now.getTime() - LOGIN_LIMITS.windowMinutes * 60_000) } },
      select: { key: true, count: true }, take: 500,
    })),
    recentDenied(user, 20),
  ]);

  let failed: CrashData["failed"] = null;
  if (failedRows) {
    const perDay = new Map<BusinessDate, number>(days.map((d) => [d, 0]));
    const perAccount = new Map<string, number>();
    for (const r of failedRows) {
      const d = fromDbDate(r.businessDate);
      if (perDay.has(d)) perDay.set(d, (perDay.get(d) ?? 0) + 1);
      if (r.entityId) perAccount.set(r.entityId, (perAccount.get(r.entityId) ?? 0) + 1);
    }
    const top = [...perAccount].sort((a, b) => b[1] - a[1]).slice(0, 5);
    const users = top.length ? (await safe(() => db.user.findMany({ where: { id: { in: top.map(([id]) => id) } }, select: { id: true, fullName: true } }))) ?? [] : [];
    const name = new Map(users.map((u) => [u.id, u.fullName]));
    failed = {
      last24h: failedRows.filter((r) => r.createdAt >= since24).length,
      last7d: failedRows.length,
      byDay: days.map((date) => ({ date, count: perDay.get(date) ?? 0 })),
      byAccount: top.flatMap(([id, count]) => (name.has(id) ? [{ name: name.get(id)!, count }] : [])),
    };
  }

  let paused: CrashData["paused"] = null;
  if (buckets) {
    let developer = 0, staff = 0;
    for (const b of buckets) {
      const l = loginLimitOf(b.key);
      if (!l || b.count <= l.limit) continue;
      if (l.developer) developer++; else staff++;
    }
    paused = { developer, staff };
  }

  return { errorTracking: false, failed, paused, denied };
}
