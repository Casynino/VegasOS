import Link from "next/link";
import { ArrowRight, ChartColumn, LogIn, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";
import { CONSOLE_HREF, type ConsoleTab } from "@/server/services/developer-console";

/** The three shortcuts under the health card: the console's other pages. */
export function Shortcuts({ t }: { t: T }) {
  const cards = [
    { href: CONSOLE_HREF.access, icon: LogIn, title: t("Open Access (work as someone)"), text: t("Open the dashboard of the Boss, a manager or a team member to help them or to see what they see. Every click is recorded under your name.") },
    { href: CONSOLE_HREF.audit, icon: ScrollText, title: t("Open Audit"), text: t("The permanent diary of everything done in the system — by staff and by you. It can never be edited or deleted.") },
    { href: CONSOLE_HREF.business, icon: ChartColumn, title: t("Open Business"), text: t("See bookings, payments, stock and customers in read-only tables. Good for checking a number without risking a change.") },
  ];
  return (
    <nav aria-label={t("Console pages")} className="grid gap-3 md:grid-cols-3">
      {cards.map((c) => (
        <Link key={c.href} href={c.href} className="group flex gap-3.5 rounded-2xl border border-border/70 bg-card p-4 transition-colors hover:border-[oklch(0.72_0.12_80/0.5)] hover:bg-muted/40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[oklch(0.72_0.12_80/0.16)] text-[oklch(0.5_0.11_75)] dark:text-[oklch(0.84_0.11_82)]"><c.icon className="size-5" aria-hidden /></span>
          <span className="min-w-0">
            <span className="flex items-center gap-1.5 text-sm font-semibold text-foreground">{c.title}<ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden /></span>
            <span className="mt-1 block text-[13px] leading-relaxed text-muted-foreground">{c.text}</span>
          </span>
        </Link>
      ))}
    </nav>
  );
}

export interface TabBadge { text: string; tone: "ok" | "warn" }

/** The five parts of the console as links (each one is its own address: ?tab=…#console-tabs, so pressing one brings the tab bar to the top and the part below it into view). */
export function TabNav({ t, active, badges }: { t: T; active: ConsoleTab; badges: Partial<Record<ConsoleTab, TabBadge>> }) {
  const tabs: { key: ConsoleTab; label: string }[] = [
    { key: "activity", label: t("Activity") },
    { key: "speed", label: t("Speed & size") },
    { key: "crashes", label: t("Crashes & sign-ins") },
    { key: "settings", label: t("Settings") },
    { key: "people", label: t("People & my actions") },
  ];
  return (
    <nav id="console-tabs" aria-label={t("Parts of the console")} className="-mx-1 flex scroll-mt-24 gap-2 overflow-x-auto px-1 py-1 [scrollbar-width:none]">
      {tabs.map((tab) => {
        const on = tab.key === active;
        const badge = badges[tab.key];
        return (
          <Link
            key={tab.key} href={`${CONSOLE_HREF.home}?tab=${tab.key}#console-tabs`} aria-current={on ? "page" : undefined}
            className={cn("inline-flex h-10 shrink-0 items-center gap-2 rounded-full px-4 text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
              on ? "bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] font-semibold text-[oklch(0.2_0.03_60)] shadow-[0_8px_22px_-12px_oklch(0.7_0.12_80)]" : "border border-border/70 bg-card text-foreground/85 hover:bg-muted/60")}
          >
            {tab.label}
            {badge && <span className={cn("rounded-full px-1.5 text-[11px] font-semibold tabular-nums leading-5", on ? "bg-black/10" : badge.tone === "warn" ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : "bg-muted text-muted-foreground")}>{badge.text}</span>}
          </Link>
        );
      })}
    </nav>
  );
}
