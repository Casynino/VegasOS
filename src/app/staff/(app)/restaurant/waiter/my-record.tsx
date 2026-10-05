"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowRightLeft, Armchair, BedDouble, BellRing, Bike, CheckCheck, ChevronRight, CircleCheck, CirclePlus, CircleX, Clock, Flame, Globe, HandPlatter, LogIn, LogOut, Printer, Store, UtensilsCrossed } from "lucide-react";
import { formatTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { MoneyState, OrderSourceKind, WaiterActivity, WaiterHistoryItem, WaiterOrderRow } from "@/server/services/waiter-activity";
import { plural, STATUS_WORD, tzs } from "./shared";

/**
 * A waiter's own record, built from what they did (never typed in): the shift summary, every order they
 * handled by where it came from, how each is paid (as the Counter recorded it — information only, the
 * waiter never records payments), and their history in time order.
 */

const KIND_ICON: Record<OrderSourceKind, typeof Store> = { TABLE: Armchair, ROOM: BedDouble, ONLINE: Globe, RESTAURANT: UtensilsCrossed };
const KIND_TONE: Record<OrderSourceKind, string> = {
  TABLE: "bg-[oklch(0.72_0.12_80/0.16)] text-[oklch(0.84_0.11_82)]", ROOM: "bg-violet-500/15 text-violet-300",
  ONLINE: "bg-sky-500/15 text-sky-300", RESTAURANT: "bg-rose-500/15 text-rose-300",
};
/** How an order is paid, in plain words — what the Counter recorded. */
const MONEY: Record<MoneyState, { text: string; tone: string }> = {
  PAID: { text: "Paid", tone: "bg-emerald-500/12 text-emerald-300" },
  PAID_ONLINE: { text: "Paid by phone", tone: "bg-sky-500/12 text-sky-300" },
  ROOM_BILL: { text: "Charged to room", tone: "bg-violet-500/12 text-violet-300" },
  PARTLY_PAID: { text: "Part-paid", tone: "bg-amber-500/15 text-amber-300" },
  UNPAID: { text: "Not paid yet", tone: "bg-rose-500/12 text-rose-300" },
  CANCELLED: { text: "Cancelled", tone: "bg-muted text-muted-foreground" },
  NOT_RECEIVED: { text: "Payment not received", tone: "bg-rose-500/12 text-rose-300" },
};
const DONE_WORD: Record<string, string> = { COMPLETED: "Done", COLLECTED: "Done", CANCELLED: "Cancelled" };
const stepWord = (s: string) => STATUS_WORD[s] ?? DONE_WORD[s] ?? s;

const Label = ({ children, className }: { children: React.ReactNode; className?: string }) => (
  <p className={cn("text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground", className)}>{children}</p>
);

/** "My shift so far": what they handled — counts, then the value of those orders and how they are paid. */
export function ShiftSummary({ s, onShift }: { s: WaiterActivity["summary"]; onShift: boolean }) {
  const tiles = [
    { label: "Orders", value: s.orders, sub: s.pending ? `${s.pending} still with you` : s.served ? `${s.served} served` : "None yet", icon: HandPlatter, tone: "bg-emerald-500/15 text-emerald-300" },
    { label: "Tables", value: s.tables, sub: s.tableNames.slice(0, 2).join(" · ") || "None yet", icon: Armchair, tone: KIND_TONE.TABLE },
    { label: "Rooms", value: s.rooms, sub: s.rooms ? plural(s.rooms, "room order") : "None yet", icon: BedDouble, tone: KIND_TONE.ROOM },
    { label: "Online", value: s.online, sub: s.online ? plural(s.online, "online order") : "None yet", icon: Globe, tone: KIND_TONE.ONLINE },
  ];
  const how = [
    s.created && `${s.created} created`, s.assigned && `${s.assigned} given to you`, s.claimed && `${s.claimed} claimed`, s.completed && `${s.completed} done`,
  ].filter(Boolean).join(" · ");
  return (
    <section className="rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <Label>{onShift ? "My shift so far" : "Today so far"}</Label>
        {how && <p className="text-[11px] text-muted-foreground">{how}</p>}
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="flex items-center gap-2.5 rounded-2xl bg-muted/40 px-3 py-2.5 ring-1 ring-inset ring-border/60">
            <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl [&_svg]:size-4", t.tone)}><t.icon /></span>
            <span className="min-w-0 leading-tight">
              <span className="block text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t.label}</span>
              <span className="block text-lg font-semibold tabular-nums">{t.value}</span>
              <span className="block truncate text-[11px] text-muted-foreground">{t.sub}</span>
            </span>
          </div>
        ))}
      </div>
      {s.orders > 0 && (
        <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-1.5 border-t border-border/60 pt-3 text-xs sm:grid-cols-5">
          {[
            ["Orders' value", s.value], ["Paid at the Counter", s.paidCounter], ["Charged to rooms", s.onRooms], ["Paid by phone", s.paidOnline], ["Still to pay", s.unpaid],
          ].map(([k, v]) => (
            <div key={k as string} className="min-w-0">
              <dt className="truncate text-muted-foreground">{k}</dt>
              <dd className={cn("font-semibold tabular-nums", k === "Still to pay" && (v as number) > 0 && "text-rose-300")}>{tzs(v as number)}</dd>
            </div>
          ))}
        </dl>
      )}
    </section>
  );
}

const FILTERS: { key: "ALL" | OrderSourceKind; label: string }[] = [
  { key: "ALL", label: "All" }, { key: "TABLE", label: "Tables" }, { key: "ROOM", label: "Rooms" }, { key: "ONLINE", label: "Online" }, { key: "RESTAURANT", label: "Restaurant" },
];

/** Every order they handled (this shift / today), newest first — tap one to open it. */
export function MyOrdersList({ rows, onShift }: { rows: WaiterOrderRow[]; onShift: boolean }) {
  const [f, setF] = useState<"ALL" | OrderSourceKind>("ALL");
  const list = f === "ALL" ? rows : rows.filter((r) => r.kind === f);
  return (
    <section className="space-y-2.5">
      <div className="flex flex-wrap items-center gap-2 px-1">
        <Label>{onShift ? "Handled this shift" : "Handled today"}</Label>
        <span className="text-xs tabular-nums text-muted-foreground">{rows.length}</span>
        <div className="ml-auto flex flex-wrap gap-1">
          {FILTERS.map((x) => {
            const n = x.key === "ALL" ? rows.length : rows.filter((r) => r.kind === x.key).length;
            return (
              <button key={x.key} type="button" onClick={() => setF(x.key)} aria-pressed={f === x.key}
                className={cn("inline-flex h-7 items-center gap-1 rounded-full border px-2.5 text-[11px] font-medium transition",
                  f === x.key ? "border-[oklch(0.75_0.12_80/0.6)] bg-[oklch(0.72_0.12_80/0.12)] text-foreground" : "border-border/70 text-muted-foreground hover:bg-muted")}>
                {x.label}<span className="tabular-nums opacity-70">{n}</span>
              </button>
            );
          })}
        </div>
      </div>
      {list.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border/80 px-4 py-8 text-center text-sm text-muted-foreground">Nothing here yet — the orders you take, serve or are given show up by themselves.</p>
      ) : (
        <ul className="overflow-hidden rounded-3xl border border-border/70 bg-card">
          {list.map((r) => <OrderLine key={r.id} r={r} />)}
        </ul>
      )}
    </section>
  );
}

function OrderLine({ r }: { r: WaiterOrderRow }) {
  const Icon = KIND_ICON[r.kind];
  const m = MONEY[r.money];
  return (
    <li className="border-b border-border/50 last:border-b-0">
      <Link href={`/staff/restaurant/orders/${r.id}`} className="flex items-center gap-3 px-4 py-3 transition-colors hover:bg-muted/30">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl [&_svg]:size-4", KIND_TONE[r.kind])}><Icon /></span>
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex min-w-0 items-center gap-2 text-sm">
            <span className="shrink-0 font-semibold">{r.no}</span>
            <span className="truncate">{r.place}</span>
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {[r.customer, stepWord(r.status), r.how.join(" · ")].filter(Boolean).join(" · ")}
          </span>
        </span>
        <span className="flex shrink-0 flex-col items-end gap-1">
          <span className="text-sm font-semibold tabular-nums">{tzs(r.total)}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-semibold", m.tone)}>{m.text}</span>
        </span>
      </Link>
    </li>
  );
}

/** The four ways an order ends up paid — the bar, the tiles and the filters share them. */
const WAYS = [
  { key: "counter", label: "At the Counter", icon: Store, bar: "bg-emerald-400", tile: "bg-emerald-500/12 text-emerald-300" },
  { key: "rooms", label: "On room bills", icon: BedDouble, bar: "bg-violet-400", tile: "bg-violet-500/12 text-violet-300" },
  { key: "online", label: "Paid by phone", icon: Globe, bar: "bg-sky-400", tile: "bg-sky-500/12 text-sky-300" },
  { key: "unpaid", label: "Still to pay", icon: Clock, bar: "bg-rose-400", tile: "bg-rose-500/12 text-rose-300" },
] as const;
type Filter = "all" | "unpaid" | "paid" | "rooms";
const PAY_FILTERS: { key: Filter; label: string; match: (m: MoneyState) => boolean }[] = [
  { key: "all", label: "All", match: () => true },
  { key: "unpaid", label: "Not paid yet", match: (m) => m === "UNPAID" || m === "PARTLY_PAID" || m === "NOT_RECEIVED" },
  { key: "paid", label: "Paid", match: (m) => m === "PAID" || m === "PAID_ONLINE" },
  { key: "rooms", label: "Room bills", match: (m) => m === "ROOM_BILL" },
];

/**
 * MY COLLECTIONS — how the orders they handled are paid, as the Counter recorded it: cash, mobile money,
 * charged to the room, paid online, not paid yet. Information only — the Counter records every payment.
 */
export function MyCollections({ rows, s }: { rows: WaiterOrderRow[]; s: WaiterActivity["summary"] }) {
  const [filter, setFilter] = useState<Filter>("all");
  const live = rows.filter((r) => r.status !== "CANCELLED");
  const amounts: Record<(typeof WAYS)[number]["key"], number> = { counter: s.paidCounter, rooms: s.onRooms, online: s.paidOnline, unpaid: s.unpaid };
  const subs: Record<(typeof WAYS)[number]["key"], string> = {
    counter: s.cashPaid ? `${tzs(s.cashPaid)} in cash` : "Cash, mobile money…",
    rooms: "Paid at check-out", online: "Before it was made",
    unpaid: `${plural(live.filter((r) => r.open && r.due > 0).length, "open order")}`,
  };
  const barTotal = WAYS.reduce((t, w) => t + amounts[w.key], 0);
  const shown = live.filter((r) => PAY_FILTERS.find((f) => f.key === filter)!.match(r.money));

  return (
    <div className="space-y-4">
      {/* The orders' value, how it is paid in one bar, and the four ways */}
      <section className="grid gap-4 rounded-3xl border border-border/70 bg-card p-4 sm:p-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,2fr)] xl:items-center xl:gap-6">
        <div className="min-w-0">
          <Label>Your orders&apos; value</Label>
          <p className="mt-1 text-3xl font-semibold tracking-tight tabular-nums">{tzs(s.value)}</p>
          <p className="text-xs text-muted-foreground">{plural(s.orders, "order")} you handled</p>
          {barTotal > 0 && (
            <div className="mt-3 flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted" role="img"
              aria-label={WAYS.filter((w) => amounts[w.key] > 0).map((w) => `${w.label} ${tzs(amounts[w.key])}`).join(", ")}>
              {WAYS.filter((w) => amounts[w.key] > 0).map((w) => (
                <span key={w.key} className={cn("h-full rounded-full", w.bar)} style={{ width: `${(amounts[w.key] / barTotal) * 100}%` }} title={`${w.label}: ${tzs(amounts[w.key])}`} />
              ))}
            </div>
          )}
        </div>
        <div className="grid grid-cols-2 gap-2 sm:gap-3 xl:grid-cols-4">
          {WAYS.map((w) => {
            const Icon = w.icon;
            const warn = w.key === "unpaid" && amounts.unpaid > 0;
            return (
              <div key={w.key} className={cn("min-w-0 rounded-2xl bg-muted/30 p-3 ring-1 ring-inset ring-border/60", warn && "bg-rose-500/[0.06] ring-rose-500/25")}>
                <div className="flex items-center gap-2">
                  <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg [&_svg]:size-3.5", w.tile)}><Icon /></span>
                  <p className="min-w-0 truncate text-[11px] font-medium text-muted-foreground">{w.label}</p>
                </div>
                <p className={cn("mt-2 text-base font-semibold tabular-nums [overflow-wrap:anywhere] sm:text-lg", warn && "text-rose-300")}>{tzs(amounts[w.key])}</p>
                <p className="truncate text-[11px] text-muted-foreground">{subs[w.key]}</p>
              </div>
            );
          })}
        </div>
      </section>

      {/* Filter, like the payment chips on the Live board */}
      <div role="tablist" aria-label="Filter by payment" className="flex flex-wrap gap-1.5">
        {PAY_FILTERS.map((f) => {
          const n = live.filter((r) => f.match(r.money)).length;
          return (
            <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
              className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition",
                filter === f.key ? "border-[oklch(0.75_0.12_80)] bg-[oklch(0.72_0.12_80/0.14)] text-foreground" : "border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground")}>
              {f.label}
              <span className={cn("min-w-5 rounded-full px-1.5 text-[10px] leading-4 tabular-nums", f.key === "unpaid" && n ? "bg-rose-500/80 text-white" : "bg-muted text-muted-foreground")}>{n}</span>
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <p className="rounded-3xl border border-dashed border-border/80 px-4 py-10 text-center text-sm text-muted-foreground">{live.length ? "None here." : "No orders yet — the ones you handle show up here by themselves."}</p>
      ) : (
        <div className="overflow-hidden rounded-3xl border border-border/70 bg-card">
          <div className="hidden grid-cols-[5.5rem_minmax(0,1.6fr)_minmax(0,0.8fr)_8rem_minmax(0,1.4fr)] gap-4 border-b border-border/60 px-5 py-2.5 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground md:grid">
            <span>Order</span><span>Where</span><span>Step</span><span className="text-right">Amount</span><span>Payment</span>
          </div>
          <ul className="divide-y divide-border/50">
            {shown.map((r) => {
              const m = MONEY[r.money];
              const KindIcon = KIND_ICON[r.kind];
              const badge = (
                <span className="flex min-w-0 items-center gap-1.5">
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold", m.tone)}>{m.text}</span>
                  {r.paidBy && r.money !== "PAID_ONLINE" && <span className="truncate text-xs text-muted-foreground">{r.paidBy}</span>}
                  {r.money === "PARTLY_PAID" && <span className="truncate text-xs text-rose-300">{tzs(r.due)} left</span>}
                </span>
              );
              return (
                <li key={r.id}>
                  <Link href={`/staff/restaurant/orders/${r.id}`} className="group block px-4 py-3 transition hover:bg-muted/30 md:px-5">
                    {/* Phone: one card-like row */}
                    <div className="flex items-start gap-3 md:hidden">
                      <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl [&_svg]:size-4", KIND_TONE[r.kind])}><KindIcon /></span>
                      <div className="min-w-0 flex-1 space-y-1.5">
                        <div className="flex items-baseline justify-between gap-2">
                          <p className="min-w-0 truncate text-sm font-semibold"><span className="text-muted-foreground">{r.no}</span> {r.place}</p>
                          <p className="shrink-0 text-sm font-semibold tabular-nums">{tzs(r.total)}</p>
                        </div>
                        <div className="flex items-center justify-between gap-2">
                          {badge}
                          <span className="shrink-0 text-[11px] text-muted-foreground" suppressHydrationWarning>{stepWord(r.status)} · {formatTime(r.createdAt)}</span>
                        </div>
                      </div>
                    </div>
                    {/* Computer: one table line */}
                    <div className="hidden grid-cols-[5.5rem_minmax(0,1.6fr)_minmax(0,0.8fr)_8rem_minmax(0,1.4fr)] items-center gap-4 text-sm md:grid">
                      <span className="leading-tight">
                        <span className="block font-semibold group-hover:underline">{r.no}</span>
                        <span className="text-[11px] text-muted-foreground tabular-nums" suppressHydrationWarning>{formatTime(r.createdAt)}</span>
                      </span>
                      <span className="flex min-w-0 items-center gap-2.5">
                        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-3.5", KIND_TONE[r.kind])}><KindIcon /></span>
                        <span className="min-w-0 leading-tight">
                          <span className="block truncate font-medium">{r.place}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">{r.kindLabel}{r.customer ? ` · ${r.customer}` : ""}</span>
                        </span>
                      </span>
                      <span className="truncate text-xs text-muted-foreground">{stepWord(r.status)}</span>
                      <span className="text-right font-semibold tabular-nums">{tzs(r.total)}</span>
                      {badge}
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </div>
      )}
    </div>
  );
}

/** What each line of the history looks like: its icon and colour, from what was done. */
type Look = { icon: typeof Store; tone: string; label: string };
const T = {
  sky: "bg-sky-500/12 text-sky-700 dark:text-sky-300", amber: "bg-amber-500/14 text-amber-800 dark:text-amber-300",
  emerald: "bg-emerald-500/14 text-emerald-700 dark:text-emerald-300", violet: "bg-violet-500/14 text-violet-700 dark:text-violet-300",
  rose: "bg-rose-500/14 text-rose-700 dark:text-rose-300", slate: "bg-muted text-muted-foreground",
  gold: "bg-[oklch(0.72_0.12_80/0.16)] text-[oklch(0.5_0.12_75)] dark:text-[oklch(0.84_0.11_82)]",
};
function look(x: WaiterHistoryItem): Look {
  if (x.kind === "shift") return { icon: x.text.startsWith("Started") ? LogIn : LogOut, tone: T.gold, label: "Shift" };
  if (x.kind === "bill") return { icon: Printer, tone: T.gold, label: "Bill" };
  if (x.kind === "table") return { icon: Armchair, tone: T.amber, label: "Table" };
  // Claimed or given to them → "Taken"; handed to a colleague, moved or released → "Handed over".
  if (x.kind === "assign") return { icon: ArrowRightLeft, tone: T.amber, label: x.text.startsWith("Claimed") || / to you\b/.test(x.text) || x.text.includes("came to you") ? "Taken" : "Handed over" };
  const t = x.text;
  if (x.tone === "bad" || t.startsWith("Cancelled")) return { icon: CircleX, tone: T.rose, label: "Order" };
  if (t.startsWith("Served")) return { icon: CircleCheck, tone: T.emerald, label: "Order" };
  if (t.startsWith("Marked ready")) return { icon: BellRing, tone: T.emerald, label: "Order" };
  if (t.startsWith("Serving")) return { icon: Bike, tone: T.violet, label: "Order" };
  if (t.startsWith("Completed")) return { icon: CheckCheck, tone: T.slate, label: "Order" };
  if (t.startsWith("Created")) return { icon: CirclePlus, tone: T.sky, label: "Order" };
  if (t.startsWith("Started preparing")) return { icon: Flame, tone: T.amber, label: "Order" };
  return { icon: HandPlatter, tone: T.sky, label: "Order" };
}
type HistoryFilter = "all" | WaiterHistoryItem["kind"];
const HISTORY_FILTERS: { key: HistoryFilter; label: string }[] = [
  { key: "all", label: "All" }, { key: "order", label: "Orders" }, { key: "assign", label: "Taken & handed" },
  { key: "table", label: "Tables" }, { key: "bill", label: "Bills" }, { key: "shift", label: "Shift" },
];
const EAT = "Africa/Dar_es_Salaam";
const dayOf = (iso: string) => new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: EAT }).format(new Date(iso));
const hourOf = (iso: string) => `${formatTime(iso).slice(0, 2)}:00`;
/** "Accepted #42 · Restaurant" → the action, the order number and the place, each in its own weight. */
const split = (text: string) => /^(.*?)(#\d+)(.*)$/.exec(text);

/** MY HISTORY — everything they did, newest first, written by the system as it happened. Grouped by hour (by day over several days). */
export function MyHistory({ items, multiDay, more }: { items: WaiterHistoryItem[]; /** Over several days: each line says the day too. */ multiDay?: boolean; /** Only the newest part is shown. */ more?: boolean }) {
  const [filter, setFilter] = useState<HistoryFilter>("all");
  if (!items.length) return <p className="rounded-3xl border border-dashed border-border/80 px-4 py-10 text-center text-sm text-muted-foreground">Nothing yet — your shift, orders, tables and bills show up here by themselves.</p>;
  const shown = filter === "all" ? items : items.filter((x) => x.kind === filter);
  const groups: { key: string; items: WaiterHistoryItem[] }[] = [];
  for (const x of shown) {
    const key = multiDay ? dayOf(x.at) : hourOf(x.at);
    if (groups.at(-1)?.key === key) groups.at(-1)!.items.push(x); else groups.push({ key, items: [x] });
  }
  return (
    <div className="space-y-3">
      {more && <p className="rounded-2xl bg-amber-500/10 px-4 py-2 text-xs text-amber-200 ring-1 ring-inset ring-amber-500/25">The newest part is shown — pick a shorter period to see the rest.</p>}
      <div role="tablist" aria-label="Show" className="flex flex-wrap gap-1.5">
        {HISTORY_FILTERS.map((f) => {
          const n = f.key === "all" ? items.length : items.filter((x) => x.kind === f.key).length;
          if (!n && f.key !== "all") return null;
          return (
            <button key={f.key} type="button" role="tab" aria-selected={filter === f.key} onClick={() => setFilter(f.key)}
              className={cn("inline-flex h-9 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold transition",
                filter === f.key ? "border-[oklch(0.75_0.12_80)] bg-[oklch(0.72_0.12_80/0.14)] text-foreground" : "border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground")}>
              {f.label}<span className="min-w-5 rounded-full bg-muted px-1.5 text-[10px] leading-4 tabular-nums text-muted-foreground">{n}</span>
            </button>
          );
        })}
      </div>
      <div className="overflow-hidden rounded-3xl border border-border/70 bg-card">
        {groups.map((g) => (
          <section key={g.key} aria-label={g.key}>
            <p className="flex items-center gap-2 border-b border-border/50 bg-muted/30 px-4 py-1.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground sm:px-5" suppressHydrationWarning>
              <Clock className="size-3" />{g.key}<span className="font-medium normal-case tracking-normal">· {g.items.length}</span>
            </p>
            <ol className="divide-y divide-border/40">
              {g.items.map((x, i) => {
                const l = look(x);
                const Icon = l.icon;
                const m = split(x.text);
                const body = (
                  <>
                    <span className="w-11 shrink-0 text-xs tabular-nums text-muted-foreground" suppressHydrationWarning>{formatTime(x.at)}</span>
                    <span className={cn("grid size-8 shrink-0 place-items-center rounded-xl [&_svg]:size-3.5", l.tone)}><Icon /></span>
                    <span className="min-w-0 flex-1 text-sm leading-snug">
                      {m ? <><span className="font-semibold">{m[1]}</span><span className="font-mono text-[12px] text-muted-foreground">{m[2]}</span>{m[3]}</> : <span className="font-medium">{x.text}</span>}
                    </span>
                    <span className={cn("hidden shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold md:inline", l.tone)}>{l.label}</span>
                    {x.orderId && <ChevronRight className="size-4 shrink-0 text-muted-foreground/60 transition group-hover:translate-x-0.5 group-hover:text-foreground" />}
                  </>
                );
                return (
                  <li key={`${x.at}-${i}`}>
                    {x.orderId
                      ? <Link href={`/staff/restaurant/orders/${x.orderId}`} className="group flex items-center gap-3 px-4 py-2.5 transition hover:bg-muted/30 sm:px-5">{body}</Link>
                      : <div className="flex items-center gap-3 px-4 py-2.5 sm:px-5">{body}</div>}
                  </li>
                );
              })}
            </ol>
          </section>
        ))}
      </div>
    </div>
  );
}
