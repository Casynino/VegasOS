import "server-only";
import { db } from "../db";
import { businessDayBounds, localMinutesOfDay, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { businessDayConfig, getSettings } from "../settings";
import { formatQty } from "@/lib/inventory";
import { inventoryAlerts } from "./inventory";
import { spotName } from "@/components/restaurant/shell";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { englishT, type T } from "@/i18n/translate";

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
/** 12 → "12 min", 125 → "2 h 5 min", 3000 → "2 d" — in the reader's language. */
export const ago = (m: number, t: T = englishT) => (m < 60 ? t("{n} min", { n: m }) : m < 1440 ? (m % 60 ? t("{h} h {m} min", { h: Math.floor(m / 60), m: m % 60 }) : t("{h} h", { h: Math.floor(m / 60) })) : t("{n} d", { n: Math.floor(m / 1440) }));
const REQUEST_WORD: Record<string, string> = { TOWELS: msg("Towels"), CLEANING: msg("Cleaning"), MAINTENANCE: msg("Repair"), RESTAURANT: msg("Food"), TRANSPORT: msg("Transport"), GENERAL: msg("Help"), OTHER: msg("Request") };

/** How long an order may sit in each stage before it is "late". */
export const ORDER_LIMITS: Record<string, { label: string; limit: number }> = {
  PENDING: { label: msg("waiting to be accepted"), limit: 5 },
  ACCEPTED: { label: msg("accepted, not started"), limit: 10 },
  PREPARING: { label: msg("preparing"), limit: 25 },
  READY: { label: msg("ready, not served yet"), limit: 10 },
  OUT_FOR_DELIVERY: { label: msg("being served"), limit: 15 },
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
  // What needs a decision is written for the person looking (their language); the home shows it as it is.
  const t = await getT();
  const tzs = (v: number) => `TZS ${v.toLocaleString("en-US")}`;
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
    staffActivity(today, t),
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
    push({ id: `over-${r.id}`, area: "Guests", tone: "rose", title: t("Room {room} — checkout overdue", { room: r.room.number }), detail: `${r.reservation.guest.fullName}${r.reservation.balanceAmount > 0 ? ` · ${t("owes {amount}", { amount: tzs(r.reservation.balanceAmount) })}` : ""}`, minutes: mins(r.endAt, now), href: `/staff/reservations/${r.reservation.id}`, act: t("Extend or have reception check out") });
  }
  if (overdue.length > 4) push({ id: "over-more", area: "Guests", tone: "rose", title: t("{n} more overdue checkouts", { n: overdue.length - 4 }), detail: t("Past checkout time"), minutes: null, href: "/staff/reservations?view=departures", act: t("See all") });
  const leavingOwing = inHouse.filter((r) => r.endAt > now && r.departureDate.getTime() <= day.getTime() && r.reservation.balanceAmount > 0);
  if (leavingOwing.length) {
    const total = [...new Map(leavingOwing.map((r) => [r.reservation.id, r.reservation.balanceAmount])).values()].reduce((a, b) => a + b, 0);
    push({ id: "leaving-owing", area: "Guests", tone: "amber", title: t.plural(leavingOwing.length, "{n} guest leaving today still owe", "{n} guests leaving today still owe"), detail: t("{amount} to collect · {rooms}", { amount: tzs(total), rooms: leavingOwing.map((r) => r.room.number).join(", ") }), minutes: null, href: "/staff/reservations?view=departures", act: t("Follow up") });
  }
  // Arriving today to a room that is not ready — the most annoying thing for a guest.
  const notReady = arrivals.filter((a) => ["DIRTY", "CLEANING", "MAINTENANCE", "OUT_OF_SERVICE", "OCCUPIED"].includes(a.room.status));
  for (const a of notReady.slice(0, 4)) {
    const why = a.room.status === "OCCUPIED" ? t("someone is still in it") : a.room.status === "MAINTENANCE" || a.room.status === "OUT_OF_SERVICE" ? t("under maintenance") : t("not cleaned yet");
    push({ id: `arr-${a.id}`, area: "Rooms", tone: a.room.status === "MAINTENANCE" || a.room.status === "OUT_OF_SERVICE" ? "rose" : "amber", title: t("Arrival for room {room} — room {why}", { room: a.room.number, why }), detail: `${a.reservation.guest.fullName}${a.reservation.eta ? ` · ${t("expected {time}", { time: a.reservation.eta })}` : ""}`, minutes: null, href: `/staff/reservations/${a.reservation.id}`, act: a.room.status === "MAINTENANCE" || a.room.status === "OUT_OF_SERVICE" ? t("Move to another room") : t("Hurry housekeeping") });
  }
  // Arriving today but the booking is not confirmed (nothing paid, no company) — it may not hold.
  const unconfirmed = arrivals.filter((a) => a.status === "RESERVED");
  if (unconfirmed.length) push({ id: "unconfirmed", area: "Bookings", tone: "amber", title: t.plural(unconfirmed.length, "{n} arrival today not confirmed", "{n} arrivals today not confirmed"), detail: unconfirmed.slice(0, 3).map((a) => t("{name} · room {room}", { name: a.reservation.guest.fullName.split(" ")[0], room: a.room.number })).join(" · "), minutes: null, href: "/staff/reservations?view=arrivals", act: t("Reception should call and confirm") });
  // Guests waiting for help.
  for (const q of waitingHelp.slice(0, 3)) {
    const m = mins(q.createdAt, now);
    push({
      id: `req-${q.id}`, area: "Guests", tone: m >= 60 ? "rose" : "amber",
      title: q.room ? t("Room {room} waiting for help for {time}", { room: q.room.number, time: ago(m, t) }) : t("A guest waiting for help for {time}", { time: ago(m, t) }),
      detail: q.assignedTo
        ? t("{type}: {description} · with {name}", { type: t(REQUEST_WORD[q.type] ?? "Request"), description: t(q.description), name: q.assignedTo.fullName.replace(/\s*\(.*\)/, "") })
        : t("{type}: {description} · nobody on it", { type: t(REQUEST_WORD[q.type] ?? "Request"), description: t(q.description) }),
      minutes: m, href: "/staff/requests", act: q.assignedTo ? t("Check it is being done") : t("Give it to someone"),
    });
  }
  if (waitingHelp.length > 3) push({ id: "req-more", area: "Guests", tone: "amber", title: t("{n} more guest requests waiting", { n: waitingHelp.length - 3 }), detail: t("Open the requests"), minutes: null, href: "/staff/requests", act: t("See all") });

  // Expected earlier and still not here.
  const nowMin = localMinutesOfDay(now, (await getSettings()).timezone);
  const late = arrivals.filter((a) => a.reservation.eta && /^\d{2}:\d{2}$/.test(a.reservation.eta) && nowMin - (Number(a.reservation.eta.slice(0, 2)) * 60 + Number(a.reservation.eta.slice(3))) > 60);
  if (late.length) push({ id: "late-arr", area: "Guests", tone: "sky", title: t.plural(late.length, "{n} guest expected over an hour ago", "{n} guests expected over an hour ago"), detail: late.map((a) => `${a.reservation.guest.fullName.split(" ")[0]} (${a.reservation.eta})`).join(" · "), minutes: null, href: "/staff/reservations?view=arrivals", act: t("Reception can call them") });

  // Customer complaints still open — a manager's to handle.
  for (const c of complaints) {
    const where = c.order ? `${c.order.number.replace(/^ORD-\d{4}-0*/, "#")}${c.order.tableLabel ? ` · ${spotName(c.order.tableLabel, t)}` : ""}` : c.room ? t("Room {room}", { room: c.room.number }) : c.guest?.fullName ?? "";
    push({ id: `cmp-${c.id}`, area: "Guests", tone: c.priority === "NORMAL" || c.priority === "LOW" ? "amber" : "rose", title: t("Complaint: {text}", { text: c.description.length > 60 ? `${c.description.slice(0, 57)}…` : c.description }), detail: where || t("Customer complaint"), minutes: mins(c.createdAt, now), href: "/staff/requests", act: t("Handle it and write what was done") });
  }

  // ── Rooms: housekeeping and maintenance, timed ──
  for (const r of rooms.filter((x) => x.status === "DIRTY" || x.status === "CLEANING")) {
    const m = mins(r.statusChangedAt, now);
    const limit = CLEAN_LIMIT[r.status as "DIRTY" | "CLEANING"];
    if (m >= limit) push({ id: `hk-${r.id}`, area: "Rooms", tone: m >= limit * 2 ? "rose" : "amber", title: r.status === "CLEANING" ? t("Room {room} cleaning for {time}", { room: r.number, time: ago(m, t) }) : t("Room {room} waiting for cleaning for {time}", { room: r.number, time: ago(m, t) }), detail: r.status === "CLEANING" ? t("Housekeeping started but has not finished") : t("Nobody has started it yet"), minutes: m, href: `/staff/rooms/${r.id}`, act: t("Check with housekeeping") });
  }
  for (const r of rooms.filter((x) => x.status === "MAINTENANCE" || x.status === "OUT_OF_SERVICE")) {
    push({ id: `mt-${r.id}`, area: "Maintenance", tone: "slate", title: r.status === "OUT_OF_SERVICE" ? t("Room {room} out of service", { room: r.number }) : t("Room {room} under maintenance", { room: r.number }), detail: r.statusNote || t("No reason written"), minutes: mins(r.statusChangedAt, now), href: `/staff/rooms/${r.id}`, act: t("Mark fixed when done") });
  }
  for (const a of assetsDown.slice(0, 5)) {
    push({ id: `as-${a.id}`, area: "Maintenance", tone: a.status === "OUT_OF_ORDER" ? "rose" : "slate", title: a.status === "OUT_OF_ORDER" ? t("{name} out of order", { name: a.name }) : t("{name} under repair", { name: a.name }), detail: `${a.code}${a.location ? ` · ${a.location}` : ""}`, minutes: mins(a.updatedAt, now), href: "/staff/assets", act: t("Follow the repair") });
  }

  // ── Restaurant: every stage has a clock ──
  const started = (o: (typeof orders)[number]) => ({ PENDING: o.createdAt, ACCEPTED: o.acceptedAt, PREPARING: o.preparingAt ?? o.acceptedAt, READY: o.readyAt, OUT_FOR_DELIVERY: o.takenAt } as Record<string, Date | null>)[o.status] ?? o.createdAt;
  const timed = orders.map((o) => ({ o, m: mins(started(o), now), lim: ORDER_LIMITS[o.status] })).filter((x) => x.lim && x.m >= x.lim.limit).sort((a, b) => b.m / b.lim.limit - a.m / a.lim.limit);
  for (const { o, m, lim } of timed.slice(0, 6)) {
    const where = o.tableLabel != null ? spotName(o.tableLabel, t) : o.roomNumber ? t("Room {room}", { room: o.roomNumber }) : o.type === "TAKEAWAY" ? t("Takeaway") : o.customerName ?? t("Counter");
    push({ id: `ord-${o.id}`, area: "Restaurant", tone: m >= lim.limit * 2 ? "rose" : "amber", title: t("{no} {state} for {time}", { no: o.number.replace(/^ORD-\d{4}-0*/, "#"), state: t(lim.label), time: ago(m, t) }), detail: `${where} · ${tzs(o.total)}`, minutes: m, href: "/staff/restaurant", act: o.status === "READY" ? t("Get a waiter to take it") : o.status === "PENDING" ? t("Kitchen should accept it") : t("Ask the kitchen") });
  }
  if (timed.length > 6) push({ id: "ord-more", area: "Restaurant", tone: "amber", title: t("{n} more orders running late", { n: timed.length - 6 }), detail: t("Open the live board"), minutes: null, href: "/staff/restaurant", act: t("See all") });

  // ── Tables ──
  for (const w of input.tablesWaiting.slice(0, 4)) {
    push({ id: `tb-${w.id}`, area: "Tables", tone: w.minutes >= 30 ? "rose" : "amber", title: t("{table} waiting to pay for {time}", { table: spotName(w.name, t), time: ago(w.minutes, t) }), detail: w.due ? t("{amount} on the bill", { amount: tzs(w.due) }) : t("Bill asked"), minutes: w.minutes, href: `/staff/restaurant/tables?table=${w.id}`, act: t("Send a waiter") });
  }

  // ── Payments ──
  if (toConfirm.length) {
    const total = toConfirm.reduce((t, p) => t + p.amount, 0);
    const oldest = mins(toConfirm[0].collectedAt, now);
    push({ id: "pay-confirm", area: "Payments", tone: oldest >= 60 ? "rose" : "amber", title: t.plural(toConfirm.length, "{n} waiter payment waiting for reception", "{n} waiter payments waiting for reception"), detail: t("{amount} collected · oldest by {name}", { amount: tzs(total), name: toConfirm[0].collectedBy?.fullName ?? t("a waiter") }), minutes: oldest, href: "/staff/restaurant", act: t("Reception confirms the money") });
  }
  for (const o of otherRoom.slice(0, 4)) {
    const log = billedBy.find((l) => l.entityId === o.id);
    const after = log?.after && typeof log.after === "object" && !Array.isArray(log.after) ? (log.after as Record<string, unknown>) : {};
    const reason = typeof after.reason === "string" && after.reason.trim() ? after.reason.trim() : null;
    const by = log?.user?.fullName.replace(/\s*\(.*\)/, "") ?? log?.actorLabel ?? null;
    const place = o.location?.name ?? o.tableLabel;
    push({
      id: `room-other-${o.id}`, area: "Payments", tone: "amber", title: t("Order {no} on Room {room} for another customer — check who pays", { no: o.number.replace(/^ORD-\d{4}-0*/, "#"), room: o.roomNumber ?? "—" }),
      detail: [
        place ? t("{customer} at {place}", { customer: o.customerName ?? t("A customer"), place: spotName(place, t) }) : o.customerName ?? t("A customer"), tzs(o.total),
        o.reservation ? t("{name}'s room", { name: o.reservation.guest.fullName }) : null, by ? t("by {name}", { name: by }) : null, reason ? `“${reason}”` : t("no reason written"),
      ].filter(Boolean).join(" · "),
      minutes: null, href: `/staff/restaurant/orders/${o.id}`, act: t("Change who pays if it is wrong"),
    });
  }
  if (otherRoom.length > 4) push({ id: "room-other-more", area: "Payments", tone: "amber", title: t("{n} more orders on another customer's room today", { n: otherRoom.length - 4 }), detail: t("Each order's page shows who pays"), minutes: null, href: "/staff/restaurant", act: t("Check who pays") });
  if (input.expensesPending.count) push({ id: "exp", area: "Payments", tone: "amber", title: t.plural(input.expensesPending.count, "{n} expense to approve", "{n} expenses to approve"), detail: tzs(input.expensesPending.amount), minutes: null, href: "/staff/expenses?status=PENDING_APPROVAL", act: t("Approve or reject") });

  // ── Bookings ──
  if (requests.length) {
    const oldest = mins(requests[0].createdAt, now);
    push({ id: "req", area: "Bookings", tone: oldest >= 60 ? "rose" : "gold", title: t.plural(requests.length, "{n} online booking request not answered", "{n} online booking requests not answered"), detail: requests.slice(0, 3).map((r) => r.companyName ?? r.fullName).join(" · "), minutes: oldest, href: "/staff/booking-requests", act: t("Reception should call back") });
  }

  // ── Stores ──
  const toReview = stock.filter((r) => r.status === "SUBMITTED");
  if (toReview.length) {
    const depts = [...new Set(toReview.map((r) => r.inventoryDepartment?.name ?? r.department))];
    push({ id: "sr-review", area: "Stores", tone: toReview.some((r) => r.urgent) ? "rose" : "amber", title: `${t.plural(toReview.length, "{n} stock request to review", "{n} stock requests to review")}${toReview.some((r) => r.urgent) ? ` · ${t("urgent")}` : ""}`, detail: depts.map((x) => t(x)).join(" · "), minutes: mins(toReview[0].createdAt, now), href: "/staff/stock-requests", act: t("Approve, send back or reject") });
  }
  const toBuy = stock.filter((r) => r.status === "APPROVED" && r.decidedAt && now.getTime() - r.decidedAt.getTime() > 24 * 3600_000);
  if (toBuy.length) push({ id: "sr-buy", area: "Stores", tone: "amber", title: t.plural(toBuy.length, "{n} approved request not bought yet", "{n} approved requests not bought yet"), detail: toBuy.slice(0, 4).map((r) => r.number).join(" · "), minutes: mins(toBuy[0].decidedAt!, now), href: "/staff/stock-requests", act: t("Buy it, or reject it") });
  const toApprove = stock.filter((r) => r.status === "PENDING_APPROVAL");
  if (toApprove.length) push({ id: "sr-approve", area: "Payments", tone: "amber", title: t.plural(toApprove.length, "{n} purchase waiting for final approval", "{n} purchases waiting for final approval"), detail: t("{amount} bought · not an expense until approved", { amount: tzs(toApprove.reduce((sum, r) => sum + (r.purchaseTotal ?? 0), 0)) }), minutes: toApprove[0].submittedAt ? mins(toApprove[0].submittedAt, now) : null, href: "/staff/stock-requests", act: t("Check the receipt and approve") });
  if (stores.out.length) push({ id: "st-out", area: "Stores", tone: "rose", title: t.plural(stores.out.length, "{n} item out of stock", "{n} items out of stock"), detail: stores.out.slice(0, 4).map((i) => t(i.name)).join(" · "), minutes: null, href: "/staff/inventory?v=overview", act: t("Buy or receive stock") });
  if (stores.low.length) push({ id: "st-low", area: "Stores", tone: "amber", title: t.plural(stores.low.length, "{n} item below minimum", "{n} items below minimum"), detail: stores.low.slice(0, 3).map((i) => `${t(i.name)} ${formatQty(i.quantity, i.unit, t)}`).join(" · "), minutes: null, href: "/staff/inventory?v=overview", act: t("Plan a purchase") });
  if (stores.pendingWaste) push({ id: "st-waste", area: "Stores", tone: "amber", title: t.plural(stores.pendingWaste, "{n} waste report to approve", "{n} waste reports to approve"), detail: t("The stock drops when you approve"), minutes: null, href: "/staff/inventory?v=waste", act: t("Approve or reject") });
  if (stores.expiring.length) push({ id: "st-exp", area: "Stores", tone: stores.expiring.some((e) => e.expired) ? "rose" : "amber", title: t.plural(stores.expiring.length, "{n} delivery expiring", "{n} deliverys expiring"), detail: stores.expiring.slice(0, 3).map((e) => t(e.item.name)).join(" · "), minutes: null, href: "/staff/inventory?v=overview", act: t("Use first or record waste") });

  // ── Staff & reports ──
  if (!input.shiftOpen) push({ id: "shift", area: "Staff", tone: "amber", title: t("Nobody on the front desk"), detail: t("No reception shift has been started"), minutes: null, href: "/staff/shifts", act: t("Call reception") });
  // A shift still open after 14 hours: the receptionist forgot to close it, and nobody else can start.
  for (const openShift of openShifts) {
    const shiftMinutes = mins(openShift.startedAt, now);
    if (shiftMinutes <= SHIFT_LIMIT) continue;
    push({
      id: `shift-long-${openShift.id}`, area: "Staff", tone: "rose",
      title: t("{name}'s shift has been open {h} h — close it", { name: openShift.user.fullName.replace(/\s*\(.*\)/, ""), h: Math.floor(shiftMinutes / 60) }),
      detail: t("Started {time} · it holds one of the two reception places until it is closed", { time: t.dateTime(openShift.startedAt, (await getSettings()).timezone) }),
      minutes: shiftMinutes, href: `/staff/shifts/${openShift.id}`, act: t("Close the shift (with the reason)"),
    });
  }
  if (input.reportFailedId) push({ id: "report", area: "Staff", tone: "rose", title: t("The daily report did not reach the Boss"), detail: t("The report is saved — send it again"), minutes: null, href: `/staff/reports/daily/${input.reportFailedId}`, act: t("Retry send") });

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

/** The words for each kind of work, in the order they are shown — in the reader's language. */
const SAY: [string, (n: number, t: T) => string][] = [
  ["checkin", (n, t) => t.plural(n, "Checked in {n} guest", "Checked in {n} guests")], ["checkout", (n, t) => t.plural(n, "Checked out {n} guest", "Checked out {n} guests")],
  ["booking", (n, t) => t.plural(n, "Created {n} reservation", "Created {n} reservations")], ["payment", (n, t) => t.plural(n, "Recorded {n} payment", "Recorded {n} payments")],
  ["confirmed", (n, t) => t.plural(n, "Confirmed {n} waiter payment", "Confirmed {n} waiter payments")], ["handled", (n, t) => t.plural(n, "Handled {n} order", "Handled {n} orders")],
  ["prepared", (n, t) => t.plural(n, "Prepared {n} order", "Prepared {n} orders")], ["served", (n, t) => t.plural(n, "Served {n} order", "Served {n} orders")], ["taken", (n, t) => t.plural(n, "Took {n} payment", "Took {n} payments")],
  ["cleaned", (n, t) => t.plural(n, "Cleaned {n} room", "Cleaned {n} rooms")], ["moved", (n, t) => t.plural(n, "Moved {n} guest to another room", "Moved {n} guests to another room")],
  ["extended", (n, t) => t.plural(n, "Extended {n} stay", "Extended {n} stays")], ["freeNights", (n, t) => t.plural(n, "Gave free nights once", "Gave free nights {n} times")],
  ["discount", (n, t) => t.plural(n, "Gave {n} discount", "Gave {n} discounts")], ["cancelled", (n, t) => t.plural(n, "Cancelled {n} order", "Cancelled {n} orders")], ["roomStatus", (n, t) => t.plural(n, "Changed {n} room status", "Changed {n} room statuses")],
  ["delivery", (n, t) => t.plural(n, "Received {n} delivery", "Received {n} deliveries")], ["stockUsed", (n, t) => t.plural(n, "Took stock out once", "Took stock out {n} times")],
  ["wasteReported", (n, t) => t.plural(n, "Reported {n} waste", "Reported {n} wastes")], ["wasteApproved", (n, t) => t.plural(n, "Approved {n} waste report", "Approved {n} waste reports")], ["counted", (n, t) => t.plural(n, "Counted {n} item", "Counted {n} items")],
  ["expense", (n, t) => t.plural(n, "Recorded {n} expense", "Recorded {n} expenses")], ["expenseApproved", (n, t) => t.plural(n, "Approved {n} expense", "Approved {n} expenses")],
];

/** What each person did today, by department — activity only, never a score. */
async function staffActivity(today: BusinessDate, t: T = englishT) {
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

  // The department names stay English (the home shows them with t()).
  const dept = (code: string) => (["RECEPTIONIST"].includes(code) ? msg("Reception") : code === "RESTAURANT" ? msg("Waiters") : code === "KITCHEN" ? msg("Kitchen") : ["MANAGER", "ADMIN", "OWNER"].includes(code) ? msg("Management") : msg("Other staff"));
  const groups = new Map<string, P[]>();
  for (const p of people.values()) if (Object.keys(p.things).length) groups.set(dept(p.roleCode), [...(groups.get(dept(p.roleCode)) ?? []), p]);
  const order = ["Reception", "Waiters", "Kitchen", "Other staff", "Management"];
  return order.filter((g) => groups.has(g)).map((g) => ({
    department: g,
    people: groups.get(g)!.sort((a, b) => (b.last?.getTime() ?? 0) - (a.last?.getTime() ?? 0)).map((p) => ({
      name: p.name, role: p.role, money: p.money, last: p.last?.toISOString() ?? null,
      id: p.id,
      things: SAY.filter(([k]) => p.things[k]).map(([k, say]) => say(p.things[k], t)),
    })),
  }));
}
