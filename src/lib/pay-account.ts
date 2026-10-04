/** A hotel payment account as offered in "Received through" / "Paid from" pickers. */
export type PayAccount = { id: string; name: string; number?: string | null; holder?: string | null };

/** "CRDB Bank — 015C799490700" (Cash has no number). */
export const accountLabel = (a: PayAccount) => (a.number ? `${a.name} — ${a.number}` : a.name);
/** "VEGAS LUXURY HOTEL · 015C799490700" — shown to confirm the choice. */
export const accountDetail = (a: PayAccount | undefined | null) => (a ? [a.holder, a.number].filter(Boolean).join(" · ") : "");
