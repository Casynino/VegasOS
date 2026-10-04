import type { HotelSettings } from "@/generated/prisma/client";
import { formatMinutes } from "@/lib/time/business-date";
import { DEFAULT_CONTENT } from "./content";

export function telHref(phone: string): string {
  return `tel:${phone.replace(/[^\d+]/g, "")}`;
}

export function whatsappHref(number: string, text?: string): string {
  const digits = number.replace(/\D/g, "");
  return `https://wa.me/${digits}${text ? `?text=${encodeURIComponent(text)}` : ""}`;
}

export function addressLines(s: HotelSettings): string[] {
  return [s.addressLine, s.postalAddress, [s.city, s.country].filter(Boolean).join(", ")].filter(
    (l): l is string => Boolean(l && l.trim()),
  );
}

export function websiteHref(s: HotelSettings): string | null {
  if (!s.website) return null;
  return s.website.startsWith("http") ? s.website : `https://${s.website}`;
}

/** Placeholder values for content strings (see content.ts `fill`). */
export function contentVars(s: HotelSettings, extra: Record<string, string | number> = {}) {
  return {
    hotelName: s.hotelName,
    address: s.addressLine ?? "Mlimani City Roundabout",
    city: s.city ?? "Dar es Salaam",
    checkIn: formatMinutes(s.standardCheckInMinutes),
    checkOut: formatMinutes(s.checkoutMinutes),
    airportKm: DEFAULT_CONTENT.facts.airportKm,
    ...extra,
  };
}
