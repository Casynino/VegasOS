import { getSettings } from "@/server/settings";
import { getSiteContent } from "@/server/services/site-content";
import { MobileBookBar } from "@/components/public/mobile-book-bar";
import { MotionProvider } from "@/components/public/motion";
import { Starfield } from "@/components/public/starfield";
import { SiteFooter } from "@/components/public/site-footer";
import { SiteHeader } from "@/components/public/site-header";

// Public pages are regenerated at most every 60 s so staff changes to
// settings, rooms and prices appear quickly while pages stay fast.
export const revalidate = 60;

export default async function PublicLayout({ children }: { children: React.ReactNode }) {
  const [settings, content] = await Promise.all([getSettings(), getSiteContent()]);
  return (
    <MotionProvider>
      <div className="relative isolate flex min-h-svh flex-1 flex-col bg-[#0b0906] text-tone transition-colors duration-500">
        {/* Living night sky behind every dark (translucent) section */}
        <Starfield />
        <a
          href="#main"
          className="sr-only z-50 rounded-full bg-gold px-5 py-3 text-sm font-medium text-[#15120e] focus:not-sr-only focus:fixed focus:left-4 focus:top-4"
        >
          Skip to content
        </a>
        <SiteHeader settings={settings} />
        <main id="main" className="flex flex-1 flex-col">
          {children}
        </main>
        <SiteFooter settings={settings} blurb={content.pages.footer.blurb} />
        <div className="h-[calc(4.5rem+env(safe-area-inset-bottom))] bg-[#100d0a] sm:hidden" aria-hidden="true" />
        <MobileBookBar phone={settings.phone} />
      </div>
    </MotionProvider>
  );
}
