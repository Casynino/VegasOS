// Checking pass, books 02 03 04 05 06 10 (prefix "ck3-"): pictures of screens that changed after the first pictures were taken.
// Nothing here saves anything: pages are opened, a window is opened, an order is only filled in on the screen — never sent, never paid.
//   node guides/tools/shoot.mjs --list=shots-ck3 ck3-
// "ck3-x-" pictures are whole screens that are cut afterwards (see crops-ck3.py); the rest are used as they are.
const L = { at: "l" };
const JUMA = "juma@vegas.test";
const CTR = "counter@vegas.test";
const ASHA = "asha@vegas.test";
const W = "/staff/restaurant";
import fs from "node:fs";
const TK = JSON.parse(fs.readFileSync(new URL("./tokens.json", import.meta.url), "utf8"));
const P = (id, as, spec) => ({ id, as, view: "phone", ...spec });
const T = (id, as, spec) => ({ id, as, view: "tablet", ...spec });

export const SHOTS = [
  // the waiter's menu (it changed: the order of the pages)
  P("ck3-w-menu", JUMA, { url: W, steps: [{ click: "Menu" }, { wait: 600 }] }),
  // the Counter's window "Take payment": the customer's phone comes first
  T("ck3-x-pay", CTR, { url: W, h: 1060, steps: [{ click: "Take payment" }, { wait: 900 }], clip: ["css:[role=dialog]"], pad: 20,
    marks: [[1, "Customer's phone"], [2, 'css:input[aria-label="Customer\'s phone number"]'], [3, "Send prompt to their phone"]] }),
  T("ck3-x-pay-cash", CTR, { url: W, h: 1060, steps: [{ click: "Take payment" }, { wait: 900 }, { click: "Cash" }, { wait: 700 }], clip: ["css:[role=dialog]"], pad: 20,
    marks: [[1, "Cash"], [2, "Brought by"], [3, "Mark as paid"]] }),
  // Sell at the Counter: two dishes on the order, the payment block as it is now
  T("ck3-x-sell", CTR, { url: W + "/pos", h: 1700, steps: [{ click: "Chapati & Eggs" }, { click: "Tea/Coffee" }],
    marks: [[1, "WAITER", L], [2, "ORDER DETAILS", L], [3, "Note for the kitchen", L], [4, "PAYMENT", L], [5, "Pay on the customer's phone"], [6, "Other payment methods", L]] }),
  // Reception's Rooms page: the occupied tiles say the bill in coloured words (cut afterwards)
  { id: "ck3-x-rooms", as: ASHA, view: "desk", h: 980, url: "/staff/rooms", marks: [[1, "Available"], [2, "Occupied"], [3, "Needs cleaning"], [4, "Room QR codes"]] },
  // the guest's room page, tall enough to show every request in the list (Something else is the last one)
  { id: "ck3-g-room-2", view: "phone", url: `/r/${TK.room203}`, h: 1350, scroll: "Ask here and reception takes care of it.", marks: [[1, "Late check-out", L], [2, "Cleaning", L], [3, "Something else", L]] },
  // the Counter opens a table (only looks; nothing is pressed inside it)
  T("ck3-x-table", CTR, { url: W + "/tables", h: 1500, steps: [{ click: "Daudi M." }, { wait: 1200 }], clip: ["css:[role=dialog]"], pad: 24,
    marks: [[1, "Add person"], [2, "Transfer table"], [3, "Add order"], [4, "Bill"], [5, "Move"], [6, "Clear table"]] }),
  // the website's pages, taken again (the practice copy now offers Pay now): only looks
  { id: "ck3-web-meeting", view: "desk", h: 860, url: "/meeting-room" },
  { id: "ck3-web-menu", view: "desk", h: 860, url: "/menu" },
];
