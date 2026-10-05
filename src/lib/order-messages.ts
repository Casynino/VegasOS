import { orderPaidMessage, orderReceivedMessage, orderStatusMessage, type OrderFacts } from "./wa-messages";

/**
 * Order updates for the customer (WhatsApp / SMS), in the Vegas style of src/lib/wa-messages.ts: received (the whole
 * order — items, prices, fee, total, how it is paid), being prepared, ready, delivered / collected, cancelled, paid.
 * One message per real step, never a stream of them.
 */
export type OrderEvent = "RECEIVED" | "PREPARING" | "READY" | "DELIVERED" | "COLLECTED" | "CANCELLED" | "PAID";

export const ORDER_EVENT_TYPE: Record<OrderEvent, string> = {
  RECEIVED: "ORDER_RECEIVED", PREPARING: "ORDER_PREPARING", READY: "ORDER_READY",
  DELIVERED: "ORDER_DELIVERED", COLLECTED: "ORDER_DELIVERED", CANCELLED: "ORDER_CANCELLED", PAID: "ORDER_PAID",
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

const TYPE_WORD: Record<string, string> = { DINE_IN: "Eat here", TAKEAWAY: "Take out", PICKUP: "Pickup", ROOM_SERVICE: "Room service" };
export const orderTypeWord = (type: string, delivery?: boolean) => (type === "TAKEAWAY" && delivery ? "Take out · delivered" : TYPE_WORD[type] ?? type);

/** How the order is paid, in one word the customer understands. */
export function orderPaymentWord(o: { settlement: string; paymentStatus: string; payingOnline?: boolean; status?: string }) {
  if (o.status === "CANCELLED") return "CANCELLED";
  if (o.settlement === "ROOM") return "CHARGED TO YOUR ROOM";
  if (o.paymentStatus === "PAID") return "PAID";
  if (o.paymentStatus === "PARTIALLY_PAID") return "PARTLY PAID";
  if (o.payingOnline) return "WAITING FOR YOUR PAYMENT";
  return "PAY WHEN YOU ARE DONE";
}

export function orderMessageText(event: OrderEvent, v: {
  name: string | null; hotel: string; number: string; type: string; room: string | null; track: string | null; menu: string | null;
  prepMinutes?: number | null; phone?: string | null;
  /** Take out delivered to the customer's address. */
  delivery?: boolean;
  /** Where it is served ("Room 204", "Table 3"); and, for "received", the whole order. */
  place?: string | null;
  details?: OrderFacts | null;
  /** "Paid": the payment and the payment service's reference. */
  paid?: { amount: number; reference: string | null } | null;
}) {
  const hotel = { name: v.hotel, phone: v.phone ?? null };
  const no = `#${v.number.replace(/^ORD-\d{4}-0*/, "")}`;
  const place = v.place ?? (v.type === "ROOM_SERVICE" && v.room ? `Room ${v.room}` : orderTypeWord(v.type, v.delivery));
  if (event === "RECEIVED" && v.details) return orderReceivedMessage({ hotel, name: v.name, order: v.details, trackUrl: v.track });
  if (event === "PAID" && v.details && v.paid) return orderPaidMessage({ hotel, name: v.name, order: v.details, amount: v.paid.amount, reference: v.paid.reference, trackUrl: v.track });
  const step = (status: string, line: string, again = false) => orderStatusMessage({ hotel, name: v.name, number: no, place, status, line, trackUrl: event === "CANCELLED" ? null : v.track, again: again ? v.menu : null, order: v.details ?? null });
  switch (event) {
    case "RECEIVED": return step("RECEIVED", `Your order ${no} has been received by ${v.hotel}.`);
    case "PAID": return step("PAID", `Your payment for order ${no} has been received. Thank you!`);
    case "PREPARING": return step("BEING PREPARED", `Your order ${no} is now being prepared.${v.prepMinutes ? ` It should be ready in about ${v.prepMinutes} minutes.` : ""}`);
    case "READY":
      return step("READY", v.type === "ROOM_SERVICE" && v.room ? `Your order ${no} is ready and on its way to Room ${v.room}.`
        : v.type === "DINE_IN" ? `Your order ${no} is ready and will be served to you shortly.`
        : v.delivery ? `Your order ${no} is ready and will be on its way to you shortly.`
        : `Your order ${no} is ready for collection at ${v.hotel}.`);
    case "DELIVERED": return step(v.type === "DINE_IN" ? "SERVED" : "DELIVERED", `Your order ${no} has been ${v.type === "DINE_IN" ? "served" : "delivered"}. Enjoy!`, true);
    case "COLLECTED": return step("COLLECTED", `Thank you for collecting your order ${no}. Enjoy!`, true);
    case "CANCELLED": return step("CANCELLED", `We are sorry — your order ${no} has been cancelled.`);
  }
}

/** The order's facts for the "received" / "paid" messages — straight from the order (its lines, fee and total). */
export function orderFacts(o: {
  number: string; type: string; deliveryAddress?: string | null; serviceFee: number; total: number; settlement: string; paymentStatus: string; status?: string;
  payOnlineAt?: Date | null; createdAt: Date; items: { name: string; quantity: number; lineTotal: number }[];
}, place: string, timezone: string): OrderFacts {
  return {
    number: `#${o.number.replace(/^ORD-\d{4}-0*/, "")}`, place, type: orderTypeWord(o.type, !!o.deliveryAddress),
    date: new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(o.createdAt),
    items: o.items.map((i) => ({ name: i.name, qty: i.quantity, total: i.lineTotal })), fee: o.serviceFee || undefined, total: o.total,
    payment: orderPaymentWord({ settlement: o.settlement, paymentStatus: o.paymentStatus, status: o.status, payingOnline: !!o.payOnlineAt && o.paymentStatus !== "PAID" }),
  };
}
