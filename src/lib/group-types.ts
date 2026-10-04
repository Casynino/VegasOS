import { Building2, Home, Landmark, PartyPopper, Users, Users2, type LucideIcon } from "lucide-react";
import type { GroupType } from "@/generated/prisma/enums";

/** The kinds of group, in the order the booking form shows them. */
export const GROUP_TYPES: { v: GroupType; label: string; hint: string; icon: LucideIcon }[] = [
  { v: "COMPANY", label: "Company", hint: "Boss & staff, a team", icon: Building2 },
  { v: "FAMILY", label: "Family", hint: "Parents, children…", icon: Home },
  { v: "ORGANIZATION", label: "Organization", hint: "NGO, church, school", icon: Users2 },
  { v: "GOVERNMENT", label: "Government", hint: "Ministry, agency", icon: Landmark },
  { v: "EVENT", label: "Event", hint: "Wedding, conference", icon: PartyPopper },
  { v: "OTHER", label: "Other", hint: "Tour, team, other", icon: Users },
];
export const GROUP_TYPE = Object.fromEntries(GROUP_TYPES.map((t) => [t.v, t])) as Record<GroupType, (typeof GROUP_TYPES)[number]>;

/** The group's status for reception and finance: its stay, then its final bill. */
export const GROUP_STATUS: Record<string, { label: string; cls: string }> = {
  UPCOMING: { label: "Upcoming", cls: "bg-sky-500/12 text-sky-700 dark:text-sky-300" },
  ACTIVE: { label: "Active", cls: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  PARTIALLY_CHECKED_OUT: { label: "Partially checked out", cls: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  READY_FOR_FINAL_INVOICE: { label: "Ready for final invoice", cls: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  FINAL_INVOICE_GENERATED: { label: "Final invoice generated", cls: "bg-indigo-500/12 text-indigo-700 dark:text-indigo-300" },
  PARTIALLY_PAID: { label: "Partially paid", cls: "bg-amber-500/15 text-amber-800 dark:text-amber-300" },
  OUTSTANDING: { label: "Outstanding", cls: "bg-rose-500/12 text-rose-700 dark:text-rose-300" },
  CLOSED: { label: "Paid · closed", cls: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300" },
  CANCELLED: { label: "Cancelled", cls: "bg-muted text-muted-foreground" },
};

/** How each kind of group / account is called in the forms ("New family", "Family account", "Family name"…). */
export const ACCOUNT_WORD: Record<GroupType, { one: string; title: string; placeholder: string; people: string }> = {
  COMPANY: { one: "company", title: "Company", placeholder: "PORT TANZANIA LTD", people: "People from this company" },
  FAMILY: { one: "family", title: "Family", placeholder: "Chuwa family", people: "People in this family" },
  ORGANIZATION: { one: "organization", title: "Organization", placeholder: "Tanzania Red Cross", people: "People from this organization" },
  GOVERNMENT: { one: "government office", title: "Government office", placeholder: "Ministry of Health", people: "People from this office" },
  EVENT: { one: "event", title: "Event", placeholder: "Wedding — Juma & Neema", people: "People at this event" },
  OTHER: { one: "group", title: "Group", placeholder: "ABC Tours", people: "People in this group" },
};
