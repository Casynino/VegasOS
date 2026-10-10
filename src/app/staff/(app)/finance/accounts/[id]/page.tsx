import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowDownLeft, ArrowLeft, ArrowUpRight, Info, Paperclip, Search } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { accountActivity, ACTIVITY_LABEL, KIND_LABEL, sumIn, sumOut, type ActivityRow, type ActivityType } from "@/server/services/payment-accounts";
import { accountBalances } from "@/server/services/finance";
import { accountLook, spacedNumber } from "@/lib/account-look";
import { CancelButton, ExpenseEditButton, PaymentEditButton, type EditableExpense, type EditablePayment, type PaymentAccountOption } from "@/components/staff/finance/fix-buttons";
import { CashCountButton, MovementButton, PaymentAccountButton } from "../account-dialogs";
import { ExpenseDialog, PurchaseChip } from "@/app/staff/(app)/expenses/expense-dialogs";
import { expenseTypes } from "@/server/services/expenses";
import { presetRange } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { FinanceTabs, PeriodPicker, periodLabel, readPeriod } from "@/components/staff/finance/finance-nav";
import { AutoSelect } from "@/components/staff/finance/auto-select";
import { cn } from "@/lib/utils";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Payment account") };
}
const MONEY_IN: ActivityType[] = ["ROOM", "COMPANY", "MEETING", "RESTAURANT", "BAR", "SALE", "OTHER_PAYMENT", "OTHER_INCOME"];
const MONEY_OUT: ActivityType[] = ["EXPENSE", "REFUND"];

/**
 * One payment account: its details, what it received and paid out (from recorded
 * transactions only — not the bank's balance), and every transaction with who recorded it.
 */
export default async function AccountDetailPage({ params, searchParams }: PageProps<"/staff/finance/accounts/[id]">) {
  const user = await requirePagePermission("ledger.view", "finance.view");
  const t = await getT();
  const { id } = await params;
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const account = await db.moneyAccount.findUnique({ where: { id } });
  if (!account) notFound();
  const today = await businessToday();
  const p = readPeriod(sp, today, "month");
  const dir = str(sp.dir);
  const type = str(sp.type) as ActivityType | "";
  const staff = str(sp.staff);
  const q = str(sp.q).trim().toLowerCase();

  const week = presetRange("week", today);
  const month = presetRange("month", today);
  const recentFrom = week.from < month.from ? week.from : month.from;
  const [rows, recent, counts, books, all] = await Promise.all([
    accountActivity(id, p.from, p.to),
    accountActivity(id, recentFrom, today),
    Promise.all([
      db.payment.count({ where: { accountId: id } }), db.revenueTransaction.count({ where: { accountId: id } }),
      db.expense.count({ where: { accountId: id } }), db.ledgerEntry.count({ where: { OR: [{ accountId: id }, { toAccountId: id }] } }),
    ]),
    accountBalances(today, true),
    db.moneyAccount.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, include: { paymentMethods: { where: { isActive: true }, select: { id: true } } } }),
  ]);
  const held = books.find((b) => b.id === id);
  const within = (r: ActivityRow, from: string) => r.businessDate >= from && r.businessDate <= today;
  const tiles = [
    { label: t("Received today"), value: sumIn(recent.filter((r) => r.businessDate === today)), tone: "in" },
    { label: t("Received this week"), value: sumIn(recent.filter((r) => within(r, week.from))), tone: "in" },
    { label: t("Received this month"), value: sumIn(recent.filter((r) => within(r, month.from))), tone: "in" },
    { label: t("Paid out this month"), value: sumOut(recent.filter((r) => within(r, month.from))), tone: "out" },
  ] as const;

  const shown = rows.filter((r) =>
    (!dir || (dir === "in" ? r.amount > 0 : r.amount < 0))
    && (!type || r.type === type)
    && (!staff || r.byId === staff)
    && (!q || [r.description, r.party, r.reference, r.room, r.tag].some((v) => v?.toLowerCase().includes(q))));
  const staffOptions = [...new Map(rows.map((r) => [r.byId, r.by])).entries()].filter(([k]) => k).sort((a, b) => a[1].localeCompare(b[1]));
  const typeOptions = [...new Set(rows.map((r) => r.type))];
  const keep: Record<string, string> = Object.fromEntries(Object.entries({ dir, type, staff, q: str(sp.q), ...(p.key === "custom" ? { from: p.from, to: p.to } : { period: p.key }) }).filter(([, v]) => v));
  const look = accountLook(account.kind);
  const periodIn = sumIn(shown);
  const periodOut = sumOut(shown);

  // What each row may be fixed with (same rules as the general ledger).
  const perms = {
    correct: can(user, "payments.record"), reverse: can(user, "payments.reverse"), expense: can(user, "expenses.void"),
    ownExpense: can(user, "expenses.record"), sale: can(user, "revenue.void"), movement: can(user, "finance.manage"),
  };
  const ids = (prefix: string) => shown.filter((r) => r.id.startsWith(prefix)).map((r) => r.id.slice(2));
  const canSpend = account.isActive && account.acceptsExpenses && can(user, "expenses.record");
  const [pays, exps, categories, types, methods] = await Promise.all([
    db.payment.findMany({
      where: { id: { in: ids("p-") }, status: "POSTED" },
      include: { method: true, recordedBy: { select: { fullName: true } }, reservation: { select: { reference: true, guest: { select: { fullName: true } } } }, invoice: { select: { number: true } }, corporateCustomer: { select: { companyName: true } } },
    }),
    db.expense.findMany({ where: { id: { in: ids("e-") } }, include: { stockRequest: { select: { number: true, purchaseNumber: true } } } }),
    db.expenseCategory.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
    canSpend ? expenseTypes() : null,
    db.paymentMethod.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true } }),
  ]);
  const payment = new Map(pays.map((x): [string, EditablePayment] => [x.id, {
    id: x.id, reservationId: x.reservationId, amount: x.amount, refund: x.kind === "REFUND", accountId: x.accountId, method: x.method.name, reference: x.reference ?? "",
    who: x.reservation?.guest.fullName ?? x.corporateCustomer?.companyName ?? t("Customer"), booking: x.reservation?.reference ?? null,
    invoice: x.invoice?.number ?? null, paidOn: t.date(x.businessDate.toISOString().slice(0, 10)), recordedBy: x.recordedBy.fullName,
  }]));
  const expense = new Map(exps.map((e) => [e.id, e]));
  // A stock purchase's receipt opens for whoever buys or approves (and finance) — not for staff who only ask.
  const seesPurchaseReceipt = can(user, "finance.view") || can(user, "expenses.view_all") || can(user, "inventory.receive") || can(user, "expenses.approve");
  const proofOf = (r: ActivityRow) => (r.id.startsWith("e-") && !seesPurchaseReceipt && expense.get(r.id.slice(2))?.stockRequest ? null : r.proof);
  const receiving: PaymentAccountOption[] = all.filter((a) => a.acceptsPayments).map((a) => ({ id: a.id, name: a.name, number: a.accountNumber, holder: a.holderName }));
  const paidFrom = all.filter((a) => a.acceptsExpenses).map((a) => ({ id: a.id, name: a.name, methodId: a.paymentMethods[0]?.id ?? null }));

  function fix(r: ActivityRow) {
    const rid = r.id.slice(2);
    if (r.id.startsWith("p-")) {
      const pay = payment.get(rid);
      if (!pay || r.note?.startsWith("Reversed")) return null;
      return (
        <>
          {perms.correct && <PaymentEditButton payment={pay} accounts={receiving} canReference={perms.reverse} />}
          {perms.reverse && pay.reservationId && <CancelButton kind="payment" id={rid} reservationId={pay.reservationId} label={msg("this payment")} />}
        </>
      );
    }
    if (r.id.startsWith("e-")) {
      const e = expense.get(rid);
      // A stock purchase's expense changes only from the purchase (the stock came in with it).
      if (e?.stockRequest) return <PurchaseChip purchase={e.stockRequest.purchaseNumber ?? e.stockRequest.number} />;
      if (!e || e.status === "VOIDED" || e.status === "REJECTED") return null;
      const date = e.businessDate.toISOString().slice(0, 10);
      if (!perms.expense && !perms.ownExpense) return null;
      const editable: EditableExpense = {
        id: e.id, number: e.number, categoryId: e.categoryId, amount: e.amount, description: e.description, payee: e.payee ?? "", reference: e.reference ?? "", notes: e.notes ?? "",
        date, accountId: e.accountId ?? "", paymentMethodId: e.paymentMethodId ?? "", status: e.status,
      };
      return (
        <>
          <ExpenseEditButton manager={perms.expense} categories={categories} accounts={paidFrom} expense={editable} />
          <CancelButton kind="expense" id={e.id} label={e.number ?? msg("this expense")} />
        </>
      );
    }
    if (r.id.startsWith("s-") && r.counted && perms.sale) return <CancelButton kind="sale" id={rid} label={msg("this sale")} />;
    if (r.id.startsWith("m-") && r.counted && perms.movement) return <CancelButton kind="movement" id={rid} label={r.related ?? msg("this movement")} />;
    return null;
  }

  return (
    <div className="w-full space-y-5">
      <FinanceTabs active="/staff/finance/accounts" limited={!can(user, "finance.view")} />
      <Link href="/staff/finance/accounts" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{t("Accounts")}</Link>

      <section className={cn("relative overflow-hidden rounded-3xl bg-linear-to-br p-6 text-white shadow-lg sm:p-7", look.hero)}>
        <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(rgba(255,255,255,0.07)_1px,transparent_1px),linear-gradient(90deg,rgba(255,255,255,0.07)_1px,transparent_1px)] bg-[size:28px_28px]" />
        <div className="relative flex flex-wrap items-start justify-between gap-6">
          <div className="min-w-0">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-white/20 px-2.5 py-1 text-xs font-semibold backdrop-blur"><look.icon className="size-3.5" />{t(KIND_LABEL[account.kind])}{account.isActive ? "" : ` · ${t("inactive")}`}</span>
            <h1 className="mt-3 text-3xl font-semibold tracking-tight sm:text-4xl">{t(account.name)} <span className="text-white/70">({account.currency})</span></h1>
            {account.holderName && <p className="mt-1 text-sm font-medium uppercase tracking-wider text-white/85">{account.holderName}</p>}
            <p className="mt-1 font-mono text-sm tracking-[0.15em] text-white/80">{account.accountNumber ? t("A/C {number}", { number: spacedNumber(account.accountNumber) }) : t("No account number")}</p>
          </div>
          <div className="text-right">
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/75">{t("In the books")}</p>
            <p className="mt-1 text-4xl font-semibold tabular-nums tracking-tight">{formatTZS(held?.balance ?? 0)}</p>
            <p className="mt-1 text-xs text-white/80">{t("in {amount}", { amount: formatTZS(held?.moneyIn ?? 0) })} · {t("out {amount}", { amount: formatTZS(held?.moneyOut ?? 0) })}{held?.openingBalance ? ` · ${t("opening {amount}", { amount: formatTZS(held.openingBalance) })}` : ""}</p>
          </div>
        </div>
      </section>

      <div className="flex flex-wrap gap-2">
        {/* Pay something out of this account: it is preselected as "Paid from". */}
        {types && <ExpenseDialog types={types} methods={methods} accounts={[...paidFrom.filter((a) => a.id === account.id), ...paidFrom.filter((a) => a.id !== account.id)]} />}
        {can(user, "settings.manage") && <PaymentAccountButton account={{ id: account.id, name: account.name, kind: account.kind, accountNumber: account.accountNumber, holderName: account.holderName, acceptsPayments: account.acceptsPayments, acceptsExpenses: account.acceptsExpenses, isActive: account.isActive }} />}
        {account.isActive && (account.kind === "CASH" || account.kind === "PETTY_CASH") && (perms.movement || perms.correct) && <CashCountButton account={{ id: account.id, name: account.name, balance: held?.balance ?? 0 }} />}
        {perms.movement && <MovementButton accounts={books.filter((b) => all.some((x) => x.id === b.id)).map((b) => ({ id: b.id, name: b.name, balance: b.balance }))} />}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {tiles.map((tile) => (
          <div key={tile.label} className="rounded-3xl border border-border/70 bg-card p-4">
            <p className="text-xs text-muted-foreground">{tile.label}</p>
            <p className={cn("mt-1 text-xl font-semibold tabular-nums", tile.tone === "in" ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>{formatTZS(tile.value)}</p>
          </div>
        ))}
        <div className="rounded-3xl border border-border/70 bg-card p-4">
          <p className="text-xs text-muted-foreground">{t("Transactions (all time)")}</p>
          <p className="mt-1 text-xl font-semibold tabular-nums">{counts.reduce((x, c) => x + c, 0)}</p>
        </div>
      </div>
      <p className="flex items-start gap-1.5 text-xs text-muted-foreground"><Info className="mt-px size-3.5 shrink-0" />{account.kind === "CASH" || account.kind === "PETTY_CASH"
        ? t("“In the books” is what the hotel's records add up to for this account. Compare it with the cash count — charges or transfers not recorded here will make it differ.")
        : t("“In the books” is what the hotel's records add up to for this account. Compare it with the bank or mobile-money statement — charges or transfers not recorded here will make it differ.")}</p>

      <form className="space-y-3 rounded-3xl border border-border/70 bg-card p-4">
        {Object.entries(keep).filter(([k]) => ["period", "from", "to"].includes(k)).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div className="relative">
          <Search className="pointer-events-none absolute left-4 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input name="q" defaultValue={str(sp.q)} placeholder={t("Guest, company, reservation, room, reference…")} className="h-11 w-full rounded-2xl border border-border bg-background pl-11 pr-3 text-sm" />
        </div>
        <div className="flex flex-wrap gap-2">
          <AutoSelect name="dir" value={dir} label={t("Direction")} options={[{ value: "", label: t("Money in & out") }, { value: "in", label: t("Money in") }, { value: "out", label: t("Money out") }]} />
          <AutoSelect name="type" value={type} label={t("Transaction type")} options={[{ value: "", label: t("Every type") }, ...typeOptions.map((x) => ({ value: x, label: t.ctx("money", ACTIVITY_LABEL[x]) }))]} />
          <AutoSelect name="staff" value={staff} label={t("Recorded by")} options={[{ value: "", label: t("Anyone") }, ...staffOptions.map(([v, l]) => ({ value: v, label: l }))]} />
        </div>
      </form>
      <PeriodPicker current={p.key} from={p.from} to={p.to} keep={Object.fromEntries(Object.entries(keep).filter(([k]) => !["period", "from", "to"].includes(k)))} />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="flex items-center justify-between rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.05] px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold"><ArrowDownLeft className="size-4 text-emerald-600" />{t("Money in")} · {periodLabel(p, t)}</span>
          <span className="font-semibold tabular-nums text-emerald-600 dark:text-emerald-400">+{formatTZS(periodIn)}</span>
        </div>
        <div className="flex items-center justify-between rounded-2xl border border-rose-500/30 bg-rose-500/[0.05] px-4 py-3">
          <span className="flex items-center gap-2 text-sm font-semibold"><ArrowUpRight className="size-4 text-rose-600" />{t("Money out")} · {periodLabel(p, t)}</span>
          <span className="font-semibold tabular-nums text-rose-600 dark:text-rose-400">−{formatTZS(periodOut)}</span>
        </div>
      </div>

      <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
        {shown.length === 0 ? <p className="p-10 text-center text-sm text-muted-foreground">{t("Nothing recorded through {account} for these filters.", { account: t(account.name) })}</p> : (
          <div className="overflow-x-auto">
            <table data-stack className="w-full min-w-[1100px] text-sm">
              <thead className="text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <tr className="border-b border-border/70">
                  <th className="px-4 py-3 font-medium">{t("Date")}</th><th className="px-3 py-3 font-medium">{t("Description")}</th><th className="px-3 py-3 font-medium">{t("Type")}</th>
                  <th className="px-3 py-3 font-medium">{t("Recorded by")}</th><th className="px-3 py-3 text-right font-medium">{t("Amount")}</th><th className="px-3 py-3 font-medium">{t("Related")}</th><th className="px-3 py-3 text-center font-medium">{t("Proof")}</th><th className="px-4 py-3 text-right font-medium">{t("Fix")}</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/50">
                {shown.map((r) => (
                  <tr key={r.id} className={cn("hover:bg-muted/25", !r.counted && "text-muted-foreground", r.type === "OWNER" && r.counted && "bg-amber-500/[0.07] shadow-[inset_4px_0_0_0_var(--color-amber-500)]")}>
                    <td className="whitespace-nowrap px-4 py-3 text-xs">{t.date(r.businessDate)}<span className="block text-[10px] text-muted-foreground">{t.time(r.at)}</span></td>
                    <td className="max-w-[22rem] px-3 py-3">
                      {r.href ? <Link href={r.href} className={cn("font-medium hover:underline", !r.counted && "line-through")}>{r.description}</Link> : <span className={cn("font-medium", !r.counted && "line-through")}>{r.description}</span>}
                      {r.tag && <span className="ml-1.5 whitespace-nowrap rounded-full bg-[oklch(0.75_0.12_80)]/15 px-2 py-px text-[10px] font-semibold text-[oklch(0.55_0.11_75)] dark:text-[oklch(0.82_0.1_82)]">{r.tag}</span>}
                      <p className="truncate text-[11px] text-muted-foreground">{[r.room && t("Room {room}", { room: r.room }), r.reference, r.note && t(r.note)].filter(Boolean).join(" · ")}</p>
                    </td>
                    <td className="px-3 py-3">{r.type === "OWNER" ? <span className="inline-flex whitespace-nowrap rounded-full bg-amber-500 px-2.5 py-0.5 text-[11px] font-semibold text-black">{r.amount < 0 ? t("Owner withdrawal") : t("Owner money in")}</span> : <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2.5 py-0.5 text-[11px] font-medium", (MONEY_IN.includes(r.type) || (!MONEY_OUT.includes(r.type) && r.amount > 0)) ? "border-emerald-500/40 text-emerald-700 dark:text-emerald-300" : "border-rose-500/40 text-rose-700 dark:text-rose-300")}>{t.ctx("money", ACTIVITY_LABEL[r.type])}</span>}</td>
                    <td className="px-3 py-3 text-xs">{r.by}</td>
                    <td className={cn("whitespace-nowrap px-3 py-3 text-right font-mono text-[13px] font-semibold tabular-nums", !r.counted ? "line-through" : r.amount > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>{r.amount > 0 ? "+" : "−"}{Math.abs(r.amount).toLocaleString("en-US")}</td>
                    <td className="px-3 py-3 font-mono text-[11px] text-muted-foreground">{r.related ?? "—"}</td>
                    <td className="px-3 py-3 text-center">{proofOf(r) ? <a href={proofOf(r)!} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-xs font-medium text-sky-600 hover:underline dark:text-sky-400"><Paperclip className="size-3" />{t("View")}</a> : <span className="text-muted-foreground">—</span>}</td>
                    <td className="px-4 py-3"><div className="flex justify-end gap-1.5">{fix(r)}</div></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
    </div>
  );
}
