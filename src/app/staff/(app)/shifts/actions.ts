"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { z } from "zod";
import { authorize, requestMeta, type CurrentUser } from "@/server/auth";
import { runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { addHandoverNote, closeShiftAsManager, endShift, generateRotation, resolveHandoverNote, setSchedule, startShift, swapShifts } from "@/server/services/shifts";
import { afterShiftClosed } from "@/server/services/shift-report";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { toDbDate } from "@/lib/time/business-date";
import { inHouseBalances } from "@/server/services/guest-balances";
import { REQUEST_TYPE_LABEL } from "@/lib/request-meta";
import { msg } from "@/i18n/msg";
import { getT } from "@/i18n/server";

async function actor(user: CurrentUser) {
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, ipAddress, permissions: user.permissions };
}
const refresh = () => { revalidatePath("/staff/shifts", "layout"); revalidatePath("/staff", "layout"); revalidatePath("/reception", "layout"); };

/** Start my shift — never someone else's: if a shift is open under another receptionist, they close it (or a manager does). */
export async function startShiftAction(input: { replacementReason?: string }) {
  return runAction(async () => {
    const user = await authorize("shifts.work");
    await startShift(await actor(user), { replacementReason: input.replacementReason ?? null });
    refresh();
    return null;
  }, msg("Shift started. Have a good shift!"));
}

/**
 * Before I end my shift: what is still open — guest requests with me (they go back to New for the next shift), arrivals
 * not checked in, departures not checked out, and who still owes. Shown in the end-shift confirmation.
 */
export async function myShiftWorkAction() {
  return runAction(async () => {
    const user = await authorize("shifts.work");
    const today = toDbDate(await businessToday());
    const t = await getT();
    const [requests, arrivals, departures, balances] = await Promise.all([
      db.serviceRequest.findMany({ where: { assignedToId: user.id, status: { in: ["ASSIGNED", "IN_PROGRESS"] } }, orderBy: { createdAt: "asc" }, select: { id: true, type: true, status: true, room: { select: { number: true } } } }),
      db.reservation.count({ where: { arrivalDate: { lte: today }, status: { in: ["RESERVED", "CONFIRMED"] } } }),
      db.reservation.count({ where: { departureDate: { lte: today }, status: "CHECKED_IN" } }),
      inHouseBalances(await businessToday()),
    ]);
    return {
      requests: requests.map((r) => ({ id: r.id, what: `${t(REQUEST_TYPE_LABEL[r.type] ?? msg("Request"))}${r.room ? ` · ${t("Room {room}", { room: r.room.number })}` : ""}`, onIt: r.status === "IN_PROGRESS" })),
      arrivals, departures, owing: { count: balances.summary.owingCount, total: balances.summary.totalOutstanding },
    };
  });
}

/** Close my own shift (the handover is saved with who still owes and what I collected). */
export async function endShiftAction(input: { closingNote: string }) {
  return runAction(async () => {
    const user = await authorize("shifts.work");
    const { shiftId } = await endShift(await actor(user), input.closingNote ?? "");
    // The report is made and sent to the boss after the close is saved — it can never hold the close up.
    after(() => afterShiftClosed(shiftId));
    refresh();
    return null;
  }, msg("Shift closed. Handover saved — your shift report is on its way."));
}

/** A manager closes someone's shift — always with the reason (kept and audited). */
export async function closeShiftAsManagerAction(input: { shiftId: string; reason: string }) {
  return runAction(async () => {
    const user = await authorize("shifts.manage");
    const d = parseInput(z.object({ shiftId: z.string().min(1).max(40), reason: z.string().trim().max(300) }), input);
    const r = await closeShiftAsManager(await actor(user), d.shiftId, d.reason);
    after(() => afterShiftClosed(r.shiftId));
    refresh();
    return { name: r.name };
  });
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/);

export async function setScheduleAction(input: { date: string; userId: string | null }) {
  return runAction(async () => {
    const user = await authorize("shifts.manage");
    const data = parseInput(z.object({ date, userId: z.string().nullable() }), input);
    await setSchedule(await actor(user), data.date, data.userId || null);
    refresh();
    return null;
  }, msg("Schedule updated."));
}

export async function swapShiftsAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("shifts.manage");
    const data = parseInput(z.object({ a: date, b: date }), formData);
    await swapShifts(await actor(user), data.a, data.b);
    refresh();
    return null;
  }, msg("Shifts swapped."));
}

export async function generateRotationAction(_prev: unknown, formData: FormData): Promise<ActionResult<{ created: number; updated: number }>> {
  return runAction(async () => {
    const user = await authorize("shifts.manage");
    const data = parseInput(z.object({
      from: date,
      days: z.coerce.number().int().min(1).max(92),
      userIds: z.array(z.string()).min(1, msg("Choose receptionists in rotation order.")),
      overwrite: z.preprocess((v) => v === "on", z.boolean()),
    }), formData);
    const res = await generateRotation(await actor(user), data);
    refresh();
    return res;
  }, msg("Rotation saved."));
}

export async function addNoteAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("shifts.work", "shifts.manage");
    const data = parseInput(z.object({
      body: z.string().trim().min(2, msg("Write the note.")).max(1000),
      kind: z.enum(["SHIFT", "MANAGER", "GUEST", "MAINTENANCE"]).default("SHIFT"),
      isImportant: z.preprocess((v) => v === "on", z.boolean()),
    }), formData);
    await addHandoverNote(await actor(user), data);
    refresh();
    return null;
  }, msg("Note added."));
}

export async function resolveNoteAction(input: { noteId: string }) {
  return runAction(async () => {
    const user = await authorize("shifts.work", "shifts.manage");
    await resolveHandoverNote(await actor(user), input.noteId);
    refresh();
    return null;
  }, msg("Note resolved."));
}
