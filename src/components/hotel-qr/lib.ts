import { addDays, diffDays, isBusinessDate } from "@/lib/time/business-date";

/**
 * The Hotel QR app's small helpers: money and dates in words (written out by hand, so the server and the phone print
 * exactly the same text), the browser's keys, and the app's place in the flow — kept in the address (step, dates,
 * guests, room), so Back on the phone goes back a step and a reload opens the same step. Never a name or a number there.
 */

export const tzs = (v: number) => `TZS ${Math.round(v).toLocaleString("en-US")}`;
export const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const MONTHS_LONG = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const DAYS_LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const parts = (d: string) => {
  const x = new Date(`${d}T00:00:00Z`);
  return { y: x.getUTCFullYear(), m: x.getUTCMonth(), d: x.getUTCDate(), w: x.getUTCDay() };
};
/** "12 Oct" */
export const dayShort = (d: string) => { const p = parts(d); return `${p.d} ${MONTHS[p.m]}`; };
/** "Mon 12 Oct" */
export const dayWeek = (d: string) => { const p = parts(d); return `${DAYS[p.w]} ${p.d} ${MONTHS[p.m]}`; };
/** "Monday, 12 October 2026" */
export const dayLong = (d: string) => { const p = parts(d); return `${DAYS_LONG[p.w]}, ${p.d} ${MONTHS_LONG[p.m]} ${p.y}`; };
/** "12 October 2026" */
export const dayFull = (d: string) => { const p = parts(d); return `${p.d} ${MONTHS_LONG[p.m]} ${p.y}`; };
export const weekday = (d: string) => parts(d).w;

export const HOTEL_TIME_ZONE = "Africa/Dar_es_Salaam";

/** The wall clock in a time zone at an instant (as UTC fields): the hotel's own clock, wherever the phone is. */
function wallClock(ms: number, timeZone: string) {
  try {
    const p = Object.fromEntries(new Intl.DateTimeFormat("en-US", {
      timeZone, hourCycle: "h23", year: "numeric", month: "numeric", day: "numeric", hour: "numeric", minute: "numeric", second: "numeric",
    }).formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return new Date(Date.UTC(Number(p.year), Number(p.month) - 1, Number(p.day), Number(p.hour) % 24, Number(p.minute), Number(p.second)));
  } catch {
    return new Date(ms + 3 * 3_600_000); // an unknown zone: the hotel's (EAT, UTC+3 all year)
  }
}

/** An instant as the hotel's clock shows it (the hotel's time zone, from the server) — "14:30 · Tue 13 Oct". */
export function hotelClock(iso: string, timeZone = HOTEL_TIME_ZONE) {
  const x = wallClock(Date.parse(iso), timeZone);
  const hh = String(x.getUTCHours()).padStart(2, "0"), mm = String(x.getUTCMinutes()).padStart(2, "0");
  return `${hh}:${mm} · ${DAYS[x.getUTCDay()]} ${x.getUTCDate()} ${MONTHS[x.getUTCMonth()]}`;
}

/** The instant a hotel day and time ("2026-10-12", "14:00") happen in the hotel's time zone — for the calendar file. */
export function hotelInstant(day: string, time: string, timeZone = HOTEL_TIME_ZONE) {
  const [y, m, d] = day.split("-").map(Number), [hh, mm] = time.split(":").map(Number);
  const guess = Date.UTC(y, m - 1, d, hh || 0, mm || 0);
  // The zone's offset at that moment, taken off the wall time (twice, so a clock change on the day still lands right).
  const once = guess - (wallClock(guess, timeZone).getTime() - guess);
  return new Date(guess - (wallClock(once, timeZone).getTime() - once));
}

export const nightsText = (n: number) => plural(n, "night");
export const guestsText = (adults: number, children: number) =>
  children ? `${plural(adults, "adult")} · ${plural(children, "child", "children")}` : plural(adults, "guest");
/** "Up to 2 adults and 1 child" */
export const holdsText = (t: { maxAdults: number; maxChildren: number }) =>
  `Up to ${plural(t.maxAdults, "adult")}${t.maxChildren ? ` and ${plural(t.maxChildren, "child", "children")}` : ""}`;

/** A fresh 32-hex key: one per Book / Pay press (the server makes one booking and one payment per key). */
export const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (x) => x.toString(16).padStart(2, "0")).join("");

const VISITOR = "vegas-qr-visitor";
/** This browser's own random key, so one visitor is counted once (kept on the phone; none in a private window). */
export function visitorId(): string | undefined {
  try {
    let v = localStorage.getItem(VISITOR);
    if (!v || !/^[a-f0-9]{32}$/.test(v)) { v = newKey(); localStorage.setItem(VISITOR, v); }
    return v;
  } catch { return undefined; }
}

/** A Tanzanian mobile-money number (0712 345 678, +255 712 345 678…) — the server checks it again. */
export const payPhoneOk = (p: string) => /^(?:\+?255|0)?[67]\d{8}$/.test(p.replace(/[\s-]/g, ""));

export const telHref = (phone: string) => `tel:${phone.replace(/[^\d+]/g, "")}`;
export const waHref = (phone: string, text?: string) => `https://wa.me/${phone.replace(/\D/g, "")}${text ? `?text=${encodeURIComponent(text)}` : ""}`;

// ───────────────────────── Where the guest is in the flow (the address) ─────────────────────────

export type View = "home" | "rooms" | "type" | "results" | "room" | "details" | "pay" | "booked";
const VIEWS: View[] = ["home", "rooms", "type", "results", "room", "details", "pay", "booked"];
export type StayQuery = { checkIn: string; checkOut: string; adults: number; children: number };
export type Flow = {
  view: View;
  /** The room type opened ("View room"). */
  type: string | null;
  stay: StayQuery | null;
  /** Only this room type (a filter on the search). */
  roomType: string | null;
  /** The room picked (its number). */
  room: string | null;
  /** The dates & guests sheet is open. */
  sheet: boolean;
};

const SLUG = /^[a-z0-9-]{1,80}$/;
const ROOM = /^[A-Za-z0-9-]{1,12}$/;
const int = (v: string | null, min: number, max: number) => {
  const n = Number(v);
  return v !== null && v !== "" && Number.isInteger(n) && n >= min && n <= max ? n : null;
};

export function readFlow(sp: { get(name: string): string | null }): Flow {
  const v = sp.get("s") as View | null;
  const checkIn = sp.get("in"), checkOut = sp.get("out");
  const adults = int(sp.get("a"), 1, 20), children = int(sp.get("c"), 0, 10) ?? 0;
  const stay = isBusinessDate(checkIn) && isBusinessDate(checkOut) && checkOut > checkIn && adults !== null ? { checkIn, checkOut, adults, children } : null;
  const type = sp.get("t"), roomType = sp.get("rt"), room = sp.get("room");
  return {
    view: v && VIEWS.includes(v) ? v : "home",
    type: type && SLUG.test(type) ? type : null,
    stay,
    roomType: roomType && SLUG.test(roomType) ? roomType : null,
    room: room && ROOM.test(room) ? room : null,
    sheet: sp.get("d") === "1",
  };
}

/** The address of a place in the flow: `base` is the app's own path (/b/<token>). */
export function flowUrl(base: string, f: Flow) {
  const q = new URLSearchParams();
  if (f.view !== "home") q.set("s", f.view);
  if (f.type && f.view === "type") q.set("t", f.type);
  if (f.stay) {
    q.set("in", f.stay.checkIn); q.set("out", f.stay.checkOut);
    q.set("a", String(f.stay.adults)); if (f.stay.children) q.set("c", String(f.stay.children));
  }
  if (f.roomType) q.set("rt", f.roomType);
  if (f.room && ["room", "details", "pay"].includes(f.view)) q.set("room", f.room);
  if (f.sheet) q.set("d", "1");
  const s = q.toString();
  return s ? `${base}?${s}` : base;
}

export const stayKey = (s: StayQuery, extra = "") => `${s.checkIn}|${s.checkOut}|${s.adults}|${s.children}|${extra}`;
export const nightsOf = (s: StayQuery) => diffDays(s.checkIn, s.checkOut);

/** Quick picks for the dates sheet, inside the booking window. */
export function quickDates(today: string, maxCheckIn: string) {
  const out: { label: string; checkIn: string; checkOut: string }[] = [];
  const add = (label: string, checkIn: string, nights: number) => { if (checkIn <= maxCheckIn) out.push({ label, checkIn, checkOut: addDays(checkIn, nights) }); };
  add("Tonight", today, 1);
  add("Tomorrow", addDays(today, 1), 1);
  // The coming weekend: Friday and Saturday night (from a Saturday, the next one).
  add("Weekend", addDays(today, (5 - weekday(today) + 7) % 7), 2);
  return out;
}

// ───────────────────────── The booking just made (this tab) ─────────────────────────

/**
 * The booking made a moment ago in this tab — so Back from the payment page shows it again instead of the booking form.
 * Kept for this tab only (a lobby tablet must not show it to the next guest).
 */
export type LastBooking = {
  qr: string; reference: string; confirmUrl: string; payUrl: string | null; payWay: "ONLINE" | "HOTEL";
  room: string; typeName: string; checkIn: string; checkOut: string; total: number;
};
const LAST = "vegas-qr-last-booking";
const LAST_EVENT = "vegas-qr-last-booking";

export function saveLastBooking(b: LastBooking) {
  try { sessionStorage.setItem(LAST, JSON.stringify(b)); } catch { /* private mode */ }
  window.dispatchEvent(new Event(LAST_EVENT));
}
export function readLastBooking(): string | null {
  try { return sessionStorage.getItem(LAST); } catch { return null; }
}
export function subscribeLastBooking(cb: () => void) {
  window.addEventListener(LAST_EVENT, cb);
  return () => window.removeEventListener(LAST_EVENT, cb);
}
export function parseLastBooking(raw: string | null, qr: string): LastBooking | null {
  try {
    const b = JSON.parse(raw ?? "null") as LastBooking | null;
    return b && b.qr === qr && typeof b.reference === "string" && typeof b.confirmUrl === "string" && b.confirmUrl.startsWith(`/b/${qr}/done?`) ? b : null;
  } catch { return null; }
}
