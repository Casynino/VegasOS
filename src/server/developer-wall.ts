import "server-only";
import { db } from "./db";
import { audit } from "./audit";
import { AppError } from "./errors";

/**
 * THE MONEY WALL, inside the services (owner, 2026-10-14).
 *
 * The Developer account holds the Boss-level dashboard rights so that it can LOOK at every dashboard, but it never DECIDES about
 * money: no discounts, free nights, leaving owing, billing a room, prices, limits, approvals of spending. The server actions
 * stop it first (authorizeDecision in auth.ts); the services stop it too, so a decision can never be reached by another way in.
 *
 * A service sees the acting person as a set of rights, not as a signed-in user — and "developer.access" is held by the Developer
 * role alone (never the Boss, the MD or any staff role), so it names the Developer exactly. Nothing here changes what anyone
 * else may do: for everyone else every function below does nothing.
 */

/** Said to the Developer (and the same words as authorizeDecision in auth.ts). */
export const DEVELOPER_DECISION_REFUSAL = "The Developer account cannot make this decision. Use the Boss, the MD or a manager account.";

type Who = { userId?: string | null; label?: string; ipAddress?: string | null; permissions?: ReadonlySet<string> | null };

/** True when the person acting is the Developer account. */
export const actsAsDeveloper = (actor: { permissions?: ReadonlySet<string> | null } | null | undefined): boolean => !!actor?.permissions?.has("developer.access");

/** What a refused Developer looks like in the audit trail: the same entry the actions write ("developer.denied", kind "action"). */
async function logRefusal(actor: Who, needs: string[]) {
  try {
    let path: string | null = null;
    try { path = (await (await import("next/headers")).headers()).get("x-pathname"); } catch { /* no request around (a job, a test) */ }
    // The audit entry is written on its own connection, so it stays even when the service's own transaction is rolled back by the refusal.
    await audit(db, actor, { action: "developer.denied", entityType: "Permission", entityId: needs.join(","), after: { kind: "action", needs, path } });
  } catch { /* the audit trail must never break a request */ }
}

/**
 * Refuse the Developer: write the refusal to the audit trail and throw FORBIDDEN. Does nothing for anyone else.
 * `needs` names the rights the gate was built on (what the Developer "held" but may not use to decide).
 */
export async function refuseDeveloper(actor: Who | null | undefined, needs: string | readonly string[]): Promise<void> {
  if (!actor || !actsAsDeveloper(actor)) return;
  await logRefusal(actor, typeof needs === "string" ? [needs] : [...needs]);
  throw new AppError(DEVELOPER_DECISION_REFUSAL, "FORBIDDEN");
}

/** The rights that make a person a manager / the MD / the owner — the "may decide" gate. */
export const DECIDER_RIGHTS = ["dashboard.manager", "dashboard.owner", "dashboard.admin"] as const;
