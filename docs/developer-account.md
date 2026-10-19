# The Developer account

For the owner. Plain words, no code. Read this once before you create the account, and keep it for later.

## 1. What it is, and what it is not

The Developer account is **one separate sign-in for the developer** (you, when you work on the system). It has its own **console** to see how the system is doing, to read the permanent diary of everything that happens (the audit), to look at the hotel's data in plain tables (business), and to **work as any staff member** (access) when you need to help them or see what they see.

It is **not** a staff account with a bigger title. It is a different kind of account:

- It has its own email and its own password. It is never a copy of the Boss, the MD or any staff login.
- **Signing in is as simple as for anyone else: one email and one password.** There are no codes, no second step and no separate sign-in page for the Developer. The system looks at the account itself, on the server, and a Developer lands on the Developer console.
- **Every action is written in the audit trail as a Developer action**, under your real name. The system decides who you are from your signed-in account on the server. It never takes it from a page, a department or the browser.
- **It does not do the hotel's work** (owner, 2026-10-18). Checking a guest in, taking an order, starting a shift, answering a request, moving a room, using stock: that is Reception's, the kitchen's and the managers' work, and the Developer's own account does not hold those rights (migration `20261018150000_developer_via_work_as`; the list is `DEVELOPER_BY_WORK_AS` in `src/lib/permissions.ts`). It holds **28 rights**: looking at everything, the system's settings that are not about money, the audit trail, and its own right. Its job is to see what is wrong in the system and what to fix. To test or help it uses **Work as**, which hands it that person's own rights (minus money), is audited and is told to the Boss every time. The server fences stay in place as a second layer: the money-wall tests give the role those rights back for the length of the test and prove they still refuse what a Developer must never do.
- **It can never write money, and it can never decide about money** (section 8). It can look at money, but it cannot record, reverse, approve, pay or withdraw it, cannot decide what a guest, a group or a supplier owes, cannot change where guests pay, an account's opening balance or the money limits, and cannot send or hold back the financial reports. This stays true while you work as someone else.
- **It cannot be used to take over an existing account.** It cannot change existing accounts, passwords, login emails, roles or rights: only the Boss and the MD can (section 5). It can **add** an account from Access → Add an account (section 5), and it cannot see anyone's password afterwards.
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
5. **The password.** The easiest way: **just press Enter** at "New password" and a strong password is made for you. It is shown **once** on your screen (and put on your clipboard on a Mac) — paste it into your password manager straight away; it is not stored anywhere readable and cannot be shown again (if it is lost, set a new one with `--rotate`). Or type your own: **"New password (not shown)"** and **"Type it again (not shown)"**. Nothing appears while you type, not even stars. The password must be:
   - at least 14 characters (a few words with numbers and a symbol is easy to remember and hard to guess);
   - with a capital letter, a small letter, a number and a symbol;
   - not starting or ending with a space;
   - not your email, not the first part of your email, and not an easy word like "password", "admin", "qwerty" or "123456".

   If it is not strong enough, it tells you why (it never repeats the password) and asks again, up to 5 times.

A hosted database (such as Neon) closes a connection that sits idle for a few minutes. The command opens its connection again by itself, so taking your time over the questions is fine.

By default there can be only **one active Developer account**. A second one needs the extra option `--allow-second`; do not use it unless you really need it.

**What it prints when it is done:** `DONE — the Developer account was created`, then your name, your email, the role (Developer (super user)) and "Password: set". It never prints the password or its hash.

**What it writes:** one user with the Developer role, with the password stored only as a one-way hash, and one audit-trail entry (`developer.provisioned`: who = the setup script, with the email and name, never the password). It is all or nothing: if anything fails, nothing is saved.

**Step 4. Clean up.** `unset DATABASE_URL` (Way A) or delete `.env.developer.local` (Way B). Store the password in a password manager (section 11).

**Step 5. Check it.** Open `/staff/login` and sign in with the Developer's email and password, like anyone else. You land on the Developer console (Home). Open **Audit** and find the entry that says the account was set up.

## 3. Signing in, and how long a session lasts

- Open `/staff/login`, type the email and the password, press Sign in. That is all. A Developer lands on the console; every other person lands on their own dashboard, as always.
- If the email or the password is wrong, or the account is switched off, the page shows **one and the same message** whatever the reason. Nobody can learn from it which accounts exist.
- The Developer account is guarded harder than the staff accounts: after **5 wrong tries for one Developer email in 15 minutes** it is locked for the rest of that time (staff emails are held after 8 tries, and one address after 20). **Only wrong tries count.** A sign-in that works clears the count, so the right password never adds up toward the lock, and 4 wrong tries followed by the right password start again from zero.
- **The lock does not tell.** While the Developer account is locked, the sign-in page gives the very same answer as for any wrong try ("Incorrect email or password."), and takes the same time, even when the right password is typed. A stranger cannot learn from the page that an email belongs to the Developer. For the same reason every email, whoever it belongs to and even one nobody holds, does the same database write before its password is checked (the Developer's email keeps its counter, every other email a counter that is never enforced), so the work behind the answer is the same. (The audit trail does know: the try is marked as locked.) The "Too many attempts" message you may see comes from the limits that are the same for every email, so it tells nothing about an account.
- A wrong try on a real account is written in the audit trail (`auth.login_failed`, shown as the **System**, because nobody was signed in). The password that was typed is never written.
- **Failed sign-in lines are capped.** Anyone on the internet can fail a sign-in for a real email, and the audit trail can never be cleaned. So at most **10 failed tries per account per hour** are written one by one. After that, ONE line for that hour (`auth.login_failed_suppressed`, shown as "More failed sign-ins followed in a short time") says that more tries came, and the rest are not written. A flood is visible, and cheap. The limits that stop the guessing are not changed by this.
- Signing in ends any other session that browser had. One browser, one identity.
- The Developer account is more powerful, so its session is short:
  - **4 hours at most** from signing in. After that you must sign in again, even if you are working.
  - **30 minutes without use ends it.** "Use" means you opening a page or pressing something. Screens that refresh by themselves in the background (the alert bell) do not count as use, so an open tab cannot keep the session alive.
  - **No timer runs for the Developer.** Nothing watches the clock in the background: the two limits are checked when the next page or action arrives, and an old session simply does not work any more. The same is true of the end of Work as (section 5). The only thing that runs by itself is the daily clean-up that deletes expired sessions; it never renews a session or counts as use, and before it deletes a Developer's session that was still working as someone it writes the end of that Work as down (section 5).

  Staff sessions are not changed.

## 4. The console: Home, Audit, Business, Access

When a Developer signs in, the menu on the left says **Developer console** and has four places. Your name and **Sign out** are at the bottom. Everything about the hotel is reached through **Business** (look only) or **Work as** (act as a person); the console itself never changes hotel data.

- **Home.** The Developer's control room, copied from the owner's ORA and Target Express consoles ("copy this look exactly", 2026-10-18; the hotel's own gold takes the place of their pink and violet). One page, one part under the other, about 9,000 px. It shows **only the system**: no bookings, rooms, guests, orders, payments or messages to guests (the owner: "these are operations data"; a counts-only Hotel / Money / Messages & requests group was built after his Target console and taken out again the same day). The hotel's data is reached through Business (read-only tables) or Work as. From the top:
  1. **The top.** A gold greeting banner; four tiles with a gradient icon and one live line (Work as "16 people to pick from", Add an account, Audit "n actions today", Business); the **health card** — the score out of 100 in a ring with "Health score" under it, a coloured verdict ("Everything is healthy" when all is well) with three chips, and four small cards each with a small picture: the database (six bars, one for each quick question, and which kind of link), signed in today, actions today and server errors (a small line of the last 14 days each). The score rule is the hover text of the ring.
  2. **Needs your attention** — a small label with the verdict at the right ("All clear" / "n to fix now"), and ONE slim card (copied from the owner's other consoles, "small and nice, not too much detail"): either one line "Nothing needs your attention." or the problems as small rows (a coloured bar, an icon, a title, one muted line, a chevron — three show, the rest scroll under "scroll for n more", a tap opens what it means, what to do and who fixes it), then one thin row "What was checked · 29 of 31 fine, 2 not checked yet" that opens to every check (section 4b).
  3. **The Boss's reports** (the most important part to the owner, so it is right here): a panel "Daily report to {name}" and one "Room report to {name}" (the names the reports go to; a warning in amber when nobody is set to receive them), each with a strip of the last 7 closed days and "n of 7 sent", three days (the day, a pill — Sent, Not sent, Not made, Switched off — and the time it went and how long ago), the older days closed behind "Earlier days", and a last row for the weekly and monthly reports (daily panel) or the shift reports (room panel). Only what was sent, when, to how many — never a message's words or a phone number.
  4. **A row of pills** that jump to every part below.
  5. **Activity** — four cards (signed in today, actions in 14 days, sign-ins in 14 days, failed sign-ins in 24 hours); **Who did what, just now** (the team's latest actions in the audit trail's plain words, about six in view, the rest by scrolling; never an amount or a guest's name); sign-ins per day by role and actions per day (team and Developer); the busiest hours; where the work happens; **Recent sign-ins** (a table: person with initials, device, address, when); **Online right now** (the last 10 minutes); **Most active people** (7 days); **Not using the system** (never signed in, or not for 30 days).
  6. **People & my actions** — the accounts by role (a row each with its description, "n active" and the count), **Your recent actions** (the last six real actions — signing in, Work as, accounts — never the pages you only looked at; "See all" opens the Audit), two short notes (everything you do is on record; what you cannot do while working as someone) and "Who can do what" (can this person do this right: yes or no, which role gives it).
  7. **THE SYSTEM**: **Messages & reports** (how the sending went: WhatsApp deliveries in 24 hours, failed deliveries in 7 days, deliveries per day, and the failed or waiting deliveries with only the kind of trouble); **Errors & jobs** (four cards — server errors, automatic jobs, last error, last job run — then the unexpected server errors grouped with how often, when and where in the code, the automatic jobs in a table, and the messages from nTZS; each panel with one short quiet line when it has nothing); **Speed & size** (six named questions timed — simple ping, find one account, count today's activity, load the latest 50 activity lines, count sign-in sessions, load the newest 50 bookings — the biggest system tables, what is running — build, environment, Node, which kind of database link, how long a session lasts — and the **data checks** that must always be true); **Sign-ins & security** (failed and successful sign-ins in 14 days, the Developer sign-in lock, addresses locked out now; failed sign-ins and refused Developer actions per day; the latest failed tries; the failed tries by address with how many accounts each address tried; what was refused to you; your own sign-in); **Settings** (each setting the system runs on, by NAME with Set / Missing / Not set — never its value — and the database updates; how the hotel is set up, as numbers only; and one line about your own session with the rights you do not hold).
  Each part of the system carries one small chip saying how it is doing. An old `?tab=` link goes to its part; every part is read each time the page opens (a part that cannot be read says so and the rest still shows). Home only reads: it never changes hotel data.
- **Audit.** The permanent diary of the system (section 7).
- **Business.** The hotel's data in plain read-only tables (section 9).
- **Access.** Every staff account, grouped by role. Pick a person and press **Work as**, **Suspend** or **Sign out everywhere** (section 5). The Boss's account has Work as only: it cannot be suspended or signed out from here.

Every console page checks, on the server, that you are the Developer account. A staff member who types the address gets "no access". While you are **working as** someone, the console is closed: you see that person's own screens, and the console comes back when you press **Stop**. The two worlds are never mixed.

## 4b. Problems: the system checks (owner, 2026-10-18)

**The Developer does not do the hotel's work.** He never deals with shifts, orders, guests' bills, who owes what, requests, stock levels, approvals or cleaning: that is Reception, the managers, Finance, the kitchen and the Boss. He only works **as** someone to test something or to help. **His job is to make sure the system works and everything is OK.** So the console shows only problems of the **system**, and each one says what it means, what to fix, **who** fixes it (the Developer, or the system owner for keys and billing) and links to the page where it is fixed, when there is one this Developer may open.

The **System checks** part runs about thirty checks (31 now: one more finds the audit trail's database guard missing or switched off) every time the Home opens (all of them together are given 10 seconds at most; one still running then is "could not be checked"). It starts with one sentence ("We checked n things just now: a need fixing, b to look at, c are fine"), then **Needs fixing**, **Look at**, **All good** (closed; it lists what was checked and found fine) and **Could not be checked**. A check that does not apply here (reports switched off, not the live site) or that only follows from another problem is listed there too, with the reason, and is **not** counted as fine. One cause is shown once: while the scheduled jobs' secret is missing, or the nTZS key is, the checks that follow from it (late jobs, late reports, unreleased holds, stuck payments) are set aside instead of adding six more red cards. A check that cannot run (a part of the database did not answer, not enough history yet) is "could not be checked", never "all well", and one check failing never stops the others. Every "fix" or "look" is also a card under **Needs your attention** on Home, with its who and examples; an "all good" check never is.

What is checked:

- **Data that contradicts itself (a system bug, never someone's to-do):** a room marked occupied with nobody checked in, a checked-in guest in a room not marked occupied, two stays checked in to one room; a booking whose stored totals disagree with its charges and payments (stays that ended in the last 120 days); a restaurant order whose paid amount or paid status disagrees with its posted payments (last 60 days); a stock item whose quantity differs from the total of its posted movements; an unpaid booking still holding its room more than 12 hours after its hold time (the scheduled job's longest gap is 11 hours). A payment without a payment account cannot exist (the database requires one), so it is not checked.
- **Jobs and integrations:** an automatic job that is late or whose last run failed; nTZS messages failing (3 or more in 7 days with the last one failed is "fix") or not arriving at all for 7 days while online payments were completed (only once a whole week has been recorded); an online payment still waiting for nTZS after 14 hours (the sweep gives a prompt up after 2 hours and runs at least every 11); a withdrawal not finished at nTZS after 2 hours (4 days for a bank; nTZS's own approval and review are not counted: that wait is theirs); 3 or more WhatsApp messages failing in 24 hours (a wrong phone number is a person's mistake and is not counted; "fix" when none went out at all); the Boss's daily or room report not made or not sent after its due time. Calls to the nTZS webhook that are refused for a bad signature are shown apart (anyone on the internet can send one) and are never counted as nTZS failing.
- **Errors:** unexpected server errors seen in the last 24 hours, grouped: "fix" when the same error has happened 3 times or more (it is still there), "look" for an error that came once or twice. A failure inside an automatic job or the nTZS webhook is said once, by the job and nTZS checks, not again here.
- **Set-up:** the scheduled jobs' secret, the site's address (live site only; missing is a "look": links made by scheduled jobs would carry the hosting's own address), report recipients, WhatsApp keys, the nTZS key and webhook secret, a payment account, database updates that did not finish or were not applied, an active Boss account, a role that has people but no rights. A database update that was undone and applied again (what the build's healing step leaves) is not a problem; one with no good copy is.
- **Security:** more than 20 failed sign-ins in 24 hours; 10 or more refusals to the Developer in 24 hours (a few are by design). Fewer are plain information.

What is **not** a check, on purpose: a shift open for long, an order waiting, a guest who left owing, a request nobody answered, an expense waiting for approval, stock below its minimum or below zero (the food was made; the count shows it), a dirty room, an account that never signed in, an overdue check-out. They are not system checks and are never a card under Needs your attention. Whether the money is right belongs to the Finance team and the reports.

**The health score** keeps its simple rule: 100, minus 60 when the database does not answer, minus 10 for each "fix", minus 5 for each "look", nothing for information (and nothing for a check that could not be run), never below 0. It counts the checks and the set-up facts the same way. **What the system records about itself** (server errors, the runs of the automatic jobs, the receipts of webhooks) is kept in its own table, scrubbed before it is written (emails, numbers, keys, links' addresses, quoted values and request contents are taken out; the address of the page asked for is not stored at all; a name written bare inside a message cannot be recognised, so a message is never promised to be free of one); errors are kept 30 days and job and webhook records 14. The Problems and Errors & jobs parts only read it; they change nothing, and only the Developer account sees them.

**How the system records itself (table `system_events`, added by the migration `20261018120000_system_events`; code in `src/server/services/system-events.ts`).** Four places write to it: `src/instrumentation.ts` (every unexpected error in a page, a route, a server action or the proxy; Node.js runtime only), `runAction` in `src/server/errors.ts` (an action's unexpected error; the answer to the person is exactly what it was before), the two cron routes (one row per run, with duration and a small summary; a step that fails inside the daily run marks the run FAILED) and the nTZS webhook route (one row per call: accepted, refused, bad JSON or failed; refused signatures are their own status, folded into one row per 10 minutes and written at most every 15 seconds per server, because anyone can send one). Recording is best-effort and can never hurt a request: it never throws, waits at most one second (2.5 s for a job), stays quiet for 30 seconds after a failed write, takes at most 30 new kinds of error a minute, never holds more than 5,000 different errors, and a failed write is never itself recorded. A repeat raises one row only. A server action's file is named only from a project file (on the hosting the stack shows compiled chunk files, whose names change with every release; the page then says the lines are in the built code). Expected things are skipped (a message for the person, a redirect, a not-found page, a cancelled request, and a form that a visitor opened before a new version went live and sent after it — "Failed to find Server Action", which happens once after a deploy and a refresh fixes it; rows of this kind that an earlier version already wrote are left out when the console reads the errors, and nothing is deleted). The daily job's housekeeping deletes old rows in batches, last, after the reports. **Known limit:** a run that the hosting kills at its 60-second limit leaves no record (a record is written when a run ends); a later good run then hides it, so a job that keeps timing out shows only as a slow "Took". **Order of deploy:** apply the migration (`db:deploy`) with or before the deploy; if the code runs first, nothing breaks, the writes are dropped and the Problems tab says "could not be checked" for the log-based checks until the table exists. The first deploy should be followed by one forced error to confirm a row appears (the instrumentation hook could not be tried without a Next build).

## 5. Access: Work as, Suspend, Sign out everywhere

The Access page lists the accounts (every account except Developer accounts and the system's own online-payment account), grouped by role, the Boss first. Each person shows their name, whether they are active, their role, their email and when they last signed in.

**Work as.** Opens that person's real dashboard, with their real data, **without their password**.

- You hold **that person's rights, minus everything about money** (the same list the Developer never holds, section 8). So you can do their ordinary work (look at a booking, check a guest in, move a room, take a restaurant order, mark a room clean) but a payment, a discount, an expense, a withdrawal, a purchase payment, an invoice or a cash handover is **refused by the system**, as it would be for the Developer. The decisions that belong to the Boss, the MD and the managers stay refused too.
- A **bar at the top** of every page says who you are working as. Press **Stop** to come back to the console.
- It ends **by itself after 4 hours**, and also when your Developer session ends (4 hours at most, 30 minutes without use), or when that person's account is switched off or removed.
- **When it ends by itself, the audit trail says so.** Nothing runs on a timer, so the first page or action that comes afterwards finds it over and writes ONE line, `developer.work_as_expired`: who it was, how long, and why it ended (the 4 hours, the account, or your session). If no page or action ever comes, the line is written when the session is removed: by the daily clean-up of expired sessions, by a new sign-in in the same browser, or by a password change or "sign out my other devices" on another of your sessions. Each of those writes the line just before it deletes the session (reason: your session ended), once per Work as, as you. Pressing Stop writes `developer.work_as_ended` as before. So a start never stays without an end. A new Work as can be started at once after one that ran out. This line is information, not a failure.
- You cannot work as a Developer account, a switched-off account or the system account, and you cannot start a second one while you work as someone (press Stop first).
- **The Boss is told, on WhatsApp, every time you start**, in the Boss's language: your name (Developer), who you are working as, their role and the time. The message is sent in the background like the reports: if WhatsApp is not set up or fails, Work as still starts and the audit trail still has the entry (see the honest limits, section 12).
- **How the telling went is written down too** (`developer.work_as_notice`): how many people were meant to be told, how many were, how many were not. If nobody was told, or someone could not be, the line shows as **Failed** in the Audit, so you can ask the Boss to look.
- **A shift belongs to a real person**: a reception shift holds one of the desk's two places, its closing counts the cash that person collected, and it sends the report to the Boss. So **Work as can never start, end, take over or close a shift**, and the Developer account has no shift of its own. While you work as someone you cannot change the shift plan (who works which day) either. The receptionist's rule "an open shift is needed to work" is skipped for you, so you can see their screens without a shift. Staff and managers are not changed.

**Suspend.** Blocks the account and signs the person out until it is switched back on.

- You must write a **reason** (at least 5 characters) and type **CONFIRM**. The reason is written in the audit trail.
- It cannot be used on the **Boss's account** (its row says "Can't be suspended or signed out here"), on Developer accounts, on the system account or on your own account, and not while you work as someone.
- **You can only switch back on an account you suspended yourself**, and never an account whose role holds a right the Developer is denied: the rights about money, and the right to manage accounts (the Boss, the MD, the managers, Finance, the Accountant, Reception and the Restaurant Counter). For those, ask the Boss or the MD to switch it back on. A cook, a waiter or a driver, whose roles hold none of those rights, you can switch back on yourself. This is on purpose: it means suspending cannot be used to lock out the people who run the money, and switching back on cannot be used to change anything about an account.
- **The Boss is told on WhatsApp every time you suspend an account**, in the Boss's language, like the message for Work as: your name (Developer), who was suspended and their role, the time and your reason, and where to switch the account back on (Staff & roles). It is sent in the background and never blocks the suspension. How the telling went is written down (`developer.access_notice`: how many were meant to be told, how many were), and a notice that reached nobody shows as **Failed** in the Audit.

**Sign out everywhere.** Ends every open session of that person, on every phone and computer. They can sign straight back in (useful when a phone is lost). It cannot be used on yourself, on the **Boss's account** (the button is not shown, and the server refuses it too), on Developer accounts or on the system account, and not while you work as someone. **The Boss is told on WhatsApp every time**, the same way as for a suspension (who, whom, when; `developer.access_notice` records how it went).

**The risk, and the Boss's remedy (read this).** Suspending and signing out are real power. They are kept on purpose, because a lost or stolen staff account must be stoppable at once. But it means that **someone who stole the Developer's password could suspend the MD, Finance, the managers and Reception in a few clicks** (the Boss's own account cannot be suspended or signed out from here, so the Boss can always act). What limits the harm:

- the Boss gets a WhatsApp message for every suspension and every sign-out, so a burst of them is seen within minutes;
- every one is in the audit trail with its reason (`user.suspended`, `user.signed_out_everywhere`), and a notice that did not reach the Boss shows as Failed;
- the Developer cannot switch back on an account it did not suspend, or any account whose role holds a right it is denied (money, accounts), so it cannot undo what the Boss or the MD did;
- **the remedy:** the Boss or the MD opens **Staff & roles** (the Users page), opens the person and ticks **Account active**: the account is back at once, with its old rights. If the Developer's password may have been stolen, the owner switches the Developer account off (`npm run developer:setup -- --deactivate`) or changes its password (`--rotate`) from the computer that holds the database address (section 6).

**Add an account (owner, 2026-10-18).** The Developer is the owner of the code and sets the hotel up, so it can **add** an account for anyone, in any role except the Developer's and the system's (the Admin's and the Boss's too): press **Add an account** at the top right of this page, give the name, email, phone (optional) and the role, and press **Create account**. A temporary password is made for you (you can show it, or make another); after it is created you see the email and the password once, with a **Copy** button — give them to the person, who signs in right away; nothing forces a change of password, they change it from their account page whenever they wish. The creation is written in the audit trail under the Developer's name (never with the password), and **the Boss is told on WhatsApp every time**. It does not work while you work as someone.

**An honest risk.** Whoever creates an account knows its first password until the person changes it, and that account is not a Developer, so the Developer's limits do not apply to it. That is why the Boss is told each time and why Audit shows who made every account. Because the password is not forced to change, it is worth asking each person to change the temporary password themselves (account page) soon after they start.

**The Developer cannot change existing accounts, passwords, login emails, roles or rights.** Not on its own account and not while working as someone. Only the **Boss and the MD** can, from **Staff & roles** (the Users page). What the Developer keeps for accounts is this page: **Add an account**, **Work as**, **Suspend** (with a reason and the word CONFIRM), **Sign out everywhere**, and **re-activating an account it suspended itself** (above). Every attempt to let the Developer edit or re-role existing accounts could be walked around (empty a role and then make an account in it; a password that outlives a role that is later widened; one Developer changing another), so there is no such version. In practice:

- the Developer role does not hold the right to manage accounts (`users.manage`), so the Users page sends it to "no access" and every Users action is refused before it starts;
- the account service (the Users page's one) refuses a Developer a second time, whatever it holds: creating an account there, changing a name, phone, login email, role or on/off switch, resetting or removing an account, and giving or taking a right. It says one thing, "The Developer account cannot create or change accounts, passwords, roles or rights. Ask the Boss or the MD.", before it reads or writes anything, and the refused try is written in the audit trail (`user.create_failed`, `user.update_failed`, `user.password_reset_failed`, `user.delete_failed`, `user.permission_change_failed`). Adding an account goes through its own door on this page and nowhere else;
- the same holds while you work as the Boss or the MD: you hold their rights minus everything about money and minus the right to manage accounts.

**Safety rules while working as someone.** The system refuses all of these, on the server, whatever the screen shows:

- creating an account;
- changing any password or any login email;
- changing a role or a right;
- suspending or switching back on an account;
- signing people out everywhere;
- changing the person's own preferences (their language, their alert sound);
- starting, ending, taking over or closing a shift, or changing the shift plan;
- and, underneath all of that, **any write at all to the accounts, the sessions, the roles or the rights** in the database (a "fence" in the database layer, so a page that was forgotten still cannot do it).

So Work as can never be used to take over an account.

## 5a. WORK AS = FULL ACCESS (owner, 2026-10-19) — this replaces the "money wall while working as someone" described in §5 and §8

When the Developer works as a person he has **exactly that person's own rights and can change, add or modify anything that person can — money, the menu and prices, discounts and approvals, accounts, passwords, roles and rights, shifts**. Nothing is held back while he works as them (owner: "when I work as someone it should be full access, because I am working as that person").
- **What did not change:** the audit trail. Every action is still written under the Developer's own name with who he acted as ("Nino (Developer) as Neema (Receptionist)"); the Boss is still told on WhatsApp when a Work as starts; Work as still ends after 4 hours or on Stop; a Developer, the system account and an inactive account still cannot be worked as; the Developer's OWN account (in his console, not working as anyone) still decides nothing and records no money.
- **Code:** `permissionsWhileWorkingAs` (src/server/auth.ts) hands over the person's full rights (only Developer-only rights are withheld); `canDecide` / `authorizeDecision` allow a Developer who works as someone; `actsAsDeveloper` (src/server/developer-wall.ts) is true only for the Developer's own session, so the service-level walls and the shift wall do nothing while working as; `isDev` in staff-accounts.ts and the write fence in db.ts no longer stop account, role, right and password changes; `assertNotWorkAs` stays only on the Developer's own console powers (Add / suspend / delete / sign out from the Access page).
- **Know this:** a payment or any record made while working as Neema is stored with Neema as its author (her shift and cash totals include it) while the Audit says the Developer did it. Online payments are still never credited to the person a Developer works as (reservations.ts check-in / cancel). The "Done by Developer" tags (§7b) do not yet cover money lines.

## 5b. Delete an account, and the permanent owners (owner, 2026-10-19)

- **Delete** (a button next to Suspend on the Access page; a plain confirm pop-up, nothing to type — owner, 2026-10-19) works on **any account** — the Boss's and the MD's too — except the permanent owners, another Developer, yourself and the last active Boss. The Boss is told on WhatsApp, and the deletion is in the Audit under the Developer (without a reason).
- **Delete never deletes data.** The person is signed out everywhere, can never sign in again (password made unusable, e-mail address freed so it can be used again) and the account leaves every list (`users.removedAt`; `src/server/services/account-removal.ts`) — but the account row stays, so every booking, payment, shift, order and audit entry keeps their name and "who did what". The same applies to the Boss's/MD's Delete in Staff & roles (it no longer fails when the person has records).
- **Permanent owners** (`src/lib/permanent-owners.ts`): every Developer account, and the e-mail addresses listed in the hosting setting **`PERMANENT_OWNER_EMAILS`** (comma-separated; never written in the code, which is public). They can never be suspended, switched off or deleted — not by the Developer, the MD or the Boss (the Access page shows "Permanent owner: can't be suspended or deleted"; the server refuses it again). Set the setting in the hosting provider's environment variables and redeploy; without it only the Developer accounts are permanent.
- **The last active Boss** can be neither suspended nor deleted — the top authority must be kept. Another active Boss keeps it, and so does an active **permanent owner with the MD's role** (the owner's case, 2026-10-19: `bashleyair@gmail.com` is an MD and stands in, so the old Boss account `bashley@vegashoteltz.com` can be deleted; the reports go to the numbers in the hotel's settings, not to the Boss account). Only a Boss can grant the Boss role, so an MD stays an MD.
- The Developer still cannot edit, re-role or reset the password of an existing account.

## 5c. Customers on the Access page (owner, 2026-10-19)

The Access page's **one search box** (name, phone number, e-mail or role) also looks for customers: type part of a name or of a phone number (`07` finds every number that begins 07; `0712 345`, `+255…` work too) or the customer's reference — at least 2 characters. The accounts that match are listed as before and the customers under them as a **Customers · n** group (nothing is listed while the box is empty — there are too many; at most 20 shown, with a hint to type more). Each customer found can be:
- **Suspended** — they can no longer book or order through the **public** pages (the website booking, the Hotel QR booking page and the online menu order): the page answers "We can't take this online. Please contact the hotel." The hotel's own staff, at the desk, still find and serve them. `Guest.suspendedAt`; checked in `resolveGuest` (public pages) and `online-orders.ts`; the restaurant's table QR orders are not covered. **Re-activate** switches it back on.
- **Deleted** — with the desk's own rule (`removeCustomer`): nothing on record → gone; stays, orders or payments on record → those stay in the books and the personal details are wiped.
Each is a plain confirm pop-up (nothing to type), Developer only, never while working as someone, and written to the Audit under the Developer (`guest.suspended`, `guest.reactivated`, `guest.deleted` / `guest.removed`).

## 6. Changing the password, switching the account off

All three jobs use the same command, in the same safe way as the setup (section 2, Steps 2 and 3). They ask you to type the database name first, like the setup does.

| Job | Command | What happens |
|---|---|---|
| **New password** (rotate) | `npm run developer:setup -- --rotate` | Asks for a new password (same strength rules). The old password stops working. **All open Developer sessions end.** It refuses the same password as the one now in use. |
| **Switch the account off** | `npm run developer:setup -- --deactivate` | The Developer cannot sign in. All open sessions end. |
| **Switch it on again** | `npm run developer:setup -- --rotate --reactivate` | A switched-off account needs a new password to come back, so both options go together. A new password alone does not switch it on. |

Every one of these writes an entry in the audit trail (`developer.password_rotated`, `developer.deactivated`), without any password in it.

If there is more than one Developer account, the command asks "Which Developer?" and you type the email.

You can also change your own password from your account page (not while you work as someone). The same strength rule applies there: 14 characters or more, a capital, a small letter, a number, a symbol, and not your email. The page shows this rule under the field (staff see the ordinary staff rule).

**If you forget the password:** there is no "forgot password" email for the Developer. Run `--rotate` on your computer. Nobody else (not the Boss, the MD or a manager) can see or reset the Developer account from the Users page, and you cannot see or reset anyone else's password from anywhere (not from the console and not through Work as).

**Switch it off when you are not working on the system.** An account that is off cannot be attacked.

## 7. Audit: the permanent diary

The Developer's Audit page is **`/staff/developer/audit`**. (The Boss and the MD have their own Audit trail page, `/staff/audit`; it is unchanged.) Both read the same diary.

- Each line is one thing that happened: **a coloured dot, one plain sentence** ("Neema checked a guest in."), then **who · date · code**, and badges on the right: **Developer** (when it was you), **Succeeded** or **Failed**, and the **module** (the kind of record).
- **Dot colours:** gold = done by you (the Developer), including when you worked as someone; blue = normal staff work; grey = the system or the website; red = it failed.
- **Work as is shown for what it is.** An entry written while you worked as Neema reads **"Nino (Developer) as Neema (Receptionist)"**, not just "Neema". The page also keeps who you were acting as, so the Boss can always see that it was you. The lines about Work as itself name the person: "Developer started working as Asha (Receptionist).", "Developer stopped working as Asha (Receptionist).". When a line does not say who (an old one, or a refused try, which keeps only the account's number), it says "another person".
- A failed sign-in is shown as the **System**, because nobody was signed in. So is the one line that says more failed sign-ins followed than are listed.
- **Filters:** *Everything*, *Developer actions*, *Failures* (a failed attempt, a refusal, an entry that says it did not work, or a Boss notice that nobody received). A Work as that ended by itself (`developer.work_as_expired`) is information, not a failure. A **search box** looks in who did it, what it was (the action's name or its plain words) and where (the kind of record or its number). A **date range** picks the days (the last 7 days to begin with, at most one year at a time).
- **50 entries a page**, newest first, up to 200 pages for one search (narrow the dates to go further back). Times are in the hotel's time zone.
- Open a line to see its exact time, the business day, the record, the address (IP), the reason given, what went wrong, and the **before and after** values. Anything that looks like a secret is hidden ("[hidden]") when it is shown.

**Nothing here can be edited or deleted.** The database refuses it. The only change the system ever makes to an older line is marking a cancelled check-in as cancelled (section 12 has the exact truth, including who could get round the lock).

Who may read the audit trail: **the Boss, the MD and the Developer**. Nobody else. The Boss and the MD can see every Developer action, but they cannot use the Developer account's special right (`developer.access`) and cannot give it to anyone.

**Review it every week** (see section 11).

## 7b. "Done by Developer" on the record screens (owner, 2026-10-18)

When the Developer works as someone, every screen that says who did a record also says the Developer did it: a small tag, "Done by Developer · as Neema", sits **beside** the stored name (never inside it), the same for every reader. Audit-derived lines (the Boss's Audit and Activity pages, the booking/group/guest/Finance/Hotel QR histories) print the whole label, "Nino (Developer) as Neema (Receptionist)", and are no longer cut at the bracket.

- **No schema change.** The audit row is the mark: it is written with `actorType DEVELOPER` and `after.actingAs`. Stored author ids on the records stay the staff member's (the flows that depend on them are untouched).
- Code: `src/lib/audit-who.ts` (whole label), `src/lib/audit-line-who.ts` (line helper), `src/lib/done-by-text.ts` (the tag text, already in the reader's language), `src/server/services/developer-marks.ts` (batched lookup by entity; a step is matched by action, time and person), `src/server/services/order-done-by.ts`, `guest-message-marks.ts`, and the component `src/components/staff/done-by-developer.tsx`. A failed lookup shows no tag and no error.
- **Never marked:** money records (payments, reversals, charge authors, shifts, accounts, withdrawals) — the Developer cannot do them anyway. Own-work readers keyed on the user id (staff performance, shifts, shift and staff reports) are not touched.
- New audit row `restaurant_order.item_prepared` (first tick that moves an item to preparing only), so a Developer working as a cook is visible.
- Known limits: the time match is a few seconds wide (5 s on orders, 10 s on stays); "Given to" and "Looked after by" lines name who a request was given to, not who acted, so they carry no tag (the history lines do).

## 8. What the Developer cannot do: write money, or decide about it

The Developer can look at everything about money (the finance pages, the ledger, the reports) but **cannot write it and cannot decide about it**. The server refuses it, whatever the screen shows. **This is the same while you work as someone else:** the person's rights are given to you with every one of these taken out.

This is a fixed, written-out list, not "everything except a few things". The Developer role holds only the rights that were chosen for it one by one (four lists in `src/lib/permissions.ts`: allowed, reached only by Work as, denied, and the Developer-only right; every right is in exactly one). A new right added to the system in future is **not** given to the Developer until a person decides that it should be (a test fails until that is decided). In plain words, the Developer cannot:

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
- set where a payment account's books begin (its **opening balance**), or add or change a payment account (its name, kind, account number and holder, and whether it takes payments or expenses). This is refused in the screen and again in the service, whichever way it is reached.

**Decide what a guest, a company or a supplier owes**

- give a discount or free nights, let a guest leave with a balance owing, bill another guest's room, or put a late-checkout fee, a transport price or a room-service order on a bill;
- confirm or hold a booking without payment;
- cancel a booking or mark a no-show (that decides whether the payment is kept or a refund is due);
- change room prices, seasons or promotions, or the selling prices of the restaurant menu (so the whole menu set-up is for the Boss and the MD);
- set a company's credit limit or payment terms (also when adding a new company, which carries its terms), or approve a booking above a company's credit;
- make a booking that a company pays for (it is confirmed unpaid, on the company's terms), or check out a stay that a company pays for (that issues the company's invoice);
- get supplier quotations, issue purchase orders, record deliveries or attach supplier invoices;
- record stock received (the price paid becomes the item's cost), approve waste, count stock or correct quantities, set up inventory items and their costs;
- set the budgets and the gifts of the Spin to Win game;
- add or change an expense type (it sets the payee and the amount that new expenses start from);
- set a **group's** prices and who pays: a discount on a room, a room the group (or its company) pays for, a company as the payer, payment terms, going over a company's credit, who pays, and a group's invoices, payments, final bill or cancellation. (A group whose rooms all pay their own bill, with no company and no terms, is only a set of held bookings and is allowed.)
- move a guest to a **dearer room because of a problem in the hotel's own room**: the hotel then gives the difference away as "hotel compensation", which is a decision about what the guest pays. A hotel move to a room of the same price or a cheaper one, and every move a guest asks for (the system prices it), are not decisions. This is refused for a guest who has not arrived yet and for a guest in the hotel;
- send **food and drinks with a booking** (a pre-order, or an order charged to the room): from the booking form, from a website request being confirmed, or from the rooms of a group that pay their own bill. They land on the guest's bill at the menu's prices. One check in the booking service covers all three doors;
- change a **hotel service's price**, whether it is chargeable, or its price note (in English or in Chinese) on the website: they are the prices guests are shown. Its name, description and icon stay open to you;
- cancel a check-in so that a payment's **credit** moves from the person who checked the guest in: when you cancel a check-in the credit stays where it was (the person's own cancel moves it, as before).

**Change where guests pay, or a limit**

- change the bank account, the mobile-money (Lipa) number or the "pay into" words and terms printed on invoices;
- change the approval limits: what an expense may be approved for, what Finance may authorize alone, and whether the buyer of a purchase may also approve it;
- change the fees (late checkout, room service, airport transfer), the tax, or the policies for early departure, no-shows and date changes;
- change how many days an invoice may stay unpaid, how long an unpaid booking holds its room, when a guest becomes a no-show and whether the room is then released at once, or the hour the business day starts (it decides which day every payment and report counts in);
- switch **Pay at the hotel** on or off on the Hotel QR (it lets a guest hold a room without paying), or switch on or off whether restaurant payments wait for a person to confirm them (the restaurant's sounds can still be changed);
- change the list of payment methods, or switch online payment on or off.

The server checks this when the settings are saved: if a Developer's save would change any of these, **the whole save is refused and nothing is written** (a save that leaves them as they are works). Every other setting (the hotel's name, times, contact details, languages, wifi, texts and links) the Developer can still change.

**Send or hold back the financial reports**

- make, regenerate or resend the daily reports to the Boss, and make or resend the weekly and monthly reports and a shift report (they count what a shift collected and may be sent to the Boss);
- change who receives the reports, or switch them off.

**Make or take over an account that can do any of the above**

An account you add knows a password you handed over until the person changes it, and that account is **not** a Developer, so none of the Developer's limits apply to it. That is the honest risk of "Add an account" (section 5): the answer is that the Boss is told on WhatsApp every time, Audit shows who made each account, and the person must be asked to change the password at once. Changing existing accounts, passwords, login emails, roles or rights stays with the Boss and the MD, from Staff & roles.

**Who does these instead.** Finance, the managers, the Boss and the MD, who answer for them, and each action carries their name. To test a money flow, add a test staff account (Access → Add an account) and sign in as it — the money you record then carries that test account's name, and the Boss is told you made it.

**What the Developer can do.** Look at every page and every record in Business; work as any staff member for everything except money and account takeover (reservations, check-in and check-out, rooms and housekeeping, guests and customers, requests, transport trips, restaurant orders and the kitchen, stock use, assets); change the settings that are not about money; suspend, sign out, re-activate its own suspensions and work as people (section 5); read the audit trail.

Money stays intact in other ways too: the Developer's role is fixed by the system and is not editable from the Users page, and these limits are enforced on the server for every page and every action, not only by hiding buttons.

Other protections around the account:

- Nobody can create the Developer account, or give its role to someone, from the Users page. Only the setup command creates it.
- Nobody (the Boss and MD included) can give the Developer's special right to any role.
- **The Developer's email is not singled out.** If anyone (on the Users page, or changing their own email on their account page) types the Developer's email, the answer is the same ordinary words as for any other address that is taken ("A staff account with this email already exists." on the Users page, "Another staff account already uses this email." on the account page). A different answer for the Developer's address would itself tell who the Developer is.
- The **Users page is closed to the Developer** (section 5). Switching an account off is done from **Access**, with a reason and the word CONFIRM; switching back on follows the rule in section 5.
- When the Developer suspends someone or switches an account back on, it must give a **reason** (at least 5 characters). The reason is written in the audit trail.
- When the Developer tries something it is not allowed to do, the refusal is written in the audit trail too (`developer.denied`), so a permission problem is visible. A refused attempt to work as someone is written as `developer.work_as_refused`.
- When a **staff member** reaches for the Developer's pages or actions, the refusal is written under THEIR name (`developer.endpoint_refused`, with the page), at most once in 10 minutes for the same person, so a loop of refused tries cannot fill the trail. This holds for the Developer's pages (opened by address) as well as for its actions.

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
- **The Home part that shows message data is covered like a Business tab.** Opening **Messages & reports** on the Home writes `developer.business_viewed` (once in ten minutes, after = `{ tab, area: "home" }`, shown as `home:messages`), kept apart from Business' own tabs; it shows a masked phone, never a message's words. The other parts (Activity, People & my actions, System checks, Errors & jobs, Speed & size, Sign-ins & security, Settings) are about the system and its users and leave only the normal visit to the page. The note never blocks the part: if it cannot be written the part still shows. It is not work and never counts as an action.

## 10. What is recorded

Every entry in the audit trail has:

- **Actor type:** Developer, Staff, System or Website. It is taken from the signed-in account's role in the database at the moment of writing, so it cannot be faked by a page.
- **Name and role** of the person (a copy is kept on the line, so it stays correct even if the account is removed later).
- **Time**, shown in the hotel's time zone (East Africa time), and the **business day** it belongs to.
- **Action** (for example `reservation.created`) and the **record** it touched.
- **Before and after:** what the record said before and what it says now.
- **Reason**, for the changes that ask for one (suspending and switching back on).
- **Success or failure.** A **failed or refused attempt** is written too.
- **Looking.** Looking is an action too. A Developer's **visit to a page** is written (`developer.viewed`) for every page except the sign-in page and the "no access" page. The account page is written too, because while you work as someone it shows THAT person's profile, phone, email and devices. The same page is written once in 10 minutes, so refreshing does not fill the trail. If one person opens more than 1,000 pages in 10 minutes, ONE line (`developer.viewed_limit`) says so, and the visits that follow are still written, in a short form: a flood never hides a real visit. A look at a tab of Business is written (`developer.business_viewed`). A look at what a person can do is written. An **export or a download** (a CSV, a ledger, a stored file) is written **every time, before the data is sent**; if the entry cannot be written, nothing is sent.
- **Working as someone.**
  - `developer.work_as_started` when you start (who you work as, their role), `developer.work_as_ended` when you press Stop (with how long it lasted), `developer.work_as_expired` when it ended by itself (who, how long, and why: the 4 hours, the account, or your session; also written when the session is removed with no request, section 5), `developer.work_as_notice` for how the message to the Boss went (recipients, told, not told), `developer.work_as_refused` when an attempt was refused (with why).
  - **Everything you do while working as someone is written under your own name**, as "Nino (Developer) as Neema (Receptionist)", never under Neema's name. The hotel's own records (for example who checked a guest in) still carry Neema's name, because that is how the hotel's books work. **The audit trail is where the truth is: it says it was you.**
  - Entries written by other people at the same moment are never touched.
- **A refused try to change accounts:** when the Developer tries to create or change an account, a password, a login email, a role or a right (it is always refused, section 5), the try is written as `user.create_failed`, `user.update_failed`, `user.password_reset_failed`, `user.delete_failed` or `user.permission_change_failed`, with the one message. If it came through the Users page it is written as `developer.denied`.
- **Suspending, switching back on, signing out everywhere:** `user.suspended` (with the reason), `user.reactivated` (with the reason), `user.signed_out_everywhere`, under your name; and `developer.access_notice` for how the message to the Boss about a suspension or a sign-out went (recipients, told, not told).
- **Failed sign-ins** on a real account: at most 10 an hour for one account are written one by one; past that, one line (`auth.login_failed_suppressed`) says that more followed (section 3). A try refused by the Developer's lock is written as a failed sign-in marked "locked".
- The **address (IP)** the request came from, where it is known.

**Never recorded: secrets.** Passwords, hashes, tokens, API keys, PINs and similar values are replaced by "[hidden]" before anything is written. Screens do not show them either.

## 11. Security checklist

- [ ] A **strong, unique password**, made and kept in a **password manager**. Never typed from memory on a shared computer.
- [ ] **No sharing.** Nobody else uses the Developer account. Anyone else who needs access gets their own account with the right they need.
- [ ] **Never reuse a staff password**, or any other password, for the Developer account.
- [ ] A **separate email** that only you can read, kept safe with a strong password.
- [ ] **Review the Audit every week**: look for sign-ins at odd times, failed sign-ins and `auth.login_failed_suppressed` lines (a flood of tries), `developer.denied`, `developer.work_as_refused` and `developer.endpoint_refused` entries, every `developer.work_as_started` (do you remember each one? did the Boss get the `developer.work_as_notice`?), every `user.suspended` and `user.signed_out_everywhere` (did the Boss get the `developer.access_notice`?), any `developer.work_as_expired` (a Work as you forgot to stop), any `user.*_failed` line under the Developer's name (someone tried to change an account or a right: it was refused), and changes to staff accounts you do not remember.
- [ ] **Press Stop** when you finish working as someone, and **Sign out** when you finish (the 4-hour and 30-minute limits are a safety net, not a plan).
- [ ] **Switch the account off** (`--deactivate`) when you are not working on the system. Switch it back on with `--rotate --reactivate`.
- [ ] **Rotate the password** (`--rotate`) every few months, and at once if you lose a device, or if someone else could have seen it.
- [ ] Keep the **database address and login** limited to you. Delete `.env.developer.local` after use.
- [ ] Work on a computer you trust, with a screen lock.
- [ ] To test something with money in it, **ask the Boss or the MD for a test staff account**; do not look for a way round the wall.

## 12. The audit trail is locked, and the risks that remain (read this)

**No edit and no delete in the app.** There is no screen and no button to edit or delete an audit entry, for anyone, the Developer, the MD and the Boss included. On top of that, **a database lock (a trigger) refuses every change and every delete** of an audit row. Only new entries can be added. This is the sentence the Developer pages use: *the database refuses it; the only change the system ever makes to an older line is marking a cancelled check-in as cancelled.* That sentence is about the app. The exact truth, with every exception, is this:

- **One narrow step in the app changes an audit row.** "Cancel a check-in" relabels the earlier check-in lines of that booking as cancelled (a check-in becomes "checked a guest in — cancelled later"; a walk-in becomes a plain "made a booking"). Only the action word changes; the cancellation itself is written as a new line with the before-state. It looks the lines up by booking and action, **not by who did them**, so if a Developer did that check-in (also while working as someone), that Developer line is relabelled too, in the same way. Nothing else in the app touches an old line.
- **When an account is removed**, the database itself blanks the link from its old lines to the account. The line keeps the name and the account type.
- **The "clean start" maintenance script** (used once before launch) opens the lock for its own run on purpose.
- **Someone who holds the database login can get round the lock.** The lock can be switched off by a setting inside a database session, and a person with owner-level access can remove the trigger itself. So **the database address and its login are the keys to the audit trail.** Keep them limited to as few people as possible, never put them in a chat or a repository, and change them if you think they were seen. This is why the pages say "the database refuses it" and not "nobody can ever".

- **The whole table can be emptied.** The lock refuses a change or a delete of a line; it does not stop `TRUNCATE`, the command that empties a whole table. The test setup and the one-time clean-start tool need it, so it is left open on purpose. It needs the database login too, so it is the same key as above.

(The Boss's and the MD's Audit page, `/staff/audit`, says the same in its heading: the database refuses any change or delete, and the only change the system makes to an older line is marking a cancelled check-in as cancelled.)

The Developer account is built so that a mistake or a stolen password cannot write money or hide who did what. It is not a perfect wall. These are the honest limits:

- **The database login is the master key.** Whoever holds the database owner login can remove the audit-trail lock, and can change any record, money included, without the app.
- **No multi-factor authentication (MFA) yet.** This system has none, for the Developer account or for any account. A Developer sign-in is protected by a strong password, the short session, the wait after wrong tries and the audit trail, but **if someone learns the password they can sign in**, and with it they can work as anyone (except for money). Adding MFA (a code from an app or a security key, at least for the Developer, the Boss and the MD) is the **recommended next step**. Until then, the checklist in section 11 matters even more.
- **Work as is real power.** While you work as someone you can do everything that person can do **except money and taking over the account**: check guests in and out, move rooms, change what staff changed, answer guests. The hotel's own records will carry that person's name (see section 10); only the audit trail says it was you. Anyone who reads the hotel's records without the audit trail could think the person did it. That is why every start is told to the Boss and every action is written under your name.
- **Suspend and sign out everywhere are real power.** With a stolen Developer password someone could lock the MD, Finance, the managers and Reception out in a few clicks (never the Boss). The Boss is told by WhatsApp every time and every one is in the trail, so it is seen quickly and the Boss or the MD switches the accounts back on from Staff & roles (section 5). That is a speed limit on the harm, not a wall.
- **The account rule is a missing right and a second lock.** The Developer role does not hold `users.manage`, and the account service refuses a Developer again whatever it holds. Someone with the database login could still edit the role by hand: the service would still refuse, the console's Settings tab warns when the Developer holds a right it is denied, and running the seed again takes away any right the role should not hold.
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
