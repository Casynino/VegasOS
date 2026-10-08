import type { Catalog } from "../../../translate";

// Smaller server services: restaurant & bar sales (outlets.ts), pricing conflicts (pricing-admin.ts), planned room
// closures (room-decisions.ts), the waiter picked on the Counter (waiter-on-counter.ts), a stay's bill sections
// (stay-bill.ts), the hotel weather (weather.ts), staff activity (staff-performance.ts) and the handover money text
// (guest-balances.ts). Field-error words ("Required", "Invalid"…) are shown next to the form field.
const catalog: Catalog = {
  // Field errors
  "Required": "必填",
  "Invalid": "无效",
  "Conflict": "冲突",
  "Past": "已过去",
  "Too early": "太早",
  "Off shift": "未上班",

  // Restaurant & bar sales (outlets.ts)
  "Sign in required.": "请先登录。",
  "Enter a positive whole amount.": "请输入正整数金额。",
  "Choose a sales category.": "请选择销售类别。",
  "Sale time cannot be in the future.": "销售时间不能晚于现在。",
  "You cannot correct sales.": "您无权更正销售记录。",
  "Sale not found.": "找不到该销售记录。",
  "A cancelled sale cannot be corrected.": "已取消的销售记录无法更正。",
  "Nothing changed.": "没有任何更改。",
  "Only a manager can void sales.": "只有经理可以作废销售记录。",
  "Give a reason.": "请填写原因。",
  "Sale not found or already voided.": "找不到该销售记录，或已作废。",

  // Promotions and date prices (pricing-admin.ts) — {name} is the promotion's own name, {when} its dates
  "Pricing conflict: “{name}” ({when}) has the same priority ({priority}) and covers the same rooms on some of the same nights. Give one a higher priority, or change the dates or rooms.": "价格冲突：“{name}”（{when}）的优先级相同（{priority}），且在部分相同的晚上覆盖相同的房间。请提高其中一个的优先级，或更改日期或房间。",
  "Pricing conflict: date price “{name}” ({when}) has the same priority ({priority}) for the same rooms and nights. Give one a higher priority, or change the dates or rooms.": "价格冲突：日期价格“{name}”（{when}）在相同的房间和晚上优先级相同（{priority}）。请提高其中一个的优先级，或更改日期或房间。",

  // Planned room closures (room-decisions.ts)
  "Only a manager or the MD closes rooms.": "只有经理或总经理可以关闭房间。",
  "Say why the room is closed (e.g. painting, new AC).": "请说明房间关闭的原因（例如：粉刷、更换空调）。",
  "The closure cannot start in the past.": "关闭不能从过去的日期开始。",
  "The room opens again after the closure starts — choose a later date.": "重新开放日期须晚于关闭开始日期 — 请选择更晚的日期。",
  "Room not found.": "找不到该房间。",
  "Room {room} is booked in those dates: {bookings}. Move that booking to another room first.": "{room} 号房在这些日期已有预订：{bookings}。请先将该预订移到其他房间。",
  "Room {room} is booked in those dates: {bookings}. Move those bookings to another room first.": "{room} 号房在这些日期已有预订：{bookings}。请先将这些预订移到其他房间。",
  "Room {room} is already closed for part of those dates.": "{room} 号房在这些日期中的部分日期已关闭。",
  "Only a manager or the MD opens rooms.": "只有经理或总经理可以重新开放房间。",
  "Closure not found.": "找不到该关闭安排。",
  "This closure is already over.": "该关闭安排已结束。",
  "Room {room} is closed now — use \"Fixed\" on the room to open it.": "{room} 号房当前已关闭 — 请在该房间上点“已修好”来重新开放。",

  // The waiter picked on the Restaurant Counter (waiter-on-counter.ts)
  "Choose one of the waiters.": "请选择一位服务员。",
  "{name} is not on shift — they start their shift first.": "{name} 尚未上班 — 请对方先开始上班。",

  // A stay's bill: sections (stay-bill.ts)
  "Restaurant": "餐厅",
  "Bar": "酒吧",
  "Room service": "客房送餐",
  "Services & extras": "服务与其他",

  // Weather at the hotel (weather.ts)
  "Clear sky": "晴",
  "Partly cloudy": "多云",
  "Overcast": "阴",
  "Fog": "雾",
  "Thunderstorm": "雷阵雨",
  "Showers": "阵雨",
  "Rain": "雨",

  // Staff activity (staff-performance.ts)
  "Other": "其他",
  "still on": "仍在班",

  // The money part of the shift handover (guest-balances.ts)
  "MONEY TO COLLECT — {guests} in {rooms}: {paid} fully paid, {owing} owing.": "待收款 — {rooms}共{guests}：{paid} 位已付清，{owing} 位欠款。",
  "{n} guest": "{n} 位客人",
  "{n} guests": "{n} 位客人",
  "{n} room": "{n} 间房",
  "{n} rooms": "{n} 间房",
  "Total outstanding TZS {total} (owed for nights so far TZS {soFar}).": "待付总额 TZS {total}（截至目前已住晚数应付 TZS {soFar}）。",
  "Nobody staying owes money.": "没有在住客人欠款。",
  "Room {rooms} — {guest}: TZS {amount} (paid {paid})": "{rooms} 号房 — {guest}：TZS {amount}（已付 {paid}）",
  "Room {rooms} — {guest}: TZS {amount} (nothing paid)": "{rooms} 号房 — {guest}：TZS {amount}（未付款）",
};
export default catalog;
