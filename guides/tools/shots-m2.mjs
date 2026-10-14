// Manager book (edition 2): the pictures of the Manager's own screens that are new or changed since the first edition.
// Prefix "m2-n-" (the older "m2-" pictures belong to mgr.mjs and are not touched). Nothing here saves anything: every picture only opens a
// page or a window.
//   node guides/tools/shoot.mjs --list=shots-m2 m2-n-an
const M = "manager@vegas.test";
const D = (id, spec) => ({ id, as: M, view: "desk", ...spec });
const L = { at: "l" };
const T = { at: "t" };
const R = { at: "r" };
const ALL = { full: true, max: 12000, steps: [{ wait: 3000 }] }; // the whole page, and time for the parts that load by themselves

export const SHOTS = [
  // ── the cover and the home ──
  D("m2-n-cover", { url: "/manager/dashboard" }),
  D("m2-n-home", { url: "/manager/dashboard", h: 1000, marks: [[1, 'css:nav[aria-label="Jump to"]'], [2, "css:#attention h2", L], [3, "Money"], [4, "Room 107 — checkout overdue", L], [5, "Scroll for", L], [6, "css:#rooms h2", L]] }),
  // the menu in two halves (it is longer than a screen)
  D("m2-n-menu-a", { url: "/manager/dashboard", full: true, max: 3000, clip: ["Home", "Hotel QR"], pad: 16 }),
  D("m2-n-menu-b", { url: "/manager/dashboard", full: true, max: 3000, clip: ["HOTEL SERVICES", "Customers"], pad: 16 }),

  // ── The money, analysed (the Manager's home, under the Occupancy chart) ──
  D("m2-n-an-1", { url: "/manager/dashboard", ...ALL, clip: ["css:#analysis", "css:#stands-out"], pad: 14, marks: [[1, "css:#analysis"], [2, "What stands out", L], [3, "more than a week late", L]] }),
  D("m2-n-an-2", { url: "/manager/dashboard", ...ALL, clip: ["css:#accounts", "css:#accounts + div > a"], pad: 14, marks: [[1, "css:#accounts + div > a svg", { self: true, pad: 8 }], [2, "BY KIND OF ACCOUNT", { at: "l", self: true }], [3, "Lipa M-Pesa", { at: "l", self: true }]] }),
  D("m2-n-an-2b", { url: "/manager/dashboard", ...ALL, clip: ["css:#accounts + div > div > p", "css:#accounts + div > div > ul > li##2"], pad: 14, marks: [[1, "css:#accounts + div > div > ul > li##1", { self: true, pad: 3 }], [2, "nothing moved today", { self: true, at: "l" }]] }),
  D("m2-n-an-3", { url: "/manager/dashboard", ...ALL, clip: ["css:#outlook", "css:#outlook ~ div##2"], pad: 14, marks: [[1, "In the accounts"], [2, "Owed to the hotel"], [3, "Days the money lasts"], [4, "Who owes the hotel — how late", L]] }),
  D("m2-n-an-3b", { url: "/manager/dashboard", ...ALL, clip: ["css:#outlook ~ div##3"], pad: 14, marks: [[1, "Spent a day, on average", L], [2, "Expenses waiting for approval", L], [3, "Rooms booked ahead", L]] }),
  D("m2-n-an-4", { url: "/manager/dashboard", ...ALL, clip: ["css:#trends", "css:#trends + section"], pad: 14, marks: [[1, "The key figures", L], [2, "Occupancy##2"], [3, "vs previous period"], [4, "Income per available room"], [5, "Spent of what was earned"], [6, "Cash of the money received"]] }),
  D("m2-n-an-5", { url: "/manager/dashboard", ...ALL, clip: ["css:#trends ~ div > section##1"], pad: 14, marks: [[1, "The last six months", L], [2, "Received"], [3, "MONTH", L]] }),
  D("m2-n-an-6", { url: "/manager/dashboard", ...ALL, clip: ["css:#trends ~ div > div > section##2", "css:#trends ~ div > section##2"], pad: 14, marks: [[1, "Which days earn most", L], [2, "BEST DAY", { at: "t" }], [3, "Income against the period before", L], [4, "CHANGE"]] }),

  // ── Purchase requests (the Manager reviews; Purchasing and Finance do the rest) ──
  D("m2-n-req-queue", { url: "/staff/stock-requests", h: 1000, marks: [[1, "To review", T], [2, "To buy", T], [3, "Being bought", T], [4, "To approve", T], [5, "Spent on stock", L], [6, "Shopping list", L], [7, "SR-2026-0004", L]] }),
  D("m2-n-req-review", { url: "/staff/stock-requests", h: 1500, steps: [{ click: "SR-2026-0004" }, { wait: 700 }], clip: "css:[role=dialog]", pad: 20, marks: [[1, "Approved budget (TZS)"], [2, "Approve for purchase"], [3, "Change"], [4, "Send back"], [5, "Reject"]] }),
  D("m2-n-req-follow", { url: "/staff/stock-requests", h: 1700, steps: [{ click: "SR-2026-0006" }, { wait: 700 }], clip: "css:[role=dialog]", pad: 20, marks: [[1, "Delivered — invoice and payment to finish", R], [2, "Budget approved by Finance", R], [3, "The order", L], [4, "History", L]] }),

  // ── pages that changed their name or what they show ──
  D("m2-n-greq", { url: "/staff/requests", marks: [[1, "Log a request"], [2, "Waiting for someone to accept", L], [3, "css:select", L], [4, "Done today", L]] }),
  D("m2-n-exp", { url: "/staff/expenses", h: 1480, clip: ["Overview", "Record expense", "Stock purchase P-2026-0001"], pad: 14, marks: [[1, "Record expense"], [2, "Waiting approval"], [3, "Approve"], [4, "Reject"], [5, "Supplier payment", { at: "l", dx: -46 }]] }),
  D("m2-n-acc", { url: "/staff/finance/accounts", h: 1250, steps: [{ click: "CRDB Bank" }, { wait: 900 }], clip: ["Overview", "Edit history", "Supplier payment · UHU-0387"], pad: 14, below: 24, marks: [[1, "IN THE BOOKS", L], [2, "Record expense"], [3, "Received today", L], [4, "Supplier payment", L]] }),
  D("m2-n-acc-cash", { url: "/staff/finance/accounts", h: 760, steps: [{ click: "Cash" }, { wait: 900 }], clip: ["Overview", "Edit history", "Transactions (all time)"], pad: 14, below: 50, marks: [[1, "Record expense"], [2, "Count"]] }),
  // an approved request, opened: the direct route
  D("m2-n-req-approved", { url: "/staff/stock-requests", h: 1500, steps: [{ click: "SR-2026-0005" }, { wait: 700 }], clip: "css:[role=dialog]", pad: 20, marks: [[1, "Record the purchase"], [2, "Change"], [3, "Reject"]] }),
  // a finished request: the list of what is Finished
  D("m2-n-req-done", { url: "/staff/stock-requests", h: 1500, full: true, max: 3000, clip: ["FINISHED", "SR-2026-0001"], pad: 14, below: 30 }),
];
