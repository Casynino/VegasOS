import type { HotelSettings } from "@/generated/prisma/client";
import type { InfoItem } from "../kit/info-list";

type Place = "breakfast" | "restaurant" | "bar";

const HOURS: Record<Place, { label: string; icon: string; of: (s: HotelSettings) => string | null }> = {
  breakfast: { label: "Breakfast", icon: "Coffee", of: (s) => s.breakfastHours },
  restaurant: { label: "Restaurant", icon: "UtensilsCrossed", of: (s) => s.restaurantHours },
  bar: { label: "Bar", icon: "Wine", of: (s) => s.barHours },
};

/**
 * Opening hours exactly as the hotel set them in Settings — only the ones filled in, never
 * invented. Rows for InfoList ("Restaurant · 07:00 – 23:00").
 */
export function diningHours(s: HotelSettings, places: Place[] = ["breakfast", "restaurant", "bar"]): InfoItem[] {
  return places.flatMap((p) => {
    const value = HOURS[p].of(s)?.trim();
    return value ? [{ label: HOURS[p].label, value, icon: HOURS[p].icon }] : [];
  });
}

/** The same hours as one inline facts line ("Restaurant 07:00 – 23:00 · Bar 12:00 – 00:00"). */
export function diningHoursLine(s: HotelSettings, places?: Place[]): InfoItem[] {
  return diningHours(s, places).map((h) => ({ label: `${h.label} ${h.value}` }));
}
