// Finance book (prefix "fa-"): pictures of the Finance person's own screens (Grace Mushi), plus a few as the Boss / the MD.
//   node guides/tools/shoot.mjs --list=shots-fa fa-h-        (the Home, part by part)
// Pictures that only look (nothing is pressed that saves) can be taken again at any time. The ones that SAVE something are marked "SAVES"
// and are run ONCE, by their own name.
const L = { at: "l" };
const R = { at: "r" };
const FIN = "accountant@vegas.test";
const BOSS = "owner@vegas.test";
const MD = "admin@vegas.test";
const MGR = "manager@vegas.test";

// ── Helpers that run inside the page ──
// Tags a thing with a short name so a numbered mark can find it: the smallest thing inside `scope` whose words are `text`
// (or begin with them); `up` climbs to its parent (a number of steps) or to the card that holds it ("card").
const tag = (scope, text, name, o = {}) => `(()=>{const root=document.querySelector('[data-g="${scope}"]')||document.body;const w=${JSON.stringify(String(text).toLowerCase())};
const n=(e)=>(e.innerText||'').replace(/\\s+/g,' ').trim().toLowerCase();
const vis=(e)=>{const r=e.getBoundingClientRect();return r.width>2&&r.height>2;};
const all=[...root.querySelectorAll('*')].filter(vis);
let c=all.filter((e)=>n(e)===w); if(!c.length)c=all.filter((e)=>n(e).startsWith(w)); if(!c.length)c=all.filter((e)=>n(e).includes(w));
c=c.filter((e)=>!c.some((o)=>o!==e&&e.contains(o)));
c.sort((a,b)=>a.getBoundingClientRect().top-b.getBoundingClientRect().top||a.getBoundingClientRect().left-b.getBoundingClientRect().left);
let el=c[${(o.nth ?? 1) - 1}]; if(!el)return;
const up=${JSON.stringify(o.up ?? 0)};
if(up==='card'){while(el.parentElement&&el.parentElement!==root){const s=getComputedStyle(el);if(parseFloat(s.borderTopWidth)>0&&parseFloat(s.borderTopLeftRadius)>=14)break;el=el.parentElement;}}
else for(let i=0;i<up;i++)if(el.parentElement)el=el.parentElement;
el.setAttribute('data-g',${JSON.stringify(name)});})()`;
// The parts of Finance's Home get a name each.
const TAGS = `(()=>{const m=document.getElementById('money');if(!m)return;const c=[...m.parentElement.children];
c[0].setAttribute('data-g','hero');c[1].setAttribute('data-g','quick');c[2].setAttribute('data-g','jump');c[3].setAttribute('data-g','needs');m.setAttribute('data-g','money');
const si=document.getElementById('stands-out');if(si)si.setAttribute('data-g','stands');
const heads={'Where the money is':'accounts','Money in and out':'flow','Cash outlook':'outlook','Purchases, discounts and online payments':'purchases','Discounts and online payments':'purchases','How the hotel is doing':'trends','Bookings':'bookings','The latest':'latest','The business in detail':'detail'};
for(const el of c){const h=el.querySelector('h2');const k=h&&heads[h.textContent.trim()];if(k&&el.tagName==='SECTION')el.setAttribute('data-g',k);}})()`;

/**
 * One part of Finance's Home as a picture. `marks`: [number, scope-or-null, words-or-null, options]. null words = the whole scope.
 * options: at (side of the mark), up (a number or "card"), nth.
 */
const part = (id, scope, marks, o = {}) => {
  const steps = [{ wait: o.wait ?? 8000 }, { js: TAGS }, ...(o.steps ?? [])];
  const out = [];
  // things that are only named (to cut a picture round them), with no number
  for (const [name, sc, words, opt = {}] of o.tags ?? []) steps.push({ js: tag(sc ?? scope, words, name, { up: opt.up, nth: opt.nth }) });
  for (const [n, sc, words, opt = {}] of marks) {
    const { at, ring, pad, size, dx, dy, self, up, nth } = opt;
    if (words === null || words === undefined) { out.push([n, `css:[data-g="${sc ?? scope}"]`, { at, ring, pad, size, dx, dy }]); continue; }
    steps.push({ js: tag(sc ?? scope, words, "m" + n, { up, nth }) });
    out.push([n, `css:[data-g="m${n}"]`, { at, ring, pad, size, dx, dy, self }]);
  }
  return { id, as: o.as ?? FIN, view: o.view ?? "wide", h: 900, url: o.url ?? "/finance/dashboard", full: true, max: 16000, clip: o.clip ? o.clip.map((c) => (typeof c === "number" ? `css:[data-g="m${c}"]` : /^@/.test(c) ? `css:[data-g="${c.slice(1)}"]` : c)) : `css:[data-g="${scope}"]`, pad: o.pad ?? 22, steps, marks: out };
};

const FILL = (css, value) => `(()=>{const e=document.querySelector(${JSON.stringify(css)});if(!e)return;const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(value)});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`;
const PICK = (css, words) => `(()=>{const s=document.querySelector(${JSON.stringify(css)});if(!s)return;const o=[...s.options].find(o=>o.text.includes(${JSON.stringify(words)}));if(!o)return;Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(s,o.value);s.dispatchEvent(new Event('change',{bubbles:true}));})()`;
// presses a button on the line of the list that holds `row` (the line is found by its words)
const CLICK_IN = (row, button) => `(()=>{const w=${JSON.stringify(row.toLowerCase())};const b=${JSON.stringify(button.toLowerCase())};const n=(e)=>(e.innerText||'').replace(/\\s+/g,' ').trim().toLowerCase();
const cands=[...document.querySelectorAll('button,a')].filter((e)=>n(e)===b);for(const e of cands){let r=e;for(let i=0;i<8&&r.parentElement;i++){r=r.parentElement;if(n(r).includes(w)&&n(r).length<400){e.click();return;}}}})()`;
// names a button inside the line of a list (found by its words), so a numbered mark can sit on it: data-g="<name>"
const TAGROW = (row, button, name) => `(()=>{const w=${JSON.stringify(row.toLowerCase())};const b=${JSON.stringify(button.toLowerCase())};const n=(e)=>(e.innerText||'').replace(/\\s+/g,' ').trim().toLowerCase();
for(const e of [...document.querySelectorAll('button,a,span')].filter((e)=>n(e)===b)){let r=e;for(let i=0;i<8&&r.parentElement;i++){r=r.parentElement;if(n(r).includes(w)&&n(r).length<400){e.setAttribute('data-g',${JSON.stringify(name)});return;}}}})()`;
const HEAD = { up: 3 }; // the whole heading row of a part
export const SHOTS = [
  // ── The Home, part by part (chapter 1) ──
  part("fa-h-top", "hero", [[1, "hero", null], [2, "quick", null], [3, "jump", null]], { clip: ['css:[data-g="hero"]', 'css:[data-g="jump"]'], pad: 18 }),
  part("fa-h-needs", "needs", [[1, "needs", "needs your attention"], [2, "needs", "all", { up: 1 }], [3, "needs", "1 supplier invoice", { up: 3 }], [4, "needs", "scroll for"]], { clip: [1, 4], pad: 24 }),
  part("fa-h-money", "money", [[1, "money", "the money"], [2, "money", "today yesterday this week this month this year"], [3, "money", "show"],
    [4, "money", "earned", { up: "card", at: "l" }], [5, "money", "received", { up: "card", at: "l" }], [6, "money", "expenses", { up: "card", at: "l" }], [7, "money", "net result", { up: "card", at: "l" }], [8, "money", "still owed", { up: "card", at: "l" }], [9, "money", "bookings made", { up: "card", at: "l" }]], { pad: 30 }),
  part("fa-h-stands", "stands", [[1, "stands", "what stands out"], [2, "stands", "read from the figures"], [3, "stands", "tzs 85,000 owed to suppliers", { up: "card" }]]),
  part("fa-h-accounts", "accounts", [[1, "accounts", "where the money is", HEAD], [2, "accounts", "accounts"], [3, "accounts", "in all accounts", { up: "card" }], [4, "accounts", "nothing moved today", { up: "card" }], [5, "accounts", "withdraw funds"]], { pad: 26 }),
  part("fa-h-flow", "flow", [[1, "flow", "money in and out", HEAD], [2, "flow", "day by day", { up: "card" }], [3, "flow", "where income comes from", { up: "card" }], [4, "flow", "how the money came in", { up: "card" }], [5, "flow", "where the money went", { up: "card" }]]),
  part("fa-h-outlook", "outlook", [[1, "outlook", "cash outlook", HEAD], [2, "outlook", "in the accounts", { up: "card" }], [3, "outlook", "owed to the hotel", { up: "card" }], [4, "outlook", "owed to suppliers", { up: "card" }], [5, "outlook", "days the money lasts", { up: "card" }],
    [6, "outlook", "who owes the hotel — how late", { up: "card" }], [7, "outlook", "what the hotel owes — when it falls due", { up: "card" }], [8, "outlook", "next to pay"]], { clip: [1, 6, 7], pad: 26 }),
  part("fa-h-outlook2", "outlook", [[1, "outlook", "how fast the money goes", { up: "card" }], [2, "outlook", "rooms booked ahead", { up: "card" }], [3, "outlook", "who owes the hotel", { up: "card" }], [4, "outlook", "cash", { up: "card" }]], { clip: [1, 2, 3, 4], pad: 26 }),
  part("fa-h-purchases", "purchases", [[1, "purchases", "purchases, discounts and online payments", HEAD], [2, "purchases", "purchases and suppliers", { up: "card" }], [3, "purchases", "discounts and refunds", { up: "card" }], [4, "purchases", "online payments", { up: "card" }]], { pad: 26, view: "desk" }),
  part("fa-h-trends1", "trends", [[1, "trends", "how the hotel is doing", HEAD], [2, "trends", "the key figures", { up: "card" }], [3, "trends", "occupancy", { up: "card" }], [4, "trends", "spent of what was earned", { up: "card" }]], { clip: [1, 2], pad: 26 }),
  part("fa-h-trends2", "trends", [[1, "trends", "the last six months", { up: "card" }], [2, "trends", "occupancy", { up: "card", nth: 2 }], [3, "trends", "which days earn most", { up: "card" }]], { clip: [1, 3], pad: 26 }),
  part("fa-h-trends3", "trends", [[1, "trends", "income against the period before", { up: "card" }], [2, "trends", "expenses against the period before", { up: "card" }]], { clip: [1, 2], pad: 26 }),
  part("fa-h-bookings", "bookings", [[1, "bookings", "bookings", HEAD], [2, "bookings", "check-ins", { up: 2 }], [3, "bookings", "bookings made each day", { up: 1 }], [4, "bookings", "by booking channel", { up: 1 }]], { pad: 26 }),
  part("fa-h-latest", "latest", [[1, "latest", "the latest", HEAD], [2, "latest", "latest money in", { up: "card" }], [3, "latest", "latest expenses", { up: "card" }]], { pad: 26 }),
  part("fa-h-detail", "detail", [[1, "detail", "the business in detail", HEAD], [2, "detail", "average room rate", { up: 3 }]], { clip: [1, 2], pad: 26 }),
  part("fa-h-detail2", "detail", [[1, "detail", "rooms by type", { up: "card" }], [2, "detail", "guests & bookings", { up: "card" }], [3, "detail", "restaurant & bar", { up: "card" }], [4, "detail", "best customers", { up: "card" }]],
    { clip: [1, 4, "@r1", "@r2"], tags: [["r1", "detail", "where bookings come from", { up: "card" }], ["r2", "detail", "who owes the hotel", { up: "card" }]], pad: 26 }),
  // the top of the Home on a phone
  { id: "fa-h-phone", as: FIN, view: "phone", url: "/finance/dashboard", h: 844, steps: [{ wait: 4000 }], marks: [] },

  // ── Chapter 1: signing in, the menu ──
  { id: "fa-signin", view: "desk", url: "/staff/login", h: 700, marks: [[1, "css:input[type=\"email\"]", { at: "l" }], [2, "css:input[type=\"password\"]", { at: "l" }], [3, "Sign in##2"]] },
  { id: "fa-menu", as: FIN, view: "desk", url: "/finance/dashboard", h: 1500, clip: ["Home", "Room pricing"], pad: 30, marks: [[1, "Home", { at: "r", ring: false }], [2, "Overview", { at: "r", ring: false }], [3, "Withdraw funds", { at: "r", ring: false }], [4, "Procurement", { at: "r", ring: false }], [5, "Daily reports", { at: "r", ring: false }]] },
  // ── Chapter 2: where the jobs lead ──
  { id: "fa-need-scroll", as: FIN, view: "wide", h: 900, url: "/finance/dashboard", full: true, max: 16000, steps: [{ wait: 6000 }, { js: TAGS }, { js: "(()=>{const n=document.querySelector('[data-g=needs]');for(const e of n.querySelectorAll('*')){if(e.scrollHeight>e.clientHeight+40&&getComputedStyle(e).overflowY!=='visible')e.scrollTop=9999;}})()" }, { wait: 500 }], clip: 'css:[data-g="needs"]', pad: 24, marks: [] },
  { id: "fa-need-expenses", as: FIN, view: "desk", url: "/staff/expenses?status=PENDING_APPROVAL&period=month", h: 1300, marks: [[1, "Waiting approval"], [2, "Approve"], [3, "Reject"]] },
  { id: "fa-need-stays", as: FIN, view: "desk", url: "/staff/reservations?view=departures&f=owes", h: 900, marks: [[1, "Owes money"], [2, "Leaving today", { up: 1 }]] },
  // ── Chapter 3: money coming in ──
  { id: "fa-in-income", as: FIN, view: "desk", url: "/staff/payments?period=week", h: 1000, marks: [[1, "Record payment"], [2, "This week"], [3, "INCOME RECEIVED", { up: 2 }], [4, "Every source"], [5, "Every account"], [6, "Guest, company, room, booking, reference", { at: "l" }]] },
  { id: "fa-in-income2", as: FIN, view: "desk", url: "/staff/payments?period=week", h: 900, scroll: "Reverse", marks: [[1, "Edit"], [2, "Reverse"]] },
  { id: "fa-in-rec1", as: FIN, view: "desk", url: "/staff/payments", h: 860, clip: "css:[role=dialog]", pad: 36, steps: [{ click: "Record payment" }, { wait: 800 }], marks: [[1, "Guest name, room, booking reference, company or phone…", { at: "l" }], [2, "Record payment##3"]] },
  { id: "fa-in-rec2", as: FIN, view: "desk", url: "/staff/payments", h: 960, clip: "css:[role=dialog]", pad: 36, steps: [{ click: "Record payment" }, { wait: 800 }, { click: "Record payment##3" }, { wait: 900 }], marks: [[3, "All TZS"], [4, "Reference"], [5, "Into which account", { at: "l" }], [6, "Record TZS"]] },
  { id: "fa-in-coll1", as: FIN, view: "desk", url: "/staff/collections?period=week", h: 1180, marks: [[1, "This week"], [2, "Everything", { up: 1 }], [3, "COLLECTED", { up: 2 }], [4, "INTO WHICH ACCOUNT", { at: "l" }], [5, "HOW IT WAS PAID", { at: "l" }], [6, "STILL TO COLLECT"], [7, "ON ROOM BILLS"]] },
  { id: "fa-in-coll2", as: FIN, view: "desk", url: "/staff/collections?period=week", h: 900, scroll: "Showing 1", marks: [[1, "Served by — every waiter"], [2, "Recorded by — everyone"], [3, "Every source"], [4, "Every method"], [5, "Every account"]] },
  { id: "fa-in-owes", as: FIN, view: "desk", url: "/staff/finance/receivables", h: 1100, marks: [[1, "Total outstanding", { up: 1 }], [2, "Overdue invoices", { up: 1 }], [3, "Company invoices", { up: "card" }], [4, "Statement"], [5, "Guests & meeting bookings with a balance", { up: "card" }]] },
  { id: "fa-in-stmt", as: FIN, view: "desk", url: "/staff/corporate/cmv58el2900em5xsb4pu1sft0/statement", h: 1000, marks: [[1, "Print"], [2, "This year"], [3, "CLOSING BALANCE", { up: 1 }], [4, "OWED TODAY, BY AGE", { at: "l" }]] },
  { id: "fa-in-companies", as: FIN, view: "desk", url: "/staff/corporate", h: 700, marks: [[1, "Add company"], [2, "Companies owe", { up: 1 }], [3, "Overdue", { up: 1 }], [4, "Not invoiced yet", { up: 1 }], [5, "Dar Port Logistics"]] },
  { id: "fa-in-company", as: FIN, view: "desk", url: "/staff/corporate/cmv58el2900em5xsb4pu1sft0", h: 1000, marks: [[1, "Record payment"], [2, "Statement"], [3, "Edit"], [4, "OWES NOW", { up: 1 }], [5, "Unpaid invoices", { up: 2 }]] },
  { id: "fa-in-invoices", as: FIN, view: "desk", url: "/staff/invoices", h: 800, marks: [[1, "New invoice"], [2, "OPEN INVOICES", { up: 1 }], [3, "Partly paid"], [4, "INV-2026-000003", { at: "l" }]] },
  { id: "fa-in-invoice", as: FIN, view: "desk", url: "/staff/invoices/cmv58elbr00fw5xsb8jscjvcy", h: 1000, marks: [[1, "Send"], [2, "Record payment"], [3, "Void"], [4, "AMOUNT DUE", { up: 1 }]] },
  { id: "fa-in-online1", as: FIN, view: "desk", url: "/staff/finance/online", h: 1000, steps: [{ js: "(()=>{for(const d of document.querySelectorAll('dt')){if(/webhook/i.test(d.textContent)){const b=d.parentElement;b.style.filter='blur(7px)';}}})()" }], marks: [[1, "Online payment · NTZS"], [2, "Test connection"], [3, "Check unrecorded with nTZS"], [4, "Where customers can pay online", { at: "l" }]] },
  { id: "fa-in-online2", as: FIN, view: "desk", url: "/staff/finance/online?period=month", h: 1000, scroll: "Reconciliation", marks: [[1, "Paid online", { up: 1 }], [2, "Waiting", { up: 1 }], [3, "Not completed", { up: 1 }], [4, "Needs a person", { up: 1 }], [5, "Reconciliation", { at: "l" }]] },

  // ── Chapter 4: money going out ──
  { id: "fa-out-list", as: FIN, view: "desk", url: "/staff/expenses?period=month", h: 1100, marks: [[1, "Record expense"], [2, "MONEY SPENT", { up: 2 }], [3, "Monthly bills", { up: 1 }], [4, "Every category"], [5, "Any status"], [6, "Any account"], [7, "What it was, the number, who was paid, a note", { at: "l" }]] },
  { id: "fa-out-lines", as: FIN, view: "desk", url: "/staff/expenses?period=month", h: 900, scroll: "Approve", marks: [[1, "Waiting approval"], [2, "Approve"], [3, "Reject"]] },
  { id: "fa-out-supplier", as: FIN, view: "desk", url: "/staff/expenses?period=month", h: 900, scroll: "Supplier payment", steps: [{ js: TAGROW("supplier payment", "paid · approved", "sp-badge") }, { js: TAGROW("supplier payment", "edit", "sp-edit") }, { js: TAGROW("supplier payment", "cancel", "sp-cancel") }, { js: "document.querySelector('[data-g=sp-edit]')?.scrollIntoView({ block: 'center' })" }, { wait: 400 }], marks: [[1, "css:[data-g=\"sp-badge\"]"], [2, "css:[data-g=\"sp-edit\"]"], [3, "css:[data-g=\"sp-cancel\"]"]] },
  { id: "fa-out-type", as: FIN, view: "desk", url: "/staff/expenses", h: 960, clip: "css:[role=dialog]", pad: 36, steps: [{ click: "Record expense" }, { wait: 900 }], marks: [[1, "Search — DAWASA, fuel, salaries, Netflix…", { at: "l" }], [2, "Used most"], [3, "Something else — add a new expense"]] },
  { id: "fa-out-history", as: FIN, view: "desk", url: "/staff/finance/history?period=week", h: 1100, marks: [[1, "This week"], [2, "Name, expense number, booking, amount…", { at: "l" }], [3, "Everything"], [4, "Anyone"], [5, "Expenses & purchases"]] },
  // ── Chapter 5: the accounts ──
  { id: "fa-acc-board", as: FIN, view: "desk", url: "/staff/finance/accounts?period=month", h: 1100, marks: [[1, "Money movement"], [2, "Across every account", { up: 2 }], [3, "This month"], [4, "Cash"]] },
  { id: "fa-acc-board2", as: FIN, view: "desk", url: "/staff/finance/accounts?period=month", h: 900, scroll: "Cash counts", marks: [[1, "Cash counts"], [2, "Money movements"]] },
  { id: "fa-acc-cash", as: FIN, view: "desk", url: "/staff/finance/accounts/acct_cash?period=week", h: 1500, marks: [[1, "IN THE BOOKS", { at: "l" }], [2, "Record expense"], [3, "Count"], [4, "Money movement"], [5, "Guest, company, reservation, room, reference…", { at: "l" }], [6, "Related"], [7, "Fix"]] },
  { id: "fa-acc-ntzs", as: FIN, view: "desk", url: "/staff/finance/accounts/acct_ntzs?period=week", h: 1200, marks: [[1, "IN THE BOOKS", { at: "l" }], [2, "in TZS"], [3, "Withdraw funds##2"], [4, "Latest withdrawals", { up: 1 }], [5, "Money movement"]] },
  { id: "fa-acc-move", as: FIN, view: "desk", url: "/staff/finance/accounts", h: 960, clip: "css:[role=dialog]", pad: 36, steps: [{ click: "Money movement" }, { wait: 800 }, { type: "100000", into: "css:#mv-amt" }, { type: "Banked the cash takings", into: "css:#mv-desc" }, { js: PICK("#mv-to", "CRDB") }, { wait: 300 }], marks: [[1, "Transfer"], [2, "From account", { at: "l" }], [3, "To account", { at: "l" }], [4, "Amount (TZS)", { at: "l" }], [5, "What is it for?", { at: "l" }], [6, "Save to the ledger"]] },
  { id: "fa-acc-count", as: FIN, view: "desk", url: "/staff/finance/accounts/acct_cash", h: 900, clip: "css:[role=dialog]", pad: 36, steps: [{ click: "Count" }, { wait: 800 }, { type: "1841500", into: "css:#cc-amt" }, { js: FILL("#cc-note", "Change given to a guest without a receipt") }, { wait: 300 }], marks: [[1, "The system expects", { up: 1 }], [2, "Counted (TZS)", { at: "l" }], [3, "Short by"], [4, "Explain the difference", { at: "l" }], [5, "Save count"]] },
  { id: "fa-acc-open1", as: BOSS, view: "desk", url: "/staff/finance/accounts/acct_ntzs?period=week", h: 1000, marks: [[1, "Opening balance"], [2, "in TZS"], [3, "Withdraw funds##2"]] },
  { id: "fa-acc-open2", as: BOSS, view: "desk", url: "/staff/finance/accounts/acct_ntzs", h: 960, clip: "css:[role=dialog]", pad: 36, steps: [{ click: "Opening balance" }, { wait: 800 }, { type: "Money in the nTZS wallet when the hotel's books began", into: "css:textarea" }, { wait: 300 }], marks: [[1, "Now: opening", { at: "t" }], [2, "Opening balance (TZS)", { at: "l" }], [3, "What is it?", { at: "l" }], [4, "Save the opening balance"]] },
  { id: "fa-gl-top", as: FIN, view: "desk", url: "/staff/finance/ledger?period=week", h: 1100, marks: [[1, "Guest, room, reference, M-Pesa code, supplier, account, person…", { at: "l" }], [2, "Everything"], [3, "MONEY IN", { up: 2 }], [4, "Export CSV"], [5, "Opening balance", { at: "l" }]] },
  { id: "fa-gl-two", as: FIN, view: "wide", url: "/staff/finance/ledger?period=week&q=VLH-KAAF3Y", h: 900, marks: [[1, "Earned 120,000"], [2, "Paid by Peter Kim"]] },
  // following one payment from the guest to the books (the payment of Lucy Mwangi, room 205, TZS 80,000 in cash)
  { id: "fa-tr-income", as: FIN, view: "desk", url: "/staff/payments?period=week&q=VLH-PC9A4C", h: 900, marks: [[1, "css:input[name=\"q\"]##2", { at: "l" }], [2, "Lucy Mwangi", { up: 2 }]] },
  { id: "fa-tr-account", as: FIN, view: "wide", url: "/staff/finance/accounts/acct_cash?period=week&q=VLH-PC9A4C", h: 1300, marks: [[1, "Guest, company, reservation, room, reference…", { at: "l" }], [2, "Lucy Mwangi", { up: 2 }]] },
  { id: "fa-tr-ledger", as: FIN, view: "wide", url: "/staff/finance/ledger?period=week&q=VLH-PC9A4C", h: 900, marks: [[1, "css:input[name=\"q\"]##2", { at: "l" }], [2, "DATE", { at: "t" }], [3, "DESCRIPTION", { at: "t" }], [4, "TYPE", { at: "t" }], [5, "ACCOUNT", { at: "t" }], [6, "BY", { at: "t" }], [7, "CREDIT", { at: "t" }], [8, "BALANCE", { at: "t" }], [9, "PROOF", { at: "t" }]] },
  // ── Chapter 6: reading the numbers, and the reports ──
  { id: "fa-rep-overview", as: FIN, view: "desk", url: "/staff/finance?period=month", h: 1200, marks: [] },
  { id: "fa-rep-summary", as: FIN, view: "desk", url: "/staff/reports?period=week", h: 1100, marks: [[1, "Print"], [2, "PDF"], [3, "Excel (CSV)"], [4, "Share"], [5, "Whole business"], [6, "EARNED (NET INCOME)", { up: 1 }], [7, "OWED TO THE HOTEL NOW", { up: 1 }]] },
  { id: "fa-rep-daily", as: FIN, view: "desk", url: "/staff/reports/daily", h: 900, marks: [[1, "Make today's now"], [2, "Daily room reports"], [3, "Made automatically at 07:00, every day", { at: "l" }]] },
  { id: "fa-rep-weekly", as: FIN, view: "desk", url: "/staff/reports/staff", h: 1100, marks: [[1, "THIS WEEK", { up: 1 }], [2, "THIS MONTH", { up: 1 }], [3, "Weekly reports (0)", { at: "l" }], [4, "Latest shift reports", { at: "l" }]] },
  { id: "fa-rep-disc", as: FIN, view: "desk", url: "/staff/accountant/discounts?period=month", h: 900, marks: [] },
  { id: "fa-rep-prices", as: FIN, view: "desk", url: "/staff/accountant/prices", h: 1100, marks: [] },
  { id: "fa-rep-refunds", as: FIN, view: "desk", url: "/staff/accountant/reports?period=month", h: 800, marks: [] },

  // the expense form, filled (not saved)
  { id: "fa-out-form", as: FIN, view: "desk", url: "/staff/expenses", h: 900, clip: "css:[role=dialog]", pad: 36, steps: [{ click: "Record expense" }, { wait: 900 }, { click: "Housekeeping & laundry##2" }, { wait: 600 }, { click: "Housekeeping supplies" }, { wait: 700 }, { type: "38500", into: "css:#amount" }, { js: FILL("#payee", "Kariakoo Cleaning Stores") }, { js: FILL("#reference", "RCPT-2210") }, { js: FILL("#notes", "Detergent and toilet paper for the guest rooms") }, { wait: 300 }], marks: [[4, "Amount", { at: "l" }], [5, "Paid from", { at: "l" }], [6, "Paid to", { at: "l" }], [7, "Receipt, reference, date & notes"], [8, "Save expense"]] },
  { id: "fa-cover", as: FIN, view: "desk", url: "/finance/dashboard", h: 760, steps: [{ wait: 3500 }], marks: [] },

  // ── SAVES (run once, in this order): the Manager records two expenses above the limit, so there is something for Finance to decide ──
  // Finance records one of its own (below the limit: it counts at once)
  // the reject window (looked at, not sent)
  { id: "fa-out-reject", as: FIN, view: "desk", url: "/staff/expenses?status=PENDING_APPROVAL&period=month", h: 900, steps: [{ js: CLICK_IN("by Neema", "Reject") }, { wait: 900 }, { js: FILL("textarea", "No receipt — bring it and record it again") }, { wait: 300 }], marks: [[2, "css:textarea", { at: "l" }], [3, "Reject"]] },
  // SAVES (once): Finance approves the repair and rejects the catering
];

// The pictures that SAVE something in the practice copy. They were run ONCE, in this order (the file does nothing with them unless FA_SAVES=1):
// Manager records two expenses above the limit → Finance records its own → Finance approves one and rejects the other.
const SAVES = [
  { id: "fa-x-mgr1", as: MGR, view: "desk", url: "/staff/expenses", h: 900, steps: [{ click: "Record expense" }, { wait: 900 }, { click: "Food & kitchen##2" }, { wait: 600 }, { click: "Kitchen shopping" }, { wait: 700 }, { type: "230000", into: "css:#amount" }, { type: "Catering for the staff party", into: "e.g. for October" }, { wait: 300 }, { click: "Save expense" }, { wait: 2200 }], marks: [] },
  { id: "fa-x-mgr2", as: MGR, view: "desk", url: "/staff/expenses", h: 900, steps: [{ click: "Record expense" }, { wait: 900 }, { click: "Repairs & maintenance##2" }, { wait: 600 }, { click: "Plumbing repairs" }, { wait: 700 }, { type: "280000", into: "css:#amount" }, { click: "CRDB Bank" }, { type: "Burst pipe in the laundry", into: "e.g. for October" }, { wait: 300 }, { click: "Save expense" }, { wait: 2200 }], marks: [] },
  { id: "fa-out-saved", as: FIN, view: "desk", url: "/staff/expenses", h: 1000, steps: [{ click: "Record expense" }, { wait: 900 }, { click: "Housekeeping & laundry##2" }, { wait: 600 }, { click: "Housekeeping supplies" }, { wait: 700 }, { type: "38500", into: "css:#amount" }, { js: FILL("#payee", "Kariakoo Cleaning Stores") }, { wait: 300 }, { click: "Save expense" }, { wait: 2500 }], marks: [[1, "Expense saved."], [2, "Kariakoo Cleaning Stores", { up: 2 }], [3, "Waiting approval"]] },
  { id: "fa-out-approved", as: FIN, view: "desk", url: "/staff/expenses?status=PENDING_APPROVAL&period=month", h: 1000, steps: [{ js: CLICK_IN("Burst pipe", "Approve") }, { wait: 2200 }], marks: [[1, "Expense approved."]] },
  { id: "fa-x-rejected", as: FIN, view: "desk", url: "/staff/expenses?status=PENDING_APPROVAL&period=month", h: 1000, steps: [{ js: CLICK_IN("Catering for the staff party", "Reject") }, { wait: 900 }, { js: FILL("textarea", "No receipt — bring it and record it again") }, { wait: 300 }, { click: "Reject" }, { wait: 2200 }], marks: [[1, "Expense rejected."]] },
];
if (process.env.FA_SAVES === "1") SHOTS.push(...SAVES);

