/** The built-in wording of the guest thank-you note — each line can be changed in Settings. */
export const THANK_YOU_DEFAULTS = {
  message: "It was our pleasure to have you stay with us. We hope you enjoyed your time at the hotel and that your stay was comfortable and memorable.\n\nWe look forward to welcoming you back again.",
  signoff: "Warm regards,\nThe Vegas Luxury Hotel team",
  promoTitle: "We hope to see you again",
  promoText: "Whether you return for business or for rest, everything you enjoyed is here for your next visit.",
  rebookText: "Planning your next stay? Book directly with us — the best rate, and the room you like, kept for you.",
};

/** A guest's stay as the thank-you note shows it — only this guest's own stay and figures. */
export interface StaySnapshot {
  guest: { name: string; phone: string | null; email: string | null };
  reference: string;
  rooms: { number: string; type: string; nights: number; rate: number; dayUse: boolean }[];
  arrival: string;
  departure: string;
  checkedInAt: string | null;
  checkedOutAt: string | null;
  nights: number;
  guests: number;
  /** Group / company booking: shown by name only — never the other rooms' charges. */
  group: { name: string; contact: string | null } | null;
  company: string | null;
  charges: { room: number; restaurant: number; bar: number; roomService: number; transport: number; other: number };
  subtotal: number;
  discount: number;
  adjustments: number;
  total: number;
  /** Paid by the guest on this stay. */
  paid: number;
  /** Settled by the company / group account (not owed by the guest). */
  billedTo: { name: string; amount: number } | null;
  balance: number;
}
