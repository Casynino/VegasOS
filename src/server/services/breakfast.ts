import "server-only";
import { cache } from "react";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import { breakfastSchedule } from "@/lib/breakfast";

/**
 * Does the hotel include breakfast with its room stays? One switch — the hotel's "Breakfast included" service (switched in
 * Settings → Complimentary breakfast). Everything that tells a guest or a staff member about breakfast asks here.
 */
export const breakfastIncluded = cache(async () =>
  !!(await db.hotelService.findFirst({ where: { code: "BREAKFAST", isActive: true, isPublic: true }, select: { id: true } })));

/** The hotel's breakfast as it stands: included or not, and the serving schedule from Settings. */
export async function hotelBreakfast() {
  const [s, included] = await Promise.all([getSettings(), breakfastIncluded()]);
  return { included, schedule: breakfastSchedule(s), timezone: s.timezone };
}
