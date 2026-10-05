/** What the Restaurant Portal shows of an order (built on the server; money is left out for the cook). */
/** cook = Mpishi · waiter · desk = reception (tell customers, collect payment) · manager / admin. */
export type PortalRole = "cook" | "waiter" | "desk" | "manager";

export type PortalItem = {
  id: string; menuItemId: string | null; name: string; quantity: number; type: string; image: string | null; prepared: boolean;
  /** Prices as ordered — null for the cook. */
  unitPrice: number | null; lineTotal: number | null;
  /** 1 = the first order; 2+ = added later (when, by whom — null: the customer). */
  round: number; addedAt: string; addedBy: string | null;
  /** Already paid (a payment covers it) — never removed from the order. */
  paid: boolean;
};

/** A payment taken for the order: who collected it and who at reception confirmed it (or that it was reversed). */
export type PortalPayment = {
  id: string; amount: number; account: string; reference: string | null; status: string;
  collectedBy: string | null; collectedRole: string | null; collectedAt: string;
  /** Recorded through the shared Restaurant Counter (the official payment station) — show "Restaurant Counter", not a person. */
  atCounter: boolean;
  /** Paid online by the customer (LIPA) — recorded automatically as the order came in. */
  online: boolean;
  /** Paid by mobile money from a phone (nTZS) — recorded by itself when the money arrived: shown simply as "Paid". */
  byPhone: boolean;
  /** …the staff member who sent the payment request — null when the customer paid from their phone by themselves. */
  phoneSentBy: string | null;
  /** Paid online but the money never reached the account ("Payment not received") — reversed, not a refund. */
  notReceived: boolean;
  /** The waiter who physically brought the money to the Counter (optional; not the collector). */
  handedOverBy: string | null;
  confirmedBy: string | null; confirmedAt: string | null; reverseReason: string | null;
};

export type PortalOrder = {
  id: string; number: string; type: string; status: string; settlement: string; source: string;
  customer: string | null; phone: string | null; room: string | null; table: string | null;
  /** Where the waiter takes it: "Room 305", "Table 07", "Counter", "Take out — <address>". */
  place: string;
  /** Take out: the customer's delivery address. */
  address: string | null;
  /** Take out paid first: the customer's payment screenshot (staff only), the account they paid and their code — to check and record. */
  proof: { url: string; accountId: string | null; account: string | null; reference: string | null; at: string } | null;
  /**
   * Paid online but nothing recorded from the proof yet (only when no Restaurant Counter account exists to
   * record it automatically): nobody accepts it until it is checked. Shown to everyone, the cook too (no money in it).
   */
  awaitsPayment: boolean;
  /** The customer chose Pay online (nTZS): PAYING — the payment is on its way from their phone; NOT_PAID — take out not paid yet. Not accepted until paid. */
  online: "PAYING" | "NOT_PAID" | null;
  notes: string | null; cancelReason: string | null;
  createdAt: string; acceptedAt: string | null; readyAt: string | null; takenAt: string | null; deliveredAt: string | null; doneAt: string | null;
  acceptedBy: string | null; readyBy: string | null; takenBy: string | null; deliveredBy: string | null;
  items: PortalItem[];
  /** Money — null for the cook. */
  total: number | null; serviceFee: number | null; paidTo: string | null;
  /** Paid so far and still due (direct orders; 0 due on a room bill) — null for the cook. */
  paid: number | null; due: number | null;
  /** UNPAID | PENDING_CONFIRMATION | PARTIALLY_PAID | PAID | REFUNDED (null for the cook). */
  payment: string | null;
  payments: PortalPayment[];
  /** Which round of items the kitchen is on (2+ = the customer ordered more). */
  round: number;
  /** A table / the counter / the main restaurant QR. */
  location: { kind: string; area: string | null; number: number | null } | null;
  /** Where the order came from: "Room QR", "Website menu", "Reception"… */
  sourceLabel: string;
  /** The booking (and whether the guest is still staying, so a room-bill order can still be paid now instead). */
  reservation: { id: string; reference: string; staying: boolean } | null;
  /** Who took the order (staff), when and how it was paid. */
  createdBy: string | null; paidAt: string | null; paymentRef: string | null;
  /** The waiter a manager handed the order to. */
  assignedTo: { id: string; name: string } | null;
  /** Complaints logged about this order (open ones need a manager). */
  complaints: { total: number; open: number };
  /** The customer's WhatsApp update for this step (waiters / reception). */
  update: { to: string; text: string; type: string } | null;
  /** That update was already sent (WhatsApp from the desk, or automatically). */
  told: boolean;
  /**
   * The hotel rooms of this order's customer and of the people at its table, right now — the
   * only rooms a waiter may put its bill on ("Charge to Room 305"). Empty for the cook.
   */
  stays: PortalStay[];
};

/** A customer's stay: "Room 305" (or "305, 306"), whose booking it is, and who pays their food (a company or group), if not them. */
export type PortalStay = { id: string; rooms: string; guestName: string; foodPayer: string | null };

/** A staying room anyone may pick — only for reception and managers, who can check stays: "Room 305 — Nino" (never a phone or balance). */
export type RoomChoice = { id: string; label: string };

/** What this person may do (the server checks every step again). */
/**
 * cook = prepare any order (kitchen.orders) · bar = drinks-only orders (bar.orders) · waiter = see orders, take orders, text
 * customers (restaurant.orders) · serve = take out, deliver, add items (restaurant.serve) · pay = record payments ·
 * confirm = confirm waiters' payments · cancelLate = cancel once cooking, reverse payments (revenue.void) · manage = menu & settings.
 */
export type PortalPerms = {
  cook: boolean; bar: boolean; waiter: boolean; serve: boolean; pay: boolean; confirm: boolean; cancelLate: boolean; manage: boolean;
  /** Managers and the MD: they watch the restaurant live (every order, every step, the money) — the kitchen, bar and waiters do the work. */
  watch?: boolean;
  /** Reception, managers and the MD check who is staying (reservations.view): any staying room, another guest's with a reason. Waiters: the customer's own room only. */
  verify?: boolean;
  /** The shared restaurant screen: taking charge and taking money ask the waiter's PIN (useWaiterPin). */
  device?: boolean;
};

export type SoundConfig = {
  enabled: boolean; volume: number; newSound: string; readySound: string;
  /** Payments a waiter collects wait for reception to confirm them. */
  confirmPayments: boolean;
};

/** A shortcut button (drawn with the dashboards' quick-action pills). */
export type Shortcut = { href: string; label: string; hint?: string; icon: "plus" | "menu" | "stock" | "qr" | "web" | "sale"; tone: "gold" | "amber" | "sky" | "violet" | "emerald" | "rose" };

/** Where the restaurant's money is right now (not for the cook). */
export type MoneySummary = { received: number; receivedOrders: number; toCollect: number; toCollectOrders: number; onRooms: number; rooms: number; toConfirm: number; toConfirmAmount: number };
