import { CheckCircle2 } from "lucide-react";
import type { HotelSettings } from "@/generated/prisma/client";
import { diffDays, formatMinutes, type BusinessDate } from "@/lib/time/business-date";
import { formatBusinessDate, formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { LinkButton } from "../kit/button";
import { Heading } from "../kit/typography";
import { Section } from "../kit/section";
import { typeScale } from "../kit/tokens";
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
  NEW: { title: "Request received", body: "Our reservations team will contact you shortly to confirm availability and your booking.", tone: "gold" },
  REVIEWING: { title: "Being reviewed", body: "Our team is checking availability for your dates. We’ll contact you shortly.", tone: "gold" },
  CONTACTED: { title: "We’ve been in touch", body: "Our team has contacted you about this request. Reply to us by phone or WhatsApp if you haven’t yet.", tone: "gold" },
  CONFIRMED: { title: "Confirmed by our team", body: "Your room has been confirmed by our reservations team.", tone: "gold" },
  CONVERTED: { title: "Booking confirmed", body: "Our team has confirmed your booking. We look forward to welcoming you.", tone: "gold" },
  REJECTED: { title: "We couldn’t accommodate this request", body: "Unfortunately we could not confirm these dates. Please contact us for alternatives.", tone: "warn" },
  CANCELLED: { title: "Request cancelled", body: "This request has been cancelled. Contact us if you’d like to book again.", tone: "warn" },
};

/**
 * A booking (or meeting room) request's private page: the night band (status as the title,
 * the reference), what happens next on one dark panel — first on phones, beside the details
 * on desktop — the request as hairline lists, and how to reach us.
 */
export function RequestReceived({ request, settings }: { request: CustomerRequestView; settings: HotelSettings }) {
  const status = STATUS[request.status] ?? STATUS.NEW;
  const nights = diffDays(request.checkIn, request.checkOut);
  const confirmed = request.status === "CONVERTED" || request.status === "CONFIRMED";
  const pickup = request.transportRequested ? request.transportDetails : null;
  const open = request.status === "NEW" || request.status === "REVIEWING" || request.status === "CONTACTED";
  const payInto = Boolean(settings.bankAccountNumber || settings.mobileMoneyNumber);

  const steps = [
    ["We check availability", "Our reservations team reviews your dates and room."],
    ["We contact you", `By phone or WhatsApp on ${request.phone}${request.email ? `, or by email` : ""}.`],
    ["Pay to secure your room", `We hold your room for a short time. A payment — a deposit is fine — confirms the booking; unpaid holds are released.${payInto ? " Payment details are below." : " Pay at reception or as we explain when we call."}`],
  ] as const;

  return (
    <div className="flex flex-1 flex-col">
      <ConfirmationBand
        progress={open || confirmed}
        eyebrow={
          <>
            {status.tone !== "warn" && <CheckCircle2 className="size-4" strokeWidth={1.6} aria-hidden="true" />}
            {request.meeting ? "Meeting room request" : "Booking request"}
          </>
        }
        title={status.title}
        lede={<p>Thank you, {request.fullName.split(" ")[0]}. {status.body}</p>}
        referenceLabel="Request reference"
        reference={request.reference}
      >
        {request.reservation && confirmed && (
          <p className="mt-4 text-[14px] text-pub-muted">
            Booking reference <strong className="font-medium text-pub-eyebrow">{request.reservation.reference}</strong>
          </p>
        )}
      </ConfirmationBand>

      <Section as="div" space="sm" width="wide" className="flex-1 pb-20 sm:pb-24 lg:pb-24">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-x-10 lg:gap-y-16">
          {/* What happens next — the guest's next step, first on phones. A closed request offers a new search instead. */}
          <section aria-labelledby="next-title" className="min-w-0 lg:col-span-4 lg:col-start-9 lg:row-span-2 lg:row-start-1">
            {status.tone === "warn" ? (
              <div data-tone="night" className={cn("rounded-[1rem] bg-night p-5 text-pub-fg ring-1 ring-white/[0.06] sm:p-7 lg:sticky lg:top-24", printInk)}>
                <h2 id="next-title" className={cn(typeScale.eyebrow, "text-pub-eyebrow")}>Another date?</h2>
                <p className="mt-4 text-[14px] leading-relaxed text-pub-muted">
                  {request.meeting ? "See when the Meeting Room is free and book it online." : "See which rooms are free on other dates and book online."}
                </p>
                <LinkButton href={request.meeting ? "/meeting-room#book" : "/book"} icon="arrow" full className="mt-6 print:hidden">
                  Check availability
                </LinkButton>
              </div>
            ) : (
              <div data-tone="night" className={cn("rounded-[1rem] bg-night p-5 text-pub-fg ring-1 ring-white/[0.06] sm:p-7 lg:sticky lg:top-24", printInk, "print:border print:border-pub-line")}>
                <h2 id="next-title" className={cn(typeScale.eyebrow, "text-pub-eyebrow")}>What happens next</h2>
                <ol className="mt-6 space-y-5">
                  {steps.map(([t, b], i) => (
                    <li key={t} className="flex gap-4">
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
                        <span className="block font-medium text-pub-fg">{t}</span>
                        <span className="text-pub-muted">{b}</span>
                      </span>
                    </li>
                  ))}
                </ol>
                {payInto && (
                  <div className="mt-6 space-y-2 border-t border-pub-line pt-5 text-[14px] leading-relaxed">
                    <p className={cn(typeScale.meta, "text-pub-eyebrow")}>Pay into</p>
                    {settings.bankAccountNumber && (
                      <p className="text-pub-fg/85">
                        {settings.bankName} · {settings.bankAccountName ? `${settings.bankAccountName} · ` : ""}
                        <span className="font-mono [overflow-wrap:anywhere]">{settings.bankAccountNumber}</span>
                      </p>
                    )}
                    {settings.mobileMoneyNumber && (
                      <p className="text-pub-fg/85">
                        {settings.mobileMoneyName || "Mobile money"} · <span className="font-mono">{settings.mobileMoneyNumber}</span>
                        {settings.mobileMoneyAccountName ? ` · ${settings.mobileMoneyAccountName}` : ""}
                      </p>
                    )}
                    <p className="text-[13px] text-pub-muted">
                      Use <strong className="font-medium text-pub-fg">{request.reference}</strong> as the reference, then send us the confirmation by WhatsApp.
                    </p>
                  </div>
                )}
              </div>
            )}
          </section>

          <section aria-labelledby="stay-title" className="min-w-0 lg:col-span-7 lg:col-start-1 lg:row-start-1">
            <Heading as="h2" size="subheading" id="stay-title">{request.meeting ? "Your meeting room request" : "Your requested stay"}</Heading>
            <div className="mt-6">
              {request.meeting ? (
                <DatePair from={{ label: "Date", date: formatBusinessDate(request.checkIn) }} to={{ label: "Time", date: request.meeting.time }} />
              ) : (
                <DatePair
                  from={{
                    label: "Check-in",
                    date: formatBusinessDate(request.checkIn),
                    note: request.expectedArrivalTime ? `arriving around ${request.expectedArrivalTime}` : `from ${formatMinutes(settings.standardCheckInMinutes)}`,
                  }}
                  to={{ label: "Check-out", date: formatBusinessDate(request.checkOut), note: `by ${formatMinutes(settings.checkoutMinutes)}` }}
                />
              )}
            </div>
            <dl>
              <FactRow term="Room">
                <span className="font-display text-[1.25rem] leading-tight">
                  {request.roomCount > 1 ? `${request.roomCount} × ` : ""}
                  {request.roomType.name}
                </span>
              </FactRow>
              {request.meeting ? (
                <>
                  <FactRow term="Company">{request.meeting.company ?? "—"}</FactRow>
                  <FactRow term="People">{request.adults}</FactRow>
                </>
              ) : (
                <FactRow term="Stay">
                  {nights} night{nights === 1 ? "" : "s"} · {guestsLabel(request.adults, request.children)}
                </FactRow>
              )}
              {request.estimatedNet != null && (
                <FactRow term="Estimated total">
                  <span className="font-display text-[1.25rem] leading-tight lining-nums tabular-nums">{formatTZS(request.estimatedNet)}</span>
                </FactRow>
              )}
              {pickup && (
                <FactRow term="Airport pickup">
                  <span className="block">Requested — we’ll confirm by phone or WhatsApp</span>
                  {(pickup.flightNumber || pickup.arrivalDate || pickup.arrivalTime) && (
                    <span className="mt-0.5 block text-[13px] text-pub-muted">
                      {pickup.flightNumber ? `Flight ${pickup.flightNumber} · ` : ""}
                      {pickup.arrivalDate ? formatBusinessDate(pickup.arrivalDate as BusinessDate) : ""}
                      {pickup.arrivalTime ? ` at ${pickup.arrivalTime}` : ""}
                    </span>
                  )}
                </FactRow>
              )}
              {request.specialRequests && (
                <FactRow term={request.meeting ? "Your requirements" : "Your requests"}>
                  <span className="text-pub-muted">“{request.specialRequests}”</span>
                </FactRow>
              )}
            </dl>
          </section>

          <section aria-labelledby="help-title" className="min-w-0 lg:col-span-7 lg:col-start-1 lg:row-start-2">
            <Heading as="h2" size="subheading" id="help-title">Questions?</Heading>
            <p className={cn(typeScale.small, "mt-2 text-pub-muted")}>
              Quote your reference <strong className="font-medium text-pub-fg">{request.reference}</strong>.
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
            <KeepLink what="check this request" />
          </section>
        </div>
      </Section>
    </div>
  );
}
