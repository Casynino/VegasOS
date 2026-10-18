import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { rawDb } from "../db";
import { DEVELOPER_ROLE_CODE } from "@/lib/permissions";
import { recordWorkAsEnded } from "./work-as-expired";

/**
 * SESSIONS THAT ARE REMOVED WITHOUT A REQUEST (owner, 2026-10-17): the housekeeping that deletes expired sessions, a new password or
 * "sign out my other devices" that ends a person's other sessions, a new sign-in that replaces the browser's old session. Nobody opens
 * a page on a session that is deleted, so the first-request rule of work-as-expired.ts could never write its line for it — a Developer's
 * "work as" would have a start and no end.
 *
 * So every one of those deletes first calls recordWorkAsOfSessionsEnding(): for each Developer session about to go that still carries a
 * work-as, ONE "developer.work_as_expired" entry (reason "session ended"), as the Developer. Best effort and per row: a row that fails
 * never stops the others, the delete, or the cron — the audit trail must never break the housekeeping.
 */

/** The most rows one clean-up writes entries for (a Developer holds one session at a time; this is only a safety bound). */
const MOST_AT_ONCE = 500;

/**
 * Write the "work as ended" entry for every session matching `where` that belongs to a Developer and still carries a work-as. Returns how
 * many entries this call wrote. Never throws. Call it BEFORE the delete: clearing the session's work-as fields is the claim that keeps it
 * to one entry (see recordWorkAsEnded), so a request that notices the same session at the same moment does not make a second one.
 */
export async function recordWorkAsOfSessionsEnding(where: Prisma.SessionWhereInput, ipAddress: string | null = null): Promise<number> {
  let rows;
  try {
    rows = await rawDb.session.findMany({
      where: {
        AND: [
          where,
          { OR: [{ workAsUserId: { not: null } }, { workAsStartedAt: { not: null } }] },
          // Only a Developer's own session can be working as someone (a forged row on a staff session means nothing and records nothing).
          { user: { role: { code: DEVELOPER_ROLE_CODE } } },
        ],
      },
      select: { id: true, workAsUserId: true, workAsStartedAt: true, user: { select: { id: true, fullName: true } } },
      take: MOST_AT_ONCE,
    });
  } catch {
    return 0; // the clean-up goes on without the entries
  }
  let written = 0;
  for (const row of rows) {
    try {
      if (await recordWorkAsEnded(row, row.user, "session", ipAddress)) written++;
    } catch { /* one row that fails never stops the rest */ }
  }
  return written;
}

/**
 * The housekeeping delete of the daily cron: every session past its expiry goes — after the Developer sessions among them that still
 * carried a work-as have their entry. Returns how many sessions were deleted.
 */
export async function removeExpiredSessions(now: Date = new Date()): Promise<number> {
  const where: Prisma.SessionWhereInput = { expiresAt: { lt: now } };
  await recordWorkAsOfSessionsEnding(where);
  // Housekeeping is the system's own work, not work done as someone: the plain client (no write fence).
  return (await rawDb.session.deleteMany({ where })).count;
}
