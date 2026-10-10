import "server-only";
import { db } from "../db";
import { buildReport } from "./reports";
import type { DailyReportData } from "./daily-report";
import { businessRangeBounds, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { formatBusinessDate, formatTZS } from "@/lib/format";
import type { Block, Cell, Figure, Report } from "@/lib/report-types";
import { msg } from "@/i18n/msg";
import { day as hotelDay, mergeBooks, textBook, word } from "@/lib/report-i18n";

const TZ = "Africa/Dar_es_Salaam";
const tzs = (v: number) => formatTZS(v);
const num = (v: number) => v.toLocaleString("en-US");
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const clock = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(d);
const noBrackets = (s: string) => s.replace(/\s*\(.*\)/, "");
const TRIP: Record<string, string> = { AIRPORT_PICKUP: msg("Airport pickup"), AIRPORT_DROPOFF: msg("Airport drop-off"), HOTEL_TRANSFER: msg("Transfer"), GUEST_TRANSPORT: msg("Guest transport"), OTHER: msg("Other") };
const TRIP_STATUS: Record<string, string> = { REQUESTED: msg("Requested"), CONFIRMED: msg("Confirmed"), ASSIGNED: msg("Driver set"), EN_ROUTE: msg("On the way"), PICKED_UP: msg("Picked up"), COMPLETED: msg("Completed"), CANCELLED: msg("Cancelled"), NO_SHOW: msg("No-show") };
const ROOM_STATE: Record<string, string> = { AVAILABLE: msg("Available"), READY: msg("Ready"), RESERVED: msg("Reserved"), OCCUPIED: msg("Occupied"), DIRTY: msg("To clean"), CLEANING: msg("Cleaning"), MAINTENANCE: msg("Maintenance"), OUT_OF_SERVICE: msg("Out of service") };
const STAY: Record<string, string> = { RESERVED: msg("Expected"), CONFIRMED: msg("Expected"), CHECKED_IN: msg("In house"), CHECKED_OUT: msg("Left"), NO_SHOW: msg("No-show"), CANCELLED: msg("Cancelled") };

/** Blocks of an existing report whose titles are listed (in that order). */
function pick(r: Report, titles: string[]) {
  return titles.map((t) => r.blocks.find((b) => "title" in b && b.title === t)).filter((b): b is Block => !!b);
}
const asGlance = (title: string, figures: Figure[]): Block => ({ kind: "highlights", title, items: figures.map((f) => ({ label: f.label, value: f.value, sub: f.sub })) });

/**
 * The Boss's daily business report as one document (frozen with the day's snapshot): the executive
 * figures, what needs attention, plain facts about the day, then money (revenue ≠ money in ≠ owed),
 * rooms (room by room), guests, bookings, the restaurant & bar, tables, best sellers, the meeting
 * room, transport, the staff and the expenses. Every figure comes from the same services as Finance.
 */
export async function buildDailyDocument(date: BusinessDate, d: DailyReportData): Promise<Report> {
  const range = { from: date, to: date };
  const bounds = businessRangeBounds(date, date);
  const at = { gte: bounds.start, lt: bounds.end };
  const day = toDbDate(date);
  const [restaurant, items, payments, outstanding, tables, rooms, staff, voids, expenses] = await Promise.all(
    (["restaurant", "items", "payments", "outstanding", "tables", "rooms", "staff", "voids", "expenses"] as const).map((k) => buildReport(k, range, date)),
  );
  const [nights, roomsNow, arrivals, departures, newCustomers, bookedToday, orderedToday, trips, deliveredBy, readyBy, collectedBy, toConfirm, reversals, failed] = await Promise.all([
    db.roomNight.findMany({
      where: { businessDate: day, reservationRoom: { status: { in: ["CHECKED_IN", "CHECKED_OUT"] } } },
      select: { roomId: true, netAmount: true, isDayUse: true, reservationRoom: { select: { reservation: { select: { guest: { select: { fullName: true } }, companyName: true } } } } },
    }),
    db.room.findMany({ where: { isActive: true }, select: { id: true, number: true, status: true, roomType: { select: { name: true, category: true } } } }),
    db.reservationRoom.findMany({
      where: { arrivalDate: day, status: { notIn: ["CANCELLED", "INQUIRY"] }, roomType: { category: "GUEST_ROOM" } }, orderBy: { startAt: "asc" },
      select: { status: true, room: { select: { number: true } }, reservation: { select: { reference: true, guest: { select: { fullName: true } }, source: { select: { name: true } } } } },
    }),
    db.reservationRoom.findMany({
      where: { departureDate: day, status: { in: ["CHECKED_IN", "CHECKED_OUT"] }, roomType: { category: "GUEST_ROOM" } }, orderBy: { endAt: "asc" },
      select: { status: true, room: { select: { number: true } }, reservation: { select: { reference: true, balanceAmount: true, guest: { select: { fullName: true } } } } },
    }),
    db.guest.count({ where: { createdAt: at, deletedAt: null } }),
    db.reservation.findMany({ where: { businessDate: day }, select: { guestId: true, guest: { select: { createdAt: true } } } }),
    db.restaurantOrder.findMany({ where: { businessDate: day, status: { not: "CANCELLED" }, guestId: { not: null } }, select: { guestId: true, guest: { select: { createdAt: true } } } }),
    db.transportTrip.findMany({ where: { businessDate: day }, orderBy: { pickupAt: "asc" }, select: { reference: true, type: true, status: true, passengerName: true, pickupAt: true, destination: true, charge: true, paidAt: true, reservationId: true } }),
    db.restaurantOrder.groupBy({ by: ["deliveredById"], where: { businessDate: day, deliveredById: { not: null } }, _count: true }),
    db.restaurantOrder.groupBy({ by: ["readyById"], where: { businessDate: day, readyById: { not: null } }, _count: true }),
    db.restaurantOrderPayment.groupBy({ by: ["collectedById"], where: { collectedAt: at, status: "POSTED", collectedById: { not: null } }, _sum: { amount: true }, _count: true }),
    db.restaurantOrderPayment.aggregate({ where: { status: "POSTED", confirmedAt: null }, _sum: { amount: true }, _count: true }),
    db.payment.aggregate({ where: { status: "REVERSED", OR: [{ reversalBusinessDate: day }, { reversalBusinessDate: null, businessDate: day }] }, _sum: { amount: true }, _count: true }),
    db.notificationDelivery.count({ where: { status: "FAILED", updatedAt: at } }),
  ]);

  // Every sentence with values is kept with them, to say the report again in the reader's language.
  const { book, L } = textBook();
  /** "3 orders" / "1 order" as a word inside a sentence. */
  const n_ = (n: number, one: string, other: string) => word(n === 1 ? one : other, { n: num(n) });
  const P = (n: number, one: string, other: string) => L("{x}", { x: n_(n, one, other) });

  // ── Executive figures ──
  const guestRooms = roomsNow.filter((r) => r.roomType.category === "GUEST_ROOM");
  const guestRoomIds = new Set(guestRooms.map((r) => r.id));
  const soldNights = nights.filter((n) => guestRoomIds.has(n.roomId) && !n.isDayUse).length;
  const net = d.profitLoss.estimated;
  const figures: Figure[] = [
    { label: msg("Revenue (earned)"), value: tzs(d.revenue.total), raw: d.revenue.total, tone: "gold", sub: msg("every department, net") },
    { label: msg("Payments collected"), value: tzs(d.money.collected), raw: d.money.collected, tone: "emerald", sub: msg("money actually received") },
    { label: msg("Outstanding"), value: tzs(d.money.outstanding), raw: d.money.outstanding, tone: d.money.outstanding ? "amber" : undefined, sub: msg("owed to the hotel, all dates") },
    { label: msg("Expenses"), value: tzs(d.expenses.total), raw: d.expenses.total, tone: "rose", sub: P(d.expenses.byCategory.length, msg("{n} category"), msg("{n} categories")) },
    { label: msg("Net operating result"), value: `${net < 0 ? "− " : ""}${tzs(Math.abs(net))}`, raw: net, tone: net >= 0 ? "emerald" : "rose", sub: msg("revenue − expenses (not full profit)") },
    { label: msg("Occupancy"), value: `${d.hotel.occupancy}%`, raw: d.hotel.occupancy, tone: "violet", sub: L(msg("{n} of {total} guest rooms"), { n: soldNights, total: guestRooms.length }) },
  ];

  // ── Attention: only real things ──
  const leftOwing = departures.filter((x) => x.status === "CHECKED_OUT" && x.reservation.balanceAmount > 0);
  const cancelledOrders = voids.figures.find((f) => f.label === "Cancelled orders");
  const attention = [
    ...d.attention,
    ...(leftOwing.length ? [L(msg("{guests} checked out still owing {amount}"), { guests: n_(leftOwing.length, msg("{n} guest"), msg("{n} guests")), amount: tzs(leftOwing.reduce((t, x) => t + x.reservation.balanceAmount, 0)) })] : []),
    ...(reversals._count ? [L(msg("{payments} reversed today ({amount})"), { payments: n_(reversals._count, msg("{n} payment"), msg("{n} payments")), amount: tzs(reversals._sum.amount ?? 0) })] : []),
    ...(d.revenue.refunds ? [L(msg("Refunds given: {amount}"), { amount: tzs(d.revenue.refunds) })] : []),
    ...(cancelledOrders?.raw ? [L(msg("{orders} cancelled ({detail})"), { orders: n_(cancelledOrders.raw, msg("{n} restaurant order"), msg("{n} restaurant orders")), detail: word(cancelledOrders.sub ?? "") })] : []),
    ...(toConfirm._count ? [L(msg("{payments} ({amount}) waiting for reception to confirm"), { payments: n_(toConfirm._count, msg("{n} waiter payment"), msg("{n} waiter payments")), amount: tzs(toConfirm._sum.amount ?? 0) })] : []),
    ...d.expenses.highValue.map((e) => L(msg("Large expense: {category} — {description} ({amount})"), { category: word(e.category), description: e.description, amount: tzs(e.amount) })),
    ...(failed ? [L(msg("{messages} failed to send today"), { messages: n_(failed, msg("{n} message"), msg("{n} messages")) })] : []),
  ];

  // ── Plain facts (never reasons we cannot know) ──
  const food = restaurant.figures.find((f) => f.label === "Orders");
  const fnb = d.revenue.restaurant + d.revenue.bar + (d.revenue.roomService ?? 0);
  const insights = [
    d.rooms?.adr
      ? L(msg("{n} of {total} guest rooms were occupied — {pct}% occupancy, at an average of {rate} a room."), { n: soldNights, total: guestRooms.length, pct: d.hotel.occupancy, rate: tzs(d.rooms.adr) })
      : L(msg("{n} of {total} guest rooms were occupied — {pct}% occupancy."), { n: soldNights, total: guestRooms.length, pct: d.hotel.occupancy }),
    L(msg("Rooms earned {rooms} ({roomsPct}% of revenue); the restaurant & bar {fnb} ({fnbPct}%)."), { rooms: tzs(d.revenue.roomNet), roomsPct: pct(d.revenue.roomNet, d.revenue.total), fnb: tzs(fnb), fnbPct: pct(fnb, d.revenue.total) }),
    L(msg("{received} was received today; {owed} is still owed to the hotel across guests, companies and orders."), { received: tzs(d.money.collected), owed: tzs(d.money.outstanding) }),
    food?.raw
      ? food.sub ? L(msg("The restaurant & bar had {orders} ({detail})."), { orders: n_(food.raw, msg("{n} order"), msg("{n} orders")), detail: word(food.sub) }) : L(msg("The restaurant & bar had {orders}."), { orders: n_(food.raw, msg("{n} order"), msg("{n} orders")) })
      : msg("The restaurant & bar had no orders."),
    L(msg("{checkIns} and {checkOuts}; {bookings} made; {inHouse} bookings in house."), {
      checkIns: n_(d.guests.checkIns, msg("{n} check-in"), msg("{n} check-ins")), checkOuts: n_(d.guests.checkOuts, msg("{n} check-out"), msg("{n} check-outs")),
      bookings: n_(d.guests.newBookings, msg("{n} new booking"), msg("{n} new bookings")), inHouse: num(d.guests.inHouse),
    }),
    d.expenses.total ? L(msg("{amount} was spent, most on {category} ({top})."), { amount: tzs(d.expenses.total), category: word(d.expenses.byCategory[0]?.name ?? "—"), top: tzs(d.expenses.byCategory[0]?.amount ?? 0) }) : msg("No expenses were recorded."),
  ];

  // ── Guests ──
  const returning = new Set([...bookedToday, ...orderedToday].filter((x) => x.guestId && x.guest && x.guest.createdAt < bounds.start).map((x) => x.guestId!)).size;

  // ── Room by room ──
  const roomRows = guestRooms.concat(roomsNow.filter((r) => r.roomType.category !== "GUEST_ROOM"))
    .map((r) => {
      const mine = nights.filter((n) => n.roomId === r.id);
      const who = mine[0]?.reservationRoom.reservation;
      return { r, earned: mine.reduce((t, n) => t + n.netAmount, 0), guest: who ? who.companyName ?? who.guest.fullName : null, nights: mine.filter((n) => !n.isDayUse).length, short: mine.some((n) => n.isDayUse) };
    })
    .filter((x) => x.earned > 0 || x.r.status === "OCCUPIED")
    .sort((a, b) => b.earned - a.earned || a.r.number.localeCompare(b.r.number, undefined, { numeric: true }));

  // ── Staff by role ──
  const users = await db.user.findMany({ select: { id: true, fullName: true, role: { select: { name: true } } } });
  const staffRows = users.map((u) => {
    const p = d.people?.find((x) => x.name === u.fullName);
    const del = deliveredBy.find((x) => x.deliveredById === u.id)?._count ?? 0;
    const ready = readyBy.find((x) => x.readyById === u.id)?._count ?? 0;
    const col = collectedBy.find((x) => x.collectedById === u.id);
    return { name: noBrackets(u.fullName), role: u.role.name, checkIns: p?.checkIns ?? 0, checkOuts: p?.checkOuts ?? 0, bookings: p?.bookings ?? 0, money: p?.payments ?? 0, ready, del, collected: col?._sum.amount ?? 0, expenses: p?.expenses ?? 0 };
  }).filter((x) => x.checkIns + x.checkOuts + x.bookings + x.money + x.ready + x.del + x.collected + x.expenses > 0)
    .sort((a, b) => a.role.localeCompare(b.role) || b.money - a.money);

  const tripsDone = trips.filter((t) => t.status === "COMPLETED");
  const blocks: Block[] = [
    ...(attention.length ? [{ kind: "list", title: msg("Attention required"), items: attention, tone: "attention" } as Block] : []),
    { kind: "list", title: msg("The day in plain facts"), items: insights, tone: "insight" },
    {
      kind: "highlights", title: msg("At a glance"),
      items: [
        { label: msg("Rooms sold"), value: num(d.hotel.roomsSold), sub: L("{x}", { x: word(d.hotel.roomNights === 1 ? msg("{n} night") : msg("{n} nights"), { n: d.hotel.roomNights }) }) },
        { label: msg("New bookings"), value: num(d.guests.newBookings), sub: L(msg("{cancelled} cancelled · {noShows} no-show"), { cancelled: d.guests.cancellations, noShows: d.guests.noShows }) },
        { label: msg("Check-ins · outs"), value: `${d.guests.checkIns} · ${d.guests.checkOuts}` },
        { label: msg("Restaurant (food)"), value: tzs(d.revenue.restaurant), sub: food?.raw ? P(food.raw, msg("{n} order"), msg("{n} orders")) : msg("no orders") },
        { label: msg("Bar (drinks)"), value: tzs(d.revenue.bar) },
        { label: msg("Room service fees"), value: tzs(d.revenue.roomService ?? 0) },
        { label: msg("Meeting room"), value: tzs(d.revenue.meeting), sub: d.meetingRoom ? L("{x}", { x: word(d.meetingRoom.bookings === 1 ? msg("{n} booking") : msg("{n} bookings"), { n: d.meetingRoom.bookings }) }) : undefined },
        { label: msg("Transport"), value: tzs(d.revenue.transport ?? 0), sub: L(msg("{trips} completed"), { trips: n_(tripsDone.length, msg("{n} trip"), msg("{n} trips")) }) },
      ],
    },

    { kind: "section", title: msg("Money"), subtitle: msg("Revenue is what the hotel earned today · payments are money actually received · outstanding is what is still owed") },
    {
      kind: "statement", title: msg("Revenue recognised"), subtitle: msg("Earned on this hotel day"), half: true,
      rows: [
        { label: msg("Rooms (before discounts)"), value: d.revenue.roomGross },
        { label: msg("Less room discounts"), value: -d.revenue.roomDiscounts, style: "less" },
        { label: msg("Rooms (net)"), value: d.revenue.roomNet, style: "sub" },
        { label: msg("Restaurant (food)"), value: d.revenue.restaurant }, { label: msg("Bar (drinks)"), value: d.revenue.bar },
        { label: msg("Room service fees"), value: d.revenue.roomService ?? 0 }, { label: msg("Meeting room"), value: d.revenue.meeting },
        { label: msg("Transport"), value: d.revenue.transport ?? 0 }, { label: msg("Other services"), value: d.revenue.other },
        { label: msg("Less refunds"), value: -d.revenue.refunds, style: "less" },
        { label: msg("Total revenue"), value: d.revenue.total, style: "total" },
        { label: msg("Less expenses"), value: -d.expenses.total, style: "less" },
        { label: msg("Net operating result"), value: net, style: "grand" },
      ],
    },
    {
      kind: "bars", title: msg("Revenue · collected · owed"), subtitle: msg("Three different things — never added together"), money: true, half: true, noTotal: true,
      items: [
        { label: msg("Revenue earned today"), value: d.revenue.total, color: "#c9a24a" },
        { label: msg("Payments collected today"), value: d.money.collected, color: "#10b981" },
        { label: msg("Outstanding (all dates)"), value: d.money.outstanding, color: "#f43f5e" },
      ],
    },
    ...pick(payments, ["By payment method", "By account (where the money is)", "Collected by"]),
    ...pick(outstanding, ["Where the money is owed"]),
    ...pick(expenses, ["By category", "Every expense"]),

    { kind: "section", title: msg("Rooms & guests"), subtitle: msg("Guest rooms only — the meeting room is reported on its own") },
    {
      kind: "highlights", title: msg("Rooms now and today"),
      items: [
        { label: msg("Guest rooms"), value: num(guestRooms.length) },
        { label: msg("Occupied"), value: num(guestRooms.filter((r) => r.status === "OCCUPIED").length) },
        { label: msg("Reserved · arriving"), value: num(guestRooms.filter((r) => r.status === "RESERVED").length) },
        { label: msg("Available"), value: num(guestRooms.filter((r) => r.status === "AVAILABLE" || r.status === "READY").length) },
        { label: msg("Cleaning"), value: num(guestRooms.filter((r) => r.status === "DIRTY" || r.status === "CLEANING").length) },
        { label: msg("Maintenance · out of service"), value: `${guestRooms.filter((r) => r.status === "MAINTENANCE").length} · ${guestRooms.filter((r) => r.status === "OUT_OF_SERVICE").length}` },
        { label: msg("Average room rate"), value: d.rooms?.adr ? tzs(d.rooms.adr) : "—" },
        { label: msg("Room revenue"), value: tzs(d.revenue.roomNet), sub: d.rooms?.companyCredit ? L(msg("{amount} on company credit"), { amount: tzs(d.rooms.companyCredit) }) : undefined },
      ],
    },
    {
      kind: "table", title: msg("Room by room"), subtitle: msg("Rooms that earned today or have a guest now"), empty: msg("No room earned anything today."),
      columns: [{ label: msg("Room") }, { label: msg("Type") }, { label: msg("Status now") }, { label: msg("Guest") }, { label: msg("Nights"), align: "right" }, { label: msg("Revenue"), align: "right", money: true }],
      rows: roomRows.map((x) => [x.r.number, x.r.roomType.name, ROOM_STATE[x.r.status] ?? x.r.status, x.guest ?? "—", x.short ? msg("short time") : x.nights, x.earned]),
      foot: roomRows.length ? [msg("Total"), "", "", "", roomRows.reduce((t, x) => t + x.nights, 0), roomRows.reduce((t, x) => t + x.earned, 0)] : undefined,
    },
    {
      kind: "table", title: msg("Arrivals"), subtitle: L(msg("{due} due · {checkedIn} checked in"), { due: arrivals.length, checkedIn: arrivals.filter((a) => a.status === "CHECKED_IN" || a.status === "CHECKED_OUT").length }), half: true, empty: msg("No arrivals were due."),
      columns: [{ label: msg("Guest") }, { label: msg("Room") }, { label: msg("Source"), muted: true }, { label: msg("Status") }],
      rows: arrivals.map((a) => [a.reservation.guest.fullName, a.room?.number ?? "—", a.reservation.source.name, STAY[a.status] ?? a.status]),
    },
    {
      kind: "table", title: msg("Departures"), subtitle: L(msg("{n} due to leave"), { n: departures.length }), half: true, empty: msg("No departures were due."),
      columns: [{ label: msg("Guest") }, { label: msg("Room") }, { label: msg("Status") }, { label: msg("Balance"), align: "right", money: true }],
      rows: departures.map((x) => [x.reservation.guest.fullName, x.room?.number ?? "—", x.status === "CHECKED_OUT" ? msg("Left") : msg("Still in (overdue)"), x.reservation.balanceAmount]),
    },
    {
      kind: "highlights", title: msg("Customers"),
      items: [
        { label: msg("In house now"), value: num(d.guests.inHouse), sub: msg("guest bookings") },
        { label: msg("Guests staying owe"), value: tzs(d.money.inHouseOutstanding ?? 0), sub: L("{x}", { x: word(d.money.inHouseOwing === 1 ? msg("{n} guest") : msg("{n} guests"), { n: d.money.inHouseOwing ?? 0 }) }) },
        { label: msg("New customers"), value: num(newCustomers), sub: msg("first time today") },
        { label: msg("Returning customers"), value: num(returning), sub: msg("booked or ordered again") },
      ],
    },
    ...pick(rooms, ["Where bookings come from", "Room types"]),

    { kind: "section", title: msg("Restaurant & bar"), subtitle: msg("Orders placed today (cancelled left out)") },
    asGlance("The restaurant in figures", restaurant.figures),
    ...pick(restaurant, ["Food and drinks", "By kind of order", "Where the orders came from", "How they are paid", "Room service orders"]),
    ...pick(tables, ["Every table"]),
    ...pick(items, ["Top 10 by sales"]),

    { kind: "section", title: msg("Meeting room & transport") },
    {
      kind: "highlights", title: msg("Meeting room"),
      items: d.meetingRoom ? [
        { label: msg("Bookings"), value: num(d.meetingRoom.bookings), sub: L(msg("{n} completed"), { n: d.meetingRoom.completed }) },
        { label: msg("Hours used"), value: L(msg("{n} h"), { n: d.meetingRoom.bookedHours }), sub: L(msg("{pct}% of open hours"), { pct: d.meetingRoom.utilisation }) },
        { label: msg("Revenue"), value: tzs(d.meetingRoom.revenue) },
        { label: msg("Cancelled · no-shows"), value: `${d.meetingRoom.cancelled} · ${d.meetingRoom.noShows}` },
      ] : [{ label: msg("Meeting room"), value: msg("No meeting room set up") }],
    },
    {
      kind: "table", title: msg("Transport"), subtitle: L(msg("{trips} · {done} completed · revenue {amount}"), { trips: n_(trips.length, msg("{n} trip"), msg("{n} trips")), done: tripsDone.length, amount: tzs(d.revenue.transport ?? 0) }), empty: msg("No transport today."),
      columns: [{ label: msg("Trip") }, { label: msg("Time") }, { label: msg("Passenger") }, { label: msg("To"), muted: true }, { label: msg("Status") }, { label: msg("Charge"), align: "right", money: true }, { label: msg("Billing"), muted: true }],
      rows: trips.map((t) => [TRIP[t.type] ?? t.type, clock(t.pickupAt), t.passengerName, t.destination, TRIP_STATUS[t.status] ?? t.status, t.charge ?? 0, t.reservationId ? msg("Room bill") : t.paidAt ? msg("Paid") : t.charge ? msg("Not paid") : msg("Free")] as Cell[]),
    },

    ...(d.stores || d.assets || d.operations ? storesBlocks(d, L) : []),

    { kind: "section", title: msg("Staff & records"), subtitle: msg("What each person did — an activity record, not a score") },
    ...(d.shifts?.length ? [{
      kind: "table" as const, title: msg("Shifts"), subtitle: msg("Who worked the day — each shift has its own report (Staff shifts in the app)"),
      columns: [{ label: msg("Name") }, { label: msg("Role"), muted: true }, { label: msg("Department") }, { label: msg("Started") }, { label: msg("Ended") }, { label: msg("Duration"), align: "right" as const }, { label: msg("Report"), muted: true }],
      rows: d.shifts.map((x) => [x.name, x.role, x.department === "RESTAURANT" ? msg("Restaurant") : msg("Reception"), x.start, x.end ?? msg("on shift"), `${Math.floor(x.minutes / 60)}h ${String(x.minutes % 60).padStart(2, "0")}m`, x.reportId ? msg("Made") : x.end ? msg("Being made") : msg("At the end")] as Cell[]),
    }] : []),
    {
      kind: "table", title: msg("Staff activity"), empty: msg("No staff activity recorded."),
      columns: [{ label: msg("Name") }, { label: msg("Role"), muted: true }, { label: msg("Check-ins"), align: "right" }, { label: msg("Check-outs"), align: "right" }, { label: msg("Bookings"), align: "right" }, { label: msg("Orders prepared"), align: "right" }, { label: msg("Orders served"), align: "right" }, { label: msg("Money recorded"), align: "right", money: true }, { label: msg("Waiter collected"), align: "right", money: true }],
      rows: staffRows.map((x) => [x.name, x.role, x.checkIns, x.checkOuts, x.bookings, x.ready, x.del, x.money, x.collected]),
    },
    ...pick(staff, ["Work by person"]),
    ...(voids.figures.some((f) => f.raw) ? [asGlance("Cancellations & voids", voids.figures)] : []),
    { kind: "note", text: L(msg("Hotel day {date} 04:00 → next day 04:00. Revenue is counted when earned (room nights night by night; food, drinks and extras when sold or put on a room bill). Payments collected are money in (payments and on-the-spot sales, less refunds). Outstanding is everything still owed at the time of the report. The net operating result is revenue less recorded expenses — it is not a full profit (no salaries, depreciation or tax unless recorded as expenses)."), { date: hotelDay(date) }) },
  ];

  return {
    key: "summary", title: msg("Daily business report"), blurb: msg("Everything that happened in the hotel on this business day — made automatically."),
    period: formatBusinessDate(date, true), from: date, to: date, days: 1, figures, blocks,
    share: "",
    // The day's own sentences, the attention lines from the day's figures and whatever the picked parts keep.
    i18n: mergeBooks(d.i18n, ...[restaurant, items, payments, outstanding, tables, rooms, staff, voids, expenses].map((r) => r.i18n), book),
  };
}

/** Stores (consumable stock), assets and how the operation ran — for reports from Oct 2026. */
function storesBlocks(d: DailyReportData, L: ReturnType<typeof textBook>["L"]): Block[] {
  const s = d.stores, a = d.assets, o = d.operations;
  const tzs = (v: number) => `TZS ${Math.round(v).toLocaleString("en-US")}`;
  const blocks: Block[] = [{ kind: "section", title: msg("Stores, assets & operations"), subtitle: msg("Stock received and used, waste, alerts — the hotel's equipment — and where the day ran late") }];
  if (s) {
    blocks.push({
      kind: "highlights", title: msg("Stores today"),
      items: [
        { label: msg("Stock received"), value: tzs(s.receivedValue), sub: L("{x}", { x: word(s.receivedLines === 1 ? msg("{n} delivery") : msg("{n} deliveries"), { n: s.receivedLines }) }) },
        { label: msg("Stock used"), value: tzs(s.usedValue), sub: s.soldValue
          ? L(msg("{items} · {amount} by recipes"), { items: word(s.usedItems === 1 ? msg("{n} item") : msg("{n} items"), { n: s.usedItems }), amount: tzs(s.soldValue) })
          : L("{x}", { x: word(s.usedItems === 1 ? msg("{n} item") : msg("{n} items"), { n: s.usedItems }) }) },
        { label: msg("Waste"), value: tzs(s.wasteValue), sub: s.pendingWaste
          ? L(msg("{records} · {n} waiting"), { records: word(s.wasteLines === 1 ? msg("{n} record") : msg("{n} records"), { n: s.wasteLines }), n: s.pendingWaste })
          : L("{x}", { x: word(s.wasteLines === 1 ? msg("{n} record") : msg("{n} records"), { n: s.wasteLines }) }) },
        { label: msg("Low · out of stock"), value: `${s.low} · ${s.out}`, sub: s.value ? L(msg("stock worth {amount}"), { amount: tzs(s.value) }) : undefined },
        ...(s.countDifferenceValue ? [{ label: msg("Count corrections"), value: `${s.countDifferenceValue < 0 ? "−" : "+"}${tzs(Math.abs(s.countDifferenceValue))}`, sub: msg("physical count vs system") }] : []),
      ],
    });
    if (s.topUsed.length) blocks.push({ kind: "table", title: msg("Used most"), subtitle: msg("By value, including what the dishes sold took"), columns: [{ label: msg("Item") }, { label: msg("Used"), align: "right" }, { label: msg("Value"), align: "right", money: true }], rows: s.topUsed.map((u) => [u.name, u.qty, u.value]), empty: msg("Nothing used.") });
    const alerts = [...s.outItems.map((x) => L(msg("Out of stock: {item}"), { item: x })), ...s.lowItems.map((x) => L(msg("Low: {item}"), { item: x }))];
    if (alerts.length) blocks.push({ kind: "list", title: msg("Stock to buy"), items: alerts.slice(0, 12), tone: "attention" });
  }
  if (a) {
    blocks.push({
      kind: "highlights", title: msg("Assets"),
      items: [
        { label: msg("Assets on record"), value: String(a.records) },
        { label: msg("Moved today"), value: String(a.moved) },
        { label: msg("Under repair"), value: String(a.underRepair) },
        { label: msg("Out of order"), value: String(a.outOfOrder) },
      ],
    });
    if (a.needsAttention.length) blocks.push({ kind: "list", title: msg("Equipment needing attention"), items: a.needsAttention.map((x) => L(x.location ? "{name} ({code}) — {location} · {status}" : "{name} ({code}) · {status}", { name: x.name, code: x.code, ...(x.location ? { location: word(x.location) } : {}), status: word(x.status.toLowerCase().replace(/_/g, " ")) })), tone: "attention" });
  }
  if (o) {
    blocks.push({
      kind: "highlights", title: msg("Operations"),
      items: [
        { label: msg("Late restaurant orders"), value: String(o.delayedOrders), sub: msg("over 25 min to prepare") },
        { label: msg("Rooms waiting for cleaning"), value: String(o.roomsWaitingCleaning), sub: msg("at report time") },
        { label: msg("Maintenance issues"), value: String(o.maintenanceIssues), sub: msg("rooms and equipment") },
        { label: msg("Waiter money to confirm"), value: String(o.paymentsToConfirm), sub: msg("not confirmed by reception") },
      ],
    });
  }
  return blocks;
}
