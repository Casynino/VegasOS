import { randomUUID } from "node:crypto";
import { readdirSync, readFileSync, statSync } from "node:fs";
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
import { audit } from "@/server/audit";
import { makeT } from "@/i18n/translate";
import { ACCOUNT_AND_DEVELOPER_WORDS, friendlyAction } from "@/lib/activity-words";
import {
  auditActionWords, auditFilterChoices, auditToday, auditWordsFor, isFailureAction, isFailureEntry, NOTE_ACTIONS, parseAuditFilter, queryAuditTrail, workAsTargetOf,
  type AuditRow, type AuditViewer,
} from "@/server/services/audit-trail";
import { NOT_WORK_ACTIONS } from "@/server/services/developer-console";
import { DEVELOPER_IDLE_MINUTES, DEVELOPER_SESSION_HOURS } from "@/server/auth";
import { DEVELOPER_TRIES, FAILED_SIGN_IN_ROWS_PER_HOUR } from "@/server/services/auth-login";
import { VIEW_BURST_LIMIT } from "@/server/services/developer-view-log";
import { ENDPOINT_REFUSED_MINUTES } from "@/server/services/work-as";
import { WORK_AS_HOURS } from "@/server/work-as-session";
import { DeveloperAuditList, auditSentence, auditWho } from "@/app/staff/(app)/developer/audit/developer-audit-rows";
import { BarChart } from "@/app/staff/(app)/developer/console-charts";
import { HealthCard } from "@/app/staff/(app)/developer/health-card";
import { AccessView } from "@/app/staff/(app)/developer/access/access-view";
import type { HealthReport } from "@/server/services/developer-health";
import { makeUser, removeMadeUsers, type MadeUser } from "../support/developer";

/**
 * The Developer console, second round of review fixes (UI side):
 *   1. plain words: a Work as line names the person; every new action has words; failures are told from information;
 *   2. every look / refusal / note is left out of "work" counts (the other half of that is in developer-health.test.ts);
 *   3. the charts: the exact numbers are in a table anyone can open, and the caption says so;
 *   4. the health card's figures are a real definition list;
 *   5. the migration's backfill labels the online-payment account's old lines as SYSTEM, like the app's audit writer, and can run twice;
 *   6. every list of people that staff see leaves out the Developer and the system account (source guard, with every exception reviewed);
 *   7. the document says what the code does (the numbers in it are the code's own).
 */

const root = path.resolve(import.meta.dirname, "../..");
const read = (file: string) => readFileSync(path.join(root, file), "utf8");
const t = makeT("en", null);

let dev: MadeUser;
let rec: MadeUser;
let sys: MadeUser;
const TAG = `UI2${Date.now()}`;

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Dev Ui2" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Asha Ui2" });
  sys = await makeUser("SYSTEM_ONLINE", { fullName: "System Ui2" });
});
afterAll(async () => {
  // the audit trail refuses deletes: the maintenance door is opened for this one transaction only
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('vegas.audit_maintenance', 'on', true)`;
    await tx.auditLog.deleteMany({ where: { entityType: { startsWith: TAG } } });
    await tx.$executeRaw`SELECT set_config('vegas.audit_maintenance', 'off', true)`;
  });
  await removeMadeUsers();
});

const row = (over: Partial<AuditRow>): AuditRow => ({
  id: randomUUID(), at: new Date("2026-10-17T09:00:00Z"), businessDate: "2026-10-17", actorType: "DEVELOPER", actorRole: "DEVELOPER", roleName: "Developer (super user)",
  actorName: "Nino (Developer)", actingAs: null, userId: "u", action: "developer.viewed", entityType: "User", entityId: "x", ok: true, reason: null, problem: null,
  before: null, after: null, ipAddress: null, ...over,
});

// ───────────────────────────────────────────── 1. plain words ─────────────────────────────────────────────
describe("a Work as line names the person", () => {
  const person = { targetName: "Asha Namba", targetRole: "Receptionist" };

  it("started / stopped: 'Developer started working as Asha Namba (Receptionist).'", () => {
    expect(auditSentence(row({ action: "developer.work_as_started", after: person }), t)).toBe("Developer started working as Asha Namba (Receptionist).");
    expect(auditSentence(row({ action: "developer.work_as_ended", after: { ...person, minutes: 12 } }), t)).toBe("Developer stopped working as Asha Namba (Receptionist).");
  });

  it("without a role it names the person alone; without a name it says 'another person' (an old line, a refusal)", () => {
    expect(auditSentence(row({ action: "developer.work_as_started", after: { targetName: "Asha Namba" } }), t)).toBe("Developer started working as Asha Namba.");
    expect(auditSentence(row({ action: "developer.work_as_started", after: null }), t)).toBe("Developer started working as another person.");
    expect(auditSentence(row({ action: "developer.work_as_ended", after: { targetName: "  " } }), t)).toBe("Developer stopped working as another person.");
    expect(auditSentence(row({ action: "developer.work_as_refused", after: { why: "account is switched off" } }), t)).toBe("Developer was refused when trying to work as another person.");
  });

  it("ended by itself and the Boss notice are notes (no 'who' in front), with the person named", () => {
    const expired = row({ action: "developer.work_as_expired", after: { ...person, minutes: 240, endedBy: "limit", reason: "The 4-hour limit was reached." } });
    expect(auditSentence(expired, t)).toBe("Working as Asha Namba (Receptionist) ended by itself (the time was over or the session ended).");
    expect(auditSentence(row({ action: "developer.work_as_expired", after: null }), t)).toBe("Working as another person ended by itself (the time was over or the session ended).");
    expect(auditSentence(row({ action: "developer.work_as_notice", after: { ...person, recipients: 2, told: 2, failed: 0 } }), t)).toBe("Notice to the Boss about working as Asha Namba (Receptionist).");
    expect(auditSentence(row({ action: "developer.work_as_notice", after: { recipients: 0 } }), t)).toBe("Notice to the Boss about working as another person.");
    expect(auditSentence(row({ action: "developer.access_notice", after: { ...person, what: "suspended", recipients: 2, told: 2, failed: 0 } }), t)).toBe("Notice to the Boss about a change to the account of Asha Namba (Receptionist).");
    expect(auditSentence(row({ action: "developer.access_notice", after: { recipients: 0 } }), t)).toBe("Notice to the Boss about a change to a staff account.");
    // still the Developer's own line: the line below the sentence says who
    expect(auditWho(expired, t)).toBe("Nino (Developer)");
  });

  it("only a Work as line is read for a person: the same fields on any other line are ignored", () => {
    expect(workAsTargetOf("developer.work_as_started", person)).toEqual({ name: "Asha Namba", role: "Receptionist" });
    expect(workAsTargetOf("reservation.created", person)).toBeNull();
    expect(workAsTargetOf("developer.work_as_refused", person)).toBeNull();
    expect(workAsTargetOf("developer.work_as_started", "not an object")).toBeNull();
    expect(workAsTargetOf("developer.work_as_started", { targetName: 42 })).toBeNull();
    expect(workAsTargetOf("developer.work_as_started", { targetName: "x".repeat(500) })!.name).toHaveLength(120);
  });

  it("the words come out of auditWordsFor in the reader's words, with the role through t() (the catalog turns it into Chinese)", () => {
    const zh = makeT("zh-CN", { Receptionist: "前台", "{name} ({role})": "{name}（{role}）", "started working as {person}": "开始以 {person} 的身份操作" });
    expect(auditWordsFor("developer.work_as_started", { name: "Asha Namba", role: "Receptionist" }, zh)).toBe("开始以 Asha Namba（前台） 的身份操作");
  });

  it("the Developer's Audit list draws the named sentence", () => {
    const html = renderToStaticMarkup(createElement(DeveloperAuditList, { rows: [row({ action: "developer.work_as_started", after: person })], t, timezone: "Africa/Dar_es_Salaam" }));
    expect(html).toContain("Developer started working as Asha Namba (Receptionist).");
    expect(html).not.toContain("another person");
  });
});

describe("every action the Developer's code writes has plain words", () => {
  const ALL = [
    "user.suspended", "user.reactivated", "user.signed_out_everywhere", "user.suspend_failed", "user.reactivate_failed", "user.sign_out_failed", "settings.update.refused",
    "developer.work_as_refused", "developer.work_as_expired", "developer.work_as_notice", "developer.access_notice", "developer.endpoint_refused", "developer.viewed_limit", "developer.exported",
    "developer.downloaded", "developer.business_viewed", "auth.login_failed_suppressed", "auth.login_failed",
  ];

  it("none is shown by its raw name, and none is a sentence fragment too short to read", () => {
    for (const a of ALL) {
      const words = auditActionWords(a);
      expect(words, a).not.toMatch(/[._]/);
      expect(words.length, a).toBeGreaterThan(8);
    }
  });

  it("the history lists (the Boss's 'What the team is doing') use the same words as the audit trail for the new entries", () => {
    for (const [action, words] of Object.entries(ACCOUNT_AND_DEVELOPER_WORDS)) expect(auditActionWords(action), action).toBe(words);
  });

  it("words that already existed for staff are not in the shared table (so no existing line changes)", () => {
    for (const action of ["user.deleted", "withdrawal.refused", "setup.team_logins", "user.created", "user.updated", "reservation.checked_in"]) expect(ACCOUNT_AND_DEVELOPER_WORDS, action).not.toHaveProperty(action);
    expect(friendlyAction("user.created")).toBe("added a staff member");
    expect(friendlyAction("reservation.checked_in")).toBe("checked a guest in");
    expect(friendlyAction("developer.work_as_started")).toBe("started working as another person");
  });

  it("a sentence: a Developer's refusal, a staff member at the Developer's door, a suspension", () => {
    expect(auditSentence(row({ action: "settings.update.refused" }), t)).toBe("Developer was refused a change to the settings about money.");
    expect(auditSentence(row({ action: "user.suspended" }), t)).toBe("Developer suspended a staff account.");
    expect(auditSentence(row({ action: "user.sign_out_failed" }), t)).toBe("Developer could not sign a person out of every device.");
    expect(auditSentence(row({ actorType: "STAFF", actorName: "Asha", action: "developer.endpoint_refused" }), t)).toBe("Asha tried to use the Developer's pages and was refused.");
  });

  it("the note that more failed sign-ins followed is the System's, with no 'who' in front", () => {
    const marker = row({ actorType: "SYSTEM", actorName: "Sign-in page (not signed in)", userId: null, action: "auth.login_failed_suppressed" });
    expect(auditWho(marker, t)).toBe("System");
    expect(auditSentence(marker, t)).toBe("More failed sign-ins followed in a short time (not every one is listed).");
    expect([...NOTE_ACTIONS].sort()).toEqual(["auth.login_failed", "auth.login_failed_suppressed", "developer.access_notice", "developer.work_as_expired", "developer.work_as_notice"]);
  });
});

describe("failures are told apart from information", () => {
  it("a name ending _failed or _refused (or .refused / .denied) is a failure", () => {
    for (const a of ["user.suspend_failed", "user.reactivate_failed", "user.sign_out_failed", "settings.update.refused", "developer.work_as_refused", "developer.endpoint_refused", "developer.denied", "auth.login_failed"]) {
      expect(isFailureAction(a), a).toBe(true);
    }
  });

  it("notes are NOT failures: ended by itself, a flood marker, the page-visit marker, the Boss notice (by its name)", () => {
    for (const a of ["developer.work_as_expired", "auth.login_failed_suppressed", "developer.viewed_limit", "developer.work_as_notice", "developer.access_notice", "user.suspended", "user.signed_out_everywhere", "developer.exported"]) {
      expect(isFailureAction(a), a).toBe(false);
    }
    expect(isFailureEntry("developer.work_as_expired", { targetName: "Asha", minutes: 240 })).toBe(false);
  });

  it("a Boss notice that reached nobody, or not everybody, is a failure; one that reached everyone is not", () => {
    expect(isFailureEntry("developer.work_as_notice", { recipients: 2, told: 0, failed: 2 })).toBe(true);
    expect(isFailureEntry("developer.work_as_notice", { recipients: 0, told: 0, failed: 0 })).toBe(true); // nobody to tell: the Boss was not told
    expect(isFailureEntry("developer.work_as_notice", { recipients: 2, told: 1, failed: 1 })).toBe(true);
    expect(isFailureEntry("developer.work_as_notice", { recipients: 2, told: 2, failed: 0 })).toBe(false);
    expect(isFailureEntry("developer.work_as_notice", null)).toBe(false);
    // the notice about a suspension or a sign-out everywhere is read the same way
    expect(isFailureEntry("developer.access_notice", { what: "suspended", recipients: 2, told: 0, failed: 2 })).toBe(true);
    expect(isFailureEntry("developer.access_notice", { what: "signed_out_everywhere", recipients: 0, told: 0, failed: 0 })).toBe(true);
    expect(isFailureEntry("developer.access_notice", { what: "suspended", recipients: 2, told: 1, failed: 1 })).toBe(true);
    expect(isFailureEntry("developer.access_notice", { what: "suspended", recipients: 2, told: 2, failed: 0 })).toBe(false);
    expect(isFailureEntry("reservation.created", { told: 0 })).toBe(false); // only the notice reads these fields
  });

  it("the database filter ('Failures') lets through exactly what the badge calls a failure", async () => {
    const M = `${TAG}Fail`;
    const put = (action: string, after: unknown, extra: Record<string, unknown> = {}) =>
      db.auditLog.create({ data: { userId: dev.id, actorLabel: "Dev Ui2", actorType: "DEVELOPER", actorRole: "DEVELOPER", action, entityType: M, entityId: action, after: after as never, businessDate: new Date(), ...extra } });
    await put("developer.work_as_notice", { targetName: "A", recipients: 2, told: 0, failed: 2 });
    await put("developer.work_as_notice", { targetName: "B", recipients: 2, told: 1, failed: 1 });
    await put("developer.work_as_notice", { targetName: "C", recipients: 2, told: 2, failed: 0 });
    await put("developer.work_as_notice", { targetName: "D", recipients: 0, told: 0, failed: 0 });
    await put("developer.access_notice", { targetName: "E", what: "suspended", recipients: 2, told: 0, failed: 2 });
    await put("developer.access_notice", { targetName: "F", what: "signed_out_everywhere", recipients: 2, told: 2, failed: 0 });
    await put("developer.work_as_expired", { targetName: "A", minutes: 240 });
    await put("auth.login_failed_suppressed", { count: 10, limit: 10 }, { userId: null, actorType: "SYSTEM", actorRole: null });
    await put("user.suspend_failed", { error: "Type CONFIRM exactly." });
    await put("settings.update.refused", { why: "money" });
    await put("developer.endpoint_refused", { path: "/staff/developer" }, { userId: rec.id, actorType: "STAFF", actorRole: "RECEPTIONIST" });
    await put("user.suspended", { isActive: false, reason: "lost phone" });

    const boss: AuditViewer = { permissions: new Set(["audit.view"]) };
    const { timezone } = (await db.hotelSettings.findFirstOrThrow({ select: { timezone: true } }));
    const day = auditToday(timezone);
    const base = parseAuditFilter({ module: M, from: day, to: day }, day).filter;
    const all = (await queryAuditTrail(boss, base)).rows;
    expect(all).toHaveLength(12);
    const failures = (await queryAuditTrail(boss, { ...base, failures: true })).rows;
    expect(failures.map((r) => `${r.action}:${(r.after as { targetName?: string })?.targetName ?? ""}`).sort()).toEqual([
      "developer.access_notice:E", "developer.endpoint_refused:", "developer.work_as_notice:A", "developer.work_as_notice:B", "developer.work_as_notice:D", "settings.update.refused:", "user.suspend_failed:",
    ]);
    // the badge and the filter agree, row by row
    expect(all.filter((r) => !r.ok).map((r) => r.id).sort()).toEqual(failures.map((r) => r.id).sort());
    // the people list of the filter boxes is unchanged by any of this
    expect((await auditFilterChoices(boss, base)).modules).toContain(M);
  });
});

// ───────────────────────────────────────────── 2. what counts as work ─────────────────────────────────────────────
describe("the 'not work' list", () => {
  it("holds every look, check, export, refusal, failed try and note the Developer's code writes; what they do on purpose is work", () => {
    const written = [...read("src/server/services/developer-view-log.ts").matchAll(/"(developer\.[a-z_]+)"/g)].map((m) => m[1]);
    for (const looking of ["developer.viewed", "developer.viewed_limit", "developer.business_viewed", "developer.inspected", "developer.exported", "developer.downloaded", ...written.filter((a) => /viewed|exported|downloaded/.test(a))]) {
      expect(NOT_WORK_ACTIONS, looking).toContain(looking);
    }
    for (const gone of ["developer.denied", "developer.work_as_refused", "developer.endpoint_refused", "settings.update.refused", "user.suspend_failed", "user.reactivate_failed", "user.sign_out_failed"]) expect(NOT_WORK_ACTIONS, gone).toContain(gone);
    for (const note of ["developer.work_as_expired", "developer.work_as_notice", "developer.access_notice", "auth.login_failed_suppressed", "auth.login", "auth.logout", "auth.login_failed"]) expect(NOT_WORK_ACTIONS, note).toContain(note);
    for (const work of ["developer.work_as_started", "developer.work_as_ended", "user.suspended", "user.reactivated", "user.signed_out_everywhere"]) expect(NOT_WORK_ACTIONS, work).not.toContain(work);
    expect(new Set(NOT_WORK_ACTIONS).size).toBe(NOT_WORK_ACTIONS.length);
  });

  it("every 'refused' or 'failed' name the Developer's code can write is on the list (a new one must be decided here)", () => {
    const files = ["src/server/services/work-as.ts", "src/server/services/developer-view-log.ts", "src/server/services/developer-business.ts", "src/server/services/developer-console.ts", "src/app/staff/(app)/settings/actions.ts"];
    const names = new Set<string>();
    for (const f of files) for (const m of read(f).matchAll(/["'`]((?:developer|user|settings)\.[a-z_.]*(?:_failed|_refused|\.refused|\.denied))["'`]/g)) names.add(m[1]);
    expect(names.size).toBeGreaterThan(4);
    for (const n of names) expect(NOT_WORK_ACTIONS, n).toContain(n);
  });
});

// ───────────────────────────────────────────── 3. the charts ─────────────────────────────────────────────
describe("a chart's exact numbers", () => {
  const columns = [
    { key: "a", tick: "15 Oct", name: "15 Oct", values: { team: 12, developer: 3 } },
    { key: "b", tick: "", name: "16 Oct", values: { team: 0, developer: 0 } },
    { key: "c", tick: "17 Oct", name: "17 Oct", values: { team: 1234, developer: 0 }, emphasise: true },
  ];
  const series = [{ key: "team", label: "Team", color: "#3987e5" }, { key: "developer", label: "Developer", color: "#c98500" }];
  const html = renderToStaticMarkup(createElement(BarChart, { t, columns, series, caption: "Actions per day", empty: "Nothing" }));

  it("is a table anyone can open ('Show the numbers'), not a table hidden from the eye", () => {
    expect(html).toContain("<details");
    expect(html).toContain("Show the numbers");
    expect(html).toContain("Hide the numbers");
    expect(html).not.toMatch(/<div class="sr-only"><table/);
    const table = html.slice(html.indexOf("<table"), html.indexOf("</table>"));
    // every column is a row, every series a column, every exact number is in the table (a thousands separator included)
    for (const name of ["15 Oct", "16 Oct", "17 Oct"]) expect(table).toContain(`>${name}</th>`);
    expect(table.match(/<th scope="row"/g)).toHaveLength(3);
    expect(table.match(/<th scope="col"/g)).toHaveLength(3); // When, Team, Developer
    for (const n of ["12", "3", "0", "1,234"]) expect(table).toContain(`>${n}</td>`);
  });

  it("keeps the bar's own hover text and the picture's spoken summary", () => {
    expect(html).toContain('title="15 Oct: 15 — Team 12 · Developer 3"');
    // several series: the spoken summary says each part of every column, not only its sum
    expect(html).toContain('aria-label="Actions per day: 15 Oct 15 (Team 12 · Developer 3), 16 Oct 0, 17 Oct 1,234 (Team 1,234)"');
  });

  it("every chart on the console says what is true: hover for a bar, the table below for all of them (never 'press a bar')", () => {
    for (const f of ["src/app/staff/(app)/developer/tab-activity.tsx", "src/app/staff/(app)/developer/tab-crashes.tsx"]) {
      const text = read(f);
      expect(text, f).not.toContain("Hover or press a bar");
      expect(text, f).toContain("Hover a bar for exact numbers; the table below has them all.");
    }
    // every BarChart draws the table (one component), so the sentence holds for each of the four
    expect(read("src/app/staff/(app)/developer/console-charts.tsx").match(/<details/g)).toHaveLength(1);
    expect(read("src/app/staff/(app)/developer/tab-activity.tsx").match(/<BarChart/g)).toHaveLength(3);
    expect(read("src/app/staff/(app)/developer/tab-crashes.tsx").match(/<BarChart/g)).toHaveLength(1);
  });

  it("'Actions per day' says that refused attempts are not counted either", () => {
    expect(read("src/app/staff/(app)/developer/tab-activity.tsx")).toContain("Sign-ins, just looking and refused attempts are not counted.");
  });
});

// ───────────────────────────────────────────── 4. the health card ─────────────────────────────────────────────
describe("the health card's four figures are a real definition list", () => {
  const report: HealthReport = {
    checkedAt: new Date(), database: { online: true, ms: 7 }, signedInToday: 3, actionsToday: 41, alerts: { total: 2, guestRequests: 1, stockRequests: 1 }, failedSignIns24h: 0,
    items: [], counts: { fix: 0, look: 0, info: 0 }, score: 100, verdict: "well",
  };
  const html = renderToStaticMarkup(createElement(HealthCard, { t, h: report }));
  const dl = html.slice(html.indexOf("<dl"), html.indexOf("</dl>") + 5);

  it("dl > div > dt + dd, nothing else in it", () => {
    expect(dl.startsWith("<dl")).toBe(true);
    expect(dl).not.toMatch(/<p[ >]/);
    expect(dl.match(/<dt[ >]/g)).toHaveLength(4);
    expect(dl.match(/<dd[ >]/g)!.length).toBeGreaterThanOrEqual(8);
    // every child of the list is a <div> that starts with its <dt>
    const groups = dl.slice(dl.indexOf(">") + 1, dl.lastIndexOf("</dl>")).split('<div class="min-w-0">').slice(1);
    expect(groups).toHaveLength(4);
    for (const g of groups) expect(g.startsWith("<dt")).toBe(true);
  });

  it("says the same words as before", () => {
    for (const w of ["Database", "Online", "7 ms to answer", "Signed in today", "Actions today", "Alerts waiting", "Guest requests: 1. Stock requests: 1."]) expect(dl).toContain(w);
  });
});

// ───────────────────────────────────────────── 4b. the Access page's words ─────────────────────────────────────────────
describe("the Access page says what the buttons do today", () => {
  const html = renderToStaticMarkup(createElement(AccessView, { t, groups: [], count: 0, nowIso: new Date().toISOString(), timezone: "Africa/Dar_es_Salaam" }));
  const text = html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/\s+/g, " ");

  it("Work as: ends after 4 hours or with the session; no money; no shifts", () => {
    expect(text).toContain("It ends by itself after 4 hours.");
    expect(text).toContain("It also ends when your session ends. Their shift is never started or closed for them.");
    expect(text).toContain("A shift is never started or closed for them either.");
  });

  it("Sign out everywhere: not offered for the Boss's account", () => {
    expect(text).toContain("It is not offered for the Boss's account.");
  });
});

// ───────────────────────────────────────────── 5. the migration's backfill ─────────────────────────────────────────────
describe("the migration labels old audit lines like the app's audit writer does", () => {
  const sql = read("prisma/migrations/20261014090000_developer_account/migration.sql");
  const start = sql.indexOf('UPDATE "audit_logs" a SET');
  const statement = sql.slice(start, sql.indexOf('WHERE a."actorType" IS NULL;', start) + 'WHERE a."actorType" IS NULL;'.length);
  /** The migration's own statement, narrowed to this test's rows (so other tests' rows are never touched). */
  const mine = (module: string) => statement.replace('WHERE a."actorType" IS NULL;', `WHERE a."actorType" IS NULL AND a."entityType" = '${module}'`);
  const run = (module: string) => db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('vegas.audit_maintenance', 'on', true)`; // the lock would refuse the UPDATE; the real migration runs before the lock exists
    await tx.$executeRawUnsafe(mine(module));
    await tx.$executeRaw`SELECT set_config('vegas.audit_maintenance', 'off', true)`;
  });

  it("finds the statement (it is the one under test)", () => {
    expect(start).toBeGreaterThan(0);
    expect(statement).toContain("SYSTEM_ONLINE");
    expect(statement).toContain("WHERE a.\"actorType\" IS NULL;");
  });

  it("staff = STAFF with their role; the online-payment account = SYSTEM (role kept as the writer keeps it); no account = WEBSITE / SYSTEM; a line that has a type is left alone — twice over", async () => {
    const M = `${TAG}Backfill`;
    const old = (id: string, data: Record<string, unknown>) =>
      db.auditLog.create({ data: { id, action: "old.line", entityType: M, entityId: id, businessDate: new Date("2026-10-01"), createdAt: new Date("2026-10-01T08:00:00Z"), ...data } as never });
    const ids = { staff: `${M}-staff`, system: `${M}-system`, website: `${M}-website`, nobody: `${M}-nobody`, typed: `${M}-typed` };
    await old(ids.staff, { userId: rec.id, actorLabel: rec.fullName });
    await old(ids.system, { userId: sys.id, actorLabel: "system" });
    await old(ids.website, { userId: null, actorLabel: "website" });
    await old(ids.nobody, { userId: null, actorLabel: "system" });
    await old(ids.typed, { userId: rec.id, actorLabel: rec.fullName, actorType: "DEVELOPER", actorRole: "DEVELOPER" }); // already typed: not ours to touch
    const read1 = async () => Object.fromEntries((await db.auditLog.findMany({ where: { entityType: M } })).map((r) => [r.id.slice(M.length + 1), [r.actorType, r.actorRole]]));

    await run(M);
    const first = await read1();
    expect(first).toEqual({ staff: ["STAFF", "RECEPTIONIST"], system: ["SYSTEM", "SYSTEM_ONLINE"], website: ["WEBSITE", null], nobody: ["SYSTEM", null], typed: ["DEVELOPER", "DEVELOPER"] });

    // the same answer as the app gives today for the same two accounts
    const live = async (userId: string) => {
      await audit(db, { userId, label: "x" }, { action: "live.line", entityType: `${M}-live`, entityId: userId });
      const r = await db.auditLog.findFirstOrThrow({ where: { entityType: `${M}-live`, entityId: userId } });
      return [r.actorType, r.actorRole];
    };
    expect(await live(rec.id)).toEqual(first.staff);
    expect(await live(sys.id)).toEqual(first.system);

    // idempotent: a second run changes nothing that is already typed ...
    await run(M);
    expect(await read1()).toEqual(first);
    // ... and still labels a line that is not (the statement is not a one-off)
    await old(`${M}-late`, { userId: sys.id, actorLabel: "system" });
    await run(M);
    expect((await db.auditLog.findUniqueOrThrow({ where: { id: `${M}-late` } })).actorType).toBe("SYSTEM");
    expect(await read1()).toEqual({ ...first, late: ["SYSTEM", "SYSTEM_ONLINE"] });
  });
});

// ───────────────────────────────────────────── 6. who staff may see in a list ─────────────────────────────────────────────
describe("a list of people that staff see leaves out the Developer and the system account", () => {
  const SKIP = new Set(["generated", "node_modules", ".next"]);
  const walk = (dir: string, out: string[] = []): string[] => {
    for (const name of readdirSync(dir)) {
      if (SKIP.has(name)) continue;
      const p = path.join(dir, name);
      if (statSync(p).isDirectory()) walk(p, out);
      else if (/\.(ts|tsx)$/.test(name) && !/\.test\./.test(name)) out.push(p);
    }
    return out;
  };
  /** The text of a call, from its "(" to the matching ")". */
  const callText = (src: string, open: number): string => {
    let depth = 0, quote = "";
    for (let i = open; i < src.length; i++) {
      const c = src[i];
      if (quote) { if (c === "\\") i++; else if (c === quote) quote = ""; continue; }
      if (c === '"' || c === "'" || c === "`") { quote = c; continue; }
      if (c === "(") depth++;
      else if (c === ")" && --depth === 0) return src.slice(open, i + 1);
    }
    return src.slice(open);
  };
  /** Every user query that lists, counts or finds people and is not a lookup of names for known ids and does not use the helper. */
  function unguarded(): Record<string, number> {
    const out: Record<string, number> = {};
    for (const file of [...walk(path.join(root, "src/app")), ...walk(path.join(root, "src/server"))]) {
      const src = readFileSync(file, "utf8");
      for (const m of src.matchAll(/\b(?:db|tx)\.user\.(?:findMany|findFirst|count|groupBy)\(/g)) {
        const call = callText(src, m.index! + m[0].length - 1);
        if (/operationalOnly\(|withoutDeveloper\(/.test(call) || /\bid: \{ in:/.test(call)) continue;
        const rel = path.relative(root, file);
        out[rel] = (out[rel] ?? 0) + 1;
      }
    }
    return out;
  }

  /** Every query that is left was read and has a reason. A new one fails this test until somebody decides. */
  const REVIEWED: Record<string, { count: number; why: string }> = {
    "src/app/staff/(app)/activity/data.ts": { count: 1, why: "the staff activity page: the Developer is left out for everyone who may not see Developer actions" },
    "src/app/staff/(app)/shifts/page.tsx": { count: 1, why: "who works reception shifts = shifts.work WITHOUT shifts.manage; the Developer holds shifts.manage, so it can never be listed" },
    "src/server/services/audit-trail.ts": { count: 1, why: "the Audit pages list everyone on purpose; the Developer only for those who may see Developer actions" },
    "src/server/services/developer-console.ts": { count: 1, why: "the Developer's own console (inspect a person's rights): full on purpose" },
    "src/server/services/developer-health.ts": { count: 2, why: "the Developer's own console; both already leave out the Developer and the system account" },
    "src/server/services/work-as.ts": { count: 1, why: "the Developer's Access page; leaves out the Developer and the system account" },
    "src/server/services/staff-accounts.ts": { count: 3, why: "the Users page for the Boss and the MD (it never lists the Developer), and two counts of active Bosses" },
    "src/server/services/shifts.ts": { count: 1, why: "a receptionist picked by id for the rota: DESK_WORKER = shifts.work without shifts.manage, which the Developer never matches (the other query is a lookup by ids)" },
    "src/server/services/restaurant.ts": { count: 2, why: "the waiter who brought money (not management: the Developer holds the dashboards, so it is excluded) and the account online payments are recorded under (needs revenue.record, which the Developer never holds)" },
    "src/server/services/mobile-payments.ts": { count: 1, why: "the same waiter check as above, by id; the Developer is excluded as management" },
    "src/server/services/finance.ts": { count: 1, why: "names for a report of what people did that day: only people who did something appear" },
  };

  it("every query is either guarded, a lookup of names for known ids, or in the reviewed list", () => {
    const found = unguarded();
    const expected = Object.fromEntries(Object.entries(REVIEWED).map(([f, v]) => [f, v.count]));
    expect(found).toEqual(expected);
  });

  it("the query lines changed in this round use the helper", () => {
    const guarded: [string, RegExp][] = [
      ["src/app/staff/(app)/settings/languages/page.tsx", /db\.user\.count\(\{ where: operationalOnly\(/],
      ["src/app/staff/(app)/settings/control/page.tsx", /db\.user\.count\(\{ where: operationalOnly\(/],
      ["src/app/staff/(app)/shifts/all/page.tsx", /db\.user\.findMany\(\{ where: withoutDeveloper\(/],
      ["src/server/services/collections.ts", /db\.user\.findMany\(\{\s*where: operationalOnly\(/],
      ["src/server/services/accountant.ts", /db\.user\.findMany\(\{ where: operationalOnly\(/],
      ["src/server/services/accountant-reports.ts", /db\.user\.findMany\(\{\s*where: operationalOnly\(/],
      ["src/server/services/procurement-desk.ts", /db\.user\.findMany\(\{ where: withoutDeveloper\(/],
      ["src/server/services/daily-document.ts", /db\.user\.findMany\(\{ where: withoutDeveloper\(\)/],
    ];
    for (const [file, pattern] of guarded) expect(read(file), file).toMatch(pattern);
  });
});

// ───────────────────────────────────────────── 7. the document ─────────────────────────────────────────────
describe("docs/developer-account.md says what the code does", () => {
  const doc = read("docs/developer-account.md");

  it("the numbers in it are the code's own", () => {
    expect(doc).toContain(`**${DEVELOPER_TRIES} wrong tries for one Developer email in 15 minutes**`);
    expect(doc).toContain(`**${FAILED_SIGN_IN_ROWS_PER_HOUR} failed tries per account per hour**`);
    expect(doc).toContain(`**${DEVELOPER_SESSION_HOURS} hours at most**`);
    expect(doc).toContain(`**${DEVELOPER_IDLE_MINUTES} minutes without use ends it.**`);
    expect(doc).toContain(`It ends **by itself after ${WORK_AS_HOURS} hours**`);
    expect(doc).toContain(`more than ${VIEW_BURST_LIMIT.toLocaleString("en")} pages in 10 minutes`);
    expect(doc).toContain(`at most once in ${ENDPOINT_REFUSED_MINUTES} minutes`);
  });

  it("covers every rule of this round", () => {
    for (const phrase of [
      "The lock does not tell", "Incorrect email or password", "auth.login_failed_suppressed", "No timer runs for the Developer", "developer.work_as_expired", "developer.work_as_notice",
      "can never start, end, take over or close a shift", "opening balance", "**group's** prices", "weekly and monthly reports", "developer.endpoint_refused", "the database refuses it",
      "marking a cancelled check-in as cancelled", "not by who did them", "information, not a failure",
    ]) expect(doc, phrase).toContain(phrase);
  });

  it("no longer says what is not true", () => {
    expect(doc).not.toContain("not even from the database");
    expect(doc).not.toMatch(/every page except the sign-in page, the "no access" page and the person's own account page/);
    expect(doc).not.toContain("makes you wait.");
  });

});
