"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import { BedDouble, ChevronLeft, ChevronRight, Plus, Search, UtensilsCrossed, Wine, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { eyebrow, goldText, type } from "./ui";
import { AddControl, BasketPill, OrderDrawer, useMenuOrder, WhoDialog, type MenuOrder } from "./menu-order";
import type { PayOption } from "@/components/restaurant/pay-first";

export type MenuSize = { id: string; label: string | null; price: number; available: boolean };
export type MenuEntry = {
  /** Stable, readable key for links (?item=…). */
  key: string;
  name: string;
  description: string | null;
  subcategory: string | null;
  image: { src: string; alt: string } | null;
  /** One entry per size of the same drink (Jameson 750ML / 500ML / 250ML); a single entry for everything else. */
  sizes: MenuSize[];
};
export type MenuSection = { id: string; slug: string; name: string; description: string | null; kind: "FOOD" | "DRINK"; bar: boolean; entries: MenuEntry[] };

const n = (v: number) => v.toLocaleString("en-US");
const minPrice = (e: MenuEntry) => Math.min(...e.sizes.map((s) => s.price));
const available = (e: MenuEntry) => e.sizes.some((s) => s.available);
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

/**
 * The public menu, made for browsing: a sticky bar with the sections (it follows
 * the page) and a search; food as a classic menu list — small photo, name, a dotted
 * line to the price — with a large photo beside it on wide screens that follows the
 * dish you point at; drinks as compact tiles, the sizes of one drink together. Any
 * dish or drink opens its own card: big photo, what it is, the price (or sizes).
 * Everything can be ordered right here — "Add", then "View your order" and send: the same
 * live menu, the same order and the same restaurant flow as the table and room QR codes.
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

  // The section chip follows the page.
  useEffect(() => {
    const els = shown.map((s) => document.getElementById(s.slug)).filter((x): x is HTMLElement => !!x);
    const io = new IntersectionObserver((list) => {
      const hit = list.filter((x) => x.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (hit) setActive(hit.target.id);
    }, { rootMargin: "-40% 0px -55% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [shown]);
  useEffect(() => {
    const box = chipsRef.current;
    const chip = box?.querySelector<HTMLElement>(`[data-chip="${active}"]`);
    if (box && chip) box.scrollTo({ left: chip.offsetLeft - box.clientWidth / 2 + chip.clientWidth / 2, behavior: "smooth" });
  }, [active]);

  // Shareable cards: the open dish or drink is kept in the address (?item=…).
  const setOpen = useCallback((key: string | null) => {
    setOpenKey(key);
    const url = new URL(window.location.href);
    if (key) url.searchParams.set("item", key); else url.searchParams.delete("item");
    window.history.replaceState(null, "", url);
  }, []);

  const whatsappOrder = (text: string) => (whatsapp ? `https://wa.me/${whatsapp.replace(/\D/g, "")}?text=${encodeURIComponent(text)}` : null);
  const lastBar = [...shown].reverse().find((s) => s.bar)?.id;

  return (
    <>
      {/* Sections + search */}
      <nav aria-label="Menu sections" className="sticky top-16 z-30 border-y border-tone/10 bg-paper/90 backdrop-blur-xl sm:top-20">
        <div className="mx-auto flex w-full max-w-7xl flex-col gap-2 px-4 py-2.5 sm:px-8 md:flex-row md:items-center md:gap-4">
          <div ref={chipsRef} className="-mx-1 flex min-w-0 flex-1 gap-1.5 overflow-x-auto px-1 py-0.5 [scrollbar-width:none]">
            {shown.map((s) => (
              <a key={s.id} href={`#${s.slug}`} data-chip={s.slug} aria-current={active === s.slug ? "true" : undefined}
                className={cn("shrink-0 rounded-full border px-3.5 py-1.5 text-[13px] font-medium transition-colors",
                  active === s.slug ? "border-tone bg-tone text-paper" : "border-tone/15 bg-panel text-tone/80 hover:border-gold hover:text-tone")}>
                {s.name}
              </a>
            ))}
          </div>
          <label className="relative block md:w-64 md:shrink-0">
            <span className="sr-only">Search the menu</span>
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-tone/45" aria-hidden />
            <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Find a dish or drink"
              className="h-10 w-full rounded-full border border-tone/15 bg-panel pl-10 pr-9 text-sm text-tone placeholder:text-tone/45 focus:border-tone/40 focus:outline-none focus:ring-2 focus:ring-gold/40" />
            {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-3 top-1/2 -translate-y-1/2 text-tone/50 hover:text-tone"><X className="size-4" /></button>}
          </label>
        </div>
      </nav>

      <div className="bg-paper pb-20">
        {shown.length === 0 && (
          <p className="mx-auto max-w-xl px-4 pt-20 text-center text-tone/65">Nothing on the menu matches “{q}”. Try “chicken”, “fish”, “beer” or “whisky”.</p>
        )}
        {shown.map((s, si) => (
          <section key={s.id} id={s.slug} aria-labelledby={`${s.slug}-title`} className="scroll-mt-40 pt-14 sm:pt-20">
            <div className="mx-auto w-full max-w-7xl px-4 sm:px-8">
              <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-2 border-b border-tone/10 pb-4 sm:mb-8">
                <div>
                  <p className={cn(eyebrow, goldText)}>{String(sections.findIndex((x) => x.id === s.id) + 1).padStart(2, "0")} · {s.kind === "DRINK" ? "Drinks" : "Food"}</p>
                  <h2 id={`${s.slug}-title`} className={cn("mt-2", type.h3)}>{s.name}</h2>
                </div>
                {s.description && <p className="max-w-md text-sm leading-relaxed text-tone/60 sm:text-[15px]">{s.description}</p>}
              </header>
              {s.kind === "FOOD"
                ? <FoodList section={s} onOpen={setOpen} first={si === 0} order={order} />
                : <DrinkTiles section={s} onOpen={setOpen} order={order} />}
              {s.id === lastBar && (
                <p className="mt-8 rounded-2xl border border-tone/10 bg-panel px-5 py-4 text-sm leading-relaxed text-tone/65">
                  Alcohol is served only to guests aged 18 and over — please drink responsibly. Drinks are served at the bar, at your table or through room service — you can also order them online.
                </p>
              )}
            </div>
          </section>
        ))}
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

function Photo({ entry, sizes, className, priority }: { entry: MenuEntry; sizes: string; className?: string; priority?: boolean }) {
  if (!entry.image) {
    return (
      <span className={cn("grid size-full place-items-center bg-linear-to-br from-[#3a2412] via-[#6b3f1d] to-[#c7883f] text-white/85", className)}>
        <UtensilsCrossed className="size-6" strokeWidth={1.4} aria-hidden />
      </span>
    );
  }
  return <Image src={entry.image.src} alt={entry.image.alt} fill sizes={sizes} priority={priority} loading={priority ? undefined : "lazy"} className={cn("object-cover", className)} />;
}

function Price({ entry, className }: { entry: MenuEntry; className?: string }) {
  return (
    <span className={cn("whitespace-nowrap tabular-nums", className)}>
      {entry.sizes.length > 1 && <span className="mr-1 text-[0.8em] font-normal text-tone/50">from</span>}TZS {n(minPrice(entry))}
    </span>
  );
}

/** Food: a classic menu list; on wide screens a large photo beside it follows the dish you point at. */
function FoodList({ section, onOpen, first, order }: { section: MenuSection; onOpen: (key: string) => void; first: boolean; order: MenuOrder }) {
  const [focus, setFocus] = useState(section.entries[0]?.key);
  const preview = section.entries.find((e) => e.key === focus) ?? section.entries[0];
  return (
    <div className="grid items-start gap-8 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-12">
      {preview && (
        <figure className="sticky top-40 hidden overflow-hidden rounded-[2rem] border border-tone/10 bg-paper-deep shadow-[0_30px_60px_-40px_rgba(20,15,10,0.6)] lg:block">
          <div className="relative aspect-[5/4]">
            <span key={preview.key} className="absolute inset-0 animate-in fade-in duration-500 motion-reduce:animate-none">
              <Photo entry={preview} sizes="(min-width:1280px) 480px, 38vw" priority={first} />
            </span>
            <span className="pointer-events-none absolute inset-0 bg-linear-to-t from-black/70 via-black/10 to-transparent" aria-hidden />
            <figcaption className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-4 p-6 text-white">
              <span className="min-w-0">
                <span className="block font-display text-3xl leading-tight">{preview.name}</span>
                <span className="mt-1 block text-xs uppercase tracking-[0.22em] text-white/70">Tap for details</span>
              </span>
              <Price entry={preview} className="rounded-full bg-black/45 px-3 py-1.5 text-sm font-semibold text-[#f0cf86] backdrop-blur" />
            </figcaption>
          </div>
        </figure>
      )}
      <ul className="divide-y divide-tone/10">
        {section.entries.map((e) => (
          <li key={e.key} className={cn("flex flex-col rounded-2xl transition-colors hover:bg-panel sm:flex-row sm:items-center sm:gap-2 sm:pr-3", focus === e.key && "lg:bg-panel/70", order.qty(e.sizes[0].id) > 0 && "bg-panel ring-1 ring-gold/40")}>
            <button type="button" onClick={() => onOpen(e.key)} onMouseEnter={() => setFocus(e.key)} onFocus={() => setFocus(e.key)} aria-haspopup="dialog"
              className={cn("group flex min-w-0 flex-1 items-center gap-4 rounded-2xl px-2 py-3.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/50 sm:px-3",
                !available(e) && "opacity-60")}>
              <span className="relative size-16 shrink-0 overflow-hidden rounded-2xl bg-paper-deep sm:size-[4.5rem]">
                <Photo entry={e} sizes="72px" className="transition duration-500 group-hover:scale-105 motion-reduce:transition-none" />
              </span>
              <span className="min-w-0 flex-1">
                <span className="flex items-baseline gap-3">
                  <span className="font-display text-[1.3rem] leading-tight text-tone sm:text-[1.45rem]">{e.name}</span>
                  <span aria-hidden className="mb-1.5 hidden min-w-8 flex-1 border-b border-dotted border-tone/25 sm:block" />
                  <Price entry={e} className="ml-auto text-[15px] font-semibold text-tone sm:ml-0" />
                </span>
                {e.description && <span className="mt-1 line-clamp-2 block text-sm leading-relaxed text-tone/60">{e.description}</span>}
                {!available(e) && <span className="mt-1 block text-xs font-medium text-tone/70">Not available today</span>}
              </span>
            </button>
            {/* Under the dish on phones, at the end of the row on wider screens */}
            <div className="-mt-2 flex justify-end pb-3 pr-2 sm:m-0 sm:p-0">
              {e.sizes.length === 1
                ? <AddControl qty={order.qty(e.sizes[0].id)} name={e.name} size="sm" disabled={!available(e)} onChange={(q) => order.setQty(e.sizes[0].id, q)} />
                : <button type="button" onClick={() => onOpen(e.key)} className="h-9 shrink-0 rounded-full border border-tone/20 px-3 text-xs font-semibold hover:border-tone">Choose</button>}
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** Drinks: compact tiles; every size of one drink on one tile. */
function DrinkTiles({ section, onOpen, order }: { section: MenuSection; onOpen: (key: string) => void; order: MenuOrder }) {
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-3 sm:gap-4 lg:grid-cols-5">
      {section.entries.map((e) => {
        const inOrder = e.sizes.reduce((t, x) => t + order.qty(x.id), 0);
        return (
        <li key={e.key} className="relative">
          <button type="button" onClick={() => onOpen(e.key)} aria-haspopup="dialog"
            className={cn("group flex h-full w-full flex-col overflow-hidden rounded-3xl border border-tone/10 bg-panel text-left transition duration-300 hover:-translate-y-0.5 hover:border-gold/60 hover:shadow-[0_24px_50px_-30px_rgba(20,15,10,0.55)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60 motion-reduce:transition-none",
              !available(e) && "opacity-60")}>
            <span className="relative block aspect-[4/3] overflow-hidden bg-paper-deep">
              <Photo entry={e} sizes="(min-width:1024px) 17vw, (min-width:640px) 30vw, 46vw" className="transition duration-700 group-hover:scale-105 motion-reduce:transition-none" />
            </span>
            <span className="flex flex-1 flex-col gap-1 p-3.5 sm:p-4">
              <span className="font-display text-[1.15rem] leading-tight text-tone sm:text-xl">{e.name}</span>
              <span className="text-[11px] uppercase tracking-[0.16em] text-tone/50">
                {e.sizes.length > 1 ? e.sizes.map((x) => x.label).join(" · ") : e.subcategory ?? (section.bar ? "Bar" : "Drink")}
              </span>
              <Price entry={e} className="mt-auto pt-2 pr-12 text-[15px] font-semibold text-tone" />
            </span>
          </button>
          {/* Add straight from the tile (one size), or choose the size on its card */}
          <span className="absolute bottom-3 right-3">
            {e.sizes.length === 1
              ? (available(e) && (order.qty(e.sizes[0].id) === 0
                ? <button type="button" onClick={() => order.setQty(e.sizes[0].id, 1)} aria-label={`Add ${e.name}`} className="grid size-9 place-items-center rounded-full bg-gold text-[#1a140c] shadow-[0_8px_20px_-8px_oklch(0.72_0.12_80/0.9)] transition active:scale-90"><Plus className="size-4" strokeWidth={2.5} /></button>
                : <button type="button" onClick={() => onOpen(e.key)} aria-label={`${e.name} in your order`} className="grid size-9 place-items-center rounded-full bg-tone text-sm font-bold text-paper">{order.qty(e.sizes[0].id)}</button>))
              : <button type="button" onClick={() => onOpen(e.key)} aria-label={`Choose a size of ${e.name}`} className={cn("grid size-9 place-items-center rounded-full text-sm font-bold", inOrder ? "bg-tone text-paper" : "bg-gold text-[#1a140c]")}>{inOrder || <Plus className="size-4" strokeWidth={2.5} />}</button>}
          </span>
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
  useEffect(() => {
    const d = ref.current;
    if (!d) return;
    if (entry && !d.open) { opener.current = document.activeElement as HTMLElement | null; d.showModal(); }
    if (!entry && d.open) d.close();
  }, [entry]);

  const multi = !!entry && entry.sizes.length > 1;
  const wa = entry ? whatsappOrder(`Hello, I would like to order ${entry.name}.`) : null;
  return (
    <dialog ref={ref} aria-labelledby="dish-title"
      onClose={() => { onClose(); opener.current?.focus(); }}
      onClick={(e) => { if (e.target === e.currentTarget) ref.current?.close(); }}
      onKeyDown={(e) => { if (!onMove) return; if (e.key === "ArrowRight") { e.preventDefault(); onMove(1); } if (e.key === "ArrowLeft") { e.preventDefault(); onMove(-1); } }}
      className="m-auto w-full max-w-[40rem] overflow-hidden border-0 bg-panel p-0 text-tone shadow-2xl backdrop:bg-[#0d0b08]/70 backdrop:backdrop-blur-sm max-sm:mb-0 max-sm:mt-auto max-sm:max-w-none max-sm:rounded-t-[2rem] sm:rounded-[2rem] open:animate-in open:fade-in-0 max-sm:open:slide-in-from-bottom-10 sm:open:zoom-in-95 motion-reduce:open:animate-none">
      {entry && section && (
        <div className="flex max-h-[92dvh] flex-col">
          <div className="relative aspect-[4/3] shrink-0 bg-paper-deep">
            <Photo entry={entry} sizes="(min-width:640px) 640px, 100vw" priority />
            <span className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-linear-to-b from-black/45 to-transparent" aria-hidden />
            <button type="button" onClick={() => ref.current?.close()} aria-label="Close" autoFocus
              className="absolute right-3 top-3 grid size-10 place-items-center rounded-full bg-black/50 text-white backdrop-blur transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
              <X className="size-5" />
            </button>
            {onMove && (
              <span className="absolute bottom-3 right-3 flex gap-1.5">
                <button type="button" onClick={() => onMove(-1)} aria-label="Previous" className="grid size-10 place-items-center rounded-full bg-black/50 text-white backdrop-blur transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"><ChevronLeft className="size-5" /></button>
                <button type="button" onClick={() => onMove(1)} aria-label="Next" className="grid size-10 place-items-center rounded-full bg-black/50 text-white backdrop-blur transition hover:bg-black/70 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold"><ChevronRight className="size-5" /></button>
              </span>
            )}
          </div>
          <div className="overflow-y-auto overscroll-contain p-6 sm:p-8">
            <p className={cn(eyebrow, goldText, "flex items-center gap-2")}>
              {section.kind === "DRINK" ? <Wine className="size-3.5" aria-hidden /> : <UtensilsCrossed className="size-3.5" aria-hidden />}
              {section.name}{entry.subcategory && entry.subcategory !== section.name ? ` · ${entry.subcategory}` : ""}
            </p>
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-x-6 gap-y-2">
              <h2 id="dish-title" className="font-display text-[2rem] leading-[1.05] sm:text-[2.4rem]">{entry.name}</h2>
              {!multi && <span className="text-xl font-semibold tabular-nums">TZS {n(entry.sizes[0].price)}</span>}
            </div>
            {entry.description && <p className="mt-3 text-[15px] leading-relaxed text-tone/70">{entry.description}</p>}

            {multi && (
              <ul className="mt-5 divide-y divide-tone/10 rounded-2xl border border-tone/10">
                {entry.sizes.map((x) => (
                  <li key={x.id} className={cn("flex items-center gap-3 px-4 py-3", !x.available && "opacity-55")}>
                    <span className="font-medium">{x.label}</span>
                    <span aria-hidden className="mb-1 min-w-6 flex-1 self-end border-b border-dotted border-tone/25" />
                    <span className="font-semibold tabular-nums">TZS {n(x.price)}</span>
                    <AddControl qty={order.qty(x.id)} name={`${entry.name} ${x.label}`} size="sm" disabled={!x.available} onChange={(q) => order.setQty(x.id, q)} />
                  </li>
                ))}
              </ul>
            )}
            {!available(entry) && <p className="mt-4 rounded-xl bg-paper-deep px-4 py-2.5 text-sm font-medium">Not available today — ask the restaurant what&apos;s fresh.</p>}

            <div className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              {!multi && available(entry) && (
                <div className="flex items-center gap-3">
                  <AddControl qty={order.qty(entry.sizes[0].id)} name={entry.name} onChange={(q) => order.setQty(entry.sizes[0].id, q)} />
                  {order.qty(entry.sizes[0].id) > 0 && <span className="text-sm text-tone/60">In your order · TZS {n(entry.sizes[0].price * order.qty(entry.sizes[0].id))}</span>}
                </div>
              )}
              {wa && <a href={wa} target="_blank" rel="noopener" className="text-xs font-medium text-tone/60 underline-offset-4 hover:text-tone hover:underline">Or ask on WhatsApp</a>}
            </div>
            {order.count > 0 && (
              <button type="button" onClick={onReview} className="mt-5 flex h-12 w-full items-center justify-between rounded-full bg-tone px-5 text-sm font-semibold text-paper transition hover:opacity-90">
                <span>View your order · {order.count} item{order.count === 1 ? "" : "s"}</span><span className="tabular-nums text-gold">TZS {n(order.subtotal)}</span>
              </button>
            )}
            <p className="mt-4 flex items-center gap-2 text-xs leading-relaxed text-tone/60">
              <BedDouble className="size-4 shrink-0 text-accent-ink" aria-hidden />
              Staying with us? Scan the QR card in your room — we bring it up and add it to your room bill (TZS {n(roomServiceFee)} delivery).
            </p>
          </div>
        </div>
      )}
    </dialog>
  );
}
