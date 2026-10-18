import "server-only";
import { createHash } from "node:crypto";
import { db } from "../db";
import { AppError } from "../errors";
import vercelConfig from "../../../vercel.json";
import type { Prisma } from "@/generated/prisma/client";
import type { CurrentUser } from "../auth";
import { msg } from "@/i18n/msg";
import { DEFAULT_BUSINESS_DAY } from "@/lib/time/business-date";
import { errorFacts, firstMeaningfulLine, scrubEventText, stackFrames } from "@/lib/console-scrub";
import { errorHint } from "@/lib/error-hints";

/**
 * WHAT THE SYSTEM KNOWS ABOUT ITSELF (owner, 2026-10-18). The Developer's job is to make sure the SYSTEM works: no errors, the
 * automatic jobs run, the integrations deliver. Until now an unexpected error only went to the hosting's log, nobody could see
 * whether a scheduled job really ran, and nothing said whether nTZS's calls arrived. This file keeps three kinds of facts in one
 * small table (system_events), written as they happen and read only by the Developer console:
 *
 *   ERROR    one row per kind of error (its "fingerprint"); a repeat only raises the count and the last-seen time.
 *   CRON     one row per run of an automatic job: when, how long, how it ended, a small summary of what it did.
 *   WEBHOOK  one row per call a provider (nTZS) made to us: accepted, refused (bad signature) or failed.
 *
 * WRITING IS BEST-EFFORT AND NEVER HARMS A REQUEST: every writer catches everything and returns normally, waits at most one second
 * (a database that hangs cannot hold a request), and after one failed write stays quiet for 30 seconds (so a database that is down
 * does not add a wait to every error). Nothing here can recurse: a write that fails is dropped, never recorded.
 *
 * PRIVACY: every text is scrubbed before it is stored (src/lib/console-scrub.ts): emails, phone or long numbers, keys, tokens,
 * passwords, links' query strings and quoted values are taken out, and the values a failed database call dumps into its message are
 * dropped — only the error's name and code, one meaningful line, and the top stack frames as "file.ts:line" are kept. The address of
 * the page that was asked for is NOT stored at all (a link can carry a guest's or an order's token); the place in the code is enough.
 * Capped at 300 characters. A person's name written bare inside a message cannot be recognised, so a message is never promised to be free of one.
 */

// ───────────────────────────────────────────── limits ─────────────────────────────────────────────
/** The longest a request ever waits for the system to write one fact. */
export const WRITE_TIMEOUT_MS = 1000;
/** A job's record is not on a person's request, so it may wait a little longer. */
const CRON_WRITE_TIMEOUT_MS = 2500;
/** After a failed write, nothing is written for this long. */
export const WRITE_BACKOFF_MS = 30_000;
/** At most this many NEW kinds of error per minute (per server): an error loop cannot flood the table. Repeats only bump a count. */
export const NEW_ERRORS_PER_MINUTE = 30;
/** And at most this many writes of any kind about errors per minute: a loop of one error cannot hammer the database either. */
const ERROR_WRITES_PER_MINUTE = 300;
/** Webhook receipts written per minute (per server). Refused signatures are coalesced instead (see recordWebhook). */
const WEBHOOKS_PER_MINUTE = 120;
const REFUSED_WINDOW_MS = 10 * 60_000;
/** A refused signature (anyone can send one) touches the database at most this often per server; the count is then "at least". */
const REFUSED_MIN_GAP_MS = 15_000;
/** The table never holds more than this many different errors: past it, a new kind of error is dropped (repeats still count). */
export const MAX_ERROR_ROWS = 5000;
/** The purge deletes this many rows at a time, and runs at most this many rounds, so it cannot hold the database for long. */
const PURGE_BATCH = 2000;
const PURGE_ROUNDS = 10;

/** How long things are kept (purgeSystemEvents). */
export const ERROR_KEEP_DAYS = 30;
export const RUN_KEEP_DAYS = 14;

const HOUR = 3600_000;
const DAY = 24 * HOUR;
/** Most errors the page lists. */
const MAX_GROUPS = 30;

const limits = { windowStart: 0, fresh: 0, writes: 0, hooks: 0, failedAt: 0, refusedAt: 0 };
type Slot = "fresh" | "writes" | "hooks";
const CAPS: Record<Slot, number> = { fresh: NEW_ERRORS_PER_MINUTE, writes: ERROR_WRITES_PER_MINUTE, hooks: WEBHOOKS_PER_MINUTE };

function take(slot: Slot): boolean {
  const now = Date.now();
  if (now - limits.windowStart >= 60_000) Object.assign(limits, { windowStart: now, fresh: 0, writes: 0, hooks: 0 });
  if (limits[slot] >= CAPS[slot]) return false;
  limits[slot] += 1;
  return true;
}
const quiet = () => limits.failedAt > 0 && Date.now() - limits.failedAt < WRITE_BACKOFF_MS;

/** Tests only: forget the per-server limits and the quiet period. */
export function resetSystemEventsLimits(): void {
  Object.assign(limits, { windowStart: 0, fresh: 0, writes: 0, hooks: 0, failedAt: 0, refusedAt: 0 });
}

/**
 * Run one write, waiting no longer than `ms`. true = it was written. Anything else (an error, a timeout) is swallowed: false, and the
 * quiet period starts. A write that finishes (or fails) after the wait is over is also swallowed — it can never become an unhandled rejection.
 */
async function guarded(write: () => Promise<unknown>, ms: number, quietOnFail = true): Promise<boolean> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    const work = (async () => { await write(); return true; })();
    work.catch(() => undefined);
    const timeout = new Promise<false>((resolve) => { timer = setTimeout(() => resolve(false), ms); timer.unref?.(); });
    const done = await Promise.race([work, timeout]);
    if (!done && quietOnFail) limits.failedAt = Date.now();
    return done;
  } catch {
    if (quietOnFail) limits.failedAt = Date.now();
    return false;
  } finally {
    if (timer) clearTimeout(timer);
  }
}

const sha = (...parts: string[]) => createHash("sha256").update(parts.join("|")).digest("hex").slice(0, 32);
const asJson = (v: Record<string, unknown>): Prisma.InputJsonObject => v as Prisma.InputJsonObject;

// ───────────────────────────────────────────── 1. errors ─────────────────────────────────────────────
/** Next's own control flow (a redirect, a not-found page, a prerender bail-out) travels as a thrown value: it is not an error. */
const CONTROL_FLOW = /^(NEXT_REDIRECT|NEXT_NOT_FOUND|NEXT_HTTP_ERROR_FALLBACK|NEXT_UNAUTHORIZED|NEXT_FORBIDDEN|NEXT_PRERENDER|DYNAMIC_SERVER_USAGE|BAILOUT_TO_CLIENT_SIDE_RENDERING)/;

/** An error that is part of normal use, not a fault of the system: a message for the person (AppError), Next's control flow, a request the visitor cancelled. */
function isExpected(error: unknown, digest?: string): boolean {
  if (error instanceof AppError) return true;
  const e = (typeof error === "object" && error !== null ? error : {}) as { name?: unknown; code?: unknown; message?: unknown; digest?: unknown };
  const d = typeof digest === "string" ? digest : typeof e.digest === "string" ? e.digest : "";
  if (CONTROL_FLOW.test(d)) return true;
  const name = typeof e.name === "string" ? e.name : "";
  const code = typeof e.code === "string" ? e.code : "";
  const text = typeof error === "string" ? error : typeof e.message === "string" ? e.message : "";
  if (name === "AppError" || CONTROL_FLOW.test(text)) return true;
  if (name === "AbortError" || name === "ResponseAborted" || code === "ABORT_ERR" || code === "ERR_STREAM_PREMATURE_CLOSE") return true;
  if (code === "ECONNRESET" && /abort/i.test(text)) return true;
  return /^(the )?(request|operation|connection) (was )?aborted\.?$/i.test(text.trim()) || text.trim() === "aborted";
}

export interface ErrorInput {
  /** Where it happened: "action:src/…/actions.ts", "route:/api/…", "page:/staff/…", "webhook:ntzs". */
  source: string;
  error: unknown;
  /** The page or route that was asked for (the query string is dropped). */
  path?: string;
  /** The role code of the person (never a name or an email). */
  role?: string;
  digest?: string;
  /** Next's own words for where it happened (router kind, route type, render source, method). */
  where?: { routerKind?: string; routeType?: string; renderSource?: string; method?: string };
}

interface Prepared { source: string; fingerprint: string; message: string; detail: Prisma.InputJsonObject }

function prepare(input: ErrorInput): Prepared {
  const { name, code, message } = errorFacts(input.error);
  const line = scrubEventText(firstMeaningfulLine(message), 200);
  const head = code ? `${name} ${code}` : name;
  const source = scrubEventText(input.source, 120) || "unknown";
  const stack = typeof input.error === "object" && input.error !== null ? (input.error as { stack?: unknown }).stack : undefined;
  const rawDigest = input.digest ?? (typeof input.error === "object" && input.error !== null ? (input.error as { digest?: unknown }).digest : undefined);
  const detail: Record<string, unknown> = {
    name, code,
    frames: stackFrames(stack),
    digest: typeof rawDigest === "string" && rawDigest ? scrubEventText(rawDigest, 40) : undefined,
    role: input.role && /^[A-Z][A-Z0-9_]{1,40}$/.test(input.role) ? input.role : undefined,
    ...(input.where ? Object.fromEntries(Object.entries(input.where).filter(([, v]) => typeof v === "string" && v).map(([k, v]) => [k, scrubEventText(v, 40)])) : {}),
  };
  for (const k of Object.keys(detail)) if (detail[k] === undefined || detail[k] === null || (Array.isArray(detail[k]) && !(detail[k] as unknown[]).length)) delete detail[k];
  return {
    source,
    // The same bug groups together: the same place, the same kind of error, the same first line (numbers in it do not matter).
    fingerprint: sha("ERROR", source, name, code ?? "", line.replace(/\d+/g, "#")),
    message: scrubEventText(line ? `${head}: ${line}` : head),
    detail: asJson(detail),
  };
}

/**
 * One page that fails often reports the same error twice at the same moment (the layout and the page). Writes of one kind of error are
 * taken one after the other on this server, so the second finds the first's row and raises its count instead of making a second row.
 */
const inFlight = new Map<string, Promise<unknown>>();
function inTurn(fingerprint: string, write: () => Promise<void>): Promise<void> {
  const run = (inFlight.get(fingerprint) ?? Promise.resolve()).catch(() => undefined).then(write);
  const mark = run.catch(() => undefined);
  inFlight.set(fingerprint, mark);
  void mark.then(() => { if (inFlight.get(fingerprint) === mark) inFlight.delete(fingerprint); });
  return run;
}

async function writeError(p: Prepared): Promise<void> {
  const now = new Date();
  // ONE row is raised, never several: a race between two first sightings can leave two rows, and the page adds them up.
  const row = await db.systemEvent.findFirst({ where: { kind: "ERROR", fingerprint: p.fingerprint }, orderBy: { lastSeenAt: "desc" }, select: { id: true } });
  if (row) {
    await db.systemEvent.updateMany({ where: { id: row.id }, data: { count: { increment: 1 }, lastSeenAt: now, status: "OPEN" } });
    return;
  }
  if (!take("fresh")) return;
  if ((await db.systemEvent.count({ where: { kind: "ERROR" } })) >= MAX_ERROR_ROWS) return;
  await db.systemEvent.create({
    data: { kind: "ERROR", source: p.source, fingerprint: p.fingerprint, status: "OPEN", message: p.message, detail: p.detail, firstSeenAt: now, lastSeenAt: now },
  });
}

/**
 * Write down an unexpected error. Never throws, never waits more than a second, skips what is normal (see isExpected), is rate-limited,
 * and keeps nothing personal. The same bug twice is one row with a count of 2.
 */
export async function recordError(input: ErrorInput): Promise<void> {
  try {
    if (isExpected(input.error, input.digest)) return;
    if (quiet()) return;
    if (!take("writes")) return;
    const prepared = prepare(input);
    await guarded(() => inTurn(prepared.fingerprint, () => writeError(prepared)), WRITE_TIMEOUT_MS);
  } catch {
    /* dropped: recording an error must never become an error */
  }
}

/** "action:src/app/staff/reservations/actions.ts" — where a server action's unexpected error came from, taken from its stack. */
export function actionSourceOf(error: unknown): string {
  try {
    const stack = typeof error === "object" && error !== null ? (error as { stack?: unknown }).stack : undefined;
    // Only a project file names the action. On the hosting the frames are compiled chunk files whose names change with every release: they would make the same error a new one after each update.
    const top = stackFrames(stack, 8).find((f) => /^(src|app|pages)\//.test(f));
    return top ? `action:${top.replace(/:\d+$/, "")}` : "action:unknown";
  } catch {
    return "action:unknown";
  }
}

/** The shape of what Next gives onRequestError (instrumentation.ts). */
export interface RequestErrorContext { routerKind?: string; routePath?: string; routeType?: string; renderSource?: string }

/** Called by instrumentation.ts for every unhandled error in a page, a route handler, a server action or the proxy. */
export async function recordRequestError(error: unknown, request: { path?: string; method?: string }, context: RequestErrorContext): Promise<void> {
  try {
    const prefix = context.routeType === "render" ? "page" : context.routeType === "route" ? "route" : context.routeType === "action" ? "action" : context.routeType === "proxy" ? "proxy" : "request";
    const routePath = context.routePath || (request.path ?? "").split("?")[0] || "unknown";
    await recordError({
      source: `${prefix}:${routePath}`, error, path: request.path,
      where: { routerKind: context.routerKind, routeType: context.routeType, renderSource: context.renderSource, method: request.method },
    });
  } catch {
    /* dropped */
  }
}

// ───────────────────────────────────────────── 2. runs of the automatic jobs ─────────────────────────────────────────────
/** A summary that is small and safe: numbers, true/false and short words only (lists become their length, nested objects are flattened one level). */
function sanitizeSummary(summary: Record<string, unknown> | undefined): Record<string, string | number | boolean | null> | undefined {
  if (!summary || typeof summary !== "object") return undefined;
  const out: Record<string, string | number | boolean | null> = {};
  const put = (key: string, v: unknown, depth: number): void => {
    if (Object.keys(out).length >= 24) return;
    const k = scrubEventText(key, 40).replace(/\s+/g, "_");
    if (typeof v === "number") { if (Number.isFinite(v)) out[k] = v; }
    else if (typeof v === "boolean" || v === null) out[k] = v;
    else if (typeof v === "string") { const s = scrubEventText(v, 60); if (s && s.length <= 40) out[k] = s; }
    else if (Array.isArray(v)) out[`${k}Count`] = v.length;
    else if (v instanceof Date) out[k] = v.toISOString();
    else if (v && typeof v === "object" && depth < 1) for (const [k2, v2] of Object.entries(v as Record<string, unknown>)) put(`${k}.${k2}`, v2, depth + 1);
  };
  for (const [k, v] of Object.entries(summary)) put(k, v, 0);
  return out;
}

export interface CronRun { ok: boolean; startedAt: Date; durationMs: number; summary?: Record<string, unknown>; error?: unknown }

/** Write down one run of an automatic job (best-effort, never throws). `job` is the job's path, e.g. "/api/cron/daily-report". */
export async function recordCronRun(job: string, run: CronRun): Promise<void> {
  try {
    const source = scrubEventText(job, 120) || "unknown";
    const durationMs = Math.max(0, Math.round(Number(run.durationMs) || 0));
    const facts = run.error === undefined || run.error === null ? null : errorFacts(run.error);
    const stack = run.error && typeof run.error === "object" ? (run.error as { stack?: unknown }).stack : undefined;
    const line = facts ? scrubEventText(firstMeaningfulLine(facts.message), 200) : "";
    const message = run.ok ? `Ran in ${durationMs} ms` : scrubEventText(facts ? (line ? `${facts.name}: ${line}` : facts.name) : "The run did not finish well");
    const detail: Record<string, unknown> = {
      durationMs,
      summary: sanitizeSummary(run.summary),
      errorName: facts?.name,
      frames: stackFrames(stack),
    };
    for (const k of Object.keys(detail)) if (detail[k] === undefined || (Array.isArray(detail[k]) && !(detail[k] as unknown[]).length)) delete detail[k];
    const startedAt = run.startedAt instanceof Date && !Number.isNaN(run.startedAt.getTime()) ? run.startedAt : new Date();
    await guarded(
      () => db.systemEvent.create({
        data: { kind: "CRON", source, fingerprint: source, status: run.ok ? "OK" : "FAILED", message, detail: asJson(detail), firstSeenAt: startedAt, lastSeenAt: new Date() },
      }),
      CRON_WRITE_TIMEOUT_MS,
      false,
    );
  } catch {
    /* dropped */
  }
}

// ───────────────────────────────────────────── 3. calls providers make to us ─────────────────────────────────────────────
export interface WebhookOutcome { ok: boolean; kind?: string; httpStatus?: number; error?: unknown }

/**
 * Write down one call a provider made to us ("ntzs" or "webhook:ntzs"): accepted, refused (a bad or missing signature) or failed.
 * Never the body, never a header. A refused signature can come from anyone on the internet, so those are NOT one row each: one row per
 * source per ten minutes, its count going up (that cannot be used to fill the table). Best-effort, never throws.
 */
export async function recordWebhook(source: string, outcome: WebhookOutcome): Promise<void> {
  try {
    if (quiet()) return;
    const src = (() => { const s = scrubEventText(source, 80) || "unknown"; return s.startsWith("webhook:") ? s : `webhook:${s}`; })();
    const kind = outcome.kind ? scrubEventText(outcome.kind, 40) : outcome.ok ? "received" : "failed";
    const httpStatus = Number.isInteger(outcome.httpStatus) ? outcome.httpStatus : undefined;
    const facts = outcome.error === undefined || outcome.error === null ? null : errorFacts(outcome.error);
    const line = facts ? scrubEventText(firstMeaningfulLine(facts.message), 160) : "";
    const message = scrubEventText(`${kind}${httpStatus ? ` (${httpStatus})` : ""}${facts ? ` — ${line ? `${facts.name}: ${line}` : facts.name}` : ""}`);
    const detail: Record<string, unknown> = { kind, httpStatus, errorName: facts?.name, frames: facts && typeof outcome.error === "object" ? stackFrames((outcome.error as { stack?: unknown }).stack, 3) : undefined };
    for (const k of Object.keys(detail)) if (detail[k] === undefined || (Array.isArray(detail[k]) && !(detail[k] as unknown[]).length)) delete detail[k];
    const now = new Date();
    const refused = !outcome.ok && kind === "signature";
    // A refused signature is its own status: anyone on the internet can send one, so it is never counted as a failure of nTZS.
    const status = outcome.ok ? "OK" : refused ? "REFUSED" : "FAILED";
    if (refused) {
      if (now.getTime() - limits.refusedAt < REFUSED_MIN_GAP_MS) return;
      limits.refusedAt = now.getTime();
    }
    await guarded(async () => {
      if (refused) {
        const bumped = await db.systemEvent.updateMany({
          where: { kind: "WEBHOOK", source: src, status: "REFUSED", fingerprint: `${src}:signature`, lastSeenAt: { gte: new Date(now.getTime() - REFUSED_WINDOW_MS) } },
          data: { count: { increment: 1 }, lastSeenAt: now },
        });
        if (bumped.count > 0) return;
      } else if (!take("hooks")) {
        return;
      }
      await db.systemEvent.create({ data: { kind: "WEBHOOK", source: src, fingerprint: refused ? `${src}:signature` : src, status, message, detail: asJson(detail), firstSeenAt: now, lastSeenAt: now } });
    }, WRITE_TIMEOUT_MS);
  } catch {
    /* dropped */
  }
}

// ───────────────────────────────────────────── 4. keeping the table small ─────────────────────────────────────────────
/** Errors not seen for 30 days and job / webhook rows older than 14 days are deleted (called from the daily job's housekeeping). Returns how many. */
export async function purgeSystemEvents(now: Date = new Date()): Promise<number> {
  const inBatches = async (where: Prisma.SystemEventWhereInput): Promise<number> => {
    let deleted = 0;
    for (let round = 0; round < PURGE_ROUNDS; round++) {
      const ids = await db.systemEvent.findMany({ where, select: { id: true }, take: PURGE_BATCH });
      if (ids.length === 0) break;
      deleted += (await db.systemEvent.deleteMany({ where: { id: { in: ids.map((r) => r.id) } } })).count;
      if (ids.length < PURGE_BATCH) break;
    }
    return deleted;
  };
  const errors = await inBatches({ kind: "ERROR", lastSeenAt: { lt: new Date(now.getTime() - ERROR_KEEP_DAYS * DAY) } });
  const runs = await inBatches({ kind: { in: ["CRON", "WEBHOOK"] }, lastSeenAt: { lt: new Date(now.getTime() - RUN_KEEP_DAYS * DAY) } });
  return errors + runs;
}

// ───────────────────────────────────────────── 5. what the Developer console reads ─────────────────────────────────────────────
export interface ErrorGroup {
  id: string;
  source: string;
  /** In plain words: Database, Validation, Permission, Network, Code or Unknown. */
  kind: string;
  message: string;
  count: number;
  firstSeenAt: Date;
  lastSeenAt: Date;
  /** "src/…/file.ts:line", the top of the stack. */
  frames: string[];
  /** English; the page shows it through t(). */
  hint: { what: string; todo: string };
}

export interface JobStatus {
  /** The job's path, e.g. "/api/cron/daily-report". */
  job: string;
  /** English; the page shows it through t(). */
  label: string;
  /** The times it runs, in hotel time, from vercel.json: "04:05 · 06:15 · 07:00" (the page adds the words). */
  schedule: string;
  lastRunAt: Date | null;
  lastOkAt: Date | null;
  lastStatus: "OK" | "FAILED" | null;
  lastDurationMs: number | null;
  lastError: string | null;
  /** The longest gap between two of its scheduled runs, in hours. */
  expectedEveryHours: number;
  /** No run at all for longer than 1.5 times that gap. */
  overdue: boolean;
}

export interface WebhookStatus {
  source: string; lastOkAt: Date | null; lastFailedAt: Date | null;
  /** Calls we could not process (not counting refused signatures). */
  failed7d: number; ok7d: number;
  /** Calls refused for a bad or missing signature: anyone can send one, so they are shown apart and never count as a failure. */
  refused7d: number;
}

export interface SystemEvents {
  /** How many DIFFERENT errors were seen in the last 24 hours (a repeat of the same error counts once; each group has its own count). */
  errors24h: number;
  /** Newest first, at most 30. */
  errorGroups: ErrorGroup[];
  jobs: JobStatus[];
  webhooks: WebhookStatus[];
}

/** The words for each job (English keys; the page translates them). A job the list does not know is shown by its path. */
const JOB_LABELS: Record<string, string> = {
  "/api/cron/daily-report": msg("Daily report and housekeeping"),
  "/api/cron/room-report": msg("Room report"),
};
/** The providers' calls we expect. They are listed even before the first one arrives. */
const KNOWN_WEBHOOKS = ["webhook:ntzs"] as const;

/** A cron field (a number, a list, a range, "every" or a step) as the numbers it means; null when it is not understood. */
function expandField(field: string, min: number, max: number): number[] | null {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const m = part.match(/^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/);
    if (!m) return null;
    const step = m[2] ? Number(m[2]) : 1;
    if (!step) return null;
    const [lo, hi] = m[1] === "*" ? [min, max] : m[1].includes("-") ? m[1].split("-").map(Number) : [Number(m[1]), m[2] ? max : Number(m[1])];
    for (let v = lo; v <= hi; v += step) { if (v < min || v > max) return null; out.add(v); }
  }
  return [...out].sort((a, b) => a - b);
}

/** The minutes of the UTC day a daily cron expression runs at; null when it is anything but "minute hour * * *" (then 24 hours is assumed). */
function dailyTimes(expr: string): number[] | null {
  const f = expr.trim().split(/\s+/);
  if (f.length !== 5 || f[2] !== "*" || f[3] !== "*" || f[4] !== "*") return null;
  const minutes = expandField(f[0], 0, 59);
  const hours = expandField(f[1], 0, 23);
  if (!minutes || !hours) return null;
  return hours.flatMap((h) => minutes.map((m) => h * 60 + m));
}

/** The longest gap, in minutes, between consecutive runs in one day that repeats. */
function longestGapMinutes(times: number[]): number {
  const t = [...new Set(times)].sort((a, b) => a - b);
  if (t.length < 2) return 1440;
  return Math.max(...t.map((v, i) => (i === t.length - 1 ? t[0] + 1440 - v : t[i + 1] - v)));
}

/** The jobs in vercel.json: each path with its schedules. */
function scheduledJobs(): { job: string; times: number[] | null }[] {
  const byPath = new Map<string, number[] | null>();
  for (const c of (vercelConfig as { crons?: { path: string; schedule: string }[] }).crons ?? []) {
    const t = dailyTimes(c.schedule);
    const before = byPath.get(c.path);
    if (before === null || t === null) byPath.set(c.path, null);
    else byPath.set(c.path, [...(before ?? []), ...t]);
  }
  return [...byPath.entries()].map(([job, times]) => ({ job, times }));
}

/** "04:05 · 06:15" — the UTC minutes of the day, as the hotel's own clock shows them. */
function hotelTimes(times: number[], timeZone: string, now: Date): string {
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  let fmt: Intl.DateTimeFormat;
  try { fmt = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
  catch { fmt = new Intl.DateTimeFormat("en-GB", { timeZone: DEFAULT_BUSINESS_DAY.timezone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }); }
  return [...new Set(times.map((m) => fmt.format(new Date(base + m * 60_000))))].sort().join(" · ");
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const strList = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string").slice(0, 5) : []);
const str = (v: unknown): string | null => (typeof v === "string" && v ? v : null);

/**
 * Errors, jobs and webhooks for the Developer console. Only the Developer account (holding developer.access, not working as someone
 * else) gets it; every query is bounded; nothing is written.
 */
export async function loadSystemEvents(developer: CurrentUser, now: Date = new Date()): Promise<SystemEvents> {
  const { assertConsoleAccess } = await import("./developer-console");
  assertConsoleAccess(developer);

  const since24 = new Date(now.getTime() - DAY);
  const since7 = new Date(now.getTime() - 7 * DAY);
  const since14 = new Date(now.getTime() - RUN_KEEP_DAYS * DAY);
  const jobs = scheduledJobs();

  const [rows, recent, runs, hookAll, hookWeek, timeZone, recordingSince] = await Promise.all([
    db.systemEvent.findMany({ where: { kind: "ERROR" }, orderBy: { lastSeenAt: "desc" }, take: 150 }),
    db.systemEvent.findMany({ where: { kind: "ERROR", lastSeenAt: { gte: since24 } }, select: { fingerprint: true }, take: 500 }),
    db.systemEvent.findMany({ where: { kind: "CRON", source: { in: jobs.map((j) => j.job) }, firstSeenAt: { gte: since14 } }, orderBy: { firstSeenAt: "desc" }, take: 300 }),
    db.systemEvent.groupBy({ by: ["source", "status"], where: { kind: "WEBHOOK", lastSeenAt: { gte: since14 } }, _max: { lastSeenAt: true } }),
    db.systemEvent.groupBy({ by: ["source", "status"], where: { kind: "WEBHOOK", lastSeenAt: { gte: since7 } }, _sum: { count: true } }),
    hotelTimeZone(),
    recordingStarted(),
  ]);

  // errors: one group per fingerprint (a rare race can have written it twice: the rows are merged here)
  const groups = new Map<string, typeof rows>();
  for (const r of rows) groups.set(r.fingerprint, [...(groups.get(r.fingerprint) ?? []), r]);
  const errorGroups: ErrorGroup[] = [...groups.values()].map((rs) => {
    const newest = rs[0]; // rows are newest first
    const d = isRec(newest.detail) ? newest.detail : {};
    const hint = errorHint({ name: str(d.name), code: str(d.code), message: newest.message });
    return {
      id: newest.id, source: newest.source, kind: hint.kind, message: newest.message,
      count: rs.reduce((n, r) => n + r.count, 0),
      firstSeenAt: new Date(Math.min(...rs.map((r) => r.firstSeenAt.getTime()))),
      lastSeenAt: newest.lastSeenAt,
      frames: strList(d.frames),
      hint: { what: hint.what, todo: hint.todo },
    };
  }).sort((a, b) => b.lastSeenAt.getTime() - a.lastSeenAt.getTime()).slice(0, MAX_GROUPS);

  // jobs
  const jobStatus: JobStatus[] = jobs.map(({ job, times }) => {
    const mine = runs.filter((r) => r.source === job); // newest first
    const last = mine[0] ?? null;
    const lastOk = mine.find((r) => r.status === "OK") ?? null;
    const gapHours = Math.round((longestGapMinutes(times ?? []) / 60) * 10) / 10;
    const d = last && isRec(last.detail) ? last.detail : {};
    const reference = last ? last.firstSeenAt : recordingSince;
    return {
      job, label: JOB_LABELS[job] ?? job,
      schedule: times ? hotelTimes(times, timeZone, now) : "",
      lastRunAt: last?.firstSeenAt ?? null,
      lastOkAt: lastOk?.firstSeenAt ?? null,
      lastStatus: last ? (last.status === "OK" ? "OK" : "FAILED") : null,
      lastDurationMs: typeof d.durationMs === "number" ? d.durationMs : null,
      lastError: last && last.status !== "OK" ? last.message : null,
      expectedEveryHours: gapHours,
      overdue: reference !== null && now.getTime() - reference.getTime() > 1.5 * gapHours * HOUR,
    };
  });

  // webhooks
  const sources = [...new Set<string>([...KNOWN_WEBHOOKS, ...hookAll.map((g) => g.source)])];
  const webhooks: WebhookStatus[] = sources.map((source) => {
    const latest = (status: string) => hookAll.filter((g) => g.source === source && g.status === status).map((g) => g._max.lastSeenAt).filter((x): x is Date => x instanceof Date).sort((a, b) => b.getTime() - a.getTime())[0] ?? null;
    const total = (status: string) => hookWeek.filter((g) => g.source === source && g.status === status).reduce((n, g) => n + (g._sum.count ?? 0), 0);
    return { source, lastOkAt: latest("OK"), lastFailedAt: latest("FAILED"), failed7d: total("FAILED"), ok7d: total("OK"), refused7d: total("REFUSED") };
  });

  return { errors24h: new Set(recent.map((r) => r.fingerprint)).size, errorGroups, jobs: jobStatus, webhooks };
}

/** The hotel's time zone (from the settings); the default one if the settings cannot be read. */
async function hotelTimeZone(): Promise<string> {
  try {
    const { getSettings, businessDayConfig } = await import("../settings");
    return businessDayConfig(await getSettings()).timezone || DEFAULT_BUSINESS_DAY.timezone;
  } catch {
    return DEFAULT_BUSINESS_DAY.timezone;
  }
}

/**
 * When the system began keeping these records (when this table's migration was applied). A job that has never been recorded is
 * "overdue" only once it has had time to run since then — so a brand-new install is not accused, but a job that never runs is found.
 */
async function recordingStarted(): Promise<Date | null> {
  try {
    const rows = await db.$queryRaw<{ at: Date | null }[]>`SELECT finished_at AS at FROM _prisma_migrations WHERE migration_name = '20261018120000_system_events' AND finished_at IS NOT NULL AND rolled_back_at IS NULL LIMIT 1`;
    return rows[0]?.at ?? null;
  } catch {
    return null;
  }
}
