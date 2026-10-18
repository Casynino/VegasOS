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
  assertConsoleAccess, AUDIT_DEVELOPER_HREF, CONSOLE_HREF, CONSOLE_TABS, developerGreeting, developerIdentity, firstNameOf, inspectPermission, listInspectableUsers, myActions, parseTab,
  peopleTab, recentDenied, settingsTab, systemDiagnostics,
} from "@/server/services/developer-console";
import { activityData, ACTIVITY_DAYS, crashData, healthReport, LOGIN_LIMITS, moduleWords, speedData } from "@/server/services/developer-health";
import { businessDayConfig, getSettings } from "@/server/settings";
import { addDays, businessDateOf, toDbDate, zonedInstant } from "@/lib/time/business-date";
import { renderToStaticMarkup } from "react-dom/server";
import DeveloperHomePage from "@/app/staff/(app)/developer/page";
import { logDeveloperView, trackDeveloperView, trackDeveloperViewNow, VIEW_BURST_LIMIT, VIEW_LIMIT_ACTION } from "@/server/services/developer-view-log";
import { recordDeveloperView } from "@/app/staff/(app)/developer/actions";
import { HARMLESS_AREAS, HARMLESS_EXACT_PATHS, isHarmlessPath, isLoggedPath } from "@/lib/developer-paths";
import { DEVELOPER_ACCOUNT_RIGHTS, DEVELOPER_DENIED, PERMISSIONS } from "@/lib/permissions";
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
  browser.reset(); // no browser is "working as" anyone while the accounts are removed
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
      () => developerGreeting(user),
      () => healthReport(user),
      () => activityData(user),
      () => speedData(user),
      () => crashData(user),
      () => settingsTab(user, hash),
      () => peopleTab(user),
      () => myActions(user),
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
    // "Rights you do not hold" lists the right to manage accounts too, and says in its own words why
    expect(id.notHeld.map((r) => r.code)).toContain("users.manage");
    expect(id.accountsReason).toContain("cannot create or change accounts, passwords, login emails, roles or rights");
  });

  it("the right to manage accounts that somehow is held is reported too, not hidden", async () => {
    const { user, hash } = await as(dev);
    const drifted = { ...user, permissions: new Set([...user.permissions, "users.manage" as const]) } as CurrentUser;
    const id = await developerIdentity(drifted, hash);
    expect(id.heldButDenied).toEqual(["users.manage"]);
    expect(id.notHeld.map((r) => r.code)).not.toContain("users.manage");
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
    expect(d.migrations).toEqual({ applied: folders.length, failed: 0, rolledBack: 0, latest: folders.at(-1) });
    expect(d.database.ms).toBeGreaterThan(0);
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
      console: {
        greeting: await developerGreeting(user), health: await healthReport(user), activity: await activityData(user), speed: await speedData(user), crashes: await crashData(user),
        settings: await settingsTab(user, hash), people: await peopleTab(user), diagnostics: await systemDiagnostics(user), identity: await developerIdentity(user, hash),
      },
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
    expect(JSON.parse(everything).console.settings.config).toMatchObject({ ntzs: { configured: true, live: true, webhookSecret: true }, cron: { secretConfigured: true }, whatsapp: { defaultKey: true } });
  });

  it("the people list holds only a name, a role and a flag, and the console's links are the Developer's own pages", async () => {
    const { user } = await as(dev);
    const data = await peopleTab(user);
    expect(AUDIT_DEVELOPER_HREF).toBe("/staff/developer/audit");
    expect(CONSOLE_HREF).toEqual({ home: "/staff/developer", audit: "/staff/developer/audit", business: "/staff/developer/business", access: "/staff/developer/access" });
    expect(data.rights.length).toBe(Object.keys(PERMISSIONS).length);
    expect(data.people.some((p) => p.id === dev.id)).toBe(true);
    // people: a name, a role and a flag — nothing else
    expect(Object.keys(data.people[0]).sort()).toEqual(["active", "id", "name", "roleName"]);
    expect(data.myActions.length).toBeLessThanOrEqual(30);
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
    for (const code of DEVELOPER_DENIED.filter((c) => !DEVELOPER_ACCOUNT_RIGHTS.includes(c))) {
      const r = await inspectPermission(user, { userId: dev.id, code });
      expect(r).toMatchObject({ ok: true, has: false, right: { developerMoneyRight: true, developerAccountRight: false } });
    }
  });

  it("the right to manage accounts: the Developer does not hold it (owner, 2026-10-18), and the answer says it is about accounts — not money", async () => {
    const { user } = await as(dev);
    expect(DEVELOPER_ACCOUNT_RIGHTS).toEqual(["users.manage"]);
    for (const code of DEVELOPER_ACCOUNT_RIGHTS) {
      const r = await inspectPermission(user, { userId: dev.id, code });
      expect(r).toMatchObject({ ok: true, has: false, right: { code, developerMoneyRight: false, developerAccountRight: true } });
      if (r.ok) expect(r.rolesWithRight.map((x) => x.code).sort()).toEqual(["ADMIN", "OWNER"]);
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
    for (const p of ["/staff/%6Cogin", "/staff//login/", "/staff/./forbidden", "/staff/forbidden/../forbidden?x=1"]) expect(isLoggedPath(p), p).toBe(false);
  });

  it("the account page is NOT harmless: while a Developer works as someone it shows that person's profile, phone, email and sessions with devices and addresses — it is written, however it is spelled", () => {
    for (const p of ["/staff/account", "/staff/account/", "/staff/%61ccount", "/staff//account/", "/staff/account/../account?x=1", "/staff/account/anything"]) expect(isLoggedPath(p), p).toBe(true);
    expect(HARMLESS_AREAS).not.toContain("/staff/account");
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
    expect(await logDeveloperView(me, "/staff/forbidden")).toBe("harmless");
    expect(await logDeveloperView(me, "/staff/login")).toBe("harmless");
    expect(await logDeveloperView(me, null)).toBe("harmless");
    expect(await viewed(u.id)).toHaveLength(0);
    const pages = ["/staff/account", "/staff/reservations", "/staff/guests", "/staff/sales", "/manager/dashboard", "/staff/restaurant/history", "/staff/a-page-built-next-year"];
    for (const p of pages) expect(await logDeveloperView(me, p), p).toBe("logged");
    expect((await viewed(u.id)).map((r) => r.entityId).sort()).toEqual([...pages].sort());
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

  it("a flood of different addresses never erases evidence: past the (generous) limit ONE marker is written, and every distinct page is STILL written, compactly, once", async () => {
    expect(VIEW_BURST_LIMIT).toBe(1000);
    const u = await makeUser("DEVELOPER", { fullName: "Viewer Seven" });
    const me = { id: u.id, fullName: u.fullName, actorType: "DEVELOPER" as const };
    await db.auditLog.createMany({
      data: Array.from({ length: VIEW_BURST_LIMIT }, (_, i) => ({ userId: u.id, actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: u.fullName, action: "developer.viewed", entityType: "Page", entityId: `/staff/users/flood${i}`, businessDate: new Date("2026-10-14") })),
    });
    const markers = () => db.auditLog.findMany({ where: { userId: u.id, action: VIEW_LIMIT_ACTION } });
    // the 1001st page: the valve is shut — and the visit is written anyway
    expect(await logDeveloperView(me, "/staff/users/one-more")).toBe("logged-over-limit");
    expect(await viewed(u.id)).toHaveLength(VIEW_BURST_LIMIT + 1);
    const found = await markers();
    expect(found).toHaveLength(1); // ONE marker for the window
    const [marker] = found;
    expect(marker).toMatchObject({ actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: u.fullName, entityType: "Page", entityId: null, after: { limit: VIEW_BURST_LIMIT, windowMinutes: 10 } });
    const [late] = await viewed(u.id, "/staff/users/one-more");
    expect(late).toMatchObject({ actorType: "DEVELOPER", actorLabel: u.fullName, after: { path: "/staff/users/one-more", overLimit: true } });
    // more pages in the same window: each one is written (compact), still one marker
    expect(await logDeveloperView(me, "/staff/users/two-more")).toBe("logged-over-limit");
    expect(await logDeveloperView(me, "/staff/settings")).toBe("logged-over-limit");
    // at the same moment, many requests: one marker, and every distinct page is there once
    const burst = await Promise.all(Array.from({ length: 6 }, (_, i) => logDeveloperView(me, `/staff/finance/x${i}`)));
    expect(burst.every((r) => r === "logged-over-limit")).toBe(true);
    expect(await markers()).toHaveLength(1);
    expect(await viewed(u.id)).toHaveLength(VIEW_BURST_LIMIT + 1 + 2 + 6);
    // the same page again is a repeat (at most once per page per 10 minutes) — before and after the limit alike
    expect(await logDeveloperView(me, "/staff/users/flood3")).toBe("repeat");
    expect(await logDeveloperView(me, "/staff/settings")).toBe("repeat");
    expect(await viewed(u.id, "/staff/settings")).toHaveLength(1);
  });

  it("past the limit the OTHER entries are untouched: exports, downloads and the work-as start / end are never counted by the valve and never held back by it", async () => {
    const { logDeveloperExport } = await import("@/server/services/developer-view-log");
    const u = await makeUser("DEVELOPER", { fullName: "Viewer Valve" });
    const me = { id: u.id, fullName: u.fullName, actorType: "DEVELOPER" as const };
    await db.auditLog.createMany({
      data: Array.from({ length: VIEW_BURST_LIMIT }, (_, i) => ({ userId: u.id, actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: u.fullName, action: "developer.viewed", entityType: "Page", entityId: `/staff/valve/${i}`, businessDate: new Date("2026-10-14") })),
    });
    expect(await logDeveloperView(me, "/staff/valve/next")).toBe("logged-over-limit");
    expect(await logDeveloperExport(me, { kind: "exported", module: "Report", entityId: "daily", after: { path: "/api/x" } })).toBe(true);
    expect(await logDeveloperExport(me, { kind: "downloaded", module: "StoredFile", entityId: "f1", after: {} })).toBe(true);
    expect(await db.auditLog.count({ where: { userId: u.id, action: { in: ["developer.exported", "developer.downloaded"] } } })).toBe(2);
    // the work-as entries are written through audit() directly (they are not visits): the valve does not know them
    await audit(db, { userId: u.id, label: u.fullName }, { action: "developer.work_as_started", entityType: "User", entityId: null, after: { targetName: "X" } });
    await audit(db, { userId: u.id, label: u.fullName }, { action: "developer.work_as_ended", entityType: "User", entityId: null, after: { targetName: "X" } });
    expect(await db.auditLog.count({ where: { userId: u.id, action: { in: ["developer.work_as_started", "developer.work_as_ended"] } } })).toBe(2);
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
    browser.headers.set("x-pathname", "/staff/forbidden");
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

// ═════════════════════════════════════════════ the home (owner, 2026-10-17) ═════════════════════════════════════════════
// Time is passed in, so the windows are tested on days far in the future, where no other test has written anything.
const TZ_NOW = new Date("2042-03-15T10:00:00Z"); // 13:00 hotel time: the hotel day is 2042-03-15
const TODAY = "2042-03-15";
let cfg: ReturnType<typeof businessDayConfig>;
const dayBack = (n: number) => addDays(TODAY, -n);
/** The instant of a wall-clock time at the hotel on a calendar date. */
const local = (date: string, hhmm: string) => zonedInstant(date, Number(hhmm.slice(0, 2)) * 60 + Number(hhmm.slice(3)), cfg.timezone);

/** An entry written at an exact instant, its hotel day taken from the app's own rule (businessDateOf). */
async function put(at: Date, f: { action: string; userId?: string | null; type?: string; role?: string | null; entityType?: string; entityId?: string | null; ip?: string | null }) {
  return db.auditLog.create({ data: {
    userId: f.userId ?? null, actorLabel: "t", actorType: f.type ?? "STAFF", actorRole: f.role ?? null, action: f.action, entityType: f.entityType ?? "Reservation",
    entityId: f.entityId ?? null, ipAddress: f.ip ?? null, businessDate: toDbDate(businessDateOf(at, cfg)), createdAt: at,
  } });
}
/** Entries in the far future are removed again (the audit trail forbids deleting — its maintenance door is opened for this transaction only). */
async function wipeFuture() {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('vegas.audit_maintenance', 'on', true)`;
    await tx.auditLog.deleteMany({ where: { createdAt: { gte: new Date("2042-01-01T00:00:00Z") } } });
    await tx.$executeRaw`SELECT set_config('vegas.audit_maintenance', 'off', true)`;
  });
}

describe("the home: greeting and tabs", () => {
  it("the tab comes from the address; anything unknown (or nothing, or a list) is the first tab", () => {
    expect([...CONSOLE_TABS]).toEqual(["activity", "speed", "crashes", "settings", "people"]);
    for (const tab of CONSOLE_TABS) expect(parseTab(tab)).toBe(tab);
    expect(parseTab(undefined)).toBe("activity");
    expect(parseTab("")).toBe("activity");
    expect(parseTab("audit")).toBe("activity");
    expect(parseTab("__proto__")).toBe("activity");
    expect(parseTab(["speed", "crashes"])).toBe("speed");
  });

  it("the first name is the first word, without a '(Developer)' tag", () => {
    expect(firstNameOf("Nino")).toBe("Nino");
    expect(firstNameOf("Nino Casmiry (Developer)")).toBe("Nino");
    expect(firstNameOf("  (Developer)  ")).toBe("(Developer)");
  });

  it("good morning / afternoon / evening by the HOTEL's clock, with the hotel's own calendar date", async () => {
    const { user } = await as(dev);
    const at = async (iso: string) => developerGreeting(user, new Date(iso));
    expect((await at("2042-03-15T01:59:00Z")).partOfDay).toBe("evening");   // 04:59, still the small hours
    expect((await at("2042-03-15T02:00:00Z")).partOfDay).toBe("morning");   // 05:00
    expect((await at("2042-03-15T02:59:00Z")).partOfDay).toBe("morning");   // 05:59
    expect((await at("2042-03-15T05:30:00Z")).partOfDay).toBe("morning");   // 08:30
    expect((await at("2042-03-15T08:59:00Z")).partOfDay).toBe("morning");   // 11:59
    expect((await at("2042-03-15T09:00:00Z")).partOfDay).toBe("afternoon"); // 12:00
    expect((await at("2042-03-15T13:59:00Z")).partOfDay).toBe("afternoon"); // 16:59
    expect((await at("2042-03-15T14:00:00Z")).partOfDay).toBe("evening");   // 17:00
    const late = await at("2042-03-15T21:30:00Z");                           // 00:30 on the 16th at the hotel
    expect(late.partOfDay).toBe("evening");
    expect(late.today).toBe("2042-03-16");
    expect(await at("2042-03-15T20:59:00Z")).toMatchObject({ today: "2042-03-15" }); // 23:59 is still the 15th
    const g = await at("2042-03-15T10:00:00Z");
    expect(g.firstName).toBe(firstNameOf(dev.fullName));
    expect(g.hotelName).toBe((await getSettings()).hotelName);
    expect(g.timezone).toBe((await getSettings()).timezone);
  });
});

describe("activity: the charts' data", () => {
  let user: CurrentUser;
  beforeAll(async () => {
    cfg = businessDayConfig(await getSettings());
  });
  beforeEach(async () => {
    await wipeFuture();
    user = (await as(dev)).user;
  });
  afterAll(async () => { await wipeFuture(); });

  it("sign-ins per day: 14 hotel days, oldest first, ending today, stacked by the role at the time; the 15th day back is left out", async () => {
    const login = (day: string, hhmm: string, who: MadeUser, role: string) => put(local(day, hhmm), { action: "auth.login", userId: who.id, role, entityType: "User", entityId: who.id });
    await login(TODAY, "09:00", rec, "RECEPTIONIST");
    await login(TODAY, "09:05", rec, "RECEPTIONIST");
    await login(TODAY, "09:10", mgr, "MANAGER");
    await login(dayBack(1), "09:00", fin, "FINANCE");
    await login(dayBack(13), "10:00", mgr, "MANAGER");
    await login(dayBack(13), "11:00", dev, "DEVELOPER");
    await login(dayBack(14), "10:00", mgr, "MANAGER"); // outside the window

    const a = await activityData(user, TZ_NOW);
    expect(a.today).toBe(TODAY);
    expect(a.days).toHaveLength(ACTIVITY_DAYS);
    expect([a.days[0], a.days.at(-1)]).toEqual([dayBack(13), TODAY]);
    const perDay = a.signInsPerDay!;
    expect(perDay.map((d) => d.date)).toEqual(a.days);
    expect(perDay.at(-1)).toMatchObject({ date: TODAY, total: 3, byRole: { RECEPTIONIST: 2, MANAGER: 1 } });
    expect(perDay.at(-2)).toMatchObject({ date: dayBack(1), total: 1, byRole: { FINANCE: 1 } });
    expect(perDay[0]).toMatchObject({ date: dayBack(13), total: 2, byRole: { MANAGER: 1, DEVELOPER: 1 } });
    expect(perDay.reduce((n, d) => n + d.total, 0)).toBe(6);
    // the legend: roles that signed in, the most first (ties by code), with their names
    expect(a.roles.map((r) => r.code)).toEqual(["MANAGER", "RECEPTIONIST", "DEVELOPER", "FINANCE"]);
    expect(a.roles.find((r) => r.code === "MANAGER")!.name).toBe("Manager");
    // the four cards: 3 sign-ins and 2 people in the last 24 hours; 3 people in 7 days
    expect(a.stats).toMatchObject({ signIns24h: 3, peopleSignedIn24h: 2, peopleSignedIn7d: 3 });
  });

  it("actions per day: the team and the Developer apart; sign-ins, looking, refusals and the system's own work are not actions", async () => {
    const at = (hhmm: string, day = TODAY) => local(day, hhmm);
    await put(at("08:00"), { action: "reservation.created", userId: rec.id });
    await put(at("08:10"), { action: "reservation.created", userId: rec.id });
    await put(at("08:20"), { action: "payment.recorded", userId: fin.id, entityType: "Payment" });
    await put(at("08:30"), { action: "user.updated", userId: dev.id, type: "DEVELOPER", entityType: "User" });
    for (const action of ["developer.viewed", "developer.inspected", "developer.denied", "developer.viewed_limit"]) await put(at("08:40"), { action, userId: dev.id, type: "DEVELOPER" });
    for (const action of ["auth.login", "auth.logout"]) await put(at("08:50"), { action, userId: rec.id });
    await put(at("08:55"), { action: "auth.login_failed", type: "SYSTEM" });
    await put(at("09:00"), { action: "report.daily_generated", type: "SYSTEM" });
    await put(at("09:01"), { action: "booking_request.submitted", type: "WEBSITE" });
    await put(at("12:00", dayBack(2)), { action: "reservation.created", userId: rec.id });
    await put(at("12:00", dayBack(14)), { action: "reservation.created", userId: rec.id }); // outside

    const a = await activityData(user, TZ_NOW);
    expect(a.actionsPerDay).toHaveLength(ACTIVITY_DAYS);
    expect(a.actionsPerDay!.at(-1)).toEqual({ date: TODAY, team: 3, developer: 1, total: 4 });
    expect(a.actionsPerDay!.find((d) => d.date === dayBack(2))).toEqual({ date: dayBack(2), team: 1, developer: 0, total: 1 });
    expect(a.actionsPerDay!.reduce((n, d) => n + d.team + d.developer, 0)).toBe(5);
    expect(a.stats).toMatchObject({ teamActions24h: 3, developerActions24h: 1 });
  });

  it("the hotel day turns over at 04:00, not at midnight: 23:59, 00:00 and 03:59 belong to one day, 04:00 to the next", async () => {
    const x = dayBack(5);
    const next = addDays(x, 1);
    const moments = [local(x, "23:59"), local(next, "00:00"), local(next, "03:59"), local(next, "04:00"), local(next, "04:30")];
    expect(moments.map((m) => businessDateOf(m, cfg))).toEqual([x, x, x, next, next]);

    const check = async () => {
      const a = await activityData(user, TZ_NOW);
      const day = (d: string) => a.actionsPerDay!.find((r) => r.date === d)!;
      expect(day(x).team).toBe(3);
      expect(day(next).team).toBe(2);
      // the busiest HOURS are the hotel's wall clock: 23h, 0h, 3h once each, 4h twice
      const hours = Object.fromEntries(a.busiestHours!.map((h) => [h.hour, h.count]));
      expect([hours[23], hours[0], hours[3], hours[4]]).toEqual([1, 1, 1, 2]);
      expect(a.busiestHours!.reduce((n, h) => n + h.count, 0)).toBe(5);
      expect(a.stats.busiestHour).toBe(4);
    };
    // rows written straight at those instants …
    for (const m of moments) await put(m, { action: "reservation.created", userId: rec.id });
    await check();
    await wipeFuture();
    // … and rows written by audit() itself, with the clock set to those instants (the rule that decides the day is the app's own)
    vi.useFakeTimers({ toFake: ["Date"] });
    try {
      for (const [i, m] of moments.entries()) {
        vi.setSystemTime(m);
        await audit(db, { userId: rec.id, label: rec.fullName }, { action: "reservation.created", entityType: "Reservation", entityId: `edge-${i}` });
      }
    } finally {
      vi.useRealTimers();
    }
    await check();
  });

  it("the 24-hour cards: a minute inside the day counts, a minute outside does not", async () => {
    await put(new Date(TZ_NOW.getTime() - (24 * 60 - 1) * 60_000), { action: "reservation.created", userId: rec.id });
    await put(new Date(TZ_NOW.getTime() - (24 * 60 + 1) * 60_000), { action: "reservation.created", userId: rec.id });
    await put(new Date(TZ_NOW.getTime() - (24 * 60 - 1) * 60_000), { action: "auth.login_failed", type: "SYSTEM", entityId: rec.id, entityType: "User" });
    await put(new Date(TZ_NOW.getTime() - (24 * 60 + 1) * 60_000), { action: "auth.login_failed", type: "SYSTEM", entityId: rec.id, entityType: "User" });
    const a = await activityData(user, TZ_NOW);
    expect(a.stats.teamActions24h).toBe(1);
    expect(a.stats.failedSignIns24h).toBe(1);
  });

  it("where the work happens: kinds of record in plain words, several kinds with one name added together, 7 days only", async () => {
    const at = (day = dayBack(1)) => local(day, "10:00");
    for (let i = 0; i < 3; i++) await put(at(), { action: "reservation.created", userId: rec.id, entityType: "Reservation" });
    for (let i = 0; i < 2; i++) await put(at(), { action: "reservation.room_assigned", userId: rec.id, entityType: "ReservationRoom" });
    for (let i = 0; i < 4; i++) await put(at(), { action: "restaurant_order.created", userId: rec.id, entityType: "RestaurantOrder" });
    await put(at(), { action: "payment.recorded", userId: fin.id, entityType: "Payment" });
    await put(at(), { action: "thing.done", userId: rec.id, entityType: "SomeNewThing" });
    await put(at(), { action: "developer.viewed", userId: dev.id, type: "DEVELOPER", entityType: "Page", entityId: "/staff/reports" }); // looking is not work
    await put(at(dayBack(8)), { action: "reservation.created", userId: rec.id, entityType: "Reservation" }); // older than 7 days
    const a = await activityData(user, TZ_NOW);
    expect(a.where).toEqual([
      { label: "Bookings and stays", count: 5 }, { label: "Restaurant orders", count: 4 }, { label: "Payments", count: 1 }, { label: "Some New Thing", count: 1 },
    ]);
    expect(moduleWords("Reservation")).toBe("Bookings and stays");
    expect(moduleWords("ReservationRoom")).toBe(moduleWords("Reservation"));
    expect(moduleWords("RestaurantLocation")).toBe("Restaurant tables");
    expect(moduleWords("")).toBe("Other");
  });

  it("most active people: busiest first, with name, role and the Developer flag; the system and the last-7-days rule", async () => {
    const at = (day = dayBack(1)) => local(day, "10:00");
    for (let i = 0; i < 5; i++) await put(at(), { action: "reservation.created", userId: rec.id });
    for (let i = 0; i < 3; i++) await put(at(), { action: "payment.recorded", userId: fin.id, entityType: "Payment" });
    for (let i = 0; i < 2; i++) await put(at(), { action: "user.updated", userId: dev.id, type: "DEVELOPER", entityType: "User" });
    await put(at(), { action: "reservation.created", userId: mgr.id });
    await put(at(), { action: "report.daily_generated", type: "SYSTEM" });
    await put(at(dayBack(9)), { action: "reservation.created", userId: mgr.id });
    const a = await activityData(user, TZ_NOW);
    expect(a.mostActive!.map((p) => [p.name, p.count, p.developer])).toEqual([[rec.fullName, 5, false], [fin.fullName, 3, false], [dev.fullName, 2, true], [mgr.fullName, 1, false]]);
    expect(a.mostActive![0].roleName).toBe("Receptionist");
  });

  it("recent sign-ins: the last 12, newest first; the device comes from the session of that sign-in, the address from the entry", async () => {
    const mac = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
    const iphone = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1";
    const times = Array.from({ length: 14 }, (_, i) => new Date(TZ_NOW.getTime() - (i + 1) * 3600_000)); // newest first
    for (const [i, t] of times.entries()) await put(t, { action: "auth.login", userId: rec.id, role: "RECEPTIONIST", entityType: "User", entityId: rec.id, ip: `41.0.0.${i + 1}` });
    const session = (createdAt: Date, userAgent: string) => db.session.create({ data: { tokenHash: sha256(`s-${createdAt.getTime()}`), userId: rec.id, createdAt, expiresAt: new Date(createdAt.getTime() + 3600_000), userAgent, ipAddress: "9.9.9.9" } });
    await session(new Date(times[0].getTime() + 800), mac);     // the newest sign-in's session (made a moment after it)
    await session(new Date(times[1].getTime() - 900), iphone);
    const a = await activityData(user, TZ_NOW);
    const r = a.recentSignIns!;
    expect(r).toHaveLength(12);
    expect(r.map((x) => x.at.getTime())).toEqual(times.slice(0, 12).map((t) => t.getTime()));
    expect(r[0]).toMatchObject({ name: rec.fullName, roleName: "Receptionist", ip: "41.0.0.1", device: { label: "Chrome · Mac", phone: false } });
    expect(r[1].device).toEqual({ label: "Safari · iPhone", phone: true });
    expect(r[2]).toMatchObject({ device: null, ip: "41.0.0.3" }); // its session is gone: the device is not known, the address still is
  });

  it("accounts nobody uses: never signed in, or not for 30 days — a shared screen counts as in use while its session is; the Developer, system and switched-off accounts never", async () => {
    const days = (n: number) => new Date(Date.now() - n * 86_400_000);
    const before = (await activityData(user)).notUsingTotal;
    const never = await makeUser("RECEPTIONIST", { fullName: "Nobody Never" });
    const stale = await makeUser("RECEPTIONIST", { fullName: "Nobody Stale" });
    const fresh = await makeUser("RECEPTIONIST", { fullName: "Nobody Fresh" });
    const screen = await makeUser("RESTAURANT_SCREEN", { fullName: "Nobody Screen" });
    const off = await makeUser("RECEPTIONIST", { fullName: "Nobody Off", isActive: false });
    const system = await makeUser("SYSTEM_ONLINE", { fullName: "Nobody System" });
    await db.user.update({ where: { id: stale.id }, data: { lastLoginAt: days(40) } });
    await db.user.update({ where: { id: fresh.id }, data: { lastLoginAt: days(10) } });
    await db.user.update({ where: { id: screen.id }, data: { lastLoginAt: days(60) } });
    await makeSession(screen.id, { setCookie: false, seenMinAgo: 5 });
    const a = await activityData(user);
    expect(a.notUsingTotal).toBe(before + 2); // never + stale
    const listed = new Set(a.notUsing!.map((u) => u.id));
    for (const gone of [fresh, screen, off, system, dev]) expect(listed.has(gone.id), gone.fullName).toBe(false);
    expect(a.notUsing!.length).toBeLessThanOrEqual(12);
    // the oldest first: those never seen, then the longest away
    const times = a.notUsing!.map((u) => u.lastUsedAt?.getTime() ?? 0);
    expect(times).toEqual([...times].sort((x, y) => x - y));
    expect(never.id && stale.id).toBeTruthy();
  });
});

describe("speed, sign-in trouble, settings and my actions", () => {
  let user: CurrentUser;
  let hash: string;
  beforeEach(async () => {
    cfg = businessDayConfig(await getSettings());
    await wipeFuture();
    ({ user, hash } = await as(dev));
  });
  afterAll(async () => {
    await wipeFuture();
    await db.rateLimitBucket.deleteMany({ where: { key: { in: BUCKETS.map((b) => b[0]) } } });
  });
  const BUCKETS: [string, number, number][] = [ // key, count, minutes since the window began
    ["login:email:dev:probe-a@x.test", 6, 1], ["login:email:dev:probe-b@x.test", 5, 1], ["login:email:probe-c@x.test", 9, 1], ["login:email:probe-d@x.test", 8, 1],
    ["login:ip:7.7.7.7", 21, 1], ["login:trail:unknown-developer", 99, 1], ["login:email:probe-old@x.test", 50, 60],
  ];

  it("speed: three quick samples, their average, the counts and size of the biggest tables, and the running version (short)", async () => {
    process.env.VERCEL_GIT_COMMIT_SHA = "0123456789abcdef0123456789abcdef01234567";
    process.env.VERCEL_ENV = "preview";
    const s = await speedData(user);
    expect(s.latency.samples).toHaveLength(3);
    for (const n of s.latency.samples) expect(Number.isInteger(n) && n > 0).toBe(true);
    expect(s.latency.average).toBe(Math.round(s.latency.samples.reduce((a, b) => a + b, 0) / 3));
    expect(s.latency.slowest).toBe(Math.max(...s.latency.samples));
    expect(s.tables.map((t) => t.label)).toEqual(["Audit trail entries", "Sign-in sessions", "Bookings", "Payments", "Messages sent"]);
    expect(s.tables[0].rows).toBe(await db.auditLog.count());
    expect(s.tables[2].rows).toBe(await db.reservation.count());
    for (const t of s.tables) expect(t.bytes).toBeGreaterThan(0);
    expect(s.databaseBytes).toBeGreaterThan(0);
    expect(s.deployment).toEqual({ commit: "0123456", environment: "preview" });
  });

  it("crashes and sign-ins: failed tries in 24 hours and 7 days, by hotel day and by account — an unknown email counts but names no one; the 8th day back is left out", async () => {
    const failed = (day: string, hhmm: string, who: MadeUser | null) => put(local(day, hhmm), { action: "auth.login_failed", type: "SYSTEM", entityType: "User", entityId: who?.id ?? null });
    await failed(TODAY, "08:00", rec);
    await failed(TODAY, "08:05", rec);
    await failed(TODAY, "08:10", fin);
    await failed(TODAY, "08:15", null); // an email nobody holds, tried at the Developer door
    await failed(dayBack(2), "12:00", rec);
    await failed(dayBack(8), "12:00", rec); // outside the 7 days
    const c = await crashData(user, TZ_NOW);
    expect(c.errorTracking).toBe(false);
    expect(c.failed!.last24h).toBe(4);
    expect(c.failed!.last7d).toBe(5);
    expect(c.failed!.byDay).toHaveLength(7);
    expect([c.failed!.byDay[0].date, c.failed!.byDay.at(-1)!.date]).toEqual([dayBack(6), TODAY]);
    expect(c.failed!.byDay.at(-1)).toEqual({ date: TODAY, count: 4 });
    expect(c.failed!.byDay.find((d) => d.date === dayBack(2))!.count).toBe(1);
    expect(c.failed!.byAccount).toEqual([{ name: rec.fullName, count: 3 }, { name: fin.fullName, count: 1 }]);
    expect(c.denied.length).toBeLessThanOrEqual(20);
  });

  it("paused sign-ins are counted from the limits (the Developer account's own lock 5, then 8 per email and 20 per place, in 15 minutes) — and an email or an address is never returned", async () => {
    expect([LOGIN_LIMITS.developerEmail, LOGIN_LIMITS.staffEmail, LOGIN_LIMITS.staffPlace, LOGIN_LIMITS.windowMinutes]).toEqual([5, 8, 20, 15]);
    await db.rateLimitBucket.deleteMany({ where: { key: { in: BUCKETS.map((b) => b[0]) } } });
    const before = (await crashData(user)).paused!; // other test files leave sign-in buckets of their own: count what MY buckets add
    for (const [key, count, ago] of BUCKETS) await db.rateLimitBucket.upsert({ where: { key }, update: { count, windowStart: new Date(Date.now() - ago * 60_000) }, create: { key, count, windowStart: new Date(Date.now() - ago * 60_000) } });
    const c = await crashData(user);
    // over the limit now: the Developer's lock a (6>5), staff email c (9>8), a place (21>20); at the limit, or old, or not a sign-in key: not
    expect(c.paused).toEqual({ developer: before.developer + 1, staff: before.staff + 2 });
    const json = JSON.stringify(c);
    for (const needle of ["probe-a", "probe-c", "7.7.7.7", "unknown-developer", "x.test"]) expect(json).not.toContain(needle);
  });

  it("settings: your session, the money rights you do not hold, and how much of your doing is on record (24 hours, 7 days, ever)", async () => {
    await put(new Date(TZ_NOW.getTime() - 3600_000), { action: "developer.viewed", userId: dev.id, type: "DEVELOPER", entityType: "Page", entityId: "/staff/reports" });
    await put(new Date(TZ_NOW.getTime() - 3 * 86_400_000), { action: "user.updated", userId: dev.id, type: "DEVELOPER", entityType: "User" });
    await put(new Date(TZ_NOW.getTime() - 20 * 86_400_000), { action: "user.updated", userId: dev.id, type: "DEVELOPER", entityType: "User" });
    await put(new Date(TZ_NOW.getTime() - 3600_000), { action: "reservation.created", userId: rec.id }); // staff: not counted
    const s = await settingsTab(user, hash, TZ_NOW);
    expect(s.recorded).toMatchObject({ last24h: 1, last7d: 2 });
    expect(s.recorded!.total).toBeGreaterThanOrEqual(3);
    expect(s.identity.name).toBe(dev.fullName);
    expect(s.identity.notHeld.map((r) => r.code).sort()).toEqual([...DEVELOPER_DENIED].sort());
    expect(s.config.database.reachable).toBe(true);
  });

  it("my last 30 actions: only mine, newest first, in plain words, with who I was working as and what failed", async () => {
    const at = (m: number) => new Date(TZ_NOW.getTime() - m * 60_000);
    for (let i = 0; i < 33; i++) await put(at(100 + i), { action: "developer.viewed", userId: dev.id, type: "DEVELOPER", entityType: "Page", entityId: `/staff/page-${i}` });
    await db.auditLog.create({ data: { userId: dev.id, actorLabel: "Dev (Developer) as Neema (Reception)", actorType: "DEVELOPER", actorRole: "DEVELOPER", action: "reservation.checked_in", entityType: "Reservation", entityId: "r1",
      after: { actingAs: { id: rec.id, name: "Neema", role: "Reception" } }, businessDate: toDbDate(TODAY), createdAt: at(1) } });
    await db.auditLog.create({ data: { userId: dev.id, actorLabel: "x", actorType: "DEVELOPER", action: "developer.inspected", entityType: "User", after: { ok: false }, businessDate: toDbDate(TODAY), createdAt: at(3) } });
    await put(at(4), { action: "developer.viewed", userId: dev2.id, type: "DEVELOPER", entityType: "Page", entityId: "/staff/other-developer" }); // another Developer
    await put(at(4), { action: "reservation.created", userId: rec.id });                                                                      // a staff member

    const mine = await myActions(user);
    expect(mine).toHaveLength(30);
    for (let i = 1; i < mine.length; i++) expect(mine[i - 1].at.getTime()).toBeGreaterThanOrEqual(mine[i].at.getTime());
    expect(mine[0]).toMatchObject({ action: "reservation.checked_in", words: "checked a guest in", actingAs: { name: "Neema", role: "Reception" }, failed: false });
    expect(mine.find((m) => m.action === "developer.inspected" && m.failed)).toBeTruthy();
    expect(mine.find((m) => m.action === "developer.viewed")).toMatchObject({ words: "looked at a page", actingAs: null });
    expect(mine.find((m) => m.action === "developer.viewed")!.path).toMatch(/^\/staff\/page-/);
    expect(JSON.stringify(mine)).not.toContain("other-developer");
    expect(mine.every((m) => m.actingAs === null || m.action === "reservation.checked_in")).toBe(true);
    expect(await myActions(user, 5)).toHaveLength(5);
    expect((await myActions(user, 5000)).length).toBeLessThanOrEqual(100);
    // and the people tab carries the same list
    expect((await peopleTab(user)).myActions).toHaveLength(30);
  });
});

describe("the home: a Developer working as someone is shut out of the console", () => {
  it("every console call refuses a session that is working as another person", async () => {
    const { user, hash } = await as(dev);
    const working = { ...user, workAs: { developerId: dev.id, developerName: dev.fullName, startedAt: new Date() } } as unknown as CurrentUser;
    for (const call of [
      () => developerGreeting(working), () => healthReport(working), () => activityData(working), () => speedData(working), () => crashData(working), () => settingsTab(working, hash),
      () => peopleTab(working), () => myActions(working), () => developerIdentity(working, hash), () => systemDiagnostics(working), () => recentDenied(working), () => listInspectableUsers(working),
      () => inspectPermission(working, { userId: rec.id, code: "reservations.view" }),
    ]) {
      expect(((await thrownBy(call)) as AppError).code).toBe("FORBIDDEN");
    }
    expect(() => assertConsoleAccess(working)).toThrow(AppError);
  });
});

// ═════════════════════════════════════════════ the page itself, drawn with real data ═════════════════════════════════════════════
describe("the Developer home page draws, on every tab, from real data", () => {
  const draw = async (search: Record<string, string> = {}) => {
    const tree = await DeveloperHomePage({ searchParams: Promise.resolve(search) } as never);
    return renderToStaticMarkup(tree);
  };
  beforeAll(async () => { cfg = businessDayConfig(await getSettings()); });
  afterAll(async () => { await wipeFuture(); });

  it("the Developer sees the greeting, the health card, the cards, the shortcuts, the tab bar and the first tab", async () => {
    await as(dev);
    const html = await draw();
    expect(html).toMatch(/Good (morning|afternoon|evening), /);
    expect(html).toContain("Your control room for");
    expect(html).toContain("out of 100");
    expect(html).toContain("Needs your attention");
    for (const w of ["Open Access (work as someone)", "Open Audit", "Open Business", "Activity", "Speed &amp; size", "Crashes &amp; sign-ins", "Settings", "People &amp; my actions"]) expect(html).toContain(w);
    for (const href of Object.values(CONSOLE_HREF)) expect(html).toContain(`href="${href}`);
    for (const w of ["Sign-ins per day", "Actions per day", "Busiest hours of the day", "Where the work happens", "Recent sign-ins", "Most active people", "Not using the system"]) expect(html).toContain(w);
    expect(html).not.toContain("undefined");
    expect(html).not.toContain("NaN");
  });

  it("every tab draws; the right one is marked as the page you are on; a bad ?tab= falls back to the first", async () => {
    await as(dev);
    const marks: Record<string, string> = { activity: "Sign-ins per day", speed: "The biggest tables", crashes: "Error tracking is not part of this system", settings: "What you cannot do", people: "My last 30 actions" };
    for (const [tab, text] of Object.entries(marks)) {
      const html = await draw({ tab });
      expect(html, tab).toContain(text);
      expect(html, tab).not.toContain("undefined");
      expect(html, tab).not.toContain("NaN");
      expect(html, tab).toMatch(new RegExp(`aria-current="page"[^>]*>[^<]*${{ activity: "Activity", speed: "Speed &amp; size", crashes: "Crashes &amp; sign-ins", settings: "Settings", people: "People &amp; my actions" }[tab]}`));
    }
    expect(await draw({ tab: "nonsense" })).toContain("Sign-ins per day");
  });

  it("the inspector on the People tab answers, and the look is written to the audit trail", async () => {
    await as(dev);
    const before = (await auditOf(dev.id, "developer.inspected")).length;
    const html = await draw({ tab: "people", person: rec.id, right: "reservations.view" });
    expect(html).toMatch(/Yes — .* can do this/);
    expect((await auditOf(dev.id, "developer.inspected")).length).toBe(before + 1);
    // …and nothing is looked up on the other tabs
    await draw({ tab: "speed", person: rec.id, right: "reservations.view" });
    expect((await auditOf(dev.id, "developer.inspected")).length).toBe(before + 1);
  });

  it("a mix of real trouble is drawn as cards and is readable in Chinese too", async () => {
    await as(dev);
    await db.hotelSettings.update({ where: { id: 1 }, data: { reportEnabled: true, reportRecipients: [{ name: "A", phone: "+255700000001", apiKeyRef: "CALLMEBOT_KEY_TESTA" }] } });
    const html = await draw();
    expect(html).toContain("The scheduled jobs have no secret");           // no cron secret is set in the test environment
    expect(html).toContain("WhatsApp cannot reach everyone");
    expect(html).toMatch(/Fix now/);
    await db.user.update({ where: { id: dev.id }, data: { preferredLanguage: "zh-CN" } });
    await as(dev);
    const zh = await draw();
    expect(zh).toMatch(/(早上|下午|晚上)好，/);
    expect(zh).toContain("需要您处理");
    expect(zh).toContain("定时任务没有设置密钥");
    expect(zh).not.toContain("The scheduled jobs have no secret");
    await db.user.update({ where: { id: dev.id }, data: { preferredLanguage: "en" } });
  });

  it("a Developer who is working as someone is sent to that person's home; anyone else to 'forbidden'; nobody signed in to the sign-in page", async () => {
    const { user } = await as(dev);
    // working as the receptionist: the session names that person (the loader of the real app does this on every request)
    await db.session.updateMany({ where: { userId: dev.id }, data: { workAsUserId: rec.id, workAsStartedAt: new Date() } });
    const working = await getCurrentUser();
    expect(working?.workAs).toBeTruthy();
    expect(await redirectOf(() => draw())).toMatch(/^\/(reception|staff)\//);
    browser.reset(); // the database's own fence refuses writes to sessions for a request that is working as someone: clean up from a plain one
    await db.session.updateMany({ where: { userId: dev.id }, data: { workAsUserId: null, workAsStartedAt: null } });
    expect(user.actorType).toBe("DEVELOPER");
    await as(rec);
    expect(await redirectOf(() => draw())).toBe("/staff/forbidden");
    browser.reset();
    expect(await redirectOf(() => draw())).toBe("/staff/login");
  });
});
