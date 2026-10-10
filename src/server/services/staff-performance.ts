import "server-only";
import { db } from "../db";
import { staffActivity } from "./finance";
import { addDays, diffDays, eachDate, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { ROLE_DEPARTMENT } from "@/lib/permissions";
import { activityArea, friendlyAction } from "@/lib/activity-words";
import { msg } from "@/i18n/msg";
import { getT } from "@/i18n/server";

type Range = { from: BusinessDate; to: BusinessDate };
const dbRange = (r: Range) => ({ gte: toDbDate(r.from), lte: toDbDate(r.to) });
const NOT_COUNTED = ["auth.logout"];
const TZ = "Africa/Dar_es_Salaam";
/** "08:12" in hotel time. */
const clock = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(d);

/**
 * Everyone on the team for a period — who was active, when they usually started, how much they did
 * and the money they handled — for the Staff activity page (visibility and fairness, not punishment).
 */
export async function staffPerformance(r: Range) {
  const bd = dbRange(r);
  const days = eachDate(r.from, addDays(r.to, 1));
  const [money, perDay, firstActions, orders, users] = await Promise.all([
    staffActivity(r.from, r.to),
    db.auditLog.groupBy({ by: ["userId", "businessDate"], where: { businessDate: bd, userId: { not: null }, action: { notIn: NOT_COUNTED } }, _count: true, _min: { createdAt: true }, _max: { createdAt: true } }),
    db.auditLog.groupBy({ by: ["userId"], where: { businessDate: bd, userId: { not: null }, action: { notIn: NOT_COUNTED } }, _count: true, _max: { createdAt: true } }),
    db.restaurantOrder.groupBy({ by: ["createdById"], where: { businessDate: bd, status: { not: "CANCELLED" }, createdById: { not: null } }, _count: true, _sum: { total: true } }),
    db.user.findMany({ where: { isActive: true }, select: { id: true, fullName: true, role: { select: { name: true, code: true } } } }),
  ]);
  const people = users.map((u) => {
    const m = money.find((x) => x.id === u.id);
    const mine = perDay.filter((x) => x.userId === u.id);
    const startTimes = mine.map((x) => x._min.createdAt).filter((d): d is Date => !!d).map(clock).sort();
    const o = orders.find((x) => x.createdById === u.id);
    return {
      id: u.id, name: u.fullName, role: u.role.name, department: ROLE_DEPARTMENT[u.role.code] ?? msg("Other"),
      actions: firstActions.find((x) => x.userId === u.id)?._count ?? 0,
      daysActive: mine.length,
      // Their usual start: the middle of their first-action times across the days they worked.
      usualStart: startTimes.length ? startTimes[Math.floor(startTimes.length / 2)] : null,
      lastSeen: firstActions.find((x) => x.userId === u.id)?._max.createdAt?.toISOString() ?? null,
      series: days.map((d) => mine.find((x) => fromDbDate(x.businessDate) === d)?._count ?? 0),
      money: (m?.payments ?? 0) + (m?.sales ?? 0) - (m?.refunds ?? 0),
      checkIns: m?.checkIns ?? 0, checkOuts: m?.checkOuts ?? 0, bookings: m?.bookings ?? 0,
      orders: o?._count ?? 0, expenses: m?.expenses ?? 0,
    };
  });
  return { days, people: people.sort((a, b) => b.actions - a.actions || a.name.localeCompare(b.name)) };
}
export type StaffPerson = Awaited<ReturnType<typeof staffPerformance>>["people"][number];

/** One person's period in detail: day by day (sign-in, shift, first and last action, money) and what they did. */
export async function staffDetail(userId: string, r: Range) {
  const bd = dbRange(r);
  const [logs, shifts, pays, sales, total] = await Promise.all([
    db.auditLog.findMany({
      where: { businessDate: bd, userId }, orderBy: { createdAt: "desc" }, take: 3000,
      select: { id: true, action: true, entityType: true, entityId: true, createdAt: true, businessDate: true },
    }),
    db.actualShift.findMany({ where: { businessDate: bd, userId }, select: { businessDate: true, startedAt: true, endedAt: true } }),
    db.payment.groupBy({ by: ["businessDate", "kind"], where: { businessDate: bd, recordedById: userId, status: "POSTED" }, _sum: { amount: true } }),
    db.revenueTransaction.groupBy({ by: ["businessDate"], where: { businessDate: bd, recordedById: userId, isVoided: false }, _sum: { amount: true } }),
    db.auditLog.count({ where: { businessDate: bd, userId, action: { notIn: NOT_COUNTED } } }),
  ]);
  const t = await getT();
  const dates = [...new Set([...logs.map((l) => fromDbDate(l.businessDate)), ...shifts.map((s) => fromDbDate(s.businessDate))])].sort().reverse();
  const perDay = dates.map((d) => {
    const today = logs.filter((l) => fromDbDate(l.businessDate) === d);
    const work = today.filter((l) => !NOT_COUNTED.includes(l.action));
    const signIns = today.filter((l) => l.action === "auth.login").map((l) => l.createdAt).sort((a, b) => +a - +b);
    const shift = shifts.filter((s) => fromDbDate(s.businessDate) === d).sort((a, b) => +a.startedAt - +b.startedAt);
    const times = work.map((l) => l.createdAt).sort((a, b) => +a - +b);
    const paid = pays.filter((p) => fromDbDate(p.businessDate) === d).reduce((t, p) => t + (p.kind === "REFUND" ? -1 : 1) * (p._sum.amount ?? 0), 0);
    const sold = sales.filter((x) => fromDbDate(x.businessDate) === d).reduce((t, x) => t + (x._sum.amount ?? 0), 0);
    const areas = new Map<string, number>();
    for (const l of work) { const a = activityArea(l.action); if (a !== "Sign-in") areas.set(a, (areas.get(a) ?? 0) + 1); }
    return {
      date: d,
      signedIn: signIns[0] ? clock(signIns[0]) : null,
      shiftStart: shift[0] ? clock(shift[0].startedAt) : null,
      shiftEnd: shift.length && shift[shift.length - 1].endedAt ? clock(shift[shift.length - 1].endedAt!) : shift.length ? t("still on") : null,
      first: times[0] ? clock(times[0]) : null,
      last: times.length ? clock(times[times.length - 1]) : null,
      actions: work.length,
      money: paid + sold,
      areas: [...areas.entries()].sort((a, b) => b[1] - a[1]).map(([name, count]) => ({ name, count })),
    };
  });
  const href = (t: string, id: string | null) => !id ? null
    : t === "Reservation" ? `/staff/reservations/${id}` : t === "RestaurantOrder" ? `/staff/restaurant/orders/${id}` : t === "Guest" ? `/staff/guests/${id}` : t === "BookingRequest" ? `/staff/booking-requests/${id}` : t === "StockRequest" ? "/staff/stock-requests" : null;
  const timeline = logs.filter((l) => !NOT_COUNTED.includes(l.action)).slice(0, 60).map((l) => ({
    id: l.id, what: friendlyAction(l.action), area: activityArea(l.action), at: l.createdAt.toISOString(), when: clock(l.createdAt), date: fromDbDate(l.businessDate), href: href(l.entityType, l.entityId),
  }));
  return { total, days: diffDays(r.from, r.to) + 1, perDay, timeline };
}
export type StaffDetail = Awaited<ReturnType<typeof staffDetail>>;
