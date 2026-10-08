import type { Catalog } from "../../../translate";

// Services (batch svc-a) — the words the fix pass marked: a no-show booking that cannot be reinstated, the edit
// history's names for records without a number, and the ledger's note on a discounted room night.
const catalog: Catalog = {
  // ── Reinstating a no-show (reservations) ──
  "This booking is not a no-show.": "此预订不是未到店预订。",
  "This booking was marked no-show and its room was released. A manager must decide what to do (check which rooms are free and make a new booking).": "此预订已标记为未到店，房间已释放。需由经理决定如何处理（查看哪些房间空闲，然后新建预订）。",

  // ── Edit history: a record with no number or name of its own ──
  "Date price": "日期价格",
  "Discount rules": "折扣规则",

  // ── Ledger: a room night's price → discounts → charged ──
  "{name} price": "{name}价格",
  "Discount −{amount}": "折扣 −{amount}",
  "Discount −{amount} by {name}": "折扣 −{amount}（{name}）",
  "Discount −{amount} by {name} on {date}": "折扣 −{amount}（{name}，{date}）",
};

export default catalog;
