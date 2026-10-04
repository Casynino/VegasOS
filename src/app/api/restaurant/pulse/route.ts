import { getCurrentUser } from "@/server/auth";
import { restaurantPulse } from "@/server/services/restaurant";

export const dynamic = "force-dynamic";

/** The restaurant portal asks every few seconds "has anything changed?" — a tiny answer, never order details. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!["restaurant.orders", "kitchen.orders", "restaurant.menu"].some((p) => user.permissions.has(p as never))) return new Response("Forbidden", { status: 403 });
  return Response.json({ v: await restaurantPulse() }, { headers: { "Cache-Control": "no-store" } });
}
