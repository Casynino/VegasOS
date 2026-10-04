import Link from "next/link";
import { ArrowLeftRight, Armchair, BedDouble, ChevronRight, Clock, ReceiptText, ShoppingBag, Store } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatBusinessDate, formatDateTime, formatTime, formatTZS } from "@/lib/format";
import { STATUS_LABEL } from "@/server/services/restaurant";
import type { WaiterDetail, WaiterOrder } from "@/server/services/waiter-performance";
import { Fact, GOLD, hours, mins, payLabel, Pill, plural, SettleBar, shortNo } from "./parts";

const PLACE_ICON = { TABLE: Armchair, ROOM: BedDouble, COUNTER: Store, OTHER: ShoppingBag } as const;

/** One waiter over the period: the facts, every order they were responsible for, their hand-overs and shifts. */
export function WaiterDetailView({ d, multiDay }: { d: WaiterDetail; multiDay: boolean }) {
  const f = d.facts;
  const t = d.transfers;
  const days = d.orders.reduce<{ day: string; orders: WaiterOrder[]; value: number }[]>((out, o) => {
    const last = out[out.length - 1];
    const v = o.served ? o.total : 0;
    if (last && last.day === o.day) { last.orders.push(o); last.value += v; } else out.push({ day: o.day, orders: [o], value: v });
    return out;
  }, []);
  const when = (at: Date) => (multiDay ? formatDateTime(at) : formatTime(at));

  return (
    <div className="space-y-5">
      {/* The facts */}
      <section className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-border/70 bg-border/60 sm:grid-cols-3 xl:grid-cols-6">
        <Box label="Orders served" value={String(f.served)} sub={`${plural(f.customers, "customer")}`} />
        <Box label="Value served" value={formatTZS(f.servedValue)} sub={`Food ${f.food.toLocaleString("en-US")} · Drinks ${f.drinks.toLocaleString("en-US")}`} tone={GOLD} />
        <Box label="Ready → served" value={mins(f.readyToServed)} sub={f.readyTimed ? `average of ${plural(f.readyTimed, "order")}` : "No timed orders"} />
        <Box label="Order → served" value={mins(f.orderToServed)} sub={f.orderTimed ? `average of ${plural(f.orderTimed, "order")}` : "No timed orders"} />
        <Box label="Still going · cancelled" value={`${f.going} · ${f.cancelled}`} sub="not served yet · cancelled" />
        <Box label="On shift" value={hours(d.shiftMinutes)} sub={plural(d.shifts.length, "restaurant shift")} />
      </section>

      <section className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">How the served orders were settled</p>
          <SettleBar s={f.settle} />
          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Fact label="Paid" value={formatTZS(f.settle.paid.value)} sub={plural(f.settle.paid.count, "order")} tone="text-emerald-700 dark:text-emerald-300" />
            <Fact label="To confirm" value={formatTZS(f.settle.toConfirm.value)} sub={plural(f.settle.toConfirm.count, "order")} tone="text-amber-800 dark:text-amber-300" />
            <Fact label="On room bills" value={formatTZS(f.settle.onRoom.value)} sub={plural(f.settle.onRoom.count, "order")} tone="text-violet-700 dark:text-violet-300" />
            <Fact label="Still to pay" value={formatTZS(f.settle.unpaid.value)} sub={plural(f.settle.unpaid.count, "order")} tone="text-rose-700 dark:text-rose-300" />
          </div>
          <p className="mt-3 text-[11px] text-muted-foreground">Payments are recorded at the Restaurant Counter — the waiter serves; the money is not theirs to record.</p>
        </div>
        <div className="rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
          <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Tables &amp; rooms served</p>
          {f.tables.length || f.rooms.length ? (
            <div className="flex flex-wrap gap-1.5">
              {f.tables.map((x) => <span key={x} className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/60 px-2 py-0.5 text-[11px] font-medium"><Armchair className="size-3 text-sky-500" />{x}</span>)}
              {f.rooms.map((x) => <span key={x} className="inline-flex items-center gap-1 rounded-full border border-border/70 bg-background/60 px-2 py-0.5 text-[11px] font-medium"><BedDouble className="size-3 text-violet-500" />Room {x}</span>)}
            </div>
          ) : <p className="text-sm text-muted-foreground">No table or room orders in this period.</p>}
          <div className="mt-4 grid grid-cols-2 gap-3">
            <Fact label="Orders handed over" value={`${t.ordersIn} in · ${t.ordersOut} out`} />
            <Fact label="Tables / rooms handed over" value={`${t.placesIn} in · ${t.placesOut} out`} />
          </div>
        </div>
      </section>

      {/* Their orders */}
      <div>
        <h2 className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          <span>Their orders</span><span className="tracking-normal">{plural(d.orders.length, "order")} · newest first</span>
        </h2>
        {d.orders.length === 0 ? (
          <div className="grid place-items-center gap-2 rounded-3xl border border-dashed border-border/70 px-6 py-12 text-center text-sm text-muted-foreground">
            <ReceiptText className="size-7 opacity-50" />No orders with this waiter in this period.
          </div>
        ) : (
          <div className="space-y-3">
            {days.map((day) => (
              <section key={day.day} className="overflow-hidden rounded-3xl border border-border/70 bg-card">
                {multiDay && (
                  <header className="flex items-baseline justify-between gap-2 border-b border-border/60 bg-muted/30 px-4 py-2.5">
                    <p className="text-sm font-semibold">{formatBusinessDate(day.day, true)}<span className="ml-2 text-xs font-normal text-muted-foreground">{plural(day.orders.length, "order")}</span></p>
                    <p className={cn("text-sm font-semibold tabular-nums", GOLD)}>{formatTZS(day.value)}</p>
                  </header>
                )}
                <ul className="divide-y divide-border/50">
                  {day.orders.map((o) => <OrderRow key={o.id} o={o} />)}
                </ul>
              </section>
            ))}
          </div>
        )}
      </div>

      {/* Hand-overs and shifts */}
      <section className="grid gap-3 lg:grid-cols-2">
        <div className="rounded-3xl border border-border/70 bg-card">
          <p className="flex items-center gap-1.5 border-b border-border/60 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"><ArrowLeftRight className="size-3.5" />Hand-overs</p>
          {d.handOvers.length ? (
            <ul className="divide-y divide-border/50">
              {d.handOvers.map((h) => (
                <li key={h.id} className="flex items-start gap-3 px-4 py-2.5 text-sm">
                  <span className="w-14 shrink-0 pt-0.5 text-xs tabular-nums text-muted-foreground">{when(h.at)}</span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate">
                      {h.orderId ? <Link href={`/staff/restaurant/orders/${h.orderId}`} className="font-semibold hover:underline">{h.what}</Link> : <span className="font-semibold">{h.what}</span>}
                      <span className="text-muted-foreground"> · {h.from} → {h.to}</span>
                    </p>
                    {h.reason && <p className="truncate text-xs text-muted-foreground">{h.reason}</p>}
                  </div>
                  <Pill tone={h.direction === "IN" ? "sky" : "muted"}>{h.direction === "IN" ? "Received" : "Handed on"}</Pill>
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-6 text-center text-sm text-muted-foreground">No hand-overs in this period.</p>}
        </div>
        <div className="rounded-3xl border border-border/70 bg-card">
          <p className="flex items-center gap-1.5 border-b border-border/60 px-4 py-3 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground"><Clock className="size-3.5" />Restaurant shifts</p>
          {d.shifts.length ? (
            <ul className="divide-y divide-border/50">
              {d.shifts.map((s) => (
                <li key={s.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                  <span className="tabular-nums">{formatDateTime(s.startedAt)} → {s.endedAt ? formatTime(s.endedAt) : "now"}</span>
                  {s.endedAt ? <span className="text-xs tabular-nums text-muted-foreground">{mins((s.endedAt.getTime() - s.startedAt.getTime()) / 60000)}</span> : <Pill tone="emerald">Open</Pill>}
                </li>
              ))}
            </ul>
          ) : <p className="px-4 py-6 text-center text-sm text-muted-foreground">No restaurant shift in this period.</p>}
        </div>
      </section>
    </div>
  );
}

function Box({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="min-w-0 bg-card px-4 py-3.5">
      <p className="truncate text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate text-lg font-semibold tabular-nums", tone)}>{value}</p>
      {sub && <p className="truncate text-[11px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

/** One order: when, which number, where, who for, what it was worth, its step and how it was paid. */
function OrderRow({ o }: { o: WaiterOrder }) {
  const Icon = PLACE_ICON[o.placeKind];
  const pay = payLabel(o.pay, o);
  const step = o.cancelled ? { label: "Cancelled", tone: "rose" as const } : o.served ? { label: o.status === "COLLECTED" ? "Collected" : "Served", tone: "emerald" as const } : { label: STATUS_LABEL[o.status], tone: "sky" as const };
  const money = o.payments.map((p) => `${p.account}${p.by ? ` · ${p.by}` : ""}${p.broughtBy ? ` · brought by ${p.broughtBy}` : ""}`).join(" · ");
  return (
    <li>
      <Link href={`/staff/restaurant/orders/${o.id}`} className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-4 py-3 hover:bg-muted/30">
        <span className="w-12 shrink-0 text-xs tabular-nums text-muted-foreground">{formatTime(o.createdAt)}</span>
        <span className="grid size-8 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><Icon className="size-4" /></span>
        <div className="min-w-0 flex-1 basis-48 leading-tight">
          <p className="truncate text-sm font-semibold">{o.place} <span className="font-mono text-[11px] font-normal text-muted-foreground">{shortNo(o.number)}</span></p>
          <p className="truncate text-xs text-muted-foreground">
            {o.customer ?? "Walk-in"}{o.phone ? ` · ${o.phone}` : ""} · {plural(o.items, "item")}
            {o.readyToServed != null ? ` · ready → served ${mins(o.readyToServed)}` : ""}
          </p>
          {(money || o.reservation) && <p className="truncate text-[11px] text-muted-foreground">{o.reservation ? `Booking ${o.reservation}` : money}</p>}
        </div>
        <span className="flex shrink-0 flex-wrap items-center gap-1">
          <Pill tone={step.tone}>{step.label}</Pill>
          {!o.cancelled && <Pill tone={pay.tone}>{pay.label}</Pill>}
        </span>
        <span className={cn("w-28 shrink-0 text-right text-sm font-semibold tabular-nums", o.cancelled && "text-muted-foreground line-through")}>{formatTZS(o.total)}</span>
        <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
      </Link>
    </li>
  );
}
