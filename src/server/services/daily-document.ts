import "server-only";
import { db } from "../db";
import { buildReport } from "./reports";
import type { DailyReportData } from "./daily-report";
import { businessRangeBounds, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { formatBusinessDate, formatTZS } from "@/lib/format";
import type { Block, Cell, Figure, Report } from "@/lib/report-types";

const TZ = "Africa/Dar_es_Salaam";
const tzs = (v: number) => formatTZS(v);
const num = (v: number) => v.toLocaleString("en-US");
const plural = (n: number, w: string, many = `${w}s`) => `${num(n)} ${n === 1 ? w : many}`;
const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 100) : 0);
const clock = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(d);
const noBrackets = (s: string) => s.replace(/\s*\(.*\)/, "");
const TRIP: Record<string, string> = { AIRPORT_PICKUP: "Airport pickup", AIRPORT_DROPOFF: "Airport drop-off", HOTEL_TRANSFER: "Transfer", GUEST_TRANSPORT: "Guest transport", OTHER: "Other" };
const TRIP_STATUS: Record<string, string> = { REQUESTED: "Requested", CONFIRMED: "Confirmed", ASSIGNED: "Driver set", EN_ROUTE: "On the way", PICKED_UP: "Picked up", COMPLETED: "Completed", CANCELLED: "Cancelled", NO_SHOW: "No-show" };
const ROOM_STATE: Record<string, string> = { AVAILABLE: "Available", READY: "Ready", RESERVED: "Reserved", OCCUPIED: "Occupied", DIRTY: "To clean", CLEANING: "Cleaning", MAINTENANCE: "Maintenance", OUT_OF_SERVICE: "Out of service" };
const STAY: Record<string, string> = { RESERVED: "Expected", CONFIRMED: "Expected", CHECKED_IN: "In house", CHECKED_OUT: "Left", NO_SHOW: "No-show", CANCELLED: "Cancelled" };

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

  // ── Executive figures ──
  const guestRooms = roomsNow.filter((r) => r.roomType.category === "GUEST_ROOM");
  const guestRoomIds = new Set(guestRooms.map((r) => r.id));
  const soldNights = nights.filter((n) => guestRoomIds.has(n.roomId) && !n.isDayUse).length;
  const net = d.profitLoss.estimated;
  const figures: Figure[] = [
    { label: "Revenue (earned)", value: tzs(d.revenue.total), raw: d.revenue.total, tone: "gold", sub: "every department, net" },
    { label: "Payments collected", value: tzs(d.money.collected), raw: d.money.collected, tone: "emerald", sub: "money actually received" },
    { label: "Outstanding", value: tzs(d.money.outstanding), raw: d.money.outstanding, tone: d.money.outstanding ? "amber" : undefined, sub: "owed to the hotel, all dates" },
    { label: "Expenses", value: tzs(d.expenses.total), raw: d.expenses.total, tone: "rose", sub: `${plural(d.expenses.byCategory.length, "category", "categories")}` },
    { label: "Net operating result", value: `${net < 0 ? "− " : ""}${tzs(Math.abs(net))}`, raw: net, tone: net >= 0 ? "emerald" : "rose", sub: "revenue − expenses (not full profit)" },
    { label: "Occupancy", value: `${d.hotel.occupancy}%`, raw: d.hotel.occupancy, tone: "violet", sub: `${soldNights} of ${guestRooms.length} guest rooms` },
  ];

  // ── Attention: only real things ──
  const leftOwing = departures.filter((x) => x.status === "CHECKED_OUT" && x.reservation.balanceAmount > 0);
  const cancelledOrders = voids.figures.find((f) => f.label === "Cancelled orders");
  const attention = [
    ...d.attention,
    ...(leftOwing.length ? [`${plural(leftOwing.length, "guest")} checked out still owing ${tzs(leftOwing.reduce((t, x) => t + x.reservation.balanceAmount, 0))}`] : []),
    ...(reversals._count ? [`${plural(reversals._count, "payment")} reversed today (${tzs(reversals._sum.amount ?? 0)})`] : []),
    ...(d.revenue.refunds ? [`Refunds given: ${tzs(d.revenue.refunds)}`] : []),
    ...(cancelledOrders?.raw ? [`${plural(cancelledOrders.raw, "restaurant order")} cancelled (${cancelledOrders.sub})`] : []),
    ...(toConfirm._count ? [`${plural(toConfirm._count, "waiter payment")} (${tzs(toConfirm._sum.amount ?? 0)}) waiting for reception to confirm`] : []),
    ...d.expenses.highValue.map((e) => `Large expense: ${e.category} — ${e.description} (${tzs(e.amount)})`),
    ...(failed ? [`${plural(failed, "message")} failed to send today`] : []),
  ];

  // ── Plain facts (never reasons we cannot know) ──
  const food = restaurant.figures.find((f) => f.label === "Orders");
  const fnb = d.revenue.restaurant + d.revenue.bar + (d.revenue.roomService ?? 0);
  const insights = [
    `${soldNights} of ${guestRooms.length} guest rooms were occupied — ${d.hotel.occupancy}% occupancy${d.rooms?.adr ? `, at an average of ${tzs(d.rooms.adr)} a room` : ""}.`,
    `Rooms earned ${tzs(d.revenue.roomNet)} (${pct(d.revenue.roomNet, d.revenue.total)}% of revenue); the restaurant & bar ${tzs(fnb)} (${pct(fnb, d.revenue.total)}%).`,
    `${tzs(d.money.collected)} was received today; ${tzs(d.money.outstanding)} is still owed to the hotel across guests, companies and orders.`,
    food?.raw ? `The restaurant & bar had ${plural(food.raw, "order")}${food.sub ? ` (${food.sub})` : ""}.` : "The restaurant & bar had no orders.",
    `${plural(d.guests.checkIns, "check-in")} and ${plural(d.guests.checkOuts, "check-out")}; ${plural(d.guests.newBookings, "new booking")} made; ${num(d.guests.inHouse)} bookings in house.`,
    d.expenses.total ? `${tzs(d.expenses.total)} was spent, most on ${d.expenses.byCategory[0]?.name ?? "—"} (${tzs(d.expenses.byCategory[0]?.amount ?? 0)}).` : "No expenses were recorded.",
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
    ...(attention.length ? [{ kind: "list", title: "Attention required", items: attention, tone: "attention" } as Block] : []),
    { kind: "list", title: "The day in plain facts", items: insights, tone: "insight" },
    {
      kind: "highlights", title: "At a glance",
      items: [
        { label: "Rooms sold", value: num(d.hotel.roomsSold), sub: `${d.hotel.roomNights} night${d.hotel.roomNights === 1 ? "" : "s"}` },
        { label: "New bookings", value: num(d.guests.newBookings), sub: `${d.guests.cancellations} cancelled · ${d.guests.noShows} no-show` },
        { label: "Check-ins · outs", value: `${d.guests.checkIns} · ${d.guests.checkOuts}` },
        { label: "Restaurant (food)", value: tzs(d.revenue.restaurant), sub: food?.raw ? plural(food.raw, "order") : "no orders" },
        { label: "Bar (drinks)", value: tzs(d.revenue.bar) },
        { label: "Room service fees", value: tzs(d.revenue.roomService ?? 0) },
        { label: "Meeting room", value: tzs(d.revenue.meeting), sub: d.meetingRoom ? `${d.meetingRoom.bookings} booking${d.meetingRoom.bookings === 1 ? "" : "s"}` : undefined },
        { label: "Transport", value: tzs(d.revenue.transport ?? 0), sub: `${plural(tripsDone.length, "trip")} completed` },
      ],
    },

    { kind: "section", title: "Money", subtitle: "Revenue is what the hotel earned today · payments are money actually received · outstanding is what is still owed" },
    {
      kind: "statement", title: "Revenue recognised", subtitle: "Earned on this hotel day", half: true,
      rows: [
        { label: "Rooms (before discounts)", value: d.revenue.roomGross },
        { label: "Less room discounts", value: -d.revenue.roomDiscounts, style: "less" },
        { label: "Rooms (net)", value: d.revenue.roomNet, style: "sub" },
        { label: "Restaurant (food)", value: d.revenue.restaurant }, { label: "Bar (drinks)", value: d.revenue.bar },
        { label: "Room service fees", value: d.revenue.roomService ?? 0 }, { label: "Meeting room", value: d.revenue.meeting },
        { label: "Transport", value: d.revenue.transport ?? 0 }, { label: "Other services", value: d.revenue.other },
        { label: "Less refunds", value: -d.revenue.refunds, style: "less" },
        { label: "Total revenue", value: d.revenue.total, style: "total" },
        { label: "Less expenses", value: -d.expenses.total, style: "less" },
        { label: "Net operating result", value: net, style: "grand" },
      ],
    },
    {
      kind: "bars", title: "Revenue · collected · owed", subtitle: "Three different things — never added together", money: true, half: true, noTotal: true,
      items: [
        { label: "Revenue earned today", value: d.revenue.total, color: "#c9a24a" },
        { label: "Payments collected today", value: d.money.collected, color: "#10b981" },
        { label: "Outstanding (all dates)", value: d.money.outstanding, color: "#f43f5e" },
      ],
    },
    ...pick(payments, ["By payment method", "By account (where the money is)", "Collected by"]),
    ...pick(outstanding, ["Where the money is owed"]),
    ...pick(expenses, ["By category", "Every expense"]),

    { kind: "section", title: "Rooms & guests", subtitle: "Guest rooms only — the meeting room is reported on its own" },
    {
      kind: "highlights", title: "Rooms now and today",
      items: [
        { label: "Guest rooms", value: num(guestRooms.length) },
        { label: "Occupied", value: num(guestRooms.filter((r) => r.status === "OCCUPIED").length) },
        { label: "Reserved · arriving", value: num(guestRooms.filter((r) => r.status === "RESERVED").length) },
        { label: "Available", value: num(guestRooms.filter((r) => r.status === "AVAILABLE" || r.status === "READY").length) },
        { label: "Cleaning", value: num(guestRooms.filter((r) => r.status === "DIRTY" || r.status === "CLEANING").length) },
        { label: "Maintenance · out of service", value: `${guestRooms.filter((r) => r.status === "MAINTENANCE").length} · ${guestRooms.filter((r) => r.status === "OUT_OF_SERVICE").length}` },
        { label: "Average room rate", value: d.rooms?.adr ? tzs(d.rooms.adr) : "—" },
        { label: "Room revenue", value: tzs(d.revenue.roomNet), sub: d.rooms?.companyCredit ? `${tzs(d.rooms.companyCredit)} on company credit` : undefined },
      ],
    },
    {
      kind: "table", title: "Room by room", subtitle: "Rooms that earned today or have a guest now", empty: "No room earned anything today.",
      columns: [{ label: "Room" }, { label: "Type" }, { label: "Status now" }, { label: "Guest" }, { label: "Nights", align: "right" }, { label: "Revenue", align: "right", money: true }],
      rows: roomRows.map((x) => [x.r.number, x.r.roomType.name, ROOM_STATE[x.r.status] ?? x.r.status, x.guest ?? "—", x.short ? "short time" : x.nights, x.earned]),
      foot: roomRows.length ? ["Total", "", "", "", roomRows.reduce((t, x) => t + x.nights, 0), roomRows.reduce((t, x) => t + x.earned, 0)] : undefined,
    },
    {
      kind: "table", title: "Arrivals", subtitle: `${arrivals.length} due · ${arrivals.filter((a) => a.status === "CHECKED_IN" || a.status === "CHECKED_OUT").length} checked in`, half: true, empty: "No arrivals were due.",
      columns: [{ label: "Guest" }, { label: "Room" }, { label: "Source", muted: true }, { label: "Status" }],
      rows: arrivals.map((a) => [a.reservation.guest.fullName, a.room?.number ?? "—", a.reservation.source.name, STAY[a.status] ?? a.status]),
    },
    {
      kind: "table", title: "Departures", subtitle: `${departures.length} due to leave`, half: true, empty: "No departures were due.",
      columns: [{ label: "Guest" }, { label: "Room" }, { label: "Status" }, { label: "Balance", align: "right", money: true }],
      rows: departures.map((x) => [x.reservation.guest.fullName, x.room?.number ?? "—", x.status === "CHECKED_OUT" ? "Left" : "Still in (overdue)", x.reservation.balanceAmount]),
    },
    {
      kind: "highlights", title: "Customers",
      items: [
        { label: "In house now", value: num(d.guests.inHouse), sub: "guest bookings" },
        { label: "Guests staying owe", value: tzs(d.money.inHouseOutstanding ?? 0), sub: `${d.money.inHouseOwing ?? 0} guest${d.money.inHouseOwing === 1 ? "" : "s"}` },
        { label: "New customers", value: num(newCustomers), sub: "first time today" },
        { label: "Returning customers", value: num(returning), sub: "booked or ordered again" },
      ],
    },
    ...pick(rooms, ["Where bookings come from", "Room types"]),

    { kind: "section", title: "Restaurant & bar", subtitle: "Orders placed today (cancelled left out)" },
    asGlance("The restaurant in figures", restaurant.figures),
    ...pick(restaurant, ["Food and drinks", "By kind of order", "Where the orders came from", "How they are paid", "Room service orders"]),
    ...pick(tables, ["Every table"]),
    ...pick(items, ["Top 10 by sales"]),

    { kind: "section", title: "Meeting room & transport" },
    {
      kind: "highlights", title: "Meeting room",
      items: d.meetingRoom ? [
        { label: "Bookings", value: num(d.meetingRoom.bookings), sub: `${d.meetingRoom.completed} completed` },
        { label: "Hours used", value: `${d.meetingRoom.bookedHours} h`, sub: `${d.meetingRoom.utilisation}% of open hours` },
        { label: "Revenue", value: tzs(d.meetingRoom.revenue) },
        { label: "Cancelled · no-shows", value: `${d.meetingRoom.cancelled} · ${d.meetingRoom.noShows}` },
      ] : [{ label: "Meeting room", value: "No meeting room set up" }],
    },
    {
      kind: "table", title: "Transport", subtitle: `${plural(trips.length, "trip")} · ${tripsDone.length} completed · revenue ${tzs(d.revenue.transport ?? 0)}`, empty: "No transport today.",
      columns: [{ label: "Trip" }, { label: "Time" }, { label: "Passenger" }, { label: "To", muted: true }, { label: "Status" }, { label: "Charge", align: "right", money: true }, { label: "Billing", muted: true }],
      rows: trips.map((t) => [TRIP[t.type] ?? t.type, clock(t.pickupAt), t.passengerName, t.destination, TRIP_STATUS[t.status] ?? t.status, t.charge ?? 0, t.reservationId ? "Room bill" : t.paidAt ? "Paid" : t.charge ? "Not paid" : "Free"] as Cell[]),
    },

    ...(d.stores || d.assets || d.operations ? storesBlocks(d) : []),

    { kind: "section", title: "Staff & records", subtitle: "What each person did — an activity record, not a score" },
    ...(d.shifts?.length ? [{
      kind: "table" as const, title: "Shifts", subtitle: "Who worked the day — each shift has its own report (Staff shifts in the app)",
      columns: [{ label: "Name" }, { label: "Role", muted: true }, { label: "Department" }, { label: "Started" }, { label: "Ended" }, { label: "Duration", align: "right" as const }, { label: "Report", muted: true }],
      rows: d.shifts.map((x) => [x.name, x.role, x.department === "RESTAURANT" ? "Restaurant" : "Reception", x.start, x.end ?? "on shift", `${Math.floor(x.minutes / 60)}h ${String(x.minutes % 60).padStart(2, "0")}m`, x.reportId ? "Made" : x.end ? "Being made" : "At the end"] as Cell[]),
    }] : []),
    {
      kind: "table", title: "Staff activity", empty: "No staff activity recorded.",
      columns: [{ label: "Name" }, { label: "Role", muted: true }, { label: "Check-ins", align: "right" }, { label: "Check-outs", align: "right" }, { label: "Bookings", align: "right" }, { label: "Orders prepared", align: "right" }, { label: "Orders served", align: "right" }, { label: "Money recorded", align: "right", money: true }, { label: "Waiter collected", align: "right", money: true }],
      rows: staffRows.map((x) => [x.name, x.role, x.checkIns, x.checkOuts, x.bookings, x.ready, x.del, x.money, x.collected]),
    },
    ...pick(staff, ["Work by person"]),
    ...(voids.figures.some((f) => f.raw) ? [asGlance("Cancellations & voids", voids.figures)] : []),
    { kind: "note", text: `Hotel day ${formatBusinessDate(date)} 04:00 → next day 04:00. Revenue is counted when earned (room nights night by night; food, drinks and extras when sold or put on a room bill). Payments collected are money in (payments and on-the-spot sales, less refunds). Outstanding is everything still owed at the time of the report. The net operating result is revenue less recorded expenses — it is not a full profit (no salaries, depreciation or tax unless recorded as expenses).` },
  ];

  return {
    key: "summary", title: "Daily business report", blurb: "Everything that happened in the hotel on this business day — made automatically.",
    period: formatBusinessDate(date, true), from: date, to: date, days: 1, figures, blocks,
    share: "",
  };
}

/** Stores (consumable stock), assets and how the operation ran — for reports from Oct 2026. */
function storesBlocks(d: DailyReportData): Block[] {
  const s = d.stores, a = d.assets, o = d.operations;
  const tzs = (v: number) => `TZS ${Math.round(v).toLocaleString("en-US")}`;
  const blocks: Block[] = [{ kind: "section", title: "Stores, assets & operations", subtitle: "Stock received and used, waste, alerts — the hotel's equipment — and where the day ran late" }];
  if (s) {
    blocks.push({
      kind: "highlights", title: "Stores today",
      items: [
        { label: "Stock received", value: tzs(s.receivedValue), sub: `${s.receivedLines} deliver${s.receivedLines === 1 ? "y" : "ies"}` },
        { label: "Stock used", value: tzs(s.usedValue), sub: `${s.usedItems} item${s.usedItems === 1 ? "" : "s"}${s.soldValue ? ` · ${tzs(s.soldValue)} by recipes` : ""}` },
        { label: "Waste", value: tzs(s.wasteValue), sub: `${s.wasteLines} record${s.wasteLines === 1 ? "" : "s"}${s.pendingWaste ? ` · ${s.pendingWaste} waiting` : ""}` },
        { label: "Low · out of stock", value: `${s.low} · ${s.out}`, sub: s.value ? `stock worth ${tzs(s.value)}` : undefined },
        ...(s.countDifferenceValue ? [{ label: "Count corrections", value: `${s.countDifferenceValue < 0 ? "−" : "+"}${tzs(Math.abs(s.countDifferenceValue))}`, sub: "physical count vs system" }] : []),
      ],
    });
    if (s.topUsed.length) blocks.push({ kind: "table", title: "Used most", subtitle: "By value, including what the dishes sold took", columns: [{ label: "Item" }, { label: "Used", align: "right" }, { label: "Value", align: "right", money: true }], rows: s.topUsed.map((u) => [u.name, u.qty, u.value]), empty: "Nothing used." });
    const alerts = [...s.outItems.map((x) => `Out of stock: ${x}`), ...s.lowItems.map((x) => `Low: ${x}`)];
    if (alerts.length) blocks.push({ kind: "list", title: "Stock to buy", items: alerts.slice(0, 12), tone: "attention" });
  }
  if (a) {
    blocks.push({
      kind: "highlights", title: "Assets",
      items: [
        { label: "Assets on record", value: String(a.records) },
        { label: "Moved today", value: String(a.moved) },
        { label: "Under repair", value: String(a.underRepair) },
        { label: "Out of order", value: String(a.outOfOrder) },
      ],
    });
    if (a.needsAttention.length) blocks.push({ kind: "list", title: "Equipment needing attention", items: a.needsAttention.map((x) => `${x.name} (${x.code})${x.location ? ` — ${x.location}` : ""} · ${x.status.toLowerCase().replace(/_/g, " ")}`), tone: "attention" });
  }
  if (o) {
    blocks.push({
      kind: "highlights", title: "Operations",
      items: [
        { label: "Late restaurant orders", value: String(o.delayedOrders), sub: "over 25 min to prepare" },
        { label: "Rooms waiting for cleaning", value: String(o.roomsWaitingCleaning), sub: "at report time" },
        { label: "Maintenance issues", value: String(o.maintenanceIssues), sub: "rooms and equipment" },
        { label: "Waiter money to confirm", value: String(o.paymentsToConfirm), sub: "not confirmed by reception" },
      ],
    });
  }
  return blocks;
}
