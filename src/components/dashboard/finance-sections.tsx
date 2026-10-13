import { BedDouble, Banknote, Gauge, Moon, Percent, Receipt, Tag, UtensilsCrossed } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTZS } from "@/lib/format";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/translate";
import type { BusinessDate } from "@/lib/time/business-date";
import { addDays } from "@/lib/time/business-date";
import { percent, weekdayAverages } from "@/lib/finance-insights";
import type { PermissionCode } from "@/lib/permissions";
import { change, occupancy, restaurantSummary, type Range } from "@/server/services/reporting";
import type { profitLoss } from "@/server/services/reporting";
import type { AccountantOverview } from "@/server/services/accountant";
import { bookingActivity } from "@/server/services/finance-home";
import { closedDays, monthlyTrend } from "@/server/services/finance-outlook";
import type { expenseSummary } from "@/server/services/reporting";
import { periodLabel, type readPeriod } from "@/components/staff/finance/finance-nav";
import { Delta, Panel, PanelLink } from "./kit";
import { AreaTrend } from "./light-charts";
import { MIN_DAYS_FOR_WEEK, TrendsView, type Movement } from "./finance-analysis";

/**
 * The parts of Finance's Home that load by themselves while the rest of the page is already on screen: the trends (six months,
 * occupancy, the pattern of the week) and the bookings. Each is handed what the page already worked out, and asks only for its own
 * extra figures.
 */

export type HomePeriod = ReturnType<typeof readPeriod>;
export interface HomeContext {
  p: HomePeriod;
  range: Range; prev: Range; days: number; today: BusinessDate; live: BusinessDate | null;
  /** The period before begins before the records did: only partly filled, no fair base. */
  straddles: boolean;
  /** Something of the period before can exist at all (it did not end before the records began). */
  prevHasRecords: boolean;
  has: (...codes: PermissionCode[]) => boolean;
  ov: AccountantOverview;
  plPrev: Awaited<ReturnType<typeof profitLoss>>;
  spend: Awaited<ReturnType<typeof expenseSummary>> | null;
}

/** The words and the little "up 12%" chip every figure of the page uses against the period before. */
export function compareKit(t: T, p: { key: string }, days: number, straddles: boolean) {
  const vsLabel = days === 1 ? (p.key === "today" ? t("yesterday") : t("the day before")) : t("previous period");
  // Where there is nothing before to compare with, say so — never "same as before".
  const sinceWords = days === 1 ? (p.key === "today" ? t("yesterday") : t("the day before")) : t("in the previous period");
  const versus = (now: number, before: number, invert?: boolean) => (straddles ? null : before > 0
    ? <Delta value={change(now, before)} invert={invert} label={vsLabel} t={t} />
    : now > 0 ? <span className="text-xs text-muted-foreground">{t("none {when}", { when: sinceWords })}</span> : null);
  return { vsLabel, sinceWords, versus };
}

/** Both periods' money by name — the union of what each had. */
export function moves(nowRows: { name: string; amount: number }[], beforeRows: { name: string; amount: number }[]): Movement[] {
  const byName = new Map<string, Movement>();
  for (const r of nowRows) byName.set(r.name, { name: r.name, now: (byName.get(r.name)?.now ?? 0) + r.amount, before: byName.get(r.name)?.before ?? 0 });
  for (const r of beforeRows) byName.set(r.name, { name: r.name, now: byName.get(r.name)?.now ?? 0, before: (byName.get(r.name)?.before ?? 0) + r.amount });
  return [...byName.values()];
}

const perRoom = (net: number, rooms: number) => (rooms > 0 ? Math.round(net / rooms) : null);

// ───────────────────────── How the hotel is doing ─────────────────────────

export async function TrendsSection({ c }: { c: HomeContext }) {
  const t = await getT();
  const { p, range, prev, days, today, live, straddles, prevHasRecords, has, ov, plPrev, spend } = c;
  // Occupancy and what depends on it count only the days since the records began.
  const rangeLive = { from: live && p.from < live ? live : p.from, to: p.to };
  const [monthly, occNow, occPrev, restNow, restPrev] = await Promise.all([
    monthlyTrend(today, live, 6),
    rangeLive.from <= rangeLive.to ? occupancy(rangeLive) : null,
    !straddles && prevHasRecords ? occupancy(prev) : null,
    restaurantSummary(range),
    !straddles && prevHasRecords ? restaurantSummary(prev) : null,
  ]);
  const { vsLabel, sinceWords, versus } = compareKit(t, p, days, straddles);
  const earned = ov.earned.total, expenses = ov.expenses.total;
  const roomsBefore = plPrev.revenue.rooms.net;
  const receivedByAccount = ov.received.byAccount.reduce((s, a) => s + Math.max(0, a.received), 0);
  const cashReceived = ov.received.byAccount.filter((a) => a.kind === "CASH").reduce((s, a) => s + Math.max(0, a.received), 0);

  // A figure that is itself a percentage changes in percentage points (40% → 60% is +20 points, not +50%).
  const kpi = (label: string, icon: React.ReactNode, tone: "violet" | "sky" | "emerald" | "amber" | "rose" | "slate", now: number | null, before: number | null, show: (n: number) => string, sub?: string, invert?: boolean, points?: boolean) => ({
    label, icon, tone, value: now === null ? "—" : show(now), sub,
    change: now === null || before === null || straddles ? null : points
      ? (before > 0 ? <Delta value={now - before} unit={` ${t("pts")}`} invert={invert} label={vsLabel} t={t} /> : now > 0 ? <span className="text-xs text-muted-foreground">{t("none {when}", { when: sinceWords })}</span> : null)
      : versus(now, before, invert),
  });
  const kpis = [
    kpi(t("Occupancy"), <BedDouble />, "violet", occNow ? occNow.occupancy : null, occPrev ? occPrev.occupancy : null, (n) => `${Math.round(n)}%`, occNow ? t("{sold} of {sellable} room nights", { sold: occNow.roomNights, sellable: occNow.sellableNights }) : undefined, false, true),
    kpi(t("Nights sold"), <Moon />, "sky", occNow ? occNow.roomsSold : null, occPrev ? occPrev.roomsSold : null, (n) => String(n), occNow ? t("{nights} nights · {short} short time", { nights: occNow.roomNights, short: occNow.dayUse }) : undefined),
    kpi(t("Average room rate"), <Tag />, "emerald", perRoom(ov.earned.rooms, occNow?.roomsSold ?? 0), occPrev ? perRoom(roomsBefore, occPrev.roomsSold) : null, formatTZS, t("room income per night sold")),
    kpi(t("Income per available room"), <Gauge />, "amber", perRoom(ov.earned.rooms, occNow?.sellableNights ?? 0), occPrev ? perRoom(roomsBefore, occPrev.sellableNights) : null, formatTZS, t("room income per room available")),
    kpi(t("Average restaurant order"), <UtensilsCrossed />, "rose", restNow.orders > 0 ? restNow.averageOrder : null, restPrev && restPrev.orders > 0 ? restPrev.averageOrder : null, formatTZS, t.plural(restNow.orders, "{n} order", "{n} orders")),
    kpi(t("Spent of what was earned"), <Receipt />, "rose", percent(expenses, earned), prevHasRecords ? percent(plPrev.expenses, plPrev.netRevenue) : null, (n) => `${n}%`, t("recorded expenses against earned"), true, true),
    kpi(t("Room discounts"), <Percent />, "amber", percent(ov.earned.discounts, ov.earned.rooms + ov.earned.discounts), prevHasRecords ? percent(plPrev.revenue.rooms.discount, roomsBefore + plPrev.revenue.rooms.discount) : null, (n) => `${n}%`, t("of the room price given away"), true, true),
    kpi(t("Cash of the money received"), <Banknote />, "emerald", percent(cashReceived, receivedByAccount), null, (n) => `${n}%`, t("the rest came by mobile money, bank or card")),
  ];

  const closed = closedDays(monthly.daily, today, 8);
  const weekdays = closed.length >= MIN_DAYS_FOR_WEEK ? weekdayAverages(closed.map((d) => ({ date: d.date, value: d.income }))) : null;
  const before = (n: number) => (straddles ? 0 : n);
  const streams: Movement[] = [
    { name: "Rooms", now: ov.earned.rooms, before: before(roomsBefore) },
    { name: "Restaurant & room service", now: ov.earned.restaurant, before: before(plPrev.revenue.restaurant + plPrev.revenue.roomService) },
    { name: "Bar", now: ov.earned.bar, before: before(plPrev.revenue.bar) },
    { name: "Meeting room", now: ov.earned.meeting, before: before(plPrev.revenue.meeting) },
    { name: "Transport & other", now: ov.earned.other, before: before(plPrev.revenue.other + plPrev.revenue.transport) },
  ];
  const categories = moves((spend?.byCategory ?? []).map((x) => ({ name: x.name, amount: x.amount })), straddles ? [] : plPrev.expenseSummary.byCategory.map((x) => ({ name: x.name, amount: x.amount })));

  return (
    <TrendsView t={t} kpis={kpis} months={monthly.months} streams={streams} categories={categories}
      occupancySeries={occNow && days >= 2 ? occNow.series.map((d) => ({ date: d.date, value: d.occupancy })) : undefined}
      weekdays={weekdays} closedDays={closed.length} weeks={Math.min(8, Math.max(1, Math.ceil(closed.length / 7)))}
      links={{ ledger: has("ledger.view", "finance.view") ? "/staff/finance/ledger" : undefined, expenses: has("expenses.record", "expenses.view_all") ? `/staff/expenses?from=${p.from}&to=${p.to}` : undefined }} />
  );
}

// ───────────────────────── Bookings ─────────────────────────

function Mini({ label, value, tone }: { label: string; value: number; tone?: "warn" }) {
  return (
    <div className="flex flex-col-reverse rounded-2xl border border-border/60 bg-muted/20 px-2 py-2">
      <dt className="text-[10.5px] leading-tight text-muted-foreground">{label}</dt>
      <dd className={cn("text-lg font-semibold tabular-nums", tone === "warn" && "text-amber-700 dark:text-amber-300")}>{value}</dd>
    </div>
  );
}

type Movement2 = { newBookings: number; checkIns: number; checkOuts: number; cancellations: number; noShows: number; inHouse: number };

export async function BookingsSection({ c, movement }: { c: HomeContext; movement: Movement2 }) {
  const t = await getT();
  const { p, range, days, has } = c;
  // Charts: the period itself when it is a week or more, otherwise the two weeks up to it.
  const trendRange = days >= 7 ? range : { from: addDays(p.to, -13), to: p.to };
  const [bookings, bookingsTrend] = await Promise.all([bookingActivity(range), days < 7 ? bookingActivity(trendRange) : null]);
  return (
    <Panel title={t("Bookings")} subtitle={periodLabel(p, t)} action={has("reservations.view") ? <PanelLink href="/staff/reservations">{t("Stays")}</PanelLink> : null}>
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)]">
        <div>
          <dl className="mb-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
            <Mini label={t("Bookings made")} value={movement.newBookings} />
            <Mini label={t("Check-ins")} value={movement.checkIns} />
            <Mini label={t("Check-outs")} value={movement.checkOuts} />
            <Mini label={t("Cancelled")} value={movement.cancellations} tone={movement.cancellations ? "warn" : undefined} />
            <Mini label={t("No-shows")} value={movement.noShows} tone={movement.noShows ? "warn" : undefined} />
            <Mini label={t("In house now")} value={movement.inHouse} />
          </dl>
          <p className="mb-1 text-[11px] text-muted-foreground">{t("Bookings made each day")}{bookingsTrend && ` · ${t("the last two weeks, for context")}`}</p>
          <AreaTrend data={(bookingsTrend ?? bookings).series} unit="count" color="#0ea5e9" height={190} />
        </div>
        <div className="overflow-x-auto" role="region" aria-label={t("Bookings by channel")} tabIndex={0}>
          <p className="mb-1 text-[11px] text-muted-foreground">{t("By booking channel — what became of the bookings made")}</p>
          {bookings.sources.length === 0 ? <p className="text-sm text-muted-foreground">{t("No bookings were made in this period.")}</p> : (
            <table className="w-full min-w-[22rem] text-sm">
              <thead><tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th scope="col" className="py-1.5 pr-2 font-medium">{t("Channel")}</th><th scope="col" className="px-1 py-1.5 text-right font-medium">{t.ctx("booking", "Made")}</th><th scope="col" className="px-1 py-1.5 text-right font-medium">{t.ctx("booking", "Arrived")}</th>
                <th className="px-1 py-1.5 text-right font-medium">{t("To come")}</th><th className="px-1 py-1.5 text-right font-medium">{t("Cancelled")}</th><th className="pl-1 py-1.5 text-right font-medium">{t("No-show")}</th>
              </tr></thead>
              <tbody className="divide-y divide-border/50">
                {bookings.sources.map((s) => (
                  <tr key={s.name}><td className="py-1.5 pr-2">{t(s.name)}</td><td className="px-1 text-right tabular-nums font-medium">{s.made}</td><td className="px-1 text-right tabular-nums">{s.arrived}</td>
                    <td className="px-1 text-right tabular-nums text-muted-foreground">{s.waiting}</td><td className={cn("px-1 text-right tabular-nums", s.cancelled > 0 && "text-amber-700 dark:text-amber-300")}>{s.cancelled}</td><td className={cn("pl-1 text-right tabular-nums", s.noShow > 0 && "text-amber-700 dark:text-amber-300")}>{s.noShow}</td></tr>
                ))}
                <tr className="font-medium"><td className="py-1.5 pr-2">{t("Total")}</td><td className="px-1 text-right tabular-nums">{bookings.made}</td><td className="px-1" /><td className="px-1" /><td className="px-1 text-right tabular-nums">{bookings.cancelled}</td><td className="pl-1 text-right tabular-nums">{bookings.noShow}</td></tr>
              </tbody>
            </table>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">{t("Check-ins and check-outs count rooms; bookings count reservations. Cancelled and no-shows above are of the bookings made in this period; in the cards they are counted by arrival date.")}</p>
        </div>
      </div>
    </Panel>
  );
}

/** What a loading part looks like. */
export function PartSkeleton({ height = "h-72" }: { height?: string }) {
  return <div className={cn(height, "animate-pulse rounded-3xl border border-border/60 bg-card/60")} aria-busy="true" />;
}
