// Pictures for the Purchasing book (prefix "pu-"). The purchase-request pictures of the first author (prefix "pr-") are reused as they are;
// this list adds what Purchasing sees that those pictures do not show: the six tabs as Peter sees them, a quotation with its document,
// a quotation sent back, the bell, a part delivery that goes into stock, closing a delivery short and an invoice with its file.
//
// Everything here is told with ONE new practice purchase of our own, R7 (the kitchen's cooking oil). R1–R6 are never touched.
// The steps that SAVE something are named "pu-x-…" or are marked "saves"; each is run ONCE, by its own name, in this order:
//   node guides/tools/shoot.mjs --list=shots-pu pu-x-r7-send
//   node guides/tools/shoot.mjs --list=shots-pu pu-x-r7-approve
//   … pu-x-r7-quote-a · pu-x-r7-propose · pu-x-r7-return · pu-x-r7-quote-b · pu-x-r7-ready · pu-x-r7-order · pu-x-r7-delivery · pu-x-r7-close · pu-x-r7-invoice
// So this list does nothing unless pictures are named.
const L = { at: "l" };
const R = { at: "r" };
const T = { at: "t" };
const B = { at: "b" };
const CHEF = "chef@vegas.test";
const FIN = "accountant@vegas.test";
const BUY = "purchasing@vegas.test";

const pick = (words, css = "select") => `(()=>{const s=[...document.querySelectorAll(${JSON.stringify(css)})].find(x=>[...x.options].some(o=>o.text.includes(${JSON.stringify(words)})));if(!s)return;const o=[...s.options].find(o=>o.text.includes(${JSON.stringify(words)}));const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,o.value);s.dispatchEvent(new Event('change',{bubbles:true}));})()`;
const fill = (css, value, nth = 1) => `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(css)})][${nth - 1}];if(!e)return;const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`;
// A small drawn "supplier paper" (a photo of a quotation or an invoice) put into a file box, as if it had been chosen from the phone.
const paper = (css, name, title, supplier, lines, total) => `(async()=>{
  const c=document.createElement('canvas');c.width=760;c.height=980;const x=c.getContext('2d');
  x.fillStyle='#fbfaf6';x.fillRect(0,0,760,980);x.fillStyle='#1b1b1b';x.font='700 38px Arial';x.fillText(${JSON.stringify(title)},50,90);
  x.font='600 26px Arial';x.fillText(${JSON.stringify(supplier)},50,140);x.fillStyle='#666';x.font='22px Arial';x.fillText('Practice example, not a real supplier',50,176);
  x.fillStyle='#1b1b1b';x.font='24px Arial';${lines.map((l, i) => `x.fillText(${JSON.stringify(l)},50,${260 + i * 52});`).join("")}
  x.fillRect(50,${300 + lines.length * 52},660,3);x.font='700 28px Arial';x.fillText(${JSON.stringify(total)},50,${352 + lines.length * 52});
  const blob=await new Promise((r)=>c.toBlob(r,'image/png'));
  const dt=new DataTransfer();dt.items.add(new File([blob],${JSON.stringify(name)},{type:'image/png'}));
  const i=document.querySelector(${JSON.stringify(css)});i.files=dt.files;i.dispatchEvent(new Event('change',{bubbles:true}));
})()`;

const REQ = "/staff/stock-requests";
const PRO = "/staff/procurement";
const TOP = { js: "document.querySelectorAll('*').forEach((e)=>{if(e.scrollTop>0)e.scrollTop=0});scrollTo(0,0)" };
const D = (id, as, spec) => ({ id, as, view: "desk", ...spec });
const TB = (id, as, spec) => ({ id, as, view: "tablet", ...spec });
const MORE = "document.querySelectorAll('h2').forEach((h)=>{if(h.textContent.includes('Invoices and payment'))h.scrollIntoView({block:'center'})})";

// R7 = the kitchen's cooking oil (40 litres, estimate 260,000). Filled in after the first step made it:
const R7 = "Kitchen cooking oil";
const R7NUM = "SR-2026-0008";
const R7URL = "/staff/procurement/cmv70mrp8000j3lsbvk5binbd"; // the workspace of R7

const QA = [
  { js: pick("Kariakoo Fresh Market", "select#q-supplier") },
  { js: fill('input[aria-label="Price each (TZS)"]', 6800, 1) }, { js: fill("input#q-valid", "2026-10-31") }, { js: fill("input#q-days", 2) },
  { js: fill("textarea#q-note", "Price for one litre, in 20-litre jerrycans") },
  { js: paper("input#q-doc", "quotation-kariakoo.png", "QUOTATION", "Kariakoo Fresh Market", ["Cooking oil, 40 litres", "6,800 per litre"], "Total  TZS 272,000") },
  { wait: 400 },
];
const QB = [
  { js: pick("A new supplier", "select#q-supplier") }, { wait: 300 },
  { js: fill("input#q-new", "Msasani Oil Traders") }, { js: fill('input[placeholder^="Phone"]', "0713 555 480") },
  { js: fill('input[aria-label="Price each (TZS)"]', 6400, 1) }, { js: fill("input#q-valid", "2026-10-31") }, { js: fill("input#q-days", 2) },
  { js: fill("textarea#q-note", "Better price for 40 litres at once") },
  { wait: 300 },
];
const INV = [
  { js: fill("input#i-no", "MOT-0541") }, { js: fill("input#i-due", "2026-10-27") }, { js: fill("textarea#i-note", "24 litres delivered, 16 litres not coming") },
  { js: paper("input#i-doc", "invoice-msasani.png", "INVOICE MOT-0541", "Msasani Oil Traders", ["Cooking oil, 24 litres", "6,400 per litre"], "Total  TZS 153,600") },
  { wait: 400 },
];

const ALL = [
  // ── What Purchasing sees without any new record (taken again at any time) ──
  D("pu-requests", BUY, { url: REQ, h: 760, scroll: "top", marks: [[1, "Purchase requests##1", { at: "r", self: true }], [2, "New request"], [3, "Requests"], [4, "Other department", { at: "b" }]] }),
  D("pu-filters", BUY, { url: PRO, h: 900, steps: [{ click: "Filters" }, { wait: 500 }, TOP], clip: ["css:h1", "css:table"], pad: 18, marks: [[1, "css:input[name=q]"], [2, "css:select[name=department]"], [3, "css:input[name=min]"], [4, "Show"]] }),
  // the six tabs, one picture each: the title, the tabs and the list
  D("pu-tab-quote", BUY, { url: PRO + "?tab=quote", h: 900, scroll: "top", clip: ["css:h1", "css:table"], pad: 18, marks: [[1, "To quote"], [2, "Approved — awaiting supplier quotation", { self: true, at: "t" }]] }),
  D("pu-tab-closed", BUY, { url: PRO + "?tab=closed", h: 900, scroll: "top", clip: ["css:h1", "css:table"], pad: 18, marks: [[1, "Closed"], [2, "Done", { self: true, at: "t" }]] }),

  // the cover (no marks): Peter's page, the tab with the invoices
  D("pu-cover", BUY, { url: PRO + "?tab=invoices", h: 760, scroll: "top" }),
  // the stores, as Purchasing sees them (read only): after the 24 litres went in
  D("pu-inventory", BUY, { url: "/staff/inventory", h: 1050, scroll: "top", marks: [[1, "Cooking oil", { at: "l" }], [2, "28 L", { self: true, at: "t" }]] }),
  // ── R7 (the kitchen's cooking oil). Each step that saves is run ONCE, in this order. ──
  // 1 the kitchen asks (saves)
  TB("pu-x-r7-send", CHEF, { url: REQ, h: 1300, steps: [{ click: "New request" }, { wait: 500 }, { click: "Oil, spices & sauces" }, { click: "Cooking oil" }, { js: fill('input[aria-label="How many"]', 40, 1) }, { js: fill('input[placeholder^="What is it for"]', "Cooking oil is almost finished: 4 litres left for the weekend") }, { js: fill('input[aria-label="Estimated cost (TZS)"]', "260000") }, { js: fill('input[maxlength="80"]', R7) }, { wait: 300 }, { click: "Check the list" }, { wait: 500 }, { click: "Send 1 item to Finance" }, { wait: 1500 }] }),
  // 2 Finance approves with the budget (saves)
  D("pu-x-r7-approve", FIN, { url: REQ, h: 900, steps: [{ click: R7NUM }, { wait: 700 }, { click: "Approve for purchase" }, { wait: 1600 }] }),
  // 3 Peter checks the stock before he asks for prices (read only)
  D("pu-wanted", BUY, { url: R7URL, h: 1000, steps: [TOP], marks: [[1, "Their estimate", { up: 1 }], [2, "Approved budget", { up: 1 }], [3, "In stock now"]]  }),
  // 4 the first quotation, with its paper (the form is a read-only picture; the next one saves)
  D("pu-q-doc", BUY, { url: R7URL, h: 1150, steps: [{ click: "Add a quotation" }, { wait: 500 }, ...QA], marks: [[1, "Supplier", L], [2, 'css:input[aria-label="Price each (TZS)"]'], [3, "Quotation total", L], [4, "Price holds until", L], [5, "Delivery takes (days)"], [6, "The supplier's quotation (photo or PDF)", L], [7, "Record the quotation"]] }),
  D("pu-x-r7-quote-a", BUY, { url: R7URL, h: 1500, steps: [{ click: "Add a quotation" }, { wait: 500 }, ...QA, { click: "Record the quotation" }, { wait: 1800 }, TOP], marks: [[1, "Supplier quotations", L], [2, "document", { self: true, at: "t" }], [3, "Propose this one"], [4, "Documents", L]] }),
  // (the same page again, read only, with the marks placed better — taken before the next step)
  D("pu-quote-a", BUY, { url: R7URL, h: 1450, steps: [TOP], marks: [[1, "Supplier quotations", L], [2, "document", { self: true, at: "l" }], [3, "Propose this one"], [4, "Documents", L]] }),
  // 5 Peter proposes it: it is above the budget, so it waits for Finance (saves) — then the picture is the tab "With Finance"
  D("pu-x-r7-propose", BUY, { url: R7URL, h: 900, clip: ["css:h1", "css:table"], pad: 18, steps: [{ click: "Propose this one" }, { wait: 1800 }, { goto: PRO + "?tab=authorize" }, { wait: 800 }, TOP], marks: [[1, "With Finance"], [2, R7NUM, { self: true, at: "t" }], [3, "Waiting for Finance to authorize the price", { self: true, at: "t" }]] }),
  // 6 Finance sends it back with a note (saves)
  D("pu-x-r7-return", FIN, { url: R7URL, h: 1300, steps: [{ click: "Send back" }, { wait: 500 }, { js: fill('[role="dialog"] textarea', "Please ask for a better price. We paid TZS 6,500 a litre last time.") }, { wait: 300 }, { click: 'css:[role="dialog"] button[type="submit"]' }, { wait: 1800 }, TOP] }),
  // 7 Peter sees why (read only), and the bell tells him too
  D("pu-returned", BUY, { url: R7URL, h: 1250, steps: [TOP], marks: [[1, "Finance sent the last quotation back", { self: true }], [2, "Total", { self: true, at: "l", dx: -4 }], [3, "Add a quotation"]] }),
  D("pu-bell", BUY, { url: PRO, h: 700, steps: [{ click: 'css:button[title="What is waiting for you"]' }, { wait: 900 }], marks: [[1, "get quotations for", { self: true, at: "l" }], [2, "Finance sent", { self: true, at: "l" }]] }),
  // 8 the second quotation, cheaper and inside the budget (saves) — the two side by side
  D("pu-x-r7-quote-b", BUY, { url: R7URL, h: 1500, steps: [{ click: "Add a quotation" }, { wait: 500 }, ...QB, { click: "Record the quotation" }, { wait: 1800 }, TOP], marks: [[1, "Supplier quotations", L], [2, "lowest"], [3, "document", { self: true, at: "t" }], [4, "Budget TZS 260,000", L], [5, "Propose this one##2"], [6, "Finance must authorize"]] }),
  // (the same page again, read only, with the marks placed better — taken before the next step)
  D("pu-quotes", BUY, { url: R7URL, h: 1450, steps: [TOP], marks: [[1, "Supplier quotations", L], [2, "lowest", { self: true, at: "b", dx: -110 }], [3, "document", { self: true, at: "l" }], [4, "Budget TZS 260,000", L], [5, "Propose this one##2"], [6, "Finance must authorize", { self: true, at: "l" }]] }),
  // 9 Peter proposes the cheaper one: it is inside the budget, so it can be ordered at once (saves) — the picture is the tab "Ready to order"
  D("pu-x-r7-ready", BUY, { url: R7URL, h: 900, clip: ["css:h1", "css:table"], pad: 18, steps: [{ click: "Propose this one##2" }, { wait: 1800 }, { goto: PRO + "?tab=order" }, { wait: 800 }, TOP], marks: [[1, "Ready to order"], [2, R7NUM, { self: true, at: "t" }], [3, "Price authorized — ready to order", { self: true, at: "t" }]] }),
  // 10 the purchase order (saves) — the picture is the tab "On order"
  D("pu-x-r7-order", BUY, { url: R7URL, h: 900, clip: ["css:h1", "css:table"], pad: 18, steps: [{ click: "Issue the purchase order" }, { wait: 500 }, { click: "Issue the order" }, { wait: 1800 }, { goto: PRO + "?tab=delivery" }, { wait: 800 }, TOP], marks: [[1, "On order"], [2, "PO-2026-", { self: true, at: "t" }], [3, "due", { self: true, at: "t" }]] }),
  // (the tab again, read only, with the marks placed better — taken before the next step)
  D("pu-tab-delivery", BUY, { url: PRO + "?tab=delivery", h: 900, scroll: "top", clip: ["css:h1", "css:table"], pad: 18, below: 14, marks: [[1, "On order"], [2, "PO-2026-", { self: true, at: "t" }], [3, "due", { self: true, at: "b", dx: -30 }]] }),
  // 11 24 of the 40 litres arrive (saves): 24 litres go into the store
  D("pu-x-r7-delivery", BUY, { url: R7URL, h: 1700, steps: [{ click: "Record a delivery" }, { wait: 500 }, { js: fill("input#d-q-0", 24) }, { wait: 300 }, { click: "Record the delivery" }, { wait: 1800 }, TOP], marks: [[1, "Partly delivered", { self: true, at: "t" }], [2, "In stock now"], [3, "in stock", { self: true, at: "r" }], [4, "Record a delivery"], [5, "Close — the rest is not coming"]] }),
  // (the page again, read only, with the marks on the right things)
  D("pu-delivery-part", BUY, { url: R7URL, h: 1385, steps: [TOP], marks: [[1, "Partly delivered", { self: true, at: "t" }], [2, "28 l", { self: true, at: "r" }], [3, "· in stock", { self: true, at: "r" }], [4, "Record a delivery"], [5, "Close — the rest is not coming"]] }),
  // 12 what the kitchen sees of it (read only)
  TB("pu-asker-order", CHEF, { url: REQ, h: 1100, steps: [{ click: "Requests" }, { click: R7NUM }, { wait: 800 }], clip: ["Part of the order has arrived", "What is missing, damaged or wrong", "Print or save the list"], pad: 34, marks: [[1, "Part of the order has arrived", { self: true, at: "l" }], [2, "The order", { self: true, at: "l" }], [3, "24 of 40 litres arrived", { self: true, at: "t" }], [4, "It is all right"]] }),
  // 13 the rest will not come (the dialog is a read-only picture; the next one saves)
  D("pu-closeshort", BUY, { url: R7URL, h: 1000, clip: ['css:[role="dialog"]'], pad: 26, steps: [{ click: "Close — the rest is not coming" }, { wait: 500 }, { js: fill('[role="dialog"] textarea', "The supplier has no more oil this month. The other 16 litres will not come.") }, { wait: 300 }], marks: [[1, 'css:[role="dialog"] textarea', L], [2, 'css:[role="dialog"] button[type="submit"]']] }),
  D("pu-x-r7-close", BUY, { url: R7URL, h: 1700, steps: [{ click: "Close — the rest is not coming" }, { wait: 500 }, { js: fill('[role="dialog"] textarea', "The supplier has no more oil this month. The other 16 litres will not come.") }, { wait: 300 }, { click: 'css:[role="dialog"] button[type="submit"]' }, { wait: 1800 }, TOP], marks: [[1, "Delivered — invoice and payment to finish", { self: true, at: "t" }], [2, "Delivered", { up: 1 }], [3, "Record an invoice"]] }),
  // 14 the supplier's invoice with its paper (the form is a read-only picture; the next one saves)
  D("pu-invoice-form", BUY, { url: R7URL, h: 1100, clip: ['css:[role="dialog"]'], pad: 34, steps: [{ click: "Record an invoice" }, { wait: 500 }, ...INV], marks: [[1, "Invoice number", L], [2, "Amount (TZS)", L], [3, "Invoice date", L], [4, "Due on", L], [5, "The invoice (photo or PDF)", L], [6, "Record the invoice"]] }),
  D("pu-x-r7-invoice", BUY, { url: R7URL, h: 1700, steps: [{ click: "Record an invoice" }, { wait: 500 }, ...INV, { click: "Record the invoice" }, { wait: 1800 }, TOP, { js: MORE }, { wait: 300 }], marks: [[1, "To verify", { self: true, at: "t" }], [2, "Invoices and payment", L], [3, "document", { self: true, at: "t" }], [4, "Cancel invoice"]] }),
  // (the invoice and its paper, read only: the invoice line, then the Documents)
  D("pu-invoiced", BUY, { url: R7URL, h: 1700, steps: [TOP], clip: ["css:main section##5", "css:main section##6"], pad: 44, marks: [[1, "To verify", { self: true, at: "t" }], [2, "MOT-0541 · TZS 153,600", { self: true, at: "l" }], [3, "Invoice · MOT-0541", { self: true, at: "l" }], [4, "Cancel invoice"]] }),
  D("pu-tab-invoices", BUY, { url: PRO + "?tab=invoices", h: 900, scroll: "top", clip: ["css:h1", "css:table"], pad: 18, marks: [[1, "Invoices and payment"], [2, "1 invoice to verify", { self: true, at: "b", dx: 40 }], [3, "no invoice yet", { self: true, at: "b", dx: 40 }], [4, "an invoice is disputed", { self: true, at: "b", dx: 40 }]] }),
];

// no picture names given = nothing is taken (a careless run would ask, approve, order and invoice everything a second time)
export const SHOTS = process.argv.slice(2).some((a) => !a.startsWith("--")) ? ALL : [];
