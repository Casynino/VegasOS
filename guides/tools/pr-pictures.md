# Purchase requests: the pictures (prefix `pr-`) and what is behind them

For the writers of the Reception, Restaurant Counter, Kitchen, Finance and Purchasing books. Everything here was checked in the code
(`src/lib/stock-requests.ts`, `src/lib/permissions.ts`, `src/components/staff/nav-config.ts`, `src/server/services/stock-requests.ts`,
`procurement.ts`, `procurement-desk.ts`, the pages under `stock-requests/` and `procurement/`) and on the practice copy. Names, rooms and
amounts are practice examples. The pictures are `guides/shots/pr-*.jpg` (the `.txt` next to each one is the text that was on the page).
The shot list is `guides/tools/shots-pr.mjs`; it does nothing unless pictures are named, because many of them SAVE something.

**Every picture belongs to a moment.** The counters and the lists on it were true at that moment only. Do not retake a picture of an
earlier moment (the practice copy has moved on); write the book from the pictures as they are.

## 1. The practice records left behind

| Name here | Number | Who asked | What | Where it stands now |
|---|---|---|---|---|
| R1 | SR-2026-0002 · PO-2026-0001 | Asha (Reception) | 20 hand towels + 20 bath towels, estimate TZS 400,000, budget TZS 400,000 | **Done / Completed.** Quote Uhuru Hotel Supplies TZS 470,000 (TZS 70,000 over budget) authorized by Finance, delivered in two parts, invoice UHU-0387 verified and paid from CRDB Bank (expense EXP-2026-000013) |
| R2 | SR-2026-0003 | Chef Musa (Kitchen) | 4 frying pans, 2 gas cylinders, 20 litres cooking oil, estimate TZS 380,000 | **Sent back** by Finance with a note ("Say how many gas cylinders you use in a week."). The chef sees **More information needed** |
| R3 | SR-2026-0004 | Restaurant Counter | 24 drinking glasses, estimate TZS 120,000 (department Restaurant) | **Submitted**, waiting for Finance |
| R4 | SR-2026-0006 · PO-2026-0002 | Asha | 10 reams printer paper, estimate and budget TZS 90,000 | Delivered. Quote TZS 85,000 (inside the budget, no authorization). **Two invoices, none paid:** UHU-0391 TZS 85,000 due 10 Oct (overdue, "To verify") and UHU-0392 TZS 15,000 "delivery charge" (**Disputed** by Finance) |
| R5 | SR-2026-0005 | Asha | 6 air-conditioner filters + 40 light bulbs, estimate and budget TZS 250,000 | **Approved**, waiting for quotations (Purchasing's "To quote" tab) |
| R6 (extra) | SR-2026-0007 · PO-2026-0003 | Chef Musa | 50 kg sugar (a stock item), estimate/budget TZS 140,000 | Delivered, 50 kg went into the store. No invoice yet. Made only to show "goes into stock" |

Also left: Neema (Reception) started her shift (she could not open any page before it); the Finance authorization limit in Settings is **empty again**
(set to TZS 450,000 for one picture, then cleared). Suppliers created on the screen: Kariakoo Textile Traders, Mlimani Linen House, Uhuru Hotel Supplies.

## 2. The words the person who asked sees (`SIMPLE_STATUS`)

Seven words on the screen (the books say "six steps" plus Cancelled): **Submitted · More information needed · Approved · Purchased · Completed · Rejected** and **Cancelled**.

| What Finance and the managers see (the real step) | What the person who asked sees |
|---|---|
| Waiting for review | **Submitted** |
| Sent back to change | **More information needed** |
| Approved — to buy · Waiting for Finance to authorize the price | **Approved** |
| Being bought · Bought — waiting for approval · Ordered — waiting for delivery · Partly delivered · Delivered — invoice and payment to finish | **Purchased** |
| Done | **Completed** |
| Rejected | **Rejected** |
| Cancelled | **Cancelled** |

The asker sees only their own requests, no prices except the estimate they typed and the **budget Finance approved**, and a short history
(asked, changed, approved, sent back, order issued, deliveries, completed). The counters at the top for an asker are **Waiting** (Submitted + sent back),
**Approved** and **Done lately**. Purchasing's own words for an approved purchase: **Approved — awaiting supplier quotation**, then **Price authorized — ready to order**.

## 3. Who may do each step (checked in the code)

| Step | Right | Roles that hold it |
|---|---|---|
| Ask (new request, change and send again, cancel your own while Submitted or sent back) | `inventory.request` | Receptionist, Restaurant Counter, Kitchen (Mpishi), Purchasing (Accountant role), Manager, MD, Boss. **Finance does not ask.** |
| Which departments you may ask for | `askScope` | Reception: Reception, Housekeeping, Maintenance, Office, General (hotel list). Counter/Kitchen/Bar: Kitchen, Bar, Restaurant. Finance, managers, Boss, Purchasing: any |
| Review: Approve for purchase (with a budget), Change, Send back, Reject | `expenses.approve` | Finance, Manager, MD, Boss |
| Get quotations, Propose, Issue the order, Record a delivery, Record an invoice, Close the delivery short, Cancel an invoice | `procurement.manage` | **Purchasing (Accountant role) and Finance**, MD, Boss. Not the Manager. (Recording a delivery is also allowed with `inventory.receive`.) |
| Authorize a price above the budget (or when there is no budget) / send it back | `purchases.authorize` | Finance, MD, Boss. **Above `financeAuthorizationLimit` (Settings) only the Boss or the MD.** If the setting "approver must differ" is on, the person who recorded the quotation cannot authorize it |
| Verify or dispute an invoice, Record payment to the supplier | `purchases.pay` | Finance, MD, Boss. Purchasing never verifies or pays |
| Cancel the order (nothing delivered, no invoice) | `procurement.manage` or `purchases.authorize` | Purchasing, Finance, MD, Boss |
| Say whether what arrived is right ("It is all right" / "Report a problem") | the person who asked (or procurement / review rights) | Reception, Counter, Kitchen |
| Record the purchase directly ("Record the purchase", old route) | `inventory.receive` | Manager, Finance, MD, Boss — only while the request is Approved and **no quotation has been proposed**; refused after that |
| Open the Procurement pages | `dashboard.procurement` / `procurement.manage` / `purchases.authorize` / `purchases.pay` | Purchasing (this is their Home), Finance, MD, Boss. Not Manager, not Reception |

Money rules that show on the screens: a request is not an expense; an approval is not a payment; a purchase order is not a delivery; an invoice is not a payment.
**One expense is made for each supplier payment**, and only when Finance records it. Stock goes in only for **accepted** delivery lines that are linked to a stock item
(towels and printer paper asked under Reception are "not a stock item"; the sugar in R6 is).

## 4. The buttons, tabs and words, in the order of the flow

**A. Reception** (asha, after Start my shift). Menu: group **Hotel services** → **Guest requests**, and right under it **Purchase requests**.
Page tabs **New request** · **Requests**; counters Waiting · Approved · Done lately. Department list (shows **Reception**; **Other department…** for Housekeeping, Maintenance, Office, General).
Group chips (first is **Towels & bedding**), then tap the picture **Bath towels**, **Hand towels** (or **Something else**). **Your list** (− number + and unit). Then
*What is it for? (optional)* · *Estimated cost in TZS, if you know* ("The cost is only your estimate — it is not an approved expense.") · *Note for Finance (optional)* ·
*Photo or document (optional)* · **More options** → *Name this request (optional)*, *How soon is it needed?* **Low · Normal · High · Urgent**, *Needed by*.
Button **Check the list · 2 items** → window **Check your list** with **Print · PDF · Picture · Change it · Send 2 items to Finance**. Message: "SR-2026-0002 sent — Finance will review it."
Then tab **Requests**: the request with **Submitted**.

**B. Kitchen** (chef). Menu: group **Stores** → **Purchase requests** (under Inventory). Same page; buttons **Kitchen · Bar · Other department…**; chips Meat & fish, Vegetables & fruit,
Rice, flour & dry food, Dairy & eggs, Oil, spices & sauces, Tea & coffee, Supplies, **Kitchen & restaurant equipment**, then the drinks. Button **Send 3 items to Finance**.
When a request is **sent back**, the page opens on **Requests** (open **New request** to ask again).

**C. Restaurant Counter** (counter). The menu is one plain list: Home, Sell, Tables, History, Reservations, **Purchase requests**, Collections, Customers
(there is no "Restaurant & Bar" heading on this account's menu). Department list **Restaurant**, chip **Kitchen & restaurant equipment**, **Drinking glasses**; **Send 1 item to Finance**.

**D. Finance** (accountant). Menu: group **Stores** → **Purchase requests** (the number badge counts what waits). Counters **To review · To buy · Being bought · To approve**; rows say **Your turn**.
Open the request → field *Approved budget (TZS) — the most it may cost; a quotation above it comes back to you* (filled with the estimate; empty = no limit) → **Approve for purchase** ("SR-2026-0002 approved for purchase.").
Other buttons: **Change**, **Send back** (box *What should they change? e.g. Say how many kg* then **Send back**; message "Sent back to change."), **Reject** (box with a reason). An approved request appears in the **Shopping list** (Copy · WhatsApp).

**E. Purchasing** (purchasing). **Home** is the Procurement page; menu: Home, Inventory, **Purchase requests**. Tabs **To quote · With Finance · Ready to order · On order · Invoices and payment · Closed**; **Filters**.
Open the purchase (the number): tiles *Their estimate · Approved budget · Quotation · Ordered · Invoiced / paid · Delivered*, then **What is wanted**, **Supplier quotations**, Purchase order, Deliveries, Invoices and payment, Documents, History.
**Add a quotation** → window **Supplier quotation**: *Supplier* (a list, or **A new supplier…** + *New supplier's name* + *Phone (optional)*), per item *Quantity* and *Price each (TZS)*, *Quotation total*, *Price holds until*, *Delivery takes (days)*, *Note*,
*The supplier's quotation (photo or PDF)* → **Record the quotation** ("Quotation recorded."). With two or more quotations they sit side by side; the cheapest total is marked **lowest**; under each one **Propose this one**
(and **Finance must authorize** when its total is above the budget or no budget was set). Above the budget the status becomes **Waiting for Finance to authorize the price** and the page says "Nothing can be ordered until Finance authorizes this price."
Inside the budget the status is **Price authorized — ready to order** straight away.

**F. Finance authorizes.** Finance's tab bar has **Purchases** (the same page as Procurement; also a **Purchases** button on Finance's Home and the menu entry **Procurement** under Stores).
Finance opens on **With Finance**. Open the purchase → section **Waiting for Finance** ("The Accountant proposes Uhuru Hotel Supplies at TZS 470,000. The approved budget is TZS 400,000 — this is TZS 70,000 above it.") →
**Authorize this price** (window: *Note · optional*, button **Authorize**) or **Send back** (window "Send back to the Accountant", *What should the Accountant do?* required, **Send back**).
Above the limit: "TZS 470,000 is above what Finance may authorize alone (TZS 450,000) — the Boss or the MD authorizes it."

**G. Purchasing orders, receives, invoices.** **Issue the purchase order** (window **Purchase order**: *Expected delivery* (filled with today + the quotation's delivery days), *Note for the supplier*, **Issue the order**) → number PO-YYYY-NNNN, status **Ordered — waiting for delivery**.
**Record a delivery** (window **Goods received**: per item *Quantity accepted* (filled with what is still to come), *Not accepted*, *What is wrong* **Damaged · Not what was ordered · Other**, *Describe the problem*, *Note*, *Delivery note (photo or PDF)*, **Record the delivery**).
Part delivery → **Partly delivered** and the extra button **Close — the rest is not coming** (a reason is needed); everything delivered → **Delivered — invoice and payment to finish**. A line that went into the store says "· in stock".
**Record an invoice** (window **Supplier invoice**: *Invoice number*, *Amount (TZS)* (filled with delivered minus invoiced), *Invoice date*, *Due on · optional*, *Note*, *The invoice (photo or PDF)*, **Record the invoice**) → invoice **To verify**.

**H. Finance verifies and pays.** On the invoice: **Verify** (window "Verify the invoice", note optional, a reason is required if the invoice is more than what arrived, button **Verify**) → **Verified — to pay**;
or **Dispute** (window "Dispute the invoice", *What is wrong with it?* required, **Dispute**) → **Disputed**. **Cancel invoice** (a reason) while nothing is paid.
**Record payment** (window **Pay the supplier**: *Amount paid (TZS)*, *Paid on*, *Paid from* (account list), *Reference · optional*, *Note*, **Record the payment**) → invoice **Paid**, an expense "Supplier payment · UHU-0387 · PO-2026-0001 · SR-2026-0002" appears in **Expenses**
("Paid · approved"), and when everything is delivered and every invoice paid the purchase becomes **Done** (the asker sees **Completed**). A part payment leaves the invoice **Partly paid**.

Invoice words: To verify · Verified — to pay · Disputed · Partly paid · Paid · Cancelled.

## 5. The pictures

Views: `desk` unless it says tablet. Marks are the numbers drawn on the picture. "css" = a box with no printed name (given in words). All are dark-look pictures like the earlier books.

### A. Reception asks (R1)
| Id | Signed in | Page | Marks | Request |
|---|---|---|---|---|
| pr-a-menu | Asha | Reception home, menu scrolled to Hotel services | 1 Guest requests · 2 Purchase requests (directly under it) | — |
| pr-a-open | Asha | Purchase requests, tab New request, nothing chosen yet | 1 New request · 2 Requests · 3 department list (Reception) · 4 search box · 5 group chip Towels & bedding · 6 tile Bath towels · 7 Something else | — |
| pr-a-empty | **Neema** (Asha already had requests) | Tab Requests, the empty page "You have not asked for anything yet." (the green message is her shift starting) | 1 New request · 2 Waiting counter · 3 the empty box | — |
| pr-a-form | Asha | New request with both towels chosen, 20 each, reason, estimate and note filled | 1 department list · 2 chip · 3 chosen tile (badge 20) · 4 Your list · 5 What is it for · 6 Estimated cost · 7 Photo or document · 8 Check the list | R1 |
| pr-a-more | Asha | The same, More options opened | 1 More options · 2 Name this request · 3 How soon (Low/Normal/High/Urgent) · 4 Needed by | R1 |
| pr-a-check | Asha | Window "Check your list" (the printable sheet) | 1 Print · 2 Change it · 3 Send 2 items to Finance | R1 |
| pr-a-detail | Asha | R1 opened right after sending: Submitted, "Waiting for Finance to review it.", history, Cancel request | none | R1 |
| pr-a-list | Asha | Requests list with R1 **Approved** and R5 **Submitted** | 1 Waiting counter · 2 Approved word (R1) · 3 Submitted word (R5) | R1, R5 |
| pr-d-asha-list | Asha | Requests list when only R1 existed and was approved | 1 Approved word · 2 the row | R1 |
| pr-d-asha-open | Asha | R1 opened after approval: Approved, "Budget approved by Finance: TZS 400,000", "Approved by Finance — the Accountant is getting quotations from suppliers." | 1 status word · 2 budget line · 3 the waiting line | R1 |
| pr-h-asha-done | Asha | Requests list at the end: R1 **Completed** (Done lately 1), R5 Approved, R4 Purchased | none | R1, R4, R5 |

### B. Kitchen (tablet)
| Id | Signed in | Page | Marks | Request |
|---|---|---|---|---|
| pr-b-open | Chef | Purchase requests, New request, kitchen suggestions (Meat & fish) | 1 Kitchen · 2 Bar · 3 chip Meat & fish · 4 search | — |
| pr-b-form | Chef | Equipment group open, frying pans chosen, 3 items on the list | 1 Kitchen · 2 chip Kitchen & restaurant equipment · 3 Frying pans (badge 4) · 4 Your list · 5 What is it for · 6 Estimated cost · 7 Check the list | R2 |
| pr-b-sent | Chef | After Send 3 items: green message and the list with **Submitted** (and the old SR-2026-0001 Completed) | 1 Requests · 2 Waiting · 3 the row · 4 Submitted | R2 |
| pr-d-chef-list | Chef | After Finance sent R2 back: row with **Your turn** and **More information needed** | 1 row · 2 Your turn · 3 More information needed | R2 |
| pr-d-chef-open | Chef | R2 opened: orange "Sent back to you — please answer or change it: Say how many gas cylinders you use in a week.", history | 1 status · 2 the note · 3 Change and send again · 4 Cancel request | R2 |

### C. Restaurant Counter (tablet)
| Id | Signed in | Page | Marks | Request |
|---|---|---|---|---|
| pr-c-form | Counter | Menu (flat list) and the form: department Restaurant, drinking glasses 24 | 1 menu entry Purchase requests · 2 department list · 3 chip Kitchen & restaurant equipment · 4 Drinking glasses · 5 Your list · 6 Check the list | R3 |
| pr-c-sent | Counter | After Send 1 item: message and the row **Submitted** | 1 Requests · 2 the row · 3 Submitted | R3 |

### D. Finance reviews
| Id | Signed in | Page | Marks | Request |
|---|---|---|---|---|
| pr-d-menu | Finance | Finance Home, menu scrolled to Stores | 1 Procurement · 2 Purchase requests (badge = waiting) | — |
| pr-d-queue | Finance | Purchase requests: R1, R2, R3 waiting (To review 3), Spent on stock, Finished | 1 To review counter · 2 R1 row · 3 Your turn · 4 Waiting for review | R1–R3 |
| pr-d-open1 | Finance | R1 opened: budget field (400000), lines, history, the four buttons | 1 Approved budget field · 2 Approve for purchase · 3 Change · 4 Send back · 5 Reject | R1 |
| pr-d-approve1 | Finance | After approving R1: message, To buy 1, Shopping list, row **Approved — to buy** (mark 1 sits on the To buy counter, partly over "To review") | 1 To buy · 2 the R1 status | R1 |
| pr-d-back-form | Finance | R2 opened, Send back chosen, the note typed | 1 note box · 2 Send back | R2 |
| pr-d-back-sent | Finance | After sending R2 back: message "Sent back to change.", row **Sent back to change** | 1 To review · 2 the R2 status | R2 |

### E. Purchasing gets quotations (R1; R4 for the "inside budget" case)
| Id | Signed in | Page | Marks | Request |
|---|---|---|---|---|
| pr-e-menu | Purchasing | Procurement (their Home) with the menu | 1 Home (= Procurement) · 2 Inventory · 3 Purchase requests | — |
| pr-e-board | Purchasing | Procurement, tab To quote: R4, R5, R1 all **Approved — awaiting supplier quotation** | 1 To quote tab · 2 R1 number · 3 Budget column · 4 status · 5 Filters | R1, R4, R5 |
| pr-e-work0 | Purchasing | R1's workspace before any quotation ("No quotation yet.") | 1 Their estimate · 2 Approved budget · 3 What is wanted · 4 In stock now · 5 Add a quotation | R1 |
| pr-e-q-form | Purchasing | Window Supplier quotation filled for Kariakoo Textile Traders (new supplier, 5,500 and 14,000, total 390,000) | 1 Supplier · 2 New supplier's name · 3 first price box · 4 Quotation total · 5 Price holds until · 6 Delivery takes (days) · 7 Record the quotation | R1 |
| pr-e-quote-a, pr-e-quote-b | Purchasing | After recording the first and second quotation (green message) | none | R1 |
| pr-e-quotes | Purchasing | Three quotations side by side: 390,000 (lowest) · 430,000 · 470,000; budget 400,000. (Mark 5 is on the first button, under the lowest quotation; the one proposed next is the right-hand one.) | 1 Supplier quotations · 2 lowest · 3 Quotation terms · 4 Budget TZS 400,000 · 5 Propose this one · 6 Finance must authorize (under 470,000) | R1 |
| pr-e-proposed | Purchasing | After proposing Uhuru (470,000): status **Waiting for Finance to authorize the price**, amber box | 1 status · 2 Waiting for Finance · 3 "The Accountant proposes…" · 4 "Nothing can be ordered until Finance authorizes this price." | R1 |
| pr-e-within | Purchasing | R4 after proposing 85,000 (budget 90,000): **Price authorized — ready to order**, "…is within the approved budget." | 1 status · 2 Purchase order · 3 the sentence · 4 Issue the purchase order | R4 |

### F. Finance authorizes (R1)
| Id | Signed in | Page | Marks | Request |
|---|---|---|---|---|
| pr-f-board | Finance | Procurement page ("Purchases" tab of Finance's bar), tab With Finance, six money tiles | 1 Purchases tab · 2 Asked for tile · 3 Still owed tile · 4 With Finance tab · 5 R1 number · 6 status | R1 |
| pr-f-open | Finance | R1's workspace: "Waiting for Finance" and the two buttons | 1 Approved budget · 2 Quotation · 3 Waiting for Finance · 4 Authorize this price · 5 Send back | R1 |
| pr-f-limit | Finance | Window Authorize this price and the red message "TZS 470,000 is above what Finance may authorize alone (TZS 450,000) — the Boss or the MD authorizes it." (limit set for this picture only, cleared after) | 1 Authorize | R1 |
| pr-f-authform | Finance | The same window with the note "Uhuru delivers in 2 days and the guests arrive on Friday." | 1 Note · 2 Authorize | R1 |
| pr-f-authorized | Finance | After authorizing: **Price authorized — ready to order**, Purchase order box, history. (A small bell message "Purchase — price authorized, issue the order…" shows at the top.) | 1 status · 2 Purchase order | R1 |

### G. Purchasing orders, receives, invoices
| Id | Signed in | Page | Marks | Request |
|---|---|---|---|---|
| pr-g-order-form | Purchasing | Window Purchase order (To Uhuru Hotel Supplies for TZS 470,000; delivery 15 Oct; note) | 1 Expected delivery · 2 Note for the supplier · 3 Issue the order | R1 |
| pr-g-ordered | Purchasing | After issuing: PO-2026-0001, **Ordered — waiting for delivery**, Committed 470,000 | 1 status · 2 Purchase order · 3 Expected delivery · 4 Record a delivery · 5 Cancel the order | R1 |
| pr-g-delivery-form | Purchasing | Window Goods received: hand towels 20 accepted; bath towels 8 accepted, 2 not accepted, Damaged, "Two towels torn at the edge" | 1 item name · 2 Quantity accepted · 3 Not accepted · 4 What is wrong · 5 Describe the problem · 6 Delivery note · 7 Record the delivery | R1 |
| pr-g-delivery-1 | Purchasing | After it: **Partly delivered**, "2 not accepted (damaged…)" in red, received 20/20 and 8/20, Delivered TZS 266,000 | 1 status · 2 Deliveries · 3 not accepted · 4 Record a delivery · 5 Close — the rest is not coming | R1 |
| pr-g-delivery-2 | Purchasing | After the rest (12 bath towels): **Delivered — invoice and payment to finish**, two deliveries listed | 1 status · 2 Delivered tile · 3 Invoices and payment · 4 Record an invoice | R1 |
| pr-g-invoice-form | Purchasing | Window Supplier invoice: UHU-0387, 470,000, 13/10/2026, due 27/10/2026 | 1 Invoice number · 2 Amount · 3 Invoice date · 4 Due on · 5 The invoice (photo or PDF) · 6 Record the invoice | R1 |
| pr-g-invoiced | Purchasing | After recording: invoice **To verify**, only "Cancel invoice" for Purchasing; Invoiced / paid TZS 470,000 / 0 | 1 To verify · 2 Invoices and payment · 3 the invoice line · 4 Invoiced / paid tile | R1 |
| pr-g-stock-in | Purchasing | R6 (sugar, a stock item) after the delivery: "Sugar: 50 kg accepted · in stock", In stock now 50 kg | 1 status · 2 In stock now · 3 "· in stock" · 4 Record an invoice | R6 |
| pr-g-inventory | Purchasing | Inventory, Stock tab: Sugar 50 kg, TZS 135,000 (was 0) | 1 Sugar · 2 50 kg · 3 group header | R6 |

### H. Finance verifies and pays; the lists
| Id | Signed in | Page | Marks | Request |
|---|---|---|---|---|
| pr-h-open | Finance | R1's invoice before checking (the page is scrolled to Invoices and payment) | 1 Invoices and payment · 2 To verify · 3 Verify · 4 Dispute | R1 |
| pr-h-verify-form | Finance | Window Verify the invoice with a note | 1 note · 2 Verify | R1 |
| pr-h-verified | Finance | After verifying: **Verified — to pay**, "Verified by Grace Mushi: …", Record payment | 1 Verified — to pay · 2 Verified by · 3 Record payment · 4 Cancel invoice | R1 |
| pr-h-pay-form | Finance | Window Pay the supplier: 470,000, 13/10/2026, CRDB Bank, reference | 1 Amount paid · 2 Paid on · 3 Paid from · 4 Reference · 5 Record the payment | R1 |
| pr-h-paid | Finance | After paying: **Done**, Invoiced / paid 470,000 / 470,000, invoice **Paid** with the payment line and expense number EXP-2026-000013 | 1 Done · 2 Invoiced / paid tile · 3 the payment line · 4 Paid | R1 |
| pr-h-expenses | Finance | Expenses: the supplier payment of TZS 470,000 "Paid · approved" (the page is long; this is its top) | 1 Money spent box · 2 the expense · 3 Paid · approved | R1 |
| pr-h-requests | Finance | Purchase requests list at the end of the day (R1 Done in Finished, others in their steps) | none | all |
| pr-h-dispute-form | Finance | R4: Dispute window for UHU-0392 with the reason "The delivery charge was not on the order." | 1 note · 2 Dispute | R4 |
| pr-h-disputed | Finance | R4: UHU-0391 **To verify** (due 10 Oct, overdue) and UHU-0392 **Disputed** ("Disputed by Grace Mushi: …") | 1 To verify · 2 Disputed · 3 the dispute line · 4 Verify · 5 Cancel invoice | R4 |
| pr-h-invoices | Finance | Procurement, tab **Invoices and payment**: R4 "Delivered — invoice and payment to finish · an invoice is disputed"; tiles Invoiced TZS 570,000 · Paid TZS 470,000 · Still owed TZS 100,000 | 1 the tab · 2 Invoiced tile · 3 Still owed tile · 4 PO number · 5 an invoice is disputed | R4 |
| pr-h-closed | Finance | Procurement, tab Closed: R1 | none | R1 |
| pr-h-home | Finance | Finance Home: "1 supplier invoice past its due date — TZS 85,000 still owed", "1 supplier invoice disputed" | 1 Purchases button · 2 Needs your attention · 3 overdue line · 4 disputed line | R4 |
| pr-m-queue | Manager | Purchase requests: the Manager also reviews (To review, To buy), Shopping list | 1 To review · 2 To buy · 3 R3 row | R1–R5 |
| pr-m-open | Manager | R5 opened: Approved, budget TZS 250,000; **Record the purchase** (direct purchase) · Change · Reject | 1 Record the purchase · 2 Change · 3 Reject | R5 |

### Set-up pictures (no marks, do not use in a book)
`pr-x-r4-send`, `pr-x-approve5`, `pr-x-approve4`, `pr-x-r4-quote`, `pr-x-r4-order`, `pr-x-r4-delivery`, `pr-x-r4-inv-a`, `pr-x-r4-inv-b`, `pr-x-r6-send`, `pr-x-r6-approve`, `pr-x-r6-quote`, `pr-x-r6-propose`, `pr-x-r6-order` —
the steps that built R4, R5 and R6 (each shows the page right after the step).

## 6. Things to write carefully

- Say **Purchase requests** for the menu entry and the page, and **Procurement** for Purchasing's page (Finance reaches it from **Purchases** on its tab bar, **Procurement** under Stores, or the **Purchases** button on its Home).
- For the person who asks, **Approved** means "Finance said yes" — it may still be waiting for quotations or for Finance to authorize a higher price. **Purchased** covers everything from "ordered" to "delivered, invoice to finish". The invoice and the payment are never shown to the asker.
- A quotation above the budget is not an error: it goes to Finance. The budget is the most the request may cost; Finance may authorize more, with a note, up to its limit.
- The Counter's menu has no "Restaurant & Bar" heading; the Kitchen finds the page under **Stores**; Reception under **Hotel services**.

## 7. Product problems noticed (not fixed — outside the books)

1. **The asker's "Approved" counter** counts only Approved / Being bought / Bought-waiting. A request that is waiting for Finance to authorize a price, ordered, part delivered or delivered shows the word **Approved** or **Purchased** on its row but is **in no counter** (and the "Approved" counter filter will not list it). (`stock-requests.tsx`, counters for people who only ask.)
2. **Hotel items are not linked to the stores.** Reception's requests are for the department *Reception*, so "Bath towels" and "Printer paper" are "not a stock item", although Housekeeping has a stock item "Bath towels" and Office has "Printer paper". The delivery window still says "What you accept goes into stock now". Only a request made for the department that owns the stock item (Kitchen, Housekeeping…) puts goods into stock.
3. **Procurement list:** when a request has no name, the small line under the number repeats it ("SR-2026-0006 · SR-2026-0006").
4. **Counter menu:** the Restaurant Counter's menu is one flat list with no "Restaurant & Bar" heading, so "under Restaurant & Bar" is not what staff see.
5. **A bell message appears on Finance's own screen** right after Finance authorizes ("Purchase — price authorized, issue the order for SR-…") and after verifying ("pay supplier invoice…"): Finance holds the Purchasing right too, so it is told to do the next step itself.
6. **Expenses list:** the expense of a supplier payment still shows **Edit** and **Cancel** buttons (the project notes say it is untouchable from Expenses; the server refusal was not tried).
7. **Invoice dates:** an invoice dated before the order existed (R4: dated 6 Oct, order 13 Oct) is accepted; there is no check against the order date.
8. The chef (or any asker) with a request sent back lands on **Requests**, not on **New request**; to ask again the tab must be pressed.
