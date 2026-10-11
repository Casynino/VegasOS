import type { HotelSettings } from "@/generated/prisma/client";
import { formatMinutes } from "@/lib/time/business-date";
import { prettyPhone } from "@/lib/guest-messages";
import { telHref, waHref } from "@/components/hotel-qr/lib";
import { breakfastHours, breakfastSchedule } from "@/lib/breakfast";
import { msg } from "@/i18n/msg";
import type { HotelInfo } from "./parts";

type Hour = HotelInfo["hours"][number];

/**
 * The hotel as the guest's page shows it at the bottom (and in the Reception sheet), from its settings. In English: the
 * page shows each label and value in the guest's language (HoursList — `i18n` carries the words with their values).
 * Breakfast comes from the one breakfast schedule (src/lib/breakfast.ts), its clock written the way `locale` reads it.
 */
export function hotelInfo(s: HotelSettings, whatsappText: string, locale: string = "en"): HotelInfo {
  const phone = s.whatsapp || s.phone;
  const hours: (Hour | "" | null)[] = [
    { label: msg("Breakfast"), value: breakfastHours(breakfastSchedule(s), locale) },
    s.restaurantHours && { label: msg("Restaurant"), value: s.restaurantHours },
    s.barHours && { label: msg("Bar"), value: s.barHours },
    { label: msg("Check-in"), value: `from ${formatMinutes(s.standardCheckInMinutes)}`, i18n: { key: msg("from {time}"), vars: { time: formatMinutes(s.standardCheckInMinutes) } } },
    { label: msg("Check-out"), value: `by ${formatMinutes(s.checkoutMinutes)}`, i18n: { key: msg("by {time}"), vars: { time: formatMinutes(s.checkoutMinutes) } } },
    { label: msg("Reception"), value: s.receptionHours || msg("24 hours") },
  ];
  return {
    hours: hours.filter((h): h is Hour => !!h),
    address: [s.addressLine, s.city].filter(Boolean).join(", ") || null,
    mapHref: s.mapUrl || null,
    callHref: s.phone ? telHref(s.phone) : null,
    waHref: s.whatsapp ? waHref(s.whatsapp, whatsappText) : null,
    phoneLabel: phone ? prettyPhone(phone) : null,
  };
}
