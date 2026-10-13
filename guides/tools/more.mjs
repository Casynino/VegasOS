// Numbered overview pictures for the department books (pages that only show — nothing is pressed or saved).
const L = { at: "l" };
const JUMA = "juma@vegas.test";
const W = "/staff/restaurant";
const P = (id, as, spec) => ({ id, as, view: "phone", ...spec });
const T = (id, as, spec) => ({ id, as, view: "tablet", ...spec });
const CTR = "counter@vegas.test";
const CHEF = "chef@vegas.test";
const ASHA = "asha@vegas.test";
const DRV = "driver@vegas.test";
export const SHOTS = [
  P("w-home-n", JUMA, { url: W, marks: [[1, "Restaurant QR"], [2, "On shift"], [3, "NEW ORDERS", L], [4, "READY", L], [5, "No waiter yet", L], [6, "Menu"]] }),
  P("w-orders-n", JUMA, { url: W, h: 1500, scroll: "YOUR ORDERS", clip: ["YOUR ORDERS", "Transfer"], pad: 36, marks: [[1, "All orders", L], [2, "Unpaid"], [3, "Ready to serve", L], [4, "Table 4 — Outside", L], [5, "Unpaid · TZS 25,000", L], [6, "Transfer"]] }),
  P("w-tables-n", JUMA, { url: W + "/tables", h: 1000, marks: [[1, "Reserve a table"], [2, "Reservations"], [3, "Restaurant QR"], [4, "Print QR cards"], [5, "Waiter · Juma", L], [6, "No waiter yet", L]] }),
  P("w-pay-n", JUMA, { url: W + "/waiter/payments", h: 1008, marks: [[1, "THIS SHIFT", L], [2, "With you"], [3, "YOUR ORDERS' VALUE", L], [4, "At the Counter", L], [5, "Still to pay", L], [6, "Not paid yet"]] }),
  // Restaurant Counter (tablet)
  T("c-home-n", CTR, { url: W, h: 1060, marks: [[1, "Restaurant QR"], [2, "COLLECTED TODAY", L], [3, "STILL TO COLLECT", L], [4, "ON ROOM BILLS", L], [5, "WAITERS ON SHIFT", L], [6, "NEW ORDERS", L], [7, "READY", L]] }),
  T("c-card-n", CTR, { url: W, h: 1060, scroll: "ALL ORDERS", marks: [[1, "All orders", L], [2, "Unpaid"], [3, "Take payment", L], [4, "Accept", L], [5, "Decline"], [6, "Assign waiter"], [7, "Tick the items", L]] }),
  T("c-sell-n", CTR, { url: W + "/pos", h: 1060, marks: [[1, "Open orders", L], [2, "Full board"], [3, "Search the menu", L], [4, "Breakfast"], [5, "Dine in"], [6, "Phone (required)"], [7, "WAITER", L]] }),
  T("c-sell-2", CTR, { url: W + "/pos", h: 1500, steps: [{ click: "Chapati & Eggs" }, { click: "Tea/Coffee" }], marks: [[1, "WAITER", L], [2, "ORDER DETAILS", L], [3, "Note for the kitchen", L], [4, "PAYMENT", L], [5, "Send to kitchen"]] }),
  T("c-tables-n", CTR, { url: W + "/tables", h: 1060, marks: [[1, "To collect"], [2, "Reserve a table"], [3, "Reservations"], [4, "Print QR cards"]] }),
  T("c-coll-n", CTR, { url: "/staff/collections", h: 1060, marks: [[1, "Today"], [2, "THE RESTAURANT COLLECTED", L], [3, "PAID BY PHONE", L], [4, "STILL TO COLLECT", L], [5, "ON ROOM BILLS", L], [6, "REVERSED", L]] }),
  T("c-history-n", CTR, { url: W + "/history", h: 900, marks: [[1, "Today"], [2, "Done"], [3, "SALES (DONE)", L]] }),
  T("c-resv-n", CTR, { url: W + "/reservations", h: 900, marks: [[1, "New reservation"], [2, "COMING", L], [3, "7 days"]] }),
  T("c-cust-n", CTR, { url: "/staff/guests", h: 900, marks: [[1, "Find a customer", L], [2, "At a table now"], [3, "Restaurant"]] }),
  // Kitchen (tablet)
  T("k-inv-n", CHEF, { url: "/staff/inventory", h: 1060, marks: [[1, "Ask for stock"], [2, "Kitchen"], [3, "Stock"], [4, "Movements"], [5, "Waste"], [6, "Low stock"]] }),
  T("k-stockreq-n", CHEF, { url: "/staff/stock-requests", h: 1060, marks: [[1, "New request"], [2, "Kitchen"], [3, "Meat & fish", L]] }),
  T("k-history-n", CHEF, { url: W + "/history", h: 900, marks: [[1, "Today"], [2, "Done"], [3, "Cancelled & declined"]] }),
  T("k-waste-n", CHEF, { url: "/staff/inventory", h: 1060, steps: [{ click: "Waste Chicken" }], marks: [[1, "Wasted", L], [2, "Spoiled"], [3, "What happened", L], [4, "Send to the manager"]] }),
  T("k-req-2", CHEF, { url: "/staff/stock-requests", h: 1190, steps: [{ click: "Whole chicken" }, { click: "Fish fillet" }], marks: [[1, "Whole chicken", L], [2, "Your list", L], [3, "Urgent", L], [4, "Check the list"]] }),
  T("k-req-3", CHEF, { url: "/staff/stock-requests", h: 1060, steps: [{ click: "Whole chicken" }, { click: "Fish fillet" }, { click: "Check the list" }], marks: [[1, "Check your list", L], [2, "Change it"], [3, "Send 2 items"]] }),
  // Housekeeping: the checklist on Reception's computer, as it is now
  { id: "h-list", as: ASHA, view: "desk", url: "/staff/lists", full: true, max: 2900 },
  // Driver: the bars of the phone and the open menu (nothing is pressed on a trip)
  P("d-bars", DRV, { url: "/staff/driver", marks: [[1, "EN"], [2, "Home", { at: "t", ring: false }], [3, "Find", { at: "t", ring: false }], [4, "Menu", { at: "t", ring: false }]] }),
  P("d-menu-n", DRV, { url: "/staff/driver", steps: [{ click: "Menu" }], marks: [[5, "Hassan Juma", L], [6, "Sign out"]] }),
  { id: "web-transport-n", view: "desk", url: "/transport", h: 640, marks: [[1, "40,000", L], [2, "Request airport pickup"], [3, "WhatsApp us"]] },
];
