import Link from "next/link";
import { ArrowUpRight, Globe } from "lucide-react";
import type { OrderMenuSection } from "./menu-picker";
import { useT } from "@/i18n/client";

const GOLD = "#e3bd6a";
export type HeroPhoto = { src: string; name: string; price: number };
/** A dish or drink for the moving showcase / sliding strip: its photo, name, price — and its id so a tap adds it. */
export type ShowcasePick = HeroPhoto & { id: string; drink: boolean; category: string };

/** Dishes and drinks that photograph best, in the order they fill the wall (food, drink, food, drink, food). */
const PREFERRED = [
  "mi_local_favorites_nyama_choma_beef", "mi_sides_drinks_fresh_assorted_juices", "mi_starters_soups_bbq_or_spicy_chicken_wings",
  "mi_beers_kilimanjaro", "mi_local_favorites_samaki_choma_grilled_fish", "mi_sides_drinks_fresh_fruit_smoothies", "mi_main_courses_beef_steak_veg_pepper_sauce",
];

/**
 * Five real photos from today's menu for the header — food and drinks mixed, only dishes that
 * are on the menu and available now (the hotel's favourites first, then any others with a photo).
 */
export function heroPhotos(sections: OrderMenuSection[], count = 5): ShowcasePick[] {
  const items = sections.flatMap((s) => s.items.filter((i) => i.image && i.available).map((i) => ({ ...i, drink: s.drink, category: s.name })));
  const picked = PREFERRED.map((id) => items.find((i) => i.id === id)).filter((i): i is (typeof items)[number] => !!i);
  const rest = items.filter((i) => !picked.includes(i));
  const food = rest.filter((i) => !i.drink), drink = rest.filter((i) => i.drink);
  while (picked.length < count && (food.length || drink.length)) {
    const wantDrink = picked.length % 2 === 1;
    const next = (wantDrink ? drink.shift() ?? food.shift() : food.shift() ?? drink.shift())!;
    picked.push(next);
  }
  return picked.slice(0, count).map((i) => ({ id: i.id, src: i.image!, name: i.name, price: i.price, drink: i.drink, category: i.category }));
}

/** The sliding strip: every other dish and drink with a photo (not already in the showcase), drinks and food mixed. */
export function stripPicks(sections: OrderMenuSection[], shown: ShowcasePick[], count = 16): ShowcasePick[] {
  const seen = new Set(shown.map((x) => x.id));
  const items = sections.flatMap((s) => s.items.filter((i) => i.image && i.available && !seen.has(i.id)).map((i) => ({ id: i.id, src: i.image!, name: i.name, price: i.price, drink: s.drink, category: s.name })));
  const food = items.filter((i) => !i.drink), drink = items.filter((i) => i.drink), out: ShowcasePick[] = [];
  while (out.length < count && (food.length || drink.length)) out.push((out.length % 2 ? drink.shift() ?? food.shift() : food.shift() ?? drink.shift())!);
  return out;
}

/**
 * The header of every ordering page (the menu QR, a table, the counter, a room): the hotel
 * mark, a wall of real dishes and drinks from the menu, and — on the dark, never over a photo —
 * where you are ("Table 6 · Outside", "Room 305") in big clear type.
 */
export function PlaceHero({ hotel, eyebrow, title, accent, line, chips, media, below, children }: {
  hotel: string; eyebrow: string; title: string; accent?: string | null; line?: React.ReactNode; chips?: React.ReactNode;
  /** The moving dish showcase (right on computers, first on phones). */
  media: React.ReactNode;
  /** Full width under the header — the sliding strip of dishes. */
  below?: React.ReactNode;
  children?: React.ReactNode;
}) {
  const t = useT();
  return (
    <header className="relative">
      <div className="relative mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 pt-5 sm:px-6">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-[#070b1c] ring-1 ring-[#e3bd6a]/60">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-192.png" alt="" className="size-8 rounded-full" />
          </span>
          <span className="truncate text-[11px] font-semibold uppercase tracking-[0.18em] text-white/90 sm:tracking-[0.26em]">{hotel}</span>
        </Link>
        <Link href="/" className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-xs font-medium text-white/85 ring-1 ring-white/15 backdrop-blur transition hover:bg-white/10"><span className="hidden sm:inline">{t("Our website")}</span><Globe className="size-3.5 sm:hidden" /><ArrowUpRight className="hidden size-3.5 sm:block" /><span className="sr-only sm:hidden">{t("Our website")}</span></Link>
      </div>

      <div className="relative mx-auto grid max-w-6xl items-center gap-6 px-4 pb-8 pt-5 sm:px-6 lg:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)] lg:gap-12 lg:pb-14 lg:pt-10">
        <div className="min-w-0">{media}</div>
        <div className="min-w-0 lg:order-first">
          <span className="inline-flex items-center gap-2 rounded-full border border-[#e3bd6a]/40 bg-[#e3bd6a]/10 px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: GOLD }}>
            <span className="relative flex size-1.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-[#e3bd6a] opacity-60 motion-reduce:hidden" /><span className="relative inline-flex size-1.5 rounded-full bg-[#e3bd6a]" /></span>
            {eyebrow}
          </span>
          <h1 className="mt-3 font-display text-[56px] leading-[0.92] tracking-tight text-white sm:text-[76px] lg:text-[96px]">{title}</h1>
          {accent && <p className="mt-1 font-display text-[28px] italic leading-none sm:text-[36px] lg:text-[44px]" style={{ color: GOLD }}>{accent}</p>}
          {line && <p className="mt-4 max-w-md text-[15px] leading-relaxed text-white/75">{line}</p>}
          {chips && <div className="mt-5 flex flex-wrap gap-2 text-xs">{chips}</div>}
          {children}
        </div>
      </div>
      {below && <div className="relative pb-6 lg:pb-10">{below}</div>}
    </header>
  );
}

/** A small fact under the title: an icon and a few words ("Kitchen · 7am–11pm"). */
export function HeroChip({ icon: Icon, children }: { icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>; children: React.ReactNode }) {
  return (
    <span className="inline-flex items-center gap-1.5 rounded-full bg-white/[0.06] px-3 py-1.5 text-white/85 ring-1 ring-white/12">
      <Icon className="size-3.5" style={{ color: GOLD }} />{children}
    </span>
  );
}
