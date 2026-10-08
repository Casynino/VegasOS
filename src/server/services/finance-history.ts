import "server-only";
import { db } from "../db";
import { toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { STOCK_STATUS } from "./stock-requests";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { DEFAULT_LOCALE } from "@/i18n/config";
import type { T } from "@/i18n/translate";

/**
 * Edit history — every change to money, prices and bookings (corrections,
 * reversals, cancellations, discounts, price changes, overrides), read from
 * the audit log and shown as "who changed what, from → to, when and why".
 * Ordinary new records (a payment, an expense) are in the ledger itself.
 */

export const HISTORY_GROUPS = {
  expenses: msg("Expenses & purchases"),
  payments: msg("Payments & refunds"),
  prices: msg("Prices & discounts"),
  bookings: msg("Bookings"),
  invoices: msg("Invoices & companies"),
  cash: msg("Cash & accounts"),
} as const;
export type HistoryGroup = keyof typeof HISTORY_GROUPS;

const ACTIONS: Record<string, { label: string; group: HistoryGroup }> = {
  "expense.edited": { label: msg("edited an expense"), group: "expenses" },
  "expense.corrected": { label: msg("corrected an expense (old line cancelled, new line posted)"), group: "expenses" },
  "expense.voided": { label: msg("cancelled an expense"), group: "expenses" },
  "expense.reinstated": { label: msg("reinstated an expense"), group: "expenses" },
  "expense.approved": { label: msg("approved an expense"), group: "expenses" },
  "expense.rejected": { label: msg("rejected an expense"), group: "expenses" },
  "expense.correction_requested": { label: msg("sent an expense back for correction"), group: "expenses" },
  // Stock requests → purchase → final approval (the approval makes the one expense).
  "stock_request.created": { label: msg("asked for stock"), group: "expenses" },
  "stock_request.edited": { label: msg("changed a stock request"), group: "expenses" },
  "stock_request.approved_for_purchase": { label: msg("approved a stock request — to buy"), group: "expenses" },
  "stock_request.sent_back": { label: msg("sent a stock request back to be changed"), group: "expenses" },
  "stock_request.rejected": { label: msg("rejected a stock request"), group: "expenses" },
  "stock_request.resubmitted": { label: msg("sent a changed stock request again"), group: "expenses" },
  "stock_request.cancelled": { label: msg("cancelled a stock request"), group: "expenses" },
  "stock_request.purchase_saved": { label: msg("saved a stock purchase (still buying)"), group: "expenses" },
  "stock_request.purchase_submitted": { label: msg("sent a stock purchase for final approval"), group: "expenses" },
  "stock_request.purchase_sent_back": { label: msg("sent a stock purchase back for correction"), group: "expenses" },
  "stock_request.final_approved": { label: msg("gave a stock purchase its final approval (stock received, expense made)"), group: "expenses" },
  "payment.refunded": { label: msg("gave a refund"), group: "payments" },
  "payment.reversed": { label: msg("reversed a payment"), group: "payments" },
  "revenue.voided": { label: msg("cancelled a dining / bar sale"), group: "payments" },
  "reservation.charge_voided": { label: msg("removed an item from a room bill"), group: "payments" },
  "reservation.discount_changed": { label: msg("changed a discount"), group: "prices" },
  "pricing.rate_changed": { label: msg("changed a room price"), group: "prices" },
  "room_type.rate_changed": { label: msg("changed a room price"), group: "prices" },
  "pricing.promotion_created": { label: msg("created a promotion"), group: "prices" },
  "pricing.promotion_updated": { label: msg("changed a promotion"), group: "prices" },
  "pricing.discount_rules": { label: msg("changed the discount rules"), group: "prices" },
  "pricing.date_price_created": { label: msg("created a date price"), group: "prices" },
  "pricing.date_price_updated": { label: msg("changed a date price"), group: "prices" },
  "pricing.date_price_on": { label: msg("switched on a date price"), group: "prices" },
  "pricing.date_price_off": { label: msg("switched off a date price"), group: "prices" },
  "pricing.promotion_activated": { label: msg("switched on a promotion"), group: "prices" },
  "pricing.promotion_deactivated": { label: msg("switched off a promotion"), group: "prices" },
  "reservation.cancelled": { label: msg("cancelled a booking"), group: "bookings" },
  "reservation.no_show": { label: msg("marked a no-show"), group: "bookings" },
  "reservation.hold_expired": { label: msg("released an unpaid booking (hold expired)"), group: "bookings" },
  "reservation.confirmed": { label: msg("confirmed a booking"), group: "bookings" },
  "reservation.back_to_pending": { label: msg("booking back to pending (payment removed)"), group: "bookings" },
  "reservation.dates_changed": { label: msg("changed booking dates"), group: "bookings" },
  "reservation.extended": { label: msg("extended a stay"), group: "bookings" },
  "reservation.checkin_not_ready_override": { label: msg("checked in to a room that was not ready (override)"), group: "bookings" },
  "reservation.room_assigned": { label: msg("changed the room"), group: "bookings" },
  "reservation.room_changed": { label: msg("moved the guest to another room"), group: "bookings" },
  "reservation.late_arrival": { label: msg("noted a late arrival"), group: "bookings" },
  "reservation.late_arrival_confirmed": { label: msg("kept a no-show booking (guest coming late)"), group: "bookings" },
  "reservation.room_released": { label: msg("released a no-show room"), group: "bookings" },
  "payment.method_corrected": { label: msg("corrected a payment method"), group: "payments" },
  "reservation.billing_changed": { label: msg("changed who pays for a stay"), group: "invoices" },
  "invoice.cancelled": { label: msg("cancelled an invoice"), group: "invoices" },
  "invoice.voided": { label: msg("voided an invoice"), group: "invoices" },
  "corporate.updated": { label: msg("changed a company account"), group: "invoices" },
  "corporate.credit_override": { label: msg("approved going over a company's credit limit"), group: "invoices" },
  "finance.movement_posted": { label: msg("posted a money movement"), group: "cash" },
  "finance.movement_reversed": { label: msg("reversed a money movement"), group: "cash" },
  "finance.cash_counted": { label: msg("counted cash"), group: "cash" },
  "finance.cash_count_accepted": { label: msg("settled a cash count"), group: "cash" },
};

const LABELS: Record<string, string> = {
  amount: msg("Amount"), category: msg("Category"), description: msg("What it was for"), payee: msg("Paid to"), account: msg("Paid from"), status: msg("Status"), number: msg("Number"),
  discountPerNight: msg("Discount per night"), net: msg("Total"), baseRate: msg("Room price"), rate: msg("Room price"), paid: msg("Paid"), balance: msg("Balance"),
  arrival: msg("Arrival"), departure: msg("Departure"), billTo: msg("Who pays"), covers: msg("Company covers"), terms: msg("Payment terms"), company: msg("Company"),
  holdUntil: msg("Held until"), total: msg("Total"), room: msg("Room"), rooms: msg("Rooms"), policy: msg("Policy"), kept: msg("Payment kept"), refundDue: msg("Refund due"),
  receivedInto: msg("Account"), method: msg("Method"), reference: msg("Reference"), kind: msg("Kind"), reversal: msg("Reversal"), creditLimit: msg("Credit limit"), paymentTermDays: msg("Payment terms (days)"),
  nights: msg("Nights"), difference: msg("Price difference"), nightPrices: msg("Night prices"), additionalPaid: msg("Extra paid now"), excess: msg("Paid beyond the new price"), excessPolicy: msg("What happens to it"), standardPrice: msg("New room's price"), charged: msg("Charged to guest"), compensation: msg("Hotel compensation (free upgrade)"), source: msg("Requested by"), from: msg("From night"), oldRoomStatus: msg("Old room now"), downgrade: msg("Cheaper room"), eta: msg("Expected arrival"), lateArrival: msg("Late arrival"), released: msg("Room released"),
};
/** Field names on stock request changes (kept apart, so bookings and groups read as before). */
const STOCK_LABELS: Record<string, string> = {
  items: msg("Items"), urgent: msg("Urgent"), department: msg("Department"), lines: msg("Bought"), supplier: msg("Supplier"), receipt: msg("Receipt no."), photo: msg("Receipt photo"),
  bought: msg("Bought on"), purchase: msg("Purchase"), expense: msg("Expense"), received: msg("Into stock"), notInStock: msg("Not kept in stock"),
  selfApproved: msg("Buyer gave the final approval"), buyer: msg("Bought by"), role: msg("Their role"),
};
const HIDE = new Set(["reason", "overrideReason", "voidReason", "id"]);
/**
 * A record that has no number or name of its own (a room price, a promotion, the discount rules…): what it is, in the
 * reader's words. English readers keep the record's type as it always was.
 */
const RECORD_KIND: Record<string, string> = {
  RoomType: msg("Room type"), Promotion: msg("Promotion"), PriceRule: msg("Date price"), HotelSettings: msg("Discount rules"), RevenueTransaction: msg("Sale"),
};

/** A changed value, in the reader's words (yes / no, dates) — amounts and what staff typed stay as they are. */
function show(v: unknown, t: T): string {
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "number") return v.toLocaleString("en-US");
  if (typeof v === "boolean") return v ? t("yes") : t("no");
  if (Array.isArray(v)) return v.map((x) => show(x, t)).join(", ") || "—";
  if (typeof v === "object") return JSON.stringify(v);
  const s = String(v);
  return /^\d{4}-\d{2}-\d{2}T/.test(s) ? new Date(s).toLocaleString(t.intl, { timeZone: "Africa/Dar_es_Salaam", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : s;
}

export interface HistoryItem {
  id: string; at: Date; who: string; action: string; label: string; group: HistoryGroup;
  record: string; href: string | null; reason: string | null;
  changes: { field: string; from: string; to: string }[];
}

export async function financeHistory(f: { from: BusinessDate; to: BusinessDate; group?: HistoryGroup | null; userId?: string | null; q?: string | null }) {
  const t = await getT();
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
    if (type === "Expense") { const e = exps.find((x) => x.id === id); return { record: e ? t("Expense {number} · {description}", { number: e.number ?? "", description: e.description }) : "Expense", href: `/staff/expenses${e?.number ? `?q=${e.number}` : ""}` }; }
    if (type === "Payment") { const p = pays.find((x) => x.id === id); return { record: p ? `${t("Payment TZS {amount}", { amount: p.amount.toLocaleString("en-US") })}${p.reservation ? ` · ${p.reservation.reference}` : ""}` : "Payment", href: p?.reservationId ? `/staff/reservations/${p.reservationId}` : p?.invoiceId ? `/staff/invoices/${p.invoiceId}` : null }; }
    if (type === "Invoice") { const i = invs.find((x) => x.id === id); return { record: i ? t("Invoice {number}", { number: i.number }) : "Invoice", href: `/staff/invoices/${id}` }; }
    if (type === "CorporateCustomer") { const c = corps.find((x) => x.id === id); return { record: c?.companyName ?? "Company", href: `/staff/corporate/${id}` }; }
    if (type === "StockRequest") {
      const r = stock.find((x) => x.id === id);
      return { record: r ? `${t("Stock request {number}", { number: r.number })}${r.purchaseNumber ? ` · ${t("purchase {number}", { number: r.purchaseNumber })}` : ""} · ${r.inventoryDepartment ? t(r.inventoryDepartment.name) : r.department}` : "Stock request", href: "/staff/stock-requests" };
    }
    if (type === "LedgerEntry" || type === "CashCount") return { record: type === "CashCount" ? "Cash count" : "Money movement", href: "/staff/finance/accounts" };
    return { record: RECORD_KIND[type] && t.locale !== DEFAULT_LOCALE ? t(RECORD_KIND[type]) : type, href: type.startsWith("Room") || type === "Promotion" || type === "HotelSettings" ? "/staff/settings/pricing" : null };
  };

  const items: HistoryItem[] = logs.map((l) => {
    const before = (l.before ?? {}) as Record<string, unknown>;
    const after = { ...((l.after ?? {}) as Record<string, unknown>) };
    // Stock requests: plain step names ("Waiting for review" → "Approved — to buy"); the final approval completes it.
    const stockLog = l.entityType === "StockRequest";
    if (stockLog && l.action === "stock_request.final_approved" && !("status" in after)) after.status = "COMPLETED";
    const val = (k: string, v: unknown) => (stockLog && k === "status" && typeof v === "string" ? (STOCK_STATUS[v] ? t(STOCK_STATUS[v]) : v) : show(v, t));
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
  "reservation.created": msg("made the booking"), "reservation.walk_in": msg("checked in a walk-in guest"), "reservation.checked_in": msg("checked the guest in"),
  "reservation.checked_out": msg("checked the guest out"), "payment.created": msg("recorded a payment"), "payment.refunded": msg("gave a refund"),
  "reservation.confirmed_by_payment": msg("— payment received, booking confirmed"), "reservation.held": msg("put the room on hold"),
  "reservation.charge_added": msg("added to the room bill"), "reservation.charges_posted": msg("added room service / extras"),
  "reservation.late_checkout": msg("approved a late checkout"), "invoice.company_billed": msg("billed the company"), "guest.updated_at_checkin": msg("updated guest details at check-in"),
};

export async function bookingTimeline(reservationId: string) {
  const t = await getT();
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
          .map((k) => ({ field: LABELS[k] ? t(LABELS[k]) : k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), from: k in before ? show(before[k], t) : "", to: k in after ? show(after[k], t) : "" }))
      : [];
    const reason = [after.reason, after.overrideReason].find((x) => typeof x === "string" && x.trim()) as string | undefined;
    const amount = typeof after.amount === "number" && !Object.keys(before).length ? ` TZS ${after.amount.toLocaleString("en-US")}${after.method ? ` · ${after.method}` : ""}` : "";
    const said = ACTIONS[l.action]?.label ?? TIMELINE_EXTRA[l.action];
    return {
      id: l.id, at: l.createdAt, who: l.user?.fullName ?? l.actorLabel ?? "System",
      label: (said ? t(said) : l.action.replace(/^[a-z_]+\./, "").replaceAll("_", " ")) + amount,
      changes: changes.slice(0, 8), reason: reason ?? null,
    };
  });
}

const GROUP_EXTRA: Record<string, string> = {
  "group.created": msg("created the group"), "group.updated": msg("changed the group"), "group.room_added": msg("added a room"),
  "group.room_linked": msg("put a booking into the group"), "group.room_unlinked": msg("removed a booking from the group"),
  "group.checked_in": msg("checked rooms in"), "group.checked_out": msg("checked rooms out"), "group.cancelled": msg("cancelled the group's rooms"),
  "group.invoiced": msg("invoiced rooms"), "group.finalized": msg("finalized the group bill"), "group.statement_sent": msg("sent a statement"),
  "invoice.group_billed": msg("moved a room's bill to the group invoice"), "invoice.issued": msg("issued an invoice"), "invoice.sent": msg("sent an invoice"),
  "invoice.voided": msg("voided an invoice"), "invoice.cancelled": msg("cancelled an invoice"), "payment.group": msg("recorded a group payment"),
  "reservation.occupant_added": msg("added a guest to a room"), "reservation.occupant_removed": msg("removed a guest from a room"),
  "reservation.room_changed": msg("changed a room"), "reservation.cancelled": msg("cancelled a room"),
};

/** Everything that happened to a group, its rooms, invoices and payments — newest first, with who, what and why. */
export async function groupTimeline(groupId: string) {
  const t = await getT();
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
  const roomOf = new Map(rooms.map((r) => [r.id, t("Room {room} · {guest}", { room: r.rooms[0]?.room.number ?? "—", guest: r.guest.fullName })]));
  const invOf = new Map(invoices.map((i) => [i.id, i.number]));
  return logs.map((l) => {
    const before = (l.before ?? {}) as Record<string, unknown>;
    const after = (l.after ?? {}) as Record<string, unknown>;
    const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => !HIDE.has(k));
    const changes = Object.keys(before).length
      ? keys.filter((k) => JSON.stringify(before[k] ?? null) !== JSON.stringify(after[k] ?? null))
          .map((k) => ({ field: LABELS[k] ? t(LABELS[k]) : k.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()), from: k in before ? show(before[k], t) : "", to: k in after ? show(after[k], t) : "" }))
      : [];
    const reason = [after.reason, after.overrideReason].find((x) => typeof x === "string" && x.trim()) as string | undefined;
    const amount = typeof after.amount === "number" && !Object.keys(before).length ? ` TZS ${after.amount.toLocaleString("en-US")}` : "";
    const invoice = (number: string) => t("Invoice {number}", { number });
    const record = l.entityType === "Reservation" ? roomOf.get(l.entityId ?? "") : l.entityType === "Invoice" ? invoice(invOf.get(l.entityId ?? "") ?? "")
      : typeof after.invoice === "string" ? invoice(after.invoice) : typeof after.number === "string" ? invoice(after.number) : null;
    const said = GROUP_EXTRA[l.action] ?? ACTIONS[l.action]?.label ?? TIMELINE_EXTRA[l.action];
    return {
      id: l.id, at: l.createdAt, who: l.user?.fullName ?? l.actorLabel ?? t("System"), record: record ?? null,
      label: (said ? t(said) : l.action.replace(/^[a-z_]+\./, "").replaceAll("_", " ")) + amount,
      changes: changes.slice(0, 8), reason: reason ?? null,
    };
  });
}
