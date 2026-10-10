import Link from "next/link";
import {
  AlertTriangle, BedDouble, Building2, CheckCircle2, ChevronRight, CupSoda, Landmark, Percent, Presentation, Receipt, Tag, UtensilsCrossed, Users, Wallet,
} from "lucide-react";
import { db } from "@/server/db";
import { change, dailyMoney, guestMovement, occupancy, onTheBooks, outstanding, previousRange, profitLoss, restaurantSummary, stayPatterns, topCustomers } from "@/server/services/reporting";
import { paymentsByMethod } from "@/server/services/finance";
import { accountSummaries } from "@/server/services/payment-accounts";
import { diningMoney } from "@/server/services/restaurant";
import { addDays, diffDays, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { Delta, Panel, PanelLink } from "@/components/dashboard/kit";
import { Donut } from "@/components/dashboard/light-charts";
import { FinanceTabs, PeriodPicker, periodLabel } from "@/components/staff/finance/finance-nav";
import { MoneyChart, type MoneyPoint } from "@/components/staff/finance/money-chart";

/** One colour per income stream — the same in the ring, the bars and the legend. */
const STREAM = ["#8b5cf6", "#0ea5e9", "#10b981", "#d6a64a", "#f43f5e", "#94a3b8", "#f97316"];
const money = (v: number) => formatTZS(v).replace("TZS ", "");
const pct = (part: number, whole: number) => (whole > 0 ? Math.round((part / whole) * 100) : 0);
/** "29 Sept" / "9月29日" — a day and month, in the reader's language. */
const short = (d: BusinessDate, t: T) => new Intl.DateTimeFormat(t.intl, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/**
 * Finance overview — the whole money picture for a hotel day or period, in detail but calm:
 * the four headline figures against the period before, the hotel's key numbers, day by day
 * (earned, spent, received), where income comes from and where money goes, rooms by type and
 * by booking source, the restaurant & bar, who owes the hotel, and what to follow up.
 * Income is counted on the night / day it is earned; money received is payments + on-the-spot
 * sales − refunds on the day they happen — a payment settles a debt, it is never income twice.
 */
type Period = { key: string; from: BusinessDate; to: BusinessDate };

/** The Finance → Overview page: its header, tabs and period, then the whole business picture. */
export async function FinanceOverview({ p, today }: { p: Period; /** The hotel day now (for "overdue" and "today"). */ today: BusinessDate }) {
  return (
    <BusinessDetail p={p} today={today} full chrome={
      <>
        <FinanceTabs active="/staff/finance" />
        <div className="flex justify-end">
          <PeriodPicker current={p.key} from={p.from} to={p.to} />
        </div>
      </>
    } />
  );
}

/**
 * The business in detail, for a period — on Finance → Overview (`full`: with the four headline
 * figures, the income ring and what needs attention) and at the bottom of the manager's and the
 * MD's home (without them: the home has its own).
 */
export async function BusinessDetail({ p, today, full = false, chrome }: { p: Period; today: BusinessDate; full?: boolean; /** Under the banner (full): tabs, period. */ chrome?: React.ReactNode }) {
  const t = await getT();
  const range = { from: p.from, to: p.to };
  const prev = previousRange(range);
  const days = diffDays(p.from, p.to) + 1;
  // The chart: the period itself when it is a week or more, else the two weeks up to it.
  const trendRange = days >= 7 ? range : { from: addDays(p.to, -13), to: p.to };

  const [pl, plPrev, occ, occPrev, received, receivedPrev, owed, accounts, rooms, pendingExp, openCounts, overdueInv, overdueGuests, dining, trend, food, foodPrev, unpaidFood, movement, patterns, ahead, topSpenders] = await Promise.all([
    profitLoss(range), profitLoss(prev), occupancy(range), occupancy(prev), paymentsByMethod(p.from, p.to), paymentsByMethod(prev.from, prev.to), outstanding(),
    accountSummaries(p.from, p.to),
    db.room.groupBy({ by: ["status"], where: { isActive: true }, _count: true }),
    db.expense.aggregate({ where: { status: "PENDING_APPROVAL" }, _count: true, _sum: { amount: true } }),
    db.cashCount.count({ where: { status: "OPEN" } }),
    db.invoice.aggregate({ where: { balanceAmount: { gt: 0 }, dueDate: { lt: toDbDate(today) }, status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } }, _count: true, _sum: { balanceAmount: true } }),
    db.reservationRoom.count({ where: { status: "CHECKED_IN", endAt: { lt: new Date() } } }),
    diningMoney(today),
    dailyMoney(trendRange),
    restaurantSummary(range), restaurantSummary(prev),
    // Restaurant orders not on a room bill and not fully paid — money the restaurant is still owed.
    db.restaurantOrder.aggregate({ where: { status: { not: "CANCELLED" }, settlement: { not: "ROOM" } }, _sum: { total: true, paidAmount: true } }),
    guestMovement(range), stayPatterns(range), onTheBooks(today), topCustomers(range),
  ]);

  // ── The headline figures ──
  const rev = pl.revenue, revPrev = plPrev.revenue;
  const income = pl.netRevenue, net = income - pl.expenses, netPrev = plPrev.netRevenue - plPrev.expenses;
  const margin = income > 0 ? Math.round((net / income) * 100) : null;
  const vs = days === 1 ? t("the day before") : t("the period before");
  const adr = rev.rooms.roomsSold ? Math.round(rev.rooms.net / rev.rooms.roomsSold) : 0;
  const adrPrev = revPrev.rooms.roomsSold ? Math.round(revPrev.rooms.net / revPrev.rooms.roomsSold) : 0;
  const revpar = occ.sellableNights ? Math.round(rev.rooms.net / occ.sellableNights) : 0;
  const revparPrev = occPrev.sellableNights ? Math.round(revPrev.rooms.net / occPrev.sellableNights) : 0;
  const giveaways = rev.rooms.discount + rev.refunds;

  // ── Day by day (months for long periods) ──
  const byMonth = trend.length > 62;
  const points: MoneyPoint[] = byMonth
    ? [...new Set(trend.map((d) => d.date.slice(0, 7)))].map((m) => {
      const rows = trend.filter((d) => d.date.startsWith(m));
      return { key: m, label: new Date(`${m}-01T00:00:00Z`).toLocaleDateString(t.intl, { month: "short", timeZone: "UTC" }), income: rows.reduce((s, d) => s + d.income, 0), expenses: rows.reduce((s, d) => s + d.expenses, 0), received: rows.reduce((s, d) => s + d.received, 0) };
    })
    : trend.map((d) => ({ key: d.date, label: short(d.date, t), income: d.income, expenses: d.expenses, received: d.received }));
  const best = [...points].sort((a, b) => b.income - a.income)[0];
  const trendIncome = points.reduce((s, d) => s + d.income, 0);

  // ── Where it comes from / where it goes ──
  const streams = [
    { label: t("Rooms"), value: rev.rooms.net, before: revPrev.rooms.net, icon: BedDouble },
    { label: t("Restaurant"), value: rev.restaurant, before: revPrev.restaurant, icon: UtensilsCrossed },
    { label: t("Bar"), value: rev.bar, before: revPrev.bar, icon: CupSoda },
    { label: t("Meeting room"), value: rev.meeting, before: revPrev.meeting, icon: Presentation },
    { label: t("Room service"), value: rev.roomService, before: revPrev.roomService, icon: Receipt },
    { label: t("Transport"), value: rev.transport, before: revPrev.transport, icon: Tag },
    { label: t("Other services"), value: rev.other, before: revPrev.other, icon: Tag },
  ].map((s, i) => ({ ...s, color: STREAM[i] }));
  const grossStreams = streams.reduce((s, x) => s + x.value, 0);
  const expenses = pl.expenseSummary;
  const accountsShown = accounts.filter((a) => a.isActive || a.count > 0);
  const receivedIn = accounts.reduce((s, a) => s + a.moneyIn, 0);
  const unpaidFoodTotal = Math.max(0, (unpaidFood._sum.total ?? 0) - (unpaidFood._sum.paidAmount ?? 0));
  const statusCount = (s: string[]) => rooms.filter((r) => s.includes(r.status)).reduce((n, r) => n + r._count, 0);

  const alerts = [
    overdueInv._count > 0 && { text: t.plural(overdueInv._count, "{n} company invoice overdue", "{n} company invoices overdue"), amount: overdueInv._sum.balanceAmount ?? 0, href: "/staff/finance/receivables" },
    pendingExp._count > 0 && { text: t.plural(pendingExp._count, "{n} expense waiting for approval", "{n} expenses waiting for approval"), amount: pendingExp._sum.amount ?? 0, href: "/staff/expenses?status=PENDING_APPROVAL" },
    openCounts > 0 && { text: t.plural(openCounts, "{n} cash count with a difference to settle", "{n} cash counts with a difference to settle"), amount: null, href: "/staff/finance/accounts" },
    overdueGuests > 0 && { text: t.plural(overdueGuests, "{n} guest past checkout time", "{n} guests past checkout time"), amount: null, href: "/staff/check-out" },
  ].filter(Boolean) as { text: string; amount: number | null; href: string }[];
  const periodQs = p.key === "custom" ? `from=${p.from}&to=${p.to}` : `period=${p.key}`;

  return (
    <div className="w-full space-y-5">
      {full && chrome}

      {/* ── 1 · One slim line: earned − spent = result, and how much of it came in ── */}
      {full && (() => {
        const came = pct(received.total, income);
        const R = 20, C = 2 * Math.PI * R;
        return (
          <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card">
            <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[oklch(0.78_0.12_80)]/70 to-transparent" />
            <div className="grid items-center gap-x-6 gap-y-4 px-5 py-4 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">{t("Finance")}</p>
                <h1 className="text-lg font-semibold leading-tight tracking-tight">{periodLabel(range, t)}</h1>
                <p className="text-[11px] text-muted-foreground">{t("vs {period}", { period: periodLabel(prev, t) })}</p>
              </div>

              {/* earned − spent = result */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2 lg:justify-center">
                <Sum t={t} label={t("Earned")} value={income} before={plPrev.netRevenue} dot="bg-violet-500" href={`/staff/finance/ledger?view=income&from=${p.from}&to=${p.to}`} />
                <span aria-hidden className="text-lg font-light text-muted-foreground">−</span>
                <Sum t={t} label={t.ctx("finance", "Spent")} value={pl.expenses} before={plPrev.expenses} dot="bg-rose-500" invert href={`/staff/finance/ledger?view=expense&from=${p.from}&to=${p.to}`} />
                <span aria-hidden className="text-lg font-light text-muted-foreground">=</span>
                <Sum t={t} label={net >= 0 ? `${t.ctx("finance", "Result")}${margin !== null ? ` · ${t("{pct}% kept", { pct: margin })}` : ""}` : t("Loss")} value={Math.abs(net)} before={netPrev > 0 ? netPrev : 0} dot={net >= 0 ? "bg-emerald-500" : "bg-rose-500"}
                  strong tone={net >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"} />
              </div>

              {/* how much of it came in */}
              <Link href={`/staff/finance/ledger?view=money&from=${p.from}&to=${p.to}`} className="flex items-center gap-3 rounded-2xl px-1 transition-colors hover:bg-muted/40 lg:justify-end">
                <svg viewBox="0 0 48 48" className="size-12 shrink-0 -rotate-90" role="img" aria-label={t("{pct}% of what was earned came in", { pct: came })}>
                  <circle cx="24" cy="24" r={R} fill="none" stroke="var(--muted)" strokeWidth="5" />
                  <circle cx="24" cy="24" r={R} fill="none" stroke="url(#came-in)" strokeWidth="5" strokeLinecap="round" strokeDasharray={`${(Math.min(100, came) / 100) * C} ${C}`} />
                  <defs><linearGradient id="came-in" x1="0" y1="0" x2="1" y2="1"><stop offset="0%" stopColor="#0ea5e9" /><stop offset="100%" stopColor="#10b981" /></linearGradient></defs>
                  <text x="24" y="24" transform="rotate(90 24 24)" textAnchor="middle" dominantBaseline="central" className="fill-foreground text-[11px] font-semibold">{came}%</text>
                </svg>
                <span className="leading-tight">
                  <span className="block text-[11px] text-muted-foreground">{t("Came in")}</span>
                  <span className="flex items-baseline gap-1.5 font-semibold tabular-nums">{formatTZS(received.total)}{receivedPrev.total > 0 && <Delta value={change(received.total, receivedPrev.total)} />}</span>
                  <span className="block text-[11px] text-muted-foreground">{t("Owed")} <span className="font-semibold text-rose-600 tabular-nums dark:text-rose-400">{money(owed.total + unpaidFoodTotal)}</span></span>
                </span>
              </Link>
            </div>
          </section>
        );
      })()}

      {/* ── 2 · The hotel's key numbers, one strip ── */}
      <section className="grid grid-cols-2 overflow-hidden rounded-3xl border border-border/70 bg-card sm:grid-cols-3 xl:grid-cols-6 [&>div]:border-border/60 [&>div]:p-4 [&>div]:border-b xl:[&>div]:border-b-0 [&>div:not(:last-child)]:border-r">
        <Figure label={t("Occupancy")} value={`${Math.round(occ.occupancy)}%`} sub={t("{n} of {total} room-nights", { n: occ.roomNights, total: occ.sellableNights })} delta={occPrev.sellableNights ? occ.occupancy - occPrev.occupancy : null} unit={` ${t("pts")}`} />
        <Figure label={t("Average room rate")} value={money(adr)} sub={t("Room income ÷ rooms sold")} delta={adrPrev > 0 ? change(adr, adrPrev) : null} />
        <Figure label={t("Income per room")} value={money(revpar)} sub={t("Room income ÷ rooms available (RevPAR)")} delta={revparPrev > 0 ? change(revpar, revparPrev) : null} />
        <Figure label={t("Rooms sold")} value={String(occ.roomsSold)} sub={t("{nights} nights · {short} short time", { nights: occ.roomNights, short: occ.dayUse })} delta={occPrev.roomsSold > 0 ? change(occ.roomsSold, occPrev.roomsSold) : null} />
        <Figure label={t("Restaurant orders")} value={String(food.orders)} sub={food.orders ? t("average order {amount}", { amount: money(food.averageOrder) }) : t("none in this period")} delta={foodPrev.orders > 0 ? change(food.orders, foodPrev.orders) : null} />
        <Figure label={t("Discounts & refunds")} value={money(giveaways)} sub={giveaways ? t("{pct}% of gross income", { pct: pct(giveaways, grossStreams) }) : t("none given")} />
      </section>

      {/* ── 3 · Day by day + income mix ── */}
      <div className={cn("grid gap-5", full && "xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]")}>
        <Panel title={byMonth ? t("Month by month") : t("Day by day")} subtitle={`${periodLabel(trendRange, t)}${days < 7 ? ` · ${t("the last two weeks, for context")}` : ""}`}
          action={<PanelLink href={`/staff/finance/ledger?from=${trendRange.from}&to=${trendRange.to}`}>{t("Ledger")}</PanelLink>}>
          <MoneyChart data={points} />
          <div className="mt-4 grid grid-cols-1 gap-1 border-t border-dashed border-border pt-3 text-sm sm:grid-cols-3 sm:gap-3">
            <Mini label={byMonth ? t("Average month") : t("Average day")} value={formatTZS(points.length ? Math.round(trendIncome / points.length) : 0)} />
            <Mini label={byMonth ? t("Best month") : t("Best day")} value={best && best.income > 0 ? formatTZS(best.income) : "—"} sub={best && best.income > 0 ? best.label : undefined} />
            <Mini label={t("Result over this chart")} value={formatTZS(points.reduce((s, d) => s + d.income - d.expenses, 0))} />
          </div>
        </Panel>
        {full && (
          <Panel title={t("Where income comes from")} subtitle={periodLabel(range, t)}>
            <Donut colors={STREAM} center={{ label: t("earned"), value: money(income) }} data={streams.map((s) => ({ name: s.label, value: s.value }))} />
          </Panel>
        )}
      </div>

      {/* ── 4 · In and out, in detail ── */}
      <div className="grid gap-5 xl:grid-cols-3">
        <Panel title={t("Income by source")} subtitle={t("Against {what}", { what: vs })} action={<PanelLink href={`/staff/finance/ledger?view=income&from=${p.from}&to=${p.to}`}>{t.ctx("finance", "Items")}</PanelLink>}>
          <ul className="space-y-3">
            {streams.map((s) => (
              <li key={s.label} className="text-sm">
                <div className="mb-1 flex items-center justify-between gap-2">
                  <span className="flex min-w-0 items-center gap-2"><span className="size-2 shrink-0 rounded-full" style={{ background: s.color }} /><span className={cn("truncate", s.value ? "text-foreground" : "text-muted-foreground")}>{s.label}</span></span>
                  <span className="flex shrink-0 items-center gap-2 tabular-nums">
                    <span className={cn("font-semibold", !s.value && "text-muted-foreground")}>{money(s.value)}</span>
                    <span className="w-9 text-right text-xs text-muted-foreground">{pct(s.value, grossStreams)}%</span>
                  </span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full" style={{ width: `${pct(s.value, grossStreams)}%`, background: s.color }} /></div>
                {(s.value > 0 || s.before > 0) && <div className="mt-1"><Versus t={t} now={s.value} before={s.before} label={vs} /></div>}
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-1 border-t border-dashed border-border pt-3 text-sm">
            {rev.rooms.discount > 0 && <Line label={t("Room discounts & promotions")} value={`− ${formatTZS(rev.rooms.discount)}`} muted />}
            {rev.refunds > 0 && <Line label={t("Refunds")} value={`− ${formatTZS(rev.refunds)}`} muted />}
            <Line label={t("Total income")} value={formatTZS(income)} strong />
          </dl>
        </Panel>

        <Panel title={t("Where the money went")} subtitle={t("Expenses by category")} action={<PanelLink href="/staff/expenses">{t("All")}</PanelLink>}>
          {expenses.byCategory.length === 0 ? <p className="flex items-center gap-2 rounded-2xl bg-emerald-500/[0.07] px-3.5 py-3 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-4 shrink-0" />{t("No expenses in this period.")}</p> : (
            <ul className="space-y-3">
              {expenses.byCategory.map((c) => (
                <li key={c.categoryId} className="text-sm">
                  <div className="mb-1 flex justify-between gap-2"><span className="min-w-0 leading-snug">{t(c.name)}</span>
                    <span className="flex shrink-0 gap-2 tabular-nums"><span className="font-semibold">{money(c.amount)}</span><span className="w-9 text-right text-xs text-muted-foreground">{pct(c.amount, pl.expenses)}%</span></span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-rose-500" style={{ width: `${pct(c.amount, pl.expenses)}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
          {expenses.highValue.length > 0 && (
            <div className="mt-4 border-t border-dashed border-border pt-3">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("Biggest")}</p>
              <ul className="space-y-1.5 text-sm">
                {expenses.highValue.map((e) => (
                  <li key={e.id} className="flex justify-between gap-3"><span className="min-w-0 leading-snug text-muted-foreground">{e.description || t(e.category.name)}</span><span className="shrink-0 tabular-nums">{formatTZS(e.amount)}</span></li>
                ))}
              </ul>
            </div>
          )}
          <dl className="mt-4 space-y-1 border-t border-dashed border-border pt-3 text-sm">
            {expenses.pending.count > 0 && <Line label={t("Waiting for approval ({n})", { n: expenses.pending.count })} value={formatTZS(expenses.pending.amount)} muted />}
            <Line label={t("Total expenses")} value={formatTZS(pl.expenses)} strong />
          </dl>
        </Panel>

        <Panel title={t("Where the money came in")} subtitle={t("Received, by payment account")} action={<PanelLink href={`/staff/finance/accounts?${periodQs}`}>{t("Accounts")}</PanelLink>}>
          <ul className="space-y-2 text-sm">
            {accountsShown.map((a) => (
              <li key={a.id}>
                <Link href={`/staff/finance/accounts/${a.id}?${periodQs}`} className="flex items-center justify-between gap-3 rounded-xl px-1 py-0.5 hover:bg-muted/50">
                  <span className="flex min-w-0 items-center gap-2.5">
                    <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground [&_svg]:size-3.5">{a.kind === "BANK" ? <Landmark /> : a.kind === "CASH" || a.kind === "PETTY_CASH" ? <Wallet /> : <Receipt />}</span>
                    <span className="min-w-0 leading-tight"><span className="block truncate">{t(a.name)}</span>
                      <span className="text-[11px] text-muted-foreground">{t.plural(a.count, "{n} transaction", "{n} transactions")}{a.moneyOut ? ` · ${t("out {amount}", { amount: money(a.moneyOut) })}` : ""}</span></span>
                  </span>
                  <span className={cn("shrink-0 font-semibold tabular-nums", a.moneyIn ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>{money(a.moneyIn)}</span>
                </Link>
              </li>
            ))}
          </ul>
          <dl className="mt-4 space-y-1 border-t border-dashed border-border pt-3 text-sm">
            <Line label={t("Received through all accounts")} value={formatTZS(receivedIn)} strong />
            <Line label={t("Earned but not paid in this period")} value={formatTZS(Math.max(0, income - received.total))} muted />
          </dl>
        </Panel>
      </div>

      {/* ── 5 · Rooms in detail ── */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        <Panel title={t("Rooms by type")} subtitle={`${periodLabel(range, t)} · ${t("right now {inUse} in use, {free} free, {cleaning} cleaning, {repair} under repair", { inUse: statusCount(["OCCUPIED"]), free: statusCount(["AVAILABLE", "READY"]), cleaning: statusCount(["DIRTY", "CLEANING"]), repair: statusCount(["MAINTENANCE", "OUT_OF_SERVICE"]) })}`}
          action={<PanelLink href={`/staff/finance/rooms?from=${p.from}&to=${p.to}`}>{t("Room by room")}</PanelLink>} bodyClassName="-mx-4 sm:-mx-6">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 pb-2 font-medium sm:px-6">{t("Type")}</th><th className="pb-2 text-right font-medium">{t.ctx("rooms", "Sold")}</th><th className="hidden pb-2 text-right font-medium sm:table-cell">{t("Nights")}</th>
                <th className="pb-2 text-right font-medium">{t("Average rate")}</th><th className="hidden pb-2 text-right font-medium sm:table-cell">{t("Discounts")}</th><th className="pb-2 pr-4 text-right font-medium sm:pr-6">{t("Income")}</th>
              </tr></thead>
              <tbody className="divide-y divide-border/60">
                {rev.byType.map((rt) => (
                  <tr key={rt.roomTypeId} className={cn(!rt.roomsSold && "text-muted-foreground")}>
                    <td className="px-4 py-2.5 sm:px-6"><span className="flex items-center gap-2"><BedDouble className="size-3.5 text-muted-foreground" />{t(rt.name)}</span></td>
                    <td className="text-right tabular-nums">{rt.roomsSold}</td>
                    <td className="hidden text-right tabular-nums sm:table-cell">{rt.roomNights}</td>
                    <td className="text-right tabular-nums">{rt.averageRate ? money(rt.averageRate) : "—"}</td>
                    <td className="hidden text-right tabular-nums sm:table-cell">{rt.discount ? `− ${money(rt.discount)}` : "—"}</td>
                    <td className="pr-4 text-right font-semibold tabular-nums sm:pr-6">{money(rt.net)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot><tr className="border-t border-border font-semibold">
                <td className="px-4 pt-2.5 sm:px-6">{t("All rooms")}</td><td className="pt-2.5 text-right tabular-nums">{rev.rooms.roomsSold}</td><td className="hidden pt-2.5 text-right tabular-nums sm:table-cell">{occ.roomNights}</td>
                <td className="pt-2.5 text-right tabular-nums">{adr ? money(adr) : "—"}</td><td className="hidden pt-2.5 text-right tabular-nums sm:table-cell">{rev.rooms.discount ? `− ${money(rev.rooms.discount)}` : "—"}</td>
                <td className="pr-4 pt-2.5 text-right tabular-nums sm:pr-6">{money(rev.rooms.net)}</td>
              </tr></tfoot>
            </table>
          </div>
        </Panel>
        <Panel title={t("Where bookings come from")} subtitle={t("Room income by booking source")}>
          {rev.bySource.length === 0 ? <p className="text-sm text-muted-foreground">{t("No rooms sold in this period.")}</p> : (
            <ul className="space-y-3">
              {rev.bySource.map((s) => (
                <li key={s.sourceId} className="text-sm">
                  <div className="mb-1 flex justify-between gap-2"><span className="truncate">{t(s.name)} <span className="text-xs text-muted-foreground">· {t.plural(s.roomNights, "{n} night", "{n} nights")}</span></span>
                    <span className="flex shrink-0 gap-2 tabular-nums"><span className="font-semibold">{money(s.net)}</span><span className="w-9 text-right text-xs text-muted-foreground">{pct(s.net, rev.rooms.net)}%</span></span></div>
                  <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-violet-500" style={{ width: `${pct(s.net, rev.rooms.net)}%` }} /></div>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ── 5b · Guests & bookings · coming up · how guests pay ── */}
      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <Panel title={t("Guests & bookings")} subtitle={periodLabel(range, t)} action={<PanelLink href="/staff/reservations">{t("Stays")}</PanelLink>}>
          <div className="grid grid-cols-3 gap-2">
            <Tile label={t("Checked in")} value={movement.checkIns} tone="text-emerald-600 dark:text-emerald-400" />
            <Tile label={t("Checked out")} value={movement.checkOuts} tone="text-sky-600 dark:text-sky-300" />
            <Tile label={t("New bookings")} value={movement.newBookings} tone="text-violet-600 dark:text-violet-300" />
            <Tile label={t("Cancelled")} value={movement.cancellations} tone={movement.cancellations ? "text-rose-600 dark:text-rose-400" : undefined} />
            <Tile label={t("No-show")} value={movement.noShows} tone={movement.noShows ? "text-rose-600 dark:text-rose-400" : undefined} />
            <Tile label={t("In the hotel now")} value={movement.inHouse} tone="text-amber-600 dark:text-amber-300" />
          </div>
          <dl className="mt-4 space-y-1 border-t border-dashed border-border pt-3 text-sm">
            <Line label={t("Guests stay, on average")} value={patterns.stays ? t.plural(patterns.averageNights >= 1.05 ? 2 : 1, "{n} night", "{n} nights", { n: patterns.averageNights.toFixed(1) }) : "—"} muted />
            <Line label={t("They book ahead, on average")} value={patterns.stays ? (patterns.averageLeadDays < 1 ? t("same day") : t.plural(Math.round(patterns.averageLeadDays), "{n} day", "{n} days")) : "—"} muted />
            <Line label={t("People per booking")} value={patterns.stays ? patterns.averageGuests.toFixed(1) : "—"} muted />
          </dl>
        </Panel>

        <Panel title={t("Coming up")} subtitle={t("Rooms already booked for the next 14 nights")} action={<PanelLink href="/staff/reservations/calendar">{t("Calendar")}</PanelLink>}>
          <div className="flex h-36 items-end gap-1" role="img" aria-label={ahead.series.map((d) => t("{date}: {rooms} of {total} rooms", { date: short(d.date, t), rooms: d.rooms, total: ahead.activeRooms })).join("; ")}>
            {ahead.series.map((d, i) => {
              const full = ahead.activeRooms ? d.rooms / ahead.activeRooms : 0;
              const wd = new Date(`${d.date}T00:00:00Z`).toLocaleDateString(t.intl, { weekday: "narrow", timeZone: "UTC" });
              return (
                <div key={d.date} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end" title={t("{date} — {rooms} of {total} rooms booked · {amount}", { date: short(d.date, t), rooms: d.rooms, total: ahead.activeRooms, amount: formatTZS(d.amount) })}>
                  <span className="mb-1 text-[10px] tabular-nums text-muted-foreground">{d.rooms || ""}</span>
                  <span className={cn("w-full max-w-5 rounded-t-md", i === 0 ? "bg-[oklch(0.72_0.12_80)]" : full >= 0.8 ? "bg-emerald-500" : full >= 0.4 ? "bg-sky-500" : "bg-violet-500/70")}
                    style={{ height: `${Math.max(4, full * 100)}%`, opacity: d.rooms ? 1 : 0.25 }} />
                  <span className={cn("mt-1 text-[10px]", i === 0 ? "font-bold text-foreground" : "text-muted-foreground")}>{i === 0 ? t("T") : wd}</span>
                </div>
              );
            })}
          </div>
          <dl className="mt-4 space-y-1 border-t border-dashed border-border pt-3 text-sm">
            <Line label={t("Tonight")} value={t("{rooms} of {total} rooms", { rooms: ahead.series[0]?.rooms ?? 0, total: ahead.activeRooms })} muted />
            <Line label={t("Next 14 nights")} value={t("{n} room-nights · {amount}", { n: ahead.series.reduce((s, d) => s + d.rooms, 0), amount: formatTZS(ahead.series.reduce((s, d) => s + d.amount, 0)) })} muted />
            <Line label={t("Next 30 days, already booked")} value={formatTZS(ahead.next30.amount)} strong />
          </dl>
        </Panel>

        <Panel title={t("How guests pay")} subtitle={t("Money received, by way of paying")} className="lg:col-span-2 xl:col-span-1">
          {received.rows.every((r) => r.amount <= 0) ? <p className="text-sm text-muted-foreground">{t("Nothing received in this period.")}</p> : (
            <Donut center={{ label: t("received"), value: money(received.total) }} data={received.rows.filter((r) => r.amount > 0).map((r) => ({ name: t(r.method), value: r.amount }))} />
          )}
        </Panel>
      </div>

      {/* ── 6 · Restaurant & bar · best customers · who owes the hotel ── */}
      <div className="grid gap-5 lg:grid-cols-2 xl:grid-cols-3">
        <Panel title={t("Restaurant & bar")} subtitle={periodLabel(range, t)} action={<PanelLink href="/staff/restaurant/history">{t("History")}</PanelLink>}>
          <div className="grid grid-cols-3 divide-x divide-border/70 rounded-2xl border border-border/70 text-center">
            <Mini label={t("Orders worth")} value={money(food.sales)} center />
            <Mini label={t("Orders")} value={String(food.orders)} center />
            <Mini label={t("Average order")} value={food.orders ? money(food.averageOrder) : "—"} center />
          </div>
          {food.best.length > 0 && (
            <div className="mt-4">
              <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("Best sellers")}</p>
              <ol className="space-y-1.5 text-sm">
                {food.best.map((b, i) => (
                  <li key={`${b.name}-${i}`} className="flex items-center gap-2.5">
                    <span className="grid size-6 shrink-0 place-items-center rounded-lg bg-muted text-[11px] font-semibold tabular-nums text-muted-foreground">{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{t(b.name)} <span className="text-xs text-muted-foreground">× {b.quantity}</span></span>
                    <span className="shrink-0 tabular-nums">{money(b.amount)}</span>
                  </li>
                ))}
              </ol>
            </div>
          )}
          <dl className="mt-4 space-y-1 border-t border-dashed border-border pt-3 text-sm">
            <Line label={t("On guests' room bills · {n} staying", { n: dining.onRooms.length })} value={formatTZS(dining.onRoomsTotal)} muted />
            <Line label={t("Pay-later orders not paid · {n}", { n: dining.unpaid.length })} value={formatTZS(dining.unpaidTotal)} muted />
            <Line label={t("Received today")} value={formatTZS(dining.receivedTotal)} muted />
            <Line label={t("Still to come in")} value={formatTZS(dining.onRoomsTotal + dining.unpaidTotal)} strong />
          </dl>
        </Panel>

        <Panel title={t("Best customers")} subtitle={`${t("Who spent the most")} · ${periodLabel(range, t)}`} action={<PanelLink href="/staff/guests">{t("Customers")}</PanelLink>}>
          {topSpenders.length === 0 ? <p className="text-sm text-muted-foreground">{t("No spending recorded in this period yet.")}</p> : (
            <ol className="space-y-2.5 text-sm">
              {topSpenders.map((c, i) => (
                <li key={c.id}>
                  <Link href={`/staff/guests/${c.id}`} className="flex items-center gap-3 rounded-2xl px-1 py-0.5 transition-colors hover:bg-muted/50">
                    <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl text-xs font-bold tabular-nums", i === 0 ? "bg-[oklch(0.72_0.12_80)]/20 text-[oklch(0.55_0.12_78)] dark:text-[#f0cf86]" : "bg-muted text-muted-foreground")}>{i + 1}</span>
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="flex items-center gap-1.5 font-medium"><span className="truncate">{c.name}</span>{c.vip && <span className="shrink-0 rounded-full bg-[oklch(0.75_0.13_80)]/20 px-1.5 text-[9px] font-bold text-[oklch(0.5_0.12_75)] dark:text-[#f0cf86]">VIP</span>}</span>
                      <span className="block text-xs text-muted-foreground">{[c.rooms ? t("rooms {amount}", { amount: money(c.rooms) }) : null, c.food ? t("food & drinks {amount}", { amount: money(c.food) }) : null].filter(Boolean).join(" · ")}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{money(c.total)}</span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
        </Panel>

        <Panel title={t("Who owes the hotel")} subtitle={t("Right now — whatever the period")} className="lg:col-span-2 xl:col-span-1" action={<PanelLink href="/staff/finance/receivables">{t("Who owes us")}</PanelLink>}>
          <ul className="space-y-2.5 text-sm">
            <Owe icon={Users} tone="bg-rose-500/12 text-rose-600 dark:text-rose-300" label={t("Guests")} sub={t.plural(owed.reservations.count, "{n} stay with a balance (staying or left)", "{n} stays with a balance (staying or left)")} amount={owed.reservations.amount} href="/staff/finance/receivables" />
            <Owe icon={Building2} tone="bg-violet-500/12 text-violet-600 dark:text-violet-300" label={t("Companies")} sub={`${t.plural(owed.invoices.count, "{n} invoice not fully paid", "{n} invoices not fully paid")}${overdueInv._count ? ` · ${t("{n} overdue", { n: overdueInv._count })}` : ""}`} amount={owed.invoices.amount} href="/staff/finance/receivables" />
            <Owe icon={Presentation} tone="bg-amber-500/12 text-amber-600 dark:text-amber-300" label={t("Meeting room")} sub={t.plural(owed.meetings.count, "{n} booking with a balance", "{n} bookings with a balance")} amount={owed.meetings.amount} href="/staff/meeting-room" />
            <Owe icon={UtensilsCrossed} tone="bg-sky-500/12 text-sky-600 dark:text-sky-300" label={t("Restaurant")} sub={t("Pay-later orders not paid yet")} amount={unpaidFoodTotal} href="/staff/restaurant" />
          </ul>
          <dl className="mt-4 border-t border-dashed border-border pt-3 text-sm">
            <Line label={t("Owed to the hotel")} value={formatTZS(owed.total + unpaidFoodTotal)} strong tone="text-rose-600 dark:text-rose-400" />
          </dl>
        </Panel>
      </div>

      {/* ── 7 · To follow up ── */}
      {full && <Panel title={t("Needs attention")} subtitle={t("Things to follow up")}>
        {alerts.length === 0 ? <p className="flex items-center gap-2 text-sm text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-4" />{t("All clear — nothing overdue, nothing waiting.")}</p> : (
          <ul className="grid gap-2 md:grid-cols-2">
            {alerts.map((a) => (
              <li key={a.text}>
                <Link href={a.href} className="group flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] px-3.5 py-2.5 text-sm transition-colors hover:bg-amber-500/10">
                  <AlertTriangle className="size-4 shrink-0 text-amber-500" />
                  <span className="min-w-0 flex-1 leading-snug">{a.text}</span>
                  {a.amount !== null && <span className="shrink-0 font-semibold tabular-nums">{formatTZS(a.amount)}</span>}
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>}

      {full && <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><Percent className="size-3.5" />{t("Income is what the hotel earned; money received is what actually came in. A payment only settles what a guest owes — it is never counted as income twice. Figures come straight from bookings, orders, payments and expenses recorded by staff.")}</p>}
    </div>
  );
}

/** Against the period before — or plainly "new" when there was nothing then to compare with. */
function Versus({ now, before, label, invert, t }: { now: number; before: number; label: string; invert?: boolean; t: T }) {
  if (before <= 0) return <span className="text-xs text-muted-foreground">{now > 0 ? t("New — nothing {when}", { when: label }) : t("Nothing {when} either", { when: label })}</span>;
  return <Delta value={change(now, before)} label={label} invert={invert} />;
}

function Tile({ label, value, tone }: { label: string; value: number; tone?: string }) {
  return (
    <div className="rounded-2xl border border-border/70 px-2.5 py-2">
      <p className={cn("text-lg font-semibold tabular-nums", tone)}>{value}</p>
      <p className="text-[11px] leading-tight text-muted-foreground">{label}</p>
    </div>
  );
}

/** One figure of the slim line — earned, spent or the result — with its change since the period before. */
function Sum({ label, value, before, dot, tone, invert, strong, href, t }: {
  label: string; value: number; before: number; dot: string; tone?: string; invert?: boolean; strong?: boolean; href?: string; t: T;
}) {
  const body = (
    <>
      <span className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={cn("size-1.5 rounded-full", dot)} />{label}</span>
      <span className="flex items-baseline gap-2">
        <span className={cn("font-semibold tabular-nums tracking-tight", strong ? "text-2xl" : "text-xl", tone)}>{money(value)}</span>
        {before > 0 ? <Delta value={change(value, before)} invert={invert} /> : value > 0 ? <span className="text-[10px] text-muted-foreground">{t.ctx("finance", "new")}</span> : null}
      </span>
    </>
  );
  const cls = "flex min-w-0 flex-col rounded-2xl px-2 py-1 leading-tight";
  return href ? <Link href={href} className={cn(cls, "transition-colors hover:bg-muted/40")}>{body}</Link> : <div className={cls}>{body}</div>;
}

function Figure({ label, value, sub, delta, unit = "%" }: { label: string; value: string; sub?: string; delta?: number | null; unit?: string }) {
  return (
    <div className="min-w-0">
      <p className="truncate text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{sub}</p>}
      {typeof delta === "number" && <div className="mt-1"><Delta value={delta} unit={unit} /></div>}
    </div>
  );
}

function Mini({ label, value, sub, center }: { label: string; value: string; sub?: string; center?: boolean }) {
  return (
    <div className={cn("min-w-0 px-2 py-2", center && "text-center")}>
      <p className="text-[11px] leading-snug text-muted-foreground">{label}</p>
      <p className="font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function Line({ label, value, strong, muted, tone }: { label: string; value: string; strong?: boolean; muted?: boolean; tone?: string }) {
  return (
    <div className={cn("flex justify-between gap-3", strong && "font-semibold", muted && "text-muted-foreground")}>
      <dt className="min-w-0 leading-snug">{label}</dt><dd className={cn("shrink-0 text-right tabular-nums", tone)}>{value}</dd>
    </div>
  );
}

function Owe({ icon: Icon, tone, label, sub, amount, href }: { icon: typeof Users; tone: string; label: string; sub: string; amount: number; href: string }) {
  return (
    <li>
      <Link href={href} className="flex items-center gap-3 rounded-2xl px-1 py-1 transition-colors hover:bg-muted/50">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", tone)}><Icon className="size-4" /></span>
        <span className="min-w-0 flex-1 leading-tight"><span className="block font-medium">{label}</span><span className="block text-xs leading-snug text-muted-foreground">{sub}</span></span>
        <span className={cn("shrink-0 font-semibold tabular-nums", amount > 0 ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>{formatTZS(amount)}</span>
      </Link>
    </li>
  );
}
