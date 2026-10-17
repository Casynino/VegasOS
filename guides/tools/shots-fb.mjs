// Finance book, second half (prefix "fb-"): Withdraw funds (as Finance), and a few extra purchase pictures.
// Many of these SAVE something (the opening balance, a withdrawal). They are run ONCE, by name, in the order of the flow:
//   node guides/tools/shoot.mjs --list=shots-fb fb-w-form          (only opens dialogs — safe to repeat)
//   node guides/tools/shoot.mjs --list=shots-fb fb-x-opening        (saves — once)
// The practice nTZS is a pretend one on this computer (guides/tools/mock-ntzs.mjs).
const L = { at: "l" };
const R = { at: "r" };
const T = { at: "t" };
const FIN = "accountant@vegas.test";
const BOSS = "owner@vegas.test";

const fill = (css, value, nth = 1) => `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(css)})][${nth - 1}];if(!e)return;const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`;
const pick = (words, css = "select") => `(()=>{const s=[...document.querySelectorAll(${JSON.stringify(css)})].find(x=>[...x.options].some(o=>o.text.includes(${JSON.stringify(words)})));if(!s)return;const o=[...s.options].find(o=>o.text.includes(${JSON.stringify(words)}));const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,o.value);s.dispatchEvent(new Event('change',{bubbles:true}));})()`;
// press a button by its words, inside the open window (or, with dialog = false, on the page)
const press = (re, dialog = true) => ({ js: `[...document.querySelectorAll(${JSON.stringify(dialog ? "[role=dialog] button" : "button")})].find((b)=>${re}.test(b.innerText.trim()))?.click()` });

const W = "/staff/finance/withdraw";
const NTZS = "/staff/finance/accounts/acct_ntzs";
const OPEN = press(/^Withdraw funds$/, false);
const DLG = "css:[role=dialog]";

// ── the three ways, filled in (practice numbers only) ──
const PHONE = [OPEN, { wait: 900 }, press(/^(Another )?phone number$/i), { wait: 300 }, { js: fill("input#wd-amount", 5000) }, { js: fill("input#wd-phone", "0712 345 678") }, { js: pick("The owner takes it out", "select#wd-books") }, { wait: 300 }];
const LIPA = [OPEN, { wait: 900 }, press(/^Lipa number$/i), { wait: 300 }, { js: fill("input#wd-amount", 1000) }, { js: fill("input#wd-lipa", "4510987") }, { js: pick("The owner takes it out", "select#wd-books") }, { wait: 300 }];
const BANK = [OPEN, { wait: 900 }, press(/^Bank account$/i), { wait: 300 }, { js: fill("input#wd-amount", 20000) }, { js: pick("CRDB Bank", 'select[aria-label="Bank"]') }, { js: fill('input[aria-label="Account number"]', "0150987654321") }, { js: pick("CRDB Bank", "select#wd-books") }, { wait: 300 }];
const TICK = { click: "I checked the name, the number and the amount." };
const SEE = { click: "See the price", then: 2600 };
// the strip of the form: "Send to", the three buttons and what is typed under them
const STRIP = ["css:[role=dialog] div.grid-cols-3"];
const AGAIN = [`css:[role=dialog] label##2`, "css:[role=dialog] div.grid-cols-3"];

const D = (id, as, spec) => ({ id, as, view: "desk", ...spec });
const WD = (id, as, spec) => ({ id, as, view: "wide", ...spec });

export const SHOTS = [
  // set-up: the opening balance of the nTZS account (Boss) — the pretend nTZS holds TZS 2,450,000. SAVES — run once, only when the account still has none.
  D("fb-x-opening", BOSS, { url: NTZS, h: 900, steps: [press(/^Opening balance$/, false), { wait: 700 }, { js: fill("input#ob-acct_ntzs", 2450000) }, { js: fill("textarea#obr-acct_ntzs", "Money in the nTZS wallet when the hotel's books began (practice copy)") }, { wait: 300 }, press(/^Save the opening balance$/), { wait: 2200 }] }),

  // ── the page, the form ──
  WD("fb-w-form-phone", FIN, {
    url: W, h: 1100, steps: PHONE, clip: DLG, pad: 40,
    marks: [[1, "css:input#wd-amount", L], [2, "css:[role=dialog] strong##1", R], [3, "css:[role=dialog] div.grid-cols-3", L], [4, "css:input#wd-phone", L], [5, "css:select#wd-books", L], [6, "See the price"]],
  }),
  WD("fb-w-way-phone", FIN, { url: W, h: 1100, steps: PHONE, clip: STRIP, pad: 10, below: 44 }),
  WD("fb-w-way-lipa", FIN, { url: W, h: 1100, steps: LIPA, clip: STRIP, pad: 10, below: 80 }),
  WD("fb-w-way-bank", FIN, { url: W, h: 1100, steps: BANK, clip: [...STRIP, 'css:input[aria-label="Account number"]'], pad: 10 }),
  // the places paid before, listed above the three buttons (only after the first withdrawal)
  WD("fb-w-again", FIN, { url: W, h: 1100, steps: PHONE, clip: AGAIN, pad: 10 }),

  // ── the price and the check (a price only — nothing is sent; leaving it unticked) ──
  WD("fb-w-check-lipa", FIN, {
    url: W, h: 1250, steps: [...LIPA, SEE], clip: DLG, pad: 40,
    marks: [[1, "MAMA NTILIE SHOP", R], [2, "4510987", R], [3, "The recipient gets", L], [4, "nTZS's fee", { up: 1, at: "l", pad: 1 }], [5, "Leaves the nTZS balance", { up: 1, at: "l", pad: 1 }], [6, "In the hotel's books", { up: 1, at: "l", pad: 1 }], [7, "This price holds for", { up: 1, at: "l" }], [8, "I checked the name, the number and the amount.", { up: 1, at: "l" }], [9, "Send TZS 1,000", { at: "tr" }]],
  }),
  WD("fb-w-check-bank", FIN, { url: W, h: 1250, steps: [...BANK, SEE], clip: DLG, pad: 40, marks: [[1, "VEGAS LUXURY HOTEL LTD", R], [2, "0150987654321", R]] }),

  // ── the first withdrawal: TZS 1,000 to a Lipa number. SAVES — run ONCE, in this order ──
  // 1) sent, the page, the window "On its way" (take all three together: it completes about 15 seconds after it was sent)
  WD("fb-w-sent", FIN, {
    url: W, h: 1250, steps: [...LIPA, SEE, TICK, { click: "Send TZS 1,000", then: 3500 }], clip: DLG, pad: 40,
    marks: [[1, "css:[role=dialog] h2", { at: "r" }], [2, "MAMA NTILIE SHOP", R], [3, "You can close this", L], [4, "css:[role=dialog] button.w-full", { at: "tr" }]],
  }),
  D("fb-w-onway", FIN, { url: W, h: 1000, steps: [{ wait: 1500 }], marks: [[1, "On its way##1", { up: 1 }], [2, "On its way##2", { self: true, at: "t" }], [3, "WD-000001"]] }),
  WD("fb-w-open", FIN, {
    url: W, h: 1500, steps: [{ click: "WD-000001", then: 1500 }], clip: DLG, pad: 40,
    marks: [[1, "css:[role=dialog] span.rounded-full##1", { self: true, at: "r" }], [2, "Ask nTZS now"], [3, "In the hotel's books", { up: 1, at: "l", pad: 1 }], [4, "What happened", L]],
  }),
  // 2) a little later: ask nTZS, and it says Completed
  WD("fb-w-done", FIN, {
    url: W, h: 1500, steps: [{ click: "WD-000001", then: 1500 }, { wait: 9000 }, { click: "Ask nTZS now", then: 3000 }], clip: DLG, pad: 40,
    marks: [[1, "css:[role=dialog] span.rounded-full##1", { self: true, at: "r" }], [2, "Arrived", { up: 1, at: "l", pad: 1 }], [3, "In the hotel's books", { up: 1, at: "l", pad: 1 }], [4, "Ask nTZS now"], [5, "What happened", L]],
  }),

  // ── the second withdrawal: TZS 5,000 to a phone (the window "On its way" with the right words for a phone). SAVES — run ONCE ──
  WD("fb-w-sent-phone", FIN, {
    url: W, h: 1250, steps: [...PHONE, SEE, TICK, { click: "Send TZS 5,000", then: 3500 }], clip: DLG, pad: 40,
    marks: [[1, "css:[role=dialog] h2", { at: "r" }], [2, "JOHN M. MWAKASEGE", R], [3, "You can close this", L], [4, "css:[role=dialog] button.w-full", { at: "tr" }]],
  }),
  // set-up: ask nTZS until it says Completed (the pretend nTZS finishes a payout about 15 seconds after it was sent)
  WD("fb-x-done-2", FIN, { url: W, h: 1500, steps: [{ click: "WD-000002", then: 1500 }, { wait: 12000 }, { click: "Ask nTZS now", then: 3000 }], clip: DLG, pad: 40 }),
  // ── the third: TZS 20,000 to a bank account, into CRDB Bank in the books. SAVES — run ONCE ──
  WD("fb-w-sent-bank", FIN, {
    url: W, h: 1250, steps: [...BANK, SEE, TICK, { click: "Send TZS 20,000", then: 3500 }], clip: DLG, pad: 40,
    marks: [[1, "css:[role=dialog] h2", { at: "r" }], [2, "VEGAS LUXURY HOTEL LTD", R], [3, "You can close this", L], [4, "css:[role=dialog] button.w-full", { at: "tr" }]],
  }),
  WD("fb-x-done-3", FIN, { url: W, h: 1500, steps: [{ click: "WD-000003", then: 1500 }, { wait: 12000 }, { click: "Ask nTZS now", then: 3000 }], clip: DLG, pad: 40 }),

  // ── after the three withdrawals: the page, the nTZS account, the books (only look — safe to repeat) ──
  WD("fb-w-page", FIN, {
    url: W, h: 1700, full: true, max: 2600, steps: [{ wait: 800 }], clip: ["css:section.rounded-3xl##1", "A withdrawal moves money out of nTZS"], pad: 14,
    marks: [[1, "css:button.h-11.px-5", L], [2, "Available to withdraw", { up: 1 }], [3, "On its way", { up: 1 }], [4, "This month"], [5, "Withdrawn", { up: 1 }], [6, "Every status"], [7, "WD-000003"], [8, "Completed##1", { self: true, at: "r" }]],
  }),
  WD("fb-w-account", FIN, {
    url: NTZS, h: 2200, full: true, max: 3000, steps: [{ wait: 800 }], clip: ["css:section.relative.overflow-hidden", "Open WD-000001"], pad: 14,
    marks: [[1, "TZS 2,423,740", { at: "l" }], [2, "Withdraw funds##2", { at: "b" }], [3, "All withdrawals", { at: "b" }], [4, "Latest withdrawals", { at: "tr" }]],
  }),
  WD("fb-w-books", FIN, {
    url: NTZS, h: 2200, full: true, max: 3000, steps: [{ wait: 800 }], clip: "css:table[data-stack]", pad: 14,
    marks: [[1, "Transfer", { self: true, at: "l", size: 22 }], [2, "Owner withdrawal##1", { self: true, at: "l", size: 22 }], [3, "Expense##1", { self: true, at: "l", size: 22 }]],
  }),
  WD("fb-w-fee", FIN, {
    url: "/staff/expenses", h: 1700, full: true, max: 2600, steps: [{ wait: 800 }], clip: ["Mobile money charges##1", "TZS 130", "EXP-2026-000014"], pad: 32,
    marks: [[1, "nTZS fee — withdrawal WD-000003", { self: true, at: "r" }], [2, "TZS 130", { self: true, at: "r" }]],
  }),
  // the queue of purchase requests as Finance sees it now (cut down to its working part by crops-fb.py as fb-c-queue)
  D("fb-x-queue", FIN, { url: "/staff/stock-requests", h: 1150, scroll: "top", marks: [[1, "To review", L], [2, "SR-2026-0004"], [3, "Your turn", { self: true, at: "t" }], [4, "Waiting for review", { self: true, at: "t" }]] }),

  // ── purchases: the window of a request, Reject chosen (R3, SR-2026-0004) — nothing is pressed that saves ──
  D("fb-p-reject", FIN, {
    url: "/staff/stock-requests", h: 1400, clip: DLG, pad: 40,
    steps: [{ click: "SR-2026-0004" }, { wait: 800 }, { click: "Reject" }, { wait: 300 }, { js: fill('input[placeholder^="Why?"],textarea[placeholder^="Why?"]', "Please count the glasses in the bar first - we may already have enough.") }, { wait: 300 }],
    marks: [[1, 'css:input[placeholder^="Why?"],textarea[placeholder^="Why?"]', L], [2, "Reject"]],
  }),
];
