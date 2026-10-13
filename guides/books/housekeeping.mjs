import { chapter, task, tour, tip, warn, rule, p, h, dots, table, shot, keep } from "../tools/kit.mjs";

export default {
  id: "housekeeping", file: "Vegas-Guide-05-Housekeeping.pdf", name: "Housekeeping guide", dept: "housekeeping", accent: "#6b7f2a", soft: "#f0f3e4",
  kind: "Rooms", kicker: "Guide book 05", title: "Housekeeping",
  sub: "The Daily Housekeeping Checklist — how to read it, which room comes first, what to tick, and how a cleaned room goes back to Reception.",
  cover: { shots: ["h-cover"], frame: "paper" },
  lead: "This book is for the **housekeeping team** of Vegas Luxury Hotel. Housekeeping does not sign in to the system. Your work comes on one sheet of paper — the **Daily Housekeeping Checklist** — that Reception prints from the system. The system follows every room: who has left, who is staying, who arrives today. So the sheet already tells you which rooms to clean, which one comes first and which ones to leave alone. When a room is done you tell Reception, and Reception marks it **Clean & ready**. Every page shows the real sheet and the real screen.",

  place: [
    h("What housekeeping hands over"),
    table(["What", "Goes to", "How it gets there"], [
      ["A room you have started", "Reception", "You tell Reception the room number. They press **Start cleaning** and the room shows **Cleaning**."],
      ["A cleaned room", "Reception", "You tell Reception. They check the room and press **Clean & ready** — only then can it be given to a guest."],
      ["The finished sheet", "Reception", "Ticked, with your name, the times and your signature. Reception signs **Reception verification**."],
      ["Something broken or missing in a room", "Reception", "You tell Reception. They write it down as a **guest request**, so somebody takes it and it is not forgotten."],
    ]),
    h("What comes to housekeeping"),
    table(["What", "From", "Where you see it"], [
      ["The checklist", "Reception", "Printed from **Daily lists** — every guest room of the hotel on one sheet."],
      ["A room to clean after check-out", "Reception", "At check-out the room turns to **Needs cleaning** by itself. It is on the sheet under **1. Check-out cleaning**."],
      ["A guest's wish", "The guest, from the QR card in the room", "The guest taps **Cleaning** or **Fresh towels** on their phone. Reception gets it and tells you. An open cleaning wish is also printed in **Notes**."],
    ]),
  ],

  chapters: [
    chapter("How the work reaches you", "Nobody has to walk the corridors to find out which rooms need you. The system follows every room all day, and Reception prints what it knows onto your sheet.",
      keep(
        h("One room, from check-out to ready"),
        table(["What happens", "Who does it", "What the room shows"], [
          ["The guest checks out", "Reception", "**Needs cleaning** — by itself, at once. The room cannot be given to a new guest."],
          ["The sheet is printed", "Reception", "The room is in **1. Check-out cleaning**: **Yes — full clean**, **Waiting to be cleaned**."],
          ["You start the room", "You tell Reception — they press **Start cleaning**", "**Cleaning**. A sheet printed now says **Cleaning in progress**."],
          ["You finish the room", "You tell Reception — they check it and press **Clean & ready**", "**Clean / Ready**. The room can be given to the next guest."],
        ]),
        rule("A room is ready for a guest only after Reception has pressed **Clean & ready**. A tick on the paper changes nothing in the system."),
      ),
      tour("The rooms, as Reception sees them", {
        shot: "h-rooms",
        intro: "Reception's page **Rooms** shows every room as a tile. This is where your work is watched during the day.",
        items: [
          "**Available** — clean and empty. Nothing to do.",
          "**Occupied** — a guest is in the room.",
          "**Needs cleaning** — the guest has left. | The tile shows how long the room has been waiting: **Waiting 1 h**.",
          "**Room QR codes** — the card that stands in every room. | The guest scans it with their phone to order, to see the bill and to ask for things.",
        ],
      }),
      tour("What a guest can ask for from the room", {
        shot: "h-ask",
        intro: "The guest scans the QR card in the room and gets their own page. At the bottom is **Your room** — “Ask here and reception takes care of it.”",
        items: [
          "**Late check-out** — Leave after 11:00. | Reception answers the guest. The room is cleaned after the guest has gone.",
          "**Cleaning** — Tidy up, fresh sheets. | Reception gets it at once. If it is still open when the sheet is printed, it is printed in **Notes**.",
          "**Something else** — the guest writes what they need.",
        ],
        notes: [
          tip("On the same list: **Fresh towels** (towels, bathrobe, toiletries) and **Something is not working** (AC, TV, water, lights). Every one of them goes to Reception first."),
        ],
      }),
      tour("Where the wish lands — Guest requests", {
        shot: "h-req", w: 80,
        intro: "Reception's page **Guest requests** — “Towels, cleaning, repairs, help — accept it, handle it, mark it done.”",
        items: [
          "**Log a request** — Reception writes down what a guest asked at the desk or on the phone, and what you found in a room.",
          "**Accept** — somebody takes the request. It moves to **On it**, with the name and the time.",
          "**Hand it to…** — gives the request to another person of the hotel.",
        ],
        notes: [
          tip("Housekeeping has no account, so your name is not on the list of **Hand it to…**. A receptionist accepts the request and sends you to the room. Tell them when it is done — they press **Mark done**."),
        ],
      }),
    ),

    chapter("Read the checklist", "One sheet for the whole hotel. Every guest room is on it once, in four parts. Read it from the top — the top tells you how big the day is.",
      tour("The top of the sheet", {
        shot: "h-top", frame: "paper",
        items: [
          "**Reporting date** — the day the sheet is for. | Work only from today's sheet.",
          "**The number of the sheet** — a printed sheet has its number here, like **HK-20261012-1**, with the time it was made and **Printed by**. | **Preview — not printed yet** is what Reception sees before printing.",
          "**Rooms listed** — all the guest rooms of the hotel.",
          "**Requiring cleaning** — your work today. | Under it: how many are **check-out** rooms and how many are **occupied** rooms.",
          "**Awaiting cleaning** — check-out rooms the guest has already left. You can start them now. | **1 being cleaned now** appears when a room has been started.",
          "**Already ready** — clean rooms. No work.",
          "**Requiring attention** — rooms you must not prepare before you ask Reception.",
          "**The hotel rule for occupied rooms** — **daily service**: a light service each day, not a full clean.",
        ],
        notes: [
          tip("If the hotel changes the rule, the line reads **on request — serviced only when the guest asks**. Then an occupied room is work only when its line says **Yes — the guest asked**."),
        ],
      }),
      tour("The seven columns", {
        shot: "h-part1", frame: "paper", w: 80,
        items: [
          "**Room No.**",
          "**Room type** — Standard Single, Double Deluxe, Executive, Executive Suite or Twin.",
          "**Current status** — what the system says about the room now. | **Needs cleaning**, **Cleaning**, **Occupied** or **Available**.",
          "**Cleaning required?** — the answer for today. | **Yes — full clean**, **Yes — after the guest checks out**, **Yes — daily service** or **No**.",
          "**Cleaning status** — where the work stands. | **Waiting to be cleaned** and since when, **Cleaning in progress**, **Guest still in the room**, **Clean and ready**.",
          "**Staff tick / initials** — yours. | Tick the box and write your initials when the room is done.",
          "**Notes** — read it before you start the room. | **Guest arriving today — clean first**, or what the guest asked for.",
        ],
      }),
      keep(
        h("Part 1 — Check-out cleaning"),
        p("“Full clean. Rooms a guest arrives into today come first.” The picture above shows this part. The rooms are already in the right order: first the rooms a new guest arrives into today, then the rooms you can clean now, then the rooms the guest has not left yet."),
        table(["On the sheet", "What it means", "What you do"], [
          ["**Needs cleaning** · **Yes — full clean** · **Waiting to be cleaned**", "The guest has left. The line also says since when the room is waiting.", "Clean it now — a full clean."],
          ["**Occupied**, **Check-out time passed** · **Yes — after the guest checks out** · **Guest still in the room**", "The guest should have left, but is still in the room.", "Do not go in. Ask Reception, and clean the room when the guest has gone."],
          ["**Occupied**, **Leaves today** and the time · **Yes — after the guest checks out**", "The guest leaves today.", "Clean the room after the check-out."],
          ["**Cleaning** · **Cleaning in progress**", "Somebody has started this room.", "Finish it and tell Reception."],
          ["**Guest arriving today — clean first** in Notes", "A new guest comes into this room today.", "This room before the others."],
        ]),
      ),
      keep(
        h("Part 2 — Occupied rooms: the guest is staying on"),
        shot("h-part2", { frame: "paper" }),
        p("The guest is in the hotel tonight too — **Staying until** and the day. These rooms get the **daily service**, never a full clean. On each line there are three small boxes. Tick the one that is true:"),
        dots([
          "**Serviced** — you did the daily service.",
          "**Do not disturb** — the guest does not want anybody in the room now. Do not knock again and again; tell Reception.",
          "**Guest declined** — the guest said no service today.",
        ]),
        tip("**Yes — the guest asked** in the column **Cleaning required?** means the guest asked for cleaning from their phone. What they wrote is in **Notes**: **Guest asked: Please clean the room after 14:00**."),
      ),
      keep(
        h("Part 3 — Already clean and ready"),
        shot("h-part3", { frame: "paper" }),
        p("“No cleaning needed.” These rooms are on the sheet only so that the sheet is complete — every room of the hotel once. **Guest arriving today** in Notes tells you a guest will come into that clean room today."),
      ),
      keep(
        h("Part 4 — Other rooms needing attention"),
        shot("h-part4", { frame: "paper" }),
        p("“Not ready for a guest. Do not prepare without reception.” On a normal day this part is empty: **No rooms here today.** When a room is here, the sheet says why:"),
        table(["On the sheet", "What it means", "What you do"], [
          ["**Under maintenance** · **Out of service** · **Closed today for maintenance** · **Closed today — out of service**", "The room is closed. **Closed until** and the day may be in Notes.", "**No — do not prepare.** Leave the room."],
          ["**Marked occupied, but no guest is checked in**", "The room and the bookings do not agree.", "**Check with reception first.**"],
          ["**A guest is checked in, but the room is not marked occupied**", "The same — the other way round.", "**Check with reception first.** Somebody may be in the room."],
        ]),
      ),
    ),

    chapter("Clean a room and hand it back", "The paper is yours. The system is Reception's. A room goes back to the hotel in two steps: you finish it and tick it, then Reception checks it and marks it.",
      task("Work through the sheet", {
        when: "Every day, as soon as Reception gives you the sheet.",
        shot: "h-cover", frame: "paper", side: 88,
        steps: [
          "Read the top: **Requiring cleaning** is the number of rooms that need you today.",
          "Start with part 1. First the rooms with **Guest arriving today — clean first**, then the rooms that say **Waiting to be cleaned**.",
          "Tell Reception which room you start. | They press **Start cleaning**, and everybody sees the room is being cleaned.",
          "A room that says **Guest still in the room**: do not go in. Come back after the guest has checked out.",
          "When a room is finished, tick the box in **Staff tick / initials** and write your initials.",
          "Tell Reception the room is done. | They check it and press **Clean & ready**.",
          "Then part 2: the daily service of the occupied rooms. Tick **Serviced**, **Do not disturb** or **Guest declined**.",
        ],
      }),
      keep(tour("What Reception presses for you", {
        shot: "h-mark",
        intro: "On Reception's page **Daily lists**, above the sheet, is the box **Mark rooms in the system** — “Ticks on the printed sheet change nothing. When a room is done and checked, mark it here.” There is one line for every room that waits for cleaning.",
        items: [
          "**The room and its status** — **105 Needs cleaning**.",
          "**Start cleaning** — pressed when you begin the room. | The line then reads **Cleaning**, and only **Clean & ready** is left.",
          "**Clean & ready** — pressed when Reception has checked the finished room. | The line leaves the box and the room can be given to a guest.",
        ],
        notes: [
          warn("If nobody tells Reception, the room stays **Needs cleaning** in the system — even when it is perfectly clean. A guest who arrives cannot be given that room. Always report a finished room at once."),
        ],
      })),
      tour("The page Reception prints from", {
        shot: "h-print", w: 86,
        items: [
          "**Housekeeping Checklist** — your sheet.",
          "**In-House Guest & Breakfast List** — the second sheet, for the breakfast team: who is in the house and whose breakfast is included.",
          "**Print** — keeps the list exactly as it is now, as a numbered copy, and prints it.",
          "**Start cleaning** — as above.",
          "**Clean & ready** — as above.",
        ],
        notes: [
          tip("The list is **live**: it is read from the rooms and the bookings at that minute. When your sheet is old, ask Reception to press **Refresh** and print a new one — it gets the next number."),
        ],
      }),
    ),

    chapter("The end of the round", "The sheet is a record of the day. Before it goes back to Reception, the bottom of it is filled in by hand.",
      task("Close the sheet", {
        when: "When all your rooms are done, or when your work ends.",
        shot: "h-sign", frame: "paper", cols: false,
        steps: [
          "**Housekeeping staff** — write your name. If more people worked from the sheet, all the names.",
          "**Start time** and **Completion time** — when you began and when you finished.",
          "**Notes** — what Reception must know: a room you could not enter, something broken, something a guest left behind.",
          "**Staff signature** — sign it.",
          "Give the sheet to Reception. They look at the rooms, mark them in the system and sign **Reception verification**.",
        ],
        notes: [
          tip("The last line of every sheet says it again: “Ticks on this sheet do not change room statuses. Reception marks a room clean and ready in the system after checking it.”"),
        ],
      }),
      keep(
        h("What to tell Reception, and when"),
        table(["What you see", "Tell Reception", "What Reception does"], [
          ["You start a check-out room", "The room number", "Presses **Start cleaning**."],
          ["A room is finished", "The room number", "Checks it and presses **Clean & ready**."],
          ["The guest is still in a check-out room", "The room number", "Speaks to the guest. You clean after the check-out."],
          ["Something is broken or missing — AC, TV, water, lights, towels", "The room and what is wrong", "**Log a request**, so somebody takes it."],
          ["A guest left something behind", "The room and what it is — and bring it to the desk", "Keeps it for the guest."],
        ]),
      ),
    ),
  ],

  rules: [
    ["Work from today's sheet only.", "Look at **Reporting date** and at the time the sheet was made. Yesterday's sheet is wrong today."],
    ["Arrivals first.", "A room that says **Guest arriving today — clean first** is cleaned before every other room."],
    ["Never enter a room that says Guest still in the room.", "Ask Reception. Clean it after the guest has checked out."],
    ["A tick is not “ready”.", "A room is ready only after Reception has pressed **Clean & ready**."],
    ["Report every finished room at once.", "A clean room that is still **Needs cleaning** in the system cannot be given to a guest."],
    ["Occupied rooms get the daily service.", "A light service each day, not a full clean — and one of the three boxes ticked."],
    ["Respect Do not disturb.", "Tick the box, tell Reception, and leave the guest in peace."],
    ["Do not prepare a room in part 4.", "**Other rooms needing attention** are closed or unclear. Reception decides."],
    ["Everything you find goes to Reception.", "Broken things, missing things, things a guest forgot. Reception writes it into the system."],
    ["Sign the sheet.", "Name, start time, completion time and signature — then Reception verifies it."],
  ],

  problems: [
    ["The sheet says a room needs a full clean, but a guest is inside", "Do not go in. Tell Reception — the guest may have stayed longer or has not checked out yet. Ask for a new sheet."],
    ["A room is not on the sheet at all", "Every guest room is on the sheet once. Look in all four parts. If it is really missing, tell Reception."],
    ["Reception says a room is still “Needs cleaning”, but you cleaned it", "It was not reported, or not yet marked. Tell Reception the room number — they check it and press **Clean & ready**."],
    ["A guest arrives and the room is not ready", "Reception will ask you to do that room now. Leave the others and clean it first."],
    ["The guest of an occupied room does not want service", "Tick **Guest declined** on the line of the room. Do not insist."],
    ["A sign on the door says do not disturb", "Tick **Do not disturb** and tell Reception at the end of your round."],
    ["A guest stops you in the corridor and asks for towels or cleaning", "Help if you can, and tell Reception, so it is written in **Guest requests**. The guest can also ask from the QR card in the room."],
    ["Notes says “Guest asked: …”", "Do what the guest asked — for example clean after 14:00 — and tell Reception when it is done, so the request is marked done."],
    ["Something in the room is broken", "Do not try to repair it. Tell Reception the room and what is wrong."],
    ["The sheet got wet, torn or lost", "Ask Reception to print it again. A printed copy is kept in the system and prints exactly the same."],
    ["Many rooms changed since the morning", "Ask Reception to press **Refresh** and print a new sheet. Carry your ticks over by hand."],
    ["Something on the sheet or in this book is not clear", "Ask Reception or the Manager. For the system itself: write to Nino — the last page of this book."],
  ],
};
