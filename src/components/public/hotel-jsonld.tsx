import type { HotelSettings } from "@/generated/prisma/client";
import { formatMinutes } from "@/lib/time/business-date";
import type { SiteContent } from "./content";
import { websiteHref } from "./contact";

/** schema.org Hotel structured data — verified facts only (no ratings or prices). */
export function HotelJsonLd({ settings, baseUrl, content }: { settings: HotelSettings; baseUrl: string; content: SiteContent }) {
  const data = {
    "@context": "https://schema.org",
    "@type": "Hotel",
    name: settings.hotelName,
    ...(settings.tagline ? { slogan: settings.tagline } : {}),
    url: websiteHref(settings) ?? baseUrl,
    image: [new URL(content.seo.ogImage.src, baseUrl).toString(), new URL(content.pages.hotel.image.src, baseUrl).toString()],
    logo: new URL("/brand/logo-512.png", baseUrl).toString(),
    ...(settings.phone ? { telephone: settings.phone } : {}),
    ...(settings.email ? { email: settings.email } : {}),
    address: {
      "@type": "PostalAddress",
      ...(settings.addressLine ? { streetAddress: settings.addressLine } : {}),
      ...(settings.postalAddress ? { postOfficeBoxNumber: settings.postalAddress.replace(/^P\.?O\.?\s*Box\s*/i, "") } : {}),
      ...(settings.city ? { addressLocality: settings.city } : {}),
      ...(settings.country ? { addressCountry: settings.country === "Tanzania" ? "TZ" : settings.country } : {}),
    },
    checkinTime: formatMinutes(settings.standardCheckInMinutes),
    checkoutTime: formatMinutes(settings.checkoutMinutes),
    currenciesAccepted: settings.currency,
    amenityFeature: content.services.map((s) => s.name).map((name) => ({
      "@type": "LocationFeatureSpecification",
      name,
      value: true,
    })),
  };
  return (
    <script
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }}
    />
  );
}
