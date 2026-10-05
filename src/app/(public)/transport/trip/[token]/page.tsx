import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { getSettings } from "@/server/settings";
import { tripForCustomer } from "@/server/services/online-pay";
import { formatDateTime } from "@/lib/format";
import { TRIP_TYPE_LABEL } from "@/lib/transport-meta";
import { cn } from "@/lib/utils";
import { telHref, whatsappHref } from "@/components/public/contact";
import { StatusPill } from "@/components/public/booking/confirmation";
import { Actions, Eyebrow, Heading, InfoList, PriceTag, Section, TextLink, typeScale } from "@/components/public/kit";
import { PayOnlineCard } from "@/components/public/pay-online-card";
import { payTripOnlineAction } from "../../actions";

export const metadata: Metadata = { title: "Your trip", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  REQUESTED: "Requested — we confirm by phone or WhatsApp", CONFIRMED: "Confirmed", ASSIGNED: "Driver assigned", IN_PROGRESS: "On the way",
  EN_ROUTE: "On the way", PICKED_UP: "On the way", COMPLETED: "Completed — thank you", CANCELLED: "Cancelled", NO_SHOW: "Missed",
};

/**
 * A website trip's private page: where it stands (the reference and the status first), Pay now for its price —
 * first on phones, beside the details on desktop — then what was asked for and who to call.
 */
export default async function TripPage({ params }: PageProps<"/transport/trip/[token]">) {
  const { token } = await params;
  const [t, s] = await Promise.all([tripForCustomer(token), getSettings()]);
  if (!t) notFound();
  const tz = s.timezone;
  const stopped = t.status === "CANCELLED" || t.status === "NO_SHOW";
  const status = t.paid && t.status !== "CANCELLED" ? `${STATUS[t.status] ?? t.status} · paid` : STATUS[t.status] ?? t.status;
  const note = t.paid ? "Paid — thank you." : t.onBill ? "On your room bill."
    : t.online ? "Pay now, after the trip, or add it to your room bill if you are staying with us."
      : "Pay after the trip, or add it to your room bill if you are staying with us.";

  return (
    <>
      <Section tone="night" first space="sm" glow="top" width="wide" labelledBy="trip-title" className="pb-10 sm:pb-14 lg:pb-14">
        <Eyebrow className="flex items-center gap-2">
          <CircleCheck className="size-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
          {TRIP_TYPE_LABEL[t.type]}
        </Eyebrow>
        <Heading as="h1" size="title" id="trip-title" className="mt-4">
          Thank you, {t.name.split(/\s+/)[0]}
        </Heading>
        <div className="mt-7 flex flex-wrap items-end gap-x-10 gap-y-5">
          <div className="min-w-0">
            <p className={cn(typeScale.meta, "text-pub-muted")}>Your trip reference</p>
            <p className="mt-2 font-display text-[clamp(1.875rem,1.4rem+2vw,2.75rem)] leading-none tracking-[0.02em] text-gold lining-nums [overflow-wrap:anywhere]">
              {t.reference}
            </p>
          </div>
          <StatusPill label={status} tone={stopped ? "warn" : "ok"} />
        </div>
      </Section>

      <Section space="md" width="wide">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-x-10">
          {/* What is owed and Pay now: first on phones, the right-hand column on desktop. */}
          <section aria-labelledby="price-title" className="min-w-0 lg:col-span-5 lg:col-start-8 lg:row-start-1">
            <Eyebrow as="h2">
              <span id="price-title">Price</span>
            </Eyebrow>
            <div className="mt-4 flex items-baseline justify-between gap-4 border-y border-pub-line py-4">
              <span className="min-w-0 text-[15px] text-pub-muted">{t.option ?? "Transport"}</span>
              <PriceTag amount={t.price} unit={null} className="shrink-0" />
            </div>
            {(t.online || t.live) && t.due > 0 && (
              <PayOnlineCard className="mt-6" tone="inherit" due={t.due} phone={t.phone ?? ""} live={t.live} action={payTripOnlineAction.bind(null, token)} />
            )}
            <p className="mt-4 text-[13px] leading-relaxed text-pub-muted">{note}</p>
          </section>

          <section aria-labelledby="details-title" className="min-w-0 lg:col-span-6 lg:col-start-1 lg:row-start-1">
            <Heading size="subheading" id="details-title">Your trip</Heading>
            <InfoList
              variant="rows"
              className="mt-5"
              items={[
                { label: "When", value: formatDateTime(t.pickupAt, tz) },
                { label: "Guests", value: t.passengers },
                { label: "Route", value: <span className="[overflow-wrap:anywhere]">{t.pickupLocation} → {t.destination}</span> },
                ...(t.flightNumber ? [{ label: "Flight", value: t.flightNumber }] : []),
              ]}
            />
            <p className="mt-10 text-[15px] leading-relaxed text-pub-muted">
              Questions about your trip? Quote <strong className="font-semibold text-pub-fg">{t.reference}</strong>.
            </p>
            {(s.phone || s.whatsapp) && (
              <Actions className="mt-4">
                {s.phone && <TextLink href={telHref(s.phone)} icon="none">Call {s.phone}</TextLink>}
                {s.whatsapp && (
                  <TextLink href={whatsappHref(s.whatsapp, `Hello, about my trip ${t.reference}`)} target="_blank" rel="noopener noreferrer">
                    WhatsApp<span className="sr-only"> (opens in a new tab)</span>
                  </TextLink>
                )}
              </Actions>
            )}
          </section>
        </div>
      </Section>
    </>
  );
}
