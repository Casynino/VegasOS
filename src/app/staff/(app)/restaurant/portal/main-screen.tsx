"use client";

import Link from "next/link";
import { Armchair, Banknote, BedDouble, Globe, HandCoins, Hotel, ReceiptText, ShoppingBag, Smartphone, Users } from "lucide-react";
import { cn } from "@/lib/utils";
import type { MoneySummary, PortalOrder } from "./types";

/** The Restaurant Counter's own figures (the shared account) — loaded on the server only for it (main-screen-data.ts). */
export type MainScreenData = {
  /** The restaurant's collections today — recorded at the Counter (and any older or reception ones): payments still to confirm included, reversed ones left out. */
  collected: { total: number; payments: number; toConfirm: number; toConfirmCount: number; reversed: number; byKind: { name: string; amount: number }[] };
  /** Not shown: waiters are not collectors any more (the Counter records the payments). Optional so it can be dropped from main-screen-data.ts. */
  waiters?: { id: string; name: string; received: number; payments: number; toConfirm: number }[];
  /** Tables that can take customers (active, not blocked): with a customer now, and those who asked for the bill. */
  tables: { total: number; busy: number; billAsked: number };
  /** Waiters with an open restaurant shift (first names). */
  onShift: string[];
  /** The hotel day so far: orders (not cancelled) and their value, done, cancelled, average preparation. */
  today: { orders: number; value: number; done: number; cancelled: number; avgPrep: number | null };
  /** Orders the customer already paid online (proof sent), still to confirm from the proof — never collected again (only when they could not be recorded automatically). */
  online?: { count: number; amount: number };
  /** Paid online (LIPA) today — recorded automatically — and how many never reached the account ("Payment not received"). */
  paidOnline?: { count: number; amount: number; notReceived: number };
};
type OrderPlace = "tables" | "rooms" | "online" | "counter";

const tzs = (v: number) => `TZS ${v.toLocaleString("en-US")}`;
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

type Cell = { label: string; icon: React.ReactNode; tone: string; value: string; unit?: string; sub: React.ReactNode; href?: string };

/**
 * The Restaurant Counter, at a glance, in one small band (the same look as the portal's money
 * band): the restaurant's money today — collected, to confirm (the Counter confirms them, the orders
 * paid online from their proof included), still to collect, on room bills — then the tables with
 * customers and the waiters on shift. Each figure from the real records.
 */
export function MainScreenStrip({ data, money }: { data: MainScreenData; money: MoneySummary | null }) {
  const c = data.collected;
  const t = data.tables;
  const on = data.online ?? { count: 0, amount: 0 };
  const po = data.paidOnline ?? { count: 0, amount: 0, notReceived: 0 };
  // Still to collect leaves the online-paid ones out — they are confirmed, not collected again.
  const toCollect = Math.max(0, (money?.toCollect ?? 0) - on.amount);
  const toCollectOrders = Math.max(0, (money?.toCollectOrders ?? 0) - on.count);
  const cells: Cell[] = [
    {
      label: "Collected today", icon: <Banknote />, tone: "bg-emerald-500/15 text-emerald-300", value: tzs(c.total), href: "/staff/collections?period=today",
      sub: c.payments
        ? <>{plural(c.payments, "payment")}{c.byKind.length ? ` · ${c.byKind.map((k) => `${k.name} ${k.amount.toLocaleString("en-US")}`).join(" · ")}` : ""}</>
        : "No payment received yet today",
    },
    {
      // Paid online (LIPA): counted automatically — nothing to confirm; "Not received" on the order or in Collections if the money is missing.
      label: "Paid by phone today", icon: <Smartphone />, tone: "bg-sky-500/15 text-sky-300", value: tzs(po.amount), href: "/staff/collections?period=today",
      sub: po.count || po.notReceived
        ? <>{plural(po.count, "order")} · counted automatically{po.notReceived ? <span className="font-medium text-rose-300"> · {po.notReceived} not received</span> : ""}</>
        : "None yet today",
    },
    {
      label: "Still to collect", icon: <HandCoins />, tone: "bg-rose-500/15 text-rose-300", value: tzs(toCollect),
      sub: toCollectOrders ? `${plural(toCollectOrders, "order")} not paid yet` : "All paid",
    },
    {
      label: "On room bills", icon: <Hotel />, tone: "bg-violet-500/15 text-violet-300", value: tzs(money?.onRooms ?? 0),
      sub: money?.rooms ? `${plural(money.rooms, "room")} · paid at check-out` : "None today",
    },
    {
      label: "Tables", icon: <Armchair />, tone: "bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.84_0.11_82)]", value: `${t.busy} of ${t.total}`, unit: "with customers", href: "/staff/restaurant/tables",
      sub: t.billAsked ? <span className="font-medium text-amber-300">{plural(t.billAsked, "table")} asked for the bill</span> : `${Math.max(0, t.total - t.busy)} free`,
    },
    {
      label: "Waiters on shift", icon: <Users />, tone: "bg-sky-500/15 text-sky-300", value: String(data.onShift.length), unit: data.onShift.length === 1 ? "waiter" : "waiters",
      sub: data.onShift.length ? `${data.onShift.slice(0, 3).join(", ")}${data.onShift.length > 3 ? ` +${data.onShift.length - 3}` : ""}` : "Nobody on shift yet",
    },
  ];
  return (
    <section aria-label="The restaurant today" className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-border/70 bg-border/60 sm:grid-cols-3 2xl:grid-cols-6">
      {cells.map((x) => {
        const body = (
          <>
            <p className="flex items-center gap-2">
              <span className={cn("grid size-6 shrink-0 place-items-center rounded-md [&_svg]:size-3.5", x.tone)}>{x.icon}</span>
              <span className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{x.label}</span>
            </p>
            <p className="mt-2 flex items-baseline gap-1.5 whitespace-nowrap">
              <span className={cn("font-semibold leading-none tracking-tight tabular-nums", x.unit ? "text-2xl" : "text-xl")}>{x.value}</span>
              {x.unit && <span className="text-xs text-muted-foreground">{x.unit}</span>}
            </p>
            <div className="mt-1.5 truncate text-xs text-muted-foreground" title={typeof x.sub === "string" ? x.sub : undefined}>{x.sub}</div>
          </>
        );
        return x.href
          ? <Link key={x.label} href={x.href} className="min-w-0 bg-card px-4 py-3.5 transition-colors hover:bg-muted/40">{body}</Link>
          : <div key={x.label} className="min-w-0 bg-card px-4 py-3.5">{body}</div>;
      })}
    </section>
  );
}

const PLACE: Record<OrderPlace, { label: string; short?: string; icon: React.ReactNode; tone: string; bar: string }> = {
  tables: { label: "Tables", icon: <Armchair />, tone: "bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.84_0.11_82)]", bar: "bg-[oklch(0.78_0.12_80)]" },
  rooms: { label: "Rooms", icon: <BedDouble />, tone: "bg-violet-500/15 text-violet-300", bar: "bg-violet-400" },
  online: { label: "Online", icon: <Globe />, tone: "bg-sky-500/15 text-sky-300", bar: "bg-sky-400" },
  counter: { label: "Counter & take away", short: "Counter", icon: <ShoppingBag />, tone: "bg-rose-500/15 text-rose-300", bar: "bg-rose-400" },
};

const ONLINE = ["WEBSITE", "PUBLIC_QR"];
const placeOf = (o: PortalOrder): OrderPlace =>
  o.type === "ROOM_SERVICE" ? "rooms" : o.location?.kind === "TABLE" ? "tables" : ONLINE.includes(o.source) ? "online" : "counter";

/**
 * The orders on the board (open ones and today's), by where they came from — one slim band across the
 * page: at the tables, from the rooms, online (the website and the public menu), at the counter / take
 * away; each with its count, its value and a thin line for its share.
 */
export function OrdersBar({ orders }: { orders: PortalOrder[] }) {
  const live = orders.filter((o) => o.status !== "CANCELLED");
  const sources = (["tables", "rooms", "online", "counter"] as OrderPlace[]).map((key) => {
    const mine = live.filter((o) => placeOf(o) === key);
    return { key, orders: mine.length, value: mine.reduce((t, o) => t + (o.total ?? 0), 0) };
  });
  const all = live.length;
  const value = sources.reduce((t, s) => t + s.value, 0);
  return (
    <section aria-label="Orders by place" className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border/70 bg-card sm:grid-cols-[auto_repeat(4,minmax(0,1fr))]">
      <div className="col-span-2 flex items-center gap-2.5 border-b border-border/60 px-4 py-2.5 sm:col-span-1 sm:border-b-0 sm:pr-5">
        <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-emerald-500/15 text-emerald-300 [&_svg]:size-3.5"><ReceiptText /></span>
        <div className="leading-tight">
          <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">Orders</p>
          <p className="flex items-baseline gap-1.5 whitespace-nowrap"><span className="text-base font-semibold tabular-nums">{all}</span><span className="text-[11px] tabular-nums text-muted-foreground">TZS {value.toLocaleString("en-US")}</span></p>
        </div>
      </div>
      {sources.map((s, i) => {
        const p = PLACE[s.key];
        const share = all ? Math.round((s.orders / all) * 100) : 0;
        return (
          <div key={s.key} title={`${p.label}: ${s.orders} order${s.orders === 1 ? "" : "s"} · TZS ${s.value.toLocaleString("en-US")} · ${share}%`}
            className={cn("relative flex min-w-0 items-center gap-2.5 px-4 py-2.5 sm:border-l sm:border-border/60 sm:px-3 xl:px-4", i % 2 === 1 && "border-l border-border/60", i >= 2 && "border-t border-border/60 sm:border-t-0", !s.orders && "opacity-60")}>
            {/* Narrower screens (an iPad): no icon, a short name — the numbers keep their room. */}
            <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg sm:hidden xl:grid [&_svg]:size-3.5", p.tone)}>{p.icon}</span>
            <div className="min-w-0 leading-tight">
              <p className="truncate text-[11px] text-muted-foreground">{p.short ? <><span className="xl:hidden">{p.short}</span><span className="hidden xl:inline">{p.label}</span></> : p.label}</p>
              <p className="flex items-baseline gap-1.5 whitespace-nowrap"><span className="text-base font-semibold tabular-nums">{s.orders}</span><span className="truncate text-[11px] tabular-nums text-muted-foreground">TZS {s.value.toLocaleString("en-US")}</span></p>
            </div>
            <span aria-hidden className="absolute inset-x-4 bottom-0 h-0.5 sm:inset-x-3 xl:inset-x-4 overflow-hidden rounded-full bg-muted"><span className={cn("block h-full rounded-full", p.bar)} style={{ width: `${share}%` }} /></span>
          </div>
        );
      })}
    </section>
  );
}
