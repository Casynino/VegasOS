import type { Locale } from "@/i18n/config";

/**
 * REPORT RECIPIENTS as typed in Settings — one per line: "Name, +255…, KEY_NAME", plus an optional language word
 * anywhere after the phone ("zh", "中文", "Chinese" or "en"). A line without a language gets English.
 */

const LANG_WORDS: Record<string, Locale> = {
  zh: "zh-CN", "zh-cn": "zh-CN", "zh-hans": "zh-CN", cn: "zh-CN", chinese: "zh-CN", "中文": "zh-CN", "简体中文": "zh-CN", "汉语": "zh-CN",
  en: "en", english: "en",
};

/** A language word on a recipient line → its language (null: not a language word). */
export function langWord(part: string): Locale | null {
  return LANG_WORDS[part.trim().toLowerCase()] ?? null;
}

export type RecipientLine = { name: string; phone: string; apiKeyRef: string | null; lang: Locale | null };

/** One line → the recipient (null when the phone is missing or not a number). */
export function parseRecipientLine(line: string): RecipientLine | null {
  const [name = "", phone = "", ...rest] = line.split(",").map((p) => p.trim());
  const number = phone.replace(/\s/g, "");
  if (!/^\+?\d{9,15}$/.test(number)) return null;
  let lang: Locale | null = null;
  let apiKeyRef: string | null = null;
  for (const part of rest) {
    if (!part) continue;
    const l = langWord(part);
    if (l) lang = l;
    else if (!apiKeyRef) apiKeyRef = part;
  }
  return { name, phone: number, apiKeyRef, lang };
}

/** A saved recipient back as its line ("Boss, +255…, KEY, zh") — English is not written. */
export function formatRecipientLine(r: { name?: string | null; phone: string; apiKeyRef?: string | null; lang?: string | null }) {
  return [r.name ?? "", r.phone, r.apiKeyRef ?? "", r.lang === "zh-CN" ? "zh" : ""].filter((v, i) => i < 2 || v).join(", ");
}
