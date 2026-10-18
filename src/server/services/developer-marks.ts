import "server-only";
import { db } from "../db";
import { isFailureEntry } from "./audit-trail";

/**
 * "DONE BY DEVELOPER" (owner, 2026-10-18: a record the Developer makes while working as someone must say the Developer did it, like every
 * other person's records say who did them). No new table and no change to any stored author: the audit row IS the mark. Every write the
 * Developer makes while working as Neema is stored as an audit row of the type DEVELOPER, keyed by the record it changed (entityType + entityId),
 * with `after.actingAs` = who he acted as (see src/server/audit.ts asWhoReallyActed). A screen that shows who did something asks this
 * file whether such a row exists for the record and, if so, shows a small "Done by Developer" tag NEXT TO the name (never inside it).
 * The business flows keep using the stored author ids (shifts, "my orders", credit for check-ins): nothing here changes them.
 *
 * Read-only. No mark means "no evidence", never "a staff member did it". Rows of the Developer's own console use (`developer.*`), failed or
 * refused attempts and rows of another kind of actor never make a mark.
 */
export interface DeveloperMark {
  action: string;
  at: Date;
  /** Who he acted as ({ name: "Neema", role: "Receptionist" }), null when the entry does not say. */
  as: { id: string | null; name: string | null; role: string | null } | null;
  /** The whole audit label, "Nino (Developer) as Neema (Receptionist)". */
  label: string | null;
}

/** The actions that mean "this record was made" / "this guest was checked in" / "checked out" (a walk-in does both at once). */
export const MARK_CREATED = ["reservation.created", "reservation.walk_in", "meeting.booked"] as const;
export const MARK_CHECKED_IN = ["reservation.checked_in", "reservation.walk_in", "meeting.started"] as const;
export const MARK_CHECKED_OUT = ["reservation.checked_out", "meeting.completed"] as const;

const CHUNK = 500;
const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

function actedAs(after: unknown, label: string | null): DeveloperMark["as"] {
  const a = isRec(after) && isRec(after.actingAs) ? after.actingAs : null;
  if (a) return { id: str(a.id), name: str(a.name), role: str(a.role) };
  const m = label ? /\s\(Developer\)\sas\s(.+?)(?:\s\((.+)\))?$/.exec(label) : null;
  return m ? { id: null, name: m[1], role: m[2] ?? null } : null;
}

/**
 * The Developer's marks for a list of records of one kind, oldest first, in ONE query per 500 ids (the (entityType, entityId) index).
 * `actions` narrows to what the line is about ("checked in by" asks for MARK_CHECKED_IN). Ids may repeat or be empty.
 */
export async function developerMarks(entityType: string, ids: readonly (string | null | undefined)[], opts: { actions?: readonly string[] } = {}): Promise<Map<string, DeveloperMark[]>> {
  const distinct = [...new Set(ids.filter((x): x is string => !!x))];
  const out = new Map<string, DeveloperMark[]>();
  for (let i = 0; i < distinct.length; i += CHUNK) {
    const rows = await db.auditLog.findMany({
      where: {
        entityType, entityId: { in: distinct.slice(i, i + CHUNK) }, actorType: "DEVELOPER", NOT: { action: { startsWith: "developer." } },
        ...(opts.actions ? { action: { in: [...opts.actions] } } : {}),
      },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { entityId: true, action: true, createdAt: true, actorLabel: true, after: true },
    });
    for (const r of rows) {
      if (!r.entityId || isFailureEntry(r.action, r.after)) continue;
      const list = out.get(r.entityId) ?? [];
      list.push({ action: r.action, at: r.createdAt, as: actedAs(r.after, r.actorLabel), label: r.actorLabel });
      out.set(r.entityId, list);
    }
  }
  return out;
}

/**
 * The mark for ONE record: the newest that matches `actions`; with `near` (the time the record was made) the one closest in time within
 * `windowMs` (default 5 s — the audit row is written a few milliseconds after the record), for records that share their key with many others
 * (a room's status changes, a booking's room moves). With `who` (the stored author's name) only a mark made as that person counts. null = no mark.
 */
export function markFor(marks: Map<string, DeveloperMark[]>, id: string | null | undefined, opts: { actions?: readonly string[]; near?: Date; windowMs?: number; who?: string | null } = {}): DeveloperMark | null {
  if (!id) return null;
  let list = marks.get(id) ?? [];
  if (opts.actions) list = list.filter((m) => opts.actions!.includes(m.action));
  // `who` = the name the record itself carries: a Developer entry made as somebody else is not this record's mark (two people acting on one booking within seconds).
  if (opts.who !== undefined) list = list.filter((m) => sameWho(m, opts.who));
  if (list.length === 0) return null;
  if (!opts.near) return list[list.length - 1];
  const at = opts.near.getTime();
  const within = list.filter((m) => Math.abs(m.at.getTime() - at) <= (opts.windowMs ?? 5_000));
  if (within.length === 0) return null;
  return within.reduce((best, m) => (Math.abs(m.at.getTime() - at) < Math.abs(best.at.getTime() - at) ? m : best));
}

/** Two names are the same person's (one holds the other: "Neema" and "Neema · Restaurant Counter"); an unknown name does not argue. */
export function sameWho(mark: DeveloperMark, by: string | null | undefined): boolean {
  const as = mark.as?.name?.trim().toLowerCase();
  const b = by?.trim().toLowerCase();
  return !as || !b || as.includes(b) || b.includes(as);
}
