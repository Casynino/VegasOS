import { msg } from "@/i18n/msg";
import { englishT, type T } from "@/i18n/translate";

/**
 * Who pays for what on a stay. A company can pay everything, nothing, or
 * only some groups ("split"): e.g. the company pays the room, the guest pays
 * their own food and drinks.
 */
export const BILLING_GROUPS = [
  { code: "ROOM", label: msg("Room"), hint: msg("nights, late checkout, room changes") },
  { code: "FOOD", label: msg("Food"), hint: msg("restaurant & room service") },
  { code: "DRINKS", label: msg("Drinks"), hint: msg("bar & minibar") },
  { code: "LAUNDRY", label: msg("Laundry"), hint: "" },
  { code: "TRANSPORT", label: msg("Transport"), hint: msg("airport & trips") },
  { code: "OTHER", label: msg("Other"), hint: msg("everything else") },
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

/** Who pays, in words — in the reader's language when their `t` is given (English otherwise). */
export function billToLabel(billTo: BillTo, covers: readonly string[] = [], t: T = englishT): string {
  if (billTo === "GUEST") return t("Guest pays");
  if (billTo === "COMPANY") return t("Company pays everything");
  if (billTo === "GROUP") return t("The group pays everything");
  const names = BILLING_GROUPS.filter((g) => covers.includes(g.code)).map((g) => t(g.label).toLowerCase());
  return names.length ? t("Company pays {groups} · guest pays the rest", { groups: names.join(t.locale === "zh-CN" ? "、" : ", ") }) : t("Split");
}

export const PAYMENT_TERMS = [0, 7, 14, 30, 60] as const;
/** "Due immediately" / "30 days" — in the reader's language when their `t` is given (English otherwise). */
export function termsLabel(days: number, t: T = englishT): string {
  return days === 0 ? t("Due immediately") : t("{days} days", { days });
}
