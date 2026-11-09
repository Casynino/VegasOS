"use client";

import Image from "next/image";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ChevronDown, ChevronLeft, ChevronRight, Globe, Languages, LayoutGrid, LogOut, Search, Smartphone, UserRound, X } from "lucide-react";
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { logoutAction } from "@/app/staff/(auth)/login/actions";
import { LOCALES, LOCALE_META, type Locale } from "@/i18n/config";
import { useLocale, useT } from "@/i18n/client";
import { setMyLanguage } from "@/i18n/actions";
import { cn } from "@/lib/utils";
import { Initials } from "@/components/dashboard/kit";
import { NAV_ICONS } from "./staff-nav";
import { openInstallSheet, useInstall } from "./install-app";
import type { NavItem, NavSection } from "./nav-config";

/**
 * The staff side menu, copied from the owner's Target Express / Swift Cargo console (2026-11-08) in the hotel's own warm gold:
 * a floating frosted panel — the hotel's name, a search over every page this person can open (⌘K), MAIN (Home, Find, single pages),
 * WORKSPACE (groups that fold open, their pages on a branch line), and at the bottom the person, whose small menu holds the account, the
 * other language, the hotel's website and Sign out. On a computer it folds to a rail of icons; on a phone the same panel is the drawer.
 *
 * What a person opens or folds is remembered on this device; the group holding the page they are on opens by itself; a closed group
 * still shows the red count of what waits inside it.
 */
export interface SidebarPerson {
  name: string;
  /** The role's name as stored (translated here). */
  role: string;
  /** A Developer (signed in as itself or working as someone): the picture carries the Developer's own colour. */
  developer: boolean;
  /** A Developer working as someone: the account page and the language are that person's, not the Developer's. */
  workAs: boolean;
}
export interface SidebarShift { href: string; label: string; on: boolean }
export interface SidebarProps {
  sections: NavSection[];
  /** The person's own dashboard (none in the Developer's console, whose first page is its Home). */
  home?: string;
  /** Show the "Find" page (guests, bookings, bills) — for those who may look. */
  find?: boolean;
  hotelName: string;
  user: SidebarPerson;
  /** The receptionist's own shift, as one small line under the search (already worded and translated). */
  shift?: SidebarShift | null;
  languages: readonly string[];
}

/** The icon for a menu entry (the Find page has the magnifier). */
const iconFor = (name: string) => (name === "Search" ? Search : NAV_ICONS[name] ?? LayoutGrid);

const STORE = "vlh-staff-nav";
const LABEL = "px-4 pb-1 text-[10.5px] font-semibold uppercase tracking-[0.18em] g-dim";
const FOCUS = "outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.76_0.13_82)]/60";

function readChoices(): Record<string, boolean> {
  try {
    const raw = JSON.parse(localStorage.getItem(STORE) ?? "{}");
    if (!raw || typeof raw !== "object") return {};
    return Object.fromEntries(Object.entries(raw).filter(([, v]) => typeof v === "boolean")) as Record<string, boolean>;
  } catch { return {}; }
}
function saveChoices(choices: Record<string, boolean>) {
  try { localStorage.setItem(STORE, JSON.stringify(choices)); } catch { /* a per-device convenience only */ }
}

/** Which group is open: the one with the page you are on, plus what you opened or closed (remembered). */
function useFolds(activeTitle: string | undefined) {
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<string | null>(activeTitle ?? null);
  const [seen, setSeen] = useState(activeTitle);
  const [animate, setAnimate] = useState(false);
  if (seen !== activeTitle) { // went to a page in another group: that group opens (adjusted while drawing, not in an effect)
    setSeen(activeTitle);
    setRevealed(activeTitle ?? null);
  }
  useEffect(() => {
    // Browser storage can only be read in the browser, after the first drawing (so it matches the server's).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChoices(readChoices());
    const frame = requestAnimationFrame(() => setAnimate(true)); // no sliding while the saved choices are applied
    return () => cancelAnimationFrame(frame);
  }, []);
  const isOpen = (title: string) => title === revealed || (choices[title] ?? title === activeTitle);
  const toggle = (title: string) => {
    const open = !isOpen(title);
    setChoices((previous) => {
      const next = { ...previous, [title]: open };
      saveChoices(next);
      return next;
    });
    setRevealed((r) => (r === title ? null : r));
  };
  return { isOpen, toggle, animate };
}

export function GlassSidebar({ mode, sidebar, bell, collapsed = false, onCollapsedChange, onNavigate, onClose }: {
  mode: "desktop" | "sheet";
  sidebar: SidebarProps;
  /** The bell (one live instance, drawn by the shell): in the header of the panel on a computer. */
  bell?: ReactNode;
  collapsed?: boolean;
  onCollapsedChange?: (next: boolean) => void;
  onNavigate?: () => void;
  /** The phone's drawer: close it. */
  onClose?: () => void;
}) {
  const { sections, home, find, hotelName, user, shift, languages } = sidebar;
  const t = useT();
  const nav = (s: string) => t.ctx("nav", s);
  const router = useRouter();
  const pathname = usePathname();
  const rail = mode === "desktop" && collapsed;
  // The phone's drawer is roomier than the computer's panel (owner, 2026-11-08: "the best experience on every phone, like an app"): bigger words and icons,
  // 44px rows for a thumb, and a swipe to the left closes it.
  const phone = mode === "sheet";
  const swipe = useRef<{ x: number; y: number } | null>(null);

  const multi = sections.length > 1;
  /** Groups fold open; a group with one page is that page, a plain row (and with only one group everything is a plain list). */
  const groups = multi ? sections.filter((s) => s.items.length > 1) : [];
  const pages: NavItem[] = multi ? sections.filter((s) => s.items.length === 1).flatMap((s) => s.items) : sections.flatMap((s) => s.items);
  const findItem: NavItem | null = find ? { href: "/staff/search", label: "Find", icon: "Search", anyOf: [] } : null;
  const homeItem: NavItem | null = home ? { href: home, label: "Home", icon: "LayoutGrid", anyOf: [] } : null;
  const everyItem = [...(homeItem ? [homeItem] : []), ...(findItem ? [findItem] : []), ...sections.flatMap((s) => s.items)];

  // The most specific match wins (e.g. /staff/reports/daily over /staff/reports); Home only on its own page.
  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  const activeHref = (() => {
    let best: string | undefined;
    for (const i of everyItem) {
      if (i.href === home ? pathname !== i.href : !matches(i.href)) continue;
      if (!best || i.href.length > best.length) best = i.href;
    }
    return best;
  })();
  const activeTitle = groups.find((g) => g.items.some((i) => i.href === activeHref))?.title;
  const folds = useFolds(activeTitle);

  const [query, setQuery] = useState("");
  const searchRef = useRef<HTMLInputElement>(null);
  const focusAfterOpen = useRef(false);
  const [shortcut, setShortcut] = useState("⌘K");
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (!/Mac|iPhone|iPad/i.test(navigator.platform || navigator.userAgent)) setShortcut("Ctrl K");
  }, []);
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setQuery("");
  }, [pathname]);

  // ⌘K / Ctrl K reaches the page search from anywhere; [ folds and unfolds.
  useEffect(() => {
    if (mode !== "desktop") return;
    const onKey = (event: KeyboardEvent) => {
      if (window.innerWidth < 1024) return;
      const el = event.target as HTMLElement | null;
      const typing = !!el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        if (collapsed) { focusAfterOpen.current = true; onCollapsedChange?.(false); }
        else { searchRef.current?.focus(); searchRef.current?.select(); }
      } else if (event.key === "[" && !typing && !event.metaKey && !event.ctrlKey && !event.altKey) {
        onCollapsedChange?.(!collapsed);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode, collapsed, onCollapsedChange]);
  useEffect(() => {
    if (!collapsed && focusAfterOpen.current) {
      focusAfterOpen.current = false;
      requestAnimationFrame(() => searchRef.current?.focus());
    }
  }, [collapsed]);

  // The search runs over every page this person can open, in either language; a group's name finds its pages too.
  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return null;
    const seen = new Set<string>();
    const out: { item: NavItem; where: string | null }[] = [];
    const check = (item: NavItem, group: string | null) => {
      if (seen.has(item.href)) return;
      const words = [nav(item.label), item.label];
      if (group) words.push(nav(group), group);
      if (!words.some((w) => w.toLowerCase().includes(q))) return;
      seen.add(item.href);
      out.push({ item, where: group ? nav(group) : null });
    };
    if (homeItem) check(homeItem, null);
    if (findItem) check(findItem, null);
    for (const s of sections) for (const i of s.items) check(i, s.items.length > 1 && multi ? s.title : null);
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sections, home, find]);

  /* The name beside a rail icon: fixed to the viewport and drawn outside the panel (the frosted glass would trap it). */
  const [hint, setHint] = useState<{ label: string; x: number; y: number } | null>(null);
  const showHint = (target: EventTarget | null) => {
    const el = rail ? (target as HTMLElement | null)?.closest?.<HTMLElement>("[data-hint]") : null;
    if (!el) { setHint(null); return; }
    const box = el.getBoundingClientRect();
    setHint({ label: el.dataset.hint ?? "", x: box.right + 12, y: box.top + box.height / 2 });
  };

  const brand = (compact: boolean) => (
    <Link href={home ?? sections[0]?.items[0]?.href ?? "/staff"} onClick={onNavigate} data-hint={hotelName} className={cn("flex min-w-0 items-center gap-3 rounded-full", FOCUS)}>
      <span className="grid size-10 shrink-0 place-items-center overflow-hidden rounded-full bg-black ring-2 ring-[oklch(0.76_0.13_82)]/45">
        <Image src="/brand/logo-192.png" alt="" width={40} height={40} className="size-10 object-cover" />
      </span>
      {compact ? null : (
        <span className="min-w-0 leading-tight">
          <span className={cn("block truncate font-semibold tracking-tight g-strong", phone ? "text-base" : "text-sm")}>{hotelName}</span>
          <span className={cn("mt-0.5 block truncate g-soft", phone ? "text-[13px]" : "text-xs")}>{t("Hotel management")}</span>
        </span>
      )}
    </Link>
  );

  const itemBadge = (item: NavItem) => item.badge ? (
    <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-bold leading-4 tabular-nums text-white" aria-label={t("{n} new", { n: item.badge })}>{item.badge}</span>
  ) : null;

  const row = (item: NavItem, child = false, where: string | null = null) => {
    const Icon = iconFor(item.icon);
    const active = item.href === activeHref;
    return (
      <li key={`${item.href}:${item.label}`}>
        <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined}
          className={cn("relative flex items-center gap-3 rounded-lg", FOCUS, child ? (phone ? "min-h-10 px-3 py-2 text-[14.5px]" : "px-3 py-1.5 text-[13px]") : (phone ? "min-h-11 px-3 py-2.5 text-[15.5px]" : "px-3 py-2 text-[13px]"),
            active ? "glass-active font-medium g-strong" : "glass-row g-text g-hover")}>
          <Icon className={cn("shrink-0", phone ? (child ? "size-[18px]" : "size-[21px]") : (child ? "size-4" : "size-[18px]"), active && "g-gold")} />
          <span className="min-w-0 flex-1 truncate">{nav(item.label)}</span>
          {where ? <span className="shrink-0 text-[11px] g-soft">{where}</span> : null}
          {itemBadge(item)}
        </Link>
      </li>
    );
  };

  const shiftRow = shift ? (
    <Link href={shift.href} onClick={onNavigate} data-hint={shift.label}
      className={cn("flex items-center gap-2 rounded-full px-3 py-1.5 text-xs font-semibold", FOCUS,
        shift.on ? "bg-emerald-500/12 text-emerald-300 ring-1 ring-inset ring-emerald-500/30" : "bg-amber-500/12 text-amber-300 ring-1 ring-inset ring-amber-500/30")}>
      <span className={cn("size-1.5 shrink-0 rounded-full", shift.on ? "animate-pulse bg-emerald-400" : "bg-amber-400")} />
      <span className="min-w-0 truncate">{shift.label}</span>
    </Link>
  ) : null;

  /** The full menu: name, search, MAIN, WORKSPACE (folding groups with branches) and the person. */
  const full = (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex items-center justify-between gap-2 px-4 pb-3 pr-7 pt-4">
        {brand(false)}
        {mode === "sheet" ? (
          <button type="button" onClick={onClose} className={cn("glass-row grid size-9 shrink-0 place-items-center rounded-full g-text", FOCUS)}>
            <X className="size-[17px]" />
            <span className="sr-only">{t("Close")}</span>
          </button>
        ) : null}
      </div>

      <div className="flex items-center gap-1 px-3 pb-1.5">
        <label className={cn("glass-field flex min-w-0 flex-1 items-center gap-2.5 px-3.5 g-soft", phone ? "py-3 text-[15px]" : "py-2 text-sm")}>
          <Search className={cn("shrink-0", phone ? "size-[18px]" : "size-4")} />
          <input ref={searchRef} value={query} onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.nativeEvent.isComposing || e.keyCode === 229) return; // committing Chinese pinyin with Enter is not "go"
              if (e.key === "Enter" && results?.[0]) { e.preventDefault(); setQuery(""); onNavigate?.(); router.push(results[0].item.href); }
              else if (e.key === "Escape") { if (query) setQuery(""); else e.currentTarget.blur(); }
            }}
            placeholder={t("Search pages")} aria-label={t("Search pages")} autoComplete="off"
            className="g-input g-strong min-w-0 flex-1 bg-transparent outline-none" />
          {query ? (
            <button type="button" onClick={() => { setQuery(""); searchRef.current?.focus(); }} className="g-soft g-hover grid size-5 shrink-0 place-items-center rounded-full">
              <X className="size-3.5" /><span className="sr-only">{t("Clear search")}</span>
            </button>
          ) : (
            <kbd className="glass-kbd g-soft hidden shrink-0 rounded-md px-1.5 py-0.5 font-sans text-[10px] font-semibold lg:block">{shortcut}</kbd>
          )}
        </label>
        {mode === "desktop" && bell ? <div className="-mr-1 shrink-0 text-[var(--glass-text)]">{bell}</div> : null}
      </div>
      {shiftRow ? <div className="px-3 pb-1 pt-1.5">{shiftRow}</div> : null}

      <nav aria-label={t("Staff navigation")} className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 pb-2 [scrollbar-width:thin]">
        {results ? (
          results.length ? <ul className="mt-2 space-y-0.5">{results.map(({ item, where }) => row(item, false, where))}</ul>
            : <p className="g-soft px-4 py-6 text-center text-sm">{t("No page matches that.")}</p>
        ) : (
          <>
            <div>
              <p className={cn(LABEL, "pt-3")}>{t("Main")}</p>
              <ul className="space-y-0.5">
                {homeItem && row(homeItem)}
                {findItem && row(findItem)}
                {pages.map((i) => row(i))}
              </ul>
            </div>
            {groups.length > 0 && (
              <div>
                <p className={cn(LABEL, "pt-4")}>{t("Workspace")}</p>
                {groups.map((g) => {
                  const GroupIcon = NAV_ICONS[g.icon] ?? LayoutGrid;
                  const here = g.title === activeTitle;
                  const open = folds.isOpen(g.title);
                  const waiting = g.items.reduce((sum, i) => sum + (i.badge ?? 0), 0);
                  return (
                    <div key={g.title} className="mt-0.5">
                      <button type="button" onClick={() => folds.toggle(g.title)} aria-expanded={open}
                        className={cn("glass-row g-hover flex w-full items-center gap-3 rounded-lg px-3 text-left font-medium", FOCUS, phone ? "min-h-11 py-2.5 text-[15.5px]" : "py-2 text-[13px]", here ? "g-strong" : "g-text")}>
                        <GroupIcon className={cn("shrink-0", phone ? "size-[21px]" : "size-[18px]", here ? "g-gold" : "g-icon")} />
                        <span className="min-w-0 flex-1 truncate">{nav(g.title)}</span>
                        {!open && waiting > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[10px] font-bold leading-4 tabular-nums text-white" aria-label={t("{n} new", { n: waiting })}>{waiting}</span>}
                        {!open && here && waiting === 0 && <span className="size-1.5 rounded-full bg-[oklch(0.76_0.13_82)]" aria-hidden />}
                        <ChevronDown className={cn("g-icon shrink-0", phone ? "size-[17px]" : "size-[15px]", folds.animate && "transition-transform duration-200 motion-reduce:transition-none", open && "rotate-180")} />
                      </button>
                      <div className={cn("grid", folds.animate && "transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
                        <div className="overflow-hidden" inert={!open}>
                          <ul className="glass-tree ml-[1.7rem] mt-1 space-y-0.5 pb-1 pl-3.5">{g.items.map((i) => row(i, true))}</ul>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </>
        )}
      </nav>

      <Footer mode={mode} rail={false} user={user} languages={languages} onNavigate={onNavigate} />
    </div>
  );

  /** The narrow rail: only icons, thin lines between the sets, and the person. */
  const railView = (
    <div className="flex min-h-0 flex-1 flex-col items-center">
      <div className="pb-2 pt-4">{brand(true)}</div>
      {bell ? <div className="mb-0.5 text-[var(--glass-text)]">{bell}</div> : null}
      <button type="button" data-hint={t("Search pages")} onClick={() => { focusAfterOpen.current = true; onCollapsedChange?.(false); }}
        className={cn("glass-row g-text g-hover mb-1 grid size-11 shrink-0 place-items-center rounded-full", FOCUS)}>
        <Search className="size-[18px]" /><span className="sr-only">{t("Search pages")}</span>
      </button>
      {shift ? (
        <Link href={shift.href} data-hint={shift.label} className={cn("mb-1 grid size-9 place-items-center rounded-full", FOCUS)}>
          <span className={cn("size-2.5 rounded-full", shift.on ? "animate-pulse bg-emerald-400" : "bg-amber-400")} /><span className="sr-only">{shift.label}</span>
        </Link>
      ) : null}
      <nav aria-label={t("Staff navigation")} className="flex min-h-0 w-full flex-1 flex-col items-center overflow-y-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        {/* Every page is its own icon, a plain link: nothing opens, its name appears beside it on hover. */}
        {[
          [...(homeItem ? [homeItem] : []), ...(findItem ? [findItem] : []), ...pages],
          ...groups.map((g) => g.items),
        ].filter((set) => set.length > 0).map((set, n) => (
          <div key={n} className="flex w-full flex-col items-center">
            <div aria-hidden className="glass-divider my-1.5 w-7" />
            {set.map((item) => {
              const Icon = iconFor(item.icon);
              const active = item.href === activeHref;
              return (
                <Link key={`${item.href}:${item.label}`} href={item.href} data-hint={nav(item.label)} aria-current={active ? "page" : undefined}
                  className={cn("relative mb-0.5 grid size-10 shrink-0 place-items-center rounded-full", FOCUS, active ? "glass-active g-strong" : "glass-row g-soft g-hover")}>
                  <Icon className={cn("size-[17px]", active && "g-gold")} />
                  {item.badge ? <span className="absolute right-0.5 top-0.5 size-2 rounded-full bg-rose-500" aria-hidden /> : null}
                  <span className="sr-only">{nav(item.label)}</span>
                </Link>
              );
            })}
          </div>
        ))}
      </nav>
      <Footer mode={mode} rail user={user} languages={languages} onNavigate={onNavigate} />
    </div>
  );

  if (mode === "sheet") {
    return (
      <div className="glass-panel glass-drawer h-full"
        onTouchStart={(e) => { const p = e.touches[0]; swipe.current = { x: p.clientX, y: p.clientY }; }}
        onTouchEnd={(e) => {
          const from = swipe.current; swipe.current = null;
          const p = e.changedTouches[0];
          if (from && from.x - p.clientX > 70 && Math.abs(p.clientY - from.y) < 45) onClose?.();
        }}>
        {full}
      </div>
    );
  }

  return (
    <aside aria-label={t("Staff navigation")}
      onPointerOver={(e) => showHint(e.target)} onPointerLeave={() => setHint(null)} onFocusCapture={(e) => showHint(e.target)} onBlurCapture={() => setHint(null)}
      className={cn("fixed left-[max(0.75rem,env(safe-area-inset-left))] top-[max(0.75rem,env(safe-area-inset-top))] z-30 hidden lg:block print:hidden", rail ? "w-[4.5rem]" : "bottom-[max(0.75rem,env(safe-area-inset-bottom))] w-56")}>
      <div className={cn("glass-panel flex flex-col", rail ? "max-h-[calc(100dvh-1.5rem-env(safe-area-inset-top,0px)-env(safe-area-inset-bottom,0px))]" : "h-full")}>{rail ? railView : full}</div>

      {/* Fold and unfold, on the panel's own edge. */}
      <div className="group absolute -right-3.5 top-[1.65rem] z-10">
        <button type="button" onClick={() => onCollapsedChange?.(!collapsed)} aria-expanded={!collapsed}
          className="glass-chip grid size-7 place-items-center rounded-full shadow-[0_4px_14px_rgba(0,0,0,0.4)] ring-1 ring-white/10 outline-none transition hover:scale-105 focus-visible:ring-2 focus-visible:ring-[oklch(0.76_0.13_82)]">
          {collapsed ? <ChevronRight className="size-[15px]" strokeWidth={2.5} /> : <ChevronLeft className="size-[15px]" strokeWidth={2.5} />}
          <span className="sr-only">{collapsed ? t("Expand") : t("Collapse")}</span>
        </button>
        <span className="glass-chip pointer-events-none absolute left-9 top-1/2 -translate-y-1/2 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold opacity-0 shadow-lg transition group-hover:opacity-100">
          {collapsed ? t("Expand") : t("Collapse")} <kbd className="ml-1 rounded bg-white/10 px-1 font-sans text-[10px] opacity-70">[</kbd>
        </span>
      </div>

      {hint ? (
        <span role="tooltip" className="glass-chip pointer-events-none fixed z-50 -translate-y-1/2 whitespace-nowrap rounded-lg px-2.5 py-1 text-xs font-semibold shadow-lg" style={{ left: hint.x, top: hint.y }}>
          {hint.label}
        </span>
      ) : null}
    </aside>
  );
}

/**
 * The bottom of the panel: the signed-in person (a Developer's picture carries the Developer's own colour, also while working as someone),
 * and a small menu from it — name and role, My account, the other language written in itself, the hotel's website, Sign out.
 * In the rail only the picture shows.
 */
function Footer({ mode, rail, user, languages, onNavigate }: {
  mode: "desktop" | "sheet"; rail: boolean; user: SidebarPerson; languages: readonly string[]; onNavigate?: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const current = useLocale();
  const logoutForm = useRef<HTMLFormElement>(null);
  const [, setBusy] = useState(false);
  const inst = useInstall();
  const other = LOCALES.filter((l) => l === "en" || languages.includes(l)).find((l) => l !== current);
  const firstName = user.name.trim().split(/\s+/)[0] ?? user.name;
  const item = "gap-2 rounded-lg px-2.5 py-1.5 text-[13px]";
  const changeLanguage = async (l: Locale) => {
    setBusy(true);
    const r = await setMyLanguage(l);
    if (r.ok) router.refresh();
    setBusy(false);
  };

  return (
    <div className={cn("shrink-0", rail ? "flex flex-col items-center pb-3" : "px-3 pb-3", mode === "sheet" && "pb-[max(0.75rem,env(safe-area-inset-bottom))]")}>
      <div aria-hidden className="glass-divider mb-2 w-full" />
      <DropdownMenu>
        <DropdownMenuTrigger render={<button type="button" title={user.name} data-hint={user.name} className={cn("glass-row flex w-full items-center gap-3 rounded-full text-left", FOCUS, rail ? "justify-center p-1" : "px-2 py-2")} />}>
          <Initials name={user.name} className={cn("text-xs", mode === "sheet" ? "size-11" : "size-10", user.developer && "ring-2 ring-fuchsia-500")} />
          {rail ? <span className="sr-only">{user.name}</span> : (
            <span className="min-w-0 flex-1 leading-tight">
              <span className={cn("g-strong block truncate font-semibold", mode === "sheet" ? "text-base" : "text-sm")}>{firstName}</span>
              <span className={cn("block truncate text-[11px]", user.developer ? "font-semibold text-fuchsia-300" : "g-soft")}>{user.developer && !user.workAs ? t("Developer") : t(user.role)}</span>
            </span>
          )}
        </DropdownMenuTrigger>
        <DropdownMenuContent side={rail ? "right" : "top"} align={rail ? "end" : "start"} sideOffset={rail ? 12 : 8} className="w-56 rounded-xl p-1 shadow-[0_12px_30px_-12px_rgba(0,0,0,0.55)]">
          {/* Base UI: a menu label must sit inside a group, or the menu throws (error 31) the moment it opens. */}
          <DropdownMenuGroup>
            <DropdownMenuLabel className="px-2.5 pb-1.5 pt-1 font-normal">
              <span className="block break-words text-[13px] font-semibold leading-snug text-foreground">{user.name}</span>
              <span className={cn("block truncate text-[11px]", user.developer ? "font-semibold text-fuchsia-300" : "text-muted-foreground")}>{user.developer && !user.workAs ? t("Developer") : t(user.role)}</span>
            </DropdownMenuLabel>
          </DropdownMenuGroup>
          {/* The account page of the person shown — the Developer's own, or (working as someone) that person's, as they see it. */}
          <DropdownMenuItem className={item} render={<Link href="/staff/account" onClick={onNavigate} />}>
            <UserRound className="size-3.5" />{t("My account")}
          </DropdownMenuItem>
          {!user.workAs && other && (
            <DropdownMenuItem className={item} onClick={() => void changeLanguage(other)}>
              <Languages className="size-3.5" /><span lang={LOCALE_META[other].html}>{LOCALE_META[other].label}</span>
            </DropdownMenuItem>
          )}
          <DropdownMenuItem className={item} render={<a href="/" target="_blank" rel="noopener" />}>
            <Globe className="size-3.5" />{t("Hotel website")}
          </DropdownMenuItem>
          {/* A phone or tablet that has not put the app on its home screen: the full-screen card, any time (it also opens by itself after sign-in). */}
          {inst.ready && inst.phone && !inst.installed && (
            <DropdownMenuItem className={item} onClick={() => { onNavigate?.(); openInstallSheet(); }}>
              <Smartphone className="size-3.5" />{t("Get the app")}
            </DropdownMenuItem>
          )}
          <DropdownMenuSeparator />
          <DropdownMenuItem className={cn(item, "text-rose-400 focus:text-rose-300")} onClick={() => logoutForm.current?.requestSubmit()}>
            <LogOut className="size-3.5" />{t("Sign out")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
      <form ref={logoutForm} action={logoutAction} className="hidden" />
    </div>
  );
}
