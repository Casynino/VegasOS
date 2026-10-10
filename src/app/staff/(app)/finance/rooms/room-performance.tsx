import { db } from "@/server/db";
import { diffDays, fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { EARNED_NIGHT } from "@/server/services/reservation-financials";
import { formatTZS } from "@/lib/format";
import { getT } from "@/i18n/server";
import { ROOM_STATUS_META } from "@/lib/room-status";
import { FinanceTabs, PeriodPicker, periodLabel } from "@/components/staff/finance/finance-nav";
import { RoomCards, type RoomRow } from "./room-cards";
import type { CardState } from "@/components/staff/rooms/room-card";

/** The room's status as the front desk board shows it (a reserved room is someone arriving). */
const STATE: Record<string, CardState> = {
  AVAILABLE: "AVAILABLE", READY: "READY", RESERVED: "ARRIVING", OCCUPIED: "OCCUPIED", DIRTY: "DIRTY", CLEANING: "CLEANING", MAINTENANCE: "MAINTENANCE", OUT_OF_SERVICE: "OUT_OF_SERVICE",
};

/**
 * Room by room, for a period: what each room earned, how many nights it sold, who stayed and
 * where it stands now — as cards grouped by floor (or ranked by income); tap one for the detail.
 */
export async function RoomPerformance({ p }: { p: { key: string; from: BusinessDate; to: BusinessDate } }) {
  const t = await getT();
  const days = diffDays(p.from, p.to) + 1;
  const [rooms, nights, inHouse] = await Promise.all([
    db.room.findMany({ where: { isActive: true }, include: { roomType: { select: { name: true, category: true } } } }),
    db.roomNight.findMany({
      where: { businessDate: { gte: toDbDate(p.from), lte: toDbDate(p.to) }, ...EARNED_NIGHT },
      select: {
        roomId: true, isDayUse: true, netAmount: true, discountAmount: true, businessDate: true,
        reservationRoom: { select: { reservation: { select: { id: true, reference: true, guest: { select: { id: true, fullName: true } } } } } },
      },
    }),
    db.reservationRoom.findMany({ where: { status: "CHECKED_IN" }, select: { roomId: true, departureDate: true, reservation: { select: { id: true, guest: { select: { fullName: true } } } } } }),
  ]);
  rooms.sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));

  const rows: RoomRow[] = rooms.map((r) => {
    const mine = nights.filter((n) => n.roomId === r.id);
    const byStay = new Map<string, RoomRow["stays"][number]>();
    for (const n of mine) {
      const res = n.reservationRoom.reservation;
      const d = fromDbDate(n.businessDate);
      const s = byStay.get(res.id) ?? { reservationId: res.id, reference: res.reference, guest: res.guest.fullName, guestId: res.guest.id, from: d, to: d, nights: 0, income: 0 };
      s.from = d < s.from ? d : s.from; s.to = d > s.to ? d : s.to;
      s.nights += 1; s.income += n.netAmount;
      byStay.set(res.id, s);
    }
    const now = inHouse.find((x) => x.roomId === r.id);
    const sold = mine.filter((n) => !n.isDayUse).length;
    const meta = ROOM_STATUS_META[r.status];
    return {
      id: r.id, number: r.number, type: r.roomType.name, meeting: r.roomType.category === "MEETING_ROOM",
      status: meta.label, dot: meta.dot, state: STATE[r.status],
      nights: sold, shortTime: mine.filter((n) => n.isDayUse).length,
      income: mine.reduce((s, n) => s + n.netAmount, 0), discount: mine.reduce((s, n) => s + n.discountAmount, 0),
      occupancy: Math.round((sold / days) * 100),
      now: now ? { guest: now.reservation.guest.fullName, reservationId: now.reservation.id, until: fromDbDate(now.departureDate) } : null,
      stays: [...byStay.values()].sort((a, b) => b.to.localeCompare(a.to)),
    };
  });

  const guestRooms = rows.filter((r) => !r.meeting);
  const total = rows.reduce((s, x) => s + x.income, 0);
  const sold = rows.reduce((s, x) => s + x.nights + x.shortTime, 0);
  const soldNights = guestRooms.reduce((s, x) => s + x.nights, 0);
  const occupancy = guestRooms.length ? Math.round((soldNights / (guestRooms.length * days)) * 100) : 0;
  const best = [...rows].sort((a, b) => b.income - a.income)[0];
  const idle = guestRooms.filter((r) => r.nights + r.shortTime === 0).length;

  return (
    <div className="w-full space-y-5">
      <FinanceTabs active="/staff/finance/rooms" />
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-muted-foreground"><span className="font-semibold text-foreground">{periodLabel(p, t)}</span> · {t.plural(days, "{n} day", "{n} days")}</p>
        <PeriodPicker current={p.key} from={p.from} to={p.to} />
      </div>

      {/* The period in one strip */}
      <section className="grid grid-cols-2 overflow-hidden rounded-3xl border border-border/70 bg-card sm:grid-cols-3 xl:grid-cols-6 [&>div]:border-border/60 [&>div]:p-4 [&>div]:border-b xl:[&>div]:border-b-0 [&>div:not(:last-child)]:border-r">
        <Figure label={t("Room income")} value={formatTZS(total)} tone="text-emerald-600 dark:text-emerald-400" />
        <Figure label={t("Rooms sold")} value={String(sold)} sub={`${t.plural(soldNights, "{n} night", "{n} nights")}${sold - soldNights ? ` · ${t("{n} short time", { n: sold - soldNights })}` : ""}`} />
        <Figure label={t("Average rate")} value={sold ? formatTZS(Math.round(total / sold)) : "—"} sub={t("Income ÷ rooms sold")} />
        <Figure label={t("Occupancy")} value={`${occupancy}%`} sub={t("{n} of {total} room-nights", { n: soldNights, total: guestRooms.length * days })} />
        <Figure label={t("Best room")} value={best && best.income > 0 ? best.number : "—"} sub={best && best.income > 0 ? `${t(best.type)} · ${formatTZS(best.income)}` : t("nothing sold yet")} />
        <Figure label={t("Not sold")} value={String(idle)} sub={t.plural(idle, "guest room with no night", "guest rooms with no night")} tone={idle ? "text-amber-600 dark:text-amber-300" : undefined} />
      </section>

      <RoomCards rows={rows} period={periodLabel(p, t)} days={days} />
    </div>
  );
}

function Figure({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${tone ?? ""}`}>{value}</p>
      {sub && <p className="line-clamp-2 text-[11px] leading-snug text-muted-foreground">{sub}</p>}
    </div>
  );
}
