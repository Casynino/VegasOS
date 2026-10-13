import type { Metadata } from "next";
import Link from "next/link";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { can, requirePagePermission } from "@/server/auth";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { procurementStatus } from "@/lib/stock-requests";
import { FinanceTabs } from "@/components/staff/finance/finance-nav";
import { requestDepartments } from "@/server/services/stock-requests";
import { purchasingPosition } from "@/server/services/procurement";
import { boardFilterOptions, procurementBoard, TABS, type DeskTab } from "@/server/services/procurement-desk";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Procurement") };
}
export const dynamic = "force-dynamic";

const TAB_LABEL: Record<DeskTab, string> = {
  quote: msg("To quote"), authorize: msg("With Finance"), order: msg("Ready to order"), delivery: msg("On order"), invoices: msg("Invoices and payment"), closed: msg("Closed"),
};
const TAB_HELP: Record<DeskTab, string> = {
  quote: msg("Finance approved these. Get supplier quotations, compare them and propose one."),
  authorize: msg("The proposed price is above the approved budget. Finance must authorize it before anything is ordered."),
  order: msg("The price is authorized. Issue the purchase order to the supplier."),
  delivery: msg("Ordered. Record what arrives — only what is accepted goes into stock."),
  invoices: msg("Everything has arrived. Record the supplier's invoice; Finance verifies it and pays."),
  closed: msg("Delivered, invoiced and paid — or cancelled."),
};
const PRIORITY: Record<string, string> = { LOW: msg("Low"), NORMAL: msg("Normal"), HIGH: msg("High"), URGENT: msg("Urgent") };

const one = (v: string | string[] | undefined) => (typeof v === "string" && v ? v : undefined);
const amount = (v: string | undefined) => (v && /^\d{1,12}$/.test(v) ? Number(v) : null);
const day = (v: string | undefined) => (v && /^\d{4}-\d{2}-\d{2}$/.test(v) ? v : null);

/**
 * The purchasing desk. The Accountant works it (quotations, orders, deliveries, invoices); Finance, the Boss and the MD
 * see the same list and decide what is theirs (authorize a price, verify an invoice, pay). A purchase is on one tab only.
 */
export default async function ProcurementPage({ searchParams }: PageProps<"/staff/procurement">) {
  const user = await requirePagePermission("dashboard.procurement", "procurement.manage", "purchases.authorize", "purchases.pay");
  const t = await getT();
  const sp = await searchParams;
  const finance = can(user, "purchases.authorize") || can(user, "purchases.pay");
  const asked = one(sp.tab);
  // Finance opens on what waits for them; the Accountant on what waits for a quotation.
  const tab = (TABS.find((x) => x === asked) ?? (finance ? "authorize" : "quote")) as DeskTab;
  const filters = {
    tab, q: one(sp.q), department: one(sp.department), requester: one(sp.requester), supplier: one(sp.supplier), status: one(sp.status),
    minAmount: amount(one(sp.min)), maxAmount: amount(one(sp.max)), from: day(one(sp.from)), to: day(one(sp.to)),
  };
  const departments = await requestDepartments();
  const [board, options, position] = await Promise.all([
    procurementBoard(filters, new Map(departments.map((d) => [d.code, d.name]))),
    boardFilterOptions(),
    finance ? purchasingPosition() : null,
  ]);
  const keep = (extra: Record<string, string>) => {
    const p = new URLSearchParams();
    for (const k of ["q", "department", "requester", "supplier", "status", "min", "max", "from", "to"]) { const v = one(sp[k]); if (v) p.set(k, v); }
    for (const [k, v] of Object.entries(extra)) p.set(k, v);
    return `?${p}`;
  };
  const filtered = ["q", "department", "requester", "supplier", "status", "min", "max", "from", "to"].some((k) => one(sp[k]));

  return (
    <div className="w-full space-y-4">
      {finance && <FinanceTabs active="/staff/procurement" />}
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.4rem,2vw,1.75rem)] font-semibold tracking-tight">{t("Procurement")}</h1>
          <p className="mt-0.5 max-w-3xl text-sm text-muted-foreground">
            {finance ? t("Every purchase Finance approved, from the quotation to the supplier's payment. A request is not an expense, an approval is not a payment, and an order is not a delivery.")
              : t("The purchases Finance approved. Get quotations, order, receive the goods and attach the invoices — Finance authorizes the price when it is above the budget and pays the supplier.")}
          </p>
        </div>
        <Link href="/staff/stock-requests" className="text-sm font-medium underline-offset-4 hover:underline">{t("Purchase requests")}</Link>
      </header>

      {position && (
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
          <Tile label={t("Asked for")} value={formatTZS(position.requested.amount)} sub={`${t.plural(position.requested.count, "{n} request", "{n} requests")} · ${t("estimates")}`} />
          <Tile label={t("Approved")} value={formatTZS(position.approved.amount)} sub={t("budgets, not yet ordered")} />
          <Tile label={t("Ordered")} value={formatTZS(position.ordered.amount)} sub={t("committed to suppliers")} />
          <Tile label={t("Invoiced")} value={formatTZS(position.invoiced.amount)} sub={t.plural(position.invoiced.count, "{n} invoice", "{n} invoices")} />
          <Tile label={t("Paid")} value={formatTZS(position.paid.amount)} sub={t("the expense, once paid")} />
          <Tile label={t("Still owed")} value={formatTZS(position.owed.amount)} sub={t("to suppliers")} tone={position.owed.amount > 0 ? "warn" : undefined} />
        </dl>
      )}

      <nav aria-label={t("Show")} className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
        <div className="flex w-max gap-1 rounded-xl bg-muted p-1">
          {TABS.map((x) => (
            <Link key={x} href={keep({ tab: x })} aria-current={tab === x ? "page" : undefined}
              className={cn("flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-medium whitespace-nowrap", tab === x ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {t(TAB_LABEL[x])}
              <span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", board.counts[x] ? "bg-foreground/10" : "text-muted-foreground")}>{board.counts[x]}</span>
            </Link>
          ))}
        </div>
      </nav>
      <p className="-mt-1 text-xs text-muted-foreground">{t(TAB_HELP[tab])}</p>

      <details open={filtered} className="group rounded-2xl border border-border/70 bg-card text-xs">
      <summary className="flex cursor-pointer list-none items-center justify-between px-3 py-2.5 text-sm font-medium">
        {t("Filters")}<span className="text-xs font-normal text-muted-foreground">{filtered ? t("on") : t("department, person, supplier, amount, date")}</span>
      </summary>
      <form method="get" className="grid grid-cols-2 gap-2 border-t border-border/60 p-3 sm:grid-cols-4 lg:grid-cols-5">
        <input type="hidden" name="tab" value={tab} />
        <input name="q" defaultValue={filters.q} placeholder={t("Number, title or supplier")} aria-label={t("Search")} className="col-span-2 h-9 rounded-lg border border-border bg-background px-2 sm:col-span-1" />
        <Select name="department" label={t("Department")} value={filters.department} all={t("All departments")} options={options.departments.map((d) => ({ id: d.id, name: t(d.name) }))} />
        <Select name="requester" label={t("Requested by")} value={filters.requester} all={t("Everyone")} options={options.requesters.map((u) => ({ id: u.id, name: u.fullName }))} />
        <Select name="supplier" label={t("Supplier")} value={filters.supplier} all={t("All suppliers")} options={options.suppliers} />
        <label className="flex h-9 items-center gap-1.5"><span className="text-muted-foreground">{t("From")}</span><input type="date" name="from" defaultValue={filters.from ?? ""} className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2" /></label>
        <label className="flex h-9 items-center gap-1.5"><span className="text-muted-foreground">{t("To")}</span><input type="date" name="to" defaultValue={filters.to ?? ""} className="h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2" /></label>
        <input name="min" inputMode="numeric" defaultValue={filters.minAmount ?? ""} placeholder={t("Amount from (TZS)")} aria-label={t("Amount from (TZS)")} className="h-9 rounded-lg border border-border bg-background px-2" />
        <input name="max" inputMode="numeric" defaultValue={filters.maxAmount ?? ""} placeholder={t("Amount up to (TZS)")} aria-label={t("Amount up to (TZS)")} className="h-9 rounded-lg border border-border bg-background px-2" />
        <div className="flex gap-2">
          <button className="h-9 flex-1 rounded-lg bg-foreground px-3 font-medium text-background">{t("Show")}</button>
          {filtered && <Link href={`?tab=${tab}`} className="flex h-9 items-center rounded-lg px-2 text-muted-foreground hover:text-foreground">{t("Clear")}</Link>}
        </div>
      </form>
      </details>

      {board.list.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">{filtered ? t("Nothing matches these filters.") : t("Nothing here.")}</p>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-border/70 bg-card">
          <table className="w-full min-w-[52rem] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">{t("Purchase")}</th>
                <th className="px-2 py-2.5 font-medium">{t("For")}</th>
                <th className="px-2 py-2.5 font-medium">{t("Supplier")}</th>
                <th className="px-2 py-2.5 text-right font-medium">{t("Budget")}</th>
                <th className="px-2 py-2.5 text-right font-medium">{tab === "quote" || tab === "authorize" || tab === "order" ? t("Quoted") : t("Ordered")}</th>
                {finance && <th className="px-2 py-2.5 text-right font-medium">{t("Still owed")}</th>}
                <th className="px-4 py-2.5 text-right font-medium">{t("Where it stands")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {board.list.map((r) => {
                const meta = procurementStatus(r.status, r.ready);
                return (
                  <tr key={r.id} className="hover:bg-muted/30">
                    <td className="px-4 py-2.5">
                      <Link href={`/staff/procurement/${r.id}`} className="font-medium underline-offset-4 hover:underline">{r.orderNumber ?? r.number}</Link>
                      <span className="block max-w-[16rem] truncate text-[11px] text-muted-foreground">{r.title ?? r.number}{r.orderNumber ? ` · ${r.number}` : ""}</span>
                      {(r.urgent || r.priority === "HIGH") && <span className="mt-0.5 inline-block rounded-full bg-rose-500/12 px-1.5 text-[10px] font-medium text-rose-700 dark:text-rose-300">{t(PRIORITY[r.priority] ?? r.priority)}</span>}
                    </td>
                    <td className="px-2 py-2.5">{t(r.department)}<span className="block text-[11px] text-muted-foreground">{r.requester}</span></td>
                    <td className="px-2 py-2.5">{r.supplier ?? <span className="text-muted-foreground">{r.quotes ? t.plural(r.quotes, "{n} quotation", "{n} quotations") : "—"}</span>}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">{r.approvedBudget != null ? formatTZS(r.approvedBudget) : r.estimatedTotal != null ? <span title={t("The person's estimate")} className="text-muted-foreground">~{formatTZS(r.estimatedTotal)}</span> : "—"}</td>
                    <td className="px-2 py-2.5 text-right tabular-nums">
                      {tab === "quote" || tab === "authorize" || tab === "order" ? (r.quoted != null ? formatTZS(r.quoted) : "—") : r.orderTotal != null ? formatTZS(r.orderTotal) : "—"}
                      {r.expectedDeliveryOn && tab === "delivery" && <span className={cn("block text-[11px]", r.late ? "font-medium text-rose-700 dark:text-rose-300" : "text-muted-foreground")}>{r.late ? t("late — was due {date}", { date: t.date(r.expectedDeliveryOn) }) : t("due {date}", { date: t.date(r.expectedDeliveryOn) })}</span>}
                    </td>
                    {finance && <td className="px-2 py-2.5 text-right tabular-nums">{r.owed ? formatTZS(r.owed) : "—"}</td>}
                    <td className="px-4 py-2.5 text-right">
                      <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", meta.tone)}>{t(meta.label)}</span>
                      {tab === "invoices" && (
                        <span className="mt-0.5 block text-[11px] text-muted-foreground">
                          {r.disputed ? t("an invoice is disputed") : r.toVerify ? t.plural(r.toVerify, "{n} invoice to verify", "{n} invoices to verify") : r.toPay ? t.plural(r.toPay, "{n} invoice to pay", "{n} invoices to pay") : !r.invoiced ? t("no invoice yet") : ""}
                        </span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {board.truncated && <p className="border-t border-border/50 px-4 py-2 text-[11px] text-muted-foreground">{t("Showing the latest 400 purchases — use the filters to narrow the list.")}</p>}
        </div>
      )}
    </div>
  );
}

function Select({ name, label, value, all, options }: { name: string; label: string; value?: string; all: string; options: { id: string; name: string }[] }) {
  return (
    <select name={name} defaultValue={value ?? ""} aria-label={label} className="h-9 min-w-0 rounded-lg border border-border bg-background px-2">
      <option value="">{all}</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
    </select>
  );
}

function Tile({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: "warn" }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card px-3 py-2.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("text-base font-semibold tabular-nums", tone === "warn" && "text-amber-700 dark:text-amber-300")}>{value}</dd>
      {sub && <dd className="text-[11px] text-muted-foreground">{sub}</dd>}
    </div>
  );
}
