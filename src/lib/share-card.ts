import type { Metadata } from "next";

/**
 * What a shared link shows on WhatsApp, Facebook and others: a title, one line and the designed card from /og/<kind>
 * (src/app/og/[kind]/route.tsx). A page sets all three together — a page's own openGraph replaces its layout's.
 */
export function shareCard(kind: "hotel" | "book" | "menu", title: string, description: string): Pick<Metadata, "openGraph" | "twitter"> {
  const image = { url: `/og/${kind}`, width: 1200, height: 630, alt: title, type: "image/jpeg" };
  return {
    openGraph: { type: "website", siteName: "Vegas Luxury Hotel", locale: "en_TZ", title, description, images: [image] },
    twitter: { card: "summary_large_image", title, description, images: [image.url] },
  };
}
