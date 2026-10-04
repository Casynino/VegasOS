// Runs in the build, after `prisma migrate deploy`. A fresh database (no staff accounts yet) gets the hotel's starting
// data — settings, roles, rooms, menu, photos, payment accounts — and the team's accounts (SEED_STAFF_PASSWORD) or the
// first Owner account (SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD / SEED_OWNER_NAME), set in Vercel. The seed only adds what is missing, so once anyone can sign in
// this step does nothing.
import { execSync } from "node:child_process";
import pg from "pg";

const url = process.env.DATABASE_URL;
if (!url) process.exit(0);
const client = new pg.Client({ connectionString: url });
let users = 1;
try {
  await client.connect();
  const { rows } = await client.query(`SELECT count(*)::int AS n FROM "users"`);
  users = rows[0]?.n ?? 1;
} catch (e) {
  console.warn("seed-if-empty: skipped —", e instanceof Error ? e.message : e);
} finally {
  await client.end().catch(() => {});
}
if (users > 0) process.exit(0);
console.log("Fresh database: adding the hotel's starting data…");
if (!process.env.SEED_STAFF_PASSWORD && !(process.env.SEED_OWNER_EMAIL && process.env.SEED_OWNER_PASSWORD)) console.warn("No SEED_STAFF_PASSWORD (or SEED_OWNER_EMAIL / SEED_OWNER_PASSWORD) in Vercel yet — the hotel data is added, the accounts on the next deploy.");
execSync("npx prisma db seed", { stdio: "inherit" });
