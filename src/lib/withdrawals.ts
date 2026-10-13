import { msg } from "@/i18n/msg";

/**
 * Withdrawals — what the screens and the server share: the states in plain words, nTZS's refusals in plain words, the
 * banks nTZS names, and how a destination is shown (always masked: the full number stays on the server).
 */

/** The least nTZS pays out in one withdrawal (what the recipient gets). */
export const WITHDRAW_MIN_TZS = 5_000;
/** A sanity ceiling for one request (nTZS sets the real limits and says so when it prices). */
export const WITHDRAW_MAX_TZS = 500_000_000;
/** A Lipa number (a till) is paid through nTZS's "spend": the least it pays, and the limit — the amount plus nTZS's fee stays under this. */
export const LIPA_MIN_TZS = 500;
export const LIPA_BELOW_TZS = 1_000_000;

/** The banks nTZS's documentation names for payouts — only these (it publishes no fuller list). */
export const WITHDRAW_BANKS = [
  { code: "CRDB", name: "CRDB Bank" },
  { code: "NMB", name: "NMB Bank" },
  { code: "NBC", name: "NBC Bank" },
] as const;
export const bankName = (code: string | null | undefined) => WITHDRAW_BANKS.find((b) => b.code === code)?.name ?? code ?? "";

export type WithdrawalStatusCode = "QUOTED" | "CANCELLED" | "SUBMITTING" | "UNKNOWN" | "PROCESSING" | "AWAITING_APPROVAL" | "IN_REVIEW" | "COMPLETED" | "FAILED" | "REJECTED";
export type WithdrawalTone = "ok" | "wait" | "warn" | "bad" | "muted";

export const WITHDRAWAL_STATUS: Record<WithdrawalStatusCode, { label: string; tone: WithdrawalTone; hint: string }> = {
  QUOTED: { label: msg("Priced, not sent"), tone: "muted", hint: msg("nTZS gave a price. Nothing was sent.") },
  CANCELLED: { label: msg("Not sent"), tone: "muted", hint: msg("It was never sent to nTZS.") },
  SUBMITTING: { label: msg("Sending"), tone: "wait", hint: msg("It is being sent to nTZS — its answer is not here yet.") },
  UNKNOWN: { label: msg("Not confirmed"), tone: "warn", hint: msg("nTZS gave no clear answer, so nobody knows yet whether the money was sent. Do not send it again until this is settled.") },
  PROCESSING: { label: msg("On its way"), tone: "wait", hint: msg("nTZS accepted it and is paying it out. It is not finished until nTZS confirms.") },
  AWAITING_APPROVAL: { label: msg("Waiting for nTZS"), tone: "wait", hint: msg("nTZS approves large withdrawals itself before paying — this can take up to one working day.") },
  IN_REVIEW: { label: msg("nTZS is checking it"), tone: "warn", hint: msg("nTZS could not confirm the payout by itself and is checking it. It tells the hotel when it is settled.") },
  COMPLETED: { label: msg("Completed"), tone: "ok", hint: msg("nTZS confirmed the money arrived.") },
  FAILED: { label: msg("Failed — money returned"), tone: "bad", hint: msg("nTZS could not pay it out. The money went back to the hotel's nTZS balance.") },
  REJECTED: { label: msg("Refused — nothing sent"), tone: "bad", hint: msg("nTZS refused the request. No money moved.") },
};

/** States shown in the history (a price nobody confirmed is not a withdrawal). */
export const WITHDRAWAL_LISTED: WithdrawalStatusCode[] = ["SUBMITTING", "UNKNOWN", "PROCESSING", "AWAITING_APPROVAL", "IN_REVIEW", "COMPLETED", "FAILED", "REJECTED"];
/** nTZS has (or may have) the request and has not finished it. */
export const WITHDRAWAL_IN_FLIGHT: WithdrawalStatusCode[] = ["SUBMITTING", "UNKNOWN", "PROCESSING", "AWAITING_APPROVAL", "IN_REVIEW"];
/** Nobody knows the outcome — no new withdrawal until it is settled. */
export const WITHDRAWAL_UNSETTLED: WithdrawalStatusCode[] = ["SUBMITTING", "UNKNOWN"];

/** The filter groups of the history. */
export const WITHDRAWAL_FILTERS = [
  { key: "all", label: msg("All"), statuses: WITHDRAWAL_LISTED },
  { key: "pending", label: msg("Pending"), statuses: ["SUBMITTING", "PROCESSING", "AWAITING_APPROVAL", "IN_REVIEW"] as WithdrawalStatusCode[] },
  { key: "unconfirmed", label: msg("Not confirmed"), statuses: ["UNKNOWN"] as WithdrawalStatusCode[] },
  { key: "completed", label: msg("Completed"), statuses: ["COMPLETED"] as WithdrawalStatusCode[] },
  { key: "failed", label: msg("Failed or refused"), statuses: ["FAILED", "REJECTED"] as WithdrawalStatusCode[] },
] as const;

/**
 * nTZS's refusal in plain words, by its own code (the record keeps the code; the words are said in the reader's
 * language where they are shown). None = a code we have no words for — the record's own text is shown instead.
 */
export function withdrawalProblem(code: string | null | undefined, kind?: string | null): string | null {
  // A Lipa number has its own least and its own limit.
  if (kind === "LIPA" && code === "invalid_amount") return msg("nTZS does not pay out this amount to a Lipa number — the least is TZS 500.");
  if (kind === "LIPA" && code === "amount_too_large") return msg("A Lipa number takes less than TZS 1,000,000 at a time, fee included — use a smaller amount.");
  switch (code) {
    case "invalid_amount": return msg("nTZS does not pay out this amount — the least is TZS 5,000.");
    case "amount_too_large": return msg("This is more than nTZS pays out in one withdrawal — use a smaller amount.");
    case "till_network_required": return msg("nTZS could not tell which mobile network this Lipa number belongs to, so it did not pay it — nothing moved. Ask nTZS, or send to a phone or a bank account.");
    case "spend_disabled": case "spend_kind_disabled": return msg("nTZS has not switched on payments to Lipa numbers for the hotel yet — nothing was sent. Ask nTZS to switch them on, or send to a phone or a bank account.");
    case "invalid_phone": return msg("That phone number is not a Tanzanian mobile-money number.");
    case "insufficient_balance": return msg("There is not enough money at nTZS for this amount and its fee.");
    case "quote_stale": case "invalid_quote": case "quote_mismatch": case "quote_required":
      return msg("The price ran out before it was sent — nothing moved. Price the withdrawal again.");
    case "kyb_required": return msg("nTZS has not yet approved the hotel's business account (KYB). Until it does, only one small withdrawal is allowed — nTZS has to finish the approval.");
    case "capability_required": return msg("Withdrawals are not switched on for the hotel's nTZS account yet — nTZS has to allow payouts from the hotel's balance.");
    case "wallet_frozen": return msg("The hotel's nTZS balance is frozen — nTZS has to release it.");
    case "ip_not_allowed": return msg("nTZS blocks the hotel's system (its list of allowed addresses) — the administrator has to change it at nTZS.");
    case "treasury_not_provisioned": case "wallet_not_provisioned": case "not_provisioned": case "funding_source_required": case "end_user_required": case "user_not_found": case "missing_required_fields": case "configuration_error":
      return msg("The hotel's nTZS account is not ready for withdrawals yet — the administrator has to finish setting it up with nTZS.");
    case "token_paused": return msg("nTZS has paused payouts for the moment — nothing was sent. Try again later.");
    case "bank_rail_unavailable": return msg("nTZS cannot pay to bank accounts at the moment — nothing was sent. Send to a phone, or try again later.");
    case "bank_amount_unsupported": return msg("nTZS cannot send this amount to a bank account — change the amount, or send to a phone.");
    case "compliance_screening_blocked": return msg("nTZS does not pay to this recipient.");
    case "compliance_screening_unavailable": case "relayer_unavailable": case "database_error":
      return msg("nTZS could not do it just now — nothing was sent. Try again in a few minutes.");
    case "rate_limited": return msg("nTZS is busy — wait a moment and try again.");
    case "unauthorized": return msg("nTZS did not accept the hotel's key — the administrator has to check it.");
    case "payout_failed": return msg("The payout did not go through. nTZS returned the money to the hotel's balance.");
    case "no_answer": return msg("nTZS did not answer in time.");
    case "not_confirmed": return msg("nTZS could not say whether this withdrawal was sent.");
    case "settled_by_hand": return msg("Settled by hand as not sent.");
  }
  return null;
}

/**
 * What a person is told about a withdrawal that needs them — fixed sentences (kept on the record in English, one per
 * line, and said in the reader's language where they are shown).
 */
export const WITHDRAWAL_NOTES = {
  noAnswer: msg("nTZS gave no clear answer when this was sent. Ask nTZS again before sending this money a second time."),
  notFound: msg("nTZS was asked again and could not say whether this withdrawal was sent. If it was sent, nTZS will report it here by itself. If nothing comes, compare the balance at nTZS and settle it by hand."),
  confirmedLate: msg("nTZS has this withdrawal although it had been marked as not sent. The record now follows nTZS."),
  takenBack: msg("nTZS reports that this withdrawal did not go through, after it was recorded as completed. The money returned to the nTZS balance and the hotel's books were corrected."),
  otherAmount: msg("nTZS paid a different amount than was asked. The hotel's books follow what nTZS confirmed."),
  otherFigures: msg("nTZS now reports other figures for this withdrawal than the ones recorded. Tell the administrator."),
  reviewAgain: msg("nTZS is checking this withdrawal again. Nothing changes in the hotel's books until it says more."),
  handButPending: msg("nTZS still shows this withdrawal as not finished, although it was settled by hand."),
  slow: msg("nTZS has not finished this withdrawal for a long time. Ask nTZS again."),
  noBooks: msg("The hotel's books could not be updated for this withdrawal — tell the administrator."),
  second: msg("nTZS reports another withdrawal under this same request. Tell the administrator at once."),
} as const;

/** The steps of a withdrawal's history, in plain words (by the action kept in the audit trail). */
export const WITHDRAWAL_EVENTS: Record<string, string> = {
  "withdrawal.quoted": msg("Priced by nTZS"),
  "withdrawal.submitted": msg("Confirmed and sent to nTZS"),
  "withdrawal.refused": msg("nTZS refused it — nothing was sent"),
  "withdrawal.unconfirmed": msg("nTZS gave no clear answer"),
  "withdrawal.status_changed": msg("nTZS reported a new state"),
  "withdrawal.completed": msg("nTZS confirmed the money arrived — recorded in the books"),
  "withdrawal.returned": msg("nTZS could not pay it — the money was returned"),
  "withdrawal.fee_corrected": msg("nTZS confirmed a different fee than its price — corrected in the books"),
  "withdrawal.checked": msg("nTZS was asked again"),
  "withdrawal.flagged": msg("Marked for a person to look at"),
  "withdrawal.reconciled_by_hand": msg("Settled by hand"),
  "withdrawal.acknowledged": msg("Seen by a person"),
};

/** A stuck withdrawal nTZS knows about may be settled by hand only after this long. */
export const WITHDRAW_HAND_SETTLE_AFTER_MS = 24 * 3_600_000;
/** One nobody could confirm: this long after it was sent (time for nTZS's own report to arrive), once nTZS was asked again. */
export const WITHDRAW_HAND_SETTLE_UNKNOWN_MS = 15 * 60_000;

/**
 * May a person settle it by hand? Only when nTZS cannot say: a withdrawal nobody could confirm — once nTZS was asked
 * again and still could not say, and a quarter of an hour passed (or a day passed); or one nTZS has kept unfinished
 * for a day.
 */
export function canSettleByHand(w: { status: string; failureCode: string | null; submittedAt: Date | null }, now: Date): boolean {
  const age = w.submittedAt ? now.getTime() - w.submittedAt.getTime() : 0;
  if (w.status === "UNKNOWN") return (w.failureCode === "not_confirmed" && age > WITHDRAW_HAND_SETTLE_UNKNOWN_MS) || age > WITHDRAW_HAND_SETTLE_AFTER_MS;
  return ["PROCESSING", "AWAITING_APPROVAL", "IN_REVIEW"].includes(w.status) && age > WITHDRAW_HAND_SETTLE_AFTER_MS;
}

/** Problems only the administrator can clear with nTZS (the screen says so instead of offering to try again). */
export const WITHDRAWAL_SETUP_CODES: readonly string[] = ["kyb_required", "capability_required", "wallet_frozen", "ip_not_allowed", "treasury_not_provisioned", "wallet_not_provisioned", "not_provisioned", "funding_source_required", "end_user_required", "user_not_found", "configuration_error", "unauthorized", "spend_disabled", "spend_kind_disabled"];

/** "255712345678" → "0712 ••• 678". */
export const maskPhone = (p: string) => `0${p.slice(3, 6)} ••• ${p.slice(-3)}`;
/** "0150123456700" → "•••• 6700". */
export const maskAccount = (a: string) => `•••• ${a.replace(/\s/g, "").slice(-4)}`;

/** Where the money went, for a screen — never the full number. */
export function maskedDestination(w: { destinationKind: string; phone: string | null; bankCode: string | null; accountNumber: string | null }): string {
  if (w.destinationKind === "BANK") return `${bankName(w.bankCode)} ${maskAccount(w.accountNumber ?? "")}`;
  // A Lipa number is kept in accountNumber (and its network, only when nTZS asked for it, in bankCode).
  if (w.destinationKind === "LIPA") return `Lipa ${maskAccount(w.accountNumber ?? "")}`;
  return w.phone ? maskPhone(w.phone) : "—";
}
