import { redirect } from "next/navigation";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";

export const dynamic = "force-dynamic";

/** "My shift" — the shift running now, or the last one; with none yet, the shifts page. One tap from anywhere. */
export default async function MyShiftPage() {
  const user = await requirePagePermission("shifts.view", "restaurant.shift");
  const shift = await db.actualShift.findFirst({ where: { userId: user.id }, orderBy: [{ endedAt: { sort: "desc", nulls: "first" } }, { startedAt: "desc" }], select: { id: true } });
  redirect(shift ? `/staff/shifts/${shift.id}` : "/staff/shifts");
}
