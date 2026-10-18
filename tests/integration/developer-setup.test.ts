import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { verifyPassword } from "@/server/auth";

/**
 * The Developer account is created ONLY by scripts/provision-developer.mjs. These tests run the real script as a separate
 * process against the test database (answers piped in with --stdin) and check what it does, what it refuses, and that nothing
 * it prints or writes holds the password, its hash or the database address.
 */
const ROOT = path.resolve(import.meta.dirname, "..", "..");
const SCRIPT = path.join(ROOT, "scripts", "provision-developer.mjs");
const ADDRESS = process.env.DATABASE_URL!;
const DB_NAME = decodeURIComponent(new URL(ADDRESS).pathname.slice(1));

const EMAIL = "Dev.Account@Example.test";
const NAME = "Test Developer";
const PASSWORD = "Violet-Harbour 42 Lantern!";
const NEW_PASSWORD = "Granite Meadow 77 Compass?";

interface Run { code: number | null; out: string }

/** Runs the real script. `answers` are the key=value lines for --stdin; the address goes in the environment, as the owner would give it. */
function run(args: string[], answers: Record<string, string>, env: Record<string, string | undefined> = {}): Promise<Run> {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT, ...args], { cwd: ROOT, env: { ...process.env, DATABASE_URL: ADDRESS, DEVELOPER_ADDRESS_FILE: path.join(ROOT, ".no-such-address-file"), ...env } });
    let out = "";
    child.stdout.on("data", (d) => (out += d));
    child.stderr.on("data", (d) => (out += d));
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, out }));
    child.stdin.end(Object.entries(answers).map(([k, v]) => `${k}=${v}`).join("\n") + "\n");
  });
}
const create = (a: Record<string, string> = {}, args: string[] = []) => run(["--stdin", ...args], { database: DB_NAME, email: EMAIL, name: NAME, password: PASSWORD, ...a });
const rotate = (a: Record<string, string> = {}, args: string[] = []) => run(["--stdin", "--rotate", ...args], { database: DB_NAME, password: NEW_PASSWORD, ...a });
const deactivate = (a: Record<string, string> = {}) => run(["--stdin", "--deactivate"], { database: DB_NAME, ...a });

const developers = () => db.user.findMany({ where: { role: { code: "DEVELOPER" } }, orderBy: { createdAt: "asc" } });
const developerAudit = (action?: string) => db.auditLog.findMany({ where: { action: action ?? { startsWith: "developer." }, actorLabel: "setup script" }, orderBy: { createdAt: "asc" } });

/** Removes what these tests made. The trigger forbids deleting audit rows, so the maintenance door is opened for this transaction only. */
async function cleanup() {
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT set_config('vegas.audit_maintenance', 'on', true)`;
    await tx.auditLog.deleteMany({ where: { action: { startsWith: "developer." }, actorLabel: "setup script" } });
    await tx.session.deleteMany({ where: { user: { role: { code: "DEVELOPER" } } } });
    await tx.user.deleteMany({ where: { role: { code: "DEVELOPER" } } });
    await tx.$executeRaw`SELECT set_config('vegas.audit_maintenance', 'off', true)`;
  });
}

/** Nothing the script prints may hold a password, a hash or the database address. */
function expectNoSecrets(out: string, ...passwords: string[]) {
  for (const p of passwords) expect(out, "a password was printed").not.toContain(p);
  expect(out, "a hash was printed").not.toMatch(/\$argon2/);
  expect(out, "the database address was printed").not.toContain(ADDRESS);
  const u = new URL(ADDRESS);
  expect(out, "the host was printed").not.toContain(`${u.hostname}:${u.port}`);
}

beforeAll(cleanup);
afterAll(async () => { await cleanup(); });

describe("the Developer setup script (the only way the account is made)", () => {
  it("does nothing unless the database's name is typed correctly", async () => {
    const r = await create({ database: `${DB_NAME}_other` });
    expect(r.code).toBe(1);
    expect(r.out).toContain("not the name of this database");
    expect(await developers()).toHaveLength(0);
    expect(await developerAudit()).toHaveLength(0);
    expectNoSecrets(r.out, PASSWORD);
  });

  it("refuses a weak password — and says so without repeating it", async () => {
    const weak: Record<string, string> = {
      "too short (12)": "Ab1!Cd2@Ef3#",
      "no capital letter": "violet-harbour 42 lantern!",
      "no small letter": "VIOLET-HARBOUR 42 LANTERN!",
      "no number": "Violet-Harbour Lantern Quay!",
      "no symbol": "VioletHarbour42Lantern",
      "the email itself": "dev.account@example.test",
      "contains the first part of the email": "Xx-dev.account-42-Zz!",
      "an easy word": "Password-Lantern 42 Quay!",
      "ends with a space": "Violet-Harbour 42 Lantern! ",
    };
    for (const [why, password] of Object.entries(weak)) {
      const r = await create({ password });
      expect(r.code, why).toBe(1);
      expect(r.out, why).toContain("not strong enough");
      expectNoSecrets(r.out, password.trim());
    }
    expect(await developers()).toHaveLength(0);
  });

  it("refuses an email that is not an email, and a missing answer", async () => {
    expect((await create({ email: "not-an-email" })).out).toContain("not a valid email");
    expect((await create({ email: "a@b" })).code).toBe(1);
    const missing = await run(["--stdin"], { database: DB_NAME, email: EMAIL, name: NAME });
    expect(missing.code).toBe(1);
    expect(missing.out).toContain('"password=');
    expect(await developers()).toHaveLength(0);
  });

  it("creates exactly one Developer: role DEVELOPER, the password verifies with the app's own check, only its argon2id hash is stored", async () => {
    const r = await create();
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("DONE");
    expect(r.out).toContain(DB_NAME);
    expectNoSecrets(r.out, PASSWORD);

    const list = await developers();
    expect(list).toHaveLength(1);
    const dev = list[0];
    expect(dev.email).toBe("dev.account@example.test"); // lowercased: the sign-in form lowercases too
    expect(dev.fullName).toBe(NAME);
    expect(dev.isActive).toBe(true);
    expect(dev.mustChangePassword).toBe(false);
    expect(dev.passwordHash).not.toContain(PASSWORD);
    expect(dev.passwordHash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/); // the same settings as hashPassword in the app
    expect(await verifyPassword(dev.passwordHash, PASSWORD)).toBe(true);
    expect(await verifyPassword(dev.passwordHash, NEW_PASSWORD)).toBe(false);
    expect(await verifyPassword(dev.passwordHash, "")).toBe(false);
    const role = await db.role.findUniqueOrThrow({ where: { code: "DEVELOPER" }, include: { permissions: { include: { permission: true } } } });
    expect(dev.roleId).toBe(role.id);
    expect(role.permissions.map((p) => p.permission.code)).toContain("developer.access");
  });

  it("writes ONE audit entry for it, by the setup script, with the email and name and no secret", async () => {
    const entries = await developerAudit();
    expect(entries).toHaveLength(1);
    const e = entries[0];
    const dev = (await developers())[0];
    expect(e.action).toBe("developer.provisioned");
    expect(e.actorType).toBe("SYSTEM");
    expect(e.actorLabel).toBe("setup script");
    expect(e.userId).toBeNull();
    expect(e.entityType).toBe("User");
    expect(e.entityId).toBe(dev.id);
    expect(e.after).toEqual({ email: "dev.account@example.test", name: NAME, role: "DEVELOPER" });
    expect(e.businessDate).toBeInstanceOf(Date);
    const all = JSON.stringify(e);
    for (const secret of [PASSWORD, dev.passwordHash, "argon2"]) expect(all).not.toContain(secret);
  });

  it("the audit entry itself can neither be edited nor deleted (only the maintenance door, per transaction, allows it)", async () => {
    const [e] = await developerAudit();
    await expect(db.auditLog.update({ where: { id: e.id }, data: { action: "developer.nothing" } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(db.auditLog.delete({ where: { id: e.id } })).rejects.toThrow(/cannot be changed or deleted/);
    await expect(db.$executeRawUnsafe(`DELETE FROM audit_logs WHERE id = '${e.id}'`)).rejects.toThrow(/cannot be changed or deleted/);
    expect(await developerAudit()).toHaveLength(1);
  });

  it("a second run refuses: the same email, and a different email while an active Developer exists", async () => {
    const same = await create();
    expect(same.code).toBe(1);
    expect(same.out).toContain("already exists");
    const other = await create({ email: "second.dev@example.test" });
    expect(other.code).toBe(1);
    expect(other.out).toContain("active Developer account already exists");
    expectNoSecrets(other.out, PASSWORD);
    expect(await developers()).toHaveLength(1);
    expect(await developerAudit()).toHaveLength(1);
  });

  it("refuses an email that a staff account already uses (the Developer is a separate identity)", async () => {
    const staff = await db.user.findFirstOrThrow({ where: { role: { code: { not: "DEVELOPER" } } }, select: { email: true } });
    const r = await create({ email: staff.email.toUpperCase() }, ["--allow-second"]);
    expect(r.code).toBe(1);
    expect(r.out).toContain("OWN email address");
    expect(await developers()).toHaveLength(1);
  });

  it("--allow-second makes a second one, and rotating then needs to be told which", async () => {
    const r = await create({ email: "second.dev@example.test", name: "Second Developer" }, ["--allow-second"]);
    expect(r.code, r.out).toBe(0);
    expect(await developers()).toHaveLength(2);
    const ask = await rotate();
    expect(ask.code).toBe(1);
    expect(ask.out).toContain("more than one Developer");
    const unknown = await rotate({ email: "nobody@example.test" });
    expect(unknown.code).toBe(1);
    // put things back: one Developer
    await db.user.delete({ where: { email: "second.dev@example.test" } });
    expect(await developers()).toHaveLength(1);
  });

  it("--rotate: a weak or the same password is refused; a good one replaces the hash, ends every session, and is audited without a secret", async () => {
    const dev = (await developers())[0];
    await db.session.create({ data: { tokenHash: `test-${Date.now()}`, userId: dev.id, expiresAt: new Date(Date.now() + 3_600_000) } });

    const weak = await rotate({ password: "short" });
    expect(weak.code).toBe(1);
    expect(weak.out).toContain("not strong enough");
    const same = await rotate({ password: PASSWORD });
    expect(same.code).toBe(1);
    expect(same.out).toContain("same password");
    expect((await developers())[0].passwordHash).toBe(dev.passwordHash);
    expect(await db.session.count({ where: { userId: dev.id } })).toBe(1);

    const r = await rotate();
    expect(r.code, r.out).toBe(0);
    expectNoSecrets(r.out, PASSWORD, NEW_PASSWORD);
    const after = (await developers())[0];
    expect(after.id).toBe(dev.id);
    expect(after.passwordHash).not.toBe(dev.passwordHash);
    expect(await verifyPassword(after.passwordHash, NEW_PASSWORD)).toBe(true);
    expect(await verifyPassword(after.passwordHash, PASSWORD)).toBe(false);
    expect(await db.session.count({ where: { userId: dev.id } })).toBe(0);

    const entries = await developerAudit("developer.password_rotated");
    expect(entries).toHaveLength(1);
    expect(entries[0].actorType).toBe("SYSTEM");
    expect(entries[0].entityId).toBe(dev.id);
    expect(entries[0].after).toEqual({ email: dev.email, name: NAME, active: true, sessionsEnded: 1 });
    const text = JSON.stringify(entries[0]);
    for (const secret of [PASSWORD, NEW_PASSWORD, after.passwordHash, dev.passwordHash]) expect(text).not.toContain(secret);
  });

  it("--deactivate switches it off and ends its sessions; doing it twice is refused; a new password alone does not switch it back on", async () => {
    const dev = (await developers())[0];
    await db.session.create({ data: { tokenHash: `test2-${Date.now()}`, userId: dev.id, expiresAt: new Date(Date.now() + 3_600_000) } });
    const r = await deactivate();
    expect(r.code, r.out).toBe(0);
    expectNoSecrets(r.out, PASSWORD, NEW_PASSWORD);
    expect((await developers())[0].isActive).toBe(false);
    expect(await db.session.count({ where: { userId: dev.id } })).toBe(0);
    const entries = await developerAudit("developer.deactivated");
    expect(entries).toHaveLength(1);
    expect(entries[0].after).toEqual({ email: dev.email, name: NAME, active: false, sessionsEnded: 1 });

    const again = await deactivate();
    expect(again.code).toBe(1);
    expect(again.out).toContain("already switched off");

    const noReactivate = await rotate({ password: "Marble Orchard 58 Lighthouse#" });
    expect(noReactivate.code).toBe(1);
    expect(noReactivate.out).toContain("--reactivate");
    expect((await developers())[0].isActive).toBe(false);

    // --rotate --reactivate brings it back, with the new password
    const back = await rotate({ password: "Marble Orchard 58 Lighthouse#" }, ["--reactivate"]);
    expect(back.code, back.out).toBe(0);
    const revived = (await developers())[0];
    expect(revived.isActive).toBe(true);
    expect(await verifyPassword(revived.passwordHash, "Marble Orchard 58 Lighthouse#")).toBe(true);
    expect((await developerAudit("developer.password_rotated")).length).toBe(2);
  });

  it("stops, changing nothing, when the Developer role is not in the database (the deploy has not run yet)", async () => {
    await db.role.update({ where: { code: "DEVELOPER" }, data: { code: "DEVELOPER_HIDDEN" } });
    try {
      const r = await create({ email: "later.dev@example.test" });
      expect(r.code).toBe(1);
      expect(r.out).toContain("Deploy the application first");
      expect(await db.user.count({ where: { email: "later.dev@example.test" } })).toBe(0);
    } finally {
      await db.role.update({ where: { code: "DEVELOPER_HIDDEN" }, data: { code: "DEVELOPER" } });
    }
  });

  it("takes the database address only from DATABASE_URL or .env.developer.local — and never prints it, even when it fails", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dev-setup-"));
    const file = path.join(dir, "address");
    try {
      // 1. the file alone (no DATABASE_URL): the script connects and gets as far as judging the password
      fs.writeFileSync(file, `DATABASE_URL="${ADDRESS}"\n`);
      const viaFile = await run(["--stdin"], { database: DB_NAME, email: "file.dev@example.test", name: NAME, password: "weak" }, { DATABASE_URL: "", DEVELOPER_ADDRESS_FILE: file });
      expect(viaFile.out).toContain("not strong enough");
      expect(viaFile.out).toContain(DB_NAME);
      expectNoSecrets(viaFile.out);

      // 2. both, and they differ: stops before anything
      fs.writeFileSync(file, "postgresql://someone:Hunter2Secret@db.example.invalid:5432/other_db\n");
      const clash = await run(["--stdin"], { database: DB_NAME }, { DEVELOPER_ADDRESS_FILE: file });
      expect(clash.code).toBe(1);
      expect(clash.out).toContain("Two different database addresses");
      expect(clash.out).not.toContain("Hunter2Secret");
      expectNoSecrets(clash.out);

      // 3. neither
      const none = await run(["--stdin"], { database: DB_NAME }, { DATABASE_URL: "", DEVELOPER_ADDRESS_FILE: path.join(dir, "missing") });
      expect(none.code).toBe(1);
      expect(none.out).toContain("no database address");

      // 4. an address that cannot be reached: the message holds neither the password, the user nor the host
      const dead = "postgresql://devuser:Hunter2Secret@127.0.0.1:1/vegas_hotel_test_unreachable";
      const unreachable = await run(["--stdin"], { database: "vegas_hotel_test_unreachable" }, { DATABASE_URL: dead });
      expect(unreachable.code).toBe(1);
      expect(unreachable.out).toContain("Could not connect");
      for (const secret of ["Hunter2Secret", "devuser", "127.0.0.1", dead]) expect(unreachable.out).not.toContain(secret);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
    expect(await db.user.count({ where: { email: { in: ["file.dev@example.test", "later.dev@example.test"] } } })).toBe(0);
  });

  it("knows no stray options (a typo never silently creates an account)", async () => {
    const r = await run(["--stdin", "--rotat"], { database: DB_NAME });
    expect(r.code).toBe(1);
    expect(r.out).toContain("--rotat");
    const both = await run(["--stdin", "--rotate", "--deactivate"], { database: DB_NAME });
    expect(both.code).toBe(1);
    expect(await developers()).toHaveLength(1);
  });

  it("a password made for the person (password=@generate): shown ONCE on the screen, verifies with the app's own check, and is never in the audit entry or the hash text", async () => {
    await cleanup(); // the tests above leave a Developer behind; this one starts from none
    const r = await create({ password: "@generate" });
    expect(r.code, r.out).toBe(0);
    expect(r.out).toContain("DONE");
    expect(r.out).toContain("YOUR PASSWORD");
    // The one line that carries it: 21 characters from the secure source, ending with the symbol.
    const shown = r.out.split("\n").map((l) => l.trim()).filter((l) => /^[A-Za-z0-9_-]{20}!$/.test(l));
    expect(shown).toHaveLength(1);
    const made = shown[0];
    expect(r.out.split(made).length - 1).toBe(1); // exactly once
    const dev = (await developers())[0];
    expect(await verifyPassword(dev.passwordHash, made)).toBe(true);
    expect(dev.passwordHash).not.toContain(made);
    const entries = await developerAudit("developer.provisioned");
    expect(JSON.stringify(entries)).not.toContain(made);
    // The word @generate is only a request: it is never stored as the password.
    expect(await verifyPassword(dev.passwordHash, "@generate")).toBe(false);
  });
});
