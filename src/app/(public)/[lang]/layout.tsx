import type { Metadata, Viewport } from "next";
import { notFound } from "next/navigation";
import { LOCALES, LOCALE_META, localeFromSegment } from "@/i18n/config";
import { clientCatalog, getT, pageLocale, setRequestLocale } from "@/i18n/server";
import { I18nProvider } from "@/i18n/client";
import { Toaster } from "@/components/ui/sonner";
import { getSettings } from "@/server/settings";
import { getSiteContent } from "@/server/services/site-content";
import { MotionProvider } from "@/components/public/motion";
import { PubRuntime } from "@/components/public/kit/runtime";
import { Starfield } from "@/components/public/starfield";
import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";

// Public pages are regenerated at most every 60 s so staff changes to
// settings, rooms and prices appear quickly while pages stay fast.
export const revalidate = 60;

// One cached version of every page per language (/en/…, /zh/…); the proxy picks the visitor's (src/proxy.ts).
export function generateStaticParams() {
  return LOCALES.map((l) => ({ lang: LOCALE_META[l].segment }));
}

/**
 * The website's defaults (any page without its own title, description or link card) in the visitor's language — the
 * root layout's, translated. Only the page's language is read here (no cookies), so the pages stay cached.
 */
export async function generateMetadata({ params }: LayoutProps<"/[lang]">): Promise<Metadata> {
  await pageLocale(params);
  const t = await getT();
  return {
    title: {
      default: t("Vegas Luxury Hotel — Mlimani City, Dar es Salaam"),
      template: "%s | Vegas Luxury Hotel",
    },
    description: t(
      "Vegas Luxury Hotel at Mlimani City, Dar es Salaam. Comfortable rooms with free Wi-Fi and breakfast, restaurant, bar and meeting room. Book direct for the best rate.",
    ),
    openGraph: {
      type: "website",
      siteName: "Vegas Luxury Hotel",
      locale: t.locale === "zh-CN" ? "zh_CN" : "en_TZ",
      images: [{ url: "/og/hotel", width: 1200, height: 630, alt: t("Vegas Luxury Hotel — Your stay, elevated."), type: "image/jpeg" }],
    },
  };
}

// Phone browser chrome matches the night header (the root layout's colour stays for staff).
export const viewport: Viewport = { themeColor: "#0f0c09" };

/**
 * Public site shell. `.pub-site` scopes the design system (globals.css); the header is fixed
 * and overlays the page (first blocks clear var(--pub-header-h)); the night-sky backdrop is static.
 * PubRuntime (one tiny client island) lets the atmosphere/marquees animate only while on screen and
 * drives the desktop cursor spotlight.
 */
export default async function PublicLayout({ children, params }: LayoutProps<"/[lang]">) {
  const { lang } = await params;
  const locale = localeFromSegment(lang);
  if (!locale) notFound();
  setRequestLocale(locale);
  const [settings, content, catalog, t] = await Promise.all([getSettings(), getSiteContent(), clientCatalog(locale, ["public"]), getT()]);
  return (
    <I18nProvider locale={locale} catalog={catalog}>
    <MotionProvider>
      <div lang={LOCALE_META[locale].html} className="pub-site relative isolate flex min-h-svh flex-1 flex-col bg-night text-tone transition-colors duration-500">
        <Starfield />
        <a
          href="#main"
          className="sr-only z-50 rounded-full border border-gold/60 bg-night px-5 py-2.5 text-sm font-medium text-gold focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          {t("Skip to content")}
        </a>
        <SiteHeader settings={settings} />
        <main id="main" tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
          {children}
        </main>
        <SiteFooter settings={settings} blurb={content.pages.footer.blurb} />
        <PubRuntime />
      </div>
    </MotionProvider>
    <Toaster richColors position="top-center" />
    </I18nProvider>
  );
}
