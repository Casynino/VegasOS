import type { Metadata } from "next";
import Link from "next/link";
import {
  Ban, BedDouble, Coins, FileClock, HandCoins, LayoutDashboard, type LucideIcon, Receipt, Store, Trophy, UsersRound, UtensilsCrossed, Wallet, CalendarDays, Boxes,
} from "lucide-react";
import { requirePagePermission } from "@/server/auth";
import { businessToday, getSettings } from "@/server/settings";
import { buildReport } from "@/server/services/reports";
import { PeriodPicker, readPeriod } from "@/components/staff/finance/finance-nav";
import { REPORTS, type ReportKey } from "@/lib/report-types";
import { cn } from "@/lib/utils";
import { formatDateRange } from "@/lib/format";
import { ReportDocument } from "./report-document";
import { ReportActions } from "./report-actions";

export const metadata: Metadata = { title: "Reports" };
export const dynamic = "force-dynamic";

const ICON: Record<ReportKey, LucideIcon> = {
  summary: LayoutDashboard, daily: CalendarDays, restaurant: UtensilsCrossed, items: Trophy, payments: Wallet, outstanding: HandCoins,
  tables: Store, rooms: BedDouble, staff: UsersRound, voids: Ban, expenses: Receipt, stores: Boxes,
};

/**
 * REPORTS — every business report as a clean document: the whole business, daily sales, the
 * restaurant & bar, best sellers, payments, what is owed, tables, rooms, staff, cancellations and
 * expenses, for any hotel day or period. Opens on today's whole-business report. Print it on A4,
 * save it as a PDF, open it in Excel, or share the summary.
 */
export default async function ReportsPage({ searchParams }: PageProps<"/staff/reports">) {
  const user = await requirePagePermission("reports.view");
  const sp = await searchParams;
  const [today, s] = await Promise.all([businessToday(), getSettings()]);
  const p = readPeriod(sp, today, "today");
  const key = (REPORTS.find((x) => x.key === sp.r)?.key ?? "summary") as ReportKey;
  const report = await buildReport(key, { from: p.from, to: p.to }, today);

  const now = new Date();
  const preparedAt = new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: s.timezone }).format(now);
  const number = `RPT-${p.from.replaceAll("-", "")}${p.to !== p.from ? `-${p.to.replaceAll("-", "")}` : ""}-${key.toUpperCase().slice(0, 4)}`;
  const periodQs: Record<string, string> = p.key === "custom" ? { from: p.from, to: p.to } : { period: p.key };
  const href = (r: ReportKey) => `?${new URLSearchParams({ r, ...periodQs })}`;
  const fileName = `${s.hotelName.replace(/[^\w]+/g, "-")}-${report.title.replace(/[^\w]+/g, "-")}-${p.from}${p.to !== p.from ? `-to-${p.to}` : ""}`.toLowerCase();
  const csv = `/api/reports/csv?${new URLSearchParams({ r: key, from: p.from, to: p.to })}`;
  const hotel = {
    name: s.hotelName, tagline: s.tagline,
    address: [s.postalAddress, s.addressLine, s.city, s.country].filter(Boolean).join(", "),
    contact: [s.phone, s.email, s.website].filter(Boolean).join("  ·  "),
  };

  return (
    <div className="w-full space-y-5 print:space-y-0">
      <style>{"@media print { @page { size: A4; margin: 8mm; } html, body, #staff-root { background: #fff !important; } }"}</style>

      {/* Slim header */}
      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card print:hidden">
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[oklch(0.78_0.12_80)]/70 to-transparent" />
        <div aria-hidden className="pointer-events-none absolute -left-16 -top-20 size-56 rounded-full bg-[oklch(0.75_0.12_80/0.10)] blur-3xl" />
        <div className="relative flex flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-[oklch(0.84_0.11_85)] to-[oklch(0.62_0.12_65)] text-[#1b1611] shadow-[0_10px_24px_-12px_oklch(0.7_0.12_75)]"><FileClock className="size-6" /></span>
            <div className="min-w-0">
              <p className="truncate text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">Reports · {user.roleName}</p>
              <h1 className="truncate text-lg font-semibold leading-tight tracking-tight sm:text-xl">{report.title}</h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-muted-foreground">
                <span className="font-medium tabular-nums text-foreground/85">{formatDateRange(p.from, p.to)}</span>
                <span className="hidden sm:inline">· Print it, save it as a PDF, open it in Excel or share it ·</span>
                <Link href="/staff/reports/daily" className="hidden font-medium text-foreground hover:underline sm:inline">daily WhatsApp reports</Link>
              </p>
            </div>
          </div>
          <ReportActions fileName={fileName} csv={csv} share={`${s.hotelName}\n${report.share}`} />
        </div>
      </section>

      {/* Which report — one bar, like the finance tabs */}
      <nav aria-label="Reports" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none] print:hidden">
        <div className="flex min-w-max gap-1 rounded-2xl border border-border/70 bg-card p-1">
          {REPORTS.map((r) => {
            const Icon = ICON[r.key];
            return (
              <Link key={r.key} href={href(r.key)} aria-current={r.key === key ? "page" : undefined} title={r.blurb}
                className={cn("flex flex-1 items-center justify-center gap-1.5 whitespace-nowrap rounded-xl px-3 py-2 text-xs font-semibold transition-colors",
                  r.key === key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                <Icon className="size-3.5" />{r.label}
              </Link>
            );
          })}
        </div>
      </nav>

      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <PeriodPicker current={p.key} from={p.from} to={p.to} keep={{ r: key }} />
        {key === "outstanding" && <p className="flex items-center gap-1.5 text-xs text-muted-foreground"><Coins className="size-3.5" />Outstanding is always as of now — the period does not change it.</p>}
      </div>

      <ReportDocument report={report} hotel={hotel} preparedBy={`${user.fullName.replace(/\s*\(.*\)/, "")} · ${user.roleName}`} preparedAt={preparedAt} number={number} />
    </div>
  );
}
