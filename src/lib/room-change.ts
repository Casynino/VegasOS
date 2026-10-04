/** Why the hotel moves a guest (the guest pays nothing extra). `maintenance` = the old room is flagged for repair. */
export const HOTEL_MOVE_REASONS = [
  { code: "AC_PROBLEM", label: "AC problem", maintenance: true },
  { code: "PLUMBING", label: "Plumbing", maintenance: true },
  { code: "ELECTRICAL", label: "Electrical problem", maintenance: true },
  { code: "WATER", label: "Water problem", maintenance: true },
  { code: "ROOM_DAMAGE", label: "Room damage", maintenance: true },
  { code: "MAINTENANCE", label: "Maintenance", maintenance: true },
  { code: "GUEST_SAFETY", label: "Guest safety", maintenance: false },
  { code: "OTHER", label: "Other hotel issue", maintenance: false },
] as const;

export type HotelMoveReason = (typeof HOTEL_MOVE_REASONS)[number]["code"];
export const HOTEL_MOVE_CODES = HOTEL_MOVE_REASONS.map((r) => r.code) as [HotelMoveReason, ...HotelMoveReason[]];
export const moveReasonLabel = (code: string | null | undefined) => HOTEL_MOVE_REASONS.find((r) => r.code === code)?.label ?? code ?? "";

export type MoveSource = "CUSTOMER" | "HOTEL";
/**
 * Hotel rule:
 *  - before check-in anyone can move the booking to any free room: a dearer room is paid
 *    for, a cheaper room keeps the price already agreed (no refund, no credit);
 *  - after check-in the guest cannot change room on request (they check out and book again);
 *    the only move is for a problem in the room — free, and anyone at the desk can do it.
 */
/** Moving to a cheaper room: the price stays the same (kept for old records: CREDIT is no longer offered). */
export type DowngradeChoice = "NO_REFUND" | "CREDIT";
