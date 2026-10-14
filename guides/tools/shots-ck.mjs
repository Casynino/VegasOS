// Pictures for the Restaurant Counter book (03) and the Kitchen and Bar book (04): prefix "ck-".
// Nothing here saves anything: pages are only opened, and the one window (Check your list) is only opened, never sent.
// The sizes (h) are the cut-outs the first edition used (a picture 1.5 times as tall as its h in pixels), so no cutting is needed.
const L = { at: "l" };
const R = { at: "r", ring: false };
const W = "/staff/restaurant";
const CTR = "counter@vegas.test";
const CHEF = "chef@vegas.test";
const T = (id, as, spec) => ({ id, as, view: "tablet", ...spec });
const REQ = "/staff/stock-requests";
const fill = (css, value, nth = 1) => `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(css)})][${nth - 1}];if(!e)return;const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`;

// the kitchen's request of the first edition (R2), typed again only to open the "Check your list" window — it is NOT sent
const FORM2 = [
  { click: "Oil, spices & sauces" }, { click: "Cooking oil" },
  { click: "Supplies" }, { click: "Cooking gas" },
  { click: "Kitchen & restaurant equipment" }, { click: "Frying pans" },
  { js: fill('input[aria-label="How many"]', 4, 1) }, { js: fill('input[aria-label="How many"]', 2, 2) }, { js: fill('input[aria-label="How many"]', 20, 3) },
  { js: fill('input[placeholder^="What is it for"]', "Oil and gas are running low for the weekend, two pans burnt") },
  { js: fill('input[aria-label="Estimated cost (TZS)"]', "380000") },
  { js: fill('input[placeholder^="Note for Finance"]', "Gas from the usual supplier please") },
  { wait: 300 },
];

export const SHOTS = [
  // ── Restaurant Counter ──
  T("ck-c-home-a", CTR, { url: W, h: 740, marks: [[1, "Restaurant QR"], [2, "COLLECTED TODAY", L], [3, "STILL TO COLLECT", L], [4, "ON ROOM BILLS", L], [5, "WAITERS ON SHIFT", L], [6, "NEW ORDERS", L], [7, "READY", L]] }),
  T("ck-c-cover", CTR, { url: W, h: 740 }),
  T("ck-c-menu", CTR, { url: W, h: 740, clip: ["Home", "Customers"], pad: 40, marks: [[1, "Home", R], [2, "Sell", R], [3, "Tables", R], [4, "History", R], [5, "Reservations", R], [6, "Purchase requests", R], [7, "Collections", R], [8, "Customers", R]] }),
  T("ck-c-sell-a", CTR, { url: W + "/pos", h: 927, marks: [[1, "Open orders", L], [2, "Full board"], [3, "Search the menu", L], [4, "Breakfast"], [5, "Dine in"], [6, "Phone (required)"], [7, "WAITER", L]] }),
  T("ck-c-tables-a", CTR, { url: W + "/tables", h: 773, marks: [[1, "To collect"], [2, "Reserve a table"], [3, "Reservations"], [4, "Print QR cards"]] }),
  T("ck-c-resv-a", CTR, { url: W + "/reservations", h: 727, marks: [[1, "New reservation"], [2, "COMING", L], [3, "7 days"]] }),
  T("ck-c-coll-a", CTR, { url: "/staff/collections", h: 820, steps: [{ click: "Yesterday" }], marks: [[1, "Today", { up: 1 }], [2, "THE RESTAURANT COLLECTED", L], [3, "PAID BY PHONE", L], [4, "STILL TO COLLECT", L], [5, "ON ROOM BILLS", L], [6, "REVERSED", L]] }),
  T("ck-c-history-a", CTR, { url: W + "/history", h: 587, steps: [{ click: "Yesterday" }], marks: [[1, "Yesterday", { up: 1 }], [2, "Done"], [3, "SALES (DONE)", L]] }),
  T("ck-c-cust-a", CTR, { url: "/staff/guests", h: 767, marks: [[1, "Find a customer", L], [2, "At a table now"], [3, "Restaurant"]] }),

  // ── Kitchen and Bar ──
  T("ck-k-home-a", CHEF, { url: W, h: 847, marks: [[1, "to accept"], [2, "0 of 7 items done"], [3, "Waiting for a waiter"], [4, "completed today"], [5, "YOUR KITCHEN", L]] }),
  T("ck-k-cover", CHEF, { url: W, h: 740 }),
  T("ck-k-menu", CHEF, { url: W, h: 740, clip: ["Home", "Purchase requests"], pad: 40, marks: [[1, "Home", R], [2, "Sell", R], [3, "Tables", R], [4, "History", R], [5, "Inventory", R], [6, "Purchase requests", R]] }),
  T("ck-k-inv-a", CHEF, { url: "/staff/inventory", h: 977, marks: [[1, "Ask for stock"], [2, "Kitchen stock"], [3, "Stock"], [4, "Movements"], [5, "Waste"], [6, "Low stock"]] }),
  T("ck-k-history-a", CHEF, { url: W + "/history", h: 533, steps: [{ click: "Yesterday" }], marks: [[1, "Yesterday", { up: 1 }], [2, "Done"], [3, "Cancelled & declined"]] }),
  T("ck-k-check", CHEF, { url: REQ, h: 1500, steps: [{ click: "New request" }, ...FORM2, { click: "Check the list" }, { wait: 700 }], clip: ["css:[role=dialog]"], pad: 20, marks: [[1, "Print"], [2, "Change it"], [3, "Send 3 items to Finance"]] }),
  T("ck-k-sell", CHEF, { url: W + "/pos" }),
  T("ck-k-tables", CHEF, { url: W + "/tables" }),
];
