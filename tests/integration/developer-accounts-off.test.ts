import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), after: () => undefined }));
// The Boss's WhatsApp notice: captured, never sent.
vi.mock("@/server/services/report-delivery", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), tellBossSoon: vi.fn() }));

import { db, rawDb } from "@/server/db";
import { getCurrentUser, requirePagePermission, type CurrentUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import { reactivateAccount, REACTIVATE_REFUSAL, suspendAccount } from "@/server/services/work-as";
import * as accounts from "@/server/services/staff-accounts";
import {
  createStaffAccount, deleteStaffAccount, DEVELOPER_NO_ACCOUNTS, resetStaffPassword, setRolePermission, staffDirectory, updateStaffAccount,
  type AccountActor, type UpdateAccountInput,
} from "@/server/services/staff-accounts";
import * as permissionsModule from "@/lib/permissions";
import { DEFAULT_ROLES, DEVELOPER_DENIED, PERMISSIONS } from "@/lib/permissions";
import { createUserAction, deleteUserAction, resetPasswordAction, setRolePermissionAction, signOutScreenSessionAction, updateUserAction } from "@/app/staff/(app)/users/actions";
import users from "@/i18n/catalog/zh-CN/staff/developer-users";
import wall3 from "@/i18n/catalog/zh-CN/staff/developer-wall3";
import { browser, makeSession, makeUser, redirectOf, removeMadeUsers, sha256, thrownBy, type MadeUser } from "../support/developer";

/**
 * THE DEVELOPER CANNOT CREATE OR CHANGE ACCOUNTS, PASSWORDS, LOGIN EMAILS, ROLES OR RIGHTS AT ALL (owner, 2026-10-18). Only the Boss and the
 * MD do (Users page). Every allow-list design for letting the Developer manage "harmless" accounts was walked around in review, so there is no
 * list. This file proves it table-driven, against a real database:
 *   - for EVERY shipped role as the target account, and as the role a right is given to or taken from, and for EVERY right: a Developer
 *     (on its own account, and working as each of the shipped roles' people) is refused every changing function with ONE message, nothing is
 *     written (accounts, passwords, sessions, roles, rights), and the audit trail holds only the failed attempts, under the Developer;
 *   - the refusal comes first: a weak password, an unknown role or a missing account get the same message (no oracle);
 *   - the Developer role holds no 'users.manage', so the Users page and its actions are closed to it before the service is reached;
 *   - the Boss and the MD still do all of it, exactly as before;
 *   - what the Developer keeps for accounts (suspend, sign out, re-activate its own suspensions) follows the rule: never an account whose
 *     role holds a right the Developer is denied.
 */

const DEV = "DEVELOPER";
const SUFFIX = "@accoff.local";
const SHIPPED = Object.keys(DEFAULT_ROLES).filter((c) => c !== DEV);
const ALL_RIGHTS = Object.keys(PERMISSIONS);
const GOOD = "A fair reason";

let dev: MadeUser;
let dev2: MadeUser;
/** One person in every shipped role. */
const person: Record<string, MadeUser> = {};
let boss: MadeUser;
let md: MadeUser;
const roleId: Record<string, string> = {};
const customRoles: string[] = [];

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Dev AccOff" });
  dev2 = await makeUser("DEVELOPER", { fullName: "Second Dev AccOff" });
  for (const code of SHIPPED) person[code] = await makeUser(code, { fullName: `${code} AccOff` });
  boss = person.OWNER;
  md = person.ADMIN;
  for (const r of await db.role.findMany({ select: { id: true, code: true } })) roleId[r.code] = r.id;
});
afterAll(async () => {
  browser.reset(); // removing accounts is exactly what the fence forbids while working as someone
  await db.user.deleteMany({ where: { email: { endsWith: SUFFIX } } });
  for (const code of customRoles) {
    await db.user.deleteMany({ where: { role: { code } } });
    await db.rolePermission.deleteMany({ where: { role: { code } } });
    await db.role.deleteMany({ where: { code } });
  }
  await removeMadeUsers();
});
beforeEach(async () => {
  browser.reset();
  vi.mocked((await import("@/server/services/report-delivery")).tellBossSoon).mockClear();
  await rawDb.user.updateMany({ where: { id: { in: [dev.id, dev2.id, ...SHIPPED.map((c) => person[c].id)] } }, data: { isActive: true, mustChangePassword: false } });
});

// ───────────────────────────────────────────── helpers ─────────────────────────────────────────────

const mail = (tag: string) => `${tag}-${randomUUID().slice(0, 8)}${SUFFIX}`;
const pw = () => `Pw${randomUUID().slice(0, 8)}-7z`;
const afterOf = (row: { after: unknown }) => (row.after ?? {}) as Record<string, unknown>;
/** The acting person on the Developer's own account, as the account service sees them. */
const consoleActor = (): AccountActor => ({ id: dev.id, fullName: dev.fullName, roleCode: DEV, actorType: "DEVELOPER" });
const staffActor = (u: MadeUser): AccountActor => ({ id: u.id, fullName: u.fullName, roleCode: u.role, actorType: "STAFF" });
/** The Developer signed in — on its own account, or already working as `target` (written to the session row, as startWorkAs does). Returns the session's user. */
async function developerSession(target: MadeUser | null = null): Promise<CurrentUser> {
  browser.reset();
  const token = await makeSession(dev.id, { createdMinAgo: 1, seenMinAgo: 0 });
  if (target) await rawDb.session.update({ where: { tokenHash: sha256(token) }, data: { workAsUserId: target.id, workAsStartedAt: new Date(Date.now() - 60_000) } });
  const u = await getCurrentUser();
  if (!u) throw new Error("not signed in");
  return u;
}
async function signedInAs(u: MadeUser) {
  browser.reset();
  await makeSession(u.id, { createdMinAgo: 1, seenMinAgo: 0 });
}
/** An audit watcher: the entries one account wrote since it was started (oldest first). */
async function watch(userId: string) {
  const seen = (await rawDb.auditLog.findMany({ where: { userId }, select: { id: true } })).map((r) => r.id);
  return () => rawDb.auditLog.findMany({ where: { userId, id: { notIn: seen } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}
async function refusal(run: () => Promise<unknown>): Promise<AppError> {
  const e = await thrownBy(run);
  expect(e, "an error was expected").toBeInstanceOf(AppError);
  return e as AppError;
}
/** Everything a changing function could touch: accounts (with password hashes), sessions, roles and the rights they hold. */
async function accountsState() {
  const [accountRows, sessions, roles, rights] = await Promise.all([
    rawDb.user.findMany({ orderBy: { id: "asc" }, select: { id: true, fullName: true, email: true, phone: true, isActive: true, roleId: true, passwordHash: true, mustChangePassword: true } }),
    rawDb.session.count(),
    rawDb.role.findMany({ orderBy: { id: "asc" }, select: { id: true, code: true, name: true, description: true } }),
    rawDb.rolePermission.findMany({ orderBy: [{ roleId: "asc" }, { permissionId: "asc" }], select: { roleId: true, permissionId: true } }),
  ]);
  return JSON.stringify({ accountRows, sessions, roles, rights });
}
const rightsOf = async (code: string) =>
  (await rawDb.rolePermission.findMany({ where: { role: { code } }, select: { permission: { select: { code: true } } } })).map((r) => r.permission.code).sort();
const updateInput = (target: MadeUser, over: Partial<UpdateAccountInput> = {}): UpdateAccountInput =>
  ({ userId: target.id, fullName: target.fullName, email: target.email, phone: null, roleId: roleId[target.role], isActive: true, ...over });
async function makeRole(tag: string, rights: string[]) {
  const code = `ACCOFF_${tag}_${randomUUID().slice(0, 6)}`.toUpperCase();
  const role = await db.role.create({ data: { code, name: `AccOff ${tag}` } });
  customRoles.push(code);
  const found = await db.permission.findMany({ where: { code: { in: rights } } });
  expect(found.length, `${tag}: every right exists`).toBe(rights.length);
  await db.rolePermission.createMany({ data: found.map((p) => ({ roleId: role.id, permissionId: p.id })) });
  return role;
}

interface Call { name: string; failed: string; run: () => Promise<unknown> }

/**
 * Every call is refused with the one message ("forbidden"), nothing in the accounts / sessions / roles / rights changed, and the Developer's
 * audit trail holds exactly one failed attempt per call (right action, FORBIDDEN, the one message, DEVELOPER, and — working as — whom as).
 */
async function allRefused(label: string, calls: Call[], actingAs: MadeUser | null = null) {
  const before = await accountsState();
  const fresh = await watch(dev.id);
  const wrong: string[] = [];
  for (const c of calls) {
    const e = await thrownBy(c.run);
    if (!(e instanceof AppError) || e.code !== "FORBIDDEN" || e.message !== DEVELOPER_NO_ACCOUNTS) wrong.push(`${c.name}: ${e instanceof Error ? `${(e as AppError).code} ${e.message}` : "it worked"}`);
  }
  expect(wrong, `${label}: refused with the one message`).toEqual([]);
  expect(await accountsState(), `${label}: nothing was written`).toBe(before);
  const rows = await fresh();
  expect(rows.map((r) => r.action), `${label}: one failed attempt per call, nothing else`).toEqual(calls.map((c) => c.failed));
  const odd = rows.filter((r) => !(r.actorType === "DEVELOPER" && r.actorRole === DEV && afterOf(r).code === "FORBIDDEN" && afterOf(r).error === DEVELOPER_NO_ACCOUNTS
    && (actingAs ? (afterOf(r).actingAs as { name?: string } | undefined)?.name === actingAs.fullName : !("actingAs" in afterOf(r)))));
  expect(odd.map((r) => r.action), `${label}: every entry is the Developer's and says FORBIDDEN with the one message`).toEqual([]);
}

// ═════════════════════════════════════ the message ═════════════════════════════════════
describe("the one message", () => {
  it("is plain words, in English and in 中文", () => {
    expect(DEVELOPER_NO_ACCOUNTS).toBe("The Developer account cannot create or change accounts, passwords, roles or rights. Ask the Boss or the MD.");
    expect(users[DEVELOPER_NO_ACCOUNTS]).toMatch(/[一-鿿]/);
    expect(wall3[REACTIVATE_REFUSAL]).toMatch(/[一-鿿]/);
  });
});

// ═════════════════════════════════════ the Developer on its own account ═════════════════════════════════════
describe("the Developer on its own account: every changing function is refused, for every shipped role", () => {
  it("shipped roles: the ten the hotel has", () => {
    expect([...SHIPPED].sort()).toEqual(["ACCOUNTANT", "ADMIN", "DRIVER", "FINANCE", "KITCHEN", "MANAGER", "OWNER", "RECEPTIONIST", "RESTAURANT", "RESTAURANT_SCREEN"]);
  });

  it("create: an account in every shipped role (and in the Developer role, and a weak password): none is made", async () => {
    const emails: string[] = [];
    const calls: Call[] = [...SHIPPED, DEV].flatMap((code) => [pw(), "weak"].map((password) => {
      const email = mail("mk");
      emails.push(email);
      return { name: `create ${code} ${password === "weak" ? "(weak password)" : ""}`, failed: "user.create_failed", run: () => createStaffAccount(consoleActor(), { fullName: "Sneaky", email, phone: null, roleId: roleId[code], password }) };
    }));
    await allRefused("create", calls);
    expect(await rawDb.user.count({ where: { email: { in: emails } } })).toBe(0);
  });

  it("update: every shipped role's account × name, phone, off, on, role, email, all at once — and the Developer's own account and another Developer's", async () => {
    const targets = [...SHIPPED.map((c) => person[c]), dev, dev2];
    for (const t of targets) await makeSession(t.id, { setCookie: false });
    browser.reset();
    const calls: Call[] = targets.flatMap((t) => {
      const other = t.role === "DRIVER" ? roleId.KITCHEN : roleId.DRIVER;
      return ([
        ["name", { fullName: `${t.fullName} renamed` }],
        ["phone", { phone: "+255700000001" }],
        ["switch off", { isActive: false }],
        ["role", { roleId: other }],
        ["email", { email: mail("takeover") }],
        ["everything", { fullName: "X Y", phone: "+255700000002", email: mail("all"), roleId: other, isActive: false }],
      ] as [string, Partial<UpdateAccountInput>][]).map(([what, over]) => ({
        name: `update ${t.role} ${what}`, failed: "user.update_failed", run: () => updateStaffAccount(consoleActor(), updateInput(t, over)),
      }));
    });
    // switching an account ON is refused too (the person is off first)
    await rawDb.user.update({ where: { id: person.DRIVER.id }, data: { isActive: false } });
    calls.push({ name: "switch on", failed: "user.update_failed", run: () => updateStaffAccount(consoleActor(), updateInput(person.DRIVER, { isActive: true })) });
    await allRefused("update", calls);
    await rawDb.user.update({ where: { id: person.DRIVER.id }, data: { isActive: true } });
  });

  it("reset a password: every shipped role's account, the Developer's own and another Developer's — the old passwords keep working", async () => {
    const targets = [...SHIPPED.map((c) => person[c]), dev, dev2];
    const calls: Call[] = targets.flatMap((t) => [pw(), "weak"].map((password) => ({ name: `reset ${t.role}`, failed: "user.password_reset_failed", run: () => resetStaffPassword(consoleActor(), { userId: t.id, password }) })));
    await allRefused("reset", calls);
    const { authenticate } = await import("@/server/services/auth-login");
    for (const t of [person.DRIVER, person.FINANCE, dev]) expect((await authenticate(t.email, t.password)).ok, `${t.role}: the old password still signs in`).toBe(true);
  });

  it("remove: every shipped role's account, the Developer's own and another Developer's — all stay", async () => {
    const targets = [...SHIPPED.map((c) => person[c]), dev, dev2];
    await allRefused("delete", targets.map((t) => ({ name: `delete ${t.role}`, failed: "user.delete_failed", run: () => deleteStaffAccount(consoleActor(), { userId: t.id }) })));
    expect(await rawDb.user.count({ where: { id: { in: targets.map((t) => t.id) } } })).toBe(targets.length);
  });

  it("rights: EVERY right given to, and taken from, EVERY shipped role (and the Developer role) — 'developer.access' and 'users.manage' included", async () => {
    const calls: Call[] = [];
    for (const code of [...SHIPPED, DEV]) {
      const held = await rightsOf(code);
      for (const permission of ALL_RIGHTS) {
        calls.push({ name: `give ${permission} to ${code}`, failed: "user.permission_change_failed", run: () => setRolePermission(consoleActor(), { roleId: roleId[code], permission, granted: true }) });
        if (held.includes(permission)) calls.push({ name: `take ${permission} from ${code}`, failed: "user.permission_change_failed", run: () => setRolePermission(consoleActor(), { roleId: roleId[code], permission, granted: false }) });
      }
    }
    expect(calls.length).toBeGreaterThan(11 * ALL_RIGHTS.length);
    await allRefused("rights", calls);
  });

  it("a right that does not exist, or a role that does not exist, gets the same message: the refusal comes before anything is read", async () => {
    await allRefused("unknown", [
      { name: "not a right", failed: "user.permission_change_failed", run: () => setRolePermission(consoleActor(), { roleId: roleId.DRIVER, permission: "no.such.right", granted: true }) },
      { name: "constructor", failed: "user.permission_change_failed", run: () => setRolePermission(consoleActor(), { roleId: roleId.DRIVER, permission: "constructor", granted: true }) },
      { name: "no such role", failed: "user.permission_change_failed", run: () => setRolePermission(consoleActor(), { roleId: "no-such-role", permission: "rooms.view", granted: true }) },
      { name: "the Owner role", failed: "user.permission_change_failed", run: () => setRolePermission(consoleActor(), { roleId: roleId.OWNER, permission: "rooms.view", granted: false }) },
      { name: "the system role", failed: "user.permission_change_failed", run: () => setRolePermission(consoleActor(), { roleId: roleId.SYSTEM_ONLINE, permission: "rooms.view", granted: true }) },
      { name: "no such account (update)", failed: "user.update_failed", run: () => updateStaffAccount(consoleActor(), { userId: "no-such-account", fullName: "X Y", email: mail("e"), phone: null, roleId: roleId.DRIVER, isActive: true }) },
      { name: "no such account (reset)", failed: "user.password_reset_failed", run: () => resetStaffPassword(consoleActor(), { userId: "no-such-account", password: pw() }) },
      { name: "no such account (delete)", failed: "user.delete_failed", run: () => deleteStaffAccount(consoleActor(), { userId: "no-such-account" }) },
      { name: "no such role (create)", failed: "user.create_failed", run: () => createStaffAccount(consoleActor(), { fullName: "X Y", email: mail("e"), phone: null, roleId: "no-such-role", password: pw() }) },
      { name: "the system role (create)", failed: "user.create_failed", run: () => createStaffAccount(consoleActor(), { fullName: "X Y", email: mail("e"), phone: null, roleId: roleId.SYSTEM_ONLINE, password: pw() }) },
    ]);
  });

  it("whatever the actor claims about itself, a Developer is refused: the account type, the Developer role, or the work-as mark is enough", async () => {
    const claims: [string, AccountActor][] = [
      ["type Developer, role Boss", { id: dev.id, fullName: dev.fullName, roleCode: "OWNER", actorType: "DEVELOPER" }],
      ["role Developer, type staff", { id: dev.id, fullName: dev.fullName, roleCode: DEV, actorType: "STAFF" }],
      ["type staff, role MD, but working as someone", { id: md.id, fullName: md.fullName, roleCode: "ADMIN", actorType: "STAFF", workAs: { developerId: dev.id } }],
    ];
    for (const [name, actor] of claims) {
      const state = await accountsState();
      const err = await refusal(() => createStaffAccount(actor, { fullName: "X Y", email: mail("claim"), phone: null, roleId: roleId.DRIVER, password: pw() }));
      expect([err.code, err.message], name).toEqual(["FORBIDDEN", DEVELOPER_NO_ACCOUNTS]);
      expect(await accountsState(), name).toBe(state);
    }
  });
});

// ═════════════════════════════════════ working as anyone ═════════════════════════════════════
describe("the Developer working as each shipped role's person: the same refusal, written under the Developer", () => {
  it("every changing function, as every one of the ten people — nothing written, one failed attempt each, 'as' that person", async () => {
    for (const code of SHIPPED) {
      const victim = person[SHIPPED[(SHIPPED.indexOf(code) + 1) % SHIPPED.length]];
      browser.reset(); // (a session cannot be written while the browser still works as someone: that is the fence)
      await makeSession(victim.id, { setCookie: false });
      const actor = await developerSession(person[code]);
      expect(actor.workAs, code).toBeTruthy();
      const other = victim.role === "DRIVER" ? roleId.KITCHEN : roleId.DRIVER;
      await allRefused(`as ${code}`, [
        { name: "create", failed: "user.create_failed", run: () => createStaffAccount(actor, { fullName: "Sneaky", email: mail("wa"), phone: null, roleId: roleId.DRIVER, password: pw() }) },
        { name: "rename", failed: "user.update_failed", run: () => updateStaffAccount(actor, updateInput(victim, { fullName: "Taken Over" })) },
        { name: "switch off", failed: "user.update_failed", run: () => updateStaffAccount(actor, updateInput(victim, { isActive: false })) },
        { name: "role", failed: "user.update_failed", run: () => updateStaffAccount(actor, updateInput(victim, { roleId: other })) },
        { name: "email", failed: "user.update_failed", run: () => updateStaffAccount(actor, updateInput(victim, { email: mail("wa-takeover") })) },
        { name: "reset", failed: "user.password_reset_failed", run: () => resetStaffPassword(actor, { userId: victim.id, password: pw() }) },
        { name: "delete", failed: "user.delete_failed", run: () => deleteStaffAccount(actor, { userId: victim.id }) },
        { name: "give", failed: "user.permission_change_failed", run: () => setRolePermission(actor, { roleId: roleId[code], permission: "inventory.view", granted: true }) },
        { name: "take", failed: "user.permission_change_failed", run: () => setRolePermission(actor, { roleId: roleId[code], permission: "rooms.view", granted: false }) },
        { name: "give users.manage", failed: "user.permission_change_failed", run: () => setRolePermission(actor, { roleId: roleId.DRIVER, permission: "users.manage", granted: true }) },
      ], person[code]);
    }
  });

  it("the whole rights grid, working as the Boss and as the MD (the two people whose rights the Developer would most like to borrow)", async () => {
    for (const who of [boss, md]) {
      const actor = await developerSession(who);
      const calls: Call[] = [];
      for (const code of [...SHIPPED, DEV]) {
        const held = await rightsOf(code);
        for (const permission of ALL_RIGHTS) {
          calls.push({ name: `give ${permission} to ${code}`, failed: "user.permission_change_failed", run: () => setRolePermission(actor, { roleId: roleId[code], permission, granted: true }) });
          if (held.includes(permission)) calls.push({ name: `take ${permission} from ${code}`, failed: "user.permission_change_failed", run: () => setRolePermission(actor, { roleId: roleId[code], permission, granted: false }) });
        }
      }
      await allRefused(`grid as ${who.role}`, calls, who);
    }
  });
});

// ═════════════════════════════════════ the doors in front of the service ═════════════════════════════════════
describe("the Developer holds no 'users.manage': the Users page and its actions are closed before the service is reached", () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("the Developer role holds no 'users.manage' in the database; the Boss and the MD do", async () => {
    expect(await rightsOf(DEV)).not.toContain("users.manage");
    expect((await rightsOf(DEV)).length).toBe(56);
    for (const code of ["OWNER", "ADMIN"]) expect(await rightsOf(code), code).toContain("users.manage");
    expect(DEVELOPER_DENIED).toContain("users.manage");
  });

  it("the Users page: a Developer — on its own account or working as the Boss or the MD — is sent to 'forbidden'; the MD and the Boss are not", async () => {
    await developerSession(null);
    expect(await redirectOf(() => requirePagePermission("users.manage"))).toBe("/staff/forbidden");
    for (const who of [boss, md]) {
      await developerSession(who);
      expect(await redirectOf(() => requirePagePermission("users.manage")), `as ${who.role}`).toBe("/staff/forbidden");
    }
    for (const who of [boss, md]) {
      await signedInAs(who);
      expect((await requirePagePermission("users.manage")).id, who.role).toBe(who.id);
    }
  });

  it("every Users action: refused for the Developer (own account, and working as the Boss or the MD); nothing written; the entries are the Developer's 'denied' ones — never a user.* success", async () => {
    const victim = person.DRIVER;
    for (const who of [null, boss, md]) {
      await developerSession(who);
      const before = await accountsState();
      const fresh = await watch(dev.id);
      const results = [
        await createUserAction(undefined, form({ fullName: "Action Person", email: mail("act"), phone: "", roleId: roleId.DRIVER, password: pw(), actorType: "STAFF", roleCode: "OWNER", userId: boss.id })),
        await updateUserAction(undefined, form({ userId: victim.id, fullName: "Hacked", email: victim.email, phone: "", roleId: roleId.KITCHEN, isActive: "on" })),
        await resetPasswordAction(undefined, form({ userId: victim.id, password: pw() })),
        await setRolePermissionAction({ roleId: roleId.DRIVER, permission: "inventory.view", granted: true }),
        await deleteUserAction(undefined, form({ userId: victim.id })),
        await signOutScreenSessionAction(undefined, form({ sessionId: "any" })),
      ];
      for (const r of results) expect(r, `as ${who?.role ?? "Developer"}`).toMatchObject({ ok: false, code: "FORBIDDEN" });
      expect(await accountsState(), `as ${who?.role ?? "Developer"}`).toBe(before);
      const rows = await fresh();
      expect(rows.length, "one refusal per action").toBe(results.length);
      expect(rows.every((r) => r.action === "developer.denied" && r.actorType === "DEVELOPER" && String(r.entityId).includes("users.manage"))).toBe(true);
    }
  });

  it("the actions work for the MD and the Boss exactly as before", async () => {
    for (const who of [md, boss]) {
      await signedInAs(who);
      const email = mail("act");
      expect((await createUserAction(undefined, form({ fullName: "Action Person", email, phone: "", roleId: roleId.DRIVER, password: pw() }))).ok, who.role).toBe(true);
      const made = await rawDb.user.findUniqueOrThrow({ where: { email } });
      expect((await updateUserAction(undefined, form({ userId: made.id, fullName: "Action Renamed", email, phone: "", roleId: roleId.KITCHEN, isActive: "on" }))).ok, who.role).toBe(true);
      expect((await resetPasswordAction(undefined, form({ userId: made.id, password: pw() }))).ok, who.role).toBe(true);
      expect((await deleteUserAction(undefined, form({ userId: made.id }))).ok, who.role).toBe(true);
    }
  });
});

// ═════════════════════════════════════ the Boss and the MD ═════════════════════════════════════
describe("the Boss and the MD still do all of it, exactly as before", () => {
  it("for every shipped role: create, rename, switch off and on, change the role, reset the password, remove — one STAFF entry each, no reason asked", async () => {
    for (const [who, roles] of [[md, SHIPPED.filter((c) => c !== "OWNER")], [boss, SHIPPED]] as const) {
      for (const code of roles) {
        const fresh = await watch(who.id);
        const email = mail("st");
        const id = await createStaffAccount(staffActor(who), { fullName: `Staff ${code}`, email, phone: null, roleId: roleId[code], password: pw() });
        const made = { id, email, fullName: `Staff ${code}`, password: "", role: code } as MadeUser;
        const into = code === "DRIVER" ? roleId.KITCHEN : roleId.DRIVER;
        await updateStaffAccount(staffActor(who), updateInput(made, { fullName: `Renamed ${code}` }));
        await updateStaffAccount(staffActor(who), updateInput(made, { fullName: `Renamed ${code}`, isActive: false }));
        await updateStaffAccount(staffActor(who), updateInput(made, { fullName: `Renamed ${code}`, isActive: true }));
        await updateStaffAccount(staffActor(who), updateInput(made, { fullName: `Renamed ${code}`, roleId: into }));
        await resetStaffPassword(staffActor(who), { userId: id, password: pw() });
        await deleteStaffAccount(staffActor(who), { userId: id });
        const rows = await fresh();
        const expected = ["user.created", "user.updated", "user.deactivated", "user.reactivated", "user.role_changed", "user.password_reset", "user.deleted"];
        expect(rows.map((r) => r.action), `${who.role} ${code}`).toEqual(expected);
        expect(rows.every((r) => r.actorType === "STAFF" && !("reason" in afterOf(r))), `${who.role} ${code}`).toBe(true);
      }
    }
  });

  it("the MD cannot give the Owner role or change an Owner account; the rule 'only an owner' is unchanged", async () => {
    const calls: [string, () => Promise<unknown>][] = [
      ["give the Owner role", () => createStaffAccount(staffActor(md), { fullName: "X Y", email: mail("o"), phone: null, roleId: roleId.OWNER, password: pw() })],
      ["rename the Boss", () => updateStaffAccount(staffActor(md), updateInput(boss, { fullName: "Taken Over" }))],
      ["reset the Boss's password", () => resetStaffPassword(staffActor(md), { userId: boss.id, password: pw() })],
      ["remove the Boss", () => deleteStaffAccount(staffActor(md), { userId: boss.id })],
      ["change the Manager role", () => setRolePermission(staffActor(md), { roleId: roleId.MANAGER, permission: "assets.view", granted: true })],
    ];
    for (const [name, run] of calls) expect((await refusal(run)).code, name).toBe("FORBIDDEN");
  });

  it("rights: the Boss and the MD give and take every right on a role, 'users.manage' and the money rights included; 'developer.access' is nobody's to give", async () => {
    const role = await makeRole("MDWAY", ["rooms.view"]);
    for (const who of [md, boss]) {
      const fresh = await watch(who.id);
      for (const permission of ["users.manage", "payments.record", "settings.manage", "dashboard.manager"]) {
        await setRolePermission(staffActor(who), { roleId: role.id, permission, granted: true });
        expect(await rightsOf(role.code), permission).toContain(permission);
        await setRolePermission(staffActor(who), { roleId: role.id, permission, granted: false });
        expect(await rightsOf(role.code), permission).not.toContain(permission);
      }
      expect((await fresh()).every((r) => r.action === "user.permission_changed" && r.actorType === "STAFF")).toBe(true);
      for (const granted of [true, false]) {
        const err = await refusal(() => setRolePermission(staffActor(who), { roleId: role.id, permission: "developer.access", granted }));
        expect(err.code).toBe("FORBIDDEN");
      }
    }
    expect(await rawDb.rolePermission.count({ where: { permission: { code: "developer.access" } } })).toBe(1); // the Developer role's own
  });

  it("the Developer role and the Developer accounts are not there for them: not listed, 'not found' — the Developer's email is worded like any other taken address", async () => {
    const listed = await staffDirectory();
    expect(listed.users.some((u) => [dev.id, dev2.id].includes(u.id))).toBe(false);
    expect(listed.roles.map((r) => r.code)).not.toContain(DEV);
    expect(listed.roles.map((r) => r.code)).not.toContain("SYSTEM_ONLINE");
    expect(listed.users.some((u) => u.id === person.DRIVER.id)).toBe(true);
    expect(JSON.stringify(listed)).not.toContain("passwordHash");

    for (const who of [md, boss]) {
      const gone = await refusal(() => resetStaffPassword(staffActor(who), { userId: "no-such-account", password: pw() }));
      const dev1 = await refusal(() => resetStaffPassword(staffActor(who), { userId: dev.id, password: pw() }));
      expect([dev1.code, dev1.message], who.role).toEqual([gone.code, gone.message]);
      const role = await refusal(() => createStaffAccount(staffActor(who), { fullName: "X Y", email: mail("dr"), phone: null, roleId: roleId[DEV], password: pw() }));
      const noRole = await refusal(() => createStaffAccount(staffActor(who), { fullName: "X Y", email: mail("dr"), phone: null, roleId: "no-such-role", password: pw() }));
      expect([role.code, role.message], who.role).toEqual([noRole.code, noRole.message]);
      expect((await refusal(() => setRolePermission(staffActor(who), { roleId: roleId[DEV], permission: "payments.record", granted: true }))).code).toBe("NOT_FOUND");

      // an email that is taken: the same words whoever holds it
      const victim = await makeUser("DRIVER", { fullName: `Mail ${who.role}` });
      const ordinary = await refusal(() => createStaffAccount(staffActor(who), { fullName: "Twin", email: person.RECEPTIONIST.email, phone: null, roleId: roleId.DRIVER, password: pw() }));
      const developers = await refusal(() => createStaffAccount(staffActor(who), { fullName: "Twin", email: dev.email, phone: null, roleId: roleId.DRIVER, password: pw() }));
      const moved = await refusal(() => updateStaffAccount(staffActor(who), updateInput(victim, { email: dev2.email })));
      for (const err of [ordinary, developers, moved]) expect([err.code, err.message, err.fieldErrors?.email], who.role).toEqual(["CONFLICT", "A staff account with this email already exists.", "Already in use"]);
    }
  });
});

// ═════════════════════════════════════ what the Developer keeps ═════════════════════════════════════
describe("what the Developer keeps for accounts: suspend, sign out, re-activate its own suspensions — never an account whose role holds a right it is denied", () => {
  it("re-activation, role by role: allowed exactly when the role holds none of the denied rights (money, accounts); refused with its own words and an entry otherwise", async () => {
    const allowed: string[] = [];
    const refused: string[] = [];
    for (const code of SHIPPED.filter((c) => c !== "OWNER")) {
      const target = await makeUser(code, { fullName: `Reactivate ${code}` });
      const d = await developerSession(null);
      await suspendAccount(d, target.id, { reason: GOOD, confirm: "CONFIRM" });
      expect((await rawDb.user.findUniqueOrThrow({ where: { id: target.id } })).isActive, code).toBe(false);
      const holdsDenied = (await rightsOf(code)).some((c) => (DEVELOPER_DENIED as readonly string[]).includes(c));
      const fresh = await watch(dev.id);
      if (holdsDenied) {
        const err = await refusal(() => reactivateAccount(d, target.id, { reason: GOOD }));
        expect([err.code, err.message], code).toEqual(["FORBIDDEN", REACTIVATE_REFUSAL]);
        expect((await rawDb.user.findUniqueOrThrow({ where: { id: target.id } })).isActive, code).toBe(false);
        expect((await fresh()).map((r) => r.action), code).toEqual(["user.reactivate_failed"]);
        refused.push(code);
      } else {
        await reactivateAccount(d, target.id, { reason: GOOD });
        expect((await rawDb.user.findUniqueOrThrow({ where: { id: target.id } })).isActive, code).toBe(true);
        expect((await fresh()).map((r) => r.action), code).toEqual(["user.reactivated"]);
        allowed.push(code);
      }
    }
    expect(allowed.sort()).toEqual(["DRIVER", "KITCHEN", "RESTAURANT"]);
    expect(refused.sort()).toEqual(["ACCOUNTANT", "ADMIN", "FINANCE", "MANAGER", "RECEPTIONIST", "RESTAURANT_SCREEN"]);
  });

  it("it follows the data: a custom role is open until it holds 'users.manage' (or a money right), and open again once that is taken away", async () => {
    const role = await makeRole("FOLLOW", ["rooms.view"]);
    const target = await makeUser(role.code, { fullName: "Follow Person" });
    const d = await developerSession(null);
    await suspendAccount(d, target.id, { reason: GOOD, confirm: "CONFIRM" });
    for (const permission of ["users.manage", "payments.record"]) {
      await setRolePermission(staffActor(md), { roleId: role.id, permission, granted: true });
      expect((await refusal(() => reactivateAccount(d, target.id, { reason: GOOD }))).message, permission).toBe(REACTIVATE_REFUSAL);
      await setRolePermission(staffActor(md), { roleId: role.id, permission, granted: false });
    }
    await reactivateAccount(d, target.id, { reason: GOOD });
    expect((await rawDb.user.findUniqueOrThrow({ where: { id: target.id } })).isActive).toBe(true);
  });

  it("the Boss and the MD switch any account back on from the Users page, as before (the Developer's suspension is theirs to undo)", async () => {
    const target = await makeUser("FINANCE", { fullName: "Back On By Boss" });
    const d = await developerSession(null);
    await suspendAccount(d, target.id, { reason: GOOD, confirm: "CONFIRM" });
    await updateStaffAccount(staffActor(md), updateInput(target, { isActive: true }));
    expect((await rawDb.user.findUniqueOrThrow({ where: { id: target.id } })).isActive).toBe(true);
  });
});

// ═════════════════════════════════════ the code says the same ═════════════════════════════════════
describe("the allow-list machinery is gone, and nothing the Developer uses needs 'users.manage'", () => {
  const root = path.resolve(import.meta.dirname, "../..");
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
    }
    return out;
  };

  it("the removed names are no longer exported", () => {
    for (const gone of ["blocksDeveloper", "roleBlocksDeveloper", "BACK_DOOR_REFUSAL", "DEVELOPER_NO_BACK_DOOR", "MIN_REASON"]) expect(Object.keys(accounts), gone).not.toContain(gone);
    expect(Object.keys(permissionsModule)).not.toContain("DEVELOPER_MANAGEABLE_RIGHTS");
  });

  it("no source file mentions the allow-list of manageable rights or the Developer's reasons for account changes", () => {
    const files = [...walk(path.join(root, "src")), path.join(root, "prisma/seed.ts")];
    for (const file of files) {
      const text = readFileSync(file, "utf8");
      for (const gone of ["DEVELOPER_MANAGEABLE_RIGHTS", "roleBlocksDeveloper", "blocksDeveloper", "BACK_DOOR_REFUSAL", "DEVELOPER_NO_BACK_DOOR", "developerGrantable", "developerNoBackDoor"]) {
        expect(text.includes(gone), `${path.relative(root, file)} still mentions ${gone}`).toBe(false);
      }
    }
  });

  it("the Users page, its dialogs and its matrix have no Developer branch (the Developer never reaches them); the Developer role and right are never shown", () => {
    const dir = path.join(root, "src/app/staff/(app)/users");
    const text = walk(dir).map((f) => readFileSync(f, "utf8")).join("\n");
    for (const gone of ["isDeveloper", "ReasonField", "roleLocked", "passwordLocked", "limited", "developerKeepOn", "lockedPermissions", "outOfReach", "reason"]) expect(new RegExp(`\\b${gone}\\b`).test(text), gone).toBe(false);
    expect(text).toContain("staffDirectory()");
    expect(text).toContain(".filter(([code]) => !isDeveloperOnly(code))");
  });

  it("the Developer's console, its Access page and the work-as service never ask for 'users.manage' (they use 'developer.access')", () => {
    const files = [
      ...walk(path.join(root, "src/app/staff/(app)/developer")),
      ...readdirSync(path.join(root, "src/server/services")).filter((f) => /^(developer-|work-as)/.test(f) && !/\.test\./.test(f)).map((f) => path.join(root, "src/server/services", f)),
      ...readdirSync(path.join(root, "src/lib")).filter((f) => /^developer-/.test(f) && !/\.test\./.test(f)).map((f) => path.join(root, "src/lib", f)),
    ];
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) expect(readFileSync(file, "utf8").includes("users.manage"), path.relative(root, file)).toBe(false);
  });
});

// ═════════════════════════════════════ the document and the Access page ═════════════════════════════════════
describe("docs/developer-account.md says it plainly", () => {
  const doc = readFileSync(path.resolve(import.meta.dirname, "../../docs/developer-account.md"), "utf8");

  it("the Developer cannot create or change accounts, passwords, login emails, roles or rights; only the Boss and the MD can; what the Developer keeps", () => {
    for (const phrase of [
      "**The Developer cannot create or change accounts, passwords, login emails, roles or rights (owner, 2026-10-18).**", "Only the **Boss and the MD** can",
      "**Work as**", "**Suspend**", "**Sign out everywhere**", "**re-activating an account it suspended itself**",
      `"${DEVELOPER_NO_ACCOUNTS}"`, "`users.manage`", "So there is no smaller version.",
    ]) expect(doc, phrase).toContain(phrase);
  });

  it("keeps the honest risk note about suspending, and the Boss's remedy", () => {
    expect(doc).toContain("someone who stole the Developer's password could suspend the MD, Finance, the managers and Reception in a few clicks");
    expect(doc).toContain("the Boss or the MD opens **Staff & roles** (the Users page), opens the person and ticks **Account active**");
    expect(doc).toContain("The Boss is told on WhatsApp every time you suspend an account");
  });

  it("no longer describes the allow-list, the harmless rights, accounts the Developer may manage, or the Developer's reasons for account changes", () => {
    for (const gone of [
      "short list", "DEVELOPER_MANAGEABLE_RIGHTS", "allow-list", "harmless", "Which built-in roles you can and cannot manage", "manage the few staff accounts", "This email cannot be used",
      "The Developer cannot switch an account on or off from the **Users** page", "sensitive change to staff accounts or roles", "(staff accounts, roles, suspending)",
    ]) expect(doc, gone).not.toContain(gone);
  });
});
