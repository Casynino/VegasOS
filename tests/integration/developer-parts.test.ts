import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});

import { db } from "@/server/db";
import { getCurrentUser, type CurrentUser } from "@/server/auth";
import { AppError } from "@/server/errors";
import { activityData, LATEST_ACTIONS, ONLINE_MINUTES } from "@/server/services/developer-activity";
import { crashData, speedData } from "@/server/services/developer-health";
import { envSettings, peopleTab, settingsTab } from "@/server/services/developer-console";
import { runChecks } from "@/server/services/developer-checks";
import { browser, makeSession, makeUser, removeMadeUsers, thrownBy, type MadeUser } from "../support/developer";

/**
 * The parts of the Developer Home that follow the owner's other consoles (2026-10-18), against a real database: who is using the system
 * (sign-ins, online now, accounts that do not use it — never what the work was about), the latest failed tries and the Developer's own, the
 * settings by NAME (set or not, never a value), the accounts by role, the named timed questions, and the audit-protection check.
 */

let dev: MadeUser, rec: MadeUser, boss: MadeUser;
const as = async (u: MadeUser) => { browser.reset(); await makeSession(u.id); return (await getCurrentUser()) as CurrentUser; };

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Parts Dev" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Asha Parts" });
  boss = await makeUser("OWNER", { fullName: "Boss Parts" });
});
afterAll(async () => { browser.reset(); await removeMadeUsers(); });

describe("Activity: who is using the system", () => {
  it("shows the sign-ins and the work per day, the latest sign-ins and who is online — and carries nothing about what the work was about", async () => {
    const user = await as(rec); // a real session for the receptionist: online right now
    const devUser = await as(dev);
    const a = await activityData(devUser);
    expect(a.busiestHour === null || (a.busiestHour >= 0 && a.busiestHour < 24)).toBe(true);
    expect(a.signInsPerDay).toHaveLength(14);
    expect(a.actionsPerDay).toHaveLength(14);
    expect(a.busiestHours).toHaveLength(24);
    expect(a.online!.map((u) => u.name)).toContain("Parts Dev");
    expect(ONLINE_MINUTES).toBe(10);
    // who is doing what: the kinds of work (counts of actions) and the team's latest actions — and never an amount
    expect(a.where).toEqual(expect.any(Array));
    expect(a.latest).toEqual(expect.any(Array));
    expect(a.recentSignIns!.length).toBeLessThanOrEqual(5);
    // each figure is kept once on the page: the 24-hour counts are the health card's, the ranking of people and the idle accounts are the team table's
    for (const gone of ["stats", "mostActive", "notUsing", "notUsingTotal"]) expect(a, gone).not.toHaveProperty(gone);
    expect(JSON.stringify(a)).not.toMatch(/TZS|amount|balance/i);
    expect(user.id).toBeTruthy();
  });

  it("'who did what, just now' lists the TEAM's latest actions newest first, by name and role — the Developer's own looking is not the team's work", async () => {
    const bd = new Date(`${new Date().toISOString().slice(0, 10)}T00:00:00Z`);
    const put = (action: string, ago: number, who: MadeUser, type = "STAFF") => db.auditLog.create({ data: { actorLabel: who.fullName, actorType: type, userId: who.id, actorRole: who.role, action, entityType: "Guest", businessDate: bd, createdAt: new Date(Date.now() - ago) } as never });
    // (a minute or two ahead, so they are among the newest whatever else other test files left behind. Earlier runs of this file leave rows of
    // the same kind behind and the audit trail cannot be cleaned, so THIS run's rows are found by their ids, never by "the first two".)
    const messageId = (await put("guest.message_sent", -120_000, rec)).id;
    const reservationId = (await put("reservation.created", -90_000, rec)).id;
    await put("developer.viewed", -150_000, dev, "DEVELOPER");
    const a = await activityData(await as(dev));
    const order = a.latest!.map((l) => l.id);
    expect(order).toContain(messageId);
    expect(order).toContain(reservationId);
    expect(order.indexOf(messageId)).toBeLessThan(order.indexOf(reservationId)); // the later one first
    const mine = a.latest!.filter((l) => l.id === messageId || l.id === reservationId);
    expect(mine.map((l) => l.action)).toEqual(["guest.message_sent", "reservation.created"]);
    expect(mine.every((l) => l.name === "Asha Parts" && !!l.roleName)).toBe(true); // by name and role
    expect(a.latest!.map((l) => l.action)).not.toContain("developer.viewed");
    const times = a.latest!.map((l) => l.at.getTime());
    expect([...times].sort((x, y) => y - x)).toEqual(times); // newest first
    expect(a.latest!.length).toBeLessThanOrEqual(LATEST_ACTIONS);
    expect(a.where!.length).toBeGreaterThan(0);
  });

  it("only the Developer may read it", async () => {
    for (const who of [rec, boss]) {
      const e = await thrownBy(async () => activityData(await as(who)));
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("FORBIDDEN");
    }
  });
});

describe("Speed & size: named questions, timed", () => {
  it("every probe has its own time; a deployment card says which kind of link, never the address", async () => {
    const s = await speedData(await as(dev));
    expect(s.probes).toHaveLength(6);
    expect(s.probes.every((p) => p.ms !== null && p.ms > 0)).toBe(true);
    expect(s.deployment.node).toBe(process.version);
    expect(["Pooled", "Direct"]).toContain(s.deployment.databaseLink);
    expect(JSON.stringify(s)).not.toContain("postgresql");
    expect(s.tables.map((t) => t.label)).toEqual(["Audit trail entries", "Sign-in sessions", "Messages sent", "System events"]);
  });
});

describe("Sign-ins & security: the latest tries, the Developer's own, the refused actions per day", () => {
  it("failed tries on real accounts are listed newest first, repeats within a minute are one line (×N), and the Developer's own are counted apart", async () => {
    const day = new Date();
    const bd = new Date(`${day.toISOString().slice(0, 10)}T00:00:00Z`);
    const make = (userId: string, ago: number, ip: string) => db.auditLog.create({ data: { actorLabel: "login", actorType: "SYSTEM", action: "auth.login_failed", entityType: "User", entityId: userId, ipAddress: ip, businessDate: bd, createdAt: new Date(Date.now() - ago) } as never });
    // (a little ahead of now, so they are among the newest whatever other test files left behind; the audit trail cannot be cleaned, so rows of
    // earlier runs of this file stay: one second apart, THIS run's three can never be split by a row of an earlier run, and they are found by their account)
    await make(rec.id, -10_000, "10.0.0.1"); await make(rec.id, -11_000, "10.0.0.1"); await make(rec.id, -12_000, "10.0.0.1"); // one place, one minute: one line ×3
    await make(dev.id, 5 * 60_000, "10.0.0.2"); // (in the past: it only has to be counted as the Developer's own)
    await db.auditLog.create({ data: { actorLabel: "t", actorType: "DEVELOPER", userId: dev.id, action: "developer.denied", entityType: "User", businessDate: bd } as never });
    const c = await crashData(await as(dev));
    expect(c.failed!.own24h).toBeGreaterThanOrEqual(1);
    const mine = c.failed!.latest.filter((l) => l.id.startsWith(`${rec.id}:`));
    expect(mine).toHaveLength(1);
    expect(mine[0].name).toBe("Asha Parts");
    expect(mine[0].times).toBe(3);
    expect(mine[0].ip).toBe("10.0.0.1");
    expect(c.failed!.latest[0].at.getTime()).toBeGreaterThanOrEqual(c.failed!.latest[c.failed!.latest.length - 1].at.getTime());
    expect(c.deniedByDay).toHaveLength(7);
    expect(c.deniedByDay![6].count).toBeGreaterThanOrEqual(1);
    expect(JSON.stringify(c.failed)).not.toMatch(/password/i);
  });
});

describe("Settings by name, and the accounts by role", () => {
  it("each setting is listed by its NAME with set / not set — the value is never read out", async () => {
    const before = process.env.CRON_SECRET;
    process.env.CRON_SECRET = "super-secret-value-123";
    try {
      const env = envSettings();
      expect(env.map((e) => e.key)).toEqual(expect.arrayContaining(["DATABASE_URL", "CRON_SECRET", "NEXT_PUBLIC_SITE_URL", "NTZS_API_KEY", "CALLMEBOT_API_KEY"]));
      expect(env.find((e) => e.key === "CRON_SECRET")).toMatchObject({ set: true, required: true });
      expect(JSON.stringify(await settingsTab(await as(dev), null))).not.toContain("super-secret-value-123");
      expect(JSON.stringify(env)).not.toContain("postgresql");
    } finally { if (before === undefined) delete process.env.CRON_SECRET; else process.env.CRON_SECRET = before; }
  });

  it("accounts by role: counts of accounts, never who or what they did; the system account is not a person", async () => {
    const p = await peopleTab(await as(dev));
    expect(p.roles.length).toBeGreaterThan(0);
    const recRole = p.roles.find((r) => r.code === "RECEPTIONIST")!;
    expect(recRole.active).toBeGreaterThanOrEqual(1);
    expect(recRole.total).toBeGreaterThanOrEqual(recRole.active);
    expect(p.roles.map((r) => r.code)).not.toContain("SYSTEM_ONLINE");
    expect(Object.keys(p.roles[0]).sort()).toEqual(["active", "code", "description", "name", "total"]);
  });
});

describe("The audit trail is protected: a check that finds the guard missing", () => {
  it("is fine while the database refuses changes to an audit line, and a fix when the guard is gone", async () => {
    const find = async () => (await runChecks(await as(dev))).find((c) => c.id === "audit-protected")!;
    expect(await find()).toMatchObject({ state: "ok", group: "Data" });
    // switch the guard off for a moment (a disabled guard protects nothing), and back on
    await db.$executeRawUnsafe(`ALTER TABLE "audit_logs" DISABLE TRIGGER "audit_logs_no_change"`);
    try {
      expect(await find()).toMatchObject({ state: "fix", count: 1 });
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE "audit_logs" ENABLE TRIGGER "audit_logs_no_change"`);
    }
    expect(await find()).toMatchObject({ state: "ok" });
  });
});
