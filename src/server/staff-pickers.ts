import type { Prisma } from "@/generated/prisma/client";
import { DEVELOPER_ROLE_CODE } from "@/lib/permissions";

/**
 * Who staff are allowed to see and pick (owner, 2026-10-14).
 *
 * The Developer account holds nearly every right, so every list that finds people "by what they may do" (who can take a guest
 * request, who can drive, who can serve a table…) would otherwise offer it. The Developer is not part of the hotel's team: it is
 * never listed to other staff, and nobody can give it work — not from a list and not by sending its id directly. The online-payment
 * system account is not a person either. (The Developer still sees and runs everything itself; this only keeps it out of OTHER
 * people's pickers and rosters. The audit pages are the exception: they list everyone, the Developer included.)
 */

/** The role of the account that records online payments — a system account, not a person. */
export const SYSTEM_ROLE_CODE = "SYSTEM_ONLINE";

/** Role codes that are never offered as a person to pick or assign. */
export const NOT_PICKABLE_ROLE_CODES: readonly string[] = [DEVELOPER_ROLE_CODE, SYSTEM_ROLE_CODE];

/** True for a role whose accounts can be given work (not the Developer's, not the system account's). */
export const isPickableRole = (roleCode: string) => !NOT_PICKABLE_ROLE_CODES.includes(roleCode);

/** `where` fragment: not the Developer account. Combine with {@link withoutDeveloper} — never spread it next to another `role` filter. */
export const notDeveloper: Prisma.UserWhereInput = { role: { code: { not: DEVELOPER_ROLE_CODE } } };

/** `where` fragment: a person on the team — not the Developer account, not the system account. */
export const operationalUser: Prisma.UserWhereInput = { role: { code: { notIn: [...NOT_PICKABLE_ROLE_CODES] } } };

/** Your own user filter, plus "not the Developer". Safe next to a `role` filter of your own (it is combined with AND, never merged). */
export const withoutDeveloper = (where: Prisma.UserWhereInput = {}): Prisma.UserWhereInput => ({ AND: [where, notDeveloper] });

/** Your own user filter, plus "a person on the team" (no Developer, no system account). */
export const operationalOnly = (where: Prisma.UserWhereInput = {}): Prisma.UserWhereInput => ({ AND: [where, operationalUser] });
