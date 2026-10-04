/** Formatting helpers shared by server and client. Display only — never used for calculation. */

const tzs = new Intl.NumberFormat("en-TZ", { maximumFractionDigits: 0 });

export function formatTZS(amount: number | null | undefined): string {
  return `TZS ${tzs.format(amount ?? 0)}`;
}

export function formatNumber(value: number | null | undefined): string {
  return tzs.format(value ?? 0);
}

export function formatPercent(value: number | null | undefined, digits = 0): string {
  return `${(value ?? 0).toFixed(digits)}%`;
}

const dateFmt = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
const longDateFmt = new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });

/** Format a business date string (YYYY-MM-DD). */
export function formatBusinessDate(date: string, long = false): string {
  const d = new Date(`${date}T00:00:00Z`);
  return (long ? longDateFmt : dateFmt).format(d);
}

const shortDay = new Intl.DateTimeFormat("en-GB", { weekday: "short", timeZone: "UTC" });
/** "2026-10-12" → "Mon 12/10/26" — short enough for a phone. */
export function formatShortDate(date: string): string {
  const [y, m, d] = date.split("-");
  return `${shortDay.format(new Date(`${date}T00:00:00Z`))} ${d}/${m}/${y.slice(2)}`;
}

/** One day → "Tue, 29 Sept 2026"; a period → "Mon 12/10/26 – Wed 14/10/26". */
export function formatDateRange(from: string, to: string): string {
  return from === to ? formatBusinessDate(from) : `${formatShortDate(from)} – ${formatShortDate(to)}`;
}

export function formatDateTime(instant: Date | string, timezone = "Africa/Dar_es_Salaam"): string {
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone,
  }).format(typeof instant === "string" ? new Date(instant) : instant);
}

export function formatTime(instant: Date | string, timezone = "Africa/Dar_es_Salaam"): string {
  return new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone })
    .format(typeof instant === "string" ? new Date(instant) : instant);
}

/** 660 → "11:00". */
export function formatMinutesLabel(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
