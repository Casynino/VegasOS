import { redirect } from "next/navigation";
import { requireUser } from "@/server/auth";
import { staffHome } from "@/lib/staff-home";

/** One staff entry point: everyone lands on the dashboard for their role. */
export default async function StaffHome() {
  redirect(staffHome((await requireUser()).permissions));
}
