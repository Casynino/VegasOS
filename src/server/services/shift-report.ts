import "server-only";
import { randomBytes } from "node:crypto";
import { db } from "../db";
import { audit } from "../audit";
import { AppError, isUniqueViolation } from "../errors";
import { getSettings } from "../settings";
import { fromDbDate } from "@/lib/time/business-date";
import { formatBusinessDate } from "@/lib/format";
import { shiftLabel } from "@/lib/shift-label";
import { friendlyAction } from "@/lib/activity-words";
import { REQUEST_TYPE_LABEL } from "@/lib/request-meta";
import type { Block, Figure, Report } from "@/lib/report-types";
import { Prisma } from "@/generated/prisma/client";
import { ALL_SOURCES, collectionRows, collectionTotals } from "./collections";
import { waiterActivity } from "./waiter-activity";
import { deliverToRecipients, MAX_ATTEMPTS } from "./report-delivery";

/**
 * SHIFT REPORTS — when a waiter or a receptionist ends their shift, the system writes their report from what they
 * actually did inside the shift's time (their own records, never typed in): a headline, the detail by area, the
 * money kept apart (payments recorded ≠ revenue ≠ still owed), the records themselves and a timeline. Facts only —
 * never a score. The report is frozen when made (one per shift: the shift id makes it idempotent) and goes to the
 * boss by WhatsApp with a private link; a failed message never touches the shift and is tried again later.
 * An authorized regeneration (MD / owner, with the reason) keeps the earlier version.
 */

const SHARE_DAYS = 30;
const LOGS = 3000;

export type ShiftFact = { label: string; value: number; money?: boolean; sub?: string };
export type ShiftRecordTable = { title: string; subtitle?: string; columns: { label: string; align?: "left" | "right"; money?: boolean }[]; rows: (string | number | null)[][]; more?: number; moreNote?: string };

export interface ShiftReportData {
  v: 1;
  shift: {
    id: string; department: "RECEPTION" | "RESTAURANT"; label: string; businessDate: string; startedAt: string; endedAt: string; minutes: number;
    closedBy: string | null; byManager: boolean; closeReason: string | null; closingNote: string | null; replacement: string | null;
  };
  person: { id: string; name: string; role: string };
  /** What the boss reads first (and the WhatsApp lines): only what happened. */
  headline: ShiftFact[];
  /** The detail, by area. */
  groups: { title: string; subtitle?: string; facts: ShiftFact[] }[];
  /** Money, each kind apart: payments they recorded, revenue on their work, and what was still owed. */
  money: { title: string; subtitle: string; facts: ShiftFact[]; byKind: { name: string; amount: number }[] } | null;
  /** The records behind the figures. */
  records: ShiftRecordTable[];
  /** Left at the end of the shift (what the next person takes on). */
  handover: string[];
  timeline: { at: string; text: string; area: string }[];
  timelineMore: boolean;
  /** How many timeline lines were left out (a very long shift) — 0 or absent when the timeline is whole. */
  timelineLeft?: number;
  /** How busy each hour of the shift was (actions in the system) — for the chart. Reports before Oct 2026 have none. */
  hours?: { at: string; count: number }[];
}

/** Whose records, in which time: a shift — or a week / month of one person's work (`id` null). */
export type Subject = {
  id: string | null; userId: string; startedAt: Date; endedAt: Date; businessDate: Date;
  closingNote: string | null; closedById: string | null; closeReason: string | null; closedBy: { fullName: string } | null;
};

/** Actions per hour between two instants (the hour each one happened in). */
function perHour(start: Date, end: Date, times: Date[]) {
  const first = new Date(start); first.setUTCMinutes(0, 0, 0);
  const out: { at: string; count: number }[] = [];
  for (let t = first.getTime(); t < end.getTime() && out.length < 48; t += 3_600_000) {
    out.push({ at: new Date(t).toISOString(), count: times.filter((x) => x.getTime() >= t && x.getTime() < t + 3_600_000).length });
  }
  return out;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const tzs = (n: number) => `TZS ${Math.round(n).toLocaleString("en-US")}`;
export const shiftDuration = (minutes: number) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
const shortNo = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;
const nonzero = (f: ShiftFact[]) => f.filter((x) => x.value !== 0);
/** A note on one line, never endless (the boss's message stays short and its link always fits). */
const oneLine = (t: string, max = 300) => { const x = t.replace(/\s+/g, " ").trim(); return x.length > max ? `${x.slice(0, max - 1)}…` : x; };
/** "14 guests checked in", "1 guest checked in", "TZS 80,000 recorded in payments" — one line of the headline. */
export function factLine(f: ShiftFact) {
  if (f.money) return `${tzs(f.value)} ${f.label.charAt(0).toLowerCase()}${f.label.slice(1)}`;
  const label = f.value === 1 ? f.label.replace(/\b(Guests|Reservations|Payments|Orders|Tables|Rooms|orders|requests)\b/, (m) => m.slice(0, -1)) : f.label;
  return `${f.value.toLocaleString("en-US")} ${label.charAt(0).toLowerCase()}${label.slice(1)}`;
}

// ───────────────────────── Reading one shift ─────────────────────────

async function loadShift(shiftId: string) {
  const s = await db.actualShift.findUnique({
    where: { id: shiftId },
    include: { user: { select: { id: true, fullName: true, role: { select: { name: true } } } }, closedBy: { select: { id: true, fullName: true } } },
  });
  if (!s) throw new AppError("Shift not found.", "NOT_FOUND");
  if (!s.endedAt) throw new AppError("This shift is still running — its report is made when it ends.", "CONFLICT");
  return s as typeof s & { endedAt: Date };
}

/** Build the report's figures from the shift's records (not stored — `generateShiftReport` freezes them). */
export async function buildShiftReportData(shiftId: string): Promise<ShiftReportData> {
  const s = await loadShift(shiftId);
  const minutes = Math.max(0, Math.round((s.endedAt.getTime() - s.startedAt.getTime()) / 60000));
  const base = {
    v: 1 as const,
    shift: {
      id: s.id, department: s.department, label: shiftLabel(s.startedAt), businessDate: fromDbDate(s.businessDate),
      startedAt: s.startedAt.toISOString(), endedAt: s.endedAt.toISOString(), minutes,
      closedBy: s.closedBy?.fullName ?? null, byManager: !!s.closedById && s.closedById !== s.userId, closeReason: s.closeReason, closingNote: s.closingNote,
      replacement: s.isReplacement ? s.replacementReason : null,
    },
    person: { id: s.user.id, name: s.user.fullName, role: s.user.role.name },
  };
  return { ...base, ...(s.department === "RESTAURANT" ? await waiterFacts(s) : await receptionFacts(s)) };
}

/** Automatic rows that come with someone's real step (a room set Occupied by a check-in…) — not separate work. */
const CHECK_IN_ACTIONS = ["reservation.checked_in", "reservation.walk_in", "meeting.started"];
const AUTO_ROOM_NOTE = /^(Checked in|Checked out|Guest moved|Meeting completed|Moved|Room move)|:\s*(guest|booking .+?) moved (to|from) /i;
const NOISE = new Set(["auth.logout", "reservation.confirmed_by_payment", "reservation.back_to_pending", "thank_you.generated", "group.checked_in", "group.checked_out", "booking_request.converted"]);

/** The timeline's words for the actions that matter most on a shift (the rest use the shared activity words). */
const LINE: Record<string, string> = {
  "shift.started": "Shift started", "shift.ended": "Shift ended", "shift.closed_by_manager": "Shift closed by a manager",
  "reservation.created": "Reservation created", "reservation.walk_in": "Walk-in guest checked in", "reservation.checked_in": "Guest checked in", "reservation.checked_out": "Guest checked out",
  "reservation.confirmed": "Reservation confirmed", "reservation.cancelled": "Reservation cancelled", "reservation.no_show": "Marked a no-show",
  "reservation.dates_changed": "Booking dates changed", "reservation.extended": "Stay extended", "reservation.extended_free": "Stay extended (free)",
  "reservation.room_changed": "Guest moved to another room", "reservation.room_assigned": "Room assigned",
  "payment.created": "Payment recorded", "payment.refunded": "Refund recorded", "payment.group": "Group payment recorded", "payment.company": "Company payment recorded",
  "restaurant_order.created": "Restaurant order created", "restaurant_order.paid": "Restaurant payment recorded", "restaurant_order.charged_to_room": "Order put on a room",
  "request.created": "Guest request logged", "request.accepted": "Guest request accepted", "request.updated": "Guest request updated", "complaint.logged": "Complaint logged", "complaint.resolved": "Complaint resolved",
  "transport.requested": "Transport arranged", "transport.confirmed": "Transport confirmed", "transport.driver_assigned": "Driver assigned", "transport.driver_changed": "Driver changed", "transport.completed": "Transport completed",
  "booking_request.contacted": "Booking request — customer contacted", "booking_request.status_changed": "Booking request updated", "booking_request.assigned": "Booking request taken",
  "guest.updated": "Guest details updated", "guest.updated_at_checkin": "Guest details updated at check-in", "guest.message_sent": "Message sent to a guest",
  "room.status_changed": "Room status changed", "meeting.booked": "Meeting room booked", "meeting.started": "Meeting started", "meeting.completed": "Meeting completed",
};
const AREA = (a: string) =>
  a.startsWith("shift.") ? "Shift" : /^reservation\.(checked_in|checked_out|walk_in|room_)/.test(a) ? "Front desk" : a.startsWith("reservation.") || a.startsWith("meeting.") || a.startsWith("booking_request.") ? "Bookings"
  : /^(payment|revenue|invoice)\./.test(a) ? "Money" : a.startsWith("restaurant_order.") || a.startsWith("dining_session.") ? "Restaurant"
  : a.startsWith("request.") || a.startsWith("complaint.") ? "Requests" : a.startsWith("transport.") ? "Transport" : a.startsWith("room.") ? "Rooms" : a.startsWith("guest.") ? "Guests" : "Other";
const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

// ───────────────────────── Reception ─────────────────────────

async function receptionFacts(s: Subject, opts: { period?: boolean } = {}) {
  const W = { gte: s.startedAt, lt: s.endedAt };
  const day = fromDbDate(s.businessDate);
  const [logs, logCount] = await Promise.all([
    db.auditLog.findMany({
      where: { userId: s.userId, createdAt: W }, orderBy: { createdAt: "asc" }, take: LOGS,
      select: { id: true, action: true, entityType: true, entityId: true, after: true, createdAt: true },
    }),
    db.auditLog.count({ where: { userId: s.userId, createdAt: W } }),
  ]);
  const distinct = (...actions: string[]) => new Set(logs.filter((l) => actions.includes(l.action)).map((l) => l.entityId ?? l.id)).size;
  const after = (l: { after: unknown }) => (l.after && typeof l.after === "object" ? (l.after as Record<string, unknown>) : {});

  const [totals, payRows, ordersMade, requestsLogged, messages, roomsIn, roomsOut, closeLog] = await Promise.all([
    collectionTotals(day, day, { collectorIds: [s.userId], sources: ALL_SOURCES, window: { start: s.startedAt, end: s.endedAt } }).then((t) => t.of(s.userId)),
    collectionRows({ from: day, to: day, window: { start: s.startedAt, end: s.endedAt }, collectorId: s.userId, sources: ALL_SOURCES }),
    db.restaurantOrder.findMany({ where: { createdById: s.userId, createdAt: W }, select: { number: true, type: true, roomNumber: true, total: true, status: true, settlement: true, tableLabel: true, createdAt: true } }),
    db.serviceRequest.count({ where: { createdById: s.userId, createdAt: W } }),
    db.guestMessage.groupBy({ by: ["channel"], where: { sentById: s.userId, createdAt: W }, _count: true }),
    db.reservationRoom.count({ where: { checkedInById: s.userId, checkedInAt: W } }),
    db.reservationRoom.count({ where: { checkedOutById: s.userId, checkedOutAt: W } }),
    s.id ? db.auditLog.findFirst({ where: { entityType: "ActualShift", entityId: s.id, action: { in: ["shift.ended", "shift.closed_by_manager"] } }, select: { after: true } }) : null,
  ]);

  // ── Reservations, guests, rooms, requests, transport ──
  const RES_TOUCH = ["reservation.created", "reservation.walk_in", "reservation.confirmed", "reservation.cancelled", "reservation.no_show", "reservation.dates_changed", "reservation.extended", "reservation.extended_free",
    "reservation.discount_changed", "reservation.billing_changed", "reservation.late_checkout", "reservation.late_arrival", "reservation.occupant_added", "reservation.occupant_removed", "reservation.charge_added", "reservation.charge_voided",
    "meeting.booked", "meeting.changed"];
  const MODIFY = RES_TOUCH.filter((a) => !["reservation.created", "reservation.walk_in", "reservation.confirmed", "reservation.cancelled", "reservation.no_show", "meeting.booked"].includes(a));
  const checkIns = distinct("reservation.checked_in", "reservation.walk_in", "meeting.started");
  const checkOuts = distinct("reservation.checked_out", "meeting.completed");
  const handled = distinct(...RES_TOUCH);
  const created = distinct("reservation.created", "meeting.booked");
  const walkIns = distinct("reservation.walk_in");
  const requestsAccepted = distinct("request.accepted");
  const finished = (l: (typeof logs)[number]) => (l.action === "request.updated" && after(l).status === "COMPLETED") || l.action === "complaint.resolved";
  const requestsDone = new Set(logs.filter(finished).map((l) => l.entityId)).size;
  // Each request they took or finished, once (accepting one and finishing another are two requests handled).
  const requestsHandled = new Set(logs.filter((l) => l.action === "request.accepted" || finished(l)).map((l) => l.entityId)).size;
  const manualRoomStatus = logs.filter((l) => l.action === "room.status_changed" && !AUTO_ROOM_NOTE.test(String(after(l).note ?? ""))).length;
  const transport = distinct("transport.requested");
  const roomOrders = ordersMade.filter((o) => o.type === "ROOM_SERVICE");
  const messagesSent = messages.reduce((t, m) => t + m._count, 0);

  const groups: ShiftReportData["groups"] = [
    { title: "Reservations", facts: [
      { label: "Reservations handled", value: handled, sub: "made, confirmed, changed or cancelled" },
      { label: "Reservations created", value: created }, { label: "Walk-ins", value: walkIns },
      { label: "Confirmed", value: distinct("reservation.confirmed") }, { label: "Changed", value: distinct(...MODIFY), sub: "dates, nights, discount, who pays…" },
      { label: "Cancelled", value: distinct("reservation.cancelled") }, { label: "No-shows", value: distinct("reservation.no_show") },
      { label: "Booking requests processed", value: new Set(logs.filter((l) => l.action.startsWith("booking_request.") && l.action !== "booking_request.submitted").map((l) => l.entityId)).size },
    ] },
    { title: "Guests", facts: [
      { label: "Guests checked in", value: checkIns, sub: roomsIn ? plural(roomsIn, "room") : undefined },
      { label: "Guests checked out", value: checkOuts, sub: roomsOut ? plural(roomsOut, "room") : undefined },
      { label: "Guest details updated", value: distinct("guest.updated", "guest.updated_at_checkin") },
      { label: "Guest requests logged", value: requestsLogged }, { label: "Guest requests accepted", value: requestsAccepted }, { label: "Guest requests done", value: requestsDone },
      { label: "Messages sent to guests", value: messagesSent, sub: messages.map((m) => `${m.channel.toLowerCase()} ${m._count}`).join(" · ") || undefined },
    ] },
    { title: "Rooms", facts: [
      { label: "Rooms assigned", value: distinct("reservation.room_assigned") }, { label: "Guests moved to another room", value: logs.filter((l) => l.action === "reservation.room_changed").length },
      { label: "Room status changes", value: manualRoomStatus, sub: "by hand (not the automatic ones at check-in / out)" },
    ] },
    { title: "Restaurant guest service", subtitle: "Orders for hotel guests — the restaurant prepares and serves them", facts: [
      { label: "Restaurant orders created", value: ordersMade.length }, { label: "Room-service orders", value: roomOrders.length, sub: [...new Set(roomOrders.flatMap((o) => (o.roomNumber ?? "").split(",").map((x) => x.trim()).filter(Boolean)))].map((r) => `Room ${r}`).join(", ") || undefined },
      { label: "Value of those orders", value: ordersMade.filter((o) => o.status !== "CANCELLED").reduce((t, o) => t + o.total, 0), money: true },
    ] },
    { title: "Transport", facts: [
      { label: "Transport requests created", value: transport }, { label: "Confirmed", value: distinct("transport.confirmed") },
      { label: "Drivers assigned", value: distinct("transport.driver_assigned", "transport.driver_changed") }, { label: "Completed", value: distinct("transport.completed") },
    ] },
  ];

  // ── Money: payments THEY recorded (not personal sales); what guests still owed at the close ──
  const closing = closeLog?.after && typeof closeLog.after === "object" ? (closeLog.after as Record<string, unknown>) : {};
  const owing = typeof closing.totalOutstanding === "number" ? closing.totalOutstanding : null;
  const owingGuests = typeof closing.guestsOwing === "number" ? closing.guestsOwing : null;
  const money: ShiftReportData["money"] = {
    title: "Payments recorded", subtitle: "Money this person recorded in the system during the shift — kept apart from revenue and from what is still owed",
    byKind: totals.byKind,
    facts: [
      { label: "Payments recorded", value: totals.payments }, { label: "Amount recorded", value: totals.collected, money: true },
      { label: "Refunds", value: totals.refunds, money: true }, { label: "Reversed", value: totals.reversed, money: true },
      { label: "Restaurant orders put on rooms", value: totals.roomCharges, money: true, sub: totals.roomOrders ? plural(totals.roomOrders, "order") : undefined },
      ...(owing !== null ? [{ label: "Still owed by guests in the hotel at the close", value: owing, money: true, sub: owingGuests !== null ? plural(owingGuests, "guest") : undefined }] : []),
    ],
  };
  const byAccount = totals.byAccount.map((a) => `${a.name}: ${tzs(a.amount)}`).join(" · ");
  if (byAccount) money.facts.push({ label: "Into accounts", value: totals.byAccount.length, sub: byAccount });

  const records: ShiftRecordTable[] = [];
  if (payRows.rows.length) records.push({
    title: "Payments recorded", subtitle: "Each payment this person recorded in the shift",
    columns: [{ label: "Time" }, { label: "For" }, { label: "How" }, { label: "Account" }, { label: "Status" }, { label: "Amount", align: "right", money: true }],
    rows: [...payRows.rows].reverse().map((r) => [r.at, `${r.what ?? r.place}${r.customer ? ` · ${r.customer}` : ""}`, r.method, r.account, r.status === "REVERSED" ? "Reversed" : r.refund ? "Refund" : "Recorded", r.amount]),
    more: payRows.count > payRows.rows.length ? payRows.count - payRows.rows.length : undefined, moreNote: "every one is in Collections for this shift",
  });
  if (ordersMade.length) records.push({
    title: "Restaurant orders created", subtitle: "For hotel guests — prepared and served by the restaurant",
    columns: [{ label: "Time" }, { label: "Order" }, { label: "Where" }, { label: "Billing" }, { label: "Status" }, { label: "Total", align: "right", money: true }],
    rows: ordersMade.map((o) => [o.createdAt.toISOString(), shortNo(o.number), o.type === "ROOM_SERVICE" ? `Room ${o.roomNumber ?? ""}`.trim() : o.tableLabel ?? "Restaurant", o.settlement === "ROOM" ? "Room bill" : o.settlement === "PAY_NOW" ? "Paid now" : "To pay", cap(o.status.toLowerCase().replace(/_/g, " ")), o.total]),
  });

  // ── Timeline ──
  const real = logs.filter((l) => !NOISE.has(l.action) && !(l.action === "room.status_changed" && AUTO_ROOM_NOTE.test(String(after(l).note ?? ""))));
  const timeline = opts.period ? { timeline: [], timelineMore: false, timelineLeft: 0 } : await receptionTimeline(logCount - logs.length, real, s);
  const hours = opts.period ? undefined : perHour(s.startedAt, s.endedAt, real.filter((l) => l.action !== "auth.login" && !l.action.startsWith("shift.")).map((l) => l.createdAt));

  // ── The people behind the figures: who she checked in and out, the bookings she made, the requests she handled ──
  const ids = (actions: string[]) => [...new Set(logs.filter((l) => actions.includes(l.action) && l.entityId).map((l) => l.entityId!))];
  const [resRows, reqRows] = await Promise.all([
    db.reservation.findMany({
      where: { id: { in: ids([...CHECK_IN_ACTIONS, "reservation.checked_out", "reservation.created", "meeting.booked"]) } },
      select: { id: true, reference: true, arrivalDate: true, departureDate: true, balanceAmount: true, netAmount: true, guest: { select: { fullName: true } }, rooms: { select: { room: { select: { number: true } } } } },
    }),
    db.serviceRequest.findMany({ where: { id: { in: ids(["request.accepted", "request.updated", "complaint.resolved", "request.created"]) } }, select: { id: true, type: true, status: true, room: { select: { number: true } } } }),
  ]);
  const resById = new Map(resRows.map((r) => [r.id, r]));
  const reqById = new Map(reqRows.map((r) => [r.id, r]));
  const roomList = (r: { rooms: { room: { number: string } | null }[] }) => [...new Set(r.rooms.map((x) => x.room?.number).filter(Boolean))].join(", ") || "—";
  const firstOf = (actions: string[]) => {
    const seen = new Map<string, Date>();
    for (const l of logs) if (actions.includes(l.action) && l.entityId && !seen.has(l.entityId)) seen.set(l.entityId, l.createdAt);
    return [...seen.entries()];
  };
  const LIST = 60;
  const listRecords: ShiftRecordTable[] = [];
  const ins = firstOf(CHECK_IN_ACTIONS).filter(([id]) => resById.has(id));
  if (ins.length) listRecords.push({
    title: "Guests checked in", subtitle: opts.period ? "Each stay she checked in" : "Each stay checked in during the shift",
    columns: [{ label: opts.period ? "When" : "Time" }, { label: "Guest" }, { label: "Room" }, { label: "Booking" }, { label: "Until" }],
    rows: ins.slice(0, LIST).map(([id, at]) => { const r = resById.get(id)!; return [at.toISOString(), r.guest.fullName, roomList(r), r.reference, formatBusinessDate(fromDbDate(r.departureDate))]; }),
    more: ins.length > LIST ? ins.length - LIST : undefined, moreNote: "see Stays for every one",
  });
  const outs = firstOf(["reservation.checked_out"]).filter(([id]) => resById.has(id));
  if (outs.length) listRecords.push({
    title: "Guests checked out", subtitle: "With what was still owed on the bill",
    columns: [{ label: opts.period ? "When" : "Time" }, { label: "Guest" }, { label: "Room" }, { label: "Booking" }, { label: "Bill", align: "right", money: true }, { label: "Still owed", align: "right", money: true }],
    rows: outs.slice(0, LIST).map(([id, at]) => { const r = resById.get(id)!; return [at.toISOString(), r.guest.fullName, roomList(r), r.reference, r.netAmount, Math.max(0, r.balanceAmount)]; }),
    more: outs.length > LIST ? outs.length - LIST : undefined, moreNote: "see Stays for every one",
  });
  const made = firstOf(["reservation.created", "meeting.booked"]).filter(([id]) => resById.has(id));
  if (made.length) listRecords.push({
    title: "Reservations made", subtitle: "Bookings she created",
    columns: [{ label: opts.period ? "When" : "Time" }, { label: "Booking" }, { label: "Guest" }, { label: "Stay" }, { label: "Value", align: "right", money: true }],
    rows: made.slice(0, LIST).map(([id, at]) => { const r = resById.get(id)!; return [at.toISOString(), r.reference, r.guest.fullName, `${formatBusinessDate(fromDbDate(r.arrivalDate))} → ${formatBusinessDate(fromDbDate(r.departureDate))}`, r.netAmount]; }),
    more: made.length > LIST ? made.length - LIST : undefined, moreNote: "see Stays for every one",
  });
  const handledReq = firstOf(["request.accepted", "request.updated", "complaint.resolved"]).filter(([id]) => reqById.has(id));
  if (handledReq.length) listRecords.push({
    title: "Guest requests she handled", subtitle: "Accepted or finished",
    columns: [{ label: opts.period ? "When" : "Time" }, { label: "Request" }, { label: "Room" }, { label: "Now" }],
    rows: handledReq.slice(0, LIST).map(([id, at]) => { const q = reqById.get(id)!; return [at.toISOString(), REQUEST_TYPE_LABEL[q.type] ?? "Request", q.room?.number ?? "—", q.status === "COMPLETED" ? "Done" : q.status === "IN_PROGRESS" ? "On it" : cap(q.status.toLowerCase().replace(/_/g, " "))]; }),
    more: handledReq.length > LIST ? handledReq.length - LIST : undefined, moreNote: "see Requests",
  });

  const headline = nonzero([
    { label: "Guests checked in", value: checkIns }, { label: "Guests checked out", value: checkOuts }, { label: "Reservations handled", value: handled },
    { label: "Payments recorded", value: totals.payments }, { label: "Recorded in payments", value: totals.collected, money: true },
    { label: "Restaurant guest orders", value: ordersMade.length }, { label: "Transport requests", value: transport },
    { label: "Guest requests handled", value: requestsHandled },
  ]);
  const handover = [
    owing !== null ? (owing > 0 ? `Guests in the hotel owed ${tzs(owing)} at the close${owingGuests ? ` (${plural(owingGuests, "guest")})` : ""}.` : "No guest in the hotel owed money at the close.") : null,
    s.closingNote ? `Handover note: ${oneLine(s.closingNote)}` : null,
    typeof closing.requestsReleased === "number" && closing.requestsReleased > 0 ? `${plural(closing.requestsReleased, "guest request")} put back to New for the next shift.` : null,
  ].filter((x): x is string => !!x);
  return { headline, groups: groups.map((g) => ({ ...g, facts: nonzero(g.facts) })).filter((g) => g.facts.length), money, records: [...listRecords, ...records], handover, ...timeline, hours };
}

/** The reception timeline: each action with what it was about (the booking, the room, the amount). */
async function receptionTimeline(left: number, logs: { id: string; action: string; entityType: string; entityId: string | null; after: unknown; createdAt: Date }[], s: Subject) {
  const ids = (type: string) => [...new Set(logs.filter((l) => l.entityType === type && l.entityId).map((l) => l.entityId!))];
  const [reservations, payments, orders, requests, trips] = await Promise.all([
    db.reservation.findMany({ where: { id: { in: ids("Reservation") } }, select: { id: true, reference: true, guest: { select: { fullName: true } }, rooms: { select: { room: { select: { number: true } } } } } }),
    db.payment.findMany({ where: { id: { in: ids("Payment") } }, select: { id: true, amount: true } }),
    db.restaurantOrder.findMany({ where: { id: { in: ids("RestaurantOrder") } }, select: { id: true, number: true, roomNumber: true, type: true } }),
    db.serviceRequest.findMany({ where: { id: { in: ids("ServiceRequest") } }, select: { id: true, type: true, room: { select: { number: true } } } }),
    db.transportTrip.findMany({ where: { id: { in: ids("TransportTrip") } }, select: { id: true, reference: true } }),
  ]);
  const res = new Map(reservations.map((r) => [r.id, r]));
  const pay = new Map(payments.map((p) => [p.id, p]));
  const ord = new Map(orders.map((o) => [o.id, o]));
  const req = new Map(requests.map((q) => [q.id, q]));
  const trip = new Map(trips.map((t) => [t.id, t]));
  const rooms = (r: { rooms: { room: { number: string } | null }[] }) => [...new Set(r.rooms.map((x) => x.room?.number).filter(Boolean))].join(", ");
  const detail = (l: (typeof logs)[number]) => {
    const a = l.after && typeof l.after === "object" ? (l.after as Record<string, unknown>) : {};
    if (l.entityType === "Reservation" && l.entityId) {
      const r = res.get(l.entityId);
      if (!r) return null;
      const where = rooms(r);
      return /checked_(in|out)|walk_in|room_/.test(l.action) && where ? `Room ${where} · ${r.guest.fullName}` : `${r.reference} · ${r.guest.fullName}`;
    }
    if (l.entityType === "Payment" && l.entityId) { const p = pay.get(l.entityId); return p ? tzs(p.amount) : null; }
    if (l.entityType === "RestaurantOrder" && l.entityId) {
      const o = ord.get(l.entityId);
      if (!o) return null;
      const amount = typeof a.amount === "number" ? ` · ${tzs(a.amount)}` : "";
      return `${shortNo(o.number)}${o.roomNumber ? ` · Room ${o.roomNumber}` : ""}${amount}`;
    }
    if (l.entityType === "ServiceRequest" && l.entityId) { const q = req.get(l.entityId); return q ? `${cap(q.type.toLowerCase())}${q.room ? ` · Room ${q.room.number}` : ""}` : null; }
    if (l.entityType === "TransportTrip" && l.entityId) return trip.get(l.entityId)?.reference ?? null;
    return null;
  };
  const rows = logs.map((l) => {
    const word = l.action === "shift.closed_by_manager" && s.closedById === s.userId ? "Shift ended" : LINE[l.action] ?? cap(friendlyAction(l.action));
    const d = detail(l);
    return { at: l.createdAt.toISOString(), text: d ? `${word} — ${d}` : word, area: AREA(l.action) };
  });
  // The end of the shift is always the last line (a manager's close is the manager's own log row).
  if (!rows.some((r) => r.text.startsWith("Shift ended") || r.text.startsWith("Shift closed"))) {
    rows.push({ at: s.endedAt.toISOString(), text: s.closedById && s.closedById !== s.userId ? `Shift closed by ${s.closedBy?.fullName ?? "a manager"}${s.closeReason ? ` — ${s.closeReason}` : ""}` : "Shift ended", area: "Shift" });
  }
  return { timeline: rows, timelineMore: left > 0, timelineLeft: Math.max(0, left) };
}

// ───────────────────────── Waiter ─────────────────────────

/** Orders the customer placed themselves (website, the menu QR codes, their stay link). */
const CUSTOMER_SOURCES = ["WEBSITE", "PUBLIC_QR", "GUEST_LINK", "ROOM_QR", "TABLE_QR", "COUNTER_QR", "RESTAURANT_QR"];

async function waiterFacts(s: Subject, opts: { period?: boolean } = {}) {
  const W = { gte: s.startedAt, lt: s.endedAt };
  const me = s.userId;
  const [assignments, steps, made, served, closedTables, brought, activity] = await Promise.all([
    // Up to and including the close: a manager's hand-over at the close is written at the very moment the shift ends.
    db.waiterAssignment.findMany({ where: { at: { gte: s.startedAt, lte: s.endedAt }, OR: [{ toUserId: me }, { fromUserId: me }] }, select: { scope: true, orderId: true, locationId: true, kind: true, via: true, toUserId: true, fromUserId: true, at: true } }),
    db.restaurantOrderEvent.findMany({ where: { byId: me, at: W }, select: { orderId: true, from: true, to: true, note: true } }),
    db.restaurantOrder.findMany({ where: { createdById: me, createdAt: W }, select: { id: true, createdAt: true } }),
    db.restaurantOrder.findMany({ where: { deliveredById: me, deliveredAt: W }, select: { id: true, total: true } }),
    db.diningSession.count({ where: { closedById: me, closedAt: W } }),
    db.restaurantOrderPayment.findMany({ where: { handedOverById: me, status: "POSTED", collectedAt: W }, select: { amount: true, orderId: true, account: { select: { kind: true } } } }),
    // The waiter's own record of the shift (its timeline and order rows) — not for a week or a month.
    opts.period ? Promise.resolve(null) : waiterActivity(me, { from: s.startedAt, to: s.endedAt }, { windowOnly: true }),
  ]);
  const orderAssign = assignments.filter((a) => a.scope === "ORDER" && a.orderId);
  const ids = new Set<string>([...orderAssign.filter((a) => a.toUserId === me).map((a) => a.orderId!), ...steps.filter((e) => e.from !== e.to).map((e) => e.orderId), ...made.map((o) => o.id), ...served.map((o) => o.id)]);
  const orders = ids.size ? await db.restaurantOrder.findMany({
    where: { id: { in: [...ids] } },
    select: {
      id: true, number: true, type: true, source: true, status: true, settlement: true, total: true, paidAmount: true, roomNumber: true, sessionId: true, completedAt: true, cancelledAt: true,
      location: { select: { name: true, kind: true } },
      payments: { where: { status: "POSTED" }, select: { amount: true, online: true, atCounter: true } },
    },
  }) : [];
  const live = orders.filter((o) => o.status !== "CANCELLED");
  const inW = (d: Date | null) => !!d && d >= s.startedAt && d < s.endedAt;
  const byManager = (a: { via: string }) => a.via === "MANAGER" || a.via === "SHIFT_CLOSE";
  // The row written when they made the order themselves (same moment as the order) is "created", not "assigned" or "claimed".
  const madeRow = new Set(made.map((o) => `${o.id}|${o.createdAt.getTime()}`));
  const atCreation = (a: { orderId: string | null; at: Date }) => madeRow.has(`${a.orderId}|${a.at.getTime()}`);

  const tableOrders = live.filter((o) => o.location?.kind === "TABLE");
  const roomOrders = live.filter((o) => o.type === "ROOM_SERVICE");
  const customerOrders = live.filter((o) => CUSTOMER_SOURCES.includes(o.source));
  const receptionOrders = live.filter((o) => o.source === "RECEPTION");
  const roomsServed = [...new Set(roomOrders.flatMap((o) => (o.roomNumber ?? "").split(",").map((x) => x.trim()).filter(Boolean)))];
  const tablesServed = [...new Set(tableOrders.map((o) => o.location!.name))];
  const sessions = new Set(live.map((o) => o.sessionId).filter(Boolean)).size;
  const onRoom = live.filter((o) => o.settlement === "ROOM");
  const paidOnline = live.reduce((t, o) => t + o.payments.filter((p) => p.online).reduce((x, p) => x + p.amount, 0), 0);
  const atCounter = live.filter((o) => o.payments.some((p) => !p.online && p.atCounter));
  const paidAtRestaurant = live.reduce((t, o) => t + o.payments.filter((p) => !p.online).reduce((x, p) => x + p.amount, 0), 0);
  const unpaid = live.filter((o) => o.settlement !== "ROOM" && o.total - o.paidAmount > 0);
  const cash = brought.filter((p) => p.account.kind === "CASH" || p.account.kind === "PETTY_CASH");
  const bills = steps.filter((e) => e.from === e.to && e.note && /^(Bill|Table bill|Room bill) (printed|downloaded|shared)/.test(e.note)).length;

  const facts = {
    handled: live.length, created: made.length,
    assigned: orderAssign.filter((a) => a.toUserId === me && !atCreation(a) && (a.kind === "ROUTED" || a.kind === "MANAGER" || (a.kind === "TAKEN" && a.via === "PIN") || (a.kind === "TRANSFER" && byManager(a)))).length,
    claimed: orderAssign.filter((a) => a.toUserId === me && a.kind === "TAKEN" && a.via === "SELF" && !atCreation(a)).length,
    handedIn: orderAssign.filter((a) => a.toUserId === me && a.kind === "TRANSFER" && !byManager(a)).length,
    handedOut: orderAssign.filter((a) => a.fromUserId === me && a.kind === "TRANSFER" && !byManager(a)).length,
    reassigned: orderAssign.filter((a) => a.fromUserId === me && !!a.toUserId && a.kind !== "RELEASED" && (a.kind === "MANAGER" || byManager(a))).length,
    served: served.length, servedValue: served.reduce((t, o) => t + o.total, 0),
    completed: live.filter((o) => o.status === "COMPLETED" && inW(o.completedAt)).length,
    cancelled: orders.filter((o) => o.status === "CANCELLED" && inW(o.cancelledAt)).length,
    steps: steps.filter((e) => e.from !== e.to).length,
  };
  const groups: ShiftReportData["groups"] = [
    { title: "Orders", facts: [
      { label: "Orders handled", value: facts.handled, sub: "created, given to them, claimed or served by them" },
      { label: "Orders created", value: facts.created }, { label: "Orders assigned to them", value: facts.assigned }, { label: "Orders claimed", value: facts.claimed },
      { label: "Orders served / delivered", value: facts.served, sub: facts.servedValue ? tzs(facts.servedValue) : undefined }, { label: "Orders completed", value: facts.completed, sub: "served and settled" },
      { label: "Orders cancelled", value: facts.cancelled }, { label: "Order steps moved", value: facts.steps, sub: "accept, ready, serve…" },
    ] },
    { title: "Where the orders came from", facts: [
      { label: "Table orders", value: tableOrders.length }, { label: "Room orders", value: roomOrders.length },
      { label: "Online & QR orders", value: customerOrders.length, sub: "placed by the customer: website, menu QR, stay link" },
      { label: "Orders from reception (hotel guests)", value: receptionOrders.length },
    ] },
    { title: "Hand-overs", facts: [
      { label: "Handed over to a colleague", value: facts.handedOut }, { label: "Handed to them by a colleague", value: facts.handedIn },
      { label: "Moved by a manager", value: facts.reassigned },
    ] },
    { title: "Tables & rooms", facts: [
      { label: "Tables served", value: tablesServed.length, sub: tablesServed.join(", ") || undefined }, { label: "Table sessions", value: sessions },
      { label: "Tables closed (customers left)", value: closedTables }, { label: "Tables given to them", value: assignments.filter((a) => a.scope === "TABLE" && a.toUserId === me).length },
      { label: "Rooms served", value: roomsServed.length, sub: roomsServed.map((r) => `Room ${r}`).join(", ") || undefined },
      { label: "Bills printed or shared", value: bills },
    ] },
  ];
  const money: ShiftReportData["money"] = {
    title: "Payments on their orders", subtitle: "Service information, not a cash count: the Restaurant Counter records every payment",
    byKind: [],
    facts: [
      { label: "Cash brought to the Counter", value: cash.reduce((t, p) => t + p.amount, 0), money: true, sub: cash.length ? plural(new Set(cash.map((p) => p.orderId)).size, "order") : undefined },
      { label: "Paid at the restaurant", value: paidAtRestaurant, money: true, sub: atCounter.length ? `${plural(atCounter.length, "order")} recorded by the Counter` : undefined },
      { label: "Paid online", value: paidOnline, money: true },
      { label: "Charged to rooms", value: onRoom.reduce((t, o) => t + o.total, 0), money: true, sub: onRoom.length ? plural(onRoom.length, "order") : undefined },
      { label: "Still unpaid when the report was made", value: unpaid.reduce((t, o) => t + o.total - o.paidAmount, 0), money: true, sub: unpaid.length ? plural(unpaid.length, "order") : undefined },
    ],
  };
  const records: ShiftRecordTable[] = [];
  const rows = activity ? activity.orders.filter((o) => ids.has(o.id)) : [];
  if (rows.length) records.push({
    title: "Orders they handled", subtitle: "Each order, how it came to them, and how it was paid (as the Counter recorded it)",
    columns: [{ label: "Order" }, { label: "Where" }, { label: "How" }, { label: "Status" }, { label: "Paid" }, { label: "Total", align: "right", money: true }],
    rows: rows.map((o) => [o.no, o.place, o.how.join(", ") || "—", cap(o.status.toLowerCase().replace(/_/g, " ")), o.money === "ROOM_BILL" ? "Room bill" : o.money === "PAID_ONLINE" ? "Online" : o.paidBy ?? (o.money === "UNPAID" ? "Unpaid" : cap(o.money.toLowerCase().replace(/_/g, " "))), o.total]),
  });

  const timeline = activity ? [...activity.history].reverse().map((h) => ({ at: h.at, text: h.text, area: h.kind === "shift" ? "Shift" : h.kind === "bill" ? "Bills" : h.kind === "table" ? "Tables" : h.kind === "assign" ? "Hand-overs" : "Orders" })) : [];
  if (activity && !timeline.some((t) => t.area === "Shift" && /^(Ended|Shift closed)/.test(t.text))) timeline.push({ at: s.endedAt.toISOString(), text: s.closedById && s.closedById !== me ? `Shift closed by ${s.closedBy?.fullName ?? "a manager"}${s.closeReason ? ` — ${s.closeReason}` : ""}` : "Ended the shift", area: "Shift" });
  if (activity && !timeline.some((t) => t.area === "Shift" && /^Started/.test(t.text))) timeline.unshift({ at: s.startedAt.toISOString(), text: "Started the shift", area: "Shift" });

  const headline = nonzero([
    { label: "Orders handled", value: facts.handled }, { label: "Orders served", value: facts.served }, { label: "Orders completed", value: facts.completed },
    { label: "Tables served", value: tablesServed.length }, { label: "Room orders", value: roomOrders.length }, { label: "Online & QR orders", value: customerOrders.length },
    { label: "Cash brought to the Counter", value: cash.reduce((t, p) => t + p.amount, 0), money: true }, { label: "Room-charge orders", value: onRoom.length },
    { label: "Orders handed over", value: facts.handedOut }, { label: "Orders cancelled", value: facts.cancelled },
  ]);
  const handover = [
    facts.reassigned ? `${plural(facts.reassigned, "order")} moved to a colleague by a manager.` : null,
    s.closingNote ? `Note: ${oneLine(s.closingNote)}` : null,
  ].filter((x): x is string => !!x);
  const hours = activity ? perHour(s.startedAt, s.endedAt, activity.history.filter((h) => h.kind !== "shift").map((h) => new Date(h.at))) : undefined;
  return { headline, groups: groups.map((g) => ({ ...g, facts: nonzero(g.facts) })).filter((g) => g.facts.length), money: { ...money, facts: nonzero(money.facts) }, records, handover, timeline, timelineMore: activity?.more ?? false, hours };
}

/** One person's facts for any window (a shift, a week, a month) — the same counting everywhere. */
export function personFacts(s: Subject, department: "RECEPTION" | "RESTAURANT", opts: { period?: boolean } = {}) {
  return department === "RESTAURANT" ? waiterFacts(s, opts) : receptionFacts(s, opts);
}

// ───────────────────────── The document (same look as the daily report) ─────────────────────────

const factValue = (f: ShiftFact) => (f.money ? tzs(f.value) : f.value.toLocaleString("en-US"));

export function buildShiftDocument(d: ShiftReportData, timezone: string): Report {
  const clock = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(new Date(iso));
  const reception = d.shift.department === "RECEPTION";
  const top = d.headline.slice(0, 4);
  const figures: Figure[] = [
    { label: "Shift", value: `${clock(d.shift.startedAt)} → ${clock(d.shift.endedAt)}`, sub: d.shift.label, tone: "gold" as const },
    { label: "Duration", value: shiftDuration(d.shift.minutes), sub: formatBusinessDate(d.shift.businessDate) },
    ...top.map((f): Figure => ({ label: f.label, value: factValue(f), raw: f.value, tone: f.money ? "emerald" : undefined })),
  ].slice(0, 6);
  const blocks: Block[] = [];
  blocks.push({
    kind: "highlights", title: "Shift performance",
    items: [
      { label: "Staff", value: d.person.name, sub: d.person.role },
      { label: "Business date", value: formatBusinessDate(d.shift.businessDate, true), sub: "hotel day 04:00 → 04:00" },
      { label: "Shift", value: `${clock(d.shift.startedAt)} → ${clock(d.shift.endedAt)}`, sub: `${shiftDuration(d.shift.minutes)} · ${d.shift.label}` },
      { label: "Closed", value: d.shift.byManager ? `By ${d.shift.closedBy ?? "a manager"}` : "By themselves", sub: d.shift.byManager && d.shift.closeReason ? d.shift.closeReason : undefined },
    ],
  });
  blocks.push(d.headline.length
    ? { kind: "list", title: "Activity", tone: "insight", items: d.headline.map(factLine) }
    : { kind: "note", text: "No recorded activity in this shift." });
  if (d.handover.length) blocks.push({ kind: "list", title: "At the end of the shift", tone: "attention", items: d.handover });
  if (d.shift.replacement) blocks.push({ kind: "note", text: `Worked as a replacement for the scheduled person — ${d.shift.replacement}` });

  blocks.push({ kind: "section", title: "Activity in detail", subtitle: reception ? "Reservations, guests, rooms, restaurant guest service and transport" : "Orders, where they came from, hand-overs, tables and rooms" });
  for (const g of d.groups) {
    blocks.push({
      kind: "table", title: g.title, subtitle: g.subtitle, half: true,
      columns: [{ label: "What" }, { label: "Count", align: "right" }, { label: "", muted: true }],
      rows: g.facts.map((f) => [f.label, f.money ? tzs(f.value) : f.value, f.sub ?? null]),
    });
  }
  if (d.money && d.money.facts.length) {
    blocks.push({ kind: "section", title: d.money.title, subtitle: d.money.subtitle });
    blocks.push({ kind: "table", title: d.money.title, half: d.money.byKind.length > 0, columns: [{ label: "What" }, { label: "Amount / count", align: "right" }, { label: "", muted: true }], rows: d.money.facts.map((f) => [f.label, f.money ? tzs(f.value) : f.value, f.sub ?? null]) });
    if (d.money.byKind.length) blocks.push({ kind: "bars", title: "By payment method", items: d.money.byKind.map((k) => ({ label: k.name, value: k.amount })), money: true, half: true });
  }
  if (d.records.length) {
    blocks.push({ kind: "section", title: "Records", subtitle: "The records behind the figures" });
    for (const r of d.records) {
      blocks.push({
        kind: "table", title: r.title, subtitle: r.subtitle, columns: r.columns.map((c) => ({ label: c.label, align: c.align, money: c.money })),
        rows: r.rows.map((row) => row.map((c, i) => (i === 0 && typeof c === "string" && /^\d{4}-\d{2}-\d{2}T/.test(c) ? clock(c) : c))), more: r.more, moreNote: r.moreNote,
      });
    }
  }
  blocks.push({ kind: "section", title: "Timeline", subtitle: "Everything this person did in the system during the shift, in order" });
  blocks.push({
    kind: "table", title: "Activity timeline", columns: [{ label: "Time" }, { label: "What happened" }, { label: "Area", muted: true }],
    rows: d.timeline.map((t) => [clock(t.at), t.text, t.area]), empty: "Nothing recorded.",
    ...(d.timelineLeft ? { more: d.timelineLeft, moreNote: "a very long shift — the first part is shown" } : {}),
  });
  if (d.timelineMore && !d.timelineLeft) blocks.push({ kind: "note", text: "A very long shift: the timeline shows its newest part." });
  blocks.push({ kind: "note", text: "An activity record from the hotel system, not a score: every figure is counted from this person's own records inside the shift's time. Payments are the ones they recorded; revenue and what is still owed are shown apart." });

  return {
    key: "staff", title: `Shift report — ${d.person.name}`, blurb: `${d.person.role} · ${d.shift.label} shift · ${clock(d.shift.startedAt)} → ${clock(d.shift.endedAt)} (${shiftDuration(d.shift.minutes)}).`,
    period: formatBusinessDate(d.shift.businessDate, true), from: d.shift.businessDate, to: d.shift.businessDate, days: 1, figures, blocks, share: "",
  };
}

// ───────────────────────── The boss's message ─────────────────────────

export function renderShiftReportText(d: ShiftReportData, hotelName: string, timezone: string, link?: string | null) {
  const clock = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(new Date(iso));
  const date = new Date(`${d.shift.businessDate}T00:00:00Z`).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" });
  const lines = [
    `*${hotelName.toUpperCase()}*`,
    "*Shift completed*",
    "",
    `*${d.person.name}* — ${d.person.role}`,
    `Business date: ${date}`,
    "",
    "*Shift:*",
    `${clock(d.shift.startedAt)} → ${clock(d.shift.endedAt)}`,
    `Duration: ${shiftDuration(d.shift.minutes)}`,
    d.shift.byManager ? `_Closed by ${d.shift.closedBy ?? "a manager"}${d.shift.closeReason ? ` — ${d.shift.closeReason}` : ""}_` : null,
    "",
    "*Performance:*",
    ...(d.headline.length ? d.headline.map((f) => `• ${factLine(f)}`) : ["• No recorded activity"]),
    ...d.handover.slice(0, 2).map((h) => `_${oneLine(h, 200)}_`),
  ];
  // The link always fits whole: the body is shortened first, the link goes last.
  const tail = link ? `\n\n*Full shift report:* ${link}` : "";
  return lines.filter((l) => l !== null).join("\n").replace(/\n{3,}/g, "\n\n").slice(0, 3500 - tail.length) + tail;
}

// ───────────────────────── Making, keeping and sending it ─────────────────────────

/** The boss's private link to one shift report (no sign-in; random, and it expires). */
export async function shiftReportLink(token: string) {
  try {
    const { siteOrigin } = await import("../site-origin");
    return `${await siteOrigin()}/shift-report/${token}`;
  } catch {
    const base = process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "");
    return base ? `${base}/shift-report/${token}` : null;
  }
}
const newToken = () => randomBytes(24).toString("base64url");
const json = (v: unknown) => v as Prisma.InputJsonValue;

/**
 * Make a closed shift's report — once. Called again (a double click, a retry, the scheduled run) it returns the report
 * already made. `regenerate` (MD / owner, with a reason) makes a new version and keeps the earlier one.
 */
export async function generateShiftReport(shiftId: string, opts: { regenerate?: { by: string; reason: string } } = {}) {
  const existing = await db.shiftReport.findUnique({ where: { shiftId } });
  if (existing && !opts.regenerate) return existing;
  const settings = await getSettings();
  const data = await buildShiftReportData(shiftId);
  const document = buildShiftDocument(data, settings.timezone);
  const expires = new Date(Date.now() + SHARE_DAYS * 86_400_000);
  try {
    const { report, made, prev } = await db.$transaction(async (tx) => {
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`shift-report:${shiftId}`}))::text`;
      const now = await tx.shiftReport.findUnique({ where: { shiftId } });
      // Made meanwhile by another run (the close and a click at once): that one is the report — nothing new to record.
      if (now && !opts.regenerate) return { report: now, made: false, prev: null };
      const token = now?.shareToken ?? newToken();
      const summaryText = renderShiftReportText(data, settings.hotelName, settings.timezone, await shiftReportLink(token));
      if (now) {
        await tx.shiftReportVersion.create({
          data: {
            shiftReportId: now.id, version: now.version, data: json(now.data), document: json(now.document), summaryText: now.summaryText,
            generatedAt: now.generatedAt, generatedBy: now.generatedBy, automatic: now.automatic, reason: now.reason, replacedBy: opts.regenerate!.by,
          },
        });
        const updated = await tx.shiftReport.update({
          where: { id: now.id },
          data: { data: json(data), document: json(document), summaryText, generatedAt: new Date(), generatedBy: opts.regenerate!.by, automatic: false, reason: opts.regenerate!.reason, version: now.version + 1, shareExpiresAt: expires },
        });
        return { report: updated, made: true, prev: now };
      }
      const created = await tx.shiftReport.create({ data: { shiftId, data: json(data), document: json(document), summaryText, generatedBy: "system", automatic: true, shareToken: token, shareExpiresAt: expires } });
      return { report: created, made: true, prev: null };
    });
    if (made) {
      await audit(db, { label: opts.regenerate?.by ?? "system" }, {
        action: prev ? "report.shift_regenerated" : "report.shift_generated", entityType: "ShiftReport", entityId: report.id,
        before: prev ? { version: prev.version, generatedBy: prev.generatedBy } : undefined,
        after: { shiftId, person: data.person.name, department: data.shift.department, version: report.version, reason: opts.regenerate?.reason ?? null },
      });
    }
    return report;
  } catch (e) {
    // Made at the same moment by another run — that one is the report.
    if (isUniqueViolation(e)) return db.shiftReport.findUniqueOrThrow({ where: { shiftId } });
    throw e;
  }
}

/** Send a shift report's message to the boss (the report recipients); a recipient already reached is not sent it again. */
export async function deliverShiftReport(reportId: string, opts: { force?: boolean; manual?: boolean; deadline?: number } = {}) {
  const report = await db.shiftReport.findUniqueOrThrow({ where: { id: reportId }, include: { deliveries: true } });
  // A person sends one made while sending was off: from now on it is a normal report.
  if (opts.manual && report.sendSkipped) await db.shiftReport.update({ where: { id: report.id }, data: { sendSkipped: false } });
  return deliverToRecipients({ link: { shiftReportId: report.id }, purpose: "SHIFT_REPORT", text: report.summaryText, generatedAt: report.generatedAt, deliveries: report.deliveries, force: opts.force, manual: opts.manual, deadline: opts.deadline });
}

/**
 * After a shift closes (run after the close is saved — never inside it): make the report, then send it. Nothing here
 * can undo or block the close; a failure is logged and the scheduled run tries again.
 */
export async function afterShiftClosed(shiftId: string, opts: { send?: boolean; deadline?: number } = {}) {
  try {
    const report = await generateShiftReport(shiftId);
    const settings = await getSettings();
    if (!settings.shiftReportEnabled) {
      // Sending is off: say so on the report, so it is not sent in a heap when sending is turned back on.
      if (!report.sendSkipped && !(await db.notificationDelivery.count({ where: { shiftReportId: report.id } }))) await db.shiftReport.update({ where: { id: report.id }, data: { sendSkipped: true } });
    } else if (opts.send !== false) await deliverShiftReport(report.id, { deadline: opts.deadline });
    return report;
  } catch (e) {
    console.error("[shift-report] could not make or send the report for shift", shiftId, e);
    return null;
  }
}

/**
 * The scheduled run: any closed shift of the last 3 days without its report gets it now (a report for a shift that ended
 * more than a day ago is made but not pushed to the boss), and a message that has not reached the boss yet is tried
 * again. It stops starting new work after `budgetMs`, leaving the rest for the next run — it never holds up the daily report.
 */
export async function retryShiftReports(now = new Date(), budgetMs = 20_000, sendBy?: number) {
  const t0 = Date.now();
  // Sends must finish before the run's own deadline (given by the cron), or this job's budget.
  const deadline = sendBy ?? t0 + budgetMs;
  const time = () => Date.now() - t0 < budgetMs;
  const since = new Date(now.getTime() - 3 * 86_400_000);
  const fresh = new Date(now.getTime() - 86_400_000);
  const missing = await db.actualShift.findMany({ where: { endedAt: { gte: since, lte: now }, report: null }, orderBy: { endedAt: "desc" }, select: { id: true, endedAt: true }, take: 50 });
  const handled = new Set<string>();
  let made = 0;
  for (const s of missing) {
    if (!time()) break;
    const r = await afterShiftClosed(s.id, { send: !!s.endedAt && s.endedAt >= fresh, deadline });
    if (r) { made += 1; handled.add(r.id); }
  }
  const settings = await getSettings();
  let resent = 0;
  if (settings.shiftReportEnabled) {
    const pending = await db.shiftReport.findMany({
      where: {
        generatedAt: { gte: since }, id: { notIn: [...handled] },
        OR: [{ deliveries: { none: {} }, sendSkipped: false, shift: { endedAt: { gte: fresh } } }, { deliveries: { some: { status: { in: ["PENDING", "FAILED"] }, attempts: { lt: MAX_ATTEMPTS } } } }],
      },
      orderBy: { generatedAt: "desc" }, select: { id: true }, take: 50,
    });
    for (const r of pending) {
      if (!time()) break;
      const out = await deliverShiftReport(r.id, { deadline }).catch((e) => { console.error("[shift-report] retry failed", r.id, e); return null; });
      if (out?.results.some((x) => x.status === "SENT" || x.status === "FAILED")) resent += 1;
    }
  }
  return { made, resent };
}

/** The boss's link: the report behind a valid, unexpired token (null otherwise). */
export async function shiftReportByToken(token: string, now = new Date()) {
  if (!/^[A-Za-z0-9_-]{24,64}$/.test(token)) return null;
  const r = await db.shiftReport.findUnique({ where: { shareToken: token }, select: { id: true, shiftId: true, document: true, data: true, version: true, generatedAt: true, generatedBy: true, automatic: true, shareExpiresAt: true } });
  if (!r) return null;
  return { ...r, expired: r.shareExpiresAt <= now };
}
