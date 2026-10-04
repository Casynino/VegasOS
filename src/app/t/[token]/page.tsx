import type { Metadata } from "next";
import { cookies } from "next/headers";
import Link from "next/link";
import { QrCode } from "lucide-react";
import { getSettings } from "@/server/settings";
import { prettyPhone } from "@/lib/guest-messages";
import { restaurantMenu } from "@/server/services/online-orders";
import { freeTables, scanLocationQr } from "@/server/services/restaurant-locations";
import { guestTableState, SEAT_COOKIE } from "@/server/services/dining-sessions";
import { customerPayAccounts } from "@/server/services/payment-accounts";
import { onlinePayAvailable, tableBillPayOnline } from "@/server/services/online-pay";
import { RestaurantApp, type AppPlace } from "@/components/restaurant/restaurant-app";
import { restaurantShell } from "@/components/restaurant/shell";

export const metadata: Metadata = { title: "Order", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/**
 * A restaurant QR (/t/<token>): a table, the outside counter or the main restaurant. It opens
 * the restaurant app for that place — the order goes to that table / the counter, into the
 * restaurant portal. An old (regenerated) or switched-off code shows a friendly message. At a table
 * the page knows whose table it is: this phone's own (their session and running bill), someone
 * else's, reserved — or free (the first "+" asks who they are, once).
 */
export default async function TableQrPage({ params }: PageProps<"/t/[token]">) {
  const { token } = await params;
  const [spot, s] = await Promise.all([scanLocationQr(token), getSettings()]);
  if (!spot || !spot.qrActive) {
    const phone = prettyPhone(s.whatsapp || s.phone);
    return (
      <main className="vr grid min-h-svh place-items-center bg-(--vr-bg) px-6 text-center text-(--vr-ink)">
        <div className="max-w-sm">
          <span className="mx-auto grid size-16 place-items-center rounded-full bg-(--vr-gold-soft) text-(--vr-gold-ink)"><QrCode className="size-7" /></span>
          <h1 className="mt-5 font-display text-3xl font-semibold">This QR code is not active</h1>
          <p className="mt-2 text-sm text-(--vr-muted)">Please ask a waiter to take your order{phone ? `, or call us on ${phone}` : ""}.</p>
          <Link href="/order" className="mt-6 inline-flex h-12 items-center rounded-full bg-(--vr-dark) px-6 text-sm font-semibold text-white">See our menu</Link>
        </div>
      </main>
    );
  }
  const menu = await restaurantMenu();
  const [title, area] = spot.name.split(" — ");
  const place: AppPlace = spot.kind === "TABLE" ? { kind: "table", title, area: area ?? null } : spot.kind === "COUNTER" ? { kind: "counter", area: area ?? null } : { kind: "main" };
  const { brand, status } = restaurantShell(s);
  const seat = (await cookies()).get(SEAT_COOKIE)?.value ?? null;
  const state = spot.kind === "TABLE" ? await guestTableState(spot.id, seat) : null;
  // Their own table: Pay online for what is due on it.
  const table = state?.mine && state.mine.due > 0 ? { ...state, pay: await tableBillPayOnline(seat) } : state;
  return <RestaurantApp brand={brand} status={status} menu={menu} place={place} checkout={{ kind: "spot", token, spot: spot.kind, payTo: await customerPayAccounts(), online: await onlinePayAvailable("restaurant", s), tables: spot.kind === "MAIN" ? await freeTables() : undefined }} canOrder={s.publicOrderingEnabled} table={table} />;
}
