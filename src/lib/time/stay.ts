import { SHORT_TIME_MAX_HOURS } from "../short-time";
import { MEETING_MAX_HOURS, MEETING_MIN_MINUTES } from "../meeting";
import { msg, msgf, type Localized } from "@/i18n/msg";
/**
 * StayCalculationService — the single place that turns requested dates/times
 * into a stay: business dates, occupancy window, nights, day-use and
 * late-arrival flags. Pure functions; settings are passed in.
 *
 * Rules
 * - Nights are counted in business dates. A guest who arrives at 01:30 on
 *   26 Sept is in business date 25 Sept, so a one-night stay checks out at
 *   11:00 on 26 Sept — not 27 Sept.
 * - Arrival at or after the late-arrival time (16:00), or in the small hours
 *   before the business day rolls over, is a late arrival; checkout is the
 *   configured checkout time (11:00) on the following calendar morning.
 * - Day-use stays start and end on the same business date: 0 nights, billed
 *   as one unit, never counted as an occupied room night.
 */

import {
  addDays,
  type BusinessDate,
  businessDateOf,
  diffDays,
  isBusinessDate,
  localMinutesOfDay,
  zonedInstant,
} from "./business-date";

export interface StayConfig {
  timezone: string;
  businessDayStartMinutes: number;
  standardCheckInMinutes: number; // 14:00
  checkoutMinutes: number; // 11:00
  lateArrivalMinutes: number; // 16:00
}

export const DEFAULT_STAY_CONFIG: StayConfig = {
  timezone: "Africa/Dar_es_Salaam",
  businessDayStartMinutes: 240,
  standardCheckInMinutes: 840,
  checkoutMinutes: 660,
  lateArrivalMinutes: 960,
};

export const MAX_NIGHTS = 90;

export interface Stay {
  arrivalDate: BusinessDate; // business date of arrival
  departureDate: BusinessDate; // business date on which the guest leaves
  startAt: Date; // occupancy window start (UTC instant)
  endAt: Date; // occupancy window end (UTC instant)
  nights: number; // 0 for day-use
  billableUnits: number; // nights, or 1 for day-use
  isDayUse: boolean;
  isLateArrival: boolean;
  /** Business dates that consume a room night (empty for day-use). */
  nightDates: BusinessDate[];
}

/**
 * A stay that cannot be. Its message is English (the key); one with values in it also keeps them (`localized`), so
 * whoever shows it can translate it with its values: `new AppError(e.localized ?? e.message)`.
 */
export class StayError extends Error {
  readonly localized?: Localized;
  constructor(message: string | Localized) {
    super(typeof message === "string" ? message : message.text);
    if (typeof message !== "string") this.localized = message;
  }
}

/**
 * Overnight stay from business-date arrival to business-date departure.
 * `arrivalInstant` (optional) is the actual/expected arrival moment; when
 * supplied it becomes the occupancy start instead of the standard check-in.
 */
export function overnightStay(
  input: { arrivalDate: BusinessDate; departureDate: BusinessDate; arrivalInstant?: Date },
  config: StayConfig = DEFAULT_STAY_CONFIG,
): Stay {
  const { arrivalDate, departureDate } = input;
  if (!isBusinessDate(arrivalDate) || !isBusinessDate(departureDate)) {
    throw new StayError(msg("Invalid arrival or departure date."));
  }
  const nights = diffDays(arrivalDate, departureDate);
  if (nights < 1) throw new StayError(msg("Check-out must be after check-in."));
  if (nights > MAX_NIGHTS) throw new StayError(msgf("Stays are limited to {max} nights.", { max: MAX_NIGHTS }));

  let startAt = zonedInstant(arrivalDate, config.standardCheckInMinutes, config.timezone);
  let isLateArrival = false;

  if (input.arrivalInstant) {
    const arrivalBusinessDate = businessDateOf(input.arrivalInstant, config);
    if (arrivalBusinessDate !== arrivalDate) {
      throw new StayError(msg("Arrival time does not fall on the arrival business date."));
    }
    startAt = input.arrivalInstant;
    isLateArrival = isLateArrivalInstant(input.arrivalInstant, config);
  }

  // Checkout happens on the calendar morning after the last night, which is
  // the departure business date (checkout time is after the day rollover).
  const endAt = zonedInstant(departureDate, config.checkoutMinutes, config.timezone);
  if (endAt <= startAt) throw new StayError(msg("Check-out time must be after check-in time."));

  const nightDates: BusinessDate[] = [];
  for (let i = 0; i < nights; i++) nightDates.push(addDays(arrivalDate, i));

  return {
    arrivalDate,
    departureDate,
    startAt,
    endAt,
    nights,
    billableUnits: nights,
    isDayUse: false,
    isLateArrival,
    nightDates,
  };
}

/** Same-day use of a room between two instants on one business date. */
export function dayUseStay(
  input: { startAt: Date; endAt: Date },
  config: StayConfig = DEFAULT_STAY_CONFIG,
): Stay {
  const { startAt, endAt } = input;
  if (!(endAt > startAt)) throw new StayError(msg("Short time must end after it starts."));
  if (endAt.getTime() - startAt.getTime() > SHORT_TIME_MAX_HOURS * 3_600_000) {
    throw new StayError(msgf("Short time is at most {hours} hours.", { hours: SHORT_TIME_MAX_HOURS }));
  }
  // Short time may run past midnight or 04:00; it belongs to the hotel day it starts in.
  const date = businessDateOf(startAt, config);
  return {
    arrivalDate: date,
    departureDate: date,
    startAt,
    endAt,
    nights: 0,
    billableUnits: 1,
    isDayUse: true,
    isLateArrival: false,
    nightDates: [],
  };
}

/**
 * A meeting room booking: a start and an end (e.g. 09:00–13:00). Stored like
 * short time — one unit on the business date it starts, no room night — so the
 * same availability, overlap guard and folio apply. `[start, end)`: a booking
 * ending 13:00 leaves the room free from 13:00.
 */
export function meetingStay(
  input: { startAt: Date; endAt: Date },
  config: StayConfig = DEFAULT_STAY_CONFIG,
): Stay {
  const { startAt, endAt } = input;
  if (Number.isNaN(startAt.getTime()) || Number.isNaN(endAt.getTime())) throw new StayError(msg("Choose the meeting date, start and end time."));
  if (!(endAt > startAt)) throw new StayError(msg("The meeting must end after it starts."));
  const minutes = (endAt.getTime() - startAt.getTime()) / 60_000;
  if (minutes < MEETING_MIN_MINUTES) throw new StayError(msgf("A meeting booking is at least {minutes} minutes.", { minutes: MEETING_MIN_MINUTES }));
  if (minutes > MEETING_MAX_HOURS * 60) throw new StayError(msgf("A meeting booking is at most {hours} hours — book each day separately.", { hours: MEETING_MAX_HOURS }));
  const date = businessDateOf(startAt, config);
  return { arrivalDate: date, departureDate: date, startAt, endAt, nights: 0, billableUnits: 1, isDayUse: true, isLateArrival: false, nightDates: [] };
}

/**
 * Walk-in / immediate check-in at `now` for `nights` nights. The arrival
 * business date comes from the 04:00 rule, so a 02:00 walk-in for one night
 * checks out at 11:00 the same calendar morning.
 */
export function walkInStay(
  input: { now: Date; nights: number },
  config: StayConfig = DEFAULT_STAY_CONFIG,
): Stay {
  if (!Number.isInteger(input.nights) || input.nights < 1) {
    throw new StayError(msg("A walk-in stay needs at least one night."));
  }
  const arrivalDate = businessDateOf(input.now, config);
  return overnightStay(
    { arrivalDate, departureDate: addDays(arrivalDate, input.nights), arrivalInstant: input.now },
    config,
  );
}

export function isLateArrivalInstant(instant: Date, config: StayConfig = DEFAULT_STAY_CONFIG): boolean {
  const minutes = localMinutesOfDay(instant, config.timezone);
  return minutes >= config.lateArrivalMinutes || minutes < config.businessDayStartMinutes;
}

/** Split a total evenly across units, putting any remainder on the first unit. */
export function splitAmount(total: number, units: number): number[] {
  if (units <= 0) return [];
  const base = Math.floor(total / units);
  const out = Array.from({ length: units }, () => base);
  out[0] += total - base * units;
  return out;
}
