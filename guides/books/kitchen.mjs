import { chapter, task, tour, flow, tip, warn, rule, p, h, dots, table, beside, shot, keep, pair } from "../tools/kit.mjs";

export default {
  id: "kitchen", file: "Vegas-Guide-04-Kitchen-and-Bar.pdf", name: "Kitchen and Bar guide", dept: "kitchen", accent: "#2f7a4f", soft: "#e8f3ec",
  kind: "Restaurant & bar", kicker: "Guide book 04", title: "Kitchen | and Bar",
  sub: "The kitchen board, cooking an order from New to Ready, drinks, the kitchen stock, waste and asking for stock — step by step, on the tablet.",
  cover: { shots: ["k-home-c"] },
  lead: "This book is for the cook — **Mpishi** — and everyone who works in the kitchen and at the bar of Vegas Restaurant & Bar. The kitchen works on the tablet. Every order of the restaurant arrives there by itself: you accept it, tick each item as it is made and tap **Ready**. The same tablet keeps the kitchen stock, the waste and the list of what must be bought. Every page shows the real screen and the button to tap.",

  place: [
    h("What the kitchen hands over"),
    table(["What", "Goes to", "How it gets there"], [
      ["A ready order", "The waiter of the order", "You tap **Ready**. The card moves to **Ready to serve** and the waiter comes for it."],
      ["An order you cannot make", "Reception and the customer", "You tap **Decline** and give the reason. Reception sees it and tells the customer."],
      ["A dish that is finished", "Everybody who takes orders", "You tick it as **Sold out** when you decline. Nobody can order it again until it is back."],
      ["Waste", "Manager", "**Send to the manager** on the item. The stock drops when the Manager approves it."],
      ["The list of what to buy", "Manager", "**Ask for stock**. The Manager reviews it and it is bought."],
    ]),
    h("What comes to the kitchen"),
    table(["What", "From", "Where you see it"], [
      ["An order", "A waiter, the Counter or Reception", "A new card in the **New** column, and the tablet rings twice."],
      ["An order a customer made alone", "The QR card on a table, at the counter or in a room", "The same — the card says **Table QR**."],
      ["A gift order", "Spin to Win, played by a hotel guest", "A card that says **SPIN TO WIN — COMPLIMENTARY GIFT**."],
      ["Stock", "The store, after the Manager approved the buying", "The number of the item goes up in **Inventory**."],
    ]),
  ],

  chapters: [
    chapter("The kitchen's home page", "The kitchen tablet stays signed in and open on Home. Home is the board of the kitchen: four boxes that count the orders, and under them one card for every order.",
      tour("The kitchen, at a glance", {
        shot: "k-home-a",
        items: [
          "**NEW ORDERS** — waiting for you to accept. | It names the first one: its number, its place and how many items. Tap the box to open it.",
          "**PREPARING** — the orders you are making. | And how many of their items are done: **0 of 7 items done**.",
          "**READY** — made, and waiting for a waiter.",
          "**SERVING** — on the way to the customer. | Under it: how many orders are completed today.",
          "**YOUR KITCHEN** — the board. One card for every order, in four columns: **New**, **Preparing**, **Ready to serve** and **Handed over**. | **New order →** on the right opens **Sell**.",
        ],
        notes: [tip("**Restaurant QR** under the greeting is the restaurant's own code. A customer who scans it orders from their phone — and the order comes to this board.")],
      }),
      keep(
        h("The top and the side of every page"),
        dots([
          "**The menu** (left) — Home, Sell, Tables, History, Inventory, Stock requests and **Sign out**. | **Home** always brings you back to the board.",
          "**The date and the hotel day** — the day runs from 04:00 to 04:00. | An order after midnight still belongs to the same working day.",
          "**The bell** — a new order rings **twice**: now, and again after 5 seconds. Then it stops. | Green dot: sound is on. Amber dot: tap the screen once so the tablet may ring. Red dot: the sound is switched off.",
          "**EN / 中文** — changes the language of your pages. It does not change what customers see.",
          "**Your initials** (top right) — your account. The arrow beside them is **Sign out**.",
        ]),
      ),
      keep(
        h("A day in the kitchen"),
        table(["When", "What you do on the tablet"], [
          ["**When you start**", "Open **Home** and look at the bell: the dot must be green. Open **Inventory** and tap **Low stock** — what is low today? Send the stock request now (chapter 6)."],
          ["**During service**", "Stay on **Home**. Accept each new order, tick the items as they are made, and tap **Ready** (chapter 3)."],
          ["**When something runs out**", "Decline the order with **Out of stock** and tick the dish as sold out (chapter 3)."],
          ["**Before you leave**", "Report the waste of the day (chapter 5). Look at the board: no order should be left under **New** or **Preparing**."],
        ]),
      ),
      rule("Keep the tablet on **Home**, with the sound on, where the whole kitchen can see it. An order that nobody accepts is a customer who waits."),
    ),

    chapter("Cook an order", "Every order is a card. You accept it, you tick each item when it is made, and you tap Ready. From there the waiter takes over.",
      tour("The cards on the board", {
        shot: "k-flow-1a",
        intro: "Scroll down on Home to **YOUR KITCHEN**. New orders are on the left; the orders you are making are beside them.",
        items: [
          "**Accept** — you start the order. | The card moves to **Preparing**.",
          "**Decline** — you cannot make it. | You give the reason — see below.",
          "**The round tick** at the end of each line — tap it when that item is made. | The line is struck through. Tapped by mistake? Tap it again.",
          "**Tick the items · 2 left** — how many items are still to make. | When nothing is left, it turns into the gold **Ready** button.",
        ],
      }),
      flow("One order, from New to Ready", {
        frame: "desk",
        shots: [
          ["k-card-1", "Tap **Accept**. The order is yours to make."],
          ["k-card-2a", "Tick each item when it is made — the food and the drinks."],
          ["k-card-3a", "Everything is ticked: tap the gold **Ready**."],
        ],
      }),
      keep(
        h("What a card tells you"),
        dots([
          "**The place** — the table, the room or the counter. | On the right, how long the order has waited. The time turns red when it has waited long.",
          "**The customer, where the order came from, and its number** — Joyce Mwakyusa · Table QR · #12. | **Waiter** or **Staff**: one of us took it. **Table QR**: the customer ordered from the card on the table.",
          "**FOOD** and **DRINKS** — every item, with how many: **2×**. | What the customer asked for — no onions, extra spicy — is written under the items. Read it before you cook.",
          "**The chip** — **Waiter · Baraka** is the waiter who comes for it. **No waiter yet**: nobody has taken it — the Counter gives it to a waiter.",
          "**The bottom line** — In 16:11 · accepted 16:15 · Chef. | When the order came in, when it was accepted and by whom.",
          "**The small buttons** — the bill of the order, and its history: every step, with the name and the time. The small **✕** on an order you are making declines it.",
        ]),
        tip("The kitchen's cards show **no prices**. Money is the work of the Counter and Reception — the kitchen only cooks."),
      ),
      keep(
        h("After you tap Ready"),
        p("The card moves to **Ready to serve** and waits for its waiter. The waiter taps **Serve** on their phone and collects the order: the card moves to **Handed over**. Your work on it is finished."),
        shot("k-flow-3a", { w: 86 }),
      ),
      keep(
        h("Decline an order"),
        p("Tap **Decline** on a new order, or the small **✕** on an order you are making. The tablet asks **Decline the order for Table 3 — Inside?** Tap the reason: **Out of stock**, **Kitchen is closing**, **Too busy right now**, **Can't make it as asked** — or type your own under **Or say why…**"),
        dots([
          "**The order leaves the board.** Reception sees it as declined, with your reason, so the customer can be told.",
          "**Ran out?** In the same box, tick the dish under **Mark it sold out** — nobody can order it again. When it is back, tell the Manager or the MD so it returns to the menu.",
          "**An order on a room bill** comes off the room bill by itself.",
          "**An order that was already paid** — Reception gives the money back.",
        ]),
      ),
      beside("k-gift-c", 58,
        h("A Spin to Win gift"),
        p("A hotel guest can win food or a drink in the game **Spin to Win**. The gift comes to the kitchen as an order. Its card says **Spin to Win** beside the guest's name, and **SPIN TO WIN — COMPLIMENTARY GIFT · Nothing to pay**."),
        p("Make it like any other order: **Accept**, tick the items, **Ready**. It usually goes to the guest's room."),
      ),
      rule("Tick an item only when it is really made, and tap **Ready** only when the whole order can leave the kitchen. **Ready** calls the waiter — a waiter who comes for food that is not there loses time, and the customer waits longer."),
    ),

    chapter("Drinks and the bar", "Drinks are part of the same order. There is no separate bar screen: every card lists the FOOD and the DRINKS, and the system knows who must do what.",
      keep(
        h("Who does what"),
        table(["The order has", "Who accepts it", "How it gets ready"], [
          ["**Food**, or food and drinks", "The cook — **Accept** on the kitchen tablet.", "The cook ticks **every** line, the drinks too, then taps **Ready**. The waiter collects the food and the drinks together."],
          ["**Only drinks**", "A waiter — **Accept** on their own phone.", "Nobody ticks and there is no **Ready**. The waiter takes the drinks at the bar and brings them."],
        ]),
      ),
      keep(
        h("Good to know"),
        dots([
          "**Tick the drink line** when the drinks stand ready beside the food. The gold **Ready** button does not show while a drink is not ticked.",
          "**A card with only drinks can also show on the kitchen board**, because the cook may prepare any order. Normally the waiter takes it.",
          "**A drink is finished?** Decline the order with **Out of stock** and tick the drink under **Mark it sold out**, exactly like a dish.",
          "**The bar has its own stock.** In **Inventory**, tap the chip **Bar**. In **Stock requests**, tap **Bar** before you choose the beers, wines, whiskies and spirits to buy (chapters 5 and 6).",
        ]),
      ),
      tip("The waiter's side of a drinks order is in the **Waiters** guide book (02): the order sits under **NEW ORDERS** on the phone — the waiter accepts it, pours and serves."),
    ),

    chapter("The kitchen stock", "Inventory shows what the kitchen has, what is low and what is finished. The numbers move by themselves when you cook — and every other change is written down with a name and a reason.",
      tour("Kitchen stock", {
        shot: "k-inv-a", w: 84,
        intro: "Open [[Inventory]] in the menu.",
        items: [
          "**Ask for stock** — start the list of what must be bought (chapter 6).",
          "**Kitchen stock** — how many items there are and what they are worth today. | The chips under it change the department: **Kitchen**, **Bar**, **Restaurant** and the others.",
          "**Stock** — the list of every item. | **Overview**, before it, is the day at a glance: low and finished items, what was used and wasted today.",
          "**Movements** — everything that came in or went out, with who and why.",
          "**Waste** — the waste that was reported, and what still waits for the Manager.",
          "**Low stock** — only the items under their minimum. | **Out of stock**, before it: the items that are finished.",
        ],
        notes: [p("Each line is one item: its name, where it is kept and its minimum — **Cold room · min 20 kg** — how much there is now, and what it is worth. **Low stock** or **Out of stock** is written on the line. The bin at the end of the line reports waste. Tap the line to open the item.")],
      }),
      keep(
        h("Why the numbers change"),
        table(["Movement", "What happened", "Who records it"], [
          ["**Receive**", "Goods arrived and went into the store.", "The Manager."],
          ["**Sale by recipe**", "A dish was cooked. Each dish has a recipe; when its order becomes **Ready**, the ingredients are taken off the stock.", "The system, by itself."],
          ["**Use**", "Something was taken out for another reason — a buffet, a staff meal.", "You — see below."],
          ["**Waste**", "Something was spoiled, expired, broken or spilt.", "You report it. The Manager approves it."],
          ["**Count**", "The shelves were counted and the number corrected, with the reason.", "The Manager."],
        ]),
      ),
      task("Report waste", {
        when: "Food is spoiled, expired, broken or spilt, or it came back from a guest.",
        shot: "k-waste-a", side: 72,
        intro: "On the **Stock** list, tap the bin at the end of the item's line. Or tap the item and then **Waste**.",
        steps: [
          "**Wasted** — type how much.",
          "Tap the reason: **Spoiled**, **Expired**, **Damaged / broken**, **Wasted (cooking, spilt)** or **Returned by guest**.",
          "**What happened?** — say it in a few words: fridge off overnight.",
          "Tap [[!Send to the manager]].",
        ],
        notes: [warn("**A manager approves waste — the stock drops once it is approved.** Until then it waits under **Waste** → **Waiting for approval**. If the Manager rejects it, the stock stays as it was.")],
      }),
      keep(
        h("Take something out — Use"),
        p("Tap the item, then **Use**. Under **Used**, type how much. Tap what it was for — **Kitchen usage**, **Restaurant consumption**, **Bar usage** — add a note if it helps (for tonight's buffet), and tap the gold button **Take out**. The stock drops at once."),
        dots([
          "**Do not use it for the dishes you cook from orders.** Their ingredients are taken off by the recipe when you tap **Ready** — taking them out again would count them twice.",
          "**History**, the third tab of the item, lists every movement of this item, and the dishes that use it.",
        ]),
      ),
    ),

    chapter("Ask for stock", "When something is low, the kitchen sends a stock request to the Manager. You tap the pictures, check the list and send it — no paper, no phone call.",
      task("Make the list", {
        when: "An item shows Low stock or Out of stock — or you know you will need it.",
        shot: "k-req-2a", side: 84,
        intro: "Open [[Stock requests]] in the menu, or tap **Ask for stock** on the inventory page. On top, choose the department: **Kitchen**, **Bar** or **Other department…** Then tap a group — **Meat & fish**, **Vegetables & fruit**, **Rice, flour & dry food** — or type in **Search**.",
        steps: [
          "Tap the picture of each thing you need. | The picture shows **1**. Tap it again for more.",
          "**Your list** — check every line. | **+** adds one, the bin takes the line away, and the box at the end is the unit: kg, pcs.",
          "**Urgent** — switch it on only when it cannot wait. | On: **The manager sees it first**. Off: **Normal — on the next shopping**.",
          "Tap [[!Check the list]].",
        ],
        notes: [
          tip("**Not in the pictures?** Tap **Something else**, the last picture of the group. Type what it is and how many."),
          p("Under **Urgent** you can say **What is it for?** and write a **Note for the manager**. Both are optional — but a clear note gets a fast answer."),
        ],
      }),
      task("Check it and send it", {
        shot: "k-req-3a", side: 80,
        steps: [
          "**Check your list** — the request as the Manager will read it: who asks, the department, the date, the priority, and every item with how many.",
          "Something is wrong? Tap [[Change it]] and correct the list.",
          "Tap [[!Send 2 items to the manager]]. | The page answers with the number of the request, and says it is waiting for the manager.",
        ],
        notes: [tip("**Print**, **PDF** and **Picture** keep a copy of the list — on paper or on the tablet. You do not need one to send it.")],
      }),
      keep(
        h("After you send it"),
        table(["On your page", "What it means"], [
          ["**Waiting**", "The Manager has the request and has not decided yet."],
          ["**Approved**", "The Manager said yes. It is being bought."],
          ["**Done lately**", "It is finished: the goods were bought and checked."],
        ]),
        p("Tap **Requests**, beside **New request**, to see your requests. Tap one to open it. When the goods are received into the store, the number of each item goes up in **Inventory**."),
      ),
      rule("Ask **before** it runs out. Look at **Low stock** when you start work, and send one clear list — not five small ones."),
    ),

    chapter("Sell, Tables and History", "Three more pages of the restaurant are in the kitchen's menu. You will use them less than the board — but it helps to know them.",
      tour("Order history", {
        shot: "k-history-a", side: 104,
        intro: "Open [[History]] in the menu. Every finished, cancelled and declined order is kept here.",
        items: [
          "**Today** — or **Yesterday**, **Last 7 days**, **Last 30 days**.",
          "**Done** — only the finished orders. | **All**, before it, shows everything.",
          "**Cancelled & declined** — the orders that were not made, with the reason.",
        ],
        notes: [p("The three boxes count them: **ORDERS**, **DONE** and **CANCELLED / DECLINED**. On each line, **Receipt** opens the receipt and **Steps** shows every step of the order — who accepted it, who made it ready, who served it, and when.")],
      }),
      keep(
        h("Sell and Tables"),
        `<div style="width:76%">${pair(["s-chef-restaurant-pos", { cap: "**Sell** — take an order yourself." }], ["s-chef-restaurant-tables", { cap: "**Tables** — the whole room." }])}</div>`,
        dots([
          "**Sell** — when a customer orders with you directly. Tap the dishes, choose **Dine in**, **Takeaway** or **Pickup** and the table, and send the order. | **Open orders**, on top, lets you **Accept** and **Tick items** without leaving the page. The full steps are in the **Restaurant Counter** guide book (03).",
          "**Tables** — which tables are **In use**, **Reserved** and **Free**, and the step of each: Free, Reserved, Seated, Ordering, Bill asked, Paid. | **Print QR cards** prints the card of every table.",
        ]),
      ),
    ),
  ],

  rules: [
    ["Accept first.", "A new order waits until somebody taps Accept. The customer is waiting too."],
    ["Read the whole card.", "The items, how many, and what the customer asked for — before you cook."],
    ["Tick what is made.", "A tick means the item is really made. Never tick ahead."],
    ["Ready means ready.", "Tap Ready only when the whole order can leave the kitchen. Ready calls the waiter."],
    ["Decline with the true reason.", "Reception tells the customer what you chose."],
    ["Finished? Say it at once.", "Tick the dish as sold out, so nobody orders it again."],
    ["No money in the kitchen.", "The cards show no prices. Payments are recorded at the Counter and at Reception."],
    ["Stock is never typed over.", "It changes by a movement: received, used, wasted or counted — with a name and a reason."],
    ["Report waste the same day.", "With what happened. The Manager approves it before the stock drops."],
    ["Ask before it runs out.", "Low stock in the morning is a stock request in the morning."],
  ],

  problems: [
    ["A new order came, but the tablet did not ring.", "Look at the bell. Red: the sound is off — tap it. Amber: tap the screen once. Keep the tablet on **Home**."],
    ["The gold **Ready** button does not show.", "One line is not ticked yet — often a drink. Tick every line of the order."],
    ["I ticked an item by mistake.", "Tap the tick again. It comes off, as long as the order is not **Ready**."],
    ["A card stays under **Ready to serve**.", "The waiter has not come. The chip says who: **Waiter · Baraka** — call them. **No waiter yet**: ask the Counter to assign a waiter."],
    ["One dish of the order is finished, the rest can be made.", "Tell the waiter or the Counter before you cook. If the customer does not want the rest, decline the order with **Out of stock** and tick the dish as sold out."],
    ["An order has only drinks.", "A waiter accepts it on their phone and brings the drinks. You do not need to tick it."],
    ["The stock number does not match the shelf.", "Do not correct it yourself. Tell the Manager — they count the item and correct it with the reason. **History** on the item shows every movement."],
    ["I reported waste, but the stock did not drop.", "It waits for the Manager. Look under **Waste** → **Waiting for approval**."],
    ["What I need is not in the pictures.", "Tap **Something else** at the end of the group, and type what it is and how many."],
    ["I sent a stock request with a mistake.", "Tell the Manager. They review every request before anything is bought."],
    ["The pages are in Chinese (or English) and I cannot read them.", "Tap **EN** or **中文** at the top of the page."],
    ["The page does not open, or it looks broken.", "Check the internet on the tablet, close the page and open it again. Still wrong? Write to Nino — the last page of this book."],
  ],
};
