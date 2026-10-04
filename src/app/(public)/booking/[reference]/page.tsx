import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock, Mail, MapPin, MessageCircle, Phone, Plane } from "lucide-react";
import { getSettings } from "@/server/settings";
import { getBookingForGuest } from "@/server/services/public-booking";
import { getRequestForCustomer } from "@/server/services/booking-requests";
import { RequestReceived } from "@/components/public/booking/request-received";
import { formatBusinessDate, formatDateTime, formatTZS, formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BookingActions } from "@/components/public/booking/booking-actions";
import { BookingPayOnline } from "@/components/public/booking/pay-online";
import { bookingPayOnline } from "@/server/services/online-pay";
import { BookingProgress } from "@/components/public/booking/progress";
import { addressLines, telHref, whatsappHref } from "@/components/public/contact";
import { Ornament } from "@/components/public/ornament";
import { container, cream, eyebrow, type } from "@/components/public/ui";

export const metadata: Metadata = {
  title: "Your booking",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

const STATUS: Record<string, { label: string; tone: "ok" | "muted" | "warn" }> = {
  INQUIRY: { label: "Enquiry received — we’ll be in touch", tone: "muted" },
  RESERVED: { label: "Reserved — pay at the hotel", tone: "ok" },
  CONFIRMED: { label: "Confirmed — pay at the hotel", tone: "ok" },
  CHECKED_IN: { label: "Checked in — enjoy your stay", tone: "ok" },
  CHECKED_OUT: { label: "Checked out — thank you for staying", tone: "muted" },
  CANCELLED: { label: "Cancelled", tone: "warn" },
  NO_SHOW: { label: "Marked as no-show", tone: "warn" },
};

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
  const status = booking.status === "CONFIRMED" && booking.paidAmount > 0
    ? { label: booking.balanceAmount > 0 ? "Confirmed — part paid" : "Confirmed — paid", tone: "ok" as const }
    : booking.status === "RESERVED" && held ? { label: `Reserved — held until ${held}`, tone: "ok" as const }
    : booking.status === "RESERVED" && online.offered ? { label: "Reserved — pay to confirm", tone: "ok" as const }
    : STATUS[booking.status] ?? { label: booking.status, tone: "muted" as const };
  const first = booking.rooms[0];
  const nights = first?.nights ?? 0;
  const address = addressLines(settings);
  const isNew = booking.status === "RESERVED" || booking.status === "CONFIRMED";

  return (
    <div className={cn(cream, "flex-1 pb-20")}>
      <section className="bg-[#15120e] text-white">
        <div className={cn(container, "pb-24 pt-28 sm:pt-32")}>
          <div className="rounded-3xl bg-paper px-4 py-4 sm:px-6"><BookingProgress current={5} /></div>
          <div className="mt-10 flex flex-col gap-6 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <p className={cn(eyebrow, "flex items-center gap-2 text-gold")}>
                {isNew && <CheckCircle2 className="size-4" aria-hidden="true" />} {isNew ? "Booking received" : "Your booking"}
              </p>
              <h1 className={cn("mt-3", type.h1)}>Thank you, {booking.guestName.split(" ")[0]}</h1>
              <p className="mt-3 text-white/70">Your booking reference is</p>
              <p className="mt-1 font-display text-5xl tracking-wide text-gold sm:text-6xl">{booking.reference}</p>
            </div>
            <p
              className={cn(
                "inline-flex w-fit items-center gap-2 rounded-full px-5 py-2.5 text-sm font-medium",
                status.tone === "ok" && "bg-gold text-[#15120e]",
                status.tone === "muted" && "bg-white/10 text-white",
                status.tone === "warn" && "bg-red-100 text-red-900",
              )}
            >
              {status.label}
            </p>
          </div>
        </div>
      </section>

      <div className={cn(container, "-mt-12 grid gap-6 lg:grid-cols-[1.4fr_1fr]")}>
        <section aria-labelledby="stay-title" className="rounded-[2rem] bg-panel p-6 ring-1 ring-tone/[0.07] sm:p-8">
          <h2 id="stay-title" className={type.h3}>Your stay</h2>
          <dl className="mt-6 grid gap-5 sm:grid-cols-2">
            <div className="rounded-2xl bg-paper p-5">
              <dt className="text-xs uppercase tracking-[0.18em] text-tone/55">Check-in</dt>
              <dd className="mt-2 font-display text-2xl">{formatBusinessDate(booking.arrivalDate, true)}</dd>
              {first && <dd className="mt-1 inline-flex items-center gap-1.5 text-sm text-tone/65"><Clock className="size-3.5" aria-hidden="true" />from {formatTime(first.startAt, tz)}</dd>}
            </div>
            <div className="rounded-2xl bg-paper p-5">
              <dt className="text-xs uppercase tracking-[0.18em] text-tone/55">Check-out</dt>
              <dd className="mt-2 font-display text-2xl">{formatBusinessDate(booking.departureDate, true)}</dd>
              {first && <dd className="mt-1 inline-flex items-center gap-1.5 text-sm text-tone/65"><Clock className="size-3.5" aria-hidden="true" />by {formatTime(first.endAt, tz)}</dd>}
            </div>
          </dl>
          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-tone/10 pt-6 text-sm sm:grid-cols-3">
            <div><dt className="text-tone/55">Guest</dt><dd className="mt-1 font-medium">{booking.guestName}</dd></div>
            <div><dt className="text-tone/55">Nights</dt><dd className="mt-1 font-medium">{nights}</dd></div>
            <div><dt className="text-tone/55">Guests</dt><dd className="mt-1 font-medium">{booking.adults} adult{booking.adults === 1 ? "" : "s"}{booking.children ? `, ${booking.children} child${booking.children === 1 ? "" : "ren"}` : ""}</dd></div>
          </dl>
          <h3 className="mt-8 text-xs uppercase tracking-[0.18em] text-tone/55">Room{booking.rooms.length === 1 ? "" : "s"}</h3>
          <ul className="mt-3 divide-y divide-tone/10 rounded-2xl ring-1 ring-tone/10">
            {booking.rooms.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-4">
                <span>
                  <span className="font-medium">{r.typeName}</span>
                  <span className="block text-sm text-tone/60">Room {r.roomNumber} <span className="text-tone/45">· assignment may change before arrival</span></span>
                </span>
                <span className="text-sm">{formatTZS(r.netAmount)}</span>
              </li>
            ))}
          </ul>
          {booking.pickup && (
            <div className="mt-6 flex gap-4 rounded-2xl bg-[#15120e] p-5 text-white">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gold text-[#15120e]"><Plane className="size-4" aria-hidden="true" /></span>
              <div className="text-sm">
                <p className="font-medium text-gold">
                  {booking.pickup.status === "REQUESTED" ? "Airport pickup requested — we’ll confirm by phone/WhatsApp" : "Airport pickup arranged"}
                </p>
                <p className="mt-1 text-white/75">
                  {booking.pickup.flightNumber ? `Flight ${booking.pickup.flightNumber} · ` : ""}{formatDateTime(booking.pickup.pickupAt, tz)} · {booking.pickup.pickupLocation}
                </p>
              </div>
            </div>
          )}
          {booking.specialRequests && (
            <div className="mt-6 rounded-2xl bg-paper p-5 text-sm">
              <p className="text-tone/55">Your requests</p>
              <p className="mt-1">{booking.specialRequests}</p>
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <section aria-labelledby="price-title" className="rounded-[2rem] bg-[#15120e] p-6 text-white sm:p-8">
            <h2 id="price-title" className={type.h3}>Price</h2>
            <dl className="mt-6 space-y-3 text-sm">
              <div className="flex justify-between gap-4"><dt className="text-white/65">Room charges</dt><dd>{formatTZS(booking.grossAmount)}</dd></div>
              {booking.discountAmount > 0 && <div className="flex justify-between gap-4 text-gold"><dt>Discount</dt><dd>− {formatTZS(booking.discountAmount)}</dd></div>}
              {booking.chargesAmount > 0 && <div className="flex justify-between gap-4"><dt className="text-white/65">Extras</dt><dd>{formatTZS(booking.chargesAmount)}</dd></div>}
              <div className="flex justify-between gap-4 border-t border-white/15 pt-3"><dt className="text-white/65">Total</dt><dd>{formatTZS(booking.netAmount)}</dd></div>
              {booking.paidAmount > 0 && <div className="flex justify-between gap-4"><dt className="text-white/65">Paid</dt><dd>− {formatTZS(booking.paidAmount)}</dd></div>}
              <div className="flex items-baseline justify-between gap-4 border-t border-white/15 pt-4">
                <dt className="font-medium">Amount due</dt>
                <dd className="font-display text-3xl font-semibold text-gold">{formatTZS(booking.balanceAmount)}</dd>
              </div>
            </dl>
            {(online.offered || online.live) && booking.balanceAmount > 0 && (
              <div className="mt-5"><BookingPayOnline reference={booking.reference} token={token!} due={booking.balanceAmount} phone={booking.guestPhone ?? ""} live={online.live} held={held} /></div>
            )}
            <p className="mt-4 text-xs text-white/55">{booking.balanceAmount <= 0 && booking.paidAmount > 0 ? "Paid in full — thank you."
              : booking.paidAmount > 0 ? "Received with thanks — the rest can be paid online or at the hotel."
              : online.offered ? "Pay online now, or at the hotel." : "Payment is made at the hotel. Nothing has been charged online."}</p>
          </section>

          <section aria-labelledby="help-title" className="rounded-[2rem] bg-panel p-6 ring-1 ring-tone/[0.07] sm:p-8">
            <h2 id="help-title" className={type.h3}>Need to change something?</h2>
            <Ornament className="mt-4" />
            <p className="mt-4 text-sm text-tone/70">Contact us with your reference <strong>{booking.reference}</strong>.</p>
            <ul className="mt-5 space-y-3 text-sm">
              {settings.phone && <li><a href={telHref(settings.phone)} className="inline-flex items-center gap-2 hover:underline"><Phone className="size-4 text-accent-ink" aria-hidden="true" />{settings.phone}</a></li>}
              {settings.whatsapp && <li><a href={whatsappHref(settings.whatsapp, `Hello, about my booking ${booking.reference}`)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:underline"><MessageCircle className="size-4 text-accent-ink" aria-hidden="true" />WhatsApp<span className="sr-only"> (opens in a new tab)</span></a></li>}
              {settings.email && <li><a href={`mailto:${settings.email}?subject=${encodeURIComponent(`Booking ${booking.reference}`)}`} className="inline-flex items-center gap-2 break-all hover:underline"><Mail className="size-4 shrink-0 text-accent-ink" aria-hidden="true" />{settings.email}</a></li>}
              {address.length > 0 && <li className="flex gap-2 text-tone/70"><MapPin className="mt-0.5 size-4 shrink-0 text-accent-ink" aria-hidden="true" /><span>{address.join(", ")}</span></li>}
            </ul>
          </section>

          <section className="rounded-[2rem] border border-dashed border-tone/20 p-6 text-sm text-tone/70 sm:p-8">
            <p><strong className="text-tone">Keep this page’s link</strong> — it’s your private link to view this booking.</p>
            <div className="mt-4"><BookingActions /></div>
          </section>
        </aside>
      </div>
    </div>
  );
}
