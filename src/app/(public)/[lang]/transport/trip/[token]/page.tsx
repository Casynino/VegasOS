import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CircleCheck } from "lucide-react";
import { getSettings } from "@/server/settings";
import { tripForCustomer } from "@/server/services/online-pay";
import { TRIP_TYPE_LABEL } from "@/lib/transport-meta";
import { cn } from "@/lib/utils";
import { telHref, whatsappHref } from "@/components/public/contact";
import { StatusPill } from "@/components/public/booking/confirmation";
import { Actions, Eyebrow, GlassPanel, HOTEL_COORDS, Heading, HudLabel, InfoList, PriceTag, Section, TextLink, typeScale } from "@/components/public/kit";
import { PayOnlineCard } from "@/components/public/pay-online-card";
import { MiniRoute } from "@/components/public/services/route-line";
import { payTripOnlineAction } from "../../actions";
import { getT, pageLocale } from "@/i18n/server";
import { msg } from "@/i18n/msg";

export async function generateMetadata({ params }: PageProps<"/[lang]/transport/trip/[token]">): Promise<Metadata> {
  await pageLocale(params);
  const t = await getT();
  return { title: t("Your trip"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = {
  REQUESTED: msg("Requested — we confirm by phone or WhatsApp"), CONFIRMED: msg("Confirmed"), ASSIGNED: msg("Driver assigned"), IN_PROGRESS: msg("On the way"),
  EN_ROUTE: msg("On the way"), PICKED_UP: msg("On the way"), COMPLETED: msg("Completed — thank you"), CANCELLED: msg("Cancelled"), NO_SHOW: msg("Missed"),
};

/**
 * A website trip's private page: where it stands (the reference and the status first, beside the route as a
 * small HUD line on glass), Pay now for its price — first on phones, beside the details on desktop — then what
 * was asked for and who to call.
 */
export default async function TripPage({ params }: PageProps<"/[lang]/transport/trip/[token]">) {
  await pageLocale(params);
  const { token } = await params;
  const [trip, s, t] = await Promise.all([tripForCustomer(token), getSettings(), getT()]);
  if (!trip) notFound();
  const tz = s.timezone;
  const stopped = trip.status === "CANCELLED" || trip.status === "NO_SHOW";
  const plain = STATUS[trip.status] ? t(STATUS[trip.status]) : trip.status;
  const status = trip.paid && trip.status !== "CANCELLED" ? t("{status} · paid", { status: plain }) : plain;
  const note = trip.paid ? t("Paid — thank you.") : trip.onBill ? t("On your room bill.")
    : trip.online ? t("Pay now, after the trip, or add it to your room bill if you are staying with us.")
      : t("Pay after the trip, or add it to your room bill if you are staying with us.");

  return (
    <>
      <Section tone="night" first space="sm" glow="top" stars width="wide" labelledBy="trip-title" className="pb-10 sm:pb-14 lg:pb-16">
        <div className="grid gap-10 lg:grid-cols-12 lg:items-end lg:gap-x-10">
          <div className="min-w-0 lg:col-span-7">
            <Eyebrow className="flex items-center gap-2">
              <CircleCheck className="size-4 shrink-0" strokeWidth={1.6} aria-hidden="true" />
              {t(TRIP_TYPE_LABEL[trip.type])}
            </Eyebrow>
            <Heading as="h1" size="title" id="trip-title" className="mt-4">
              {t("Thank you, {name}", { name: trip.name.split(/\s+/)[0] })}
            </Heading>
            <div className="mt-7 flex flex-wrap items-end gap-x-10 gap-y-5">
              <div className="min-w-0">
                <p className={cn(typeScale.meta, "text-pub-muted")}>{t("Your trip reference")}</p>
                <p className="mt-2 font-display text-[clamp(1.875rem,1.4rem+2vw,2.75rem)] leading-none tracking-[0.02em] text-gold lining-nums [overflow-wrap:anywhere]">
                  {trip.reference}
                </p>
              </div>
              <StatusPill label={status} tone={stopped ? "warn" : "ok"} />
            </div>
          </div>
          {/* The route, as a small HUD line on glass. */}
          <GlassPanel as="aside" aria-label={t("Route")} variant="smoke" padding="md" rounded="lg" hud className="min-w-0 lg:col-span-5">
            <div className="mb-5 flex flex-wrap items-center justify-between gap-3">
              <HudLabel>{t("Route")}</HudLabel>
              <HudLabel tick={false} className="tabular-nums">{t.dateTime(trip.pickupAt, tz)}</HudLabel>
            </div>
            <MiniRoute from={trip.pickupLocation} to={trip.destination} />
          </GlassPanel>
        </div>
      </Section>

      <Section space="md" width="wide" atmosphere="calm" marker={{ index: 1, label: t("Your trip"), aside: <HudLabel tick={false}>{HOTEL_COORDS.label}</HudLabel> }}>
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-x-10">
          {/* What is owed and Pay now: first on phones, the right-hand column on desktop. */}
          <section aria-labelledby="price-title" className="min-w-0 lg:col-span-5 lg:col-start-8 lg:row-start-1">
            <Eyebrow as="h2">
              <span id="price-title">{t("Price")}</span>
            </Eyebrow>
            <div className="mt-4 flex items-baseline justify-between gap-4 border-y border-pub-line py-4">
              <span className="min-w-0 text-[15px] text-pub-muted">{trip.option ? t(trip.option) : t("Transport")}</span>
              <PriceTag amount={trip.price} unit={null} className="shrink-0" />
            </div>
            {(trip.online || trip.live) && trip.due > 0 && (
              <PayOnlineCard className="mt-6" tone="inherit" due={trip.due} phone={trip.phone ?? ""} live={trip.live} action={payTripOnlineAction.bind(null, token)} />
            )}
            <p className="mt-4 text-[13px] leading-relaxed text-pub-muted">{note}</p>
          </section>

          <section aria-labelledby="details-title" className="min-w-0 lg:col-span-6 lg:col-start-1 lg:row-start-1">
            <Heading size="subheading" id="details-title">{t("Your trip")}</Heading>
            <InfoList
              variant="rows"
              className="mt-5"
              items={[
                { label: t("When"), value: t.dateTime(trip.pickupAt, tz) },
                { label: t("Guests"), value: trip.passengers },
                ...(trip.flightNumber ? [{ label: t("Flight"), value: trip.flightNumber }] : []),
              ]}
            />
            <p className="mt-10 text-[15px] leading-relaxed text-pub-muted">
              {t.rich("Questions about your trip? Quote <b>{reference}</b>.", { b: (x) => <strong className="font-semibold text-pub-fg">{x}</strong> }, { reference: trip.reference })}
            </p>
            {(s.phone || s.whatsapp) && (
              <Actions className="mt-4">
                {s.phone && <TextLink href={telHref(s.phone)} icon="none">{t("Call {phone}", { phone: s.phone })}</TextLink>}
                {s.whatsapp && (
                  <TextLink href={whatsappHref(s.whatsapp, `Hello, about my trip ${trip.reference}`)} target="_blank" rel="noopener noreferrer">
                    WhatsApp<span className="sr-only"> {t("(opens in a new tab)")}</span>
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
