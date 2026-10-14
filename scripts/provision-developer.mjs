// THE ONLY WAY the Developer account is created. There is no sign-up page, no default password and no password in the code:
// the owner runs this on his own computer, types a password that is never shown, and it goes straight into the database as a hash.
//
//   npm run developer:setup                       create the Developer account
//   npm run developer:setup -- --rotate           set a NEW password for the existing Developer (ends all its sessions)
//   npm run developer:setup -- --rotate --reactivate   the same, and switch a switched-off Developer back on
//   npm run developer:setup -- --deactivate       switch the Developer account off (it cannot sign in; ends all its sessions)
//   --allow-second   (with create) allow a second active Developer — by default only one is allowed
//   --stdin          read the answers from standard input instead of asking (for tests): lines of the form  key=value
//                    keys: database (the database name, to confirm), email, name, password
//
// WHERE THE DATABASE ADDRESS COMES FROM (and nowhere else — never from the committed files, never from .env):
//   1. the environment variable DATABASE_URL, or
//   2. a file named .env.developer.local in the project folder (git-ignored: it is made on this computer, one line, the address).
// If both exist and differ the script stops. The address is NEVER printed: only the database NAME is shown, and you must type it to
// confirm. Error messages from the database are scrubbed of the address, the user name and the password before they are shown.
//
// What it writes: one user with the DEVELOPER role (the password hashed with argon2id, same settings as the app), and ONE audit
// entry in the same transaction ('developer.provisioned' / 'developer.password_rotated' / 'developer.deactivated': who = the setup
// script, the account's email and name — never the password or the hash). All or nothing.

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import readline from "node:readline/promises";
import pg from "pg";
import { hash, verify } from "@node-rs/argon2";

// The database driver's notice about SSL wording is noise here (the connection is checked in full either way).
process.removeAllListeners("warning");
process.on("warning", () => {});

/** The same settings as hashPassword in src/server/auth.ts (OWASP argon2id). A hash carries its settings, so the app verifies it either way. */
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };
// (The file's place can be moved with DEVELOPER_ADDRESS_FILE — the tests use it; nothing else needs it.)
const ADDRESS_FILE = process.env.DEVELOPER_ADDRESS_FILE || path.resolve(import.meta.dirname, "..", ".env.developer.local");
const ROLE_CODE = "DEVELOPER";
const FLAGS = new Set(["--rotate", "--deactivate", "--reactivate", "--allow-second", "--stdin", "--help"]);

const args = process.argv.slice(2);
const has = (f) => args.includes(f);
for (const a of args) if (!FLAGS.has(a)) fail(`I do not know "${a}". Try --help.`);
const ROTATE = has("--rotate");
const DEACTIVATE = has("--deactivate");
const REACTIVATE = has("--reactivate");
const ALLOW_SECOND = has("--allow-second");
const STDIN = has("--stdin");
const MODE = ROTATE ? "rotate" : DEACTIVATE ? "deactivate" : "create";

if (has("--help")) {
  console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((l) => l.startsWith("//")).slice(0, 12).map((l) => l.slice(3)).join("\n"));
  process.exit(0);
}
if (ROTATE && DEACTIVATE) fail("Choose one: --rotate or --deactivate.");
if (REACTIVATE && !ROTATE) fail("--reactivate goes with --rotate (a switched-off account needs a new password to come back).");
if (ALLOW_SECOND && MODE !== "create") fail("--allow-second is only for creating the account.");

/** Words that never reveal anything: the script's own refusals. */
class Refusal extends Error {}
function fail(message) {
  console.error(`\nSTOPPED — ${message}\n`);
  process.exit(1);
}

// ───────────────────────────── the database address (never printed) ─────────────────────────────

const ADDRESS_PATTERN = /postgres(?:ql)?:\/\/[^\s'"]+/;

function readAddress() {
  const fromEnv = process.env.DATABASE_URL?.match(ADDRESS_PATTERN)?.[0] ?? null;
  if (process.env.DATABASE_URL?.trim() && !fromEnv) fail("DATABASE_URL is set, but it is not a database address.");
  const fromFile = fs.existsSync(ADDRESS_FILE) ? (fs.readFileSync(ADDRESS_FILE, "utf8").match(ADDRESS_PATTERN)?.[0] ?? null) : null;
  if (fromEnv && fromFile && fromEnv !== fromFile) fail("Two different database addresses were found (the DATABASE_URL variable and the file .env.developer.local). Remove one of them, so there is no doubt which database this is.");
  const value = fromEnv ?? fromFile;
  if (!value) fail("There is no database address. Either set DATABASE_URL for this one command, or put the address (one line) in a file named .env.developer.local in the project folder. See docs/developer-account.md.");
  return value;
}

const ADDRESS = readAddress();
let URL_PARTS;
try { URL_PARTS = new URL(ADDRESS); } catch { fail("The database address cannot be read as an address."); }
const DB_NAME = decodeURIComponent(URL_PARTS.pathname.slice(1));
if (!DB_NAME) fail("The database address has no database name in it.");
const LOCAL = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(URL_PARTS.hostname);

/** Anything the database or the network says, with the address, the user name, the password and the host taken out. */
const HIDE = [ADDRESS, URL_PARTS.password, safeDecode(URL_PARTS.password), URL_PARTS.username, safeDecode(URL_PARTS.username), URL_PARTS.host, URL_PARTS.hostname].filter((s) => s && s.length >= 3);
function safeDecode(s) { try { return decodeURIComponent(s); } catch { return s; } }
const scrub = (text) => HIDE.reduce((t, s) => t.split(s).join("***"), String(text));

// ───────────────────────────── the answers ─────────────────────────────

/** key=value lines from standard input (--stdin). Only the first "=" splits, so a password may contain "=". */
async function readStdinAnswers() {
  if (process.stdin.isTTY) fail("--stdin expects the answers to be piped in.");
  process.stdin.setEncoding("utf8");
  let text = "";
  for await (const chunk of process.stdin) text += chunk;
  const out = {};
  for (const line of text.split("\n")) {
    const l = line.replace(/\r$/, "");
    const i = l.indexOf("=");
    if (i > 0) out[l.slice(0, i).trim()] = l.slice(i + 1);
  }
  return out;
}
const piped = STDIN ? await readStdinAnswers() : null;
if (!STDIN && !(process.stdin.isTTY && process.stdout.isTTY)) fail("This asks you questions, so it must run in a terminal. (For automatic tests: --stdin.)");

async function askVisible(prompt) {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => { rl.close(); fail("Cancelled. Nothing was changed."); });
  try { return await rl.question(prompt); } finally { rl.close(); }
}

/** A line typed with the terminal echo OFF: nothing appears on the screen, not even stars. */
function askHidden(prompt) {
  return new Promise((resolve) => {
    const stdin = process.stdin;
    process.stdout.write(prompt);
    stdin.setRawMode(true);
    stdin.resume();
    stdin.setEncoding("utf8");
    let typed = "";
    const finish = () => { stdin.removeListener("data", onData); stdin.setRawMode(false); stdin.pause(); process.stdout.write("\n"); };
    const onData = (chunk) => {
      for (const ch of chunk.replace(/\u001b\[[0-9;]*[A-Za-z]/g, "")) {
        if (ch === "\r" || ch === "\n") { finish(); return resolve(typed); }
        if (ch === "\u0003" || ch === "\u0004") { finish(); return fail("Cancelled. Nothing was changed."); }
        if (ch === "\u007f" || ch === "\b") typed = typed.slice(0, -1);
        else if (ch >= " ") typed += ch;
      }
    };
    stdin.on("data", onData);
  });
}

/** One answer: from the piped lines (--stdin) or by asking. */
async function answer(key, prompt, { hidden = false } = {}) {
  if (piped) {
    if (!(key in piped)) fail(`--stdin: the line "${key}=…" is missing.`);
    return piped[key];
  }
  return hidden ? askHidden(prompt) : askVisible(prompt);
}

// ───────────────────────────── the rules ─────────────────────────────

/** The same address rule the sign-in form applies, so an account made here can always sign in. */
const EMAIL_RULE = /^(?!\.)(?!.*\.\.)([A-Za-z0-9_'+\-.]*)[A-Za-z0-9_+-]@([A-Za-z0-9][A-Za-z0-9-]*\.)+[A-Za-z]{2,}$/;

const PASSWORD_HELP = [
  "The password must:",
  "  - be at least 14 characters long (a few words with numbers and a symbol is easy to remember and hard to guess),",
  "  - have a capital letter, a small letter, a number and a symbol (for example ! # % ? or a space),",
  "  - not be, or contain the first part of, your email address, and not be an easy word like 'password'.",
  "Use a password manager, and use this password nowhere else.",
].join("\n");

/** What is wrong with the password (never repeats it). Empty list = fine. */
function passwordProblems(password, email) {
  const bad = [];
  if (password.length < 14) bad.push("it is shorter than 14 characters");
  if (password.length > 200) bad.push("it is longer than 200 characters");
  if (!/[A-Z]/.test(password)) bad.push("it has no capital letter");
  if (!/[a-z]/.test(password)) bad.push("it has no small letter");
  if (!/[0-9]/.test(password)) bad.push("it has no number");
  if (!/[^A-Za-z0-9]/.test(password)) bad.push("it has no symbol");
  if (password !== password.trim()) bad.push("it starts or ends with a space");
  const lower = password.toLowerCase();
  const local = (email ?? "").toLowerCase().split("@")[0];
  if (email && lower === email.toLowerCase()) bad.push("it is the same as the email address");
  else if (local.length >= 5 && lower.includes(local)) bad.push("it contains the first part of the email address");
  if (/password|passwort|qwerty|123456|letmein|admin/.test(lower)) bad.push("it contains an easy word or pattern");
  return bad;
}

async function askNewPassword(email) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const first = await answer("password", "New password (not shown): ", { hidden: true });
    const problems = passwordProblems(first, email);
    if (problems.length) {
      const text = `That password is not strong enough: ${problems.join("; ")}.`;
      if (piped) fail(`${text}\n${PASSWORD_HELP}`);
      console.error(`\n${text}\n${PASSWORD_HELP}\n`);
      continue;
    }
    if (!piped) {
      const again = await askHidden("Type it again (not shown): ");
      if (again !== first) { console.error("\nThe two passwords are not the same. Try again.\n"); continue; }
    }
    return first;
  }
  return fail("Too many tries. Nothing was changed.");
}

// ───────────────────────────── the database ─────────────────────────────

const client = new pg.Client({ connectionString: ADDRESS, connectionTimeoutMillis: 20_000, statement_timeout: 60_000 });
const q = async (sql, params) => (await client.query(sql, params)).rows;
const newId = (prefix) => `${prefix}_${crypto.randomBytes(12).toString("hex")}`;

/** Business date of "now" in the hotel's timezone and business-day start, exactly as the app works it out. */
async function businessDate() {
  const s = (await q(`SELECT timezone, "businessDayStartMinutes" AS start FROM hotel_settings WHERE id = 1`))[0];
  return (await q(`SELECT to_char((now() AT TIME ZONE $1) - make_interval(mins => $2), 'YYYY-MM-DD') AS d`, [s.timezone, s.start]))[0].d;
}

async function developers(lock = false) {
  return q(`
    SELECT u.id, u.email, u."fullName" AS name, u."isActive" AS active, u."passwordHash" AS hash
    FROM users u JOIN roles r ON r.id = u."roleId" WHERE r.code = $1 ORDER BY u."createdAt"${lock ? " FOR UPDATE OF u" : ""}`, [ROLE_CODE]);
}

async function audit(action, entityId, before, after) {
  await q(
    `INSERT INTO audit_logs (id, "userId", "actorLabel", "actorType", "actorRole", action, "entityType", "entityId", before, after, "ipAddress", "businessDate", "createdAt")
     VALUES ($1, NULL, 'setup script', 'SYSTEM', NULL, $2, 'User', $3, $4::jsonb, $5::jsonb, NULL, $6::date, now())`,
    [newId("aud"), action, entityId, before ? JSON.stringify(before) : null, JSON.stringify(after), await businessDate()],
  );
}

/** Runs the steps in ONE transaction: all of it or none of it. */
async function inTransaction(steps) {
  await client.query("BEGIN");
  try {
    await client.query("SET LOCAL TIME ZONE 'UTC'"); // the app keeps its times in UTC; now() must mean the same here
    await client.query("SET LOCAL lock_timeout = '15s'");
    await client.query("SELECT pg_advisory_xact_lock(hashtext('vegas:developer-setup'))"); // two setups never run at the same moment
    const result = await steps();
    await client.query("COMMIT");
    return result;
  } catch (e) {
    try { await client.query("ROLLBACK"); } catch { /* nothing open */ }
    throw e;
  }
}

// ───────────────────────────── the three jobs ─────────────────────────────

async function create({ email, name, password }) {
  const passwordHash = await hash(password, ARGON_OPTS);
  return inTransaction(async () => {
    const role = (await q(`SELECT id FROM roles WHERE code = $1 FOR SHARE`, [ROLE_CODE]))[0];
    if (!role) throw new Refusal("The Developer role is not in this database. Deploy the application first (it runs the update that creates it), then run this again.");
    if ((await q(`SELECT 1 FROM users WHERE lower(email) = $1`, [email])).length) {
      throw new Refusal("A user with this email already exists. The Developer account needs its OWN email address — a different one from your staff account. Nothing was changed.");
    }
    const active = (await developers(true)).filter((d) => d.active);
    if (active.length && !ALLOW_SECOND) {
      throw new Refusal("An active Developer account already exists. There is only one. To change its password use --rotate; to switch it off use --deactivate; a second one needs --allow-second. Nothing was changed.");
    }
    const id = newId("usr_dev");
    await q(
      `INSERT INTO users (id, email, "fullName", "passwordHash", "roleId", "isActive", "mustChangePassword", "updatedAt")
       VALUES ($1, $2, $3, $4, $5, true, false, now())`,
      [id, email, name, passwordHash, role.id],
    );
    await audit("developer.provisioned", id, null, { email, name, role: ROLE_CODE });
    return { id };
  });
}

/** The Developer that --rotate / --deactivate act on: the only one, or the one whose email was given. */
async function target(list, emailAnswer) {
  if (!list.length) throw new Refusal("There is no Developer account in this database. Nothing was changed.");
  if (emailAnswer) {
    const found = list.find((d) => d.email === emailAnswer);
    if (!found) throw new Refusal("No Developer account has that email. Nothing was changed.");
    return found;
  }
  if (list.length > 1) throw new Refusal("There is more than one Developer account — say which one by its email.");
  return list[0];
}

async function rotate({ email, password }) {
  const passwordHash = await hash(password, ARGON_OPTS);
  return inTransaction(async () => {
    const dev = await target(await developers(true), email);
    if (!dev.active && !REACTIVATE) throw new Refusal("This Developer account is switched off. To set a new password AND switch it back on, add --reactivate. Nothing was changed.");
    if (await verify(dev.hash, password).catch(() => false)) throw new Refusal("That is the same password as the one now in use. Choose a new one. Nothing was changed.");
    await q(`UPDATE users SET "passwordHash" = $1, "mustChangePassword" = false, "isActive" = true, "updatedAt" = now() WHERE id = $2`, [passwordHash, dev.id]);
    const ended = (await client.query(`DELETE FROM sessions WHERE "userId" = $1`, [dev.id])).rowCount;
    await audit("developer.password_rotated", dev.id, { active: dev.active }, { email: dev.email, name: dev.name, active: true, sessionsEnded: ended });
    return { dev, ended };
  });
}

async function deactivate({ email }) {
  return inTransaction(async () => {
    const dev = await target(await developers(true), email);
    if (!dev.active) throw new Refusal("This Developer account is already switched off. Nothing was changed.");
    await q(`UPDATE users SET "isActive" = false, "updatedAt" = now() WHERE id = $1`, [dev.id]);
    const ended = (await client.query(`DELETE FROM sessions WHERE "userId" = $1`, [dev.id])).rowCount;
    await audit("developer.deactivated", dev.id, { active: true }, { email: dev.email, name: dev.name, active: false, sessionsEnded: ended });
    return { dev, ended };
  });
}

// ───────────────────────────── the run ─────────────────────────────

async function main() {
  try { await client.connect(); } catch (e) { fail(`Could not connect to the database${e.code ? ` (${String(e.code).replace(/[^A-Za-z0-9_]/g, "")})` : ""}. Check the address and that you are online. Nothing was changed.`); }

  // Is this the hotel's database, and has the update that makes the Developer role run?
  const settings = (await q(`SELECT "hotelName" FROM hotel_settings WHERE id = 1`).catch(() => []))[0];
  if (!settings) fail(`This database ("${DB_NAME}") has no hotel settings — it is not the hotel's database. Nothing was changed.`);
  const hasColumn = (await q(`SELECT 1 FROM information_schema.columns WHERE table_name = 'audit_logs' AND column_name = 'actorType'`)).length > 0;
  const hasRole = (await q(`SELECT 1 FROM roles WHERE code = $1`, [ROLE_CODE])).length > 0;
  if (!hasColumn || !hasRole) fail("The Developer role is not in this database yet. Deploy the application first (the deploy runs the database update that creates it), then run this again. Nothing was changed.");

  console.log(`\n  Database:  ${DB_NAME}   (${LOCAL ? "on this computer" : "on a remote server"})`);
  console.log(`  Hotel:     ${settings.hotelName}`);
  console.log(`  Job:       ${{ create: "create the Developer account", rotate: `set a new password for the Developer account${REACTIVATE ? " and switch it back on" : ""}`, deactivate: "switch the Developer account off" }[MODE]}\n`);

  // The explicit confirmation: the database's name, typed. Nothing else is asked before it.
  const typed = (await answer("database", `To confirm this is the right database, type its name (${DB_NAME}): `)).trim();
  if (typed !== DB_NAME) fail("That is not the name of this database. Nothing was changed.");

  if (MODE === "create") {
    const email = (await answer("email", "Developer's email (a NEW address, not your staff one): ")).trim().toLowerCase();
    if (!EMAIL_RULE.test(email) || email.length > 254) fail("That is not a valid email address. Nothing was changed.");
    const name = (await answer("name", "Developer's full name: ")).trim().replace(/\s+/g, " ");
    if (name.length < 2 || name.length > 100) fail("The name must be 2 to 100 characters. Nothing was changed.");
    if (!piped) console.log(`\n${PASSWORD_HELP}\n`);
    const password = await askNewPassword(email);
    await create({ email, name, password });
    console.log(`\nDONE — the Developer account was created.\n  Name:      ${name}\n  Email:     ${email}\n  Role:      Developer (super user)\n  Password:  set — it is not shown and not stored anywhere readable (only its hash is)\n\nSign in at /staff/login and choose "Developer account". The setup is written in the audit trail (/staff/audit).\n`);
    return;
  }

  const list = await developers();
  // Typed in a terminal: asked only when there is more than one Developer. Piped in (--stdin): read only if it was given.
  // Two or more Developers and no email: the check below stops with the plain "say which one" message, before any password is asked.
  const needEmail = piped ? "email" in piped : list.length > 1;
  const email = needEmail ? (await answer("email", `Which Developer? ${list.map((d) => d.email).join(", ")}: `)).trim().toLowerCase() : "";
  const chosen = await target(list, email);

  if (MODE === "rotate") {
    const known = chosen.email;
    if (!piped) console.log(`\n${PASSWORD_HELP}\n`);
    const password = await askNewPassword(known);
    const { dev, ended } = await rotate({ email, password });
    console.log(`\nDONE — a new password was set for ${dev.email}${REACTIVATE ? " and the account is switched on" : ""}.\n  Password:  set — not shown, only its hash is stored\n  Signed out: ${ended} open session${ended === 1 ? "" : "s"} of this account ended\n\nThe change is written in the audit trail.\n`);
    return;
  }

  const { dev, ended } = await deactivate({ email });
  console.log(`\nDONE — the Developer account ${dev.email} is switched off. It cannot sign in.\n  Signed out: ${ended} open session${ended === 1 ? "" : "s"} ended\n\nTo switch it on again with a new password: --rotate --reactivate. The change is written in the audit trail.\n`);
}

try {
  await main();
} catch (e) {
  if (e instanceof Refusal) console.error(`\nSTOPPED — ${e.message}\n`);
  else console.error(`\nSTOPPED — something went wrong${e.code ? ` (${String(e.code).replace(/[^A-Za-z0-9_]/g, "")})` : ""}: ${scrub(e.message ?? e)}\nNothing was changed.\n`);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
