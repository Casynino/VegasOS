import { getCurrentUserQuiet } from "@/server/auth";
import { restaurantPulse } from "@/server/services/restaurant";

export const dynamic = "force-dynamic";

/** The restaurant portal asks every few seconds "has anything changed?" — a tiny answer, never order details. A background poll: it never counts as a person using the system (a Developer's idle clock keeps running). */
export async function GET() {
  const user = await getCurrentUserQuiet();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!["restaurant.orders", "kitchen.orders", "restaurant.menu"].some((p) => user.permissions.has(p as never))) return new Response("Forbidden", { status: 403 });
  return Response.json({ v: await restaurantPulse() }, { headers: { "Cache-Control": "no-store" } });
}
