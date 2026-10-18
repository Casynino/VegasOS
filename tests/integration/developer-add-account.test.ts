import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const sent = vi.hoisted(() => [] as { to: string; text: string }[]);
vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/server/services/messaging", async (orig) => ({
  ...(await orig<typeof import("@/server/services/messaging")>()),
  sendMessage: vi.fn(async (req: { to: string; text: string }) => { sent.push({ to: req.to, text: req.text }); return { ok: true, response: "ok" }; }),
}));

import { db } from "@/server/db";
import { verifyPassword } from "@/server/auth";
import { addAccountAction, startWorkAsAction } from "@/app/staff/(app)/developer/access/actions";
import { makeTemporaryPassword } from "@/app/staff/(app)/developer/access/add-account-dialog";
import { browser, makeSession, makeUser, redirectOf, removeMadeUsers, type MadeUser } from "../support/developer";

/**
 * "Add an account" on the Developer console's Access page (owner, 2026-10-18): the Developer is the owner of the code and creates the
 * hotel's accounts — any role but the Developer's and the system's (the MD's and the Boss's too). The password is temporary, stored only
 * as a hash, never in the audit trail or the WhatsApp notice; the account is "pending first login"; the creation is written under the
 * Developer and the Boss is told. Nobody but a Developer can use it, and not while working as someone.
 */
let dev: MadeUser;
let boss: MadeUser;
let md: MadeUser;
let rec: MadeUser;
let recipientsBefore: unknown;

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
const roleId = async (code: string) => (await db.role.findUniqueOrThrow({ where: { code } })).id;
const GOOD = "Kp7mQx4nWz9d";
const fields = async (code: string, extra: Record<string, string> = {}) => ({ fullName: "Neema Added", email: `addacct.${code.toLowerCase()}@example.test`, phone: "", roleId: await roleId(code), password: GOOD, ...extra });
const created = (email: string) => db.user.findFirst({ where: { email }, include: { role: true } });

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Dev Adder" });
  boss = await makeUser("OWNER", { fullName: "Boss Adder" });
  md = await makeUser("ADMIN", { fullName: "MD Adder" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Asha Adder" });
  const settings = await db.hotelSettings.findFirstOrThrow({ select: { reportRecipients: true } });
  recipientsBefore = settings.reportRecipients;
  await db.hotelSettings.updateMany({ data: { reportRecipients: [{ name: "Boss", phone: "255700000009", channel: "WHATSAPP_CALLMEBOT", apiKeyRef: null }] } });
});
afterAll(async () => {
  await db.user.deleteMany({ where: { email: { startsWith: "addacct." } } });
  await removeMadeUsers();
  await db.hotelSettings.updateMany({ data: { reportRecipients: recipientsBefore as never } });
});
beforeEach(() => { browser.reset(); sent.length = 0; });

describe("Add an account (the Developer)", () => {
  it("creates an account of any role — the MD's and the Boss's too — pending first login, with the password only as a hash", async () => {
    await makeSession(dev.id);
    for (const code of ["RECEPTIONIST", "MANAGER", "FINANCE", "ADMIN", "OWNER", "DRIVER", "KITCHEN", "ACCOUNTANT", "RESTAURANT"]) {
      const r = await addAccountAction(undefined, form(await fields(code)));
      expect(r.ok, `${code}: ${JSON.stringify(r)}`).toBe(true);
      const user = await created(`addacct.${code.toLowerCase()}@example.test`);
      expect(user?.role.code).toBe(code);
      expect(user?.mustChangePassword).toBe(true);
      expect(user?.isActive).toBe(true);
      expect(user?.passwordHash).not.toContain(GOOD);
      expect(await verifyPassword(user!.passwordHash, GOOD)).toBe(true);
    }
  });

  it("writes the creation under the Developer, without the password, and tells the Boss without it either", async () => {
    await makeSession(dev.id);
    const r = await addAccountAction(undefined, form(await fields("RECEPTIONIST", { email: "addacct.notice@example.test", fullName: "Zawadi Notice" })));
    expect(r.ok).toBe(true);
    const user = (await created("addacct.notice@example.test"))!;
    const rows = await db.auditLog.findMany({ where: { entityId: user.id, action: "user.created" } });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ userId: dev.id, actorType: "DEVELOPER" });
    expect(JSON.stringify(rows[0])).not.toContain(GOOD);
    expect(rows[0].after).toMatchObject({ role: "RECEPTIONIST", email: "addacct.notice@example.test", createdBy: "Developer console" });
    // the Boss is told on WhatsApp: who, whom, the role — never the password
    await vi.waitFor(() => expect(sent.length).toBeGreaterThanOrEqual(1));
    const text = sent.map((m) => m.text).join("\n");
    expect(text).toContain("Dev Adder");
    expect(text).toContain("Zawadi Notice");
    expect(text).not.toContain(GOOD);
  });

  it("refuses the Developer role and the system role, a weak password, an email already used, and a missing role — creating nothing", async () => {
    await makeSession(dev.id);
    const before = await db.user.count();
    for (const code of ["DEVELOPER", "SYSTEM_ONLINE"]) {
      const r = await addAccountAction(undefined, form(await fields(code, { email: `addacct.refused.${code}@example.test` })));
      expect(r.ok, code).toBe(false);
    }
    expect((await addAccountAction(undefined, form(await fields("DRIVER", { email: "addacct.weak@example.test", password: "short1" })))).ok).toBe(false);
    expect((await addAccountAction(undefined, form(await fields("DRIVER", { email: "addacct.norole@example.test", roleId: "no-such-role" })))).ok).toBe(false);
    const dup = await addAccountAction(undefined, form(await fields("DRIVER", { email: rec.email })));
    expect(dup.ok).toBe(false);
    expect(await db.user.count()).toBe(before);
  });

  it("is for the Developer alone: the Boss, the MD and staff are refused, nothing is created, and not while working as someone", async () => {
    const before = await db.user.count();
    for (const who of [boss, md, rec]) {
      browser.reset();
      await makeSession(who.id);
      const out = await addAccountAction(undefined, form(await fields("DRIVER", { email: `addacct.by.${who.id}@example.test` }))).catch((e) => e);
      expect(out instanceof Error || (out && out.ok === false), who.fullName).toBe(true);
    }
    // a visitor with no session
    browser.reset();
    const visitor = await addAccountAction(undefined, form(await fields("DRIVER", { email: "addacct.visitor@example.test" }))).catch((e) => e);
    expect(visitor instanceof Error || (visitor && visitor.ok === false)).toBe(true);
    // the Developer itself, working as someone
    browser.reset();
    await makeSession(dev.id);
    await redirectOf(() => startWorkAsAction(undefined, form({ userId: rec.id })));
    const whileWorking = await addAccountAction(undefined, form(await fields("DRIVER", { email: "addacct.working@example.test" })));
    expect(whileWorking.ok).toBe(false);
    expect(await db.user.count()).toBe(before);
  });

  it("makes a temporary password that passes the staff rule and differs every time", () => {
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const p = makeTemporaryPassword();
      expect(p).toMatch(/^[A-HJ-NP-Za-km-z2-9]{12}$/);
      expect(p).toMatch(/[A-Z]/);
      expect(p).toMatch(/[a-z]/);
      expect(p).toMatch(/[0-9]/);
      seen.add(p);
    }
    expect(seen.size).toBe(200);
  });
});
