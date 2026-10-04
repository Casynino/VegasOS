/** What the Waiter Workspace's parts share. */

export const tzs = (v: number) => `TZS ${v.toLocaleString("en-US")}`;
export const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/** An open order's step, in the waiter's words. */
export const STATUS_WORD: Record<string, string> = {
  PENDING: "New", ACCEPTED: "Accepted", PREPARING: "Preparing", READY: "Ready to serve", OUT_FOR_DELIVERY: "Serving", DELIVERED: "Served · to pay",
};

type Result = { ok: true; message?: string } | { ok: false; error: string };
/** A transfer waiting for its colleague and reason; `back` reopens the close-shift dialog after. */
export type TransferRequest = { title: string; what: string; run: (toWaiterId: string, reason: string) => Promise<Result>; back?: boolean };
