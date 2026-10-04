import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { staffHome } from "@/lib/staff-home";

/** Old address — dashboards now live under /admin, /manager and /reception. */
export default async function LegacyDashboard() {
  redirect(staffHome((await requireUser()).permissions));
}
