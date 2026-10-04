/**
 * Short order updates for the customer (WhatsApp / SMS): received, being
 * prepared, ready, delivered / collected, cancelled. Kept brief — one message
 * per real step, never a stream of them.
 */
export type OrderEvent = "RECEIVED" | "PREPARING" | "READY" | "DELIVERED" | "COLLECTED" | "CANCELLED";

export const ORDER_EVENT_TYPE: Record<OrderEvent, string> = {
  RECEIVED: "ORDER_RECEIVED", PREPARING: "ORDER_PREPARING", READY: "ORDER_READY",
  DELIVERED: "ORDER_DELIVERED", COLLECTED: "ORDER_DELIVERED", CANCELLED: "ORDER_CANCELLED",
};

/** The update that belongs to an order status (none for steps the customer does not need to hear about). */
export function orderEventFor(status: string, type?: string, delivery?: boolean): OrderEvent | null {
  switch (status) {
    case "PENDING": return "RECEIVED";
    case "ACCEPTED": case "PREPARING": return "PREPARING";
    case "READY": case "OUT_FOR_DELIVERY": return "READY";
    case "DELIVERED": case "COMPLETED": return (type === "TAKEAWAY" && !delivery) || type === "PICKUP" ? "COLLECTED" : "DELIVERED";
    case "COLLECTED": return "COLLECTED";
    case "CANCELLED": return "CANCELLED";
    default: return null;
  }
}

export function orderMessageText(event: OrderEvent, v: {
  name: string | null; hotel: string; number: string; type: string; room: string | null; track: string | null; menu: string | null;
  prepMinutes?: number | null; phone?: string | null;
  /** Take out delivered to the customer's address. */
  delivery?: boolean;
}) {
  const hi = `Hi ${(v.name ?? "").trim().split(/\s+/)[0] || "there"},`;
  const room = v.type === "ROOM_SERVICE" && v.room ? ` for Room ${v.room}` : "";
  const track = v.track ? `\nTrack your order: ${v.track}` : "";
  switch (event) {
    case "RECEIVED":
      return `${hi} your ${v.hotel} order #${v.number}${room} has been received.${track}`;
    case "PREPARING":
      return `${hi} your ${v.hotel} order #${v.number} is now being prepared.${v.prepMinutes ? ` We expect it to be ready in about ${v.prepMinutes} minutes.` : ""}${track}`;
    case "READY":
      return v.type === "ROOM_SERVICE" && v.room
        ? `${hi} your order #${v.number} is ready and on its way to Room ${v.room}.`
        : v.type === "DINE_IN" ? `${hi} your order #${v.number} is ready and will be served to you shortly.`
        : v.delivery ? `${hi} your order #${v.number} is ready and will be on its way to you shortly.`
        : `${hi} your order #${v.number} is ready for collection at ${v.hotel}.`;
    case "DELIVERED":
      return `${hi} your order #${v.number} has been ${v.type === "DINE_IN" ? "served" : "delivered"}. Enjoy!${v.menu ? `\nOrder again any time: ${v.menu}` : ""}`;
    case "COLLECTED":
      return `${hi} thank you for collecting your order #${v.number}. Enjoy!${v.menu ? `\nOrder again any time: ${v.menu}` : ""}`;
    case "CANCELLED":
      return `${hi} we are sorry — your ${v.hotel} order #${v.number} has been cancelled.${v.phone ? ` Questions? Call or WhatsApp ${v.phone}.` : ""}`;
  }
}
