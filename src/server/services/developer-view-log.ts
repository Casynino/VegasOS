import "server-only";
import { after } from "next/server";
import { headers } from "next/headers";
import { db } from "../db";
import { audit } from "../audit";
import { trueActor, withActingAs, type IdentityFields } from "../work-as-session";
import { isLoggedPath, normalizePath } from "@/lib/developer-paths";
import { msg } from "@/i18n/msg";

/**
 * Everything a Developer LOOKS AT is accounted for (owner, 2026-10-14 — looking is also an action). Two kinds of entry:
 *
 *  1. A VISIT to a page: "developer.viewed". Every page is written except the few plainly harmless ones (src/lib/developer-paths.ts —
 *     a new page is logged from day one). At most once per page per 10 minutes for the same person (refreshing, or moving between
 *     pages, does not fill the trail). Never blocks a page and never breaks one: it runs after the page is sent. A failed write does
 *     not break the page, but it leaves a line in the server log. There is a safety valve (VIEW_BURST_LIMIT entries in 10 minutes):
 *     when it is reached ONE marker entry "developer.viewed_limit" is written for that window — so a flood is never silent.
 *
 *  2. An EXPORT or a DOWNLOAD (a CSV, a ledger, a stored file): "developer.exported" / "developer.downloaded". Written BEFORE the data
 *     is sent, every single time (no 10-minute rule, no limit), and it FAILS CLOSED: when the entry cannot be written, nothing is sent.
 *
 * Only an account whose role is the Developer role is ever written (the type is read from the database when the entry is written, by
 * audit()). While a Developer WORKS AS someone (owner, 2026-10-17) every entry is still the Developer's own — their id and name, labelled
 * "Nino (Developer) as Neema (Receptionist)", with after.actingAs — and the 10-minute rule counts per person acted as. The page's address is read on the SERVER (the x-pathname header the proxy sets from the real request) — never taken from a
 * form, a department or anything the browser says about itself.
 */
export const VIEW_ACTION = "developer.viewed";
export const VIEW_LIMIT_ACTION = "developer.viewed_limit";
export const EXPORT_ACTION = "developer.exported";
export const DOWNLOAD_ACTION = "developer.downloaded";
export const VIEW_DEDUPE_MINUTES = 10;
/** A safety valve: one person writes at most this many "viewed" entries in 10 minutes, whatever the addresses. Past it, one marker entry is written for the window. */
export const VIEW_BURST_LIMIT = 100;

/** A CurrentUser fits: while working as someone id / fullName are the person's, actorId / actorName the Developer's own. */
export interface ViewActor extends IdentityFields { actorType: "DEVELOPER" | "STAFF" }
export type ViewOutcome =
  | "logged"       // written
  | "repeat"       // the same page was already written within the last 10 minutes
  | "not-developer"
  | "harmless"     // one of the few pages that are never written
  | "limit";       // too many entries in 10 minutes: not written (the window's marker entry is)

/** A failure to write is never shown to the person, but it is never silent either: one line in the server log, with nothing secret in it. */
function traceFailure(what: string, user: ViewActor, path: string | null | undefined, e: unknown) {
  const code = e && typeof e === "object" && "code" in e && typeof (e as { code: unknown }).code === "string" ? (e as { code: string }).code : undefined;
  console.error(`[developer-audit] ${what}`, { developerId: trueActor(user).id, path: path ? normalizePath(path) ?? "(unreadable address)" : null, error: e instanceof Error ? e.name : "unknown", code });
}

/** Write the visit (when it is a Developer's, to a page that is logged, and not a repeat). `now` is for tests. Throws when the database refuses the write. */
export async function logDeveloperView(user: ViewActor, rawPath: string | null | undefined, opts: { ipAddress?: string | null; now?: Date } = {}): Promise<ViewOutcome> {
  if (user.actorType !== "DEVELOPER") return "not-developer";
  if (!isLoggedPath(rawPath)) return "harmless";
  const path = normalizePath(rawPath) ?? "(unreadable address)";
  const now = opts.now ?? new Date();
  const since = new Date(now.getTime() - VIEW_DEDUPE_MINUTES * 60_000);
  const who = trueActor(user);
  const actor = { userId: who.id, label: who.label, ipAddress: opts.ipAddress ?? null };

  return db.$transaction(async (tx) => {
    // This person's visits are written one at a time: two requests for the same page at the same moment (the page and its data) make
    // one entry, never two — and the safety valve below writes its marker once, never twice.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`developer-view:${who.id}`}))::text`;
    // The same page as the same person acted as (or as themselves) within the window is a repeat; the same page as someone else is a new visit.
    const recent = await tx.auditLog.findMany({ where: { action: VIEW_ACTION, userId: who.id, entityType: "Page", entityId: path, createdAt: { gte: since } }, select: { after: true }, take: 50 });
    const actingId = (after: unknown) => ((after as { actingAs?: { id?: string } } | null)?.actingAs?.id) ?? null;
    if (recent.some((r) => actingId(r.after) === (who.actingAs?.id ?? null))) return "repeat" as const;
    if ((await tx.auditLog.count({ where: { action: VIEW_ACTION, userId: who.id, createdAt: { gte: since } } })) >= VIEW_BURST_LIMIT) {
      // The valve is shut: the visit is not written, but the trail says so — once for the window, whatever happens after.
      const marked = await tx.auditLog.findFirst({ where: { action: VIEW_LIMIT_ACTION, userId: who.id, createdAt: { gte: since } }, select: { id: true } });
      if (!marked) await audit(tx, actor, { action: VIEW_LIMIT_ACTION, entityType: "Page", after: { limit: VIEW_BURST_LIMIT, windowMinutes: VIEW_DEDUPE_MINUTES } });
      return "limit" as const;
    }
    await audit(tx, actor, { action: VIEW_ACTION, entityType: "Page", entityId: path, after: withActingAs({ path }, who.actingAs) });
    return "logged" as const;
  });
}

/** The caller's address from the request headers (best effort, same reading as the rest of the app). */
function callerIp(h: Headers): string | null {
  return h.get("x-forwarded-for")?.split(",")[0]?.trim() || h.get("x-real-ip") || null;
}

/**
 * For a layout or a page: note this request when it is a Developer's visit to a logged page. Reads the address now and does
 * the writing AFTER the response is sent (so the page is never slowed down); a failure never breaks the page — it is written to the
 * server log. Call it from a server component or a server action — not from inside a transaction.
 */
export async function trackDeveloperView(user: ViewActor): Promise<void> {
  if (user.actorType !== "DEVELOPER") return;
  let path: string | null = null;
  try {
    const h = await headers();
    path = h.get("x-pathname");
    if (!isLoggedPath(path)) return;
    const ipAddress = callerIp(h);
    const seen = path;
    after(() => logDeveloperView(user, seen, { ipAddress }).catch((e) => traceFailure("could not write a page visit", user, seen, e)));
  } catch (e) { traceFailure("could not note a page visit", user, path, e); /* looking must never break the page */ }
}

/** The same, for a server action: the action's own request carries the page it was sent from. Written before returning (an action has no page to hurry). */
export async function trackDeveloperViewNow(user: ViewActor): Promise<ViewOutcome | null> {
  if (user.actorType !== "DEVELOPER") return null;
  let path: string | null = null;
  try {
    const h = await headers();
    path = h.get("x-pathname");
    return await logDeveloperView(user, path, { ipAddress: callerIp(h) });
  } catch (e) {
    traceFailure("could not write a page visit", user, path, e);
    return null;
  }
}

// ─────────────────────────────────────────────── exports and downloads ───────────────────────────────────────────────

export interface DeveloperExport {
  /** "exported" = a report or a table as a file (CSV); "downloaded" = a stored file (a receipt, a payment screenshot…). */
  kind: "exported" | "downloaded";
  /** The module: the kind of record the data comes from ("Report", "Ledger", "CashHandover", "StoredFile"). */
  module: string;
  /** The file's id, or the report's name. */
  entityId: string;
  /** What was asked for: the path and the query values that say WHAT is being taken (report, from, to, filters…). Never a secret or a token. */
  after: Record<string, string | number | boolean | null | undefined>;
}

const MAX_VALUE_LENGTH = 200;

/**
 * Write the entry for an export or a download of a Developer — every time, with no 10-minute rule and no limit. Nothing happens for a
 * staff member (returns false). THROWS when the entry cannot be written: the caller must not send the data then (see guardDeveloperExport).
 */
export async function logDeveloperExport(user: ViewActor, info: DeveloperExport, opts: { ipAddress?: string | null } = {}): Promise<boolean> {
  if (user.actorType !== "DEVELOPER") return false;
  let ipAddress = opts.ipAddress;
  if (ipAddress === undefined) {
    try { ipAddress = callerIp(await headers()); } catch { ipAddress = null; /* outside a request: no address */ }
  }
  const after: Record<string, string | number | boolean | null> = {};
  for (const [k, v] of Object.entries(info.after)) {
    if (v === undefined) continue;
    after[k] = typeof v === "string" ? v.slice(0, MAX_VALUE_LENGTH) : v;
  }
  const who = trueActor(user);
  await audit(db, { userId: who.id, label: who.label, ipAddress }, {
    action: info.kind === "exported" ? EXPORT_ACTION : DOWNLOAD_ACTION,
    entityType: info.module,
    entityId: info.entityId.slice(0, MAX_VALUE_LENGTH),
    after: withActingAs(after, who.actingAs),
  });
  return true;
}

const COULD_NOT_RECORD = msg("This could not be recorded in the audit trail, so nothing was sent. Please try again in a moment.");

/** The plain message, in the person's own language when that can be read (it never fails the answer). */
async function plainMessage(english: string): Promise<string> {
  try {
    const { getT } = await import("@/i18n/server");
    return (await getT())(english);
  } catch {
    return english;
  }
}

/**
 * For a route that sends data: call it after the person is known and allowed, and BEFORE reading or sending anything.
 *  - null  → go ahead (a staff member: nothing is written; a Developer: the entry is written).
 *  - a 503 → the Developer's entry could not be written: send the response as it is, and NOTHING else. Fails closed.
 */
export async function guardDeveloperExport(user: ViewActor, info: DeveloperExport): Promise<Response | null> {
  if (user.actorType !== "DEVELOPER") return null;
  try {
    await logDeveloperExport(user, info);
    return null;
  } catch (e) {
    traceFailure(`could not record an ${info.kind === "exported" ? "export" : "download"}; nothing was sent`, user, typeof info.after.path === "string" ? info.after.path : null, e);
    return new Response(await plainMessage(COULD_NOT_RECORD), { status: 503, headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store", "Retry-After": "10" } });
  }
}
