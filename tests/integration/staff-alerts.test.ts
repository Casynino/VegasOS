import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { createRestaurantOrder, recordOrderPayment, setOrderItemPrepared, setOrderStatus } from "@/server/services/restaurant";
import { requestSessionBill } from "@/server/services/dining-sessions";
import { staffAlerts } from "@/server/services/staff-alerts";
import { chefActor, counterActor, receptionistActor, resetBusinessData, waiterActor, withoutConfirming } from "../support/helpers";

beforeEach(async () => {
  await resetBusinessData();
  await db.menuItem.updateMany({ where: { id: SAFARI }, data: { isAvailable: true, isActive: true } });
  await db.hotelSettings.updateMany({ data: { orderPaymentConfirm: true } });
});
const SAFARI = "mi_beers_safari";
const kinds = async (who: { permissions?: ReadonlySet<string> }) => (await staffAlerts(who.permissions ?? new Set())).map((a) => a.kind).sort();

describe("the bell: what is waiting for each person", () => {
  it("the kitchen hears new orders, waiters ready orders and bills — nobody hears payments to confirm (there are none)", async () => {
    const [chef, waiter, desk, counter] = [await chefActor(), await waiterActor(), await receptionistActor(), await counterActor()];
    const o = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_1", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 1 }] }, waiter, new Date(), { customerPhone: "0712 300 300" });
    expect(await kinds(chef)).toEqual(["order_new"]);
    expect(await kinds(desk)).toEqual([]);
    await setOrderStatus(o.id, "PREPARING", chef);
    for (const i of await db.restaurantOrderItem.findMany({ where: { orderId: o.id } })) await setOrderItemPrepared(o.id, i.id, true, chef);
    await setOrderStatus(o.id, "READY", chef);
    expect(await kinds(chef)).toEqual([]);
    expect(await kinds(waiter)).toEqual(["order_ready"]);
    await requestSessionBill(o.sessionId!, waiter);
    expect(await kinds(waiter)).toEqual(["bill", "order_ready"]);
    // Paid at the Restaurant Counter: final at once — nothing for reception to confirm, and the table is paid (no bill waiting).
    await recordOrderPayment(o.id, { accountId: "acct_cash", handedOverById: waiter.userId }, counter);
    expect(await kinds(desk)).toEqual([]);
    expect(await kinds(waiter)).toEqual(["order_ready"]);
    // Even an account that may not confirm records a final payment — nobody confirms payments by hand.
    const p = await createRestaurantOrder({ type: "DINE_IN", locationId: "loc_in_1", settlement: "UNPAID", items: [{ menuItemId: SAFARI, quantity: 1 }] }, waiter, new Date(), { customerPhone: "0712 300 300" });
    await recordOrderPayment(p.id, { accountId: "acct_cash" }, withoutConfirming(counter));
    expect(await kinds(desk)).toEqual([]);
    expect(await staffAlerts(desk.permissions!)).toEqual([]);
  });
});
