import { BookOpen, FileText, Banknote, Undo2 } from "lucide-react";
import type { T } from "@/i18n/translate";
import { INVOICE_STATUS_WORDS, type MoneyGlance } from "@/server/services/developer-money-glance";
import { Panel } from "@/components/dashboard/kit";
import { BarChart, RankBars, type BarColumn } from "./console-charts";
import { agoText, dayLabel, num, Quiet, StatBlock } from "./console-ui";

/**
 * MONEY, for awareness (Target Express's Money part, mapped to the hotel): bills, payments and the money book, as COUNTS only. Never an
 * amount, a balance, an account number, who paid or a single payment: those are Finance's work, and the Boss's reports are where the money
 * is read. A figure that could not be read shows "—" (or says so in its panel) while the rest still draws.
 */

const PAID = "#199e70";
const LEDGER = "#1aa3b8";
const BILLS = "#3987e5";
const METHODS = "#c98500";

/** Every other day is written under its bar (today always), so the labels never touch, even on a phone. */
const dayTick = (i: number, count: number) => (count - 1 - i) % 2 === 0;

function Row({ label, value, title }: { label: string; value: string; title?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5 text-sm">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium tabular-nums" title={title}>{value}</dd>
    </div>
  );
}

export function MoneyGlanceTab({ t, g, when, now = new Date() }: { t: T; g: MoneyGlance; when: (d: Date) => string; now?: Date }) {
  const unread = <Quiet>{t("This could not be read just now.")}</Quiet>;
  const unreadHint = t("This could not be read just now.");
  const columns = (rows: MoneyGlance["paymentsPerDay"]): BarColumn[] | null =>
    rows?.map((d, i, all) => ({ key: d.date, tick: dayTick(i, all.length) ? dayLabel(t, d.date) : "", name: dayLabel(t, d.date), values: { count: d.count }, emphasise: d.date === g.today })) ?? null;
  const paymentColumns = columns(g.paymentsPerDay);
  const ledgerColumns = columns(g.ledgerPerDay);
  /** "5 min ago" (the exact time on hover), "None yet", or "—" when it could not be read. */
  const lastText = (last: MoneyGlance["lastLedger"]) => (last === null ? "—" : last.at ? agoText(t, last.at, now) : t("None yet"));
  const lastTitle = (last: MoneyGlance["lastLedger"]) => (last === null ? unreadHint : last.at ? when(last.at) : undefined);
  const bills = g.billsByStatus?.filter((b) => b.count > 0).sort((a, b) => b.count - a.count);

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatBlock
          icon={FileText} label={t("Bills issued")} value={num(t, g.bills?.total)} caption={t("{n} paid in full", { n: num(t, g.bills?.paid) })}
          tag={t("All time")} tagTone="slate" note={t("Every bill the system has made, and how many are settled.")}
        />
        <StatBlock
          icon={Banknote} label={t("Payments (7 days)")} value={num(t, g.payments7d)} caption={t("recorded by reception and Finance")}
          tag={t("Money in")} tagTone="emerald" note={t("Payments of money received on hotel bills. Refunds, cancelled payments and restaurant sales are not counted here.")}
        />
        <StatBlock
          icon={BookOpen} label={t("Money-book lines (30 days)")} value={num(t, g.ledger30d)} caption={t("lines in the money book")}
          tag={t("Ledger")} tagTone="sky" note={t("The money book is never edited: a mistake is answered by a new line.")}
        />
        <StatBlock
          icon={Undo2} label={t("Corrections (30 days)")} value={num(t, g.corrections30d)} caption={t("lines that reverse an earlier one")}
          tag={t("Ledger")} tagTone="sky" note={t("A payment cancelled, a payment's method corrected, or a money-book line reversed.")}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("Payments recorded per day")} subtitle={t("Last 14 days, by the day the money was received.")}>
          {paymentColumns
            ? <BarChart t={t} columns={paymentColumns} series={[{ key: "count", label: t("Payments"), color: PAID }]} caption={t("Payments recorded per day")} empty={t("No payments were recorded during these 14 days.")} />
            : unread}
        </Panel>
        <Panel title={t("Money-book lines per day")} subtitle={t("Every line in the ledger, last 14 days. Lines are never edited: a mistake is answered by a new line.")}>
          {ledgerColumns
            ? <BarChart t={t} columns={ledgerColumns} series={[{ key: "count", label: t("Lines"), color: LEDGER }]} caption={t("Money-book lines per day")} empty={t("The money book had no lines during these 14 days.")} />
            : unread}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("Bills by status")} subtitle={t("How many bills are in each state.")}>
          {bills
            ? <RankBars t={t} rows={bills.map((b) => ({ key: b.status, label: t(INVOICE_STATUS_WORDS[b.status]), value: b.count }))} color={BILLS} caption={t("Bills by status")} empty={t("No bills have been made yet.")} />
            : unread}
        </Panel>
        <Panel title={t("The money book")} subtitle={t("Ledger activity and payments waiting.")}>
          <dl className="divide-y divide-border/60">
            <Row label={t("Last ledger line")} value={lastText(g.lastLedger)} title={lastTitle(g.lastLedger)} />
            <Row label={t("Lines in 30 days")} value={num(t, g.ledger30d)} title={g.ledger30d === null ? unreadHint : undefined} />
            <Row label={t("Corrections in 30 days")} value={num(t, g.corrections30d)} title={g.corrections30d === null ? unreadHint : undefined} />
            <Row label={t("Last payment recorded")} value={lastText(g.lastPayment)} title={lastTitle(g.lastPayment)} />
            <Row label={t("Online payments waiting for a person")} value={num(t, g.onlineWaiting)} title={g.onlineWaiting === null ? unreadHint : undefined} />
          </dl>
          <p className="mt-3 text-xs leading-relaxed text-muted-foreground">{t("A correction is a line that reverses an earlier one. A few are normal; many in a short time means someone is fixing mistakes again and again.")}</p>
        </Panel>
      </div>

      <Panel title={t("How people pay")} subtitle={t("Payments on hotel bills by method, last 30 days.")}>
        {g.byMethod
          ? <RankBars t={t} rows={g.byMethod.map((m) => ({ key: m.id, label: t(m.name), value: m.count }))} color={METHODS} caption={t("How people pay")} empty={t("No payments were recorded in the last 30 days.")} />
          : unread}
      </Panel>
    </div>
  );
}
