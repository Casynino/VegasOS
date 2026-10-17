// What every guide book shares: the words around the chapters (English and 中文), who to ask for help,
// and the one drawing of how the departments of the hotel work together.

export const CONTACT = {
  name: "Nino",
  email: "casmiry21@icloud.com",
  tz: "+255 752 828 082",
  tzLink: "https://wa.me/255752828082",
  cn: "+86 155 2761 0603",
  web: "www.vegashoteltz.com/nino",
  site: "www.vegashoteltz.com",
};

export const L = {
  en: {
    hotel: "Vegas Luxury Hotel",
    guide: "Guide book",
    edition: "Edition 2 · October 2026",
    by: "System and guide book developed by",
    chapter: "Chapter",
    contents: "What is in this book",
    page: "Page",
    when: "When",
    note: { tip: "Tip", warn: "Careful", rule: "Rule" },
    help: `Help: Nino · WhatsApp ${CONTACT.tz}`,
    read: [
      ["Follow the numbers", "The gold numbers on a picture are the same numbers as the steps written under it."],
      ["Words in a box", "A word in a small box, like [[Check in]], is a button or a menu you press on the screen."],
      ["Pictures are examples", "The pictures were taken on a practice copy of the system. The names, rooms and amounts in them are examples, not real guests."],
    ],
    together: "How the hotel works together",
    togetherLead: "No department works alone. What you press on your screen appears on somebody else's screen a moment later. This page shows the whole hotel; the gold lines are the ones your department uses every day.",
    journeyTitle: "One guest, from booking to goodbye",
    last: "Golden rules and when something goes wrong",
    lastLead: "The few things that must always be done the same way — and what to do when the system or the day does not go as planned.",
    rulesTitle: "The golden rules",
    problemsTitle: "If something goes wrong",
    problemsHead: ["What you see", "What to do"],
    support: {
      kicker: "Help and support",
      title: "Need help? Ask Nino.",
      lead: "This guide book and the whole Vegas Luxury Hotel system — the website, the staff system, the QR codes and the automatic reports — were designed and developed by **Nino**. If something does not work the way this book says, or you want something changed or added, write or call.",
      rows: [
        ["WhatsApp · Tanzania", CONTACT.tz, "The fastest way. Send a message and a photo of the screen."],
        ["WhatsApp · China", CONTACT.cn, "When Nino is in China — message any time."],
        ["Email", CONTACT.email, "For longer requests, new features and documents."],
        ["Website", CONTACT.web, "About the developer and other work."],
      ],
      qr: "Scan to open WhatsApp with Nino",
      sendTitle: "When you write, send these — the problem is fixed faster",
      send: ["Your name and your role", "The page you were on", "What you pressed, and what happened", "A photo or screenshot of the screen", "The time it happened", "The room, order or booking number, if there is one"],
      first: "A question about a guest, a price or a hotel rule? Ask the **manager on duty** first. A question about the system itself? Ask **Nino**.",
      end: "**Vegas Luxury Hotel** · www.vegashoteltz.com<br>Guide book edition 2, October 2026. The pictures come from a practice copy of the system; names and amounts in them are examples.",
    },
  },
  zh: {
    hotel: "Vegas Luxury Hotel",
    guide: "使用手册",
    edition: "第 2 版 · 2026 年 10 月",
    by: "系统与手册开发：",
    chapter: "第 {n} 章",
    contents: "本手册内容",
    page: "页",
    when: "何时使用",
    note: { tip: "提示", warn: "注意", rule: "规定" },
    help: `技术支持：Nino · WhatsApp ${CONTACT.tz}`,
    read: [
      ["跟着数字走", "图片上的金色数字，与图片下方的步骤编号一一对应。"],
      ["方框里的文字", "像 [[办理入住]] 这样带小方框的文字，是屏幕上要点击的按钮或菜单。"],
      ["图片仅为示例", "所有图片均来自系统的练习副本，图中的姓名、房间和金额都是示例，不是真实客人。"],
    ],
    together: "酒店各部门如何协同工作",
    togetherLead: "没有哪个部门是单独工作的。您在屏幕上点击的内容，片刻之后就会出现在其他同事的屏幕上。本页展示整个酒店的运作；金色线条是与您最相关的连接。",
    journeyTitle: "一位客人：从预订到离店",
    last: "黄金规则与常见问题",
    lastLead: "少数必须始终按同一方式执行的事项，以及当系统或当天情况不如预期时应该怎么做。",
    rulesTitle: "黄金规则",
    problemsTitle: "遇到问题时",
    problemsHead: ["您看到的情况", "处理方法"],
    support: {
      kicker: "帮助与支持",
      title: "需要帮助？请联系 Nino。",
      lead: "本手册以及整套 Vegas Luxury Hotel 系统——网站、员工系统、二维码和自动报表——均由 **Nino** 设计并开发。如果系统的表现与本手册不一致，或者您希望修改、增加功能，请随时联系。",
      rows: [
        ["WhatsApp · 坦桑尼亚", CONTACT.tz, "最快的方式。请发送文字说明和屏幕照片。"],
        ["WhatsApp · 中国", CONTACT.cn, "Nino 在中国期间，可随时留言。"],
        ["电子邮箱", CONTACT.email, "适合较长的需求、新功能和文件。"],
        ["网站", CONTACT.web, "开发者介绍及其他作品。"],
      ],
      qr: "扫码用 WhatsApp 联系 Nino",
      sendTitle: "联系时请提供以下信息，问题会更快解决",
      send: ["您的姓名和职位", "当时所在的页面", "您点击了什么、出现了什么", "屏幕照片或截图", "发生的时间", "相关的房间、订单或预订编号（如有）"],
      first: "关于客人、价格或酒店规定的问题，请先询问**当班经理**；关于系统本身的问题，请联系 **Nino**。",
      end: "**Vegas Luxury Hotel** · www.vegashoteltz.com<br>手册第 2 版，2026 年 10 月。图片来自系统的练习副本，其中的姓名和金额均为示例。",
    },
  },
};
export const chapterLabel = (lang, n) => (lang === "zh" ? L.zh.chapter.replace("{n}", n) : `${L.en.chapter} ${n}`);

// ── the drawing ────────────────────────────────────────────────────────────────────────────────────────────────────
// The picture has two parts. Above: the guest and the daily work (lines 1–10), then the Manager and the MD and Boss.
// Below, under its own small title: buying and money (lines 11–16) — Finance, Purchasing, and who asks and who pays in.
//
// A book says which department it is with `dept`. These ids are used: guest (also written "guests"), reception, counter, waiter,
// kitchen, housekeeping, driver, manager, admin, finance, purchasing (also written "accountant").
const ALIAS = { guests: "guest", accountant: "purchasing" };
const who = (...ids) => ids.flatMap((i) => (i === "guest" ? ["guest", "guests"] : i === "purchasing" ? ["purchasing", "accountant"] : [i]));

const NODES = {
  guest: { x: 240, y: 4, w: 240, h: 54, dark: true },
  reception: { x: 0, y: 118, w: 156, h: 60 },
  counter: { x: 188, y: 118, w: 156, h: 60 },
  waiter: { x: 376, y: 118, w: 156, h: 60 },
  kitchen: { x: 564, y: 118, w: 156, h: 60 },
  housekeeping: { x: 0, y: 236, w: 156, h: 54, dashed: true },
  driver: { x: 188, y: 236, w: 156, h: 54 },
  stores: { x: 564, y: 236, w: 156, h: 54, dashed: true },
  manager: { x: 0, y: 322, w: 720, h: 38, band: true },
  admin: { x: 0, y: 388, w: 720, h: 38, band: true },
  finance: { x: 262, y: 472, w: 210, h: 72 },
  purchasing: { x: 548, y: 472, w: 172, h: 72 },
};
const WORDS = {
  en: {
    guest: ["The guest", "website · QR codes · stay link on the phone"],
    reception: ["Reception", "bookings · check-in and out", "room bills · requests"],
    counter: ["Restaurant Counter", "takes every restaurant", "payment · picks the waiter"],
    waiter: ["Waiters", "tables · orders · serving", "drinks from the bar"],
    kitchen: ["Kitchen (Mpishi)", "cooks the food", "presses Ready"],
    housekeeping: ["Housekeeping", "works from the printed", "daily checklist"],
    driver: ["Driver", "airport and guest trips", "on the phone"],
    stores: ["Stores and stock", "kept by the manager", "inside the system"],
    manager: ["Manager", "sees every desk above · watches the shifts · approves what staff cannot decide alone · keeps the stores · follows the money"],
    admin: ["MD and Boss", "set up rooms, prices, menu and staff · authorize large purchases · receive the automatic reports"],
    finance: ["Finance", "holds the money and the accounts", "reviews purchase requests", "pays the suppliers"],
    purchasing: ["Purchasing", "gets quotes · makes the orders", "records deliveries, invoices", "never approves or pays"],
    zone: "BUYING AND MONEY",
    asks: "Purchase requests",
    pays: "Money coming in",
    names: { reception: "Reception", counter: "Counter", kitchen: "Kitchen", online: "Online payments" },
  },
  zh: {
    guest: ["客人", "网站 · 二维码 · 手机上的住店链接"],
    reception: ["前台", "预订 · 入住与退房", "房账 · 客人需求"],
    counter: ["餐厅收银台", "收取餐厅全部款项", "指定服务员"],
    waiter: ["服务员", "餐桌 · 点单 · 上菜", "吧台酒水"],
    kitchen: ["厨房（厨师）", "制作菜品", "点击“已备好”"],
    housekeeping: ["客房清洁", "按打印的每日", "清洁清单工作"],
    driver: ["司机", "机场接送与用车", "在手机上查看"],
    stores: ["仓库与库存", "由经理在系统内", "管理"],
    manager: ["经理", "查看以上所有岗位 · 监督班次 · 审批员工不能自行决定的事项 · 管理库存 · 跟进款项"],
    admin: ["总经理与老板", "设置房间、价格、菜单和员工 · 授权大额采购 · 接收自动报表"],
    finance: ["财务", "掌管资金与账户", "审核采购申请", "向供应商付款"],
    purchasing: ["采购", "询价 · 下采购订单", "记录收货与供应商发票", "不审批、不付款"],
    zone: "采购与资金",
    asks: "采购申请",
    pays: "进账款项",
    names: { reception: "前台", counter: "收银台", kitchen: "厨房", online: "在线支付" },
  },
};
/** The two boxes of names above Finance: who asks to buy, and where the money comes from. `id` = the department that lights up. */
const PILLS = [
  { x: 0, y: 472, w: 214, h: 34, key: "asks", names: [["reception", "reception"], ["counter", "counter"], ["kitchen", "kitchen"]] },
  { x: 0, y: 510, w: 214, h: 34, key: "pays", names: [["reception", "reception"], ["counter", "counter"], ["guest", "online"]] },
];

/** The connections, in the order of their numbers. `who` = the departments that use the line every day. */
export const LINKS = [
  { who: who("guest", "reception", "manager", "admin"), en: ["Guest → Reception.", "A booking from the website, the Hotel QR code or a phone call arrives at Reception. From the QR code in the room a guest can also ask for towels, cleaning, a repair or a car."], zh: ["客人 → 前台。", "来自网站、酒店二维码或电话的预订会到达前台。客人还可以通过房间里的二维码申请毛巾、清洁、维修或用车。"] },
  { who: who("guest", "counter", "waiter", "kitchen", "manager", "admin"), en: ["Guest → Restaurant.", "An order from a table QR, the room QR or the restaurant QR appears on the Live board. The Counter, the waiters and the kitchen all see the same order."], zh: ["客人 → 餐厅。", "通过餐桌二维码、房间二维码或餐厅二维码下的订单会出现在实时看板上，收银台、服务员和厨房看到的是同一张订单。"] },
  { who: who("waiter", "kitchen", "manager"), en: ["Waiters ↔ Kitchen.", "Food goes to the Mpishi, who cooks it and presses Ready. The waiter hears the bell and serves. An order with drinks only is prepared by the waiter at the bar."], zh: ["服务员 ↔ 厨房。", "菜品订单交给厨师制作，完成后点击“已备好”，服务员听到提示音后上菜。只有酒水的订单由服务员在吧台准备。"] },
  { who: who("counter", "waiter", "manager"), en: ["Counter ↔ Waiters.", "The Counter chooses who serves an order and records every restaurant payment. Waiters serve; they do not record money."], zh: ["收银台 ↔ 服务员。", "收银台指定由谁服务订单，并记录餐厅的每一笔收款。服务员负责服务，不记录款项。"] },
  { who: who("reception", "counter", "manager", "admin"), en: ["Reception ↔ Restaurant.", "Food and drinks ordered to a room go onto the room bill. Reception sees the orders of hotel guests and collects the bill at check-out."], zh: ["前台 ↔ 餐厅。", "记入房间的餐饮消费会进入房账。前台可以看到住店客人的订单，并在退房时收取账款。"] },
  { who: who("reception", "housekeeping", "manager"), en: ["Reception → Housekeeping.", "A check-out turns the room to “Needs cleaning”. Housekeeping works from the printed daily checklist, and Reception marks the room clean and ready."], zh: ["前台 → 客房清洁。", "退房后房间变为“待清洁”。清洁人员按打印的每日清单工作，完成后由前台把房间标记为“已清洁可入住”。"] },
  { who: who("reception", "driver", "manager"), en: ["Reception → Driver.", "A transport request is confirmed and given to a driver. The driver sees the trip on the phone and presses each step of it."], zh: ["前台 → 司机。", "用车申请确认后分配给司机。司机在手机上看到行程，并逐步点击行程进度。"] },
  { who: who("manager", "reception", "counter", "waiter", "kitchen", "driver"), en: ["Everyone → Manager.", "The manager sees every open shift, room and order, approves what staff cannot decide alone, and can close a shift that was left open."], zh: ["所有岗位 → 经理。", "经理可以看到每个进行中的班次、房间和订单，审批员工不能自行决定的事项，并可关闭未结束的班次。"] },
  { who: who("manager", "admin"), en: ["Manager → MD and Boss.", "The MD sets up the system. The Boss receives the reports by WhatsApp without anyone writing them: after every shift, every day, every week and every month."], zh: ["经理 → 总经理与老板。", "总经理负责系统设置。老板通过 WhatsApp 收到自动生成的报表：每个班次、每天、每周、每月各一份。"] },
  { who: who("kitchen", "manager", "admin"), en: ["Kitchen → Stores.", "The kitchen and the bar use stock from the stores. Every movement in or out is written in the system, and waste needs the manager's approval. When something runs low, the kitchen asks for it (line 11)."], zh: ["厨房 → 仓库。", "厨房和吧台使用仓库的库存。每一次入库、出库都记录在系统中，报损需要经理审批。库存不足时，厨房通过采购申请提出需求（第 11 条）。"] },
  // ── buying and money ───────────────────────────────────────────────────────────────────────────────────────────
  { who: who("reception", "counter", "kitchen", "finance", "manager", "admin"), en: ["Departments → Finance.", "Reception, the Counter and the kitchen ask for what they need to buy in “Purchase requests”. Finance reviews each request: it approves it, sends it back to be changed, or rejects it. A manager can review too."], zh: ["各部门 → 财务。", "前台、收银台和厨房在“采购申请”中提出需要购买的东西。财务审核每一份申请：批准、退回修改或拒绝。经理也可以审核。"] },
  { who: who("finance", "purchasing", "admin"), en: ["Finance → Purchasing.", "When Finance approves a request, Purchasing (the Accountant) asks suppliers for quotes and proposes one. A price above the approved budget goes back to Finance to authorize. Then Purchasing makes the purchase order."], zh: ["财务 → 采购。", "财务批准申请后，采购（采购会计）向供应商询价并提出一个报价。高于已批准预算的价格要回到财务授权。然后采购下达采购订单。"] },
  { who: who("purchasing", "finance", "manager", "kitchen", "admin"), en: ["Purchasing → Stores.", "When the goods arrive, Purchasing records the delivery. Only what is accepted goes into the stores: the stock goes up by that amount and no more."], zh: ["采购 → 仓库。", "货物到达后，采购记录收货。只有验收通过的部分才入库：库存只增加这部分数量，不会多加。"] },
  { who: who("purchasing", "finance", "admin"), en: ["Purchasing → Finance.", "Purchasing records the supplier's invoice. Finance checks it against the order and the delivery, then pays the supplier. Only the real payment is an expense — never a request, an approval or an order."], zh: ["采购 → 财务。", "采购录入供应商发票。财务对照订单和收货核对发票，然后向供应商付款。只有真正的付款才算支出——申请、批准或订单都不算。"] },
  { who: who("reception", "counter", "guest", "finance", "manager", "admin"), en: ["Payments → Finance.", "Every payment that Reception or the Counter records, and every online payment, goes into one of the hotel's accounts. Finance sees all the accounts, the income and who still owes the hotel, and keeps the books."], zh: ["收款 → 财务。", "前台或收银台记录的每一笔收款，以及每一笔在线支付，都会进入酒店的某个账户。财务可以看到所有账户、收入和谁还欠酒店的钱，并负责记账。"] },
  { who: who("finance", "admin"), en: ["Finance → MD and Boss.", "The Boss and the MD can open everything Finance opens. A purchase above the limit set in Settings is authorized by the Boss or the MD, not by Finance. Money leaves the nTZS balance only on “Withdraw funds” (Finance, the MD or the Boss)."], zh: ["财务 → 总经理与老板。", "老板和总经理可以查看财务能查看的一切。高于“设置”中所定限额的采购由老板或总经理授权，而不是财务。nTZS 余额只能在“提现”页面提取（财务、总经理或老板）。"] },
];
// How each line is drawn. `arrow`: [x, y] = a head pointing down just above (x, y); [x, y, "r"|"l"|"u"|"d"] = a head with its tip exactly at (x, y).
const LINES = [
  { d: "M240 31 H78 V112", badge: [150, 31], arrow: [[78, 112]] },
  { d: "M360 58 V92 M266 92 H642 M266 92 V112 M454 92 V112 M642 92 V112", badge: [360, 76], arrow: [[266, 112], [454, 112], [642, 112]] },
  { d: "M532 148 H564", badge: [548, 148] },
  { d: "M344 148 H376", badge: [360, 148] },
  { d: "M156 148 H188", badge: [172, 148] },
  { d: "M60 178 V230", badge: [60, 205], arrow: [[60, 230]] },
  { d: "M118 178 V207 H266 V230", badge: [196, 207], arrow: [[266, 230]] },
  { d: "M454 178 V322", badge: [454, 256] },
  { d: "M360 360 V388", badge: [360, 374] },
  { d: "M642 178 V230", badge: [642, 205], arrow: [[642, 230]] },
  // 11 who asks → Finance            12 Finance → Purchasing           13 Purchasing → Stores (down the right edge)
  { d: "M215 489 H261", badge: [238, 489], arrow: [[261, 489, "r"]] },
  { d: "M473 497 H547", badge: [510, 497], arrow: [[547, 497, "r"]] },
  { d: "M720 508 H730 V263 H721", badge: [730, 306], arrow: [[721, 263, "l"]] },
  // 14 Purchasing → Finance (invoice)  15 money in → Finance             16 Finance → MD and Boss
  { d: "M547 521 H473", badge: [510, 521], arrow: [[473, 521, "l"]] },
  { d: "M215 527 H261", badge: [238, 527], arrow: [[261, 527, "r"]] },
  { d: "M367 471 V428", badge: [367, 450], arrow: [[367, 427, "u"]] },
];

const x = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;");
/** The drawing, with the lines and the box of department `me` in gold. */
export function mapSvg(lang, me, accent = "#b3862a", soft = "#f6efdd") {
  me = ALIAS[me] ?? me;
  const W = WORDS[lang] ?? WORDS.en;
  const gold = "#c8962e";
  const head = (px, py, dir, on) => {
    const a = 4.5, b = 7;
    const p = { d: [[px - a, py - b], [px, py], [px + a, py - b]], u: [[px - a, py + b], [px, py], [px + a, py + b]], r: [[px - b, py - a], [px, py], [px - b, py + a]], l: [[px + b, py - a], [px, py], [px + b, py + a]] }[dir];
    return `<path d="M${p[0].join(" ")} L${p[1].join(" ")} L${p[2].join(" ")}" fill="none" stroke="${on ? gold : "#b9bfca"}" stroke-width="${on ? 1.7 : 1.2}" stroke-linecap="round" stroke-linejoin="round"/>`;
  };
  const lines = LINES.map((l, i) => {
    const on = LINKS[i].who.includes(me);
    const ends = (l.arrow ?? []).map(([px, py, dir]) => (dir ? head(px, py, dir, on) : head(px, py + 5, "d", on)));
    return `<path d="${l.d}" fill="none" stroke="${on ? gold : "#c3c8d2"}" stroke-width="${on ? 1.7 : 1.2}" stroke-linecap="round" stroke-linejoin="round"/>${ends.join("")}`;
  }).join("");
  const badges = LINES.map((l, i) => {
    const on = LINKS[i].who.includes(me);
    return `<circle cx="${l.badge[0]}" cy="${l.badge[1]}" r="9.5" fill="${on ? "#e2b24a" : "#eceef2"}" stroke="#fff" stroke-width="2"/><text x="${l.badge[0]}" y="${l.badge[1] + 3.6}" text-anchor="middle" font-size="10" font-weight="700" fill="${on ? "#17130a" : "#5b6474"}">${i + 1}</text>`;
  }).join("");
  const boxes = Object.entries(NODES).map(([id, n]) => {
    const [title, ...sub] = W[id];
    const mine = id === me;
    if (n.band) {
      return `<rect x="${n.x + 0.8}" y="${n.y}" width="${n.w - 1.6}" height="${n.h}" rx="8" fill="${mine ? soft : "#f4f3ef"}" stroke="${mine ? accent : "#d5d9e0"}" stroke-width="${mine ? 1.8 : 1}"/>
        <text x="${n.x + 16}" y="${n.y + n.h / 2 + 4.3}" font-size="12.4" font-weight="700" fill="#141926">${x(title)}</text>
        <text x="${n.x + (lang === "zh" ? 150 : 118)}" y="${n.y + n.h / 2 + 3.6}" font-size="${lang === "zh" ? 9.4 : 9}" fill="#3b4252">${x(sub[0])}</text>`;
    }
    const cx = n.x + n.w / 2;
    const fill = n.dark ? "#0c1019" : mine ? soft : "#fff";
    const stroke = n.dark ? (mine ? "#e2b24a" : "#0c1019") : mine ? accent : "#c9ced7";
    const ty = n.y + (sub.length > 1 ? 21 : 23);
    return `<rect x="${n.x + 0.8}" y="${n.y}" width="${n.w - 1.6}" height="${n.h}" rx="8" fill="${fill}" stroke="${stroke}" stroke-width="${mine ? 1.8 : 1}"${n.dashed ? ' stroke-dasharray="4 3"' : ""}/>
      <text x="${cx}" y="${ty}" text-anchor="middle" font-size="12.4" font-weight="700" fill="${n.dark ? "#e2b24a" : "#141926"}">${x(title)}</text>
      ${sub.map((s, k) => `<text x="${cx}" y="${ty + 14 + k * 11.6}" text-anchor="middle" font-size="9" fill="${n.dark ? "rgba(255,255,255,.72)" : "#5b6474"}">${x(s)}</text>`).join("")}`;
  }).join("");
  // the small title of the lower part, and the two boxes of names that feed Finance
  const zone = `<text x="0" y="453" font-size="${lang === "zh" ? 9 : 8.2}" font-weight="700" fill="#8a91a0"${lang === "zh" ? ' letter-spacing=".12em"' : ' letter-spacing="1.5"'}>${x(W.zone)}</text>`;
  const pills = PILLS.map((p) => {
    const mine = p.names.some(([id]) => id === me);
    const names = p.names.map(([id, key], k) => `${k ? '<tspan fill="#a3aab8" font-weight="400"> · </tspan>' : ""}<tspan fill="${id === me ? accent : "#3b4252"}" font-weight="${id === me ? 800 : 600}">${x(W.names[key])}</tspan>`).join("");
    return `<rect x="${p.x + 0.8}" y="${p.y}" width="${p.w - 1.6}" height="${p.h}" rx="8" fill="${mine ? soft : "#fff"}" stroke="${mine ? accent : "#c9ced7"}" stroke-width="${mine ? 1.8 : 1}"/>
      <text x="${p.x + 12}" y="${p.y + 13}" font-size="${lang === "zh" ? 8.2 : 7.6}" font-weight="700" fill="#8a91a0"${lang === "zh" ? "" : ' letter-spacing=".7"'}>${x(lang === "zh" ? W[p.key] : W[p.key].toUpperCase())}</text>
      <text x="${p.x + 12}" y="${p.y + 27}" font-size="9.6">${names}</text>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 742 550" font-family="Inter, 'PingFang SC', sans-serif">${lines}${boxes}${zone}${pills}${badges}</svg>`;
}

/** The guest's stay in six steps; `who` = the departments each step belongs to. */
export const JOURNEY = [
  { who: who("guest", "reception", "admin"), en: ["1 · Booking", "Website, Hotel QR, phone call or walk-in.", "Guest · Reception"], zh: ["1 · 预订", "网站、酒店二维码、电话或直接到店。", "客人 · 前台"] },
  { who: who("reception", "driver"), en: ["2 · Arrival", "Airport pickup if asked, then check-in to a clean room.", "Driver · Reception"], zh: ["2 · 抵达", "如有需要先安排机场接机，然后入住已清洁的房间。", "司机 · 前台"] },
  { who: who("guest", "reception", "housekeeping"), en: ["3 · The stay", "Requests from the room QR; the room is serviced every day.", "Reception · Housekeeping"], zh: ["3 · 住店期间", "通过房间二维码提出需求；房间每日整理。", "前台 · 客房清洁"] },
  { who: who("guest", "waiter", "kitchen", "counter"), en: ["4 · Food and drinks", "Order by QR or with a waiter; kitchen cooks, waiter serves.", "Waiters · Kitchen · Counter"], zh: ["4 · 餐饮", "扫码或由服务员点单；厨房制作，服务员上菜。", "服务员 · 厨房 · 收银台"] },
  { who: who("counter", "reception", "manager", "finance"), en: ["5 · Paying", "Pay now at the Counter or online, or put it on the room bill.", "Counter · Reception · Finance"], zh: ["5 · 付款", "在收银台或线上即时付款，或记入房账。", "收银台 · 前台 · 财务"] },
  { who: who("reception", "housekeeping", "manager", "admin"), en: ["6 · Goodbye", "Check-out, bill settled, thank-you note; room goes to cleaning.", "Reception · Housekeeping"], zh: ["6 · 离店", "退房、结清账单、发送感谢信；房间转入清洁。", "前台 · 客房清洁"] },
];
