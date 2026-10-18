import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { auditWho, plainWho } from "@/lib/audit-who";
import { doneByText } from "@/lib/done-by-text";
import { developerMarks, markFor, MARK_CHECKED_IN, MARK_CREATED } from "@/server/services/developer-marks";
import { makeT } from "@/i18n/translate";

/**
 * "Done by Developer": the audit row is the mark. Rows are made directly here (the work-as remap that writes them is proved in developer-workas.test.ts),
 * for records of a kind no other test file uses, so nothing else's rows can be in the way.
 */
const KIND = "MarkTestRecord";
const day = new Date("2041-05-05T00:00:00Z");
const LABEL = "Nino (Developer) as Neema (Receptionist)";
const row = (entityId: string, action: string, over: Record<string, unknown> = {}) => db.auditLog.create({
  data: { entityType: KIND, entityId, action, actorType: "DEVELOPER", actorRole: "DEVELOPER", actorLabel: LABEL, after: { actingAs: { id: "u-neema", name: "Neema", role: "Receptionist" } }, businessDate: day, ...over } as never,
});
const t = makeT("en", null);

describe("who the audit line says did it", () => {
  it("a Developer row says the whole truth; anyone else says their name", () => {
    expect(auditWho({ actorType: "DEVELOPER", actorLabel: LABEL, userName: "Nino" })).toEqual({ name: LABEL, developer: true, as: "Neema (Receptionist)" });
    // the Developer on his own account (not working as anyone): his name, marked as the Developer
    expect(auditWho({ actorType: "DEVELOPER", actorLabel: "Nino", userName: "Nino" })).toEqual({ name: "Nino (Developer)", developer: true, as: null });
    expect(auditWho({ actorType: "DEVELOPER", actorLabel: null, userName: "Nino" }).name).toBe("Nino (Developer)");
    expect(auditWho({ actorType: "STAFF", actorLabel: "Neema (Receptionist)", userName: "Neema" })).toEqual({ name: "Neema", developer: false, as: null });
    expect(auditWho({ actorType: "SYSTEM", actorLabel: "system", userName: null })).toEqual({ name: "system", developer: false, as: null });
    expect(auditWho({}).name).toBeNull();
  });

  it("the brackets are cut from a staff name but NEVER from a Developer's line (they say who really acted)", () => {
    expect(plainWho(auditWho({ actorType: "STAFF", actorLabel: "Neema (Receptionist)", userName: null }))).toBe("Neema");
    expect(plainWho(auditWho({ actorType: "DEVELOPER", actorLabel: LABEL }))).toBe(LABEL);
    expect(plainWho({ name: null, developer: false, as: null })).toBeNull();
  });
});

describe("the Developer's marks on records", () => {
  beforeAll(async () => {
    await row("rec-1", "reservation.created");
    await row("rec-1", "reservation.checked_in", { createdAt: new Date("2041-05-05T10:00:00Z") });
    await row("rec-1", "reservation.checked_in", { createdAt: new Date("2041-05-05T12:00:00Z"), after: { actingAs: { id: "u-asha", name: "Asha", role: "Manager" } }, actorLabel: "Nino (Developer) as Asha (Manager)" });
    await row("rec-2", "reservation.created", { actorType: "STAFF", actorLabel: "Neema", after: null }); // a plain staff row: no mark
    await row("rec-3", "developer.exported");                                                            // the Developer's own console use: no mark
    await row("rec-4", "reservation.checked_in_failed");                                                 // a failed attempt: no mark
    await row("rec-5", "reservation.created", { actorLabel: "Nino (Developer)", after: null });          // the Developer on his own account: a mark without "as"
  });

  it("finds the Developer's rows by record, newest last, and never anyone else's", async () => {
    const marks = await developerMarks(KIND, ["rec-1", "rec-2", "rec-3", "rec-4", "rec-5", "rec-none", null, undefined, "rec-1"]);
    expect([...marks.keys()].sort()).toEqual(["rec-1", "rec-5"]);
    expect(marks.get("rec-1")!.map((m) => m.action)).toEqual(["reservation.created", "reservation.checked_in", "reservation.checked_in"]);
    expect(marks.get("rec-1")![0].as).toEqual({ id: "u-neema", name: "Neema", role: "Receptionist" });
    expect(marks.get("rec-5")![0].as).toBeNull();
  });

  it("each line asks for its own action: 'checked in by' is not 'booked by'", async () => {
    const marks = await developerMarks(KIND, ["rec-1"], { actions: MARK_CHECKED_IN });
    expect(marks.get("rec-1")!.map((m) => m.action)).toEqual(["reservation.checked_in", "reservation.checked_in"]);
    const all = await developerMarks(KIND, ["rec-1"]);
    expect(markFor(all, "rec-1", { actions: MARK_CREATED })!.action).toBe("reservation.created");
    expect(markFor(all, "rec-1", { actions: MARK_CHECKED_IN })!.as!.name).toBe("Asha"); // the newest check-in
    expect(markFor(all, "rec-1", { actions: ["reservation.checked_out"] })).toBeNull();
    expect(markFor(all, "nobody")).toBeNull();
    expect(markFor(all, null)).toBeNull();
  });

  it("a record that shares its key with many others is matched by TIME (the audit row is written a moment after the record)", async () => {
    const all = await developerMarks(KIND, ["rec-1"], { actions: MARK_CHECKED_IN });
    expect(markFor(all, "rec-1", { near: new Date("2041-05-05T10:00:02Z") })!.as!.name).toBe("Neema");
    expect(markFor(all, "rec-1", { near: new Date("2041-05-05T12:00:01Z") })!.as!.name).toBe("Asha");
    expect(markFor(all, "rec-1", { near: new Date("2041-05-05T11:00:00Z") })).toBeNull(); // nobody acted near it
    expect(markFor(all, "rec-1", { near: new Date("2041-05-05T11:00:00Z"), windowMs: 2 * 3600_000 })).not.toBeNull();
  });

  it("only a mark made AS the person the record names counts: a second person acting within seconds does not get the Developer's tag", async () => {
    const all = await developerMarks(KIND, ["rec-1"], { actions: MARK_CHECKED_IN });
    const near = new Date("2041-05-05T10:00:02Z"); // the Developer checked a room in as Neema at 10:00:00
    expect(markFor(all, "rec-1", { near, who: "Neema" })!.as!.name).toBe("Neema");
    expect(markFor(all, "rec-1", { near, who: "Neema · Reception" })!.as!.name).toBe("Neema"); // the stored name may carry the desk
    expect(markFor(all, "rec-1", { near, who: "Asha" }), "Asha checked the other room in two seconds later, on her own").toBeNull();
    expect(markFor(all, "rec-1", { near, who: null })!.as!.name, "an unknown name does not argue").toBe("Neema");
  });

  it("many ids are read in a few queries and the answer is the same; nothing is written", async () => {
    const ids = Array.from({ length: 1200 }, (_, i) => `bulk-${i}`);
    const before = await db.auditLog.count();
    const marks = await developerMarks(KIND, [...ids, "rec-1"]);
    expect([...marks.keys()]).toEqual(["rec-1"]);
    expect(await db.auditLog.count()).toBe(before);
  });

  it("the words of the tag: with who he acted as, or without", () => {
    expect(doneByText(t, { as: { id: null, name: "Neema", role: null } })).toBe("Done by Developer · as Neema");
    expect(doneByText(t, { as: null })).toBe("Done by Developer");
    expect(doneByText(t, null)).toBeNull();
  });
});
