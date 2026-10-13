import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/server/auth";
import { businessToday } from "@/server/settings";
import { discountHistory } from "@/server/services/accountant-reports";
import { formatTZS } from "@/lib/format";
import { getT } from "@/i18n/server";
import { FinanceTabs, PeriodPicker, periodLabel, readPeriod } from "@/components/staff/finance/finance-nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Discounts") };
}
export const dynamic = "force-dynamic";

/**
 * Discounts given — what was taken off, by whom and why, with the original price and the final one. Read from the
 * nights and orders themselves, never typed in. Staff limits and the rules for who may discount are set by the Boss and
 * the MD (Room pricing); a discount that was given is never rewritten here.
 */
export default async function DiscountsPage({ searchParams }: PageProps<"/staff/accountant/discounts">) {
  await requirePagePermission("finance.view");
  const t = await getT();
  const today = await businessToday();
  const p = readPeriod(await searchParams, today, "month");
  const d = await discountHistory(p.from, p.to);
  return (
    <div className="w-full space-y-5">
      <FinanceTabs active="/staff/accountant/discounts" />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.4rem,2vw,1.75rem)] font-semibold tracking-tight">{t("Discounts")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{periodLabel(p, t)} · {t("Rooms are counted on the nights guests really stayed.")}</p>
        </div>
        <PeriodPicker current={p.key} from={p.from} to={p.to} />
      </header>

      <dl className="grid grid-cols-2 gap-2 lg:grid-cols-4">
        <Tile label={t("All discounts")} value={formatTZS(d.totals.all)} />
        <Tile label={t("Promotions and date prices")} value={formatTZS(d.totals.promo)} sub={t("the hotel's own rule")} />
        <Tile label={t("Given by hand — rooms")} value={formatTZS(d.totals.manual)} sub={t.plural(d.totals.rooms, "{n} room booking", "{n} room bookings")} />
        <Tile label={t("Given by hand — restaurant")} value={formatTZS(d.totals.restaurant)} sub={t.plural(d.totals.orders, "{n} order", "{n} orders")} />
      </dl>

      <section className="rounded-3xl border border-border/70 bg-card">
        <header className="border-b border-border/60 px-4 py-2.5"><h2 className="text-sm font-semibold">{t("Who gave discounts by hand")}</h2></header>
        {d.byStaff.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t("Nobody gave a discount by hand in this period.")}</p> : (
          <ul className="divide-y divide-border/50 text-sm">
            {d.byStaff.map((s) => <li key={s.name} className="flex items-center justify-between gap-3 px-4 py-2"><span>{s.name}<span className="ml-2 text-xs text-muted-foreground">{t.plural(s.count, "{n} discount", "{n} discounts")}</span></span><span className="font-medium tabular-nums">{formatTZS(s.amount)}</span></li>)}
          </ul>
        )}
      </section>

      <section className="rounded-3xl border border-border/70 bg-card">
        <header className="border-b border-border/60 px-4 py-2.5"><h2 className="text-sm font-semibold">{t("Room discounts")}</h2></header>
        {d.roomRows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t("No room discounts in this period.")}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[52rem] text-sm">
              <thead><tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-medium">{t("Booking")}</th><th className="px-2 py-2 font-medium">{t("Room")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("Original")}</th><th className="px-2 py-2 text-right font-medium">{t("Promotion")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("By hand")}</th><th className="px-2 py-2 text-right font-medium">{t("Final")}</th>
                <th className="px-4 py-2 font-medium">{t("Reason · by")}</th>
              </tr></thead>
              <tbody className="divide-y divide-border/50">
                {d.roomRows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-2"><Link href={r.href} className="font-medium underline-offset-4 hover:underline">{r.guest}</Link><span className="block text-[11px] text-muted-foreground">{r.reference}</span></td>
                    <td className="px-2 py-2">{r.room}<span className="block text-[11px] text-muted-foreground">{t(r.roomType)} · {t.plural(r.nights, "{n} night", "{n} nights")}</span></td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatTZS(r.gross)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.promo ? `− ${formatTZS(r.promo)}` : "—"}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{r.manual ? `− ${formatTZS(r.manual)}` : "—"}</td>
                    <td className="px-2 py-2 text-right font-medium tabular-nums">{formatTZS(r.net)}</td>
                    <td className="px-4 py-2 text-xs">{r.reason ?? ""}{r.by && <span className="block text-muted-foreground">{r.by}{r.at && ` · ${t.dateTime(r.at)}`}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="rounded-3xl border border-border/70 bg-card">
        <header className="border-b border-border/60 px-4 py-2.5"><h2 className="text-sm font-semibold">{t("Restaurant and bar discounts")}</h2></header>
        {d.restaurantRows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t("No restaurant discounts in this period.")}</p> : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[40rem] text-sm">
              <thead><tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2 font-medium">{t("Order")}</th><th className="px-2 py-2 text-right font-medium">{t("Original")}</th>
                <th className="px-2 py-2 text-right font-medium">{t("Discount")}</th><th className="px-2 py-2 text-right font-medium">{t("Final")}</th>
                <th className="px-4 py-2 font-medium">{t("Reason · by")}</th>
              </tr></thead>
              <tbody className="divide-y divide-border/50">
                {d.restaurantRows.map((r) => (
                  <tr key={r.id} className="align-top">
                    <td className="px-4 py-2 font-medium">{r.number}{r.party && <span className="block text-[11px] font-normal text-muted-foreground">{r.party}</span>}</td>
                    <td className="px-2 py-2 text-right tabular-nums">{formatTZS(r.original)}</td>
                    <td className="px-2 py-2 text-right tabular-nums">− {formatTZS(r.discount)}</td>
                    <td className="px-2 py-2 text-right font-medium tabular-nums">{formatTZS(r.final)}</td>
                    <td className="px-4 py-2 text-xs">{r.reason ?? ""}{r.by && <span className="block text-muted-foreground">{r.by} · {t.dateTime(r.at)}</span>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-xs text-muted-foreground">{t("The most staff may take off a night, and who may discount at all, are set by the Boss and the MD in Room pricing.")}</p>
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card px-3 py-2.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-lg font-semibold tabular-nums">{value}</dd>
      {sub && <dd className="text-[11px] text-muted-foreground">{sub}</dd>}
    </div>
  );
}
