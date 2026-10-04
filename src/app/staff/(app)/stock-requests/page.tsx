import type { Metadata } from "next";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday, getSettings } from "@/server/settings";
import {
  purchaseOptions, purchasingSummary, requestDepartments, stockDrinks, stockRequests, type StockRequestRow,
} from "@/server/services/stock-requests";
import { STOCK_CATALOG } from "@/lib/stock-catalog";
import { formatTZS } from "@/lib/format";
import type { StockEventView, StockReqView, Viewer } from "@/lib/stock-requests";
import { StockRequests } from "./stock-requests";

export const metadata: Metadata = { title: "Stock requests" };
export const dynamic = "force-dynamic";

type Json = Record<string, unknown> | null;
const obj = (v: unknown): Json => (v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : null);
const strs = (v: unknown) => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : []);
const n = (v: unknown) => (typeof v === "number" ? v : null);
const s = (v: unknown) => (typeof v === "string" && v ? v : null);
/** The hotel's day (EAT, UTC+3) of an instant: YYYY-MM-DD. */
const eatDay = (d: Date) => new Date(d.getTime() + 3 * 3600_000).toISOString().slice(0, 10);

/**
 * What a history step changed, in words — money only for buyers and approvers. Someone who only
 * asks sees the list changes, never prices, totals, suppliers, accounts or the expense.
 */
function eventView(e: StockRequestRow["events"][number], money: boolean): StockEventView {
  const b = obj(e.before), a = obj(e.after);
  const detail: (string | null)[] = [];
  const purchase = e.action.startsWith("PURCHASE_") || e.action === "FINAL_APPROVED";
  if (e.action === "EDITED") {
    const was = strs(b?.items), now = strs(a?.items);
    if (was.join("|") !== now.join("|")) detail.push(`Was: ${was.join(" · ") || "—"}`, `Now: ${now.join(" · ") || "—"}`);
    if (b && a && b.urgent !== a.urgent) detail.push(a.urgent ? "Marked urgent" : "No longer urgent");
  } else if (money && (e.action === "PURCHASE_SAVED" || e.action === "PURCHASE_SUBMITTED")) {
    const total = n(a?.total);
    detail.push([
      total != null ? formatTZS(total) : null, s(a?.supplier) ? `from ${s(a?.supplier)}` : null,
      s(a?.receipt) ? `receipt ${s(a?.receipt)}` : a?.photo ? "receipt photo" : null, s(a?.account) ? `paid from ${s(a?.account)}` : null,
    ].filter(Boolean).join(" · ") || null);
    const was = n(b?.total);
    if (was != null && was !== total) detail.push(`Before: ${formatTZS(was)}`);
  } else if (money && e.action === "PURCHASE_SENT_BACK") {
    const was = n(b?.total);
    if (was != null) detail.push(`The purchase was ${formatTZS(was)}`);
  } else if (money && e.action === "FINAL_APPROVED") {
    const amount = n(a?.amount);
    detail.push([s(a?.expense) ? `Expense ${s(a?.expense)}` : null, amount != null ? formatTZS(amount) : null, s(a?.category)].filter(Boolean).join(" · ") || null);
    for (const r of strs(a?.received)) detail.push(`In stock: ${r}`);
    const notInStock = strs(a?.notInStock);
    if (notInStock.length) detail.push(`Not kept in stock: ${notInStock.join(", ")}`);
    if (a?.selfApproved) detail.push("Bought and approved by the same person");
  }
  return {
    id: e.id, action: e.action, from: e.fromStatus, to: e.toStatus, by: e.byLabel, role: e.byRole,
    // A correction note on a purchase can name prices — only buyers and approvers see it.
    reason: purchase && !money ? null : e.reason,
    detail: detail.filter((x): x is string => !!x), at: e.at.toISOString(),
  };
}

/** One request for the screen. Without `money` there are no prices, totals, supplier, account, receipt or expense. */
function view(r: StockRequestRow, money: boolean, deptName: (code: string) => string): StockReqView {
  return {
    id: r.id, number: r.number, department: r.department, departmentName: r.inventoryDepartment?.name ?? deptName(r.department), departmentId: r.departmentId,
    status: r.status, urgent: r.urgent, neededBy: r.neededBy?.toISOString().slice(0, 10) ?? null, reason: r.reason, note: r.note,
    by: r.requestedBy.fullName, byId: r.requestedById, at: r.createdAt.toISOString(),
    decidedBy: r.decidedBy?.fullName ?? null, decidedAt: r.decidedAt?.toISOString() ?? null, decisionNote: r.decisionNote,
    purchaseNumber: r.purchaseNumber, boughtBy: r.purchasedBy?.fullName ?? null, boughtById: r.purchasedById,
    finalBy: r.finalApprovedBy?.fullName ?? null, finalById: r.finalApprovedById, finalAt: r.finalApprovedAt?.toISOString() ?? null,
    lines: r.items.map((i) => ({
      id: i.id, name: i.name, quantity: i.quantity, unit: i.unit, note: i.note, approvedQty: i.approvedQty,
      stockItem: i.inventoryItem ? { id: i.inventoryItem.id, name: i.inventoryItem.name, unit: i.inventoryItem.unit, tracksExpiry: i.inventoryItem.tracksExpiry } : null,
      purchasedQty: i.purchasedQty, received: !!i.movementId,
      unitPrice: money ? i.unitPrice : null, lineTotal: money ? i.lineTotal : null, expiresOn: money ? i.expiresOn?.toISOString().slice(0, 10) ?? null : null,
    })),
    purchase: money && (r.purchaseNumber || r.correctionNote) ? {
      number: r.purchaseNumber, on: r.purchasedAt ? eatDay(r.purchasedAt) : null,
      supplierId: r.supplierId, supplier: r.supplier?.name ?? r.supplierName, supplierName: r.supplierName,
      receiptNumber: r.receiptNumber, receiptFileId: r.receiptFile?.id ?? null, receiptIsPdf: r.receiptFile?.contentType === "application/pdf",
      noReceiptReason: r.noReceiptReason, accountId: r.accountId, account: r.account?.name ?? null, note: r.purchaseNote,
      total: r.purchaseTotal, submittedAt: r.submittedAt?.toISOString() ?? null, correctionNote: r.correctionNote,
      expense: r.expense ? { number: r.expense.number, amount: r.expense.amount } : null,
    } : null,
    events: r.events.map((e) => eventView(e, money)),
  };
}

/**
 * Stock requests for every department: staff ask (no money), a manager reviews, the buyer records
 * what was actually bought, a manager gives the final approval — the stock goes in and ONE expense
 * is made. Someone who only asks sees their own requests, without any money.
 */
export default async function StockRequestsPage() {
  const user = await requirePagePermission("inventory.request", "expenses.approve", "inventory.receive");
  const reviewer = can(user, "expenses.approve"), buyer = can(user, "inventory.receive"), asker = can(user, "inventory.request");
  const money = reviewer || buyer;
  const today = await businessToday();
  const [{ open, closed }, drinks, settings, departments, summary, options, askerItems] = await Promise.all([
    stockRequests({ mineOnly: money ? null : user.id }),
    stockDrinks(),
    getSettings(),
    requestDepartments(),
    money ? purchasingSummary(today) : null,
    money ? purchaseOptions() : null,
    // Someone who only asks gets the stock items by name and unit — never their prices.
    money ? null : db.inventoryItem.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, unit: true, departmentId: true } }),
  ]);
  const storeItems = options ? options.items.map((i) => ({ id: i.id, name: i.name, unit: i.unit, departmentId: i.departmentId })) : askerItems ?? [];
  const deptName = (code: string) => departments.find((d) => d.code === code)?.name ?? code.charAt(0) + code.slice(1).toLowerCase();

  // Where a new request usually goes: the Mpishi → kitchen, the waiters → bar, reception → reception.
  const serve = can(user, "restaurant.serve"), kitchen = can(user, "kitchen.orders");
  const wanted = kitchen && !serve ? "KITCHEN" : serve && !reviewer ? "BAR" : can(user, "dashboard.front_desk") && !reviewer ? "RECEPTION" : "KITCHEN";
  const defaultDepartment = departments.some((d) => d.code === wanted) ? wanted : departments[0]?.code ?? "KITCHEN";

  const me: Viewer = { id: user.id, name: user.fullName, asker, reviewer, buyer, approverMustDiffer: settings.purchaseApproverMustDiffer };
  return (
    <div className="w-full space-y-4">
      <StockRequests
        open={open.map((r) => view(r, money, deptName))} closed={closed.map((r) => view(r, money, deptName))}
        me={me} hotel={settings.hotelName} today={today} kitchen={STOCK_CATALOG} drinks={drinks}
        departments={departments} storeItems={storeItems} defaultDepartment={defaultDepartment}
        summary={summary} options={options ? { suppliers: options.suppliers, accounts: options.accounts, items: options.items, categories: options.categories, expenseGroup: options.expenseGroup } : null}
      />
    </div>
  );
}
