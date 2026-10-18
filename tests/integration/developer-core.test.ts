import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { ONLINE_RECORDER_ID } from "@/server/services/online-recorder";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});

import { db } from "@/server/db";
import { actorKind, audit, redact } from "@/server/audit";
import { authorize, createSession, getCurrentUser, requirePagePermission } from "@/server/auth";
import { AppError } from "@/server/errors";
import { ALL_PERMISSIONS, DEFAULT_ROLES, DEVELOPER_DENIED, DEVELOPER_ONLY, DEVELOPER_ROLE_CODE, isDeveloperOnly, type PermissionCode } from "@/lib/permissions";
import { auditOf, browser, makeSession, makeUser, redirectOf, removeMadeUsers, setRole, thrownBy, type MadeUser } from "../support/developer";

/**
 * The Developer account (owner, 2026-10-14) — the core guarantees, proven against a real database:
 *   1. every audit entry says who really acted (DEVELOPER / STAFF / SYSTEM / WEBSITE), taken from the account's role in the
 *      database — never from a label, a page or anything the caller passes — and never holds a secret;
 *   2. the rights: the Developer-only right is held by the Developer role alone; the Boss and the MD read the audit trail;
 *      the Developer can never write money;
 *   3. sessions: short for the Developer, normal for staff; the type of the person comes from the database on every request;
 *   4. a refused Developer (action or page) is kept in the audit trail; a refused staff member is not.
 */

let dev: MadeUser;
let rec: MadeUser;
let boss: MadeUser;
let md: MadeUser;
let mgr: MadeUser;
let fin: MadeUser;
let everyone: MadeUser[];

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Dev Core" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Asha Core" });
  boss = await makeUser("OWNER", { fullName: "Boss Core" });
  md = await makeUser("ADMIN", { fullName: "MD Core" });
  mgr = await makeUser("MANAGER", { fullName: "Manager Core" });
  fin = await makeUser("FINANCE", { fullName: "Finance Core" });
  everyone = [dev, rec, boss, md, mgr, fin];
});
afterAll(async () => {
  await removeMadeUsers();
});
beforeEach(async () => {
  browser.reset();
  await db.session.deleteMany({ where: { userId: { in: everyone.map((u) => u.id) } } });
});

const who = (u: MadeUser) => ({ userId: u.id, label: u.fullName });
let seq = 0;
const next = (prefix: string) => `${prefix}.${++seq}.${Date.now()}`;
/** Write one entry and read it back. */
async function written(actor: Parameters<typeof audit>[1], extra: { before?: unknown; after?: unknown } = {}) {
  const action = next("test.core");
  await audit(db, actor, { action, entityType: "Test", entityId: action, ...extra });
  return db.auditLog.findFirstOrThrow({ where: { action } });
}

// ───────────────────────────────────────────── 1. audit(): who acted ─────────────────────────────────────────────
describe("audit(): the type of whoever acted comes from the account's role in the database", () => {
  it("a Developer account is written as DEVELOPER / DEVELOPER", async () => {
    const row = await written({ ...who(dev), ipAddress: "41.9.9.9" });
    expect(row.actorType).toBe("DEVELOPER");
    expect(row.actorRole).toBe("DEVELOPER");
    expect(row.userId).toBe(dev.id);
    expect(row.actorLabel).toBe(dev.fullName);
    expect(row.ipAddress).toBe("41.9.9.9");
  });

  it("the online-payment system account (no person behind it) is written as SYSTEM, with its role", async () => {
    const row = await written({ userId: ONLINE_RECORDER_ID, label: "system" });
    expect([row.actorType, row.actorRole]).toEqual(["SYSTEM", "SYSTEM_ONLINE"]);
  });

  it("a Receptionist is written as STAFF / RECEPTIONIST", async () => {
    const row = await written(who(rec));
    expect([row.actorType, row.actorRole]).toEqual(["STAFF", "RECEPTIONIST"]);
  });

  it("the Boss, the MD, a Manager and Finance are STAFF with their own role — never DEVELOPER", async () => {
    for (const [u, role] of [[boss, "OWNER"], [md, "ADMIN"], [mgr, "MANAGER"], [fin, "FINANCE"]] as const) {
      const row = await written(who(u));
      expect([row.actorType, row.actorRole], role).toEqual(["STAFF", role]);
    }
  });

  it("no account + the label 'website' is WEBSITE; anything else without an account is SYSTEM — with no role", async () => {
    for (const [label, type] of [["website", "WEBSITE"], ["system", "SYSTEM"], ["System", "SYSTEM"], ["Developer", "SYSTEM"], ["cron", "SYSTEM"], [undefined, "SYSTEM"]] as const) {
      const row = await written({ userId: null, label });
      expect([row.actorType, row.actorRole, row.userId], `label ${label}`).toEqual([type, null, null]);
    }
    const noUserId = await written({ label: "website" });
    expect(noUserId.actorType).toBe("WEBSITE");
  });

  it("a Developer account with a staff-looking label is still DEVELOPER (the label is only a name snapshot)", async () => {
    for (const label of ["Neema", "Asha", "Manager", "website", "system", "STAFF"]) {
      const row = await written({ userId: dev.id, label });
      expect([row.actorType, row.actorRole], `label ${label}`).toEqual(["DEVELOPER", "DEVELOPER"]);
      expect(row.actorLabel).toBe(label);
    }
  });

  it("a staff account with the label 'Developer' is still STAFF with its own role", async () => {
    for (const label of ["Developer", "DEVELOPER", "Dev Core", "Developer (super user)", "website", "system"]) {
      const row = await written({ userId: rec.id, label });
      expect([row.actorType, row.actorRole], `label ${label}`).toEqual(["STAFF", "RECEPTIONIST"]);
    }
  });

  it("an account with the label 'website' is not a WEBSITE entry", async () => {
    expect((await written({ userId: rec.id, label: "website" })).actorType).toBe("STAFF");
    expect((await written({ userId: dev.id, label: "website" })).actorType).toBe("DEVELOPER");
  });

  it("a role change afterwards does not rewrite old entries; new entries follow the new role", async () => {
    const u = await makeUser("RECEPTIONIST", { fullName: "Mover Core" });
    const first = await written(who(u));
    await setRole(u.id, "DEVELOPER");
    const second = await written(who(u));
    await setRole(u.id, "MANAGER");
    const third = await written(who(u));

    expect([first.actorType, first.actorRole]).toEqual(["STAFF", "RECEPTIONIST"]);
    expect([second.actorType, second.actorRole]).toEqual(["DEVELOPER", "DEVELOPER"]);
    expect([third.actorType, third.actorRole]).toEqual(["STAFF", "MANAGER"]);
    // the earlier ones are exactly as they were written
    expect(await db.auditLog.findUniqueOrThrow({ where: { id: first.id } })).toEqual(first);
    expect(await db.auditLog.findUniqueOrThrow({ where: { id: second.id } })).toEqual(second);
  });

  it("actorKind() gives the same answer without writing anything", async () => {
    const total = await db.auditLog.count();
    expect(await actorKind(db, who(dev))).toEqual({ type: "DEVELOPER", role: "DEVELOPER" });
    expect(await actorKind(db, who(rec))).toEqual({ type: "STAFF", role: "RECEPTIONIST" });
    expect(await actorKind(db, { userId: null, label: "website" })).toEqual({ type: "WEBSITE", role: null });
    expect(await actorKind(db, { userId: null, label: "Developer" })).toEqual({ type: "SYSTEM", role: null });
    expect(await db.auditLog.count()).toBe(total);
  });

  it("the entry commits or rolls back together with the change it describes", async () => {
    const action = next("test.core.tx");
    await expect(db.$transaction(async (tx) => {
      await audit(tx, who(dev), { action, entityType: "Test", entityId: action });
      throw new Error("the change failed");
    })).rejects.toThrow("the change failed");
    expect(await db.auditLog.count({ where: { action } })).toBe(0);

    await db.$transaction(async (tx) => { await audit(tx, who(dev), { action, entityType: "Test", entityId: action }); });
    expect((await db.auditLog.findFirstOrThrow({ where: { action } })).actorType).toBe("DEVELOPER");
  });
});

// ───────────────────────────────────────────── 1b. redaction ─────────────────────────────────────────────
describe("audit(): secrets never reach the audit trail", () => {
  const LEAK = (n: string) => `LEAK-${n}-value`;
  const secretFields = () => ({
    password: LEAK("password"), passwordHash: LEAK("passwordHash"), newPassword: LEAK("newPassword"), confirmPassword: LEAK("confirmPassword"),
    token: LEAK("token"), tokenHash: LEAK("tokenHash"), sessionToken: LEAK("sessionToken"),
    secret: LEAK("secret"), webhookSecret: LEAK("webhookSecret"),
    apiKey: LEAK("apiKey"), api_key: LEAK("api_key"), "API-KEY": LEAK("API-KEY"),
    pin: LEAK("pin"), PIN: LEAK("PIN"), pinHash: LEAK("pinHash"),
    authorization: LEAK("authorization"), Authorization: LEAK("Authorization"),
  });
  const normalFields = () => ({ name: "Asha", roomNumber: "101", amount: 150000, active: true, note: "Late arrival", empty: null, when: "2026-10-14T08:00:00.000Z", nights: [1, 2, 3] });

  it("password, passwordHash, token, tokenHash, secret, apiKey, pin and authorization are stored as '[hidden]' in before and after; normal fields stay", async () => {
    const row = await written(who(dev), { before: { ...normalFields(), ...secretFields() }, after: { ...normalFields(), ...secretFields() } });
    for (const side of [row.before, row.after] as Record<string, unknown>[]) {
      for (const k of Object.keys(secretFields())) expect(side[k], k).toBe("[hidden]");
      expect(side).toMatchObject(normalFields());
    }
    expect(JSON.stringify([row.before, row.after])).not.toContain("LEAK-");
  });

  it("secrets nested in objects and arrays are hidden too, and their neighbours stay", async () => {
    const payload = {
      user: { name: "Asha", login: { password: LEAK("a"), hint: "none" }, credentials: { user: "asha", other: LEAK("g") } },
      deep: { a: { b: { c: { token: LEAK("b"), keep: 1 } } } },
      list: [{ apiKey: LEAK("c"), ok: 1 }, "plain", 7, [{ secret: LEAK("d"), ok: 2 }], { nested: [{ pin: LEAK("e"), ok: 3 }] }],
      headers: { Authorization: LEAK("f"), accept: "json" },
    };
    const row = await written(who(rec), { before: payload, after: payload });
    for (const side of [row.before, row.after] as Record<string, any>[]) { // eslint-disable-line @typescript-eslint/no-explicit-any
      expect(side.user.name).toBe("Asha");
      expect(side.user.login).toEqual({ password: "[hidden]", hint: "none" });
      expect(side.user.credentials).toBe("[hidden]"); // a key that is itself a secret hides its whole value
      expect(side.deep.a.b.c).toEqual({ token: "[hidden]", keep: 1 });
      expect(side.list[0]).toEqual({ apiKey: "[hidden]", ok: 1 });
      expect(side.list.slice(1, 3)).toEqual(["plain", 7]);
      expect(side.list[3]).toEqual([{ secret: "[hidden]", ok: 2 }]);
      expect(side.list[4]).toEqual({ nested: [{ pin: "[hidden]", ok: 3 }] });
      expect(side.headers).toEqual({ Authorization: "[hidden]", accept: "json" });
    }
    expect(JSON.stringify([row.before, row.after])).not.toContain("LEAK-");
  });

  it("a before/after that is a plain array, string, number or missing is stored as given (or as empty)", async () => {
    const asArray = await written(who(rec), { before: [{ password: LEAK("x"), n: 1 }], after: "text" });
    expect(asArray.before).toEqual([{ password: "[hidden]", n: 1 }]);
    expect(asArray.after).toBe("text");
    const none = await written(who(rec));
    expect(none.before).toBeNull();
    expect(none.after).toBeNull();
  });

  it("cookie, bearer, otp, hash and passcode keys are hidden too — and words that only contain them (footprint, mash) are not", async () => {
    const row = await written(who(dev), { after: { cookie: LEAK("c"), setCookie: LEAK("sc"), bearer: LEAK("b"), otp: LEAK("o"), OTP: LEAK("O"), hash: LEAK("h"), fileHash: LEAK("fh"), passcode: LEAK("pc"), footprint: "ok", mash: "ok", hashtag: "ok" } });
    const side = row.after as Record<string, unknown>;
    for (const k of ["cookie", "setCookie", "bearer", "otp", "OTP", "hash", "fileHash", "passcode"]) expect(side[k], k).toBe("[hidden]");
    expect(side).toMatchObject({ footprint: "ok", mash: "ok", hashtag: "ok" });
  });

  it("a BigInt in before/after does not make the entry fail: it is kept as its digits", async () => {
    const row = await written(who(dev), { before: { big: BigInt("9007199254740993") }, after: [BigInt(5)] });
    expect(row.before).toEqual({ big: "9007199254740993" });
    expect(row.after).toEqual(["5"]);
  });

  it("redact(): pure — leaves dates, numbers, nulls and the original object alone, and hides only the values", () => {
    const original = { password: "p", when: new Date("2026-10-14T00:00:00Z"), n: 1, none: null, list: [{ token: "t" }] };
    const out = redact(original) as Record<string, unknown>;
    expect(out.password).toBe("[hidden]");
    expect(out.when).toEqual(original.when);
    expect([out.n, out.none]).toEqual([1, null]);
    expect(out.list).toEqual([{ token: "[hidden]" }]);
    expect(original.password).toBe("p"); // the caller's object is not changed
    expect(redact(5)).toBe(5);
    expect(redact("x")).toBe("x");
    expect(redact(null)).toBeNull();
    expect(redact([{ secret: 1 }, 2])).toEqual([{ secret: "[hidden]" }, 2]);
  });
});

// ───────────────────────────────────────────── 2. the rights ─────────────────────────────────────────────
describe("rights: the Developer-only right, the audit right, and no money for the Developer", () => {
  const codesOf = async (roleCode: string) => new Set((await db.rolePermission.findMany({ where: { role: { code: roleCode } }, select: { permission: { select: { code: true } } } })).map((p) => p.permission.code));

  it("in the code: developer.access is held by the Developer role only; the Boss and the MD never get it", () => {
    expect(DEVELOPER_ONLY).toEqual(["developer.access"]);
    expect(isDeveloperOnly("developer.access")).toBe(true);
    expect(ALL_PERMISSIONS).not.toContain("developer.access");
    for (const [code, def] of Object.entries(DEFAULT_ROLES)) {
      expect(def.permissions.includes("developer.access"), code).toBe(code === DEVELOPER_ROLE_CODE);
    }
    expect(DEFAULT_ROLES.OWNER.permissions).toContain("audit.view");
    expect(DEFAULT_ROLES.ADMIN.permissions).toContain("audit.view");
    expect(DEFAULT_ROLES.DEVELOPER.permissions).toContain("audit.view");
  });

  it("in the code: audit.view belongs to the Boss, the MD and the Developer only", () => {
    const holders = Object.entries(DEFAULT_ROLES).filter(([, d]) => d.permissions.includes("audit.view")).map(([c]) => c).sort();
    expect(holders).toEqual(["ADMIN", "DEVELOPER", "OWNER"]);
  });

  it("in the code: the Developer role holds no right that writes money, and none that manages accounts", () => {
    const has = new Set<string>(DEFAULT_ROLES.DEVELOPER.permissions);
    for (const denied of DEVELOPER_DENIED) expect(has.has(denied), denied).toBe(false);
    expect(DEVELOPER_DENIED, "creating and changing accounts, passwords, emails, roles and rights is the Boss's and the MD's alone (owner, 2026-10-18)").toContain("users.manage");
    expect(has.size, "56 rights").toBe(56);
    expect(DEVELOPER_DENIED).toEqual(expect.arrayContaining(["payments.record", "payments.reverse", "expenses.approve", "purchases.pay", "withdrawals.manage", "finance.manage", "restaurant.payments.confirm"]));
    // but it inspects and runs everything else
    for (const code of ["reservations.view", "settings.manage", "audit.view", "developer.access", "ledger.view", "shifts.manage"] as PermissionCode[]) expect(has.has(code), code).toBe(true);
  });

  it("in the database: only the DEVELOPER role holds developer.access", async () => {
    const holders = await db.rolePermission.findMany({ where: { permission: { code: "developer.access" } }, select: { role: { select: { code: true } } } });
    expect(holders.map((h) => h.role.code)).toEqual([DEVELOPER_ROLE_CODE]);
  });

  it("in the database: audit.view is held by the Boss (OWNER), the MD (ADMIN) and the Developer only", async () => {
    const holders = await db.rolePermission.findMany({ where: { permission: { code: "audit.view" } }, select: { role: { select: { code: true } } } });
    expect(holders.map((h) => h.role.code).sort()).toEqual(["ADMIN", "DEVELOPER", "OWNER"]);
  });

  it("in the database: the DEVELOPER role has no money-writing right and no 'users.manage', and has the whole of the rest", async () => {
    const has = await codesOf(DEVELOPER_ROLE_CODE);
    for (const denied of DEVELOPER_DENIED) expect(has.has(denied), denied).toBe(false);
    expect(has.has("users.manage")).toBe(false);
    expect(has.size).toBe(56);
    const missing = DEFAULT_ROLES.DEVELOPER.permissions.filter((p) => !has.has(p));
    expect(missing, "rights the code gives the Developer but the database does not").toEqual([]);
    const extra = [...has].filter((p) => !(DEFAULT_ROLES.DEVELOPER.permissions as string[]).includes(p));
    expect(extra, "rights the database gives the Developer but the code does not").toEqual([]);
  });

  it("in the database: the Boss and the MD hold audit.view and not developer.access", async () => {
    for (const role of ["OWNER", "ADMIN"]) {
      const has = await codesOf(role);
      expect(has.has("audit.view"), role).toBe(true);
      expect(has.has("developer.access"), role).toBe(false);
    }
  });

  it("the Developer role is a system role", async () => {
    const r = await db.role.findUniqueOrThrow({ where: { code: DEVELOPER_ROLE_CODE } });
    expect(r.isSystem).toBe(true);
  });
});

// ───────────────────────────────────────────── 3. sessions ─────────────────────────────────────────────
describe("sessions: short for the Developer, normal for staff; the type comes only from the database", () => {
  const DAY = 24 * 60;

  it("a Developer session older than 4 hours is refused, even when its expiry is still in the future", async () => {
    await makeSession(dev.id, { createdMinAgo: 4 * 60 + 1, seenMinAgo: 1, expiresInMin: DAY });
    expect(await getCurrentUser()).toBeNull();
  });

  it("a Developer session idle for more than 30 minutes is refused", async () => {
    await makeSession(dev.id, { createdMinAgo: 60, seenMinAgo: 31, expiresInMin: DAY });
    expect(await getCurrentUser()).toBeNull();
  });

  it("a Developer session just inside both limits works, is a DEVELOPER, and is kept alive by use", async () => {
    await makeSession(dev.id, { createdMinAgo: 3 * 60 + 55, seenMinAgo: 20, expiresInMin: 30 });
    const me = await getCurrentUser();
    expect(me?.id).toBe(dev.id);
    expect(me?.actorType).toBe("DEVELOPER");
    expect(me?.roleCode).toBe("DEVELOPER");
    const row = await db.session.findFirstOrThrow({ where: { userId: dev.id } });
    expect(Date.now() - row.lastSeenAt.getTime()).toBeLessThan(60_000); // 'last used' moved forward, so the 30-minute clock restarts
  });

  it("a Developer session idle for 29 minutes still works (never cut short before 30 once it was recorded), and the use restarts the clock", async () => {
    await makeSession(dev.id, { createdMinAgo: 40, seenMinAgo: 29, expiresInMin: 200 });
    expect((await getCurrentUser())?.id).toBe(dev.id);
    expect(Date.now() - (await db.session.findFirstOrThrow({ where: { userId: dev.id } })).lastSeenAt.getTime()).toBeLessThan(60_000);
  });

  it("a Developer's 'last seen' moves forward after 2 quiet minutes (so 30 minutes idle means 30 real minutes), a staff member's only after 15", async () => {
    await makeSession(dev.id, { createdMinAgo: 20, seenMinAgo: 2, expiresInMin: 200 });
    expect((await getCurrentUser())?.id).toBe(dev.id);
    expect(Date.now() - (await db.session.findFirstOrThrow({ where: { userId: dev.id } })).lastSeenAt.getTime()).toBeLessThan(30_000);
    browser.reset();
    await makeSession(rec.id, { createdMinAgo: 20, seenMinAgo: 2, expiresInMin: DAY });
    expect((await getCurrentUser())?.id).toBe(rec.id);
    expect(Date.now() - (await db.session.findFirstOrThrow({ where: { userId: rec.id } })).lastSeenAt.getTime()).toBeGreaterThan(100_000);
  });

  it("use never lengthens a Developer session: its stored expiry stays exactly where it was (4 hours is a hard cap)", async () => {
    await makeSession(dev.id, { createdMinAgo: 200, seenMinAgo: 20, expiresInMin: 40 });
    const before = await db.session.findFirstOrThrow({ where: { userId: dev.id } });
    expect((await getCurrentUser())?.id).toBe(dev.id);
    const after = await db.session.findFirstOrThrow({ where: { userId: dev.id } });
    expect(after.expiresAt.getTime()).toBe(before.expiresAt.getTime());
    expect(after.createdAt.getTime()).toBe(before.createdAt.getTime());
    // and 4 hours after it began it is over, however recently it was used
    browser.reset();
    await db.session.deleteMany({ where: { userId: dev.id } });
    await makeSession(dev.id, { createdMinAgo: 241, seenMinAgo: 0, expiresInMin: 600 });
    expect(await getCurrentUser()).toBeNull();
  });

  it("a Developer session also ends at its stored expiry", async () => {
    await makeSession(dev.id, { createdMinAgo: 10, seenMinAgo: 1, expiresInMin: -1 });
    expect(await getCurrentUser()).toBeNull();
  });

  it("a staff session is not shortened: 5 hours old and idle 45 minutes still works (a receptionist and the Boss)", async () => {
    for (const u of [rec, boss, mgr]) {
      browser.reset();
      await makeSession(u.id, { createdMinAgo: 5 * 60, seenMinAgo: 45, expiresInMin: DAY });
      const me = await getCurrentUser();
      expect(me?.id, u.role).toBe(u.id);
      expect(me?.actorType, u.role).toBe("STAFF");
    }
  });

  it("a staff session keeps its own existing limit (14 hours) and its stored expiry", async () => {
    await makeSession(rec.id, { createdMinAgo: 14 * 60 + 5, seenMinAgo: 1, expiresInMin: DAY });
    expect(await getCurrentUser()).toBeNull();
    browser.reset();
    await makeSession(rec.id, { createdMinAgo: 60, seenMinAgo: 1, expiresInMin: -1 });
    expect(await getCurrentUser()).toBeNull();
  });

  it("an inactive account has no session, Developer or staff", async () => {
    const off = await makeUser("DEVELOPER", { fullName: "Off Dev", isActive: false });
    await makeSession(off.id);
    expect(await getCurrentUser()).toBeNull();
    browser.reset();
    const offStaff = await makeUser("RECEPTIONIST", { fullName: "Off Staff", isActive: false });
    await makeSession(offStaff.id);
    expect(await getCurrentUser()).toBeNull();
  });

  it("no cookie, an unknown token: no user", async () => {
    expect(await getCurrentUser()).toBeNull();
    browser.cookies.set("vlh_session", "not-a-real-token");
    expect(await getCurrentUser()).toBeNull();
  });

  it("actorType is DEVELOPER only for the Developer role", async () => {
    const seen: Record<string, string | undefined> = {};
    for (const u of everyone) {
      browser.reset();
      await makeSession(u.id, { createdMinAgo: 5, seenMinAgo: 1 });
      seen[u.role] = (await getCurrentUser())?.actorType;
    }
    expect(seen).toEqual({ DEVELOPER: "DEVELOPER", RECEPTIONIST: "STAFF", OWNER: "STAFF", ADMIN: "STAFF", MANAGER: "STAFF", FINANCE: "STAFF" });
  });

  it("a Developer's rights never include a money-writing right, and include the Developer-only right and audit.view", async () => {
    await makeSession(dev.id, { createdMinAgo: 5, seenMinAgo: 1 });
    const me = (await getCurrentUser())!;
    for (const denied of DEVELOPER_DENIED) expect(me.permissions.has(denied), denied).toBe(false);
    expect(me.permissions.has("developer.access")).toBe(true);
    expect(me.permissions.has("audit.view")).toBe(true);
  });

  it("the Boss and the MD have audit.view and not developer.access; so does nobody else but the Developer", async () => {
    const holdersOf = async (code: PermissionCode) => {
      const out: string[] = [];
      for (const u of everyone) {
        browser.reset();
        await makeSession(u.id, { createdMinAgo: 5, seenMinAgo: 1 });
        if ((await getCurrentUser())!.permissions.has(code)) out.push(u.role);
      }
      return out.sort();
    };
    expect(await holdersOf("audit.view")).toEqual(["ADMIN", "DEVELOPER", "OWNER"]);
    expect(await holdersOf("developer.access")).toEqual(["DEVELOPER"]);
  });

  it("a staff session cannot become a Developer by anything in the request (headers, cookies, a label)", async () => {
    await makeSession(rec.id, { createdMinAgo: 5, seenMinAgo: 1 });
    for (const [k, v] of [["x-actor-type", "DEVELOPER"], ["x-developer", "1"], ["x-role", "DEVELOPER"], ["x-account-type", "DEVELOPER"], ["x-user-role", "DEVELOPER"], ["x-forwarded-user", dev.email]] as const) browser.headers.set(k, v);
    for (const k of ["vlh_actor", "vlh_account", "vlh_role", "vlh_developer", "accountType", "actorType", "role"]) browser.cookies.set(k, "DEVELOPER");
    browser.cookies.set("vlh_staff", "1");
    const me = (await getCurrentUser())!;
    expect(me.id).toBe(rec.id);
    expect(me.actorType).toBe("STAFF");
    expect(me.roleCode).toBe("RECEPTIONIST");
    expect(me.permissions.has("developer.access")).toBe(false);
    expect(me.permissions.has("audit.view")).toBe(false);
    // and the audit entry it writes is still a staff entry
    expect((await written({ userId: me.id, label: me.fullName })).actorType).toBe("STAFF");
  });

  it("actorType follows the role in the database on the very next request — staff to Developer and back, with the same cookie", async () => {
    const u = await makeUser("RECEPTIONIST", { fullName: "Flip Core" });
    await makeSession(u.id, { createdMinAgo: 30, seenMinAgo: 1 });
    expect((await getCurrentUser())?.actorType).toBe("STAFF");

    await setRole(u.id, "DEVELOPER");
    const asDev = await getCurrentUser();
    expect(asDev?.actorType).toBe("DEVELOPER");
    expect(asDev?.permissions.has("developer.access")).toBe(true);

    await setRole(u.id, "RECEPTIONIST");
    const back = await getCurrentUser();
    expect(back?.actorType).toBe("STAFF");
    expect(back?.permissions.has("developer.access")).toBe(false);
    expect(back?.permissions.has("audit.view")).toBe(false);
  });

  it("createSession(): the Developer's session lasts 4 hours, a receptionist's 14, the restaurant screen's 30 days; the cookie is httpOnly", async () => {
    const screen = await makeUser("RESTAURANT_SCREEN", { fullName: "Screen Core" });
    const hours = async (u: MadeUser) => {
      browser.reset();
      await createSession(u.id);
      const row = await db.session.findFirstOrThrow({ where: { userId: u.id }, orderBy: { createdAt: "desc" } });
      expect(browser.sessionToken).not.toBeNull();
      expect(browser.cookieOptions.get("vlh_session")).toMatchObject({ httpOnly: true, sameSite: "lax", path: "/" });
      return { h: (row.expiresAt.getTime() - Date.now()) / 3_600_000, cookie: browser.cookieOptions.get("vlh_session")!.expires as Date, row };
    };
    const d = await hours(dev);
    expect(d.h).toBeGreaterThan(3.98);
    expect(d.h).toBeLessThanOrEqual(4);
    expect(Math.abs(d.cookie.getTime() - d.row.expiresAt.getTime())).toBeLessThan(2_000); // the browser forgets it when the server does
    const s = await hours(rec);
    expect(s.h).toBeGreaterThan(13.98);
    expect(s.h).toBeLessThanOrEqual(14);
    const c = await hours(screen);
    expect(c.h).toBeGreaterThan(30 * 24 - 0.1);
    expect(c.h).toBeLessThanOrEqual(30 * 24);
    await db.session.deleteMany({ where: { userId: screen.id } });
  });

  it("the stored token is a hash: the cookie value is not in the database", async () => {
    await createSession(dev.id);
    const token = browser.sessionToken!;
    const row = await db.session.findFirstOrThrow({ where: { userId: dev.id } });
    expect(row.tokenHash).not.toBe(token);
    expect(JSON.stringify(row)).not.toContain(token);
  });
});

// ───────────────────────────────────────────── 4. refused attempts ─────────────────────────────────────────────
describe("a refused Developer is kept in the audit trail; a refused staff member is not", () => {
  const deniedOf = (userId: string) => auditOf(userId, "developer.denied");
  const deniedTotal = () => db.auditLog.count({ where: { action: "developer.denied" } });

  it("an action the Developer may not do: refused, and one 'developer.denied' entry (DEVELOPER) names the right it needed", async () => {
    await makeSession(dev.id, { createdMinAgo: 5, seenMinAgo: 1 });
    browser.headers.set("x-pathname", "/staff/finance/payments");
    const before = (await deniedOf(dev.id)).length;

    const err = await thrownBy(() => authorize("payments.record"));
    expect(err).toBeInstanceOf(AppError);
    expect((err as AppError).code).toBe("FORBIDDEN");

    const rows = (await deniedOf(dev.id)).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorType: "DEVELOPER", actorRole: "DEVELOPER", userId: dev.id, actorLabel: dev.fullName, entityType: "Permission", entityId: "payments.record", ipAddress: browser.ip });
    expect(rows[0].after).toEqual({ kind: "action", needs: ["payments.record"], path: "/staff/finance/payments" });
  });

  it("with several rights offered, none held: one entry naming all of them", async () => {
    await makeSession(dev.id, { createdMinAgo: 5, seenMinAgo: 1 });
    const before = (await deniedOf(dev.id)).length;
    expect(((await thrownBy(() => authorize("payments.record", "finance.manage"))) as AppError).code).toBe("FORBIDDEN");
    const rows = (await deniedOf(dev.id)).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0].entityId).toBe("payments.record,finance.manage");
    expect((rows[0].after as { needs: string[] }).needs).toEqual(["payments.record", "finance.manage"]);
  });

  it("every denied right (money, and the management of accounts) is refused for the Developer, each leaving its own entry", async () => {
    await makeSession(dev.id, { createdMinAgo: 5, seenMinAgo: 1 });
    const before = (await deniedOf(dev.id)).length;
    for (const code of DEVELOPER_DENIED) {
      const err = await thrownBy(() => authorize(code));
      expect((err as AppError)?.code, code).toBe("FORBIDDEN");
    }
    const rows = (await deniedOf(dev.id)).slice(before);
    expect(rows.map((r) => r.entityId)).toEqual([...DEVELOPER_DENIED]);
    expect(rows.every((r) => r.actorType === "DEVELOPER")).toBe(true);
  });

  it("a page the Developer may not open: sent to the 'forbidden' page, with one entry of kind 'page'", async () => {
    await makeSession(dev.id, { createdMinAgo: 5, seenMinAgo: 1 });
    browser.headers.set("x-pathname", "/staff/finance/withdrawals");
    const before = (await deniedOf(dev.id)).length;

    expect(await redirectOf(() => requirePagePermission("withdrawals.manage"))).toBe("/staff/forbidden");

    const rows = (await deniedOf(dev.id)).slice(before);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorType: "DEVELOPER", entityId: "withdrawals.manage" });
    expect(rows[0].after).toEqual({ kind: "page", needs: ["withdrawals.manage"], path: "/staff/finance/withdrawals" });
  });

  it("what the Developer may do leaves no 'denied' entry — also when one of several rights is held, and without any shift", async () => {
    await makeSession(dev.id, { createdMinAgo: 5, seenMinAgo: 1 });
    const before = await deniedTotal();
    expect((await authorize("audit.view")).actorType).toBe("DEVELOPER");
    expect((await authorize("developer.access")).id).toBe(dev.id);
    expect((await authorize("payments.record", "audit.view")).id).toBe(dev.id);
    expect((await authorize("reservations.view")).id).toBe(dev.id); // reception work needs no open shift for the Developer
    expect((await requirePagePermission("settings.manage")).id).toBe(dev.id);
    expect((await authorize()).id).toBe(dev.id);
    expect(await deniedTotal()).toBe(before);
  });

  it("a receptionist refused an action or a page: refused, and NO 'developer.denied' entry", async () => {
    await makeSession(rec.id, { createdMinAgo: 5, seenMinAgo: 1 });
    const before = await deniedTotal();
    const mine = (await auditOf(rec.id)).length;

    expect(((await thrownBy(() => authorize("developer.access"))) as AppError).code).toBe("FORBIDDEN");
    expect(((await thrownBy(() => authorize("audit.view"))) as AppError).code).toBe("FORBIDDEN");
    expect(await redirectOf(() => requirePagePermission("developer.access"))).toBe("/staff/forbidden");
    expect(await redirectOf(() => requirePagePermission("audit.view"))).toBe("/staff/forbidden");

    expect(await deniedTotal()).toBe(before);
    // Not a 'developer.denied' entry, but the receptionist's try at the Developer's page is kept (once, as 'developer.endpoint_refused').
    const after = await auditOf(rec.id);
    expect(after.length).toBe(mine + 1);
    expect(await auditOf(rec.id, "developer.endpoint_refused")).toHaveLength(1);
  });

  it("the Boss and the MD refused the Developer-only right: refused, and no 'developer.denied' entry", async () => {
    for (const u of [boss, md, mgr, fin]) {
      browser.reset();
      await makeSession(u.id, { createdMinAgo: 5, seenMinAgo: 1 });
      const before = await deniedTotal();
      expect(((await thrownBy(() => authorize("developer.access"))) as AppError).code, u.role).toBe("FORBIDDEN");
      expect(await redirectOf(() => requirePagePermission("developer.access")), u.role).toBe("/staff/forbidden");
      expect(await deniedTotal(), u.role).toBe(before);
    }
  });

  it("nobody signed in: told to sign in, nothing recorded", async () => {
    const before = await deniedTotal();
    expect(((await thrownBy(() => authorize("audit.view"))) as AppError).code).toBe("UNAUTHENTICATED");
    expect(await redirectOf(() => requirePagePermission("audit.view"))).toBe("/staff/login");
    expect(await deniedTotal()).toBe(before);
  });

  it("an expired Developer session is 'not signed in', not a denied attempt", async () => {
    await makeSession(dev.id, { createdMinAgo: 5 * 60, seenMinAgo: 1 });
    const before = await deniedTotal();
    expect(((await thrownBy(() => authorize("payments.record"))) as AppError).code).toBe("UNAUTHENTICATED");
    expect(await deniedTotal()).toBe(before);
  });
});
