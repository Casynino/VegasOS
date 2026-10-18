import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
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
import { businessDayConfig, getSettings } from "@/server/settings";
import { addDays, businessDateOf, businessRangeBounds, toDbDate } from "@/lib/time/business-date";
import { makeT } from "@/i18n/translate";
import { loadCatalog } from "@/i18n/catalog";
import teamCatalog from "@/i18n/catalog/zh-CN/staff/developer-team";
import { NOT_WORK_ACTIONS, peopleTab } from "@/server/services/developer-console";
import { activityData, signInsByRole } from "@/server/services/developer-activity";
import { teamData, TEAM_DAYS, TEAM_LIMIT, type TeamMember } from "@/server/services/developer-team";
import { ActivityTab } from "@/app/staff/(app)/developer/tab-activity";
import { PeopleTab } from "@/app/staff/(app)/developer/tab-people";
import { browser, makeSession, makeUser, removeMadeUsers, thrownBy, type MadeUser } from "../support/developer";

/**
 * THE TEAM table (People & my actions) and WHO SIGNS IN (Activity), against a real database. The table lists every staff account except the
 * Developer's and the system's, with a COUNT of the work done in the last 7 hotel days and the last time the person was in; nothing else about
 * anyone. "Who signs in" adds up the sign-ins of the last 14 days per kind of account. Only the Developer may read either; nothing is written.
 *
 * The audit trail cannot be cleaned, so rows of earlier runs stay behind: every figure here is asserted on rows THIS run made (its own users,
 * its own unique role codes), never on a global "newest N".
 */

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const TZ = "Africa/Dar_es_Salaam";
const textOf = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&amp;/g, "&").replace(/\s+/g, " ");

let dev: MadeUser, rec: MadeUser, boss: MadeUser, sys: MadeUser;
let ann: MadeUser, abe: MadeUser, bob: MadeUser, cy: MadeUser;
let devUser: CurrentUser;

const as = async (u: MadeUser) => { browser.reset(); await makeSession(u.id); return (await getCurrentUser()) as CurrentUser; };

/** One audit entry for a made user, at a time, in a hotel day. */
const put = (who: MadeUser, action: string, createdAt: Date, date: string, type = "STAFF") =>
  db.auditLog.create({ data: { actorLabel: who.fullName, actorType: type, userId: who.id, actorRole: who.role, action, entityType: "Guest", businessDate: toDbDate(date), createdAt } as never });

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Team Dev" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Team Refused Rec" });
  boss = await makeUser("OWNER", { fullName: "Team Refused Boss" });
  sys = await makeUser("SYSTEM_ONLINE", { fullName: "Team System Account" });
  ann = await makeUser("RECEPTIONIST", { fullName: "Team Ann" });
  abe = await makeUser("RECEPTIONIST", { fullName: "Team Abe" });
  bob = await makeUser("MANAGER", { fullName: "Team Bob", isActive: false });
  cy = await makeUser("FINANCE", { fullName: "Team Cy" });
  devUser = await as(dev);
});
afterAll(async () => { browser.reset(); await removeMadeUsers(); });

describe("The team: who is in it", () => {
  it("lists staff accounts (switched-off ones too) and leaves out the Developer and the system account", async () => {
    const team = (await teamData(devUser))!;
    expect(team).not.toBeNull();
    expect(team.days).toBe(TEAM_DAYS);
    expect(TEAM_DAYS).toBe(7);
    const ids = team.members.map((m) => m.id);
    for (const u of [ann, abe, bob, cy]) expect(ids, u.fullName).toContain(u.id);
    expect(ids).not.toContain(dev.id);
    expect(ids).not.toContain(sys.id);
    // never a Developer or a system account, whoever they are
    expect(team.members.map((m) => m.roleName)).not.toContain("Developer");
    const roles = await db.role.findMany({ where: { code: { in: ["DEVELOPER", "SYSTEM_ONLINE"] } }, select: { name: true } });
    for (const r of roles) expect(team.members.map((m) => m.roleName)).not.toContain(r.name);
    expect(team.members.length).toBeLessThanOrEqual(TEAM_LIMIT);
    // a switched-off account is listed (the table lists, it does not judge)
    expect(team.members.find((m) => m.id === bob.id)).toMatchObject({ name: "Team Bob", roleName: "Manager" });
  });

  it("is sorted by role name, then by name", async () => {
    const team = (await teamData(devUser))!;
    const mine = team.members.filter((m) => [ann, abe, bob, cy].some((u) => u.id === m.id));
    const expected = [...mine].sort((a, b) => a.roleName.localeCompare(b.roleName) || a.name.localeCompare(b.name));
    expect(mine.map((m) => m.id)).toEqual(expected.map((m) => m.id));
    expect(mine.map((m) => m.name)).toEqual(["Team Cy", "Team Bob", "Team Abe", "Team Ann"]); // Finance, Manager, Receptionist (Abe before Ann)
    // the whole list follows the same order
    const all = [...team.members].sort((a, b) => a.roleName.localeCompare(b.roleName) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id));
    expect(team.members.map((m) => m.id)).toEqual(all.map((m) => m.id));
  });

  it("carries only a name, a role, a count and a time — nothing about the work itself", async () => {
    const team = (await teamData(devUser))!;
    for (const m of team.members) expect(Object.keys(m).sort()).toEqual(["actions7d", "id", "lastSignInAt", "name", "roleName"]);
    expect(JSON.stringify(team)).not.toMatch(/TZS|amount|balance|password|email|phone/i);
  });
});

describe("The team: actions in 7 hotel days", () => {
  it("counts the work a person did in the last 7 hotel days, and ignores sign-ins, looking, refused tries, the Developer's own entries and older days", async () => {
    const now = new Date();
    const cfg = businessDayConfig(await getSettings());
    const today = businessDateOf(now, cfg);
    const first = addDays(today, -(TEAM_DAYS - 1));
    const { start } = businessRangeBounds(first, today, cfg);
    const before = (await teamData(devUser, now))!.members;
    const countOf = (members: TeamMember[], u: MadeUser) => members.find((m) => m.id === u.id)!.actions7d;
    const base = { ann: countOf(before, ann), abe: countOf(before, abe), bob: countOf(before, bob), cy: countOf(before, cy) };
    expect(base).toEqual({ ann: 0, abe: 0, bob: 0, cy: 0 });

    // Ann: three that count (now, the very start of the oldest counted day, earlier today)
    await put(ann, "reservation.created", new Date(now.getTime() - MIN), today);
    await put(ann, "payment.recorded", new Date(start.getTime() + MIN), first);
    await put(ann, "guest.message_sent", new Date(now.getTime() - 2 * HOUR), today);
    // … and many that do not: every kind of entry that is not work, the Developer's own entries under her id, and the day before the window
    for (const action of NOT_WORK_ACTIONS) await put(ann, action, new Date(now.getTime() - 5 * MIN), today);
    await put(ann, "reservation.created", new Date(now.getTime() - 5 * MIN), today, "DEVELOPER");
    await put(ann, "reservation.created", new Date(now.getTime() - 5 * MIN), today, "SYSTEM");
    await put(ann, "reservation.created", new Date(start.getTime() - MIN), addDays(first, -1));
    // Abe: two; Bob (switched off): one
    await put(abe, "reservation.created", new Date(now.getTime() - 3 * MIN), today);
    await put(abe, "payment.recorded", new Date(now.getTime() - 4 * MIN), today);
    await put(bob, "expense.approved", new Date(now.getTime() - 3 * HOUR), today);

    const after = (await teamData(devUser, now))!.members;
    expect(countOf(after, ann)).toBe(3);
    expect(countOf(after, abe)).toBe(2);
    expect(countOf(after, bob)).toBe(1);
    expect(countOf(after, cy)).toBe(0);
  });

  it("counts with the hotel day (04:00), not the calendar: the same rows are out of the window a week later", async () => {
    const now = new Date();
    const later = new Date(now.getTime() + 8 * DAY);
    const members = (await teamData(devUser, later))!.members;
    expect(members.find((m) => m.id === ann.id)!.actions7d).toBe(0);
    expect(members.find((m) => m.id === abe.id)!.actions7d).toBe(0);
  });
});

describe("The team: the last time in", () => {
  it("is the later of the last sign-in and the newest session; null when neither exists", async () => {
    const now = Date.now();
    // Ann: signed in 3 days ago, but a session was seen 60 minutes ago (and an older one): the session is later
    await db.user.update({ where: { id: ann.id }, data: { lastLoginAt: new Date(now - 3 * DAY) } });
    await makeSession(ann.id, { seenMinAgo: 60, setCookie: false });
    await makeSession(ann.id, { seenMinAgo: 200, setCookie: false });
    // Abe: signed in 30 minutes ago, his only session was seen 5 days ago: the sign-in is later
    await db.user.update({ where: { id: abe.id }, data: { lastLoginAt: new Date(now - 30 * MIN) } });
    await makeSession(abe.id, { seenMinAgo: 5 * 24 * 60, setCookie: false });
    // Bob (switched off): a sign-in only
    await db.user.update({ where: { id: bob.id }, data: { lastLoginAt: new Date(now - 10 * DAY) } });
    // Cy: nothing at all

    const sessionSeen = async (u: MadeUser) => (await db.session.findFirstOrThrow({ where: { userId: u.id }, orderBy: { lastSeenAt: "desc" } })).lastSeenAt;
    const members = (await teamData(devUser))!.members;
    const at = (u: MadeUser) => members.find((m) => m.id === u.id)!.lastSignInAt;
    expect(at(ann)).toEqual(await sessionSeen(ann));
    expect(at(abe)!.getTime()).toBe((await db.user.findUniqueOrThrow({ where: { id: abe.id } })).lastLoginAt!.getTime());
    expect(at(bob)!.getTime()).toBe((await db.user.findUniqueOrThrow({ where: { id: bob.id } })).lastLoginAt!.getTime());
    expect(at(cy)).toBeNull();
  });
});

describe("The team: who may read it", () => {
  it("only the Developer — Reception and the Boss are refused, and so is the Developer working as someone", async () => {
    for (const who of [rec, boss]) {
      const e = await thrownBy(async () => teamData(await as(who)));
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("FORBIDDEN");
    }
    browser.reset();
    await makeSession(dev.id);
    await db.session.updateMany({ where: { userId: dev.id }, data: { workAsUserId: rec.id, workAsStartedAt: new Date() } });
    const asSomeone = (await getCurrentUser()) as CurrentUser;
    browser.reset(); // (the write fence refuses session changes while the browser is working as someone)
    try {
      expect(asSomeone.workAs).toBeTruthy();
      const e = await thrownBy(async () => teamData(asSomeone));
      expect(e).toBeInstanceOf(AppError);
      expect((e as AppError).code).toBe("FORBIDDEN");
    } finally {
      await db.session.updateMany({ where: { userId: dev.id }, data: { workAsUserId: null, workAsStartedAt: null } });
      devUser = await as(dev);
    }
  });

  it("a figure that cannot be read leaves null, not zeros that would be wrong; and the service only reads (two queries, no writes)", async () => {
    const spy = vi.spyOn(db.user, "findMany").mockRejectedValueOnce(new Error("boom"));
    try { expect(await teamData(devUser)).toBeNull(); } finally { spy.mockRestore(); }
    const src = readFileSync(path.join(process.cwd(), "src/server/services/developer-team.ts"), "utf8");
    expect(src).toMatch(/assertConsoleAccess\(user\);/);
    expect((src.match(/\bdb\.\w+\.\w+\(/g) ?? []).sort()).toEqual(["db.auditLog.groupBy(", "db.user.findMany("]); // one grouped count + one list: no query per person
    expect(src).not.toMatch(/\.(create|update|upsert|delete|deleteMany|updateMany|createMany)\(|\$execute/);
  });
});

describe("Who signs in: sign-ins in 14 days per kind of account", () => {
  const code = `TEAMTEST_${randomUUID().slice(0, 8).toUpperCase()}`;
  const few = `TEAMFEW_${randomUUID().slice(0, 8).toUpperCase()}`;
  const login = (role: string, who: MadeUser, createdAt: Date, date: string, action = "auth.login") =>
    db.auditLog.create({ data: { actorLabel: who.fullName, actorType: role === "DEVELOPER" ? "DEVELOPER" : "STAFF", userId: who.id, actorRole: role, action, entityType: "User", entityId: who.id, businessDate: toDbDate(date), createdAt } as never });

  it("adds up the successful sign-ins of each kind of account, most first, with the Developer's own as a row of its own", async () => {
    const now = new Date();
    const cfg = businessDayConfig(await getSettings());
    const today = businessDateOf(now, cfg);
    const beforeDev = signInsByRole(await activityData(devUser))!.find((r) => r.code === "DEVELOPER")?.count ?? 0;
    // three sign-ins of one kind of account (today and yesterday), one of another
    await login(code, ann, new Date(now.getTime() - MIN), today);
    await login(code, abe, new Date(now.getTime() - 2 * MIN), today);
    await login(code, ann, new Date(now.getTime() - 20 * HOUR), addDays(today, -1));
    await login(few, bob, new Date(now.getTime() - 3 * MIN), today);
    // not counted: a sign-out, a wrong try, and a sign-in older than 14 days
    await login(code, ann, new Date(now.getTime() - 4 * MIN), today, "auth.logout");
    await login(code, ann, new Date(now.getTime() - 5 * MIN), today, "auth.login_failed");
    await login(code, ann, new Date(now.getTime() - 20 * DAY), addDays(today, -20));
    // the Developer signs in twice
    await login("DEVELOPER", dev, new Date(now.getTime() - 6 * MIN), today);
    await login("DEVELOPER", dev, new Date(now.getTime() - 7 * MIN), today);

    const a = await activityData(await as(dev));
    const rows = signInsByRole(a)!;
    expect(rows.find((r) => r.code === code)).toMatchObject({ code, name: code, count: 3 });
    expect(rows.find((r) => r.code === few)).toMatchObject({ count: 1 });
    expect(rows.findIndex((r) => r.code === code)).toBeLessThan(rows.findIndex((r) => r.code === few)); // most sign-ins first
    const developer = rows.find((r) => r.code === "DEVELOPER")!;
    expect(developer.name).toBe((await db.role.findUniqueOrThrow({ where: { code: "DEVELOPER" } })).name);
    expect(developer.count).toBeGreaterThanOrEqual(beforeDev + 2);
    // most first, every row has something, and the figures are the ones the sign-ins chart is drawn from
    expect(rows.map((r) => r.count)).toEqual([...rows.map((r) => r.count)].sort((x, y) => y - x));
    expect(rows.every((r) => r.count > 0)).toBe(true);
    for (const r of rows) expect(a.signInsPerDay!.reduce((n, d) => n + (d.byRole[r.code] ?? 0), 0), r.code).toBe(r.count);
    expect(rows.reduce((n, r) => n + r.count, 0)).toBe(a.signInsPerDay!.reduce((n, d) => n + d.total, 0));
  });

  it("is null when the sign-ins could not be read, and empty when nobody signed in", () => {
    expect(signInsByRole({ roles: [], signInsPerDay: null })).toBeNull();
    expect(signInsByRole({ roles: [{ code: "X", name: "X" }], signInsPerDay: [{ date: "2026-10-18", total: 0, byRole: {} }] })).toEqual([]);
  });
});

describe("Rendering: English and 中文, nothing undefined", () => {
  it("the team table: a row per person, last in as words, 'Never signed in', muted zeros — and the same words in 中文", async () => {
    const people = await peopleTab(devUser);
    const team = (await teamData(devUser))!;
    const now = new Date();
    const en = makeT("en", null);
    const zh = makeT("zh-CN", { ...(await loadCatalog("zh-CN", ["common", "public", "staff", "server"])), ...teamCatalog });
    const render = (t: typeof en, over: Record<string, unknown> = {}) =>
      renderToStaticMarkup(createElement(PeopleTab, { t, data: people, person: "", right: "", inspection: null, when: (d: Date) => d.toISOString(), timezone: TZ, team, now, ...over }));

    const htmlEn = render(en);
    const txt = textOf(htmlEn);
    expect(htmlEn).not.toMatch(/undefined|NaN/);
    for (const w of ["The team", "Everyone with a staff account, what they did this week, and when they last signed in.", "Person", "Role", "Actions (7 days)", "Last in", "Team Ann", "Team Abe", "Team Bob", "Team Cy", "Never signed in"]) expect(txt, w).toContain(w);
    // (the Developer's own account and the system account are not part of the team; the "Who can do what" list further down names everyone, so look at the team's panel only)
    const panel = txt.slice(txt.indexOf("The team"), txt.indexOf("Your recent actions"));
    expect(panel).not.toContain("Team Dev");
    expect(panel).not.toContain("Team System Account");
    // the table sits between the accounts by role and the Developer's own actions
    expect(txt.indexOf("The team")).toBeGreaterThan(txt.indexOf("accounts"));
    expect(txt.indexOf("The team")).toBeLessThan(txt.indexOf("Your recent actions"));
    expect(htmlEn).toMatch(/<table data-stack/);
    expect(htmlEn).toMatch(/text-muted-foreground">0</); // a zero is muted

    const htmlZh = render(zh);
    const zhText = textOf(htmlZh);
    expect(htmlZh).not.toMatch(/undefined|NaN/);
    for (const w of ["操作数（7 天）", "最近登录", "从未登录", "所有拥有员工账号的人"]) expect(zhText, w).toContain(w);
    expect(zhText).not.toContain("Actions (7 days)");
    expect(zhText).not.toContain("Everyone with a staff account");

    // not asked for: nothing; could not be read: said in plain words, no table
    expect(textOf(render(en, { team: undefined }))).not.toContain("Everyone with a staff account");
    const failed = render(en, { team: null });
    expect(textOf(failed)).toContain("This could not be read just now.");
    expect(failed).not.toMatch(/Actions \(7 days\)/);
    const empty = render(en, { team: { members: [], days: 7 } });
    expect(textOf(empty)).toContain("No staff accounts yet.");
    expect(empty).not.toMatch(/undefined|NaN/);
  });

  it("the Activity part shows 'Who signs in' with a bar per kind of account, and still shows everything it showed before", async () => {
    const a = await activityData(await as(dev));
    const now = new Date();
    const en = makeT("en", null);
    const zh = makeT("zh-CN", { ...(await loadCatalog("zh-CN", ["common", "public", "staff", "server"])), ...teamCatalog });
    const htmlEn = renderToStaticMarkup(createElement(ActivityTab, { t: en, a, now, timezone: TZ }));
    const txt = textOf(htmlEn);
    expect(htmlEn).not.toMatch(/undefined|NaN/);
    for (const w of ["Who signs in", "Sign-ins in the last 14 days, by kind of account.", "Developer",
      // nothing that was there is gone
      "Who did what, just now", "Sign-ins per day", "Actions per day", "Busiest hours of the day", "Where the work happens", "Recent sign-ins", "Online right now", "Most active people", "Not using the system"]) expect(txt, w).toContain(w);
    const rows = signInsByRole(a)!;
    expect(rows.length).toBeGreaterThan(0);
    expect(txt).toContain(rows[0].code === "UNKNOWN" ? "Other" : en(rows[0].name));
    // beside the recent sign-ins, not after the whole page
    expect(txt.indexOf("Who signs in")).toBeGreaterThan(txt.indexOf("Recent sign-ins"));
    expect(txt.indexOf("Who signs in")).toBeLessThan(txt.indexOf("Online right now"));

    const htmlZh = renderToStaticMarkup(createElement(ActivityTab, { t: zh, a, now, timezone: TZ }));
    expect(htmlZh).not.toMatch(/undefined|NaN/);
    expect(textOf(htmlZh)).toContain("谁在登录");
    expect(textOf(htmlZh)).toContain("最近 14 天的登录次数，按账号类型统计。");
    expect(textOf(htmlZh)).not.toContain("Who signs in");

    // could not be read / nobody signed in
    const unread = renderToStaticMarkup(createElement(ActivityTab, { t: en, a: { ...a, signInsPerDay: null }, now, timezone: TZ }));
    expect(unread).not.toMatch(/undefined|NaN/);
    expect(textOf(unread)).toContain("Who signs in");
    const nobody = renderToStaticMarkup(createElement(ActivityTab, { t: en, a: { ...a, roles: [], signInsPerDay: a.signInsPerDay!.map((d) => ({ ...d, total: 0, byRole: {} })) }, now, timezone: TZ }));
    expect(nobody).not.toMatch(/undefined|NaN/);
    expect(textOf(nobody)).toContain("Nobody signed in during these 14 days.");
  });
});
