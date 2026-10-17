import { createHash, randomBytes, randomInt, randomUUID } from "node:crypto";

// The database client is loaded on first use, never at the top: next/headers is mocked with a factory that imports THIS file, and the
// client (server/db.ts) now reads the request's cookie through next/headers for the "work as" write fence — a top-level import here
// would make the two wait for each other forever (every test that mocks next/headers would hang on its first import).
const getDb = async () => (await import("@/server/db")).db;

/**
 * Small helpers for the Developer-account tests: a fake browser (cookies + request headers behind the mocked
 * next/headers), real users with real password hashes, and sessions written straight into the database.
 *
 * This module must not import anything that imports next/headers at the top (the mock factories import THIS file) —
 * the one app helper it needs (hashPassword) is loaded lazily.
 */

export const SESSION_COOKIE = "vlh_session";

const randomIp = () => `41.${randomInt(256)}.${randomInt(256)}.${randomInt(1, 255)}`;

/** One fake browser: the cookies it holds and the headers its next request carries. */
export const browser = {
  cookies: new Map<string, string>(),
  /** What the app asked each cookie to be (httpOnly, expires…), by cookie name. */
  cookieOptions: new Map<string, Record<string, unknown>>(),
  headers: new Headers(),
  ip: "",
  /** A new, empty browser (no cookies) on a fresh address. */
  reset(ip: string = randomIp()) {
    this.cookies = new Map();
    this.cookieOptions = new Map();
    this.ip = ip;
    this.headers = new Headers({ "x-forwarded-for": ip, "user-agent": "vitest" });
  },
  /** Copy of what this browser holds right now (to put it back later — "another browser"). */
  save() {
    return { cookies: new Map(this.cookies), cookieOptions: new Map(this.cookieOptions) };
  },
  restore(saved: { cookies: Map<string, string>; cookieOptions: Map<string, Record<string, unknown>> }) {
    this.cookies = new Map(saved.cookies);
    this.cookieOptions = new Map(saved.cookieOptions);
  },
  get sessionToken() { return this.cookies.get(SESSION_COOKIE) ?? null; },
};
browser.reset();

/** The mocked `cookies()` of next/headers. */
export const fakeCookies = async () => ({
  get: (name: string) => (browser.cookies.has(name) ? { name, value: browser.cookies.get(name)! } : undefined),
  set: (name: string, value: string, options?: Record<string, unknown>) => { browser.cookies.set(name, value); browser.cookieOptions.set(name, options ?? {}); },
  delete: (name: string) => { browser.cookies.delete(name); browser.cookieOptions.delete(name); },
});
/** The mocked `headers()` of next/headers. */
export const fakeHeaders = async () => browser.headers;

/** What next/navigation's redirect() does inside a request: it throws. */
export class Redirected extends Error {
  constructor(public readonly url: string) { super(`NEXT_REDIRECT ${url}`); }
}
export const redirectMock = (url: string): never => { throw new Redirected(url); };
/** Run something that may call redirect(); the address it went to, or null when it did not redirect. */
export async function redirectOf(run: () => Promise<unknown>): Promise<string | null> {
  try { await run(); return null; } catch (e) { if (e instanceof Redirected) return e.url; throw e; }
}
/** The error a call throws (or null). */
export async function thrownBy(run: () => Promise<unknown>): Promise<unknown> {
  try { await run(); return null; } catch (e) { return e; }
}

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

const made: string[] = [];

export interface MadeUser { id: string; email: string; fullName: string; password: string; role: string }

/** A real account (real argon2 hash) with a known password. Removed again by removeMadeUsers(). */
export async function makeUser(role: string, opts: { fullName?: string; password?: string; isActive?: boolean } = {}): Promise<MadeUser> {
  const { hashPassword } = await import("@/server/auth");
  const db = await getDb();
  const r = await db.role.findUniqueOrThrow({ where: { code: role } });
  const password = opts.password ?? `Tst${randomUUID().slice(0, 8)}-9x`;
  const email = `t-${randomUUID().slice(0, 10)}@devtest.local`;
  const u = await db.user.create({
    data: { email, fullName: opts.fullName ?? `Test ${role} ${randomUUID().slice(0, 4)}`, roleId: r.id, passwordHash: await hashPassword(password), isActive: opts.isActive ?? true, mustChangePassword: false },
  });
  made.push(u.id);
  return { id: u.id, email, fullName: u.fullName, password, role };
}

export async function setRole(userId: string, role: string) {
  const db = await getDb();
  const r = await db.role.findUniqueOrThrow({ where: { code: role } });
  await db.user.update({ where: { id: userId }, data: { roleId: r.id } });
}

/** Remove the accounts this file made (their sessions go with them; the audit rows stay, with the link to the account blanked by the database). */
export async function removeMadeUsers() {
  if (!made.length) return;
  const db = await getDb();
  await db.user.deleteMany({ where: { id: { in: made.splice(0) } } });
}

/** A session row written straight into the database (ages in minutes), and — by default — the cookie for it in the fake browser. */
export async function makeSession(userId: string, opts: { createdMinAgo?: number; seenMinAgo?: number; expiresInMin?: number; setCookie?: boolean } = {}): Promise<string> {
  const db = await getDb();
  const token = randomBytes(32).toString("base64url");
  const now = Date.now();
  const min = 60_000;
  await db.session.create({
    data: {
      tokenHash: sha256(token), userId,
      createdAt: new Date(now - (opts.createdMinAgo ?? 0) * min),
      lastSeenAt: new Date(now - (opts.seenMinAgo ?? 0) * min),
      expiresAt: new Date(now + (opts.expiresInMin ?? 24 * 60) * min),
    },
  });
  if (opts.setCookie ?? true) browser.cookies.set(SESSION_COOKIE, token);
  return token;
}

/** The audit entries written by one account, oldest first (optionally only one action). */
export async function auditOf(userId: string, action?: string) {
  const db = await getDb();
  return db.auditLog.findMany({ where: { userId, ...(action ? { action } : {}) }, orderBy: { createdAt: "asc" } });
}

export async function dropLoginBuckets(...keys: string[]) {
  const db = await getDb();
  if (keys.length) await db.rateLimitBucket.deleteMany({ where: { key: { in: keys } } });
}
