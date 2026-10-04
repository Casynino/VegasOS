import { getCurrentUser, getMyOpenShift, refreshDeviceCookies } from "@/server/auth";
import { isRestaurantDevice, needsOwnShift } from "@/lib/permissions";
import { staffAlerts } from "@/server/services/staff-alerts";

export const dynamic = "force-dynamic";

/** The top-bar bell asks every few seconds "what is waiting for me?" — only this person's own things. */
export async function GET() {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  // The restaurant screen stays signed in: its cookies are renewed as it keeps asking.
  if (isRestaurantDevice(user.permissions)) await refreshDeviceCookies();
  // A receptionist off shift is not rung for the work the one on duty handles.
  const offShift = needsOwnShift(user.permissions) && !(await getMyOpenShift(user.id));
  const items = offShift ? [] : await staffAlerts(user.permissions, user.id);
  // The bell's on / off too — switched in another browser or on another device, it follows here.
  return Response.json({ items, soundOff: user.soundOff }, { headers: { "Cache-Control": "no-store" } });
}
