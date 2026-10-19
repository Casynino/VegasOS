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

import { randomUUID } from "node:crypto";
import { db, rawDb } from "@/server/db";
import { getCurrentUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import { resolveGuest, SUSPENDED_CUSTOMER_MESSAGE } from "@/server/services/guests";
import { deleteCustomer, findCustomers, reactivateCustomer, suspendCustomer } from "@/server/services/work-as";
import { browser, makeSession, makeUser, removeMadeUsers, thrownBy, type MadeUser } from "../support/developer";

/**
 * CUSTOMERS on the Developer's Access page (owner, 2026-10-19): found by name or phone number, suspended (no booking or ordering through the public pages;
 * the desk still serves them), switched back on, or deleted with the desk's own rules. Developer only, never while working as someone, all audited.
 */

let dev: MadeUser;
let rec: MadeUser;
const tag = randomUUID().slice(0, 6);
const created: string[] = [];
const code = (e: unknown) => (e instanceof AppError ? e.code : `not an AppError: ${String(e)}`);

const customer = async (name: string, phone: string | null) => {
  const g = await db.guest.create({ data: { fullName: name, phone } });
  created.push(g.id);
  return g;
};
const developerUser = async () => { browser.reset(); await makeSession(dev.id); return (await getCurrentUser())!; };

beforeAll(async () => { [dev, rec] = await Promise.all([makeUser("DEVELOPER"), makeUser("RECEPTIONIST")]); });
afterAll(async () => {
  browser.reset();
  await db.guest.deleteMany({ where: { id: { in: created } } });
  await removeMadeUsers();
});
beforeEach(() => { browser.reset(); });

describe("finding a customer", () => {
  it("by any part of the name, or of the number written the way it is spoken, or by the reference — and never a removed one", async () => {
    const ann = await customer(`Zanele ${tag} Mwakyusa`, "+255712000111");
    const removed = await customer(`Zanele ${tag} Removed`, "+255712000222");
    await db.guest.update({ where: { id: removed.id }, data: { deletedAt: new Date() } });
    const d = await developerUser();
    expect((await findCustomers(d, `zanele ${tag}`)).map((c) => c.id)).toEqual([ann.id]);
    expect((await findCustomers(d, "0712 000 111")).map((c) => c.id)).toContain(ann.id);
    expect((await findCustomers(d, "+255 712000111")).map((c) => c.id)).toContain(ann.id);
    expect((await findCustomers(d, "712000")).map((c) => c.id)).toContain(ann.id);
    expect((await findCustomers(d, "712000")).map((c) => c.id)).not.toContain(removed.id);
    const ref = (await db.guest.findUniqueOrThrow({ where: { id: ann.id } })).reference!;
    expect((await findCustomers(d, ref)).map((c) => c.id)).toEqual([ann.id]);
    expect((await findCustomers(d, `zanele ${tag}`))[0]).toMatchObject({ fullName: `Zanele ${tag} Mwakyusa`, phone: "+255712000111", suspended: false });
  });

  it("asks for at least two characters, and gives at most twenty", async () => {
    const d = await developerUser();
    expect(await findCustomers(d, "z")).toEqual([]);
    expect(await findCustomers(d, "   ")).toEqual([]);
    for (let i = 0; i < 22; i++) await customer(`Many ${tag} ${i}`, null);
    expect((await findCustomers(d, `many ${tag}`)).length).toBe(20);
  });

  it("only a Developer may look", async () => {
    await makeSession(rec.id);
    const staff = (await getCurrentUser())!;
    expect(code(await thrownBy(() => findCustomers(staff, "zanele")))).toBe("FORBIDDEN");
  });
});

describe("suspending a customer", () => {
  it("marks them, audits it under the Developer, and a second suspend or a switch-on of someone not suspended is refused", async () => {
    const g = await customer(`Sus ${tag} One`, "+255713000001");
    const d = await developerUser();
    await suspendCustomer(d, g.id);
    expect((await db.guest.findUniqueOrThrow({ where: { id: g.id } })).suspendedAt).toBeInstanceOf(Date);
    expect((await findCustomers(d, `sus ${tag}`))[0].suspended).toBe(true);
    const row = await db.auditLog.findFirstOrThrow({ where: { action: "guest.suspended", entityId: g.id } });
    expect(row).toMatchObject({ actorType: "DEVELOPER", userId: dev.id, entityType: "Guest" });
    expect(code(await thrownBy(() => suspendCustomer(d, g.id)))).toBe("CONFLICT");
    await reactivateCustomer(d, g.id);
    expect((await db.guest.findUniqueOrThrow({ where: { id: g.id } })).suspendedAt).toBeNull();
    expect(await db.auditLog.count({ where: { action: "guest.reactivated", entityId: g.id } })).toBe(1);
    expect(code(await thrownBy(() => reactivateCustomer(d, g.id)))).toBe("CONFLICT");
  });

  it("a suspended number cannot book or order through the public pages — but the desk can still use the customer", async () => {
    const g = await customer(`Sus ${tag} Two`, "+255713000002");
    await suspendCustomer(await developerUser(), g.id);
    const viaPublicPage = await thrownBy(() => db.$transaction((tx) => resolveGuest(tx, { fullName: "Anyone", phone: "0713 000 002", selfService: true })));
    expect(code(viaPublicPage)).toBe("FORBIDDEN");
    expect((viaPublicPage as AppError).message).toBe(SUSPENDED_CUSTOMER_MESSAGE);
    // the hotel's own staff, at the desk (not a public page), still find and use them
    expect(await db.$transaction((tx) => resolveGuest(tx, { fullName: g.fullName, phone: "0713 000 002" }))).toBe(g.id);
    // a customer who is not suspended books as before
    const fine = await customer(`Fine ${tag}`, "+255713000003");
    expect(await db.$transaction((tx) => resolveGuest(tx, { fullName: fine.fullName, phone: "0713 000 003", selfService: true }))).toBe(fine.id);
  });

  it("not while working as someone, and not by staff", async () => {
    const g = await customer(`Sus ${tag} Three`, "+255713000004");
    await makeSession(rec.id);
    const staff = (await getCurrentUser())!;
    expect(code(await thrownBy(() => suspendCustomer(staff, g.id)))).toBe("FORBIDDEN");
    browser.reset();
    await makeSession(dev.id);
    const session = await rawDb.session.findFirstOrThrow({ where: { userId: dev.id }, orderBy: { createdAt: "desc" } });
    await rawDb.session.update({ where: { id: session.id }, data: { workAsUserId: rec.id, workAsStartedAt: new Date() } });
    const working = (await getCurrentUser())!;
    expect(working.workAs).toBeTruthy();
    expect(code(await thrownBy(() => suspendCustomer(working, g.id)))).toBe("FORBIDDEN");
    expect(code(await thrownBy(() => deleteCustomer(working, g.id)))).toBe("FORBIDDEN");
    expect((await db.guest.findUniqueOrThrow({ where: { id: g.id } })).suspendedAt).toBeNull();
  });
});

describe("deleting a customer", () => {
  it("one with nothing on record is gone, audited under the Developer; an unknown one is not found", async () => {
    const g = await customer(`Del ${tag} One`, "+255714000001");
    const d = await developerUser();
    expect(await deleteCustomer(d, g.id)).toEqual({ deleted: true });
    expect(await db.guest.count({ where: { id: g.id } })).toBe(0);
    expect(await db.auditLog.findFirstOrThrow({ where: { action: "guest.deleted", entityId: g.id } })).toMatchObject({ actorType: "DEVELOPER", userId: dev.id });
    expect(code(await thrownBy(() => deleteCustomer(d, g.id)))).toBe("NOT_FOUND");
    expect(code(await thrownBy(() => deleteCustomer(d, "no-such")))).toBe("NOT_FOUND");
  });
});
