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
  isFailureAction, isFailureEntry, parseAuditFilter, queryAuditTrail, type AuditFilter, type AuditRow, type AuditViewer,
} from "@/server/services/audit-trail";
import { AuditList, showJson } from "@/app/staff/(app)/audit/audit-rows";
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
    expect(auditActionWords("auth.login_failed")).toBe("failed to sign in");
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
