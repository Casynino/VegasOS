import "server-only";
import type { Prisma } from "@/generated/prisma/client";
import { db, type Tx } from "../db";
import { AppError } from "../errors";
import { audit, type AuditActor } from "../audit";
import { companyPays } from "@/lib/billing";
import { IN_SERVICE, sessionMoney, sessionNo } from "./dining-core";
import { CHARGE_ORDER, orderHeading, orderNo } from "./stays";

export interface GuestInput {
  id?: string | null;
  fullName: string;
  phone?: string | null;
  email?: string | null;
  idType?: string | null;
  idNumber?: string | null;
  nationality?: string | null;
  address?: string | null;
  notes?: string | null;
  /** Staff confirmed this is a different person with the same phone / email: save a new customer. */
  createNew?: boolean;
}

/** Normalise Tanzanian/international numbers: "0710 223 344" → "+255710223344". */
export function normalizePhone(value?: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/[^\d+]/g, "");
  if (!digits) return null;
  if (digits.startsWith("+")) return digits;
  if (digits.startsWith("00")) return `+${digits.slice(2)}`;
  if (digits.startsWith("0") && digits.length === 10) return `+255${digits.slice(1)}`;
  if (digits.startsWith("255")) return `+${digits}`;
  return digits;
}

/**
 * Use the given guest, or match an existing guest by phone/email, or create
 * one. Matching only fills blank fields — it never overwrites stored ID data.
 */
export async function resolveGuest(tx: Tx, input: GuestInput): Promise<string> {
  const phone = normalizePhone(input.phone);
  const email = input.email?.trim().toLowerCase() || null;
  const clean = {
    fullName: input.fullName.trim(),
    phone,
    email,
    idType: input.idType?.trim() || null,
    idNumber: input.idNumber?.trim() || null,
    nationality: input.nationality?.trim() || null,
    address: input.address?.trim() || null,
    notes: input.notes?.trim() || null,
  };
  if (!clean.fullName) throw new AppError("Guest name is required.", "VALIDATION", { "guest.fullName": "Required" });

  let existing = input.id ? await tx.guest.findUnique({ where: { id: input.id } }) : null;
  if (input.id && !existing) throw new AppError("Guest not found.", "NOT_FOUND");
  if (!existing && !input.createNew && (phone || email)) {
    // One customer per number: two phones scanning the same number at once must not make twins.
    if (phone) await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`guest-phone:${phone}`}))::text`;
    // Their main number first, then their second number, then their email.
    existing = (phone ? await tx.guest.findFirst({ where: { deletedAt: null, phone }, orderBy: { updatedAt: "desc" } }) : null)
      ?? (phone ? await tx.guest.findFirst({ where: { deletedAt: null, altPhone: phone }, orderBy: { updatedAt: "desc" } }) : null)
      ?? (email ? await tx.guest.findFirst({ where: { deletedAt: null, email }, orderBy: { updatedAt: "desc" } }) : null);
  }
  if (!existing) {
    const created = await tx.guest.create({ data: clean });
    return created.id;
  }
  const fill: Record<string, string> = {};
  for (const [k, v] of Object.entries(clean)) {
    if (v && !existing[k as keyof typeof existing]) fill[k] = v;
  }
  if (input.id && clean.fullName !== existing.fullName) fill.fullName = clean.fullName; // explicit edit by staff
  // Saved as "Restaurant customer" / "Table guest" before: their real name replaces it.
  if (!input.id && isPlaceholderName(existing.fullName) && !isPlaceholderName(clean.fullName)) fill.fullName = clean.fullName;
  if (Object.keys(fill).length) await tx.guest.update({ where: { id: existing.id }, data: fill });
  return existing.id;
}

/** Names saved when the customer gave only a number (a table QR, a quick order). */
const PLACEHOLDER_NAMES = new Set(["restaurant customer", "table guest", "customer", "guest"]);
export const isPlaceholderName = (name: string | null | undefined) => !name || PLACEHOLDER_NAMES.has(name.trim().toLowerCase());

/**
 * A customer's stays in the hotel right now — as the one who booked, or as a guest sharing the
 * room. This is how a table knows its customer has Room 305 (worked out when needed, never
 * stored, so it is right even when the room was booked after the meal), and the only rooms a
 * waiter may put that customer's bill on. `foodPayer`: a company or group pays their food.
 */
export async function activeStaysFor(client: Tx | typeof db, guestIds: (string | null | undefined)[]) {
  const ids = [...new Set(guestIds.filter((x): x is string => !!x))];
  if (!ids.length) return [];
  const rs = await client.reservation.findMany({
    where: { status: "CHECKED_IN", OR: [{ guestId: { in: ids } }, { guests: { some: { guestId: { in: ids } } } }] },
    orderBy: { arrivalDate: "desc" },
    select: {
      id: true, reference: true, guestId: true, billTo: true, companyCovers: true,
      guest: { select: { fullName: true } }, guests: { select: { guestId: true } },
      corporateCustomer: { select: { companyName: true } }, group: { select: { name: true } },
      rooms: { where: { status: "CHECKED_IN" }, orderBy: { room: { number: "asc" } }, select: { room: { select: { number: true } } } },
    },
  });
  return rs.map((r) => ({
    id: r.id, reference: r.reference, rooms: r.rooms.map((x) => x.room.number).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(", "), guestName: r.guest.fullName,
    guestIds: [r.guestId, ...r.guests.map((g) => g.guestId)],
    foodPayer: !companyPays(r.billTo, r.companyCovers, "FOOD") ? null
      : r.billTo === "GROUP" ? `The group${r.group ? ` ${r.group.name}` : ""} pays` : `${r.corporateCustomer?.companyName ?? "The company"} pays`,
  }));
}
export type ActiveStay = Awaited<ReturnType<typeof activeStaysFor>>[number];

/** What staff see when they type a number: who it is — enough to greet them, never their private details. */
export type KnownCustomer = {
  id: string; name: string; reference: string | null; vip: boolean; stays: number; orders: number; lastVisit: string | null; room: string | null;
  /** The table they are at right now, if any. */
  table: string | null;
  /** Their stays now — the only rooms a waiter may put their bill on. */
  staying: { id: string; rooms: string; guestName: string; foodPayer: string | null }[];
};

/**
 * The phone number is the customer's key: whoever booked a room, ordered food or sat at a
 * table with this number before. Null for a number we have never seen (a new customer).
 */
export async function customerByPhone(phone: string): Promise<KnownCustomer | null> {
  const p = normalizePhone(phone);
  if (!p || p.replace(/\D/g, "").length < 9) return null;
  const g = await db.guest.findFirst({
    where: { deletedAt: null, OR: [{ phone: p }, { altPhone: p }] }, orderBy: { updatedAt: "desc" },
    select: {
      id: true, reference: true, fullName: true, vip: true,
      _count: { select: { reservations: { where: { status: { in: ["CHECKED_IN", "CHECKED_OUT"] } } }, restaurantOrders: { where: { status: { not: "CANCELLED" } } } } },
      reservations: { where: { status: { in: ["CHECKED_IN", "CHECKED_OUT"] } }, orderBy: { departureDate: "desc" }, take: 3, select: { status: true, departureDate: true, rooms: { where: { status: "CHECKED_IN" }, select: { room: { select: { number: true } } } } } },
      restaurantOrders: { where: { status: { not: "CANCELLED" } }, orderBy: { createdAt: "desc" }, take: 1, select: { createdAt: true } },
      diningSessions: { where: { openAtId: { not: null } }, take: 1, select: { location: { select: { name: true } } } },
      diningMemberships: { where: { session: { openAtId: { not: null } } }, take: 1, select: { session: { select: { location: { select: { name: true } } } } } },
    },
  });
  if (!g) return null;
  const stays = await activeStaysFor(db, [g.id]);
  const lastStay = g.reservations.find((r) => r.status === "CHECKED_OUT")?.departureDate.toISOString().slice(0, 10) ?? null;
  const lastOrder = g.restaurantOrders[0]?.createdAt.toISOString().slice(0, 10) ?? null;
  return {
    id: g.id, name: g.fullName, reference: g.reference, vip: g.vip, stays: g._count.reservations, orders: g._count.restaurantOrders,
    lastVisit: [lastStay, lastOrder].filter((d): d is string => !!d).sort().at(-1) ?? null,
    room: stays.map((x) => x.rooms).filter(Boolean).join(", ") || null,
    table: g.diningSessions[0]?.location.name ?? g.diningMemberships[0]?.session.location.name ?? null,
    staying: stays.map((x) => ({ id: x.id, rooms: x.rooms, guestName: x.guestName, foodPayer: x.foodPayer })),
  };
}

/**
 * A customer staff picked in the search (CustomerFinder): that very person — even when someone else
 * shares the number. A number given now fills a blank one. Null when they are gone (fall back to the phone).
 */
export async function pickedCustomerTx(tx: Tx | typeof db, id: string | null | undefined, phone?: string | null): Promise<string | null> {
  if (!id) return null;
  const g = await tx.guest.findFirst({ where: { id, deletedAt: null }, select: { id: true, phone: true } });
  if (!g) return null;
  const p = normalizePhone(phone);
  if (p && !g.phone) await tx.guest.update({ where: { id: g.id }, data: { phone: p } });
  return g.id;
}

/** Everyone staying in the hotel now (the booker and the people on the booking), with their rooms — reception books for them. */
export async function stayingGuests() {
  const rs = await db.reservation.findMany({
    where: { status: "CHECKED_IN" },
    select: { guest: { select: { id: true, fullName: true, phone: true } }, guests: { select: { guest: { select: { id: true, fullName: true, phone: true } } } }, rooms: { where: { status: "CHECKED_IN" }, select: { room: { select: { number: true } } } } },
  });
  return rs.flatMap((r) => {
    const rooms = r.rooms.map((x) => x.room.number).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(", ");
    return [r.guest, ...r.guests.map((g) => g.guest)].map((g) => ({ id: g.id, name: g.fullName, phone: g.phone, rooms }));
  }).filter((g, i, all) => all.findIndex((x) => x.id === g.id) === i).sort((a, b) => a.rooms.localeCompare(b.rooms, undefined, { numeric: true }));
}

/** One line in the customer search: enough to pick the right person (staff who take orders see customers anyway). */
export type CustomerHit = { id: string; name: string; phone: string | null; vip: boolean; reference: string | null; room: string | null; table: string | null };

/** What is worth searching: two letters of a name, or three digits of a phone number. */
export function customerSearchTerm(raw: string) {
  const q = raw.trim().slice(0, 60);
  // "0712…" / "+255 712…" / "255712…" all search the same national digits.
  const digits = q.replace(/\D/g, "").replace(/^(?:00)?255|^0/, "");
  const letters = q.replace(/[\d\s+().-]/g, "");
  return { q, digits: digits.length >= 3 ? digits.slice(0, 12) : "", name: letters.length >= 2 ? q : "" };
}

/**
 * Find customers by part of the name or the phone number — for the Sell screen, seating a table and
 * reservations: tap one and their phone and name are filled in. The closest names come first.
 */
export async function findCustomers(raw: string, take = 6): Promise<CustomerHit[]> {
  // A customer reference (G-A1B2C3, or its hex part with a letter in it) is searched as a reference only —
  // its digits are not a phone number. All digits ("712345") may be either: both are searched.
  const t = raw.trim();
  const gRef = /^g-?([0-9a-f]{4,6})$/i.exec(t)?.[1];
  const hexRef = !gRef && /^[0-9a-f]{4,6}$/i.test(t) ? t : null;
  const ref = (gRef ?? hexRef)?.toUpperCase() ?? null;
  const term = customerSearchTerm(raw);
  const name = gRef ? "" : term.name;
  const digits = gRef || (hexRef && /[a-f]/i.test(hexRef)) ? "" : term.digits;
  if (!name && !digits && !ref) return [];
  const OR: Prisma.GuestWhereInput[] = [
    ...(name ? [{ fullName: { contains: name, mode: "insensitive" as const } }] : []),
    ...(digits ? [{ phone: { contains: digits } }, { altPhone: { contains: digits } }] : []),
    ...(ref ? [{ reference: { contains: ref } }] : []),
  ];
  const rows = await db.guest.findMany({
    where: { deletedAt: null, OR }, orderBy: { updatedAt: "desc" }, take: 25,
    select: {
      id: true, fullName: true, phone: true, altPhone: true, vip: true, reference: true,
      reservations: { where: { status: "CHECKED_IN" }, take: 2, select: { rooms: { where: { status: "CHECKED_IN" }, select: { room: { select: { number: true } } } } } },
      diningSessions: { where: { openAtId: { not: null } }, take: 1, select: { location: { select: { name: true } } } },
    },
  });
  const lower = name.toLowerCase();
  // Closest first: the name starts with what they typed, then a word in it does, then the rest (newest first).
  const rank = (n: string) => !lower ? 0 : n.toLowerCase().startsWith(lower) ? 0 : n.toLowerCase().split(/\s+/).some((w) => w.startsWith(lower)) ? 1 : 2;
  return rows
    // Their reference typed → them first.
    .map((g, i) => ({ g, i, r: ref && g.reference?.toUpperCase().includes(ref) ? -1 : rank(g.fullName) }))
    .sort((a, b) => a.r - b.r || a.i - b.i)
    .slice(0, take)
    .map(({ g }) => ({
      id: g.id, name: g.fullName, vip: g.vip, reference: g.reference,
      // The number that matched (a second number only when it is the one they typed).
      phone: digits && !g.phone?.includes(digits) && g.altPhone?.includes(digits) ? g.altPhone : g.phone ?? g.altPhone,
      room: g.reservations.flatMap((r) => r.rooms.map((x) => x.room.number)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(", ") || null,
      table: g.diningSessions[0]?.location.name ?? null,
    }));
}

/** What a customer has with us — a customer with any of it keeps their records when removed. */
export async function customerFootprint(id: string) {
  const c = await db.guest.findUnique({
    where: { id },
    select: { _count: { select: {
      reservations: true, reservationGuests: true, groupsContact: true, invoices: true, restaurantOrders: true, diningSessions: true,
      diningMemberships: true, tableReservations: true, trips: true, serviceRequests: true, bookingRequests: true,
    } } },
  });
  if (!c) throw new AppError("Customer not found.", "NOT_FOUND");
  const n = c._count;
  const history = n.reservations + n.reservationGuests + n.groupsContact + n.invoices + n.restaurantOrders + n.diningSessions + n.diningMemberships + n.tableReservations + n.trips + n.serviceRequests;
  return { stays: n.reservations + n.reservationGuests, orders: n.restaurantOrders, tables: n.diningSessions + n.diningMemberships + n.tableReservations, history, requests: n.bookingRequests };
}

/**
 * Remove a customer (reception, waiters, managers, admin). Nothing on record: deleted for good. Stays, orders or
 * payments on record: those stay in the books, but the customer's name, numbers and details are
 * wiped and they leave every list and lookup — their number becomes free for someone new.
 */
export async function removeCustomer(id: string, actor: AuditActor & { permissions?: ReadonlySet<string> }) {
  if (!actor.permissions?.has("guests.delete")) throw new AppError("You cannot remove customers.", "FORBIDDEN");
  const g = await db.guest.findUnique({ where: { id } });
  if (!g || g.deletedAt) throw new AppError("Customer not found.", "NOT_FOUND");
  const open = await db.guest.findUnique({ where: { id }, select: {
    reservations: { where: { status: { in: ["RESERVED", "CONFIRMED", "CHECKED_IN"] } }, select: { reference: true }, take: 1 },
    diningSessions: { where: { openAtId: { not: null } }, select: { id: true }, take: 1 },
  } });
  if (open?.reservations.length) throw new AppError(`They have a booking that is still open (${open.reservations[0].reference}) — finish or cancel it first.`, "CONFLICT");
  if (open?.diningSessions.length) throw new AppError("They are at a table right now — clear the table first.", "CONFLICT");
  const f = await customerFootprint(id);
  const snapshot = { fullName: g.fullName, phone: g.phone, altPhone: g.altPhone, email: g.email, reference: g.reference };
  return db.$transaction(async (tx) => {
    if (f.history === 0) {
      await tx.bookingRequest.updateMany({ where: { guestId: id }, data: { guestId: null } });
      await tx.guestMessage.deleteMany({ where: { guestId: id } });
      await tx.guest.delete({ where: { id } });
      await audit(tx, actor, { action: "guest.deleted", entityType: "Guest", entityId: id, before: snapshot });
      return { deleted: true as const };
    }
    await tx.guest.update({
      where: { id },
      data: {
        deletedAt: new Date(), fullName: "Removed customer", phone: null, altPhone: null, email: null, idType: null, idNumber: null, nationality: null,
        address: null, notes: null, preferences: null, dateOfBirth: null, preferredChannel: null, marketingConsent: false, marketingConsentAt: null, vip: false, tags: [],
      },
    });
    await audit(tx, actor, { action: "guest.removed", entityType: "Guest", entityId: id, before: snapshot, after: { kept: f } });
    return { deleted: false as const };
  });
}

// ───────────────────────── One customer's whole history ─────────────────────────
// Its own imports here, so the code above stays as it was.

const tzs = (n: number) => `TZS ${n.toLocaleString("en-US")}`;

/** Where an order was served: the table, the room, take out or the counter. */
const orderPlace = (o: { type: string; roomNumber: string | null; tableLabel: string | null; location: { name: string } | null }) =>
  o.location?.name ?? o.tableLabel ?? (o.type === "ROOM_SERVICE" && o.roomNumber ? `Room ${o.roomNumber}` : o.type === "TAKEAWAY" ? "Take out" : o.type === "PICKUP" ? "Pick up" : "Counter");

/**
 * Where an order's bill is, in plain words: on a room ("On Room 305's bill"), paid, waiting for
 * reception to confirm the money, or still to pay. `tone` colours it on screen.
 */
export function orderBilling(o: { type: string; settlement: string; paymentStatus: string; roomNumber: string | null; total: number; paidAmount: number }) {
  if (o.settlement === "ROOM") return { text: o.roomNumber ? `On Room ${o.roomNumber}'s bill` : "On a room bill", tone: "room" as const };
  if (o.paymentStatus === "PAID") return { text: o.type === "ROOM_SERVICE" ? "Paid now — not on the room" : "Paid at the restaurant", tone: "paid" as const };
  if (o.paymentStatus === "PENDING_CONFIRMATION") return { text: "Waiting for reception", tone: "waiting" as const };
  return { text: `Unpaid · ${tzs(Math.max(0, o.total - o.paidAmount))}`, tone: "due" as const };
}
export type OrderBilling = ReturnType<typeof orderBilling>;

/** The kinds a customer's room bills are split into — room nights first. */
export const CHARGE_BUCKETS = ["Room nights", "Restaurant", "Room service", "Transport", "Other"] as const;
export type ChargeBucket = (typeof CHARGE_BUCKETS)[number];

/** Which kind a room-bill line is: food from a table or the counter, room service, transport or other. */
function chargeBucket(c: { kind: string; category: string | null; restaurantOrder: { type: string } | null }): ChargeBucket {
  if (c.restaurantOrder) return c.restaurantOrder.type === "ROOM_SERVICE" ? "Room service" : "Restaurant";
  if (c.kind === "ROOM_SERVICE" || c.category === "ROOM_SERVICE_FEE") return "Room service";
  if (c.kind === "TRANSPORT" || c.category === "TRANSPORT") return "Transport";
  if (["RESTAURANT", "BAR"].includes(c.category ?? "") || ["RESTAURANT", "BAR"].includes(c.kind)) return "Restaurant";
  return "Other";
}

/**
 * One customer's whole history with us — to read, nothing changes:
 *  - their stays: booked by them, or sharing a room someone else booked (marked, with who booked it);
 *  - their visits to our tables (the last 10), each with its money: paid here, on a room, still due;
 *  - their restaurant orders and their room-service orders (kept apart), each with where its bill went;
 *  - payments in two groups, never added together: on the room bills of stays they booked
 *    (reversals and refunds marked) and paid at the restaurant — sales records are never listed;
 *  - what was charged to the stays they booked, by kind. A restaurant order on a room is
 *    restaurant income; the room is only where it is collected — so it is counted once, there.
 * `roomMoney: false` (a waiter) leaves out room-bill payments and charges: they never see them.
 */
export async function customerHistory(guestId: string, opts: { roomMoney?: boolean } = {}) {
  const roomMoney = opts.roomMoney ?? true;
  // Their orders: as the customer, or on a room they booked.
  const theirs = { OR: [{ guestId }, { reservation: { guestId } }] };
  const ordersOf = (roomService: boolean) => db.restaurantOrder.findMany({
    where: { ...theirs, status: { not: "CANCELLED" }, type: roomService ? "ROOM_SERVICE" : { not: "ROOM_SERVICE" } },
    orderBy: { createdAt: "desc" }, take: 15,
    select: {
      id: true, number: true, type: true, status: true, settlement: true, paymentStatus: true, total: true, paidAmount: true, createdAt: true,
      roomNumber: true, tableLabel: true, guestId: true, customerName: true,
      location: { select: { name: true } }, session: { select: { number: true } }, items: { select: { quantity: true } },
    },
  });
  const countOf = (roomService: boolean) => db.restaurantOrder.count({ where: { ...theirs, status: { not: "CANCELLED" }, type: roomService ? "ROOM_SERVICE" : { not: "ROOM_SERVICE" } } });
  const stayed = { in: ["CHECKED_IN" as const, "CHECKED_OUT" as const] };

  const [stays, sessions, restaurant, roomService, restaurantCount, roomServiceCount, restaurantPayments, roomPayments, charges, nights, active] = await Promise.all([
    db.reservation.findMany({
      where: { OR: [{ guestId }, { guests: { some: { guestId } } }] }, orderBy: { arrivalDate: "desc" }, take: 20,
      select: {
        id: true, reference: true, kind: true, status: true, arrivalDate: true, departureDate: true, billTo: true, netAmount: true, balanceAmount: true,
        guestId: true, guest: { select: { fullName: true } },
        rooms: { where: { status: { not: "CANCELLED" } }, orderBy: { room: { number: "asc" } }, select: { room: { select: { number: true } } } },
      },
    }),
    db.diningSession.findMany({
      where: { status: { not: "CANCELLED" }, OR: [{ guestId }, { members: { some: { guestId } } }] }, orderBy: { startedAt: "desc" }, take: 10,
      select: {
        id: true, number: true, openAtId: true, startedAt: true, guestCount: true, guestId: true, guest: { select: { fullName: true } }, location: { select: { name: true } },
        orders: { select: { status: true, settlement: true, total: true, paidAmount: true, reservationId: true } },
      },
    }),
    ordersOf(false), ordersOf(true), countOf(false), countOf(true),
    db.restaurantOrderPayment.findMany({
      where: { order: theirs }, orderBy: { collectedAt: "desc" }, take: 15,
      select: {
        id: true, amount: true, status: true, reference: true, collectedAt: true, confirmedAt: true, reverseReason: true, account: { select: { name: true } },
        order: { select: { id: true, number: true, type: true, roomNumber: true, tableLabel: true, location: { select: { name: true } } } },
      },
    }),
    roomMoney ? db.payment.findMany({
      where: { reservation: { guestId } }, orderBy: { receivedAt: "desc" }, take: 15,
      select: { id: true, kind: true, status: true, amount: true, receivedAt: true, reference: true, reversalReason: true, method: { select: { name: true } }, reservation: { select: { id: true, reference: true } } },
    }) : Promise.resolve([]),
    roomMoney ? db.reservationCharge.findMany({
      where: { isVoided: false, reservation: { guestId, status: { notIn: ["CANCELLED", "NO_SHOW", "INQUIRY"] } } }, orderBy: { createdAt: "desc" },
      select: {
        id: true, description: true, amount: true, kind: true, category: true, createdAt: true, restaurantOrderId: true, reservation: { select: { id: true, reference: true } },
        restaurantOrder: CHARGE_ORDER,
      },
    }) : Promise.resolve([]),
    roomMoney ? db.reservation.aggregate({ where: { guestId, status: stayed }, _sum: { grossAmount: true, discountAmount: true } }) : Promise.resolve(null),
    activeStaysFor(db, [guestId]),
  ]);

  const orderView = (o: (typeof restaurant)[number]) => ({
    id: o.id, number: orderNo(o.number), at: o.createdAt, place: orderPlace(o), visit: o.session ? sessionNo(o.session.number) : null,
    items: o.items.reduce((t, i) => t + i.quantity, 0), total: o.total, cooking: IN_SERVICE.includes(o.status), billing: orderBilling(o),
    // On a room they booked, but ordered by someone else (a friend at the table).
    forOther: o.guestId && o.guestId !== guestId ? o.customerName ?? "another customer" : null,
  });

  // Room bills by kind: room nights from the stay itself, every other line by what it was for.
  const buckets = Object.fromEntries(CHARGE_BUCKETS.map((b) => [b, 0])) as Record<ChargeBucket, number>;
  buckets["Room nights"] = Math.max(0, (nights?._sum.grossAmount ?? 0) - (nights?._sum.discountAmount ?? 0));
  type Line = { key: string; at: Date; label: string; bucket: ChargeBucket; amount: number; stay: string; stayId: string; orderId: string | null };
  const lines = new Map<string, Line>();
  for (const c of charges) {
    const bucket = chargeBucket(c);
    buckets[bucket] += c.amount;
    // One line per order — "Restaurant — Outside 3 · Order #184" — its items are on the room bill itself.
    const key = c.restaurantOrderId ?? c.id;
    const line = lines.get(key);
    if (line) { line.amount += c.amount; continue; }
    lines.set(key, {
      key, at: c.createdAt, bucket, amount: c.amount, stay: c.reservation.reference, stayId: c.reservation.id, orderId: c.restaurantOrderId,
      label: c.restaurantOrder ? orderHeading(c.restaurantOrder) : c.description,
    });
  }

  const open = sessions.find((s) => s.openAtId);
  return {
    /** Right now: the rooms they are staying in, and the table they are at. */
    now: {
      stays: active,
      table: open ? {
        name: open.location.name, visit: sessionNo(open.number), since: open.startedAt, withName: open.guestId !== guestId ? open.guest.fullName : null, money: sessionMoney(open.orders),
        // What of this table went on THEIR room(s) — a friend's orders on the friend's own room are not theirs.
        onTheirRoom: open.orders.filter((o) => o.status !== "CANCELLED" && o.settlement === "ROOM" && active.some((x) => x.id === o.reservationId)).reduce((t, o) => t + o.total, 0),
      } : null,
    },
    stays: stays.map((r) => ({
      id: r.id, reference: r.reference, kind: r.kind, status: r.status, arrival: r.arrivalDate, departure: r.departureDate, billTo: r.billTo,
      net: r.netAmount, balance: r.balanceAmount, rooms: r.rooms.map((x) => x.room.number).join(", "),
      // Sharing a room someone else booked: it is that person's bill, not theirs.
      bookedBy: r.guestId !== guestId ? r.guest.fullName : null,
    })),
    tables: sessions.map((s) => ({
      id: s.id, visit: sessionNo(s.number), table: s.location.name, at: s.startedAt, open: !!s.openAtId, people: s.guestCount,
      withName: s.guestId !== guestId ? s.guest.fullName : null, money: sessionMoney(s.orders),
    })),
    restaurant: { count: restaurantCount, orders: restaurant.map(orderView) },
    roomService: { count: roomServiceCount, orders: roomService.map(orderView) },
    payments: {
      room: roomPayments.map((p) => ({
        id: p.id, at: p.receivedAt, amount: p.amount, refund: p.kind === "REFUND", reversed: p.status === "REVERSED", why: p.reversalReason,
        how: p.method.name, reference: p.reference, stay: p.reservation?.reference ?? null, stayId: p.reservation?.id ?? null,
      })),
      restaurant: restaurantPayments.map((p) => ({
        id: p.id, at: p.collectedAt, amount: p.amount, reversed: p.status !== "POSTED", why: p.reverseReason, account: p.account.name, reference: p.reference,
        confirmed: !!p.confirmedAt, order: orderNo(p.order.number), orderId: p.order.id, place: orderPlace(p.order),
      })),
    },
    charges: roomMoney ? { buckets, total: Object.values(buckets).reduce((a, b) => a + b, 0), lines: [...lines.values()].slice(0, 15) } : null,
  };
}
export type CustomerHistory = Awaited<ReturnType<typeof customerHistory>>;
