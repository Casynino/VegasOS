import "server-only";
import { headers } from "next/headers";
import { db } from "../db";
import { audit } from "../audit";
import { inTurn } from "../in-turn";
import type { CurrentUser } from "../auth";

/**
 * SOMEONE WHO IS NOT A DEVELOPER AT THE DEVELOPER'S DOOR (owner, 2026-10-17): a staff member who reaches for a Developer page or a
 * Developer action is refused — and it is not without a trace. One place for it, so the pages (requirePagePermission in auth.ts) and the
 * actions (requireDeveloperSession in services/work-as.ts) keep the very same entry.
 *
 * A leaf module on purpose (it takes only the type of CurrentUser from auth.ts): auth.ts imports it, and work-as.ts imports auth.ts.
 */

/** The most often one person's refused try at the Developer's pages and actions is written down: once per this many minutes. */
export const ENDPOINT_REFUSED_MINUTES = 10;
export const ENDPOINT_REFUSED_ACTION = "developer.endpoint_refused";

/** The request's address and path, or none outside a request (a job, a test without headers). Same address rule as requestMeta in auth.ts. */
async function requestFacts(): Promise<{ ipAddress: string | null; path: string | null }> {
  try {
    const h = await headers();
    const forwarded = h.get("x-forwarded-for")?.split(",")[0]?.trim();
    return { ipAddress: forwarded || h.get("x-real-ip") || null, path: h.get("x-pathname") };
  } catch {
    return { ipAddress: null, path: null };
  }
}

/**
 * Write the refusal to the audit trail under THEIR name (best effort, it never changes the answer). Bounded: at most one entry per person
 * per 10 minutes, so a loop of refused calls cannot fill the trail.
 */
export async function keepEndpointRefusal(user: Pick<CurrentUser, "actorId" | "actorName" | "roleName">): Promise<void> {
  try {
    const since = new Date(Date.now() - ENDPOINT_REFUSED_MINUTES * 60_000);
    const already = { action: ENDPOINT_REFUSED_ACTION, userId: user.actorId, createdAt: { gte: since } };
    // The common case in a loop of refused calls: this person already has an entry — answered with one small read, no transaction.
    if (await db.auditLog.findFirst({ where: already, select: { id: true } })) return;
    const { ipAddress, path } = await requestFacts();
    await inTurn(`developer-refused:${user.actorId}`, () => db.$transaction(async (tx) => {
      // One at a time per person: two refused calls at the same moment make one entry.
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`developer-refused:${user.actorId}`}))::text`;
      if (await tx.auditLog.findFirst({ where: already, select: { id: true } })) return;
      await audit(tx, { userId: user.actorId, label: user.actorName, ipAddress }, {
        action: ENDPOINT_REFUSED_ACTION, entityType: "Permission", entityId: "developer.access",
        after: { path: path && path.length <= 300 ? path : null, role: user.roleName },
      });
    }));
  } catch { /* the audit trail must never break the answer */ }
}
