/**
 * Short time: the guest uses a room for a few hours and does not stay the
 * night — day or night, at most SHORT_TIME_MAX_HOURS. The price is the room
 * price less SHORT_TIME_OFF (25%), no further discount, no breakfast.
 */
export const SHORT_TIME_MAX_HOURS = 7;
export const SHORT_TIME_OFF = 0.25;

/** Short-time price for a room type's nightly rate (60,000 → 45,000). */
export function shortTimeRate(baseRate: number): number {
  return Math.round((baseRate * (1 - SHORT_TIME_OFF)) / 100) * 100;
}
