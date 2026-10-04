import Link from "next/link";
import { Armchair, BedDouble, ChevronRight, UserRound } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTZS } from "@/lib/format";
import type { WaiterRow } from "@/server/services/waiter-performance";
import { Fact, GOLD, hours, initials, mins, plural, SettleBar, ShiftPill } from "./parts";

const CHIPS = 8;

/** One card per waiter — what they served in the period, as facts. Tapping it opens their orders. */
export function WaiterCards({ waiters, href }: { waiters: WaiterRow[]; href: (id: string) => string }) {
  if (!waiters.length) {
    return (
      <div className="grid place-items-center gap-2 rounded-3xl border border-dashed border-border/70 px-6 py-16 text-center text-sm text-muted-foreground">
        <UserRound className="size-7 opacity-50" />No waiters yet — give a member of staff a waiter role in Staff &amp; roles.
      </div>
    );
  }
  return (
    <div className="grid gap-3 md:grid-cols-2 2xl:grid-cols-3">
      {waiters.map((w) => <WaiterCard key={w.id} w={w} href={href(w.id)} />)}
    </div>
  );
}

function WaiterCard({ w, href }: { w: WaiterRow; href: string }) {
  const idle = w.orders === 0 && w.cancelled === 0;
  const places = [...w.tables.map((t) => ({ key: `t-${t}`, label: t, room: false })), ...w.rooms.map((r) => ({ key: `r-${r}`, label: `Room ${r}`, room: true }))];
  const t = w.transfers;
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
          <p className="truncate text-xs text-muted-foreground">{w.role}{w.outsideTeam ? " · not on the waiter list now" : ""}</p>
          <div className="mt-1.5"><ShiftPill since={w.onShiftSince} /></div>
        </div>
        <ChevronRight className="mt-1 size-4 shrink-0 text-muted-foreground transition group-hover:translate-x-0.5 group-hover:text-foreground" />
      </div>

      {/* What they served */}
      <div className="grid grid-cols-2 gap-3 rounded-2xl bg-muted/40 p-3">
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Orders served</p>
          <p className="mt-0.5 text-2xl font-semibold tabular-nums">{w.served}</p>
          <p className="truncate text-[11px] text-muted-foreground">{plural(w.customers, "customer")}</p>
        </div>
        <div className="min-w-0">
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Value served</p>
          <p className={cn("mt-0.5 truncate text-lg font-semibold tabular-nums", GOLD)}>{formatTZS(w.servedValue)}</p>
          <p className="truncate text-[11px] tabular-nums text-muted-foreground">Food {w.food.toLocaleString("en-US")} · Drinks {w.drinks.toLocaleString("en-US")}</p>
        </div>
      </div>

      {/* Tables and rooms they served */}
      <div className="min-w-0">
        <p className="mb-1.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">Tables &amp; rooms</p>
        {places.length ? (
          <div className="flex flex-wrap gap-1.5">
            {places.slice(0, CHIPS).map((p) => (
              <span key={p.key} className="inline-flex max-w-full items-center gap-1 rounded-full border border-border/70 bg-background/60 px-2 py-0.5 text-[11px] font-medium">
                {p.room ? <BedDouble className="size-3 shrink-0 text-violet-500" /> : <Armchair className="size-3 shrink-0 text-sky-500" />}
                <span className="truncate">{p.label}</span>
              </span>
            ))}
            {places.length > CHIPS && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">+{places.length - CHIPS} more</span>}
          </div>
        ) : <p className="text-[11px] text-muted-foreground">{idle ? "No orders in this period." : "Counter and take-out orders only."}</p>}
      </div>

      {/* The other facts */}
      <div className="grid grid-cols-3 gap-x-3 gap-y-2.5">
        <Fact label="Ready → served" value={mins(w.readyToServed)} sub={w.readyTimed ? `avg of ${w.readyTimed}` : undefined} />
        <Fact label="Order → served" value={mins(w.orderToServed)} sub={w.orderTimed ? `avg of ${w.orderTimed}` : undefined} />
        <Fact label="On shift" value={hours(w.shiftMinutes)} />
        <Fact label="Still going" value={w.going} tone={w.going ? "text-sky-700 dark:text-sky-300" : undefined} />
        <Fact label="Cancelled" value={w.cancelled} tone={w.cancelled ? "text-rose-700 dark:text-rose-300" : undefined} />
        <Fact label="Handed over" value={`${t.ordersIn} in · ${t.ordersOut} out`} sub={t.placesIn || t.placesOut ? `tables/rooms ${t.placesIn} in · ${t.placesOut} out` : "orders"} />
      </div>

      <div className="mt-auto border-t border-border/60 pt-3">
        <SettleBar s={w.settle} />
      </div>
    </Link>
  );
}
