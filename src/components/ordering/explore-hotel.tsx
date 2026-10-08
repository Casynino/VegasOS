import Link from "next/link";
import { ArrowUpRight, CalendarCheck, Car, Presentation, UtensilsCrossed, Wine } from "lucide-react";
import { GOLD, GOLD_GRADIENT } from "./menu-picker";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

/** The hotel's main website, for "Explore the hotel". */
const EXPLORE = [
  { href: "/rooms", title: msg("Rooms & suites"), text: msg("See every room and book your next stay"), image: "/images/room-red/room-red-05.webp" },
  { href: "/gallery", title: msg("Gallery"), text: msg("Take a look around the hotel"), image: "/images/lobby/lobby-02.webp" },
  { href: "/restaurant", title: msg("Restaurant"), text: msg("Breakfast to dinner"), icon: UtensilsCrossed },
  { href: "/bar", title: msg("Bar & lounge"), text: msg("Drinks when the day is done"), icon: Wine },
  { href: "/meeting-room", title: msg("Meeting room"), text: msg("Book it for your team"), icon: Presentation },
  { href: "/transport", title: msg("Airport transfer"), text: msg("We pick you up or drop you off"), icon: Car },
] as const;

/** "Explore Vegas": the rest of the hotel on the main website, and booking the next stay. Shown inside the guest apps (browser). */
export function ExploreHotel({ hotel }: { hotel: string }) {
  const t = useT();
  return (
    <section className="rounded-3xl border border-white/10 bg-white/[0.04] p-4 sm:p-5">
      <div className="flex items-end justify-between gap-3">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.3em]" style={{ color: GOLD }}>{t("Discover more")}</p>
          <h2 className="font-display text-2xl sm:text-3xl">{t("Explore {hotel}", { hotel })}</h2>
        </div>
        <Link href="/" className="hidden shrink-0 items-center gap-1 text-sm font-medium text-white/75 hover:text-white sm:inline-flex">{t("Visit our website")}<ArrowUpRight className="size-4" /></Link>
      </div>
      <div className="mt-4 grid grid-cols-2 gap-3 md:grid-cols-3">
        {EXPLORE.map((e) => (
          <Link key={e.href} href={e.href}
            className="group relative flex min-h-[132px] flex-col justify-end overflow-hidden rounded-2xl border border-white/10 bg-linear-to-br from-white/[0.09] to-white/[0.02] p-3.5 transition hover:border-[#e3bd6a]/60">
            {"image" in e ? (
              <>
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={e.image} alt="" loading="lazy" className="absolute inset-0 size-full object-cover transition duration-500 group-hover:scale-105" />
                <span className="absolute inset-0 bg-linear-to-t from-[#0b1026] via-[#0b1026]/40 to-transparent" />
              </>
            ) : (
              <span className="absolute right-3 top-3 grid size-10 place-items-center rounded-full bg-[#e3bd6a]/15 ring-1 ring-[#e3bd6a]/40"><e.icon className="size-5" style={{ color: GOLD }} /></span>
            )}
            <span className="relative">
              <span className="flex items-center gap-1 text-[15px] font-semibold">{t(e.title)}<ArrowUpRight className="size-3.5 opacity-60 transition group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" /></span>
              <span className="block text-[12px] leading-snug text-white/65">{t(e.text)}</span>
            </span>
          </Link>
        ))}
      </div>
      <Link href="/book" className="mt-3 flex items-center justify-between gap-3 rounded-2xl p-4 text-[#1a1206]" style={{ background: GOLD_GRADIENT }}>
        <span className="flex items-center gap-3">
          <CalendarCheck className="size-6 shrink-0" />
          <span className="leading-tight"><span className="block font-semibold">{t("Book your next stay")}</span><span className="text-[12px] opacity-80">{t("Best rates when you book with us directly")}</span></span>
        </span>
        <ArrowUpRight className="size-5 shrink-0" />
      </Link>
    </section>
  );
}

/** The navy night-sky background every guest page shares. */
export function NightSky() {
  return (
    <>
      {/* Warm candle-light from above, a deep blue evening below, a soft grain — never flat, never striped. */}
      <div aria-hidden className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_80%_55%_at_50%_-8%,rgba(227,189,106,0.2),transparent_60%),radial-gradient(circle_at_0%_100%,rgba(56,97,210,0.24),transparent_50%),radial-gradient(circle_at_100%_55%,rgba(196,110,52,0.13),transparent_42%)]" />
      <div aria-hidden className="pointer-events-none fixed inset-0 opacity-[0.07] mix-blend-overlay [background-image:url('data:image/svg+xml;utf8,%3Csvg%20xmlns=%22http://www.w3.org/2000/svg%22%20width=%22160%22%20height=%22160%22%3E%3Cfilter%20id=%22n%22%3E%3CfeTurbulence%20type=%22fractalNoise%22%20baseFrequency=%220.9%22%20numOctaves=%222%22%20stitchTiles=%22stitch%22/%3E%3C/filter%3E%3Crect%20width=%22100%25%22%20height=%22100%25%22%20filter=%22url(%23n)%22/%3E%3C/svg%3E')]" />
    </>
  );
}
