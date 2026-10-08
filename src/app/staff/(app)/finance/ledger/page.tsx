import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import Link from "next/link";
import { Download, Paperclip, Search } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { balanceBefore, getLedger, type LedgerRow } from "@/server/services/finance";
import { formatTZS } from "@/lib/format";
import type { T } from "@/i18n/translate";
import { FinanceTabs, periodLabel, readPeriod } from "@/components/staff/finance/finance-nav";
import { AutoSelect } from "@/components/staff/finance/auto-select";
import { CancelButton, ExpenseEditButton, PaymentEditButton, ReinstateButton, type EditablePayment, type PaymentAccountOption } from "@/components/staff/finance/fix-buttons";
import { PurchaseChip } from "@/app/staff/(app)/expenses/expense-dialogs";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("General ledger") };
}
const LIMIT = 400;

const TYPE_TONE: Record<string, string> = {
  ROOM: "text-emerald-700 dark:text-emerald-300", CHARGE: "text-emerald-700 dark:text-emerald-300", SALE: "text-emerald-700 dark:text-emerald-300",
  MEETING: "text-emerald-700 dark:text-emerald-300", PAYMENT: "text-sky-700 dark:text-sky-300", REFUND: "text-amber-700 dark:text-amber-300", REVERSAL: "text-rose-700 dark:text-rose-300", CORRECTION: "text-violet-700 dark:text-violet-300",
  EXPENSE: "text-rose-700 dark:text-rose-300", MOVEMENT: "text-violet-700 dark:text-violet-300", INVOICE: "text-amber-700 dark:text-amber-300",
};
const money = (v: number) => `TZS ${v.toLocaleString("en-US")}`;

/**
 * General ledger — every movement of money (payments in, sales, refunds,
 * expenses, transfers, owner money, corrections) with its account, who
 * recorded it and a running balance; and everything the hotel earned
 * (room nights, room-bill items) so income is visible too.
 * Nothing is deleted: cancelled lines stay, struck through, and can be reinstated.
 */
export default async function LedgerPage({ searchParams }: PageProps<"/staff/finance/ledger">) {
  const user = await requirePagePermission("ledger.view", "finance.view");
  const t = await getT();
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const today = await businessToday();
  const p = readPeriod(sp, today, "week");
  const view = (["all", "income", "expense", "money", "discounts"].includes(str(sp.view)) ? str(sp.view) : "all") as "all" | "income" | "expense" | "money" | "discounts";
  const dir = str(sp.dir) as "" | "in" | "out";
  const accountId = str(sp.account) || null;
  const userId = str(sp.user) || null;
  const category = str(sp.category);
  const q = str(sp.q).trim();

  const [{ rows: allRows }, accounts, users, categories, methods] = await Promise.all([
    getLedger({ from: p.from, to: p.to, view, accountId, userId, q }),
    db.moneyAccount.findMany({ orderBy: { sortOrder: "asc" }, include: { paymentMethods: { where: { isActive: true }, select: { id: true } } } }),
    db.user.findMany({ where: { isActive: true, role: { code: { not: "DRIVER" } } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    db.expenseCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    db.paymentMethod.findMany({ select: { id: true, accountId: true } }),
  ]);
  const rows = allRows
    .filter((r) => !category || r.category === category)
    .filter((r) => !dir || (dir === "in" ? r.moneyIn > 0 || (r.status !== "POSTED" && r.source !== "EXPENSE") : r.moneyOut > 0 || (r.status !== "POSTED" && r.source === "EXPENSE")));
  const shown = rows.slice(0, LIMIT);

  // Running balance of the chosen account (or of all accounts together), oldest → newest.
  const opening = accountId ? await balanceBefore(accountId, p.from) : (await Promise.all(accounts.map((a) => balanceBefore(a.id, p.from)))).reduce((s, v) => s + v, 0);
  const balance = new Map<string, number>();
  let bal = opening;
  for (const r of [...rows].reverse()) {
    if (r.status === "POSTED") bal += r.moneyIn - r.moneyOut;
    balance.set(r.id, bal);
  }
  const posted = rows.filter((r) => r.status === "POSTED");
  const moneyIn = posted.reduce((s, r) => s + r.moneyIn, 0);
  const moneyOut = posted.reduce((s, r) => s + r.moneyOut, 0);
  const earned = posted.reduce((s, r) => s + r.income, 0);
  const spent = posted.reduce((s, r) => s + r.expense, 0);
  const cancelled = rows.filter((r) => r.status !== "POSTED" && r.status !== "PENDING").length;

  // Expense details for inline "Correct this record".
  const expenseIds = shown.filter((r) => r.source === "EXPENSE").map((r) => r.id.slice(2));
  const expenses = new Map((await db.expense.findMany({ where: { id: { in: expenseIds } }, include: { stockRequest: { select: { number: true, purchaseNumber: true } } } })).map((e) => [e.id, e]));
  // A stock purchase's receipt opens for whoever buys or approves (and finance) — not for staff who only ask.
  const seesPurchaseReceipt = can(user, "finance.view") || can(user, "expenses.view_all") || can(user, "inventory.receive") || can(user, "expenses.approve");
  const proofOf = (r: LedgerRow) => (r.source === "EXPENSE" && !seesPurchaseReceipt && expenses.get(r.id.slice(2))?.stockRequest ? null : r.attachment);
  const active = accounts.filter((a) => a.isActive);
  const accountOptions = active.filter((a) => a.acceptsExpenses).map((a) => ({ id: a.id, name: a.name, methodId: a.paymentMethods[0]?.id ?? null }));
  const accountNumber = new Map(accounts.map((a) => [a.id, a.accountNumber]));

  // Payment details for inline "Correct this record" (account + reference; never the amount).
  const paymentIds = shown.filter((r) => (r.source === "PAYMENT" || r.source === "REFUND") && r.status === "POSTED" && r.tag !== "Reversed later").map((r) => r.id.slice(2));
  const payments = new Map((await db.payment.findMany({
    where: { id: { in: paymentIds }, status: "POSTED" },
    include: { method: true, recordedBy: { select: { fullName: true } }, reservation: { select: { reference: true, guest: { select: { fullName: true } } } }, invoice: { select: { number: true } }, corporateCustomer: { select: { companyName: true } } },
  })).map((x): [string, EditablePayment] => [x.id, {
    id: x.id, reservationId: x.reservationId, amount: x.amount, refund: x.kind === "REFUND", accountId: x.accountId, method: x.method.name, reference: x.reference ?? "",
    who: x.reservation?.guest.fullName ?? x.corporateCustomer?.companyName ?? t("Customer"), booking: x.reservation?.reference ?? null, invoice: x.invoice?.number ?? null,
    paidOn: t.date(x.businessDate.toISOString().slice(0, 10)), recordedBy: x.recordedBy.fullName,
  }]));
  const receiving: PaymentAccountOption[] = active.filter((a) => a.acceptsPayments).map((a) => ({ id: a.id, name: a.name, number: a.accountNumber, holder: a.holderName }));
  const methodAccount = new Map(methods.map((m) => [m.id, m.accountId]));
  const perms = {
    expense: can(user, "expenses.void"), ownExpense: can(user, "expenses.record"), userId: user.id, today,
    correct: can(user, "payments.record"), payment: can(user, "payments.reverse"), sale: can(user, "revenue.void"), movement: can(user, "finance.manage"),
  };

  const keep = Object.fromEntries(Object.entries({ view, dir, account: accountId ?? "", user: userId ?? "", category, q, ...(p.key === "custom" ? { from: p.from, to: p.to } : { period: p.key }) }).filter(([, v]) => v));
  const csv = `/api/finance/ledger?${new URLSearchParams({ from: p.from, to: p.to, ...Object.fromEntries(Object.entries(keep).filter(([k]) => !["period", "from", "to", "dir", "category"].includes(k))) })}`;
  const catOptions = [...new Set(allRows.map((r) => r.category))].sort();

  return (
    <div className="w-full space-y-5">
      <FinanceTabs active="/staff/finance/ledger" limited={!can(user, "finance.view")}
        actions={<a href={csv} className="inline-flex h-9 items-center gap-2 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted"><Download className="size-4" />{t("Export CSV")}</a>} />

      <form className="space-y-3 rounded-3xl border border-border/70 bg-card p-4">
        {Object.entries(keep).filter(([k]) => !["q", "view", "dir", "account", "category", "user", "period"].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input name="q" defaultValue={q} placeholder={t("Guest, room, reference, M-Pesa code, supplier, account, person…")} className="h-12 w-full rounded-2xl border border-border bg-background pl-11 pr-3 text-sm" />
        </div>
        <div className="flex flex-wrap gap-2">
          <AutoSelect name="view" value={view} label={t("Type")} options={[{ value: "all", label: t("Everything") }, { value: "money", label: t("Money in & out (payments)") }, { value: "income", label: t("Income only") }, { value: "discounts", label: t("Discounts given") }, { value: "expense", label: t("Expenses only") }]} />
          <AutoSelect name="dir" value={dir} label={t("Direction")} options={[{ value: "", label: t("In & out") }, { value: "in", label: t("Money in") }, { value: "out", label: t("Money out") }]} />
          <AutoSelect name="account" value={accountId ?? ""} label={t("Account")} options={[{ value: "", label: t("All accounts") }, ...accounts.map((a) => ({ value: a.id, label: a.isActive ? t(a.name) : t("{name} (inactive)", { name: t(a.name) }) }))]} />
          <AutoSelect name="category" value={category} label={t("Category")} options={[{ value: "", label: t("All categories") }, ...catOptions.map((c) => ({ value: c, label: t.ctx("money", c) }))]} />
          <AutoSelect name="user" value={userId ?? ""} label={t("Recorded by")} options={[{ value: "", label: t("Anyone") }, ...users.map((u) => ({ value: u.id, label: u.fullName }))]} />
          <AutoSelect name="period" value={p.key === "custom" ? "" : p.key} label={t("Date")} options={[
            ...(p.key === "custom" ? [{ value: "", label: periodLabel(p, t) }] : []),
            { value: "today", label: t("Today") }, { value: "yesterday", label: t("Yesterday") }, { value: "week", label: t("This week") }, { value: "month", label: t("This month") }, { value: "year", label: t("This year") },
          ]} />
        </div>
      </form>

      <div className="grid overflow-hidden rounded-3xl border border-border/70 sm:grid-cols-3">
        <div className="bg-linear-to-br from-emerald-500/[0.12] to-transparent p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Money in")}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatTZS(moneyIn)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("Guest payments, dining & bar sales, owner money")}</p>
        </div>
        <div className="border-t border-border/70 bg-linear-to-br from-rose-500/[0.12] to-transparent p-5 sm:border-l sm:border-t-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Money out")}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-rose-600 dark:text-rose-400">{formatTZS(moneyOut)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("Costs paid, refunds, owner withdrawals")}</p>
        </div>
        <div className="border-t border-border/70 bg-linear-to-br from-sky-500/[0.1] to-transparent p-5 sm:border-l sm:border-t-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Net")}</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatTZS(moneyIn - moneyOut)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{t("{n} movements", { n: posted.length })}{cancelled ? ` · ${t("{n} cancelled, not counted", { n: cancelled })}` : ""} · {t("earned {amount}", { amount: formatTZS(earned) })} · {t("spent {amount}", { amount: formatTZS(spent) })}</p>
        </div>
      </div>

      <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3 text-sm">
          <span className="font-semibold">{periodLabel(p, t)}</span>
          <span className="text-muted-foreground">{t.rich("Opening balance · {account} <b>{opening}</b> → closing <b>{closing}</b>", { b: (c) => <strong className="tabular-nums text-foreground">{c}</strong> }, { account: accountId ? t(accounts.find((a) => a.id === accountId)?.name ?? "") : t("all accounts"), opening: formatTZS(opening), closing: formatTZS(bal) })}</span>
        </div>
        {shown.length === 0 ? <p className="p-10 text-center text-sm text-muted-foreground">{t("Nothing recorded in this period.")}</p> : (
          <div className="overflow-x-auto">
            <table data-stack className="w-full min-w-[1180px] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border/70">
                  <th className="px-4 py-3 font-medium">{t("Date")}</th><th className="px-3 py-3 font-medium">{t("Description")}</th><th className="px-3 py-3 font-medium">{t("Type")}</th>
                  <th className="px-3 py-3 font-medium">{t("Account")}</th><th className="px-3 py-3 font-medium">{t("By")}</th>
                  <th className="px-3 py-3 text-right font-medium">{t("Debit")}</th><th className="px-3 py-3 text-right font-medium">{t("Credit (in)")}</th>
                  <th className="px-3 py-3 text-right font-medium">{t("Balance")}</th><th className="px-3 py-3 text-center font-medium">{t("Proof")}</th><th className="px-4 py-3 text-right font-medium">{t("Fix")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {shown.map((r) => <Row key={r.id} t={t} r={{ ...r, attachment: proofOf(r) }} balance={balance.get(r.id)!} accountNumber={accountNumber.get(r.accountId ?? "") ?? null}
                  fix={<Fix r={r} perms={perms} exp={r.source === "EXPENSE" ? expenses.get(r.id.slice(2)) : undefined} pay={payments.get(r.id.slice(2))} receiving={receiving} categories={categories} accounts={accountOptions} methodAccount={methodAccount} />} />)}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > LIMIT && <p className="border-t border-border/70 px-4 py-2 text-xs text-muted-foreground">{t("Showing the latest {n} of {total}. Narrow the dates or export CSV for everything.", { n: LIMIT, total: rows.length })}</p>}
      </section>
    </div>
  );
}

function Row({ r, balance, accountNumber, fix, t }: { r: LedgerRow; balance: number; accountNumber: string | null; fix: React.ReactNode; t: T }) {
  const off = r.status !== "POSTED";
  // The owner taking money out (or putting it in) is special: it must never blend in with costs.
  const owner = r.source === "MOVEMENT" && r.category === "Owner";
  const earnedOnly = r.moneyIn === 0 && r.moneyOut === 0 && (r.income !== 0 || r.expense !== 0) && !off;
  return (
    <tr className={cn("align-middle hover:bg-muted/25", off && "text-muted-foreground", owner && !off && "bg-amber-500/[0.07] shadow-[inset_4px_0_0_0_var(--color-amber-500)] hover:bg-amber-500/[0.1]")}>
      <td className="whitespace-nowrap px-4 py-3 text-xs">{t.date(r.businessDate)}<span className="block text-[10px] text-muted-foreground">{r.source === "ROOM" && r.via === "Night of the stay" ? t("night") : t.time(r.at)}</span></td>
      <td className="max-w-[24rem] px-3 py-3">
        <p className="flex flex-wrap items-center gap-1.5">
          {off && <span className="rounded bg-muted px-1.5 py-px text-[10px] font-semibold uppercase">{r.status === "PENDING" ? t("Waiting") : t("Cancelled")}</span>}
          {r.href ? <Link href={r.href} className={cn("font-medium hover:underline", off && r.status !== "PENDING" && "line-through")}>{r.description}</Link> : <span className={cn("font-medium", off && "line-through")}>{r.description}</span>}
          {earnedOnly && <span className="rounded-full bg-emerald-500/12 px-2 py-px text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">{t("Earned {amount}", { amount: r.income.toLocaleString("en-US") })}</span>}
          {r.tag && <span className={cn("rounded-full px-2 py-px text-[10px] font-semibold", r.tag.startsWith("Account") ? "bg-violet-500/12 text-violet-700 dark:text-violet-300"
            : r.tag.startsWith("Purchase") ? "bg-[oklch(0.75_0.12_80)]/15 text-[oklch(0.55_0.11_75)] dark:text-[oklch(0.82_0.1_82)]" : "bg-rose-500/12 text-rose-700 dark:text-rose-300")}>{t(r.tag)}</span>}
        </p>
        {r.gross != null && (r.discount ?? 0) > 0 ? (
          <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
            <span className="rounded-md bg-muted px-1.5 py-px tabular-nums">{t("Price {amount}", { amount: r.gross.toLocaleString("en-US") })}</span>
            <span className="rounded-md bg-emerald-500/12 px-1.5 py-px tabular-nums text-emerald-700 dark:text-emerald-300">− {r.discount!.toLocaleString("en-US")}</span>
            <span className="rounded-md bg-foreground/[0.07] px-1.5 py-px font-semibold tabular-nums">= {r.income.toLocaleString("en-US")}</span>
            <span className="truncate text-muted-foreground">{r.note?.split(" = ")[0].replace(/^[\d,]+ − /, "")}</span>
          </p>
        ) : null}
        <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{[r.reference, r.gross != null && (r.discount ?? 0) > 0 ? null : r.note && t(r.note)].filter(Boolean).join(" · ")}</p>
      </td>
      <td className={cn("px-3 py-3 text-xs font-medium", TYPE_TONE[r.source])}>
        {owner ? <span className="inline-flex whitespace-nowrap rounded-full bg-amber-500 px-2.5 py-0.5 text-[11px] font-semibold text-black">{r.moneyOut > 0 || r.type.includes("out") ? t("Owner withdrawal") : t("Owner money in")}</span> : t.ctx("money", r.category)}
        <span className="block text-[10px] font-normal text-muted-foreground">{t(r.type)}</span>
      </td>
      <td className="px-3 py-3 text-xs">{r.account ? t(r.account) : "—"}{r.account && accountNumber && <span className="block font-mono text-[10px] text-muted-foreground">{accountNumber}</span>}</td>
      <td className="px-3 py-3 text-xs">{r.by ?? "—"}{r.via && <span className="block text-[10px] text-muted-foreground">{t("via {how}", { how: t(r.via) })}</span>}</td>
      <td className="px-3 py-3 text-right font-mono text-[13px] tabular-nums text-rose-600 dark:text-rose-400">{r.moneyOut ? <span className={cn(off && "line-through")}>{money(r.moneyOut)}</span> : off && r.source === "EXPENSE" ? <s>{money(r.expense || Number(r.note?.match(/[\d,]+/)?.[0]?.replace(/,/g, "")) || 0)}</s> : "—"}</td>
      <td className="px-3 py-3 text-right font-mono text-[13px] tabular-nums text-emerald-600 dark:text-emerald-400">{r.moneyIn ? money(r.moneyIn) : "—"}</td>
      <td className="px-3 py-3 text-right font-mono text-[13px] font-semibold tabular-nums">{money(balance)}</td>
      <td className="px-3 py-3 text-center">{r.attachment ? <a href={r.attachment} target="_blank" rel="noreferrer" title={t("Open the proof")} className="inline-grid size-8 place-items-center rounded-lg hover:bg-muted"><Paperclip className="size-3.5" /></a> : <span className="text-muted-foreground">—</span>}</td>
      <td className="px-4 py-3"><div className="flex justify-end gap-1.5">{fix}</div></td>
    </tr>
  );
}

type Perms = { expense: boolean; ownExpense: boolean; userId: string; today: string; correct: boolean; payment: boolean; sale: boolean; movement: boolean };
type ExpenseLite = {
  id: string; number: string | null; categoryId: string; amount: number; description: string; payee: string | null; reference: string | null; notes: string | null; businessDate: Date;
  accountId: string | null; paymentMethodId: string | null; status: string; voidReason: string | null; createdById: string;
  /** Made by a stock purchase's final approval. */
  stockRequest: { number: string; purchaseNumber: string | null } | null;
};

function Fix({ r, perms, exp, pay, receiving, categories, accounts, methodAccount }: {
  r: LedgerRow; perms: Perms; exp?: ExpenseLite; pay?: EditablePayment; receiving: PaymentAccountOption[];
  categories: { id: string; name: string }[]; accounts: { id: string; name: string; methodId: string | null }[]; methodAccount: Map<string, string | null>;
}) {
  const id = r.id.slice(2);
  const reservationId = r.href?.match(/\/staff\/reservations\/([^/#?]+)/)?.[1];
  // A stock purchase's expense changes only from the purchase (the stock came in with it).
  if (r.source === "EXPENSE" && exp?.stockRequest) return <PurchaseChip purchase={exp.stockRequest.purchaseNumber ?? exp.stockRequest.number} />;
  // Expenses: a manager fixes or cancels any; staff fix or cancel their own on the day they recorded it.
  if (r.source === "EXPENSE" && exp && (perms.expense || perms.ownExpense)) {
    if (exp.status === "VOIDED") return !perms.expense || exp.voidReason?.startsWith("Corrected:") ? null : <ReinstateButton expenseId={exp.id} />;
    if (exp.status === "REJECTED") return null;
    return (
      <>
        <ExpenseEditButton manager={perms.expense} categories={categories} accounts={accounts}
          expense={{ id: exp.id, number: exp.number, categoryId: exp.categoryId, amount: exp.amount, description: exp.description, payee: exp.payee ?? "", reference: exp.reference ?? "", notes: exp.notes ?? "", date: exp.businessDate.toISOString().slice(0, 10), accountId: exp.accountId ?? (exp.paymentMethodId ? methodAccount.get(exp.paymentMethodId) ?? "" : ""), paymentMethodId: exp.paymentMethodId ?? "", status: exp.status }} />
        <CancelButton kind="expense" id={exp.id} label={exp.number ?? msg("this expense")} />
      </>
    );
  }
  if (r.status !== "POSTED") return null;
  if ((r.source === "PAYMENT" || r.source === "REFUND") && r.tag !== "Reversed later") {
    return (
      <>
        {pay && perms.correct && <PaymentEditButton payment={pay} accounts={receiving} canReference={perms.payment} />}
        {perms.payment && reservationId && <CancelButton kind="payment" id={id} reservationId={reservationId} label={msg("this payment")} />}
      </>
    );
  }
  if (r.source === "CHARGE" && perms.payment && reservationId) return <CancelButton kind="charge" id={id} reservationId={reservationId} label={msg("this room-bill item")} />;
  if (r.source === "SALE" && perms.sale) return <CancelButton kind="sale" id={id} label={msg("this sale")} />;
  if (r.source === "MOVEMENT" && perms.movement) return <CancelButton kind="movement" id={id} label={r.reference ?? msg("this movement")} />;
  return null;
}
