import "server-only";
import { can, type CurrentUser } from "@/server/auth";
import { getSettings } from "@/server/settings";
import { siteOrigin } from "@/server/site-origin";
import { roomQrCodes } from "@/server/services/room-qr";
import { discountLimit } from "@/lib/discounts";
import type { RoomGridPerms, RoomQrInfo } from "@/components/staff/rooms/room-grid";

/** What this person may do from a room's window (the rooms board and the room page). */
export async function roomGridPerms(user: CurrentUser): Promise<RoomGridPerms> {
  // Managers and the MD watch the rooms and step in (maintenance, out of service, moving a guest,
  // free nights, discounts) — check-in, check-out, payments, orders, bookings and cleaning are reception's.
  const settings = await getSettings();
  if (watchesRooms(user)) {
    return {
      // Their interventions: maintenance / out of service (close, reopen), moving a guest to another room, and their decisions.
      update: can(user, "rooms.status.update"), block: can(user, "rooms.block"), maintenanceOnly: true, checkIn: false, checkOut: false, book: can(user, "reservations.create"), pay: false, discount: false, discountMax: 0, order: false, orderPayNow: false, transport: false, move: can(user, "reservations.edit"),
      decide: { discountMax: discountLimit(user.permissions, settings) }, release: can(user, "reservations.cancel"),
    };
  }
  return {
    transport: can(user, "transport.request") || can(user, "transport.manage"), order: can(user, "restaurant.orders"), orderPayNow: can(user, "revenue.record"),
    pay: can(user, "payments.record"), update: can(user, "rooms.status.update"), block: can(user, "rooms.block"),
    checkIn: can(user, "reservations.check_in"), checkOut: can(user, "reservations.check_out"), book: can(user, "reservations.create"),
    discount: discountLimit(user.permissions, settings) > 0, discountMax: discountLimit(user.permissions, settings), move: can(user, "reservations.edit"),
  };
}

/** Managers, the owner and the MD: they oversee the rooms rather than work them. */
export const watchesRooms = (user: CurrentUser) => can(user, "dashboard.manager") || can(user, "dashboard.owner") || can(user, "dashboard.admin");

/** Every room's QR token (the card is drawn in the browser when a room's window opens). */
export async function roomQrInfo(): Promise<RoomQrInfo> {
  const [rooms, s, origin] = await Promise.all([roomQrCodes(), getSettings(), siteOrigin()]);
  return {
    origin, hotel: s.hotelName, phone: s.phone,
    tokens: Object.fromEntries(rooms.filter((r) => r.qrCode?.active).map((r) => [r.id, r.qrCode!.token])),
  };
}
