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
import { DEFAULT_ROLES, DEVELOPER_DENIED } from "@/lib/permissions";
import { blocksDeveloper, createStaffAccount, deleteStaffAccount, resetStaffPassword, setRolePermission, staffDirectory, updateStaffAccount, type AccountActor, type UpdateAccountInput } from "@/server/services/staff-accounts";
import { createUserAction, deleteUserAction, resetPasswordAction, setRolePermissionAction, updateUserAction } from "@/app/staff/(app)/users/actions";
import { browser, makeSession, makeUser, removeMadeUsers, thrownBy, type MadeUser } from "../support/developer";

/**
 * Staff accounts and the Developer account (owner, 2026-10-14) — every rule lives in server/services/staff-accounts.ts and is
 * proven here against a real database:
 *   - nobody can make a Developer account or give its role to anyone;
 *   - nobody but a Developer can see, edit, switch off, reset, remove or re-role a Developer account (it is simply "not found");
 *   - the Developer role is hidden from everyone else; nobody — the Developer included — can give "developer.access" to a role
 *     or change the Developer role's rights;
 *   - nobody changes their own role;
 *   - a Developer gives a reason (5+ characters) for a sensitive change; a refusal is itself kept in the audit trail;
 *   - staff are never asked for a reason; a password is never in the audit trail; a Developer's password reset follows the same
 *     strength rule as everyone's;
 *   - NO BACK DOOR TO MONEY: the Developer cannot make, re-activate, re-email, re-role, reset or remove an account whose role holds a
 *     money right, cannot give such a role to anyone, cannot give a money right to any role or take "audit.view" away, and nobody can
 *     reset a Developer account's password here — while the Boss, the MD and the rest keep doing all of it as before.
 * Every scenario counts the audit rows its actor wrote, so a missing or an extra entry fails the test.
 */

const DEV = "DEVELOPER";
let dev: MadeUser;
let devTarget: MadeUser; // a second Developer account (something staff must never see or touch)
let md: MadeUser;
let boss: MadeUser;
let rec: MadeUser;
let devRoleId: string;
let recRoleId: string;
let mgrRoleId: string;
let adminRoleId: string;
let kitchenRoleId: string; // a role that holds no money right: the Developer may manage its accounts (reception, the managers, Finance… may not)
let driverRoleId: string;
let hadAssetsView = false;
const customRoles: string[] = [];

const roleIdOf = async (code: string) => (await db.role.findUniqueOrThrow({ where: { code } })).id;
const actorOf = (u: MadeUser): AccountActor => ({ id: u.id, fullName: u.fullName, roleCode: u.role, actorType: u.role === DEV ? "DEVELOPER" : "STAFF" });
const mail = (tag: string) => `${tag}-${randomUUID().slice(0, 8)}@devusers.local`;
const pw = () => `Pw${randomUUID().slice(0, 8)}-7z`;
const GOOD = "12345"; // the shortest reason that is accepted

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
  [devRoleId, recRoleId, mgrRoleId, adminRoleId, kitchenRoleId, driverRoleId] = await Promise.all([roleIdOf("DEVELOPER"), roleIdOf("RECEPTIONIST"), roleIdOf("MANAGER"), roleIdOf("ADMIN"), roleIdOf("KITCHEN"), roleIdOf("DRIVER")]);
  hadAssetsView = (await db.rolePermission.count({ where: { roleId: kitchenRoleId, permission: { code: "assets.view" } } })) > 0;
});
afterAll(async () => {
  // put the one right these tests toggle back as it was, and remove every account they made
  if (!hadAssetsView) await db.rolePermission.deleteMany({ where: { roleId: kitchenRoleId, permission: { code: "assets.view" } } });
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

const STAFF_CREATED = (name: string, email: string, roleId: string, extra: { reason?: string | null } = {}) => ({ fullName: name, email, phone: null, roleId, password: pw(), ...extra });
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
      const err = await refusal(() => createStaffAccount(actorOf(a), STAFF_CREATED("Sneaky Dev", email, devRoleId, { reason: "a good reason" })));
      expect(err.code, name).toBe(code);
      if (a !== dev) expect([err.message, err.code], `${name}: the Developer role looks exactly like a role that does not exist`).toEqual([unknownRole.message, unknownRole.code]);
      expect(await db.user.count({ where: { email } }), name).toBe(0);
      expect(await db.user.count(), name).toBe(accounts);
      const rows = await fresh();
      expect(rows.map((r) => r.action), name).toEqual(["user.create_failed"]);
      expect(rows[0]).toMatchObject({ actorType: a === dev ? "DEVELOPER" : "STAFF", actorRole: a.role, entityType: "User" });
      expect(afterOf(rows[0]).code, name).toBe(code);
    }
  });

  it("promoting anyone to Developer is refused: the person keeps their role and their sessions; one 'update_failed' entry each", async () => {
    const victim = await makeUser("KITCHEN", { fullName: "Victim Promote" });
    await makeSession(victim.id, { setCookie: false });
    for (const [name, a, code] of [["Developer", dev, "FORBIDDEN"], ["MD", md, "NOT_FOUND"], ["Boss", boss, "NOT_FOUND"]] as const) {
      const fresh = await watch(a.id);
      const before = await db.user.findUniqueOrThrow({ where: { id: victim.id } });
      const err = await refusal(async () => updateStaffAccount(actorOf(a), { ...(await updateInput(victim.id)), roleId: devRoleId, reason: "a good reason" }));
      expect(err.code, name).toBe(code);
      expect(await db.user.findUniqueOrThrow({ where: { id: victim.id } }), name).toEqual(before);
      expect(await db.session.count({ where: { userId: victim.id } }), name).toBe(1);
      const rows = await fresh();
      expect(rows.map((r) => r.action), name).toEqual(["user.update_failed"]);
      expect(rows[0]).toMatchObject({ entityId: victim.id, actorType: a === dev ? "DEVELOPER" : "STAFF" });
    }
  });

  it("the system account's role cannot be given either (not part of the Developer rule, but the same door)", async () => {
    const err = await refusal(async () => createStaffAccount(actorOf(dev), STAFF_CREATED("System?", mail("sys"), await roleIdOf("SYSTEM_ONLINE"), { reason: "a good reason" })));
    expect(err.code).toBe("FORBIDDEN");
  });
});

// ═════════════════════════════════════ a Developer account is invisible to others ═════════════════════════════════════
describe("a Developer account is 'not found' for everyone who is not a Developer", () => {
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

  it("the Users list: staff see no Developer account and no Developer role; the Developer sees both; nobody sees the system account; no hash is in it", async () => {
    const forMd = await staffDirectory(actorOf(md));
    expect(forMd.users.map((u) => u.role.code)).not.toContain("DEVELOPER");
    expect(forMd.users.some((u) => [dev.id, devTarget.id].includes(u.id))).toBe(false);
    expect(forMd.roles.map((r) => r.code)).not.toContain("DEVELOPER");
    expect(forMd.roles.map((r) => r.code)).not.toContain("SYSTEM_ONLINE");
    expect(forMd.users.some((u) => u.id === rec.id)).toBe(true);
    expect(forMd.roles.map((r) => r.code)).toEqual(expect.arrayContaining(["OWNER", "ADMIN", "MANAGER", "RECEPTIONIST"]));

    const forDev = await staffDirectory(actorOf(dev));
    expect(forDev.users.filter((u) => u.role.code === "DEVELOPER").map((u) => u.id)).toEqual(expect.arrayContaining([dev.id, devTarget.id]));
    expect(forDev.roles.map((r) => r.code)).toContain("DEVELOPER");
    expect(forDev.roles.map((r) => r.code)).not.toContain("SYSTEM_ONLINE");
    expect(forDev.users.map((u) => u.email)).not.toContain("online-payments@system.invalid");
    expect(forDev.users.some((u) => u.id === rec.id)).toBe(true);

    for (const text of [JSON.stringify(forMd), JSON.stringify(forDev)]) {
      expect(text).not.toContain("passwordHash");
      expect(text).not.toContain("argon2");
    }
  });

  it("a Developer can see and edit another Developer account's name (no reason for a plain edit), but still cannot give or take away the Developer role", async () => {
    const fresh = await watch(dev.id);
    await updateStaffAccount(actorOf(dev), { ...(await updateInput(devTarget.id)), fullName: "Second Dev Renamed" });
    expect((await db.user.findUniqueOrThrow({ where: { id: devTarget.id } })).fullName).toBe("Second Dev Renamed");
    const rows = await fresh();
    expect(rows.map((r) => r.action)).toEqual(["user.updated"]);
    expect(rows[0]).toMatchObject({ actorType: "DEVELOPER", entityId: devTarget.id });
    expect("reason" in afterOf(rows[0])).toBe(false);
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
          const err = await refusal(async () => setRolePermission(actorOf(a), { roleId: await roleIdOf(roleCode), permission: "developer.access", granted, reason: "a good reason" }));
          expect(err.code, `${a.role} ${roleCode} ${granted}`).toBe("FORBIDDEN");
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
    const changes = [{ permission: "payments.record", granted: true }, { permission: "reservations.view", granted: false }, { permission: "audit.view", granted: false }, { permission: "settings.manage", granted: false }];
    const fresh = await watch(dev.id);
    const freshMd = await watch(md.id);
    for (const c of changes) {
      expect((await refusal(() => setRolePermission(actorOf(dev), { roleId: devRoleId, ...c, reason: "a good reason" }))).code, `Developer ${c.permission}`).toBe("FORBIDDEN");
      expect((await refusal(() => setRolePermission(actorOf(md), { roleId: devRoleId, ...c }))).code, `MD ${c.permission}`).toBe("NOT_FOUND");
    }
    expect(await rightsOf(DEV)).toEqual(before);
    expect((await fresh()).map((r) => r.action)).toEqual(changes.map(() => "user.permission_change_failed"));
    expect((await freshMd()).map((r) => r.action)).toEqual(changes.map(() => "user.permission_change_failed"));
  });

  it("a name that is not a right ('constructor', '__proto__', 'toString', '') is 'Unknown permission' — a clean refusal, never a server error", async () => {
    const fresh = await watch(dev.id);
    const freshMd = await watch(md.id);
    const names = ["no.such.right", "constructor", "__proto__", "toString", "hasOwnProperty", ""];
    for (const permission of names) {
      for (const a of [dev, md]) {
        const err = await refusal(() => setRolePermission(actorOf(a), { roleId: recRoleId, permission, granted: true, reason: "a good reason" }));
        expect([err.code, err.message], `${a.role} "${permission}"`).toEqual(["VALIDATION", "Unknown permission."]);
      }
    }
    const rows = await fresh();
    expect(rows).toHaveLength(names.length);
    expect(rows.every((r) => afterOf(r).code === "VALIDATION" && afterOf(r).error === "Unknown permission.")).toBe(true);
    expect(await freshMd()).toHaveLength(0); // a mistake in a form is not worth a line for staff
  });

  it("the Owner role, the Manager role (Developer is not the Boss) and the system role stay closed to the Developer", async () => {
    const owner = await roleIdOf("OWNER");
    const fresh = await watch(dev.id);
    expect((await refusal(() => setRolePermission(actorOf(dev), { roleId: owner, permission: "assets.view", granted: false, reason: "a good reason" }))).code).toBe("VALIDATION");
    expect((await refusal(() => setRolePermission(actorOf(dev), { roleId: mgrRoleId, permission: "assets.view", granted: true, reason: "a good reason" }))).code).toBe("FORBIDDEN");
    expect((await refusal(async () => setRolePermission(actorOf(dev), { roleId: await roleIdOf("SYSTEM_ONLINE"), permission: "assets.view", granted: true, reason: "a good reason" }))).code).toBe("FORBIDDEN");
    expect((await fresh()).map((r) => r.action)).toEqual(Array(3).fill("user.permission_change_failed"));
  });
});

// ═════════════════════════════════════ your own account ═════════════════════════════════════
describe("nobody changes their own role or switches themself off", () => {
  it("the Developer, the MD and the Boss are each refused when they change their own role (to a staff role or the Developer role) or switch themself off", async () => {
    for (const a of [dev, md, boss]) {
      const fresh = await watch(a.id);
      const before = await db.user.findUniqueOrThrow({ where: { id: a.id } });
      let tries = 0;
      const own = await roleIdOf(a.role);
      const changes: Partial<UpdateAccountInput>[] = [{ roleId: mgrRoleId }, { roleId: recRoleId }, { roleId: devRoleId }, { roleId: adminRoleId }, { isActive: false }];
      for (const change of changes) {
        if (change.roleId === own) continue; // the role they already have is not a change
        const err = await refusal(async () => updateStaffAccount(actorOf(a), { ...(await updateInput(a.id)), ...change, reason: "a good reason" }));
        expect(err, `${a.role} ${JSON.stringify(change)}`).toBeInstanceOf(AppError);
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

  it("the Developer cannot remove their own account either", async () => {
    const fresh = await watch(dev.id);
    const err = await refusal(() => deleteStaffAccount(actorOf(dev), { userId: dev.id, reason: "a good reason" }));
    expect(err.message).toMatch(/own account/i);
    expect(await db.user.count({ where: { id: dev.id } })).toBe(1);
    expect((await fresh()).map((r) => r.action)).toEqual(["user.delete_failed"]);
  });

  it("the Developer may still edit their own name and phone (not a sensitive change)", async () => {
    const fresh = await watch(dev.id);
    await updateStaffAccount(actorOf(dev), { ...(await updateInput(dev.id)), phone: "+255700000001" });
    expect((await db.user.findUniqueOrThrow({ where: { id: dev.id } })).phone).toBe("+255700000001");
    expect((await fresh()).map((r) => r.action)).toEqual(["user.updated"]);
  });
});

// ═════════════════════════════════════ the Developer's reason ═════════════════════════════════════
describe("a Developer gives a reason (5+ characters) for a sensitive change; staff are never asked", () => {
  const BAD_REASONS: (string | null | undefined)[] = [undefined, null, "", "   ", "abcd", "  ab  ", "x".repeat(501)];

  /** The seven sensitive changes; each has a snapshot of what it changes (equal before and after a refusal, different after a success). */
  function sensitiveOps(a: AccountActor, victim: MadeUser, doomed: MadeUser, meta: { ipAddress?: string | null } = {}) {
    const newAccountEmail = mail("new");
    const newLogin = mail("login");
    return [
      { name: "create an account", failed: "user.create_failed", ok: "user.created",
        run: (r: string | null | undefined) => createStaffAccount(a, STAFF_CREATED("Reason Test", newAccountEmail, kitchenRoleId, { reason: r }), meta),
        snapshot: () => db.user.findMany({ where: { email: newAccountEmail } }) },
      { name: "change a role", failed: "user.update_failed", ok: "user.role_changed",
        run: async (r: string | null | undefined) => updateStaffAccount(a, { ...(await updateInput(victim.id)), roleId: driverRoleId, reason: r }, meta),
        snapshot: () => db.user.findUniqueOrThrow({ where: { id: victim.id } }) },
      { name: "switch an account off", failed: "user.update_failed", ok: "user.deactivated",
        run: async (r: string | null | undefined) => updateStaffAccount(a, { ...(await updateInput(victim.id)), isActive: false, reason: r }, meta),
        snapshot: () => db.user.findUniqueOrThrow({ where: { id: victim.id } }) },
      { name: "change the sign-in email", failed: "user.update_failed", ok: "user.updated",
        run: async (r: string | null | undefined) => updateStaffAccount(a, { ...(await updateInput(victim.id)), email: newLogin, reason: r }, meta),
        snapshot: () => db.user.findUniqueOrThrow({ where: { id: victim.id } }) },
      { name: "reset a password", failed: "user.password_reset_failed", ok: "user.password_reset",
        run: (r: string | null | undefined) => resetStaffPassword(a, { userId: victim.id, password: pw(), reason: r }, meta),
        snapshot: () => db.user.findUniqueOrThrow({ where: { id: victim.id } }) },
      { name: "change a role's rights", failed: "user.permission_change_failed", ok: "user.permission_changed",
        run: (r: string | null | undefined) => setRolePermission(a, { roleId: kitchenRoleId, permission: "assets.view", granted: true, reason: r }, meta),
        snapshot: async () => (await rightsOf("KITCHEN")) },
      { name: "remove an account", failed: "user.delete_failed", ok: "user.deleted",
        run: (r: string | null | undefined) => deleteStaffAccount(a, { userId: doomed.id, reason: r }, meta),
        snapshot: () => db.user.findUnique({ where: { id: doomed.id } }) },
    ];
  }

  beforeEach(async () => {
    await db.rolePermission.deleteMany({ where: { roleId: kitchenRoleId, permission: { code: "assets.view" } } }); // each test starts with the right off
  });

  it("without a reason (missing, blank, 4 characters, or over 500) every sensitive change is refused, nothing changes, and each refusal is one 'failed' entry (DEVELOPER)", async () => {
    const victim = await makeUser("KITCHEN", { fullName: "Victim Reason" });
    const doomed = await makeUser("KITCHEN", { fullName: "Doomed Reason" });
    await makeSession(victim.id, { setCookie: false });
    const a = actorOf(dev);
    const fresh = await watch(dev.id);
    const ops = sensitiveOps(a, victim, doomed);

    for (const op of ops) {
      const state = await op.snapshot();
      for (const reason of BAD_REASONS) {
        const err = await refusal(() => op.run(reason));
        expect([err.code, Boolean(err.fieldErrors?.reason)], `${op.name} with ${JSON.stringify(reason)?.slice(0, 12)}`).toEqual(["VALIDATION", true]);
      }
      expect(await op.snapshot(), `${op.name}: nothing changed`).toEqual(state);
    }
    expect(await db.session.count({ where: { userId: victim.id } }), "nobody was signed out by a refused change").toBe(1);

    const rows = await fresh();
    expect(rows).toHaveLength(ops.length * BAD_REASONS.length);
    for (const op of ops) {
      const mine = rows.filter((r) => r.action === op.failed);
      expect(mine.length, op.name).toBeGreaterThanOrEqual(BAD_REASONS.length);
    }
    expect(rows.every((r) => r.actorType === "DEVELOPER" && r.actorRole === "DEVELOPER" && r.actorLabel === dev.fullName), "every refusal is a DEVELOPER entry with the real name").toBe(true);
    expect(rows.every((r) => afterOf(r).code === "VALIDATION" && /reason/i.test(String(afterOf(r).error))), "each says what was refused and why").toBe(true);
    expect(rows.map((r) => r.action).filter((x) => !x.endsWith("_failed")), "no success entry").toEqual([]);
  });

  it("with a 5-character reason each of the seven changes succeeds: one entry each, DEVELOPER, the reason in 'after', before/after for edits", async () => {
    const victim = await makeUser("KITCHEN", { fullName: "Victim Ok" });
    const doomed = await makeUser("KITCHEN", { fullName: "Doomed Ok" });
    await makeSession(victim.id, { setCookie: false });
    const a = actorOf(dev);
    const fresh = await watch(dev.id);
    const ops = sensitiveOps(a, victim, doomed, { ipAddress: "41.7.7.7" });

    for (const op of ops) {
      const state = await op.snapshot();
      await op.run(GOOD);
      expect(await op.snapshot(), `${op.name}: it happened`).not.toEqual(state);
    }

    const rows = await fresh();
    expect(rows.map((r) => r.action)).toEqual(ops.map((o) => o.ok));
    for (const r of rows) {
      expect(r, r.action).toMatchObject({ actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: dev.fullName, userId: dev.id });
      expect(afterOf(r).reason, r.action).toBe(GOOD);
    }
    const byAction = Object.fromEntries(rows.map((r) => [r.action, r]));
    expect(byAction["user.created"].before).toBeNull();
    expect(afterOf(byAction["user.created"])).toMatchObject({ fullName: "Reason Test", role: "KITCHEN" });
    expect(byAction["user.role_changed"].before).toMatchObject({ role: "KITCHEN", isActive: true });
    expect(afterOf(byAction["user.role_changed"])).toMatchObject({ role: "DRIVER", isActive: true });
    expect(byAction["user.deactivated"].before).toMatchObject({ role: "DRIVER", isActive: true });
    expect(afterOf(byAction["user.deactivated"])).toMatchObject({ isActive: false });
    expect(byAction["user.updated"].before).toMatchObject({ email: victim.email });
    expect(afterOf(byAction["user.password_reset"])).toMatchObject({ reset: true, signedOut: 0 }); // the earlier changes already ended the sessions
    expect(byAction["user.permission_changed"].before).toMatchObject({ permission: "assets.view", granted: false });
    expect(afterOf(byAction["user.permission_changed"])).toMatchObject({ permission: "assets.view", granted: true });
    expect(byAction["user.deleted"].before).toMatchObject({ fullName: doomed.fullName, email: doomed.email, role: "KITCHEN" });
    expect(await db.user.count({ where: { id: doomed.id } })).toBe(0);
    expect(rows.every((r) => r.ipAddress === "41.7.7.7")).toBe(true);
  });

  it("the reason is stored trimmed; exactly 500 characters is accepted; a plain edit (name, phone) needs none and records none", async () => {
    const victim = await makeUser("KITCHEN", { fullName: "Victim Trim" });
    const fresh = await watch(dev.id);
    await updateStaffAccount(actorOf(dev), { ...(await updateInput(victim.id)), roleId: driverRoleId, reason: "   moved to the managers' desk   " });
    await updateStaffAccount(actorOf(dev), { ...(await updateInput(victim.id)), roleId: kitchenRoleId, reason: "r".repeat(500) });
    const plain = await db.session.count({ where: { userId: victim.id } });
    await makeSession(victim.id, { setCookie: false });
    await updateStaffAccount(actorOf(dev), { ...(await updateInput(victim.id)), fullName: "Victim Renamed", phone: "+255700000002" });
    expect(await db.session.count({ where: { userId: victim.id } }), "a plain edit signs nobody out").toBe(plain + 1);
    const rows = await fresh();
    expect(rows.map((r) => r.action)).toEqual(["user.role_changed", "user.role_changed", "user.updated"]);
    expect(afterOf(rows[0]).reason).toBe("moved to the managers' desk");
    expect(afterOf(rows[1]).reason).toBe("r".repeat(500));
    expect("reason" in afterOf(rows[2])).toBe(false);
  });

  it("staff (the MD) are never asked for a reason: the same seven changes succeed, one STAFF entry each, none carries a reason", async () => {
    const victim = await makeUser("RECEPTIONIST", { fullName: "Victim Staff" });
    const doomed = await makeUser("RECEPTIONIST", { fullName: "Doomed Staff" });
    const a = actorOf(md);
    const fresh = await watch(md.id);
    const ops = sensitiveOps(a, victim, doomed);
    for (const op of ops) {
      const state = await op.snapshot();
      await op.run(undefined);
      expect(await op.snapshot(), `${op.name}: it happened`).not.toEqual(state);
    }
    const rows = await fresh();
    expect(rows.map((r) => r.action)).toEqual(ops.map((o) => o.ok));
    expect(rows.every((r) => r.actorType === "STAFF" && r.actorRole === "ADMIN" && r.actorLabel === md.fullName)).toBe(true);
    expect(rows.every((r) => !("reason" in afterOf(r)))).toBe(true);
  });

  it("the entries hold no password and no hash — neither the ones typed nor the stored ones — success or refusal", async () => {
    const typed = [pw(), pw(), pw()];
    const victim = await makeUser("KITCHEN", { fullName: "Victim Secrets" });
    const fresh = await watch(dev.id);
    await createStaffAccount(actorOf(dev), { fullName: "Secret Maker", email: mail("sec"), phone: null, roleId: kitchenRoleId, password: typed[0], reason: GOOD });
    await refusal(() => resetStaffPassword(actorOf(dev), { userId: victim.id, password: typed[1], reason: "no" }));
    await resetStaffPassword(actorOf(dev), { userId: victim.id, password: typed[2], reason: GOOD });
    const rows = await fresh();
    expect(rows).toHaveLength(3);
    const text = JSON.stringify(rows);
    for (const secret of typed) expect(text).not.toContain(secret);
    expect(text).not.toContain("argon2");
    const stored = await db.user.findMany({ where: { id: { in: [victim.id, dev.id, rec.id] } }, select: { passwordHash: true } });
    for (const s of stored) expect(text).not.toContain(s.passwordHash);
  });
});

// ═════════════════════════════════════ passwords ═════════════════════════════════════
describe("a Developer's password work follows the same strength rule as everyone's", () => {
  it("a weak password on a reset is refused — even with a good reason — and kept as a failed attempt; the old password and the sessions are untouched", async () => {
    const victim = await makeUser("KITCHEN", { fullName: "Victim Weak" });
    await makeSession(victim.id, { setCookie: false });
    const before = await db.user.findUniqueOrThrow({ where: { id: victim.id } });
    const weak = ["Zq1short", "qwertyuiopasdfgh", "7777777777777", ""];
    const fresh = await watch(dev.id);
    const freshMd = await watch(md.id);
    for (const password of weak) {
      for (const [a, reason] of [[dev, GOOD], [md, undefined]] as const) {
        const err = await refusal(() => resetStaffPassword(actorOf(a), { userId: victim.id, password, reason }));
        expect([err.code, Boolean(err.fieldErrors?.password)], `${a.role} "${password}"`).toEqual(["VALIDATION", true]);
      }
    }
    expect(await db.user.findUniqueOrThrow({ where: { id: victim.id } })).toEqual(before);
    expect(await db.session.count({ where: { userId: victim.id } })).toBe(1);
    expect((await authenticate(victim.email, victim.password)).ok).toBe(true); // the old password still works
    const rows = await fresh();
    expect(rows.map((r) => r.action)).toEqual(weak.map(() => "user.password_reset_failed"));
    expect(rows.every((r) => r.actorType === "DEVELOPER" && afterOf(r).code === "VALIDATION")).toBe(true);
    for (const p of weak.filter(Boolean)) expect(JSON.stringify(rows)).not.toContain(p);
    expect(await freshMd(), "for staff a weak password is a form mistake, not an entry").toHaveLength(0);
  });

  it("a weak password on a new account is refused for the Developer too; no account appears", async () => {
    const fresh = await watch(dev.id);
    const email = mail("weak");
    for (const password of ["Zq1short", "qwertyuiopasdfgh"]) {
      const err = await refusal(() => createStaffAccount(actorOf(dev), { fullName: "Weak Pw", email, phone: null, roleId: kitchenRoleId, password, reason: GOOD }));
      expect(err.code).toBe("VALIDATION");
    }
    expect(await db.user.count({ where: { email } })).toBe(0);
    expect((await fresh()).map((r) => r.action)).toEqual(["user.create_failed", "user.create_failed"]);
  });

  it("a strong password with a reason resets: the new password signs in, the old one does not, the person's sessions end; the entry holds no password", async () => {
    const victim = await makeUser("KITCHEN", { fullName: "Victim Strong" });
    await makeSession(victim.id, { setCookie: false });
    await makeSession(victim.id, { setCookie: false });
    const fresh = await watch(dev.id);
    const next = pw();
    await resetStaffPassword(actorOf(dev), { userId: victim.id, password: next, reason: "  lost the phone  " });

    const row = await db.user.findUniqueOrThrow({ where: { id: victim.id } });
    expect(await verifyPassword(row.passwordHash, next)).toBe(true);
    expect(await verifyPassword(row.passwordHash, victim.password)).toBe(false);
    expect((await authenticate(victim.email, next)).ok).toBe(true);
    expect((await authenticate(victim.email, victim.password)).ok).toBe(false);
    expect(await db.session.count({ where: { userId: victim.id } })).toBe(0);

    const rows = await fresh();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ action: "user.password_reset", actorType: "DEVELOPER", entityId: victim.id });
    expect(afterOf(rows[0])).toEqual({ reset: true, signedOut: 2, reason: "lost the phone" });
    expect(rows[0].before).toEqual({ fullName: victim.fullName, email: victim.email, role: "KITCHEN" });
    expect(JSON.stringify(rows)).not.toContain(next);
    expect(JSON.stringify(rows)).not.toContain(row.passwordHash);
  });
});

// ═════════════════════════════════════ Owner accounts ═════════════════════════════════════
describe("the Developer is not the Boss", () => {
  it("the Developer cannot give the Owner role, change, reset or remove an Owner account; each refusal is kept", async () => {
    const ownerRoleId = await roleIdOf("OWNER");
    const victim = await makeUser("KITCHEN", { fullName: "Victim Owner" });
    const owner = await makeUser("OWNER", { fullName: "Other Boss" });
    const before = await db.user.findUniqueOrThrow({ where: { id: owner.id } });
    const fresh = await watch(dev.id);
    const codes = [
      (await refusal(async () => updateStaffAccount(actorOf(dev), { ...(await updateInput(victim.id)), roleId: ownerRoleId, reason: GOOD }))).code,
      (await refusal(async () => updateStaffAccount(actorOf(dev), { ...(await updateInput(owner.id)), fullName: "Taken Over", reason: GOOD }))).code,
      (await refusal(() => resetStaffPassword(actorOf(dev), { userId: owner.id, password: pw(), reason: GOOD }))).code,
      (await refusal(() => deleteStaffAccount(actorOf(dev), { userId: owner.id, reason: GOOD }))).code,
      (await refusal(() => createStaffAccount(actorOf(dev), STAFF_CREATED("Second Boss", mail("boss"), ownerRoleId, { reason: GOOD })))).code,
    ];
    expect(codes).toEqual(Array(5).fill("FORBIDDEN"));
    expect(await db.user.findUniqueOrThrow({ where: { id: owner.id } })).toEqual(before);
    expect((await db.user.findUniqueOrThrow({ where: { id: victim.id } })).roleId).toBe(kitchenRoleId);
    expect((await fresh()).map((r) => r.action)).toEqual(["user.update_failed", "user.update_failed", "user.password_reset_failed", "user.delete_failed", "user.create_failed"]);
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

  it("a Developer's new account without a reason: refused with the reason field named, one failed entry; with a reason: created, a DEVELOPER entry — whatever else the form claims", async () => {
    await makeSession(dev.id);
    const fresh = await watch(dev.id);
    const email = mail("act");
    const base = { fullName: "Action Person", email, phone: "", roleId: kitchenRoleId, password: pw() };

    const refused = await createUserAction(undefined, form(base));
    expect(refused).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(!refused.ok && refused.fieldErrors?.reason).toBeTruthy();
    expect(await db.user.count({ where: { email } })).toBe(0);

    // fields that try to say who is acting are not read
    const done = await createUserAction(undefined, form({ ...base, reason: GOOD, actorType: "STAFF", roleCode: "OWNER", actorRole: "OWNER", userId: boss.id, actor: boss.id }));
    expect(done.ok).toBe(true);
    expect(await db.user.count({ where: { email } })).toBe(1);

    const rows = await fresh();
    expect(rows.map((r) => r.action)).toEqual(["user.create_failed", "user.created"]);
    expect(rows.every((r) => r.userId === dev.id && r.actorType === "DEVELOPER" && r.actorRole === "DEVELOPER")).toBe(true);
    expect(afterOf(rows[1]).reason).toBe(GOOD);
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

  it("the Developer through the actions: the Developer role's rights and 'developer.access' stay closed; a weak password is refused; a good reset works", async () => {
    await makeSession(dev.id);
    const victim = await makeUser("KITCHEN", { fullName: "Victim Dev Action" });
    const rightsBefore = await rightsOf(DEV);
    const fresh = await watch(dev.id);
    const r1 = await setRolePermissionAction({ roleId: devRoleId, permission: "payments.record", granted: true, reason: GOOD });
    const r2 = await setRolePermissionAction({ roleId: kitchenRoleId, permission: "developer.access", granted: true, reason: GOOD });
    const r3 = await resetPasswordAction(undefined, form({ userId: victim.id, password: "weakpw1", reason: GOOD }));
    const r4 = await resetPasswordAction(undefined, form({ userId: victim.id, password: pw() }));
    const next = pw();
    const r5 = await resetPasswordAction(undefined, form({ userId: victim.id, password: next, reason: GOOD }));
    expect([r1, r2].map((r) => !r.ok && r.code)).toEqual(["FORBIDDEN", "FORBIDDEN"]);
    expect([r3, r4].map((r) => !r.ok && r.code)).toEqual(["VALIDATION", "VALIDATION"]);
    expect(r5.ok).toBe(true);
    expect(await rightsOf(DEV)).toEqual(rightsBefore);
    expect(await developerAccessHolders()).toEqual([DEV]);
    expect((await authenticate(victim.email, next)).ok).toBe(true);
    const rows = await fresh();
    expect(rows.map((r) => r.action)).toEqual(["user.permission_change_failed", "user.permission_change_failed", "user.password_reset_failed", "user.password_reset_failed", "user.password_reset"]);
    expect(rows.every((r) => r.actorType === "DEVELOPER")).toBe(true);
  });
});

// ═════════════════════════════════════ no back door to money ═════════════════════════════════════
/*
 * The owner's rule (2026-10-14): the Developer can never write money — so it must not be able to make, take over or empower an account
 * that can, and then sign in as it. The rule reads the role's rights from the database, so it follows the data.
 */
const MONEY_MESSAGE = "The Developer account cannot do this: it would give access to money. Ask the Boss or the MD.";
const SETUP_SCRIPT_MESSAGE = "A Developer password is changed only with the setup script, not here.";
/** Built-in roles whose rights include money (the Developer may not make, change or remove their accounts) … */
const MONEY_ROLES = ["RECEPTIONIST", "MANAGER", "FINANCE", "ADMIN", "RESTAURANT_SCREEN"];
/** … and built-in roles that hold none (the Developer may manage them). Which other roles belong to either list follows DEVELOPER_DENIED. */
const CALM_ROLES = ["KITCHEN", "DRIVER", "RESTAURANT"];
const formOf = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};

describe("no back door to money: the Developer cannot make, take over or empower an account that can move money", () => {
  it("which built-in roles the Developer can and cannot manage follows the rights in the database — and the Users page offers it only the first kind", async () => {
    const cannot: string[] = [];
    const can: string[] = [];
    for (const code of Object.keys(DEFAULT_ROLES).filter((c) => c !== DEV)) {
      const fromDatabase = blocksDeveloper(await rightsOf(code));
      expect(fromDatabase, `${code}: the database holds what the code says`).toBe(blocksDeveloper(DEFAULT_ROLES[code].permissions));
      (fromDatabase ? cannot : can).push(code);
    }
    expect(cannot).toEqual(expect.arrayContaining([...MONEY_ROLES, "OWNER"]));
    expect(can).toEqual(expect.arrayContaining(CALM_ROLES));
    const devRights = await rightsOf(DEV);
    expect(DEVELOPER_DENIED.filter((c) => devRights.includes(c)), "the Developer role itself holds no money right").toEqual([]);
    expect(devRights).toContain("audit.view");

    const offered = (await staffDirectory(actorOf(dev))).roles.filter((r) => r.code !== DEV && !blocksDeveloper(r.permissions.map((p) => p.permission.code))).map((r) => r.code);
    expect(offered).toEqual(expect.arrayContaining(CALM_ROLES));
    for (const code of MONEY_ROLES) expect(offered, code).not.toContain(code);
  });

  it("creating an account in a role with money rights is refused for the Developer — no account, one 'create_failed' entry each — while roles without money rights stay open", async () => {
    const fresh = await watch(dev.id);
    for (const code of MONEY_ROLES) {
      const email = mail("mk");
      const err = await refusal(async () => createStaffAccount(actorOf(dev), STAFF_CREATED("Money Maker", email, await roleIdOf(code), { reason: GOOD })));
      expect([err.code, err.message], code).toEqual(["FORBIDDEN", MONEY_MESSAGE]);
      expect(await db.user.count({ where: { email } }), code).toBe(0);
    }
    const rows = await fresh();
    expect(rows.map((r) => r.action)).toEqual(MONEY_ROLES.map(() => "user.create_failed"));
    expect(rows.every((r) => r.actorType === "DEVELOPER" && r.actorRole === "DEVELOPER" && afterOf(r).code === "FORBIDDEN" && afterOf(r).error === MONEY_MESSAGE)).toBe(true);

    const freshOk = await watch(dev.id);
    for (const code of CALM_ROLES) await createStaffAccount(actorOf(dev), STAFF_CREATED(`Calm ${code}`, mail("ok"), await roleIdOf(code), { reason: GOOD }));
    expect((await freshOk()).map((r) => r.action)).toEqual(CALM_ROLES.map(() => "user.created"));
  });

  it("the MD and the Boss still create accounts in those roles, exactly as before (a STAFF entry each, no reason asked)", async () => {
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

  it("re-activating an account with money access is refused for the Developer (it stays off); it may still change the name and phone and switch it OFF; the MD switches it back on", async () => {
    const victim = await makeUser("FINANCE", { fullName: "Victim Finance" });
    await makeSession(victim.id, { setCookie: false });
    const fresh = await watch(dev.id);
    await updateStaffAccount(actorOf(dev), { ...(await updateInput(victim.id)), fullName: "Victim Finance Renamed", phone: "+255700000010" });
    await updateStaffAccount(actorOf(dev), { ...(await updateInput(victim.id)), isActive: false, reason: GOOD });
    expect(await db.session.count({ where: { userId: victim.id } }), "switching it off signs the person out").toBe(0);
    const err = await refusal(async () => updateStaffAccount(actorOf(dev), { ...(await updateInput(victim.id)), isActive: true, reason: GOOD }));
    expect([err.code, err.message]).toEqual(["FORBIDDEN", MONEY_MESSAGE]);
    expect((await db.user.findUniqueOrThrow({ where: { id: victim.id } })).isActive).toBe(false);
    expect((await fresh()).map((r) => r.action)).toEqual(["user.updated", "user.deactivated", "user.update_failed"]);

    const freshMd = await watch(md.id);
    await updateStaffAccount(actorOf(md), { ...(await updateInput(victim.id)), isActive: true });
    expect((await db.user.findUniqueOrThrow({ where: { id: victim.id } })).isActive).toBe(true);
    expect((await freshMd()).map((r) => r.action)).toEqual(["user.reactivated"]);
  });

  it("changing the sign-in email of an account with money access is refused for the Developer (account and sessions untouched); the MD still can", async () => {
    const victim = await makeUser("RECEPTIONIST", { fullName: "Victim Email" });
    await makeSession(victim.id, { setCookie: false });
    const before = await db.user.findUniqueOrThrow({ where: { id: victim.id } });
    const fresh = await watch(dev.id);
    const err = await refusal(async () => updateStaffAccount(actorOf(dev), { ...(await updateInput(victim.id)), email: mail("takeover"), reason: GOOD }));
    expect([err.code, err.message]).toEqual(["FORBIDDEN", MONEY_MESSAGE]);
    expect(await db.user.findUniqueOrThrow({ where: { id: victim.id } })).toEqual(before);
    expect(await db.session.count({ where: { userId: victim.id } })).toBe(1);
    const rows = await fresh();
    expect(rows.map((r) => r.action)).toEqual(["user.update_failed"]);
    expect(rows[0]).toMatchObject({ actorType: "DEVELOPER", entityId: victim.id });

    const freshMd = await watch(md.id);
    const moved = mail("moved");
    await updateStaffAccount(actorOf(md), { ...(await updateInput(victim.id)), email: moved });
    expect((await db.user.findUniqueOrThrow({ where: { id: victim.id } })).email).toBe(moved);
    expect((await freshMd()).map((r) => r.action)).toEqual(["user.updated"]);
  });

  it("resetting the password of an account with money access is refused for the Developer (the old password and the sessions stay); the MD and the Boss still can; a calm account's reset still works", async () => {
    const victim = await makeUser("FINANCE", { fullName: "Victim Reset Money" });
    await makeSession(victim.id, { setCookie: false });
    const before = await db.user.findUniqueOrThrow({ where: { id: victim.id } });
    const fresh = await watch(dev.id);
    const err = await refusal(() => resetStaffPassword(actorOf(dev), { userId: victim.id, password: pw(), reason: GOOD }));
    expect([err.code, err.message]).toEqual(["FORBIDDEN", MONEY_MESSAGE]);
    expect((await db.user.findUniqueOrThrow({ where: { id: victim.id } })).passwordHash).toBe(before.passwordHash);
    expect(await db.session.count({ where: { userId: victim.id } })).toBe(1);
    expect((await authenticate(victim.email, victim.password)).ok).toBe(true);
    const rows = await fresh();
    expect(rows.map((r) => r.action)).toEqual(["user.password_reset_failed"]);
    expect(rows[0]).toMatchObject({ actorType: "DEVELOPER", entityId: victim.id });
    expect(afterOf(rows[0]).code).toBe("FORBIDDEN");

    for (const a of [md, boss]) {
      const next = pw();
      const freshStaff = await watch(a.id);
      await resetStaffPassword(actorOf(a), { userId: victim.id, password: next });
      expect((await authenticate(victim.email, next)).ok, a.role).toBe(true);
      expect((await freshStaff()).map((r) => r.action)).toEqual(["user.password_reset"]);
    }
    const calm = await makeUser("DRIVER", { fullName: "Victim Reset Calm" });
    await resetStaffPassword(actorOf(dev), { userId: calm.id, password: pw(), reason: GOOD });
  });

  it("removing an account with money access is refused for the Developer (the account stays); the MD still can", async () => {
    const victim = await makeUser("RECEPTIONIST", { fullName: "Victim Delete Money" });
    const fresh = await watch(dev.id);
    const err = await refusal(() => deleteStaffAccount(actorOf(dev), { userId: victim.id, reason: GOOD }));
    expect([err.code, err.message]).toEqual(["FORBIDDEN", MONEY_MESSAGE]);
    expect(await db.user.count({ where: { id: victim.id } })).toBe(1);
    expect((await fresh()).map((r) => r.action)).toEqual(["user.delete_failed"]);

    const freshMd = await watch(md.id);
    await deleteStaffAccount(actorOf(md), { userId: victim.id });
    expect(await db.user.count({ where: { id: victim.id } })).toBe(0);
    expect((await freshMd()).map((r) => r.action)).toEqual(["user.deleted"]);
  });

  it("changing a role: the Developer cannot give a money role, and cannot change the role of an account that already has one; a move between calm roles works; the MD moves anyone as before", async () => {
    const calm = await makeUser("KITCHEN", { fullName: "Victim Role Calm" });
    const money = await makeUser("RECEPTIONIST", { fullName: "Victim Role Money" });
    await makeSession(calm.id, { setCookie: false });
    await makeSession(money.id, { setCookie: false });
    const fresh = await watch(dev.id);
    const attempts: [MadeUser, string][] = [[calm, "RECEPTIONIST"], [calm, "FINANCE"], [calm, "MANAGER"], [calm, "ADMIN"], [money, "KITCHEN"], [money, "DRIVER"]];
    for (const [who, to] of attempts) {
      const before = await db.user.findUniqueOrThrow({ where: { id: who.id } });
      const err = await refusal(async () => updateStaffAccount(actorOf(dev), { ...(await updateInput(who.id)), roleId: await roleIdOf(to), reason: GOOD }));
      expect([err.code, err.message], `${who.role} -> ${to}`).toEqual(["FORBIDDEN", MONEY_MESSAGE]);
      expect(await db.user.findUniqueOrThrow({ where: { id: who.id } }), `${who.role} -> ${to}`).toEqual(before);
      expect(await db.session.count({ where: { userId: who.id } })).toBe(1);
    }
    expect((await fresh()).map((r) => r.action)).toEqual(attempts.map(() => "user.update_failed"));

    await updateStaffAccount(actorOf(dev), { ...(await updateInput(calm.id)), roleId: driverRoleId, reason: GOOD });
    expect((await db.user.findUniqueOrThrow({ where: { id: calm.id } })).roleId).toBe(driverRoleId);

    const freshMd = await watch(md.id);
    await updateStaffAccount(actorOf(md), { ...(await updateInput(money.id)), roleId: kitchenRoleId });
    await updateStaffAccount(actorOf(md), { ...(await updateInput(calm.id)), roleId: await roleIdOf("FINANCE") });
    expect((await freshMd()).map((r) => r.action)).toEqual(["user.role_changed", "user.role_changed"]);
    expect((await db.user.findUniqueOrThrow({ where: { id: money.id } })).roleId).toBe(kitchenRoleId);
  });

  it("giving a money right — or the right to manage staff — to any role is refused for the Developer, every right on the list, and the rights stay as they were; the MD and the Boss still can", async () => {
    const kitchenBefore = await rightsOf("KITCHEN");
    const adminBefore = await rightsOf("ADMIN");
    const fresh = await watch(dev.id);
    const rights = [...DEVELOPER_DENIED, "users.manage"];
    for (const permission of rights) {
      const err = await refusal(() => setRolePermission(actorOf(dev), { roleId: kitchenRoleId, permission, granted: true, reason: GOOD }));
      expect([err.code, /Ask the Boss or the MD/.test(err.message)], permission).toEqual(["FORBIDDEN", true]);
    }
    // a role that already holds it: still refused (the Developer never gives it)
    expect((await refusal(() => setRolePermission(actorOf(dev), { roleId: adminRoleId, permission: "payments.record", granted: true, reason: GOOD }))).code).toBe("FORBIDDEN");
    expect(await rightsOf("KITCHEN")).toEqual(kitchenBefore);
    expect(await rightsOf("ADMIN")).toEqual(adminBefore);
    const rows = await fresh();
    expect(rows).toHaveLength(rights.length + 1);
    expect(rows.every((r) => r.action === "user.permission_change_failed" && r.actorType === "DEVELOPER" && afterOf(r).code === "FORBIDDEN")).toBe(true);

    // the Developer may still give a right that is not about money (that is how the rest of its work is done) — and the MD and the Boss give any
    await setRolePermission(actorOf(dev), { roleId: kitchenRoleId, permission: "assets.view", granted: true, reason: GOOD });
    for (const [a, permission] of [[md, "expenses.record"], [boss, "payments.record"], [md, "users.manage"]] as const) {
      const freshStaff = await watch(a.id);
      await setRolePermission(actorOf(a), { roleId: kitchenRoleId, permission, granted: true });
      expect(await rightsOf("KITCHEN"), `${a.role} ${permission}`).toContain(permission);
      await setRolePermission(actorOf(a), { roleId: kitchenRoleId, permission, granted: false });
      expect((await freshStaff()).map((r) => r.action)).toEqual(["user.permission_changed", "user.permission_changed"]);
    }
    await setRolePermission(actorOf(md), { roleId: kitchenRoleId, permission: "assets.view", granted: false });
    expect(await rightsOf("KITCHEN")).toEqual(kitchenBefore);
  });

  it("taking 'audit.view' away from any role is refused for the Developer (oversight stays); giving it is allowed; the MD can take it away", async () => {
    expect(await rightsOf("ADMIN")).toContain("audit.view");
    const fresh = await watch(dev.id);
    const err = await refusal(() => setRolePermission(actorOf(dev), { roleId: adminRoleId, permission: "audit.view", granted: false, reason: GOOD }));
    expect(err.code).toBe("FORBIDDEN");
    expect(err.message).toMatch(/audit trail/i);
    expect(await rightsOf("ADMIN")).toContain("audit.view");

    // a role that holds it because the MD gave it: the Developer cannot remove it either
    await setRolePermission(actorOf(md), { roleId: driverRoleId, permission: "audit.view", granted: true });
    expect((await refusal(() => setRolePermission(actorOf(dev), { roleId: driverRoleId, permission: "audit.view", granted: false, reason: GOOD }))).code).toBe("FORBIDDEN");
    expect(await rightsOf("DRIVER")).toContain("audit.view");
    expect((await fresh()).map((r) => r.action)).toEqual(["user.permission_change_failed", "user.permission_change_failed"]);

    // giving the audit right (more oversight) is allowed; the MD takes it back
    await setRolePermission(actorOf(dev), { roleId: kitchenRoleId, permission: "audit.view", granted: true, reason: GOOD });
    expect(await rightsOf("KITCHEN")).toContain("audit.view");
    const freshMd = await watch(md.id);
    await setRolePermission(actorOf(md), { roleId: kitchenRoleId, permission: "audit.view", granted: false });
    await setRolePermission(actorOf(md), { roleId: driverRoleId, permission: "audit.view", granted: false });
    expect(await rightsOf("KITCHEN")).not.toContain("audit.view");
    expect(await rightsOf("DRIVER")).not.toContain("audit.view");
    expect((await freshMd()).map((r) => r.action)).toEqual(["user.permission_changed", "user.permission_changed"]);
  });

  it("no one resets a Developer account's password here: the Developer is refused for its own and another Developer's (nothing changes); staff still find it 'not found'", async () => {
    const fresh = await watch(dev.id);
    for (const t of [dev, devTarget]) {
      await makeSession(t.id, { setCookie: false });
      const before = await db.user.findUniqueOrThrow({ where: { id: t.id } });
      const sessions = await db.session.count({ where: { userId: t.id } });
      const err = await refusal(() => resetStaffPassword(actorOf(dev), { userId: t.id, password: pw(), reason: GOOD }));
      expect([err.code, err.message], t.fullName).toEqual(["FORBIDDEN", SETUP_SCRIPT_MESSAGE]);
      expect((await db.user.findUniqueOrThrow({ where: { id: t.id } })).passwordHash, t.fullName).toBe(before.passwordHash);
      expect(await db.session.count({ where: { userId: t.id } }), t.fullName).toBe(sessions);
      expect((await authenticate(t.email, t.password)).ok, `${t.fullName}: the old password still signs in`).toBe(true);
    }
    const rows = await fresh();
    expect(rows.map((r) => r.action)).toEqual(["user.password_reset_failed", "user.password_reset_failed"]);
    expect(rows.every((r) => r.actorType === "DEVELOPER" && afterOf(r).code === "FORBIDDEN")).toBe(true);

    for (const a of [md, boss]) {
      const err = await refusal(() => resetStaffPassword(actorOf(a), { userId: devTarget.id, password: pw() }));
      expect(err.code, a.role).toBe("NOT_FOUND");
    }

    // through the Users action too
    await makeSession(dev.id);
    const viaAction = await resetPasswordAction(undefined, formOf({ userId: dev.id, password: pw(), reason: GOOD }));
    expect(viaAction).toMatchObject({ ok: false, code: "FORBIDDEN" });

    // the Boss and the MD still reset their own password (their accounts are not Developer accounts)
    for (const a of [md, boss]) {
      const next = pw();
      await resetStaffPassword(actorOf(a), { userId: a.id, password: next });
      expect((await authenticate(a.email, next)).ok, a.role).toBe(true);
    }
  });

  it("an email that belongs to the Developer is never confirmed as 'already there' to staff; an ordinary taken email is worded as before; the Developer is told plainly", async () => {
    for (const a of [md, boss]) {
      const fresh = await watch(a.id);
      const victim = await makeUser("KITCHEN", { fullName: `Victim Email ${a.role}` });
      const createErr = await refusal(() => createStaffAccount(actorOf(a), STAFF_CREATED("Dev Twin", devTarget.email, kitchenRoleId)));
      const updateErr = await refusal(async () => updateStaffAccount(actorOf(a), { ...(await updateInput(victim.id)), email: devTarget.email }));
      for (const err of [createErr, updateErr]) {
        expect([err.code, err.message, err.fieldErrors?.email], a.role).toEqual(["CONFLICT", "This email cannot be used.", "This email cannot be used."]);
      }
      expect(JSON.stringify([createErr.message, createErr.fieldErrors, updateErr.message, updateErr.fieldErrors])).not.toMatch(/already/i);
      expect((await db.user.findUniqueOrThrow({ where: { id: victim.id } })).email).toBe(victim.email);
      expect((await fresh()).map((r) => r.action), `${a.role}: both refusals are kept`).toEqual(["user.create_failed", "user.update_failed"]);
    }
    const ordinary = await refusal(() => createStaffAccount(actorOf(md), STAFF_CREATED("Twin", rec.email, kitchenRoleId)));
    expect([ordinary.code, ordinary.message, ordinary.fieldErrors?.email]).toEqual(["CONFLICT", "A staff account with this email already exists.", "Already in use"]);
    const plain = await refusal(() => createStaffAccount(actorOf(dev), STAFF_CREATED("Dev Twin", devTarget.email, kitchenRoleId, { reason: GOOD })));
    expect([plain.code, plain.message]).toEqual(["CONFLICT", "A staff account with this email already exists."]);
  });

  it("it follows the data: a custom role is open to the Developer until it holds a money right or staff management, and open again once that is taken away", async () => {
    const code = `TESTCUSTOM${randomUUID().slice(0, 6).toUpperCase()}`;
    customRoles.push(code);
    const role = await db.role.create({ data: { code, name: "Custom test role" } });
    const person = await createStaffAccount(actorOf(dev), STAFF_CREATED("Custom Person", mail("cp"), role.id, { reason: GOOD })); // no rights yet: open
    const closed = async () => {
      const attempts: [string, () => Promise<unknown>][] = [
        ["create", () => createStaffAccount(actorOf(dev), STAFF_CREATED("Custom Two", mail("c2"), role.id, { reason: GOOD }))],
        ["reset", () => resetStaffPassword(actorOf(dev), { userId: person, password: pw(), reason: GOOD })],
        ["remove", () => deleteStaffAccount(actorOf(dev), { userId: person, reason: GOOD })],
        ["re-email", async () => updateStaffAccount(actorOf(dev), { ...(await updateInput(person)), email: mail("c3"), reason: GOOD })],
        ["re-role", async () => updateStaffAccount(actorOf(dev), { ...(await updateInput(person)), roleId: kitchenRoleId, reason: GOOD })],
      ];
      for (const [name, run] of attempts) expect((await refusal(run)).code, name).toBe("FORBIDDEN");
      expect(await db.user.count({ where: { id: person } })).toBe(1);
    };

    for (const permission of ["revenue.record", "users.manage"]) {
      await setRolePermission(actorOf(boss), { roleId: role.id, permission, granted: true });
      await closed();
      await setRolePermission(actorOf(boss), { roleId: role.id, permission, granted: false });
      await resetStaffPassword(actorOf(dev), { userId: person, password: pw(), reason: GOOD }); // open again
    }
  });

  it("through the Users actions: the Developer's money-role account, money right and own password reset are refused with entries; the MD's account for a money role works", async () => {
    await makeSession(dev.id);
    const fresh = await watch(dev.id);
    const financeId = await roleIdOf("FINANCE");
    const email = mail("af");
    const r1 = await createUserAction(undefined, formOf({ fullName: "Action Finance", email, phone: "", roleId: financeId, password: pw(), reason: GOOD }));
    const r2 = await setRolePermissionAction({ roleId: kitchenRoleId, permission: "payments.record", granted: true, reason: GOOD });
    const r3 = await resetPasswordAction(undefined, formOf({ userId: dev.id, password: pw(), reason: GOOD }));
    for (const r of [r1, r2, r3]) expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await db.user.count({ where: { email } })).toBe(0);
    expect((await fresh()).map((r) => r.action)).toEqual(["user.create_failed", "user.permission_change_failed", "user.password_reset_failed"]);

    await makeSession(md.id);
    const r4 = await createUserAction(undefined, formOf({ fullName: "Action Finance", email, phone: "", roleId: financeId, password: pw() }));
    expect(r4.ok).toBe(true);
    expect(await db.user.count({ where: { email } })).toBe(1);
  });
});
