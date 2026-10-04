import "server-only";
import type { CurrentUser } from "@/server/auth";
import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { activeStaysFor } from "@/server/services/guests";

/**
 * Reception works for the HOTEL (owner, 2026-10-04): guests staying in the hotel now — anyone else is the
 * restaurant's (they order, pay and book directly there). These checks guard every server action reception can
 * reach, whatever the screen shows. Managers, the MD and the owner are not limited by them.
 */
export const isDeskUser = (user: CurrentUser) => user.permissions.has("dashboard.front_desk") && !["dashboard.manager", "dashboard.owner", "dashboard.admin"].some((p) => user.permissions.has(p as never));

/** Everyone staying now (bookers and the people on their bookings). */
export async function inHouseGuestIds() {
  const stays = await db.reservation.findMany({ where: { status: "CHECKED_IN" }, select: { guestId: true, guests: { select: { guestId: true } } } });
  return new Set(stays.flatMap((r) => [r.guestId, ...r.guests.map((g) => g.guestId)]));
}

/** A hotel order: to or from a room, made by reception, on a room bill — or for a guest staying here now. */
export function isHotelOrder(o: { type: string; reservationId: string | null; settlement: string; source: string; guestId?: string | null }, inHouse?: Set<string>) {
  return o.type === "ROOM_SERVICE" || !!o.reservationId || o.settlement === "ROOM"
    || ["ROOM_QR", "GUEST_LINK", "GUEST", "RECEPTION"].includes(o.source) || (!!o.guestId && !!inHouse?.has(o.guestId));
}

/** Reception touches the hotel's orders only. */
export async function deskOnlyHotelOrders(user: CurrentUser, ids: string[]) {
  if (!isDeskUser(user) || !ids.length) return;
  const [rows, inHouse] = await Promise.all([
    db.restaurantOrder.findMany({ where: { id: { in: ids } }, select: { type: true, reservationId: true, settlement: true, source: true, guestId: true } }),
    inHouseGuestIds(),
  ]);
  if (rows.some((o) => !isHotelOrder(o, inHouse))) throw new AppError("That is a restaurant customer's order — the restaurant handles it. Reception works on hotel guests' orders.", "FORBIDDEN");
}

/** Reception books and serves staying guests only. */
export async function deskOnlyStayingGuest(user: CurrentUser, guestId: string | null | undefined) {
  if (!isDeskUser(user)) return;
  if (!guestId || !(await activeStaysFor(db, [guestId])).length) throw new AppError("Reception works for guests staying in the hotel — anyone else goes to the restaurant directly.", "FORBIDDEN");
}

/** Reception handles a table only when someone staying in the hotel sits there. */
export async function deskOnlyHotelTable(user: CurrentUser, sessionId: string) {
  if (!isDeskUser(user)) return;
  const s = await db.diningSession.findUnique({ where: { id: sessionId }, select: { guestId: true, members: { select: { guestId: true } } } });
  const people = s ? [s.guestId, ...s.members.map((m) => m.guestId)].filter((x): x is string => !!x) : [];
  if (!people.length || !(await activeStaysFor(db, people)).length) throw new AppError("That table is the restaurant's — reception handles tables where a hotel guest sits.", "FORBIDDEN");
}
