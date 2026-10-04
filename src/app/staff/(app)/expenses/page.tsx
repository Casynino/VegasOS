import type { Metadata } from "next";
import Link from "next/link";
import { CheckCircle2, Circle, Paperclip, Search, Settings2 } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { COUNTED_EXPENSE_STATUSES, expenseTypes, monthlyBills, spendByType } from "@/server/services/expenses";
import { addDays, presetRange, toDbDate } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import type { Prisma } from "@/generated/prisma/client";
import type { ExpenseStatus } from "@/generated/prisma/enums";
import { PageHeader } from "@/components/staff/page-header";
import { FinanceTabs, PeriodPicker, periodLabel, readPeriod } from "@/components/staff/finance/finance-nav";
import { AutoSelect } from "@/components/staff/finance/auto-select";
import { ApproveButtons, CancelButton, ExpenseEditButton, ReinstateButton } from "@/components/staff/finance/fix-buttons";
import { cn } from "@/lib/utils";
import { expenseLook } from "@/lib/expense-look";
import { ExpenseDialog, PurchaseChip } from "./expense-dialogs";

export const metadata: Metadata = { title: "Expenses" };
const PAGE = 40;
const STATUS = {
  RECORDED: { label: "Paid", cls: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300" },
  APPROVED: { label: "Paid · approved", cls: "border-emerald-500/40 text-emerald-700 dark:text-emerald-300" },
  PENDING_APPROVAL: { label: "Waiting approval", cls: "border-amber-500/50 text-amber-700 dark:text-amber-300" },
  CORRECTION_REQUESTED: { label: "Needs correction", cls: "border-amber-500/50 text-amber-700 dark:text-amber-300" },
  REJECTED: { label: "Rejected", cls: "border-rose-500/40 text-rose-700 dark:text-rose-300" },
  VOIDED: { label: "Cancelled", cls: "border-border text-muted-foreground" },
} as const;

/**
 * Expenses — what the hotel spends. Category tiles show where the money went;
 * every line shows its number, who paid whom from which account, the receipt,
 * and can be corrected or cancelled (never deleted).
 */
export default async function ExpensesPage({ searchParams }: PageProps<"/staff/expenses">) {
  const user = await requirePagePermission("expenses.record", "expenses.view_all");
  const sp = await searchParams;
  const str = (v: unknown) => (typeof v === "string" ? v : "");
  const today = await businessToday();
  const period = readPeriod(sp, today, "month");
  const range = { from: period.from, to: period.to };
  const categoryId = str(sp.category);
  const status = str(sp.status) as ExpenseStatus | "";
  const accountId = str(sp.account);
  const q = str(sp.q).trim();
  /** One thing at a time: the list, the monthly bills checklist, or the summary by type. */
  const view = (["list", "bills", "summary"].includes(str(sp.view)) ? str(sp.view) : "list") as "list" | "bills" | "summary";
  const page = Math.max(1, Number(sp.page) || 1);
  // The front desk sees every expense too (as in the ledger); they can only change their own.
  const viewAll = can(user, "expenses.view_all") || can(user, "ledger.view");
  const manager = can(user, "expenses.void");
  // Anyone who records expenses can correct or cancel one — the old line always stays on the register.
  const canChange = can(user, "expenses.record");
  // A stock purchase's receipt opens for whoever buys or approves (and finance) — not for staff who only ask.
  const seesPurchaseReceipt = can(user, "finance.view") || can(user, "expenses.view_all") || can(user, "inventory.receive") || can(user, "expenses.approve");

  const base: Prisma.ExpenseWhereInput = {
    businessDate: { gte: toDbDate(range.from), lte: toDbDate(range.to) },
    ...(!viewAll && { createdById: user.id }),
    ...(q && { OR: [
      { description: { contains: q, mode: "insensitive" } }, { payee: { contains: q, mode: "insensitive" } }, { reference: { contains: q, mode: "insensitive" } },
      { number: { contains: q, mode: "insensitive" } }, { notes: { contains: q, mode: "insensitive" } },
    ] }),
  };
  const where: Prisma.ExpenseWhereInput = {
    ...base, ...(categoryId && { categoryId }), ...(status && { status }),
    ...(accountId && { OR: [{ accountId }, { accountId: null, paymentMethod: { accountId } }] }),
  };
  const counted = { ...base, status: { in: COUNTED_EXPENSE_STATUSES } };
  const [rows, total, byCategory, all, pending, cancelled, categories, methods, accounts, byAccount] = await Promise.all([
    db.expense.findMany({
      where, orderBy: [{ businessDate: "desc" }, { spentAt: "desc" }], take: PAGE, skip: (page - 1) * PAGE,
      include: { category: true, item: { select: { name: true } }, paymentMethod: { include: { account: true } }, account: true, createdBy: { select: { fullName: true } }, stockRequest: { select: { number: true, purchaseNumber: true } } },
    }),
    db.expense.count({ where }),
    db.expense.groupBy({ by: ["categoryId"], where: counted, _sum: { amount: true }, _count: true, orderBy: { _sum: { amount: "desc" } } }),
    db.expense.aggregate({ where: counted, _sum: { amount: true }, _count: true }),
    db.expense.aggregate({ where: { ...base, status: "PENDING_APPROVAL" }, _sum: { amount: true }, _count: true }),
    db.expense.aggregate({ where: { ...base, status: "VOIDED" }, _sum: { amount: true }, _count: true }),
    db.expenseCategory.findMany({ orderBy: { sortOrder: "asc" } }),
    db.paymentMethod.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } }),
    db.moneyAccount.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, include: { paymentMethods: { where: { isActive: true }, select: { id: true } } } }),
    db.expense.groupBy({ by: ["accountId"], where: counted, _sum: { amount: true } }),
  ]);
  const month = presetRange("month", today);
  const [types, bills, byType] = await Promise.all([expenseTypes(), viewAll ? monthlyBills(month.from, month.to) : Promise.resolve([]), viewAll ? spendByType(range.from, range.to) : Promise.resolve(null)]);
  const billsPaid = bills.filter((b) => b.paid > 0).length;
  const monthName = new Date(`${today}T00:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric", timeZone: "UTC" });
  const accountOptions = accounts.filter((a) => a.acceptsExpenses).map((a) => ({ id: a.id, name: a.name, methodId: a.paymentMethods[0]?.id ?? null }));
  const catOptions = categories.filter((c) => c.isActive).map((c) => ({ id: c.id, name: c.name }));
  const catName = new Map(categories.map((c) => [c.id, c.name]));
  const catIcon = new Map(categories.map((c) => [c.id, c.icon]));
  const rangeLabel = periodLabel(range);
  const days: { date: string; total: number; rows: typeof rows }[] = [];
  for (const e of rows) {
    const d = e.businessDate.toISOString().slice(0, 10);
    let day = days.at(-1);
    if (day?.date !== d) { day = { date: d, total: 0, rows: [] }; days.push(day); }
    day.rows.push(e);
    if (COUNTED_EXPENSE_STATUSES.includes(e.status)) day.total += e.amount;
  }
  // What happened to each line: edited in place, corrected (old line replaced) or cancelled — who and when.
  const ids = rows.map((e) => e.id);
  const [edits, voids, originals] = await Promise.all([
    db.auditLog.findMany({ where: { entityType: "Expense", entityId: { in: ids }, action: "expense.edited" }, orderBy: { createdAt: "desc" }, select: { entityId: true, actorLabel: true, createdAt: true } }),
    db.expenseApproval.findMany({ where: { expenseId: { in: [...ids, ...rows.map((e) => e.correctsId).filter((x): x is string => !!x)] }, action: "VOIDED" }, orderBy: { createdAt: "desc" }, include: { actor: { select: { fullName: true } } } }),
    db.expense.findMany({ where: { id: { in: rows.map((e) => e.correctsId).filter((x): x is string => !!x) } }, select: { id: true, amount: true, number: true } }),
  ]);
  const editOf = new Map<string, { count: number; by: string | null; at: Date }>();
  for (const a of edits) { const e = editOf.get(a.entityId!); if (e) e.count++; else editOf.set(a.entityId!, { count: 1, by: a.actorLabel, at: a.createdAt }); }
  const voidOf = new Map(voids.map((v) => [v.expenseId, v]));
  const originalOf = new Map(originals.map((o) => [o.id, o]));
  const when = (d: Date) => d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" });
  const historyHref = can(user, "finance.view") ? "/staff/finance/history?group=expenses" : null;
  const dayLabel = (d: string) => (d === today ? "Today" : d === addDays(today, -1) ? "Yesterday" : new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" }));
  const totalSpent = all._sum.amount ?? 0;
  const pages = Math.max(1, Math.ceil(total / PAGE));
  const keep: Record<string, string> = Object.fromEntries(Object.entries({ period: period.key === "custom" ? "" : period.key, from: period.key === "custom" ? range.from : "", to: period.key === "custom" ? range.to : "", q, category: categoryId, status, account: accountId }).filter(([, v]) => v));
  const link = (extra: Record<string, string>) => `?${new URLSearchParams(Object.fromEntries(Object.entries({ ...keep, ...extra }).filter(([, v]) => v)))}`;
  const spentBy = accounts.map((a) => ({ id: a.id, name: a.name, amount: byAccount.find((b) => b.accountId === a.id)?._sum.amount ?? 0 })).filter((a) => a.amount > 0);

  const billsPanel = (
      <section className="rounded-3xl border border-border/70 bg-card p-4">
        <div className="mb-3 flex items-start justify-between gap-2">
          <div><p className="font-semibold">Monthly bills</p><p className="text-xs text-muted-foreground">{monthName} · fixed costs paid every month</p></div>
          <span className="shrink-0 rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums">{billsPaid}/{bills.length} paid</span>
        </div>
        <span className="mb-3 block h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-emerald-500" style={{ width: `${bills.length ? (billsPaid / bills.length) * 100 : 0}%` }} /></span>
        {(() => {
          // Paid first; only the first few unpaid are shown, the rest fold away.
          const sorted = [...bills].sort((a, b) => Number(!!b.paid) - Number(!!a.paid));
          const row = (b: (typeof bills)[number]) => (
            <li key={b.id} className="flex items-center justify-between gap-2 rounded-lg px-1 py-1.5 text-sm">
              <span className="flex min-w-0 items-center gap-2">{b.paid ? <CheckCircle2 className="size-4 shrink-0 text-emerald-600" /> : <Circle className="size-4 shrink-0 text-muted-foreground/50" />}<span className={cn("truncate", !b.paid && "text-muted-foreground")}>{b.name}</span></span>
              <span className={cn("shrink-0 text-xs tabular-nums", b.paid ? "font-semibold" : "text-muted-foreground/70")}>{b.paid ? formatTZS(b.paid) : "not yet"}</span>
            </li>
          );
          const first = sorted.slice(0, Math.max(6, billsPaid + 3));
          const rest = sorted.slice(first.length);
          return (
            <>
              <ul className="space-y-0.5">{first.map(row)}</ul>
              {rest.length > 0 && (
                <details className="group mt-1">
                  <summary className="cursor-pointer list-none rounded-lg px-1 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground [&::-webkit-details-marker]:hidden">
                    <span className="group-open:hidden">Show {rest.length} more not paid yet</span><span className="hidden group-open:inline">Show less</span>
                  </summary>
                  <ul className="space-y-0.5">{rest.map(row)}</ul>
                </details>
              )}
            </>
          );
        })()}
      </section>
  );
  const summaryPanel = byType && (
        <section className="rounded-3xl border border-border/70 bg-card p-4">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div><p className="font-semibold">Summary by type</p><p className="text-xs text-muted-foreground">{rangeLabel} · paid & approved</p></div>
            <span className="font-semibold tabular-nums">{formatTZS(byType.total)}</span>
          </div>
          {byType.groups.length === 0 ? <p className="text-sm text-muted-foreground">Nothing spent in this period.</p> : (
            <div className="space-y-4">
              {byType.groups.map((g) => {
                const look = expenseLook(catIcon.get(g.id));
                return (
                  <div key={g.id}>
                    <p className="flex items-center justify-between gap-2 text-sm font-semibold">
                      <span className="flex items-center gap-2"><span className={cn("grid size-6 place-items-center rounded-md", look.tone)}><look.icon className="size-3.5" /></span>{g.name}</span>
                      <span className="shrink-0 whitespace-nowrap tabular-nums">{formatTZS(g.total)}</span>
                    </p>
                    <ul className="ml-8 mt-1 space-y-0.5 text-[13px] text-muted-foreground">
                      {g.lines.map((l) => <li key={l.name} className="flex justify-between gap-2"><span className="truncate">{l.name}{l.count > 1 && <span className="text-xs"> ×{l.count}</span>}</span><span className="shrink-0 whitespace-nowrap tabular-nums">{formatTZS(l.amount)}</span></li>)}
                    </ul>
                  </div>
                );
              })}
            </div>
          )}
        </section>
  );

  return (
    <div className="w-full space-y-5">
      {/* The finance bar is this page's title; staff without finance see the heading instead */}
      {can(user, "finance.view") || can(user, "ledger.view")
        ? <FinanceTabs active="/staff/expenses" limited={!can(user, "finance.view")} actions={can(user, "expenses.record") && <div className="flex gap-2">{can(user, "settings.manage") && <Link href="/staff/settings/expenses" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted"><Settings2 className="size-4" />Expense types</Link>}<ExpenseDialog types={types} methods={methods.map((m) => ({ id: m.id, name: m.name }))} accounts={accountOptions} /></div>} />
        : <PageHeader title="Expenses" description="What the hotel spends, and which account it was paid from." actions={can(user, "expenses.record") && <div className="flex gap-2">{can(user, "settings.manage") && <Link href="/staff/settings/expenses" className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted"><Settings2 className="size-4" />Expense types</Link>}<ExpenseDialog types={types} methods={methods.map((m) => ({ id: m.id, name: m.name }))} accounts={accountOptions} /></div>} />}

      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">{rangeLabel}</h2>
        <PeriodPicker current={period.key} from={period.from} to={period.to} keep={Object.fromEntries(Object.entries(keep).filter(([k]) => !["period", "from", "to"].includes(k)))} />
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <div className="relative overflow-hidden rounded-3xl border border-rose-500/30 bg-linear-to-br from-rose-500/[0.12] to-card p-5 col-span-2 flex flex-wrap items-end justify-between gap-4 sm:col-span-3 lg:col-span-5">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Money spent</p>
            <p className="mt-2 text-3xl font-semibold tabular-nums tracking-tight">{formatTZS(totalSpent)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              {all._count} expense{all._count === 1 ? "" : "s"}
              {pending._count > 0 && <> · <Link href={link({ status: status === "PENDING_APPROVAL" ? "" : "PENDING_APPROVAL" })} className="font-semibold text-amber-600 hover:underline dark:text-amber-400">{pending._count} waiting approval ({formatTZS(pending._sum.amount ?? 0)})</Link></>}
              {cancelled._count > 0 && <> · <Link href={link({ status: status === "VOIDED" ? "" : "VOIDED" })} className="hover:underline">{cancelled._count} cancelled</Link></>}
            </p>
          </div>
          {spentBy.length > 0 && (
            <div className="flex max-w-2xl flex-wrap justify-end gap-1.5">
              {spentBy.map((a) => (
                <Link key={a.id} href={link({ account: accountId === a.id ? "" : a.id })} className={cn("rounded-full border px-2.5 py-1 text-[11px] font-medium tabular-nums transition", accountId === a.id ? "border-foreground bg-foreground text-background" : "border-border/80 bg-background/50 hover:bg-muted")}>
                  {a.name} · {a.amount.toLocaleString("en-US")}
                </Link>
              ))}
            </div>
          )}
        </div>
        {byCategory.slice(0, 5).map((c) => {
          const look = expenseLook(catIcon.get(c.categoryId));
          return (
            <Link key={c.categoryId} href={link({ category: categoryId === c.categoryId ? "" : c.categoryId })}
              className={cn("rounded-3xl border bg-card p-4 transition hover:-translate-y-0.5 hover:border-foreground/25", categoryId === c.categoryId ? "border-foreground/40 ring-1 ring-foreground/20" : "border-border/70")}>
              <span className={cn("grid size-9 place-items-center rounded-xl", look.tone)}><look.icon className="size-4" /></span>
              <p className="mt-3 truncate text-xs text-muted-foreground">{catName.get(c.categoryId)}</p>
              <p className="mt-0.5 whitespace-nowrap text-base font-semibold tabular-nums">{formatTZS(c._sum.amount ?? 0)}</p>
            </Link>
          );
        })}
      </div>


      {viewAll && (
        <nav aria-label="Show" className="flex w-fit gap-1 rounded-2xl bg-muted/60 p-1">
          {([["list", "Expenses"], ["bills", `Monthly bills · ${billsPaid}/${bills.length}`], ["summary", "Summary by type"]] as const).map(([v, l]) => (
            <Link key={v} href={link({ view: v === "list" ? "" : v, page: "" })} aria-current={view === v ? "page" : undefined}
              className={cn("rounded-xl px-4 py-2 text-sm font-medium transition", view === v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>{l}</Link>
          ))}
        </nav>
      )}
      {view !== "list" && viewAll ? (
        <div className="max-w-3xl">{view === "bills" ? billsPanel : summaryPanel}</div>
      ) : (
      <div className="min-w-0 space-y-4">
      <form className="space-y-2.5 rounded-3xl border border-border/70 bg-card p-3">
        {Object.entries({ period: keep.period ?? "", from: keep.from ?? "", to: keep.to ?? "" }).filter(([, v]) => v).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        <div className="flex gap-2">
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <input name="q" defaultValue={q} placeholder="What it was, the number, who was paid, a note…" className="h-10 w-full rounded-xl border border-border bg-background pl-10 pr-3 text-sm" />
          </div>
          <button className="h-10 rounded-xl border border-border px-4 text-sm font-medium hover:bg-muted">Search</button>
        </div>
        <div className="flex flex-wrap gap-2">
          <AutoSelect name="category" value={categoryId} label="Category" options={[{ value: "", label: "Every category" }, ...categories.map((c) => ({ value: c.id, label: c.name }))]} />
          <AutoSelect name="status" value={status} label="Status" options={[{ value: "", label: "Any status" }, ...Object.entries(STATUS).map(([k, v]) => ({ value: k, label: v.label }))]} />
          <AutoSelect name="account" value={accountId} label="Account" options={[{ value: "", label: "Any account" }, ...accounts.map((a) => ({ value: a.id, label: a.name }))]} />
        </div>
      </form>

      <p className="text-xs text-muted-foreground">Showing {total ? (page - 1) * PAGE + 1 : 0}–{Math.min(total, page * PAGE)} of {total} expense{total === 1 ? "" : "s"}</p>
      {rows.length === 0 ? <p className="rounded-3xl border border-dashed border-border p-12 text-center text-sm text-muted-foreground">No expenses match.</p> : days.map((day) => (
        <section key={day.date} className="overflow-hidden rounded-3xl border border-border/70 bg-card">
          <header className="flex items-baseline justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-2.5">
            <p className="text-sm font-semibold">{dayLabel(day.date)}<span className="ml-2 text-xs font-normal text-muted-foreground">{day.rows.length} expense{day.rows.length === 1 ? "" : "s"}</span></p>
            <p className="text-sm font-semibold tabular-nums">{formatTZS(day.total)}</p>
          </header>
          <ul className="divide-y divide-border/50">
            {day.rows.map((e) => {
              const st = STATUS[e.status];
              const off = e.status === "VOIDED" || e.status === "REJECTED";
              const from = e.account?.name ?? e.paymentMethod?.account?.name ?? e.paymentMethod?.name ?? "—";
              const date = e.businessDate.toISOString().slice(0, 10);
              const look = expenseLook(e.category.icon);
              const extra = e.item && e.description !== e.item.name ? e.description : null;
              // Made by a stock purchase's final approval: it changes only from the purchase.
              const purchase = e.stockRequest ? e.stockRequest.purchaseNumber ?? e.stockRequest.number : null;
              return (
                <li key={e.id} className={cn("flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-3 transition hover:bg-muted/30", off && "opacity-60")}>
                  <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", look.tone)}><look.icon className="size-[18px]" /></span>
                  <div className="min-w-0 flex-1 leading-tight">
                    <p className={cn("truncate font-semibold", off && "line-through")}>{e.item?.name ?? e.description}{extra && <span className="font-normal text-muted-foreground"> · {extra}</span>}</p>
                    <p className="mt-0.5 truncate text-xs text-muted-foreground">
                      {[e.payee && `To ${e.payee}`, `from ${from}`, `by ${e.createdBy.fullName}`, e.number].filter(Boolean).join(" · ")}
                    </p>
                    {(() => {
                      const v = voidOf.get(e.id);
                      const ed = editOf.get(e.id);
                      const orig = e.correctsId ? originalOf.get(e.correctsId) : null;
                      const chips: { label: string; tone: string; text: string }[] = [];
                      if (e.status === "VOIDED") {
                        const replaced = e.voidReason?.startsWith("Corrected:");
                        chips.push({ label: replaced ? "Replaced" : "Cancelled", tone: "bg-rose-500/12 text-rose-700 dark:text-rose-300", text: `${replaced ? "corrected" : "cancelled"} by ${v?.actor.fullName ?? "—"}${v ? `, ${when(v.createdAt)}` : ""} — ${(e.voidReason ?? "").replace(/^Corrected:\s*/, "")}` });
                      }
                      if (orig) chips.push({ label: "Corrected", tone: "bg-violet-500/12 text-violet-700 dark:text-violet-300", text: `replaces ${orig.number ?? "an older line"}${orig.amount !== e.amount ? ` (was ${formatTZS(orig.amount)})` : ""} · by ${voidOf.get(orig.id)?.actor.fullName ?? "—"}, ${when(e.createdAt)}` });
                      if (ed) chips.push({ label: ed.count > 1 ? `Edited ×${ed.count}` : "Edited", tone: "bg-amber-500/12 text-amber-700 dark:text-amber-300", text: `last by ${ed.by ?? "—"}, ${when(ed.at)}` });
                      if (!chips.length) return null;
                      return (
                        <div className="mt-1.5 flex flex-col gap-1">
                          {chips.map((c) => (
                            <p key={c.label} className="flex min-w-0 items-center gap-1.5 text-xs text-muted-foreground">
                              <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", c.tone)}>{c.label}</span>
                              <span className="truncate">{c.text}</span>
                              {historyHref && <Link href={historyHref} className="shrink-0 font-medium text-foreground/70 underline-offset-2 hover:underline">history</Link>}
                            </p>
                          ))}
                        </div>
                      );
                    })()}
                  </div>
                  <span className={cn("shrink-0 text-right text-[15px] font-semibold tabular-nums sm:order-last sm:min-w-28", off && "line-through")}>{formatTZS(e.amount)}</span>
                  <div className="flex w-full flex-wrap items-center gap-1.5 pl-[52px] empty:hidden sm:w-auto sm:pl-0">
                    {e.status !== "RECORDED" && <span className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", st.cls)}>{st.label}</span>}
                    {e.receiptUrl && (!purchase || seesPurchaseReceipt) && <a href={e.receiptUrl} target="_blank" rel="noreferrer" title="Receipt" className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted"><Paperclip className="size-3.5" /></a>}
                    {purchase ? <PurchaseChip purchase={purchase} /> : <>
                      {e.status === "PENDING_APPROVAL" && can(user, "expenses.approve") && (e.createdById !== user.id || user.roleCode === "OWNER") && <ApproveButtons expenseId={e.id} />}
                      {!off && canChange && (
                        <ExpenseEditButton manager={manager || e.createdById !== user.id || date !== today} categories={catOptions} accounts={accountOptions}
                          expense={{ id: e.id, number: e.number, categoryId: e.categoryId, amount: e.amount, description: e.description, payee: e.payee ?? "", reference: e.reference ?? "", notes: e.notes ?? "", date, accountId: e.accountId ?? e.paymentMethod?.accountId ?? "", paymentMethodId: e.paymentMethodId ?? "", status: e.status }} />
                      )}
                      {!off && canChange && <CancelButton kind="expense" id={e.id} label={e.number ?? "this expense"} />}
                      {e.status === "VOIDED" && manager && !e.voidReason?.startsWith("Corrected:") && <ReinstateButton expenseId={e.id} />}
                    </>}
                  </div>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
      {pages > 1 && (
        <div className="flex justify-end gap-2 text-sm">
          {page > 1 && <Link className="rounded-lg border border-border px-3 py-1.5 hover:bg-muted" href={link({ page: String(page - 1) })}>Previous</Link>}
          {page < pages && <Link className="rounded-lg border border-border px-3 py-1.5 hover:bg-muted" href={link({ page: String(page + 1) })}>Next</Link>}
        </div>
      )}
      </div>
      )}
    </div>
  );
}
