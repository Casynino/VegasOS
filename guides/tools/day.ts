/**
 * Finishes the practice day in the guide database ("vegas_guides") after `scripts/test-scenario.ts full`:
 * a week of served restaurant orders (for the reports), guest requests, airport pickups, hand-over notes and an
 * expense waiting for approval — then gives the practice people ordinary names, so the pictures in the books read well.
 *
 *   NODE_OPTIONS="--conditions=react-server --require ./guides/tools/stub-next.cjs" \
 *     node guides/tools/local.mjs run npx tsx --env-file=.env guides/tools/day.ts
 *
 * Only ever runs on the guide database on this computer.
 */
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { createRestaurantOrder, setOrderItemPrepared, setOrderStatus, ORDER_FLOW } from "@/server/services/restaurant";
import { createServiceRequest } from "@/server/services/requests";
import { requestTransportForReservation } from "@/server/services/transport";
import { addHandoverNote } from "@/server/services/shifts";
import { recordExpense } from "@/server/services/expenses";
import { addDays, zonedInstant } from "@/lib/time/business-date";

const TZ = "Africa/Dar_es_Salaam";

async function main() {
  const url = process.env.DATABASE_URL ?? "";
  if (!/@(localhost|127\.0\.0\.1)[:/]/.test(url) || !/\/vegas_guides(\?|$)/.test(url)) throw new Error("This only runs on the guide database on this computer.");
  if (await db.serviceRequest.count()) { console.log("The practice day is already finished."); return; }

  const u = await db.user.findFirstOrThrow({ where: { email: "neema@vegas.test" }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  const me = { userId: u.id, label: u.fullName, permissions: new Set(u.role.permissions.map((p) => p.permission.code)), roleCode: u.role.code };
  const boss = await db.user.findFirstOrThrow({ where: { email: "owner@vegas.test" }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  const owner = { userId: boss.id, label: boss.fullName, permissions: new Set(boss.role.permissions.map((p) => p.permission.code)), roleCode: boss.role.code };
  const today = await businessToday();
  const acct = async (code: string) => (await db.moneyAccount.findUniqueOrThrow({ where: { code } })).id;
  const [cash, lipa, mpesa, crdb] = await Promise.all(["CASH_DRAWER", "MOBILE_MONEY", "LIPA_MPESA", "BANK"].map(acct));
  const I = (id: string, quantity = 1) => ({ menuItemId: id, quantity });

  // The last week in the restaurant and bar, all served and paid.
  const past: [number, number, string, string, { menuItemId: string; quantity: number }[]][] = [
    [6, 20, "Table 1", mpesa, [I("mi_local_favorites_samaki_choma_grilled_fish", 2), I("mi_beers_serengeti_lite", 4)]],
    [5, 13, "Table 3", cash, [I("mi_local_favorites_wali_chicken_curry", 3), I("mi_sides_drinks_fresh_assorted_juices", 3)]],
    [4, 21, "Bar counter", cash, [I("mi_beers_castle_lager", 6), I("mi_starters_soups_bbq_or_spicy_chicken_wings", 2)]],
    [3, 19, "Table 5", lipa, [I("mi_main_courses_spaghetti_bolognese", 2), I("mi_wines_drostdyhof_red_750ml")]],
    [2, 12, "Table 2", mpesa, [I("mi_main_courses_chicken_rice_bowl", 2), I("mi_sides_drinks_fresh_fruit_smoothies", 2)]],
    [1, 22, "Bar counter", cash, [I("mi_spirits_konyagi_250ml", 2), I("mi_beers_safari", 4)]],
  ];
  for (const [daysAgo, hour, table, accountId, items] of past) {
    const at = zonedInstant(addDays(today, -daysAgo), hour * 60, TZ);
    if (await db.restaurantOrder.count({ where: { customerName: table, createdAt: at } })) continue;
    const x = await createRestaurantOrder({ type: "DINE_IN", tableLabel: table, customerName: table, settlement: "PAY_NOW", accountId, items }, owner, at);
    // served and paid, an order completes by itself
    for (const st of ORDER_FLOW.DINE_IN.slice(1).filter((s) => s !== "COMPLETED")) {
      if (st === "READY") for (const it of await db.restaurantOrderItem.findMany({ where: { orderId: x.id }, select: { id: true } })) await setOrderItemPrepared(x.id, it.id, true, owner, at);
      await setOrderStatus(x.id, st, owner, at);
    }
  }

  // Guest requests, airport pickups, hand-over notes.
  const staying = (name: string) => db.reservation.findFirst({ where: { status: "CHECKED_IN", guest: { fullName: `${name} (test)` } }, select: { id: true } });
  const [ahmed, mary, halima, brian] = await Promise.all(["Ahmed Said", "Mary Lyimo", "Halima Omar", "Brian Moshi"].map(staying));
  const reqs: [typeof ahmed, "TOWELS" | "CLEANING" | "MAINTENANCE" | "RESTAURANT", "LOW" | "NORMAL" | "HIGH", string][] = [
    [ahmed, "TOWELS", "NORMAL", "Two extra towels and a bathrobe, please"],
    [mary, "MAINTENANCE", "HIGH", "Air conditioner is not cooling"],
    [halima, "CLEANING", "LOW", "Please clean the room after 14:00"],
    [brian, "RESTAURANT", "NORMAL", "Breakfast in the room at 07:30 tomorrow"],
  ];
  for (const [r, type, priority, description] of reqs) if (r) await createServiceRequest({ reservationId: r.id, type, priority, description }, me);
  const booked = (name: string) => db.reservation.findFirst({ where: { guest: { fullName: `${name} (test)` } }, select: { id: true } });
  const [peter, neema] = await Promise.all([booked("Peter Kim"), booked("Neema Paul")]);
  if (peter) await requestTransportForReservation({ reservationId: peter.id, flightNumber: "KQ 482", arrivalDate: today, arrivalTime: "14:10", passengers: 1, notes: "Arrives from Nairobi" });
  if (neema) await requestTransportForReservation({ reservationId: neema.id, flightNumber: "ET 815", arrivalDate: addDays(today, 3), arrivalTime: "13:25", passengers: 2, notes: "Two suitcases and a child seat" });
  await addHandoverNote(me, { kind: "SHIFT", isImportant: true, body: "Generator service on Monday 09:00 — tell in-house guests about a short power cut" });
  await addHandoverNote(me, { kind: "GUEST", isImportant: false, body: "Guest in the Executive Suite asked for a late check-out tomorrow — agreed until 13:00" });

  // An expense big enough to need a manager's approval.
  await recordExpense({ categoryId: "", itemId: "exi_plumbing", amount: 650_000, description: "Replace the main water pump", accountId: crdb, notes: "Practice day" }, me);

  // Ordinary names for the practice people.
  await db.$executeRawUnsafe(`UPDATE "guests" SET "fullName" = replace("fullName", ' (test)', '') WHERE "fullName" LIKE '% (test)'`);
  await db.$executeRawUnsafe(`UPDATE "corporate_customers" SET "companyName" = replace("companyName", ' (test)', '') WHERE "companyName" LIKE '% (test)'`);
  await db.$executeRawUnsafe(`UPDATE "reservations" SET "companyName" = replace("companyName", ' (test)', '') WHERE "companyName" LIKE '% (test)'`);
  await db.$executeRawUnsafe(`UPDATE "restaurant_orders" SET "customerName" = replace("customerName", ' (test)', '') WHERE "customerName" LIKE '% (test)'`);
  await db.$executeRawUnsafe(`UPDATE "shift_handover_notes" SET "body" = replace("body", ' (test)', '') WHERE "body" LIKE '% (test)'`);
  await db.$executeRawUnsafe(`UPDATE "users" SET "fullName" = replace("fullName", ' (dev)', '') WHERE "fullName" LIKE '% (dev)'`);
  const names: Record<string, string> = { "owner@vegas.test": "Hotel Owner", "admin@vegas.test": "Managing Director", "manager@vegas.test": "Hotel Manager", "chef@vegas.test": "Chef Musa", "waiter@vegas.test": "Salma", "counter@vegas.test": "Restaurant Counter" };
  for (const [email, fullName] of Object.entries(names)) await db.user.updateMany({ where: { email }, data: { fullName, mustChangePassword: false } });

  console.log(`The practice day ${today} is finished: a week of restaurant orders, 4 guest requests, 2 airport pickups, 2 hand-over notes, 1 expense to approve.`);
}

main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
