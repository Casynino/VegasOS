import "server-only";
import { db } from "../db";
import { getSettings, stayConfig } from "../settings";
import { fromDbDate, type BusinessDate } from "@/lib/time/business-date";
import { CHARGE_LABELS } from "@/lib/charge-types";
import { mediaUrl } from "./media";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";

/** A room-bill line's restaurant order (when it came from one): its number and where it was eaten. */
export const CHARGE_ORDER = { select: { id: true, number: true, type: true, tableLabel: true, location: { select: { name: true } } } } as const;
export type ChargeOrder = { id: string; number: string; type: string; tableLabel: string | null; location: { name: string } | null };

/** "ORD-2026-000184" → "#184". */
export const orderNo = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;
/** Where an order was eaten: its table ("Outside 3"), or null (brought to the room, or no table saved). */
export const orderTable = (o: ChargeOrder) => (o.type === "ROOM_SERVICE" ? null : o.location?.name ?? o.tableLabel ?? null);
/**
 * One order on the room bill: "Restaurant — Outside 3 · Order #184" (room service: "Room service · Order #12").
 * With `t` (the reader's translator, to show it): the same heading in their language.
 */
export function orderHeading(o: ChargeOrder, word = "Order ", t?: T) {
  const table = orderTable(o);
  if (t && word === "Order ") {
    const number = orderNo(o.number);
    return o.type === "ROOM_SERVICE" ? t("Room service · Order {number}", { number })
      : table ? t("Restaurant — {table} · Order {number}", { table: t(table), number }) : t("Restaurant · Order {number}", { number });
  }
  return o.type === "ROOM_SERVICE" ? `Room service · ${word}${orderNo(o.number)}` : `Restaurant${table ? ` — ${table}` : ""} · ${word}${orderNo(o.number)}`;
}
/**
 * A room-bill line's words without its order's place and number ("2 × Chips · Outside 3 ·
 * ORD-2026-000184" → "2 × Chips") — the order's heading already says them.
 */
export function chargeItem(description: string, o: ChargeOrder | null) {
  if (!o) return description;
  const drop = new Set([o.number, o.tableLabel, o.location?.name, "Room service"].filter(Boolean));
  const parts = description.split(" · ");
  while (parts.length > 1 && drop.has(parts[parts.length - 1])) parts.pop();
  return parts.join(" · ");
}

/**
 * What is on a room bill besides the nights, by the owner's lines: a table's order is
 * Restaurant (its food and drinks — the room is only where the bill is collected), an order
 * brought to the room is Room service (with its fee), then the other extras by their type
 * (bar, laundry, transport, late checkout…). Always adds up to the stay's charges.
 */
export function folioLines(charges: { amount: number; category: string | null; restaurantOrder?: { type: string } | null }[]) {
  // Labels shown by the screens in the reader's language (t(label)); kept in English here.
  const groups = new Map<string, number>([[msg("Restaurant"), 0], [msg("Room service"), 0]]);
  for (const c of charges) {
    const key = c.category === "BILL_DISCOUNT" ? msg("Discount on the bill")
      : c.restaurantOrder ? (c.restaurantOrder.type === "ROOM_SERVICE" ? msg("Room service") : msg("Restaurant"))
      : c.category === "ROOM_SERVICE_FEE" ? msg("Room service") : CHARGE_LABELS[c.category ?? ""] ?? msg("Other");
    groups.set(key, (groups.get(key) ?? 0) + c.amount);
  }
  return [...groups.entries()].filter(([, amount]) => amount !== 0).map(([label, amount]) => ({ label, amount }));
}

type TabSource = {
  id: string; businessDate: Date; createdAt: Date; category: string | null; description: string; amount: number; createdById: string | null;
  menuItem: { image: { id: string; url: string | null; isActive: boolean } | null } | null; restaurantOrder: ChargeOrder | null;
};
/** The guest's tab lines (room-charges' GuestTab): a line from a restaurant order says which order and table. */
export function tabLines(charges: TabSource[], staff: Map<string, string>) {
  return charges.map((c) => ({
    id: c.id, day: fromDbDate(c.businessDate), at: c.createdAt.toISOString(), type: c.category ?? "OTHER", description: chargeItem(c.description, c.restaurantOrder), amount: c.amount,
    by: c.createdById ? staff.get(c.createdById) ?? null : null,
    photo: c.menuItem?.image?.isActive ? mediaUrl(c.menuItem.image) : null,
    order: c.restaurantOrder ? { number: orderNo(c.restaurantOrder.number), table: orderTable(c.restaurantOrder), roomService: c.restaurantOrder.type === "ROOM_SERVICE" } : null,
  }));
}

/**
 * In-house stays for the check-out desk: who is in which room, when they are
 * due to leave, and whether that time has passed. The stay state is derived
 * from the expected checkout instant (room `endAt`, which already includes any
 * approved late checkout) — nothing is extended or charged automatically.
 */
export type StayState = "IN_HOUSE" | "DUE_TODAY" | "OVERDUE";

export function stayState(rooms: { departureDate: Date; endAt: Date }[], today: BusinessDate, now: Date): StayState {
  if (rooms.some((r) => r.endAt <= now)) return "OVERDUE";
  if (rooms.some((r) => fromDbDate(r.departureDate) <= today)) return "DUE_TODAY";
  return "IN_HOUSE";
}

const inHouseInclude = {
  guest: { select: { id: true, fullName: true, phone: true } },
  corporateCustomer: { select: { companyName: true } },
  rooms: {
    where: { status: "CHECKED_IN" as const },
    include: { room: { select: { number: true } }, roomType: { select: { name: true } } },
    orderBy: { endAt: "asc" as const },
  },
};

/** Everyone currently checked in, soonest checkout first, with their stay state. */
export async function getInHouse(today: BusinessDate, now = new Date()) {
  const rows = await db.reservation.findMany({
    where: { rooms: { some: { status: "CHECKED_IN" } } },
    include: inHouseInclude,
  });
  return rows
    .map((r) => ({
      ...r,
      state: stayState(r.rooms, today, now),
      checkoutAt: r.rooms.reduce((m, x) => (x.endAt > m ? x.endAt : m), r.rooms[0].endAt),
      checkoutDate: fromDbDate(r.rooms.reduce((m, x) => (x.departureDate > m ? x.departureDate : m), r.rooms[0].departureDate)),
    }))
    .sort((a, b) => a.checkoutAt.getTime() - b.checkoutAt.getTime());
}
export type InHouseStay = Awaited<ReturnType<typeof getInHouse>>[number];

/** One stay's full picture: rooms with times, the running account (folio) by category, and payments. */
export async function getStay(reservationId: string, today: BusinessDate, now = new Date()) {
  const [r, settings] = await Promise.all([
    db.reservation.findUnique({
      where: { id: reservationId },
      include: {
        guest: { select: { id: true, fullName: true, phone: true, email: true } },
        corporateCustomer: { select: { companyName: true } },
        source: { select: { name: true } },
        rooms: {
          where: { status: { in: ["CHECKED_IN", "CHECKED_OUT"] } },
          include: { room: { select: { id: true, number: true, status: true } }, roomType: { select: { name: true } }, checkedInBy: { select: { fullName: true } } },
          orderBy: { startAt: "asc" },
        },
        charges: { where: { isVoided: false }, orderBy: { createdAt: "asc" }, include: { menuItem: { select: { image: { select: { id: true, url: true, isActive: true } } } }, restaurantOrder: CHARGE_ORDER } },
        payments: { where: { status: "POSTED" }, include: { method: { select: { name: true } }, recordedBy: { select: { fullName: true } } }, orderBy: { receivedAt: "asc" } },
      },
    }),
    getSettings(),
  ]);
  if (!r) return null;
  const live = r.rooms.filter((x) => x.status === "CHECKED_IN");
  const staffIds = [...new Set(r.charges.map((c) => c.createdById).filter(Boolean))] as string[];
  const staff = staffIds.length ? await db.user.findMany({ where: { id: { in: staffIds } }, select: { id: true, fullName: true } }) : [];
  const name = new Map(staff.map((u) => [u.id, u.fullName]));
  return {
    ...r,
    live,
    tab: tabLines(r.charges, name),
    state: live.length ? stayState(live, today, now) : null,
    checkoutAt: live.length ? live.reduce((m, x) => (x.endAt > m ? x.endAt : m), live[0].endAt) : null,
    folio: folioLines(r.charges),
    checkoutMinutes: stayConfig(settings).checkoutMinutes,
  };
}
export type StayDetail = NonNullable<Awaited<ReturnType<typeof getStay>>>;
