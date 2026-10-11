/**
 * The Boss's WhatsApp messages: short, and the link always arrives.
 *
 * The provider delivers only the first part of a long text — on 11 Oct 2026 a room report arrived cut after about
 * 718 characters (about 934 once written into the address it is sent in), and the link at its end was lost. So every
 * report message is put together here: a short summary, then the link on its own line at the bottom. When the summary
 * is too long, the summary is shortened — never the link.
 */

/** Well under what arrived whole (718 characters / 934 written into the address). */
export const WA_MAX_CHARS = 640;
export const WA_MAX_ENCODED = 840;

/** How long the text is once written into the address the provider is called with (a Chinese character costs 9). */
export const encodedLength = (s: string) => new URLSearchParams({ t: s }).toString().length - 2;
const chars = (s: string) => [...s].length;

/** The whole message reaches the phone. */
export const fitsWhatsApp = (s: string) => chars(s) <= WA_MAX_CHARS && encodedLength(s) <= WA_MAX_ENCODED;

export type Line = string | null | undefined | false;

const tidy = (lines: Line[]) => lines.filter((l): l is string => typeof l === "string").join("\n").replace(/\n{3,}/g, "\n\n").trim();
const linkTail = (link: string | null | undefined, label: string) => (link ? `\n\n*${label}*\n${link}` : "");

/** The body with as many of its lines as fit before `tail` (the last lines go first; a single long line is cut). */
function shorten(body: string, tail: string): string {
  const lines = body.split("\n");
  while (lines.length > 1 && !fitsWhatsApp(lines.join("\n").trimEnd() + tail)) lines.pop();
  let text = lines.join("\n").trimEnd();
  while (text && !fitsWhatsApp(text + tail)) text = [...text].slice(0, -8).join("").trimEnd();
  return text;
}

/**
 * A report's message: the summary, then the link under its own label, last.
 * `versions` is the same summary from the fullest to the shortest — the first one that fits together with the link is
 * sent. If even the shortest is too long, its last lines are left out. The link is never shortened.
 */
export function reportMessage(versions: Line[][], link: string | null | undefined, linkLabel: string): string {
  const tail = linkTail(link, linkLabel);
  const bodies = versions.map(tidy);
  const whole = bodies.find((b) => fitsWhatsApp(b + tail));
  return (whole ?? shorten(bodies[bodies.length - 1] ?? "", tail)) + tail;
}

const URL_RE = /https?:\/\/\S+/g;

/**
 * The last check before any report message is sent, whoever wrote it: a text that would be cut is shortened so that
 * its link (and the label above it) still arrives. A text that fits is sent exactly as it is.
 */
export function keepLink(text: string): string {
  if (fitsWhatsApp(text)) return text;
  const links = [...text.matchAll(URL_RE)];
  const last = links[links.length - 1];
  if (!last) return shorten(text, "");
  const lineStart = text.lastIndexOf("\n", last.index) + 1;
  const lineEnd = text.indexOf("\n", last.index);
  const sameLine = text.slice(lineStart, last.index).trim();
  // The label is the words before the link on its line, or the line above it ("*Full report:*").
  const above = text.slice(0, Math.max(0, lineStart - 1));
  const aboveStart = above.lastIndexOf("\n") + 1;
  const labelLine = sameLine || above.slice(aboveStart).trim();
  const isLabel = labelLine.length > 0 && labelLine.length <= 60 && /[:：]\*?$/.test(labelLine);
  const cutFrom = sameLine || !isLabel ? lineStart : aboveStart;
  // Everything but the link's own lines is the summary — also what was written under the link.
  const body = `${text.slice(0, cutFrom).trimEnd()}\n\n${lineEnd < 0 ? "" : text.slice(lineEnd).trim()}`.replace(/\n{3,}/g, "\n\n").trim();
  const tail = `\n\n${isLabel ? `${labelLine}\n` : ""}${last[0]}`;
  return shorten(body, tail) + tail;
}

/** "103, 104, 105, 108" → "103-105, 108" (room numbers, in order) — the same rooms in fewer characters. */
export function roomRanges(rooms: string[]): string {
  const sorted = [...rooms].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  const out: string[] = [];
  for (let i = 0; i < sorted.length; ) {
    let j = i;
    while (j + 1 < sorted.length && /^\d+$/.test(sorted[j]) && /^\d+$/.test(sorted[j + 1]) && Number(sorted[j + 1]) === Number(sorted[j]) + 1) j++;
    out.push(j - i >= 2 ? `${sorted[i]}-${sorted[j]}` : sorted.slice(i, j + 1).join(", "));
    i = j + 1;
  }
  return out.join(", ");
}
