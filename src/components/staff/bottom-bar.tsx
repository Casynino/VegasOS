"use client";

import { useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { CalendarDays, ChevronRight, Home, Inbox, LogOut, Menu, Search } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { StaffNav } from "./staff-nav";
import { Initials } from "@/components/dashboard/kit";
import { logoutAction } from "@/app/staff/(auth)/login/actions";
import { useT } from "@/i18n/client";
import type { NavSection } from "./nav-config";

/** Phone navigation: a flat bottom tab bar (Home · Find · Bookings · Requests · Menu). */
export function StaffBottomBar({ home, sections, requests, canBook, user, signOut = true }: {
  home: string; sections: NavSection[]; requests: number; canBook: boolean; user: { name: string; role: string };
  /** Not on the shared restaurant screen (it stays signed in; sign it out in My account). */
  signOut?: boolean;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const t = useT();
  const tabs = [
    { href: home, label: t("Home"), icon: Home, exact: true },
    { href: "/staff/search", label: t("Find"), icon: Search },
    ...(canBook ? [{ href: "/staff/reservations", label: t("Bookings"), icon: CalendarDays }, { href: "/staff/booking-requests", label: t.ctx("nav", "Online"), icon: Inbox, badge: requests }] : []),
  ];
  const tab = "relative flex flex-1 flex-col items-center gap-1 pb-1 pt-2.5 text-[11px] font-medium";
  return (
    <nav aria-label={t("Quick navigation")} className="fixed inset-x-0 bottom-0 z-40 print:hidden border-t border-border bg-card/95 pb-[env(safe-area-inset-bottom)] backdrop-blur-xl lg:hidden">
      <div className="flex">
        {tabs.map((tb) => {
          const active = "exact" in tb ? pathname === tb.href : pathname.startsWith(tb.href);
          const I = tb.icon;
          return (
            <Link key={tb.href} href={tb.href} aria-current={active ? "page" : undefined} className={cn(tab, active ? "text-[oklch(0.55_0.11_75)]" : "text-muted-foreground")}>
              {active && <span className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-[oklch(0.72_0.12_80)]" />}
              <I className="size-5" />
              {tb.label}
              {"badge" in tb && tb.badge ? <span className="absolute left-1/2 top-1.5 ml-2 grid min-w-4 place-items-center rounded-full bg-rose-500 px-1 text-[9px] font-bold text-white">{tb.badge}</span> : null}
            </Link>
          );
        })}
        <Sheet open={open} onOpenChange={setOpen}>
          <SheetTrigger render={<button type="button" className={cn(tab, "text-muted-foreground")} />}>
            <Menu className="size-5" />{t("Menu")}
          </SheetTrigger>
          <SheetContent side="left" className="flex w-72 flex-col bg-card p-4 text-foreground">
            <SheetHeader className="px-0"><SheetTitle className="font-display text-xl text-[oklch(0.55_0.1_75)] dark:text-gold">Vegas Luxury Hotel</SheetTitle></SheetHeader>
            <div className="-mx-1 min-h-0 flex-1 overflow-y-auto px-1"><StaffNav sections={sections} home={home} onNavigate={() => setOpen(false)} /></div>
            <div className="space-y-2.5 border-t border-dashed border-border pt-3">
              <Link href="/staff/account" onClick={() => setOpen(false)} className="flex items-center gap-3 rounded-2xl bg-muted p-2.5">
                <Initials name={user.name} className="size-9 text-xs" />
                <span className="min-w-0 flex-1 leading-tight"><span className="block truncate text-sm font-semibold">{user.name}</span><span className="block truncate text-[11px] text-muted-foreground">{t(user.role)}</span></span>
                <ChevronRight className="size-4 text-muted-foreground" />
              </Link>
              {signOut && <form action={logoutAction}>
                <button type="submit" className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-border py-2.5 text-sm font-medium text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600">
                  <LogOut className="size-4" />{t("Sign out")}
                </button>
              </form>}
            </div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
