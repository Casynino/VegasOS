import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2 } from "lucide-react";
import { getSettings } from "@/server/settings";
import { getBookingForGuest } from "@/server/services/public-booking";
import { getRequestForCustomer } from "@/server/services/booking-requests";
import { RequestReceived } from "@/components/public/booking/request-received";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ConfirmationBand, ContactRows, DatePair, FactRow, KeepLink, printInk } from "@/components/public/booking/confirmation";
import { PayOnlineCard } from "@/components/public/pay-online-card";
import { payBookingOnlineAction } from "./actions";
import { bookingPayOnline } from "@/server/services/online-pay";
import { addressLines } from "@/components/public/contact";
import { Heading, Section, typeScale } from "@/components/public/kit";
import fx from "@/components/public/room-fx.module.css";
import { getT, pageLocale } from "@/i18n/server";
import { msg } from "@/i18n/msg";

export async function generateMetadata({ params }: PageProps<"/[lang]/booking/[reference]">): Promise<Metadata> {
  await pageLocale(params);
  const t = await getT();
  return {
    title: t("Your booking"),
    robots: { index: false, follow: false },
    referrer: "no-referrer",
  };
}

const STATUS: Record<string, { label: string; tone: "ok" | "muted" | "warn" }> = {
  INQUIRY: { label: msg("Enquiry received — we’ll be in touch"), tone: "muted" },
  RESERVED: { label: msg("Reserved — not paid yet"), tone: "ok" },
  CONFIRMED: { label: msg("Confirmed — not paid yet"), tone: "ok" },
  CHECKED_IN: { label: msg("Checked in — enjoy your stay"), tone: "ok" },
  CHECKED_OUT: { label: msg("Checked out — thank you for staying"), tone: "muted" },
  CANCELLED: { label: msg("Cancelled"), tone: "warn" },
  NO_SHOW: { label: msg("Marked as no-show"), tone: "warn" },
};

/** A meeting room booking uses the same statuses, said in meeting words. */
const MEETING_STATUS: Record<string, string> = {
  CHECKED_IN: msg("In use — enjoy your meeting"),
  CHECKED_OUT: msg("Finished — thank you for meeting with us"),
};

/**
 * A guest's private booking page (the link from the booking, the payment page and messages):
 * a night band with the thank-you, reference and status, then the stay as quiet hairline
 * lists, the price on one dark panel (with Pay now while something is owed — first on phones),
 * how to reach us and the "keep this link" line. Requests (VLH-REQ-…) have their own view.
 * A meeting room booking shows its date and hours, never a room number.
 */
export default async function BookingPage({ params, searchParams }: PageProps<"/[lang]/booking/[reference]">) {
  await pageLocale(params);
  const { reference } = await params;
  const sp = await searchParams;
  const token = Array.isArray(sp.token) ? sp.token[0] : sp.token;
  if (reference.startsWith("VLH-REQ-")) {
    const [request, settings] = await Promise.all([getRequestForCustomer(reference, token), getSettings()]);
    if (!request) notFound();
    return <RequestReceived request={request} settings={settings} />;
  }
  const [booking, settings, t] = await Promise.all([getBookingForGuest(reference, token), getSettings(), getT()]);
  if (!booking) notFound();

  const tz = settings.timezone;
  const online = await bookingPayOnline(booking.reference, token!);
  // Paid online (or at the hotel): said plainly; a booking held while the guest pays says until when.
  const held = booking.status === "RESERVED" && booking.holdUntil && booking.holdUntil > new Date() ? t.time(booking.holdUntil, tz) : null;
  const meeting = booking.kind === "MEETING";
  const plain = STATUS[booking.status] ?? { label: booking.status, tone: "muted" as const };
  const status = booking.status === "CONFIRMED" && booking.paidAmount > 0
    ? { label: booking.balanceAmount > 0 ? t("Confirmed — part paid") : t("Confirmed — paid"), tone: "ok" as const }
    : booking.status === "RESERVED" && held ? { label: t("Reserved — held until {time}", { time: held }), tone: "ok" as const }
    : booking.status === "RESERVED" && online.offered ? { label: t("Reserved — pay to confirm"), tone: "ok" as const }
    // Booked with "Pay later": made and seen by reception, but no room is held until it is paid.
    : booking.status === "INQUIRY" && booking.payLater ? { label: t("Booked — not reserved until paid"), tone: "warn" as const }
    : { ...plain, label: t((meeting && MEETING_STATUS[booking.status]) || plain.label) };
  const first = booking.rooms[0];
  const nights = first?.nights ?? 0;
  const address = addressLines(settings);
  const isNew = booking.status === "RESERVED" || booking.status === "CONFIRMED" || (booking.status === "INQUIRY" && booking.payLater);
  const showPay = (online.offered || online.live) && booking.balanceAmount > 0;
  const firstName = booking.guestName.split(" ")[0];
  const guests = t.plural(booking.adults, "{n} adult", "{n} adults");
  const guestsLine = booking.children ? t("{adults}, {children}", { adults: guests, children: t.plural(booking.children, "{n} child", "{n} children") }) : guests;

  const stay = (
    <section aria-labelledby="stay-title" className="min-w-0 lg:col-span-7 lg:col-start-1 lg:row-start-1">
      <Heading as="h2" size="subheading" id="stay-title">{meeting ? t("Your meeting") : t("Your stay")}</Heading>
      <div className="mt-6">
        {meeting ? (
          <DatePair
            from={{ label: t("Date"), date: t.date(booking.arrivalDate) }}
            to={{ label: t("Time"), date: first ? `${t.time(first.startAt, tz)} – ${t.time(first.endAt, tz)}` : "—" }}
          />
        ) : (
          <DatePair
            from={{ label: t("Check-in"), date: t.date(booking.arrivalDate), note: first ? t("from {time}", { time: t.time(first.startAt, tz) }) : undefined }}
            to={{ label: t("Check-out"), date: t.date(booking.departureDate), note: first ? t("by {time}", { time: t.time(first.endAt, tz) }) : undefined }}
          />
        )}
      </div>
      <dl>
        <FactRow term={meeting ? t("Booked by") : t("Guest")}>{booking.guestName}</FactRow>
        {meeting ? (
          <FactRow term={t("People")}>{booking.adults}</FactRow>
        ) : (
          <FactRow term={t("Stay")}>
            {t.plural(nights, "{n} night", "{n} nights")} · {guestsLine}
          </FactRow>
        )}
        {booking.rooms.map((r, i) => (
          <FactRow key={`${r.roomNumber}-${i}`} term={i === 0 ? (meeting ? t("Room") : booking.rooms.length === 1 ? t("Room") : t("Rooms")) : <span className="sr-only">{t("Room")}</span>} amount={formatTZS(r.netAmount)}>
            <span className="font-display text-[1.25rem] leading-tight">{t(r.typeName)}</span>
            {!meeting && (
              <span className="mt-0.5 block text-[13px] text-pub-muted">
                {t("Room {room} · assignment may change before arrival", { room: r.roomNumber })}
              </span>
            )}
          </FactRow>
        ))}
        {booking.pickup && (
          <FactRow term={t("Airport pickup")}>
            <span className="block">
              {booking.pickup.status === "REQUESTED" ? t("Requested — we’ll confirm by phone or WhatsApp") : t("Arranged")}
            </span>
            <span className="mt-0.5 block text-[13px] text-pub-muted">
              {booking.pickup.flightNumber ? `${t("Flight {flight}", { flight: booking.pickup.flightNumber })} · ` : ""}
              {t.dateTime(booking.pickup.pickupAt, tz)} · {booking.pickup.pickupLocation}
            </span>
          </FactRow>
        )}
        {booking.specialRequests && (
          <FactRow term={meeting ? t("Your notes") : t("Your requests")}>
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
          {t("Price")}
        </h2>
        <dl className="mt-5 space-y-3 text-[14px]">
          <div className="flex justify-between gap-4">
            <dt className="text-pub-muted">{meeting ? t("Meeting room") : t("Room charges")}</dt>
            <dd className="tabular-nums">{formatTZS(booking.grossAmount)}</dd>
          </div>
          {booking.discountAmount > 0 && (
            <div className="flex justify-between gap-4 text-pub-eyebrow">
              <dt>{t("Discount")}</dt>
              <dd className="tabular-nums">− {formatTZS(booking.discountAmount)}</dd>
            </div>
          )}
          {booking.chargesAmount > 0 && (
            <div className="flex justify-between gap-4">
              <dt className="text-pub-muted">{t("Extras")}</dt>
              <dd className="tabular-nums">{formatTZS(booking.chargesAmount)}</dd>
            </div>
          )}
          <div className="flex justify-between gap-4 border-t border-pub-line pt-3">
            <dt className="text-pub-muted">{t("Total")}</dt>
            <dd className="tabular-nums">{formatTZS(booking.netAmount)}</dd>
          </div>
          {booking.paidAmount > 0 && (
            <div className="flex justify-between gap-4">
              <dt className="text-pub-muted">{t("Paid")}</dt>
              <dd className="tabular-nums">− {formatTZS(booking.paidAmount)}</dd>
            </div>
          )}
          <div className="flex items-baseline justify-between gap-4 border-t border-pub-line pt-4">
            <dt className={cn(typeScale.meta, "text-pub-muted")}>{t("Amount due")}</dt>
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
          {booking.balanceAmount <= 0 && booking.paidAmount > 0 ? t("Paid in full — thank you.")
            : booking.paidAmount > 0 ? (online.offered ? t("Received with thanks — pay the rest by mobile money here.") : t("Received with thanks — the rest is paid at the hotel."))
            : booking.payLater ? (online.offered ? t("Not reserved until paid — pay now by mobile money to secure it.") : t("Not reserved until paid — the room may go to someone who pays first."))
            : online.offered ? t("Pay now by mobile money — a payment request comes to your phone.")
            : t("Payment is made at the hotel. Nothing has been charged online.")}
        </p>
      </div>
    </section>
  );

  return (
    <div className="flex flex-1 flex-col">
      <ConfirmationBand
        progress={isNew}
        progressLast={booking.paidAmount > 0 || booking.status === "CONFIRMED" ? t("Booked") : booking.payLater ? t("Booked — pay to reserve") : t("Reserved")}
        eyebrow={
          <>
            {isNew && <CheckCircle2 className="size-4" strokeWidth={1.6} aria-hidden="true" />}
            {isNew ? t("Booking received") : t("Your booking")}
          </>
        }
        title={<>{t("Thank you, {name}", { name: firstName })}</>}
        referenceLabel={t("Booking reference")}
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
            <Heading as="h2" size="subheading" id="help-title">{t("Need to change something?")}</Heading>
            <p className={cn(typeScale.small, "mt-2 text-pub-muted")}>
              {t.rich("Contact us with your reference <b>{reference}</b>.", { b: (x) => <strong className="font-medium text-pub-fg">{x}</strong> }, { reference: booking.reference })}
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
            <KeepLink what={t("view this booking")} />
          </section>
        </div>
      </Section>
    </div>
  );
}
