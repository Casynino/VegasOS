/**
 * Who pays for what on a stay. A company can pay everything, nothing, or
 * only some groups ("split"): e.g. the company pays the room, the guest pays
 * their own food and drinks.
 */
export const BILLING_GROUPS = [
  { code: "ROOM", label: "Room", hint: "nights, late checkout, room changes" },
  { code: "FOOD", label: "Food", hint: "restaurant & room service" },
  { code: "DRINKS", label: "Drinks", hint: "bar & minibar" },
  { code: "LAUNDRY", label: "Laundry", hint: "" },
  { code: "TRANSPORT", label: "Transport", hint: "airport & trips" },
  { code: "OTHER", label: "Other", hint: "everything else" },
] as const;

export type BillingGroup = (typeof BILLING_GROUPS)[number]["code"];
export const BILLING_GROUP_CODES = BILLING_GROUPS.map((g) => g.code) as [BillingGroup, ...BillingGroup[]];

const CHARGE_GROUP: Record<string, BillingGroup> = {
  LATE_CHECKOUT: "ROOM", EARLY_DEPARTURE: "ROOM", ROOM_UPGRADE: "ROOM", EXTRA_BED: "ROOM", NO_SHOW: "ROOM", CANCELLATION: "ROOM", ROOM_CHANGE_CREDIT: "ROOM", DATE_CHANGE_KEPT: "ROOM",
  RESTAURANT: "FOOD", ROOM_SERVICE: "FOOD", ROOM_SERVICE_FEE: "FOOD",
  BAR: "DRINKS", MINIBAR: "DRINKS",
  LAUNDRY: "LAUNDRY",
  TRANSPORT: "TRANSPORT",
};

/** The billing group of a folio charge category. */
export function chargeGroup(category: string | null | undefined): BillingGroup {
  return (category && CHARGE_GROUP[category]) || "OTHER";
}

/** GROUP = a room of a group booking whose bill the group's payer (company or contact person) pays in full. */
export type BillTo = "GUEST" | "COMPANY" | "SPLIT" | "GROUP";

/** Does the company (or, for a group room, the group's payer) pay this group on this stay? */
export function companyPays(billTo: BillTo, covers: readonly string[], group: BillingGroup): boolean {
  return billTo === "COMPANY" || billTo === "GROUP" || (billTo === "SPLIT" && covers.includes(group));
}

export function billToLabel(billTo: BillTo, covers: readonly string[] = []): string {
  if (billTo === "GUEST") return "Guest pays";
  if (billTo === "COMPANY") return "Company pays everything";
  if (billTo === "GROUP") return "The group pays everything";
  const names = BILLING_GROUPS.filter((g) => covers.includes(g.code)).map((g) => g.label.toLowerCase());
  return names.length ? `Company pays ${names.join(", ")} · guest pays the rest` : "Split";
}

export const PAYMENT_TERMS = [0, 7, 14, 30, 60] as const;
export function termsLabel(days: number): string {
  return days === 0 ? "Due immediately" : `${days} days`;
}
