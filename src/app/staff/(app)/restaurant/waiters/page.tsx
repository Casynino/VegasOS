import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePagePermission } from "@/server/auth";
import { businessDayConfig, businessToday, getSettings } from "@/server/settings";
import { placesServed, waiterOrders, waiterPerformance } from "@/server/services/waiter-performance";
import { PeriodPicker, readPeriod } from "@/components/staff/finance/finance-nav";
import { AutoSelect } from "@/components/staff/finance/auto-select";
import { PageHeader } from "@/components/staff/page-header";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { GOLD, ShiftPill } from "./parts";
import { WaiterCards } from "./waiter-cards";
import { PlacesView } from "./places-view";
import { WaiterDetailView } from "./waiter-detail";
import { businessRangeBounds } from "@/lib/time/business-date";
import { waiterActivity } from "@/server/services/waiter-activity";
import { MyHistory } from "../waiter/my-record";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Waiters") };
}
export const dynamic = "force-dynamic";

type SearchParams = Record<string, string | string[] | undefined>;
const SORTS = [
  { value: "orders", label: msg("Sort: orders served") },
  { value: "value", label: msg("Sort: value served") },
  { value: "speed", label: msg("Sort: ready → served, quickest first") },
  { value: "name", label: msg("Sort: name (A–Z)") },
] as const;
type Sort = (typeof SORTS)[number]["value"];
const VIEWS = [{ key: "waiters", label: msg("Waiters") }, { key: "places", label: msg("Tables & rooms") }] as const;
/** The period as a heading, in the reader's language ("All time", a day, or "from – to"). */
const periodTitle = (p: { key?: string; from: string; to: string }, t: T) => (p.key === "all" ? t("All time") : p.from === p.to ? t.date(p.from, true) : t.dateRange(p.from, p.to));

/**
 * WAITERS — what every waiter served, for managers, the MD and the owner: one card per waiter
 * (on shift or not, orders served and their value, the tables and rooms, how long serving took,
 * orders still going, cancellations, hand-overs, hours on shift), every table and room with who
 * served it, and — tapping a waiter — their orders one by one. Facts only: no scores, no ranking.
 * An order counts for the waiter serving it (RestaurantOrder.assignedToId, after any hand-over).
 */
export default async function WaitersPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  await requirePagePermission("dashboard.manager", "dashboard.owner", "dashboard.admin");
  const t = await getT();
  const sp = await searchParams;
  const p = readPeriod(sp, await businessToday(), "today", { allTime: true });
  const multiDay = p.from !== p.to;
  const view = sp.view === "places" ? "places" : "waiters";
  const sort: Sort = SORTS.find((s) => s.value === sp.sort)?.value ?? "orders";
  const w = typeof sp.w === "string" && /^[\w-]{1,64}$/.test(sp.w) ? sp.w : null;

  // The address keeps the period, the view and the sort; a waiter's page adds ?w=.
  const period: Record<string, string> = p.key === "custom" ? { from: p.from, to: p.to } : p.key === "today" ? {} : { period: p.key };
  const extra: Record<string, string> = { ...(view !== "waiters" && { view }), ...(sort !== "orders" && { sort }) };
  const link = (more: Record<string, string> = {}) => `/staff/restaurant/waiters?${new URLSearchParams({ ...period, ...extra, ...more })}`;
  const waiterHref = (id: string) => link({ w: id });

  // ── One waiter ──
  if (w) {
    const settings = await getSettings();
    const bounds = businessRangeBounds(p.from, p.to, businessDayConfig(settings));
    const [d, activity] = await Promise.all([
      waiterOrders(w, p.from, p.to),
      // Their history over the period — written by the system as they worked (never typed in).
      waiterActivity(w, { from: bounds.start, to: bounds.end }),
    ]);
    if (!d) notFound();
    return (
      <div className="w-full space-y-5">
        <PageHeader
          eyebrow={`${t("Restaurant & Bar")} · ${t("Waiters")}`}
          title={d.waiter.name}
          description={
            <span className="flex flex-wrap items-center gap-2">
              <span>{t(d.waiter.role)}{d.waiter.isActive ? "" : ` · ${t("account switched off")}`}</span>
              <ShiftPill since={d.waiter.onShiftSince} />
            </span>
          }
          actions={<Link href={link()} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted"><ArrowLeft className="size-4" />{t("All waiters")}</Link>}
        />
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-lg font-semibold">{periodTitle(p, t)}</h2>
          <PeriodPicker allTime current={p.key} from={p.from} to={p.to} keep={{ ...extra, w }} />
        </div>
        <WaiterDetailView d={d} multiDay={multiDay} />
        <section className="space-y-2">
          <div className="flex items-baseline justify-between gap-2 px-1">
            <h3 className="text-sm font-semibold">{t("History")}</h3>
            <span className="text-xs text-muted-foreground">{t("Shifts, orders given and taken, hand-overs, served, bills — as they happened")}</span>
          </div>
          <MyHistory items={activity.history} multiDay={multiDay} more={activity.more} />
        </section>
      </div>
    );
  }

  // ── Every waiter, or every table and room ──
  const [data, places] = await Promise.all([
    view === "waiters" ? waiterPerformance(p.from, p.to) : Promise.resolve(null),
    view === "places" ? placesServed(p.from, p.to) : Promise.resolve(null),
  ]);
  const waiters = data
    ? [...data.waiters].sort((a, b) => (
        sort === "value" ? b.servedValue - a.servedValue
        : sort === "speed" ? (a.readyToServed ?? Number.MAX_VALUE) - (b.readyToServed ?? Number.MAX_VALUE)
        : sort === "name" ? 0
        : b.served - a.served || b.orders - a.orders
      ) || a.name.localeCompare(b.name))
    : [];

  return (
    <div className="w-full space-y-5">
      <PageHeader
        eyebrow={t("Restaurant & Bar")}
        title={t("Waiters")}
        description={t("Who served which table and room, and what each waiter served — straight from the orders. Tap a waiter for their orders one by one.")}
      />

      <div className="flex flex-wrap items-end justify-between gap-3">
        <h2 className="text-lg font-semibold">{periodTitle(p, t)}</h2>
        <PeriodPicker allTime current={p.key} from={p.from} to={p.to} keep={extra} />
      </div>

      <div className="flex flex-wrap items-center justify-between gap-2">
        <nav aria-label={t("View")} className="inline-flex gap-1 rounded-2xl border border-border/70 bg-card p-1">
          {VIEWS.map((v) => (
            <Link key={v.key} href={`/staff/restaurant/waiters?${new URLSearchParams({ ...period, ...(v.key !== "waiters" && { view: v.key }), ...(sort !== "orders" && { sort }) })}`}
              aria-current={view === v.key ? "page" : undefined}
              className={cn("rounded-xl px-3.5 py-1.5 text-sm font-medium transition", view === v.key ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
              {t(v.label)}
            </Link>
          ))}
        </nav>
        {view === "waiters" && (
          <form className="flex items-center">
            {Object.entries(period).map(([k, v]) => <input key={k} type="hidden" name={k} value={v} />)}
            <AutoSelect name="sort" value={sort} label={t("Sort the waiters")} options={SORTS.map((s) => ({ value: s.value, label: t(s.label) }))} className="min-w-56" />
          </form>
        )}
      </div>

      {data && (
        <>
          <section className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-border/70 bg-border/60 sm:grid-cols-3 xl:grid-cols-6">
            <Figure label={t("On shift now")} value={t("{n} of {total}", { n: data.totals.onShift, total: data.waiters.filter((x) => !x.outsideTeam).length })} sub={t("waiters")} />
            <Figure label={t("Orders served")} value={String(data.totals.served)} sub={t.plural(data.totals.orders, "{n} order in all", "{n} orders in all")} />
            <Figure label={t("Value served")} value={formatTZS(data.totals.servedValue)} tone={GOLD} />
            <Figure label={t("Still going")} value={String(data.totals.going)} sub={t("not served yet")} />
            <Figure label={t("Cancelled")} value={String(data.totals.cancelled)} />
            <Figure label={t("No waiter")} value={String(data.noWaiter.orders)}
              sub={data.noWaiter.orders ? t("{n} still going · {value} served", { n: data.noWaiter.going, value: formatTZS(data.noWaiter.value) }) : t("every order had a waiter")}
              tone={data.noWaiter.orders ? "text-amber-700 dark:text-amber-300" : undefined} />
          </section>
          <WaiterCards waiters={waiters} href={waiterHref} />
        </>
      )}

      {places && <PlacesView places={places} href={waiterHref} multiDay={multiDay} />}

      <p className="text-[11px] text-muted-foreground">
        {t("An order counts for the waiter serving it (after any hand-over), on its hotel day. Served = brought to the customer; value = the served orders' totals.")}{" "}
        {t("Ready → served runs from the kitchen marking it ready to the waiter marking it served. Payments are recorded at the Restaurant Counter.")}
      </p>
    </div>
  );
}

function Figure({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0 bg-card px-4 py-3.5">
      <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate text-xl font-semibold tabular-nums", tone)}>{value}</p>
      {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}
