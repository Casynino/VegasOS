import { BadgeCheck, Banknote, BedDouble, CalendarCheck, CalendarPlus, Clock, Percent, QrCode, Search, Smartphone, XCircle, type LucideIcon } from "lucide-react";
import type { BookingQrAnalytics, BookingQrNumbers } from "@/server/services/booking-qr";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";

/** bookings ÷ scans, as a percent (it can pass 100%: staff, visitors without JavaScript and repeat visits are not counted as scans). */
export const rate = (n: Pick<BookingQrNumbers, "conversionRate">) => (n.conversionRate === null ? "—" : `${Math.round(n.conversionRate * 1000) / 10}%`);

/**
 * How the Hotel QR is doing over a period — managers and the Admin. The steps visitors took (counted by the booking
 * page), then what it brought from the bookings and payments themselves: confirmed bookings, NTZS payments, money.
 */
export function QrNumbers({ a }: { a: BookingQrAnalytics }) {
  const steps: { label: string; hint: string; value: number; icon: LucideIcon; bar: string }[] = [
    { label: "Scans", hint: "booking page opened", value: a.scans, icon: QrCode, bar: "bg-violet-500" },
    { label: "Searches", hint: "dates checked", value: a.searches, icon: Search, bar: "bg-violet-400" },
    { label: "Room selections", hint: "a room opened", value: a.selections, icon: BedDouble, bar: "bg-sky-500" },
    { label: "Booking attempts", hint: "Book pressed", value: a.attempts, icon: CalendarPlus, bar: "bg-sky-400" },
    { label: "Bookings", hint: "reservations made", value: a.bookings, icon: CalendarCheck, bar: "bg-[oklch(0.72_0.12_80)]" },
    { label: "Confirmed", hint: "paid or confirmed", value: a.confirmed, icon: BadgeCheck, bar: "bg-emerald-500" },
    { label: "Payments completed", hint: "confirmed by NTZS", value: a.paymentsCompleted, icon: Smartphone, bar: "bg-emerald-400" },
  ];
  const max = Math.max(1, ...steps.map((s) => s.value));
  const failed = a.paymentsFailed + a.paymentsExpired;
  const tiles: { label: string; value: string; sub: string; icon: LucideIcon; tint: string; tone?: string }[] = [
    { label: "Revenue", value: formatTZS(a.revenue), sub: `${formatTZS(a.paidOnline)} paid online`, icon: Banknote, tint: "bg-emerald-500/15 text-emerald-500", tone: "text-emerald-600 dark:text-emerald-400" },
    { label: "Conversion", value: rate(a), sub: "bookings ÷ scans", icon: Percent, tint: "bg-violet-500/15 text-violet-400" },
    { label: "Payments failed", value: String(failed), sub: `${a.paymentsExpired} timed out · ${a.paymentsPending} on the way`, icon: XCircle, tint: "bg-rose-500/15 text-rose-400", tone: failed ? "text-rose-600 dark:text-rose-400" : undefined },
    { label: "Waiting · released", value: `${a.waiting} · ${a.cancelled}`, sub: "held to pay · hold ran out or cancelled", icon: Clock, tint: "bg-amber-500/15 text-amber-400" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <ol className="space-y-2.5" aria-label="From scan to payment">
          {steps.map((s) => (
            <li key={s.label} className="grid grid-cols-[minmax(0,9.5rem)_minmax(0,1fr)_auto] items-center gap-3 text-sm">
              <span className="flex min-w-0 items-center gap-2">
                <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-3.5"><s.icon /></span>
                <span className="min-w-0 leading-tight"><span className="block truncate font-medium">{s.label}</span><span className="block truncate text-[10px] text-muted-foreground">{s.hint}</span></span>
              </span>
              <span className="h-2.5 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", s.bar)} style={{ width: `${s.value ? Math.max(2, (s.value / max) * 100) : 0}%` }} /></span>
              <span className="w-12 text-right font-semibold tabular-nums">{s.value}</span>
            </li>
          ))}
        </ol>
        {/* One tile a row on the narrowest phones, so money is never cut off. */}
        <div className="grid grid-cols-1 gap-px self-start overflow-hidden rounded-2xl border border-border/70 bg-border/60 min-[420px]:grid-cols-2">
          {tiles.map((t) => (
            <div key={t.label} className="min-w-0 bg-card px-3.5 py-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={cn("grid size-5 shrink-0 place-items-center rounded-md [&_svg]:size-3", t.tint)}><t.icon /></span><span className="truncate">{t.label}</span></p>
              <p className={cn("mt-1 break-words text-base font-semibold leading-tight tabular-nums sm:text-lg", t.tone)}>{t.value}</p>
              <p className="text-[11px] leading-snug text-muted-foreground">{t.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {a.byQr.length > 1 && (
        <div className="overflow-x-auto rounded-2xl border border-border/70 max-sm:px-3">
          {/* Phones: each place as a small card (data-stack), no sideways scrolling. */}
          <table data-stack className="w-full text-sm sm:min-w-[34rem]">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr><th className="px-3 py-2 font-semibold">Place</th><th className="px-3 py-2 text-right font-semibold">Scans</th><th className="px-3 py-2 text-right font-semibold">Bookings</th><th className="px-3 py-2 text-right font-semibold">Confirmed</th><th className="px-3 py-2 text-right font-semibold">Revenue</th><th className="px-3 py-2 text-right font-semibold">Conversion</th></tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {a.byQr.map((q) => (
                <tr key={q.qrId}>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2"><span className={cn("size-1.5 shrink-0 rounded-full", q.active ? "bg-emerald-500" : "bg-muted-foreground")} /><span className="truncate font-medium">{q.label}</span>{q.archived && <span className="text-[10px] text-muted-foreground">archived</span>}</span>
                  </td>
                  <td data-label="Scans" className="px-3 py-2 text-right tabular-nums">{q.scans}</td>
                  <td data-label="Bookings" className="px-3 py-2 text-right tabular-nums">{q.bookings}</td>
                  <td data-label="Confirmed" className="px-3 py-2 text-right tabular-nums">{q.confirmed}</td>
                  <td data-label="Revenue" className="px-3 py-2 text-right tabular-nums">{formatTZS(q.revenue)}</td>
                  <td data-label="Conversion" className="px-3 py-2 text-right tabular-nums">{rate(q)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
