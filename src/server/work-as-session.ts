import "server-only";
import { cache } from "react";
import { createHash } from "node:crypto";
import type { PrismaClient } from "@/generated/prisma/client";
import { DEVELOPER_ROLE_CODE } from "@/lib/permissions";

/**
 * "Work as" — the one place that decides, from the database, whether THIS request is a Developer working as a staff member.
 * A leaf module (it imports no other server file) so the database client (the write fence), the audit trail (attribution) and the
 * sign-in code can all use it without a cycle.
 *
 * The rule is the same everywhere: the request's session cookie → the session row → its OWN user must hold the Developer role, the work-as
 * must be less than 4 hours old, and the person must still be an active staff account (not a Developer, not the system's own account).
 * Anything else is "not working as someone" — a forged row on a staff session, an old one or a switched-off person change nothing.
 */

export const SESSION_COOKIE = "vlh_session";
/** The online-payment account (no person behind it). Its role code is also written in services/staff-accounts.ts. */
export const SYSTEM_ROLE_CODE = "SYSTEM_ONLINE";
/** Work as ends by itself this long after it started. */
export const WORK_AS_HOURS = 4;
const WORK_AS_MS = WORK_AS_HOURS * 3600_000;

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

/** Can a Developer work as an account like this? Active, and neither a Developer nor the system's own account. */
export function canBeWorkedAs(target: { isActive: boolean; role: { code: string } }): boolean {
  return target.isActive && target.role.code !== DEVELOPER_ROLE_CODE && target.role.code !== SYSTEM_ROLE_CODE;
}

/** Is a work-as that started at `startedAt` still inside its 4 hours? (No start time = not working as.) */
export function withinWorkAsLimit(startedAt: Date | null | undefined, now: number = Date.now()): boolean {
  return !!startedAt && now - startedAt.getTime() <= WORK_AS_MS;
}

/** What the audit trail says when a Developer acts as someone: "Nino (Developer) as Neema (Receptionist)". */
export const workAsLabel = (developerName: string, targetName: string, targetRole: string) => `${developerName} (Developer) as ${targetName} (${targetRole})`;

/**
 * The mark a Developer's rights carry while it works as someone. The services recognise the Developer by the right "developer.access"
 * (server/developer-wall.ts) — and while working as someone that right is taken away (the person's own rights are given instead), so the
 * set of rights itself carries this invisible mark: the money wall inside the services keeps seeing a Developer. A copy of the set loses
 * it, which is why refuseDeveloper() ALSO asks the request itself (workAsOfRequest) — the mark is the quick check, the request the sure one.
 */
export const WORKING_AS_DEVELOPER = Symbol.for("vegas.workingAsDeveloper");
export function markWorkingAs<S extends Set<string>>(rights: S): S {
  Object.defineProperty(rights, WORKING_AS_DEVELOPER, { value: true, enumerable: false });
  return rights;
}
export const isMarkedWorkingAs = (rights: ReadonlySet<string> | null | undefined): boolean => !!rights && (rights as unknown as Record<symbol, unknown>)[WORKING_AS_DEVELOPER] === true;

/** The person a Developer is working as, written into an audit entry's "after". */
export interface ActingAs { id: string; name: string; role: string | null }

/** The true identity behind a request, whoever the screen shows: the Developer while working as someone, otherwise the person themselves. */
export interface TrueActor {
  /** The account that really acted. */
  id: string;
  name: string;
  /** The audit label: the name, or "Dev (Developer) as Neema (Receptionist)" while working as someone. */
  label: string;
  /** Set only while working as someone. */
  actingAs: ActingAs | null;
}
/** The fields of a CurrentUser this needs (so callers may pass a smaller object). */
export interface IdentityFields {
  id: string;
  fullName: string;
  roleName?: string;
  actorId?: string;
  actorName?: string;
  workAs?: object | null;
}
export function trueActor(user: IdentityFields): TrueActor {
  const id = user.actorId ?? user.id;
  const name = user.actorName ?? user.fullName;
  if (!user.workAs) return { id, name, label: name, actingAs: null };
  return { id, name, label: workAsLabel(name, user.fullName, user.roleName ?? "staff"), actingAs: { id: user.id, name: user.fullName, role: user.roleName ?? null } };
}

/** An audit entry's "after" with the person acted as added (whatever shape "after" had). */
export function withActingAs(after: unknown, actingAs: ActingAs | null): unknown {
  if (!actingAs) return after;
  if (after === undefined || after === null) return { actingAs };
  if (typeof after === "object" && !Array.isArray(after) && !(after instanceof Date)) return { ...(after as Record<string, unknown>), actingAs };
  return { value: after, actingAs };
}

/** A Developer working as someone, as the database says it is right now. */
export interface WorkAsState {
  developerId: string;
  developerName: string;
  targetId: string;
  targetName: string;
  targetRoleCode: string;
  targetRoleName: string;
  startedAt: Date;
}

type SessionReader = Pick<PrismaClient, "session">;

/**
 * A reader bound to a database client (the plain one — never the fenced one, so it cannot trip over the fence it feeds).
 * It resolves, for the request being served: null when no request is being served (a job, a webhook, a script, a test without cookies),
 * when there is no session cookie, or when the session is not a Developer working as someone; otherwise who is working as whom.
 * Cached per request (React cache, keyed by the cookie's hash — a new cookie is a new answer). A database failure is NOT turned into
 * "not working as someone": it is thrown, so a fence or an audit entry can never fail open.
 */
export function makeWorkAsReader(client: SessionReader) {
  const lookup = cache(async (tokenHash: string): Promise<WorkAsState | null> => {
    const row = await client.session.findUnique({
      where: { tokenHash },
      select: {
        expiresAt: true,
        workAsStartedAt: true,
        user: { select: { id: true, fullName: true, isActive: true, role: { select: { code: true } } } },
        workAsUser: { select: { id: true, fullName: true, isActive: true, role: { select: { code: true, name: true } } } },
      },
    });
    if (!row?.workAsUser) return null;
    if (row.expiresAt <= new Date() || !row.user.isActive || row.user.role.code !== DEVELOPER_ROLE_CODE) return null;
    if (!withinWorkAsLimit(row.workAsStartedAt) || !canBeWorkedAs(row.workAsUser)) return null;
    return {
      developerId: row.user.id, developerName: row.user.fullName,
      targetId: row.workAsUser.id, targetName: row.workAsUser.fullName, targetRoleCode: row.workAsUser.role.code, targetRoleName: row.workAsUser.role.name,
      startedAt: row.workAsStartedAt as Date,
    };
  });

  return async function workAsOfRequest(): Promise<WorkAsState | null> {
    let token: string | undefined;
    try {
      // Loaded when it is needed, not when this file is: the database client imports this file, and next/headers must not be a
      // dependency of the client's own start-up (a test's fake next/headers imports the client — a cycle that would never finish).
      const { cookies } = await import("next/headers");
      token = (await cookies()).get(SESSION_COOKIE)?.value;
    } catch {
      return null; // not inside a request: nobody is working as anyone
    }
    if (!token) return null;
    return lookup(sha256(token));
  };
}
