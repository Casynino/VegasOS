import "server-only";
import { cache } from "react";
import { cookies, headers } from "next/headers";
import { redirect } from "next/navigation";
import { createHash, randomBytes } from "node:crypto";
import { hash, verify } from "@node-rs/argon2";
import { db } from "./db";
import { AppError } from "./errors";
import { isRestaurantDevice, needsOwnShift, SHIFT_FREE_CODES, type PermissionCode } from "@/lib/permissions";

export const STAFF_HINT_COOKIE = "vlh_staff";
export const SESSION_COOKIE = "vlh_session";
const SESSION_HOURS = 14; // covers a full reception shift
const SLIDING_REFRESH_MINUTES = 15;
/** The shared restaurant screen stays signed in: 30 days from its last use, renewed while it is used. */
const DEVICE_SESSION_DAYS = 30;
/** Its cookie lives as long as a browser allows; the server's expiry above is what counts. */
const DEVICE_COOKIE_DAYS = 400;

// OWASP-recommended argon2id parameters.
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 } as const;

export function hashPassword(password: string): Promise<string> {
  return hash(password, ARGON_OPTS);
}

export async function verifyPassword(passwordHash: string, password: string): Promise<boolean> {
  try {
    return await verify(passwordHash, password);
  } catch {
    return false;
  }
}

export function validatePasswordStrength(password: string): string | null {
  if (password.length < 10) return "Password must be at least 10 characters.";
  if (!/[A-Za-z]/.test(password) || !/\d/.test(password)) {
    return "Password must contain letters and numbers.";
  }
  return null;
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

export async function requestMeta(): Promise<{ ipAddress: string | null; userAgent: string | null }> {
  const h = await headers();
  const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
  return { ipAddress: forwarded || h.get("x-real-ip") || null, userAgent: h.get("user-agent") };
}

export async function createSession(userId: string): Promise<void> {
  const token = randomBytes(32).toString("base64url");
  const perms = await db.permission.findMany({ where: { roles: { some: { role: { users: { some: { id: userId } } } } } }, select: { code: true } });
  const device = isRestaurantDevice(new Set(perms.map((p) => p.code)));
  const expiresAt = new Date(Date.now() + (device ? DEVICE_SESSION_DAYS * 24 : SESSION_HOURS) * 3600_000);
  const cookieExpires = device ? new Date(Date.now() + DEVICE_COOKIE_DAYS * 24 * 3600_000) : expiresAt;
  const meta = await requestMeta();
  await db.session.create({
    data: { tokenHash: sha256(token), userId, expiresAt, ipAddress: meta.ipAddress, userAgent: meta.userAgent },
  });
  const jar = await cookies();
  jar.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: cookieExpires,
  });
  // A hint, not a credential: lets the public site show "Dashboard" instead of "Login".
  jar.set(STAFF_HINT_COOKIE, "1", { httpOnly: false, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: cookieExpires });
}

/**
 * The restaurant screen's cookies, set again with a fresh expiry — from a route the screen calls all
 * day (route handlers can write cookies; pages cannot), so the browser never drops them either.
 */
export async function refreshDeviceCookies(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return;
  const expires = new Date(Date.now() + DEVICE_COOKIE_DAYS * 24 * 3600_000);
  const secure = process.env.NODE_ENV === "production";
  jar.set(SESSION_COOKIE, token, { httpOnly: true, secure, sameSite: "lax", path: "/", expires });
  jar.set(STAFF_HINT_COOKIE, "1", { httpOnly: false, secure, sameSite: "lax", path: "/", expires });
}

export async function destroySession(): Promise<void> {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (token) await db.session.deleteMany({ where: { tokenHash: sha256(token) } });
  jar.delete(SESSION_COOKIE);
  jar.delete(STAFF_HINT_COOKIE);
}

/** Hash of this browser's session token (to tell "this device" apart from others). */
export async function currentSessionTokenHash(): Promise<string | null> {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  return token ? sha256(token) : null;
}

export interface CurrentUser {
  id: string;
  email: string;
  fullName: string;
  roleCode: string;
  roleName: string;
  mustChangePassword: boolean;
  /** Switched the alert bell off (for them, everywhere). */
  soundOff: boolean;
  permissions: ReadonlySet<PermissionCode>;
}

/** The authenticated staff user for this request, or null. Cached per request. */
export const getCurrentUser = cache(async (): Promise<CurrentUser | null> => {
  const jar = await cookies();
  const token = jar.get(SESSION_COOKIE)?.value;
  if (!token) return null;

  const session = await db.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: {
      user: { include: { role: { include: { permissions: { include: { permission: true } } } } } },
    },
  });
  if (!session || session.expiresAt < new Date() || !session.user.isActive) return null;

  const { user } = session;
  const permissions = new Set(user.role.permissions.map((rp) => rp.permission.code as PermissionCode));
  const device = isRestaurantDevice(permissions);
  // Only the restaurant screen keeps a long session: anyone else (a role changed since) is back to 14 hours.
  if (!device && Date.now() > session.createdAt.getTime() + SESSION_HOURS * 3600_000) return null;
  if (Date.now() - session.lastSeenAt.getTime() > SLIDING_REFRESH_MINUTES * 60_000) {
    // The shared restaurant screen never signs itself out while it is in use.
    const renew = device ? { expiresAt: new Date(Date.now() + DEVICE_SESSION_DAYS * 24 * 3600_000) } : {};
    await db.session.update({ where: { id: session.id }, data: { lastSeenAt: new Date(), ...renew } });
  }

  return {
    id: user.id,
    email: user.email,
    fullName: user.fullName,
    roleCode: user.role.code,
    roleName: user.role.name,
    mustChangePassword: user.mustChangePassword,
    soundOff: user.alertSoundOff,
    permissions,
  };
});

export function can(user: CurrentUser | null, permission: PermissionCode): boolean {
  return !!user && user.permissions.has(permission);
}

/** For pages/layouts: redirect to login when signed out. */
export async function requireUser(): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/staff/login");
  return user;
}

/** The person's own open reception shift, if any (one small query, once per request). */
export const getMyOpenShift = cache(async (userId: string) =>
  db.actualShift.findFirst({ where: { userId, endedAt: null, department: "RECEPTION" }, select: { id: true, businessDate: true, startedAt: true } }));

/**
 * A receptionist does reception work only inside their own open shift: every page and action of
 * theirs goes through here. Starting / closing the shift, its notes and their own shifts and
 * collections (any shifts.* code) stay open — so does their account (no code at all).
 */
async function withoutShift(user: CurrentUser, anyOf: PermissionCode[]) {
  if (!anyOf.length || !needsOwnShift(user.permissions) || anyOf.some((p) => SHIFT_FREE_CODES.has(p))) return false;
  return !(await getMyOpenShift(user.id));
}

/** For pages: redirect when the permission is missing — and a receptionist without an open shift to "Start shift". */
export async function requirePagePermission(...anyOf: PermissionCode[]): Promise<CurrentUser> {
  const user = await requireUser();
  if (!anyOf.some((p) => user.permissions.has(p))) redirect("/staff/forbidden");
  if (await withoutShift(user, anyOf)) {
    const path = (await headers()).get("x-pathname");
    redirect(`/staff/start-shift${path && /^\/(staff|reception)\//.test(path) ? `?next=${encodeURIComponent(path)}` : ""}`);
  }
  return user;
}

/** For server actions and route handlers: throw when not permitted (a receptionist: also without an open shift). */
export async function authorize(...anyOf: PermissionCode[]): Promise<CurrentUser> {
  const user = await getCurrentUser();
  if (!user) throw new AppError("Your session has expired. Please sign in again.", "UNAUTHENTICATED");
  if (anyOf.length && !anyOf.some((p) => user.permissions.has(p))) {
    throw new AppError("You do not have permission to do this.", "FORBIDDEN");
  }
  if (await withoutShift(user, anyOf)) throw new AppError("You have no active shift — start your shift (or ask a manager) before doing reception work.", "FORBIDDEN");
  return user;
}
