import type { Catalog } from "../../../translate";

// Restaurant services — tables and their customers, table reservations, orders and payments, waiters' work and shifts.
// Messages from the server (errors) and text the services compose for staff screens.
const catalog: Catalog = {
  // Seating a customer at a table
  "{table} is under maintenance ({reason}) — choose another table, or a manager reopens it.": "{table} 正在维修（{reason}）——请选择其他餐桌，或由经理重新开放。",
  "{table} is under maintenance — choose another table, or a manager reopens it.": "{table} 正在维修——请选择其他餐桌，或由经理重新开放。",
  "{table} is not available ({reason}) — choose another table, or a manager reopens it.": "{table} 暂不可用（{reason}）——请选择其他餐桌，或由经理重新开放。",
  "{table} is not available — choose another table, or a manager reopens it.": "{table} 暂不可用——请选择其他餐桌，或由经理重新开放。",
  "{table} already has a customer ({name}) — choose another table, or add them to that table.": "{table} 已有顾客（{name}）——请选择其他餐桌，或将其加入该餐桌。",
  "{table} is reserved for {name} at {time}. Seat them there, choose another table — or seat anyway.": "{table} 已为 {name} 预订（{time}）。可让预订客人在此入座、选择其他餐桌——或仍然在此入座。",
  "That table is reserved for {name} — choose another, or seat anyway.": "该餐桌已为 {name} 预订——请选择其他餐桌，或仍然在此入座。",
  "That number is on {table} right now.": "该号码的顾客目前在 {table} 就座。",

  // Moving a customer to another table
  "They are already at {table}.": "顾客已在 {table}。",
  "{table} is under maintenance — choose another table.": "{table} 正在维修——请选择其他餐桌。",
  "{table} is not available — choose another table.": "{table} 暂不可用——请选择其他餐桌。",
  "{table} has a customer ({name}) — choose a free table.": "{table} 已有顾客（{name}）——请选择空闲餐桌。",
  "{table} is reserved for {name} at {time}. Choose another table — or move anyway.": "{table} 已为 {name} 预订（{time}）。请选择其他餐桌——或仍然换到此桌。",

  // The table's bill and clearing it
  "Order {order} was paid online — confirm or decline its payment first, then take the rest of the bill.": "订单 {order} 已在线支付——请先确认或拒绝该付款，再收取账单余款。",
  "Order {order} is already part paid — receive the rest of it as a payment, then put the other orders on the room.": "订单 {order} 已部分付款——请先将其余款作为付款收取，再将其他订单记入房间。",
  "Order {order} was paid online — it cannot go on a room. Confirm or decline its payment first.": "订单 {order} 已在线支付——不能记入房间。请先确认或拒绝该付款。",
  "TZS {amount} is still to pay — the table can be cleared only when the bill is fully paid.": "仍有 TZS {amount} 待付——账单全部付清后才能清台。",
  "Order {order} is not marked served yet — serve it, or clear the table saying they got everything.": "订单 {order} 尚未标记为已上菜——请先上菜，或清台时确认顾客已收到全部菜品。",

  // The table's timeline (keep " · TZS {amount}" as it is — the cook's view removes the money by it)
  "Order {order} · {n} item(s) · TZS {amount}": "订单 {order} · {n} 件 · TZS {amount}",
  "Order {order} · {n} item(s) · TZS {amount} — cancelled": "订单 {order} · {n} 件 · TZS {amount}——已取消",
  "Payment · TZS {amount} · {account} · {order}": "付款 · TZS {amount} · {account} · {order}",
  "Payment (reversed) · TZS {amount} · {account} · {order}": "付款（已冲销） · TZS {amount} · {account} · {order}",

  // Tables: switching off and blocking
  "Someone is at {table} — clear the table first.": "{table} 有顾客在座——请先清台。",
  "{table} has {n} open order — finish or move them first.": "{table} 有 {n} 个未完成订单——请先完成或移走。",
  "{table} has {n} open orders — finish or move them first.": "{table} 有 {n} 个未完成订单——请先完成或移走。",
  "{table} has {n} reservation coming — move it to another table first.": "{table} 有 {n} 个即将到来的预订——请先将其移到其他餐桌。",
  "{table} has {n} reservations coming — move them to another table first.": "{table} 有 {n} 个即将到来的预订——请先将其移到其他餐桌。",
  "{name} is at {table} — move them or clear the table first.": "{name} 正在 {table} 就座——请先为其换桌或清台。",

  // Table reservations
  "They are already seated.": "客人已入座。",
  "They are already seated — this reservation is done.": "客人已入座——此预订已完成。",
  "This reservation was cancelled or marked no-show.": "此预订已取消或已标记为未到店。",
  "{table} is already reserved at {time} for {name} — choose another table or time.": "{table} 在 {time} 已为 {name} 预订——请选择其他餐桌或时间。",
  "Up to {n} tables in one reservation.": "一个预订最多 {n} 张餐桌。",
  "It is already for {table}.": "该预订已是 {table}。",

  // Menu
  "There is already a category called {name}.": "已存在名为“{name}”的分类。",

  // Orders: who prepares, placing and changing them
  "Only the Mpishi or a waiter prepares orders.": "只有厨师或服务员可以制作订单。",
  "Orders with food are prepared by the Mpishi or a waiter.": "含菜品的订单由厨师或服务员制作。",
  "The {kind} income category is missing.": "缺少“{kind}”收入类别。",
  "That number belongs to another customer ({name}) — enter the staying guest's own phone.": "该号码属于另一位顾客（{name}）——请输入在住客人本人的电话。",
  "That room is not this customer's — food goes only on the room of the guest staying in it (or someone at their table). They pay at the restaurant.": "该房间不属于这位顾客——餐费只能记入入住该房间的客人（或与其同桌者）的房间。请其在餐厅付款。",
  "Enter the customer's phone number first — then their room shows.": "请先输入顾客的电话号码——随后会显示其房间。",
  "Choose the guest's room for room service.": "请选择客房送餐的客人房间。",
  "Choose the guest whose room is charged.": "请选择要记入其房间账单的客人。",
  "This order is closed — start a new order.": "此订单已关闭——请新建订单。",
  "This order is closed.": "此订单已关闭。",
  "Your payment for this order is still on its way — add more once it is done.": "您对此订单的付款仍在处理中——付款完成后再加点。",
  "{item} is already paid — it cannot be removed here.": "{item} 已付款——不能在此删除。",
  "The kitchen has already made {item} — ask a manager to remove it.": "厨房已做好 {item}——请让经理删除。",
  "{order} is closed — it cannot move.": "{order} 已关闭——无法移动。",
  "{order} is not a table order.": "{order} 不是餐桌订单。",
  "{order} is already at {table}.": "{order} 已在 {table}。",
  "{order} is part of a customer's table — move the table (the whole session) instead.": "{order} 属于某位顾客的餐桌——请改为整桌换桌（整个用餐过程一起移动）。",
  "The kitchen has not marked this order ready yet.": "厨房尚未将此订单标记为已备好。",
  "Tick every item first — still not ready: {items}.": "请先勾选每个菜品——仍未备好：{items}。",
  "This order is already ready — it can no longer be declined.": "此订单已备好——无法再拒绝。",

  // Payments and room bills
  "The customer is paying this order by phone right now — wait a moment for the payment to finish.": "顾客正在用手机支付此订单——请稍候，等待付款完成。",
  "Order {order} was cancelled.": "订单 {order} 已取消。",
  "Order {order} is on the guest's room bill — it is paid at check-out.": "订单 {order} 已记入客人的房间账单——退房时结算。",
  "The customer already paid order {order} online — check their payment instead.": "顾客已在线支付订单 {order}——请改为核对其付款。",
  "Order {order} is still on a room bill.": "订单 {order} 仍在房间账单上。",
  "This order is already on invoice {invoice} — a manager credits it there.": "此订单已在发票 {invoice} 上——由经理在该发票上冲减。",
  "The guest already paid room {room}'s bill including this order — nothing more to collect.": "客人已结清 {room} 号房的账单（含此订单）——无需再收款。",
  "The guest already paid the room's bill including this order — nothing more to collect.": "客人已结清房间账单（含此订单）——无需再收款。",
  "The discount can be at most TZS {amount} (what is still to pay).": "折扣最多为 TZS {amount}（即仍待付金额）。",

  // Waiters: taking charge and handing work over
  "It is already {name}'s.": "已由 {name} 负责。",
  "{name} is not on shift — they start their shift first (or a manager hands it to them).": "{name} 不在班——请其先开始上班（或由经理直接交给其负责）。",
  "Only the waiter serving this order (or a manager) can transfer it.": "只有负责此订单的服务员（或经理）可以转交。",
  "Nobody is serving this order yet — serve it yourself instead.": "此订单尚无人负责——请您自己接手。",
  "Only the waiter serving {table} (or a manager) can transfer it.": "只有负责 {table} 的服务员（或经理）可以转交。",
  "Nobody is serving {table} yet — serve it yourself instead.": "{table} 尚无人负责——请您自己接手。",
  "No waiter has room {room}'s room service — hand it to someone instead.": "{room} 号房的客房送餐目前无服务员负责——请改为指派给某位服务员。",
  "Nothing of room {room} is yours to transfer.": "{room} 号房没有由您负责、可转交的内容。",
  "Nothing of room {room} is theirs to transfer.": "{room} 号房没有由其负责、可转交的内容。",

  // Closing a waiter's shift
  "You still have {work}. Transfer them to a colleague on shift, or finish them, then close your shift.": "您还有 {work}。请转交给当班同事或先处理完，然后再结束班次。",
  "{name} still has {work} — choose the waiter who carries on with them.": "{name} 还有 {work}——请选择接手的服务员。",
  "{n} order ({list})": "{n} 个订单（{list}）",
  "{n} orders ({list})": "{n} 个订单（{list}）",
  "{n} table with customers ({list})": "{n} 张有顾客的餐桌（{list}）",
  "{n} tables with customers ({list})": "{n} 张有顾客的餐桌（{list}）",
  "no table": "无餐桌",
  "You served {n} order this shift.": "本班次您服务了 {n} 个订单。",
  "You served {n} orders this shift.": "本班次您服务了 {n} 个订单。",
  "No order served this shift.": "本班次未服务任何订单。",
};
export default catalog;
