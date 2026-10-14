import { chapter, task, tour, flow, tip, warn, rule, p, h, dots, table, beside, shot, keep, pair, render } from "../tools/kit.mjs";

const GAP = '<div style="height:5mm"></div>';
// A picture on the left, its story on the right.
const left = (id, mm, ...blocks) => (c) => `<div class="split" style="grid-template-columns:${mm}mm 1fr;margin:0 0 4mm">${shot(id, { wrap: "" })}<div>${render(c, blocks)}</div></div>`;

// Two narrow pictures of the menu on the left, side by side, and its words on the right.
const menus = (a, b, mm, ...blocks) => (c) => `<div class="split" style="grid-template-columns:${mm}mm ${mm}mm 1fr;gap:5mm;margin:0 0 4mm">${shot(a, { wrap: "" })}${shot(b, { wrap: "" })}<div>${render(c, blocks)}</div></div>`;

export default {
  id: "manager", file: "Vegas-Guide-07-Manager.pdf", name: "Manager guide", dept: "manager", accent: "#5b4a8a", soft: "#eeebf5",
  kind: "Management", kicker: "Guide book 07", title: "Manager",
  sub: "The whole hotel on one screen: what needs you now, your decisions on rooms and bills, approvals, purchase requests, the stores, the shifts, the money and the reports — step by step.",
  cover: { shots: ["m2-n-cover"] },
  lead: "This book is for the **Manager** of Vegas Luxury Hotel. The staff do the routine work; you **watch every department, decide what staff cannot decide alone, and step in when something waits too long**. Finance holds the money, Purchasing buys. Every decision is recorded with your name, the reason and the time.",

  place: [
    h("What comes to you"),
    table(["What", "From", "Where you see it"], [
      ["A room past its check-out time", "Reception", "**Needs your attention** on Home, and the red chip **overdue checkouts** on **Rooms**."],
      ["A guest request nobody took", "The guest's phone, or Reception", "**Guest requests** — the column **New**."],
      ["An expense above the limit", "The staff member who recorded it", "**Expenses** — the line says **Waiting approval**."],
      ["Waste", "The kitchen, the bar, any department", "**Inventory → Waste** — **Waiting for approval**."],
      ["A purchase request", "Reception, the Counter, the kitchen, any department", "**Purchase requests** — the box **To review**. Finance reviews them too."],
      ["A purchase bought straight away", "Whoever bought it, without Purchasing", "**Purchase requests** — the box **To approve**."],
      ["A shift that was left open", "Reception or a waiter", "**Staff shifts** — **On shift now**."],
    ]),
    h("What goes out from you"),
    table(["What", "Goes to", "How"], [
      ["A decision on a room or a bill", "Reception, and the guest's bill", "On the room itself — **Your decisions** — with your name and the reason."],
      ["Yes or no on an approval", "The person who asked", "The record changes its status, and your name is written on it."],
      ["A purchase request you approved", "Purchasing, then Finance", "**Approve for purchase** with a budget. Purchasing gets the quotes; a price above your budget goes to Finance."],
      ["The rota of the front desk", "Reception", "**Shifts → Schedule**."],
      ["The numbers of the day", "The MD and the Boss", "Nothing to send: the reports are made and sent automatically."],
    ]),
    h("Finance and Purchasing, beside you"),
    table(["Department", "What you get from them", "What you give them"], [
      ["**Finance**", "The money facts you read: the accounts, who owes the hotel, the daily report. Finance also reviews purchase requests, authorizes a price above the budget and pays the suppliers.", "Your decisions on expenses and on purchase requests, and the corrections you make — each with a reason."],
      ["**Purchasing**", "Quotes, orders and deliveries. The stock goes up only for what was accepted when it arrived.", "An approved purchase request with a budget: it is where Purchasing starts."],
    ]),
  ],

  chapters: [
    // ───────────────────────── 2
    chapter("Your home page", "Home is the hotel on one page: what needs you now, the rooms, the money, the restaurant and who is working. Under them the money is explained to you in plain words. It refreshes by itself — you never have to ask anybody for the numbers.",
      tour("Home, at a glance", {
        shot: "m2-n-home", w: 90,
        items: [
          "**Jump to** — small links under the picture of the hotel. | Tap one and the page moves to that part: Needs your attention, Rooms today, Tables today, Right now, The business, Where the money is, Cash outlook, How the hotel is doing, Online bookings, In detail.",
          "**NEEDS YOUR ATTENTION** — everything in the hotel that waits for somebody. | The number beside it counts the lines.",
          "**The tabs** — All, Front desk, Maintenance, Restaurant, Bookings, Rooms, Stores, Money. | Tap one to see only that department. The number on each tab is how many lines it has.",
          "**One line** — what it is, who or where, and what to do about it. | On the right: how long it has waited. Tap the line to open the place where you solve it.",
          "**Scroll for more** — the list is longer than the box. Scroll inside it.",
          "**ROOMS TODAY** — how full the hotel is tonight. | **MONEY TODAY**, beside it, is the money received today. **Today's report** opens the daily report.",
        ],
      }),
      h("What the lines say"),
      table(["The line", "What to do"], [
          ["**Room 107 — checkout overdue** · owes TZS 80,000", "The guest is past the check-out time. Add nights, give a free late check-out, or have Reception check them out (chapter 3)."],
          ["**Room 105 waiting for cleaning** · nobody has started it", "Check with housekeeping. When it is clean, press **Confirm clean & ready** on the room."],
          ["**#12 waiting to be accepted**", "A new order nobody accepted. The kitchen should accept it — go and ask."],
          ["**#11 ready, not served yet**", "The food is ready and no waiter took it. Get a waiter to take it."],
          ["**1 online booking request not answered**", "Reception should call the guest back."],
          ["**Room 101 waiting for help** · nobody on it", "A guest request without a person. Give it to someone (chapter 4)."],
          ["**LG split air conditioner out of order** · Room 204", "An asset under repair. Follow the repair."],
          ["**2 purchase requests to review** · Kitchen", "Purchase requests wait for your yes or no. Open **Purchase requests** (chapter 7)."],
          ["**1 expense to approve**", "An expense waits for your decision. Open **Expenses** and press **Approve** or **Reject** (chapter 6)."],
          ["**1 purchase waiting for final approval**", "Something was bought straight away and waits for you to check the receipt (chapter 7)."],
          ["**1 waste report to approve**", "The stock drops only when you approve it. Open **Inventory → Waste** (chapter 7)."],
          ["**Asha's shift has been open 15 h — close it**", "A shift was forgotten open. It holds one of the two reception places. Open it and press **Close this shift** (chapter 8)."],
        ]),
      tip("The list is not a list of your tasks only. Most lines belong to a department — your work is to see that somebody **does** them, and to decide when a decision is needed."),
      keep(
        h("Rooms and money today"),
        shot("m-home-money", { w: 84 }),
        dots([
          "**Rooms tonight** — occupied, booked and arriving, available, cleaning and maintenance. | Under it: who arrives, who leaves, how many are overdue, and who is on the front desk now.",
          "**Received today** — money that really came into the hotel's accounts today. | **Not paid yet** is what guests in the hotel still owe.",
          "**Earned today**, **Spent**, **Profit (estimate)** — earned is room nights and food served, not cash. | **Income per room** and **Average room rate** show how well the rooms sell.",
        ], true),
      ),
      keep(
        h("Every room right now"),
        left("ck2-m-rooms", 104,
          p("One tile for every room, live. The colour and the chip say its state: **Occupied**, **Available**, **Arriving today**, **Needs cleaning**."),
          p("An occupied room also says the guest's bill, in one coloured word under the guest's name:"),
          dots([
            "((1)) **Not paid** (red) — the guest has paid nothing yet. | **Part paid** is amber. **Group pays** and **On company invoice** are violet: the group or the company owes it, and it is never called Paid. **Overpaid** is blue. **Nothing due** is grey.",
            "((2)) **Paid** (green) — the bill is settled.",
            "((3)) **Overdue · 11:00** — a red line: the check-out time has passed.",
          ]),
          p("The amount is not on the tile. Tap a tile to see who is in the room, the balance, the bill and its history — and to make your decisions (chapter 3). A red or amber word is what you ask Reception about: the guest should pay before leaving, or you decide **Let leave owing**."),
        ),
      ),
      keep(
        h("The restaurant today"),
        shot("m-home-rest", { w: 92 }),
        dots([
          "**Tables now** — seated, waiting to pay, paid and to clear, reserved, free. | **The floor** opens the tables.",
          "**Restaurant & bar today** — the value of today's orders: food, drinks and room service fees. | **To pay at the tables** is what is still open. **Live orders** opens the restaurant board.",
        ], true),
      ),
      pair(["m-home-hotel", { cap: "**HOTEL RIGHT NOW** — one line per department: front desk, housekeeping, restaurant, tables, payments, maintenance and stores." }],
        ["m-home-staff", { cap: "**STAFF TODAY** — what each person did today. **All activity** opens the full list (chapter 8)." }]),
      keep(
        h("Under the Occupancy chart: The money, analysed"),
        p("Further down Home has a part called **The money, analysed**. It tells you in plain words what the money of the hotel is doing. It is made from the same figures Finance reads, so you and Finance always see the same numbers. It follows the days you pick with the buttons **Today · Yesterday · This week · This month · This year** in **The business**, above it. When you have picked none (Home opens on Today), it reads **this month**, because one day alone says little."),
      ),
      tour("What stands out", {
        shot: "m2-n-an-1", w: 88,
        items: [
          "**The money, analysed** — the name of the part, and the days it reads. | Change the days with the period buttons in **The business**, above it.",
          "**What stands out** — a few plain sentences, written from the figures below. | Nothing is guessed. When there is too little to say, a sentence is simply not there.",
          "**One sentence** — for example: money owed to the hotel is more than a week late, the biggest expense, how many days the money will last, what was earned against what was spent.",
        ],
        notes: [tip("A sentence is a pointer, not a decision. Open the page behind it — **Who owes us**, **Expenses**, **Accounts** — and look at the real lines.")],
      }),
      tour("Where the money is", {
        shot: "m2-n-an-2", w: 74,
        intro: "Tap **Where the money is** in the **Jump to** row.",
        items: [
          "**The ring** — every account of the hotel in one circle. In the middle: what the hotel's own records hold in all of them. | A bigger piece of the circle is more money in that account.",
          "**BY KIND OF ACCOUNT** — the same money by kind: cash, banks, mobile money. | With the share of each, in percent.",
          "**One line for each account** — its colour, its name and its amount, written in full.",
        ],
        notes: [
          shot("m2-n-an-2b", { w: 74, cap: "**One card for each account** ((1)) — its amount in full, its share of all the money, and ((2)) what moved today. Tap a card to open that account." }),
          warn("This is **what the hotel's own records add up to** — not what the bank says. Check it against the bank or the mobile-money statement."),
        ],
      }),
      tour("Cash outlook", {
        shot: "m2-n-an-3", w: 80,
        items: [
          "**In the accounts** — the money in the accounts, by the hotel's own records.",
          "**Owed to the hotel** — what guests and companies still have to pay. | It is not money yet.",
          "**Days the money lasts** — how many days the money in the accounts covers, at the pace the hotel spent in the last 30 closed days. | With fewer than seven days of records it says so, and does not guess.",
          "**Who owes the hotel — how late** — the same debt, split: not late yet, 1–7 days, 8–30 days, more than 30 days late. | A guest's bill is due the day they leave; a company's, on its due date. **Who owes us** opens the list.",
        ],
        notes: [
          shot("m2-n-an-3b", { w: 80, cap: "**How fast the money goes** — ((1)) the average spent each day, what was spent in all, and ((2)) the expenses still waiting for approval. **Rooms booked ahead** ((3)) — the next 30 nights: money still to be earned, not money received." }),
          warn("These figures stand **side by side and are never added**: money in the accounts, money owed to the hotel and money still to be earned are three different things."),
          p("You do not see **Owed to suppliers** and **What the hotel owes — when it falls due**: supplier invoices are for Finance, Purchasing, the MD and the Boss."),
        ],
      }),
      tour("How the hotel is doing", {
        shot: "m2-n-an-4", w: 80,
        items: [
          "**The key figures** — each figure against the period before.",
          "**Occupancy** — the share of the guest rooms that were sold.",
          "**The change** — the small number with the arrow is the change against the period before.",
          "**Income per available room** — what the rooms earned for every room the hotel has, sold or not.",
          "**Spent of what was earned** — the recorded expenses against what was earned, in percent.",
          "**Cash of the money received** — how much of the money received came as cash; the rest came by mobile money, bank or card.",
        ],
        notes: [
          p("The other figures are **Nights sold**, **Average room rate**, **Average restaurant order** and **Room discounts** — the share of the room price that was given away. Under them: **The last six months**, month by month; **Occupancy** over the days; **Which days earn most** — the average earned on each day of the week, with the best day marked; and **Income** and **Expenses against the period before**, part by part."),
        ],
      }),
      keep(
        h("How you use it"),
        table(["When", "What you do"], [
          ["**Every morning**", "Read **What stands out**. A late debt or an unusual expense is a question for Reception or Finance."],
          ["**Before you decide**", "Look at **Where the money is** and **How fast the money goes**."],
          ["**Once a week**", "Read **How the hotel is doing**: is occupancy up or down? Which days earn most?"],
          ["**A number surprises you**", "Open the page behind it: **Who owes us**, **Expenses**, **Accounts**, **General ledger**."],
        ]),
        warn("You **see** these figures; you do not do Finance's work. If one looks wrong, ask Finance — never change a record to make a figure look right."),
      ),
      menus("m2-n-menu-a", "m2-n-menu-b", 31,
        h("The menu on the left"),
        table(["Part", "What is in it"], [
          ["**FINANCE**", "Overview, Income, Expenses, Accounts, Companies, Collections, Who owes us, Edit history, General ledger, Online payments."],
          ["**BOOKINGS**", "Stays, Online, Calendar, Hotel QR."],
          ["**HOTEL SERVICES**", "Rooms, Meetings, Transport, Daily lists, Spin to Win, Guest requests."],
          ["**RESTAURANT & BAR**", "Live, Tables, History, Waiters, Reservations."],
          ["**STORES**", "Assets, Inventory, Purchase requests."],
          ["**PEOPLE**", "Shifts, Activity, Staff shifts."],
          ["**INSIGHTS**", "Reports, Daily reports, Weekly & monthly."],
          ["**SETTINGS**", "Messages, Customers."],
        ]),
        p("There is no **Check in**, **Check out** or **Sell** in your menu. That is the work of Reception and the restaurant — you see everything they do, and you decide. There is also no **Withdraw funds**, no **Procurement** and no Finance Home: they belong to Finance, Purchasing, the MD and the Boss."),
      ),
      keep(
        h("A day of the Manager"),
        table(["When", "What you do"], [
          ["**Morning**", "Open **Daily reports** and read yesterday's report (chapter 9). Read **What stands out** on Home. Open **Shifts**: who is on the desk today? Print the **Daily lists** for housekeeping and breakfast if Reception has not."],
          ["**During the day**", "Keep **Home** open. Work through **Needs your attention**. Answer the approvals: expenses, waste, purchase requests."],
          ["**Around check-out time**", "Open **Rooms** and tap **overdue checkouts**. Decide each one with Reception."],
          ["**Evening**", "Open **Staff shifts**: is a shift still open that should be closed? Look at **Collections** and **Who owes us**."],
        ]),
      ),
      rule("You watch and you decide. If you find yourself doing the routine work of a department every day, something is wrong in that department — fix that instead."),
    ),

    // ───────────────────────── 3
    chapter("Rooms and your decisions", "Reception runs the rooms. A few things are yours alone: closing and opening a room, moving a guest because of a problem, discounts, free nights, a late check-out and letting a guest leave with a balance. Each one is recorded with your name and the reason.",
      tour("The rooms page", {
        shot: "ck2-m4-rooms", w: 92,
        intro: "Open [[Rooms]] in the menu. The chips on top — All, Available, Occupied, Arriving today, Needs cleaning — show only those rooms. An occupied room says its guest's bill in one coloured word: **Paid** or **Not paid**. Ask Reception about every red **Not paid** and every amber **Part paid** before the guest leaves.",
        items: [
          "**Needs cleaning** — a room that waits for housekeeping. | It goes back on sale when somebody confirms it is clean.",
          "**Overdue checkouts** — the rooms whose guest is past the check-out time.",
          "**A room** — tap it. A panel opens with the guest, the balance, the bill, the history — and **Your decisions**.",
          "**Room QR codes** — the QR card of every room, to print.",
          "**Not paid** — the guest in this room has paid nothing yet. | Also: **Part paid** (amber), **Group pays** and **On company invoice** (violet), **Overpaid**, **Nothing due**. The amount is not on the tile: open the room.",
          "**Paid** — the bill is settled. | Reception collects what is owed at the desk. You ask about it; you do not collect it.",
        ],
      }),
      tour("A room with a guest", {
        shot: "ck2-m4-room-occ", w: 80,
        intro: "On top the panel shows what the room earned this month, the nights sold, its occupancy and its rank among the rooms. The guest's card shows the stay and the **Balance** — the amount the guest still owes, or **Paid**. Under it you find **Your decisions**.",
        items: [
          "**Move guest** — only when something is wrong in the room.",
          "**Free nights** — a gift of one or more nights.",
          "**Discount** — money off each night, or off the whole bill.",
          "**Close room** — nobody can book it or check in.",
          "**Room service waiter** — who serves the food and drinks ordered from this room.",
          "**Balance** — what this guest still owes. | The same bill the tile on the board says in one word.",
        ],
        notes: [
          shot("ck2-m4-room-owes", { w: 54, cap: "A room that is **Not paid**: the **Balance** ((1)) is the amount the guest still owes." }),
          p("Further down: **LAST 14 NIGHTS** — a chart of the nights sold — and **LATEST GUESTS**, the people who stayed in this room."),
        ],
      }),
      task("Close a room", {
        when: "Something is broken, or the room must not be sold.",
        shot: "m4-room-close-c", side: 96,
        steps: [
          "**Close now** — or **Close for dates**, when the work is planned for later.",
          "**Maintenance** — or **Out of service**.",
          "Tap what is wrong: AC / fan, Water / plumbing, Electricity / lights, Bathroom, TV, Bed / furniture, Painting / repairs, Door / lock, Deep cleaning.",
          "**What is wrong?** — say it in a few words: AC not cooling.",
          "Press the red [[!Close room 206 now]].",
        ],
        notes: [
          warn("**Nobody can book or check into the room while it is closed.** It is recorded with your name, the reason and the time."),
          p("**To open it again**, tap the room and press **Open room again**: **Fixed — ready now** puts it straight back on sale; **Fixed — clean it first** sends it to housekeeping first. A closure planned for later dates can be taken back with **Cancel this closure**."),
        ],
      }),
      task("Move a guest to another room", {
        when: "The room has a problem that cannot be fixed today.",
        shot: "m4-room-move-c", side: 96,
        intro: "A guest who is checked in cannot change room on request — they check out and make a new booking. **A move here is only for a problem in the room, and it is free for the guest.**",
        steps: [
          "Tap the reason: AC problem, Plumbing, Electrical problem, Water problem, Room damage, Maintenance, Guest safety or Other hotel issue.",
          "**Details** — optional: AC stopped working, cannot be repaired today.",
          "Under **FREE ROOMS (READY NOW)**, choose the new room and confirm.",
        ],
        notes: [tip("The move **closes the old room** and opens the new one. The bill, the payments, the orders and the QR link of the guest all move with them.")],
      }),
      task("Give a discount on the room", {
        when: "A VIP guest, a complaint, a loyal customer.",
        shot: "m4-room-disc-c", side: 88,
        steps: [
          "Type the amount **off each night**. | The line above the box tells you the most you may give and the price now.",
          "**Why?** — VIP guest, noise complaint, loyal customer. The reason is required.",
          "Press [[!Save … off each night]].",
        ],
        notes: [
          p("**Whole bill**, beside **Room price per night**, takes an amount or a percent off everything the guest owes instead. It is split fairly over the room and each department, shown on the guest's bill, and recorded with your name, role and reason."),
          warn("**There is a limit** — and it depends on the room type: now the Twin room 40,000, the other rooms 20,000. Only the Boss or the MD change it; a bigger discount is their decision."),
        ],
      }),
      task("Give free nights", {
        when: "A long stay, a service problem, a loyal customer.",
        shot: "m4-room-nights-c", side: 96,
        steps: [
          "Tap how many: **+1 night**, **+2 nights**, **+3**, **+5** or **+7 nights**.",
          "**Why?** — long stay, service problem, loyal customer.",
          "Press [[!Give 1 night free]]. | The button says what the gift is worth.",
        ],
        notes: [tip("The guest's check-out date moves by the nights you give. The nights are on the bill at TZS 0, with your name.")],
      }),
      task("A guest past the check-out time", {
        when: "The room shows Overdue.",
        shot: "m4-room-overdue-c", side: 84,
        intro: "The panel says **Past checkout time — check out or add nights**. Reception can check the guest out or add paid nights. These three are yours:",
        steps: [
          "**Free late checkout** — **Let them stay until …, free**. | No extra night is charged for today.",
          "**Let leave owing** — the guest may check out without paying everything. | Write why: company pays by transfer on Friday. The rest stays on their account, under **Who owes us**.",
          "**Free nights** — the stay goes on, as your gift.",
        ],
        notes: [
          warn("**Let leave owing** is a debt you accept for the hotel. Reception cannot check a guest out with a balance without it. Changed your mind before they leave? **Withdraw the approval — they pay first**."),
        ],
      }),
      keep(
        h("A room that needs cleaning"),
        beside("m4-room-clean-c", 96,
          p("After a check-out the room turns to **Needs cleaning**, and the panel shows how long it has waited. Housekeeping works from the printed checklist."),
          p("When the room is really clean, Reception marks it — or you press **Confirm clean & ready** ((1)). The room goes back on sale at once."),
          p("On a free room you also find **Send for cleaning**: it turns the room to **Needs cleaning** so that it is cleaned again before the next guest."),
        ),
      ),
      keep(
        h("A guest who did not arrive"),
        p("When a booked guest does not come, the room stays held for them and cannot be sold. The room then shows **Release room**: write why — no answer on the phone — and press it. The room is free again. If the guest had paid, the hotel's no-show rule decides whether the money is kept or refunded."),
      ),
      rule("Every decision asks **Why?** Write the real reason, in plain words. The MD and the Boss read it in the reports — a clear reason answers their question before they ask it."),
    ),

    // ───────────────────────── 4
    chapter("Bookings and guest care", "Reception makes the bookings and answers the guests. You see every booking, how fast the requests are answered, and you step in where a person is needed.",
      tour("Stays — every booking", {
        shot: "ck2-m4-stays", w: 88,
        intro: "Open [[Stays]] in the menu. On top are the numbers of the day: bookings made, checked in, checked out, money received, still to arrive, and cancelled or no-show.",
        items: [
          "**Room schedule** — opens the calendar. **Groups** shows the group bookings.",
          "**RECEPTION, TODAY** — what the front desk did today, newest first. | It stays empty until Reception makes a booking, a check-in or a check-out.",
          "**The tiles** — Arriving today, In the hotel, Leaving today, Coming soon, All bookings. | Tap one to see its list.",
          "**The filters** — Pending · unpaid, Not paid · room not held, Confirmed · paid, **Owes money**, Company invoice, Hotel QR.",
          "**Search** — a name, a company, a phone, a reference, a room or a date.",
        ],
      }),
      tour("The calendar", {
        shot: "ck2-m4-cal", w: 60,
        intro: "Open [[Calendar]]. Every room is a line, every night a column. Tap a booking to see its guest, dates and bill.",
        items: [
          "**Week · 2 weeks · Month** — how many nights you see. **Today** brings you back.",
          "**Fewest free** — the tightest night of the period, and how many rooms are still free.",
          "**Rooms with two guests at once — sort out.** | A red **Clash** on a room: two bookings on the same night. Move one of them with Reception.",
        ],
        notes: [p("The colours: **In the hotel**, **Reserved · paid / confirmed**, **Pending · unpaid** (held for a while), **Checkout overdue**, **No-show · room still held** and **Maintenance**.")],
      }),
      tour("Online bookings", {
        shot: "ck2-m4-online", w: 60,
        intro: "Open [[Online]]. These are the requests from the website and WhatsApp.",
        items: [
          "**Waiting for an answer** — requests nobody has answered. | Beside it: how many became bookings, the average answer time and the value booked.",
          "**Booked online — not paid yet** — the room is not held until it is paid: whoever pays first gets it.",
          "**A request** — who, the dates, the room type, where it came from and how long it has waited. | The tabs above the list: Open, New, Reviewing, Contacted, Confirmed, Converted, Rejected, Cancelled.",
        ],
        notes: [tip("A guest who writes to a hotel and waits two hours books somewhere else. Watch the **average answer time** — it is the number that tells you how Reception treats new guests.")],
      }),
      tour("Guest requests", {
        shot: "m2-n-greq",
        intro: "Open [[Guest requests]]. Towels, cleaning, repairs, help — guests ask from the QR code in their room, or Reception logs it.",
        items: [
          "**Log a request** — write one yourself, for a guest who asked you.",
          "**New** — waiting for someone to accept.",
          "**Give it to…** — choose the person who must handle it. | Their name goes on the card.",
          "**Done today** — what was finished.",
        ],
        notes: [p("A request moves like an order: **New → On it → Done**. The **✕** on a card closes a request that is not needed any more.")],
      }),
      keep(
        h("Transport: prices and trips"),
        p("Reception takes the transport requests and gives them to a driver. Open [[Transport]] to see every trip — Today, Pending, Confirmed, In progress, Upcoming, Completed, Cancelled."),
        pair(["m4-trn-open-c", { cap: "**A trip.** ((1)) **Adjust** changes the price of this trip — the new price and the reason. ((2)) **Confirm request**, ((3)) **No show** and ((4)) **Cancel** are the same as for Reception." }],
          ["m4-trn-prices-c", { cap: "**Report & prices.** ((1)) Services, packages and prices: change a price and press ((2)) **Save**. ((3)) Hotel vehicles: ((4)) **Add vehicle**." }]),
        dots([
          "**A new price is for new requests.** A trip keeps the package and the price it was made with.",
          "**The report**, on top of the same tab: transport income for the period — paid directly, on room bills, and not billed yet.",
        ], true),
      ),
      keep(
        h("More pages you can open"),
        table(["Page", "What it is for"], [
          ["**Hotel QR**", "The QR card guests scan to book a room: scans today, new bookings, waiting to pay. **Show to guest** puts the code on the screen. Only the Admin changes the codes."],
          ["**Meetings**", "The meeting room, Room 102 — booked by time, TZS 100,000 per booking, kept apart from the guest rooms."],
          ["**Daily lists**", "The housekeeping checklist and the in-house guest & breakfast list. **Print** or **Download PDF**."],
          ["**Customers**", "Everyone who has stayed, booked or ordered — the phone number finds them. Their stays and what they owe."],
          ["**Messages**", "The enquiries sent through the contact form of the website."],
          ["**Spin to Win**", "The guests' game: is it running, and the gifts given today. Gifts are a cost of the promotion — not sales. The MD sets it up."],
        ]),
      ),
    ),

    // ───────────────────────── 5
    chapter("Restaurant and bar", "You do not take orders and you do not take payments. You see every order from New to Served, who serves it, how long it waits — and you step in when one is stuck.",
      tour("The restaurant, live", {
        shot: "ck2-m4-rest",
        intro: "Open [[Live]] in the menu.",
        items: [
          "**Restaurant QR**, **Room QR codes**, **Online menu** — the codes customers scan, and the menu they see.",
          "**TO COLLECT** — orders served and not paid yet. | Beside it: all orders, room guests, outside customers, received today, and what went on room bills.",
          "**NEW ORDERS** — waiting to be accepted.",
          "**READY** — cooked, waiting for a waiter. | **PREPARING** and **SERVING** are the two steps around it.",
        ],
        notes: [p("Lower on the page: **No waiter yet** — orders nobody serves; give each one to a waiter from its card — and **Kitchen & bar, live**: every step of every order today, who did it and when.")],
      }),
      keep(
        h("Your decisions on an order"),
        p("Open an order's card. Under **Your decisions** you find what only a manager does:"),
        table(["Decision", "What it does"], [
          ["**Give to a waiter**", "Puts the order in the hands of one waiter — or **Free it for any waiter**. When it moves from another waiter, say why: the reason stays in the order's history."],
          ["**Discount**", "An amount or a percent off this bill — **Why?** late food, regular customer. Waiters serve the orders and receive the money; a discount is yours to give."],
          ["**Change who pays**", "Moves the bill between the restaurant bill and the bill of a staying room. Not this customer's own room? Say why it goes there."],
          ["**Log complaint**", "Writes down a customer complaint — what is wrong, and how urgent: Normal, High or Urgent. It is followed under **Guest requests**."],
        ]),
        tip("The income is counted **once**. An order moved to a room bill is paid at check-out by Reception — it is not counted again in the restaurant."),
      ),
      tour("Waiters", {
        shot: "m4-waiters-c", side: 112,
        intro: "Open [[Waiters]]. Who served which table and room, and what each waiter served — straight from the orders.",
        items: [
          "**Waiters · Tables & rooms** — the same orders, by person or by place.",
          "**ON SHIFT NOW** — the waiters who started their shift. | Beside it: orders served, value served, still going and cancelled.",
          "**NO WAITER** — orders that had nobody.",
        ],
        notes: [p("Each waiter has a card: the orders, their value, and how long food waits between **Ready** and **Served**. Tap a waiter to see their orders one by one.")],
      }),
      keep(
        h("Tables and history"),
        pair(["ck2-m3-rest-tables", { cap: "**Tables** — in use, reserved, free and unpaid. Tap a table for its customer, bill and history." }],
          ["ck2-m3-rest-history", { cap: "**History** — every finished, cancelled and declined order. **Receipt** and **Steps** on each line." }]),
      ),
      rule("An order that waits is a customer who waits. When **New** or **Ready** stays full, walk to the kitchen or the floor — the screen tells you where to go."),
    ),

    // ───────────────────────── 6
    chapter("Money", "Staff see the money of their own shift. You see the whole hotel, for any period: what was earned, what came in, what was spent and who still owes. **Finance** is a department of its own — it holds the money, pays the suppliers and keeps the books. You read everything, you decide on expenses, and you correct what staff recorded. Every correction leaves a trace.",
      keep(
        h("What is yours, and what is Finance's"),
        table(["Money work", "You", "Finance", "MD and Boss"], [
          ["Read the money — Overview, Income, Expenses, Accounts, Who owes us, the ledger", "Yes", "Yes", "Yes"],
          ["Decide on expenses; record an expense; correct or reverse a payment", "Yes", "Yes", "Yes"],
          ["Count the cash of an account", "Yes — a difference waits for Finance", "Yes, and accepts it", "Yes"],
          ["Move money between accounts; the owner's money; corrections", "No", "Yes", "Yes"],
          ["Withdraw money from the nTZS balance", "No", "Yes", "Yes"],
          ["Authorize a purchase price above the budget; verify and pay a supplier invoice", "No", "Yes (above the limit in Settings: Boss or MD)", "Yes"],
          ["Set an opening balance; change a staff discount limit", "No", "No", "Boss and MD only"],
        ]),
      ),
      h("The pages of FINANCE"),
      table(["Page", "What it answers"], [
          ["**Income**", "Every payment received: by account and by source."],
          ["**Expenses**", "Every expense, and the ones that wait for your approval."],
          ["**Accounts**", "The balance of each account in the books: the opening balance, plus the money in, minus the money out."],
          ["**Companies**", "The companies that pay by invoice: what they owe and what is not invoiced yet."],
          ["**Collections**", "Who collected what, into which account, and what is still to collect."],
          ["**Who owes us**", "Guests, meetings and companies with a balance — and what is overdue."],
          ["**Edit history**", "Every change made to a money record: who, when, what."],
          ["**General ledger**", "Every movement of money, line by line. **Export CSV** saves it."],
          ["**Online payments**", "The payments guests make by phone (nTZS). You read it; the MD switches the services on or off."],
        ]),
      p("**Finance's own Home** and **Withdraw funds** are not in your menu: they belong to Finance, the MD and the Boss."),
      tour("The overview", {
        shot: "ck2-m4-fin", w: 84,
        intro: "Open [[Overview]] under FINANCE.",
        items: [
          "**The period** — Today, Yesterday, This week, This month, This year — or two dates and **Show**.",
          "**Earned − Spent = Result** — what the hotel earned in the period, by room nights and food served.",
          "**Came in** — the money that really arrived in the accounts. | **Owed**, beside it: what guests and companies still have to pay.",
          "**Occupancy** — room-nights sold out of all room-nights. | Beside it: average room rate, income per room (RevPAR), nights sold and restaurant orders.",
          "**Day by day** — the chart and the table of each day.",
        ],
        notes: [warn("**Earned is not cash.** A guest who sleeps tonight and pays on Friday is **earned** today and **came in** on Friday. Read both numbers — never only one.")],
      }),
      tour("Expenses and approvals", {
        shot: "m2-n-exp", side: 104,
        intro: "Open [[Expenses]]. An expense at or above the limit set by the MD is not final when staff record it: it waits as **Waiting approval**, and it does not count until somebody decides.",
        items: [
          "**Record expense** — write an expense yourself: what, how much, the type, and the account that paid.",
          "**Waiting approval** — the expense waits for a decision.",
          "**Approve** — one press. The expense counts, with your name.",
          "**Reject** — the system asks you to tell the staff member why.",
          "**Supplier payment** — Finance made this expense when it paid a supplier. It shows **Paid · approved**. | It belongs to the purchase, so it changes only from there: **Edit** or **Cancel** on this line is refused. A line **From purchase P-…** is the same: the expense of a purchase you approved.",
        ],
        notes: [
          p("**Edit** corrects a record — you must say what was wrong with it. **Cancel** takes it out: it stays on the register, struck through and not counted, with your name and reason. A cancelled expense can be put back with **Reinstate**."),
          p("A line **Mobile money charges · nTZS fee — withdrawal …** is the fee nTZS took when Finance withdrew money. It is the only cost of a withdrawal: the withdrawal itself is not income and not an expense."),
        ],
      }),
      keep(
        beside("m2-exp-reject-c", 86,
          h("Before you approve"),
          dots([
            "**Is it real?** The amount, who was paid and what for must be written clearly.",
            "**Is the account right?** Cash, the bank, petty cash — the money left that account.",
            "**Not sure?** Open the line. **Needs correction** sends it back with your note, without rejecting it.",
          ]),
          p("A rejected expense is never counted. The reason you write is what the staff member reads — make it useful: **No receipt — bring it and record again**."),
        ),
      ),
      tour("Income", {
        shot: "ck2-m4-income",
        intro: "Open [[Income]]. Reception and the Counter record the payments — you see all of them.",
        items: [
          "**Record payment** — for a payment that reaches you directly.",
          "**Edit** — corrects the account it was received through, or the transaction reference. | The amount stays the same.",
          "**Reverse** — takes a payment back when it was recorded by mistake. | On a restaurant sale the button says **Cancel**.",
        ],
        notes: [warn("**Never change a payment to make a report look right.** If the money is not there, the record must say so. Every edit and every reversal is kept in **Edit history** with your name.")],
      }),
      tour("Collections", {
        shot: "ck2-m4-coll",
        intro: "Open [[Collections]]. One page for every payment of the hotel, the restaurant and the other sales.",
        items: [
          "**Everything** — the total, and how it splits: hotel, restaurant & bar, other sales.",
          "**INTO WHICH ACCOUNT** — where the money went.",
          "**HOW IT WAS PAID** — cash, mobile money, bank, card.",
          "**STILL TO COLLECT** — open restaurant orders that are not paid.",
          "**ON ROOM BILLS** — orders that will be paid at check-out.",
        ],
        notes: [p("The filters under it — **Served by**, **Recorded by**, source, method and account — answer questions like: what did the Counter collect in cash today?")],
      }),
      tour("Who owes us", {
        shot: "ck2-m4-owes",
        intro: "Open [[Who owes us]].",
        items: [
          "**Total outstanding** — everything that is owed to the hotel today.",
          "**Overdue invoices** — company invoices past their date.",
          "**Statement** — the account of one company, to print or send.",
        ],
        notes: [tip("A guest you allowed to **leave owing** (chapter 3) appears here until they pay. Follow these names every week.")],
      }),
      keep(
        h("Accounts and the general ledger"),
        p("**Accounts** shows what the hotel's records add up to, account by account, one card for each. Check it against the bank statement: it is not read from the bank. Tap a card to open the account (next page)."),
        p("**General ledger** — every movement of money in and out, with the balance after each line. Search, and filter by kind, account, person or period. ((1)) **Export CSV** saves it."),
        shot("ck2-m-ledger", { w: 84 }),
      ),
      tour("An account", {
        shot: "m2-n-acc", side: 88,
        intro: "Open [[Accounts]] and tap an account.",
        items: [
          "**IN THE BOOKS** — what the hotel's records say this account holds: the opening balance, plus the money in, minus the money out. | Check it against the bank statement. It is not read from the bank.",
          "**Record expense** — pay something out of this account. The account is already chosen for you.",
          "**Received today · this week · this month** — and what was paid out this month.",
          "**A line of the account** — here a **Supplier payment** that Finance recorded. Every line says who recorded it.",
        ],
        notes: [
          shot("m2-n-acc-cash", { w: 100, cap: "**A cash account** has one more button: ((2)) **Count**. Type what is really in the cash box. If it is not what the books say, write why — the difference then waits for Finance to accept it. ((1)) **Record expense** is on every account." }),
          p("**Transfers between accounts**, the owner's money and corrections are Finance's work, and so is the **opening balance** — where an account's books begin. Only the Boss or the MD set it, with a reason: it is not income and not a payment. A **withdrawal** from the hotel's nTZS balance, to a phone, a Lipa number or a bank account, is made by Finance, the MD or the Boss. You can read all of it in the ledger."),
        ],
      }),
      rule("**A zero is not a payment.** Unpaid, paid, discounted and owed are four different things. The system keeps them apart — keep them apart when you speak about money too."),
    ),

    // ───────────────────────── 7
    chapter("Stores and purchase requests", "Stock changes only by a movement that somebody recorded: received, used, wasted, counted. The departments ask and report — you approve, receive and count. For buying, every department makes a **purchase request**: you decide on it, Purchasing gets the quotes and makes the orders, and Finance pays the suppliers.",
      tour("Inventory", {
        shot: "ck2-m4-inv",
        intro: "Open [[Inventory]] under STORES. The chips on top change the department: Kitchen, Bar, Restaurant, Housekeeping and the others.",
        items: [
          "**Receive stock** — goods arrived: put them into the store.",
          "**Stock** — every item, with how much there is and what it is worth. | Chips: Out of stock, Low stock, In stock.",
          "**Waste** — what was reported, and what waits for your approval.",
          "**Count** — type what is really on the shelf.",
          "**Needs attention** — the items that are finished or under their minimum.",
        ],
        notes: [p("**Movements** lists everything that came in or went out, with who and why. **Setup** — items, units, minimums, suppliers — belongs to the MD.")],
      }),
      task("Receive stock", {
        when: "Goods arrived that did not come with a purchase order.",
        shot: "m4-inv-recv-c", side: 92,
        intro: "Press [[Receive stock]], and find the item: **Which item came in?** Or tap the item on the **Stock** list and stay on **Receive**.",
        steps: [
          "**Received** — how much came in.",
          "**Cost per kg** — what one unit cost.",
          "**Supplier** — who delivered it.",
          "**Delivery note / invoice** — its number, if there is one. | **Expires on** and **Note** are optional.",
          "Press [[!Receive]]. The stock goes up at once.",
        ],
        notes: [tip("The other tabs of an item: **Use** takes stock out for a reason, **Waste** records waste, **Transfer** moves it to another department, **History** shows every movement.")],
      }),
      task("Count the shelves", {
        when: "At the end of the week or the month — or when a number looks wrong.",
        shot: "m4-inv-count-c", side: 100,
        steps: [
          "**0 counted · 0 different** — the page counts with you as you type.",
          "For each item, type what is on the shelf in the **Counted** box. | **System says** is what the system expects. Leave a box empty and the item stays as it is.",
        ],
        notes: [p("At the bottom of the list press [[!Save count]]."), warn("**Differences are recorded with your name, the reason and the time.** A count is not a way to hide a loss — it shows it.")],
      }),
      keep(
        h("Waste: the cook reports, you approve"),
        p("Staff cannot make stock disappear. They report waste; the stock drops only when a manager approves it."),
        left("k-waste-a", 52,
          p("**The cook** reports it on the kitchen tablet — the picture on the left: how much, the reason, what happened, then **Send to the manager**."),
          shot("m4-waste-wait-c", { w: 68, cap: "**You** open **Inventory → Waste**. ((1)) **Waiting for approval** shows who reported it. ((2)) **Approve** — or ((3)) **Reject**, with the reason." }),
          shot("m5-waste-done-c", { w: 68, cap: "**Approved:** the line moves to **Recent waste** and the stock is lower." }),
        ),
        p("**Reject** asks **Why?** — it was used, not wasted. The stock stays as it was. Waste you record yourself — the button says **Record waste** — counts at once."),
      ),
      keep(
        h("Buying: from the request to the supplier's payment"),
        table(["Step", "Who", "What happens"], [
          ["**1 · Ask**", "A department — or you", "Towels and paper from Reception; food, drinks and equipment from the kitchen and the Counter. No money yet."],
          ["**2 · Review**", "You, or Finance", "**Approve for purchase** with a **budget** (the most it may cost), **Send back** with a note, or **Reject**. Approval is not an expense."],
          ["**3 · Quotes**", "Purchasing", "Gets prices and proposes one. A price above the budget goes to Finance."],
          ["**4 · Authorize**", "Finance", "**Authorize this price**, or send it back. Above the limit in Settings: the Boss or the MD."],
          ["**5 · Order, delivery**", "Purchasing", "Makes the order, records each delivery. Only what was **accepted** goes into the stores."],
          ["**6 · Invoice, payment**", "Purchasing records, Finance pays", "Finance checks the invoice, then pays. **Only this payment is an expense.**"],
        ]),
        p("You do **steps 1 and 2**. Steps 3 to 6 you follow in the history of the request."),
      ),
      tour("Purchase requests", {
        shot: "m2-n-req-queue",
        intro: "Open [[Purchase requests]] under STORES.",
        items: [
          "**To review** — new requests that wait for a yes or no.",
          "**To buy** — approved, not bought yet. | They wait for Purchasing's quotes — or for you, on your own route (below).",
          "**Being bought** — a purchase you started and saved, not sent yet.",
          "**To approve** — bought straight away; the purchase waits for the final check.",
          "**Spent on stock** — today and this month, from the expenses of approved purchases. | The same money the ledger shows, never added twice.",
          "**Shopping list** — everything approved and not yet bought. | **Copy** and **WhatsApp** send it.",
          "**A request** — tap it to open it. **Your turn** marks the ones that wait for you.",
        ],
        notes: [p("The person who asked sees seven words only: **Submitted**, **More information needed**, **Approved**, **Purchased**, **Completed**, **Rejected** and **Cancelled**. You see the real step: **Waiting for review**, **Approved — to buy**, **Ordered — waiting for delivery**, **Delivered — invoice and payment to finish**, **Done**.")],
      }),
      task("Review a request", {
        shot: "m2-n-req-review", side: 80,
        intro: "Tap the request. Read who asks, for which department, the reason, the estimate, and every line: **Asked** and **Approved**.",
        steps: [
          "**Approved budget (TZS)** — the most it may cost. | It is filled with the estimate. Change it, or leave it empty for no limit. A price above it comes back to Finance.",
          "[[!Approve for purchase]] — it may be bought. | It is saved at once. The request turns to **Approved — to buy** and Purchasing gets the quotes.",
          "**Change** — change an amount first. | The system asks for the reason.",
          "**Send back** — **What should they change?** Say how many kg.",
          "**Reject** — **Why?** We still have enough in the store.",
        ],
        notes: [
          p("After approval a **Shopping list** appears, with **Copy**, **WhatsApp** and **Print or save the list**."),
          warn("Above the limit set in **Settings**, only the Boss or the MD may approve. When the hotel keeps approvals apart, you cannot review your own request."),
        ],
      }),
      task("Follow a request to the end", {
        shot: "m2-n-req-follow", side: 70,
        intro: "Open any request, whatever its step. You read its whole story; you cannot change it after the review.",
        steps: [
          "**The status** — the real step. Here: **Delivered — invoice and payment to finish**.",
          "**Budget approved by Finance** — the most the request may cost.",
          "**The order** — the purchase order, the day it is expected, and how much of each line arrived.",
          "**History** — every step with the name of the person: the approval, the quotation, the order, each delivery, each invoice, a dispute.",
        ],
        notes: [
          warn("A request is not an expense. An approval is not a payment. An order is not a delivery. **One expense appears for each payment to a supplier, and only when Finance really pays.** Prices and invoices are for Purchasing and Finance; you read the money in **Expenses**."),
        ],
      }),
      keep(
        h("Your own route: buying straight away"),
        p("When you or a staff member buys the goods at once — at the market, for example — use **Record the purchase** on an approved request. It works only while Purchasing has no quote on the request. After a quote is proposed the request is ordered from the supplier, and the button is refused. The purchase then waits for a final approval; that one approval adds the stock and records **one** expense."),
        shot("m2-n-req-approved", { w: 46, cap: "**An approved request** waits for Purchasing's quotes — or for you. ((1)) **Record the purchase** is your direct route. ((2)) **Change**, ((3)) **Reject**." }),
      ),
      task("Record the purchase", {
        when: "The goods are bought and the receipt is in your hand.",
        shot: "m5-buy-form-c", side: 74,
        intro: "Open the request and press [[Record the purchase]]. Enter what the receipt says.",
        steps: [
          "**Bought** — how much was really bought. | Put 0 for anything that was not bought.",
          "**Price** — what one kg or one unit cost. The **Line total** is calculated. | An item that tracks expiry also asks for the **Expiry date on the pack**.",
          "**Bought from** — choose the supplier. | Not on the list? **Someone else — type the name**.",
          "**Receipt photo or PDF** — press **Add the receipt**, and type the **Receipt number** as printed. | No receipt? **There is no receipt** — and write why: market seller gives no receipts.",
          "**Paid from** — the company account that paid.",
          "Press [[!Send for final approval]]. | **Save** keeps an unfinished purchase: finish it when you have the receipt.",
        ],
        notes: [p("**ACTUALLY PAID**, at the bottom, adds the lines up. After you send it the request says **Bought — waiting for approval**.")],
      }),
      task("The final approval", {
        shot: "m5-final-c", side: 84,
        intro: "Open the request under **To approve**. Compare it with the receipt before you press anything.",
        steps: [
          "**TOTAL PAID** — every line: asked, approved, bought, the price and the total.",
          "**RECEIPT** — the receipt that was added, or the reason there is none.",
          "**Kind of expense** — where the expense belongs: Food & kitchen, Bar & drinks, Housekeeping & laundry…",
          "Press [[!Approve purchase]]. | The button shows the amount.",
          "**Send back for correction** — when something is wrong. | **What to correct?** The receipt shows 8 kg, not 9.5.",
        ],
        notes: [warn("Above the limit set in **Settings**, only the Boss or the MD give the final approval of a purchase. When the hotel requires a different approver, the person who bought cannot give it: **You bought this — another manager (or the MD) gives the final approval.**")],
      }),
      shot("m5-final-sure-c", { w: 78, cap: "**The last question.** Approving **adds the stock and records ONE expense**, paid from the account you see — it cannot be undone here. ((1)) **Yes, approve the purchase**." }),
      keep(
        shot("m2-n-req-done", { w: 78, cap: "**Finished.** The request is **Done** and moves to **Finished**. **Spent on stock** shows the money of today and of this month." }),
      ),
      keep(
        h("Assets"),
        beside("ck2-m4-assets", 100,
          p("Open [[Assets]]. Furniture, equipment and electronics — kept apart from the stock that gets used up."),
          dots([
            "((1)) **Needs attention** — what is under repair, poor or damaged.",
            "((2)) **Under repair** — how many.",
          ]),
          p("You see every asset, where it is and its state. Adding, moving and disposing of assets is the MD's work. An asset out of order in a guest room also shows on **Home**, under **Maintenance**."),
        ),
      ),
      rule("Approve what you have seen. A waste report, a shopping list, a receipt — look at the thing itself before you press. Your name is on it afterwards."),
    ),

    // ───────────────────────── 8
    chapter("People and shifts", "Every receptionist and every waiter opens a shift, works and closes it. You plan who works the front desk, see who is on shift now — and close a shift that somebody forgot.",
      tour("Reception shifts", {
        shot: "ck2-m4-shifts",
        intro: "Open [[Shifts]] under PEOPLE. Up to two receptionists work the desk together. The hotel day turns at 04:00.",
        items: [
          "**AT THE DESK** — who is on shift now, and since when. | **Free place**: a second receptionist can start.",
          "**PREVIOUS SHIFT** — who worked before, and when it ended.",
          "**MONEY TO COLLECT** — what guests in the hotel still owe. | The list under it names each room — it is saved in the handover when a shift ends.",
          "**All staff shifts** — reception and restaurant together.",
        ],
        notes: [p("**SCHEDULED TODAY** and **TOMORROW** show who is planned. Managers, the MD and the Boss never work a reception shift themselves.")],
      }),
      keep(
        h("Plan who works"),
        pair(["m-shifts-sched", { cap: "**Schedule** — one box for each of the next days. Choose **Asha**, **Neema**, **Rehema** or **Nobody**. The dots show: worked, not as scheduled, no shift." }],
          ["m-shifts-rota", { cap: "**Plan the rota** — tick the receptionists in the order they rotate, set the starting date and the days, and press **Generate**. **Swap two days** exchanges two dates." }]),
        dots([
          "**Replace days already scheduled** — tick it only when the new rota must overwrite what you chose by hand.",
          "**The last 7 days — scheduled and worked** opens under the schedule: who was planned, and who really worked.",
        ], true),
      ),
      keep(
        h("One shift"),
        beside("m-shift1-top", 104,
          p("Under **Shifts worked**, press **Shift** to open a shift, or **Report** for the report that was made when it ended."),
          dots([
            "**The header** — who, which shift, from when to when, and who closed it.",
            "**HANDOVER NOTE** — what the receptionist wrote for the next one.",
            "**COLLECTED** — the money of this shift, by method and by source. **See every payment** lists them.",
            "**Check-ins, check-outs, bookings, room changes, expenses** — the work of the shift in numbers.",
            "**What was done** — every action, newest first.",
          ]),
        ),
      ),
      task("Close a shift that was left open", {
        when: "Somebody went home without closing their shift.",
        shot: "m4-shift-close-c", side: 96,
        intro: "Open the shift — from **Shifts**, or from **Staff shifts → On shift now** — and press [[Close this shift]]. Do it only when they cannot close it themselves.",
        steps: [
          "**Why?** — write the reason: left at 15:00 without closing the shift. | It is kept on the shift and in the history, with your name.",
          "Press [[!Close the shift]]. | The handover lists what they collected and who still owes.",
        ],
        notes: [warn("Close only a shift that is really over. The shift report is made the moment it closes, **once** — with the money and the work up to that minute.")],
      }),
      tour("Staff shifts", {
        shot: "ck2-m4-shifts-all",
        intro: "Open [[Staff shifts]]. Who is working now, and every shift that ended — with the report made automatically for each.",
        items: [
          "**ON SHIFT NOW** — reception and waiters with an open shift. | Beside it: ended today, reports sent to the Boss, and messages that failed.",
          "**The filters** — Everyone, Reception, Restaurant; 7, 30 or 90 days; one person.",
          "**Shift** — opens the shift.",
          "**Report** — opens its report.",
        ],
      }),
      tour("Activity", {
        shot: "ck2-m4-activity",
        intro: "Open [[Activity]]. Who did what, and when. Every important action is recorded with the values before and after.",
        items: [
          "**Staff member** — one person, between two dates.",
          "**Area** — one part of the system: bookings, payments, rooms, the restaurant…",
        ],
        notes: [tip("Questions like **who changed this price?** or **who cancelled that order?** are answered here in a minute. Look before you ask the staff.")],
      }),
      rule("Nobody shares an account. Each person signs in with their own name — that is why the system can tell you who did what."),
    ),

    // ───────────────────────── 9
    chapter("Reports", "Nobody writes a report at Vegas. The system makes them — after every shift, every day, every week and every month — keeps them, and sends them to the Boss on WhatsApp. You open, read, print and share them.",
      keep(
        h("Which report, when"),
        table(["Report", "Made", "Where"], [
          ["**Shift report**", "The moment a shift is closed.", "**Staff shifts** → **Report**."],
          ["**Daily business report**", "Every day at 07:00, for the hotel day that closed at 04:00.", "**Daily reports**."],
          ["**Daily room report**", "Every morning, before the business report.", "**Daily reports** → **Daily room reports**."],
          ["**Weekly report**", "Every Monday, for the week before.", "**Weekly & monthly**."],
          ["**Monthly report**", "On the 1st, for the month before.", "**Weekly & monthly**."],
          ["**Business summary**", "Live, for any period you choose.", "**Reports**."],
        ]),
      ),
      tour("Daily reports", {
        shot: "m4-daily-c",
        intro: "Open [[Daily reports]] under INSIGHTS.",
        items: [
          "**Today's report is ready** — press it to open the report of the day.",
          "**Daily room reports** — the rooms, one by one, for each day.",
          "**One line for each day** — its revenue, what was collected, and whether it was sent.",
        ],
      }),
      tour("One daily report", {
        shot: "ck2-m4-dailyrep",
        items: [
          "**Print** — on paper, A4.",
          "**PDF** — saves the report as a file.",
          "**Share** — gives you the link of the report.",
        ],
        notes: [
          p("The tiles: **Income**, **Expenses**, **Net profit**, **Money received**, **Still owed** and **Occupancy**. Under them **ATTENTION REQUIRED** — the things of the day that need somebody — and **THE DAY IN PLAIN FACTS**. A report that shows **Not sent yet** has the button **Send now**: it sends the summary to the Boss."),
          warn("A report that was made is **never rewritten**. If a number was wrong, correct the record (chapter 6) — the correction shows in the next report and in **Edit history**."),
        ],
      }),
      tour("Business summary", {
        shot: "ck2-m-reports",
        intro: "Open [[Reports]]. Choose the period; the tabs choose the subject: Whole business, Daily sales, Restaurant & bar, Best sellers, Payments, Outstanding, Tables, Rooms, Staff, Cancellations, Expenses, Stock & waste.",
        items: [
          "**Print** — the report on paper.",
          "**PDF** — saves it as a file.",
          "**Share** — sends it on. | **Excel (CSV)**, beside it, opens the numbers in Excel.",
        ],
      }),
      tour("Weekly and monthly", {
        shot: "ck2-m4-staffrep",
        intro: "Open [[Weekly & monthly]].",
        items: [
          "**Weekly reports** — one for every week, made on Monday.",
          "**Monthly reports** — one for every month, made on the 1st.",
        ],
        notes: [p("On top, the cards **THIS WEEK** and **THIS MONTH** open the business and the team so far. Lower on the page: **Each person**, and **Latest shift reports** — the report of each shift that ended.", "Open, print or download any of them. The Boss receives each one on WhatsApp with its link.")],
      }),
      rule("Read the daily report every morning before you talk to the staff. It tells you what happened; your day is about why."),
    ),
  ],

  rules: [
    ["You watch and you decide", "Reception, the waiters, the kitchen and the Counter do the routine work. You step in when something waits, and when a decision is needed."],
    ["Every decision has a reason", "Close a room, a discount, a free night, leave owing, a rejection: write the real reason. It is kept with your name and the time."],
    ["Approve what you have seen", "Look at the waste, the list, the receipt — then press. An approval is your signature."],
    ["A discount has a limit", "The limit is set for each room type — as it is now, the Twin room 40,000 and the other rooms 20,000. Only the Boss or the MD change it. More than that is their decision."],
    ["Earned is not cash", "Earned today, came in today and still owed are three numbers. Read all three."],
    ["Never repair a report", "A wrong number is corrected on the record, with the reason. Reports that were made stay as they are."],
    ["Stock moves only by a record", "Received, used, wasted, counted. Nothing leaves the store without one of these."],
    ["One payment, one expense", "A request, an approval and an order are not expenses. An expense is made only when a supplier is really paid — by Finance, or by your final approval of a purchase you bought straight away. Never record it again by hand."],
    ["Close a shift only when it is over", "The shift report is made once, at the moment of closing."],
    ["Set-up is the MD's, money work is Finance's", "Rooms, prices, the menu, tables and QR codes, staff accounts and settings are the MD's. Paying suppliers, withdrawals and opening balances are Finance's, the MD's and the Boss's. Ask them — do not work around it."],
  ],

  problems: [
    ["**Needs your attention** is long and red.", "Tap the tabs one by one. Start with **Front desk** and **Restaurant** — guests are waiting there. Most lines need a word to the right person, not your own work."],
    ["A guest is still in the room after the check-out time, or somebody forgot to close their shift.", "Guest: open the room. With Reception: check them out, add nights — or give **Free late checkout** if you agree to it. Shift: **Staff shifts** → open the shift → **Close this shift**, with the reason."],
    ["A guest wants to leave and cannot pay everything now.", "Open the room → **Let leave owing**, with the reason. Reception can then check them out. Follow the name under **Who owes us**."],
    ["A room is clean but still shows **Needs cleaning**, or a closed room is repaired.", "Clean: open the room and press **Confirm clean & ready**. Repaired: open the room → **Open room again** → **Fixed — ready now**, or **Fixed — clean it first**."],
    ["The discount I want is bigger than the limit.", "The limit is set for each room type by the Boss or the MD. Ask them to decide."],
    ["An order sits under **No waiter yet**.", "Open its card → **Give to a waiter**. Then ask why nobody took it."],
    ["A payment was recorded on the wrong account, or twice.", "Wrong account: **Income** → **Edit** on the line, choose the right account and say what was wrong (the amount stays). Twice: **Reverse** (or **Cancel** on a restaurant sale), with the reason — the line stays on the register, struck through."],
    ["The stock on the shelf is not what the system says.", "**Inventory → Count**: type what is there and save. Then look at **Movements** to understand the difference."],
    ["I approved a purchase request by mistake.", "Open it and press **Reject**, with the reason. It works until the goods are ordered or bought. An approval is only permission: no money and no stock moved."],
    ["A purchase request waits too long.", "Open it and read its history. **Approved — to buy** for days means Purchasing has no quote yet. **Waiting for Finance to authorize the price** is for Finance. Ask the right person."],
    ["An expense says **Supplier payment** and I cannot change it.", "Finance made it when it paid the supplier. It changes only from the purchase — ask Finance."],
    ["Today's daily report is not there yet.", "It is made at 07:00 for the day that closed at 04:00. Before that, **Home** and **Finance → Overview** show today live."],
    ["I cannot find a page that the MD has.", "Staff & roles, room pricing, the menu, the website and the control centre are the MD's. Finance's Home, Withdraw funds and Procurement are for Finance, Purchasing, the MD and the Boss. It is not a fault."],
    ["The screen shows an error, or a number looks impossible.", "Take a picture of the screen and send it to Nino on WhatsApp — the number is at the bottom of every page."],
  ],
};
