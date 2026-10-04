import "server-only";
import { db } from "../db";
import { fromDbDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { paymentStatus } from "@/lib/payment-status";

/**
 * Who is staying, who has paid, who still owes — ONE calculation used by the
 * front desk, the shift handover, the manager/boss dashboards and the daily report.
 *
 *  - outstanding: the guest's whole bill (every night of the stay, each priced on
 *    its own date, + room-bill items − discounts) minus what was paid (and what a
 *    company is billed for). This is what must be settled before checkout.
 *  - owedSoFar: the same, counting only nights up to tonight — it grows night by
 *    night while the guest stays (100k → 200k → 300k…).
 * Neither is collected money: only payments are money in.
 */
export async function inHouseBalances(today: BusinessDate) {
  const stays = await db.reservation.findMany({
    where: { status: "CHECKED_IN" },
    include: {
      guest: { select: { fullName: true, phone: true } },
      rooms: {
        where: { status: "CHECKED_IN" },
        select: { arrivalDate: true, departureDate: true, checkedInAt: true, room: { select: { number: true } }, nightsLedger: { select: { businessDate: true, netAmount: true } } },
      },
      charges: { where: { isVoided: false }, select: { amount: true, businessDate: true } },
      payments: { where: { status: "POSTED" }, orderBy: { receivedAt: "desc" }, select: { receivedAt: true, kind: true } },
    },
    orderBy: { departureDate: "asc" },
  });
  const t = toDbDate(today).getTime();
  const rows = stays.map((r) => {
    const nights = r.rooms.flatMap((x) => x.nightsLedger);
    const nightsSoFar = nights.filter((n) => n.businessDate.getTime() <= t);
    const chargesSoFar = r.charges.filter((c) => c.businessDate.getTime() <= t).reduce((s, c) => s + c.amount, 0);
    const earnedSoFar = nightsSoFar.reduce((s, n) => s + n.netAmount, 0) + chargesSoFar;
    const arrival = r.rooms.map((x) => fromDbDate(x.arrivalDate)).sort()[0] ?? fromDbDate(r.arrivalDate);
    const departure = r.rooms.map((x) => fromDbDate(x.departureDate)).sort().at(-1) ?? fromDbDate(r.departureDate);
    const lastPayment = r.payments.find((p) => p.kind === "PAYMENT")?.receivedAt ?? null;
    return {
      reservationId: r.id, reference: r.reference, guest: r.guest.fullName, phone: r.guest.phone,
      rooms: r.rooms.map((x) => x.room.number), arrival, departure,
      daysStaying: new Set(nightsSoFar.map((n) => n.businessDate.getTime())).size,
      total: r.netAmount, paid: r.paidAmount, companyBilled: r.companyBilledAmount,
      // A group room is paid by its group (company / contact) — nothing to collect from the guest at the desk.
      outstanding: r.billTo === "GROUP" ? 0 : Math.max(0, r.balanceAmount),
      owedSoFar: r.billTo === "GROUP" ? 0 : Math.max(0, earnedSoFar - r.paidAmount - r.companyBilledAmount),
      groupPays: r.billTo === "GROUP",
      /** A company pays all or part of the bill: the guest's own share is worked out at checkout (never collected in full here). */
      companyPays: r.billTo === "COMPANY" || r.billTo === "SPLIT",
      lastPayment,
      status: paymentStatus(r),
    };
  });
  const owing = rows.filter((x) => x.outstanding > 0).sort((a, b) => b.outstanding - a.outstanding);
  return {
    rows, owing,
    summary: {
      occupiedRooms: rows.reduce((s, x) => s + x.rooms.length, 0),
      guestsCheckedIn: rows.length,
      fullyPaid: rows.filter((x) => x.outstanding === 0).length,
      owingCount: owing.length,
      totalOutstanding: owing.reduce((s, x) => s + x.outstanding, 0),
      totalOwedSoFar: rows.reduce((s, x) => s + x.owedSoFar, 0),
    },
  };
}

export type InHouseBalances = Awaited<ReturnType<typeof inHouseBalances>>;

/** Plain-text money part of the shift handover. */
export function handoverMoneyText(b: InHouseBalances) {
  const s = b.summary;
  const fmt = (n: number) => n.toLocaleString("en-US");
  return [
    `MONEY TO COLLECT — ${s.guestsCheckedIn} guest${s.guestsCheckedIn === 1 ? "" : "s"} in ${s.occupiedRooms} room${s.occupiedRooms === 1 ? "" : "s"}: ${s.fullyPaid} fully paid, ${s.owingCount} owing.`,
    s.owingCount ? `Total outstanding TZS ${fmt(s.totalOutstanding)} (owed for nights so far TZS ${fmt(s.totalOwedSoFar)}).` : "Nobody staying owes money.",
    ...b.owing.map((x) => `Room ${x.rooms.join(", ")} — ${x.guest}: TZS ${fmt(x.outstanding)}${x.paid ? ` (paid ${fmt(x.paid)})` : " (nothing paid)"}`),
  ].join("\n");
}
