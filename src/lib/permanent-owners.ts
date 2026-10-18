import { msg } from "@/i18n/msg";

/**
 * THE PERMANENT OWNERS OF THE SYSTEM (owner, 2026-10-19: "bashleyair@gmail.com and the Developer are the owners of the system, and they can't be
 * suspended or deleted"). Two kinds of account can never be suspended, switched off or deleted — by the Developer, the MD or the Boss:
 *   • every Developer account (the role), and
 *   • the accounts whose e-mail is listed in the PERMANENT_OWNER_EMAILS setting (comma-separated, set in the hosting settings — never written in
 *     the code, which is public).
 * Everybody else — the Boss and the MD included — can be suspended or deleted by the Developer, except the last active Boss (another Boss, or a permanent owner
 * with the MD's role, must stay).
 */
export const PERMANENT_OWNER_EMAILS_ENV = "PERMANENT_OWNER_EMAILS";

export function permanentOwnerEmails(): string[] {
  return (process.env[PERMANENT_OWNER_EMAILS_ENV] ?? "").split(/[,;\s]+/).map((e) => e.trim().toLowerCase()).filter(Boolean);
}

export function isPermanentOwner(account: { email: string; roleCode: string }): boolean {
  return account.roleCode === "DEVELOPER" || permanentOwnerEmails().includes(account.email.trim().toLowerCase());
}

export const PERMANENT_OWNER_REFUSAL = msg("Can't be suspended or deleted: this is a permanent owner of the system.");
export const LAST_BOSS_REFUSAL = msg("This is the only Boss account that is switched on — the top authority must always be kept. Add or promote another Boss first.");
