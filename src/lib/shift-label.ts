import { msg } from "@/i18n/msg";

/**
 * A shift's everyday name from when it started (the schedule has one person per hotel day, so
 * shifts have no stored name): Morning 04:00–11:59, Afternoon 12:00–17:59, Night 18:00–03:59.
 * English (the key) — shown with t(shiftLabel(…)).
 */
export function shiftLabel(startedAt: Date | string, timezone = "Africa/Dar_es_Salaam") {
  const hour = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: timezone }).format(new Date(startedAt)));
  return hour >= 4 && hour < 12 ? msg("Morning shift") : hour >= 12 && hour < 18 ? msg("Afternoon shift") : msg("Night shift");
}
