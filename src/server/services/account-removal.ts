import "server-only";
import { randomUUID } from "node:crypto";
import { hashPassword } from "../auth";
import { db } from "../db";

/** Where a deleted account's e-mail address goes: nobody can sign in with it, and the real address is free to be used again. */
export const REMOVED_EMAIL_DOMAIN = "removed.invalid";

/** A password nobody knows, made before the deletion's transaction starts (hashing takes a moment). */
export const unusablePasswordHash = () => hashPassword(`${randomUUID()}${randomUUID()}`);

type Tx = Parameters<Parameters<typeof db.$transaction>[0]>[0];

/**
 * DELETE AN ACCOUNT (owner, 2026-10-19: "delete an account does not mean delete the data — the records stay, with that name and who did what; delete
 * only removes the person's access and the account from the system"). The person is signed out everywhere, can never sign in again (password unusable,
 * e-mail address freed) and the account leaves every list — but the row stays, so every booking, payment, shift, order and audit entry keeps their name.
 * Same for the Developer's Delete and the Boss's/MD's Delete. Run inside the caller's transaction, with the password made beforehand.
 */
export async function removeAccountAccess(tx: Tx, userId: string, passwordHash: string): Promise<void> {
  await tx.session.deleteMany({ where: { userId } });
  await tx.user.update({
    where: { id: userId },
    data: {
      removedAt: new Date(), isActive: false, passwordHash, email: `removed-${userId}@${REMOVED_EMAIL_DOMAIN}`,
      phone: null, mustChangePassword: false, staffCode: null, pinHash: null, pinSetAt: null, pinFailedCount: 0, pinLockedUntil: null,
    },
  });
}
