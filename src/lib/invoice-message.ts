/** The message sent with an invoice (WhatsApp / email): who, what, how much, by when, where to pay, and how to check it. */
export function invoiceMessage(x: {
  hotelName: string; hotelPhone?: string | null; greet: string; number: string; final?: boolean;
  group?: { name: string; rooms: number } | null; net: number; paid: number; balance: number; due?: string | null;
  payTo?: string | null; verifyUrl?: string | null;
}) {
  const n = (v: number) => v.toLocaleString("en-US");
  return [
    `Dear ${x.greet},`,
    `${x.final ? "Final group invoice" : "Invoice"} ${x.number} from ${x.hotelName}${x.group ? ` for ${x.group.name} (${x.group.rooms} room${x.group.rooms === 1 ? "" : "s"})` : ""}: total TZS ${n(x.net)}${x.paid ? `, paid TZS ${n(x.paid)}` : ""}.`,
    x.balance > 0 ? `Amount due: TZS ${n(x.balance)}${x.due ? ` by ${x.due}` : ""}. Please use ${x.number} as the payment reference.` : "Paid in full — thank you.",
    x.payTo && x.balance > 0 ? `Pay to: ${x.payTo}.` : null,
    x.verifyUrl ? `Check this invoice: ${x.verifyUrl}` : null,
    `${x.hotelName}${x.hotelPhone ? ` · ${x.hotelPhone}` : ""}`,
  ].filter(Boolean).join("\n");
}

/** Where to pay, from the hotel settings. */
export const payToLine = (s: { bankName?: string | null; bankAccountNumber?: string | null; bankAccountName?: string | null; mobileMoneyName?: string | null; mobileMoneyNumber?: string | null }) =>
  [s.bankName && s.bankAccountNumber && `${s.bankName} ${s.bankAccountNumber}${s.bankAccountName ? ` (${s.bankAccountName})` : ""}`, s.mobileMoneyNumber && `${s.mobileMoneyName || "Mobile money"} ${s.mobileMoneyNumber}`].filter(Boolean).join(" · ") || null;
