// The Developer home's three new tabs — Hotel, Money, Messages & reports — and the "New records per day" chart on Speed & size.
import type { Catalog } from "../../../translate";

const catalog: Catalog = {
  // Tab bar and shared words
  "Messages & reports": "消息与报告",
  "Nothing yet": "暂无",
  "Not known": "未知",
  "None failed": "没有失败",
  "None waiting": "没有等待中的",
  "Nobody waiting": "无人等待",
  "Not made": "未生成",
  "Not made.": "未生成。",
  "Not due yet": "尚未到时间",

  // ───────── Hotel ─────────
  "What is happening in the hotel, now and over the last 14 days. Read-only: nothing here can be changed. A hotel day runs from {start} to {start} the next morning (hotel time).":
    "酒店此刻及最近 14 天的情况。仅供查看：这里的任何内容都无法修改。酒店营业日从 {start} 到次日早上 {start}（酒店时间）。",
  "Rooms with a guest": "有客房间",
  "guest rooms with someone in them right now": "此刻有客人入住的客房",
  "{percent}% full": "{percent}% 已入住",
  "The Boss's occupancy for today so far is {percent}% ({nights} nights sold of {sellable} rooms to sell). It counts nights sold, so it is not the same as the rooms with a guest right now. The meeting room is never counted.":
    "老板报表中今天目前的入住率为 {percent}%（{sellable} 间可售房中已售 {nights} 晚）。它按已售晚数计算，因此与此刻有客人的房间数不同。会议室从不计入。",
  "The meeting room is never counted.": "会议室从不计入。",
  "Guests in the house": "在住客人",
  "people staying now, in {n} bookings": "此刻在住的人数，共 {n} 个预订",
  "people staying now": "此刻在住的人数",
  "Adults and children in guest rooms that have checked in and not yet checked out.": "已入住且尚未退房的客房中的成人和儿童。",
  "checked in today": "今天已入住",
  "{n} still expected": "还有 {n} 位待到",
  "Checked in = guest rooms checked in during the hotel day, the same count as the room report. Still expected = bookings due today or earlier that have not arrived.":
    "已入住 = 本营业日内办理入住的客房数，与客房报告的统计相同。待到 = 今天或更早应到但尚未到达的预订。",
  "Departures today": "今日离店",
  "checked out today": "今天已退房",
  "{n} still to leave": "还有 {n} 位待离店",
  "Checked out = guest rooms checked out during the hotel day, the same count as the room report. Still to leave = guests in the hotel whose check-out day is today or earlier.":
    "已退房 = 本营业日内办理退房的客房数，与客房报告的统计相同。待离店 = 退房日为今天或更早、仍在酒店的客人。",
  "rooms to clean": "待清洁的房间",
  "{n} out of service": "{n} 间停用",
  "None out of service": "没有停用的房间",
  "To clean = rooms that are dirty or being cleaned. Out of service = rooms under maintenance or taken out of service.":
    "待清洁 = 待清洁或正在清洁的房间。停用 = 维修中或已停用的房间。",
  "receptionists on shift now": "当前在岗的前台人员",
  "Open over {h} hours": "已开班超过 {h} 小时",
  "{name} since {time}": "{name} 自 {time} 起",
  "A shift left open for more than {h} hours is probably forgotten.": "开班超过 {h} 小时的班次很可能被忘记了。",
  "Restaurant orders open": "未完成的餐厅订单",
  "Oldest waiting {wait}": "最久已等待 {wait}",
  "Orders of the last {days} days that are new, accepted, being prepared, ready or being served. The wait is the time since the order was placed.":
    "最近 {days} 天内尚未上完菜的订单：新订单、已接单、准备中、可上菜或上菜中。等待时间为下单后经过的时间。",
  "Guest requests open": "未完成的客人请求",
  "not finished yet": "尚未完成",
  "Oldest asked {wait} ago": "最早的请求在 {wait} 前提出",
  "Towels, cleaning, repairs and other things guests asked for that nobody has finished. The age is the time since the guest asked.":
    "客人提出、尚无人完成的毛巾、打扫、维修等请求。时长为客人提出请求后经过的时间。",
  "Online booking requests": "线上预订申请",
  "waiting for a decision": "等待处理",
  "None new": "没有新的",
  "Requests from the website and the Hotel QR that reception has not yet turned into a booking or closed.":
    "来自网站和酒店二维码、前台尚未转为预订或关闭的申请。",
  "Occupancy per day": "每日入住率",
  "The share of guest rooms sold on each hotel day (nights sold ÷ rooms to sell), the same figure as the Boss's reports. Last 14 days. Hover a bar for exact numbers; the table below has them all.":
    "每个营业日已售客房的比例（已售晚数 ÷ 可售房间数），与老板报表中的数字相同。最近 14 天。将鼠标放在柱子上可看到准确数字；下方的表格列出全部数字。",
  "Check-ins and check-outs per day": "每日入住与退房",
  "Guest rooms checked in and checked out on each hotel day, counted by the moment it really happened — the same count as the room report. Last 14 days.":
    "每个营业日办理入住和退房的客房数，按实际发生的时刻统计——与客房报告的统计相同。最近 14 天。",
  "Restaurant and bar orders per day": "每日餐厅和酒吧订单",
  "Orders placed each hotel day, cancelled ones left out. Last 14 days.": "每个营业日的下单数，不含已取消的。最近 14 天。",
  "Restaurant and bar orders: value per day": "餐厅和酒吧订单：每日金额",
  "Order value": "订单金额",
  "The value of the orders placed each hotel day, in TZS. It is what was sold, not money received (some orders are paid later or put on a room bill).":
    "每个营业日下单的金额（TZS）。这是销售额，不是已收款（有些订单稍后付款或记入房账）。",
  "New bookings per day": "每日新增预订",
  "Bookings made on each hotel day, by where they came from. Last 14 days. A booking is made on one day and the guest arrives later, so this is not the same as check-ins.":
    "每个营业日新增的预订，按来源分类。最近 14 天。预订在某一天做出，客人之后才到店，因此与入住数不同。",
  "Today's arrivals": "今日抵达客人",
  "Every booking due today, with where it stands, and late ones that have not arrived. The first {n} are shown.": "今天应到的全部预订及其当前状态，以及逾期未到的预订。显示前 {n} 条。",
  "Today's departures": "今日离店客人",
  "Guests in the hotel whose check-out day is today or earlier, and guests who have left today. The first {n} are shown.":
    "退房日为今天或更早、仍在酒店的客人，以及今天已离店的客人。显示前 {n} 条。",
  "Longest-open restaurant orders": "等待最久的餐厅订单",
  "The {n} orders that have waited longest without being served.": "等待最久、尚未上菜的 {n} 个订单。",
  "Open for": "已等待",
  "Open guest requests": "待处理的客人请求",
  "The {n} requests that have waited longest.": "等待最久的 {n} 个请求。",
  "Room or guest": "房间或客人",
  "Rooms by status": "按状态统计的房间",
  "Every guest room counted once, by its status right now. The meeting room is not counted.": "每间客房按当前状态各统计一次。不含会议室。",

  // ───────── Money ─────────
  "Where the money is. Read-only: the Developer can look at money but never changes it. A sale, the income of a room night, a payment received and what is still owed are four different things — each figure says which one it is. A hotel day runs from {start} to {start} the next morning (hotel time).":
    "资金在哪里。仅供查看：开发者可以查看资金，但绝不能更改。销售、客房夜晚的收入、已收款项和仍欠的款项是四件不同的事——每个数字都会说明它是哪一种。酒店营业日从 {start} 到次日早上 {start}（酒店时间）。",
  "payments recorded and on-the-spot sales, minus refunds": "已记录的付款和现场销售，减去退款",
  "Nothing received yet.": "尚未收到款项。",
  "Received, last 7 days": "已收款（最近 7 天）",
  "the same count, for today and the 6 days before": "同样的统计，涵盖今天和之前 6 天",
  "Owed by guests in the house": "在住客人欠款",
  "guests in the house": "在住客人",
  "{n} guest in the house still owes money": "{n} 位在住客人仍欠款",
  "{n} guests in the house still owe money": "{n} 位在住客人仍欠款",
  "Not received yet": "尚未收到",
  "Nobody owes": "无人欠款",
  "The balance of each guest's whole booking — nights not yet stayed and extras included — less what they paid. It is owed, not received.": "每位客人整个预订的余额（包括尚未入住的晚数和附加费用）减去已付款项。这是欠款，不是已收款。",
  "Left owing after check-out": "退房后仍欠款",
  "guests who left": "已离店的客人",
  "{n} guest left without paying in full": "{n} 位客人离店时未付清",
  "{n} guests left without paying in full": "{n} 位客人离店时未付清",
  "Guests who checked out with a balance still unpaid — the same figure as the front desk.": "退房时仍有未付余额的客人——与前台显示的数字相同。",
  "Online payments (nTZS)": "线上付款（nTZS）",
  "need a person": "需要人工处理",
  "{n} waiting for the customer": "{n} 笔等待顾客付款",
  "Money that came in online but could not be matched by itself needs a person. Waiting = a payment prompt sent to a customer's phone in the last 7 days that is not paid yet.":
    "已在线到账但系统无法自动匹配的款项需要人工处理。等待中 = 最近 7 天内发送到顾客手机、尚未付款的付款提示。",
  "on their way or not confirmed": "处理中或未确认",
  "{n} failed or refused in {days} days": "{days} 天内有 {n} 笔失败或被拒",
  "Money taken out of nTZS. On its way: {pending}. Not confirmed (nTZS gave no clear answer): {unknown}.":
    "从 nTZS 提出的款项。处理中：{pending}。未确认（nTZS 没有给出明确答复）：{unknown}。",
  "Expenses recorded and not yet approved. They are not counted as spent until a manager approves them.": "已记录但尚未批准的支出。经理批准之前，不计为已支出。",
  "Money received per day": "每日已收款",
  "Money that came in each hotel day, by how it was paid. Received is not income: a guest who stays today and pays tomorrow is income today and received tomorrow. Last 14 days.":
    "每个营业日收到的款项，按付款方式分类。已收款不等于收入：今天入住、明天付款的客人，收入算今天，收款算明天。最近 14 天。",
  "Income and money received per day": "每日收入与已收款",
  "Income is what the hotel earned that day (nights stayed, food, drinks, other income). Received is the money that came in that day. They are different things, so the two bars are side by side, never added.":
    "收入是酒店当天赚到的（住宿夜晚、餐食、饮品及其他收入）。已收款是当天到账的钱。两者不同，因此两根柱子并排显示，绝不相加。",
  "The last 7 days' money received, by payment method.": "最近 7 天已收款，按付款方式分类。",
  "What is owed, by how late": "按逾期时间分类的欠款",
  "Everything still owed to the hotel: guests who are staying or left owing, company invoices and unpaid restaurant orders. A guest's bill is due the day they leave.":
    "酒店仍待收的全部款项：在住或离店时欠款的客人、公司发票和未付款的餐厅订单。客人的账单在离店当天到期。",
  "Everything owed: {total}": "欠款合计：{total}",
  "Over 30 days late": "逾期超过 30 天",
  "The last payments": "最近的付款",
  "The newest {n} money-in lines: payments, refunds and on-the-spot sales (food and drinks paid at once).":
    "最新 {n} 条进账记录：付款、退款和现场销售（当场付款的餐食和饮品）。",
  "Cancelled and corrected money": "已撤销和已更正的款项",
  "The newest {n} payments reversed, sales or expenses cancelled and accounts corrected, from the last {days} days. Nothing is deleted: each one stays in the audit trail.":
    "最近 {days} 天内最新 {n} 条被冲销的付款、被取消的销售或支出以及被更正的账户。没有任何内容被删除：每一条都保留在审计记录中。",
  "Payment cancelled (reversed)": "付款已撤销（冲销）",
  "Payment method or account corrected": "付款方式或账户已更正",
  "Sale cancelled": "销售已取消",
  "Sale account corrected": "销售账户已更正",
  "Expense cancelled": "支出已取消",
  "Expense corrected": "支出已更正",
  "What each account holds as the system books it: its opening balance plus everything booked in and out. It is the system's figure — not a count of real cash or a bank statement.":
    "按系统记账方式，每个账户的余额：期初余额加上所有转入和转出。这是系统的数字——不是实际现金盘点，也不是银行对账单。",
  "The last withdrawals": "最近的提现",
  "The newest {n} withdrawals from nTZS. Only where the money went (mobile money or bank) is shown, never the number.":
    "最新 {n} 笔从 nTZS 的提现。只显示款项去向（手机支付或银行），从不显示号码。",

  // ───────── Messages & reports ─────────
  "Is the Boss getting what he should. Read-only. The words of a message are never shown here — only what was sent, when and how it went. A phone number shows its last three digits only. A hotel day runs from {start} to {start} the next morning (hotel time).":
    "老板是否收到了应收到的内容。仅供查看。这里从不显示消息的文字——只显示发送了什么、何时发送以及结果如何。电话号码只显示最后三位数字。酒店营业日从 {start} 到次日早上 {start}（酒店时间）。",
  "WhatsApp deliveries, 24 hours": "WhatsApp 发送情况（24 小时）",
  "sent in the last 24 hours": "最近 24 小时内已发送",
  "Reports and reminders sent by WhatsApp. Failed (last try in 24 hours): {failed}. Waiting to be sent (made in the last 7 days): {waiting}.":
    "通过 WhatsApp 发送的报告和提醒。失败（24 小时内最后一次尝试）：{failed}。等待发送（最近 7 天内生成）：{waiting}。",
  "Room report": "客房报告",
  "for {date}": "{date} 营业日",
  "for the last closed day": "最近一个已结束的营业日",
  "Failed deliveries, 7 days": "失败的发送（7 天）",
  "failed in the last 7 days": "最近 7 天内失败的",
  "{n} had all {max} tries": "{n} 条已用完全部 {max} 次尝试",
  "None had all {max} tries": "没有用完全部 {max} 次尝试的",
  "Fewer than {max} tries so far: {under} (a job may try again, but not every kind of message is tried again). All {max} tries used: {at} — no more automatic tries; only a person's 'send again' tries more.":
    "目前不足 {max} 次尝试：{under} 条（某些任务可能会再试，但并非每种消息都会重试）。已用完全部 {max} 次尝试：{at} 条——不再自动重试；只有人工点击“再次发送”才会继续尝试。",
  "Guest messages, 24 hours": "客人消息（24 小时）",
  "sent to guests in the last 24 hours": "最近 24 小时内发给客人的",
  "Booking, welcome, thank-you and other messages logged on a guest's profile. Short notices to the Boss are not written down, so they are not counted.":
    "记录在客人档案中的预订、欢迎、感谢等消息。发给老板的简短通知不会被记录，因此不计入。",
  "Deliveries per day": "每日发送情况",
  "WhatsApp deliveries made each hotel day, by how they went. Last 14 days. Hover a bar for exact numbers; the table below has them all.":
    "每个营业日的 WhatsApp 发送，按结果分类。最近 14 天。将鼠标放在柱子上可看到准确数字；下方的表格列出全部数字。",
  "Deliveries by purpose": "按用途统计的发送",
  "What the last 7 days' messages were for, with how many failed. Guest messages include reminders and the messages logged on guests' profiles. Short notices to the Boss are not written down, so they are not counted.":
    "最近 7 天的消息用途，以及失败的数量。客人消息包括提醒和记录在客人档案中的消息。发给老板的简短通知不会被记录，因此不计入。",
  "Shift reports": "班次报告",
  "Weekly and monthly reports": "每周和每月报告",
  "Other messages": "其他消息",
  "The last closed days: reports": "最近已结束营业日：报告",
  "For each of the last 7 closed days: was the daily report and the room report made, by whom, and did it reach the Boss. OK = made and sent after it was made.":
    "最近 7 个已结束的营业日：日报和客房报告是否已生成、由谁生成、是否送达老板。正常 = 已生成且在生成后已发送。",
  "Made {time}": "生成于 {time}",
  "made by a person": "由人工生成",
  "not sent": "未发送",
  "Send failed": "发送失败",
  "Made, not sent": "已生成，未发送",
  "Before the clean start": "在清零启动之前",
  "Not sent — failed": "未发送——发送失败",
  "Failed or waiting deliveries": "失败或等待中的发送",
  "The newest {n} deliveries that failed or have not been sent. Only the kind of trouble is shown, never the provider's own words. A guest's arrival reminder is one line, however many times it failed.":
    "最新 {n} 条失败或尚未发送的记录。只显示问题的类型，从不显示服务商自己的原文。客人的到达提醒无论失败多少次都只占一行。",
  "Last tried": "最后尝试",
  "Tries": "尝试次数",
  "fewer than {max} tries": "不足 {max} 次尝试",
  "No answer recorded": "没有记录到答复",
  "No provider key set": "未设置服务商密钥",
  "Phone number not accepted": "电话号码不被接受",
  "Channel not supported": "不支持该渠道",
  "The provider did not answer": "服务商没有响应",
  "The provider refused it": "服务商拒绝了它",
  "Message limit reached": "已达到发送次数上限",
  "Other problem": "其他问题",
  "When the automatic jobs run": "自动任务的运行时间",
  "Every day, at these times in hotel time. The times are read from the schedule file the hosting uses, not written twice. 'Last made' is the newest report the job itself made — the proof it ran; a report a person made by hand is shown apart.":
    "每天按以下酒店时间运行。时间直接读取自托管使用的计划文件，没有重复书写。“最近生成”是任务自己生成的最新报告——证明它确实运行过；人工手动生成的报告单独显示。",
  "Job": "任务",
  "Runs every day at": "每天运行时间",
  "Last made": "最近生成",
  "Never made by the job": "任务从未自动生成",
  "Last made by a person: {time} (for {date})": "人工最近生成：{time}（{date} 营业日）",

  // ───────── Speed & size: new records per day ─────────
  "New records per day": "每日新增记录",
  "Audit entries": "审计记录",
  "How many bookings, payments, restaurant orders and audit entries were made on each hotel day (from {start} to {start} the next morning, hotel time), last 14 days. The four kinds are drawn side by side, never added together. There are far more audit entries than the rest, so the others look thin; the table below has every number.":
    "每个营业日（酒店时间 {start} 至次日 {start}）新增的预订、付款、餐厅订单和审计记录数量，最近 14 天。四类记录并排绘制，不会相加。审计记录远多于其他项，因此其他项看起来很细；下方表格列出每个数字。",
};

export default catalog;
