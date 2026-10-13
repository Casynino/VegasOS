import { chapter, task, tour, flow, tip, warn, rule, p, h, dots, table, cards } from "../tools/kit.mjs";
export default {
  id: "zz-sample", file: "zz-sample.pdf", name: "Reception guide", dept: "reception", accent: "#1f6f8b", soft: "#e8f2f5",
  kind: "Front office", kicker: "Guide book", title: "Reception", sub: "Bookings, check-in and check-out, room bills, guest requests and your shift — step by step, with pictures of every screen.",
  cover: { shots: ["x-rec-home"] },
  lead: "This book is for the receptionists of Vegas Luxury Hotel. Read chapter 1 once to see where Reception sits in the hotel, then keep the book at the desk and open the chapter you need.",
  place: [h("What Reception hands over, and what it gets back"), table(["From Reception", "To", "How it arrives"], [["A room that needs cleaning", "Housekeeping", "On the printed daily checklist, first on the list when a guest arrives into it today."], ["A confirmed trip", "Driver", "On the driver's phone, under **My trips**."]])],
  chapters: [
    chapter("Your shift", "You cannot work before your shift is open, and the day is not finished until it is closed.",
      task("Start your shift", { when: "The first thing you do when you arrive at the desk.", shot: "s-rec-00-start", steps: ["Sign in with **your own** account. | Never work in a colleague's account.", "Read the page: it tells you who is on shift now.", "Press [[!Start my shift]].", "The top bar now shows [[On shift · since 15:39]].", "Work as normal: every payment you record belongs to this shift."], notes: [rule("At most **two** receptionists can be on shift at the same time. A third is refused with a message that names both.")] }),
      tour("The Reception home page", { shot: "x-rec-home", items: ["**Arrivals** — guests expected today. | Press a name to check in.", "**In house** — who is staying now.", "**Departures** — who leaves today.", "**Guest requests** — towels, cleaning, repairs.", "**Transport** — the next 24 hours.", "**Unpaid after check-out** — money still owed."] }),
    ),
    chapter("On the phone", "The waiter's screen and the public website, to try the phone layout.",
      task("Open the Live board", { when: "All day.", shot: "x-wtr-home", steps: ["Sign in on your phone.", "Press [[Start my shift]].", "New orders appear at the top.", "Press the step button on the card."], notes: [tip("The bell rings twice for every new order."), warn("Do not close your shift while you still have open orders.")] }),
      flow("A guest books a room on the website", { shots: [["x-web-home", "Open **www.vegashoteltz.com**."], ["x-web-home", "Choose the dates."], ["x-web-home", "Pick a room and confirm."]] }),
      h("Cards"), cards([["Pay now", "At the Counter", "Cash, card or mobile money."], ["On the room", "Bill to my room", "Goes on the room bill."], ["Online", "Pay by phone", "A prompt arrives on the phone.", true]], 3),
    ),
  ],
  rules: [["One account each.", "Sign in with your own name."], ["Open the shift first.", "No shift, no work."], ["Money is recorded when it is received.", "Never before."], ["A reason is a real reason.", "Write what happened."]],
  problems: [["The page does not load", "Check the Wi-Fi, then reload."], ["A guest says they paid but the bill shows unpaid", "Do not mark it paid. Ask the manager."]],
};
