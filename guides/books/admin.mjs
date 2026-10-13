import { chapter, tour, tip, warn, rule, p, h, dots, table, beside, shot, keep, pair, render } from "../tools/kit.mjs";

const GAP = '<div style="height:5mm"></div>';
// A picture on the left, its story on the right.
const left = (id, mm, ...blocks) => (c) => `<div class="split" style="grid-template-columns:${mm}mm 1fr;margin:0 0 4mm">${shot(id, { wrap: "" })}<div>${render(c, blocks)}</div></div>`;

// One book, two languages: make("en") is book 08, make("zh") is book 09 (see admin-zh.mjs).
// T picks the text, P picks the picture taken in that language.
export const make = (lang) => {
  const zh = lang === "zh";
  const T = (en, cn) => (zh ? cn : en);
  const P = (id) => (zh ? `${id}-zh` : id);

  return {
    id: zh ? "admin-zh" : "admin",
    file: zh ? "Vegas-Guide-09-Admin-Boss-and-MD-Chinese.pdf" : "Vegas-Guide-08-Admin-Boss-and-MD-English.pdf",
    name: T("Boss and MD guide", "老板与总经理手册"),
    lang, dept: "admin", accent: "#b3862a", soft: "#f6efdd",
    kind: T("Management", "管理层"),
    kicker: T("Guide book 08", "手册 09"),
    title: T("Boss | and MD", "老板 | 与总经理"),
    sub: T(
      "Your reports, the money, the people and the set-up of the whole system — what every page tells you, and what only you can change.",
      "您的报告、资金、人员和整个系统的设置——每个页面告诉您什么，以及只有您才能更改的内容。",
    ),
    cover: { shots: [P("a-cover")] },
    lead: T(
      "This book is for the **Boss** (the owner) and the **Managing Director (MD)** of Vegas Luxury Hotel. The staff do the work and the Manager runs the day; **you receive the reports, watch the money and set up the system** — prices, accounts, staff and their rights. Every change is recorded with your name and the time.",
      "本手册写给 Vegas Luxury Hotel 的**老板**和**总经理（MD）**。员工负责执行，经理负责每天的运营；**您接收报告、关注资金并设置系统**——价格、账户、员工及其权限。每一项更改都会连同您的姓名和时间一起记录。",
    ),

    place: [
      h(T("What comes to you", "哪些内容会到您这里")),
      table(T(["What", "From", "Where you see it"], ["内容", "来自", "在哪里看"]), T([
        ["The report of every shift", "Reception and the waiters, when a shift ends", "WhatsApp, and **Staff shifts**."],
        ["The daily business report", "The system, every morning at 07:00", "WhatsApp, and **Daily reports**."],
        ["The weekly and the monthly report", "The system, every Monday and on the 1st", "WhatsApp, and **Weekly & monthly**."],
        ["Everything that waits in the hotel", "Every department", "**Needs your attention** on Home."],
        ["An expense above the limit", "The staff member who recorded it", "**Expenses** — the line says **Waiting approval**."],
        ["A purchase to check", "The person who bought it", "**Stock requests** — the box **To approve**."],
      ], [
        ["每个班次的报告", "前台和服务员，班次结束时", "WhatsApp，以及**员工班次**。"],
        ["每日业务报告", "系统，每天早上 07:00", "WhatsApp，以及**日报**。"],
        ["周报和月报", "系统，每周一和每月 1 日", "WhatsApp，以及**周报与月报**。"],
        ["酒店里所有等待处理的事项", "每个部门", "首页的**需要您处理**。"],
        ["超过限额的支出", "记录该支出的员工", "**支出**——该行显示**待审批**。"],
        ["需要核对的采购", "采购人", "**领料申请**——**待批准**一栏。"],
      ])),
      h(T("What goes out from you", "哪些内容由您发出")),
      table(T(["What", "Goes to", "Where you do it"], ["内容", "去向", "在哪里操作"]), T([
        ["Room prices and promotions", "Reception and the website", "**Room pricing**."],
        ["The menu and its prices", "The restaurant, the QR pages and the website", "**Menu**."],
        ["Staff accounts and their rights", "Every staff member", "**Staff & roles**."],
        ["The rules of the system", "Every department", "**Control centre** and **Hotel** settings."],
        ["Mobile money taken out of nTZS", "The hotel's phone or bank account", "**Withdraw funds**."],
      ], [
        ["房价与促销", "前台和网站", "**房价**。"],
        ["菜单及其价格", "餐厅、二维码页面和网站", "**菜单**。"],
        ["员工账户及其权限", "每位员工", "**员工与角色**。"],
        ["系统的规则", "每个部门", "**控制中心**和**酒店**设置。"],
        ["从 nTZS 取出的手机支付款项", "酒店的手机号或银行账户", "**提现**。"],
      ])),
    ],

    chapters: [
      // ───────────────────────── 2
      chapter(T("Your role and your screen", "您的角色与界面"),
        T("The Boss and the MD open the same system as everybody else, but they see all of it. Both of you have the same menu and the same pages — the difference is in what each of you does with them.",
          "老板和总经理（MD）使用的是和大家相同的系统，但能看到全部内容。两位的菜单和页面完全一样——区别只在于各自用它们做什么。"),
        keep(
          h(T("Who does what", "谁负责什么")),
          table(T(["Who", "What they do in the system"], ["角色", "在系统里做什么"]), T([
            ["**Staff** — Reception, waiters, Counter, kitchen, driver", "The daily work: bookings, check-in, orders, payments, trips. Each one sees only their own part."],
            ["**Manager**", "Runs and supervises the hotel every day: watches every department, makes the operational decisions and steps in."],
            ["**Managing Director (MD)**", "Everything the Manager does, plus the system itself: staff and access, rooms, menu, tables, prices, payment accounts, settings and the audit history."],
            ["**Owner / Boss**", "Receives the reports, reviews the performance and makes the high-level decisions. Does not run the hotel day to day — and always has full access."],
          ], [
            ["**员工**——前台、服务员、收银台、厨房、司机", "日常工作：预订、入住、点餐、收款、接送。每个人只看到自己的部分。"],
            ["**经理**", "每天负责酒店的运营与监督：关注每个部门，做出日常运营决定，必要时亲自处理。"],
            ["**总经理（MD）**", "经理能做的一切，再加上系统本身：员工与权限、房间、菜单、餐桌、价格、收付款账户、设置和审计记录。"],
            ["**老板**", "接收报告、审视经营情况、做出重大决定。不负责日常运营——并且始终拥有完全权限。"],
          ])),
          tip(T(
            "Checking guests in and out and taking orders is the work of Reception and the restaurant — your pages show that work live. Your own work is to **read, decide and set up**.",
            "办理入住、退房和接单是前台和餐厅的工作——您的页面会实时显示这些工作。您自己的工作是**查看、决定和设置**。",
          )),
        ),
        keep(
          h(T("Home", "首页")),
          shot(P("a-home"), { w: 88 }),
          dots(T([
            "**The first line** — how many rooms are occupied tonight, the money received today, and what guests in the hotel have not paid yet.",
            "((1)) **NEEDS YOUR ATTENTION** — everything in the hotel that waits for somebody. | The number beside it counts the lines.",
            "**The tabs** — All, Front desk, Maintenance, Restaurant, Bookings, Stores, Rooms, Money. | Tap one to see only that department.",
            "**One line** — what it is, who or where, and an advice: **Extend or have reception check out**, **Follow the repair**, **Ask the kitchen**, **Reception should call back**, **Give it to someone**. | On the right: how long it has waited. Tap the line to open the place where it is solved.",
          ], [
            "**第一行**——今晚有多少间房入住、今天已收到的款项，以及在住客人尚未支付的金额。",
            "((1)) **需要您处理**——酒店里所有正在等人处理的事项。 | 旁边的数字是条目数。",
            "**标签**——全部、前台、维修中、餐厅、预订、库房、客房、款项。 | 点一个标签，只看该部门。",
            "**每一行**——什么事、谁或在哪里，以及建议：**延长住宿，或让前台办理退房**、**跟进维修**、**询问厨房**、**前台应回电**、**指派给员工**。 | 右侧是已等待的时间。点击该行，进入处理它的页面。",
          ]), true),
          tip(T(
            "Most lines belong to a department. You do not have to solve them yourself — you see that nothing is forgotten, and you ask the Manager when a line waits too long.",
            "大多数条目属于某个部门。您不必亲自处理——您只需确认没有事情被遗忘；某一行等待太久时，问经理。",
          )),
        ),
        keep(
          h(T("The menu, group by group", "菜单：逐组说明")),
          left(P("a-menu"), 30,
            table(T(["Group", "What is in it", "Chapter"], ["分组", "包含的页面", "章节"]), T([
              ["**Home**", "The hotel now, and what needs attention.", "2"],
              ["**FINANCE**", "Overview, Income, Expenses, Collections, Accounts, Companies, Who owes us, Online payments, Withdraw funds, Edit history, General ledger.", "4"],
              ["**BOOKINGS**", "Stays, Online, Calendar, Hotel QR.", "5, 8"],
              ["**HOTEL SERVICES**", "Rooms, Meetings, Requests, Transport, Daily lists, Spin to Win.", "5, 8"],
              ["**RESTAURANT & BAR**", "Live, Tables, Menu, History, Waiters, Reservations.", "5, 8"],
              ["**STORES**", "Inventory, Stock requests, Assets.", "6"],
              ["**PEOPLE**", "Shifts, Activity, Staff shifts, Staff & roles.", "3, 7"],
              ["**INSIGHTS**", "Reports, Daily reports, Weekly & monthly.", "3"],
              ["**SETTINGS**", "Hotel, Website, Messages, Customers, Languages, Room pricing, Expense types, Control centre.", "8"],
            ], [
              ["**首页**", "酒店当前情况，以及需要处理的事项。", "2"],
              ["**财务**", "概览、收入、支出、收款、账户、公司、应收款、在线支付、提现、修改记录、总账。", "4"],
              ["**预订**", "入住记录、在线预订、日历、酒店二维码。", "5、8"],
              ["**酒店服务**", "客房、会议、客人需求、交通、每日清单、幸运转盘。", "5、8"],
              ["**餐厅与酒吧**", "实时订单、餐桌、菜单、历史、服务员、预订。", "5、8"],
              ["**库房**", "库存管理、领料申请、资产。", "6"],
              ["**人员**", "班次、员工动态、员工班次、员工与角色。", "3、7"],
              ["**经营分析**", "报告、日报、周报与月报。", "3"],
              ["**设置**", "酒店、网站、消息、顾客、语言、房价、支出类型、控制中心。", "8"],
            ])),
            h(T("The top bar", "顶部栏")),
            dots(T([
              "**The date** and **Hotel day 04:00 → 04:00** — the hotel's day runs from 04:00 in the morning to 04:00 the next morning. | A drink sold at 01:00 belongs to the day before.",
              "**EN / 中文** — your language. It is saved on your account; each person chooses their own. | Language never changes prices, permissions or what anyone can do.",
              "**The bell** — notifications. The red number counts the new ones.",
            ], [
              "**日期**和**酒店营业日 04:00 → 04:00**——酒店的一天从凌晨 04:00 到次日凌晨 04:00。 | 凌晨 01:00 卖出的一杯饮料算在前一天。",
              "**EN / 中文**——您的语言。它保存在您的账户上，每个人自己选择。 | 语言不会改变价格、权限或任何人能做的事。",
              "**铃铛**——通知。红色数字是新通知的数量。",
            ])),
          ),
        ),
        keep(
          h(T("One system, two languages", "一个系统，两种语言")),
          pair(["a-md-home", { cap: T("The MD's Home in English.", "总经理的首页，英文。") }],
            ["a-md-home-zh", { cap: T("The same page in Chinese — the same numbers, the same records.", "同一页面的中文版——数字相同，记录相同。") }]),
          p(T(
            "Names, phone numbers, amounts, references and what people type are never translated. A receptionist can work in English while you read the same booking in Chinese.",
            "姓名、电话号码、金额、编号以及人们输入的内容不会被翻译。前台可以用英文工作，而您用中文查看同一条预订。",
          )),
        ),
      ),

      // ───────────────────────── 3
      chapter(T("The reports that come to you", "发给您的报告"),
        T("Nobody writes a report in this hotel. The system makes each one from what the staff recorded, keeps it, and sends the summary to the Boss by WhatsApp with a link.",
          "这家酒店没有人需要写报告。系统根据员工的记录自动生成每一份报告并保存下来，再通过 WhatsApp 把摘要和链接发给老板。"),
        keep(
          h(T("Which report, when", "哪份报告，什么时候")),
          table(T(["Report", "When", "What it tells you", "Where"], ["报告", "时间", "告诉您什么", "位置"]), T([
            ["**Shift report**", "When a shift ends — Reception or a waiter", "One person's shift: what they did, the money they recorded, the handover note.", "**Staff shifts**"],
            ["**Daily room report**", "Every morning at 06:30", "The rooms of the day that closed at 04:00, by room type, with the room numbers.", "**Daily reports** — the link **Daily room reports**"],
            ["**Daily business report**", "Every morning at 07:00", "Income, expenses, money received, what is owed, rooms and restaurant — for the day that closed at 04:00.", "**Daily reports**"],
            ["**Weekly report**", "Every Monday", "Last week: the business and the team.", "**Weekly & monthly**"],
            ["**Monthly report**", "On the 1st", "Last month: the business and the team.", "**Weekly & monthly**"],
            ["**Any period you choose**", "When you open it", "Today, this week, this month, this year, or your own dates.", "**Reports**"],
          ], [
            ["**班次报告**", "班次结束时——前台或服务员", "一个人的一个班次：做了什么、记录了多少款项、交接备注。", "**员工班次**"],
            ["**每日房间报告**", "每天早上 06:30", "04:00 结束的营业日的客房情况，按房型列出，带房号。", "**日报**页面上的房间报告链接"],
            ["**每日业务报告**", "每天早上 07:00", "收入、支出、已收款项、欠款、客房和餐厅——统计 04:00 结束的那个营业日。", "**日报**"],
            ["**周报**", "每周一", "上一周：业务与团队。", "**周报与月报**"],
            ["**月报**", "每月 1 日", "上个月：业务与团队。", "**周报与月报**"],
            ["**任意时间段**", "您打开时", "今天、本周、本月、今年，或自选日期。", "**报告**"],
          ])),
          tip(T(
            "The WhatsApp message is short on purpose: the main numbers, and a link at the end. Tap the link to open the full report.",
            "WhatsApp 消息特意写得很短：主要数字，末尾附一个链接。点击链接即可打开完整报告。",
          )),
        ),
        keep(
          h(T("The list of daily reports", "日报列表")),
          shot(P("a-daily-4"), { w: 86 }),
          p(T(
            "Open [[Daily reports]] under INSIGHTS. One line for every day: the date, who made it, **Revenue**, **Collected**, and whether it was sent. Tap a line to open the report. The link **Daily room reports** at the top opens the room reports.",
            "打开“经营分析”下的 [[日报]]。每天一行：日期、生成人、营收、已收款，以及是否已发送。点击某一行即可打开报告。页面上方的链接可打开每日房间报告。",
          )),
        ),
        tour(T("One daily report", "一份日报"), {
          shot: P("a-daily-2"),
          intro: T(
            "Under the title you read who made this version and at what time, and whether the message went out.",
            "标题下方显示这个版本由谁在什么时间生成，以及消息是否已经发出。",
          ),
          items: T([
            "**Print** — prints the report on paper.",
            "**PDF** — saves it as a file to keep or to send.",
            "**Share** — passes the report on to someone else.",
            "**Send now** — sends the summary by WhatsApp now. | **Send room report**, beside it, does the same for the room report.",
            "**Regenerate** — makes a new version from the records as they are now. | The earlier version is kept. Only the MD and the Boss have this button.",
          ], [
            "**打印**——把报告打印在纸上。",
            "**PDF**——保存为文件，便于留存或发送。",
            "**分享**——把报告转给其他人。",
            "**立即发送**——现在就通过 WhatsApp 发送摘要。 | 旁边的**发送房间报告**对房间报告做同样的事。",
            "**重新生成**——按现在的记录生成一个新版本。 | 之前的版本会保留。只有总经理和老板有这个按钮。",
          ]),
        }),
        keep(
          h(T("The six numbers at the top", "顶部的六个数字")),
          table(T(["Card", "What it means"], ["卡片", "含义"]), T([
            ["**INCOME**", "What the hotel earned today — room nights and what was served. It is not cash."],
            ["**EXPENSES**", "What was spent today. Rejected and waiting expenses are listed, but not counted."],
            ["**NET PROFIT**", "Income − expenses."],
            ["**MONEY RECEIVED**", "Cash, mobile money, bank and card that really came in today."],
            ["**STILL OWED**", "What is owed to the hotel — all dates, not only today."],
            ["**OCCUPANCY**", "How many of the rooms were occupied."],
          ], [
            ["**收入**", "酒店今天赚到的——房晚和已提供的餐饮。它不是现金。"],
            ["**支出**", "今天花掉的。被拒绝和待审批的支出会列出，但不计入。"],
            ["**净利润**", "收入 − 支出。"],
            ["**已收款项**", "今天真正到账的现金、手机支付、银行和刷卡。"],
            ["**仍欠**", "欠酒店的款项——所有日期，不只是今天。"],
            ["**入住率**", "有多少间房入住。"],
          ])),
          p(T(
            "Under the cards, **ATTENTION REQUIRED** lists the points of the day that somebody should look at.",
            "卡片下方的**需要关注**列出当天应该有人查看的事项。",
          )),
        ),
        keep(
          shot(P("a-daily-3-b"), { w: 84, cap: T(
            "**The day in plain facts** tells the day in sentences. **01 At a glance** gives the counts: rooms, bookings, check-ins and check-outs, restaurant, meeting room, transport.",
            "**今日要点**用句子讲述这一天。**01 概览**给出数量：客房、预订、入住与退房、餐厅、会议室、交通。",
          ) }),
        ),
        keep(
          shot(P("a-daily-3-c"), { w: 78, cap: T(
            "The section **Money**: **02 Income, expenses and net profit**, and **03 Income · received · owed**.",
            "**款项**部分：**02 收入、支出和净利润**，以及 **03 收入 · 已收 · 欠款**。",
          ) }),
          rule(T(
            "**Income, money received and money owed are three different things — never add them together.** Income is what was earned. Received is what was paid. Owed is what was earned and not paid yet.",
            "**收入、已收款项和欠款是三件不同的事——绝不能相加。**收入是赚到的；已收是付了的；欠款是赚到了但还没付的。",
          )),
        ),
        keep(
          shot(P("a-daily-3-d"), { w: 70, cap: T(
            "**04 By payment method**, **05 By account (where the money is)**, **06 Collected by (who recorded the money)** and **07 Where the money is owed**. Further down: **08 By category**, **09 Every expense**, then the sections for the rooms and the guests.",
            "**04 按付款方式**、**05 按账户（资金所在）**、**06 收款人**（谁记录了这笔钱）和 **07 欠款分布**。再往下：**08 按类别**、每一笔支出，然后是客房和客人部分。",
          ) }),
        ),
        keep(
          h(T("Weekly and monthly", "周报与月报")),
          shot(P("a-staffrep-a"), { w: 70 }),
          dots(T([
            "**THIS WEEK** and **THIS MONTH** — **Open the business & team so far** shows the running week or month, before its report is made.",
            "**Weekly reports** — made every Monday for the week before. | **Make last week's report** makes it now.",
            "**Monthly reports** — made on the 1st for the month before. | The button names the month: **Make September's report**.",
          ], [
            "**本周**和**本月**——**打开截至目前的业务与团队**可查看进行中的这一周或这个月，在正式报告生成之前。",
            "**周报**——每周一为上一周生成。 | **生成上周的报告**可以现在就生成。",
            "**月报**——每月 1 日为上个月生成。 | 按钮上写着月份，例如**生成2026年9月的报告**。",
          ]), true),
        ),
        keep(
          shot(P("a-staffrep-b"), { w: 70 }),
          dots(T([
            "**Each person** — everyone who worked in the last 5 weeks. | **This week** and **This month** open that person's own report.",
            "**Latest shift reports** — the newest ones. **Report** opens one; **All shifts** opens the whole list.",
          ], [
            "**每个人**——最近 5 周上过班的每一位。 | **本周**和**本月**打开该员工自己的报告。",
            "**最新班次报告**——最新的几份。**报告**打开其中一份；**所有班次**打开完整列表。",
          ]), true),
          tip(T(
            "Reports count what was recorded in the system — facts, never a score.",
            "报告统计的是系统中记录的内容——只是事实，从不评分。",
          )),
        ),
        keep(
          h(T("Staff shifts and the shift report", "员工班次与班次报告")),
          shot(P("a-shifts-all"), { w: 86 }),
          dots(T([
            "**ON SHIFT NOW**, **ENDED TODAY**, **REPORTS SENT**, **MESSAGES FAILED** — the counters. | A failed message is a WhatsApp that did not go out: the report is still here.",
            "**The filters** — Everyone, Reception, Restaurant; 7, 30 or 90 days; one person.",
            "**Shift** opens the shift itself. **Report** opens the report made when it ended.",
          ], [
            "**正在上班**、**今天结束**、**已发送报告**、**消息发送失败**——计数器。 | 发送失败是指 WhatsApp 没有发出：报告仍然保存在这里。",
            "**筛选**——所有人、前台、餐厅；7 天、30 天或 90 天；某一个人。",
            "**班次**打开班次本身。**报告**打开班次结束时生成的报告。",
          ]), true),
        ),
        keep(
          left(P("a-shiftrep-a"), 92,
            h(T("Inside a shift report", "班次报告的内容")),
            dots(T([
              "**The top** — who, which shift, from when to when and how long. **Made automatically** when the shift ended.",
              "**The buttons** — Print, PDF, Share, **Send to the Boss**, Regenerate.",
              "**STARTED · ENDED · ON SHIFT · HOTEL DAY · CLOSED · ACTIONS** — the shift in one row. | **Closed** says whether they closed it themselves or a manager did.",
              "**The counts** — what this person did, and the money they recorded.",
              "**AT THE END OF THE SHIFT** — what guests in the hotel still owed, and the **handover note** written for the next shift.",
            ], [
              "**顶部**——谁、哪个班次、从几点到几点、多长时间。班次结束时**自动生成**。",
              "**按钮**——打印、PDF、分享、**发送给老板**、重新生成。",
              "**开始 · 结束 · 在班 · 营业日 · 已关闭 · 操作次数**——用一行概括班次。 | **已关闭**说明是本人关闭还是经理关闭。",
              "**数量**——这个人做了什么，以及他们记录的款项。",
              "**班次结束时**——在住客人当时仍欠的金额，以及写给下一班的**交接备注**。",
            ])),
          ),
          pair([P("a-shiftrep-b"), { cap: T(
            "**How busy each hour was**, and **The work in detail** — every figure counted from their own records.",
            "**每小时的繁忙程度**，以及**工作明细**——每个数字都来自本人的记录。",
          ) }], [P("a-shiftrep-c"), { cap: T(
            "**Payments recorded** — kept apart from revenue and from what is still owed — and **The records**, line by line.",
            "**记录的付款**——与营收、与仍欠的款项分开列出——以及逐行的**记录明细**。",
          ) }]),
        ),
        tour(T("Reports — any period you choose", "报告——任意时间段"), {
          shot: P("a-reports"), w: 72,
          intro: T(
            "Open [[Reports]] under INSIGHTS. Choose the period — Today to This year — and a tab. **Excel (CSV)** saves the numbers as a spreadsheet.",
            "打开“经营分析”下的 [[报告]]。选择时间段（从今天到今年）和一个标签。**Excel (CSV)** 把数字保存为表格。",
          ),
          items: T([
            "**Print** — prints what you see.",
            "**PDF** — saves it as a file.",
            "**Share** — passes it on to someone else.",
          ], [
            "**打印**——打印当前看到的内容。",
            "**PDF**——保存为文件。",
            "**分享**——转给其他人。",
          ]),
          notes: [
            table(T(["Tab", "The question it answers"], ["标签", "它回答的问题"]), T([
              ["**Whole business**", "How did the hotel do in this period? Earned, received, spent, profit, owed, occupancy — and income by department."],
              ["**Daily sales**", "What was sold on each day?"],
              ["**Restaurant & bar**, **Best sellers**, **Tables**", "What the restaurant and the bar sold, which items sell most, and at which tables."],
              ["**Payments**, **Outstanding**", "What was paid and how — and what is still not paid."],
              ["**Rooms**, **Staff**, **Cancellations**", "How the rooms sold, who did what, and what was cancelled."],
              ["**Expenses**, **Stock & waste**", "What was spent, and what stock was used and wasted."],
            ], [
              ["**整体业务**", "这段时间酒店经营得如何？所得、已收、支出、利润、欠款、入住率——以及各部门收入。"],
              ["**每日销售**", "每一天卖了什么？"],
              ["**餐厅与酒吧**、**畅销品**、**餐桌**", "餐厅和酒吧卖了什么、哪些菜品最畅销、在哪些餐桌。"],
              ["**付款**、**未收款**", "付了什么、怎么付的——以及哪些还没付。"],
              ["**客房**、**员工**、**取消**", "客房销售情况、谁做了什么、取消了什么。"],
              ["**支出**、**库存与损耗**", "花了什么，以及用掉和损耗了多少库存。"],
            ])),
          ],
        }),
        rule(T(
          "**A report that was made is never rewritten.** When a record is corrected later, **Regenerate** makes a new version and keeps the old one — you can always see what was reported on the day.",
          "**已生成的报告绝不会被改写。**之后如果更正了某条记录，**重新生成**会产生一个新版本并保留旧版本——您随时可以看到当天报告的内容。",
        )),
      ),

      // ───────────────────────── 4
      chapter(T("Money", "资金"),
        T("FINANCE is the hotel's money, from the total down to a single payment. Every figure comes from a record a staff member made — and every record shows who made it and when.",
          "“财务”就是酒店的资金，从总数一直到每一笔付款。每个数字都来自员工所做的记录——每条记录都显示是谁、在什么时候做的。"),
        keep(
          h(T("Overview", "概览")),
          shot(P("a-fin-a"), { w: 90 }),
          dots(T([
            "**The period** — Today, Yesterday, This week, This month, This year, or your own dates, then **Show**.",
            "**Earned − Spent = Result** — what the hotel earned, what it spent, and what is left.",
            "**Came in** — the money really received. **Owed** — earned and not paid yet.",
            "**Occupancy**, **Average room rate**, **Income per room (RevPAR)**, **Nights sold** — how well the rooms sell.",
            "**Restaurant orders** and **Discounts & refunds** — the last two tiles.",
          ], [
            "**时间段**——今天、昨天、本周、本月、今年，或自选日期，然后点 **显示**。",
            "**营收 − 支出 = 结余**——酒店赚了多少、花了多少、剩下多少。",
            "**已到账**——真正收到的钱。**欠款**——赚到了但还没付的。",
            "**入住率**、**平均房价**、**每间房收入（RevPAR）**、**已售晚数**——客房卖得如何。",
            "**餐厅订单**和**折扣与退款**——最后两块。",
          ]), true),
        ),
        keep(
          shot(P("a-fin-b"), { w: 76, cap: T(
            "**Day by day** — earned, spent and received on each day of the period. **Where income comes from** — rooms, restaurant, bar, meeting room and the rest.",
            "**按日**——这段时间内每天的营收、支出和到账。**收入来源**——客房、餐厅、酒吧、会议室及其他。",
          ) }),
        ),
        keep(
          h(T("The pages of FINANCE", "“财务”下的页面")),
          table(T(["Page", "What it is for"], ["页面", "用途"]), T([
            ["**Income**", "Every payment the hotel received. Record, edit, reverse."],
            ["**Expenses**", "Every expense. Record, approve, reject, edit, cancel."],
            ["**Collections**", "Who collected what, how it was paid, and into which account."],
            ["**Accounts**", "Where the money is: cash, mobile money, the banks. Money movements and cash counts."],
            ["**Companies**", "Companies that stay on credit: what they owe, their limit, their invoices."],
            ["**Who owes us**", "Guests, meetings and company invoices that are not paid yet."],
            ["**Online payments**", "Payments customers make from their phone, and where that is allowed."],
            ["**Withdraw funds**", "Takes the mobile money out of nTZS, to a phone or a bank account."],
            ["**Edit history**", "Every change to a money record: who, when, old value and new value."],
            ["**General ledger**", "Every movement in and out, line by line. **Export CSV** saves it."],
          ], [
            ["**收入**", "酒店收到的每一笔付款。记录、编辑、冲销。"],
            ["**支出**", "每一笔支出。记录、批准、拒绝、编辑、取消。"],
            ["**收款**", "谁收了什么、怎么付的、存入了哪个账户。"],
            ["**账户**", "钱在哪里：现金、手机支付、银行。资金变动和现金盘点。"],
            ["**公司**", "挂账入住的公司：欠款、信用额度、发票。"],
            ["**应收款**", "尚未付款的客人、会议和公司发票。"],
            ["**在线支付**", "顾客用手机完成的付款，以及在哪些地方允许这样付款。"],
            ["**提现**", "把手机支付的钱从 nTZS 取出，汇到手机号或银行账户。"],
            ["**修改记录**", "资金记录的每一次更改：谁、何时、旧值和新值。"],
            ["**总账**", "每一笔进账和出账，逐行列出。**导出 CSV** 可保存。"],
          ])),
        ),
        tour(T("Income", "收入"), {
          shot: P("a-income"),
          intro: T(
            "Open [[Income]]. Reception and the Counter record the daily payments — you see all of them, by source and by account.",
            "打开 [[收入]]。日常付款由前台和收银台记录——您能看到全部，按来源和账户划分。",
          ),
          items: T([
            "**Record payment** — for a payment that reaches you directly.",
            "**Edit** — corrects the account it was received through, or the transaction reference. | The amount stays the same.",
            "**Reverse** — takes a payment back when it was recorded by mistake. | On a restaurant sale the button says **Cancel**.",
          ], [
            "**记录付款**——用于直接交到您手上的付款。",
            "**编辑**——更正收款账户或交易编号。 | 金额保持不变。",
            "**冲销**——付款记错时把它撤回。 | 在餐厅销售上，这个按钮显示为**取消**。",
          ]),
          notes: [warn(T(
            "**Never change a payment to make a report look right.** If the money is not there, the record must say so. Every edit and every reversal is kept in **Edit history** with your name.",
            "**绝不要为了让报告好看而改动付款。**钱没到，记录就必须如实显示。每一次编辑和冲销都会连同您的姓名保存在**修改记录**里。",
          ))],
        }),
        tour(T("Expenses and approvals", "支出与审批"), {
          shot: P("a-expenses-c"), w: 74,
          intro: T(
            "Open [[Expenses]]. An expense at or above the **Expense approval threshold** (chapter 8) is not final when staff record it: it waits as **Waiting approval**.",
            "打开 [[支出]]。达到或超过**支出审批金额**（第 8 章）的支出，在员工记录后并不立即生效：它会显示为**待审批**。",
          ),
          items: T([
            "**Record expense** — write an expense yourself: what, how much, the type, and the account that paid.",
            "**Approve** — one press. The expense counts, with your name.",
            "**Reject** — the system asks you to tell the staff member why.",
          ], [
            "**记录支出**——自己录入一笔支出：内容、金额、类型和付款账户。",
            "**批准**——点一下即可。这笔支出计入，并写上您的姓名。",
            "**拒绝**——系统会请您告诉该员工原因。",
          ]),
          notes: [p(T(
            "**Edit** corrects a record — you must say what was wrong with it. **Cancel** takes it out: it stays on the register, struck through and not counted, with your name and the reason. The tabs **Monthly bills** and **Summary by type** show the regular bills and the totals for each type.",
            "**编辑**用于更正记录——必须说明哪里错了。**取消**把它移除：它仍留在登记册上，划线且不计入，并写有您的姓名和原因。**每月账单**和**按类型汇总**两个标签显示固定账单和各类型的合计。",
          ))],
        }),
        keep(
          h(T("Collections and Who owes us", "收款与应收款")),
          pair([P("a-collections"), { cap: T(
            "**Collections** — every payment of the hotel, the restaurant and the other sales: into which account, how it was paid, and what is still to collect.",
            "**收款**——酒店、餐厅及其他销售的每一笔付款：存入哪个账户、付款方式，以及待收款。",
          ) }], [P("a-owes"), { cap: T(
            "**Who owes us** — the total outstanding, guests and meetings, overdue invoices, and each company.",
            "**应收款**——未收款合计、客人与会议、逾期发票，以及按公司列出。",
          ) }]),
        ),
        keep(
          h(T("Accounts", "账户")),
          shot(P("a-accounts-a"), { w: 86 }),
          dots(T([
            "**IN THE BOOKS** — what the hotel's records add up to. | Check it against the bank statement: it is not read from the bank.",
            "**The cards under it** — one for each account: cash, the mobile-money tills, the banks, the card terminal, petty cash and nTZS.",
            "**Add account** — a new place where the hotel keeps money.",
            "**Money movement** — a transfer between two accounts (cash taken to the bank), the owner's money, other income, or a correction. | Each movement gets its own number, and **Reverse** undoes it with a record.",
            "**Cash counts** — press **Count** on an account and type what was counted. | The system shows counted against expected. A difference must be explained and accepted.",
          ], [
            "**账面合计**——酒店记录的合计。 | 请与银行对账单核对：数据并非从银行读取。",
            "**下面的卡片**——每个账户一张：现金、手机支付收款账户、银行、刷卡机、备用金和 nTZS。",
            "**添加账户**——酒店存放资金的一个新地方。",
            "**资金变动**——两个账户之间的转账（把现金存入银行）、老板的资金、其他收入或更正。 | 每笔变动都有自己的编号，并且可以撤销，撤销本身也会留下记录。",
            "**现金盘点**——在某个账户上点盘点，输入实际清点的金额。 | 系统会把清点数与应有数对比。差额必须说明原因并被认可。",
          ])),
        ),
        keep(
          h(T("Companies", "公司")),
          beside(P("a-companies"), 96,
            p(T(
              "Open [[Companies]]. These are the companies whose people stay now and pay later by invoice.",
              "打开 [[公司]]。这些公司的人员先入住，之后凭发票付款。",
            )),
            dots(T([
              "**Add company** — a new company account.",
              "**Companies owe**, **Overdue**, **Not invoiced yet** — the three totals. | Not invoiced yet: stays in progress and draft invoices.",
              "**A company card** — the contact, what it owes, what is overdue, its payment days and stays, and the credit left of its limit.",
            ], [
              "**添加公司**——新建一个公司账户。",
              "**公司欠款**、**已逾期**、**尚未开票**——三个合计。 | 尚未开票：进行中的入住和草稿发票。",
              "**公司卡片**——联系人、欠款、逾期金额、付款天数和入住次数，以及剩余信用额度。",
            ])),
          ),
        ),
        keep(
          h(T("Online payments", "在线支付")),
          left(P("a-online-c"), 54,
            p(T(
              "Open [[Online payments]]. Customers can pay from their phone with mobile money, through **nTZS**. On this page you choose **where** that is allowed.",
              "打开 [[在线支付]]。顾客可以通过 **nTZS** 用手机支付。在这个页面，您决定**哪些地方**允许这样付款。",
            )),
            dots(T([
              "**The switches** — Restaurant & bar orders, Room service, Guest bills, Room bookings, Meeting room, Transport, Invoices. Then **Save**.",
              "**The top of the page** says whether the service is connected. The keys stay on the server — never on a screen. Nino connects them.",
              "**Under it** — Paid online, Waiting, Not completed, Needs a person; and **Reconciliation**: every payment nTZS confirmed, checked against the hotel's books.",
            ], [
              "**开关**——餐厅与酒吧订单、客房送餐、客人账单、客房预订、会议室、交通、发票。然后点 **保存**。",
              "**页面顶部**显示服务是否已接通。密钥保存在服务器上——绝不显示在屏幕上，由 Nino 负责接通。",
              "**下方**——在线支付、等待中、未完成、需人工处理；以及**对账**：nTZS 确认的每一笔付款都与酒店账簿核对。",
            ])),
            tip(T(
              "Cash, bank, manual mobile money and Charge to room keep working whatever is set here.",
              "无论这里怎么设置，现金、银行、人工登记的手机支付和记入房账都照常可用。",
            )),
          ),
        ),
        keep(
          h(T("Withdraw funds", "提现")),
          shot(P("a-withdraw"), { w: 80 }),
          p(T(
            "Open [[Withdraw funds]]. The mobile money that customers pay online is kept in the hotel's nTZS balance. Here the Boss or the MD takes it out — to a phone or to a bank account. Nobody else has this page.",
            "打开 [[提现]]。顾客在线支付的钱保存在酒店的 nTZS 余额里。老板或总经理在这里把它取出——汇到手机号或银行账户。其他人没有这个页面。",
          )),
          dots(T([
            "**Available at nTZS** — what can be taken out now. **On its way** — sent, not arrived yet.",
            "**In the hotel's own books** — the hotel's record, not nTZS's figure. The two can differ.",
            "**Withdrawn**, **nTZS fees**, **Pending**, **Failed or refused** — the withdrawals of the period.",
            "**Three steps** — the system gets the official quote from nTZS (the fee, and what will arrive); you send it; nTZS confirms that the money arrived.",
          ], [
            "**nTZS 可用余额**——现在可以取出的金额。**配送中**——已发出，尚未到账。",
            "**酒店自己的账簿**——酒店自己的记录，不是 nTZS 的数字。两者可能不同。",
            "**已提现**、**nTZS 手续费**、**待处理**、**失败或被拒绝**——这段时间内的提现。",
            "**三个步骤**——系统向 nTZS 获取正式报价（手续费和到账金额）；您发出提现；nTZS 确认款项已到账。",
          ]), true),
          warn(T(
            "**Never send the same withdrawal twice.** While one shows **Pending**, wait for the result. A withdrawal moves money out of nTZS — it is never counted as income or as an expense; only nTZS's fee is recorded as a cost.",
            "**同一笔提现绝不要发两次。**显示为**待处理**时，请等待结果。提现只是把钱从 nTZS 转出——既不算收入，也不算支出；只有 nTZS 的手续费记为费用。",
          )),
        ),
        keep(
          h(T("Edit history and the general ledger", "修改记录与总账")),
          pair([P("a-history"), { cap: T(
            "**Edit history** — every change to a money record: who, when, the old value and the new one. Filters: Everything, Expenses & purchases, Payments & refunds, Prices & discounts, Bookings, Invoices & companies, Cash & accounts.",
            "**修改记录**——资金记录的每一次更改：谁、何时、旧值和新值。筛选：全部、支出与采购、付款与退款、价格与折扣、预订、发票与公司、现金与账户。",
          ) }], [P("a-ledger"), { cap: T(
            "**General ledger** — every movement in and out, line by line. ((1)) **Export CSV** saves it for the accountant.",
            "**总账**——每一笔进账和出账，逐行列出。((1)) **导出 CSV** 可保存后交给会计。",
          ) }]),
        ),
        rule(T(
          "**A zero is not a payment.** Unpaid, paid, discounted and owed are four different things. The system keeps them apart — keep them apart when you speak about money too.",
          "**零不等于已付款。**未付、已付、已打折和欠款是四件不同的事。系统把它们分开——您谈到钱的时候也请分开。",
        )),
      ),

      // ───────────────────────── 5
      chapter(T("The hotel, live", "酒店实时情况"),
        T("You do not need to phone the hotel to know what is happening. These pages show the work of Reception, the restaurant and the drivers as it happens — they work, you look.",
          "不必打电话到酒店才知道情况。这些页面实时显示前台、餐厅和司机的工作——他们做，您看。"),
        keep(
          h(T("Where to look", "去哪里看")),
          table(T(["Page", "What you see", "Who does the work"], ["页面", "您看到什么", "谁在做"]), T([
            ["**Stays**, **Online**", "Every booking: arriving today, in the hotel, leaving today, coming. Online: the requests from the website.", "Reception"],
            ["**Calendar**", "Every room, every night — one week, two weeks or a month.", "Reception"],
            ["**Rooms**", "Every room at a glance: occupied, available, arriving today, needs cleaning.", "Reception, housekeeping"],
            ["**Meetings**", "The bookings of the meeting room.", "Reception"],
            ["**Requests**", "What guests asked for: towels, cleaning, a repair.", "Reception, and whoever it is given to"],
            ["**Transport**", "Airport pickups and other trips.", "Reception and the driver"],
            ["**Live**", "Every restaurant order from new to served, and what is not paid.", "Waiters, Counter, kitchen"],
            ["**Tables**, **Menu**, **History**, **Waiters**, **Reservations**", "The tables and their QR codes, the menu, past orders, who is serving, table bookings.", "The restaurant"],
            ["**Customers**", "Everyone who has stayed, booked or ordered — the phone number finds them.", "Everybody"],
            ["**Messages**", "Enquiries sent through the contact form of the website.", "Reception answers"],
          ], [
            ["**入住记录**、**在线预订**", "每一条预订：今日抵达、在住、今天离店、即将到来。在线预订：来自网站的请求。", "前台"],
            ["**日历**", "每间房，每一晚——一周、两周或一个月。", "前台"],
            ["**客房**", "所有房间一目了然：已入住、可用、今日抵达、待清洁。", "前台、客房清洁"],
            ["**会议**", "会议室的预订。", "前台"],
            ["**客人需求**", "客人提出的需求：毛巾、清洁、维修。", "前台，以及被指派的人"],
            ["**交通**", "机场接送及其他行程。", "前台和司机"],
            ["**实时订单**", "餐厅的每一张订单，从新订单到已上菜，以及未付款的部分。", "服务员、收银台、厨房"],
            ["**餐桌**、**菜单**、**历史**、**服务员**、**预订**", "餐桌及其二维码、菜单、历史订单、谁在服务、订桌。", "餐厅"],
            ["**顾客**", "所有住过、订过或点过餐的人——用电话号码即可找到。", "所有人"],
            ["**消息**", "通过网站联系表单发来的咨询。", "前台回复"],
          ])),
        ),
        keep(
          pair([P("a-rooms"), { cap: T(
            "**Rooms** — one tile for every room. The Boss and the MD also have **Room QR codes**, **Room types & inventory**, **Room pricing** and **Add room** at the top.",
            "**客房**——每间房一个方块。老板和总经理在顶部还有**房间二维码**、**房型与房源**、**房价**和**添加房间**。",
          ) }], [P("a-cal"), { cap: T(
            "**Calendar** — every room, every night: who is in which room, and which nights are free.",
            "**日历**——每间房，每一晚：谁住在哪间房，哪些晚上空着。",
          ) }]),
        ),
        keep(
          pair([P("a-rest-live"), { cap: T(
            "**Live** — the restaurant and the bar now: new orders, preparing, ready, being served — and what is still to collect.",
            "**实时订单**——餐厅和酒吧的现状：新订单、准备中、已备好、上菜中——以及待收款。",
          ) }], [P("a-waiters"), { cap: T(
            "**Waiters** — who is on shift now, and their orders.",
            "**服务员**——现在谁在上班，以及他们的订单。",
          ) }]),
        ),
        keep(
          pair([P("a-requests"), { cap: T(
            "**Requests** — new, in progress and done today. A request that nobody took can be given to someone.",
            "**客人需求**——新、处理中、今日已完成。没人接的需求可以指派给某位员工。",
          ) }], [P("a-transport"), { cap: T(
            "**Transport** — the trips guests asked for, their prices and their drivers.",
            "**交通**——客人申请的行程、价格和司机。",
          ) }]),
        ),
        keep(
          pair([P("a-customers"), { cap: T(
            "**Customers** — tabs: All, In the hotel, At a table now, Coming, Restaurant, Returning, New this month.",
            "**顾客**——标签：全部、在住、正在用餐、即将到店、餐厅、回头客、本月新顾客。",
          ) }], [P("a-messages"), { cap: T(
            "**Messages** — what guests wrote on the website's contact form.",
            "**消息**——客人在网站联系表单里写的内容。",
          ) }]),
          tip(T(
            "The Boss and the MD can make every decision the Manager makes on a room or a bill — move a guest, close or open a room, release a no-show's room. Those steps are explained in the **Manager** guide, book 07.",
            "经理能在房间或账单上做的每一个决定，老板和总经理都可以做——给客人换房、关闭或开放房间、释放未到店客人的房间。具体步骤见**经理**手册（手册 07）。",
          )),
        ),
      ),

      // ───────────────────────── 6
      chapter(T("Stores: stock, buying and assets", "库房：库存、采购与资产"),
        T("Stock changes only by a movement that somebody recorded: received, used, wasted, counted. The departments ask and report, the Manager approves — and you see what it costs.",
          "库存只会因为有人记录的出入库而变化：收货、使用、损耗、盘点。各部门提出申请和上报，经理审批——而您看到的是成本。"),
        keep(
          h(T("Inventory", "库存")),
          shot(P("a-inventory"), { w: 86 }),
          dots(T([
            "((1)) **Receive stock** — goods arrived: they go into the store.",
            "**The chips on top** change the department: Kitchen, Restaurant, Bar, Housekeeping and the others.",
            "**The tabs** — Stock, Movements, Waste, Count, Recipes and Setup. | **Movements** lists everything that came in or went out, with who and why.",
            "**Needs attention** — the items that are finished or under their minimum.",
            "**Recipes** tell the system what a dish uses, so the stock goes down by itself when the kitchen marks the dish ready.",
            "**Setup** — items, units, minimums, suppliers — is the MD's work.",
          ], [
            "((1)) **收货入库**——货到了：放入库房。",
            "**顶部的标签**切换部门：厨房、餐厅、酒吧、客房部等。",
            "**标签页**——库存、出入库记录、损耗、盘点、配方和基础设置。 | **出入库记录**列出所有进出，包括谁、为什么。",
            "**需要关注**——已用完或低于最低库存的物品。",
            "**配方**告诉系统一道菜用了什么，厨房把菜标为已备好时，库存会自动减少。",
            "**基础设置**——物品、单位、最低库存、供应商——由总经理负责。",
          ]), true),
        ),
        keep(
          h(T("Buying stock: four steps, one expense", "采购库存：四个步骤，一笔支出")),
          table(T(["Step", "Who", "What happens"], ["步骤", "谁", "发生什么"]), T([
            ["**1 · Ask**", "A department", "The cook taps what is needed and sends the list. No money yet."],
            ["**2 · Review**", "A manager", "Approve for purchase, send back or reject. Approval is permission to buy — not an expense."],
            ["**3 · Buy**", "Whoever goes to buy", "Records the purchase: what the receipt says, from whom, paid from which account."],
            ["**4 · Final approval**", "A manager, the MD or the Boss", "The stock goes in, and **one** expense is recorded."],
          ], [
            ["**1 · 申请**", "某个部门", "厨师点选需要的物品并发送清单。此时还不涉及钱。"],
            ["**2 · 审核**", "经理", "批准采购、退回或拒绝。批准只是允许购买——不是支出。"],
            ["**3 · 采购**", "去采购的人", "记录采购：小票上的内容、向谁购买、从哪个账户支付。"],
            ["**4 · 最终批准**", "经理、总经理或老板", "库存入库，并记录**一笔**支出。"],
          ])),
          shot(P("a-stockreq"), { w: 80, cap: T(
            "**Stock requests** — the four boxes follow the four steps: to review, to buy, being bought, to approve. Under them, what was spent on stock today and this month.",
            "**领料申请**——四个方框对应四个步骤：待审核、待采购、采购中、待批准。下方是今天和本月的库存采购支出。",
          ) }),
          warn(T(
            "When the hotel requires a different approver (chapter 8), the person who bought cannot give the final approval — another manager, the MD or the Boss does.",
            "如果酒店要求由不同的人审批（第 8 章），采购人本人不能做最终批准——由另一位经理、总经理或老板来做。",
          )),
        ),
        keep(
          h(T("Assets", "资产")),
          beside(P("a-assets"), 96,
            p(T(
              "Open [[Assets]]. Furniture, equipment and electronics — kept apart from the stock that gets used up.",
              "打开 [[资产]]。家具、设备和电器——与会被消耗的库存分开管理。",
            )),
            dots(T([
              "**Add asset** — a new item, with where it is.",
              "**The chips** filter the list: needs attention, in use, in store, under repair, disposed, all.",
              "An asset out of order in a guest room also shows on **Home**, under **Maintenance**.",
            ], [
              "**新增资产**——新增一项资产及其所在位置。",
              "**标签**用于筛选：需要关注、使用中、在库、维修中、已处置、全部。",
              "客房里出故障的资产也会显示在**首页**的**维修中**下。",
            ])),
          ),
        ),
      ),

      // ───────────────────────── 7
      chapter(T("People and access", "人员与权限"),
        T("Every person signs in with their own account, and the account's role decides what they see and what they can do. Accounts and rights are set by the MD and the Boss — nobody else can change them.",
          "每个人用自己的账户登录，账户的角色决定他们能看到什么、能做什么。账户和权限由总经理和老板设置——其他人无法更改。"),
        tour(T("Staff & roles", "员工与角色"), {
          shot: P("a-users"), w: 84,
          intro: T(
            "Open [[Staff & roles]] under PEOPLE. One line for each account: name, email, role, last sign-in and status.",
            "打开“人员”下的 [[员工与角色]]。每个账户一行：名称、邮箱、角色、上次登录和状态。",
          ),
          items: T([
            "**Add staff** — makes a new account and gives it a role.",
            "**Role permissions** — the table of what each role is allowed to do.",
          ], [
            "**添加员工**——新建账户并赋予角色。",
            "**角色权限**——每个角色被允许做什么的表格。",
          ]),
          notes: [
            table(T(["When", "What to do"], ["情况", "怎么做"]), T([
              ["Somebody joins", "**Add staff**. Give the role of the job they really do — not a higher one. They sign in with their own email and password."],
              ["Somebody forgot the password", "Reset it from the actions on their line, and give them the new one privately."],
              ["Somebody leaves", "Switch the account off the same day. Their past work stays in the history under their name."],
            ], [
              ["有人入职", "**添加员工**。按其实际工作赋予角色——不要给更高的角色。他们用自己的邮箱和密码登录。"],
              ["有人忘记密码", "在该行的操作里重置密码，并私下把新密码告诉本人。"],
              ["有人离职", "当天就停用账户。其过去的工作仍以本人姓名保留在记录里。"],
            ])),
          ],
        }),
        keep(
          h(T("Role permissions", "角色权限")),
          shot(P("a-roles"), { w: 88 }),
          p(T(
            "One line for every right, one column for every role: Managing Director (MD), Owner / Boss, Manager, Receptionist, Driver, Waiter, Mpishi (cook) and Restaurant Counter. A tick means the role has the right. **The Owner role always has full access.** Changes apply from the staff member's next page load, and are audited.",
            "每项权限一行，每个角色一列：总经理（MD）、老板、经理、前台接待、司机、服务员、Mpishi（厨师）和餐厅收银台。打勾表示该角色拥有此权限。**老板角色始终拥有完全权限。**更改在员工下次加载页面时生效，并记入审计。",
          )),
          warn(T(
            "**Give a right because the job needs it — never to make a problem go away quickly.** The rights about money are the ones to guard: recording payments, approving expenses, changing prices, withdrawing funds.",
            "**因为工作需要才授予权限——绝不要为了快速解决问题而授权。**与钱有关的权限最需要把关：记录付款、审批支出、修改价格、提现。",
          )),
        ),
        GAP,
        keep(
          h(T("What only the MD and the Boss can do", "只有总经理和老板能做的事")),
          dots(T([
            "Staff accounts and role permissions.",
            "Payment accounts, money movements and cash counts.",
            "Withdraw funds.",
            "Room prices, promotions and date prices.",
            "Rooms and room types.",
            "The menu and its prices.",
            "Hotel settings and the website.",
            "Hotel QR and Spin to Win.",
            "The set-up of the stores, and the assets.",
          ], [
            "员工账户和角色权限。",
            "收付款账户、资金变动和现金盘点。",
            "提现。",
            "房价、促销和日期价格。",
            "房间和房型。",
            "菜单及其价格。",
            "酒店设置和网站。",
            "酒店二维码和幸运转盘。",
            "库房的基础设置，以及资产。",
          ]), true),
        ),
        keep(
          h(T("Shifts and activity", "班次与员工动态")),
          pair([P("a-shifts"), { cap: T(
            "**Shifts** — the front desk: who is at the desk now, who is scheduled, the previous shift, and the money still to collect.",
            "**班次**——前台：现在谁在岗、今天排了谁、上一个班次，以及待收款项。",
          ) }], [P("a-activity"), { cap: T(
            "**Activity** — who did what, and when, with the values before and after. Filter by staff member and by area.",
            "**员工动态**——谁在什么时候做了什么，以及更改前后的值。可按员工和模块筛选。",
          ) }]),
          tip(T(
            "Questions like **who changed this price?** or **who cancelled that order?** are answered in Activity in a minute. Look before you ask the staff.",
            "像**谁改了这个价格？**或**谁取消了那张订单？**这样的问题，在员工动态里一分钟就能找到答案。先查，再问员工。",
          )),
        ),
        rule(T(
          "**Nobody shares an account.** Each person signs in with their own name — that is why the system can tell you who did what.",
          "**任何人都不共用账户。**每个人用自己的名字登录——正因如此，系统才能告诉您谁做了什么。",
        )),
      ),

      // ───────────────────────── 8
      chapter(T("Setting up the system", "设置系统"),
        T("The Control centre is the map of everything that can be set up: people, business rules, money, rooms and restaurant, stores, reports. A change here changes how the whole hotel works — and every change is recorded.",
          "控制中心是所有可设置内容的总览：人员、业务规则、资金、房间与餐厅、仓库、报告。这里的一次更改会改变整个酒店的运作方式——每项更改都有记录。"),
        keep(
          h(T("The Control centre", "控制中心")),
          shot(P("a-control-a"), { w: 88 }),
          table(T(["Group", "The cards"], ["分组", "卡片"]), T([
            ["**People & access**", "Staff accounts · Roles & permissions · Audit history"],
            ["**Business settings**", "Hotel details & policies · Languages · Tax / VAT · Notifications · Website"],
          ], [
            ["**人员与权限**", "员工账户 · 角色与权限 · 审计记录"],
            ["**业务设置**", "酒店信息与政策 · 语言 · 税费 / 增值税 · 通知 · 网站"],
          ])),
        ),
        keep(
          shot(P("a-control-b"), { w: 80 }),
          table(T(["Group", "The cards"], ["分组", "卡片"]), T([
            ["**Money set-up**", "Room pricing & promotions · Payment accounts · Expense types · Stock purchasing · Who approves a purchase · Financial corrections"],
            ["**Rooms & restaurant**", "Rooms & room types · Menu & categories · Tables & table QR codes · Room QR codes · Hotel booking QR · Spin to Win"],
            ["**Stores & assets**", "Inventory set-up · Recipes · Assets"],
            ["**Reports & oversight**", "Reports centre · Daily business reports"],
          ], [
            ["**资金设置**", "房价与促销 · 收付款账户 · 支出类型 · 库存采购 · 谁批准采购 · 财务更正"],
            ["**房间与餐厅**", "房间与房型 · 菜单与分类 · 餐桌与餐桌二维码 · 房间二维码 · 酒店预订二维码 · 幸运转盘"],
            ["**仓库与资产**", "库存设置 · 配方 · 资产"],
            ["**报告与监督**", "报告中心 · 每日业务报告"],
          ])),
          tip(T(
            "Each card opens the page where that thing is set. The small text on a card shows how it is set now.",
            "每张卡片都会打开对应的设置页面。卡片上的小字显示当前的设置情况。",
          )),
        ),
        keep(
          h(T("Hotel settings", "酒店设置")),
          shot(P("a-settings"), { w: 84 }),
          table(T(["Part", "What you set"], ["部分", "设置内容"]), T([
            ["**Hotel details**", "Name, tagline, address, phone, WhatsApp, email and website — shown on the public website, on confirmations and on invoices."],
            ["**Hotel day & stay times**", "When the business day starts, the standard check-in, the checkout time and the late-arrival time. Change them only with care: they move the boundary for future records."],
            ["**Pricing, expenses & invoices**", "The **Expense approval threshold** — expenses at or above this amount wait for manager approval. Invoice due days, automatic invoice numbers, the tax name and rate — and the switch that makes someone other than the buyer give the final approval of a stock purchase."],
            ["**Invoice “Pay into” details**", "The bank details printed on invoices."],
            ["**Guest messages**", "Nothing to fill in: every message is written by the system from the real booking, bill, payment or order."],
          ], [
            ["**酒店信息**", "名称、标语、地址、电话、WhatsApp、邮箱和网站——显示在公开网站、确认信息和发票上。"],
            ["**营业日与住宿时间**", "营业日开始时间、标准入住时间、退房时间和晚到时间。请谨慎更改：它们会移动今后记录的分界点。"],
            ["**价格、支出与发票**", "**支出审批金额**——达到或超过此金额的支出需等待经理审批。发票到期天数、自动发票编号、税种名称和税率——以及让采购人以外的人对库存采购做最终审批的开关。"],
            ["**发票“付款至”信息**", "打印在发票上的银行信息。"],
            ["**客人消息**", "无需填写：每条消息都由系统根据真实的预订、账单、付款或订单生成。"],
          ])),
        ),
        tour(T("Room pricing", "房价"), {
          shot: P("a-pricing"),
          intro: T(
            "Open [[Room pricing]]. Reception and the website use these prices automatically. A booking keeps the price it was made at.",
            "打开 [[房价]]。前台和网站会自动使用这些价格。预订保留下单时的价格。",
          ),
          items: T([
            "**New date price** — a different price for chosen dates: a weekend, a holiday, a season.",
            "**New promotion** — a lower price for a period. | One promotion a night at most: the highest priority wins. They never add up.",
          ], [
            "**新建日期价格**——为选定日期设置不同的价格：周末、节假日、旺季。",
            "**新建促销**——在一段时间内降价。 | 每晚最多一个促销：优先级最高的生效，绝不叠加。",
          ]),
          notes: [
            dots(T([
              "**Edit price** on a room type — a new price counts for new bookings and added nights. Booked nights never change.",
              "**At the desk tonight** and **On the website tonight** — what a guest would pay today.",
              "**Staff discount limit** — TZS 20,000 per night for reception and managers, Twin 40,000. Staff cannot give more than this.",
              "**Meeting Room** — one price per meeting booking. Promotions and date prices do not apply.",
            ], [
              "房型上的**修改价格**——新价格适用于新预订和加订的晚数。已预订的晚数绝不改变。",
              "**今晚前台价**和**今晚网站价**——客人今天要付的价格。",
              "**员工折扣上限**——前台和经理每晚 TZS 20,000，双床房 40,000。员工给出的折扣不能超过这个数。",
              "**会议室**——每次会议预订一个价格。促销和日期价格不适用。",
            ]), true),
          ],
        }),
        keep(
          h(T("Menu and prices", "菜单与价格")),
          shot(P("a-menuprices"), { w: 84 }),
          dots(T([
            "((1)) **Add item** — a new dish or drink.",
            "**Each item** — its English and Chinese name, the description, the price, whether it is available, and **Edit**.",
            "**One menu for everybody** — the waiters, the Counter, the QR pages and the website all read this menu. Change it once, here.",
            "**Room-service delivery fee** — shown at the top; it is changed in **Hotel** settings.",
          ], [
            "((1)) **添加菜品**——新增一道菜或一款饮品。",
            "**每个菜品**——英文和中文名称、描述、价格、是否有货，以及**编辑**。",
            "**所有人共用一份菜单**——服务员、收银台、二维码页面和网站都读取这份菜单。只需在这里改一次。",
            "**客房送餐服务费**——显示在页面顶部；在**酒店**设置中更改。",
          ]), true),
        ),
        keep(
          h(T("Expense types", "支出类型")),
          beside(P("a-exptypes"), 96,
            p(T(
              "Open [[Expense types]]. This is the list staff pick from when they record money paid out.",
              "打开 [[支出类型]]。这是员工记录付出款项时选用的列表。",
            )),
            dots(T([
              "**New expense type** — adds a type. In each group: **Add** and **Edit**.",
              "Staff can also add a new type while recording — it appears here.",
              "Hidden types stay on old records.",
            ], [
              "**新建支出类型**——新增一个类型。每个分组里有**添加**和**编辑**。",
              "员工在记录时也可以新增类型——它会出现在这里。",
              "隐藏的类型仍保留在旧记录上。",
            ])),
          ),
        ),
        keep(
          h(T("Website", "网站")),
          shot(P("a-website"), { w: 82 }),
          p(T(
            "Open [[Website]]. Change the public website's text, photos and services — in English and in Chinese — without a developer. The tabs are **Text & photos**, **Media library** and **Services**; each field has EN and 中文. **View website** opens the site.",
            "打开 [[网站]]。无需开发人员即可修改公开网站的文字、照片和服务——英文和中文都可以。标签为**文字与照片**、**媒体库**和**服务**；每个栏位都有 EN 和 中文。**查看网站**可打开网站。",
          )),
          warn(T(
            "Changes go live immediately. Read the text once more before you save — guests see it at that moment.",
            "更改会立即生效。保存前请再读一遍——客人马上就能看到。",
          )),
        ),
        GAP,
        keep(
          h(T("Languages", "语言")),
          beside(P("a-languages"), 96,
            dots(T([
              "**English** is the default and always on. **简体中文** is offered to guests with its switch.",
              "English is the fallback: anything without a Chinese translation shows in English — never blank.",
              "Staff each choose their own language in the top bar. Guests choose on the website and the QR pages; a phone set to Chinese starts in Chinese.",
              "**The hotel's content in Chinese** — menu items, categories, room types, amenities, services. **Edit all** opens the list to write or correct the Chinese.",
            ], [
              "**English** 是默认语言，始终开启。**简体中文**通过开关提供给客人。",
              "英文是兜底语言：没有中文翻译的内容显示英文——绝不留空。",
              "员工各自在顶部栏选择自己的语言。客人在网站和二维码页面选择；设置为中文的手机会以中文打开。",
              "**酒店内容的中文版**——菜品、分类、房型、设施、服务。**全部编辑**打开列表，可填写或更正中文。",
            ])),
          ),
        ),
        keep(
          h(T("Spin to Win", "幸运转盘")),
          p(T(
            "Each room has its own Spin to Win card. A guest checked in to the room scans it and spins: up to two treats from the restaurant menu a stay — nothing to pay, never on the bill. When they have finished, all their gifts come to the restaurant as one order. When nobody is checked in, the card gives nothing.",
            "每间房都有自己的幸运转盘卡。入住该房间的客人扫码后转动转盘：每次入住最多可获得两份来自餐厅菜单的礼物——无需付款，也不会记入账单。客人转完后，所有礼物会作为一张订单送到餐厅。没有人入住时，这张卡不会给出任何礼物。",
          )),
          left(P("a-spin-2-a"), 98,
            dots(T([
              "**The tabs** — Given, Set-up, Gifts, Room cards.",
              "**The switch** turns Spin to Win on or off for the whole hotel.",
              "**Spins for each stay** — a stay wins two gifts at most.",
              "**Gift budget** — for standard rooms and for premium rooms.",
              "**Menu items up to this price are gifts**, and **First day** / **Last day** of the promotion.",
              "**Where the gift is enjoyed** — brought to the room, at the restaurant, or both.",
              "**Out of every 100 spins** — how many win a gift, and how many win the bonus spin. Then **Save**.",
            ], [
              "**标签**——已送出、设置、礼物、房间卡。",
              "**开关**为整个酒店开启或关闭幸运转盘。",
              "**每次入住的转盘次数**——每次入住最多赢得两份礼物。",
              "**礼物预算**——标准房和高级房分别设置。",
              "**不超过此价格的菜品可作为礼物**，以及活动的**第一天** / **最后一天**。",
              "**礼物在哪里享用**——送到房间、在餐厅，或两者都可以。",
              "**每 100 次转动**——多少次赢得礼物、多少次赢得额外一次机会。然后点 **保存**。",
            ])),
          ),
          shot(P("a-spin-2-b"), { w: 66, cap: T(
            "**Which rooms get which budget** — Standard: TZS 10,000 of gifts a stay. Premium: TZS 15,000.",
            "**各房间的预算**——标准：每次入住 TZS 10,000 的礼物。高级：TZS 15,000。",
          ) }),
        ),
        keep(
          pair([P("a-spin-3"), { cap: T(
            "**Gifts** — food and soft drinks up to the price you set are gifts by themselves. Drinks from the bar are never gifts.",
            "**礼物**——不超过设定价格的食物和软饮自动成为礼物。酒吧的酒水绝不作为礼物。",
          ) }], [P("a-spin-4"), { cap: T(
            "**Room cards** — one card for each room; it stays in the room for good. Print all, or download all as a PDF. Each card: Guest view, Print, Download, New QR, Switch off.",
            "**房间卡**——每间房一张卡，长期留在房内。可全部打印，或全部下载为 PDF。每张卡：客人视角、打印、下载、新二维码、停用。",
          ) }]),
          rule(T(
            "**Gifts are a cost of the promotion — they are not counted as sales or income.** A gift is never money.",
            "**礼物属于活动成本——不计入销售或收入。**礼物绝不是现金。",
          )),
        ),
        GAP,
        keep(
          h(T("Hotel QR — scan to book", "酒店二维码——扫码预订")),
          shot(P("a-hotelqr-a"), { w: 80 }),
          dots(T([
            "**The three switches** — Booking, Pay online, Pay at hotel. | Guests scan the card, see the rooms, book and pay; each booking lands here and in the reservations, ready for check-in.",
            "**The counters** — Scans today, New bookings, Arriving today, Waiting to pay, Paid online today.",
          ], [
            "**三个开关**——预订、在线支付、到店付款。 | 客人扫码、查看房间、预订并付款；每条预订都会出现在这里和预订列表中，等待办理入住。",
            "**计数器**——今日扫码、新预订、今日抵达、待付款、今日在线付款。",
          ]), true),
        ),
        keep(
          shot(P("a-hotelqr-b"), { w: 80, cap: T(
            "**The QR card** — one card per place; each has its own code and its own numbers. The booking link under the card is hidden in this picture.",
            "**二维码卡片**——每个位置一张卡；各有自己的二维码和自己的数字。卡片下方的预订链接在本图中已隐藏。",
          ) }),
          dots(T([
            "**QR for another place** — a card for another spot where guests can scan.",
            "**Show to guest** — the code, full screen, to scan from your screen.",
            "**Print**, **PNG**, **SVG** — the card for the printer or the designer.",
            "**Rename**, **New code**, **Switch off**, **Archive** — manage a card. | After **New code**, cards printed before stop working: print the card again.",
          ], [
            "**为其他位置生成二维码**——为客人可以扫码的另一个位置制作一张卡。",
            "**展示给客人**——全屏显示二维码，让客人直接扫您的屏幕。",
            "**打印**、**PNG**、**SVG**——交给打印机或设计师。",
            "**重命名**、**新二维码**、**停用**、**归档**——管理卡片。 | 生成**新二维码**后，之前打印的卡片将失效：请重新打印。",
          ]), true),
          tip(T(
            "With **Pay at hotel**, a guest books now and pays later. The room is not held until it is paid — whoever pays first gets it. How guests use each QR code is explained in book 10, **Guests and Website**.",
            "开启**到店付款**后，客人可以先预订、稍后付款。付款之前房间不会保留——谁先付款谁得到房间。客人如何使用各种二维码，见手册 10《客人与网站》。",
          )),
        ),
      ),
    ],

    rules: T([
      ["Start from the report", "The numbers come by themselves: after each shift, every morning, every Monday and on the 1st. Read them before you ask anybody."],
      ["Earned, received, owed", "Three different things. Never add them together, and never treat a zero as a payment."],
      ["Never fix a number by hand", "If a record is wrong, **Edit**, **Reverse** or **Cancel** it with the reason. The history keeps the old value and the new one."],
      ["A report is never rewritten", "**Regenerate** makes a new version and keeps the old one. What was reported on the day stays visible."],
      ["One person, one account", "Nobody shares a password. Switch an account off the day somebody leaves."],
      ["The smallest right that does the job", "Give a right because the work needs it. Guard the rights about money."],
      ["Change the set-up with care", "The hotel day, the prices and the approval limit change the work of everybody from that moment. Booked nights keep their price."],
      ["Withdraw once", "Never send the same withdrawal twice. While it is pending, wait for nTZS to answer."],
      ["Gifts and discounts are costs", "Spin to Win gifts are never income, and never money. Staff discounts stop at the limit you set."],
      ["Keys never on a screen", "The nTZS keys and the passwords of the system stay on the server. If something must be connected, ask Nino."],
    ], [
      ["从报告开始", "数字会自己送到：每个班次结束后、每天早上、每周一和每月 1 日。先看报告，再去问人。"],
      ["所得、已收、欠款", "三件不同的事。绝不相加，也绝不把零当作已付款。"],
      ["绝不手工改数字", "记录有误时，用**编辑**、**冲销**或**取消**并写明原因。修改记录会保留旧值和新值。"],
      ["报告绝不改写", "**重新生成**会产生新版本并保留旧版本。当天报告的内容始终可见。"],
      ["一人一个账户", "任何人都不共用密码。有人离职，当天就停用账户。"],
      ["够用的最小权限", "因为工作需要才授权。与钱有关的权限要把关。"],
      ["谨慎更改设置", "营业日、价格和审批金额一经更改，所有人的工作从那一刻起随之改变。已预订的晚数保留原价。"],
      ["提现只发一次", "同一笔提现绝不发两次。待处理期间，请等待 nTZS 的结果。"],
      ["礼物和折扣都是成本", "幸运转盘的礼物绝不是收入，也绝不是现金。员工折扣以您设定的上限为止。"],
      ["密钥绝不显示在屏幕上", "nTZS 密钥和系统密码保存在服务器上。需要接通某项服务时，请联系 Nino。"],
    ]),

    problems: T([
      ["The daily report did not arrive on WhatsApp", "Open **Daily reports**: the report is there. If the line says **Not sent**, open it and press **Send now**. If it happens again, tell Nino."],
      ["A number in yesterday's report is wrong", "Find the record in **Income** or **Expenses** and correct it with the reason. Then open the report and press **Regenerate** — the old version is kept."],
      ["Money received is lower than income", "Normal: some guests have not paid yet. Look at **Still owed** in the report, and at **Who owes us**."],
      ["The cash in the drawer is not what the system says", "Open **Accounts**, press **Count** on the cash account and type what was counted. The difference must be explained."],
      ["An expense waits and the Manager is away", "Open **Expenses** and **Approve** or **Reject** it yourself."],
      ["A staff member cannot open a page", "Their role does not have the right. Look at **Staff & roles → Role permissions** — and give it only if the job needs it."],
      ["Somebody forgot their password", "Reset it on their line in **Staff & roles** and give them the new one privately."],
      ["A price is wrong on the website", "Rooms: **Room pricing**. Food and drinks: **Menu**. Both change the website at once."],
      ["A customer paid by phone but the order still says not paid", "Open **Online payments** and look at **Waiting** and **Needs a person**. Do not record it as paid before the money is confirmed."],
      ["A shift was left open", "The Manager closes it with the reason, from **Staff shifts**. You can do the same."],
      ["The page is in the wrong language", "Tap **EN** or **中文** on the top bar."],
      ["Something does not work", "Take a picture of the screen and send it to Nino on WhatsApp."],
    ], [
      ["WhatsApp 上没有收到日报", "打开**日报**：报告就在那里。如果该行显示**未发送**，打开它并点**立即发送**。如果再次发生，请告诉 Nino。"],
      ["昨天报告里的某个数字不对", "在**收入**或**支出**里找到那条记录，写明原因并更正。然后打开报告，点**重新生成**——旧版本会保留。"],
      ["已收款项低于收入", "这很正常：有些客人还没付款。查看报告里的**仍欠**，以及**应收款**。"],
      ["抽屉里的现金与系统显示的不一致", "打开**账户**，在现金账户上进行盘点，输入实际清点的金额。差额必须说明原因。"],
      ["有支出待审批，而经理不在", "打开**支出**，自己**批准**或**拒绝**。"],
      ["员工打不开某个页面", "其角色没有这项权限。查看**员工与角色 → 角色权限**——只有工作确实需要时才授予。"],
      ["有人忘记了密码", "在**员工与角色**里该员工的那一行重置密码，并私下把新密码告诉本人。"],
      ["网站上的价格不对", "客房：**房价**。餐饮：**菜单**。两者都会立即更新网站。"],
      ["顾客已用手机付款，但订单仍显示未付", "打开**在线支付**，查看**等待中**和**需人工处理**。在款项确认之前，不要记为已付。"],
      ["有班次没有关闭", "经理在**员工班次**里写明原因后将其关闭。您也可以这样做。"],
      ["页面的语言不对", "点击顶部栏的 **EN** 或 **中文**。"],
      ["有功能无法使用", "拍下屏幕，用 WhatsApp 发给 Nino。"],
    ]),
  };
};

export default make("en");
