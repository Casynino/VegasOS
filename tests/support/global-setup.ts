import { execSync } from "node:child_process";

/** Apply migrations to the dedicated test database and load the configuration seed once per run. */
export default function setup() {
  const url = process.env.TEST_DATABASE_URL ?? "postgresql://nino@localhost:5432/vegas_hotel_test";
  if (!url.includes("test")) throw new Error("Refusing to reset a non-test database");
  const env = { ...process.env, DATABASE_URL: url, SEED_DEV_STAFF: "1", SEED_OWNER_EMAIL: "owner@test.local", SEED_OWNER_PASSWORD: "Owner12345" };
  execSync("npx prisma migrate deploy", { env, stdio: "pipe" }); // non-destructive; tests truncate their own data
  execSync("npx tsx prisma/seed.ts", { env, stdio: "pipe" });
}
