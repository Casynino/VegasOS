/**
 * Manual discounts: a discount a staff member gives one guest, per room per night, on top of the price the pricing engine
 * calculates. Admin decides (Settings → Room pricing) WHETHER reception and managers may give one; there is NO maximum
 * amount (owner, 2026-11-05) — not for a role, not for a room type. The only bound is the price itself: a night can't go
 * below zero (`quoteRoom` / `priceNight` stop it). The server enforces who may; the buttons only mirror it.
 */
export interface DiscountRules {
  receptionCanDiscount: boolean;
  managerCanDiscount: boolean;
}

export const DEFAULT_DISCOUNT_RULES: DiscountRules = { receptionCanDiscount: true, managerCanDiscount: true };

/** What "may give a discount" means in numbers: no cap at all. Comparisons (`> 0`, `<= max`) keep working; the room price still bounds the night. */
export const NO_DISCOUNT_LIMIT = Number.POSITIVE_INFINITY;

/** @deprecated kept for older imports: there is no desk limit any more. */
export const DESK_DISCOUNT_MAX = NO_DISCOUNT_LIMIT;

/** The quick choices (shortcuts only — the "Other" box takes any amount). */
export const DESK_DISCOUNT_CHOICES = [0, 5_000, 10_000, 15_000, 20_000, 25_000, 30_000, 35_000, 40_000, 50_000] as const;
export const MANAGER_DISCOUNT_CHOICES = [] as const;

/** What this staff member may take off a room per night: 0 = may not give manual discounts, otherwise no cap. */
export function discountLimit(permissions?: ReadonlySet<string>, rules: DiscountRules = DEFAULT_DISCOUNT_RULES): number {
  if (!permissions) return 0;
  if (permissions.has("pricing.manage")) return NO_DISCOUNT_LIMIT;
  if (permissions.has("reservations.discount_override")) return rules.managerCanDiscount ? NO_DISCOUNT_LIMIT : 0;
  if (permissions.has("reservations.edit")) return rules.receptionCanDiscount ? NO_DISCOUNT_LIMIT : 0;
  return 0;
}

/**
 * The most that may be taken off ONE room per night. A room type used to carry its own limit (the Twin room: 40,000); that is gone —
 * the staff member's own answer (0 = may not, otherwise no cap) is the answer for every room. `typeMax` is ignored; callers still pass it.
 */
export function roomDiscountLimit(staffLimit: number, typeMax?: number | null): number;
export function roomDiscountLimit(staffLimit: number | null, typeMax?: number | null): number | null;
export function roomDiscountLimit(staffLimit: number | null, typeMax?: number | null): number | null {
  void typeMax;
  return staffLimit;
}
