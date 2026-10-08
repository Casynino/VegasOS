import "server-only";
import { inHouseBalances } from "./guest-balances";
import { db } from "../db";
import { audit, type AuditActor } from "../audit";
import { AppError, isUniqueViolation } from "../errors";
import { getSettingsTx, stayConfig } from "../settings";
import { addDays, businessDateOf, eachDate, fromDbDate, isBusinessDate, toDbDate, type BusinessDate } from "@/lib/time/business-date";
import { shiftLabel } from "@/lib/shift-label";
import { ALL_SOURCES, collectionTotals } from "./collections";
import { activityArea, friendlyAction } from "@/lib/activity-words";
import { msg, msgf } from "@/i18n/msg";
import { getT } from "@/i18n/server";
import { englishT, type T } from "@/i18n/translate";

/**
 * ShiftService — reception works one rotating shift per hotel business day
 * (04:00 → 04:00). We keep three separate facts:
 *   schedule  = who was supposed to work        (ShiftSchedule, one per date)
 *   actual    = who actually worked and when    (ActualShift, one open at a time)
 *   activity  = what they did                   (AuditLog)
 * Open → Work → Close: a receptionist works only inside their own open shift (the gate in
 * auth.ts); nobody takes over another's open shift — a manager closes it, saying why. What they
 * did and collected in a shift is read from their records inside the shift's time.
 */

/** How many receptionists may be on shift at the same time (owner, 2026-10-04) — a third asks one of them to end theirs. */
export const DESK_LIMIT = 2;

/** "Asha (since 08:02) and Neema (since 13:24)" — in the words of `t` (English by default). */
export const deskNames = (open: { startedAt: Date; user: { fullName: string } }[], timezone = "Africa/Dar_es_Salaam", t: T = englishT) => {
  const names = open.map((o) => t("{name} (since {time})", { name: o.user.fullName, time: o.startedAt.toLocaleTimeString(t.intl, { hour: "2-digit", minute: "2-digit", timeZone: timezone }) }));
  return names.length ? names.reduce((a, b) => t("{a} and {b}", { a, b })) : "";
};

export async function getShiftOverview(today: BusinessDate) {
  const [scheduledToday, scheduledTomorrow, openAll, previous] = await Promise.all([
    db.shiftSchedule.findUnique({ where: { businessDate: toDbDate(today) }, include: { scheduledUser: { select: { id: true, fullName: true } } } }),
    db.shiftSchedule.findUnique({ where: { businessDate: toDbDate(addDays(today, 1)) }, include: { scheduledUser: { select: { id: true, fullName: true } } } }),
    db.actualShift.findMany({ where: { endedAt: null, department: "RECEPTION" }, orderBy: { startedAt: "asc" }, include: { user: { select: { id: true, fullName: true } } } }),
    db.actualShift.findFirst({ where: { endedAt: { not: null }, department: "RECEPTION" }, orderBy: { endedAt: "desc" }, include: { user: { select: { id: true, fullName: true } } } }),
  ]);
  /** Everyone on reception now (up to DESK_LIMIT); `open` = the first of them; `full` = nobody else can start. */
  return { scheduledToday, scheduledTomorrow, openAll, open: openAll[0] ?? null, full: openAll.length >= DESK_LIMIT, previous };
}

export async function startShift(actor: AuditActor & { userId: string }, opts: { replacementReason?: string | null }) {
  try {
    return await db.$transaction(async (tx) => {
      const settings = await getSettingsTx(tx);
      const now = new Date();
      const today = businessDateOf(now, stayConfig(settings));
      await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('reception-shift'))::text`;

      const open = await tx.actualShift.findMany({ where: { endedAt: null, department: "RECEPTION" }, orderBy: { startedAt: "asc" }, include: { user: true } });
      if (open.some((s) => s.userId === actor.userId)) throw new AppError("Your shift is already running.");
      // Two receptionists may work together; never a third, and never taking over: one of them ends theirs — or a manager does, saying why.
      if (open.length >= DESK_LIMIT) {
        const names = deskNames(open, settings.timezone, await getT().catch(() => englishT));
        throw new AppError(msgf("Reception already has {n} receptionists on shift: {names}. Please contact one of them to end their shift, or contact the Manager if you need authorized access.", { n: open.length, names }), "CONFLICT");
      }

      const schedule = await tx.shiftSchedule.findUnique({ where: { businessDate: toDbDate(today) } });
      const isReplacement = !!schedule && schedule.scheduledUserId !== actor.userId;
      if (isReplacement && !opts.replacementReason?.trim()) {
        throw new AppError("You are not the scheduled receptionist today. Give a reason (e.g. covering for a sick colleague).", "VALIDATION", { replacementReason: msg("Required") });
      }
      const shift = await tx.actualShift.create({
        data: {
          department: "RECEPTION",
          businessDate: toDbDate(today), userId: actor.userId, scheduleId: schedule?.id ?? null,
          isReplacement, replacementReason: isReplacement ? opts.replacementReason!.trim() : null, startedAt: now,
        },
      });
      await audit(tx, actor, {
        action: "shift.started", entityType: "ActualShift", entityId: shift.id,
        after: { businessDate: today, scheduled: schedule?.scheduledUserId ?? null, isReplacement, reason: shift.replacementReason },
      });
      return shift;
    });
  } catch (e) {
    if (isUniqueViolation(e)) throw new AppError("Another shift was started at the same moment. Refresh and try again.", "CONFLICT");
    throw e;
  }
}

/** What a shift collected, in one line for the handover and the audit (from the payment records in its time). */
export async function shiftMoney(shift: { userId: string; businessDate: Date; startedAt: Date }, end: Date) {
  const day = fromDbDate(shift.businessDate);
  const t = (await collectionTotals(day, day, { collectorIds: [shift.userId], sources: ALL_SOURCES, window: { start: shift.startedAt, end } })).of(shift.userId);
  const tzs = (n: number) => `TZS ${n.toLocaleString("en-US")}`;
  const text = t.payments || t.refunds
    ? `Collected this shift: ${tzs(t.collected)} (${t.byKind.map((k) => `${k.name} ${k.amount.toLocaleString("en-US")}`).join(" · ") || "—"})${t.refunds ? ` · refunded ${tzs(t.refunds)}` : ""}${t.reversed ? ` · reversed ${tzs(t.reversed)}` : ""}`
    : "Collected this shift: nothing";
  return { text, collected: t.collected, refunds: t.refunds, reversed: t.reversed, byKind: t.byKind };
}

/** Close a shift (inside a transaction): when, by whom, the handover — who still owes money, what was collected. */
async function closeShiftTx(tx: Parameters<Parameters<typeof db.$transaction>[0]>[0], shift: { id: string; userId: string; businessDate: Date; startedAt: Date }, actor: AuditActor & { userId: string }, note: string | null, reason: string | null) {
  const now = new Date();
  const person = await tx.user.findUniqueOrThrow({ where: { id: shift.userId }, select: { fullName: true } });
  await tx.actualShift.update({ where: { id: shift.id }, data: { endedAt: now, closingNote: note, closedById: actor.userId, closeReason: reason } });
  if (note) await tx.shiftHandoverNote.create({ data: { businessDate: shift.businessDate, kind: "SHIFT", body: note, authorId: actor.userId } });
  // The handover always carries who still owes money and what this shift collected — not only keys and a guest list.
  const balances = await inHouseBalances(businessDateOf(now, stayConfig(await getSettingsTx(tx))));
  const money = await shiftMoney(shift, now);
  // Guest requests still with them go back to New — the bell rings for whoever is on next (never left with someone gone).
  // Only those still with them at this moment (one finished or taken over at the same time stays as it is).
  const before = await tx.serviceRequest.findMany({ where: { assignedToId: shift.userId, status: { in: ["ASSIGNED", "IN_PROGRESS"] } }, select: { id: true, status: true } });
  const held = before.length ? await tx.serviceRequest.updateManyAndReturn({
    where: { id: { in: before.map((r) => r.id) }, assignedToId: shift.userId, status: { in: ["ASSIGNED", "IN_PROGRESS"] } },
    data: { status: "NEW", assignedToId: null, acceptedAt: null }, select: { id: true },
  }) : [];
  for (const r of held) await audit(tx, actor, { action: "request.updated", entityType: "ServiceRequest", entityId: r.id, before: { status: before.find((b) => b.id === r.id)?.status, assignedToId: shift.userId }, after: { status: "NEW", assignedToId: null, why: "Shift ended — back to New for the next shift" } });
  // No automatic "money" note any more (owner, 2026-10-04): who owes is live on the Shifts page, and what the shift
  // collected is in its report. Only what the person wrote for the next shift is kept as a note.
  return { now, balances, money, person, released: held.length };
}

/** The receptionist closes their own shift (managers close someone else's with closeShiftAsManager). */
export async function endShift(actor: AuditActor & { userId: string; permissions: ReadonlySet<string> }, closingNote: string) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('reception-shift'))::text`;
    const shift = await tx.actualShift.findFirst({ where: { endedAt: null, userId: actor.userId, department: "RECEPTION" } });
    if (!shift) throw new AppError("You do not have an open shift.");
    const note = closingNote.trim().slice(0, 1000) || null;
    const { balances, money, released } = await closeShiftTx(tx, shift, actor, note, null);
    await audit(tx, actor, {
      action: "shift.ended", entityType: "ActualShift", entityId: shift.id,
      after: { note, collected: money.collected, byKind: money.byKind, refunds: money.refunds, reversed: money.reversed, guestsOwing: balances.summary.owingCount, totalOutstanding: balances.summary.totalOutstanding, requestsReleased: released },
    });
    return { shiftId: shift.id };
  });
}

/**
 * A manager closes someone's shift (they forgot, left, or someone must start): always with the
 * reason — kept on the shift, in the handover and in the audit, apart from a normal close.
 */
export async function closeShiftAsManager(actor: AuditActor & { userId: string; permissions: ReadonlySet<string> }, shiftId: string, reason: string) {
  if (!actor.permissions.has("shifts.manage")) throw new AppError("Only a manager can close someone's shift.", "FORBIDDEN");
  const why = reason.trim();
  if (why.length < 5) throw new AppError("Say why you close this shift (e.g. the receptionist left without closing).", "VALIDATION", { reason: msg("Required") });
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext('reception-shift'))::text`;
    const shift = await tx.actualShift.findUnique({ where: { id: shiftId } });
    if (!shift || shift.endedAt) throw new AppError("This shift is already closed.", "CONFLICT");
    if (shift.department !== "RECEPTION") throw new AppError("This is a waiter's shift — close it from the waiter's shift, handing their tables and orders to another waiter.", "CONFLICT");
    const { balances, money, person, released } = await closeShiftTx(tx, shift, actor, `Closed by manager: ${why}`, why);
    await audit(tx, actor, {
      action: "shift.closed_by_manager", entityType: "ActualShift", entityId: shift.id,
      before: { user: person.fullName, startedAt: shift.startedAt.toISOString() },
      after: { closedBy: actor.label, reason: why, collected: money.collected, byKind: money.byKind, guestsOwing: balances.summary.owingCount, totalOutstanding: balances.summary.totalOutstanding, requestsReleased: released },
    });
    return { name: person.fullName, shiftId: shift.id };
  });
}

/** People who work reception shifts: shifts.work without shifts.manage (managers, the MD and the owner never do). */
const DESK_WORKER = { AND: [{ role: { permissions: { some: { permission: { code: "shifts.work" } } } } }, { NOT: { role: { permissions: { some: { permission: { code: "shifts.manage" } } } } } }] };

export async function setSchedule(actor: AuditActor & { userId: string }, date: BusinessDate, userId: string | null, notes?: string | null) {
  if (!isBusinessDate(date)) throw new AppError("Invalid date.");
  return db.$transaction(async (tx) => {
    const before = await tx.shiftSchedule.findUnique({ where: { businessDate: toDbDate(date) }, include: { scheduledUser: true } });
    if (!userId) {
      if (!before) return;
      if (await tx.actualShift.count({ where: { scheduleId: before.id } })) throw new AppError("This day already has a worked shift; change the person instead of clearing it.");
      await tx.shiftSchedule.delete({ where: { id: before.id } });
      await audit(tx, actor, { action: "shift.schedule_cleared", entityType: "ShiftSchedule", entityId: before.id, before: { date, user: before.scheduledUser.fullName } });
      return;
    }
    const user = await tx.user.findFirst({ where: { id: userId, isActive: true, ...DESK_WORKER } });
    if (!user) throw new AppError("Choose an active receptionist.");
    const row = await tx.shiftSchedule.upsert({
      where: { businessDate: toDbDate(date) },
      update: { scheduledUserId: userId, notes: notes ?? null },
      create: { businessDate: toDbDate(date), scheduledUserId: userId, notes: notes ?? null, createdById: actor.userId },
    });
    await audit(tx, actor, {
      action: before ? "shift.schedule_changed" : "shift.scheduled", entityType: "ShiftSchedule", entityId: row.id,
      before: before ? { date, user: before.scheduledUser.fullName } : undefined, after: { date, user: user.fullName, notes },
    });
  });
}

export async function swapShifts(actor: AuditActor & { userId: string }, a: BusinessDate, b: BusinessDate) {
  return db.$transaction(async (tx) => {
    const [sa, sb] = await Promise.all([
      tx.shiftSchedule.findUnique({ where: { businessDate: toDbDate(a) }, include: { scheduledUser: true } }),
      tx.shiftSchedule.findUnique({ where: { businessDate: toDbDate(b) }, include: { scheduledUser: true } }),
    ]);
    if (!sa || !sb) throw new AppError("Both days must have a scheduled receptionist to swap.");
    await tx.shiftSchedule.update({ where: { id: sa.id }, data: { scheduledUserId: sb.scheduledUserId } });
    await tx.shiftSchedule.update({ where: { id: sb.id }, data: { scheduledUserId: sa.scheduledUserId } });
    await audit(tx, actor, {
      action: "shift.swapped", entityType: "ShiftSchedule", entityId: sa.id,
      before: { [a]: sa.scheduledUser.fullName, [b]: sb.scheduledUser.fullName },
      after: { [a]: sb.scheduledUser.fullName, [b]: sa.scheduledUser.fullName },
    });
  });
}

/** Fill a date range by rotating through receptionists in order. */
export async function generateRotation(
  actor: AuditActor & { userId: string },
  input: { from: BusinessDate; days: number; userIds: string[]; overwrite: boolean },
) {
  if (input.userIds.length === 0) throw new AppError("Choose at least one receptionist.");
  if (input.days < 1 || input.days > 92) throw new AppError("Generate between 1 and 92 days at a time.");
  const dates = eachDate(input.from, addDays(input.from, input.days));
  return db.$transaction(async (tx) => {
    const users = await tx.user.findMany({ where: { id: { in: input.userIds }, isActive: true, ...DESK_WORKER } });
    if (users.length !== new Set(input.userIds).size) throw new AppError("Choose active receptionists only.");
    const existing = await tx.shiftSchedule.findMany({ where: { businessDate: { in: dates.map(toDbDate) } } });
    const taken = new Set(existing.map((e) => fromDbDate(e.businessDate)));
    let created = 0, updated = 0;
    for (const [i, d] of dates.entries()) {
      const userId = input.userIds[i % input.userIds.length];
      if (taken.has(d)) {
        if (!input.overwrite) continue;
        await tx.shiftSchedule.update({ where: { businessDate: toDbDate(d) }, data: { scheduledUserId: userId } });
        updated++;
      } else {
        await tx.shiftSchedule.create({ data: { businessDate: toDbDate(d), scheduledUserId: userId, createdById: actor.userId } });
        created++;
      }
    }
    await audit(tx, actor, {
      action: "shift.rotation_generated", entityType: "ShiftSchedule",
      after: { from: input.from, days: input.days, order: users.map((u) => u.fullName), created, updated },
    });
    return { created, updated };
  });
}

export async function addHandoverNote(
  actor: AuditActor & { userId: string; permissions: ReadonlySet<string> },
  input: { body: string; kind: "SHIFT" | "MANAGER" | "GUEST" | "MAINTENANCE"; isImportant: boolean },
) {
  if (!input.body.trim()) throw new AppError("Write the note first.", "VALIDATION", { body: msg("Required") });
  if (input.kind === "MANAGER" && !actor.permissions.has("shifts.manage")) throw new AppError("Only managers can post manager notes.", "FORBIDDEN");
  return db.$transaction(async (tx) => {
    const settings = await getSettingsTx(tx);
    const note = await tx.shiftHandoverNote.create({
      data: {
        businessDate: toDbDate(businessDateOf(new Date(), stayConfig(settings))), kind: input.kind,
        body: input.body.trim(), isImportant: input.isImportant, authorId: actor.userId,
      },
    });
    await audit(tx, actor, { action: "shift.note_added", entityType: "ShiftHandoverNote", entityId: note.id, after: { kind: input.kind, important: input.isImportant } });
    return note;
  });
}

export async function resolveHandoverNote(actor: AuditActor, noteId: string) {
  return db.$transaction(async (tx) => {
    const note = await tx.shiftHandoverNote.findUnique({ where: { id: noteId } });
    if (!note || note.resolvedAt) throw new AppError("Note not found or already resolved.");
    await tx.shiftHandoverNote.update({ where: { id: noteId }, data: { resolvedAt: new Date() } });
    await audit(tx, actor, { action: "shift.note_resolved", entityType: "ShiftHandoverNote", entityId: noteId });
  });
}

// ───────────────────────── Reading shifts ─────────────────────────

const HREF: Record<string, (id: string) => string> = {
  Reservation: (id) => `/staff/reservations/${id}`, RestaurantOrder: (id) => `/staff/restaurant/orders/${id}`, Guest: (id) => `/staff/guests/${id}`,
  BookingRequest: (id) => `/staff/booking-requests/${id}`, Invoice: (id) => `/staff/invoices/${id}`,
};

/**
 * One shift, as a manager (or the receptionist, their own) opens it: who, when, open or closed —
 * and by whom and why — and what happened inside its time: check-ins, check-outs, bookings, room
 * changes, the money collected (from the payment records), expenses recorded, every action.
 */
export async function shiftDetail(id: string) {
  const s = await db.actualShift.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, fullName: true, role: { select: { name: true } } } }, closedBy: { select: { id: true, fullName: true } },
      schedule: { include: { scheduledUser: { select: { fullName: true } } } },
    },
  });
  if (!s) return null;
  const end = s.endedAt ?? new Date();
  const window = { start: s.startedAt, end };
  const day = fromDbDate(s.businessDate);
  const [logs, expenses, totals, handedIn, handedOut, delivered] = await Promise.all([
    db.auditLog.findMany({
      where: { userId: s.userId, createdAt: { gte: s.startedAt, lt: end }, action: { notIn: ["auth.logout"] } }, orderBy: { createdAt: "desc" }, take: 500,
      select: { id: true, action: true, entityType: true, entityId: true, createdAt: true },
    }),
    db.expense.findMany({
      where: { createdById: s.userId, createdAt: { gte: s.startedAt, lt: end }, correctsId: null }, orderBy: { createdAt: "desc" },
      select: { id: true, number: true, amount: true, status: true, description: true, createdAt: true, account: { select: { name: true } }, stockRequest: { select: { id: true } } },
    }),
    collectionTotals(day, day, { collectorIds: [s.userId], sources: ALL_SOURCES, window }),
    // A waiter's shift: the orders that became theirs, the ones they gave on, and what they delivered.
    // Up to and including the close: a manager's hand-over at the close is written at the very moment the shift ends.
    s.department === "RESTAURANT" ? db.waiterAssignment.count({ where: { scope: "ORDER", toUserId: s.userId, at: s.endedAt ? { gte: s.startedAt, lte: s.endedAt } : { gte: s.startedAt, lt: end } } }) : 0,
    s.department === "RESTAURANT" ? db.waiterAssignment.count({ where: { scope: "ORDER", fromUserId: s.userId, kind: { in: ["TRANSFER", "MANAGER"] }, at: s.endedAt ? { gte: s.startedAt, lte: s.endedAt } : { gte: s.startedAt, lt: end } } }) : 0,
    s.department === "RESTAURANT" ? db.restaurantOrder.count({ where: { deliveredById: s.userId, deliveredAt: { gte: s.startedAt, lt: end } } }) : 0,
  ]);
  const count = (...actions: string[]) => logs.filter((l) => actions.includes(l.action)).length;
  const counted = expenses.filter((e) => e.status === "RECORDED" || e.status === "APPROVED");
  return {
    id: s.id, department: s.department, label: shiftLabel(s.startedAt), businessDate: day, startedAt: s.startedAt.toISOString(), endedAt: s.endedAt?.toISOString() ?? null, open: !s.endedAt,
    minutes: Math.round((end.getTime() - s.startedAt.getTime()) / 60000),
    person: { id: s.user.id, name: s.user.fullName, role: s.user.role.name },
    scheduled: s.schedule?.scheduledUser.fullName ?? null, replacement: s.isReplacement ? s.replacementReason : null,
    closedBy: s.closedBy ? { id: s.closedBy.id, name: s.closedBy.fullName, byManager: s.closedBy.id !== s.userId } : null, closeReason: s.closeReason, closingNote: s.closingNote,
    counts: {
      checkIns: count("reservation.checked_in", "reservation.walk_in"), checkOuts: count("reservation.checked_out"),
      bookings: count("reservation.created", "reservation.walk_in"), roomChanges: count("reservation.room_changed"),
      actions: logs.filter((l) => l.action !== "auth.login").length,
      ordersTaken: handedIn, ordersHandedOn: handedOut, delivered,
    },
    money: totals.of(s.userId),
    expenses: {
      total: counted.reduce((t, e) => t + e.amount, 0), count: counted.length,
      rows: expenses.map((e) => ({ id: e.id, number: e.number, amount: e.amount, status: e.status, what: e.description, account: e.account?.name ?? null, at: e.createdAt.toISOString(), purchase: !!e.stockRequest })),
    },
    timeline: logs.map((l) => ({ id: l.id, what: friendlyAction(l.action), area: activityArea(l.action), at: l.createdAt.toISOString(), href: l.entityId && HREF[l.entityType] ? HREF[l.entityType](l.entityId) : null })),
  };
}
export type ShiftDetail = NonNullable<Awaited<ReturnType<typeof shiftDetail>>>;

/** Shifts worked, newest first — everyone's (managers) or one person's — with what each collected. */
export async function shiftHistory(opts: { userId?: string | null; take?: number; department?: "RECEPTION" | "RESTAURANT" | null } = {}) {
  const rows = await db.actualShift.findMany({
    where: { ...(opts.userId && { userId: opts.userId }), ...(opts.department && { department: opts.department }) }, orderBy: { startedAt: "desc" }, take: opts.take ?? 30,
    include: { user: { select: { id: true, fullName: true } }, closedBy: { select: { id: true, fullName: true } } },
  });
  const money = await Promise.all(rows.map((s) => {
    const day = fromDbDate(s.businessDate);
    return collectionTotals(day, day, { collectorIds: [s.userId], sources: ALL_SOURCES, window: { start: s.startedAt, end: s.endedAt ?? new Date() } }).then((t) => t.of(s.userId));
  }));
  return rows.map((s, i) => ({
    id: s.id, department: s.department, label: shiftLabel(s.startedAt), businessDate: fromDbDate(s.businessDate), startedAt: s.startedAt.toISOString(), endedAt: s.endedAt?.toISOString() ?? null,
    person: { id: s.user.id, name: s.user.fullName }, open: !s.endedAt,
    closedBy: s.closedBy && s.closedBy.id !== s.userId ? s.closedBy.fullName : null, closeReason: s.closeReason,
    collected: money[i].collected, byKind: money[i].byKind, replacement: s.isReplacement,
  }));
}
export type ShiftHistoryRow = Awaited<ReturnType<typeof shiftHistory>>[number];
