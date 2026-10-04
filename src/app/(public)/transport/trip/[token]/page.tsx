import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarClock, CheckCircle2, MapPin, MessageCircle, Phone, Plane, Users } from "lucide-react";
import { getSettings } from "@/server/settings";
import { tripForCustomer } from "@/server/services/online-pay";
import { formatDateTime, formatTZS } from "@/lib/format";
import { TRIP_TYPE_LABEL } from "@/lib/transport-meta";
import { cn } from "@/lib/utils";
import { telHref, whatsappHref } from "@/components/public/contact";
import { PayOnlineCard } from "@/components/public/pay-online-card";
import { container, cream, eyebrow, type } from "@/components/public/ui";
import { payTripOnlineAction } from "../../actions";

export const metadata: Metadata = { title: "Your trip", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  REQUESTED: "Requested — we confirm by phone or WhatsApp", CONFIRMED: "Confirmed", ASSIGNED: "Driver assigned", IN_PROGRESS: "On the way",
  COMPLETED: "Completed — thank you", CANCELLED: "Cancelled", NO_SHOW: "Missed",
};

/** A website trip's private page: what was asked for, where it stands, and Pay online for its price. */
export default async function TripPage({ params }: PageProps<"/transport/trip/[token]">) {
  const { token } = await params;
  const [t, s] = await Promise.all([tripForCustomer(token), getSettings()]);
  if (!t) notFound();
  const tz = s.timezone;
  return (
    <div className={cn(cream, "flex-1 pb-20")}>
      <section className="bg-[#15120e] text-white">
        <div className={cn(container, "pb-24 pt-28 sm:pt-32")}>
          <p className={cn(eyebrow, "flex items-center gap-2 text-gold")}><CheckCircle2 className="size-4" aria-hidden="true" />{TRIP_TYPE_LABEL[t.type]}</p>
          <h1 className={cn("mt-3", type.h1)}>Thank you, {t.name.split(/\s+/)[0]}</h1>
          <p className="mt-3 text-white/70">Your trip reference is</p>
          <p className="mt-1 font-display text-5xl tracking-wide text-gold sm:text-6xl">{t.reference}</p>
          <p className={cn("mt-6 inline-flex w-fit rounded-full px-5 py-2.5 text-sm font-medium", t.status === "CANCELLED" || t.status === "NO_SHOW" ? "bg-red-100 text-red-900" : "bg-gold text-[#15120e]")}>
            {t.paid && t.status !== "CANCELLED" ? `${STATUS[t.status] ?? t.status} · paid` : STATUS[t.status] ?? t.status}
          </p>
        </div>
      </section>

      <div className={cn(container, "-mt-12 grid gap-6 lg:grid-cols-[1.4fr_1fr]")}>
        <section className="rounded-[2rem] bg-panel p-6 ring-1 ring-tone/[0.07] sm:p-8">
          <h2 className={type.h3}>Your trip</h2>
          <dl className="mt-6 grid gap-4 text-sm sm:grid-cols-2">
            <div className="rounded-2xl bg-paper p-5"><dt className="flex items-center gap-2 text-tone/55"><CalendarClock className="size-4" aria-hidden="true" />When</dt><dd className="mt-2 font-medium">{formatDateTime(t.pickupAt, tz)}</dd></div>
            <div className="rounded-2xl bg-paper p-5"><dt className="flex items-center gap-2 text-tone/55"><Users className="size-4" aria-hidden="true" />Guests</dt><dd className="mt-2 font-medium">{t.passengers}</dd></div>
            <div className="rounded-2xl bg-paper p-5 sm:col-span-2"><dt className="flex items-center gap-2 text-tone/55"><MapPin className="size-4" aria-hidden="true" />Route</dt><dd className="mt-2 font-medium">{t.pickupLocation} → {t.destination}</dd></div>
            {t.flightNumber && <div className="rounded-2xl bg-paper p-5"><dt className="flex items-center gap-2 text-tone/55"><Plane className="size-4" aria-hidden="true" />Flight</dt><dd className="mt-2 font-medium">{t.flightNumber}</dd></div>}
          </dl>
        </section>

        <aside className="space-y-6">
          <section className="rounded-[2rem] bg-[#15120e] p-6 text-white sm:p-8">
            <h2 className={type.h3}>Price</h2>
            <div className="mt-5 flex items-baseline justify-between gap-4">
              <span className="text-white/65">{t.option ?? "Transport"}</span>
              <span className="font-display text-3xl font-semibold text-gold">{formatTZS(t.price)}</span>
            </div>
            {(t.online || t.live) && t.due > 0 && (
              <div className="mt-5"><PayOnlineCard due={t.due} phone={t.phone ?? ""} live={t.live} action={payTripOnlineAction.bind(null, token)} /></div>
            )}
            <p className="mt-4 text-xs text-white/55">{t.paid ? "Paid — thank you." : t.onBill ? "On your room bill." : t.online ? "Pay online now, after the trip, or add it to your room bill if you are staying with us." : "Pay after the trip, or add it to your room bill if you are staying with us."}</p>
          </section>
          <section className="rounded-[2rem] bg-panel p-6 text-sm ring-1 ring-tone/[0.07] sm:p-8">
            <p className="text-tone/70">Questions about your trip? Quote <strong>{t.reference}</strong>.</p>
            <ul className="mt-4 space-y-3">
              {s.phone && <li><a href={telHref(s.phone)} className="inline-flex items-center gap-2 hover:underline"><Phone className="size-4 text-accent-ink" aria-hidden="true" />{s.phone}</a></li>}
              {s.whatsapp && <li><a href={whatsappHref(s.whatsapp, `Hello, about my trip ${t.reference}`)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:underline"><MessageCircle className="size-4 text-accent-ink" aria-hidden="true" />WhatsApp</a></li>}
            </ul>
          </section>
        </aside>
      </div>
    </div>
  );
}
