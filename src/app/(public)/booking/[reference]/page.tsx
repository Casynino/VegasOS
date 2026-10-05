import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { getSettings } from "@/server/settings";
import { getBookingForGuest } from "@/server/services/public-booking";
import { getRequestForCustomer } from "@/server/services/booking-requests";
import { RequestReceived } from "@/components/public/booking/request-received";
import { formatBusinessDate, formatDateTime, formatTZS, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ConfirmationBand, ContactRows, DatePair, FactRow, KeepLink, printInk } from "@/components/public/booking/confirmation";
import { guestsLabel } from "@/components/public/booking/parts";
import { PayOnlineCard } from "@/components/public/pay-online-card";
import { payBookingOnlineAction } from "./actions";
import { bookingPayOnline } from "@/server/services/online-pay";
import { addressLines } from "@/components/public/contact";
import { Heading, Section, typeScale } from "@/components/public/kit";
import fx from "@/components/public/room-fx.module.css";

export const metadata: Metadata = {
  title: "Your booking",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const STATUS: Record<string, { label: string; tone: "ok" | "muted" | "warn" }> = {
  INQUIRY: { label: "Enquiry received — we’ll be in touch", tone: "muted" },
  RESERVED: { label: "Reserved — not paid yet", tone: "ok" },
  CONFIRMED: { label: "Confirmed — not paid yet", tone: "ok" },
  CHECKED_IN: { label: "Checked in — enjoy your stay", tone: "ok" },
  CHECKED_OUT: { label: "Checked out — thank you for staying", tone: "muted" },
  CANCELLED: { label: "Cancelled", tone: "warn" },
  NO_SHOW: { label: "Marked as no-show", tone: "warn" },
};

/** A meeting room booking uses the same statuses, said in meeting words. */
const MEETING_STATUS: Record<string, string> = {
  CHECKED_IN: "In use — enjoy your meeting",
  CHECKED_OUT: "Finished — thank you for meeting with us",
};

/**
 * A guest's private booking page (the link from the booking, the payment page and messages):
 * a night band with the thank-you, reference and status, then the stay as quiet hairline
 * lists, the price on one dark panel (with Pay now while something is owed — first on phones),
 * how to reach us and the "keep this link" line. Requests (VLH-REQ-…) have their own view.
 * A meeting room booking shows its date and hours, never a room number.
 */
export default async function BookingPage({ params, searchParams }: PageProps<"/booking/[reference]">) {
  const { reference } = await params;
  const sp = await searchParams;
  const token = Array.isArray(sp.token) ? sp.token[0] : sp.token;
  if (reference.startsWith("VLH-REQ-")) {
    const [request, settings] = await Promise.all([getRequestForCustomer(reference, token), getSettings()]);
    if (!request) notFound();
    return <RequestReceived request={request} settings={settings} />;
  }
  const [booking, settings] = await Promise.all([getBookingForGuest(reference, token), getSettings()]);
  if (!booking) notFound();

  const tz = settings.timezone;
  const online = await bookingPayOnline(booking.reference, token!);
  // Paid online (or at the hotel): said plainly; a booking held while the guest pays says until when.
  const held = booking.status === "RESERVED" && booking.holdUntil && booking.holdUntil > new Date() ? formatTime(booking.holdUntil, tz) : null;
  const meeting = booking.kind === "MEETING";
  const plain = STATUS[booking.status] ?? { label: booking.status, tone: "muted" as const };
  const status = booking.status === "CONFIRMED" && booking.paidAmount > 0
    ? { label: booking.balanceAmount > 0 ? "Confirmed — part paid" : "Confirmed — paid", tone: "ok" as const }
    : booking.status === "RESERVED" && held ? { label: `Reserved — held until ${held}`, tone: "ok" as const }
    : booking.status === "RESERVED" && online.offered ? { label: "Reserved — pay to confirm", tone: "ok" as const }
    // Booked with "Pay later": made and seen by reception, but no room is held until it is paid.
    : booking.status === "INQUIRY" && booking.payLater ? { label: "Booked — not reserved until paid", tone: "warn" as const }
    : { ...plain, label: (meeting && MEETING_STATUS[booking.status]) || plain.label };
  const first = booking.rooms[0];
  const nights = first?.nights ?? 0;
  const address = addressLines(settings);
  const isNew = booking.status === "RESERVED" || booking.status === "CONFIRMED" || (booking.status === "INQUIRY" && booking.payLater);
  const showPay = (online.offered || online.live) && booking.balanceAmount > 0;
  const firstName = booking.guestName.split(" ")[0];

  const stay = (
    <section aria-labelledby="stay-title" className="min-w-0 lg:col-span-7 lg:col-start-1 lg:row-start-1">
      <Heading as="h2" size="subheading" id="stay-title">{meeting ? "Your meeting" : "Your stay"}</Heading>
      <div className="mt-6">
        {meeting ? (
          <DatePair
            from={{ label: "Date", date: formatBusinessDate(booking.arrivalDate) }}
            to={{ label: "Time", date: first ? `${formatTime(first.startAt, tz)} – ${formatTime(first.endAt, tz)}` : "—" }}
          />
        ) : (
          <DatePair
            from={{ label: "Check-in", date: formatBusinessDate(booking.arrivalDate), note: first ? `from ${formatTime(first.startAt, tz)}` : undefined }}
            to={{ label: "Check-out", date: formatBusinessDate(booking.departureDate), note: first ? `by ${formatTime(first.endAt, tz)}` : undefined }}
          />
        )}
      </div>
      <dl>
        <FactRow term={meeting ? "Booked by" : "Guest"}>{booking.guestName}</FactRow>
        {meeting ? (
          <FactRow term="People">{booking.adults}</FactRow>
        ) : (
          <FactRow term="Stay">
            {nights} night{nights === 1 ? "" : "s"} · {guestsLabel(booking.adults, booking.children)}
          </FactRow>
        )}
        {booking.rooms.map((r, i) => (
          <FactRow key={`${r.roomNumber}-${i}`} term={i === 0 ? (meeting ? "Room" : booking.rooms.length === 1 ? "Room" : "Rooms") : <span className="sr-only">Room</span>} amount={formatTZS(r.netAmount)}>
            <span className="font-display text-[1.25rem] leading-tight">{r.typeName}</span>
            {!meeting && (
              <span className="mt-0.5 block text-[13px] text-pub-muted">
                Room {r.roomNumber} · assignment may change before arrival
              </span>
            )}
          </FactRow>
        ))}
        {booking.pickup && (
          <FactRow term="Airport pickup">
            <span className="block">
              {booking.pickup.status === "REQUESTED" ? "Requested — we’ll confirm by phone or WhatsApp" : "Arranged"}
            </span>
            <span className="mt-0.5 block text-[13px] text-pub-muted">
              {booking.pickup.flightNumber ? `Flight ${booking.pickup.flightNumber} · ` : ""}
              {formatDateTime(booking.pickup.pickupAt, tz)} · {booking.pickup.pickupLocation}
            </span>
          </FactRow>
        )}
        {booking.specialRequests && (
          <FactRow term={meeting ? "Your notes" : "Your requests"}>
            <span className="text-pub-muted">“{booking.specialRequests}”</span>
          </FactRow>
        )}
      </dl>
    </section>
  );

  const price = (
    <section aria-labelledby="price-title" className="min-w-0 lg:col-span-4 lg:col-start-9 lg:row-span-2 lg:row-start-1">
      <div data-tone="night" className={cn(fx.night, "relative p-5 text-pub-fg sm:p-7 lg:sticky lg:top-24", printInk, "print:border print:border-pub-line")}>
        <span aria-hidden="true" className="pub-hud-corners print:hidden" style={{ "--hud-o": "-0.625rem", "--hud-l": "0.875rem" } as React.CSSProperties} />
        <h2 id="price-title" className="flex items-center gap-2.5 font-mono text-[10px] font-medium uppercase tracking-[0.2em] text-pub-eyebrow sm:text-[11px]">
          <span aria-hidden="true" className="h-px w-3.5 bg-current" />
          Price
        </h2>
        <dl className="mt-5 space-y-3 text-[14px]">
          <div className="flex justify-between gap-4">
            <dt className="text-pub-muted">{meeting ? "Meeting room" : "Room charges"}</dt>
            <dd className="tabular-nums">{formatTZS(booking.grossAmount)}</dd>
          </div>
          {booking.discountAmount > 0 && (
            <div className="flex justify-between gap-4 text-pub-eyebrow">
              <dt>Discount</dt>
              <dd className="tabular-nums">− {formatTZS(booking.discountAmount)}</dd>
            </div>
          )}
          {booking.chargesAmount > 0 && (
            <div className="flex justify-between gap-4">
              <dt className="text-pub-muted">Extras</dt>
              <dd className="tabular-nums">{formatTZS(booking.chargesAmount)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4 border-t border-pub-line pt-3">
            <dt className="text-pub-muted">Total</dt>
            <dd className="tabular-nums">{formatTZS(booking.netAmount)}</dd>
          </div>
          {booking.paidAmount > 0 && (
            <div className="flex justify-between gap-4">
              <dt className="text-pub-muted">Paid</dt>
              <dd className="tabular-nums">− {formatTZS(booking.paidAmount)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-4 border-t border-pub-line pt-4">
            <dt className={cn(typeScale.meta, "text-pub-muted")}>Amount due</dt>
            <dd className="font-display text-[clamp(1.75rem,1.4rem+1.2vw,2.25rem)] leading-none text-pub-eyebrow lining-nums tabular-nums">
              {formatTZS(booking.balanceAmount)}
            </dd>
          </div>
        </dl>
        {(online.offered || online.live) && booking.balanceAmount > 0 && (
          <div className="mt-6 print:hidden">
            <PayOnlineCard due={booking.balanceAmount} phone={booking.guestPhone ?? ""} live={online.live} held={held} action={payBookingOnlineAction.bind(null, { reference: booking.reference, token: token! })} />
          </div>
        )}
        <p className="mt-4 text-[12.5px] leading-relaxed text-pub-muted">
          {booking.balanceAmount <= 0 && booking.paidAmount > 0 ? "Paid in full — thank you."
            : booking.paidAmount > 0 ? (online.offered ? "Received with thanks — pay the rest by mobile money here." : "Received with thanks — the rest is paid at the hotel.")
            : booking.payLater ? (online.offered ? "Not reserved until paid — pay now by mobile money to secure it." : "Not reserved until paid — the room may go to someone who pays first.")
            : online.offered ? "Pay now by mobile money — a payment request comes to your phone."
            : "Payment is made at the hotel. Nothing has been charged online."}
        </p>
      </div>
    </section>
  );

  return (
    <div className="flex flex-1 flex-col">
      <ConfirmationBand
        progress={isNew}
        progressLast={booking.paidAmount > 0 || booking.status === "CONFIRMED" ? "Booked" : booking.payLater ? "Booked — pay to reserve" : "Reserved"}
        eyebrow={
          <>
            {isNew && <CheckCircle2 className="size-4" strokeWidth={1.6} aria-hidden="true" />}
            {isNew ? "Booking received" : "Your booking"}
          </>
        }
        title={<>Thank you, {firstName}</>}
        referenceLabel="Booking reference"
        reference={booking.reference}
        status={status}
      />

      <Section as="div" space="sm" width="wide" atmosphere="calm" pattern="grid" className="flex-1 pb-20 sm:pb-24 lg:pb-28">
        <div className="grid gap-12 lg:grid-cols-12 lg:gap-x-10 lg:gap-y-16">
          {/* Phones: while something is owed and can be paid now, the price and Pay now come first. */}
          {showPay && price}
          {stay}
          {!showPay && price}

          <section aria-labelledby="help-title" className="min-w-0 lg:col-span-7 lg:col-start-1 lg:row-start-2">
            <Heading as="h2" size="subheading" id="help-title">Need to change something?</Heading>
            <p className={cn(typeScale.small, "mt-2 text-pub-muted")}>
              Contact us with your reference <strong className="font-medium text-pub-fg">{booking.reference}</strong>.
            </p>
            <div className="mt-5">
              <ContactRows
                phone={settings.phone}
                whatsapp={settings.whatsapp}
                whatsappText={`Hello, about my booking ${booking.reference}`}
                email={settings.email}
                emailSubject={`Booking ${booking.reference}`}
                address={address}
              />
            </div>
            <KeepLink what="view this booking" />
          </section>
        </div>
      </Section>
    </div>
  );
}
