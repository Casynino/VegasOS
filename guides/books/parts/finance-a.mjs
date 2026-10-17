// The first half of the Finance book (chapters 1–5 and 'Reading the numbers'): the role, the Home, the jobs waiting, money in, money out, the accounts.
// The main file (guides/books/finance.mjs) puts these chapters round the ones of the other author (parts/finance-b.mjs).
import { chapter, task, tour, tip, warn, rule, p, h, dots, table, beside, shot, keep, render } from "../../tools/kit.mjs";

// Like keep(), but the blocks may run on to the next page (a long table).
const flow = (...blocks) => (c) => render(c, blocks);

const GAP = '<div style="height:5mm"></div>';

// ───────────────────────────────────────────── 1 · Your role and your Home ─────────────────────────────────────────────
export const role = chapter(
  "Your role and your Home",
  "Finance is the hotel's money desk. You see every account, you decide on what the departments ask to buy, you pay the suppliers and you keep the books in order. This chapter shows who you are in the hotel, how you sign in, your menu and your Home — one page, part by part.",

  keep(
    h("Who Finance is"),
    p("You see **every payment, every expense, every account** and everyone who still owes the hotel. You **review** what the departments ask to buy, **authorize** a price that is above the budget, **verify** the supplier's invoice and **pay** it. You **record expenses** and you **take money out of the nTZS balance**."),
    p("You do not run the front desk, the restaurant or the stores, and you do not set up the system. Your role is **Finance**. The role called **Accountant** is something else: it is **Purchasing**, the person who gets the quotes and makes the orders — and never approves or pays."),
    table(["", "Finance", "Purchasing", "Manager", "Boss and MD"], [
      ["Read every account, the ledger and who owes", "**Yes**", "No", "Yes, read only", "Yes"],
      ["Record a payment, an expense, a company invoice", "**Yes**", "No", "Yes", "Yes"],
      ["Approve an expense that waits", "**Yes**", "No", "Yes", "Yes"],
      ["Review a purchase request, give it a budget", "**Yes**", "No", "Yes", "Yes"],
      ["Get quotes, order, record deliveries and invoices", "**Yes**", "Yes", "No", "Yes"],
      ["Authorize a price above the budget", "**Yes**, up to the limit", "No", "No", "Yes — above the limit only they"],
      ["Verify and pay a supplier invoice", "**Yes**", "No", "No", "Yes"],
      ["Withdraw money from nTZS", "**Yes**", "No", "No", "Yes — only they settle one by hand"],
      ["Money movements, accepting a cash count, corrections", "**Yes**", "No", "No, read only", "Yes"],
      ["Set the limits, the discount limits, an opening balance", "No", "No", "No", "**Only the Boss and the MD**"],
      ["Check guests in and out, take orders", "No", "No", "No", "Not their work either"],
    ], "plain"),
  ),
  rule("**Finance records and decides — it never invents.** Every line you record carries your name and the time. Every correction carries the reason. A number that cannot be proved is not written."),

  tour("Signing in", {
    shot: "fa-signin", side: 80,
    intro: "Open the hotel's staff page on a computer, a tablet or a phone. The sign-in page is the same for the whole hotel.",
    items: [
      "**Email** — your own email address, the one the administrator gave you.",
      "**Password** — your own password. Nobody else knows it, and nobody else uses your account.",
      "Press [[!Sign in]]. | Your page opens by itself for your role. For Finance it is your **Home**.",
    ],
    notes: [p("**Forgot your password?** Ask the hotel administrator — the page says so. The system keeps your name on everything you do, which is why an account is never shared."), tip("On a phone the same page opens in a narrow form (see the picture of the Home on a phone, further on).")],
  }),

  flow(
    h("Your menu, group by group"),
    p("The menu is on the left on a computer, and under the **Menu** button on a phone. You see only the groups and pages you may use. The picture of the menu is on the next page."),
    table(["Group", "Items", "What they are for"], [
      ["**FINANCE**", "Overview · Income · Expenses · Accounts", "The period at a glance · every payment received · every expense, to record or approve · the accounts and their balances."],
      ["", "Companies · Collections · Who owes us", "Firms that pay by invoice · what each person collected · everyone who owes the hotel, and how late."],
      ["", "Edit history · General ledger", "Every change made to a money record · every movement of money, line by line."],
      ["", "Withdraw funds · Online payments", "Money from nTZS to a phone, a Lipa number or a bank · what guests paid online."],
      ["**BOOKINGS**", "Stays · Calendar · Hotel QR", "To find the booking behind a payment. You read them; Reception works them."],
      ["**HOTEL SERVICES**", "Spin to Win", "The gifts given to guests. You read it."],
      ["**STORES**", "Assets · Inventory", "What the hotel owns and what its stock is worth. You read them."],
      ["", "Procurement · Purchase requests", "Quotes, orders, deliveries, invoices and payments · the requests of the departments."],
      ["**PEOPLE**", "Shifts · Staff shifts", "The money of every shift and the report of each shift that ended."],
      ["**INSIGHTS**", "Reports · Daily reports · Weekly & monthly", "The business summary · the report of each day · the weekly and monthly reports."],
      ["**SETTINGS**", "Customers · Room pricing", "Who has stayed, booked or ordered · the room prices. The limits in Room pricing are changed only by the Boss and the MD."],
    ],),
    p("On top of every finance page there is a **row of tabs**. It has the same pages as the menu, and a few more that are only there: **Room performance** (for each room type: room income, nights sold, average rate, occupancy and the best room), **Staff activity** (what each staff member did and the money they handled — you read it, you do not change it), **Invoices**, **Purchases**, **Discounts**, **Price control** and **Refunds and corrections**."),
  ),

  tour("The Finance menu", {
    shot: "fa-menu", side: 46,
    intro: "These are the places you will use most. The numbers are on the picture.",
    items: [
      "**Home** — your one-page Home, always at the top.",
      "**Overview** — the first item of **FINANCE**: the older page of the period (earned, spent, result).",
      "**Withdraw funds** — taking money out of nTZS. Only Finance, the MD and the Boss see it.",
      "**Procurement** and **Purchase requests** — under **STORES**: the purchases you authorize and pay. A red number says how many requests wait.",
      "**Daily reports** — under **INSIGHTS**, with **Reports** and **Weekly & monthly**.",
    ],
    notes: [
      p("**Your Home** is one page, from top to bottom, with no tabs. It opens on **This month**. The next pages show it part by part, in the order you read it. The same page opens on a phone — there the parts sit one under the other. The banner always speaks about **today**; everything under it follows the period you choose."),
    ],
  }),

  tour("Home · the top", {
    shot: "fa-h-top",
    items: [
      "**The banner** — greets you and says three things about **today**: how many guest rooms are occupied, the money received and the money still owed to the hotel. | These three never change with the period below.",
      "**Quick links** — the jobs you do every day: Purchases, Expenses, Income, Who owes us, General ledger, Reports. | A coloured number says how many things wait there.",
      "**Jump to** — small links. Press one and the page scrolls to that part. | The Home is long; this is the quickest way.",
    ],
  }),
  tour("Home · Needs your attention", {
    shot: "fa-h-needs",
    items: [
      "**NEEDS YOUR ATTENTION** — everything that waits for Finance now. | The number beside it counts the cards.",
      "**The tabs** — **All**, and one tab for each kind: Purchases, Money owed, Expenses… | A tab appears only when it has a card.",
      "**A card** — what it is, how many and how much. Press it to open the page where you act. | The coloured bar says how serious it is: red is money at risk, amber is a decision for you.",
      "**Scroll for more** — the box shows three cards. Scroll inside it for the others.",
    ],
    notes: [p("The next chapter explains every kind of card and where it leads.")],
  }),
  tour("Home · The money", {
    shot: "fa-h-money",
    cols: 3,
    items: [
      "**The money** — the dates of the period you are looking at. The Home opens on **This month**.",
      "**The period buttons** — Today, Yesterday, This week, This month, This year. | Everything under the banner follows them.",
      "**Two dates and Show** — any period you want, for example the first week of a month.",
      "**Earned** — what the hotel earned: room nights stayed, food and drinks served. | Before anyone paid.",
      "**Received** — the money that really came in, less refunds.",
      "**Expenses** — what was recorded as spent. | The line says how many wait for approval. A waiting expense is not in the total.",
      "**Net result** — Earned minus Expenses. | Not a profit while some costs are not recorded.",
      "**Still owed** — what is unpaid **right now**. | It does not follow the period.",
      "**Bookings made** — new bookings in the period, and how many rooms checked in.",
    ],
    notes: [
      p("The green or red arrow on a tile compares it with the period before (“none in the previous period” when there is nothing to compare). The small line is the day-by-day shape of the period. Press a tile to open the page behind it."),
    ],
  }),
  tour("Home · What stands out", {
    shot: "fa-h-stands", w: 92,
    items: [
      "**What stands out** — a few plain sentences, written from the figures on the page.",
      "**Read from the figures below — nothing is guessed.** | Under it, the dates the sentences are about.",
      "**A sentence** — the little sign shows how serious it is: red, act now; amber, watch it; blue, good to know; green, good news. | Some sentences open the page that explains them.",
    ],
    notes: [p("When there is too little to say, a sentence is simply not written — and the whole box can be missing. That is normal. The chapter **Reading the numbers** explains each sentence and what to do about it.")],
  }),
  tour("Home · Where the money is", {
    shot: "fa-h-accounts", w: 86,
    items: [
      "**Where the money is** — what the hotel's own records add up to. Check it against the bank.",
      "**Accounts** — opens the Accounts page.",
      "**The ring** — all the accounts together, with the split into cash, banks and mobile money.",
      "**One card per account** — its name, the amount **in the books**, its share of the whole and what moved today.",
      "**Withdraw funds** — on the nTZS card: starts a withdrawal.",
    ],
    notes: [
      p("Amounts are written in full — TZS 1,885,000, never “1.9M”. **In the books** means: opening balance + money in − money out. It is the hotel's record, not the bank's."),
      p("The guests' unpaid bills are part of **Still owed**. On the Boss's, the MD's and the Manager's Home, every room in use says in coloured words how its bill stands: **Paid**, **Not paid** (with the amount still owed), **Part paid**, **Group pays**, **On company invoice**, **Overpaid** or **Nothing due**. A bill on a company invoice is never called Paid — the company still owes it."),
    ],
  }),
  tour("Home · Money in and out", {
    shot: "fa-h-flow", w: 80,
    items: [
      "**Money in and out** — what was earned, what came in and what went out. | **Ledger** opens the general ledger for these days.",
      "**Day by day** — for each day a bar for what was **earned** and one for what was **spent**; the line is what was **received**.",
      "**Where income comes from** — the earned money split into Rooms, Restaurant & room service, Bar, Meeting room, Transport & other.",
      "**How the money came in** — the money received, by way of paying (cash, bank transfer, mobile money) and by account.",
      "**Where the money went** — expenses by group, the biggest first. | A line under it says how many more expenses wait for approval.",
    ],
  }),
  tour("Home · Cash outlook (1)", {
    shot: "fa-h-outlook",
    items: [
      "**Cash outlook** — what the money looks like from here.",
      "**In the accounts** — what the hotel's records say the accounts hold.",
      "**Owed to the hotel** — what is unpaid, and how much of it is more than a week late.",
      "**Owed to suppliers** — supplier invoices not paid in full, and what is past its due date.",
      "**Days the money lasts** — how many days the accounts would pay for at the recent pace of spending. | Needs at least 7 days of records.",
      "**Who owes the hotel — how late** — not late yet, 1–7 days, 8–30 days, more than 30. | A guest's bill is due the day they leave, a company's on its due date.",
      "**What the hotel owes — when it falls due** — past its date, within a week, 8–30 days, later, no date.",
      "**Next to pay** — the supplier invoices to pay first: who, the due date (“late” in red) and the amount. | A disputed invoice is marked.",
    ],
    notes: [
      p("The four boxes are side by side and **never added together**: what is owed to the hotel is not money yet, and what is owed to suppliers is not yet spent."),
      p("**Under them** come four more boxes: **How fast the money goes** (the average spent in a day over the last 30 **closed** days — today is left out — the total, and what waits for approval; only recorded costs count) · **Rooms booked ahead** (nights already booked in the next 30 nights, and the room income on the books: money still to be earned, not received) · **Who owes the hotel** (guests, companies, the meeting room, the restaurant; the company invoices overdue, due today and due this week; the companies owing the most) · **Cash** (the cash taken in the period and where it came from: the front desk, the Restaurant Counter, other sales)."),
    ],
    w: 86,
  }),
  tour("Home · Purchases, discounts and online payments", {
    shot: "fa-h-purchases", w: 66,
    items: [
      "**The heading** — **Procurement** opens the purchases.",
      "**Purchases and suppliers** — five steps, each its own figure: **Asked for** (estimates), **Approved** (budgets), **Ordered**, **Invoiced**, **Paid**. | A request is not an expense and an approval is not a payment. Beside them: what is still owed to suppliers, and what is past its due date.",
      "**Discounts and refunds** — room discounts, restaurant discounts and refunds. | **Discounts** opens the page that says who gave them.",
      "**Online payments** — paid, waiting and not completed. | A red line appears when one needs a person.",
    ],
  }),
  tour("Home · How the hotel is doing (1)", {
    shot: "fa-h-trends1", w: 78,
    items: [
      "**How the hotel is doing** — occupancy, rates, six months, what moved against the period before, which days earn most.",
      "**The key figures** — eight figures, each against the period before: **Occupancy**, **Nights sold**, **Average room rate**, **Income per available room**, **Average restaurant order**, **Spent of what was earned**, **Room discounts**, **Cash of the money received**.",
      "**Occupancy** — rooms sold out of rooms available (31 of 403 room nights, in the picture).",
      "**Spent of what was earned** — recorded expenses against what was earned, in percent.",
    ],
  }),
  tour("Home · How the hotel is doing (2)", {
    shot: "fa-h-trends2", w: 72,
    items: [
      "**The last six months** — month by month: earned, spent and received, with the table under it. | The first month starts when the hotel's records began.",
      "**Occupancy** — the share of the guest rooms sold, night by night, over the period.",
      "**Which days earn most** — the average earned on each day of the week over the last 8 weeks; the best day is marked. | Needs at least 14 closed days.",
    ],
    notes: [p("Under them: **Income against the period before** (what each part of the business earned, the change in TZS and in percent — “new” means there was nothing before) and **Expenses against the period before** (each kind of cost, its share and its change).")],
  }),
  keep(
    h("The last parts of the Home"),
    table(["Part", "What it shows"], [
      ["**Bookings**", "How many bookings were made, what became of them, and where they came from: six numbers (bookings made, check-ins, check-outs, cancelled, no-shows, in the house now), the bookings made each day, and a table **By booking channel** — Phone, Website, WhatsApp, Corporate… arrived, still to come, cancelled, no-show. **Stays** opens the list."],
      ["**The latest**", "**Latest money in**: when, for which booking or invoice, how it was paid, the amount (guests' names are not shown; the reference is enough to find them). **Latest expenses**: when, what, by whom, the amount — a supplier payment names its invoice and order, an nTZS fee names its withdrawal."],
      ["**The business in detail**", "The part that loads last. A strip of figures (occupancy, average room rate, income per room, nights sold, restaurant orders, discounts and refunds), then Day by day, Income by source, Where the money went and came in, **Rooms by type**, **Guests & bookings**, **Restaurant & bar** (best sellers, room bills, what is not yet paid), **Best customers**, **Coming up** and **How guests pay**. They are the same figures as above, in more detail."],
    ], "plain"),
  ),
  beside("fa-h-phone", 56,
    h("Your Home on a phone"),
    dots([
      "The same page, with the parts one under the other.",
      "**Quick links** and **Jump to** slide sideways: touch and pull them.",
      "The **Needs your attention** box shows three cards at a time; scroll inside it.",
      "Tables become cards, and wide tables slide sideways.",
      "The **EN · 中文** switch at the top changes the language of your own screen.",
    ]),
    p("Use the phone to look and to approve. For a long job — recording a purchase, reading the ledger — a computer is easier."),
  ),
  rule("**Earned, received, still owed and the balance of an account are four different things.** They sit side by side on the Home and are never added together."),
);

// ───────────────────────────────────────────── 2 · The jobs waiting for you ─────────────────────────────────────────────
export const needs = chapter(
  "The jobs waiting for you",
  "The box “Needs your attention” on your Home is your list of work. A card is made by the system when something waits for Finance — and it goes away by itself when the work is done. This chapter explains every card and where it leads.",

  keep(
    h("How the list works"),
    dots([
      "**Made from the records.** A card is not a message that somebody sent: the system looks at the records and makes it. When you do the work, the card is gone.",
      "**Most serious first.** Red cards are money at risk. Amber cards are decisions that wait for you. Blue and grey cards are good to know.",
      "**Only your cards.** You see a card only when you may open its page and act. The Boss and the MD see their own list on their own Home.",
      "**The bell is different.** The red number on the bell counts new messages (a purchase to authorize, an invoice to verify). The cards stay on the Home until the work is done.",
      "**When nothing waits** you read “Nothing is waiting for Finance”. Then you are clear.",
    ]),
  ),

  flow(
    h("Every card, and where it leads"),
    table(["The card says", "What it means", "It opens", "What you do"], [
      ["**… purchase prices waiting for you to authorize**", "Purchasing found a price above the approved budget (or there was no budget).", "Procurement, **With Finance**", "Authorize the price, or send it back with a note."],
      ["**… supplier invoices to verify**", "Purchasing recorded an invoice; nobody has checked it yet.", "Procurement, **Invoices and payment**", "Compare it with the order and the delivery. **Verify** it or **Dispute** it."],
      ["**… supplier invoices verified, to pay**", "The invoice is right and waits for the money.", "Procurement, **Invoices and payment**", "**Record payment**: the account, the date, the reference."],
      ["**… supplier invoices past their due date**", "The date on the invoice has passed and it is not paid.", "Procurement, **Invoices and payment**", "Pay it, or call the supplier."],
      ["**… supplier invoices disputed**", "You said the invoice is wrong. It waits for the supplier to correct it.", "Procurement, **Invoices and payment**", "Wait for the corrected invoice; ask Purchasing to chase it."],
      ["**… cash counts with a difference to settle**", "A count of an account was different from the books.", "Accounts", "Read the explanation, then accept the count (with or without a correction)."],
      ["**… expenses waiting for approval**", "An expense at or above the limit was recorded and nobody has decided.", "Expenses, **Waiting approval**", "Approve it, send it back, or reject it with a reason."],
      ["**… company invoices overdue**", "A firm did not pay by the date on its invoice.", "Who owes us", "Remind the firm. Send the statement."],
      ["**… left without paying in full**", "Guests who checked out and still owe the hotel.", "Who owes us", "Follow each one with Reception or the Manager."],
      ["**… guests due to leave still owe**", "Guests who leave today (or should have left) and have not paid. A stay a company pays for is not counted.", "Stays, **Owes money**", "Tell Reception. Finance does not check anyone out."],
      ["**… online payments need a person**", "Money came in by nTZS that does not fit a bill.", "Online payments, **Needs a person**", "Refund it, record it by hand or put it on the right bill — then write what you did."],
      ["**… withdrawals not confirmed**", "A withdrawal was sent and nTZS never said whether it went through.", "Withdraw funds", "Do not send another. Follow the chapter **Withdraw funds**."],
      ["**The last daily report did not reach the Boss**", "The report was made, the WhatsApp message failed.", "The report", "Open it and send it again."],
      ["**Yesterday's daily report was not made**", "It is normally ready at 07:00.", "Daily reports", "Open the page. If it is still missing, tell the MD."],
      ["**… is below zero**", "An account's book balance is under zero (up to three are shown).", "That account's page", "Look for a payment that went out before the money came in, or a movement that was not recorded."],
    ],),
    p("The groups on the tabs are **Purchases**, **Cash**, **Expenses**, **Money owed**, **Online payments**, **Reports** and **Accounts**."),
  ),

  shot("fa-need-exp-c", { w: 68, cap: "**Expenses waiting.** The card opens the list already filtered to **Waiting approval**. ((1)) the badge on the line, ((2)) [[Approve]], ((3)) [[Reject]]. The card **guests due to leave who still owe** opens **Stays** with **Owes money** chosen." }),

  keep(
    h("How to work the list"),
    p("**Start at the top**: a red card first, then amber. **Open the card and do the work on that page** — the card knows the way. **Come back to Home**: the card is gone, or a smaller number is left. **Do not leave a red card for tomorrow** without knowing why: write it down and tell the Boss."),
    warn("A card about guests is a warning, not a task for Finance. **Finance does not check guests in or out**, and does not take their room payments at the desk. Tell Reception or the Manager and watch the card."),
  ),
);

// ───────────────────────────────────────────── 3 · Money coming in ─────────────────────────────────────────────
export const moneyIn = chapter(
  "Money coming in",
  "Reception, the Restaurant Counter and the guests' own phones record the money that comes in. You do not repeat their work — you read it, check it, correct it when it is wrong, and follow what is still owed.",

  tour("Income — every payment", {
    shot: "fa-in-income", w: 84,
    intro: "Open [[Income]]. It lists every payment the hotel received, newest first.",
    items: [
      "[[Record payment]] — for a payment that reaches you directly, for example a bank transfer from a firm.",
      "**The period** — Today, Yesterday, This week, This month, This year, or two dates.",
      "**INCOME RECEIVED** — the total of the period, refunds taken off, and how much went into each account.",
      "**Every source** — choose Rooms, Restaurant, Bar, Room service fee, Transport, Meeting room, Company invoice or Other.",
      "**Every account** — choose one account: Cash, LIPA, CRDB… The tiles above (Rooms, Restaurant, Bar, Meeting room, Companies) follow the filters.",
      "**The search box** — a guest, a company, a room, a booking number or a reference.",
    ],
    notes: [p("Under the list, **To collect** shows the guests in the hotel who still owe, and arrivals that have not paid. It becomes income only when it is paid.")],
  }),
  keep(
    task("Correct a payment — the wrong account or reference", {
      when: "A guest paid in cash but the clerk chose the bank account, or the M-Pesa code was not written.",
      steps: [
        "Open [[Income]] and find the line: type the booking number, the name or the reference in the search box.",
        "Press [[Edit]] at the right of the line. | A window **Correct this record** opens.",
        "Under **Received through**, choose the account the money really arrived in.",
        "Under **Transaction reference**, type the M-Pesa code or the bank reference, if it was not recorded. | Only a manager can change a reference that is already there.",
        "Press [[!Save the correction]]. | The totals of both accounts move at once. **The amount never changes.**",
      ],
      notes: [
        warn("**Never change a payment to make a report look right.** If the money is not there, the record must say so. Every correction and every reversal stays in **Edit history**, with your name. The payment is not deleted — it stays, struck through."),
      ],
    }),
  ),

  GAP,
  keep(
    task("Reverse a payment recorded by mistake", {
      when: "A payment was recorded twice, for the wrong guest, or the money never arrived.",
      steps: [
        "Open [[Income]] and find the line: type the booking number, the name or the reference in the search box.",
        "Press [[Reverse]] at the right of the line. | On a restaurant sale the button says **Cancel**.",
        "A window opens. Write **why** in the box: “Recorded twice”. | The button stays dimmed until you write.",
        "Press the red [[Reverse it]] (on a sale: [[Cancel it]]).",
      ],
      notes: [
        p("The line stays on the register, struck through and not counted, with your name and your reason. The totals and the account move at once. Then record the right payment, if there is one. To change only the account or the reference, press **Edit** instead — the amount never changes."),
      ],
    }),
  ),

  task("Record a payment you received", {
    when: "A firm paid by bank transfer, or a payment reached you and nobody has recorded it.",
    shots: ["fa-in-rec1", "fa-in-rec2"],
    steps: [
      "Press [[Record payment]] on the page and **find who is paying**: type a name, a room, a booking number, a company or a phone. | The chips under the box choose the list: everyone who owes, in the hotel, leaving today, companies and meetings.",
      "Press [[Record payment]] on **their line**. | Each line shows what it owes, the bill and what was paid so far. A new window opens.",
      "Type the **amount received**. | **All** puts what is owed; **Half** puts half. A part payment is fine.",
      "Write the **reference** — the M-Pesa code or the bank reference. It is optional, and very useful later.",
      "Choose **into which account** the money went — the one where it really arrived.",
      "Press the green [[!Record TZS …]] button.",
    ],
    notes: [
      warn("Record a payment **only when the money has really arrived**. Look at the bank or the phone first. A promise is not a payment, and a zero is not a payment either."),
      p("Finance does not charge things to a guest's bill and does not sell food or drinks here — that is Reception's and the Counter's work."),
    ],
  }),

  tour("Collections — who collected what", {
    shot: "fa-in-coll1", w: 82,
    intro: "Open [[Collections]]. One page for **every payment** of the hotel, the restaurant and the other sales.",
    items: [
      "**The period** — Today, Yesterday, This week, This month, This year, All time, or two dates.",
      "**The four cards** — Everything · Hotel (rooms and bookings) · Restaurant & bar · Other sales, with their share. | Press one to show only that kind.",
      "**COLLECTED** — the total of the payments, and how many payments.",
      "**INTO WHICH ACCOUNT** — the bar and the list: where the money went.",
      "**HOW IT WAS PAID** — cash, bank, mobile money; the share of each.",
      "**STILL TO COLLECT** — restaurant orders that were served and are not paid. | They are **not** in the total above.",
      "**ON ROOM BILLS** — orders that go on a guest's room bill and are paid at check-out.",
    ],
    notes: [
      p("Two more cards, **PAID BY PHONE** and **REVERSED**, tell what came in by nTZS and what was taken back."),
      p("**Under the cards** are the filters: **Served by** (the waiter), **Recorded by** (Reception, the Counter, you), **Every source**, **Every method**, **Every account**. The lines show **TIME**, **ORDER · PLACE · CUSTOMER**, **SERVED BY**, **COLLECTED BY**, **PAID INTO** and the **AMOUNT** with its state. Use them to answer a question like: **what did the Counter collect in cash this week?**"),
    ],
  }),
  tour("Who owes us", {
    shot: "fa-in-owes", w: 80,
    intro: "Open [[Who owes us]]. Everyone who owes the hotel, in one place.",
    items: [
      "**Total outstanding** — everything owed to the hotel by guests, meetings and companies. | Beside it: the part for guests and meetings, the overdue invoices, and what falls due today and in 7 days.",
      "**Overdue invoices** — company invoices past their date.",
      "**Company invoices** — oldest due first. The red label says how many days late.",
      "**Statement** — the account of one company, to print or send.",
      "**Guests & meeting bookings with a balance** — guests in the hotel, coming, or already gone without paying everything. | Each line shows the booking, the room, the phone, and **paid … of …**.",
    ],
    notes: [
      p("**Why is the number on the Home bigger?** The Home counts the restaurant's open orders too (they are on **Collections** under **STILL TO COLLECT**). This page lists guests, meetings and companies."),
      tip("A guest who was allowed to **leave owing** by the Manager stays on this page until the money comes. Follow these names every week, with Reception."),
    ],
  }),

  tour("Companies", {
    shot: "fa-in-companies", w: 80,
    intro: "Open [[Companies]]: the firms that pay by invoice instead of paying at the desk.",
    items: [
      "[[Add company]] — a new firm: its name, the person to speak to, the phone, the credit limit and the days to pay.",
      "**Companies owe** — what the firms owe, and how many have unpaid invoices.",
      "**Overdue** — how much is late, and how many firms are late.",
      "**Not invoiced yet** — stays in progress and draft invoices: money that will be asked soon, not owed yet.",
      "**One card for each firm** — what it owes, how much of it is overdue, the days it has to pay and the credit it has left. | Press a card to open the firm.",
    ],
  }),
  tour("One company", {
    shot: "fa-in-company", w: 74,
    items: [
      "[[Record payment]] — the firm paid: choose the account and write the reference.",
      "[[Statement]] — the account of the firm for a period.",
      "[[Edit]] — the firm's details and its credit limit.",
      "**OWES NOW** — what the firm owes, how much of it is late, and what is not yet invoiced, the credit left and what was invoiced and paid.",
      "**Unpaid invoices** — oldest due first. Press one to open it. | **Other invoice** makes an invoice that is not for a stay.",
    ],
    notes: [p("Income from the firm's stays is counted **once**, night by night. Invoices and company payments only move what is owed — they never add income again.")],
  }),
  keep(
    task("Record a company's payment", {
      when: "A firm paid its invoices by bank transfer, cheque or M-Pesa, and the money has really arrived.",
      steps: [
        "Open [[Companies]] and press the firm's card. | Or press [[Record payment]] on the invoice itself.",
        "Press [[Record payment]]. | It is dimmed when the firm owes nothing. A window **Company payment** opens.",
        "Choose the **account** the money arrived in: the bank is chosen first.",
        "Check the **amount received**. It starts as everything the firm owes; [[All]] puts it back. | A part payment is fine. More than the firm owes is refused.",
        "Write the **reference**: the bank reference, the cheque or the M-Pesa code.",
        "Press the green [[!Record TZS …]] button.",
      ],
      notes: [
        p("The list in the window shows which invoice each part goes to: the oldest are paid first — or tick the invoices the payment is for. The invoices update by themselves: **Partly paid** or **Paid**. This money is **not income again** — the stays were counted as earned night by night."),
      ],
    }),
  ),
  tour("The statement of a company", {
    shot: "fa-in-stmt", w: 70,
    intro: "Press [[Statement]] on the firm's page. It shows the account of the firm for a period: its opening balance, what was invoiced, what was paid and the closing balance.",
    items: [
      "[[Print]] — the statement on paper. Next to it: **PDF** saves it, **Share** sends it on.",
      "**The period** — This year, or two dates and [[Show]].",
      "**CLOSING BALANCE** — what the firm owes at the end of the period.",
      "**OWED TODAY, BY AGE** — not yet due, 1–30 days late, 31–60, over 60.",
    ],
  }),
  tour("Invoices", {
    shot: "fa-in-invoices", w: 54,
    intro: "Invoices are not in the menu. They open from a company, a booking or the tab **Invoices** at the top of the finance pages.",
    items: [
      "[[New invoice]] — an invoice that is not made by a stay.",
      "**What is open** — the unpaid invoices and the overdue ones.",
      "**The filters** — Draft, Issued, Partly paid, Paid, Overdue, Cancelled, Void.",
      "**One invoice** — its number, the firm, the due date, the state and what is left. Press it to open it.",
    ],
    notes: [p("An invoice is made when a company-paid guest checks out. Issuing it freezes its lines; changes after that appear as adjustment lines. On an invoice: [[Send]] sends it to the firm, [[Record payment]] says the firm paid (a part payment is fine, the invoice updates by itself), [[Void]] cancels it — it stays on record, marked VOID, and the stays on it go back to owing until they are billed again. An **Overdue** invoice is a card on your Home.")],
  }),

  tour("Online payments", {
    shot: "fa-in-online1", w: 76,
    intro: "Open [[Online payments]]. Guests pay by phone through **nTZS**. The money arrives in the hotel's nTZS account by itself.",
    items: [
      "**Online payment · NTZS** — is it connected, active, live? Under it, the **API key** and what customers see. | The keys and the webhook belong to Nino and the MD; they are never on a screen (the picture hides them).",
      "[[Test connection]] — asks nTZS if it answers.",
      "[[Check unrecorded with nTZS]] — asks nTZS about payments that were confirmed there but are not on the books yet.",
      "**Where customers can pay online** — the switches for each service: restaurant & bar, room service, guest bills, room bookings, meeting room, transport, invoices. | **Only the Boss or the MD changes them.** You read them.",
    ],
  }),
  keep(
    h("Online payments — the figures"),
    dots([
      "**Paid online** — what was paid in the period, and how many payments.",
      "**Waiting** — payments started on a customer's phone and not finished yet.",
      "**Not completed** — failed, timed out or stopped.",
      "**Needs a person** — money that came in and does not fit a bill, at any time.",
      "**Reconciliation** — every payment nTZS confirmed, checked against the hotel's books: recorded once, for the same amount.",
    ]),
    p("Below the figures: a search (nTZS reference or phone), the filters **Every status** and **Every service**, and the list of attempts with their status — **Paid**, **Waiting**, **Failed**, **Timed out**, **Cancelled**."),
    warn("**“Needs a person”** means money arrived that the system could not put on a bill: more than was owed, the bill changed, or it could not be recorded. A yellow box **Mobile money to check** appears with each one. Refund it, record it by hand or put it on the right bill — then press **Dealt with**, write what you did, and press **Done**. Until then it stays on your Home."),
  ),

  keep(
    h("Follow one payment, from the guest to the books"),
    p("Take a real example: a guest paid **TZS 80,000 in cash** for room 205 at Reception. Nothing else is needed than the booking number. Look for the payment in five places — it is **one payment, written once, seen in five ways**."),
    table(["Where", "What you see", "Picture"], [
      ["**1 · Income**", "The line: the guest, the room, the booking number, who recorded it, the account, the amount.", "below"],
      ["**2 · The account**", "The same payment on the Cash account: money in, +80,000.", "below"],
      ["**3 · The general ledger**", "The same payment as a ledger line: “Paid by … Settles what is owed — not income again”, with the balance after it.", "below"],
      ["**4 · Collections**", "The line with who collected it and where it went.", "earlier"],
      ["**5 · Home and the daily report**", "**Received** on the Home, and the report of that day.", "earlier"],
    ],),
  ),
  shot("fa-tr-income-c", { w: 76, cap: "**1 · Income.** Search the booking number: the payment is one line. ((1)) the search, ((2)) the line — guest, room, number, who recorded it." }),
  shot("fa-tr-account-c", { w: 76, cap: "**2 · The account.** Open [[Accounts]], then the **Cash** account, and search the same number. ((1)) the search, ((2)) the same line — money in, +80,000." }),
  tour("The same payment in the general ledger", {
    shot: "fa-tr-ledger-c", w: 84,
    intro: "**3 · The general ledger.** Open [[General ledger]] and search the same number. The ledger says the same thing in accounting words.",
    items: [
      "**The search** — a booking number, a name, a reference, a supplier, an account.",
      "**DATE** — the day and the time.",
      "**DESCRIPTION** — what it is. “**Settles what is owed — not income again**” says this is a payment of money already earned.",
      "**TYPE** — Cash, Payment received.",
      "**ACCOUNT** — where the money went.",
      "**BY** — who recorded it, and how: through the guest's account.",
      "**CREDIT (IN)** — money in. (**DEBIT** is money out.)",
      "**BALANCE** — the balance after the line.",
      "**PROOF** — a paperclip when a receipt or a document is attached.",
    ],
    notes: [p("At the right of the line are **Edit** and **Reverse**: the same two buttons as in Income.")],
  }),
);

// ───────────────────────────────────────────── 4 · Money going out ─────────────────────────────────────────────
export const moneyOut = chapter(
  "Money going out",
  "Every expense is a record with a name, an account, a date and — when there is one — a receipt. You record the expenses of the hotel's own bills, you decide on the ones that wait, and you leave alone what belongs to a purchase.",

  tour("Expenses — the page", {
    shot: "fa-out-list", w: 84,
    intro: "Open [[Expenses]].",
    items: [
      "[[Record expense]] — writes a new expense.",
      "**MONEY SPENT** — the total of the period, how many expenses, and how many **wait for approval** (they are **not** in the total). | The chips show how much came out of each account.",
      "**The tabs** — **Expenses**, **Monthly bills** (the fixed bills of the month: how many are paid out of how many) and **Summary by type**.",
      "**Every category** — Utilities, Staff & payroll, Food & kitchen, Repairs & maintenance, Office & admin…",
      "**Any status** — Paid, Paid · approved, Waiting approval, Needs correction, Rejected, Cancelled.",
      "**Any account** — only the expenses paid from one account.",
      "**The search** — what it was, the number, who was paid, a note.",
    ],
    notes: [
      p("The lines are grouped by day. Each line shows what, to whom, from which account, who recorded it, the number (**EXP-…**) and the amount."),
    ],
  }),

  task("Record an expense", {
    when: "The hotel paid a bill — detergent, a repair, a fee — and nobody has recorded it.",
    intro: "Press [[Record expense]]. A window opens with two steps: **1 What** and **2 How much**.",
    shots: ["fa-out-type", "fa-out-form"],
    steps: [
      "**What did you pay for?** Type in the search box. | Words like DAWASA, fuel, salaries, Netflix work.",
      "Or pick a **group** on the left and then the **item** on the right. | The first group, **Used most**, has what you record often.",
      "Something new? Choose **Something else — add a new expense**. | It is saved for next time.",
      "Type the **amount** in whole shillings.",
      "Choose **Paid from** — the account the money really came out of.",
      "Write **Paid to** — the supplier or the person.",
      "Open **Receipt, reference, date & notes** when you have a receipt number, a photo, a different date or a note.",
      "Press [[!Save expense]].",
    ],
    notes: [
      p("An expense **below the limit** counts at once. At or above the limit set by the Boss and the MD in the Settings it **waits for approval** — the window says so: “Large amounts go to a manager for approval automatically”."),
      warn("**Never record a supplier invoice here.** An invoice of an order is paid on the purchase (chapter **Purchases**), and that payment makes its own expense, once. If you type the same invoice number, the system refuses it. Stock bought by a stock request has its expense too — do not type it again."),
    ],
  }),
  keep(
    task("Correct or cancel an expense", {
      when: "An expense was recorded with the wrong amount, account or reason, or it should never have been recorded.",
      steps: [
        "Open [[Expenses]] and find the line: search the number (EXP-…), who was paid or a word of the note.",
        "To **correct** it: press [[Edit]]. A window **Correct this record** opens. Change the category, the amount, what it was for, who was paid, the date or the account.",
        "Write **What was wrong with the record?** — the reason is needed. Press [[!Save the correction]].",
        "To **cancel** it: press [[Cancel]] on the line, write why, and press [[Cancel it]].",
      ],
      notes: [
        p("A cost that was already paid is corrected by **cancelling the old line and posting a corrected one**: both stay on the register, with your reason. A cancelled line has [[Reinstate]], in case it was cancelled by mistake. Do not use Edit or Cancel on a supplier payment or a stock purchase — see the table below."),
      ],
    }),
  ),
  shot("fa-out-saved", { w: 72, cap: "**After saving.** The message **Expense saved.** appears. The new line is on top, under **Today**, with its number (EXP-…). The totals above it have moved. Three expenses still wait for approval in this picture." }),

  tour("What “waiting for approval” does to the figures", {
    shot: "fa-out-lines", w: 76,
    intro: "An expense that waits is **recorded, but not counted**.",
    items: [
      "**Waiting approval** — the badge on the line.",
      "[[Approve]] — one press. The expense counts from that moment, with your name.",
      "[[Reject]] — the system asks you to say why. It is never counted.",
    ],
    notes: [
      table(["A waiting expense…", "…is shown"], [
        ["In **MONEY SPENT**, in **Expenses** on the Home, in the **Net result**", "No — a line says “1 waiting approval” beside it."],
        ["In the **balance of the account**", "No — the balance goes down only when it is approved."],
        ["In the **ledger**", "As a line marked **WAITING**, with the amount struck through."],
        ["On the Home", "As a card **expenses waiting for approval**, and under **Where the money went**."],
      ],),
    ],
  }),

  task("Approve or reject an expense that waits", {
    when: "A card says expenses wait, or you open Expenses and see the badge.",
    intro: "Look at the line first: **what**, **how much**, **who recorded it**, **from which account**. Open it for the receipt, the reference and the note. Is it real? Is the account right? Is there a receipt?",
    shots: ["fa-out-approved", "fa-out-reject"],
    steps: [
      "Press [[!Approve]] on the line. | The message **Expense approved.** appears (left picture), and the figures go up by that expense.",
      "Or press [[Reject]]. A window opens: write **why**, so the person knows what to do. | Example: “No receipt — bring it and record it again.”",
      "Press the red [[Reject]] in the window. | The message **Expense rejected.** appears and the line leaves the waiting list. The expense is never counted, and it stays on the register. The person who recorded it reads the reason you wrote.",
    ],
    notes: [
      tip("Not sure? Open the expense, write a note and press **Needs correction**: it goes back to the person with your note, without being rejected. Rejecting and sending back both need a note."),
      warn("**You cannot approve your own expense.** One you recorded above the limit waits for the Manager, the MD or the Boss."),
    ],
  }),

  keep(
    h("Expenses you do not change here"),
    table(["The line says", "What it is", "What to do"], [
      ["**Supplier payment · UHU-… · PO-… · SR-…**, **Paid · approved**", "The payment of a supplier invoice, made when you paid it on the purchase.", "Do not press Edit or Cancel. The system answers: “This expense is the payment of supplier invoice … — it changes only from the purchase.” Look at the purchase."],
      ["**Stock purchase P-… · Kitchen**, chip **From purchase P-…**", "The expense of a stock purchase, made at the final approval.", "It changes only from the purchase."],
      ["**Mobile money charges · nTZS fee — withdrawal WD-…**", "The fee nTZS took on a withdrawal, written with it.", "Leave it. Only the fee is an expense; the money withdrawn is never an expense."],
    ],),
    shot("fa-out-supplier-c", { w: 74, cap: "((1)) the supplier payment, **Paid · approved**. ((2)) and ((3)) **Edit** and **Cancel** are still on the line — do not use them for this kind." }),
  ),

  tour("Edit history — who changed what", {
    shot: "fa-out-history", w: 78,
    intro: "Open [[Edit history]]. Every change made to a money record, newest first.",
    items: [
      "**The period** — Today, Yesterday, This week, This month, This year, or two dates.",
      "**The search** — a name, an expense number, a booking, an amount.",
      "**Everything** — choose a group: Expenses & purchases, Payments & refunds, Prices & discounts, Bookings, Invoices & companies, Cash & accounts.",
      "**Anyone** — the one person who did it.",
      "**The group badge** — on each change.",
    ],
    notes: [
      p("Each change tells **who** did **what**, **when**, the values **before and after** (the old value struck through), the role of the person, and the **reason** when there is one."),
      tip("Somebody asks “who changed this price?” or “who cancelled that payment?” Open Edit history, type the number — the answer is there in a minute."),
    ],
  }),
  rule("**A correction is made at the line itself, with its reason — never by deleting.** The old line stays, struck through. That is why the books can always be proved."),
);

// ───────────────────────────────────────────── 5 · The accounts ─────────────────────────────────────────────
export const accounts = chapter(
  "The accounts",
  "The hotel keeps its money in accounts: cash, mobile money, banks, a card terminal, petty cash and nTZS. The books say what each one holds. You read them, you move money between them, you count the cash, and you read the ledger line by line.",

  tour("Accounts — all of them", {
    shot: "fa-acc-board", w: 80,
    intro: "Open [[Accounts]].",
    items: [
      "[[Money movement]] — moves money between accounts, and records the owner's money and corrections.",
      "**ACROSS EVERY ACCOUNT · IN THE BOOKS** — what the hotel's records add up to. | It is **not** read from the bank.",
      "**The period** — it changes the in and out shown on the cards, not the balance.",
      "**An account card** — the name and the holder, the amount **in the books**, the money in (green) and out, how many movements and when the last one was. | Press a card to open the account.",
    ],
  }),
  tour("Under the cards", {
    shot: "fa-acc-lower", w: 76,
    items: [
      "**Cash counts** — the counts of cash that were made, with the difference: matched, over or short. A count with a difference waits until it is accepted. | Before the first count the box says “No counts yet”.",
      "**Money movements** — transfers, owner money, other income and corrections, each with its number (LG-…). | **Reverse** takes one back, with a reason. The withdrawals made on **Withdraw funds** are listed here too — do **not** reverse them here (see the chapter **Withdraw funds**).",
    ],
  }),

  keep(
    h("What “in the books” means"),
    p("The balance of an account is a simple sum:"),
    table(["", "", ""], [
      ["**Opening balance**", "the money the account already held when the hotel's records began", "+"],
      ["**Money in**", "payments received, sales paid on the spot, owner money put in, transfers in, corrections up", "+"],
      ["**Money out**", "expenses paid from it, refunds, supplier payments, nTZS fees, transfers out, owner money taken, withdrawals, corrections down", "−"],
      ["**= In the books**", "what the hotel's own records say the account holds", ""],
    ],),
    p("A waiting expense, a reversed line and a cancelled line are **not** in the sum. The bank and the phone company have their own statement: **compare the two**. A difference means something is not recorded — find it and record it; do not change an old line to make them agree."),
  ),

  tour("One account's page", {
    shot: "fa-acc-cash", w: 80,
    intro: "Press an account card. Here is the **Cash** account.",
    items: [
      "**IN THE BOOKS** — the balance, with the money in, the money out and the opening balance under it.",
      "[[Record expense]] — pay something out of **this** account: it is already chosen as **Paid from**.",
      "[[Count]] — count what is really in the drawer (only cash and petty cash accounts).",
      "[[Money movement]] — a transfer, owner money or a correction for this account.",
      "**The search** — a guest, a company, a booking, a room, a reference.",
      "**Related** — the booking, the order or the invoice behind the line.",
      "**Fix** — **Edit** and **Cancel** on a line you may correct.",
    ],
    notes: [p("Above the list: **Received today / this week / this month**, **Paid out this month** and the number of transactions. Under the filters: **Money in** and **Money out** for the period.")],
  }),
  tour("The nTZS account", {
    shot: "fa-acc-ntzs", w: 80,
    items: [
      "**IN THE BOOKS** — the balance of the nTZS wallet in the hotel's records.",
      "**The line under it** — in, out, and the **opening** amount that began the books.",
      "[[Withdraw funds]] — starts a withdrawal **here**, without leaving the page (chapter **Withdraw funds**).",
      "**Latest withdrawals** — the ones on their way first, then the ones that ended in the last 24 hours. | A mark **Needs a look** shows when something is wrong.",
      "[[Money movement]].",
    ],
    notes: [p("In the picture: opening 2,450,000, money out 26,260 (three withdrawals and nTZS's fees) = **2,423,740** in the books. nTZS itself has no call for its balance: the books are the figure the withdrawal starts from.")],
  }),

  task("Move money between accounts", {
    when: "Cash was banked, or money went from one account to another.",
    intro: "Press [[Money movement]] on the Accounts page, or on the account's page. A window opens.",
    shot: "fa-acc-move", w: 62,
    steps: [
      "Choose the **kind**: **Transfer** (between two accounts), **Owner put in**, **Owner took out**, **Other income**, **Correction +**, **Correction −**.",
      "**From account** — the page shows what each account holds.",
      "**To account** — the account that receives the money (only for a transfer).",
      "Type the **amount**, and a **reference** (the bank slip, the M-Pesa code).",
      "Say **what it is for**: “Banked the cash takings”. You can add a photo or a PDF of the slip.",
      "Press [[!Save to the ledger]].",
    ],
    notes: [
      p("The movement goes to the general ledger with your name. It is not income and not an expense: the money only changed place. **Owner put in / took out** and **Corrections** are done only when the Boss or the MD asks, and with the reason written."),
      tip("Recorded the wrong one? Press **Reverse** on it and write why. It stays on the ledger, struck through. Then record the right one."),
    ],
  }),

  task("Count the cash", {
    when: "At the end of the day or the week, or when a number looks wrong.",
    intro: "Open the **Cash** account (or Petty cash) and press [[Count]]. A window opens.",
    shot: "fa-acc-count", w: 62,
    steps: [
      "The window says **The system expects** an amount. Count the money in the drawer.",
      "Type what you **counted**.",
      "The window tells at once: **Matches exactly**, **Over by** or **Short by**.",
      "When there is a difference, **explain it**: “Change given to a guest without a receipt”.",
      "Press [[!Save count]].",
    ],
    notes: [
      p("A count that **matches** is simply kept. A count with a **difference** becomes a card on your Home (“cash count with a difference to settle”) and a red box in **Cash counts**. To close it: read the explanation, then press **Accept & correct books** (a correction is posted so the books agree with the count) or **Accept only**. The page says a difference is “accepted by Admin”: Finance holds the same right, so you may accept it."),
      warn("**A count does not hide a loss — it shows it.** Accept a difference only when you understand it. Do not repair it by changing old payments."),
    ],
  }),

  keep(
    h("The opening balance"),
    p("Every account's books begin somewhere. If it already held money when the records began, that money is its **opening balance**. **Only the Boss and the MD** can set it: on the account's page they see the button [[Opening balance]]. **You do not see the button — you see the result**, in the line under the balance: “opening TZS 2,450,000”."),
  ),
  tour("Setting an opening balance (Boss and MD)", {
    shot: "fa-acc-open2",
    frame: "desk", w: 62,
    items: [
      "**Now: opening … · in the books …** — what it is now.",
      "**Opening balance (TZS)** — the amount the account already held.",
      "**What is it?** — the reason, at least 5 letters: “Money in the nTZS wallet when the hotel's books began”.",
      "Press [[!Save the opening balance]].",
    ],
    notes: [
      p("An opening balance is **not income and not a payment**. Nothing is added to sales or to payments. It only sets where the books begin, so that **opening + in − out** agrees with the bank or the nTZS statement. It is recorded with the name of the person, the old value, the new value and the reason. Saving the same amount again is refused."),
      p("In the practice copy the opening balance of the nTZS account is TZS 2,450,000, set once with that reason. The picture shows the window as it is **now**; the amount was already saved, so it was not pressed again."),
    ],
  }),

  tour("General ledger", {
    shot: "fa-gl-top", w: 80,
    intro: "Open [[General ledger]]. **Every movement of money**, line by line. You read it; **Export CSV** saves it for a spreadsheet.",
    items: [
      "**The search** — a guest, a room, a reference, an M-Pesa code, a supplier, an account, a person.",
      "**The filters** — **Everything / Money in & out (payments) / Income only / Discounts given / Expenses only**, **In & out**, **All accounts**, **All categories**, **Anyone**, and the period.",
      "**MONEY IN · MONEY OUT · NET** — for what you filtered. | The line under NET says how many movements, how much was earned and how much spent.",
      "[[Export CSV]] — the lines as a file.",
      "**Opening balance → closing** — the total of all accounts at the start and the end of the period.",
    ],
  }),
  shot("fa-gl-two", { w: 84, cap: "**Earned and paid are two lines.** ((1)) **Earned** — a night of the stay or a sale; it does **not** move the balance. ((2)) **Paid by …** — the money arriving; it moves the balance." }),
  keep(
    h("How to read a ledger line"),
    table(["The line says", "It means"], [
      ["**Earned 120,000** · Rooms · Income · “via Night of the stay”", "The hotel earned that night. **Nobody has paid yet**; the balance does not move."],
      ["**Paid by … · Settles what is owed — not income again** · Payment received", "Money arrived for what was already earned. It moves the account's balance. It is **not** income a second time."],
      ["**Paid on the spot** · Restaurant · Income", "A restaurant or bar sale paid at once: it is earned and received together."],
      ["**Supplier payment · … paid to …** · Expense", "Money out to a supplier, from an account."],
      ["**WAITING** … *waiting for approval*", "An expense nobody has approved: the amount is struck through, the balance is unchanged."],
      ["**Transfer between accounts**", "Money changed place — out of one account, into another. Not income, not an expense."],
    ],),
  ),
  rule("**The balance moves only on money lines.** An “Earned” line without a payment is money the hotel is still waiting for."),
);

// ───────────────────────────────────────────── 6 · Reading the numbers ─────────────────────────────────────────────
export const reading = chapter(
  "Reading the numbers",
  "The Home gives you many figures. This chapter tells what each one means exactly, how to use it to decide something, and the traps that make a good person read a figure wrongly. It ends with the reports: what Finance can open.",

  keep(
    h("The figures, one by one"),
    table(["Figure", "It means", "Do not confuse it with"], [
      ["**Earned**", "What the hotel earned in the period: the room nights that were stayed (night by night), and the food, drinks and services at the day they were sold or put on a room bill. Refunds and discounts are taken off.", "Money. Nobody has to have paid."],
      ["**Received**", "Money that really came into an account, less refunds.", "Earned. A guest who sleeps tonight and pays on Friday is earned tonight and received on Friday."],
      ["**Still owed**", "What is unpaid **right now**, for every date: guests, companies, the meeting room and open restaurant orders.", "A late debt. A guest still in the hotel owes, but is not late until the day they leave."],
      ["**In the books** (an account)", "Opening balance + money in − money out.", "The bank's figure. Compare the two; do not copy one into the other."],
      ["**Expenses**", "What was recorded and counted as spent. A supplier is an expense **only when you pay it**.", "A request, an approval or an order. A waiting expense is not counted."],
      ["**Net result**", "Earned − Expenses.", "A profit. It is not one while some costs are not recorded."],
      ["**Occupancy**", "Rooms sold ÷ rooms available, for the period.", "Money."],
      ["**Nights sold**", "How many room nights were sold in the period.", "Bookings made (a booking can be many nights)."],
      ["**Average room rate**", "Room income ÷ nights sold.", "The list price: discounts and promotions change it."],
      ["**Income per available room**", "Room income ÷ rooms available (RevPAR). It says how well the whole house sells, not only the rooms that sold.", "The average room rate."],
      ["**Average restaurant order**", "What the restaurant took, divided by its orders.", "A price."],
      ["**Spent of what was earned**", "Recorded expenses ÷ earned.", "A margin. Costs that are not recorded are missing from it."],
      ["**Room discounts**", "The share of the room price that was given away.", "Promotions that are the hotel's own rule (they are counted apart in **Discounts**)."],
      ["**Cash of the money received**", "How much of what came in was cash.", "The cash in the drawer."],
      ["**Days the money lasts**", "What the accounts hold ÷ the average spent in a day over the last 30 closed days.", "A promise. It uses only recorded spending, and needs at least **7 days** of records."],
    ], "plain"),
  ),

  keep(
    h("What stands out — each sentence, and what to do"),
    table(["The sentence says", "You decide"], [
      ["**“No expenses were recorded … so the amount earned is not a profit yet”**", "Find the bills that nobody wrote. Do not report a profit until they are in."],
      ["**“Earned is … above the expenses recorded”** / **“The expenses recorded are … above what was earned”**", "The first is good news — but only as good as the costs recorded. The second: look at where the money went, and slow down."],
      ["**“Earned is up / down … on the previous period”**", "Open **How the hotel is doing**: is it the rooms, the restaurant, the bar? Tell the Manager."],
      ["**“Expenses are up … — mostly [a kind], … more”**", "Open that kind in **Expenses**. A one-off, a new habit, or a mistake?"],
      ["**“[A kind] is the biggest expense — …% of what was spent”**", "Is it the right size for the business? Ask the Boss if it should be."],
      ["**“… owed to the hotel is more than a week late”**", "Collect it: **Who owes us** — call the firm, send the statement, tell Reception."],
      ["**“… owed to suppliers is past its due date”** / **“… falls due within a week”**", "Plan the payments: **Procurement → Invoices and payment**. Pay the late ones first."],
      ["**“… is due to suppliers now or within a week, and the accounts hold …”**", "The money is **not enough** for the bills. Talk to the Boss about the order of payments, or a withdrawal."],
      ["**“The accounts cover about … days of spending”**", "Under 14 days is red; under 30 is amber. Slow spending or collect what is owed."],
      ["**“Room discounts took …% of the room price”**", "Open **Discounts**: who gave them, and why. The limits are the Boss's and the MD's."],
      ["**“…% of the money received was cash — keep it counted and banked”**", "Count the cash, bank it (**Money movement → Transfer**), keep the slip."],
    ], "plain"),
    p("Only the sentences that apply are written, and **at most six**. The system stays silent when it does not know: a change is not compared when the period before began **before the hotel's records began**, nor when the period is a day that is not over or less than a week."),
  ),

  keep(
    h("Six traps"),
    dots([
      "**The net result is not a profit** while costs are unrecorded. A month with no expense lines has a big net result — and no profit.",
      "**Never add the four.** Earned, received, still owed and the account balances answer four different questions. The Home keeps them apart on purpose; keep them apart when you speak.",
      "**A period before the records began says nothing.** A growth of “248%” against September means little if September had only a few days of records. The first month starts when the hotel's records began.",
      "**“Days the money lasts” needs seven days of records**, and uses only expenses that were **recorded**. A week with a forgotten bill gives a happy number that is false.",
      "**The banner is today; the tiles are the period.** “Received today TZS 0” in the morning is normal. Do not read the banner as the month.",
      "**A waiting expense is not in any total**, and **a request or an approval is not an expense**. Only a payment you record is.",
    ]),
  ),

  keep(
    h("From a figure to a decision"),
    table(["You see", "You do"], [
      ["**Still owed** is large, and a firm is **more than 30 days late**", "Call the firm. Send its statement (**Who owes us → Statement**). Ask the Boss if the credit limit should stop new stays."],
      ["**Owed to suppliers** is past due, **Days the money lasts** is low", "Pay the supplier who is most late first. Ask the Boss before you take money out of nTZS."],
      ["**Expenses** are far above the period before, in one group", "Open that group. Ask the department what changed. Reject what has no receipt."],
      ["**Room discounts** is high", "Open **Discounts**: who gave them. Tell the Manager. The limits per room type are set by the Boss and the MD."],
      ["**Cash of the money received** is very high", "More cash means more risk. Count and bank it. Prefer the account a guest can be traced to."],
      ["**Which days earn most** shows a weak day", "Tell the Manager and Reception: a promotion on that day? That is their decision."],
      ["An **account is below zero**", "Do not leave it. Find the payment or the movement that is missing and record it."],
    ], "plain"),
  ),

  keep(
    h("Overview — the older page of the period"),
    p("[[Overview]] (first in **FINANCE**) is the page the Home grew from. It gives one period in one view: **Earned − Spent = Result**, **Came in**, **Owed**, **Occupancy**, the average room rate, income per room, nights sold, restaurant orders, **Discounts & refunds**, then **Day by day**, **Income by source**, **Where the money went**, **Where the money came in** and **Rooms by type**. The numbers are the same as on the Home, and agree with the ledger and the daily report."),
  ),

  tour("Reports — the business summary", {
    shot: "fa-rep-summary", w: 78,
    intro: "Open [[Reports]] under **INSIGHTS**. Choose the period; the tabs choose the subject.",
    items: [
      "[[Print]] — the report on paper.",
      "**PDF** — saves it as a file.",
      "**Excel (CSV)** — opens the numbers in a spreadsheet.",
      "**Share** — sends it on.",
      "**The tabs** — Whole business, Daily sales, Restaurant & bar, Best sellers, Payments, Outstanding, Tables, Rooms, Staff, Cancellations, Expenses, Stock & waste.",
      "**EARNED (NET INCOME)** — the figure, and the change against before.",
      "**OWED TO THE HOTEL NOW** — guests, invoices and orders.",
    ],
    notes: [p("Under the figures: **Income by department**, the **Income statement** (earned value, not cash; **Profit (estimate)** after expenses), **Money received, by method** and **Highlights**. The estimate is only as good as the expenses recorded.")],
  }),

  tour("Daily reports", {
    shot: "fa-rep-daily", w: 70,
    intro: "Open [[Daily reports]]. The system makes the report of each hotel day by itself, at **07:00** for the day that closed at **04:00**, keeps it and sends the summary to the Boss by WhatsApp. Nobody writes it.",
    items: [
      "[[Make today's now]] — makes a report that is **missing**. You may press it; **regenerating a report that exists** is only for the MD and the Boss, with a reason, and the earlier version is kept.",
      "**Daily room reports** — the room report of each day, with its link.",
      "**Made automatically at 07:00, every day** — and one line for each day: its revenue, what was collected, and whether it was sent.",
    ],
    notes: [
      p("Open a day to read its report: **Print**, **PDF**, **Share**, the tiles (Income, Expenses, Net profit, Money received, Still owed, Occupancy), **ATTENTION REQUIRED** and **THE DAY IN PLAIN FACTS**. A report that shows **Not sent yet** has the button **Send now**."),
      warn("A report that was made is **never rewritten**. If a number was wrong, correct the record — the correction shows in the next report and in **Edit history**."),
    ],
  }),
  keep(
    task("Send a daily report again", {
      when: "A card says the last daily report did not reach the Boss, or a report shows Not sent yet or Message failed.",
      steps: [
        "Open [[Daily reports]] and press the day. | The line of each day says whether it was sent.",
        "At the top of the report, find the button: [[Send now]] when it was **Not sent yet**, [[Retry send]] after **Message failed**, [[Send again]] when it was sent and the Boss asks for it once more.",
        "Press it. | A message says who it was sent to. If it fails again, tell the MD.",
      ],
      notes: [
        p("**Make today's now** makes a report that is **missing**. You may not rebuild a report that exists: only the MD or the Boss may, with a reason, and the earlier version is kept."),
      ],
    }),
  ),
  tour("Weekly and monthly reports", {
    shot: "fa-rep-weekly", w: 70,
    intro: "Open [[Weekly & monthly]]. The Boss receives each report on WhatsApp with its link — after every shift, every day, every **Monday** for the week before, and on the **1st** for the month before. You open the same pages.",
    items: [
      "**THIS WEEK** — the business and the team so far this week.",
      "**THIS MONTH** — the same, for the month.",
      "**Weekly reports** and **Monthly reports** — one for every week and every month, made automatically.",
      "**Latest shift reports** — the report of each shift that ended, with the money of the shift.",
    ],
    notes: [p("**Each person** lists the staff who worked in the last five weeks, with their week and month. Reports count what was recorded — facts, never a score.")],
  }),

  keep(
    shot("fa-rep-disc", { w: 52, cap: "**Discounts** — under the tabs of the Finance pages. All discounts of the period; the ones that are the hotel's own rule; the ones given by hand for rooms and for the restaurant; and **who** gave them. Nothing is typed here: it is read from the nights and the orders." }),
    shot("fa-rep-prices", { w: 52, cap: "**Price control** — the room prices, how many nights are booked ahead at the old price, what staff may take off a night, the menu prices and **every price change** with who made it. A new price counts for new bookings and orders only." }),
    p("**Refunds and corrections** (the last tab) lists the reversed payments and refunds, the payments moved to another method or account (the amount never changes) and the corrections written to the ledger. Each one is also in Edit history."),
    p("You may change **one menu item's price** (on Price control) and change the room prices on **Room pricing**. You do **not** change how much staff may discount: that limit is set by the Boss and the MD. A price you change never changes an order or a booking that was already made."),
  ),
  rule("**Read the same pages the Boss reads.** When the Boss asks about a number, you should already have looked at it."),
);
