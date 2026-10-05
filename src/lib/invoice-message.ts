import { invoiceMessageText } from "./wa-messages";

/**
 * The message sent with an invoice (WhatsApp / email), in the Vegas style (src/lib/wa-messages.ts): who, what, the
 * total, paid and balance, by when, and the invoice's own page — where it is checked and paid by mobile money. No bank
 * or account numbers (owner, 2026-10-05: online payment is mobile money only); `payTo` is no longer used.
 */
export function invoiceMessage(x: {
  hotelName: string; hotelPhone?: string | null; greet: string; number: string; final?: boolean;
  group?: { name: string; rooms: number } | null; net: number; paid: number; balance: number; due?: string | null;
  payTo?: string | null; verifyUrl?: string | null; issued?: string | null;
}) {
  return invoiceMessageText({
    hotel: { name: x.hotelName, phone: x.hotelPhone ?? null }, greet: x.greet, number: x.number, final: x.final,
    forWhat: x.group ? `${x.group.name} (${x.group.rooms} room${x.group.rooms === 1 ? "" : "s"})` : null,
    issued: x.issued ?? null, due: x.due ?? null, money: { total: x.net, paid: x.paid, balance: x.balance }, url: x.verifyUrl ?? null,
  });
}

/** Where to pay, from the hotel settings. */
export const payToLine = (s: { bankName?: string | null; bankAccountNumber?: string | null; bankAccountName?: string | null; mobileMoneyName?: string | null; mobileMoneyNumber?: string | null }) =>
  [s.bankName && s.bankAccountNumber && `${s.bankName} ${s.bankAccountNumber}${s.bankAccountName ? ` (${s.bankAccountName})` : ""}`, s.mobileMoneyNumber && `${s.mobileMoneyName || "Mobile money"} ${s.mobileMoneyNumber}`].filter(Boolean).join(" · ") || null;
