import "server-only";
import { ONLINE_RECORDER_ID } from "./online-recorder";
import { isHotelOrder } from "@/server/desk";
import { db } from "../db";
import type { Prisma } from "@/generated/prisma/client";
import type { MoneyAccountKind } from "@/generated/prisma/enums";
import { businessDayConfig, getSettings, stayConfig } from "../settings";
import { businessDateOf, businessRangeBounds, type BusinessDate } from "@/lib/time/business-date";

/**
 * COLLECTIONS — the money each person actually took from customers, from the payment records
 * themselves (never from order or bill totals). Three kinds of record, never counted twice:
 *   RESTAURANT  a restaurant / bar order's payment — recorded at the Restaurant Counter (the shared
 *               account; shown as "Restaurant Counter", with the waiter who brought the money when
 *               noted), by reception, or by a waiter in older records;
 *   ROOMS       a room / booking / invoice / company payment (who recorded it — reception);
 *   SALES       a sale recorded on its own (quick sale, transport) — a restaurant payment's own
 *               sales are that payment, so they are left out.
 * An order paid 60,000 by one person and 40,000 by another shows 60,000 and 40,000. A reversed
 * payment stays on the record with who reversed it and why, and is not counted; a refund is shown
 * apart. Orders put on a guest's room bill are shown apart ("room charges handled") — no money was
 * received for them. A shift's collections are the person's records inside the shift's time.
 * Operational figures — not the ledger.
 */

/** How the money came in, the way staff say it: cash, mobile money, bank, card. */
export const KIND_GROUP: Record<MoneyAccountKind, string> = { CASH: "Cash", PETTY_CASH: "Cash", MOBILE_MONEY: "Mobile money", BANK: "Bank", CARD: "Card", OTHER: "Other" };

export type MoneySource = "RESTAURANT" | "ROOMS" | "SALES";
export const SOURCE_LABEL: Record<MoneySource, string> = { RESTAURANT: "Restaurant & bar", ROOMS: "Rooms & bookings", SALES: "Other sales" };
export const ALL_SOURCES: MoneySource[] = ["ROOMS", "RESTAURANT", "SALES"];

export type CollectionStatus = "COLLECTED" | "TO_CONFIRM" | "REVERSED";
/** A time window [start, end) — a shift — instead of whole hotel days. */
export type Window = { start: Date; end: Date };
export type CollectionFilter = {
  from: BusinessDate; to: BusinessDate;
  window?: Window | null;
  /** One person's collections (a waiter or receptionist always gets only their own); null = everyone. */
  collectorId?: string | null;
  accountId?: string | null; methodId?: string | null; status?: CollectionStatus | null;
  /** Which records (default: the restaurant's only). */
  sources?: MoneySource[];
  /** A customer, an order or booking number, a table, a room or a payment reference. */
  q?: string | null;
  /**
   * Restaurant only: the payments of orders served by one waiter (the order's responsible waiter,
   * RestaurantOrder.assignedTo) — or NO_WAITER for orders nobody served. Room and other-sales
   * records have no waiter, so they are left out when this is set.
   */
  servedById?: string | null;
  page?: number;
};
const PAGE = 100;
/** The `servedById` value for orders with no waiter. */
export const NO_WAITER = "none";
const servedWhere = (servedById: string | null | undefined) => (servedById ? { assignedToId: servedById === NO_WAITER ? null : servedById } : null);

async function range(from: BusinessDate, to: BusinessDate, window?: Window | null) {
  const settings = await getSettings();
  return { ...(window ?? businessRangeBounds(from, to, businessDayConfig(settings))), settings };
}
const clean = (n: string | null | undefined) => n?.replace(/\s*\(.*\)/, "") ?? null;
const firstName = (n: string | null | undefined) => clean(n)?.trim().split(/\s+/)[0] ?? null;
/** How a payment recorded through the shared Restaurant Counter account is named — the Counter, never a person. */
const COUNTER = "Restaurant Counter";
/** "ORD-2026-000019" → "#19". */
export const shortOrderNo = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;

export type PlaceKind = "TABLE" | "COUNTER" | "ROOM" | "TAKEAWAY" | "PICKUP" | "RESTAURANT";
/**
 * Where a restaurant order was served, said plainly: "Table 4 — Inside", "Room 305", "Counter — Outside",
 * "Take away · Mikocheni, near the mosque", "Pickup", "Restaurant".
 */
export function orderPlace(o: {
  type: string; roomNumber: string | null; tableLabel: string | null; deliveryAddress?: string | null;
  location?: { name: string; kind: string } | null;
}): { place: string; placeKind: PlaceKind } {
  if (o.type === "ROOM_SERVICE") return { place: o.roomNumber ? `Room ${o.roomNumber}` : "Room service", placeKind: "ROOM" };
  if (o.type === "TAKEAWAY") return { place: o.deliveryAddress?.trim() ? `Take away · ${o.deliveryAddress.trim()}` : "Take away", placeKind: "TAKEAWAY" };
  if (o.type === "PICKUP") return { place: "Pickup", placeKind: "PICKUP" };
  if (o.location) return { place: o.location.name, placeKind: o.location.kind === "TABLE" ? "TABLE" : o.location.kind === "COUNTER" ? "COUNTER" : "RESTAURANT" };
  const label = o.tableLabel?.trim();
  if (label) return { place: /^\d+$/.test(label) ? `Table ${label}` : label, placeKind: /^counter/i.test(label) ? "COUNTER" : "TABLE" };
  if (o.roomNumber) return { place: `Room ${o.roomNumber}`, placeKind: "ROOM" };
  return { place: "Restaurant", placeKind: "RESTAURANT" };
}

// ───────────────────────── Totals ─────────────────────────

/**
 * The totals for a period or a shift's window — for one person, or per person (collectorIds):
 * collected (by how it came in, by account, by source), refunds, waiting for reception's
 * confirmation, reversed, and the room charges they handled (their orders' lines put on room bills).
 */
export async function collectionTotals(from: BusinessDate, to: BusinessDate, opts: {
  collectorIds?: string[] | null; accountId?: string | null; methodId?: string | null; sources?: MoneySource[]; window?: Window | null;
  /** Restaurant only: orders served by one waiter (or NO_WAITER) — room and other sales are then left out. */
  servedById?: string | null;
} = {}) {
  const { start, end } = await range(from, to, opts.window);
  const served = servedWhere(opts.servedById);
  const sources = new Set(served ? ["RESTAURANT"] : opts.sources ?? ["RESTAURANT"]);
  const who = opts.collectorIds?.length ? { in: opts.collectorIds } : undefined;
  const narrow = { ...(opts.accountId && { accountId: opts.accountId }) };
  const [restaurant, toConfirm, rooms, credited, sales, accounts, charges] = await Promise.all([
    sources.has("RESTAURANT") ? db.restaurantOrderPayment.groupBy({
      by: ["collectedById", "accountId", "status"], _sum: { amount: true }, _count: true,
      where: { collectedAt: { gte: start, lt: end }, ...(who && { collectedById: who }), ...narrow, ...(opts.methodId && { paymentMethodId: opts.methodId }), ...(served && { order: served }) },
    }) : [],
    sources.has("RESTAURANT") ? db.restaurantOrderPayment.groupBy({
      by: ["collectedById"], _sum: { amount: true }, _count: true,
      where: { collectedAt: { gte: start, lt: end }, status: "POSTED", confirmedAt: null, ...(who && { collectedById: who }), ...narrow, ...(opts.methodId && { paymentMethodId: opts.methodId }), ...(served && { order: served }) },
    }) : [],
    sources.has("ROOMS") ? db.payment.groupBy({
      by: ["recordedById", "accountId", "kind", "status"], _sum: { amount: true }, _count: true,
      where: { creditedToId: null, createdAt: { gte: start, lt: end }, ...(who && { recordedById: who }), ...narrow, ...(opts.methodId && { methodId: opts.methodId }) },
    }) : [],
    // Paid online before arriving: counted for the receptionist who checked the guest in, when they did (see checkInTx).
    sources.has("ROOMS") ? db.payment.groupBy({
      by: ["creditedToId", "accountId", "kind", "status"], _sum: { amount: true }, _count: true,
      where: { creditedToId: who ?? { not: null }, creditedAt: { gte: start, lt: end }, ...narrow, ...(opts.methodId && { methodId: opts.methodId }) },
    }) : [],
    sources.has("SALES") ? db.revenueTransaction.groupBy({
      by: ["recordedById", "accountId", "isVoided"], _sum: { amount: true }, _count: true,
      where: { orderPaymentId: null, createdAt: { gte: start, lt: end }, ...(who && { recordedById: who }), ...narrow, ...(opts.methodId && { paymentMethodId: opts.methodId }) },
    }) : [],
    db.moneyAccount.findMany({ select: { id: true, name: true, kind: true } }),
    // Room charges only for the restaurant, and not when narrowed to one account or method (a room bill has neither).
    !sources.has("RESTAURANT") || opts.accountId || opts.methodId ? Promise.resolve([]) : db.reservationCharge.groupBy({
      by: ["createdById", "restaurantOrderId"], where: { restaurantOrderId: { not: null }, isVoided: false, createdAt: { gte: start, lt: end }, ...(who && { createdById: who }), ...(served && { restaurantOrder: served }) }, _sum: { amount: true },
    }),
  ]);
  const acct = new Map(accounts.map((a) => [a.id, a]));
  function empty() {
    return {
      collected: 0, payments: 0, refunds: 0, refundCount: 0, toConfirm: 0, toConfirmCount: 0, reversed: 0, reversedCount: 0, roomCharges: 0, roomOrders: 0,
      byKind: new Map<string, number>(), byAccount: new Map<string, number>(), bySource: new Map<MoneySource, number>(),
    };
  }
  const people = new Map<string, ReturnType<typeof empty>>();
  const all = empty();
  const rows = (id: string | null) => {
    const k = id ?? "—";
    if (!people.has(k)) people.set(k, empty());
    return [people.get(k)!, all];
  };
  const collect = (id: string | null, accountId: string, amount: number, count: number, source: MoneySource) => {
    for (const r of rows(id)) {
      r.collected += amount; r.payments += count;
      const a = acct.get(accountId);
      const kind = a ? KIND_GROUP[a.kind] : "Other";
      r.byKind.set(kind, (r.byKind.get(kind) ?? 0) + amount);
      r.byAccount.set(a?.name ?? "Other", (r.byAccount.get(a?.name ?? "Other") ?? 0) + amount);
      r.bySource.set(source, (r.bySource.get(source) ?? 0) + amount);
    }
  };
  const reverse = (id: string | null, amount: number, count: number) => { for (const r of rows(id)) { r.reversed += amount; r.reversedCount += count; } };
  for (const g of restaurant) {
    if (g.status === "REVERSED") reverse(g.collectedById, g._sum.amount ?? 0, g._count);
    else collect(g.collectedById, g.accountId, g._sum.amount ?? 0, g._count, "RESTAURANT");
  }
  for (const g of toConfirm) for (const r of rows(g.collectedById)) { r.toConfirm += g._sum.amount ?? 0; r.toConfirmCount += g._count; }
  for (const g of [...rooms.map((x) => ({ ...x, by: x.recordedById })), ...credited.map((x) => ({ ...x, by: x.creditedToId }))]) {
    if (g.status === "REVERSED") reverse(g.by, g._sum.amount ?? 0, g._count);
    else if (g.kind === "REFUND") for (const r of rows(g.by)) { r.refunds += g._sum.amount ?? 0; r.refundCount += g._count; }
    else collect(g.by, g.accountId, g._sum.amount ?? 0, g._count, "ROOMS");
  }
  for (const g of sales) {
    if (g.isVoided) reverse(g.recordedById, g._sum.amount ?? 0, g._count);
    else collect(g.recordedById, g.accountId, g._sum.amount ?? 0, g._count, "SALES");
  }
  for (const g of charges) for (const r of rows(g.createdById)) { r.roomCharges += g._sum.amount ?? 0; r.roomOrders += 1; }
  const plain = (r: ReturnType<typeof empty>) => ({
    ...r,
    /** What was collected less refunds given back. */
    net: r.collected - r.refunds,
    byKind: [...r.byKind.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    byAccount: [...r.byAccount.entries()].map(([name, amount]) => ({ name, amount })).sort((a, b) => b.amount - a.amount),
    bySource: [...r.bySource.entries()].map(([source, amount]) => ({ source, label: SOURCE_LABEL[source], amount })).sort((a, b) => b.amount - a.amount),
  });
  return { all: plain(all), of: (id: string) => plain(people.get(id) ?? empty()) };
}
export type CollectionTotals = ReturnType<Awaited<ReturnType<typeof collectionTotals>>["of"]>;

// ───────────────────────── The records ─────────────────────────

export type CollectionRow = {
  id: string; source: MoneySource; at: string; day: BusinessDate;
  amount: number; fee: number; refund: boolean; reference: string | null; account: string; how: string; method: string;
  status: CollectionStatus; collector: string; collectorId: string | null; role: string | null;
  /** Recorded through the Restaurant Counter (the shared account) — `collector` is then "Restaurant Counter", never a person. */
  atCounter: boolean;
  /** The waiter who brought the money to the Counter (a note — never the collector). */
  broughtBy: string | null;
  /** Paid online by the customer (LIPA) — recorded automatically as the order came in. */
  online: boolean;
  /** …and the money never reached the account ("Payment not received"): reversed — never a refund. */
  notReceived: boolean;
  confirmedBy: string | null; confirmedAt: string | null; reversedBy: string | null; reversedAt: string | null; reverseReason: string | null;
  /** Who paid and where: "John · Room 305", "Shabani · Table 1". */
  customer: string | null; place: string;
  /** What kind of place (restaurant: table, counter, room, take away, pickup) — null for rooms and other sales. */
  placeKind: PlaceKind | null;
  /** What it was for, and where to open it. */
  what: string; href: string | null;
  /** Restaurant: the order paid for — its id and short number ("#19"). */
  orderId: string | null; orderNo: string | null;
  /** Restaurant: the waiter who served the order (its responsible waiter) — first name and full name; null = no waiter. */
  servedBy: string | null; servedByFull: string | null;
  /** Who recorded the money: "Restaurant Counter" (at the Counter) or the person (reception…). Same as `collector`. */
  recordedBy: string;
  /** Confirmed (counted as paid) — false while it waits for confirmation, or when reversed. */
  confirmed: boolean;
  order: null | {
    id: string; number: string; type: string; status: string; total: number; paid: number; due: number; customer: string | null; phone: string | null; visit: string | null; place: string; room: string | null;
    items: { name: string; qty: number; total: number }[]; payments: { id: string; amount: number; reversed: boolean; by: string; at: string }[];
  };
  stay: null | { id: string; reference: string; rooms: string; guest: string; company: string | null; net: number; balance: number };
  /**
   * Hotel money the guest paid online themselves (nTZS). Before they arrive it waits ("not checked in yet"); at check-in
   * it counts for the receptionist who checked them in (`creditedTo`, at `creditedAt` — which is then this row's time).
   */
  paidOnline: null | { paidAt: string; creditedTo: string | null; creditedToId: string | null; creditedAt: string | null; waiting: boolean };
};

function restaurantWhere(f: CollectionFilter, start: Date, end: Date): Prisma.RestaurantOrderPaymentWhereInput {
  const q = f.q?.trim();
  const digits = q?.replace(/\D/g, "") ?? "";
  const served = servedWhere(f.servedById);
  return {
    collectedAt: { gte: start, lt: end },
    ...(f.collectorId && { collectedById: f.collectorId }),
    ...(f.accountId && { accountId: f.accountId }),
    ...(f.methodId && { paymentMethodId: f.methodId }),
    ...(served && { order: served }),
    // Paid = confirmed; to confirm = recorded, waiting for confirmation.
    ...(f.status === "REVERSED" ? { status: "REVERSED" } : f.status === "TO_CONFIRM" ? { status: "POSTED", confirmedAt: null } : f.status === "COLLECTED" ? { status: "POSTED", confirmedAt: { not: null } } : {}),
    ...(q && {
      OR: [
        { reference: { contains: q, mode: "insensitive" } },
        { order: { customerName: { contains: q, mode: "insensitive" } } },
        { order: { tableLabel: { contains: q, mode: "insensitive" } } },
        { order: { location: { name: { contains: q, mode: "insensitive" } } } },
        { order: { roomNumber: { contains: q } } },
        { order: { deliveryAddress: { contains: q, mode: "insensitive" } } },
        // The waiter who served the order, and the waiter who brought the money to the Counter.
        { order: { assignedTo: { fullName: { contains: q, mode: "insensitive" } } } },
        { handedOverBy: { fullName: { contains: q, mode: "insensitive" } } },
        ...(digits ? [{ order: { number: { endsWith: digits.padStart(6, "0").slice(-6) } } }, { order: { customerPhone: { contains: digits.slice(-9) } } }] : []),
      ],
    }),
  };
}

function roomsWhere(f: CollectionFilter, start: Date, end: Date): Prisma.PaymentWhereInput | null {
  if (f.status === "TO_CONFIRM") return null; // only restaurant payments wait for confirmation
  if (f.servedById) return null; // no waiter on a room payment
  const q = f.q?.trim();
  const digits = q?.replace(/\D/g, "") ?? "";
  const when = { gte: start, lt: end };
  return {
    // Who and when: what a person recorded in the window — and a guest's online payment counted for whoever checked
    // them in, at check-in (it is no longer the online system's then).
    AND: [f.collectorId
      ? { OR: [{ recordedById: f.collectorId, creditedToId: null, createdAt: when }, { creditedToId: f.collectorId, creditedAt: when }] }
      : { OR: [{ creditedToId: null, createdAt: when }, { creditedToId: { not: null }, creditedAt: when }] }],
    ...(f.accountId && { accountId: f.accountId }),
    ...(f.methodId && { methodId: f.methodId }),
    ...(f.status === "REVERSED" ? { status: "REVERSED" } : f.status === "COLLECTED" ? { status: "POSTED" } : {}),
    ...(q && {
      OR: [
        { reference: { contains: q, mode: "insensitive" } },
        { reservation: { reference: { contains: q, mode: "insensitive" } } },
        { reservation: { guest: { fullName: { contains: q, mode: "insensitive" } } } },
        { reservation: { companyName: { contains: q, mode: "insensitive" } } },
        { reservation: { rooms: { some: { room: { number: q } } } } },
        { invoice: { number: { contains: q, mode: "insensitive" } } },
        { corporateCustomer: { companyName: { contains: q, mode: "insensitive" } } },
        ...(digits.length >= 4 ? [{ reservation: { guest: { phone: { contains: digits.slice(-9) } } } }] : []),
      ],
    }),
  };
}

function salesWhere(f: CollectionFilter, start: Date, end: Date): Prisma.RevenueTransactionWhereInput | null {
  if (f.status === "TO_CONFIRM" || f.servedById) return null;
  const q = f.q?.trim();
  return {
    orderPaymentId: null, createdAt: { gte: start, lt: end },
    ...(f.collectorId && { recordedById: f.collectorId }),
    ...(f.accountId && { accountId: f.accountId }),
    ...(f.methodId && { paymentMethodId: f.methodId }),
    ...(f.status === "REVERSED" ? { isVoided: true } : f.status === "COLLECTED" ? { isVoided: false } : {}),
    ...(q && { OR: [{ description: { contains: q, mode: "insensitive" } }, { notes: { contains: q, mode: "insensitive" } }] }),
  };
}

/**
 * The records themselves, newest first, with everything each one relates to: the customer, the
 * table or room, the order and its items and its other payments, or the booking or invoice.
 */
export async function collectionRows(f: CollectionFilter): Promise<{ count: number; page: number; pages: number; rows: CollectionRow[] }> {
  const { start, end, settings } = await range(f.from, f.to, f.window);
  const sources = new Set(f.sources ?? ["RESTAURANT"]);
  const page = Math.max(1, f.page ?? 1);
  const take = page * PAGE; // newest `take` of each kind, merged by time, then this page's slice
  const rw = sources.has("RESTAURANT") ? restaurantWhere(f, start, end) : null;
  const pw = sources.has("ROOMS") ? roomsWhere(f, start, end) : null;
  const sw = sources.has("SALES") ? salesWhere(f, start, end) : null;
  const day = (d: Date) => businessDateOf(d, stayConfig(settings));

  const [restaurant, rCount, rooms, pCount, sales, sCount] = await Promise.all([
    rw ? db.restaurantOrderPayment.findMany({
      where: rw, orderBy: { collectedAt: "desc" }, take,
      select: {
        id: true, amount: true, fee: true, reference: true, status: true, collectedAt: true, collectedByRole: true, confirmedAt: true, reversedAt: true, reverseReason: true, atCounter: true, online: true, notReceived: true, confirmedByRole: true,
        account: { select: { name: true, kind: true } }, paymentMethod: { select: { name: true } },
        collectedBy: { select: { id: true, fullName: true } }, confirmedBy: { select: { fullName: true } }, reversedBy: { select: { fullName: true } }, handedOverBy: { select: { fullName: true } },
        order: {
          select: {
            id: true, number: true, type: true, status: true, total: true, paidAmount: true, settlement: true, customerName: true, customerPhone: true, tableLabel: true, roomNumber: true, deliveryAddress: true,
            location: { select: { name: true, kind: true } }, session: { select: { number: true } }, assignedTo: { select: { fullName: true } },
            items: { orderBy: { id: "asc" }, select: { name: true, quantity: true, lineTotal: true } },
            payments: { orderBy: { collectedAt: "asc" }, select: { id: true, amount: true, status: true, collectedAt: true, atCounter: true, collectedBy: { select: { fullName: true } } } },
          },
        },
      },
    }) : [],
    rw ? db.restaurantOrderPayment.count({ where: rw }) : 0,
    pw ? db.payment.findMany({
      where: pw, orderBy: { createdAt: "desc" }, take,
      select: {
        id: true, kind: true, status: true, amount: true, reference: true, createdAt: true, reversedAt: true, reversalReason: true,
        creditedAt: true, creditedTo: { select: { id: true, fullName: true, role: { select: { name: true } } } },
        account: { select: { name: true, kind: true } }, method: { select: { name: true } },
        recordedBy: { select: { id: true, fullName: true, role: { select: { name: true } } } }, reversedBy: { select: { fullName: true } },
        reservation: {
          select: {
            id: true, reference: true, status: true, companyName: true, netAmount: true, balanceAmount: true, guest: { select: { fullName: true } },
            rooms: { where: { status: { not: "CANCELLED" } }, select: { room: { select: { number: true } } } },
          },
        },
        invoice: { select: { id: true, number: true } }, corporateCustomer: { select: { companyName: true } },
      },
    }) : [],
    pw ? db.payment.count({ where: pw }) : 0,
    sw ? db.revenueTransaction.findMany({
      where: sw, orderBy: { createdAt: "desc" }, take,
      select: {
        id: true, amount: true, description: true, notes: true, isVoided: true, voidReason: true, voidedAt: true, createdAt: true, kind: true,
        account: { select: { name: true, kind: true } }, paymentMethod: { select: { name: true } },
        recordedBy: { select: { id: true, fullName: true, role: { select: { name: true } } } },
      },
    }) : [],
    sw ? db.revenueTransaction.count({ where: sw }) : 0,
  ]);

  const rows: CollectionRow[] = [
    ...restaurant.map((p): CollectionRow => {
      const { place, placeKind } = orderPlace(p.order);
      const collector = p.atCounter ? COUNTER : clean(p.collectedBy?.fullName) ?? "—";
      const status: CollectionStatus = p.status === "REVERSED" ? "REVERSED" : p.confirmedAt ? "COLLECTED" : "TO_CONFIRM";
      return {
        id: p.id, source: "RESTAURANT", at: p.collectedAt.toISOString(), day: day(p.collectedAt),
        amount: p.amount, fee: p.fee, refund: false, reference: p.reference, account: p.account.name, how: KIND_GROUP[p.account.kind], method: p.paymentMethod.name,
        status, confirmed: status === "COLLECTED",
        // Paid online and recorded automatically (not by hand from the proof): "Paid online · automatic".
        collector, recordedBy: p.online && !p.confirmedBy && p.confirmedByRole?.startsWith("Automatic") ? "Paid by phone" : collector, collectorId: p.collectedBy?.id ?? null, role: p.atCounter ? null : p.collectedByRole,
        atCounter: p.atCounter, broughtBy: clean(p.handedOverBy?.fullName), online: p.online, notReceived: p.notReceived,
        confirmedBy: clean(p.confirmedBy?.fullName), confirmedAt: p.confirmedAt?.toISOString() ?? null,
        reversedBy: clean(p.reversedBy?.fullName), reversedAt: p.reversedAt?.toISOString() ?? null, reverseReason: p.reverseReason,
        customer: p.order.customerName, place, placeKind, what: `Order ${shortOrderNo(p.order.number)}`, href: `/staff/restaurant/orders/${p.order.id}`,
        orderId: p.order.id, orderNo: shortOrderNo(p.order.number),
        servedBy: firstName(p.order.assignedTo?.fullName), servedByFull: clean(p.order.assignedTo?.fullName),
        order: {
          id: p.order.id, number: p.order.number, type: p.order.type, status: p.order.status, total: p.order.total, paid: p.order.paidAmount,
          due: p.order.settlement === "ROOM" || p.order.status === "CANCELLED" ? 0 : Math.max(0, p.order.total - p.order.paidAmount),
          customer: p.order.customerName, phone: p.order.customerPhone, visit: p.order.session?.number ?? null, place, room: p.order.roomNumber,
          items: p.order.items.map((i) => ({ name: i.name, qty: i.quantity, total: i.lineTotal })),
          payments: p.order.payments.map((x) => ({ id: x.id, amount: x.amount, reversed: x.status === "REVERSED", by: x.atCounter ? COUNTER : clean(x.collectedBy?.fullName) ?? "—", at: x.collectedAt.toISOString() })),
        },
        stay: null, paidOnline: null,
      };
    }),
    ...rooms.map((p): CollectionRow => {
      const r = p.reservation;
      const roomNos = r?.rooms.map((x) => x.room.number).join(", ") ?? "";
      const online = p.recordedBy.id === ONLINE_RECORDER_ID;
      const at = p.creditedAt ?? p.createdAt;
      const by = p.creditedTo ?? p.recordedBy;
      return {
        id: p.id, source: "ROOMS", at: at.toISOString(), day: day(at),
        amount: p.kind === "REFUND" ? -p.amount : p.amount, fee: 0, refund: p.kind === "REFUND", reference: p.reference, account: p.account.name, how: KIND_GROUP[p.account.kind], method: p.method.name,
        status: p.status === "REVERSED" ? "REVERSED" : "COLLECTED", confirmed: p.status !== "REVERSED",
        collector: clean(by.fullName) ?? "—", recordedBy: clean(by.fullName) ?? "—", collectorId: by.id, role: by.role.name, atCounter: false, broughtBy: null, online: false, notReceived: false,
        confirmedBy: null, confirmedAt: null, reversedBy: clean(p.reversedBy?.fullName), reversedAt: p.reversedAt?.toISOString() ?? null, reverseReason: p.reversalReason,
        paidOnline: online ? {
          paidAt: p.createdAt.toISOString(), creditedTo: clean(p.creditedTo?.fullName), creditedToId: p.creditedTo?.id ?? null, creditedAt: p.creditedAt?.toISOString() ?? null,
          waiting: !p.creditedAt && !!r && ["INQUIRY", "RESERVED", "CONFIRMED"].includes(r.status),
        } : null,
        customer: r ? (r.companyName ?? r.guest.fullName) : p.corporateCustomer?.companyName ?? null,
        place: roomNos ? `Room ${roomNos}` : p.invoice ? `Invoice ${p.invoice.number}` : "Front desk", placeKind: null,
        what: r ? `Booking ${r.reference}` : p.invoice ? `Invoice ${p.invoice.number}` : "Payment",
        href: r ? `/staff/reservations/${r.id}` : p.invoice ? `/staff/invoices/${p.invoice.id}` : null,
        orderId: null, orderNo: null, servedBy: null, servedByFull: null,
        order: null,
        stay: r ? { id: r.id, reference: r.reference, rooms: roomNos, guest: r.guest.fullName, company: r.companyName, net: r.netAmount, balance: r.balanceAmount } : null,
      };
    }),
    ...sales.map((s): CollectionRow => ({
      id: s.id, source: "SALES", at: s.createdAt.toISOString(), day: day(s.createdAt),
      amount: s.amount, fee: 0, refund: false, reference: null, account: s.account.name, how: KIND_GROUP[s.account.kind], method: s.paymentMethod.name,
      status: s.isVoided ? "REVERSED" : "COLLECTED", confirmed: !s.isVoided,
      collector: clean(s.recordedBy.fullName) ?? "—", recordedBy: clean(s.recordedBy.fullName) ?? "—", collectorId: s.recordedBy.id, role: s.recordedBy.role.name, atCounter: false, broughtBy: null, online: false, notReceived: false,
      confirmedBy: null, confirmedAt: null, reversedBy: null, reversedAt: s.voidedAt?.toISOString() ?? null, reverseReason: s.voidReason,
      customer: null, place: s.kind === "TRANSPORT" ? "Transport" : "Sale", placeKind: null, what: s.description ?? "Sale", href: null,
      orderId: null, orderNo: null, servedBy: null, servedByFull: null, order: null, stay: null, paidOnline: null,
    })),
  ].sort((a, b) => b.at.localeCompare(a.at)).slice((page - 1) * PAGE, page * PAGE);
  const count = rCount + pCount + sCount;
  return { count, page, pages: Math.max(1, Math.ceil(count / PAGE)), rows };
}

/**
 * How many records each view holds for the same filters (period, person, source, account, method,
 * search, waiter): paid (confirmed), to confirm, reversed — and all of them.
 */
export async function collectionCounts(f: CollectionFilter) {
  const { start, end } = await range(f.from, f.to, f.window);
  const sources = new Set(f.sources ?? ["RESTAURANT"]);
  const n = async (status: CollectionStatus) => {
    const g = { ...f, status };
    const rw = sources.has("RESTAURANT") ? restaurantWhere(g, start, end) : null;
    const pw = sources.has("ROOMS") ? roomsWhere(g, start, end) : null;
    const sw = sources.has("SALES") ? salesWhere(g, start, end) : null;
    const [r, p, s] = await Promise.all([
      rw ? db.restaurantOrderPayment.count({ where: rw }) : 0,
      pw ? db.payment.count({ where: pw }) : 0,
      sw ? db.revenueTransaction.count({ where: sw }) : 0,
    ]);
    return r + p + s;
  };
  const [paid, toConfirm, reversed] = await Promise.all([n("COLLECTED"), n("TO_CONFIRM"), n("REVERSED")]);
  return { all: paid + toConfirm + reversed, paid, toConfirm, reversed };
}

/** Paid online (LIPA) in the period — recorded automatically — and how many never reached the account. */
export async function onlineTotals(f: CollectionFilter) {
  const { start, end } = await range(f.from, f.to, f.window);
  const where = restaurantWhere({ ...f, status: null }, start, end);
  const [paid, notReceived] = await Promise.all([
    db.restaurantOrderPayment.aggregate({ where: { AND: [where, { online: true, status: "POSTED" }] }, _sum: { amount: true }, _count: true }),
    db.restaurantOrderPayment.aggregate({ where: { AND: [where, { notReceived: true }] }, _sum: { amount: true }, _count: true }),
  ]);
  return { count: paid._count, amount: paid._sum.amount ?? 0, notReceived: notReceived._count, notReceivedAmount: notReceived._sum.amount ?? 0 };
}

/** Where an open order stands, in the restaurant's words. */
const STEP: Record<string, string> = {
  PENDING: "New", ACCEPTED: "Preparing", PREPARING: "Preparing", READY: "Ready to serve", OUT_FOR_DELIVERY: "Serving",
  DELIVERED: "Served · to pay", COMPLETED: "Served · to pay", COLLECTED: "Served · to pay",
};

export type ToCollectRow = {
  id: string; number: string; orderNo: string; href: string; type: string;
  place: string; placeKind: PlaceKind; customer: string | null; phone: string | null;
  /** The waiter serving it (first name, full name, id) — null: no waiter. */
  servedBy: string | null; servedByFull: string | null; servedById: string | null;
  status: string; step: string;
  total: number; paid: number; due: number;
  createdAt: string; day: BusinessDate;
  /** How long it has been open, in minutes. */
  minutes: number;
  /** Paid online: the customer sent proof of payment — it is to confirm (from the proof), not to collect. */
  online: null | { account: string | null; accountId: string | null; reference: string | null; at: string | null; proofUrl: string };
};

/**
 * STILL TO COLLECT — every open restaurant order with money still due, any day: not on a guest's
 * room bill, not cancelled, not fully paid. Oldest first. Orders the customer paid online (a proof
 * was sent) are kept apart: they are to confirm, never to collect again. `byWaiter` = what each
 * waiter's orders still have to pay (to collect only), by name — facts, not a ranking.
 */
export async function stillToCollect(opts: { servedById?: string | null; q?: string | null; /** Reception: only the hotel's orders (guests staying now: this set). */ hotel?: Set<string> | null } = {}, now = new Date()) {
  const served = servedWhere(opts.servedById);
  const orders = await db.restaurantOrder.findMany({
    where: { status: { not: "CANCELLED" }, settlement: { not: "ROOM" }, paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] }, ...served },
    orderBy: { createdAt: "asc" },
    select: {
      id: true, number: true, type: true, status: true, total: true, paidAmount: true, customerName: true, customerPhone: true, tableLabel: true, roomNumber: true, deliveryAddress: true,
      businessDate: true, createdAt: true, paymentProofFileId: true, customerPayRef: true, customerPaidAt: true, customerPaidToId: true,
      location: { select: { name: true, kind: true } }, assignedTo: { select: { id: true, fullName: true } }, customerPaidTo: { select: { name: true } },
      payments: { where: { online: true }, select: { id: true }, take: 1 },
      reservationId: true, settlement: true, source: true, guestId: true,
    },
  });
  const all: ToCollectRow[] = orders.filter((o) => !opts.hotel || isHotelOrder(o, opts.hotel)).map((o): ToCollectRow => ({
    id: o.id, number: o.number, orderNo: shortOrderNo(o.number), href: `/staff/restaurant/orders/${o.id}`, type: o.type,
    ...orderPlace(o), customer: o.customerName, phone: o.customerPhone,
    servedBy: firstName(o.assignedTo?.fullName), servedByFull: clean(o.assignedTo?.fullName), servedById: o.assignedTo?.id ?? null,
    status: o.status, step: STEP[o.status] ?? o.status,
    total: o.total, paid: o.paidAmount, due: Math.max(0, o.total - o.paidAmount),
    createdAt: o.createdAt.toISOString(), day: o.businessDate.toISOString().slice(0, 10) as BusinessDate,
    minutes: Math.max(0, Math.floor((now.getTime() - o.createdAt.getTime()) / 60_000)),
    // The proof covers the order as first sent — once a payment is recorded, what is left (items added later) is to collect.
    // (Normally recorded automatically as the order comes in; once an online payment was recorded — even if a manager reversed it — the rest is to collect.)
    online: o.paymentProofFileId && o.paidAmount === 0 && !o.payments.length ? {
      account: o.customerPaidTo?.name ?? null, accountId: o.customerPaidToId, reference: o.customerPayRef, at: o.customerPaidAt?.toISOString() ?? null, proofUrl: `/api/files/${o.paymentProofFileId}`,
    } : null,
  })).filter((r) => r.due > 0);

  const sum = (rows: ToCollectRow[]) => ({ count: rows.length, amount: rows.reduce((t, r) => t + r.due, 0) });
  const toCollect = all.filter((r) => !r.online);
  const byWaiter = new Map<string, { id: string; name: string; orders: number; amount: number }>();
  for (const r of toCollect) {
    const k = r.servedById ?? NO_WAITER;
    const w = byWaiter.get(k) ?? { id: k, name: r.servedByFull ?? "No waiter", orders: 0, amount: 0 };
    w.orders += 1; w.amount += r.due;
    byWaiter.set(k, w);
  }

  // A search: order number, customer, phone, place, waiter, the customer's payment code.
  const q = opts.q?.trim().toLowerCase();
  const digits = q?.replace(/\D/g, "") ?? "";
  const rows = q ? all.filter((r) =>
    [r.customer, r.place, r.servedByFull, r.online?.reference].some((v) => v?.toLowerCase().includes(q))
    || (digits && (r.number.endsWith(digits.padStart(6, "0").slice(-6)) || (digits.length >= 4 && r.phone?.replace(/\D/g, "").includes(digits.slice(-9)))))) : all;

  return {
    rows,
    toCollect: sum(toCollect),
    online: sum(all.filter((r) => r.online)),
    byWaiter: [...byWaiter.values()].sort((a, b) => (a.id === NO_WAITER ? 1 : b.id === NO_WAITER ? -1 : a.name.localeCompare(b.name))),
  };
}
export type StillToCollect = Awaited<ReturnType<typeof stillToCollect>>;

/** Orders someone handled that are still to pay (not on a room bill) — what they may still have to collect. */
export async function outstandingFor(collectorId: string | null) {
  const mine = collectorId ? { OR: [{ createdById: collectorId }, { assignedToId: collectorId }, { takenById: collectorId }, { deliveredById: collectorId }] } : {};
  const orders = await db.restaurantOrder.findMany({
    where: { ...mine, status: { not: "CANCELLED" }, settlement: { not: "ROOM" }, paymentStatus: { in: ["UNPAID", "PARTIALLY_PAID"] } },
    select: { total: true, paidAmount: true },
  });
  return { orders: orders.length, amount: orders.reduce((t, o) => t + Math.max(0, o.total - o.paidAmount), 0) };
}

/** Who can be picked on the managers' collections page: the staff who take money, and anyone who collected in the period. */
export async function collectors(from: BusinessDate, to: BusinessDate, sources: MoneySource[] = ["RESTAURANT"]) {
  const { start, end } = await range(from, to);
  const codes = sources.includes("ROOMS") ? ["revenue.record", "payments.record"] : ["revenue.record"];
  const role = { select: { name: true, code: true } } as const;
  const [staff, restaurantWho, roomsWho] = await Promise.all([
    db.user.findMany({
      where: { isActive: true, role: { code: { notIn: ["MANAGER", "ADMIN", "OWNER"] }, permissions: { some: { permission: { code: { in: codes } } } } } },
      orderBy: { fullName: "asc" }, select: { id: true, fullName: true, role },
    }),
    db.restaurantOrderPayment.findMany({ where: { collectedAt: { gte: start, lt: end }, collectedById: { not: null } }, distinct: ["collectedById"], select: { collectedBy: { select: { id: true, fullName: true, role } } } }),
    sources.includes("ROOMS") ? db.payment.findMany({ where: { createdAt: { gte: start, lt: end } }, distinct: ["recordedById"], select: { recordedBy: { select: { id: true, fullName: true, role } } } }) : [],
  ]);
  // The shared Restaurant Counter account is "Restaurant Counter" — never the name of a person.
  const entry = (u: { id: string; fullName: string; role: { name: string; code: string } }) => u.role.code === "RESTAURANT_SCREEN"
    ? { id: u.id, name: COUNTER, role: "shared account" }
    : { id: u.id, name: u.fullName.replace(/\s*\(.*\)/, ""), role: u.role.name };
  const map = new Map(staff.map((u) => [u.id, entry(u)]));
  for (const u of [...restaurantWho.map((w) => w.collectedBy), ...roomsWho.map((w) => w.recordedBy)]) {
    if (u && !map.has(u.id)) map.set(u.id, entry(u));
  }
  return [...map.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/**
 * Hotel money guests paid online before arriving (nTZS): shown to reception as "Paid online · not checked in yet" —
 * nobody's collection until the guest is checked in; then it counts for the receptionist who checks them in.
 */
export async function paidOnlineAwaitingCheckIn() {
  const where = { recordedById: ONLINE_RECORDER_ID, creditedToId: null, status: "POSTED" as const, kind: "PAYMENT" as const, reservation: { status: { in: ["INQUIRY" as const, "RESERVED" as const, "CONFIRMED" as const] } } };
  const [ps, sum] = await Promise.all([
    db.payment.findMany({
      where, orderBy: { createdAt: "desc" }, take: 60,
      select: {
        id: true, amount: true, createdAt: true,
        reservation: {
          select: {
            id: true, reference: true, balanceAmount: true, guest: { select: { fullName: true } },
            rooms: { where: { status: { not: "CANCELLED" } }, orderBy: { arrivalDate: "asc" }, select: { arrivalDate: true, room: { select: { number: true } }, roomType: { select: { name: true } } } },
          },
        },
      },
    }),
    db.payment.aggregate({ where, _sum: { amount: true }, _count: true }),
  ]);
  return {
    amount: sum._sum.amount ?? 0, count: sum._count,
    rows: ps.filter((p) => p.reservation).map((p) => {
      const r = p.reservation!;
      return {
        id: p.id, amount: p.amount, paidAt: p.createdAt.toISOString(), reservationId: r.id, reference: r.reference, guest: r.guest.fullName,
        room: r.rooms.map((x) => `${x.roomType.name} · ${x.room.number}`).join(", "),
        arrival: r.rooms[0] ? r.rooms[0].arrivalDate.toISOString().slice(0, 10) : null, balance: Math.max(0, r.balanceAmount),
      };
    }),
  };
}

