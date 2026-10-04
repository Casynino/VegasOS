import Image from "next/image";
import Link from "next/link";
import { Globe, Mail, MapPin, MessageCircle, Phone } from "lucide-react";
import type { HotelSettings } from "@/generated/prisma/client";
import { DEFAULT_CONTENT } from "./content";
import { cn } from "@/lib/utils";
import { addressLines, telHref, websiteHref, whatsappHref } from "./contact";
import { Ornament } from "./ornament";
import { MAP_LINK_URL, NAV_LINKS } from "./site-config";
import { container, eyebrow } from "./ui";

export function SiteFooter({ settings, blurb = DEFAULT_CONTENT.pages.footer.blurb }: { settings: HotelSettings; blurb?: string }) {
  const address = addressLines(settings);
  const site = websiteHref(settings);
  const year = new Date().getFullYear();
  const linkCls = "text-white/70 transition-colors hover:text-gold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold rounded-sm";
  return (
    <footer className="bg-[#100d0a] text-white" aria-labelledby="footer-heading">
      <h2 id="footer-heading" className="sr-only">Hotel information</h2>
      <div className={cn(container, "grid grid-cols-2 gap-x-6 gap-y-12 py-16 lg:grid-cols-[1.4fr_1fr_1fr_1.2fr] lg:py-20")}>
        <div className="col-span-2 lg:col-span-1">
          <Link href="/" className="inline-flex items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
            <Image src="/brand/logo-192.png" alt="" width={56} height={56} />
            <span className="font-display text-2xl font-semibold text-gold">{settings.hotelName}</span>
          </Link>
          {settings.tagline && <p className="mt-4 text-xs uppercase tracking-[0.3em] text-white/60">{settings.tagline}</p>}
          <Ornament className="mt-6" />
          <p className="mt-6 max-w-xs text-sm leading-relaxed text-white/60">
            {blurb}
          </p>
        </div>

        <nav aria-label="Footer">
          <p className={cn(eyebrow, "text-gold")}>Explore</p>
          <ul className="mt-5 space-y-3 text-sm">
            {NAV_LINKS.map((l) => (
              <li key={l.href}><Link href={l.href} className={linkCls}>{l.label}</Link></li>
            ))}
          </ul>
        </nav>

        <div>
          <p className={cn(eyebrow, "text-gold")}>Plan your stay</p>
          <ul className="mt-5 space-y-3 text-sm">
            <li><Link href="/book" className={linkCls}>Book a room</Link></li>
            <li><Link href="/rooms" className={linkCls}>Compare rooms</Link></li>
            <li><Link href="/bar" className={linkCls}>The bar</Link></li>
            <li><Link href="/contact?subject=meeting" className={linkCls}>Meeting room enquiry</Link></li>
            <li><Link href="/contact?subject=existing" className={linkCls}>Help with a booking</Link></li>
            <li><Link href="/staff/login" className={linkCls}>Staff login</Link></li>
          </ul>
        </div>

        <address className="col-span-2 not-italic lg:col-span-1">
          <p className={cn(eyebrow, "text-gold")}>Contact</p>
          <ul className="mt-5 space-y-4 text-sm">
            {address.length > 0 && (
              <li className="flex gap-3">
                <MapPin className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
                <a href={MAP_LINK_URL} target="_blank" rel="noopener noreferrer" className={linkCls}>
                  {address.map((l) => <span key={l} className="block">{l}</span>)}
                  <span className="sr-only"> (opens Google Maps in a new tab)</span>
                </a>
              </li>
            )}
            {settings.phone && (
              <li className="flex gap-3">
                <Phone className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
                <a href={telHref(settings.phone)} className={linkCls}>{settings.phone}</a>
              </li>
            )}
            {settings.whatsapp && (
              <li className="flex gap-3">
                <MessageCircle className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
                <a href={whatsappHref(settings.whatsapp)} target="_blank" rel="noopener noreferrer" className={linkCls}>
                  WhatsApp us<span className="sr-only"> (opens in a new tab)</span>
                </a>
              </li>
            )}
            {settings.email && (
              <li className="flex gap-3">
                <Mail className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
                <a href={`mailto:${settings.email}`} className={cn(linkCls, "break-all")}>{settings.email}</a>
              </li>
            )}
            {site && settings.website && (
              <li className="flex gap-3">
                <Globe className="mt-0.5 size-4 shrink-0 text-gold" aria-hidden="true" />
                <a href={site} className={linkCls}>{settings.website}</a>
              </li>
            )}
          </ul>
        </address>
      </div>
      <div className="border-t border-white/10">
        <div className={cn(container, "flex flex-col gap-2 py-6 text-xs text-white/50 sm:flex-row sm:items-center sm:justify-between")}>
          <p>© {year} {settings.hotelName}. All rights reserved.</p>
          <p>{[settings.city, settings.country].filter(Boolean).join(", ")}</p>
        </div>
      </div>
    </footer>
  );
}
