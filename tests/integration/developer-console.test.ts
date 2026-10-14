import { readdirSync } from "node:fs";
import path from "node:path";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});
// after(): outside a real request there is nothing to run it, so the test collects what was scheduled (and can make it fail).
const scheduled: Promise<unknown>[] = [];
const afterMode = { throws: false };
vi.mock("next/server", async (original) => ({
  ...(await original<typeof import("next/server")>()),
  after: (fn: () => unknown) => {
    if (afterMode.throws) throw new Error("after() was called outside a request");
    scheduled.push(Promise.resolve().then(fn));
  },
}));

import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { authorize, DEVELOPER_IDLE_MINUTES, DEVELOPER_SESSION_HOURS, getCurrentUser, requirePagePermission, type CurrentUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import {
  assertConsoleAccess, AUDIT_DEVELOPER_HREF, developerConsole, developerIdentity, inspectPermission, listInspectableUsers, recentDenied, systemDiagnostics,
} from "@/server/services/developer-console";
import { logDeveloperView, trackDeveloperView, trackDeveloperViewNow, VIEW_BURST_LIMIT, VIEW_LIMIT_ACTION } from "@/server/services/developer-view-log";
import { recordDeveloperView } from "@/app/staff/(app)/developer/actions";
import { HARMLESS_AREAS, HARMLESS_EXACT_PATHS, isHarmlessPath, isLoggedPath } from "@/lib/developer-paths";
import { DEVELOPER_DENIED, PERMISSIONS } from "@/lib/permissions";
import { auditOf, browser, makeSession, makeUser, redirectOf, removeMadeUsers, setRole, sha256, thrownBy, type MadeUser } from "../support/developer";

/**
 * The Developer console and the record of a Developer's visits (owner, 2026-10-14), against a real database:
 *   1. only the Developer account gets in — every staff role (the Boss and the MD too) is refused by the page guard and by every service call;
 *   2. the console shows the identity, the counts and the health of the system — and never a secret (fake secrets are put in the environment and must not appear);
 *   3. the permission inspector answers yes / no, names the role that gives the right, lists the person's rights — and every look is in the audit trail;
 *   4. a Developer's visits are written for EVERY page except a few plainly harmless ones, once per page per 10 minutes — nobody else is written;
 *      the safety valve writes one marker and never goes silent; a failed write leaves a line in the server log.
 */

let dev: MadeUser;
let dev2: MadeUser;
let rec: MadeUser;
let boss: MadeUser;
let md: MadeUser;
let mgr: MadeUser;
let fin: MadeUser;
const everyone = () => [dev, dev2, rec, boss, md, mgr, fin];

/** Sign in as this account (a new browser with a real session) — the user as the app reads it, and the session's hash. */
async function as(u: MadeUser, session: Parameters<typeof makeSession>[1] = {}) {
  browser.reset();
  const token = await makeSession(u.id, session);
  const user = (await getCurrentUser()) as CurrentUser;
  return { user, hash: sha256(token) };
}

const ENV_KEYS = ["NTZS_API_KEY", "NTZS_WEBHOOK_SECRET", "NTZS_USER_ID", "CRON_SECRET", "CALLMEBOT_API_KEY", "CALLMEBOT_KEY_TESTA", "CALLMEBOT_KEY_TESTB", "VERCEL_GIT_COMMIT_SHA", "VERCEL_ENV"] as const;
const savedEnv: Record<string, string | undefined> = {};
let savedRecipients: unknown;

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Dev Console" });
  dev2 = await makeUser("DEVELOPER", { fullName: "Dev Console Two" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Asha Console" });
  boss = await makeUser("OWNER", { fullName: "Boss Console" });
  md = await makeUser("ADMIN", { fullName: "MD Console" });
  mgr = await makeUser("MANAGER", { fullName: "Manager Console" });
  fin = await makeUser("FINANCE", { fullName: "Finance Console" });
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  savedRecipients = (await db.hotelSettings.findUnique({ where: { id: 1 } }))?.reportRecipients;
});
afterAll(async () => {
  for (const k of ENV_KEYS) { if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k]; }
  if (savedRecipients !== undefined) await db.hotelSettings.update({ where: { id: 1 }, data: { reportRecipients: savedRecipients as never } }).catch(() => undefined);
  await removeMadeUsers();
});
beforeEach(async () => {
  browser.reset();
  scheduled.length = 0;
  afterMode.throws = false;
  for (const k of ENV_KEYS) delete process.env[k];
  await db.session.deleteMany({ where: { userId: { in: everyone().map((u) => u.id) } } });
});
afterEach(() => {
  for (const k of ENV_KEYS) delete process.env[k];
});

// ───────────────────────────────────────────── 1. only the Developer gets in ─────────────────────────────────────────────
describe("the door: the Developer account only", () => {
  it("the session limits the console reports are the ones the app enforces (4 hours, 30 minutes)", () => {
    expect([DEVELOPER_SESSION_HOURS, DEVELOPER_IDLE_MINUTES]).toEqual([4, 30]);
  });

  it("the Developer passes the page guard and holds the right and the account type", async () => {
    const { user } = await as(dev);
    const guarded = await requirePagePermission("developer.access");
    expect(guarded.id).toBe(dev.id);
    expect(user.actorType).toBe("DEVELOPER");
    expect(() => assertConsoleAccess(user)).not.toThrow();
  });

  it.each([["receptionist", () => rec], ["Boss", () => boss], ["MD", () => md], ["manager", () => mgr], ["Finance", () => fin]])("the %s is sent to the 'forbidden' page and no service call answers them", async (_name, who) => {
    const { user, hash } = await as(who());
    expect(await redirectOf(() => requirePagePermission("developer.access"))).toBe("/staff/forbidden");
    expect(user.permissions.has("developer.access")).toBe(false);
    for (const call of [
      () => developerConsole(user, hash),
      () => developerIdentity(user, hash),
      () => systemDiagnostics(user),
      () => recentDenied(user),
      () => listInspectableUsers(user),
      () => inspectPermission(user, { userId: rec.id, code: "reservations.view" }),
    ]) {
      const e = await thrownBy(call);
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("FORBIDDEN");
    }
    // a refused staff member leaves nothing in the Developer's trail: no inspection was written for them
    expect(await auditOf(who().id, "developer.inspected")).toHaveLength(0);
    expect(await auditOf(who().id, "developer.denied")).toHaveLength(0);
  });

  it("the right alone is not enough, and neither is the account type alone", () => {
    const perms = new Set(["developer.access"]) as CurrentUser["permissions"];
    expect(() => assertConsoleAccess({ actorType: "STAFF", permissions: perms })).toThrow(AppError);
    expect(() => assertConsoleAccess({ actorType: "DEVELOPER", permissions: new Set() as CurrentUser["permissions"] })).toThrow(AppError);
    expect(() => assertConsoleAccess({ actorType: "DEVELOPER", permissions: perms })).not.toThrow();
  });

  it("a Developer's refusals are kept and shown (page and action), a staff member's are not", async () => {
    await as(dev);
    browser.headers.set("x-pathname", "/staff/finance/withdrawals");
    expect(await redirectOf(() => requirePagePermission("finance.manage"))).toBe("/staff/forbidden");
    const action = await thrownBy(() => authorize("payments.record"));
    expect((action as AppError).code).toBe("FORBIDDEN");

    const { user } = await as(dev);
    const rows = await recentDenied(user);
    const page = rows.find((r) => r.kind === "page" && r.path === "/staff/finance/withdrawals");
    expect(page).toMatchObject({ who: dev.fullName, needs: [{ code: "finance.manage", description: PERMISSIONS["finance.manage"] }] });
    expect(rows.find((r) => r.kind === "action" && r.needs[0]?.code === "payments.record")).toBeTruthy();

    // a receptionist refused the same page leaves no "denied" entry
    await as(rec);
    await redirectOf(() => requirePagePermission("finance.manage"));
    expect(await auditOf(rec.id, "developer.denied")).toHaveLength(0);
  });
});

// ───────────────────────────────────────────── 2. identity ─────────────────────────────────────────────
describe("who you are", () => {
  it("name, role, rights and the money rights not held — all of them, in plain words", async () => {
    const { user, hash } = await as(dev, { createdMinAgo: 10, seenMinAgo: 1 });
    const id = await developerIdentity(user, hash);
    expect(id).toMatchObject({ name: dev.fullName, accountType: "Developer", roleCode: "DEVELOPER", rightsCount: user.permissions.size, heldButDenied: [] });
    expect(id.notHeld.map((r) => r.code).sort()).toEqual([...DEVELOPER_DENIED].sort());
    for (const r of id.notHeld) expect(r.description).toBe(PERMISSIONS[r.code as keyof typeof PERMISSIONS]);
    expect(id.reason.length).toBeGreaterThan(20);
  });

  it("a money right that somehow is held is reported, not hidden", async () => {
    const { user, hash } = await as(dev);
    const drifted = { ...user, permissions: new Set([...user.permissions, "payments.record" as const]) } as CurrentUser;
    const id = await developerIdentity(drifted, hash);
    expect(id.heldButDenied).toEqual(["payments.record"]);
    expect(id.notHeld.map((r) => r.code)).not.toContain("payments.record");
  });

  it("time left: the idle limit comes first on a young session, the 4-hour limit on an old one", async () => {
    const young = await as(dev, { createdMinAgo: 30, seenMinAgo: 5 });
    // Reading the session (as() does it to get the user) keeps a Developer's "last seen" fresh, so set the quiet 5 minutes back afterwards.
    await db.session.update({ where: { tokenHash: young.hash }, data: { lastSeenAt: new Date(Date.now() - 5 * 60_000) } });
    const a = (await developerIdentity(young.user, young.hash)).session!;
    expect(a.endsBecause).toBe("idle");
    expect(a.minutesLeft).toBeGreaterThanOrEqual(24);
    expect(a.minutesLeft).toBeLessThanOrEqual(25);
    expect(a.startedAt.getTime()).toBeLessThan(Date.now() - 29 * 60_000);
    expect([a.limitHours, a.idleMinutes]).toEqual([4, 30]);

    const old = await as(dev, { createdMinAgo: 230, seenMinAgo: 1 });
    const b = (await developerIdentity(old.user, old.hash)).session!;
    expect(b.endsBecause).toBe("limit");
    expect(b.minutesLeft).toBeGreaterThanOrEqual(9);
    expect(b.minutesLeft).toBeLessThanOrEqual(10);

    // never negative
    const ended = await developerIdentity(old.user, old.hash, new Date(Date.now() + 5 * 3600_000));
    expect(ended.session!.minutesLeft).toBe(0);
  });

  it("another account's session is never described as yours, and an unknown one gives no session", async () => {
    const mine = await as(dev);
    const other = await as(dev2);
    expect((await developerIdentity(mine.user, other.hash)).session).toBeNull();
    expect((await developerIdentity(mine.user, null)).session).toBeNull();
    expect((await developerIdentity(mine.user, sha256("not-a-session"))).session).toBeNull();
  });
});

// ───────────────────────────────────────────── 3. system checks ─────────────────────────────────────────────
describe("system checks: counters and yes / no", () => {
  const created = { shifts: [] as string[], withdrawals: [] as string[], deliveries: [] as string[] };
  afterAll(async () => {
    await db.actualShift.deleteMany({ where: { id: { in: created.shifts } } });
    await db.withdrawal.deleteMany({ where: { id: { in: created.withdrawals } } });
    await db.notificationDelivery.deleteMany({ where: { id: { in: created.deliveries } } });
  });

  it("the database answers and the migrations are counted (the latest one is the newest folder)", async () => {
    const { user } = await as(dev);
    const d = await systemDiagnostics(user);
    expect(d.database.reachable).toBe(true);
    const folders = readdirSync(path.join(process.cwd(), "prisma", "migrations")).filter((f) => /^\d{14}_/.test(f)).sort();
    expect(d.migrations).toEqual({ applied: folders.length, failed: 0, latest: folders.at(-1) });
  });

  it("staff accounts are counted by role (active only, the online-payments system account never)", async () => {
    const { user } = await as(dev);
    const before = await systemDiagnostics(user);
    const a = await makeUser("RECEPTIONIST", { fullName: "Count A" });
    await makeUser("RECEPTIONIST", { fullName: "Count B" });
    await makeUser("RECEPTIONIST", { fullName: "Count C inactive", isActive: false });
    const after = await systemDiagnostics(user);
    const n = (d: typeof before) => d.counts!.staffByRole.find((r) => r.code === "RECEPTIONIST")?.count ?? 0;
    expect(n(after)).toBe(n(before) + 2);
    expect(after.counts!.staffTotal).toBe(before.counts!.staffTotal + 2);
    expect(after.counts!.staffByRole.map((r) => r.code)).not.toContain("SYSTEM_ONLINE");
    expect(a.id).toBeTruthy();
  });

  it("open shifts, withdrawals not settled and failed messages (last 24 hours) are counted", async () => {
    const { user } = await as(dev);
    const before = (await systemDiagnostics(user)).counts!;

    const waiter = await makeUser("RECEPTIONIST", { fullName: "Shift Count" });
    const shift = await db.actualShift.create({ data: { userId: waiter.id, department: "RESTAURANT", businessDate: new Date("2026-10-14") } });
    created.shifts.push(shift.id);
    const base = { amount: 10_000, destinationKind: "PHONE", requestedById: waiter.id, businessDate: new Date("2026-10-14") };
    for (const status of ["UNKNOWN", "SUBMITTING", "PROCESSING", "COMPLETED"] as const) created.withdrawals.push((await db.withdrawal.create({ data: { ...base, status } })).id);
    const delivery = { purpose: "DAILY_REPORT", channel: "WHATSAPP_CALLMEBOT" };
    for (const [i, extra] of [
      { status: "FAILED" as const },
      { status: "FAILED" as const, updatedAt: new Date(Date.now() - 48 * 3600_000) }, // old: not counted
      { status: "SENT" as const },
    ].entries()) created.deliveries.push((await db.notificationDelivery.create({ data: { ...delivery, recipient: `+25570000000${i}`, ...extra } })).id);

    const after = (await systemDiagnostics(user)).counts!;
    expect(after.openShifts).toBe(before.openShifts + 1);
    expect(after.unsettledWithdrawals).toBe(before.unsettledWithdrawals + 2); // UNKNOWN + SUBMITTING
    expect(after.failedMessages24h).toBe(before.failedMessages24h + 1);

    await db.actualShift.update({ where: { id: shift.id }, data: { endedAt: new Date() } });
    expect((await systemDiagnostics(user)).counts!.openShifts).toBe(before.openShifts);
  });

  it("nTZS, cron and CallMeBot show only whether something is set; the deployment shows the short commit", async () => {
    const { user } = await as(dev);
    expect(await systemDiagnostics(user)).toMatchObject({
      ntzs: { configured: false, live: false, webhookSecret: false }, cron: { secretConfigured: false }, deployment: { commit: null, environment: expect.any(String) },
    });

    process.env.NTZS_API_KEY = "ntzs_test_aaaa";
    process.env.NTZS_WEBHOOK_SECRET = "whsec_aaaa";
    process.env.CRON_SECRET = "cron-aaaa";
    process.env.VERCEL_GIT_COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
    process.env.VERCEL_ENV = "preview";
    let d = await systemDiagnostics(user);
    expect(d.ntzs).toEqual({ configured: true, live: false, webhookSecret: true });
    expect(d.cron).toEqual({ secretConfigured: true });
    expect(d.deployment).toEqual({ commit: "0123456", environment: "preview" });

    process.env.NTZS_API_KEY = "ntzs_live_aaaa";
    process.env.VERCEL_ENV = "something-odd";
    d = await systemDiagnostics(user);
    expect(d.ntzs.live).toBe(true);
    expect(d.deployment.environment).not.toBe("something-odd");
  });

  it("report recipients: ready when their own key (or the default key) is set", async () => {
    const { user } = await as(dev);
    await db.hotelSettings.update({ where: { id: 1 }, data: { reportRecipients: [{ name: "A", phone: "+255700000001", apiKeyRef: "CALLMEBOT_KEY_TESTA" }, { name: "B", phone: "+255700000002", apiKeyRef: "CALLMEBOT_KEY_TESTB" }] } });
    expect((await systemDiagnostics(user)).whatsapp).toEqual({ defaultKey: false, recipients: 2, recipientsReady: 0 });
    process.env.CALLMEBOT_KEY_TESTA = "secret-a";
    expect((await systemDiagnostics(user)).whatsapp).toEqual({ defaultKey: false, recipients: 2, recipientsReady: 1 });
    process.env.CALLMEBOT_API_KEY = "secret-default";
    expect((await systemDiagnostics(user)).whatsapp).toEqual({ defaultKey: true, recipients: 2, recipientsReady: 2 });
  });

  it("NOTHING secret is in what the console returns — fake secrets put in the environment never appear", async () => {
    const secrets = {
      NTZS_API_KEY: "ntzs_live_SECRETKEY_111", NTZS_WEBHOOK_SECRET: "whsec_SECRETWEBHOOK_222", NTZS_USER_ID: "ntzs-user-SECRET-333", CRON_SECRET: "cron-SECRETCRON-444",
      CALLMEBOT_API_KEY: "SECRETDEFAULTKEY-555", CALLMEBOT_KEY_TESTA: "SECRETRECIPIENTKEY-666", VERCEL_GIT_COMMIT_SHA: "abcdef0123456789abcdef0123456789abcdef01",
    };
    Object.assign(process.env, secrets, { VERCEL_ENV: "production" });
    await db.hotelSettings.update({ where: { id: 1 }, data: { reportRecipients: [{ name: "A", phone: "+255700000001", apiKeyRef: "CALLMEBOT_KEY_TESTA" }] } });

    const { user, hash } = await as(dev);
    await db.session.update({ where: { tokenHash: hash }, data: { lastSeenAt: new Date() } });
    const everything = JSON.stringify({
      console: await developerConsole(user, hash),
      inspection: await inspectPermission(user, { userId: rec.id, code: "reservations.view" }),
    });
    for (const [name, value] of Object.entries(secrets)) {
      if (name === "VERCEL_GIT_COMMIT_SHA") { expect(everything).toContain("abcdef0"); expect(everything).not.toContain(value); continue; }
      expect(everything, name).not.toContain(value);
    }
    expect(everything).not.toMatch(/SECRET(KEY|WEBHOOK|CRON|DEFAULTKEY|RECIPIENTKEY)|SECRET-333/); // not even the middle of one
    // not the database address either, and no stored password or session hash
    expect(everything).not.toContain(process.env.DATABASE_URL!);
    expect(everything).not.toContain(hash);
    expect(everything).not.toMatch(/passwordHash|tokenHash|pinHash|apiKey|argon2/i);
    // and the yes / no answers are right
    expect(JSON.parse(everything).console.diagnostics).toMatchObject({ ntzs: { configured: true, live: true, webhookSecret: true }, cron: { secretConfigured: true }, whatsapp: { defaultKey: true } });
  });

  it("the page's one call returns everything the page shows, and the people list holds only a name, a role and a flag", async () => {
    const { user, hash } = await as(dev);
    const data = await developerConsole(user, hash);
    expect(data.auditHref).toBe(AUDIT_DEVELOPER_HREF);
    expect(AUDIT_DEVELOPER_HREF).toBe("/staff/audit?who=DEVELOPER");
    expect(data.denied.length).toBeLessThanOrEqual(20);
    expect(data.rights.length).toBe(Object.keys(PERMISSIONS).length);
    expect(data.people.some((p) => p.id === dev.id)).toBe(true);
    // people: a name, a role and a flag — nothing else
    expect(Object.keys(data.people[0]).sort()).toEqual(["active", "id", "name", "roleName"]);
  });
});

// ───────────────────────────────────────────── 4. refusals list ─────────────────────────────────────────────
describe("the last refusals", () => {
  const wrote = async (n: number, extra: { after?: unknown } = {}) => {
    for (let i = 0; i < n; i++) {
      await audit(db, { userId: dev2.id, label: dev2.fullName }, { action: "developer.denied", entityType: "Permission", entityId: "x", after: extra.after ?? { kind: "page", needs: ["settings.manage"], path: `/staff/settings/cap${i}` } });
    }
  };

  it("20 at most, newest first; a smaller limit is honoured; the number is capped at 100", async () => {
    const { user } = await as(dev);
    await wrote(22);
    const rows = await recentDenied(user);
    expect(rows).toHaveLength(20);
    expect(rows[0].path).toBe("/staff/settings/cap21");
    for (let i = 1; i < rows.length; i++) expect(rows[i - 1].at.getTime()).toBeGreaterThanOrEqual(rows[i].at.getTime());
    expect(await recentDenied(user, 3)).toHaveLength(3);
    expect((await recentDenied(user, 5000)).length).toBeLessThanOrEqual(100);
  });

  it("an entry with no detail (or odd detail) is still listed, never an error", async () => {
    const { user } = await as(dev);
    await audit(db, { userId: dev2.id, label: dev2.fullName }, { action: "developer.denied", entityType: "Permission", entityId: "x" });
    await wrote(1, { after: { kind: 7, needs: "not-a-list", path: { a: 1 } } });
    const [odd, none] = await recentDenied(user, 2);
    expect(odd).toMatchObject({ kind: null, path: null, needs: [] });
    expect(none).toMatchObject({ kind: null, path: null, needs: [] });
    // a right name the list does not know is shown as its code only (never an inherited property such as "constructor")
    await wrote(1, { after: { kind: "page", needs: ["constructor", "no.such.right"], path: "/staff/x" } });
    expect((await recentDenied(user, 1))[0].needs).toEqual([{ code: "constructor", description: null }, { code: "no.such.right", description: null }]);
  });
});

// ───────────────────────────────────────────── 5. inspector ─────────────────────────────────────────────
describe("who can do what", () => {
  // A right the receptionist role does not hold (read from the database, as the inspector does).
  let lacking = "";
  let receptionistRights = 0;
  beforeAll(async () => {
    const held = new Set((await db.rolePermission.findMany({ where: { role: { code: "RECEPTIONIST" } }, select: { permission: { select: { code: true } } } })).map((p) => p.permission.code));
    receptionistRights = held.size;
    lacking = (Object.keys(PERMISSIONS) as (keyof typeof PERMISSIONS)[]).find((c) => !held.has(c) && c !== "developer.access")!;
  });

  it("yes: the role that gives the right is named, the roles that hold it and the person's full list are shown", async () => {
    const { user } = await as(dev);
    const r = await inspectPermission(user, { userId: rec.id, code: "reservations.view" });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.has).toBe(true);
    expect(r.person).toMatchObject({ id: rec.id, name: rec.fullName, roleCode: "RECEPTIONIST", active: true });
    expect(r.grantedBy).toMatchObject({ code: "RECEPTIONIST" });
    expect(r.rolesWithRight.map((x) => x.code)).toContain("RECEPTIONIST");
    expect(r.right).toMatchObject({ code: "reservations.view", description: PERMISSIONS["reservations.view"], developerOnly: false, developerMoneyRight: false });
    expect(r.rights.map((x) => x.code)).toEqual([...r.rights.map((x) => x.code)].sort());
    expect(r.rights.map((x) => x.code)).toContain("reservations.view");
    expect(r.rights.length).toBe(receptionistRights);
    expect(r.rights.length).toBeGreaterThan(0);
  });

  it("no: nobody gives it to this person, and the roles that hold it are listed", async () => {
    const { user } = await as(dev);
    const r = await inspectPermission(user, { userId: rec.id, code: lacking });
    expect(r.ok && r.has).toBe(false);
    if (!r.ok) return;
    expect(r.grantedBy).toBeNull();
    expect(r.rolesWithRight.length).toBeGreaterThan(0);
    expect(r.rights.map((x) => x.code)).not.toContain(lacking);
  });

  it("the Developer-only right belongs to the Developer role alone; the Boss and the MD do not hold it", async () => {
    const { user } = await as(dev);
    const forDev = await inspectPermission(user, { userId: dev.id, code: "developer.access" });
    expect(forDev).toMatchObject({ ok: true, has: true, grantedBy: { code: "DEVELOPER" }, right: { developerOnly: true }, rolesWithRight: [{ code: "DEVELOPER" }] });
    for (const who of [boss, md]) expect(await inspectPermission(user, { userId: who.id, code: "developer.access" })).toMatchObject({ ok: true, has: false, grantedBy: null });
  });

  it("a money-writing right: the Developer does not hold it, and the answer says it is by design", async () => {
    const { user } = await as(dev);
    for (const code of DEVELOPER_DENIED) {
      const r = await inspectPermission(user, { userId: dev.id, code });
      expect(r).toMatchObject({ ok: true, has: false, right: { developerMoneyRight: true } });
    }
  });

  it("a person who is switched off is shown as not active", async () => {
    const { user } = await as(dev);
    const off = await makeUser("MANAGER", { fullName: "Switched Off", isActive: false });
    const r = await inspectPermission(user, { userId: off.id, code: "reservations.view" });
    expect(r).toMatchObject({ ok: true, person: { active: false } });
  });

  it("an unknown person or right (or nothing chosen) is a plain problem, never an error and never a guess", async () => {
    const { user } = await as(dev);
    expect(await inspectPermission(user, { userId: "no-such-person", code: "reservations.view" })).toMatchObject({ ok: false, problem: "That person was not found." });
    expect(await inspectPermission(user, { userId: rec.id, code: "made.up" })).toMatchObject({ ok: false, problem: "Choose a right from the list." });
    for (const code of ["constructor", "toString", "__proto__", "hasOwnProperty"]) expect(await inspectPermission(user, { userId: rec.id, code }), code).toMatchObject({ ok: false, problem: "Choose a right from the list." });
    expect(await inspectPermission(user, { userId: "", code: "reservations.view" })).toMatchObject({ ok: false, problem: "Choose a person." });
  });

  it("every inspection — a yes, a no and a failed one — is in the audit trail as a Developer action", async () => {
    const { user } = await as(dev2);
    const before = (await auditOf(dev2.id, "developer.inspected")).length;
    browser.headers.set("x-forwarded-for", "41.1.2.3");
    await inspectPermission(user, { userId: rec.id, code: "reservations.view" }, { ipAddress: "41.1.2.3" });
    await inspectPermission(user, { userId: rec.id, code: lacking }, { ipAddress: "41.1.2.3" });
    await inspectPermission(user, { userId: "ghost", code: "reservations.view" }, { ipAddress: "41.1.2.3" });
    const rows = (await auditOf(dev2.id, "developer.inspected")).slice(before);
    expect(rows).toHaveLength(3);
    for (const r of rows) expect([r.actorType, r.actorRole, r.ipAddress]).toEqual(["DEVELOPER", "DEVELOPER", "41.1.2.3"]);
    expect(rows.map((r) => (r.after as { ok: boolean }).ok)).toEqual([true, true, false]);
    expect(rows[0].after).toMatchObject({ right: "reservations.view", answer: "yes", role: "RECEPTIONIST", person: rec.fullName });
    expect(rows[1].after).toMatchObject({ right: lacking, answer: "no" });
    expect(rows[2].after).toMatchObject({ problem: "That person was not found." });
    expect(rows[0].entityId).toBe(rec.id);
  });

  it("the list of people holds everyone, switched-off accounts last, with nothing but name, role and a flag", async () => {
    const { user } = await as(dev);
    const people = await listInspectableUsers(user);
    expect(people.find((p) => p.id === rec.id)).toMatchObject({ name: rec.fullName, roleName: expect.any(String), active: true });
    const firstOff = people.findIndex((p) => !p.active);
    if (firstOff >= 0) expect(people.slice(firstOff).every((p) => !p.active)).toBe(true);
  });

  it("role changes are seen at once (the answer comes from the database, not a cache)", async () => {
    const { user } = await as(dev);
    const moved = await makeUser("RECEPTIONIST", { fullName: "Moves Role" });
    expect(await inspectPermission(user, { userId: moved.id, code: lacking })).toMatchObject({ ok: true, has: false });
    await setRole(moved.id, "OWNER");
    expect(await inspectPermission(user, { userId: moved.id, code: lacking })).toMatchObject({ ok: true, has: true, grantedBy: { code: "OWNER" } });
  });
});

// ───────────────────────────────────────────── 6. view logging ─────────────────────────────────────────────
describe("a Developer's visits: which pages count", () => {
  it.each(HARMLESS_AREAS)("%s, and anything under it, is harmless (never written)", (p) => {
    for (const x of [p, `${p}/`, `${p}/some/deeper/page`, `${p}?tab=1&x=2`]) {
      expect(isHarmlessPath(x), x).toBe(true);
      expect(isLoggedPath(x), x).toBe(false);
    }
    expect(isLoggedPath(`${p}x`)).toBe(true); // a different page that only starts with the same letters
  });

  it("the home redirect and the public home are harmless — but only exactly, nothing under them", () => {
    for (const p of HARMLESS_EXACT_PATHS) {
      expect(isLoggedPath(p), p).toBe(false);
      expect(isLoggedPath(`${p}/`), p).toBe(false);
    }
    expect(isLoggedPath("/staff/anything")).toBe(true);
    expect(isLoggedPath("/login/x")).toBe(true);
  });

  it("every other page is written — the ones the old list missed, the sensitive ones, and a page that does not exist yet", () => {
    const pages = [
      "/admin", "/admin/dashboard", "/manager/dashboard", "/reception/dashboard", "/finance", "/finance/dashboard",
      "/staff/sales", "/staff/corporate", "/staff/corporate/abc/statement", "/staff/groups", "/staff/guests", "/staff/guests/42", "/staff/reservations", "/staff/reservations/9/proforma",
      "/staff/shifts", "/staff/shifts/all", "/staff/restaurant/collections", "/staff/restaurant/history", "/staff/hotel-qr", "/staff/messages", "/staff/activity",
      "/staff/finance", "/staff/payments", "/staff/expenses", "/staff/reports", "/staff/users", "/staff/settings", "/staff/audit", "/staff/developer", "/staff/accountant",
      "/staff/procurement", "/staff/collections", "/staff/invoices", "/staff/cash-handover", "/staff/rooms", "/staff/rooms/12", "/staff/restaurant/orders", "/staff/check-in",
      "/staff/start-shift", "/staff/a-page-built-next-year", "/rooms", "/en/book",
    ];
    for (const p of pages) expect(isLoggedPath(p), p).toBe(true);
  });

  it("no address at all is nothing to write", () => {
    for (const p of ["", "   ", null, undefined]) expect(isLoggedPath(p), String(p)).toBe(false);
  });

  it("an address cannot be dressed up as a harmless page (codes, dots, double slashes), and one that cannot be read is written", () => {
    for (const p of ["/staff/account/../users", "/staff/%61ccount/../finance", "/staff//login/../settings", "/staff/./forbidden/../audit/", "/staff/reports%2Fdaily", "/staff/%E0%A4%A", "/staff/login%2F..%2Fusers"]) expect(isLoggedPath(p), p).toBe(true);
    // ...and the harmless pages stay harmless however they are spelled
    for (const p of ["/staff/%61ccount", "/staff//account/", "/staff/./login", "/staff/account/../account?x=1"]) expect(isLoggedPath(p), p).toBe(false);
  });
});

describe("a Developer's visits: what is written", () => {
  const viewed = (userId: string, p?: string) => db.auditLog.findMany({ where: { userId, action: "developer.viewed", ...(p ? { entityId: p } : {}) }, orderBy: { createdAt: "asc" } });

  it("a visit to a sensitive page is one Developer entry: who, when, which page, from where", async () => {
    const u = await makeUser("DEVELOPER", { fullName: "Viewer One" });
    const p = "/staff/finance/online";
    expect(await logDeveloperView({ id: u.id, fullName: u.fullName, actorType: "DEVELOPER" }, p, { ipAddress: "41.7.7.7" })).toBe("logged");
    const [row] = await viewed(u.id);
    expect(row).toMatchObject({ entityType: "Page", entityId: p, actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: u.fullName, ipAddress: "41.7.7.7", after: { path: p } });
    expect(Math.abs(row.createdAt.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("the same page again within 10 minutes is not written again — wherever the query or a trailing slash differs; after 10 minutes it is", async () => {
    const u = await makeUser("DEVELOPER", { fullName: "Viewer Two" });
    const me = { id: u.id, fullName: u.fullName, actorType: "DEVELOPER" as const };
    expect(await logDeveloperView(me, "/staff/users")).toBe("logged");
    expect(await logDeveloperView(me, "/staff/users")).toBe("repeat");
    expect(await logDeveloperView(me, "/staff/users/?q=a")).toBe("repeat");
    expect(await logDeveloperView(me, "/staff/users", { now: new Date(Date.now() + 9 * 60_000) })).toBe("repeat");
    expect(await viewed(u.id)).toHaveLength(1);
    expect(await logDeveloperView(me, "/staff/users", { now: new Date(Date.now() + 11 * 60_000) })).toBe("logged");
    expect(await viewed(u.id)).toHaveLength(2);
    // another page is its own entry
    expect(await logDeveloperView(me, "/staff/settings")).toBe("logged");
    expect(await viewed(u.id, "/staff/settings")).toHaveLength(1);
  });

  it("the 10 minutes are counted for each Developer separately", async () => {
    const one = await makeUser("DEVELOPER", { fullName: "Viewer Three" });
    const two = await makeUser("DEVELOPER", { fullName: "Viewer Four" });
    expect(await logDeveloperView({ id: one.id, fullName: one.fullName, actorType: "DEVELOPER" }, "/staff/audit")).toBe("logged");
    expect(await logDeveloperView({ id: two.id, fullName: two.fullName, actorType: "DEVELOPER" }, "/staff/audit")).toBe("logged");
  });

  it("a harmless page is not written; every other page is — a Developer's look at Reservations or the Rooms board included; and a staff member's visit is never written, whatever the page", async () => {
    const u = await makeUser("DEVELOPER", { fullName: "Viewer Five" });
    const me = { id: u.id, fullName: u.fullName, actorType: "DEVELOPER" as const };
    expect(await logDeveloperView(me, "/staff/account")).toBe("harmless");
    expect(await logDeveloperView(me, "/staff/login")).toBe("harmless");
    expect(await logDeveloperView(me, null)).toBe("harmless");
    expect(await viewed(u.id)).toHaveLength(0);
    for (const p of ["/staff/reservations", "/staff/guests", "/staff/sales", "/manager/dashboard", "/staff/restaurant/history", "/staff/a-page-built-next-year"]) expect(await logDeveloperView(me, p), p).toBe("logged");
    expect((await viewed(u.id)).map((r) => r.entityId).sort()).toEqual(["/staff/reservations", "/staff/guests", "/staff/sales", "/manager/dashboard", "/staff/restaurant/history", "/staff/a-page-built-next-year"].sort());
    for (const who of [rec, boss, md, mgr, fin]) {
      expect(await logDeveloperView({ id: who.id, fullName: who.fullName, actorType: "STAFF" }, "/staff/finance")).toBe("not-developer");
      expect(await viewed(who.id)).toHaveLength(0);
    }
  });

  it("two requests for the same page at the same moment make one entry, not two", async () => {
    const u = await makeUser("DEVELOPER", { fullName: "Viewer Six" });
    const me = { id: u.id, fullName: u.fullName, actorType: "DEVELOPER" as const };
    const results = await Promise.all(Array.from({ length: 8 }, () => logDeveloperView(me, "/staff/payments")));
    expect(results.filter((r) => r === "logged")).toHaveLength(1);
    expect(results.filter((r) => r === "repeat")).toHaveLength(7);
    expect(await viewed(u.id, "/staff/payments")).toHaveLength(1);
  });

  it("a flood of different addresses is stopped at the limit — and the trail says so, once (never silent)", async () => {
    const u = await makeUser("DEVELOPER", { fullName: "Viewer Seven" });
    const me = { id: u.id, fullName: u.fullName, actorType: "DEVELOPER" as const };
    await db.auditLog.createMany({
      data: Array.from({ length: VIEW_BURST_LIMIT }, (_, i) => ({ userId: u.id, actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: u.fullName, action: "developer.viewed", entityType: "Page", entityId: `/staff/users/flood${i}`, businessDate: new Date("2026-10-14") })),
    });
    const markers = () => db.auditLog.findMany({ where: { userId: u.id, action: VIEW_LIMIT_ACTION } });
    expect(await logDeveloperView(me, "/staff/users/one-more")).toBe("limit");
    expect(await viewed(u.id)).toHaveLength(VIEW_BURST_LIMIT); // the visit itself is not written...
    const found = await markers();
    expect(found).toHaveLength(1); // ...but ONE marker is
    const [marker] = found;
    expect(marker).toMatchObject({ actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: u.fullName, entityType: "Page", entityId: null, after: { limit: VIEW_BURST_LIMIT, windowMinutes: 10 } });
    // more pages in the same window: still nothing written, still one marker
    expect(await logDeveloperView(me, "/staff/users/two-more")).toBe("limit");
    expect(await logDeveloperView(me, "/staff/settings")).toBe("limit");
    // at the same moment, many requests: one marker
    const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => logDeveloperView(me, `/staff/finance/x${i}`)));
    expect(burst.every((r) => r === "limit")).toBe(true);
    expect(await markers()).toHaveLength(1);
    expect(await viewed(u.id)).toHaveLength(VIEW_BURST_LIMIT);
    // a repeat of a page already written is a repeat, not a flood
    expect(await logDeveloperView(me, "/staff/users/flood3")).toBe("repeat");
  });

  it("the limit is counted for each Developer; a staff member's entries and a Developer's other entries never count toward it", async () => {
    const a = await makeUser("DEVELOPER", { fullName: "Viewer Nine" });
    const b = await makeUser("DEVELOPER", { fullName: "Viewer Ten" });
    await db.auditLog.createMany({
      data: Array.from({ length: VIEW_BURST_LIMIT }, (_, i) => ({ userId: a.id, actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: a.fullName, action: "developer.viewed", entityType: "Page", entityId: `/staff/users/f${i}`, businessDate: new Date("2026-10-14") })),
    });
    expect(await logDeveloperView({ id: b.id, fullName: b.fullName, actorType: "DEVELOPER" }, "/staff/users")).toBe("logged");
    expect(await db.auditLog.count({ where: { userId: b.id, action: VIEW_LIMIT_ACTION } })).toBe(0);
    // exports and inspections do not use up the page valve
    await db.auditLog.createMany({
      data: Array.from({ length: VIEW_BURST_LIMIT }, (_, i) => ({ userId: b.id, actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: b.fullName, action: "developer.exported", entityType: "Report", entityId: `r${i}`, businessDate: new Date("2026-10-14") })),
    });
    expect(await logDeveloperView({ id: b.id, fullName: b.fullName, actorType: "DEVELOPER" }, "/staff/settings")).toBe("logged");
  });

  it("an address that cannot be read is still noted (better logged than missed), once", async () => {
    const u = await makeUser("DEVELOPER", { fullName: "Viewer Eight" });
    const me = { id: u.id, fullName: u.fullName, actorType: "DEVELOPER" as const };
    expect(await logDeveloperView(me, "/staff/%E0%A4%A")).toBe("logged");
    expect(await logDeveloperView(me, "/staff/%E0%A4%A")).toBe("repeat");
    expect((await viewed(u.id))[0].entityId).toBe("(unreadable address)");
  });
});

describe("a Developer's visits: from a page, a layout and an action", () => {
  const viewed = (userId: string) => db.auditLog.findMany({ where: { userId, action: "developer.viewed" } });
  const settle = () => Promise.all(scheduled.splice(0));

  it("the layout hook reads the address on the server and writes after the page (the caller is not made to wait)", async () => {
    const u = await makeUser("DEVELOPER", { fullName: "Hook One" });
    browser.reset("41.50.60.70");
    browser.headers.set("x-pathname", "/staff/settings/pricing");
    await trackDeveloperView({ id: u.id, fullName: u.fullName, actorType: "DEVELOPER" });
    expect(scheduled).toHaveLength(1);
    await settle();
    const rows = await viewed(u.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ entityId: "/staff/settings/pricing", ipAddress: "41.50.60.70", actorType: "DEVELOPER" });
  });

  it("it schedules nothing for a harmless page, for staff, or when no address is known — and it does schedule for any other page, the Rooms board too", async () => {
    const u = await makeUser("DEVELOPER", { fullName: "Hook Two" });
    const me = { id: u.id, fullName: u.fullName, actorType: "DEVELOPER" as const };
    browser.headers.set("x-pathname", "/staff/account");
    await trackDeveloperView(me);
    browser.headers.delete("x-pathname");
    await trackDeveloperView(me);
    browser.headers.set("x-pathname", "/staff/finance");
    await trackDeveloperView({ id: rec.id, fullName: rec.fullName, actorType: "STAFF" });
    expect(scheduled).toHaveLength(0);
    browser.headers.set("x-pathname", "/staff/rooms");
    await trackDeveloperView(me);
    expect(scheduled).toHaveLength(1);
    await settle();
    expect((await viewed(u.id)).map((r) => r.entityId)).toEqual(["/staff/rooms"]);
  });

  it("a failure while writing is swallowed (the page is never broken) but leaves a line in the server log; so does after() itself failing", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      browser.headers.set("x-pathname", "/staff/finance");
      await trackDeveloperView({ id: "no-such-account", fullName: "Ghost", actorType: "DEVELOPER" });
      expect(scheduled).toHaveLength(1);
      await expect(settle()).resolves.toBeDefined(); // the write failed (no such account) — and nothing rejects
      expect(log).toHaveBeenCalledTimes(1);
      const [line, detail] = log.mock.calls[0];
      expect(String(line)).toContain("could not write a page visit");
      expect(detail).toMatchObject({ developerId: "no-such-account", path: "/staff/finance" });
      // nothing but ids and names in the log line: no cookie, no password, no token
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/cookie|password|token|secret/i);

      log.mockClear();
      afterMode.throws = true;
      await expect(trackDeveloperView({ id: dev.id, fullName: dev.fullName, actorType: "DEVELOPER" })).resolves.toBeUndefined();
      expect(log).toHaveBeenCalledTimes(1);
      expect(String(log.mock.calls[0][0])).toContain("could not note a page visit");

      // the action writes at once: a failure is answered with null, and traced
      afterMode.throws = false;
      log.mockClear();
      expect(await trackDeveloperViewNow({ id: "no-such-account", fullName: "Ghost", actorType: "DEVELOPER" })).toBeNull();
      expect(log).toHaveBeenCalledTimes(1);
    } finally {
      log.mockRestore();
    }
  });

  it("the server action takes no address from the browser: it notes the page this request is for, for a Developer only", async () => {
    const u = await makeUser("DEVELOPER", { fullName: "Action One" });
    await as(u);
    browser.headers.set("x-pathname", "/staff/reports/daily");
    await recordDeveloperView();
    await recordDeveloperView(); // the second call in the same 10 minutes writes nothing
    expect((await viewed(u.id)).map((r) => r.entityId)).toEqual(["/staff/reports/daily"]);
    expect(await trackDeveloperViewNow({ id: rec.id, fullName: rec.fullName, actorType: "STAFF" })).toBeNull();

    // staff and a signed-out browser: nothing is written, nothing breaks
    await as(boss);
    browser.headers.set("x-pathname", "/staff/finance");
    await expect(recordDeveloperView()).resolves.toBeUndefined();
    expect(await viewed(boss.id)).toHaveLength(0);
    browser.reset();
    browser.headers.set("x-pathname", "/staff/finance");
    await expect(recordDeveloperView()).resolves.toBeUndefined();
  });
});
