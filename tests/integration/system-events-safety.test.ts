import { createHmac } from "node:crypto";
import { renderToStaticMarkup } from "react-dom/server";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});
// The room report job itself is not under test (it would build and send a real report): only what the route does around it.
const roomJob = vi.hoisted(() => ({ run: vi.fn() }));
vi.mock("@/server/services/room-report", () => ({ runRoomReportJob: roomJob.run }));

import { db } from "@/server/db";
import { getCurrentUser, type CurrentUser } from "@/server/auth";
import { runAction } from "@/server/errors";
import { recordCronRun, recordError, recordWebhook, resetSystemEventsLimits, WRITE_TIMEOUT_MS } from "@/server/services/system-events";
import { onRequestError } from "@/instrumentation";
import { crashData, healthReport } from "@/server/services/developer-health";
import { runChecks } from "@/server/services/developer-checks";
import { POST as ntzsWebhook } from "@/app/api/webhooks/ntzs/route";
import { GET as roomReportCron } from "@/app/api/cron/room-report/route";
import DeveloperHomePage from "@/app/staff/(app)/developer/page";
import { browser, makeSession, makeUser, removeMadeUsers, resolveAsync, type MadeUser } from "../support/developer";

/**
 * CAPTURING MUST NEVER HURT A REQUEST (owner, 2026-10-18). With every write to system_events forced to fail — it answers with an error,
 * it throws at once, or it never answers at all — the three recorders return normally and quickly, the instrumentation hook never
 * throws, and the routes that record (the nTZS webhook, the room report job) answer exactly what they answer when recording works.
 * And the Developer Home still opens when the table cannot be read at all.
 */

const FAST_MS = 300; // generous for a CI machine; the real figure is a few milliseconds
const CRON_HANG_MS = 2500; // recordCronRun waits a little longer than a person's request (its own limit in system-events.ts)

type Mode = "rejects" | "throws at once" | "hangs";
const MODES: Mode[] = ["rejects", "throws at once", "hangs"];

let spies: ReturnType<typeof vi.spyOn>[] = [];
function breakWrites(mode: Mode) {
  const fail = () => {
    if (mode === "rejects") return Promise.reject(new Error("db down: password=hunter2 for asha@example.com"));
    if (mode === "throws at once") throw new Error("sync boom");
    return new Promise(() => undefined); // never answers
  };
  const calls = {
    findFirst: vi.spyOn(db.systemEvent, "findFirst").mockImplementation(fail as never),
    updateMany: vi.spyOn(db.systemEvent, "updateMany").mockImplementation(fail as never),
    create: vi.spyOn(db.systemEvent, "create").mockImplementation(fail as never),
  };
  spies = Object.values(calls);
  return calls;
}
const timed = async <T>(run: () => Promise<T>) => {
  const t0 = Date.now();
  const value = await run();
  return { value, ms: Date.now() - t0 };
};

let dev: MadeUser;
beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Safety Dev" });
});
afterAll(async () => {
  await db.systemEvent.deleteMany({});
  await removeMadeUsers();
});
beforeEach(() => {
  browser.reset();
  resetSystemEventsLimits();
});
afterEach(() => {
  for (const s of spies) s.mockRestore();
  spies = [];
  delete process.env.NEXT_RUNTIME;
  delete process.env.NTZS_WEBHOOK_SECRET;
  delete process.env.CRON_SECRET;
  vi.restoreAllMocks();
  roomJob.run.mockReset();
  resetSystemEventsLimits();
});

for (const mode of MODES) {
  describe(`with every write to system_events failing (${mode})`, () => {
    // a write that never answers is cut off at the time limit; the others come back at once
    const limit = (ms: number) => (mode === "hangs" ? ms + FAST_MS : FAST_MS);

    it("recordError, recordCronRun and recordWebhook return normally, within their time limit, and never retry or record the failure", async () => {
      const calls = breakWrites(mode);

      const e = await timed(() => recordError({ source: "test:safety", error: new Error("an unexpected thing") }));
      expect(e.value).toBeUndefined();
      expect(e.ms).toBeLessThan(limit(WRITE_TIMEOUT_MS));
      expect(calls.findFirst).toHaveBeenCalled(); // the failure really was in the way
      expect(calls.create).not.toHaveBeenCalled(); // and the failed write was not itself recorded or retried

      // a second error right after is dropped at once: after a failed write the recorder stays quiet for a while
      const quiet = await timed(() => recordError({ source: "test:safety", error: new Error("another") }));
      expect(quiet.ms).toBeLessThan(50);

      resetSystemEventsLimits();
      const c = await timed(() => recordCronRun("/api/cron/daily-report", { ok: false, startedAt: new Date(), durationMs: 12, summary: { sent: 2 }, error: new Error("it failed") }));
      expect(c.value).toBeUndefined();
      expect(c.ms).toBeLessThan(limit(CRON_HANG_MS));

      resetSystemEventsLimits();
      const w = await timed(() => recordWebhook("webhook:ntzs", { ok: false, kind: "payment not recorded", httpStatus: 500, error: new Error("x") }));
      expect(w.value).toBeUndefined();
      expect(w.ms).toBeLessThan(limit(WRITE_TIMEOUT_MS));
    }, 20_000);

    it("instrumentation's onRequestError never throws and is not slow", async () => {
      breakWrites(mode);
      process.env.NEXT_RUNTIME = "nodejs";
      const req = { path: "/staff/reservations/abc?token=zzz", method: "GET", headers: {} };
      const ctx = { routerKind: "App Router", routePath: "/staff/reservations/[id]", routeType: "render", renderSource: "react-server-components", renderType: "dynamic", revalidateReason: undefined } as const;
      const a = await timed(async () => onRequestError(new Error("render failed"), req, ctx));
      expect(a.value).toBeUndefined();
      expect(a.ms).toBeLessThan(limit(WRITE_TIMEOUT_MS));
      // odd input as well
      resetSystemEventsLimits();
      await expect(onRequestError(undefined, undefined as never, undefined as never)).resolves.toBeUndefined();
      await expect(onRequestError({ toString() { throw new Error("x"); } }, req, { ...ctx, routeType: "action" })).resolves.toBeUndefined();
    }, 20_000);

    it("a server action answers exactly what it answered before", async () => {
      breakWrites(mode);
      const a = await timed(() => runAction(async () => { throw new Error("db is down"); }));
      expect(a.value).toEqual({ ok: false, error: "Something went wrong. Nothing was saved — please try again." });
      expect(a.ms).toBeLessThan(limit(WRITE_TIMEOUT_MS) + 1000); // + the words lookup of runAction itself
      expect(await runAction(async () => 7)).toEqual({ ok: true, data: 7 });
    }, 20_000);

    it("the nTZS webhook answers what it answered before: refused 401, bad JSON 400", async () => {
      breakWrites(mode);
      const post = (raw: string, headers: Record<string, string> = {}) => ntzsWebhook(new Request("http://localhost/api/webhooks/ntzs", { method: "POST", body: raw, headers }));

      const refused = await timed(() => post("{}"));
      expect(refused.value.status).toBe(401);
      expect(await refused.value.text()).toBe("Invalid signature");
      expect(refused.ms).toBeLessThan(limit(WRITE_TIMEOUT_MS));

      process.env.NTZS_WEBHOOK_SECRET = "safety-test-secret";
      resetSystemEventsLimits();
      const raw = "this is not json";
      const ts = String(Date.now());
      const signature = createHmac("sha256", "safety-test-secret").update(`${ts}.${raw}`).digest("hex");
      const bad = await timed(() => post(raw, { "x-webhook-signature": signature, "x-webhook-timestamp": ts }));
      expect(bad.value.status).toBe(400);
      expect(await bad.value.text()).toBe("Bad JSON");
      expect(bad.ms).toBeLessThan(limit(WRITE_TIMEOUT_MS));
    }, 20_000);

    it("the room report cron route answers what it answered before, both when the job works and when it fails", async () => {
      breakWrites(mode);
      process.env.CRON_SECRET = "safety-cron-secret";
      const get = () => roomReportCron(new Request("http://localhost/api/cron/room-report", { headers: { authorization: "Bearer safety-cron-secret" } }));

      roomJob.run.mockResolvedValueOnce({ skipped: "disabled" });
      const ok = await timed(get);
      expect(ok.value.status).toBe(200);
      expect(await ok.value.json()).toEqual({ ok: true, skipped: "disabled" });
      expect(ok.ms).toBeLessThan(limit(CRON_HANG_MS));

      resetSystemEventsLimits();
      roomJob.run.mockRejectedValueOnce(new Error("the report broke"));
      const failed = await timed(get);
      expect(failed.value.status).toBe(500);
      expect(await failed.value.json()).toEqual({ ok: false, error: "Room report job failed" });
      expect(failed.ms).toBeLessThan(limit(WRITE_TIMEOUT_MS + CRON_HANG_MS));

      // and the secret still guards it
      const refused = await roomReportCron(new Request("http://localhost/api/cron/room-report"));
      expect(refused.status).toBe(401);
    }, 30_000);
  });
}

describe("the Developer Home when the system log cannot be read", () => {
  const draw = async (search: Record<string, string> = {}) => renderToStaticMarkup((await resolveAsync(await DeveloperHomePage({ searchParams: Promise.resolve(search) } as never))) as never);
  const as = async () => {
    browser.reset();
    await makeSession(dev.id);
    return (await getCurrentUser()) as CurrentUser;
  };

  /** The table is taken away (as if its migration had not been applied yet) and put back, whatever happens. */
  async function withoutTable<T>(run: () => Promise<T>): Promise<T> {
    await db.$executeRawUnsafe(`ALTER TABLE system_events RENAME TO system_events_off`);
    try {
      return await run();
    } finally {
      await db.$executeRawUnsafe(`ALTER TABLE system_events_off RENAME TO system_events`);
    }
  }

  it("the health report, the checks and the Crashes data load; what needed the log says it could not be checked", async () => {
    const user = await as();
    await withoutTable(async () => {
      const h = await healthReport(user);
      expect(h.serverErrors24h).toBeNull();
      expect(h.checks.length).toBeGreaterThan(10); // the other checks still ran
      const log = h.checks.filter((c) => c.group === "Jobs & errors");
      expect(log.length).toBeGreaterThan(0);
      for (const c of log) expect(["unknown", "ok"], c.id).toContain(c.state);
      expect(log.some((c) => c.state === "unknown")).toBe(true);

      const checks = await runChecks(user);
      expect(checks.length).toBe(h.checks.length);

      const crashes = await crashData(user);
      expect(crashes.system).toBeNull();
      expect(crashes.failed).not.toBeNull(); // the failed sign-ins are still read
    });
  }, 60_000);

  it("the page opens with every part that uses the log, with no 'undefined' or 'NaN'", async () => {
    await as();
    await withoutTable(async () => {
      const html = await draw();
      expect(html).toContain("Developer");
      for (const id of ["problems", "errors", "messages", "security"]) expect(html, id).toContain(`id="${id}"`);
      expect(html).not.toMatch(/undefined|NaN/);
    });
  }, 90_000);

  it("and with the table there but empty", async () => {
    await as();
    await db.systemEvent.deleteMany({});
    const html = await draw();
    expect(html).toContain("Nothing yet");
    expect(html).not.toMatch(/undefined|NaN/);
  }, 60_000);
});
