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
vi.mock("@/server/services/report-delivery", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), tellBossSoon: vi.fn() }));

import { db, rawDb } from "@/server/db";
import { audit } from "@/server/audit";
import { authorize, authorizeDecision, canDecide, getCurrentUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import { refuseDeveloper } from "@/server/developer-wall";
import { refuseShiftWork } from "@/server/shift-wall";
import { DEVELOPER_DENIED } from "@/lib/permissions";
import { browser, makeSession, makeUser, removeMadeUsers, sha256, thrownBy, type MadeUser } from "../support/developer";

/**
 * WORK AS = FULL ACCESS (owner, 2026-10-19: "when I work as someone it should be full access — I should be able to change, add, modify anything, because I
 * am working as that person"). Working as a person the Developer holds exactly that person's rights — money, decisions, shifts — and the audit trail still
 * says who really acted. His OWN account (outside Work as) still decides nothing and records no money.
 */

let dev: MadeUser;
let rec: MadeUser;
let mgr: MadeUser;
let md: MadeUser;
const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);

beforeAll(async () => { [dev, rec, mgr, md] = await Promise.all([makeUser("DEVELOPER"), makeUser("RECEPTIONIST"), makeUser("MANAGER"), makeUser("ADMIN")]); });
afterAll(async () => { browser.reset(); await removeMadeUsers(); });
beforeEach(() => { browser.reset(); });

/** The Developer signed in: on his own account, or already working as `target` (written to the session row, as startWorkAs does). */
async function developerAs(target: MadeUser | null) {
  const token = await makeSession(dev.id, { createdMinAgo: 1, seenMinAgo: 0 });
  if (target) await rawDb.session.update({ where: { tokenHash: sha256(token) }, data: { workAsUserId: target.id, workAsStartedAt: new Date(Date.now() - 60_000) } });
  return (await getCurrentUser())!;
}
const rightsOfRole = async (u: MadeUser) => new Set((await db.permission.findMany({ where: { roles: { some: { role: { users: { some: { id: u.id } } } } } }, select: { code: true } })).map((p) => p.code));

describe("working as a person: that person's full rights", () => {
  it("every right the person holds, the money rights included — and the Developer-only right is never handed over", async () => {
    for (const target of [rec, mgr, md]) {
      browser.reset();
      const user = await developerAs(target);
      expect(user.workAs, target.role).toBeTruthy();
      const theirs = await rightsOfRole(target);
      for (const right of theirs) expect(user.permissions.has(right as never), `${target.role}: ${right}`).toBe(true);
      expect(user.permissions.has("developer.access" as never)).toBe(false);
    }
    // the receptionist holds payments.record, a right the Developer's own account is denied: working as her he holds it
    expect(DEVELOPER_DENIED).toContain("payments.record");
    browser.reset();
    expect((await developerAs(rec)).permissions.has("payments.record")).toBe(true);
  });

  it("decisions about money are his to make as the manager, the MD", async () => {
    for (const target of [mgr, md]) {
      browser.reset();
      const user = await developerAs(target);
      expect(canDecide(user, "dashboard.manager") || canDecide(user, "dashboard.admin"), target.role).toBe(true);
      expect((await authorizeDecision("dashboard.manager", "dashboard.admin")).id, target.role).toBe(target.id);
    }
  });

  it("the services' wall and the shift wall do nothing while he works as someone", async () => {
    const user = await developerAs(mgr);
    const actor = { userId: user.id, label: user.fullName, permissions: user.permissions };
    await refuseDeveloper(actor, "restaurant.menu"); // does not throw
    await refuseShiftWork(actor, "close a shift", "shifts.manage"); // does not throw
  });

  it("the audit trail still says who really acted: the Developer, 'as' the person — never the person", async () => {
    await developerAs(rec);
    await audit(db, { userId: rec.id, label: rec.fullName }, { action: "full_access.probe", entityType: "Probe", entityId: "p1" });
    const row = await db.auditLog.findFirstOrThrow({ where: { action: "full_access.probe" } });
    expect(row).toMatchObject({ actorType: "DEVELOPER", userId: dev.id });
    expect(JSON.stringify(row.after)).toContain(rec.fullName);
  });
});

describe("his OWN account (not working as anyone) is still closed", () => {
  it("decides nothing, and the walls refuse him", async () => {
    const user = await developerAs(null);
    expect(user.workAs).toBeFalsy();
    expect(canDecide(user, "dashboard.admin")).toBe(false);
    expect(code(await thrownBy(() => authorizeDecision("dashboard.admin", "dashboard.owner", "dashboard.manager")))).toBe("FORBIDDEN");
    const actor = { userId: user.id, label: user.fullName, permissions: user.permissions };
    expect(code(await thrownBy(() => refuseDeveloper(actor, "restaurant.menu")))).toBe("FORBIDDEN");
    expect(code(await thrownBy(() => refuseShiftWork(actor, "close a shift", "shifts.manage")))).toBe("FORBIDDEN");
    expect(code(await thrownBy(() => authorize("payments.record")))).toBe("FORBIDDEN");
  });
});
