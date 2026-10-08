import { msgf, type Localized } from "@/i18n/msg";

/**
 * Manual discounts: a discount a staff member gives one guest, per room per
 * night, on top of the price the pricing engine calculates. Admin decides
 * (Settings → Room pricing) whether reception and managers may give one and
 * the most they may give; the server enforces it — the buttons only mirror it.
 */
export interface DiscountRules {
  manualDiscountMax: number;
  receptionCanDiscount: boolean;
  managerCanDiscount: boolean;
}

export const DEFAULT_DISCOUNT_RULES: DiscountRules = { manualDiscountMax: 20_000, receptionCanDiscount: true, managerCanDiscount: true };

/** @deprecated kept for older imports; the limit now comes from the hotel settings. */
export const DESK_DISCOUNT_MAX = DEFAULT_DISCOUNT_RULES.manualDiscountMax;

/** The quick choices; only those within the limit are shown. */
export const DESK_DISCOUNT_CHOICES = [0, 5_000, 10_000, 15_000, 20_000, 25_000, 30_000, 40_000, 50_000] as const;
export const MANAGER_DISCOUNT_CHOICES = [] as const;

/** The most this staff member may take off a room per night; 0 = may not give manual discounts. */
export function discountLimit(permissions?: ReadonlySet<string>, rules: DiscountRules = DEFAULT_DISCOUNT_RULES): number {
  if (!permissions) return 0;
  if (permissions.has("pricing.manage")) return rules.manualDiscountMax;
  if (permissions.has("reservations.discount_override")) return rules.managerCanDiscount ? rules.manualDiscountMax : 0;
  if (permissions.has("reservations.edit")) return rules.receptionCanDiscount ? rules.manualDiscountMax : 0;
  return 0;
}

/** For `new AppError(…)`: the English text with the amount, translated for whoever sees it. */
export function discountTooBigMessage(limit: number = DEFAULT_DISCOUNT_RULES.manualDiscountMax): Localized {
  return msgf("The most off a room is TZS {amount} per night.", { amount: limit.toLocaleString("en-US") });
}
