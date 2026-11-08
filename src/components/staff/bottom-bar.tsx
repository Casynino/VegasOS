"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BarChart3, CalendarDays, Home, Inbox, Menu, ScrollText, Search, ShieldCheck } from "lucide-react";
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { GlassSidebar, type SidebarProps } from "./glass-sidebar";
import { usePhoneMenu } from "./phone-menu";
import { useT } from "@/i18n/client";

/** Phone navigation: a flat bottom tab bar (Home · Find · Bookings · Requests · Menu). */
export function StaffBottomBar({ home, sidebar, requests, canBook, user, console: consoleMode = false }: {
  home: string; requests: number; canBook: boolean;
  /** The side menu, drawn in the drawer. */
  sidebar: SidebarProps;
  user: {
    name: string; role: string;
    /** A Developer account — the menu says so too. */
    developer?: boolean;
    /** The Developer is working as this person (name / role are theirs) — the menu says so, and the card is not a link to an account page that is not the Developer's. */
    workAs?: boolean;
  };
  /** The Developer's own console (not working as anyone): the tabs are the console's pages, not the hotel's. */
  console?: boolean;
}) {
  const pathname = usePathname();
  const { open, setOpen } = usePhoneMenu();
  const t = useT();
  const tabs = consoleMode
    ? [
      { href: home, label: t("Home"), icon: Home, exact: true },
      { href: "/staff/developer/audit", label: t.ctx("nav", "Audit"), icon: ScrollText },
      { href: "/staff/developer/business", label: t.ctx("nav", "Business"), icon: BarChart3 },
      { href: "/staff/developer/access", label: t.ctx("nav", "Access"), icon: ShieldCheck },
    ]
    : [
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
          {/* The drawer is only a frame (as in the owner's Target console): the glass panel inside it is the side menu, with its own round close button. */}
          <SheetContent side="left" showCloseButton={false} initialFocus={false}
            className="flex h-[100dvh] flex-col gap-0 border-0 bg-transparent pb-[max(0.75rem,env(safe-area-inset-bottom))] pl-3 pr-0 pt-[max(0.75rem,env(safe-area-inset-top))] text-foreground shadow-none data-[side=left]:w-[16.5rem] data-[side=left]:max-w-[84vw] data-[side=left]:sm:w-[19rem]">
            <SheetTitle className="sr-only">{t("Staff navigation")}</SheetTitle>
            {user.developer && user.workAs && <p className="mx-0 mb-2 rounded-xl bg-fuchsia-700 px-2.5 py-1.5 text-[11px] font-extrabold uppercase tracking-[0.12em] text-white">{t("DEVELOPER MODE — you are working as {name} ({role})", { name: user.name, role: t(user.role) })}</p>}
            <div className="min-h-0 flex-1"><GlassSidebar mode="sheet" sidebar={sidebar} onNavigate={() => setOpen(false)} onClose={() => setOpen(false)} /></div>
          </SheetContent>
        </Sheet>
      </div>
    </nav>
  );
}
