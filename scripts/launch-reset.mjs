// The clean start of the hotel: clears what was done while practising and keeps the set-up (staff, rooms, prices, menu,
// stock items and their opening stock, settings, QR codes, website, accounts). Look first with scripts/launch-look.mjs.
//
//   node scripts/launch-reset.mjs [--live]                          the plan: what would be cleared — changes NOTHING
//   node scripts/launch-reset.mjs [--live] --delete --confirm=CODE  clears it (CODE is printed by the plan, for exactly that data)
//   --db=<name>      a copy on this computer, to try it on first
//   --stock=opening  put every stock item back to its opening quantity  ·  --stock=keep  leave stock and its history as it is
//   --rooms=check    a room still Occupied becomes "Dirty — to check" (default)  ·  --rooms=free  it becomes Available
//
// One transaction: everything is cleared, or nothing is. Before anything is removed, every row to be removed or changed
// is copied into backups/launch-reset-…/ on this computer (never in git). Rows are removed table by table, children
// first — no table is dropped or emptied blindly, and a table this tool does not know stops it.

import fs from "node:fs";
import crypto from "node:crypto";
import pg from "pg";
import { KEEP, WORK, MIXED, AUDIT_SETUP, AUDIT_WORK, OPENING, LIVE, n, id, fail, connection } from "./launch-common.mjs";

const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const DELETE = process.argv.includes("--delete");
const CONFIRM = arg("confirm");
const STOCK = arg("stock");
const ROOMS = arg("rooms") ?? "check";
if (STOCK && !["opening", "keep"].includes(STOCK)) fail("--stock is opening or keep.");
if (!["check", "free"].includes(ROOMS)) fail("--rooms is check or free.");
if (DELETE && !CONFIRM) fail("--delete needs --confirm=CODE. Run the plan first (the same command without --delete); it prints the code.");

const COUNTERS = { room_qr_codes: ["scanCount", "lastScannedAt"], spin_qr_codes: ["scanCount", "lastScannedAt"], booking_qr_codes: ["scanCount", "lastScannedAt"], restaurant_locations: ["scanCount", "lastScannedAt"], expense_items: ["useCount", "lastUsedAt"] };
const MONEY_IN_FLIGHT = ["SUBMITTING", "UNKNOWN", "PROCESSING", "AWAITING_APPROVAL", "IN_REVIEW"];
const CLEAR = Object.keys(WORK);

const { connectionString, label } = connection();
const client = new pg.Client({ connectionString });
const q = async (sql, params) => (await client.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
const counts = async (tables) => Object.fromEntries((await q(tables.map((t) => `SELECT '${t}' AS t, count(*)::int AS n FROM ${id(t)}`).join(" UNION ALL "))).map((r) => [r.t, r.n]));

/** Everything the plan and the clearing both need — read, nothing changed. */
async function survey() {
  const tables = (await q(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)).map((r) => r.tablename);
  const known = new Set([...KEEP, ...CLEAR, ...MIXED]);
  const unknown = tables.filter((t) => !known.has(t));
  const gone = [...known].filter((t) => !tables.includes(t));
  if (unknown.length) fail(`tables this tool does not know (set-up or practice?): ${unknown.join(", ")}`);
  if (gone.length) fail(`tables on the lists that are not in this database: ${gone.join(", ")}`);

  const s = await one(`SELECT timezone, "businessDayStartMinutes" AS start, "hotelName", to_char(("liveSince" AT TIME ZONE 'UTC') AT TIME ZONE timezone, 'DD Mon YYYY HH24:MI') AS "liveSince" FROM hotel_settings WHERE id = 1`);
  if (!s) fail("the hotel's settings are not in this database.");
  const today = (await one(`SELECT to_char((now() AT TIME ZONE $1) - make_interval(mins => $2), 'YYYY-MM-DD') AS d`, [s.timezone, s.start])).d;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(today)) fail("the business day cannot be worked out.");

  const fks = await q(`
    SELECT c.conrelid::regclass::text AS t, a.attname AS col, a.attnotnull AS nn, c.confrelid::regclass::text AS ref
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace ORDER BY 1, 2`);
  for (const f of fks) { f.t = f.t.replace(/"/g, ""); f.ref = f.ref.replace(/"/g, ""); }

  const audit = await q(`SELECT split_part(action, '.', 1) AS p, count(*)::int AS n FROM audit_logs GROUP BY 1`);
  const auditUnknown = audit.filter((a) => !AUDIT_SETUP.includes(a.p) && !AUDIT_WORK.includes(a.p));
  if (auditUnknown.length) fail(`history rows of a kind this tool does not know: ${auditUnknown.map((a) => `${a.p} (${a.n})`).join(", ")}`);

  // Files: only those a practice record carries (a receipt, a payment proof) and no set-up record uses (the website's pictures).
  const fromWork = fks.filter((f) => f.ref === "stored_files" && WORK[f.t]);
  const fromKeep = fks.filter((f) => f.ref === "stored_files" && !WORK[f.t] && f.t !== "stored_files");
  const fileIds = fromWork.length ? (await q(`
    SELECT DISTINCT x.id FROM (${fromWork.map((f) => `SELECT ${id(f.col)} AS id FROM ${id(f.t)} WHERE ${id(f.col)} IS NOT NULL`).join(" UNION ")}) x
    ${fromKeep.map((f) => `WHERE`).length ? `WHERE ${fromKeep.map((f) => `NOT EXISTS (SELECT 1 FROM ${id(f.t)} k WHERE k.${id(f.col)} = x.id)`).join(" AND ")}` : ""}`)).map((r) => r.id) : [];

  const otherMoves = (await one(`SELECT count(*)::int AS n FROM inventory_movements WHERE NOT ${OPENING}`)).n;
  if (otherMoves && !STOCK) fail(`stock was moved while practising (${n(otherMoves)} movements). Say what to do with it: --stock=opening (every item back to its opening quantity) or --stock=keep (leave stock as it is).`);

  // The part of each mixed table that goes. null = nothing of it.
  const part = {
    audit_logs: [`split_part(action, '.', 1) = ANY($1)`, [AUDIT_WORK]],
    inventory_movements: STOCK === "keep" || !otherMoves ? null : [`NOT ${OPENING}`, []],
    room_blocks: [`"closedAt" IS NOT NULL OR ("endDate" IS NOT NULL AND "endDate" < '${today}'::date)`, []],
    shift_schedules: [`"businessDate" < '${today}'::date`, []],
    stored_files: fileIds.length ? [`id = ANY($1)`, [fileIds]] : null,
  };
  const clear = await counts(CLEAR);
  const partial = {};
  for (const t of MIXED) partial[t] = part[t] ? (await one(`SELECT count(*)::int AS n FROM ${id(t)} WHERE ${part[t][0]}`, part[t][1])).n : 0;

  const rooms = await q(`SELECT status::text AS status, count(*)::int AS n, string_agg(number, ', ' ORDER BY number) AS rooms FROM rooms GROUP BY 1 ORDER BY 1`);
  const roomsOf = (st) => rooms.find((r) => r.status === st) ?? { n: 0, rooms: "" };

  // A set-up record that points at a practice record: the link is taken off when it can be empty; it stops the tool when it cannot.
  const links = [];
  for (const f of fks.filter((f) => KEEP.includes(f.t) && WORK[f.ref])) {
    const rows = (await one(`SELECT count(*)::int AS n FROM ${id(f.t)} WHERE ${id(f.col)} IS NOT NULL`)).n;
    if (rows && f.nn) fail(`set-up table ${f.t} needs rows of ${f.ref} (${f.t}.${f.col}, ${rows} rows) — they cannot be cleared.`);
    if (rows) links.push({ ...f, rows });
  }

  const info = {
    inHouse: (await one(`SELECT count(*)::int AS n FROM reservations WHERE status::text = 'CHECKED_IN'`)).n,
    coming: (await one(`SELECT count(*)::int AS n FROM reservations WHERE status::text NOT IN ('CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW') AND "arrivalDate" >= $1::date`, [today])).n,
    roomNotes: (await one(`SELECT count(*)::int AS n FROM rooms WHERE "statusNote" IS NOT NULL AND EXISTS (SELECT 1 FROM reservations r WHERE rooms."statusNote" LIKE '%' || r.reference || '%')`)).n,
    openShifts: (await one(`SELECT count(*)::int AS n FROM actual_shifts WHERE "endedAt" IS NULL`)).n,
    payments: await q(`SELECT a.name AS account, count(*)::int AS n, sum(p.amount)::bigint AS total FROM payments p JOIN money_accounts a ON a.id = p."accountId" WHERE p.status::text = 'POSTED' GROUP BY 1 ORDER BY 1`),
    phonePaid: await one(`SELECT count(*)::int AS n, coalesce(sum(amount), 0)::bigint AS total FROM mobile_payments WHERE livemode AND status::text = 'COMPLETED'`),
    phoneWaiting: (await one(`SELECT count(*)::int AS n FROM mobile_payments WHERE status::text = 'PENDING'`)).n,
    withdrawn: await one(`SELECT count(*)::int AS n, coalesce(sum("debitedTzs"), 0)::bigint AS total FROM withdrawals WHERE livemode AND status::text = 'COMPLETED'`),
    withdrawing: (await one(`SELECT count(*)::int AS n FROM withdrawals WHERE status::text = ANY($1)`, [MONEY_IN_FLIGHT])).n,
    staff: await q(`SELECT r.name AS role, count(*)::int AS n FROM users u JOIN roles r ON r.id = u."roleId" GROUP BY 1 ORDER BY 1`),
  };

  const change = { occupied: roomsOf("OCCUPIED"), reserved: roomsOf("RESERVED") };
  const code = crypto.createHash("sha256").update(JSON.stringify({ label, clear, partial, rooms: [change.occupied.rooms, change.reserved.rooms], stock: STOCK ?? null, roomsTo: ROOMS })).digest("hex").slice(0, 8);
  return { s, today, fks, part, clear, partial, rooms, change, links, info, otherMoves, code };
}

function headings(plan) {
  const sum = {};
  for (const [t, h] of Object.entries(WORK)) sum[h] = (sum[h] ?? 0) + plan.clear[t];
  sum["History of bookings, orders, rooms and money"] = plan.partial.audit_logs;
  sum["Stock movements (not the opening stock)"] = plan.partial.inventory_movements;
  sum["Room blocks that are finished"] = plan.partial.room_blocks;
  sum["Staff rota of past days"] = plan.partial.shift_schedules;
  sum["Files of practice records (receipts, payment proofs)"] = plan.partial.stored_files;
  return sum;
}

function describe(plan) {
  const L = [];
  const sum = headings(plan);
  const all = Object.values(sum).reduce((a, b) => a + b, 0);
  L.push(`\nDATABASE: ${label}   (${plan.s.hotelName}, business day ${plan.today})${plan.s.liveSince ? `\n!! A CLEAN START WAS ALREADY DONE on ${plan.s.liveSince}. What is here now is the hotel's real work — clearing again is refused.` : ""}`);
  L.push(`\nWOULD BE CLEARED  (rows)`);
  for (const [h, c] of Object.entries(sum)) if (c) L.push(`    ${String(n(c)).padStart(8)}  ${h}`);
  L.push(`    ${String(n(all)).padStart(8)}  in all`);
  L.push(`\nWOULD CHANGE`);
  L.push(`    Rooms: ${plan.change.occupied.n ? `Occupied → ${ROOMS === "free" ? "Available" : "Dirty, to check"}: ${plan.change.occupied.rooms}` : "none is Occupied"} · ${plan.change.reserved.n ? `Reserved → Available: ${plan.change.reserved.rooms}` : "none is Reserved"} · every other room stays as it is`);
  L.push(`    Stock: ${plan.otherMoves ? (STOCK === "keep" ? "left as it is, history kept" : "every item back to its opening quantity") : "not touched (no movements besides the opening stock)"}`);
  if (plan.info.roomNotes) L.push(`    Notes on rooms that name a cleared booking ("Checked out: …"): ${plan.info.roomNotes} taken off — the room's status stays`);
  L.push(`    Counters back to 0: QR scans, how often an expense item was used`);
  if (plan.links.length) L.push(`    Links taken off set-up records: ${plan.links.map((f) => `${f.t}.${f.col} (${f.rows})`).join(", ")}`);
  L.push(`    The clean start is noted in the settings: no automatic report goes back before it`);
  L.push(`\nSTAYS  (${KEEP.length} set-up tables, untouched)`);
  L.push(`    Staff accounts: ${plan.info.staff.map((r) => `${r.role} ${r.n}`).join(" · ")}`);
  L.push(`    Rooms now: ${plan.rooms.map((r) => `${r.status} ${r.n}`).join(" · ")}`);
  L.push(`\nLOOK AT THIS BEFORE CLEARING`);
  L.push(`    Guests checked in now: ${plan.info.inHouse} · bookings still to arrive: ${plan.info.coming} · shifts open now: ${plan.info.openShifts}`);
  L.push(`    Payments on record: ${plan.info.payments.map((p) => `${p.account} ${n(p.n)} = TZS ${n(p.total)}`).join(" · ") || "none"}`);
  L.push(`    REAL mobile money received (nTZS): ${plan.info.phonePaid.n} = TZS ${n(plan.info.phonePaid.total)} · withdrawn: ${plan.info.withdrawn.n} = TZS ${n(plan.info.withdrawn.total)}`);
  if (plan.info.phoneWaiting) L.push(`    !! ${plan.info.phoneWaiting} phone payment request(s) still waiting for the customer — clearing is refused until they finish or are cancelled`);
  if (plan.info.withdrawing) L.push(`    !! ${plan.info.withdrawing} withdrawal(s) on the way — clearing is refused until nTZS has answered`);
  return L.join("\n");
}

/** Children before parents. A loop is opened by emptying a link that may be empty (its rows are going anyway). */
async function order(plan) {
  const nodes = [...CLEAR, ...MIXED].sort();
  let edges = plan.fks.filter((f) => f.t !== f.ref && nodes.includes(f.t) && nodes.includes(f.ref));
  const done = new Set(), out = [];
  while (out.length < nodes.length) {
    const free = nodes.filter((t) => !done.has(t) && !edges.some((e) => e.ref === t && !done.has(e.t)));
    if (free.length) { for (const t of free) { done.add(t); out.push(t); } continue; }
    const loose = edges.filter((e) => !done.has(e.t) && !done.has(e.ref) && !e.nn && WORK[e.t]);
    if (!loose.length) fail(`the tables depend on each other in a loop that cannot be opened: ${nodes.filter((t) => !done.has(t)).join(", ")}`);
    for (const e of loose) await client.query(`UPDATE ${id(e.t)} SET ${id(e.col)} = NULL WHERE ${id(e.col)} IS NOT NULL`);
    edges = edges.filter((e) => !loose.includes(e));
  }
  return out;
}

async function main() {
  await client.connect();

  if (!DELETE) {
    await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");
    await client.query(`SET LOCAL TIME ZONE 'UTC'`);
    const plan = await survey();
    await client.query("ROLLBACK");
    console.log(describe(plan));
    const flags = `${LIVE ? " --live" : ""}${arg("db") ? ` --db=${arg("db")}` : ""}${STOCK ? ` --stock=${STOCK}` : ""}${arg("rooms") ? ` --rooms=${ROOMS}` : ""}`;
    console.log(plan.s.liveSince ? `\nNOTHING WAS CHANGED.\n` : `\nNOTHING WAS CHANGED. To clear exactly this:\n\n    node scripts/launch-reset.mjs${flags} --delete --confirm=${plan.code}\n`);
    return;
  }

  await client.query("BEGIN");
  await client.query(`SET LOCAL TIME ZONE 'UTC'`); // the app keeps its times in UTC; now() must mean the same here
  await client.query(`SET LOCAL lock_timeout = '20s'`);
  await client.query(`SET LOCAL statement_timeout = '300s'`);
  // Nobody writes into these while they are cleared (reading goes on); a write that waited meets the cleared tables afterwards.
  await client.query(`LOCK TABLE ${[...CLEAR, ...MIXED, "rooms", "hotel_settings", "inventory_items", ...Object.keys(COUNTERS)].map(id).join(", ")} IN SHARE ROW EXCLUSIVE MODE`);
  const plan = await survey();
  if (plan.s.liveSince && !process.argv.includes("--again")) fail(`a clean start was already done on ${plan.s.liveSince}. What is in the database now is the hotel's real work. Nothing was changed.`);
  if (plan.code !== CONFIRM) fail("the data is not what the code was made for (something was done since the plan, or the options differ). Nothing was changed — run the plan again.");
  if (plan.info.phoneWaiting) fail(`${plan.info.phoneWaiting} phone payment request(s) are still waiting for the customer. Let them finish or cancel them, then run the plan again. Nothing was changed.`);
  if (plan.info.withdrawing) fail(`${plan.info.withdrawing} withdrawal(s) are on the way. Wait for nTZS to answer, then run the plan again. Nothing was changed.`);
  const keptBefore = await counts(KEEP);
  const mixedBefore = await counts(MIXED);
  const negativeBefore = (await one(`SELECT count(*)::int AS n FROM inventory_items WHERE quantity < 0`)).n;

  // 1. The safety copy — every row that is removed or changed, before anything is.
  const stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15);
  const dir = `backups/launch-reset-${LIVE ? "live" : "local"}-${stamp}`;
  fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
  const save = async (file, sql, params) => {
    const rows = await q(sql, params);
    if (rows.length) fs.writeFileSync(`${dir}/${file}`, rows.map((r) => r.j).join("\n") + "\n", { mode: 0o600 });
    return rows.length;
  };
  let copied = 0;
  for (const t of CLEAR) if (plan.clear[t]) copied += await save(`${t}.jsonl`, `SELECT row_to_json(t)::text AS j FROM ${id(t)} t`);
  for (const t of MIXED) if (plan.partial[t]) copied += await save(`${t}.jsonl`, `SELECT row_to_json(t)::text AS j FROM ${id(t)} t WHERE ${plan.part[t][0]}`, plan.part[t][1]);
  await save("changed-rooms.jsonl", `SELECT row_to_json(t)::text AS j FROM (SELECT id, number, status, "statusNote", "statusChangedAt" FROM rooms) t`);
  await save("changed-inventory_items.jsonl", `SELECT row_to_json(t)::text AS j FROM (SELECT id, name, quantity FROM inventory_items) t`);
  for (const [t, [a, b]] of Object.entries(COUNTERS)) await save(`changed-${t}.jsonl`, `SELECT row_to_json(t)::text AS j FROM (SELECT id, ${id(a)}, ${id(b)} FROM ${id(t)} WHERE ${id(a)} <> 0 OR ${id(b)} IS NOT NULL) t`);
  for (const f of plan.links) await save(`link-${f.t}.${f.col}.jsonl`, `SELECT row_to_json(t)::text AS j FROM (SELECT id, ${id(f.col)} FROM ${id(f.t)} WHERE ${id(f.col)} IS NOT NULL) t`);
  await save("real-money-ntzs.jsonl", `SELECT row_to_json(t)::text AS j FROM (SELECT * FROM mobile_payments WHERE livemode AND status::text = 'COMPLETED' ORDER BY "createdAt") t`);
  await save("real-money-withdrawals.jsonl", `SELECT row_to_json(t)::text AS j FROM (SELECT * FROM withdrawals WHERE livemode ORDER BY "createdAt") t`);
  const expected = Object.values(plan.clear).reduce((a, b) => a + b, 0) + Object.values(plan.partial).reduce((a, b) => a + b, 0);
  if (copied !== expected) fail(`the safety copy holds ${n(copied)} rows, ${n(expected)} were expected. Nothing was changed.`);

  // 2. Rooms, stock and counters — the state the practice left behind.
  await client.query(`UPDATE rooms SET "statusNote" = NULL WHERE "statusNote" IS NOT NULL AND EXISTS (SELECT 1 FROM reservations r WHERE rooms."statusNote" LIKE '%' || r.reference || '%')`);
  await client.query(`UPDATE rooms SET status = '${ROOMS === "free" ? "AVAILABLE" : "DIRTY"}', "statusNote" = ${ROOMS === "free" ? "NULL" : "'To check — clean start'"}, "statusChangedAt" = now(), "updatedAt" = now() WHERE status::text = 'OCCUPIED'`);
  await client.query(`UPDATE rooms SET status = 'AVAILABLE', "statusNote" = NULL, "statusChangedAt" = now(), "updatedAt" = now() WHERE status::text = 'RESERVED'`);
  if (plan.partial.inventory_movements)
    await client.query(`UPDATE inventory_items i SET quantity = i.quantity - d.s FROM (SELECT "itemId", sum(change) AS s FROM inventory_movements WHERE status::text = 'POSTED' AND NOT ${OPENING} GROUP BY 1) d WHERE d."itemId" = i.id AND d.s <> 0`);
  for (const [t, [a, b]] of Object.entries(COUNTERS)) await client.query(`UPDATE ${id(t)} SET ${id(a)} = 0, ${id(b)} = NULL WHERE ${id(a)} <> 0 OR ${id(b)} IS NOT NULL`);

  // 3. Clearing, children first. Before a table goes, links to it from rows that stay are taken off.
  const removed = {};
  for (const t of await order(plan)) {
    if (WORK[t]) {
      for (const f of plan.fks.filter((f) => f.ref === t && !WORK[f.t] && !f.nn)) await client.query(`UPDATE ${id(f.t)} SET ${id(f.col)} = NULL WHERE ${id(f.col)} IS NOT NULL`);
      removed[t] = (await client.query(`DELETE FROM ${id(t)}`)).rowCount;
    } else removed[t] = plan.part[t] ? (await client.query(`DELETE FROM ${id(t)} WHERE ${plan.part[t][0]}`, plan.part[t][1])).rowCount : 0;
  }

  // 4. The clean start is noted: no automatic report goes back before it. One line of history says what was done.
  await client.query(`UPDATE hotel_settings SET "liveSince" = now() WHERE id = 1`);
  const sum = headings(plan);
  await client.query(
    `INSERT INTO audit_logs (id, "actorLabel", action, "entityType", "entityId", after, "businessDate", "createdAt") VALUES ($1, 'System', 'system.launch_reset', 'HotelSettings', '1', $2::jsonb, $3::date, now())`,
    [`reset_${crypto.randomUUID()}`, JSON.stringify({ cleared: Object.fromEntries(Object.entries(sum).filter(([, c]) => c)), rooms: ROOMS, stock: STOCK ?? null, safetyCopy: dir }), plan.today]);

  // 5. Checked before it is kept: anything wrong and all of it is undone.
  const problems = [];
  const after = await counts([...CLEAR, ...MIXED, ...KEEP]);
  for (const t of CLEAR) { if (after[t] !== 0) problems.push(`${t} still has ${after[t]} rows`); if (removed[t] !== plan.clear[t]) problems.push(`${t}: removed ${removed[t]}, expected ${plan.clear[t]}`); }
  for (const t of MIXED) {
    const kept = mixedBefore[t] - plan.partial[t] + (t === "audit_logs" ? 1 : 0);
    if (removed[t] !== plan.partial[t]) problems.push(`${t}: removed ${removed[t]}, expected ${plan.partial[t]}`);
    if (after[t] !== kept) problems.push(`${t}: ${after[t]} rows left, expected ${kept}`);
  }
  for (const t of KEEP) if (after[t] !== keptBefore[t]) problems.push(`set-up table ${t} changed: ${keptBefore[t]} → ${after[t]} rows`);
  if ((await one(`SELECT count(*)::int AS n FROM rooms WHERE status::text IN ('OCCUPIED', 'RESERVED')`)).n) problems.push("a room is still Occupied or Reserved");
  if ((await one(`SELECT count(*)::int AS n FROM inventory_items WHERE quantity < 0`)).n > negativeBefore) problems.push("a stock item went below zero");
  if (!(await one(`SELECT "liveSince" FROM hotel_settings WHERE id = 1`)).liveSince) problems.push("the clean start was not noted");
  if (problems.length) {
    await client.query("ROLLBACK");
    fs.writeFileSync(`${dir}/NOT-DONE.txt`, `Nothing was cleared — the check before keeping it failed:\n${problems.join("\n")}\n`, { mode: 0o600 });
    fail(`the check failed, so everything was undone — the database is as it was:\n  ${problems.join("\n  ")}`);
  }
  await client.query("COMMIT");

  const lines = [`CLEAN START DONE — ${label} — ${new Date().toISOString()}`, "", "Cleared (rows):",
    ...Object.entries(sum).filter(([, c]) => c).map(([h, c]) => `  ${String(n(c)).padStart(8)}  ${h}`), `  ${String(n(expected)).padStart(8)}  in all`, "",
    `Rooms: ${plan.change.occupied.n} Occupied → ${ROOMS === "free" ? "Available" : "Dirty, to check"}${plan.change.occupied.n ? ` (${plan.change.occupied.rooms})` : ""} · ${plan.change.reserved.n} Reserved → Available`,
    `Stock: ${plan.partial.inventory_movements ? "every item back to its opening quantity" : "not touched"}`,
    `Set-up: ${KEEP.length} tables, every one with the same number of rows as before`,
    `Real mobile money that had been received (nTZS): ${plan.info.phonePaid.n} = TZS ${n(plan.info.phonePaid.total)} — copied in real-money-ntzs.jsonl; no money was moved`,
    `Safety copy of everything removed or changed: ${dir}/ (${n(copied)} rows, on this computer only)`];
  fs.writeFileSync(`${dir}/report.txt`, lines.join("\n") + "\n", { mode: 0o600 });
  console.log(`\n${lines.join("\n")}\n`);
}

main().catch(async (e) => {
  try { await client.query("ROLLBACK"); } catch { /* nothing open */ }
  console.error(`\nSTOPPED — ${String(e.message).replace(/postgres(ql)?:\/\/\S+/g, "[address]")}\nNothing was changed.\n`);
  process.exitCode = 1;
}).finally(() => client.end().catch(() => {}));
