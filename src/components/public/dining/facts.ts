import type { HotelSettings } from "@/generated/prisma/client";
import type { InfoItem } from "../kit/info-list";
import { msg } from "@/i18n/msg";

type Place = "breakfast" | "restaurant" | "bar";

const HOURS: Record<Place, { label: string; icon: string; of: (s: HotelSettings) => string | null }> = {
  breakfast: { label: msg("Breakfast"), icon: "Coffee", of: (s) => s.breakfastHours },
  restaurant: { label: msg("Restaurant"), icon: "UtensilsCrossed", of: (s) => s.restaurantHours },
  bar: { label: msg("Bar"), icon: "Wine", of: (s) => s.barHours },
};

/**
 * Opening hours exactly as the hotel set them in Settings — only the ones filled in, never
 * invented. Rows for InfoList ("Restaurant · 07:00 – 23:00"). The labels are English keys: the page
 * shows them with t(label).
 */
export function diningHours(s: HotelSettings, places: Place[] = ["breakfast", "restaurant", "bar"]): (InfoItem & { label: string; value: string })[] {
  return places.flatMap((p) => {
    const value = HOURS[p].of(s)?.trim();
    return value ? [{ label: HOURS[p].label, value, icon: HOURS[p].icon }] : [];
  });
}

/**
 * The same hours as one inline facts line ("Restaurant 07:00 – 23:00 · Bar 12:00 – 00:00"), in the reader's
 * language: pass the page's `t` (the label is an English key; the hours as set, e.g. "24 hours", fall back to themselves).
 */
export function diningHoursLine(s: HotelSettings, t: (key: string) => string, places?: Place[]): InfoItem[] {
  return diningHours(s, places).map((h) => ({ label: `${t(h.label)} ${t(h.value)}` }));
}
