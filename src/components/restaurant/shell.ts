import type { HotelSettings } from "@/generated/prisma/client";
import type { T } from "@/i18n/translate";
import type { AppStatus } from "./restaurant-app";

/** The restaurant's name ("Vegas Restaurant") and whether it is taking orders, from the hotel settings. */
export function restaurantShell(s: HotelSettings): { brand: { name: string; hotel: string }; status: AppStatus } {
  return {
    brand: { name: `${s.hotelName.split(/\s+/)[0]} Restaurant`, hotel: s.hotelName },
    status: { open: s.publicOrderingEnabled, kitchenHours: s.restaurantHours || null, barHours: s.barHours || null, prepMinutes: s.orderPrepMinutes },
  };
}

/** The restaurant's name in the reader's language: "Vegas Restaurant" → "Vegas 餐厅"; any other name as it is. */
export function restaurantName(name: string, t: T) {
  const m = /^(\S+) Restaurant$/.exec(name);
  return m ? t("{hotel} Restaurant", { hotel: m[1] }) : name;
}

/**
 * A place as the hotel named it ("Table 3 — Outside", "Counter — Outside", "Room 305", "Restaurant") in the reader's
 * language — display only (the English name stays what is stored, sent and compared).
 */
export function spotName(name: string, t: T) {
  return name.split(" — ").map((part) => {
    let m = /^Table (.+)$/.exec(part);
    if (m) return t("Table {table}", { table: m[1] });
    m = /^Room (.+)$/.exec(part);
    if (m) return t("Room {room}", { room: m[1] });
    m = /^Meeting room (.+)$/.exec(part);
    if (m) return t("Meeting room {room}", { room: m[1] });
    return t(part);
  }).join(" — ");
}
