import "server-only";
import { db } from "../db";
import { businessDayConfig, getSettings } from "../settings";
import { Prisma } from "@/generated/prisma/client";
import { msg, msgf, type Localized } from "@/i18n/msg";
import { addDays, businessDateOf, businessDayBounds, businessRangeBounds, eachDate, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import {
  assertConsoleAccess, CONSOLE_HREF, NOT_WORK_ACTIONS, recentDenied, safe, short, systemDiagnostics, type ConsoleUser, type DeniedEntry,
} from "./developer-console";
import { DEVELOPER_IDLE_MINUTES, DEVELOPER_SESSION_HOURS } from "../auth";
import { WORK_AS_HOURS } from "../work-as-session";
import { DEVELOPER_TRIES, DEVELOPER_WINDOW_SECONDS } from "./auth-login";
import { runChecks, type CheckResult } from "./developer-checks";
import { loadSystemEvents, type SystemEvents } from "./system-events";

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
 *   each "fix now" item                   −10   (a system check that says "fix", or a set-up fact that is wrong)
 *   each "look at" item                    −5   (a system check that says "look")
 *   "for information" items                −0   (and a check that could not be run costs nothing either)
 *   never below 0
 * Only SYSTEM facts count (the data contradicts itself, a job or an integration fails, a key or a setting is wrong, the server threw an
 * error). The hotel's own work (a shift open for long, a guest who owes, an order waiting, low stock, a request unanswered) never does:
 * the Developer does not do operations.
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
  /** What to do about it. */
  todo: Localized;
  /** Who fixes it: the Developer, or the system owner for keys and billing (null on the few items that say it in their text). */
  who?: Localized | null;
  /** Codes and numbers that show where to look (room numbers, booking references, job names). Never a name. */
  examples?: string[];
  /** A page that helps — only when this Developer may open it (never a link that would be refused). */
  link: { href: string; label: Localized } | null;
}

/** An open reception or waiter shift older than this is shown as "long" on the Hotel tab (a plain number there; it is not a Developer problem). */
export const SHIFT_OPEN_LIMIT_HOURS = 14;
/** A "work as" session open longer than this is mentioned (the 4-hour cap ends it by itself). */
export const WORK_AS_LONG_MINUTES = 60;
/**
 * Wrong tries in 15 minutes before a sign-in is paused. The Developer account's own lock is read from where it is enforced
 * (services/auth-login.ts); the shared limits per email and per address are the numbers written in src/app/staff/(auth)/login/actions.ts.
 */
export const LOGIN_LIMITS = { developerEmail: DEVELOPER_TRIES, staffEmail: 8, staffPlace: 20, windowMinutes: DEVELOPER_WINDOW_SECONDS / 60 } as const;

export interface HealthReport {
  checkedAt: Date;
  database: { online: boolean; ms: number | null };
  /** Distinct people who signed in during the hotel's day today (a count of PEOPLE, never of work). null = could not be read. */
  signedInToday: number | null;
  /** Real work saved in the last 24 hours by staff and the Developer (sign-ins, looking, refusals and other notes are not work: NOT_WORK_ACTIONS). A count, never what the work was. null = could not be read. */
  actionsToday: number | null;
  /** How many DIFFERENT unexpected server errors were seen in the last 24 hours (the headline figure). null = could not be read. */
  serverErrors24h: number | null;
  failedSignIns24h: number | null;
  /** Every system check, just now (the Problems part shows them; the attention cards are the ones that say "fix" or "look"). Empty while the database is down. */
  checks: CheckResult[];
  /** Fix now first, then look at, then for information. */
  items: HealthItem[];
  counts: { fix: number; look: number; info: number };
  score: number;
  verdict: Verdict;
}

/** A check that needs attention, as an attention card. */
function itemOfCheck(c: CheckResult): HealthItem {
  return {
    id: c.id, severity: c.state === "fix" ? "fix" : "look",
    title: c.title, summary: c.summary, what: c.what, todo: c.todo, who: c.who, examples: c.examples,
    link: c.link ?? null,
  };
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
    safe(() => loadSystemEvents(user as Parameters<typeof loadSystemEvents>[0], now)),
    safe(() => db.auditLog.count({ where: { action: "auth.login_failed", createdAt: { gte: since24 } } })),
    safe(() => db.auditLog.count({ where: { action: "developer.denied", createdAt: { gte: since24 } } })),
    safe(() => db.session.findMany({ where: { workAsUserId: { not: null } }, select: { workAsStartedAt: true }, take: 50 })),
    safe(() => db.auditLog.count({ where: { action: "developer.work_as_started", createdAt: { gte: since24 } } })),
    safe(async () => {
      const [logins, sessions] = await Promise.all([
        db.auditLog.findMany({ where: { action: "auth.login", createdAt: { gte: dayBounds.start, lt: dayBounds.end } }, select: { userId: true }, take: 2000 }),
        db.session.findMany({ where: { createdAt: { gte: dayBounds.start, lt: dayBounds.end } }, select: { userId: true }, take: 2000 }),
      ]);
      return new Set([...logins.map((l) => l.userId), ...sessions.map((s) => s.userId)].filter((id): id is string => !!id)).size;
    }),
    // Work saved in the last 24 hours (the hotel-day window keeps the query on the date index).
    safe(() => db.auditLog.count({
      where: {
        createdAt: { gte: since24 }, businessDate: { gte: toDbDate(addDays(today, -2)), lte: toDbDate(addDays(today, 1)) },
        actorType: { in: ["STAFF", "DEVELOPER"] }, action: { notIn: [...NOT_WORK_ACTIONS] },
      },
    })),
  ]) : null;
  const [events, failedSignIns, denied24, workAsOpen, workAsStarted24, signedInToday, actionsToday] = facts ?? [null, null, null, null, null, null, null];
  // The system checks (data that contradicts itself, jobs, integrations, set-up, errors) — read once here for the cards, the score and the Problems part.
  const checks: CheckResult[] = online ? (await safe(() => runChecks(user, now, { diag, events: events as SystemEvents | null }))) ?? [] : [];

  const items: HealthItem[] = [];
  const add = (it: HealthItem) => items.push(it);

  if (!online) {
    add({
      id: DATABASE_ITEM_ID, severity: "fix",
      title: msgf("The database is not answering", {}),
      summary: msgf("Nothing can be read or saved until it answers.", {}),
      what: msgf("All of the hotel's records live in the database. The console just asked it a trivial question and got no answer.", {}),
      todo: msgf("Look at the database provider's status page and the connection setting on Vercel. Staff cannot work until it is back.", {}),
      who: msgf("The Developer; the system owner for the database plan.", {}),
      link: null,
    });
  }

  // ── every system check that says "fix" or "look" is a card (an "ok" one never is) ──
  for (const c of checks) if (c.state === "fix" || c.state === "look") add(itemOfCheck(c));
  const carded = new Set(items.map((i) => i.id));
  // A check that could not be run is information, once, with a pointer to the Problems part for which one and why.
  const unknown = checks.filter((c) => c.state === "unknown").length;
  if (unknown > 0) {
    add({
      id: "checks-unknown", severity: "info",
      title: unknown === 1 ? msgf("{n} check could not be run", { n: unknown }) : msgf("{n} checks could not be run", { n: unknown }),
      summary: msgf("Not counted against the score.", {}),
      what: msgf("A check could not read what it needs (a part of the database or a service did not answer, the system has not been recording for long enough yet, or the file it compares with is not on this server). It is not a problem found; it is something not known.", {}),
      todo: msgf("Open the Problems part to see which checks and why. If it stays like that, find out what stops the check.", {}),
      who: null,
      link: { href: `${CONSOLE_HREF.home}#problems`, label: msgf("Open Problems", {}) },
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
  // (The two facts below are checks too, once they are above their limits; below it they stay plain information, never twice.)
  if (failedSignIns && !carded.has("failed-sign-ins")) {
    add({
      id: "failed-sign-ins", severity: "info",
      title: failedSignIns === 1 ? msgf("{n} failed sign-in in 24 hours", { n: failedSignIns }) : msgf("{n} failed sign-ins in 24 hours", { n: failedSignIns }),
      summary: msgf("Wrong-password tries. After {dev} wrong tries in 15 minutes a Developer sign-in is paused ({staff} for staff).", { dev: LOGIN_LIMITS.developerEmail, staff: LOGIN_LIMITS.staffEmail }),
      what: msgf("A few typing mistakes are normal. Many in a day can mean someone is guessing passwords. The table in the Errors & jobs part shows which accounts were tried and how often.", {}),
      todo: msgf("If one account is tried again and again, tell the Boss or the MD.", {}),
      link: null,
    });
  }
  if (denied24 && !carded.has("denied")) {
    add({
      id: "denied", severity: "info",
      title: denied24 === 1 ? msgf("{n} Developer action was refused in 24 hours", { n: denied24 }) : msgf("{n} Developer actions were refused in 24 hours", { n: denied24 }),
      summary: msgf("The Developer role does not hold the right they needed.", {}),
      what: msgf("A page or an action was refused to a Developer account. For money this is by design — the Developer never writes money. If it surprised you, the list shows which right was needed.", {}),
      todo: msgf("See the list in the Errors & jobs part. Nothing is broken.", {}),
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
    signedInToday, actionsToday,
    serverErrors24h: events ? (events as SystemEvents).errors24h : null,
    failedSignIns24h: failedSignIns,
    checks,
    items, counts,
    score: healthScore({ databaseOnline: online, items }),
    verdict: healthVerdict(online, counts),
  };
}

// ───────────────────────────────────────────── 4. speed and size ─────────────────────────────────────────────
/** The biggest tables, counted (counts only — no row is read). */
const BIG_TABLES = [
  { table: "audit_logs", label: msg("Audit trail entries") },
  { table: "sessions", label: msg("Sign-in sessions") },
  { table: "notification_deliveries", label: msg("Messages sent") },
  { table: "system_events", label: msg("System events") },
] as const;

/** A handful of real, small questions asked of the database, each timed (system records only: never the hotel's own tables). */
const PROBES: { label: string; ask: (now: Date) => Promise<unknown> }[] = [
  { label: msg("Simple ping"), ask: () => db.$queryRaw`SELECT 1` },
  { label: msg("Find one account"), ask: () => db.user.findFirst({ select: { id: true } }) },
  { label: msg("Count today's activity"), ask: (now) => db.auditLog.count({ where: { createdAt: { gte: new Date(now.getTime() - DAY) } } }) },
  { label: msg("Load latest 50 activity lines"), ask: () => db.auditLog.findMany({ select: { id: true }, orderBy: { createdAt: "desc" }, take: 50 }) },
  { label: msg("Count sign-in sessions"), ask: () => db.session.count() },
  // A real screen's question (the bookings list), so a table that grows shows up here before staff feel it.
  { label: msg("Load newest 50 bookings"), ask: () => db.reservation.findMany({ select: { id: true }, orderBy: { createdAt: "desc" }, take: 50 }) },
];

export interface SpeedData {
  /** Each probe with its time in milliseconds (null = it did not answer); `samples` are the answered ones. */
  probes: { label: string; ms: number | null }[];
  latency: { samples: number[]; average: number | null; slowest: number | null };
  tables: { label: string; rows: number | null; bytes: number | null }[];
  databaseBytes: number | null;
  deployment: {
    commit: string | null; environment: string | null; node: string;
    /** "Pooled" or "Direct" — only which kind of address is used, never the address. null = not known. */
    databaseLink: "Pooled" | "Direct" | null;
    sessionHours: number; idleMinutes: number; workAsHours: number;
  };
}

export async function speedData(user: ConsoleUser, now = new Date()): Promise<SpeedData> {
  assertConsoleAccess(user);
  const probes: SpeedData["probes"] = [];
  for (const p of PROBES) {
    const started = performance.now();
    const ok = (await safe(() => p.ask(now))) !== null;
    probes.push({ label: p.label, ms: ok ? Math.max(1, Math.round(performance.now() - started)) : null });
  }
  const samples = probes.flatMap((p) => (p.ms === null ? [] : [p.ms]));
  const [counts, sizes, dbSize, diag] = await Promise.all([
    Promise.all([
      safe(() => db.auditLog.count()), safe(() => db.session.count()), safe(() => db.notificationDelivery.count()), safe(() => db.systemEvent.count()),
    ]),
    safe(() => db.$queryRaw<{ name: string; bytes: bigint }[]>`
      SELECT c.relname AS name, pg_total_relation_size(c.oid)::bigint AS bytes
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind = 'r' AND c.relname IN (${Prisma.join(BIG_TABLES.map((t) => t.table))})`),
    safe(() => db.$queryRaw<{ bytes: bigint }[]>`SELECT pg_database_size(current_database())::bigint AS bytes`),
    systemDiagnostics(user, now),
  ]);
  const sizeOf = new Map((sizes ?? []).map((s) => [s.name, Number(s.bytes)]));
  const url = process.env.DATABASE_URL ?? "";
  return {
    probes,
    latency: { samples, average: samples.length ? Math.round(samples.reduce((a, b) => a + b, 0) / samples.length) : null, slowest: samples.length ? Math.max(...samples) : null },
    tables: BIG_TABLES.map((t, i) => ({ label: t.label, rows: counts[i], bytes: sizeOf.get(t.table) ?? null })),
    databaseBytes: dbSize?.[0] ? Number(dbSize[0].bytes) : null,
    deployment: {
      ...diag.deployment, node: process.version,
      databaseLink: url ? (/-pooler[.-]|pgbouncer=true/i.test(url) ? "Pooled" : "Direct") : null,
      sessionHours: DEVELOPER_SESSION_HOURS, idleMinutes: DEVELOPER_IDLE_MINUTES, workAsHours: WORK_AS_HOURS,
    },
  };
}

// ───────────────────────────────────────────── 5. crashes and sign-ins ─────────────────────────────────────────────
/** One address in "Failed tries by address". */
export interface AddressTries { ip: string; tries: number; accounts: number; last: Date }
/** How many addresses "Failed tries by address" lists. */
export const ADDRESS_ROWS = 8;

export interface CrashData {
  /** What the system recorded about itself: unexpected server errors (grouped), the automatic jobs and the webhooks. null = could not be read. */
  system: SystemEvents | null;
  failed: {
    last24h: number;
    last7d: number;
    /** The last 7 hotel days, oldest first. */
    byDay: { date: BusinessDate; count: number }[];
    /** The accounts most often tried, with how many failed tries (7 days). */
    byAccount: { name: string; count: number }[];
    /** The latest tries, newest first; the same account from the same place within a minute is one line with a count (×N). */
    latest: { id: string; name: string; at: Date; ip: string | null; times: number }[];
    /** Wrong tries on the Developer's OWN account in the last 24 hours. */
    own24h: number;
  } | null;
  /** Wrong tries (a wrong password or a switched-off account) in the last 14 hotel days. null = could not be read. */
  failed14d: number | null;
  /** Successful sign-ins in the last 14 hotel days, staff and Developer together. A count — never who. null = could not be read. */
  successful14d: number | null;
  /**
   * Where the wrong tries came from (last 7 days): the 8 addresses with the most tries, each with how many DIFFERENT accounts it tried and when it last tried.
   * One address trying many accounts is a warning sign. null = could not be read.
   */
  byAddress: AddressTries[] | null;
  /** The Developer's refused actions per hotel day (the last 7 days, oldest first), to read beside the failed sign-ins. null = could not be read. */
  deniedByDay: { date: BusinessDate; count: number }[] | null;
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
  const start14 = businessRangeBounds(addDays(today, -13), today, cfg).start;

  const [system, failedRows, buckets, denied, deniedRaw, failed14d, successful14d] = await Promise.all([
    safe(() => loadSystemEvents(user as Parameters<typeof loadSystemEvents>[0], now)),
    safe(() => db.auditLog.findMany({
      where: { action: "auth.login_failed", createdAt: { gte: start, lt: end } },
      select: { businessDate: true, entityId: true, createdAt: true, ipAddress: true }, orderBy: { createdAt: "desc" }, take: 5000,
    })),
    safe(() => db.rateLimitBucket.findMany({
      where: { key: { startsWith: "login:" }, windowStart: { gte: new Date(now.getTime() - LOGIN_LIMITS.windowMinutes * 60_000) } },
      select: { key: true, count: true }, take: 500,
    })),
    recentDenied(user, 20),
    safe(() => db.auditLog.groupBy({ by: ["businessDate"], where: { action: "developer.denied", createdAt: { gte: start, lt: end } }, _count: { _all: true } })),
    safe(() => db.auditLog.count({ where: { action: "auth.login_failed", createdAt: { gte: start14, lt: end } } })),
    safe(() => db.auditLog.count({ where: { action: "auth.login", createdAt: { gte: start14, lt: end } } })),
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
    // the latest tries (rows are newest first): the same account from the same place within a minute is merged into one line
    const merged: { id: string; entityId: string; at: Date; ip: string | null; times: number }[] = [];
    for (const r of failedRows) {
      if (!r.entityId) continue;
      const last = merged[merged.length - 1];
      if (last && last.entityId === r.entityId && last.ip === (r.ipAddress ?? null) && last.at.getTime() - r.createdAt.getTime() < 60_000) { last.times += 1; continue; }
      merged.push({ id: `${r.entityId}:${r.createdAt.getTime()}`, entityId: r.entityId, at: r.createdAt, ip: r.ipAddress ?? null, times: 1 });
      if (merged.length >= 8) break;
    }
    const wanted = [...new Set([...top.map(([id]) => id), ...merged.map((m) => m.entityId)])];
    const users = wanted.length ? (await safe(() => db.user.findMany({ where: { id: { in: wanted } }, select: { id: true, fullName: true } }))) ?? [] : [];
    const name = new Map(users.map((u) => [u.id, u.fullName]));
    failed = {
      last24h: failedRows.filter((r) => r.createdAt >= since24).length,
      last7d: failedRows.length,
      byDay: days.map((date) => ({ date, count: perDay.get(date) ?? 0 })),
      byAccount: top.flatMap(([id, count]) => (name.has(id) ? [{ name: name.get(id)!, count }] : [])),
      latest: merged.flatMap((m) => (name.has(m.entityId) ? [{ id: m.id, name: name.get(m.entityId)!, at: m.at, ip: short(m.ip, 64), times: m.times }] : [])),
      own24h: failedRows.filter((r) => r.entityId === user.id && r.createdAt >= since24).length,
    };
  }

  // By address: the same rows, grouped. A try with no address on record is left out (there is nothing to group it by).
  let byAddress: CrashData["byAddress"] = null;
  if (failedRows) {
    const places = new Map<string, { tries: number; accounts: Set<string>; last: Date }>();
    for (const r of failedRows) {
      const ip = short(r.ipAddress, 64);
      if (!ip) continue;
      const p = places.get(ip) ?? { tries: 0, accounts: new Set<string>(), last: r.createdAt };
      p.tries += 1;
      if (r.entityId) p.accounts.add(r.entityId);
      if (r.createdAt > p.last) p.last = r.createdAt;
      places.set(ip, p);
    }
    byAddress = [...places]
      .map(([ip, p]): AddressTries => ({ ip, tries: p.tries, accounts: p.accounts.size, last: p.last }))
      .sort((a, b) => b.tries - a.tries || b.last.getTime() - a.last.getTime() || a.ip.localeCompare(b.ip))
      .slice(0, ADDRESS_ROWS);
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

  const deniedPerDay = deniedRaw ? new Map(deniedRaw.map((r) => [fromDbDate(r.businessDate), r._count._all])) : null;
  const deniedByDay = deniedPerDay ? days.map((date) => ({ date, count: deniedPerDay.get(date) ?? 0 })) : null;
  return { system, failed, failed14d, successful14d, byAddress, paused, denied, deniedByDay };
}
