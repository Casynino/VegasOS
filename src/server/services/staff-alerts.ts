import "server-only";
import { inHouseGuestIds, isHotelOrder } from "@/server/desk";
import { db } from "../db";
import { worksWaiterShift } from "@/lib/permissions";
import { REQUEST_TYPE_LABEL } from "@/lib/request-meta";
import { HOTEL_QR_SOURCE, QR_PAY_ONLINE_NOTE } from "./booking-qr";
import { PAY_LATER_WHERE } from "./booking-holds";
import { guestNotifyConnected } from "./guest-notify";
import { spotName } from "@/components/restaurant/shell";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/translate";

/**
 * What is waiting for this staff member right now — by what they do (their permissions):
 * reception: new booking requests, Hotel QR bookings, new guest requests, payments to confirm; waiters: tables
 * asking for the bill, ready orders; the kitchen: new orders; managers: stock requests to review
 * and bought stock waiting for the final approval. The top-bar bell rings when something new
 * appears (and keeps ringing, when the manager chose "repeat", until handled).
 */
export type StaffAlertKind = "booking" | "request" | "payment" | "bill" | "order_new" | "order_ready" | "stock";
/** `text` is written in the person's own language; the bell drops the words before the first "— " (keep it in every language). */
export type StaffAlert = { id: string; kind: StaffAlertKind; text: string; href: string; at: string };

const place = (o: { tableLabel: string | null; roomNumber: string | null; type: string }, t: T) =>
  o.tableLabel != null ? spotName(o.tableLabel, t) : o.roomNumber ? t("Room {room}", { room: o.roomNumber }) : o.type === "TAKEAWAY" ? t("Takeaway") : o.type === "PICKUP" ? t("Pickup") : t("Restaurant");
const no = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;
const day = (d: Date, t: T) => d.toLocaleDateString(t.intl, { day: "numeric", month: "short", timeZone: "UTC" });
const tzs = (v: number) => `TZS ${v.toLocaleString("en-US")}`;

/**
 * Online bookings reception should know about (owner, 2026-10-05) — made straight into the reservations, so nothing
 * else rings for them: one booked to pay later on the Hotel QR or the website (not paid, room NOT held — whoever pays
 * first gets it), for a day after it was made; one from the QR paid online, for half an hour after nTZS confirmed it.
 * Each rings once (its id never changes) and leaves the list by itself.
 */
async function hotelQrBookings(now: Date, t: T) {
  const rows = await db.reservation.findMany({
    where: {
      OR: [
        { source: { code: { in: [HOTEL_QR_SOURCE, "WEBSITE"] } }, status: "INQUIRY", paidAmount: { lte: 0 }, createdAt: { gte: new Date(now.getTime() - 24 * 3_600_000) }, ...PAY_LATER_WHERE },
        // Made before the rule: reserved to pay at the hotel, held while it waits.
        { source: { code: HOTEL_QR_SOURCE }, status: "RESERVED", paidAmount: { lte: 0 }, mobilePayments: { none: { initiator: "CUSTOMER" } }, OR: [{ holdUntil: null }, { holdUntil: { gt: now } }] },
        { source: { code: HOTEL_QR_SOURCE }, status: "CONFIRMED", paidAmount: { gt: 0 }, confirmedAt: { gte: new Date(now.getTime() - 30 * 60_000) }, mobilePayments: { some: { initiator: "CUSTOMER", status: "COMPLETED" } } },
      ],
    },
    orderBy: { createdAt: "asc" }, take: 20,
    select: {
      id: true, status: true, createdAt: true, confirmedAt: true, arrivalDate: true, departureDate: true, internalNotes: true, source: { select: { code: true } },
      guest: { select: { fullName: true } }, rooms: { where: { status: { not: "CANCELLED" } }, select: { room: { select: { number: true } } } },
      guestMessages: { where: { type: { in: ["BOOKING_CREATED", "BOOKING_CONFIRMED"] }, status: "SENT" }, take: 1, select: { id: true } },
    },
  });
  // Still paying online (its payment request did not start): not a booking to act on yet.
  return rows.filter((r) => r.status === "CONFIRMED" || !r.internalNotes?.includes(QR_PAY_ONLINE_NOTE)).map((r) => {
    const paid = r.status === "CONFIRMED";
    const later = r.status === "INQUIRY";
    const rooms = r.rooms.map((x) => x.room.number).join(", ");
    // Without a messaging provider nothing reaches the guest by itself: reception sends the details (one tap on the booking).
    const unsent = !r.guestMessages.length && (!guestNotifyConnected() || now.getTime() - r.createdAt.getTime() > 2 * 60_000);
    return {
      id: `hotelqr:${r.id}:${paid ? "paid" : later ? "later" : "hotel"}`, kind: "booking" as const, href: `/staff/reservations/${r.id}`, at: (paid ? r.confirmedAt ?? r.createdAt : r.createdAt).toISOString(),
      text: [
        r.source.code === HOTEL_QR_SOURCE ? t("Hotel QR booking — {name}", { name: r.guest.fullName }) : t("Website booking — {name}", { name: r.guest.fullName }),
        ...(rooms ? [t("Room {room}", { room: rooms })] : []),
        `${day(r.arrivalDate, t)} → ${day(r.departureDate, t)}`,
        paid ? t("paid online") : later ? t("not paid · room not held") : t("pay at hotel"),
        ...(unsent ? [t("booking details not sent yet")] : []),
      ].join(" · "),
    };
  });
}

export async function staffAlerts(perms: ReadonlySet<string>, userId: string | null = null): Promise<StaffAlert[]> {
  const has = (p: string) => perms.has(p);
  // Written in this person's language (English without a request — jobs and tests).
  const t = await getT();
  // A waiter hears their own orders and tables (and the ones nobody has yet); everyone else (the restaurant screen, managers) hears all.
  const mine = !!userId && worksWaiterShift(perms);
  const [bookings, qrBookings, requests, payments, bills, fresh, ready, stock] = await Promise.all([
    has("booking_requests.view") ? db.bookingRequest.findMany({ where: { status: "NEW" }, orderBy: { createdAt: "asc" }, take: 20, select: { id: true, fullName: true, checkInDate: true, checkOutDate: true, createdAt: true } }) : [],
    has("reservations.view") ? hotelQrBookings(new Date(), t) : [],
    // New requests ring for everyone who handles them; one given to a person rings for them until they accept it.
    has("requests.view") || has("requests.manage") ? db.serviceRequest.findMany({
      where: { OR: [{ status: "NEW" }, ...(userId ? [{ status: "ASSIGNED" as const, assignedToId: userId }] : [])] }, orderBy: { createdAt: "asc" }, take: 20,
      select: { id: true, type: true, status: true, source: true, createdAt: true, updatedAt: true, room: { select: { number: true } } },
    }) : [],
    has("restaurant.payments.confirm") ? db.restaurantOrderPayment.findMany({ where: { status: "POSTED", confirmedAt: null }, orderBy: { collectedAt: "asc" }, take: 20, select: { id: true, amount: true, collectedAt: true, order: { select: { number: true, tableLabel: true, roomNumber: true, type: true, reservationId: true, settlement: true, source: true, guestId: true } } } }) : [],
    has("restaurant.orders") || has("restaurant.serve") ? db.diningSession.findMany({ where: { status: "AWAITING_PAYMENT", ...(mine ? { OR: [{ waiterId: userId }, { waiterId: null }] } : {}) }, orderBy: { billRequestedAt: "asc" }, take: 20, select: { id: true, billRequestedAt: true, startedAt: true, guestId: true, members: { select: { guestId: true } }, location: { select: { name: true } }, guest: { select: { fullName: true } } } }) : [],
    has("kitchen.orders") ? db.restaurantOrder.findMany({ where: { status: "PENDING" }, orderBy: { createdAt: "asc" }, take: 30, select: { id: true, number: true, tableLabel: true, roomNumber: true, type: true, createdAt: true } }) : [],
    has("restaurant.serve") ? db.restaurantOrder.findMany({ where: { status: "READY", ...(mine ? { OR: [{ assignedToId: userId }, { assignedToId: null }] } : {}) }, orderBy: { readyAt: "asc" }, take: 30, select: { id: true, number: true, tableLabel: true, roomNumber: true, type: true, readyAt: true, createdAt: true, assignedToId: true } }) : [],
    // The latest step to "waiting" is when it arrived — a request sent again, or a corrected purchase, rings again.
    has("expenses.approve") ? db.stockRequest.findMany({
      // A purchase someone bought is not rung to them when the MD requires another approver.
      where: {
        status: { in: ["SUBMITTED", "PENDING_APPROVAL"] },
        ...(userId && (await db.hotelSettings.findFirst({ select: { purchaseApproverMustDiffer: true } }))?.purchaseApproverMustDiffer
          ? { NOT: { status: "PENDING_APPROVAL", purchasedById: userId } } : {}),
      },
      orderBy: [{ urgent: "desc" }, { createdAt: "asc" }], take: 20,
      select: {
        id: true, number: true, purchaseNumber: true, status: true, urgent: true, department: true, purchaseTotal: true, createdAt: true,
        inventoryDepartment: { select: { name: true } }, _count: { select: { items: { where: { removedAt: null } } } },
        events: { where: { toStatus: { in: ["SUBMITTED", "PENDING_APPROVAL"] } }, orderBy: { at: "desc" }, take: 1, select: { at: true } },
      },
    }) : [],
  ]);
  // Reception hears the HOTEL's tables and payments only (guests staying now) — the rest is the restaurant's (owner, 2026-10-04).
  const desk = perms.has("dashboard.front_desk") && !["dashboard.manager", "dashboard.owner", "dashboard.admin"].some((p) => perms.has(p));
  const inHouse = desk ? await inHouseGuestIds() : null;
  const hotelBills = inHouse ? bills.filter((s) => [s.guestId, ...s.members.map((m) => m.guestId)].some((g) => !!g && inHouse.has(g))) : bills;
  const hotelPayments = inHouse ? payments.filter((p) => isHotelOrder(p.order, inHouse)) : payments;
  return [
    ...bookings.map((b) => ({ id: `booking:${b.id}`, kind: "booking" as const, text: t("New booking request — {name} · {from} → {to}", { name: b.fullName, from: day(b.checkInDate, t), to: day(b.checkOutDate, t) }), href: "/staff/booking-requests", at: b.createdAt.toISOString() })),
    ...qrBookings,
    ...requests.map((r) => ({
      // The time it last came back to waiting is in the id: a request put back to New (a shift ended) rings again.
      id: `request:${r.id}:${r.status}:${r.updatedAt.getTime()}`, kind: "request" as const, href: "/staff/requests", at: (r.status === "ASSIGNED" ? r.updatedAt : r.createdAt).toISOString(),
      text: `${(r.status === "ASSIGNED" ? t("Given to you — {type}", { type: t(REQUEST_TYPE_LABEL[r.type] ?? "Request") }) : r.source === "STAFF" ? t("Guest request — {type}", { type: t(REQUEST_TYPE_LABEL[r.type] ?? "Request") }) : t("The guest asks — {type}", { type: t(REQUEST_TYPE_LABEL[r.type] ?? "Request") }))}${r.room ? ` · ${t("Room {room}", { room: r.room.number })}` : ""}`,
    })),
    ...hotelPayments.map((p) => ({ id: `payment:${p.id}`, kind: "payment" as const, text: t("Payment to confirm — {no} · {place} · {amount}", { no: no(p.order.number), place: place(p.order, t), amount: tzs(p.amount) }), href: "/staff/restaurant", at: p.collectedAt.toISOString() })),
    ...hotelBills.map((s) => ({ id: `bill:${s.id}:${s.billRequestedAt?.getTime() ?? 0}`, kind: "bill" as const, text: t("{table} asked for the bill — {name}", { table: spotName(s.location.name, t), name: s.guest.fullName }), href: "/staff/restaurant/tables", at: (s.billRequestedAt ?? s.startedAt).toISOString() })),
    ...fresh.map((o) => ({ id: `order_new:${o.id}`, kind: "order_new" as const, text: t("New order {no} · {place}", { no: no(o.number), place: place(o, t) }), href: "/staff/restaurant", at: o.createdAt.toISOString() })),
    ...ready.map((o) => ({ id: `order_ready:${o.id}`, kind: "order_ready" as const, text: `${t("Order ready {no} · {place}", { no: no(o.number), place: place(o, t) })}${o.assignedToId ? "" : ` · ${t("no waiter yet")}`}`, href: "/staff/restaurant", at: (o.readyAt ?? o.createdAt).toISOString() })),
    ...stock.map((r) => {
      const at = r.events[0]?.at ?? r.createdAt;
      const dept = r.inventoryDepartment?.name ?? r.department;
      // The bell's list drops the words before "—", so what to do (review / approve) comes after it.
      const text = r.status === "PENDING_APPROVAL"
        ? `${t("Stock request — approve purchase {number} · {department}", { number: r.purchaseNumber ?? r.number, department: t(dept) })}${r.purchaseTotal ? ` · ${tzs(r.purchaseTotal)}` : ""}`
        : `${t("Stock request — review {number} · {department} · {items}", { number: r.number, department: t(dept), items: t.plural(r._count.items, "{n} item", "{n} items") })}${r.urgent ? ` · ${t("urgent")}` : ""}`;
      return { id: `stock:${r.id}:${r.status}:${at.getTime()}`, kind: "stock" as const, text, href: "/staff/stock-requests", at: at.toISOString() };
    }),
  ];
}
