// Runs in the build, once (owner, 2026-10-04): the live accounts sign in exactly as on the test system — same emails,
// same passwords, straight in. Done once (an audit row marks it), so a password someone changes later is never reset.
import { randomUUID } from "node:crypto";
import { hash } from "@node-rs/argon2";
import pg from "pg";

const TEAM = {
  "admin@vegas.test": "Admin12345",
  "manager@vegas.test": "Manager12345",
  "asha@vegas.test": "Reception12345",
  "neema@vegas.test": "Reception12345",
  "rehema@vegas.test": "Reception12345",
  "chef@vegas.test": "Kitchen12345",
  "waiter@vegas.test": "Waiter12345",
  "baraka@vegas.test": "Waiter12345",
  "hamisi@vegas.test": "Waiter12345",
  "juma@vegas.test": "Waiter12345",
  "upendo@vegas.test": "Waiter12345",
  "zawadi@vegas.test": "Waiter12345",
  "restaurant@yourhotel.com": "Restaurant12345",
};
const ARGON_OPTS = { memoryCost: 19456, timeCost: 2, parallelism: 1 };

const url = process.env.DATABASE_URL;
if (!url) process.exit(0);
const client = new pg.Client({ connectionString: url });
try {
  await client.connect();
  const done = await client.query(`SELECT 1 FROM "audit_logs" WHERE action = 'setup.team_logins' LIMIT 1`);
  if (done.rowCount) process.exit(0);
  let set = 0;
  for (const [email, password] of Object.entries(TEAM)) {
    const r = await client.query(`UPDATE "users" SET "passwordHash" = $1, "mustChangePassword" = false WHERE email = $2`, [await hash(password, ARGON_OPTS), email]);
    set += r.rowCount ?? 0;
  }
  await client.query(`DELETE FROM "rate_limit_buckets" WHERE key = ANY($1)`, [Object.keys(TEAM).map((e) => `login:email:${e}`)]);
  await client.query(
    `INSERT INTO "audit_logs" (id, "actorLabel", action, "entityType", after, "businessDate", "createdAt") VALUES ($1, 'system', 'setup.team_logins', 'User', $2, CURRENT_DATE, now())`,
    [randomUUID(), JSON.stringify({ accounts: set })],
  );
  console.log(`Team sign-ins set: ${set} accounts.`);
} catch (e) {
  console.warn("team-logins: skipped —", e instanceof Error ? e.message : e);
} finally {
  await client.end().catch(() => {});
}
