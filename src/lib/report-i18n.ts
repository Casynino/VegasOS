import type { T } from "@/i18n/translate";
import { formatBusinessDate } from "@/lib/format";
import type { Block, Cell, Figure, Report } from "@/lib/report-types";

/**
 * REPORTS IN THE READER'S LANGUAGE — a report is made once, in English (its figures and text are the record), and
 * shown or sent in each reader's language. Static words translate by their English (`t(label)`); a sentence with
 * values in it ("3 guests checked out still owing TZS 80,000") is kept in the report's `i18n` book with its English
 * key and the values, so it can be said again in another language — with the very same numbers.
 *
 *   const { book, L } = textBook();
 *   L("{n} guests owe {amount}", { n: 3, amount: "TZS 80,000" })        → "3 guests owe TZS 80,000" (and remembered)
 *   const tr = reportTr(t, book); tr("3 guests owe TZS 80,000")       → "3 位客人欠款 TZS 80,000"
 */

/** A value inside a sentence: as it is (names, numbers, amounts), a word to translate, or a hotel day. */
export type TextArg = string | number | TextWord | TextDay;
export type TextWord = { k: string; v?: TextArgs };
export type TextDay = { d: string; long?: boolean };
export type TextArgs = Record<string, TextArg>;
/** English text → its key and values (kept with the report; nothing for text without values). */
export type TextBook = Record<string, TextWord>;

const isDay = (a: TextArg): a is TextDay => typeof a === "object" && a !== null && "d" in a;
const isWord = (a: TextArg): a is TextWord => typeof a === "object" && a !== null && "k" in a;
const fill = (text: string, vars: Record<string, string | number>) =>
  text.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined || vars[k] === null ? m : String(vars[k])));

/** A word to translate inside a sentence (a status, a department…). */
export const word = (k: string, v?: TextArgs): TextWord => (v ? { k, v } : { k });
/** A hotel day inside a sentence — written the reader's way. */
export const day = (d: string, long = false): TextDay => (long ? { d, long } : { d });

function english(a: TextArg): string | number {
  if (typeof a === "string" || typeof a === "number") return a;
  if (isDay(a)) return formatBusinessDate(a.d, a.long);
  return fill(a.k, mapArgs(a.v, english));
}
function mapArgs(v: TextArgs | undefined, f: (a: TextArg) => string | number) {
  return v ? Object.fromEntries(Object.entries(v).map(([k, a]) => [k, f(a)])) : {};
}

/** A book to keep the report's sentences in, and `L` to write one (it returns the English, as the report keeps it). */
export function textBook(into: TextBook = {}) {
  const book = into;
  const L = (key: string, vars?: TextArgs): string => {
    const text = fill(key, mapArgs(vars, english));
    if (vars && Object.keys(vars).length && text !== key) book[text] = { k: key, v: vars };
    return text;
  };
  return { book, L };
}

/** Merge books (a report built from parts). */
export const mergeBooks = (...books: (TextBook | null | undefined)[]): TextBook => Object.assign({}, ...books.filter(Boolean));

/** Says a report's text in the reader's language: a remembered sentence again with its values, else the word itself. */
export function reportTr(t: T, book?: TextBook | null) {
  const say = (a: TextArg): string | number => {
    if (typeof a === "number") return a;
    if (typeof a === "string") return a;
    if (isDay(a)) return t.date(a.d, a.long);
    // A word that is itself a remembered sentence (a part's own text) is said from the book.
    if (isWord(a)) return !a.v && book?.[a.k] ? say(book[a.k]) : t(a.k, mapArgs(a.v, say));
    return String(a);
  };
  return (s: string | null | undefined): string => {
    if (s == null) return "";
    if (t.locale === "en" || !s) return s;
    const e = book?.[s];
    return e ? t(e.k, mapArgs(e.v, say)) : t(s);
  };
}

/** A report's period in the reader's words (from its dates — "Tuesday, 29 September 2026" or "1 Sep → 29 Sep"). */
export function reportPeriod(t: T, r: Pick<Report, "from" | "to" | "period">) {
  if (t.locale === "en") return r.period;
  return r.from === r.to ? t.date(r.from, true) : `${t.shortDate(r.from)} → ${t.shortDate(r.to)}`;
}

/** The whole report document in the reader's language: every label, heading, note and text cell; numbers as they are. */
export function localizeReport(r: Report, t: T): Report {
  if (t.locale === "en") return r;
  const tr = reportTr(t, r.i18n);
  const opt = (s?: string) => (s === undefined ? undefined : tr(s));
  const cell = (c: Cell): Cell => (typeof c === "string" ? tr(c) : c);
  const figure = (f: Figure): Figure => ({ ...f, label: tr(f.label), value: tr(f.value), sub: opt(f.sub) });
  const block = (b: Block): Block => {
    switch (b.kind) {
      case "bars": return { ...b, title: tr(b.title), subtitle: opt(b.subtitle), empty: opt(b.empty), items: b.items.map((x) => ({ ...x, label: tr(x.label), sub: opt(x.sub), note: opt(x.note) })) };
      case "columns": return { ...b, title: tr(b.title), subtitle: opt(b.subtitle), empty: opt(b.empty), points: b.points.map((p) => ({ ...p, parts: p.parts.map((x) => ({ ...x, name: tr(x.name) })) })) };
      case "statement": return { ...b, title: tr(b.title), subtitle: opt(b.subtitle), rows: b.rows.map((x) => ({ ...x, label: tr(x.label) })) };
      case "table": return {
        ...b, title: tr(b.title), subtitle: opt(b.subtitle), empty: opt(b.empty), moreNote: opt(b.moreNote),
        columns: b.columns.map((c) => ({ ...c, label: tr(c.label) })), rows: b.rows.map((row) => row.map(cell)), foot: b.foot?.map(cell),
      };
      case "highlights": return { ...b, title: tr(b.title), items: b.items.map((x) => ({ ...x, label: tr(x.label), value: tr(x.value), sub: opt(x.sub) })) };
      case "note": return { ...b, text: tr(b.text) };
      case "list": return { ...b, title: tr(b.title), items: b.items.map(tr) };
      case "section": return { ...b, title: tr(b.title), subtitle: opt(b.subtitle) };
    }
  };
  return { ...r, title: tr(r.title), blurb: tr(r.blurb), period: reportPeriod(t, r), figures: r.figures.map(figure), blocks: r.blocks.map(block) };
}
