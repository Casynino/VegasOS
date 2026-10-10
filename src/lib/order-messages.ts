import { orderDateText, orderPaidMessage, orderReceivedMessage, orderStatusMessage, type OrderFacts } from "./wa-messages";
import { msg } from "@/i18n/msg";
import { englishT, type T } from "@/i18n/translate";

/**
 * Order updates for the customer (WhatsApp / SMS), in the Vegas style of src/lib/wa-messages.ts: received (the whole
 * order — items, prices, fee, total, how it is paid), being prepared, ready, delivered / collected, cancelled, paid.
 * One message per real step, never a stream of them. In the customer's language: pass their translator last (English
 * when left out) — the words change, the order, its numbers and links do not.
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

const TYPE_WORD: Record<string, string> = { DINE_IN: msg("Eat here"), TAKEAWAY: msg("Take out"), PICKUP: msg("Pickup"), ROOM_SERVICE: msg("Room service") };
/** The order's type in words (English unless a translator is given). */
export const orderTypeWord = (type: string, delivery?: boolean, t: T = englishT) => t(type === "TAKEAWAY" && delivery ? msg("Take out · delivered") : TYPE_WORD[type] ?? type);

/** How the order is paid, in one word the customer understands (English unless a translator is given). */
export function orderPaymentWord(o: { settlement: string; paymentStatus: string; payingOnline?: boolean; status?: string }, t: T = englishT) {
  if (o.status === "CANCELLED") return t("CANCELLED");
  if (o.settlement === "ROOM") return t("CHARGED TO YOUR ROOM");
  if (o.paymentStatus === "PAID") return t("PAID");
  if (o.paymentStatus === "PARTIALLY_PAID") return t("PARTLY PAID");
  if (o.payingOnline) return t("WAITING FOR YOUR PAYMENT");
  return t("PAY WHEN YOU ARE DONE");
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
}, t: T = englishT) {
  const hotel = { name: v.hotel, phone: v.phone ?? null };
  const no = `#${v.number.replace(/^ORD-\d{4}-0*/, "")}`;
  // English here: the message translates the place when it shows it.
  const place = v.place ?? (v.type === "ROOM_SERVICE" && v.room ? `Room ${v.room}` : orderTypeWord(v.type, v.delivery));
  if (event === "RECEIVED" && v.details) return orderReceivedMessage({ hotel, name: v.name, order: v.details, trackUrl: v.track }, t);
  if (event === "PAID" && v.details && v.paid) return orderPaidMessage({ hotel, name: v.name, order: v.details, amount: v.paid.amount, reference: v.paid.reference, trackUrl: v.track }, t);
  const step = (status: string, line: string, again = false) =>
    orderStatusMessage({ hotel, name: v.name, number: no, place, status, line, trackUrl: event === "CANCELLED" ? null : v.track, again: again ? v.menu : null, order: v.details ?? null }, t);
  switch (event) {
    case "RECEIVED": return step(t("RECEIVED"), t("Your order {no} has been received by {hotel}.", { no, hotel: v.hotel }));
    case "PAID": return step(t("PAID"), t("Your payment for order {no} has been received. Thank you!", { no }));
    case "PREPARING":
      return step(t("BEING PREPARED"), v.prepMinutes
        ? t("Your order {no} is now being prepared. It should be ready in about {n} minutes.", { no, n: v.prepMinutes })
        : t("Your order {no} is now being prepared.", { no }));
    case "READY":
      return step(t("READY"), v.type === "ROOM_SERVICE" && v.room ? t("Your order {no} is ready and on its way to Room {room}.", { no, room: v.room })
        : v.type === "DINE_IN" ? t("Your order {no} is ready and will be served to you shortly.", { no })
        : v.delivery ? t("Your order {no} is ready and will be on its way to you shortly.", { no })
        : t("Your order {no} is ready for collection at {hotel}.", { no, hotel: v.hotel }));
    case "DELIVERED":
      return v.type === "DINE_IN"
        ? step(t("SERVED"), t("Your order {no} has been served. Enjoy!", { no }), true)
        : step(t("DELIVERED"), t("Your order {no} has been delivered. Enjoy!", { no }), true);
    case "COLLECTED": return step(t("COLLECTED"), t("Thank you for collecting your order {no}. Enjoy!", { no }), true);
    case "CANCELLED": return step(t("CANCELLED"), t("We are sorry — your order {no} has been cancelled.", { no }));
  }
}

/**
 * The order's facts for the "received" / "paid" messages — straight from the order (its lines, fee and total). The
 * words stay English (the message translates them for its customer); the order time is kept so the message can write
 * the date in the customer's language, and each line's name as ordered (select `nameI18n` to keep it).
 */
export function orderFacts(o: {
  number: string; type: string; deliveryAddress?: string | null; serviceFee: number; total: number; settlement: string; paymentStatus: string; status?: string;
  payOnlineAt?: Date | null; createdAt: Date; items: { name: string; quantity: number; lineTotal: number; nameI18n?: unknown }[];
}, place: string, timezone: string): OrderFacts {
  return {
    number: `#${o.number.replace(/^ORD-\d{4}-0*/, "")}`, place, type: orderTypeWord(o.type, !!o.deliveryAddress),
    date: orderDateText(o.createdAt, timezone), at: o.createdAt, timezone,
    items: o.items.map((i) => ({ name: i.name, qty: i.quantity, total: i.lineTotal, nameI18n: i.nameI18n })), fee: o.serviceFee || undefined, total: o.total,
    payment: orderPaymentWord({ settlement: o.settlement, paymentStatus: o.paymentStatus, status: o.status, payingOnline: !!o.payOnlineAt && o.paymentStatus !== "PAID" }),
  };
}
