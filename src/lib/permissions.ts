/**
 * Permission catalogue. Codes are stored in the `permissions` table and
 * granted to roles through `role_permissions`; the server checks codes, never
 * role names, so roles stay configurable. This file is the seed source and
 * the type source — it is safe to import from client components for hiding
 * UI, but hiding is cosmetic: every server action re-checks.
 */
import { msg } from "../i18n/msg"; // relative: prisma/seed.ts imports this file

export const PERMISSIONS = {
  // Dashboards & reports
  "dashboard.admin": msg("Admin dashboard: full business & system overview"),
  "dashboard.owner": msg("View the owner/boss business dashboard"),
  "dashboard.manager": msg("View the manager operations dashboard"),
  "dashboard.front_desk": msg("View the front-desk dashboard"),
  "reports.view": msg("View management and financial reports"),
  "reports.daily.manage": msg("Regenerate and resend daily boss reports"),

  // Reservations & guests
  "reservations.view": msg("View reservations"),
  "reservations.create": msg("Create reservations and walk-ins"),
  "reservations.edit": msg("Edit reservations and reassign rooms"),
  "reservations.cancel": msg("Cancel reservations and mark no-shows"),
  "reservations.check_in": msg("Check guests in"),
  "reservations.check_out": msg("Check guests out"),
  "reservations.discount_override": msg("Change booking discounts from the booking-request screen"),
  "pricing.manage": msg("Set room prices and create promotions (Admin)"),
  "finance.view": msg("See the general ledger, money accounts, receivables and staff activity"),
  "finance.manage": msg("Record transfers, owner money and corrections; accept cash counts"),
  "reservations.checkout_override": msg("Check a guest out with an unpaid balance (authorised override)"),
  "reservations.checkin_override": msg("Check a guest into a room housekeeping has not marked ready (authorised override)"),
  "guests.view": msg("View guest profiles"),
  "guests.manage": msg("Create and edit guest profiles"),
  "guests.delete": msg("Change a customer's name or phone number, and remove customers"),

  // Rooms
  "rooms.view": msg("View rooms and room status"),
  "rooms.status.update": msg("Change room housekeeping status"),
  "rooms.manage": msg("Room set-up (Admin): add and edit rooms, room types, amenities and room QR cards"),
  "hotel_qr.manage": msg("Hotel booking QR (Admin): create, regenerate, revoke and switch QR codes on or off; booking from the QR; its numbers"),
  "rooms.block": msg("Put rooms into maintenance / out of service"),

  // Money
  "payments.record": msg("Record payments"),
  "payments.reverse": msg("Reverse payments and issue refunds"),
  "ledger.view": msg("View the general ledger (every money movement, read-only)"),
  "reservations.confirm_unpaid": msg("Confirm / hold a booking without payment"),
  "invoices.view": msg("View invoices"),
  "invoices.manage": msg("Create, issue and cancel invoices"),
  "corporate.view": msg("View corporate customers and balances"),
  "corporate.manage": msg("Manage corporate customers"),
  "expenses.record": msg("Record expenses"),
  "expenses.view_all": msg("View all expenses (not only own)"),
  "expenses.approve": msg("Approve, reject or request correction of expenses"),
  "expenses.void": msg("Void recorded expenses"),
  "revenue.record": msg("Record restaurant, bar and other sales"),
  "revenue.void": msg("Void restaurant, bar and other sales"),
  "meeting.view": msg("View meeting room bookings"),
  "meeting.manage": msg("Create and edit meeting room bookings"),

  // Staff & operations
  "shifts.view": msg("View shift schedule and handover"),
  "shifts.work": msg("Start/end own shift and write handover notes"),
  "shifts.manage": msg("Create schedules, swap shifts and record replacements"),
  "staff.activity.view": msg("View staff activity and audit history"),
  "users.manage": msg("Manage staff accounts and role permissions"),
  "settings.manage": msg("Change hotel settings"),
  "contact.view": msg("View website contact messages"),
  "requests.view": msg("View guest service requests"),
  "requests.manage": msg("Create, assign and update guest service requests"),
  "transport.view": msg("View transport trips"),
  "transport.request": msg("Request transport for guests"),
  "transport.manage": msg("Assign drivers/vehicles and manage all trips"),
  "transport.driver": msg("Driver view: own assigned trips only (no financial data)"),
  "website.manage": msg("Manage website content, media library and hotel services"),
  "booking_requests.view": msg("View online booking requests from the website"),
  "restaurant.orders": msg("Restaurant portal: see every order, place orders, text customers"),
  "restaurant.serve": msg("Restaurant portal as a waiter: serve ready orders, mark them served, add items to orders"),
  "restaurant.shift": msg("Work own restaurant shift: start it, and close it only when no table or order is left (or it is transferred)"),
  "restaurant.device": msg("Only the main restaurant's own login (the shared computer / iPad) — never a person's role: it stays signed in, and waiters give their PIN on it"),
  "restaurant.payments.confirm": msg("Confirm restaurant payments (the Restaurant Counter's own are confirmed as they are recorded)"),
  "restaurant.menu": msg("Restaurant set-up (Admin): menu, prices, categories, photos, tables, restaurant QR codes and order sounds"),
  "kitchen.orders": msg("Restaurant portal as the Mpishi: accept, prepare and mark any order ready (food and drinks)"),
  "bar.orders": msg("Restaurant portal: accept, prepare and mark drinks ready"),
  "booking_requests.manage": msg("Handle online booking requests (contact, confirm, reject, convert)"),
  "inventory.view": msg("See hotel stock (all departments), alerts and movements"),
  "inventory.request": msg("Ask for stock or supplies for a department (no money, no stock changes)"),
  "inventory.use": msg("Record stock used and report waste (waste waits for a manager)"),
  "inventory.receive": msg("Record stock received from suppliers"),
  "inventory.approve": msg("Approve waste, count stock and correct quantities (with a reason)"),
  "inventory.manage": msg("Set up inventory: items, categories, departments, suppliers, units and recipes"),
  "assets.view": msg("See the hotel's assets (furniture, equipment, electronics)"),
  "assets.manage": msg("Add and update hotel assets"),
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;

export const ALL_PERMISSIONS = Object.keys(PERMISSIONS) as PermissionCode[];

const RECEPTIONIST: PermissionCode[] = [
  "dashboard.front_desk",
  "reservations.view",
  "reservations.create",
  "reservations.edit",
  "reservations.check_in",
  "reservations.check_out",
  "guests.view",
  "guests.manage",
  "guests.delete",
  "rooms.view",
  "rooms.status.update",
  "payments.record",
  "invoices.view",
  "corporate.view",
  // Reception takes the guests' payments and sees what it collected (Collections). Income and Expenses,
  // the ledger and the accounts are managers' and the MD's (owner, 2026-10-04).
  "revenue.record",
  "restaurant.orders",
  "restaurant.payments.confirm",
  "meeting.view",
  "meeting.manage",
  "shifts.view",
  "shifts.work",
  "contact.view",
  "requests.view",
  "requests.manage",
  "transport.view",
  "transport.request",
  "booking_requests.view",
  "booking_requests.manage",
];

/**
 * Manager — hotel operations authority: runs and supervises the hotel every day. Sees everything
 * reception, the restaurant, the kitchen, housekeeping and the stores do, and makes the operational
 * decisions (close / reopen a room, move a guest, change or cancel bookings, approve exceptions,
 * cancel orders, discounts within the limit, stock received / counted / wasted / moved). Set-up is
 * the Admin's: rooms and room types, menu and prices, tables and QR codes, inventory structure,
 * suppliers, expense types, staff access, pricing, payment accounts and settings.
 */
const MANAGER: PermissionCode[] = [
  ...RECEPTIONIST,
  "dashboard.manager",
  "reports.view",
  "reports.daily.manage",
  "finance.view",
  "ledger.view",
  "reservations.cancel",
  "reservations.confirm_unpaid",
  "reservations.discount_override",
  "rooms.block",
  "payments.reverse",
  "invoices.manage",
  "corporate.manage",
  "expenses.record",
  "expenses.view_all",
  "expenses.approve",
  "expenses.void",
  "revenue.void",
  "shifts.manage",
  "staff.activity.view",
  "reservations.checkout_override",
  "reservations.checkin_override",
  "transport.manage",
  "kitchen.orders",
  "bar.orders",
  "restaurant.serve",
  // Stock requests are the restaurant's (and the managers', who also ask) — not reception's (owner, 2026-10-04).
  "inventory.request",
  "inventory.view",
  "inventory.use",
  "inventory.receive",
  "inventory.approve",
  "assets.view",
];

const DRIVER: PermissionCode[] = ["transport.driver"];
/**
 * Restaurant — Waiter: runs the whole restaurant — accepts and prepares any order, takes it out,
 * adds items, prints bills, takes payments, texts customers. No bookings, no finance.
 */
// Waiters serve; they never record official restaurant payments (the shared Restaurant Counter does), never
// record expenses and have no stores (owner, 2026-10-04) — stock still comes off by the recipes when orders are ready.
const RESTAURANT: PermissionCode[] = ["restaurant.orders", "restaurant.serve", "restaurant.shift", "kitchen.orders", "bar.orders", "guests.view", "guests.manage", "guests.delete"];
/** Restaurant — Mpishi (cook): prepares food and drinks (accept, prepare, mark ready) and can take orders. No prices, payments or reports. */
const KITCHEN: PermissionCode[] = ["kitchen.orders", "bar.orders", "inventory.view", "inventory.use", "inventory.request"];
/** The shared Restaurant Counter account (one for the restaurant): the whole restaurant, and the official restaurant payments. Waiters say who they are with their ID for the service they do there. */
const RESTAURANT_SCREEN: PermissionCode[] = ["restaurant.orders", "restaurant.serve", "restaurant.device", "kitchen.orders", "bar.orders", "revenue.record", "restaurant.payments.confirm", "guests.view"];

/** The department each built-in role belongs to (staff accounts: choose the department, then the role). */
export const ROLE_DEPARTMENT: Record<string, string> = {
  ADMIN: msg("Management"), OWNER: msg("Management"), MANAGER: msg("Management"), RECEPTIONIST: msg("Front office"), RESTAURANT: msg("Restaurant"), KITCHEN: msg("Restaurant"), RESTAURANT_SCREEN: msg("Restaurant"), DRIVER: msg("Transport"),
};

export const DEFAULT_ROLES: Record<
  string,
  { name: string; description: string; permissions: PermissionCode[] }
> = {
  ADMIN: {
    name: msg("Managing Director (MD)"),
    description: msg("Business and system authority: everything the Manager does, plus staff and access, configuration (rooms, menu, tables, inventory structure), pricing, payment accounts, settings and audit."),
    permissions: ALL_PERMISSIONS,
  },
  OWNER: {
    name: msg("Owner / Boss"),
    description: msg("Business authority: receives the reports, reviews performance and makes the high-level decisions; does not run the hotel day to day."),
    permissions: ALL_PERMISSIONS,
  },
  MANAGER: {
    name: msg("Manager"),
    description: msg("Hotel operations authority: runs and supervises the hotel every day — monitors every department, makes operational decisions and steps in; staff do the routine work."),
    permissions: MANAGER,
  },
  RECEPTIONIST: {
    name: msg("Receptionist"),
    description: msg("Operates the front desk."),
    permissions: RECEPTIONIST,
  },
  RESTAURANT: {
    name: msg("Waiter"),
    description: msg("Waiter: serves customers — makes their orders, serves them, adds items, shows the bill, texts customers. Payments are recorded at the Restaurant Counter. No expenses."),
    permissions: RESTAURANT,
  },
  RESTAURANT_SCREEN: {
    name: msg("Restaurant Counter (shared account)"),
    description: msg("The one shared Restaurant account at the Counter: sees the whole restaurant and records every official restaurant payment. Waiters are picked from the list there for the service they do — never a Counter person's own account."),
    permissions: RESTAURANT_SCREEN,
  },
  KITCHEN: {
    name: msg("Mpishi (cook)"),
    description: msg("Restaurant: prepares food and drinks — accept, prepare, mark ready; can place orders."),
    permissions: KITCHEN,
  },
  DRIVER: {
    name: msg("Driver"),
    description: msg("Hotel driver: sees only assigned trips, no guest finances."),
    permissions: DRIVER,
  },
};

/** Codes that work without a shift: starting and closing it, its notes, one's own shifts and collections. */
export const SHIFT_FREE_CODES: ReadonlySet<string> = new Set<PermissionCode>(["shifts.view", "shifts.work", "shifts.manage"]);
/**
 * A receptionist works under their own open shift (Open → Work → Close); managers, the MD and the
 * owner supervise without one. By permission, never by role name: whoever can work a shift but not
 * manage shifts.
 */
export const needsOwnShift = (p: ReadonlySet<string>) => p.has("shifts.work") && !p.has("shifts.manage");

/** A waiter works their own restaurant shift (start / close when nothing is left) — no reception gate. */
export const worksWaiterShift = (p: ReadonlySet<string>) => p.has("restaurant.shift") && !p.has("shifts.manage");
/** The shared restaurant screen: actions that need a person (taking charge, taking money) ask for the waiter's PIN. */
export const isRestaurantDevice = (p: ReadonlySet<string>) => p.has("restaurant.device") && !p.has("dashboard.manager") && !p.has("dashboard.owner") && !p.has("dashboard.admin");
