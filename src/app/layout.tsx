import type { Metadata, Viewport } from "next";
import { Inter, Cormorant_Garamond, Geist_Mono } from "next/font/google";
import Script from "next/script";
import { Toaster } from "@/components/ui/sonner";
import "./globals.css";

const inter = Inter({ variable: "--font-inter", subsets: ["latin"] });
const cormorant = Cormorant_Garamond({
  variable: "--font-cormorant",
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
});
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? "https://www.vegashoteltz.com"),
  title: {
    default: "Vegas Luxury Hotel — Mlimani City, Dar es Salaam",
    template: "%s | Vegas Luxury Hotel",
  },
  description:
    "Vegas Luxury Hotel at Mlimani City, Dar es Salaam. Comfortable rooms with free Wi-Fi and breakfast, restaurant, bar and meeting room. Book direct for the best rate.",
  // Any page without its own: the hotel's designed link card (WhatsApp & co use the page's own title and description).
  openGraph: { type: "website", siteName: "Vegas Luxury Hotel", locale: "en_TZ", images: [{ url: "/og/hotel", width: 1200, height: 630, alt: "Vegas Luxury Hotel — Your stay, elevated.", type: "image/jpeg" }] },
  twitter: { card: "summary_large_image", images: ["/og/hotel"] },
  // iPhone Safari turns numbers into phone/date links before the page wakes up — which breaks it; we link numbers ourselves.
  formatDetection: { telephone: false, date: false, email: false, address: false },
};

const THEME_SCRIPT = `try{var t=localStorage.getItem("vlh-theme");if(t!=="light"&&t!=="dark"){t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"}document.documentElement.dataset.pubTheme=t}catch(e){}`;

export const viewport: Viewport = {
  themeColor: "#14161f",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${inter.variable} ${cormorant.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        {/* Public-site visitor theme, applied before first paint (saved choice, else device setting). */}
        <Script id="vlh-theme" strategy="beforeInteractive">{THEME_SCRIPT}</Script>
        {children}
        <Toaster richColors position="top-center" />
      </body>
    </html>
  );
}
