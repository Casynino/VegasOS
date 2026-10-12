// A LOOK at the database before the hotel's clean start. It only reads — it cannot change or remove anything
// (everything runs inside a read-only transaction).
//
//   node scripts/launch-look.mjs            the local database (.env)
//   node scripts/launch-look.mjs --live     the LIVE database (its address in .env.reset.local — a file made on this computer, never in git)
//
// It answers: which tables hold set-up (stay), which hold what the hotel did while practising, and — the part only
// the hotel can judge — whether any of it is real: guests in the house, bookings to come, website requests, real money.
// The address of the database is read from the env file by this script; it is never printed.

import pg from "pg";
import { KEEP, WORK, MIXED, AUDIT_SETUP, AUDIT_WORK, OPENING, n, id, connection } from "./launch-common.mjs";

const { connectionString, label } = connection();
const client = new pg.Client({ connectionString });
const q = async (sql, params) => (await client.query(sql, params)).rows;
const one = async (sql, params) => (await q(sql, params))[0];
const maybe = async (sql, params) => { await client.query("SAVEPOINT s"); try { const r = await q(sql, params); await client.query("RELEASE s"); return r; } catch (e) { await client.query("ROLLBACK TO s"); return [{ error: e.message }]; } };

function table(rows, cols) {
  if (!rows.length) return "    (none)";
  if (rows[0].error) return `    (could not read: ${rows[0].error})`;
  const w = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? "").length)));
  return [cols.map((c, i) => c.padEnd(w[i])).join("  "), ...rows.map((r) => cols.map((c, i) => String(r[c] ?? "").padEnd(w[i])).join("  "))].map((l) => `    ${l}`).join("\n");
}

async function main() {
  await client.connect();
  await client.query("BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY");

  const tables = (await q(`SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY 1`)).map((r) => r.tablename);
  const known = new Set([...KEEP, ...Object.keys(WORK), ...MIXED]);
  const unknown = tables.filter((t) => !known.has(t));
  const gone = [...known].filter((t) => !tables.includes(t));
  const total = Object.fromEntries((await q(tables.map((t) => `SELECT '${t}' AS t, count(*)::int AS n FROM ${id(t)}`).join(" UNION ALL "))).map((r) => [r.t, r.n]));
  const hasLive = !!(await one(`SELECT 1 AS ok FROM information_schema.columns WHERE table_name = 'hotel_settings' AND column_name = 'liveSince'`));
  const s = await one(`SELECT timezone, "businessDayStartMinutes" AS start, "invoiceNextNumber", "hotelName"${hasLive ? `, to_char(("liveSince" AT TIME ZONE 'UTC') AT TIME ZONE timezone, 'DD Mon YYYY HH24:MI') AS "liveSince"` : ""} FROM hotel_settings WHERE id = 1`);
  const today = (await one(`SELECT to_char((now() AT TIME ZONE $1) - make_interval(mins => $2), 'YYYY-MM-DD') AS d`, [s.timezone, s.start])).d;

  const fks = await q(`
    SELECT c.conrelid::regclass::text AS t, a.attname AS col, a.attnotnull AS nn, c.confrelid::regclass::text AS ref
    FROM pg_constraint c JOIN pg_attribute a ON a.attrelid = c.conrelid AND a.attnum = c.conkey[1]
    WHERE c.contype = 'f' AND c.connamespace = 'public'::regnamespace ORDER BY 1, 2`);
  for (const f of fks) { f.t = f.t.replace(/"/g, ""); f.ref = f.ref.replace(/"/g, ""); }

  const L = [];
  L.push(`\nDATABASE: ${label}   (${s.hotelName}, business day ${today})   clean-start field: ${hasLive ? (s.liveSince ? `set ${s.liveSince} (hotel time)` : "ready, not set") : "NOT deployed yet"}`);
  if (unknown.length) L.push(`\n!! Tables this look does not know: ${unknown.join(", ")}`);
  if (gone.length) L.push(`\n!! Tables on the lists that are not in this database: ${gone.join(", ")}`);

  // --- 1. Is any of it real?
  const lastActivity = (await one(`SELECT to_char(max("createdAt") AT TIME ZONE 'UTC' AT TIME ZONE $1, 'DD Mon YYYY HH24:MI') AS at FROM audit_logs WHERE split_part(action, '.', 1) <> 'auth'`, [s.timezone])).at;
  const perDay = await q(`SELECT to_char("businessDate", 'DD Mon') AS day, count(*) FILTER (WHERE action IN ('reservation.checked_in', 'reservation.walk_in'))::int AS check_ins, count(*) FILTER (WHERE action LIKE 'payment.%')::int AS payment_steps, count(*) FILTER (WHERE action LIKE 'restaurant_order.%')::int AS order_steps FROM audit_logs WHERE "businessDate" >= $1::date - 9 GROUP BY "businessDate" ORDER BY "businessDate"`, [today]);
  const inHouse = await maybe(`
    SELECT r.reference, g."fullName" AS guest, string_agg(DISTINCT rm.number, ', ') AS rooms, to_char(min(rr."checkedInAt"), 'DD Mon') AS since,
           to_char(r."departureDate", 'DD Mon') AS leaves, r."paidAmount"::text AS paid, r."balanceAmount"::text AS balance
    FROM reservations r JOIN guests g ON g.id = r."guestId" JOIN reservation_rooms rr ON rr."reservationId" = r.id LEFT JOIN rooms rm ON rm.id = rr."roomId"
    WHERE r.status = 'CHECKED_IN' GROUP BY r.id, g."fullName" ORDER BY min(rr."checkedInAt")`);
  const coming = await maybe(`
    SELECT r.reference, g."fullName" AS guest, to_char(r."arrivalDate", 'DD Mon YYYY') AS arrives, r.status::text AS status, r."paidAmount"::text AS paid, to_char(r."createdAt", 'DD Mon') AS made
    FROM reservations r JOIN guests g ON g.id = r."guestId"
    WHERE r.status::text NOT IN ('CHECKED_IN', 'CHECKED_OUT', 'CANCELLED', 'NO_SHOW') AND r."arrivalDate" >= $1::date ORDER BY r."arrivalDate" LIMIT 40`, [today]);
  const byStatus = await maybe(`SELECT status::text AS status, count(*)::int AS n, to_char(min("createdAt"), 'DD Mon YYYY') AS first, to_char(max("createdAt"), 'DD Mon YYYY') AS latest FROM reservations GROUP BY 1 ORDER BY 1`);
  const requests = await maybe(`SELECT status::text AS status, count(*)::int AS n, to_char(max("createdAt"), 'DD Mon YYYY') AS latest FROM booking_requests GROUP BY 1 ORDER BY 1`);
  const contact = await maybe(`SELECT count(*)::int AS n, to_char(max("createdAt"), 'DD Mon YYYY') AS latest FROM contact_messages`);
  const companies = await maybe(`SELECT "companyName" AS name FROM corporate_customers ORDER BY 1 LIMIT 30`);
  const byAccount = await maybe(`
    SELECT coalesce(a.name, '(no account)') AS account, count(*)::int AS n, sum(p.amount)::text AS total, to_char(max(p."createdAt"), 'DD Mon YYYY') AS latest
    FROM payments p LEFT JOIN money_accounts a ON a.id = p."accountId" WHERE p.status::text = 'POSTED' GROUP BY 1 ORDER BY 1`);
  const phone = await maybe(`SELECT livemode, status::text AS status, count(*)::int AS n, coalesce(sum(amount), 0)::text AS total, to_char(max("createdAt"), 'DD Mon YYYY') AS latest FROM mobile_payments GROUP BY 1, 2 ORDER BY 1 DESC, 2`);
  const withdrawals = await maybe(`SELECT livemode, status::text AS status, count(*)::int AS n, coalesce(sum("debitedTzs"), 0)::text AS debited, to_char(max("createdAt"), 'DD Mon YYYY') AS latest FROM withdrawals GROUP BY 1, 2 ORDER BY 1 DESC, 2`);
  const openShifts = await maybe(`SELECT count(*)::int AS n FROM actual_shifts WHERE "endedAt" IS NULL`);
  const deliveries = await maybe(`SELECT status::text AS status, count(*)::int AS n FROM notification_deliveries GROUP BY 1 ORDER BY 1`);
  const expenses = await maybe(`SELECT status::text AS status, count(*)::int AS n, coalesce(sum(amount), 0)::text AS total FROM expenses GROUP BY 1 ORDER BY 1`);

  L.push(`\n1. IS ANY OF THIS REAL?`);
  L.push(`  Last thing done in the system: ${lastActivity ?? "nothing"}    Shifts open now: ${openShifts[0]?.n ?? "?"}`);
  L.push(`  The last ten days:\n${table(perDay, ["day", "check_ins", "payment_steps", "order_steps"])}`);
  L.push(`  Bookings by status:\n${table(byStatus, ["status", "n", "first", "latest"])}`);
  L.push(`  Guests checked in now (${inHouse[0]?.error ? "?" : inHouse.length}):\n${table(inHouse, ["reference", "guest", "rooms", "since", "leaves", "paid", "balance"])}`);
  L.push(`  Bookings still to arrive (${coming[0]?.error ? "?" : coming.length}):\n${table(coming, ["reference", "guest", "arrives", "status", "paid", "made"])}`);
  L.push(`  Website booking requests:\n${table(requests, ["status", "n", "latest"])}`);
  L.push(`  Website contact messages:\n${table(contact, ["n", "latest"])}`);
  L.push(`  Companies: ${companies[0]?.error ? "?" : companies.map((c) => c.name).join(", ") || "none"}`);
  L.push(`  Payments recorded, by account:\n${table(byAccount, ["account", "n", "total", "latest"])}`);
  L.push(`  Expenses:\n${table(expenses, ["status", "n", "total"])}`);
  L.push(`  Phone payment requests (nTZS) — livemode true = real money:\n${table(phone, ["livemode", "status", "n", "total", "latest"])}`);
  L.push(`  Withdrawals (nTZS) — livemode true = real money:\n${table(withdrawals, ["livemode", "status", "n", "debited", "latest"])}`);
  L.push(`  Report messages:\n${table(deliveries, ["status", "n"])}`);

  // --- 2. What the hotel did while practising
  const sum = {};
  for (const [t, h] of Object.entries(WORK)) sum[h] = (sum[h] ?? 0) + (total[t] ?? 0);
  L.push(`\n2. WHAT THE HOTEL DID WHILE PRACTISING  (rows)`);
  for (const [h, c] of Object.entries(sum)) L.push(`    ${String(n(c)).padStart(8)}  ${h}`);
  L.push(`    ${String(n(Object.values(sum).reduce((a, b) => a + b, 0))).padStart(8)}  in all, in ${Object.keys(WORK).length} tables`);

  const audit = await q(`SELECT split_part(action, '.', 1) AS p, count(*)::int AS n FROM audit_logs GROUP BY 1 ORDER BY 2 DESC`);
  const auditUnknown = audit.filter((a) => !AUDIT_SETUP.includes(a.p) && !AUDIT_WORK.includes(a.p));
  const of = (list) => audit.filter((a) => list.includes(a.p)).reduce((x, a) => x + a.n, 0);
  const stockKinds = await q(`SELECT kind::text AS kind, coalesce(note, '') AS note, count(*)::int AS n FROM inventory_movements WHERE NOT ${OPENING} GROUP BY 1, 2 ORDER BY 1, 3 DESC LIMIT 25`);
  const opening = (await one(`SELECT count(*)::int AS n FROM inventory_movements WHERE ${OPENING}`)).n;
  const stockItems = await q(`
    SELECT i.name, i.unit, i.quantity::text AS now, (i.quantity - d.s)::text AS at_opening
    FROM inventory_items i JOIN (SELECT "itemId", sum(change) AS s FROM inventory_movements WHERE status::text = 'POSTED' AND NOT ${OPENING} GROUP BY 1) d ON d."itemId" = i.id
    WHERE d.s <> 0 ORDER BY i.name`);
  const noOpening = (await one(`SELECT count(*)::int AS n FROM inventory_items i WHERE i.quantity <> 0 AND NOT EXISTS (SELECT 1 FROM inventory_movements m WHERE m."itemId" = i.id AND ${OPENING})`)).n;
  const blocks = await one(`SELECT count(*) FILTER (WHERE "closedAt" IS NULL AND ("endDate" IS NULL OR "endDate" >= $1::date))::int AS open, count(*)::int AS all FROM room_blocks`, [today]);
  const rota = await one(`SELECT count(*) FILTER (WHERE "businessDate" >= $1::date)::int AS ahead, count(*)::int AS all FROM shift_schedules`, [today]);
  const fileLinks = fks.filter((f) => f.ref === "stored_files");
  const files = await q(`SELECT purpose::text AS purpose, count(*)::int AS n, pg_size_pretty(sum(size)::bigint) AS size FROM stored_files GROUP BY 1 ORDER BY 1`);

  L.push(`\n3. TABLES THAT HOLD BOTH`);
  L.push(`  History (audit): ${n(of(AUDIT_WORK))} rows about bookings, orders, rooms and money · ${n(of(AUDIT_SETUP))} about settings, staff accounts and sign-ins`);
  if (auditUnknown.length) L.push(`    !! kinds not on either list: ${auditUnknown.map((a) => `${a.p} (${a.n})`).join(", ")}`);
  L.push(`  Stock: ${n(opening)} opening-stock rows · other movements:\n${table(stockKinds, ["kind", "note", "n"])}`);
  L.push(`    Items whose quantity is not the opening quantity any more (${stockItems.length}):\n${table(stockItems.slice(0, 80), ["name", "unit", "now", "at_opening"])}`);
  L.push(`    Items with stock but no opening-stock row: ${noOpening}`);
  L.push(`  Room blocks: ${blocks.open} open, ${blocks.all - blocks.open} finished`);
  L.push(`  Staff rota: ${rota.ahead} from today on, ${rota.all - rota.ahead} past`);
  L.push(`  Files:\n${table(files, ["purpose", "n", "size"])}\n    linked from: ${fileLinks.map((f) => `${f.t}.${f.col}`).join(", ")}`);

  // --- 4. What stays
  const rooms = await q(`SELECT status::text AS status, count(*)::int AS n, string_agg(number, ', ' ORDER BY number) AS rooms FROM rooms GROUP BY 1 ORDER BY 1`);
  const links = [];
  for (const f of fks.filter((f) => (KEEP.includes(f.t) || MIXED.includes(f.t)) && WORK[f.ref])) {
    const rows = (await one(`SELECT count(*)::int AS n FROM ${id(f.t)} WHERE ${id(f.col)} IS NOT NULL`)).n;
    links.push(`${f.t}.${f.col}${f.nn ? " (required)" : ""} ${rows}`);
  }
  const counters = [];
  for (const t of ["room_qr_codes", "spin_qr_codes", "booking_qr_codes", "restaurant_locations"])
    counters.push(`${t} ${(await one(`SELECT coalesce(sum("scanCount"), 0)::int AS n FROM ${id(t)}`)).n}`);
  const staff = await q(`SELECT r.name AS role, count(*)::int AS n, count(*) FILTER (WHERE u."isActive")::int AS active FROM users u JOIN roles r ON r.id = u."roleId" GROUP BY 1 ORDER BY 1`);
  const accounts = await q(`SELECT name, kind::text AS kind, "openingBalance"::text AS opening, "isActive" AS active FROM money_accounts ORDER BY "sortOrder"`);

  L.push(`\n4. THE SET-UP  (${KEEP.length} tables)`);
  L.push(`    ${["users", "roles", "permissions", "role_permissions", "rooms", "room_types", "price_rules", "promotions", "menu_categories", "menu_items", "inventory_items", "recipe_lines", "suppliers", "assets", "money_accounts", "payment_methods", "expense_categories", "revenue_categories", "spin_prizes", "restaurant_locations", "room_qr_codes", "spin_qr_codes", "booking_qr_codes", "media_assets", "site_content", "transport_services", "hotel_services", "sessions"].map((t) => `${t} ${n(total[t] ?? 0)}`).join(" · ")}`);
  L.push(`  Staff accounts by role:\n${table(staff, ["role", "n", "active"])}`);
  L.push(`  Money accounts:\n${table(accounts, ["name", "kind", "opening", "active"])}`);
  L.push(`  Rooms by status:\n${table(rooms, ["status", "n", "rooms"])}`);
  L.push(`  Set-up records that point at practice records: ${links.join(", ") || "none"}`);
  L.push(`  QR scans counted so far: ${counters.join(", ")}`);
  L.push(`  Next invoice number: ${s.invoiceNextNumber}`);

  await client.query("ROLLBACK");
  console.log(L.join("\n"));
  console.log(`\nNOTHING WAS CHANGED. This was only a look.\n`);
}

main().catch((e) => fail(String(e.message).replace(/postgres(ql)?:\/\/\S+/g, "(address)"))).finally(() => client.end().catch(() => {}));
