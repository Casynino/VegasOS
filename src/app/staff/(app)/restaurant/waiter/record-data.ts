import "server-only";
import { db } from "@/server/db";
import { businessDayConfig, businessToday, getSettings } from "@/server/settings";
import { businessRangeBounds } from "@/lib/time/business-date";
import { formatTime } from "@/lib/format";
import { waiterActivity } from "@/server/services/waiter-activity";

/**
 * A waiter's own record for their pages (Collections): one shift at a time — this shift, or one before it (their own
 * only) — or today when they have never had a shift. Built from what they did; weeks and months are for managers.
 */
export async function myRecord(userId: string, shiftId?: string | null) {
  const [shifts, settings, today] = await Promise.all([
    db.actualShift.findMany({ where: { userId, department: "RESTAURANT" }, orderBy: { startedAt: "desc" }, take: 12, select: { id: true, startedAt: true, endedAt: true } }),
    getSettings(), businessToday(),
  ]);
  const now = new Date();
  const shift = shifts.find((x) => x.id === shiftId) ?? shifts.find((x) => !x.endedAt) ?? shifts[0] ?? null;
  const window = shift ? { from: shift.startedAt, to: shift.endedAt ?? now } : { from: businessRangeBounds(today, today, businessDayConfig(settings)).start, to: now };
  const activity = await waiterActivity(userId, window, { windowOnly: !!shift?.endedAt });
  return {
    activity, shifts, timezone: settings.timezone,
    shift: shift ? { id: shift.id, since: formatTime(shift.startedAt), until: shift.endedAt ? formatTime(shift.endedAt) : null, open: !shift.endedAt } : null,
    /** The window runs over more than one day: times say the day too. */
    multiDay: window.to.getTime() - window.from.getTime() > 12 * 3600_000,
  };
}
