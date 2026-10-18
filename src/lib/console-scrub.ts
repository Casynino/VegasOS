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
  let s = raw.slice(0, max * 8 + 200).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
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

// ───────────────────────────── what the system records about its own errors (owner, 2026-10-18) ─────────────────────────────
// An error is written to the database so the Developer can see that something is wrong. It must NEVER carry personal or secret
// data: no emails, no phone numbers or long numbers, no keys / tokens / passwords, no connection strings, no query strings, no request
// bodies, no values that a failed database call dumps into its message. Everything below is a pure function: text in, text out.

/** The longest message the system keeps about one error. */
export const EVENT_TEXT_MAX = 300;

const EMAIL = /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi;
const URL_LIKE = /\b[a-z][a-z0-9+.-]{1,20}:\/\/[^\s'"`<>)]+/gi;

/**
 * Text that is safe to STORE and to show the Developer: markup and control characters out, emails, links' query strings and
 * user-info, connection strings, keys, tokens, passwords, any number of 7 digits or more (a phone number, an account number), values
 * in quotes and in `Key (field)=(value)`, then cut to 300 characters. Always returns text (maybe empty).
 */
export function scrubEventText(raw: unknown, max = EVENT_TEXT_MAX): string {
  if (raw === null || raw === undefined) return "";
  let s = typeof raw === "string" ? raw : (() => { try { return String(raw); } catch { return ""; } })();
  // Bounded BEFORE any pattern runs: some patterns below are slow on very long text, and a visitor can send a very long address.
  if (s.length > max * 4 + 200) s = s.slice(0, max * 4 + 200);
  s = s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, " ").replace(/<[^>]+>/g, " ");
  // connection strings and links: never the user-info, the query string or the fragment
  s = s.replace(URL_LIKE, (m) => {
    if (/^postgres|^mysql|^mongodb|^redis|^amqp/i.test(m)) return "[database address]";
    try { const u = new URL(m); return `${u.protocol}//${u.host}${u.pathname}`; } catch { return "[link]"; }
  });
  s = s.replace(/\?[^\s'"`]*(?:=[^\s'"`]*)+/g, "?…"); // a bare "…?a=1&b=2" that was not a full link
  s = s.replace(EMAIL, "[email]");
  s = s.replace(/\beyJ[\w-]{6,}\.[\w-]{6,}\.[\w-]*/g, "[token]"); // a JWT
  s = s.replace(/\b(api[_-]?key|key|token|secret|password|passwd|pwd|authorization|signature|cookie|session)\b["']?\s*[=:]\s*["']?(?:(?:basic|bearer|digest)\s+)?[^\s,;'"`)}\]]+/gi, "$1=[hidden]");
  s = s.replace(/\bbearer\s+\S+/gi, "bearer [hidden]");
  // Postgres: `Key (email)=(someone) already exists` — keep the field, drop the value
  s = s.replace(/=\([^)]*\)/g, "=(…)");
  // a number of 7 digits or more, however it is spaced, dashed or bracketed (a date such as 2026-10-17 is not a phone number: its dashes are set aside meanwhile)
  s = s.replace(/(?<!\d)(\d{4})-(\d{2})-(\d{2})(?!\d)/g, "$1\u2011$2\u2011$3");
  s = s.replace(/\+?\d[\d\s().-]{5,}\d/g, (m) => (m.replace(/\D/g, "").length >= 7 ? "[number]" : m));
  s = s.replace(/\u2011/g, "-");
  // a key, a token, an id: a long run of letters / digits / signs that holds a digit (a path or a plain long word does not)
  s = s.replace(/[A-Za-z0-9_\-+=]{24,}/g, (m) => (/\d/.test(m) || m.length >= 40 ? "[token]" : m));
  // quoted values: a quoted word that is a name of something in the code stays; any other quoted text may be a person's words
  s = s.replace(/(?<![A-Za-z0-9])(["'])((?:(?!\1)[^\n]){1,200}?)\1/g, (m, q: string, inner: string) => (/^[A-Za-z_][\w$.-]{0,40}$/.test(inner) ? m : `${q}…${q}`));
  s = s.replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * The one line of an error's message worth keeping. A failed database call (Prisma) writes `Invalid \`prisma.model.op()\` invocation`,
 * then the CODE of the call WITH ITS ARGUMENTS (the values), and only at the end the reason — so for those the call's name and the
 * reason are kept and everything between (the values) is dropped. Any other message: its first non-empty line.
 */
export function firstMeaningfulLine(message: unknown): string {
  const text = typeof message === "string" ? message : "";
  const lines = text.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  if (!lines.length) return "";
  const call = text.match(/Invalid\s+`prisma\.([\w.$]+)\(\)`\s+invocation/);
  if (call) {
    const paragraphs = text.split(/\n\s*\n/).map((p) => p.trim()).filter(Boolean);
    const last = paragraphs.length > 1 ? paragraphs[paragraphs.length - 1].split(/\r?\n/)[0].trim() : "";
    const reason = last && !/^[→│\d{}()[\]+~-]/.test(last) && !/^Invalid\s+`prisma\./.test(last) ? last : "";
    return `prisma.${call[1]}() failed${reason ? ` — ${reason}` : ""}`;
  }
  return lines[0];
}

/** What kind of thrown value it is, how it was called, and its code — without ever reading a value out of it. */
export function errorFacts(error: unknown): { name: string; code: string | null; message: string } {
  const e = (error ?? {}) as { name?: unknown; code?: unknown; message?: unknown; cause?: unknown; constructor?: { name?: unknown } };
  const isObj = typeof error === "object" && error !== null;
  const name = typeof e.name === "string" && e.name ? e.name : isObj && typeof e.constructor?.name === "string" && e.constructor.name !== "Object" ? e.constructor.name : isObj ? "ThrownObject" : typeof error === "string" ? "ThrownText" : "ThrownValue";
  const cause = (isObj && typeof e.cause === "object" && e.cause ? e.cause : null) as { code?: unknown } | null;
  const rawCode = isObj ? (typeof e.code === "string" || typeof e.code === "number" ? e.code : cause && (typeof cause.code === "string" || typeof cause.code === "number") ? cause.code : null) : null;
  const code = rawCode === null ? null : String(rawCode).slice(0, 40).replace(/[^\w.:-]/g, "");
  const message = typeof error === "string" ? error : isObj && typeof e.message === "string" ? e.message : "";
  return { name: name.slice(0, 80).replace(/[^\w.$-]/g, ""), code: code || null, message };
}

/**
 * The top frames of a stack as `path/to/file.ts:line` — project files only (never node_modules, never Node's own), no values, no
 * columns. A compiled build writes its frames as chunk files; a frame from a source-mapped file keeps its source path.
 */
export function stackFrames(stack: unknown, max = 5): string[] {
  if (typeof stack !== "string") return [];
  const out: string[] = [];
  for (const line of stack.split("\n")) {
    if (!/^\s*at\s/.test(line) || /node_modules|node:internal|\(<anonymous>\)\s*$/.test(line)) continue;
    const m = line.match(/((?:src|prisma|scripts|app|pages)\/[^\s():?#]+?\.(?:tsx?|jsx?|mjs|cjs)):(\d+)(?::\d+)?/)
      ?? line.match(/(\.next\/server\/[^\s():?#]+?\.(?:js|mjs)):(\d+)(?::\d+)?/);
    if (!m) continue;
    const frame = `${m[1]}:${m[2]}`;
    if (!out.includes(frame)) out.push(frame);
    if (out.length >= max) break;
  }
  return out;
}
