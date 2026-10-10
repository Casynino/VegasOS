import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Clock, Mail, MessageCircle, MessageSquarePlus, Phone, Plane, Quote } from "lucide-react";
import { can, type CurrentUser } from "@/server/auth";
import { db } from "@/server/db";
import { getRequestDetail, meetingRequestFree, requestAvailability } from "@/server/services/booking-requests";
import { billMenu } from "@/server/services/restaurant";
import { getSettings } from "@/server/settings";
import { bookingRequestMessage, guestsText } from "@/lib/wa-messages";
import { getT, getTFor } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { DEFAULT_LOCALE, LOCALE_META } from "@/i18n/config";
import { prettyPhone } from "@/lib/guest-messages";
import { timeRange } from "@/lib/meeting";
import { diffDays } from "@/lib/time/business-date";
import { formatBusinessDate, formatDateTime, formatTZS } from "@/lib/format";
import { BOOKING_REQUEST_STATUS } from "@/lib/booking-request-meta";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button";
import { AssignSelect, ConvertForm, ConvertMeetingForm, LogContactForm, RelinkCustomer, StatusControls } from "../forms";

const EVENT_LABEL: Record<string, string> = {
  SUBMITTED: msg("Request received"), STATUS_CHANGED: msg("Status changed"), CONTACTED: msg("Customer contacted"), NOTE: msg("Note"),
  ASSIGNED: msg("Assignment"), CUSTOMER_LINKED: msg("Customer profile"), CONVERTED: msg("Reservation created"),
};

/**
 * One website booking request, calm and in order: who and what at the top (the stay in one
 * strip), the guest and their message, the history — and on the right the one thing to do:
 * confirm it into a reservation.
 */
export async function BookingRequestView({ id, user, inline = false }: { id: string; user: CurrentUser; /** Opened inside the list (no back link; confirming stays on the list). */ inline?: boolean }) {
  const r = await getRequestDetail(id);
  if (!r) notFound();
  const t = await getT();
  const en = t.locale === DEFAULT_LOCALE;
  // "12 Oct" + "Monday" — the reader's way.
  const short = (d: string) => en ? formatBusinessDate(d).replace(/^\w+,?\s*/, "").replace(/\s\d{4}$/, "")
    : new Intl.DateTimeFormat(t.intl, { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const weekday = (d: string) => en ? formatBusinessDate(d, true).split(/[\s,]/)[0]
    : new Intl.DateTimeFormat(t.intl, { weekday: "long", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
  const when = (d: Date) => (en ? formatDateTime(d) : t.dateTime(d));
  const isOpen = ["NEW", "REVIEWING", "CONTACTED", "CONFIRMED"].includes(r.status);
  // Reception answers requests; managers and the MD may step in (approve, confirm, turn down).
  const manage = can(user, "booking_requests.manage");
  const editable = manage && r.status !== "CONVERTED";
  // A meeting room request (website "Book now" on the Meeting Room page): booked by time.
  const meeting = r.meetingStartAt && r.meetingEndAt ? { start: r.meetingStartAt, end: r.meetingEndAt, time: timeRange(r.meetingStartAt, r.meetingEndAt) } : null;
  const canConvert = isOpen && manage && can(user, "reservations.create");
  const [availability, staff, meetingFree, menu, settings] = await Promise.all([
    isOpen && !meeting ? requestAvailability(r.checkIn, r.checkOut) : Promise.resolve(null),
    db.user.findMany({ where: { isActive: true, role: { code: { not: "DRIVER" } } }, select: { id: true, fullName: true }, orderBy: { fullName: "asc" } }),
    isOpen && meeting ? meetingRequestFree({ meetingStartAt: meeting.start, meetingEndAt: meeting.end, roomTypeId: r.roomTypeId }) : Promise.resolve(null),
    canConvert ? billMenu() : Promise.resolve(null),
    getSettings(),
  ]);
  const meta = BOOKING_REQUEST_STATUS[r.status];
  const nights = diffDays(r.checkIn, r.checkOut);
  const requested = availability?.find((x) => x.id === r.roomTypeId);
  const freeRequested = requested?.rooms.length ?? 0;
  const pickup = r.transportRequested ? (r.transportDetails as { flightNumber?: string; arrivalDate?: string; arrivalTime?: string; airport?: string; passengers?: number; notes?: string } | null) : null;
  const waDigits = r.phone.replace(/\D/g, "");
  // The WhatsApp reply, in the one Vegas format: what they asked for and where it stands — in the customer's language.
  const rt = await getTFor(r.guest?.preferredLanguage);
  const english = rt.locale === DEFAULT_LOCALE;
  const waText = bookingRequestMessage({
    hotel: { name: settings.hotelName, phone: prettyPhone(settings.whatsapp || settings.phone) || null }, name: r.fullName, ref: r.reference,
    roomType: rt(r.roomType?.name ?? "Room"), rooms: r.roomCount,
    checkIn: english ? formatBusinessDate(r.checkIn) : rt.date(r.checkIn), checkOut: meeting ? null : english ? formatBusinessDate(r.checkOut) : rt.date(r.checkOut),
    nights: meeting ? null : nights, time: meeting?.time ?? null,
    guests: guestsText(r.adults, r.children, rt),
    estimate: r.estimatedNet || null, status: rt(meta.label).toUpperCase(),
  }, rt);
  const people = [t.plural(r.adults, "{n} adult", "{n} adults"), r.children ? t.plural(r.children, "{n} child", "{n} children") : null].filter(Boolean).join(" · ");
  const free = !isOpen ? null
    : meeting ? (meetingFree == null ? { ok: false, text: t("time has passed") } : { ok: meetingFree, text: meetingFree ? t("free at that time") : t("already booked") })
    : availability == null ? { ok: false, text: t("dates have passed") } : { ok: freeRequested >= r.roomCount, text: t("{n} free now", { n: freeRequested }) };

  return (
    <div className="w-full space-y-4">
      {!inline && <Link href="/staff/booking-requests" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{t("Online bookings")}</Link>}

      {/* ── Who & what ── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[oklch(0.55_0.1_75)] dark:text-[#f0cf86]">{t("{source} request · {ref}", { source: t(r.source.name), ref: r.reference })}</p>
          <div className="mt-1 flex flex-wrap items-center gap-2.5">
            <h1 className="text-[clamp(1.5rem,2.4vw,2rem)] font-semibold tracking-tight">{r.companyName ?? r.fullName}</h1>
            <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", meta.className)}>{t(meta.label)}</span>
          </div>
          <p className="mt-1 text-sm text-muted-foreground">{t("Sent {date}", { date: when(r.createdAt) })}{r.companyName ? ` · ${t("contact {name}", { name: r.fullName })}` : ""}</p>
        </div>
        {editable && <StatusControls id={r.id} status={r.status} />}
      </header>

      {r.status === "REJECTED" && r.rejectionReason && <p className="rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">{t("Rejected — {reason}", { reason: r.rejectionReason })}</p>}

      {/* ── The stay, in one strip ── */}
      <section className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border/70 bg-card sm:grid-cols-3 lg:grid-cols-5 [&>div]:border-border/70 [&>div]:p-4 [&>div]:border-b lg:[&>div]:border-b-0 [&>div:not(:last-child)]:border-r">
        {meeting ? (
          <>
            <Fact label={t("Date")} value={short(r.checkIn)} sub={weekday(r.checkIn)} />
            <Fact label={t("Time")} value={meeting.time} />
            <Fact label={t("People")} value={String(r.adults)} />
            <Fact label={t("Room")} value={t(r.roomType.name)} sub={free?.text} tone={free ? (free.ok ? "good" : "bad") : undefined} />
            <Fact label={t("Price at request")} value={r.estimatedNet != null ? formatTZS(r.estimatedNet) : "—"} />
          </>
        ) : (
          <>
            <Fact label={t("Check-in")} value={short(r.checkIn)} sub={r.expectedArrivalTime ? t("arrives {time}", { time: r.expectedArrivalTime }) : weekday(r.checkIn)} />
            <Fact label={t("Check-out")} value={short(r.checkOut)} sub={t.plural(nights, "{n} night", "{n} nights")} />
            <Fact label={t("Guests")} value={people} />
            <Fact label={t("Room")} value={`${r.roomCount > 1 ? `${r.roomCount} × ` : ""}${t(r.roomType.name)}`}
              sub={[r.requestedRoom ? t("asked for {room}", { room: r.requestedRoom.number }) : null, free?.text].filter(Boolean).join(" · ") || undefined} tone={free ? (free.ok ? "good" : "bad") : undefined} />
            <Fact label={t("Estimate")} value={r.estimatedNet != null ? formatTZS(r.estimatedNet) : "—"} className="max-lg:col-span-2 sm:max-lg:col-span-1" />
          </>
        )}
      </section>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_400px]">
        <div className="min-w-0 space-y-4">
          {/* Guest */}
          <Box>
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 leading-tight">
                <h2 className="text-base font-semibold">{r.fullName}</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">
                  {r.guest ? (
                    <Link href={`/staff/guests/${r.guest.id}`} className="hover:text-foreground hover:underline">
                      {r.guest._count.reservations ? t.plural(r.guest._count.reservations, "{n} previous stay", "{n} previous stays") : t("New guest")} · {t("open profile")}
                    </Link>
                  ) : t("New guest")}
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <a href={`tel:${r.phone}`} className={buttonVariants({ size: "sm", variant: "outline" })}><Phone />{r.phone}</a>
                <a href={`https://wa.me/${waDigits}?text=${encodeURIComponent(waText)}`} target="_blank" rel="noopener noreferrer" className={buttonVariants({ size: "sm", variant: "outline" })}><MessageCircle className="text-emerald-500" />WhatsApp{english ? "" : ` · ${LOCALE_META[rt.locale].short}`}</a>
                {r.email && <a href={`mailto:${r.email}?subject=${encodeURIComponent(rt("Your booking request {ref}", { ref: r.reference }))}`} className={buttonVariants({ size: "sm", variant: "outline" })}><Mail />{t("Email")}</a>}
              </div>
            </div>
            {(r.email || r.nationality) && (
              <dl className="divide-y divide-border/50 border-t border-border/70 text-sm">
                {r.email && <Row label={t("Email")}>{r.email}</Row>}
                {r.nationality && <Row label={t("Nationality")}>{r.nationality}</Row>}
              </dl>
            )}
            {(r.specialRequests || r.notes || pickup) && (
              <div className="space-y-2 border-t border-border/70 px-4 py-3 text-sm">
                {r.specialRequests && <p className="flex gap-2"><Quote className="mt-0.5 size-4 shrink-0 text-[oklch(0.62_0.13_78)]" /><span className="italic">{r.specialRequests}</span></p>}
                {r.notes && <p className="text-muted-foreground">{r.notes}</p>}
                {pickup && (
                  <p className="flex items-start gap-2"><Plane className="mt-0.5 size-4 shrink-0 text-sky-500" />
                    <span>
                      {t("Airport pickup")}{pickup.flightNumber && ` · ${t("flight {flight}", { flight: pickup.flightNumber })}`}
                      {pickup.arrivalDate && ` · ${en ? formatBusinessDate(pickup.arrivalDate) : t.date(pickup.arrivalDate)}`}{pickup.arrivalTime && ` ${pickup.arrivalTime}`}
                      {pickup.airport && ` · ${pickup.airport}`}{pickup.passengers && ` · ${t.plural(pickup.passengers, "{n} person", "{n} people")}`}{pickup.notes && ` — ${pickup.notes}`}
                    </span>
                  </p>
                )}
              </div>
            )}
            {editable && (
              <details className="group border-t border-border/70">
                <summary className="flex cursor-pointer list-none items-center justify-between px-4 py-2.5 text-xs text-muted-foreground hover:text-foreground">
                  {t("Wrong person? Link another profile or make a new one")}<span className="transition group-open:rotate-90">›</span>
                </summary>
                <div className="px-4 pb-3">
                  <RelinkCustomer key={r.guestId ?? "none"} id={r.id} currentGuestId={r.guestId} matches={r.matches.map((m) => ({ id: m.id, fullName: m.fullName, phone: m.phone, email: m.email, stays: m._count.reservations }))} />
                </div>
              </details>
            )}
          </Box>

          {/* History */}
          <Box>
            <div className="flex items-center justify-between gap-3 px-4 py-3">
              <h2 className="text-base font-semibold">{t("History")}</h2>
            </div>
            {editable && (
              <details className="group border-t border-border/70">
                <summary className="flex cursor-pointer list-none items-center gap-2 px-4 py-2.5 text-sm font-medium text-muted-foreground hover:text-foreground"><MessageSquarePlus className="size-4" />{t("Log a call or message")}</summary>
                <div className="px-4 pb-4"><LogContactForm id={r.id} /></div>
              </details>
            )}
            <ol className="relative ml-6 space-y-4 border-l border-border/70 py-4 pl-5 pr-4 [.border-t+&]:border-t-0">
              {r.events.map((e) => (
                <li key={e.id} className="relative text-sm">
                  <span className={cn("absolute -left-[25px] top-1.5 size-2.5 rounded-full ring-4 ring-card", e.type === "CONTACTED" ? "bg-violet-500" : e.type === "CONVERTED" ? "bg-emerald-500" : "bg-muted-foreground/50")} />
                  <p className="font-medium">
                    {t(EVENT_LABEL[e.type] ?? e.type)}
                    {e.type === "STATUS_CHANGED" && e.toStatus && <span className="font-normal text-muted-foreground"> → {t(BOOKING_REQUEST_STATUS[e.toStatus]?.label ?? e.toStatus)}</span>}
                  </p>
                  {e.note && <p className="text-muted-foreground">{e.note}</p>}
                  <p className="mt-0.5 flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="size-3" />{when(e.contactedAt ?? e.createdAt)} · {e.actor?.fullName ?? (e.type === "SUBMITTED" ? t("Customer") : t("System"))}
                  </p>
                </li>
              ))}
            </ol>
          </Box>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          {r.reservation ? (
            <Box className="border-emerald-500/40">
              <div className="space-y-3 p-4">
                <p className="flex items-center gap-2 text-base font-semibold"><CheckCircle2 className="size-5 text-emerald-500" />{t("Reservation made")}</p>
                <p className="text-sm text-muted-foreground"><span className="font-mono font-semibold text-foreground">{r.reservation.reference}</span> · {t(r.reservation.status.toLowerCase().replace("_", " "))} · {formatTZS(r.reservation.netAmount)}</p>
                <Link href={`/staff/reservations/${r.reservation.id}`} className={buttonVariants({ className: "w-full" })}>{t("Open reservation")}</Link>
              </div>
            </Box>
          ) : canConvert ? (
            <Box className="border-[oklch(0.75_0.13_80)]/60">
              <div className="px-4 pt-4">
                <h2 className="text-base font-semibold">{t("Confirm & make the reservation")}</h2>
                <p className="mt-0.5 text-sm text-muted-foreground">{t("Check the details, then confirm — the room is held at once.")}</p>
              </div>
              <div className="p-4">
                {meeting ? (
                  <ConvertMeetingForm request={{ id: r.id, date: r.checkIn, roomTypeId: r.roomTypeId, attendees: r.adults }} free={!!meetingFree} menu={menu} stay={inline} />
                ) : (
                  <ConvertForm
                    request={{ id: r.id, checkIn: r.checkIn, checkOut: r.checkOut, roomTypeId: r.roomTypeId, requestedRoomId: r.requestedRoomId, roomCount: r.roomCount, adults: r.adults, children: r.children }}
                    types={availability}
                    websiteDiscount={0}
                    canDiscount={can(user, "reservations.discount_override")}
                    menu={menu}
                    stay={inline}
                  />
                )}
              </div>
            </Box>
          ) : null}

          <Box>
            <h2 className="px-4 py-3 text-base font-semibold">{t("Request")}</h2>
            <dl className="divide-y divide-border/50 border-t border-border/70 text-sm">
              <Row label={t("Request ID")}><span className="font-mono">{r.reference}</span></Row>
              <Row label={t("From")}>{t(r.source.name)}</Row>
              <Row label={t("Looked after by")}>
                {editable ? <AssignSelect id={r.id} assignedToId={r.assignedToId ?? ""} staff={staff} /> : r.assignedTo?.fullName ?? <Dash />}
              </Row>
              {r.handledBy && <Row label={t("Handled by")}>{r.handledBy.fullName}{r.handledAt && ` · ${when(r.handledAt)}`}</Row>}
            </dl>
          </Box>
        </aside>
      </div>
    </div>
  );
}

const Dash = () => <span className="text-muted-foreground/60">—</span>;

function Box({ children, className }: { children: React.ReactNode; className?: string }) {
  return <section className={cn("overflow-hidden rounded-2xl border border-border/70 bg-card", className)}>{children}</section>;
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-2.5">
      <dt className="shrink-0 text-muted-foreground">{label}</dt>
      <dd className="min-w-0 truncate text-right font-medium">{children}</dd>
    </div>
  );
}

function Fact({ label, value, sub, tone, className }: { label: string; value: string; sub?: string; tone?: "good" | "bad"; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-lg font-semibold">{value}</p>
      {sub && <p className={cn("truncate text-xs", tone === "good" ? "text-emerald-600 dark:text-emerald-400" : tone === "bad" ? "text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>{sub}</p>}
    </div>
  );
}
