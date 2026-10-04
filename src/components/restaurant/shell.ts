import type { HotelSettings } from "@/generated/prisma/client";
import type { AppStatus } from "./restaurant-app";

/** The restaurant's name ("Vegas Restaurant") and whether it is taking orders, from the hotel settings. */
export function restaurantShell(s: HotelSettings): { brand: { name: string; hotel: string }; status: AppStatus } {
  return {
    brand: { name: `${s.hotelName.split(/\s+/)[0]} Restaurant`, hotel: s.hotelName },
    status: { open: s.publicOrderingEnabled, kitchenHours: s.restaurantHours || null, barHours: s.barHours || null, prepMinutes: s.orderPrepMinutes },
  };
}
