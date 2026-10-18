import { randomUUID } from "node:crypto";
import { createElement, type FunctionComponent } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const revalidated = vi.hoisted(() => vi.fn());
vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});
vi.mock("next/cache", () => ({ revalidatePath: revalidated }));

import { db } from "@/server/db";
import { AppError } from "@/server/errors";
import { getCurrentUser } from "@/server/auth";
import { DEVELOPER_DENIED } from "@/lib/permissions";
import { staffHome } from "@/lib/staff-home";
import { I18nProvider } from "@/i18n/client";
import type { Locale } from "@/i18n/config";
import { makeT, type Catalog } from "@/i18n/translate";
import accessZhBase from "@/i18n/catalog/zh-CN/staff/developer-access";
import addUserZh from "@/i18n/catalog/zh-CN/staff/developer-adduser";
import * as actionsModule from "@/app/staff/(app)/developer/access/actions";
import { reactivateAction, signOutEverywhereAction, startWorkAsAction, stopWorkAsAction, suspendAction } from "@/app/staff/(app)/developer/access/actions";
import { loadAccessPage } from "@/app/staff/(app)/developer/access/data";
import { AccessView } from "@/app/staff/(app)/developer/access/access-view";
import { filterGroups } from "@/app/staff/(app)/developer/access/access-helpers";
import type { AccessGroupView, AccessPersonView } from "@/app/staff/(app)/developer/access/access-people";
import { browser, makeSession, makeUser, redirectOf, removeMadeUsers, thrownBy, type MadeUser } from "../support/developer";

/**
 * The Developer console's Access page (owner, 2026-10-17): who the Developer can "Work as", Suspend, Re-activate or Sign out everywhere.
 * The rules live in server/services/work-as.ts; what is proven here is the page and its five server actions against a real database:
 *   - the page lists exactly the accounts the Developer may deal with (active and suspended; never a Developer or the system account),
 *     grouped by role, and only a Developer who is not working as someone may open it;
 *   - every action asks the server who is signed in — a person who is not a Developer is refused, nothing changes, and the form
 *     cannot say who is acting;
 *   - Work as starts and stops (and is audited); Suspend needs a reason and the word CONFIRM and never touches the Boss, a Developer,
 *     the system account or the Developer itself; Re-activate only gives back what this Developer suspended; Sign out everywhere ends sessions;
 *   - none of the three works while working as someone;
 *   - the markup carries the buttons and the safety rules, in English and in 中文, and a name can never inject markup.
 */

const ACCESS = "/staff/developer/access";
let dev: MadeUser;
let dev2: MadeUser; // another Developer (never listed, never touched)
let boss: MadeUser;
let md: MadeUser;
let rec: MadeUser;
let system: MadeUser;

const form = (fields: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(fields)) f.set(k, v);
  return f;
};
/** An audit watcher: the entries one account wrote since it was started (oldest first). */
async function watch(userId: string) {
  const seen = (await db.auditLog.findMany({ where: { userId }, select: { id: true } })).map((r) => r.id);
  return () => db.auditLog.findMany({ where: { userId, id: { notIn: seen } }, orderBy: [{ createdAt: "asc" }, { id: "asc" }] });
}
const afterOf = (row: { after: unknown }) => (row.after ?? {}) as Record<string, unknown>;
const rightsOf = async (roleCode: string) =>
  (await db.rolePermission.findMany({ where: { role: { code: roleCode } }, select: { permission: { select: { code: true } } } })).map((r) => r.permission.code);
/** Where a person lands when the Developer works as them: their own home, with the money rights taken away. */
const homeOf = async (roleCode: string) => staffHome(new Set((await rightsOf(roleCode)).filter((c) => !(DEVELOPER_DENIED as readonly string[]).includes(c))));
const sessions = (userId: string) => db.session.count({ where: { userId } });
const state = (userId: string) => db.user.findUniqueOrThrow({ where: { id: userId }, select: { isActive: true, roleId: true, email: true, fullName: true, passwordHash: true } });
/** What a reader sees: the markup removed, the escaped characters (apostrophes, quotes…) turned back into themselves. */
const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Dev Access" });
  dev2 = await makeUser("DEVELOPER", { fullName: "Second Dev Access" });
  boss = await makeUser("OWNER", { fullName: "Boss Access" });
  md = await makeUser("ADMIN", { fullName: "MD Access" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Asha Access" });
  system = await makeUser("SYSTEM_ONLINE", { fullName: "System Access" });
});
afterAll(async () => {
  await removeMadeUsers();
});
beforeEach(() => {
  delete process.env.PERMANENT_OWNER_EMAILS;
  browser.reset();
  revalidated.mockClear();
});

// ═════════════════════════════════════ the five actions, and nothing else ═════════════════════════════════════
describe("the actions file", () => {
  it("exports exactly the seven actions", () => {
    expect(Object.keys(actionsModule).sort()).toEqual(["addAccountAction", "deleteAccountAction", "reactivateAction", "signOutEverywhereAction", "startWorkAsAction", "stopWorkAsAction", "suspendAction"]);
  });
});

// ═════════════════════════════════════ who may open the page, and what it lists ═════════════════════════════════════
describe("the page's data", () => {
  it("lists exactly the active and the suspended accounts that are not Developer or system accounts, grouped by role, the Boss first", async () => {
    const suspended = await makeUser("DRIVER", { fullName: "Suspended Access", isActive: false });
    await makeSession(dev.id);
    const page = await loadAccessPage();

    const expected = await db.user.findMany({ where: { removedAt: null, role: { code: { notIn: ["DEVELOPER", "SYSTEM_ONLINE"] } } }, select: { id: true, isActive: true, role: { select: { code: true } } } });
    const listed = page.groups.flatMap((g) => g.people.map((p) => ({ id: p.id, group: g.roleCode, isActive: p.isActive })));
    expect(listed.map((p) => p.id).sort()).toEqual(expected.map((u) => u.id).sort());
    expect(page.count).toBe(expected.length);
    // active and suspended both, never a Developer, never the system account
    expect(listed.find((p) => p.id === suspended.id)).toMatchObject({ group: "DRIVER", isActive: false });
    expect(listed.find((p) => p.id === rec.id)).toMatchObject({ group: "RECEPTIONIST", isActive: true });
    for (const hidden of [dev.id, dev2.id, system.id]) expect(listed.map((p) => p.id), hidden).not.toContain(hidden);
    // each person sits in the group of their own role; one group per role; the Boss's group first
    for (const u of expected) expect(listed.find((p) => p.id === u.id)?.group, u.id).toBe(u.role.code);
    expect(new Set(page.groups.map((g) => g.roleCode)).size).toBe(page.groups.length);
    expect(page.groups.every((g) => g.people.length > 0)).toBe(true);
    expect(page.groups[0].roleCode).toBe("OWNER");
    expect(page.groups.find((g) => g.roleCode === "OWNER")!.people.map((p) => p.id)).toContain(boss.id);
    // the page is built for the browser: plain text and flags — no hash, no token, and dates as text
    const json = JSON.stringify(page.groups);
    expect(json).not.toContain("passwordHash");
    expect(json).not.toContain("argon2");
    expect(json).not.toContain("tokenHash");
    for (const p of page.groups.flatMap((g) => g.people)) expect(p.lastSignedInAt === null || typeof p.lastSignedInAt === "string").toBe(true);
  });

  it("the flags say what each button may do: work as an active person; not suspend or delete a permanent owner (and say why); re-activate what this Developer suspended", async () => {
    process.env.PERMANENT_OWNER_EMAILS = boss.email;
    const victim = await makeUser("DRIVER", { fullName: "Flags Access" });
    await makeSession(dev.id);
    expect((await suspendAction(undefined, form({ userId: victim.id, reason: "flags check", confirm: "CONFIRM" }))).ok).toBe(true);
    const page = await loadAccessPage();
    const all = page.groups.flatMap((g) => g.people);
    const find = (id: string) => all.find((p) => p.id === id)!;
    expect(find(rec.id)).toMatchObject({ isActive: true, canWorkAs: true, canSuspend: true, canSignOut: true, canDelete: true, canReactivate: false });
    expect(find(boss.id)).toMatchObject({ canSuspend: false, canSignOut: false, canDelete: false, note: "Permanent owner: can't be suspended or deleted" });
    expect(find(victim.id)).toMatchObject({ isActive: false, canWorkAs: false, canSuspend: false, canReactivate: true });
  });

  it("only a Developer opens it: staff go to 'forbidden', nobody signed in goes to the login, a Developer gets the page", async () => {
    await makeSession(md.id);
    expect(await redirectOf(() => loadAccessPage())).toBe("/staff/forbidden");
    browser.reset();
    await makeSession(rec.id);
    expect(await redirectOf(() => loadAccessPage())).toBe("/staff/forbidden");
    browser.reset();
    expect(await redirectOf(() => loadAccessPage())).toBe("/staff/login");
    browser.reset();
    await makeSession(dev.id);
    expect(await redirectOf(() => loadAccessPage())).toBeNull();
  });

  it("a Developer who is working as someone is sent to that person's home, never shown the page — Stop brings the page back", async () => {
    await makeSession(dev.id);
    expect(await redirectOf(() => startWorkAsAction(undefined, form({ userId: rec.id })))).toBe(await homeOf("RECEPTIONIST"));
    expect(await redirectOf(() => loadAccessPage())).toBe(await homeOf("RECEPTIONIST"));
    expect(await redirectOf(() => stopWorkAsAction())).toBe("/staff/developer");
    expect(await redirectOf(() => loadAccessPage())).toBeNull();
  });
});

// ═════════════════════════════════════ nobody but a Developer ═════════════════════════════════════
describe("a person who is not a Developer is refused by every action — nothing changes, nothing is written for them", () => {
  it("the Boss, the MD and a receptionist (and nobody signed in) can start nothing, suspend nothing, re-activate nothing, sign nobody out, stop nothing", async () => {
    const victim = await makeUser("DRIVER", { fullName: "Victim Staff Access" });
    const suspended = await makeUser("DRIVER", { fullName: "Suspended Staff Access", isActive: false });
    await makeSession(victim.id, { setCookie: false });
    const before = { victim: await state(victim.id), suspended: await state(suspended.id), sessions: await sessions(victim.id), rec: await state(rec.id) };

    for (const who of [boss, md, rec, null] as const) {
      browser.reset();
      const ownSession = who ? await makeSession(who.id) : null;
      const fresh = who ? await watch(who.id) : null;
      const label = who?.role ?? "nobody";
      // fields that try to say who is acting are never read
      const claim = { actorType: "DEVELOPER", roleCode: "DEVELOPER", actorRole: "DEVELOPER", actor: dev.id, developerId: dev.id };
      const results = [
        await startWorkAsAction(undefined, form({ userId: victim.id, ...claim })),
        await suspendAction(undefined, form({ userId: victim.id, reason: "not allowed here", confirm: "CONFIRM", ...claim })),
        await reactivateAction(undefined, form({ userId: suspended.id, reason: "not allowed here", ...claim })),
        await signOutEverywhereAction(undefined, form({ userId: victim.id, ...claim })),
      ];
      for (const r of results) expect(r, label).toMatchObject({ ok: false });
      expect(results.map((r) => !r.ok && r.code), label).toEqual(Array(4).fill(who ? "FORBIDDEN" : expect.stringMatching(/FORBIDDEN|UNAUTHENTICATED/)));
      expect(await thrownBy(() => stopWorkAsAction()), `${label}: stop`).toBeInstanceOf(AppError);

      expect(await state(victim.id), label).toEqual(before.victim);
      expect(await state(suspended.id), label).toEqual(before.suspended);
      expect(await state(rec.id), label).toEqual(before.rec);
      expect(await sessions(victim.id), label).toBe(before.sessions);
      if (who && ownSession) {
        const own = await db.session.findFirstOrThrow({ where: { userId: who.id }, orderBy: { createdAt: "desc" } });
        expect([own.workAsUserId, own.workAsStartedAt], `${label}: no work-as on their own session`).toEqual([null, null]);
        expect((await getCurrentUser())?.id, label).toBe(who.id);
      }
      if (fresh) expect((await fresh()).filter((r) => /^(developer\.work_as|user\.(suspended|reactivated|signed_out_everywhere))/.test(r.action)), `${label}: nothing written as a success`).toEqual([]);
    }
    expect(revalidated).not.toHaveBeenCalled();
  });
});

// ═════════════════════════════════════ work as, and stop ═════════════════════════════════════
describe("Work as and Stop", () => {
  it("Work as starts on the Developer's own session, goes to the person's home, is audited under the Developer; Stop ends it", async () => {
    await makeSession(dev.id);
    const fresh = await watch(dev.id);
    const freshTarget = await watch(rec.id);
    const claim = { actorType: "STAFF", roleCode: "OWNER", actor: boss.id, actorId: boss.id };

    expect(await redirectOf(() => startWorkAsAction(undefined, form({ userId: rec.id, ...claim })))).toBe(await homeOf("RECEPTIONIST"));
    const row = await db.session.findFirstOrThrow({ where: { userId: dev.id }, orderBy: { createdAt: "desc" } });
    expect(row.workAsUserId).toBe(rec.id);
    expect(row.workAsStartedAt).toBeInstanceOf(Date);

    const me = await getCurrentUser();
    expect(me).toMatchObject({ id: rec.id, actorId: dev.id, actorType: "DEVELOPER", roleCode: "RECEPTIONIST" });
    expect(me?.workAs).toMatchObject({ developerId: dev.id, developerName: dev.fullName });
    expect(me?.permissions.has("developer.access")).toBe(false);
    for (const code of DEVELOPER_DENIED) expect(me?.permissions.has(code), `no money right while working as someone: ${code}`).toBe(false);

    // the diary: one entry, written as the Developer, about the person
    const started = (await fresh()).filter((r) => r.action === "developer.work_as_started");
    expect(started).toHaveLength(1);
    expect(started[0]).toMatchObject({ actorType: "DEVELOPER", entityType: "User", entityId: rec.id, userId: dev.id });
    expect(afterOf(started[0])).toMatchObject({ targetName: rec.fullName });
    expect(await freshTarget(), "nothing is written under the person's own name").toEqual([]);

    expect(await redirectOf(() => stopWorkAsAction())).toBe("/staff/developer");
    const ended = await db.session.findUniqueOrThrow({ where: { id: row.id } });
    expect([ended.workAsUserId, ended.workAsStartedAt]).toEqual([null, null]);
    expect((await getCurrentUser())?.id).toBe(dev.id);
    expect((await fresh()).filter((r) => r.action === "developer.work_as_ended")).toHaveLength(1);
    expect(await freshTarget()).toEqual([]);
  });

  it("is refused for a Developer, the system account, a suspended account, a missing person — and while already working as someone (Stop first)", async () => {
    const suspended = await makeUser("DRIVER", { fullName: "Suspended Work Access", isActive: false });
    await makeSession(dev.id);
    const fresh = await watch(dev.id);
    const sessionRow = () => db.session.findFirstOrThrow({ where: { userId: dev.id }, orderBy: { createdAt: "desc" } });

    for (const [name, userId] of [["a Developer", dev2.id], ["the Developer itself", dev.id], ["the system account", system.id], ["a suspended account", suspended.id], ["a missing person", "no-such-person"], ["nobody", ""]] as const) {
      const r = await startWorkAsAction(undefined, form({ userId }));
      expect(r, name).toMatchObject({ ok: false });
      expect((await sessionRow()).workAsUserId, name).toBeNull();
    }
    expect((await getCurrentUser())?.id).toBe(dev.id);
    expect((await fresh()).filter((r) => r.action === "developer.work_as_started")).toEqual([]);
    expect((await fresh()).filter((r) => r.action === "developer.work_as_refused").length, "each refusal about a real account is in the diary").toBeGreaterThanOrEqual(3);

    // already working as someone: a second Work as is refused, the first one stays
    await redirectOf(() => startWorkAsAction(undefined, form({ userId: rec.id })));
    const r = await startWorkAsAction(undefined, form({ userId: md.id }));
    expect(r).toMatchObject({ ok: false });
    expect((await sessionRow()).workAsUserId).toBe(rec.id);
    await redirectOf(() => stopWorkAsAction());
  });

  it("Work as is refused on a session that is not the Developer's even when the form names a person — the work-as fields stay empty", async () => {
    await makeSession(md.id);
    const r = await startWorkAsAction(undefined, form({ userId: rec.id }));
    expect(r).toMatchObject({ ok: false, code: "FORBIDDEN" });
    expect(await db.session.count({ where: { userId: md.id, workAsUserId: { not: null } } })).toBe(0);
    expect((await getCurrentUser())?.id).toBe(md.id);
  });
});

// ═════════════════════════════════════ suspend ═════════════════════════════════════
describe("Suspend", () => {
  it("needs a reason of 5+ characters and exactly CONFIRM — otherwise nothing changes; with both the account is blocked, its sessions end, one entry says why", async () => {
    const victim = await makeUser("DRIVER", { fullName: "Victim Suspend" });
    await makeSession(victim.id, { setCookie: false });
    await makeSession(victim.id, { setCookie: false });
    await makeSession(dev.id);
    const fresh = await watch(dev.id);
    const before = await state(victim.id);

    const bad: Record<string, string>[] = [
      {}, // nothing
      { reason: "abcd", confirm: "CONFIRM" }, // reason too short
      { reason: "     ", confirm: "CONFIRM" },
      { reason: "x".repeat(501), confirm: "CONFIRM" },
      { reason: "a good reason" }, // no word
      { reason: "a good reason", confirm: "confirm" },
      { reason: "a good reason", confirm: "CONFIRM " },
      { reason: "a good reason", confirm: "yes" },
    ];
    for (const fields of bad) {
      const r = await suspendAction(undefined, form({ userId: victim.id, ...fields }));
      expect(r, JSON.stringify(fields)).toMatchObject({ ok: false, code: "VALIDATION" });
      expect(Boolean(!r.ok && (r.fieldErrors?.reason || r.fieldErrors?.confirm)), JSON.stringify(fields)).toBe(true);
    }
    expect(await state(victim.id)).toEqual(before);
    expect(await sessions(victim.id)).toBe(2);
    expect((await fresh()).filter((r) => r.action === "user.suspended")).toEqual([]);
    expect(revalidated).not.toHaveBeenCalled();

    const done = await suspendAction(undefined, form({ userId: victim.id, reason: "  lost the phone  ", confirm: "CONFIRM" }));
    expect(done).toMatchObject({ ok: true });
    expect((await state(victim.id)).isActive).toBe(false);
    expect(await sessions(victim.id)).toBe(0);
    const rows = (await fresh()).filter((r) => r.action === "user.suspended");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorType: "DEVELOPER", entityType: "User", entityId: victim.id, userId: dev.id });
    expect(afterOf(rows[0]).reason).toBe("lost the phone");
    expect(revalidated).toHaveBeenCalledWith(ACCESS);
  });

  it("never a permanent owner, a Developer account, the system account or the Developer itself — each stays active with its sessions", async () => {
    process.env.PERMANENT_OWNER_EMAILS = boss.email;
    await makeSession(dev.id);
    await makeSession(boss.id, { setCookie: false });
    await makeSession(dev2.id, { setCookie: false });
    const fresh = await watch(dev.id);
    for (const [name, target] of [["a permanent owner", boss], ["a Developer", dev2], ["the system account", system], ["itself", dev]] as const) {
      const sessionsBefore = await sessions(target.id);
      const r = await suspendAction(undefined, form({ userId: target.id, reason: "a good reason", confirm: "CONFIRM" }));
      expect(r, name).toMatchObject({ ok: false });
      expect((await state(target.id)).isActive, name).toBe(true);
      expect(await sessions(target.id), name).toBe(sessionsBefore);
    }
    expect((await fresh()).filter((r) => r.action === "user.suspended")).toEqual([]);
    expect((await getCurrentUser())?.id, "the Developer is still signed in").toBe(dev.id);
    // a person who does not exist
    expect(await suspendAction(undefined, form({ userId: "no-such-person", reason: "a good reason", confirm: "CONFIRM" }))).toMatchObject({ ok: false });
  });
});

// ═════════════════════════════════════ re-activate ═════════════════════════════════════
describe("Re-activate", () => {
  it("gives back an account this Developer suspended, with a reason (5+ characters); the person can be worked as again", async () => {
    const victim = await makeUser("DRIVER", { fullName: "Victim Reactivate" });
    await makeSession(dev.id);
    expect((await suspendAction(undefined, form({ userId: victim.id, reason: "for the test", confirm: "CONFIRM" }))).ok).toBe(true);
    const fresh = await watch(dev.id);

    const shortReasons: Record<string, string>[] = [{}, { reason: "abcd" }, { reason: "    " }, { reason: "x".repeat(501) }];
    for (const fields of shortReasons) {
      const r = await reactivateAction(undefined, form({ userId: victim.id, ...fields }));
      expect(r, JSON.stringify(fields)).toMatchObject({ ok: false, code: "VALIDATION" });
      expect(!r.ok && r.fieldErrors?.reason).toBeTruthy();
    }
    expect((await state(victim.id)).isActive).toBe(false);

    revalidated.mockClear();
    expect(await reactivateAction(undefined, form({ userId: victim.id, reason: "  back on duty  " }))).toMatchObject({ ok: true });
    expect((await state(victim.id)).isActive).toBe(true);
    const rows = (await fresh()).filter((r) => r.action === "user.reactivated");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorType: "DEVELOPER", entityId: victim.id });
    expect(afterOf(rows[0]).reason).toBe("back on duty");
    expect(revalidated).toHaveBeenCalledWith(ACCESS);
    expect(await redirectOf(() => startWorkAsAction(undefined, form({ userId: victim.id })))).toBe(await homeOf("DRIVER"));
    await redirectOf(() => stopWorkAsAction());
  });

  it("is refused for an account somebody else suspended (another Developer, or straight in the database) and for an account whose role holds money rights", async () => {
    const byOther = await makeUser("DRIVER", { fullName: "Suspended By Other" });
    const byDatabase = await makeUser("DRIVER", { fullName: "Suspended In Database", isActive: false });
    const money = await makeUser("RECEPTIONIST", { fullName: "Money Reactivate" });

    // another Developer suspends one; this Developer suspends the receptionist
    await makeSession(dev2.id);
    expect((await suspendAction(undefined, form({ userId: byOther.id, reason: "by the other one", confirm: "CONFIRM" }))).ok).toBe(true);
    browser.reset();
    await makeSession(dev.id);
    expect((await suspendAction(undefined, form({ userId: money.id, reason: "for the test", confirm: "CONFIRM" }))).ok).toBe(true);

    for (const [name, target] of [["suspended by another Developer", byOther], ["suspended in the database", byDatabase], ["a money role", money]] as const) {
      const r = await reactivateAction(undefined, form({ userId: target.id, reason: "a good reason" }));
      expect(r, name).toMatchObject({ ok: false });
      expect((await state(target.id)).isActive, name).toBe(false);
    }
    // the Developer who suspended it can give it back
    browser.reset();
    await makeSession(dev2.id);
    expect((await reactivateAction(undefined, form({ userId: byOther.id, reason: "back again" }))).ok).toBe(true);
    expect((await state(byOther.id)).isActive).toBe(true);
    // a Developer account or the Boss is not "re-activated" either
    for (const target of [dev, boss]) expect(await reactivateAction(undefined, form({ userId: target.id, reason: "a good reason" })), target.fullName).toMatchObject({ ok: false });
  });
});

// ═════════════════════════════════════ sign out everywhere ═════════════════════════════════════
describe("Sign out everywhere", () => {
  it("ends every session of the person (their old cookie is no longer a user), one entry; the Developer's own session stays", async () => {
    const victim = await makeUser("DRIVER", { fullName: "Victim Signout" });
    const token = await makeSession(victim.id);
    await makeSession(victim.id, { setCookie: false });
    await makeSession(victim.id, { setCookie: false });
    expect((await getCurrentUser())?.id).toBe(victim.id);
    browser.reset();
    await makeSession(dev.id);
    const fresh = await watch(dev.id);

    expect(await signOutEverywhereAction(undefined, form({ userId: victim.id }))).toMatchObject({ ok: true });
    expect(await sessions(victim.id)).toBe(0);
    expect((await state(victim.id)).isActive, "signing out is not suspending").toBe(true);
    expect((await getCurrentUser())?.id, "the Developer stays signed in").toBe(dev.id);
    browser.cookies.set("vlh_session", token);
    expect(await getCurrentUser()).toBeNull();
    const rows = (await fresh()).filter((r) => r.action === "user.signed_out_everywhere");
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ actorType: "DEVELOPER", entityType: "User", entityId: victim.id });
    expect(revalidated).toHaveBeenCalledWith(ACCESS);
  });

  it("is refused for a Developer account, the system account and a missing person — their sessions stay", async () => {
    await makeSession(dev2.id, { setCookie: false });
    await makeSession(system.id, { setCookie: false });
    await makeSession(dev.id);
    for (const target of [dev2, system]) {
      const sessionsBefore = await sessions(target.id);
      expect(await signOutEverywhereAction(undefined, form({ userId: target.id })), target.fullName).toMatchObject({ ok: false });
      expect(await sessions(target.id), target.fullName).toBe(sessionsBefore);
    }
    expect(await signOutEverywhereAction(undefined, form({ userId: "no-such-person" }))).toMatchObject({ ok: false });
    expect(await signOutEverywhereAction(undefined, form({}))).toMatchObject({ ok: false });
    expect((await getCurrentUser())?.id).toBe(dev.id);
  });
});

// ═════════════════════════════════════ not while working as someone ═════════════════════════════════════
describe("while working as someone: no Suspend, no Re-activate, no Sign out — Work as can never take an account over", () => {
  it("each is refused and changes nothing; after Stop they work again", async () => {
    const victim = await makeUser("DRIVER", { fullName: "Victim While Working" });
    const parked = await makeUser("DRIVER", { fullName: "Parked While Working" });
    await makeSession(dev.id);
    expect((await suspendAction(undefined, form({ userId: parked.id, reason: "parked for the test", confirm: "CONFIRM" }))).ok).toBe(true);
    await makeSession(victim.id, { setCookie: false });
    const fresh = await watch(dev.id);

    expect(await redirectOf(() => startWorkAsAction(undefined, form({ userId: rec.id })))).toBe(await homeOf("RECEPTIONIST"));
    const refused = [
      await suspendAction(undefined, form({ userId: victim.id, reason: "a good reason", confirm: "CONFIRM" })),
      await reactivateAction(undefined, form({ userId: parked.id, reason: "a good reason" })),
      await signOutEverywhereAction(undefined, form({ userId: victim.id })),
    ];
    for (const r of refused) expect(r).toMatchObject({ ok: false });
    expect((await state(victim.id)).isActive).toBe(true);
    expect((await state(parked.id)).isActive).toBe(false);
    expect(await sessions(victim.id)).toBe(1);
    expect((await fresh()).filter((r) => ["user.suspended", "user.reactivated", "user.signed_out_everywhere"].includes(r.action))).toEqual([]);

    expect(await redirectOf(() => stopWorkAsAction())).toBe("/staff/developer");
    expect(await suspendAction(undefined, form({ userId: victim.id, reason: "a good reason", confirm: "CONFIRM" }))).toMatchObject({ ok: true });
    expect(await reactivateAction(undefined, form({ userId: parked.id, reason: "a good reason" }))).toMatchObject({ ok: true });
    expect((await state(victim.id)).isActive).toBe(false);
    expect((await state(parked.id)).isActive).toBe(true);
  });
});

// ═════════════════════════════════════ the search box ═════════════════════════════════════
const person = (over: Partial<AccessPersonView>): AccessPersonView => ({
  id: randomUUID(), fullName: "Person", email: "person@example.test", roleName: "Kitchen", isActive: true, lastSignedInAt: null,
  canWorkAs: true, canSuspend: true, canReactivate: false, canSignOut: true, canDelete: true, note: null, ...over,
});
const group = (roleCode: string, roleName: string, people: AccessPersonView[], roleDescription = ""): AccessGroupView => ({ roleCode, roleName, roleDescription, people });
/** The language provider, taking its children as createElement's third argument. */
const Provider = I18nProvider as FunctionComponent<{ locale: Locale; catalog: Catalog | null }>;
const NOW = new Date("2026-10-17T10:00:00.000Z");
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000).toISOString();

describe("the search box", () => {
  const groups = [
    group("OWNER", "Owner", [person({ fullName: "Rehema Boss", email: "boss@hotel.test", roleName: "Owner", canSuspend: false })]),
    group("RECEPTIONIST", "Receptionist", [person({ fullName: "Neema Front", email: "neema@hotel.test", roleName: "Receptionist" }), person({ fullName: "Asha Desk", email: "asha.desk@hotel.test", roleName: "Receptionist" })]),
    group("KITCHEN", "Kitchen", [person({ fullName: "Juma Cook", email: "juma@hotel.test", roleName: "Kitchen" })]),
  ];
  const t = makeT("en", null);
  const names = (g: AccessGroupView[]) => g.flatMap((x) => x.people.map((p) => p.fullName));

  it("finds by name, email or role, without caring about capitals; drops the groups with nobody left; nothing typed is everyone", () => {
    expect(names(filterGroups(groups, "", t))).toHaveLength(4);
    expect(names(filterGroups(groups, "   ", t))).toHaveLength(4);
    expect(names(filterGroups(groups, "NEEMA", t))).toEqual(["Neema Front"]);
    expect(names(filterGroups(groups, "asha.desk@", t))).toEqual(["Asha Desk"]);
    expect(names(filterGroups(groups, "receptionist", t))).toEqual(["Neema Front", "Asha Desk"]);
    expect(filterGroups(groups, "kitchen", t).map((g) => g.roleCode)).toEqual(["KITCHEN"]);
    expect(filterGroups(groups, "nobody-like-this", t)).toEqual([]);
  });

  it("also finds by the role as the reader's language says it", () => {
    const zh = makeT("zh-CN", { Kitchen: "厨房" });
    expect(names(filterGroups(groups, "厨房", zh))).toEqual(["Juma Cook"]);
    expect(names(filterGroups(groups, "kitchen", zh))).toEqual(["Juma Cook"]);
  });
});

// ═════════════════════════════════════ the markup ═════════════════════════════════════
describe("the page's markup", () => {
  const boss1 = person({ id: "p-boss", fullName: "Rehema Boss", email: "boss@hotel.test", roleName: "Owner", canSuspend: false, note: "Can't be suspended or signed out here", lastSignedInAt: minutesAgo(3 * 24 * 60) });
  const kitchen = person({ id: "p-kitchen", fullName: "Juma Cook", email: "juma@hotel.test", roleName: "Kitchen", lastSignedInAt: minutesAgo(19 * 60) });
  const mine = person({ id: "p-mine", fullName: "Zawadi Mine", email: "mine@hotel.test", roleName: "Kitchen", isActive: false, canWorkAs: false, canSuspend: false, canReactivate: true, lastSignedInAt: minutesAgo(5) });
  const theirs = person({ id: "p-theirs", fullName: "Baraka Theirs", email: "theirs@hotel.test", roleName: "Kitchen", isActive: false, canWorkAs: false, canSuspend: false, canReactivate: false, canSignOut: false, note: "Only the Boss or the MD can switch this account back on", lastSignedInAt: null });
  const groups = [
    group("OWNER", "Owner", [boss1], "The business owner's account."),
    group("KITCHEN", "Kitchen", [kitchen, mine, theirs], "Cooks the orders."),
  ];
  const draw = (g: AccessGroupView[] = groups, locale: "en" | "zh-CN" = "en") => {
    const accessZh: Catalog = { ...accessZhBase, ...addUserZh };
    const t = locale === "en" ? makeT("en", null) : makeT("zh-CN", accessZh);
    const view = createElement(AccessView, { t, groups: g, count: g.reduce((n, x) => n + x.people.length, 0), nowIso: NOW.toISOString(), timezone: "Africa/Dar_es_Salaam" });
    return renderToStaticMarkup(locale === "en" ? view : createElement(Provider, { locale, catalog: accessZh }, view));
  };

  it("says what the page is and the count — and nothing more on top: no 'What the buttons do' cards, no 'Safety rules' panel", () => {
    const html = draw();
    const words = text(html);
    expect(words).toContain("Access");
    expect(words).toContain("4 accounts. Pick a person and press Work as to open their dashboard exactly as they see it — without their password. Everything you do is recorded under your name.");
    for (const gone of ["What the buttons do", "Safety rules", "It ends by itself after 4 hours", "Here you can add an account", "short list", "allow-list", "accounts you may manage"]) expect(words, gone).not.toContain(gone);
    expect(html).not.toContain("</h3>"); // no cards
    expect(draw([group("OWNER", "Owner", [boss1])])).toContain("1 account. Pick a person");
  });

  it("draws the people grouped by role with their role description, a count, status, email and when they last signed in", () => {
    const html = draw();
    const words = text(html);
    expect(words).toContain("Owner · 1");
    expect(words).toContain("Kitchen · 3");
    expect(words).toContain("The business owner's account.");
    expect(words).toContain("Cooks the orders.");
    for (const p of [boss1, kitchen, mine, theirs]) {
      expect(words).toContain(p.fullName);
      expect(words).toContain(p.email);
    }
    expect(words).toContain("Last signed in 3 days ago");
    expect(words).toContain("Last signed in 19 h ago");
    expect(words).toContain("Last signed in 5 min ago");
    expect(words).toContain("Never signed in");
    expect(html.match(/>Suspended</g)).toHaveLength(2); // the two suspended accounts' tags (the card's own "Suspend" is not one)
    expect(words).toContain("Active");
    expect(html).toContain(`title="`); // the exact time is on hover
  });

  it("offers each person only the buttons they may have: Work as (a real form posting the person), Suspend, Re-activate, Sign out — and the Boss row says why there is no Suspend", () => {
    const html = draw();
    // Work as: one form per person who can be worked as, each posting that person's id (and nothing about who acts)
    expect(html.match(/<form\b/g)).toHaveLength(2);
    expect(html.match(/<button\b[^>]*\btype="submit"/g)).toHaveLength(2);
    for (const id of ["p-boss", "p-kitchen"]) expect(html).toContain(`name="userId" value="${id}"`);
    for (const id of ["p-mine", "p-theirs"]) expect(html).not.toContain(`value="${id}"`);
    for (const forbidden of ["actorType", "roleCode", "name=\"actor", "developerId"]) expect(html).not.toContain(forbidden);
    // suspend / re-activate / sign out
    expect(html).toContain('aria-label="Suspend Juma Cook"');
    expect(html).not.toContain('aria-label="Suspend Rehema Boss"');
    expect(html).toContain('aria-label="Re-activate Zawadi Mine"');
    expect(html).not.toContain('aria-label="Re-activate Baraka Theirs"');
    expect(html).toContain('aria-label="Sign Rehema Boss out everywhere"');
    expect(html).toContain('aria-label="Sign Juma Cook out everywhere"');
    expect(html).not.toContain('aria-label="Sign Baraka Theirs out everywhere"');
    expect(text(html)).toContain("Can't be suspended or signed out here");
    expect(text(html)).toContain("Only the Boss or the MD can switch this account back on");
    // a search box
    expect(html).toContain('type="search"');
    expect(html).toContain('aria-label="Search by name, email or role"');
  });

  it("shows an empty list in words, and draws a name as plain text — it can never inject markup", () => {
    expect(text(draw([]))).toContain("There are no accounts to show.");
    const evil = person({ id: "p-evil", fullName: `Eve <img src=x onerror=alert(1)> "Dev"`, email: `eve"><script>alert(1)</script>@hotel.test` });
    const html = draw([group("KITCHEN", "Kitchen", [evil])]);
    expect(html).not.toContain("<img");
    expect(html).not.toContain("<script");
    expect(html).toContain("&lt;img src=x onerror=alert(1)&gt;");
  });

  it("is in 中文 for a Chinese reader — the title, the buttons and the notes", () => {
    const html = draw(groups, "zh-CN");
    const words = text(html);
    expect(words).toContain("访问管理");
    expect(words).not.toContain("按钮的作用"); // the cards are gone
    expect(words).not.toContain("安全规则");
    expect(words).toContain("此处不能停用");
    expect(words).toContain("从未登录");
    expect(words).toContain("已启用");
    expect(words).toContain("已停用");
    expect(html).toContain('aria-label="停用 Juma Cook"');
    for (const english of ["Work as", "Suspend", "Sign out everywhere", "Never signed in", "Last signed in"]) expect(html, english).not.toContain(english);
  });
});
