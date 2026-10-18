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
import compactCatalog from "@/i18n/catalog/zh-CN/staff/developer-compact-ca";
import { NOT_WORK_ACTIONS, peopleTab } from "@/server/services/developer-console";
import { activityData, type ActivityData } from "@/server/services/developer-activity";
import { teamData, TEAM_DAYS, TEAM_LIMIT, type TeamMember } from "@/server/services/developer-team";
import { ActivityTab } from "@/app/staff/(app)/developer/tab-activity";
import { PeopleTab } from "@/app/staff/(app)/developer/tab-people";
import { browser, makeSession, makeUser, removeMadeUsers, thrownBy, type MadeUser } from "../support/developer";

/**
 * THE TEAM table (People & my actions) and how the Activity part is drawn, against a real database. The table lists every staff account except the
 * Developer's and the system's, with a COUNT of the work done in the last 7 hotel days and the last time the person was in; nothing else about
 * anyone. Only the Developer may read it; nothing is written. (The per-role "Who signs in" panel was removed on 2026-10-18: the sign-ins chart's
 * legend already says it.)
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

describe("Rendering: English and 中文, nothing undefined", () => {
  it("the team table: a row per person, last in as words, 'Never signed in', muted zeros — and the same words in 中文", async () => {
    const people = await peopleTab(devUser);
    const team = (await teamData(devUser))!;
    const now = new Date();
    const en = makeT("en", null);
    const zh = makeT("zh-CN", { ...(await loadCatalog("zh-CN", ["common", "public", "staff", "server"])), ...teamCatalog, ...compactCatalog });
    const render = (t: typeof en, over: Record<string, unknown> = {}) =>
      renderToStaticMarkup(createElement(PeopleTab, { t, data: people, person: "", right: "", inspection: null, when: (d: Date) => d.toISOString(), timezone: TZ, team, now, ...over }));

    const htmlEn = render(en);
    const txt = textOf(htmlEn);
    expect(htmlEn).not.toMatch(/undefined|NaN/);
    for (const w of ["The team", "What each person did this week, and when they last signed in.", "Person", "Role", "Actions (7 days)", "Last in", "Team Ann", "Team Abe", "Team Bob", "Team Cy", "Never signed in"]) expect(txt, w).toContain(w);
    // (the Developer's own account and the system account are not part of the team; the "Who can do what" list further down names everyone, so look at the team's panel only)
    const panel = txt.slice(txt.indexOf("The team"), txt.indexOf("Your recent actions"));
    expect(panel).not.toContain("Team Dev");
    expect(panel).not.toContain("Team System Account");
    // the table sits between the accounts by role and the Developer's own actions
    expect(txt.indexOf("The team")).toBeGreaterThan(txt.indexOf("accounts"));
    expect(txt.indexOf("The team")).toBeLessThan(txt.indexOf("Your recent actions"));
    expect(htmlEn).toMatch(/<table data-stack/);
    expect(htmlEn).toMatch(/text-muted-foreground">0</); // a zero is muted
    // the table scrolls inside its panel (a labelled region the keyboard reaches), its header stays, and it is the only table of the part
    expect(htmlEn).toMatch(/<div tabindex="0" role="region" aria-label="The team"[^>]*overflow-auto/);
    expect(htmlEn).toMatch(/<thead class="sticky top-0/);
    expect(htmlEn.match(/<table/g)).toHaveLength(1);

    const htmlZh = render(zh);
    const zhText = textOf(htmlZh);
    expect(htmlZh).not.toMatch(/undefined|NaN/);
    for (const w of ["操作数（7 天）", "最近登录", "从未登录", "每个人本周做了什么，以及最近一次登录的时间。"]) expect(zhText, w).toContain(w);
    expect(zhText).not.toContain("Actions (7 days)");
    expect(zhText).not.toContain("What each person did this week");

    // not asked for: nothing; could not be read: said in plain words, no table
    expect(textOf(render(en, { team: undefined }))).not.toContain("What each person did this week");
    const failed = render(en, { team: null });
    expect(textOf(failed)).toContain("This could not be read just now.");
    expect(failed).not.toMatch(/Actions \(7 days\)/);
    const empty = render(en, { team: { members: [], days: 7 } });
    expect(textOf(empty)).toContain("No staff accounts yet.");
    expect(empty).not.toMatch(/undefined|NaN/);
  });

  it("the strip of accounts: one line with the count and a chip per role (name and number, no descriptions), the Open Access link, and ONE slim note", async () => {
    const people = await peopleTab(devUser);
    const en = makeT("en", null);
    const html = renderToStaticMarkup(createElement(PeopleTab, { t: en, data: people, person: "", right: "", inspection: null, when: (d: Date) => d.toISOString(), timezone: TZ, team: undefined, now: new Date() }));
    const txt = textOf(html);
    const accounts = people.roles.reduce((n, r) => n + r.total, 0);
    expect(txt).toContain(`${accounts} accounts`);
    for (const r of people.roles) expect(html, r.code).toMatch(new RegExp(`<span>${en(r.name).replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}</span><span class="font-semibold tabular-nums">${r.total}</span>`));
    expect(txt.match(/Open Access/g)).toHaveLength(1);
    // the old tiles are gone: no "n active" tags in the page itself (they are only a hover text), no "accounts in all" line
    expect(txt).not.toMatch(/\d+ active/);
    expect(txt).not.toContain("accounts in all");
    expect(txt).not.toContain("Grouped by what they do");
    // one slim note with two short sentences instead of two cards
    expect(txt).toContain("Everything you do is on record, also as someone else, and cannot be edited or deleted. As someone else you cannot touch money, accounts, roles, passwords or shifts.");
    expect(txt).not.toContain("What you cannot do while working as someone");
    expect(txt.match(/Everything you do is on record/g)).toHaveLength(1);
    expect(txt).toContain("Pick a person and a right to see if that person has it.");
    // the team is not asked for: nothing is drawn for it, and the rest of the row is the actions
    expect(txt).not.toContain("The team");
    expect(txt).toContain("Your recent actions");
  });

  it("'Your recent actions' lists the Developer's last real actions, never the looking", async () => {
    const people = await peopleTab(devUser);
    const en = makeT("en", null);
    const mk = (id: string, action: string, ago: number) => ({ id, at: new Date(Date.now() - ago * MIN), action, words: action, target: null, entityType: "X", path: null, actingAs: null, failed: false });
    const data = { ...people, myActions: [mk("a", "reservation.checked_in", 1), mk("b", "developer.work_as_started", 2), mk("c", "auth.login", 3)] };
    const html = renderToStaticMarkup(createElement(PeopleTab, { t: en, data, person: "", right: "", inspection: null, when: (d: Date) => d.toISOString(), timezone: TZ, team: undefined, now: new Date() }));
    const txt = textOf(html);
    expect(txt).toContain("Your recent actions");
    expect(txt).toContain("Checked a guest in");
    expect(txt).not.toContain("looked at a page");
    expect(textOf(renderToStaticMarkup(createElement(PeopleTab, { t: en, data: { ...people, myActions: [] }, person: "", right: "", inspection: null, when: (d: Date) => d.toISOString(), timezone: TZ, team: undefined, now: new Date() })))).toContain("No actions yet (looking is not listed).");
  });

  /** An Activity part with something in every panel (made up here, so the layout is asserted without depending on what the database holds). */
  const days = Array.from({ length: 14 }, (_, i) => `2026-10-${String(5 + i).padStart(2, "0")}`);
  const at = (m: number) => new Date(Date.now() - m * MIN);
  const full = (): ActivityData => ({
    today: "2026-10-18", dayStart: "04:00", days, busiestHour: 11,
    roles: [{ code: "RECEPTIONIST", name: "Receptionist" }, { code: "MANAGER", name: "Manager" }],
    signInsPerDay: days.map((date, i) => ({ date, total: 1 + (i % 3), byRole: { RECEPTIONIST: 1, MANAGER: i % 3 } })),
    actionsPerDay: days.map((date) => ({ date, team: 5, developer: 1, total: 6 })),
    busiestHours: Array.from({ length: 24 }, (_, hour) => ({ hour, count: hour === 11 ? 9 : hour % 4 })),
    where: [{ label: "Payments", count: 12 }, { label: "Restaurant orders", count: 7 }],
    latest: Array.from({ length: 9 }, (_, i) => ({ id: `l${i}`, name: `Doer ${i}`, roleName: "Receptionist", action: "reservation.checked_in", at: at(i + 1) })),
    online: Array.from({ length: 7 }, (_, i) => ({ id: `o${i}`, name: `Online ${i}`, roleName: "Manager", lastSeenAt: at(i) })),
    recentSignIns: Array.from({ length: 5 }, (_, i) => ({ id: `r${i}`, name: `Signer ${i}`, roleCode: "MANAGER", roleName: "Manager", device: i === 4 ? null : { label: "Chrome · Mac", phone: false }, ip: `10.0.0.${i}`, at: at(i + 1) })),
  });
  const draw = (t: ReturnType<typeof makeT>, a: ActivityData) => renderToStaticMarkup(createElement(ActivityTab, { t, a, now: new Date(), timezone: TZ }));

  it("the Activity part: no stat cards, no repeated panels; who did what next to who is online and the recent sign-ins; the charts in pairs", async () => {
    const en = makeT("en", null);
    const html = draw(en, full());
    const txt = textOf(html);
    expect(html).not.toMatch(/undefined|NaN/);
    // every panel, in the owner's order
    const order = ["Who did what, just now", "Online right now", "Recent sign-ins", "Sign-ins per day", "Actions per day", "Busiest hours of the day", "Where the work happens"].map((w) => txt.indexOf(w));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((x, y) => x - y)).toEqual(order);
    // figures that are shown elsewhere on the page are not shown again
    for (const gone of ["People signed in", "Actions by the team", "Failed sign-ins", "Who signs in", "Most active people", "Not using the system", "different people in 24 hours", "Nothing to show yet", "Could not be read just now"]) expect(txt, gone).not.toContain(gone);
    expect(html.match(/<table/g)).toHaveLength(3); // only the three "Show the numbers" tables of the bar charts
    // row 1: two thirds and one third
    expect(html).toContain("lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]");
    expect(html).toMatch(/<div tabindex="0" role="region" aria-label="Who did what, just now"[^>]*overflow-auto/);
    expect(html.match(/Doer \d/g)).toHaveLength(9); // all nine rows are there (the list scrolls)
    // online: five names, then "and 2 more"
    for (let i = 0; i < 5; i++) expect(txt).toContain(`Online ${i}`);
    expect(txt).not.toContain("Online 5");
    expect(txt).toContain("and 2 more");
    // recent sign-ins: a compact line each (device and address together; no device words when the session is gone)
    expect(txt).toContain("Chrome · Mac · 10.0.0.0");
    expect(txt).toContain("10.0.0.4");
    expect(txt).not.toContain("Session ended");
    expect(html.match(/Signer \d/g)).toHaveLength(5);
    // one subtitle line per chart, and the chart stays short with its numbers collapsed
    expect(txt).toContain("Last 14 days, by role. Hover a bar for the numbers.");
    expect(txt).toContain("Hotel time, last 14 days. The peak is around 11:00.");
    expect(html).not.toMatch(/<details[^>]* open/);
    expect(html).toContain("Show the numbers");
  });

  it("a panel with nothing to show is not drawn: ONE quiet line names what has nothing yet, another what could not be read", async () => {
    const en = makeT("en", null);
    const zeros = (a: ActivityData): ActivityData => ({
      ...a,
      signInsPerDay: a.signInsPerDay!.map((d) => ({ ...d, total: 0, byRole: {} })), roles: [],
      actionsPerDay: a.actionsPerDay!.map((d) => ({ ...d, team: 0, developer: 0, total: 0 })),
      busiestHours: a.busiestHours!.map((h) => ({ ...h, count: 0 })), busiestHour: null, where: [], latest: [], online: [], recentSignIns: [],
    });
    // one chart has nothing, one cannot be read: the others fill the rows, the odd one is full width
    const some = draw(en, { ...full(), signInsPerDay: zeros(full()).signInsPerDay, roles: [], actionsPerDay: null });
    const someText = textOf(some);
    expect(someText).toContain("Could not be read just now: Actions per day.");
    expect(someText).toContain("Nothing to show yet for: Sign-ins per day.");
    expect(some.match(/<figure/g)).toHaveLength(2); // hours and where
    expect(some).not.toMatch(/Sign-ins per day<\/h2>/);
    // nothing at all: no box, no chart, one line
    const nothing = draw(en, zeros(full()));
    const nothingText = textOf(nothing);
    expect(nothing).not.toMatch(/<section|<figure|<table/);
    expect(nothingText.match(/Nothing to show yet for:/g)).toHaveLength(1);
    expect(nothingText).toContain("Nothing to show yet for: Who did what, just now, Online right now, Recent sign-ins, Sign-ins per day, Actions per day, Busiest hours of the day, Where the work happens.");
    // nothing could be read: one line too
    const unread = draw(en, { ...full(), signInsPerDay: null, actionsPerDay: null, busiestHours: null, where: null, latest: null, online: null, recentSignIns: null });
    expect(unread).not.toMatch(/<section|<figure|<table/);
    expect(textOf(unread).match(/Could not be read just now:/g)).toHaveLength(1);
    expect(unread).not.toMatch(/undefined|NaN/);
    // no "who did what" but the side panels: they sit side by side
    const side = draw(en, { ...full(), latest: [] });
    expect(side).toContain("lg:grid-cols-2");
    expect(side).not.toContain("lg:grid-cols-[minmax(0,2fr)_minmax(0,1fr)]");
  });

  it("the Activity part is the same in 中文, and the real data draws without a gap", async () => {
    const zh = makeT("zh-CN", { ...(await loadCatalog("zh-CN", ["common", "public", "staff", "server"])), ...teamCatalog, ...compactCatalog });
    const html = draw(zh, full());
    const text = textOf(html);
    expect(html).not.toMatch(/undefined|NaN/);
    for (const w of ["最近 14 天，按角色统计。将鼠标移到柱上查看数字。", "最近 14 天：团队和你保存的操作。", "按领域统计的操作，最近 7 天。", "酒店时间，最近 14 天。高峰在 11:00 前后。"]) expect(text, w).toContain(w);
    expect(text).not.toContain("Last 14 days");
    expect(text).not.toContain("Online right now");
    const real = draw(makeT("en", null), await activityData(await as(dev)));
    expect(real).not.toMatch(/undefined|NaN/);
  });
});
