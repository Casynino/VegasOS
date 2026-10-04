"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight, ArrowUpRight, BedDouble, Check, ChefHat, ChevronLeft, ChevronRight, Clock, Flame, Globe, Loader2, Minus, Phone, Plus, Receipt, Search, ShoppingBag, Store, Trash2, UtensilsCrossed, Wine, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { identifyAtTableAction, startAtTableAction } from "@/app/t/[token]/actions";
import { identifyCustomerAction } from "@/app/order/actions";
import type { RestaurantEntry, RestaurantMenu, RestaurantOption } from "@/server/services/online-orders";
import type { GuestTable } from "@/server/services/dining-sessions";
import { Checkout, type CheckoutConfig } from "./checkout";
import { TableSessionCard } from "./table-session";
import { phoneLabel, useWho, useWhoForm, type Who } from "./who";

const n = (v: number) => v.toLocaleString("en-US");
const tzs = (v: number) => `TZS ${n(v)}`;
const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
const fromPrice = (e: RestaurantEntry) => Math.min(...e.options.map((o) => o.price));
const orderable = (e: RestaurantEntry) => e.options.some((o) => o.available);

/** Where the order goes — the only thing that changes between QR codes. */
export type AppPlace =
  | { kind: "table"; title: string; area: string | null }
  | { kind: "counter"; area: string | null }
  | { kind: "main" }
  | { kind: "public"; table: string | null }
  | { kind: "room"; room: string; guest: string; meeting: boolean; fee: number; stayHref: string; orders: { number: string; status: string; total: number; track: string | null }[] }
  | { kind: "more"; number: string; place: string; total: number; backHref: string };

export type AppStatus = { open: boolean; kitchenHours: string | null; barHours: string | null; prepMinutes: number | null };
export type CartLine = { option: RestaurantOption; entry: RestaurantEntry; qty: number; name: string };

const STATUS_WORD: Record<string, string> = {
  PENDING: "Received", ACCEPTED: "Preparing", PREPARING: "Preparing", READY: "Ready", OUT_FOR_DELIVERY: "On its way", DELIVERED: "Delivered", COMPLETED: "Delivered", COLLECTED: "Collected", CANCELLED: "Cancelled",
};

/** "Table 6 · Outside", "Room 305", "Restaurant order" — short, for chips and bars. */
function placeLine(place: AppPlace) {
  switch (place.kind) {
    case "table": return `${place.title}${place.area ? ` · ${place.area}` : ""}`;
    case "counter": return `Counter${place.area ? ` · ${place.area}` : ""}`;
    case "room": return `${place.meeting ? "Meeting room" : "Room"} ${place.room}`;
    case "more": return `Adding to #${place.number}`;
    case "public": return place.table ? place.table : "Restaurant order";
    default: return "Restaurant order";
  }
}
/** One short line on how it works for this place. */
function placeNote(place: AppPlace) {
  switch (place.kind) {
    case "table": return "Served at your table · pay when you are done";
    case "counter": return "Served at the counter · pay when you are done";
    case "room": return place.meeting ? "Served in your meeting room · on its bill" : `Delivered to your room · on your room bill${place.fee ? ` · delivery ${tzs(place.fee)}` : ""}`;
    case "more": return `${place.place} · same order, same bill`;
    default: return "Eat here or take out · pay when it is served";
  }
}
const PlaceIcon = ({ place, className }: { place: AppPlace; className?: string }) =>
  place.kind === "room" ? <BedDouble className={className} /> : place.kind === "counter" ? <Store className={className} /> : place.kind === "more" ? <Plus className={className} /> : <UtensilsCrossed className={className} />;

/**
 * VEGAS RESTAURANT — the ordering app every QR opens (a table, the counter, the main QR, a
 * room, the public menu): a slim restaurant banner with where your order goes, search, the
 * menu by category with photos and prices, a product card to open, the cart and checkout.
 * The menu, prices, photos and availability are live; orders go into the one restaurant system.
 */
export function RestaurantApp({ brand, status, menu, place, checkout, canOrder, top, bottom, table }: {
  brand: { name: string; hotel: string; tagline?: string }; status: AppStatus; menu: RestaurantMenu; place: AppPlace; checkout: CheckoutConfig; canOrder: boolean;
  /** Instead of the restaurant banner (e.g. a guest's stay: room, dates, bill), and more after the menu. */
  top?: React.ReactNode; bottom?: React.ReactNode;
  /** At a table: whose table it is — this phone's own (their session), someone else's, reserved or free. */
  table?: GuestTable | null;
}) {
  const byOption = useMemo(() => {
    const m = new Map<string, { option: RestaurantOption; entry: RestaurantEntry }>();
    for (const s of menu.sections) for (const e of s.entries) for (const o of e.options) m.set(o.id, { option: o, entry: e });
    return m;
  }, [menu]);
  const byKey = useMemo(() => new Map(menu.sections.flatMap((s) => s.entries.map((e) => [e.key, { e, s }] as const))), [menu]);

  // The cart: menu item id → how many.
  const [cart, setCart] = useState<Record<string, number>>({});
  const setQty = useCallback((id: string, qty: number) => setCart((c) => {
    const next = { ...c };
    if (qty <= 0) delete next[id]; else next[id] = Math.min(20, qty);
    return next;
  }), []);
  const lines: CartLine[] = Object.entries(cart).flatMap(([id, qty]) => {
    const x = byOption.get(id);
    return x ? [{ ...x, qty, name: x.option.label ? `${x.entry.name} ${x.option.label}` : x.entry.name }] : [];
  });
  const count = lines.reduce((t, l) => t + l.qty, 0);
  const subtotal = lines.reduce((t, l) => t + l.qty * l.option.price, 0);
  const fee = place.kind === "room" && !place.meeting ? place.fee : 0;
  const entryQty = (e: RestaurantEntry) => e.options.reduce((t, o) => t + (cart[o.id] ?? 0), 0);

  // Who is ordering: at a table, the counter, the main QR and the public menu, the customer gives
  // their number (and name) before the first item goes in — a room already knows its guest.
  const needsWho = checkout.kind === "spot" || checkout.kind === "public";
  const [who, setWho] = useWho();
  const [asking, setAsking] = useState<{ then: (() => void) | null; item: { name: string; image: string | null } | null } | null>(null);
  const lookup = useCallback(async (phone: string) => {
    const res = checkout.kind === "spot" ? await identifyAtTableAction({ token: checkout.token, phone }) : await identifyCustomerAction({ phone });
    return res.ok ? res.data.name : null;
  }, [checkout]);
  // At a table: the customer says who they are once — the table is theirs until they pay (their session).
  const router = useRouter();
  const tableMode = checkout.kind === "spot" && checkout.spot === "TABLE";
  // Seated a moment ago — until the page's fresh table state arrives (then that is the truth).
  const [justSeated, setJustSeated] = useState<{ name: string; before: GuestTable | null | undefined } | null>(null);
  const bridging = !!justSeated && justSeated.before === table;
  const seated = tableMode && (table?.state === "mine" || bridging);
  const seatedName = table?.mine?.name ?? (bridging ? justSeated!.name : null);
  const startTable = async (w: Who): Promise<string | null> => {
    if (checkout.kind !== "spot") return null;
    const res = await startAtTableAction({ token: checkout.token, name: w.known ? "" : w.name, phone: w.phone });
    if (!res.ok) return res.error;
    if (res.data.state === "in_use") return `${placeLine(place)} is being used by another customer. If you are with them, please ask your waiter to add you to this table.`;
    if (res.data.state === "reserved") return `${placeLine(place)} is reserved for another customer. Please ask a waiter to seat you.`;
    setWho(w);
    setJustSeated({ name: (w.known && res.data.name ? res.data.name : w.name).split(/\s+/)[0], before: table });
    router.refresh();
    return null;
  };

  // "Added" feedback.
  const [added, setAdded] = useState<{ name: string; n: number } | null>(null);
  useEffect(() => { if (!added) return; const t = setTimeout(() => setAdded(null), 1500); return () => clearTimeout(t); }, [added]);
  const add = (e: RestaurantEntry, o: RestaurantOption, qty = (cart[o.id] ?? 0) + 1) => {
    const name = o.label ? `${e.name} ${o.label}` : e.name;
    const go = () => {
      setQty(o.id, qty);
      if (qty > (cart[o.id] ?? 0)) setAdded((x) => ({ name, n: (x?.n ?? 0) + 1 }));
    };
    const ask = tableMode ? !seated : needsWho && !who;
    if (ask && qty > (cart[o.id] ?? 0)) setAsking({ then: go, item: { name, image: e.image } });
    else go();
  };

  // Opening a product, the checkout.
  const [openKey, setOpenKey] = useState<string | null>(null);
  const [checkingOut, setCheckingOut] = useState(false);
  const opened = openKey ? byKey.get(openKey) ?? null : null;

  // Search and the category that is in view.
  const [q, setQ] = useState("");
  const needle = norm(q.trim());
  const shown = useMemo(() => {
    if (!needle) return menu.sections;
    return menu.sections
      .map((s) => ({ ...s, entries: s.entries.filter((e) => norm(`${e.name} ${e.description ?? ""} ${s.name}`).includes(needle)) }))
      .filter((s) => s.entries.length);
  }, [menu.sections, needle]);
  const [active, setActive] = useState<string>("all");
  const chips = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (needle) return;
    const els = menu.sections.map((s) => document.getElementById(`c-${s.slug}`)).filter((x): x is HTMLElement => !!x);
    const io = new IntersectionObserver((list) => {
      const hit = list.filter((x) => x.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (hit) setActive(hit.target.id.slice(2));
      else if (els[0] && els[0].getBoundingClientRect().top > window.innerHeight * 0.3) setActive("all"); // back above the menu
    }, { rootMargin: "-30% 0px -60% 0px" });
    els.forEach((el) => io.observe(el));
    return () => io.disconnect();
  }, [menu.sections, needle]);
  useEffect(() => {
    const box = chips.current, chip = box?.querySelector<HTMLElement>(`[data-chip="${active}"]`);
    if (!box || !chip) return;
    const b = box.getBoundingClientRect(), c = chip.getBoundingClientRect();
    box.scrollTo({ left: Math.max(0, box.scrollLeft + (c.left - b.left) - b.width / 2 + c.width / 2), behavior: "smooth" });
  }, [active]);
  const goTo = (slug: string) => {
    setQ("");
    const el = document.getElementById(slug === "all" ? "menu-list" : `c-${slug}`);
    if (el) window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - (slug === "all" ? 8 : 64), behavior: "smooth" });
    setActive(slug);
  };

  // "Something to drink?" beside a dish, "Goes well with" beside a drink — with photos, the kitchen's picks first.
  const pairs = useMemo(() => {
    const pool = (drink: boolean) => {
      const all = menu.sections.filter((s) => s.drink === drink).flatMap((s) => s.entries.filter((e) => e.image && orderable(e)));
      return [...all.filter((e) => e.badge), ...all.filter((e) => !e.badge)].slice(0, 8);
    };
    return { food: pool(false), drink: pool(true) };
  }, [menu]);

  const recommended = menu.recommended.map((k) => byKey.get(k)?.e).filter((e): e is RestaurantEntry => !!e);
  const orderingOn = canOrder;

  return (
    <main className="vr relative min-h-svh overflow-x-clip bg-(--vr-bg) pb-[calc(5.5rem+env(safe-area-inset-bottom))] text-(--vr-ink) lg:pb-16">
      {/* ── The restaurant ── */}
      <header className="mx-auto flex max-w-[1560px] items-center justify-between gap-3 px-4 pt-3.5 sm:px-6 sm:pt-5 lg:px-8 xl:px-10">
        <Link href="/" className="flex min-w-0 items-center gap-2.5">
          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-(--vr-dark) ring-[1.5px] ring-(--vr-gold)/60">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-192.png" alt="" className="size-7 rounded-full" />
          </span>
          <span className="min-w-0 leading-none">
            <span className="block truncate font-display text-[17px] font-semibold tracking-wide">{brand.name}</span>
            <span className="mt-0.5 block truncate text-[10px] uppercase tracking-[0.2em] text-(--vr-muted)">{brand.tagline ?? "Restaurant & bar"}</span>
          </span>
        </Link>
        <div className="flex shrink-0 items-center gap-2">
          {/* The hotel's main website — in a new tab, so an order in progress is not lost */}
          <a href="/" target="_blank" rel="noopener" aria-label={`${brand.hotel} website (opens in a new tab)`}
            className="inline-flex h-10 items-center gap-1.5 rounded-full bg-(--vr-card) px-3 text-[13px] font-medium ring-1 ring-(--vr-line) transition hover:ring-(--vr-gold) sm:px-3.5">
            <Globe className="size-4 text-(--vr-gold-ink)" />
            <span className="hidden sm:inline">Hotel website</span>
            <ArrowUpRight className="hidden size-3.5 text-(--vr-muted) sm:block" />
          </a>
          {orderingOn && (
            <button type="button" onClick={() => count && setCheckingOut(true)} aria-label={`Your order, ${count} items`}
              className="relative grid size-10 shrink-0 place-items-center rounded-full bg-(--vr-card) ring-1 ring-(--vr-line) transition hover:ring-(--vr-gold) lg:hidden">
              <ShoppingBag className="size-[18px]" />
              {count > 0 && <span key={count} className="absolute -right-0.5 -top-0.5 grid size-[18px] place-items-center rounded-full bg-(--vr-dark) text-[10px] font-bold text-white motion-safe:animate-[vlh-pop_0.3s_ease-out]">{count}</span>}
            </button>
          )}
        </div>
      </header>

      <div className="mx-auto max-w-[1560px] px-4 sm:px-6 lg:px-8 xl:px-10">
        {top ?? <Banner status={status} place={place} dishes={recommended.filter((e) => e.image).slice(0, 3)} />}
        {!top && place.kind === "room" && <RoomBar place={place} />}
        {tableMode && table && <TableSessionCard table={table} placeLabel={placeLine(place)} />}
        {tableMode && bridging && table?.state !== "mine" && <p className="mt-2.5 rounded-2xl bg-(--vr-card) px-3.5 py-3 text-[13px] ring-1 ring-(--vr-line)">Welcome, <strong>{justSeated!.name}</strong> — {placeLine(place)} is yours. Order as often as you like.</p>}
        {needsWho && !tableMode && who && <div className="lg:hidden"><WhoBar who={who} onChange={() => setAsking({ then: null, item: null })} /></div>}
        {place.kind === "more" && (
          <Link href={place.backHref} className="mt-2.5 flex items-center justify-between rounded-xl bg-(--vr-card) px-3.5 py-2.5 text-[13px] ring-1 ring-(--vr-line)">
            <span className="text-(--vr-muted)">Order #{place.number} so far · <strong className="font-semibold text-(--vr-ink)">{tzs(place.total)}</strong></span>
            <span className="font-medium text-(--vr-gold-ink)">Follow it →</span>
          </Link>
        )}

        <div className="mt-4 lg:mt-6 lg:grid lg:grid-cols-[minmax(0,1fr)_320px] lg:items-start lg:gap-8 xl:grid-cols-[minmax(0,1fr)_360px] 2xl:grid-cols-[210px_minmax(0,1fr)_360px] 2xl:gap-10">
          {/* Big screens: the categories down the side */}
          <CategoryRail sections={menu.sections} active={active} onGo={goTo} />

          {/* Not "menu": links from older messages end in #menu and should open at the top of the page. */}
          <div id="menu-list" className="min-w-0 scroll-mt-4">
            {/* Search */}
            <label className="relative block">
              <span className="sr-only">Search the menu</span>
              <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-(--vr-muted)" />
              <input value={q} onChange={(e) => setQ(e.target.value)} type="search" placeholder="Search the menu"
                className="h-11 w-full rounded-full border border-(--vr-line) bg-(--vr-card) pl-10 pr-10 text-[16px] outline-none sm:text-[14px] transition placeholder:text-(--vr-muted)/80 focus:border-(--vr-gold) focus:ring-4 focus:ring-(--vr-gold)/15" />
              {q && <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="absolute right-2 top-1/2 grid size-8 -translate-y-1/2 place-items-center rounded-full text-(--vr-muted) hover:bg-(--vr-bg)"><X className="size-4" /></button>}
            </label>

            {/* Categories — they follow the page */}
            {!needle && (
              <nav aria-label="Menu categories" className="sticky top-0 z-20 -mx-4 mt-2 bg-(--vr-bg)/95 px-4 py-2 backdrop-blur-md sm:-mx-6 sm:px-6 lg:mx-0 lg:px-0 2xl:hidden">
                <div ref={chips} className="flex gap-1.5 overflow-x-auto [scrollbar-width:none]">
                  {[{ slug: "all", name: "All", drink: false }, ...menu.sections].map((s) => {
                    const on = active === s.slug;
                    return (
                      <button key={s.slug} type="button" data-chip={s.slug} onClick={() => goTo(s.slug)} aria-current={on || undefined}
                        className={cn("inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full px-3.5 text-[13px] font-medium transition",
                          on ? "bg-(--vr-dark) text-white" : "bg-(--vr-card) text-(--vr-ink)/75 ring-1 ring-(--vr-line) hover:text-(--vr-ink) hover:ring-(--vr-gold)")}>
                        {s.name}
                      </button>
                    );
                  })}
                </div>
              </nav>
            )}

            {/* Recommended */}
            {!needle && recommended.length > 0 && (
              <Rail title="Recommended" note={menu.recommendedBy === "featured" ? "Picked by our kitchen" : menu.recommendedBy === "popular" ? "Most ordered" : "A taste of the menu"}>
                {recommended.map((e) => (
                  <FeaturedCard key={e.key} e={e} qty={entryQty(e)} orderingOn={orderingOn} onOpen={() => setOpenKey(e.key)}
                    onAdd={() => (e.options.length === 1 ? add(e, e.options[0]) : setOpenKey(e.key))} />
                ))}
              </Rail>
            )}

            {/* The menu */}
            {shown.length === 0 && (
              <div className="mt-6 rounded-2xl bg-(--vr-card) px-6 py-10 text-center ring-1 ring-(--vr-line)">
                <p className="font-display text-xl">Nothing matches “{q}”</p>
                <div className="mt-3 flex flex-wrap justify-center gap-1.5">
                  {["chicken", "fish", "beer", "juice", "whisky"].map((w) => (
                    <button key={w} type="button" onClick={() => setQ(w)} className="rounded-full bg-(--vr-bg) px-3 py-1 text-[13px] ring-1 ring-(--vr-line) hover:ring-(--vr-gold)">{w}</button>
                  ))}
                </div>
              </div>
            )}
            {shown.map((s) => (
              <section key={s.id} id={`c-${s.slug}`} aria-labelledby={`h-${s.slug}`} className="mt-7 scroll-mt-16 lg:mt-9 2xl:scroll-mt-6">
                <div className="mb-2.5 flex items-baseline justify-between gap-3 lg:mb-3.5">
                  <h2 id={`h-${s.slug}`} className="font-display text-[22px] font-semibold leading-none">{s.name}</h2>
                  <span className="text-[11px] text-(--vr-muted)">{s.entries.length} item{s.entries.length === 1 ? "" : "s"}</span>
                </div>
                <ul className="grid gap-2.5 sm:grid-cols-2 lg:gap-3">
                  {s.entries.map((e) => (
                    <ProductCard key={e.key} e={e} drink={s.drink} qty={entryQty(e)} orderingOn={orderingOn} onOpen={() => setOpenKey(e.key)}
                      onAdd={() => (e.options.length === 1 ? add(e, e.options[0]) : setOpenKey(e.key))}
                      onQty={e.options.length === 1 ? (v) => setQty(e.options[0].id, v) : null} />
                  ))}
                </ul>
              </section>
            ))}
          </div>

          {/* Computers: the order, always in view */}
          {orderingOn && (
            <aside className="hidden lg:sticky lg:top-6 lg:block">
              <CartPanel place={place} lines={lines} subtotal={subtotal} fee={fee} setQty={setQty} onCheckout={() => setCheckingOut(true)}
                who={tableMode ? (seated ? { name: seatedName ?? who?.name ?? "You", phone: who?.phone ?? "" } : null) : needsWho ? who : null} needsWho={needsWho}
                onWho={tableMode && seated ? null : () => setAsking({ then: null, item: null })} />
            </aside>
          )}
        </div>
        {bottom}
      </div>

      {/* Phones: the order at the bottom */}
      <AnimatePresence>
        {orderingOn && count > 0 && !checkingOut && (
          <motion.div initial={{ y: 90 }} animate={{ y: 0 }} exit={{ y: 90 }} transition={{ type: "spring", stiffness: 380, damping: 34 }}
            className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[calc(0.75rem+env(safe-area-inset-bottom))] lg:hidden">
            <button type="button" onClick={() => setCheckingOut(true)}
              className="mx-auto flex h-14 w-full max-w-md items-center gap-3 rounded-full bg-(--vr-dark) pl-2 pr-5 text-white shadow-[0_16px_40px_-14px_rgba(29,23,18,0.85)]">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--vr-gold) text-[13px] font-bold text-(--vr-ink)">{count}</span>
              <span className="min-w-0 flex-1 text-left text-[14px] font-semibold">View order</span>
              <span className="text-[14px] font-semibold tabular-nums">{tzs(subtotal + fee)}</span>
              <ArrowRight className="size-4 text-(--vr-gold)" />
            </button>
          </motion.div>
        )}
      </AnimatePresence>

      {/* "Added" */}
      <AnimatePresence>
        {added && (
          <motion.div key={added.n} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: 6 }}
            className="pointer-events-none fixed inset-x-0 bottom-[calc(4.75rem+env(safe-area-inset-bottom))] z-[60] flex justify-center px-4 lg:bottom-6">
            <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-(--vr-card) px-3.5 py-2 text-[13px] font-medium shadow-[0_12px_30px_-12px_rgba(29,23,18,0.55)] ring-1 ring-(--vr-line)">
              <span className="grid size-4 shrink-0 place-items-center rounded-full bg-emerald-600 text-white"><Check className="size-2.5" strokeWidth={3.5} /></span>
              <span className="truncate">{added.name} added</span>
            </span>
          </motion.div>
        )}
      </AnimatePresence>

      <ProductSheet opened={opened?.e ?? null} section={opened?.s.name ?? ""} drink={!!opened?.s.drink} cart={cart} orderingOn={orderingOn}
        onClose={() => setOpenKey(null)} onSet={(o, qty) => { if (opened) add(opened.e, o, qty); }}
        pairs={opened ? (opened.s.drink ? pairs.food : pairs.drink).filter((p) => p.key !== opened.e.key).slice(0, 6) : []}
        pairQty={entryQty} onPick={setOpenKey} onAddPair={(p) => (p.options.length === 1 ? add(p, p.options[0]) : setOpenKey(p.key))} />

      <CheckoutSheet open={checkingOut} onClose={() => setCheckingOut(false)} place={place} lines={lines} subtotal={subtotal} fee={fee} setQty={setQty}>
        <Checkout config={checkout} lines={lines} total={subtotal + fee} who={who} onWho={() => setAsking({ then: null, item: null })} onDone={() => setCart({})}
          seated={tableMode ? (seated ? { name: seatedName ?? who?.name ?? "You", table: table?.mine?.table ?? placeLine(place) } : null) : undefined} />
      </CheckoutSheet>

      <WhoSheet open={!!asking} item={asking?.item ?? null} place={place} who={who} lookup={lookup} onClose={() => setAsking(null)} table={tableMode}
        onDone={async (w) => {
          if (tableMode) { const blocked = await startTable(w); if (blocked) return blocked; } else setWho(w);
          const then = asking?.then; setAsking(null); then?.();
          return null;
        }} />
    </main>
  );
}

/**
 * The welcome, readable at a glance: a solid dark card (no text over a busy photo) with a dish
 * from the menu on a round plate, whether we are open, and where your order goes.
 */
function Banner({ status, place, dishes }: { status: AppStatus; place: AppPlace; dishes: RestaurantEntry[] }) {
  const hours = [status.kitchenHours && `Kitchen ${status.kitchenHours}`, status.barHours && `Bar ${status.barHours}`].filter(Boolean).join(" · ");
  const [first] = dishes;
  return (
    <section className="relative mt-3 overflow-hidden rounded-3xl bg-(--vr-dark) text-white sm:mt-4">
      <div aria-hidden className="absolute -left-10 -top-16 size-52 rounded-full bg-(--vr-gold)/10 blur-3xl" />
      <div aria-hidden className="absolute -bottom-24 right-1/4 hidden size-72 rounded-full bg-(--vr-gold)/[0.07] blur-3xl lg:block" />
      {first?.image && (
        <div aria-hidden className={cn("absolute -right-8 top-1/2 size-[150px] -translate-y-1/2 overflow-hidden rounded-full shadow-[0_18px_40px_-12px_rgba(0,0,0,0.8)] ring-4 ring-white/10 sm:right-8 sm:size-[190px]", dishes.length >= 3 && "lg:hidden")}>
          <Image src={first.image} alt="" fill preload sizes="190px" className="object-cover" />
        </div>
      )}
      {/* Computers: three dishes from the menu, side by side */}
      {dishes.length >= 3 && (
        <div aria-hidden className="absolute right-10 top-1/2 hidden -translate-y-1/2 items-center lg:flex xl:right-14">
          {dishes.map((d, i) => (
            <div key={d.key} className={cn("relative shrink-0 overflow-hidden rounded-full shadow-[0_18px_40px_-12px_rgba(0,0,0,0.85)] ring-4 ring-(--vr-dark)",
              i === 1 ? "z-10 -mx-7 size-[200px] xl:size-[220px]" : "size-[150px] opacity-90 xl:size-[165px]")}>
              <Image src={d.image!} alt="" fill preload={i === 1} sizes="220px" className="object-cover" />
            </div>
          ))}
        </div>
      )}
      <div className="relative max-w-[64%] p-4 sm:max-w-[60%] sm:p-6 lg:max-w-[46%] lg:px-8 lg:py-7">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-medium text-white/90">
          <span className={cn("size-1.5 rounded-full", status.open ? "bg-emerald-400" : "bg-white/40")} />
          {status.open ? "Open now" : "Closed for orders"}
          {status.prepMinutes ? <span className="inline-flex items-center gap-1 text-white/60"><Clock className="size-3" />~{status.prepMinutes} min</span> : null}
        </span>
        <p className="mt-2.5 font-display text-[23px] leading-[1.08] sm:text-[30px]">Good food.<br />Good drinks.<br /><span className="text-(--vr-gold)">Good moments.</span></p>
        {hours && <p className="mt-1.5 text-[11px] text-white/55">{hours}</p>}
        <p className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full bg-(--vr-gold) py-1 pl-1 pr-3 text-(--vr-ink)">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-(--vr-dark) text-(--vr-gold)"><PlaceIcon place={place} className="size-3.5" /></span>
          <span className="truncate text-[12.5px] font-semibold">{placeLine(place)}</span>
        </p>
        <p className="mt-1.5 text-[11px] leading-snug text-white/60">{placeNote(place)}</p>
      </div>
    </section>
  );
}

/** A room: the guest, their stay & bill, and today's orders. */
function RoomBar({ place }: { place: Extract<AppPlace, { kind: "room" }> }) {
  return (
    <div className="mt-2.5 flex items-center gap-2 overflow-x-auto [scrollbar-width:none]">
      <Link href={place.stayHref} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-(--vr-card) px-3 text-[12px] font-medium ring-1 ring-(--vr-line) hover:ring-(--vr-gold)">
        <Receipt className="size-3.5 text-(--vr-gold-ink)" />Your stay & bill
      </Link>
      {place.orders.slice(0, 6).map((o) => {
        const inner = (
          <>
            <span className="font-semibold">#{o.number.replace(/^ORD-\d{4}-0*/, "")}</span>
            <span className={cn(o.status === "CANCELLED" ? "text-rose-700" : ["DELIVERED", "COMPLETED", "COLLECTED"].includes(o.status) ? "text-emerald-700" : "text-(--vr-gold-ink)")}>{STATUS_WORD[o.status] ?? o.status}</span>
          </>
        );
        return o.track
          ? <Link key={o.number} href={`/order/${o.track}`} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-(--vr-card) px-3 text-[12px] ring-1 ring-(--vr-line) hover:ring-(--vr-gold)">{inner}</Link>
          : <span key={o.number} className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-full bg-(--vr-card) px-3 text-[12px] ring-1 ring-(--vr-line)">{inner}</span>;
      })}
    </div>
  );
}

/** Big screens: the menu's categories down the side, food then drinks, the one in view marked. */
function CategoryRail({ sections, active, onGo }: { sections: RestaurantMenu["sections"]; active: string; onGo: (slug: string) => void }) {
  const groups = [{ name: "Food", list: sections.filter((s) => !s.drink) }, { name: "Drinks", list: sections.filter((s) => s.drink) }].filter((g) => g.list.length);
  const item = (slug: string, name: React.ReactNode, count?: number) => {
    const on = active === slug;
    return (
      <button key={slug} type="button" onClick={() => onGo(slug)} aria-current={on || undefined}
        className={cn("flex w-full items-center justify-between gap-2 rounded-xl px-3 py-2 text-left text-[13.5px] transition",
          on ? "bg-(--vr-dark) font-semibold text-white" : "text-(--vr-ink)/80 hover:bg-(--vr-bg) hover:text-(--vr-ink)")}>
        <span className="truncate">{name}</span>
        {count !== undefined && <span className={cn("text-[11.5px] tabular-nums", on ? "text-(--vr-gold)" : "text-(--vr-muted)")}>{count}</span>}
      </button>
    );
  };
  return (
    <nav aria-label="Menu categories" className="hidden 2xl:sticky 2xl:top-6 2xl:block">
      <div className="rounded-2xl bg-(--vr-card) p-2 ring-1 ring-(--vr-line)">
        {item("all", <span className="inline-flex items-center gap-1.5">All the menu</span>)}
        {groups.map((g) => (
          <div key={g.name}>
            <p className="px-3 pb-1 pt-3.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-(--vr-muted)">{g.name}</p>
            {g.list.map((s) => item(s.slug, s.name, s.entries.length))}
          </div>
        ))}
      </div>
    </nav>
  );
}

/** A row that slides sideways: swipe on phones, arrows on computers. */
function Rail({ title, note, children }: { title: string; note: string; children: React.ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [edge, setEdge] = useState({ start: true, end: true });
  const measure = useCallback(() => {
    const el = ref.current;
    if (el) setEdge({ start: el.scrollLeft < 4, end: el.scrollLeft + el.clientWidth >= el.scrollWidth - 4 });
  }, []);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver(measure); // also measures once at the start
    ro.observe(el);
    return () => ro.disconnect();
  }, [measure]);
  const go = (d: 1 | -1) => { const el = ref.current; if (el) el.scrollBy({ left: d * Math.max(200, el.clientWidth * 0.8), behavior: "smooth" }); };
  const arrow = "grid size-8 place-items-center rounded-full bg-(--vr-card) ring-1 ring-(--vr-line) transition hover:ring-(--vr-gold) disabled:opacity-35 disabled:hover:ring-(--vr-line)";
  return (
    <section aria-label={title} className="mt-4 lg:mt-5">
      <div className="mb-2.5 flex items-center justify-between gap-3 lg:mb-3.5">
        <h2 className="font-display text-[22px] font-semibold leading-none">{title}</h2>
        <div className="flex items-center gap-3">
          <span className="text-[11px] text-(--vr-muted)">{note}</span>
          {!(edge.start && edge.end) && (
            <span className="hidden gap-1.5 lg:flex">
              <button type="button" onClick={() => go(-1)} disabled={edge.start} aria-label="Back" className={arrow}><ChevronLeft className="size-4" /></button>
              <button type="button" onClick={() => go(1)} disabled={edge.end} aria-label="More" className={arrow}><ChevronRight className="size-4" /></button>
            </span>
          )}
        </div>
      </div>
      <div ref={ref} onScroll={measure}
        className="-mx-4 flex snap-x snap-mandatory scroll-px-4 gap-3 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:-mx-6 sm:scroll-px-6 sm:px-6 lg:mx-0 lg:scroll-px-0 lg:gap-4 lg:px-0">
        {children}
      </div>
    </section>
  );
}

/** Who is ordering — after they said so; "Change" asks again. */
function WhoBar({ who, onChange }: { who: Who; onChange: () => void }) {
  return (
    <div className="mt-2.5 flex items-center gap-2.5 rounded-full bg-(--vr-card) py-1.5 pl-1.5 pr-1.5 ring-1 ring-(--vr-line)">
      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-(--vr-dark) font-display text-[15px] font-semibold text-(--vr-gold)">{who.name.charAt(0).toUpperCase()}</span>
      <span className="min-w-0 flex-1 truncate text-[13px]"><span className="font-semibold">{who.name}</span><span className="text-(--vr-muted)"> · {phoneLabel(who.phone)}</span></span>
      <button type="button" onClick={onChange} className="h-8 shrink-0 rounded-full px-3 text-[12px] font-medium text-(--vr-gold-ink) hover:bg-(--vr-bg)">Change</button>
    </div>
  );
}

/**
 * Before the first item goes in: who is ordering. The phone first — someone we know is
 * greeted by name and just continues; someone new adds their name. Then the item goes in.
 */
function WhoSheet({ open, item, place, who, lookup, onClose, onDone, table }: {
  open: boolean; item: { name: string; image: string | null } | null; place: AppPlace; who: Who | null;
  lookup: (phone: string) => Promise<string | null>; onClose: () => void;
  /** Resolves with a message when they cannot go on (e.g. someone else's table). */
  onDone: (w: Who) => Promise<string | null>;
  /** At a table: starting their table (their session). */
  table?: boolean;
}) {
  return (
    <Sheet open={open} onClose={onClose} label={table ? "Let's get your order started" : "Who is ordering?"}>
      <WhoForm item={item} place={place} initial={who} lookup={lookup} onClose={onClose} onDone={onDone} table={table} />
    </Sheet>
  );
}

function WhoForm({ item, place, initial, lookup, onClose, onDone, table }: {
  item: { name: string; image: string | null } | null; place: AppPlace; initial: Who | null;
  lookup: (phone: string) => Promise<string | null>; onClose: () => void; onDone: (w: Who) => Promise<string | null>; table?: boolean;
}) {
  const f = useWhoForm(initial, lookup);
  const [busy, setBusy] = useState(false);
  const [blocked, setBlocked] = useState<string | null>(null);
  const input = "block h-12 w-full rounded-2xl border border-(--vr-line) bg-white text-[16px] outline-none transition placeholder:text-(--vr-muted)/60 focus:border-(--vr-gold) focus:ring-4 focus:ring-(--vr-gold)/15";
  const submit = async () => {
    if (!f.result || busy) return;
    setBusy(true); setBlocked(null);
    try { setBlocked(await onDone(f.result)); } catch { setBlocked("Something went wrong — please try again."); } finally { setBusy(false); }
  };
  return (
    <form className="flex min-h-0 flex-1 flex-col" onSubmit={(ev) => { ev.preventDefault(); void submit(); }}>
      <div className="flex justify-start px-4 pt-[max(0.9rem,env(safe-area-inset-top))] sm:justify-end sm:pt-4">
        <button type="button" onClick={onClose} aria-label="Back to the menu" className="grid size-10 place-items-center rounded-full bg-(--vr-bg) hover:bg-(--vr-line) sm:size-8">
          <ChevronLeft className="size-5 sm:hidden" /><X className="hidden size-4 sm:block" />
        </button>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] pt-2 sm:px-7 sm:pb-7">
        <span className="grid size-12 place-items-center rounded-full bg-(--vr-dark) ring-[1.5px] ring-(--vr-gold)/60">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-192.png" alt="" className="size-9 rounded-full" />
        </span>
        <h2 className="mt-4 font-display text-[28px] font-semibold leading-[1.05]">{table ? "Let’s get your order started" : "Who is ordering?"}</h2>
        <p className="mt-1.5 text-[13.5px] leading-snug text-(--vr-muted)">{table
          ? "Your name and number, once — then order as often as you like. Everything goes on one bill for your table."
          : "Your number and name — so we know whose order it is, and can tell you when it is ready."}</p>
        <p className="mt-3 inline-flex max-w-full items-center gap-2 rounded-full bg-(--vr-gold-soft) py-1 pl-1 pr-3 text-(--vr-gold-ink)">
          <span className="grid size-6 shrink-0 place-items-center rounded-full bg-(--vr-dark) text-(--vr-gold)"><PlaceIcon place={place} className="size-3.5" /></span>
          <span className="truncate text-[12.5px] font-semibold">{placeLine(place)}</span>
        </p>

        <label className="mt-6 block">
          <span className="text-[12.5px] font-medium text-(--vr-ink)/80">Phone number (WhatsApp)</span>
          <span className="relative mt-1 block">
            <Phone className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-(--vr-muted)" />
            <input value={f.phone} onChange={(ev) => f.setPhone(ev.target.value)} type="tel" inputMode="tel" autoComplete="tel" placeholder="0712 345 678" autoFocus
              className={cn(input, "pl-11 pr-11 tabular-nums")} />
            <span className="absolute right-4 top-1/2 -translate-y-1/2">
              {f.step === "checking" ? <Loader2 className="size-4 animate-spin text-(--vr-muted)" />
                : f.step === "known" || f.step === "new" ? <span className="grid size-5 place-items-center rounded-full bg-emerald-600 text-white"><Check className="size-3" strokeWidth={3} /></span> : null}
            </span>
          </span>
        </label>

        <AnimatePresence mode="wait" initial={false}>
          {f.step === "known" && (
            <motion.div key="known" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}
              className="mt-3 flex items-center gap-3 rounded-2xl bg-(--vr-gold-soft) p-3">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--vr-dark) font-display text-[17px] font-semibold text-(--vr-gold)">{f.knownName!.charAt(0).toUpperCase()}</span>
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block text-[12px] text-(--vr-gold-ink)">Welcome back</span>
                <span className="block truncate text-[15px] font-semibold">{f.knownName}</span>
              </span>
              <button type="button" onClick={f.notMe} className="shrink-0 text-[12px] font-medium text-(--vr-gold-ink) underline underline-offset-2">Not you?</button>
            </motion.div>
          )}
          {f.step === "new" && (
            <motion.label key="new" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }} className="mt-4 block">
              <span className="text-[12.5px] font-medium text-(--vr-ink)/80">Your name</span>
              <input value={f.name} onChange={(ev) => f.setName(ev.target.value)} autoComplete="name" autoCapitalize="words" placeholder="e.g. Asha" autoFocus maxLength={80}
                className={cn(input, "mt-1 px-4")} />
            </motion.label>
          )}
        </AnimatePresence>

        {item && (
          <p className="mt-5 flex items-center gap-2.5 text-[12.5px] text-(--vr-muted)">
            <span className="relative size-9 shrink-0 overflow-hidden rounded-lg bg-(--vr-line)">
              {item.image && <Image src={item.image} alt="" fill sizes="36px" className="object-cover" />}
            </span>
            <span className="min-w-0">Then <strong className="font-semibold text-(--vr-ink)">{item.name}</strong> goes in your order.</span>
          </p>
        )}
        {blocked && <p role="alert" className="mt-4 rounded-2xl bg-amber-50 px-3.5 py-3 text-[13px] leading-snug text-amber-900 ring-1 ring-amber-200">{blocked}</p>}
        <button type="submit" disabled={!f.result || busy}
          className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-full bg-(--vr-dark) text-[14.5px] font-semibold text-white transition hover:bg-black disabled:opacity-40">
          {f.step === "checking" || busy ? <><Loader2 className="size-4 animate-spin" />{busy ? "One moment…" : "Checking…"}</> : <>Continue<ArrowRight className="size-4 text-(--vr-gold)" /></>}
        </button>
        <p className="mt-2.5 text-center text-[11.5px] text-(--vr-muted)">{table ? "Asked once at this table · used only for your orders and bill" : "Asked once on this phone · used only for your orders and bill"}</p>
      </div>
    </form>
  );
}

function Badge({ badge, small }: { badge: RestaurantEntry["badge"]; small?: boolean }) {
  if (!badge) return null;
  const size = small ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]";
  return badge === "featured"
    ? <span className={cn("inline-flex items-center gap-1 rounded-full bg-(--vr-dark) font-semibold uppercase tracking-wider text-(--vr-gold)", size)}><ChefHat className="size-2.5" />Chef&apos;s pick</span>
    : <span className={cn("inline-flex items-center gap-1 rounded-full bg-(--vr-gold-soft) font-semibold uppercase tracking-wider text-(--vr-gold-ink)", size)}><Flame className="size-2.5" />Popular</span>;
}

/** No photo yet: a calm placeholder (the photo can be added in Menu & prices). */
function Photo({ e, drink, sizes, className }: { e: RestaurantEntry; drink: boolean; sizes: string; className?: string }) {
  if (!e.image) {
    return (
      <span className={cn("absolute inset-0 grid place-items-center bg-[linear-gradient(135deg,#f0e7d8,#e4d6bd)] text-(--vr-gold-ink)/55", className)}>
        {drink ? <Wine className="size-6" strokeWidth={1.4} /> : <UtensilsCrossed className="size-6" strokeWidth={1.4} />}
      </span>
    );
  }
  return <Image src={e.image} alt={e.name} fill sizes={sizes} className={cn("object-cover", className)} />;
}

/** "+" — then "− 2 +" once it is in the order. */
function AddButton({ qty, name, onAdd, onQty, many }: { qty: number; name: string; onAdd: () => void; onQty: ((v: number) => void) | null; many: boolean }) {
  if (qty > 0 && onQty) {
    return (
      <span className="inline-flex h-8 shrink-0 items-center rounded-full bg-(--vr-dark) text-white">
        <button type="button" onClick={() => onQty(qty - 1)} aria-label={`One less ${name}`} className="grid size-8 place-items-center rounded-full hover:bg-white/10">{qty === 1 ? <Trash2 className="size-3" /> : <Minus className="size-3.5" />}</button>
        <span key={qty} className="w-4 text-center text-[13px] font-bold tabular-nums motion-safe:animate-[vlh-pop_0.3s_ease-out]">{qty}</span>
        <button type="button" onClick={() => onQty(qty + 1)} aria-label={`One more ${name}`} className="grid size-8 place-items-center rounded-full text-(--vr-gold) hover:bg-white/10"><Plus className="size-3.5" strokeWidth={2.5} /></button>
      </span>
    );
  }
  return (
    <motion.button type="button" whileTap={{ scale: 0.88 }} onClick={onAdd} aria-label={many ? `Choose a size of ${name}` : `Add ${name}`}
      className={cn("grid size-8 shrink-0 place-items-center rounded-full transition", qty > 0 ? "bg-(--vr-dark) text-[12px] font-bold text-white" : "bg-(--vr-gold) text-(--vr-ink) hover:brightness-105")}>
      {qty > 0 ? qty : <Plus className="size-4" strokeWidth={2.5} />}
    </motion.button>
  );
}

/** Recommended: every card the same size — a square photo, the name on one line, the price under it. */
function FeaturedCard({ e, qty, orderingOn, onOpen, onAdd }: { e: RestaurantEntry; qty: number; orderingOn: boolean; onOpen: () => void; onAdd: () => void }) {
  return (
    <article className="group w-[148px] shrink-0 snap-start sm:w-[180px] lg:w-[200px] 2xl:w-[210px]">
      <div className="relative">
        <button type="button" onClick={onOpen} className="relative block aspect-square w-full overflow-hidden rounded-2xl bg-(--vr-line)" aria-label={`${e.name} — details`}>
          <Photo e={e} drink={false} sizes="(min-width:1024px) 210px, 180px" className="transition duration-700 group-hover:scale-105 motion-reduce:transition-none" />
          <span className="absolute left-2 top-2"><Badge badge={e.badge} small /></span>
        </button>
        {orderingOn && orderable(e) && (
          <div className="absolute bottom-2 right-2"><AddButton qty={qty} name={e.name} onAdd={onAdd} onQty={null} many={e.options.length > 1} /></div>
        )}
      </div>
      <button type="button" onClick={onOpen} className="mt-2 block w-full text-left">
        <div className="truncate text-[13.5px] font-semibold leading-tight">{e.name}</div>
        <div className="mt-0.5 text-[12.5px] tabular-nums text-(--vr-muted)">{e.options.length > 1 ? "from " : ""}{tzs(fromPrice(e))}</div>
      </button>
    </article>
  );
}

function ProductCard({ e, drink, qty, orderingOn, onOpen, onAdd, onQty }: {
  e: RestaurantEntry; drink: boolean; qty: number; orderingOn: boolean; onOpen: () => void; onAdd: () => void; onQty: ((v: number) => void) | null;
}) {
  const ok = orderable(e);
  return (
    <li className={cn("group flex gap-3 rounded-2xl bg-(--vr-card) p-2.5 ring-1 transition sm:flex-col sm:gap-0 sm:overflow-hidden sm:p-0 sm:hover:shadow-[0_16px_30px_-24px_rgba(29,23,18,0.6)] lg:flex-row lg:gap-3.5 lg:p-3 lg:hover:ring-(--vr-gold)/60 xl:gap-4",
      qty > 0 ? "ring-(--vr-gold)/70" : "ring-(--vr-line)", !ok && "opacity-60")}>
      <button type="button" onClick={onOpen} aria-label={`${e.name} — details`}
        className="relative size-[84px] shrink-0 overflow-hidden rounded-xl sm:aspect-[16/10] sm:size-auto sm:w-full sm:rounded-none lg:aspect-auto lg:size-[104px] lg:rounded-xl xl:size-[124px]">
        <Photo e={e} drink={drink} sizes="(min-width:1024px) 124px, (min-width:640px) 45vw, 84px" className="transition duration-700 group-hover:scale-105 motion-reduce:transition-none" />
        {e.badge && <span className="absolute left-1.5 top-1.5 sm:left-2 sm:top-2"><Badge badge={e.badge} small /></span>}
        {!ok && <span className="absolute inset-x-1 bottom-1 rounded-full bg-black/70 py-px text-center text-[9px] font-semibold uppercase tracking-wider text-white">Sold out</span>}
      </button>
      <div className="flex min-w-0 flex-1 flex-col sm:p-3 lg:p-0 lg:py-0.5">
        <button type="button" onClick={onOpen} className="text-left">
          <span className="line-clamp-2 text-[14.5px] font-semibold leading-snug">{e.name}</span>
          {e.description && <span className="mt-0.5 line-clamp-2 block text-[12.5px] leading-snug text-(--vr-muted)">{e.description}</span>}
          {e.options.length > 1 && <span className="mt-0.5 block text-[11.5px] text-(--vr-muted)">{e.options.map((o) => o.label).join(" · ")}</span>}
        </button>
        <div className="mt-auto flex items-center justify-between gap-2 pt-2">
          <span className="text-[14px] font-semibold tabular-nums">{e.options.length > 1 && <span className="text-[11px] font-normal text-(--vr-muted)">from </span>}{tzs(fromPrice(e))}</span>
          {orderingOn && ok && <AddButton qty={qty} name={e.name} onAdd={onAdd} onQty={onQty} many={e.options.length > 1} />}
        </div>
      </div>
    </li>
  );
}

/** A full page on phones (slides up over the menu), a centred card on computers. */
const openSheets: symbol[] = []; // Escape closes only the one on top (e.g. "who is ordering" over the order)

export function Sheet({ open, onClose, label, wide, product, children }: { open: boolean; onClose: () => void; label: string; wide?: boolean; product?: boolean; children: React.ReactNode }) {
  const close = useRef(onClose);
  useEffect(() => { close.current = onClose; });
  useEffect(() => {
    if (!open) return;
    const id = Symbol();
    openSheets.push(id);
    const k = (ev: KeyboardEvent) => { if (ev.key === "Escape" && openSheets.at(-1) === id) close.current(); };
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", k);
    return () => { window.removeEventListener("keydown", k); openSheets.splice(openSheets.indexOf(id), 1); document.body.style.overflow = prev; };
  }, [open]);
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="fixed inset-0 z-50 flex justify-center bg-[#1d1712]/50 backdrop-blur-[2px] sm:items-center sm:p-6" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div role="dialog" aria-modal="true" aria-label={label} onClick={(ev) => ev.stopPropagation()}
            initial={{ y: "6%", opacity: 0 }} animate={{ y: 0, opacity: 1 }} exit={{ y: "6%", opacity: 0 }} transition={{ type: "spring", stiffness: 380, damping: 38 }}
            className={cn("vr relative flex h-svh w-full flex-col overflow-hidden bg-(--vr-card) text-(--vr-ink) shadow-2xl sm:h-auto sm:max-h-[90svh] sm:rounded-3xl", wide ? "sm:max-w-lg" : "sm:max-w-md",
              product && "lg:h-[min(580px,88svh)] lg:max-w-[900px] lg:flex-row")}>
            {children}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

/** A dish or drink as its own page: a big photo, what it is, the size, how many — and add. */
function ProductSheet({ opened, section, drink, cart, orderingOn, onClose, onSet, pairs, pairQty, onPick, onAddPair }: {
  opened: RestaurantEntry | null; section: string; drink: boolean; cart: Record<string, number>; orderingOn: boolean;
  onClose: () => void; onSet: (o: RestaurantOption, qty: number) => void;
  pairs: RestaurantEntry[]; pairQty: (e: RestaurantEntry) => number; onPick: (key: string) => void; onAddPair: (e: RestaurantEntry) => void;
}) {
  const [pick, setPick] = useState<string | null>(null);
  const [qty, setQtyLocal] = useState<number | null>(null);
  const body = useRef<HTMLDivElement>(null);
  const pickPair = (key: string) => { setPick(null); setQtyLocal(null); body.current?.scrollTo({ top: 0 }); onPick(key); };
  const e = opened;
  const option = e ? e.options.find((o) => o.id === pick) ?? e.options.find((o) => o.available) ?? e.options[0] : null;
  const inCart = option ? cart[option.id] ?? 0 : 0;
  const amount = qty ?? Math.max(1, inCart);
  const close = useCallback(() => { setPick(null); setQtyLocal(null); onClose(); }, [onClose]);
  return (
    <Sheet open={!!e && !!option} onClose={close} label={e?.name ?? "Dish"} product>
      {e && option && (
        <>
          <div className="relative h-[46svh] w-full shrink-0 overflow-hidden bg-(--vr-line) sm:h-auto sm:aspect-[16/10] sm:rounded-t-3xl lg:aspect-auto lg:h-auto lg:w-[47%] lg:self-stretch lg:rounded-r-none lg:rounded-l-3xl">
            <HeroPhoto key={e.key} e={e} drink={drink} />
            <div aria-hidden className="absolute inset-x-0 top-0 h-24 bg-linear-to-b from-black/35 to-transparent" />
            <button type="button" onClick={close} aria-label="Back to the menu"
              className="absolute left-4 top-[max(1rem,env(safe-area-inset-top))] grid size-10 place-items-center rounded-full bg-white/95 text-(--vr-ink) shadow-[0_6px_18px_-6px_rgba(0,0,0,0.5)] sm:left-auto sm:right-3 sm:top-3 sm:size-8 lg:hidden">
              <ChevronLeft className="size-5 sm:hidden" /><X className="hidden size-4 sm:block" />
            </button>
          </div>
          <div className="relative flex min-h-0 flex-1 flex-col lg:min-w-0">
          <button type="button" onClick={close} aria-label="Close" className="absolute right-4 top-4 z-10 hidden size-9 place-items-center rounded-full bg-(--vr-bg) transition hover:bg-(--vr-line) lg:grid"><X className="size-4" /></button>
          <div ref={body} className="relative -mt-6 flex-1 overflow-y-auto overscroll-contain rounded-t-[26px] bg-(--vr-card) px-5 pb-4 pt-5 sm:mt-0 sm:rounded-none lg:px-8 lg:pt-8">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.2em] text-(--vr-gold-ink)">{section}</span>
              <Badge badge={e.badge} small />
            </div>
            <h2 className="mt-1.5 font-display text-[27px] font-semibold leading-[1.1] lg:pr-10 lg:text-[32px]">{e.name}</h2>
            <p className="mt-1 text-[17px] font-semibold tabular-nums">{tzs(option.price)}</p>
            {e.description && <p className="mt-3 text-[14px] leading-relaxed text-(--vr-muted)">{e.description}</p>}
            {e.options.length > 1 && (
              <div className="mt-5">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-(--vr-muted)">Choose a size</p>
                <div className="grid grid-cols-3 gap-2">
                  {e.options.map((o) => (
                    <button key={o.id} type="button" disabled={!o.available} onClick={() => { setPick(o.id); setQtyLocal(null); }} aria-pressed={option.id === o.id}
                      className={cn("rounded-2xl px-2 py-2.5 text-center ring-1 transition disabled:opacity-40", option.id === o.id ? "bg-(--vr-dark) text-white ring-(--vr-dark)" : "bg-(--vr-bg) ring-(--vr-line) hover:ring-(--vr-gold)")}>
                      <div className="text-[13px] font-semibold">{o.label}</div>
                      <div className={cn("text-[11.5px] tabular-nums", option.id === o.id ? "text-white/70" : "text-(--vr-muted)")}>{o.available ? tzs(o.price) : "Sold out"}</div>
                      {(cart[o.id] ?? 0) > 0 && <div className="text-[10px] font-semibold text-(--vr-gold)">{cart[o.id]} in order</div>}
                    </button>
                  ))}
                </div>
              </div>
            )}
            {!option.available && <p className="mt-4 rounded-xl bg-(--vr-bg) px-3.5 py-2.5 text-[13px]">Sold out today — ask us what is fresh.</p>}
            {pairs.length > 0 && (
              <div className="mt-6">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-(--vr-muted)">{drink ? "Goes well with" : "Something to drink?"}</p>
                <div className="-mx-5 flex gap-2.5 overflow-x-auto px-5 pb-1 [scrollbar-width:none]">
                  {pairs.map((p) => (
                    <div key={p.key} className="w-[104px] shrink-0">
                      <div className="relative">
                        <button type="button" onClick={() => pickPair(p.key)} aria-label={`${p.name} — details`} className="relative block aspect-square w-full overflow-hidden rounded-xl bg-(--vr-line)">
                          <Photo e={p} drink={!drink} sizes="104px" />
                        </button>
                        {orderingOn && <div className="absolute bottom-1.5 right-1.5"><AddButton qty={pairQty(p)} name={p.name} onAdd={() => onAddPair(p)} onQty={null} many={p.options.length > 1} /></div>}
                      </div>
                      <button type="button" onClick={() => pickPair(p.key)} className="mt-1.5 block w-full text-left">
                        <div className="truncate text-[12.5px] font-semibold leading-tight">{p.name}</div>
                        <div className="mt-0.5 text-[11.5px] tabular-nums text-(--vr-muted)">{p.options.length > 1 ? "from " : ""}{tzs(fromPrice(p))}</div>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
          {orderingOn && option.available && (
            <div className="flex items-center gap-2.5 border-t border-(--vr-line) bg-(--vr-card) px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:px-8 lg:py-5">
              <div className="inline-flex h-12 shrink-0 items-center rounded-full bg-(--vr-bg) ring-1 ring-(--vr-line)">
                <button type="button" onClick={() => setQtyLocal(Math.max(inCart ? 0 : 1, amount - 1))} aria-label="One less" className="grid h-12 w-10 place-items-center rounded-full">{amount <= 1 && inCart ? <Trash2 className="size-4" /> : <Minus className="size-4" />}</button>
                <span className="w-5 text-center text-[16px] font-bold tabular-nums">{amount}</span>
                <button type="button" onClick={() => setQtyLocal(Math.min(20, amount + 1))} aria-label="One more" className="grid h-12 w-10 place-items-center rounded-full"><Plus className="size-4" /></button>
              </div>
              <button type="button" onClick={() => { onSet(option, amount); close(); }}
                className={cn("flex h-12 min-w-0 flex-1 items-center justify-between gap-2 rounded-full px-4 text-[14px] font-semibold transition",
                  amount === 0 ? "justify-center bg-rose-50 text-rose-700 ring-1 ring-rose-200" : "bg-(--vr-dark) text-white hover:bg-black")}>
                <span className="truncate">{amount === 0 ? "Remove" : inCart ? <>Update<span className="max-[359px]:hidden"> order</span></> : <>Add<span className="max-[359px]:hidden"> to order</span></>}</span>
                {amount > 0 && <span className="shrink-0 whitespace-nowrap tabular-nums text-(--vr-gold)">{tzs(option.price * amount)}</span>}
              </button>
            </div>
          )}
          </div>
        </>
      )}
    </Sheet>
  );
}

/** The big photo: a small copy shows at once (soft), the sharp one fades in over it — never an empty box. */
function HeroPhoto({ e, drink }: { e: RestaurantEntry; drink: boolean }) {
  const [sharp, setSharp] = useState(false);
  if (!e.image) return <Photo e={e} drink={drink} sizes="100vw" />;
  return (
    <>
      <Image src={e.image} alt="" aria-hidden fill sizes="96px" className="scale-110 object-cover blur-md" />
      <Image src={e.image} alt={e.name} fill loading="eager" sizes="(min-width:1024px) 430px, (min-width:640px) 448px, 100vw" onLoad={() => setSharp(true)}
        className={cn("object-cover transition-opacity duration-500", sharp ? "opacity-100" : "opacity-0")} />
    </>
  );
}

function Lines({ lines, setQty }: { lines: CartLine[]; setQty: (id: string, qty: number) => void }) {
  return (
    <ul className="divide-y divide-(--vr-line)">
      {lines.map((l) => (
        <li key={l.option.id} className="flex items-center gap-3 py-2.5">
          <span className="relative size-11 shrink-0 overflow-hidden rounded-lg bg-(--vr-bg)"><Photo e={l.entry} drink={false} sizes="44px" /></span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="line-clamp-1 text-[13.5px] font-medium">{l.name}</span>
            <span className="text-[12px] tabular-nums text-(--vr-muted)">{tzs(l.option.price * l.qty)}</span>
          </span>
          <span className="inline-flex h-8 shrink-0 items-center rounded-full ring-1 ring-(--vr-line)">
            <button type="button" onClick={() => setQty(l.option.id, l.qty - 1)} aria-label={`One less ${l.name}`} className="grid size-8 place-items-center rounded-full hover:bg-(--vr-bg)">{l.qty === 1 ? <Trash2 className="size-3" /> : <Minus className="size-3" />}</button>
            <span className="w-4 text-center text-[13px] font-semibold tabular-nums">{l.qty}</span>
            <button type="button" onClick={() => setQty(l.option.id, l.qty + 1)} aria-label={`One more ${l.name}`} className="grid size-8 place-items-center rounded-full hover:bg-(--vr-bg)"><Plus className="size-3" /></button>
          </span>
        </li>
      ))}
    </ul>
  );
}

function Totals({ subtotal, fee }: { subtotal: number; fee: number }) {
  return (
    <dl className="space-y-1 text-[13px]">
      {fee > 0 && <div className="flex justify-between text-(--vr-muted)"><dt>Items</dt><dd className="tabular-nums">{tzs(subtotal)}</dd></div>}
      {fee > 0 && <div className="flex justify-between text-(--vr-muted)"><dt>Room service delivery</dt><dd className="tabular-nums">{tzs(fee)}</dd></div>}
      <div className="flex items-baseline justify-between pt-1"><dt className="font-semibold">Total</dt><dd className="text-[17px] font-semibold tabular-nums">{tzs(subtotal + fee)}</dd></div>
    </dl>
  );
}

/** Computers: the order beside the menu. */
function CartPanel({ place, lines, subtotal, fee, setQty, onCheckout, who, needsWho, onWho }: {
  place: AppPlace; lines: CartLine[]; subtotal: number; fee: number; setQty: (id: string, qty: number) => void; onCheckout: () => void;
  who: Who | null; needsWho: boolean; onWho: (() => void) | null;
}) {
  const count = lines.reduce((t, l) => t + l.qty, 0);
  return (
    <section aria-label="Your order" className="rounded-3xl bg-(--vr-card) p-5 ring-1 ring-(--vr-line) shadow-[0_24px_50px_-40px_rgba(29,23,18,0.55)]">
      <div className="flex items-baseline justify-between">
        <h2 className="font-display text-[24px] font-semibold leading-none">Your order</h2>
        {count > 0 && <span className="text-[12px] text-(--vr-muted)">{count} item{count === 1 ? "" : "s"}</span>}
      </div>
      {/* Where it goes — and who is ordering */}
      <div className="mt-3.5 overflow-hidden rounded-2xl bg-(--vr-bg) ring-1 ring-(--vr-line)">
        <p className="flex items-center gap-2.5 px-3 py-2.5 text-[13px] font-medium">
          <span className="grid size-7 shrink-0 place-items-center rounded-full bg-(--vr-dark) text-(--vr-gold)"><PlaceIcon place={place} className="size-3.5" /></span>
          <span className="min-w-0 truncate">{placeLine(place)}</span>
        </p>
        {needsWho && (who ? (
          <div className="flex items-center gap-2.5 border-t border-(--vr-line) px-3 py-2.5">
            <span className="grid size-7 shrink-0 place-items-center rounded-full bg-(--vr-gold) font-display text-[13px] font-semibold text-(--vr-ink)">{who.name.charAt(0).toUpperCase()}</span>
            <span className="min-w-0 flex-1 leading-tight">
              <span className="block truncate text-[13px] font-semibold">{who.name}</span>
              <span className="block text-[11.5px] tabular-nums text-(--vr-muted)">{onWho ? phoneLabel(who.phone) : "Your table · one bill"}</span>
            </span>
            {onWho && <button type="button" onClick={onWho} className="shrink-0 text-[12px] font-medium text-(--vr-gold-ink) hover:underline">Change</button>}
          </div>
        ) : (
          <p className="border-t border-(--vr-line) px-3 py-2.5 text-[12px] leading-snug text-(--vr-muted)">We ask your name and number when you add your first item.</p>
        ))}
        {place.kind === "room" && (
          <p className="border-t border-(--vr-line) px-3 py-2.5 text-[12px] text-(--vr-muted)">For <strong className="font-semibold text-(--vr-ink)">{place.guest}</strong> · on your room bill</p>
        )}
      </div>
      {lines.length === 0 ? (
        <div className="mt-4 flex flex-col items-center rounded-2xl border border-dashed border-(--vr-line) px-4 py-8 text-center">
          <span className="grid size-11 place-items-center rounded-full bg-(--vr-gold-soft) text-(--vr-gold-ink)"><ShoppingBag className="size-5" /></span>
          <p className="mt-3 text-[14px] font-semibold">Nothing here yet</p>
          <p className="mt-0.5 text-[12.5px] text-(--vr-muted)">Tap <strong className="text-(--vr-ink)">+</strong> on anything you like.</p>
        </div>
      ) : (
        <>
          <div className="mt-2 max-h-[50svh] overflow-y-auto pr-1 [scrollbar-width:thin]"><Lines lines={lines} setQty={setQty} /></div>
          <div className="mt-1 border-t border-(--vr-line) pt-2.5"><Totals subtotal={subtotal} fee={fee} /></div>
          <button type="button" onClick={onCheckout} className="mt-3.5 flex h-12 w-full items-center justify-between rounded-full bg-(--vr-dark) pl-5 pr-4 text-[14px] font-semibold text-white transition hover:bg-black">
            <span>Checkout</span>
            <span className="inline-flex items-center gap-2 tabular-nums text-(--vr-gold)">{tzs(subtotal + fee)}<ArrowRight className="size-4" /></span>
          </button>
        </>
      )}
    </section>
  );
}

/** Your order as its own page: back to the menu, the lines, the details for this place and "Place order". */
function CheckoutSheet({ open, onClose, place, lines, subtotal, fee, setQty, children }: {
  open: boolean; onClose: () => void; place: AppPlace; lines: CartLine[]; subtotal: number; fee: number; setQty: (id: string, qty: number) => void; children: React.ReactNode;
}) {
  useEffect(() => { if (open && lines.length === 0) onClose(); }, [open, lines.length, onClose]);
  return (
    <Sheet open={open} onClose={onClose} label="Your order" wide>
      <div className="flex items-center gap-3 border-b border-(--vr-line) px-4 pb-3 pt-[max(0.9rem,env(safe-area-inset-top))] sm:px-5 sm:pt-4">
        <button type="button" onClick={onClose} aria-label="Back to the menu" className="grid size-10 shrink-0 place-items-center rounded-full bg-(--vr-bg) hover:bg-(--vr-line) sm:order-last sm:size-8">
          <ChevronLeft className="size-5 sm:hidden" /><X className="hidden size-4 sm:block" />
        </button>
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[22px] font-semibold leading-none">Your order</h2>
          <p className="mt-1 flex items-center gap-1.5 truncate text-[12px] text-(--vr-muted)"><PlaceIcon place={place} className="size-3" />{placeLine(place)}</p>
        </div>
      </div>
      <div className="flex-1 overflow-y-auto overscroll-contain px-5">
        <Lines lines={lines} setQty={setQty} />
        <div className="border-t border-(--vr-line) pt-2.5"><Totals subtotal={subtotal} fee={fee} /></div>
        {children}
      </div>
    </Sheet>
  );
}
