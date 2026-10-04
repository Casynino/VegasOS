import Link from "next/link";
import { cn } from "@/lib/utils";
import { addDays, isBusinessDate, presetRange, type BusinessDate, type PeriodPreset } from "@/lib/time/business-date";
import { formatBusinessDate, formatDateRange } from "@/lib/format";

const TABS = [
  { href: "/staff/finance", label: "Overview" },
  { href: "/staff/finance/accounts", label: "Accounts" },
  { href: "/staff/finance/ledger", label: "General ledger" },
  { href: "/staff/finance/receivables", label: "Who owes us" },
  { href: "/staff/finance/rooms", label: "Room performance" },
  { href: "/staff/finance/staff", label: "Staff activity" },
  { href: "/staff/finance/history", label: "Edit history" },
  { href: "/staff/expenses", label: "Expenses" },
  { href: "/staff/payments", label: "Income" },
  { href: "/staff/invoices", label: "Invoices" },
  { href: "/staff/corporate", label: "Companies" },
  { href: "/staff/reports/daily", label: "Daily reports" },
] as const;

/** What front-desk staff (ledger access, no full finance) can open — Accounts first. */
const LIMITED_TABS: { href: string; label: string }[] = [
  { href: "/staff/finance/accounts", label: "Accounts" }, { href: "/staff/finance/ledger", label: "General ledger" },
  { href: "/staff/expenses", label: "Expenses" }, { href: "/staff/payments", label: "Income" },
  { href: "/staff/invoices", label: "Invoices" }, { href: "/staff/corporate", label: "Companies" },
];

/** Tabs across every finance page (like one finance app) — always first on the page, in the same place. */
export function FinanceTabs({ active, limited, actions }: {
  active: string; /** Staff with ledger access only: just the pages they can open. */ limited?: boolean;
  /** The page's own buttons (New invoice, Export…), on the right of the bar — the bar is the page's title. */
  actions?: React.ReactNode;
}) {
  const tabs = limited ? LIMITED_TABS : TABS;
  const bar = (
    <nav aria-label="Finance" className="-mx-1 min-w-0 flex-1 overflow-x-auto px-1 pb-0.5 [scrollbar-width:none]">
      {/* As wide as the cards below; the tabs share the width (and scroll on a phone) */}
      <div className="flex w-full min-w-max items-center gap-0.5 rounded-2xl border border-border/70 bg-card p-1 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
        {tabs.map((t) => (
          <Link key={t.href} href={t.href} aria-current={active === t.href ? "page" : undefined}
            className={cn("flex-1 rounded-xl px-3 py-1.5 text-center text-[13px] font-medium whitespace-nowrap transition-colors",
              active === t.href ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
            {t.label}
          </Link>
        ))}
      </div>
    </nav>
  );
  if (!actions) return bar;
  return <div className="flex flex-wrap items-center gap-2">{bar}<div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div></div>;
}

export const PERIODS: { key: PeriodPreset | "custom"; label: string }[] = [
  { key: "today", label: "Today" }, { key: "yesterday", label: "Yesterday" }, { key: "week", label: "This week" },
  { key: "month", label: "This month" }, { key: "year", label: "This year" },
];

/** "All time": every hotel day up to today (only where a page offers it). */
export const ALL_TIME_FROM = "2000-01-01" as BusinessDate;

/**
 * Reads ?period= / ?from=&to= into a hotel-day range (04:00 → 04:00 days). `allTime` lets the page offer
 * "All time" (?period=all) — and use it as its fallback.
 */
export function readPeriod(sp: Record<string, string | string[] | undefined>, today: BusinessDate, fallback: PeriodPreset | "all" = "today", opts: { allTime?: boolean } = {}) {
  // One day (?day=) — the day pages (staff see one day at a time).
  if (typeof sp.day === "string" && isBusinessDate(sp.day)) return { key: "custom" as const, from: sp.day, to: sp.day };
  const from = typeof sp.from === "string" && isBusinessDate(sp.from) ? sp.from : null;
  const to = typeof sp.to === "string" && isBusinessDate(sp.to) ? sp.to : null;
  if (from && to) return { key: "custom" as const, from: from <= to ? from : to, to: from <= to ? to : from };
  // "All time" shows no start date: only an end date given means "from the start up to then".
  if (!from && to && opts.allTime) return { key: "custom" as const, from: ALL_TIME_FROM, to };
  const asked = sp.period === "all" && opts.allTime ? "all" : PERIODS.find((p) => p.key === sp.period)?.key;
  const key = (asked ?? (fallback === "all" && !opts.allTime ? "today" : fallback)) as PeriodPreset | "all";
  if (key === "all") return { key, from: ALL_TIME_FROM, to: today };
  return { key, ...presetRange(key, today) };
}

export function periodLabel(r: { key?: string; from: BusinessDate; to: BusinessDate }) {
  if (r.key === "all") return "All time";
  return r.from === r.to ? formatBusinessDate(r.from, true) : formatDateRange(r.from, r.to);
}

/** Period buttons + custom dates. `keep` = other query params to preserve; `allTime` adds "All time"; `dayOnly`: one day at a time (Today, Yesterday or a date). */
export function PeriodPicker({ current, from, to, keep = {}, allTime, dayOnly }: { current: string; from: BusinessDate; to: BusinessDate; keep?: Record<string, string>; allTime?: boolean; dayOnly?: boolean }) {
  const qs = (extra: Record<string, string>) => `?${new URLSearchParams({ ...keep, ...extra })}`;
  const periods = dayOnly ? PERIODS.slice(0, 2) : allTime ? [...PERIODS, { key: "all", label: "All time" }] : PERIODS;
  if (dayOnly) {
    return (
      <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
        <div className="flex gap-1 rounded-xl bg-muted p-1">
          {periods.map((p) => (
            <Link key={p.key} href={qs({ period: p.key })}
              className={cn("rounded-lg px-3 py-1.5 text-xs font-medium", current === p.key ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>{p.label}</Link>
          ))}
        </div>
        <form className="flex items-center gap-1.5 text-xs">
          {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
          <input type="date" name="day" defaultValue={to} aria-label="Day" className="h-9 rounded-lg border border-border bg-card px-2 sm:h-8" />
          <button className="h-9 shrink-0 rounded-lg bg-foreground px-3 font-medium text-background sm:h-8">Show</button>
        </form>
      </div>
    );
  }
  return (
    <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto">
      {/* Phones: one row that slides sideways — never wider than the screen */}
      <div className="-mx-1 max-w-[calc(100%+0.5rem)] overflow-x-auto px-1 [scrollbar-width:none] sm:mx-0 sm:max-w-none sm:px-0">
      <div className="flex w-max gap-1 rounded-xl bg-muted p-1">
        {periods.map((p) => (
          <Link key={p.key} href={qs({ period: p.key })}
            className={cn("rounded-lg px-3 py-1.5 text-xs font-medium", current === p.key ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>{p.label}</Link>
        ))}
      </div>
      </div>
      <form className="flex w-full min-w-0 items-center gap-1.5 text-xs sm:w-auto">
        {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <input type="date" name="from" defaultValue={current === "all" ? undefined : from} aria-label="From" className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-2 sm:h-8 sm:flex-none" />
        <span className="text-muted-foreground">→</span>
        <input type="date" name="to" defaultValue={to} max={addDays(to, 3650)} aria-label="To" className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-card px-2 sm:h-8 sm:flex-none" />
        <button className="h-9 shrink-0 rounded-lg bg-foreground px-3 font-medium text-background sm:h-8">Show</button>
      </form>
    </div>
  );
}
