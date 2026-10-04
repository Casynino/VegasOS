/**
 * Front-desk practice data — for testing the real workflows, never for production.
 *
 *   npm run test-data:load    add a realistic "today" at the desk
 *   npm run test-data:departures  add guests in the hotel who need to CHECK OUT
 *   npm run test-data:money   add a week of money through every payment account
 *   npm run test-data:full    ALL of it at once (below, plus past stays, companies,
 *                             restaurant orders, requests, pickups, notes)
 *   npm run test-data:clear   remove ONLY this practice data
 *
 * Everything created here is marked: guest names end in "(test)", phones start
 * with +255 700 900, reservations carry "[TEST SCENARIO]" in internal notes.
 * Bookings go through the real reservation engine (same rules as the desk).
 */
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { checkIn, createReservation, type Actor } from "@/server/services/reservations";
import { addReservationCharge, recordReservationPayment } from "@/server/services/payments";
import { submitBookingRequest } from "@/server/services/booking-requests";
import { recordSale } from "@/server/services/outlets";
import { recordExpense } from "@/server/services/expenses";
import { postMovement } from "@/server/services/finance";
import { checkOut } from "@/server/services/reservations";
import { recordCompanyPayment } from "@/server/services/company-billing";
import { refreshOverdueInvoices } from "@/server/services/invoices";
import { createRestaurantOrder, setOrderStatus, ORDER_FLOW } from "@/server/services/restaurant";
import { createServiceRequest } from "@/server/services/requests";
import { requestTransportForReservation } from "@/server/services/transport";
import { addHandoverNote } from "@/server/services/shifts";
import { checkInGroup, createGroupBooking, type GroupRoomInput } from "@/server/services/groups";
import type { RestaurantOrderStatus } from "@/generated/prisma/client";
import { addDays, zonedInstant } from "@/lib/time/business-date";

const TAG = "[TEST SCENARIO]";
const PHONE_PREFIX = "+255700900";
const TZ = "Africa/Dar_es_Salaam";

function guard() {
  const url = process.env.DATABASE_URL ?? "";
  if (process.env.NODE_ENV === "production" || !/localhost|127\.0\.0\.1/.test(url)) {
    throw new Error("Refusing to run: practice data is only for a local development database.");
  }
}

async function actor(): Promise<Actor> {
  const u = await db.user.findFirstOrThrow({
    where: { isActive: true, role: { code: { in: ["RECEPTIONIST", "MANAGER", "ADMIN", "OWNER"] } } },
    include: { role: { include: { permissions: { include: { permission: true } } } } },
    orderBy: { createdAt: "asc" },
  });
  return { userId: u.id, label: u.fullName, permissions: new Set(u.role.permissions.map((p) => p.permission.code)) };
}

const phone = (n: number) => `${PHONE_PREFIX}${String(n).padStart(3, "0")}`;

/** Books a practice guest through the real reservation engine (falls back to another room type when one is full). */
function makeBooker(me: Actor, made: string[]) {

  const book = async (o: {
    name: string; n: number; code: string; source: string; arrival: string; departure: string; adults?: number; children?: number;
    eta?: string; idNumber?: string; requests?: string; status?: "RESERVED" | "CONFIRMED"; now?: Date;
    companyId?: string; billTo?: "COMPANY" | "SPLIT"; covers?: string[];
  }) => {
    // Preferred room type first; if it's full for these dates, fall back to any other type.
    const types = await db.roomType.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } });
    const order = [types.find((x) => x.code === o.code)!, ...types.filter((x) => x.code !== o.code)];
    let lastErr: unknown;
    for (const t of order) {
      try {
        return await bookAs(t.id);
      } catch (e) {
        lastErr = e;
        if (!(e instanceof Error) || !/fully booked|not free|no .*available|fits up to|just booked/i.test(e.message)) throw e;
      }
    }
    throw lastErr;

    async function bookAs(roomTypeId: string) {
      // Backdated (already in-house) guests need a room that is ready right now; try each until one is free.
      if (o.now) {
        // Ready rooms first; then rooms that only wait for housekeeping (made ready for the practice guest).
        const rooms = await db.room.findMany({ where: { roomTypeId, isActive: true, status: { in: ["AVAILABLE", "READY", "DIRTY", "CLEANING"] } } });
        const rank = (st: string) => (st === "AVAILABLE" || st === "READY" ? 0 : 1);
        rooms.sort((a, b) => rank(a.status) - rank(b.status) || a.number.localeCompare(b.number));
        let err: unknown = new Error("fully booked");
        for (const room of rooms) {
          try {
            const r = await create(roomTypeId, room.id);
            if (rank(room.status) === 1) await db.room.update({ where: { id: room.id }, data: { status: "READY" } });
            return r;
          } catch (e) { err = e; if (!(e instanceof Error) || !/just booked|not free|fully booked/i.test(e.message)) throw e; }
        }
        throw err;
      }
      return create(roomTypeId, null);
    }

    async function create(roomTypeId: string, roomId: string | null) {
    const r = await createReservation({
      sourceCode: o.source,
      guest: { fullName: `${o.name} (test)`, phone: phone(o.n), ...(o.idNumber && { idType: "PASSPORT", idNumber: o.idNumber, nationality: "Tanzanian" }) },
      stay: { kind: "overnight", arrivalDate: o.arrival, departureDate: o.departure },
      rooms: [{ roomTypeId, roomId, adults: o.adults ?? 2, children: o.children ?? 0 }],
      status: o.status ?? "CONFIRMED",
      eta: o.eta ?? null,
      specialRequests: o.requests ?? null,
      internalNotes: `${TAG} Practice booking — safe to check in / out.`,
      ...(o.companyId && { corporateCustomerId: o.companyId, billing: { billTo: o.billTo ?? "COMPANY", covers: o.covers } }),
    }, me, o.now);
    made.push(`${r.reference}  ${o.name} (test)`);
    return r;
    }
  };
  return book;
}

async function load() {
  guard();
  // Only this scenario's own guests (numbers 001–009) count; check-out practice guests may exist alongside.
  if (await db.guest.count({ where: { phone: { in: Array.from({ length: 9 }, (_, i) => phone(i + 1)) } } })) {
    console.log("Practice data is already loaded. Run `npm run test-data:clear` first to start fresh.");
    return;
  }
  const me = await actor();
  const today = await businessToday();
  const yesterday = addDays(today, -1);
  const cash = await db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });
  const mobile = await db.paymentMethod.findUniqueOrThrow({ where: { code: "MOBILE_MONEY" } });
  const yNoon = zonedInstant(yesterday, 12 * 60, TZ);
  const yCheckIn = zonedInstant(yesterday, 15 * 60, TZ);
  const made: string[] = [];
  const book = makeBooker(me, made);

  // ── Arrivals today ──
  await book({ name: "Amina Juma", n: 1, code: "DOUBLE_DELUXE", source: "WEBSITE", arrival: today, departure: addDays(today, 2), eta: "14:30", idNumber: "TZ-TEST-001" });
  const peter = await book({ name: "Peter Kim", n: 2, code: "EXECUTIVE_SUITE", source: "PHONE", arrival: today, departure: addDays(today, 3), eta: "16:00", requests: "Quiet room, high floor if possible" });
  // Peter's booked room is not ready yet → practise "Assign another room & check in".
  const peterRoom = await db.reservationRoom.findFirstOrThrow({ where: { reservationId: peter.id } });
  await db.room.update({ where: { id: peterRoom.roomId }, data: { status: "DIRTY" } });
  const grace = await book({ name: "Grace Mushi", n: 3, code: "STANDARD", source: "WHATSAPP", arrival: today, departure: addDays(today, 1), adults: 1, eta: "22:00", status: "RESERVED", requests: "Arriving late — flight lands 21:00" });
  await recordReservationPayment({ reservationId: grace.id, amount: grace.balanceAmount, methodId: mobile.id, reference: "TEST-MPESA-001" }, me);

  // ── Departures today (checked in yesterday) ──
  const john = await book({ name: "John Michael", n: 4, code: "DOUBLE_DELUXE", source: "WEBSITE", arrival: yesterday, departure: today, idNumber: "TZ-TEST-004", now: yNoon });
  await checkIn(john.id, me, null, yCheckIn);
  const johnNow = await db.reservation.findUniqueOrThrow({ where: { id: john.id } });
  await recordReservationPayment({ reservationId: john.id, amount: johnNow.balanceAmount, methodId: cash.id, reference: "TEST-CASH-004" }, me);
  const sarah = await book({ name: "Sarah Ali", n: 5, code: "EXECUTIVE", source: "PHONE", arrival: yesterday, departure: today, idNumber: "TZ-TEST-005", now: yNoon });
  await checkIn(sarah.id, me, null, yCheckIn); // leaves with a balance → practise taking payment at checkout

  // ── In house, staying on (practise extend stay / room change / guest request) ──
  const ahmed = await book({ name: "Ahmed Said", n: 6, code: "EXECUTIVE_SUITE", source: "DIRECT", arrival: yesterday, departure: addDays(today, 2), adults: 1, idNumber: "TZ-TEST-006", now: yNoon });
  await checkIn(ahmed.id, me, null, yCheckIn);

  // ── Upcoming ──
  await book({ name: "Neema Paul", n: 7, code: "TWIN", source: "PHONE", arrival: addDays(today, 3), departure: addDays(today, 5) });

  // ── Online booking requests (not yet reservations) ──
  const request = async (slugs: string[], run: (slug: string) => ReturnType<typeof submitBookingRequest>) => {
    for (const slug of slugs) {
      try { return await run(slug); } catch (e) { if (!(e instanceof Error) || !/fully booked|available/i.test(e.message)) throw e; }
    }
    throw new Error("No room type available for the practice request.");
  };
  const allSlugs = (await db.roomType.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" } })).map((x) => x.slug);
  const w = await request(["double-deluxe", ...allSlugs], (slug) => submitBookingRequest(
    { checkIn: addDays(today, 2), checkOut: addDays(today, 4), adults: 2, children: 0, typeSlug: slug, rooms: 1 },
    { fullName: "Fatma Hassan (test)", phone: phone(8), email: "fatma.test@example.com", expectedArrivalTime: "18:00", specialRequests: "Anniversary — any small touch appreciated" },
    null,
  ));
  const wa = await request(["executive", ...allSlugs], (slug) => submitBookingRequest(
    { checkIn: today, checkOut: addDays(today, 1), adults: 1, children: 0, typeSlug: slug, rooms: 1 },
    { fullName: "Joseph Mrema (test)", phone: phone(9), expectedArrivalTime: "20:00" },
    null, null, { sourceCode: "WHATSAPP", actor: { ...me, userId: me.userId!, permissions: me.permissions! } },
  ));
  made.push(`${w.reference}  Fatma Hassan (test) — website request`, `${wa.reference}  Joseph Mrema (test) — WhatsApp request for today`);

  console.log(`\nPractice data loaded for hotel day ${today}:\n`);
  for (const m of made) console.log("  " + m);
  console.log(`
What to try at the desk:
  • Amina Juma     → arrival, room ready, ID on file: one-click CHECK IN
  • Peter Kim      → arrival, booked room is DIRTY: pick a ready room → ASSIGN ROOM & CHECK IN (asks for missing ID)
  • Grace Mushi    → late arrival, already paid by mobile money
  • John Michael   → departure today, fully paid: CHECK OUT in seconds
  • Sarah Ali      → departure today with a balance: take payment, then CHECK OUT
  • Ahmed Said     → in house: EXTEND STAY, CHANGE ROOM, add a guest request
  • Neema Paul     → arrives in 3 days
  • Joseph Mrema   → WhatsApp request for tonight: confirm & create reservation
  • Fatma Hassan   → website request: log a contact, then confirm
Remove it all later with:  npm run test-data:clear
`);
}

/** Guests already in the hotel, each with a different check-out situation. Can be run again for a fresh set. */
async function departures() {
  guard();
  const me = await actor();
  const today = await businessToday();
  const yesterday = addDays(today, -1);
  const twoDaysAgo = addDays(today, -2);
  const cash = await db.paymentMethod.findUniqueOrThrow({ where: { code: "CASH" } });
  const mobile = await db.paymentMethod.findUniqueOrThrow({ where: { code: "MOBILE_MONEY" } });
  // Continue the practice phone numbers so every run creates new guests.
  const used = await db.guest.findMany({ where: { phone: { startsWith: PHONE_PREFIX } }, select: { phone: true } });
  let n = Math.max(20, ...used.map((g) => Number(g.phone!.slice(PHONE_PREFIX.length)) || 0)) + 1;
  const made: string[] = [];
  const book = makeBooker(me, made);
  const inHouse = async (o: { name: string; code: string; source: string; from: string; to: string; adults?: number }) => {
    const r = await book({ name: o.name, n: n++, code: o.code, source: o.source, arrival: o.from, departure: o.to, adults: o.adults, idNumber: `TZ-TEST-${n}`, now: zonedInstant(o.from, 12 * 60, TZ) });
    await checkIn(r.id, me, null, zonedInstant(o.from, 15 * 60, TZ));
    return db.reservation.findUniqueOrThrow({ where: { id: r.id } });
  };

  // 1 · Paid in full → check out in seconds.
  const paul = await inHouse({ name: "Paul Otieno", code: "DOUBLE_DELUXE", source: "WEBSITE", from: yesterday, to: today });
  await recordReservationPayment({ reservationId: paul.id, amount: paul.balanceAmount, methodId: cash.id, reference: "TEST-CASH-PAUL" }, me);

  // 2 · Paid a deposit → collect the rest, then check out.
  const halima = await inHouse({ name: "Halima Omar", code: "EXECUTIVE", source: "PHONE", from: twoDaysAgo, to: today });
  await recordReservationPayment({ reservationId: halima.id, amount: Math.round(halima.balanceAmount / 2 / 1000) * 1000, methodId: mobile.id, reference: "TEST-MPESA-HALIMA" }, me);

  // 3 · Room paid, but restaurant & bar bills added during the stay.
  const david = await inHouse({ name: "David Mushi", code: "STANDARD", source: "WHATSAPP", from: yesterday, to: today, adults: 1 });
  await recordReservationPayment({ reservationId: david.id, amount: david.balanceAmount, methodId: mobile.id, reference: "TEST-MPESA-DAVID" }, me);
  await addReservationCharge({ reservationId: david.id, description: "Restaurant — dinner for one", amount: 45_000, category: "RESTAURANT" }, me);
  await addReservationCharge({ reservationId: david.id, description: "Bar — drinks", amount: 30_000, category: "BAR" }, me);

  // 4 · Overdue: should have left yesterday and still owes.
  await inHouse({ name: "Rose Kimaro", code: "TWIN", source: "DIRECT", from: twoDaysAgo, to: yesterday });

  // 5 · Booked 2 more nights but wants to leave early today → practise an early departure (give a reason).
  const mary = await inHouse({ name: "Mary Lyimo", code: "DOUBLE_DELUXE", source: "PHONE", from: yesterday, to: addDays(today, 2) });
  await recordReservationPayment({ reservationId: mary.id, amount: mary.balanceAmount, methodId: cash.id, reference: "TEST-CASH-MARY" }, me);

  console.log(`\nCheck-out practice guests added for hotel day ${today}:\n`);
  for (const m of made) console.log("  " + m);
  console.log(`
What to try (Front desk → Leaving today, or open the guest):
  • Paul Otieno   → fully paid: CHECK OUT in seconds
  • Halima Omar   → paid a deposit: take the rest, then CHECK OUT
  • David Mushi   → room paid, restaurant + bar bills (TZS 75,000) still open
  • Rose Kimaro   → OVERDUE since yesterday and owes the stay
  • Mary Lyimo    → booked 2 more nights, leaving early: open the stay → Check out (asks for a reason)
Run again any time for a fresh set. Remove all practice data with:  npm run test-data:clear
`);
}

/**
 * A week of money through every payment account: room payments into CRDB, NMB,
 * LIPA, M-Pesa and Cash; restaurant & bar sales; expenses paid from different
 * accounts; and the cash banked into CRDB. Everything is marked as practice data.
 */
async function money() {
  guard();
  if (await db.revenueTransaction.count({ where: { notes: TAG } })) {
    console.log("Practice money is already loaded. Run `npm run test-data:clear` first to start fresh.");
    return;
  }
  const me = await actor();
  const u = await db.user.findUniqueOrThrow({ where: { id: me.userId! }, include: { role: true } });
  const staffActor = { userId: u.id, label: u.fullName, permissions: me.permissions!, roleCode: u.role.code };
  const today = await businessToday();
  // Never in the future: today's entries are placed before "now".
  const at = (daysAgo: number, hour: number) => new Date(Math.min(zonedInstant(addDays(today, -daysAgo), hour * 60, TZ).getTime(), Date.now() - (daysAgo + 1) * 10 * 60_000));
  const acct = async (code: string) => (await db.moneyAccount.findUniqueOrThrow({ where: { code } })).id;
  const [cash, lipa, mpesa, crdb, nmb] = await Promise.all(["CASH_DRAWER", "MOBILE_MONEY", "LIPA_MPESA", "BANK", "NMB_BANK"].map(acct));

  // ── Room payments (bookings for the coming weeks, paid now; dated over the last week) ──
  const used = await db.guest.findMany({ where: { phone: { startsWith: PHONE_PREFIX } }, select: { phone: true } });
  let n = Math.max(40, ...used.map((g) => Number(g.phone!.slice(PHONE_PREFIX.length)) || 0)) + 1;
  const made: string[] = [];
  const book = makeBooker(me, made);
  const guests: [string, string, string, number, number][] = [
    ["James Mwakyusa", "DOUBLE_DELUXE", crdb, 6, 10], ["Rehema Kassim", "STANDARD", lipa, 5, 9], ["Omari Bakari", "EXECUTIVE", mpesa, 4, 11],
    ["Lucy Wanjiru", "TWIN", cash, 3, 15], ["Kampuni ya Safari Ltd", "EXECUTIVE_SUITE", nmb, 2, 12], ["Baraka Minja", "DOUBLE_DELUXE", crdb, 1, 16],
    ["Salma Hamisi", "STANDARD", lipa, 0, 10], ["Victor Mrema", "TWIN", cash, 0, 13],
  ];
  for (const [i, [name, code, accountId, daysAgo, hour]] of guests.entries()) {
    const arrival = addDays(today, 12 + i * 2);
    const r = await book({ name, n: n++, code, source: i % 2 ? "PHONE" : "WEBSITE", arrival, departure: addDays(arrival, 1 + (i % 3)) });
    await recordReservationPayment({ reservationId: r.id, amount: r.balanceAmount, accountId, reference: accountId === cash ? null : `TEST-${String(1000 + i)}` }, me);
    const when = at(daysAgo, hour);
    await db.payment.updateMany({ where: { reservationId: r.id }, data: { receivedAt: when, businessDate: new Date(`${addDays(today, -daysAgo)}T00:00:00Z`) } });
  }

  // ── Restaurant & bar sales ──
  const bar = await db.revenueCategory.findUniqueOrThrow({ where: { code: "BAR" } });
  const rest = await db.revenueCategory.findUniqueOrThrow({ where: { code: "RESTAURANT" } });
  const sales: [string, number, string, number, number, string][] = [
    [rest.id, 185_000, mpesa, 5, 21, "Dinner service"], [bar.id, 96_000, cash, 5, 23, "Bar — evening"], [rest.id, 64_000, cash, 4, 13, "Lunch"],
    [bar.id, 142_000, mpesa, 3, 22, "Bar — football night"], [rest.id, 210_000, lipa, 2, 20, "Dinner — group of 8"], [bar.id, 58_000, cash, 1, 21, "Bar — evening"],
    [rest.id, 47_000, mpesa, 0, 9, "Breakfast walk-ins"],
  ];
  for (const [categoryId, amount, accountId, daysAgo, hour, description] of sales) {
    await recordSale({ categoryId, amount, accountId, description, notes: TAG, occurredAt: at(daysAgo, hour) }, me);
  }

  // ── Expenses, each paid from an account ──
  const expenses: [string, number, string, number, number][] = [
    ["exi_electricity", 150_000, crdb, 6, 11], ["exi_dawasa", 85_000, crdb, 5, 10], ["exi_generator-fuel", 60_000, cash, 5, 16],
    ["exi_staff-food", 35_000, cash, 4, 12], ["exi_netflix", 35_000, nmb, 4, 9], ["exi_housekeeping", 48_000, cash, 3, 11],
    ["exi_kitchen", 120_000, mpesa, 2, 8], ["exi_drinks-stock", 180_000, lipa, 2, 15], ["exi_selcom", 12_500, crdb, 1, 10], ["exi_ice", 15_000, cash, 0, 17],
  ];
  for (const [itemId, amount, accountId, daysAgo, hour] of expenses) {
    await recordExpense({ categoryId: "", itemId, amount, description: "", accountId, notes: TAG, spentAt: at(daysAgo, hour) }, staffActor);
  }

  // ── The cash banked into CRDB ──
  await postMovement({ kind: "TRANSFER", amount: 150_000, accountId: cash, toAccountId: crdb, description: "Banked the cash takings", notes: TAG }, staffActor);

  console.log(`\nPractice money added through every payment account (last 7 hotel days up to ${today}).`);
  console.log("Open Finance → Payment accounts. Remove it all later with:  npm run test-data:clear\n");
}

/**
 * Everything else, so every screen has something to show: a month of past
 * stays (reports, history), companies with invoices (paid, open, overdue),
 * restaurant & bar orders at every kitchen step plus a week of past orders,
 * guest requests, airport pickups, handover notes and an expense to approve.
 */
async function world() {
  guard();
  if (await db.corporateCustomer.count({ where: { companyName: { endsWith: "(test)" } } })) {
    console.log("The rest of the practice data is already there. Run `npm run test-data:clear` first to start fresh.");
    return;
  }
  const me = await actor();
  const u = await db.user.findUniqueOrThrow({ where: { id: me.userId! }, include: { role: true } });
  const staffActor = { userId: u.id, label: u.fullName, permissions: me.permissions!, roleCode: u.role.code };
  const today = await businessToday();
  const acct = async (code: string) => (await db.moneyAccount.findUniqueOrThrow({ where: { code } })).id;
  const [cash, lipa, mpesa, crdb, nmb] = await Promise.all(["CASH_DRAWER", "MOBILE_MONEY", "LIPA_MPESA", "BANK", "NMB_BANK"].map(acct));
  const used = await db.guest.findMany({ where: { phone: { startsWith: PHONE_PREFIX } }, select: { phone: true } });
  let n = Math.max(80, ...used.map((g) => Number(g.phone!.slice(PHONE_PREFIX.length)) || 0)) + 1;
  const made: string[] = [];
  const book = makeBooker(me, made);
  // Past stays leave rooms "dirty"; put every room back the way it was afterwards.
  const roomsBefore = new Map((await db.room.findMany({ select: { id: true, status: true } })).map((r) => [r.id, r.status]));

  /** A stay that already happened: booked, checked in, paid into an account, checked out. */
  const pastStay = async (o: { name: string; code: string; source: string; daysAgo: number; nights: number; account?: string; companyId?: string; billTo?: "COMPANY" | "SPLIT"; adults?: number }) => {
    const arrival = addDays(today, -o.daysAgo), departure = addDays(arrival, o.nights);
    const r = await book({ name: o.name, n: n++, code: o.code, source: o.source, arrival, departure, adults: o.adults, idNumber: `TZ-TEST-${n}`, now: zonedInstant(arrival, 9 * 60, TZ), companyId: o.companyId, billTo: o.billTo });
    await checkIn(r.id, me, null, zonedInstant(arrival, 15 * 60, TZ));
    const inHouse = await db.reservation.findUniqueOrThrow({ where: { id: r.id } });
    if (o.account && inHouse.balanceAmount > 0) {
      await recordReservationPayment({ reservationId: r.id, amount: inHouse.balanceAmount, accountId: o.account, reference: o.account === cash ? null : `TEST-${n}` }, me);
      const paidAt = zonedInstant(arrival, 16 * 60, TZ);
      await db.payment.updateMany({ where: { reservationId: r.id }, data: { receivedAt: paidAt, businessDate: new Date(`${arrival}T00:00:00Z`) } });
    }
    const out = await checkOut(r.id, me, {}, zonedInstant(departure, 10 * 60 + 30, TZ));
    return { r, invoice: out.invoice ?? null };
  };

  // ── A month of past stays (reports, occupancy, guest history) ──
  const history: [string, string, string, number, number, string][] = [
    ["Hassan Mwinyi", "DOUBLE_DELUXE", "WEBSITE", 29, 2, crdb], ["Anna Swai", "STANDARD", "BOOKING_COM", 27, 3, crdb],
    ["Emmanuel Ngowi", "EXECUTIVE", "PHONE", 25, 1, cash], ["Zawadi Mollel", "TWIN", "WHATSAPP", 23, 2, lipa],
    ["Frank Massawe", "EXECUTIVE_SUITE", "DIRECT", 21, 4, nmb], ["Doris Shayo", "DOUBLE_DELUXE", "INSTAGRAM", 18, 2, mpesa],
    ["Idd Rashid", "STANDARD", "WALK_IN", 16, 1, cash], ["Catherine Lema", "EXECUTIVE", "EXPEDIA", 14, 3, crdb],
    ["Yusuf Abdallah", "TWIN", "PHONE", 11, 2, lipa], ["Pendo Mushi", "DOUBLE_DELUXE", "WEBSITE", 9, 1, mpesa],
    ["George Kweka", "EXECUTIVE_SUITE", "BOOKING_COM", 7, 2, crdb], ["Rukia Salum", "STANDARD", "WHATSAPP", 5, 2, cash],
    ["Michael Temba", "EXECUTIVE", "DIRECT", 4, 1, nmb], ["Esther Nyerere", "TWIN", "PHONE", 3, 1, lipa],
  ];
  for (const [name, code, source, daysAgo, nights, account] of history) await pastStay({ name, code, source, daysAgo, nights, account });

  // ── Companies: one pays on time, one is overdue ──
  const breweries = await db.corporateCustomer.create({ data: { companyName: "Serengeti Breweries Ltd (test)", contactPerson: "Agnes Mushi", phone: phone(n++), email: "accounts.test@example.com", paymentTermDays: 30, creditLimit: 3_000_000, billingNotes: TAG } });
  const ports = await db.corporateCustomer.create({ data: { companyName: "Dar Port Logistics (test)", contactPerson: "Salim Juma", phone: phone(n++), paymentTermDays: 14, creditLimit: 1_500_000, billingNotes: TAG } });
  await pastStay({ name: "Kelvin Mtui", code: "EXECUTIVE", source: "CORPORATE", daysAgo: 34, nights: 2, companyId: breweries.id });
  await pastStay({ name: "Janeth Kimaro", code: "DOUBLE_DELUXE", source: "CORPORATE", daysAgo: 12, nights: 1, companyId: breweries.id });
  await pastStay({ name: "Abdul Karim", code: "STANDARD", source: "CORPORATE", daysAgo: 26, nights: 3, companyId: ports.id });
  // The breweries paid their oldest invoice by bank transfer.
  const oldest = await db.invoice.findFirst({ where: { corporateCustomerId: breweries.id }, orderBy: { issueDate: "asc" } });
  if (oldest) await recordCompanyPayment({ companyId: breweries.id, amount: oldest.netAmount, accountId: crdb, reference: "TEST-TT-SBL" }, staffActor);
  // A company guest in the hotel now, and one coming next week (company pays the room, guest pays extras).
  const exec = await book({ name: "Brian Moshi", n: n++, code: "EXECUTIVE_SUITE", source: "CORPORATE", arrival: addDays(today, -1), departure: addDays(today, 2), adults: 1, idNumber: `TZ-TEST-${n}`, now: zonedInstant(addDays(today, -1), 10 * 60, TZ), companyId: breweries.id });
  await checkIn(exec.id, me, null, zonedInstant(addDays(today, -1), 14 * 60, TZ));
  await book({ name: "Winfrida Laizer", n: n++, code: "DOUBLE_DELUXE", source: "CORPORATE", arrival: addDays(today, 6), departure: addDays(today, 8), companyId: ports.id, billTo: "COMPANY" });
  await refreshOverdueInvoices();

  // Rooms used by past stays go back to how they were (practice history must not dirty the real board).
  for (const [id, status] of roomsBefore) {
    const busy = await db.reservationRoom.count({ where: { roomId: id, status: "CHECKED_IN" } });
    if (!busy) await db.room.updateMany({ where: { id, status: { not: status } }, data: { status } });
  }

  // ── Restaurant & bar ──
  const guest = (name: string) => db.reservation.findFirst({ where: { status: "CHECKED_IN", guest: { fullName: `${name} (test)` } }, select: { id: true } });
  const [ahmed, mary, halima, brian] = await Promise.all(["Ahmed Said", "Mary Lyimo", "Halima Omar", "Brian Moshi"].map(guest));
  const order = async (o: Parameters<typeof createRestaurantOrder>[0], to: RestaurantOrderStatus, at?: Date) => {
    const x = await createRestaurantOrder(o, me, at);
    const flow = ORDER_FLOW[o.type];
    for (const st of flow.slice(1, flow.indexOf(to) + 1)) await setOrderStatus(x.id, st, me);
    return x;
  };
  const I = (id: string, quantity = 1) => ({ menuItemId: id, quantity });
  // Today, at every step of the kitchen board.
  if (ahmed) await order({ type: "ROOM_SERVICE", reservationId: ahmed.id, settlement: "ROOM", items: [I("mi_main_courses_chicken_biryani"), I("mi_beers_safari", 2)] }, "PREPARING");
  if (mary) await order({ type: "ROOM_SERVICE", reservationId: mary.id, settlement: "ROOM", items: [I("mi_main_courses_beef_burger"), I("mi_main_courses_french_fries"), I("mi_sides_drinks_soda_cold_soft_drink")] }, "PENDING");
  if (brian) await order({ type: "ROOM_SERVICE", reservationId: brian.id, settlement: "ROOM", items: [I("mi_main_courses_beef_steak_veg_pepper_sauce"), I("mi_wines_robertson_red")] }, "OUT_FOR_DELIVERY");
  if (halima) await order({ type: "DINE_IN", reservationId: halima.id, tableLabel: "Table 6", settlement: "ROOM", items: [I("mi_breakfast_vegas_english_breakfast", 2), I("mi_sides_drinks_fresh_assorted_juices", 2)] }, "COMPLETED");
  await order({ type: "DINE_IN", tableLabel: "Table 4", customerName: "Walk-in family (test)", settlement: "PAY_NOW", accountId: cash, items: [I("mi_local_favorites_nyama_choma_beef", 2), I("mi_beers_kilimanjaro", 3), I("mi_sides_drinks_mineral_water", 2)] }, "READY");
  await order({ type: "DINE_IN", tableLabel: "Table 2", customerName: "Lunch guests (test)", settlement: "PAY_NOW", accountId: mpesa, reference: "TEST-QK81", items: [I("mi_main_courses_fish_chips"), I("mi_beers_heineken")] }, "ACCEPTED");
  await order({ type: "TAKEAWAY", customerName: "Musa takeaway (test)", settlement: "PAY_NOW", accountId: lipa, reference: "TEST-LP22", items: [I("mi_main_courses_chicken_pilau_beef_pilau", 3)] }, "PENDING");
  await order({ type: "DINE_IN", tableLabel: "Bar counter", customerName: "Bar guest (test)", settlement: "PAY_NOW", accountId: cash, items: [I("mi_whiskies_jameson_250ml"), I("mi_sides_drinks_soda_cold_soft_drink", 2)] }, "PENDING");
  // The last week, all served and paid (fills the restaurant & bar reports).
  const past: [number, number, string, string, { menuItemId: string; quantity: number }[]][] = [
    [6, 20, "Table 1", mpesa, [I("mi_local_favorites_samaki_choma_grilled_fish", 2), I("mi_beers_serengeti_lite", 4)]],
    [5, 13, "Table 3", cash, [I("mi_local_favorites_wali_chicken_curry", 3), I("mi_sides_drinks_fresh_assorted_juices", 3)]],
    [4, 21, "Bar counter", cash, [I("mi_beers_castle_lager", 6), I("mi_starters_soups_bbq_or_spicy_chicken_wings", 2)]],
    [3, 19, "Table 5", lipa, [I("mi_main_courses_spaghetti_bolognese", 2), I("mi_wines_drostdyhof_red_750ml")]],
    [2, 12, "Table 2", mpesa, [I("mi_main_courses_chicken_rice_bowl", 2), I("mi_sides_drinks_fresh_fruit_smoothies", 2)]],
    [1, 22, "Bar counter", cash, [I("mi_spirits_konyagi_250ml", 2), I("mi_beers_safari", 4)]],
  ];
  for (const [daysAgo, hour, table, accountId, items] of past) {
    await order({ type: "DINE_IN", tableLabel: table, customerName: `${table} (test)`, settlement: "PAY_NOW", accountId, items }, "COMPLETED", zonedInstant(addDays(today, -daysAgo), hour * 60, TZ));
  }

  // ── Guest requests, airport pickups, handover notes ──
  const reqs: [typeof ahmed, "TOWELS" | "CLEANING" | "MAINTENANCE" | "RESTAURANT", "LOW" | "NORMAL" | "HIGH", string][] = [
    [ahmed, "TOWELS", "NORMAL", "Two extra towels and a bathrobe, please (test)"],
    [mary, "MAINTENANCE", "HIGH", "Air conditioner is not cooling (test)"],
    [halima, "CLEANING", "LOW", "Please clean the room after 14:00 (test)"],
    [brian, "RESTAURANT", "NORMAL", "Breakfast in the room at 07:30 tomorrow (test)"],
  ];
  for (const [r, type, priority, description] of reqs) if (r) await createServiceRequest({ reservationId: r.id, type, priority, description }, staffActor);
  const peter = await db.reservation.findFirst({ where: { guest: { fullName: "Peter Kim (test)" } }, select: { id: true } });
  const neema = await db.reservation.findFirst({ where: { guest: { fullName: "Neema Paul (test)" } }, select: { id: true } });
  if (peter) await requestTransportForReservation({ reservationId: peter.id, flightNumber: "KQ 482", arrivalDate: today, arrivalTime: "14:10", passengers: 1, notes: "Practice pickup (test)" });
  if (neema) await requestTransportForReservation({ reservationId: neema.id, flightNumber: "ET 815", arrivalDate: addDays(today, 3), arrivalTime: "13:25", passengers: 2, notes: "Practice pickup (test)" });
  await addHandoverNote(staffActor, { kind: "SHIFT", isImportant: true, body: "Generator service on Monday 09:00 — tell in-house guests about a short power cut (test)" });
  await addHandoverNote(staffActor, { kind: "GUEST", isImportant: false, body: "Guest in the Executive Suite asked for a late checkout tomorrow — agreed until 13:00 (test)" });

  // ── An expense big enough to need a manager's approval ──
  await recordExpense({ categoryId: "", itemId: "exi_plumbing", amount: 650_000, description: "Replace the main water pump", accountId: crdb, notes: TAG }, staffActor);

  console.log(`\nMore practice data added for hotel day ${today}:`);
  console.log(`  ${history.length} past stays over the last month (checked out and paid)`);
  console.log("  2 companies (test) with invoices: one paid, one open, one overdue; a company guest in house and one coming");
  console.log("  Restaurant & bar orders at every kitchen step, plus a week of past orders");
  console.log("  Guest requests, 2 airport pickups, 2 handover notes, 1 expense waiting for approval\n");
}

/** Everything at once: the desk today, check-outs, a week of money and the rest. */
/**
 * Meeting Room 102 practice bookings: one in use now (paid in part, lunch on the bill),
 * one later today, one tomorrow for a company, one next week. Added once.
 */
async function meetings() {
  guard();
  const type = await db.roomType.findFirst({ where: { category: "MEETING_ROOM", isActive: true } });
  if (!type) return;
  if (await db.reservation.count({ where: { kind: "MEETING", guest: { phone: { startsWith: PHONE_PREFIX } } } })) return;
  const me = await actor();
  const today = await businessToday();
  const TZ = "Africa/Dar_es_Salaam";
  const now = new Date();
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "2-digit", hourCycle: "h23", timeZone: TZ }).format(now));
  const at = (date: string, h: number) => zonedInstant(date, h * 60, TZ);
  const made: string[] = [];
  const book = async (o: { n: number; name: string; company: string; date: string; from: number; to: number; people: number; needs?: string; startNow?: boolean }) => {
    const r = await createReservation({
      sourceCode: "PHONE", guest: { fullName: `${o.name} (test)`, phone: phone(o.n) }, companyName: `${o.company} (test)`,
      stay: { kind: "meeting", startAt: o.startNow ? new Date(now.getTime() - 60 * 60_000) : at(o.date, o.from), endAt: at(o.date, o.to) },
      rooms: [{ roomTypeId: type.id, adults: o.people, children: 0 }], status: "CONFIRMED", specialRequests: o.needs ?? null,
    }, me);
    made.push(`${r.reference}  ${o.company} (test) — meeting ${o.date}`);
    return r;
  };
  try {
    // In use now (the booking started an hour ago and runs 3 more hours).
    const inUse = await book({ n: 70, name: "Halima Nyerere", company: "Dar Port Logistics", date: today, from: hour - 1, to: Math.min(hour + 3, 27), people: 8, needs: "Projector, tea break at 10:30", startNow: true });
    await checkIn(inUse.id, me);
    await addReservationCharge({ reservationId: inUse.id, description: "Lunch for 8", amount: 80_000, category: "RESTAURANT" }, me);
    await recordReservationPayment({ reservationId: inUse.id, amount: 100_000, accountId: (await db.moneyAccount.findUniqueOrThrow({ where: { code: "CASH_DRAWER" } })).id }, me);
  } catch (e) { console.log("  (meeting in use now skipped:", (e as Error).message, ")"); }
  if (hour + 4 <= 19) await book({ n: 71, name: "Joseph Temba", company: "Tanzanite Traders", date: today, from: hour + 4, to: hour + 6, people: 6 }).catch(() => null);
  await book({ n: 72, name: "Rehema Ally", company: "ABC Company", date: addDays(today, 1), from: 9, to: 13, people: 10, needs: "U-shape seating" });
  await book({ n: 73, name: "David Mushi", company: "Kilimanjaro Consulting", date: addDays(today, 6), from: 14, to: 17, people: 10 });
  console.log(`\nMeeting Room 102 practice bookings:\n  ${made.join("\n  ")}`);
}

/**
 * Group bookings: a company team arriving today (some rooms already in) and a
 * family arriving tomorrow — parents in one room, the children in others. Added once.
 */
async function groups() {
  guard();
  if (await db.bookingGroup.count({ where: { name: { endsWith: "(test)" } } })) return;
  const me = await actor();
  const today = await businessToday();
  const types = await db.roomType.findMany({ where: { category: "GUEST_ROOM", isActive: true } });
  const type = (code: string) => types.find((t) => t.code === code)!.id;
  const company = await db.corporateCustomer.findFirst({ where: { companyName: { endsWith: "(test)" }, status: "ACTIVE" } });
  const person = (name: string, n: number) => ({ fullName: `${name} (test)`, phone: phone(n) });
  const made: string[] = [];
  const tryGroup = async (label: string, run: () => Promise<{ id: string; reference: string }>) => {
    try { const g = await run(); made.push(`${g.reference}  ${label}`); return g; }
    catch (e) { console.log(`  (${label} skipped: ${(e as Error).message})`); return null; }
  };
  const team: GroupRoomInput[] = [
    { roomTypeId: type("EXECUTIVE"), guest: person("Salum Director", 60), adults: 1, children: 0 },
    { roomTypeId: type("DOUBLE_DELUXE"), guest: person("Aisha Accountant", 61), adults: 1, children: 0 },
    { roomTypeId: type("DOUBLE_DELUXE"), guest: person("John Engineer", 62), adults: 1, children: 0 },
    { roomTypeId: type("STANDARD"), guest: person("Mary Driver", 63), adults: 1, children: 0, ownBill: true },
  ];
  const g1 = await tryGroup(`${company?.companyName ?? "Company team (test)"} — 4 rooms today`, () => createGroupBooking({
    name: company?.companyName ?? "Company team (test)", type: "COMPANY", corporateCustomerId: company?.id ?? null,
    contact: person("Salum Director", 60), sourceCode: "CORPORATE", billing: "COMBINED", arrivalDate: today, departureDate: addDays(today, 2),
    rooms: team, notes: "Staff training week — rooms close together if possible (test)", creditOverride: { reason: "Practice data" },
  }, me));
  if (g1) {
    // Two of the team are already in; the other two are still to come.
    const rs = await db.reservation.findMany({ where: { groupId: g1.id }, orderBy: { createdAt: "asc" }, select: { id: true } });
    await checkInGroup(g1.id, me, rs.slice(0, 2).map((r) => r.id)).catch(() => null);
  }
  await tryGroup("Chuwa family (test) — 3 rooms tomorrow", () => createGroupBooking({
    name: "Chuwa family (test)", type: "FAMILY", contact: person("Nino Chuwa", 64), sourceCode: "WHATSAPP", billing: "COMBINED",
    arrivalDate: addDays(today, 1), departureDate: addDays(today, 4),
    rooms: [
      { roomTypeId: type("EXECUTIVE_SUITE"), guest: person("Nino Chuwa", 64), occupants: [{ fullName: "Mama Chuwa (test)" }], adults: 2, children: 0 },
      { roomTypeId: type("DOUBLE_DELUXE"), guest: person("Baraka Chuwa", 65), adults: 1, children: 0 },
      { roomTypeId: type("DOUBLE_DELUXE"), guest: person("Neema Chuwa", 66), occupants: [{ fullName: "Upendo Chuwa (test)" }], adults: 1, children: 1 },
    ],
  }, me));
  if (made.length) console.log(`\nGroup bookings:\n  ${made.join("\n  ")}`);
}

async function full() {
  guard();
  await meetings();
  await groups();
  const [desk, cash, rest] = await Promise.all([
    db.guest.count({ where: { phone: { in: Array.from({ length: 9 }, (_, i) => phone(i + 1)) } } }),
    db.revenueTransaction.count({ where: { notes: TAG } }),
    db.corporateCustomer.count({ where: { companyName: { endsWith: "(test)" } } }),
  ]);
  if (desk && cash && rest) {
    const [bookings, orders] = await Promise.all([
      db.reservation.count({ where: { guest: { phone: { startsWith: PHONE_PREFIX } } } }),
      db.restaurantOrder.count({ where: { OR: [{ customerName: { endsWith: "(test)" } }, { reservation: { guest: { phone: { startsWith: PHONE_PREFIX } } } }] } }),
    ]);
    console.log(`\nThe practice data is already in the system (${bookings} practice bookings, ${orders} restaurant orders), so nothing was added.`);
    console.log("To start fresh:  npm run test-data:clear   then   npm run test-data:full\n");
    return;
  }
  await load();
  if (!(await db.guest.count({ where: { fullName: "Paul Otieno (test)" } }))) await departures();
  await money();
  await world();
  console.log("All practice data is in. Remove it all with:  npm run test-data:clear\n");
}

async function clear() {
  guard();
  // Practice money (sales, expenses, movements) is marked in its notes.
  const exps = await db.expense.findMany({ where: { notes: TAG }, select: { id: true, itemId: true } });
  for (const e of exps) if (e.itemId) await db.expenseItem.update({ where: { id: e.itemId }, data: { useCount: { decrement: 1 } } });
  await db.expenseApproval.deleteMany({ where: { expenseId: { in: exps.map((e) => e.id) } } });
  await db.expense.deleteMany({ where: { id: { in: exps.map((e) => e.id) } } });
  const sales = await db.revenueTransaction.deleteMany({ where: { notes: TAG } });
  const moves = await db.ledgerEntry.deleteMany({ where: { notes: TAG } });
  if (exps.length || sales.count || moves.count) console.log(`Removed practice money: ${sales.count} sales, ${exps.length} expenses, ${moves.count} movements.`);
  const guests = await db.guest.findMany({ where: { phone: { startsWith: PHONE_PREFIX } }, select: { id: true } });
  // Practice groups: their rooms, room guests and people sharing the rooms go too.
  const practiceGroups = await db.bookingGroup.findMany({
    where: { name: { endsWith: "(test)" } },
    select: { id: true, contactGuestId: true, reservations: { select: { guestId: true, guests: { select: { guestId: true } } } } },
  });
  const groupIds = practiceGroups.map((g) => g.id);
  const gIds = [...new Set([...guests.map((g) => g.id), ...practiceGroups.flatMap((g) => [g.contactGuestId, ...g.reservations.flatMap((r) => [r.guestId, ...r.guests.map((x) => x.guestId)])])])];
  const resv = await db.reservation.findMany({ where: { OR: [{ guestId: { in: gIds } }, { groupId: { in: groupIds } }] }, select: { id: true, rooms: { select: { id: true, roomId: true, status: true } } } });
  const rIds = resv.map((r) => r.id);
  const rrIds = resv.flatMap((r) => r.rooms.map((x) => x.id));
  const occupied = resv.flatMap((r) => r.rooms.filter((x) => x.status === "CHECKED_IN").map((x) => x.roomId));

  await db.$transaction(async (tx) => {
    const reqs = await tx.bookingRequest.findMany({ where: { OR: [{ phone: { startsWith: PHONE_PREFIX } }, { guestId: { in: gIds } }] }, select: { id: true } });
    await tx.bookingRequestEvent.deleteMany({ where: { requestId: { in: reqs.map((r) => r.id) } } });
    await tx.bookingRequest.deleteMany({ where: { id: { in: reqs.map((r) => r.id) } } });
    await tx.roomNight.deleteMany({ where: { reservationRoomId: { in: rrIds } } });
    await tx.roomAssignment.deleteMany({ where: { reservationRoomId: { in: rrIds } } });
    await tx.serviceRequest.deleteMany({ where: { reservationId: { in: rIds } } });
    await tx.transportTrip.deleteMany({ where: { reservationId: { in: rIds } } });
    // Restaurant & bar orders of practice guests (their sales and room-bill lines go with them).
    const orders = await tx.restaurantOrder.findMany({ where: { OR: [{ reservationId: { in: rIds } }, { customerName: { endsWith: "(test)" } }] }, select: { id: true } });
    await tx.revenueTransaction.deleteMany({ where: { restaurantOrderId: { in: orders.map((o) => o.id) } } });
    await tx.reservationCharge.deleteMany({ where: { restaurantOrderId: { in: orders.map((o) => o.id) } } });
    await tx.restaurantOrder.deleteMany({ where: { id: { in: orders.map((o) => o.id) } } });
    // Practice companies: their payments and invoices go first (invoice lines point at the stays).
    const companies = await tx.corporateCustomer.findMany({ where: { companyName: { endsWith: "(test)" } }, select: { id: true } });
    const cIds = companies.map((c) => c.id);
    const invs = await tx.invoice.findMany({ where: { OR: [{ corporateCustomerId: { in: cIds } }, { reservationId: { in: rIds } }, { groupId: { in: groupIds } }, { items: { some: { reservationId: { in: rIds } } } }] }, select: { id: true } });
    const invIds = invs.map((i) => i.id);
    await tx.payment.deleteMany({ where: { OR: [{ invoiceId: { in: invIds } }, { corporateCustomerId: { in: cIds } }] } });
    await tx.invoice.deleteMany({ where: { id: { in: invIds } } });
    await tx.payment.deleteMany({ where: { reservationId: { in: rIds } } });
    await tx.invoice.deleteMany({ where: { reservationId: { in: rIds } } });
    await tx.reservationCharge.deleteMany({ where: { reservationId: { in: rIds } } });
    await tx.reservationGuest.deleteMany({ where: { reservationId: { in: rIds } } });
    await tx.reservationRoom.deleteMany({ where: { id: { in: rrIds } } });
    await tx.reservation.deleteMany({ where: { id: { in: rIds } } });
    await tx.bookingGroup.deleteMany({ where: { id: { in: groupIds } } });
    await tx.guest.deleteMany({ where: { id: { in: gIds }, reservations: { none: {} }, invoices: { none: {} } } });
    await tx.corporateCustomer.deleteMany({ where: { id: { in: cIds } } });
    await tx.shiftHandoverNote.deleteMany({ where: { body: { endsWith: "(test)" } } });
    // Practice guests were never real: the rooms they held go straight back on sale.
    if (occupied.length) await tx.room.updateMany({ where: { id: { in: occupied }, status: "OCCUPIED" }, data: { status: "AVAILABLE" } });
  }, { timeout: 30_000 });
  console.log(`Removed practice data: ${rIds.length} reservations, ${gIds.length} guests.`);
}

const cmd = process.argv[2];
(cmd === "clear" ? clear() : cmd === "load" ? load() : cmd === "departures" ? departures() : cmd === "money" ? money() : cmd === "world" ? world() : cmd === "full" ? full() : Promise.reject(new Error("Use: full | load | departures | money | world | clear")))
  .then(() => process.exit(0))
  .catch((e) => {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(/fully booked/i.test(msg) ? "Could not add practice guests: no free rooms left for those dates. Run `npm run test-data:clear` or free some rooms, then try again." : msg);
    process.exit(1);
  });
