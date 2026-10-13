import { Suspense } from "react";
import {
  AlertCircle, AlarmClock, BadgeCheck, Banknote, Building2, CircleDollarSign, ClipboardCheck, FileText, HandCoins, Landmark, Receipt, ReceiptText, Scale, Smartphone, TrendingUp, Users, Wallet,
} from "lucide-react";
import { requireUser } from "@/server/auth";
import type { PermissionCode } from "@/lib/permissions";
import { businessToday } from "@/server/settings";
import { accountantOverview } from "@/server/services/accountant";
import { guestMovement, occupancy, change, previousRange, profitLoss, dailyMoney } from "@/server/services/reporting";
import { paymentsByMethod } from "@/server/services/finance";
import { onlinePaymentTotals } from "@/server/services/online-payments-admin";
import { bookingActivity, financeNeeds, purchasesPanel, restaurantDiscounts, type FinanceNeed } from "@/server/services/finance-home";
import { addDays, diffDays } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";
import { PeriodPicker, periodLabel, readPeriod } from "@/components/staff/finance/finance-nav";
import { BusinessDetail } from "@/app/staff/(app)/finance/finance-overview";
import { AttentionCards, Delta, HeroBanner, Panel, PanelLink, SectionLabel, StatTile, type AttentionItem } from "./kit";
import { AreaTrend } from "./light-charts";

/**
 * Finance's Home — the same look as the Boss's and the Manager's, about money only: a banner with today at a glance, what needs
 * Finance now, the figures of the chosen period against the one before, cash and accounts, purchases and suppliers, how the
 * bookings behave, then the full business analysis. Earned, received, still owed and the account balances stay four different
 * things and are never added together. Every figure comes from the shared money services, so it always agrees with the
 * Finance desk, the ledger and the daily report.
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
  const handoverRights = has("cash.handover.view", "cash.handover.review");
  const buying = has("purchases.authorize", "purchases.pay", "procurement.manage");

  const [ov, plPrev, methodsPrev, movement, movementPrev, trend, needs, receivedToday, occToday, online, bookings, bookingsTrend, restDisc, purchases] = await Promise.all([
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
    bookingActivity(range),
    days >= 7 ? null : bookingActivity(trendRange),
    restaurantDiscounts(range),
    buying ? purchasesPanel(today) : null,
  ]);

  // ── Figures of the period, each against the period before ──
  const vsLabel = days === 1 ? (p.key === "today" ? t("yesterday") : t("the day before")) : t("previous period");
  // Where there is nothing before to compare with, say so — never "same as before".
  const sinceWords = days === 1 ? (p.key === "today" ? t("yesterday") : t("the day before")) : t("in the previous period");
  const versus = (now: number, before: number, invert?: boolean) => before > 0
    ? <Delta value={change(now, before)} invert={invert} label={vsLabel} t={t} />
    : now > 0 ? <span className="text-xs text-muted-foreground">{t("none {when}", { when: sinceWords })}</span> : null;
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

  return (
    <div className="w-full space-y-6">
      <HeroBanner
        eyebrow={user.roleName === "Finance" ? t("Finance") : t("Finance · {role}", { role: t(user.roleName) })}
        title={greeting}
        subtitle={<>{t.rich("<b>{pct}%</b> of the guest rooms occupied today · <g>{received}</g> received today", {
          b: (c) => <strong className="font-semibold text-white">{c}</strong>, g: (c) => <strong className="font-semibold text-emerald-300">{c}</strong>,
        }, { pct: Math.round(occToday.occupancy), received: formatTZS(receivedToday.total) })}{owedNow > 0 && <> · {t.rich("<a>{owed}</a> still owed to the hotel", { a: (c) => <strong className="font-semibold text-amber-300">{c}</strong> }, { owed: formatTZS(owedNow) })}</>}</>}
      />

      <div>
        <SectionLabel title={t("Needs your attention")} count={needs.length} t={t} />
        <AttentionCards items={attention} t={t} emptyTitle={t("Nothing is waiting for Finance")} emptyDetail={t("No purchase to authorize, no invoice to pay, no handover to receive, nothing overdue.")} />
      </div>

      {/* ── The figures of the period ── */}
      <div>
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
            delta={netPrev > 0 ? <Delta value={change(net, netPrev)} label={vsLabel} t={t} /> : net !== 0 || netPrev !== 0 ? <span className="text-xs text-muted-foreground">{t("{amount} {when}", { amount: formatTZS(netPrev), when: sinceWords })}</span> : null} sub={t("earned − expenses")} href={href(["ledger.view", "finance.view"], `/staff/finance/ledger?from=${p.from}&to=${p.to}`)} />
          <StatTile label={t("Still owed")} value={formatTZS(owedNow)} icon={<Wallet />} tone="amber"
            sub={t("right now, whatever the period")} href={href(["finance.view"], "/staff/finance/receivables")} />
          <StatTile label={t("Bookings made")} value={String(movement.newBookings)} icon={<ClipboardCheck />} tone="sky"
            delta={versus(movement.newBookings, movementPrev.newBookings)}
            sub={t.plural(movement.checkIns, "{n} room checked in", "{n} rooms checked in")} href={href(["reservations.view"], "/staff/reservations")} />
        </div>
      </div>

      {/* ── Cash and accounts ── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("Cash")} subtitle={t("Taken in the period, and where it is now")} action={link(["cash.handover.view", "cash.handover.review"], "/staff/accountant/handovers", t("Cash handovers"))}>
          <dl className="divide-y divide-border/60 text-sm">
            <Row label={t("Cash taken in the period")} value={formatTZS(ov.cash.total)} strong />
            <Row label={t("Front desk — rooms and bookings")} value={formatTZS(ov.cash.rooms)} muted />
            <Row label={t("Restaurant — the Counter")} value={formatTZS(ov.cash.restaurant)} muted />
            <Row label={t("Other sales")} value={formatTZS(ov.cash.other)} muted />
            {handoverRights && <>
              <Row label={t("Received from staff in the period")} value={formatTZS(ov.handovers.received)} sub={t.plural(ov.handovers.receivedCount, "{n} handover", "{n} handovers")} />
              <Row label={t("Waiting for you to receive")} value={formatTZS(ov.handovers.awaiting)} tone={ov.handovers.awaiting > 0 ? "warn" : undefined} />
              <Row label={t("Still with staff, not handed over")} value={formatTZS(ov.handovers.heldNow)} />
            </>}
          </dl>
          {handoverRights && ov.holders.length > 0 && (
            <ul className="mt-2 divide-y divide-border/50 rounded-2xl bg-muted/30 px-3 text-xs">
              {ov.holders.slice(0, 5).map((h) => (
                <li key={h.userId} className="flex items-center justify-between gap-3 py-1.5">
                  <span className="min-w-0 truncate">{h.name} <span className="text-muted-foreground">· {t("since {time}", { time: t.dateTime(h.since) })}</span></span>
                  <span className="shrink-0 text-right tabular-nums">
                    {h.expected > 0 && <span className="block font-medium">{formatTZS(h.expected)}</span>}
                    {h.waitingCount > 0 && <span className="block text-[11px] text-amber-700 dark:text-amber-300">{t("{amount} waiting for you", { amount: formatTZS(h.waitingAmount) })}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">{t("A handover only confirms who holds the cash. It is never new income.")}</p>
        </Panel>

        <Panel title={t("Accounts")} subtitle={t("What the hotel's own records add up to — check it against the bank")} action={link(["ledger.view", "finance.view"], "/staff/finance/accounts", t("Accounts"))}>
          {ov.balances.length === 0 ? <p className="text-sm text-muted-foreground">{t("No accounts yet.")}</p> : (
            <ul className="divide-y divide-border/60">
              {ov.balances.map((b) => (
                <li key={b.id} className="flex items-center justify-between gap-3 py-2 text-sm">
                  <span className="flex min-w-0 items-center gap-2"><Landmark className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{t(b.name)}</span></span>
                  <span className="shrink-0 text-right tabular-nums">
                    <span className={cn("block font-semibold", b.balance < 0 && "text-rose-600 dark:text-rose-400")}>{formatTZS(b.balance)}</span>
                    {(b.dayIn !== 0 || b.dayOut !== 0) && <span className="block text-[11px] text-muted-foreground">{t("today +{in} −{out}", { in: formatTZS(b.dayIn), out: formatTZS(b.dayOut) })}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* ── Purchases and suppliers; discounts; online payments ── */}
      <div className="grid gap-4 lg:grid-cols-3">
        {purchases && (
          <Panel title={t("Purchases and suppliers")} subtitle={t("Right now — each stage on its own: a request is not an expense, an approval is not a payment")} className="lg:col-span-2"
            action={link(["purchases.authorize", "purchases.pay", "procurement.manage"], "/staff/procurement", t("Procurement"))}>
            <div className="grid gap-4 sm:grid-cols-2">
              <dl className="divide-y divide-border/60 text-sm">
                <Row label={t("Asked for")} value={formatTZS(purchases.position.requested.amount)} sub={`${t.plural(purchases.position.requested.count, "{n} request", "{n} requests")} · ${t("estimates")}`} muted />
                <Row label={t("Approved")} value={formatTZS(purchases.position.approved.amount)} sub={t("budgets, not yet ordered")} muted />
                <Row label={t("Ordered")} value={formatTZS(purchases.position.ordered.amount)} sub={t("committed to suppliers")} />
                <Row label={t("Invoiced")} value={formatTZS(purchases.position.invoiced.amount)} sub={t.plural(purchases.position.invoiced.count, "{n} invoice", "{n} invoices")} />
                <Row label={t("Paid")} value={formatTZS(purchases.position.paid.amount)} sub={t("the expense, once paid")} />
                <Row label={t("Still owed to suppliers")} value={formatTZS(purchases.position.owed.amount)} strong tone={purchases.suppliers.overdue.count > 0 ? "bad" : undefined} />
              </dl>
              <div>
                <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("Suppliers owed")}</p>
                {purchases.suppliers.top.length === 0 ? <p className="text-sm text-muted-foreground">{t("Nobody is owed anything.")}</p> : (
                  <ul className="divide-y divide-border/60 text-sm">
                    {purchases.suppliers.top.map((s) => <li key={s.name} className="flex items-center justify-between gap-3 py-1.5"><span className="truncate">{s.name}</span><span className="shrink-0 tabular-nums font-medium">{formatTZS(s.amount)}</span></li>)}
                  </ul>
                )}
                {purchases.suppliers.overdue.count > 0 && (
                  <p className="mt-2 flex items-center gap-1.5 text-xs font-medium text-rose-600 dark:text-rose-400"><AlarmClock className="size-3.5" />{t.plural(purchases.suppliers.overdue.count, "{n} invoice past its due date · {amount}", "{n} invoices past their due date · {amount}", { amount: formatTZS(purchases.suppliers.overdue.amount) })}</p>
                )}
              </div>
            </div>
          </Panel>
        )}

        <div className={cn("grid gap-4", !purchases && "lg:col-span-3 lg:grid-cols-3")}>
          <Panel title={t("Discounts and refunds")} subtitle={periodLabel(p, t)} action={link(["finance.view"], "/staff/accountant/discounts", t("Discounts"))}>
            <dl className="divide-y divide-border/60 text-sm">
              <Row label={t("Room discounts")} value={formatTZS(ov.earned.discounts)} />
              <Row label={t("Restaurant discounts")} value={formatTZS(restDisc.amount)} sub={restDisc.count ? t.plural(restDisc.count, "{n} order", "{n} orders") : undefined} />
              <Row label={t("Refunds")} value={formatTZS(ov.earned.refunds)} />
            </dl>
          </Panel>
          {online && (
            <Panel title={t("Online payments")} subtitle={periodLabel(p, t)} action={link(["finance.view"], "/staff/finance/online", t("Online payments"))}>
              <dl className="divide-y divide-border/60 text-sm">
                <Row label={t("Paid")} value={formatTZS(online.paid.amount)} sub={t.plural(online.paid.count, "{n} payment", "{n} payments")} />
                <Row label={t("Waiting")} value={String(online.pending)} muted />
                <Row label={t("Not completed")} value={String(online.failed)} muted />
                <Row label={t("Need a person")} value={String(online.attention)} tone={online.attention > 0 ? "bad" : undefined} sub={t("money in that is not matched yet, any time")} />
              </dl>
            </Panel>
          )}
        </div>
      </div>

      {/* ── Bookings ── */}
      <Panel title={t("Bookings")} subtitle={periodLabel(p, t)}
        action={link(["reservations.view"], "/staff/reservations", t("Stays"))}>
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
          <div>
            <dl className="mb-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
              <Mini label={t("Bookings made")} value={movement.newBookings} />
              <Mini label={t("Check-ins")} value={movement.checkIns} />
              <Mini label={t("Check-outs")} value={movement.checkOuts} />
              <Mini label={t("Cancelled")} value={movement.cancellations} tone={movement.cancellations ? "warn" : undefined} />
              <Mini label={t("No-shows")} value={movement.noShows} tone={movement.noShows ? "warn" : undefined} />
              <Mini label={t("In house now")} value={movement.inHouse} />
            </dl>
            <p className="mb-1 text-[11px] text-muted-foreground">{t("Bookings made each day")}{bookingsTrend && ` · ${t("the last two weeks, for context")}`}</p>
            <AreaTrend data={(bookingsTrend ?? bookings).series} unit="count" color="#0ea5e9" height={190} />
          </div>
          <div className="overflow-x-auto" role="region" aria-label={t("Bookings by channel")} tabIndex={0}>
            <p className="mb-1 text-[11px] text-muted-foreground">{t("By booking channel — what became of the bookings made")}</p>
            {bookings.sources.length === 0 ? <p className="text-sm text-muted-foreground">{t("No bookings were made in this period.")}</p> : (
              <table className="w-full min-w-[22rem] text-sm">
                <thead><tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                  <th scope="col" className="py-1.5 pr-2 font-medium">{t("Channel")}</th><th scope="col" className="px-1 py-1.5 text-right font-medium">{t.ctx("booking", "Made")}</th><th scope="col" className="px-1 py-1.5 text-right font-medium">{t.ctx("booking", "Arrived")}</th>
                  <th className="px-1 py-1.5 text-right font-medium">{t("To come")}</th><th className="px-1 py-1.5 text-right font-medium">{t("Cancelled")}</th><th className="pl-1 py-1.5 text-right font-medium">{t("No-show")}</th>
                </tr></thead>
                <tbody className="divide-y divide-border/50">
                  {bookings.sources.map((s) => (
                    <tr key={s.name}><td className="py-1.5 pr-2">{t(s.name)}</td><td className="px-1 text-right tabular-nums font-medium">{s.made}</td><td className="px-1 text-right tabular-nums">{s.arrived}</td>
                      <td className="px-1 text-right tabular-nums text-muted-foreground">{s.waiting}</td><td className={cn("px-1 text-right tabular-nums", s.cancelled > 0 && "text-amber-700 dark:text-amber-300")}>{s.cancelled}</td><td className={cn("pl-1 text-right tabular-nums", s.noShow > 0 && "text-amber-700 dark:text-amber-300")}>{s.noShow}</td></tr>
                  ))}
                  <tr className="font-medium"><td className="py-1.5 pr-2">{t("Total")}</td><td className="px-1 text-right tabular-nums">{bookings.made}</td><td className="px-1" /><td className="px-1" /><td className="px-1 text-right tabular-nums">{bookings.cancelled}</td><td className="pl-1 text-right tabular-nums">{bookings.noShow}</td></tr>
                </tbody>
              </table>
            )}
            <p className="mt-2 text-[11px] text-muted-foreground">{t("Check-ins and check-outs count rooms; bookings count reservations. Cancelled and no-shows above are of the bookings made in this period; in the cards they are counted by arrival date.")}</p>
          </div>
        </div>
      </Panel>

      {/* ── The full analysis ── */}
      <div>
        <SectionLabel title={t("The business in detail")} t={t} />
        <Suspense fallback={<div className="h-72 animate-pulse rounded-3xl border border-border/60 bg-card/60" aria-busy="true" />}>
          <BusinessDetail p={p} today={today} restaurantLinks={has("restaurant.orders", "kitchen.orders", "restaurant.menu", "restaurant.serve")} />
        </Suspense>
      </div>

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

// ───────────────────────── Small pieces ─────────────────────────

function Row({ label, value, sub, strong, muted, tone }: { label: string; value: string; sub?: string; strong?: boolean; muted?: boolean; tone?: "warn" | "bad" }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className={cn("min-w-0", strong ? "font-medium" : muted ? "text-muted-foreground" : "")}>{label}{sub && <span className="block text-[11px] font-normal text-muted-foreground">{sub}</span>}</dt>
      <dd className={cn("shrink-0 tabular-nums", strong && "font-semibold", tone === "warn" && "font-medium text-amber-700 dark:text-amber-300", tone === "bad" && "font-semibold text-rose-600 dark:text-rose-400")}>{value}</dd>
    </div>
  );
}

function Mini({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="flex flex-col-reverse rounded-2xl border border-border/60 bg-muted/20 px-2 py-2">
      <dt className="text-[10.5px] leading-tight text-muted-foreground">{label}</dt>
      <dd className={cn("text-lg font-semibold tabular-nums", tone === "warn" && "text-amber-700 dark:text-amber-300")}>{value}</dd>
    </div>
  );
}
