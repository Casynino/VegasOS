import Image from "next/image";
import Link from "next/link";
import { CodeXml, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import type { HotelSettings } from "@/generated/prisma/client";
import { DEFAULT_CONTENT } from "./content";
import { cn } from "@/lib/utils";
import { LocalTime } from "./cinema/local-time";
import { addressLines, telHref, whatsappHref } from "./contact";
import { Atmosphere } from "./kit/atmosphere";
import { HOTEL_COORDS, HudLabel } from "./kit/hud";
import { containers, typeScale } from "./kit/tokens";
import { FOOTER_NAV, MAP_LINK_URL } from "./site-config";
import { StaffLink } from "./staff-link";
import { ThemeToggle } from "./theme-toggle";

const focus = "rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";
const TIME = new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" });

/**
 * Quiet, organised footer: the hotel and one line about it (Book lives in the header), grouped
 * navigation, contact from settings (social links only when set), then © · theme · staff door.
 * Night atmosphere with star dust, a HUD line (the hotel's real coordinates and local time) and
 * the name as a huge faint outline wordmark at the foot.
 * Calls, WhatsApp, theme and the staff door are small quiet links/icons, never pills.
 */
export function SiteFooter({ settings, blurb = DEFAULT_CONTENT.pages.footer.blurb }: { settings: HotelSettings; blurb?: string }) {
  const address = addressLines(settings);
  const year = new Date().getFullYear();
  const place = [settings.city, settings.country].filter(Boolean).join(", ");
  const wordmark = settings.hotelName.split(" ")[0] || settings.hotelName;
  const socials = [
    settings.instagramUrl ? { label: "Instagram", href: settings.instagramUrl } : null,
    settings.facebookUrl ? { label: "Facebook", href: settings.facebookUrl } : null,
  ].filter((s): s is { label: string; href: string } => s !== null);
  const link = cn(
    "inline-flex min-h-11 items-center text-[15px] text-white/70 transition-colors duration-200 hover:text-white sm:min-h-10 lg:min-h-9 lg:text-sm motion-reduce:transition-none",
    focus,
  );
  const contactLink = cn(
    "inline-flex min-h-11 items-start gap-3 py-2.5 text-[15px] leading-snug text-white/70 transition-colors duration-200 hover:text-white lg:min-h-0 lg:py-1.5 lg:text-sm motion-reduce:transition-none",
    focus,
  );
  const icon = "mt-0.5 size-4 shrink-0 text-gold";
  // Phones: one flowing list — Book your stay and Contact are already in the header and the contact rows.
  const phoneLinks = FOOTER_NAV.flatMap((g) => g.links).filter((l) => l.href !== "/book" && l.href !== "/contact");

  return (
    <footer
      id="site-footer"
      data-tone="night"
      aria-labelledby="footer-heading"
      className="pub-footer relative isolate overflow-hidden bg-night text-pub-fg"
    >
      {/* A night map (contours) and star dust; the gold horizon at its top comes from the atmosphere. */}
      <Atmosphere tone="night" pattern="contour" stars edges="top" />
      <h2 id="footer-heading" className="sr-only">
        Hotel information
      </h2>

      <div className={cn(containers.wide, "pt-10 sm:pt-14 lg:pt-16")}>
        <div className="mb-10 flex flex-wrap items-center justify-between gap-x-8 gap-y-3 border-b border-white/[0.08] pb-5 sm:mb-14 lg:mb-16">
          <HudLabel>{HOTEL_COORDS.label}</HudLabel>
          <HudLabel live>
            {settings.city || "Dar es Salaam"} · <LocalTime initial={TIME.format(new Date())} /> local time
          </HudLabel>
        </div>
        <div className="grid gap-8 sm:gap-12 lg:grid-cols-12 lg:gap-10">
          <div className="lg:col-span-4">
            <Link href="/" className={cn("inline-flex items-center gap-3", focus)}>
              <Image src="/brand/logo-192.png" alt="" width={48} height={48} className="size-12" />
              <span className="font-display text-2xl font-semibold text-gold">{settings.hotelName}</span>
            </Link>
            {settings.tagline && <p className={cn(typeScale.eyebrow, "mt-6 text-white/50")}>{settings.tagline}</p>}
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-white/65">{blurb}</p>
          </div>

          {/* Phones: one list that flows over a few lines; from 640px, three tidy columns. */}
          <nav aria-label="Footer" className="min-w-0 lg:col-span-5">
            <div className="sm:hidden">
              <p className={cn(typeScale.eyebrow, "text-gold")}>Explore</p>
              <ul className="mt-1.5 grid grid-cols-2 gap-x-5">
                {phoneLinks.map((l) => (
                  <li key={l.href}>
                    <Link href={l.href} className={link}>
                      {l.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
            <div className="hidden sm:grid sm:grid-cols-3 sm:gap-x-6">
              {FOOTER_NAV.map((group) => (
                <div key={group.title} className="min-w-0">
                  <p className={cn(typeScale.eyebrow, "text-gold")}>{group.title}</p>
                  <ul className="mt-3 lg:mt-4">
                    {group.links.map((l) => (
                      <li key={l.href}>
                        <Link href={l.href} className={link}>
                          {l.label}
                        </Link>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </nav>

          <address className="not-italic lg:col-span-3">
            <p className={cn(typeScale.eyebrow, "text-gold")}>Contact</p>
            {/* Below 1024px the address takes a line and phone, WhatsApp and email share the next ones. */}
            <ul className="mt-1.5 flex flex-wrap gap-x-6 lg:mt-4 lg:block">
              {address.length > 0 && (
                <li className="basis-full">
                  <a href={MAP_LINK_URL} target="_blank" rel="noopener noreferrer" className={contactLink}>
                    <MapPin className={icon} strokeWidth={1.6} aria-hidden="true" />
                    <span>
                      {address.map((l) => (
                        <span key={l} className="block">
                          {l}
                        </span>
                      ))}
                      <span className="sr-only"> (opens Google Maps in a new tab)</span>
                    </span>
                  </a>
                </li>
              )}
              {settings.phone && (
                <li>
                  <a href={telHref(settings.phone)} className={contactLink}>
                    <Phone className={icon} strokeWidth={1.6} aria-hidden="true" />
                    {settings.phone}
                  </a>
                </li>
              )}
              {settings.whatsapp && (
                <li>
                  <a href={whatsappHref(settings.whatsapp)} target="_blank" rel="noopener noreferrer" className={contactLink}>
                    <MessageCircle className={icon} strokeWidth={1.6} aria-hidden="true" />
                    WhatsApp us<span className="sr-only"> (opens in a new tab)</span>
                  </a>
                </li>
              )}
              {settings.email && (
                <li>
                  <a href={`mailto:${settings.email}`} className={cn(contactLink, "break-all")}>
                    <Mail className={icon} strokeWidth={1.6} aria-hidden="true" />
                    {settings.email}
                  </a>
                </li>
              )}
            </ul>
            {socials.length > 0 && (
              <ul className="mt-4 flex flex-wrap gap-x-6">
                {socials.map((s) => (
                  <li key={s.label}>
                    <a href={s.href} target="_blank" rel="noopener noreferrer" className={cn(typeScale.meta, "inline-flex min-h-11 items-center text-white/60 transition-colors hover:text-white", focus)}>
                      {s.label}
                      <span className="sr-only"> (opens in a new tab)</span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </address>
        </div>
      </div>

      <p aria-hidden="true" className={cn(containers.wide, "pub-wordmark pointer-events-none mt-10 select-none overflow-hidden text-center text-[clamp(5.5rem,24vw,21rem)] uppercase sm:mt-14")}>
        {wordmark}
      </p>

      <div className="relative border-t border-white/10">
        <div
          className={cn(
            containers.wide,
            "flex flex-wrap items-center justify-between gap-x-6 gap-y-1 pb-[calc(1rem+env(safe-area-inset-bottom))] pt-3 sm:pb-[calc(1.25rem+env(safe-area-inset-bottom))] sm:pt-5",
          )}
        >
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
            <p className="py-2 text-xs leading-relaxed text-white/45">
              © {year} {settings.hotelName}
              {place && <span> · {place}</span>}
            </p>
            {/* Who made the site — a small way to Nino's page and work. */}
            <Link href="/nino" className={cn(focus, "group inline-flex h-8 items-center gap-1.5 rounded-full border border-white/12 px-3 text-[11px] text-white/55 transition-colors hover:border-white/30 hover:text-white")}>
              <CodeXml className="size-3.5 text-white/40 transition-colors group-hover:text-[#c6f432]" strokeWidth={1.8} aria-hidden="true" />
              Developed by Nino
            </Link>
          </div>
          <div className="-mr-2 flex items-center gap-3">
            <ThemeToggle compact />
            <StaffLink
              withIcon
              labels={{ signedIn: "Staff dashboard", signedOut: "Staff login" }}
              className={cn("min-h-11 px-1 text-xs text-white/60 transition-colors hover:text-white", focus)}
            />
          </div>
        </div>
      </div>
    </footer>
  );
}
