import { msg } from "@/i18n/msg";

/**
 * The Developer's own entries, the steps on staff accounts they take (suspend, switch back on, sign out everywhere), the failed or refused
 * attempts and the notes — all new with the Developer account. One table, read by the history lists here and by the audit trail pages
 * (audit-trail.ts), so the same entry has the same words everywhere (the Boss's "What the team is doing" list can show a Developer's
 * entry too). Words that already existed for staff are not in it, so no existing line changes.
 */
export const ACCOUNT_AND_DEVELOPER_WORDS: Record<string, string> = {
  "auth.login_failed_suppressed": msg("More failed sign-ins followed in a short time (not every one is listed)"),
  "developer.denied": msg("was refused — no permission"),
  "developer.viewed": msg("looked at a page"),
  "developer.viewed_limit": msg("opened very many pages in a short time (not every page is listed)"),
  "developer.exported": msg("exported records to a file"),
  "developer.downloaded": msg("downloaded a file"),
  "developer.inspected": msg("checked what a person can do"),
  "developer.business_viewed": msg("looked at the business data"),
  "developer.work_as_started": msg("started working as another person"),
  "developer.work_as_ended": msg("stopped working as another person"),
  "developer.work_as_expired": msg("Working as another person ended by itself (the time was over or the session ended)"),
  "developer.work_as_refused": msg("was refused when trying to work as another person"),
  "developer.work_as_notice": msg("Notice to the Boss about working as another person"),
  "developer.access_notice": msg("Notice to the Boss about a change to a staff account"),
  "developer.endpoint_refused": msg("tried to use the Developer's pages and was refused"),
  "developer.provisioned": msg("set up the Developer account"),
  "developer.password_rotated": msg("changed the Developer password"),
  "developer.deactivated": msg("switched the Developer account off"),
  "guest.suspended": msg("suspended a customer"),
  "guest.reactivated": msg("switched a customer back on"),
  "restaurant_order.item_prepared": msg("started preparing an order"),
  "guide_book.uploaded": msg("put guide books in the Guide books page"),
  "guide_book.removed": msg("took a guide book out of the Guide books page"),
  "user.suspended": msg("suspended a staff account"),
  "user.signed_out_everywhere": msg("signed a person out of every device"),
  "user.create_failed": msg("could not add a staff account"),
  "user.update_failed": msg("could not change a staff account"),
  "user.password_reset_failed": msg("could not reset a password"),
  "user.permission_change_failed": msg("could not change a role's rights"),
  "user.delete_failed": msg("could not remove a staff account"),
  "user.suspend_failed": msg("could not suspend a staff account"),
  "user.reactivate_failed": msg("could not switch a staff account back on"),
  "user.sign_out_failed": msg("could not sign a person out of every device"),
  "settings.update.refused": msg("was refused a change to the settings about money"),
};

/** Plain-English words for what staff did (from the history log), and which part of the hotel it was. */
const WORDS: Record<string, string> = {
  ...ACCOUNT_AND_DEVELOPER_WORDS,
  "auth.login": msg("signed in"), "auth.logout": msg("signed out"), "auth.login_failed": msg("Failed sign-in (not signed in)"),
  "reservation.created": msg("made a booking"), "reservation.checked_in": msg("checked a guest in"), "reservation.checked_in_voided": msg("checked a guest in — cancelled later"), "reservation.checkin_cancelled": msg("cancelled a check-in"), "reservation.checked_out": msg("checked a guest out"),
  "reservation.extended": msg("extended a stay"), "reservation.overstay_charged": msg("put extra nights on the bill"), "reservation.room_assigned": msg("moved a guest to another room"), "reservation.room_changed": msg("changed a guest's room"),
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
  "report.daily_generated": msg("sent the daily report"), "settings.updated": msg("changed settings"), "payment_account.opening_balance_set": msg("set an account's opening balance"), "settings.order_sounds": msg("changed the restaurant sounds"),
  "user.password_changed": msg("changed a password"), "user.profile_updated": msg("updated their profile"), "user.sessions_revoked": msg("signed out their other devices"),
  "user.created": msg("added a staff member"), "user.permission_changed": msg("changed staff permissions"),
  "user.updated": msg("changed a staff account's details"), "user.role_changed": msg("changed a staff account's role"),
  "user.deactivated": msg("switched a staff account off"), "user.reactivated": msg("switched a staff account back on"), "user.password_reset": msg("reset a password"),
  "request.created": msg("logged a guest request"), "request.accepted": msg("accepted a guest request"), "request.updated": msg("updated a guest request"),
  "complaint.logged": msg("logged a complaint"), "complaint.resolved": msg("resolved a complaint"),
  "transport.driver_assigned": msg("assigned a driver"), "transport.driver_changed": msg("changed the driver"), "transport.completed": msg("completed a trip"), "transport.cancelled": msg("cancelled a trip"),
  "meeting.booked": msg("booked the meeting room"), "meeting.started": msg("started a meeting"), "meeting.completed": msg("completed a meeting"), "meeting.changed": msg("changed a meeting booking"),
  "payment.refunded": msg("gave a refund"), "payment.group": msg("received a group payment"), "payment.company": msg("received a company payment"),
  "reservation.occupant_added": msg("added a guest to a booking"), "reservation.occupant_removed": msg("removed a guest from a booking"), "reservation.extended_free": msg("extended a stay (free)"),
  "reservation.charge_added": msg("added a charge to a bill"), "reservation.late_arrival": msg("noted a late arrival"),
  "report.shift_generated": msg("made a shift report"), "report.shift_regenerated": msg("regenerated a shift report"), "report.daily_regenerated": msg("regenerated the daily report"),
  "report.room_generated": msg("made the room report"), "report.room_regenerated": msg("regenerated the room report"),
  "report.daily_sent": msg("sent the daily report to the recipients"), "report.room_sent": msg("sent the room report to the recipients"),
  "report.shift_sent": msg("sent a shift report to the recipients"), "report.staff_sent": msg("sent a staff report to the recipients"),
  "shift.started": msg("started a shift"), "shift.ended": msg("closed their shift"), "shift.closed_by_manager": msg("closed someone's shift (manager, with the reason)"), "shift.taken_over": msg("took over a shift"), "shift.note_added": msg("left a handover note"),
  "hotel_qr.created": msg("made a Hotel QR"), "hotel_qr.renamed": msg("renamed a Hotel QR"), "hotel_qr.regenerated": msg("made a new Hotel QR code (the old card stopped working)"),
  "hotel_qr.enabled": msg("switched a Hotel QR on"), "hotel_qr.disabled": msg("switched a Hotel QR off"), "hotel_qr.archived": msg("archived a Hotel QR"),
  "hotel_qr.settings": msg("changed the Hotel QR switches"),
  "spin.won": msg("won a Spin to Win gift"), "spin.free_spin": msg("won the Spin to Win bonus spin"), "spin.try_again": msg("spun — no gift this time"), "spin.sent": msg("sent their Spin to Win gifts to the restaurant"), "spin.claimed": msg("chose where to enjoy a Spin to Win gift"), "spin.declined": msg("said no, thank you to a Spin to Win gift"), "spin.no_gift": msg("could not spin — no gift was available"),
  "spin.settings": msg("changed the Spin to Win numbers"), "spin.enabled": msg("switched Spin to Win on"), "spin.disabled": msg("switched Spin to Win off"),
  "spin.tier": msg("changed a room's Spin to Win tier"), "spin.prize": msg("changed which menu items are Spin to Win gifts"),
  "spin_qr.regenerated": msg("made a new Spin to Win code (the old card stopped working)"), "spin_qr.enabled": msg("switched a Spin to Win card on"), "spin_qr.disabled": msg("switched a Spin to Win card off"),
  "restaurant_order.gift": msg("sent a Spin to Win gift to the kitchen"),
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
  if (a.startsWith("restaurant_order.") || a.startsWith("dining_session.") || a.startsWith("spin.") || a.startsWith("spin_qr.")) return msg("Restaurant");
  if (a.startsWith("room.")) return msg("Rooms");
  if (a.startsWith("guest.") || a.startsWith("corporate.")) return msg("Customers");
  if (a.startsWith("shift.") || a.startsWith("report.shift")) return msg("Shifts");
  if (a.startsWith("request.") || a.startsWith("complaint.") || a.startsWith("meeting.")) return msg("Front desk");
  return msg("Other");
}
