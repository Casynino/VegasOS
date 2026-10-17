import type { T } from "@/i18n/translate";
import type { AccessGroupView } from "./access-people";

/** "5 min ago", "2 h ago", "yesterday", "3 days ago" — worked out from the time the page was made (so the server and the browser agree). */
export function ago(then: Date, now: Date, t: T): string {
  const m = Math.max(0, Math.floor((now.getTime() - then.getTime()) / 60_000));
  if (m < 1) return t("just now");
  if (m < 60) return t("{n} min ago", { n: m });
  if (m < 24 * 60) return t("{n} h ago", { n: Math.floor(m / 60) });
  if (m < 48 * 60) return t("yesterday");
  return t("{n} days ago", { n: Math.floor(m / 1440) });
}

/**
 * The search box: people whose name, email or role (in English or in the reader's language) contains what was typed. A group with nobody
 * left is dropped. Nothing typed: everyone.
 */
export function filterGroups(groups: AccessGroupView[], query: string, t: T): AccessGroupView[] {
  const q = query.trim().toLowerCase();
  if (!q) return groups;
  return groups
    .map((g) => ({
      ...g,
      people: g.people.filter((p) => [p.fullName, p.email, p.roleName, t(p.roleName), g.roleName, t(g.roleName)].some((x) => x.toLowerCase().includes(q))),
    }))
    .filter((g) => g.people.length > 0);
}
