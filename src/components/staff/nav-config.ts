import type { PermissionCode } from "@/lib/permissions";

export interface NavItem {
  href: string;
  label: string;
  icon: string; // lucide icon name, resolved in StaffNav
  anyOf: PermissionCode[];
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
}

/**
 * Staff navigation, grouped the way the hotel works. Only routes that exist
 * are listed. The signed-in user's own dashboard is shown separately as
 * "Home", so it is filtered out of these groups.
 */
export const NAV: NavSection[] = [
  {
    // Right below Home: the money comes first for managers and the MD.
    title: "Finance", icon: "ReceiptText", ordered: true,
    // The owner's order: (the overview), income, expenses, then the accounts — small to big after that.
    items: [
      { href: "/staff/finance", label: "Overview", icon: "Wallet", anyOf: ["finance.view"] },
      // Income and Expenses are managers' and the MD's; reception sees what it collected in Collections (owner, 2026-10-04).
      { href: "/staff/payments", label: "Income", icon: "Banknote", anyOf: ["reports.view", "finance.view"] },
      { href: "/staff/expenses", label: "Expenses", icon: "Receipt", anyOf: ["expenses.record", "expenses.view_all"] },
      // The money each person collected from customers — their own ("My collections"); managers pick anyone.
      { href: "/staff/collections", label: "Collections", icon: "Coins", anyOf: ["revenue.record", "payments.record", "dashboard.manager", "dashboard.owner", "dashboard.admin"] },
      { href: "/staff/finance/accounts", label: "Accounts", icon: "Landmark", anyOf: ["ledger.view", "finance.view"] },
      // Invoices are not in the sidebar (the owner's choice) — they open from a booking, a group or a company.
      { href: "/staff/corporate", label: "Companies", icon: "Building2", anyOf: ["corporate.view"] },
      { href: "/staff/finance/receivables", label: "Who owes us", icon: "HandCoins", anyOf: ["finance.view"] },
      // nTZS — the hotel's one online payment: status, on/off per service, every attempt, reconciliation.
      { href: "/staff/finance/online", label: "Online payments", icon: "Smartphone", anyOf: ["finance.view"] },
      { href: "/staff/finance/history", label: "Edit history", icon: "History", anyOf: ["finance.view"] },
      { href: "/staff/finance/ledger", label: "General ledger", icon: "ArrowLeftRight", anyOf: ["ledger.view", "finance.view"] },
    ],
  },
  {
    title: "Front office", icon: "ConciergeBell",
    items: [
      // Reception's own page; managers and the MD get its rooms and guests owing on their home instead.
      { href: "/reception/dashboard", label: "Front desk", icon: "LayoutDashboard", anyOf: ["dashboard.front_desk"], hideIf: ["dashboard.manager", "dashboard.owner", "dashboard.admin"] },
      // Reception's job: managers and the MD follow check-ins and check-outs on their home, they don't do them.
      { href: "/staff/check-in", label: "Check-in", icon: "DoorOpen", anyOf: ["reservations.check_in"], hideIf: ["dashboard.manager", "dashboard.owner", "dashboard.admin"] },
      { href: "/staff/check-out", label: "Check-out", icon: "DoorClosed", anyOf: ["reservations.check_out"], hideIf: ["dashboard.manager", "dashboard.owner", "dashboard.admin"] },
      { href: "/staff/driver", label: "My trips", icon: "Car", anyOf: ["transport.driver"], hideIf: ["reservations.view"] },
    ],
  },
  {
    title: "Bookings", icon: "CalendarDays",
    // One short word each, small to big: book a stay, all the stays, bookings from the website, the room calendar.
    items: [
      // Reception books; managers and the MD follow the bookings (Stays, Online, Calendar).
      { href: "/staff/reservations/new", label: "Book", icon: "CalendarPlus", anyOf: ["reservations.create"], hideIf: ["dashboard.manager", "dashboard.owner", "dashboard.admin"] },
      { href: "/staff/reservations", label: "Stays", icon: "CalendarCheck", anyOf: ["reservations.view"] },
      { href: "/staff/booking-requests", label: "Online", icon: "Inbox", anyOf: ["booking_requests.view"] },
      { href: "/staff/reservations/calendar", label: "Calendar", icon: "CalendarRange", anyOf: ["reservations.view"] },
    ],
  },
  {
    title: "Hotel services", icon: "BedDouble",
    items: [
      { href: "/staff/rooms", label: "Rooms", icon: "BedDouble", anyOf: ["rooms.view"] },
      { href: "/staff/requests", label: "Requests", icon: "ClipboardCheck", anyOf: ["requests.view"] },
      { href: "/staff/transport", label: "Transport", icon: "BusFront", anyOf: ["transport.view", "transport.manage"] },
      { href: "/staff/meeting-room", label: "Meetings", icon: "Presentation", anyOf: ["meeting.view"] },
    ],
  },
  {
    // Everything restaurant together: the orders (the portal), taking an order, the tables and the menu.
    title: "Restaurant & Bar", icon: "UtensilsCrossed", ordered: true,
    // The owner's order: the live orders, a new order, the tables, (the menu), history, bookings —
    // short, simple names that step up from small to big: Live · Sell · Tables · History · Bookings.
    items: [
      // Their own payments view (information only — the Counter records the money). A waiter's history is for
      // managers and the MD (Waiters page), not on the waiter's phone (owner, 2026-10-04).
      { href: "/staff/restaurant/waiter/payments", label: "Collections", icon: "HandCoins", anyOf: ["restaurant.shift"], hideIf: ["dashboard.manager", "dashboard.owner", "dashboard.admin", "restaurant.device"] },
      // The waiter's own shifts, each with the report made when it ended.
      { href: "/staff/shifts/all", label: "My shifts", icon: "Clock", anyOf: ["restaurant.shift"], hideIf: ["dashboard.manager", "dashboard.owner", "dashboard.admin", "restaurant.device", "shifts.manage"] },
      // Their own shift, weekly and monthly reports.
      { href: "/staff/reports/staff", label: "My reports", icon: "FileText", anyOf: ["restaurant.shift"], hideIf: ["dashboard.manager", "dashboard.owner", "dashboard.admin", "restaurant.device", "shifts.manage", "reports.view"] },
      { href: "/staff/restaurant", label: "Live", icon: "ReceiptText", anyOf: ["restaurant.orders", "restaurant.menu", "kitchen.orders", "restaurant.serve"] },
      // Waiters and reception take orders; managers and the MD watch the restaurant (Live, Tables, History).
      { href: "/staff/restaurant/pos", label: "Sell", icon: "CirclePlus", anyOf: ["restaurant.orders", "kitchen.orders"], hideIf: ["dashboard.manager", "dashboard.owner", "dashboard.admin"] },
      { href: "/staff/restaurant/tables", label: "Tables", icon: "Armchair", anyOf: ["restaurant.orders", "restaurant.serve", "kitchen.orders", "restaurant.menu"] },
      { href: "/staff/restaurant/menu", label: "Menu", icon: "BookOpenText", anyOf: ["restaurant.menu"] },
      // "Menu · sold out" (/staff/restaurant/availability) is off the menu for now — the owner does not need it.
      // Asking for stock moved to Stores → Stock requests (every department asks there).
      { href: "/staff/restaurant/history", label: "History", icon: "History", anyOf: ["restaurant.orders", "kitchen.orders", "restaurant.menu"] },
      // What every waiter served and which table or room each one served — for managers, the MD and the owner.
      { href: "/staff/restaurant/waiters", label: "Waiters", icon: "Users", anyOf: ["dashboard.manager", "dashboard.owner", "dashboard.admin"] },
      { href: "/staff/restaurant/reservations", label: "Reservations", icon: "CalendarClock", anyOf: ["restaurant.orders", "restaurant.serve"] },
      // Waiters see customers here (their one section); reception and managers find them in Settings.
      { href: "/staff/guests", label: "Customers", icon: "Contact", anyOf: ["guests.view"], hideIf: ["reservations.view"] },
    ],
  },
  {
    // Consumable stock (every department), asking for it and buying it, and the hotel's assets — kept apart.
    title: "Stores", icon: "Boxes", ordered: true,
    items: [
      { href: "/staff/inventory", label: "Inventory", icon: "Boxes", anyOf: ["inventory.view"] },
      // Ask → review → buy → final approval: the kitchen, waiters and reception ask; managers review, buy and approve.
      { href: "/staff/stock-requests", label: "Stock requests", icon: "ClipboardList", anyOf: ["inventory.request", "expenses.approve", "inventory.receive"] },
      { href: "/staff/assets", label: "Assets", icon: "Sofa", anyOf: ["assets.view"] },
    ],
  },
  {
    title: "People", icon: "Users",
    items: [
      { href: "/staff/shifts", label: "Shifts", icon: "Clock", anyOf: ["shifts.view"] },
      // The person's own shift (the one running now, or the last) — one tap from anywhere.
      { href: "/staff/shifts/me", label: "My shift", icon: "History", anyOf: ["shifts.work"], hideIf: ["shifts.manage", "dashboard.manager", "dashboard.owner", "dashboard.admin"] },
      // Their own shift, weekly and monthly reports.
      { href: "/staff/reports/staff", label: "My reports", icon: "FileText", anyOf: ["shifts.work"], hideIf: ["shifts.manage", "reports.view", "dashboard.manager", "dashboard.owner", "dashboard.admin"] },
      // Everyone's shifts (waiters and reception) with the report made when each ended — managers, the MD and the owner.
      { href: "/staff/shifts/all", label: "Staff shifts", icon: "History", anyOf: ["shifts.manage"] },
      { href: "/staff/activity", label: "Activity", icon: "Activity", anyOf: ["staff.activity.view"] },
      { href: "/staff/users", label: "Staff & roles", icon: "UserCog", anyOf: ["users.manage"] },
    ],
  },
  {
    title: "Insights", icon: "TrendingUp",
    items: [
      { href: "/admin/dashboard", label: "Overview", icon: "BarChart3", anyOf: ["dashboard.admin"] },
      { href: "/manager/dashboard", label: "Overview", icon: "BarChart3", anyOf: ["dashboard.manager", "dashboard.owner"], hideIf: ["dashboard.admin"] },
      { href: "/staff/reports", label: "Reports", icon: "FileChartColumn", anyOf: ["reports.view"] },
      { href: "/staff/reports/daily", label: "Daily reports", icon: "NotebookText", anyOf: ["reports.view"] },
      // Every shift's report, and the weekly / monthly report the boss gets (the business and the team).
      { href: "/staff/reports/staff", label: "Weekly & monthly", icon: "CalendarRange", anyOf: ["reports.view", "shifts.manage"] },
    ],
  },
  {
    title: "Settings", icon: "Settings",
    items: [
      { href: "/staff/settings/control", label: "Control centre", icon: "ShieldCheck", anyOf: ["settings.manage", "users.manage", "inventory.manage"] },
      { href: "/staff/website", label: "Website", icon: "Globe", anyOf: ["website.manage"] },
      { href: "/staff/messages", label: "Messages", icon: "MessageSquareText", anyOf: ["contact.view"] },
      { href: "/staff/settings", label: "Hotel", icon: "Hotel", anyOf: ["settings.manage"] },
      { href: "/staff/settings/pricing", label: "Room pricing", icon: "Tags", anyOf: ["pricing.manage"] },
      { href: "/staff/settings/expenses", label: "Expense types", icon: "Layers", anyOf: ["settings.manage"] },
      { href: "/staff/guests", label: "Customers", icon: "Contact", anyOf: ["reservations.view"] },
    ],
  },
];

/** Pinned items keep their listed order; everything else comes after. */
const pinOrder = (i: NavItem) => (i.pinned ? NAV.flatMap((s) => s.items).findIndex((x) => x.href === i.href && x.label === i.label) : Number.MAX_SAFE_INTEGER);

export function visibleNav(permissions: ReadonlySet<string>, opts: { badges?: Record<string, number>; home?: string } = {}): NavSection[] {
  return NAV.map((s) => ({
    ...s,
    items: s.items
      .filter((i) => i.href !== opts.home)
      .filter((i) => (i.anyOf.length === 0 || i.anyOf.some((p) => permissions.has(p))) && !i.hideIf?.some((p) => permissions.has(p)))
      .map((i) => (opts.badges?.[i.href] ? { ...i, badge: opts.badges[i.href] } : i))
      // In the order listed (sections marked `ordered`); otherwise pinned first, then shortest name first, so every group steps down neatly.
      .sort((a, b) => (s.ordered ? 0 : a.pinned || b.pinned ? pinOrder(a) - pinOrder(b) : a.label.length - b.label.length || a.label.localeCompare(b.label))),
  })).filter((s) => s.items.length > 0);
}
