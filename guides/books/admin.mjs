import { chapter, tour, task, tip, warn, rule, p, h, dots, table, beside, shot, keep, pair, render } from "../tools/kit.mjs";

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
    cover: { shots: [P("ad2-cover")] },
    lead: T(
      "This book is for the **Boss** (the owner) and the **Managing Director (MD)**. The staff do the work, the Manager runs the day, **Finance** keeps the money and **Purchasing** buys. **You receive the reports, watch the money, decide what only you may decide and set up the system.** Every change is recorded with your name and the time.",
      "本手册写给**老板**和**总经理（MD）**。员工负责执行，经理负责每天的运营，**财务**管理资金，**采购**负责购买。**您接收报告、关注资金、做出只有您才能做的决定，并设置系统。**每一项更改都会连同您的姓名和时间一起记录。",
    ),

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
            ["**Finance**", "Keeps the money: income, expenses, the accounts and the books. Reviews the purchase requests, authorizes prices up to your limit, pays the suppliers and can withdraw from nTZS. Has its own Home."],
            ["**Purchasing** (the role is called **Accountant**)", "Buys: gets the quotations, makes the purchase order, records the deliveries and the supplier's invoice. Never approves and never pays."],
            ["**Managing Director (MD)**", "Everything the Manager does, plus the system itself: staff and access, rooms, menu, tables, prices, payment accounts, settings and the audit history."],
            ["**Owner / Boss**", "Receives the reports, reviews the performance and makes the high-level decisions — for example a large purchase price. Does not run the hotel day to day — and always has full access."],
          ], [
            ["**员工**——前台、服务员、收银台、厨房、司机", "日常工作：预订、入住、点餐、收款、接送。每个人只看到自己的部分。"],
            ["**经理**", "每天负责酒店的运营与监督：关注每个部门，做出日常运营决定，必要时亲自处理。"],
            ["**财务**", "管理资金：收入、支出、账户和账簿。审核采购申请，在您设定的额度内授权价格，向供应商付款，也可以从 nTZS 提现。有自己的首页。"],
            ["**采购**（角色名称是**采购会计**）", "负责购买：取得报价、下采购订单、记录收货和供应商发票。从不审批，也从不付款。"],
            ["**总经理（MD）**", "经理能做的一切，再加上系统本身：员工与权限、房间、菜单、餐桌、价格、收付款账户、设置和审计记录。"],
            ["**老板**", "接收报告、审视经营情况、做出重大决定——例如大额采购的价格。不负责日常运营——并且始终拥有完全权限。"],
          ])),
          tip(T(
            "Checking guests in and out and taking orders is the work of Reception and the restaurant — your pages show that work live. Your own work is to **read, decide and set up**.",
            "办理入住、退房和接单是前台和餐厅的工作——您的页面会实时显示这些工作。您自己的工作是**查看、决定和设置**。",
          )),
        ),
        keep(
          h(T("One system, two languages", "一个系统，两种语言")),
          pair(["ad2-md-home", { w: 84, cap: T("The MD's Home in English.", "总经理的首页，英文。") }],
            ["ad2-md-home-zh", { w: 84, cap: T("The same page in Chinese — the same numbers, the same records.", "同一页面的中文版——数字相同，记录相同。") }]),
          p(T(
            "Names, phone numbers, amounts, references and what people type are never translated. A receptionist can work in English while you read the same booking in Chinese.",
            "姓名、电话号码、金额、编号以及人们输入的内容不会被翻译。前台可以用英文工作，而您用中文查看同一条预订。",
          )),
        ),
        keep(
        h(T("What comes to you", "哪些内容会到您这里")),
        table(T(["What", "From", "Where you see it"], ["内容", "来自", "在哪里看"]), T([
          ["The report of every shift", "Reception and the waiters, when a shift ends", "WhatsApp, and **Staff shifts**."],
          ["The daily business report", "The system, every morning at 07:00", "WhatsApp, and **Daily reports**."],
          ["The weekly and the monthly report", "The system, every Monday and on the 1st", "WhatsApp, and **Weekly & monthly**."],
          ["Everything that waits in the hotel", "Every department", "**Needs your attention** on Home."],
          ["An expense above the limit", "The staff member who recorded it", "**Expenses** — the line says **Waiting approval**. Finance and the Manager can answer it too."],
          ["A purchase price above Finance's limit", "Purchasing proposed it, Finance cannot decide it alone", "**Needs your attention** on Home, and **Procurement** — the tab **With Finance**."],
          ["A withdrawal that is **Not confirmed**", "nTZS, when it gave no clear answer", "**Withdraw funds** — a yellow line names it. Only you can settle it by hand."],
        ], [
          ["每个班次的报告", "前台和服务员，班次结束时", "WhatsApp，以及**员工班次**。"],
          ["每日业务报告", "系统，每天早上 07:00", "WhatsApp，以及**日报**。"],
          ["周报和月报", "系统，每周一和每月 1 日", "WhatsApp，以及**周报与月报**。"],
          ["酒店里所有等待处理的事项", "每个部门", "首页的**需要您处理**。"],
          ["超过限额的支出", "记录该支出的员工", "**支出**——该行显示**待审批**。财务和经理也可以答复。"],
          ["超出财务额度的采购价格", "采购提出的报价，财务无法单独决定", "首页的**需要您处理**，以及**采购**——**待财务处理**标签。"],
          ["状态为**未确认**的提现", "nTZS 没有给出明确答复", "**提现**——有一行黄色提示点名它。只有您能人工结清。"],
        ])),
        ),
        keep(
        h(T("What goes out from you", "哪些内容由您发出")),
        table(T(["What", "Goes to", "Where you do it"], ["内容", "去向", "在哪里操作"]), T([
          ["Room prices and promotions", "Reception and the website", "**Room pricing**."],
          ["The menu and its prices", "The restaurant, the QR pages and the website", "**Menu**."],
          ["Staff accounts and their rights", "Every staff member, Finance and Purchasing too", "**Staff & roles**."],
          ["The rules of the system, and the most Finance may authorize alone", "Every department", "**Control centre** and **Hotel** settings."],
          ["The price of a large purchase", "Purchasing, who then makes the order", "**Procurement** — **Authorize this price**."],
          ["Where an account's books begin", "The hotel's books", "**Accounts** — **Opening balance**."],
          ["Mobile money taken out of nTZS", "A phone, a Lipa number or a bank account", "**Withdraw funds** (Finance can do it too)."],
        ], [
          ["房价与促销", "前台和网站", "**房价**。"],
          ["菜单及其价格", "餐厅、二维码页面和网站", "**菜单**。"],
          ["员工账户及其权限", "每位员工，包括财务和采购", "**员工与角色**。"],
          ["系统的规则，以及财务可单独授权的最高金额", "每个部门", "**控制中心**和**酒店**设置。"],
          ["大额采购的价格", "采购，随后由采购下采购订单", "**采购**——**授权此价格**。"],
          ["账户账簿从哪个金额开始", "酒店的账簿", "**账户**——**期初余额**。"],
          ["从 nTZS 取出的款项", "手机号、Lipa 号码或银行账户", "**提现**（财务也可以操作）。"],
        ])),
        ),
        keep(
          h(T("Home", "首页")),
          shot(P("ad2-home"), { w: 88 }),
          dots(T([
            "**The first line** — how many rooms are occupied tonight, the money received today, and what guests in the hotel have not paid yet.",
            "((1)) **Jump to** — small links under the banner: **Needs your attention**, **Rooms today**, **Tables today**, **Right now**, **The business**, **Where the money is**, **Cash outlook**, **How the hotel is doing**, **Online bookings**, **In detail**. | Home is one long page. Tap a link to go straight to that part. The three about money are shown to those who may see the figures: the Boss, the MD and the Manager.",
            "((2)) **NEEDS YOUR ATTENTION** — everything in the hotel that waits for somebody. | The number beside it counts the lines.",
            "**The tabs** — All, then one for each department that has something waiting: Front desk, Maintenance, Restaurant, Bookings, Rooms, Stores, Money. | Each shows how many lines it holds. Tap one to see only that department.",
            "**One line** — what it is, who or where, and an advice: **Extend or have reception check out**, **Follow the repair**, **Ask the kitchen**, **Reception should call back**, **Give it to someone**. | On the right: how long it has waited. Tap the line to open the place where it is solved.",
          ], [
            "**第一行**——今晚有多少间房入住、今天已收到的款项，以及在住客人尚未支付的金额。",
            "((1)) **快速跳转**——横幅下方的小链接：**需要您处理**、**今日客房**、**今日餐桌**、**当前**、**业务概况**、**资金在哪里**、**资金展望**、**酒店经营状况**、**在线预订**、**详细分析**。 | 首页是一个很长的页面。点一个链接，直接跳到那一部分。其中三个与资金有关的链接，只显示给可以查看这些数字的人：老板、总经理和经理。",
            "((2)) **需要您处理**——酒店里所有正在等人处理的事项。 | 旁边的数字是条目数。",
            "**标签**——全部，以及每个有待办事项的部门：前台、维修中、餐厅、预订、客房、库房、款项。 | 每个标签显示它有多少条。点一个标签，只看该部门。",
            "**每一行**——什么事、谁或在哪里，以及建议：**延长住宿，或让前台办理退房**、**跟进维修**、**询问厨房**、**前台应回电**、**指派给员工**。 | 右侧是已等待的时间。点击该行，进入处理它的页面。",
          ]), true),
          tip(T(
            "Most lines belong to a department. You do not have to solve them yourself — you see that nothing is forgotten, and you ask the Manager when a line waits too long. A line that is yours to decide, like **a purchase price above Finance's limit** (chapter 5), sits under the tab **Money**.",
            "大多数条目属于某个部门。您不必亲自处理——您只需确认没有事情被遗忘；某一行等待太久时，问经理。需要由您决定的条目，例如**超出财务额度的采购价格**（第 5 章），在**款项**标签下。",
          )),
        ),
        tour(T("Every room right now", "所有房间实时状态"), {
          shot: P("ad3-home-rooms"), w: 94,
          intro: T(
            "On Home, under **Rooms today**, the panel **Every room right now** shows one tile for every room — the board Reception works with, here for you to watch. An occupied room says in one coloured word how its guest's bill stands.",
            "在首页的**今日客房**下面，**所有房间实时状态**为每间房显示一个方块——这是前台使用的房态看板，在这里供您查看。已入住的房间用一个带颜色的词说明这位客人账单的情况。",
          ),
          items: T([
            "**Rooms paid** — in the card **Money today**: how many of the occupied rooms have paid, and how many have not. | A room that a group or a company pays is counted apart: it is not called unpaid.",
            "**Paid** (green) — the guest has paid the whole bill.",
            "**Not paid** (red) — nothing has been paid yet.",
            "**Part paid** (yellow) — a part of the bill is paid and a part is not.",
            "**Group pays** (violet) — the group's payer settles this room. | A bill moved onto a company's invoice says **On company invoice**, also in violet. It is never called **Paid**: an invoice is not money received.",
          ], [
            "**已付款房间**——在**今日款项**卡片里：已入住的房间中，有多少间已付清，有多少间还没有。 | 由团体或公司付款的房间单独计算，不算作未付。",
            "**已付款**（绿色）——客人已付清全部账单。",
            "**未付款**（红色）——还没有付过任何款项。",
            "**部分付款**（黄色）——账单付了一部分，还有一部分没付。",
            "**团体付款**（紫色）——由团体的付款人结清这间房。 | 转到公司发票上的账单显示为**已记入公司发票**，同样是紫色。它绝不会被称为**已付款**：发票不等于已收到款项。",
          ]),
          notes: [tip(T(
            "Blue **Overpaid** means the guest paid more than the bill. Grey **Nothing due** means the bill is zero. A room with nobody in it shows no word. **The amount still owed is on the room's card — tap the room.** The **Rooms** page (chapter 6) shows the same words.",
            "蓝色的**多付**表示客人付得比账单还多。灰色的**无应付**表示账单为零。没有客人的房间不显示这些字。**还欠多少，在房间的卡片上——点一下房间即可。**“客房”页面（第 6 章）显示的是同样的字。",
          ))],
        }),
        keep(
          h(T("The menu, group by group", "菜单：逐组说明")),
          left(P("ad2-menu"), 30,
            table(T(["Group", "What is in it", "Chapter"], ["分组", "包含的页面", "章节"]), T([
              ["**Home**", "The hotel now, and what needs attention.", "2"],
              ["**FINANCE**", "Overview, Income, Expenses, Accounts, Companies, Collections, Who owes us, Edit history, General ledger, Withdraw funds, Online payments.", "4"],
              ["**BOOKINGS**", "Stays, Online, Calendar, Hotel QR.", "6, 9"],
              ["**HOTEL SERVICES**", "Rooms, Meetings, Transport, Daily lists, Spin to Win, Guest requests.", "6, 9"],
              ["**RESTAURANT & BAR**", "Live, Tables, Menu, History, Waiters, Reservations.", "6, 9"],
              ["**STORES**", "Assets, Inventory, Procurement, Purchase requests.", "5, 7"],
              ["**PEOPLE**", "Shifts, Activity, Staff shifts, Staff & roles.", "3, 8"],
              ["**INSIGHTS**", "Reports, Daily reports, Weekly & monthly.", "3"],
              ["**SETTINGS**", "Hotel, Website, Messages, Customers, Languages, Room pricing, Expense types, Control centre.", "5, 6, 9"],
            ], [
              ["**首页**", "酒店当前情况，以及需要处理的事项。", "2"],
              ["**财务**", "概览、收入、支出、账户、公司、收款、应收款、修改记录、总账、提现、在线支付。", "4"],
              ["**预订**", "入住记录、在线预订、日历、酒店二维码。", "6、9"],
              ["**酒店服务**", "客房、会议、交通、每日清单、幸运转盘、客人需求。", "6、9"],
              ["**餐厅与酒吧**", "实时订单、餐桌、菜单、历史、服务员、预订。", "6、9"],
              ["**库房**", "资产、库存管理、采购、采购申请。", "5、7"],
              ["**人员**", "班次、员工动态、员工班次、员工与角色。", "3、8"],
              ["**经营分析**", "报告、日报、周报与月报。", "3"],
              ["**设置**", "酒店、网站、消息、顾客、语言、房价、支出类型、控制中心。", "5、6、9"],
            ])),
            tip(T(
              "**Finance's own Home is not in your menu** — you have your own Home, and the analysis of the money is on it (chapter 4). You read the records themselves in the pages of FINANCE.",
              "**财务自己的首页不在您的菜单里**——您有自己的首页，资金分析就在上面（第 4 章）。具体记录，请在“财务”下的各个页面里查看。",
            )),
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
            ["**每日房间报告**", "每天早上 06:30", "04:00 结束的营业日的客房情况，按房型列出，带房号。", "**日报**页面上的 **Daily room reports**（每日房间报告）链接"],
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
          left(P("a-daily-4"), 96,
            p(T(
              "Open [[Daily reports]] under INSIGHTS. One line for every day: the date, who made it, **Revenue**, **Collected**, and **Sent**, **Failed** or **Not sent**. Tap a line to open the report.",
              "打开“经营分析”下的 [[日报]]。每天一行：日期、生成人、**收入**、**已收取**，以及**已发送**、**失败**或**未发送**。点击某一行即可打开报告。",
            )),
            p(T(
              "The link **Daily room reports** at the top opens the room reports. The button [[Make today's now]] makes today's report at once, before the 07:00 run.",
              "页面上方的 [[Daily room reports]]（每日房间报告）链接可打开房间报告。按钮 [[立即生成今天的报告]] 可以在早上 07:00 的自动生成之前，马上生成今天的报告。",
            )),
          ),
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
            "**Send now** — sends the summary by WhatsApp now. | After it was sent, the button says **Send again**; after a failed send, **Retry send**. **Send room report**, beside it, does the same for the room report.",
            "**Regenerate** — makes a new version from the records as they are now, and asks you to say why. | The earlier version is kept. Only the MD and the Boss have this button.",
          ], [
            "**打印**——把报告打印在纸上。",
            "**PDF**——保存为文件，便于留存或发送。",
            "**分享**——把报告转给其他人。",
            "**立即发送**——现在就通过 WhatsApp 发送摘要。 | 发送之后，按钮显示**再次发送**；发送失败后显示**重新发送**。旁边的**发送房间报告**对房间报告做同样的事。",
            "**重新生成**——按现在的记录生成一个新版本，并请您写明原因。 | 之前的版本会保留。只有总经理和老板有这个按钮。",
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
        T("The hotel's money, from the total down to a single payment. Your Home reads it for you — that is the first part of this chapter. The pages of FINANCE hold every record behind the figures, and every record shows who made it and when. Finance keeps the records day to day; you look, check and decide.",
          "酒店的资金，从总数一直到每一笔付款。您的首页会替您分析——这是本章的第一部分。“财务”下的各个页面保存着这些数字背后的每一条记录，每条记录都显示是谁、在什么时候做的。财务每天负责记录；您负责查看、核对和决定。"),
        tour(T("Your Home reads the money: what stands out", "首页替您分析资金：值得关注"), {
          shot: P("ad2-an-1"), w: 100,
          intro: T(
            "Under the **Occupancy** chart on Home, the part **The money, analysed** begins. It reads the dates written under its title — the period chosen with the period buttons under **The business**. When none is chosen (Home opens on Today) it reads **this month**, because one day alone says little. Each part of it is shown only to people who may see the figures: the Boss, the MD and the Manager.",
            "在首页的**入住率**图表下方，是**资金分析**部分。它读取标题下方写着的日期——也就是用**业务概况**下面的期间按钮选定的时间段。没有选择时（首页默认打开“今天”），它读取**本月**，因为只看一天说明不了什么。这一部分只显示给可以查看这些数字的人：老板、总经理和经理。",
          ),
          items: T([
            "**The money, analysed** — the title of the part.",
            "**The dates** — the period it reads. Choose another with the period buttons under **The business**: Today, Yesterday, This week, This month, This year.",
            "**What stands out** — a few plain sentences, the most serious first. | Nothing is guessed: each one is read from the figures below it. A sentence with too little to go on is not written at all.",
            "**One sentence** — the colour of its mark says how serious it is: red is late or short, orange needs watching, blue is for your information, green is good news. | A sentence that has a place to act on it is a link: tap it.",
          ], [
            "**资金分析**——这一部分的标题。",
            "**日期**——它读取的时间段。用**业务概况**下面的期间按钮选择其他时间段：今天、昨天、本周、本月、今年。",
            "**值得关注**——几句简明的话，最严重的排在最前。 | 没有任何猜测：每一句都来自它下面的数字。依据不足的句子根本不会出现。",
            "**其中一句**——标记的颜色说明严重程度：红色表示逾期或不足，橙色表示需要留意，蓝色是供您了解的信息，绿色是好消息。 | 有地方可以处理的句子是一个链接：点一下即可。",
          ]),
        }),
        tour(T("Where the money is", "资金在哪里"), {
          shot: P("ad2-an-2"), w: 100,
          intro: T(
            "The hotel's accounts as its own records add them up: the opening balance, plus the money in, less the money out. It is not read from the bank — check it against the bank statement.",
            "酒店各账户按酒店自己的记录相加的结果：期初余额，加进账，减出账。它不是从银行读取的——请与银行对账单核对。",
          ),
          items: T([
            "**Where the money is** — the title.",
            "**In all accounts** — the ring: the total held, with the biggest accounts as its slices.",
            "**By kind of account** — Cash, Banks, Mobile money (and Card, Other), each with its share. | A red line **Below zero** appears when an account has less than nothing in the books.",
            "**One card for each account** — what it holds, its share, and what moved today.",
            "**Withdraw funds** — on the nTZS card. It takes you to the withdrawal (see the end of this chapter).",
          ], [
            "**资金在哪里**——标题。",
            "**全部账户合计**——圆环：持有的总额，最大的几个账户是其中的扇区。",
            "**按账户类型**——现金、银行、手机支付（以及银行卡、其他），各带占比。 | 当某个账户在账簿里低于零时，会出现红色的**低于零**一行。",
            "**每个账户一张卡片**——持有多少、占比，以及今天的变动。",
            "**提现**——在 nTZS 卡片上。点它进入提现（见本章最后部分）。",
          ]),
        }),
        tour(T("The cash outlook", "资金展望"), {
          shot: P("ad2-an-3"), w: 88,
          intro: T(
            "What is in the accounts, what is owed to the hotel, what the hotel owes — and how long the money lasts. The four numbers at the top **stand side by side and are never added**: what is owed to the hotel is not money yet, and what is owed to suppliers is not yet spent.",
            "账户里有多少钱、谁欠酒店多少、酒店欠别人多少——以及这些钱能支撑多久。上面的四个数字**并列显示，绝不相加**：欠酒店的钱还不是资金，欠供应商的钱也还没有花出去。",
          ),
          items: T([
            "**Cash outlook** — the title.",
            "**In the accounts** — what the books hold now.",
            "**Owed to the hotel** — guests, meetings and companies, and how much of it is late.",
            "**Owed to suppliers** — supplier invoices not paid in full, and how much is past its due date.",
            "**Days the money lasts** — how many days the accounts would cover at the recent pace of spending. | It needs at least 7 days of recorded expenses; if there are fewer, it says so.",
            "**Who owes the hotel — how late** — not late yet, 1–7 days, 8–30 days, more than 30 days. | A guest's bill is due the day they leave, a company's on its due date. The button **Who owes us** opens the list.",
            "**What the hotel owes — when it falls due** — past its due date, within a week, in 8–30 days, later, no date set. | The button **Procurement** opens the invoices.",
            "**Next to pay** — the nearest supplier invoices, with the date and the amount.",
            "**How fast the money goes** — the average spent a day over the last 30 closed days, and the expenses still waiting for approval. | Only recorded costs count: a cost nobody recorded is not in this pace.",
            "**Rooms booked ahead** — the room nights booked for the next 30 nights, and the room income on the books. | Money still to be earned — not money received.",
          ], [
            "**资金展望**——标题。",
            "**账户中**——账簿现在持有的金额。",
            "**欠酒店的款项**——客人、会议和公司欠的钱，以及其中逾期的部分。",
            "**欠供应商**——尚未付清的供应商发票，以及其中已过到期日的部分。",
            "**资金可支撑天数**——按最近的支出速度，账户里的钱够用多少天。 | 至少需要 7 天的支出记录；不足时它会如实说明。",
            "**谁欠酒店——逾期多久**——尚未逾期、逾期 1–7 天、8–30 天、超过 30 天。 | 客人的账单在离店当天到期，公司的账单在发票到期日到期。**应收款**按钮打开明细。",
            "**酒店欠款——何时到期**——已过到期日、一周内到期、8–30 天内到期、更晚、未设到期日。 | **采购**按钮打开发票。",
            "**接下来要付**——最近要付的供应商发票，带日期和金额。",
            "**资金花得有多快**——最近 30 个已结束营业日平均每天的支出，以及仍在等待批准的支出。 | 只有已记录的费用才计入：没有人记录的费用不在这个速度里。",
            "**已预订的未来客房**——未来 30 晚已预订的房晚，以及账上的房费收入。 | 这是还要赚的钱——不是已收到的钱。",
          ]),
        }),
        tour(T("How the hotel is doing", "酒店经营状况"), {
          shot: P("ad2-an-4"), w: 88,
          intro: T(
            "The same period, against the period before, in figures you can read in a minute.",
            "同一个时间段，与上一个时间段对比，一分钟就能读懂。",
          ),
          items: T([
            "**How the hotel is doing** — the title.",
            "**The key figures** — eight figures, each against the period before: **Occupancy**, **Nights sold**, **Average room rate**, **Income per available room**, **Average restaurant order**, **Spent of what was earned**, **Room discounts**, **Cash of the money received**.",
            "**The last six months** — month by month, **Earned**, **Spent** and **Received**, with **Net result** in the table. | The first month starts when the hotel's records began.",
            "**Occupancy** — the share of the guest rooms sold each night, over the period.",
            "**Which days earn most** — the average earned on each day of the week over the last 8 weeks, with the best day marked. | It needs at least 14 closed days.",
          ], [
            "**酒店经营状况**——标题。",
            "**核心数据**——八项数字，每项都与上一期对比：**入住率**、**已售晚数**、**平均房价**、**每间可售房收入**、**餐厅平均订单额**、**支出占营收比例**、**客房折扣**、**收款中的现金占比**。",
            "**最近六个月**——按月显示**营收**、**支出**和**已收到**，表格里还有**净结果**。 | 第一个月从酒店记录开始的那天算起。",
            "**入住率**——这段时间内每晚客房的出租比例。",
            "**哪几天赚得最多**——最近 8 周里每周各天的平均营收，最好的一天会被标出。 | 至少需要 14 个已结束的营业日。",
          ]),
        }),
        tour(T("Income and expenses against the period before", "收入与支出：与上一期对比"), {
          shot: P("ad2-an-4b"), w: 100,
          items: T([
            "**Income against the period before** — what each part of the business earned (Rooms, Restaurant, Bar, Meeting room…): this period, before, and the change.",
            "**Expenses against the period before** — what each kind of cost took: this period, before, the change, and its share of all spending. | The button **Expenses** opens the list.",
          ], [
            "**收入与上一期对比**——业务各部分（客房、餐厅、酒吧、会议室……）赚了多少：本期、上一期，以及变化。",
            "**支出与上一期对比**——每一类费用花了多少：本期、上一期、变化，以及占全部支出的比例。 | **支出**按钮打开明细。",
          ]),
          notes: [rule(T(
            "A comparison is made only with records. A period that begins before the hotel's records began is never used as a base, and a day that has not ended is not compared — so you never read “up 50%” where there was nothing to compare.",
            "对比只用记录来做。早于酒店记录开始之前的时间段，永远不会被当作比较的基准；还没有结束的一天也不做对比——所以您不会在没有可比数据的地方看到“上涨 50%”。",
          ))],
        }),
        keep(
          h(T("How to use it to decide", "怎样用它来做决定")),
          dots(T([
            "**Start with What stands out.** It takes one minute. Open the page a line points to before you ask anybody.",
            "**Before you authorize a large purchase or withdraw money**, look at **Days the money lasts** and **What the hotel owes — when it falls due**: is there money, and what else is about to be paid?",
            "**Before you ask guests or companies to pay**, look at **Who owes the hotel — how late**. Late is not lost: open **Who owes us** to see who and how much.",
            "**To judge a month**, read **How the hotel is doing**: is occupancy up? Are the expenses growing faster than the earnings (**Spent of what was earned**)? Which days earn most — plan the staff and the offers for them.",
            "**Never add the numbers.** In the accounts, owed to the hotel and owed to suppliers stand side by side on purpose.",
          ], [
            "**先看“值得关注”。**只需一分钟。先打开某一行指向的页面，再去问人。",
            "**在授权大额采购或提现之前**，看**资金可支撑天数**和**酒店欠款——何时到期**：钱够不够，还有什么即将要付？",
            "**在催客人或公司付款之前**，看**谁欠酒店——逾期多久**。逾期不等于收不回：打开**应收款**查看是谁、多少。",
            "**评估一个月**，读**酒店经营状况**：入住率是否上升？支出的增长是否比营收更快（**支出占营收比例**）？哪几天赚得最多——为这些天安排人手和优惠。",
            "**绝不把这些数字相加。**账户里的钱、欠酒店的钱、欠供应商的钱是特意并列放在一起的。",
          ])),
        ),
        keep(
          h(T("Overview", "概览")),
          shot(P("a-fin-a"), { w: 72 }),
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
          shot(P("a-fin-b"), { w: 62, cap: T(
            "**Day by day** — earned, spent and received on each day of the period. **Where income comes from** — rooms, restaurant, bar, meeting room and the rest.",
            "**按日**——这段时间内每天的营收、支出和到账。**收入来源**——客房、餐厅、酒吧、会议室及其他。",
          ) }),
        ),
        keep(
          h(T("The pages of FINANCE", "“财务”下的页面")),
          table(T(["Page", "What it is for"], ["页面", "用途"]), T([
            ["**Overview**", "The money of a period on one page: earned, spent, what came in, what is owed."],
            ["**Income**", "Every payment the hotel received. Record, edit, reverse."],
            ["**Expenses**", "Every expense. Record, approve, reject, edit, cancel. A payment to a supplier appears here once, when Finance pays."],
            ["**Accounts**", "Where the money is: cash, mobile money, the banks. Money movements, cash counts and each account's **Opening balance**."],
            ["**Companies**", "Companies that stay on credit: what they owe, their limit, their invoices."],
            ["**Collections**", "Who collected what, how it was paid, and into which account."],
            ["**Who owes us**", "Guests, meetings and company invoices that are not paid yet."],
            ["**Edit history**", "Every change to a money record: who, when, old value and new value."],
            ["**General ledger**", "Every movement in and out, line by line. **Export CSV** saves it."],
            ["**Withdraw funds**", "Takes money out of nTZS — to a phone, a Lipa number or a bank account. Finance, the MD and the Boss can use it."],
            ["**Online payments**", "Payments customers make from their phone, and where that is allowed."],
          ], [
            ["**概览**", "一个页面看一段时间的资金：营收、支出、已到账、欠款。"],
            ["**收入**", "酒店收到的每一笔付款。记录、编辑、冲销。"],
            ["**支出**", "每一笔支出。记录、批准、拒绝、编辑、取消。向供应商的付款只在财务付款时出现一次。"],
            ["**账户**", "钱在哪里：现金、手机支付、银行。资金变动、现金盘点，以及每个账户的**期初余额**。"],
            ["**公司**", "挂账入住的公司：欠款、信用额度、发票。"],
            ["**收款**", "谁收了什么、怎么付的、存入了哪个账户。"],
            ["**应收款**", "尚未付款的客人、会议和公司发票。"],
            ["**修改记录**", "资金记录的每一次更改：谁、何时、旧值和新值。"],
            ["**总账**", "每一笔进账和出账，逐行列出。**导出 CSV** 可保存。"],
            ["**提现**", "把 nTZS 里的钱取出，汇到手机号、Lipa 号码或银行账户。财务、总经理和老板都可以使用。"],
            ["**在线支付**", "顾客用手机完成的付款，以及在哪些地方允许这样付款。"],
          ])),
        ),
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
            "Open [[Expenses]]. An expense at or above the **Expense approval threshold** (chapter 9) is not final when staff record it: it waits as **Waiting approval**.",
            "打开 [[支出]]。达到或超过**支出审批金额**（第 9 章）的支出，在员工记录后并不立即生效：它会显示为**待审批**。",
          ),
          items: T([
            "**Record expense** — write an expense yourself: what, how much, the type, and the account that paid.",
            "**Approve** — one press. The expense counts, with your name. | Finance and the Manager can do this too.",
            "**Reject** — the system asks you to tell the staff member why.",
          ], [
            "**记录支出**——自己录入一笔支出：内容、金额、类型和付款账户。",
            "**批准**——点一下即可。这笔支出计入，并写上您的姓名。 | 财务和经理也可以批准。",
            "**拒绝**——系统会请您告诉该员工原因。",
          ]),
          notes: [p(T(
            "**Edit** corrects a record — you must say what was wrong with it. **Cancel** takes it out: it stays on the register, struck through and not counted, with your name and the reason. The tabs **Monthly bills** and **Summary by type** show the regular bills and the totals for each type.",
            "**编辑**用于更正记录——必须说明哪里错了。**取消**把它移除：它仍留在登记册上，划线且不计入，并写有您的姓名和原因。**每月账单**和**按类型汇总**两个标签显示固定账单和各类型的合计。",
          ))
            , tip(T(
              "When Finance pays a supplier, **one** expense appears here by itself — “Supplier payment”, with the invoice, the order and the request numbers. Do not record the same bill again. The buttons **Edit** and **Cancel** on that line are refused: it changes only from the purchase.",
              "财务向供应商付款时，这里会自动出现**一笔**支出——“Supplier payment”，带发票、订单和申请编号。不要再把同一张账单记一遍。这一行上的**编辑**和**取消**会被系统拒绝：它只能从采购那边更改。",
            ))],
        }),
        keep(
          h(T("Accounts", "账户")),
          shot(P("a-accounts-a"), { w: 64 }),
          dots(T([
            "**IN THE BOOKS** — what the hotel's records add up to. | Check it against the bank statement: it is not read from the bank.",
            "**The cards under it** — one for each account: cash, the mobile-money tills, the banks, the card terminal, petty cash and nTZS.",
            "**Add account** — a new place where the hotel keeps money.",
            "**Money movement** — a transfer between two accounts (cash taken to the bank), the owner's money, other income, or a correction. | Each movement gets its own number, and **Reverse** undoes it with a record.",
            "**Cash counts** — open the cash account (or petty cash) and press **Count**, then type what was counted. | The system shows counted against expected. A difference must be explained and accepted.",
          ], [
            "**账面合计**——酒店记录的合计。 | 请与银行对账单核对：数据并非从银行读取。",
            "**下面的卡片**——每个账户一张：现金、手机支付收款账户、银行、刷卡机、备用金和 nTZS。",
            "**添加账户**——酒店存放资金的一个新地方。",
            "**资金变动**——两个账户之间的转账（把现金存入银行）、老板的资金、其他收入或更正。 | 每笔变动都有自己的编号，并且可以撤销，撤销本身也会留下记录。",
            "**现金盘点**——打开现金账户（或备用金账户），点**盘点**，再输入实际清点的金额。 | 系统会把清点数与应有数对比。差额必须说明原因并被认可。",
          ])),
        ),
        tour(T("An account's opening balance", "账户的期初余额"), {
          shot: P("ad2-ob-page"), side: 78,
          intro: T(
            "Open [[Accounts]] and press an account — here the nTZS account. Only the Boss and the MD have the button [[Opening balance]]. It is **the money the account already held when the hotel's records began**. It is **not income and not a payment**: nothing is added to the sales or the payments. It only sets where the books begin — **the books' balance of an account is its opening balance, plus the money in, less the money out.**",
            "打开[[账户]]，点进一个账户——这里是 nTZS 账户。只有老板和总经理有[[期初余额]]这个按钮。它是**酒店开始记录时，这个账户里已经有的钱**。它**不是收入，也不是付款**：不会增加销售或付款。它只决定账簿从哪里开始——**账户在账簿里的余额 = 期初余额 + 进账 − 出账。**",
          ),
          items: T([
            "**In the books** — the balance the records add up to. Under it: the money in, the money out and **opening**.",
            "[[Opening balance]] — opens the window below.",
            "[[Withdraw funds]] — on the nTZS account only: the same window as on the Withdraw funds page.",
          ], [
            "**账面金额**——记录相加得到的金额。下方是流入、流出和**期初**。",
            "[[期初余额]]——打开下面的窗口。",
            "[[提现]]——只在 nTZS 账户上有：与“提现”页面是同一个窗口。",
          ]),
        }),
        left(P("ad2-ob-form"), 54,
          p(T("The window, here on Petty cash and **not saved**:", "这个窗口，这里是备用金账户，并**没有保存**：")),
          dots(T([
            "((1)) **Opening balance (TZS)** — whole shillings, 0 or more.",
            "((2)) **What is it?** — say what the money is: at least 5 letters.",
            "((3)) [[Save the opening balance]].",
          ], [
            "((1)) **期初余额（TZS）**——整数先令，0 或更多。",
            "((2)) **是什么物品？**——说明这笔钱是什么：至少 5 个字。",
            "((3)) [[保存期初余额]]。",
          ])),
          warn(T(
            "**Set it once, from something real** — the balance nTZS shows, the bank statement, the cash counted in the box. **Withdraw funds** starts from the balance the books show: with an opening balance of 0 and nothing received, **Available to withdraw** shows TZS 0 and the window warns you. A change is recorded with your name and your reason.",
            "**只设一次，并且依据真实的东西**——nTZS 显示的余额、银行对账单、盒子里清点的现金。**提现**从账簿显示的余额开始：期初余额为 0 又没有进账时，**可提现金额**显示 TZS 0，窗口会提醒您。每一次修改都会记录您的姓名和原因。",
          )),
        ),
        keep(
          h(T("Companies", "公司")),
          beside(P("a-companies"), 84,
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
          p(T(
            "The mobile money that customers pay online is kept in the hotel's **nTZS balance**. [[Withdraw funds]] takes it out — to a phone number, a **Lipa number** or a bank account. **Finance, the MD and the Boss** can do it; nobody else has the page. Money leaves nTZS **only here** — never in nTZS's own screen.",
            "顾客在线支付的手机支付款项，保存在酒店的 **nTZS 余额**里。[[提现]]把它取出——汇到手机号、**Lipa 号码**或银行账户。**财务、总经理和老板**可以操作；其他人没有这个页面。款项**只能在这里**离开 nTZS——不要在 nTZS 自己的页面上操作。",
          )),
        ),
        tour(T("The Withdraw funds page", "“提现”页面"), {
          shot: P("ad2-w-page"), side: 104,
          items: T([
            "[[Withdraw funds]] — starts a withdrawal. | It is dimmed while one withdrawal has no clear answer from nTZS, so the same money is never sent twice.",
            "**Available to withdraw** — what the hotel's own books show for the nTZS account, less what is already on its way out. | **Open the account** goes to the account's page. It is the books' figure, not nTZS's: nTZS checks its real balance when it gives the price.",
            "**On its way** — what was sent to nTZS and is not finished yet.",
            "**The four tiles** — **Withdrawn**, **nTZS fees**, **Pending**, **Failed or refused**, for the period chosen above them.",
            "**The number of a withdrawal** — press it to open all its details and its history.",
            "**The state**, in words — never only a colour.",
          ], [
            "[[提现]]——开始一笔提现。 | 当有一笔提现没有得到 nTZS 的明确答复时，它会变灰，这样同一笔钱绝不会被发两次。",
            "**可提现金额**——酒店自己的账簿里 nTZS 账户的余额，减去已经在途的部分。 | **打开该账户**进入该账户的页面。这是账簿的数字，不是 nTZS 的数字：nTZS 在给出报价时才核对它真实的余额。",
            "**配送中**——已发送给 nTZS、尚未完成的部分。",
            "**四个方块**——**已提现**、**nTZS 手续费**、**待处理**、**失败或被拒绝**，对应上方选定的时间段。",
            "**提现编号**——点它可以打开全部详情和记录。",
            "**状态**用文字表示——绝不只靠颜色。",
          ]),
        }),
        keep(
          h(T("Three ways to send", "三种汇款方式")),
          table(T(["Way", "The least", "The most", "The name you will see"], ["方式", "最低金额", "最高金额", "您会看到的姓名"]), T([
            ["**Phone number**", "TZS 5,000", "What nTZS allows — it says so with the price.", "The name the phone network holds for that number."],
            ["**Lipa number**", "TZS 500", "Less than TZS 1,000,000, with nTZS's fee counted in.", "The name of the shop (the till)."],
            ["**Bank account** (CRDB, NMB or NBC)", "TZS 5,000", "What nTZS allows for a bank.", "The name on the bank account."],
          ], [
            ["**电话号码**", "TZS 5,000", "nTZS 允许的上限——报价时它会说明。", "手机网络为该号码登记的姓名。"],
            ["**Lipa 号码**", "TZS 500", "低于 TZS 1,000,000（含 nTZS 手续费）。", "商店（收款台）的名称。"],
            ["**银行账户**（CRDB、NMB 或 NBC）", "TZS 5,000", "nTZS 对银行转账允许的上限。", "银行账户上的户名。"],
          ])),
          p(T(
            "nTZS names only these three banks. A large withdrawal may need nTZS's own approval: the window then says so and the withdrawal waits (**Waiting for nTZS**).",
            "nTZS 只列出这三家银行。大额提现可能需要 nTZS 自己批准：窗口会说明，提现状态为**等待 nTZS**。",
          )),
        ),
        tour(T("Step 1 — See the price", "第 1 步——查看报价"), {
          shot: P("ad2-w-form"), side: 74,
          intro: T(
            "Press [[Withdraw funds]] — on this page or on the nTZS account's page. A window opens. **Nothing is sent yet.** Here the way chosen is a Lipa number.",
            "点[[提现]]——在这个页面或 nTZS 账户的页面都可以。会打开一个窗口。**此时还没有汇出任何款项。**这里选择的方式是 Lipa 号码。",
          ),
          items: T([
            "**Amount the recipient gets (TZS)** — what the person must receive. | nTZS adds its fee on top. [[Use all of it]] fills in everything that is available.",
            "**Send to** — [[Another phone number]], [[Lipa number]] or [[Bank account]]. | A place you paid before is listed above them: press it instead of typing the number again.",
            "**The number** — type it slowly, digit by digit. | For a bank: choose the bank, then type the account number.",
            "**In the hotel's books** — where the money goes: [[The owner takes it out]], or [[It goes to …]] one of the hotel's accounts. | You must choose.",
            "[[!See the price]] — nTZS gives its price and the registered name of whoever is paid.",
          ], [
            "**收款人到账金额（TZS）**——对方必须收到的金额。 | nTZS 会另外收取手续费。[[全部提现]]会填入全部可提现的金额。",
            "**汇往**——[[其他手机号]]、[[Lipa 号码]]或[[银行账户]]。 | 以前汇过的地方会列在它们上方：直接点它，不必再输入号码。",
            "**号码**——慢慢输入，逐位核对。 | 银行：先选银行，再输入账号。",
            "**酒店账簿中**——这笔钱的去向：[[由老板取走]]，或[[转入…]]酒店的某个账户。 | 必须选择一项。",
            "[[!查看报价]]——nTZS 给出报价，以及收款人的登记姓名。",
          ]),
          notes: [rule(T(
            "**A withdrawal is not income and not an expense.** It only moves money. Only nTZS's fee is a cost.",
            "**提现既不是收入，也不是支出。**它只是资金转移。只有 nTZS 的手续费是费用。",
          ))],
        }),
        tour(T("Step 2 — Check before you send", "第 2 步——发送前请核对"), {
          shot: P("ad2-w-check"), side: 78,
          intro: T(
            "After [[See the price]] the window changes. Read all of it once more — after [[Send]] nothing can be taken back.",
            "点[[查看报价]]之后窗口会变化。请把它再看一遍——点[[汇出]]之后无法撤回。",
          ),
          items: T([
            "**Paying** — the **registered name**, big, with a green check when the network confirmed it; under it the kind (Lipa number, phone number or the bank) and the number. | **This is the most important line. Is it the person or the shop you mean?**",
            "**The recipient gets** — the amount.",
            "**Three lines** — **nTZS's fee** (nTZS's price now, added on top; it confirms the real fee when it pays), **Leaves the nTZS balance** (the amount plus the fee, and about how much is left) and **In the hotel's books** (what you chose).",
            "**This price holds for** — a live count-down. | When it ends, sending closes: press [[Back]] and ask for the price again.",
            "**The tick box** — **I checked the name, the number and the amount.** | [[Send]] works only when it is ticked.",
            "[[!Send]] — sends it, once. | [[Back]] drops the price; nothing was sent.",
          ], [
            "**付款给**——**登记的姓名**，字体很大，网络已确认时旁边有绿色对勾；下方是类型（Lipa 号码、电话号码或银行）和号码。 | **这是最重要的一行。它是您要付的那个人或那家商店吗？**",
            "**收款人到账**——金额。",
            "**三行**——**nTZS 的手续费**（nTZS 目前的报价，另外加收；实际手续费在付款时由它确认）、**从 nTZS 余额扣除**（金额加手续费，以及这笔之后大约还剩多少）和**酒店账簿中**（您选择的去向）。",
            "**此价格还有效**——实时倒计时。 | 倒计时结束后不能再发送：点[[返回]]，重新获取报价。",
            "**勾选框**——**我已核对姓名、号码和金额。** | 勾选后[[汇出]]才能点。",
            "[[!汇出]]——发出，只发一次。 | [[返回]]会放弃这个报价；没有汇出任何款项。",
          ]),
          notes: [warn(T(
            "If the name is missing, a yellow line says **nTZS could not confirm the name on this number**. Check the number yourself, digit by digit, with the person who asked: a wrong digit sends the money to a stranger, and it cannot be called back.",
            "如果没有姓名，会出现一行黄色提示：**nTZS 无法确认这个号码的户名**。请与提出申请的人一起，亲自逐位核对号码：错一位数字，钱就会汇给陌生人，而且追不回来。",
          ))],
        }),
        tour(T("Step 3 — Send it: on its way", "第 3 步——汇出：配送中"), {
          shot: P("ad2-w-sent"), side: 70,
          intro: T(
            "Tick the box and press [[Send]] once. The window waits for nTZS's answer, up to half a minute — keep the page open. Pressing twice is still one withdrawal.",
            "勾选后点一次[[汇出]]。窗口会等待 nTZS 的答复，最长半分钟——请不要关闭页面。点两次也只算一笔提现。**图中的窗口是英文界面**（On its way、Paying、Amount、Close）；在您的中文屏幕上，同样的位置写着**配送中**、**付款给**、**金额**、**关闭**。",
          ),
          items: T([
            "**On its way** — the withdrawal now has a number. nTZS accepted it and is paying it out. | **This is not “done”.** You can close the window: the page follows it by itself.",
            "**Paying** — who is paid, and the amount.",
            "[[Close]] — the window closes; the withdrawal goes on. | The page follows it by itself. To ask nTZS at once, open the withdrawal (press its number) and press [[Ask nTZS now]].",
          ], [
            "**配送中**——这笔提现现在有了编号。nTZS 已接受并正在付出。 | **这还不算“完成”。**您可以关闭窗口：页面会自动跟进。",
            "**付款给**——付给谁，以及金额。",
            "[[关闭]]——窗口关闭，提现继续进行。 | 页面会自动跟进。想马上问 nTZS，可以打开这笔提现（点它的编号），再点[[立即向 nTZS 查询]]。",
          ]),
        }),
        tour(T("Step 4 — Completed", "第 4 步——已完成"), {
          shot: P("ad2-w-done"), side: 70,
          intro: T(
            "A few minutes later (a phone or Lipa payout takes minutes, a bank's can take up to a working day) press the number of the withdrawal on the page. The window says **Completed**.",
            "几分钟后（手机或 Lipa 付款需要几分钟，银行的可能最长一个工作日），在页面上点这笔提现的编号。窗口显示**已完成**。",
          ),
          items: T([
            "**Completed** — nTZS confirmed that the money arrived.",
            "**Arrived** — the amount nTZS confirms. | Above it: the fee nTZS really charged, and **Left the nTZS balance**.",
            "**In the hotel's books** — now **Recorded**. | Before this, the books had nothing.",
            "**What happened** — every step, with the time and the name of the person. | The last one says nTZS confirmed the money arrived. [[Ask nTZS now]] asks nTZS at once; nTZS also tells the hotel by itself.",
          ], [
            "**已完成**——nTZS 确认款项已到账。",
            "**已到账**——nTZS 确认的金额。 | 在它上方：nTZS 实际收取的手续费，以及**已从 nTZS 余额扣除**。",
            "**酒店账簿中**——现在是**已记录**。 | 在此之前，账簿里什么也没有。",
            "**发生了什么**——每一步，带时间和操作人的姓名。 | 最后一条写着 nTZS 确认款项已到账。[[立即向 nTZS 查询]]会马上询问 nTZS；nTZS 也会自己通知酒店。",
          ]),
          notes: [
            rule(T(
              "**Only nTZS's own word makes a withdrawal Completed.** The books are written at that moment, not before — **once**: the money moved out of the nTZS account (to the account you chose, or as the owner's withdrawal), and nTZS's fee as a bank-fee expense. Nothing is income, and the money that left is not an expense.",
              "**只有 nTZS 自己的答复才能让提现变成“已完成”。**账簿在那一刻才记账，不会更早——而且**只记一次**：款项从 nTZS 账户转出（转入您选择的账户，或作为老板的提款），nTZS 的手续费记为银行手续费支出。没有任何一笔是收入，转出的钱也不是支出。",
            )),
          ],
        }),
        keep(
          h(T("When a withdrawal is not finished", "提现还没有完成时")),
          table(T(["The state", "What it means", "What you do"], ["状态", "含义", "您怎么做"]), T([
            ["**On its way**", "nTZS accepted it and is paying it out.", "Nothing. The page follows it. [[Ask nTZS now]] if you are in a hurry."],
            ["**Waiting for nTZS** · **nTZS is checking it**", "nTZS approves large withdrawals itself, or is checking one. It can take up to one working day.", "Wait. nTZS tells the hotel when it is settled."],
            ["**Failed — money returned**", "nTZS could not pay it out. The money went back to the nTZS balance; the books are corrected, and both lines stay visible.", "Open it: nTZS's own words are there. Check the number, then ask for a new price if it is still needed."],
            ["**Refused — nothing sent**", "nTZS refused the request. No money moved.", "Change what the window says (the amount, the number) and ask again."],
            ["**Not confirmed**", "nTZS gave no clear answer. **Nobody knows whether the money was sent.**", "See below."],
          ], [
            ["**配送中**", "nTZS 已接受并正在付出。", "不用做什么。页面会自动跟进。着急时点[[立即向 nTZS 查询]]。"],
            ["**等待 nTZS** · **nTZS 正在核查**", "nTZS 自己审批大额提现，或正在核查一笔。最长可能需要一个工作日。", "等待。结清后 nTZS 会通知酒店。"],
            ["**失败——款项已退回**", "nTZS 无法付出这笔款项。钱已退回 nTZS 余额；账簿已更正，两行记录都会保留。", "打开它：nTZS 的原话在里面。检查号码，如果仍需要，重新获取报价。"],
            ["**被拒绝——未汇出**", "nTZS 拒绝了这个请求。没有款项变动。", "按窗口的说明修改（金额、号码），再次申请。"],
            ["**未确认**", "nTZS 没有给出明确答复。**没有人知道钱是否已汇出。**", "见下文。"],
          ])),
          warn(T(
            "**Not confirmed — nothing else can be sent.** The withdrawal may or may not have left. While it is open **no other withdrawal can be sent**, so the same money is never sent twice: the button is dimmed and a yellow line names it. Press [[Open it]], then [[Ask nTZS now]]. If nTZS still cannot say, **only you — the Boss or the MD — can settle it by hand**, after a quarter of an hour once nTZS was asked again (a day for one that nTZS keeps unfinished). Look at nTZS itself, then press [[Settle by hand]], choose **The money arrived** (and type nTZS's own reference) or **It was never sent**, and write how you know. It is recorded under your name and cannot be undone here. Finance cannot do this. **Never send the same money again to “fix” it.**",
            "**未确认——其他提现都不能发。**这笔提现可能已汇出，也可能没有。只要它还没结清，**就不能发起其他提现**，这样同一笔钱绝不会被发两次：按钮变灰，一行黄色提示点名它。点[[打开查看]]，再点[[立即向 nTZS 查询]]。如果 nTZS 仍然无法答复，**只有您——老板或总经理——可以人工结清**：在再次向 nTZS 查询之后过一刻钟（nTZS 一直没完成的，要过一天）。先在 nTZS 那边亲自核实，再点[[人工结清]]，选择**款项已到账**（并输入 nTZS 自己的参考号）或**从未汇出**，并写明您怎么知道的。它会记在您的名下，在这里无法撤销。财务不能这样做。**绝不要为了“补救”而再汇同一笔钱。**",
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

      // ───────────────────────── 5 (new)
      chapter(T("Finance and Purchasing", "财务与采购"),
        T("Finance keeps the money and Purchasing buys, so that you do not have to. You do not do their work. You give them their rights and their limit, you decide what is above the limit, and you can see everything they do.",
          "财务管理酒店的资金，采购购买酒店需要的东西，这样您就不必亲自去做。您不做他们的工作：您给他们权限和额度，决定超出额度的事项，并且可以看到他们做的一切。"),
        keep(
          h(T("Who does what", "谁负责什么")),
          table(T(["Who", "What they do", "What they never do"], ["谁", "做什么", "从不做什么"]), T([
            ["**Finance**", "Keeps the money: income, expenses, the accounts and the books. Reviews every purchase request. Authorizes a price up to your limit. Verifies and pays the supplier's invoice. Withdraws from nTZS. Can also do Purchasing's steps. Also keeps room prices, promotions and menu prices in order.", "Run the front desk, the kitchen or the set-up: no check-in or check-out, no orders, no staff accounts, no hotel settings. It cannot set a staff discount limit, settle a withdrawal by hand or make a report again."],
            ["**Purchasing** (the role is called **Accountant**)", "Gets the supplier quotations and proposes one, makes the purchase order, records every delivery and the supplier's invoice. Its Home is **Procurement**.", "Approve, authorize or pay anything. It never touches an account or an expense."],
            ["**You — the Boss and the MD**", "Everything. And what is yours alone: the Finance limit, a price above it, an account's opening balance, settling a withdrawal by hand, making a report again, staff accounts and the set-up.", "—"],
          ], [
            ["**财务**", "管理资金：收入、支出、账户和账簿。审核每一份采购申请。在您的额度内授权价格。核对并支付供应商发票。从 nTZS 提现。也可以做采购的各个步骤。还负责维护房价、促销和菜单价格。", "管理前台、厨房或系统设置：不办理入住退房，不点单，不管理员工账户，不改酒店设置。它不能设置员工折扣上限、不能人工结清提现、不能重新生成报告。"],
            ["**采购**（角色名称是**采购会计**）", "取得供应商报价并提出一个、下采购订单、记录每次收货和供应商发票。它的首页是**采购**。", "批准、授权或支付任何东西。它从不动账户，也不动支出。"],
            ["**您——老板和总经理**", "一切。而且有只属于您的：财务额度、超出额度的价格、账户的期初余额、人工结清提现、重新生成报告、员工账户和系统设置。", "—"],
          ])),
        ),
        keep(
          h(T("What Finance does for you, and what still needs you", "财务替您做什么，以及什么仍然需要您")),
          table(T(["Finance does", "Needs you"], ["财务做", "仍然需要您"]), T([
            ["Reviews each purchase request: approves it with a budget, sends it back with a note, or rejects it.", "—"],
            ["Authorizes a quotation that is above the budget, **up to the Finance limit**.", "A price **above the Finance limit** — you authorize it, or send it back."],
            ["Verifies the supplier's invoice and pays it. **One expense** appears only when the supplier is really paid.", "—"],
            ["Records the payments and expenses, and answers an expense that waits for approval.", "You can answer it too, and you see every record in **Income** and **Expenses**."],
            ["Keeps the accounts and withdraws from nTZS.", "An account's **opening balance**, and **settling by hand** a withdrawal nobody could confirm — only you."],
            ["Reads the reports and the money of the hotel.", "**Making a report again**, and the **staff discount limit** — only you."],
            ["Works inside its limit.", "**The limit itself**: how much Finance may authorize alone — only you."],
          ], [
            ["审核每一份采购申请：批准并设定预算、附上说明退回，或拒绝。", "—"],
            ["授权高于预算的报价，**最高到财务额度**。", "**超出财务额度**的价格——由您授权，或退回。"],
            ["核对供应商发票并付款。只有真正付款给供应商时，才会出现**一笔支出**。", "—"],
            ["记录收付款和支出，并答复等待审批的支出。", "您也可以答复，并且可以在**收入**和**支出**里看到每一条记录。"],
            ["管理账户，并从 nTZS 提现。", "账户的**期初余额**，以及**人工结清**没有人能确认的提现——只有您。"],
            ["阅读报告和酒店的资金情况。", "**重新生成报告**，以及**员工折扣上限**——只有您。"],
            ["在额度内工作。", "**额度本身**：财务可以单独授权多少——只有您。"],
          ])),
        ),
        tour(T("Finance's own Home", "财务自己的首页"), {
          shot: P("ad2-fin-home"), side: 62,
          intro: T(
            "Finance has a Home of its own, the **Finance dashboard**. It is **not in your menu**: you have your own Home, with the same analysis of the money (chapter 4). This is what Finance sees when it signs in.",
            "财务有自己的首页，叫**财务仪表盘**。它**不在您的菜单里**：您有自己的首页，上面有同样的资金分析（第 4 章）。这是财务登录后看到的内容。",
          ),
          items: T([
            "**The quick links** — **Purchases**, **Expenses**, **Income**, **Who owes us**, **General ledger**, **Reports**. | A number beside one says how many lines wait there.",
            "**Jump to** — the parts of one long page: **The money**, **What stands out**, **Where the money is**, **Money in and out**, **Cash outlook**, **Purchases and more**, **How the hotel is doing**, **Bookings**, **The latest**, **In detail**. | There are no tabs: everything is on the page.",
            "**Needs your attention** — what waits for Finance: purchases to authorize, supplier invoices to verify or to pay, invoices past their due date or disputed, expenses waiting, company invoices overdue, guests who left owing, online payments that need a person, a withdrawal that is not confirmed, a daily report that failed, an account below zero. | Finance sees only the lines it may open.",
          ], [
            "**快捷入口**——**采购**、**支出**、**收入**、**应收款**、**总账**、**报告**。 | 旁边的数字表示那里有多少条待处理。",
            "**快速跳转**——一个长页面的各个部分：**资金**、**值得关注**、**资金在哪里**、**资金进出**、**资金展望**、**采购及其他**、**酒店经营状况**、**预订**、**最新记录**、**详细分析**。 | 没有标签页：所有内容都在这一页上。",
            "**需要您处理**——等待财务处理的事项：待授权的采购、待核对或待支付的供应商发票、已过到期日或有争议的发票、待审批的支出、逾期的公司发票、离店时仍欠款的客人、需要人工处理的在线支付、未确认的提现、失败的日报、低于零的账户。 | 财务只看到它有权打开的条目。",
          ]),
          notes: [tip(T(
            "Finance reads the same money in the same words as you. When you and Finance read a number differently, open the page of the record behind it.",
            "财务读到的资金和您读到的是同一份，用的也是同样的说法。如果您和财务对某个数字有不同理解，请打开它背后的记录页面。",
          ))],
        }),
        tour(T("The Finance limit", "财务额度"), {
          shot: P("ad2-limit"), w: 50,
          intro: T(
            "Open [[Hotel]] under SETTINGS and find the card **Pricing, expenses & invoices**. The picture shows a value typed in and **not saved**.",
            "打开“设置”下的[[酒店]]，找到**价格、支出与发票**这张卡片。图中填入了一个数值，但**没有保存**。",
          ),
          items: T([
            "**Expense approval threshold** — another limit, for expenses: those at or above it wait for approval.",
            "**Purchase price Finance may authorize alone** — the Finance limit. A quotation above it is authorized only by the Boss or the MD. | Leave it empty for no limit: then Finance decides every price.",
            "**Purchases: the person who bought or quoted cannot approve their own purchase** — when it is on, nobody approves their own request, authorizes a price they quoted, or gives the final approval to stock they bought.",
          ], [
            "**支出审批金额**——另一个额度，针对支出：达到或超过此金额的支出要等待审批。",
            "**财务可单独授权的采购价格**——财务额度。高于此金额的报价只能由老板或总经理授权。 | 留空表示没有额度：这时财务决定每一个价格。",
            "**采购：采购人或报价人不能批准自己的采购**——开启后，没有人能批准自己提出的申请、授权自己报的价格，或对自己买的库存做最终批准，必须由另一个人来做。",
          ]),
          notes: [p(T(
            "[[Save settings]] at the bottom of the page saves the whole page. The limit is the **whole price of a quotation**, and the system holds Finance to it on the server — Finance cannot go around it.",
            "页面底部的[[保存设置]]保存整个页面。额度是**一份报价的总价**，系统在服务器上要求财务遵守——财务绕不过去。",
          ))],
        }),
        task(T("A price above Finance's limit", "超出财务额度的价格"), {
          when: T("A line **1 purchase price above Finance's limit** shows on your Home.", "您的首页出现一行**1 个采购价格超出财务额度**。"),
          shot: P("ad2-limit-home"), side: 96,
          steps: T([
            "Press the tab [[Money]] ((1)) — the lines about money.",
            "Tap the line **purchase price above Finance's limit** ((2)). It says how much Finance may authorize alone — **the rest is yours**. | [[Authorize or send it back]] opens Procurement.",
          ], [
            "点[[款项]]标签 ((1))——与资金有关的条目。",
            "点**超出财务额度的采购价格**这一行 ((2))。它写明财务可以单独授权多少——**其余由您决定**。 | [[授权或退回]]会打开采购页面。",
          ]),
        }),
        tour(T("Procurement: the tab With Finance", "采购：待财务处理标签"), {
          shot: P("ad2-proc-board"), side: 96,
          intro: T(
            "[[Procurement]] under STORES holds every approved purchase, one on each tab: **To quote**, **With Finance**, **Ready to order**, **On order**, **Invoices and payment**, **Closed**. You open on **With Finance**. The six tiles above them keep the purchasing money apart: **Asked for**, **Approved**, **Ordered**, **Invoiced**, **Paid**, **Still owed** — never added together.",
            "“库房”下的[[采购]]保存每一项已批准的采购，每项只在一个标签下：**待报价**、**待财务处理**、**可下单**、**已下单待收货**、**发票与付款**、**已关闭**。您打开时停在**待财务处理**。上方的六个方块把采购的各种金额分开：**申请金额**、**已批准**、**已下单**、**已开票**、**已付款**、**仍欠**——绝不相加。",
          ),
          items: T([
            "**With Finance** — the purchases whose price waits for an answer.",
            "**The number of the purchase** — press it to open it.",
          ], [
            "**待财务处理**——价格在等待答复的采购。",
            "**采购编号**——点它打开。",
          ]),
        }),
        tour(T("Authorize it, or send it back", "授权，或退回"), {
          shot: P("ad2-auth-open"), side: 90,
          intro: T(
            "The purchase shows the budget Finance approved, the quotations, and the section **Waiting for Finance**.",
            "采购页面显示财务批准的预算、各份报价，以及**等待财务处理**一栏。",
          ),
          items: T([
            "**Approved budget** — the most the request may cost.",
            "**Waiting for Finance** — who is proposed, at what total, and how much it is **above the budget**.",
            "[[Authorize this price]] — the purchase may then be ordered at this price. Your name and the time are kept.",
            "[[Send back]] — nothing is ordered. Purchasing sees your reason and can get a better price.",
          ], [
            "**批准预算**——这份申请最多可以花多少。",
            "**等待财务处理**——提议了谁、总价多少，以及**高出预算**多少。",
            "[[授权此价格]]——之后可以按此价格下单。您的姓名和时间会被保留。",
            "[[退回]]——不会下任何订单。采购会看到您的理由，并设法取得更好的价格。",
          ]),
        }),
        keep(
          h(T("The window, and what Finance meets", "窗口，以及财务遇到的情形")),
          pair([P("ad2-auth-form"), { cap: T(
            "[[Authorize this price]] opens a window. ((1)) **Note** — optional. ((2)) [[Authorize]] — one press.",
            "[[授权此价格]]会打开一个窗口。((1)) **说明**——可不填。((2)) [[授权]]——点一下即可。",
          ) }], [P("ad2-fin-limit"), { cap: T(
            "What **Finance** meets on the same purchase: ((1)) the system refuses — the price is above what Finance may authorize alone. The Boss or the MD authorizes it.",
            "**财务**在同一份采购上遇到的情形：((1)) 系统拒绝——价格高于财务可以单独授权的金额。要由老板或总经理授权。",
          ) }]),
        ),
        keep(
          shot(P("ad2-auth-done"), { w: 76, cap: T(
            "After you authorize: ((1)) **Price authorized — ready to order**. ((2)) The **Purchase order** section: Purchasing can now issue the order. Nothing is ordered, delivered or paid yet.",
            "您授权之后：((1)) **价格已授权——可下单**。((2)) **采购订单**一栏：采购现在可以下订单。此时还没有下单、收货或付款。",
          ) }),
          rule(T(
            "**An approval is not a payment.** Authorizing a price lets Purchasing order. The money leaves only when Finance pays the supplier — and then **one** expense is written. The whole path of a purchase is in chapter 7.",
            "**批准不等于付款。**授权价格只是让采购可以下单。只有财务向供应商付款时钱才会离开——那时才写入**一笔**支出。采购的完整流程见第 7 章。",
          )),
        ),
      ),

      // ───────────────────────── 6
      chapter(T("The hotel, live", "酒店实时情况"),
        T("You do not need to phone the hotel to know what is happening. These pages show the work of Reception, the restaurant and the drivers as it happens — they work, you look.",
          "不必打电话到酒店才知道情况。这些页面实时显示前台、餐厅和司机的工作——他们做，您看。"),
        keep(
          h(T("Where to look", "去哪里看")),
          table(T(["Page", "What you see", "Who does the work"], ["页面", "您看到什么", "谁在做"]), T([
            ["**Stays**, **Online**", "Every booking: arriving today, in the hotel, leaving today, coming. Online: the requests from the website.", "Reception"],
            ["**Calendar**", "Every room, every night — one week, two weeks or a month.", "Reception"],
            ["**Rooms**", "Every room at a glance: occupied, available, arriving today, needs cleaning — and, for an occupied room, whether the bill is **Paid**, **Not paid** or **Part paid**.", "Reception, housekeeping"],
            ["**Meetings**", "The bookings of the meeting room.", "Reception"],
            ["**Guest requests**", "What guests asked for: towels, cleaning, a repair.", "Reception, and whoever it is given to"],
            ["**Transport**", "Airport pickups and other trips.", "Reception and the driver"],
            ["**Live**", "Every restaurant order from new to served, and what is not paid.", "Waiters, Counter, kitchen"],
            ["**Tables**, **Menu**, **History**, **Waiters**, **Reservations**", "The tables and their QR codes, the menu, past orders, who is serving, table bookings.", "The restaurant"],
            ["**Customers**", "Everyone who has stayed, booked or ordered — the phone number finds them.", "Everybody"],
            ["**Messages**", "Enquiries sent through the contact form of the website.", "Reception answers"],
          ], [
            ["**入住记录**、**在线预订**", "每一条预订：今日抵达、在住、今天离店、即将到来。在线预订：来自网站的请求。", "前台"],
            ["**日历**", "每间房，每一晚——一周、两周或一个月。", "前台"],
            ["**客房**", "所有房间一目了然：已入住、可用、今日抵达、待清洁——已入住的房间还显示账单是**已付款**、**未付款**还是**部分付款**。", "前台、客房清洁"],
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
            "**Rooms** — one tile for every room. An occupied room also says how its guest's bill stands: **Paid**, **Not paid**, **Part paid**, **Group pays** — tap the room for the amount. The Boss and the MD also have **Room QR codes**, **Room types & inventory**, **Room pricing** and **Add room** at the top.",
            "**客房**——每间房一个方块。已入住的房间还会说明客人账单的情况：**已付款**、**未付款**、**部分付款**、**团体付款**——点一下房间可看金额。老板和总经理在顶部还有**房间二维码**、**房型与房源**、**房价**和**添加房间**。",
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
            "**Guest requests** — new, in progress and done today. A request that nobody took can be given to someone.",
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
        T("Stock changes only by a movement that somebody recorded. Received, used, wasted, counted — the departments ask, Finance approves, Purchasing buys, and you see what it costs.",
          "库存只会因为有人记录的出入库而变化：收货、使用、损耗、盘点。各部门提出申请，财务批准，采购购买——而您看到的是成本。"),
        keep(
          h(T("Inventory", "库存")),
          shot(P("a-inventory"), { w: 86 }),
          dots(T([
            "((1)) **Receive stock** — goods arrived: they go into the store.",
            "**The chips on top** change the department: Kitchen, Restaurant, Bar, Housekeeping and the others.",
            "**The tabs** — Overview, Stock, Movements, Waste, Count, Recipes and Setup. | **Movements** lists everything that came in or went out, with who and why.",
            "**Needs attention** — the items that are finished or under their minimum.",
            "**Recipes** tell the system what a dish uses, so the stock goes down by itself when the kitchen marks the dish ready.",
            "**Setup** — items, units, minimums, suppliers — is the MD's work.",
          ], [
            "((1)) **收货入库**——货到了：放入库房。",
            "**顶部的标签**切换部门：厨房、餐厅、酒吧、客房部等。",
            "**标签页**——概览、库存、出入库记录、损耗、盘点、配方和基础设置。 | **出入库记录**列出所有进出，包括谁、为什么。",
            "**需要关注**——已用完或低于最低库存的物品。",
            "**配方**告诉系统一道菜用了什么，厨房把菜标为已备好时，库存会自动减少。",
            "**基础设置**——物品、单位、最低库存、供应商——由总经理负责。",
          ]), true),
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
        keep(
          h(T("Purchase requests: from the ask to the supplier's payment", "采购申请：从提出到向供应商付款")),
          table(T(["Step", "Who", "What happens"], ["步骤", "谁", "发生什么"]), T([
            ["**1 · Ask**", "Reception, the Restaurant Counter, the kitchen — and Purchasing, the Manager and you", "Pick the items, say what it is for, give an estimate; a note and a photo help. **Reception asks for the hotel's supplies** (towels, paper, tables, bulbs); **the kitchen and the Counter for kitchen and bar supplies and equipment**. No money yet."],
            ["**2 · Review**", "Finance — the Manager, the MD and the Boss can too", "**Approve for purchase** with a budget (the most it may cost), **Send back** with a note, or **Reject**. Approval is permission to buy — not an expense."],
            ["**3 · Quotations**", "Purchasing", "Gets quotations from suppliers and proposes one. A price inside the budget goes straight on; a price above the budget, or with no budget, must be **authorized**."],
            ["**4 · Authorize**", "Finance — above the Finance limit, you", "See chapter 5."],
            ["**5 · Order and deliveries**", "Purchasing", "Makes the **purchase order**, then records each delivery: what is accepted and what is not. **Stock goes in only for the accepted lines** of a stock item."],
            ["**6 · Invoice**", "Purchasing records it, Finance checks it", "Finance **verifies** the supplier's invoice against the order and the delivery, or **disputes** it."],
            ["**7 · Payment**", "Finance", "Finance pays the supplier from an account. **Now** — and only now — **one** expense is written, and the purchase is **Done**."],
          ], [
            ["**1 · 提出**", "前台、餐厅收银台、厨房——以及采购、经理和您", "选择物品，说明用途，给出估价；备注和照片会有帮助。**前台申请酒店用品**（毛巾、纸张、桌子、灯泡）；**厨房和收银台申请厨房与吧台的用品和设备**。此时还不涉及钱。"],
            ["**2 · 审核**", "财务——经理、总经理和老板也可以", "**批准采购**并设定预算（最多可以花多少）、附上说明**退回**，或**拒绝**。批准只是允许购买——不是支出。"],
            ["**3 · 报价**", "采购", "向供应商取得报价并提出一个。预算内的价格直接通过；高于预算或没有预算的价格，必须**授权**。"],
            ["**4 · 授权**", "财务——超出财务额度的，由您", "见第 5 章。"],
            ["**5 · 下单与收货**", "采购", "下**采购订单**，然后记录每次收货：哪些验收通过、哪些没有。**只有验收通过的库存物品才会入库**。"],
            ["**6 · 发票**", "采购录入，财务核对", "财务对照订单和收货**核对**供应商发票，或**提出异议**。"],
            ["**7 · 付款**", "财务", "财务从某个账户向供应商付款。**到这时**——也只有到这时——才写入**一笔**支出，采购变为**完成**。"],
          ])),
          p(T(
            "The person who asked sees only seven plain words for their request: **Submitted**, **More information needed**, **Approved**, **Purchased**, **Completed**, **Rejected**, **Cancelled**. You, Finance and Purchasing see the real step.",
            "提出申请的人只看到自己申请的七个简单词语：**已提交**、**需要补充信息**、**已批准**、**已采购**、**已完成**、**已拒绝**、**已取消**。您、财务和采购看到的是真实的步骤。",
          )),
        ),
        tour(T("Purchase requests", "采购申请"), {
          shot: P("ad2-pr-queue"), w: 70,
          intro: T(
            "Open [[Purchase requests]] under STORES. You see every request of every department, with the step it is at.",
            "打开“库房”下的[[采购申请]]。您可以看到每个部门的每一份申请，以及它所处的步骤。",
          ),
          items: T([
            "**To review**, **To buy**, **Being bought**, **To approve** — how many wait at each step. | A row that says **Your turn** waits for you.",
            "**Shopping list** — everything approved and not yet bought, to **Copy** or to send by **WhatsApp**.",
          ], [
            "**待审核**、**待采购**、**采购中**、**待批准**——每个步骤各有多少份在等待。 | 写着**轮到您**的行在等您处理。",
            "**采购清单**——已批准但尚未购买的全部物品，可以**复制**，或通过 **WhatsApp** 发送。",
          ]),
          notes: [
            rule(T(
              "**A request is not an expense. An approval is not a payment. A purchase order is not a delivery. An invoice is not a payment.** The expense appears when Finance really pays the supplier — never before.",
              "**申请不是支出。批准不是付款。采购订单不是收货。发票不是付款。**只有财务真正向供应商付款时，才会出现支出——绝不会更早。",
            )),
            warn(T(
              "When the switch **Purchases: the person who bought or quoted cannot approve their own purchase** is on (chapter 9), nobody approves a request they asked for, authorizes a price they quoted, or gives the final approval to stock they bought — another person does.",
              "当**采购：采购人或报价人不能批准自己的采购**这个开关开启时（第 9 章），没有人能批准自己提出的申请、授权自己报的价格，或对自己买的库存做最终批准，必须由另一个人来做。",
            )),
            tip(T(
              "The Manager, the MD, the Boss and Finance can still **Record the purchase** directly — but only while the request is Approved and Purchasing has not yet proposed a quotation.",
              "经理、总经理、老板和财务仍然可以直接**登记采购**——但只限于申请处于“已批准”并且采购还没有提出报价的时候。",
            )),
          ],
        }),
      ),

      // ───────────────────────── 7
      chapter(T("People and access", "人员与权限"),
        T("Every person signs in with their own account, and its role decides what they can do. Accounts and rights are set by the MD and the Boss — nobody else can change them.",
          "每个人用自己的账户登录，账户的角色决定他们能看到什么、能做什么。账户和权限由总经理和老板设置——其他人无法更改。"),
        tour(T("Staff & roles", "员工与角色"), {
          shot: P("ad2-users"), w: 88,
          intro: T(
            "Open [[Staff & roles]] under PEOPLE. One line for each account: name, email, role, last sign-in and status. Here you see a **Finance** account ((2)) and an **Accountant** account ((3)) — the Accountant role is **Purchasing**.",
            "打开“人员”下的 [[员工与角色]]。每个账户一行：名称、邮箱、角色、上次登录和状态。这里可以看到一个**财务**账户 ((2)) 和一个**采购会计**账户 ((3))——采购会计角色就是**采购**。",
          ),
          items: T([
            "**Add staff** — makes a new account and gives it a role. | You choose the **department** first, then the role in it.",
            "**Role permissions** — the table of what each role is allowed to do (the tab above the list).",
          ], [
            "**添加员工**——新建账户并赋予角色。 | 先选**部门**，再选其中的角色。",
            "**角色权限**——每个角色被允许做什么的表格（列表上方的标签）。",
          ]),
          notes: [
            table(T(["When", "What to do"], ["情况", "怎么做"]), T([
              ["Somebody joins", "**Add staff**. Give the role of the job they really do — not a higher one. They sign in with their own email and the temporary password, and choose their own at the first sign-in."],
              ["Somebody forgot the password", "Press the pencil on their line, then **Reset password**, and give them the new one privately."],
              ["Somebody leaves", "Press the pencil on their line and untick **Account active** the same day. Their past work stays in the history under their name."],
            ], [
              ["有人入职", "**添加员工**。按其实际工作赋予角色——不要给更高的角色。他们用自己的邮箱和临时密码登录，并在首次登录时自己设定密码。"],
              ["有人忘记密码", "点该行的铅笔图标，再点**重置密码**，并私下把新密码告诉本人。"],
              ["有人离职", "当天点该行的铅笔图标，取消勾选**账户启用**。其过去的工作仍以本人姓名保留在记录里。"],
            ])),
          ],
        }),
        keep(
          h(T("Add a Finance or a Purchasing person", "添加财务或采购人员")),
          shot(P("ad2-users-add"), { w: 52 }),
          dots(T([
            "Press [[Add staff]]. In **Department & role**, choose the department ((1)) — **Management**, **Finance**, **Purchasing**, **Front office**, **Restaurant** or **Transport** — then the role in it ((2)).",
            "**Finance** → the role **Finance**. **Purchasing** → the role **Accountant**. A department with one role chooses it for you.",
            "Type the full name, the email they will sign in with, the phone and a temporary password (at least 10 characters with letters and numbers), then [[Create account]].",
          ], [
            "点[[添加员工]]。在**部门与角色**里，先选部门 ((1))——**管理层**、**财务**、**采购**、**前台**、**餐厅**或**交通**——再选其中的角色 ((2))。",
            "**财务**部门 → 角色**财务**。**采购**部门 → 角色**采购会计**。只有一个角色的部门，系统会替您选好。",
            "填写全名、他们登录用的邮箱、电话和临时密码（至少 10 个字符，含字母和数字），然后点[[创建账户]]。",
          ]), true),
        ),
        keep(
          h(T("Role permissions", "角色权限")),
          shot(P("ad2-roles"), { w: 88 }),
          p(T(
            "One line for every right, one column for every role: Managing Director (MD), Owner / Boss, Manager, Receptionist, Driver, Waiter, Mpishi (cook), Restaurant Counter, **Accountant** ((1)) and **Finance** ((2)). A tick means the role has the right. **The Owner role always has full access.** Changes apply from the staff member's next page load, and are audited.",
            "每项权限一行，每个角色一列：总经理（MD）、老板、经理、前台接待、司机、服务员、Mpishi（厨师）、餐厅收银台、**采购会计** ((1)) 和**财务** ((2))。打勾表示该角色拥有此权限。**老板角色始终拥有完全权限。**更改在员工下次加载页面时生效，并记入审计。",
          )),
          dots(T([
            "**Finance** holds the money rights: the accounts and the ledger, payments and expenses, authorizing purchase prices and paying suppliers, withdrawing from nTZS, the reports.",
            "**Accountant (Purchasing)** holds only the buying rights: the Procurement desk, ordering and receiving, and a view of the stock. No money right at all.",
            "Neither role has check-in, orders, staff accounts or hotel settings.",
          ], [
            "**财务**拥有与资金有关的权限：账户和总账、收付款和支出、授权采购价格和向供应商付款、从 nTZS 提现、报告。",
            "**采购会计（采购）**只有购买方面的权限：采购台、下单和收货、查看库存。没有任何与资金有关的权限。",
            "这两个角色都没有办理入住、点单、管理员工账户或修改酒店设置的权限。",
          ])),
          warn(T(
            "**Give a right because the job needs it — never to make a problem go away quickly.** The rights about money are the ones to guard: recording payments, approving expenses, changing prices, authorizing purchases, paying suppliers, withdrawing funds.",
            "**因为工作需要才授予权限——绝不要为了快速解决问题而授权。**与钱有关的权限最需要把关：记录付款、审批支出、修改价格、授权采购、向供应商付款、提现。",
          )),
        ),
        GAP,
        keep(
          h(T("What only the MD and the Boss can do", "只有总经理和老板能做的事")),
          dots(T([
            "Staff accounts and role permissions.",
            "The Finance limit, and authorizing a purchase price above it.",
            "An account's opening balance, and adding or changing a payment account.",
            "Settling a withdrawal by hand. (Finance can withdraw; it cannot settle.)",
            "Making a report again, and the staff discount limit.",
            "Rooms and room types.",
            "The menu and its tables. (Finance may change the price of a menu item.)",
            "Hotel settings and the website.",
            "Hotel QR and Spin to Win.",
            "The set-up of the stores, and the assets.",
          ], [
            "员工账户和角色权限。",
            "财务额度，以及授权高于额度的采购价格。",
            "账户的期初余额，以及添加或修改收付款账户。",
            "人工结清提现。（财务可以提现，但不能人工结清。）",
            "重新生成报告，以及员工折扣上限。",
            "房间和房型。",
            "菜单及其餐桌。（财务可以修改菜品的价格。）",
            "酒店设置和网站。",
            "酒店二维码和幸运转盘。",
            "库房的基础设置，以及资产。",
          ]), true),
          tip(T(
            "Not yours alone: **Finance** also keeps room prices, promotions and date prices in order, records the money movements and the cash counts, and changes the price of a menu item.",
            "不是只有您能做：**财务**也负责维护房价、促销和日期价格，记录资金变动和现金盘点，并修改菜品的价格。",
          )),
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
        T("The Control centre is the map of everything that can be set up. People, business rules, money, rooms and restaurant, stores, reports: a change here changes how the whole hotel works — and every change is recorded.",
          "控制中心是所有可设置内容的总览：人员、业务规则、资金、房间与餐厅、仓库、报告。这里的一次更改会改变整个酒店的运作方式——每项更改都有记录。"),
        keep(
          h(T("The Control centre", "控制中心")),
          shot(P("a-control-a"), { w: 80 }),
          shot(P("a-control-b"), { w: 72 }),
        ),
        keep(
          table(T(["Group", "The cards"], ["分组", "卡片"]), T([
            ["**People & access**", "Staff accounts · Roles & permissions · Audit history"],
            ["**Business settings**", "Hotel details & policies · Languages · Tax / VAT · Notifications · Website"],
            ["**Money set-up**", "Room pricing & promotions · Payment accounts · Expense types · Stock purchasing · Who approves a purchase · Financial corrections"],
            ["**Rooms & restaurant**", "Rooms & room types · Menu & categories · Tables & table QR codes · Room QR codes · Hotel booking QR · Spin to Win"],
            ["**Stores & assets**", "Inventory set-up · Recipes · Assets"],
            ["**Reports & oversight**", "Reports centre · Daily business reports"],
          ], [
            ["**人员与权限**", "员工账户 · 角色与权限 · 审计记录"],
            ["**业务设置**", "酒店信息与政策 · 语言 · 税费 / 增值税 · 通知 · 网站"],
            ["**资金设置**", "房价与促销 · 收付款账户 · 支出类型 · 库存采购 · 谁批准采购 · 财务更正"],
            ["**房间与餐厅**", "房间与房型 · 菜单与分类 · 餐桌与餐桌二维码 · 房间二维码 · 酒店预订二维码 · 幸运转盘"],
            ["**仓库与资产**", "库存设置 · 配方 · 资产"],
            ["**报告与监督**", "报告中心 · 每日业务报告"],
          ])),
          tip(T(
            "Each card opens the page where that thing is set. The small text on a card shows how it is set now. Two cards (**Notifications** and **Daily business reports**) still say “21:00” in that small text: it is old wording — the daily report is made at **07:00**.",
            "每张卡片都会打开对应的设置页面。卡片上的小字显示当前的设置情况。有两张卡片（**通知**和**每日业务报告**）的小字里仍写着“21:00”：这是旧的写法——日报在**早上 07:00** 生成。",
          )),
        ),
        keep(
          h(T("Hotel settings", "酒店设置")),
          shot(P("a-settings"), { w: 72 }),
          p(T(
            "The page has three tabs: **General & operations** (the cards below), **Lists** (the lists staff pick from) and **Guest messages** (every message sent, and the ones that failed). [[Save settings]] at the bottom saves the whole tab.",
            "这个页面有三个标签：**常规与运营**（下面的各张卡片）、**列表**（员工从中选择的列表）和**客人消息**（发出的每条消息，以及发送失败的消息）。底部的[[保存设置]]保存整个标签页。",
          )),
        ),
        table(T(["Card", "What you set"], ["卡片", "设置内容"]), T([
            ["**Hotel details**", "Name, tagline, address, phone, WhatsApp, email, website and the map link — shown on the public website, on confirmations and on invoices."],
            ["**Hotel day & stay times**", "When the business day starts, the standard check-in, the checkout time and the late-arrival time. Change them only with care: they move the boundary for future records."],
            ["**Pricing, expenses & invoices**", "The **Expense approval threshold** — expenses at or above this amount wait for approval. The **Purchase price Finance may authorize alone** (the Finance limit, chapter 5). Invoice due days, automatic invoice numbers, the tax name and rate — and the switch that makes someone other than the buyer or the quoter approve a purchase."],
            ["**Invoice “Pay into” details**", "The bank and mobile-money details printed on every invoice."],
            ["**Guest messages (WhatsApp / SMS)**", "Nothing to fill in: every message is written by the system from the real booking, bill, payment or order. The card lists what guests receive."],
            ["**Online ordering (menu QR & website)**", "The switch that lets guests order from the room QR cards, their stay link or the website — switch it off when the kitchen is closed — and the usual preparation time."],
            ["**Guest thank-you note**", "The note every guest gets at check-out. Leave a box empty to use the standard wording."],
            ["**Stay policies**", "The no-show cut-off, how long an unpaid booking holds the room, the late-checkout fee, the room-service delivery fee and the airport transfer price."],
            ["**Complimentary breakfast**", "Whether breakfast is included, its hours and where it is served. The room QR page, the welcome message and the printed lists all read it from here."],
            ["**Guest information (welcome card)**", "The Wi-Fi name and password, and the hours of reception, restaurant and bar — shown on the guest's welcome card."],
            ["**Website booking & daily report**", "Whether the website takes bookings and how far ahead; **Send the daily boss report automatically**; and the switch that sends the Boss each shift report, and the weekly and monthly reports."],
          ], [
            ["**酒店信息**", "名称、标语、地址、电话、WhatsApp、邮箱、网站和地图链接——显示在公开网站、确认信息和发票上。"],
            ["**营业日与住宿时间**", "营业日开始时间、标准入住时间、退房时间和晚到时间。请谨慎更改：它们会移动今后记录的分界点。"],
            ["**价格、支出与发票**", "**支出审批金额**——达到或超过此金额的支出需等待审批。**财务可单独授权的采购价格**（财务额度，第 5 章）。发票到期天数、自动发票编号、税种名称和税率——以及让采购人或报价人以外的人来批准采购的开关。"],
            ["**发票“付款至”信息**", "打印在每张发票上的银行和手机支付信息。"],
            ["**客人消息（WhatsApp / 短信）**", "无需填写：每条消息都由系统根据真实的预订、账单、付款或订单生成。这张卡片列出客人会收到哪些消息。"],
            ["**在线点餐（菜单二维码与网站）**", "让客人通过房间二维码卡、住店链接或网站点餐的开关——厨房关门时请关闭——以及通常的备餐时间。"],
            ["**客人感谢信**", "每位客人退房时收到的感谢信。留空则使用标准文字。"],
            ["**住宿政策**", "未到店截止时间、未付款预订保留房间的小时数、延迟退房费、客房送餐服务费和机场接送价格。"],
            ["**免费早餐**", "是否含早餐、早餐时间以及供应地点。房间二维码页面、欢迎消息和打印清单都从这里读取。"],
            ["**客人信息（欢迎卡）**", "Wi-Fi 名称和密码，以及前台、餐厅和酒吧的营业时间——显示在客人的欢迎卡上。"],
            ["**网站预订与日报**", "网站是否接受预订、可提前多少天预订；**自动向老板发送日报**的开关；以及向老板发送每个班次报告、周报和月报的开关。"],
          ])),
        tour(T("Room pricing", "房价"), {
          shot: P("a-pricing"),
          intro: T(
            "Open [[Room pricing]]. Reception and the website use these prices automatically. A booking keeps the price it was made at. The Boss, the MD and Finance can change them.",
            "打开 [[房价]]。前台和网站会自动使用这些价格。预订保留下单时的价格。老板、总经理和财务都可以修改。",
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
              "**Staff discount limit** — the most off a room per night that reception and managers may give: TZS 20,000, and 40,000 for the Twin room (**A room with its own limit**). Staff cannot give more. | You can also switch off **Receptionists may give a discount** or **Managers may give a discount**. Only the Boss and the MD can change this; Finance can read it.",
              "**Meeting Room** — one price per meeting booking. Promotions and date prices do not apply.",
            ], [
              "房型上的**修改价格**——新价格适用于新预订和加订的晚数。已预订的晚数绝不改变。",
              "**今晚前台价**和**今晚网站价**——客人今天要付的价格。",
              "**员工折扣上限**——前台和经理每间房每晚最多可给的优惠：TZS 20,000，双床房 40,000（**单独设置上限的房型**）。员工给出的折扣不能超过这个数。 | 也可以关闭**前台接待可给予折扣**或**经理可给予折扣**。只有老板和总经理可以更改这些；财务只能查看。",
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
              "**Spins that win a gift** and **Spins that win the bonus spin** — each out of every 100 spins; one bonus spin a stay. Then **Save**.",
            ], [
              "**标签**——已送出、设置、礼物、房间卡。",
              "**开关**为整个酒店开启或关闭幸运转盘。",
              "**每次入住的转盘次数**——每次入住最多赢得两份礼物。",
              "**礼物预算**——标准房和高级房分别设置。",
              "**不超过此价格的菜品可作为礼物**，以及活动的**第一天** / **最后一天**。",
              "**礼物在哪里享用**——送到房间、在餐厅，或两者都可以。",
              "**赢得礼物的转动次数**和**赢得额外一次机会的转动次数**——都是每 100 次转动中的数量；每次入住最多一次额外机会。然后点 **保存**。",
            ])),
          ),
          shot(P("a-spin-2-b"), { w: 66, cap: T(
            "**Which rooms get which budget** — here Standard rooms have TZS 10,000 of gifts a stay and Premium rooms TZS 15,000. You choose the amounts in **Set-up**.",
            "**各房间的预算**——这里标准房每次入住有 TZS 10,000 的礼物，高级房有 TZS 15,000。金额在**设置**里选择。",
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

    lastLead: T("The few things that must always be done the same way — and what to do when something goes wrong.", "少数必须始终按同一方式执行的事项，以及出问题时该怎么办。"),

    rules: T([
      ["Start from the report", "The numbers come by themselves: after each shift, every morning, every Monday and on the 1st. Read them before you ask anybody."],
      ["Earned, received, owed", "Three different things. Never add them together, and never treat a zero as a payment."],
      ["Never fix a number by hand", "If a record is wrong, **Edit**, **Reverse** or **Cancel** it with the reason. The history keeps the old value and the new one."],
      ["A report is never rewritten", "**Regenerate** makes a new version and keeps the old one. What was reported on the day stays visible."],
      ["One person, one account", "Nobody shares a password. Switch an account off the day somebody leaves."],
      ["The smallest right that does the job", "Give a right because the work needs it. Guard the rights about money."],
      ["Change the set-up with care", "The hotel day, the prices and the approval limit change the work of everybody from that moment. Booked nights keep their price."],
      ["Withdraw once, and read the name", "Read the registered name before you send. Never send the same withdrawal twice: while one is **Not confirmed**, nothing else can be sent, and only you settle it by hand — after you checked at nTZS."],
      ["An approval is not a payment", "A request, an approval and an order are not money. Only the supplier's payment is an expense, and Finance records it once. You authorize a price only when it is above Finance's limit."],
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
      ["提现只发一次，并看清姓名", "发送之前先看清登记的姓名。同一笔提现绝不发两次：只要有一笔**未确认**，就不能发其他提现，只有您可以人工结清——在您到 nTZS 那边核实之后。"],
      ["批准不等于付款", "申请、批准和订单都不是钱。只有向供应商的付款才是支出，由财务记录一次。只有价格超出财务额度时，才需要您来授权。"],
      ["礼物和折扣都是成本", "幸运转盘的礼物绝不是收入，也绝不是现金。员工折扣以您设定的上限为止。"],
      ["密钥绝不显示在屏幕上", "nTZS 密钥和系统密码保存在服务器上。需要接通某项服务时，请联系 Nino。"],
    ]),

    problems: T([
      ["The daily report did not arrive on WhatsApp", "Open **Daily reports**: the report is there. If the line says **Not sent**, open it and press **Send now**. If it happens again, tell Nino."],
      ["A number in yesterday's report is wrong", "Find the record in **Income** or **Expenses** and correct it with the reason. Then open the report and press **Regenerate** — the old version is kept."],
      ["Money received is lower than income", "Normal: some guests have not paid yet. Look at **Still owed** in the report, and at **Who owes us**."],
      ["The cash in the drawer is not what the system says", "Open **Accounts**, open the cash account, press **Count** and type what was counted. The difference must be explained."],
      ["An expense waits and the Manager is away", "Open **Expenses** and **Approve** or **Reject** it yourself. Finance can answer it too."],
      ["Finance cannot authorize a purchase price", "The price is above the Finance limit. Open **Procurement**, the tab **With Finance**, and **Authorize this price** yourself — or **Send back**. Raise the limit in **Hotel** settings only if you want Finance to decide larger prices."],
      ["**Withdraw funds** is dimmed and a yellow line names a withdrawal", "That withdrawal is **Not confirmed**. Open it and press **Ask nTZS now**. If nTZS still cannot say, check at nTZS itself, then **Settle by hand**."],
      ["**Available to withdraw** shows TZS 0, but nTZS has money", "The account's **Opening balance** is not set. Set it on the nTZS account's page in **Accounts**, from what nTZS really shows."],
      ["A purchase waits and nobody moves it", "Look at its step. **To quote** waits for Purchasing, **With Finance** waits for a price answer, **Invoices and payment** waits for Finance. Ask that department."],
      ["A staff member cannot open a page", "Their role does not have the right. Look at **Staff & roles → Role permissions** — and give it only if the job needs it. A forgotten password is reset from their line in **Staff & roles**."],
      ["A price is wrong on the website", "Rooms: **Room pricing**. Food and drinks: **Menu**. Both change the website at once."],
      ["A customer paid by phone but the order still says not paid", "Open **Online payments** and look at **Waiting** and **Needs a person**. Do not record it as paid before the money is confirmed."],
      ["A room says **Not paid** but the guest says they paid", "Tap the room: its card shows the bill and what was paid. Look for the payment in **Income** or **Collections**. Nothing is paid before the money is recorded."],
      ["A shift was left open", "The Manager closes it with the reason, from **Staff shifts**. You can do the same."],
      ["The page is in the wrong language", "Tap **EN** or **中文** on the top bar."],
      ["Something does not work", "Take a picture of the screen and send it to Nino on WhatsApp."],
    ], [
      ["WhatsApp 上没有收到日报", "打开**日报**：报告就在那里。如果该行显示**未发送**，打开它并点**立即发送**。如果再次发生，请告诉 Nino。"],
      ["昨天报告里的某个数字不对", "在**收入**或**支出**里找到那条记录，写明原因并更正。然后打开报告，点**重新生成**——旧版本会保留。"],
      ["已收款项低于收入", "这很正常：有些客人还没付款。查看报告里的**仍欠**，以及**应收款**。"],
      ["抽屉里的现金与系统显示的不一致", "打开**账户**，点进现金账户，点**盘点**，输入实际清点的金额。差额必须说明原因。"],
      ["有支出待审批，而经理不在", "打开**支出**，自己**批准**或**拒绝**。财务也可以答复。"],
      ["财务无法授权某个采购价格", "价格超出了财务额度。打开**采购**的**待财务处理**标签，自己**授权此价格**——或**退回**。只有您希望财务决定更大金额的价格时，才在**酒店**设置里提高额度。"],
      ["**提现**按钮变灰，一行黄色提示点名了一笔提现", "那笔提现是**未确认**。打开它，点**立即向 nTZS 查询**。如果 nTZS 仍然无法答复，先到 nTZS 那边核实，再**人工结清**。"],
      ["**可提现金额**显示 TZS 0，但 nTZS 里有钱", "该账户的**期初余额**还没有设置。到**账户**里的 nTZS 账户页面设置，依据 nTZS 实际显示的数字。"],
      ["有采购卡住，没有人处理", "看它所处的步骤。**待报价**在等采购，**待财务处理**在等价格答复，**发票与付款**在等财务。去问相应的部门。"],
      ["员工打不开某个页面", "其角色没有这项权限。查看**员工与角色 → 角色权限**——只有工作确实需要时才授予。忘记密码，在**员工与角色**里该员工的那一行重置。"],
      ["网站上的价格不对", "客房：**房价**。餐饮：**菜单**。两者都会立即更新网站。"],
      ["顾客已用手机付款，但订单仍显示未付", "打开**在线支付**，查看**等待中**和**需人工处理**。在款项确认之前，不要记为已付。"],
      ["房间显示**未付款**，但客人说已经付过", "点一下房间：房间卡片会显示账单和已付金额。到**收入**或**收款**里查找那笔付款。钱没有记录之前，就不算已付。"],
      ["有班次没有关闭", "经理在**员工班次**里写明原因后将其关闭。您也可以这样做。"],
      ["页面的语言不对", "点击顶部栏的 **EN** 或 **中文**。"],
      ["有功能无法使用", "拍下屏幕，用 WhatsApp 发给 Nino。"],
    ]),
  };
};

export default make("en");
