import Link from "next/link";
import { CalendarRange, ChevronRight, Clock3, LogIn, MessageSquareText, Phone, QrCode, Search, Users } from "lucide-react";
import { QR_PAY_HOTEL_NOTE, QR_PAY_HOTEL_NOTE_BEFORE, QR_PAY_ONLINE_NOTE, type QrBookingRow, type QrPaymentStatus } from "@/server/services/booking-qr";
import type { PayAccount } from "@/lib/pay-account";
import { CollectButton } from "@/components/staff/reception/collect-dialog";
import { RESERVATION_STATUS_META } from "@/lib/reservation-status";
import { formatDateTime, formatShortDate, formatTZS } from "@/lib/format";
import { EmptyState } from "@/components/staff/page-header";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { SendDetailsButton } from "./qr-row-actions";

/** The list's quick filters (the page turns each into the service's filter). */
export const QR_LISTS = [
  { key: "all", label: "All" },
  { key: "today", label: "New today" },
  { key: "arriving", label: "Arriving today" },
  { key: "upcoming", label: "Upcoming" },
  { key: "waiting", label: "Waiting to pay" },
  { key: "online", label: "Paid by phone" },
  { key: "cancelled", label: "Cancelled" },
] as const;
export type QrList = (typeof QR_LISTS)[number]["key"];

/**
 * Where the money stands, in reception's words — paid online said plainly, so nobody asks the guest to pay again; a
 * booking to pay later said as what it is: not paid, no room held (whoever pays first gets the room).
 */
function payChip(r: QrBookingRow): { text: string; tone: string; dot: string } {
  if (r.status === "INQUIRY" && r.paid === 0 && r.paymentStatus !== "PAYMENT_PENDING") return { text: "Not paid · room not held", tone: "bg-orange-500/12 text-orange-800 dark:text-orange-300", dot: "bg-orange-500" };
  const online = r.payWay === "ONLINE" || !!r.ntzsReference;
  const map: Record<QrPaymentStatus, { text: string; tone: string; dot: string }> = {
    PAID: online ? { text: "Paid by phone", tone: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" } : { text: "Paid", tone: "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300", dot: "bg-emerald-500" },
    PARTIALLY_PAID: { text: online ? "Part paid online" : "Part paid", tone: "bg-sky-500/12 text-sky-700 dark:text-sky-300", dot: "bg-sky-500" },
    PAYMENT_PENDING: { text: "Paying now", tone: "bg-sky-500/12 text-sky-700 dark:text-sky-300", dot: "bg-sky-500" },
    PAY_AT_HOTEL: { text: "Pay at hotel", tone: "bg-amber-500/12 text-amber-800 dark:text-amber-300", dot: "bg-amber-500" },
    PAYMENT_FAILED: { text: "Payment failed", tone: "bg-rose-500/12 text-rose-700 dark:text-rose-300", dot: "bg-rose-500" },
    PAYMENT_EXPIRED: { text: "Payment timed out", tone: "bg-rose-500/12 text-rose-700 dark:text-rose-300", dot: "bg-rose-500" },
    REFUNDED: { text: "Refunded", tone: "bg-muted text-muted-foreground", dot: "bg-muted-foreground" },
  };
  return map[r.paymentStatus];
}

/** The booking's own notes without the standard line it was made with (the chip already says how they pay). */
const ownNotes = (n: string | null) => n?.replace(QR_PAY_ONLINE_NOTE, "").replace(QR_PAY_HOTEL_NOTE, "").replace(QR_PAY_HOTEL_NOTE_BEFORE, "").replace(/\n{2,}/g, "\n").trim() || null;

/**
 * Bookings made from the Hotel QR — what reception needs at a glance: who, which room, when, how many, and where the
 * money stands (PAID ONLINE with NTZS's reference). What there is to do is done right on the row: take the payment,
 * check the guest in (as from the Front desk), send the booking details; the name opens the booking itself.
 */
export function QrBookings({ rows, list, q, newSince, keep, take, today, methods, canCheckIn }: {
  rows: QrBookingRow[]; list: QrList; q: string;
  /** The start of today's hotel day: bookings made since then get the "new" dot. */
  newSince: Date;
  keep: Record<string, string>; take: number;
  /** Today's hotel day (who can be checked in). */
  today: string;
  /** Where a payment can be received — null when this person does not take payments. */
  methods: PayAccount[] | null;
  canCheckIn: boolean;
}) {
  const href = (extra: Record<string, string>) => `?${new URLSearchParams({ ...keep, ...extra })}#bookings`;
  return (
    <section id="bookings" aria-labelledby="qr-bookings-title" className="scroll-mt-24 space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 id="qr-bookings-title" className="text-base font-semibold">Bookings from the QR</h2>
          <p className="text-xs text-muted-foreground">Real reservations — they are in Reservations too, with the source Hotel QR. Newest first.</p>
        </div>
        <Link href="/staff/reservations?view=all&f=qr" className="shrink-0 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted">In Reservations →</Link>
      </div>

      <nav aria-label="Filter QR bookings" className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
        <div className="flex w-max gap-1 rounded-2xl border border-border/70 bg-card p-1">
          {QR_LISTS.map((f) => (
            <Link key={f.key} href={href({ ...(f.key !== "all" && { list: f.key }), ...(q && { q }) })} aria-current={list === f.key ? "true" : undefined}
              className={cn("whitespace-nowrap rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors", list === f.key ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>{f.label}</Link>
          ))}
        </div>
      </nav>

      <form action="#bookings" className="relative">
        {Object.entries(keep).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
        {list !== "all" && <input type="hidden" name="list" value={list} />}
        <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
        <Input name="q" defaultValue={q} placeholder="Find a QR booking: reference, guest name or phone" className="h-11 rounded-2xl bg-card pl-10" aria-label="Search QR bookings" />
      </form>

      {rows.length === 0 ? (
        <EmptyState compact icon={<QrCode />}
          title={q ? `No QR booking matches "${q}"` : list === "all" ? "No bookings from the QR yet" : "Nothing here right now"}
          description={q ? "Search by reference, name or phone number." : "When a guest books from the QR it appears here at once."} />
      ) : (
        <ul className="grid gap-2.5 lg:grid-cols-2">
          {rows.map((r) => {
            const chip = payChip(r);
            const status = RESERVATION_STATUS_META[r.status];
            const isNew = r.createdAt >= newSince;
            const notes = ownNotes(r.notes);
            const room = r.rooms[0];
            const waiting = r.status === "RESERVED" || r.status === "CONFIRMED" || r.status === "INQUIRY";
            const open = waiting || r.status === "CHECKED_IN";
            // What reception can do right here: take what is owed (not while the guest's own payment is on its way),
            // check in an arrival, send the booking details the guest has not had yet.
            const collect = !!methods && open && !r.companyPays && r.balance > 0 && r.paymentStatus !== "PAYMENT_PENDING";
            const checkIn = canCheckIn && waiting && r.checkIn <= today;
            const details = !r.detailsSent && waiting;
            return (
              <li key={r.id} className="flex flex-col gap-2 rounded-2xl border border-border/70 bg-card p-3.5 transition-colors hover:border-foreground/20 dark:bg-white/[0.035]">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <Link href={`/staff/reservations/${r.id}`} className="flex min-w-0 items-center gap-1.5 text-sm font-semibold leading-tight hover:underline">
                      {isNew && <span className="size-1.5 shrink-0 rounded-full bg-[oklch(0.8_0.12_82)]" aria-label="New" />}
                      <span className="truncate">{r.guestName}</span>
                    </Link>
                    <p className="mt-0.5 truncate text-[11px] text-muted-foreground"><span className="font-mono">{r.reference}</span> · {formatDateTime(r.createdAt)}{r.qr ? ` · ${r.qr.label}` : ""}</p>
                  </div>
                  <span className={cn("inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-semibold", chip.tone)}><span className={cn("size-1.5 rounded-full", chip.dot)} />{chip.text}</span>
                </div>

                <div className="grid gap-1 text-xs sm:grid-cols-2">
                  <p className="flex min-w-0 items-center gap-1.5"><span className="font-semibold tabular-nums">{room ? `Room ${room.number}` : "Room to assign"}</span><span className="truncate text-muted-foreground">{r.roomType}{r.rooms.length > 1 ? ` +${r.rooms.length - 1}` : ""}</span></p>
                  <p className="flex min-w-0 items-center gap-1.5 tabular-nums"><CalendarRange className="size-3 shrink-0 text-muted-foreground" /><span className="truncate">{formatShortDate(r.checkIn)} → {formatShortDate(r.checkOut)} · {r.nights} night{r.nights === 1 ? "" : "s"}</span></p>
                  <p className="flex min-w-0 items-center gap-1.5"><Users className="size-3 shrink-0 text-muted-foreground" /><span className="truncate">{r.adults} adult{r.adults === 1 ? "" : "s"}{r.children ? `, ${r.children} child${r.children === 1 ? "" : "ren"}` : ""}{r.arrivalTime ? ` · arrives around ${r.arrivalTime}` : ""}</span></p>
                  {r.phone && (
                    <a href={`tel:${r.phone}`} className="flex min-w-0 items-center gap-1.5 hover:underline"><Phone className="size-3 shrink-0 text-muted-foreground" /><span className="truncate tabular-nums">{r.phone}</span>{r.email && <span className="truncate text-muted-foreground">· {r.email}</span>}</a>
                  )}
                </div>

                {(r.specialRequest || notes) && (
                  <p className="flex min-w-0 items-start gap-1.5 text-[11px] text-muted-foreground"><MessageSquareText className="mt-0.5 size-3 shrink-0" /><span className="line-clamp-2">{[r.specialRequest, notes].filter(Boolean).join(" · ")}</span></p>
                )}

                <div className="mt-auto flex flex-wrap items-end justify-between gap-2 border-t border-dashed border-border/70 pt-2">
                  <div className="min-w-0">
                    <p className="text-sm font-semibold tabular-nums">{formatTZS(r.amount)}
                      {r.paid > 0 && r.balance > 0 && <span className="ml-1.5 text-xs font-medium text-rose-600 dark:text-rose-400">owes {formatTZS(r.balance)}</span>}
                    </p>
                    <p className="truncate text-[11px] text-muted-foreground">
                      {r.ntzsReference ? <>NTZS ref <span className="font-mono text-foreground/80">{r.ntzsReference}</span></> : r.payWay === "ONLINE" ? "Paying online (NTZS)" : r.roomHeld ? "Pays at the hotel" : "Pays later — whoever pays first gets the room"}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-0.5 text-right">
                    <span className={cn("rounded-full border px-2 py-0.5 text-[10px] font-semibold", status.className)}>{status.label}</span>
                    {r.holdUntil && <span className="flex items-center gap-1 text-[10px] text-amber-700 dark:text-amber-300"><Clock3 className="size-3" />Held till {formatDateTime(r.holdUntil)}</span>}
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-1.5">
                  {collect && <CollectButton reservationId={r.id} guest={r.guestName} rooms={r.rooms.map((x) => x.number).join(", ") || "—"} outstanding={r.balance} owedSoFar={r.balance} methods={methods!} phone={r.phone} />}
                  {checkIn && (
                    <Link href={`/staff/check-in?id=${r.id}#workspace`} className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-xs font-semibold transition-colors hover:bg-muted"><LogIn className="size-3.5" />Check in</Link>
                  )}
                  {details && <SendDetailsButton reservationId={r.id} />}
                  <Link href={`/staff/reservations/${r.id}`} className="ml-auto inline-flex items-center gap-0.5 text-[11px] font-medium text-muted-foreground hover:text-foreground">Open booking<ChevronRight className="size-3.5" /></Link>
                </div>
                {details && <p className="-mt-1 text-[11px] text-muted-foreground">Booking details not sent to the guest yet.</p>}
              </li>
            );
          })}
        </ul>
      )}
      {rows.length >= take && <p className="text-center text-xs text-muted-foreground">Showing the latest {take} — search or open Reservations for older ones.</p>}
    </section>
  );
}
