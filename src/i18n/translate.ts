import { Fragment, createElement, type ReactNode } from "react";
import { DEFAULT_LOCALE, LOCALE_META, type Locale } from "./config";

/** English → this language. English needs none: the English text is the key. */
export type Catalog = Readonly<Record<string, string>>;
export type Vars = Record<string, string | number | null | undefined>;
type Tag = (chunks: ReactNode) => ReactNode;

const PLACEHOLDER = /\{(\w+)\}/g;
const fill = (text: string, vars?: Vars) =>
  vars ? text.replace(PLACEHOLDER, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k]))) : text;

/** UTC dates for business dates ("2026-10-12"), so a day never shifts. */
const asDay = (date: string) => new Date(`${date}T00:00:00Z`);
const asInstant = (v: Date | string) => (typeof v === "string" ? new Date(v) : v);

/**
 * The translator one person gets — the same object on the server (`await getT()`) and in the browser (`useT()`).
 *
 *   t("Check in")                          → "办理入住"
 *   t("Room {room} is ready", { room })    → placeholders stay as they are in every language
 *   t.plural(n, "{n} night", "{n} nights") → English picks the form; Chinese has one
 *   t.rich("Only <b>Paid</b> is money in", { b: (c) => <strong>{c}</strong> })
 *   t.date("2026-10-12"), t.dateTime(instant, tz), t.time(…) — the hotel's time zone, the person's wording
 *
 * Never throws and never shows a key: anything missing is the English.
 */
export interface T {
  (key: string, vars?: Vars): string;
  locale: Locale;
  /** For new Intl.DateTimeFormat(t.intl, …) where the shared helpers don't fit. */
  intl: string;
  /** Has a translation (for "translation missing" hints in the admin). */
  has(key: string): boolean;
  plural(n: number, one: string, other: string, vars?: Vars): string;
  /**
   * The same English with a different meaning in one place: t.ctx("menu", "Available") looks up "menu::Available"
   * first (catalog key), then "Available". English shows "Available".
   */
  ctx(context: string, key: string, vars?: Vars): string;
  rich(key: string, tags: Record<string, Tag>, vars?: Vars): ReactNode;
  /** A business date (YYYY-MM-DD): "Mon, 12 Oct 2026" / "2026年10月12日 周一". */
  date(date: string, long?: boolean): string;
  /** "Mon 12/10/26" / "10月12日 周一" — short enough for a phone. */
  shortDate(date: string): string;
  /** One day → its date; a period → "from – to". */
  dateRange(from: string, to: string): string;
  /** An instant in the hotel's time zone: "12 Oct, 14:05" / "10月12日 14:05". */
  dateTime(instant: Date | string, timezone?: string): string;
  /** "14:05" (24 h in both). */
  time(instant: Date | string, timezone?: string): string;
  /** A weekday + day + month for a business date: "Mon 12 Oct" / "10月12日 周一". */
  dayMonth(date: string): string;
}

const TZ = "Africa/Dar_es_Salaam";

export function makeT(locale: Locale, catalog: Catalog | null | undefined): T {
  const dict = locale === DEFAULT_LOCALE ? null : catalog ?? null;
  const intl = LOCALE_META[locale].intl;
  const zh = locale === "zh-CN";
  const lookup = (key: string) => (dict && Object.prototype.hasOwnProperty.call(dict, key) && dict[key] ? dict[key] : key);

  const t = ((key: string, vars?: Vars) => fill(lookup(key), vars)) as T;
  t.locale = locale;
  t.intl = intl;
  t.has = (key) => locale === DEFAULT_LOCALE || (!!dict && Object.prototype.hasOwnProperty.call(dict, key));
  t.plural = (n, one, other, vars) => {
    const all = { n, ...vars };
    if (!dict) return fill(n === 1 ? one : other, all);
    // Languages without plural forms: the "other" form's translation (or the "one" form's).
    const hit = dict[other] || dict[one];
    return fill(hit || (n === 1 ? one : other), all);
  };
  t.ctx = (context, key, vars) => {
    const k = `${context}::${key}`;
    return fill(dict && Object.prototype.hasOwnProperty.call(dict, k) && dict[k] ? dict[k] : lookup(key), vars);
  };
  t.rich = (key, tags, vars) => {
    const text = fill(lookup(key), vars);
    const out: ReactNode[] = [];
    const re = /<(\w+)>(.*?)<\/\1>/g;
    let last = 0, m: RegExpExecArray | null, i = 0;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push(text.slice(last, m.index));
      const tag = tags[m[1]];
      out.push(createElement(Fragment, { key: i++ }, tag ? tag(m[2]) : m[2]));
      last = m.index + m[0].length;
    }
    if (last < text.length) out.push(text.slice(last));
    return createElement(Fragment, null, ...out);
  };

  const dayFmt = new Intl.DateTimeFormat(intl, { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const longFmt = new Intl.DateTimeFormat(intl, { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const shortDayFmt = new Intl.DateTimeFormat(intl, { weekday: "short", timeZone: "UTC" });
  const dayMonthFmt = new Intl.DateTimeFormat(intl, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  t.date = (date, long = false) => (long ? longFmt : dayFmt).format(asDay(date));
  t.shortDate = (date) => {
    if (zh) return dayMonthFmt.format(asDay(date));
    const [y, m, d] = date.split("-");
    return `${shortDayFmt.format(asDay(date))} ${d}/${m}/${y.slice(2)}`;
  };
  t.dateRange = (from, to) => (from === to ? t.date(from) : `${t.shortDate(from)} – ${t.shortDate(to)}`);
  t.dateTime = (instant, timezone = TZ) =>
    new Intl.DateTimeFormat(intl, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(asInstant(instant));
  t.time = (instant, timezone = TZ) =>
    new Intl.DateTimeFormat(intl, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(asInstant(instant));
  t.dayMonth = (date) => dayMonthFmt.format(asDay(date));
  return t;
}

/** English, no catalog — for code that runs with no person attached (jobs, tests) and as the safe default. */
export const englishT = makeT(DEFAULT_LOCALE, null);
