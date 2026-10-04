import { CheckCircle2, Clock, Mail, MessageCircle, Phone, Plane, ListChecks } from "lucide-react";
import type { HotelSettings } from "@/generated/prisma/client";
import { diffDays, formatMinutes, type BusinessDate } from "@/lib/time/business-date";
import { formatBusinessDate, formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { BookingActions } from "./booking-actions";
import { BookingProgress } from "./progress";
import { telHref, whatsappHref } from "../contact";
import { Ornament } from "../ornament";
import { container, cream, eyebrow, type } from "../ui";

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

export function RequestReceived({ request, settings }: { request: CustomerRequestView; settings: HotelSettings }) {
  const status = STATUS[request.status] ?? STATUS.NEW;
  const nights = diffDays(request.checkIn, request.checkOut);
  const confirmed = request.status === "CONVERTED" || request.status === "CONFIRMED";
  const pickup = request.transportRequested ? request.transportDetails : null;

  return (
    <div className={cn(cream, "flex-1 pb-20")}>
      <section className="relative overflow-hidden bg-[#15120e] text-white">
        <div aria-hidden="true" className="pointer-events-none absolute -right-40 -top-40 size-[36rem] rounded-full bg-gold/10 blur-3xl" />
        <div className={cn(container, "relative pb-24 pt-28 sm:pt-32")}>
          <div className="rounded-3xl bg-paper px-4 py-4 sm:px-6"><BookingProgress current={5} /></div>
          <div className="mt-12 max-w-3xl">
            <p className={cn(eyebrow, "flex items-center gap-2 text-gold")}>
              <CheckCircle2 className="size-4" aria-hidden="true" /> {status.title}
            </p>
            <h1 className={cn("mt-4", type.h1)}>
              {request.status === "NEW" ? "Request received" : status.title}
            </h1>
            <p className="mt-4 max-w-xl text-lg text-white/75">
              Thank you, {request.fullName.split(" ")[0]}. {status.body}
            </p>
            <div className="mt-8 inline-flex flex-col rounded-3xl border border-gold/30 bg-white/[0.04] px-6 py-5 backdrop-blur">
              <span className="text-xs uppercase tracking-[0.22em] text-white/55">Request reference</span>
              <span className="mt-1 font-display text-4xl tracking-wide text-gold sm:text-5xl">{request.reference}</span>
            </div>
            {request.reservation && confirmed && (
              <p className="mt-4 text-sm text-white/70">Booking reference <strong className="text-gold">{request.reservation.reference}</strong></p>
            )}
          </div>
        </div>
      </section>

      <div className={cn(container, "-mt-12 grid gap-6 lg:grid-cols-[1.4fr_1fr]")}>
        <section aria-labelledby="stay-title" className="rounded-[2rem] bg-panel p-6 ring-1 ring-tone/[0.07] sm:p-8">
          <h2 id="stay-title" className={type.h3}>{request.meeting ? "Your meeting room request" : "Your requested stay"}</h2>
          {request.meeting ? (
            <dl className="mt-6 grid gap-5 sm:grid-cols-2">
              <div className="rounded-2xl bg-paper p-5">
                <dt className="text-xs uppercase tracking-[0.18em] text-tone/55">Date</dt>
                <dd className="mt-2 font-display text-2xl">{formatBusinessDate(request.checkIn, true)}</dd>
              </div>
              <div className="rounded-2xl bg-paper p-5">
                <dt className="text-xs uppercase tracking-[0.18em] text-tone/55">Time</dt>
                <dd className="mt-2 inline-flex items-center gap-2 font-display text-2xl tabular-nums"><Clock className="size-4" aria-hidden="true" />{request.meeting.time}</dd>
              </div>
            </dl>
          ) : (
          <dl className="mt-6 grid gap-5 sm:grid-cols-2">
            <div className="rounded-2xl bg-paper p-5">
              <dt className="text-xs uppercase tracking-[0.18em] text-tone/55">Check-in</dt>
              <dd className="mt-2 font-display text-2xl">{formatBusinessDate(request.checkIn, true)}</dd>
              <dd className="mt-1 inline-flex items-center gap-1.5 text-sm text-tone/65">
                <Clock className="size-3.5" aria-hidden="true" />
                {request.expectedArrivalTime ? `arriving around ${request.expectedArrivalTime}` : `from ${formatMinutes(settings.standardCheckInMinutes)}`}
              </dd>
            </div>
            <div className="rounded-2xl bg-paper p-5">
              <dt className="text-xs uppercase tracking-[0.18em] text-tone/55">Check-out</dt>
              <dd className="mt-2 font-display text-2xl">{formatBusinessDate(request.checkOut, true)}</dd>
              <dd className="mt-1 inline-flex items-center gap-1.5 text-sm text-tone/65"><Clock className="size-3.5" aria-hidden="true" />by {formatMinutes(settings.checkoutMinutes)}</dd>
            </div>
          </dl>
          )}
          <dl className="mt-6 grid grid-cols-2 gap-4 border-t border-tone/10 pt-6 text-sm sm:grid-cols-4">
            <div><dt className="text-tone/55">Room</dt><dd className="mt-1 font-medium">{request.roomCount > 1 ? `${request.roomCount} × ` : ""}{request.roomType.name}</dd></div>
            {request.meeting ? (
              <>
                <div><dt className="text-tone/55">Company</dt><dd className="mt-1 font-medium">{request.meeting.company ?? "—"}</dd></div>
                <div><dt className="text-tone/55">People</dt><dd className="mt-1 font-medium">{request.adults}</dd></div>
              </>
            ) : (
              <>
                <div><dt className="text-tone/55">Nights</dt><dd className="mt-1 font-medium">{nights}</dd></div>
                <div><dt className="text-tone/55">Guests</dt><dd className="mt-1 font-medium">{request.adults} adult{request.adults === 1 ? "" : "s"}{request.children ? `, ${request.children} child${request.children === 1 ? "" : "ren"}` : ""}</dd></div>
              </>
            )}
            {request.estimatedNet != null && <div><dt className="text-tone/55">Estimated total</dt><dd className="mt-1 font-medium">{formatTZS(request.estimatedNet)}</dd></div>}
          </dl>
          {pickup && (
            <div className="mt-6 flex gap-4 rounded-2xl bg-[#15120e] p-5 text-white">
              <span className="grid size-10 shrink-0 place-items-center rounded-full bg-gold text-[#15120e]"><Plane className="size-4" aria-hidden="true" /></span>
              <div className="text-sm">
                <p className="font-medium text-gold">Airport pickup requested</p>
                <p className="mt-1 text-white/75">
                  {pickup.flightNumber ? `Flight ${pickup.flightNumber} · ` : ""}{pickup.arrivalDate ? formatBusinessDate(pickup.arrivalDate as BusinessDate) : ""}{pickup.arrivalTime ? ` at ${pickup.arrivalTime}` : ""}
                </p>
              </div>
            </div>
          )}
          {request.specialRequests && (
            <div className="mt-6 rounded-2xl bg-paper p-5 text-sm">
              <p className="text-tone/55">{request.meeting ? "Your requirements" : "Your requests"}</p>
              <p className="mt-1">{request.specialRequests}</p>
            </div>
          )}
        </section>

        <aside className="space-y-6">
          <section aria-labelledby="next-title" className="rounded-[2rem] bg-[#15120e] p-6 text-white sm:p-8">
            <h2 id="next-title" className={cn(type.h3, "flex items-center gap-2")}><ListChecks className="size-5 text-gold" aria-hidden="true" />What happens next</h2>
            <ol className="mt-6 space-y-4 text-sm">
              {[
                ["We check availability", "Our reservations team reviews your dates and room."],
                ["We contact you", `By phone or WhatsApp on ${request.phone}${request.email ? `, or by email` : ""}.`],
                ["Pay to secure your room", `We hold your room for a short time. A payment — a deposit is fine — confirms the booking; unpaid holds are released.${settings.bankAccountNumber || settings.mobileMoneyNumber ? " Payment details are below." : " Pay at reception or as we explain when we call."}`],
              ].map(([t, b], i) => (
                <li key={t} className="flex gap-4">
                  <span className={cn("grid size-8 shrink-0 place-items-center rounded-full text-xs font-semibold", i === 0 || confirmed ? "bg-gold text-[#15120e]" : "bg-white/10 text-white/70")}>{i + 1}</span>
                  <span><span className="block font-medium">{t}</span><span className="text-white/65">{b}</span></span>
                </li>
              ))}
            </ol>
            {(settings.bankAccountNumber || settings.mobileMoneyNumber) && (
              <div className="mt-6 space-y-2 rounded-2xl bg-white/[0.06] p-4 text-sm ring-1 ring-white/10">
                <p className="font-medium text-gold">Pay into</p>
                {settings.bankAccountNumber && <p className="text-white/80">{settings.bankName} · {settings.bankAccountName ? `${settings.bankAccountName} · ` : ""}<span className="font-mono">{settings.bankAccountNumber}</span></p>}
                {settings.mobileMoneyNumber && <p className="text-white/80">{settings.mobileMoneyName || "Mobile money"} · <span className="font-mono">{settings.mobileMoneyNumber}</span>{settings.mobileMoneyAccountName ? ` · ${settings.mobileMoneyAccountName}` : ""}</p>}
                <p className="text-white/55">Use <strong className="text-white">{request.reference}</strong> as the reference, then send us the confirmation by WhatsApp.</p>
              </div>
            )}
          </section>

          <section aria-labelledby="help-title" className="rounded-[2rem] bg-panel p-6 ring-1 ring-tone/[0.07] sm:p-8">
            <h2 id="help-title" className={type.h3}>Questions?</h2>
            <Ornament className="mt-4" />
            <p className="mt-4 text-sm text-tone/70">Quote your reference <strong>{request.reference}</strong>.</p>
            <ul className="mt-5 space-y-3 text-sm">
              {settings.phone && <li><a href={telHref(settings.phone)} className="inline-flex items-center gap-2 hover:underline"><Phone className="size-4 text-accent-ink" aria-hidden="true" />{settings.phone}</a></li>}
              {settings.whatsapp && <li><a href={whatsappHref(settings.whatsapp, `Hello, about my booking request ${request.reference}`)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 hover:underline"><MessageCircle className="size-4 text-accent-ink" aria-hidden="true" />WhatsApp<span className="sr-only"> (opens in a new tab)</span></a></li>}
              {settings.email && <li><a href={`mailto:${settings.email}?subject=${encodeURIComponent(`Booking request ${request.reference}`)}`} className="inline-flex items-center gap-2 break-all hover:underline"><Mail className="size-4 shrink-0 text-accent-ink" aria-hidden="true" />{settings.email}</a></li>}
            </ul>
          </section>

          <section className="rounded-[2rem] border border-dashed border-tone/20 p-6 text-sm text-tone/70 sm:p-8">
            <p><strong className="text-tone">Keep this page’s link</strong> — it’s your private link to check this request.</p>
            <div className="mt-4"><BookingActions /></div>
          </section>
        </aside>
      </div>
    </div>
  );
}
