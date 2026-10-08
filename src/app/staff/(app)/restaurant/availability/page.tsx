import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { requirePagePermission } from "@/server/auth";
import { orderMenuSections } from "@/server/services/online-orders";
import { KitchenMenu } from "./kitchen-menu";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Kitchen menu") };
}
export const dynamic = "force-dynamic";

/** The menu for the kitchen and bar: every dish with its photo — mark it sold out (or back) in one tap. */
export default async function KitchenMenuPage() {
  await requirePagePermission("kitchen.orders", "restaurant.menu"); // the kitchen and the waiters (bar) — not reception
  const sections = await orderMenuSections();
  return (
    <div className="w-full space-y-4">
      <KitchenMenu sections={sections} />
    </div>
  );
}
