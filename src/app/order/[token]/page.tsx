import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Bike, Check, ChefHat, Clock, MessageCircle, PartyPopper, Phone, Plus, Receipt, ReceiptText, UtensilsCrossed, XCircle, MapPin } from "lucide-react";
import { getSettings } from "@/server/settings";
import { orderByTrackToken } from "@/server/services/online-orders";
import { prettyPhone } from "@/lib/guest-messages";
import { telHref, whatsappHref } from "@/components/public/contact";
import { cn } from "@/lib/utils";
import { LiveRefresh } from "@/components/live-refresh";
import { livePaymentForOrder, onlinePayAvailable } from "@/server/services/online-pay";
import { PayOrderOnline } from "@/components/restaurant/pay-order-online";
import { getT, guestLocale } from "@/i18n/server";
import { orderItemName } from "@/i18n/content";
import { msg } from "@/i18n/msg";
import { RequestList } from "@/components/ordering/order-note";

export async function generateMetadata(): Promise<Metadata> {
  await guestLocale();
  const t = await getT();
  return { title: t("Your order"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}
export const dynamic = "force-dynamic";

const tzs = (v: number) => `TZS ${v.toLocaleString("en-US")}`;
const TYPE: Record<string, string> = { ROOM_SERVICE: msg("Room service"), DINE_IN: msg("Dine in"), TAKEAWAY: msg("Takeaway"), PICKUP: msg("Pickup") };
const CLOSED = ["DELIVERED", "COMPLETED", "COLLECTED", "CANCELLED"];

/**
 * The customer's order tracking page (the link after ordering and in updates):
 * received → preparing → ready → taken by the waiter → delivered / served / collected, live.
 */
export default async function TrackOrderPage({ params, searchParams }: PageProps<"/order/[token]">) {
  await guestLocale();
  const t = await getT();
  const { token } = await params;
  const sp = await searchParams;
  const added = sp.added === "1";
  const [o, s] = await Promise.all([orderByTrackToken(token), getSettings()]);
  if (!o) notFound();
  const room = o.type === "ROOM_SERVICE";
  const delivery = o.type === "TAKEAWAY" && !!o.deliveryAddress; // take out, brought to their address
  const pickup = (o.type === "TAKEAWAY" && !delivery) || o.type === "PICKUP";
  const cancelled = o.status === "CANCELLED";
  const steps = [
    { label: t("Order received"), icon: ReceiptText, at: o.createdAt, done: true },
    { label: t("Kitchen preparing"), icon: ChefHat, at: o.acceptedAt, done: ["ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY", ...CLOSED].includes(o.status) },
    { label: pickup ? t("Ready to collect") : t("Ready"), icon: Check, at: o.readyAt, done: ["READY", "OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED", "COLLECTED"].includes(o.status) },
    { label: room ? t("On its way to your room") : delivery ? t("On its way to you") : pickup ? t("Waiting at the counter") : t("On its way to your table"), icon: Bike, at: o.takenAt, done: ["OUT_FOR_DELIVERY", "DELIVERED", "COMPLETED", "COLLECTED"].includes(o.status) },
    { label: room ? t("Delivered to your room") : delivery ? t("Delivered to you") : pickup ? t("Collected") : t("Served"), icon: PartyPopper, at: o.deliveredAt ?? o.completedAt, done: ["DELIVERED", "COMPLETED", "COLLECTED"].includes(o.status) },
  ];
  const current = steps.filter((x) => x.done).length - 1;
  const due = o.settlement === "ROOM" ? 0 : Math.max(0, o.total - o.paidAmount);
  // Pay online (nTZS): offered while something is due; a payment on its way is followed, never asked twice.
  const roomService = o.source === "ROOM_QR" || o.source === "GUEST_LINK";
  const [online, livePay] = !cancelled && due > 0
    ? await Promise.all([onlinePayAvailable(roomService ? "roomService" : "restaurant", s), livePaymentForOrder(token)]) : [false, null];
  // Take out ordered with Pay online starts once it is paid.
  const waitsForPay = !!o.payOnlineAt && o.status === "PENDING" && due > 0 && (o.type === "TAKEAWAY" || o.type === "PICKUP");
  const pay = o.status === "CANCELLED" ? (o.paymentStatus === "REFUNDED" ? t("Cancelled — your payment will be given back") : t("Cancelled — nothing to pay"))
    : o.settlement === "ROOM" ? t("On your Room {room} bill", { room: o.roomNumber })
    : due === 0 && o.paidAmount > 0 ? t("Paid — thank you")
    : o.paidAmount > 0 ? t("{amount} still to pay", { amount: tzs(due) })
    : o.customerPaidAt ? t("Payment sent — we are checking it")
    : livePay ? t("Paying online — approve it on your phone")
    : waitsForPay ? t("Waiting for your online payment")
    : room || delivery ? t("Pay on delivery") : o.type === "DINE_IN" ? t("Pay after your meal") : t("Pay at the counter");
  // Take out never starts unpaid: once the kitchen has it, more is a new order (paid first too).
  const takeOutStarted = (o.type === "TAKEAWAY" || o.type === "PICKUP") && (o.status !== "PENDING" || (!!o.customerPaidAt && !o.payOnlineAt));
  const canAdd = ["PENDING", "ACCEPTED", "PREPARING", "DELIVERED"].includes(o.status) && !takeOutStarted;
  const phone = prettyPhone(s.whatsapp || s.phone);

  // The headline: where the order is now, in plain words.
  const headline = cancelled ? [t("Order cancelled"), t("We are sorry — this order was cancelled. Please contact us if you have questions.")]
    : added ? [t("Added to your order"), t("The new items are on their way to the kitchen — on the same order and bill.")]
    : waitsForPay ? [t("Waiting for payment"), t("We start your order as soon as your online payment is confirmed.")]
    : o.status === "PENDING" ? [t("Order received"), o.firstName ? t("Thank you, {name} — your order has been received.", { name: o.firstName }) : t("Thank you — your order has been received.")]
    : ["ACCEPTED", "PREPARING"].includes(o.status) ? [t("Preparing"), t("Our team is preparing your order.")]
    : o.status === "READY" ? [t("Ready"), pickup ? t("Your order is ready to collect.") : t("Your order is ready — it is coming to you.")]
    : o.status === "OUT_FOR_DELIVERY" ? [t("On its way"), room ? t("Your order is on its way to your room.") : t("Your order is on its way to you.")]
    : [t("Enjoy your meal"), pickup ? t("Collected — enjoy!") : t("Delivered — enjoy your meal.")];
  const place = room && o.roomNumber ? t("Room {room}", { room: o.roomNumber }) : delivery ? t("Take out") : o.tableLabel ?? t(TYPE[o.type] ?? o.type);

  return (
    <main className="vr relative min-h-svh overflow-x-clip bg-(--vr-bg) px-4 pb-16 pt-5 text-(--vr-ink)">
      <LiveRefresh active={!CLOSED.includes(o.status)} />
      <div className="relative mx-auto max-w-lg">
        <Link href="/order" className="flex items-center gap-2.5">
          <span className="grid size-10 shrink-0 place-items-center rounded-full bg-(--vr-dark) ring-2 ring-(--vr-gold)/50">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src="/brand/logo-192.png" alt="" className="size-8 rounded-full" />
          </span>
          <span className="leading-tight">
            <span className="block font-display text-[19px] font-semibold">{t("{hotel} Restaurant", { hotel: s.hotelName.split(/\s+/)[0] })}</span>
            <span className="block text-[11px] uppercase tracking-[0.18em] text-(--vr-muted)">{t("Restaurant & bar")}</span>
          </span>
        </Link>

        {/* Where it is */}
        <section className="mt-6 overflow-hidden rounded-[28px] bg-(--vr-card) shadow-[0_24px_50px_-34px_rgba(29,23,18,0.7)] ring-1 ring-(--vr-line)">
          <div className={cn("px-5 pb-5 pt-6 text-center", cancelled ? "bg-rose-50" : "bg-(--vr-dark) text-white")}>
            <span className={cn("mx-auto grid size-14 place-items-center rounded-full", cancelled ? "bg-rose-100 text-rose-700" : "bg-(--vr-gold) text-(--vr-ink)")}>
              {cancelled ? <XCircle className="size-7" /> : current >= 4 ? <PartyPopper className="size-7" /> : current >= 2 ? <Check className="size-7" /> : current >= 1 ? <ChefHat className="size-7" /> : <ReceiptText className="size-7" />}
            </span>
            <h1 className="mt-3 font-display text-[34px] font-semibold leading-none">{headline[0]}</h1>
            <p className={cn("mt-2 text-sm", cancelled ? "text-rose-800" : "text-white/75")}>{headline[1]}</p>
            <p className={cn("mt-3 inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-semibold", cancelled ? "bg-white text-rose-800" : "bg-white/10 text-white/85")}>
              {t("Order #{number} · {place}", { number: o.number.replace(/^ORD-\d{4}-0*/, ""), place })}
            </p>
            {delivery && !cancelled && (
              <p className="mx-auto mt-2 flex max-w-sm items-start justify-center gap-1.5 text-xs text-white/70"><MapPin className="mt-px size-3.5 shrink-0 text-(--vr-gold)" /><span>{t("Delivering to {address}", { address: o.deliveryAddress })}</span></p>
            )}
            {!cancelled && s.orderPrepMinutes && !steps[2].done && (
              <p className="mt-2 flex items-center justify-center gap-1.5 text-xs text-white/65"><Clock className="size-3.5" />{t("Usually ready in about {n} minutes", { n: s.orderPrepMinutes })}</p>
            )}
          </div>

          {!cancelled && (
            <ol className="relative space-y-4 px-5 py-5">
              {steps.map((step, i) => (
                <li key={step.label} className="relative flex items-center gap-3.5">
                  {i < steps.length - 1 && <span aria-hidden className={cn("absolute left-[19px] top-10 h-4 w-0.5", step.done && steps[i + 1].done ? "bg-(--vr-gold)" : "bg-(--vr-line)")} />}
                  <span className={cn("grid size-10 shrink-0 place-items-center rounded-full transition", step.done ? "bg-(--vr-gold) text-(--vr-ink)" : "bg-(--vr-bg) text-(--vr-muted)/60 ring-1 ring-(--vr-line)", i === current && i < steps.length - 1 && "motion-safe:animate-pulse [animation-duration:2.5s]")}>
                    {step.done ? <Check className="size-5" /> : <step.icon className="size-4" />}
                  </span>
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className={cn("block text-[15px] font-semibold", !step.done && "text-(--vr-muted)")}>{step.label}</span>
                    {step.done && step.at && <span className="text-xs text-(--vr-muted)">{t.time(step.at, s.timezone)}</span>}
                    {i === current && i < steps.length - 1 && <span className="text-xs font-semibold text-(--vr-gold-ink)"> · {t("now")}</span>}
                  </span>
                </li>
              ))}
            </ol>
          )}
        </section>

        {(online || livePay) && <PayOrderOnline token={token} due={due} live={livePay} failed={sp.pay === "0"} waits={waitsForPay} />}

        {/* What they ordered */}
        <section className="mt-4 rounded-[28px] bg-(--vr-card) p-5 ring-1 ring-(--vr-line)">
          <h2 className="font-display text-2xl font-semibold">{t("Your order")}</h2>
          <ul className="mt-3 divide-y divide-(--vr-line) text-sm">
            {o.items.map((i, n) => (
              <li key={`${n}-${i.name}`} className="flex justify-between gap-3 py-2.5">
                <span><span className="font-semibold tabular-nums">{i.quantity} ×</span> {orderItemName(i, t)}{o.round > 1 && i.round === o.round && <span className="ml-1.5 rounded-full bg-(--vr-gold-soft) px-1.5 py-px text-[10px] font-semibold text-(--vr-gold-ink)">{t("new")}</span>}</span>
                <span className="tabular-nums text-(--vr-muted)">{i.lineTotal.toLocaleString("en-US")}</span>
              </li>
            ))}
            {o.serviceFee > 0 && <li className="flex justify-between gap-3 py-2.5 text-(--vr-muted)"><span>{t("Room service delivery")}</span><span className="tabular-nums">{o.serviceFee.toLocaleString("en-US")}</span></li>}
          </ul>
          <div className="mt-2 flex items-center justify-between rounded-2xl bg-(--vr-bg) px-4 py-3">
            <span className="text-sm text-(--vr-muted)">{pay}</span>
            <span className="text-lg font-semibold tabular-nums">{tzs(o.total)}</span>
          </div>
          {/* What they asked for: the requests they ticked (in their language), then their own words as typed. */}
          <RequestList codes={o.noteCodes} t={t} className="mt-3" chipClass="rounded-full bg-(--vr-gold-soft) px-2.5 py-1 text-xs font-medium text-(--vr-gold-ink)" />
          {o.notes && <p className="mt-2 rounded-xl bg-(--vr-gold-soft) px-3 py-2 text-xs text-(--vr-gold-ink)">“{o.notes}”</p>}
          {!cancelled && (
            <Link href={`/order/${token}/receipt`} className="mt-3 flex h-12 items-center justify-center gap-2 rounded-full ring-1 ring-(--vr-line) text-sm font-semibold transition hover:ring-(--vr-gold)">
              <Receipt className="size-4 text-(--vr-gold-ink)" />{due > 0 ? t("Your bill — print or download") : t("Your receipt — print or download")}
            </Link>
          )}
        </section>

        <div className="mt-5 grid grid-cols-2 gap-2">
          {o.tableQr
            ? <Link href={`/t/${o.tableQr}`} className="flex h-13 items-center justify-center gap-1.5 rounded-full bg-(--vr-dark) text-sm font-semibold text-white"><Plus className="size-4" />{t("Order more")}</Link>
            : canAdd
            ? <Link href={`/order/${token}/more`} className="flex h-13 items-center justify-center gap-1.5 rounded-full bg-(--vr-dark) text-sm font-semibold text-white"><Plus className="size-4" />{t("Order more")}</Link>
            : <Link href="/order" className="flex h-13 items-center justify-center gap-1.5 rounded-full bg-(--vr-dark) text-sm font-semibold text-white"><UtensilsCrossed className="size-4" />{takeOutStarted && !cancelled ? t("New order") : t("See the menu")}</Link>}
          {s.whatsapp ? (
            <a href={whatsappHref(s.whatsapp, t("Hello, about my order #{number}", { number: o.number }))} target="_blank" rel="noopener" className="flex h-13 items-center justify-center gap-2 rounded-full bg-[#25D366] text-sm font-semibold text-[#073b1f]"><MessageCircle className="size-4" />{t("WhatsApp us")}</a>
          ) : s.phone ? (
            <a href={telHref(s.phone)} className="flex h-13 items-center justify-center gap-2 rounded-full bg-(--vr-card) text-sm font-semibold ring-1 ring-(--vr-line)"><Phone className="size-4" />{t("Call us")}</a>
          ) : null}
        </div>
        {phone && <p className="mt-3 text-center text-xs text-(--vr-muted)">{t("Questions about your order? {phone}", { phone })}</p>}
        {!CLOSED.includes(o.status) && <p className="mt-1 flex items-center justify-center gap-1.5 text-center text-[11px] text-(--vr-muted)/80"><Bike className="size-3" />{t("This page updates by itself.")}</p>}
      </div>
    </main>
  );
}
