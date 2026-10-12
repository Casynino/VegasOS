import { englishT, type T } from "@/i18n/translate";
import { msg } from "@/i18n/msg";

/** A hotel payment account as offered in "Received through" / "Paid from" pickers. */
export type PayAccount = { id: string; name: string; number?: string | null; holder?: string | null };

/** "CRDB Bank — 015C799490700" (Cash has no number). The account's name in the reader's language when their `t` is given. */
export const accountLabel = (a: PayAccount, t: T = englishT) => (a.number ? `${t(a.name)} — ${a.number}` : t(a.name));
/**
 * The nTZS account carries nTZS's name for the people who keep the books (Finance, the Boss's reports). On a guest's own
 * paper — a receipt, the stay bill — it reads the way they paid: mobile money from their phone.
 */
export const guestAccountName = (a: { code: string; name: string }): string => (a.code === "NTZS" ? msg("Mobile money (phone)") : a.name);
/** "VEGAS LUXURY HOTEL · 015C799490700" — shown to confirm the choice. */
export const accountDetail = (a: PayAccount | undefined | null) => (a ? [a.holder, a.number].filter(Boolean).join(" · ") : "");
