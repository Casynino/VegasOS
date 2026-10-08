import type { Catalog } from "../../../translate";

// Bookings, check-in / check-out, room moves, room status and who serves an order — messages from the server
// (src/server/services: reservations, booking-holds, room-changes, rooms, assignments, reservation-financials, stays).
// {status} inside a sentence is the room's (or booking's) own status name in the reader's language.
const catalog: Catalog = {
  // Who serves an order, a table, a room's room service (assignments.ts)
  "Order {order} is already finished.": "订单 {order} 已完成。",
  "{name} is serving order {order} — ask them (or a manager) to transfer it.": "{name} 正在负责订单 {order} — 请让对方（或经理）转交。",
  "Order {order} has no waiter yet.": "订单 {order} 还没有服务员。",
  "Say why order {order} moves from its waiter.": "请说明订单 {order} 为何从原服务员转出。",
  "That waiter was not found.": "找不到该服务员。",
  "{name} is serving {table} — ask them (or a manager) to transfer it.": "{name} 正在负责 {table} — 请让对方（或经理）转交。",
  "{table} has no waiter yet.": "{table} 还没有服务员。",
  "Say why {table} moves from its waiter.": "请说明 {table} 为何从原服务员转出。",
  "Room {room} not found.": "找不到 {room} 号房。",
  "Say why room {room}'s room service moves from its waiter.": "请说明 {room} 号房的客房送餐为何从原服务员转出。",

  // Holding a room while it is paid (booking-holds.ts)
  "Sorry — Room {room} was just taken for these dates, and no other {type} is free. Please choose again.": "抱歉 — {room} 号房在这些日期刚刚被订走，也没有其他空闲的{type}。请您重新选择。",
  "This booking's room now has another booking — choose another room before receiving payment.": "该预订的房间现已被其他预订占用 — 请先换一间房，再收款。",
  "Sorry — that room was just taken for these dates. Please choose again.": "抱歉 — 该房间在这些日期刚刚被订走。请您重新选择。",

  // A group's bill (reservation-financials.ts)
  "{group}'s final invoice is already made — only a manager can change this room's bill, and the change goes on an adjustment invoice.": "{group} 的最终发票已开具 — 只有经理可以修改此房间的账单，修改将记入调整发票。",

  // Making a booking (reservations.ts)
  "That room was just booked by someone else for these dates. Please choose another room or dates.": "该房间在这些日期刚刚被他人预订。请选择其他房间或日期。",
  "A single booking can hold at most 10 rooms.": "一个预订最多可包含 10 间房。",
  "Could not create the booking. Please try again.": "无法创建预订，请重试。",
  "Hotel QR bookings are made by guests from the QR — choose how this guest booked.": "酒店 QR 预订由客人扫码自行完成 — 请选择这位客人的预订方式。",
  "In the past": "时间已过",
  "Only stays starting today can be checked in immediately.": "只有今天开始的住宿才能立即办理入住。",
  "Bookings can be made up to {days} days ahead.": "最多可提前 {days} 天预订。",
  "One of the selected room types is not available.": "所选房型中有一个不可预订。",
  "{type} is a guest room — book it as a stay.": "{type}是客房 — 请按住宿预订。",
  "{type} is booked by time — choose \"Meeting room\".": "{type}按时段预订 — 请选择“会议室”。",
  "{type} holds up to {n} people.": "{type}最多容纳 {n} 人。",
  "Too many": "人数过多",
  "{type} fits up to {adults} adult(s) and {children} child(ren).": "{type}最多入住 {adults} 位成人和 {children} 位儿童。",
  "{type} fits up to {adults} adult(s).": "{type}最多入住 {adults} 位成人。",
  "{type} is already booked for part of that time. Choose another time.": "{type}在该时段内已有部分时间被预订。请选择其他时间。",
  "The selected {type} room is no longer available for these dates.": "所选的{type}在这些日期已不再空闲。",
  "No clean {type} room is ready right now.": "目前没有已清洁、可入住的{type}。",
  "Sorry — {type} is fully booked for these dates.": "抱歉 — {type}在这些日期已订满。",
  "Room {room} is {status} — it must be clean before check-in.": "{room} 号房当前状态为“{status}” — 入住前必须清洁完毕。",
  "Choose what the company pays for.": "请选择公司支付的项目。",
  "Corporate account is not active.": "企业客户账户未启用。",
  "This booking request has already been handled by someone else.": "该预订请求已由他人处理。",
  "An item picked from the menu is no longer on it. Remove it and try again.": "所选的某个菜品已不在菜单上。请将其移除后重试。",

  // Confirming, checking in
  "Only enquiries or pending bookings can be confirmed.": "只有咨询或待处理的预订才能确认。",
  "Receive a payment (a deposit is enough) to confirm this booking — or ask a manager to confirm it without payment.": "请先收款（定金即可）以确认此预订 — 或请经理在未付款的情况下确认。",
  "This guest booked online to pay later — the room is held only once it is paid. Take a payment (a deposit is enough), or ask a manager to confirm it.": "这位客人在线预订并选择稍后付款 — 付款后才会保留房间。请收款（定金即可），或请经理确认。",
  "There are no rooms waiting for check-in on this booking.": "此预订没有等待入住的房间。",
  "Room {room} was taken by a guest who paid first — choose another free room for this guest.": "{room} 号房已被先付款的客人订走 — 请为这位客人选择另一间空闲房间。",
  "Room {room} is booked from {date}. Change the dates first to check in early.": "{room} 号房的预订从 {date} 开始。如需提前入住，请先修改日期。",
  "This stay has already ended ({date}). Mark it as a no-show or change the dates.": "此住宿已结束（{date}）。请标记为未到店或修改日期。",
  "Room {room} is {status}. Finish housekeeping or choose another room.": "{room} 号房当前状态为“{status}”。请先完成客房清洁，或选择其他房间。",
  "Room {room}: guest arrived after the booked arrival date — earlier nights remain charged.": "{room} 号房：客人晚于预订的抵达日期到店 — 之前的晚数仍照常收费。",
  "Room {room} was {status} — checked in by authorised override.": "{room} 号房当时状态为“{status}” — 已经授权特批办理入住。",
  "This booking is {status} — nothing to check in.": "此预订状态为“{status}” — 没有可办理入住的房间。",
  "Verify the guest's ID before checking in.": "办理入住前请核验客人的证件。",

  // Checking out
  "{group} (group · {payer})": "{group}（团体 · {payer}）",
  "Could not work out the final bill.": "无法计算最终账单。",
  "No checked-in rooms to check out.": "没有可退房的在住房间。",
  "This is an early departure — give a reason (e.g. change of plans, complaint, emergency).": "这是提前离店 — 请说明原因（例如行程变更、投诉、紧急情况）。",
  "Give the reason for letting the guest leave with an unpaid balance.": "请说明允许客人带着未付余额离店的原因。",
  "This guest still owes TZS {amount}. Record the payment, or confirm checkout with an unpaid balance.": "这位客人仍欠 TZS {amount}。请记录付款，或确认在有未付余额的情况下退房。",
  "This guest now owes TZS {amount} — more than the TZS {allowed} the manager allowed. Receive a payment, or ask the manager again.": "这位客人现欠 TZS {amount} — 超过经理允许的 TZS {allowed}。请收款，或再次请示经理。",
  "This guest still owes TZS {amount}. Receive the payment first — only a manager can let a guest leave owing (they can allow it on the room card).": "这位客人仍欠 TZS {amount}。请先收款 — 只有经理可以允许客人欠款离店（可在房间卡片上批准）。",

  // Cancelling, no-shows, arriving late
  "A cancellation reason is required.": "请填写取消原因。",
  "This booking cannot be cancelled (guest already checked in, or it is closed).": "此预订无法取消（客人已入住，或预订已关闭）。",
  "Only bookings waiting for arrival can be marked as no-show.": "只有等待抵达的预订才能标记为未到店。",
  "A booking can only be marked no-show on or after its arrival date.": "预订只能在抵达日当天或之后标记为未到店。",
  "Only a manager can release a no-show room.": "只有经理可以释放未到店预订的房间。",
  "No room is being held for this no-show.": "此未到店预订没有被保留的房间。",
  "Say what the guest told you (e.g. arriving at midnight).": "请填写客人告知的情况（例如午夜抵达）。",
  "Enter the time like 21:30.": "请按 21:30 的格式输入时间。",
  "Only bookings waiting for arrival can be marked as arriving late.": "只有等待抵达的预订才能标记为晚到。",

  // Moving a booking to another room
  "Only active stays can be moved.": "只有有效的住宿才能换房。",
  "The guest is already in this room.": "客人已在这个房间。",
  "Room {room} is not free for this stay.": "{room} 号房在此住宿期间不空闲。",
  "Room {room} is not ready ({status}).": "{room} 号房尚不可入住（{status}）。",

  // Meeting rooms
  "This booking has no meeting room booking that can still change.": "此预订没有仍可修改的会议室预订。",
  "The meeting has already started — only the end time can change.": "会议已经开始 — 只能修改结束时间。",
  "Room {room} is booked or blocked for part of that time. Choose another time.": "{room} 号房在该时段内有部分时间已被预订或停用。请选择其他时间。",

  // Changing dates, extending
  "Short-time bookings cannot change dates; cancel and rebook instead.": "钟点房预订无法修改日期；请取消后重新预订。",
  "Only active stays can change dates.": "只有有效的住宿才能修改日期。",
  "The guest is in-house; only the departure date can change.": "客人已在住；只能修改离店日期。",
  "Arrival cannot be in the past.": "抵达日期不能早于今天。",
  "To end the stay today, check the guest out instead.": "如需今天结束住宿，请直接为客人办理退房。",
  "To move an in-house guest, use “Change room”.": "如需为在住客人换房，请使用“换房”。",
  "Room {room} is not available for {from} → {to}. Choose one of the free rooms.": "{room} 号房在 {from} → {to} 期间不空闲。请选择一间空闲房间。",
  "The new dates cost TZS {amount} more. Receive the extra payment to change the dates.": "新日期需多付 TZS {amount}。请收取差额后再修改日期。",
  "Short-time stays cannot be extended; book a new stay instead.": "钟点房无法续住；请另行预订。",
  "Only active stays can be extended.": "只有有效的住宿才能续住。",
  "The new checkout date must be after the current one.": "新的退房日期必须晚于当前退房日期。",
  "Room {room} is not available for the requested extension. Choose another room or cancel the extension.": "{room} 号房在续住期间不空闲。请选择其他房间或取消续住。",

  // Discounts, leaving owing, free nights, late checkout
  "Discounts can only change on open stays.": "只有未结束的住宿才能修改折扣。",
  "Only a manager, the MD or the owner gives a discount on the whole bill.": "只有经理、总经理或老板可以对整张账单打折。",
  "This booking has no bill to discount.": "此预订没有可打折的账单。",
  "This bill is already on an invoice — change the invoice instead (Invoices).": "此账单已开入发票 — 请改为修改发票（发票）。",
  "The guest only owes TZS {amount} — a discount can't be more than what is still to pay.": "客人只欠 TZS {amount} — 折扣不能超过待付金额。",
  "Too much": "金额过大",
  "Only a manager, the MD or the owner lets a guest leave owing.": "只有经理、总经理或老板可以允许客人欠款离店。",
  "Say why the guest may leave owing (e.g. company will pay Friday).": "请说明允许客人欠款离店的原因（例如公司周五付款）。",
  "Only a guest staying now can be allowed to leave owing.": "只有当前在住的客人才能被允许欠款离店。",
  "This guest owes nothing.": "这位客人没有欠款。",
  "Only a manager, the MD or the owner can change this.": "只有经理、总经理或老板可以修改此项。",
  "There is no approval to withdraw.": "没有可撤回的批准。",
  "Only a manager, the MD or the owner gives free nights.": "只有经理、总经理或老板可以赠送免费住宿。",
  "Say why the nights are free.": "请说明免费住宿的原因。",
  "Room {room} is booked after the current checkout — free nights can only be given in the same room.": "{room} 号房在当前退房之后已被预订 — 免费住宿只能在同一房间内赠送。",
  "Late checkout applies to guests currently in house.": "延迟退房仅适用于当前在住的客人。",
  "Enter a valid time (HH:MM).": "请输入有效时间（HH:MM）。",
  "Standard checkout is already {time} or later.": "标准退房时间已是 {time} 或更晚。",
  "That is past the end of the hotel day — extend the stay by a night instead.": "这已超过酒店营业日的结束时间 — 请改为续住一晚。",
  "Room {room} is booked for another guest from this afternoon. Offer a later time elsewhere or a room change.": "{room} 号房今天下午起已被其他客人预订。请在其他房间安排更晚的时间，或为客人换房。",
  "Enter a valid fee.": "请输入有效的费用。",

  // Changing room (room-changes.ts)
  "Only bookings waiting to arrive or in the hotel can change room.": "只有等待抵达或在住的预订才能换房。",
  "This room is no longer available. Choose another room.": "该房间已不再空闲。请选择其他房间。",
  "Sign in required.": "请先登录。",
  "Choose why the hotel is moving the guest.": "请选择酒店为客人换房的原因。",
  "Describe the problem (e.g. AC stopped working and cannot be repaired today).": "请描述问题（例如空调坏了，今天无法修好）。",
  "A checked-in guest cannot change room on request. They check out and make a new booking. Only a problem in the room allows a (free) move.": "已入住的客人不能应要求换房，需先退房再重新预订。只有房间出现问题时才可（免费）换房。",
  "Room {room} is no longer available for this stay. Choose another room.": "{room} 号房在此住宿期间已不再空闲。请选择其他房间。",
  "Room {room} is not ready ({status}) — the guest cannot move in yet.": "{room} 号房尚不可入住（{status}） — 客人暂时无法搬入。",
  "The guest must pay the difference of TZS {amount} to change room.": "客人需支付差价 TZS {amount} 才能换房。",

  // Room status (rooms.ts)
  "Room {room} has {n} upcoming booking(s) — reassign them to another room.": "{room} 号房有 {n} 个即将到来的预订 — 请将其改分配到其他房间。",
  "This room has a guest in it. Check the guest out to change its status.": "该房间有客人在住。请先为客人办理退房，再更改房间状态。",
  "A room cannot be changed from {from} to {to} manually.": "房间不能手动从“{from}”改为“{to}”。",
  "Only a manager can take a room out of service.": "只有经理可以将房间停用。",
  "Say what needs fixing (e.g. AC, plumbing).": "请说明需要维修的内容（例如空调、水管）。",
  "Reason required": "请填写原因",

  // An order on the room bill (stays.ts — orderHeading with a translator)
  "Room service · Order {number}": "客房送餐 · 订单 {number}",
  "Restaurant — {table} · Order {number}": "餐厅 — {table} · 订单 {number}",
  "Restaurant · Order {number}": "餐厅 · 订单 {number}",
};
export default catalog;
