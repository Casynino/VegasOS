import "server-only";
import { db, type Tx } from "../db";
import { AppError, isUniqueViolation } from "../errors";
import { getSettings } from "../settings";
import { siteOrigin } from "../site-origin";
import { guestEventOn, prettyPhone, shortName, validPhone } from "@/lib/guest-messages";
import { ORDER_EVENT_TYPE, orderEventFor, orderMessageText, type OrderEvent } from "@/lib/order-messages";
import { normalizePhone, resolveGuest } from "./guests";
import { createRestaurantOrderTx, publicMenu } from "./restaurant";
import { mediaUrl } from "./media";
import { guestNotifyConnected, sendGuestText } from "./guest-notify";


/**
 * Online ordering — the public menu (website and the public menu QR) for anyone, and
 * the room experience (room QR / the guest's stay link, see room-qr.ts and guest-comms.ts)
 * for guests staying now. All of them place orders through the one restaurant order engine.
 * Only a confirmed stay can charge a room; the public menu never can.
 */

const ORDER_LIMIT = 5; // online orders per phone / room per 30 minutes

// ───────────────────────── Who is ordering ─────────────────────────

/** The saved name of the customer with this phone (they ordered or stayed before), or null. */
export async function knownCustomerName(phone: string): Promise<string | null> {
  const p = normalizePhone(phone);
  if (!p) return null;
  const g = await db.guest.findFirst({ where: { phone: p }, orderBy: { updatedAt: "desc" }, select: { fullName: true } });
  return g?.fullName.trim() || null;
}

/**
 * Before the first item goes in the order: the customer gives their phone. Someone we know is
 * greeted by name — first name and initials only ("Asha M."), never their full details.
 */
export async function identifyCustomer(phone: string) {
  if (!validPhone(phone)) throw new AppError("Please enter a phone number we can reach you on (e.g. 0712 345 678).", "VALIDATION", { phone: "Invalid" });
  const name = await knownCustomerName(phone);
  return { name: name ? shortName(name) : null };
}

/** The name on the order: what the customer typed, or — for a returning customer who did not — the name we have for their phone. */
export async function orderCustomerName(typed: string | null | undefined, phone: string) {
  const name = typed?.trim() || (await knownCustomerName(phone)) || "";
  if (name.length < 2) throw new AppError("Please enter your name.", "VALIDATION", { name: "Required" });
  return name.slice(0, 80);
}

// ───────────────────────── Take out: paid first ─────────────────────────

const PROOF_MAX_BYTES = 6 * 1024 * 1024;
const PROOF_TYPES = ["image/jpeg", "image/png", "image/webp", "image/heic", "image/heif"];

/** The customer's screenshot of their payment (take out is paid first) — kept in the database, shown to staff only. */
export async function storePaymentProof(file: File) {
  if (!file || file.size === 0) throw new AppError("Add a screenshot of your payment.", "VALIDATION", { proof: "Required" });
  if (file.size > PROOF_MAX_BYTES) throw new AppError("That picture is too big — please add a screenshot instead.", "VALIDATION", { proof: "Too large" });
  if (!PROOF_TYPES.includes(file.type)) throw new AppError("Please add a photo or screenshot (JPG or PNG).", "VALIDATION", { proof: "Wrong type" });
  const f = await db.storedFile.create({
    data: { purpose: "PAYMENT_PROOF", fileName: file.name.slice(0, 120) || "payment", contentType: file.type, size: file.size, data: new Uint8Array(await file.arrayBuffer()) },
    select: { id: true },
  });
  return { id: f.id };
}

/** `expectedTotal`: what the customer was shown and sent (checked against the order's total as it is placed). */
export type PaidFirst = { proofId: string; accountId: string; reference?: string | null; expectedTotal?: number | null };

/**
 * Take out is paid first: the screenshot must be a fresh upload not used on another order, and the
 * account one customers pay into (never cash). What the order keeps — staff check it and record the payment.
 */
export async function paidFirstTx(tx: Tx, p: PaidFirst | null | undefined, now: Date) {
  if (!p?.proofId) throw new AppError("Take out is paid first — please add a screenshot of your payment.", "VALIDATION", { proof: "Required" });
  const [file, account] = await Promise.all([
    tx.storedFile.findUnique({ where: { id: p.proofId }, select: { purpose: true, createdAt: true, restaurantOrder: { select: { id: true } } } }),
    tx.moneyAccount.findUnique({ where: { id: p.accountId }, select: { isActive: true, acceptsPayments: true, kind: true, accountNumber: true } }),
  ]);
  if (!file || file.purpose !== "PAYMENT_PROOF" || file.restaurantOrder || now.getTime() - file.createdAt.getTime() > 6 * 3600_000) {
    throw new AppError("Please add the screenshot of your payment again.", "VALIDATION", { proof: "Invalid" });
  }
  if (!account || !account.isActive || !account.acceptsPayments || account.kind === "CASH" || !account.accountNumber) {
    throw new AppError("Choose the account you paid to.", "VALIDATION", { accountId: "Invalid" });
  }
  return { paymentProofFileId: p.proofId, customerPaidToId: p.accountId, customerPayRef: p.reference?.trim().slice(0, 60) || null, customerPaidAt: now, expectedTotal: p.expectedTotal ?? null };
}

// ───────────────────────── Placing an order ─────────────────────────

export interface OnlineOrderInput {
  clientKey: string;
  items: { menuItemId: string; quantity: number }[];
  notes?: string | null;
  /** Blank for a returning customer: the name we have for their phone is used. */
  name?: string | null;
  phone: string;
  email?: string | null;
  /** The public menu: never a room — room orders come from the room QR / the guest's own link. */
  kind: "DINE_IN" | "TAKEAWAY" | "PICKUP";
  /** Take out: where to deliver it. */
  deliveryAddress?: string | null;
  /** Take out is paid first: the customer's payment screenshot and the account they paid. */
  paidFirst?: PaidFirst | null;
  tableLabel?: string | null;
  /** Scanned from a printed public menu QR (restaurant tables, reception) rather than the website. */
  fromQr?: boolean;
}

/**
 * A public customer orders from the menu (public QR or website): dine in, takeaway or pickup,
 * paid at the counter. The public menu cannot charge a room — it is not connected to a stay.
 */
export async function placeOnlineOrder(input: OnlineOrderInput, now = new Date()) {
  const settings = await getSettings();
  if (!settings.publicOrderingEnabled) throw new AppError(`Online ordering is closed right now — please call us${settings.phone ? ` on ${prettyPhone(settings.phone)}` : ""}.`);
  if (!input.name?.trim() && !validPhone(input.phone)) throw new AppError("Please enter your name.", "VALIDATION", { name: "Required" });
  if (!validPhone(input.phone)) throw new AppError("Please enter a phone number we can reach you on (e.g. 0712 345 678).", "VALIDATION", { phone: "Invalid" });
  const name = await orderCustomerName(input.name, input.phone);
  if (!["DINE_IN", "TAKEAWAY", "PICKUP"].includes(input.kind)) throw new AppError("Choose to eat here or take out.", "VALIDATION");
  const address = input.kind === "TAKEAWAY" ? input.deliveryAddress?.trim().slice(0, 200) ?? "" : "";
  if (input.kind === "TAKEAWAY" && address.length < 5) throw new AppError("Please add the delivery address — street, house or building, and a landmark.", "VALIDATION", { deliveryAddress: "Required" });
  if (!input.items.length || input.items.length > 30) throw new AppError("Add something from the menu.", "VALIDATION");
  const same = await db.restaurantOrder.findUnique({ where: { clientKey: input.clientKey } });
  if (same) return same; // the same tap sent twice
  const phone = normalizePhone(input.phone)!;

  try {
    return await db.$transaction(async (tx) => {
      const recent = await tx.restaurantOrder.count({ where: { customerPhone: phone, source: { in: ["PUBLIC_QR", "WEBSITE"] }, createdAt: { gte: new Date(now.getTime() - 30 * 60_000) } } });
      if (recent >= ORDER_LIMIT) throw new AppError("You have sent several orders just now — please call us for more.", "VALIDATION");
      // Take out is always paid first; eating here may be paid now too.
      const paidFirst = input.kind === "TAKEAWAY" || input.paidFirst ? await paidFirstTx(tx, input.paidFirst, now) : null;
      // One customer, saved once: the phone finds them (or they are saved now).
      const guestId = await resolveGuest(tx, { fullName: name, phone, email: input.email?.trim() || null });
      return createRestaurantOrderTx(tx, {
        type: input.kind, settlement: "UNPAID", items: input.items, notes: input.notes?.trim().slice(0, 300) || null, customerName: name,
        tableLabel: input.kind === "DINE_IN" ? input.tableLabel?.trim().slice(0, 40) || null : null, deliveryAddress: address || null,
      }, { userId: null, label: `${name} (online)` }, now, {
        byCustomer: true, source: input.fromQr ? "PUBLIC_QR" : "WEBSITE", guestId, customerPhone: phone, customerEmail: input.email?.trim() || null, clientKey: input.clientKey, paidFirst,
      });
    });
  } catch (e) {
    if (isUniqueViolation(e)) {
      const again = await db.restaurantOrder.findUnique({ where: { clientKey: input.clientKey } });
      if (again) return again;
    }
    throw e;
  }
}

// ───────────────────────── Tracking ─────────────────────────

/** What the customer sees on their tracking link — their order only. */
export async function orderByTrackToken(token: string) {
  if (!/^[A-Za-z0-9_-]{12,40}$/.test(token)) return null;
  const o = await db.restaurantOrder.findUnique({
    where: { trackToken: token },
    select: {
      number: true, type: true, status: true, settlement: true, paymentStatus: true, paidAmount: true, round: true, roomNumber: true, customerName: true, tableLabel: true, deliveryAddress: true, customerPaidAt: true, notes: true,
      total: true, serviceFee: true, createdAt: true, acceptedAt: true, readyAt: true, takenAt: true, deliveredAt: true, completedAt: true, cancelledAt: true, statusChangedAt: true,
      items: { select: { name: true, quantity: true, lineTotal: true, round: true }, orderBy: { id: "asc" } },
      session: { select: { openAtId: true, location: { select: { qrToken: true, qrActive: true } } } },
    },
  });
  if (!o) return null;
  const { session, ...rest } = o;
  return {
    ...rest, firstName: (o.customerName ?? "").trim().split(/\s+/)[0] || null, customerName: undefined,
    /** Still at their table: its menu (their session) — "Order more" goes back there. */
    tableQr: session?.openAtId && session.location.qrActive ? session.location.qrToken : null,
  };
}
export type TrackedOrder = NonNullable<Awaited<ReturnType<typeof orderByTrackToken>>>;

// ───────────────────────── Updates to the customer ─────────────────────────

/** The ready-to-send update for an order (its current status, or a given step) — reception sends it in one tap when no provider is connected. */
export async function orderUpdate(orderId: string, origin?: string | null, forEvent?: OrderEvent) {
  const [o, s] = await Promise.all([
    db.restaurantOrder.findUnique({ where: { id: orderId }, select: { number: true, type: true, status: true, roomNumber: true, customerName: true, customerPhone: true, trackToken: true, guestId: true, deliveryAddress: true } }),
    getSettings(),
  ]);
  if (!o) return null;
  const event = forEvent ?? orderEventFor(o.status, o.type, !!o.deliveryAddress);
  if (!event) return null;
  const base = origin ?? null;
  return {
    event, to: o.customerPhone, guestId: o.guestId,
    text: orderMessageText(event, {
      name: o.customerName, hotel: s.hotelName, number: o.number, type: o.type, room: o.roomNumber, delivery: !!o.deliveryAddress,
      track: base && o.trackToken ? `${base}/order/${o.trackToken}` : null, menu: base ? `${base}/order` : null,
      prepMinutes: s.orderPrepMinutes, phone: prettyPhone(s.whatsapp || s.phone),
    }),
  };
}

/**
 * Tell the customer about a real step (accepted, ready, delivered, cancelled) — only when a
 * messaging provider is connected and the hotel has order updates switched on. Never blocks
 * the kitchen: failures are logged, not thrown.
 */
export async function notifyOrderCustomer(orderId: string, event: OrderEvent) {
  try {
    if (!guestNotifyConnected()) return;
    const s = await getSettings();
    if (!guestEventOn(s.guestNotifications, "orders")) return;
    let origin: string | null = null;
    try { origin = await siteOrigin(); } catch { origin = process.env.NEXT_PUBLIC_SITE_URL ?? null; }
    const u = await orderUpdate(orderId, origin, event);
    if (!u || !u.to) return;
    const sent = await sendGuestText({ to: u.to, text: u.text, event: ORDER_EVENT_TYPE[event] });
    if (u.guestId) {
      await db.guestMessage.create({
        data: { guestId: u.guestId, restaurantOrderId: orderId, type: ORDER_EVENT_TYPE[event], channel: sent.channel, to: u.to, body: u.text, status: sent.ok ? "SENT" : "FAILED", error: sent.error ?? null },
      });
    }
  } catch (e) {
    console.error("order notification", orderId, e);
  }
}

// ───────────────────────── The live menu ─────────────────────────

/** The live menu for ordering: food first, then drinks; availability and prices as they are now. */
export async function orderMenuSections() {
  const cats = await publicMenu();
  return [...cats.filter((c) => c.type === "FOOD"), ...cats.filter((c) => c.type === "DRINK")].map((c) => ({
    id: c.id, name: c.name, drink: c.type === "DRINK",
    items: c.items.map((i) => ({
      id: i.id, name: i.name, description: i.description, price: i.price, available: i.isAvailable,
      image: i.image?.isActive ? mediaUrl(i.image) : null,
    })),
  }));
}

// ───────────────────────── The restaurant app's menu ─────────────────────────

/** One way to order a dish or drink (a drink's size); `id` is the menu item the kitchen receives. */
export type RestaurantOption = { id: string; label: string | null; price: number; available: boolean };
/** A dish or drink as the customer sees it — the sizes of one drink are one card. */
export type RestaurantEntry = {
  key: string; name: string; description: string | null; image: string | null;
  /** "featured": chosen by a manager · "popular": among the most ordered in the last 30 days. */
  badge: "featured" | "popular" | null;
  options: RestaurantOption[];
};
export type RestaurantSection = { id: string; slug: string; name: string; description: string | null; drink: boolean; entries: RestaurantEntry[] };
export type RestaurantMenu = { sections: RestaurantSection[]; recommended: string[]; recommendedBy: "featured" | "popular" | "photos" };

const SIZE = /^(.*?)\s+(\d+(?:\.\d+)?\s*(?:ML|CL|L))$/i;
const slugOf = (v: string) => v.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * The menu for the restaurant app (every QR, the public menu): live from the database —
 * prices, photos, availability — food first, then drinks, with a drink's sizes together.
 * "Recommended" is what a manager marked Featured; if nothing is, the most ordered of the
 * last 30 days (real orders only), then dishes with photos.
 */
export async function restaurantMenu(now = new Date()): Promise<RestaurantMenu> {
  const [cats, sold] = await Promise.all([
    publicMenu(),
    db.restaurantOrderItem.groupBy({
      by: ["menuItemId"],
      where: { menuItemId: { not: null }, order: { status: { not: "CANCELLED" }, createdAt: { gte: new Date(now.getTime() - 30 * 86_400_000) } } },
      _sum: { quantity: true }, orderBy: { _sum: { quantity: "desc" } }, take: 8,
    }),
  ]);
  const popular = new Set(sold.map((s) => s.menuItemId!));
  const ordered = [...cats.filter((c) => c.type === "FOOD"), ...cats.filter((c) => c.type === "DRINK")];
  const sections: RestaurantSection[] = ordered.map((c) => {
    const entries: (RestaurantEntry & { featured: boolean })[] = [];
    for (const i of c.items) {
      const m = c.type === "DRINK" ? SIZE.exec(i.name) : null;
      const base = m ? m[1].trim() : i.name;
      const option: RestaurantOption = { id: i.id, label: m ? m[2].replace(/\s+/g, "").toUpperCase() : null, price: i.price, available: i.isAvailable };
      const same = m ? entries.find((e) => e.name === base && e.options[0].label) : undefined;
      if (same) {
        same.options.push(option);
        same.featured ||= i.isFeatured;
        if (!same.image && i.image?.isActive) same.image = mediaUrl(i.image);
        continue;
      }
      entries.push({
        key: `${c.slug}-${slugOf(base)}`, name: base, description: i.description, image: i.image?.isActive ? mediaUrl(i.image) : null,
        badge: null, options: [option], featured: i.isFeatured,
      });
    }
    for (const e of entries) {
      e.options.sort((a, b) => a.price - b.price);
      e.badge = e.featured ? "featured" : e.options.some((o) => popular.has(o.id)) ? "popular" : null;
    }
    return { id: c.id, slug: c.slug, name: c.name, description: c.description, drink: c.type === "DRINK", entries: entries.map((e) => ({ key: e.key, name: e.name, description: e.description, image: e.image, badge: e.badge, options: e.options })) };
  });
  const all = sections.flatMap((s) => s.entries).filter((e) => e.options.some((o) => o.available));
  const featured = all.filter((e) => e.badge === "featured");
  const hot = all.filter((e) => e.badge === "popular");
  const recommended = (featured.length ? featured : hot.length ? hot : all.filter((e) => e.image)).slice(0, 6).map((e) => e.key);
  return { sections, recommended, recommendedBy: featured.length ? "featured" : hot.length ? "popular" : "photos" };
}
