import { chapter, task, tour, flow, tip, warn, rule, p, h, dots, table, shot, keep, pair, render, fmt } from "../tools/kit.mjs";

const GAP = '<div style="height:5mm"></div>';
// A picture on the left, its story on the right.
const left = (id, mm, ...blocks) => (c) => `<div class="split" style="grid-template-columns:${mm}mm 1fr;margin:0 0 4mm">${shot(id, { wrap: "" })}<div>${render(c, blocks)}</div></div>`;

// Two phones side by side, with the words beside them; a caption under each phone.
const phones = (title, a, b, mm, capA, capB, ...blocks) => (c) => {
  const no = c.next();
  return `<article class="task"><header class="t-head"><span class="t-no">${no}</span><h2>${fmt(title)}</h2></header><div class="split" style="grid-template-columns:1fr ${mm}mm"><div>${render(c, blocks)}</div><div class="pair" style="gap:3mm;margin:0">${shot(a, { wrap: "", frame: "phone", cap: capA })}${shot(b, { wrap: "", frame: "phone", cap: capB })}</div></div></article>`;
};

export default {
  id: "guests", file: "Vegas-Guide-10-Guests-and-Website.pdf", name: "Guest and website guide", dept: "guest", accent: "#9a3b4f", soft: "#f6e9ec",
  kind: "Guests", kicker: "Guide book 10", title: "Guests | and Website",
  sub: "Everything a guest can do from their own phone — step by step.",
  cover: { shots: ["ot-g-cover", "t-g-table"], frame: "phone" },
  lead: "This book explains what a guest can do from their own phone at Vegas Luxury Hotel: order food, ask for something in the room, see the bill, win a gift and book a stay. It is written for guests — and for staff, so that everybody explains it the same way. **Nothing has to be installed:** every QR code and every link opens in the phone's browser.",
  lastTitle: "Good to know, and when something goes wrong",
  lastLead: "The few things worth remembering — and what to do when a code or a page does not do what you expect.",

  place: [
    '<div style="height:5mm"></div>',
    h("What a guest can do from the phone"),
    table(["What", "How", "Who receives it"], [
      ["Order food and drinks", "The QR card on a table, or in the room (room service goes on the room bill)", "The kitchen, the waiters and the Counter"],
      ["Ask for cleaning, towels, a repair, a late check-out", "The QR card in the room", "Reception"],
      ["See the bill and pay it", "The room card or the stay link — **Pay now** with mobile money", "Nobody — it is your own page; a payment is recorded by itself"],
      ["Spin for a gift", "The Spin to Win card in the room", "The restaurant, as one order"],
      ["Book a room, an airport pickup or the meeting room", "The Hotel QR card, or the website", "Reception, then the driver"],
    ]),
  ],

  chapters: [
    // ───────────────────────── 2
    chapter("QR codes: how they work", "A QR code is a square picture that holds a link. The camera of your phone reads it and opens the right page of the hotel — already knowing which table or which room you are at.",
      keep(
        left("t-g-table", 50,
          h("Scan a code in four steps"),
          table(["Step", "What you do"], [
            ["**1**", "Open the **camera** of your phone. No app is needed."],
            ["**2**", "Point it at the code and hold still for a second."],
            ["**3**", "A link appears on the screen. **Tap it.**"],
            ["**4**", "The page opens in your browser — like the picture on the left. Nothing to install, no account, no password."],
          ]),
          tip("On some phones the scanner is a button inside the camera, or in the quick settings — look for **Scan QR code**."),
          h("At the top of every page"),
          dots([
            "**中文** — changes the page to Chinese. **EN** changes it back. | A phone that is set to Chinese opens in Chinese by itself.",
            "**Website** — opens the hotel's website.",
            "**The basket** — what you have chosen so far.",
          ]),
        ),
      ),
      keep(
        h("Is it safe?"),
        dots([
          "A code of the hotel only opens a page of the hotel: **www.vegashoteltz.com**.",
          "The pages ask for your **phone number** and your **name** — never a password.",
          "Nobody from the hotel will ever ask for the PIN of your mobile money. You enter it only on your own phone, when the payment request arrives.",
          "The codes printed in this book are **examples** from a practice copy. Scan the real cards in the hotel.",
        ], true),
        tip("**For staff — say it in one breath:** open your camera, point at the card, tap the link. Choose, add your number and your name, place the order — and we bring it."),
      ),
      keep(
        h("The codes of the hotel"),
        table(["The code", "Where you find it", "What it opens"], [
          ["**Table card**", "On every table of the restaurant", "The menu for that table. Pay now by mobile money, or put the order on the table's bill."],
          ["**Counter card**", "At the counter", "The menu for a seat at the counter — served at the counter."],
          ["**Restaurant QR**", "A waiter or the Counter shows it", "The menu without a table: eat here or take out."],
          ["**Room card**", "In your room", "Your room page: room service, requests to Reception, Wi-Fi and your bill — and **Pay now**."],
          ["**Spin to Win card**", "In your room", "The wheel — gifts for guests who are checked in."],
          ["**Hotel QR**", "At the reception desk", "The booking page: rooms, tonight's prices, book a stay."],
          ["**The code on the thank-you note**", "On the note you receive after check-out", "Book your next stay."],
        ]),
      ),
      flow("One menu, three places", {
        plain: true,
        intro: "Every restaurant card opens the same menu, already knowing **where** you are.",
        shots: [
          ["t-g-table", "**The card on a table** — **Table 3 · Inside**. Served at your table; you pay now, or when you are done."],
          ["t-g-counter", "**The card at the counter** — **Counter · Outside**. Served at the counter; you pay now, or when you are done."],
          ["t-g-main", "**The Restaurant QR** — no table. Eat here or take out. Take-out is always paid first."],
        ],
      }),
    ),

    // ───────────────────────── 3
    chapter("Order food and drinks at your table", "Scan the card on your table and order when you are ready. Pay at once with your phone, or put the order on your table's bill. Your phone shows every step until it is served.",
      task("Choose what you want", {
        shot: "q-order-1", side: 42,
        steps: [
          "**Table 3 · Inside** — the page already knows your table. | Under it: **Served at your table · pay when you are done**.",
          "Tap **+** on what you want. | **Search the menu** and the groups help you find it: Breakfast, Starters & Soups, Local Favorites, Main Courses, Sides & Drinks, Beers, Wines, Whiskies, Spirits.",
          "**The basket**, top right, opens what you have chosen.",
        ],
        notes: [tip("**Recommended — Picked by our kitchen** shows the chef's picks first.")],
      }),
      task("Tell us who you are — once", {
        shot: "q-order-2", side: 42,
        intro: "The first time you add something, the page asks who is ordering: **Let's get your order started**.",
        steps: [
          "**Phone number (WhatsApp)** — type your number. | A green tick shows that it is complete.",
          "**Your name**.",
          "Tap [[!Continue]]. | It is asked once at this table, and used only for your orders and your bill.",
        ],
        notes: [tip("If you have stayed or ordered with us before, the hotel already knows you by your number.")],
      }),
      task("Add more, then open your order", {
        shot: "q-order-3", side: 42,
        steps: [
          "**Welcome, Joyce** — your name and your table. | **Your bill** opens what you have ordered so far. **I'm done** is for the end of your meal.",
          "Tap **+** on anything else you want. | The number on a picture shows how many you added.",
          "Tap [[View order]] at the bottom. | It shows how many items you have, and the total.",
        ],
      }),
      task("Pay, check it and place the order", {
        shot: "ot-q-order-4", side: 44,
        intro: "**Your order** lists every item. The buttons beside an item change the amount, or take it out. Then you choose how to pay:",
        steps: [
          "**Pay now** — pay straight away with mobile money. | It is chosen first. M-Pesa, Airtel, Mixx by Yas and HaloPesa work.",
          "**Enter your number** — your mobile-money number. | A payment request comes to your phone. You enter your PIN there, and the kitchen starts when the payment is confirmed.",
          "**Add to my bill** — instead of paying now, the order goes on the bill of your table. | You pay after your meal: cash, card or mobile money. With the Restaurant QR this choice is called **Pay after**.",
          "**Any requests?** — tap what applies: No onions, No garlic, Not spicy, Extra spicy, No ice, Less sugar, No sugar, Meat well done, Sauce on the side, Vegetarian, I have an allergy — please ask me, Pack it to take away. | Or write to the kitchen in the box under them.",
          "Tap the button at the bottom — **Pay TZS 24,000 now**, or **Place order · TZS 24,000** when you chose Add to my bill.",
        ],
        notes: [tip("If the payment does not go through, a table order still goes to the kitchen. Try again, or pay at the Counter when you are done.")],
      }),
      keep(
        left("ot-t-q-7", 56,
          h("Follow your order"),
          dots([
            "**Order received** — **Thank you, Joyce — your order has been received**, with the order number and your table.",
            "**The five steps** — Order received, Kitchen preparing, Ready, On its way to your table, Served. | A tick shows where your order is. **This page updates by itself.**",
            "**Pay now** — still to pay? Type your mobile-money number and tap **Pay TZS 24,000 now**. | A payment request comes to your phone. The page shows **Paid** when it is done.",
            "**Your order** — the items, and **Pay after your meal** with the total.",
            "**Your bill — print or download**.",
            "**Order more** — opens the menu again. The new items join the same bill.",
            "**WhatsApp us**, and the phone number of the hotel — for a question about your order.",
          ]),
          h("Paying at the restaurant"),
          dots([
            "**Pay now** — with mobile money from your phone, at checkout or later from your order page. No need to wait for the bill.",
            "Or, when you have finished, ask your waiter. You pay **cash, by card or by mobile money**, and the Counter records it.",
            "Staying in the hotel? Tell the waiter your room — the meal can go on your **room bill**.",
            "With the **Restaurant QR** — eat here or take out — you pay when it is served. Take-out is paid first: we start it once it is paid.",
          ]),
        ),
      ),
    ),

    // ───────────────────────── 4
    chapter("In your room", "The card in your room opens your own page: room service, requests to Reception, the Wi-Fi and your bill. It works while you are checked in to that room.",
      tour("Your room page", {
        shot: "ot-g-room-1",
        intro: "Scan the card in your room. The page knows your room and your stay — here **Welcome, Mary · Room 203 · Double Deluxe · 11 Oct → 14 Oct · check-out by 11:00**.",
        items: [
          "**Order food & drinks** — room service: brought to your room and added to your room bill.",
          "**Wi-Fi** — how to connect to the hotel's Wi-Fi.",
          "**Reception** — reach the front desk.",
          "**Full bill** — opens your whole bill.",
          "**Pay TZS 21,500 now** — pay what you owe with mobile money. | A small sheet asks for your mobile-money number. A payment request comes to your phone; you enter your PIN there.",
        ],
        notes: [p("**Your breakfast is on us** — 6:00 AM to 10:30 AM, every day. **Your bill** shows **To pay**, what is already paid, and its parts: Room, Restaurant, Room service. You can also pay at reception, any time before you leave.")],
      }),
      task("Ask Reception for something", {
        shot: "ck3-g-room-2c", frame: "phone",
        intro: "Scroll to **Your room** — **Ask here and reception takes care of it.** Tap what you need:",
        steps: [
          "**Late check-out** — leave after 11:00.",
          "**Cleaning** — tidy up, fresh sheets.",
          "**Something else** — tell us what you need.",
        ],
        notes: [p("Also on the list: **Change my room**, **Stay longer** (add nights to your stay), **Fresh towels** (towels, bathrobe, toiletries) and **Something is not working** (AC, TV, water, lights).")],
      }),
      keep(
        left("g-room-3", 46,
          h("Send the request"),
          p("A small sheet opens — here **Cleaning: Reception will send someone to your room.**"),
          dots([
            "Write **a good time, or anything to add**. It is optional.",
            "Tap [[!Send to reception]].",
            "Under **Your requests** you see it with its time — and **Done** when it is finished.",
          ]),
          tip("Reception sees your request at once on their screen, with your room number. You do not have to call."),
        ),
      ),
      keep(
        flow("Room service and your bill", {
          plain: true,
          shots: [
            ["t-g-staymenu", "**Food & drinks** — brought to your room and added to your room bill; the delivery fee is shown. Choose exactly as at a table (chapter 3)."],
            ["ot-g-stay", "**Your bill** grows as you go: extras are added the moment you order. **Pay TZS … now** pays it from your phone. Under it, **Your orders** — tap one to follow it."],
            ["ot-g-roombill", "**Full bill** — **Pay your bill now** is at the top. Then **Print**, **PDF**, **Image** and **Share**, and your stay night by night with every order item by item."],
          ],
        }),
      ),
      keep(
        left("t-g-roomfree", 44,
          h("Your stay link"),
          p("Reception can also send your room page to your WhatsApp as a link — **your stay link**. It opens the same page without scanning."),
          warn("The stay link is private: it shows your bill. Do not pass it on."),
          h("When nobody is checked in"),
          p("A room card that is scanned before check-in shows no bill and takes no room service. It shows the room type and its price — the picture on the left — with **Book a room like this** and **See the menu**. After check-in the same card opens your room page."),
        ),
      ),
    ),

    // ───────────────────────── 5
    chapter("Spin to Win", "A small thank-you for staying with us: spin the wheel in your room and win up to two treats from the restaurant. It is free — nothing is added to your bill.",
      flow("Spin the wheel", {
        shots: [
          ["g-spin-1", "Scan the **Spin to Win** card in your room. You have **5 spins** (the hotel sets the number) to win up to **two** complimentary treats. Tap **LET'S SPIN**."],
          ["g-spin-2", "Tap **SPIN**. Each spin gives a gift, a **+1 Bonus spin**, or **Try again**."],
          ["g-spin-3", "**GIFT 1 OF 2 · YOU WON.** Tap **SPIN AGAIN** to go for the second gift."],
        ],
      }),
      flow("Receive your gifts", {
        from: 4,
        shots: [
          ["g-spin-4", "**GIFT 2 OF 2 · DOUBLE WIN** — that is both of your gifts. Tap **SEE MY GIFTS**."],
          ["g-spin-6", "Choose ((1)) **Deliver to my room** or **Enjoy at the restaurant**, then tap ((2)) **SEND MY GIFTS**. | **No, thank you** beside a gift leaves it out."],
          ["g-spin-7", "**We are preparing them now and will bring them to room 101.** Both gifts go to the restaurant together, as one order."],
        ],
      }),
      keep(
        left("t-g-spin", 40,
          h("Good to know"),
          dots([
            "**Two gifts a stay at most.** After the first gift you may stop: **Finish now and send my gift**. The game also ends when your spins are used, or when no gift fits the hotel's gift budget.",
            "**YOUR VEGAS REWARDS** shows the gifts won, the spins left, the value won and the gift budget left.",
            "Gifts are food and soft drinks from the restaurant menu. They are never money, and never drinks from the bar.",
            "**It is on us.** Nothing is added to your bill.",
            "The card works only while you are checked in to that room. Before check-in it says **Spin to Win is for our checked-in guests** — the picture on the left.",
          ]),
          tip("**For staff:** the gifts arrive at the restaurant as one normal order, marked as gifts. Serve it like any other order — there is nothing to collect."),
        ),
      ),
    ),

    // ───────────────────────── 6
    chapter("Book a room", "A room can be booked in two ways without calling: the Hotel QR card, or the website. Both show what is really free and the real price — and both arrive at Reception at once.",
      phones("The Hotel QR", "g-hotel-1", "g-hotel-2", 104,
        "((1)) **Check availability** — choose your dates and see what is free. ((2)) **Explore rooms** — every room type, with tonight's price.",
        "((1)) **Book** starts the booking for that room type. ((2)) **Details** shows the room.",
        p("Scan the **Hotel QR** card at the reception desk. It opens the hotel on your phone. The round buttons under it — **Rooms**, **The hotel**, **Food**, **Meetings**, **Find us** — jump to each part. **Book now**, at the top, is always there."),
        h("Our rooms"),
        p("**Tonight's prices, per room per night.** Each room type says how many guests it takes and how many rooms are free tonight — or **Full tonight**."),
        table(["Room type", "For", "From, per night"], [
          ["Standard Single", "1 adult", "TZS 60,000"],
          ["Double Deluxe", "2 adults, 1 child", "TZS 80,000"],
          ["Executive", "2 adults, 1 child", "TZS 100,000"],
          ["Executive Suite", "2 adults, 2 children", "TZS 120,000"],
          ["Twin", "2 adults, 1 child", "TZS 160,000"],
        ]),
        p("These are the prices of the day the pictures were taken. The page always shows the price of the night you choose."),
        tip("After **Book**, the Hotel QR asks for your phone number first, then your name. The pay choices are the same as on the website. If you do not pay now, the button says **Send booking** and the room is **not held until it is paid**."),
      ),
      keep(
        h("Book on the website — step 1: dates and guests"),
        shot("b-1", { w: 62 }),
        p("Open **www.vegashoteltz.com** and tap **Book now**. Choose **Check-in**, **Check-out**, **Adults**, **Children** and a **Room type** — or leave **Any room type** — then tap **Check availability**. The page says: pay now by mobile money to reserve your room, or pay later. Check-in is from 14:00, check-out by 11:00, and you can book up to 365 days ahead."),
      ),
      keep(
        h("Step 2: choose the room"),
        shot("b-2-a", { w: 62 }),
        p("The page shows how many room types are free for your dates. Each one says who it takes, what is included — breakfast and Wi-Fi — the price per night and the total. Choose **1 room** or **2 rooms** and tap **Select room**. Room types that are full are listed under **Not free for these dates**."),
      ),
      tour("Step 3: book and pay", {
        shot: "ot-b-3", side: 92,
        intro: "**Book & pay — your number first.** If you have stayed or ordered with us before, we already know you: the page says **Welcome back** and shows your name.",
        items: [
          "**Phone / WhatsApp** — your number. | A new number also asks for your **Full name**.",
          "**Pay now** — pay with mobile money to reserve the room. | Your number is filled in for you. A payment request comes to your phone; you enter your PIN there. The room is held for you for 30 minutes while you pay.",
          "**Pay later** — **Not reserved until paid.** | You can pay any time from your booking page.",
          "The button — **Pay TZS 80,000 now**, or **Book — pay later** when you chose Pay later.",
        ],
        notes: [
          p("You may also **add an email, your arrival time, a request or an airport pickup**. The total is shown before you book: breakfast and Wi-Fi included, no card needed."),
          warn("**The room is not reserved until it is paid.** With Pay later it may go to someone who pays first."),
        ],
      }),
      keep(
        h("Step 4: your booking"),
        left("ot-b-4", 84,
          dots([
            "**Booking received** — with your **booking reference**. Keep it: Reception finds your booking with it.",
            "**Status: Booked — not reserved until paid** (when you chose Pay later). After a payment it says **Confirmed — paid**.",
            "**Your stay** — the dates, the room and the **amount due**.",
            "**Pay now** — the card under the price. Type your number, tap **Pay TZS …** and approve on your phone. You can use it any time to reserve the room.",
            "**Keep this page's link** — it is your private link to view this booking. **Copy link** and **Print** are at the bottom.",
          ]),
          tip("To change something, contact the hotel with your reference: call or WhatsApp **+255 710 223 344**."),
        ),
      ),
    ),

    // ───────────────────────── 7
    chapter("The website", "The website is the hotel on any phone or computer: the rooms, the menu, the photos, the meeting room, airport pickup — and the booking. Its address is **www.vegashoteltz.com**.",
      keep(
        h("The first page"),
        shot("web-home", { w: 44 }),
        dots([
          "**The menu at the top** — Rooms, Dining, Experiences, Services, About, Contact.",
          "**EN / 中文** — the language of the website.",
          "**Book now** — starts a booking from any page.",
          "**The search bar** — Check-in, Check-out, Guests and Room, then **Check availability**.",
        ], true),
        p("**Staff login**, at the top, is for the staff of the hotel only."),
      ),
      keep(
        h("What you find on each page"),
        table(["Page", "What you find"], [
          ["**Rooms**", "The five room types side by side at tonight's website rate, with photos."],
          ["**Menu**", "The whole menu with prices — and **Order now**, to order from the website. Room service for guests has a delivery fee of TZS 2,000."],
          ["**Restaurant**, **Bar**", "What the kitchen and the bar serve, and when: breakfast is from 6:00 AM to 10:30 AM."],
          ["**Gallery**", "Photographs of the rooms, the bathrooms, the reception and the building — every photo is of our hotel."],
          ["**Meeting Room**", "Up to 10 people, TZS 100,000 per booking, food and drinks on the same bill. Check your date and time, then pay now by mobile money to confirm at once — or send a request."],
          ["**Transport**", "Airport pickup and other trips with the hotel's own drivers. After you ask, you get a private page for your trip with its reference and its status."],
          ["**Contact**", "Reception is open 24 hours: call, WhatsApp, email, or write a message."],
        ]),
      ),
      keep(
        pair(["web-rooms", { cap: "**Rooms** — find the room that fits your stay, then **Check availability**." }],
          ["web-menu", { cap: "**Menu** — from the kitchen and from the bar, with **Order now**." }]),
      ),
      keep(
        pair(["ck3-web-meeting", { cap: "**Meeting Room** — see at once if the room is free, then book it. No account needed. Pay now to confirm at once, or send a request and the hotel confirms by phone or WhatsApp." }],
          ["web-contact", { cap: "**Contact** — call +255 710 223 344, chat with the front desk on WhatsApp, or send a message." }]),
      ),
      tour("Ask for an airport pickup", {
        shot: "web-transport-n", w: 80,
        intro: "Open **Transport**. The hotel is about 14 km from Julius Nyerere International Airport.",
        items: [
          "**The price** of an airport pickup.",
          "**Request airport pickup** — opens the form: tell us where and when. No account is needed.",
          "**WhatsApp us** — or ask on WhatsApp.",
        ],
        notes: [
          table(["Step", "What happens"], [
            ["**01 · Tell us when**", "Send your flight or your pickup time."],
            ["**02 · We confirm with you**", "Reception calls or messages you to confirm the time, the place and the price."],
            ["**03 · Your driver is there**", "For airport pickups the driver waits at arrivals. Tell us if you would like a name sign."],
          ]),
          warn("Your request is confirmed only when Reception has called or messaged you."),
        ],
      }),
    ),

    // ───────────────────────── 8
    chapter("Paying, and goodbye", "You always see what you owe before you pay, and you always receive a record of it.",
      keep(
        h("Where you pay"),
        table(["For", "When and where", "How"], [
          ["A meal at a table", "**Pay now** on your phone, or after your meal with your waiter", "Mobile money on your phone — or cash, card or mobile money at the Counter"],
          ["Room service and extras", "**Pay your bill now** on your room page, or at Reception any time before you leave", "Mobile money — or cash, card or mobile money at Reception"],
          ["A booking or the meeting room", "**Pay now** when you book, or later from your booking page — or at the hotel", "The room is reserved when it is paid"],
          ["An airport pickup", "On the private page of your trip (**Pay now**), after the trip, or on your room bill", "The price is confirmed with you first. A custom trip is paid once the hotel has confirmed its price"],
        ]),
        h("Paying by phone"),
        dots([
          "The page asks for your **mobile-money number**. M-Pesa, Airtel, Mixx by Yas and HaloPesa work.",
          "**Approve on your phone** — a payment request arrives. You approve it yourself, with your own PIN. A payment by phone cannot be less than TZS 500.",
          "The page then shows **Payment successful**, with the amount and a reference, and, for an order, a **Receipt**. You do not have to send a screenshot.",
          "**Payment not completed**? Tap **Try again**. Money left your account? Tap **I have paid — check again** — it also shows by itself within a few minutes.",
        ]),
        warn("**Never give your PIN to anybody.** The staff of the hotel never ask for it."),
      ),
      GAP,
      keep(
        flow("The thank-you note", {
          plain: true, min: 3,
          shots: [
            ["g-thanks-a", "After check-out you receive a **thank-you note** as a link. It names you, your reservation, your room and the dates of your stay."],
            ["g-thanks-c", "The **summary of your stay** ends with what was paid — here **PAID IN FULL**. Then: **We hope to see you again**, and a code: **Scan to book your next stay**. **Save as PDF or print** keeps a copy."],
          ],
        }),
      ),
    ),
  ],

  rules: [
    ["Nothing to install", "Every QR code and every link opens in the browser of your phone. No app, no account, no password."],
    ["Your number is your name here", "The hotel knows you by your phone number. Type the same number each time and your orders, your stay and your bill stay together."],
    ["One table, one bill", "Everything ordered from the card of a table goes on that table's bill — whoever taps."],
    ["The room card is for the guest of the room", "It works while you are checked in. Keep your stay link to yourself: it shows your bill."],
    ["Reserved means paid", "A booking that is not paid is not reserved. The room may go to someone who pays first."],
    ["Your PIN is yours", "Nobody from the hotel will ask for it — not on a page, not on the phone, not at the desk."],
    ["Gifts are gifts", "Spin to Win costs nothing and nothing is added to your bill."],
    ["Reception is always there", "24 hours a day: call or WhatsApp +255 710 223 344."],
  ],

  problems: [
    ["The camera does not read the code", "Clean the lens, hold the phone still and move a little closer or further. Still nothing? Ask a waiter or Reception — the menu is also on www.vegashoteltz.com."],
    ["The page does not open — no internet", "Use the hotel's Wi-Fi: ask Reception, or tap **Wi-Fi** on your room page. At a table the waiter can take your order instead."],
    ["The page is in the wrong language", "Tap **中文** or **EN** at the top of the page."],
    ["I ordered the wrong thing", "Tell your waiter at once, or tap **WhatsApp us** on your order page."],
    ["My order does not move", "The page updates by itself. If it waits too long, call your waiter or +255 710 223 344."],
    ["The room card shows a price, not my room", "The system does not show you as checked in to that room yet. Ask Reception."],
    ["Spin to Win says it is for checked-in guests", "The same: ask Reception to check you in to the room first. Then scan again."],
    ["I lost the link of my booking", "Call or WhatsApp Reception with your name and phone number, or your booking reference."],
    ["My bill does not look right", "Ask Reception before you pay. Every line of the bill can be shown to you: the nights, each order and each payment."],
    ["The payment request did not arrive on my phone", "Check the number you typed and tap **Try again**. If it still does not come, pay at the Counter or at Reception — never share your PIN."],
    ["Money left my account but the page does not say paid", "Tap **I have paid — check again**. It also shows by itself within a few minutes. Still nothing? Call or WhatsApp Reception with the time and the amount."],
  ],
};
