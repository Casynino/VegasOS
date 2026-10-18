import "server-only";
import { redirect } from "next/navigation";
import { requirePagePermission, requireUser, type CurrentUser } from "@/server/auth";
import { accessPeople, accountRoleChoices } from "@/server/services/work-as";
import { staffHome } from "@/lib/staff-home";
import type { AccessGroupView } from "./access-people";

export interface AccessPageData {
  user: CurrentUser;
  /** How many accounts are listed. */
  count: number;
  groups: AccessGroupView[];
  /** The roles an account can be given from "Add an account" (every role but the Developer's and the system's). */
  roles: { id: string; name: string }[];
}

/**
 * Everything the Access page needs, and who may see it. The people come from the server's own list (accessPeople: every account
 * except the Developer and the system account, grouped by role, the Boss first) — and it is asked again for the Developer in the session,
 * never for whoever the page says.
 *
 * Who may open it: only a Developer who is NOT working as someone. While working as someone the person gets that person's own home — the
 * console and the "Work as" world stay apart; the way back is the Stop button.
 */
export async function loadAccessPage(): Promise<AccessPageData> {
  const current = await requireUser();
  if (current.workAs) redirect(staffHome(current.permissions));
  const user = await requirePagePermission("developer.access");

  const rows = await accessPeople(user);
  const groups: AccessGroupView[] = rows.map((g) => ({
    roleCode: g.roleCode,
    roleName: g.roleName,
    roleDescription: g.roleDescription,
    people: g.people.map((p) => ({
      id: p.id,
      fullName: p.fullName,
      email: p.email,
      roleName: p.roleName,
      isActive: p.isActive,
      lastSignedInAt: p.lastSignedInAt ? p.lastSignedInAt.toISOString() : null,
      canWorkAs: p.canWorkAs,
      canSuspend: p.canSuspend,
      canReactivate: p.canReactivate,
      canSignOut: p.canSignOut,
      note: p.note,
    })),
  }));
  const roles = (await accountRoleChoices(user)).map((r) => ({ id: r.id, name: r.name }));
  return { user, groups, roles, count: groups.reduce((n, g) => n + g.people.length, 0) };
}
