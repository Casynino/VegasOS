import { msg } from "@/i18n/msg";

/**
 * What the Developer console may show of a phone number and of a provider's error text (owner, 2026-10-18).
 * A phone number is shown only as its last three digits. A provider's reply is NEVER shown: CallMeBot echoes the message it was given
 * ("Message to: … Text to send: …") and the stored error is the last 220 characters of that reply, so it can hold the hotel's own
 * message. The console shows only the KIND of trouble (deliveryErrorKind). scrubError stays for any other text that may be shown:
 * trimmed to 120 characters, with anything that looks like a key, a token or a long number taken out first.
 * Pure functions — numbers and text in, text out — so each rule is easy to test.
 */

/** "+255 700 000 412" → "•••• 412". Anything with fewer than three digits is only dots. */
export function maskPhone(raw: string | null | undefined): string {
  const digits = (raw ?? "").replace(/\D/g, "");
  return digits.length >= 3 ? `•••• ${digits.slice(-3)}` : "••••";
}

export const ERROR_TEXT_MAX = 120;

/**
 * A provider's error, safe to show: markup removed, key=value secrets and "bearer …" taken out, any number of more than 8
 * digits (a phone number, an account number) and any long run of letters and digits (a key, a token) replaced by dots, then cut to
 * 120 characters. null when there is nothing left to say.
 */
export function scrubError(raw: unknown, max = ERROR_TEXT_MAX): string | null {
  if (typeof raw !== "string") return null;
  let s = raw.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  // key=value, key: value and "key": "value" (a quoted key or value, as in JSON)
  s = s.replace(/\b(api[_-]?key|key|token|secret|password|passwd|pwd|authorization)\b["']?\s*[=:]\s*["']?(?:(?:basic|bearer|digest)\s+)?\S+/gi, "$1=•••");
  s = s.replace(/\bbearer\s+\S+/gi, "bearer •••");
  // a number of more than eight digits, however it is spaced or dashed
  s = s.replace(/\+?\d[\d\s().-]{7,}\d/g, (m) => (m.replace(/\D/g, "").length > 8 ? "•••" : m));
  // a key or token: a long run of letters, digits and the few signs keys are made of
  s = s.replace(/[A-Za-z0-9_\-+/=]{24,}/g, "•••");
  if (!s) return null;
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * The kind of trouble a message delivery had, in plain words (English; the page shows them through t()). The text is only READ here to
 * choose a kind, and is never returned — so a hotel message echoed in the provider's reply cannot reach the page (at worst a word of it
 * tips the label to a wrong kind). The stored error starts with who made it ("CallMeBot: …", "CallMeBot request failed: …"), and the
 * checks go from the system's own messages, which cannot be echoed text, to the provider's.
 */
export function deliveryErrorKind(raw: string | null | undefined): string {
  const e = raw ?? "";
  if (!e.trim()) return msg("No answer recorded");
  if (/^no .*api key/i.test(e) || /key (is )?(missing|not set)/i.test(e)) return msg("No provider key set");
  if (/^recipient must be|international number/i.test(e)) return msg("Phone number not accepted");
  if (/^unsupported channel/i.test(e)) return msg("Channel not supported");
  // The request itself failed (no connection, no answer, the 15-second limit): nothing the provider said, so nothing echoed.
  if (/^callmebot request failed/i.test(e)) return msg("The provider did not answer");
  if (/exceed|quota|too many (messages|requests)|rate limit|message limit|wait \d+ ?(min|sec)/i.test(e)) return msg("Message limit reached");
  if (/invalid (phone|number)|not registered|phone number .*(not|invalid)/i.test(e)) return msg("Phone number not accepted");
  if (/callmebot\s*:/i.test(e)) return msg("The provider refused it");
  return msg("Other problem");
}
