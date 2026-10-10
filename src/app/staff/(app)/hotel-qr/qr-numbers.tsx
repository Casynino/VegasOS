import { BadgeCheck, Banknote, BedDouble, CalendarCheck, CalendarPlus, Clock, Percent, QrCode, Search, Smartphone, XCircle, type LucideIcon } from "lucide-react";
import type { BookingQrAnalytics, BookingQrNumbers } from "@/server/services/booking-qr";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";

/** bookings ÷ scans, as a percent (it can pass 100%: staff, visitors without JavaScript and repeat visits are not counted as scans). */
export const rate = (n: Pick<BookingQrNumbers, "conversionRate">) => (n.conversionRate === null ? "—" : `${Math.round(n.conversionRate * 1000) / 10}%`);

/**
 * How the Hotel QR is doing over a period — managers and the Admin. The steps visitors took (counted by the booking
 * page), then what it brought from the bookings and payments themselves: confirmed bookings, NTZS payments, money.
 */
export async function QrNumbers({ a }: { a: BookingQrAnalytics }) {
  const t = await getT();
  const steps: { label: string; hint: string; value: number; icon: LucideIcon; bar: string }[] = [
    { label: t("Scans"), hint: t("booking page opened"), value: a.scans, icon: QrCode, bar: "bg-violet-500" },
    { label: t("Searches"), hint: t("dates checked"), value: a.searches, icon: Search, bar: "bg-violet-400" },
    { label: t("Room selections"), hint: t("a room opened"), value: a.selections, icon: BedDouble, bar: "bg-sky-500" },
    { label: t("Booking attempts"), hint: t("Book pressed"), value: a.attempts, icon: CalendarPlus, bar: "bg-sky-400" },
    { label: t("Bookings"), hint: t("reservations made"), value: a.bookings, icon: CalendarCheck, bar: "bg-[oklch(0.72_0.12_80)]" },
    { label: t("Confirmed"), hint: t("paid or confirmed"), value: a.confirmed, icon: BadgeCheck, bar: "bg-emerald-500" },
    { label: t("Payments completed"), hint: t("confirmed by NTZS"), value: a.paymentsCompleted, icon: Smartphone, bar: "bg-emerald-400" },
  ];
  const max = Math.max(1, ...steps.map((s) => s.value));
  const failed = a.paymentsFailed + a.paymentsExpired;
  const tiles: { label: string; value: string; sub: string; icon: LucideIcon; tint: string; tone?: string }[] = [
    { label: t("Revenue"), value: formatTZS(a.revenue), sub: t("{amount} paid online", { amount: formatTZS(a.paidOnline) }), icon: Banknote, tint: "bg-emerald-500/15 text-emerald-500", tone: "text-emerald-600 dark:text-emerald-400" },
    { label: t("Conversion"), value: rate(a), sub: t("bookings ÷ scans"), icon: Percent, tint: "bg-violet-500/15 text-violet-400" },
    { label: t("Payments failed"), value: String(failed), sub: t("{expired} timed out · {pending} on the way", { expired: a.paymentsExpired, pending: a.paymentsPending }), icon: XCircle, tint: "bg-rose-500/15 text-rose-400", tone: failed ? "text-rose-600 dark:text-rose-400" : undefined },
    { label: t("Waiting · released"), value: `${a.waiting} · ${a.cancelled}`, sub: t("held to pay · hold ran out or cancelled"), icon: Clock, tint: "bg-amber-500/15 text-amber-400" },
  ];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <ol className="space-y-2.5" aria-label={t("From scan to payment")}>
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
          {tiles.map((x) => (
            <div key={x.label} className="min-w-0 bg-card px-3.5 py-3">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={cn("grid size-5 shrink-0 place-items-center rounded-md [&_svg]:size-3", x.tint)}><x.icon /></span><span className="truncate">{x.label}</span></p>
              <p className={cn("mt-1 break-words text-base font-semibold leading-tight tabular-nums sm:text-lg", x.tone)}>{x.value}</p>
              <p className="text-[11px] leading-snug text-muted-foreground">{x.sub}</p>
            </div>
          ))}
        </div>
      </div>

      {a.byQr.length > 1 && (
        <div className="overflow-x-auto rounded-2xl border border-border/70 max-sm:px-3">
          {/* Phones: each place as a small card (data-stack), no sideways scrolling. */}
          <table data-stack className="w-full text-sm sm:min-w-[34rem]">
            <thead className="bg-muted/40 text-left text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
              <tr><th className="px-3 py-2 font-semibold">{t("Place")}</th><th className="px-3 py-2 text-right font-semibold">{t("Scans")}</th><th className="px-3 py-2 text-right font-semibold">{t("Bookings")}</th><th className="px-3 py-2 text-right font-semibold">{t("Confirmed")}</th><th className="px-3 py-2 text-right font-semibold">{t("Revenue")}</th><th className="px-3 py-2 text-right font-semibold">{t("Conversion")}</th></tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {a.byQr.map((q) => (
                <tr key={q.qrId}>
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2"><span className={cn("size-1.5 shrink-0 rounded-full", q.active ? "bg-emerald-500" : "bg-muted-foreground")} /><span className="truncate font-medium">{t(q.label)}</span>{q.archived && <span className="text-[10px] text-muted-foreground">{t("archived")}</span>}</span>
                  </td>
                  <td data-label={t("Scans")} className="px-3 py-2 text-right tabular-nums">{q.scans}</td>
                  <td data-label={t("Bookings")} className="px-3 py-2 text-right tabular-nums">{q.bookings}</td>
                  <td data-label={t("Confirmed")} className="px-3 py-2 text-right tabular-nums">{q.confirmed}</td>
                  <td data-label={t("Revenue")} className="px-3 py-2 text-right tabular-nums">{formatTZS(q.revenue)}</td>
                  <td data-label={t("Conversion")} className="px-3 py-2 text-right tabular-nums">{rate(q)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
