import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { audit } from "@/server/audit";
import { makeSession, makeUser, removeMadeUsers, type MadeUser } from "../support/developer";
import { resetBusinessData } from "../support/helpers";

/**
 * The audit trail can only be added to (owner, 2026-10-14): the database refuses UPDATE and DELETE on audit_logs — for the app
 * and for anyone with a query tool — unless a maintenance script (or the app's one "cancel check-in marks the earlier entry"
 * step) switches vegas.audit_maintenance on INSIDE its own transaction. The one automatic exception is the database blanking the
 * link to an account when that account row is removed.
 */
const REFUSED = /audit trail cannot be changed or deleted/i;
const MAINTENANCE_ON = `SELECT set_config('vegas.audit_maintenance', 'on', true)`;
const MAINTENANCE_OFF = `SELECT set_config('vegas.audit_maintenance', 'off', true)`;

let dev: MadeUser;
let rec: MadeUser;

async function write(user: MadeUser, tag = randomUUID().slice(0, 8)) {
  const entityId = `immutable-${tag}`;
  await audit(db, { userId: user.id, label: user.fullName }, { action: `test.immutable.${tag}`, entityType: "Test", entityId, before: { n: 1 }, after: { n: 2 } });
  return db.auditLog.findFirstOrThrow({ where: { entityId } });
}
const count = () => db.auditLog.count();

beforeAll(async () => {
  dev = await makeUser("DEVELOPER", { fullName: "Dev Immutable" });
  rec = await makeUser("RECEPTIONIST", { fullName: "Rec Immutable" });
});
afterAll(async () => {
  await removeMadeUsers();
});

describe("audit_logs: only inserts", () => {
  it("a new entry can be written", async () => {
    const before = await count();
    const row = await write(dev);
    expect(await count()).toBe(before + 1);
    expect(row.actorType).toBe("DEVELOPER");
  });

  it("UPDATE is refused: raw SQL, update and updateMany; the row stays as it was", async () => {
    const row = await write(rec);

    await expect(db.$executeRaw`UPDATE "audit_logs" SET "action" = 'changed' WHERE "id" = ${row.id}`).rejects.toThrow(REFUSED);
    await expect(db.auditLog.update({ where: { id: row.id }, data: { action: "changed" } })).rejects.toThrow(REFUSED);
    await expect(db.auditLog.updateMany({ where: { id: row.id }, data: { action: "changed" } })).rejects.toThrow(REFUSED);
    await expect(db.auditLog.updateMany({ data: { actorType: "STAFF" } })).rejects.toThrow(REFUSED); // "hide the Developer's work" in one go

    expect(await db.auditLog.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
  });

  it("every column that says who / what / when / how it changed is protected (raw SQL)", async () => {
    const row = await write(dev);
    const attempts = [
      db.$executeRaw`UPDATE "audit_logs" SET "actorType" = 'STAFF' WHERE "id" = ${row.id}`,
      db.$executeRaw`UPDATE "audit_logs" SET "actorRole" = 'RECEPTIONIST' WHERE "id" = ${row.id}`,
      db.$executeRaw`UPDATE "audit_logs" SET "actorLabel" = 'someone else' WHERE "id" = ${row.id}`,
      db.$executeRaw`UPDATE "audit_logs" SET "before" = '{"n": 99}'::jsonb WHERE "id" = ${row.id}`,
      db.$executeRaw`UPDATE "audit_logs" SET "after" = '{"n": 99}'::jsonb WHERE "id" = ${row.id}`,
      db.$executeRaw`UPDATE "audit_logs" SET "entityId" = 'other' WHERE "id" = ${row.id}`,
      db.$executeRaw`UPDATE "audit_logs" SET "createdAt" = now() - interval '3 days' WHERE "id" = ${row.id}`,
      db.$executeRaw`UPDATE "audit_logs" SET "businessDate" = '2020-01-01' WHERE "id" = ${row.id}`,
      db.$executeRaw`UPDATE "audit_logs" SET "id" = 'new-id' WHERE "id" = ${row.id}`,
    ];
    for (const a of attempts) await expect(a).rejects.toThrow(REFUSED);
    expect(await db.auditLog.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
  });

  it("the account link cannot be moved to someone else, nor blanked together with any other change", async () => {
    const row = await write(dev);
    await expect(db.$executeRaw`UPDATE "audit_logs" SET "userId" = ${rec.id} WHERE "id" = ${row.id}`).rejects.toThrow(REFUSED);
    await expect(db.$executeRaw`UPDATE "audit_logs" SET "userId" = NULL, "actorType" = 'STAFF' WHERE "id" = ${row.id}`).rejects.toThrow(REFUSED);
    await expect(db.$executeRaw`UPDATE "audit_logs" SET "userId" = NULL, "after" = '{}'::jsonb WHERE "id" = ${row.id}`).rejects.toThrow(REFUSED);
    await expect(db.auditLog.updateMany({ where: { id: row.id }, data: { userId: null, actorLabel: "nobody" } })).rejects.toThrow(REFUSED);
    expect(await db.auditLog.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
  });

  it("DELETE is refused: raw SQL, delete, deleteMany (one row, a person's rows, all rows)", async () => {
    const row = await write(rec);
    const total = await count();

    await expect(db.$executeRaw`DELETE FROM "audit_logs" WHERE "id" = ${row.id}`).rejects.toThrow(REFUSED);
    await expect(db.auditLog.delete({ where: { id: row.id } })).rejects.toThrow(REFUSED);
    await expect(db.auditLog.deleteMany({ where: { userId: rec.id } })).rejects.toThrow(REFUSED);
    await expect(db.auditLog.deleteMany({})).rejects.toThrow(REFUSED);
    await expect(db.$executeRawUnsafe(`DELETE FROM "audit_logs"`)).rejects.toThrow(REFUSED);

    expect(await count()).toBe(total);
    expect(await db.auditLog.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
  });

  it("a refused change inside a transaction rolls the whole transaction back, so nothing half-done is kept", async () => {
    const row = await write(rec);
    const other = await write(rec);
    await expect(db.$transaction(async (tx) => {
      await audit(tx, { userId: rec.id, label: rec.fullName }, { action: "test.immutable.rolled_back", entityType: "Test", entityId: "rolled-back" });
      await tx.auditLog.update({ where: { id: other.id }, data: { action: "changed" } });
    })).rejects.toThrow(REFUSED);
    expect(await db.auditLog.count({ where: { entityId: "rolled-back" } })).toBe(0);
    expect(await db.auditLog.findUniqueOrThrow({ where: { id: other.id } })).toEqual(other);
    expect(await db.auditLog.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
  });
});

describe("audit_logs: maintenance mode is for one transaction only", () => {
  it("inside one transaction that switches it on, an update works", async () => {
    const row = await write(rec);
    await db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(MAINTENANCE_ON);
      await tx.auditLog.update({ where: { id: row.id }, data: { action: "test.immutable.marked" } });
    });
    expect((await db.auditLog.findUniqueOrThrow({ where: { id: row.id } })).action).toBe("test.immutable.marked");
  });

  it("inside one transaction that switches it on, a delete works", async () => {
    const row = await write(rec);
    await db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(MAINTENANCE_ON);
      await tx.auditLog.delete({ where: { id: row.id } });
    });
    expect(await db.auditLog.findUnique({ where: { id: row.id } })).toBeNull();
  });

  it("the next plain statement is refused again (several connections tried), after the transaction ends", async () => {
    const row = await write(rec);
    await db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(MAINTENANCE_ON);
      await tx.auditLog.update({ where: { id: row.id }, data: { action: "test.immutable.once" } });
    });
    const tries = await Promise.allSettled(Array.from({ length: 8 }, () => db.auditLog.updateMany({ where: { id: row.id }, data: { action: "test.immutable.again" } })));
    expect(tries.every((t) => t.status === "rejected" && REFUSED.test(String(t.reason)))).toBe(true);
    await expect(db.$executeRaw`DELETE FROM "audit_logs" WHERE "id" = ${row.id}`).rejects.toThrow(REFUSED);
    expect((await db.auditLog.findUniqueOrThrow({ where: { id: row.id } })).action).toBe("test.immutable.once");
  });

  it("switched off again inside the same transaction, the next statement is refused (and the transaction fails)", async () => {
    const row = await write(rec);
    await expect(db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(MAINTENANCE_ON);
      await tx.auditLog.update({ where: { id: row.id }, data: { action: "test.immutable.step1" } });
      await tx.$queryRawUnsafe(MAINTENANCE_OFF);
      await tx.auditLog.update({ where: { id: row.id }, data: { action: "test.immutable.step2" } });
    })).rejects.toThrow(REFUSED);
    // all or nothing: the first step was rolled back with the failed second one
    expect(await db.auditLog.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
  });

  it("a transaction that switched it on and was rolled back leaves nothing switched on", async () => {
    const row = await write(rec);
    await expect(db.$transaction(async (tx) => {
      await tx.$queryRawUnsafe(MAINTENANCE_ON);
      throw new Error("script failed");
    })).rejects.toThrow("script failed");
    await expect(db.auditLog.update({ where: { id: row.id }, data: { action: "x" } })).rejects.toThrow(REFUSED);
  });

  it("only the exact value 'on' unlocks it", async () => {
    const row = await write(rec);
    for (const value of ["true", "1", "yes", "ON ", "off", ""]) {
      await expect(db.$transaction(async (tx) => {
        await tx.$queryRawUnsafe(`SELECT set_config('vegas.audit_maintenance', '${value}', true)`);
        await tx.auditLog.update({ where: { id: row.id }, data: { action: "x" } });
      }), `value "${value}"`).rejects.toThrow(REFUSED);
    }
    expect(await db.auditLog.findUniqueOrThrow({ where: { id: row.id } })).toEqual(row);
  });
});

describe("audit_logs: when an account is removed", () => {
  it("the database blanks only the link to the account — the entry keeps its name, type, role, details and time", async () => {
    const gone = await makeUser("DEVELOPER", { fullName: "Dev To Remove" });
    await makeSession(gone.id, { setCookie: false });
    const a = await write(gone, "gone-a");
    const b = await audit(db, { userId: gone.id, label: gone.fullName, ipAddress: "41.1.2.3" }, { action: "test.immutable.gone-b", entityType: "Test", entityId: "gone-b", before: { x: 1 }, after: { y: [1, 2] } })
      .then(() => db.auditLog.findFirstOrThrow({ where: { entityId: "gone-b" } }));
    expect(a.userId).toBe(gone.id);
    const total = await count();

    await db.user.delete({ where: { id: gone.id } });

    expect(await count()).toBe(total); // no entry went away
    expect(await db.session.count({ where: { userId: gone.id } })).toBe(0);
    for (const before of [a, b]) {
      const after = await db.auditLog.findUniqueOrThrow({ where: { id: before.id } });
      expect(after.userId).toBeNull();
      expect({ ...after, userId: "-" }).toEqual({ ...before, userId: "-" }); // every other column is exactly as written
      expect(after.actorLabel).toBe("Dev To Remove");
      expect(after.actorType).toBe("DEVELOPER");
      expect(after.actorRole).toBe("DEVELOPER");
    }
  });
});

describe("audit_logs: TRUNCATE (what resetBusinessData does) still works", () => {
  it("TRUNCATE empties the table and new entries can be written afterwards", async () => {
    await write(rec);
    expect(await count()).toBeGreaterThan(0);
    await db.$executeRawUnsafe(`TRUNCATE "audit_logs"`);
    expect(await count()).toBe(0);
    await write(rec);
    expect(await count()).toBe(1);
  });

  it("resetBusinessData() clears it too", async () => {
    await write(rec);
    await resetBusinessData();
    expect(await count()).toBe(0);
  });
});
