import Link from "next/link";
import { ArrowRight, ChartColumn, ScrollText } from "lucide-react";
import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";
import { CONSOLE_HREF, type ConsoleTab } from "@/server/services/developer-console";
import type { RoleChoice } from "./access/add-account-dialog";
import { AddAccountCard, WorkAsCard, type PersonChoice } from "./home-dialogs";
import { TILE, TILE_ICON } from "./tile-style";

/** The four quick actions under the greeting: Work as and Add an account open a popup; Audit and Business are the console's other pages. */
export function Shortcuts({ t, people = [], roles = [] }: { t: T; people?: PersonChoice[]; roles?: RoleChoice[] }) {
  const links = [
    { href: CONSOLE_HREF.audit, icon: ScrollText, title: t("Audit"), text: t("Who did what, and when") },
    { href: CONSOLE_HREF.business, icon: ChartColumn, title: t("Business"), text: t("Read-only hotel tables") },
  ];
  return (
    <nav aria-label={t("Quick actions")} className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <WorkAsCard people={people} />
      <AddAccountCard roles={roles} />
      {links.map((c) => (
        <Link key={c.href} href={c.href} className={TILE}>
          <span className={TILE_ICON}><c.icon aria-hidden /></span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-semibold text-foreground">{c.title}</span>
            <span className="mt-0.5 block truncate text-xs text-muted-foreground">{c.text}</span>
          </span>
          <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
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
