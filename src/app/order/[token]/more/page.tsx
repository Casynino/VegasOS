import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSettings } from "@/server/settings";
import { orderByTrackToken, restaurantMenu } from "@/server/services/online-orders";
import { RestaurantApp } from "@/components/restaurant/restaurant-app";
import { restaurantShell } from "@/components/restaurant/shell";

export const metadata: Metadata = { title: "Order more", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

const CAN_ADD = ["PENDING", "ACCEPTED", "PREPARING", "DELIVERED"];

/** "Order more": the restaurant app, adding to the customer's own open order — the same order, one bill. */
export default async function OrderMorePage({ params }: PageProps<"/order/[token]/more">) {
  const { token } = await params;
  const [o, s] = await Promise.all([orderByTrackToken(token), getSettings()]);
  if (!o) notFound();
  if (!CAN_ADD.includes(o.status)) {
    const onWay = ["READY", "OUT_FOR_DELIVERY"].includes(o.status);
    return (
      <main className="vr grid min-h-svh place-items-center bg-(--vr-bg) px-6 text-center text-(--vr-ink)">
        <div className="max-w-sm">
          <h1 className="font-display text-3xl font-semibold">{onWay ? "Your order is on its way" : "This order is closed"}</h1>
          <p className="mt-2 text-sm text-(--vr-muted)">{onWay ? "Add more once it has arrived — or ask the waiter." : "Scan the QR again to start a new order, or ask a waiter."}</p>
          <Link href={`/order/${token}`} className="mt-6 inline-flex h-12 items-center rounded-full bg-(--vr-dark) px-6 text-sm font-semibold text-white">Back to order #{o.number}</Link>
        </div>
      </main>
    );
  }
  const menu = await restaurantMenu();
  const { brand, status } = restaurantShell(s);
  const place = o.roomNumber && o.type === "ROOM_SERVICE" ? `Room ${o.roomNumber}` : o.tableLabel ?? "Your order";
  return (
    <RestaurantApp brand={brand} status={status} menu={menu} canOrder={s.publicOrderingEnabled}
      place={{ kind: "more", number: o.number, place, total: o.total, backHref: `/order/${token}` }} checkout={{ kind: "more", token, number: o.number }} />
  );
}
