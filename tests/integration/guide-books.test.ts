import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/headers", async () => {
  const m = await import("../support/developer");
  return { cookies: m.fakeCookies, headers: m.fakeHeaders };
});
vi.mock("next/navigation", async () => {
  const m = await import("../support/developer");
  return { redirect: m.redirectMock };
});
vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("next/server", async (importOriginal) => ({ ...(await importOriginal<Record<string, unknown>>()), after: () => undefined }));
// The file storage: captured, never called.
const storage = vi.hoisted(() => ({ blobs: [] as { pathname: string; size: number; uploadedAt: Date; url: string; downloadUrl: string }[] }));
vi.mock("@vercel/blob", () => ({
  list: vi.fn(async () => ({ blobs: storage.blobs, hasMore: false, cursor: undefined })),
  del: vi.fn(async () => undefined),
  put: vi.fn(),
}));
const tokenAsked = vi.hoisted(() => ({ lastOptions: null as unknown }));
vi.mock("@vercel/blob/client", () => ({
  handleUpload: vi.fn(async ({ body, onBeforeGenerateToken }: { body: { type: string; payload?: { pathname: string } }; onBeforeGenerateToken: (p: string) => Promise<unknown> }) => {
    if (body.type === "blob.generate-client-token") tokenAsked.lastOptions = await onBeforeGenerateToken(body.payload!.pathname);
    return { type: body.type, clientToken: "test-token" };
  }),
  upload: vi.fn(),
}));

import { del } from "@vercel/blob";
import { db } from "@/server/db";
import { POST } from "@/app/api/guides/upload/route";
import { recordGuideUploadsAction, removeGuideBookAction } from "@/app/staff/(app)/guides/actions";
import { GUIDE_CATALOG, GUIDE_FILE, GUIDE_VIEW_RIGHTS, guideInfo } from "@/lib/guide-books";
import { guideStorageReady, storedGuides } from "@/server/services/guide-books";
import { browser, makeSession, makeUser, removeMadeUsers, type MadeUser } from "../support/developer";

/**
 * GUIDE BOOKS (owner, 2026-10-18): the Boss, the MD, the Manager and the Developer download and share the twelve books; only the Developer
 * puts them in or takes them out. The PDFs are in the file storage (never in the repository or the database). Proven here:
 *   1. who may see the page (the four rights) and who may not;
 *   2. the upload route: nobody signed out, nobody but the Developer himself (not while working as someone), only a book's own file name;
 *   3. the two actions are the Developer's only, and each is audited under him;
 *   4. the listing reads only real book names and says "not ready" when the storage is not set up.
 */

const BOOK = "Vegas-Guide-07-Manager.pdf";
let dev: MadeUser;
let boss: MadeUser;
let md: MadeUser;
let mgr: MadeUser;
const others: Record<string, MadeUser> = {};

beforeAll(async () => {
  [dev, boss, md, mgr] = await Promise.all([makeUser("DEVELOPER"), makeUser("OWNER"), makeUser("ADMIN"), makeUser("MANAGER")]);
  for (const role of ["RECEPTIONIST", "RESTAURANT", "DRIVER", "FINANCE", "ACCOUNTANT"]) others[role] = await makeUser(role);
});
afterAll(async () => { browser.reset(); await removeMadeUsers(); });
beforeEach(async () => {
  browser.reset();
  storage.blobs = [];
  vi.mocked(del).mockClear();
  delete process.env.BLOB_READ_WRITE_TOKEN;
  await db.$executeRawUnsafe(`TRUNCATE "audit_logs"`);
});

const rightsOf = async (u: MadeUser) => new Set((await db.permission.findMany({ where: { roles: { some: { role: { users: { some: { id: u.id } } } } } }, select: { code: true } })).map((p) => p.code));
const call = (body: unknown) => POST(new Request("http://localhost/api/guides/upload", { method: "POST", body: typeof body === "string" ? body : JSON.stringify(body) }));
const tokenRequest = (pathname: string) => ({ type: "blob.generate-client-token", payload: { pathname, callbackUrl: "http://localhost/api/guides/upload", clientPayload: null, multipart: false } });

describe("who may see the Guide books page", () => {
  it("the Boss, the MD, the Manager and the Developer hold one of the rights; the other staff do not", async () => {
    for (const u of [boss, md, mgr, dev]) expect([...(await rightsOf(u))].some((p) => (GUIDE_VIEW_RIGHTS as string[]).includes(p)), u.role).toBe(true);
    for (const [role, u] of Object.entries(others)) expect([...(await rightsOf(u))].some((p) => (GUIDE_VIEW_RIGHTS as string[]).includes(p)), role).toBe(false);
  });
});

describe("the catalog", () => {
  it("lists twelve books in order, every file name follows the rule, and a stray book still gets a title", () => {
    expect(GUIDE_CATALOG).toHaveLength(12);
    expect(GUIDE_CATALOG.map((b) => b.number)).toEqual(["01", "02", "03", "04", "05", "06", "07", "08", "09", "10", "11", "12"]);
    for (const b of GUIDE_CATALOG) expect(GUIDE_FILE.test(b.file), b.file).toBe(true);
    expect(guideInfo("Vegas-Guide-13-Night-Audit.pdf")).toMatchObject({ number: "13", title: "Night Audit" });
    expect(guideInfo("notes.pdf")).toBeNull();
  });
  it("the file-name rule refuses paths, other types and odd names", () => {
    for (const bad of ["../Vegas-Guide-07-Manager.pdf", "Vegas-Guide-07-Manager.exe", "Vegas-Guide-7-Manager.pdf", "a/Vegas-Guide-07-Manager.pdf", "Vegas-Guide-07-.pdf", "Vegas-Guide-07-Man ager.pdf"]) expect(GUIDE_FILE.test(bad), bad).toBe(false);
  });
});

describe("the upload route", () => {
  it("refuses a request that is not JSON", async () => {
    expect((await call("not json")).status).toBe(400);
  });
  it("refuses a body that is JSON but not an upload request (400, never a crash)", async () => {
    for (const body of ["null", "42", "\"text\"", "[]", "{}", "{\"type\":5}"]) expect((await call(body)).status, body).toBe(400);
  });
  it("refuses someone who is signed out (401)", async () => {
    expect((await call(tokenRequest(`guide-books/${BOOK}`))).status).toBe(401);
  });
  it("refuses everyone who is not the Developer (403)", async () => {
    for (const u of [boss, md, mgr, others.RECEPTIONIST]) {
      browser.reset();
      await makeSession(u.id);
      expect((await call(tokenRequest(`guide-books/${BOOK}`))).status, u.role).toBe(403);
    }
  });
  it("refuses the Developer while he is working as someone", async () => {
    const token = await makeSession(dev.id);
    void token;
    const { rawDb } = await import("@/server/db");
    const session = await rawDb.session.findFirstOrThrow({ where: { userId: dev.id }, orderBy: { createdAt: "desc" } });
    await rawDb.session.update({ where: { id: session.id }, data: { workAsUserId: mgr.id, workAsStartedAt: new Date() } });
    expect((await call(tokenRequest(`guide-books/${BOOK}`))).status).toBe(403);
  });
  it("gives the Developer a token for a book name only, as a PDF of at most 60 MB that replaces the same name", async () => {
    await makeSession(dev.id);
    const res = await call(tokenRequest(`guide-books/${BOOK}`));
    expect(res.status).toBe(200);
    expect(tokenAsked.lastOptions).toMatchObject({ allowedContentTypes: ["application/pdf"], maximumSizeInBytes: 60 * 1024 * 1024, addRandomSuffix: false, allowOverwrite: true, cacheControlMaxAge: 60 });
    for (const bad of ["guide-books/evil.pdf", `other/${BOOK}`, `guide-books/../${BOOK}`, `guide-books/sub/${BOOK}`, BOOK, "guide-books/Vegas-Guide-07-Manager.html"]) {
      expect((await call(tokenRequest(bad))).status, bad).toBe(400);
    }
  });
  it("lets the storage's own 'upload finished' call through without a sign-in (it does nothing)", async () => {
    const res = await call({ type: "blob.upload-completed", payload: { blob: { pathname: `guide-books/${BOOK}` }, tokenPayload: null } });
    expect(res.status).toBe(200);
  });
});

describe("the actions", () => {
  it("record: refused for everyone but the Developer, nothing written", async () => {
    for (const u of [boss, md, mgr, others.RECEPTIONIST]) {
      browser.reset();
      await makeSession(u.id);
      const r = await recordGuideUploadsAction([BOOK]);
      expect(r.ok, u.role).toBe(false);
    }
    expect(await db.auditLog.count({ where: { action: "guide_book.uploaded" } })).toBe(0);
  });
  it("record: the Developer's upload is written under him, once per real book name, and strange names are dropped", async () => {
    await makeSession(dev.id);
    const r = await recordGuideUploadsAction([BOOK, BOOK, "Vegas-Guide-01-Reception.pdf", "evil.pdf", "../x.pdf"]);
    expect(r).toMatchObject({ ok: true, data: { count: 2 } });
    const rows = await db.auditLog.findMany({ where: { action: "guide_book.uploaded" }, orderBy: { entityId: "asc" } });
    expect(rows.map((x) => x.entityId)).toEqual(["Vegas-Guide-01-Reception.pdf", BOOK]);
    for (const row of rows) expect(row).toMatchObject({ userId: dev.id, actorType: "DEVELOPER", entityType: "GuideBook" });
  });
  it("record: nothing valid is refused", async () => {
    await makeSession(dev.id);
    expect(await recordGuideUploadsAction(["evil.pdf"])).toMatchObject({ ok: false, code: "VALIDATION" });
  });
  it("remove: refused for everyone but the Developer, and the storage is not touched", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test";
    storage.blobs = [{ pathname: `guide-books/${BOOK}`, size: 100, uploadedAt: new Date(), url: "https://store.test/guide-books/x.pdf", downloadUrl: "https://store.test/guide-books/x.pdf?download=1" }];
    for (const u of [boss, md, mgr]) {
      browser.reset();
      await makeSession(u.id);
      expect((await removeGuideBookAction(BOOK)).ok, u.role).toBe(false);
    }
    expect(del).not.toHaveBeenCalled();
  });
  it("remove: the Developer takes a book out, audited; an unknown or badly named book is refused", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test";
    storage.blobs = [{ pathname: `guide-books/${BOOK}`, size: 100, uploadedAt: new Date(), url: "https://store.test/guide-books/x.pdf", downloadUrl: "https://store.test/guide-books/x.pdf?download=1" }];
    await makeSession(dev.id);
    expect(await removeGuideBookAction("../x.pdf")).toMatchObject({ ok: false, code: "VALIDATION" });
    expect(await removeGuideBookAction("Vegas-Guide-01-Reception.pdf")).toMatchObject({ ok: false, code: "NOT_FOUND" });
    expect(await removeGuideBookAction(BOOK)).toMatchObject({ ok: true });
    expect(del).toHaveBeenCalledWith("https://store.test/guide-books/x.pdf");
    expect(await db.auditLog.count({ where: { action: "guide_book.removed", userId: dev.id, entityId: BOOK } })).toBe(1);
  });
});

describe("the listing", () => {
  it("says the storage is not ready when there is no token", async () => {
    expect(guideStorageReady()).toBe(false);
    expect(await storedGuides()).toBeNull();
  });
  it("lists only real book names, in order", async () => {
    process.env.BLOB_READ_WRITE_TOKEN = "test";
    const blob = (name: string) => ({ pathname: `guide-books/${name}`, size: 5, uploadedAt: new Date("2026-10-18T10:00:00Z"), url: `https://store.test/guide-books/${name}`, downloadUrl: `https://store.test/guide-books/${name}?download=1` });
    storage.blobs = [blob("Vegas-Guide-07-Manager.pdf"), blob("notes.txt"), blob("Vegas-Guide-01-Reception.pdf")];
    const got = await storedGuides();
    expect(got?.map((g) => g.file)).toEqual(["Vegas-Guide-01-Reception.pdf", "Vegas-Guide-07-Manager.pdf"]);
  });
});
