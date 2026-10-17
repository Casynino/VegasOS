import type { PermissionCode } from "@/lib/permissions";
import { msg } from "@/i18n/msg";
import { CASH_HANDOVER_ON } from "@/lib/cash-handover";

export interface NavItem {
  href: string;
  label: string;
  icon: string; // lucide icon name, resolved in StaffNav
  anyOf: PermissionCode[];
  /** Shown only to people who hold ALL of these as well (on top of anyOf). */
  allOf?: PermissionCode[];
  /** Hide the item from users who also hold any of these (e.g. the driver view for managers). */
  hideIf?: PermissionCode[];
  /** Count shown as a badge (e.g. new booking requests). */
  badge?: number;
  /** Kept at the top of its group, in the order listed (e.g. Finance → Overview, Accounts). */
  pinned?: boolean;
}

export interface NavSection {
  title: string;
  /** lucide icon name for the section heading */
  icon: string;
  items: NavItem[];
  /** Keep the items in the order listed (the owner's order), not sorted by name. */
  ordered?: boolean;
  /** Show the heading even when this is the only section (the Developer console is only one, and says so). */
  titled?: boolean;
}

/**
 * Staff navigation, grouped the way the hotel works. Only routes that exist
 * are listed. The signed-in user's own dashboard is shown separately as
 * "Home", so it is filtered out of these groups.
 */
export const NAV: NavSection[] = [
  {
    // Right below Home: the money comes first for managers and the MD.
    title: msg("Finance"), icon: "ReceiptText", ordered: true,
    // The owner's order: the overview first, then income, expenses and the accounts — and every one after that from the shortest name to the longest (a staircase, owner 2026-10-13).
    items: [
      { href: "/staff/finance", label: msg("Overview"), icon: "Wallet", anyOf: ["finance.view"] },
      // Income and Expenses are managers' and the MD's; reception sees what it collected in Collections (owner, 2026-10-04).
      { href: "/staff/payments", label: msg("Income"), icon: "Banknote", anyOf: ["reports.view", "finance.view"] },
      { href: "/staff/expenses", label: msg("Expenses"), icon: "Receipt", anyOf: ["expenses.record", "expenses.view_all"] },
      { href: "/staff/finance/accounts", label: msg("Accounts"), icon: "Landmark", anyOf: ["ledger.view", "finance.view"] },
      // Invoices are not in the sidebar (the owner's choice) — they open from a booking, a group or a company.
      { href: "/staff/corporate", label: msg("Companies"), icon: "Building2", anyOf: ["corporate.view"] },
      // The money each person collected from customers — their own ("My collections"); managers pick anyone.
      { href: "/staff/collections", label: msg("Collections"), icon: "Coins", anyOf: ["revenue.record", "payments.record", "dashboard.manager", "dashboard.owner", "dashboard.admin"] },
      { href: "/staff/finance/receivables", label: msg("Who owes us"), icon: "HandCoins", anyOf: ["finance.view"] },
      { href: "/staff/finance/history", label: msg("Edit history"), icon: "History", anyOf: ["finance.view"] },
      // The cash reception and the Restaurant Counter hand to Finance (Finance receives; managers watch).
      ...(CASH_HANDOVER_ON ? [{ href: "/staff/accountant/handovers", label: msg("Cash handovers"), icon: "HandCoins", anyOf: ["cash.handover.view", "cash.handover.review"] as PermissionCode[] }] : []),
      { href: "/staff/finance/ledger", label: msg("General ledger"), icon: "ArrowLeftRight", anyOf: ["ledger.view", "finance.view"] },
      // Money out of nTZS, to a phone or a bank — only for those who may withdraw (the Boss and the administrator).
      { href: "/staff/finance/withdraw", label: msg("Withdraw funds"), icon: "BanknoteArrowUp", anyOf: ["withdrawals.manage"] },
      // nTZS — the hotel's one online payment: status, on/off per service, every attempt, reconciliation.
      { href: "/staff/finance/online", label: msg("Online payments"), icon: "Smartphone", anyOf: ["finance.view"] },
      // Finance's Home is a portal of its own: it is the Finance person's Home pill, not an item in the Boss's, the MD's or the Manager's menu
      // (the Boss and the MD have their own dashboard; Finance's work reaches them through the pages above and their own dashboard).
      { href: "/finance/dashboard", label: msg("Finance dashboard"), icon: "BarChart3", anyOf: ["dashboard.finance"], allOf: ["finance.view"], hideIf: ["dashboard.admin", "dashboard.owner", "dashboard.manager"] },
    ],
  },
  {
    title: msg("Front office"), icon: "ConciergeBell",
    items: [
      // Reception's own page; managers and the MD get its rooms and guests owing on their home instead.
      { href: "/reception/dashboard", label: msg("Front desk"), icon: "LayoutDashboard", anyOf: ["dashboard.front_desk"], hideIf: ["dashboard.manager", "dashboard.owner", "dashboard.admin"] },
      // Reception's job: managers and the MD follow check-ins and check-outs on their home, they don't do them.
      { href: "/staff/check-in", label: msg("Check-in"), icon: "DoorOpen", anyOf: ["reservations.check_in"], hideIf: ["dashboard.manager", "dashboard.owner", "dashboard.admin"] },
      { href: "/staff/check-out", label: msg("Check-out"), icon: "DoorClosed", anyOf: ["reservations.check_out"], hideIf: ["dashboard.manager", "dashboard.owner", "dashboard.admin"] },
      { href: "/staff/driver", label: msg("My trips"), icon: "Car", anyOf: ["transport.driver"], hideIf: ["reservations.view"] },
    ],
  },
  {
    title: msg("Bookings"), icon: "CalendarDays",
    // Short names, small to big: book a stay, all the stays, bookings from the website, the Hotel QR, the room calendar.
    items: [
      // Reception books; managers and the MD follow the bookings (Stays, Online, Calendar).
      { href: "/staff/reservations/new", label: msg("Book"), icon: "CalendarPlus", anyOf: ["reservations.create"], hideIf: ["dashboard.manager", "dashboard.owner", "dashboard.admin"] },
      { href: "/staff/reservations", label: msg("Stays"), icon: "CalendarCheck", anyOf: ["reservations.view"] },
      { href: "/staff/booking-requests", label: msg("Online"), icon: "Inbox", anyOf: ["booking_requests.view"] },
      // The "Scan to book your stay" card: reception shows and prints it and follows its bookings; the Admin manages it.
      { href: "/staff/hotel-qr", label: msg("Hotel QR"), icon: "QrCode", anyOf: ["reservations.view", "hotel_qr.manage"] },
      { href: "/staff/reservations/calendar", label: msg("Calendar"), icon: "CalendarRange", anyOf: ["reservations.view"] },
    ],
  },
  {
    title: msg("Hotel services"), icon: "BedDouble",
    items: [
      { href: "/staff/rooms", label: msg("Rooms"), icon: "BedDouble", anyOf: ["rooms.view"] },
      // The printable Housekeeping Checklist and In-House Guest & Breakfast List (also on reception's dashboard).
      { href: "/staff/lists", label: msg("Daily lists"), icon: "ClipboardList", anyOf: ["dashboard.front_desk"] },
      // The guests' requests (towels, cleaning, repairs) and, right beside it, what the front desk asks Finance to buy (owner, 2026-10-13) — both at the bottom, by name length.
      { href: "/staff/requests", label: msg("Guest requests"), icon: "ClipboardCheck", anyOf: ["requests.view"] },
      // Reception asks for what the front desk needs (tables, paper, supplies) and Finance reviews it. Those who work in the Stores find it there.
      { href: "/staff/stock-requests", label: msg("Purchase requests"), icon: "ClipboardList", anyOf: ["inventory.request"], hideIf: ["inventory.view", "expenses.approve", "inventory.receive", "restaurant.device"] },

      { href: "/staff/transport", label: msg("Transport"), icon: "BusFront", anyOf: ["transport.view", "transport.manage"] },
      { href: "/staff/meeting-room", label: msg("Meetings"), icon: "Presentation", anyOf: ["meeting.view"] },
      // Gifts for checked-in guests (a wheel on the room's own card): the Admin sets it up; managers follow what was given.
      { href: "/staff/spin-to-win", label: msg("Spin to Win"), icon: "Gift", anyOf: ["spin.manage", "reports.view"] },
    ],
  },
  {
    // Everything restaurant together: the orders (the portal), taking an order, the tables and the menu.
    title: msg("Restaurant & Bar"), icon: "UtensilsCrossed", ordered: true,
    // The owner's order: the live orders, a new order, the tables, (the menu), history, bookings —
    // short, simple names that step up from small to big: Live · Sell · Tables · History · Bookings.
    items: [
      // Their own payments view (information only — the Counter records the money). A waiter's history is for
      // managers and the MD (Waiters page), not on the waiter's phone (owner, 2026-10-04).
      { href: "/staff/restaurant/waiter/payments", label: msg("Collections"), icon: "HandCoins", anyOf: ["restaurant.shift"], hideIf: ["dashboard.manager", "dashboard.owner", "dashboard.admin", "restaurant.device"] },
      // The waiter's own shifts, each with the report made when it ended.
      { href: "/staff/shifts/all", label: msg("My shifts"), icon: "Clock", anyOf: ["restaurant.shift"], hideIf: ["dashboard.manager", "dashboard.owner", "dashboard.admin", "restaurant.device", "shifts.manage"] },
      // Their own shift, weekly and monthly reports.
      { href: "/staff/reports/staff", label: msg("My reports"), icon: "FileText", anyOf: ["restaurant.shift"], hideIf: ["dashboard.manager", "dashboard.owner", "dashboard.admin", "restaurant.device", "shifts.manage", "reports.view"] },
      { href: "/staff/restaurant", label: msg("Live"), icon: "ReceiptText", anyOf: ["restaurant.orders", "restaurant.menu", "kitchen.orders", "restaurant.serve"] },
      // Waiters and reception take orders; managers and the MD watch the restaurant (Live, Tables, History).
      { href: "/staff/restaurant/pos", label: msg("Sell"), icon: "CirclePlus", anyOf: ["restaurant.orders", "kitchen.orders"], hideIf: ["dashboard.manager", "dashboard.owner", "dashboard.admin"] },
      { href: "/staff/restaurant/tables", label: msg("Tables"), icon: "Armchair", anyOf: ["restaurant.orders", "restaurant.serve", "kitchen.orders", "restaurant.menu"] },
      { href: "/staff/restaurant/menu", label: msg("Menu"), icon: "BookOpenText", anyOf: ["restaurant.menu"] },
      // "Menu · sold out" (/staff/restaurant/availability) is off the menu for now — the owner does not need it.
      // Asking for stock moved to Stores → Stock requests (every department asks there).
      { href: "/staff/restaurant/history", label: msg("History"), icon: "History", anyOf: ["restaurant.orders", "kitchen.orders", "restaurant.menu"] },
      // What every waiter served and which table or room each one served — for managers, the MD and the owner.
      { href: "/staff/restaurant/waiters", label: msg("Waiters"), icon: "Users", anyOf: ["dashboard.manager", "dashboard.owner", "dashboard.admin"] },
      { href: "/staff/restaurant/reservations", label: msg("Reservations"), icon: "CalendarClock", anyOf: ["restaurant.orders", "restaurant.serve"] },
      // The Restaurant Counter asks for restocking and supplies here; the kitchen finds it in the Stores.
      { href: "/staff/stock-requests", label: msg("Purchase requests"), icon: "ClipboardList", anyOf: ["inventory.request"], hideIf: ["inventory.view", "expenses.approve", "inventory.receive", "dashboard.front_desk"] },
      // Waiters see customers here (their one section); reception and managers find them in Settings.
      { href: "/staff/guests", label: msg("Customers"), icon: "Contact", anyOf: ["guests.view"], hideIf: ["reservations.view"] },
    ],
  },
  {
    // Consumable stock (every department), asking for it and buying it, and the hotel's assets — kept apart. From the shortest name to the longest (owner, 2026-10-13).
    title: msg("Stores"), icon: "Boxes", ordered: true,
    items: [
      { href: "/staff/assets", label: msg("Assets"), icon: "Sofa", anyOf: ["assets.view"] },
      { href: "/staff/inventory", label: msg("Inventory"), icon: "Boxes", anyOf: ["inventory.view"] },
      // Approved purchases: quotations → price authorized by Finance → order → delivery → invoice → payment.
      { href: "/staff/procurement", label: msg("Procurement"), icon: "ClipboardCheck", anyOf: ["dashboard.procurement", "procurement.manage", "purchases.authorize", "purchases.pay"] },
      // Ask → review → buy → final approval: the kitchen, waiters and reception ask; managers review, buy and approve.
      { href: "/staff/stock-requests", label: msg("Purchase requests"), icon: "ClipboardList", anyOf: ["inventory.view", "expenses.approve", "inventory.receive"] },
    ],
  },
  {
    title: msg("People"), icon: "Users",
    items: [
      { href: "/staff/shifts", label: msg("Shifts"), icon: "Clock", anyOf: ["shifts.view"] },
      // The person's own shift (the one running now, or the last) — one tap from anywhere.
      { href: "/staff/shifts/me", label: msg("My shift"), icon: "History", anyOf: ["shifts.work"], hideIf: ["shifts.manage", "dashboard.manager", "dashboard.owner", "dashboard.admin"] },
      // Their own shift, weekly and monthly reports.
      { href: "/staff/reports/staff", label: msg("My reports"), icon: "FileText", anyOf: ["shifts.work"], hideIf: ["shifts.manage", "reports.view", "dashboard.manager", "dashboard.owner", "dashboard.admin"] },
      // Everyone's shifts (waiters and reception) with the report made when each ended — managers, the MD and the owner.
      { href: "/staff/shifts/all", label: msg("Staff shifts"), icon: "History", anyOf: ["shifts.manage", "reports.view"] },
      { href: "/staff/activity", label: msg("Activity"), icon: "Activity", anyOf: ["staff.activity.view"] },
      // The full record of who did what — Developer actions included — read-only: the Boss, the MD and the Developer.
      { href: "/staff/audit", label: msg("Audit trail"), icon: "History", anyOf: ["audit.view"] },
      { href: "/staff/users", label: msg("Staff & roles"), icon: "UserCog", anyOf: ["users.manage"] },
    ],
  },
  {
    title: msg("Insights"), icon: "TrendingUp",
    items: [
      { href: "/admin/dashboard", label: msg("Overview"), icon: "BarChart3", anyOf: ["dashboard.admin"] },
      { href: "/manager/dashboard", label: msg("Overview"), icon: "BarChart3", anyOf: ["dashboard.manager", "dashboard.owner"], hideIf: ["dashboard.admin"] },
      { href: "/staff/reports", label: msg("Reports"), icon: "FileChartColumn", anyOf: ["reports.view"] },
      { href: "/staff/reports/daily", label: msg("Daily reports"), icon: "NotebookText", anyOf: ["reports.view"] },
      // Every shift's report, and the weekly / monthly report the boss gets (the business and the team).
      { href: "/staff/reports/staff", label: msg("Weekly & monthly"), icon: "CalendarRange", anyOf: ["reports.view", "shifts.manage"] },
    ],
  },
  {
    title: msg("Settings"), icon: "Settings",
    items: [
      { href: "/staff/settings/control", label: msg("Control centre"), icon: "ShieldCheck", anyOf: ["settings.manage", "users.manage", "inventory.manage"] },
      { href: "/staff/website", label: msg("Website"), icon: "Globe", anyOf: ["website.manage"] },
      { href: "/staff/messages", label: msg("Messages"), icon: "MessageSquareText", anyOf: ["contact.view"] },
      { href: "/staff/settings", label: msg("Hotel"), icon: "Hotel", anyOf: ["settings.manage"] },
      { href: "/staff/settings/pricing", label: msg("Room pricing"), icon: "Tags", anyOf: ["pricing.manage"] },
      { href: "/staff/settings/expenses", label: msg("Expense types"), icon: "Layers", anyOf: ["settings.manage"] },
      // Which languages guests are offered, and how much of the hotel's text is in Chinese.
      { href: "/staff/settings/languages", label: msg("Languages"), icon: "Languages", anyOf: ["settings.manage"] },
      { href: "/staff/guests", label: msg("Customers"), icon: "Contact", anyOf: ["reservations.view"] },
    ],
  },
];

/**
 * THE DEVELOPER'S OWN WORLD (owner, 2026-10-17): while a Developer is signed in as itself, its menu is this section and nothing else —
 * the hotel is seen through Business (read-only) or by pressing "Work as" on the Access page. It needs the Developer-only right, which
 * no business role (not even the Boss or the MD) can hold. The Boss and the MD keep "Audit trail" (People) in the normal menu.
 */
export const DEVELOPER_CONSOLE: NavSection = {
  title: msg("Developer console"), icon: "Layers", ordered: true, titled: true,
  items: [
    { href: "/staff/developer", label: msg("Home"), icon: "LayoutGrid", anyOf: ["developer.access"] },
    { href: "/staff/developer/audit", label: msg("Audit"), icon: "ScrollText", anyOf: ["developer.access"] },
    { href: "/staff/developer/business", label: msg("Business"), icon: "BarChart3", anyOf: ["developer.access"] },
    { href: "/staff/developer/access", label: msg("Access"), icon: "ShieldCheck", anyOf: ["developer.access"] },
  ],
};

/** The console's menu for someone who holds the Developer-only right (nothing for anyone else). */
export function developerConsoleNav(permissions: ReadonlySet<string>): NavSection[] {
  return DEVELOPER_CONSOLE.items.some((i) => i.anyOf.some((p) => permissions.has(p))) ? [DEVELOPER_CONSOLE] : [];
}

/**
 * The menu for the person looking at the page. A Developer signed in as itself sees its console only; a Developer WORKING AS someone
 * (user.workAs set) sees that person's own menu, computed from the rights it was given for it (which never include the Developer-only
 * right); everyone else sees the usual menu for their rights.
 */
export function navFor(user: { actorType: "DEVELOPER" | "STAFF"; workAs?: unknown; permissions: ReadonlySet<string> }, opts: { badges?: Record<string, number>; home?: string } = {}): NavSection[] {
  if (user.actorType === "DEVELOPER" && !user.workAs) return developerConsoleNav(user.permissions);
  return visibleNav(user.permissions, opts);
}

/** Pinned items keep their listed order; everything else comes after. */
const pinOrder = (i: NavItem) => (i.pinned ? NAV.flatMap((s) => s.items).findIndex((x) => x.href === i.href && x.label === i.label) : Number.MAX_SAFE_INTEGER);

export function visibleNav(permissions: ReadonlySet<string>, opts: { badges?: Record<string, number>; home?: string } = {}): NavSection[] {
  return NAV.map((s) => ({
    ...s,
    items: s.items
      .filter((i) => i.href !== opts.home)
      .filter((i) => (i.anyOf.length === 0 || i.anyOf.some((p) => permissions.has(p))) && (!i.allOf || i.allOf.every((p) => permissions.has(p))) && !i.hideIf?.some((p) => permissions.has(p)))
      .map((i) => (opts.badges?.[i.href] ? { ...i, badge: opts.badges[i.href] } : i))
      // In the order listed (sections marked `ordered`); otherwise pinned first, then shortest name first, so every group steps down neatly.
      .sort((a, b) => (s.ordered ? 0 : a.pinned || b.pinned ? pinOrder(a) - pinOrder(b) : a.label.length - b.label.length || a.label.localeCompare(b.label))),
  })).filter((s) => s.items.length > 0);
}
