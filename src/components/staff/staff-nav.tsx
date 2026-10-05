"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Activity, Armchair, ArrowLeftRight, Banknote, BarChart3, Coins, BedDouble, BookOpenText, Boxes, Building2, BusFront, CalendarCheck, CalendarClock, CalendarDays, CalendarPlus, CalendarRange, Car, CirclePlus, ClipboardCheck, ClipboardList, Clock, ConciergeBell, Contact, DoorClosed, DoorOpen, FileChartColumn, FileText, Globe, HandCoins, HandPlatter, History, Hotel, Inbox, Landmark, Layers, LayoutDashboard, LayoutGrid, MessageSquareText, NotebookText, Presentation, QrCode, Receipt, ReceiptText, Settings, ShieldCheck, Smartphone, Sofa, Tags, TrendingUp, UserCog, Users, UtensilsCrossed, Wallet, type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { NavSection } from "./nav-config";

const ICONS: Record<string, LucideIcon> = {
  Activity, Armchair, ArrowLeftRight, Banknote, BarChart3, Coins, BedDouble, BookOpenText, Boxes, Building2, BusFront, CalendarCheck, CalendarClock, CalendarDays, CalendarPlus, CalendarRange, Car, CirclePlus, ClipboardCheck, ClipboardList, Clock, ConciergeBell, Contact, DoorClosed, DoorOpen, FileChartColumn, FileText, Globe, HandCoins, HandPlatter, History, Hotel, Inbox, Landmark, Layers, LayoutDashboard, MessageSquareText, NotebookText, Presentation, QrCode, Receipt, ReceiptText, Settings, ShieldCheck, Smartphone, Sofa, Tags, TrendingUp, UserCog, Users, UtensilsCrossed, Wallet,
};

/**
 * Staff sidebar navigation: a Home pill (the user's own dashboard), then
 * groups with an icon + small caps label and their pages indented on a guide line.
 */
export function StaffNav({ sections, home, onNavigate }: { sections: NavSection[]; home?: string; onNavigate?: () => void }) {
  const pathname = usePathname();
  const all = sections.flatMap((s) => s.items.map((i) => i.href));
  const matches = (href: string) => pathname === href || pathname.startsWith(`${href}/`);
  // Most specific match wins (e.g. /staff/reports/daily over /staff/reports).
  const isActive = (href: string) => matches(href) && !all.some((o) => o.length > href.length && o.startsWith(href) && matches(o));
  const homeActive = home ? pathname === home : false;

  return (
    <nav aria-label="Staff navigation" className="space-y-5">
      {home && (
        <Link href={home} onClick={onNavigate} aria-current={homeActive ? "page" : undefined}
          className={cn("flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm font-medium transition-colors",
            homeActive ? "bg-[oklch(0.96_0.035_85)] font-semibold text-slate-900 dark:bg-gold/15 dark:text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-300 dark:hover:bg-white/5 dark:hover:text-white")}>
          <LayoutGrid className={cn("size-4 shrink-0", homeActive ? "text-[oklch(0.6_0.12_78)] dark:text-[oklch(0.8_0.11_82)]" : "text-slate-400")} />Home
        </Link>
      )}
      {sections.map((section) => {
        const SIcon = ICONS[section.icon] ?? LayoutDashboard;
        // Only one part of the hotel (e.g. the restaurant): no heading — the items right under Home.
        const single = sections.length === 1;
        return (
          <div key={section.title} className={cn(single && "-mt-4")}>
            {!single && (
              <p className="mb-1.5 flex items-center gap-2 px-1 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">
                <SIcon className="size-3.5" />{section.title}
              </p>
            )}
            <ul className={cn("space-y-0.5", !single && "ml-3 border-l border-slate-200 pl-2 dark:border-white/10")}>
              {section.items.map((item) => {
                const Icon = ICONS[item.icon] ?? LayoutDashboard;
                const active = isActive(item.href);
                return (
                  <li key={item.href} className="relative">
                    {active && !single && <span className="absolute -left-[9px] top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-[oklch(0.72_0.12_80)]" aria-hidden />}
                    <Link href={item.href} onClick={onNavigate} aria-current={active ? "page" : undefined}
                      className={cn("flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-sm transition-colors",
                        active ? "bg-[oklch(0.96_0.035_85)] font-semibold text-slate-900 dark:bg-gold/15 dark:text-white" : "text-slate-500 hover:bg-slate-100 hover:text-slate-900 dark:text-slate-400 dark:hover:bg-white/5 dark:hover:text-white")}>
                      <Icon className={cn("size-4 shrink-0", active ? "text-[oklch(0.6_0.12_78)]" : "text-slate-400")} />
                      <span className="flex-1 truncate">{item.label}</span>
                      {item.badge ? <span className="rounded-full bg-rose-500 px-1.5 text-[11px] font-semibold tabular-nums text-white" aria-label={`${item.badge} new`}>{item.badge}</span> : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
