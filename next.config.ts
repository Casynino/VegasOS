import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Native argon2 binding must not be bundled.
  serverExternalPackages: ["@node-rs/argon2"],
  poweredByHeader: false,
  // Development only: open the dev server from a phone or tablet on the same Wi-Fi (e.g. http://192.168.1.155:3000).
  allowedDevOrigins: ["192.168.*.*", "10.*.*.*", "172.*.*.*", "*.local"], // 172.x: an iPhone hotspot
  // Development only: no "N" badge over the customer pages when testing on a phone.
  devIndicators: false,
  experimental: {
    // Expense receipts (≤ 5 MB) and website photos (≤ 8 MB) are uploaded through server actions.
    serverActions: { bodySizeLimit: "9mb" },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Permissions-Policy", value: "camera=(self), microphone=(), geolocation=()" },
          ...(process.env.NODE_ENV === "production"
            ? [{ key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" }]
            : []),
        ],
      },
      {
        source: "/staff/:path*",
        headers: [{ key: "X-Robots-Tag", value: "noindex, nofollow" }],
      },
    ];
  },
};

export default nextConfig;
