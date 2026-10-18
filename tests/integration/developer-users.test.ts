import { randomUUID } from "node:crypto";
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

import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { getCurrentUser, verifyPassword } from "@/server/auth";
import { authenticate } from "@/server/services/auth-login";
import { createStaffAccount, deleteStaffAccount, DEVELOPER_NO_ACCOUNTS, resetStaffPassword, setRolePermission, staffDirectory, updateStaffAccount, type AccountActor, type UpdateAccountInput } from "@/server/services/staff-accounts";
import { createUserAction, deleteUserAction, resetPasswordAction, setRolePermissionAction, updateUserAction } from "@/app/staff/(app)/users/actions";
import { browser, makeSession, makeUser, removeMadeUsers, thrownBy, type MadeUser } from "../support/developer";

/**
 * Staff accounts and the Developer account (owner, 2026-10-14, changed 2026-10-18) — every rule lives in server/services/staff-accounts.ts and
 * is proven here against a real database:
 *   - nobody can make a Developer account or give its role to anyone;
 *   - nobody but a Developer can see, edit, switch off, reset, remove or re-role a Developer account (it is simply "not found"), and the
 *     Developer account and role are never listed;
 *   - nobody can give "developer.access" to a role or change the Developer role's rights;
 *   - nobody changes their own role;
 *   - a password is never in the audit trail, and a reset follows the same strength rule for everyone;
 *   - THE DEVELOPER CANNOT CREATE OR CHANGE ACCOUNTS, PASSWORDS, LOGIN EMAILS, ROLES OR RIGHTS AT ALL (owner, 2026-10-18): it is refused with
 *     one message, and the refusal is kept in the audit trail. Table-driven over every shipped role, every kind of change and every right:
 *     developer-accounts-off.test.ts. Here: the same refusal through each rule above, and the Boss and the MD doing it all as before.
 * Every scenario counts the audit rows its actor wrote, so a missing or an extra entry fails the test.
 */

const DEV = "DEVELOPER";
/** An ordinary custom role (it holds only two rights): made for these tests. */
const CALM = `DEVUSERSCALM${randomUUID().slice(0, 6).toUpperCase()}`;
let dev: MadeUser;
let devTarget: MadeUser; // a second Developer account (something staff must never see or touch)
let md: MadeUser;
let boss: MadeUser;
let rec: MadeUser;
let devRoleId: string;
let recRoleId: string;
let mgrRoleId: string;
let adminRoleId: string;
let calmRoleId: string;
let driverRoleId: string;
const customRoles: string[] = [];

const roleIdOf = async (code: string) => (await db.role.findUniqueOrThrow({ where: { code } })).id;
const actorOf = (u: MadeUser): AccountActor => ({ id: u.id, fullName: u.fullName, roleCode: u.role, actorType: u.role === DEV ? "DEVELOPER" : "STAFF" });
const mail = (tag: string) => `${tag}-${randomUUID().slice(0, 8)}@devusers.local`;
const pw = () => `Pw${randomUUID().slice(0, 8)}-7z`;

/** An audit watcher: gives the entries one account wrote since it was started (oldest first). */
async function watch(userId: string) {
  const seen = (await db.auditLog.findMany({ where: { userId }, select: { id: true } })).map((r) => r.id);
  return () => db.auditLog.findMany({ where: { userId, id: { notIn: seen } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}
const afterOf = (row: { after: unknown }) => (row.after ?? {}) as Record<string, unknown>;
async function refusal(run: () => Promise<unknown>): Promise<AppError> {
  const e = await thrownBy(run);
  expect(e, "an error was expected").toBeInstanceOf(AppError);
  return e as AppError;
}
/** The codes of the rights a role holds, sorted. */
const rightsOf = async (roleCode: string) =>
  (await db.rolePermission.findMany({ where: { role: { code: roleCode } }, select: { permission: { select: { code: true } } } })).map((r) => r.permission.code).sort();
const developerAccessHolders = async () =>
  (await db.rolePermission.findMany({ where: { permission: { code: "developer.access" } }, select: { role: { select: { code: true } } } })).map((r) => r.role.code).sort();

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Dev Users" });
  devTarget = await makeUser("DEVELOPER", { fullName: "Second Dev Users" });
  md = await makeUser("ADMIN", { fullName: "MD Users" });
  boss = await makeUser("OWNER", { fullName: "Boss Users" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Asha Users" });
  [devRoleId, recRoleId, mgrRoleId, adminRoleId, driverRoleId] = await Promise.all([roleIdOf("DEVELOPER"), roleIdOf("RECEPTIONIST"), roleIdOf("MANAGER"), roleIdOf("ADMIN"), roleIdOf("DRIVER")]);
  customRoles.push(CALM);
  const calm = await db.role.create({ data: { code: CALM, name: "Calm test role" } });
  calmRoleId = calm.id;
  for (const code of ["rooms.view", "rooms.status.update"]) {
    await db.rolePermission.create({ data: { roleId: calm.id, permissionId: (await db.permission.findUniqueOrThrow({ where: { code } })).id } });
  }
});
afterAll(async () => {
  await db.user.deleteMany({ where: { email: { endsWith: "@devusers.local" } } });
  await removeMadeUsers();
  for (const code of customRoles) {
    await db.user.deleteMany({ where: { role: { code } } });
    await db.rolePermission.deleteMany({ where: { role: { code } } });
    await db.role.deleteMany({ where: { code } });
  }
});
beforeEach(() => {
  browser.reset();
});

const STAFF_CREATED = (name: string, email: string, roleId: string) => ({ fullName: name, email, phone: null, roleId, password: pw() });
const updateInput = async (userId: string, over: Partial<UpdateAccountInput> = {}): Promise<UpdateAccountInput> => {
  const u = await db.user.findUniqueOrThrow({ where: { id: userId } });
  return { userId, fullName: u.fullName, email: u.email, phone: u.phone, roleId: u.roleId, isActive: u.isActive, ...over };
};

// ═════════════════════════════════════ nobody can make a Developer ═════════════════════════════════════
describe("the Developer role is never given — not at creation, not by promotion", () => {
  it("creating an account with the Developer role is refused for the Developer, the MD and the Boss; no account appears; each refusal is one 'create_failed' entry", async () => {
    const unknownRole = await refusal(() => createStaffAccount(actorOf(md), STAFF_CREATED("Nobody", mail("x"), "no-such-role")));
    for (const [name, a, code] of [["Developer", dev, "FORBIDDEN"], ["MD", md, "NOT_FOUND"], ["Boss", boss, "NOT_FOUND"]] as const) {
      const fresh = await watch(a.id);
      const email = mail("mk");
      const accounts = await db.user.count();
      const err = await refusal(() => createStaffAccount(actorOf(a), STAFF_CREATED("Sneaky Dev", email, devRoleId)));
      expect(err.code, name).toBe(code);
      if (a === dev) expect(err.message, name).toBe(DEVELOPER_NO_ACCOUNTS);
      else expect([err.message, err.code], `${name}: the Developer role looks exactly like a role that does not exist`).toEqual([unknownRole.message, unknownRole.code]);
      expect(await db.user.count({ where: { email } }), name).toBe(0);
      expect(await db.user.count(), name).toBe(accounts);
      const rows = await fresh();
      expect(rows.map((r) => r.action), name).toEqual(["user.create_failed"]);
      expect(rows[0]).toMatchObject({ actorType: a === dev ? "DEVELOPER" : "STAFF", actorRole: a.role, entityType: "User" });
      expect(afterOf(rows[0]).code, name).toBe(code);
    }
  });

  it("promoting anyone to Developer is refused: the person keeps their role and their sessions; one 'update_failed' entry each", async () => {
    const victim = await makeUser(CALM, { fullName: "Victim Promote" });
    await makeSession(victim.id, { setCookie: false });
    for (const [name, a, code] of [["Developer", dev, "FORBIDDEN"], ["MD", md, "NOT_FOUND"], ["Boss", boss, "NOT_FOUND"]] as const) {
      const fresh = await watch(a.id);
      const before = await db.user.findUniqueOrThrow({ where: { id: victim.id } });
      const err = await refusal(async () => updateStaffAccount(actorOf(a), { ...(await updateInput(victim.id)), roleId: devRoleId }));
      expect(err.code, name).toBe(code);
      expect(await db.user.findUniqueOrThrow({ where: { id: victim.id } }), name).toEqual(before);
      expect(await db.session.count({ where: { userId: victim.id } }), name).toBe(1);
      const rows = await fresh();
      expect(rows.map((r) => r.action), name).toEqual(["user.update_failed"]);
      expect(rows[0]).toMatchObject({ entityId: victim.id, actorType: a === dev ? "DEVELOPER" : "STAFF" });
    }
  });

  it("the system account's role cannot be given either (the same door)", async () => {
    const err = await refusal(async () => createStaffAccount(actorOf(md), STAFF_CREATED("System?", mail("sys"), await roleIdOf("SYSTEM_ONLINE"))));
    expect([err.code, err.message]).toEqual(["FORBIDDEN", "That role is for the system only."]);
  });
});

// ═════════════════════════════════════ a Developer account is invisible to others ═════════════════════════════════════
describe("a Developer account is 'not found' for everyone who can reach the account service", () => {
  it("staff cannot edit, switch off, re-role, re-email, reset or remove it — each is 'not found', the same as an account that does not exist; nothing changes; each refusal is one entry", async () => {
    await makeSession(devTarget.id, { setCookie: false });
    const original = await db.user.findUniqueOrThrow({ where: { id: devTarget.id } });
    const gone = "no-such-account";

    const attempts: { name: string; failed: string; run: (a: AccountActor, id: string) => Promise<unknown> }[] = [
      { name: "edit the name", failed: "user.update_failed", run: async (a, id) => updateStaffAccount(a, { ...(await maybeInput(id)), fullName: "Renamed By Staff" }) },
      { name: "switch it off", failed: "user.update_failed", run: async (a, id) => updateStaffAccount(a, { ...(await maybeInput(id)), isActive: false }) },
      { name: "give it another role", failed: "user.update_failed", run: async (a, id) => updateStaffAccount(a, { ...(await maybeInput(id)), roleId: mgrRoleId }) },
      { name: "change its email", failed: "user.update_failed", run: async (a, id) => updateStaffAccount(a, { ...(await maybeInput(id)), email: mail("takeover") }) },
      { name: "reset its password", failed: "user.password_reset_failed", run: (a, id) => resetStaffPassword(a, { userId: id, password: pw() }) },
      { name: "remove it", failed: "user.delete_failed", run: (a, id) => deleteStaffAccount(a, { userId: id }) },
    ];
    async function maybeInput(id: string): Promise<UpdateAccountInput> {
      return id === devTarget.id ? updateInput(id) : { userId: id, fullName: "X Y", email: mail("e"), phone: null, roleId: devRoleId, isActive: true };
    }

    for (const [who, a] of [["MD", md], ["Boss", boss]] as const) {
      const fresh = await watch(a.id);
      for (const at of attempts) {
        const real = await refusal(() => at.run(actorOf(a), devTarget.id));
        const unknown = await refusal(() => at.run(actorOf(a), gone));
        expect(real.code, `${who}: ${at.name}`).toBe("NOT_FOUND");
        expect([real.message, real.code], `${who}: ${at.name} — same answer as for an account that does not exist`).toEqual([unknown.message, unknown.code]);
      }
      // nothing about the Developer account moved
      expect(await db.user.findUniqueOrThrow({ where: { id: devTarget.id } }), who).toEqual(original);
      expect(await db.session.count({ where: { userId: devTarget.id } }), who).toBe(1);
      // 6 attempts on the Developer account + 6 on the missing one = 12 refusals, each kept, none a success
      const rows = await fresh();
      expect(rows).toHaveLength(12);
      expect(rows.map((r) => r.action).sort()).toEqual([...attempts, ...attempts].map((x) => x.failed).sort());
      expect(rows.every((r) => r.actorType === "STAFF" && afterOf(r).code === "NOT_FOUND"), who).toBe(true);
      expect(rows.filter((r) => r.entityId === devTarget.id)).toHaveLength(6);
    }
    expect(await db.auditLog.count({ where: { entityId: devTarget.id, action: { in: ["user.updated", "user.role_changed", "user.deactivated", "user.password_reset", "user.deleted"] } } })).toBe(0);
  });

  it("the Users list: no Developer account, no Developer role, no system account, no hash — for anyone", async () => {
    const list = await staffDirectory();
    expect(list.users.map((u) => u.role.code)).not.toContain("DEVELOPER");
    expect(list.users.some((u) => [dev.id, devTarget.id].includes(u.id))).toBe(false);
    expect(list.roles.map((r) => r.code)).not.toContain("DEVELOPER");
    expect(list.roles.map((r) => r.code)).not.toContain("SYSTEM_ONLINE");
    expect(list.users.map((u) => u.email)).not.toContain("online-payments@system.invalid");
    expect(list.users.some((u) => u.id === rec.id)).toBe(true);
    expect(list.roles.map((r) => r.code)).toEqual(expect.arrayContaining(["OWNER", "ADMIN", "MANAGER", "RECEPTIONIST"]));
    expect(JSON.stringify(list)).not.toContain("passwordHash");
    expect(JSON.stringify(list)).not.toContain("argon2");
  });

  it("another Developer's account is not the Developer's to edit either: refused with the one message, the account is unchanged", async () => {
    const before = await db.user.findUniqueOrThrow({ where: { id: devTarget.id } });
    const fresh = await watch(dev.id);
    const err = await refusal(async () => updateStaffAccount(actorOf(dev), { ...(await updateInput(devTarget.id)), fullName: "Second Dev Renamed" }));
    expect([err.code, err.message]).toEqual(["FORBIDDEN", DEVELOPER_NO_ACCOUNTS]);
    expect(await db.user.findUniqueOrThrow({ where: { id: devTarget.id } })).toEqual(before);
    expect((await fresh()).map((r) => r.action)).toEqual(["user.update_failed"]);
  });
});

// ═════════════════════════════════════ rights: developer.access and the Developer role ═════════════════════════════════════
describe("rights: nobody gives 'developer.access', nobody changes the Developer role", () => {
  it("developer.access cannot be given to any role by the Developer, the MD or the Boss — only the Developer role holds it, before and after", async () => {
    expect(await developerAccessHolders()).toEqual([DEV]);
    let attempts = 0;
    const perActor = new Map<string, number>();
    for (const a of [dev, md, boss]) {
      const fresh = await watch(a.id);
      for (const roleCode of ["RECEPTIONIST", "MANAGER", "ADMIN", "FINANCE", "OWNER", "DEVELOPER"]) {
        for (const granted of [true, false]) {
          const err = await refusal(async () => setRolePermission(actorOf(a), { roleId: await roleIdOf(roleCode), permission: "developer.access", granted }));
          expect(err.code, `${a.role} ${roleCode} ${granted}`).toBe("FORBIDDEN");
          if (a === dev) expect(err.message).toBe(DEVELOPER_NO_ACCOUNTS);
          attempts++;
          perActor.set(a.id, (perActor.get(a.id) ?? 0) + 1);
        }
      }
      const rows = await fresh();
      expect(rows, a.role).toHaveLength(perActor.get(a.id)!);
      expect(rows.every((r) => r.action === "user.permission_change_failed" && r.actorType === (a === dev ? "DEVELOPER" : "STAFF")), a.role).toBe(true);
    }
    expect(attempts).toBe(36);
    expect(await developerAccessHolders()).toEqual([DEV]);
  });

  it("the Developer role's rights cannot be changed: the Developer is refused ('forbidden'), staff get 'not found'; the rights stay exactly the same", async () => {
    const before = await rightsOf(DEV);
    expect(before).toContain("developer.access");
    expect(before).not.toContain("payments.record");
    expect(before).not.toContain("users.manage");
    const changes = [{ permission: "payments.record", granted: true }, { permission: "reservations.view", granted: false }, { permission: "audit.view", granted: false }, { permission: "users.manage", granted: true }];
    const fresh = await watch(dev.id);
    const freshMd = await watch(md.id);
    for (const c of changes) {
      expect((await refusal(() => setRolePermission(actorOf(dev), { roleId: devRoleId, ...c }))).code, `Developer ${c.permission}`).toBe("FORBIDDEN");
      expect((await refusal(() => setRolePermission(actorOf(md), { roleId: devRoleId, ...c }))).code, `MD ${c.permission}`).toBe("NOT_FOUND");
    }
    expect(await rightsOf(DEV)).toEqual(before);
    expect((await fresh()).map((r) => r.action)).toEqual(changes.map(() => "user.permission_change_failed"));
    expect((await freshMd()).map((r) => r.action)).toEqual(changes.map(() => "user.permission_change_failed"));
  });

  it("a name that is not a right ('constructor', '__proto__', 'toString', '') is 'Unknown permission' for the MD — a clean refusal, never a server error; the Developer is refused first", async () => {
    const freshMd = await watch(md.id);
    const fresh = await watch(dev.id);
    const names = ["no.such.right", "constructor", "__proto__", "toString", "hasOwnProperty", ""];
    for (const permission of names) {
      const err = await refusal(() => setRolePermission(actorOf(md), { roleId: recRoleId, permission, granted: true }));
      expect([err.code, err.message], `MD "${permission}"`).toEqual(["VALIDATION", "Unknown permission."]);
      const refused = await refusal(() => setRolePermission(actorOf(dev), { roleId: recRoleId, permission, granted: true }));
      expect([refused.code, refused.message], `Developer "${permission}"`).toEqual(["FORBIDDEN", DEVELOPER_NO_ACCOUNTS]);
    }
    expect(await freshMd(), "a mistake in a form is not worth a line for staff").toHaveLength(0);
    expect((await fresh()).map((r) => r.action)).toEqual(names.map(() => "user.permission_change_failed"));
  });

  it("the Owner role, the Manager role (for the MD) and the system role stay closed to the MD", async () => {
    const owner = await roleIdOf("OWNER");
    const fresh = await watch(md.id);
    expect((await refusal(() => setRolePermission(actorOf(md), { roleId: owner, permission: "assets.view", granted: false }))).code).toBe("VALIDATION");
    expect((await refusal(() => setRolePermission(actorOf(md), { roleId: mgrRoleId, permission: "assets.view", granted: true }))).code).toBe("FORBIDDEN");
    expect((await refusal(async () => setRolePermission(actorOf(md), { roleId: await roleIdOf("SYSTEM_ONLINE"), permission: "assets.view", granted: true }))).code).toBe("FORBIDDEN");
    // (a mistake in a form is not an entry; a refusal is)
    expect((await fresh()).map((r) => r.action)).toEqual(["user.permission_change_failed", "user.permission_change_failed"]);
  });
});

// ═════════════════════════════════════ your own account ═════════════════════════════════════
describe("nobody changes their own role or switches themself off", () => {
  it("the MD and the Boss are each refused when they change their own role (to a staff role or the Developer role) or switch themself off; the Developer is refused outright", async () => {
    for (const a of [dev, md, boss]) {
      const fresh = await watch(a.id);
      const before = await db.user.findUniqueOrThrow({ where: { id: a.id } });
      let tries = 0;
      const own = await roleIdOf(a.role);
      const changes: Partial<UpdateAccountInput>[] = [{ roleId: mgrRoleId }, { roleId: recRoleId }, { roleId: devRoleId }, { roleId: adminRoleId }, { isActive: false }];
      for (const change of changes) {
        if (change.roleId === own) continue; // the role they already have is not a change
        const err = await refusal(async () => updateStaffAccount(actorOf(a), { ...(await updateInput(a.id)), ...change }));
        expect(err, `${a.role} ${JSON.stringify(change)}`).toBeInstanceOf(AppError);
        if (a === dev) expect(err.message).toBe(DEVELOPER_NO_ACCOUNTS);
        tries++;
      }
      expect(tries, a.role).toBe(a === boss ? 5 : 4); // the five changes, minus the role they already hold (the Owner role is not in the list)
      expect(await db.user.findUniqueOrThrow({ where: { id: a.id } }), a.role).toEqual(before);
      const rows = await fresh();
      if (a === dev) {
        expect(rows, "the Developer's every refusal is kept").toHaveLength(tries);
        expect(rows.every((r) => r.action === "user.update_failed" && r.actorType === "DEVELOPER")).toBe(true);
      }
      expect(rows.filter((r) => ["user.updated", "user.role_changed", "user.deactivated"].includes(r.action)), `${a.role}: no success entry`).toHaveLength(0);
    }
  });

  it("nobody removes their own account: the MD is told so, the Developer is refused with the one message", async () => {
    const fresh = await watch(md.id);
    const err = await refusal(() => deleteStaffAccount(actorOf(md), { userId: md.id }));
    expect(err.message).toMatch(/own account/i);
    expect(await db.user.count({ where: { id: md.id } })).toBe(1);
    expect(await fresh(), "for staff a plain 'no' to a form is not an entry").toHaveLength(0);

    const freshDev = await watch(dev.id);
    const refused = await refusal(() => deleteStaffAccount(actorOf(dev), { userId: dev.id }));
    expect(refused.message).toBe(DEVELOPER_NO_ACCOUNTS);
    expect(await db.user.count({ where: { id: dev.id } })).toBe(1);
    expect((await freshDev()).map((r) => r.action)).toEqual(["user.delete_failed"]);
  });

  it("the Developer cannot even edit its own name or phone here (it uses its account page); the MD edits his own", async () => {
    const before = await db.user.findUniqueOrThrow({ where: { id: dev.id } });
    const fresh = await watch(dev.id);
    const err = await refusal(async () => updateStaffAccount(actorOf(dev), { ...(await updateInput(dev.id)), phone: "+255700000001" }));
    expect(err.message).toBe(DEVELOPER_NO_ACCOUNTS);
    expect(await db.user.findUniqueOrThrow({ where: { id: dev.id } })).toEqual(before);
    expect((await fresh()).map((r) => r.action)).toEqual(["user.update_failed"]);
    await updateStaffAccount(actorOf(md), { ...(await updateInput(md.id)), phone: "+255700000002" });
    expect((await db.user.findUniqueOrThrow({ where: { id: md.id } })).phone).toBe("+255700000002");
  });
});

// ═════════════════════════════════════ what is written ═════════════════════════════════════
describe("every change is audited with before and after, as the person who made it; staff are never asked for a reason", () => {
  it("the MD's seven kinds of change succeed: one STAFF entry each, with before / after, no reason", async () => {
    const victim = await makeUser("RECEPTIONIST", { fullName: "Victim Staff" });
    const doomed = await makeUser("RECEPTIONIST", { fullName: "Doomed Staff" });
    const a = actorOf(md);
    const fresh = await watch(md.id);
    const newAccountEmail = mail("new");
    const newLogin = mail("login");
    const role = await db.role.create({ data: { code: `DEVUSERSOPS${randomUUID().slice(0, 6).toUpperCase()}`, name: "Ops test role" } });
    customRoles.push(role.code);
    const ops: { name: string; ok: string; run: () => Promise<unknown>; snapshot: () => Promise<unknown> }[] = [
      { name: "create an account", ok: "user.created", run: () => createStaffAccount(a, STAFF_CREATED("Reason Test", newAccountEmail, calmRoleId)), snapshot: () => db.user.findMany({ where: { email: newAccountEmail } }) },
      { name: "change a role", ok: "user.role_changed", run: async () => updateStaffAccount(a, { ...(await updateInput(victim.id)), roleId: driverRoleId }), snapshot: () => db.user.findUniqueOrThrow({ where: { id: victim.id } }) },
      { name: "switch an account off", ok: "user.deactivated", run: async () => updateStaffAccount(a, { ...(await updateInput(victim.id)), isActive: false }), snapshot: () => db.user.findUniqueOrThrow({ where: { id: victim.id } }) },
      { name: "change the sign-in email", ok: "user.updated", run: async () => updateStaffAccount(a, { ...(await updateInput(victim.id)), email: newLogin }), snapshot: () => db.user.findUniqueOrThrow({ where: { id: victim.id } }) },
      { name: "reset a password", ok: "user.password_reset", run: () => resetStaffPassword(a, { userId: victim.id, password: pw() }), snapshot: () => db.user.findUniqueOrThrow({ where: { id: victim.id } }) },
      { name: "change a role's rights", ok: "user.permission_changed", run: () => setRolePermission(a, { roleId: role.id, permission: "assets.view", granted: true }), snapshot: () => rightsOf(role.code) },
      { name: "remove an account", ok: "user.deleted", run: () => deleteStaffAccount(a, { userId: doomed.id }), snapshot: () => db.user.findUnique({ where: { id: doomed.id } }) },
    ];
    for (const op of ops) {
      const state = await op.snapshot();
      await op.run();
      expect(await op.snapshot(), `${op.name}: it happened`).not.toEqual(state);
    }
    const rows = await fresh();
    expect(rows.map((r) => r.action)).toEqual(ops.map((o) => o.ok));
    expect(rows.every((r) => r.actorType === "STAFF" && r.actorRole === "ADMIN" && r.actorLabel === md.fullName && !("reason" in afterOf(r)))).toBe(true);
    const byAction = Object.fromEntries(rows.map((r) => [r.action, r]));
    expect(byAction["user.created"].before).toBeNull();
    expect(afterOf(byAction["user.created"])).toMatchObject({ fullName: "Reason Test", role: CALM });
    expect(byAction["user.role_changed"].before).toMatchObject({ role: "RECEPTIONIST", isActive: true });
    expect(afterOf(byAction["user.role_changed"])).toMatchObject({ role: "DRIVER", isActive: true });
    expect(byAction["user.updated"].before).toMatchObject({ email: victim.email });
    expect(afterOf(byAction["user.password_reset"])).toMatchObject({ reset: true, signedOut: 0 }); // the earlier changes already ended the sessions
    expect(byAction["user.permission_changed"].before).toMatchObject({ permission: "assets.view", granted: false });
    expect(afterOf(byAction["user.permission_changed"])).toMatchObject({ permission: "assets.view", granted: true });
    expect(byAction["user.deleted"].before).toMatchObject({ fullName: doomed.fullName, email: doomed.email, role: "RECEPTIONIST" });
    expect(await db.user.count({ where: { id: doomed.id } })).toBe(0);
  });

  it("the entries hold no password and no hash — neither the ones typed nor the stored ones — success or refusal", async () => {
    const typed = [pw(), pw(), pw()];
    const victim = await makeUser(CALM, { fullName: "Victim Secrets" });
    const fresh = await watch(md.id);
    await createStaffAccount(actorOf(md), { fullName: "Secret Maker", email: mail("sec"), phone: null, roleId: calmRoleId, password: typed[0] });
    await refusal(() => resetStaffPassword(actorOf(md), { userId: "no-such-account", password: typed[1] }));
    await resetStaffPassword(actorOf(md), { userId: victim.id, password: typed[2] });
    const rows = await fresh();
    expect(rows).toHaveLength(3);
    const text = JSON.stringify(rows);
    for (const secret of typed) expect(text).not.toContain(secret);
    expect(text).not.toContain("argon2");
    const stored = await db.user.findMany({ where: { id: { in: [victim.id, md.id, rec.id] } }, select: { passwordHash: true } });
    for (const s of stored) expect(text).not.toContain(s.passwordHash);
  });
});

// ═════════════════════════════════════ passwords ═════════════════════════════════════
describe("passwords follow one strength rule for everyone who can set them", () => {
  it("a weak password on a reset is refused for the MD and the Boss (a form mistake: no entry); the old password and the sessions are untouched", async () => {
    const victim = await makeUser(CALM, { fullName: "Victim Weak" });
    await makeSession(victim.id, { setCookie: false });
    const before = await db.user.findUniqueOrThrow({ where: { id: victim.id } });
    const weak = ["Zq1short", "qwertyuiopasdfgh", "7777777777777", ""];
    const freshMd = await watch(md.id);
    const freshBoss = await watch(boss.id);
    for (const password of weak) {
      for (const a of [md, boss]) {
        const err = await refusal(() => resetStaffPassword(actorOf(a), { userId: victim.id, password }));
        expect([err.code, Boolean(err.fieldErrors?.password)], `${a.role} "${password}"`).toEqual(["VALIDATION", true]);
      }
    }
    expect(await db.user.findUniqueOrThrow({ where: { id: victim.id } })).toEqual(before);
    expect(await db.session.count({ where: { userId: victim.id } })).toBe(1);
    expect((await authenticate(victim.email, victim.password)).ok).toBe(true); // the old password still works
    expect(await freshMd(), "for staff a weak password is a form mistake, not an entry").toHaveLength(0);
    expect(await freshBoss()).toHaveLength(0);
  });

  it("a weak password on a new account is refused for the MD; no account appears", async () => {
    const fresh = await watch(md.id);
    const email = mail("weak");
    for (const password of ["Zq1short", "qwertyuiopasdfgh"]) {
      const err = await refusal(() => createStaffAccount(actorOf(md), { fullName: "Weak Pw", email, phone: null, roleId: calmRoleId, password }));
      expect(err.code).toBe("VALIDATION");
    }
    expect(await db.user.count({ where: { email } })).toBe(0);
    expect(await fresh()).toHaveLength(0);
  });

  it("a strong password resets: the new password signs in, the old one does not, the person's sessions end; the entry holds no password", async () => {
    const victim = await makeUser(CALM, { fullName: "Victim Strong" });
    await makeSession(victim.id, { setCookie: false });
    await makeSession(victim.id, { setCookie: false });
    const fresh = await watch(md.id);
    const next = pw();
    await resetStaffPassword(actorOf(md), { userId: victim.id, password: next });

    const row = await db.user.findUniqueOrThrow({ where: { id: victim.id } });
    expect(await verifyPassword(row.passwordHash, next)).toBe(true);
    expect(await verifyPassword(row.passwordHash, victim.password)).toBe(false);
    expect((await authenticate(victim.email, next)).ok).toBe(true);
    expect((await authenticate(victim.email, victim.password)).ok).toBe(false);
    expect(await db.session.count({ where: { userId: victim.id } })).toBe(0);

    const rows = await fresh();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "user.password_reset", actorType: "STAFF", entityId: victim.id });
    expect(afterOf(rows[0])).toEqual({ reset: true, signedOut: 2 });
    expect(rows[0].before).toEqual({ fullName: victim.fullName, email: victim.email, role: CALM });
    expect(JSON.stringify(rows)).not.toContain(next);
    expect(JSON.stringify(rows)).not.toContain(row.passwordHash);
  });

  it("no one resets a Developer account's password here: staff find it 'not found'; the Boss and the MD still reset their own", async () => {
    for (const a of [md, boss]) {
      const err = await refusal(() => resetStaffPassword(actorOf(a), { userId: devTarget.id, password: pw() }));
      expect(err.code, a.role).toBe("NOT_FOUND");
    }
    for (const a of [md, boss]) {
      const next = pw();
      await resetStaffPassword(actorOf(a), { userId: a.id, password: next });
      expect((await authenticate(a.email, next)).ok, a.role).toBe(true);
    }
  });
});

// ═════════════════════════════════════ Owner accounts ═════════════════════════════════════
describe("only the Boss touches the Boss", () => {
  it("the MD cannot give the Owner role, change, reset or remove an Owner account; each refusal is kept; the Boss can", async () => {
    const ownerRoleId = await roleIdOf("OWNER");
    const victim = await makeUser(CALM, { fullName: "Victim Owner" });
    const owner = await makeUser("OWNER", { fullName: "Other Boss" });
    const before = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
    const fresh = await watch(md.id);
    const codes = [
      (await refusal(async () => updateStaffAccount(actorOf(md), { ...(await updateInput(victim.id)), roleId: ownerRoleId }))).code,
      (await refusal(async () => updateStaffAccount(actorOf(md), { ...(await updateInput(owner.id)), fullName: "Taken Over" }))).code,
      (await refusal(() => resetStaffPassword(actorOf(md), { userId: owner.id, password: pw() }))).code,
      (await refusal(() => deleteStaffAccount(actorOf(md), { userId: owner.id }))).code,
      (await refusal(() => createStaffAccount(actorOf(md), STAFF_CREATED("Second Boss", mail("boss"), ownerRoleId)))).code,
    ];
    expect(codes).toEqual(Array(5).fill("FORBIDDEN"));
    expect(await db.user.findUniqueOrThrow({ where: { id: owner.id } })).toEqual(before);
    expect((await db.user.findUniqueOrThrow({ where: { id: victim.id } })).roleId).toBe(calmRoleId);
    expect((await fresh()).map((r) => r.action)).toEqual(["user.update_failed", "user.update_failed", "user.password_reset_failed", "user.delete_failed", "user.create_failed"]);

    await updateStaffAccount(actorOf(boss), { ...(await updateInput(owner.id)), fullName: "Renamed By Boss" });
    expect((await db.user.findUniqueOrThrow({ where: { id: owner.id } })).fullName).toBe("Renamed By Boss");
  });
});

// ═════════════════════════════════════ sessions end ═════════════════════════════════════
describe("a person's sessions end when their account is switched off, re-roled, re-emailed, reset or removed", () => {
  it("each change by the MD signs the person out at once: the session rows go and the old cookie is no longer a user", async () => {
    const changes: [string, (v: MadeUser) => Promise<unknown>][] = [
      ["switch off", async (v) => updateStaffAccount(actorOf(md), { ...(await updateInput(v.id)), isActive: false })],
      ["new role", async (v) => updateStaffAccount(actorOf(md), { ...(await updateInput(v.id)), roleId: mgrRoleId })],
      ["new email", async (v) => updateStaffAccount(actorOf(md), { ...(await updateInput(v.id)), email: mail("moved") })],
      ["password reset", (v) => resetStaffPassword(actorOf(md), { userId: v.id, password: pw() })],
      ["removal", (v) => deleteStaffAccount(actorOf(md), { userId: v.id })],
    ];
    for (const [name, change] of changes) {
      browser.reset();
      const v = await makeUser("RECEPTIONIST", { fullName: `Victim ${name}` });
      const token = await makeSession(v.id);
      expect((await getCurrentUser())?.id, name).toBe(v.id);
      await change(v);
      expect(await db.session.count({ where: { userId: v.id } }), name).toBe(0);
      browser.cookies.set("vlh_session", token);
      expect(await getCurrentUser(), name).toBeNull();
    }
  });

  it("a plain edit (name, phone) does not sign anybody out", async () => {
    const v = await makeUser("RECEPTIONIST", { fullName: "Victim Plain" });
    await makeSession(v.id);
    await updateStaffAccount(actorOf(md), { ...(await updateInput(v.id)), fullName: "Victim Plain Two", phone: "+255700000003" });
    expect((await getCurrentUser())?.id).toBe(v.id);
  });

  it("an account switched off straight in the database has no session on its very next request, a Developer's included", async () => {
    for (const role of ["RECEPTIONIST", "DEVELOPER"]) {
      browser.reset();
      const v = await makeUser(role, { fullName: `Midway ${role}` });
      await makeSession(v.id);
      expect((await getCurrentUser())?.id, role).toBe(v.id);
      await db.user.update({ where: { id: v.id }, data: { isActive: false } });
      expect(await getCurrentUser(), role).toBeNull();
    }
  });
});

// ═════════════════════════════════════ through the Users actions ═════════════════════════════════════
describe("through the Users actions: who acts comes from the session, never from the form", () => {
  const form = (fields: Record<string, string>) => {
    const f = new FormData();
    for (const [k, v] of Object.entries(fields)) f.set(k, v);
    return f;
  };

  it("the Developer is refused by every Users action — it holds no 'users.manage' — whatever the form claims about who is acting; nothing is written but its 'denied' entries", async () => {
    await makeSession(dev.id);
    const victim = await makeUser("RECEPTIONIST", { fullName: "Victim Dev Action" });
    const before = await db.user.findUniqueOrThrow({ where: { id: victim.id } });
    const rightsBefore = await rightsOf(CALM);
    const email = mail("act");
    const fresh = await watch(dev.id);
    const results = [
      await createUserAction(undefined, form({ fullName: "Action Person", email, phone: "", roleId: calmRoleId, password: pw(), actorType: "STAFF", roleCode: "OWNER", actorRole: "OWNER", userId: boss.id, actor: boss.id })),
      await updateUserAction(undefined, form({ userId: victim.id, fullName: "Hacked", email: victim.email, phone: "", roleId: mgrRoleId, isActive: "on" })),
      await resetPasswordAction(undefined, form({ userId: victim.id, password: pw() })),
      await setRolePermissionAction({ roleId: calmRoleId, permission: "assets.view", granted: true }),
      await setRolePermissionAction({ roleId: devRoleId, permission: "payments.record", granted: true }),
      await setRolePermissionAction({ roleId: calmRoleId, permission: "developer.access", granted: true }),
      await deleteUserAction(undefined, form({ userId: victim.id })),
    ];
    for (const r of results) expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await db.user.count({ where: { email } })).toBe(0);
    expect(await db.user.findUniqueOrThrow({ where: { id: victim.id } })).toEqual(before);
    expect(await rightsOf(CALM)).toEqual(rightsBefore);
    expect(await developerAccessHolders()).toEqual([DEV]);
    const rows = await fresh();
    expect(rows).toHaveLength(results.length);
    expect(rows.every((r) => r.action === "developer.denied" && r.actorType === "DEVELOPER" && r.userId === dev.id)).toBe(true);
  });

  it("a receptionist (no 'users.manage') is refused by every Users action; nothing changes and nothing is written for them", async () => {
    await makeSession(rec.id);
    const victim = await makeUser("RECEPTIONIST", { fullName: "Victim Action" });
    const before = await db.user.findUniqueOrThrow({ where: { id: victim.id } });
    const fresh = await watch(rec.id);
    const results = [
      await createUserAction(undefined, form({ fullName: "No Right", email: mail("nr"), phone: "", roleId: recRoleId, password: pw() })),
      await updateUserAction(undefined, form({ userId: victim.id, fullName: "Hacked", email: victim.email, phone: "", roleId: mgrRoleId, isActive: "on" })),
      await resetPasswordAction(undefined, form({ userId: victim.id, password: pw() })),
      await setRolePermissionAction({ roleId: recRoleId, permission: "assets.view", granted: true }),
      await deleteUserAction(undefined, form({ userId: victim.id })),
    ];
    for (const r of results) expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await db.user.findUniqueOrThrow({ where: { id: victim.id } })).toEqual(before);
    expect(await fresh()).toHaveLength(0);
  });

  it("nobody signed in: told to sign in, nothing happens", async () => {
    const r = await updateUserAction(undefined, form({ userId: rec.id, fullName: "X Y", email: rec.email, phone: "", roleId: mgrRoleId, isActive: "on" }));
    expect(r).toMatchObject({ ok: false, code: "UNAUTHENTICATED" });
    expect((await db.user.findUniqueOrThrow({ where: { id: rec.id } })).roleId).toBe(recRoleId);
  });

  it("the MD cannot reach a Developer account or the Developer role's rights through the actions; 'developer.access' is refused", async () => {
    await makeSession(md.id);
    const original = await db.user.findUniqueOrThrow({ where: { id: devTarget.id } });
    const rightsBefore = await rightsOf(DEV);
    const fresh = await watch(md.id);

    const r1 = await updateUserAction(undefined, form({ userId: devTarget.id, fullName: "Staff Edit", email: devTarget.email, phone: "", roleId: devRoleId, isActive: "on" }));
    const r2 = await resetPasswordAction(undefined, form({ userId: devTarget.id, password: pw() }));
    const r3 = await deleteUserAction(undefined, form({ userId: devTarget.id }));
    const r4 = await setRolePermissionAction({ roleId: devRoleId, permission: "payments.record", granted: true });
    const r5 = await setRolePermissionAction({ roleId: recRoleId, permission: "developer.access", granted: true });
    expect([r1, r2, r3, r4].map((r) => !r.ok && r.code)).toEqual(["NOT_FOUND", "NOT_FOUND", "NOT_FOUND", "NOT_FOUND"]);
    expect(r5).toMatchObject({ ok: false, code: "FORBIDDEN" });

    expect(await db.user.findUniqueOrThrow({ where: { id: devTarget.id } })).toEqual(original);
    expect(await rightsOf(DEV)).toEqual(rightsBefore);
    expect(await developerAccessHolders()).toEqual([DEV]);
    expect((await fresh()).map((r) => r.action)).toEqual(["user.update_failed", "user.password_reset_failed", "user.delete_failed", "user.permission_change_failed", "user.permission_change_failed"]);
  });

  it("the MD's account for any role works through the action, exactly as before", async () => {
    await makeSession(md.id);
    for (const code of ["FINANCE", "MANAGER", "RECEPTIONIST", "RESTAURANT_SCREEN"]) {
      const email = mail("af");
      const r = await createUserAction(undefined, form({ fullName: `Action ${code}`, email, phone: "", roleId: await roleIdOf(code), password: pw() }));
      expect(r.ok, code).toBe(true);
      expect(await db.user.count({ where: { email } }), code).toBe(1);
    }
  });
});

// ═════════════════════════════════════ the Boss and the MD, role by role ═════════════════════════════════════
describe("the MD and the Boss still create accounts in every kind of role, exactly as before", () => {
  it("a STAFF entry each, no reason asked", async () => {
    for (const [a, code] of [[md, "RECEPTIONIST"], [md, "FINANCE"], [md, "MANAGER"], [boss, "FINANCE"], [boss, "RESTAURANT_SCREEN"], [boss, "ADMIN"]] as const) {
      const fresh = await watch(a.id);
      const email = mail("st");
      const id = await createStaffAccount(actorOf(a), STAFF_CREATED(`Staff ${code}`, email, await roleIdOf(code)));
      expect((await db.user.findUniqueOrThrow({ where: { id }, include: { role: true } })).role.code, `${a.role} ${code}`).toBe(code);
      const rows = await fresh();
      expect(rows.map((r) => r.action)).toEqual(["user.created"]);
      expect(rows[0]).toMatchObject({ actorType: "STAFF", actorRole: a.role });
    }
  });

  it("the MD and the Boss switch accounts on and off, change the sign-in email and the role, reset and remove — also accounts with money access", async () => {
    const victim = await makeUser("FINANCE", { fullName: "Victim Finance" });
    await makeSession(victim.id, { setCookie: false });
    const freshMd = await watch(md.id);
    await updateStaffAccount(actorOf(md), { ...(await updateInput(victim.id)), isActive: false });
    expect((await db.user.findUniqueOrThrow({ where: { id: victim.id } })).isActive).toBe(false);
    expect(await db.session.count({ where: { userId: victim.id } })).toBe(0);
    await updateStaffAccount(actorOf(md), { ...(await updateInput(victim.id)), isActive: true });
    const moved = mail("moved");
    await updateStaffAccount(actorOf(md), { ...(await updateInput(victim.id)), email: moved });
    expect((await db.user.findUniqueOrThrow({ where: { id: victim.id } })).email).toBe(moved);
    await updateStaffAccount(actorOf(boss), { ...(await updateInput(victim.id)), roleId: calmRoleId });
    expect((await db.user.findUniqueOrThrow({ where: { id: victim.id } })).roleId).toBe(calmRoleId);
    expect((await freshMd()).map((r) => r.action)).toEqual(["user.deactivated", "user.reactivated", "user.updated"]);
    const next = pw();
    await resetStaffPassword(actorOf(boss), { userId: victim.id, password: next });
    expect((await authenticate(moved, next)).ok).toBe(true);
    await deleteStaffAccount(actorOf(boss), { userId: victim.id });
    expect(await db.user.count({ where: { id: victim.id } })).toBe(0);
  });
});
