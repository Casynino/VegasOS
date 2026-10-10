import { Building2, Home, Landmark, PartyPopper, Users, Users2, type LucideIcon } from "lucide-react";
import type { GroupType } from "@/generated/prisma/enums";
import { msg } from "@/i18n/msg";

/** The kinds of group, in the order the booking form shows them. */
export const GROUP_TYPES: { v: GroupType; label: string; hint: string; icon: LucideIcon }[] = [
  { v: "COMPANY", label: msg("Company"), hint: msg("Boss & staff, a team"), icon: Building2 },
  { v: "FAMILY", label: msg("Family"), hint: msg("Parents, children…"), icon: Home },
  { v: "ORGANIZATION", label: msg("Organization"), hint: msg("NGO, church, school"), icon: Users2 },
  { v: "GOVERNMENT", label: msg("Government"), hint: msg("Ministry, agency"), icon: Landmark },
  { v: "EVENT", label: msg("Event"), hint: msg("Wedding, conference"), icon: PartyPopper },
  { v: "OTHER", label: msg("Other"), hint: msg("Tour, team, other"), icon: Users },
];
export const GROUP_TYPE = Object.fromEntries(GROUP_TYPES.map((t) => [t.v, t])) as Record<GroupType, (typeof GROUP_TYPES)[number]>;

/** The group's status for reception and finance: its stay, then its final bill. */
export const GROUP_STATUS: Record<string, { label: string; cls: string }> = {
  UPCOMING: { label: msg("Upcoming"), cls: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  ACTIVE: { label: msg("Active"), cls: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  PARTIALLY_CHECKED_OUT: { label: msg("Partially checked out"), cls: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  READY_FOR_FINAL_INVOICE: { label: msg("Ready for final invoice"), cls: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  FINAL_INVOICE_GENERATED: { label: msg("Final invoice generated"), cls: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300" },
  PARTIALLY_PAID: { label: msg("Partially paid"), cls: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  OUTSTANDING: { label: msg("Outstanding"), cls: "bg-rose-500/12 text-rose-700 dark:text-rose-300" },
  CLOSED: { label: msg("Paid · closed"), cls: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  CANCELLED: { label: msg("Cancelled"), cls: "bg-muted text-muted-foreground" },
};

/** How each kind of group / account is called in the forms ("New family", "Family account", "Family name"…). */
export const ACCOUNT_WORD: Record<GroupType, { one: string; title: string; placeholder: string; people: string }> = {
  COMPANY: { one: msg("company"), title: msg("Company"), placeholder: "PORT TANZANIA LTD", people: msg("People from this company") },
  FAMILY: { one: msg("family"), title: msg("Family"), placeholder: msg("Chuwa family"), people: msg("People in this family") },
  ORGANIZATION: { one: msg("organization"), title: msg("Organization"), placeholder: msg("Tanzania Red Cross"), people: msg("People from this organization") },
  GOVERNMENT: { one: msg("government office"), title: msg("Government office"), placeholder: msg("Ministry of Health"), people: msg("People from this office") },
  EVENT: { one: msg("event"), title: msg("Event"), placeholder: msg("Wedding — Juma & Neema"), people: msg("People at this event") },
  OTHER: { one: msg("group"), title: msg("Group"), placeholder: "ABC Tours", people: msg("People in this group") },
};
