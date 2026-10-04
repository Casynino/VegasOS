import Image from "next/image";
import Link from "next/link";
import type { HotelSettings } from "@/generated/prisma/client";
import { cn } from "@/lib/utils";
import { HeaderShell } from "./header-shell";
import { MobileNav } from "./mobile-nav";
import { NavLink } from "./nav-link";
import { NAV_LINKS } from "./site-config";
import { PillLink } from "./pill-link";
import { StaffLink } from "./staff-link";
import { ThemeToggle } from "./theme-toggle";
import { container } from "./ui";

/**
 * One clean line over the hero: bold brand lockup · navigation · Book now.
 * The phone number lives in the booking card, footer, contact page and mobile menu.
 */
export function SiteHeader({ settings }: { settings: HotelSettings }) {
  const [first, ...rest] = settings.hotelName.split(" ");
  return (
    <HeaderShell>
      <div className={cn(container, "flex h-18 items-center gap-6 transition-[height] duration-500 lg:h-20 lg:group-data-[scrolled=true]/hdr:h-16")}>
        <Link href="/" aria-label={`${settings.hotelName} — home`} className="flex shrink-0 items-center gap-3 rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
          <Image src="/brand/logo-192.png" alt="" width={56} height={56} priority className="size-11 drop-shadow-[0_4px_12px_rgba(0,0,0,0.5)] transition-[width,height] duration-500 lg:size-13 lg:group-data-[scrolled=true]/hdr:size-10" />
          <span className="leading-none">
            <span className="block font-display text-[1.6rem] font-bold uppercase tracking-[0.16em] text-gold lg:text-[1.85rem]">{first}</span>
            {rest.length > 0 && <span className="mt-1 block text-[10px] font-semibold uppercase tracking-[0.42em] text-white lg:text-[11px]">{rest.join(" ")}</span>}
          </span>
        </Link>

        <nav aria-label="Main" className="ml-auto hidden xl:block">
          <ul className="flex items-center gap-6 xl:gap-8">
            {NAV_LINKS.map((l) => (
              <li key={l.href}>
                <NavLink href={l.href} className="whitespace-nowrap text-[13px] font-medium uppercase tracking-[0.14em] text-white/85">{l.label}</NavLink>
              </li>
            ))}
          </ul>
        </nav>

        <div className="ml-auto flex shrink-0 items-center gap-3 xl:ml-3">
          {/* Staff door: quiet, beside the guest CTA. Offers "Dashboard" to staff already signed in. */}
          <ThemeToggle className="hidden sm:inline-flex" />
          <StaffLink className="hidden whitespace-nowrap rounded-full px-2 py-1 text-sm text-white/65 transition-colors hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold md:inline-flex" />
          <span className="hidden h-5 w-px bg-white/20 md:block" aria-hidden="true" />
          <PillLink href="/book" className="hidden whitespace-nowrap py-1 pl-5 pr-1 text-xs font-semibold uppercase tracking-[0.14em] sm:inline-flex">
            Book your stay
          </PillLink>
          <MobileNav hotelName={settings.hotelName} phone={settings.phone} whatsapp={settings.whatsapp} />
        </div>
      </div>
    </HeaderShell>
  );
}
