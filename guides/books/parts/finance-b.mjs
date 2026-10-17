// The second half of the Finance book (by its own author): Withdraw funds, Purchases, and a day / a week / a month.
// The main file (guides/books/finance.mjs) imports `chapters` and puts them after its own.
import { chapter, task, tour, tip, warn, rule, p, h, dots, table, shot, keep, pair, render } from "../../tools/kit.mjs";

// Like keep(), but the blocks may run on to the next page (each picture and its words stay together).
const flow = (...blocks) => (c) => render(c, blocks);

// A picture on the left, its words on the right.
const left = (id, mm, ...blocks) => (c) => `<div class="split" style="grid-template-columns:${mm}mm 1fr;margin:0 0 4mm">${shot(id, { wrap: "" })}<div>${render(c, blocks)}</div></div>`;

// ───────────────────────────────────────────── 1 · Withdraw funds ─────────────────────────────────────────────
const withdraw = chapter(
  "Withdraw funds",
  "Money that guests pay online arrives in the hotel's nTZS balance. Withdraw funds takes it out — to a phone, a Lipa number or a bank account. Nothing is sent until you have seen nTZS's own price and the name of the person who is paid, and have pressed Send once. A withdrawal only moves money: it is not income and not an expense.",

  tour("The Withdraw funds page", {
    shot: "fb-w-page", w: 82,
    intro: "Open [[Withdraw funds]] in the menu (under Finance). Finance, the MD and the Boss can open it; nobody else sees it.",
    items: [
      "**Withdraw funds** — starts a withdrawal. | It is dimmed while one withdrawal has no clear answer from nTZS, so the same money is never sent twice.",
      "**Available to withdraw** — what the books show for the nTZS account, less what is already on its way out. | **Open the account** goes to the account's own page.",
      "**On its way** — what was sent to nTZS and is not finished yet.",
      "**The period** — Today, Yesterday, This week, This month, This year, or two dates. Everything under it follows it.",
      "**The four tiles** — **Withdrawn** (what arrived), **nTZS fees**, **Pending** and **Failed or refused**.",
      "**Find one** — by number, nTZS reference, name or amount; or show only Pending, Not confirmed, Completed or Failed.",
      "**The number of a withdrawal** — press it to open all its details and its history.",
      "**The state**, in words — never only a colour.",
    ],
    notes: [
      tip("**Available to withdraw** is the hotel's own record of the nTZS account (opening balance + money in − money out), not nTZS's figure. nTZS checks its real balance when it gives the price. If it shows TZS 0 although nTZS holds money, tell the Boss or the MD: the opening balance of the account is set on the account's page, and only they can set it."),
    ],
  }),

  task("Ask for the price", {
    when: "The hotel needs money out of the nTZS balance: to pay somebody, to put money in the hotel's bank account, or for the owner.",
    intro: "Press [[Withdraw funds]] on the page — or on the nTZS account's page, in the same way. A window opens.",
    shot: "fb-w-form-phone", side: 100,
    steps: [
      "**Amount** — what the person must receive, in TZS. | nTZS adds its fee on top, so the balance falls by a little more. [[Use all of it]] fills in everything that is available.",
      "**Available to withdraw** — the most you can ask for now. | If your amount is bigger, a yellow line says so, and nTZS will refuse it if the money is not there.",
      "**Send to** — press [[Phone number]], [[Lipa number]] or [[Bank account]]. | Places you paid before are listed above the buttons (the picture shows five); the first button then reads **Another phone number**. Each way is shown on the next page.",
      "**The number** — type it slowly, digit by digit.",
      "**In the hotel's books** — say where the money goes: [[The owner takes it out]], or [[It goes to…]] one of the hotel's accounts. | You must choose. The window starts with your last choice.",
      "[[!See the price]] — nTZS gives its price and the name of the person paid. **Nothing is sent yet.**",
    ],
  }),

  keep(
    h("The three ways to send"),
    p("Press one of the three buttons under **Send to**. Once the hotel has paid a place, the first button reads **Another phone number**."),
    left("fb-w-way-phone", 96,
      p("**Phone number** — a Tanzanian mobile-money number. The least is **TZS 5,000**. The name you will see is the name the phone's network holds for that number."),
    ),
    left("fb-w-way-lipa", 96,
      p("**Lipa number** — a Lipa Namba, the till of a shop. nTZS finds the network by itself. The least is **TZS 500**, and the amount **plus nTZS's fee** must stay under **TZS 1,000,000**. The name you will see is the shop's."),
    ),
    left("fb-w-way-bank", 96,
      p("**Bank account** — choose the bank (CRDB, NMB or NBC — nTZS names only these three) and type the account number, digits only. The least is **TZS 5,000**. The name you will see is the name on the account at the bank."),
    ),
    left("fb-w-again", 96,
      p("**A place you paid before** is listed above the buttons, with the name nTZS gave. Press it instead of typing the number again. The five latest places are kept."),
    ),
  ),

  keep(
    h("The least and the most"),
    table(["Way", "The least", "The most", "The name shown is"], [
      ["**Phone number**", "TZS 5,000", "What nTZS allows — it says so when it gives the price. The system itself stops at TZS 500,000,000.", "The name registered with the phone network"],
      ["**Lipa number**", "TZS 500", "Less than TZS 1,000,000, with nTZS's fee counted in. Use a smaller amount if it does not fit.", "The name of the shop (the till)"],
      ["**Bank account**", "TZS 5,000", "What nTZS allows for a bank. If it cannot send an amount to a bank it says so; change the amount or send to a phone.", "The name on the bank account"],
    ]),
    p("A large withdrawal may need nTZS's own approval. The price window then says so, and the withdrawal shows **Waiting for nTZS**; nTZS can take up to one working day."),
  ),

  tour("Check before you send", {
    shot: "fb-w-check-lipa", side: 100,
    intro: "After [[See the price]] the window changes. Read all of it once more — after Send, nothing can be taken back.",
    items: [
      "**The name** — the name nTZS holds for this number; the green tick means the network confirmed it. **This is the most important line.** Is it the person or the shop you mean?",
      "**The number** — read it again, digit by digit. | A phone number shows the same way; a bank shows the bank's name and the account number.",
      "**The recipient gets** — the amount you asked for.",
      "**nTZS's fee** — nTZS's price now, added on top. It confirms the real fee when it pays.",
      "**Leaves the nTZS balance** — the amount plus the fee, and about how much is left after it.",
      "**In the hotel's books** — what you chose: the owner takes it out, or a hotel account.",
      "**This price holds for** — a count-down from 5:00. When it ends, sending closes. Press [[Back]] and ask for the price again.",
      "**The tick box** — [[I checked the name, the number and the amount.]] Send works only when it is ticked.",
      "[[!Send TZS 1,000]] — sends it, once. [[Back]] drops the price; nothing was sent.",
    ],
    notes: [
      warn("If the name is missing, the window says **nTZS could not confirm the name on this number**. Check the number yourself, digit by digit, with the person who asked — a wrong digit sends the money to a stranger, and it cannot be called back."),
    ],
  }),

  keep(
    h("Why the name, and why five minutes"),
    dots([
      "**The name** is the only proof that the number is the right one. nTZS asks the network for it; Finance compares it with the person or the shop the Boss or the MD named. If it is not the one you expect, press [[Back]] and do not send.",
      "**The price lasts five minutes** because the fee and the balance come from nTZS at that moment. When the count-down ends, the price is dropped and nothing was sent. Ask again — it costs nothing.",
      "**The same amount to the same place** twice within ten minutes is refused, to stop an accidental second press. The person who asked for the price is the one who sends it.",
    ]),
  ),

  task("Send it, and what comes next", {
    when: "You checked the name, the number and the amount.",
    intro: "Tick the box and press [[Send]] — one time. The window waits for nTZS's answer, up to half a minute: keep the page open. Pressing twice is still one withdrawal.",
    shot: "fb-w-sent-phone", side: 86,
    steps: [
      "**On its way** — the withdrawal has a number (WD-000002, above). nTZS accepted it and is paying it out. **This is not “done” yet.**",
      "**Who is paid** — the registered name, and the number, shown only in part. | A phone says **Phone number**, a Lipa till says **Lipa number**, a bank shows its name and the end of the account number.",
      "**You can close this** — the page follows the withdrawal by itself and shows its state when nTZS reports.",
      "[[Close]].",
    ],
    notes: [
      rule("Only nTZS's own word makes a withdrawal **Completed**. The hotel's books are written at that moment, not before."),
    ],
  }),

  flow(
    h("Watch it until it says Completed"),
    p("Press the number of the withdrawal (here WD-000001) to open it. A phone or Lipa payout takes minutes; a bank's up to a working day. nTZS also tells the hotel by itself."),
    left("fb-w-open", 80,
      p("**While it is on its way**"),
      dots([
        "((1)) **On its way** — the state, with its meaning under it.",
        "((2)) [[Ask nTZS now]] — asks nTZS at this moment.",
        "((3)) **In the hotel's books** — “Recorded only when nTZS confirms the money arrived”: nothing is in the books yet.",
        "((4)) **What happened** — the history of this withdrawal.",
      ]),
    ),
    left("fb-w-done", 80,
      p("**When nTZS has confirmed**"),
      dots([
        "((1)) **Completed** — nTZS confirmed that the money arrived.",
        "((2)) **Arrived** — the amount, and the fee nTZS really charged.",
        "((3)) **In the hotel's books** now says **Recorded**.",
        "((4)) [[Ask nTZS now]] — the button that was pressed.",
        "((5)) **What happened** now ends with “recorded in the books”.",
      ]),
    ),
  ),

  tour("The nTZS account shows it too", {
    shot: "fb-w-account",
    intro: "Open [[Accounts]] and then the nTZS account. You can start a withdrawal right here, and the latest ones are listed under the buttons.",
    items: [
      "**In the books** — what the hotel's records add up to for this account: the opening balance, plus money in, less money out.",
      "[[Withdraw funds]] — the same window as on the Withdraw funds page.",
      "[[All withdrawals]] — the full page, with the history.",
      "**Latest withdrawals** — those on their way first, then those that ended in the last 24 hours.",
    ],
    notes: [
      p("Finance does not see an **Opening balance** button here. It sets where the account's books begin, with a reason, and only the Boss and the MD can press it. It is not income and not a payment."),
    ],
  }),

  keep(
    h("What goes into the books"),
    p("When nTZS confirms, the system writes **two things, once**: the movement of the money, and nTZS's fee as a cost. Nothing is counted as income, and the money that left is not an expense."),
    shot("fb-w-books", { w: 100 }),
  ),
    dots([
      "((1)) **Transfer** — the money went into one of the hotel's accounts (here the CRDB Bank, TZS 20,000): out of the nTZS account, into the other.",
      "((2)) **Owner withdrawal** — you chose that the owner takes it out: the money leaves the hotel's books.",
      "((3)) **Expense** — nTZS's fee. This is the only cost of a withdrawal.",
    ], true),
    shot("fb-w-fee", { w: 78, cap: "In **Expenses** the fee reads “nTZS fee — withdrawal WD-000003”: ((1)) the name of the withdrawal, ((2)) the amount." }),
    tip("Do not try to correct a withdrawal in the ledger or in Expenses. If nTZS later says it did not go through, the system takes it back out of the books by itself; both lines stay visible."),

  keep(
    h("What each state means, and what to do"),
    table(["The state", "What it means", "What you do"], [
      ["**Sending**", "It is being sent to nTZS. Its answer is not here yet.", "Wait a moment. Do not send it again."],
      ["**On its way**", "nTZS accepted it and is paying it out. It is not finished.", "Nothing. The page follows it. [[Ask nTZS now]] if you are in a hurry."],
      ["**Waiting for nTZS**", "nTZS approves large withdrawals itself before it pays. It can take up to one working day.", "Wait. Tell the Boss if the person is waiting."],
      ["**nTZS is checking it**", "nTZS could not confirm the payout by itself and is checking it.", "Wait. nTZS tells the hotel when it is settled."],
      ["**Completed**", "nTZS confirmed the money arrived. The books are written.", "Nothing."],
      ["**Failed — money returned**", "nTZS could not pay it out. The money went back to the hotel's nTZS balance, and the books (if they had it) are corrected — both lines stay visible.", "Open it: nTZS's own words are there. Check the number, then ask for a new price if it is still needed."],
      ["**Refused — nothing sent**", "nTZS refused the request. No money moved. The window says why in plain words.", "Change what it says (the amount, the number) and ask for a new price."],
      ["**Not confirmed**", "nTZS gave no clear answer. **Nobody knows whether the money was sent.**", "See the warning below."],
    ]),
  ),

  keep(
    h("Not confirmed — why nothing else can be sent"),
    warn("A withdrawal that shows **Not confirmed** may or may not have left. While it is open, **no other withdrawal can be sent** — so the same money is never sent twice. The Withdraw funds button is dimmed, a yellow line names the withdrawal, and Home shows a card: “withdrawal not confirmed”."),
    dots([
      "Press **Open it**, then [[Ask nTZS now]]. nTZS answers with the real state, or says it cannot.",
      "nTZS also reports by itself. Wait a few minutes before you worry.",
      "If it still cannot say, tell the **Boss or the MD**. Only they can **settle it by hand**: they look at nTZS itself, choose **The money arrived** (with nTZS's own reference) or **It was never sent**, and write how they know. It is recorded under their name. Finance cannot do this, and it is not allowed at once: only after a quarter of an hour, once nTZS was asked again.",
      "**Never send the same money again** to “fix” it.",
    ]),
  ),

  keep(
    h("Other messages you may meet"),
    table(["You see", "It means"], [
      ["**This price ran out — nothing was sent**", "Five minutes passed. Press [[Back]] and ask for the price again."],
      ["**The same amount was sent to this destination a few minutes ago**", "A second press within ten minutes is refused. If it is really a second payment, wait ten minutes."],
      ["**There is not enough money at nTZS for this amount and its fee**", "Ask for less, or tell the Boss that the nTZS balance is lower than the books say."],
      ["A yellow message that nTZS is **not ready** (for example “has not yet approved the hotel's business account”)", "Nothing was sent. The administrator clears it with nTZS — it cannot be fixed on this page. Tell the MD."],
      ["**Test mode — no real money moves**", "The nTZS account is connected with a test key. Nothing real is paid."],
    ]),
    rule("A withdrawal is **not income and not an expense**. Only nTZS's fee is a cost. Money leaves the nTZS balance only on this page."),
  ),
);

// ───────────────────────────────────────────── 2 · Purchases ─────────────────────────────────────────────
const purchases = chapter(
  "Purchases",
  "Every department asks for what it needs in Purchase requests. Finance decides first — approve with a budget, send back, or reject. Purchasing gets the quotations and the order. Finance then authorizes a price above the budget, checks the supplier's invoice and pays. Only the last step is money spent.",

  keep(
    h("Six figures that must never be mixed"),
    p("A request is **not** an expense. An approval is **not** a payment. An order is **not** a delivery. An invoice is **not** a payment. The Procurement page keeps six figures apart: the same purchases at different steps, **never added together**."),
    table(["Figure", "What it counts", "Money spent?"], [
      ["**Asked for**", "Requests waiting for review: the estimates typed. A guess.", "No"],
      ["**Approved**", "Budgets of approved requests, not yet ordered. The most each may cost.", "No"],
      ["**Ordered**", "Orders sent to suppliers. A promise to buy.", "No"],
      ["**Invoiced**", "Supplier invoices recorded (cancelled ones left out). A bill.", "No"],
      ["**Paid**", "What Finance really paid to suppliers. This is the expense.", "**Yes**"],
      ["**Still owed**", "Invoices not yet paid in full: what the hotel owes.", "No, a debt"],
    ]),
  ),

  keep(
    h("From the request to the payment"),
    table(["Step · where", "Who", "What it makes"], [
      ["**Ask** · Purchase requests", "The department", "A request, **Submitted**"],
      ["**Review** · Purchase requests", "**Finance** (a manager can too)", "Approved with a budget, sent back, or rejected"],
      ["**Quotations** · To quote", "Purchasing", "Quotations; one is proposed"],
      ["**Authorize** · With Finance", "**Finance** (above its limit: Boss or MD)", "A price that may be ordered"],
      ["**Order** · Ready to order", "Purchasing", "The purchase order, PO-…"],
      ["**Deliveries** · On order", "Purchasing", "What was accepted goes into the stores"],
      ["**Invoice** · Invoices and payment", "Purchasing", "The supplier's invoice, **To verify**"],
      ["**Verify or dispute** · Invoices and payment", "**Finance**", "**Verified — to pay**, or **Disputed**"],
      ["**Pay** · Invoices and payment", "**Finance**", "**Paid** — and the one expense"],
    ]),
  ),
  p("Finance holds Purchasing's rights too, so it can get quotations and order. Purchasing (the Accountant role) never approves, authorizes or pays."),

  tour("Where Finance finds the purchases", {
    shot: "fb-c-board", w: 76,
    intro: "Two pages. **Purchase requests** (menu: Stores) is where new requests wait for the first decision. **Procurement** shows every approved purchase to the end. Finance reaches it from the **Purchases** tab, from the **Purchases** button on Home, or from **Procurement** in the menu.",
    items: [
      "**Purchases** — the tab of Finance's tab bar.",
      "**Asked for** — the first of the six figures. They run left to right to **Still owed**.",
      "**Still owed** — the last of the six.",
      "**With Finance** — Finance opens here first: the prices that wait for it. The other tabs: To quote, Ready to order, On order, Invoices and payment, Closed.",
      "**The number of the purchase** — press it to open it.",
      "**The state** of the purchase, in words.",
    ],
  }),

  tour("The queue of requests", {
    shot: "fb-c-queue", w: 88,
    intro: "Open [[Purchase requests]]. The number beside it in the menu is how many wait.",
    items: [
      "**To review** — requests nobody has decided. The other counters: To buy, Being bought, To approve.",
      "**A request** — its number, who asked, for which department, and the estimate.",
      "**Your turn** — this one waits for you.",
      "**Waiting for review** — the real step of the request.",
    ],
    notes: [
      p("Above the list: **Spent on stock** (the expenses of approved purchases, today and this month) and the **Shopping list** — everything approved and not yet bought, with [[Copy]] and [[WhatsApp]] to pass it on. Under the list, **Finished** shows what is done."),
    ],
  }),

  task("Review a request", {
    when: "A request says “Waiting for review” and “Your turn”.",
    intro: "Press the request to open it. You see the items, the reason, the estimate and the history.",
    shot: "fb-c-open1", side: 96,
    steps: [
      "**Approved budget** — the most this purchase may cost. | It starts at the estimate; change it if you wish. If you empty it, the estimate is used. A quotation above the budget comes back to you.",
      "[[!Approve for purchase]] — the request goes to Purchasing for quotations. The person who asked sees **Approved**. Nothing is spent yet. | A budget above the limit set for Finance in Settings is refused: the Boss or the MD approves it.",
      "[[Change]] — correct the items or the quantities yourself first.",
      "[[Send back]] — ask the person to change something. A note is needed.",
      "[[Reject]] — say no. A reason is needed.",
    ],
  }),

  keep(
    h("Send back, or reject — with the words the person will read"),
    pair(
      ["fb-c-back", { cap: "**Send back.** ((1)) Write what to change, for example “Say how many gas cylinders you use in a week.” ((2)) [[Send back]]. The person sees **More information needed** and your note, and can change the request and send it again." }],
      ["fb-p-reject", { cap: "**Reject.** ((1)) Write why, for example “Please count the glasses in the bar first.” ((2)) [[Reject]]. The person sees **Rejected** and your reason. Nothing is bought." }],
    ),
  ),

  task("Authorize a price above the budget", {
    when: "The Accountant proposed a quotation above the approved budget (or the request had no budget). The purchase says “Waiting for Finance to authorize the price”, and Home shows “purchase prices waiting for you to authorize”.",
    intro: "Open **Procurement**, tab **With Finance**, and press the purchase.",
    shot: "fb-c-fopen", w: 86,
    steps: [
      "**Approved budget** — what you allowed.",
      "**Quotation** — the price proposed. The page says how far above the budget it is.",
      "**Waiting for Finance** — nothing can be ordered until you decide.",
      "[[!Authorize this price]] — you may add a note. The state becomes **Price authorized — ready to order**.",
      "[[Send back]] — to the Accountant, with what to do (a reason is needed): get another quotation, or ask the supplier for less.",
    ],
    notes: [
      rule("A price **inside** the budget needs no authorization — it is ready to order at once. A price above the **limit set in Settings** can be authorized only by the **Boss or the MD**. (While no limit is set, Finance decides alone.)"),
    ],
  }),

  keep(
    h("The note, the limit and the next step"),
    pair(
      ["fb-c-authform", { cap: "((1)) A note for the record. ((2)) [[Authorize]]." }],
      ["fb-c-limit", { cap: "When the price is **above what Finance may authorize alone**, the window says so in red, and the Boss or the MD authorizes it." }],
    ),
    shot("fb-c-authorized", { w: 70, cap: "After you authorize: ((1)) **Price authorized — ready to order**; ((2)) the Purchase order box — Purchasing issues the order." }),
    p("If the hotel switched on “the approver must differ”, Finance cannot authorize a quotation it recorded itself."),
  ),

  tour("An invoice arrives", {
    shot: "fb-c-invopen", w: 92,
    intro: "Purchasing recorded the supplier's invoice. It is **not a payment** — it is a bill. Open the purchase (**Procurement → Invoices and payment**) and look at the invoice.",
    items: [
      "**Invoices and payment** — the box with every invoice of this purchase.",
      "**To verify** — recorded, not checked, nothing paid.",
      "[[Verify]] — you checked it against the order and the delivery.",
      "[[Dispute]] — something is wrong with it.",
    ],
    notes: [
      p("Check three things: the **supplier and the number** are the ones ordered; the **amount** is not more than what was delivered and accepted; the **due date** is right. If the invoice is more than what arrived, a reason is needed to verify it."),
    ],
  }),

  task("Verify a supplier invoice", {
    when: "A card says supplier invoices to verify, or a purchase on Invoices and payment shows an invoice marked To verify.",
    intro: "Open **Procurement**, the tab **Invoices and payment**, and press the purchase. Check the invoice against the order and what arrived: the supplier and the number, the amount, the due date. Then press [[Verify]] on the invoice. A window opens.",
    shot: "fb-c-verifyform", side: 80,
    steps: [
      "Write a note if you wish. | The note is needed when the invoice is more than what arrived.",
      "Press [[!Verify]]. | The invoice then reads **Verified — to pay**.",
    ],
    notes: [warn("**Verify** says: this invoice is right and may be paid. If something is wrong, press **Dispute** instead (see below). Nothing is paid by verifying.")],
  }),

  tour("A verified invoice", {
    shot: "fb-c-verified", w: 84,
    items: [
      "**Verified — to pay** — the invoice is right and waits for the money.",
      "**Verified by** — your name, and the note.",
      "[[Record payment]] — the next step.",
      "[[Cancel invoice]] — only while nothing is paid.",
    ],
  }),

  task("Pay the supplier", {
    when: "An invoice reads Verified — to pay, and the money has really left the account.",
    intro: "Press [[Record payment]] on the verified invoice. A window opens. Fill it in only after the payment was really made from the bank, the phone or the cash.",
    shot: "fb-c-payform", side: 80,
    steps: [
      "**Amount paid (TZS)** — it starts as everything that is still owed. | Change it for a part payment. More than is owed is refused.",
      "**Paid on** — the day the money really left. | It cannot be in the future.",
      "**Paid from** — the account the money really left: cash, a bank or mobile money.",
      "**Reference** — the bank reference, if any. | Optional, and useful later.",
      "Press [[!Record the payment]]. | One expense is made, once, and the account goes down.",
    ],
    notes: [tip("Record the payment only when the money **really left** the account. A part payment leaves the invoice **Partly paid**; the next payment is recorded the same way.")],
  }),

  tour("After the payment", {
    shot: "fb-c-paid", w: 84,
    items: [
      "**Done** — the purchase is finished: everything is delivered and every invoice is paid.",
      "**Invoiced / paid** — the two figures now agree.",
      "**The payment line** — the day, the account, the reference and the expense number.",
      "**Paid** — the invoice.",
    ],
  }),

  task("Dispute an invoice", {
    when: "The invoice does not match the order or what arrived: a charge that was not ordered, goods that did not come, a wrong total.",
    intro: "Press [[Dispute]] on the invoice (on the tab **Invoices and payment**). A window opens.",
    shot: "fb-c-dispform", side: 80,
    steps: [
      "Write **what is wrong**, for example “The delivery charge was not on the order.” | The reason is needed: without it the system refuses.",
      "Press [[!Dispute]]. | The invoice reads **Disputed** and cannot be paid.",
    ],
    notes: [p("Tell Purchasing. The supplier corrects it, or Purchasing cancels the invoice and records the right one.")],
  }),
  shot("fb-c-disputed", { w: 84, cap: "((1)) the invoice still **To verify**; ((2)) the one that is **Disputed**, with ((3)) your words. ((4)) [[Verify]] stays for the good one; ((5)) [[Cancel invoice]] while nothing is paid." }),
  warn("The number of a **cancelled** invoice cannot be used again on the same order: the system says the invoice is already recorded. A corrected invoice must come from the supplier with its own number. If the right paper has the same number, tell Nino."),

  flow(
    h("What appears after the payment"),
    table(["Where", "What you see"], [
      ["**The invoice**", "**Paid** (or **Partly paid**), with the payment line and the expense number."],
      ["**Expenses**", "**One** expense for each supplier payment, for example “Supplier payment · UHU-0387 · PO-2026-0001 · SR-2026-0002”, marked **Paid · approved**, and the account it was paid from."],
      ["**The purchase**", "**Done** once everything is delivered and every invoice is paid."],
      ["**The person who asked**", "**Completed**. They never see the invoice or the payment."],
      ["**The stores**", "Stock went in earlier, when Purchasing recorded the delivery — only the accepted lines of items kept in stock. **Not** at the payment."],
    ]),
    shot("fb-c-expenses", { w: 100, cap: "((1)) the figure “Money spent”; ((2)) the supplier payment as an expense; ((3)) **Paid · approved**." }),
    rule("One expense is made **only when Finance really pays a supplier** — never for a request, an approval, an order or an invoice. Do not change it in Expenses: it belongs to the purchase."),
  ),

  tour("What is waiting, and what is late", {
    shot: "fb-c-home",
    intro: "On Home, **Needs your attention** points to the work here. Each card leads to the right tab of Procurement.",
    items: [
      "[[Purchases]] — the button on Home, with the number of what waits.",
      "**Needs your attention** — one card for each kind of thing.",
      "**Past its due date** — a supplier invoice whose due date has passed, and how much is still owed.",
      "**Disputed** — an invoice you disputed that still waits for the supplier to correct it.",
    ],
  }),

  keep(
    h("The cards that point here"),
    table(["The card says", "What to do"], [
      ["**purchase prices waiting for you to authorize**", "Open **With Finance** and authorize, or send back."],
      ["**supplier invoices to verify**", "Open **Invoices and payment** and verify or dispute."],
      ["**supplier invoices verified, to pay**", "Pay them, from the account the money really leaves."],
      ["**supplier invoices past their due date** — “TZS … still owed”", "Pay the oldest first, or ask the supplier for more time."],
      ["**supplier invoices disputed** — “Waiting for the supplier to correct it”", "Ask Purchasing where the corrected invoice is."],
    ]),
  ),

  tour("Invoices and payment", {
    shot: "fb-c-invoices", w: 92,
    items: [
      "**Invoices and payment** — the tab with every purchase that was delivered and waits for its invoice or payment.",
      "**Invoiced** — all the invoices recorded.",
      "**Still owed** — what the hotel owes (this is the debt, not an expense).",
      "**The order number** (PO-…).",
      "“**an invoice is disputed**” — beside the state, so you see it in the list.",
    ],
  }),
);

// ───────────────────────────────────────────── 3 · A day, a week, a month ─────────────────────────────────────────────
const routine = chapter(
  "A day, a week, a month",
  "A Finance person does the same few things at the same times. These lists say what to open first, what to look at during the day, and what to close in the evening, on Monday and at the end of the month. Nothing here is a new rule: each line is a page you already know.",

  keep(
    h("Every morning — the first 15 minutes"),
    dots([
      "**Open Home.** Read the banner, then **Needs your attention**. Work the cards from the top. When it says “Nothing is waiting for Finance”, you are clear.",
      "**The daily report.** It is made by itself at **07:00** for the hotel day that closed at 04:00. If a card says it was not made, or did not reach the Boss, open it from the card.",
      "**Purchases.** Open [[Purchases]] — authorize prices on **With Finance**, verify invoices, pay the ones that are verified and due.",
      "**Expenses waiting.** Open [[Expenses]] — those marked **Waiting approval** are yours to approve or reject.",
      "**Online payments.** Open [[Online payments]] if a card says money came in that is not matched to a bill.",
      "**Withdrawals.** Open [[Withdraw funds]] if a card says one is not confirmed — nothing else can be sent until it is settled.",
    ]),
    shot("fb-c-home", { w: 84, cap: "Home: ((1)) [[Purchases]], with the number that waits; ((2)) **Needs your attention**; ((3)) an invoice past its due date; ((4)) an invoice that is disputed. The cards you see are the ones of the day." }),
  ),

  keep(
    h("During the day"),
    dots([
      "**Answer the bell.** A purchase price to authorize, an invoice to verify: do it when it comes, so Purchasing is not left waiting.",
      "**A withdrawal asked for?** Ask for the price, compare the **name** with the person named, tick, send once. Then watch it until it says **Completed**.",
      "**Guests who left owing.** [[Who owes us]] shows who owes the hotel and how late. Follow what is overdue with Reception.",
      "**Companies.** Open [[Companies]] — an invoice past its due date is on the card “company invoices overdue”.",
      "**Expenses.** A new expense above the limit waits for approval. Look at it before the end of the day.",
    ]),
  ),

  keep(
    h("Evening — before you close"),
    dots([
      "**Home is clear?** No card left for a purchase, an invoice, an expense or an online payment — or you know why it waits.",
      "**Accounts.** Open [[Accounts]]. For each account, **In the books** is what the hotel's records add up to. Compare it with the bank statement, the nTZS statement and the cash in the drawer.",
      "**Cash.** Open the Cash account and press [[Count]]. Count what is really there, type it, and the system shows **Matches exactly**, **Over by** or **Short by**. A difference needs a note that explains it.",
      "**A difference you can explain** (a transfer not yet recorded, a bank charge)? Record what was missing — a **Money movement** for a transfer or a correction, an **expense** for a charge. Do **not** change old lines to make it agree.",
      "**Nothing on its way?** Open [[Withdraw funds]] — **On its way** should be TZS 0 before you leave, or you know which one waits.",
    ]),
    shot("fb-w-account", { w: 92, cap: "The nTZS account's page: ((1)) **In the books**; ((2)) [[Withdraw funds]]; ((3)) [[All withdrawals]]; ((4)) the latest withdrawals." }),
  ),

  keep(
    h("The reports the Boss receives"),
    table(["When", "What", "Where you read it"], [
      ["After every shift", "The report of that shift", "[[Staff shifts]]"],
      ["Every day at 07:00", "The daily report of the hotel day that closed at 04:00", "[[Daily reports]]"],
      ["Every Monday morning", "The weekly report", "[[Weekly & monthly]]"],
      ["On the 1st", "The monthly report", "[[Weekly & monthly]]"],
    ]),
    p("The system makes them and sends them by WhatsApp; nobody writes them. Read them too, so that you know what the Boss has read."),
  ),

  keep(
    h("Every Monday"),
    dots([
      "**The weekly report.** The Boss receives it by WhatsApp on Monday morning. Open [[Weekly & monthly]] and read it first — the Boss may ask you about it. It must agree with **Overview**.",
      "**Supplier invoices due this week.** On Home, **Cash outlook** says what the hotel owes and when it falls due, with **Next to pay**. Plan the week's payments.",
      "**Companies and guests that owe.** Open [[Who owes us]]. Write down who is overdue and how much, and pass it to Reception and the Boss.",
      "**Purchases that sit.** Open **Procurement**: a purchase on **On order** past its date, or an invoice still **To verify**, is yours to chase.",
      "**Expenses.** Approve or reject everything that waits. Open **Monthly bills** (a tab in Expenses): which fixed bills are paid, which are not yet.",
    ]),
  ),

  keep(
    h("The end of the month"),
    table(["When", "What to do"], [
      ["**The last days**", "Pay what is due: supplier invoices (**Invoices and payment**) and the fixed bills (**Expenses → Monthly bills**). Approve or reject every expense that waits."],
      ["**Check every account**", "Open [[Accounts]]. For each one compare **In the books** with the bank statement, the nTZS statement and the cash counted. Explain every difference in writing. Record what was missing — never edit history."],
      ["**Companies**", "Every company invoice past its due date: ask the company, tell the Boss."],
      ["**Withdrawals**", "Open [[Withdraw funds]] and set the period to the whole month: **Withdrawn** and **nTZS fees** should agree with the nTZS statement. None may be **Not confirmed**."],
      ["**The 1st**", "The Boss receives the **monthly report** by WhatsApp. Open [[Weekly & monthly]] and compare it with **Overview**, using two dates that cover the whole last month. Then open **Monthly bills** (a tab in Expenses): it is the checklist of the fixed bills of the month — which are paid, which are not yet."],
    ]),
    rule("Earned is not received, received is not owed, and none of them is an account balance. Read them side by side — never add them."),
  ),

  keep(
    h("If the books and the bank do not agree"),
    table(["You find", "Look at"], [
      ["An account is **below zero**", "A card on Home says so. Open the account: a payment went out before the money came in, or a movement is missing."],
      ["The **nTZS** account differs from nTZS", "The fee of a withdrawal, or a withdrawal that is **Not confirmed**. Open [[Withdraw funds]]."],
      ["**Cash** is over or short", "Count again, then write the reason in the count. Do not change the payments."],
      ["A payment looks wrong", "[[Edit history]] shows every correction, who made it and why. A correction is made at the line itself."],
    ]),
    tip("When something does not make sense, **do not delete or hide it**. Write what you see and tell the Boss or the MD. Everything the system keeps is kept with a name and a time."),
  ),
);

export const chapters = [withdraw, purchases, routine];
