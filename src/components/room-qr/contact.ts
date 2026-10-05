import type { HotelSettings } from "@/generated/prisma/client";
import { formatMinutes } from "@/lib/time/business-date";
import { prettyPhone } from "@/lib/guest-messages";
import { telHref, waHref } from "@/components/hotel-qr/lib";
import type { HotelInfo } from "./parts";

/** The hotel as the guest's page shows it at the bottom (and in the Reception sheet), from its settings. */
export function hotelInfo(s: HotelSettings, whatsappText: string): HotelInfo {
  const phone = s.whatsapp || s.phone;
  return {
    hours: [
      s.breakfastHours && { label: "Breakfast", value: s.breakfastHours },
      s.restaurantHours && { label: "Restaurant", value: s.restaurantHours },
      s.barHours && { label: "Bar", value: s.barHours },
      { label: "Check-in", value: `from ${formatMinutes(s.standardCheckInMinutes)}` },
      { label: "Check-out", value: `by ${formatMinutes(s.checkoutMinutes)}` },
      { label: "Reception", value: s.receptionHours || "24 hours" },
    ].filter((h): h is { label: string; value: string } => !!h),
    address: [s.addressLine, s.city].filter(Boolean).join(", ") || null,
    mapHref: s.mapUrl || null,
    callHref: s.phone ? telHref(s.phone) : null,
    waHref: s.whatsapp ? waHref(s.whatsapp, whatsappText) : null,
    phoneLabel: phone ? prettyPhone(phone) : null,
  };
}
