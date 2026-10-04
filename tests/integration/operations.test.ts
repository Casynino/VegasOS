import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/server/db";
import { endShift, generateRotation, setSchedule, startShift, swapShifts, closeShiftAsManager } from "@/server/services/shifts";
import { recordExpense, reviewExpense, voidExpense, correctExpense } from "@/server/services/expenses";
import { businessDateOf } from "@/lib/time/business-date";
import { managerActor, resetBusinessData } from "../support/helpers";

beforeEach(resetBusinessData);

const today = () => businessDateOf(new Date());
async function staff(email: string) {
  const u = await db.user.findUniqueOrThrow({ where: { email }, include: { role: { include: { permissions: { include: { permission: true } } } } } });
  return { userId: u.id, label: u.fullName, permissions: new Set(u.role.permissions.map((p) => p.permission.code)) as ReadonlySet<string>, roleCode: u.role.code };
}

describe("shifts", () => {
  it("rotation, scheduled vs actual, replacement reason, one open shift — never taken over: a manager closes it, saying why", async () => {
    const m = await managerActor();
    const mgr = { ...m, userId: m.userId!, permissions: m.permissions! };
    const asha = await staff("asha@vegas.test");
    const neema = await staff("neema@vegas.test");
    const rehema = await staff("rehema@vegas.test");
    const res = await generateRotation(mgr, { from: today(), days: 6, userIds: [asha.userId, neema.userId, rehema.userId], overwrite: false });
    expect(res.created).toBe(6);
    const sched = await db.shiftSchedule.findMany({ orderBy: { businessDate: "asc" }, include: { scheduledUser: true } });
    expect(sched.map((s) => s.scheduledUser.fullName.split(" ")[0])).toEqual(["Asha", "Neema", "Rehema", "Asha", "Neema", "Rehema"]);

    // Neema is not scheduled today → must give a reason.
    await expect(startShift(neema, {})).rejects.toThrow(/not the scheduled receptionist/);
    await startShift(asha, {});
    // Two receptionists may work together — never a third: they ask one of them to end their shift.
    const together = await startShift(neema, { replacementReason: "Busy day — two at the desk" });
    await expect(startShift(rehema, { replacementReason: "x" })).rejects.toThrow(/already has 2 receptionists on shift: Asha .* and Neema .*contact one of them to end their shift/);
    await endShift(neema, "");
    expect((await db.actualShift.findUniqueOrThrow({ where: { id: together.id } })).endedAt).not.toBeNull();
    // A receptionist cannot close a colleague's shift; a manager can, with the reason.
    await expect(closeShiftAsManager(rehema, (await db.actualShift.findFirstOrThrow({ where: { endedAt: null } })).id, "Went home")).rejects.toThrow(/Only a manager/);
    const open = await db.actualShift.findFirstOrThrow({ where: { endedAt: null } });
    await expect(closeShiftAsManager(mgr, open.id, "")).rejects.toThrow(/Say why/);
    await closeShiftAsManager(mgr, open.id, "Asha went home sick without closing");
    expect(await db.actualShift.findUniqueOrThrow({ where: { id: open.id } })).toMatchObject({ closedById: mgr.userId, closeReason: "Asha went home sick without closing" });
    const s = await startShift(rehema, { replacementReason: "Covering for Asha" });
    expect(s.isReplacement).toBe(true);
    await endShift(rehema, "Room 204 needs towels");
    expect(await db.actualShift.findUniqueOrThrow({ where: { id: s.id } })).toMatchObject({ closedById: rehema.userId, closeReason: null });
    expect(await db.shiftHandoverNote.count({ where: { body: "Room 204 needs towels" } })).toBe(1);
    // No automatic money note at the close any more (who owes is live; what was collected is in the shift report).
    expect(await db.shiftHandoverNote.count({ where: { body: { contains: "Collected this shift" } } })).toBe(0);
    expect(await db.auditLog.count({ where: { action: { in: ["shift.started", "shift.closed_by_manager", "shift.ended"] } } })).toBe(6);
  });

  it("swap exchanges two scheduled days", async () => {
    const mgr = { ...(await managerActor()), userId: (await managerActor()).userId! };
    const asha = await staff("asha@vegas.test");
    const neema = await staff("neema@vegas.test");
    await setSchedule(mgr, "2026-12-01", asha.userId);
    await setSchedule(mgr, "2026-12-02", neema.userId);
    await swapShifts(mgr, "2026-12-01", "2026-12-02");
    const d1 = await db.shiftSchedule.findFirstOrThrow({ where: { businessDate: new Date("2026-12-01T00:00:00Z") } });
    expect(d1.scheduledUserId).toBe(neema.userId);
  });
});

describe("expenses", () => {
  it("small expense recorded directly; large one needs approval; approver cannot be the creator", async () => {
    const asha = await staff("asha@vegas.test");
    const mgr = await staff("manager@vegas.test");
    const cat = await db.expenseCategory.findUniqueOrThrow({ where: { code: "HOUSEKEEPING" } });
    const small = await recordExpense({ categoryId: cat.id, amount: 15_000, description: "Detergent", accountId: "acct_cash" }, asha);
    expect(small.status).toBe("RECORDED");
    const large = await recordExpense({ categoryId: cat.id, amount: 250_000, description: "Carpet cleaning", accountId: "acct_cash" }, asha);
    expect(large.status).toBe("PENDING_APPROVAL");
    await expect(reviewExpense(large.id, "APPROVED", "", asha)).rejects.toThrow(/Only a manager/);
    await expect(reviewExpense(large.id, "REJECTED", "", mgr)).rejects.toThrow(/Explain why/);
    await reviewExpense(large.id, "CORRECTION_REQUESTED", "Attach receipt", mgr);
    await expect(correctExpense(large.id, { categoryId: cat.id, amount: 240_000, description: "Carpet cleaning (corrected)" }, asha)).rejects.toThrow(/why/);
    await correctExpense(large.id, { categoryId: cat.id, amount: 240_000, description: "Carpet cleaning (corrected)" }, asha, "Receipt attached");
    expect((await db.expense.findUniqueOrThrow({ where: { id: large.id } })).status).toBe("PENDING_APPROVAL");
    await reviewExpense(large.id, "APPROVED", "", mgr);
    const own = await recordExpense({ categoryId: cat.id, amount: 300_000, description: "Manager own", accountId: "acct_cash" }, mgr);
    await expect(reviewExpense(own.id, "APPROVED", "", mgr)).rejects.toThrow(/cannot approve your own/);
  });

  it("expenses are voided, never deleted, and use the 04:00 business date", async () => {
    const asha = await staff("manager@vegas.test"); // expenses are managers' (reception no longer records them)
    const cat = await db.expenseCategory.findUniqueOrThrow({ where: { code: "TRANSPORT" } });
    const e = await recordExpense({ categoryId: cat.id, amount: 50_000, description: "Generator fuel", accountId: "acct_cash", spentAt: new Date("2026-09-24T23:30:00Z") }, asha); // 02:30 EAT on 25th
    expect(e.businessDate.toISOString().slice(0, 10)).toBe("2026-09-24");
    await expect(voidExpense(e.id, " ", asha)).rejects.toThrow(/reason/i);
    await voidExpense(e.id, "Duplicate entry", asha); // anyone who records expenses may cancel one — it stays, struck through
    const after = await db.expense.findUniqueOrThrow({ where: { id: e.id } });
    expect(after.status).toBe("VOIDED");
    expect(await db.expenseApproval.count({ where: { expenseId: e.id, action: "VOIDED" } })).toBe(1);
  });
});

describe("each receptionist's shift", () => {
  it("what they do and collect inside their own shift belongs to it; the handover says what they collected; a reversal shows apart", async () => {
    const { checkIn, createReservation } = await import("@/server/services/reservations");
    const { recordReservationPayment, reversePayment } = await import("@/server/services/payments");
    const { shiftDetail, shiftHistory } = await import("@/server/services/shifts");
    const asha = await staff("asha@vegas.test");
    const m = await managerActor();
    const shift = await startShift(asha, {});
    const room = await db.room.findUniqueOrThrow({ where: { number: "305" } });
    const t = today();
    const r = await createReservation({
      sourceCode: "WALK_IN", guest: { fullName: "John Shift", phone: "0712 404 505" }, stay: { kind: "overnight", arrivalDate: t, departureDate: (await import("@/lib/time/business-date")).addDays(t, 1) },
      rooms: [{ roomTypeId: room.roomTypeId, roomId: room.id, adults: 1, children: 0, discountPerNight: 0 }],
    }, asha);
    await checkIn(r.id, asha);
    await recordReservationPayment({ reservationId: r.id, amount: 50_000, accountId: "acct_cash" }, asha);
    const wrong = await recordReservationPayment({ reservationId: r.id, amount: 10_000, accountId: "acct_cash" }, asha);
    await reversePayment(wrong.id, "Typed twice", { ...m, permissions: m.permissions! });

    const d = (await shiftDetail(shift.id))!;
    expect(d.person.id).toBe(asha.userId);
    expect(d.counts).toMatchObject({ checkIns: 1, bookings: 1 });
    expect(d.money).toMatchObject({ collected: 50_000, payments: 1, reversed: 10_000 });
    expect(d.money.byKind).toEqual([{ name: "Cash", amount: 50_000 }]);

    await endShift(asha, "All quiet");
    expect(await db.actualShift.findUniqueOrThrow({ where: { id: shift.id } })).toMatchObject({ closedById: asha.userId });
    const ended = await db.auditLog.findFirstOrThrow({ where: { action: "shift.ended", entityId: shift.id } });
    expect(ended.after).toMatchObject({ collected: 50_000, reversed: 10_000, byKind: [{ name: "Cash", amount: 50_000 }] });
    // A payment after the shift closed does not belong to it.
    await startShift(await staff("neema@vegas.test"), { replacementReason: "Evening cover" });
    expect((await shiftDetail(shift.id))!.money.collected).toBe(50_000);
    expect((await shiftHistory({ userId: asha.userId }))).toEqual([expect.objectContaining({ id: shift.id, open: false, collected: 50_000, closedBy: null })]);
  });

  it("only a receptionist needs a shift to work — managers, the MD and waiters do not", async () => {
    const { needsOwnShift } = await import("@/lib/permissions");
    expect(needsOwnShift((await staff("asha@vegas.test")).permissions)).toBe(true);
    expect(needsOwnShift((await staff("manager@vegas.test")).permissions)).toBe(false);
    expect(needsOwnShift((await staff("admin@vegas.test")).permissions)).toBe(false);
    expect(needsOwnShift((await staff("waiter@vegas.test")).permissions)).toBe(false);
  });
});
