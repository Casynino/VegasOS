/**
 * What can be put on a guest's room account. `kind` decides which revenue line
 * it counts under in reports (restaurant, bar or other hotel income).
 */
export const CHARGE_TYPES = [
  { code: "RESTAURANT", label: "Restaurant", kind: "RESTAURANT", icon: "UtensilsCrossed" },
  { code: "ROOM_SERVICE", label: "Room service", kind: "RESTAURANT", icon: "ConciergeBell" },
  { code: "BAR", label: "Bar", kind: "BAR", icon: "Wine" },
  { code: "MINIBAR", label: "Minibar", kind: "BAR", icon: "GlassWater" },
  { code: "LAUNDRY", label: "Laundry", kind: "OTHER", icon: "Shirt" },
  { code: "TRANSPORT", label: "Transport", kind: "TRANSPORT", icon: "Car" },
  { code: "EXTRA_BED", label: "Extra bed", kind: "OTHER", icon: "BedSingle" },
  { code: "OTHER", label: "Other", kind: "OTHER", icon: "Plus" },
] as const;

export type ChargeTypeCode = (typeof CHARGE_TYPES)[number]["code"];
export const CHARGE_CODES = CHARGE_TYPES.map((t) => t.code) as [ChargeTypeCode, ...ChargeTypeCode[]];

/** Labels for every category that can appear on a folio (including system ones). */
export const CHARGE_LABELS: Record<string, string> = {
  ...Object.fromEntries(CHARGE_TYPES.map((t) => [t.code, t.label])),
  LATE_CHECKOUT: "Late checkout", EARLY_DEPARTURE: "Early departure", ROOM_UPGRADE: "Room change",
  ROOM_SERVICE_FEE: "Room service fee", NO_SHOW: "No-show · payment kept", ROOM_CHANGE_CREDIT: "Room change · credit", DATE_CHANGE_KEPT: "Date change · price kept", CANCELLATION: "Cancellation · payment kept",
};

export function chargeKind(code: string | null | undefined): "RESTAURANT" | "BAR" | "TRANSPORT" | "OTHER" {
  return CHARGE_TYPES.find((t) => t.code === code)?.kind ?? "OTHER";
}

/** "2 × Breakfast" ⇄ { qty: 2, item: "Breakfast" } — quantity is kept in the description. */
export function lineDescription(item: string, qty: number) {
  return qty > 1 ? `${qty} × ${item.trim()}` : item.trim();
}
export function parseLine(description: string, amount: number) {
  const m = /^(\d+) × (.+)$/.exec(description);
  const qty = m ? Number(m[1]) : 1;
  return { qty, item: m ? m[2] : description, unitPrice: Math.round(amount / qty) };
}
