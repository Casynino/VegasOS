/**
 * WHO DID IT, as an audit line says it (owner, 2026-10-18: "if the Developer does something while working as someone, the record shows the
 * DEVELOPER did it, just like the others"). A pure function with no server code in it, so a screen, a report and a client component can all use it.
 *
 * An entry written while the Developer works as Neema carries the Developer's id, the type DEVELOPER and the label
 * "Nino (Developer) as Neema (Receptionist)". Screens used to print `user.fullName ?? actorLabel` (which says only "Nino" for such a row) or cut the
 * label at the first "(" (which turns it into "Nino"). This always gives the whole truth for a Developer row.
 */
export interface WhoInput {
  actorType?: string | null;
  actorLabel?: string | null;
  /** The name of the account the entry belongs to (the `user` relation), when the query joined it. */
  userName?: string | null;
}
export interface Who {
  /** What to print as the name of the person: the whole label for a Developer ("Nino (Developer) as Neema (Receptionist)"), the plain name for anyone else. */
  name: string | null;
  developer: boolean;
  /** "Neema (Receptionist)" when the Developer worked as someone; null otherwise. */
  as: string | null;
}

const AS = /\s\(Developer\)\sas\s(.+)$/;

export function auditWho(row: WhoInput): Who {
  if (row.actorType === "DEVELOPER") {
    const label = (row.actorLabel ?? "").trim();
    const m = AS.exec(label);
    if (m) return { name: label, developer: true, as: m[1] };
    const base = label || row.userName || "";
    return { name: base ? (/\(Developer\)\s*$/.test(base) ? base : `${base} (Developer)`) : null, developer: true, as: null };
  }
  return { name: row.userName ?? (row.actorLabel ?? null), developer: false, as: null };
}

/** A name without the role the account carries in brackets ("Neema (Receptionist)" → "Neema") — but NEVER for a Developer's line, whose brackets say who really acted. */
export function plainWho(who: Who): string | null {
  if (who.name === null) return null;
  return who.developer ? who.name : who.name.replace(/\s*\(.*?\)/g, "").trim() || who.name;
}
