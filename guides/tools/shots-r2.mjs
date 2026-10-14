// Reception book, edition 2 (prefix "r2-"): the pictures that changed since the first edition.
// Most are only looks at a page or a window (nothing is saved). The purchase-request pictures at the end SAVE one practice request
// of their own (Reception asks, Finance sends it back, Reception cancels it) — run those ONE BY ONE and only once each:
//   node guides/tools/shoot.mjs --list=shots-r2 r2-pr-send
// "r2-x-" pictures are only for looking — they are not used in the book.
const L = { at: "l" };
const NEEMA = "neema@vegas.test";
const FIN = "accountant@vegas.test";
const D = (id, as, spec) => ({ id, as, view: "desk", ...spec });
const DLG = "css:[role=dialog]";
// typed the way a person does it (the page hears the change)
const fill = (css, value, nth = 1) => `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(css)})][${nth - 1}];if(!e)return;const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`;
const REQ = "/staff/stock-requests";

export const SHOTS = [
  // the home page, now with the two menu names marked
  D("r2-home-n", NEEMA, { url: "/reception/dashboard", h: 980, marks: [[1, "New booking"], [2, "css:a[href$='/check-in']##2"], [3, "css:a[href$='/check-out']##2"], [4, "Guest request"], [5, "On shift"], [6, "Print Housekeeping Checklist"], [7, "NEEDS YOUR ATTENTION", L], [8, 'css:a[href="/staff/requests"]', L], [9, 'css:a[href="/staff/stock-requests"]', L]] }),
  // the guests' requests (the menu says Guest requests)
  D("r2-req-1", NEEMA, { url: "/staff/requests", h: 1000, marks: [[1, "Log a request"], [2, "Accept"], [3, "Hand it to…"]] }),
  // Collect, from the home page: the guest's phone first, then the other ways
  D("r2-collect-a", NEEMA, { url: "/reception/dashboard", h: 980, steps: [{ click: "Collect" }, { wait: 900 }], clip: [DLG], pad: 6, marks: [[1, "Customer's phone"], [2, 'css:input[aria-label="Customer\'s phone number"]'], [3, "Send prompt to their phone"]] }),
  D("r2-collect-b", NEEMA, { url: "/reception/dashboard", h: 980, steps: [{ click: "Collect" }, { wait: 900 }, { click: "Cash" }, { wait: 700 }], clip: [DLG], pad: 6, marks: [[1, "Cash"], [2, 'css:input[name="amount"]'], [3, 'css:input[name="reference"]'], [4, "Save payment"]] }),
  // a new walk-in booking: the payment card
  D("r2-new-pay", NEEMA, { url: "/staff/reservations/new", h: 1900, steps: [{ click: "401" }, { js: fill("#g-name", "Lucy Mwangi") }, { js: fill("#g-phone", "0700 900 123") }, { wait: 700 }], clip: ["Payment type", "Payment first"], pad: 18, marks: [[1, "Pay now"], [2, "Pay on the customer's phone"], [3, "OTHER PAYMENT METHODS", L], [4, 'css:input[aria-label="Amount to request"]'], [5, "Send prompt · TZS 60,000"]] }),
  // Collections: this shift and the shifts before it (the last shift, with its payments)
  D("r2-colls", NEEMA, { url: "/staff/collections", h: 920, steps: [{ click: "Last shift" }, { wait: 900 }], marks: [[1, "LAST SHIFT"], [2, "YOU COLLECTED", L], [3, "INTO WHICH ACCOUNT", L], [4, "HOW IT WAS PAID", L]] }),
  // check-in: the stay and the room, then the guest's details, the payment and the button
  D("r2-in-2a", NEEMA, { url: "/staff/check-in", h: 1700, steps: [{ click: "Nino Chuwa" }, { wait: 900 }], clip: ["Nino Chuwa", "STAY & ROOM", "Give discount"], pad: 30, marks: [[1, "STAY & ROOM"], [2, "+1 night"], [3, "Booked · Ready"], [4, "Give discount"]] }),
  D("r2-in-2b", NEEMA, { url: "/staff/check-in", h: 1700, steps: [{ click: "Nino Chuwa" }, { wait: 900 }], clip: ["GUEST DETAILS", "css:article footer button"], pad: 22, marks: [[5, "GUEST DETAILS"], [6, "Customer's phone"], [7, "css:article footer button"]] }),
  // check-out: "Record payment" in the Account opens the same row
  D("r2-out-pay", NEEMA, { url: "/staff/check-out", h: 1700, steps: [{ click: "Halima Omar" }, { wait: 900 }, { click: "Record payment" }, { wait: 900 }], clip: ["ACCOUNT", "Record payment", "Send prompt to their phone"], pad: 24, marks: [[1, "Record payment"], [2, "Customer's phone"], [3, "Send prompt to their phone"]] }),

  // ── the one practice purchase request of this book (Reception's own): ask → Finance sends it back → look → cancel ──
  // 1. Reception asks for tables and chairs (SAVES)
  D("r2-x-pr-send", NEEMA, { url: REQ, h: 1500, steps: [
    { click: "Furniture & equipment" }, { click: "Tables by pcs" }, { click: "Chairs by pcs" },
    { js: fill('input[aria-label="How many"]', 8, 1) }, { js: fill('input[aria-label="How many"]', 4, 2) },
    { js: fill('input[placeholder^="What is it for"]', "Tables and chairs for the lobby meeting corner") },
    { js: fill('input[aria-label="Estimated cost (TZS)"]', "600000") },
    { wait: 300 }, { click: "Check the list" }, { wait: 700 }, { click: "Send 2 items to Finance" }, { wait: 1800 }] }),
  // 2. Finance sends it back with a note (SAVES)
  D("r2-x-pr-back", FIN, { url: REQ, h: 1100, steps: [
    { click: "Chairs 8 pcs" }, { wait: 800 }, { click: "Send back" }, { wait: 300 },
    { js: fill('input[placeholder^="What should they change"]', "Say how many people the lobby corner should seat.") }, { wait: 300 },
    { click: "Send back" }, { wait: 1600 }] }),
  // 3. Reception opens it (only looks)
  D("r2-pr-back", NEEMA, { url: REQ, h: 1300, steps: [{ click: "Chairs 8 pcs" }, { wait: 900 }, { js: "[...document.querySelectorAll('[role=dialog] *')].filter((e)=>e.children.length===0&&e.textContent.trim()==='More information needed').forEach((e)=>e.setAttribute('data-g','status'))" }], clip: [DLG], pad: 6, marks: [[1, "css:[data-g=status]", { self: true, at: "r" }], [2, "Sent back to you"], [3, "Change and send again"], [4, "Cancel request"]] }),
  // 4. Reception cancels this practice request (SAVES)
  D("r2-x-pr-cancel", NEEMA, { url: REQ, h: 1300, steps: [
    { click: "Chairs 8 pcs" }, { wait: 800 }, { click: "Cancel request" }, { wait: 300 },
    { js: fill('input[placeholder^="Why?"]', "Practice request for the guide book") }, { wait: 300 },
    { click: "Cancel request" }, { wait: 1600 }] }),
];
