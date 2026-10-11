import { redirect } from "next/navigation";
import { can, requirePagePermission } from "@/server/auth";

export const dynamic = "force-dynamic";

/** Daily lists opens on the list this person may see: the housekeeping checklist first, else the guest list. */
export default async function DailyListsIndex() {
  const user = await requirePagePermission("dashboard.front_desk");
  if (can(user, "rooms.view")) redirect("/staff/lists/housekeeping");
  if (can(user, "reservations.view")) redirect("/staff/lists/guests");
  redirect("/staff/forbidden");
}
