import type { Metadata } from "next";
import { shareCard } from "@/lib/share-card";
import { getSettings } from "@/server/settings";
import { restaurantMenu } from "@/server/services/online-orders";
import { onlinePayAvailable } from "@/server/services/online-pay";
import { freeTables } from "@/server/services/restaurant-locations";
import { RestaurantApp } from "@/components/restaurant/restaurant-app";
import { restaurantShell } from "@/components/restaurant/shell";
import { getT, guestLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  await guestLocale();
  const t = await getT();
  return {
    title: t("Order food & drinks"),
    description: t("Order from the Vegas Luxury Hotel restaurant and bar — dine in, takeaway or pickup."),
    ...shareCard("menu", t("Our menu — Vegas Luxury Hotel"), t("Eat here or take out — order from our restaurant & bar online and pay by mobile money."), t.locale === "zh-CN" ? "zh_CN" : undefined),
  };
}
export const dynamic = "force-dynamic";

/** The public menu for ordering (website / public menu QR · ?qr=1, optional ?table=Table 4): the restaurant app, no room or table attached. */
export default async function OrderPage({ searchParams }: PageProps<"/order">) {
  await guestLocale();
  const sp = await searchParams;
  const table = typeof sp.table === "string" ? sp.table.slice(0, 40) : null;
  const [s, menu] = await Promise.all([getSettings(), restaurantMenu()]);
  const { brand, status } = restaurantShell(s);
  return <RestaurantApp brand={brand} status={status} menu={menu} place={{ kind: "public", table }} checkout={{ kind: "public", table, fromQr: sp.qr === "1", online: await onlinePayAvailable("restaurant", s), tables: await freeTables() }} canOrder={s.publicOrderingEnabled} />;
}
