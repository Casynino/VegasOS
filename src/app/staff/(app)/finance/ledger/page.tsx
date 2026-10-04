import type { Metadata } from "next";
import Link from "next/link";
import { Download, Paperclip, Search } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { balanceBefore, getLedger, type LedgerRow } from "@/server/services/finance";
import { formatBusinessDate, formatTime, formatTZS } from "@/lib/format";
import { FinanceTabs, periodLabel, readPeriod } from "@/components/staff/finance/finance-nav";
import { AutoSelect } from "@/components/staff/finance/auto-select";
import { CancelButton, ExpenseEditButton, PaymentEditButton, ReinstateButton, type EditablePayment, type PaymentAccountOption } from "@/components/staff/finance/fix-buttons";
import { PurchaseChip } from "@/app/staff/(app)/expenses/expense-dialogs";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "General ledger" };
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
    who: x.reservation?.guest.fullName ?? x.corporateCustomer?.companyName ?? "Customer", booking: x.reservation?.reference ?? null, invoice: x.invoice?.number ?? null,
    paidOn: formatBusinessDate(x.businessDate.toISOString().slice(0, 10)), recordedBy: x.recordedBy.fullName,
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
        actions={<a href={csv} className="inline-flex h-9 items-center gap-2 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted"><Download className="size-4" />Export CSV</a>} />

      <form className="space-y-3 rounded-3xl border border-border/70 bg-card p-4">
        {Object.entries(keep).filter(([k]) => !["q", "view", "dir", "account", "category", "user", "period"].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input name="q" defaultValue={q} placeholder="Guest, room, reference, M-Pesa code, supplier, account, person…" className="h-12 w-full rounded-2xl border border-border bg-background pl-11 pr-3 text-sm" />
        </div>
        <div className="flex flex-wrap gap-2">
          <AutoSelect name="view" value={view} label="Type" options={[{ value: "all", label: "Everything" }, { value: "money", label: "Money in & out (payments)" }, { value: "income", label: "Income only" }, { value: "discounts", label: "Discounts given" }, { value: "expense", label: "Expenses only" }]} />
          <AutoSelect name="dir" value={dir} label="Direction" options={[{ value: "", label: "In & out" }, { value: "in", label: "Money in" }, { value: "out", label: "Money out" }]} />
          <AutoSelect name="account" value={accountId ?? ""} label="Account" options={[{ value: "", label: "All accounts" }, ...accounts.map((a) => ({ value: a.id, label: `${a.name}${a.isActive ? "" : " (inactive)"}` }))]} />
          <AutoSelect name="category" value={category} label="Category" options={[{ value: "", label: "All categories" }, ...catOptions.map((c) => ({ value: c, label: c }))]} />
          <AutoSelect name="user" value={userId ?? ""} label="Recorded by" options={[{ value: "", label: "Anyone" }, ...users.map((u) => ({ value: u.id, label: u.fullName }))]} />
          <AutoSelect name="period" value={p.key === "custom" ? "" : p.key} label="Date" options={[
            ...(p.key === "custom" ? [{ value: "", label: periodLabel(p) }] : []),
            { value: "today", label: "Today" }, { value: "yesterday", label: "Yesterday" }, { value: "week", label: "This week" }, { value: "month", label: "This month" }, { value: "year", label: "This year" },
          ]} />
        </div>
      </form>

      <div className="grid overflow-hidden rounded-3xl border border-border/70 sm:grid-cols-3">
        <div className="bg-linear-to-br from-emerald-500/[0.12] to-transparent p-5">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Money in</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">{formatTZS(moneyIn)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Guest payments, dining & bar sales, owner money</p>
        </div>
        <div className="border-t border-border/70 bg-linear-to-br from-rose-500/[0.12] to-transparent p-5 sm:border-l sm:border-t-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Money out</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums text-rose-600 dark:text-rose-400">{formatTZS(moneyOut)}</p>
          <p className="mt-1 text-xs text-muted-foreground">Costs paid, refunds, owner withdrawals</p>
        </div>
        <div className="border-t border-border/70 bg-linear-to-br from-sky-500/[0.1] to-transparent p-5 sm:border-l sm:border-t-0">
          <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">Net</p>
          <p className="mt-1 text-2xl font-semibold tabular-nums">{formatTZS(moneyIn - moneyOut)}</p>
          <p className="mt-1 text-xs text-muted-foreground">{posted.length} movements{cancelled ? ` · ${cancelled} cancelled, not counted` : ""} · earned {formatTZS(earned)} · spent {formatTZS(spent)}</p>
        </div>
      </div>

      <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/70 px-4 py-3 text-sm">
          <span className="font-semibold">{periodLabel(p)}</span>
          <span className="text-muted-foreground">Opening balance{accountId ? ` · ${accounts.find((a) => a.id === accountId)?.name}` : " · all accounts"} <strong className="tabular-nums text-foreground">{formatTZS(opening)}</strong> → closing <strong className="tabular-nums text-foreground">{formatTZS(bal)}</strong></span>
        </div>
        {shown.length === 0 ? <p className="p-10 text-center text-sm text-muted-foreground">Nothing recorded in this period.</p> : (
          <div className="overflow-x-auto">
            <table data-stack className="w-full min-w-[1180px] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border/70">
                  <th className="px-4 py-3 font-medium">Date</th><th className="px-3 py-3 font-medium">Description</th><th className="px-3 py-3 font-medium">Type</th>
                  <th className="px-3 py-3 font-medium">Account</th><th className="px-3 py-3 font-medium">By</th>
                  <th className="px-3 py-3 text-right font-medium">Debit</th><th className="px-3 py-3 text-right font-medium">Credit (in)</th>
                  <th className="px-3 py-3 text-right font-medium">Balance</th><th className="px-3 py-3 text-center font-medium">Proof</th><th className="px-4 py-3 text-right font-medium">Fix</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {shown.map((r) => <Row key={r.id} r={{ ...r, attachment: proofOf(r) }} balance={balance.get(r.id)!} accountNumber={accountNumber.get(r.accountId ?? "") ?? null}
                  fix={<Fix r={r} perms={perms} exp={r.source === "EXPENSE" ? expenses.get(r.id.slice(2)) : undefined} pay={payments.get(r.id.slice(2))} receiving={receiving} categories={categories} accounts={accountOptions} methodAccount={methodAccount} />} />)}
              </tbody>
            </table>
          </div>
        )}
        {rows.length > LIMIT && <p className="border-t border-border/70 px-4 py-2 text-xs text-muted-foreground">Showing the latest {LIMIT} of {rows.length}. Narrow the dates or export CSV for everything.</p>}
      </section>
    </div>
  );
}

function Row({ r, balance, accountNumber, fix }: { r: LedgerRow; balance: number; accountNumber: string | null; fix: React.ReactNode }) {
  const off = r.status !== "POSTED";
  // The owner taking money out (or putting it in) is special: it must never blend in with costs.
  const owner = r.source === "MOVEMENT" && r.category === "Owner";
  const earnedOnly = r.moneyIn === 0 && r.moneyOut === 0 && (r.income !== 0 || r.expense !== 0) && !off;
  return (
    <tr className={cn("align-middle hover:bg-muted/25", off && "text-muted-foreground", owner && !off && "bg-amber-500/[0.07] shadow-[inset_4px_0_0_0_var(--color-amber-500)] hover:bg-amber-500/[0.1]")}>
      <td className="whitespace-nowrap px-4 py-3 text-xs">{formatBusinessDate(r.businessDate)}<span className="block text-[10px] text-muted-foreground">{r.source === "ROOM" && r.via === "Night of the stay" ? "night" : formatTime(r.at)}</span></td>
      <td className="max-w-[24rem] px-3 py-3">
        <p className="flex flex-wrap items-center gap-1.5">
          {off && <span className="rounded bg-muted px-1.5 py-px text-[10px] font-semibold uppercase">{r.status === "PENDING" ? "Waiting" : "Cancelled"}</span>}
          {r.href ? <Link href={r.href} className={cn("font-medium hover:underline", off && r.status !== "PENDING" && "line-through")}>{r.description}</Link> : <span className={cn("font-medium", off && "line-through")}>{r.description}</span>}
          {earnedOnly && <span className="rounded-full bg-emerald-500/12 px-2 py-px text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">Earned {r.income.toLocaleString("en-US")}</span>}
          {r.tag && <span className={cn("rounded-full px-2 py-px text-[10px] font-semibold", r.tag.startsWith("Account") ? "bg-violet-500/12 text-violet-700 dark:text-violet-300"
            : r.tag.startsWith("Purchase") ? "bg-[oklch(0.75_0.12_80)]/15 text-[oklch(0.55_0.11_75)] dark:text-[oklch(0.82_0.1_82)]" : "bg-rose-500/12 text-rose-700 dark:text-rose-300")}>{r.tag}</span>}
        </p>
        {r.gross != null && (r.discount ?? 0) > 0 ? (
          <p className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
            <span className="rounded-md bg-muted px-1.5 py-px tabular-nums">Price {r.gross.toLocaleString("en-US")}</span>
            <span className="rounded-md bg-emerald-500/12 px-1.5 py-px tabular-nums text-emerald-700 dark:text-emerald-300">− {r.discount!.toLocaleString("en-US")}</span>
            <span className="rounded-md bg-foreground/[0.07] px-1.5 py-px font-semibold tabular-nums">= {r.income.toLocaleString("en-US")}</span>
            <span className="truncate text-muted-foreground">{r.note?.split(" = ")[0].replace(/^[\d,]+ − /, "")}</span>
          </p>
        ) : null}
        <p className="mt-0.5 truncate font-mono text-[11px] text-muted-foreground">{[r.reference, r.gross != null && (r.discount ?? 0) > 0 ? null : r.note].filter(Boolean).join(" · ")}</p>
      </td>
      <td className={cn("px-3 py-3 text-xs font-medium", TYPE_TONE[r.source])}>
        {owner ? <span className="inline-flex whitespace-nowrap rounded-full bg-amber-500 px-2.5 py-0.5 text-[11px] font-semibold text-black">{r.moneyOut > 0 || r.type.includes("out") ? "Owner withdrawal" : "Owner money in"}</span> : r.category}
        <span className="block text-[10px] font-normal text-muted-foreground">{r.type}</span>
      </td>
      <td className="px-3 py-3 text-xs">{r.account ?? "—"}{r.account && accountNumber && <span className="block font-mono text-[10px] text-muted-foreground">{accountNumber}</span>}</td>
      <td className="px-3 py-3 text-xs">{r.by ?? "—"}{r.via && <span className="block text-[10px] text-muted-foreground">via {r.via}</span>}</td>
      <td className="px-3 py-3 text-right font-mono text-[13px] tabular-nums text-rose-600 dark:text-rose-400">{r.moneyOut ? <span className={cn(off && "line-through")}>{money(r.moneyOut)}</span> : off && r.source === "EXPENSE" ? <s>{money(r.expense || Number(r.note?.match(/[\d,]+/)?.[0]?.replace(/,/g, "")) || 0)}</s> : "—"}</td>
      <td className="px-3 py-3 text-right font-mono text-[13px] tabular-nums text-emerald-600 dark:text-emerald-400">{r.moneyIn ? money(r.moneyIn) : "—"}</td>
      <td className="px-3 py-3 text-right font-mono text-[13px] font-semibold tabular-nums">{money(balance)}</td>
      <td className="px-3 py-3 text-center">{r.attachment ? <a href={r.attachment} target="_blank" rel="noreferrer" title="Open the proof" className="inline-grid size-8 place-items-center rounded-lg hover:bg-muted"><Paperclip className="size-3.5" /></a> : <span className="text-muted-foreground">—</span>}</td>
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
        <CancelButton kind="expense" id={exp.id} label={exp.number ?? "this expense"} />
      </>
    );
  }
  if (r.status !== "POSTED") return null;
  if ((r.source === "PAYMENT" || r.source === "REFUND") && r.tag !== "Reversed later") {
    return (
      <>
        {pay && perms.correct && <PaymentEditButton payment={pay} accounts={receiving} canReference={perms.payment} />}
        {perms.payment && reservationId && <CancelButton kind="payment" id={id} reservationId={reservationId} label="this payment" />}
      </>
    );
  }
  if (r.source === "CHARGE" && perms.payment && reservationId) return <CancelButton kind="charge" id={id} reservationId={reservationId} label="this room-bill item" />;
  if (r.source === "SALE" && perms.sale) return <CancelButton kind="sale" id={id} label="this sale" />;
  if (r.source === "MOVEMENT" && perms.movement) return <CancelButton kind="movement" id={id} label={r.reference ?? "this movement"} />;
  return null;
}
