import type { Metadata } from "next";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { db } from "@/server/db";
import { can, requirePagePermission } from "@/server/auth";
import { businessToday, getSettings } from "@/server/settings";
import { financeHistory } from "@/server/services/finance-history";
import { addDays, toDbDate } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { getT } from "@/i18n/server";
import { FinanceTabs } from "@/components/staff/finance/finance-nav";
import { PriceCell } from "./price-cell";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Price control") };
}
export const dynamic = "force-dynamic";

/**
 * Price control — one page for the prices the hotel sells at: room rates (with how many booked nights ahead keep the old
 * price), the restaurant and bar menu, and every price change with who made it. Prices themselves are changed where they
 * are kept (Room pricing, Menu); a booking and an order keep the price they were made at, so nothing already sold changes.
 */
export default async function PriceControlPage() {
  const user = await requirePagePermission("pricing.manage", "finance.view");
  const t = await getT();
  const today = await businessToday();
  const [types, ahead, menu, settings, changes] = await Promise.all([
    db.roomType.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, category: true, baseRate: true, manualDiscountMax: true } }),
    db.roomNight.groupBy({ by: ["roomTypeId"], where: { businessDate: { gte: toDbDate(today) }, reservationRoom: { status: { in: ["RESERVED", "CONFIRMED", "CHECKED_IN"] } } }, _count: true }),
    db.menuItem.findMany({ where: { isActive: true }, orderBy: [{ category: { sortOrder: "asc" } }, { sortOrder: "asc" }], select: { id: true, name: true, price: true, type: true, isAvailable: true, category: { select: { name: true } } } }),
    getSettings(),
    financeHistory({ from: addDays(today, -60), to: today, group: "prices" }),
  ]);
  const aheadOf = new Map(ahead.map((a) => [a.roomTypeId, a._count]));
  const editRooms = can(user, "pricing.manage");
  const editMenu = can(user, "restaurant.prices") || can(user, "restaurant.menu");
  const byCategory = new Map<string, typeof menu>();
  for (const m of menu) byCategory.set(m.category.name, [...(byCategory.get(m.category.name) ?? []), m]);
  return (
    <div className="w-full space-y-5">
      <FinanceTabs active="/staff/accountant/prices" />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.4rem,2vw,1.75rem)] font-semibold tracking-tight">{t("Price control")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("A new price counts for new bookings and new orders. What was already booked or ordered keeps its price.")}</p>
        </div>
        {editRooms && <Link href="/staff/settings/pricing" className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-foreground px-3 text-sm font-medium text-background">{t("Change room prices")}<ArrowRight className="size-4" /></Link>}
      </header>

      <section className="rounded-3xl border border-border/70 bg-card">
        <header className="border-b border-border/60 px-4 py-2.5"><h2 className="text-sm font-semibold">{t("Room prices")}</h2></header>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[38rem] text-sm">
            <thead><tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
              <th className="px-4 py-2 font-medium">{t("Room type")}</th><th className="px-2 py-2 text-right font-medium">{t("Standard price")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("Staff may take off, per night")}</th><th className="px-4 py-2 text-right font-medium">{t("Booked nights ahead")}</th>
            </tr></thead>
            <tbody className="divide-y divide-border/50">
              {types.map((r) => (
                <tr key={r.id}>
                  <td className="px-4 py-2 font-medium">{t(r.name)}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{formatTZS(r.baseRate)}{r.category === "MEETING_ROOM" && <span className="block text-[11px] text-muted-foreground">{t("per booking")}</span>}</td>
                  <td className="px-2 py-2 text-right tabular-nums">{r.category === "MEETING_ROOM" ? "—" : formatTZS(r.manualDiscountMax ?? settings.manualDiscountMax)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{aheadOf.get(r.id) ?? 0}<span className="block text-[11px] text-muted-foreground">{t("keep the price they were booked at")}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">{t("Promotions and date prices (weekend, holiday, season) are in Room pricing. The most staff may discount is set by the Boss and the MD.")}</p>
      </section>

      <section className="rounded-3xl border border-border/70 bg-card">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 px-4 py-2.5">
          <h2 className="text-sm font-semibold">{t("Price changes — the last 60 days")}</h2>
          <Link href="/staff/finance/history?group=prices&period=month" className="text-xs font-medium text-muted-foreground underline-offset-4 hover:underline">{t("Edit history")}</Link>
        </header>
        {changes.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t("No price has changed in the last 60 days.")}</p> : (
          <ul className="divide-y divide-border/50 text-sm">
            {changes.slice(0, 25).map((c) => (
              <li key={c.id} className="px-4 py-2">
                <p><span className="font-medium">{c.who}</span> {c.label}{c.record && <span className="text-muted-foreground"> · {c.record}</span>}<span className="float-right text-xs tabular-nums text-muted-foreground">{t.dateTime(c.at)}</span></p>
                {c.changes.slice(0, 3).map((x) => <p key={x.field} className="text-xs text-muted-foreground">{x.field}: {x.from} → <span className="text-foreground">{x.to}</span></p>)}
                {c.reason && <p className="text-xs text-muted-foreground">{c.reason}</p>}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="rounded-3xl border border-border/70 bg-card">
        <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 px-4 py-2.5">
          <h2 className="text-sm font-semibold">{t("Restaurant and bar prices")}</h2>
          <p className="text-xs text-muted-foreground">{t.plural(menu.length, "{n} item", "{n} items")}</p>
        </header>
        {menu.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t("The menu is empty.")}</p> : (
          <div className="divide-y divide-border/50">
            {[...byCategory.entries()].map(([cat, items]) => (
              <details key={cat} className="group">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-2 text-sm font-medium hover:bg-muted/30"><span>{t(cat)}</span><span className="text-xs font-normal text-muted-foreground">{t.plural(items.length, "{n} item", "{n} items")}</span></summary>
                <ul className="divide-y divide-border/40 bg-muted/10 px-4 pb-1 text-sm">
                  {items.map((m) => <li key={m.id} className="flex items-center justify-between gap-3 py-1.5"><span className={m.isAvailable ? "" : "text-muted-foreground line-through"}>{t(m.name)}</span><PriceCell id={m.id} name={t(m.name)} price={m.price} canEdit={editMenu} /></li>)}
                </ul>
              </details>
            ))}
          </div>
        )}
        <p className="border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">{t("Each order copies the price when it is placed, so a new price never changes an old order — it counts from the next order. No cost price is kept for menu items, so no margin is shown.")}</p>
      </section>
    </div>
  );
}
