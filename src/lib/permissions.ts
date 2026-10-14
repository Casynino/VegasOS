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
  "dashboard.finance": msg("Finance desk: the financial dashboard, the purchases to authorize and the cash handovers waiting to be received"),
  "dashboard.procurement": msg("Procurement desk (Accountant): the purchases to quote, order, receive and follow up"),
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
  "cash.handover.submit": msg("Hand over the cash you collected: count it and send it to Finance (reception and the Restaurant Counter)"),
  "cash.handover.view": msg("See the cash handovers, who still holds cash and the differences (read-only)"),
  "cash.handover.review": msg("Receive cash handovers (Finance): confirm what was received, return one for correction, reject one, choose the cash account"),
  "cash.handover.discrepancy": msg("Accept a cash handover that is short or over, with the reason (Finance)"),
  "procurement.manage": msg("Procurement: get supplier quotations, propose a purchase, issue the order once its price is authorized, record deliveries and attach supplier invoices (Finance, and the Accountant who assists Finance — the Accountant never approves or pays)"),
  "purchases.authorize": msg("Authorize a purchase quotation above the approved budget (Finance; above Finance's limit, the Boss or the MD)"),
  "purchases.pay": msg("Verify a supplier invoice and record the payment to the supplier (Finance)"),
  "withdrawals.manage": msg("Withdraw funds: take money out of the hotel's nTZS balance (Boss and Admin)"),
  "withdrawals.reconcile": msg("Withdraw funds: settle by hand a withdrawal nTZS could not confirm"),
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
  "spin.manage": msg("Spin to Win (Admin): switch it on or off, spins and budgets, which menu items are gifts, the room cards"),
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
  "restaurant.prices": msg("Change the selling prices of menu items (Finance) — nothing else on the menu; each order keeps the price it was placed at"),
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

  // Audit and the Developer account
  "audit.view": msg("See the full audit trail: who did what, when, as a Developer or as staff (read-only; nobody can change or delete it)"),
  "developer.access": msg("Developer super user: the developer console and system diagnostics. Held only by the Developer role — never by the Boss, the MD or any staff role"),
} as const;

export type PermissionCode = keyof typeof PERMISSIONS;

/** Rights only the Developer role holds. No business role — not even the Boss or the MD — may be given them. */
export const DEVELOPER_ONLY: readonly PermissionCode[] = ["developer.access"];
/** The Developer account's role. The account type shown on the sign-in page and in every audit entry comes from this. */
export const DEVELOPER_ROLE_CODE = "DEVELOPER";
export const isDeveloperOnly = (code: string) => (DEVELOPER_ONLY as readonly string[]).includes(code);

/** Every right a BUSINESS role (the Boss, the MD…) can hold — all of them except the Developer-only ones. */
export const ALL_PERMISSIONS = (Object.keys(PERMISSIONS) as PermissionCode[]).filter((c) => !isDeveloperOnly(c));

/**
 * THE DEVELOPER ROLE (owner, 2026-10-14) — an explicit allow-list, never "everything except…".
 *
 * The Developer looks at everything and runs the system, but can NEVER write, change, approve, pay, reverse or void money, decide
 * what a guest, a company or a supplier owes, change stock costs, move where guests pay, change an approval or spending limit, or
 * make or send a financial report. Money work is done (and attributed) by Finance, the Boss, the MD or a manager; a test account to
 * try a money flow is made by the Boss or the MD — the Developer cannot make one.
 *
 * Every right is in exactly ONE of the three lists below (DEVELOPER_ALLOWED, DEVELOPER_DENIED, DEVELOPER_ONLY) — the unit test
 * fails for a right that is in none, so a NEW right is never given to the Developer until a person decides which list it belongs to.
 */

/** Every right the Developer holds besides the Developer-only one — written out, one by one. Looking is allowed; so is running the hotel's operations and the system. */
export const DEVELOPER_ALLOWED: readonly PermissionCode[] = [
  // Dashboards (looking only: the buttons on them need their own rights, and a decision about money is refused on the server)
  "dashboard.admin", "dashboard.owner", "dashboard.manager", "dashboard.front_desk", "dashboard.finance", "dashboard.procurement",
  // Reports, the books and the money screens — read only
  "reports.view", "finance.view", "ledger.view", "invoices.view", "corporate.view", "expenses.view_all", "cash.handover.view",
  // The front desk's operations (the bill-shaping actions among them are fenced on the server for a Developer)
  "reservations.view", "reservations.create", "reservations.edit", "reservations.check_in", "reservations.check_out", "reservations.checkin_override",
  "guests.view", "guests.manage", "guests.delete",
  "rooms.view", "rooms.status.update", "rooms.manage", "rooms.block",
  "meeting.view", "meeting.manage",
  "hotel_qr.manage",
  // Staff, shifts and the system's configuration
  "shifts.view", "shifts.work", "shifts.manage", "staff.activity.view", "users.manage", "settings.manage",
  // Guests' requests, transport, website, booking requests
  "contact.view", "requests.view", "requests.manage",
  "transport.view", "transport.request", "transport.manage", "transport.driver",
  "website.manage", "booking_requests.view", "booking_requests.manage",
  // The restaurant: orders, serving, the kitchen and the bar (payments are the Counter's — see DEVELOPER_DENIED)
  "restaurant.orders", "restaurant.serve", "restaurant.shift", "kitchen.orders", "bar.orders",
  // Stock: look, ask, record what was used (waste waits for a manager); assets register
  "inventory.view", "inventory.request", "inventory.use", "assets.view", "assets.manage",
  // The full audit trail
  "audit.view",
];

/**
 * Rights the Developer must never hold, whatever the interface. Each one lets someone record, alter, approve, authorize, pay, reverse
 * or void money; change what a guest, company or supplier owes; change stock costs; change where guests pay or an approval or spending
 * limit; or make or send a financial report.
 */
export const DEVELOPER_DENIED: readonly PermissionCode[] = [
  // Record, reverse, approve, pay, withdraw, confirm, waive — money itself
  "payments.record", "payments.reverse", "revenue.record", "revenue.void", "expenses.record", "expenses.approve", "expenses.void",
  "purchases.pay", "purchases.authorize", "finance.manage", "withdrawals.manage", "withdrawals.reconcile", "restaurant.payments.confirm",
  "cash.handover.submit", "cash.handover.review", "cash.handover.discrepancy", "reservations.confirm_unpaid", "reservations.checkout_override",
  "invoices.manage",
  // Added 2026-10-14 after the code behind each was read:
  "reservations.discount_override", // lowers a booking's bill (the discount limit and the booking-request discount)
  "reservations.cancel",            // cancelling or a no-show settles a paid booking: keeps the payment as income or leaves a refund due
  "pricing.manage",                 // room prices, seasons and promotions: what every guest pays
  "restaurant.menu",                // menu set-up includes every item's selling price (saveMenuItem)
  "restaurant.prices",              // changes a menu item's selling price
  "restaurant.device",              // the Restaurant Counter's own shared login (it records the restaurant's payments) — never a person's right
  "spin.manage",                    // the gift budgets and the menu items given free: a spending limit on gifts
  "corporate.manage",               // a company's credit limit and payment terms, and the credit-limit override on a booking
  "procurement.manage",             // supplier quotations, purchase orders, deliveries and supplier invoices with amounts
  "inventory.receive",              // records stock received: the price paid becomes the item's cost
  "inventory.approve",              // approves waste, counts stock and corrects quantities: changes the stock's value
  "inventory.manage",               // sets an item's cost per unit and its opening quantity (stock valuation)
  "reports.daily.manage",           // makes, regenerates and sends the daily financial reports to the Boss
];

/**
 * Settings the Developer can NOT change even though it holds "settings.manage": they decide where guests pay, who may approve or
 * spend, what a guest owes (fees, tax, policies) or where the financial reports go. Checked on the server when the settings are saved
 * (updateSettingsAction) — a save that leaves these as they are works as before. Names are the HotelSettings fields.
 */
export const DEVELOPER_LOCKED_SETTINGS: readonly string[] = [
  // Where guests pay (printed on every invoice and bill)
  "bankName", "bankAccountName", "bankAccountNumber", "bankBranch", "bankSwift", "mobileMoneyName", "mobileMoneyNumber", "mobileMoneyAccountName", "invoiceTerms",
  // Who may approve or spend, and how much
  "expenseApprovalThreshold", "financeAuthorizationLimit", "purchaseApproverMustDiffer",
  // What a guest owes: fees, prices, tax, and what happens to money already paid
  "lateCheckoutFee", "roomServiceFee", "airportTransferPrice", "taxName", "taxRatePercent", "taxIncludedInRates",
  "earlyDeparturePolicy", "noShowPolicy", "dateChangeExcessPolicy", "dateChangePayNow",
  // Where the financial reports go, and whether they go
  "reportEnabled", "shiftReportEnabled", "reportRecipients",
];

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
  "cash.handover.submit",
  // Reception asks for what the front desk needs (tables, paper, supplies); Finance reviews it (owner, 2026-10-13).
  "inventory.request",
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
  // Managers watch the cash handovers (below); handing cash over is the front desk's and the Counter's.
  ...RECEPTIONIST.filter((p) => p !== "cash.handover.submit"),
  "dashboard.manager",
  "reports.view",
  "reports.daily.manage",
  "finance.view",
  "ledger.view",
  "cash.handover.view",
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
const RESTAURANT_SCREEN: PermissionCode[] = ["restaurant.orders", "restaurant.serve", "restaurant.device", "kitchen.orders", "bar.orders", "revenue.record", "restaurant.payments.confirm", "cash.handover.submit", "inventory.request", "guests.view"];

/**
 * Accountant — procurement and purchasing (owner, 2026-10-13): gets the supplier quotations for the requests Finance
 * approved, proposes the purchase, issues the order once Finance authorized it, records what was delivered and attaches
 * the supplier's documents. Sees stock (to check it first) — and never approves, authorizes or pays anything, touches an
 * account or edits a financial record. Finance holds the money.
 */
const ACCOUNTANT: PermissionCode[] = ["dashboard.procurement", "procurement.manage", "inventory.view", "inventory.request"];

/**
 * Finance — the hotel's financial authority (owner, 2026-10-13: "full control of all financial activities"): sees every
 * account, transaction and report; records payments and sales; receives the cash the front desk and the Counter hand
 * over; reviews and authorizes purchases and pays suppliers; keeps the accounts, expenses, prices and discounts in order;
 * withdraws from nTZS; makes and sends the daily reports. Never runs the front desk, the kitchen or the system's
 * set-up: no check-in/out, no orders, no staff accounts, no hotel settings. Regenerating a report, settling a withdrawal
 * by hand and how much staff may discount stay with the Boss and the MD.
 */
const FINANCE: PermissionCode[] = [
  "dashboard.finance",
  "purchases.authorize",
  "purchases.pay",
  // Finance organizes the hotel's purchasing (owner, 2026-10-13): quotations, orders, deliveries, invoices — and records what was bought and received.
  "procurement.manage",
  "inventory.receive",
  "reports.view",
  "reports.daily.manage",
  "payments.record",
  "revenue.record",
  "withdrawals.manage",
  "restaurant.prices",
  // Read-only: the shifts and their money, what the stores and the assets are worth.
  "shifts.view",
  "inventory.view",
  "assets.view",
  "finance.view",
  "finance.manage",
  "ledger.view",
  "cash.handover.view",
  "cash.handover.review",
  "cash.handover.discrepancy",
  "payments.reverse",
  "revenue.void",
  "invoices.view",
  "invoices.manage",
  "corporate.view",
  "corporate.manage",
  "expenses.record",
  "expenses.view_all",
  "expenses.approve",
  "expenses.void",
  "pricing.manage",
  // To follow a payment back to its booking, and to see who the customer is — read-only.
  "reservations.view",
  "guests.view",
];

/** The department each built-in role belongs to (staff accounts: choose the department, then the role). */
export const ROLE_DEPARTMENT: Record<string, string> = {
  ADMIN: msg("Management"), OWNER: msg("Management"), MANAGER: msg("Management"), FINANCE: msg("Finance"), ACCOUNTANT: msg("Purchasing"), RECEPTIONIST: msg("Front office"), RESTAURANT: msg("Restaurant"), KITCHEN: msg("Restaurant"), RESTAURANT_SCREEN: msg("Restaurant"), DRIVER: msg("Transport"),
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
  DEVELOPER: {
    name: msg("Developer (super user)"),
    description: msg("The system's developer: sees and troubleshoots every department, the settings, the staff accounts and the audit trail, with every action recorded as a Developer action. Cannot record, change, approve, pay, reverse or void money, decide what a guest or supplier owes, or change where guests pay or the money limits. Created only by a controlled setup — never from the Users page."),
    permissions: [...DEVELOPER_ALLOWED, ...DEVELOPER_ONLY],
  },
  MANAGER: {
    name: msg("Manager"),
    description: msg("Hotel operations authority: runs and supervises the hotel every day — monitors every department, makes operational decisions and steps in; staff do the routine work."),
    permissions: MANAGER,
  },
  FINANCE: {
    name: msg("Finance"),
    description: msg("Financial authority: reviews and authorizes purchases, pays suppliers, receives the cash handed over by reception and the Restaurant Counter, keeps the accounts, expenses, prices and discounts in order and reports on them."),
    permissions: FINANCE,
  },
  ACCOUNTANT: {
    name: msg("Accountant"),
    description: msg("Procurement and purchasing: gets supplier quotations for approved requests, issues the order once Finance authorized it, records deliveries and documents. Never approves or pays."),
    permissions: ACCOUNTANT,
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
export const SHIFT_FREE_CODES: ReadonlySet<string> = new Set<PermissionCode>(["shifts.view", "shifts.work", "shifts.manage", "cash.handover.submit"]);
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
