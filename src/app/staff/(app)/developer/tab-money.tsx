import type { T } from "@/i18n/translate";
import { formatTZS } from "@/lib/format";
import { WITHDRAWAL_STATUS } from "@/lib/withdrawals";
import { Panel } from "@/components/dashboard/kit";
import {
  ACCOUNT_KIND_WORDS, AGING_WORDS, METHOD_GROUP_WORDS, METHOD_GROUPS, MONEY_ROWS, CORRECTION_DAYS, WITHDRAWAL_DAYS, type MoneyByGroup, type MoneyData,
} from "@/server/services/developer-money";
import { BarChart, RankBars, type BarColumn } from "./console-charts";
import { DataTable, Dash } from "./console-table";
import { dayLabel, num, Quiet, StatBlock, Tag } from "./console-ui";

/**
 * MONEY: where the money is — read-only (the Developer never writes money). Every figure says which of the four different things it is:
 * a sale, a room night's income, a payment received, or what is still owed. Amounts are written in full (TZS 1,248,500).
 */

const METHOD_COLOUR: Record<(typeof METHOD_GROUPS)[number], string> = { cash: "#199e70", mobile: "#d95926", bank: "#3987e5", card: "#8466e0", other: "#7d8aa0" };
const INCOME = "#3987e5";
const RECEIVED = "#199e70";
const AGING_COLOUR = "#d55181";
const dayTick = (i: number, count: number) => (count - 1 - i) % 2 === 0;

/** "Cash TZS 1,000 · Mobile money TZS 200" — only the parts that are not nothing. */
function splitText(t: T, parts: MoneyByGroup): string {
  const list = METHOD_GROUPS.filter((g) => parts[g] !== 0).map((g) => `${t(METHOD_GROUP_WORDS[g])} ${formatTZS(parts[g])}`);
  return list.length ? list.join(" · ") : t("Nothing received yet.");
}

export function MoneyTab({ t, m, when }: { t: T; m: MoneyData; when: (d: Date) => string }) {
  const nothing = t("Nothing yet");
  const unread = <Quiet>{t("This could not be read just now.")}</Quiet>;
  const col = (date: string, i: number, all: unknown[], values: Record<string, number>): BarColumn => ({
    key: date, tick: dayTick(i, all.length) ? dayLabel(t, date) : "", name: dayLabel(t, date), values, emphasise: date === m.today,
  });
  const receivedColumns = m.receivedPerDay?.map((d, i, all) => col(d.date, i, all, d.byMethod));
  const incomeColumns = m.incomePerDay?.map((d, i, all) => col(d.date, i, all, { income: d.income, received: d.received }));
  const full = (v: number) => num(t, v);
  const wd = m.withdrawals;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("Where the money is. Read-only: the Developer can look at money but never changes it. A sale, the income of a room night, a payment received and what is still owed are four different things — each figure says which one it is. A hotel day runs from {start} to {start} the next morning (hotel time).", { start: m.dayStart })}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatBlock
          small label={t("Received today")} value={m.received ? formatTZS(m.received.today) : "—"} caption={t("payments recorded and on-the-spot sales, minus refunds")}
          tag={t("Money in")} tagTone="emerald" note={m.received ? splitText(t, m.received.byMethodToday) : undefined}
        />
        <StatBlock
          small label={t("Received, last 7 days")} value={m.received ? formatTZS(m.received.week) : "—"} caption={t("the same count, for today and the 6 days before")}
          tag={t("Money in")} tagTone="emerald" note={m.received ? splitText(t, m.received.byMethodWeek) : undefined}
        />
        <StatBlock
          small label={t("Owed by guests in the house")} value={m.owedInHouse ? formatTZS(m.owedInHouse.amount) : "—"} warn={!!m.owedInHouse?.amount}
          caption={m.owedInHouse ? `${t.plural(m.owedInHouse.guests, "{n} guest in the house still owes money", "{n} guests in the house still owe money")} · ${t("{amount} for the nights so far", { amount: formatTZS(m.owedInHouse.soFar) })}` : t("guests in the house")}
          tag={m.owedInHouse?.amount ? t("Not received yet") : t("Nobody owes")} tagTone={m.owedInHouse?.amount ? "amber" : "emerald"}
          note={t("The balance of each guest's whole booking — nights not yet stayed and extras included — less what they paid. It is owed, not received.")}
        />
        <StatBlock
          small label={t("Left owing after check-out")} value={m.leftOwing ? formatTZS(m.leftOwing.amount) : "—"} warn={!!m.leftOwing?.amount}
          caption={m.leftOwing ? t.plural(m.leftOwing.guests, "{n} guest left without paying in full", "{n} guests left without paying in full") : t("guests who left")}
          tag={m.leftOwing?.amount ? t("Not received yet") : t("Nobody owes")} tagTone={m.leftOwing?.amount ? "amber" : "emerald"}
          note={t("Guests who checked out with a balance still unpaid — the same figure as the front desk.")}
        />
        <StatBlock
          label={t("Online payments (nTZS)")} value={m.online ? num(t, m.online.needPerson) : "—"} caption={t("need a person")} warn={!!m.online?.needPerson}
          tag={m.online ? (m.online.waiting > 0 ? t("{n} waiting for the customer", { n: m.online.waiting }) : t("None waiting")) : undefined} tagTone={m.online?.needPerson ? "amber" : "slate"}
          note={t("Money that came in online but could not be matched by itself needs a person. Waiting = a payment prompt sent to a customer's phone in the last 7 days that is not paid yet.")}
        />
        <StatBlock
          label={t("Withdrawals")} value={wd ? num(t, wd.pending + wd.notConfirmed) : "—"} caption={t("on their way or not confirmed")} warn={!!wd?.notConfirmed}
          tag={wd ? (wd.failed > 0 ? t("{n} failed or refused in {days} days", { n: wd.failed, days: WITHDRAWAL_DAYS }) : t("None failed")) : undefined} tagTone={wd?.failed ? "amber" : "emerald"}
          note={wd ? t("Money taken out of nTZS. On its way: {pending}. Not confirmed (nTZS gave no clear answer): {unknown}.", { pending: wd.pending, unknown: wd.notConfirmed }) : undefined}
        />
        <StatBlock
          label={t("Expenses waiting")} value={m.expensesWaiting ? num(t, m.expensesWaiting.count) : "—"} caption={t("waiting for approval")}
          tag={m.expensesWaiting ? formatTZS(m.expensesWaiting.amount) : undefined} tagTone="sky"
          note={t("Expenses recorded and not yet approved. They are not counted as spent until a manager approves them.")}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("Money received per day")} subtitle={t("Money that came in each hotel day, by how it was paid. Received is not income: a guest who stays today and pays tomorrow is income today and received tomorrow. Last 14 days.")}>
          {receivedColumns
            ? <BarChart t={t} columns={receivedColumns} series={METHOD_GROUPS.map((g) => ({ key: g, label: t(METHOD_GROUP_WORDS[g]), color: METHOD_COLOUR[g] }))} caption={t("Money received per day")} empty={nothing} format={formatTZS} axis={full} negative={t("refund")} />
            : unread}
        </Panel>
        <Panel title={t("Income and money received per day")} subtitle={t("Income is what the hotel earned that day (nights stayed, food, drinks, other income). Received is the money that came in that day. They are different things, so the two bars are side by side, never added.")}>
          {incomeColumns
            ? <BarChart t={t} columns={incomeColumns} grouped series={[{ key: "income", label: t("Income"), color: INCOME }, { key: "received", label: t("Received"), color: RECEIVED }]} caption={t("Income and money received per day")} empty={nothing} format={formatTZS} axis={full} />
            : unread}
        </Panel>
        <Panel title={t("How the money came in")} subtitle={t("The last 7 days' money received, by payment method.")}>
          {m.methodShare
            ? <RankBars t={t} rows={m.methodShare.map((r) => ({ key: r.group, label: t(METHOD_GROUP_WORDS[r.group]), value: r.amount, note: `${r.percent}%` }))} color={RECEIVED} caption={t("How the money came in")} empty={nothing} format={formatTZS} />
            : unread}
        </Panel>
        <Panel title={t("What is owed, by how late")} subtitle={t("Everything still owed to the hotel: guests who are staying or left owing, company invoices and unpaid restaurant orders. A guest's bill is due the day they leave.")}>
          {m.aging
            ? (
              <div className="space-y-3">
                <RankBars t={t} rows={m.aging.rows.filter((r) => r.amount > 0).map((r) => ({ key: r.bucket, label: t(AGING_WORDS[r.bucket]), value: r.amount, note: t.plural(r.count, "{n} bill", "{n} bills") }))} color={AGING_COLOUR} caption={t("What is owed, by how late")} empty={nothing} format={formatTZS} />
                <p className="text-xs text-muted-foreground">{t("Everything owed: {total}", { total: formatTZS(m.aging.total) })}</p>
              </div>
            )
            : unread}
        </Panel>
      </div>

      <Panel title={t("The last payments")} subtitle={t("The newest {n} money-in lines: payments, refunds and on-the-spot sales (food and drinks paid at once).", { n: MONEY_ROWS.payments })}>
        {m.payments
          ? <DataTable
              empty={nothing}
              cols={[{ label: t("When") }, { label: t("For") }, { label: t("Method") }, { label: t("Account") }, { label: t("Amount"), num: true }, { label: t("Recorded by") }]}
              rows={m.payments.map((p) => ({
                key: `${p.kind}-${p.id}`,
                cells: [
                  <span key="w" className="whitespace-nowrap">{when(p.at)}</span>,
                  <span key="f" className="inline-flex flex-wrap items-center gap-1.5">
                    {p.kind === "REFUND" && <Tag tone="rose">{t("Refund")}</Tag>}
                    {p.kind === "SALE" && <Tag tone="sky">{t("Sale")}</Tag>}
                    {p.reversed && <Tag tone="slate">{t("Cancelled")}</Tag>}
                    {p.forWhat ? <span className="font-mono text-xs">{p.forWhat}</span> : <Dash />}
                  </span>,
                  t(p.method), t(p.account),
                  <span key="a" className={p.reversed ? "line-through opacity-60" : undefined}>{p.kind === "REFUND" ? `−${formatTZS(p.amount)}` : formatTZS(p.amount)}</span>,
                  p.by,
                ],
              }))}
            />
          : unread}
      </Panel>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("Cancelled and corrected money")} subtitle={t("The newest {n} payments reversed, sales or expenses cancelled and accounts corrected, from the last {days} days. Nothing is deleted: each one stays in the audit trail.", { n: MONEY_ROWS.corrections, days: CORRECTION_DAYS })}>
          {m.corrections
            ? <DataTable
                empty={nothing}
                cols={[{ label: t("When") }, { label: t("What") }, { label: t("By") }, { label: t("Amount"), num: true }]}
                rows={m.corrections.map((c) => ({
                  key: c.id,
                  cells: [
                    <span key="w" className="whitespace-nowrap">{when(c.at)}</span>,
                    <span key="x" className="block">{t(c.what)}{c.reason && <span className="block text-[11px] text-muted-foreground">{c.reason}</span>}</span>,
                    c.by,
                    c.amount === null ? <Dash key="a" /> : formatTZS(c.amount),
                  ],
                }))}
              />
            : unread}
        </Panel>
        <Panel title={t("Money accounts")} subtitle={t("What each account holds as the system books it: its opening balance plus everything booked in and out. It is the system's figure — not a count of real cash or a bank statement.")}>
          {m.accounts
            ? <DataTable
                empty={nothing}
                cols={[{ label: t("Account") }, { label: t("Kind") }, { label: t("Balance"), num: true }]}
                rows={m.accounts.map((a) => ({ key: a.id, cells: [t(a.name), t(ACCOUNT_KIND_WORDS[a.kind]), formatTZS(a.balance)] }))}
              />
            : unread}
        </Panel>
      </div>

      <Panel title={t("The last withdrawals")} subtitle={t("The newest {n} withdrawals from nTZS. Only where the money went (mobile money or bank) is shown, never the number.", { n: MONEY_ROWS.withdrawals })}>
        {m.withdrawalList
          ? <DataTable
              empty={nothing}
              cols={[{ label: t("When") }, { label: t("Number") }, { label: t("Amount"), num: true }, { label: t("To") }, { label: t("State") }]}
              rows={m.withdrawalList.map((w) => ({
                key: w.id,
                cells: [
                  <span key="w" className="whitespace-nowrap">{when(w.at)}</span>,
                  w.number ? <span key="n" className="font-mono text-xs">{w.number}</span> : <Dash key="n" />,
                  formatTZS(w.amount), t(w.destination), t(WITHDRAWAL_STATUS[w.status]?.label ?? w.status),
                ],
              }))}
            />
          : unread}
      </Panel>
    </div>
  );
}
