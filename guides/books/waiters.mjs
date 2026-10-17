import { chapter, task, tour, flow, tip, warn, rule, p, h, dots, table, beside, shot, keep, pair } from "../tools/kit.mjs";
import { flowN } from "./parts/narrow-flow.mjs";

export default {
  id: "waiters", file: "Vegas-Guide-02-Waiters.pdf", name: "Waiters guide", dept: "waiter", accent: "#b0492f", soft: "#f7ece5",
  lastTitle: "Golden rules and problems",
  lastLead: "The few things that must always be done the same way, and what to do when something goes wrong.",
  kind: "Restaurant & bar", kicker: "Guide book 02", title: "Waiters",
  sub: "Your shift, taking an order, serving it, tables and QR cards, payments at the Counter and closing — step by step, on your phone.",
  cover: { shots: ["w-home", "w-order-5"], frame: "phone" },
  lead: "This book is for the waiters of Vegas Restaurant & Bar. You work from your own phone. The book follows your shift in order: you start, take orders, serve them, look after your tables, bring every payment to the Counter and hand over before you leave. Every page shows the real screen and the button to tap.",

  place: [
    '<div style="height:5mm"></div>',
    keep(
      h("What passes through a waiter's hands"),
      table(["What", "With whom", "How it moves"], [
        ["**To** — an order with food", "Kitchen (Mpishi)", "**Send to kitchen**. The cook sees it at once."],
        ["**To** — the payment", "Restaurant Counter", "You bring the money or the customer. Your name goes in **Brought by**."],
        ["**To** — a hotel guest's order", "Reception", "It goes on the room bill, collected at check-out."],
        ["**To** — what you cannot finish", "A colleague", "**Transfer**, with the reason."],
        ["**From** — a QR order", "The customer", "Under **No waiter yet**, or in **Your orders**."],
        ["**From** — a ready order", "Kitchen", "The **READY** box, and your phone rings twice."],
        ["**From** — tables, orders", "Counter, colleagues", "In **Your orders** and **Tables**."],
      ]),
    ),
  ],

  chapters: [
    chapter("Start your shift", "Open the system on your phone and sign in with your own account. One switch starts your shift — only waiters on shift can be given work.",
      tour("Your home page", {
        shot: "w-home-n",
        intro: "This is the first page after you sign in. It is the live board of the restaurant, seen from your side. It refreshes by itself.",
        items: [
          "**Restaurant QR** — the code a customer scans to order without a table card. | Show it on your phone when a customer asks.",
          "**The shift switch** — **Start my shift** or **On shift · since …**. | Tap it to start. Tap it again to close your shift.",
          "**NEW ORDERS** — orders nobody has accepted yet. | **PREPARING** beside it: orders being made.",
          "**READY** — made and waiting for a waiter. | **SERVING** beside it: orders on the way to the customer.",
          "**No waiter yet** — orders nobody serves. | Tap **Serve** and the order is yours. You will hear when it is ready.",
          "**Home · Find · Menu** — always at the bottom. | **Menu** opens every page. **Find** is the front desk's search: if you tap it, the page only says **You don't have access to this page**. Look for a customer in **Customers**.",
        ],
      }),
      flow("Start your shift", {
        when: "Every time you come to work, before you serve.", tall: true,
        shots: [
          ["w-gate", "The switch says **Start my shift**. Tap it."],
          ["w-start", "It turns green: **On shift · since 17:40**. Now the Counter can give you orders and colleagues can hand work to you."],
          ["w-menu", "**Menu** shows all your pages: Home, Sell, Tables, My shifts, Customers, My reports, Collections, Reservations — and **Sign out**."],
        ],
        notes: [tip("If you forget the switch and take an order, the system starts your shift for you at that moment.")],
      }),
      h("The top of every page"),
      dots([
        "**The bell** — a new order or a ready order rings **twice**: now, and again after 5 seconds. Then it stops. | Green dot: sound is on. Amber dot: tap the screen once so the phone may ring. Red dot: you switched the sound off.",
        "**Bell off is off everywhere** — it is saved on your account, so every phone you sign in to stays silent until you switch it on again.",
        "**EN / 中文** — changes the language of your pages. It does not change what customers see.",
        "**Your letter** (top right) — your account and **Sign out**.",
      ]),
      rule("Sign in with **your own** account only. Every order you take, serve or hand over is saved under your name — the Manager and the Boss see it in your shift report."),
    ),

    chapter("Take an order", "Use Sell when the customer tells you the order. The order goes to the kitchen the moment you send it — nobody writes it on paper.",
      task("Choose the items", {
        when: "A customer at a table, at the counter or on the phone tells you what they want.",
        shot: "w-order-1",
        steps: [
          "Open [[Menu]] → [[Sell]]. Tap a group of the menu — here **Beers**. | You can also type in **Search the menu**.",
          "Tap **+** on every item. Tap again for two. | The number beside the price is how many you added. **−** takes one away.",
          "Tap [[!Review order]] at the bottom. | It shows how many items and the total.",
        ],
        notes: [tip("Open orders sit at the top of **Sell**. To add to a table that already has an order, tap its chip — the new items join the same bill.")],
      }),
      keep(
        h("Four ways to serve an order"),
        table(["You choose", "Use it when", "What you fill in"], [
          ["**Dine in**", "The customer eats here.", "The table: Inside 1–6, Outside 1–6, or **Counter — Outside**."],
          ["**Takeaway**", "The customer waits and takes it away.", "Phone and name."],
          ["**Pickup**", "The customer ordered ahead and comes to collect.", "Phone and name."],
          ["**Room service**", "A guest staying in the hotel wants it in the room.", "The room: type its number, the guest's name or the booking number under **Which room?**"],
        ]),
      ),
      flowN("Review the order and send it", {
        plain: true, tall: true, width: 76,
        intro: "The numbers ((1)) to ((6)) on the three pictures are the six steps, in order.",
        shots: [
          ["w-order-2", "((1)) Choose how it is served — **Dine in**. ((2)) Tap the table: **Inside** or **Outside** and its number."],
          ["w-order-3", "((3)) Type the customer's **phone** — it is required. ((4)) Type the name. A number we already know fills the name by itself."],
          ["w-order-4", "((5)) Payment is **Pay later** — the customer pays at the Counter. ((6)) Check the lines and the total, then tap **Send to kitchen**."],
        ],
      }),
      beside("w-order-5", 44,
        h("After you send"),
        p("The page says **Order #11 sent to the kitchen** and shows the lines and the total. The order is now in **Your orders** on your home page, with your name on it."),
        dots([
          "[[Print / download bill]] — the bill for the customer, when they are ready to pay.",
          "[[+ Add more for Table 4 — Outside]] — the customer wants something else. It joins the same bill.",
          "[[New order]] — start the next customer.",
        ]),
        h("Change an order"),
        dots([
          "**Add** — open **Sell**, tap the table's chip at the top, add the items and send.",
          "**Remove** — open the order and tap the minus on the line. You must give the reason. | An item the kitchen has already made can be removed only by a Manager, and an item that is already paid cannot be removed.",
          "**A wish for the cook** — write it in **Note for the kitchen** before you send: no onions, extra chilli, no ice.",
        ]),
        rule("A hotel guest can put an order on the room bill — but only on **their own room**. You find it with the guest's phone number. For any other room, send the guest to Reception."),
      ),
    ),

    chapter("Serve", "The kitchen makes the order. You bring it, and the customer pays at the Counter. An order is finished only when it is served and paid.",
      tour("Your orders", {
        shot: "w-orders-n", frame: "phone", tall: true,
        intro: "Scroll down on your home page. **Your orders** shows everything that carries your name today.",
        items: [
          "**All orders** — every order of yours. The number is how many.",
          "**Unpaid** — still to pay at the Counter. | **Paid & room bills**: nothing more to collect.",
          "**The step** — New, Preparing, **Ready to serve**, Serving, Done today. | Tap a step to see only those orders.",
          "**The order** — table or room, customer, waiter, order number, and how long it has waited.",
          "**Unpaid · TZS 25,000** — what the customer still owes. | It changes to **Paid** when the Counter records the payment.",
          "**Transfer** — give this one order to a colleague on shift. | The green button calls or writes to the customer on WhatsApp.",
        ],
      }),
      keep(
        h("Who makes the order"),
        dots([
          "**An order with food** goes to the kitchen. The cook accepts it, ticks every item and marks it **Ready**. You wait for the ring.",
          "**An order with only drinks** does not wait for the cook. It sits under **NEW ORDERS** — tap [[Accept]], pour the drinks and serve.",
          "**An order from a customer's phone** (QR card) arrives the same way. If nobody has it, it shows under **No waiter yet** — tap [[Serve]] to make it yours.",
          "**A customer who chose Pay now** pays with mobile money on their own phone. The kitchen starts when the payment is confirmed — a few seconds. | If the payment fails, the order still goes ahead and the customer pays at the Counter. Take-out is different: it waits until it is paid.",
        ]),
        rule("Served **and** paid — only then is an order finished. A served order that is not paid stays open under your name until the Counter records the payment."),
      ),
      flowN("From Ready to the table", {
        when: "Your phone rings twice and the READY box shows an order.", tall: true, width: 66,
        shots: [
          ["w-serve-1", "The **READY** box shows what waits. Scroll down to **Your orders**."],
          ["w-serve-2", "Collect the order from the kitchen and tap [[!Serve]] on its card. It moves to **Serving**."],
          ["w-serve-3", "Put it in front of the customer. The card shows where: **Serve at Table 2 — Inside**. Then tap [[!Served]]."],
        ],
      }),
      flowN("Served — and paid at the Counter", {
        from: 4, tall: true, width: 66,
        shots: [
          ["w-serve-4", "If the order is not paid, you see what to collect: **To pay at the Counter · TZS 32,000**. Tap **Served — they pay at the Counter**."],
          ["w-serve-5", "Take the payment, or the customer, to the Counter. When the Counter records it, the card says **Paid · Cash** ((1)). If **Served** ((2)) still shows, tap it."],
          ["w-serve-6", "The order is finished. It moves to **Done today** and stays in your shift report."],
        ],
      }),
    ),

    chapter("Tables and QR cards", "Tables shows the whole room at a glance: who sits where, who serves them and what is still unpaid. The QR cards let customers order from their own phone.",
      tour("The tables page", {
        shot: "w-tables-n", tall: true,
        intro: "Open [[Menu]] → [[Tables]]. The four numbers at the top: tables **In use**, **Reserved**, **Free**, and the money still **Unpaid**.",
        items: [
          "**Reserve a table** — book a table for a customer who comes later: name, phone, time and how many people.",
          "**Reservations** — all table bookings, today and the coming days.",
          "**Restaurant QR** — the restaurant's own code, for a customer without a table card.",
          "**Print QR cards** — the card for every table. **Download all** saves them to print outside.",
          "**A table in use** — the customer, how many people, and the waiter: **Waiter · Juma**.",
          "**No waiter yet** — a customer ordered from the card and nobody serves the table. | Tap the table to open it and take it.",
        ],
        notes: [tip("The colour tells the step: **Free**, **Reserved**, **Seated**, **Ordering**, **Bill asked**, **Paid**. A table that shows **Paid** is finished — clear it so it is **Free** for the next customer.")],
      }),
      tour("Open a table", {
        shot: "ck3-x-table", w: 78,
        intro: "Tap a table that is in use. Its sheet opens: the customer, the waiter, every order with its lines, and the money. The buttons are at the bottom.",
        items: [
          "**Add person** — a friend at the table who orders from their own phone.",
          "**Transfer table** — hand the table, with its orders, to a colleague on shift.",
          "**Add order** — opens **Sell** for this table.",
          "**Bill** — the bill of the whole table: print it, download it or share it.",
          "**Move** — the customer goes to another table with every order and the bill.",
          "**Clear table** — only after the customer has left, and everything is paid. | The tablet asks **Clear Table 2?** Tap **Yes, they left — clear it**. Before that the button says **Clear after payment**.",
        ],
        notes: [tip("**Bill asked** tells the Counter that the customer wants to pay. You never record the payment: the sheet says **The Restaurant Counter records the payment**.")],
      }),
      flow("What the customer sees when they scan", {
        intro: "Every card opens the same menu, already knowing **where** the customer is. The customer adds items, types a phone number and name, and places the order — paying now by mobile money, or adding it to the bill. It reaches the kitchen and your home page at once.",
        shots: [
          ["t-g-table", "**The card on a table** — **Table 3 · Inside**. Served at the table; the customer pays now, or when done."],
          ["t-g-counter", "**The card at the counter** — **Counter · Outside**. Served at the counter; pays now, or when done."],
          ["t-g-main", "**The Restaurant QR** — no table. Eat here or take out; take-out is paid first."],
        ],
      }),
      keep(
        h("Help a customer with the card"),
        dots([
          "The customer opens the phone camera, points it at the card and taps the link. No app is needed.",
          "The page opens in English. **中文** at the top changes it to Chinese.",
          "At the end the customer chooses **Pay now** (a payment request comes to their phone) or **Add to my bill** (they pay at the Counter after the meal).",
          "After the order is placed, the customer's phone shows each step: received, being prepared, ready, served.",
          "A hotel guest who scans the card **in their room** orders to the room, on the room bill.",
          "No internet on the customer's phone? Take the order yourself in **Sell** — it is the same order.",
        ]),
      ),
    ),

    chapter("Money: the Counter records every payment", "A waiter serves; the Restaurant Counter records the money, and Finance keeps the books. You never type a payment and you never keep cash until later.",
      tour("Collections — your shift in numbers", {
        shot: "w-pay-n", tall: true,
        intro: "Open [[Menu]] → [[Collections]]. This page only **shows**. It counts the orders of your shift and how each one was paid, exactly as the Counter recorded it.",
        items: [
          "**This shift** — from the minute you started until now.",
          "**Accepted · Claimed · Served · With you** — your work in this shift. | **With you**: orders still open under your name.",
          "**Your orders' value** — the total of the orders you handled.",
          "**At the Counter** — paid by cash, mobile money, bank or card. | **On room bills**: hotel guests, paid at check-out. **Paid by phone**: the customer paid with **Pay now** on their own phone.",
          "**Still to pay** — served or open, and not paid yet. | This must be **TZS 0** before you close your shift.",
          "**Each order** — the table, the amount, the step and **Not paid yet** or how it was paid.",
        ],
      }),
      keep(
        h("How a customer can pay"),
        table(["How", "Who records it", "What you do"], [
          ["**Cash**", "The Counter", "Bring the cash and the order number to the Counter at once."],
          ["**Customer's phone** — mobile money", "The Counter sends a payment request", "Take the customer to the Counter. They enter their PIN on their phone, and the order shows **Paid** by itself."],
          ["**LIPA Mix by Yas · Lipa M-Pesa**", "The Counter", "Bring the customer, or the payment message, to the Counter."],
          ["**CRDB Bank · NMB Bank · Card terminal**", "The Counter", "The customer pays at the Counter."],
          ["**On the room bill**", "The system — it goes on the stay", "Nothing to collect. Reception collects at check-out."],
          ["**Pay now, from the customer's own phone** (QR card)", "The system — at once, by itself", "Nothing to collect. The card already says **Paid**."],
        ]),
      ),
      keep(
        h("What the Counter does with your payment"),
        p("The Counter opens the order and taps **Take payment**. The first way is **Customer's phone** ((1)): the Counter checks the customer's number ((2)) and taps **Send prompt to their phone** ((3)). A request opens on the customer's phone, and the order changes to **Paid** by itself. For money brought to the Counter, it chooses **Cash** ((1)) or another way. **Brought by** ((2)) shows the waiter of the order — you — and **Mark as paid** ((3)) closes it. On your phone the order changes to **Paid** in a few seconds."),
        `<div style="width:70%;margin:0 auto">${pair(["ck3-c-pay-a", { cap: "The customer pays on their phone." }], ["ck3-c-pay-b", { cap: "Money brought to the Counter." }])}</div>`,
      ),
      rule("Never keep a customer's money in your pocket \"until later\". Every payment goes to the Counter straight away, and the Counter records it under the right order."),
      warn("If a customer says they paid by phone but the card still says **Unpaid**, do not argue and do not mark anything. Take them to the Counter — the Counter checks the payment."),
    ),

    chapter("Hand over and close your shift", "You cannot close your shift while an order or a table is still yours. Finish them, or hand them to a colleague who is on shift.",
      keep(
        h("First, hand over what is still yours"),
        dots([
          "On the order card tap [[Transfer]]; in the close-shift list tap the arrows beside the order or the table. A table goes together with its orders.",
          "Pick the colleague and the reason — **Going on break**, **End of my shift**, **Other section**, **Too busy right now**, or your own — then tap **Transfer**.",
          "**Served but not paid is still open** — you cannot close your shift with it. Have it paid at the Counter, or hand it over. Nobody else on shift? Call the Manager, who can close a shift with a reason.",
        ]),
      ),
      flow("Close your shift", {
        when: "You go home, or you stop working for the day.", tall: true,
        shots: [
          ["w-end-1", "Tap the switch **On shift · since …**. The page lists what is still yours: orders, tables and the money to pay. Tap [[!Hand everything to one colleague]]."],
          ["w-end-3", "Pick the colleague ((1)) — only waiters on shift are listed. Tap the reason ((2)), then **Transfer to Juma** ((3))."],
          ["w-end-4", "Nothing is left with you. Write a note if the next shift must know something, and tap [[!Close my shift]]. The switch says **Start my shift** again and your shift report is made."],
        ],
      }),
    ),

    chapter("Your reports and the rest of the menu", "The system writes your shift report by itself. You only read it.",
      task("My reports", {
        shots: ["w-reports-a", "w-reports-b"],
        intro: "Open [[Menu]] → [[My reports]]. Only you and the managers see this page.",
        steps: [
          "**This week** and **This month** — your shifts and your hours so far. | **Open my report so far** shows the orders you handled.",
          "**Weekly reports** — made every Monday. **Monthly reports** — made on the 1st.",
          "**My shift reports** — one for every shift, made when you close it: orders handled, served and completed.",
          "Tap a report to open it. | The Boss and the Manager receive the same numbers.",
        ],
      }),
      keep(
        h("The other pages in your menu"),
        table(["Page", "What it is for"], [
          ["**My shifts**", "Every shift you worked: when it started, when it closed and its report."],
          ["**Customers**", "Find a customer by name or phone. Everyone who orders is saved once, by phone number — never make the same customer twice."],
          ["**Reservations**", "Table bookings. Check it at the start of your shift, so a reserved table is not given away."],
          ["**Sell**", "Take an order (chapter 3)."],
          ["**Tables**", "The room at a glance and the QR cards (chapter 5)."],
          ["**Collections**", "Your shift in numbers (chapter 6)."],
        ]),
      ),
    ),
  ],

  rules: [
    ["Your own account, your own shift.", "Sign in as yourself and switch your shift on. Never serve under a colleague's name."],
    ["A phone number on every order.", "The phone is how the hotel knows the customer. Ask for it kindly, every time."],
    ["Check before you send.", "Read the order back to the customer, then tap Send to kitchen."],
    ["One order, one waiter.", "If the order has your name, you serve it. If you cannot, transfer it with the reason."],
    ["Never record money.", "The Counter records every payment. You bring it there at once."],
    ["Served and paid.", "Only then is an order finished. Unpaid stays open under your name."],
    ["Room bills: the guest's own room only.", "For any other room, send the guest to Reception."],
    ["Clear the table.", "When the bill is paid, clear the table so the next customer can sit."],
    ["Keep the bell on.", "A ready order rings twice. Hot food must not wait."],
    ["Hand over before you leave.", "Close your shift only when nothing is left with you."],
  ],

  problems: [
    ["The Counter cannot find my name in the list.", "You are not on shift. Tap the switch **Start my shift** on your home page."],
    ["A customer ordered from the QR card but I do not see it.", "Look under **No waiter yet** and **NEW ORDERS**. Ask to see the customer's phone: after **Place order** it shows the order number. If it never arrived, take the order in **Sell**."],
    ["I sent a wrong item.", "Open the order and remove the line, with the reason. If the kitchen has already made it, call the Manager."],
    ["The order is ready but my phone did not ring.", "Look at the bell. Red: sound is off — tap it. Amber: tap the screen once. Keep the home page open while you work."],
    ["The customer wants to pay by mobile money.", "Take them to the Counter. The Counter sends a payment request to their phone (**Customer's phone**), or records **LIPA Mix by Yas** or **Lipa M-Pesa** when they paid that way."],
    ["I cannot accept an order: the card says **Paying online — accept once it is paid**.", "The customer chose **Pay now** and has not yet entered their PIN. Wait — it can be accepted when the payment is confirmed. **Take out · not paid online yet** means the customer has not started to pay: take-out waits for its payment. Still stuck after a few minutes? Tell the Counter."],
    ["The guest wants it on the room, and the system refuses.", "The phone number is not the one on the stay. Send the guest to Reception — only Reception can use another room."],
    ["I cannot close my shift.", "Something is still yours. The page lists it: finish it and have it paid, or tap **Hand everything to one colleague**."],
    ["A customer left without paying.", "Tell the Counter and the Manager at once. Do not change or remove the order yourself."],
    ["The pages are in Chinese (or English) and I cannot read them.", "Tap **EN** or **中文** at the top of the page."],
    ["The page does not open, or it looks broken.", "Check the internet on your phone, close the page and open it again. Still wrong? Write to Nino — the last page of this book."],
  ],
};
