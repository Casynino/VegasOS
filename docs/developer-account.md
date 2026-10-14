# The Developer account

For the owner. Plain words, no code. Read this once before you create the account, and keep it for later.

## 1. What it is, and what it is not

The Developer account is **one separate sign-in for the developer** (you, when you work on the system). It can look at and fix everything in the hotel system: reservations, rooms, the staff accounts, the settings, the reports and the audit trail.

It is **not** a staff account with a bigger title. It is a different kind of account:

- It has its own email and its own password. It is never a copy of the Boss, the MD or any staff login.
- On the sign-in page it has its own door: **Developer account**. Staff use **Staff account**. A Developer's password does not work at the staff door, and a staff password does not work at the Developer door. Both fail with the same plain message, so nobody can learn which accounts exist.
- While you are signed in as the Developer, **every page shows a purple strip at the top: "DEVELOPER MODE — SUPER USER"**, with your name, **Sign out**, and **Switch to a staff account**. You cannot hide it, and nobody can mistake the Developer for an ordinary user.
- **Every action is written in the audit trail as a Developer action**, under your real name. The system decides who you are from your signed-in account on the server. It never takes it from a page, a department or the browser.
- **It can never write money, and it can never decide about money** (section 7). It can look at money, but it cannot record, reverse, approve, pay or withdraw it, cannot decide what a guest or a supplier owes, and cannot change where guests pay or the money limits.
- There is **no sign-up page** and **no password in the code**. The account is made in one way only: by you, on your own computer, with the setup command in section 2.

## 2. Set up on the live database (step by step)

Do this once. You need: your computer, the project folder, and the live database address (the same address the live website uses; you find it in the hosting dashboard under the project's environment variable `DATABASE_URL`, or in the database provider's dashboard). **Never paste the database address in a chat, an email or a message.**

**Step 1. Deploy first.** The deploy runs the database update that adds the Developer role and the audit-trail lock. The setup command checks this and stops with a clear message if the update has not run yet ("Deploy the application first"). Nothing is changed when it stops.

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
4. **"Developer's full name"**. This name appears in the audit trail and on the purple strip.
5. **"New password (not shown)"** and **"Type it again (not shown)"**. Nothing appears while you type, not even stars. The password must be:
   - at least 14 characters (a few words with numbers and a symbol is easy to remember and hard to guess);
   - with a capital letter, a small letter, a number and a symbol;
   - not starting or ending with a space;
   - not your email, not the first part of your email, and not an easy word like "password", "admin", "qwerty" or "123456".

   If it is not strong enough, it tells you why (it never repeats the password) and asks again, up to 5 times.

By default there can be only **one active Developer account**. A second one needs the extra option `--allow-second`; do not use it unless you really need it.

**What it prints when it is done:** `DONE — the Developer account was created`, then your name, your email, the role (Developer (super user)), and "Password: set". It never prints the password or its hash. It also tells you to sign in at `/staff/login` and choose **Developer account**.

**What it writes:** one user with the Developer role, with the password stored only as a one-way hash, and one audit-trail entry (`developer.provisioned`: who = the setup script, with the email and name, never the password). It is all or nothing: if anything fails, nothing is saved.

**Step 4. Clean up.** `unset DATABASE_URL` (Way A) or delete `.env.developer.local` (Way B). Store the password in a password manager (section 10).

**Step 5. Check it.** Open `/staff/login?as=developer`, sign in, and see the purple strip. Then open the audit trail (section 6) and find the entry that says the account was created.

## 3. Signing in

The sign-in page (`/staff/login`) has two choices at the top: **Staff account** and **Developer account**.

- Staff accounts use the staff choice, as always.
- For the Developer, choose **Developer account**. The page then shows a purple note, "every action is recorded as a Developer action".
- The address **`/staff/login?as=developer`** opens the page with the Developer choice already picked. It is only a pre-selection: nobody is signed in by it. Any other `?as=` value gives the Staff choice.
- If the email or the password is wrong, or you picked the wrong door, the page keeps your choice and your email (never your password) and shows one message: "Incorrect email or password for this account type."
- The Developer door is guarded harder than the staff door: after a few wrong tries (5 for one email in 15 minutes) it makes you wait.
- A wrong try on a real Developer account is written in the audit trail (`auth.login_failed`), so you can see if someone has been guessing.
- Signing in ends any other session that browser had. One browser, one identity.
- **Switch to a staff account** (on the purple strip) signs the Developer out first, then opens the staff sign-in. Nothing carries over from the Developer session.

## 4. How long a Developer session lasts

The Developer account is more powerful, so its session is short:

- **4 hours at most** from signing in. After that you must sign in again, even if you are working.
- **30 minutes without use ends it.** If you do not use the system for 30 minutes, you are signed out.

Staff sessions are not changed.

## 5. Changing the password, switching the account off

All three jobs use the same command, in the same safe way as the setup (section 2, Steps 2 and 3). They ask you to type the database name first, like the setup does.

| Job | Command | What happens |
|---|---|---|
| **New password** (rotate) | `npm run developer:setup -- --rotate` | Asks for a new password (same strength rules). The old password stops working. **All open Developer sessions end.** It refuses the same password as the one now in use. |
| **Switch the account off** | `npm run developer:setup -- --deactivate` | The Developer cannot sign in. All open sessions end. |
| **Switch it on again** | `npm run developer:setup -- --rotate --reactivate` | A switched-off account needs a new password to come back, so both options go together. A new password alone does not switch it on. |

Every one of these writes an entry in the audit trail (`developer.password_rotated`, `developer.deactivated`), without any password in it.

If there is more than one Developer account, the command asks "Which Developer?" and you type the email.

**If you forget the password:** there is no "forgot password" email for the Developer. Run `--rotate` on your computer. Nobody else (not the Boss, the MD or a manager) can see or reset the Developer account from the Users page.

**Switch it off when you are not working on the system.** An account that is off cannot be attacked.

## 6. Where to read the audit trail

- **Audit trail page: `/staff/audit`.** It shows who did what and when. It is read-only: there is nothing to edit or delete.
- **The Developer console**, available to the Developer only, for system checks and diagnostics.

Who may read the audit trail: **the Boss, the MD and the Developer**. Nobody else. The Boss and the MD can see every Developer action, but they cannot use the Developer account's special right (`developer.access`) and cannot give it to anyone.

On the audit page you can tell Developer actions from staff actions (the **actor type** is shown on every line), and each line has the time, the person, the action, the record it touched, and what changed.

**Review it every week** (see section 10).

## 7. What the Developer cannot do: write money, or decide about it

The Developer can look at everything about money (the finance pages, the ledger, the reports) but **cannot write it and cannot decide about it**. The server refuses it, whatever the screen shows.

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

**Who does these instead.** Finance, the managers, the Boss and the MD, who answer for them, and each action carries their name. A Boss or an MD account holds all of these rights and does all of them. **To test a money flow, ask the Boss or the MD to create a test staff account.** The Developer cannot make one, and cannot use any account that holds money rights. What that test account does is recorded as that account's staff actions.

**What the Developer can do.** Look at every page and every record; reservations, check-in and check-out; rooms and housekeeping status; guests and customers; shifts and staff activity; requests, transport trips, the website and booking requests; restaurant orders and the kitchen; stock use; assets; the settings that are not about money; staff accounts that hold no money right (with a reason, see below); the audit trail and the Developer console.

Money stays intact in other ways too: the Developer's role is fixed by the system and is not editable from the Users page, and these limits are enforced on the server for every page and every action, not only by hiding buttons.

Other protections around the account:

- Nobody can create the Developer account, or give its role to someone, from the Users page. Only the setup command creates it.
- Nobody (the Boss and MD included) can give the Developer's special right to any role.
- When the Developer makes a sensitive change to staff accounts or roles, it must give a **reason** (at least 5 characters). The reason is written in the audit trail. The settings form does not ask for a reason yet; a settings change is still written with what it was before and what it is now, and the server keeps a reason with it as soon as the form carries one.
- When the Developer tries something it is not allowed to do, the refusal is written in the audit trail too (`developer.denied`), so a permission problem is visible. A refused settings change also writes `settings.update.refused`, which names the settings and the values it tried to put there.

## 8. What is recorded

Every entry in the audit trail has:

- **Actor type:** Developer, Staff, System or Website. It is taken from the signed-in account's role in the database at the moment of writing, so it cannot be faked by a page.
- **Name and role** of the person (a copy is kept on the line, so it stays correct even if the account is removed later).
- **Time**, shown in the hotel's time zone (East Africa time), and the **business day** it belongs to.
- **Action** (for example `reservation.created`) and the **record** it touched.
- **Before and after:** what the record said before and what it says now.
- **Reason**, for the sensitive changes that ask for one (staff accounts, roles).
- **Success or failure.** A **failed or refused attempt** is written too, for example a Developer trying something it may not do, or a refused change to a staff account.
- **Looking.** Looking is an action too. A Developer's **visit to a page** is written (`developer.viewed`) for every page except the sign-in page, the "no access" page and the person's own account page; the same page is written once in 10 minutes, so refreshing does not fill the trail, and one marker entry is written if a flood of pages passes the safety limit. A Developer's **inspection** in the Developer console (what can this person do?) is written. An **export or a download** (a CSV, a ledger, a stored file) is written **every time, before the data is sent**; if the entry cannot be written, nothing is sent.
- **Refused attempts**, as above (`developer.denied`, and `settings.update.refused` for a locked setting), with the right it needed and the page it came from.
- **Failed sign-ins** on a real account, the Developer account included.
- The **address (IP)** the request came from, where it is known.

**Never recorded: secrets.** Passwords, hashes, tokens, API keys, PINs and similar values are replaced by "[hidden]" before anything is written. Screens do not show them either.

## 9. The audit trail cannot be changed or deleted in the app

There is no screen and no button to edit or delete an audit entry, for anyone, the Developer, the MD and the Boss included. On top of that, **a database lock (a trigger) refuses every change and every delete** of an audit row. Only new entries can be added.

Be clear about the limits of this lock:

- **One narrow step in the app** changes an audit row: "cancel a check-in" relabels the two earlier check-in entries as "voided" (only the action word changes), and the cancellation itself is written as a new entry with the before-state. Nothing else in the app touches an old entry.
- **The "clean start" maintenance script** (used once before launch) opens the lock for its own run on purpose.
- **Someone who holds the database login can get round the lock.** The lock can be switched off by a setting inside a database session, and a person with owner-level access can remove the trigger itself. So **the database address and its login are the keys to the audit trail.** Keep them limited to as few people as possible, never put them in a chat or a repository, and change them if you think they were seen.

## 10. Security checklist

- [ ] A **strong, unique password**, made and kept in a **password manager**. Never typed from memory on a shared computer.
- [ ] **No sharing.** Nobody else uses the Developer account. Anyone else who needs access gets their own account with the right they need.
- [ ] **Never reuse a staff password**, or any other password, for the Developer account.
- [ ] A **separate email** that only you can read, kept safe with a strong password.
- [ ] **Review the audit trail every week**: look for sign-ins at odd times, failed sign-ins, `developer.denied` entries, and changes to staff accounts you do not remember.
- [ ] **Switch the account off** (`--deactivate`) when you are not working on the system. Switch it back on with `--rotate --reactivate`.
- [ ] **Rotate the password** (`--rotate`) every few months, and at once if you lose a device, or if someone else could have seen it.
- [ ] **Sign out** when you finish (the 4-hour and 30-minute limits are a safety net, not a plan).
- [ ] Keep the **database address and login** limited to you. Delete `.env.developer.local` after use.
- [ ] Work on a computer you trust, with a screen lock.
- [ ] To test something with money in it, **ask the Boss or the MD for a test staff account**; do not look for a way round the wall.

## 11. The risks that remain (read this)

The Developer account is built so that a mistake or a stolen password cannot write money or hide who did what. It is not a perfect wall. These are the honest limits:

- **The database login is the master key.** Whoever holds the database owner login can remove the audit-trail lock (section 9), and can change any record, money included, without the app. Keep that login limited to as few people as possible, and change it if you think it was seen.
- **No multi-factor authentication (MFA).** This system has none, for the Developer account or for any account. A Developer sign-in is protected by a strong password, the short session, the wait after wrong tries and the audit trail, but **if someone learns the password they can sign in**. Adding MFA (a code from an app or a security key, at least for the Developer, the Boss and the MD) is the **recommended next step**. Until then, the checklist in section 10 matters even more.
- **A Developer can still change what is not money.** With its reason where one is asked for, it can change the settings that are not about money, and the staff accounts and roles that hold no money right (switching a person off, changing a name or a phone number, giving a role a non-money right). All of it is written in the audit trail under its own name, with what it was before, so it can be seen and put back.
- **A Developer sees everything**, including guests' details and the money figures. Looking is recorded, but it cannot be undone: a Developer who has seen something has seen it.
- **The wall is code.** The rules in section 7 are in the program and in the database, and tests check them. Whoever changes the program could also remove a rule, and the Developer account itself cannot stop that. A second pair of eyes on every change to the program before it goes live, and the weekly review of the audit trail (section 10), are the real safety.
- **Money that arrives by itself is not the Developer's.** When a guest pays online, the system records it when nTZS confirms (this happens automatically, as the system, not as the Developer).

## 12. If the setup command stops

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
