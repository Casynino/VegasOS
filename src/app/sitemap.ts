import type { MetadataRoute } from "next";
import { listPublicRoomTypes } from "@/server/services/public-booking";

export const revalidate = 3600;

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.vegashoteltz.com").replace(/\/$/, "");
  const now = new Date();
  const pages: { path: string; priority: number; freq: "weekly" | "monthly" }[] = [
    { path: "", priority: 1, freq: "weekly" },
    { path: "/rooms", priority: 0.9, freq: "weekly" },
    { path: "/book", priority: 0.9, freq: "weekly" },
    { path: "/hotel", priority: 0.7, freq: "monthly" },
    { path: "/gallery", priority: 0.6, freq: "monthly" },
    { path: "/restaurant", priority: 0.6, freq: "monthly" },
    { path: "/menu", priority: 0.7, freq: "weekly" },
    { path: "/transport", priority: 0.7, freq: "monthly" },
    { path: "/bar", priority: 0.5, freq: "monthly" },
    { path: "/meeting-room", priority: 0.6, freq: "monthly" },
    { path: "/contact", priority: 0.7, freq: "monthly" },
  ];
  const rooms = await listPublicRoomTypes();
  return [
    ...pages.map((p) => ({ url: `${base}${p.path}`, lastModified: now, changeFrequency: p.freq, priority: p.priority })),
    ...rooms.map((r) => ({ url: `${base}/rooms/${r.slug}`, lastModified: now, changeFrequency: "weekly" as const, priority: 0.8 })),
  ];
}
