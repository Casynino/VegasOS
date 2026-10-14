// Boss and MD books, edition 2 (prefix "ad2-"): the new parts — the Home with its Jump-to row and "The money, analysed", Finance and Purchasing as
// departments, the Finance limit, an opening balance, Withdraw funds, the roles — taken once in English and once in 中文 (the "-zh" ones find every
// thing where the English ones found it: `like`).
//
//   node guides/tools/shoot.mjs --list=shots-ad2 ad2-an-          (a group of pictures, by the start of the id)
//
// Pictures that only look can be taken again at any time. The ones marked SAVES change the practice copy and are run ONCE, by their own name
// (their 中文 pictures are made by a second, separate run).
const L = { at: "l" };
const R = { at: "r" };
const T = { at: "t" };
const BOSS = "owner@vegas.test";
const MD = "admin@vegas.test";
const FIN = "accountant@vegas.test";
const BUY = "purchasing@vegas.test";
const ASHA = "asha@vegas.test";

// a plain drop-down list / a typed field, set the way a person does it (the page hears the change)
const pick = (words, css = "select") => `(()=>{const s=[...document.querySelectorAll(${JSON.stringify(css)})].find(x=>[...x.options].some(o=>o.text.includes(${JSON.stringify(words)})));if(!s)return;const o=[...s.options].find(o=>o.text.includes(${JSON.stringify(words)}));const set=Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set;set.call(s,o.value);s.dispatchEvent(new Event('change',{bubbles:true}));})()`;
const fill = (css, value, nth = 1) => `(()=>{const e=[...document.querySelectorAll(${JSON.stringify(css)})][${nth - 1}];if(!e)return;const proto=e.tagName==='TEXTAREA'?HTMLTextAreaElement.prototype:HTMLInputElement.prototype;Object.getOwnPropertyDescriptor(proto,'value').set.call(e,${JSON.stringify(String(value))});e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));})()`;
const SUBMIT = { js: "document.querySelector('[role=dialog] button[type=submit]')?.click()" }; // the main button of the open window, in either language
// press a button inside the open window by its words (exact)
const press = (words, scope = "[role=dialog]") => ({ js: `(()=>{const b=[...document.querySelectorAll(${JSON.stringify(scope + " button")})].find(x=>x.innerText.trim()===${JSON.stringify(words)});if(b)b.click();})()` });
// give a thing a short name (data-g) so a numbered mark can find it in either language
const tg = (name, expr) => ({ js: `(()=>{const e=(${expr});if(e)e.setAttribute('data-g',${JSON.stringify(name)});})()` });
const textIs = (sel, text) => `[...document.querySelectorAll(${JSON.stringify(sel)})].find(x=>x.innerText.trim().toLowerCase()===${JSON.stringify(text.toLowerCase())})`;
const btn = (text) => `[...document.querySelectorAll('button')].find(b=>b.innerText.trim()==${JSON.stringify(text)})`;
const g = (name) => `css:[data-g="${name}"]`;
const TOP = { js: "document.querySelectorAll('*').forEach((e)=>{if(e.scrollTop>0)e.scrollTop=0});scrollTo(0,0)" };

const D = (id, as, spec) => ({ id, as, view: "desk", h: 900, ...spec });
const W = (id, as, spec) => ({ id, as, view: "wide", h: 900, ...spec });

// ── The Boss's and the MD's Home ──
// The parts of the dashboard get a name each (the analysis streams in after the page: wait for it). All the parts are taken from ONE page load:
// only the first picture opens the page, the others go on from it — so run the group together: ad2-an-
const HOME_TAGS = { js: `(()=>{const sec=(id,n)=>{const e=document.getElementById(id);const s=e&&(e.closest('section')||e);if(s)s.setAttribute('data-g',n);};
sec('accounts','accounts');sec('outlook','outlook');sec('trends','trends');
const a=document.getElementById('analysis');if(a)a.setAttribute('data-g','head');const so=document.getElementById('stands-out');if(so)so.setAttribute('data-g','stands');})()` };
// Tags the smallest thing inside `scope` whose words are `text` (or begin with them); `up` climbs to its parent (a number of steps) or to the card that holds it ("card").
const tag = (scope, text, name, o = {}) => ({ js: `(()=>{const root=document.querySelector('[data-g="${scope}"]')||document.body;const w=${JSON.stringify(String(text).toLowerCase())};
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
el.setAttribute('data-g',${JSON.stringify(name)});})()` });
const HEAD = { up: 3 }; // the whole heading row of a part
const OPEN = [{ wait: 11000 }, HOME_TAGS, { wait: 2500 }];
/** A picture of one part: `marks` = [number, scope, words, options]; the tags are made first (named for this picture alone), then the marks name them.
 *  words = null: the mark goes on the scope itself. */
const part = (id, scope, marks, o = {}) => {
  const ns = id.replace("ad2-", "").replace(/-/g, "_");
  const nm = (n) => `${ns}_m${n}`;
  const steps = [...(o.open ? OPEN : []), ...(o.pre ?? [])];
  const out = [];
  for (const [n, sc, words, opt = {}] of marks) {
    const { at, up, nth, ...rest } = opt;
    if (words === null) { out.push([n, g(sc), { at, ...rest }]); continue; }
    steps.push(tag(sc, words, nm(n), { up, nth }));
    out.push([n, g(nm(n)), { at, ...rest }]);
  }
  const clip = (o.clip ?? [g(scope)]).map((c) => (typeof c === "number" ? g(nm(c)) : c));
  return W(id, BOSS, { ...(o.open ? { url: "/admin/dashboard" } : {}), h: 9000, steps, clip, pad: 20, marks: out });
};

const HOME = [
  D("ad2-menu", BOSS, { h: 2380, url: "/admin/dashboard", clip: "css:aside", pad: 0 }),
  D("ad2-home", BOSS, { h: 1000, url: "/admin/dashboard", marks: [[1, 'css:nav[aria-label="Jump to"]', T], [2, "css:#attention > *:first-child", L]] }),
  D("ad2-md-home", MD, { h: 1000, url: "/admin/dashboard" }),
];
// the analysis, part by part (ONE group: `ad2-an-`)
const ANALYSIS = [
  part("ad2-an-1", "head", [[1, "head", null], [2, "sub", null, { at: "r" }], [3, "stands", null], [4, "first", null, { at: "l" }]],
    { open: true, clip: [g("head"), g("stands")], pre: [tg("sub", "document.querySelector('[data-g=head] h2')?.nextElementSibling"), tg("first", "document.querySelector('[data-g=stands] ul li')")] }),
  part("ad2-an-2", "accounts", [[1, "accounts", "where the money is", HEAD], [2, "accounts", "in all accounts", { up: "card" }], [3, "accounts", "by kind of account", { up: 1 }], [4, "accounts", "cash", { up: "card", nth: 1 }], [5, "accounts", "withdraw funds"]]),
  part("ad2-an-3", "outlook", [[1, "outlook", "cash outlook", HEAD], [2, "outlook", "in the accounts", { up: "card" }], [3, "outlook", "owed to the hotel", { up: "card" }], [4, "outlook", "owed to suppliers", { up: "card" }], [5, "outlook", "days the money lasts", { up: "card" }],
    [6, "outlook", "who owes the hotel — how late", { up: "card" }], [7, "outlook", "what the hotel owes — when it falls due", { up: "card" }], [8, "outlook", "next to pay"],
    [9, "outlook", "how fast the money goes", { up: "card" }], [10, "outlook", "rooms booked ahead", { up: "card" }]]),
  part("ad2-an-4", "trends", [[1, "trends", "how the hotel is doing", HEAD], [2, "trends", "the key figures", { up: "card" }], [3, "trends", "the last six months", { up: "card" }], [4, "trends", "occupancy", { up: "card", nth: 2 }], [5, "trends", "which days earn most", { up: "card" }]], { clip: [1, 2, 3, 5] }),
  part("ad2-an-4b", "trends", [[1, "trends", "income against the period before", { up: "card" }], [2, "trends", "expenses against the period before", { up: "card" }]], { clip: [1, 2] }),
];

// ── Finance's own Home (what Finance sees, which the Boss and the MD do not have in their menu) ──
const FIN_TAGS = { js: `(()=>{const m=document.getElementById('money');if(!m)return;const c=[...m.parentElement.children];
c[0].setAttribute('data-g','hero');c[1].setAttribute('data-g','quick');c[2].setAttribute('data-g','jump');c[3].setAttribute('data-g','needs');m.setAttribute('data-g','money');})()` };
const FINANCE = [
  W("ad2-fin-home", FIN, { url: "/finance/dashboard", full: true, max: 4000, steps: [{ wait: 8000 }, FIN_TAGS], clip: [g("hero"), g("needs")], pad: 20,
    marks: [[1, g("quick")], [2, g("jump")], [3, g("needs")]] }),
];

// ── People: the accounts, adding one, the roles ──
const cellOf = (name) => `[...document.querySelectorAll('tbody tr')].find(r=>r.innerText.includes(${JSON.stringify(name)}))?.querySelectorAll('td')[2]`;
const PEOPLE = [
  D("ad2-users", BOSS, { h: 1180, url: "/staff/users", steps: [tg("grace", cellOf("Grace Mushi")), tg("peter", cellOf("Peter Kimaro"))],
    marks: [[1, "Add staff"], [2, g("grace"), { at: "r", dx: -34 }], [3, g("peter"), { at: "r", dx: -34 }]] }),
  D("ad2-roles", BOSS, { h: 1000, url: "/staff/users", steps: [{ click: "Role permissions", then: 1800 }, tg("th-acc", textIs("th", "Accountant")), tg("th-fin", textIs("th", "Finance"))],
    marks: [[1, g("th-acc"), { at: "b" }], [2, g("th-fin"), { at: "b" }]] }),
];

// ── Settings: the most Finance may authorize alone (typed here, NOT saved) ──
const SETTINGS = [
  D("ad2-limit", BOSS, { h: 3200, url: "/staff/settings", steps: [{ js: fill("input#financeAuthorizationLimit", 450000) }, tg("card", "document.querySelector('input#financeAuthorizationLimit')?.closest('[data-slot=card]')"), { wait: 400 }],
    clip: g("card"), pad: 18, marks: [[1, 'css:label[for="expenseApprovalThreshold"]', L], [2, 'css:label[for="financeAuthorizationLimit"]', L], [3, "css:#purchaseApproverMustDiffer", L]] }),
];

// ── An account: its opening balance (the dialog is filled in, NOT saved) ──
const ACCOUNT = [
  D("ad2-ob-page", BOSS, { h: 1100, url: "/staff/finance/accounts/acct_ntzs?period=month", steps: [{ wait: 1500 }, tg("ob", btn("Opening balance")), tg("wd", btn("Withdraw funds"))],
    marks: [[1, "In the books", { up: 1, at: "l" }], [2, g("ob")], [3, g("wd")]] }),
];

// ── Purchase requests, as the Boss sees them ──
const PURCHASES = [
  D("ad2-pr-queue", BOSS, { h: 1100, url: "/staff/stock-requests", steps: [TOP], marks: [[1, "To review", L], [2, "Shopping list", L]] }),
];

export const ZH = (list) => list.map((s) => ({ ...s, id: s.id + "-zh", lang: "zh", like: s.id }));

// ── Withdraw funds (the practice copy talks to a PRETEND nTZS on this computer) ──
// ad2-w-page / ad2-w-form / ad2-w-check only look (the check asks for a price: nothing is sent, the price is dropped by itself).
// ad2-w-sent and ad2-w-done SEND a small withdrawal to a pretend Lipa number — ONE withdrawal for English and ONE for 中文, each completed
// before the next. Run them by their full names, in the order: form → check → sent → done.
const WD = "/staff/finance/withdraw";
const leaf = (...texts) => `[...document.querySelectorAll('[role=dialog] *')].find(e=>e.children.length===0&&${JSON.stringify(texts.map((x) => x.toLowerCase()))}.includes((e.innerText||'').trim().toLowerCase()))`;
const firstWith = (...texts) => `[...document.querySelectorAll('[role=dialog] *')].filter((e)=>{const s=(e.innerText||'').trim().toLowerCase();return ${JSON.stringify(texts.map((x) => x.toLowerCase()))}.some((x)=>s.startsWith(x))&&s.length<70;}).sort((a,b)=>a.innerText.length-b.innerText.length)[0]`;
const OPEN_FORM = { js: "(()=>{const b=[...document.querySelectorAll('section button')].find((x)=>!x.disabled);if(b)b.click();})()" };
const WAY = (i) => ({ js: `document.querySelectorAll('[role=dialog] div.grid.grid-cols-3 button')[${i}]?.click()` }); // 0 phone, 1 Lipa, 2 bank — the same in either language
const FORM = (lipa) => [OPEN_FORM, { wait: 1000 }, WAY(1), { wait: 500 }, { js: fill("input#wd-amount", 2500) }, { js: fill("input#wd-lipa", lipa) }, { js: pick("CRDB Bank", "select#wd-books") }, { wait: 500 }];
const WD_PAGE = [
  D("ad2-w-page", BOSS, { h: 1250, url: WD, steps: [tg("wbtn", "[...document.querySelectorAll('section button')].find((x)=>!x.disabled)"), tg("num", "document.querySelector('tbody tr td:nth-child(2) button')||document.querySelector('tbody tr td:nth-child(2)')"), tg("state", "document.querySelector('tbody tr td:nth-child(5)')")],
    marks: [[1, g("wbtn")], [2, "Available to withdraw", { up: 1 }], [3, "On its way", { up: 1 }], [4, "Withdrawn", { up: 2 }], [5, g("num")], [6, g("state")]] }),
];
// ── A purchase above Finance's limit, made by hand for these pictures (it is OUR record: 2 luggage trolleys, quoted at 520,000) ──
// Every step that SAVES is run ONCE, by its own name, in this order:
//   x-ask (Reception sends it) → x-approve (Finance approves with a budget of 400,000) → x-quote (Purchasing quotes and proposes 520,000)
//   → x-limit-set (the Finance limit 450,000) → the pictures → ad2-auth-done (the Boss authorizes) → x-limit-clear (the limit is emptied again)
const SR = "SR-2026-0010"; // the number it was given (set after x-ask)
const REQ = "/staff/stock-requests";
const SAVING = [
  D("ad2-x-ask", ASHA, { url: REQ, h: 1500, steps: [{ click: "Furniture & equipment" }, { click: "Luggage trolleys" }, { js: fill('input[aria-label="How many"]', 2, 1) },
    { js: fill('input[placeholder^="What is it for"]', "Two trolleys for the guests' luggage: the old one is broken") }, { js: fill('input[aria-label="Estimated cost (TZS)"]', "400000") },
    { js: fill('input[placeholder^="Note for Finance"]', "Needed for the weekend arrivals") }, { wait: 300 }, { click: "Check the list" }, { wait: 600 }, { click: "Send 1 item to Finance" }, { wait: 1800 }] }),
  D("ad2-x-approve", FIN, { url: REQ, h: 900, steps: [{ click: SR }, { wait: 800 }, { click: "Approve for purchase" }, { wait: 1800 }] }),
  D("ad2-x-quote", BUY, { url: "/staff/procurement", h: 1300, steps: [{ click: SR }, { wait: 1300 }, { click: "Add a quotation" }, { wait: 500 }, { js: pick("Uhuru Hotel Supplies", "select#q-supplier") },
    { js: fill('input[aria-label="Price each (TZS)"]', 260000, 1) }, { js: fill("input#q-valid", "2026-10-31") }, { js: fill("input#q-days", 3) }, { wait: 300 }, { click: "Record the quotation" }, { wait: 1800 },
    { click: "Propose this one" }, { wait: 1800 }] }),
  D("ad2-x-limit-set", BOSS, { url: "/staff/settings", h: 1300, steps: [{ js: fill("input#financeAuthorizationLimit", 450000) }, { wait: 300 }, { click: "Save settings" }, { wait: 2500 }] }),
  D("ad2-x-limit-clear", BOSS, { url: "/staff/settings", h: 1300, steps: [{ js: fill("input#financeAuthorizationLimit", "") }, { wait: 300 }, { click: "Save settings" }, { wait: 2500 }] }),
];
const WS = "/staff/procurement/cmv722yox00403lsb4iucg49l"; // the workspace of SR-2026-0010
const CHAIN = (as, steps, spec) => D("", as, { url: WS, h: 1300, steps: [{ wait: 6000 }, ...steps], ...spec });
// What the limit shows — taken while the limit is set and the purchase waits (these only look, or open a window)
const LIMIT = [
  D("ad2-limit-home", BOSS, { h: 1000, url: "/admin/dashboard", steps: [{ click: "Money", then: 900 }], marks: [[1, "Money", T], [2, "purchase price above Finance's limit", L]] }),
  D("ad2-proc-board", BOSS, { h: 900, url: "/staff/procurement?tab=authorize", steps: [TOP], marks: [[1, "With Finance"], [2, SR, L]] }),
  { ...CHAIN(BOSS, [TOP, tg("hdr", "document.querySelector('main h1')"), tg("wait", "[...document.querySelectorAll('main button')].find(b=>b.innerText.includes('Authorize this price'))?.closest('section')||[...document.querySelectorAll('main button')].find(b=>b.innerText.includes('Authorize this price'))?.parentElement?.parentElement"),
    tg("bud", "[...document.querySelectorAll('main div')].find(e=>(e.innerText||'').startsWith('Approved budget')&&e.innerText.length<60)")],
    { id: "ad2-auth-open", clip: [g("hdr"), g("wait")], pad: 34, marks: [[1, g("bud")], [2, g("wait"), L], [3, "Authorize this price"], [4, "Send back"]] }) },
];
const LOOK = [...HOME, ...ANALYSIS, ...FINANCE, ...PEOPLE, ...SETTINGS, ...ACCOUNT, ...PURCHASES];
// ── The pictures with a window: the same steps in either language (words by `w`, buttons by their place), so they are not copies made with `like` ──
const view = process.env.AD2_DONE === "view";
const dlg = (zh) => {
  const w = (en, cn) => (zh ? cn : en);
  const sfx = zh ? "-zh" : "";
  const S = (id, as, o) => D(id + sfx, as, { ...(zh ? { lang: "zh" } : {}), ...o });
  const dialog = 'css:[role="dialog"]';
  const clickBtn = (...texts) => ({ js: `(()=>{const t=${JSON.stringify(texts)};const b=[...document.querySelectorAll('button')].find((x)=>t.some((s)=>x.innerText.trim().includes(s)));if(b)b.click();})()` });
  const NOTE = w("The guests arrive on Friday and the old trolley is broken.", "客人周五到店，旧的行李车坏了。");
  const AUTH = clickBtn("Authorize this price", "授权此价格");
  const chain = (as, steps, { id, ...spec }) => S(id, as, { url: WS, h: 1300, steps: [{ wait: 6000 }, ...steps], ...spec });
  const out = {
    usersAdd: S("ad2-users-add", BOSS, { h: 1000, url: "/staff/users", steps: [clickBtn("Add staff", "添加员工"), { wait: 900 }, { js: pick(w("Finance", "财务"), "[role=dialog] select") }, { wait: 500 }],
      clip: dialog, pad: 22, marks: [[1, 'css:[role="dialog"] select##1', { at: "in", dx: 150 }], [2, 'css:[role="dialog"] select#roleId', { at: "in", dx: 150 }]] }),
    obForm: S("ad2-ob-form", BOSS, { h: 1100, url: "/staff/finance/accounts/acct_petty?period=month", steps: [{ wait: 2000 }, clickBtn("Opening balance", "期初余额"), { wait: 900 },
      { js: fill('[role=dialog] input[name="amount"]', 150000) }, { js: fill('[role=dialog] textarea[name="reason"]', w("Cash in the box when the hotel's records began", "酒店开始记录时盒子里的现金")) }, { wait: 300 }],
      clip: dialog, pad: 22, marks: [[1, 'css:[role="dialog"] input[name="amount"]', L], [2, 'css:[role="dialog"] textarea[name="reason"]', L], [3, 'css:[role="dialog"] button[type="submit"]', L]] }),
    authForm: chain(BOSS, [AUTH, { wait: 700 }, { js: fill("[role=dialog] textarea", NOTE) }, { wait: 300 }],
      { id: "ad2-auth-form", clip: dialog, pad: 22, marks: [[1, 'css:[role="dialog"] textarea', L], [2, 'css:[role="dialog"] button[type="submit"]', L]] }),
    finLimit: chain(FIN, [AUTH, { wait: 700 }, SUBMIT, { wait: 2200 }],
      { id: "ad2-fin-limit", h: 1000, marks: [[1, "css:[data-sonner-toast]", { at: "l" }], [2, 'css:[role="dialog"] button[type="submit"]', { at: "l" }]] }),
    authDone: chain(BOSS, [AUTH, { wait: 700 }, { js: fill("[role=dialog] textarea", NOTE) }, { wait: 300 }, SUBMIT, { wait: 2500 }, TOP],
      { id: "ad2-auth-done", marks: [[1, w("Price authorized — ready to order", "价格已授权——可下单"), { self: true, at: "t" }], [2, w("Purchase order", "采购订单"), L]] }),
  };
  // Withdraw funds: the form, the check, the sending of ONE small withdrawal to a pretend Lipa number, and its end
  const lipa = zh ? "400124" : "400123";
  const SENDBTN = "[role=dialog] button.flex-1";
  out.wd = [
    S("ad2-w-form", BOSS, { h: 1300, url: WD, steps: FORM(lipa), clip: dialog, pad: 22,
      marks: [[1, 'css:[role="dialog"] input#wd-amount', L], [2, 'css:[role="dialog"] div.grid.grid-cols-3', L], [3, 'css:[role="dialog"] input#wd-lipa', L], [4, 'css:[role="dialog"] select#wd-books', L], [5, 'css:[role="dialog"] button[type="submit"]', L]] }),
    S("ad2-w-check", BOSS, { h: 1300, steps: [SUBMIT, { wait: 4500 }, tg("paycard", leaf(w("paying", "付款给")) + "?.closest('div[class*=rounded]')"), tg("gets", leaf(w("the recipient gets", "收款人到账")) + "?.parentElement"),
      tg("lines", firstWith(w("nTZS's fee", "nTZS 的手续费")) + "?.closest('dl')"),
      tg("timer", `[...document.querySelectorAll('[role=dialog] span')].find((e)=>(e.innerText||'').trim().toLowerCase()===${JSON.stringify(w("this price holds for", "此价格还有效"))})?.parentElement?.parentElement`),
      tg("tick", "document.querySelector('[role=dialog] input[type=checkbox]')?.closest('label')"), tg("send", `document.querySelector(${JSON.stringify(SENDBTN)})`)],
      clip: dialog, pad: 22, marks: [[1, g("paycard")], [2, g("gets")], [3, g("lines")], [4, g("timer")], [5, g("tick")], [6, g("send")]] }),
    // SAVES: sends the withdrawal
    S("ad2-w-sent", BOSS, { h: 1300, steps: [{ js: "document.querySelector('[role=dialog] input[type=checkbox]')?.click()" }, { wait: 600 }, { js: `document.querySelector(${JSON.stringify(SENDBTN)})?.click()` }, { wait: 9000 },
      tg("title", "document.querySelector('[role=dialog] h2')||document.querySelector('[role=dialog] [data-slot=dialog-title]')"), tg("paycard", leaf("paying", "付款给") + "?.closest('div[class*=rounded]')"), tg("close", "document.querySelector('[role=dialog] button.w-full')")],
      clip: dialog, pad: 22, marks: [[1, g("title")], [2, g("paycard")], [3, g("close")]] }),
    // SAVES (unless AD2_DONE=view): a quarter of a minute later the pretend nTZS says "paid" — "Ask nTZS now" in the window of the withdrawal writes the books
    S("ad2-w-done", BOSS, { h: 1300, ...(view ? { url: WD } : {}),
      steps: [...(view ? [{ wait: 1500 }] : [{ js: "document.querySelector('[role=dialog] button.w-full')?.click()" }, { wait: 16000 }]),
        { js: "document.querySelector('tbody tr td:nth-child(2) button')?.click()" }, { wait: 2000 },
        ...(view ? [] : [clickBtn("Ask nTZS now", "立即向 nTZS 查询"), { wait: 5000 }]),
        tg("st", `[...document.querySelectorAll('[role=dialog] span')].find((e)=>['Completed','已完成'].includes((e.innerText||'').trim()))`),
        tg("arr", firstWith("Arrived", "已到账") + "?.closest('div')"), tg("bk", firstWith("In the hotel's books", "酒店账簿中") + "?.closest('div')"),
        tg("hist", leaf("What happened", "发生了什么") + "?.parentElement")],
      clip: dialog, pad: 22, marks: [[1, g("st")], [2, g("arr")], [3, g("bk")], [4, g("hist")]] }),
  ];
  return out;
};
const EN = dlg(false), ZHD = dlg(true);

// windows that only look (opened, filled in, never saved): both languages, always
const DLG_LOOK = [EN.usersAdd, EN.obForm, ZHD.usersAdd, ZHD.obForm];
// 中文: the finished purchase seen again
const DONE_ZH = [D("ad2-auth-done-zh", BOSS, { lang: "zh", url: WS, h: 1300, steps: [{ wait: 6000 }, TOP], marks: [[1, "价格已授权——可下单", { self: true, at: "t" }]] })];
// the ones that need the purchase and the limit, and the ones that save: only when named in full
const NAMED = [...SAVING, ...LIMIT, ...ZH(LIMIT), EN.authForm, ZHD.authForm, EN.finLimit, ZHD.finLimit, EN.authDone, ...DONE_ZH, ...EN.wd, ...ZHD.wd, ...WD_PAGE, ...ZH(WD_PAGE)];
const ask = process.argv.slice(2).filter((a) => !a.startsWith("--"));
export const SHOTS = [...LOOK, ...(process.env.AD2_ZH === "0" ? [] : ZH(LOOK)), ...DLG_LOOK, ...NAMED.filter((s) => ask.includes(s.id))];
