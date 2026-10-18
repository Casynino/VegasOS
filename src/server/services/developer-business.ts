import "server-only";
import { db } from "../db";
import { audit } from "../audit";
import { assertConsoleAccess } from "./developer-console";
import type { CurrentUser } from "../auth";
import { fromDbDate } from "@/lib/time/business-date";
import type { ExpenseStatus, ReservationStatus, RestaurantOrderStatus, RestaurantOrderType, RestaurantSettlement, OrderPaymentStatus } from "@/generated/prisma/enums";

/**
 * BUSINESS — "look, don't touch" (owner, 2026-10-17). The Developer's plain, read-only tables of the hotel's data: stays, money,
 * the restaurant, the stores and the customers. Nothing here writes a record: every function only reads, and every read is bounded
 * (the latest BUSINESS_LIMIT rows, newest first, with a stable tie-break) so no page can ever read a table whole.
 *
 * Every function checks, again, that the caller is the Developer account holding "developer.access" (the page checks too — hiding a
 * link is never the protection). Working as someone else removes that right, so no one is ever shown this data through Work as.
 *
 * Only what a member of staff already sees is selected: no ID number, no e-mail address, no account or bank number, no receipt, no
 * secret. A customer's phone number is shown — and a visit to a tab is written to the audit trail (noteBusinessView).
 */

/** How many rows each table shows. */
export const BUSINESS_LIMIT = 30;

export const BUSINESS_TABS = ["stays", "money", "restaurant", "stores", "customers"] as const;
export type BusinessTab = (typeof BUSINESS_TABS)[number];

/** The `?tab=` of the address: one of the five, otherwise the first. */
export function parseBusinessTab(raw: string | string[] | undefined): BusinessTab {
  const v = (Array.isArray(raw) ? raw[0] : raw)?.toLowerCase();
  return (BUSINESS_TABS as readonly string[]).includes(v ?? "") ? (v as BusinessTab) : "stays";
}

/** The caller as these functions read it: straight from the signed-in session (getCurrentUser). */
export type BusinessViewer = Pick<CurrentUser, "id" | "fullName" | "actorType" | "permissions"> & { actorId?: string; actorName?: string };

// ───────────────────────────────────────────── stays ─────────────────────────────────────────────
export interface StayRow {
  id: string;
  /** The booking's code (VLH-7K2M9Q). */
  reference: string;
  guest: string;
  /** The room numbers (the booking's live rooms; all of them when every room was cancelled). */
  rooms: string[];
  arrival: string;
  departure: string;
  status: ReservationStatus;
  /** The folio as the system keeps it: total (after discounts, with charges), paid, and what is still owed. */
  total: number;
  paid: number;
  balance: number;
  createdAt: Date;
}

export async function businessStays(viewer: BusinessViewer): Promise<StayRow[]> {
  assertConsoleAccess(viewer);
  const rows = await db.reservation.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: BUSINESS_LIMIT,
    select: {
      id: true, reference: true, status: true, arrivalDate: true, departureDate: true, netAmount: true, paidAmount: true, balanceAmount: true, createdAt: true,
      guest: { select: { fullName: true } },
      rooms: { orderBy: [{ arrivalDate: "asc" }, { id: "asc" }], take: 50, select: { status: true, room: { select: { number: true } } } },
    },
  });
  return rows.map((r) => {
    const live = r.rooms.filter((x) => x.status !== "CANCELLED");
    const numbers = (live.length ? live : r.rooms).map((x) => x.room.number);
    return {
      id: r.id,
      reference: r.reference,
      guest: r.guest.fullName,
      rooms: [...new Set(numbers)],
      arrival: fromDbDate(r.arrivalDate),
      departure: fromDbDate(r.departureDate),
      status: r.status,
      total: r.netAmount,
      paid: r.paidAmount,
      balance: r.balanceAmount,
      createdAt: r.createdAt,
    };
  });
}

// ───────────────────────────────────────────── money ─────────────────────────────────────────────
export interface PaymentRow {
  id: string;
  at: Date;
  kind: "PAYMENT" | "REFUND";
  /** What it was for: the booking's code, the invoice's number or the company; null when it is none of them. */
  forWhat: string | null;
  amount: number;
  method: string;
  /** The hotel account the money went into (its name only — never its number). */
  account: string;
  reference: string | null;
  recordedBy: string;
  /** Taken back by a reversal (the original line stays; the reversal is a line of its own). */
  reversed: boolean;
  reversalReason: string | null;
}

export interface ExpenseRow {
  id: string;
  number: string | null;
  at: Date;
  category: string;
  description: string;
  payee: string | null;
  amount: number;
  method: string | null;
  account: string | null;
  recordedBy: string;
  status: ExpenseStatus;
  voided: boolean;
}

export async function businessMoney(viewer: BusinessViewer): Promise<{ payments: PaymentRow[]; expenses: ExpenseRow[] }> {
  assertConsoleAccess(viewer);
  const [payments, expenses] = await Promise.all([
    db.payment.findMany({
      orderBy: [{ receivedAt: "desc" }, { id: "desc" }],
      take: BUSINESS_LIMIT,
      select: {
        id: true, kind: true, status: true, amount: true, receivedAt: true, reference: true, reversedAt: true, reversalReason: true,
        method: { select: { name: true } },
        account: { select: { name: true } },
        recordedBy: { select: { fullName: true } },
        reservation: { select: { reference: true } },
        invoice: { select: { number: true } },
        corporateCustomer: { select: { companyName: true } },
      },
    }),
    db.expense.findMany({
      orderBy: [{ spentAt: "desc" }, { id: "desc" }],
      take: BUSINESS_LIMIT,
      select: {
        id: true, number: true, spentAt: true, amount: true, description: true, payee: true, status: true, voidedAt: true,
        category: { select: { name: true } },
        paymentMethod: { select: { name: true } },
        account: { select: { name: true } },
        createdBy: { select: { fullName: true } },
      },
    }),
  ]);
  return {
    payments: payments.map((p): PaymentRow => ({
      id: p.id,
      at: p.receivedAt,
      kind: p.kind,
      forWhat: p.reservation?.reference ?? p.invoice?.number ?? p.corporateCustomer?.companyName ?? null,
      amount: p.amount,
      method: p.method.name,
      account: p.account.name,
      reference: p.reference,
      recordedBy: p.recordedBy.fullName,
      reversed: p.status === "REVERSED" || !!p.reversedAt,
      reversalReason: p.reversalReason,
    })),
    expenses: expenses.map((e): ExpenseRow => ({
      id: e.id,
      number: e.number,
      at: e.spentAt,
      category: e.category.name,
      description: e.description,
      payee: e.payee,
      amount: e.amount,
      method: e.paymentMethod?.name ?? null,
      account: e.account?.name ?? null,
      recordedBy: e.createdBy.fullName,
      status: e.status,
      voided: e.status === "VOIDED" || !!e.voidedAt,
    })),
  };
}

// ───────────────────────────────────────────── restaurant ─────────────────────────────────────────────
export interface OrderRow {
  id: string;
  number: string;
  at: Date;
  type: RestaurantOrderType;
  /** Where it is served: the table or counter, or the room. */
  table: string | null;
  room: string | null;
  status: RestaurantOrderStatus;
  settlement: RestaurantSettlement;
  total: number;
  paid: number;
  paymentStatus: OrderPaymentStatus;
}

export async function businessRestaurant(viewer: BusinessViewer): Promise<OrderRow[]> {
  assertConsoleAccess(viewer);
  const rows = await db.restaurantOrder.findMany({
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: BUSINESS_LIMIT,
    select: { id: true, number: true, createdAt: true, type: true, tableLabel: true, roomNumber: true, status: true, settlement: true, total: true, paidAmount: true, paymentStatus: true },
  });
  return rows.map((o): OrderRow => ({
    id: o.id, number: o.number, at: o.createdAt, type: o.type, table: o.tableLabel, room: o.roomNumber,
    status: o.status, settlement: o.settlement, total: o.total, paid: o.paidAmount, paymentStatus: o.paymentStatus,
  }));
}

// ───────────────────────────────────────────── stores ─────────────────────────────────────────────
export interface MovementRow {
  id: string;
  at: Date;
  item: string;
  department: string;
  /** RECEIVE | USE | SALE | WASTE | COUNT | ADJUST */
  kind: string;
  reason: string;
  /** Signed, in the item's own unit. */
  change: number;
  unit: string;
  /** POSTED | PENDING | REJECTED */
  status: string;
  recordedBy: string | null;
}

export interface LowStockRow {
  id: string;
  item: string;
  department: string;
  quantity: number;
  minimum: number;
  unit: string;
}

export async function businessStores(viewer: BusinessViewer): Promise<{ movements: MovementRow[]; belowMinimum: LowStockRow[] }> {
  assertConsoleAccess(viewer);
  const [movements, low] = await Promise.all([
    db.inventoryMovement.findMany({
      orderBy: [{ recordedAt: "desc" }, { id: "desc" }],
      take: BUSINESS_LIMIT,
      select: {
        id: true, recordedAt: true, kind: true, reason: true, change: true, unit: true, status: true,
        item: { select: { name: true, department: { select: { name: true } } } },
        recordedBy: { select: { fullName: true } },
      },
    }),
    // Items whose quantity on hand is under their own minimum (the database compares the two columns).
    db.inventoryItem.findMany({
      where: { isActive: true, minStock: { not: null }, quantity: { lt: db.inventoryItem.fields.minStock } },
      orderBy: [{ name: "asc" }, { id: "asc" }],
      take: BUSINESS_LIMIT,
      select: { id: true, name: true, quantity: true, minStock: true, unit: true, department: { select: { name: true } } },
    }),
  ]);
  return {
    movements: movements.map((m): MovementRow => ({
      id: m.id, at: m.recordedAt, item: m.item.name, department: m.item.department.name, kind: m.kind, reason: m.reason,
      change: m.change, unit: m.unit, status: m.status, recordedBy: m.recordedBy?.fullName ?? null,
    })),
    belowMinimum: low.map((i): LowStockRow => ({ id: i.id, item: i.name, department: i.department.name, quantity: i.quantity, minimum: i.minStock ?? 0, unit: i.unit })),
  };
}

// ───────────────────────────────────────────── customers ─────────────────────────────────────────────
export interface CustomerRow {
  id: string;
  /** The customer's code (G-7K2M9Q). */
  reference: string | null;
  name: string;
  phone: string | null;
  vip: boolean;
  /** The latest stay that was started (checked in or out): its dates; null when the customer has not stayed yet. */
  lastStay: { arrival: string; departure: string } | null;
}

export async function businessCustomers(viewer: BusinessViewer): Promise<CustomerRow[]> {
  assertConsoleAccess(viewer);
  const rows = await db.guest.findMany({
    // A customer a manager removed is not listed (their details are wiped; their stays stay in the books).
    where: { deletedAt: null },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: BUSINESS_LIMIT,
    select: {
      id: true, reference: true, fullName: true, phone: true, vip: true,
      reservations: { where: { status: { in: ["CHECKED_IN", "CHECKED_OUT"] } }, orderBy: [{ arrivalDate: "desc" }, { id: "desc" }], take: 1, select: { arrivalDate: true, departureDate: true } },
    },
  });
  return rows.map((g): CustomerRow => ({
    id: g.id, reference: g.reference, name: g.fullName, phone: g.phone, vip: g.vip,
    lastStay: g.reservations[0] ? { arrival: fromDbDate(g.reservations[0].arrivalDate), departure: fromDbDate(g.reservations[0].departureDate) } : null,
  }));
}

// ───────────────────────────────────────────── the visit ─────────────────────────────────────────────
/** The same tab opened again within this many minutes is written once (a refresh does not fill the trail). */
export const BUSINESS_VIEW_DEDUPE_MINUTES = 10;
export const BUSINESS_VIEW_ACTION = "developer.business_viewed";

/**
 * Write down that the Developer looked at one tab of Business (once per tab per 10 minutes) — over and above the visit to the page that
 * every Developer visit already leaves. The Customers tab shows phone numbers and the Money tab shows who recorded what, so each is
 * named in the trail. Never throws: a failed write must not break the page (it leaves one line in the server log, nothing secret in it).
 */
export async function noteBusinessView(viewer: BusinessViewer, tab: BusinessTab, opts: { ipAddress?: string | null; now?: Date } = {}): Promise<"logged" | "repeat" | "not-developer" | "failed"> {
  return noteView(viewer, tab, { tab }, opts);
}

/** The three tabs of the Developer Home that show hotel data (the others are about the system itself): each look at one is written like a look at a Business tab. */
export const HOME_LOGGED_TABS = ["hotel", "money", "messages"] as const;
export type HomeLoggedTab = (typeof HOME_LOGGED_TABS)[number];

/**
 * The same note for a tab of the Developer Home (Hotel, Money, Messages & reports — money lines show who recorded what, and a delivery shows
 * a masked phone). It is the same action (`developer.business_viewed`) and the same ten-minute rule, kept apart from Business' own tab of
 * the same name: the entry is "home:money", after = { tab, area: "home" }. Never throws.
 */
export async function noteHomeTabView(viewer: BusinessViewer, tab: HomeLoggedTab, opts: { ipAddress?: string | null; now?: Date } = {}): Promise<"logged" | "repeat" | "not-developer" | "failed"> {
  return noteView(viewer, `home:${tab}`, { tab, area: "home" }, opts);
}

async function noteView(viewer: BusinessViewer, entityId: string, after: Record<string, string>, opts: { ipAddress?: string | null; now?: Date }): Promise<"logged" | "repeat" | "not-developer" | "failed"> {
  if (viewer.actorType !== "DEVELOPER") return "not-developer";
  const userId = viewer.actorId ?? viewer.id;
  try {
    const now = opts.now ?? new Date();
    const since = new Date(now.getTime() - BUSINESS_VIEW_DEDUPE_MINUTES * 60_000);
    const same = await db.auditLog.findFirst({ where: { action: BUSINESS_VIEW_ACTION, userId, entityType: "Business", entityId, createdAt: { gte: since } }, select: { id: true } });
    if (same) return "repeat";
    await audit(db, { userId, label: viewer.actorName ?? viewer.fullName, ipAddress: opts.ipAddress ?? null }, { action: BUSINESS_VIEW_ACTION, entityType: "Business", entityId, after });
    return "logged";
  } catch (e) {
    console.error("[developer-business] could not write a visit", { developerId: userId, tab: entityId, error: e instanceof Error ? e.name : "unknown" });
    return "failed";
  }
}
