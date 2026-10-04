import type { Metadata } from "next";
import Link from "next/link";
import { BedDouble, CheckCircle2, History, Receipt, Search, ShoppingBag, Store, UtensilsCrossed, XCircle } from "lucide-react";
import { redirect } from "next/navigation";
import { can, requirePagePermission } from "@/server/auth";
import { worksWaiterShift } from "@/lib/permissions";
import { businessToday } from "@/server/settings";
import { DECLINED, deliveryPlace, restaurantOrderHistory } from "@/server/services/restaurant";
import { addDays } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { inHouseGuestIds, isHotelOrder, portalAccess } from "../portal/data";

export const metadata: Metadata = { title: "Order history" };
export const dynamic = "force-dynamic";

const TZ = "Africa/Dar_es_Salaam";
const time = (d: Date) => d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", timeZone: TZ });
const dayLabel = (d: Date) => d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", timeZone: TZ });
const short = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;
const RANGES = [["today", "Today"], ["yesterday", "Yesterday"], ["7d", "Last 7 days"], ["30d", "Last 30 days"]] as const;
const STATUSES = [["all", "All"], ["done", "Done"], ["cancelled", "Cancelled & declined"]] as const;
const TYPE_ICON = { ROOM_SERVICE: BedDouble, DINE_IN: UtensilsCrossed, TAKEAWAY: ShoppingBag, PICKUP: Store } as const;

/** Every finished, cancelled and declined order — for the record, for every department. */
export default async function OrderHistoryListPage({ searchParams }: PageProps<"/staff/restaurant/history">) {
  const user = await requirePagePermission("restaurant.orders", "kitchen.orders", "restaurant.menu");
  const { seesMoney, role, perms } = portalAccess(user);
  const boss = can(user, "dashboard.manager") || can(user, "dashboard.owner") || can(user, "dashboard.admin");
  // A waiter's history is for managers and the MD (the Waiters page) — not on the waiter's phone (owner, 2026-10-04).
  if (!boss && !perms.device && worksWaiterShift(user.permissions)) redirect("/staff/restaurant");
  // Staff who see money look at one day at a time; weeks and months are for managers, the MD and the owner.
  const ranges = boss || !seesMoney ? RANGES : RANGES.filter(([k]) => k === "today" || k === "yesterday");
  const sp = await searchParams;
  const range = (ranges.find(([k]) => k === sp.range)?.[0] ?? "today") as (typeof RANGES)[number][0];
  const status = (STATUSES.find(([k]) => k === sp.status)?.[0] ?? "all") as (typeof STATUSES)[number][0];
  const q = typeof sp.q === "string" ? sp.q.slice(0, 60) : "";
  const today = await businessToday();
  const from = range === "today" ? today : range === "yesterday" ? addDays(today, -1) : addDays(today, range === "7d" ? -6 : -29);
  const to = range === "yesterday" ? addDays(today, -1) : today;
  // Reception keeps the hotel's own orders only (rooms, reception, room bills) — the rest is the restaurant's.
  const inHouse = role === "desk" ? await inHouseGuestIds() : undefined;
  const orders = (await restaurantOrderHistory({ from, to, status, q })).filter((o) => role !== "desk" || isHotelOrder(o, inHouse));
  const done = orders.filter((o) => o.status !== "CANCELLED");
  const cancelled = orders.filter((o) => o.status === "CANCELLED");
  const declined = cancelled.filter((o) => o.cancelReason?.startsWith(DECLINED));
  const href = (patch: Record<string, string>) => `/staff/restaurant/history?${new URLSearchParams({ range, status, ...(q && { q }), ...patch })}`;
  // Grouped by hotel day, newest first.
  const days = new Map<string, typeof orders>();
  for (const o of orders) { const k = o.businessDate.toISOString().slice(0, 10); days.set(k, [...(days.get(k) ?? []), o]); }

  return (
    <div className="w-full space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[oklch(0.72_0.11_80)]">Restaurant</p>
          <h1 className="text-[clamp(1.4rem,2vw,1.75rem)] font-semibold tracking-tight">Order history</h1>
          <p className="mt-1 text-sm text-muted-foreground">Every finished, cancelled and declined order — for the record. Open one for its receipt and every step.</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="inline-flex gap-1 rounded-2xl border border-border/60 bg-card p-1">
          {ranges.map(([k, label]) => (
            <Link key={k} href={href({ range: k })} className={cn("rounded-xl px-3 py-1.5 text-sm font-medium transition", range === k ? "bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-[oklch(0.2_0.03_60)]" : "text-muted-foreground hover:text-foreground")}>{label}</Link>
          ))}
        </div>
        <div className="inline-flex gap-1 rounded-2xl border border-border/60 bg-card p-1">
          {STATUSES.map(([k, label]) => (
            <Link key={k} href={href({ status: k })} className={cn("rounded-xl px-3 py-1.5 text-sm font-medium transition", status === k ? "bg-muted text-foreground" : "text-muted-foreground hover:text-foreground")}>{label}</Link>
          ))}
        </div>
        <form action="/staff/restaurant/history" className="relative ml-auto w-full sm:w-72">
          <input type="hidden" name="range" value={range} /><input type="hidden" name="status" value={status} />
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <input name="q" defaultValue={q} placeholder="Order no., customer, table or room" className="h-11 w-full rounded-2xl border border-border/60 bg-card pl-10 pr-3 text-sm outline-none focus:border-foreground/30" />
        </form>
      </div>

      {/* The numbers */}
      <div className={cn("grid grid-cols-2 gap-3", seesMoney ? "lg:grid-cols-4" : "lg:grid-cols-3")}>
        {[
          ["Orders", String(orders.length), "text-foreground"],
          ["Done", String(done.length), "text-emerald-400"],
          ["Cancelled / declined", `${cancelled.length}${declined.length ? ` · ${declined.length} declined` : ""}`, "text-rose-400"],
          ...(seesMoney ? [["Sales (done)", formatTZS(done.reduce((t, o) => t + o.total, 0)), "text-[oklch(0.8_0.11_82)]"]] : []),
        ].map(([label, value, tone]) => (
          <div key={label} className="rounded-3xl border border-border/60 bg-card p-4">
            <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
            <p className={cn("mt-1 text-2xl font-semibold tabular-nums", tone)}>{value}</p>
          </div>
        ))}
      </div>

      {/* The orders, day by day */}
      {orders.length === 0 ? (
        <div className="grid place-items-center gap-2 rounded-3xl border border-dashed border-border/70 px-6 py-16 text-center text-sm text-muted-foreground">
          <History className="size-7 opacity-50" />No orders here{q ? ` matching “${q}”` : ""}.
        </div>
      ) : [...days.entries()].map(([day, list]) => (
        <section key={day}>
          <h2 className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
            <span>{dayLabel(list[0].businessDate)}</span><span className="tracking-normal">{list.length} order{list.length === 1 ? "" : "s"}</span>
          </h2>
          <ul className="overflow-hidden rounded-3xl border border-border/60 bg-card">
            {list.map((o) => {
              const Icon = TYPE_ICON[o.type] ?? UtensilsCrossed;
              const isDeclined = o.status === "CANCELLED" && o.cancelReason?.startsWith(DECLINED);
              const statusBadge = o.status === "CANCELLED"
                ? { label: isDeclined ? "Declined" : "Cancelled", tone: "bg-rose-500/12 text-rose-300", icon: XCircle }
                : o.status === "DELIVERED" ? { label: "Served · to pay", tone: "bg-amber-500/15 text-amber-300", icon: CheckCircle2 }
                : { label: "Completed", tone: "bg-emerald-500/12 text-emerald-300", icon: CheckCircle2 };
              const who = o.status === "CANCELLED" ? o.cancelledBy?.fullName : (o.deliveredBy ?? o.readyBy ?? o.acceptedBy ?? o.createdBy)?.fullName;
              const count = o.items.reduce((t, i) => t + i.quantity, 0);
              return (
                <li key={o.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-border/50 px-4 py-3 last:border-b-0 hover:bg-muted/30">
                  <span className="w-12 shrink-0 text-sm tabular-nums text-muted-foreground">{time(o.cancelledAt ?? o.completedAt ?? o.deliveredAt ?? o.createdAt)}</span>
                  <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-muted text-muted-foreground"><Icon className="size-4" /></span>
                  <div className="min-w-0 flex-1 basis-56 leading-tight">
                    <p className="truncate text-sm font-semibold">{deliveryPlace(o)} <span className="font-mono text-[11px] font-normal text-muted-foreground">{short(o.number)}</span></p>
                    <p className="truncate text-xs text-muted-foreground">{o.customerName ?? o.reservation?.guest.fullName ?? "Walk-in"} · {count} item{count === 1 ? "" : "s"}: {o.items.map((i) => `${i.quantity > 1 ? `${i.quantity}× ` : ""}${i.name}`).join(", ")}</p>
                    {o.status === "CANCELLED" && o.cancelReason && <p className="mt-0.5 truncate text-xs text-rose-300">{o.cancelReason.replace(`${DECLINED} — `, "")}</p>}
                  </div>
                  <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-1 text-[11px] font-semibold", statusBadge.tone)}><statusBadge.icon className="size-3.5" />{statusBadge.label}</span>
                  {seesMoney && <span className={cn("w-28 shrink-0 text-right text-sm font-semibold tabular-nums", o.status === "CANCELLED" && "text-muted-foreground line-through")}>{formatTZS(o.total)}</span>}
                  <span className="hidden w-24 shrink-0 truncate text-xs text-muted-foreground xl:inline">{who?.replace(/\s*\(.*\)/, "") ?? "—"}</span>
                  <span className="flex shrink-0 items-center gap-1">
                    {o.status !== "CANCELLED" && <Link href={`/staff/restaurant-bill?order=${o.id}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border/60 px-2.5 text-xs font-semibold text-[oklch(0.8_0.11_82)] hover:bg-muted"><Receipt className="size-3.5" />Receipt</Link>}
                    <Link href={`/staff/restaurant/orders/${o.id}`} className="inline-flex h-8 items-center gap-1 rounded-lg border border-border/60 px-2.5 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"><History className="size-3.5" />Steps</Link>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
      ))}
    </div>
  );
}
