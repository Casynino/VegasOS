import type { RestaurantOrderType } from "@/generated/prisma/enums";

/** Where the waiter takes an order: the guest's room, the table, the customer's address (take out), or the counter. */
export function deliveryPlace(o: { type: RestaurantOrderType; roomNumber: string | null; tableLabel: string | null; deliveryAddress?: string | null }) {
  if (o.type === "ROOM_SERVICE") return o.roomNumber ? `Room ${o.roomNumber}` : "Room";
  if (o.type === "DINE_IN") return o.tableLabel ? (/^\d+$/.test(o.tableLabel.trim()) ? `Table ${o.tableLabel.trim()}` : o.tableLabel) : "Restaurant";
  if (o.type === "TAKEAWAY" && o.deliveryAddress) return `Take out — ${o.deliveryAddress}`;
  return "Counter";
}
