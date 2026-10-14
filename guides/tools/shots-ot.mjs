// Pictures for the books 02 Waiters, 06 Driver and 10 Guests and Website (prefix "ot-"), taken after the hotel's online payment (mobile money) came on.
// Nearly all of them only show a page: nothing is sent or saved.   node guides/tools/shoot.mjs --list=shots-ot ot-q ot-t ot-g ot-w ot-b-3
// ot-b-4 saved ONE website booking in the practice copy (pay later, 1 December) when it was first taken; it only shows that page now.
import fs from "node:fs";

const T = JSON.parse(fs.readFileSync(new URL("./tokens.json", import.meta.url), "utf8"));
const L = { at: "l" };
const P = (id, spec) => ({ id, view: "phone", ...spec });
const D = (id, url, spec = {}) => ({ id, view: "desk", h: 860, url, ...spec });
/** The page of an older picture (a private link already in the practice copy). */
const old = (id) => JSON.parse(fs.readFileSync(new URL(`../shots/${id}.txt`, import.meta.url), "utf8")).url;

// ── the guest orders at Table 3 (the same customer, found again by phone) and gets to the payment ──
const TO_CHECKOUT = [
  { click: "Add Samaki Choma" },
  { click: "Phone number", type: "0715884210" }, { click: "Your name", type: "Joyce Mwakyusa" }, { click: "Continue" }, { wait: 700 },
  { click: "Add Kilimanjaro" }, { click: "css:button[aria-label^='Your order']" }, { wait: 900 },
];

// ── the website booking: a night in December, the number of a customer the practice copy already knows ──
const BOOK = "/book?checkIn=2026-12-01&checkOut=2026-12-02&adults=2&children=0&type=double-deluxe&rooms=1";
const FILL_BOOKING = [{ click: "css:input[name=phone]", type: "0744556677" }, { wait: 1200 }];

export const SHOTS = [
  // 10 Guests — at the table
  P("ot-q-order-4", { url: `/t/${T.table3}`, h: 1060, steps: TO_CHECKOUT, marks: [
    [1, "Pay now", L], [2, "css:input[type=tel]", { self: true, at: "t" }], [3, "Add to my bill", L], [4, "No onions"], [5, "Pay TZS 24,000 now"],
  ] }),
  P("ot-t-q-7", { url: old("t-q-7"), h: 1250 }),
  // 10 Guests — in the room
  P("ot-g-room-1", { url: `/r/${T.room203}`, h: 900, marks: [[1, "Order food & drinks"], [2, "Wi-Fi"], [3, "Reception"], [4, "Full bill"], [5, "Pay TZS 21,500 now"]] }),
  P("ot-g-cover", { url: `/r/${T.room203}`, h: 844 }),
  P("ot-g-stay", { url: old("t-g-stay"), h: 900, scroll: "Your orders" }),
  P("ot-g-roombill", { url: old("t-g-roombill"), h: 844 }),
  // 10 Guests — the website: step 3 (nothing is sent) and step 4 (saves one booking, once)
  D("ot-b-3", BOOK, { steps: FILL_BOOKING, clip: ["Phone / WhatsApp", "css:form button[type=submit]"], pad: 44, below: 34, marks: [
    [1, "css:input[name=phone]", { self: true, at: "l" }], [2, "Pay now", L], [3, "Pay later", L], [4, "css:form button[type=submit]", { self: true, at: "l" }],
  ] }),
  // ot-b-4 was made ONCE with the steps below (a "pay later" booking, VLH-TVPGSE, for 1 Dec). It is now taken again from its own page — nothing is saved. Do not run the steps again.
  //   D("ot-b-4", BOOK, { h: 1150, steps: [...FILL_BOOKING, { click: "Pay later" }, { click: "Book — pay later", then: 4500 }] }),
  D("ot-b-4", "/", { url: old("ot-b-4"), h: 1290 }),
  // 02 Waiters — what the Counter does with the payment (the Counter's own screen)
  { id: "ot-w-pay", as: "counter@vegas.test", view: "tablet", h: 1060, url: "/staff/restaurant", steps: [{ wait: 800 }, { click: "Take payment##2" }, { wait: 700 }, { click: "Cash" }, { wait: 700 }],
    marks: [[1, "Customer's phone"], [2, "Cash"], [3, "css:select", { self: true, at: "l" }], [4, "Mark as paid"]] },
];
