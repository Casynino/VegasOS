import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

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
import { requirePagePermission } from "@/server/auth";
import { AppError } from "@/server/errors";
import { getSettings, businessDayConfig } from "@/server/settings";
import { DEFAULT_ROLES } from "@/lib/permissions";
import { addDays, businessDateOf, toDbDate, zonedInstant } from "@/lib/time/business-date";
import { makeT } from "@/i18n/translate";
import {
  AUDIT_DEFAULT_DAYS, AUDIT_MAX_DAYS, AUDIT_MAX_PAGE, AUDIT_PAGE_SIZE, auditActionWords, auditFilterChoices, auditToday, auditWhere,
  isFailureAction, isFailureEntry, parseAuditFilter, parseDeveloperAuditFilter, queryAuditTrail, type AuditFilter, type AuditRow, type AuditViewer,
} from "@/server/services/audit-trail";
import { activityWhere } from "@/app/staff/(app)/activity/data";
import { AuditList, showJson } from "@/app/staff/(app)/audit/audit-rows";
import { DeveloperAuditList, auditSentence, auditWho } from "@/app/staff/(app)/developer/audit/developer-audit-rows";
import DeveloperAuditPage from "@/app/staff/(app)/developer/audit/page";
import { staffHome } from "@/lib/staff-home";
import type { Prisma } from "@/generated/prisma/client";
import { browser, makeSession, makeUser, redirectOf, removeMadeUsers, thrownBy, type MadeUser } from "../support/developer";

/**
 * The Audit trail (owner, 2026-10-14) — read-only, for the Boss, the MD and the Developer, proven against a real database:
 *   - who may read it (the service refuses everyone without "audit.view"; the page's check sends them away);
 *   - the filters (who acted, a person, the action, the module, the dates in the hotel's time zone);
 *   - every search is bounded: 50 a page, newest first, a deepest page, a longest date range, no count of the whole table;
 *   - nothing secret is shown (hidden when read and again when drawn), failures are told apart, and there is no edit or delete control.
 */

const TAG = randomUUID().slice(0, 8);
/** Every row these tests write has an entityType starting with this, so a search for it sees only our rows (the database is shared with other tests). */
const MOD = `ATrail${TAG}`;
const MAINTENANCE_ON = `SELECT set_config('vegas.audit_maintenance', 'on', true)`;

let dev: MadeUser, boss: MadeUser, md: MadeUser, rec: MadeUser, mgr: MadeUser, fin: MadeUser;
let tz: string;
const viewerOf = (role: keyof typeof DEFAULT_ROLES): AuditViewer => ({ permissions: new Set<string>(DEFAULT_ROLES[role].permissions) });
const BOSS = viewerOf("OWNER");

const base: Omit<AuditFilter, "module"> = { actor: "ALL", userId: "", action: "", from: "2026-03-01", to: "2026-03-31", page: 1 };
const search = (module: string, over: Partial<AuditFilter> = {}, viewer: AuditViewer = BOSS) => queryAuditTrail(viewer, { ...base, module, ...over });

interface Put {
  at?: Date;
  user?: MadeUser | null;
  label?: string | null;
  /** "none" writes a row without a type (a script that wrote SQL directly). */
  type?: "DEVELOPER" | "STAFF" | "SYSTEM" | "WEBSITE" | "none";
  role?: string | null;
  action: string;
  module?: string;
  entityId?: string | null;
  before?: unknown;
  after?: unknown;
  ip?: string | null;
}
/** One row written straight into the table (inserts are allowed), with the business date the app would give it. */
async function put(o: Put) {
  const at = o.at ?? new Date();
  const config = businessDayConfig(await getSettings());
  return db.auditLog.create({
    data: {
      userId: o.user?.id ?? null,
      actorLabel: o.label === undefined ? o.user?.fullName ?? null : o.label,
      actorType: o.type === "none" ? null : o.type ?? (o.user ? "STAFF" : "SYSTEM"),
      actorRole: o.role ?? null,
      ipAddress: o.ip ?? null,
      action: o.action,
      entityType: o.module ?? MOD,
      entityId: o.entityId ?? null,
      ...(o.before !== undefined && { before: o.before as Prisma.InputJsonValue }),
      ...(o.after !== undefined && { after: o.after as Prisma.InputJsonValue }),
      businessDate: toDbDate(businessDateOf(at, config)),
      createdAt: at,
    },
  });
}
const day = (date: string, minutes: number) => zonedInstant(date, minutes, tz);
const actions = (p: { rows: AuditRow[] }) => p.rows.map((r) => r.action);

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: `Dev Trail ${TAG}` });
  boss = await makeUser("OWNER", { fullName: `Boss Trail ${TAG}` });
  md = await makeUser("ADMIN", { fullName: `MD Trail ${TAG}` });
  rec = await makeUser("RECEPTIONIST", { fullName: `Asha Trail ${TAG}` });
  mgr = await makeUser("MANAGER", { fullName: `Manager Trail ${TAG}` });
  fin = await makeUser("FINANCE", { fullName: `Finance Trail ${TAG}` });
  tz = (await getSettings()).timezone;
});
afterAll(async () => {
  // The audit trail cannot be deleted — only through the one maintenance path, inside a transaction. This removes just the rows these tests made.
  await db.$transaction(async (tx) => {
    await tx.$queryRawUnsafe(MAINTENANCE_ON);
    await tx.auditLog.deleteMany({ where: { OR: [{ entityType: { startsWith: MOD } }, { userId: { in: [dev.id, boss.id, md.id, rec.id, mgr.id, fin.id] } }] } });
  });
  await removeMadeUsers();
});
beforeEach(() => browser.reset());

// ───────────────────────────────────────────── 1. who may read it ─────────────────────────────────────────────
describe("who may read the audit trail", () => {
  it("the service refuses a staff member without audit.view (Reception, Manager, Finance…) — for the search and for the filter lists", async () => {
    for (const role of ["RECEPTIONIST", "MANAGER", "FINANCE", "ACCOUNTANT", "RESTAURANT", "KITCHEN", "DRIVER"] as const) {
      const viewer = viewerOf(role);
      for (const run of [() => search(MOD, {}, viewer), () => auditFilterChoices(viewer, { ...base, module: MOD })]) {
        const e = await thrownBy(run);
        expect(e, role).toBeInstanceOf(AppError);
        expect((e as AppError).code, role).toBe("FORBIDDEN");
      }
    }
    expect(await thrownBy(() => search(MOD, {}, { permissions: new Set() }))).toBeInstanceOf(AppError);
  });

  it("the Boss, the MD and the Developer may", async () => {
    for (const role of ["OWNER", "ADMIN", "DEVELOPER"] as const) {
      expect(await thrownBy(() => search(MOD, {}, viewerOf(role))), role).toBeNull();
    }
  });

  it("the page's check (requirePagePermission) lets the Boss, the MD and the Developer in and sends everyone else to the 'no access' page", async () => {
    for (const u of [boss, md, dev]) {
      browser.reset();
      await makeSession(u.id);
      expect(await redirectOf(() => requirePagePermission("audit.view")), u.fullName).toBeNull();
    }
    for (const u of [rec, mgr, fin]) {
      browser.reset();
      await makeSession(u.id);
      expect(await redirectOf(() => requirePagePermission("audit.view")), u.fullName).toBe("/staff/forbidden");
    }
    browser.reset(); // nobody signed in
    expect(await redirectOf(() => requirePagePermission("audit.view"))).toBe("/staff/login");
  });

  it("the Boss, as signed in, sees a Developer's actions — accountability", async () => {
    const mark = `test.boss.sees.${TAG}`;
    await audit(db, { userId: dev.id, label: dev.fullName }, { action: mark, entityType: `${MOD}Boss`, entityId: "x1" });
    browser.reset();
    await makeSession(boss.id);
    const me = await requirePagePermission("audit.view");
    const today = auditToday(tz);
    const page = await queryAuditTrail(me, { ...base, from: today, to: today, module: `${MOD}Boss` });
    expect(actions(page)).toEqual([mark]);
    expect(page.rows[0].actorType).toBe("DEVELOPER");
  });
});

// ───────────────────────────────────────────── 2. the filters ─────────────────────────────────────────────
describe("filter: who acted", () => {
  const M = `${MOD}Who`;
  beforeAll(async () => {
    // Written the way the app writes them: the type comes from the account's role in the database.
    const w = (actor: Parameters<typeof audit>[1], action: string) => audit(db, actor, { action, entityType: M, entityId: action });
    await w({ userId: dev.id, label: dev.fullName }, "t.dev");
    await w({ userId: rec.id, label: rec.fullName }, "t.staff");
    await w({ userId: null, label: "system" }, "t.system");
    await w({ userId: null, label: "website" }, "t.website");
    // A row from a script that wrote SQL directly has no type: it is read by the account behind it.
    const at = new Date();
    await put({ at, user: dev, type: "none", action: "t.legacy.dev", module: M });
    await put({ at, user: rec, type: "none", action: "t.legacy.staff", module: M });
    await put({ at, type: "none", label: "system", action: "t.legacy.system", module: M });
  });
  const q = (actor: AuditFilter["actor"]) => {
    const today = auditToday(tz);
    return queryAuditTrail(BOSS, { ...base, module: M, from: today, to: today, actor });
  };
  const names = async (a: AuditFilter["actor"]) => (await q(a)).rows.map((r) => r.action).sort();

  it("All shows every kind", async () => {
    expect(await names("ALL")).toEqual(["t.dev", "t.legacy.dev", "t.legacy.staff", "t.legacy.system", "t.staff", "t.system", "t.website"]);
  });
  it("Developer shows only a Developer's actions (a row with no type is read by its account)", async () => {
    expect(await names("DEVELOPER")).toEqual(["t.dev", "t.legacy.dev"]);
    for (const r of (await q("DEVELOPER")).rows) expect(r.actorType).toBe("DEVELOPER");
  });
  it("Staff shows only staff", async () => {
    expect(await names("STAFF")).toEqual(["t.legacy.staff", "t.staff"]);
  });
  it("System & website shows the system's and the website's", async () => {
    expect(await names("SYSTEM")).toEqual(["t.legacy.system", "t.system", "t.website"]);
    const types = Object.fromEntries((await q("SYSTEM")).rows.map((r) => [r.action, r.actorType]));
    expect(types).toMatchObject({ "t.system": "SYSTEM", "t.website": "WEBSITE", "t.legacy.system": "SYSTEM" });
  });
  it("each row says who it was: the type, the role the account held, the name written with it", async () => {
    const rows = Object.fromEntries((await q("ALL")).rows.map((r) => [r.action, r]));
    expect(rows["t.dev"]).toMatchObject({ actorType: "DEVELOPER", actorRole: "DEVELOPER", actorName: dev.fullName, userId: dev.id });
    expect(rows["t.dev"].roleName).toMatch(/developer/i);
    expect(rows["t.staff"]).toMatchObject({ actorType: "STAFF", actorRole: "RECEPTIONIST", actorName: rec.fullName });
    expect(rows["t.website"]).toMatchObject({ actorType: "WEBSITE", actorRole: null, roleName: null, userId: null });
    expect(rows["t.legacy.dev"].actorType).toBe("DEVELOPER");
  });
});

describe("filter: a person", () => {
  const M = `${MOD}Person`;
  beforeAll(async () => {
    await put({ user: dev, type: "DEVELOPER", role: "DEVELOPER", action: "p.dev.1", module: M });
    await put({ user: rec, action: "p.rec.1", module: M });
    await put({ user: rec, action: "p.rec.2", module: M });
    await put({ user: mgr, action: "p.mgr.1", module: M });
  });
  const q = (over: Partial<AuditFilter>) => {
    const today = auditToday(tz);
    return queryAuditTrail(BOSS, { ...base, module: M, from: today, to: today, ...over });
  };
  it("shows only that person's entries", async () => {
    expect((await q({ userId: rec.id })).rows.map((r) => r.action).sort()).toEqual(["p.rec.1", "p.rec.2"]);
    expect(actions(await q({ userId: dev.id }))).toEqual(["p.dev.1"]);
    expect(actions(await q({ userId: mgr.id }))).toEqual(["p.mgr.1"]);
  });
  it("a person together with a kind of actor narrows both: a staff member under 'Developer' has nothing", async () => {
    expect((await q({ userId: rec.id, actor: "DEVELOPER" })).rows).toEqual([]);
    expect(actions(await q({ userId: dev.id, actor: "DEVELOPER" }))).toEqual(["p.dev.1"]);
  });
  it("an id that belongs to nobody finds nothing (no error)", async () => {
    expect((await q({ userId: "no-such-account" })).rows).toEqual([]);
  });
});

describe("filter: the action contains…", () => {
  const M = `${MOD}Action`;
  beforeAll(async () => {
    for (const a of ["payment.recorded", "payment.reversed", "Reservation.Created", "auth.login_failed", "discount.100%_off", "discount.50 off"]) await put({ action: a, module: M, user: rec });
  });
  const q = (action: string) => {
    const today = auditToday(tz);
    return queryAuditTrail(BOSS, { ...base, module: M, from: today, to: today, action });
  };
  it("matches a part of the name, whatever the letter case", async () => {
    expect((await q("payment")).rows.map((r) => r.action).sort()).toEqual(["payment.recorded", "payment.reversed"]);
    expect(actions(await q("RESERVATION.CRE"))).toEqual(["Reservation.Created"]);
    expect(actions(await q("login_failed"))).toEqual(["auth.login_failed"]);
  });
  it("a % or _ typed in the box is plain text, not a wildcard", async () => {
    expect(actions(await q("%_off"))).toEqual(["discount.100%_off"]);
    expect(await q("%")).toMatchObject({ rows: [expect.objectContaining({ action: "discount.100%_off" })] });
    expect((await q("pay_ent")).rows).toEqual([]);
  });
  it("nothing matches nothing", async () => {
    expect((await q("zzz-no-such-action")).rows).toEqual([]);
  });
});

describe("filter: the module", () => {
  const A = `${MOD}ModA`, B = `${MOD}ModB`;
  beforeAll(async () => {
    await put({ action: "m.a1", module: A, user: rec });
    await put({ action: "m.a2", module: A, user: rec });
    await put({ action: "m.b1", module: B, user: rec });
  });
  it("shows only that kind of record, exactly", async () => {
    const today = auditToday(tz);
    const q = (module: string) => queryAuditTrail(BOSS, { ...base, from: today, to: today, module });
    expect((await q(A)).rows.map((r) => r.action).sort()).toEqual(["m.a1", "m.a2"]);
    expect(actions(await q(B))).toEqual(["m.b1"]);
    expect((await q(`${MOD}Mod`)).rows).toEqual([]); // not a prefix match
  });
  it("the module list offers the modules seen in the chosen dates only", async () => {
    const today = auditToday(tz);
    const inRange = await auditFilterChoices(BOSS, { ...base, from: today, to: today, module: "" });
    expect(inRange.modules).toEqual(expect.arrayContaining([A, B]));
    const longAgo = await auditFilterChoices(BOSS, { ...base, from: "2001-01-01", to: "2001-01-31", module: "" });
    expect(longAgo.modules).not.toContain(A);
    // a module named in the address that has no entries stays in the list, so the box shows what is applied
    expect((await auditFilterChoices(BOSS, { ...base, from: "2001-01-01", to: "2001-01-31", module: "Pinned" })).modules).toEqual(["Pinned"]);
  });
  it("the people list has every account — the Developer's marked as one", async () => {
    const { users } = await auditFilterChoices(BOSS, { ...base, module: "" });
    expect(users.find((u) => u.id === dev.id)).toMatchObject({ developer: true, name: dev.fullName });
    expect(users.find((u) => u.id === rec.id)).toMatchObject({ developer: false });
  });
});

describe("filter: the dates (calendar days in the hotel's time zone)", () => {
  const M = `${MOD}Dates`;
  beforeAll(async () => {
    // 2026-03-10 23:59 and 2026-03-11 00:00 and 00:30 (before the 04:00 business-day start: its business day is still the 10th) and 2026-03-11 23:59
    await put({ at: day("2026-03-10", 23 * 60 + 59), action: "d.10.2359", module: M, user: rec });
    await put({ at: day("2026-03-11", 0), action: "d.11.0000", module: M, user: rec });
    await put({ at: day("2026-03-11", 30), action: "d.11.0030", module: M, user: rec });
    await put({ at: day("2026-03-11", 23 * 60 + 59), action: "d.11.2359", module: M, user: rec });
    await put({ at: day("2026-03-12", 0), action: "d.12.0000", module: M, user: rec });
  });
  const q = (from: string, to: string) => search(M, { from, to }).then((p) => p.rows.map((r) => r.action));

  it("one day is that calendar day in the hotel's time zone, from 00:00 to 23:59", async () => {
    expect(await q("2026-03-11", "2026-03-11")).toEqual(["d.11.2359", "d.11.0030", "d.11.0000"]);
    expect(await q("2026-03-10", "2026-03-10")).toEqual(["d.10.2359"]);
    expect(await q("2026-03-12", "2026-03-12")).toEqual(["d.12.0000"]);
  });
  it("a night entry (00:30, business day of the day before) is found by the calendar day shown on its time", async () => {
    expect(await q("2026-03-11", "2026-03-11")).toContain("d.11.0030");
    expect(await q("2026-03-10", "2026-03-10")).not.toContain("d.11.0030");
  });
  it("a range is inclusive at both ends, newest first", async () => {
    expect(await q("2026-03-10", "2026-03-11")).toEqual(["d.11.2359", "d.11.0030", "d.11.0000", "d.10.2359"]);
    expect(await q("2026-03-10", "2026-03-12")).toHaveLength(5);
  });
  it("a day with nothing is empty", async () => {
    expect(await q("2026-03-20", "2026-03-20")).toEqual([]);
  });
  it("the address's dates: swapped when backwards, default to the last 7 days, ignored when not dates, never longer than 366 days", () => {
    const today = "2026-10-14";
    expect(parseAuditFilter({ from: "2026-03-12", to: "2026-03-10" }, today).filter).toMatchObject({ from: "2026-03-10", to: "2026-03-12" });
    expect(parseAuditFilter({}, today).filter).toMatchObject({ from: addDays(today, -(AUDIT_DEFAULT_DAYS - 1)), to: today });
    expect(parseAuditFilter({ from: "yesterday", to: "2026-13-45" }, today).filter).toMatchObject({ from: addDays(today, -6), to: today });
    expect(parseAuditFilter({ to: "2026-03-10" }, today).filter).toMatchObject({ from: "2026-03-04", to: "2026-03-10" });
    const wide = parseAuditFilter({ from: "2000-01-01", to: "2026-10-14" }, today);
    expect(wide.rangeShortened).toBe(true);
    expect(wide.filter).toMatchObject({ to: "2026-10-14", from: addDays("2026-10-14", -(AUDIT_MAX_DAYS - 1)) });
    expect(parseAuditFilter({ from: "2025-10-14", to: "2026-10-14" }, today).rangeShortened).toBe(false);
  });
  it("the other parts of the address are made safe: odd values fall back, text is bounded, the page is held between 1 and the deepest", () => {
    const today = "2026-10-14";
    const p = (raw: Record<string, string | string[] | undefined>) => parseAuditFilter(raw, today).filter;
    expect(p({ who: "developer" }).actor).toBe("DEVELOPER");
    expect(p({ who: "root" }).actor).toBe("ALL");
    expect(p({ who: ["STAFF", "x"] }).actor).toBe("STAFF");
    expect(p({ action: `a${"x".repeat(500)}\u0000\n` }).action.length).toBeLessThanOrEqual(80);
    expect(p({ action: "ab\u0000c" }).action).not.toContain("\u0000");
    expect(p({ page: "0" }).page).toBe(1);
    expect(p({ page: "-4" }).page).toBe(1);
    expect(p({ page: "abc" }).page).toBe(1);
    expect(p({ page: "3.9" }).page).toBe(3);
    expect(p({ page: "999999" }).page).toBe(AUDIT_MAX_PAGE);
  });
});

// ───────────────────────────────────────────── 3. bounded, newest first ─────────────────────────────────────────────
describe("every search is bounded and newest first", () => {
  const M = `${MOD}Pages`;
  const N = 120;
  beforeAll(async () => {
    // 120 entries one minute apart — and five of them at the very same instant, to prove the order is stable across pages.
    for (let i = 0; i < N; i++) {
      const minute = 6 * 60 + (i >= 100 && i < 105 ? 100 : i);
      await put({ at: day("2026-03-15", minute), action: `pg.${String(i).padStart(3, "0")}`, module: M, user: rec });
    }
  });
  const pageOf = (n: number) => search(M, { from: "2026-03-15", to: "2026-03-15", page: n });

  it("a page holds at most 50 entries, with 'previous' and 'next' known without counting the table", async () => {
    const [p1, p2, p3] = [await pageOf(1), await pageOf(2), await pageOf(3)];
    expect(AUDIT_PAGE_SIZE).toBe(50);
    expect(p1.rows).toHaveLength(50);
    expect(p2.rows).toHaveLength(50);
    expect(p3.rows).toHaveLength(20);
    expect([p1.hasPrevious, p1.hasNext]).toEqual([false, true]);
    expect([p2.hasPrevious, p2.hasNext]).toEqual([true, true]);
    expect([p3.hasPrevious, p3.hasNext]).toEqual([true, false]);
    expect(p1.limitReached).toBe(false);
    // no total of the table is ever worked out
    expect(Object.keys(p1).sort()).toEqual(["filter", "hasNext", "hasPrevious", "limitReached", "pageSize", "rows", "timezone"]);
  });
  it("newest first across the pages, every entry once, none lost", async () => {
    const all = [...(await pageOf(1)).rows, ...(await pageOf(2)).rows, ...(await pageOf(3)).rows];
    expect(new Set(all.map((r) => r.id)).size).toBe(N);
    expect(all.map((r) => r.action).sort()).toEqual(Array.from({ length: N }, (_, i) => `pg.${String(i).padStart(3, "0")}`));
    for (let i = 1; i < all.length; i++) expect(all[i - 1].at.getTime()).toBeGreaterThanOrEqual(all[i].at.getTime());
    expect(all[0].action).toBe("pg.119");
    expect(all[N - 1].action).toBe("pg.000");
  });
  it("past the last page is just empty", async () => {
    const p = await pageOf(4);
    expect(p.rows).toEqual([]);
    expect([p.hasNext, p.hasPrevious]).toEqual([false, true]);
  });
  it("a mistake in the page number is held inside the limits", async () => {
    expect((await search(M, { from: "2026-03-15", to: "2026-03-15", page: 0 })).filter.page).toBe(1);
    expect((await search(M, { from: "2026-03-15", to: "2026-03-15", page: Number.NaN })).filter.page).toBe(1);
    expect((await search(M, { from: "2026-03-15", to: "2026-03-15", page: 10 ** 9 })).filter.page).toBe(AUDIT_MAX_PAGE);
  });
  it("the deepest page is reached and says so: beyond 10,000 entries the person must narrow the dates", async () => {
    const D = `${MOD}Deep`;
    // 10,010 entries in one day (inserts only), one second apart
    await db.$executeRaw`INSERT INTO "audit_logs" ("id", "actorLabel", "actorType", "action", "entityType", "businessDate", "createdAt")
      SELECT ${`deep-${TAG}-`}::text || g::text, 'Deep', 'STAFF', 'deep.entry', ${D}::text, DATE '2026-03-16', TIMESTAMP '2026-03-16 03:00:00' + g * interval '1 second' FROM generate_series(1, 10010) g`;
    const deep = (n: number) => search(D, { from: "2026-03-16", to: "2026-03-16", page: n });
    const last = await deep(AUDIT_MAX_PAGE);
    expect(last.rows).toHaveLength(50);
    expect(last.hasNext).toBe(false);
    expect(last.limitReached).toBe(true);
    const before = await deep(AUDIT_MAX_PAGE - 1);
    expect(before.hasNext).toBe(true);
    expect(before.limitReached).toBe(false);
    expect((await deep(10 ** 6)).filter.page).toBe(AUDIT_MAX_PAGE);
  }, 60_000);
});

// ───────────────────────────────────────────── 4. nothing secret, failures, no controls ─────────────────────────────────────────────
describe("secrets are never shown", () => {
  const secretRow = { password: "hunter2", newPassword: "hunter3", nested: { apiKey: "k-123456", token: "tok-abc", keep: "visible" }, list: [{ pinHash: "xyz", name: "n" }], Authorization: "Bearer zzz", note: "ok" };
  const SECRETS = ["hunter2", "hunter3", "k-123456", "tok-abc", "xyz", "Bearer zzz"];

  it("a row that holds secrets (written by something that did not hide them) comes back hidden", async () => {
    const M = `${MOD}Secret`;
    await put({ action: "s.row", module: M, user: rec, before: secretRow, after: secretRow });
    const row = (await search(M, { from: auditToday(tz), to: auditToday(tz) })).rows[0];
    const text = JSON.stringify(row);
    for (const s of SECRETS) expect(text).not.toContain(s);
    expect(row.after).toMatchObject({ password: "[hidden]", nested: { apiKey: "[hidden]", token: "[hidden]", keep: "visible" }, note: "ok" });
    expect((row.before as { list: { pinHash: string; name: string }[] }).list[0]).toEqual({ pinHash: "[hidden]", name: "n" });
  });

  it("when a row is drawn they are hidden again — even if the service handed them over", () => {
    const shown = showJson(secretRow, makeT("en", null))!;
    for (const s of SECRETS) expect(shown).not.toContain(s);
    expect(shown).toContain("[hidden]");
    expect(shown).toContain("visible");
    expect(showJson(null, makeT("en", null))).toBeNull();
    expect(showJson(undefined, makeT("en", null))).toBeNull();
    const huge = showJson({ big: "x".repeat(50_000) }, makeT("en", null))!;
    expect(huge.length).toBeLessThan(8200);
    expect(huge).toContain("(shortened)");
  });
});

describe("failures are told apart from what worked", () => {
  it("names ending _failed and developer.denied are failures; the rest are not", () => {
    for (const a of ["auth.login_failed", "user.create_failed", "user.update_failed", "user.password_reset_failed", "user.permission_change_failed", "user.delete_failed", "developer.denied", "withdrawal.refused"]) {
      expect(isFailureAction(a), a).toBe(true);
    }
    for (const a of ["auth.login", "user.created", "user.deleted", "developer.denied.not", "payment.recorded", "cash_handover.rejected", "inventory.waste_rejected", "failed.attempt", "developer.viewed", "developer.inspected"]) {
      expect(isFailureAction(a), a).toBe(false);
    }
  });

  it("an entry that says it did not work (ok: false — a Developer's inspection that failed) is a failure too", async () => {
    expect(isFailureEntry("developer.inspected", { ok: false, problem: "No such person." })).toBe(true);
    expect(isFailureEntry("developer.inspected", { ok: true, right: "audit.view" })).toBe(false);
    expect(isFailureEntry("developer.inspected", null)).toBe(false);
    expect(isFailureEntry("payment.recorded", { ok: "no" })).toBe(false);
    expect(isFailureEntry("auth.login_failed", null)).toBe(true);
    const M = `${MOD}Inspect`;
    await put({ action: "developer.inspected", module: M, user: dev, type: "DEVELOPER", role: "DEVELOPER", after: { ok: false, right: "x.y", problem: "That person was not found." } });
    const row = (await search(M, { from: auditToday(tz), to: auditToday(tz) })).rows[0];
    expect(row).toMatchObject({ ok: false, problem: "That person was not found." });
  });

  it("each row carries its result, and the reason and the problem written with it", async () => {
    const M = `${MOD}Fail`;
    const dayNow = auditToday(tz);
    await put({ action: "user.update_failed", module: M, user: dev, type: "DEVELOPER", role: "DEVELOPER", entityId: "u1", after: { roleId: "r1", reason: "Fixing the wrong role", error: "That role is for the system only.", code: "FORBIDDEN" } });
    await put({ action: "user.permission_changed", module: M, user: dev, type: "DEVELOPER", role: "DEVELOPER", after: { permission: "x", granted: true, reason: "Support ticket 42" } });
    await put({ action: "developer.denied", module: M, user: dev, type: "DEVELOPER", role: "DEVELOPER", after: { kind: "page", needs: ["finance.manage"] } });
    await put({ action: "auth.login", module: M, user: rec });
    const rows = Object.fromEntries((await search(M, { from: dayNow, to: dayNow })).rows.map((r) => [r.action, r]));
    expect(rows["user.update_failed"]).toMatchObject({ ok: false, reason: "Fixing the wrong role", problem: "That role is for the system only." });
    expect(rows["developer.denied"]).toMatchObject({ ok: false, reason: null, problem: null });
    expect(rows["user.permission_changed"]).toMatchObject({ ok: true, reason: "Support ticket 42", problem: null });
    expect(rows["auth.login"]).toMatchObject({ ok: true, reason: null });
  });

  it("an action has plain words: the activity list's, ours for the failures and the audit trail, the readable name otherwise", () => {
    expect(auditActionWords("reservation.checked_in")).toBe("checked a guest in");
    expect(auditActionWords("auth.login_failed")).toBe("Failed sign-in (not signed in)"); // a failed sign-in is nobody's action (the entry is the system's): the words stand alone
    expect(auditActionWords("developer.denied")).toMatch(/refused/);
    expect(auditActionWords("developer.viewed")).toBe("looked at a page");
    expect(auditActionWords("something.new_thing")).toBe("something · new thing");
  });
});

describe("read-only: no way to change an entry", () => {
  const row = (over: Partial<AuditRow>): AuditRow => ({
    id: randomUUID(), at: new Date("2026-03-15T09:00:00Z"), businessDate: "2026-03-15", actorType: "STAFF", actorRole: "RECEPTIONIST", roleName: "Receptionist",
    actorName: "Asha", userId: "u", action: "payment.recorded", entityType: "Payment", entityId: "pay_123456789012345", ok: true, reason: null, problem: null,
    before: null, after: { amount: 1000 }, ipAddress: "41.1.2.3", ...over,
  });
  const draw = (rows: AuditRow[]) => renderToStaticMarkup(createElement(AuditList, { rows, t: makeT("en", null), timezone: "Africa/Dar_es_Salaam" }));

  it("the list holds no button, form, input, link or script — nothing to edit, delete, restore or send", () => {
    const html = draw([row({}), row({ actorType: "DEVELOPER", actorName: "Dev", action: "user.update_failed", ok: false, problem: "No." })]);
    for (const tag of ["<button", "<form", "<input", "<textarea", "<select", "<a ", "<script", "contenteditable", "onclick"]) expect(html.toLowerCase(), tag).not.toContain(tag);
    expect(html).not.toMatch(/\b(delete|remove|edit|restore|undo)\b/i);
  });

  it("a Developer's entry is marked (type badge, purple bar) and a failed one says Failed", () => {
    const html = draw([row({ actorType: "DEVELOPER", actorName: "Dev One", roleName: "Developer (super user)" }), row({ actorName: "Asha" }), row({ actorType: "SYSTEM", actorName: null }), row({ actorType: "WEBSITE", actorName: "website" }), row({ ok: false, action: "auth.login_failed" })]);
    expect(html.match(/data-actor-type="DEVELOPER"/g)?.length).toBe(2); // the entry and its badge
    expect(html).toContain("border-l-fuchsia-600");
    expect(html).toContain("bg-fuchsia-700");
    expect(html.match(/data-result="failed"/g)?.length).toBe(1);
    expect(html.match(/data-result="ok"/g)?.length).toBe(4);
    for (const w of ["Developer", "Staff", "System", "Website", "Failed", "Done"]) expect(html).toContain(w);
  });

  it("the time is drawn in the hotel's time zone, with the exact time inside", () => {
    const html = draw([row({ at: new Date("2026-03-15T21:30:00Z") })]); // 00:30 on the 16th in Dar es Salaam
    expect(html).toContain("16 Mar, 00:30");
    expect(html).toMatch(/16 Mar 2026,? 00:30:00/);
  });

  it("an entry with secrets in it is drawn without them", () => {
    const html = draw([row({ before: { password: "hunter2" }, after: { apiKey: "k-1", ok: "yes" } })]);
    expect(html).not.toContain("hunter2");
    expect(html).not.toContain("k-1");
    expect(html).toContain("[hidden]");
  });

  it("the service only ever reads: no update, delete, upsert, insert or SQL write on the table", () => {
    const src = readFileSync("src/server/services/audit-trail.ts", "utf8");
    expect(src).not.toMatch(/\.(update|updateMany|upsert|delete|deleteMany|create|createMany)\(/);
    expect(src).not.toMatch(/\$(execute|queryRaw)/);
    expect(src).not.toMatch(/\baudit\(/); // it writes no audit entry at all (a Developer's visit is noted by the layout)
    const page = readFileSync("src/app/staff/(app)/audit/page.tsx", "utf8");
    expect(page).not.toMatch(/use server|<form[^>]*method="post"/i);
  });
});

// ───────────────────────────────────────────── 5. a viewer who may not see Developer actions ─────────────────────────────────────────────
describe("developer actions can be left out for a viewer who may not see them", () => {
  const M = `${MOD}Hide`;
  beforeAll(async () => {
    await put({ user: dev, type: "DEVELOPER", role: "DEVELOPER", action: "h.dev", module: M });
    await put({ user: rec, action: "h.staff", module: M });
    await put({ user: dev, type: "none", action: "h.dev.legacy", module: M });
  });
  it("the Boss and the MD (audit.view) see them; the filter used for anyone who may not leaves them out, typed or not", async () => {
    const f = { ...base, module: M, from: auditToday(tz), to: auditToday(tz) };
    const names = async (developers: boolean) => (await db.auditLog.findMany({ where: auditWhere(f, { developers, timezone: tz }) })).map((r) => r.action).sort();
    expect(await names(true)).toEqual(["h.dev", "h.dev.legacy", "h.staff"]);
    expect(await names(false)).toEqual(["h.staff"]);
    for (const role of ["OWNER", "ADMIN"] as const) expect(actions(await queryAuditTrail(viewerOf(role), f)).sort(), role).toEqual(["h.dev", "h.dev.legacy", "h.staff"]);
  });
});


// ───────────────────────────────────────────── 6. the Developer's Audit page (owner, 2026-10-17) ─────────────────────────────────────────────
describe("the Developer's Audit page: the address, the chips, the search", () => {
  const today = "2026-10-17";
  const p = (raw: Record<string, string | string[] | undefined>) => parseDeveloperAuditFilter(raw, today);

  it("the three chips: Everything, Developer actions, Failures — anything else is Everything", () => {
    expect(p({})).toMatchObject({ view: "all", filter: { actor: "ALL", failures: false } });
    expect(p({ view: "developer" })).toMatchObject({ view: "developer", filter: { actor: "DEVELOPER", failures: false } });
    expect(p({ view: "DEVELOPER" }).view).toBe("developer");
    expect(p({ view: "failures" })).toMatchObject({ view: "failures", filter: { actor: "ALL", failures: true } });
    for (const bad of ["staff", "", "all ", "'; drop table", ["failures", "developer"] as unknown as string]) expect(p({ view: bad }).view, String(bad)).toMatch(/^(all|failures)$/);
  });

  it("the search words are plain text from the address: trimmed, no control characters, at most 80 letters", () => {
    expect(p({ q: "  Neema  " }).filter.q).toBe("Neema");
    expect(p({ q: "ab\u0000c\n" }).filter.q).not.toMatch(/[\u0000-\u001f]/);
    expect(p({ q: "x".repeat(500) }).filter.q!.length).toBe(80);
    expect(p({ q: "   " }).filter.q).toBeUndefined();
    expect(p({}).filter.q).toBeUndefined();
  });

  it("only view, q, from, to and page are read — the Boss's own parameters (who, user, action, module) change nothing here", () => {
    expect(p({ who: "STAFF", user: "someone", action: "payment", module: "Payment" }).filter).toMatchObject({ actor: "ALL", userId: "", action: "", module: "" });
  });

  it("the dates keep the same bounds as the Boss's page: last 7 days, swapped when backwards, never more than a year, never deeper than the last page", () => {
    expect(p({}).filter).toMatchObject({ from: addDays(today, -(AUDIT_DEFAULT_DAYS - 1)), to: today, page: 1 });
    expect(p({ from: "2026-10-10", to: "2026-10-01" }).filter).toMatchObject({ from: "2026-10-01", to: "2026-10-10" });
    const wide = p({ from: "2000-01-01", to: today });
    expect(wide.rangeShortened).toBe(true);
    expect(wide.filter.from).toBe(addDays(today, -(AUDIT_MAX_DAYS - 1)));
    expect(p({ page: "999999" }).filter.page).toBe(AUDIT_MAX_PAGE);
    expect(p({ page: "-3" }).filter.page).toBe(1);
  });
});

describe("the Developer's Audit page: what it lists", () => {
  const M = `${MOD}DevPage`;
  const DEVV = viewerOf("DEVELOPER");
  let acting: string;
  const dayNow = () => auditToday(tz);
  const q = (over: Partial<AuditFilter> = {}) => queryAuditTrail(DEVV, { ...base, module: M, from: dayNow(), to: dayNow(), ...over });
  const names = async (over: Partial<AuditFilter> = {}) => (await q(over)).rows.map((r) => r.action).sort();
  const rowOf = async (action: string) => (await q()).rows.find((r) => r.action === action)!;
  const t = makeT("en", null);

  beforeAll(async () => {
    acting = `${dev.fullName} (Developer) as ${rec.fullName} (Receptionist)`;
    await put({ user: dev, type: "DEVELOPER", role: "DEVELOPER", action: "developer.viewed", module: M, entityId: "/staff/finance", after: { path: "/staff/finance" } });
    // A Developer's work while working as Reception: the Developer's own id, the "as" label, and who it was done as.
    await put({ user: dev, label: acting, type: "DEVELOPER", role: "DEVELOPER", action: "reservation.checked_in", module: M, entityId: "res1", after: { actingAs: { id: rec.id, name: rec.fullName, role: "Receptionist" }, room: "101" } });
    await put({ user: rec, action: "reservation.created", module: M, entityId: "res2" });
    // Nobody but a Developer's entry can say "acting as": a staff row that carries it is read as plain staff work, and a half-written one is ignored.
    await put({ user: rec, action: "staff.forged", module: M, after: { actingAs: { id: dev.id, name: "Boss", role: "Owner" } } });
    await put({ user: dev, type: "DEVELOPER", role: "DEVELOPER", action: "dev.half_written", module: M, after: { actingAs: { name: "No id" } } });
    await put({ user: rec, action: "user.update_failed", module: M, after: { error: "That role is for the system only." } });
    // The sign-in page's own entry for a failed sign-in: nobody is signed in.
    await audit(db, { label: "Sign-in page (not signed in)" }, { action: "auth.login_failed", entityType: M, entityId: rec.id, after: { accountType: "STAFF", accountExists: true, reasonKind: "bad password" } });
    await put({ user: dev, type: "DEVELOPER", role: "DEVELOPER", action: "developer.work_as_refused", module: M, after: { reason: "That person is a Developer account." } });
    await put({ user: dev, type: "DEVELOPER", role: "DEVELOPER", action: "developer.inspected", module: M, after: { ok: false, problem: "That person was not found." } });
    await put({ user: rec, action: "payment.noted", module: M, before: { password: "hunter2" }, after: { note: "ok" } });
  });

  it("Everything lists all of it, newest first", async () => {
    expect(await names()).toEqual(["auth.login_failed", "dev.half_written", "developer.inspected", "developer.viewed", "developer.work_as_refused", "payment.noted", "reservation.checked_in", "reservation.created", "staff.forged", "user.update_failed"]);
  });

  it("Developer actions: only a Developer's — the work done while working as someone included", async () => {
    expect(await names({ actor: "DEVELOPER" })).toEqual(["dev.half_written", "developer.inspected", "developer.viewed", "developer.work_as_refused", "reservation.checked_in"]);
  });

  it("Failures: a failed attempt, a refusal and an entry that says ok: false — not what worked", async () => {
    expect(await names({ failures: true })).toEqual(["auth.login_failed", "developer.inspected", "developer.work_as_refused", "user.update_failed"]);
    for (const r of (await q({ failures: true })).rows) expect(r.ok, r.action).toBe(false);
    // the same rule as the badge: everything the database filter lets through is a failure, and every failure is let through
    const everything = (await q()).rows;
    expect(everything.filter((r) => !r.ok).map((r) => r.action).sort()).toEqual(await names({ failures: true }));
  });

  it("a refused attempt to work as someone is a failure by its name; so is every name that ends _failed, _refused, .denied or .refused", () => {
    for (const a of ["developer.work_as_refused", "withdrawal.refused", "developer.denied", "auth.login_failed"]) expect(isFailureAction(a), a).toBe(true);
    for (const a of ["developer.work_as_started", "developer.work_as_ended", "user.suspended", "user.reactivated", "user.signed_out_everywhere", "developer.business_viewed"]) expect(isFailureAction(a), a).toBe(false);
  });

  it("Failures can be narrowed to the Developer's own", async () => {
    expect(await names({ failures: true, actor: "DEVELOPER" })).toEqual(["developer.inspected", "developer.work_as_refused"]);
  });

  it("a row written while working as someone says so: the Developer's own name, 'as' the person, and who it was done as", async () => {
    const row = await rowOf("reservation.checked_in");
    expect(row).toMatchObject({ actorType: "DEVELOPER", userId: dev.id, actorName: acting, actingAs: { id: rec.id, name: rec.fullName, role: "Receptionist" } });
    expect(auditWho(row, t)).toBe(acting);
    expect(auditSentence(row, t)).toBe(`Developer (as ${rec.fullName}) checked a guest in.`);
  });

  it("only a Developer's entry can carry 'acting as' — a staff row that has it, or a half-written one, does not", async () => {
    expect((await rowOf("staff.forged")).actingAs).toBeNull();
    expect((await rowOf("dev.half_written")).actingAs).toBeNull();
    expect((await rowOf("developer.viewed")).actingAs).toBeNull();
    expect((await rowOf("reservation.created")).actingAs ?? null).toBeNull();
  });

  it("the Developer's own entries read 'Name (Developer)'; staff read 'Name (Role)'; the sentence names the page that was looked at", async () => {
    const viewed = await rowOf("developer.viewed");
    expect(auditWho(viewed, t)).toBe(`${dev.fullName} (Developer)`);
    expect(auditSentence(viewed, t)).toBe("Developer looked at a page (/staff/finance).");
    const staff = await rowOf("reservation.created");
    expect(auditWho(staff, t)).toMatch(new RegExp(`^${rec.fullName} \\(.+\\)$`));
    expect(auditSentence(staff, t)).toBe(`${rec.fullName} made a booking.`);
  });

  it("a failed sign-in is shown as System: the system's entry about an account someone tried, with no one's name on it", async () => {
    const row = await rowOf("auth.login_failed");
    expect(row).toMatchObject({ actorType: "SYSTEM", userId: null, ok: false });
    expect(auditWho(row, t)).toBe("System");
    expect(auditSentence(row, t)).toBe("Failed sign-in (not signed in).");
    expect(await names({ actor: "SYSTEM" })).toEqual(["auth.login_failed"]);
  });

  it("search: by who (the name written with the entry), by what (its code or its plain words), by where (the kind of record or its id)", async () => {
    // who
    expect(await names({ q: dev.fullName })).toEqual(["dev.half_written", "developer.inspected", "developer.viewed", "developer.work_as_refused", "reservation.checked_in"]);
    expect(await names({ q: rec.fullName.toUpperCase() })).toEqual(["payment.noted", "reservation.checked_in", "reservation.created", "staff.forged", "user.update_failed"]);
    // what: a part of the code, the code written as words, and the plain words
    expect(await names({ q: "payment.noted" })).toEqual(["payment.noted"]);
    expect(await names({ q: "checked in" })).toEqual(["reservation.checked_in"]);
    expect(await names({ q: "login failed" })).toEqual(["auth.login_failed"]);
    expect(await names({ q: "looked at a page" })).toEqual(["developer.viewed"]);
    expect(await names({ q: "refused when trying to work" })).toEqual(["developer.work_as_refused"]);
    // where
    expect(await names({ q: "/staff/finance" })).toEqual(["developer.viewed"]);
    expect(await names({ q: "res2" })).toEqual(["reservation.created"]);
    expect((await names({ q: M })).length).toBe(10);
    // nothing matches nothing; a % or _ is just a letter
    expect(await names({ q: "zzz-no-such-thing" })).toEqual([]);
    expect(await names({ q: "%" })).toEqual([]);
    expect(await names({ q: "pay_ent" })).toEqual([]);
  });

  it("search and chips work together: the chip narrows, the words narrow further", async () => {
    expect(await names({ actor: "DEVELOPER", q: "inspected" })).toEqual(["developer.inspected"]);
    expect(await names({ failures: true, q: rec.fullName })).toEqual(["user.update_failed"]);
    expect(await names({ failures: true, actor: "DEVELOPER", q: rec.fullName })).toEqual([]);
  });

  it("the Boss's page, which never sets the new fields, lists exactly what it always listed", async () => {
    const f = { ...base, module: M, from: dayNow(), to: dayNow() };
    expect(f).not.toHaveProperty("q");
    expect((await queryAuditTrail(BOSS, f)).rows).toHaveLength(10);
  });

  it("the list is drawn: a dot, the sentence, who · date · code, and badges — and nothing in it can be pressed", async () => {
    const rows = (await q()).rows;
    const html = renderToStaticMarkup(createElement(DeveloperAuditList, { rows, t, timezone: tz }));
    expect(html).toContain(acting);
    expect(html).toContain(`Developer (as ${rec.fullName}) checked a guest in.`);
    expect(html).toContain("Failed sign-in (not signed in).");
    expect(html).not.toContain("Sign-in page (not signed in)");
    expect(html.match(/data-entry/g)).toHaveLength(10);
    for (const w of ["Developer", "Succeeded", "Failed", "auth.login_failed", "developer.viewed"]) expect(html).toContain(w);
    // red for what failed (the Developer's refusals included), gold for the Developer, blue for staff, grey for the system
    expect(html.match(/data-dot="failed"/g)).toHaveLength(4);
    expect(html.match(/data-dot="DEVELOPER"/g)).toHaveLength(3);
    expect(html.match(/data-dot="STAFF"/g)).toHaveLength(3);
    expect(html.match(/data-badge="developer"/g)).toHaveLength(5);
    // the entry that was done as someone names who
    expect(html).toContain(`data-acting-as="${rec.id}"`);
    for (const tag of ["<button", "<form", "<input", "<textarea", "<select", "<a ", "<script", "contenteditable", "onclick"]) expect(html.toLowerCase(), tag).not.toContain(tag);
  });

  it("secrets are hidden when it is drawn", async () => {
    const html = renderToStaticMarkup(createElement(DeveloperAuditList, { rows: (await q()).rows, t, timezone: tz }));
    expect(html).not.toContain("hunter2");
    expect(html).toContain("[hidden]");
  });

  it("the page and its list hold no form that posts, no server action, and no link out of the console", () => {
    const page = readFileSync("src/app/staff/(app)/developer/audit/page.tsx", "utf8");
    const list = readFileSync("src/app/staff/(app)/developer/audit/developer-audit-rows.tsx", "utf8");
    for (const src of [page, list]) expect(src).not.toMatch(/use server|method="post"|\.(create|update|delete|upsert)\(/i);
    expect(list).not.toMatch(/<form|<button|<input|href=/);
    expect([...page.matchAll(/method="(\w+)"/g)].map((m) => m[1])).toEqual(["get"]);
    for (const m of page.matchAll(/href=\{?["`]?([^"`}\s]+)/g)) expect(m[1], m[1]).toMatch(/^(\?\$\{|\/staff\/developer\/audit|addressOf)/);
  });
});

describe("the Developer's Audit page: written by the system itself while working as someone", () => {
  const M = `${MOD}WorkAs`;
  const t = makeT("en", null);
  const DEVV = viewerOf("DEVELOPER");

  it("an entry the staff member's action writes during Work as is the Developer's — and one written by someone else at the same moment is left alone", async () => {
    const roleName = (await db.role.findUniqueOrThrow({ where: { code: "RECEPTIONIST" } })).name;
    browser.reset();
    await makeSession(dev.id);
    await db.session.updateMany({ where: { userId: dev.id }, data: { workAsUserId: rec.id, workAsStartedAt: new Date() } });
    try {
      await audit(db, { userId: rec.id, label: rec.fullName }, { action: "reservation.checked_in", entityType: M, entityId: "w1", after: { room: "205" } });
      await audit(db, { userId: mgr.id, label: mgr.fullName }, { action: "reservation.created", entityType: M, entityId: "w2" });
    } finally {
      browser.reset(); // (the write fence refuses session changes while the browser is working as someone)
      await db.session.updateMany({ where: { userId: dev.id }, data: { workAsUserId: null, workAsStartedAt: null } });
    }
    const label = `${dev.fullName} (Developer) as ${rec.fullName} (${roleName})`;
    const today = auditToday(tz);
    const rows = (await queryAuditTrail(DEVV, { ...base, module: M, from: today, to: today })).rows;
    const done = rows.find((r) => r.entityId === "w1")!;
    expect(done).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", actorName: label, actingAs: { id: rec.id, name: rec.fullName, role: roleName }, ok: true });
    expect(done.after).toMatchObject({ room: "205", actingAs: { id: rec.id } });
    expect(auditWho(done, t)).toBe(label);
    const other = rows.find((r) => r.entityId === "w2")!;
    expect(other).toMatchObject({ userId: mgr.id, actorType: "STAFF", actorName: mgr.fullName });
    expect(other.actingAs ?? null).toBeNull();
    // under "Developer actions" for the Developer; not under Reception's own name
    expect((await queryAuditTrail(DEVV, { ...base, module: M, from: today, to: today, actor: "DEVELOPER" })).rows.map((r) => r.entityId)).toEqual(["w1"]);
    expect((await queryAuditTrail(DEVV, { ...base, module: M, from: today, to: today, userId: rec.id })).rows).toEqual([]);
  });
});

describe("the Developer's Audit page: who may open it", () => {
  const open = (search: Record<string, string> = {}) => DeveloperAuditPage({ searchParams: Promise.resolve(search), params: Promise.resolve({}) } as never);

  it("the Developer opens it; the Boss, the MD, a manager, Finance and Reception are sent to 'no access'; nobody signed in goes to the sign-in", async () => {
    await makeSession(dev.id);
    expect(await redirectOf(() => open({ view: "failures", q: "login" }))).toBeNull();
    for (const u of [boss, md, mgr, fin, rec]) {
      browser.reset();
      await makeSession(u.id);
      expect(await redirectOf(() => open()), u.fullName).toBe("/staff/forbidden");
    }
    browser.reset();
    expect(await redirectOf(() => open())).toBe("/staff/login");
  });

  it("the whole page: title, how to read it, the three chips (the chosen one marked), the search box with its dates, and the list", async () => {
    browser.reset();
    await makeSession(dev.id);
    const draw = async (search: Record<string, string>) => renderToStaticMarkup((await open(search)) as never);
    const html = await draw({ view: "failures", q: "login" });
    expect(html).toContain("Audit");
    expect(html).toContain("The permanent diary of the system");
    // The honest wording: the database refuses it, and the one change the system makes to an older line is said out loud.
    expect(html).toContain("the database refuses it");
    expect(html).toContain("marking a cancelled check-in as cancelled");
    expect(html).not.toContain("not even from the database");
    expect(html).toContain("How to read this page");
    expect(html).toMatch(/<strong[^>]*>Developer<\/strong> tag mean it was done by you/);
    for (const chip of ["Everything", "Developer actions", "Failures"]) expect(html).toContain(chip);
    expect(html.match(/aria-current="page"/g)).toHaveLength(1);
    expect(html).toMatch(/aria-current="page"[^>]*>Failures</);
    expect(html).toContain('placeholder="Search who, what or where…"');
    expect(html).toContain('name="q"');
    expect(html).toContain('value="login"');
    expect(html.match(/type="date"/g)).toHaveLength(2);
    expect(html).toMatch(/<form[^>]*method="get"/);
    expect(html).toContain('name="view" value="failures"');
    expect(html).not.toMatch(/method="post"/i);
    // a chip keeps the search words and the dates
    expect(html).toMatch(/href="\?from=[^"]+&amp;to=[^"]+&amp;q=login"/);
    // the plain page: no search, no chip
    const plain = await draw({});
    expect(plain).not.toContain('name="view"');
    expect(plain).toMatch(/aria-current="page"[^>]*>Everything</);
  });

  it("a Developer working as someone is sent to that person's own home — the console and the Work as world are kept apart", async () => {
    browser.reset();
    await makeSession(dev.id);
    await db.session.updateMany({ where: { userId: dev.id }, data: { workAsUserId: rec.id, workAsStartedAt: new Date() } });
    try {
      expect(await redirectOf(() => open())).toBe(staffHome(new Set(DEFAULT_ROLES.RECEPTIONIST.permissions)));
    } finally {
      browser.reset();
      await db.session.updateMany({ where: { userId: dev.id }, data: { workAsUserId: null, workAsStartedAt: null } });
    }
  });
});

// ═════════════════════════════ a Developer's trail shows only what he changed ═════════════════════════════
describe("the Audit pages show a Developer's CHANGES only (owner, 2026-10-19: no track for signing in, looking or a refused try)", () => {
  const NOISE = ["developer.viewed", "auth.login", "developer.denied", "user.suspend_failed", "developer.work_as_started", "developer.work_as_ended", "developer.work_as_notice", "developer.exported", "developer.inspected"];
  const CHANGES = ["menu.price_changed", "user.suspended", "translation.saved", "reservation.created"];

  it("with changesOnly (what the pages ask for) his sign-ins, looks, refused tries and Work as notes are left out; his changes, staff and system rows stay; the plain search still has everything", async () => {
    const m = `${MOD}Changes`;
    const at = new Date("2026-03-12T09:00:00Z");
    for (const action of NOISE) await put({ at, user: dev, type: "DEVELOPER", action, module: m });
    for (const action of CHANGES) await put({ at, user: dev, type: "DEVELOPER", action, module: m });
    await put({ at, user: rec, type: "STAFF", action: "auth.login", module: m });
    await put({ at, user: null, type: "SYSTEM", action: "cron.ran", module: m });
    const day = { from: "2026-03-12", to: "2026-03-12" };
    for (const viewer of [BOSS, viewerOf("ADMIN"), viewerOf("DEVELOPER")]) {
      const shown = (await search(m, { ...day, changesOnly: true }, viewer)).rows.map((r) => r.action).sort();
      expect(shown).toEqual([...CHANGES, "auth.login", "cron.ran"].sort());
    }
    // the plain search (not used by the pages) is unchanged: everything is still in the diary
    expect((await search(m, day)).rows).toHaveLength(NOISE.length + CHANGES.length + 2);
    // the module list the page offers does not name a module only noise belongs to
    const onlyNoise = `${MOD}OnlyNoise`;
    await put({ at, user: dev, type: "DEVELOPER", action: "developer.viewed", module: onlyNoise });
    const choices = await auditFilterChoices(BOSS, { ...base, module: "", ...day, changesOnly: true });
    expect(choices.modules).not.toContain(onlyNoise);
    expect(choices.modules).toContain(m);
  });

  it("a Developer's failed entry (a name ending _failed, _refused, .denied) and one working as someone's look are noise too; his change as someone stays", async () => {
    const m = `${MOD}ChangesAs`;
    const at = new Date("2026-03-13T09:00:00Z");
    const as = { actingAs: { id: "u1", name: "Bashley", role: "MD" } };
    await put({ at, user: dev, type: "DEVELOPER", action: "restaurant.order_failed", module: m, after: as });
    await put({ at, user: dev, type: "DEVELOPER", action: "something.refused", module: m });
    await put({ at, user: dev, type: "DEVELOPER", action: "developer.viewed", module: m, after: as });
    await put({ at, user: dev, type: "DEVELOPER", action: "menu.price_changed", module: m, after: as });
    const rows = (await search(m, { from: "2026-03-13", to: "2026-03-13", changesOnly: true })).rows;
    expect(rows.map((r) => r.action)).toEqual(["menu.price_changed"]);
    expect(rows[0].actingAs).toMatchObject({ name: "Bashley" });
  });

  it("the Staff activity page asks the same: a viewer who may see Developer actions sees his changes only; one who may not sees none of his rows", async () => {
    const at = new Date("2026-03-14T09:00:00Z");
    for (const action of ["developer.viewed", "developer.work_as_started", "menu.price_changed"]) await put({ at, user: dev, type: "DEVELOPER", action, module: `${MOD}Act` });
    const q = { from: "2026-03-14", to: "2026-03-14", userId: dev.id, page: 1 };
    const actions = async (developers: boolean, changesOnly: boolean) => (await db.auditLog.findMany({ where: activityWhere({ ...q, changesOnly }, developers) })).map((r) => r.action).sort();
    expect(await actions(true, true)).toEqual(["menu.price_changed"]);
    expect(await actions(true, false)).toEqual(["developer.viewed", "developer.work_as_started", "menu.price_changed"]);
    expect(await actions(false, true)).toEqual([]);
  });
});
