import Link from "next/link";
import { Armchair, BedDouble, ChevronRight, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTZS } from "@/lib/format";
import type { WaiterRow } from "@/server/services/waiter-performance";
import { Fact, GOLD, hours, initials, mins, SettleBar, ShiftPill } from "./parts";
import { getT } from "@/i18n/server";
import type { T } from "@/i18n/translate";

const CHIPS = 8;

/** One card per waiter — what they served in the period, as facts. Tapping it opens their orders. */
export async function WaiterCards({ waiters, href }: { waiters: WaiterRow[]; href: (id: string) => string }) {
  const t = await getT();
  if (!waiters.length) {
    return (
      <div className="grid place-items-center gap-2 rounded-3xl border border-dashed border-border/70 px-6 py-16 text-center text-sm text-muted-foreground">
        <UserRound className="size-7 opacity-50" />{t("No waiters yet — give a member of staff a waiter role in Staff & roles.")}
      </div>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {waiters.map((w) => <WaiterCard key={w.id} w={w} href={href(w.id)} t={t} />)}
    </div>
  );
}

function WaiterCard({ w, href, t }: { w: WaiterRow; href: string; t: T }) {
  const idle = w.orders === 0 && w.cancelled === 0;
  const places = [...w.tables.map((x) => ({ key: `t-${x}`, label: t(x), room: false })), ...w.rooms.map((r) => ({ key: `r-${r}`, label: t("Room {room}", { room: r }), room: true }))];
  const moves = w.transfers;
  return (
    <Link href={href} className={cn(
      "group flex min-w-0 flex-col gap-4 rounded-3xl border border-border/70 bg-card p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04)] transition hover:border-[oklch(0.72_0.11_80)]/50 sm:p-5",
      idle && "opacity-80",
    )}>
      {/* Who, and whether they are on shift now */}
      <div className="flex items-start gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-muted text-sm font-semibold text-muted-foreground">{initials(w.name)}</span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold leading-tight">{w.name}</p>
          <p className="truncate text-xs text-muted-foreground">{t(w.role)}{w.outsideTeam ? ` · ${t("not on the waiter list now")}` : ""}</p>
          <div className="mt-1.5"><ShiftPill since={w.onShiftSince} /></div>
        </div>
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
      </div>

      {/* What they served */}
      <div className="grid grid-cols-2 gap-3 rounded-2xl bg-muted/40 p-3">
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("Orders served")}</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums">{w.served}</p>
          <p className="truncate text-[11px] text-muted-foreground">{t.plural(w.customers, "{n} customer", "{n} customers")}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("Value served")}</p>
          <p className={cn("mt-0.5 truncate text-lg font-semibold tabular-nums", GOLD)}>{formatTZS(w.servedValue)}</p>
          <p className="truncate text-[11px] tabular-nums text-muted-foreground">{t("Food {food} · Drinks {drinks}", { food: w.food.toLocaleString("en-US"), drinks: w.drinks.toLocaleString("en-US") })}</p>
        </div>
      </div>

      {/* Tables and rooms they served */}
      <div className="min-w-0">
        <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("Tables & rooms")}</p>
        {places.length ? (
          <div className="flex flex-wrap gap-1.5">
            {places.slice(0, CHIPS).map((p) => (
              <span key={p.key} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/70 bg-background/60 px-2 py-0.5 text-[11px] font-medium">
                {p.room ? <BedDouble className="size-3 shrink-0 text-violet-500" /> : <Armchair className="size-3 shrink-0 text-sky-500" />}
                <span className="truncate">{p.label}</span>
              </span>
            ))}
            {places.length > CHIPS && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">{t("+{n} more", { n: places.length - CHIPS })}</span>}
          </div>
        ) : <p className="text-[11px] text-muted-foreground">{idle ? t("No orders in this period.") : t("Counter and take-out orders only.")}</p>}
      </div>

      {/* The other facts */}
      <div className="grid grid-cols-3 gap-x-3 gap-y-2.5">
        <Fact label={t("Ready → served")} value={mins(w.readyToServed, t)} sub={w.readyTimed ? t("avg of {n}", { n: w.readyTimed }) : undefined} />
        <Fact label={t("Order → served")} value={mins(w.orderToServed, t)} sub={w.orderTimed ? t("avg of {n}", { n: w.orderTimed }) : undefined} />
        <Fact label={t("On shift")} value={hours(w.shiftMinutes, t)} />
        <Fact label={t("Still going")} value={w.going} tone={w.going ? "text-sky-700 dark:text-sky-300" : undefined} />
        <Fact label={t("Cancelled")} value={w.cancelled} tone={w.cancelled ? "text-rose-700 dark:text-rose-300" : undefined} />
        <Fact label={t("Handed over")} value={t("{received} in · {handed} out", { received: moves.ordersIn, handed: moves.ordersOut })} sub={moves.placesIn || moves.placesOut ? t("tables/rooms {received} in · {handed} out", { received: moves.placesIn, handed: moves.placesOut }) : t("orders")} />
      </div>

      <div className="mt-auto border-t border-border/60 pt-3">
        <SettleBar s={w.settle} />
      </div>
    </Link>
  );
}
