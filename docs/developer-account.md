# The Developer account

For the owner. Plain words, no code. Read this once before you create the account, and keep it for later.

## 1. What it is, and what it is not

The Developer account is **one separate sign-in for the developer** (you, when you work on the system). It has its own **console** to see how the system is doing, to read the permanent diary of everything that happens (the audit), to look at the hotel's data in plain tables (business), and to **work as any staff member** (access) when you need to help them or see what they see.

It is **not** a staff account with a bigger title. It is a different kind of account:

- It has its own email and its own password. It is never a copy of the Boss, the MD or any staff login.
- **Signing in is as simple as for anyone else: one email and one password.** There are no codes, no second step and no separate sign-in page for the Developer. The system looks at the account itself, on the server, and a Developer lands on the Developer console.
- **Every action is written in the audit trail as a Developer action**, under your real name. The system decides who you are from your signed-in account on the server. It never takes it from a page, a department or the browser.
- **It can never write money, and it can never decide about money** (section 8). It can look at money, but it cannot record, reverse, approve, pay or withdraw it, cannot decide what a guest or a supplier owes, and cannot change where guests pay or the money limits. This stays true while you work as someone else.
- **It can never be used to take over an account.** You cannot see or change anyone's password or login email (section 5).
- There is **no sign-up page** and **no password in the code**. The account is made in one way only: by you, on your own computer, with the setup command in section 2.

## 2. Set up on the live database (step by step)

Do this once. You need: your computer, the project folder, and the live database address (the same address the live website uses; you find it in the hosting dashboard under the project's environment variable `DATABASE_URL`, or in the database provider's dashboard). **Never paste the database address in a chat, an email or a message.**

**Step 1. Deploy first.** The deploy runs the database update that adds the Developer role, the audit-trail lock and the "work as" fields. The setup command checks this and stops with a clear message if the update has not run yet ("Deploy the application first"). Nothing is changed when it stops.

**Step 2. Give the command the database address, safely.** Choose ONE of these two ways. The address is never printed on the screen, and it is never read from the project's normal `.env` file.

- **Way A (recommended): the environment variable, for this one terminal only.** In a terminal opened in the project folder (the Mac Terminal uses zsh, which these lines are written for):

  ```
  read -s "DATABASE_URL?Database address (not shown): "
  export DATABASE_URL
  ```

  Paste the address and press Enter. Nothing appears while you paste; that is normal. When you finish (Step 4), run `unset DATABASE_URL` or close the terminal.

- **Way B: a file named `.env.developer.local`** in the project folder, with one line: the database address. Make it with a text editor, not with a command that would keep the address in your shell history. The file is ignored by git, so it is never uploaded. **Delete the file when the setup is done.**

If both exist and they are different, the command stops, so there is no doubt which database it is talking to.

**Step 3. Run the setup.**

```
npm run developer:setup
```

It runs in the terminal and asks you, in this order:

1. It first shows the **database name**, whether it is "on this computer" or "on a remote server", and the **hotel name**, and the job it is about to do. Read them. If the database name is not the live one, stop (Ctrl+C).
2. **"To confirm this is the right database, type its name (…)"**. Type the database name exactly. If you type anything else, nothing is changed.
3. **"Developer's email"**. Use a NEW address that you can receive mail on. It must not be the email of any staff account (the command refuses an email that is already used).
4. **"Developer's full name"**. This name appears in the audit trail, in the console and in the message the Boss receives when you work as someone.
5. **"New password (not shown)"** and **"Type it again (not shown)"**. Nothing appears while you type, not even stars. The password must be:
   - at least 14 characters (a few words with numbers and a symbol is easy to remember and hard to guess);
   - with a capital letter, a small letter, a number and a symbol;
   - not starting or ending with a space;
   - not your email, not the first part of your email, and not an easy word like "password", "admin", "qwerty" or "123456".

   If it is not strong enough, it tells you why (it never repeats the password) and asks again, up to 5 times.

By default there can be only **one active Developer account**. A second one needs the extra option `--allow-second`; do not use it unless you really need it.

**What it prints when it is done:** `DONE — the Developer account was created`, then your name, your email, the role (Developer (super user)) and "Password: set". It never prints the password or its hash.

**What it writes:** one user with the Developer role, with the password stored only as a one-way hash, and one audit-trail entry (`developer.provisioned`: who = the setup script, with the email and name, never the password). It is all or nothing: if anything fails, nothing is saved.

**Step 4. Clean up.** `unset DATABASE_URL` (Way A) or delete `.env.developer.local` (Way B). Store the password in a password manager (section 11).

**Step 5. Check it.** Open `/staff/login` and sign in with the Developer's email and password, like anyone else. You land on the Developer console (Home). Open **Audit** and find the entry that says the account was set up.

## 3. Signing in, and how long a session lasts

- Open `/staff/login`, type the email and the password, press Sign in. That is all. A Developer lands on the console; every other person lands on their own dashboard, as always.
- If the email or the password is wrong, or the account is switched off, the page shows **one and the same message** whatever the reason. Nobody can learn from it which accounts exist.
- The Developer account is guarded harder than the staff accounts: after a few wrong tries (**5 for one Developer email in 15 minutes**) it makes you wait.
- A wrong try on a real account is written in the audit trail (`auth.login_failed`, shown as the **System**, because nobody was signed in). The password that was typed is never written.
- Signing in ends any other session that browser had. One browser, one identity.
- The Developer account is more powerful, so its session is short:
  - **4 hours at most** from signing in. After that you must sign in again, even if you are working.
  - **30 minutes without use ends it.** Screens that refresh by themselves in the background (the alert bell) do not count as use, so an open tab cannot keep the session alive.

  Staff sessions are not changed.

## 4. The console: Home, Audit, Business, Access

When a Developer signs in, the menu on the left says **Developer console** and has four places. Your name and **Sign out** are at the bottom. Everything about the hotel is reached through **Business** (look only) or **Work as** (act as a person); the console itself never changes hotel data.

- **Home.** How the system is doing. A greeting, then a **health score out of 100** (a ring, one plain sentence and three chips: to fix now / to look at / for information) with four numbers: the **database** (online, and how many milliseconds it took to answer), **people signed in today**, **actions saved in the last 24 hours** and **alerts waiting** over a day. Under it, **Needs your attention** and **Good to know** cards (each opens to say what it means and what to do), and three shortcuts: Access, Audit, Business. Five tabs go deeper: **Activity** (sign-ins and actions per day, busiest hours, where the work happens, most active people, recent sign-ins, accounts nobody uses), **Speed & size**, **Crashes & sign-ins**, **Settings** and **People & my actions** (what any role may do, and your own last 30 actions). Home only reads: it never changes hotel data.
- **Audit.** The permanent diary of the system (section 7).
- **Business.** The hotel's data in plain read-only tables (section 9).
- **Access.** Every staff account, grouped by role. Pick a person and press **Work as**, **Suspend** or **Sign out everywhere** (section 5).

Every console page checks, on the server, that you are the Developer account. A staff member who types the address gets "no access". While you are **working as** someone, the console is closed: you see that person's own screens, and the console comes back when you press **Stop**. The two worlds are never mixed.

## 5. Access: Work as, Suspend, Sign out everywhere

The Access page lists the accounts (every account except Developer accounts and the system's own online-payment account), grouped by role, the Boss first. Each person shows their name, whether they are active, their role, their email and when they last signed in.

**Work as.** Opens that person's real dashboard, with their real data, **without their password**.

- You hold **that person's rights, minus everything about money** (the same list the Developer never holds, section 8). So you can do their ordinary work (look at a booking, check a guest in, move a room, take a restaurant order, mark a room clean) but a payment, a discount, an expense, a withdrawal, a purchase payment, an invoice or a cash handover is **refused by the system**, as it would be for the Developer. The decisions that belong to the Boss, the MD and the managers stay refused too.
- A **bar at the top** of every page says who you are working as. Press **Stop** to come back to the console.
- It ends **by itself after 4 hours**, and also when your Developer session ends (4 hours at most, 30 minutes without use).
- You cannot work as a Developer account, a switched-off account or the system account, and you cannot start a second one while you work as someone (press Stop first).
- **The Boss is told, on WhatsApp, every time you start**, in the Boss's language: your name (Developer), who you are working as, their role and the time. The message is sent in the background like the reports: if WhatsApp is not set up or fails, Work as still starts and the audit trail still has the entry (see the honest limits, section 12).
- A receptionist normally needs an open shift to work. While you work as them, that rule is skipped, so you can see their screens without starting a shift in their name.

**Suspend.** Blocks the account and signs the person out until it is switched back on.

- You must write a **reason** (at least 5 characters) and type **CONFIRM**. The reason is written in the audit trail.
- It cannot be used on the **Boss's account** ("Can't be suspended here"), on Developer accounts, on the system account or on your own account, and not while you work as someone.
- **You can only switch back on an account you suspended yourself**, and never an account whose role holds a money right (Finance, a manager, the MD…). For those, ask the Boss or the MD to switch it back on. This is on purpose: it means suspending cannot be used to lock out the people who run the money.

**Sign out everywhere.** Ends every open session of that person, on every phone and computer. They can sign straight back in (useful when a phone is lost). It cannot be used on yourself, on Developer accounts or on the system account, and not while you work as someone.

**Safety rules while working as someone.** The system refuses all of these, on the server, whatever the screen shows:

- creating an account;
- changing any password or any login email;
- changing a role or a right;
- suspending or switching back on an account;
- signing people out everywhere;
- changing the person's own preferences (their language, their alert sound);
- and, underneath all of that, **any write at all to the accounts, the sessions, the roles or the rights** in the database (a "fence" in the database layer, so a page that was forgotten still cannot do it).

So Work as can never be used to take over an account.

## 6. Changing the password, switching the account off

All three jobs use the same command, in the same safe way as the setup (section 2, Steps 2 and 3). They ask you to type the database name first, like the setup does.

| Job | Command | What happens |
|---|---|---|
| **New password** (rotate) | `npm run developer:setup -- --rotate` | Asks for a new password (same strength rules). The old password stops working. **All open Developer sessions end.** It refuses the same password as the one now in use. |
| **Switch the account off** | `npm run developer:setup -- --deactivate` | The Developer cannot sign in. All open sessions end. |
| **Switch it on again** | `npm run developer:setup -- --rotate --reactivate` | A switched-off account needs a new password to come back, so both options go together. A new password alone does not switch it on. |

Every one of these writes an entry in the audit trail (`developer.password_rotated`, `developer.deactivated`), without any password in it.

If there is more than one Developer account, the command asks "Which Developer?" and you type the email.

**If you forget the password:** there is no "forgot password" email for the Developer. Run `--rotate` on your computer. Nobody else (not the Boss, the MD or a manager) can see or reset the Developer account from the Users page, and you cannot see or reset anyone else's password from anywhere (not from the console and not through Work as).

**Switch it off when you are not working on the system.** An account that is off cannot be attacked.

## 7. Audit: the permanent diary

The Developer's Audit page is **`/staff/developer/audit`**. (The Boss and the MD have their own Audit trail page, `/staff/audit`; it is unchanged.) Both read the same diary.

- Each line is one thing that happened: **a coloured dot, one plain sentence** ("Neema checked a guest in."), then **who · date · code**, and badges on the right: **Developer** (when it was you), **Succeeded** or **Failed**, and the **module** (the kind of record).
- **Dot colours:** gold = done by you (the Developer), including when you worked as someone; blue = normal staff work; grey = the system or the website; red = it failed.
- **Work as is shown for what it is.** An entry written while you worked as Neema reads **"Nino (Developer) as Neema (Receptionist)"**, not just "Neema". The page also keeps who you were acting as, so the Boss can always see that it was you.
- A failed sign-in is shown as the **System**, because nobody was signed in.
- **Filters:** *Everything*, *Developer actions*, *Failures* (a failed attempt, a refusal, or an entry that says it did not work). A **search box** looks in who did it, what it was (the action's name or its plain words) and where (the kind of record or its number). A **date range** picks the days (the last 7 days to begin with, at most one year at a time).
- **50 entries a page**, newest first, up to 200 pages for one search (narrow the dates to go further back). Times are in the hotel's time zone.
- Open a line to see its exact time, the business day, the record, the address (IP), the reason given, what went wrong, and the **before and after** values. Anything that looks like a secret is hidden ("[hidden]") when it is shown.

Who may read the audit trail: **the Boss, the MD and the Developer**. Nobody else. The Boss and the MD can see every Developer action, but they cannot use the Developer account's special right (`developer.access`) and cannot give it to anyone.

**Review it every week** (see section 11).

## 8. What the Developer cannot do: write money, or decide about it

The Developer can look at everything about money (the finance pages, the ledger, the reports) but **cannot write it and cannot decide about it**. The server refuses it, whatever the screen shows. **This is the same while you work as someone else:** the person's rights are given to you with every one of these taken out.

This is a fixed, written-out list, not "everything except a few things". The Developer role holds only the rights that were chosen for it one by one. A new right added to the system in future is **not** given to the Developer until a person decides that it should be (a test fails until that is decided). In plain words, the Developer cannot:

**Write money**

- record a payment, reverse a payment or give a refund;
- record or void a sale (restaurant, bar or other sales);
- record, approve or void an expense;
- authorize a purchase, or verify a supplier invoice and pay a supplier;
- record transfers, owner money or corrections, or accept a cash count;
- hand over cash, receive a cash handover, or accept a cash handover that is short or over;
- withdraw money from the hotel's nTZS balance, or settle a withdrawal by hand;
- confirm a restaurant payment by hand, or press **Check with nTZS** / **Check all with nTZS** (they record a payment that nTZS says arrived);
- create, issue or cancel an invoice;
- set where a payment account's books begin, or add or change a payment account.

**Decide what a guest, a company or a supplier owes**

- give a discount or free nights, let a guest leave with a balance owing, bill another guest's room, or put a late-checkout fee, a transport price or a room-service order on a bill;
- confirm or hold a booking without payment;
- cancel a booking or mark a no-show (that decides whether the payment is kept or a refund is due);
- change room prices, seasons or promotions, or the selling prices of the restaurant menu (so the whole menu set-up is for the Boss and the MD);
- set a company's credit limit or payment terms, or approve a booking above a company's credit;
- get supplier quotations, issue purchase orders, record deliveries or attach supplier invoices;
- record stock received (the price paid becomes the item's cost), approve waste, count stock or correct quantities, set up inventory items and their costs;
- set the budgets and the gifts of the Spin to Win game.

**Change where guests pay, or a limit**

- change the bank account, the mobile-money (Lipa) number or the "pay into" words and terms printed on invoices;
- change the approval limits: what an expense may be approved for, what Finance may authorize alone, and whether the buyer of a purchase may also approve it;
- change the fees (late checkout, room service, airport transfer), the tax, or the policies for early departure, no-shows and date changes;
- change the list of payment methods, or switch online payment on or off.

The server checks this when the settings are saved: if a Developer's save would change any of these, **the whole save is refused and nothing is written** (a save that leaves them as they are works). Every other setting (the hotel's name, times, contact details, languages, wifi, texts and links) the Developer can still change.

**Send or hold back the financial reports**

- make, regenerate or resend the daily reports to the Boss;
- change who receives the reports, or switch them off.

**Make or take over an account that can do any of the above**

- create, re-activate, change the role of, reset the password of, or remove a staff account whose role holds any of these rights (or the right to make accounts);
- give any of these rights to any role.

**Who does these instead.** Finance, the managers, the Boss and the MD, who answer for them, and each action carries their name. **To test a money flow, ask the Boss or the MD to create a test staff account.** The Developer cannot make one, and cannot use any account that holds money rights.

**What the Developer can do.** Look at every page and every record in Business; work as any staff member for everything except money and account takeover (reservations, check-in and check-out, rooms and housekeeping, guests and customers, requests, transport trips, restaurant orders and the kitchen, stock use, assets); change the settings that are not about money; manage staff accounts that hold no money right (with a reason); suspend, sign out and work as people (section 5); read the audit trail.

Money stays intact in other ways too: the Developer's role is fixed by the system and is not editable from the Users page, and these limits are enforced on the server for every page and every action, not only by hiding buttons.

Other protections around the account:

- Nobody can create the Developer account, or give its role to someone, from the Users page. Only the setup command creates it.
- Nobody (the Boss and MD included) can give the Developer's special right to any role.
- When the Developer makes a sensitive change to staff accounts or roles, or suspends someone, it must give a **reason** (at least 5 characters). The reason is written in the audit trail.
- When the Developer tries something it is not allowed to do, the refusal is written in the audit trail too (`developer.denied`), so a permission problem is visible. A refused attempt to work as someone is written as `developer.work_as_refused`.

## 9. Business: look, don't touch

**`/staff/developer/business`** shows the hotel's data in plain tables, in five tabs. Each table shows the **latest 30**, newest first.

| Tab | What it shows |
|---|---|
| **Stays** | the latest 30 bookings: code, guest, room(s), arrival to departure, status, total, paid and balance |
| **Money** | the latest 30 payments (what for, amount, method and account, who recorded it, reversed or not) and the latest 30 expenses (what, category, payee, amount, who recorded it, voided or not) |
| **Restaurant** | the latest 30 orders: number, place, state, total and what is paid (an order put on a room's bill says so; it is not shown as "unpaid") |
| **Stores** | the latest 30 stock movements, and the items that are below their own minimum |
| **Customers** | the latest 30 customers: name, code, phone and the last stay |

- **Read-only.** There is no button, no form and no link to an editing page. You can check a number safely. If a record is wrong, the person who owns it fixes it, or you use Work as to see their screen.
- Amounts are shown **in full** (TZS 703,000, never "703k"). Dates are in the hotel's time zone. On a phone each table becomes a stack of small cards.
- Only what staff already see is shown. **A customer's phone number is shown; nothing else personal** (no e-mail address, no ID number). Payment accounts are shown by name only, never by account number.
- **Every visit is recorded.** The visit to the page is written like any Developer visit, and each tab you open is written on its own (`developer.business_viewed`, once per tab in ten minutes), because Customers shows phone numbers and Money shows who recorded what.

## 10. What is recorded

Every entry in the audit trail has:

- **Actor type:** Developer, Staff, System or Website. It is taken from the signed-in account's role in the database at the moment of writing, so it cannot be faked by a page.
- **Name and role** of the person (a copy is kept on the line, so it stays correct even if the account is removed later).
- **Time**, shown in the hotel's time zone (East Africa time), and the **business day** it belongs to.
- **Action** (for example `reservation.created`) and the **record** it touched.
- **Before and after:** what the record said before and what it says now.
- **Reason**, for the sensitive changes that ask for one (staff accounts, roles, suspending).
- **Success or failure.** A **failed or refused attempt** is written too.
- **Looking.** Looking is an action too. A Developer's **visit to a page** is written (`developer.viewed`) for every page except the sign-in page, the "no access" page and the person's own account page; the same page is written once in 10 minutes, so refreshing does not fill the trail. A look at a tab of Business is written (`developer.business_viewed`). A look at what a person can do is written. An **export or a download** (a CSV, a ledger, a stored file) is written **every time, before the data is sent**; if the entry cannot be written, nothing is sent.
- **Working as someone.**
  - `developer.work_as_started` when you start (who you work as, their role), `developer.work_as_ended` when you stop or it ends (with how long it lasted), `developer.work_as_refused` when an attempt was refused (with why).
  - **Everything you do while working as someone is written under your own name**, as "Nino (Developer) as Neema (Receptionist)", never under Neema's name. The hotel's own records (for example who checked a guest in) still carry Neema's name, because that is how the hotel's books work. **The audit trail is where the truth is: it says it was you.**
  - Entries written by other people at the same moment are never touched.
- **Suspending, switching back on, signing out everywhere:** `user.suspended` (with the reason), `user.reactivated` (with the reason), `user.signed_out_everywhere`, under your name.
- **Failed sign-ins** on a real account.
- The **address (IP)** the request came from, where it is known.

**Never recorded: secrets.** Passwords, hashes, tokens, API keys, PINs and similar values are replaced by "[hidden]" before anything is written. Screens do not show them either.

## 11. Security checklist

- [ ] A **strong, unique password**, made and kept in a **password manager**. Never typed from memory on a shared computer.
- [ ] **No sharing.** Nobody else uses the Developer account. Anyone else who needs access gets their own account with the right they need.
- [ ] **Never reuse a staff password**, or any other password, for the Developer account.
- [ ] A **separate email** that only you can read, kept safe with a strong password.
- [ ] **Review the Audit every week**: look for sign-ins at odd times, failed sign-ins, `developer.denied` and `developer.work_as_refused` entries, every `developer.work_as_started` (do you remember each one?), and changes to staff accounts you do not remember.
- [ ] **Press Stop** when you finish working as someone, and **Sign out** when you finish (the 4-hour and 30-minute limits are a safety net, not a plan).
- [ ] **Switch the account off** (`--deactivate`) when you are not working on the system. Switch it back on with `--rotate --reactivate`.
- [ ] **Rotate the password** (`--rotate`) every few months, and at once if you lose a device, or if someone else could have seen it.
- [ ] Keep the **database address and login** limited to you. Delete `.env.developer.local` after use.
- [ ] Work on a computer you trust, with a screen lock.
- [ ] To test something with money in it, **ask the Boss or the MD for a test staff account**; do not look for a way round the wall.

## 12. The audit trail cannot be changed or deleted, and the risks that remain (read this)

**No edit and no delete.** There is no screen and no button to edit or delete an audit entry, for anyone, the Developer, the MD and the Boss included. On top of that, **a database lock (a trigger) refuses every change and every delete** of an audit row. Only new entries can be added.

The honest limits of this lock:

- **One narrow step in the app** changes an audit row: "cancel a check-in" relabels the two earlier check-in entries as "voided" (only the action word changes), and the cancellation itself is written as a new entry with the before-state. Nothing else in the app touches an old entry.
- **The "clean start" maintenance script** (used once before launch) opens the lock for its own run on purpose.
- **Someone who holds the database login can get round the lock.** The lock can be switched off by a setting inside a database session, and a person with owner-level access can remove the trigger itself. So **the database address and its login are the keys to the audit trail.** Keep them limited to as few people as possible, never put them in a chat or a repository, and change them if you think they were seen.

The Developer account is built so that a mistake or a stolen password cannot write money or hide who did what. It is not a perfect wall. These are the honest limits:

- **The database login is the master key.** Whoever holds the database owner login can remove the audit-trail lock, and can change any record, money included, without the app.
- **No multi-factor authentication (MFA) yet.** This system has none, for the Developer account or for any account. A Developer sign-in is protected by a strong password, the short session, the wait after wrong tries and the audit trail, but **if someone learns the password they can sign in**, and with it they can work as anyone (except for money). Adding MFA (a code from an app or a security key, at least for the Developer, the Boss and the MD) is the **recommended next step**. Until then, the checklist in section 11 matters even more.
- **Work as is real power.** While you work as someone you can do everything that person can do **except money and taking over the account**: check guests in and out, move rooms, change what staff changed, answer guests. The hotel's own records will carry that person's name (see section 10); only the audit trail says it was you. Anyone who reads the hotel's records without the audit trail could think the person did it. That is why every start is told to the Boss and every action is written under your name.
- **The message to the Boss is best effort.** It is sent in the background, like the reports. If WhatsApp is not set up, or the provider is down, Work as still starts and the audit trail still has the entry. It never blocks you, and the audit trail does not depend on it.
- **A Developer sees everything**, including guests' details and the money figures. Looking is recorded, but it cannot be undone: a Developer who has seen something has seen it.
- **The wall is code.** The rules in section 8 and the safety rules in section 5 are in the program and in the database, and tests check them. Whoever changes the program could also remove a rule, and the Developer account itself cannot stop that. A second pair of eyes on every change to the program before it goes live, and the weekly review of the audit trail, are the real safety.
- **Money that arrives by itself is not the Developer's.** When a guest pays online, the system records it when nTZS confirms (this happens automatically, as the system, not as the Developer).

## 13. If the setup command stops

It always says why, and it always says "Nothing was changed" when nothing was. The common cases:

| It says | What to do |
|---|---|
| "There is no database address" | Do section 2, Step 2 (Way A or Way B). |
| "Two different database addresses were found" | Remove one of them (the variable or the file). |
| "Could not connect to the database" | Check the address and that you are online. |
| "The Developer role is not in this database yet. Deploy the application first" | Deploy, wait until it is finished, then run it again. |
| "That is not the name of this database" | Type the name exactly as shown above the question. |
| "A user with this email already exists" | The Developer needs its own email, different from every staff email. |
| "An active Developer account already exists" | There is only one. Use `--rotate` or `--deactivate`. |
| "That password is not strong enough" | Follow the rules shown; it lists what is missing. |
| "This Developer account is switched off" | Use `--rotate --reactivate`. |
| "This asks you questions, so it must run in a terminal" | Run it yourself in a terminal window, not from a script or an editor's task runner. |
