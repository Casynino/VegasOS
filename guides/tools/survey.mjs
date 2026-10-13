// A first look at every screen of every role (plain pictures and the words on them) — used to plan the books.
const REC = "neema@vegas.test", WTR = "baraka@vegas.test", CTR = "counter@vegas.test", CHEF = "chef@vegas.test", MGR = "manager@vegas.test", MD = "admin@vegas.test", BOSS = "owner@vegas.test";
const many = (prefix, as, view, urls) => urls.map((u) => ({ id: `s-${prefix}-${u.replace(/^\/(staff|en)\/?/, "").replace(/[^a-z0-9]+/gi, "-").replace(/^-|-$/g, "") || "home"}`, as, url: u, view, chars: 5000 }));

export const SHOTS = [
  { id: "s-rec-00-start", as: REC, url: "/reception/dashboard", chars: 5000 },
  ...many("rec", REC, "desk", ["/staff/check-in", "/staff/check-out", "/staff/reservations/new", "/staff/reservations", "/staff/booking-requests", "/staff/reservations/calendar", "/staff/hotel-qr", "/staff/corporate",
    "/staff/rooms", "/staff/meeting-room", "/staff/requests", "/staff/transport", "/staff/lists", "/staff/collections", "/staff/shifts", "/staff/shifts/me", "/staff/reports/staff", "/staff/messages", "/staff/guests",
    "/staff/restaurant", "/staff/restaurant/pos", "/staff/restaurant/tables", "/staff/restaurant/history", "/staff/restaurant/reservations"]),
  ...many("wtr", WTR, "phone", ["/staff/restaurant", "/staff/restaurant/pos", "/staff/restaurant/tables", "/staff/restaurant/history", "/staff/restaurant/waiter/payments", "/staff/shifts/all", "/staff/shifts/me", "/staff/reports/staff", "/staff/guests"]),
  ...many("ctr", CTR, "tablet", ["/staff/restaurant", "/staff/restaurant/pos", "/staff/restaurant/tables", "/staff/restaurant/history", "/staff/restaurant/reservations", "/staff/collections", "/staff/guests"]),
  ...many("chef", CHEF, "tablet", ["/staff/restaurant", "/staff/restaurant/pos", "/staff/restaurant/tables", "/staff/restaurant/history", "/staff/inventory", "/staff/stock-requests"]),
  ...many("mgr", MGR, "desk", ["/manager/dashboard", "/staff/finance", "/staff/payments", "/staff/expenses", "/staff/collections", "/staff/finance/accounts", "/staff/corporate", "/staff/finance/receivables", "/staff/finance/online",
    "/staff/finance/history", "/staff/finance/ledger", "/staff/spin-to-win", "/staff/restaurant/waiters", "/staff/inventory", "/staff/stock-requests", "/staff/assets", "/staff/shifts", "/staff/activity", "/staff/shifts/all",
    "/staff/reports", "/staff/reports/daily", "/staff/reports/staff", "/staff/messages"]),
  ...many("boss", BOSS, "desk", ["/admin/dashboard", "/staff/finance/withdraw", "/staff/restaurant/menu", "/staff/users", "/staff/settings", "/staff/website", "/staff/settings/languages", "/staff/settings/pricing", "/staff/settings/expenses", "/staff/settings/control"]),
  ...many("web", undefined, "phone", ["/en", "/en/rooms", "/en/book", "/en/menu", "/en/restaurant", "/en/bar", "/en/gallery", "/en/hotel", "/en/meeting-room", "/en/transport", "/en/contact"]),
];
