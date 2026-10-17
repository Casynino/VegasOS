import { h, p, table } from "../tools/kit.mjs";
import { role, needs, moneyIn, moneyOut, accounts, reading } from "./parts/finance-a.mjs";
import { chapters as part2 } from "./parts/finance-b.mjs";

// Finance: the money desk. Chapters: the role and the Home, the jobs waiting, money in, money out, the accounts (parts/finance-a.mjs),
// then Withdraw funds and Purchases (parts/finance-b.mjs), reading the numbers (finance-a), and a day / a week / a month (finance-b).
const [withdraw, purchases, routine] = part2;

export default {
  id: "finance", file: "Vegas-Guide-11-Finance.pdf", name: "Finance guide", dept: "finance", accent: "#0f766e", soft: "#e3f2f0",
  kind: "Money and purchasing", kicker: "Guide book 11", title: "Finance",
  sub: "The hotel's money on one page: what needs you, what came in, what went out and where it is — and how you review, authorize, pay and withdraw, step by step.",
  cover: { shots: ["fa-cover"] },
  lead: "This book is for **Finance** at Vegas Luxury Hotel: the person who holds the hotel's money. Reception and the Counter take the payments, the departments ask for what they need, and Purchasing gets the quotes. **You see all of it, you decide, you pay, and you keep the books in order.** Every figure comes from the records — nothing is guessed, and every correction leaves a trace.",

  place: [
    h("What comes to Finance"),
    table(["What", "From", "Where you see it"], [
      ["A request to buy something", "Reception, the Restaurant Counter, the kitchen and the other departments", "**Purchase requests** — the box **To review**; a red number on the menu."],
      ["A price above the approved budget", "Purchasing (the Accountant role)", "**Procurement → With Finance**; the card **… purchase prices waiting for you to authorize**."],
      ["A supplier's invoice", "Purchasing", "**Procurement → Invoices and payment**; the cards **to verify** and **to pay**."],
      ["Every payment that was recorded", "Reception, the Counter, and the guests' phones (nTZS)", "**Income**, **Collections**, the accounts, the ledger and the Home."],
      ["An expense at or above the limit", "The Manager, or anyone who records one", "**Expenses → Waiting approval**; a card on the Home."],
      ["Guests who left owing, firms that did not pay", "Reception and the Manager", "**Who owes us**; cards on the Home."],
      ["Online money that does not fit a bill", "nTZS", "**Online payments → Needs a person**."],
    ]),
    h("What goes out from Finance"),
    table(["What", "Goes to", "How"], [
      ["Yes or no on a request, with a budget", "The person who asked, and Purchasing", "The request changes its step; the asker reads one of seven simple words."],
      ["A price that is authorized", "Purchasing", "Purchasing can then issue the order."],
      ["A payment to a supplier", "The supplier, and the books", "**Record payment** on the invoice: one expense, once."],
      ["A withdrawal from nTZS", "The person named, and the Boss", "**Withdraw funds**: priced, checked, sent once."],
      ["The books: accounts, ledger, reports", "The Manager, the MD and the Boss", "They read the same pages. The daily, weekly and monthly reports go to the Boss by WhatsApp."],
    ]),
    h("Each money job, and the chapter that teaches it"),
    table(["The job", "Where", "What you do there"], [
      ["**Money in** — payments, collections, who owes us, companies", "Chapter 4", "Read what was received, correct a wrong line, record a payment that reached you, follow the firms and guests that owe."],
      ["**Money out** — expenses", "Chapter 5", "Record an expense, approve or reject one that waits, read who changed what."],
      ["**The accounts** — balances, movements, cash counts, the ledger", "Chapter 6", "Move money between accounts, count the cash, read every line of the ledger."],
      ["**Withdraw funds** — nTZS to a phone, a Lipa number or a bank", "Chapter 7", "Ask for the price, check the name, send once, watch it until it says Completed."],
      ["**Purchases** — review, authorize, verify, pay", "Chapter 8", "Decide on a request, authorize a price above the budget, verify an invoice and pay the supplier."],
      ["**Reports and the numbers** — Home, Reports, Daily reports", "Chapters 9 and 10", "Read what the figures mean, and what to open each morning, week and month."],
    ]),
    p("Chapter 3 lists every card of your **Needs your attention** box and the page it opens. If you do only one thing on your first day, open it and work the cards from the top."),
  ],

  chapters: [role, needs, moneyIn, moneyOut, accounts, withdraw, purchases, reading, routine].filter(Boolean),

  rules: [
    ["Write what happened, never what you hope", "A payment is recorded when the money has arrived. A promise, a zero and an invoice are not payments."],
    ["Four figures, never added", "Earned, received, still owed and the balance of an account answer four different questions. Read them side by side."],
    ["A request is not an expense, an approval is not a payment", "One expense is made for each supplier payment — when you really pay. Never type it again by hand."],
    ["Check, then pay", "Verify an invoice against the order and the delivery before you record the payment. Dispute it when it is wrong."],
    ["Correct at the line, with the reason", "Edit or reverse the line itself. The old line stays, struck through. Nothing is deleted, and nothing is changed to make a report look right."],
    ["Nobody approves their own expense", "What you record above the limit waits for the Manager, the MD or the Boss."],
    ["A withdrawal moves money — it is not income and not an expense", "Only nTZS's fee is a cost. Look at the name, send once, and never send again after “Not confirmed”."],
    ["A count shows a loss, it does not hide it", "A cash difference is explained in writing and accepted by a person who understands it."],
    ["Compare the books with the bank", "At least every week. A difference means something is not recorded: record it — do not change an old line."],
    ["The limits belong to the Boss and the MD", "The expense limit, the Finance authorization limit, what staff may discount, the opening balance and the online-payment switches."],
    ["Read the same pages the Boss reads", "The daily, weekly and monthly reports are made by the system. Know what they say before you are asked."],
    ["Amounts are written in full", "TZS 1,885,000 — never “1.9M”, never a guess."],
  ],

  problems: [
    ["I do not understand a card on my Home.", "Press it: it opens the page where the work is. The chapter **The jobs waiting for you** lists every card."],
    ["**What stands out** is missing.", "Normal. When there is too little to say, no sentence is written."],
    ["**Still owed** on the Home is bigger than **Who owes us**.", "The Home also counts the restaurant's open orders. They are on **Collections** under **STILL TO COLLECT**."],
    ["An expense I recorded says **Waiting approval**.", "It is at or above the limit. Another approver must decide — you cannot approve your own. Until then it is not counted."],
    ["A payment was recorded on the wrong account.", "**Income → Edit** on the line: choose the right account. The amount stays the same."],
    ["A payment was recorded twice.", "**Income → Reverse** on the second one. It stays on the register, struck through."],
    ["I pressed **Edit** on a supplier payment and the system refused.", "That expense changes only from the purchase. Open the purchase on **Procurement**."],
    ["The system says an invoice number is already on an order.", "Its expense is made when you pay it on the purchase. Do not record it by hand."],
    ["The cash count is short or over.", "Count again. Write the reason in the count. Accept it; do not change payments."],
    ["An account is **below zero**.", "A payment went out before the money came in, or a movement was not recorded. Find it and record it."],
    ["**Mobile money to check** appears on Online payments.", "Money came in that did not fit a bill. Refund it, record it by hand or put it on the right bill — then **Dealt with** and write what you did."],
    ["A withdrawal says **Not confirmed**.", "Do not send another one. Follow the chapter **Withdraw funds**: nothing else can be sent until it is settled by the Boss or the MD."],
    ["I do not see **Opening balance** on an account.", "Only the Boss and the MD set it. It is not a fault."],
    ["I want to change what staff may discount, or the limits.", "Ask the Boss or the MD. They are not Finance's to change."],
    ["Yesterday's daily report is missing, or did not reach the Boss.", "Open **Daily reports**. A missing day can be made; a report that exists is sent again with **Send now**. If it still fails, tell the MD."],
    ["The screen shows an error, or a number looks impossible.", "Take a picture of the screen and send it to Nino on WhatsApp — the number is at the bottom of every page."],
  ],
};
