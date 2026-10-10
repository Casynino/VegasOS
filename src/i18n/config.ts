/**
 * LANGUAGES — one platform, one database, a different language for each person (owner, 2026-10-06).
 *
 * English is the default and the fallback: every interface string is written in English in the code and IS its own
 * key (`t("Check in")`); other languages map English → their text in src/i18n/catalog/<locale>/. A missing
 * translation therefore shows the English, never a key, "undefined" or an empty label.
 *
 * Adding a language later: add it here, add src/i18n/catalog/<locale>/ (npm run i18n:check lists what is missing).
 */

export const LOCALES = ["en", "zh-CN"] as const;
export type Locale = (typeof LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "en";

/** The visitor's own choice on the website and the guest pages (set only when they pick a language). */
export const LOCALE_COOKIE = "vlh-lang";

export const LOCALE_META: Record<Locale, {
  /** In its own language, for the switcher. */
  label: string;
  /** Compact switcher label. */
  short: string;
  /** The URL segment used inside the app (/en/rooms, /zh/rooms — visitors never need to type it). */
  segment: string;
  /** The HTML lang attribute. */
  html: string;
  /** For Intl date/number formatting. Dates keep the hotel's time zone — only the wording changes. */
  intl: string;
}> = {
  en: { label: "English", short: "EN", segment: "en", html: "en", intl: "en-GB" },
  "zh-CN": { label: "简体中文", short: "中文", segment: "zh", html: "zh-CN", intl: "zh-CN" },
};

export const isLocale = (v: unknown): v is Locale => typeof v === "string" && (LOCALES as readonly string[]).includes(v);

/** Anything a person or a link might say ("zh", "zh-cn", "zh-Hans", "cn", "EN") → a supported locale, or null. */
export function toLocale(v: string | null | undefined): Locale | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (!s) return null;
  if (s === "en" || s.startsWith("en-")) return "en";
  if (s === "zh" || s === "cn" || s === "中文" || s.startsWith("zh-") || s.startsWith("zh_")) return "zh-CN";
  return null;
}

/** The URL segment → locale ("zh" → "zh-CN"). */
export function localeFromSegment(segment: string | null | undefined): Locale | null {
  if (!segment) return null;
  return (LOCALES.find((l) => LOCALE_META[l].segment === segment) as Locale | undefined) ?? toLocale(segment);
}

/** Which Chinese characters a text has — e.g. to label a customer's own note "written in Chinese". */
export const hasCjk = (text: string | null | undefined) => !!text && /[㐀-鿿豈-﫿]/.test(text);
