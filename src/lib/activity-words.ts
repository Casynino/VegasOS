/** Plain-English words for what staff did (from the history log), and which part of the hotel it was. */
const WORDS: Record<string, string> = {
  "auth.login": "signed in", "auth.logout": "signed out",
  "reservation.created": "made a booking", "reservation.checked_in": "checked a guest in", "reservation.checked_out": "checked a guest out",
  "reservation.extended": "extended a stay", "reservation.room_assigned": "moved a guest to another room", "reservation.room_changed": "changed a guest's room",
  "reservation.cancelled": "cancelled a booking", "reservation.confirmed": "confirmed a booking", "reservation.confirmed_by_payment": "confirmed a booking by payment",
  "reservation.dates_changed": "changed booking dates", "reservation.walk_in": "checked in a walk-in guest", "reservation.no_show": "marked a no-show",
  "reservation.late_checkout": "gave a late checkout", "reservation.discount_changed": "changed a discount", "reservation.billing_changed": "changed who pays",
  "reservation.checkin_not_ready_override": "checked a guest into a room before it was ready",
  "payment.recorded": "received a payment", "payment.created": "received a payment", "payment.reversed": "reversed a payment",
  "revenue.recorded": "recorded a sale", "revenue.voided": "cancelled a sale", "revenue.account_corrected": "corrected an account",
  "expense.created": "recorded an expense", "expense.approved": "approved an expense", "expense.edited": "edited an expense",
  "invoice.created": "made an invoice", "corporate.created": "added a company",
  "booking_request.submitted": "received a booking request", "booking_request.converted": "turned a request into a booking", "booking_request.contacted": "contacted a customer",
  "room.status_changed": "updated a room's status", "room.updated": "updated a room", "guest.updated": "updated a customer", "guest.updated_at_checkin": "updated guest details at check-in",
  "guest.message_sent": "messaged a customer", "guest.removed": "removed a customer", "guest.deleted": "deleted a customer",
  "restaurant_order.created": "placed an order", "restaurant_order.status": "moved an order along", "restaurant_order.items_added": "added items to an order",
  "restaurant_order.item_removed": "removed an item from an order", "restaurant_order.paid": "received payment for an order", "restaurant_order.payment_confirmed": "confirmed an order payment",
  "restaurant_order.charged_to_room": "put an order on a room", "restaurant_order.room_paid_now": "removed an order from the room — paid now",
  "restaurant_order.billing_changed": "changed who pays an order", "dining_session.charged_to_room": "put a table's bill on a room",
  "restaurant_order.cancelled": "cancelled an order", "restaurant_order.declined": "declined an order",
  "restaurant_order.moved": "moved an order to another table", "restaurant_order.payment_reversed": "reversed an order payment",
  "table_reservation.created": "booked a table", "table_reservation.seated": "seated a table booking", "table_reservation.edited": "changed a table booking",
  "stock_request.created": "asked for stock", "stock_request.edited": "changed a stock request",
  "stock_request.approved_for_purchase": "approved a stock request for purchase", "stock_request.sent_back": "sent a stock request back to change",
  "stock_request.rejected": "rejected a stock request", "stock_request.resubmitted": "sent a stock request again", "stock_request.cancelled": "cancelled a stock request",
  "stock_request.purchase_saved": "recorded a purchase (being bought)", "stock_request.purchase_submitted": "sent a purchase for final approval",
  "stock_request.purchase_sent_back": "sent a purchase back for correction", "stock_request.final_approved": "approved a purchase — stock in, expense recorded",
  "transport.requested": "arranged transport", "transport.confirmed": "confirmed transport", "transport.paid": "received a transport payment",
  "report.daily_generated": "sent the daily report", "settings.updated": "changed settings", "settings.order_sounds": "changed the restaurant sounds",
  "user.password_changed": "changed a password", "user.profile_updated": "updated their profile", "user.sessions_revoked": "signed out their other devices",
  "user.created": "added a staff member", "user.permission_changed": "changed staff permissions",
  "request.created": "logged a guest request", "request.accepted": "accepted a guest request", "request.updated": "updated a guest request",
  "complaint.logged": "logged a complaint", "complaint.resolved": "resolved a complaint",
  "transport.driver_assigned": "assigned a driver", "transport.driver_changed": "changed the driver", "transport.completed": "completed a trip", "transport.cancelled": "cancelled a trip",
  "meeting.booked": "booked the meeting room", "meeting.started": "started a meeting", "meeting.completed": "completed a meeting", "meeting.changed": "changed a meeting booking",
  "payment.refunded": "gave a refund", "payment.group": "received a group payment", "payment.company": "received a company payment",
  "reservation.occupant_added": "added a guest to a booking", "reservation.occupant_removed": "removed a guest from a booking", "reservation.extended_free": "extended a stay (free)",
  "reservation.charge_added": "added a charge to a bill", "reservation.late_arrival": "noted a late arrival",
  "report.shift_generated": "made a shift report", "report.shift_regenerated": "regenerated a shift report", "report.daily_regenerated": "regenerated the daily report",
  "shift.started": "started a shift", "shift.ended": "closed their shift", "shift.closed_by_manager": "closed someone's shift (manager, with the reason)", "shift.taken_over": "took over a shift", "shift.note_added": "left a handover note",
};

/** What an action was, in plain words ("checked a guest in"). */
export const friendlyAction = (a: string) => WORDS[a] ?? a.replaceAll("_", " ").replace(".", " · ");

export type ActivityArea = "Sign-in" | "Front desk" | "Bookings" | "Money" | "Restaurant" | "Stores" | "Rooms" | "Customers" | "Shifts" | "Other";

/** Which part of the hotel an action belongs to (for grouping and colour). */
export function activityArea(a: string): ActivityArea {
  if (a.startsWith("auth.")) return "Sign-in";
  if (/^reservation\.(checked_in|checked_out|walk_in|late_checkout|room_)/.test(a)) return "Front desk";
  if (a.startsWith("reservation.") || a.startsWith("booking_request.") || a.startsWith("table_reservation.")) return "Bookings";
  if (/^(payment|revenue|expense|invoice)\./.test(a)) return "Money";
  if (a.startsWith("stock_request.")) return "Stores";
  if (a.startsWith("restaurant_order.") || a.startsWith("dining_session.")) return "Restaurant";
  if (a.startsWith("room.")) return "Rooms";
  if (a.startsWith("guest.") || a.startsWith("corporate.")) return "Customers";
  if (a.startsWith("shift.") || a.startsWith("report.shift")) return "Shifts";
  if (a.startsWith("request.") || a.startsWith("complaint.") || a.startsWith("meeting.")) return "Front desk";
  return "Other";
}
