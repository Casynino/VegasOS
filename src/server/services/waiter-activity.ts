import "server-only";
import { db } from "../db";
import { deliveryPlace, spotWord } from "@/lib/delivery-place";
import { CLOSED_STATUSES } from "./restaurant";
import { msg } from "@/i18n/msg";
import { textBook, word, type TextWord } from "@/lib/report-i18n";

/**
 * A WAITER'S OWN RECORD — built from what they actually did, never typed in: the orders connected to them
 * (created, routed or given to them, claimed, handed over, served), their tables and rooms, how each one is
 * paid (as the Counter recorded it — the waiter never records payments), and one history in time order.
 * Nothing here is a new record: it reads the orders, their steps (restaurant_order_events.byId), the
 * assignment history (waiter_assignments) and the shifts. Facts only — never a score, never accounting.
 */

export type OrderSourceKind = "TABLE" | "ROOM" | "ONLINE" | "RESTAURANT";
export const SOURCE_KIND_LABEL: Record<OrderSourceKind, string> = { TABLE: msg("Table"), ROOM: msg("Room"), ONLINE: msg("Online"), RESTAURANT: msg("Restaurant") };

/** Where an order came from, in the waiter's words: a table, a room, online (the website / public menu), or the restaurant itself (counter, take away, main). */
const sourceKind = (o: { type: string; source: string; location: { kind: string } | null }): OrderSourceKind =>
  o.type === "ROOM_SERVICE" ? "ROOM" : o.location?.kind === "TABLE" ? "TABLE" : o.source === "WEBSITE" || o.source === "PUBLIC_QR" ? "ONLINE" : "RESTAURANT";

const shortNo = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;
const first = (n: string | null | undefined) => n?.replace(/\s*\(.*\)/, "").trim().split(/\s+/)[0] ?? "";

/**
 * Where an order is taken, as a word to say in the reader's language — word for word what deliveryPlace() writes
 * in English ("Room 12", "Table 4", "Counter"…).
 */
const placeWord = (o: { type: string; roomNumber: string | null; tableLabel: string | null; deliveryAddress?: string | null }): TextWord => {
  if (o.type === "ROOM_SERVICE") return o.roomNumber ? word(msg("Room {room}"), { room: o.roomNumber }) : word(msg("Room"));
  if (o.type === "DINE_IN") return o.tableLabel ? (/^\d+$/.test(o.tableLabel.trim()) ? word(msg("Table {table}"), { table: o.tableLabel.trim() }) : spotWord(o.tableLabel)) : word(msg("Restaurant"));
  if (o.type === "TAKEAWAY" && o.deliveryAddress) return word(msg("Take out — {address}"), { address: o.deliveryAddress });
  return word(msg("Counter"));
};
/** A bill printed, downloaded or shared — the order's own note (restaurant.ts logBillPrinted), said in the reader's language. */
const BILL_NOTE = new Set<string>([
  msg("Bill printed"), msg("Bill downloaded (PDF)"), msg("Bill downloaded (image)"), msg("Bill shared"),
  msg("Table bill printed"), msg("Table bill downloaded (PDF)"), msg("Table bill downloaded (image)"), msg("Table bill shared"),
  msg("Room bill printed"), msg("Room bill downloaded (PDF)"), msg("Room bill downloaded (image)"), msg("Room bill shared"),
]);

/** How an order is paid, for the waiter's eyes only (the Counter's payment records say it). */
export type MoneyState = "PAID" | "PAID_ONLINE" | "ROOM_BILL" | "PARTLY_PAID" | "UNPAID" | "CANCELLED" | "NOT_RECEIVED";

/**
 * Everything connected to one waiter in a time window (their shift, or a day): the orders, the summary,
 * their collections and their history. `window.to` is "now" for an open shift.
 */
/** How far back one look goes (newest first): a long period shows its newest part, and says so. */
const LIMIT = 400;

export async function waiterActivity(waiterId: string, window: { from: Date; to: Date }, opts: { windowOnly?: boolean } = {}) {
  const within = { gte: window.from, lte: window.to };
  const [assignments, steps, nowMine, shifts] = await Promise.all([
    db.waiterAssignment.findMany({
      where: { at: within, OR: [{ toUserId: waiterId }, { fromUserId: waiterId }] }, orderBy: [{ at: "desc" }, { id: "desc" }], take: LIMIT,
      select: { scope: true, orderId: true, locationId: true, roomNumber: true, kind: true, via: true, fromUserId: true, toUserId: true, reason: true, at: true, byLabel: true, fromUser: { select: { fullName: true } }, toUser: { select: { fullName: true } } },
    }),
    db.restaurantOrderEvent.findMany({ where: { byId: waiterId, at: within }, orderBy: [{ at: "desc" }, { id: "desc" }], take: LIMIT, select: { orderId: true, from: true, to: true, note: true, at: true } }),
    // What is still with them now (left out for a closed shift's report: only what happened inside its time).
    opts.windowOnly ? Promise.resolve([]) : db.restaurantOrder.findMany({ where: { assignedToId: waiterId, status: { notIn: CLOSED_STATUSES } }, select: { id: true } }),
    db.actualShift.findMany({ where: { userId: waiterId, department: "RESTAURANT", OR: [{ startedAt: within }, { endedAt: within }] }, orderBy: { startedAt: "asc" }, select: { id: true, startedAt: true, endedAt: true, closedById: true, closeReason: true } }),
  ]);
  const ids = new Set<string>([
    ...assignments.map((a) => a.orderId).filter((x): x is string => !!x),
    ...steps.map((e) => e.orderId), ...nowMine.map((o) => o.id),
  ]);
  const [orders, places] = await Promise.all([
    ids.size ? db.restaurantOrder.findMany({
      where: { id: { in: [...ids] } }, orderBy: { createdAt: "desc" },
      select: {
        id: true, number: true, type: true, source: true, status: true, total: true, paidAmount: true, settlement: true, tableLabel: true, roomNumber: true, deliveryAddress: true,
        customerName: true, createdAt: true, createdById: true, assignedToId: true, deliveredById: true, deliveredAt: true, paymentProofFileId: true,
        location: { select: { name: true, kind: true } },
        payments: { select: { amount: true, status: true, online: true, notReceived: true, account: { select: { name: true, kind: true } }, paymentMethod: { select: { name: true } } } },
      },
    }) : Promise.resolve([]),
    db.restaurantLocation.findMany({ where: { id: { in: assignments.map((a) => a.locationId).filter((x): x is string => !!x) } }, select: { id: true, name: true } }),
  ]);
  const placeName = new Map(places.map((p) => [p.id, p.name]));
  const byId = new Map(orders.map((o) => [o.id, o]));

  /** Taking an order by doing its step (Accept, Serve…) writes the step and the take at the same moment — the step says it. */
  const stepAt = new Set(steps.filter((e) => e.from !== e.to).map((e) => `${e.orderId}|${e.at.getTime()}`));
  const takenByStep = (a: { scope: string; kind: string; orderId: string | null; at: Date }) => a.scope === "ORDER" && a.kind === "TAKEN" && !!a.orderId && stepAt.has(`${a.orderId}|${a.at.getTime()}`);
  const acceptedNew = new Set(steps.filter((e) => e.from === "PENDING" && (e.to === "ACCEPTED" || e.to === "PREPARING")).map((e) => e.orderId));
  /** The row written when they made the order themselves (same moment as the order) — "Created" says it. */
  const createdTaken = (a: { kind: string; toUserId: string | null; at: Date }, o: { createdById: string | null; createdAt: Date } | undefined) =>
    !!o && a.kind === "TAKEN" && a.toUserId === waiterId && o.createdById === waiterId && a.at.getTime() === o.createdAt.getTime();

  // ─── Each order, as the waiter reads it ───
  const rows = orders.map((o) => {
    const kind = sourceKind(o);
    const posted = o.payments.filter((p) => p.status === "POSTED");
    const online = posted.filter((p) => p.online).reduce((t, p) => t + p.amount, 0);
    const due = o.settlement === "ROOM" || o.status === "CANCELLED" ? 0 : Math.max(0, o.total - o.paidAmount);
    const money: MoneyState = o.payments.some((p) => p.notReceived) ? "NOT_RECEIVED"
      : o.status === "CANCELLED" ? "CANCELLED"
      : o.settlement === "ROOM" ? "ROOM_BILL"
      : online > 0 && due === 0 && online >= o.total ? "PAID_ONLINE"
      : due === 0 && posted.length ? "PAID"
      : posted.length ? "PARTLY_PAID" : "UNPAID";
    const how = new Set<string>();
    // How it came to them — English values (compared below); the screen shows them with t().
    if (o.createdById === waiterId) how.add(msg("Created"));
    // Their own new order is theirs from the start ("Created") — not a claim (on their phone or picked at the Counter).
    for (const a of assignments.filter((x) => x.orderId === o.id && !createdTaken(x, o))) {
      // Taken for them at the Counter (picked from the list) is an assignment; on their own phone, a claim.
      if (a.toUserId === waiterId) how.add(a.kind === "TAKEN" ? (a.via === "PIN" ? msg("Assigned") : takenByStep(a) && acceptedNew.has(o.id) ? msg("Accepted") : msg("Claimed")) : a.kind === "TRANSFER" ? msg("Handed to you") : msg("Assigned"));
      if (a.fromUserId === waiterId && a.kind === "TRANSFER") how.add(msg("Handed over"));
    }
    if (o.deliveredById === waiterId) how.add(msg("Served"));
    return {
      id: o.id, number: o.number, no: shortNo(o.number), kind, kindLabel: SOURCE_KIND_LABEL[kind], place: deliveryPlace(o), customer: o.customerName,
      status: o.status, total: o.total, due, createdAt: o.createdAt.toISOString(),
      mine: o.assignedToId === waiterId, open: !CLOSED_STATUSES.includes(o.status),
      money, online,
      /** Paid at the Counter, as recorded there: cash, mobile money… (and into which account). */
      paidCounter: posted.filter((p) => !p.online).reduce((t, p) => t + p.amount, 0),
      cashPaid: posted.filter((p) => !p.online && p.account.kind === "CASH").reduce((t, p) => t + p.amount, 0),
      paidBy: [...new Set(posted.map((p) => (p.online ? msg("Paid online") : p.paymentMethod.name)))].join(" + ") || null,
      how: [...how],
    };
  });
  const live = rows.filter((r) => r.status !== "CANCELLED");

  // ─── The summary ───
  const sum = (xs: typeof rows, f: (r: (typeof rows)[number]) => number) => xs.reduce((t, r) => t + f(r), 0);
  const tables = new Set(live.filter((r) => r.kind === "TABLE").map((r) => r.place));
  const summary = {
    orders: live.length,
    tables: tables.size, tableNames: [...tables],
    rooms: live.filter((r) => r.kind === "ROOM").length,
    online: live.filter((r) => r.kind === "ONLINE").length,
    created: live.filter((r) => r.how.includes("Created")).length,
    assigned: live.filter((r) => r.how.includes("Assigned") || r.how.includes("Handed to you")).length,
    claimed: live.filter((r) => r.how.includes("Claimed")).length,
    served: live.filter((r) => r.how.includes("Served")).length,
    completed: live.filter((r) => r.status === "COMPLETED" || r.status === "COLLECTED").length,
    pending: live.filter((r) => r.mine && r.open).length,
    value: sum(live, (r) => r.total),
    /** As the Counter recorded it for these orders — information for the waiter, not their money. */
    paidCounter: sum(live, (r) => r.paidCounter),
    cashPaid: sum(live, (r) => r.cashPaid),
    onRooms: sum(live.filter((r) => r.money === "ROOM_BILL"), (r) => r.total),
    paidOnline: sum(live, (r) => r.online),
    unpaid: sum(live.filter((r) => r.open), (r) => r.due),
  };

  // ─── The history, in time order ───
  // Each line is kept twice: `text`, the English (what the screens and the shift report read and match), and `say`,
  // its key and values (src/lib/report-i18n.ts) — to write the same line in the reader's language.
  type Item = { at: string; kind: "shift" | "order" | "assign" | "table" | "bill"; text: string; say: TextWord; orderId?: string | null; tone?: "good" | "warn" | "bad"; seq?: number };
  const items: Item[] = [];
  const { L } = textBook();
  const line = (say: TextWord) => ({ text: L(say.k, say.v), say });
  // Several things written at one moment keep the order they happened in (shift start first, end last).
  let n = 0;
  const push = (x: Omit<Item, "text" | "say"> & { say: TextWord }, rank = 0) => items.push({ ...x, ...line(x.say), seq: rank * 1_000_000 + n++ });
  const orderTag = (id: string | null | undefined): TextWord => { const o = id ? byId.get(id) : null; return o ? word(msg("{no} · {place}"), { no: shortNo(o.number), place: placeWord(o) }) : word(msg("an order")); };
  /** "… — the reason they gave" (as it was written). */
  const because = (w: TextWord, reason: string | null | undefined) => (reason ? word(msg("{text} — {reason}"), { text: w, reason }) : w);
  for (const s of shifts) {
    if (s.startedAt >= window.from) push({ at: s.startedAt.toISOString(), kind: "shift", say: word(msg("Started the shift")) }, -1);
    if (s.endedAt && s.endedAt <= window.to) push({ at: s.endedAt.toISOString(), kind: "shift", say: s.closedById && s.closedById !== waiterId ? because(word(msg("Shift closed by a manager")), s.closeReason) : word(msg("Ended the shift")) }, 1);
  }
  for (const a of [...assignments].reverse()) {
    // The order they made themselves is theirs from the start — "Created" says it.
    if (a.scope === "ORDER" && a.orderId && createdTaken(a, byId.get(a.orderId))) continue;
    // Taken by accepting / serving it: that step's own line says it ("Accepted #12").
    if (a.toUserId === waiterId && a.via !== "PIN" && takenByStep(a)) continue;
    const table = a.locationId ? placeName.get(a.locationId) : null;
    const what: TextWord = a.scope === "ORDER" ? orderTag(a.orderId) : a.scope === "TABLE" ? (table ? spotWord(table) : word(msg("a table"))) : a.roomNumber ? word(msg("Room {room}"), { room: a.roomNumber }) : word(msg("Room"));
    const kind = a.scope === "ORDER" ? "assign" : "table";
    // A hand-over a manager made (or a shift a manager closed) is the manager's doing, not the waiter's.
    const byManager = a.via === "MANAGER" || a.via === "SHIFT_CLOSE";
    const manager = first(a.byLabel) || word(msg("a manager"));
    const colleague = (name: string | null | undefined) => first(name) || word(msg("a colleague"));
    if (a.toUserId === waiterId) {
      const say = a.kind === "TAKEN" ? (a.via === "PIN" ? word(msg("{what} assigned to you at the Counter"), { what }) : word(msg("Claimed {what}"), { what }))
        : a.kind === "TRANSFER" ? because(byManager ? word(msg("{what} given to you by {manager} (from {from})"), { what, manager, from: colleague(a.fromUser?.fullName) }) : word(msg("{what} handed to you by {from}"), { what, from: colleague(a.fromUser?.fullName) }), a.reason)
        : a.kind === "MANAGER" ? because(word(msg("{what} given to you by {manager}"), { what, manager }), a.reason)
        : a.via === "TABLE" ? word(msg("{what} came to you (your table)"), { what }) : a.via === "ROOM" ? word(msg("{what} came to you (your room)"), { what }) : word(msg("{what} assigned to you"), { what });
      push({ at: a.at.toISOString(), kind, say, orderId: a.orderId });
    } else if (a.fromUserId === waiterId) {
      const say = !a.toUserId ? because(a.kind === "RELEASED" ? word(msg("{what} released"), { what }) : word(msg("{what} taken off you by {manager}"), { what, manager }), a.reason)
        : a.kind === "TRANSFER" && !byManager ? because(word(msg("Handed {what} to {to}"), { what, to: colleague(a.toUser?.fullName) }), a.reason)
        : because(byManager || a.kind === "MANAGER" ? word(msg("{what} moved to {to} by {manager}"), { what, to: colleague(a.toUser?.fullName), manager }) : word(msg("{what} moved to {to}"), { what, to: colleague(a.toUser?.fullName) }), a.reason);
      push({ at: a.at.toISOString(), kind, say, orderId: a.orderId });
    }
  }
  /** Each step on an order, as its line ("Served #12 · Table 4"). */
  const STEP: Record<string, string> = {
    PENDING: msg("Created {order}"), ACCEPTED: msg("Accepted {order}"), PREPARING: msg("Started preparing {order}"), READY: msg("Marked ready {order}"),
    OUT_FOR_DELIVERY: msg("Serving {order}"), DELIVERED: msg("Served {order}"), COMPLETED: msg("Completed {order}"), CANCELLED: msg("Cancelled {order}"),
  };
  for (const e of [...steps].reverse()) {
    // Notes: only the bills they printed or downloaded (payments are the Counter's).
    if (e.from === e.to) {
      if (e.note && /^(Bill|Table bill|Room bill) (printed|downloaded|shared)/.test(e.note)) {
        const head = e.note.split(" · ")[0];
        push({ at: e.at.toISOString(), kind: "bill", say: word(msg("{note} · {order}"), { note: BILL_NOTE.has(head) ? word(head) : head, order: orderTag(e.orderId) }), orderId: e.orderId });
      }
      continue;
    }
    // Accepting a new order (it starts at once): "Accepted", not "Started preparing".
    const order = orderTag(e.orderId);
    const say = e.from === "PENDING" && (e.to === "ACCEPTED" || e.to === "PREPARING") ? word(msg("Accepted {order}"), { order })
      : STEP[e.to] ? word(STEP[e.to], { order }) : word(msg("{step} {order}"), { step: e.to, order });
    push({ at: e.at.toISOString(), kind: "order", say, orderId: e.orderId, tone: e.to === "CANCELLED" ? "bad" : e.to === "DELIVERED" ? "good" : undefined });
  }
  items.sort((a, b) => b.at.localeCompare(a.at) || (b.seq ?? 0) - (a.seq ?? 0));

  const HISTORY = 300;
  return {
    orders: rows, summary,
    /** `text` is the English line; `say` writes it in the reader's language (reportTr / textBook in src/lib/report-i18n.ts). */
    history: items.slice(0, HISTORY).map((x) => ({ at: x.at, kind: x.kind, text: x.text, say: x.say, orderId: x.orderId, tone: x.tone })),
    /** Only the newest part is shown (a long period): pick a shorter one for the rest. */
    more: items.length > HISTORY || assignments.length >= LIMIT || steps.length >= LIMIT,
  };
}
export type WaiterActivity = Awaited<ReturnType<typeof waiterActivity>>;
export type WaiterOrderRow = WaiterActivity["orders"][number];
export type WaiterHistoryItem = WaiterActivity["history"][number];
