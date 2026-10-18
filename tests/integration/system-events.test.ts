import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// next/headers and next/navigation are mocked the same way as in the other Developer tests.
vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});

import { db } from "@/server/db";
import { getCurrentUser, type CurrentUser } from "@/server/auth";
import { AppError, runAction } from "@/server/errors";
import {
  actionSourceOf, loadSystemEvents, purgeSystemEvents, recordCronRun, recordError, recordRequestError, recordWebhook, resetSystemEventsLimits,
  MAX_ERROR_ROWS, NEW_ERRORS_PER_MINUTE, WRITE_TIMEOUT_MS,
} from "@/server/services/system-events";
import { ERROR_KINDS, errorHint } from "@/lib/error-hints";
import { errorFacts, firstMeaningfulLine, scrubEventText, stackFrames } from "@/lib/console-scrub";
import { onRequestError } from "@/instrumentation";
import { browser, makeSession, makeUser, removeMadeUsers, thrownBy, type MadeUser } from "../support/developer";

/**
 * What the system records about itself (owner, 2026-10-18), against a real database:
 *   1. the table exists as written (one new table, its two indexes), and applying the migration changed nothing else;
 *   2. an unexpected error is written once per KIND (a repeat raises the count), nothing normal is written, nothing personal is kept;
 *   3. recording can never hurt the caller: it never throws, never waits long, stays quiet after a failure, and is rate-limited;
 *   4. every run of an automatic job and every call a provider makes is a row; old rows are removed on the written windows;
 *   5. only the Developer reads it, in the documented shapes, bounded; "overdue" follows the written rule;
 *   6. a server action answers EXACTLY what it answered before, with or without the recorder working.
 */

const DAY = 24 * 3600_000;
const HOUR = 3600_000;

let dev: MadeUser;
let rec: MadeUser;
let boss: MadeUser;
let md: MadeUser;
let mgr: MadeUser;
let fin: MadeUser;
const everyone = () => [dev, rec, boss, md, mgr, fin];

async function as(u: MadeUser) {
  browser.reset();
  await makeSession(u.id);
  return (await getCurrentUser()) as CurrentUser;
}
const rows = (where: Record<string, unknown> = {}) => db.systemEvent.findMany({ where, orderBy: { firstSeenAt: "asc" } });
const wipe = () => db.systemEvent.deleteMany({});
const quietly = (): Promise<void> => new Promise((r) => setTimeout(r, 25));

/** A realistic failed database call: Prisma writes the CODE of the call, WITH THE VALUES it was given, before the reason. */
function prismaError(code: string, reason: string): Error {
  const e = new Error(
    "\nInvalid `prisma.customer.create()` invocation in\n/var/task/src/server/services/customers.ts:88:41\n\n" +
    "   85   const phone = normalize(input.phone);\n   86 \n   87   return db.customer.create({\n→  88     data: {\n" +
    "         phone: \"+255712345678\",\n         fullName: \"Asha Juma\",\n         email: \"asha.juma@example.com\"\n       }\n     })\n\n" + reason,
  ) as Error & { code: string; clientVersion: string };
  e.name = "PrismaClientKnownRequestError";
  e.code = code;
  e.clientVersion = "7.10.0";
  return e;
}

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Events Dev" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Asha Events" });
  boss = await makeUser("OWNER", { fullName: "Boss Events" });
  md = await makeUser("ADMIN", { fullName: "MD Events" });
  mgr = await makeUser("MANAGER", { fullName: "Manager Events" });
  fin = await makeUser("FINANCE", { fullName: "Finance Events" });
});
afterAll(async () => {
  await wipe();
  await removeMadeUsers();
});
beforeEach(async () => {
  browser.reset();
  resetSystemEventsLimits();
  await wipe();
  await db.session.deleteMany({ where: { userId: { in: everyone().map((u) => u.id) } } });
});

// ───────────────────────────────────────────── 1. the table ─────────────────────────────────────────────
describe("the table", () => {
  it("is there as the contract says, with its two indexes, and the migration is applied", async () => {
    const cols = await db.$queryRaw<{ column_name: string; data_type: string; is_nullable: string }[]>`
      SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_name = 'system_events' ORDER BY column_name`;
    expect(cols.map((c) => c.column_name).sort()).toEqual(["count", "detail", "firstSeenAt", "fingerprint", "id", "kind", "lastSeenAt", "message", "source", "status"].sort());
    expect(cols.find((c) => c.column_name === "detail")).toMatchObject({ data_type: "jsonb", is_nullable: "YES" });
    expect(cols.find((c) => c.column_name === "count")).toMatchObject({ data_type: "integer", is_nullable: "NO" });
    const idx = await db.$queryRaw<{ indexname: string }[]>`SELECT indexname FROM pg_indexes WHERE tablename = 'system_events' ORDER BY indexname`;
    expect(idx.map((i) => i.indexname)).toEqual(["system_events_fingerprint_idx", "system_events_kind_lastSeenAt_idx", "system_events_pkey"]);
    const [m] = await db.$queryRaw<{ ok: number }[]>`SELECT count(*)::int AS ok FROM _prisma_migrations WHERE migration_name = '20261018120000_system_events' AND finished_at IS NOT NULL AND rolled_back_at IS NULL`;
    expect(m.ok).toBe(1);
  });
});

// ───────────────────────────────────────────── 2. errors ─────────────────────────────────────────────
describe("recordError", () => {
  it("writes one row per kind of error; the same bug again only raises the count", async () => {
    const make = () => new TypeError("Cannot read properties of undefined (reading 'floor')");
    await recordError({ source: "test:page:/staff/x", error: make() });
    const [first] = await rows();
    expect(first).toMatchObject({ kind: "ERROR", source: "test:page:/staff/x", status: "OPEN", count: 1 });
    expect(first.message).toContain("TypeError: Cannot read properties of undefined");
    await quietly();
    await recordError({ source: "test:page:/staff/x", error: make() });
    await recordError({ source: "test:page:/staff/x", error: make() });
    const after = await rows();
    expect(after).toHaveLength(1);
    expect(after[0].count).toBe(3);
    expect(after[0].firstSeenAt.getTime()).toBe(first.firstSeenAt.getTime());
    expect(after[0].lastSeenAt.getTime()).toBeGreaterThan(first.lastSeenAt.getTime());
  });

  it("a different place, a different kind of error or a different first line is another row; numbers in the line do not matter", async () => {
    await recordError({ source: "test:a", error: new Error("Order 12 not found") });
    await recordError({ source: "test:a", error: new Error("Order 13 not found") }); // same bug
    await recordError({ source: "test:b", error: new Error("Order 12 not found") }); // other place
    await recordError({ source: "test:a", error: new RangeError("Order 12 not found") }); // other kind
    await recordError({ source: "test:a", error: new Error("Table is missing") }); // other line
    const all = await rows();
    expect(all).toHaveLength(4);
    expect(all.find((r) => r.source === "test:a" && r.message.startsWith("Error: Order"))?.count).toBe(2);
  });

  it("skips what is normal: a message for the person, Next's redirect / not-found / fallback, a cancelled request, a form left open across a new version", async () => {
    const withDigest = (digest: string) => Object.assign(new Error("control flow"), { digest });
    await recordError({ source: "test:n", error: new AppError("Room is not ready.", "VALIDATION") });
    await recordError({ source: "test:n", error: new AppError("Nope", "FORBIDDEN") });
    await recordError({ source: "test:n", error: withDigest("NEXT_REDIRECT;replace;/login;307;") });
    await recordError({ source: "test:n", error: withDigest("NEXT_NOT_FOUND") });
    await recordError({ source: "test:n", error: withDigest("NEXT_HTTP_ERROR_FALLBACK;404") });
    await recordError({ source: "test:n", error: new Error("x"), digest: "NEXT_REDIRECT;push;/staff;303;" });
    await recordError({ source: "test:n", error: Object.assign(new Error("The operation was aborted"), { name: "AbortError" }) });
    await recordError({ source: "test:n", error: Object.assign(new Error("aborted"), { code: "ECONNRESET" }) });
    await recordError({ source: "test:n", error: new Error("Request aborted") });
    // a visitor's old form after a deploy: the new server does not know its action (the owner saw this on the contact page): not a fault of the system
    await recordError({ source: "page:/(public)/[lang]/contact/page", error: new Error("Failed to find Server Action. This request might be from an older or newer deployment.") });
    await recordError({ source: "test:n", error: new Error('Failed to find Server Action "40abc". This request might be from an older or newer deployment.') });
    expect(await rows()).toHaveLength(0);
    // …but a real error right after is written
    await recordError({ source: "test:n", error: new Error("Something real") });
    expect(await rows()).toHaveLength(1);
  });

  // Built from pieces so the file itself never holds something that looks like a real payment key (the repository refuses those).
  const FAKE_KEY = ["sk", "live", "51HabcDEFghijKLMNOP123456"].join("_");

  it("keeps nothing personal: emails, phone numbers, keys, tokens, links' query strings, database addresses", async () => {
    const text =
      `Could not send to asha.juma@example.com (+255 712 345 678 / 0712345678): api_key=${FAKE_KEY} ` +
      "Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVPmB92K27uhbUJU1p1r_wW1gFWFOEjXk " +
      "token abcdefghijklmnopqrstuvwx1234 at https://api.callmebot.com/whatsapp.php?phone=255712345678&apikey=SECRET123&text=Hello%20Guest " +
      "using postgresql://neondb_owner:p4ssw0rd@ep-cool-123.eu-central-1.aws.neon.tech/neondb?sslmode=require";
    await recordError({ source: "test:privacy", error: new Error(text), path: "/staff/guests?phone=255712345678&q=asha#top" });
    const [r] = await rows();
    const stored = JSON.stringify(r);
    for (const secret of ["asha.juma", "example.com", "712 345 678", "0712345678", "255712345678", "sk_live", "eyJhbGci", "abcdefghijklmnopqrstuvwx1234", "SECRET123", "Hello", "p4ssw0rd", "neondb_owner", "ep-cool-123", "sslmode"]) {
      expect(stored, `"${secret}" must not be stored`).not.toContain(secret);
    }
    expect(r.message.length).toBeLessThanOrEqual(300);
    // the address of the page is not kept at all (a link can carry a guest's or an order's token)
    expect(r.detail as object).not.toHaveProperty("path");
    expect(stored).not.toContain("/staff/guests");
  });

  it("keeps from a failed database call only its name, its code and its reason, never the values it was given", async () => {
    await recordError({ source: "test:prisma", error: prismaError("P2002", "Unique constraint failed on the fields: (`phone`)") });
    const [r] = await rows();
    expect(r.message).toBe("PrismaClientKnownRequestError P2002: prisma.customer.create() failed — Unique constraint failed on the fields: (`phone`)");
    const stored = JSON.stringify(r);
    for (const value of ["+255712345678", "255712345678", "Asha", "Juma", "asha.juma", "example.com"]) expect(stored).not.toContain(value);
    expect(r.detail).toMatchObject({ name: "PrismaClientKnownRequestError", code: "P2002" });
  });

  it("does the same with a real failure from the real database (a second account with an existing email)", async () => {
    const role = await db.role.findUniqueOrThrow({ where: { code: "RECEPTIONIST" } });
    const error = await thrownBy(() => db.user.create({ data: { email: rec.email, fullName: "Zanele Mwakyusa Secretname", roleId: role.id, passwordHash: "not-a-real-hash-xyz" } }));
    expect(error).toBeTruthy();
    await recordError({ source: "test:real-prisma", error });
    const [r] = await rows();
    const stored = JSON.stringify(r);
    for (const value of [rec.email, "Zanele", "Secretname", "not-a-real-hash"]) expect(stored, value).not.toContain(value);
    expect(r.message).toMatch(/P2002/);
    const g = (await loadSystemEvents(await as(dev))).errorGroups.find((x) => x.source === "test:real-prisma");
    expect(g?.kind).toBe("Database");
  });

  it("keeps the top project frames as file:line only, no node_modules and no values", async () => {
    const e = new Error("boom");
    e.stack = [
      "Error: boom for asha@example.com",
      "    at readIt (/var/task/node_modules/@prisma/client/runtime/library.js:12:34)",
      "    at node:internal/process/task_queues:95:5",
      "    at loadGuest (/var/task/src/server/services/customers.ts:88:41)",
      "    at async webpack-internal:///(rsc)/./src/app/staff/guests/page.tsx:12:7",
      "    at loadGuest (/var/task/src/server/services/customers.ts:88:41)",
    ].join("\n");
    await recordError({ source: "test:frames", error: e });
    const [r] = await rows();
    expect((r.detail as { frames: string[] }).frames).toEqual(["src/server/services/customers.ts:88", "src/app/staff/guests/page.tsx:12"]);
    expect(JSON.stringify(r)).not.toContain("asha@example.com");
    expect(JSON.stringify(r)).not.toContain("node_modules");
  });

  it("holds only a role code of the person, never a name", async () => {
    await recordError({ source: "test:role", error: new Error("first thing"), role: "RECEPTIONIST" });
    await recordError({ source: "test:role", error: new Error("second thing"), role: "Asha Juma" });
    const all = await rows();
    expect((all[0].detail as { role?: string }).role).toBe("RECEPTIONIST");
    expect((all[1].detail as { role?: string }).role).toBeUndefined();
  });

  it("never throws when the write fails, stays quiet for a while, and the failing write is not itself recorded", async () => {
    await db.$executeRawUnsafe(`ALTER TABLE system_events RENAME TO system_events_off`);
    try {
      expect(await recordError({ source: "test:down", error: new Error("first") })).toBeUndefined();
      await expect(recordCronRun("/api/cron/daily-report", { ok: true, startedAt: new Date(), durationMs: 5 })).resolves.toBeUndefined();
      await expect(recordWebhook("ntzs", { ok: true })).resolves.toBeUndefined();
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE system_events_off RENAME TO system_events`);
    }
    // the table is back, but the recorder stays quiet for 30 seconds after a failed write: the caller is not slowed again
    await recordError({ source: "test:down", error: new Error("second") });
    expect(await rows({ kind: "ERROR" })).toHaveLength(0);
    resetSystemEventsLimits();
    await recordError({ source: "test:down", error: new Error("third") });
    expect(await rows({ kind: "ERROR" })).toHaveLength(1);
  });

  it("does not hold the caller when the database hangs: it comes back within the time limit, and the next call is instant", async () => {
    let waited = 0;
    await db.$transaction(async (tx) => {
      await tx.$executeRaw`LOCK TABLE system_events IN ACCESS EXCLUSIVE MODE`;
      const t0 = Date.now();
      await recordError({ source: "test:hang", error: new Error("hung") });
      waited = Date.now() - t0;
      const t1 = Date.now();
      await recordError({ source: "test:hang", error: new Error("hung again") });
      expect(Date.now() - t1).toBeLessThan(100);
    });
    expect(WRITE_TIMEOUT_MS).toBeLessThanOrEqual(1000);
    expect(waited).toBeGreaterThanOrEqual(WRITE_TIMEOUT_MS - 50);
    expect(waited).toBeLessThan(WRITE_TIMEOUT_MS + 700);
  }, 20_000);

  it("takes at most 30 NEW kinds of error a minute; a repeat still counts", async () => {
    for (let i = 0; i < NEW_ERRORS_PER_MINUTE + 12; i++) await recordError({ source: `test:flood:${i}`, error: new Error(`Flood ${"x".repeat(i + 1)}`) });
    expect(await rows({ kind: "ERROR" })).toHaveLength(NEW_ERRORS_PER_MINUTE);
    await recordError({ source: "test:flood:0", error: new Error(`Flood ${"x".repeat(1)}`) });
    const first = (await rows({ source: "test:flood:0" }))[0];
    expect(first.count).toBe(2);
    expect(await rows({ kind: "ERROR" })).toHaveLength(NEW_ERRORS_PER_MINUTE);
  }, 30_000);

  it("records what Next's request-error hook gives it: the kind of place, the route (without a query string), the router", async () => {
    await recordRequestError(new Error("render failed"), { path: "/staff/reservations/abc?token=zzz", method: "GET" }, { routerKind: "App Router", routePath: "/staff/reservations/[id]", routeType: "render", renderSource: "react-server-components" });
    await recordRequestError(new Error("route failed"), { path: "/api/x?y=1", method: "POST" }, { routerKind: "App Router", routePath: "/api/x", routeType: "route" });
    await recordRequestError(new Error("action failed"), { path: "/staff", method: "POST" }, { routerKind: "App Router", routePath: "/staff", routeType: "action" });
    const all = await rows();
    expect(all.map((r) => r.source).sort()).toEqual(["action:/staff", "page:/staff/reservations/[id]", "route:/api/x"]);
    const page = all.find((r) => r.source.startsWith("page:"))!;
    expect(page.detail).toMatchObject({ routerKind: "App Router", routeType: "render", renderSource: "react-server-components", method: "GET" });
    expect(page.detail as object).not.toHaveProperty("path");
    expect(JSON.stringify(page)).not.toContain("zzz");
  });

  it("instrumentation.ts: writes on the Node.js runtime, nothing anywhere else, and never throws", async () => {
    const req = { path: "/staff/home?x=1", method: "GET", headers: {} };
    const ctx = { routerKind: "App Router", routePath: "/staff/home", routeType: "render", renderSource: "react-server-components", renderType: "dynamic", revalidateReason: undefined } as const;
    const before = process.env.NEXT_RUNTIME;
    try {
      process.env.NEXT_RUNTIME = "edge";
      await onRequestError(new Error("on the edge"), req, ctx);
      expect(await rows()).toHaveLength(0);
      process.env.NEXT_RUNTIME = "nodejs";
      await onRequestError(new Error("in node"), req, ctx);
      expect((await rows()).map((r) => r.source)).toEqual(["page:/staff/home"]);
      await expect(onRequestError(undefined, undefined as never, undefined as never)).resolves.toBeUndefined();
    } finally {
      if (before === undefined) delete process.env.NEXT_RUNTIME; else process.env.NEXT_RUNTIME = before;
    }
  });

  it("a race that left two rows for one error: a repeat raises ONE of them, and the page adds them up (never counted twice)", async () => {
    const error = new Error("Same thing twice");
    await recordError({ source: "test:race", error });
    const [first] = await rows({ source: "test:race" });
    await db.systemEvent.create({ data: { kind: "ERROR", source: "test:race", fingerprint: first.fingerprint, status: "OPEN", message: first.message, count: 1, firstSeenAt: first.firstSeenAt, lastSeenAt: new Date(first.lastSeenAt.getTime() - 5_000) } });
    await recordError({ source: "test:race", error });
    const counts = (await rows({ source: "test:race" })).map((r) => r.count).sort();
    expect(counts).toEqual([1, 2]); // one row raised, the other left as it was
  });

  it("the same error reported twice at the same moment (a layout and its page) is ONE row with a count of 2", async () => {
    const error = new Error("Reported twice at once");
    await Promise.all([recordError({ source: "page:/twice", error }), recordError({ source: "page:/twice", error })]);
    const found = await rows({ source: "page:/twice" });
    expect(found).toHaveLength(1);
    expect(found[0].count).toBe(2);
  });

  it("the table never holds more than MAX_ERROR_ROWS different errors: a new kind is dropped, a repeat still counts", async () => {
    await recordError({ source: "test:cap", error: new Error("Known one") });
    const filler = Array.from({ length: MAX_ERROR_ROWS }, (_, i) => ({ kind: "ERROR", source: "test:fill", fingerprint: `fill-${i}`, status: "OPEN", message: "fill", count: 1 }));
    await db.systemEvent.createMany({ data: filler });
    await recordError({ source: "test:cap", error: new Error("Brand new kind") });
    expect(await rows({ source: "test:cap" })).toHaveLength(1);
    await recordError({ source: "test:cap", error: new Error("Known one") });
    expect((await rows({ source: "test:cap" }))[0].count).toBe(2);
    await db.systemEvent.deleteMany({ where: { source: "test:fill" } });
  }, 60_000);

  it("a server action's file is named only from a project file; the hosting's compiled chunk (its name changes with every release) is 'unknown'", () => {
    const compiled = Object.assign(new Error("x"), { stack: "Error: x\n    at doIt (/var/task/.next/server/chunks/ssr/[root-of-the-server]__a1b2c3._.js:412:9)" });
    expect(actionSourceOf(compiled)).toBe("action:unknown");
  });

  it("names the file of a server action from its stack", () => {
    const e = Object.assign(new Error("x"), { stack: "Error: x\n    at node:internal/a:1:1\n    at doIt (/var/task/src/app/staff/reservations/actions.ts:41:13)" });
    expect(actionSourceOf(e)).toBe("action:src/app/staff/reservations/actions.ts");
    expect(actionSourceOf(new Error("no frames"))).toMatch(/^action:/);
    expect(actionSourceOf(undefined)).toBe("action:unknown");
  });
});

// ───────────────────────────────────────────── the scrub, as pure functions ─────────────────────────────────────────────
describe("the scrub", () => {
  it("takes out emails, long numbers, keys, tokens, addresses and quoted values; keeps names of things and short numbers", () => {
    expect(scrubEventText("Mail asha@x.co failed")).toBe("Mail [email] failed");
    expect(scrubEventText("call +255 712 345 678 now")).toBe("call [number] now");
    expect(scrubEventText("order 12345 of 7 rooms")).toBe("order 12345 of 7 rooms");
    expect(scrubEventText("password: hunter2hunter2 failed")).toBe("password=[hidden] failed");
    expect(scrubEventText("id cm1abcdefghijklmnopqrstu9 bad")).toBe("id [token] bad");
    expect(scrubEventText("see https://u:p@host.example/a/b?token=1&x=2#frag")).toBe("see https://host.example/a/b");
    expect(scrubEventText("connect postgres://user:pw@h/db?sslmode=require")).toBe("connect [database address]");
    expect(scrubEventText("Key (email)=(someone@x.co) already exists.")).toBe("Key (email)=(…) already exists.");
    expect(scrubEventText("Unknown field 'fullName' and value 'Asha Juma'")).toBe("Unknown field 'fullName' and value '…'");
    expect(scrubEventText("Can't read the user's file")).toBe("Can't read the user's file");
    expect(scrubEventText("word ".repeat(200)).length).toBe(300);
    expect(scrubEventText("Report 2026-10-17 at 2026-10-18T10:15:30.123Z")).toBe("Report 2026-10-17 at 2026-10-18T10:15:30.123Z");
    expect(scrubEventText(null)).toBe("");
    expect(scrubEventText({ toString() { throw new Error("no"); } })).toBe("");
  });

  it("firstMeaningfulLine: the call and the reason for a database error, the first line for any other", () => {
    expect(firstMeaningfulLine(prismaError("P2002", "Unique constraint failed on the fields: (`phone`)").message)).toBe("prisma.customer.create() failed — Unique constraint failed on the fields: (`phone`)");
    expect(firstMeaningfulLine("Cannot read properties of undefined\n    at x")).toBe("Cannot read properties of undefined");
    expect(firstMeaningfulLine("")).toBe("");
    expect(firstMeaningfulLine(undefined)).toBe("");
  });

  it("errorFacts and stackFrames survive anything that can be thrown", () => {
    expect(errorFacts("just text")).toMatchObject({ name: "ThrownText", message: "just text" });
    expect(errorFacts({ code: "E1" })).toMatchObject({ name: "ThrownObject", code: "E1" });
    expect(errorFacts(undefined)).toMatchObject({ name: "ThrownValue", code: null });
    expect(errorFacts(Object.assign(new Error("x"), { cause: { code: "ECONNREFUSED" } })).code).toBe("ECONNREFUSED");
    expect(stackFrames(undefined)).toEqual([]);
    expect(stackFrames(42)).toEqual([]);
  });
});

// ───────────────────────────────────────────── the hints ─────────────────────────────────────────────
describe("the hints", () => {
  it("say, in plain words, what it means and what to do, by code, then name, then first line", () => {
    expect(errorHint({ code: "P2002" })).toMatchObject({ kind: "Database", what: expect.stringMatching(/duplicate/i) });
    expect(errorHint({ code: "P2024" }).what).toMatch(/slow, busy/);
    expect(errorHint({ code: "P2021" }).todo).toMatch(/migration/i);
    expect(errorHint({ name: "TypeError" }).kind).toBe("Code");
    // a failed network call is a TypeError too ("fetch failed"): it is the network, not a bug in the code
    expect(errorHint({ name: "TypeError", message: "TypeError: fetch failed" }).kind).toBe("Network");
    expect(errorHint({ name: "TypeError", code: "EAI_AGAIN", message: "fetch failed" }).kind).toBe("Network");
    expect(errorHint({ name: "TypeError", code: "UND_ERR_HEADERS_TIMEOUT" }).kind).toBe("Network");
    // the database REFUSED the second copy; nothing was written twice
    expect(errorHint({ code: "P2002" }).what).not.toMatch(/was written/);
    expect(errorHint({ name: "ZodError" }).kind).toBe("Validation");
    expect(errorHint({ name: "Error", message: "fetch failed" }).kind).toBe("Network");
    expect(errorHint({ code: "ECONNREFUSED" }).kind).toBe("Network");
    expect(errorHint({ name: "ForbiddenError" }).kind).toBe("Permission");
    expect(errorHint({ message: "Failed to find Server Action" }).what).toMatch(/old page/);
    expect(errorHint({ name: "Error", message: "something odd" }).kind).toBe("Unknown");
    expect(errorHint({}).kind).toBe("Unknown");
  });

  it("every kind is one of the six words, and every hint says WHO does what (the Developer, or the system owner)", () => {
    expect([...ERROR_KINDS]).toEqual(["Database", "Validation", "Permission", "Network", "Code", "Unknown"]);
    for (const input of [{ code: "P2002" }, { code: "P2024" }, { code: "P2025" }, { code: "P2021" }, { code: "P2003" }, { name: "TypeError" }, { name: "ZodError" }, { message: "fetch failed" }, { code: "ENOTFOUND" }, { name: "ForbiddenError" }, {}]) {
      const h = errorHint(input);
      expect(ERROR_KINDS).toContain(h.kind);
      expect(h.what.length).toBeGreaterThan(10);
      expect(h.todo).toMatch(/^Developer:/);
    }
    expect(errorHint({ code: "ENOTFOUND" }).todo).toMatch(/System owner/);
  });

  it("an inherited name is not a hint", () => {
    expect(errorHint({ name: "constructor", code: "toString" }).kind).toBe("Unknown");
  });
});

// ───────────────────────────────────────────── 3. jobs and webhooks ─────────────────────────────────────────────
describe("recordCronRun", () => {
  it("writes one row per run, ok or failed, with the start, the duration and a small summary", async () => {
    const t0 = new Date(Date.now() - 5_000);
    await recordCronRun("/api/cron/daily-report", {
      ok: true, startedAt: t0, durationMs: 1234.6,
      summary: { businessDate: "2026-10-17", generated: true, reportId: "cm1abcdefghijklmnopqrstu9", delivery: { sent: 2, failed: 0, ids: ["a", "b", "c"] }, note: "x".repeat(200), phone: "+255712345678", secret: undefined },
    });
    await recordCronRun("/api/cron/daily-report", { ok: false, startedAt: new Date(), durationMs: 80, error: prismaError("P2024", "Timed out fetching a new connection from the connection pool.") });
    const [ok, bad] = await rows({ kind: "CRON" });
    expect(ok).toMatchObject({ kind: "CRON", source: "/api/cron/daily-report", fingerprint: "/api/cron/daily-report", status: "OK", count: 1 });
    expect(ok.firstSeenAt.getTime()).toBe(t0.getTime());
    expect(ok.detail).toMatchObject({ durationMs: 1235, summary: { businessDate: "2026-10-17", generated: true, "delivery.sent": 2, "delivery.failed": 0, "delivery.idsCount": 3 } });
    const stored = JSON.stringify(ok);
    for (const gone of ["xxxxxxxx", "255712345678", "cm1abcdefghijklmnopqrstu9"]) expect(stored).not.toContain(gone);
    expect(bad).toMatchObject({ status: "FAILED" });
    expect(bad.message).toContain("PrismaClientKnownRequestError");
    expect(JSON.stringify(bad)).not.toContain("Asha");
  });

  it("never throws, not even for odd input", async () => {
    await expect(recordCronRun("/api/cron/x", { ok: true, startedAt: new Date("nope"), durationMs: NaN, summary: { a: BigInt(1) as never, b: { toString() { throw new Error("x"); } } as never } })).resolves.toBeUndefined();
  });
});

describe("recordWebhook", () => {
  it("writes one row per call: accepted, or failed with the kind of trouble, under the name webhook:<provider>", async () => {
    await recordWebhook("ntzs", { ok: true, kind: "payment paid", httpStatus: 200 });
    await recordWebhook("webhook:ntzs", { ok: false, kind: "payment not recorded", httpStatus: 500, error: prismaError("P2024", "Timed out fetching a new connection from the connection pool.") });
    const [a, b] = await rows({ kind: "WEBHOOK" });
    expect(a).toMatchObject({ source: "webhook:ntzs", status: "OK", count: 1 });
    expect(a.message).toBe("payment paid (200)");
    expect(b).toMatchObject({ source: "webhook:ntzs", status: "FAILED" });
    expect(b.message).toContain("payment not recorded (500)");
    expect(JSON.stringify(b)).not.toContain("Asha");
  });

  it("a refused signature (anyone can send one) is its own status, NOT a failure: one row per ten minutes, and it touches the database at most every 15 seconds", async () => {
    for (let i = 0; i < 25; i++) await recordWebhook("webhook:ntzs", { ok: false, kind: "signature", httpStatus: 401 });
    expect(await rows({ kind: "WEBHOOK", status: "FAILED" })).toHaveLength(0);
    let refused = await rows({ kind: "WEBHOOK", status: "REFUSED" });
    expect(refused).toHaveLength(1);
    expect(refused[0].count).toBe(1); // the other 24 never reached the database (a burst from the internet costs one write)
    for (let i = 0; i < 24; i++) { resetSystemEventsLimits(); await recordWebhook("webhook:ntzs", { ok: false, kind: "signature", httpStatus: 401 }); } // 15 seconds later each
    refused = await rows({ kind: "WEBHOOK", status: "REFUSED" });
    expect(refused).toHaveLength(1);
    expect(refused[0].count).toBe(25);
    await recordWebhook("webhook:ntzs", { ok: true, kind: "payment paid", httpStatus: 200 });
    expect(await rows({ kind: "WEBHOOK" })).toHaveLength(2);
  });

  it("never throws", async () => {
    await expect(recordWebhook(undefined as never, { ok: false, error: { toString() { throw new Error("x"); } } })).resolves.toBeUndefined();
  });
});

// ───────────────────────────────────────────── 4. purge ─────────────────────────────────────────────
describe("purgeSystemEvents", () => {
  const at = (now: Date, days: number) => new Date(now.getTime() - days * DAY);
  const put = (kind: string, source: string, lastSeenAt: Date) =>
    db.systemEvent.create({ data: { kind, source, fingerprint: `${kind}:${source}`, status: kind === "ERROR" ? "OPEN" : "OK", message: "m", firstSeenAt: lastSeenAt, lastSeenAt } });

  it("removes errors not seen for 30 days and runs / receipts older than 14 days, and nothing else", async () => {
    const now = new Date();
    await put("ERROR", "err-31d", at(now, 31));
    await put("ERROR", "err-29d", at(now, 29));
    await put("ERROR", "err-1d", at(now, 1));
    await put("CRON", "cron-15d", at(now, 15));
    await put("CRON", "cron-13d", at(now, 13));
    await put("WEBHOOK", "hook-15d", at(now, 15));
    await put("WEBHOOK", "hook-13d", at(now, 13));
    // an error seen 16 days ago is kept (errors live 30 days); a job run seen 16 days ago is not
    await put("ERROR", "err-16d", at(now, 16));
    await put("CRON", "cron-16d", at(now, 16));
    expect(await purgeSystemEvents(now)).toBe(4);
    expect((await rows()).map((r) => r.source).sort()).toEqual(["cron-13d", "err-16d", "err-1d", "err-29d", "hook-13d"]);
    expect(await purgeSystemEvents(now)).toBe(0);
  });

  it("an error seen again recently is kept even though it began long ago", async () => {
    const now = new Date();
    await db.systemEvent.create({ data: { kind: "ERROR", source: "old-but-back", fingerprint: "ob", status: "OPEN", message: "m", firstSeenAt: at(now, 40), lastSeenAt: at(now, 2), count: 9 } });
    expect(await purgeSystemEvents(now)).toBe(0);
  });
});

// ───────────────────────────────────────────── 5. what the Developer reads ─────────────────────────────────────────────
describe("loadSystemEvents", () => {
  it("refuses everyone but the Developer account", async () => {
    for (const [who, u] of [["Boss", boss], ["MD", md], ["Manager", mgr], ["Finance", fin], ["Reception", rec]] as const) {
      const user = await as(u);
      const err = await thrownBy(() => loadSystemEvents(user));
      expect(err, who).toBeInstanceOf(AppError);
      expect((err as AppError).code, who).toBe("FORBIDDEN");
    }
    // …not even the Developer while he works as someone else
    const developer = await as(dev);
    const asSomeone = { ...developer, workAs: { developerId: dev.id, developerName: "Events Dev", startedAt: new Date() } } as CurrentUser;
    expect(((await thrownBy(() => loadSystemEvents(asSomeone))) as AppError).code).toBe("FORBIDDEN");
    // …and the Developer himself is let in
    await expect(loadSystemEvents(developer)).resolves.toBeTruthy();
  });

  it("an empty system gives the documented shapes: no errors, both jobs from vercel.json, nTZS listed", async () => {
    const out = await loadSystemEvents(await as(dev), new Date());
    expect(out.errors24h).toBe(0);
    expect(out.errorGroups).toEqual([]);
    expect(out.jobs.map((j) => j.job).sort()).toEqual(["/api/cron/daily-report", "/api/cron/room-report"]);
    const daily = out.jobs.find((j) => j.job === "/api/cron/daily-report")!;
    const room = out.jobs.find((j) => j.job === "/api/cron/room-report")!;
    expect(daily).toMatchObject({ label: "Daily report and housekeeping", lastRunAt: null, lastOkAt: null, lastStatus: null, lastDurationMs: null, lastError: null });
    expect(room.label).toBe("Room report");
    // vercel.json is in UTC; the schedule is shown as the hotel's own clock (UTC+3)
    expect(daily.schedule).toBe("04:05 · 06:15 · 07:00 · 07:35 · 10:00 · 21:00 · 21:20");
    expect(room.schedule).toBe("06:30 · 06:50 · 08:00");
    // the longest gap between two scheduled runs: daily 07:00 → 21:00 UTC+3 is 11 h; the room report 08:00 → 06:30 is 22.5 h
    expect(daily.expectedEveryHours).toBe(11);
    expect(room.expectedEveryHours).toBe(22.5);
    expect(out.webhooks).toEqual([{ source: "webhook:ntzs", lastOkAt: null, lastFailedAt: null, failed7d: 0, ok7d: 0, refused7d: 0 }]);
  });

  it("lists the errors newest first, at most 30, each with its kind, the hint, the count and the frames", async () => {
    const now = new Date();
    for (let i = 0; i < 40; i++) {
      await db.systemEvent.create({
        data: {
          kind: "ERROR", source: `test:group:${i}`, fingerprint: `fp${i}`, status: "OPEN", message: `Error: number ${i}`, count: i + 1,
          firstSeenAt: new Date(now.getTime() - (i + 50) * 60_000), lastSeenAt: new Date(now.getTime() - i * 60_000),
          detail: { name: "PrismaClientKnownRequestError", code: "P2002", frames: ["src/a.ts:1", "src/b.ts:2"] },
        },
      });
    }
    const out = await loadSystemEvents(await as(dev), now);
    expect(out.errorGroups).toHaveLength(30);
    expect(out.errorGroups[0].source).toBe("test:group:0");
    expect(out.errorGroups[29].source).toBe("test:group:29");
    expect(out.errorGroups.map((g) => g.lastSeenAt.getTime())).toEqual([...out.errorGroups.map((g) => g.lastSeenAt.getTime())].sort((a, b) => b - a));
    expect(out.errorGroups[0]).toMatchObject({ kind: "Database", count: 1, frames: ["src/a.ts:1", "src/b.ts:2"], hint: { what: expect.stringMatching(/duplicate/), todo: expect.stringMatching(/^Developer:/) } });
    expect(out.errors24h).toBe(40);
  });

  it("counts, for the last 24 hours, the different errors that were seen — an old one seen again counts, a stale one does not; a repeated row counts once", async () => {
    const now = new Date();
    const put = (fp: string, lastSeenAt: Date) => db.systemEvent.create({ data: { kind: "ERROR", source: `s-${fp}`, fingerprint: fp, status: "OPEN", message: "m", count: 5, firstSeenAt: new Date(now.getTime() - 10 * DAY), lastSeenAt } });
    await put("a", new Date(now.getTime() - 2 * HOUR));
    await put("b", new Date(now.getTime() - 23 * HOUR));
    await put("c", new Date(now.getTime() - 25 * HOUR));
    await put("a", new Date(now.getTime() - 1 * HOUR)); // a second row of the same kind of error (a rare race): one group
    const out = await loadSystemEvents(await as(dev), now);
    expect(out.errors24h).toBe(2);
    expect(out.errorGroups).toHaveLength(3);
    expect(out.errorGroups.find((g) => g.source === "s-a")?.count).toBe(10);
  });

  describe("jobs", () => {
    const run = (job: string, status: "OK" | "FAILED", startedAt: Date, extra: { durationMs?: number; message?: string } = {}) =>
      db.systemEvent.create({ data: { kind: "CRON", source: job, fingerprint: job, status, message: extra.message ?? "Ran", detail: { durationMs: extra.durationMs ?? 900 }, firstSeenAt: startedAt, lastSeenAt: startedAt } });
    const daily = (o: Awaited<ReturnType<typeof loadSystemEvents>>) => o.jobs.find((j) => j.job === "/api/cron/daily-report")!;
    const DAILY = "/api/cron/daily-report";

    it("last run, last good run, last duration and last error come from the rows", async () => {
      const now = new Date();
      await run(DAILY, "OK", new Date(now.getTime() - 5 * HOUR), { durationMs: 4000 });
      await run(DAILY, "FAILED", new Date(now.getTime() - 1 * HOUR), { durationMs: 120, message: "PrismaClientKnownRequestError P2024: slow" });
      const j = daily(await loadSystemEvents(await as(dev), now));
      expect(j.lastRunAt?.getTime()).toBe(now.getTime() - HOUR);
      expect(j.lastOkAt?.getTime()).toBe(now.getTime() - 5 * HOUR);
      expect(j).toMatchObject({ lastStatus: "FAILED", lastDurationMs: 120, lastError: "PrismaClientKnownRequestError P2024: slow", overdue: false });
      await run(DAILY, "OK", new Date(now.getTime() - 10 * 60_000));
      const ok = daily(await loadSystemEvents(await as(dev), now));
      expect(ok).toMatchObject({ lastStatus: "OK", lastError: null });
    });

    it("overdue = no run at all for longer than 1.5 times the longest gap between its scheduled runs (11 h → 16.5 h)", async () => {
      const now = new Date();
      await run(DAILY, "OK", new Date(now.getTime() - 16 * HOUR));
      expect(daily(await loadSystemEvents(await as(dev), now)).overdue).toBe(false);
      await wipe();
      await run(DAILY, "OK", new Date(now.getTime() - 17 * HOUR));
      expect(daily(await loadSystemEvents(await as(dev), now)).overdue).toBe(true);
      // a run that FAILED is still a run: the job did run (the failure is shown on its own)
      await wipe();
      await run(DAILY, "FAILED", new Date(now.getTime() - 3 * HOUR));
      expect(daily(await loadSystemEvents(await as(dev), now)).overdue).toBe(false);
    });

    it("a job that has never been recorded is overdue once the recording has had time to see it run — not before", async () => {
      const real = new Date();
      // right now: the migration has just been applied to this test database — no run was due yet… unless it was applied long ago
      const inTheFuture = new Date(real.getTime() + 60 * DAY);
      expect(daily(await loadSystemEvents(await as(dev), inTheFuture)).overdue).toBe(true);
      const longBefore = new Date(real.getTime() - 60 * DAY);
      expect(daily(await loadSystemEvents(await as(dev), longBefore)).overdue).toBe(false);
    });
  });

  describe("webhooks", () => {
    it("last good, last failed, and the counts of the last 7 days (the refused signatures counted by their count)", async () => {
      const now = new Date();
      const put = (status: "OK" | "FAILED", ageH: number, count = 1) => db.systemEvent.create({ data: { kind: "WEBHOOK", source: "webhook:ntzs", fingerprint: "webhook:ntzs", status, message: "m", count, firstSeenAt: new Date(now.getTime() - ageH * HOUR), lastSeenAt: new Date(now.getTime() - ageH * HOUR) } });
      await put("OK", 2);
      await put("OK", 30);
      await put("OK", 10 * 24); // 10 days old: lastOkAt could be it, but it is not in the 7 days
      await put("FAILED", 5, 4);
      const w = (await loadSystemEvents(await as(dev), now)).webhooks.find((x) => x.source === "webhook:ntzs")!;
      expect(w.lastOkAt?.getTime()).toBe(now.getTime() - 2 * HOUR);
      expect(w.lastFailedAt?.getTime()).toBe(now.getTime() - 5 * HOUR);
      expect(w.ok7d).toBe(2);
      expect(w.failed7d).toBe(4);
    });

    it("a provider we did not list still appears once it has called", async () => {
      await recordWebhook("webhook:other", { ok: true });
      const out = await loadSystemEvents(await as(dev));
      expect(out.webhooks.map((x) => x.source).sort()).toEqual(["webhook:ntzs", "webhook:other"]);
    });
  });

  it("is read-only: reading writes nothing", async () => {
    await recordError({ source: "test:ro", error: new Error("ro") });
    const before = JSON.stringify(await rows());
    await loadSystemEvents(await as(dev));
    expect(JSON.stringify(await rows())).toBe(before);
  });
});

// ───────────────────────────────────────────── 6. runAction ─────────────────────────────────────────────
describe("runAction", () => {
  const GENERIC = "Something went wrong. Nothing was saved — please try again.";

  it("answers a message for the person (AppError) exactly as before, and writes nothing", async () => {
    const r = await runAction(async () => { throw new AppError("Room 12 is not ready.", "VALIDATION", { room: "Pick another" }); });
    expect(r).toEqual({ ok: false, error: "Room 12 is not ready.", code: "VALIDATION", fieldErrors: { room: "Pick another" } });
    expect(await rows()).toHaveLength(0);
  });

  it("answers the same generic words for an unexpected error, and now writes it down (without the values in it)", async () => {
    const r = await runAction(async () => { throw prismaError("P2002", "Unique constraint failed on the fields: (`phone`)"); });
    expect(r).toEqual({ ok: false, error: GENERIC });
    const all = await rows();
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ kind: "ERROR", source: expect.stringMatching(/^action:/), status: "OPEN" });
    expect(JSON.stringify(all[0])).not.toContain("Asha");
  });

  it("answers the same when the recorder cannot write (table missing)", async () => {
    await db.$executeRawUnsafe(`ALTER TABLE system_events RENAME TO system_events_off`);
    try {
      const t0 = Date.now();
      const r = await runAction(async () => { throw new Error("db is down"); });
      expect(r).toEqual({ ok: false, error: GENERIC });
      expect(Date.now() - t0).toBeLessThan(WRITE_TIMEOUT_MS + 1500);
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE system_events_off RENAME TO system_events`);
    }
  });

  it("still returns the data and the success message for a good action, and still rethrows Next's control flow without writing", async () => {
    expect(await runAction(async () => 41 + 1)).toEqual({ ok: true, data: 42 });
    expect(await runAction(async () => "saved", "Saved.")).toEqual({ ok: true, data: "saved", message: "Saved." });
    const redirect = Object.assign(new Error("NEXT_REDIRECT"), { digest: "NEXT_REDIRECT;replace;/staff;307;" });
    await expect(runAction(async () => { throw redirect; })).rejects.toBe(redirect);
    expect(await rows()).toHaveLength(0);
  });
});
