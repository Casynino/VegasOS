import type { Metadata } from "next";
import Link from "next/link";
import { AlertCircle, ArrowRight, Banknote, BadgeCheck, ClipboardCheck, HandCoins, Landmark, Receipt, ReceiptText, Scale, Wallet } from "lucide-react";
import { db } from "@/server/db";
import { requirePagePermission } from "@/server/auth";
import { businessToday } from "@/server/settings";
import { accountantOverview } from "@/server/services/accountant";
import { financeQueue } from "@/server/services/procurement-desk";
import { formatTZS } from "@/lib/format";
import { getT } from "@/i18n/server";
import { cn } from "@/lib/utils";
import { Panel } from "@/components/dashboard/kit";
import { PeriodPicker, periodLabel, readPeriod } from "@/components/staff/finance/finance-nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Finance") };
}
export const dynamic = "force-dynamic";

const str = (v: string | string[] | undefined) => (typeof v === "string" ? v : "");

/**
 * Finance's desk: what needs doing now, then the money in four separate figures (earned · received · owed · result),
 * the cash — who took it, what was handed over, what is still in staff hands — and every account. Real records only; a figure
 * that cannot be known is left out, not guessed.
 */
export default async function AccountantPage({ searchParams }: PageProps<"/staff/accountant">) {
  await requirePagePermission("dashboard.finance", "cash.handover.view", "cash.handover.review");
  const t = await getT();
  const sp = await searchParams;
  const today = await businessToday();
  const p = readPeriod(sp, today, "today");
  const accountId = str(sp.account) || null;
  const staffId = str(sp.staff) || null;
  const [o, accountList, queue] = await Promise.all([
    accountantOverview(p, today, { accountId, staffId }),
    db.moneyAccount.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    financeQueue(),
  ]);
  const keep = Object.fromEntries(Object.entries({ account: accountId ?? "", staff: staffId ?? "" }).filter(([, v]) => v));
  const filtered = Boolean(accountId || staffId);
  const needs = [
    queue.authorize > 0 && { icon: BadgeCheck, text: t.plural(queue.authorize, "{n} purchase price waiting for you to authorize", "{n} purchase prices waiting for you to authorize"), amount: null, href: "/staff/procurement?tab=authorize" },
    queue.verify > 0 && { icon: ReceiptText, text: t.plural(queue.verify, "{n} supplier invoice to verify", "{n} supplier invoices to verify"), amount: queue.verifyAmount, href: "/staff/procurement?tab=invoices" },
    queue.pay > 0 && { icon: ClipboardCheck, text: t.plural(queue.pay, "{n} supplier invoice verified, to pay", "{n} supplier invoices verified, to pay"), amount: queue.payAmount, href: "/staff/procurement?tab=invoices" },
    o.handovers.waitingCount > 0 && { icon: HandCoins, text: t.plural(o.handovers.waitingCount, "{n} cash handover waiting to be received", "{n} cash handovers waiting to be received"), amount: o.handovers.waitingExpected, href: "/staff/accountant/handovers?status=SUBMITTED" },
    o.handovers.returned > 0 && { icon: AlertCircle, text: t.plural(o.handovers.returned, "{n} handover sent back, not corrected yet", "{n} handovers sent back, not corrected yet"), amount: null, href: "/staff/accountant/handovers?status=RETURNED" },
    o.expenses.pendingCount > 0 && { icon: Receipt, text: t.plural(o.expenses.pendingCount, "{n} expense waiting for approval", "{n} expenses waiting for approval"), amount: o.expenses.pendingAmount, href: "/staff/expenses?status=PENDING_APPROVAL" },
    o.openCashCounts > 0 && { icon: Scale, text: t.plural(o.openCashCounts, "{n} cash count with a difference to settle", "{n} cash counts with a difference to settle"), amount: null, href: "/staff/finance/accounts" },
  ].filter(Boolean) as { icon: typeof HandCoins; text: string; amount: number | null; href: string }[];

  return (
    <div className="w-full space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">{t("Finance")}</p>
          <h1 className="text-[clamp(1.4rem,2vw,1.75rem)] font-semibold tracking-tight">{t("Finance desk")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{periodLabel(p, t)}</p>
        </div>
        <PeriodPicker current={p.key} from={p.from} to={p.to} keep={keep} />
      </header>

      <form className="flex flex-wrap items-end gap-2 rounded-2xl border border-border/70 bg-card p-3 text-sm">
        {p.key === "custom" ? <><input type="hidden" name="from" value={p.from} /><input type="hidden" name="to" value={p.to} /></> : <input type="hidden" name="period" value={p.key} />}
        <label className="grid gap-1 text-xs text-muted-foreground">{t("Account")}
          <select name="account" defaultValue={accountId ?? ""} className="h-9 min-w-40 rounded-lg border border-border bg-background px-2 text-sm text-foreground">
            <option value="">{t("All accounts")}</option>
            {accountList.map((a) => <option key={a.id} value={a.id}>{t(a.name)}</option>)}
          </select>
        </label>
        <label className="grid gap-1 text-xs text-muted-foreground">{t("Cash taken by")}
          <select name="staff" defaultValue={staffId ?? ""} className="h-9 min-w-40 rounded-lg border border-border bg-background px-2 text-sm text-foreground">
            <option value="">{t("Everyone")}</option>
            {o.staff.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
          </select>
        </label>
        <button className="h-9 rounded-lg bg-foreground px-3 text-sm font-medium text-background">{t("Show")}</button>
        {filtered && <Link href={`?period=${p.key === "custom" ? "today" : p.key}`} className="h-9 content-center px-2 text-xs text-muted-foreground underline-offset-4 hover:underline">{t("Clear filters")}</Link>}
        <p className="basis-full text-[11px] text-muted-foreground">{t("The account and staff filters narrow the money received, the cash and the accounts. What was earned and what is owed are for the whole hotel.")}</p>
      </form>

      {/* What needs Finance now */}
      <Panel title={t("Needs you now")} subtitle={needs.length ? t.plural(needs.length, "{n} thing waiting", "{n} things waiting") : t("Nothing is waiting.")}>
        {needs.length > 0 && (
          <ul className="divide-y divide-border/60">
            {needs.map((n) => (
              <li key={n.href}>
                <Link href={n.href} className="flex items-center justify-between gap-3 px-1 py-2.5 text-sm transition-colors hover:bg-muted/40">
                  <span className="flex min-w-0 items-center gap-2.5"><n.icon className="size-4 shrink-0 text-amber-600 dark:text-amber-400" /><span className="truncate">{n.text}</span></span>
                  <span className="flex shrink-0 items-center gap-2 tabular-nums text-muted-foreground">{n.amount !== null && formatTZS(n.amount)}<ArrowRight className="size-3.5" /></span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Four different things — never added together */}
      <section aria-label={t("The money, in four separate figures")} className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Figure label={t("Earned")} hint={t("What the hotel earned — before anyone paid")} value={o.earned.total} href={`/staff/finance/ledger?view=income&from=${p.from}&to=${p.to}`}
          lines={[[t("Rooms"), o.earned.rooms], [t("Restaurant & room service"), o.earned.restaurant], [t("Bar"), o.earned.bar], [t("Meeting room"), o.earned.meeting], [t("Transport & other"), o.earned.other]]} />
        <Figure label={t("Received")} hint={t("Money that really came in, less refunds")} value={o.received.total} href={`/staff/payments?from=${p.from}&to=${p.to}`}
          lines={o.received.byMethod.slice(0, 5).map((m) => [t(m.method), m.amount] as [string, number])} />
        <Figure label={t("Still owed")} hint={t("Earned and not paid yet — any date")} value={o.owed.total} href="/staff/finance/receivables" tone="text-rose-600 dark:text-rose-400"
          lines={[[t("Guests staying or gone"), o.owed.guests.amount], [t("Companies"), o.owed.companies.amount], [t("Meeting room"), o.owed.meetings.amount], [t("Restaurant orders"), o.owed.restaurant.amount]]} />
        <Figure label={t("Net result")} hint={t("Earned − expenses recorded in the period")} value={o.netResult} href={`/staff/expenses?from=${p.from}&to=${p.to}`} tone={o.netResult >= 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400"}
          lines={[[t("Earned"), o.earned.total], [t("Expenses"), -o.expenses.total]]} note={t("Costs nobody recorded are not in it — it is not the full profit.")} />
      </section>

      {/* Cash — who took it, what was handed over, what is still with staff */}
      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
        <Panel title={t("Cash taken")} subtitle={filtered ? t("Narrowed by your filters") : t("By where it came from — refunds taken off")} action={<Link href="/staff/collections" className="text-xs font-medium text-muted-foreground underline-offset-4 hover:underline">{t("Collections")}</Link>}>
          <dl className="divide-y divide-border/60 text-sm">
            <Row label={t("Front desk — rooms and bookings")} value={o.cash.rooms} />
            <Row label={t("Restaurant — the Counter")} value={o.cash.restaurant} />
            <Row label={t("Other sales")} value={o.cash.other} />
            <Row label={t("Cash taken in the period")} value={o.cash.total} strong />
            <Row label={t("Received from staff in the period")} value={o.handovers.received} sub={t.plural(o.handovers.receivedCount, "{n} handover", "{n} handovers")} />
            {o.handovers.withDifference > 0 && <Row label={t("Differences accepted")} value={-o.handovers.short + o.handovers.over} sub={t("{short} short · {over} over", { short: formatTZS(o.handovers.short), over: formatTZS(o.handovers.over) })} tone="text-amber-700 dark:text-amber-300" />}
          </dl>
          <p className="mt-2 text-[11px] text-muted-foreground">{t("A handover only confirms who holds the cash. It is never new income.")}</p>
        </Panel>

        <Panel title={t("Cash still with staff")} subtitle={o.handovers.heldNow + o.handovers.awaiting > 0 ? t("{held} not handed over · {awaiting} sent, waiting for you", { held: formatTZS(o.handovers.heldNow), awaiting: formatTZS(o.handovers.awaiting) }) : t("All cash has been handed over.")}
          action={<Link href="/staff/accountant/handovers" className="text-xs font-medium text-muted-foreground underline-offset-4 hover:underline">{t("Cash handovers")}</Link>}>
          {o.holders.length > 0 && (
            <ul className="divide-y divide-border/60 text-sm">
              {o.holders.map((h) => (
                <li key={h.userId} className="flex items-center justify-between gap-3 py-2">
                  <span className="min-w-0"><span className="font-medium">{h.name}</span><span className="block truncate text-[11px] text-muted-foreground">{t(h.role)} · {t("since {time}", { time: t.dateTime(h.since) })}</span></span>
                  <span className="shrink-0 text-right tabular-nums">
                    {h.expected > 0 && <span className="block font-medium">{formatTZS(h.expected)}</span>}
                    {h.waitingCount > 0 && <span className="block text-[11px] text-amber-700 dark:text-amber-300">{t("{amount} waiting for you", { amount: formatTZS(h.waitingAmount) })}</span>}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </section>

      {/* Money received, by account */}
      <Panel title={t("Money received, by account")} subtitle={t("Recorded payments and sales, less refunds")}>
        {o.received.byAccount.length === 0 ? <p className="text-sm text-muted-foreground">{t("Nothing was received in this period.")}</p> : (
          <ul className="grid gap-x-8 gap-y-1 sm:grid-cols-2">
            {o.received.byAccount.map((a) => (
              <li key={a.id} className="flex items-center justify-between gap-3 border-b border-border/50 py-1.5 text-sm"><span className="truncate">{t(a.name)}</span><span className="font-medium tabular-nums">{formatTZS(a.received)}</span></li>
            ))}
          </ul>
        )}
      </Panel>

      {/* Account positions — what the hotel's own records add up to */}
      <Panel title={t("Accounts and cash positions")} subtitle={t("What the hotel's records add up to (opening + in − out) — check it against the bank statement; it is not read from the bank.")}
        action={<Link href="/staff/finance/accounts" className="text-xs font-medium text-muted-foreground underline-offset-4 hover:underline">{t("Accounts")}</Link>}>
        <ul className="divide-y divide-border/60">
          {o.balances.map((b) => (
            <li key={b.id}>
              <Link href={`/staff/finance/accounts/${b.id}`} className="flex items-center justify-between gap-3 py-2 text-sm hover:bg-muted/40">
                <span className="flex min-w-0 items-center gap-2"><Landmark className="size-4 shrink-0 text-muted-foreground" /><span className="truncate">{t(b.name)}</span></span>
                <span className="shrink-0 text-right tabular-nums"><span className={cn("block font-semibold", b.balance < 0 && "text-rose-600 dark:text-rose-400")}>{formatTZS(b.balance)}</span>
                  {(b.dayIn !== 0 || b.dayOut !== 0) && <span className="block text-[11px] text-muted-foreground">{t("today +{in} −{out}", { in: formatTZS(b.dayIn), out: formatTZS(b.dayOut) })}</span>}</span>
              </Link>
            </li>
          ))}
        </ul>
      </Panel>

      <nav aria-label={t("Finance pages")} className="flex flex-wrap gap-2 text-sm">
        {([["/staff/finance/ledger", t("All transactions (ledger)"), Scale], ["/staff/finance/accounts", t("All accounts"), Landmark], ["/staff/payments", t("Income"), Banknote], ["/staff/expenses", t("Expenses"), Receipt], ["/staff/collections", t("Collections"), Wallet], ["/staff/reports", t("Reports"), HandCoins], ["/staff/reports/daily", t("Daily reports"), HandCoins], ["/staff/reports/staff", t("Weekly & monthly"), HandCoins], ["/staff/shifts/all", t("Staff shifts"), HandCoins], ["/staff/settings/pricing", t("Room pricing"), Landmark]] as const).map(([href, label, Icon]) => (
          <Link key={href} href={href} className="inline-flex items-center gap-1.5 rounded-xl border border-border bg-card px-3 py-2 font-medium hover:bg-muted"><Icon className="size-4 text-muted-foreground" />{label}</Link>
        ))}
      </nav>
    </div>
  );
}

function Figure({ label, hint, value, lines, href, tone, note }: { label: string; hint: string; value: number; lines: [string, number][]; href: string; tone?: string; note?: string }) {
  return (
    <div className="flex flex-col rounded-3xl border border-border/70 bg-card p-4">
      <Link href={href} className="group block">
        <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{label}</p>
        <p className={cn("mt-1 text-2xl font-semibold tabular-nums tracking-tight", tone)}>{formatTZS(value)}</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </Link>
      <dl className="mt-3 space-y-1 border-t border-border/50 pt-2 text-xs">
        {lines.map(([k, v]) => (
          <div key={k} className="flex items-center justify-between gap-2"><dt className="truncate text-muted-foreground">{k}</dt><dd className="shrink-0 tabular-nums">{v < 0 ? "−" : ""}{formatTZS(Math.abs(v))}</dd></div>
        ))}
      </dl>
      {note && <p className="mt-2 text-[11px] text-muted-foreground">{note}</p>}
    </div>
  );
}

function Row({ label, value, sub, strong, tone }: { label: string; value: number; sub?: string; strong?: boolean; tone?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 py-2">
      <dt className={cn("min-w-0", strong ? "font-medium" : "text-muted-foreground")}>{label}{sub && <span className="block text-[11px] font-normal text-muted-foreground">{sub}</span>}</dt>
      <dd className={cn("shrink-0 tabular-nums", strong && "font-semibold", tone)}>{value < 0 ? "−" : ""}{formatTZS(Math.abs(value))}</dd>
    </div>
  );
}

