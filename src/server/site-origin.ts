import "server-only";
import { networkInterfaces } from "node:os";
import { headers } from "next/headers";

/** This computer's Wi-Fi address (e.g. 192.168.1.155), so a phone on the same network can open links while testing. */
function lanAddress() {
  const all = Object.values(networkInterfaces()).flat().filter((n) => n && n.family === "IPv4" && !n.internal);
  // Home / hotel Wi-Fi first (192.168.x, 10.x), then a phone hotspot (172.16–31.x).
  return (all.find((n) => /^(192\.168|10)\./.test(n!.address)) ?? all.find((n) => /^172\.(1[6-9]|2\d|3[01])\./.test(n!.address)) ?? all[0])?.address ?? null;
}

/**
 * Absolute origin for links that leave the app (guest links in WhatsApp messages,
 * scan-to-verify): the live site when configured. Without it (local testing),
 * "localhost" is swapped for this computer's network address — a guest's phone
 * cannot open "localhost".
 */
export async function siteOrigin() {
  if (process.env.NEXT_PUBLIC_SITE_URL) return process.env.NEXT_PUBLIC_SITE_URL.replace(/\/$/, "");
  const h = await headers();
  const host = h.get("host") ?? "localhost:3000";
  const [name, port] = host.split(":");
  if (process.env.NODE_ENV !== "production" && ["localhost", "127.0.0.1", "[::1]"].includes(name)) {
    const lan = lanAddress();
    if (lan) return `http://${lan}${port ? `:${port}` : ""}`;
  }
  return `${h.get("x-forwarded-proto") ?? "http"}://${host}`;
}
