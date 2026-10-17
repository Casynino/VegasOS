// Checker 2 (Manager 07 and Reception 01 books): new pictures that show the CURRENT screens — the room tiles that now say Paid / Not paid,
// and the pages that still showed the old menu name "Requests" (it is now "Guest requests"; "Purchase requests" sits under it).
// Prefix "ck2-". Every picture only opens a page or a window: NOTHING here saves anything.
//   node guides/tools/shoot.mjs --list=shots-ck2 ck2-
import { SHOTS as MGR } from "./mgr.mjs";

const M = "manager@vegas.test";
const N = "neema@vegas.test";
const L = { at: "l" };
const R = { at: "r" };
const D = (id, as, spec) => ({ id, as, view: "desk", ...spec });

// The Manager pictures that were taken with the list mgr.mjs: the same pictures again, with the same marks, under a new name.
const FROM_MGR = ["m4-room-occ", "m4-rest", "m4-coll", "m4-owes", "m4-assets", "m4-shifts", "m4-shifts-all", "m4-staffrep", "m4-activity", "m4-stays", "m4-online", "m4-cal", "m4-inv", "m4-dailyrep", "m3-rest-tables", "m4-fin", "m4-daily"];
const again = MGR.filter((s) => FROM_MGR.includes(s.id)).map((s) => ({ ...s, id: "ck2-" + s.id, ...(s.id === "m4-room-occ" && { marks: [...s.marks, [6, "Balance", { up: 1 }]] }) }));

// typed the way a person does it (the page hears the change)
const fill = (css, value, nth = 1) => `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(css)})][${nth - 1}];if(!e)return;const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`;
// puts a name on a part of the page so that a picture can be cut round it
const tag = (name, js) => ({ js: `(()=>{const e=(${js});if(e)e.setAttribute('data-g',${JSON.stringify(name)});})()` });

export const SHOTS = [
  ...again,

  // ── the room tiles: Paid / Not paid ──
  // the Manager's Rooms page; 5 = a bill still owed, 6 = a bill paid
  D("ck2-m4-rooms", M, { url: "/staff/rooms", marks: [[1, "Needs cleaning"], [2, "overdue checkouts"], [3, "202", L], [4, "Room QR codes"], [5, "Not paid##1", { at: "r", dx: -30, self: true, pad: 3 }], [6, "Paid##1", { at: "r", dx: -30, self: true, pad: 3 }]] }),
  // "Every room right now" on the Manager's Home, cut out
  D("ck2-m-rooms", M, { url: "/manager/dashboard", full: true, max: 12000, steps: [{ wait: 3000 }, tag("board", "[...document.querySelectorAll('h2,h3')].find((h)=>/Every room right now/.test(h.textContent))?.closest('section')")], clip: "css:[data-g=board]", pad: 10, marks: [[1, "Not paid##1", { at: "r", dx: -30, self: true, pad: 3 }], [2, "Paid##1", { at: "r", dx: -30, self: true, pad: 3 }], [3, "Overdue · 11:00##2", { at: "r", self: true, pad: 3 }]] }),
  // Reception's Rooms page and the window of an occupied room
  D("ck2-r-rooms", N, { url: "/staff/rooms", h: 980, marks: [[1, "206"], [2, "101"], [3, "105"], [4, "Room QR codes"], [5, "Not paid##1", { at: "r", dx: -30, self: true, pad: 3 }], [6, "Paid##1", { at: "r", dx: -30, self: true, pad: 3 }]] }),
  D("ck2-r-room-dialog", N, { url: "/staff/rooms", h: 1100, steps: [{ click: "203" }, { wait: 800 }], clip: "css:[role=dialog]", pad: 8, marks: [[1, "Check out"], [2, "Add nights"], [3, "Receive payment"], [4, "Restaurant order"], [5, "Change room"], [6, "Room QR code"], [7, "Balance", { up: 1 }]] }),

  // a room whose guest has not paid: the Balance is the amount (Manager and Reception see the same panel)
  D("ck2-m4-room-owes", M, { url: "/staff/rooms", h: 1100, steps: [{ click: "101" }, { wait: 900 }], clip: ["Ahmed Said", "of the stay done"], pad: 14, marks: [[1, "Balance", { up: 1 }]] }),
  // History: the last 30 days, so that lines with Receipt and Steps are on the page
  D("ck2-m3-rest-history", M, { url: "/staff/restaurant/history", steps: [{ click: "Last 30 days" }, { wait: 1500 }] }),
  // Income: this month, so that lines with Edit and Reverse are on the page
  D("ck2-m4-income", M, { url: "/staff/payments", h: 1150, steps: [{ click: "This month" }, { wait: 1500 }], marks: [[1, "Record payment"], [2, "Edit##1"], [3, "Reverse##1"]] }),
  // ── the Manager's other pictures without a list ──
  D("ck2-m-ledger", M, { url: "/staff/finance/ledger", marks: [[1, "Export CSV"]] }),
  D("ck2-m-reports", M, { url: "/staff/reports", marks: [[1, "Print"], [2, "PDF"], [3, "Share"]] }),

  // ── Reception (Neema; her shift is open) ──
  D("ck2-r-home-2", N, { url: "/reception/dashboard", h: 980, scroll: "Shift handover", marks: [[1, "GUESTS OWING", L], [2, "Shift handover"], [3, "Collect##1"], [4, "View##1"]] }),
  D("ck2-r-new-1", N, { url: "/staff/reservations/new", h: 900, marks: [[1, "Walk-in now"], [2, "Reserve for later"], [3, "Short time"], [4, "Meeting room"], [5, "Group booking"], [6, "How did they book?", L]] }),
  D("ck2-r-new-2", N, { url: "/staff/reservations/new", h: 1000, full: true, max: 4200, steps: [{ click: "401" }, { wait: 600 }], marks: [[1, "Room 401", { at: "l" }]] }),
  D("ck2-r-new-3", N, { url: "/staff/reservations/new", h: 1000, full: true, max: 4200, steps: [{ click: "401" }, { js: fill("#g-name", "Lucy Mwangi") }, { js: fill("#g-phone", "0700 900 123") }, { wait: 700 }], marks: [[1, "css:#g-name", { at: "l" }], [2, "css:#g-phone", { at: "l" }]] }),
  D("ck2-r-stays", N, { url: "/staff/reservations", h: 780 }),
  D("ck2-r-cal", N, { url: "/staff/reservations/calendar", h: 900 }),
  D("ck2-r-meet", N, { url: "/staff/meeting-room", h: 900, marks: [[1, "New meeting booking"]] }),
  D("ck2-r-hotelqr", N, { url: "/staff/hotel-qr", h: 900, marks: [[1, "Show to guest"], [2, "Print"]] }),
  D("ck2-r-online-1", N, { url: "/staff/booking-requests", h: 860, marks: [[1, "Log WhatsApp / phone request"], [2, "Joseph Mrema", { up: 1 }]] }),
  D("ck2-r-online-2", N, { url: "/staff/booking-requests", h: 1250, steps: [{ click: "Joseph Mrema" }, { wait: 1000 }], marks: [[1, "Mark reviewing"], [2, "Customer agreed"], [3, "Reject"]] }),
  D("ck2-r-online-4", N, { url: "/staff/booking-requests", h: 1250, steps: [{ click: "Joseph Mrema" }, { wait: 1000 }], scroll: "Confirm & create reservation", marks: [[1, "Confirm & make the reservation"], [2, "Confirm & create reservation"]] }),
  D("ck2-r-in-1", N, { url: "/staff/check-in", h: 860, steps: [{ click: "Nino Chuwa" }, { wait: 900 }], marks: [[1, 'css:input[placeholder^="Name, phone"]'], [2, "Walk-in (no booking)"], [3, "ARRIVING TODAY", L], [4, "Nino Chuwa", { up: 1 }]] }),
  D("ck2-r-lists-1", N, { url: "/staff/lists/housekeeping", h: 900, marks: [[1, "Housekeeping Checklist"], [2, "In-House Guest & Breakfast List"], [3, "Print##1"], [4, "Start cleaning##1"], [5, "Clean & ready##1"]] }),
  D("ck2-r-trn-1", N, { url: "/staff/transport", h: 760, marks: [[1, "New request"], [2, "Pending"], [3, "Confirm##1"]] }),
  D("ck2-r-rest-sell", N, { url: "/staff/restaurant/pos", h: 860 }),
  D("ck2-r-rest-live", N, { url: "/staff/restaurant", h: 860 }),
  D("ck2-r-companies", N, { url: "/staff/corporate", h: 700 }),
  D("ck2-r-customers", N, { url: "/staff/guests", h: 760 }),
  D("ck2-r-myshift", N, { url: "/staff/shifts/me", h: 900 }),
  D("ck2-r-end-3", N, { url: "/staff/shifts/cmv58ou6d0000eksbb2fng3tp", h: 900 }),
  D("ck2-r-end-4", N, { url: "/staff/reports/staff", h: 900 }),
  D("ck2-r-out-6", N, { url: "/staff/check-out?done=cmv58ej6200395xsbelau7ah6", h: 860, marks: [[1, "View thank-you note"], [2, "Send to guest"], [3, "Next guest"]] }),
  D("ck2-r-addnights", N, { url: "/staff/rooms", h: 1100, steps: [{ click: "203" }, { wait: 800 }, { click: "Add nights" }, { wait: 900 }, { click: "+2 nights" }, { wait: 1200 }] }),
  D("ck2-r-changeroom", N, { url: "/staff/rooms", h: 1100, steps: [{ click: "203" }, { wait: 800 }, { click: "Change room" }, { wait: 900 }, { click: "AC problem" }, { click: "Room 401" }, { wait: 1200 }] }),
  D("ck2-r-new-2s", N, { url: "/staff/reservations/new", h: 820, steps: [{ click: "401" }, { wait: 600 }], scroll: "Standard Single", marks: [[1, "Room 401", { at: "l" }]] }),
  // booking kinds that the book only named
  D("ck2-r-later", N, { url: "/staff/reservations/new", h: 1000, steps: [{ click: "Reserve for later" }, { wait: 900 }], marks: [[1, "Reserve for later"], [2, "Dates"], [3, "How did they book?", L], [4, "Save reservation"]] }),
  D("ck2-r-short", N, { url: "/staff/reservations/new", h: 1000, steps: [{ click: "Short time" }, { wait: 900 }], marks: [[1, "Short time"], [2, "Guest is here — start now"], [3, "3h"], [4, "Check in now"]] }),
  D("ck2-r-groups", N, { url: "/staff/groups", h: 860 }),
  D("ck2-r-grp-new", N, { url: "/staff/groups/new", h: 1400, full: true, max: 3400, marks: [[1, "Company##1", { at: "l" }], [2, "Company name — the invoice is made out to it", L], [3, "Book rooms for the group"], [4, "Members & dates", L], [5, "Add member"], [6, "204"], [7, "One invoice for the group"]] }),
  D("ck2-r-gate", "rehema@vegas.test", { url: "/reception/dashboard", h: 900 }),
  D("ck2-r2-home-n", N, { url: "/reception/dashboard", h: 980, steps: [tag("sw", "[...document.querySelectorAll('button,[role=switch],a,div')].filter((e)=>/^On shift/.test(e.innerText||'')&&e.getBoundingClientRect().top>150&&e.getBoundingClientRect().height<80).sort((a,b)=>a.getBoundingClientRect().width-b.getBoundingClientRect().width)[0]")], marks: [[1, "New booking"], [2, "css:a[href$='/check-in']##2"], [3, "css:a[href$='/check-out']##2"], [4, "Guest request"], [5, "css:[data-g=sw]", { self: true }], [6, "Print Housekeeping Checklist"], [7, "NEEDS YOUR ATTENTION", L], [8, 'css:a[href="/staff/requests"]', L], [9, 'css:a[href="/staff/stock-requests"]', L]] }),
];
