import "server-only";
import { db } from "../db";
import { businessDayBounds, localMinutesOfDay, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { businessDayConfig, getSettings } from "../settings";
import { formatQty } from "@/lib/inventory";
import { formatDateTime } from "@/lib/format";
import { inventoryAlerts } from "./inventory";

/**
 * The manager's and the MD's command centre — one place to see the hotel's condition:
 *  - decisions: what is late or wrong right now, with how long it has been, each linked to where
 *    it is dealt with (room cleaning 42 min, order ready 24 min not delivered, a table waiting to
 *    pay, a guest arriving to a room that is not ready, stock out, waste to approve, a reception
 *    shift left open over 14 h…);
 *  - the live board: front desk, housekeeping, restaurant stages, tables, payments, maintenance, stores;
 *  - staff activity today by department (what was done — never scores).
 */

export type Area = "Guests" | "Rooms" | "Restaurant" | "Tables" | "Payments" | "Stores" | "Maintenance" | "Staff" | "Bookings";
export type Tone = "rose" | "amber" | "sky" | "gold" | "slate";
export type Decision = { id: string; area: Area; tone: Tone; title: string; detail: string; minutes: number | null; href: string; act: string };

const mins = (from: Date | null | undefined, now: Date) => (from ? Math.max(0, Math.round((now.getTime() - from.getTime()) / 60000)) : 0);
export const ago = (m: number) => (m < 60 ? `${m} min` : m < 1440 ? `${Math.floor(m / 60)} h ${m % 60 ? `${m % 60} min` : ""}`.trim() : `${Math.floor(m / 1440)} d`);
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;
const REQUEST_WORD: Record<string, string> = { TOWELS: "Towels", CLEANING: "Cleaning", MAINTENANCE: "Repair", RESTAURANT: "Food", TRANSPORT: "Transport", GENERAL: "Help", OTHER: "Request" };

/** How long an order may sit in each stage before it is "late". */
export const ORDER_LIMITS: Record<string, { label: string; limit: number }> = {
  PENDING: { label: "waiting to be accepted", limit: 5 },
  ACCEPTED: { label: "accepted, not started", limit: 10 },
  PREPARING: { label: "preparing", limit: 25 },
  READY: { label: "ready, not served yet", limit: 10 },
  OUT_FOR_DELIVERY: { label: "being served", limit: 15 },
};
/** Housekeeping: a dirty room should be started, a room being cleaned finished. */
const CLEAN_LIMIT = { DIRTY: 45, CLEANING: 40 };
/** A reception shift open longer than this was most likely never closed (the person left). */
const SHIFT_LIMIT = 14 * 60;

export interface CommandInput {
  today: BusinessDate;
  now: Date;
  /** From the home's tables (to avoid loading them twice): tables asking for the bill, with minutes. */
  tablesWaiting: { id: string; name: string; minutes: number; due: number }[];
  tables: { seated: number; bill: number; free: number; total: number };
  shiftOpen: string | null;
  expensesPending: { count: number; amount: number };
  reportFailedId: string | null;
  /** Anything else the home already knows about (e.g. guests who left without paying). */
  extra?: Decision[];
}

export async function commandCenter(input: CommandInput) {
  const { today, now } = input;
  const day = toDbDate(today);
  const [rooms, arrivals, inHouse, orders, toConfirm, requests, stores, assetsDown, activity, openShifts] = await Promise.all([
    db.room.findMany({ where: { isActive: true, roomType: { category: "GUEST_ROOM" } }, select: { id: true, number: true, status: true, statusNote: true, statusChangedAt: true } }),
    db.reservationRoom.findMany({
      where: { arrivalDate: day, status: { in: ["RESERVED", "CONFIRMED"] }, reservation: { kind: "STAY" } },
      select: { id: true, status: true, room: { select: { number: true, status: true } }, reservation: { select: { id: true, eta: true, guest: { select: { fullName: true } } } } },
    }),
    db.reservationRoom.findMany({
      where: { status: "CHECKED_IN", reservation: { kind: "STAY" } },
      select: { id: true, endAt: true, departureDate: true, room: { select: { number: true } }, reservation: { select: { id: true, balanceAmount: true, guest: { select: { fullName: true } } } } },
    }),
    db.restaurantOrder.findMany({
      where: { status: { in: ["PENDING", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"] } },
      select: { id: true, number: true, status: true, type: true, tableLabel: true, roomNumber: true, customerName: true, createdAt: true, acceptedAt: true, preparingAt: true, readyAt: true, takenAt: true, total: true },
    }),
    db.restaurantOrderPayment.findMany({ where: { status: "POSTED", confirmedAt: null }, orderBy: { collectedAt: "asc" }, select: { amount: true, collectedAt: true, collectedBy: { select: { fullName: true } } } }),
    db.bookingRequest.findMany({ where: { status: "NEW" }, orderBy: { createdAt: "asc" }, take: 20, select: { id: true, fullName: true, companyName: true, createdAt: true } }),
    inventoryAlerts(today),
    db.asset.findMany({ where: { status: { in: ["UNDER_REPAIR", "OUT_OF_ORDER"] } }, select: { id: true, code: true, name: true, location: true, status: true, updatedAt: true } }),
    staffActivity(today),
    // The reception shift open now: to link its person and to see one left open too long.
    db.actualShift.findMany({ where: { endedAt: null, department: "RECEPTION" }, orderBy: { startedAt: "asc" }, select: { id: true, startedAt: true, user: { select: { fullName: true } } } }),
  ]);
  // Guests waiting for help (towels, cleaning, a repair, transport…) that nobody has finished.
  const waitingHelp = await db.serviceRequest.findMany({
    where: { type: { not: "COMPLAINT" }, status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS"] }, createdAt: { lte: new Date(now.getTime() - 20 * 60_000) } },
    orderBy: { createdAt: "asc" }, take: 20,
    select: { id: true, type: true, description: true, status: true, createdAt: true, room: { select: { number: true } }, assignedTo: { select: { fullName: true } } },
  });
  const complaints = await db.serviceRequest.findMany({
    where: { type: "COMPLAINT", status: { notIn: ["COMPLETED", "CANCELLED"] } }, orderBy: { createdAt: "asc" }, take: 6,
    select: { id: true, description: true, priority: true, createdAt: true, room: { select: { number: true } }, order: { select: { number: true, tableLabel: true } }, guest: { select: { fullName: true } } },
  });
  // Stock requests: waiting for review, approved but not bought yet, bought and waiting for the final approval.
  const stock = await db.stockRequest.findMany({
    where: { status: { in: ["SUBMITTED", "APPROVED", "PENDING_APPROVAL"] } }, orderBy: { createdAt: "asc" },
    select: { id: true, number: true, status: true, urgent: true, department: true, createdAt: true, decidedAt: true, submittedAt: true, purchaseTotal: true, inventoryDepartment: { select: { name: true } } },
  });
  // Orders put on a room bill today whose stay is not the customer's — nor anyone's at their table.
  const roomBilled = await db.restaurantOrder.findMany({
    where: { settlement: "ROOM", status: { not: "CANCELLED" }, reservationId: { not: null }, OR: [{ businessDate: day }, { charges: { some: { businessDate: day, isVoided: false } } }] },
    orderBy: { createdAt: "desc" }, take: 100,
    select: {
      id: true, number: true, total: true, roomNumber: true, tableLabel: true, customerName: true, guestId: true,
      location: { select: { name: true } },
      reservation: { select: { guestId: true, guest: { select: { fullName: true } }, guests: { select: { guestId: true } } } },
      session: { select: { guestId: true, members: { select: { guestId: true } } } },
    },
  });
  // Who put each on its room, and why — the server marks a room that was not the customer's
  // (the order then takes the room's guest as its customer, so the names alone cannot tell).
  const billedBy = roomBilled.length ? await db.auditLog.findMany({
    where: { entityType: "RestaurantOrder", entityId: { in: roomBilled.map((o) => o.id) }, action: { in: ["restaurant_order.created", "restaurant_order.charged_to_room", "restaurant_order.billing_changed"] } },
    orderBy: { createdAt: "desc" }, select: { entityId: true, action: true, after: true, actorLabel: true, user: { select: { fullName: true } } },
  }) : [];
  const markedOther = (id: string) => {
    const last = billedBy.find((a) => a.entityId === id && a.action !== "restaurant_order.billing_changed");
    return !!(last?.after && typeof last.after === "object" && "roomOfAnotherGuest" in last.after && (last.after as Record<string, unknown>).roomOfAnotherGuest);
  };
  const otherRoom = roomBilled.filter((o) => {
    const people = [o.guestId, o.session?.guestId, ...(o.session?.members.map((m) => m.guestId) ?? [])].filter((x): x is string => !!x);
    const stay = new Set([o.reservation?.guestId, ...(o.reservation?.guests.map((g) => g.guestId) ?? [])]);
    return markedOther(o.id) || (people.length > 0 && !people.some((p) => stay.has(p)));
  });

  const d: Decision[] = [];
  const push = (x: Decision) => d.push(x);

  // ── Guests & front desk ──
  const overdue = inHouse.filter((r) => r.endAt <= now);
  for (const r of overdue.slice(0, 4)) {
    push({ id: `over-${r.id}`, area: "Guests", tone: "rose", title: `Room ${r.room.number} — checkout overdue`, detail: `${r.reservation.guest.fullName}${r.reservation.balanceAmount > 0 ? ` · owes TZS ${r.reservation.balanceAmount.toLocaleString("en-US")}` : ""}`, minutes: mins(r.endAt, now), href: `/staff/reservations/${r.reservation.id}`, act: "Extend or have reception check out" });
  }
  if (overdue.length > 4) push({ id: "over-more", area: "Guests", tone: "rose", title: `${overdue.length - 4} more overdue checkouts`, detail: "Past checkout time", minutes: null, href: "/staff/reservations?view=departures", act: "See all" });
  const leavingOwing = inHouse.filter((r) => r.endAt > now && r.departureDate.getTime() <= day.getTime() && r.reservation.balanceAmount > 0);
  if (leavingOwing.length) {
    const total = [...new Map(leavingOwing.map((r) => [r.reservation.id, r.reservation.balanceAmount])).values()].reduce((a, b) => a + b, 0);
    push({ id: "leaving-owing", area: "Guests", tone: "amber", title: `${plural(leavingOwing.length, "guest")} leaving today still owe`, detail: `TZS ${total.toLocaleString("en-US")} to collect · ${leavingOwing.map((r) => r.room.number).join(", ")}`, minutes: null, href: "/staff/reservations?view=departures", act: "Follow up" });
  }
  // Arriving today to a room that is not ready — the most annoying thing for a guest.
  const notReady = arrivals.filter((a) => ["DIRTY", "CLEANING", "MAINTENANCE", "OUT_OF_SERVICE", "OCCUPIED"].includes(a.room.status));
  for (const a of notReady.slice(0, 4)) {
    const why = a.room.status === "OCCUPIED" ? "someone is still in it" : a.room.status === "MAINTENANCE" || a.room.status === "OUT_OF_SERVICE" ? "under maintenance" : "not cleaned yet";
    push({ id: `arr-${a.id}`, area: "Rooms", tone: a.room.status === "MAINTENANCE" || a.room.status === "OUT_OF_SERVICE" ? "rose" : "amber", title: `Arrival for room ${a.room.number} — room ${why}`, detail: `${a.reservation.guest.fullName}${a.reservation.eta ? ` · expected ${a.reservation.eta}` : ""}`, minutes: null, href: `/staff/reservations/${a.reservation.id}`, act: a.room.status === "MAINTENANCE" || a.room.status === "OUT_OF_SERVICE" ? "Move to another room" : "Hurry housekeeping" });
  }
  // Arriving today but the booking is not confirmed (nothing paid, no company) — it may not hold.
  const unconfirmed = arrivals.filter((a) => a.status === "RESERVED");
  if (unconfirmed.length) push({ id: "unconfirmed", area: "Bookings", tone: "amber", title: `${plural(unconfirmed.length, "arrival")} today not confirmed`, detail: unconfirmed.slice(0, 3).map((a) => `${a.reservation.guest.fullName.split(" ")[0]} · room ${a.room.number}`).join(" · "), minutes: null, href: "/staff/reservations?view=arrivals", act: "Reception should call and confirm" });
  // Guests waiting for help.
  for (const q of waitingHelp.slice(0, 3)) {
    const m = mins(q.createdAt, now);
    push({ id: `req-${q.id}`, area: "Guests", tone: m >= 60 ? "rose" : "amber", title: `${q.room ? `Room ${q.room.number}` : "A guest"} waiting for help for ${ago(m)}`, detail: `${REQUEST_WORD[q.type] ?? "Request"}: ${q.description}${q.assignedTo ? ` · with ${q.assignedTo.fullName.replace(/\s*\(.*\)/, "")}` : " · nobody on it"}`, minutes: m, href: "/staff/requests", act: q.assignedTo ? "Check it is being done" : "Give it to someone" });
  }
  if (waitingHelp.length > 3) push({ id: "req-more", area: "Guests", tone: "amber", title: `${waitingHelp.length - 3} more guest requests waiting`, detail: "Open the requests", minutes: null, href: "/staff/requests", act: "See all" });

  // Expected earlier and still not here.
  const nowMin = localMinutesOfDay(now, (await getSettings()).timezone);
  const late = arrivals.filter((a) => a.reservation.eta && /^\d{2}:\d{2}$/.test(a.reservation.eta) && nowMin - (Number(a.reservation.eta.slice(0, 2)) * 60 + Number(a.reservation.eta.slice(3))) > 60);
  if (late.length) push({ id: "late-arr", area: "Guests", tone: "sky", title: `${plural(late.length, "guest")} expected over an hour ago`, detail: late.map((a) => `${a.reservation.guest.fullName.split(" ")[0]} (${a.reservation.eta})`).join(" · "), minutes: null, href: "/staff/reservations?view=arrivals", act: "Reception can call them" });

  // Customer complaints still open — a manager's to handle.
  for (const c of complaints) {
    const where = c.order ? `${c.order.number.replace(/^ORD-\d{4}-0*/, "#")}${c.order.tableLabel ? ` · ${c.order.tableLabel}` : ""}` : c.room ? `Room ${c.room.number}` : c.guest?.fullName ?? "";
    push({ id: `cmp-${c.id}`, area: "Guests", tone: c.priority === "NORMAL" || c.priority === "LOW" ? "amber" : "rose", title: `Complaint: ${c.description.length > 60 ? `${c.description.slice(0, 57)}…` : c.description}`, detail: where || "Customer complaint", minutes: mins(c.createdAt, now), href: "/staff/requests", act: "Handle it and write what was done" });
  }

  // ── Rooms: housekeeping and maintenance, timed ──
  for (const r of rooms.filter((x) => x.status === "DIRTY" || x.status === "CLEANING")) {
    const m = mins(r.statusChangedAt, now);
    const limit = CLEAN_LIMIT[r.status as "DIRTY" | "CLEANING"];
    if (m >= limit) push({ id: `hk-${r.id}`, area: "Rooms", tone: m >= limit * 2 ? "rose" : "amber", title: `Room ${r.number} ${r.status === "CLEANING" ? "cleaning" : "waiting for cleaning"} for ${ago(m)}`, detail: r.status === "CLEANING" ? "Housekeeping started but has not finished" : "Nobody has started it yet", minutes: m, href: `/staff/rooms/${r.id}`, act: "Check with housekeeping" });
  }
  for (const r of rooms.filter((x) => x.status === "MAINTENANCE" || x.status === "OUT_OF_SERVICE")) {
    push({ id: `mt-${r.id}`, area: "Maintenance", tone: "slate", title: `Room ${r.number} ${r.status === "OUT_OF_SERVICE" ? "out of service" : "under maintenance"}`, detail: r.statusNote || "No reason written", minutes: mins(r.statusChangedAt, now), href: `/staff/rooms/${r.id}`, act: "Mark fixed when done" });
  }
  for (const a of assetsDown.slice(0, 5)) {
    push({ id: `as-${a.id}`, area: "Maintenance", tone: a.status === "OUT_OF_ORDER" ? "rose" : "slate", title: `${a.name} ${a.status === "OUT_OF_ORDER" ? "out of order" : "under repair"}`, detail: `${a.code}${a.location ? ` · ${a.location}` : ""}`, minutes: mins(a.updatedAt, now), href: "/staff/assets", act: "Follow the repair" });
  }

  // ── Restaurant: every stage has a clock ──
  const started = (o: (typeof orders)[number]) => ({ PENDING: o.createdAt, ACCEPTED: o.acceptedAt, PREPARING: o.preparingAt ?? o.acceptedAt, READY: o.readyAt, OUT_FOR_DELIVERY: o.takenAt } as Record<string, Date | null>)[o.status] ?? o.createdAt;
  const timed = orders.map((o) => ({ o, m: mins(started(o), now), lim: ORDER_LIMITS[o.status] })).filter((x) => x.lim && x.m >= x.lim.limit).sort((a, b) => b.m / b.lim.limit - a.m / a.lim.limit);
  for (const { o, m, lim } of timed.slice(0, 6)) {
    const where = o.tableLabel ?? (o.roomNumber ? `Room ${o.roomNumber}` : o.type === "TAKEAWAY" ? "Takeaway" : o.customerName ?? "Counter");
    push({ id: `ord-${o.id}`, area: "Restaurant", tone: m >= lim.limit * 2 ? "rose" : "amber", title: `${o.number.replace(/^ORD-\d{4}-0*/, "#")} ${lim.label} for ${ago(m)}`, detail: `${where} · TZS ${o.total.toLocaleString("en-US")}`, minutes: m, href: "/staff/restaurant", act: o.status === "READY" ? "Get a waiter to take it" : o.status === "PENDING" ? "Kitchen should accept it" : "Ask the kitchen" });
  }
  if (timed.length > 6) push({ id: "ord-more", area: "Restaurant", tone: "amber", title: `${timed.length - 6} more orders running late`, detail: "Open the live board", minutes: null, href: "/staff/restaurant", act: "See all" });

  // ── Tables ──
  for (const t of input.tablesWaiting.slice(0, 4)) {
    push({ id: `tb-${t.id}`, area: "Tables", tone: t.minutes >= 30 ? "rose" : "amber", title: `${t.name} waiting to pay for ${ago(t.minutes)}`, detail: t.due ? `TZS ${t.due.toLocaleString("en-US")} on the bill` : "Bill asked", minutes: t.minutes, href: `/staff/restaurant/tables?table=${t.id}`, act: "Send a waiter" });
  }

  // ── Payments ──
  if (toConfirm.length) {
    const total = toConfirm.reduce((t, p) => t + p.amount, 0);
    const oldest = mins(toConfirm[0].collectedAt, now);
    push({ id: "pay-confirm", area: "Payments", tone: oldest >= 60 ? "rose" : "amber", title: `${plural(toConfirm.length, "waiter payment")} waiting for reception`, detail: `TZS ${total.toLocaleString("en-US")} collected · oldest by ${toConfirm[0].collectedBy?.fullName ?? "a waiter"}`, minutes: oldest, href: "/staff/restaurant", act: "Reception confirms the money" });
  }
  for (const o of otherRoom.slice(0, 4)) {
    const log = billedBy.find((l) => l.entityId === o.id);
    const after = log?.after && typeof log.after === "object" && !Array.isArray(log.after) ? (log.after as Record<string, unknown>) : {};
    const reason = typeof after.reason === "string" && after.reason.trim() ? after.reason.trim() : null;
    const by = log?.user?.fullName.replace(/\s*\(.*\)/, "") ?? log?.actorLabel ?? null;
    const place = o.location?.name ?? o.tableLabel;
    push({
      id: `room-other-${o.id}`, area: "Payments", tone: "amber", title: `Order ${o.number.replace(/^ORD-\d{4}-0*/, "#")} on Room ${o.roomNumber ?? "—"} for another customer — check who pays`,
      detail: [`${o.customerName ?? "A customer"}${place ? ` at ${place}` : ""}`, `TZS ${o.total.toLocaleString("en-US")}`, o.reservation ? `${o.reservation.guest.fullName}'s room` : null, by ? `by ${by}` : null, reason ? `“${reason}”` : "no reason written"].filter(Boolean).join(" · "),
      minutes: null, href: `/staff/restaurant/orders/${o.id}`, act: "Change who pays if it is wrong",
    });
  }
  if (otherRoom.length > 4) push({ id: "room-other-more", area: "Payments", tone: "amber", title: `${otherRoom.length - 4} more orders on another customer's room today`, detail: "Each order's page shows who pays", minutes: null, href: "/staff/restaurant", act: "Check who pays" });
  if (input.expensesPending.count) push({ id: "exp", area: "Payments", tone: "amber", title: `${plural(input.expensesPending.count, "expense")} to approve`, detail: `TZS ${input.expensesPending.amount.toLocaleString("en-US")}`, minutes: null, href: "/staff/expenses?status=PENDING_APPROVAL", act: "Approve or reject" });

  // ── Bookings ──
  if (requests.length) {
    const oldest = mins(requests[0].createdAt, now);
    push({ id: "req", area: "Bookings", tone: oldest >= 60 ? "rose" : "gold", title: `${plural(requests.length, "online booking request")} not answered`, detail: requests.slice(0, 3).map((r) => r.companyName ?? r.fullName).join(" · "), minutes: oldest, href: "/staff/booking-requests", act: "Reception should call back" });
  }

  // ── Stores ──
  const toReview = stock.filter((r) => r.status === "SUBMITTED");
  if (toReview.length) {
    const depts = [...new Set(toReview.map((r) => r.inventoryDepartment?.name ?? r.department))];
    push({ id: "sr-review", area: "Stores", tone: toReview.some((r) => r.urgent) ? "rose" : "amber", title: `${plural(toReview.length, "stock request")} to review${toReview.some((r) => r.urgent) ? " · urgent" : ""}`, detail: depts.join(" · "), minutes: mins(toReview[0].createdAt, now), href: "/staff/stock-requests", act: "Approve, send back or reject" });
  }
  const toBuy = stock.filter((r) => r.status === "APPROVED" && r.decidedAt && now.getTime() - r.decidedAt.getTime() > 24 * 3600_000);
  if (toBuy.length) push({ id: "sr-buy", area: "Stores", tone: "amber", title: `${plural(toBuy.length, "approved request")} not bought yet`, detail: toBuy.slice(0, 4).map((r) => r.number).join(" · "), minutes: mins(toBuy[0].decidedAt!, now), href: "/staff/stock-requests", act: "Buy it, or reject it" });
  const toApprove = stock.filter((r) => r.status === "PENDING_APPROVAL");
  if (toApprove.length) push({ id: "sr-approve", area: "Payments", tone: "amber", title: `${plural(toApprove.length, "purchase")} waiting for final approval`, detail: `TZS ${toApprove.reduce((t, r) => t + (r.purchaseTotal ?? 0), 0).toLocaleString("en-US")} bought · not an expense until approved`, minutes: toApprove[0].submittedAt ? mins(toApprove[0].submittedAt, now) : null, href: "/staff/stock-requests", act: "Check the receipt and approve" });
  if (stores.out.length) push({ id: "st-out", area: "Stores", tone: "rose", title: `${plural(stores.out.length, "item")} out of stock`, detail: stores.out.slice(0, 4).map((i) => i.name).join(" · "), minutes: null, href: "/staff/inventory?v=overview", act: "Buy or receive stock" });
  if (stores.low.length) push({ id: "st-low", area: "Stores", tone: "amber", title: `${plural(stores.low.length, "item")} below minimum`, detail: stores.low.slice(0, 3).map((i) => `${i.name} ${formatQty(i.quantity, i.unit)}`).join(" · "), minutes: null, href: "/staff/inventory?v=overview", act: "Plan a purchase" });
  if (stores.pendingWaste) push({ id: "st-waste", area: "Stores", tone: "amber", title: `${plural(stores.pendingWaste, "waste report")} to approve`, detail: "The stock drops when you approve", minutes: null, href: "/staff/inventory?v=waste", act: "Approve or reject" });
  if (stores.expiring.length) push({ id: "st-exp", area: "Stores", tone: stores.expiring.some((e) => e.expired) ? "rose" : "amber", title: `${plural(stores.expiring.length, "delivery")} expiring`, detail: stores.expiring.slice(0, 3).map((e) => e.item.name).join(" · "), minutes: null, href: "/staff/inventory?v=overview", act: "Use first or record waste" });

  // ── Staff & reports ──
  if (!input.shiftOpen) push({ id: "shift", area: "Staff", tone: "amber", title: "Nobody on the front desk", detail: "No reception shift has been started", minutes: null, href: "/staff/shifts", act: "Call reception" });
  // A shift still open after 14 hours: the receptionist forgot to close it, and nobody else can start.
  for (const openShift of openShifts) {
    const shiftMinutes = mins(openShift.startedAt, now);
    if (shiftMinutes <= SHIFT_LIMIT) continue;
    push({ id: `shift-long-${openShift.id}`, area: "Staff", tone: "rose", title: `${openShift.user.fullName.replace(/\s*\(.*\)/, "")}'s shift has been open ${Math.floor(shiftMinutes / 60)} h — close it`, detail: `Started ${formatDateTime(openShift.startedAt, (await getSettings()).timezone)} · it holds one of the two reception places until it is closed`, minutes: shiftMinutes, href: `/staff/shifts/${openShift.id}`, act: "Close the shift (with the reason)" });
  }
  if (input.reportFailedId) push({ id: "report", area: "Staff", tone: "rose", title: "The daily report did not reach the Boss", detail: "The report is saved — send it again", minutes: null, href: `/staff/reports/daily/${input.reportFailedId}`, act: "Retry send" });

  d.push(...(input.extra ?? []));
  const rank: Record<Tone, number> = { rose: 0, amber: 1, gold: 2, sky: 3, slate: 4 };
  d.sort((a, b) => rank[a.tone] - rank[b.tone] || (b.minutes ?? 0) - (a.minutes ?? 0));

  // ── The live board ──
  const count = (s: string) => rooms.filter((r) => r.status === s).length;
  const longest = (s: string) => Math.max(0, ...rooms.filter((r) => r.status === s).map((r) => mins(r.statusChangedAt, now)));
  const stage = (s: string) => orders.filter((o) => o.status === s);
  const oldestIn = (s: string) => Math.max(0, ...stage(s).map((o) => mins(started(o), now)));
  const board = {
    frontDesk: { arriving: arrivals.length, inHouse: new Set(inHouse.map((r) => r.reservation.id)).size, overdue: overdue.length, onDesk: input.shiftOpen, onDeskShiftId: input.shiftOpen ? openShifts[0]?.id ?? null : null },
    housekeeping: { dirty: count("DIRTY"), cleaning: count("CLEANING"), ready: count("READY") + count("AVAILABLE"), longestDirty: longest("DIRTY"), longestCleaning: longest("CLEANING") },
    restaurant: (["PENDING", "PREPARING", "READY", "OUT_FOR_DELIVERY"] as const).map((s) => ({
      status: s, count: s === "PREPARING" ? stage("PREPARING").length + stage("ACCEPTED").length : stage(s).length,
      oldest: s === "PREPARING" ? Math.max(oldestIn("PREPARING"), oldestIn("ACCEPTED")) : oldestIn(s),
    })),
    tables: input.tables,
    payments: { toConfirm: toConfirm.length, toConfirmAmount: toConfirm.reduce((t, p) => t + p.amount, 0), oldest: toConfirm.length ? mins(toConfirm[0].collectedAt, now) : 0 },
    maintenance: { rooms: count("MAINTENANCE") + count("OUT_OF_SERVICE"), assets: assetsDown.length },
    stores: { out: stores.out.length, low: stores.low.length, waste: stores.pendingWaste },
  };
  return { decisions: d, board, activity };
}
export type CommandCenterData = Awaited<ReturnType<typeof commandCenter>>;

const many = (n: number, one: string, more = `${one}s`) => `${n} ${n === 1 ? one : more}`;
/** The words for each kind of work, in the order they are shown. */
const SAY: [string, (n: number) => string][] = [
  ["checkin", (n) => `Checked in ${many(n, "guest")}`], ["checkout", (n) => `Checked out ${many(n, "guest")}`],
  ["booking", (n) => `Created ${many(n, "reservation")}`], ["payment", (n) => `Recorded ${many(n, "payment")}`],
  ["confirmed", (n) => `Confirmed ${many(n, "waiter payment")}`], ["handled", (n) => `Handled ${many(n, "order")}`],
  ["prepared", (n) => `Prepared ${many(n, "order")}`], ["served", (n) => `Served ${many(n, "order")}`], ["taken", (n) => `Took ${many(n, "payment")}`],
  ["cleaned", (n) => `Cleaned ${many(n, "room")}`], ["moved", (n) => `Moved ${many(n, "guest")} to another room`],
  ["extended", (n) => `Extended ${many(n, "stay")}`], ["freeNights", (n) => `Gave free nights ${n === 1 ? "once" : `${n} times`}`],
  ["discount", (n) => `Gave ${many(n, "discount")}`], ["cancelled", (n) => `Cancelled ${many(n, "order")}`], ["roomStatus", (n) => `Changed ${many(n, "room status", "room statuses")}`],
  ["delivery", (n) => `Received ${many(n, "delivery", "deliveries")}`], ["stockUsed", (n) => `Took stock out ${n === 1 ? "once" : `${n} times`}`],
  ["wasteReported", (n) => `Reported ${many(n, "waste")}`], ["wasteApproved", (n) => `Approved ${many(n, "waste report")}`], ["counted", (n) => `Counted ${many(n, "item")}`],
  ["expense", (n) => `Recorded ${many(n, "expense")}`], ["expenseApproved", (n) => `Approved ${many(n, "expense")}`],
];

/** What each person did today, by department — activity only, never a score. */
async function staffActivity(today: BusinessDate) {
  const day = toDbDate(today);
  const { start, end } = businessDayBounds(today, businessDayConfig(await getSettings()));
  const [audit, events, touched, collected, cleaned, users] = await Promise.all([
    db.auditLog.groupBy({ by: ["userId", "action"], where: { businessDate: day, userId: { not: null } }, _count: true, _max: { createdAt: true } }),
    db.restaurantOrderEvent.groupBy({ by: ["byId", "to"], where: { order: { businessDate: day }, byId: { not: null } }, _count: true, _max: { at: true } }),
    db.restaurantOrderEvent.groupBy({ by: ["byId", "orderId"], where: { order: { businessDate: day }, byId: { not: null } } }),
    db.restaurantOrderPayment.groupBy({ by: ["collectedById"], where: { order: { businessDate: day }, status: "POSTED", collectedById: { not: null } }, _sum: { amount: true }, _count: true }),
    db.roomStatusHistory.groupBy({ by: ["changedById"], where: { toStatus: "READY", changedById: { not: null }, room: { isActive: true }, changedAt: { gte: start, lt: end } }, _count: true, _max: { changedAt: true } }),
    db.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true, role: { select: { code: true, name: true } } } }),
  ]);
  type P = { id: string; name: string; role: string; roleCode: string; things: Record<string, number>; money: number; last: Date | null };
  const people = new Map<string, P>();
  const who = (id: string) => {
    let p = people.get(id);
    if (!p) {
      const u = users.find((x) => x.id === id);
      if (!u) return null;
      p = { id, name: u.fullName.replace(/\s*\(.*\)/, ""), role: u.role.name, roleCode: u.role.code, things: {}, money: 0, last: null };
      people.set(id, p);
    }
    return p;
  };
  const add = (p: P | null, k: string, n: number, at?: Date | null) => {
    if (!p || !n) return;
    p.things[k] = (p.things[k] ?? 0) + n;
    if (at && (!p.last || at > p.last)) p.last = at;
  };
  // What each action says about the day, in plain words ("Checked in 4 guests", "Prepared 14 orders").
  const ACT: Record<string, string> = {
    "reservation.checked_in": "checkin", "reservation.walk_in": "checkin", "reservation.checked_out": "checkout", "reservation.created": "booking",
    "meeting.booked": "booking", "payment.created": "payment", "payment.company": "payment", "payment.group": "payment",
    "restaurant_order.payment_confirmed": "confirmed", "reservation.room_changed": "moved", "reservation.extended": "extended",
    "reservation.extended_free": "freeNights", "reservation.discount_changed": "discount", "restaurant_order.discounted": "discount",
    "restaurant_order.cancelled": "cancelled", "room.status_changed": "roomStatus", "room.closure_planned": "roomStatus",
    "inventory.received": "delivery", "inventory.used": "stockUsed", "inventory.waste_reported": "wasteReported", "inventory.waste_approved": "wasteApproved",
    "inventory.counted": "counted", "expense.approved": "expenseApproved", "expense.created": "expense", "booking_request.converted": "booking",
  };
  for (const a of audit) { const k = ACT[a.action]; if (k) add(who(a.userId!), k, a._count, a._max.createdAt); }
  for (const e of events) {
    const k = e.to === "READY" ? "prepared" : e.to === "DELIVERED" ? "served" : null;
    if (k) add(who(e.byId!), k, e._count, e._max.at);
  }
  // Orders a waiter handled: every order they took, moved on, served or were paid for.
  const handled = new Map<string, number>();
  for (const e of touched) handled.set(e.byId!, (handled.get(e.byId!) ?? 0) + 1);
  for (const [id, n] of handled) { const p = who(id); if (p && p.roleCode === "RESTAURANT") add(p, "handled", n); }
  for (const c of collected) { const p = who(c.collectedById!); if (p) { p.money += c._sum.amount ?? 0; add(p, "taken", c._count); } }
  for (const c of cleaned) add(who(c.changedById!), "cleaned", c._count, c._max.changedAt);

  const dept = (code: string) => (["RECEPTIONIST"].includes(code) ? "Reception" : code === "RESTAURANT" ? "Waiters" : code === "KITCHEN" ? "Kitchen" : ["MANAGER", "ADMIN", "OWNER"].includes(code) ? "Management" : "Other staff");
  const groups = new Map<string, P[]>();
  for (const p of people.values()) if (Object.keys(p.things).length) groups.set(dept(p.roleCode), [...(groups.get(dept(p.roleCode)) ?? []), p]);
  const order = ["Reception", "Waiters", "Kitchen", "Other staff", "Management"];
  return order.filter((g) => groups.has(g)).map((g) => ({
    department: g,
    people: groups.get(g)!.sort((a, b) => (b.last?.getTime() ?? 0) - (a.last?.getTime() ?? 0)).map((p) => ({
      name: p.name, role: p.role, money: p.money, last: p.last?.toISOString() ?? null,
      id: p.id,
      things: SAY.filter(([k]) => p.things[k]).map(([k, say]) => say(p.things[k])),
    })),
  }));
}
