// The clean start of the hotel — what both tools share: which tables are the hotel's set-up, which hold what was done
// while practising, which hold both; and where the database address is read (it is never printed).
import fs from "node:fs";

export const LIVE = process.argv.includes("--live");

/** Set-up of the hotel. */
export const KEEP = [
  "_prisma_migrations", "hotel_settings", "users", "roles", "permissions", "role_permissions", "sessions", "rate_limit_buckets",
  "room_types", "room_type_amenities", "room_type_translations", "rooms", "amenities", "amenity_translations", "price_rules", "promotions",
  "booking_sources", "payment_methods", "money_accounts", "expense_categories", "expense_items", "revenue_categories",
  "menu_categories", "menu_category_translations", "menu_items", "menu_item_translations", "restaurant_locations",
  "inventory_categories", "inventory_departments", "inventory_items", "recipe_lines", "suppliers", "assets", "asset_movements",
  "hotel_services", "hotel_service_translations", "transport_services", "transport_service_translations", "transport_service_options",
  "transport_service_option_translations", "vehicles", "media_assets", "site_content",
  "spin_prizes", "spin_qr_codes", "room_qr_codes", "booking_qr_codes",
];

/** What the hotel did while practising. Table → the heading it is counted under. */
export const WORK = {
  guests: "Customers", corporate_customers: "Customers (companies)",
  reservations: "Bookings and stays", reservation_rooms: "Bookings and stays", reservation_guests: "Bookings and stays", room_nights: "Bookings and stays",
  room_assignments: "Bookings and stays", booking_groups: "Bookings and stays", reservation_charges: "Room charges",
  booking_requests: "Website booking requests", booking_request_events: "Website booking requests", booking_qr_events: "Hotel QR scans",
  contact_messages: "Website contact messages",
  invoices: "Invoices", invoice_items: "Invoices", thank_you_notes: "Thank-you notes",
  payments: "Payments", payment_corrections: "Payments", mobile_payments: "Phone payment requests (nTZS)", withdrawals: "Withdrawals (nTZS)",
  revenue_transactions: "Income records", expenses: "Expenses", expense_approvals: "Expenses", ledger_entries: "Ledger entries",
  cash_counts: "Cash counts",
  restaurant_orders: "Restaurant and room-service orders", restaurant_order_items: "Restaurant and room-service orders",
  restaurant_order_events: "Restaurant and room-service orders", restaurant_order_payments: "Restaurant and room-service orders",
  dining_sessions: "Restaurant tables in use", dining_session_members: "Restaurant tables in use", dining_session_events: "Restaurant tables in use",
  dining_seats: "Restaurant tables in use", table_moves: "Restaurant tables in use", table_reservations: "Table bookings",
  waiter_assignments: "Waiter work", service_requests: "Guest requests", transport_trips: "Transport trips",
  spin_sessions: "Spin to Win games", spin_results: "Spin to Win games",
  stock_requests: "Stock requests", stock_request_items: "Stock requests", stock_request_events: "Stock requests",
  actual_shifts: "Staff shifts worked", shift_handover_notes: "Staff shifts worked",
  shift_reports: "Reports", shift_report_versions: "Reports", staff_reports: "Reports", daily_reports: "Reports", daily_report_versions: "Reports",
  room_reports: "Reports", daily_lists: "Daily lists (housekeeping, breakfast)",
  room_status_history: "Room status history", guest_messages: "Messages to guests", notification_deliveries: "Report messages (sent and waiting)",
};

/** Tables that hold both. */
export const MIXED = ["audit_logs", "inventory_movements", "room_blocks", "shift_schedules", "stored_files"];

/** History rows about set-up and sign-ins, and about what was done with guests, orders and money — by the first word of the action. */
export const AUDIT_SETUP = ["auth", "user", "settings", "pricing", "role", "system", "menu", "setup"];
export const AUDIT_WORK = [
  "reservation", "restaurant_order", "room", "payment", "expense", "revenue", "spin", "shift", "guest", "table_reservation", "booking_request",
  "request", "invoice", "group", "transport", "report", "dining_session", "finance", "thank_you", "meeting", "restaurant_table", "corporate",
  "stock_request", "daily_list", "mobile_payment",
];

export const OPENING = `(kind = 'ADJUST' AND note = 'Opening stock')`;

export function fail(msg) { console.error(`\nSTOPPED — ${msg}\n`); process.exit(1); }
export const n = (v) => Number(v).toLocaleString("en-US");
export const id = (s) => `"${s}"`;

/** The address is read here and never shown — not even when it is wrong. */
function address() {
  if (!LIVE) return fs.existsSync(".env") ? fs.readFileSync(".env", "utf8").match(/^DATABASE_URL\s*=\s*["']?([^"'\n]+)/m)?.[1] : null;
  // The live address: a file the owner makes on this computer (.env.reset.local — one line, the connection string), never typed into a command.
  for (const file of [".env.reset.local", ".env.production.local"]) {
    if (!fs.existsSync(file)) continue;
    const text = fs.readFileSync(file, "utf8").trim();
    // However it was copied (the address alone, DATABASE_URL=…, or Neon's "psql '…'" line): the address inside it.
    const value = text.match(/postgres(?:ql)?:\/\/[^\s'"]+/)?.[0];
    if (value) return value;
  }
  return null;
}

export function connection() {
  const value = address();
  if (!value) fail(LIVE ? "the live database address is not on this computer. Copy the connection string from Neon, then run:  pbpaste > .env.reset.local" : "no DATABASE_URL in .env.");
  let url;
  try { url = new URL(value); } catch { fail("the database address cannot be read as an address."); }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (LIVE && local) fail("--live was asked for, but the address is this computer.");
  if (!LIVE && !local) fail("the address in .env is not this computer. The live database needs --live.");
  // --db=<name>: another database on this computer (a copy made to try the clean start on).
  const db = process.argv.find((a) => a.startsWith("--db="))?.slice(5);
  if (db) { if (LIVE) fail("--db is for a copy on this computer, not for the live database."); url.pathname = `/${db}`; }
  const host = local ? url.hostname : `${url.hostname.slice(0, 9)}…${url.hostname.split(".").slice(-2).join(".")}`;
  return { connectionString: db ? url.toString() : value, label: `${LIVE ? "LIVE" : "local"} · ${host} · ${url.pathname.slice(1)}` };
}
