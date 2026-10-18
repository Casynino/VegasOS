/**
 * Which pages a Developer's visit is written to the audit trail for (owner, 2026-10-14: read-only inspections of sensitive data
 * are logged too). The rule is turned around on purpose: this file lists only the pages that are plainly HARMLESS — the sign-in
 * page and the "no access" page. EVERY other page is logged, so a page added tomorrow is logged from its first day, and an address
 * nobody foresaw is logged too. The account page is NOT on this list: while a Developer works as someone it shows THAT person's
 * profile, phone, email and open sessions with their devices and addresses — and even in its own console it lists the Developer's
 * sessions with devices and addresses — so a visit to it is written like any other sensitive page. Plain functions, no server code — the server writes the entries;
 * the browser only uses the same rule to skip a pointless call.
 */

/** Pages that are exactly this address and nothing under it ("/staff" only redirects to the person's home — "/staff/anything" is not it). */
export const HARMLESS_EXACT_PATHS: readonly string[] = ["/", "/login", "/staff"];

/** Pages that are this address or anything under it. Each one shows nothing about guests, money or other staff. */
export const HARMLESS_AREAS: readonly string[] = [
  "/staff/login",     // the sign-in page
  "/staff/forbidden", // "you do not have access to this page"
];

const MAX_PATH_LENGTH = 300;

/**
 * The address as it is kept: the path only (no query, no #), the way the server will read it — percent-codes decoded, "//", "." and
 * ".." resolved, no trailing slash — so "/staff/account/../users" cannot dress itself up as a harmless page. Null when it is not a usable path.
 */
export function normalizePath(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let path = raw.trim().split(/[?#]/)[0];
  try { path = decodeURIComponent(path); } catch { return null; }
  if (!path.startsWith("/") || /[\u0000-\u001f\u007f\s\\]/.test(path)) return null;
  const parts: string[] = [];
  for (const part of path.split("/")) {
    if (part === "" || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  const clean = `/${parts.join("/")}`;
  return clean.length > MAX_PATH_LENGTH ? null : clean;
}

/** Is this one of the few pages that are never written? An address that cannot be read is NOT harmless. */
export function isHarmlessPath(raw: string | null | undefined): boolean {
  const path = normalizePath(raw);
  if (!path) return false;
  return HARMLESS_EXACT_PATHS.includes(path) || HARMLESS_AREAS.some((p) => path === p || path.startsWith(`${p}/`));
}

/**
 * Is a visit to this address written to the audit trail? Yes for every page that is not on the harmless list — including a page that
 * does not exist yet and an address that cannot be read (better logged than missed). No when there is no address at all (nothing to write).
 */
export function isLoggedPath(raw: string | null | undefined): boolean {
  if (!raw || !raw.trim()) return false;
  return !isHarmlessPath(raw);
}
