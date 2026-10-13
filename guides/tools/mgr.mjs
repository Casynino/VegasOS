// Manager book: pictures of the manager's own screens.
const M = "manager@vegas.test";
const D = (id, spec) => ({ id, as: M, view: "desk", ...spec });
const L = { at: "l" };
const T = (id, spec) => ({ id, as: "chef@vegas.test", view: "tablet", ...spec });
// chooses a line in a plain drop-down list the way a person would (the page hears the change)
const pick = (words) => `(()=>{const s=[...document.querySelectorAll('select')].find(x=>[...x.options].some(o=>o.text.includes(${JSON.stringify(words)})));if(!s)return;const o=[...s.options].find(o=>o.text.includes(${JSON.stringify(words)}));const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,o.value);s.dispatchEvent(new Event('change',{bubbles:true}));})()`;
const day = (v) => `(()=>{const i=document.querySelector('input[type="date"]');const set=Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set;set.call(i,${JSON.stringify(v)});i.dispatchEvent(new Event('input',{bubbles:true}));i.dispatchEvent(new Event('change',{bubbles:true}));})()`;
const PRICE = 'css:input[inputmode="numeric"]:not([id^="total-"])';
const BUY = [{ click: "SR-2026-0001" }, { click: "Record the purchase" }, { type: "16000", into: PRICE }, { type: "9000", into: PRICE + "##2" }, { js: day("2026-10-19") }, { js: pick("Kariakoo Fresh") }, { wait: 300 }, { click: "There is no receipt" }, { type: "Market seller gives no receipts", into: "No receipt because" }, { js: pick("CRDB") }, { wait: 500 }];
export const SHOTS = [
  // a first look (nothing is pressed that saves)
  D("m2-home-full", { url: "/manager/dashboard", full: true, max: 3600 }),
  D("m2-room-free", { url: "/staff/rooms", steps: [{ click: "206" }] }),
  D("m2-room-occ", { url: "/staff/rooms", steps: [{ click: "202" }] }),
  D("m2-trn", { url: "/staff/transport" }),
  D("m2-shifts-full", { url: "/staff/shifts", full: true, max: 3600 }),
  D("m2-inv-stock", { url: "/staff/inventory", steps: [{ click: "Stock" }] }),
  D("m2-inv-waste", { url: "/staff/inventory", steps: [{ click: "Waste" }] }),
  D("m2-inv-count", { url: "/staff/inventory", steps: [{ click: "Count" }] }),
  D("m2-inv-recv", { url: "/staff/inventory", steps: [{ click: "Receive stock" }] }),
  D("m2-exp-reject", { url: "/staff/expenses", steps: [{ click: "Reject" }] }),
  D("m2-stays", { url: "/staff/reservations" }),
  D("m2-online", { url: "/staff/booking-requests" }),
  D("m2-msgs", { url: "/staff/messages" }),
  D("m2-meet", { url: "/staff/meeting-room" }),
  D("m2-shift1", { url: "/staff/shifts/cmv58ou6d0000eksbb2fng3tp", full: true, max: 3600 }),
  D("m2-stockreq-new", { url: "/staff/stock-requests", steps: [{ click: "New request" }] }),
  // a first look at the dialogs (opened only — nothing is saved)
  D("m3-room-close", { url: "/staff/rooms", steps: [{ click: "206" }, { click: "Close room", optional: true }] }),
  D("m3-room-move", { url: "/staff/rooms", steps: [{ click: "202" }, { click: "Move guest", optional: true }] }),
  D("m3-room-disc", { url: "/staff/rooms", steps: [{ click: "202" }, { click: "Discount", optional: true }] }),
  D("m3-room-nights", { url: "/staff/rooms", steps: [{ click: "202" }, { click: "Free nights", optional: true }] }),
  D("m3-room-waiter", { url: "/staff/rooms", steps: [{ click: "202" }, { click: "Room service waiter", optional: true }] }),
  D("m3-room-overdue", { url: "/staff/rooms", steps: [{ click: "107" }] }),
  D("m3-room-clean", { url: "/staff/rooms", steps: [{ click: "105" }] }),
  D("m3-inv-recv2", { url: "/staff/inventory", steps: [{ click: "Receive stock" }, { click: "Rice", optional: true }] }),
  D("m3-shift-open", { url: "/staff/shifts", steps: [{ click: "Shift", optional: true }], full: true, max: 3000 }),
  D("m3-trn-prices", { url: "/staff/transport", steps: [{ click: "Report & prices", optional: true }], full: true, max: 3600 }),
  D("m3-trn-open", { url: "/staff/transport", steps: [{ click: "TRN-2026-00002", optional: true }] }),
  D("m3-dailyrep", { url: "/staff/reports/daily/cmv5d2ztt008jeksb7vb3a8xj" }),
  D("m3-cal", { url: "/staff/reservations/calendar" }),
  D("m3-cust", { url: "/staff/guests" }),
  D("m3-spin", { url: "/staff/spin-to-win" }),
  D("m3-hotelqr", { url: "/staff/hotel-qr" }),
  D("m3-lists", { url: "/staff/lists" }),
  D("m3-req-give", { url: "/staff/requests", steps: [{ click: "Give it to…", optional: true }] }),
  D("m3-exp-open", { url: "/staff/expenses", steps: [{ click: "EXP-2026-000011", optional: true }] }),
  D("m3-rest-tables", { url: "/staff/restaurant/tables" }),
  D("m3-rest-history", { url: "/staff/restaurant/history" }),
  D("m3-stay-open", { url: "/staff/reservations", steps: [{ click: "Rose Kimaro", optional: true }] }),
  // ── numbered pictures for the book (opened only — nothing is saved) ──
  D("m4-home", { url: "/manager/dashboard", h: 1000, marks: [[1, "NEEDS YOUR ATTENTION", L], [2, "Money"], [3, "Room 107 — checkout overdue", L], [4, "Scroll for", L], [5, "ROOMS TODAY", L], [6, "MONEY TODAY", L]] }),
  D("m4-cover", { url: "/manager/dashboard" }),
  D("m4-rooms", { url: "/staff/rooms", marks: [[1, "Needs cleaning"], [2, "overdue checkouts"], [3, "202", L], [4, "Room QR codes"]] }),
  D("m4-room-occ", { url: "/staff/rooms", steps: [{ click: "202" }], marks: [[1, "Move guest"], [2, "Free nights"], [3, "Discount"], [4, "Close room"], [5, "Room service waiter"]] }),
  D("m4-room-close", { url: "/staff/rooms", steps: [{ click: "206" }, { click: "Close room" }], marks: [[1, "Close now"], [2, "Maintenance"], [3, "AC / fan"], [4, "What is wrong?", L], [5, "Close room 206 now"]] }),
  D("m4-room-move", { url: "/staff/rooms", steps: [{ click: "202" }, { click: "Move guest" }], marks: [[1, "AC problem"], [2, "Details (optional)", L], [3, "FREE ROOMS", L]] }),
  D("m4-room-disc", { url: "/staff/rooms", steps: [{ click: "202" }, { click: "Discount" }], marks: [[1, "e.g. 10000", L], [2, "Why?", L], [3, "Save TZS 0 off each night"]] }),
  D("m4-room-nights", { url: "/staff/rooms", steps: [{ click: "202" }, { click: "Free nights" }], marks: [[1, "+1 night"], [2, "Why?", L], [3, "Give 1 night free"]] }),
  D("m4-room-overdue", { url: "/staff/rooms", steps: [{ click: "107" }], marks: [[1, "Free late checkout"], [2, "Let leave owing"], [3, "Free nights"]] }),
  D("m4-room-clean", { url: "/staff/rooms", steps: [{ click: "105" }], marks: [[1, "Confirm clean & ready"]] }),
  D("m4-requests", { url: "/staff/requests", marks: [[1, "Log a request"], [2, "Waiting for someone to accept", L], [3, "css:select", L], [4, "Done today", L]] }),
  D("m4-trn-open", { url: "/staff/transport", steps: [{ click: "TRN-2026-00002" }], marks: [[1, "Adjust"], [2, "Confirm request"], [3, "No show"], [4, "Cancel"]] }),
  D("m4-trn-prices", { url: "/staff/transport?tab=report", scroll: "Services, packages & prices", marks: [[1, "Services, packages & prices", L], [2, "Save"], [3, "Hotel vehicles", L], [4, "Add vehicle"]] }),
  D("m4-rest", { url: "/staff/restaurant", h: 1000, marks: [[1, "Restaurant QR"], [2, "TO COLLECT", L], [3, "NEW ORDERS", L], [4, "READY", L], [5, "No waiter yet", L], [6, "Kitchen & bar, live", L]] }),
  D("m4-waiters", { url: "/staff/restaurant/waiters", marks: [[1, "Tables & rooms"], [2, "ON SHIFT NOW", L], [3, "NO WAITER", L]] }),
  D("m4-fin", { url: "/staff/finance", h: 1000, marks: [[1, "This month"], [2, "Earned", L], [3, "Came in", L], [4, "Occupancy", L], [5, "Day by day", L]] }),
  D("m4-income", { url: "/staff/payments", marks: [[1, "Record payment"], [2, "Edit"], [3, "Reverse"]] }),
  D("m4-coll", { url: "/staff/collections", h: 1000, marks: [[1, "Everything", L], [2, "INTO WHICH ACCOUNT", L], [3, "HOW IT WAS PAID", L], [4, "STILL TO COLLECT", L], [5, "ON ROOM BILLS", L]] }),
  D("m4-owes", { url: "/staff/finance/receivables", marks: [[1, "Total outstanding", L], [2, "Overdue invoices", L], [3, "Statement"]] }),
  D("m4-inv-recv", { url: "/staff/inventory", steps: [{ click: "Receive stock" }, { click: "Rice" }], marks: [[1, "Received", L], [2, "Cost per kg", L], [3, "Supplier", L], [4, "Delivery note", L], [5, "Receive##2"]] }),
  D("m4-inv-count", { url: "/staff/inventory", steps: [{ click: "Count" }], marks: [[1, "0 counted", L], [2, "System says", L], [3, "Save count"]] }),
  D("m4-assets", { url: "/staff/assets", marks: [[1, "Needs attention"], [2, "Under repair", L]] }),
  D("m4-shifts", { url: "/staff/shifts", h: 1000, marks: [[1, "AT THE DESK", L], [2, "PREVIOUS SHIFT", L], [3, "MONEY TO COLLECT", L], [4, "All staff shifts"]] }),
  D("m4-shift-open", { url: "/staff/shifts/cmv5b1hq1004neksblfwqfyzy", marks: [[1, "Close this shift"], [2, "Shift report"]] }),
  D("m4-shift-close", { url: "/staff/shifts/cmv5b1hq1004neksblfwqfyzy", steps: [{ click: "Close this shift" }], marks: [[1, "Why?", L], [2, "Close the shift"]] }),
  D("m4-shifts-all", { url: "/staff/shifts/all", marks: [[1, "ON SHIFT NOW", L], [2, "Reception"], [3, "Shift"], [4, "Report"]] }),
  D("m4-daily", { url: "/staff/reports/daily", marks: [[1, "Today's report is ready", L], [2, "Daily room reports"], [3, "Mon 12/10/26", L]] }),
  D("m4-dailyrep", { url: "/staff/reports/daily/cmv5d2ztt008jeksb7vb3a8xj", marks: [[1, "Print"], [2, "PDF"], [3, "Share"]] }),
  D("m4-staffrep", { url: "/staff/reports/staff", h: 1000, marks: [[1, "Weekly reports", L], [2, "Monthly reports", L], [3, "Latest shift reports", L]] }),
  D("m4-activity", { url: "/staff/activity", marks: [[1, "Staff member", L], [2, "Area", L]] }),
  D("m4-stays", { url: "/staff/reservations", h: 1000, marks: [[1, "Room schedule"], [2, "RECEPTION, TODAY", L], [3, "Arriving today", L], [4, "Owes money"], [5, "Search every booking", L]] }),
  D("m4-online", { url: "/staff/booking-requests", marks: [[1, "Waiting for an answer", L], [2, "Booked online — not paid yet", L], [3, "New"]] }),
  D("m4-cal", { url: "/staff/reservations/calendar", marks: [[1, "2 weeks"], [2, "Fewest free", L], [3, "sort out", L]] }),
  D("m4-inv", { url: "/staff/inventory", h: 1000, marks: [[1, "Receive stock"], [2, "Stock"], [3, "Waste"], [4, "Count"], [5, "Needs attention", L]] }),
  D("m4-waste-wait", { url: "/staff/inventory", steps: [{ click: "Waste" }], marks: [[1, "Waiting for approval", L], [2, "Approve"], [3, "Reject"]] }),
  D("m4-stockreq", { url: "/staff/stock-requests", marks: [[1, "To review", L], [2, "To buy", L], [3, "Being bought", L], [4, "To approve", L], [5, "SR-2026-0001", L]] }),
  D("m4-req-open", { url: "/staff/stock-requests", h: 1000, steps: [{ click: "SR-2026-0001" }], marks: [[1, "Approve for purchase"], [2, "Send back"], [3, "Reject"]] }),
  // ── flows that move forward in the practice copy: every picture below is taken ONCE (run it by its own name) ──
  // the cook reports waste and asks for stock, so the manager has something to decide
  T("m5-chef-waste", { url: "/staff/inventory", h: 1060, steps: [{ click: "Waste Chicken" }, { type: "2", into: 'css:input[inputmode="decimal"]' }, { type: "Fridge was off overnight", into: "What happened?" }, { click: "Send to the manager" }, { wait: 1200 }] }),
  T("m5-chef-req", { url: "/staff/stock-requests", h: 1060, steps: [{ click: "Whole chicken" }, { click: "Fish fillet" }, { click: "Check the list" }, { click: "Send 2 items" }, { wait: 1500 }] }),
  // the manager decides — each of these saves, so each is run ONCE by its own name
  D("m5-waste-ok", { url: "/staff/inventory", steps: [{ click: "Waste" }, { click: "Approve" }, { wait: 1800 }] }),
  D("m5-req-ok", { url: "/staff/stock-requests", h: 1000, steps: [{ click: "SR-2026-0001" }, { click: "Approve for purchase" }, { wait: 1800 }] }),
  // only looks (nothing saved)
  D("m5-buy-look", { url: "/staff/stock-requests", h: 1500, steps: [{ click: "SR-2026-0001" }, { click: "Record the purchase", optional: true }, { wait: 800 }] }),
  D("m5-buy-form", { url: "/staff/stock-requests", h: 1500, steps: BUY, marks: [[1, "Bought (kg)", L], [2, "Price per kg (TZS)", L], [3, "Bought from", L], [4, "Receipt photo or PDF", L], [5, "Paid from", L], [6, "Send for final approval"]] }),
  // saves: run ONCE by its own name
  D("m5-buy-send", { url: "/staff/stock-requests", h: 1500, steps: [...BUY, { click: "Send for final approval" }, { wait: 2200 }] }),
  D("m5-final-look", { url: "/staff/stock-requests", h: 1500, steps: [{ click: "SR-2026-0001" }, { wait: 800 }] }),
  D("m5-final", { url: "/staff/stock-requests", h: 1500, steps: [{ click: "SR-2026-0001" }, { js: pick("Food & kitchen") }, { wait: 500 }], marks: [[1, "TOTAL PAID", L], [2, "RECEIPT", L], [3, "Kind of expense", L], [4, "Approve purchase · TZS 25,000"], [5, "Send back for correction"]] }),
  D("m5-final-sure", { url: "/staff/stock-requests", h: 1500, steps: [{ click: "SR-2026-0001" }, { js: pick("Food & kitchen") }, { wait: 400 }, { click: "Approve purchase · TZS 25,000" }, { wait: 600 }], marks: [[1, "Yes, approve the purchase"]] }),
  // saves: run ONCE by its own name
  D("m5-final-ok", { url: "/staff/stock-requests", h: 1500, steps: [{ click: "SR-2026-0001" }, { js: pick("Food & kitchen") }, { wait: 400 }, { click: "Approve purchase · TZS 25,000" }, { wait: 600 }, { click: "Yes, approve the purchase" }, { wait: 2500 }] }),
  D("m5-req-done", { url: "/staff/stock-requests", h: 1000 }),
];
