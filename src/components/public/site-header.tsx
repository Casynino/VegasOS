import Image from "next/image";
import Link from "next/link";
import type { HotelSettings } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";
import { HeaderShell } from "./header-shell";
import { containers } from "./kit/tokens";
import { MobileNav } from "./mobile-nav";
import { NavLink } from "./nav-link";
import { PRIMARY_NAV } from "./site-config";
import { StaffLink } from "./staff-link";
import { ThemeToggle } from "./theme-toggle";

/**
 * Desktop (≥1024px): logo · Rooms Dining Experiences Services About Contact · Book your stay
 * (+ the theme switch from 1280px; it is also in the footer). Phones and tablets: compact logo ·
 * small Book · menu. Book is a slim hairline button (no gold block) and the only Book on phones.
 * Staff login is always in sight (owner, 2026-10-05: "the log in should be very visible"): a labelled "Staff login" on
 * computers, a lock button beside Book on phones and tablets — "Dashboard" once signed in.
 * Phone, WhatsApp and theme live in the menu and the footer.
 */
export function SiteHeader({ settings }: { settings: HotelSettings }) {
  const [first, ...rest] = settings.hotelName.split(" ");
  return (
    <HeaderShell>
      <div
        className={cn(
          containers.wide,
          "grid h-16 grid-cols-[minmax(0,1fr)_auto] items-center gap-3 transition-[height] duration-500 ease-pub motion-reduce:transition-none",
          "lg:h-20 lg:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] lg:gap-6 lg:group-data-[scrolled=true]/hdr:h-16 xl:gap-8",
        )}
      >
        <Link
          href="/"
          aria-label={`${settings.hotelName} — home`}
          className="flex min-w-0 items-center gap-2.5 justify-self-start rounded-sm focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold"
        >
          <Image
            src="/brand/logo-192.png"
            alt=""
            width={48}
            height={48}
            loading="eager"
            className="size-9 shrink-0 drop-shadow-[0_4px_12px_rgba(0,0,0,0.45)] transition-[width,height] duration-500 ease-pub lg:size-11 lg:group-data-[scrolled=true]/hdr:size-9 motion-reduce:transition-none"
          />
          <span className="min-w-0 leading-none">
            <span className="block font-display text-[1.3rem] font-bold uppercase tracking-[0.16em] text-gold lg:text-[1.45rem]">{first}</span>
            {rest.length > 0 && (
              <span className="mt-1 block truncate text-[8.5px] font-semibold uppercase tracking-[0.38em] text-white/85 max-[359px]:hidden lg:text-[9.5px]">{rest.join(" ")}</span>
            )}
          </span>
        </Link>

        <nav aria-label="Main" className="hidden lg:block">
          <ul className="flex items-center gap-5 xl:gap-9">
            {PRIMARY_NAV.map((l) => (
              <li key={l.href}>
                <NavLink href={l.href} match={l.match} className="whitespace-nowrap text-[12px] font-medium uppercase tracking-[0.16em] text-white/80">
                  {l.label}
                </NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="flex items-center justify-end gap-1.5 min-[360px]:gap-2 sm:gap-3">
          <ThemeToggle compact className="hidden xl:inline-grid" />
          {/* Staff login is just the plain lock, on every screen (owner, 2026-10-05: "just icon, no words", no shape). */}
          <StaffLink iconOnly labels={{ signedIn: "Staff dashboard", signedOut: "Staff login" }}
            className="h-10 w-9 justify-center rounded-sm text-white/90 transition-colors duration-200 hover:text-white focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none [&_svg]:size-[19px]" />
          <Link href="/book" aria-label="Book your stay"
            className="inline-flex h-10 items-center gap-1 whitespace-nowrap rounded-sm px-1 text-[14px] font-semibold text-gold transition-colors duration-200 hover:text-[#f0d6a0] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none">
            <span className="sm:hidden">Book</span>
            <span className="hidden sm:inline">Book your stay</span>
          </Link>
          <MobileNav hotelName={settings.hotelName} phone={settings.phone} whatsapp={settings.whatsapp} className="lg:hidden" />
        </div>
      </div>
    </HeaderShell>
  );
}
