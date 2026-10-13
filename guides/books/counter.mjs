import { chapter, task, tour, tip, warn, rule, p, h, dots, table, beside, shot, keep } from "../tools/kit.mjs";

export default {
  id: "counter", file: "Vegas-Guide-03-Restaurant-Counter.pdf", name: "Restaurant Counter guide", dept: "counter", accent: "#8a5a2b", soft: "#f5ede3",
  kind: "Restaurant & bar", kicker: "Guide book 03", title: "Restaurant | Counter",
  sub: "The live board, taking payments, giving orders to waiters, selling at the counter, tables and the day's money — step by step, on the tablet.",
  cover: { shots: ["c-home-c"] },
  lead: "This book is for whoever stands at the Restaurant Counter of Vegas Restaurant & Bar. The Counter works on the tablet, with the shared account **Restaurant Counter**. It is the till of the restaurant: the waiters serve, and every payment is recorded here. The Counter also watches all the orders, gives them to waiters and takes orders from customers who come to the counter. Every page shows the real screen and the button to tap.",

  place: [
    h("What the Counter hands over"),
    table(["What", "Goes to", "How it gets there"], [
      ["A recorded payment", "Manager, MD and Boss", "It shows at once in **Collections**, in Finance and in the daily report — with the account the money went into."],
      ["An order taken at the counter", "Kitchen (Mpishi)", "You tap **Send to kitchen**. The cook sees it at once."],
      ["An order nobody serves", "A waiter on shift", "**Assign waiter** on the order's card. The order appears in that waiter's own list."],
      ["A table booking", "Waiters and Reception", "**Reserve a table**. The table shows as **Reserved** around the time."],
      ["Food and drinks of a hotel guest", "Reception", "The order is on the guest's room bill. Reception collects it at check-out."],
    ]),
    h("What comes to the Counter"),
    table(["What", "From", "Where you see it"], [
      ["The money, or the customer who pays", "Waiters", "The waiter brings it to you. You record it on the order's card with **Take payment**."],
      ["An order a customer made alone", "The QR card on a table, at the counter or in a room", "A new card in the **New** column, and the tablet rings twice."],
      ["A payment made by phone", "The customer — recorded by the system", "The card already says paid, and **PAID BY PHONE TODAY** counts it."],
      ["A ready order", "Kitchen", "The **READY** box and the **Ready to serve** column."],
      ["A gift order", "Spin to Win, played by a hotel guest", "A card that says **Spin to Win** and **Nothing to pay**."],
    ]),
  ],

  chapters: [
    chapter("The Counter's home page", "The tablet at the counter stays signed in to the Restaurant Counter account. Its home page is the live board of the whole restaurant: the money on top, the orders below.",
      tour("Today, at a glance", {
        shot: "c-home-a",
        items: [
          "**Restaurant QR** — the restaurant's own code. | Show it to a customer who has no table card. They scan it and order from their phone.",
          "**COLLECTED TODAY** — every payment recorded at the Counter today, and how it was paid. | **PAID BY PHONE TODAY** beside it: payments customers made from their own phone.",
          "**STILL TO COLLECT** — orders that are not paid yet. | This is the money you still have to take.",
          "**ON ROOM BILLS** — orders of hotel guests, on their room. | Paid at check-out, at Reception. **TABLES** beside it: how many tables have customers.",
          "**WAITERS ON SHIFT** — how many, and their names. | Only these waiters can be given an order.",
          "**NEW ORDERS** — waiting to be accepted. | **PREPARING** beside it: being made, and how many items are done.",
          "**READY** — made and waiting for a waiter. | **SERVING** beside it: on the way to the customer, and how many orders are completed today.",
        ],
        notes: [tip("The line **ORDERS** under the four boxes counts today's orders and their value by where they came from: **Tables**, **Rooms**, **Online** and **Counter**.")],
      }),
      keep(
        h("The top and the side of every page"),
        dots([
          "**The menu** (left) — Home, Sell, Tables, History, Reservations, Collections, Customers and **Sign out**. | **Home** always brings you back to the live board.",
          "**The date and the hotel day** — the day runs from 04:00 to 04:00. | An order after midnight still belongs to the same working day.",
          "**The bell** — a new order or a ready order rings **twice**: now, and again after 5 seconds. Then it stops. | Green dot: sound is on. Amber dot: tap the screen once so the tablet may ring. Red dot: the sound is switched off.",
          "**EN / 中文** — changes the language of your pages. It does not change what customers see.",
          "**RC** (top right) — the Restaurant Counter account and **Sign out**.",
        ]),
      ),
      rule("The Counter account is shared, so the system asks **who**: the waiter in **Brought by** on a payment, and the **WAITER** on an order. Fill them in every time — that is how the Manager knows who did what."),
    ),

    chapter("The orders on the board", "Under the money, every open order is a card. The card moves from column to column as the kitchen and the waiters work: New, Preparing, Ready to serve, Serving, Done today.",
      tour("An order card, button by button", {
        shot: "c-card-a",
        intro: "Scroll down on the home page to **ALL ORDERS**. The numbers on the picture:",
        items: [
          "**ALL ORDERS** — every order of today that is still open. | **New order →** on the right opens **Sell**.",
          "**The chips** — **All orders**, **Unpaid**, **Paid & room bills**. | Tap **Unpaid** to see only what you must still collect.",
          "**The gold round button — Take payment.** | It shows only on an order that is not paid. Beside it: WhatsApp the customer, and cancel the order.",
          "**Accept** — the order starts and moves to **Preparing**. | The cook accepts orders with food; a waiter accepts orders with drinks only.",
          "**Decline** — refuse the order, with the reason. | Reception sees it as declined and can tell the customer.",
          "**Assign waiter** — on a card that says **No waiter yet**. | Chapter 5.",
          "**Tick the items · 2 left** — the cook ticks every item when it is made. | When all are ticked, the order is **Ready**.",
        ],
      }),
      keep(
        h("The small buttons at the bottom of a card"),
        dots([
          "**+ Add items** — the customer wants more. The new items join the same bill.",
          "**Bill** — print it, download it or share it. After the order is finished it is the **Receipt**.",
          "**History** — every step of the order: who accepted it, who served it, who recorded the payment, and when.",
          "**Transfer** — move the order to another waiter who is on shift, with the reason.",
        ], true),
      ),
      keep(
        h("Who does what on an order"),
        table(["Column", "Who works on it", "What they tap"], [
          ["**New**", "The cook (food) or a waiter (drinks only)", "**Accept** — or **Decline**, with the reason."],
          ["**Preparing**", "The cook", "A tick on every item. All ticked: **Ready**."],
          ["**Ready to serve**", "The waiter of the order", "**Serve** — the waiter collects it from the kitchen."],
          ["**Serving**", "The waiter of the order", "**Served** — it is in front of the customer."],
          ["**Done today**", "Nobody — it is finished", "Served **and** paid, or on the room bill."],
        ]),
      ),
      keep(
        h("Decline an order"),
        p("Tap **Decline** on a new order, or the small **✕** on an order being prepared. The tablet asks **Decline the order for Table 3 — Inside?** Tap the reason: **Out of stock**, **Kitchen is closing**, **Too busy right now**, **Can't make it as asked** — or type your own. The order leaves the board; Reception sees it as declined, with your reason, so the customer can be told."),
        dots([
          "**Ran out?** In the same box, tick the item under **Mark it sold out** — nobody can order it again until it is back.",
          "**An order on a room bill** comes off the room bill when it is declined.",
          "**Payment not received** — one more reason, only for the Counter and Reception. Use it when a customer paid by phone and the money never came (chapter 4).",
        ]),
      ),
      tip("A card that says **Spin to Win** and **Nothing to pay** is a gift a hotel guest won. It is made and served like any other order. There is nothing to collect."),
    ),

    chapter("Take a payment", "Every restaurant payment is recorded at the Counter: cash, mobile money, bank or card. The waiter brings the money, or the customer. You record it in three taps.",
      keep(
        h("Find the order"),
        p("Look for the order's card on the board — by its table, or tap **Unpaid** above the cards to see only the orders that are not paid. The card shows what is owed: **Unpaid · TZS 32,000**. Tap the gold round button ((1)): it is **Take payment**."),
        shot("c-pay-1a", { w: 86 }),
      ),
      task("Record the payment", {
        when: "The money is in your hand, or the payment message is on the customer's phone.",
        shot: "c-pay-2a", side: 78,
        steps: [
          "Read the top: **TZS 32,000 to pay · Order #10**. Then tap how the customer paid ((1)). | **Cash**, **LIPA Mix by Yas**, **Lipa M-Pesa**, **CRDB Bank**, **NMB Bank**, **Card terminal** or **Other**.",
          "**Brought by** ((2)) — choose the waiter who brought the money. | It only notes the waiter. The payment itself is recorded by the Restaurant Counter.",
          "Tap [[!Mark as paid · TZS 32,000]] ((3)). | A green message says **Payment recorded.**",
        ],
        notes: [tip("Not cash? Type the code of the mobile-money message, the bank reference or the number of the card slip in **Reference**. It is optional, but it settles every question later.")],
      }),
      beside("c-pay-3a", 60,
        h("After you mark it paid"),
        dots([
          "The card says **Paid · Cash** — or the way you chose.",
          "The waiter's phone shows the same a few seconds later.",
          "If the order is already served, it moves to **Done today**. If not, the waiter still taps **Served**.",
          "A finished order gives the **Receipt** from its bill button.",
        ]),
        p("On the home page, **COLLECTED TODAY** now counts the payment, and **STILL TO COLLECT** shows only what is left:"),
        shot("c-pay-4a", { wrap: "" }),
      ),
      keep(
        h("The ways to pay"),
        table(["You tap", "The customer paid with", "Reference"], [
          ["**Cash**", "Banknotes, at the counter.", "Nothing."],
          ["**LIPA Mix by Yas** · **Lipa M-Pesa**", "Mobile money, sent to the hotel's Lipa number. Read the message on the customer's phone.", "The code of the message."],
          ["**CRDB Bank** · **NMB Bank**", "A transfer to the hotel's bank account.", "The bank reference."],
          ["**Card terminal**", "A card, on the card machine.", "The number on the slip."],
          ["**Other**", "Anything else.", "Say what it was."],
        ]),
        p("Each button is one of the hotel's payment accounts. The money you record goes into that account, and the Manager looks for it there."),
      ),
      keep(
        h("Money the Counter does not record"),
        dots([
          "**On a room bill** — the card says **Charged to room · Room 101**. It has no gold button. The guest pays it at check-out, at Reception. If the guest wants to pay now, ask Reception.",
          "**Paid by phone** — the customer paid online while ordering. The system records it by itself, and it counts under **PAID BY PHONE TODAY**.",
        ]),
      ),
      warn("**Paid by phone, but the money never came?** Decline the order with the reason **Payment not received**. The payment is taken off and not counted. Only the Counter and Reception can do this."),
      rule("Money first, then **Mark as paid** — never the other way round. A payment recorded by mistake is not deleted: tell the Manager at once, so it is reversed and stays visible under **Reversed**."),
    ),

    chapter("Give an order to a waiter", "Every open order has one waiter who answers for it. When a customer orders from a QR card and nobody has taken the order, the Counter chooses the waiter.",
      task("Assign a waiter", {
        when: "A card says No waiter yet.",
        shot: "c-assign-a", side: 84,
        steps: [
          "On the card, tap [[Assign waiter]].",
          "The box **Who serves it?** lists the waiters who are on shift now. | Name, waiter number, and since when they are on shift.",
          "Tap the waiter who serves it. | The card now says **Waiter · Baraka**, and the order is in that waiter's own list.",
        ],
        notes: [tip("There is no code and no PIN. You pick the waiter by name.")],
      }),
      keep(
        h("Good to know"),
        dots([
          "**Only waiters on shift are listed.** A waiter is missing? Ask them to tap **Start my shift** on their phone.",
          "**A table that already has a waiter** — its next order goes to the same waiter by itself.",
          "**A waiter can take an order alone** — by tapping **Serve** or **Accept** on a card nobody has.",
          "**Wrong waiter?** Tap **Transfer** on the card, pick another waiter on shift and give the reason.",
          "**Home shows who is working** — the box **WAITERS ON SHIFT** has the number and the names.",
        ]),
      ),
      rule("Pick the waiter who **really** serves the order. It stays in that waiter's shift report, and the waiter cannot close the shift while the order is open or unpaid."),
    ),

    chapter("Take an order at the Counter", "When a customer orders at the counter, or calls, use Sell. On the tablet the menu is on the left and the order on the right — you see both at once.",
      tour("Sell on the tablet", {
        shot: "c-sell-a", w: 84,
        items: [
          "**Open orders** — the orders being worked on, each with its step. | You can tap **Serve** or **Accept** here, without leaving Sell.",
          "**Full board →** — back to the live board.",
          "**Search the menu** — type a dish or a drink. | Under it, the groups: Breakfast, Starters & Soups, Local Favorites, Main Courses, Sides & Drinks, Beers, Wines, Whiskies, Spirits.",
          "**A dish** — tap it, or its **+**, to add one. Tap again for two.",
          "**The new order** — who it is for, how it is served, the number of items and the total.",
          "**Phone (required)** and **Customer name** — the phone is how the hotel knows the customer. | A number we already know fills the name by itself.",
          "**WAITER** — the waiters on shift. Tap the one who serves it.",
        ],
      }),
      task("Finish the order and send it", {
        shot: "c-sell-2a", side: 60,
        intro: "The right side of Sell, from top to bottom. Above the picture you choose **how it is served** and the table — see the list below.",
        steps: [
          "**WAITER** — tap the waiter who serves the order. | Only waiters on shift are listed.",
          "**ORDER DETAILS** — check every line. | **−** and **+** change how many. The bin removes the line. **Clear** empties the order.",
          "**Note for the kitchen** — what the cook must know: no onions, extra spicy.",
          "**PAYMENT** — **Pay now** or **Pay later**. | With **Pay now**, tap the account the money goes into and type the reference if there is one.",
          "Scroll down and tap [[!Send to kitchen]]. | The order is on the cook's screen and on the board at once.",
        ],
        notes: [
          h("How it is served"),
          dots([
            "**Dine in** — the customer eats here. Tap the table: **Inside** 1–6, **Outside** 1–6 or **Counter — Outside**. A green dot means somebody already sits there.",
            "**Takeaway** — the customer waits and takes it away.",
            "**Pickup** — the customer ordered ahead and comes to collect.",
            "**Room service** — a hotel guest wants it in the room. Type the guest's phone: the system finds the stay and the room.",
          ]),
          h("Pay now or Pay later"),
          dots([
            "**Pay now** — the customer pays before the food is made. The payment is recorded together with the order.",
            "**Pay later** — the customer pays after eating. The order stays **Unpaid** until you take the payment (chapter 4).",
          ]),
          tip("**Read the order back** to the customer before you send it. To add something later, use **+ Add items** on the order's card."),
        ],
      }),
    ),

    chapter("Tables and reservations", "Tables shows the whole room. Reservations shows who is coming. The Counter also prints the QR cards and takes the table bookings that come by phone.",
      tour("The tables page", {
        shot: "c-tables-a",
        intro: "Open [[Tables]] in the menu. The four numbers on top: tables **In use**, **Reserved** and **Free**, and the money still **To collect**.",
        items: [
          "**To collect** — what the tables still owe, together.",
          "**Reserve a table** — book a table for a customer who comes later.",
          "**Reservations** — all the table bookings.",
          "**Print QR cards** — the card of every table. | **Restaurant QR** beside it is the restaurant's own code. **Download all** saves the cards to print outside.",
        ],
        notes: [tip("A table in use shows the customer, how many people, and its waiter — or **No waiter yet**. The colour is the step: **Free**, **Reserved**, **Seated**, **Ordering**, **Bill asked**, **Paid**. A table that shows **Paid** is finished: clear it, so it is **Free** for the next customer.")],
      }),
      tour("Table reservations", {
        shot: "c-resv-a", w: 84,
        intro: "Open [[Reservations]] in the menu.",
        items: [
          "**New reservation** — the customer's name and phone, the day and the time, how many people, and the table.",
          "**COMING** — bookings for the day. | Beside it: **PEOPLE EXPECTED**, **SEATED**, and **CANCELLED · NO-SHOW** — kept on record.",
          "**Day** or **7 days** — one day or the coming week. | The arrows and the date move the day. The search box finds a booking by name, phone or its **TR-** number.",
        ],
        notes: [tip("Look at this page when you start work. A reserved table shows as **Reserved** on the tables page around its time — do not give it away.")],
      }),
    ),

    chapter("The day's money and the records", "The Counter sees the money one day at a time: today, yesterday or a date you choose. Weeks and months are for the Manager.",
      tour("Restaurant collections", {
        shot: "c-coll-a",
        intro: "Open [[Collections]] in the menu.",
        items: [
          "**Today · Yesterday** — or pick a date and tap **Show**.",
          "**THE RESTAURANT COLLECTED** — the total and the number of payments. | Under it: **INTO WHICH ACCOUNT** and **HOW IT WAS PAID**.",
          "**PAID BY PHONE** — payments customers made from their own phone.",
          "**STILL TO COLLECT** — open orders that are not paid, of any day. | The chip **Still to collect** under the boxes lists them.",
          "**ON ROOM BILLS** — orders of hotel guests, paid at check-out.",
          "**REVERSED** — payments that were taken back. | They are never deleted.",
        ],
        notes: [p("Under the boxes is the list of every payment: **time**, **order**, **place**, **served by**, **collected**, **paid into** and **amount**. The chips show **All payments**, **Paid**, **Still to collect** or **Reversed**. You can search by customer, order number or table, and choose one waiter, one way of paying or one account.")],
      }),
      keep(
        h("Before you leave"),
        dots([
          "Open **Collections** → **Today**. The line **Cash** is the cash the restaurant received today. The cash in the drawer must match it — plus the float you started with, if you keep one.",
          "The lines for mobile money, bank and card must match the messages and the slips.",
          "**STILL TO COLLECT** should hold only orders whose customers are still here. Anything else: tell the Manager.",
          "Hand the cash over the way the Manager has told you.",
        ]),
      ),
      tour("Order history", {
        shot: "c-history-a", w: 84,
        intro: "Open [[History]] in the menu. Every finished, cancelled and declined order is kept here.",
        items: [
          "**Today · Yesterday** — the day you look at.",
          "**All · Done · Cancelled & declined** — which orders to show.",
          "**SALES (DONE)** — the value of the finished orders. | On each line: **Receipt** opens the receipt, **Steps** shows every step of the order.",
        ],
      }),
      tour("Customers", {
        shot: "c-cust-a", w: 84,
        intro: "Open [[Customers]] in the menu. Everyone who has stayed, booked or ordered is saved once — the phone number finds them.",
        items: [
          "**The search box** — a name, a phone number, an email, an ID or a company.",
          "**At a table now** — the customers who are in the restaurant at this moment.",
          "**Restaurant** — customers who ordered in the restaurant. | The column **Owes food** shows what a customer has not paid yet.",
        ],
        notes: [rule("Never make the same customer twice. Type the phone first — if we know the number, the customer is already there.")],
      }),
    ),
  ],

  rules: [
    ["One till.", "Every restaurant payment is recorded at the Counter, at the moment it is paid."],
    ["Money first.", "Tap Mark as paid only when the money is in your hand or the message is on the customer's phone."],
    ["The right way of paying.", "Cash is Cash, a Lipa message is Lipa, a card is Card terminal. The Manager looks for the money in the account you chose."],
    ["Name the waiter.", "Brought by on a payment, WAITER on an order. The Counter account is shared — the names are the record."],
    ["Room bills are not Counter money.", "Charged to room is collected by Reception at check-out."],
    ["No order without a waiter.", "When a card says No waiter yet, assign a waiter who is on shift."],
    ["A phone number on every order.", "The phone is how the hotel knows the customer. Ask for it kindly, every time."],
    ["Nothing is deleted.", "A wrong order is declined or cancelled with the reason. A wrong payment is reversed. Everything stays in History."],
    ["Keep the bell on.", "A new order rings twice. A customer who ordered from a QR card is waiting."],
    ["Check the day before you leave.", "Collections, Today: the cash matches the drawer, and nothing is left to collect by mistake."],
  ],

  problems: [
    ["A waiter is not in the list **Who serves it?**", "The waiter is not on shift. Ask them to tap **Start my shift** on their phone, then open the list again."],
    ["The customer says they paid by phone, but the card says **Unpaid**.", "Ask to see the message. If the money reached the hotel's number, tap **Take payment**, choose **LIPA Mix by Yas** or **Lipa M-Pesa** and type the code in **Reference**. No message: the order stays unpaid."],
    ["The card says paid by phone, but the money never came.", "Tap **Decline** and choose **Payment not received**. The payment is taken off. Tell the Manager."],
    ["I recorded a payment on the wrong order, or with the wrong way of paying.", "Do not try to hide it with another payment. Tell the Manager at once — the payment is reversed and recorded again."],
    ["A card has no gold button.", "There is nothing to collect: it is on a room bill, it is a gift, or it is already paid."],
    ["A hotel guest wants to pay cash for an order that is on the room.", "The order is on the room bill. Ask Reception — the bill is theirs."],
    ["The customer wants one more thing.", "Tap **+ Add items** at the bottom of the order's card. It joins the same bill."],
    ["The customer asks for the bill.", "Tap the bill button at the bottom of the card: print it, download it or share it."],
    ["The tablet does not ring.", "Look at the bell. Red: the sound is off — tap it. Amber: tap the screen once. Keep the home page open."],
    ["A dish is finished.", "Decline the order with **Out of stock** and tick the dish under **Mark it sold out**. Tell the customer what else there is."],
    ["The pages are in Chinese (or English) and I cannot read them.", "Tap **EN** or **中文** at the top of the page."],
    ["The page does not open, or it looks broken.", "Check the internet on the tablet, close the page and open it again. Still wrong? Write to Nino — the last page of this book."],
  ],
};
