import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { can, requirePagePermission } from "@/server/auth";
import { inHouseGuestIds, isDeskUser, isHotelOrder } from "@/server/desk";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import { accountOptions } from "@/server/services/payment-accounts";
import { awaitsOnlinePayment, orderBill, type BillScope } from "@/server/services/restaurant";
import { billPlace, OrderReceipt } from "@/components/ordering/order-receipt";
import { WaiterPinProvider } from "@/components/staff/waiter-pin";
import { isRestaurantDevice } from "@/lib/permissions";
import { BillToolbar } from "./bill-toolbar";
import { getT } from "@/i18n/server";
import { deliveryPlace } from "@/lib/delivery-place";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Bill"), robots: { index: false, follow: false } };
}
export const dynamic = "force-dynamic";

/**
 * The customer's bill / receipt — anyone in the restaurant can print it or download it (PDF /
 * image, e.g. for WhatsApp): one order, everything at a table this sitting, or a room's stay.
 * Only staff who record payments see "Record payment" — the Restaurant Counter (the shared account,
 * which may note the waiter who brought the money) and reception. This page is outside the staff
 * shell, so it mounts the Counter's provider itself.
 */
export default async function RestaurantBillPage({ searchParams }: PageProps<"/staff/restaurant-bill">) {
  const user = await requirePagePermission("restaurant.orders", "restaurant.menu", "kitchen.orders");
  const sp = await searchParams;
  const orderId = typeof sp.order === "string" ? sp.order : "";
  const asked = (typeof sp.scope === "string" ? sp.scope : "") as BillScope;
  const first = await orderBill(orderId, "order");
  if (!first) notFound();
  // Reception opens the hotel's own bills only (a restaurant customer's bill is the restaurant's).
  if (isDeskUser(user)) {
    const o = await db.restaurantOrder.findUnique({ where: { id: orderId }, select: { type: true, reservationId: true, settlement: true, source: true, guestId: true } });
    if (!o || !isHotelOrder(o, await inHouseGuestIds())) notFound();
  }
  // Default: the whole table / the whole stay when the order belongs to one.
  const scope: BillScope = asked === "order" || asked === "table" || asked === "room" ? asked : first.can.table ? "table" : first.can.room ? "room" : "order";
  const [bill, settings, accounts, t] = await Promise.all([scope === "order" ? first : orderBill(orderId, scope), getSettings(), accountOptions("payments"), getT()]);
  if (!bill) notFound();
  const { lead, room, place } = billPlace(bill, orderId);
  // The same place in the reader's language (the English `place` above names the file and picks the tabs).
  const placeLabel = bill.scope === "room" ? t("Room {room}", { room: room ?? "" }) : deliveryPlace(lead, t);
  const payTo = accounts.filter((a) => a.number && a.kind !== "CASH");
  // On the Counter, "Brought by" starts with the order's waiter.
  const device = isRestaurantDevice(user.permissions);
  const waiterId = device ? (await db.restaurantOrder.findUnique({ where: { id: orderId }, select: { assignedToId: true } }))?.assignedToId ?? null : null;
  const fileName = `${settings.hotelName.replace(/\s+/g, "-")}-${bill.scope === "order" ? lead.number : `${place.replace(/\s+/g, "-")}-bill`}`;
  // Still to pay here — except what the customer already paid online (their proof): that is confirmed once on the
  // order from the proof, never paid again on this bill.
  const open = bill.orders.filter((o) => o.settlement !== "ROOM" && o.paidAmount < o.total);
  // Managers, the MD and the owner watch — the Restaurant Counter and reception take the money.
  const watches = can(user, "dashboard.manager") || can(user, "dashboard.owner") || can(user, "dashboard.admin");
  // (Paid online and recorded automatically, an order has nothing left — items added later are paid here as usual.)
  // The same rule as everywhere: paid online and nothing ever recorded from the proof (an online payment a manager
  // reversed is due again like any other).
  const hadOnline = new Set((await db.restaurantOrderPayment.findMany({ where: { orderId: { in: open.map((o) => o.id) }, online: true }, select: { orderId: true } })).map((p) => p.orderId));
  const awaiting = (o: (typeof open)[number]) => awaitsOnlinePayment(o, hadOnline.has(o.id));
  const unpaid = open.filter((o) => !awaiting(o));
  const onlineDue = open.filter(awaiting).reduce((sum, o) => sum + (o.total - o.paidAmount), 0);

  return (
    <main className="min-h-svh bg-[#e9e6e1] px-3 py-6 sm:px-4 text-[#1b1611] print:bg-white print:p-0">
      <style>{`@media print { @page { margin: 6mm; } body { background: #fff !important; } }`}</style>
      <div className="mx-auto max-w-[680px] space-y-4">
        <WaiterPinProvider device={device}>
          <BillToolbar orderId={orderId} scope={bill.scope} can={bill.can} place={place} placeLabel={placeLabel} room={room ?? null} count={bill.orders.length} fileName={fileName}
            due={Math.max(0, bill.totals.due - onlineDue)} onlineDue={onlineDue} total={bill.totals.total} unpaid={unpaid.map((o) => o.id)} pay={!watches && can(user, "revenue.record") ? accounts : null} waiterId={waiterId} />
        </WaiterPinProvider>
        <OrderReceipt bill={bill} leadId={orderId} payTo={payTo} t={t}
          hotel={{ name: settings.hotelName, address: settings.addressLine, phone: settings.phone, whatsapp: settings.whatsapp, email: settings.email, website: settings.website }} />
      </div>
    </main>
  );
}
