import type { T } from "@/i18n/translate";
import { auditWho, plainWho } from "@/lib/audit-who";
import { doneByText } from "@/lib/done-by-text";

/**
 * WHO an audit-derived line says did it, and the words of the "Done by Developer" tag that belongs next to the name (owner, 2026-10-18).
 * For the screens and services that list audit rows ("What the team is doing", the booking's history, the guest's history…): the row itself
 * says whether the Developer acted, so no second lookup is needed. Pure (no server code): a service can call it and hand the finished
 * words down to a client component.
 *
 * - `name`: a staff member's name; for a Developer's row the WHOLE label ("Nino (Developer) as Neema (Receptionist)") — never cut at a bracket.
 *   `plain: true` cuts the role from a STAFF name ("Neema (Receptionist)" → "Neema") for the lines that always did, and still never a Developer's.
 * - `doneBy`: "Done by Developer · as Neema" when the Developer worked as someone, else null. It is shown NEXT TO the name, never inside it.
 */
export interface LineWhoRow {
  actorType?: string | null;
  actorLabel?: string | null;
  /** The entry's "after" (it holds `actingAs` for a Developer working as someone). Optional: the label says it too. */
  after?: unknown;
  /** The name of the account the entry belongs to (the `user` relation), when the query joined it. */
  user?: { fullName?: string | null } | null;
  userName?: string | null;
}
export interface LineWho {
  name: string | null;
  developer: boolean;
  /** "Neema" — who the Developer acted as, when known. */
  asName: string | null;
  /** "Neema (Receptionist)" — the same with the role, as the label has it; null when the Developer did not work as someone. */
  as: string | null;
  doneBy: string | null;
}

const isRec = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const LABEL_AS = /\s\(Developer\)\sas\s(.+?)(?:\s\([^()]*\))?$/;

/** Who a Developer's entry says he acted as ("Neema"), from `after.actingAs`, else from the label. */
export function actedAsName(after: unknown, label: string | null | undefined): string | null {
  const a = isRec(after) && isRec(after.actingAs) ? after.actingAs : null;
  const n = a && typeof a.name === "string" && a.name.trim() ? a.name.trim() : null;
  if (n) return n;
  const m = label ? LABEL_AS.exec(label.trim()) : null;
  return m ? m[1] : null;
}

export function lineWho(t: T, row: LineWhoRow, opts: { plain?: boolean } = {}): LineWho {
  const who = auditWho({ actorType: row.actorType, actorLabel: row.actorLabel, userName: row.user?.fullName ?? row.userName ?? null });
  const asName = who.developer && who.as ? actedAsName(row.after, row.actorLabel) : null;
  return {
    name: opts.plain ? plainWho(who) : who.name,
    developer: who.developer,
    asName,
    as: who.as,
    doneBy: asName ? doneByText(t, { as: { id: null, name: asName, role: null } }) : null,
  };
}
