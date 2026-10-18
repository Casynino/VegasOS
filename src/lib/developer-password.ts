import { msg } from "@/i18n/msg";

/**
 * THE ONE RULE for a Developer's password (owner, 2026-10-17) — the same words as the setup command's (scripts/provision-developer.mjs,
 * a plain .mjs that keeps its own copy: tests/integration/developer-session-2.test.ts checks the two have not drifted) and as the
 * document (docs/developer-account.md, section 2).
 *
 * A pure function: no server code, no database. A staff member's password keeps the ordinary rule (validatePasswordStrength in
 * server/auth.ts); the Developer's own password change uses this one, which is stricter on every point.
 */
export const DEVELOPER_PASSWORD_MIN = 14;
export const DEVELOPER_PASSWORD_MAX = 200;
/** Easy words and patterns a Developer password may not contain (case does not matter). */
export const DEVELOPER_PASSWORD_EASY = /password|passwort|qwerty|123456|letmein|admin/;

/** What is wrong with the password, point by point (never repeats it). An empty list means the password is fine. */
export function developerPasswordProblems(password: string, email: string | null | undefined): string[] {
  const bad: string[] = [];
  if (password.length < DEVELOPER_PASSWORD_MIN) bad.push(`it is shorter than ${DEVELOPER_PASSWORD_MIN} characters`);
  if (password.length > DEVELOPER_PASSWORD_MAX) bad.push(`it is longer than ${DEVELOPER_PASSWORD_MAX} characters`);
  if (!/[A-Z]/.test(password)) bad.push("it has no capital letter");
  if (!/[a-z]/.test(password)) bad.push("it has no small letter");
  if (!/[0-9]/.test(password)) bad.push("it has no number");
  if (!/[^A-Za-z0-9]/.test(password)) bad.push("it has no symbol");
  if (password !== password.trim()) bad.push("it starts or ends with a space");
  const lower = password.toLowerCase();
  const local = (email ?? "").toLowerCase().split("@")[0];
  if (email && lower === email.toLowerCase()) bad.push("it is the same as the email address");
  else if (local.length >= 5 && lower.includes(local)) bad.push("it contains the first part of the email address");
  if (DEVELOPER_PASSWORD_EASY.test(lower)) bad.push("it contains an easy word or pattern");
  return bad;
}

const DEVELOPER_PASSWORD_MESSAGE = msg(
  "The Developer password needs at least 14 characters, with a capital letter, a small letter, a number and a symbol. It must not be your email, contain the first part of it, or contain an easy word like 'password'.",
);

/** What is wrong with a new Developer password, in one sentence (English — translated where it is shown), or null when it is fine. */
export function validateDeveloperPassword(password: string, email: string | null | undefined): string | null {
  return developerPasswordProblems(password, email).length ? DEVELOPER_PASSWORD_MESSAGE : null;
}
