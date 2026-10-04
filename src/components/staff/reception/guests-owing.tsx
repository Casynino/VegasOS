import Link from "next/link";
import { Wallet } from "lucide-react";
import { formatBusinessDate, formatDateTime, formatTZS } from "@/lib/format";
import { PAYMENT_STATUS_META } from "@/lib/payment-status";
import { cn } from "@/lib/utils";
import type { InHouseBalances } from "@/server/services/guest-balances";
import { ShowRows } from "@/components/dashboard/show-rows";
import type { PayAccount } from "@/lib/pay-account";
import { CollectButton } from "./collect-dialog";

/**
 * GUESTS WITH OUTSTANDING BALANCE — everyone staying who still owes money:
 * the whole bill, what was paid, what is outstanding, and what the nights so far
 * already cost. Updates the moment a payment is recorded (same data as checkout).
 * With `show`, only that many guests are in view and the rest are a scroll away. With `methods`, Collect takes the
 * payment right here (a small window); without, it opens the guest's checkout.
 */
export function GuestsOwing({ b, canPay, compact, show, methods }: { b: InHouseBalances; canPay: boolean; compact?: boolean; show?: number; methods?: PayAccount[] }) {
  const s = b.summary;
  return (
    <section aria-label="Guests owing" className="overflow-hidden rounded-3xl border border-border/70 bg-card">
      <div className="grid grid-cols-2 gap-px bg-border/60 sm:grid-cols-4">
        {[
          ["Guests staying", `${s.guestsCheckedIn}`, `${s.occupiedRooms} room${s.occupiedRooms === 1 ? "" : "s"}`],
          ["Fully paid", `${s.fullyPaid}`, "nothing to collect"],
          ["Still owing", `${s.owingCount}`, s.owingCount ? "collect before checkout" : "all settled"],
          ["To collect", formatTZS(s.totalOutstanding), `${formatTZS(s.totalOwedSoFar)} for nights so far`],
        ].map(([k, v, h], i) => (
          <div key={k} className={cn("bg-card px-4 py-3", i === 3 && s.totalOutstanding > 0 && "bg-rose-500/[0.06]")}>
            <p className="text-[11px] text-muted-foreground">{k}</p>
            <p className={cn("text-lg font-semibold tabular-nums", i === 3 && s.totalOutstanding > 0 && "text-rose-600 dark:text-rose-400")}>{v}</p>
            <p className="text-[10px] text-muted-foreground">{h}</p>
          </div>
        ))}
      </div>
      {b.owing.length === 0 ? (
        <p className="p-5 text-sm text-muted-foreground">Nobody staying owes money. Collected payments are in the ledger.</p>
      ) : (
        <ShowRows show={show ?? b.owing.length} total={b.owing.length} className="overflow-x-auto">
          <table data-stack className="w-full min-w-[760px] text-sm">
            <thead data-head className="text-left text-[11px] uppercase tracking-wider text-muted-foreground [&_th]:sticky [&_th]:top-0 [&_th]:z-10 [&_th]:bg-card">
              <tr className="border-y border-border/70">
                <th className="px-4 py-2 font-medium">Room</th><th className="px-2 py-2 font-medium">Guest</th>
                {!compact && <><th className="px-2 py-2 font-medium">Check-in</th><th className="px-2 py-2 font-medium">Check-out</th></>}
                <th className="px-2 py-2 text-right font-medium">Total</th><th className="px-2 py-2 text-right font-medium">Paid</th>
                <th className="px-2 py-2 text-right font-medium">Outstanding</th>
                {!compact && <><th className="px-2 py-2 text-right font-medium">Nights so far</th><th className="px-2 py-2 font-medium">Last payment</th></>}
                <th className="px-4 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {b.owing.map((x) => (
                <tr key={x.reservationId} data-row className="hover:bg-muted/30">
                  <td className="px-4 py-2.5 font-semibold tabular-nums">{x.rooms.join(", ")}</td>
                  <td className="px-2 py-2.5">
                    <Link href={`/staff/reservations/${x.reservationId}`} className="font-medium hover:underline">{x.guest}</Link>
                    <span className={cn("ml-2 rounded-full px-2 py-px text-[10px] font-semibold", PAYMENT_STATUS_META[x.status].className)}>{PAYMENT_STATUS_META[x.status].label}</span>
                  </td>
                  {!compact && <><td className="px-2 py-2.5 text-xs">{formatBusinessDate(x.arrival)}</td><td className="px-2 py-2.5 text-xs">{formatBusinessDate(x.departure)}</td></>}
                  <td className="px-2 py-2.5 text-right tabular-nums">{x.total.toLocaleString("en-US")}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{x.paid.toLocaleString("en-US")}</td>
                  <td className="px-2 py-2.5 text-right font-semibold tabular-nums text-rose-600 dark:text-rose-400">{x.outstanding.toLocaleString("en-US")}
                    {x.owedSoFar !== x.outstanding && <span className="block text-[10px] font-normal text-muted-foreground">{x.owedSoFar.toLocaleString("en-US")} so far</span>}
                  </td>
                  {!compact && <><td className="px-2 py-2.5 text-right tabular-nums">{x.daysStaying}</td><td className="px-2 py-2.5 text-xs text-muted-foreground">{x.lastPayment ? formatDateTime(x.lastPayment) : "none yet"}</td></>}
                  <td className="px-4 py-2.5 text-right">
                    <span className="inline-flex gap-1.5">
                      {canPay && (methods && !x.companyPays
                        ? <CollectButton reservationId={x.reservationId} guest={x.guest} rooms={x.rooms.join(", ")} outstanding={x.outstanding} owedSoFar={x.owedSoFar} methods={methods} phone={x.phone} />
                        : <Link href={`/staff/check-out?id=${x.reservationId}#workspace`} className="inline-flex items-center gap-1 rounded-lg bg-foreground px-2.5 py-1 text-xs font-semibold text-background hover:opacity-90"><Wallet className="size-3.5" />Collect</Link>)}
                      <Link href={`/staff/reservations/${x.reservationId}`} className="rounded-lg border border-border px-2.5 py-1 text-xs font-medium hover:bg-muted">View</Link>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot data-foot className="[&_td]:sticky [&_td]:bottom-0 [&_td]:bg-card [&_td]:shadow-[inset_0_1px_0_var(--border)]"><tr className="border-t border-border/70 font-semibold"><td className="px-4 py-2" colSpan={compact ? 4 : 6}>Total outstanding</td><td className="px-2 py-2 text-right tabular-nums text-rose-600 dark:text-rose-400">{s.totalOutstanding.toLocaleString("en-US")}</td><td colSpan={compact ? 1 : 3} /></tr></tfoot>
          </table>
        </ShowRows>
      )}
    </section>
  );
}
