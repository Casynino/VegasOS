import { msg } from "@/i18n/msg";

/**
 * Common requests a customer can tick when ordering (owner, 2026-10-06): stored as codes on the order
 * (RestaurantOrder.noteCodes) and shown to each person in their own language — a Chinese customer ticks 不要洋葱,
 * the kitchen reads "No onions". Reliable, unlike machine translation. The customer's own typed words stay in
 * `notes` exactly as written.
 */
export const ORDER_REQUESTS = [
  { code: "NO_ONION", label: msg("No onions") },
  { code: "NO_GARLIC", label: msg("No garlic") },
  { code: "NOT_SPICY", label: msg("Not spicy") },
  { code: "EXTRA_SPICY", label: msg("Extra spicy") },
  { code: "NO_ICE", label: msg("No ice") },
  { code: "LESS_SUGAR", label: msg("Less sugar") },
  { code: "NO_SUGAR", label: msg("No sugar") },
  { code: "WELL_DONE", label: msg("Meat well done") },
  { code: "SAUCE_ON_SIDE", label: msg("Sauce on the side") },
  { code: "VEGETARIAN", label: msg("Vegetarian") },
  { code: "ALLERGY", label: msg("I have an allergy — please ask me") },
  { code: "TAKE_AWAY_PACK", label: msg("Pack it to take away") },
] as const;

export type OrderRequestCode = (typeof ORDER_REQUESTS)[number]["code"];
const BY_CODE = new Map<string, string>(ORDER_REQUESTS.map((r) => [r.code, r.label]));

/** Only known codes, once each, in the list's order (anything else a browser sends is dropped). */
export function cleanRequestCodes(codes: readonly unknown[] | null | undefined): OrderRequestCode[] {
  const asked = new Set((codes ?? []).filter((c): c is string => typeof c === "string"));
  return ORDER_REQUESTS.filter((r) => asked.has(r.code)).map((r) => r.code);
}

/** The English label of a code (translate it where it is shown: `t(requestLabel(code))`). */
export const requestLabel = (code: string) => BY_CODE.get(code) ?? code;
