"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { validPhone } from "@/lib/guest-messages";
import { db } from "@/server/db";
import { authorize, requestMeta, type CurrentUser } from "@/server/auth";
import { AppError, runAction, type ActionResult } from "@/server/errors";
import { parseInput } from "@/server/validation";
import { getSettings, stayConfig, businessToday } from "@/server/settings";
import { dayAvailability, findAvailableRooms } from "@/server/services/availability";
import {
  approveLateCheckout, cancelReservation, changeDiscount, changeMeeting, changeStayDates, previewDateChange, noteLateArrival, reinstateNoShow, releaseNoShow, checkIn, checkInWithDetails, assignAndCheckIn, checkOut, confirmReservation,
  createReservation, extendStay, markNoShow, previewCheckOut, previewExtension, reassignRoom, type Actor, type StayRequest,
} from "@/server/services/reservations";
import { correctPayment, addReservationCharge, postRoomCharges, recordReservationPayment, reversePayment, voidReservationCharge } from "@/server/services/payments";
import { CHARGE_CODES } from "@/lib/charge-types";
import { BILLING_GROUP_CODES } from "@/lib/billing";
import { changeBilling } from "@/server/services/company-billing";
import { changeRoom, roomChangeOptions } from "@/server/services/room-changes";
import { HOTEL_MOVE_CODES } from "@/lib/room-change";
import { refreshBookingStates } from "@/server/services/booking-holds";
import { requestMobilePayment } from "@/server/services/mobile-payments";
import { discountLimit, discountTooBigMessage } from "@/lib/discounts";
import { SHORT_TIME_MAX_HOURS, shortTimeRate } from "@/lib/short-time";
import { promoLabel } from "@/lib/pricing";
import { channelFor, loadPricing, quoteFromPromos } from "@/server/services/pricing";
import { changeRoomStatus } from "@/server/services/rooms";
import { dayUseStay, meetingStay, overnightStay, walkInStay, StayError, type Stay } from "@/lib/time/stay";
import { timeRange } from "@/lib/meeting";
import { fromDbDate, parseTimeToMinutes, toDbDate, zonedInstant } from "@/lib/time/business-date";
import { msg, msgf } from "@/i18n/msg";
import { getT } from "@/i18n/server";

async function actorFor(user: CurrentUser): Promise<Actor> {
  const { ipAddress } = await requestMeta();
  return { userId: user.id, label: user.fullName, ipAddress, permissions: user.permissions };
}

function refresh(id?: string) {
  revalidatePath("/staff", "layout");
  revalidatePath("/reception/dashboard");
  if (id) revalidatePath(`/staff/reservations/${id}`);
}

const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg("Choose a date."));
const StaySchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("overnight"), arrivalDate: date, departureDate: date }),
  z.object({ kind: z.literal("walkIn"), nights: z.coerce.number().int().min(1).max(90) }),
  // Short time: a start and a number of hours (at most 7, day or night).
  z.object({ kind: z.literal("dayUse"), date, startTime: z.string(), hours: z.coerce.number().int().min(1).max(SHORT_TIME_MAX_HOURS, `Short time is at most ${SHORT_TIME_MAX_HOURS} hours.`) }),
  // Meeting room: a date, a start and an end time.
  z.object({ kind: z.literal("meeting"), date, startTime: z.string(), endTime: z.string() }),
]);
type StayInput = z.infer<typeof StaySchema>;

async function toStayRequest(s: StayInput): Promise<StayRequest> {
  if (s.kind === "meeting") {
    const settings = await getSettings();
    let startAt: Date, endAt: Date;
    try {
      startAt = zonedInstant(s.date, parseTimeToMinutes(s.startTime), settings.timezone);
      endAt = zonedInstant(s.date, parseTimeToMinutes(s.endTime), settings.timezone);
    } catch {
      throw new AppError("Enter a valid start and end time (HH:MM).");
    }
    return { kind: "meeting", startAt, endAt };
  }
  if (s.kind !== "dayUse") return s;
  const settings = await getSettings();
  try {
    const startAt = zonedInstant(s.date, parseTimeToMinutes(s.startTime), settings.timezone);
    return { kind: "dayUse", startAt, endAt: new Date(startAt.getTime() + s.hours * 3_600_000) };
  } catch {
    throw new AppError("Enter a valid start time (HH:MM).");
  }
}

async function previewStay(req: StayRequest): Promise<Stay> {
  const cfg = stayConfig(await getSettings());
  try {
    if (req.kind === "overnight") return overnightStay(req, cfg);
    if (req.kind === "walkIn") return walkInStay({ now: new Date(), nights: req.nights }, cfg);
    if (req.kind === "meeting") return meetingStay(req, cfg);
    return dayUseStay(req, cfg);
  } catch (e) {
    if (e instanceof StayError) throw new AppError(e.localized ?? e.message);
    throw e;
  }
}

export interface AvailabilityResult {
  stay: { arrivalDate: string; departureDate: string; nights: number; units: number; isDayUse: boolean; isLateArrival: boolean; startAt: string; endAt: string };
  types: {
    id: string; name: string; baseRate: number; maxAdults: number; maxChildren: number; photo: string | null;
    /** The normal nightly price (differs from baseRate for short time). */
    fullRate: number;
    /** Promotion that applies to this room type for these dates (read-only for reception). */
    promotion: { name: string; label: string } | null;
    /** Promotion discount on the first night, and over the whole stay (one room). */
    promoPerNight: number; promoTotal: number;
    netPerNight: number; totalNet: number;
    /** Sum of each night's price (nights can cost differently: weekend, holiday, season), and the date prices used. */
    grossTotal: number; datePrices: string[];
    /** Free rooms. `promotion`/`promoTotal`/`grossTotal` only when the room has its own price or promotion. */
    rooms: { id: string; number: string; status: string; promotion?: { name: string; label: string }; promoTotal?: number; grossTotal?: number }[];
    /** Rooms of this type that cannot be sold for these dates, and when they are free again. */
    busy: { id: string; number: string; reason: "IN_USE" | "BOOKED" | "OUT_OF_ORDER" | "NOT_CLEAN"; guest: string | null; freeFrom: string | null; time?: string | null }[];
    /** Meeting rooms: what is already booked on that day, so staff can pick a free time. */
    schedule?: { number: string; time: string; who: string; inUse: boolean }[];
  }[];
  meeting?: boolean;
}

function addDaysIso(d: string, n: number) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

/** Live availability + server-side prices for the booking form. */
export async function checkAvailabilityAction(input: { stay: StayInput; sourceCode: string; checkInNow?: boolean }): Promise<ActionResult<AvailabilityResult>> {
  return runAction(async () => {
    await authorize("reservations.create");
    await refreshBookingStates();
    const stay = await previewStay(await toStayRequest(parseInput(StaySchema, input.stay)));
    const today = await businessToday();
    const meeting = input.stay.kind === "meeting";
    const category = meeting ? "MEETING_ROOM" as const : "GUEST_ROOM" as const;
    if (input.stay.kind !== "walkIn" && stay.arrivalDate < today) throw new AppError(meeting ? msg("The meeting date cannot be in the past.") : msg("Arrival date cannot be in the past."));
    if (meeting && stay.endAt <= new Date()) throw new AppError("That meeting time has already passed.");
    const [free, types, allRooms] = await Promise.all([
      findAvailableRooms({ stay, category }),
      db.roomType.findMany({ where: { isActive: true, category }, orderBy: { sortOrder: "asc" } }),
      db.room.findMany({ where: { isActive: true, roomType: { category } }, select: { id: true, number: true, roomTypeId: true, status: true } }),
    ]);
    const channel = channelFor(input.sourceCode);
    const { promos, rules } = stay.isDayUse ? { promos: [], rules: [] } : await loadPricing(db, stay.arrivalDate, addDaysIso(stay.departureDate, -1));
    const promoById = new Map(promos.map((p) => [p.id, p]));
    // The promotion's label ("20% off") is only shown: in the language of whoever is booking.
    const words = await getT();
    const promoInfo = (p: { id: string; name: string } | null) => (p ? { name: p.name, label: promoLabel(promoById.get(p.id)!, words) } : null);
    const walkIn = !meeting && (input.checkInNow || input.stay.kind === "walkIn");
    const sellable = new Set(free.filter((f) => !walkIn || ["AVAILABLE", "READY"].includes(f.status)).map((f) => f.id));
    const freeIds = new Set(free.map((f) => f.id));

    // Why each other room is taken, and the first date it is free again.
    const busyIds = allRooms.filter((r) => !sellable.has(r.id)).map((r) => r.id);
    const [stays, blocks] = await Promise.all([
      db.reservationRoom.findMany({
        where: {
          // Meeting rooms: every booking that day (for the day's schedule), not only the busy rooms.
          roomId: { in: meeting ? allRooms.map((r) => r.id) : busyIds },
          AND: [
            { OR: [{ status: { in: ["RESERVED", "CONFIRMED", "CHECKED_IN"] } }, { status: "NO_SHOW", releasedAt: null }] },
            meeting
              ? { OR: [{ arrivalDate: toDbDate(stay.arrivalDate) }, { status: "CHECKED_IN" }] }
              : { OR: [{ departureDate: { gt: toDbDate(stay.arrivalDate) } }, { status: "CHECKED_IN" }] },
          ],
        },
        select: { roomId: true, status: true, arrivalDate: true, departureDate: true, startAt: true, endAt: true, reservation: { select: { companyName: true, guest: { select: { fullName: true } } } } },
        orderBy: { startAt: "asc" },
      }),
      db.roomBlock.findMany({ where: { roomId: { in: busyIds }, closedAt: null, OR: [{ endDate: null }, { endDate: { gt: toDbDate(stay.arrivalDate) } }] }, select: { roomId: true, startDate: true, endDate: true } }),
    ]);
    const wantEnd = stay.isDayUse ? addDaysIso(stay.arrivalDate, 1) : stay.departureDate; // exclusive
    const busyInfo = (roomId: string, status: string) => {
      if (freeIds.has(roomId)) return { reason: "NOT_CLEAN" as const, guest: null, freeFrom: null };
      const block = blocks.find((b) => b.roomId === roomId && fromDbDate(b.startDate) < wantEnd);
      if (block) return { reason: "OUT_OF_ORDER" as const, guest: null, freeFrom: block.endDate ? fromDbDate(block.endDate) : null };
      if (meeting) {
        // By time: the booking that overlaps the asked-for start–end.
        const now = new Date();
        const clash = stays.find((x) => x.roomId === roomId && x.startAt < stay.endAt && (x.status === "CHECKED_IN" ? (x.endAt > now ? x.endAt : now) : x.endAt) > stay.startAt);
        return clash
          ? { reason: clash.status === "CHECKED_IN" ? "IN_USE" as const : "BOOKED" as const, guest: clash.reservation.companyName ?? clash.reservation.guest.fullName, freeFrom: null, time: timeRange(clash.startAt, clash.endAt) }
          : { reason: status === "OCCUPIED" ? "IN_USE" as const : "BOOKED" as const, guest: null, freeFrom: null };
      }
      const mine = stays
        .filter((x) => x.roomId === roomId)
        .map((x) => ({
          x, arr: fromDbDate(x.arrivalDate),
          // An overdue guest keeps the room until checked out.
          dep: x.status === "CHECKED_IN" && fromDbDate(x.departureDate) <= today ? addDaysIso(today, 1) : fromDbDate(x.departureDate),
        }));
      const clash = mine.filter((m) => m.arr < wantEnd && m.dep > stay.arrivalDate);
      if (!clash.length) return { reason: status === "OCCUPIED" ? "IN_USE" as const : "BOOKED" as const, guest: null, freeFrom: null };
      // Free again after the clashing stays and any stay that follows straight on.
      let freeFrom = clash.reduce((d, m) => (m.dep > d ? m.dep : d), stay.arrivalDate);
      for (const m of mine) if (m.arr <= freeFrom && m.dep > freeFrom) freeFrom = m.dep;
      const first = clash[0];
      return { reason: first.x.status === "CHECKED_IN" ? "IN_USE" as const : "BOOKED" as const, guest: first.x.reservation.guest.fullName, freeFrom };
    };
    return {
      stay: {
        arrivalDate: stay.arrivalDate, departureDate: stay.departureDate, nights: stay.nights, units: stay.billableUnits,
        isDayUse: stay.isDayUse, isLateArrival: stay.isLateArrival, startAt: stay.startAt.toISOString(), endAt: stay.endAt.toISOString(),
      },
      meeting,
      types: types.map((t) => {
        // Meeting room: its own price per booking; short time: 25% off; overnight: the pricing engine.
        const rate = meeting ? t.baseRate : stay.isDayUse ? shortTimeRate(t.baseRate) : t.baseRate;
        // Short time has its own flat price; overnight stays go through the pricing engine.
        const dates = stay.isDayUse ? [stay.arrivalDate] : stay.nightDates;
        const q = quoteFromPromos({ dates, base: rate, roomTypeId: t.id, roomId: null, channel, promos, rules });
        const roomQuote = (roomId: string) => {
          const own = promos.some((p) => p.scope === "ROOMS" && p.roomIds.includes(roomId)) || rules.some((r) => r.scope === "ROOMS" && r.roomIds.includes(roomId));
          if (stay.isDayUse || !own) return {};
          const r = quoteFromPromos({ dates, base: rate, roomTypeId: t.id, roomId, channel, promos, rules });
          return r.promoDiscount !== q.promoDiscount || r.gross !== q.gross ? { promotion: promoInfo(r.promotion) ?? undefined, promoTotal: r.promoDiscount, grossTotal: r.gross } : {};
        };
        const datePrices = [...new Set(q.nights.map((n) => n.priceRule?.name).filter((x): x is string => !!x))];
        return {
          id: t.id, name: t.name, baseRate: rate, fullRate: t.baseRate, maxAdults: t.maxAdults, maxChildren: t.maxChildren,
          photo: Array.isArray(t.images) && typeof t.images[0] === "string" ? t.images[0] : null,
          promotion: promoInfo(q.promotion), promoPerNight: q.promoPerNight, promoTotal: q.promoDiscount,
          netPerNight: q.nights[0]?.net ?? rate, totalNet: q.net, grossTotal: q.gross, datePrices,
          rooms: free
            .filter((f) => f.roomTypeId === t.id && sellable.has(f.id))
            .map((f) => ({ id: f.id, number: f.number, status: f.status, ...roomQuote(f.id) })),
          busy: allRooms
            .filter((r) => r.roomTypeId === t.id && !sellable.has(r.id))
            .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }))
            .map((r) => ({ id: r.id, number: r.number, ...busyInfo(r.id, r.status) })),
          ...(meeting && {
            schedule: stays
              .filter((x) => allRooms.some((r) => r.id === x.roomId && r.roomTypeId === t.id) && fromDbDate(x.arrivalDate) === stay.arrivalDate)
              .map((x) => ({ number: allRooms.find((r) => r.id === x.roomId)!.number, time: timeRange(x.startAt, x.endAt), who: x.reservation.companyName ?? x.reservation.guest.fullName, inUse: x.status === "CHECKED_IN" })),
          }),
        };
      }),
    };
  });
}

const CreateSchema = z.object({
  sourceCode: z.string().min(1, msg("Choose a booking source.")),
  externalReference: z.string().trim().max(60).optional(),
  status: z.enum(["INQUIRY", "RESERVED", "CONFIRMED"]).default("RESERVED"),
  checkInNow: z.boolean().default(false),
  stay: StaySchema,
  guest: z.object({
    id: z.string().optional().nullable(),
    fullName: z.string().trim().min(2, msg("Guest name is required.")).max(120),
    // Every customer is saved with a phone: booking details and the welcome go to it.
    phone: z.string().trim().max(30).refine(validPhone, msg("Enter the guest's phone number (e.g. 0712 345 678 or +44…).")),
    email: z.union([z.literal(""), z.string().trim().email(msg("Enter a valid email."))]).optional(),
    idType: z.string().trim().max(40).optional(),
    idNumber: z.string().trim().max(60).optional(),
    nationality: z.string().trim().max(60).optional(),
    address: z.string().trim().max(200).optional(),
    createNew: z.boolean().optional(),
  }),
  corporateCustomerId: z.string().optional().nullable(),
  billing: z.object({
    // An invoice is always for the whole bill (no split between company and guest).
    billTo: z.enum(["GUEST", "COMPANY"]),
    covers: z.array(z.enum(BILLING_GROUP_CODES)).max(10).default([]),
    paymentTermDays: z.coerce.number().int().min(0).max(180).nullable().optional(),
  }).nullable().optional(),
  creditOverride: z.object({ reason: z.string().trim().min(3, msg("Say why the company may go over its limit.")).max(300) }).nullable().optional(),
  /** Company name when the company has no company account (meeting room bookings). */
  companyName: z.string().trim().max(120).optional(),
  rooms: z.array(z.object({
    roomTypeId: z.string().min(1),
    roomId: z.string().optional().nullable(),
    // Guests per bedroom, or attendees for a meeting room (the room type sets the real limit).
    adults: z.coerce.number().int().min(1).max(500),
    children: z.coerce.number().int().min(0).max(10),
    discountPerNight: z.coerce.number().int().min(0).optional().nullable(),
    discountReason: z.string().trim().max(200).optional().nullable(),
  })).min(1, msg("Add at least one room.")).max(10),
  charges: z.array(z.object({
    type: z.enum(CHARGE_CODES),
    item: z.string().trim().min(1, msg("Say what the item is.")).max(80),
    qty: z.number().int().min(1).max(99),
    unitPrice: z.number().int().positive(msg("Enter a price.")),
  })).max(20).nullable().optional(),
  // Food & drinks from the menu: only the item and how many — prices come from the menu on the server.
  menuItems: z.array(z.object({ menuItemId: z.string().min(1), quantity: z.number().int().min(1).max(99) })).max(40).nullable().optional(),
  menuRoomService: z.boolean().optional(),
  payment: z.object({
    amount: z.coerce.number().int().positive(msg("Enter the amount received.")),
    accountId: z.string().min(1, msg("Choose where the money was received.")),
    reference: z.string().trim().max(80).optional(),
  }).nullable().optional(),
  /** "Send to phone": a mobile-money prompt (nTZS) to the guest right after the booking is saved — paid on their phone. */
  prompt: z.object({
    amount: z.coerce.number().int().positive(msg("Enter the amount.")),
    phone: z.string().trim().min(9, msg("Enter the guest's phone number.")).max(30),
  }).nullable().optional(),
  specialRequests: z.string().trim().max(1000).optional(),
  internalNotes: z.string().trim().max(1000).optional(),
});

export async function createReservationAction(input: z.input<typeof CreateSchema>): Promise<ActionResult<{ id: string; reference: string; prompt: { id: string } | null; promptError: string | null }>> {
  return runAction(async () => {
    const user = await authorize("reservations.create");
    const { prompt, ...data } = parseInput(CreateSchema, input);
    if (data.checkInNow && !user.permissions.has("reservations.check_in")) throw new AppError("You cannot check guests in.", "FORBIDDEN");
    if ((data.payment || prompt) && !user.permissions.has("payments.record")) throw new AppError("You cannot record payments.", "FORBIDDEN");
    if (prompt && data.payment) throw new AppError("Choose one way to pay — mobile money or another payment method.", "VALIDATION");
    const actor = await actorFor(user);
    const r = await createReservation(
      {
        ...data,
        stay: await toStayRequest(data.stay),
        guest: { ...data.guest, email: data.guest.email || null },
      },
      actor,
    );
    // The booking is saved; now the prompt to the guest's phone — paid there, recorded by itself. If it cannot go,
    // the booking stays and the prompt can be sent again from it.
    let sent: { id: string } | null = null, promptError: string | null = null;
    if (prompt) {
      try {
        const mp = await requestMobilePayment({ purpose: "RESERVATION", reservationId: r.id, amount: prompt.amount }, prompt.phone, { ...actor, userId: user.id });
        sent = { id: mp.id };
      } catch (e) {
        // Shown to the person who made the booking: in their language.
        const t = await getT();
        promptError = e instanceof AppError ? (e.i18n ? t(e.i18n.key, e.i18n.vars) : t(e.message)) : t("The payment request could not be sent.");
      }
    }
    refresh();
    return { id: r.id, reference: r.reference, prompt: sent, promptError };
  }, msg("Booking saved."));
}

const IdSchema = z.object({ reservationId: z.string().min(1) });

const MeetingChangeSchema = z.object({
  reservationId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg("Choose a date.")),
  startTime: z.string().regex(/^\d{2}:\d{2}$/, msg("Choose a start time.")),
  endTime: z.string().regex(/^\d{2}:\d{2}$/, msg("Choose an end time.")),
  attendees: z.coerce.number().int().min(1, msg("At least 1 person.")).max(500),
  companyName: z.string().trim().max(120).optional(),
  specialRequests: z.string().trim().max(1000).optional(),
  internalNotes: z.string().trim().max(1000).optional(),
});

/** Change a meeting room booking — date/time are re-checked for clashes on the server. */
export async function changeMeetingAction(input: z.input<typeof MeetingChangeSchema>) {
  return runAction(async () => {
    const user = await authorize("reservations.edit", "meeting.manage");
    const d = parseInput(MeetingChangeSchema, input);
    const when = await toStayRequest({ kind: "meeting", date: d.date, startTime: d.startTime, endTime: d.endTime });
    if (when.kind !== "meeting") throw new AppError("Choose the meeting time.");
    const r = await changeMeeting(d.reservationId, {
      startAt: when.startAt, endAt: when.endAt, attendees: d.attendees,
      companyName: d.companyName ?? "", specialRequests: d.specialRequests ?? "", internalNotes: d.internalNotes ?? "",
    }, await actorFor(user));
    refresh(d.reservationId);
    revalidatePath("/staff/meeting-room");
    return r;
  }, msg("Meeting updated."));
}

export async function confirmAction(input: { reservationId: string }) {
  return runAction(async () => {
    const user = await authorize("reservations.edit");
    const { reservationId } = parseInput(IdSchema, input);
    await confirmReservation(reservationId, await actorFor(user));
    refresh(reservationId);
    return null;
  }, msg("Done."));
}

export async function checkInAction(input: { reservationId: string; roomIds?: string[] }) {
  return runAction(async () => {
    const user = await authorize("reservations.check_in");
    const { reservationId } = parseInput(IdSchema, input);
    const res = await checkIn(reservationId, await actorFor(user), input.roomIds ?? null);
    refresh(reservationId);
    return res;
  }, msg("Guest checked in."));
}

export async function checkOutAction(input: { reservationId: string; roomIds?: string[]; allowBalance?: boolean; earlyReason?: string; overrideReason?: string }) {
  return runAction(async () => {
    const user = await authorize("reservations.check_out");
    const { reservationId } = parseInput(IdSchema, input);
    const res = await checkOut(reservationId, await actorFor(user), {
      reservationRoomIds: input.roomIds ?? null, allowBalance: !!input.allowBalance, earlyReason: input.earlyReason ?? null, overrideReason: input.overrideReason ?? null,
    });
    refresh(reservationId);
    return res;
  }, msg("Guest checked out. Room marked dirty for housekeeping."));
}

/** Start Meeting: the meeting room booking goes "In use" (check-in underneath: actual start time and who). */
export async function startMeetingAction(input: { reservationId: string }) {
  return runAction(async () => {
    const user = await authorize("reservations.check_in", "meeting.manage");
    const { reservationId } = parseInput(IdSchema, input);
    const res = await checkIn(reservationId, await actorFor(user));
    refresh(reservationId);
    revalidatePath("/staff/meeting-room");
    return res;
  }, msg("Meeting started — the room is in use."));
}

/** Complete Meeting: actual end time and who; the room is available again. The bill must be settled (or a manager accepts a balance). */
export async function completeMeetingAction(input: { reservationId: string; allowBalance?: boolean; overrideReason?: string }) {
  return runAction(async () => {
    const user = await authorize("reservations.check_out", "meeting.manage");
    const { reservationId } = parseInput(IdSchema, input);
    const res = await checkOut(reservationId, await actorFor(user), { allowBalance: !!input.allowBalance, overrideReason: input.overrideReason ?? null });
    refresh(reservationId);
    revalidatePath("/staff/meeting-room");
    return res;
  }, msg("Meeting completed — the room is available again."));
}

/** No stay without the guest's phone: the one typed in now, or the one already on file. */
async function requireGuestPhone(reservationId: string, typed?: string | null) {
  if (typed && validPhone(typed)) return;
  const r = await db.reservation.findUnique({ where: { id: reservationId }, select: { guest: { select: { phone: true } } } });
  if (!r?.guest.phone) throw new AppError("Add the guest's phone number — every stay needs one.", "VALIDATION", { phone: msg("Required") });
}

const HereSchema = z.object({
  reservationId: z.string().min(1),
  reservationRoomId: z.string().min(1),
  moveArrivalToToday: z.boolean().default(false),
  /** Housekeeping has just finished: mark the room clean & ready first (one step for the desk). */
  markReady: z.boolean().default(false),
  guest: z.object({
    fullName: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(30).optional(),
    idType: z.string().trim().max(30).optional(),
    idNumber: z.string().trim().max(60).optional(),
    nationality: z.string().trim().max(60).optional(),
  }),
});

/**
 * Check a booked guest in straight from the room card. A guest booked for a
 * later day can be let in early: the arrival moves to today (price
 * recalculated) and, if the check-in then fails, the original dates are put back.
 */
export async function checkInHereAction(input: z.input<typeof HereSchema>) {
  return runAction(async () => {
    const user = await authorize("reservations.check_in");
    const d = parseInput(HereSchema, input);
    await requireGuestPhone(d.reservationId, d.guest?.phone);
    const actor = await actorFor(user);
    const rr = await db.reservationRoom.findUniqueOrThrow({ where: { id: d.reservationRoomId } });
    if (rr.reservationId !== d.reservationId) throw new AppError("That room is not part of this booking.", "NOT_FOUND");
    const today = await businessToday();
    const original = { arrivalDate: rr.arrivalDate.toISOString().slice(0, 10), departureDate: rr.departureDate.toISOString().slice(0, 10) };
    const moving = d.moveArrivalToToday && original.arrivalDate > today;
    if (original.arrivalDate > today && !moving) throw new AppError(msgf("This booking starts {date}. Check in early to move the arrival to today.", { date: original.arrivalDate }));
    if (d.markReady) {
      if (!user.permissions.has("rooms.status.update")) throw new AppError("You cannot change room housekeeping status.", "FORBIDDEN");
      const room = await db.room.findUniqueOrThrow({ where: { id: rr.roomId } });
      if (room.status === "DIRTY" || room.status === "CLEANING") {
        await changeRoomStatus(room.id, "READY", { ...actor, permissions: user.permissions }, "Cleaned for the arriving guest");
      }
    }
    if (moving) {
      if (!user.permissions.has("reservations.edit")) throw new AppError("You cannot change booking dates.", "FORBIDDEN");
      await changeStayDates(rr.id, { arrivalDate: today, departureDate: original.departureDate }, actor);
    }
    try {
      const res = await assignAndCheckIn(d.reservationId, { guest: d.guest }, actor);
      refresh(d.reservationId);
      revalidatePath("/staff/rooms");
      return res;
    } catch (e) {
      if (moving) await changeStayDates(rr.id, original, actor).catch(() => undefined);
      throw e;
    }
  }, msg("Guest checked in. Room is now occupied."));
}

/** The exact final bill if this guest checks out now (extra nights / early departure worked out by the server). */
export async function previewCheckOutAction(input: { reservationId: string; chargeOverstay?: boolean }) {
  return runAction(async () => {
    const user = await authorize("reservations.check_out");
    const { reservationId } = parseInput(IdSchema, input);
    return previewCheckOut(reservationId, { chargeOverstay: input.chargeOverstay ?? true, userId: user.id });
  });
}

const SettleSchema = z.object({
  reservationId: z.string().min(1),
  chargeOverstay: z.boolean().default(true),
  earlyReason: z.string().trim().max(300).optional(),
  allowBalance: z.boolean().default(false),
  overrideReason: z.string().trim().max(300).optional(),
  payment: z.object({ amount: z.number().int().positive(msg("Enter the amount received.")), accountId: z.string().min(1, msg("Choose where the money was received.")), reference: z.string().trim().max(80).optional() }).nullable().optional(),
  invoiceMode: z.enum(["ISSUE", "OPEN"]).nullable().optional(),
});

/** CHECK OUT — or RECORD PAYMENT & CHECK OUT — in one transaction: both happen, or neither. */
export async function settleCheckOutAction(input: z.input<typeof SettleSchema>) {
  return runAction(async () => {
    const user = await authorize("reservations.check_out");
    const d = parseInput(SettleSchema, input);
    if (d.payment && !user.permissions.has("payments.record")) throw new AppError("You cannot record payments.", "FORBIDDEN");
    const res = await checkOut(d.reservationId, await actorFor(user), {
      chargeOverstay: d.chargeOverstay, earlyReason: d.earlyReason || null, allowBalance: d.allowBalance, overrideReason: d.overrideReason || null, payment: d.payment ?? null,
      invoiceMode: d.invoiceMode ?? null,
    });
    refresh(d.reservationId);
    revalidatePath("/staff/check-out");
    return res;
  });
}

const QuickCheckInSchema = z.object({
  reservationId: z.string().min(1),
  assignments: z.array(z.object({ reservationRoomId: z.string().min(1), roomId: z.string().min(1) })).max(20).default([]),
  guest: z.object({
    fullName: z.string().trim().max(120).optional(),
    phone: z.string().trim().max(30).optional(),
    email: z.union([z.literal(""), z.string().trim().email(msg("Enter a valid email.")).max(120)]).optional(),
    idType: z.string().trim().max(30).optional(),
    idNumber: z.string().trim().max(60).optional(),
    nationality: z.string().trim().max(60).optional(),
  }).optional(),
  notReadyOverride: z.string().trim().max(300).optional(),
  /** New stay dates set on the check-in screen (an early guest moved to today, a stay made longer…) — applied first. */
  dates: z.array(z.object({
    reservationRoomId: z.string().min(1),
    arrivalDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg("Choose the check-in date.")),
    departureDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, msg("Choose the check-out date.")),
  })).max(20).default([]),
});

/** ASSIGN ROOM & CHECK IN from the arrivals list — one click, one transaction. */
export async function quickCheckInAction(input: z.input<typeof QuickCheckInSchema>) {
  return runAction(async () => {
    const user = await authorize("reservations.check_in");
    const d = parseInput(QuickCheckInSchema, input);
    await requireGuestPhone(d.reservationId, d.guest?.phone);
    if (d.assignments.length && !user.permissions.has("reservations.edit")) throw new AppError("You cannot change room assignments.", "FORBIDDEN");
    const actor = await actorFor(user);
    // New dates first (a guest who came early: the stay moves to today, the price is worked out again) — onto the
    // room chosen for them, so a booked room that is busy today is no problem. If the check-in then fails, the
    // dates (and rooms) go back to what they were.
    const rooms = d.dates.length ? await db.reservationRoom.findMany({ where: { reservationId: d.reservationId, id: { in: d.dates.map((x) => x.reservationRoomId) } } }) : [];
    if (rooms.length !== new Set(d.dates.map((x) => x.reservationRoomId)).size) throw new AppError("That room is not part of this booking.", "NOT_FOUND");
    const iso = (x: Date) => x.toISOString().slice(0, 10);
    const changes = d.dates.filter((x) => { const rr = rooms.find((r) => r.id === x.reservationRoomId)!; return iso(rr.arrivalDate) !== x.arrivalDate || iso(rr.departureDate) !== x.departureDate; });
    if (changes.length && !user.permissions.has("reservations.edit")) throw new AppError("You cannot change booking dates.", "FORBIDDEN");
    const today = await businessToday();
    if (changes.some((x) => x.arrivalDate > today)) throw new AppError("To check in now, the check-in date must be today — or save the new dates for later.", "VALIDATION");
    let assignments = d.assignments;
    const moved: { id: string; roomId: string; original: { arrivalDate: string; departureDate: string } }[] = [];
    // Only the check-out changes (e.g. a late guest staying longer): saved once they are in (an in-house stay's
    // departure can always move) — a problem there does not stop the check-in, it says so.
    const sameArrival = (x: (typeof changes)[number]) => iso(rooms.find((r) => r.id === x.reservationRoomId)!.arrivalDate) === x.arrivalDate;
    try {
      for (const x of changes.filter((c) => !sameArrival(c))) {
        const rr = rooms.find((r) => r.id === x.reservationRoomId)!;
        const to = assignments.find((y) => y.reservationRoomId === rr.id);
        await changeStayDates(rr.id, { arrivalDate: x.arrivalDate, departureDate: x.departureDate }, actor, { roomId: to?.roomId ?? null });
        moved.push({ id: rr.id, roomId: rr.roomId, original: { arrivalDate: iso(rr.arrivalDate), departureDate: iso(rr.departureDate) } });
        if (to) assignments = assignments.filter((y) => y !== to);
      }
      const res = await assignAndCheckIn(d.reservationId, { assignments, guest: d.guest, notReadyOverride: d.notReadyOverride || null }, actor);
      const warnings = [...(res.warnings ?? [])];
      for (const x of changes.filter(sameArrival)) {
        try { await changeStayDates(x.reservationRoomId, { arrivalDate: x.arrivalDate, departureDate: x.departureDate }, actor); }
        catch (e) {
          // Shown to the receptionist as a warning: in their language.
          const t = await getT();
          const why = e instanceof AppError ? (e.i18n ? t(e.i18n.key, e.i18n.vars) : t(e.message)) : t("change it on the booking.");
          warnings.push(t("Checked in — but the new check-out date was not saved: {reason}", { reason: why }));
        }
      }
      refresh(d.reservationId);
      revalidatePath("/staff/rooms");
      return { ...res, warnings };
    } catch (e) {
      for (const m of moved.reverse()) await changeStayDates(m.id, m.original, actor, { roomId: m.roomId }).catch(() => undefined);
      throw e;
    }
  }, msg("Guest checked in. Room is now occupied."));
}

export async function cancelAction(input: { reservationId: string; reason: string; keepPayment?: boolean | null }) {
  return runAction(async () => {
    const user = await authorize("reservations.cancel");
    const { reservationId } = parseInput(IdSchema, input);
    await cancelReservation(reservationId, await actorFor(user), String(input.reason ?? ""), { keepPayment: input.keepPayment ?? null });
    refresh(reservationId);
    return null;
  }, msg("Booking cancelled."));
}

export async function noShowAction(input: { reservationId: string; release?: boolean }) {
  return runAction(async () => {
    const user = await authorize("reservations.cancel");
    const { reservationId } = parseInput(IdSchema, input);
    await markNoShow(reservationId, await actorFor(user), new Date(), { release: !!input.release });
    refresh(reservationId);
    return null;
  }, msg("Marked as no-show."));
}

export async function reassignRoomAction(input: { reservationId: string; reservationRoomId: string; roomId: string; reason?: string; chargeDifference?: boolean }) {
  return runAction(async () => {
    const user = await authorize("reservations.edit");
    await reassignRoom(input.reservationRoomId, input.roomId, await actorFor(user), input.reason, { chargeDifference: !!input.chargeDifference });
    refresh(input.reservationId);
    return null;
  }, msg("Room changed."));
}

export async function changeDatesAction(input: { reservationId: string; reservationRoomId: string; arrivalDate: string; departureDate: string; roomId?: string | null; reason?: string; payment?: { accountId: string; reference?: string } | null }) {
  return runAction(async () => {
    const user = await authorize("reservations.edit");
    if (input.payment && !user.permissions.has("payments.record")) throw new AppError("You cannot record payments.", "FORBIDDEN");
    // Only ids and dates come from the browser; the server prices everything again.
    await changeStayDates(input.reservationRoomId, { arrivalDate: input.arrivalDate, departureDate: input.departureDate }, await actorFor(user), { roomId: input.roomId ?? null, reason: input.reason ?? null, payment: input.payment ?? null });
    refresh(input.reservationId);
    return null;
  }, msg("Dates updated."));
}

/** Before changing dates: is the room free, which rooms are, and what does it cost (system prices only). */
export async function previewDateChangeAction(input: { reservationRoomId: string; arrivalDate: string; departureDate: string; roomId?: string | null }) {
  return runAction(async () => {
    await authorize("reservations.edit");
    await refreshBookingStates();
    return previewDateChange(input.reservationRoomId, { arrivalDate: input.arrivalDate, departureDate: input.departureDate }, input.roomId ?? null);
  });
}

/** Correct where a payment went (Cash → Bank …) or its reference. The amount cannot change. */
export async function correctPaymentAction(input: { reservationId?: string; paymentId: string; accountId: string; reference?: string | null; reason?: string }) {
  return runAction(async () => {
    const user = await authorize("payments.record");
    await correctPayment({ paymentId: input.paymentId, accountId: input.accountId, reference: input.reference, reason: input.reason ?? "" }, await actorFor(user));
    refresh(input.reservationId);
    revalidatePath("/staff/finance", "layout");
    return null;
  }, msg("Payment corrected — the amount is unchanged."));
}

export async function lateArrivalAction(input: { reservationId: string; eta?: string | null; note?: string | null }) {
  return runAction(async () => {
    const user = await authorize("reservations.edit");
    await noteLateArrival(input.reservationId, { eta: input.eta, note: input.note }, await actorFor(user));
    refresh(input.reservationId);
    return null;
  }, msg("Late arrival noted — the room stays reserved."));
}

export async function reinstateNoShowAction(input: { reservationId: string; note: string }) {
  return runAction(async () => {
    const user = await authorize("reservations.edit");
    await reinstateNoShow(input.reservationId, input.note ?? "", await actorFor(user));
    refresh(input.reservationId);
    return null;
  }, msg("Booking active again — marked as a late arrival."));
}

export async function releaseNoShowAction(input: { reservationId: string; reason?: string }) {
  return runAction(async () => {
    const user = await authorize("reservations.cancel");
    await releaseNoShow(input.reservationId, await actorFor(user), input.reason ?? null);
    refresh(input.reservationId);
    return null;
  }, msg("Room released — it can be sold again. The booking stays as a no-show."));
}

export async function changeDiscountAction(input: { reservationId: string; reservationRoomId: string; discountPerNight: number; reason: string }) {
  return runAction(async () => {
    const user = await authorize("reservations.edit");
    const amount = Number(input.discountPerNight);
    if (!Number.isInteger(amount) || amount < 0) throw new AppError("Enter a valid discount.");
    await changeDiscount(input.reservationRoomId, amount, input.reason, await actorFor(user));
    refresh(input.reservationId);
    return null;
  }, msg("Discount updated."));
}

const PaymentSchema = z.object({
  reservationId: z.string().min(1),
  amount: z.coerce.number().int(msg("Whole shillings only.")).positive(msg("Enter an amount.")),
  accountId: z.string().min(1, msg("Choose where the money was received.")),
  reference: z.string().trim().max(80).optional(),
  notes: z.string().trim().max(300).optional(),
  kind: z.enum(["PAYMENT", "REFUND"]).default("PAYMENT"),
});

export async function recordPaymentAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("payments.record");
    const data = parseInput(PaymentSchema, formData);
    await recordReservationPayment(data, await actorFor(user));
    refresh(data.reservationId);
    return null;
  }, msg("Payment recorded."));
}

export async function reversePaymentAction(input: { reservationId: string; paymentId: string; reason: string }) {
  return runAction(async () => {
    const user = await authorize("payments.reverse");
    await reversePayment(input.paymentId, input.reason, await actorFor(user));
    refresh(input.reservationId);
    return null;
  }, msg("Payment reversed."));
}

const ChargeSchema = z.object({
  reservationId: z.string().min(1),
  description: z.string().trim().min(2, msg("Describe the charge.")).max(120),
  amount: z.coerce.number().int().positive(msg("Enter an amount.")),
  category: z.enum(CHARGE_CODES).default("OTHER"),
});

export async function addChargeAction(_prev: unknown, formData: FormData): Promise<ActionResult<null>> {
  return runAction(async () => {
    const user = await authorize("payments.record");
    const data = parseInput(ChargeSchema, formData);
    await addReservationCharge(data, await actorFor(user));
    refresh(data.reservationId);
    return null;
  }, msg("Charge added."));
}

const PostChargesSchema = z.object({
  reservationId: z.string().min(1),
  lines: z.array(z.object({
    type: z.enum(CHARGE_CODES),
    item: z.string().trim().min(1, msg("Say what the item is.")).max(80),
    qty: z.number().int().min(1).max(99),
    unitPrice: z.number().int().positive(msg("Enter a price.")),
  })).min(1, msg("Add at least one item.")).max(20),
  pay: z.object({ accountId: z.string().min(1), reference: z.string().trim().max(80).optional() }).nullable().optional(),
});

/** Post items (room service, meals, drinks, laundry…) to a guest's room account; optionally paid now. */
export async function postRoomChargesAction(input: z.input<typeof PostChargesSchema>) {
  return runAction(async () => {
    const user = await authorize("payments.record");
    const d = parseInput(PostChargesSchema, input);
    const res = await postRoomCharges({ reservationId: d.reservationId, lines: d.lines, pay: d.pay ?? null }, await actorFor(user));
    refresh(d.reservationId);
    return res;
  });
}

export async function voidChargeAction(input: { reservationId: string; chargeId: string; reason: string }) {
  return runAction(async () => {
    const user = await authorize("payments.reverse");
    await voidReservationCharge(input.chargeId, input.reason, await actorFor(user));
    refresh(input.reservationId);
    return null;
  }, msg("Charge voided."));
}

/** Rooms a guest could be moved to (same stay window). */
export async function roomOptionsAction(input: { reservationRoomId: string }) {
  return runAction(async () => {
    await authorize("reservations.edit");
    const rr = await db.reservationRoom.findUnique({ where: { id: input.reservationRoomId } });
    if (!rr) throw new AppError("Not found.", "NOT_FOUND");
    const now = new Date();
    const inHouse = rr.status === "CHECKED_IN";
    const free = await findAvailableRooms({
      stay: {
        startAt: inHouse ? now : rr.startAt, endAt: rr.endAt < now ? new Date(now.getTime() + 60_000) : rr.endAt,
        arrivalDate: inHouse ? await businessToday() : rr.arrivalDate.toISOString().slice(0, 10),
        departureDate: rr.departureDate.toISOString().slice(0, 10), isDayUse: rr.isDayUse,
      },
      excludeReservationRoomId: rr.id,
    });
    const types = await db.roomType.findMany({ select: { id: true, name: true } });
    const name = new Map(types.map((t) => [t.id, t.name]));
    const rate = new Map((await db.roomType.findMany({ select: { id: true, baseRate: true } })).map((t) => [t.id, t.baseRate]));
    return free
      .filter((f) => f.id !== rr.roomId && (!inHouse || ["AVAILABLE", "READY"].includes(f.status)))
      .map((f) => ({ id: f.id, number: f.number, type: name.get(f.roomTypeId) ?? "", baseRate: rate.get(f.roomTypeId) ?? 0, currentRate: rr.ratePerNight }));
  });
}

/** Guest lookup for the booking form. */
export async function searchGuestsAction(query: string) {
  return runAction(async () => {
    await authorize("guests.view");
    const q = query.trim();
    if (q.length < 2) return [];
    const digits = q.replace(/\D/g, "");
    return db.guest.findMany({
      where: {
        deletedAt: null,
        OR: [
          { fullName: { contains: q, mode: "insensitive" } },
          { email: { contains: q, mode: "insensitive" } },
          ...(digits.length >= 4 ? [{ phone: { contains: digits.slice(-9) } }] : []),
          { idNumber: { contains: q, mode: "insensitive" } },
          // Customer reference: "G-7K2M9Q" or part of it.
          ...(/^(g-?)?[0-9a-f]{4,6}$/i.test(q) ? [{ reference: { contains: q.replace(/^g-?/i, "").toUpperCase() } }] : []),
        ],
      },
      take: 8,
      orderBy: { updatedAt: "desc" },
      select: {
        id: true, reference: true, vip: true, fullName: true, phone: true, email: true, idType: true, idNumber: true, nationality: true, address: true,
        _count: { select: { reservations: { where: { status: "CHECKED_OUT" } } } },
        reservations: { where: { status: "CHECKED_OUT" }, orderBy: { departureDate: "desc" }, take: 1, select: { departureDate: true } },
      },
    }).then((rows) => rows.map(({ _count, reservations, ...g }) => ({
      ...g, stays: _count.reservations, lastStay: reservations[0]?.departureDate.toISOString().slice(0, 10) ?? null,
    })));
  });
}

export async function previewExtensionAction(input: { reservationRoomId: string; newDeparture: string }) {
  return runAction(async () => {
    await authorize("reservations.edit");
    return previewExtension(input.reservationRoomId, input.newDeparture);
  });
}

export async function extendStayAction(input: {
  reservationId: string; reservationRoomId: string; newDeparture: string; moveToRoomId?: string | null;
  /** Optional new discount per night for the whole (extended) stay. */
  discountPerNight?: number | null; discountReason?: string;
}) {
  return runAction(async () => {
    const user = await authorize("reservations.edit");
    const disc = input.discountPerNight;
    if (disc != null) {
      if (!Number.isInteger(disc) || disc < 0) throw new AppError("Enter a valid discount.");
      const limit = discountLimit(user.permissions, await getSettings());
      if (limit === 0) throw new AppError("You are not allowed to give discounts.", "FORBIDDEN");
      if (disc > limit) throw new AppError(discountTooBigMessage(limit), "FORBIDDEN");
    }
    const actor = await actorFor(user);
    const p = await extendStay(input.reservationRoomId, input.newDeparture, actor, { moveToRoomId: input.moveToRoomId ?? null });
    if (disc != null) await changeDiscount(input.reservationRoomId, disc, input.discountReason?.trim() || "Discount on extended stay", actor);
    refresh(input.reservationId);
    return p;
  }, msg("Stay extended. Charges and balance updated."));
}

export async function lateCheckoutAction(input: { reservationId: string; reservationRoomId: string; until: string; fee?: number | null; note?: string }) {
  return runAction(async () => {
    const user = await authorize("reservations.edit");
    const fee = input.fee === null || input.fee === undefined || Number.isNaN(Number(input.fee)) ? null : Number(input.fee);
    await approveLateCheckout(input.reservationRoomId, { until: input.until, fee, note: input.note }, await actorFor(user));
    refresh(input.reservationId);
    return null;
  }, msg("Late checkout approved."));
}

const WizardSchema = z.object({
  reservationId: z.string().min(1),
  eta: z.string().regex(/^\d{2}:\d{2}$/).optional().or(z.literal("")),
  guest: z.object({
    fullName: z.string().trim().min(2, msg("Guest name is required.")),
    phone: z.string().trim().max(30).optional(),
    email: z.union([z.literal(""), z.string().trim().email(msg("Enter a valid email."))]).optional(),
    idType: z.string().trim().max(40).optional(),
    idNumber: z.string().trim().max(60).optional(),
    nationality: z.string().trim().max(60).optional(),
    address: z.string().trim().max(200).optional(),
  }),
  checklist: z.record(z.string(), z.boolean()),
});

export async function checkInWizardAction(input: z.input<typeof WizardSchema>) {
  return runAction(async () => {
    const user = await authorize("reservations.check_in");
    const d = parseInput(WizardSchema, input);
    await requireGuestPhone(d.reservationId, d.guest?.phone);
    const res = await checkInWithDetails(d.reservationId, { guest: d.guest, checklist: d.checklist, eta: d.eta || null }, await actorFor(user));
    refresh(d.reservationId);
    return res;
  }, msg("Guest checked in. Welcome!"));
}

const BillingSchema = z.object({
  reservationId: z.string().min(1),
  corporateCustomerId: z.string().nullable(),
  // GROUP: a group booking's room paid by the group.
  billTo: z.enum(["GUEST", "COMPANY", "GROUP"]),
  covers: z.array(z.enum(BILLING_GROUP_CODES)).max(10).default([]),
  paymentTermDays: z.coerce.number().int().min(0).max(180).nullable().default(null),
});

/** Who pays for this stay: the guest, the company, or split. */
export async function changeBillingAction(input: z.input<typeof BillingSchema>) {
  return runAction(async () => {
    const user = await authorize("reservations.edit");
    const d = parseInput(BillingSchema, input);
    await changeBilling(d.reservationId, d, await actorFor(user));
    refresh(d.reservationId);
    return null;
  }, msg("Billing updated."));
}

/** Change room: free rooms for the rest of the stay, each with its price difference. */
export async function roomChangeOptionsAction(input: { reservationRoomId: string }) {
  return runAction(async () => {
    await authorize("reservations.edit");
    await refreshBookingStates();
    return roomChangeOptions(input.reservationRoomId);
  });
}

const RoomChangeSchema = z.object({
  reservationId: z.string().min(1),
  reservationRoomId: z.string().min(1),
  toRoomId: z.string().min(1, msg("Choose the new room.")),
  source: z.enum(["CUSTOMER", "HOTEL"]),
  reasonCode: z.enum(HOTEL_MOVE_CODES).nullable().optional(),
  note: z.string().trim().max(300).optional(),
  downgrade: z.enum(["NO_REFUND", "CREDIT"]).nullable().optional(),
  payment: z.object({ accountId: z.string().min(1, msg("Choose where the money was received.")), reference: z.string().trim().max(80).optional() }).nullable().optional(),
  addToBill: z.boolean().optional(),
  oldRoomStatus: z.enum(["DIRTY", "MAINTENANCE", "READY"]).nullable().optional(),
});

/** Move the guest (before or after check-in). The system prices it; an upgrade can be paid in the same step. */
export async function changeRoomAction(input: z.input<typeof RoomChangeSchema>) {
  return runAction(async () => {
    const user = await authorize("reservations.edit");
    const d = parseInput(RoomChangeSchema, input);
    if (d.payment && !user.permissions.has("payments.record")) throw new AppError("You cannot record payments.", "FORBIDDEN");
    const res = await changeRoom(d, await actorFor(user));
    refresh(d.reservationId);
    revalidatePath("/staff/rooms");
    return res;
  });
}

/** Free rooms per night for the date picker (paid / confirmed bookings vs unpaid holds). */
export async function calendarAvailabilityAction(input: { from: string; to: string }) {
  return runAction(async () => {
    await authorize("reservations.view", "reservations.create");
    const re = /^\d{4}-\d{2}-\d{2}$/;
    if (!re.test(input.from) || !re.test(input.to) || input.to < input.from) throw new AppError("Invalid dates.");
    if (Date.parse(input.to) - Date.parse(input.from) > 62 * 86_400_000) throw new AppError("Too many days at once.");
    return dayAvailability(input.from, input.to);
  });
}
