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
import { audit } from "@/server/audit";
import { assertNotWorkAs, authorize, authorizeDecision, canDecide, destroySession, getCurrentUser, getCurrentUserQuiet } from "@/server/auth";
import { AppError } from "@/server/errors";
import { actsAsDeveloper, refuseDeveloper } from "@/server/developer-wall";
import { isMarkedWorkingAs, WORK_AS_HOURS } from "@/server/work-as-session";
import { tellBossSoon } from "@/server/services/report-delivery";
import { accessPeople, endWorkAs, reactivateAccount, requireDeveloperSession, signOutEverywhere, startWorkAs, suspendAccount } from "@/server/services/work-as";
import { createStaffAccount, deleteStaffAccount, DEVELOPER_NO_ACCOUNTS, resetStaffPassword, setRolePermission, staffDirectory, updateStaffAccount } from "@/server/services/staff-accounts";
import { logDeveloperView } from "@/server/services/developer-view-log";
import { changeRoomStatusAction } from "@/app/staff/(app)/rooms/actions";
import { recordSaleAction } from "@/app/staff/(app)/sales/actions";
import { changePasswordAction, signOutOtherDevicesAction, updateProfileAction } from "@/app/staff/(app)/account/actions";
import { setAlertSoundAction } from "@/components/staff/sound-actions";
import { setMyLanguage } from "@/i18n/actions";
import { DEVELOPER_DENIED, DEVELOPER_ONLY } from "@/lib/permissions";
import { englishT } from "@/i18n/translate";
import { resetBusinessData } from "../support/helpers";
import { browser, makeSession, makeUser, removeMadeUsers, sha256, thrownBy, type MadeUser } from "../support/developer";

/**
 * WORK AS (owner, 2026-10-17) — a Developer opens a staff member's real dashboard WITHOUT their password and can act as them, except
 * everything about money and everything that could take over an account. Proven against a real database:
 *   1. who the request is: the person worked as (their rights minus money and the Developer-only right), with the Developer's true
 *      identity kept beside it — only for a Developer's own session, only for an active staff account, only for 4 hours;
 *   2. starting and stopping it: refused for anyone who is not a Developer, audited under the Developer, the Boss is told;
 *   3. while working as someone: money is refused, the decision gates refuse, no account / password / email / role / right / session /
 *      preference can be changed (in the code AND by the database fence), but ordinary work goes through;
 *   4. the audit trail tells the truth: the DEVELOPER acted (as Neema), never Neema — and nobody else's entries are touched;
 *   5. suspend / switch back on / sign out everywhere.
 */

const mk = (role: string, fullName: string, opts: { isActive?: boolean } = {}) => makeUser(role, { fullName, ...opts });
let dev: MadeUser;
let dev2: MadeUser;
let rec: MadeUser;
let fin: MadeUser;
let boss: MadeUser;
let md: MadeUser;
let mgr: MadeUser;
let waiter: MadeUser;
let driver: MadeUser;
let offRec: MadeUser;
let system: MadeUser;
let everyone: MadeUser[];

beforeAll(async () => {
  [dev, dev2, rec, fin, boss, md, mgr, waiter, driver, offRec, system] = await Promise.all([
    mk("DEVELOPER", "Nino Dev"), mk("DEVELOPER", "Other Dev"), mk("RECEPTIONIST", "Neema Reception"), mk("FINANCE", "Fatma Finance"), mk("OWNER", "Boss Owner"),
    mk("ADMIN", "Mdi Director"), mk("MANAGER", "Mosi Manager"), mk("RESTAURANT", "Wanja Waiter"), mk("DRIVER", "Dan Driver"), mk("RECEPTIONIST", "Off Reception", { isActive: false }), mk("SYSTEM_ONLINE", "Online System"),
  ]);
  everyone = [dev, dev2, rec, fin, boss, md, mgr, waiter, driver, offRec, system];
});
afterAll(async () => {
  browser.reset(); // no work-as left in the browser: removing accounts is exactly what the fence forbids while working as someone
  await removeMadeUsers();
});
beforeEach(async () => {
  delete process.env.PERMANENT_OWNER_EMAILS;
  vi.mocked(tellBossSoon).mockClear();
  browser.reset();
  await db.$executeRawUnsafe(`TRUNCATE "audit_logs"`); // every test counts its own entries
  await rawDb.session.deleteMany({ where: { userId: { in: everyone.map((u) => u.id) } } });
  await rawDb.user.updateMany({ where: { id: { in: everyone.map((u) => u.id) } }, data: { isActive: true, mustChangePassword: false, preferredLanguage: "en", alertSoundOff: false } });
  await rawDb.user.update({ where: { id: offRec.id }, data: { isActive: false } });
});

// ───────────────────────────────────────────── helpers ─────────────────────────────────────────────

/** Sign in as this person: a fresh browser holding a real session cookie. Returns the token's hash. */
async function signedInAs(u: MadeUser, opts: { createdMinAgo?: number; seenMinAgo?: number } = {}): Promise<string> {
  browser.reset();
  const token = await makeSession(u.id, { createdMinAgo: opts.createdMinAgo ?? 1, seenMinAgo: opts.seenMinAgo ?? 0 });
  return sha256(token);
}
/** The Developer signed in and already working as this person (written straight to the session row, as startWorkAs does). */
async function workingAs(target: MadeUser, opts: { startedMinAgo?: number; as?: MadeUser } = {}): Promise<string> {
  const hash = await signedInAs(opts.as ?? dev);
  await rawDb.session.update({ where: { tokenHash: hash }, data: { workAsUserId: target.id, workAsStartedAt: new Date(Date.now() - (opts.startedMinAgo ?? 1) * 60_000) } });
  return hash;
}
const me = async () => {
  const u = await getCurrentUser();
  if (!u) throw new Error("not signed in");
  return u;
};
const developerUser = async () => { await signedInAs(dev); return me(); };
const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);
const WHILE = /While you are working as someone you cannot/;
/** The audit entries with this action, newest first. */
const entries = (action: string, where: Record<string, unknown> = {}) => db.auditLog.findMany({ where: { action, ...where }, orderBy: [{ createdAt: "desc" }, { id: "desc" }] });
const rightsOf = async (u: MadeUser) => new Set((await db.permission.findMany({ where: { roles: { some: { role: { users: { some: { id: u.id } } } } } }, select: { code: true } })).map((p) => p.code));

// ───────────────────────────────────── 1. who the request is ─────────────────────────────────────
describe("a Developer session working as someone", () => {
  it("is the person: their id, role and rights minus money and the Developer-only right; the Developer's own id is kept beside it", async () => {
    await rawDb.user.update({ where: { id: rec.id }, data: { mustChangePassword: true, preferredLanguage: "zh-CN", alertSoundOff: true } });
    const startedAt = new Date(Date.now() - 5 * 60_000);
    const hash = await signedInAs(dev, { seenMinAgo: 0 });
    await rawDb.session.update({ where: { tokenHash: hash }, data: { workAsUserId: rec.id, workAsStartedAt: startedAt } });

    const u = await me();
    expect(u).toMatchObject({ id: rec.id, email: rec.email, fullName: rec.fullName, roleCode: "RECEPTIONIST", locale: "zh-CN", soundOff: true, actorType: "DEVELOPER", actorId: dev.id, actorName: dev.fullName, mustChangePassword: false });
    expect(u.workAs).toEqual({ developerId: dev.id, developerName: dev.fullName, startedAt });

    const theirs = await rightsOf(rec);
    const blocked = new Set<string>([...DEVELOPER_DENIED, ...DEVELOPER_ONLY]);
    expect([...u.permissions].sort()).toEqual([...theirs].filter((p) => !blocked.has(p)).sort());
    // The receptionist normally records payments and revenue — the Developer holds neither while working as her, and never the Developer-only right.
    expect(theirs.has("payments.record") && theirs.has("revenue.record")).toBe(true);
    for (const p of ["payments.record", "revenue.record", "cash.handover.submit", "developer.access"]) expect(u.permissions.has(p as never), p).toBe(false);
    expect(u.permissions.has("reservations.check_in")).toBe(true);
    // The services still see a Developer (the money wall inside them is built on it).
    expect(isMarkedWorkingAs(u.permissions)).toBe(true);
    expect(actsAsDeveloper({ permissions: u.permissions })).toBe(true);
  });

  it("is resolved the same way by the quiet reader, which never counts as use", async () => {
    const hash = await signedInAs(dev, { seenMinAgo: 20 });
    await rawDb.session.update({ where: { tokenHash: hash }, data: { workAsUserId: rec.id, workAsStartedAt: new Date() } });
    const before = (await rawDb.session.findUniqueOrThrow({ where: { tokenHash: hash } })).lastSeenAt.getTime();
    const q = await getCurrentUserQuiet();
    expect(q).toMatchObject({ id: rec.id, actorId: dev.id, actorType: "DEVELOPER" });
    expect((await rawDb.session.findUniqueOrThrow({ where: { tokenHash: hash } })).lastSeenAt.getTime(), "a background poll does not keep the session awake").toBe(before);
    // A page load is use: the session's last-seen time moves (through the plain client — the fence does not stop the person's OWN session).
    await me();
    expect((await rawDb.session.findUniqueOrThrow({ where: { tokenHash: hash } })).lastSeenAt.getTime()).toBeGreaterThan(before);
  });

  it("is ignored — the Developer is simply themselves — for a switched-off person, a Developer, a system account or a work-as older than 4 hours", async () => {
    for (const [label, target, startedMinAgo] of [
      ["switched-off person", offRec, 1], ["another Developer", dev2, 1], ["system account", system, 1], ["older than 4 hours", rec, WORK_AS_HOURS * 60 + 1],
    ] as const) {
      await workingAs(target, { startedMinAgo });
      const u = await me();
      expect(u, label).toMatchObject({ id: dev.id, actorId: dev.id, roleCode: "DEVELOPER", workAs: null });
      expect(u.permissions.has("developer.access"), label).toBe(true);
      expect(isMarkedWorkingAs(u.permissions), label).toBe(false);
    }
  });

  it("is ignored when the person is removed (the link is cleared by the database) and when the Developer session has ended", async () => {
    const gone = await mk("RECEPTIONIST", "Soon Gone");
    const hash = await workingAs(gone);
    await rawDb.user.delete({ where: { id: gone.id } });
    expect((await rawDb.session.findUniqueOrThrow({ where: { tokenHash: hash } })).workAsUserId).toBeNull();
    expect(await me()).toMatchObject({ id: dev.id, workAs: null });

    await workingAs(rec);
    await rawDb.session.updateMany({ where: { userId: dev.id }, data: { expiresAt: new Date(Date.now() - 1000) } });
    expect(await getCurrentUser(), "an ended Developer session ends the work-as with it").toBeNull();
  });

  it("is ignored on a STAFF session even when someone forges the row", async () => {
    const hash = await signedInAs(rec);
    await rawDb.session.update({ where: { tokenHash: hash }, data: { workAsUserId: boss.id, workAsStartedAt: new Date() } });
    const u = await me();
    expect(u).toMatchObject({ id: rec.id, actorId: rec.id, roleCode: "RECEPTIONIST", actorType: "STAFF", workAs: null });
    expect(u.permissions.has("dashboard.owner")).toBe(false);
    // …and the fence and the audit trail agree: nothing is fenced, nothing is rewritten.
    await expect(db.user.update({ where: { id: rec.id }, data: { phone: "0711000111" } })).resolves.toBeTruthy();
    await audit(db, { userId: boss.id, label: boss.fullName }, { action: "test.workas.forged", entityType: "Test", entityId: "x" });
    expect((await entries("test.workas.forged"))[0]).toMatchObject({ userId: boss.id, actorType: "STAFF" });
  });

  it("a normal staff session and a normal Developer session behave exactly as before", async () => {
    await signedInAs(rec);
    expect(await me()).toMatchObject({ id: rec.id, actorId: rec.id, actorName: rec.fullName, workAs: null, actorType: "STAFF" });
    await signedInAs(dev);
    const d = await me();
    expect(d).toMatchObject({ id: dev.id, actorId: dev.id, actorType: "DEVELOPER", workAs: null });
    expect(d.permissions.has("developer.access")).toBe(true);
    expect(d.permissions.has("payments.record")).toBe(false); // the Developer's own money wall is unchanged
    // the hotel's own work is not the Developer's: its own account does not hold it (2026-10-18) — only Work as hands it over (see above: reservations.check_in)
    for (const p of ["reservations.check_in", "restaurant.orders", "shifts.work", "rooms.status.update"]) expect(d.permissions.has(p as never), p).toBe(false);
  });
});

// ───────────────────────────────────── 2. starting and stopping ─────────────────────────────────────
describe("startWorkAs / endWorkAs", () => {
  it("a Developer starts: the session says who, the home is the person's own, the trail and the Boss are told", async () => {
    const hash = await signedInAs(dev);
    const out = await startWorkAs(await me(), rec.id);
    expect(out.home).toBe("/reception/dashboard");
    const row = await rawDb.session.findUniqueOrThrow({ where: { tokenHash: hash } });
    expect(row.workAsUserId).toBe(rec.id);
    expect(row.workAsStartedAt!.getTime()).toBeGreaterThan(Date.now() - 10_000);
    expect(await me()).toMatchObject({ id: rec.id, actorId: dev.id });

    const [started] = await entries("developer.work_as_started");
    expect(started).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: dev.fullName, entityType: "User", entityId: rec.id });
    expect(started.after).toMatchObject({ targetName: rec.fullName, targetRole: "Receptionist" });

    expect(tellBossSoon).toHaveBeenCalledTimes(1);
    const textFor = vi.mocked(tellBossSoon).mock.calls[0][0];
    const text = textFor(englishT, { timezone: "Africa/Dar_es_Salaam" } as never);
    expect(text).toMatch(new RegExp(`^${dev.fullName} \\(Developer\\) started working as ${rec.fullName} \\(Receptionist\\) at \\d\\d:\\d\\d\\.$`));
  });

  it("works for a Manager, the MD and the Boss (the Developer sees their dashboards) — each opens that person's own home", async () => {
    for (const [target, home] of [[mgr, "/manager/dashboard"], [md, "/admin/dashboard"], [boss, "/admin/dashboard"], [fin, "/finance/dashboard"], [waiter, "/staff/restaurant"]] as const) {
      await signedInAs(dev);
      expect((await startWorkAs(await me(), target.id)).home, target.role).toBe(home);
    }
  });

  it("is refused — and kept in the trail — for a non-Developer, a switched-off person, a Developer, a system account, an unknown id and a second start", async () => {
    // A staff member (even the Boss) cannot start it, whatever they pass in.
    for (const who of [rec, boss, md]) {
      const hash = await signedInAs(who);
      const e = await thrownBy(async () => startWorkAs(await me(), fin.id));
      expect(code(e), who.role).toBe("FORBIDDEN");
      expect((await rawDb.session.findUniqueOrThrow({ where: { tokenHash: hash } })).workAsUserId, who.role).toBeNull();
    }
    expect((await entries("developer.work_as_refused", { userId: rec.id })).length).toBe(1);

    await signedInAs(dev);
    const refused = async (id: string) => thrownBy(async () => startWorkAs(await me(), id));
    expect(code(await refused(offRec.id))).toBe("CONFLICT");
    expect(code(await refused(dev2.id))).toBe("FORBIDDEN");
    expect(code(await refused(dev.id))).toBe("FORBIDDEN");
    expect(code(await refused(system.id))).toBe("NOT_FOUND");
    expect(code(await refused("no-such-account"))).toBe("NOT_FOUND");
    expect((await entries("developer.work_as_refused", { userId: dev.id })).length).toBe(5);
    expect(await rawDb.session.count({ where: { userId: dev.id, workAsUserId: { not: null } } })).toBe(0);
    expect(tellBossSoon, "the Boss is told only about a real start").not.toHaveBeenCalled();

    await startWorkAs(await me(), rec.id);
    const again = await thrownBy(async () => startWorkAs(await me(), fin.id));
    expect(code(again)).toBe("CONFLICT");
    expect(again).toMatchObject({ message: expect.stringContaining("Press Stop first") });
    expect(await me()).toMatchObject({ id: rec.id }); // still the first person
    expect(tellBossSoon).toHaveBeenCalledTimes(1);
  });

  it("a staff session cannot be used even with the Developer's user object (the server checks the session itself)", async () => {
    await signedInAs(dev);
    const devUser = await me();
    await signedInAs(rec); // the browser now holds a STAFF session…
    const e = await thrownBy(() => startWorkAs(devUser, fin.id)); // …while a Developer object is passed in
    expect(code(e)).toBe("FORBIDDEN");
    expect(await rawDb.session.count({ where: { userId: { in: everyone.map((u) => u.id) }, workAsUserId: { not: null } } })).toBe(0);
  });

  it("stopping clears it, is audited with how long it lasted, and a second Stop writes nothing", async () => {
    await workingAs(rec, { startedMinAgo: 7 });
    const user = await me();
    await endWorkAs(user);
    expect(await me()).toMatchObject({ id: dev.id, workAs: null });
    const [ended] = await entries("developer.work_as_ended");
    expect(ended).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", entityId: rec.id });
    expect(ended.after).toMatchObject({ targetName: rec.fullName, targetRole: "Receptionist" });
    expect((ended.after as { minutes: number }).minutes).toBeGreaterThanOrEqual(7);
    await endWorkAs(user);
    expect((await entries("developer.work_as_ended")).length).toBe(1);
  });

  it("only a Developer may stop; requireDeveloperSession works inside work-as and refuses staff", async () => {
    await signedInAs(rec);
    expect(code(await thrownBy(async () => endWorkAs(await me())))).toBe("FORBIDDEN");
    expect(code(await thrownBy(() => requireDeveloperSession()))).toBe("FORBIDDEN");
    await workingAs(rec);
    expect(await requireDeveloperSession()).toMatchObject({ actorType: "DEVELOPER", id: rec.id, actorId: dev.id });
    browser.reset();
    expect(code(await thrownBy(() => requireDeveloperSession()))).toBe("UNAUTHENTICATED");
  });

  it("signing out while working as someone ends the Developer's own session (the fence does not stop it)", async () => {
    const hash = await workingAs(rec);
    await destroySession();
    expect(await rawDb.session.count({ where: { tokenHash: hash } })).toBe(0);
  });
});

// ───────────────────────── 3. while working as someone: the walls ─────────────────────────
describe("while working as someone: money and decisions are refused", () => {
  it("a Finance account cannot record a payment or a sale; a Reception account cannot record revenue, a payment or hand over cash — and the refusal is the Developer's", async () => {
    await workingAs(fin);
    expect(code(await thrownBy(() => authorize("payments.record")))).toBe("FORBIDDEN");
    expect(code(await thrownBy(() => authorize("purchases.pay")))).toBe("FORBIDDEN");
    const sale = await recordSaleAction(undefined, new FormData());
    expect(sale).toMatchObject({ ok: false, code: "FORBIDDEN" });
    const [denied] = await entries("developer.denied", { userId: dev.id });
    expect(denied).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", actorLabel: `${dev.fullName} (Developer) as ${fin.fullName} (Finance)` });
    expect(denied.after).toMatchObject({ kind: "action", actingAs: { id: fin.id, name: fin.fullName } });
    expect(await entries("developer.denied", { userId: fin.id }), "never under the person's own name").toHaveLength(0);

    await workingAs(rec);
    for (const right of ["revenue.record", "payments.record", "cash.handover.submit", "reservations.discount_override"] as const) {
      expect(code(await thrownBy(() => authorize(right))), right).toBe("FORBIDDEN");
    }
    // The same receptionist, in her own session, holds the money rights the Developer was denied.
    await signedInAs(rec);
    await db.actualShift.create({ data: { userId: rec.id, department: "RECEPTION", businessDate: new Date("2026-10-17") } });
    expect((await authorize("payments.record")).id).toBe(rec.id);
    await db.actualShift.deleteMany({ where: { userId: rec.id } });
  });

  it("the decision gates keep refusing a Developer working as a Manager, the MD or the Boss", async () => {
    for (const target of [mgr, md, boss]) {
      await workingAs(target);
      const user = await me();
      expect(canDecide(user, "dashboard.manager" as never) || canDecide(user, "dashboard.owner" as never) || canDecide(user, "dashboard.admin" as never), target.role).toBe(false);
      const e = await thrownBy(() => authorizeDecision("dashboard.manager", "dashboard.owner", "dashboard.admin"));
      expect(code(e), target.role).toBe("FORBIDDEN");
      expect(e).toMatchObject({ message: expect.stringContaining("The Developer account cannot make this decision") });
    }
  });

  it("the money wall inside the services still stands: the person's rights are marked, and a copy of them is caught by the request", async () => {
    await workingAs(mgr);
    const user = await me();
    // The gate by the marked rights…
    expect(code(await thrownBy(() => refuseDeveloper({ userId: user.id, label: user.fullName, permissions: user.permissions }, "reservations.discount_override")))).toBe("FORBIDDEN");
    // …and by the request, even when the rights were copied (the copy has lost the mark)
    expect(code(await thrownBy(() => refuseDeveloper({ userId: user.id, label: user.fullName, permissions: new Set(user.permissions) }, "reservations.discount_override")))).toBe("FORBIDDEN");
    // Somebody else, in this same request, is not the Developer.
    await expect(refuseDeveloper({ userId: boss.id, label: boss.fullName, permissions: new Set(user.permissions) }, "x")).resolves.toBeUndefined();
    // And in the manager's own session nothing is refused.
    await signedInAs(mgr);
    const own = await me();
    await expect(refuseDeveloper({ userId: own.id, label: own.fullName, permissions: own.permissions }, "x")).resolves.toBeUndefined();
    expect(actsAsDeveloper({ permissions: own.permissions })).toBe(false);
  });

  it("the receptionist's shift gate is not applied to a Developer working as her (it never starts a shift for her either)", async () => {
    await workingAs(rec);
    expect((await authorize("reservations.view")).id).toBe(rec.id);
    expect(await db.actualShift.count({ where: { userId: rec.id } })).toBe(0);
    await signedInAs(rec); // her own session, no open shift: the gate says no
    expect(code(await thrownBy(() => authorize("reservations.view")))).toBe("FORBIDDEN");
  });
});

describe("while working as someone: nothing about accounts can be changed", () => {
  it("every changing function of staff-accounts refuses with the one plain message (and a Developer's refusal is kept under the Developer); the list can still be read", async () => {
    for (const target of [md, boss]) {
      await workingAs(target);
      const actor = await me();
      const before = await db.user.findMany({ orderBy: { id: "asc" }, select: { id: true, fullName: true, email: true, isActive: true, passwordHash: true, roleId: true } });
      const roleRights = await db.rolePermission.count();
      const role = await db.role.findUniqueOrThrow({ where: { code: "RECEPTIONIST" } });
      const calls: [string, () => Promise<unknown>][] = [
        ["create", () => createStaffAccount(actor, { fullName: "Sneaky Admin", email: "sneaky@devtest.local", phone: null, roleId: role.id, password: "Sneaky-12345-x" })],
        ["update", () => updateStaffAccount(actor, { userId: rec.id, fullName: rec.fullName, email: "taken-over@devtest.local", phone: null, roleId: role.id, isActive: true })],
        ["reset", () => resetStaffPassword(actor, { userId: rec.id, password: "Takeover-12345-x" })],
        ["right", () => setRolePermission(actor, { roleId: role.id, permission: "inventory.view", granted: true })],
        ["delete", () => deleteStaffAccount(actor, { userId: fin.id })],
      ];
      for (const [label, run] of calls) {
        const e = await thrownBy(run);
        expect(code(e), `${target.role} ${label}`).toBe("FORBIDDEN");
        expect((e as Error).message, label).toBe(DEVELOPER_NO_ACCOUNTS);
      }
      expect(await db.user.findMany({ orderBy: { id: "asc" }, select: { id: true, fullName: true, email: true, isActive: true, passwordHash: true, roleId: true } })).toEqual(before);
      expect(await db.rolePermission.count()).toBe(roleRights);
      expect((await staffDirectory()).users.length, "reading the list stays open").toBeGreaterThan(3);
    }
    // The refusals are the Developer's own entries (never the MD's or the Boss's).
    const failed = await entries("user.create_failed");
    expect(failed.length).toBeGreaterThanOrEqual(2);
    for (const row of failed) {
      expect(row).toMatchObject({ userId: dev.id, actorType: "DEVELOPER" });
      expect(row.after).toMatchObject({ actingAs: expect.objectContaining({ name: expect.any(String) }) });
    }
  });

  it("own password, profile (name, phone, login email), other-device sign-out, language and alert sound are refused — and nothing is saved", async () => {
    await workingAs(rec);
    const before = await db.user.findUniqueOrThrow({ where: { id: rec.id } });
    const sessionsBefore = await rawDb.session.count();
    const f = (o: Record<string, string>) => Object.entries(o).reduce((fd, [k, v]) => (fd.set(k, v), fd), new FormData());

    const pw = await changePasswordAction(undefined, f({ currentPassword: rec.password, newPassword: "Brand-new-pass-77", confirmPassword: "Brand-new-pass-77" }));
    expect(pw).toMatchObject({ ok: false, code: "FORBIDDEN" });
    const profile = await updateProfileAction(undefined, f({ fullName: "Neema Taken", email: "mine@devtest.local", phone: "0712345678", currentPassword: rec.password }));
    expect(profile).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await signOutOtherDevicesAction()).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await setAlertSoundAction(true)).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await setMyLanguage("zh-CN")).toEqual({ ok: false });

    expect(await db.user.findUniqueOrThrow({ where: { id: rec.id } })).toEqual(before);
    expect(await rawDb.session.count()).toBe(sessionsBefore);
    // The same actions work in the person's own session.
    await signedInAs(rec);
    expect(await setAlertSoundAction(true)).toMatchObject({ ok: true });
    expect(await setMyLanguage("zh-CN")).toEqual({ ok: true });
  });

  it("assertNotWorkAs: refuses a Developer working as someone, nobody else", async () => {
    await workingAs(rec);
    const u = await me();
    expect(() => assertNotWorkAs(u, "do the thing")).toThrow("While you are working as someone you cannot do the thing.");
    await signedInAs(dev);
    expect(() => assertNotWorkAs(null, "x")).not.toThrow();
    expect(() => assertNotWorkAs({ workAs: null }, "x")).not.toThrow();
    expect(() => assertNotWorkAs(undefined, "x")).not.toThrow();
  });
});

describe("while working as someone: the database itself refuses to write accounts, sessions, roles and rights", () => {
  const writes = (userId: string, roleId: string, permissionId: string): [string, () => Promise<unknown>][] => [
    ["user.update", () => db.user.update({ where: { id: userId }, data: { fullName: "Hacked" } })],
    ["user.updateMany", () => db.user.updateMany({ where: { id: userId }, data: { passwordHash: "x" } })],
    ["user.create", () => db.user.create({ data: { email: "fence@devtest.local", fullName: "Fence", passwordHash: "x", roleId } })],
    ["user.upsert", () => db.user.upsert({ where: { id: userId }, update: { phone: "1" }, create: { email: "u@devtest.local", fullName: "U", passwordHash: "x", roleId } })],
    ["user.delete", () => db.user.delete({ where: { id: userId } })],
    ["user.deleteMany", () => db.user.deleteMany({ where: { id: userId } })],
    ["session.create", () => db.session.create({ data: { tokenHash: "forged-token-hash", userId, expiresAt: new Date(Date.now() + 1e6) } })],
    ["session.deleteMany", () => db.session.deleteMany({ where: { userId } })],
    ["session.update", () => db.session.updateMany({ where: { userId }, data: { expiresAt: new Date() } })],
    ["role.update", () => db.role.update({ where: { id: roleId }, data: { name: "Renamed" } })],
    ["rolePermission.create", () => db.rolePermission.create({ data: { roleId, permissionId } })],
    ["rolePermission.deleteMany", () => db.rolePermission.deleteMany({ where: { roleId } })],
    ["permission.update", () => db.permission.update({ where: { id: permissionId }, data: { description: "x" } })],
    ["in a transaction", () => db.$transaction(async (tx) => { await tx.user.update({ where: { id: userId }, data: { fullName: "Hacked" } }); })],
    ["in a batch transaction", () => db.$transaction([db.user.update({ where: { id: userId }, data: { fullName: "Hacked" } })])],
  ];

  it("refuses every kind of write — even from a code path that forgot to ask — and writes nothing", async () => {
    await workingAs(rec);
    const role = await db.role.findUniqueOrThrow({ where: { code: "RECEPTIONIST" } });
    const permission = await db.permission.findFirstOrThrow({ where: { code: "inventory.view" } });
    const snapshot = async () => JSON.stringify([await db.user.count(), await db.session.count(), await db.rolePermission.count(), await db.role.findMany({ orderBy: { id: "asc" } }), await db.user.findUnique({ where: { id: rec.id } })]);
    const before = await snapshot();
    for (const [label, run] of writes(rec.id, role.id, permission.id)) {
      const e = await thrownBy(run);
      expect(code(e), label).toBe("FORBIDDEN");
      expect((e as Error).message, label).toMatch(WHILE);
    }
    expect(await snapshot()).toBe(before);
    // Reading is never fenced.
    expect(await db.user.findUnique({ where: { id: rec.id } })).toBeTruthy();
    expect((await db.role.findMany()).length).toBeGreaterThan(5);
  });

  it("is off for everyone else: a staff session, a Developer as themselves, and no request at all (cron, webhooks, scripts)", async () => {
    const role = await db.role.findUniqueOrThrow({ where: { code: "RECEPTIONIST" } });
    await signedInAs(rec);
    await expect(db.user.update({ where: { id: rec.id }, data: { phone: "0700000001" } })).resolves.toBeTruthy();
    await signedInAs(dev);
    await expect(db.user.update({ where: { id: rec.id }, data: { phone: "0700000002" } })).resolves.toBeTruthy();
    await expect(db.$transaction(async (tx) => tx.role.update({ where: { id: role.id }, data: { name: role.name } }))).resolves.toBeTruthy();
    browser.reset(); // no cookie at all
    await expect(db.user.update({ where: { id: rec.id }, data: { phone: "0700000003" } })).resolves.toBeTruthy();
    await expect(db.session.deleteMany({ where: { expiresAt: { lt: new Date(0) } } })).resolves.toBeTruthy();
    // A stale work-as (older than 4 hours) fences nothing: the Developer is themselves again.
    await workingAs(rec, { startedMinAgo: WORK_AS_HOURS * 60 + 5 });
    await expect(db.user.update({ where: { id: rec.id }, data: { phone: "0700000004" } })).resolves.toBeTruthy();
    // After Stop the Developer may write again.
    await workingAs(rec);
    await endWorkAs(await me());
    await expect(db.user.update({ where: { id: rec.id }, data: { phone: "0700000005" } })).resolves.toBeTruthy();
  });
});

// ───────────────────────── 4. ordinary work goes through, and the trail tells the truth ─────────────────────────
describe("ordinary work while working as someone", () => {
  it("a room's cleaning status can be changed; the room's own history says Neema, the audit trail says the Developer (as Neema)", async () => {
    await resetBusinessData();
    const room = await db.room.findFirstOrThrow({ where: { isActive: true, status: "AVAILABLE" } });
    await workingAs(rec);
    const res = await changeRoomStatusAction({ roomId: room.id, status: "DIRTY", note: "guest left early" });
    expect(res.ok, res.ok ? "" : res.error).toBe(true);
    expect((await db.room.findUniqueOrThrow({ where: { id: room.id } })).status).toBe("DIRTY");
    // The hotel's own record carries the person whose dashboard it was.
    expect((await db.roomStatusHistory.findFirstOrThrow({ where: { roomId: room.id }, orderBy: { changedAt: "desc" } })).changedById).toBe(rec.id);

    const rows = await entries("room.status_changed", { entityId: room.id });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      userId: dev.id, actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: `${dev.fullName} (Developer) as ${rec.fullName} (Receptionist)`,
      after: { status: "DIRTY", actingAs: { id: rec.id, name: rec.fullName, role: "Receptionist" } },
    });
    expect(await db.auditLog.count({ where: { action: "room.status_changed", userId: rec.id } }), "never under Neema's own id").toBe(0);
  });

  it("the same audit call from Neema's OWN session in the same moment stays Neema's — and so does anyone else's", async () => {
    await resetBusinessData();
    // The Developer is working as Neema in one browser, Neema herself works in another.
    await workingAs(rec);
    const devBrowser = browser.save();
    await signedInAs(rec);
    const neemaBrowser = browser.save();

    browser.restore(neemaBrowser);
    await audit(db, { userId: rec.id, label: rec.fullName }, { action: "test.workas.same_moment", entityType: "Test", entityId: "own", after: { who: "neema" } });
    browser.restore(devBrowser);
    await audit(db, { userId: rec.id, label: rec.fullName }, { action: "test.workas.same_moment", entityType: "Test", entityId: "dev", after: { who: "developer" } });
    // In the Developer's request, an entry about SOMEONE ELSE (a system job, another staff member) is never touched.
    await audit(db, { userId: boss.id, label: boss.fullName }, { action: "test.workas.same_moment", entityType: "Test", entityId: "boss" });
    await audit(db, { userId: null, label: "system" }, { action: "test.workas.same_moment", entityType: "Test", entityId: "system" });
    await audit(db, { userId: dev.id, label: dev.fullName }, { action: "test.workas.same_moment", entityType: "Test", entityId: "devself" });

    const by = async (entityId: string) => (await entries("test.workas.same_moment", { entityId }))[0];
    expect(await by("own")).toMatchObject({ userId: rec.id, actorType: "STAFF", actorLabel: rec.fullName, after: { who: "neema" } });
    expect(await by("dev")).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", actorLabel: `${dev.fullName} (Developer) as ${rec.fullName} (Receptionist)`, after: { who: "developer", actingAs: { id: rec.id } } });
    expect(await by("boss")).toMatchObject({ userId: boss.id, actorType: "STAFF", actorLabel: boss.fullName });
    expect((await by("boss")).after).toBeNull();
    expect(await by("system")).toMatchObject({ userId: null, actorType: "SYSTEM" });
    expect(await by("devself")).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", actorLabel: dev.fullName });
    expect((await by("devself")).after).toBeNull();
    // No request (a cron job): the same call is the person's, as written.
    browser.reset();
    await audit(db, { userId: rec.id, label: rec.fullName }, { action: "test.workas.same_moment", entityType: "Test", entityId: "cron" });
    expect(await by("cron")).toMatchObject({ userId: rec.id, actorType: "STAFF" });
  });

  it("an entry whose 'after' is not an object keeps its value beside actingAs", async () => {
    await workingAs(rec);
    await audit(db, { userId: rec.id, label: rec.fullName }, { action: "test.workas.shape", entityType: "Test", entityId: "list", after: [1, 2] });
    await audit(db, { userId: rec.id, label: rec.fullName }, { action: "test.workas.shape", entityType: "Test", entityId: "none" });
    const by = async (entityId: string) => (await entries("test.workas.shape", { entityId }))[0];
    expect((await by("list")).after).toMatchObject({ value: [1, 2], actingAs: { id: rec.id } });
    expect((await by("none")).after).toMatchObject({ actingAs: { id: rec.id } });
  });

  it("a Developer's page visits are written as the Developer (as the person), once per person acted as per 10 minutes", async () => {
    await workingAs(rec);
    const asRec = await me();
    expect(await logDeveloperView(asRec, "/reception/dashboard", { ipAddress: "41.1.1.1" })).toBe("logged");
    expect(await logDeveloperView(asRec, "/reception/dashboard")).toBe("repeat");
    const [visit] = await entries("developer.viewed", { entityId: "/reception/dashboard" });
    expect(visit).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", actorLabel: `${dev.fullName} (Developer) as ${rec.fullName} (Receptionist)`, ipAddress: "41.1.1.1", after: { path: "/reception/dashboard", actingAs: { id: rec.id, name: rec.fullName } } });
    expect(await db.auditLog.count({ where: { action: "developer.viewed", userId: rec.id } })).toBe(0);
    // The same page as ANOTHER person is a new visit; as the Developer themselves, too.
    await workingAs(mgr);
    expect(await logDeveloperView(await me(), "/reception/dashboard")).toBe("logged");
    await signedInAs(dev);
    expect(await logDeveloperView(await me(), "/reception/dashboard")).toBe("logged");
    expect(await entries("developer.viewed", { entityId: "/reception/dashboard", userId: dev.id })).toHaveLength(3);
  });
});

// ───────────────────────── 5. suspend, switch back on, sign out everywhere ─────────────────────────
describe("suspendAccount / reactivateAccount / signOutEverywhere", () => {
  const ok = { reason: "Phone reported lost", confirm: "CONFIRM" };

  it("suspends: switched off, every session ended, the reason in the trail under the Developer", async () => {
    const d = await developerUser();
    await rawDb.session.createMany({ data: [1, 2].map((i) => ({ tokenHash: `rec-session-${i}-${Date.now()}`, userId: rec.id, expiresAt: new Date(Date.now() + 3600_000) })) });
    await suspendAccount(d, rec.id, ok);
    expect((await db.user.findUniqueOrThrow({ where: { id: rec.id } })).isActive).toBe(false);
    expect(await rawDb.session.count({ where: { userId: rec.id } })).toBe(0);
    const [row] = await entries("user.suspended");
    expect(row).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", entityId: rec.id });
    expect(row.after).toMatchObject({ isActive: false, reason: "Phone reported lost", signedOut: 2 });
  });

  it("needs a real reason (5+ characters) and the word CONFIRM exactly", async () => {
    const d = await developerUser();
    for (const [label, input] of [["short reason", { reason: "oops", confirm: "CONFIRM" }], ["empty reason", { reason: "   ", confirm: "CONFIRM" }], ["lowercase", { reason: "a fine reason", confirm: "confirm" }], ["trailing space", { reason: "a fine reason", confirm: "CONFIRM " }], ["nothing", { reason: "a fine reason", confirm: "" }]] as const) {
      expect(code(await thrownBy(() => suspendAccount(d, rec.id, input))), label).toBe("VALIDATION");
    }
    expect((await db.user.findUniqueOrThrow({ where: { id: rec.id } })).isActive).toBe(true);
    expect((await entries("user.suspend_failed", { userId: dev.id })).length, "every refused try by a Developer is kept").toBe(5);
  });

  it("never a permanent owner, a Developer account, a system account, itself — or one that is already off; and not while working as someone", async () => {
    process.env.PERMANENT_OWNER_EMAILS = boss.email;
    const d = await developerUser();
    expect(code(await thrownBy(() => suspendAccount(d, boss.id, ok)))).toBe("FORBIDDEN");
    expect(await thrownBy(() => suspendAccount(d, boss.id, ok))).toMatchObject({ message: expect.stringContaining("permanent owner") });
    expect(code(await thrownBy(() => suspendAccount(d, dev2.id, ok)))).toBe("FORBIDDEN");
    expect(code(await thrownBy(() => suspendAccount(d, dev.id, ok)))).toBe("FORBIDDEN");
    expect(code(await thrownBy(() => suspendAccount(d, system.id, ok)))).toBe("NOT_FOUND");
    expect(code(await thrownBy(() => suspendAccount(d, "nobody", ok)))).toBe("NOT_FOUND");
    expect(code(await thrownBy(() => suspendAccount(d, offRec.id, ok)))).toBe("CONFLICT");
    for (const u of [boss, dev2, dev, system]) expect((await db.user.findUniqueOrThrow({ where: { id: u.id } })).isActive).toBe(true);
    // Not a Developer at all.
    await signedInAs(md);
    expect(code(await thrownBy(async () => suspendAccount(await me(), rec.id, ok)))).toBe("FORBIDDEN");
    // Not while working as someone (even as the MD, who may manage accounts).
    await workingAs(md);
    const e = await thrownBy(async () => suspendAccount(await me(), rec.id, ok));
    expect(code(e)).toBe("FORBIDDEN");
    expect((e as Error).message).toMatch(WHILE);
    expect((await db.user.findUniqueOrThrow({ where: { id: rec.id } })).isActive).toBe(true);
  });

  it("switches back on only what THIS Developer suspended, and never an account with money rights", async () => {
    const d = await developerUser();
    await suspendAccount(d, rec.id, ok);
    await suspendAccount(d, fin.id, ok); // a safety brake on a money account is allowed…
    await suspendAccount(d, mgr.id, ok);

    // …but it is the Boss's or the MD's to switch back on: Finance and the Manager hold money rights.
    expect(code(await thrownBy(() => reactivateAccount(d, fin.id, { reason: "all clear again" })))).toBe("FORBIDDEN");
    expect(code(await thrownBy(() => reactivateAccount(d, mgr.id, { reason: "all clear again" })))).toBe("FORBIDDEN");
    expect((await db.user.findUniqueOrThrow({ where: { id: fin.id } })).isActive).toBe(false);

    // Reception holds payments.record too — a money right — so it is also out of reach:
    expect(code(await thrownBy(() => reactivateAccount(d, rec.id, { reason: "all clear again" })))).toBe("FORBIDDEN");
    // A driver holds no right the Developer is denied (money, accounts): this one may be switched back on by the Developer who suspended it.
    await suspendAccount(d, driver.id, ok);
    expect(code(await thrownBy(() => reactivateAccount(d, driver.id, { reason: "x" })))).toBe("VALIDATION"); // a reason is needed
    await reactivateAccount(d, driver.id, { reason: "Phone found, checked with the manager" });
    expect((await db.user.findUniqueOrThrow({ where: { id: driver.id } })).isActive).toBe(true);
    const [back] = await entries("user.reactivated", { entityId: driver.id });
    expect(back).toMatchObject({ userId: dev.id, actorType: "DEVELOPER" });
    expect(back.after).toMatchObject({ isActive: true, reason: "Phone found, checked with the manager" });
    // Not suspended: nothing to switch on.
    expect(code(await thrownBy(() => reactivateAccount(d, driver.id, { reason: "again and again" })))).toBe("CONFLICT");
  });

  it("does not switch back on an account that someone else switched off — or that was switched since", async () => {
    const d = await developerUser();
    const pause = () => new Promise((r) => setTimeout(r, 8));
    const log = async (userId: string, action: string, entityId: string, after: unknown = {}) => { await pause(); await audit(db, { userId, label: "x" }, { action, entityType: "User", entityId, after }); };

    // Switched off by the Boss (Users page), not by this Developer.
    await rawDb.user.update({ where: { id: driver.id }, data: { isActive: false } });
    await log(boss.id, "user.deactivated", driver.id);
    expect(code(await thrownBy(() => reactivateAccount(d, driver.id, { reason: "let me in" })))).toBe("FORBIDDEN");

    // Suspended by ANOTHER Developer.
    await rawDb.user.update({ where: { id: driver.id }, data: { isActive: true } });
    await signedInAs(dev2);
    await suspendAccount(await me(), driver.id, ok);
    await signedInAs(dev);
    expect(code(await thrownBy(async () => reactivateAccount(await me(), driver.id, { reason: "let me in" })))).toBe("FORBIDDEN");

    // Suspended by this Developer, then switched on and off again by the Boss: no longer theirs.
    await rawDb.user.update({ where: { id: driver.id }, data: { isActive: true } });
    await signedInAs(dev);
    await suspendAccount(await me(), driver.id, ok);
    await rawDb.user.update({ where: { id: driver.id }, data: { isActive: true } });
    await log(boss.id, "user.reactivated", driver.id);
    await rawDb.user.update({ where: { id: driver.id }, data: { isActive: false } });
    await log(boss.id, "user.deactivated", driver.id);
    expect(code(await thrownBy(async () => reactivateAccount(await me(), driver.id, { reason: "let me in" })))).toBe("FORBIDDEN");
    // An account that was never suspended through the trail at all.
    expect(code(await thrownBy(async () => reactivateAccount(await me(), offRec.id, { reason: "let me in" })))).toBe("FORBIDDEN");
    // An edit that does not change on/off (a name or a phone) does not take the suspension away from its owner.
    await rawDb.user.update({ where: { id: driver.id }, data: { isActive: true } });
    await signedInAs(dev);
    await suspendAccount(await me(), driver.id, ok);
    await log(boss.id, "user.updated", driver.id, { isActive: false });
    await reactivateAccount(await me(), driver.id, { reason: "name only was edited" });
    expect((await db.user.findUniqueOrThrow({ where: { id: driver.id } })).isActive).toBe(true);
  });

  it("signs a person out everywhere (they can sign straight back in); never a Developer, a system account or itself; not while working as someone", async () => {
    const d = await developerUser();
    await rawDb.session.createMany({ data: [1, 2, 3].map((i) => ({ tokenHash: `fin-session-${i}-${Date.now()}`, userId: fin.id, expiresAt: new Date(Date.now() + 3600_000) })) });
    expect(await signOutEverywhere(d, fin.id)).toEqual({ sessionsEnded: 3 });
    expect(await rawDb.session.count({ where: { userId: fin.id } })).toBe(0);
    expect((await db.user.findUniqueOrThrow({ where: { id: fin.id } })).isActive, "signing out does not switch the account off").toBe(true);
    const [row] = await entries("user.signed_out_everywhere");
    expect(row).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", entityId: fin.id });
    expect(row.after).toMatchObject({ sessionsEnded: 3 });
    expect(await signOutEverywhere(d, fin.id)).toEqual({ sessionsEnded: 0 });

    for (const id of [dev2.id, dev.id]) expect(code(await thrownBy(() => signOutEverywhere(d, id)))).toBe("FORBIDDEN");
    expect(code(await thrownBy(() => signOutEverywhere(d, system.id)))).toBe("NOT_FOUND");
    expect(await rawDb.session.count({ where: { userId: dev.id } }), "the Developer's own session stays").toBe(1);

    await signedInAs(rec);
    expect(code(await thrownBy(async () => signOutEverywhere(await me(), fin.id)))).toBe("FORBIDDEN");
    await workingAs(md);
    const e = await thrownBy(async () => signOutEverywhere(await me(), fin.id));
    expect(code(e)).toBe("FORBIDDEN");
    expect((e as Error).message).toMatch(WHILE);
  });
});

// ───────────────────────────────────────── the Access list ─────────────────────────────────────────
describe("accessPeople", () => {
  it("lists every account but the Developer's and the system's, grouped by role with the Boss first, with what may be pressed", async () => {
    process.env.PERMANENT_OWNER_EMAILS = boss.email;
    const d = await developerUser();
    await suspendAccount(d, driver.id, { reason: "Phone reported lost", confirm: "CONFIRM" });
    await suspendAccount(d, fin.id, { reason: "Phone reported lost", confirm: "CONFIRM" });
    await suspendAccount(d, waiter.id, { reason: "Phone reported lost", confirm: "CONFIRM" });
    const groups = await accessPeople(await me());
    const everyoneListed = groups.flatMap((g) => g.people);
    expect(groups[0].roleCode).toBe("OWNER");
    expect(groups.map((g) => g.roleCode)).not.toContain("DEVELOPER");
    expect(groups.map((g) => g.roleCode)).not.toContain("SYSTEM_ONLINE");
    expect(everyoneListed.find((p) => p.id === dev.id)).toBeUndefined();
    expect(everyoneListed.find((p) => p.id === dev2.id)).toBeUndefined();
    expect(everyoneListed.find((p) => p.id === system.id)).toBeUndefined();
    expect(groups.every((g) => typeof g.roleDescription === "string" && g.people.every((p) => p.roleCode === g.roleCode))).toBe(true);

    const p = (u: MadeUser) => everyoneListed.find((x) => x.id === u.id)!;
    expect(p(boss)).toMatchObject({ roleCode: "OWNER", isActive: true, canWorkAs: true, canSuspend: false, canSignOut: false, canDelete: false, canReactivate: false, note: "Permanent owner: can't be suspended or deleted" });
    expect(p(md)).toMatchObject({ canWorkAs: true, canSuspend: true, canSignOut: true, canDelete: true, canReactivate: false, note: null });
    expect(p(rec)).toMatchObject({ fullName: rec.fullName, email: rec.email, roleName: "Receptionist", canWorkAs: true, canSuspend: true, canSignOut: true });
    expect(p(driver)).toMatchObject({ isActive: false, canWorkAs: false, canSuspend: false, canSignOut: false, canReactivate: true, note: null });
    expect(p(fin)).toMatchObject({ isActive: false, canReactivate: false, note: "Only the Boss or the MD can switch this account back on" });
    // a Waiter holds no right the Developer is denied (money, accounts), so the Developer who suspended it may switch it back on
    expect(p(waiter)).toMatchObject({ isActive: false, canReactivate: true, note: null });
    expect(p(offRec)).toMatchObject({ isActive: false, canReactivate: false, canWorkAs: false });
  });

  it("is for a Developer only; inside work-as nothing may be pressed", async () => {
    await signedInAs(rec);
    expect(code(await thrownBy(async () => accessPeople(await me())))).toBe("FORBIDDEN");
    await workingAs(rec);
    const groups = await accessPeople(await me());
    expect(groups.flatMap((g) => g.people).length).toBeGreaterThan(5);
    for (const person of groups.flatMap((g) => g.people)) expect(person, person.fullName).toMatchObject({ canWorkAs: false, canSuspend: false, canReactivate: false, canSignOut: false });
  });
});
