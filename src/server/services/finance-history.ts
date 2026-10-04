import "server-only";
import { db } from "../db";
import { toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { STOCK_STATUS } from "./stock-requests";

/**
 * Edit history — every change to money, prices and bookings (corrections,
 * reversals, cancellations, discounts, price changes, overrides), read from
 * the audit log and shown as "who changed what, from → to, when and why".
 * Ordinary new records (a payment, an expense) are in the ledger itself.
 */

export const HISTORY_GROUPS = {
  expenses: "Expenses & purchases",
  payments: "Payments & refunds",
  prices: "Prices & discounts",
  bookings: "Bookings",
  invoices: "Invoices & companies",
  cash: "Cash & accounts",
} as const;
export type HistoryGroup = keyof typeof HISTORY_GROUPS;

const ACTIONS: Record<string, { label: string; group: HistoryGroup }> = {
  "expense.edited": { label: "edited an expense", group: "expenses" },
  "expense.corrected": { label: "corrected an expense (old line cancelled, new line posted)", group: "expenses" },
  "expense.voided": { label: "cancelled an expense", group: "expenses" },
  "expense.reinstated": { label: "reinstated an expense", group: "expenses" },
  "expense.approved": { label: "approved an expense", group: "expenses" },
  "expense.rejected": { label: "rejected an expense", group: "expenses" },
  "expense.correction_requested": { label: "sent an expense back for correction", group: "expenses" },
  // Stock requests → purchase → final approval (the approval makes the one expense).
  "stock_request.created": { label: "asked for stock", group: "expenses" },
  "stock_request.edited": { label: "changed a stock request", group: "expenses" },
  "stock_request.approved_for_purchase": { label: "approved a stock request — to buy", group: "expenses" },
  "stock_request.sent_back": { label: "sent a stock request back to be changed", group: "expenses" },
  "stock_request.rejected": { label: "rejected a stock request", group: "expenses" },
  "stock_request.resubmitted": { label: "sent a changed stock request again", group: "expenses" },
  "stock_request.cancelled": { label: "cancelled a stock request", group: "expenses" },
  "stock_request.purchase_saved": { label: "saved a stock purchase (still buying)", group: "expenses" },
  "stock_request.purchase_submitted": { label: "sent a stock purchase for final approval", group: "expenses" },
  "stock_request.purchase_sent_back": { label: "sent a stock purchase back for correction", group: "expenses" },
  "stock_request.final_approved": { label: "gave a stock purchase its final approval (stock received, expense made)", group: "expenses" },
  "payment.refunded": { label: "gave a refund", group: "payments" },
  "payment.reversed": { label: "reversed a payment", group: "payments" },
  "revenue.voided": { label: "cancelled a dining / bar sale", group: "payments" },
  "reservation.charge_voided": { label: "removed an item from a room bill", group: "payments" },
  "reservation.discount_changed": { label: "changed a discount", group: "prices" },
  "pricing.rate_changed": { label: "changed a room price", group: "prices" },
  "room_type.rate_changed": { label: "changed a room price", group: "prices" },
  "pricing.promotion_created": { label: "created a promotion", group: "prices" },
  "pricing.promotion_updated": { label: "changed a promotion", group: "prices" },
  "pricing.discount_rules": { label: "changed the discount rules", group: "prices" },
  "pricing.date_price_created": { label: "created a date price", group: "prices" },
  "pricing.date_price_updated": { label: "changed a date price", group: "prices" },
  "pricing.date_price_on": { label: "switched on a date price", group: "prices" },
  "pricing.date_price_off": { label: "switched off a date price", group: "prices" },
  "pricing.promotion_activated": { label: "switched on a promotion", group: "prices" },
  "pricing.promotion_deactivated": { label: "switched off a promotion", group: "prices" },
  "reservation.cancelled": { label: "cancelled a booking", group: "bookings" },
  "reservation.no_show": { label: "marked a no-show", group: "bookings" },
  "reservation.hold_expired": { label: "released an unpaid booking (hold expired)", group: "bookings" },
  "reservation.confirmed": { label: "confirmed a booking", group: "bookings" },
  "reservation.back_to_pending": { label: "booking back to pending (payment removed)", group: "bookings" },
  "reservation.dates_changed": { label: "changed booking dates", group: "bookings" },
  "reservation.extended": { label: "extended a stay", group: "bookings" },
  "reservation.checkin_not_ready_override": { label: "checked in to a room that was not ready (override)", group: "bookings" },
  "reservation.room_assigned": { label: "changed the room", group: "bookings" },
  "reservation.room_changed": { label: "moved the guest to another room", group: "bookings" },
  "reservation.late_arrival": { label: "noted a late arrival", group: "bookings" },
  "reservation.late_arrival_confirmed": { label: "kept a no-show booking (guest coming late)", group: "bookings" },
  "reservation.room_released": { label: "released a no-show room", group: "bookings" },
  "payment.method_corrected": { label: "corrected a payment method", group: "payments" },
  "reservation.billing_changed": { label: "changed who pays for a stay", group: "invoices" },
  "invoice.cancelled": { label: "cancelled an invoice", group: "invoices" },
  "invoice.voided": { label: "voided an invoice", group: "invoices" },
  "corporate.updated": { label: "changed a company account", group: "invoices" },
  "corporate.credit_override": { label: "approved going over a company's credit limit", group: "invoices" },
  "finance.movement_posted": { label: "posted a money movement", group: "cash" },
  "finance.movement_reversed": { label: "reversed a money movement", group: "cash" },
  "finance.cash_counted": { label: "counted cash", group: "cash" },
  "finance.cash_count_accepted": { label: "settled a cash count", group: "cash" },
};

const LABELS: Record<string, string> = {
  amount: "Amount", category: "Category", description: "What it was for", payee: "Paid to", account: "Paid from", status: "Status", number: "Number",
  discountPerNight: "Discount per night", net: "Total", baseRate: "Room price", rate: "Room price", paid: "Paid", balance: "Balance",
  arrival: "Arrival", departure: "Departure", billTo: "Who pays", covers: "Company covers", terms: "Payment terms", company: "Company",
  holdUntil: "Held until", total: "Total", room: "Room", rooms: "Rooms", policy: "Policy", kept: "Payment kept", refundDue: "Refund due",
  receivedInto: "Account", method: "Method", reference: "Reference", kind: "Kind", reversal: "Reversal", creditLimit: "Credit limit", paymentTermDays: "Payment terms (days)",
  nights: "Nights", difference: "Price difference", nightPrices: "Night prices", additionalPaid: "Extra paid now", excess: "Paid beyond the new price", excessPolicy: "What happens to it", standardPrice: "New room's price", charged: "Charged to guest", compensation: "Hotel compensation (free upgrade)", source: "Requested by", from: "From night", oldRoomStatus: "Old room now", downgrade: "Cheaper room", eta: "Expected arrival", lateArrival: "Late arrival", released: "Room released",
};
/** Field names on stock request changes (kept apart, so bookings and groups read as before). */
const STOCK_LABELS: Record<string, string> = {
  items: "Items", urgent: "Urgent", department: "Department", lines: "Bought", supplier: "Supplier", receipt: "Receipt no.", photo: "Receipt photo",
  bought: "Bought on", purchase: "Purchase", expense: "Expense", received: "Into stock", notInStock: "Not kept in stock",
  selfApproved: "Buyer gave the final approval", buyer: "Bought by", role: "Their role",
};
const HIDE = new Set(["reason", "overrideReason", "voidReason", "id"]);

function show(v: unknown): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "boolean") return v ? "yes" : "no";
  if (Array.isArray(v)) return v.map(show).join(", ") || "—";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}T/.test(s) ? new Date(s).toLocaleString("en-GB", { timeZone: "Africa/Dar_es_Salaam", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : s;
}

export interface HistoryItem {
  id: string; at: Date; who: string; action: string; label: string; group: HistoryGroup;
  record: string; href: string | null; reason: string | null;
  changes: { field: string; from: string; to: string }[];
}

export async function financeHistory(f: { from: BusinessDate; to: BusinessDate; group?: HistoryGroup | null; userId?: string | null; q?: string | null }) {
  const actions = Object.entries(ACTIONS).filter(([, a]) => !f.group || a.group === f.group).map(([k]) => k);
  const logs = await db.auditLog.findMany({
    where: { action: { in: actions }, businessDate: { gte: toDbDate(f.from), lte: toDbDate(f.to) }, ...(f.userId ? { userId: f.userId } : {}) },
    include: { user: { select: { fullName: true } } },
    orderBy: { createdAt: "desc" },
    take: 500,
  });
  // Names for the records the changes were made to.
  const ids = (type: string) => [...new Set(logs.filter((l) => l.entityType === type && l.entityId).map((l) => l.entityId!))];
  const [res, exps, pays, invs, corps, stock] = await Promise.all([
    db.reservation.findMany({ where: { id: { in: ids("Reservation") } }, select: { id: true, reference: true, guest: { select: { fullName: true } } } }),
    db.expense.findMany({ where: { id: { in: ids("Expense") } }, select: { id: true, number: true, description: true } }),
    db.payment.findMany({ where: { id: { in: ids("Payment") } }, select: { id: true, amount: true, reservationId: true, invoiceId: true, reservation: { select: { reference: true } } } }),
    db.invoice.findMany({ where: { id: { in: ids("Invoice") } }, select: { id: true, number: true } }),
    db.corporateCustomer.findMany({ where: { id: { in: ids("CorporateCustomer") } }, select: { id: true, companyName: true } }),
    db.stockRequest.findMany({ where: { id: { in: ids("StockRequest") } }, select: { id: true, number: true, purchaseNumber: true, department: true, inventoryDepartment: { select: { name: true } } } }),
  ]);
  const name = (type: string, id: string | null): { record: string; href: string | null } => {
    if (!id) return { record: type, href: null };
    if (type === "Reservation") { const r = res.find((x) => x.id === id); return { record: r ? `${r.reference} · ${r.guest.fullName}` : "Booking", href: `/staff/reservations/${id}` }; }
    if (type === "Expense") { const e = exps.find((x) => x.id === id); return { record: e ? `Expense ${e.number ?? ""} · ${e.description}` : "Expense", href: `/staff/expenses${e?.number ? `?q=${e.number}` : ""}` }; }
    if (type === "Payment") { const p = pays.find((x) => x.id === id); return { record: p ? `Payment TZS ${p.amount.toLocaleString("en-US")}${p.reservation ? ` · ${p.reservation.reference}` : ""}` : "Payment", href: p?.reservationId ? `/staff/reservations/${p.reservationId}` : p?.invoiceId ? `/staff/invoices/${p.invoiceId}` : null }; }
    if (type === "Invoice") { const i = invs.find((x) => x.id === id); return { record: i ? `Invoice ${i.number}` : "Invoice", href: `/staff/invoices/${id}` }; }
    if (type === "CorporateCustomer") { const c = corps.find((x) => x.id === id); return { record: c?.companyName ?? "Company", href: `/staff/corporate/${id}` }; }
    if (type === "StockRequest") {
      const r = stock.find((x) => x.id === id);
      return { record: r ? `Stock request ${r.number}${r.purchaseNumber ? ` · purchase ${r.purchaseNumber}` : ""} · ${r.inventoryDepartment?.name ?? r.department}` : "Stock request", href: "/staff/stock-requests" };
    }
    if (type === "LedgerEntry" || type === "CashCount") return { record: type === "CashCount" ? "Cash count" : "Money movement", href: "/staff/finance/accounts" };
    return { record: type, href: type.startsWith("Room") || type === "Promotion" || type === "HotelSettings" ? "/staff/settings/pricing" : null };
  };

  const items: HistoryItem[] = logs.map((l) => {
    const before = (l.before ?? {}) as Record<string, unknown>;
    const after = { ...((l.after ?? {}) as Record<string, unknown>) };
    // Stock requests: plain step names ("Waiting for review" → "Approved — to buy"); the final approval completes it.
    const stockLog = l.entityType === "StockRequest";
    if (stockLog && l.action === "stock_request.final_approved" && !("status" in after)) after.status = "COMPLETED";
    const val = (k: string, v: unknown) => (stockLog && k === "status" && typeof v === "string" ? STOCK_STATUS[v] ?? v : show(v));
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !HIDE.has(k));
    const changes = keys
      .filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
      .map((k) => ({ field: (stockLog ? STOCK_LABELS[k] : undefined) ?? LABELS[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), from: k in before ? val(k, before[k]) : "", to: k in after ? val(k, after[k]) : "" }));
    const reason = [after.reason, after.overrideReason, before.reason].find((x) => typeof x === "string" && x.trim()) as string | undefined;
    const a = ACTIONS[l.action];
    return { id: l.id, at: l.createdAt, who: l.user?.fullName ?? l.actorLabel ?? "System", action: l.action, label: a.label, group: a.group, ...name(l.entityType, l.entityId), reason: reason ?? null, changes };
  });
  const q = f.q?.trim().toLowerCase();
  return q ? items.filter((i) => [i.who, i.record, i.label, i.reason, ...i.changes.map((c) => `${c.field} ${c.from} ${c.to}`)].some((x) => x?.toLowerCase().includes(q))) : items;
}

/** Everything that happened to one booking, oldest first, in plain words (for the booking's timeline). */
const TIMELINE_EXTRA: Record<string, string> = {
  "reservation.created": "made the booking", "reservation.walk_in": "checked in a walk-in guest", "reservation.checked_in": "checked the guest in",
  "reservation.checked_out": "checked the guest out", "payment.created": "recorded a payment", "payment.refunded": "gave a refund",
  "reservation.confirmed_by_payment": "— payment received, booking confirmed", "reservation.held": "put the room on hold",
  "reservation.charge_added": "added to the room bill", "reservation.charges_posted": "added room service / extras",
  "reservation.late_checkout": "approved a late checkout", "invoice.company_billed": "billed the company", "guest.updated_at_checkin": "updated guest details at check-in",
};

export async function bookingTimeline(reservationId: string) {
  const payments = await db.payment.findMany({ where: { reservationId }, select: { id: true } });
  const logs = await db.auditLog.findMany({
    where: { OR: [{ entityType: "Reservation", entityId: reservationId }, { entityType: "Payment", entityId: { in: payments.map((p) => p.id) } }] },
    include: { user: { select: { fullName: true } } },
    orderBy: { createdAt: "asc" },
    take: 200,
  });
  return logs.map((l) => {
    const before = (l.before ?? {}) as Record<string, unknown>;
    const after = (l.after ?? {}) as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !HIDE.has(k));
    const changes = Object.keys(before).length
      ? keys.filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
          .map((k) => ({ field: LABELS[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), from: k in before ? show(before[k]) : "", to: k in after ? show(after[k]) : "" }))
      : [];
    const reason = [after.reason, after.overrideReason].find((x) => typeof x === "string" && x.trim()) as string | undefined;
    const amount = typeof after.amount === "number" && !Object.keys(before).length ? ` TZS ${after.amount.toLocaleString("en-US")}${after.method ? ` · ${after.method}` : ""}` : "";
    return {
      id: l.id, at: l.createdAt, who: l.user?.fullName ?? l.actorLabel ?? "System",
      label: (ACTIONS[l.action]?.label ?? TIMELINE_EXTRA[l.action] ?? l.action.replace(/^[a-z_]+\./, "").replaceAll("_", " ")) + amount,
      changes: changes.slice(0, 8), reason: reason ?? null,
    };
  });
}

const GROUP_EXTRA: Record<string, string> = {
  "group.created": "created the group", "group.updated": "changed the group", "group.room_added": "added a room",
  "group.room_linked": "put a booking into the group", "group.room_unlinked": "removed a booking from the group",
  "group.checked_in": "checked rooms in", "group.checked_out": "checked rooms out", "group.cancelled": "cancelled the group's rooms",
  "group.invoiced": "invoiced rooms", "group.finalized": "finalized the group bill", "group.statement_sent": "sent a statement",
  "invoice.group_billed": "moved a room's bill to the group invoice", "invoice.issued": "issued an invoice", "invoice.sent": "sent an invoice",
  "invoice.voided": "voided an invoice", "invoice.cancelled": "cancelled an invoice", "payment.group": "recorded a group payment",
  "reservation.occupant_added": "added a guest to a room", "reservation.occupant_removed": "removed a guest from a room",
  "reservation.room_changed": "changed a room", "reservation.cancelled": "cancelled a room",
};

/** Everything that happened to a group, its rooms, invoices and payments — newest first, with who, what and why. */
export async function groupTimeline(groupId: string) {
  const [rooms, invoices] = await Promise.all([
    db.reservation.findMany({ where: { groupId }, select: { id: true, reference: true, guest: { select: { fullName: true } }, rooms: { select: { room: { select: { number: true } } }, take: 1 } } }),
    db.invoice.findMany({ where: { groupId }, select: { id: true, number: true } }),
  ]);
  const payments = await db.payment.findMany({
    where: { OR: [{ invoiceId: { in: invoices.map((i) => i.id) } }, { reservationId: { in: rooms.map((r) => r.id) } }] }, select: { id: true },
  });
  const logs = await db.auditLog.findMany({
    where: {
      OR: [
        { entityType: "BookingGroup", entityId: groupId },
        { entityType: "Reservation", entityId: { in: rooms.map((r) => r.id) } },
        { entityType: "Invoice", entityId: { in: invoices.map((i) => i.id) } },
        { entityType: "Payment", entityId: { in: payments.map((p) => p.id) } },
      ],
    },
    include: { user: { select: { fullName: true } } },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  const roomOf = new Map(rooms.map((r) => [r.id, `Room ${r.rooms[0]?.room.number ?? "—"} · ${r.guest.fullName}`]));
  const invOf = new Map(invoices.map((i) => [i.id, i.number]));
  return logs.map((l) => {
    const before = (l.before ?? {}) as Record<string, unknown>;
    const after = (l.after ?? {}) as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !HIDE.has(k));
    const changes = Object.keys(before).length
      ? keys.filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
          .map((k) => ({ field: LABELS[k] ?? k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), from: k in before ? show(before[k]) : "", to: k in after ? show(after[k]) : "" }))
      : [];
    const reason = [after.reason, after.overrideReason].find((x) => typeof x === "string" && x.trim()) as string | undefined;
    const amount = typeof after.amount === "number" && !Object.keys(before).length ? ` TZS ${after.amount.toLocaleString("en-US")}` : "";
    const record = l.entityType === "Reservation" ? roomOf.get(l.entityId ?? "") : l.entityType === "Invoice" ? `Invoice ${invOf.get(l.entityId ?? "") ?? ""}`
      : typeof after.invoice === "string" ? `Invoice ${after.invoice}` : typeof after.number === "string" ? `Invoice ${after.number}` : null;
    return {
      id: l.id, at: l.createdAt, who: l.user?.fullName ?? l.actorLabel ?? "System", record: record ?? null,
      label: (GROUP_EXTRA[l.action] ?? ACTIONS[l.action]?.label ?? TIMELINE_EXTRA[l.action] ?? l.action.replace(/^[a-z_]+\./, "").replaceAll("_", " ")) + amount,
      changes: changes.slice(0, 8), reason: reason ?? null,
    };
  });
}
