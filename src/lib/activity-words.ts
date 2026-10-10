import { msg } from "@/i18n/msg";

/** Plain-English words for what staff did (from the history log), and which part of the hotel it was. */
const WORDS: Record<string, string> = {
  "auth.login": msg("signed in"), "auth.logout": msg("signed out"),
  "reservation.created": msg("made a booking"), "reservation.checked_in": msg("checked a guest in"), "reservation.checked_out": msg("checked a guest out"),
  "reservation.extended": msg("extended a stay"), "reservation.room_assigned": msg("moved a guest to another room"), "reservation.room_changed": msg("changed a guest's room"),
  "reservation.cancelled": msg("cancelled a booking"), "reservation.confirmed": msg("confirmed a booking"), "reservation.confirmed_by_payment": msg("confirmed a booking by payment"),
  "reservation.dates_changed": msg("changed booking dates"), "reservation.walk_in": msg("checked in a walk-in guest"), "reservation.no_show": msg("marked a no-show"),
  "reservation.late_checkout": msg("gave a late checkout"), "reservation.discount_changed": msg("changed a discount"), "reservation.billing_changed": msg("changed who pays"),
  "reservation.checkin_not_ready_override": msg("checked a guest into a room before it was ready"),
  "payment.recorded": msg("received a payment"), "payment.created": msg("received a payment"), "payment.reversed": msg("reversed a payment"),
  "revenue.recorded": msg("recorded a sale"), "revenue.voided": msg("cancelled a sale"), "revenue.account_corrected": msg("corrected an account"),
  "expense.created": msg("recorded an expense"), "expense.approved": msg("approved an expense"), "expense.edited": msg("edited an expense"),
  "invoice.created": msg("made an invoice"), "corporate.created": msg("added a company"),
  "booking_request.submitted": msg("received a booking request"), "booking_request.converted": msg("turned a request into a booking"), "booking_request.contacted": msg("contacted a customer"),
  "room.status_changed": msg("updated a room's status"), "room.updated": msg("updated a room"), "guest.updated": msg("updated a customer"), "guest.updated_at_checkin": msg("updated guest details at check-in"),
  "guest.message_sent": msg("messaged a customer"), "guest.removed": msg("removed a customer"), "guest.deleted": msg("deleted a customer"),
  "restaurant_order.created": msg("placed an order"), "restaurant_order.status": msg("moved an order along"), "restaurant_order.items_added": msg("added items to an order"),
  "restaurant_order.item_removed": msg("removed an item from an order"), "restaurant_order.paid": msg("received payment for an order"), "restaurant_order.payment_confirmed": msg("confirmed an order payment"),
  "restaurant_order.charged_to_room": msg("put an order on a room"), "restaurant_order.room_paid_now": msg("removed an order from the room — paid now"),
  "restaurant_order.billing_changed": msg("changed who pays an order"), "dining_session.charged_to_room": msg("put a table's bill on a room"),
  "restaurant_order.cancelled": msg("cancelled an order"), "restaurant_order.declined": msg("declined an order"),
  "restaurant_order.moved": msg("moved an order to another table"), "restaurant_order.payment_reversed": msg("reversed an order payment"),
  "table_reservation.created": msg("booked a table"), "table_reservation.seated": msg("seated a table booking"), "table_reservation.edited": msg("changed a table booking"),
  "stock_request.created": msg("asked for stock"), "stock_request.edited": msg("changed a stock request"),
  "stock_request.approved_for_purchase": msg("approved a stock request for purchase"), "stock_request.sent_back": msg("sent a stock request back to change"),
  "stock_request.rejected": msg("rejected a stock request"), "stock_request.resubmitted": msg("sent a stock request again"), "stock_request.cancelled": msg("cancelled a stock request"),
  "stock_request.purchase_saved": msg("recorded a purchase (being bought)"), "stock_request.purchase_submitted": msg("sent a purchase for final approval"),
  "stock_request.purchase_sent_back": msg("sent a purchase back for correction"), "stock_request.final_approved": msg("approved a purchase — stock in, expense recorded"),
  "transport.requested": msg("arranged transport"), "transport.confirmed": msg("confirmed transport"), "transport.paid": msg("received a transport payment"),
  "report.daily_generated": msg("sent the daily report"), "settings.updated": msg("changed settings"), "settings.order_sounds": msg("changed the restaurant sounds"),
  "user.password_changed": msg("changed a password"), "user.profile_updated": msg("updated their profile"), "user.sessions_revoked": msg("signed out their other devices"),
  "user.created": msg("added a staff member"), "user.permission_changed": msg("changed staff permissions"),
  "request.created": msg("logged a guest request"), "request.accepted": msg("accepted a guest request"), "request.updated": msg("updated a guest request"),
  "complaint.logged": msg("logged a complaint"), "complaint.resolved": msg("resolved a complaint"),
  "transport.driver_assigned": msg("assigned a driver"), "transport.driver_changed": msg("changed the driver"), "transport.completed": msg("completed a trip"), "transport.cancelled": msg("cancelled a trip"),
  "meeting.booked": msg("booked the meeting room"), "meeting.started": msg("started a meeting"), "meeting.completed": msg("completed a meeting"), "meeting.changed": msg("changed a meeting booking"),
  "payment.refunded": msg("gave a refund"), "payment.group": msg("received a group payment"), "payment.company": msg("received a company payment"),
  "reservation.occupant_added": msg("added a guest to a booking"), "reservation.occupant_removed": msg("removed a guest from a booking"), "reservation.extended_free": msg("extended a stay (free)"),
  "reservation.charge_added": msg("added a charge to a bill"), "reservation.late_arrival": msg("noted a late arrival"),
  "report.shift_generated": msg("made a shift report"), "report.shift_regenerated": msg("regenerated a shift report"), "report.daily_regenerated": msg("regenerated the daily report"),
  "shift.started": msg("started a shift"), "shift.ended": msg("closed their shift"), "shift.closed_by_manager": msg("closed someone's shift (manager, with the reason)"), "shift.taken_over": msg("took over a shift"), "shift.note_added": msg("left a handover note"),
  "hotel_qr.created": msg("made a Hotel QR"), "hotel_qr.renamed": msg("renamed a Hotel QR"), "hotel_qr.regenerated": msg("made a new Hotel QR code (the old card stopped working)"),
  "hotel_qr.enabled": msg("switched a Hotel QR on"), "hotel_qr.disabled": msg("switched a Hotel QR off"), "hotel_qr.archived": msg("archived a Hotel QR"),
  "hotel_qr.settings": msg("changed the Hotel QR switches"),
};

/** What an action was, in plain words ("checked a guest in"). */
export const friendlyAction = (a: string) => WORDS[a] ?? a.replaceAll("_", " ").replace(".", " · ");

export type ActivityArea = "Sign-in" | "Front desk" | "Bookings" | "Money" | "Restaurant" | "Stores" | "Rooms" | "Customers" | "Shifts" | "Other";

/** Which part of the hotel an action belongs to (for grouping and colour). */
export function activityArea(a: string): ActivityArea {
  if (a.startsWith("auth.")) return msg("Sign-in");
  if (/^reservation\.(checked_in|checked_out|walk_in|late_checkout|room_)/.test(a)) return msg("Front desk");
  if (a.startsWith("reservation.") || a.startsWith("booking_request.") || a.startsWith("table_reservation.") || a.startsWith("hotel_qr.")) return msg("Bookings");
  if (/^(payment|revenue|expense|invoice)\./.test(a)) return msg("Money");
  if (a.startsWith("stock_request.")) return msg("Stores");
  if (a.startsWith("restaurant_order.") || a.startsWith("dining_session.")) return msg("Restaurant");
  if (a.startsWith("room.")) return msg("Rooms");
  if (a.startsWith("guest.") || a.startsWith("corporate.")) return msg("Customers");
  if (a.startsWith("shift.") || a.startsWith("report.shift")) return msg("Shifts");
  if (a.startsWith("request.") || a.startsWith("complaint.") || a.startsWith("meeting.")) return msg("Front desk");
  return msg("Other");
}
