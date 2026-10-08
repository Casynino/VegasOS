import { CheckCircle2 } from "lucide-react";
import type { HotelSettings } from "@/generated/prisma/client";
import { diffDays, formatMinutes, type BusinessDate } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { LinkButton } from "../kit/button";
import { Heading } from "../kit/typography";
import { Section } from "../kit/section";
import { typeScale } from "../kit/tokens";
import fx from "../room-fx.module.css";
import { ConfirmationBand, ContactRows, DatePair, FactRow, KeepLink, printInk } from "./confirmation";
import { guestsLabel } from "./parts";

export interface CustomerRequestView {
  reference: string;
  status: string;
  fullName: string;
  phone: string;
  email: string | null;
  checkIn: BusinessDate;
  checkOut: BusinessDate;
  expectedArrivalTime: string | null;
  roomType: { name: string };
  roomCount: number;
  adults: number;
  children: number;
  specialRequests: string | null;
  transportRequested: boolean;
  transportDetails: { flightNumber?: string | null; arrivalDate?: string; arrivalTime?: string } | null;
  estimatedNet: number | null;
  reservation: { reference: string; status: string } | null;
  /** A meeting room request: the asked-for time (the date is checkIn). */
  meeting?: { time: string; company: string | null } | null;
}

/** What the guest sees about their request. Never implies a confirmed room until staff have converted it. */
const STATUS: Record<string, { title: string; body: string; tone: "gold" | "muted" | "warn" }> = {
  NEW: { title: msg("Request received"), body: msg("Our reservations team will contact you shortly to confirm availability and your booking."), tone: "gold" },
  REVIEWING: { title: msg("Being reviewed"), body: msg("Our team is checking availability for your dates. We’ll contact you shortly."), tone: "gold" },
  CONTACTED: { title: msg("We’ve been in touch"), body: msg("Our team has contacted you about this request. Reply to us by phone or WhatsApp if you haven’t yet."), tone: "gold" },
  CONFIRMED: { title: msg("Confirmed by our team"), body: msg("Your room has been confirmed by our reservations team."), tone: "gold" },
  CONVERTED: { title: msg("Booking confirmed"), body: msg("Our team has confirmed your booking. We look forward to welcoming you."), tone: "gold" },
  REJECTED: { title: msg("We couldn’t accommodate this request"), body: msg("Unfortunately we could not confirm these dates. Please contact us for alternatives."), tone: "warn" },
  CANCELLED: { title: msg("Request cancelled"), body: msg("This request has been cancelled. Contact us if you’d like to book again."), tone: "warn" },
};

/**
 * A booking (or meeting room) request's private page: the night band (status as the title,
 * the reference), what happens next on one dark panel — first on phones, beside the details
 * on desktop — the request as hairline lists, and how to reach us.
 */
export async function RequestReceived({ request, settings }: { request: CustomerRequestView; settings: HotelSettings }) {
  const t = await getT();
  const status = STATUS[request.status] ?? STATUS.NEW;
  const nights = diffDays(request.checkIn, request.checkOut);
  const confirmed = request.status === "CONVERTED" || request.status === "CONFIRMED";
  const pickup = request.transportRequested ? request.transportDetails : null;
  const open = request.status === "NEW" || request.status === "REVIEWING" || request.status === "CONTACTED";

  const steps = [
    [t("We check availability"), t("Our reservations team reviews your dates and room.")],
    [t("We contact you"), request.email ? t("By phone or WhatsApp on {phone}, or by email.", { phone: request.phone }) : t("By phone or WhatsApp on {phone}.", { phone: request.phone })],
    // Paying is only ever mobile money through nTZS, from the booking's own link (owner, 2026-10-05) — no account numbers.
    [t("Pay to secure your room"), t("Once we confirm, you pay by mobile money from your booking link — a payment request comes to your phone. Unpaid holds are released.")],
  ] as const;

  return (
    <div className="flex flex-1 flex-col">
      <ConfirmationBand
        progress={open || confirmed}
        eyebrow={
          <>
            {status.tone !== "warn" && <CheckCircle2 className="size-4" strokeWidth={1.6} aria-hidden="true" />}
            {request.meeting ? t("Meeting room request") : t("Booking request")}
          </>
        }
        title={t(status.title)}
        lede={<p>{t("Thank you, {name}.", { name: request.fullName.split(" ")[0] })} {t(status.body)}</p>}
        referenceLabel={t("Request reference")}
        reference={request.reference}
      >
        {request.reservation && confirmed && (
          <p className="mt-4 text-[14px] text-pub-muted">
            {t.rich("Booking reference <b>{reference}</b>", { b: (c) => <strong className="font-medium text-pub-eyebrow">{c}</strong> }, { reference: request.reservation.reference })}
          </p>
        )}
      </ConfirmationBand>

      <Section as="div" space="sm" width="wide" atmosphere="calm" pattern="grid" className="flex-1 pb-20 sm:pb-24 lg:pb-28">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-x-10 lg:gap-y-16">
          {/* What happens next — the guest's next step, first on phones. A closed request offers a new search instead. */}
          <section aria-labelledby="next-title" className="min-w-0 lg:col-span-4 lg:col-start-9 lg:row-span-2 lg:row-start-1">
            {status.tone === "warn" ? (
              <div data-tone="night" className={cn(fx.night, "relative p-5 text-pub-fg sm:p-7 lg:sticky lg:top-24", printInk)}>
                <span aria-hidden="true" className="pub-hud-corners print:hidden" style={{ "--hud-o": "-0.625rem", "--hud-l": "0.875rem" } as React.CSSProperties} />
                <h2 id="next-title" className={cn(typeScale.eyebrow, "text-pub-eyebrow")}>{t("Another date?")}</h2>
                <p className="mt-4 text-[14px] leading-relaxed text-pub-muted">
                  {request.meeting ? t("See when the Meeting Room is free and book it online.") : t("See which rooms are free on other dates and book online.")}
                </p>
                <LinkButton href={request.meeting ? "/meeting-room#book" : "/book"} icon="arrow" full className="mt-6 print:hidden">
                  {t("Check availability")}
                </LinkButton>
              </div>
            ) : (
              <div data-tone="night" className={cn(fx.night, "relative p-5 text-pub-fg sm:p-7 lg:sticky lg:top-24", printInk, "print:border print:border-pub-line")}>
                <span aria-hidden="true" className="pub-hud-corners print:hidden" style={{ "--hud-o": "-0.625rem", "--hud-l": "0.875rem" } as React.CSSProperties} />
                <h2 id="next-title" className={cn(typeScale.eyebrow, "text-pub-eyebrow")}>{t("What happens next")}</h2>
                <ol className="mt-6 space-y-5">
                  {steps.map(([title, b], i) => (
                    <li key={title} className="flex gap-4">
                      <span
                        aria-hidden="true"
                        className={cn(
                          "grid size-7 shrink-0 place-items-center rounded-full border text-[12px] font-semibold tabular-nums",
                          i === 0 || confirmed ? "border-gold bg-gold text-[#16110a]" : "border-pub-line text-pub-muted",
                        )}
                      >
                        {i + 1}
                      </span>
                      <span className="min-w-0 text-[14px] leading-relaxed">
                        <span className="block font-medium text-pub-fg">{title}</span>
                        <span className="text-pub-muted">{b}</span>
                      </span>
                    </li>
                  ))}
                </ol>
              </div>
            )}
          </section>

          <section aria-labelledby="stay-title" className="min-w-0 lg:col-span-7 lg:col-start-1 lg:row-start-1">
            <Heading as="h2" size="subheading" id="stay-title">{request.meeting ? t("Your meeting room request") : t("Your requested stay")}</Heading>
            <div className="mt-6">
              {request.meeting ? (
                <DatePair from={{ label: t("Date"), date: t.date(request.checkIn) }} to={{ label: t("Time"), date: request.meeting.time }} />
              ) : (
                <DatePair
                  from={{
                    label: t("Check-in"),
                    date: t.date(request.checkIn),
                    note: request.expectedArrivalTime ? t("arriving around {time}", { time: request.expectedArrivalTime }) : t("from {time}", { time: formatMinutes(settings.standardCheckInMinutes) }),
                  }}
                  to={{ label: t("Check-out"), date: t.date(request.checkOut), note: t("by {time}", { time: formatMinutes(settings.checkoutMinutes) }) }}
                />
              )}
            </div>
            <dl>
              <FactRow term={t("Room")}>
                <span className="font-display text-[1.25rem] leading-tight">
                  {request.roomCount > 1 ? `${request.roomCount} × ` : ""}
                  {t(request.roomType.name)}
                </span>
              </FactRow>
              {request.meeting ? (
                <>
                  <FactRow term={t("Company")}>{request.meeting.company ?? "—"}</FactRow>
                  <FactRow term={t("People")}>{request.adults}</FactRow>
                </>
              ) : (
                <FactRow term={t("Stay")}>
                  {t.plural(nights, "{n} night", "{n} nights")} · {guestsLabel(request.adults, request.children, t)}
                </FactRow>
              )}
              {request.estimatedNet != null && (
                <FactRow term={t("Estimated total")}>
                  <span className="font-display text-[1.25rem] leading-tight lining-nums tabular-nums">{formatTZS(request.estimatedNet)}</span>
                </FactRow>
              )}
              {pickup && (
                <FactRow term={t("Airport pickup")}>
                  <span className="block">{t("Requested — we’ll confirm by phone or WhatsApp")}</span>
                  {(pickup.flightNumber || pickup.arrivalDate || pickup.arrivalTime) && (
                    <span className="mt-0.5 block text-[13px] text-pub-muted">
                      {pickup.flightNumber ? `${t("Flight {flight}", { flight: pickup.flightNumber })} · ` : ""}
                      {pickup.arrivalDate ? t.date(pickup.arrivalDate as BusinessDate) : ""}
                      {pickup.arrivalTime ? ` ${t("at {time}", { time: pickup.arrivalTime })}` : ""}
                    </span>
                  )}
                </FactRow>
              )}
              {request.specialRequests && (
                <FactRow term={request.meeting ? t("Your requirements") : t("Your requests")}>
                  <span className="text-pub-muted">“{request.specialRequests}”</span>
                </FactRow>
              )}
            </dl>
          </section>

          <section aria-labelledby="help-title" className="min-w-0 lg:col-span-7 lg:col-start-1 lg:row-start-2">
            <Heading as="h2" size="subheading" id="help-title">{t("Questions?")}</Heading>
            <p className={cn(typeScale.small, "mt-2 text-pub-muted")}>
              {t.rich("Quote your reference <b>{reference}</b>.", { b: (c) => <strong className="font-medium text-pub-fg">{c}</strong> }, { reference: request.reference })}
            </p>
            <div className="mt-5">
              <ContactRows
                phone={settings.phone}
                whatsapp={settings.whatsapp}
                whatsappText={`Hello, about my booking request ${request.reference}`}
                email={settings.email}
                emailSubject={`Booking request ${request.reference}`}
              />
            </div>
            <KeepLink what={t("check this request")} />
          </section>
        </div>
      </Section>
    </div>
  );
}
