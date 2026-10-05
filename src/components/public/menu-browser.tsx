"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { BedDouble, ChevronLeft, ChevronRight, Search, ShoppingBag, UtensilsCrossed, Wine, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Atmosphere } from "./kit/atmosphere";
import { buttonClass } from "./kit/button";
import { HudFrame, HudLabel, SectionIndex } from "./kit/hud";
import { tones, typeScale } from "./kit/tokens";
import fx from "./dining/dining.module.css";
import roomFx from "./room-fx.module.css";
import { AddControl, BasketPill, OrderDrawer, SHEET, useMenuOrder, WhoDialog, type MenuOrder } from "./menu-order";
import type { PayOption } from "@/components/restaurant/pay-first";

export type MenuSize = { id: string; label: string | null; price: number; available: boolean };
export type MenuEntry = {
  /** Stable, readable key for links (?item=…). */
  key: string;
  name: string;
  description: string | null;
  subcategory: string | null;
  /** `stock`: a licensed stock photo — shown with the "Illustrative" tag where it is large. */
  image: { src: string; alt: string; stock?: boolean } | null;
  /** One entry per size of the same drink (Jameson 750ML / 500ML / 250ML); a single entry for everything else. */
  sizes: MenuSize[];
};
export type MenuSection = { id: string; slug: string; name: string; description: string | null; kind: "FOOD" | "DRINK"; bar: boolean; entries: MenuEntry[] };

const n = (v: number) => v.toLocaleString("en-US");
const pad = (v: number) => String(v).padStart(2, "0");
const minPrice = (e: MenuEntry) => Math.min(...e.sizes.map((s) => s.price));
const available = (e: MenuEntry) => e.sizes.some((s) => s.available);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const reduceMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Under the fixed header (4rem once scrolled) and the 3rem section bar: where a section's top lands. */
const SECTION_TOP = "scroll-mt-32";

/**
 * The public menu, made for browsing like a hotel menu, not a till: a slim bar with the sections
 * (it follows the page, under the header) and a search; food as a classic menu — small photo, name,
 * a dotted line to the price — with a large photo beside it on wide screens that follows the dish
 * you point at; drinks as a two-column list, the sizes of one drink together. Any dish or drink
 * opens its own card: big photo, what it is, the price (or sizes).
 * Everything can be ordered right here — "Add", then "View your order" and send: the same live
 * menu, the same order and the same restaurant flow as the table and room QR codes.
 * Cards can be shared: /menu?item=…
 */
export function MenuBrowser({ sections, whatsapp, roomServiceFee, initialItem = null, payTo }: {
  sections: MenuSection[]; whatsapp: string | null; roomServiceFee: number;
  /** Where take out is paid first (mobile money, banks). */
  payTo: PayOption[];
  /** From a shared link (/menu?item=…): open that dish or drink straight away. */
  initialItem?: string | null;
}) {
  const [q, setQ] = useState("");
  const [searching, setSearching] = useState(false);
  const searchRef = useRef<HTMLInputElement>(null);
  const [active, setActive] = useState(sections[0]?.slug ?? "");
  const [openKey, setOpenKey] = useState<string | null>(() => (initialItem && sections.some((s) => s.entries.some((e) => e.key === initialItem)) ? initialItem : null));
  const chipsRef = useRef<HTMLDivElement>(null);
  // Ordering: every size of every dish or drink is one menu item the restaurant takes orders with.
  const orderItems = useMemo(() => sections.flatMap((s) => s.entries.flatMap((e) => e.sizes.map((x) => ({
    id: x.id, name: x.label ? `${e.name} ${x.label}` : e.name, price: x.price, available: x.available, image: e.image?.src ?? null,
  })))), [sections]);
  const order = useMenuOrder(orderItems);
  const [reviewing, setReviewing] = useState(false);
  const closeReview = useCallback(() => setReviewing(false), []);

  // Search: name, description, kind of drink or section.
  const needle = norm(q.trim());
  const shown = useMemo(() => {
    if (!needle) return sections;
    return sections
      .map((s) => ({ ...s, entries: s.entries.filter((e) => norm(`${e.name} ${e.description ?? ""} ${e.subcategory ?? ""} ${s.name}`).includes(needle)) }))
      .filter((s) => s.entries.length);
  }, [sections, needle]);
  const flat = useMemo(() => shown.flatMap((s) => s.entries.map((e) => ({ s, e }))), [shown]);
  const openAt = flat.findIndex((x) => x.e.key === openKey);
  const current = openAt >= 0 ? flat[openAt] : null;

  // The section tab follows the page.
  useEffect(() => {
    const els = shown.map((s) => document.getElementById(s.slug)).filter((x): x is HTMLElement => !!x);
    const io = new IntersectionObserver((list) => {
      const hit = list.filter((x) => x.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (hit) setActive(hit.target.id);
      // Back above the menu (e.g. a jump to the top of the page): the first section again.
      else if (els[0] && els[0].getBoundingClientRect().top > window.innerHeight * 0.4) setActive(els[0].id);
    }, { rootMargin: "-40% 0px -55% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [shown]);
  useEffect(() => {
    const box = chipsRef.current;
    const chip = box?.querySelector<HTMLElement>(`[data-chip="${active}"]`);
    if (box && chip) box.scrollTo({ left: chip.offsetLeft - box.clientWidth / 2 + chip.clientWidth / 2, behavior: reduceMotion() ? "auto" : "smooth" });
  }, [active]);
  useEffect(() => { if (searching) searchRef.current?.focus(); }, [searching]);

  // Shareable cards: the open dish or drink is kept in the address (?item=…).
  const setOpen = useCallback((key: string | null) => {
    setOpenKey(key);
    const url = new URL(window.location.href);
    if (key) url.searchParams.set("item", key); else url.searchParams.delete("item");
    window.history.replaceState(null, "", url);
  }, []);

  const whatsappOrder = (text: string) => (whatsapp ? `https://wa.me/${whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(text)}` : null);
  const lastBar = [...shown].reverse().find((s) => s.bar)?.id;
  const searchOpen = searching || q !== "";

  return (
    <>
      {/* Sections + search: one slim bar under the header (search folds behind an icon on phones). */}
      {/* The bar sticks only while the menu is on screen (its parent ends with the last section). */}
      <div className="relative">
      {/* Smoked glass (night ink) in both themes: it reads the same over the light kitchen and the dark bar bands. */}
      <nav aria-label="Menu sections" data-tone="night"
        className="sticky top-16 z-30 border-b border-white/10 bg-[linear-gradient(to_bottom,rgb(20_16_12/0.8),rgb(12_10_7/0.86))] text-pub-fg shadow-[0_18px_40px_-26px_rgb(0_0_0/0.7)] backdrop-blur-xl backdrop-saturate-150">
        <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 -bottom-px h-px bg-linear-to-r from-transparent via-gold/50 to-transparent" />
        <div className="mx-auto flex w-full max-w-7xl flex-wrap items-center px-4 sm:px-8 md:flex-nowrap md:gap-6">
          <div ref={chipsRef}
            className="relative flex min-w-0 flex-1 overflow-x-auto [mask-image:linear-gradient(to_right,#000_calc(100%-2.5rem),transparent)] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
            {shown.map((s, i) => (
              <a key={s.id} href={`#${s.slug}`} data-chip={s.slug} aria-current={active === s.slug ? "true" : undefined}
                className={cn(
                  "relative flex h-12 shrink-0 items-center gap-2 px-3 text-[13px] font-medium tracking-[0.02em] transition-colors duration-200 first:pl-0 last:pr-10 focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none",
                  "after:absolute after:bottom-0 after:left-3 after:right-3 after:h-0.5 after:origin-left after:bg-gold after:transition-transform after:duration-300 after:ease-pub first:after:left-0 last:after:right-10 motion-reduce:after:transition-none",
                  active === s.slug ? cn("text-pub-fg after:scale-x-100", fx.chipGlow) : "text-pub-muted after:scale-x-0 hover:text-pub-fg",
                )}>
                <span aria-hidden="true" className={cn("font-mono text-[9.5px] tracking-[0.14em]", active === s.slug ? "text-gold" : "text-pub-faint")}>{pad(i + 1)}</span>
                {s.name}
              </a>
            ))}
          </div>
          <button type="button" aria-expanded={searchOpen} aria-controls="menu-search"
            onClick={() => { if (searchOpen) { setSearching(false); setQ(""); } else setSearching(true); }}
            className="-mr-2 ml-1 grid size-11 shrink-0 place-items-center rounded-full text-pub-muted transition-colors duration-200 hover:text-pub-fg focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-gold motion-reduce:transition-none md:hidden">
            {searchOpen ? <X className="size-[1.125rem]" strokeWidth={1.6} aria-hidden="true" /> : <Search className="size-[1.125rem]" strokeWidth={1.6} aria-hidden="true" />}
            <span className="sr-only">{searchOpen ? "Close search" : "Search the menu"}</span>
          </button>
          <label id="menu-search" className={cn("relative w-full pb-3 md:w-64 md:shrink-0 md:pb-0", searchOpen ? "block" : "hidden md:block")}>
            <span className="sr-only">Search the menu</span>
            <Search className="pointer-events-none absolute left-4 top-[1.375rem] size-4 -translate-y-1/2 text-pub-faint" strokeWidth={1.6} aria-hidden="true" />
            <input ref={searchRef} value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Find a dish or drink"
              className="h-11 w-full rounded-full border border-pub-line bg-pub-field pl-11 pr-11 text-base text-pub-fg placeholder:text-pub-faint transition-[border-color,box-shadow] duration-200 focus:border-pub-fg/40 focus:outline-none focus:ring-3 focus:ring-gold/30 motion-reduce:transition-none md:text-sm [&::-webkit-search-cancel-button]:hidden" />
            {q && (
              <button type="button" onClick={() => { setQ(""); searchRef.current?.focus(); }} aria-label="Clear search"
                className="absolute right-0.5 top-0 grid size-11 place-items-center rounded-full text-pub-muted hover:text-pub-fg focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold">
                <X className="size-4" strokeWidth={1.8} aria-hidden="true" />
              </button>
            )}
          </label>
        </div>
      </nav>

      {/* Every section is its own band: the kitchen on paper (paper and deep in turn), the bar at night — each
          with its own calm atmosphere, and a soft dissolve with a gold horizon where the kitchen meets the bar. */}
      <div>
        {shown.length === 0 && (
          <div data-tone="paper" className={cn("relative isolate", tones.paper)}>
            <Atmosphere tone="paper" atmosphere="calm" />
            <p className={cn(typeScale.lede, "mx-auto max-w-xl px-4 pb-24 pt-20 text-center text-pub-muted")}>Nothing on the menu matches “{q}”. Try “chicken”, “fish”, “beer” or “whisky”.</p>
          </div>
        )}
        {(() => {
          // One band per kitchen section (paper and deep in turn); the bar is one long night band, so its
          // light and line work run on without seams from section to section.
          const band = (s: MenuSection, i: number, tone: "paper" | "deep" | "night", own: boolean) => {
            const food = s.kind === "FOOD";
            return (
              <section key={s.id} id={s.slug} aria-labelledby={`${s.slug}-title`} data-tone={tone}
                className={cn(SECTION_TOP, "relative", own && cn("isolate", tones[tone]), "py-12 sm:py-16 lg:py-20", i === shown.length - 1 && "pb-20 sm:pb-28")}>
                {own && <Atmosphere tone={tone} atmosphere="calm" />}
                <div className="mx-auto w-full max-w-7xl px-4 sm:px-8">
                  <SectionIndex index={i + 1} label={food ? "From the kitchen" : s.bar ? "From the bar" : "Drinks"}
                    aside={<HudLabel tick={false}>{s.entries.length} {food ? (s.entries.length === 1 ? "dish" : "dishes") : s.entries.length === 1 ? "drink" : "drinks"}</HudLabel>} />
                  <header className="grid gap-3 pb-6 pt-5 sm:pb-8 sm:pt-6 lg:grid-cols-12 lg:items-end lg:gap-x-10">
                    <div className={cn("min-w-0 lg:col-span-7", tone === "night" && "flex items-end justify-between gap-4 lg:justify-start lg:gap-8")}>
                      <h2 id={`${s.slug}-title`} className="min-w-0 font-display text-[clamp(2rem,1.5rem+1.8vw,3.25rem)] font-medium leading-[1.05] text-balance">{s.name}</h2>
                      {/* The bar's shelves share one night band: a large outline numeral, filling with gold as it scrolls in, marks each one. */}
                      {tone === "night" && (
                        <span aria-hidden="true" className={cn(roomFx.numeral, "shrink-0 font-display text-[3.75rem] font-medium leading-[0.8] sm:text-[5rem] lg:order-first lg:text-[6rem]")}>
                          {String(i + 1).padStart(2, "0")}
                        </span>
                      )}
                    </div>
                    {s.description && <p className={cn(typeScale.body, "max-w-md text-pub-muted lg:col-span-4 lg:col-start-9 lg:pb-1")}>{s.description}</p>}
                  </header>
                  {food
                    ? <FoodList section={s} onOpen={setOpen} order={order} />
                    : <DrinkList section={s} onOpen={setOpen} order={order} />}
                  {s.id === lastBar && (
                    <p className={cn(typeScale.small, "mt-8 max-w-2xl border-l-2 border-gold/60 pl-4 text-pub-muted")}>
                      Alcohol is served only to guests aged 18 and over — please drink responsibly. Drinks are served at the bar, at your table or through room service — you can also order them online.
                    </p>
                  )}
                </div>
              </section>
            );
          };
          const kitchen = shown.filter((s) => s.kind === "FOOD");
          const bar = shown.filter((s) => s.kind !== "FOOD");
          return (
            <>
              {kitchen.map((s, i) => band(s, i, i % 2 ? "deep" : "paper", true))}
              {bar.length > 0 && (
                <div data-tone="night" className={cn("relative isolate", tones.night)}>
                  <Atmosphere tone="night" atmosphere="calm" aurora />
                  {/* The page's next band (room service) is deep paper: the gold horizon at the foot with a warm light rising from it, as between kit bands. */}
                  <span aria-hidden="true" className="pointer-events-none absolute inset-x-0 bottom-0 -z-[1] h-[clamp(6rem,12vw,11rem)] bg-[radial-gradient(60%_100%_at_50%_100%,rgb(227_189_106/0.12),rgb(227_189_106/0.035)_45%,transparent_78%)]" />
                  <span aria-hidden="true" className="pointer-events-none absolute bottom-0 left-1/2 h-px w-[min(80rem,94%)] -translate-x-1/2 bg-linear-to-r from-transparent via-[rgb(236_202_132/0.95)] to-transparent" />
                  {bar.map((s, j) => band(s, kitchen.length + j, "night", false))}
                </div>
              )}
            </>
          );
        })()}
      </div>
      </div>

      <DishCard entry={current?.e ?? null} section={current?.s ?? null} roomServiceFee={roomServiceFee} whatsappOrder={whatsappOrder} order={order}
        onReview={() => { setOpen(null); setReviewing(true); }}
        onClose={() => setOpen(null)}
        onMove={flat.length > 1 ? (d) => { const x = flat[(openAt + d + flat.length) % flat.length]; if (x) setOpen(x.e.key); } : null} />

      <BasketPill order={order} onOpen={() => { setOpen(null); setReviewing(true); }} />
      <OrderDrawer open={reviewing} order={order} onClose={closeReview} payTo={payTo} />
      <WhoDialog order={order} />
    </>
  );
}

/** The honest label on a stock photo (same look as the kit's IllustrativeTag). */
function StockTag({ className }: { className?: string }) {
  return (
    <span className={cn("pointer-events-none inline-flex items-center rounded-full bg-black/50 px-2.5 py-1 text-[9px] font-medium uppercase leading-none tracking-[0.22em] text-white/85 backdrop-blur-sm", className)}>
      Illustrative
    </span>
  );
}

/** A dish or drink photo filling its frame; an espresso tile with a quiet mark when there is none. */
function Photo({ entry, sizes, className, decorative, eager }: { entry: MenuEntry; sizes: string; className?: string; decorative?: boolean; eager?: boolean }) {
  if (!entry.image) {
    return (
      <span className={cn("grid size-full place-items-center bg-[#1c1712] text-gold/55", className)}>
        <UtensilsCrossed className="size-5" strokeWidth={1.3} aria-hidden="true" />
      </span>
    );
  }
  return <Image src={entry.image.src} alt={decorative ? "" : entry.image.alt} fill sizes={sizes} loading={eager ? "eager" : undefined} className={cn("object-cover", className)} />;
}

/** "TZS 9,000" — the amount in the serif, the currency small; "from" when sizes differ. */
function Amount({ entry, value, className, large }: { entry?: MenuEntry; value?: number; className?: string; large?: boolean }) {
  const from = !!entry && entry.sizes.length > 1;
  const amount = value ?? (entry ? minPrice(entry) : 0);
  return (
    <span className={cn("inline-flex shrink-0 items-baseline gap-1 whitespace-nowrap", className)}>
      {from && <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-pub-muted">from</span>}
      <span className="text-[10px] font-medium uppercase tracking-[0.16em] text-pub-muted">TZS</span>
      <span className={cn(typeScale.price, large ? "text-[1.625rem]" : "text-[1.1875rem]", "leading-none text-pub-fg")}>{n(amount)}</span>
    </span>
  );
}

/** "Choose" for a drink in several sizes — the sizes are on its card; a gold count once some are in the order. */
function ChooseControl({ entry, inOrder, onOpen }: { entry: MenuEntry; inOrder: number; onOpen: () => void }) {
  if (!available(entry)) return <span className={cn(typeScale.meta, "shrink-0 px-1 text-pub-muted")}>Not today</span>;
  return (
    <button type="button" onClick={onOpen} aria-haspopup="dialog" aria-label={`Choose a size of ${entry.name}${inOrder ? ` — ${inOrder} in your order` : ""}`}
      className={buttonClass({ variant: "secondary", size: "sm", className: "shrink-0 gap-2 px-4" })}>
      Choose
      {inOrder > 0 && <span className="grid size-5 place-items-center rounded-full bg-gold text-[10px] font-bold tracking-normal text-[#16110a]">{inOrder}</span>}
    </button>
  );
}

/** Food: a classic menu list; on wide screens a large photo beside it follows the dish you point at. */
function FoodList({ section, onOpen, order }: { section: MenuSection; onOpen: (key: string) => void; order: MenuOrder }) {
  const [focus, setFocus] = useState(section.entries[0]?.key);
  const previewAt = Math.max(0, section.entries.findIndex((e) => e.key === focus));
  const preview = section.entries[previewAt];
  const withPreview = section.entries.some((e) => e.image);
  return (
    <div className="grid items-start gap-10 lg:grid-cols-12 lg:gap-x-10">
      {withPreview && preview && (
        <figure className="sticky top-[9rem] hidden lg:col-span-5 lg:block">
          <HudFrame offset="sm" label={`${pad(previewAt + 1)} / ${pad(section.entries.length)}`} labelEnd="Select a dish for details">
          <div className="relative aspect-[5/4] overflow-hidden rounded-[0.375rem] bg-[#1c1712]">
            <span key={preview.key} className="absolute inset-0 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-500">
              <Photo entry={preview} sizes="(min-width: 1280px) 500px, 40vw" />
            </span>
            <span aria-hidden="true" className="pointer-events-none absolute inset-0 bg-[linear-gradient(to_top,rgb(12_10_7/0.86)_0%,rgb(12_10_7/0.3)_42%,rgb(12_10_7/0)_68%)]" />
            {preview.image?.stock && <StockTag className="absolute left-3 top-3" />}
            <figcaption className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-6 text-white">
              <span className="min-w-0">
                <span className="block font-display text-[1.75rem] font-medium leading-tight">{preview.name}</span>
                {preview.description && <span className="mt-2 line-clamp-1 block text-[13px] text-white/70">{preview.description}</span>}
              </span>
              <span className="shrink-0 whitespace-nowrap font-display text-[1.375rem] font-medium tabular-nums lining-nums text-gold">
                <span className="mr-1 font-sans text-[10px] font-medium tracking-[0.16em] text-gold/75">TZS</span>{n(minPrice(preview))}
              </span>
            </figcaption>
          </div>
          </HudFrame>
        </figure>
      )}
      <ul className={cn("border-t border-pub-line", withPreview ? "lg:col-span-7" : "lg:col-span-12 lg:max-w-4xl")}>
        {section.entries.map((e) => {
          const single = e.sizes.length === 1;
          const inOrder = e.sizes.reduce((t, x) => t + order.qty(x.id), 0);
          return (
            <li key={e.key}
              className={cn("relative border-b border-pub-line transition-colors duration-200 motion-reduce:transition-none",
                focus === e.key && withPreview && "lg:bg-[linear-gradient(to_right,color-mix(in_oklab,var(--gold)_9%,transparent),transparent_70%)]",
                inOrder > 0 && "before:absolute before:inset-y-4 before:-left-3 before:w-0.5 before:rounded-full before:bg-gold sm:before:-left-4")}>
              {withPreview && <span aria-hidden="true" className={cn("pointer-events-none absolute inset-y-0 left-0 hidden w-px bg-linear-to-b from-transparent via-gold to-transparent transition-opacity duration-300 motion-reduce:transition-none lg:block", focus === e.key ? "opacity-100" : "opacity-0")} />}
              <div className="flex flex-col py-4 sm:flex-row sm:items-center sm:gap-6 sm:py-5 lg:px-4">
                <button type="button" onClick={() => onOpen(e.key)} onMouseEnter={() => setFocus(e.key)} onFocus={() => setFocus(e.key)} aria-haspopup="dialog"
                  className={cn("group flex min-w-0 flex-1 items-start gap-4 rounded-[0.375rem] text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold sm:items-center sm:gap-5",
                    !available(e) && "opacity-60")}>
                  <span className="relative size-14 shrink-0 overflow-hidden rounded-[0.375rem] bg-[#1c1712] sm:size-[4.5rem]">
                    <Photo entry={e} decorative sizes="72px" className="transition-transform duration-500 ease-pub group-hover:scale-105 motion-reduce:transition-none" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-baseline gap-3">
                      <span className={cn(typeScale.item, "text-pub-fg transition-colors duration-200 group-hover:text-pub-eyebrow motion-reduce:transition-none")}>{e.name}</span>
                      <span aria-hidden="true" className="mb-1 hidden min-w-6 flex-1 border-b border-dotted border-pub-fg/25 sm:block" />
                      <Amount entry={e} className="hidden sm:inline-flex" />
                    </span>
                    {e.description && <span className="mt-1 line-clamp-2 block text-[14px] leading-relaxed text-pub-muted">{e.description}</span>}
                    {!available(e) && <span className={cn(typeScale.meta, "mt-1.5 block text-pub-muted")}>Not available today</span>}
                  </span>
                </button>
                {/* Under the dish on phones (price left, Add right); at the end of the row on wider screens. */}
                <div className="mt-3 flex items-center justify-between gap-3 pl-[4.5rem] sm:mt-0 sm:pl-0">
                  <Amount entry={e} className="sm:hidden" />
                  {single
                    ? <AddControl qty={order.qty(e.sizes[0].id)} name={e.name} size="sm" disabled={!available(e)} onChange={(q) => order.setQty(e.sizes[0].id, q)} />
                    : <ChooseControl entry={e} inOrder={inOrder} onOpen={() => onOpen(e.key)} />}
                </div>
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/** Drinks: a two-column list (one on phones); every size of one drink on one row. */
function DrinkList({ section, onOpen, order }: { section: MenuSection; onOpen: (key: string) => void; order: MenuOrder }) {
  return (
    <ul className="grid border-t border-pub-line md:grid-cols-2 md:gap-x-10 lg:gap-x-14">
      {section.entries.map((e) => {
        const single = e.sizes.length === 1;
        const inOrder = e.sizes.reduce((t, x) => t + order.qty(x.id), 0);
        return (
          <li key={e.key}
            className={cn("relative min-w-0 border-b border-pub-line",
              inOrder > 0 && "before:absolute before:inset-y-3.5 before:-left-3 before:w-0.5 before:rounded-full before:bg-gold sm:before:-left-4")}>
            <div className="flex items-center gap-3 py-3.5 sm:gap-4">
              <button type="button" onClick={() => onOpen(e.key)} aria-haspopup="dialog"
                className={cn("group flex min-w-0 flex-1 items-center gap-4 rounded-[0.375rem] text-left focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-gold",
                  !available(e) && "opacity-60")}>
                <span className="relative hidden size-14 shrink-0 overflow-hidden rounded-[0.375rem] bg-[#1c1712] sm:block">
                  <Photo entry={e} decorative sizes="56px" className="transition-transform duration-500 ease-pub group-hover:scale-105 motion-reduce:transition-none" />
                </span>
                <span className="min-w-0 flex-1">
                  <span className={cn(typeScale.item, "line-clamp-2 text-pub-fg transition-colors duration-200 group-hover:text-pub-eyebrow motion-reduce:transition-none")}>{e.name}</span>
                  <span className={cn(typeScale.meta, "mt-1 block truncate text-pub-muted")}>
                    {e.sizes.length > 1 ? e.sizes.map((x) => x.label).join(" · ") : e.subcategory ?? (section.bar ? "Bar" : "Drink")}
                  </span>
                  <Amount entry={e} className="mt-1.5" />
                </span>
              </button>
              {single
                ? <AddControl qty={order.qty(e.sizes[0].id)} name={e.name} size="sm" disabled={!available(e)} onChange={(q) => order.setQty(e.sizes[0].id, q)} />
                : <ChooseControl entry={e} inOrder={inOrder} onOpen={() => onOpen(e.key)} />}
            </div>
          </li>
        );
      })}
    </ul>
  );
}

/** One dish or drink, opened: big photo, what it is, the price or sizes, and how to order. */
function DishCard({ entry, section, roomServiceFee, whatsappOrder, order, onReview, onClose, onMove }: {
  entry: MenuEntry | null; section: MenuSection | null; roomServiceFee: number; whatsappOrder: (text: string) => string | null; order: MenuOrder;
  onReview: () => void; onClose: () => void; onMove: ((d: number) => void) | null;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  const opener = useRef<HTMLElement | null>(null);
  const touch = useRef<{ x: number; y: number } | null>(null);
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (entry && !d.open) { opener.current = document.activeElement as HTMLElement | null; d.showModal(); }
    if (!entry && d.open) d.close();
  }, [entry]);

  // A sideways swipe on the photo moves to the next or previous dish.
  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    touch.current = t ? { x: t.clientX, y: t.clientY } : null;
  }
  function onTouchEnd(e: React.TouchEvent) {
    const start = touch.current;
    const t = e.changedTouches[0];
    touch.current = null;
    if (!start || !t || !onMove) return;
    const dx = t.clientX - start.x;
    if (Math.abs(dx) > 48 && Math.abs(dx) > Math.abs(t.clientY - start.y) * 1.4) onMove(dx < 0 ? 1 : -1);
  }

  const multi = !!entry && entry.sizes.length > 1;
  const wa = entry ? whatsappOrder(`Hello, I would like to order ${entry.name}.`) : null;
  const overPhoto = "grid size-11 place-items-center rounded-full border border-white/20 bg-black/45 text-white backdrop-blur-md transition-colors duration-200 hover:border-gold/70 hover:text-gold focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none";
  return (
    <dialog ref={ref} aria-labelledby="dish-title" data-tone="paper"
      onClose={() => { onClose(); opener.current?.focus(); }}
      onClick={(e) => { if (e.target === e.currentTarget) ref.current?.close(); }}
      onKeyDown={(e) => { if (!onMove) return; if (e.key === "ArrowRight") { e.preventDefault(); onMove(1); } if (e.key === "ArrowLeft") { e.preventDefault(); onMove(-1); } }}
      className={cn(SHEET, "max-w-[40rem]")}>
      {entry && section && (
        <div className="flex max-h-[92dvh] flex-col">
          <div className="relative aspect-[16/11] shrink-0 bg-[#1c1712] sm:aspect-[4/3]" onTouchStart={onTouchStart} onTouchEnd={onTouchEnd}>
            <span key={entry.key} className="absolute inset-0 motion-safe:animate-in motion-safe:fade-in motion-safe:duration-300">
              <Photo entry={entry} sizes="(min-width: 640px) 640px, 100vw" eager />
            </span>
            <span className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-linear-to-b from-black/45 to-transparent" aria-hidden="true" />
            {entry.image?.stock && <StockTag className="absolute left-4 top-4" />}
            <button type="button" onClick={() => ref.current?.close()} aria-label="Close" autoFocus className={cn(overPhoto, "absolute right-3 top-3")}>
              <X className="size-5" strokeWidth={1.6} aria-hidden="true" />
            </button>
            {onMove && (
              <span className="absolute bottom-3 right-3 flex gap-2">
                <button type="button" onClick={() => onMove(-1)} aria-label="Previous" className={overPhoto}><ChevronLeft className="size-5" strokeWidth={1.6} aria-hidden="true" /></button>
                <button type="button" onClick={() => onMove(1)} aria-label="Next" className={overPhoto}><ChevronRight className="size-5" strokeWidth={1.6} aria-hidden="true" /></button>
              </span>
            )}
          </div>
          <div className="overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-5 sm:px-8 sm:pb-8 sm:pt-7">
            <p className={cn(typeScale.eyebrow, "flex items-center gap-2 text-pub-eyebrow")}>
              {section.kind === "DRINK" ? <Wine className="size-3.5" strokeWidth={1.6} aria-hidden="true" /> : <UtensilsCrossed className="size-3.5" strokeWidth={1.6} aria-hidden="true" />}
              {section.name}{entry.subcategory && entry.subcategory !== section.name ? ` · ${entry.subcategory}` : ""}
            </p>
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h2 id="dish-title" className="font-display text-[clamp(1.875rem,1.6rem+1vw,2.375rem)] font-medium leading-[1.05] text-balance">{entry.name}</h2>
              {!multi && <Amount value={entry.sizes[0].price} large />}
            </div>
            {entry.description && <p className={cn(typeScale.body, "mt-3 text-pub-muted")}>{entry.description}</p>}

            {multi && (
              <ul className="mt-5 border-t border-pub-line">
                {entry.sizes.map((x) => (
                  <li key={x.id} className={cn("flex items-center gap-3 border-b border-pub-line py-2.5", !x.available && "opacity-55")}>
                    <span className={cn(typeScale.meta, "mr-auto text-pub-fg min-[380px]:mr-0")}>{x.label}</span>
                    <span aria-hidden="true" className="mb-1 hidden min-w-6 flex-1 self-end border-b border-dotted border-pub-fg/25 min-[380px]:block" />
                    <Amount value={x.price} />
                    <AddControl qty={order.qty(x.id)} name={`${entry.name} ${x.label}`} size="sm" disabled={!x.available} onChange={(q) => order.setQty(x.id, q)} />
                  </li>
                ))}
              </ul>
            )}
            {!available(entry) && <p className="mt-4 border-l-2 border-gold/60 pl-4 text-sm font-medium text-pub-fg">Not available today — ask the restaurant what&apos;s fresh.</p>}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {!multi && available(entry) && (
                <div className="flex items-center gap-3">
                  <AddControl qty={order.qty(entry.sizes[0].id)} name={entry.name} onChange={(q) => order.setQty(entry.sizes[0].id, q)} />
                  {order.qty(entry.sizes[0].id) > 0 && <span className="text-sm tabular-nums text-pub-muted">In your order · TZS {n(entry.sizes[0].price * order.qty(entry.sizes[0].id))}</span>}
                </div>
              )}
              {wa && <a href={wa} target="_blank" rel="noopener" className="inline-flex min-h-11 items-center self-start text-[13px] font-medium text-pub-muted underline decoration-pub-line underline-offset-4 transition-colors duration-200 hover:text-pub-fg hover:decoration-gold motion-reduce:transition-none sm:self-auto">Or ask on WhatsApp</a>}
            </div>
            {order.count > 0 && (
              <button type="button" onClick={onReview} className={buttonClass({ variant: "primary", size: "md", full: true, className: "mt-5 justify-between px-5" })}>
                <span className="flex min-w-0 items-center gap-2.5">
                  <ShoppingBag className="size-4 shrink-0" strokeWidth={1.8} aria-hidden="true" />
                  <span className="truncate">View your order · {order.count}<span className="sr-only"> item{order.count === 1 ? "" : "s"}</span></span>
                </span>
                <span className="shrink-0 font-display text-[1.125rem] font-medium normal-case tracking-normal tabular-nums lining-nums">TZS {n(order.subtotal)}</span>
              </button>
            )}
            <p className="mt-5 flex items-start gap-2.5 border-t border-pub-line pt-4 text-[13px] leading-relaxed text-pub-muted">
              <BedDouble className="mt-0.5 size-4 shrink-0 text-pub-eyebrow" strokeWidth={1.6} aria-hidden="true" />
              Staying with us? Scan the QR card in your room — we bring it up and add it to your room bill (TZS {n(roomServiceFee)} delivery).
            </p>
          </div>
        </div>
      )}
    </dialog>
  );
}
