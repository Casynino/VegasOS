// Boss and MD books (08 and 09), checker's pictures. Only looks — nothing is saved. English and 中文 (the "-zh" ones find every thing
// where the English ones found it: `like`). Taken again after the menu was put in its new order and the room tiles said Paid / Not paid.
//
//   node guides/tools/shoot.mjs --list=shots-ad3 ad3-          the room tiles on the Boss's Home
//   node guides/tools/shoot.mjs --list=shots-ad3 a-            every whole-window picture of the Boss's pages (English, then 中文)
import { ADMIN } from "./admin.mjs";

const BOSS = "owner@vegas.test";
const tg = (name, expr) => ({ js: `(()=>{const e=(${expr});if(e)e.setAttribute('data-g',${JSON.stringify(name)});})()` });
const g = (name) => `css:[data-g="${name}"]`;
const TAB = (n) => [{ click: `css:[role=tablist] [role=tab]##${n}`, then: 1500 }];
const DAY = "/staff/reports/daily/cmv5d2ztt008jeksb7vb3a8xj";
const A = (id, url, spec = {}) => ({ id, as: BOSS, view: "desk", h: 900, url, ...spec });

// the panel "Every room right now" on the Boss's Home; the tiles that say Paid, Not paid, Part paid, Group pays (a guest's room, not the meeting room)
const PANEL = tg("rooms", "[...document.querySelectorAll('h2')].find((h)=>/every room right now|所有房间实时状态/i.test(h.innerText))?.closest('section')");
const tile = (name, words) => tg(name, `(()=>{const p=document.querySelector('[data-g="rooms"]');if(!p)return null;const w=${JSON.stringify(words)};
return [...p.querySelectorAll('li button')].find((b)=>{const t=(b.innerText||'').split('\\n').map((x)=>x.trim());return t.some((x)=>w.includes(x))&&!t.some((x)=>/^(meeting room|会议室)$/i.test(x));});})()`);
// the "Rooms today" part whole: the rooms ring, the Money today card (with Rooms paid) and the room tiles
const PART = tg("part", "document.getElementById('rooms')");
const ROOMS_HOME = A("ad3-home-rooms", "/admin/dashboard", {
  view: "wide", h: 5000,
  steps: [{ wait: 6000 }, PANEL, PART, tile("t-paid", ["Paid", "已付款"]), tile("t-not", ["Not paid", "未付款"]), tile("t-part", ["Part paid", "部分付款"]), tile("t-group", ["Group pays", "团体付款"]),
    tg("paid", "[...document.querySelectorAll('[data-g=part] *')].filter((e)=>e.children.length===0&&['Rooms paid','已付款房间'].includes((e.innerText||'').trim()))[0]?.parentElement?.parentElement"), { wait: 300 }],
  clip: g("part"), pad: 18,
  marks: [[1, g("paid"), { self: true }], [2, g("t-paid"), { self: true, at: "tr" }], [3, g("t-not"), { self: true, at: "tr" }], [4, g("t-part"), { self: true, at: "tr" }], [5, g("t-group"), { self: true, at: "tr" }]],
});

const KEEP = new Set(["a-rooms", "a-income", "a-owes", "a-collections", "a-history", "a-ledger", "a-companies", "a-cal", "a-rest-live", "a-waiters", "a-requests", "a-transport",
  "a-customers", "a-messages", "a-shifts", "a-activity", "a-assets", "a-inventory", "a-pricing", "a-settings", "a-menuprices", "a-exptypes", "a-website", "a-languages"]);
const OTHERS = [
  A("a-daily-4", "/staff/reports/daily"),
  A("a-daily-2", DAY, { marks: [[1, "Print"], [2, "PDF"], [3, "Share"], [4, "Send now"], [5, "Regenerate"]] }),
  A("a-shifts-all", "/staff/shifts/all"),
  A("a-reports", "/staff/reports", { marks: [[1, "Print"], [2, "PDF"], [3, "Share"]] }),
  A("a-spin-3", "/staff/spin-to-win", { steps: TAB(3) }),
  A("a-spin-4", "/staff/spin-to-win", { steps: TAB(4) }),
];
// Income: a stretch of days with payments in it (the new hotel day starts empty)

// The extra pages of the Finance bar (only looks)
const MORE = [
  A("ad3-fin-bar", "/staff/finance", { h: 700, clip: "css:nav[aria-label=Finance], nav[aria-label=财务]", pad: 8 }),
  A("ad3-fin-rooms", "/staff/finance/rooms"),
  A("ad3-fin-staff", "/staff/finance/staff"),
  A("ad3-fin-invoices", "/staff/invoices"),
  A("ad3-fin-disc", "/staff/accountant/discounts"),
  A("ad3-fin-prices", "/staff/accountant/prices"),
  A("ad3-fin-refunds", "/staff/accountant/reports"),
];
const EN = [...ADMIN.filter((s) => KEEP.has(s.id)), ...OTHERS].map((s) => (s.id === "a-income" ? { ...s, url: "/staff/payments?from=2026-10-01&to=2026-10-13" } : s));
const ZH = (s) => ({ ...s, id: s.id + "-zh", lang: "zh", like: s.id });

// the MD's Home in both languages, a little lower than the Boss's (the two sit side by side in the book)
const MD_HOME = A("ad2-md-home", "/admin/dashboard", { as: "admin@vegas.test", h: 700 });

// "Where the money is" (the parts of the picture found by their words, in either language)
const leaf = (words, right) => `[...document.querySelectorAll('[data-g=accounts] *')].filter((e)=>e.children.length===0&&${JSON.stringify(words)}.includes((e.innerText||'').trim().toLowerCase())&&${right ? "e.getBoundingClientRect().left>480" : "true"})[0]`;
const wide = (e) => `(()=>{let e=${e};while(e&&e.parentElement&&e.parentElement.getBoundingClientRect().width<400)e=e.parentElement;return e;})()`;
const AN2 = A("ad2-an-2", "/admin/dashboard", { view: "wide", h: 9000, pad: 20, clip: g("accounts"),
  steps: [{ wait: 11000 }, { js: "(()=>{const e=document.getElementById('accounts');const s=e&&(e.closest('section')||e);if(s)s.setAttribute('data-g','accounts');})()" }, { wait: 2500 },
    tg("an2-head", "document.querySelector('[data-g=accounts]').firstElementChild"), tg("an2-ring", wide(leaf(["in all accounts", "全部账户合计"]))), tg("an2-kind", `(${leaf(["by kind of account", "按账户类型"])})?.parentElement`),
    tg("an2-cash", wide(leaf(["cash", "现金"], true))), tg("an2-wd", leaf(["withdraw funds", "提现"], true))],
  marks: [[1, g("an2-head"), { self: true }], [2, g("an2-ring"), { self: true }], [3, g("an2-kind"), { self: true, at: "r" }], [4, g("an2-cash"), { self: true }], [5, g("an2-wd")]] });

export const SHOTS = [...MORE, ...MORE.map(ZH), AN2, { ...AN2, id: "ad2-an-2-zh", lang: "zh" }, MD_HOME, { ...MD_HOME, id: "ad2-md-home-zh", lang: "zh" }, ROOMS_HOME, { ...ROOMS_HOME, id: "ad3-home-rooms-zh", lang: "zh" }, ...EN, ...EN.map(ZH)];
