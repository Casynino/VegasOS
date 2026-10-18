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
import { getCurrentUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import { tellBossSoon } from "@/server/services/report-delivery";
import { authenticate } from "@/server/services/auth-login";
import { accessPeople, createAccount, deleteAccount } from "@/server/services/work-as";
import { deleteStaffAccount, staffDirectory, updateStaffAccount, type AccountActor } from "@/server/services/staff-accounts";
import { englishT } from "@/i18n/translate";
import { browser, makeSession, makeUser, removeMadeUsers, thrownBy, type MadeUser } from "../support/developer";

/**
 * DELETE AN ACCOUNT (owner, 2026-10-19): the Developer can delete any account — not only suspend it — but "delete" never deletes data: the person loses
 * all access and the account leaves the lists, while everything they did stays recorded under their name. Two permanent owners (the Developer accounts
 * and the e-mail addresses in PERMANENT_OWNER_EMAILS) can never be suspended or deleted, by anyone; the last active Boss can not be either.
 */

let dev: MadeUser;
let dev2: MadeUser;
let rec: MadeUser;
let md: MadeUser;
let boss: MadeUser;
let boss2: MadeUser;
const ok = { reason: "left the hotel", confirm: "DELETE" };
const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);
const actorOf = (u: MadeUser): AccountActor => ({ id: u.id, fullName: u.fullName, roleCode: u.role, actorType: "STAFF" });

beforeAll(async () => {
  [dev, dev2, md, boss, boss2] = await Promise.all([makeUser("DEVELOPER"), makeUser("DEVELOPER"), makeUser("ADMIN"), makeUser("OWNER"), makeUser("OWNER")]);
});
afterAll(async () => { browser.reset(); await removeMadeUsers(); });
beforeEach(async () => {
  delete process.env.PERMANENT_OWNER_EMAILS;
  vi.mocked(tellBossSoon).mockClear();
  browser.reset();
  rec = await makeUser("RECEPTIONIST");
});

const developerUser = async () => { await makeSession(dev.id); const u = await getCurrentUser(); if (!u) throw new Error("not signed in"); return u; };
const row = (id: string) => db.user.findUniqueOrThrow({ where: { id } });

describe("Delete removes access and the account from the lists — never the records", () => {
  it("the person can no longer sign in, has no session, is off every list, and the Boss is told", async () => {
    await makeSession(rec.id, { setCookie: false });
    const d = await developerUser();
    await deleteAccount(d, rec.id, ok);
    const after = await row(rec.id);
    expect(after).toMatchObject({ fullName: rec.fullName, isActive: false, email: `removed-${rec.id}@removed.invalid`, phone: null });
    expect(after.removedAt).toBeInstanceOf(Date);
    expect(await rawDb.session.count({ where: { userId: rec.id } })).toBe(0);
    expect((await authenticate(rec.email, rec.password)).ok).toBe(false);
    expect((await staffDirectory()).users.map((u) => u.id)).not.toContain(rec.id);
    expect((await accessPeople(d)).flatMap((g) => g.people).map((p) => p.id)).not.toContain(rec.id);
    const audit = await db.auditLog.findFirstOrThrow({ where: { action: "user.deleted", entityId: rec.id } });
    expect(audit).toMatchObject({ actorType: "DEVELOPER", userId: dev.id });
    expect(audit.before).toMatchObject({ fullName: rec.fullName, email: rec.email, role: "RECEPTIONIST" });
    expect(tellBossSoon).toHaveBeenCalledTimes(1);
    const message = (vi.mocked(tellBossSoon).mock.calls[0][0] as (t: typeof englishT, s: { timezone: string }) => string)(englishT, { timezone: "Africa/Dar_es_Salaam" });
    expect(message).toContain("deleted the account of");
    expect(message).toContain("stays recorded under their name");
  });

  it("a person WITH records can be deleted: the records stay and still carry the name", async () => {
    const room = await db.room.findFirstOrThrow();
    const made = await db.roomStatusHistory.create({ data: { roomId: room.id, fromStatus: "READY", toStatus: "CLEANING", note: "kept", changedById: rec.id } });
    await deleteAccount(await developerUser(), rec.id, ok);
    const kept = await db.roomStatusHistory.findUniqueOrThrow({ where: { id: made.id }, include: { changedBy: { select: { fullName: true } } } });
    expect(kept.changedBy?.fullName).toBe(rec.fullName);
    await db.roomStatusHistory.delete({ where: { id: made.id } });
  });

  it("the e-mail address is free again: the same person can be added afresh", async () => {
    const d = await developerUser();
    await deleteAccount(d, rec.id, ok);
    const roleId = (await db.role.findUniqueOrThrow({ where: { code: "RECEPTIONIST" } })).id;
    const again = await createAccount(d, { fullName: "Same Person", email: rec.email, phone: null, roleId, password: "Fresh-pass-2026-xK" });
    expect(again.userId).not.toBe(rec.id);
    await db.user.delete({ where: { id: again.userId } });
  });

  it("a removed account can not be switched back on, changed or deleted again (it is not there any more)", async () => {
    const d = await developerUser();
    await deleteAccount(d, rec.id, ok);
    expect(code(await thrownBy(() => deleteAccount(d, rec.id, ok)))).toBe("NOT_FOUND");
    const roleId = (await row(boss.id)).roleId;
    expect(code(await thrownBy(() => updateStaffAccount(actorOf(boss), { userId: rec.id, fullName: "X Y", email: "x@y.test", phone: null, roleId, isActive: true })))).toBe("NOT_FOUND");
  });

  it("the Boss's and the MD's accounts can be deleted by the Developer too (when another Boss stays)", async () => {
    const d = await developerUser();
    await deleteAccount(d, md.id, ok);
    expect((await row(md.id)).removedAt).toBeInstanceOf(Date);
    await deleteAccount(d, boss2.id, ok); // `boss` is still an active Boss
    expect((await row(boss2.id)).removedAt).toBeInstanceOf(Date);
  });
});

describe("who can never be deleted", () => {
  it("a permanent owner (an e-mail in PERMANENT_OWNER_EMAILS): not by the Developer, not by the Boss's own Delete, not switched off by the Boss's edit", async () => {
    process.env.PERMANENT_OWNER_EMAILS = ` ${boss.email.toUpperCase()} ; other@example.test `;
    const d = await developerUser();
    const e = await thrownBy(() => deleteAccount(d, boss.id, ok));
    expect(code(e)).toBe("FORBIDDEN");
    expect((e as AppError).message).toContain("permanent owner");
    expect(code(await thrownBy(() => deleteStaffAccount(actorOf(md), { userId: boss.id })))).toBe("FORBIDDEN");
    const roleId = (await row(boss.id)).roleId;
    expect(code(await thrownBy(() => updateStaffAccount(actorOf(boss2), { userId: boss.id, fullName: boss.fullName, email: boss.email, phone: null, roleId, isActive: false })))).toBe("FORBIDDEN");
    expect((await row(boss.id)).removedAt).toBeNull();
    expect((await row(boss.id)).isActive).toBe(true);
  });

  it("a Developer account, itself, the system account: refused", async () => {
    const d = await developerUser();
    expect(code(await thrownBy(() => deleteAccount(d, dev2.id, ok)))).toBe("FORBIDDEN");
    expect(code(await thrownBy(() => deleteAccount(d, dev.id, ok)))).toBe("FORBIDDEN");
    expect(code(await thrownBy(() => deleteAccount(d, "no-such-person", ok)))).toBe("NOT_FOUND");
  });

  it("the last active Boss can be deleted when a permanent owner with the MD's role stays active (the owner's own case: bashleyair@gmail.com)", async () => {
    const lonely = await makeUser("OWNER");
    const standIn = await makeUser("ADMIN");
    process.env.PERMANENT_OWNER_EMAILS = standIn.email;
    const others = await db.user.findMany({ where: { isActive: true, role: { code: "OWNER" }, id: { not: lonely.id } }, select: { id: true } });
    await db.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { isActive: false } });
    try {
      const d = await developerUser();
      const flags = (await accessPeople(d)).flatMap((g) => g.people).find((p) => p.id === lonely.id)!;
      expect(flags).toMatchObject({ canDelete: true, canSuspend: true }); // the old Boss's buttons are back
      await deleteAccount(d, lonely.id, ok);
      expect((await row(lonely.id)).removedAt).toBeInstanceOf(Date);
      expect((await row(standIn.id)).removedAt).toBeNull(); // the permanent owner is untouched
    } finally {
      await db.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { isActive: true } });
    }
  });

  it("the last active Boss: neither deleted nor — through the Developer — suspended", async () => {
    const others = await db.user.findMany({ where: { isActive: true, role: { code: "OWNER" }, id: { not: boss.id } }, select: { id: true } });
    await db.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { isActive: false } });
    try {
      const e = await thrownBy(async () => deleteAccount(await developerUser(), boss.id, ok));
      expect(code(e)).toBe("FORBIDDEN");
      expect((e as AppError).message).toContain("only Boss");
      expect((await row(boss.id)).removedAt).toBeNull();
    } finally {
      await db.user.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { isActive: true } });
    }
  });
});

describe("the rules around the button", () => {
  it("needs a real reason (5+ characters) and the word DELETE exactly", async () => {
    const d = await developerUser();
    for (const [label, input] of [["short reason", { reason: "no", confirm: "DELETE" }], ["lowercase", { reason: "left the hotel", confirm: "delete" }], ["wrong word", { reason: "left the hotel", confirm: "CONFIRM" }], ["trailing space", { reason: "left the hotel", confirm: "DELETE " }]] as const) {
      expect(code(await thrownBy(() => deleteAccount(d, rec.id, input))), label).toBe("VALIDATION");
    }
    expect((await row(rec.id)).removedAt).toBeNull();
  });

  it("only a Developer, and not while working as someone", async () => {
    await makeSession(md.id);
    const staff = (await getCurrentUser())!;
    expect(code(await thrownBy(() => deleteAccount(staff, rec.id, ok)))).toBe("FORBIDDEN");
    browser.reset();
    const hash = await makeSession(dev.id);
    void hash;
    const session = await rawDb.session.findFirstOrThrow({ where: { userId: dev.id }, orderBy: { createdAt: "desc" } });
    const someoneElse = await makeUser("RECEPTIONIST"); // (the MD was deleted by an earlier test: work as an active person)
    await rawDb.session.update({ where: { id: session.id }, data: { workAsUserId: someoneElse.id, workAsStartedAt: new Date() } });
    const working = (await getCurrentUser())!;
    expect(working.workAs).toBeTruthy();
    expect(code(await thrownBy(() => deleteAccount(working, rec.id, ok)))).toBe("FORBIDDEN");
    expect((await row(rec.id)).removedAt).toBeNull();
  });
});
