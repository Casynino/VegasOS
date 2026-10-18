import "server-only";
import { rawDb } from "../db";
import { audit } from "../audit";
import { inTurn } from "../in-turn";
import { WORK_AS_HOURS } from "../work-as-session";

/**
 * WORK AS THAT ENDS BY ITSELF (owner, 2026-10-17): a Developer's "work as" stops without anyone pressing Stop — its 4 hours are over,
 * the person's account was switched off or removed, or the Developer's own session ended. The start and the Stop are in the audit trail;
 * this writes the third way it can end, so a start is never left without an end: ONE "developer.work_as_expired" entry, as the Developer.
 *
 * Whoever notices first writes it, so a start never stays without an end:
 *  - the page load that finds the work-as dropped (see loadSession in auth.ts), or the next "Work as" start; or
 *  - the clean-up that removes the session when NO request ever comes — the daily cron's delete of expired sessions, a new password or
 *    "sign out my other devices" that ends the Developer's other sessions, a new sign-in that replaces the browser's old session (see
 *    session-cleanup.ts: it writes this entry just before each of those deletes).
 * The clearing of the session's work-as fields is the claim, so two of them at the same moment still make ONE entry. The claim and the
 * entry are one transaction. Best effort: it never breaks the request or the clean-up that noticed (when a request-side attempt fails,
 * the next request tries again).
 */
export type WorkAsEnd = "limit" | "account" | "session";

const WHY: Record<WorkAsEnd, string> = {
  limit: "The 4-hour limit was reached.",
  account: "The person's account was switched off or removed.",
  session: "The Developer's session ended (it expired, was signed out, or was not used for too long).",
};

/** The work-as fields of a session row, as they were read. */
export interface WorkAsFields {
  /** The session row. */
  id: string;
  workAsUserId: string | null;
  workAsStartedAt: Date | null;
}

/** Does this session row carry a work-as at all? (A removed person leaves the start time behind with no person: that counts.) */
export const carriesWorkAs = (s: Pick<WorkAsFields, "workAsUserId" | "workAsStartedAt">): boolean => !!s.workAsUserId || !!s.workAsStartedAt;

/** The Developer's work-as dropped by itself: clear it and write the entry. Returns true when THIS call wrote the entry. Never throws. */
export async function recordWorkAsEnded(session: WorkAsFields, developer: { id: string; fullName: string }, why: WorkAsEnd, ipAddress: string | null = null): Promise<boolean> {
  if (!carriesWorkAs(session)) return false;
  try {
    // (Requests for the same session wait their turn here, before a database connection is taken — see in-turn.ts.)
    return await inTurn(`work-as-ended:${session.id}`, () => rawDb.$transaction(async (tx) => {
      const claimed = await tx.session.updateMany({
        where: { id: session.id, workAsUserId: session.workAsUserId, workAsStartedAt: session.workAsStartedAt },
        data: { workAsUserId: null, workAsStartedAt: null },
      });
      if (claimed.count !== 1) return false; // someone else cleared it (and wrote the entry) first
      const target = session.workAsUserId ? await tx.user.findUnique({ where: { id: session.workAsUserId }, select: { fullName: true, role: { select: { name: true } } } }) : null;
      const elapsed = session.workAsStartedAt ? Math.max(0, Math.round((Date.now() - session.workAsStartedAt.getTime()) / 60_000)) : null;
      await audit(tx, { userId: developer.id, label: developer.fullName, ipAddress }, {
        action: "developer.work_as_expired", entityType: "User", entityId: session.workAsUserId,
        // "minutes" is the time it could have run: never more than the 4 hours (the entry may be written long after it ended).
        after: { targetName: target?.fullName ?? null, targetRole: target?.role.name ?? null, minutes: elapsed === null ? null : Math.min(elapsed, WORK_AS_HOURS * 60), endedBy: why, reason: WHY[why] },
      });
      return true;
    }));
  } catch {
    return false; // the audit trail must never break the request that noticed
  }
}
