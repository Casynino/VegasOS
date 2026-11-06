"use client";

import { useEffect, useId, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, Armchair, ArrowLeftRight, Banknote, BanknoteArrowUp, BarChart3, Coins, BedDouble, BookOpenText, Boxes, Building2, BusFront, CalendarCheck, CalendarClock, CalendarDays, CalendarPlus, CalendarRange, Car, ChevronRight, CirclePlus, ClipboardCheck, ClipboardList, Clock, ConciergeBell, Contact, DoorClosed, DoorOpen, FileChartColumn, FileText, Gift, Globe, HandCoins, HandPlatter, History, Hotel, Inbox, Landmark, Languages, Layers, LayoutDashboard, LayoutGrid, MessageSquareText, NotebookText, Presentation, QrCode, Receipt, ReceiptText, ScrollText, Settings, ShieldCheck, Smartphone, Sofa, Tags, TrendingUp, UserCog, Users, UtensilsCrossed, Wallet, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavSection } from "./nav-config";
import { useT } from "@/i18n/client";

const ICONS: Record<string, LucideIcon> = {
  Activity, Armchair, ArrowLeftRight, Banknote, BanknoteArrowUp, BarChart3, Coins, BedDouble, BookOpenText, Boxes, Building2, BusFront, CalendarCheck, CalendarClock, CalendarDays, CalendarPlus, CalendarRange, Car, CirclePlus, ClipboardCheck, ClipboardList, Clock, ConciergeBell, Contact, DoorClosed, DoorOpen, FileChartColumn, FileText, Gift, Globe, HandCoins, HandPlatter, History, Hotel, Inbox, Landmark, Languages, Layers, LayoutDashboard, LayoutGrid, MessageSquareText, NotebookText, Presentation, QrCode, Receipt, ReceiptText, ScrollText, Settings, ShieldCheck, Smartphone, Sofa, Tags, TrendingUp, UserCog, Users, UtensilsCrossed, Wallet,
};

const STORE = "vlh-staff-nav";

/** What this person last opened or closed on this device ({ "Front desk": true, … }). Never breaks the menu: storage can be blocked or empty. */
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

/**
 * Staff sidebar navigation: a Home row (the user's own dashboard), then the hotel's groups. Each group is a row with its icon, a small-caps
 * name and a chevron — tap it to show or hide its pages (indented on a guide line). With more than one group:
 *  - the group that holds the page you are on is open (and opens by itself when you go to a page inside a closed one);
 *  - what you open or close is remembered on this device;
 *  - a closed group still shows the red count of what waits inside it (e.g. new online bookings), so nothing is hidden from you.
 * A group with just one page is a plain row (no folding, no chevron) — like Search or Customers in the Target console. One group
 * only (the restaurant, the Developer's console): no folding — its pages are simply listed.
 * Small and tight on purpose (owner, 2026-11-06: "small and nice, just like Target Express"): 13px rows, 11px small-caps group names.
 */
export function StaffNav({ sections, home, onNavigate }: { sections: NavSection[]; home?: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const t = useT();
  const uid = useId();
  const all = sections.flatMap((s) => s.items.map((i) => i.href));
  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  // Most specific match wins (e.g. /staff/reports/daily over /staff/reports).
  const isActive = (href: string) => matches(href) && !all.some((o) => o.length > href.length && o.startsWith(href) && matches(o));
  const homeActive = home ? pathname === home : false;
  // Titles and labels stay English in nav-config (sorting, comparisons); shown here in this person's language —
  // a "nav::" catalog key where the same word means something else on other screens ("Online", "Book").

  const folding = sections.length > 1;
  const activeTitle = sections.find((s) => s.items.some((i) => isActive(i.href)))?.title;
  // What the person chose (read after the first paint, so the server's and the browser's first drawing match), and the group a
  // navigation opened by itself (not remembered).
  const [choices, setChoices] = useState<Record<string, boolean>>({});
  const [revealed, setRevealed] = useState<string | null>(activeTitle ?? null);
  const [seenActive, setSeenActive] = useState(activeTitle);
  const [animate, setAnimate] = useState(false);
  if (seenActive !== activeTitle) { // went to a page in another group: that group opens (adjusted while drawing, not in an effect)
    setSeenActive(activeTitle);
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

  const row = "flex items-center gap-2.5 rounded-lg px-2.5 py-1.5 text-[13px] transition-colors";
  const rowOn = "bg-[oklch(0.96_0.035_85)] font-semibold text-slate-900 dark:bg-gold/15 dark:text-white";
  const rowOff = "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white";

  const pages = (section: NavSection, single: boolean) => (
    <ul className={cn("space-y-0.5", !single && "ml-[1.05rem] border-l border-slate-200 pb-0.5 pl-2 pt-0.5 dark:border-white/10")}>
      {section.items.map((item) => {
        const Icon = ICONS[item.icon] ?? LayoutDashboard;
        const active = isActive(item.href);
        return (
          <li key={item.href} className="relative">
            {active && !single && <span className="absolute -left-[9px] top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[oklch(0.72_0.12_80)]" aria-hidden />}
            <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn(row, active ? rowOn : rowOff)}>
              <Icon className={cn("size-[15px] shrink-0", active ? "text-[oklch(0.6_0.12_78)]" : "text-slate-400")} />
              <span className="flex-1 truncate">{t.ctx("nav", item.label)}</span>
              {item.badge ? <span className="rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold tabular-nums text-white" aria-label={t("{n} new", { n: item.badge })}>{item.badge}</span> : null}
            </Link>
          </li>
        );
      })}
    </ul>
  );

  return (
    <nav aria-label={t("Staff navigation")} className={folding ? "space-y-0.5" : "space-y-5"}>
      {home && (
        <Link href={home} onClick={onNavigate} aria-current={homeActive ? "page" : undefined}
          className={cn(row, "font-medium", folding && "mb-1.5 py-2", homeActive ? rowOn : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white")}>
          <LayoutGrid className={cn("size-[15px] shrink-0", homeActive ? "text-[oklch(0.6_0.12_78)] dark:text-[oklch(0.8_0.11_82)]" : "text-slate-400")} />{t("Home")}
        </Link>
      )}
      {sections.map((section, n) => {
        const SIcon = ICONS[section.icon] ?? LayoutDashboard;
        // Only one part of the hotel (e.g. the restaurant): no heading — the items right under Home. (The Developer console is also
        // only one section and has no Home pill above it, so its first item is NOT pulled up under the header.)
        const single = sections.length === 1 && !section.titled;
        if (!folding) {
          return (
            <div key={section.title} className={cn(single && home && "-mt-4")}>
              {!single && (
                <p className="mb-1.5 flex items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                  <SIcon className="size-3.5" />{t.ctx("nav", section.title)}
                </p>
              )}
              {pages(section, single)}
            </div>
          );
        }
        if (section.items.length === 1) {
          // A group with one page is that page, as a plain row.
          const item = section.items[0];
          const Icon = ICONS[item.icon] ?? SIcon;
          const active = isActive(item.href);
          return (
            <Link key={section.title} href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined} className={cn(row, "font-medium", active ? rowOn : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white")}>
              <Icon className={cn("size-[15px] shrink-0", active ? "text-[oklch(0.6_0.12_78)] dark:text-[oklch(0.8_0.11_82)]" : "text-slate-400")} />
              <span className="flex-1 truncate">{t.ctx("nav", item.label)}</span>
              {item.badge ? <span className="rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold tabular-nums text-white" aria-label={t("{n} new", { n: item.badge })}>{item.badge}</span> : null}
            </Link>
          );
        }
        const open = isOpen(section.title);
        const waiting = section.items.reduce((sum, i) => sum + (i.badge ?? 0), 0);
        const here = section.title === activeTitle;
        const head = `${uid}-h${n}`;
        const panel = `${uid}-p${n}`;
        return (
          <div key={section.title}>
            <button type="button" id={head} aria-expanded={open} aria-controls={panel} onClick={() => toggle(section.title)}
              className={cn("flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[oklch(0.72_0.12_80)]/60",
                here ? "text-slate-800 dark:text-white" : "text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white", "hover:bg-slate-100 dark:hover:bg-white/5")}>
              <SIcon className={cn("size-[15px] shrink-0", here ? "text-[oklch(0.6_0.12_78)] dark:text-[oklch(0.8_0.11_82)]" : "text-slate-400")} />
              <span className="flex-1 truncate">{t.ctx("nav", section.title)}</span>
              {!open && waiting > 0 && <span className="rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold normal-case tracking-normal tabular-nums text-white" aria-label={t("{n} new", { n: waiting })}>{waiting}</span>}
              {!open && here && waiting === 0 && <span className="size-1.5 rounded-full bg-[oklch(0.72_0.12_80)]" aria-hidden />}
              <ChevronRight className={cn("size-3.5 shrink-0 text-slate-400", animate && "transition-transform duration-200 motion-reduce:transition-none", open && "rotate-90")} aria-hidden />
            </button>
            {/* Closed: height 0 and inert (no focus, no reading by a screen reader); the grid-rows slide needs no measuring. */}
            <div id={panel} role="group" aria-labelledby={head} inert={!open}
              className={cn("grid", animate && "transition-[grid-template-rows] duration-200 ease-out motion-reduce:transition-none", open ? "grid-rows-[1fr]" : "grid-rows-[0fr]")}>
              <div className="min-h-0 overflow-hidden">{pages(section, false)}</div>
            </div>
          </div>
        );
      })}
    </nav>
  );
}
