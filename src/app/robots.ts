import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.vegasluxuryhotel.co.tz").replace(/\/$/, "");
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/staff", "/staff/", "/admin", "/manager", "/reception", "/booking/", "/b/", "/pay/"] },
    sitemap: `${base}/sitemap.xml`,
    host: base,
  };
}
