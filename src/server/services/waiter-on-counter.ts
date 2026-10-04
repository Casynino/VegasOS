import "server-only";
import { db } from "../db";
import { AppError } from "../errors";
import { isRestaurantDevice, type PermissionCode } from "@/lib/permissions";
import type { Actor } from "./reservations";

/**
 * On the shared Restaurant Counter, service work is done for the waiter picked from the list ("who
 * serves it?"): an active waiter ON SHIFT (serves in the restaurant — not the Counter account, not management).
 * Returns them as the one acting, with the Counter noted. No code or password: money never goes to a
 * waiter — the Counter records it.
 */
export async function waiterOnCounter(waiterId: string, counter: { id: string; label: string }, opts: { requireShift?: boolean } = {}): Promise<Actor & { userId: string; permissions: ReadonlySet<string>; deviceUserId: string }> {
  const u = await db.user.findUnique({
    where: { id: waiterId },
    select: { id: true, fullName: true, isActive: true, role: { select: { name: true, permissions: { select: { permission: { select: { code: true } } } } } } },
  });
  const perms = new Set(u?.role.permissions.map((x) => x.permission.code as PermissionCode) ?? []);
  const waiter = !!u?.isActive && perms.has("restaurant.serve") && !isRestaurantDevice(perms)
    && !(["dashboard.manager", "dashboard.owner", "dashboard.admin"] as const).some((c) => perms.has(c));
  if (!u || !waiter) throw new AppError("Choose one of the waiters.", "VALIDATION", { pin: "Invalid" });
  // Only a waiter on shift takes work (they start it on their own phone: "Start my shift"). Handing on work
  // that is still theirs (a transfer) works whether they are on shift or not — the receiver must be.
  if (opts.requireShift !== false && !(await db.actualShift.findFirst({ where: { userId: u.id, endedAt: null, department: "RESTAURANT" }, select: { id: true } }))) {
    throw new AppError(`${u.fullName.replace(/\s*\(.*\)/, "")} is not on shift — they start their shift first.`, "VALIDATION", { pin: "Off shift" });
  }
  return { userId: u.id, label: `${u.fullName} · on ${counter.label}`, role: u.role.name, permissions: perms, deviceUserId: counter.id };
}
