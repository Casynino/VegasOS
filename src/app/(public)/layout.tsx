import type { Viewport } from "next";
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

// Phone browser chrome matches the night header (the root layout's colour stays for staff).
export const viewport: Viewport = { themeColor: "#0f0c09" };

/**
 * Public site shell. `.pub-site` scopes the design system (globals.css); the header is fixed
 * and overlays the page (first blocks clear var(--pub-header-h)); the night-sky backdrop is static.
 * PubRuntime (one tiny client island) lets the atmosphere/marquees animate only while on screen and
 * drives the desktop cursor spotlight.
 */
export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [settings, content] = await Promise.all([getSettings(), getSiteContent()]);
  return (
    <MotionProvider>
      <div className="pub-site relative isolate flex min-h-svh flex-1 flex-col bg-night text-tone transition-colors duration-500">
        <Starfield />
        <a
          href="#main"
          className="sr-only z-50 rounded-full border border-gold/60 bg-night px-5 py-2.5 text-sm font-medium text-gold focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <SiteHeader settings={settings} />
        <main id="main" tabIndex={-1} className="flex flex-1 flex-col focus:outline-none">
          {children}
        </main>
        <SiteFooter settings={settings} blurb={content.pages.footer.blurb} />
        <PubRuntime />
      </div>
    </MotionProvider>
  );
}
