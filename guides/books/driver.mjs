import { chapter, task, tour, flow, tip, warn, rule, p, h, dots, table, pair, keep } from "../tools/kit.mjs";

export default {
  id: "driver", file: "Vegas-Guide-06-Driver.pdf", name: "Driver guide", dept: "driver", accent: "#4b5a9a", soft: "#eceef7",
  lastTitle: "Golden rules and problems",
  lastLead: "The few things that must always be done the same way, and what to do when something goes wrong.",
  kind: "Transport", kicker: "Guide book 06", title: "Driver",
  sub: "My trips on your phone — see the trips given to you, call the guest, and press three buttons from the hotel gate to the end of the trip.",
  cover: { shots: ["d-trip-1"], frame: "phone" },
  lead: "This book is for the **drivers** of Vegas Luxury Hotel. You work from your phone. The system gives you one page — **My trips** — with every trip that was given to you: the time, the guest, the phone number, where from and where to. At each step of the trip you press one button, and Reception sees where you are. You see only what you need to do the trip: no bills and no booking details.",

  place: [
    '<div style="height:5mm"></div>',
    keep(
      h("What passes through the driver's hands"),
      table(["What", "With whom", "How it moves"], [
        ["**To** — you leave for the pickup", "Reception", "**I'm on the way**. The trip shows **In progress**."],
        ["**To** — the guest is in the car", "Reception", "**Guest picked up**, with your name and the time."],
        ["**To** — the trip is finished", "Reception", "**Trip completed**. Reception can bill it."],
        ["**To** — a guest who did not come", "Reception", "You call. They press **No show** — you have no such button."],
        ["**From** — a trip", "Reception, manager", "They press **Assign** and **Save driver**: it is on **My trips**."],
        ["**From** — the guest's details", "The guest's request", "On the card: name, phone, flight, note."],
        ["**From** — a cancelled trip", "A manager", "It leaves your list."],
      ]),
    ),
  ],

  chapters: [
    chapter("How a trip reaches you", "You never have to write a trip into the system. A guest asks, Reception confirms it and gives it to you. This chapter shows that road, so you know where your trips come from.",
      keep(
        h("One trip, from the request to the bill"),
        table(["What happens", "Who does it", "What the trip shows"], [
          ["A guest asks for a trip — on the website, by a call, or at the desk", "The guest, or Reception for the guest", "**Pending**"],
          ["The hotel agrees the time, the place and the price with the guest", "Reception presses **Confirm**", "**Confirmed**"],
          ["The trip is given to a driver", "Reception presses **Assign** and **Save driver**", "**Driver assigned** — it is on your phone"],
          ["You leave, you pick the guest up", "You press **I'm on the way**, then **Guest picked up**", "**In progress**"],
          ["You arrive", "You press **Trip completed**", "**Completed**"],
          ["The trip is billed", "Reception — on the guest's room, or as a direct payment", "**Completed**, and paid for"],
        ]),
        rule("You do the driving and the three presses. Confirming, giving the trip to a driver, **No show**, cancelling and the money all belong to Reception and the managers."),
      ),
      '<div style="height:5mm"></div>',
      tour("Where the guest asks — the website", {
        shot: "web-transport-n", side: 104,
        intro: "Many trips start on the hotel's website, page **Airport pickup & transport**. No account is needed.",
        items: [
          "**The price** — an airport pickup has a fixed price. The guest sees it before asking.",
          "**Request airport pickup** — the guest writes the date, the time, the flight and a phone number.",
          "**WhatsApp us** — or the guest writes to the hotel directly.",
        ],
        notes: [p("A request is **not a trip yet**. Reception calls or messages the guest, and only then is it confirmed.")],
      }),
      tour("Where Reception arranges it — Transport", {
        shot: "d-transport", w: 88,
        intro: "Reception works on the page **Transport**. Every request lands here, from the website, a call or a guest at the desk.",
        items: [
          "**New request** — Reception writes in a trip for a guest: where from, where to, the time, the flight.",
          "**Pending** — requests nobody has confirmed yet.",
          "**Confirm** — the hotel will do this trip.",
        ],
      }),
      task("How the trip gets your name", {
        shot: "d-assign", side: 74,
        intro: "Reception opens a confirmed trip and presses **Assign**. A small form opens inside the trip.",
        steps: [
          "**The driver** — Reception chooses your name from the list of hotel drivers.",
          "**Save driver** — the trip now shows **Driver assigned** and is on your **My trips** page.",
        ],
        cols: false,
        notes: [tip("Reception can also pick the hotel car for the trip. The system refuses a car that has fewer seats than the trip has passengers."), tip("Reception can also **type** a driver's name and phone instead of choosing from the list. That trip is then on **no** phone — Reception tells the driver by phone.")],
      }),
      keep(
        h("What Reception sees while you drive"),
        pair(
          ["r-trn-5", { cap: "((1)) the driver · ((2)) **Start trip** · ((3)) **Complete** · ((4)) **No show** when the guest did not come." }],
          ["r-trn-6", { cap: "**Completed** — with the price of the trip, ready to bill." }],
        ),
        p("Reception has the same steps on their side. If your phone is off or has no network, call Reception — they can press **Start trip** and **Complete** for you, and it is saved under their name."),
      ),
      keep(
        h("Who can do what on a trip"),
        table(["Who", "What they can do"], [
          ["**The driver**", "The three steps of their own trips: **I'm on the way**, **Guest picked up**, **Trip completed**. Nothing else."],
          ["**Reception**", "Write in a request, **Confirm** it, give it to a driver, **Start trip**, **Complete**, **No show**, and bill the trip."],
          ["**A manager**", "Everything Reception can do, and also: cancel a trip (with a reason), change the driver, and give a special price (with a reason)."],
        ]),
        tip("The kinds of trip you can get: **Airport pickup**, **Airport drop-off**, **Meeting / business trip**, **Custom trip** and **Other trip**. The kind is written on every trip card."),
      ),
    ),

    chapter("My trips on your phone", "Sign in on your phone with your own account. The first page you see is My trips. There is nothing else to learn — everything a driver needs is on this one page.",
      tour("One trip card", {
        shot: "d-trip-1", side: 54,
        intro: "Every trip is one card. The cards are in the order of the pickup time, the earliest on top.",
        items: [
          "**The status** — where the trip is now: **Driver assigned**, **In progress** or **Completed**.",
          "**The guest's phone** — tap the number and your phone calls the guest.",
          "**The button** — the next step of the trip. There is always only one.",
        ],
        notes: [rule("Sign in with **your own** account only. Every step you press is saved with your name and the time.")],
      }),
      keep(
        h("Read the card, line by line"),
        table(["On the card", "What it tells you"], [
          ["**14:10** — the large time", "The pickup time. Be at the pickup place before it."],
          ["**Today · Airport pickup**", "The day (**Today**, or the date) and the kind of trip."],
          ["**Peter Kim · 1 passenger(s)**", "Whom you carry and how many people. Under it is the guest's phone — tap it to call."],
          ["**Airport → Vegas Luxury Hotel**", "Where you pick the guest up → where you take them."],
          ["**Flight KQ 482**", "The flight number, when the guest gave one. Use it to check if the plane is late."],
          ["**The car**", "The hotel car chosen for this trip and its plate number, when Reception picked one."],
          ["**The grey box**", "A note from the guest or Reception, for example “Arrives from Nairobi” or a name sign."],
        ]),
      ),
      keep(
        h("Which trips are on the page"),
        dots([
          "**Only your trips** — trips given to other drivers are not shown.",
          "**From yesterday to seven days ahead** — so you can plan the week.",
          "**A completed trip stays, in a paler colour** — you can still see what you did today.",
          "**A cancelled trip is gone** — it leaves the list. A trip Reception marked **No show** stays, with the red word **No show** and no button.",
          "**No trips assigned** — this message means nothing has been given to you yet.",
        ]),
        tip("The page shows what the system knew when you opened it. Before you start work, and after Reception says they gave you a trip, **open My trips again** or pull the page down to reload it."),
      ),
      '<div style="height:5mm"></div>',
      task("The bars of the phone and the menu", {
        shots: ["d-bars", "d-menu-n"],
        intro: "The top bar and the bottom bar stay on the screen all the time. **Menu** opens the second picture.",
        steps: [
          "**EN / 中文** — the language of your screen. It changes only your own screen.",
          "**Home** — back to **My trips**.",
          "**Find** — the front desk's search for bookings. It is not for drivers: if you tap it, the page only says **You don't have access to this page**.",
          "**Menu** — opens the menu.",
          "**Your name and your role** — check that it is you who is signed in.",
          "**Sign out** — always sign out when you share the phone with somebody.",
        ],
      }),
    ),

    chapter("Do the trip: three presses", "A trip has three steps, and the button on the card always shows the next one. Press each step when it really happens — not before, and not at the end of the day.",
      flow("From the hotel gate to the end of the trip", {
        shots: [
          ["d-trip-1", "**First press.** You leave for the pickup: ((3)) **I'm on the way**."],
          ["d-trip-2", "**Second press.** The guest is in the car: ((1)) **Guest picked up**."],
          ["d-trip-3", "**Third press.** You have arrived: ((1)) **Trip completed**."],
          ["d-trip-4", "**Done.** The card shows **Completed** and has no button any more."],
        ],
        plain: true,
        intro: "After each press a small message repeats the step, and the status on the card changes.",
      }),
      keep(
        h("What each press does"),
        table(["You press", "When", "The status becomes", "Who sees it"], [
          ["**I'm on the way**", "You drive off to the pickup place", "**In progress**", "Reception, on the Transport page"],
          ["**Guest picked up**", "The guest and the bags are in the car", "**In progress**", "Reception"],
          ["**Trip completed**", "The guest has got out at the destination", "**Completed**", "Reception — they can bill the trip now"],
        ]),
        warn("A step cannot be taken back from your phone. After **Guest picked up** the trip can only be completed. If you pressed a step by mistake, call Reception at once and tell them."),
      ),
      keep(
        h("Before you leave"),
        dots([
          "**Read the whole card** — the time, the place, the number of passengers and the note.",
          "**Check the flight** — for an airport pickup, look at the flight number. If the plane is late, tell Reception.",
          "**Call the guest when you need to** — tap the phone number on the card.",
          "**Take the right car** — when a car is written on the card, that is the car for this trip.",
        ], true),
      ),
      keep(
        h("When the guest is not there"),
        table(["What happens", "What you do"], [
          ["You cannot find the guest at the pickup place", "Call the guest from the card. Wait at the agreed place."],
          ["The guest does not answer", "Call Reception. They try to reach the guest and decide."],
          ["The guest did not come at all", "Tell Reception. They press **No show**. Do not press **Trip completed**."],
          ["The guest asks you to go somewhere else", "Call Reception first. The price was agreed for the trip on the card."],
        ]),
      ),
      keep(
        h("The money"),
        p("You do not record any payment in the system. When you press **Trip completed**, Reception sees the trip with its price and bills it: on the guest's **room bill**, or as a **direct payment**. A special price can only be given by a manager."),
        p("A guest who asked on the website may already have paid by mobile money from the page of their trip. Then the trip shows as paid, and you collect nothing."),
        tip("If a guest pays you by hand, bring the money to Reception the same day and tell them which trip it is for. They record it under the trip."),
      ),
    ),
  ],

  rules: [
    ["Your own account.", "Sign in as yourself. Every step is saved with your name and the time."],
    ["Open My trips before you start.", "Reload the page at the start of your work and whenever Reception says they gave you a trip."],
    ["Read the whole card.", "The time, the place, how many passengers, the flight and the note in the grey box."],
    ["Press each step when it happens.", "**I'm on the way** when you drive off, **Guest picked up** when the guest is in the car, **Trip completed** when they have got out."],
    ["Never press ahead.", "A step cannot be taken back from your phone."],
    ["Call from the card.", "The guest's phone number is on the trip. Tap it."],
    ["No show is Reception's button.", "When the guest does not come, call Reception. Do not complete the trip."],
    ["The money goes through Reception.", "You record no payment. Reception bills the trip after **Trip completed**."],
    ["Late flight, changed plan — tell Reception.", "They change the trip in the system so that everybody sees the same thing."],
    ["Sign out on a shared phone.", "**Menu**, then **Sign out**."],
  ],

  problems: [
    ["**No trips assigned** on the page.", "Nothing has been given to you yet. Reload the page. If Reception says there is a trip for you, ask them to open it and check the driver's name."],
    ["Reception gave you a trip but you do not see it.", "Pull the page down to reload it. Check that you are signed in with your own account."],
    ["A trip that was on your list is gone.", "It was cancelled, or a manager gave it to another driver. Ask Reception."],
    ["You pressed a step by mistake.", "Call Reception at once. You cannot take it back from your phone."],
    ["There is no button on the card.", "The trip is **Completed**, or Reception marked it **No show**. Nothing more to press."],
    ["The time or the place on the card is wrong.", "Do not drive on a guess. Call Reception — they correct the trip."],
    ["The guest's phone number is missing or wrong.", "Ask Reception for the right number. They can call the guest from the hotel."],
    ["More passengers than the car has seats.", "Call Reception before you leave. They choose another car or a second trip."],
    ["No network on your phone.", "Do the trip. Call Reception — they can press the steps for you. Reload **My trips** when the network is back."],
    ["The screen is in the wrong language.", "Tap **EN** or **中文** at the top of the page."],
    ["You cannot sign in.", "Check your email and password. If it still fails, ask your manager — they can give you a new password."],
    ["Something in the system looks broken.", "Tell your manager. For the system itself: write to Nino — the last page of this book."],
  ],
};
