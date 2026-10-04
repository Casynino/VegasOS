import "server-only";
import { db } from "@/server/db";
import { collectionTotals } from "@/server/services/collections";
import { OPEN_SESSION } from "@/server/services/dining-core";
import type { BoardOrder } from "@/server/services/restaurant";
import type { WaiterDay } from "@/server/services/waiter-day";
import { fromDbDate, type BusinessDate } from "@/lib/time/business-date";
import type { MainScreenData } from "./main-screen";

const firstName = (n: string) => n.replace(/\s*\(.*\)/, "").trim().split(/\s+/)[0];


/**
 * The shared main-restaurant screen's own figures (loaded only for it): the restaurant's money taken
 * today by everyone (payments still waiting for reception included, reversed ones left out) and by
 * each waiter, the tables in use, who is on shift, and the hotel day so far. The live order counts
 * come from the board itself, on the screen.
 */
export async function mainScreenData(today: BusinessDate, { orders, avgPrep, team }: {
  /** The board's orders (open ones and today's). */
  orders: BoardOrder[];
  avgPrep: number | null;
  /** waiterDay(today) for every waiter — already loaded for "Waiters today". */
  team: Promise<WaiterDay[]>;
}): Promise<MainScreenData> {
  // Tables that can take customers now (a blocked table cannot have anyone at it).
  const usable = { kind: "TABLE" as const, isActive: true, blockedAs: null };
  const [money, tables, sessions, shifts, waiters] = await Promise.all([
    collectionTotals(today, today, { sources: ["RESTAURANT"] }),
    db.restaurantLocation.count({ where: usable }),
    db.diningSession.findMany({ where: { status: { in: OPEN_SESSION }, location: usable }, select: { locationId: true, status: true } }),
    db.actualShift.findMany({ where: { department: "RESTAURANT", endedAt: null }, orderBy: { startedAt: "asc" }, select: { userId: true, user: { select: { fullName: true } } } }),
    team,
  ]);
  const all = money.all;

  const day = orders.filter((o) => fromDbDate(o.businessDate) === today);
  const live = day.filter((o) => o.status !== "CANCELLED");
  const onShift = new Map<string, string>();
  for (const s of shifts) if (!onShift.has(s.userId)) onShift.set(s.userId, firstName(s.user.fullName));

  // Paid online (LIPA) today — recorded automatically; the ones the money never reached ("Payment not received").
  const onlinePays = day.flatMap((o) => o.payments.filter((p) => p.online));
  const paidOnline = {
    count: onlinePays.filter((p) => p.status === "POSTED").length,
    amount: onlinePays.filter((p) => p.status === "POSTED").reduce((t, p) => t + p.amount, 0),
    notReceived: onlinePays.filter((p) => p.notReceived).length,
  };

  return {
    paidOnline,
    collected: { total: all.collected, payments: all.payments, toConfirm: all.toConfirm, toConfirmCount: all.toConfirmCount, reversed: all.reversed, byKind: all.byKind },
    waiters: waiters.filter((w) => w.received > 0 || w.payments > 0).sort((a, b) => b.received - a.received)
      .map((w) => ({ id: w.id, name: firstName(w.name), received: w.received, payments: w.payments, toConfirm: w.waitingConfirmation })),
    tables: { total: tables, busy: new Set(sessions.map((s) => s.locationId)).size, billAsked: sessions.filter((s) => s.status === "AWAITING_PAYMENT").length },
    onShift: [...onShift.values()],
    today: {
      orders: live.length, value: live.reduce((t, o) => t + o.total, 0),
      done: live.filter((o) => o.status === "COMPLETED" || o.status === "COLLECTED").length,
      cancelled: day.length - live.length, avgPrep,
    },
  };
}
