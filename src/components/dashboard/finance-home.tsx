import { Suspense } from "react";
import {
  AlertCircle, AlarmClock, BadgeCheck, Banknote, BarChart3, BedDouble, Building2, CalendarCheck, CircleDollarSign, ClipboardCheck, Clock, FileText, HandCoins, Landmark, LineChart, Receipt, ReceiptText, Scale, Smartphone, TrendingUp, Truck, Users, Wallet, Waypoints, BookOpenText,
} from "lucide-react";
import { requireUser } from "@/server/auth";
import { guideLabel } from "@/components/staff/guide-pill";
import type { PermissionCode } from "@/lib/permissions";
import { businessToday, getSettings, liveSinceDate } from "@/server/settings";
import { accountantOverview } from "@/server/services/accountant";
import { guestMovement, occupancy, previousRange, profitLoss, dailyMoney, onTheBooks, expenseSummary } from "@/server/services/reporting";
import { paymentsByMethod } from "@/server/services/finance";
import { onlinePaymentTotals } from "@/server/services/online-payments-admin";
import { receivablesBoard } from "@/server/services/company-billing";
import { financeNeeds, latestPayments, purchasesPanel, restaurantDiscounts, type FinanceNeed } from "@/server/services/finance-home";
import { receivablesAging, recentSpend } from "@/server/services/finance-outlook";
import { buildInsights } from "@/lib/finance-insights";
import { addDays, diffDays } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { CASH_HANDOVER_ON } from "@/lib/cash-handover";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";
import { PeriodPicker, periodLabel, readPeriod } from "@/components/staff/finance/finance-nav";
import { MoneyChart, type MoneyPoint } from "@/components/staff/finance/money-chart";
import { BusinessDetail } from "@/app/staff/(app)/finance/finance-overview";
import { AttentionCards, Delta, HeroBanner, Panel, PanelLink, QuickActions, SectionLabel, StatTile, type AttentionItem } from "./kit";
import { Donut } from "./light-charts";
import { DataTable, FigureCards, HBars, JumpNav, PartHeading, Pipeline } from "./finance-panels";
import { InsightsPanel, OutlookView } from "./finance-analysis";
import { AccountsPart, BookingsSection, compareKit, insightFactsOf, PartSkeleton, TrendsSection, type HomeContext } from "./finance-sections";

const shortDay = (d: string, t: T) => new Intl.DateTimeFormat(t.intl, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));

/**
 * Finance's Home — ONE page, everything on it, in the order a Finance person decides: a small banner, the jobs waiting, the figures
 * of the period against the one before, what stands out, where the money is, how it moves, what is owed and how late, what the
 * hotel owes and when, purchases, how the hotel is doing (six months, occupancy, the best days), bookings, the latest lines, and
 * the business in detail. The same look as the Boss's and the Manager's, about money only. Earned, received, still owed and the
 * account balances stay four different things and are never added together. Every figure comes from the shared money services,
 * so it always agrees with the ledger and the daily report; the parts that need many figures load by themselves under the rest.
 */
export async function FinanceHome({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const user = await requireUser();
  const t = await getT();
  const sp = await searchParams;
  const today = await businessToday();
  const p = readPeriod(sp, today, "month");
  const range = { from: p.from, to: p.to };
  const prev = previousRange(range);
  const days = diffDays(p.from, p.to) + 1;
  // Charts: the period itself when it is a week or more, otherwise the two weeks up to it.
  const trendRange = days >= 7 ? range : { from: addDays(p.to, -13), to: p.to };
  const todayRange = { from: today, to: today };
  const perms = user.permissions;
  const has = (...codes: PermissionCode[]) => codes.some((c) => perms.has(c));
  const handoverRights = CASH_HANDOVER_ON && has("cash.handover.view", "cash.handover.review");
  const buying = has("purchases.authorize", "purchases.pay", "procurement.manage");
  const live = liveSinceDate(await getSettings());
  // The records began on `live`. A period before that holds nothing; one that begins before it is only partly filled — neither is a fair
  // base for "up 50%", so nothing is said about the change then.
  const straddles = Boolean(live && prev.from < live && prev.to >= live);
  const prevHasRecords = !live || prev.to >= live;

  const [ov, plPrev, methodsPrev, movement, movementPrev, trend, needs, receivedToday, occToday, online, restDisc, purchases, spend, owing, payments, aging, pace, onBooks] = await Promise.all([
    accountantOverview(range, today),
    profitLoss(prev),
    paymentsByMethod(prev.from, prev.to),
    guestMovement(range),
    guestMovement(prev),
    dailyMoney(trendRange),
    financeNeeds(today, perms),
    paymentsByMethod(today, today),
    occupancy(todayRange),
    has("finance.view") ? onlinePaymentTotals(p.from, p.to) : null,
    restaurantDiscounts(range),
    buying ? purchasesPanel(today) : null,
    expenseSummary(range),
    has("finance.view", "corporate.view") ? receivablesBoard(today) : null,
    latestPayments(range),
    has("finance.view", "corporate.view") ? receivablesAging(today) : null,
    has("finance.view") ? recentSpend(today, live) : null,
    onTheBooks(today, 14),
  ]);

  // ── Figures of the period, each against the period before ──
  const { versus, vsLabel, sinceWords } = compareKit(t, p, days, straddles);
  const earned = ov.earned.total, expenses = ov.expenses.total, net = ov.netResult;
  const netPrev = plPrev.netRevenue - plPrev.expenses;
  const spark = (pick: (d: (typeof trend)[number]) => number) => trend.map(pick);
  const q = p.key === "custom" ? `from=${p.from}&to=${p.to}` : `period=${p.key}`;

  // ── The banner: today ──
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" }).format(new Date()));
  const first = user.fullName.split(" ")[0];
  const greeting = hour < 12 ? t("Good morning, {name}", { name: first }) : hour < 17 ? t("Good afternoon, {name}", { name: first }) : t("Good evening, {name}", { name: first });
  const owedNow = ov.owed.total;
  const attention = needs.map((n) => needCard(n, t));
  const href = (code: PermissionCode[], to: string) => (has(...code) ? to : undefined);
  const link = (code: PermissionCode[], to: string, label: string) => (has(...code) ? <PanelLink href={to}>{label}</PanelLink> : null);
  const count = (...kinds: FinanceNeed["kind"][]) => needs.filter((n) => kinds.includes(n.kind)).reduce((s, n) => s + n.count, 0);

  // ── Quick links: the jobs Finance does every day, each with what is waiting ──
  const quick = ([
    handoverRights && { href: "/staff/accountant/handovers", label: t("Cash handovers"), icon: <HandCoins />, tone: "gold" as const, badge: count("handoverWaiting") },
    has("purchases.authorize", "purchases.pay") && { href: "/staff/procurement", label: t("Purchases"), icon: <ClipboardCheck />, tone: "violet" as const, badge: count("authorize", "verify", "pay") },
    has("expenses.record", "expenses.view_all") && { href: "/staff/expenses", label: t("Expenses"), icon: <Receipt />, tone: "rose" as const, badge: count("expenses") },
    has("reports.view", "finance.view") && { href: "/staff/payments", label: t("Income"), icon: <Banknote />, tone: "emerald" as const },
    has("finance.view") && { href: "/staff/finance/receivables", label: t("Who owes us"), icon: <Wallet />, tone: "amber" as const, badge: count("companyOverdue", "guestsOwing") },
    has("ledger.view", "finance.view") && { href: "/staff/finance/ledger", label: t("General ledger"), icon: <Scale />, tone: "sky" as const },
    has("reports.view") && { href: "/staff/reports", label: t("Reports"), icon: <FileText />, tone: "teal" as const },
    // The guide book (Finance's own), one small pill at the end of the row.
    guideLabel(t, user.permissions) && { href: "/staff/guides", label: guideLabel(t, user.permissions)!, icon: <BookOpenText />, tone: "violet" as const, guide: true },
  ].filter(Boolean)) as { href: string; label: string; icon: React.ReactNode; tone: "gold" | "violet" | "rose" | "emerald" | "amber" | "sky" | "teal"; badge?: number; guide?: boolean }[];

  // ── The day-by-day chart (months for long periods) and the income mix ──
  const byMonth = trend.length > 62;
  const points: MoneyPoint[] = byMonth
    ? [...new Set(trend.map((d) => d.date.slice(0, 7)))].map((m) => {
      const rows = trend.filter((d) => d.date.startsWith(m));
      return { key: m, label: new Date(`${m}-01T00:00:00Z`).toLocaleDateString(t.intl, { month: "short", timeZone: "UTC" }), income: rows.reduce((s, d) => s + d.income, 0), expenses: rows.reduce((s, d) => s + d.expenses, 0), received: rows.reduce((s, d) => s + d.received, 0) };
    })
    : trend.map((d) => ({ key: d.date, label: shortDay(d.date, t), income: d.income, expenses: d.expenses, received: d.received }));
  const streams = [
    { name: t("Rooms"), value: ov.earned.rooms }, { name: t("Restaurant & room service"), value: ov.earned.restaurant }, { name: t("Bar"), value: ov.earned.bar },
    { name: t("Meeting room"), value: ov.earned.meeting }, { name: t("Transport & other"), value: ov.earned.other },
  ].filter((x) => x.value > 0);

  // ── What stands out: read from the figures of the page ──
  const canSeeAccounts = has("ledger.view", "finance.view");
  const moneyTotal = ov.balances.reduce((s, b) => s + b.balance, 0);
  // A day that is not over yet, or a few days against a longer stretch, does not make a fair comparison: say nothing about the change then.
  // Nor does a previous period that begins before the records did: it is only partly filled.
  const comparable = (p.to < today || days >= 7) && !straddles;
  const insights = buildInsights(insightFactsOf({ ov, plPrev, spend, aging, pace, suppliers: purchases?.suppliers ?? null, canSeeAccounts, comparable }));

  const ctx: HomeContext = { p, range, prev, days, today, live, straddles, prevHasRecords, has, ov, plPrev, spend };
  const jump = [
    { id: "money", label: t("The money"), icon: <CircleDollarSign /> },
    ...(insights.length ? [{ id: "stands-out", label: t("What stands out"), icon: <BadgeCheck /> }] : []),
    { id: "accounts", label: t("Where the money is"), icon: <Landmark /> },
    { id: "flow", label: t("Money in and out"), icon: <Waypoints /> },
    { id: "outlook", label: t("Cash outlook"), icon: <Clock /> },
    { id: "purchases", label: t("Purchases and more"), icon: <Truck /> },
    { id: "trends", label: t("How the hotel is doing"), icon: <LineChart /> },
    { id: "bookings", label: t("Bookings"), icon: <CalendarCheck /> },
    { id: "latest", label: t("The latest"), icon: <ReceiptText /> },
    { id: "detail", label: t("In detail"), icon: <BarChart3 /> },
  ];

  return (
    <div className="w-full space-y-6">
      <HeroBanner
        eyebrow={user.roleName === "Finance" ? t("Finance") : t("Finance · {role}", { role: t(user.roleName) })}
        title={greeting}
        subtitle={<>{t.rich("<b>{pct}%</b> of the guest rooms occupied today · <g>{received}</g> received today", {
          b: (c) => <strong className="font-semibold text-white">{c}</strong>, g: (c) => <strong className="font-semibold text-emerald-300">{c}</strong>,
        }, { pct: Math.round(occToday.occupancy), received: formatTZS(receivedToday.total) })}{owedNow > 0 && <> · {t.rich("<a>{owed}</a> still owed to the hotel", { a: (c) => <strong className="font-semibold text-amber-300">{c}</strong> }, { owed: formatTZS(owedNow) })}</>}</>}
      />

      {quick.length > 0 && <QuickActions t={t} items={quick} />}
      <JumpNav label={t("Jump to")} items={jump} />

      <div>
        <SectionLabel title={t("Needs your attention")} count={needs.length} t={t} />
        <AttentionCards items={attention} t={t} emptyTitle={t("Nothing is waiting for Finance")} emptyDetail={CASH_HANDOVER_ON ? t("No purchase to authorize, no invoice to pay, no handover to receive, nothing overdue.") : t("No purchase to authorize, no invoice to pay, nothing overdue.")} />
      </div>

      {/* ── The figures of the period ── */}
      <section id="money" className="scroll-mt-28">
        <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <h2 className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("The money · {period}", { period: periodLabel(p, t) })}</h2>
          <PeriodPicker current={p.key} from={p.from} to={p.to} />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          <StatTile label={t("Earned")} value={formatTZS(earned)} icon={<CircleDollarSign />} tone="violet" spark={spark((d) => d.income)}
            delta={versus(earned, plPrev.netRevenue)} sub={t("before anyone paid")} href={href(["reports.view"], `/staff/reports?${q}`)} />
          <StatTile label={t("Received")} value={formatTZS(ov.received.total)} icon={<Banknote />} tone="sky" spark={spark((d) => d.received)}
            delta={versus(ov.received.total, methodsPrev.total)} sub={t("less refunds")} href={href(["reports.view", "finance.view"], `/staff/payments?from=${p.from}&to=${p.to}`)} />
          <StatTile label={t("Expenses")} value={formatTZS(expenses)} icon={<Receipt />} tone="rose" spark={spark((d) => d.expenses)}
            delta={versus(expenses, plPrev.expenses, true)}
            sub={ov.expenses.pendingCount ? t.plural(ov.expenses.pendingCount, "{n} waiting for approval now", "{n} waiting for approval now") : t("recorded in the period")} href={href(["expenses.record", "expenses.view_all"], `/staff/expenses?from=${p.from}&to=${p.to}`)} />
          <StatTile label={t("Net result")} value={formatTZS(net)} icon={<TrendingUp />} tone={net >= 0 ? "emerald" : "rose"}
            delta={straddles ? null : netPrev > 0 ? <Delta value={(net - netPrev) / netPrev * 100} label={vsLabel} t={t} /> : net !== 0 || netPrev !== 0 ? <span className="text-xs text-muted-foreground">{t("{amount} {when}", { amount: formatTZS(netPrev), when: sinceWords })}</span> : null} sub={t("earned − expenses")} href={href(["ledger.view", "finance.view"], `/staff/finance/ledger?from=${p.from}&to=${p.to}`)} />
          <StatTile label={t("Still owed")} value={formatTZS(owedNow)} icon={<Wallet />} tone="amber"
            sub={t("right now, whatever the period")} href={href(["finance.view"], "/staff/finance/receivables")} />
          <StatTile label={t("Bookings made")} value={String(movement.newBookings)} icon={<ClipboardCheck />} tone="sky"
            delta={versus(movement.newBookings, movementPrev.newBookings)}
            sub={t.plural(movement.checkIns, "{n} room checked in", "{n} rooms checked in")} href={href(["reservations.view"], "/staff/reservations")} />
        </div>
      </section>

      {/* ── What stands out: the few things worth reading, from the figures on this page ── */}
      {insights.length > 0 && <div id="stands-out" className="scroll-mt-28"><InsightsPanel insights={insights} t={t} period={periodLabel(p, t)} /></div>}

      {/* ── Where the money is ── */}
      <section className="space-y-4">
        <PartHeading id="accounts" tone="sky" icon={<Landmark />} title={t("Where the money is")} subtitle={t("What the hotel's own records add up to — check it against the bank")} action={link(["ledger.view", "finance.view"], "/staff/finance/accounts", t("Accounts"))} />
        <AccountsPart t={t} ov={ov} canOpen={canSeeAccounts} canWithdraw={has("withdrawals.manage")} />
      </section>

      {/* ── Money in and out ── */}
      <section className="space-y-4">
        <PartHeading id="flow" tone="violet" icon={<Waypoints />} title={t("Money in and out")} subtitle={t("What was earned, what came in and what went out — day by day, and where it came from and went")} action={link(["ledger.view", "finance.view"], `/staff/finance/ledger?from=${trendRange.from}&to=${trendRange.to}`, t("Ledger"))} />
        <div className="grid gap-4 xl:grid-cols-[minmax(0,1.9fr)_minmax(0,1fr)]">
          <Panel level={3} title={byMonth ? t("Month by month") : t("Day by day")} subtitle={`${periodLabel(trendRange, t)}${days < 7 ? ` · ${t("the last two weeks, for context")}` : ""}`}>
            <MoneyChart data={points} />
          </Panel>
          <Panel level={3} title={t("Where income comes from")} subtitle={periodLabel(p, t)}>
            {streams.length === 0 ? <p className="text-sm text-muted-foreground">{t("Nothing was earned in this period.")}</p>
              : <Donut center={{ label: t("earned"), value: formatTZS(earned) }} data={streams} />}
            {ov.earned.refunds > 0 && <p className="mt-2 text-[11px] text-muted-foreground">{t("Refunds of {amount} are taken off the total.", { amount: formatTZS(ov.earned.refunds) })}</p>}
          </Panel>
        </div>
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel level={3} title={t("How the money came in")} subtitle={`${t("Received")} · ${periodLabel(p, t)}`} action={link(["reports.view", "finance.view"], `/staff/payments?from=${p.from}&to=${p.to}`, t("Income"))}>
            {ov.received.byMethod.length === 0 ? <p className="text-sm text-muted-foreground">{t("Nothing was received in this period.")}</p> : (
              <div className="grid items-center gap-4 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <Donut center={{ label: t("received"), value: formatTZS(ov.received.total) }} data={ov.received.byMethod.filter((m) => m.amount > 0).map((m) => ({ name: t(m.method), value: m.amount }))} />
                <HBars empty="" rows={ov.received.byAccount.filter((a) => a.received > 0).map((a) => ({ label: t(a.name), value: a.received, color: "#0ea5e9" }))} />
              </div>
            )}
          </Panel>
          <Panel level={3} title={t("Where the money went")} subtitle={`${t("Expenses by category")} · ${periodLabel(p, t)}`} action={link(["expenses.record", "expenses.view_all"], `/staff/expenses?from=${p.from}&to=${p.to}`, t("Expenses"))}>
            <HBars empty={t("No expenses were recorded in this period.")} rows={spend.byCategory.filter((c) => c.amount > 0).slice(0, 7).map((c) => ({ label: t(c.name), value: c.amount, color: "#f43f5e" }))} />
            {spend.pending.count > 0 && <p className="mt-3 rounded-xl bg-amber-500/10 px-3 py-2 text-xs font-medium text-amber-700 dark:text-amber-300">{t.plural(spend.pending.count, "{n} more expense waiting for approval · {amount}", "{n} more expenses waiting for approval · {amount}", { amount: formatTZS(spend.pending.amount) })}</p>}
          </Panel>
        </div>
      </section>

      {/* ── Cash outlook: what the money looks like from here ── */}
      <section className="space-y-4">
        <PartHeading id="outlook" tone="amber" icon={<Clock />} title={t("Cash outlook")} subtitle={t("What is in the accounts, what is owed to the hotel and how late, what the hotel owes and when, how fast the money goes")} />
        <OutlookView t={t} money={moneyTotal} aging={aging} suppliers={purchases?.suppliers ?? null} pace={pace}
          pending={{ count: ov.expenses.pendingCount, amount: ov.expenses.pendingAmount }} booked={onBooks.next30}
          links={{
            receivables: href(["finance.view"], "/staff/finance/receivables"), procurement: href(["purchases.authorize", "purchases.pay", "procurement.manage"], "/staff/procurement?tab=invoices"),
            accounts: href(["ledger.view", "finance.view"], "/staff/finance/accounts"), expenses: href(["expenses.record", "expenses.view_all"], "/staff/expenses"),
          }} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel level={3} title={t("Who owes the hotel")} subtitle={t("Right now — whatever the period")} action={link(["finance.view"], "/staff/finance/receivables", t("Who owes us"))}>
            <HBars empty={t("Nobody owes the hotel anything.")} rows={[
              { label: t("Guests"), value: ov.owed.guests.amount, sub: t.plural(ov.owed.guests.count, "{n} stay", "{n} stays"), color: "#f43f5e" },
              { label: t("Companies"), value: ov.owed.companies.amount, sub: t.plural(ov.owed.companies.count, "{n} invoice", "{n} invoices"), color: "#8b5cf6" },
              { label: t("Meeting room"), value: ov.owed.meetings.amount, color: "#f59e0b" },
              { label: t("Restaurant"), value: ov.owed.restaurant.amount, sub: t.plural(ov.owed.restaurant.count, "{n} order", "{n} orders"), color: "#0ea5e9" },
            ].filter((r) => r.value > 0)} />
            {owing && owing.total > 0 && (
              <>
                <div className="mt-4"><FigureCards items={[
                  { label: t("Company invoices overdue"), value: formatTZS(owing.overdue), tone: owing.overdue > 0 ? "bad" : undefined },
                  { label: t("Company invoices due today"), value: formatTZS(owing.dueToday), tone: owing.dueToday > 0 ? "warn" : undefined },
                  { label: t("Company invoices due this week"), value: formatTZS(owing.dueWeek) },
                ]} /></div>
                <p className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("Companies owing the most")}</p>
                <DataTable label={t("Companies owing the most")} empty="" head={[t("Company"), t("Invoices"), t("Owed"), t("Overdue")]} right={[1, 2, 3]}
                  rows={owing.companies.slice(0, 5).map((c) => [
                    <span key="n" className="font-medium">{c.name}</span>, c.invoices, formatTZS(c.balance),
                    <span key="o" className={c.overdue > 0 ? "font-medium text-rose-600 dark:text-rose-400" : "text-muted-foreground"}>{c.overdue > 0 ? formatTZS(c.overdue) : "—"}</span>,
                  ])} />
              </>
            )}
          </Panel>
          <Panel level={3} title={t("Cash")} subtitle={handoverRights ? t("Taken in the period, and where it is now") : t("Taken in the period")} action={handoverRights ? link(["cash.handover.view", "cash.handover.review"], "/staff/accountant/handovers", t("Cash handovers")) : null}>
            <FigureCards items={[
              { label: t("Cash taken"), value: formatTZS(ov.cash.total), sub: periodLabel(p, t) },
              ...(handoverRights ? [
                { label: t("Waiting for you"), value: formatTZS(ov.handovers.awaiting), tone: ov.handovers.awaiting > 0 ? ("warn" as const) : undefined, sub: t("sent, not received yet") },
                { label: t("Still with staff"), value: formatTZS(ov.handovers.heldNow), sub: t("not handed over") },
              ] : []),
            ]} />
            <div className="mt-3">
              <HBars empty="" rows={[
                { label: t("Front desk — rooms and bookings"), value: ov.cash.rooms, color: "#10b981" },
                { label: t("Restaurant — the Counter"), value: ov.cash.restaurant, color: "#0ea5e9" },
                { label: t("Other sales"), value: ov.cash.other, color: "#94a3b8" },
              ].filter((r) => r.value > 0)} />
            </div>
            {handoverRights && ov.holders.length > 0 && (
              <div className="mt-4">
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("Cash with staff")}</p>
                <DataTable label={t("Cash with staff")} empty="" head={[t("Person"), t("Since"), t("Amount")]} right={[2]}
                  rows={ov.holders.slice(0, 5).map((h) => [
                    <span key="n" className="font-medium">{h.name}</span>, <span key="s" className="text-muted-foreground">{t.dateTime(h.since)}</span>,
                    <span key="a">{h.expected > 0 ? formatTZS(h.expected) : "—"}{h.waitingCount > 0 && <span className="block text-[11px] text-amber-700 dark:text-amber-300">{t("{amount} waiting for you", { amount: formatTZS(h.waitingAmount) })}</span>}</span>,
                  ])} />
              </div>
            )}
            {handoverRights && <p className="mt-3 text-[11px] text-muted-foreground">{t("A handover only confirms who holds the cash. It is never new income.")}</p>}
          </Panel>
        </div>
      </section>

      {/* ── Purchases and suppliers; what was given away; online payments ── */}
      <section className="space-y-4">
        <PartHeading id="purchases" tone="rose" icon={<Truck />} title={buying ? t("Purchases, discounts and online payments") : t("Discounts and online payments")} subtitle={t("What is being bought and paid, what was given away, and the phone payments that came in")} action={buying ? link(["purchases.authorize", "purchases.pay", "procurement.manage"], "/staff/procurement", t("Procurement")) : null} />
        <div className="grid gap-4 xl:grid-cols-3">
          {purchases && (
            <Panel level={3} title={t("Purchases and suppliers")} subtitle={t("Right now — each stage on its own: a request is not an expense, an approval is not a payment")} className="xl:col-span-2">
              <div className="grid gap-5 2xl:grid-cols-2">
                <Pipeline steps={[
                  { label: t("Asked for"), amount: purchases.position.requested.amount, sub: t("estimates"), color: "#94a3b8" },
                  { label: t("Approved"), amount: purchases.position.approved.amount, sub: t("budgets, not yet ordered"), color: "#0ea5e9" },
                  { label: t("Ordered"), amount: purchases.position.ordered.amount, sub: t("committed to suppliers"), color: "#8b5cf6" },
                  { label: t("Invoiced"), amount: purchases.position.invoiced.amount, sub: t.plural(purchases.position.invoiced.count, "{n} invoice", "{n} invoices"), color: "#f59e0b" },
                  { label: t("Paid"), amount: purchases.position.paid.amount, sub: t("the expense, once paid"), color: "#10b981" },
                ]} />
                <div>
                  <FigureCards items={[
                    { label: t("Still owed to suppliers"), value: formatTZS(purchases.position.owed.amount), tone: purchases.suppliers.overdue.count > 0 ? "bad" : undefined },
                    { label: t("Past due date"), value: formatTZS(purchases.suppliers.overdue.amount), sub: t.plural(purchases.suppliers.overdue.count, "{n} invoice", "{n} invoices"), tone: purchases.suppliers.overdue.count > 0 ? "bad" : undefined },
                  ]} />
                  <p className="mb-1 mt-4 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("Suppliers owed")}</p>
                  <DataTable label={t("Suppliers owed")} empty={t("Nobody is owed anything.")} head={[t("Supplier"), t("Owed")]} right={[1]}
                    rows={purchases.suppliers.top.map((s) => [<span key="n" className="font-medium">{s.name}</span>, formatTZS(s.amount)])} />
                </div>
              </div>
            </Panel>
          )}
          <div className={purchases ? "grid gap-4" : "grid gap-4 xl:col-span-3 xl:grid-cols-2"}>
            <Panel level={3} title={t("Discounts and refunds")} subtitle={periodLabel(p, t)} action={link(["finance.view"], "/staff/accountant/discounts", t("Discounts"))}>
              <FigureCards items={[
                { label: t("Room discounts"), value: formatTZS(ov.earned.discounts) },
                { label: t("Restaurant discounts"), value: formatTZS(restDisc.amount), sub: restDisc.count ? t.plural(restDisc.count, "{n} order", "{n} orders") : undefined },
                { label: t("Refunds"), value: formatTZS(ov.earned.refunds) },
              ]} />
            </Panel>
            {online && (
              <Panel level={3} title={t("Online payments")} subtitle={periodLabel(p, t)} action={link(["finance.view"], "/staff/finance/online", t("Online payments"))}>
                <FigureCards items={[
                  { label: t("Paid"), value: formatTZS(online.paid.amount), sub: t.plural(online.paid.count, "{n} payment", "{n} payments"), tone: "good" },
                  { label: t("Waiting"), value: String(online.pending) },
                  { label: t("Not completed"), value: String(online.failed) },
                ]} />
                {online.attention > 0 && <p className="mt-3 rounded-xl bg-rose-500/10 px-3 py-2 text-xs font-medium text-rose-700 dark:text-rose-300">{t.plural(online.attention, "{n} online payment needs a person — money in that is not matched yet", "{n} online payments need a person — money in that is not matched yet")}</p>}
              </Panel>
            )}
          </div>
        </div>
      </section>

      {/* ── How the hotel is doing: the figures that show it, six months, occupancy, the best days ── */}
      <section className="space-y-4">
        <PartHeading id="trends" tone="emerald" icon={<LineChart />} title={t("How the hotel is doing")} subtitle={t("Occupancy, rates, six months, what moved against the period before, which days earn most")} />
        <Suspense fallback={<PartSkeleton label={t("Loading…")} height="h-96" />}><TrendsSection c={ctx} /></Suspense>
      </section>

      {/* ── Bookings ── */}
      <section className="space-y-4">
        <PartHeading id="bookings" tone="sky" icon={<BedDouble />} title={t("Bookings")} subtitle={t("How many were made, what became of them, and where they came from")} />
        <Suspense fallback={<PartSkeleton label={t("Loading…")} height="h-80" />}><BookingsSection c={ctx} movement={movement} /></Suspense>
      </section>

      {/* ── The latest, in tables ── */}
      <section className="space-y-4">
        <PartHeading id="latest" tone="slate" icon={<ReceiptText />} title={t("The latest")} subtitle={t("The newest money in and the newest expenses of the period")} />
        <div className="grid gap-4 lg:grid-cols-2">
          <Panel level={3} title={t("Latest money in")} subtitle={periodLabel(p, t)} action={link(["reports.view", "finance.view"], `/staff/payments?from=${p.from}&to=${p.to}`, t("Income"))}>
            <DataTable label={t("Latest money in")} empty={t("Nothing was received in this period.")} head={[t("When"), t("For"), t("How"), t("Amount")]} right={[3]}
              rows={payments.map((x) => [
                <span key="w" className="whitespace-nowrap text-muted-foreground">{t.dateTime(x.at)}</span>, x.for ?? <span key="f" className="text-muted-foreground">—</span>,
                <span key="m">{t(x.method)}{x.account !== x.method && <span className="block text-[11px] text-muted-foreground">{t(x.account)}</span>}</span>, <span key="a" className="font-medium">{formatTZS(x.amount)}</span>,
              ])} />
          </Panel>
          <Panel level={3} title={t("Latest expenses")} subtitle={periodLabel(p, t)} action={link(["expenses.record", "expenses.view_all"], `/staff/expenses?from=${p.from}&to=${p.to}`, t("Expenses"))}>
            <DataTable label={t("Latest expenses")} empty={t("No expenses were recorded in this period.")} head={[t("When"), t("What"), t("By"), t("Amount")]} right={[3]}
              rows={spend.recent.map((x) => [
                <span key="w" className="whitespace-nowrap text-muted-foreground">{t.dateTime(x.spentAt.toISOString())}</span>,
                <span key="d">{x.description}<span className="block text-[11px] text-muted-foreground">{t(x.category.name)}{x.status === "PENDING_APPROVAL" ? ` · ${t("waiting for approval")}` : ""}</span></span>,
                x.createdBy.fullName, <span key="a" className="font-medium">{formatTZS(x.amount)}</span>,
              ])} />
          </Panel>
        </div>
      </section>

      {/* ── The business in detail ── */}
      <section className="space-y-4">
        <PartHeading id="detail" tone="violet" icon={<BarChart3 />} title={t("The business in detail")} subtitle={t("Rooms by type, where bookings come from, the restaurant and bar, the best customers")} />
        <Suspense fallback={<PartSkeleton label={t("Loading…")} height="h-72" />}>
          <BusinessDetail p={p} today={today} restaurantLinks={has("restaurant.orders", "kitchen.orders", "restaurant.menu", "restaurant.serve")} />
        </Suspense>
      </section>

      <p className="text-[11px] text-muted-foreground">{t("Earned is what the hotel earned; received is what really came in; still owed is what is unpaid right now; account balances are the hotel's own records. They are never added together.")}</p>
    </div>
  );
}

// ───────────────────────── Needs → cards ─────────────────────────

const GROUP: Record<FinanceNeed["group"], string> = {
  Purchases: msg("Purchases"), Cash: msg("Cash"), Expenses: msg("Expenses"), "Money owed": msg("Money owed"), "Online payments": msg("Online payments"), Reports: msg("Reports"), Accounts: msg("Accounts"),
};

/** One need as an attention card: what it is, how much, where to act. */
function needCard(n: FinanceNeed, t: T): AttentionItem {
  const amount = n.amount != null ? formatTZS(n.amount) : undefined;
  const base = { tone: n.tone, href: n.href, group: t(GROUP[n.group]) } as const;
  switch (n.kind) {
    case "authorize": return { ...base, icon: <BadgeCheck />, title: t.plural(n.count, "{n} purchase price waiting for you to authorize", "{n} purchase prices waiting for you to authorize"), detail: t("The Accountant's price is above the approved budget") };
    case "verify": return { ...base, icon: <ReceiptText />, title: t.plural(n.count, "{n} supplier invoice to verify", "{n} supplier invoices to verify"), detail: amount };
    case "pay": return { ...base, icon: <Banknote />, title: t.plural(n.count, "{n} supplier invoice verified, to pay", "{n} supplier invoices verified, to pay"), detail: amount ? t("{amount} still to pay", { amount }) : undefined };
    case "supplierOverdue": return { ...base, icon: <AlarmClock />, title: t.plural(n.count, "{n} supplier invoice past its due date", "{n} supplier invoices past their due date"), detail: amount ? t("{amount} still owed", { amount }) : undefined };
    case "supplierDisputed": return { ...base, icon: <AlertCircle />, title: t.plural(n.count, "{n} supplier invoice disputed", "{n} supplier invoices disputed"), detail: t("Waiting for the supplier to correct it") };
    case "handoverWaiting": return { ...base, icon: <HandCoins />, title: t.plural(n.count, "{n} cash handover waiting to be received", "{n} cash handovers waiting to be received"), detail: amount };
    case "handoverReturned": return { ...base, icon: <AlertCircle />, title: t.plural(n.count, "{n} handover sent back, not corrected yet", "{n} handovers sent back, not corrected yet") };
    case "cashCount": return { ...base, icon: <Scale />, title: t.plural(n.count, "{n} cash count with a difference to settle", "{n} cash counts with a difference to settle") };
    case "expenses": return { ...base, icon: <Receipt />, title: t.plural(n.count, "{n} expense waiting for approval", "{n} expenses waiting for approval"), detail: amount };
    case "companyOverdue": return { ...base, icon: <Building2 />, title: t.plural(n.count, "{n} company invoice overdue", "{n} company invoices overdue"), detail: amount ? t("{amount} overdue", { amount }) : undefined };
    case "guestsOwing": return { ...base, icon: <Users />, title: t("{n} left without paying in full", { n: n.count }), detail: amount ? t("{amount} still open after checkout", { amount }) : undefined };
    case "departuresOwing": return { ...base, icon: <Users />, title: t.plural(n.count, "{n} guest due to leave still owes", "{n} guests due to leave still owe"), detail: amount };
    case "online": return { ...base, icon: <Smartphone />, title: t.plural(n.count, "{n} online payment needs a person", "{n} online payments need a person"), detail: t("Money came in that is not matched to a bill") };
    case "withdrawal": return { ...base, icon: <Landmark />, title: t.plural(n.count, "{n} withdrawal not confirmed", "{n} withdrawals not confirmed"), detail: t("Nobody knows yet whether it went through") };
    case "reportFailed": return { ...base, icon: <FileText />, title: t("The last daily report did not reach the Boss"), detail: t("The report itself is kept — send it again") };
    case "reportMissing": return { ...base, icon: <FileText />, title: t("Yesterday's daily report was not made"), detail: t("It is normally ready at 07:00") };
    case "accountNegative": return { ...base, icon: <Landmark />, title: t("{account} is below zero", { account: t(n.name ?? "") }), detail: amount };
  }
}
