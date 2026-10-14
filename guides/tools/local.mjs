// The guide pictures come from their own practice database on this computer ("vegas_guides") — a separate copy made
// only for the books, so neither the live hotel nor the everyday practice database is touched.
//
//   node guides/tools/local.mjs run <command…>   run a command with that database as its DATABASE_URL
//   node guides/tools/local.mjs dev              start the app on http://localhost:3100 against it
//
// The address is worked out from .env (same server, other database name) and is never printed.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

export const GUIDE_DB = "vegas_guides";
export const GUIDE_PORT = 3100;
export const GUIDE_BASE = `http://localhost:${GUIDE_PORT}`;

export function guideDbUrl(root = process.cwd()) {
  const env = fs.readFileSync(path.join(root, ".env"), "utf8");
  const url = env.match(/^DATABASE_URL\s*=\s*["']?([^"'\n]+)/m)?.[1];
  if (!url || !/@(localhost|127\.0\.0\.1)[:/]/.test(url)) throw new Error("The guide pictures only use a database on this computer.");
  const u = new URL(url);
  u.pathname = "/" + GUIDE_DB;
  return u.toString();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const [mode, ...rest] = process.argv.slice(2);
  const env = { ...process.env, DATABASE_URL: guideDbUrl(), DIRECT_URL: "" };
  // The practice app talks to a pretend nTZS on this computer (guides/tools/mock-ntzs.mjs) with a pretend key, so the withdraw
  // screens can be shown — nothing real can move: the address is this computer's own.
  if (mode === "dev" && process.env.GUIDE_REAL_NTZS !== "1") Object.assign(env, { NTZS_API_KEY: "ntzs_live_guidebook_pretend", NTZS_BASE_URL: "http://127.0.0.1:3199/api/v1", NTZS_USER_ID: "" });
  const [cmd, args] = mode === "dev" ? ["npx", ["next", "dev", "-p", String(GUIDE_PORT)]] : mode === "run" && rest.length ? [rest[0], rest.slice(1)] : [null, []];
  if (!cmd) { console.error("Use: local.mjs run <command…> | local.mjs dev"); process.exit(1); }
  const child = spawn(cmd, args, { env, stdio: "inherit" });
  for (const sig of ["SIGINT", "SIGTERM"]) process.on(sig, () => child.kill(sig));
  child.on("exit", (code) => process.exit(code ?? 0));
}
