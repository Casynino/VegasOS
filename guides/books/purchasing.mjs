import { chapter, task, tour, tip, warn, rule, p, h, dots, table, cards, shot, keep, fmt } from "../tools/kit.mjs";

// "Do this | a smaller line under it"
const line = (s) => { const [a, b] = String(s).split(" | "); return fmt(a) + (b ? `<small>${fmt(b)}</small>` : ""); };
const run = (c, blocks) => (blocks ?? []).map((b) => (typeof b === "function" ? b(c) : b)).join("");

/** A view with two or more pictures (one after the other) and one list of numbers: the numbers on the pictures continue from one to the next. */
const view = (title, o) => (c) => {
  const no = c.next();
  const pics = o.shots.map(([id, w]) => shot(id, { w: w ?? 100 }));
  const items = `<ol class="legend${o.cols === 1 ? " c1" : ""}"${o.cols === 1 ? ' style="columns:1"' : ""}>${o.items.map((s) => `<li>${line(s)}</li>`).join("")}</ol>`;
  return `<article class="task"><div class="keep"><header class="t-head"><span class="t-no">${no}</span><h2>${fmt(title)}</h2></header>${o.intro ? `<p class="txt" style="margin-left:11mm">${fmt(o.intro)}</p>` : ""}${pics[0]}</div>${pics.slice(1).join("")}${items}${run(c, o.notes)}</article>`;
};

/** The story of one request: a small picture, who does the step, and what happens. */
const story = (rows) => () => rows.map(([n, who, title, text, pics, sees, w]) => `<div class="split" style="grid-template-columns:90mm 1fr;gap:6mm;margin:0;padding:3mm 0;border-top:0.5pt solid #dfe2e8">
  <div>${pics.map((id) => shot(id, { wrap: "fig", w })).join("")}</div>
  <div><p class="txt" style="margin:0 0 1mm"><span class="n">${n}</span> <b>${fmt(title)}</b></p>
    <p class="txt" style="margin:0 0 1.2mm;font-size:7.6pt;letter-spacing:.14em;text-transform:uppercase;color:#a16207;font-weight:650">${fmt(who)}</p>
    <p class="txt" style="margin:0;font-size:9pt">${fmt(text)}</p>
    ${sees ? `<p class="txt" style="margin:1.4mm 0 0;font-size:8.2pt;color:#6a7285">${fmt(sees)}</p>` : ""}</div></div>`).join("");

export default {
  id: "purchasing", file: "Vegas-Guide-12-Purchasing.pdf", name: "Purchasing guide", dept: "purchasing", accent: "#a16207", soft: "#f6efdc",
  kind: "Buying", kicker: "Guide book 12", title: "Purchasing",
  sub: "Quotations, orders, deliveries and invoices — step by step.",
  cover: { shots: ["pu-cover"] },
  lead: "This book is for **Purchasing**: you get the prices, make the orders and receive what the hotel buys. In the system your role is called **Accountant** and your page is **Procurement**. You buy. You **never approve and never pay** — that is Finance.",
  lastTitle: "Golden rules and problems", lastLead: "The few things to do the same way every time — and what to do when something goes wrong.",

  togetherLead: "No department works alone. What you press on your screen appears on somebody else's screen a moment later. Purchasing sits in the middle of the buying line: Finance says yes, you buy, Finance pays. The gold lines are the ones you use.",

  place: [
    h("What comes to Purchasing"),
    table(["What", "From", "Where you see it"], [
      ["A request Finance approved", "Finance", "Tab **To quote**, and in the bell: **get quotations for …**"],
      ["A quotation Finance sent back", "Finance", "Tab **To quote** — an amber note says why. In the bell: **Finance sent … back, get a better price**."],
      ["A price that is allowed", "Finance — or nobody, when it is inside the budget", "Tab **Ready to order**, and in the bell: **price authorized, issue the order**."],
      ["The goods", "The supplier", "Tab **On order**. You record what arrives. A late order shows red, and in the bell."],
    ]),
  ],

  chapters: [
    // ───────────────────────── 2
    chapter("Your role and your screen", "Finance says what may be bought. You buy it. Finance pays.",
      keep(
        h("What you do, and what you never do"),
        table(["You do", "You never do"], [
          ["Get quotations from suppliers and write each one down", "Approve a request, or change its budget — that is Finance"],
          ["Propose the quotation to buy from", "Authorize a price above the budget — Finance. Above its limit, the Boss or the MD."],
          ["Issue the purchase order", "Verify, dispute or pay a supplier invoice — Finance"],
          ["Record each delivery: what you accept, what you refuse", "Touch the accounts, the income or the expenses"],
          ["Record the supplier's invoice, and keep every paper", "Record an expense. One expense is made only when Finance really pays."],
          ["Cancel an order that did not arrive, or an invoice recorded by mistake — with a reason", "Change the stock yourself — in **Inventory** you can only look"],
        ]),
      ),
      tour("Signing in", {
        shot: "fa-signin", side: 80,
        intro: "Open the hotel's staff page on a computer, a tablet or a phone. The sign-in page is the same for the whole hotel. You do not need to start a shift.",
        items: [
          "**Email** — your own email address, the one the administrator gave you.",
          "**Password** — your own password. Nobody else knows it, and nobody else uses your account.",
          "Press [[!Sign in]]. | Your page opens by itself: **Procurement**.",
        ],
        notes: [p("**Forgot your password?** Ask the hotel administrator. The system keeps your name on everything you do, which is why an account is never shared.")],
      }),
      keep(
        h("What goes out from Purchasing"),
        table(["What", "Goes to", "How"], [
          ["A price above the budget", "Finance", "You press **Propose this one**. The purchase waits on the tab **With Finance**."],
          ["A purchase order", "The supplier, and the asker", "**Issue the purchase order**. The asker sees **Purchased**. You tell the supplier the order number and the day — the system does not send it."],
          ["Accepted goods", "The stores", "**Record a delivery**. The stock goes up by what you accept, and no more."],
          ["The supplier's invoice", "Finance", "**Record an invoice**. Finance checks it and pays it."],
        ]),
      ),
      keep(
        tour("Your menu", {
          shot: "pu-c-menu",
          intro: "You have three places in the menu on the left.",
          items: [
            "**Home** — this is the Procurement page, where all your work is. | You land here when you sign in.",
            "**Inventory** — the stores. You look at the stock before you buy. You cannot change it here.",
            "**Purchase requests** — where you ask for what **you** need, like every department. | The review belongs to Finance.",
          ],
        }),
      ),
      tour("Your page: Procurement", {
        shot: "pu-c-board", w: 86,
        intro: "Every request that Finance approved comes to this page. It stays here until it is paid.",
        items: [
          "**The tabs** — six steps, from To quote to Closed. The number on a tab counts what is there. A purchase is on one tab only.",
          "**A purchase** — its number, and its name when the person gave one. Press it to open the purchase.",
          "**Budget** — the most Finance allows. A number with **~** is only the asker's guess.",
          "**Where it stands** — the step in words, in a coloured label.",
          "**Filters** — find a purchase by number, department, person, supplier, amount or date.",
        ],
        notes: [tip("You do not see Finance's money tiles or what Finance still owes the suppliers. That part of the page is Finance's.")],
      }),
      keep(
        h("Who else touches a request"),
        cards([
          ["The asker", "Reception, the Counter, the kitchen", "Asks for what the department needs. Sees only seven simple words: Submitted, More information needed, Approved, Purchased, Completed, Rejected, Cancelled."],
          ["Finance", "Holds the money", "Reviews the request and sets the budget. Authorizes a price above the budget. Verifies the invoice and pays the supplier."],
          ["The Manager", "Supervises", "Can review a request too. Does not open Procurement, does not get quotations and does not make orders."],
          ["The Boss and the MD", "Hold everything", "Can do every step. Above the limit set in Settings, only they can authorize a price."],
        ], 2),
      ),
      task("What the asker sees", {
        when: "So that you know what the department knows.",
        shot: "pu-c-asker-open", side: 78,
        steps: [
          "**Approved** — the word for the asker from the day Finance says yes until the order is made.",
          "**The budget** Finance approved. The asker never sees quotations, prices or invoices.",
          "**The line** — “the Accountant is getting quotations from suppliers”. That is you.",
        ],
        notes: [p("After the order the word becomes **Purchased**. It stays **Purchased** until Finance has paid. Then it is **Completed**.")],
      }),
      task("Ask for what you need", {
        when: "Paper, a printer, a cupboard for your own desk.",
        shot: "pu-c-requests", side: 78,
        steps: [
          "Open **Purchase requests** in the menu.",
          "**New request** — tap the pictures, set the numbers, check the list and send it to Finance.",
          "**Requests** — your own requests and where each one stands.",
          "**Other department…** — you may ask for any department.",
        ],
        notes: [p("Finance reviews your request like any other. You cannot approve your own request.")],
      }),
      rule("You buy. Finance approves and pays. Never the other way round."),
    ),

    // ───────────────────────── 3
    chapter("The requests that reach you", "Every purchase is on one tab. The tab tells you what waits, and for whom.",
      keep(
        h("The six tabs"),
        table(["Tab", "What it means", "Who must act"], [
          ["**To quote**", "Finance approved it. Nobody has proposed a price yet — or Finance sent the price back.", "**You.** Get quotations and propose one."],
          ["**With Finance**", "You proposed a price above the budget.", "**Finance.** You wait."],
          ["**Ready to order**", "The price may be used: inside the budget, or Finance authorized it.", "**You.** Issue the purchase order."],
          ["**On order**", "The order is made. The goods are not all here.", "**The supplier** — and you, when they arrive."],
          ["**Invoices and payment**", "Everything has arrived, or the rest is not coming.", "**You** record the invoice. **Finance** verifies and pays."],
          ["**Closed**", "Delivered, invoiced and paid — or cancelled.", "Nobody. You can look back."],
        ]),
      ),
      keep(
        h("Every day, in this order"),
        dots([
          "**To quote** — get the prices for what Finance approved, and propose one. Look at the bell first.",
          "**Ready to order** — issue the purchase orders that are allowed. Do it on the day, before the price runs out.",
          "**On order** — goods that are late show red. Call the supplier. Record what arrives.",
          "**Invoices and payment** — a purchase that says **no invoice yet** waits for you. Record the supplier's invoice.",
          "**With Finance** — nothing to do. Only look: Finance has to answer.",
        ]),
      ),
      tour("Tab 1 · To quote", {
        shot: "pu-c-tab-quote",
        intro: "Open this tab first, every morning. Everything here waits for you.",
        items: [
          "**To quote** — the number is how many purchases wait for a price.",
          "**Approved — awaiting supplier quotation** — Finance said yes. The next step is yours.",
        ],
      }),
      tour("Tab 2 · With Finance", {
        shot: "pu-c-tab-authorize",
        intro: "You proposed a price that is above the budget. Finance must say yes before anything is ordered.",
        items: [
          "**With Finance** — the purchases that wait for Finance.",
          "**The purchase** — its number, the supplier you proposed, the budget and the price.",
          "**Waiting for Finance to authorize the price** — you cannot do anything here. Finance can authorize it, or send it back to you.",
        ],
      }),
      tour("Tab 3 · Ready to order", {
        shot: "pu-c-tab-order",
        intro: "The price is allowed. Make the purchase order now.",
        items: [
          "**Ready to order** — the purchases waiting for your order.",
          "**The purchase** — the supplier and the price you proposed.",
          "**Price authorized — ready to order** — open the purchase and press **Issue the purchase order**.",
        ],
      }),
      tour("Tab 4 · On order", {
        shot: "pu-c-tab-delivery",
        intro: "The order is made. This tab is your list of goods that you wait for.",
        items: [
          "**On order** — the orders that are not fully delivered.",
          "**The order number** — PO-year-number. The request number is under it.",
          "**The day it is due** — in red, with **late — was due …**, when the day has passed. The bell tells you too.",
        ],
      }),
      tour("Tab 5 · Invoices and payment", {
        shot: "pu-c-tab-invoices",
        intro: "Everything has arrived. A purchase stays here until every invoice is paid.",
        items: [
          "**Invoices and payment** — the purchases with goods in and the money still open.",
          "**1 invoice to verify** — you recorded it, Finance has not checked it yet. Other words here: **n invoices to pay**, **an invoice is disputed**.",
          "**no invoice yet** — your step. Record the supplier's invoice.",
          "**an invoice is disputed** — Finance found something wrong. Read why, and ask the supplier for a good invoice.",
        ],
      }),
      tour("Tab 6 · Closed", {
        shot: "pu-c-tab-closed",
        intro: "Finished purchases. Open one to see the whole story: every quotation, delivery, invoice and payment.",
        items: [
          "**Closed** — purchases that went through an order and are finished.",
          "**Done** — everything arrived and every invoice is paid. The asker sees **Completed**. A cancelled order is here too.",
        ],
      }),
      tour("Find a purchase", {
        shot: "pu-filters", w: 88,
        intro: "Press **Filters** to open the boxes. Press **Show**. **Clear** puts the list back.",
        items: [
          "**Number, title or supplier** — type a part of the number, the name or the supplier.",
          "**Department** — and, next to it, who asked and which supplier.",
          "**Amount from … up to …** — and the dates **From** and **To**.",
          "**Show** — applies the filters to the tab you are on.",
        ],
        notes: [tip("A purchase that you cannot find is on another tab. The number on each tab counts only what matches your filters — press **Clear** first.")],
      }),
      tour("The bell tells you what waits", {
        shot: "pu-c-bell",
        intro: "The bell at the top shows what is waiting for you. Press a line to open the purchase.",
        items: [
          "**Purchase — get quotations for …** — a request Finance approved. **urgent** is added when it is urgent.",
          "**Purchase — Finance sent … back, get a better price** — the price was refused. Open it to read why.",
        ],
        notes: [
          table(["Other notes you may see", "What to do"], [
            ["**Purchase — price authorized, issue the order for …**", "Open it and issue the purchase order."],
            ["**Purchase — delivery of PO-… is late, it was due …**", "Call the supplier. Record the delivery when it arrives."],
            ["**Your request — …**", "About a request you asked for yourself."],
          ]),
        ],
      }),
    ),

    // ───────────────────────── 4
    chapter("Quotations", "A quotation is one supplier's price. You ask the suppliers yourself, then write each price here. Recording a quotation buys nothing.",
      tour("Open the purchase, check the stock", {
        shot: "pu-c-wanted", w: 72,
        intro: "Open a purchase from the tab **To quote**. Before you ask for prices, look at what is wanted.",
        items: [
          "**Their estimate** — what the asker guessed. It is **not an expense**.",
          "**Approved budget** — the most Finance allows. A price above it must be authorized by Finance.",
          "**In stock now** — what the stores hold. **low** in amber means below the level where the stores must order again. | If the stock is already enough, tell Finance before you buy.",
        ],
        notes: [p("**Asked** is what the department wanted. **Approved** is what Finance allows. You may never buy more than **Approved**.")],
      }),
      task("Record a quotation", {
        when: "A supplier gave you a price.",
        shot: "pu-c-q-doc", w: 62,
        steps: [
          "Press **Add a quotation** on the purchase. In **Supplier** choose the supplier from the list. | For one who is not in the list, see the next page.",
          "**Price each (TZS)** — type the price of one piece, litre or kilo, in whole shillings. | Take the tick away from an item the supplier did not price.",
          "**Quotation total** — the system adds it. Check it against the supplier's paper.",
          "**Price holds until** — the last day the supplier keeps this price.",
          "**Delivery takes (days)** — how long until the goods arrive.",
          "**The supplier's quotation (photo or PDF)** — attach the paper or a photo of it. | A photo (JPG, PNG, WebP, HEIC) or a PDF, up to 5 MB.",
          "Press [[!Record the quotation]]. The message says **Quotation recorded.**",
        ],
        notes: [
          warn("**Price every item you want to buy.** An item with no price is not on the quotation, so it is not on the order."),
          p("You may not buy more than Finance approved: the number in the **Quantity** box is already that number. The **Note** box is for what is special, for example “price only for 40 litres at once”."),
        ],
      }),
      keep(
        h("A supplier who is not in the list"),
        p("In **Supplier** choose **A new supplier…**. Two more boxes open: the supplier's name, and the phone (you may leave the phone empty). When you press **Record the quotation** the supplier joins the list. If the name is already in the list, the system uses that supplier and does not make a second one."),
        p("Your screen adds a supplier's name and phone only. To change a supplier's details, or to stop using one, ask the MD."),
      ),
      tour("Compare the quotations", {
        shot: "pu-c-quotes",
        intro: "Record every price you get, even when it is not the best one. The page puts them side by side.",
        items: [
          "**Supplier quotations** — one column for each supplier, one line for each item.",
          "**lowest** — the cheapest total is marked. It is not always the best one.",
          "**document** — the paper you attached. Press it to open it.",
          "**Budget** — the approved budget, for you to compare.",
          "**Propose this one** — you choose the quotation to buy from (next chapter).",
          "**Finance must authorize** — written under the button when this price is above the budget, or no budget was set. You can still propose it.",
        ],
        notes: [
          p("Under each total, **Quotation terms** tell the days to deliver, the last day of the price, and who recorded it."),
          warn("A price that is past its last day shows **expired** in red, and its **Propose this one** button is gone. Ask the supplier for a new price and record a new quotation."),
        ],
      }),
      keep(
        h("How to choose"),
        dots([
          "**The price**, and what is inside it — delivery, bags, tax.",
          "**The days to deliver** against the day the goods are needed. The asker's date is on the purchase: “needed by …”.",
          "**The quality** and what the department asked for — the same item, the same size.",
          "**The supplier's name** — have you bought from them before?",
        ]),
        tip("If you choose a quotation that is not the cheapest, write the reason in its **Note**. Finance reads it when it asks itself why."),
      ),
      rule("A price is a promise only while it holds. Order on the day it is authorized, before the last day of the price."),
    ),

    // ───────────────────────── 5
    chapter("Propose a price", "You choose one quotation. Inside the budget, you can order at once. Above it, Finance must say yes first.",
      view("Inside the budget", {
        intro: "The quotation is not more than the approved budget. Nobody has to be asked.",
        shots: [["pu-c-within-top", 88], ["pu-c-within-low", 88]],
        items: [
          "**Price authorized — ready to order** — the new word. The purchase moves to the tab **Ready to order**.",
          "**Purchase order** — the box where you order.",
          "**“… is within the approved budget. You can issue the purchase order.”** — the page tells you why.",
          "**Issue the purchase order** — the next chapter.",
        ],
        notes: [p("The order box later says **Price authorized by: within the approved budget** — so everybody can see that nobody had to authorize it.")],
      }),
      view("Above the budget", {
        intro: "The quotation is more than the approved budget, or no budget was set. It waits for Finance.",
        shots: [["pu-c-proposed-top", 88], ["pu-c-proposed", 88]],
        items: [
          "**Waiting for Finance to authorize the price** — the new word. The purchase moves to the tab **With Finance**.",
          "**Waiting for Finance** — the box that says what you proposed.",
          "**“The Accountant proposes … The approved budget is … — this is … above it.”** — how much above.",
          "**“Nothing can be ordered until Finance authorizes this price.”** — you wait. You have no button here.",
        ],
        notes: [warn("Once you propose, you cannot take it back and you cannot add another quotation. If the price waits for Finance, only Finance can send it back to you. Choose with care.")],
      }),
      keep(
        h("What Finance does"),
        shot("pu-c-fin-wait", { cap: "This is **Finance's** screen, not yours. ((3)) The box that waits. ((4)) **Authorize this price** — Finance adds a note and says yes. ((5)) **Send back** — Finance writes what you must do." }),
        dots([
          "**Finance authorizes** → the word becomes **Price authorized — ready to order**. The bell tells you. Issue the order.",
          "**Finance sends it back** → the purchase returns to **To quote**, with the reason. See the next page.",
          "**The price is above the limit that Finance may authorize alone** (the limit is in Settings) → only the Boss or the MD can authorize it. Finance tells them.",
        ]),
      ),
      view("If Finance sends it back", {
        intro: "Finance did not accept the price. The purchase is on the tab **To quote** again.",
        shots: [["pu-c-returned", 86]],
        items: [
          "**“Finance sent the last quotation back: …”** — the reason, in an amber box. Read it first.",
          "**The old quotation** stays in the table. Do not delete it — nothing is deleted.",
          "**Add a quotation** — ask for a better price, or another supplier, and record it. Then propose again.",
        ],
      }),
    ),

    // ───────────────────────── 6
    chapter("The purchase order", "A purchase order, like PO-2026-0001, is your promise to buy from one supplier at one price. It is not a delivery. It is not a payment.",
      task("Issue the purchase order", {
        when: "The word is Price authorized — ready to order.",
        intro: "Press **Issue the purchase order** on the purchase. The window says who the order goes to and for how much.",
        shot: "pu-c-order-form", side: 96,
        steps: [
          "**Expected delivery** — the page puts in the day from the quotation. Change it if the supplier gave another day. | It cannot be a day in the past.",
          "**Note for the supplier** — what the driver must know: “bring the goods to the back store door”.",
          "Press [[!Issue the order]]. The message says **Purchase order issued.**",
        ],
        notes: [
          warn("The system **does not send** the order to the supplier. Give the supplier the order number and the day yourself."),
          p("You cannot order with a quotation whose last day has passed. Order on the day Finance authorizes."),
        ],
      }),
      view("The order is made", {
        shots: [["pu-c-ord-top", 88], ["pu-c-ord-low", 88]],
        items: [
          "**Ordered — waiting for delivery** — the new word. The purchase moves to the tab **On order**.",
          "**Purchase order** — the order number, the supplier, the amount **Committed**, who issued it, and who authorized the price.",
          "**Expected delivery** — the day you gave. The tab **On order** turns it red when it is late.",
          "**Record a delivery** — when the goods arrive (chapter 7).",
          "**Cancel the order** — only while **nothing** has been delivered and there is **no invoice**. A reason is needed.",
        ],
        notes: [
          table(["The order is", "The order is not"], [
            ["The promise to buy, at this price, from this supplier. The amount is **committed**.", "A delivery. Nothing is in the stores because of it."],
            ["Seen by Finance, so that Finance knows what it may have to pay.", "A payment, or an expense. No money moved."],
          ]),
          p("Only the items that were on the quotation are ordered. The number you accept later is counted against the order."),
        ],
      }),
      keep(
        task("Cancel an order", {
          when: "The supplier cannot supply, and nothing has arrived.",
          intro: "You can cancel only while **nothing** has been delivered and there is **no invoice**.",
          steps: [
            "Open the purchase from the tab **On order**.",
            "In the box **Purchase order**, press **Cancel the order**.",
            "A window asks **Why is it cancelled?** Write the reason — at least a few words: “The supplier has no stock.”",
            "Press [[!Cancel the order]] in the window. | The purchase is closed as **Cancelled** and moves to the tab **Closed**. Nothing is paid.",
          ],
          notes: [
            p("If a delivery has been recorded, you cannot cancel: **close the delivery** instead (chapter 7). If there is an invoice, cancel the invoice first (chapter 8)."),
          ],
        }),
      ),
    ),

    // ───────────────────────── 7
    chapter("Deliveries", "When the goods arrive you count them and record them. What you accept goes into stock. What you refuse does not.",
      task("Record a delivery", {
        when: "The supplier brought goods — all or a part.",
        shot: "pu-c-delivery-form", side: 100,
        steps: [
          "Press **Record a delivery** (on the purchase, in **Deliveries**). Count what really arrived, item by item.",
          "**Quantity accepted** — the goods that are right. The box starts with everything that is still to come. | Change it to what you really count.",
          "**Not accepted** — the goods you refuse: broken, wrong, or bad.",
          "**What is wrong** — choose **Damaged**, **Not what was ordered** or **Other**. It opens when you type a number in **Not accepted**.",
          "**Describe the problem** — a few words: “two towels torn at the edge”.",
          "**Delivery note (photo or PDF)** — the supplier's paper, if there is one.",
          "Press [[!Record the delivery]]. The message says **Delivery recorded.**",
        ],
        notes: [
          warn("You cannot accept more than what is still to come. Goods that come in addition are **not added** — tell the supplier."),
          p("If you press twice by mistake within one minute, the system keeps one delivery only."),
        ],
      }),
      view("After a part delivery", {
        intro: "Here 24 litres of the 40 litres of cooking oil arrived. Cooking oil is a **stock item**.",
        shots: [["pu-c-del-top", 88], ["pu-c-del-line", 88]],
        items: [
          "**Partly delivered** — the order stays open: there is more to come.",
          "**In stock now** — the stock went from 4 litres to 28 litres: the 24 litres you accepted, no more.",
          "**· in stock** — this delivery line went into the stores.",
          "**Record a delivery** — when the rest arrives. You may record as many deliveries as the supplier makes.",
          "**Close — the rest is not coming** — when the supplier will not bring the rest.",
        ],
        notes: [p("When every item has arrived, the word changes to **Delivered — invoice and payment to finish**, and the purchase moves to the tab **Invoices and payment**.")],
      }),
      keep(
        h("What goes into stock, and what does not"),
        table(["The line is …", "What happens when you accept it"], [
          ["**A stock item** — cooking oil, sugar, rice, soap", "The accepted quantity goes into the stores **now**, at the price of the order. The line says **· in stock**, and the stock goes up in **Inventory**."],
          ["**Not a stock item** — towels, printer paper, a table", "The delivery is recorded and kept in the history. **Nothing** goes into the stores. The window says **not kept in stock** beside it."],
          ["**Goods you do not accept**", "They never go into stock. The supplier still owes them. The reason you wrote is kept."],
        ]),
        p("Stock goes in once for each delivery line. Never add stock by hand for a purchase you also record here."),
      ),
      tour("Check the stores", {
        shot: "pu-c-inventory",
        intro: "Open **Inventory** to see the new stock. You can only look — you cannot change it.",
        items: [
          "**Cooking oil** — the item you received.",
          "**28 L** — the stock now. It was 4 L, so it was **low** before the delivery.",
        ],
      }),
      task("The rest is not coming", {
        when: "The supplier says it cannot bring the remaining goods.",
        intro: "On the purchase, in **Deliveries**, press **Close — the rest is not coming**.",
        shot: "pu-closeshort", side: 96,
        steps: [
          "**Why is the rest not coming?** — write it in a few words, at least five letters. | “The supplier has no more oil this month.”",
          "Press [[!Close the delivery]].",
        ],
        notes: [
          p("The purchase is closed with what arrived. The word becomes **Delivered — invoice and payment to finish**. The supplier's invoice should be only for what you accepted."),
          warn("Do not close a delivery to hide a mistake. If goods are still coming, record them when they arrive."),
        ],
      }),
      tour("What the department sees", {
        shot: "pu-asker-order",
        intro: "The person who asked sees the order and what has arrived. They can say if it is right.",
        items: [
          "**Part of the order has arrived — the rest is still to come.** — the word for the department.",
          "**The order** — the order number and the day it is expected. No prices.",
          "**24 of 40 litres arrived** — the same numbers you recorded.",
          "**It is all right** or **Report a problem** — the department answers. It goes in the history; you and Finance see it. | A problem needs a few words to say what is wrong.",
        ],
      }),
    ),

    // ───────────────────────── 8
    chapter("Supplier invoices and documents", "The invoice is the supplier's bill. You record it as it is, with its paper. Finance pays it.",
      task("Record the invoice", {
        when: "The supplier gave you its invoice — you do not need to wait for the last delivery.",
        intro: "On the purchase, in **Invoices and payment**, press **Record an invoice**. You can do it from the day the order is made.",
        shot: "pu-invoice-form", side: 100,
        steps: [
          "**Invoice number** — as it is written on the paper. The same number cannot be recorded twice for one order.",
          "**Amount (TZS)** — the total on the invoice. The page puts in the value of the goods delivered, less the invoices already recorded. | Change it to what the paper says.",
          "**Invoice date** — the date on the paper. It cannot be in the future.",
          "**Due on** — the last day to pay, if the supplier wrote one. | It helps Finance: it shows **past its due date** on its page.",
          "**The invoice (photo or PDF)** — attach it. | Always attach it, so that Finance can check.",
          "Press [[!Record the invoice]]. The message says **Invoice recorded.**",
        ],
        notes: [
          p("A purchase may have several invoices, for example one for each delivery. Record each one with its own number."),
          warn("An invoice is **not a payment** and **not an expense**. Nothing is paid because you recorded it."),
        ],
      }),
      keep(
        task("Cancel an invoice recorded by mistake", {
          when: "You typed the wrong number or amount, or the invoice is for another order.",
          steps: [
            "Open the purchase on the tab **Invoices and payment**.",
            "On the invoice line, press **Cancel invoice**.",
            "A window asks **Why is it cancelled?** Write the reason, at least a few words: “Wrong amount, the paper says 153,600.”",
            "Press [[!Cancel invoice]] in the window. | The invoice stays on the record, marked **Cancelled**, with your reason. Then record the right one.",
          ],
          notes: [
            p("You may cancel it while it is **To verify** or **Disputed**, and while nothing was paid. After Finance has verified it, only Finance can cancel it. Once money was paid against it, nobody can."),
            warn("The number of a cancelled invoice cannot be used again on the same order: the system says it is already recorded. The corrected invoice must come from the supplier with its own number. If the right paper has the same number, tell Finance and Nino."),
            p("**Why you never pay.** Two different people look at every purchase: you buy, Finance pays. That protects the hotel's money — and it protects you."),
          ],
        }),
      ),
      rule("A request is not an expense. An approval is not a payment. An order is not a delivery. An invoice is not a payment. Only the payment to the supplier is the expense."),
      tour("The invoice and its papers", {
        shot: "pu-invoiced",
        intro: "The invoice is now on the purchase, and the paper is kept with it.",
        items: [
          "**To verify** — the word for the invoice: Finance has not looked at it yet.",
          "**The invoice line** — number, amount, its dates, who recorded it, and a **document** link to the paper.",
          "**Documents** — every paper of the purchase in one list: the quotation, the delivery note, the invoice. | Each one tells who put it and when.",
          "**Cancel invoice** — when you recorded it wrongly. See the note above.",
        ],
        notes: [p("Only the people who buy and the people who approve can open the papers. The department that asked cannot.")],
      }),
      keep(
        h("What Finance does next"),
        shot("pu-c-fin-verified", { w: 86, cap: "This is **Finance's** screen. ((1)) **Verified — to pay**. ((2)) **Verified by** and the note. ((3)) **Record payment**. ((4)) **Cancel invoice**." }),
        table(["Finance does", "The invoice becomes", "What you do"], [
          ["**Verify** — it matches the order and what arrived. If it is more than what arrived, Finance must write why.", "**Verified — to pay**", "Nothing. Finance pays."],
          ["**Dispute** — something is wrong, and Finance writes what.", "**Disputed**", "Read the reason. Ask the supplier for a good invoice. Record it."],
          ["**Record payment** — only when the money really left the account.", "**Paid** (or **Partly paid**)", "Nothing. When all is delivered and all is paid, the purchase is **Done**."],
        ]),
      ),
      keep(
        h("A disputed invoice"),
        shot("pu-c-fin-disputed", { w: 86, cap: "((1)) **To verify**. ((2)) **Disputed**. ((3)) Finance's reason: “The delivery charge was not on the order.” ((4)) **Verify**. ((5)) **Cancel invoice** — which you may use." }),
        p("Finance disputed the second invoice, for a delivery charge that was not on the order. You ask the supplier. If the supplier takes the charge off, you **cancel** the wrong invoice and record the corrected one."),
      ),
    ),

    // ───────────────────────── 9
    chapter("A request from start to finish", "One example with its pictures: towels for the guest rooms. Names and amounts are examples.",
      keep(
        h("The ten steps"),
        p("Reception asks. Finance says yes. You find the prices and order. The supplier delivers. You record the invoice. Finance pays. The department sees **Completed**."),
        p("The pictures are the ones of the earlier chapters, made smaller. The small gold numbers on them are explained in those chapters. Here, follow the ten big step numbers."),
      ),
      story([
        [1, "Reception · Asha", "Asha asks for towels", "Asha opens **Purchase requests**, taps **Bath towels** and **Hand towels**, writes 20 of each, why, and a guess of TZS 400,000. Asha sends it to Finance.", ["pu-c-asker-sent"], "Asha sees: Submitted.", 62],
        [2, "Finance · Grace", "Finance approves, with a budget", "Grace opens the request. The budget box says 400,000 — the guess. Grace presses **Approve for purchase**.", ["pu-c-fin-approve"], "Asha sees: Approved. The purchase is on your tab **To quote**.", 62],
        [3, "Purchasing · you", "You get three quotations", "You ask three suppliers and record each price: 390,000 from Kariakoo Textile Traders (5 days), 430,000 from Mlimani Linen House (4 days), 470,000 from Uhuru Hotel Supplies (2 days).", ["pu-c-r1-quotes"], "Asha sees: Approved."],
        [4, "Purchasing · you", "You propose the price that fits", "The cheapest is 390,000, but the guests arrive on Friday. Only Uhuru can deliver in two days, so you press **Propose this one** under 470,000. It is TZS 70,000 above the budget. You write why in the quotation's note.", ["pu-c-proposed"], "The purchase moves to **With Finance**."],
        [5, "Finance · Grace", "Finance authorizes the price", "Grace reads the reason, writes “Uhuru delivers in 2 days and the guests arrive on Friday” and presses **Authorize this price**.", ["pu-c-fin-wait"], "Your bell: price authorized, issue the order."],
        [6, "Purchasing · you", "You issue the purchase order", "You press **Issue the purchase order**, keep the day of delivery (15 October), write a note for the supplier and press **Issue the order**. The number is PO-2026-0001.", ["pu-c-ord-low"], "Asha sees: Purchased."],
        [7, "Purchasing · you", "The towels come in two parts", "First delivery: 20 hand towels, and 8 bath towels — two bath towels are torn, so you write 2 in **Not accepted**. Second delivery: the other 12 bath towels.", ["pu-c-r1-del"], "The towels are not stock items, so nothing goes into the stores."],
        [8, "Purchasing · you", "You record the invoice", "Uhuru's invoice UHU-0387 for TZS 470,000, dated 13 October, due 27 October. You press **Record the invoice**.", ["pu-c-r1-invoice"], "The invoice is **To verify**.", 56],
        [9, "Finance · Grace", "Finance verifies and pays", "Grace checks the invoice against the order and the delivery, presses **Verify**, then **Record payment** from CRDB Bank. Now there is one expense: TZS 470,000.", ["pu-c-fin-verified", "pu-c-paid-low"], "The purchase is **Done**."],
        [10, "Reception · Asha", "Asha sees Completed", "The request moves to the part **Finished**, and Asha sees **Completed**. Asha never saw a quotation, an invoice or a payment.", ["pu-c-asha-done"], "That is the whole story."],
      ]),
    ),
  ],

  rules: [
    ["Buy only what Finance approved", "The quantity and the budget on the purchase are the limit. A price above the budget is proposed — it is never ordered alone."],
    ["Write every price down", "Record each quotation, with the supplier, the price, the last day and the paper. A price that is not on the page does not exist."],
    ["The cheapest is not always the best", "Choose for the hotel. Write why in the note when you do not take the cheapest."],
    ["You never approve and never pay", "Finance approves and pays. The Boss and the MD authorize large prices. You buy."],
    ["An order is not a delivery", "Issue the purchase order only when the page says **Price authorized — ready to order**. Order before the last day of the price."],
    ["Count before you press", "Record only what really arrived. Stock goes in only for what you accept, and only for stock items."],
    ["Write what is wrong", "Goods you refuse go in **Not accepted**, with the reason. They never go into stock."],
    ["An invoice is not a payment", "Record the invoice as the paper says: number, amount, dates. Attach the paper. Finance checks it and pays."],
    ["Do not record more than arrived", "If the invoice is more than the goods you received, ask the supplier first. Finance will see the difference."],
    ["Every step has your name", "Write real reasons. The history shows who did what, and when."],
  ],

  problems: [
    ["A request I expect is not on my page.", "Finance has not approved it yet — the review is Finance's. Ask Finance. Or a filter hides it: press **Clear**."],
    ["**Add a quotation** is not there.", "A price is already proposed and waits for Finance, or the order is already made. Ask Finance to send it back, if you must change the price."],
    ["A quotation shows **expired** and has no **Propose this one**.", "The last day of the price has passed. Ask the supplier for a new price and record a new quotation."],
    ["**Finance must authorize** is under the button.", "The price is above the budget, or no budget was set. You can still propose it. It will wait for Finance."],
    ["Finance sent the price back.", "Read the amber note. Ask the supplier for a better price, or ask another supplier. Record a new quotation. Propose again."],
    ["The purchase waits a long time on **With Finance**.", "Tell Finance or the Manager. If the price is above Finance's limit, only the Boss or the MD can authorize it."],
    ["The order cannot be issued: the quotation has expired.", "The system cannot take a new quotation at this step. Tell Finance and Nino at once."],
    ["More goods came than were ordered, or some are broken or wrong.", "Accept only what is still to come, and only the good goods. Put the broken or wrong ones in **Not accepted**, choose what is wrong and describe it. Tell the supplier about the extra goods."],
    ["The supplier will not bring the rest.", "Press **Close — the rest is not coming** and write why. Then record the invoice for what arrived."],
    ["I recorded a delivery with the wrong number.", "A delivery cannot be changed on your screen. Tell the Manager at once. A stock count with a reason puts the stores right."],
    ["The supplier cannot supply and nothing arrived.", "**Cancel the order** with the reason. If an invoice exists, cancel the invoice first."],
    ["I recorded the wrong invoice, or the number is refused: “already recorded”.", "Press **Cancel invoice** with the reason, then record the right one. After Finance has verified it, only Finance can cancel. A number stays on the order, even on a cancelled invoice — a new paper needs a new number. If the paper really has the same number, tell Finance and Nino."],
    ["Finance disputed my invoice.", "Read the reason under the invoice. Ask the supplier for a correct invoice and record it."],
    ["The screen shows an error, or a number looks impossible.", "Take a picture of the screen and send it to Nino on WhatsApp — the number is at the bottom of every page."],
  ],
};
