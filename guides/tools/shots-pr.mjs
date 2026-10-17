// The purchase-request flow, from the first request to the supplier's payment (prefix "pr-"). See guides/tools/pr-pictures.md.
// EVERY picture here belongs to a moment of the practice copy (a request that was 'Submitted', then 'Approved'…). Many of them SAVE something
// (send, approve, order, pay). So this list does nothing unless you name pictures, and the saving ones must not be run twice:
//   node guides/tools/shoot.mjs --list=shots-pr pr-d-queue
// The steps that SAVE something (send, approve, order, pay…) are run ONCE, by their own name, in the order of the flow:
//   node guides/tools/shoot.mjs --list=shots-pr pr-a-sent
// The ones that only open a page or a dialog can be taken again at any time.
const L = { at: "l" };
const R = { at: "r" };
const T = { at: "t" };
const B = { at: "b" };
const ASHA = "asha@vegas.test";
const NEEMA = "neema@vegas.test";
const REHEMA = "rehema@vegas.test";
const CHEF = "chef@vegas.test";
const CTR = "counter@vegas.test";
const FIN = "accountant@vegas.test";
const BUY = "purchasing@vegas.test";
const BOSS = "owner@vegas.test";
const MGR = "manager@vegas.test";

// Page helpers: a plain drop-down list, a typed field, a date, in the way a person does it (the page hears the change).
const pick = (words, css = "select") => `(()=>{const s=[...document.querySelectorAll(${JSON.stringify(css)})].find(x=>[...x.options].some(o=>o.text.includes(${JSON.stringify(words)})));if(!s)return;const o=[...s.options].find(o=>o.text.includes(${JSON.stringify(words)}));const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,o.value);s.dispatchEvent(new Event('change',{bubbles:true}));})()`;
const fill = (css, value, nth = 1) => `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(css)})][${nth - 1}];if(!e)return;const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`;

const REQ = "/staff/stock-requests";
// back to the top of the page and of every box that scrolls inside it (clicking a tab can scroll the page a little)
const TOP = { js: "document.querySelectorAll('*').forEach((e)=>{if(e.scrollTop>0)e.scrollTop=0});scrollTo(0,0)" };
const D = (id, as, spec) => ({ id, as, view: "desk", ...spec });
const TB = (id, as, spec) => ({ id, as, view: "tablet", ...spec });

// ── A. Reception asks (R1: bath and hand towels) ──
const FORM1 = [
  { click: "Bath towels" }, { click: "Hand towels" },
  { js: fill('input[aria-label="How many"]', 20, 1) }, { js: fill('input[aria-label="How many"]', 20, 2) },
  { js: fill('input[placeholder^="What is it for"]', "New towels for the guest rooms: the old ones are worn out") },
  { js: fill('input[aria-label="Estimated cost (TZS)"]', "400000") },
  { js: fill('input[placeholder^="Note for Finance"]', "Needed before the weekend arrivals") },
  { js: fill('input[maxlength="80"]', "Guest room towels") },
  { js: fill('input[type="date"]', "2026-10-17") },
  { wait: 300 },
];
const DEPT = 'css:select[aria-label="Other department"]';

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

const FORM3 = [
  { js: pick("Restaurant", 'select[aria-label="Other department"]') }, { wait: 400 },
  { click: "Kitchen & restaurant equipment" }, { click: "Drinking glasses" },
  { js: fill('input[aria-label="How many"]', 24, 1) },
  { js: fill('input[placeholder^="What is it for"]', "Glasses broken this week, the bar is short") },
  { js: fill('input[aria-label="Estimated cost (TZS)"]', "120000") },
  { wait: 300 },
];

// R1's quotations: three suppliers, 20 hand towels and 20 bath towels each (the dialog lists hand towels first)
const QUOTE = (name, phone, hand, bath, days, note) => [
  { js: pick("A new supplier", "select#q-supplier") }, { wait: 300 },
  { js: fill("input#q-new", name) }, { js: fill('input[placeholder^="Phone"]', phone) },
  { js: fill('input[aria-label="Price each (TZS)"]', hand, 1) }, { js: fill('input[aria-label="Price each (TZS)"]', bath, 2) },
  { js: fill("input#q-valid", "2026-10-31") }, { js: fill("input#q-days", days) }, { js: fill("textarea#q-note", note) },
];
const QB = QUOTE("Mlimani Linen House", "0713 555 220", 6000, 15500, 4, "Heavier cotton, 4 days");
const QC = QUOTE("Uhuru Hotel Supplies", "0754 880 190", 6500, 17000, 2, "Hotel-grade cotton, ready in 2 days");
const R6URL = "/staff/procurement/cmv6zl9r4002y15sbgn6xp7ze"; // R6 (SR-2026-0007, sugar)
const R4URL = "/staff/procurement/cmv6ykbvi000p15sbed4wb2xa"; // R4 (SR-2026-0006)
const R1URL = "/staff/procurement/cmv6xzewh000115sbtur9rudn"; // the workspace of R1 (SR-2026-0002)
const OPEN1 = [{ click: "SR-2026-0002" }, { wait: 1200 }];
// scroll the Finance tab bar so the tab of this page can be seen
const TABBAR = { js: "document.querySelector('nav[aria-label=Finance] a[aria-current=page]')?.scrollIntoView({inline:'center',block:'nearest'})" };
// R1's first delivery: all the hand towels and 8 of the 20 bath towels (2 more came torn and were not accepted)
const DEL1 = [{ js: fill("input#d-q-0", 20) }, { js: fill("input#d-q-1", 8) }, { js: fill("input#d-r-1", 2) }, { wait: 300 }, { js: fill('input[placeholder^="Describe the problem"]', "Two towels torn at the edge") }];
// R1's invoice (Uhuru, TZS 470,000, due in two weeks)
const INV1 = [{ js: fill("input#i-no", "UHU-0387") }, { js: fill("input#i-due", "2026-10-27") }, { js: fill("textarea#i-note", "Delivery included") }];
const QA = QUOTE("Kariakoo Textile Traders", "0712 345 601", 5500, 14000, 5, "Cotton, standard weight");

const ALL = [
  D("pr-a-menu", ASHA, { url: "/reception/dashboard", h: 900, scroll: "Purchase requests", marks: [[1, "Guest requests", L], [2, "Purchase requests", L]] }),
  D("pr-a-open", ASHA, { url: REQ, h: 1500, scroll: "top", marks: [[1, "New request"], [2, "Requests"], [3, DEPT, L], [4, "Search — towels", L], [5, "Towels & bedding"], [6, "Bath towels"], [7, "Something else", L]] }),
  D("pr-a-empty", NEEMA, { url: REQ, steps: [{ click: "Start my shift", then: 2500 }, { click: "Requests" }, TOP], marks: [[1, "New request"], [2, "Waiting", L], [3, "You have not asked for anything yet."]] }),
  D("pr-a-form", ASHA, { url: REQ, h: 1500, scroll: "top", steps: FORM1, marks: [[1, DEPT, L], [2, "Towels & bedding"], [3, "Bath towels"], [4, "Your list", L], [5, "What is it for", L], [6, "Estimated cost in TZS", L], [7, "Photo or document", L], [8, "Check the list"]] }),
  D("pr-a-more", ASHA, { url: REQ, h: 1500, scroll: "top", steps: [...FORM1, { click: "More options" }], marks: [[1, "More options"], [2, 'css:input[maxlength="80"]', L], [3, 'css:div[aria-label="Priority"]', L], [4, 'css:input[type="date"]', L]] }),
  D("pr-a-check", ASHA, { url: REQ, h: 1500, steps: [...FORM1, { click: "Check the list" }, { wait: 600 }], marks: [[1, "Print"], [2, "Change it"], [3, "Send 2 items to Finance"]] }),
  // R1 was sent once (SR-2026-0002, with the green message). Its list picture can be taken again:
  D("pr-a-list", ASHA, { url: REQ, h: 700, steps: [{ click: "Requests" }, TOP], marks: [[1, "Waiting", L], [2, "css:span.shrink-0.whitespace-nowrap.rounded-full##1", { self: true, at: "t" }], [3, "css:span.shrink-0.whitespace-nowrap.rounded-full##2", { self: true, at: "t" }]] }),
  D("pr-a-detail", ASHA, { url: REQ, h: 1300, steps: [{ click: "Requests" }, { click: "SR-2026-0002" }, { wait: 600 }] }),

  // ── B. The kitchen asks (R2: oil, gas, frying pans) ──
  TB("pr-b-open", CHEF, { url: REQ, h: 1500, scroll: "top", marks: [[1, "Kitchen"], [2, "Bar"], [3, "Meat & fish"], [4, "Search — rice", L]] }),
  TB("pr-b-form", CHEF, { url: REQ, h: 1700, scroll: "top", steps: FORM2, marks: [[1, "Kitchen"], [2, "Kitchen & restaurant equipment"], [3, "Frying pans"], [4, "Your list", L], [5, "What is it for", L], [6, "Estimated cost in TZS", L], [7, "Check the list"]] }),
  // saves R2 — run ONCE
  TB("pr-b-sent", CHEF, { url: REQ, h: 1000, steps: [...FORM2, { click: "Check the list" }, { wait: 500 }, { click: "Send 3 items to Finance" }, { wait: 1500 }], marks: [[1, "Requests"], [2, "Waiting", L], [3, "SR-2026-0003"], [4, "Submitted", { self: true, at: "t" }]] }),

  // ── C. The Restaurant Counter asks (R3: drinking glasses) ──
  TB("pr-c-form", CTR, { url: REQ, h: 1500, scroll: "top", steps: FORM3, marks: [[1, 'css:a[href="/staff/stock-requests"]', { at: "r" }], [2, DEPT, R], [3, "Kitchen & restaurant equipment"], [4, "Drinking glasses"], [5, "Your list", L], [6, "Check the list"]] }),
  // saves R3 — run ONCE
  TB("pr-c-sent", CTR, { url: REQ, h: 800, steps: [...FORM3, { click: "Check the list" }, { wait: 500 }, { click: "Send 1 item to Finance" }, { wait: 1500 }], marks: [[1, "Requests"], [2, "SR-2026-0004"], [3, "Submitted", { self: true, at: "t" }]] }),

  // ── D. Finance reviews the requests ──
  D("pr-d-menu", FIN, { url: "/finance/dashboard", h: 900, scroll: "Purchase requests", marks: [[1, 'css:a[href="/staff/procurement"]', L], [2, 'css:a[href="/staff/stock-requests"]', L]] }),
  D("pr-d-queue", FIN, { url: REQ, h: 900, scroll: "top", marks: [[1, "To review", L], [2, "SR-2026-0002"], [3, "Your turn"], [4, "Waiting for review", { self: true, at: "t" }]] }),
  D("pr-d-open1", FIN, { url: REQ, h: 1400, steps: [{ click: "SR-2026-0002" }, { wait: 700 }], marks: [[1, 'css:input[placeholder^="leave empty"]', L], [2, "Approve for purchase"], [3, "Change"], [4, "Send back"], [5, "Reject"]] }),
  // R1: approve with the budget (400,000, the estimate) — saves, run ONCE
  D("pr-d-approve1", FIN, { url: REQ, h: 900, steps: [{ click: "SR-2026-0002" }, { wait: 700 }, { click: "Approve for purchase" }, { wait: 1600 }], marks: [[1, "To buy", L], [2, "Approved — to buy"]] }),
  // R2: send back with a note
  D("pr-d-back-form", FIN, { url: REQ, h: 1400, steps: [{ click: "SR-2026-0003" }, { wait: 700 }, { click: "Send back" }, { wait: 300 }, { js: fill('input[placeholder^="What should they change"]', "Say how many gas cylinders you use in a week.") }, { wait: 300 }], marks: [[1, 'css:input[placeholder^="What should they change"]', L], [2, "Send back"]] }),
  // saves — run ONCE
  D("pr-d-back-sent", FIN, { url: REQ, h: 900, steps: [{ click: "SR-2026-0003" }, { wait: 700 }, { click: "Send back" }, { wait: 300 }, { js: fill('input[placeholder^="What should they change"]', "Say how many gas cylinders you use in a week.") }, { wait: 300 }, { click: "Send back" }, { wait: 1600 }], marks: [[1, "To review", L], [2, "Sent back to change"]] }),
  // what the people who asked now see (six simple words)
  TB("pr-d-chef-list", CHEF, { url: REQ, h: 800, scroll: "top", marks: [[1, "SR-2026-0003"], [2, "Your turn"], [3, "More information needed", { self: true, at: "t" }]] }),
  TB("pr-d-chef-open", CHEF, { url: REQ, h: 1200, steps: [{ click: "SR-2026-0003" }, { wait: 700 }], marks: [[1, "More information needed", { self: true, at: "t" }], [2, "Sent back to you"], [3, "Change and send again"], [4, "Cancel request"]] }),
  D("pr-d-asha-list", ASHA, { url: REQ, h: 800, steps: [{ click: "Requests" }, TOP], marks: [[1, "css:span.shrink-0.whitespace-nowrap.rounded-full", { self: true, at: "t" }], [2, "SR-2026-0002"]] }),
  D("pr-d-asha-open", ASHA, { url: REQ, h: 1200, steps: [{ click: "Requests" }, { click: "SR-2026-0002" }, { wait: 700 }], marks: [[1, 'css:[role="dialog"] span.whitespace-nowrap.rounded-full', { self: true, at: "t" }], [2, "Budget approved by Finance"], [3, "Approved by Finance"]] }),
  // ── Two more requests from Reception: R4 (Rehema, for the invoice stage) and R5 (Asha, left waiting for quotations). Each saves — run ONCE. ──
  D("pr-x-r4-send", ASHA, { url: REQ, h: 1300, steps: [{ click: "Reception & office" }, { click: "Printer paper" }, { js: fill('input[aria-label="How many"]', 10, 1) }, { js: fill('input[placeholder^="What is it for"]', "Printer paper for the front desk and the guest bills") }, { js: fill('input[aria-label="Estimated cost (TZS)"]', "90000") }, { wait: 300 }, { click: "Check the list" }, { wait: 500 }, { click: "Send 1 item to Finance" }, { wait: 1500 }] }),
  // (R5 = SR-2026-0005 was sent from Asha with the same steps: Maintenance & replacements, Light bulbs 40, Air-conditioner filters 6, estimate 250,000.)
  // Finance approves R5 and R4 (each saves — run ONCE; the budget is the estimate)
  D("pr-x-approve5", FIN, { url: REQ, h: 900, steps: [{ click: "SR-2026-0005" }, { wait: 700 }, { click: "Approve for purchase" }, { wait: 1600 }] }),
  D("pr-x-approve4", FIN, { url: REQ, h: 900, steps: [{ click: "SR-2026-0006" }, { wait: 700 }, { click: "Approve for purchase" }, { wait: 1600 }] }),
  // ── E. Purchasing gets the quotations (R1) ──
  D("pr-e-menu", BUY, { url: "/staff/procurement", h: 800, marks: [[1, "Home", L], [2, "Inventory", L], [3, 'css:a[href="/staff/stock-requests"]', L]] }),
  D("pr-e-board", BUY, { url: "/staff/procurement", h: 900, scroll: "top", marks: [[1, "To quote"], [2, "SR-2026-0002"], [3, "BUDGET"], [4, "Approved — awaiting supplier quotation", { self: true, at: "t" }], [5, "Filters", L]] }),
  D("pr-e-work0", BUY, { url: "/staff/procurement", h: 1250, steps: [{ click: "SR-2026-0002" }, { wait: 1200 }, TOP], marks: [[1, "Their estimate", { up: 1 }], [2, "Approved budget", { up: 1 }], [3, "What is wanted", L], [4, "In stock now"], [5, "Add a quotation"]] }),
  D("pr-e-q-form", BUY, { url: "/staff/procurement", h: 1500, steps: [{ click: "SR-2026-0002" }, { wait: 1200 }, { click: "Add a quotation" }, { wait: 500 }, ...QA, { wait: 300 }], marks: [[1, "Supplier", L], [2, "New supplier's name", L], [3, 'css:input[aria-label="Price each (TZS)"]'], [4, "Quotation total", L], [5, "Price holds until", L], [6, "Delivery takes (days)"], [7, "Record the quotation"]] }),
  // R1: three quotations — each saves, run ONCE, in this order
  D("pr-e-quote-a", BUY, { url: "/staff/procurement", h: 1250, steps: [...OPEN1, { click: "Add a quotation" }, { wait: 500 }, ...QA, { wait: 300 }, { click: "Record the quotation" }, { wait: 1800 }, TOP] }),
  D("pr-e-quote-b", BUY, { url: "/staff/procurement", h: 1250, steps: [...OPEN1, { click: "Add a quotation" }, { wait: 500 }, ...QB, { wait: 300 }, { click: "Record the quotation" }, { wait: 1800 }, TOP] }),
  D("pr-e-quotes", BUY, { url: "/staff/procurement", h: 1250, steps: [...OPEN1, { click: "Add a quotation" }, { wait: 500 }, ...QC, { wait: 300 }, { click: "Record the quotation" }, { wait: 1800 }, TOP], marks: [[1, "Supplier quotations", L], [2, "lowest"], [3, "Quotation terms", L], [4, "Budget TZS 400,000", L], [5, "Propose this one##3"], [6, "Finance must authorize##2"]] }),
  // R1: propose the dearest quotation (Uhuru, TZS 470,000 — above the 400,000 budget) — saves, run ONCE
  D("pr-e-proposed", BUY, { url: "/staff/procurement", h: 1700, steps: [...OPEN1, { click: "Propose this one##2" }, { wait: 1800 }, TOP], marks: [[1, "Waiting for Finance to authorize the price", { self: true, at: "t" }], [2, "Waiting for Finance", L], [3, "The Accountant proposes", L], [4, "Nothing can be ordered until Finance authorizes this price."]] }),
  // ── F. Finance authorizes the price (R1) ──
  D("pr-f-board", FIN, { url: "/staff/procurement", h: 1000, steps: [TABBAR, TOP, { wait: 300 }], marks: [[1, 'css:nav[aria-label="Finance"] a[aria-current="page"]', { at: "t" }], [2, "Asked for", { up: 1 }], [3, "Still owed", { up: 1 }], [4, "With Finance"], [5, "SR-2026-0002"], [6, "Waiting for Finance to authorize the price", { self: true, at: "t" }]] }),
  D("pr-f-open", FIN, { url: R1URL, h: 1700, steps: [TOP], marks: [[1, "Approved budget", { up: 1 }], [2, "Quotation", { up: 1 }], [3, "Waiting for Finance", L], [4, "Authorize this price"], [5, "Send back"]] }),
  // the amount is above what Finance may authorize alone (the practice limit is set to 450,000 for this one picture, then cleared)
  D("pr-f-limit", FIN, { url: R1URL, h: 1300, steps: [{ click: "Authorize this price" }, { wait: 600 }, { click: "Authorize" }, { wait: 900 }], marks: [[1, "Authorize"]] }),
  // saves — run ONCE (limit cleared first)
  D("pr-f-authform", FIN, { url: R1URL, h: 1700, steps: [{ click: "Authorize this price" }, { wait: 600 }, { js: fill("textarea", "Uhuru delivers in 2 days and the guests arrive on Friday.") }, { wait: 300 }], marks: [[1, "Note", L], [2, "Authorize"]] }),
  D("pr-f-authorized", FIN, { url: R1URL, h: 1700, steps: [{ click: "Authorize this price" }, { wait: 600 }, { js: fill("textarea", "Uhuru delivers in 2 days and the guests arrive on Friday.") }, { wait: 300 }, { click: "Authorize" }, { wait: 1800 }, TOP], marks: [[1, "Price authorized — ready to order", { self: true, at: "t" }], [2, "Purchase order", L], [3, "Price authorized by", { up: 0 }]] }),
  // ── G. Purchasing: order, deliveries, invoice (R1) ──
  D("pr-g-order-form", BUY, { url: R1URL, h: 1500, steps: [{ click: "Issue the purchase order" }, { wait: 500 }, { js: fill("textarea#o-note", "Please bring them to the back store entrance.") }, { wait: 300 }], marks: [[1, "Expected delivery", L], [2, "Note for the supplier", L], [3, "Issue the order"]] }),
  // saves — run ONCE
  D("pr-g-ordered", BUY, { url: R1URL, h: 1500, steps: [{ click: "Issue the purchase order" }, { wait: 500 }, { js: fill("textarea#o-note", "Please bring them to the back store entrance.") }, { wait: 300 }, { click: "Issue the order" }, { wait: 1800 }, TOP], marks: [[1, "Ordered — waiting for delivery", { self: true, at: "t" }], [2, "Purchase order", L], [3, "Expected delivery", L], [4, "Record a delivery"], [5, "Cancel the order"]] }),
  D("pr-g-delivery-form", BUY, { url: R1URL, h: 1500, steps: [{ click: "Record a delivery" }, { wait: 500 }, ...DEL1, { wait: 300 }], marks: [[1, 'css:[role="dialog"] p.font-medium', L], [2, 'css:input[id="d-q-1"]'], [3, 'css:input[id="d-r-1"]'], [4, 'css:select[id="d-p-1"]'], [5, 'css:input[placeholder^="Describe the problem"]', L], [6, "Delivery note (photo or PDF)", L], [7, "Record the delivery"]] }),
  // saves — run ONCE (the first, part delivery)
  D("pr-g-delivery-1", BUY, { url: R1URL, h: 1700, steps: [{ click: "Record a delivery" }, { wait: 500 }, ...DEL1, { wait: 300 }, { click: "Record the delivery" }, { wait: 1800 }, TOP], marks: [[1, "Partly delivered", { self: true, at: "t" }], [2, "Deliveries", L], [3, "not accepted", { self: true, at: "r" }], [4, "Record a delivery"], [5, "Close — the rest is not coming"]] }),
  // saves — run ONCE (the rest arrives: the quantity is already filled in)
  D("pr-g-delivery-2", BUY, { url: R1URL, h: 1700, steps: [{ click: "Record a delivery" }, { wait: 500 }, { click: "Record the delivery" }, { wait: 1800 }, TOP], marks: [[1, "Delivered — invoice and payment to finish", { self: true, at: "t" }], [2, "Delivered", { up: 1 }], [3, "Invoices and payment", L], [4, "Record an invoice"]] }),
  D("pr-g-invoice-form", BUY, { url: R1URL, h: 1500, steps: [{ click: "Record an invoice" }, { wait: 500 }, ...INV1, { wait: 300 }], marks: [[1, "Invoice number", L], [2, "Amount (TZS)", L], [3, "Invoice date", L], [4, "Due on", L], [5, "The invoice (photo or PDF)", L], [6, "Record the invoice"]] }),
  // saves — run ONCE
  D("pr-g-invoiced", BUY, { url: R1URL, h: 1700, steps: [{ click: "Record an invoice" }, { wait: 500 }, ...INV1, { wait: 300 }, { click: "Record the invoice" }, { wait: 1800 }, TOP], marks: [[1, "To verify", { self: true, at: "t" }], [2, "Invoices and payment", L], [3, "UHU-0387", L], [4, "Invoiced / paid", { up: 1 }]] }),
  // ── H. Finance verifies and pays (R1) ──
  D("pr-h-open", FIN, { url: R1URL, h: 1700, steps: [TOP, { js: "document.querySelectorAll('h2').forEach((h)=>{if(h.textContent.includes('Invoices and payment'))h.scrollIntoView({block:'center'})})" }, { wait: 300 }], marks: [[1, "Invoices and payment", L], [2, "To verify", { self: true, at: "t" }], [3, "Verify"], [4, "Dispute"]] }),
  D("pr-h-verify-form", FIN, { url: R1URL, h: 1700, steps: [{ click: "Verify" }, { wait: 500 }, { js: fill("textarea#why-Verify", "Matches the order and what arrived.") }, { wait: 300 }], marks: [[1, 'css:[role="dialog"] textarea', L], [2, 'css:[role="dialog"] button[type="submit"]']] }),
  // saves — run ONCE
  D("pr-h-verified", FIN, { url: R1URL, h: 1700, steps: [{ click: "Verify" }, { wait: 500 }, { js: fill("textarea#why-Verify", "Matches the order and what arrived.") }, { wait: 300 }, { click: 'css:[role="dialog"] button[type="submit"]' }, { wait: 1800 }, { js: "document.querySelectorAll('h2').forEach((h)=>{if(h.textContent.includes('Invoices and payment'))h.scrollIntoView({block:'center'})})" }, { wait: 300 }], marks: [[1, "Verified — to pay", { self: true, at: "t" }], [2, "Verified by", L], [3, "Record payment"], [4, "Cancel invoice"]] }),
  D("pr-h-pay-form", FIN, { url: R1URL, h: 1700, steps: [{ click: "Record payment" }, { wait: 500 }, { js: pick("CRDB", "select#p-account") }, { js: fill("input#p-ref", "CRDB transfer 88412") }, { wait: 300 }], marks: [[1, "Amount paid (TZS)", L], [2, "Paid on", L], [3, "Paid from", L], [4, "Reference", L], [5, 'css:[role="dialog"] button[type="submit"]']] }),
  // saves — run ONCE: the money leaves the account, the expense appears, the purchase is Done
  D("pr-h-paid", FIN, { url: R1URL, h: 1700, steps: [{ click: "Record payment" }, { wait: 500 }, { js: pick("CRDB", "select#p-account") }, { js: fill("input#p-ref", "CRDB transfer 88412") }, { wait: 300 }, { click: 'css:[role="dialog"] button[type="submit"]' }, { wait: 2200 }, TOP], marks: [[1, "Done", { self: true, at: "t" }], [2, "Invoiced / paid", { up: 1 }], [3, "CRDB Bank", L], [4, "Paid", { self: true, at: "t" }]] }),
  // what the payment left behind
  D("pr-h-expenses", FIN, { url: "/staff/expenses", h: 1500, scroll: "top", marks: [[1, "MONEY SPENT", L], [2, "Supplier payment · UHU-0387", { self: true }], [3, "Paid · approved", { self: true, at: "t" }]] }),
  D("pr-h-requests", FIN, { url: REQ, h: 1100, scroll: "top" }),
  D("pr-h-asha-done", ASHA, { url: REQ, h: 800, steps: [{ click: "Requests" }, TOP] }),
  // ── R4 (SR-2026-0006, printer paper): the stages up to "invoice received, not paid" — set-up steps, each saves, run ONCE in this order ──
  D("pr-x-r4-quote", BUY, { url: R4URL, h: 1300, steps: [{ click: "Add a quotation" }, { wait: 500 }, { js: pick("Uhuru Hotel Supplies", "select#q-supplier") }, { js: fill('input[aria-label="Price each (TZS)"]', 8500, 1) }, { js: fill("input#q-valid", "2026-10-31") }, { js: fill("input#q-days", 2) }, { wait: 300 }, { click: "Record the quotation" }, { wait: 1800 }] }),
  // within the budget (85,000 of 90,000): proposing it needs no one's authorization
  D("pr-e-within", BUY, { url: R4URL, h: 1300, steps: [{ click: "Propose this one" }, { wait: 1800 }, TOP], marks: [[1, "Price authorized — ready to order", { self: true, at: "t" }], [2, "Purchase order", L], [3, "is within the approved budget", L], [4, "Issue the purchase order"]] }),
  D("pr-x-r4-order", BUY, { url: R4URL, h: 1300, steps: [{ click: "Issue the purchase order" }, { wait: 500 }, { click: "Issue the order" }, { wait: 1800 }] }),
  D("pr-x-r4-delivery", BUY, { url: R4URL, h: 1300, steps: [{ click: "Record a delivery" }, { wait: 500 }, { click: "Record the delivery" }, { wait: 1800 }] }),
  D("pr-x-r4-inv-a", BUY, { url: R4URL, h: 1300, steps: [{ click: "Record an invoice" }, { wait: 500 }, { js: fill("input#i-no", "UHU-0391") }, { js: fill("input#i-date", "2026-10-06") }, { js: fill("input#i-due", "2026-10-10") }, { wait: 300 }, { click: "Record the invoice" }, { wait: 1800 }] }),
  D("pr-x-r4-inv-b", BUY, { url: R4URL, h: 1300, steps: [{ click: "Record an invoice" }, { wait: 500 }, { js: fill("input#i-no", "UHU-0392") }, { js: fill("input#i-amount", 15000) }, { js: fill("input#i-date", "2026-10-12") }, { js: fill("input#i-due", "2026-10-20") }, { js: fill("textarea#i-note", "Delivery charge") }, { wait: 300 }, { click: "Record the invoice" }, { wait: 1800 }] }),
  // ── H (continued). R4: Finance disputes the second invoice; the lists that show it ──
  D("pr-h-dispute-form", FIN, { url: R4URL, h: 1500, steps: [{ click: "Dispute##2" }, { wait: 500 }, { js: fill("textarea#why-Dispute", "The delivery charge was not on the order.") }, { wait: 300 }], marks: [[1, 'css:[role="dialog"] textarea', L], [2, 'css:[role="dialog"] button[type="submit"]']] }),
  // saves — run ONCE
  D("pr-h-disputed", FIN, { url: R4URL, h: 1500, steps: [{ click: "Dispute##2" }, { wait: 500 }, { js: fill("textarea#why-Dispute", "The delivery charge was not on the order.") }, { wait: 300 }, { click: 'css:[role="dialog"] button[type="submit"]' }, { wait: 1800 }, { js: "document.querySelectorAll('h2').forEach((h)=>{if(h.textContent.includes('Invoices and payment'))h.scrollIntoView({block:'center'})})" }, { wait: 300 }], marks: [[1, "To verify", { self: true, at: "t" }], [2, "Disputed", { self: true, at: "t" }], [3, "Disputed by", L], [4, "Verify"], [5, "Cancel invoice##2"]] }),
  D("pr-h-invoices", FIN, { url: "/staff/procurement?tab=invoices", h: 1000, steps: [TABBAR, TOP, { wait: 300 }], marks: [[1, "Invoices and payment", { up: 0 }], [2, "Invoiced", { up: 1 }], [3, "Still owed", { up: 1 }], [4, "PO-2026-0002", L], [5, "an invoice is disputed", { self: true, at: "b" }]] }),
  D("pr-h-closed", FIN, { url: "/staff/procurement?tab=closed", h: 1000, steps: [TABBAR, TOP, { wait: 300 }] }),
  D("pr-h-home", FIN, { url: "/finance/dashboard", h: 1250, scroll: "top", marks: [[1, "Purchases", { at: "t" }], [2, "NEEDS YOUR ATTENTION", L], [3, "1 supplier invoice past its due date", L], [4, "1 supplier invoice disputed", L]] }),
  // ── The Manager: also reviews requests, and can still record a direct purchase (only while no quotation is proposed) ──
  D("pr-m-queue", MGR, { url: REQ, h: 900, scroll: "top", marks: [[1, "To review", L], [2, "To buy", L], [3, "SR-2026-0004"]] }),
  D("pr-m-open", MGR, { url: REQ, h: 1400, steps: [{ click: "SR-2026-0005" }, { wait: 800 }], marks: [[1, "Record the purchase"], [2, "Change"], [3, "Reject"]] }),
  // ── R6 (SR-2026-0007, sugar for the kitchen): the one purchase that is a STOCK item, so the delivery puts it into the store. Set-up steps, each saves, run ONCE in order. ──
  TB("pr-x-r6-send", CHEF, { url: REQ, h: 1300, steps: [{ click: "New request" }, { wait: 500 }, { click: "Rice, flour & dry food" }, { click: "Sugar" }, { js: fill('input[aria-label="How many"]', 50, 1) }, { js: fill('input[placeholder^="What is it for"]', "The sugar is finished") }, { js: fill('input[aria-label="Estimated cost (TZS)"]', "140000") }, { wait: 300 }, { click: "Check the list" }, { wait: 500 }, { click: "Send 1 item to Finance" }, { wait: 1500 }] }),
  D("pr-x-r6-approve", FIN, { url: REQ, h: 900, steps: [{ click: "SR-2026-0007" }, { wait: 700 }, { click: "Approve for purchase" }, { wait: 1600 }] }),
  D("pr-x-r6-quote", BUY, { url: R6URL, h: 1300, steps: [{ click: "Add a quotation" }, { wait: 500 }, { js: pick("Kariakoo Fresh Market", "select#q-supplier") }, { js: fill('input[aria-label="Price each (TZS)"]', 2700, 1) }, { js: fill("input#q-valid", "2026-10-31") }, { js: fill("input#q-days", 1) }, { wait: 300 }, { click: "Record the quotation" }, { wait: 1800 }] }),
  D("pr-x-r6-propose", BUY, { url: R6URL, h: 1300, steps: [{ click: "Propose this one" }, { wait: 1800 }] }),
  D("pr-x-r6-order", BUY, { url: R6URL, h: 1300, steps: [{ click: "Issue the purchase order" }, { wait: 500 }, { click: "Issue the order" }, { wait: 1800 }] }),
  // the goods arrive: a line linked to a stock item goes into the store (saves — run ONCE)
  D("pr-g-stock-in", BUY, { url: R6URL, h: 1500, steps: [{ click: "Record a delivery" }, { wait: 500 }, { click: "Record the delivery" }, { wait: 1800 }, TOP], marks: [[1, "Delivered — invoice and payment to finish", { self: true, at: "t" }], [2, "In stock now", L], [3, "· in stock", { self: true, at: "r" }], [4, "Record an invoice"]] }),
  D("pr-g-inventory", BUY, { url: "/staff/inventory", h: 1050, scroll: "top", marks: [[1, "Sugar", L], [2, "50 kg", L], [3, "KITCHEN FOOD", L]] }),
];

// no picture names given = nothing is taken (a careless run would send, approve and pay everything a second time)
export const SHOTS = process.argv.slice(2).some((a) => !a.startsWith("--")) ? ALL : [];
