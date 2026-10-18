import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});
// The audit trail can be made to fail (to prove a Developer's export is refused when it cannot be written down).
const auditMode = { fail: false };
vi.mock("@/server/audit", async (original) => {
  const m = await original<typeof import("@/server/audit")>();
  return {
    ...m,
    audit: async (...args: Parameters<typeof m.audit>) => {
      if (auditMode.fail) throw new Error("the audit trail is down");
      return m.audit(...args);
    },
  };
});
// The cash-handover export is off in this version of the hotel's system: it is switched on here so its route can be tried.
vi.mock("@/lib/cash-handover", async (original) => ({ ...(await original<typeof import("@/lib/cash-handover")>()), CASH_HANDOVER_ON: true }));
// What a route reads to build its file: counted, so a test can say "nothing was read" (the audit failed) or "the entry was already there when it was read".
vi.mock("@/server/services/reports", async (original) => {
  const m = await original<typeof import("@/server/services/reports")>();
  return { ...m, buildReport: vi.fn(m.buildReport) };
});
vi.mock("@/server/services/reporting", async (original) => {
  const m = await original<typeof import("@/server/services/reporting")>();
  return { ...m, profitLoss: vi.fn(m.profitLoss), occupancy: vi.fn(m.occupancy) };
});
vi.mock("@/server/services/finance", async (original) => {
  const m = await original<typeof import("@/server/services/finance")>();
  return { ...m, getLedger: vi.fn(m.getLedger) };
});
vi.mock("@/server/services/cash-handover", async (original) => {
  const m = await original<typeof import("@/server/services/cash-handover")>();
  return { ...m, handoverList: vi.fn(m.handoverList) };
});

import { db } from "@/server/db";
import { getCurrentUser, type CurrentUser } from "@/server/auth";
import { buildReport } from "@/server/services/reports";
import { occupancy, profitLoss } from "@/server/services/reporting";
import { getLedger } from "@/server/services/finance";
import { handoverList } from "@/server/services/cash-handover";
import { businessToday } from "@/server/settings";
import { toDbDate } from "@/lib/time/business-date";
import { GET as reportsCsv } from "@/app/api/reports/csv/route";
import { GET as ledgerCsv } from "@/app/api/finance/ledger/route";
import { GET as handoversCsv } from "@/app/api/accountant/handovers/route";
import { GET as storedFile } from "@/app/api/files/[id]/route";
import { GET as pulse } from "@/app/api/restaurant/pulse/route";
import { activityWhere, loadActivity } from "@/app/staff/(app)/activity/data";
import { DOWNLOAD_ACTION, EXPORT_ACTION, VIEW_BURST_LIMIT } from "@/server/services/developer-view-log";
import { auditOf, browser, makeSession, makeUser, removeMadeUsers, sha256, giveDeveloperRoleHotelWork, takeHotelWorkFromDeveloperRole, type MadeUser } from "../support/developer";

/**
 * A Developer's reading of data leaves a trace too (owner, 2026-10-14), against a real database:
 *   1. every export and download a Developer makes (the reports, the ledger, the cash handovers, a stored file) is written to the audit trail
 *      BEFORE any data is read or sent — "developer.exported" / "developer.downloaded" — every time, with no 10-minute rule and no limit;
 *   2. it FAILS CLOSED: when that entry cannot be written, the route answers 503 and nothing is sent (nothing is even read);
 *   3. a staff member's export writes no Developer entry and works exactly as before;
 *   4. the restaurant "pulse" poll never keeps a Developer's session awake;
 *   5. the older "Staff activity" page hides every Developer row from anyone who may not read the audit trail, and shows them to the Boss.
 */

let dev: MadeUser;
let boss: MadeUser;
let mgr: MadeUser;
let rec: MadeUser;
let fileId = "";
const FILE_BYTES = Buffer.from("PNG-bytes-of-a-payment-proof");
const RANGE = "from=2026-10-01&to=2026-10-07";

beforeAll(async () => {
  boss = await makeUser("OWNER", { fullName: "Boss Exports" });
  mgr = await makeUser("MANAGER", { fullName: "Manager Exports" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Asha Exports" });
  const f = await db.storedFile.create({ data: { purpose: "PAYMENT_PROOF", fileName: "proof of payment.png", contentType: "image/png", size: FILE_BYTES.length, data: FILE_BYTES } });
  fileId = f.id;
});
afterAll(async () => {
  await db.storedFile.deleteMany({ where: { id: fileId } });
  await removeMadeUsers();
});
beforeEach(async () => {
  // A new Developer for every test, so each test counts only its own entries.
  dev = await makeUser("DEVELOPER", { fullName: "Dev Exports" });
  auditMode.fail = false;
  browser.reset();
  vi.mocked(buildReport).mockClear();
  vi.mocked(profitLoss).mockClear();
  vi.mocked(occupancy).mockClear();
  vi.mocked(getLedger).mockClear();
  vi.mocked(handoverList).mockClear();
  await db.session.deleteMany({ where: { userId: { in: [boss.id, mgr.id, rec.id] } } });
});
afterEach(() => {
  auditMode.fail = false;
});

async function as(u: MadeUser, session: Parameters<typeof makeSession>[1] = {}) {
  browser.reset();
  const token = await makeSession(u.id, session);
  const user = (await getCurrentUser()) as CurrentUser;
  return { user, hash: sha256(token) };
}
const get = (path: string) => new Request(`http://localhost${path}`);
const fileCtx = (id: string) => ({ params: Promise.resolve({ id }) }) as never;
const entries = (userId: string, action: string) => db.auditLog.findMany({ where: { userId, action }, orderBy: { createdAt: "asc" } });
const developerEntries = (userId: string) => db.auditLog.findMany({ where: { userId, action: { startsWith: "developer." } } });

// ───────────────────────────────────────────── 1. a Developer's export is written first ─────────────────────────────────────────────
describe("a Developer's export or download is written down first", () => {
  it("a report: who, what, which dates, from where — and the entry is there before the report is built", async () => {
    await as(dev);
    browser.headers.set("x-forwarded-for", "41.9.9.9");
    const real = await vi.importActual<typeof import("@/server/services/reports")>("@/server/services/reports");
    let writtenWhenRead = -1;
    vi.mocked(buildReport).mockImplementationOnce(async (...args) => {
      writtenWhenRead = (await entries(dev.id, EXPORT_ACTION)).length;
      return real.buildReport(...args);
    });

    const res = await reportsCsv(get(`/api/reports/csv?${RANGE}&r=summary&download=1`));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    expect(writtenWhenRead).toBe(1);

    const [row] = await entries(dev.id, EXPORT_ACTION);
    expect(row).toMatchObject({
      actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: dev.fullName, ipAddress: "41.9.9.9",
      entityType: "Report", entityId: "summary", after: { path: "/api/reports/csv", report: "summary", from: "2026-10-01", to: "2026-10-07" },
    });
    expect(Math.abs(row.createdAt.getTime() - Date.now())).toBeLessThan(60_000);
  });

  it("the daily figures (no report named) are an export too", async () => {
    await as(dev);
    const real = await vi.importActual<typeof import("@/server/services/reporting")>("@/server/services/reporting");
    let writtenWhenRead = -1;
    vi.mocked(profitLoss).mockImplementationOnce(async (...args) => {
      writtenWhenRead = (await entries(dev.id, EXPORT_ACTION)).length;
      return real.profitLoss(...args);
    });
    const res = await reportsCsv(get(`/api/reports/csv?${RANGE}`));
    expect(res.status).toBe(200);
    expect(writtenWhenRead).toBe(1);
    expect((await entries(dev.id, EXPORT_ACTION))[0]).toMatchObject({ entityType: "Report", entityId: "financial-and-occupancy", after: { path: "/api/reports/csv", report: "financial-and-occupancy", from: "2026-10-01", to: "2026-10-07" } });
  });

  it("the ledger: the filters that say WHAT was taken are kept — a token or any other parameter is not", async () => {
    await as(dev);
    const res = await ledgerCsv(get(`/api/finance/ledger?${RANGE}&view=income&account=acc_1&q=rent&token=SUPERSECRET123&password=hunter2`));
    expect(res.status).toBe(200);
    const [row] = await entries(dev.id, EXPORT_ACTION);
    expect(row).toMatchObject({ actorType: "DEVELOPER", entityType: "Ledger", entityId: "general-ledger", after: { path: "/api/finance/ledger", report: "general-ledger", from: "2026-10-01", to: "2026-10-07", view: "income", account: "acc_1", q: "rent" } });
    expect(JSON.stringify(row.after)).not.toMatch(/SUPERSECRET123|hunter2|token|password/i);
    // a view the ledger does not know is written as the one it really used
    await ledgerCsv(get(`/api/finance/ledger?${RANGE}&view=whatever`));
    expect((await entries(dev.id, EXPORT_ACTION))[1].after).toMatchObject({ view: "all" });
  });

  it("the cash handovers: a period name is written as the dates it really covered", async () => {
    await as(dev);
    expect((await handoversCsv(get("/api/accountant/handovers?period=week"))).status).toBe(200);
    const [row] = await entries(dev.id, EXPORT_ACTION);
    expect(row).toMatchObject({ entityType: "CashHandover", entityId: "cash-handovers", after: { path: "/api/accountant/handovers", report: "cash-handovers" } });
    const after = row.after as { from: string; to: string };
    expect(after.from).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(after.to >= after.from).toBe(true);
    expect(handoverList).toHaveBeenCalledTimes(1);
  });

  it("a stored file, shown or saved: the file's id, what it is, and whether it was saved — never the file itself; the browser may not keep it", async () => {
    await as(dev);
    const shown = await storedFile(get(`/api/files/${fileId}`), fileCtx(fileId));
    const saved = await storedFile(get(`/api/files/${fileId}?download=1&token=abc`), fileCtx(fileId));
    for (const r of [shown, saved]) {
      expect(r.status).toBe(200);
      expect(Buffer.from(await r.arrayBuffer()).equals(FILE_BYTES)).toBe(true);
      expect(r.headers.get("cache-control")).toBe("private, no-store");
    }
    expect(saved.headers.get("content-disposition")).toContain("attachment");
    const rows = await entries(dev.id, DOWNLOAD_ACTION);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ actorType: "DEVELOPER", entityType: "StoredFile", entityId: fileId, after: { path: `/api/files/${fileId}`, purpose: "PAYMENT_PROOF", fileName: "proof of payment.png", contentType: "image/png", size: FILE_BYTES.length, download: false } });
    expect(rows[1].after).toMatchObject({ download: true });
    expect(JSON.stringify(rows.map((r) => r.after))).not.toMatch(/abc|token|PNG-bytes/);
  });

  it("every export is written — the same one again too; the 10-minute rule and the page limit never apply to it", async () => {
    const { user } = await as(dev);
    await db.auditLog.createMany({
      data: Array.from({ length: VIEW_BURST_LIMIT }, (_, i) => ({ userId: user.id, actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: dev.fullName, action: "developer.viewed", entityType: "Page", entityId: `/staff/flood/${i}`, businessDate: new Date("2026-10-14") })),
    });
    for (let i = 0; i < 4; i++) expect((await ledgerCsv(get(`/api/finance/ledger?${RANGE}`))).status).toBe(200);
    for (let i = 0; i < 3; i++) expect((await storedFile(get(`/api/files/${fileId}`), fileCtx(fileId))).status).toBe(200);
    expect(await entries(dev.id, EXPORT_ACTION)).toHaveLength(4);
    expect(await entries(dev.id, DOWNLOAD_ACTION)).toHaveLength(3);
  });

  it("a request that is refused or wrong sends nothing and writes nothing: no range, a range too long, a file that is not there, signed out", async () => {
    await as(dev);
    expect((await reportsCsv(get("/api/reports/csv?from=nope&to=2026-10-07"))).status).toBe(400);
    expect((await ledgerCsv(get("/api/finance/ledger?from=2026-10-09&to=2026-10-01"))).status).toBe(400);
    expect((await ledgerCsv(get("/api/finance/ledger?from=2020-01-01&to=2026-10-01"))).status).toBe(400);
    expect((await handoversCsv(get("/api/accountant/handovers?from=2026-10-09&to=2026-10-01"))).status).toBe(400);
    expect((await storedFile(get("/api/files/does-not-exist"), fileCtx("does-not-exist"))).status).toBe(404);
    expect(await developerEntries(dev.id)).toHaveLength(0);

    browser.reset();
    expect((await ledgerCsv(get(`/api/finance/ledger?${RANGE}`))).status).toBe(401);
    expect((await storedFile(get(`/api/files/${fileId}`), fileCtx(fileId))).status).toBe(401);
  });
});

// ───────────────────────────────────────────── 2. it fails closed ─────────────────────────────────────────────
describe("when the audit trail cannot be written, a Developer gets nothing", () => {
  it("every route answers 503 with a plain message, reads nothing, sends no data, and the failure is in the server log", async () => {
    await as(dev);
    const log = vi.spyOn(console, "error").mockImplementation(() => undefined);
    try {
      auditMode.fail = true;
      const answers = [
        await reportsCsv(get(`/api/reports/csv?${RANGE}&r=summary`)),
        await reportsCsv(get(`/api/reports/csv?${RANGE}`)),
        await ledgerCsv(get(`/api/finance/ledger?${RANGE}`)),
        await handoversCsv(get(`/api/accountant/handovers?${RANGE}`)),
        await storedFile(get(`/api/files/${fileId}?download=1`), fileCtx(fileId)),
        await storedFile(get(`/api/files/${fileId}`), fileCtx(fileId)),
      ];
      for (const res of answers) {
        expect(res.status).toBe(503);
        expect(res.headers.get("content-type")).toContain("text/plain");
        expect(res.headers.get("cache-control")).toBe("no-store");
        expect(res.headers.get("content-disposition")).toBeNull();
        const body = await res.text();
        expect(body).toContain("could not be recorded");
        expect(body).not.toMatch(/business_date|PNG-bytes|figure/i);
      }
      // nothing was even read
      expect(buildReport).not.toHaveBeenCalled();
      expect(profitLoss).not.toHaveBeenCalled();
      expect(occupancy).not.toHaveBeenCalled();
      expect(getLedger).not.toHaveBeenCalled();
      expect(handoverList).not.toHaveBeenCalled();
      // not silent: one line each in the server log, with ids and a path only
      expect(log).toHaveBeenCalledTimes(answers.length);
      expect(String(log.mock.calls[0][0])).toContain("nothing was sent");
      expect(JSON.stringify(log.mock.calls)).not.toMatch(/cookie|password|token|secret|vlh_session/i);
    } finally {
      log.mockRestore();
    }

    // the trail is back: the same requests now work, and are written
    auditMode.fail = false;
    expect((await ledgerCsv(get(`/api/finance/ledger?${RANGE}`))).status).toBe(200);
    expect((await storedFile(get(`/api/files/${fileId}`), fileCtx(fileId))).status).toBe(200);
    expect(await entries(dev.id, EXPORT_ACTION)).toHaveLength(1);
    expect(await entries(dev.id, DOWNLOAD_ACTION)).toHaveLength(1);
  });

  it("a staff member is not held back by it: nothing is written for them, so nothing can fail", async () => {
    await as(boss);
    auditMode.fail = true;
    expect((await ledgerCsv(get(`/api/finance/ledger?${RANGE}`))).status).toBe(200);
    expect((await reportsCsv(get(`/api/reports/csv?${RANGE}&r=summary`))).status).toBe(200);
    expect((await storedFile(get(`/api/files/${fileId}`), fileCtx(fileId))).status).toBe(200);
  });
});

// ───────────────────────────────────────────── 3. staff are unchanged ─────────────────────────────────────────────
describe("a staff member's export writes no Developer entry and works as before", () => {
  it("the Boss: the same files, the same headers, no 'developer.' entry", async () => {
    const { user } = await as(boss);
    expect(user.actorType).toBe("STAFF");
    const csv = await ledgerCsv(get(`/api/finance/ledger?${RANGE}`));
    expect(csv.status).toBe(200);
    expect(csv.headers.get("content-disposition")).toContain("vegas-ledger-2026-10-01-to-2026-10-07.csv");
    expect((await csv.text()).startsWith("business_date,")).toBe(true); // (the file starts with a byte-order mark; reading it as text drops it)
    expect((await reportsCsv(get(`/api/reports/csv?${RANGE}`))).status).toBe(200);
    expect((await handoversCsv(get("/api/accountant/handovers?period=month"))).status).toBe(200);
    const file = await storedFile(get(`/api/files/${fileId}`), fileCtx(fileId));
    expect(file.status).toBe(200);
    expect(file.headers.get("cache-control")).toBe("private, max-age=3600");
    expect(Buffer.from(await file.arrayBuffer()).equals(FILE_BYTES)).toBe(true);
    expect(await developerEntries(boss.id)).toHaveLength(0);
    expect(await auditOf(boss.id)).toHaveLength(0);
  });

  it("a person without the right is refused as before (and a staff refusal is not a Developer entry)", async () => {
    const driver = await makeUser("DRIVER", { fullName: "Driver Refused" });
    await as(driver);
    expect((await ledgerCsv(get(`/api/finance/ledger?${RANGE}`))).status).toBe(403);
    expect((await reportsCsv(get(`/api/reports/csv?${RANGE}`))).status).toBe(403);
    expect((await storedFile(get(`/api/files/${fileId}`), fileCtx(fileId))).status).toBe(403);
    expect(await developerEntries(driver.id)).toHaveLength(0);
  });
});

// ───────────────────────────────────────────── 4. a poll never keeps a Developer awake ─────────────────────────────────────────────
describe("the restaurant pulse is a background poll", () => {
  it("it answers a Developer without refreshing their session; a real request does", async () => {
    browser.reset();
    const hash = sha256(await makeSession(dev.id, { seenMinAgo: 10 })); // (not through as(): reading the account there would already count as use)
    const seen = async () => (await db.session.findUniqueOrThrow({ where: { tokenHash: hash } })).lastSeenAt.getTime();
    const before = await seen();
    const res = await pulse();
    expect(res.status).toBe(200);
    expect(typeof ((await res.json()) as { v: string }).v).toBe("string");
    expect(await seen()).toBe(before);

    expect((await ledgerCsv(get(`/api/finance/ledger?${RANGE}`))).status).toBe(200);
    expect(Date.now() - (await seen())).toBeLessThan(60_000);
  });

  it("it still refuses signed-out visitors and people with no restaurant right", async () => {
    browser.reset();
    expect((await pulse()).status).toBe(401);
    await as(boss);
    expect((await pulse()).status).toBe(200);
    const driver = await makeUser("DRIVER", { fullName: "Driver Exports" });
    await as(driver);
    expect((await pulse()).status).toBe(403);
  });
});

// ───────────────────────────────────────────── 5. the older Staff activity page ─────────────────────────────────────────────
describe("the Staff activity page hides a Developer's rows from anyone who may not read the audit trail", () => {
  let today = "";
  let actDev: MadeUser;
  const ids: Record<string, string> = {};

  beforeAll(async () => {
    actDev = await makeUser("DEVELOPER", { fullName: "Dev Activity" });
    today = await businessToday();
    const day = toDbDate(today);
    const make = async (key: string, data: Record<string, unknown>) => {
      ids[key] = (await db.auditLog.create({ data: { entityType: "ActivityTest", businessDate: day, ...data } as never })).id;
    };
    await make("dev", { userId: actDev.id, actorLabel: actDev.fullName, actorType: "DEVELOPER", actorRole: "DEVELOPER", action: "developer.exported", after: { path: "/api/x", note: "n", apiToken: "TOKEN-VALUE-1" } });
    await make("legacy", { userId: actDev.id, actorLabel: actDev.fullName, actorType: null, actorRole: null, action: "settings.updated" }); // an old row: no type, but the account is the Developer's
    await make("about", { userId: null, actorLabel: "system", actorType: "SYSTEM", action: "developer.provisioned" }); // a setup row about the Developer account
    await make("staff", { userId: rec.id, actorLabel: rec.fullName, actorType: "STAFF", actorRole: "RECEPTIONIST", action: "activitytest.done", before: { password: "hunter2", room: "12" }, after: { ok: true } });
  });

  const ask = async (who: MadeUser, over: Partial<Parameters<typeof loadActivity>[1]> = {}) => {
    const { user } = await as(who);
    return loadActivity(user, { from: today, to: today, page: 1, ...over });
  };

  it("a Manager sees none of them: not the rows, not the Developer in the staff list, not the 'developer' area, not in the count", async () => {
    const byDev = await ask(mgr, { userId: actDev.id });
    expect(byDev.rows).toEqual([]);
    expect(byDev.total).toBe(0);
    const area = await ask(mgr, { area: "developer" });
    expect(area.rows).toEqual([]);
    expect(area.total).toBe(0);
    const all = await ask(mgr);
    expect(all.developers).toBe(false);
    expect(all.rows.every((r) => r.actorType !== "DEVELOPER" && !r.action.startsWith("developer.") && r.id !== ids.dev && r.id !== ids.legacy && r.id !== ids.about)).toBe(true);
    expect(all.users.map((u) => u.id)).not.toContain(actDev.id);
    expect(all.users.map((u) => u.id)).toContain(rec.id);
    expect(all.areas).not.toContain("developer");
    expect(all.areas).toContain("activitytest");
  });

  it("a Manager still sees staff rows, with secrets hidden", async () => {
    const staff = await ask(mgr, { userId: rec.id, area: "activitytest" });
    expect(staff.rows.map((r) => r.id)).toContain(ids.staff);
    const row = staff.rows.find((r) => r.id === ids.staff)!;
    expect(row).toMatchObject({ actorType: "STAFF", who: rec.fullName, before: { password: "[hidden]", room: "12" } });
  });

  it("the Boss sees every one of them, marked as a Developer's, with secrets hidden", async () => {
    const byDev = await ask(boss, { userId: actDev.id });
    expect(byDev.developers).toBe(true);
    expect(byDev.rows.map((r) => r.id)).toEqual(expect.arrayContaining([ids.dev, ids.legacy]));
    expect(byDev.rows.every((r) => r.actorType === "DEVELOPER")).toBe(true);
    expect(byDev.rows.find((r) => r.id === ids.dev)!.after).toMatchObject({ note: "n", apiToken: "[hidden]" });
    expect(JSON.stringify(byDev.rows)).not.toContain("TOKEN-VALUE-1");
    const area = await ask(boss, { area: "developer" });
    expect(area.rows.map((r) => r.id)).toEqual(expect.arrayContaining([ids.dev, ids.about]));
    const all = await ask(boss);
    expect(all.users.map((u) => u.id)).toContain(actDev.id);
    expect(all.areas).toContain("developer");
    expect(all.total).toBeGreaterThanOrEqual((await ask(mgr)).total + 3); // the three rows the Manager does not see
  });

  it("the Developer reads them too (the same right as the Boss)", async () => {
    const view = await ask(dev, { userId: actDev.id });
    expect(view.developers).toBe(true);
    expect(view.rows.map((r) => r.id)).toEqual(expect.arrayContaining([ids.dev, ids.legacy]));
  });

  it("the hiding is in the database filter itself (the same condition the audit trail uses)", () => {
    const q = { from: "2026-10-01", to: "2026-10-01", page: 1 };
    expect(JSON.stringify(activityWhere(q, true))).not.toContain("DEVELOPER");
    expect(JSON.stringify(activityWhere(q, false))).toContain("DEVELOPER");
    expect(JSON.stringify(activityWhere(q, false))).toContain("developer.");
  });
});

// The Developer role does not hold the hotel's-work rights any more (they come only through Work as); these tests prove the fences hold even if it did.
beforeAll(async () => { await giveDeveloperRoleHotelWork(); });
afterAll(async () => { await takeHotelWorkFromDeveloperRole(); });
