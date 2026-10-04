import type { Metadata } from "next";
import { getSettings } from "@/server/settings";
import { restaurantMenu } from "@/server/services/online-orders";
import { customerPayAccounts } from "@/server/services/payment-accounts";
import { onlinePayAvailable } from "@/server/services/online-pay";
import { RestaurantApp } from "@/components/restaurant/restaurant-app";
import { restaurantShell } from "@/components/restaurant/shell";

export const metadata: Metadata = {
  title: "Order food & drinks",
  description: "Order from the Vegas Luxury Hotel restaurant and bar — dine in, takeaway or pickup.",
};
export const dynamic = "force-dynamic";

/** The public menu for ordering (website / public menu QR · ?qr=1, optional ?table=Table 4): the restaurant app, no room or table attached. */
export default async function OrderPage({ searchParams }: PageProps<"/order">) {
  const sp = await searchParams;
  const table = typeof sp.table === "string" ? sp.table.slice(0, 40) : null;
  const [s, menu] = await Promise.all([getSettings(), restaurantMenu()]);
  const { brand, status } = restaurantShell(s);
  return <RestaurantApp brand={brand} status={status} menu={menu} place={{ kind: "public", table }} checkout={{ kind: "public", table, fromQr: sp.qr === "1", payTo: await customerPayAccounts(), online: await onlinePayAvailable("restaurant", s) }} canOrder={s.publicOrderingEnabled} />;
}
