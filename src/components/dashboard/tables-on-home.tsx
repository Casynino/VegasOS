"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertTriangle, ArrowUpRight, CalendarClock, Clock, Loader2, Printer, QrCode, Receipt, Store, Timer, Trophy, UserRound, Users, type LucideIcon } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { setLocationQrActiveAction } from "@/app/staff/(app)/restaurant/actions";
import type { HomeTable, TablesOnHomeData } from "@/server/services/table-performance";
import { TABLE_META } from "./table-meta";
import { BillDiscount } from "@/components/staff/manager-decisions";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";

const WATCH_TONE = {
  amber: "text-amber-700 dark:text-amber-300", violet: "text-violet-700 dark:text-violet-300", sky: "text-sky-700 dark:text-sky-300", rose: "text-rose-700 dark:text-rose-300",
};

const n = (v: number) => v.toLocaleString("en-US");
const mins = (m: number, t: T) => (m < 60 ? t("{n} min", { n: m }) : m < 1440 ? (m % 60 ? t("{h} h {m} min", { h: Math.floor(m / 60), m: m % 60 }) : t("{h} h", { h: Math.floor(m / 60) })) : t.plural(Math.round(m / 1440), "{n} day", "{n} days"));
const day = (d: string, t: T) => new Date(`${d}T00:00:00Z`).toLocaleDateString(t.intl, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
const weekday = (d: string, t: T) => new Date(`${d}T00:00:00Z`).toLocaleDateString(t.intl, { weekday: "short", timeZone: "UTC" }).slice(0, 2);
const areaName = (a: string | null, t: T) => (a === "INSIDE" ? t("Inside") : a === "OUTSIDE" ? t("Outside") : t("Restaurant"));
const short = (p: HomeTable, t: T) => (p.kind === "COUNTER" ? t("Counter") : t("Table {number}", { number: p.number ?? "" }).trim());
/** A table state's label (TABLE_META) in the reader's language ("Free" here is a free table, not free of charge). */
const stateLabel = (label: string, t: T) => t.ctx("table", label);
/** People at a table: "1 person" / "4 people". */
const people = (k: number, t: T) => t.plural(k, "{n} person", "{n} people");

/**
 * On the manager's and the MD's home, under the rooms: every table right now (who sits there,
 * their bill, a reservation coming) and how each did in the period — tap one for the detail.
 * To watch the floor, not to work it: waiters seat, serve and take the money.
 */
export function TablesOnHome({ data, period, canManage, canDecide = false }: { data: TablesOnHomeData; period: string; canManage: boolean; canDecide?: boolean }) {
  const t = useT();
  const [openId, setOpenId] = useState<string | null>(null);
  const { places, watch } = data;
  const best = Math.max(1, ...places.map((p) => p.period.sales));
  const areas = [...new Set(places.map((p) => p.area ?? ""))].map((a) => {
    const here = places.filter((p) => (p.area ?? "") === a).sort((x, y) => (x.kind === y.kind ? (x.number ?? 0) - (y.number ?? 0) : x.kind === "TABLE" ? -1 : 1));
    return {
      key: a, name: areaName(a || null, t), places: here,
      busy: here.filter((p) => p.state !== "FREE" && p.state !== "RESERVED").length,
      tables: here.filter((p) => p.kind === "TABLE").length,
      sales: here.reduce((t, p) => t + p.period.sales, 0),
    };
  });
  const open = places.find((p) => p.id === openId) ?? null;

  return (
    <section className="rounded-3xl border border-border/70 bg-card p-3.5 sm:p-4">
      {/* One line: the title, what may need an eye (tap → that table), the floor */}
      <div className="flex min-w-0 items-center gap-3">
        <h3 className="flex shrink-0 items-center gap-2 text-sm font-semibold"><Store className="size-4 text-muted-foreground" />{t("Every table right now")}</h3>
        {watch[0] ? (
          <button type="button" onClick={() => setOpenId(watch[0].id)} title={watch.map((w) => w.text).join("\n")}
            className={cn("flex min-w-0 items-center gap-1.5 text-left text-xs font-medium hover:underline", WATCH_TONE[watch[0].tone])}>
            <AlertTriangle className="size-3.5 shrink-0" /><span className="truncate">{watch[0].text}</span>
            {watch.length > 1 && <span className="shrink-0 text-muted-foreground">+{watch.length - 1}</span>}
          </button>
        ) : <span className="min-w-0 truncate text-xs text-muted-foreground">{t("Live · tap a table for its customer, bill and history")}</span>}
        <Link href="/staff/restaurant/tables" className="ml-auto inline-flex shrink-0 items-center gap-1 text-xs font-semibold text-[oklch(0.55_0.11_75)] hover:underline dark:text-[oklch(0.8_0.11_82)]">{t("The floor")}<ArrowUpRight className="size-3.5" /></Link>
      </div>

      <div className="mt-3 grid gap-x-6 gap-y-3 xl:grid-cols-2">
        {areas.map((a) => (
          <div key={a.key}>
            <p className="mb-2 flex flex-wrap items-baseline justify-between gap-x-3 text-xs text-muted-foreground">
              <span><span className="font-semibold uppercase tracking-[0.14em] text-foreground">{a.name}</span> · {a.places.length > a.tables ? t.plural(a.tables, "{n} table + counter", "{n} tables + counter") : t.plural(a.tables, "{n} table", "{n} tables")}</span>
              <span>{t.rich("{busy} busy · <b>{sales}</b> sold", { b: (c) => <span className={cn("font-semibold tabular-nums", a.sales && "text-emerald-600 dark:text-emerald-400")}>{c}</span> }, { busy: a.busy, sales: n(a.sales) })}</span>
            </p>
            {/* Small tiles that share each row evenly and grow to fill it — no empty gaps */}
            <div className="@container">
              <ul className="flex flex-wrap gap-1.5 [--per:3] @md:[--per:4] @xl:[--per:7]">
                {a.places.map((p) => (
                  <li key={p.id} className="min-w-0 grow basis-[calc((100%-(var(--per)-1)*0.375rem)/var(--per))]"><Tile table={p} best={best} onOpen={() => setOpenId(p.id)} /></li>
                ))}
              </ul>
            </div>
          </div>
        ))}
      </div>

      <Dialog open={!!open} onOpenChange={(v) => { if (!v) setOpenId(null); }}>
        <DialogContent className="max-h-[92svh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
          {open && <Detail table={open} period={period} best={best} canManage={canManage} canDecide={canDecide} />}
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** One table as a calm tile: status bar, number, who is there (or what comes next), and its sales. */
function Tile({ table: p, best, onOpen }: { table: HomeTable; best: number; onOpen: () => void }) {
  const t = useT();
  const m = TABLE_META[p.state];
  const label = stateLabel(m.label, t);
  const due = (p.now?.due ?? 0) + p.loose.reduce((s, o) => s + o.due, 0);
  const who = p.now?.customer ?? (p.state === "ORDERS" ? t.plural(p.loose.length, "{n} open order", "{n} open orders") : p.state === "RESERVED" ? p.next?.name : null);
  const line = p.state === "BILL" ? t("asked {time} ago", { time: mins(p.now?.billAsked ?? 0, t) })
    : p.state === "PAID" ? t("paid {time} ago", { time: mins(p.now?.paidAgo ?? 0, t) })
    : p.now ? `${people(p.now.guests, t)} · ${mins(p.now.minutes, t)}`
    : p.state === "ORDERS" ? t("{n} items", { n: p.loose.reduce((x, o) => x + o.items, 0) })
    : p.state === "RESERVED" ? t("at {time} · {guests}", { time: p.next?.at, guests: p.next?.guests })
    : p.next ? t("reserved {time}", { time: p.next.at }) : p.doneToday ? t("{n} served today", { n: p.doneToday }) : null;
  return (
    <button type="button" onClick={onOpen} title={`${p.name} · ${label}`}
      className={cn("group relative flex h-full w-full min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-card bg-linear-to-br to-transparent to-60% px-2.5 pb-2 pt-2 text-left transition-all duration-150",
        "hover:-translate-y-0.5 hover:shadow-[0_10px_22px_-14px_rgba(15,23,42,0.6)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:border-white/[0.1] dark:bg-white/[0.03]", m.tint, m.hover)}>
      <span aria-hidden className={cn("absolute inset-y-2 left-0 w-[3px] rounded-r-full", m.dot)} />
      <span className="flex items-center justify-between gap-1">
        <span className="flex min-w-0 items-baseline gap-1">
          {p.kind === "COUNTER" ? <Store className="size-3.5 shrink-0 self-center text-muted-foreground" /> : <span className="text-base font-semibold leading-none tabular-nums">{p.number}</span>}
          <span className="truncate text-[10px] text-muted-foreground">{p.kind === "COUNTER" ? t("Counter") : t("Table")}</span>
        </span>
        <span className="flex shrink-0 items-center gap-1">
          {!p.qrActive && <span title={t("QR switched off")} className="rounded bg-rose-500/15 px-1 text-[9px] font-semibold text-rose-600 dark:text-rose-300">{t("QR off")}</span>}
          <span aria-hidden className={cn("size-1.5 rounded-full", m.dot)} />
        </span>
      </span>
      <span className={cn("mt-1 truncate text-[11px] leading-tight", who ? "font-medium" : "text-muted-foreground")}>{who ?? label}</span>
      <span className="truncate text-[10px] leading-tight text-muted-foreground">
        {due > 0 ? <span className="font-semibold text-amber-600 dark:text-amber-300">{t("{amount} to pay", { amount: n(due) })}</span> : line ?? "\u00a0"}
      </span>
      <span className="mt-1.5 flex items-baseline justify-between gap-1 text-[10px]">
        <span className={cn("font-semibold tabular-nums", p.period.sales ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground/50")}>{p.period.sales ? n(p.period.sales) : "—"}</span>
        {p.period.customers > 0 && <span className="text-muted-foreground">{t("{n} cust.", { n: p.period.customers })}</span>}
      </span>
      {p.period.sales > 0 && <span aria-hidden className="absolute inset-x-2.5 bottom-0 h-[2px] rounded-full bg-emerald-500/80" style={{ width: `calc(${(p.period.sales / best) * 100}% - 1.25rem)` }} />}
    </button>
  );
}

function Detail({ table: p, period, best, canManage, canDecide }: { table: HomeTable; period: string; best: number; canManage: boolean; canDecide: boolean }) {
  const t = useT();
  const m = TABLE_META[p.state];
  const router = useRouter();
  const [asking, setAsking] = useState(false);
  const [pending, start] = useTransition();
  const weekMax = Math.max(1, ...p.week.map((w) => w.sales));
  const weekTotal = p.week.reduce((s, w) => s + w.sales, 0);
  const avgBill = p.period.customers ? Math.round(p.period.sales / p.period.customers) : p.period.orders ? Math.round(p.period.sales / p.period.orders) : 0;
  const toggleQr = () => start(async () => {
    const res = await setLocationQrActiveAction({ id: p.id, active: !p.qrActive });
    if (res.ok) { toast.success(res.message ?? t("Saved.")); setAsking(false); router.refresh(); } else toast.error(res.error);
  });

  return (
    <>
      <div className="relative overflow-hidden bg-[#15110c] px-5 py-5 text-white">
        <div aria-hidden className="absolute -right-16 -top-20 size-56 rounded-full blur-3xl" style={{ background: `${m.hex}26` }} />
        <div className="relative flex items-center gap-4 pr-8">
          <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white/10 text-xl font-bold tabular-nums ring-1 ring-white/15">{p.kind === "COUNTER" ? <Store className="size-6" /> : p.number}</span>
          <div className="min-w-0">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#f0cf86]">{t("Restaurant")}</p>
            <DialogTitle className="mt-0.5 text-xl text-white">{short(p, t)}</DialogTitle>
            <DialogDescription className="mt-0.5 flex flex-wrap items-center gap-x-2 text-xs text-white/60">
              <span>{areaName(p.area, t)}</span><span>·</span>
              <span className="inline-flex items-center gap-1"><span className={cn("size-1.5 rounded-full", m.dot)} />{stateLabel(m.label, t)}</span><span>·</span>
              <span className={cn("inline-flex items-center gap-1", !p.qrActive && "text-rose-300")}><QrCode className="size-3" />{p.qrActive ? t("QR on") : t("QR off")}</span>
            </DialogDescription>
          </div>
        </div>
        <div className="relative mt-4 grid grid-cols-3 gap-2">
          <Mini label={t("Sales · {period}", { period })} value={p.period.sales ? n(p.period.sales) : "—"} strong />
          <Mini label={t("Customers")} value={String(p.period.customers || (p.period.orders ? t("{n} ord.", { n: p.period.orders }) : 0))} />
          <Mini label={t("Average bill")} value={avgBill ? n(avgBill) : "—"} />
        </div>
      </div>

      <div className="space-y-4 p-5">
        <div className="space-y-1.5 text-sm">
          <Row icon={Timer} label={t("Average time at the table")} value={p.period.minutes != null ? mins(p.period.minutes, t) : "—"} />
          <Row icon={Users} label={t("People served")} value={t("{guests} · {n} finished today", { guests: p.period.guests, n: p.doneToday })} />
          <Row icon={QrCode} label={t("QR scans (all time)")} value={`${p.scans}${p.lastScan ? ` · ${t("last {when}", { when: new Date(p.lastScan).toLocaleString(t.intl, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" }) })}` : ""}`} />
          <Row icon={Trophy} label={t("Against the best table")} value={`${Math.round((p.period.sales / best) * 100)}%`} />
          <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-linear-to-r from-emerald-500 to-teal-400" style={{ width: `${(p.period.sales / best) * 100}%` }} /></div>
        </div>

        {/* Right now */}
        {p.now && (
          <div className="rounded-2xl border border-sky-500/30 bg-sky-500/[0.06] p-3">
            <Link href={`/staff/guests/${p.now.customerId}`} className="flex items-center gap-3 rounded-xl text-sm transition-colors hover:bg-sky-500/10">
              <UserRound className="size-4 shrink-0 text-sky-500" />
              <span className="min-w-0 flex-1 leading-tight">
                <span className="block truncate font-medium">{p.now.customer}</span>
                <span className="text-xs text-muted-foreground">{t("Since {time}", { time: p.now.since })} · {mins(p.now.minutes, t)} · {people(p.now.guests, t)}{p.now.billAsked != null ? ` · ${t("asked for the bill {time} ago", { time: mins(p.now.billAsked, t) })}` : ""}</span>
              </span>
              <ArrowUpRight className="size-4 shrink-0 text-muted-foreground" />
            </Link>
            <div className="mt-2.5 grid grid-cols-3 gap-2 text-center">
              {([[msg("Bill"), p.now.total, ""], [msg("Paid"), p.now.paid + p.now.onRoom, "text-emerald-600 dark:text-emerald-400"], [msg("To pay"), p.now.due, p.now.due ? "text-amber-600 dark:text-amber-300" : ""]] as const).map(([k, v, c]) => (
                <div key={k} className="rounded-xl bg-card/70 px-2 py-1.5"><p className="text-[10px] text-muted-foreground">{t(k)}</p><p className={cn("text-sm font-semibold tabular-nums", c)}>{n(v)}</p></div>
              ))}
            </div>
            {p.now.orders.length > 0 && <Orders orders={p.now.orders} />}
          </div>
        )}
        {p.loose.length > 0 && (
          <div className="rounded-2xl border border-sky-500/30 bg-sky-500/[0.06] p-3">
            <p className="text-xs font-semibold text-muted-foreground">{t("Open orders here")}</p>
            <Orders orders={p.loose} />
          </div>
        )}
        {canDecide && p.now && <BillDiscount sessionId={p.now.sessionId} due={p.now.due} />}
        {canDecide && !p.now && p.loose.length > 0 && <BillDiscount orderIds={p.loose.map((o) => o.id)} due={p.loose.reduce((x, o) => x + o.due, 0)} />}
        {p.next && (
          <p className="flex items-center gap-2.5 rounded-2xl border border-orange-400/40 bg-orange-400/[0.07] px-3.5 py-2.5 text-sm">
            <CalendarClock className="size-4 shrink-0 text-orange-500" />
            <span className="min-w-0 flex-1 leading-tight"><span className="block truncate font-medium">{p.next.name} · {people(p.next.guests, t)}</span>
              <span className="text-xs text-muted-foreground">{t("Reserved for {time}", { time: p.next.at })}{p.next.late ? ` · ${t("{time} late", { time: mins(p.next.late, t) })}` : p.next.holding ? ` · ${t("the table is held for them")}` : ""}</span></span>
          </p>
        )}

        {/* The last 7 days */}
        <div>
          <p className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"><span>{t("Last 7 days")}</span><span className="normal-case tracking-normal tabular-nums">{n(weekTotal)}</span></p>
          <div className="grid h-24 grid-cols-7 items-end gap-1.5">
            {p.week.map((w, i) => (
              <div key={w.d} className="flex h-full flex-col items-center justify-end gap-1" title={`${day(w.d, t)} · ${n(w.sales)}`}>
                <span className={cn("w-full rounded-md", w.sales ? (i === p.week.length - 1 ? "bg-emerald-500" : "bg-emerald-500/45") : "bg-muted")} style={{ height: `${w.sales ? Math.max(8, (w.sales / weekMax) * 100) : 6}%` }} />
                <span className={cn("text-[10px] text-muted-foreground", i === p.week.length - 1 && "font-semibold text-foreground")}>{weekday(w.d, t)}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Latest customers */}
        <div>
          <p className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground"><Clock className="size-3.5" />{t("Latest customers")}</p>
          {p.recent.length === 0 ? <p className="rounded-2xl border border-dashed border-border px-3 py-5 text-center text-sm text-muted-foreground">{t("Nobody sat here in the last 30 days.")}</p> : (
            <ul className="divide-y divide-border/60 rounded-2xl border border-border/70">
              {p.recent.map((r) => (
                <li key={r.id}>
                  <Link href={`/staff/guests/${r.customerId}`} className="flex items-center gap-3 px-3.5 py-2.5 text-sm transition-colors hover:bg-muted/40">
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate font-medium">{r.customer}{r.open && <span className="ml-1.5 rounded-full bg-sky-500/15 px-1.5 text-[10px] font-semibold text-sky-600 dark:text-sky-300">{t.ctx("table", "now")}</span>}</span>
                      <span className="block truncate text-xs text-muted-foreground">{day(r.date, t)} · {r.at} · {people(r.guests, t)}{r.minutes != null ? ` · ${mins(r.minutes, t)}` : ""}</span>
                    </span>
                    <span className="shrink-0 font-semibold tabular-nums">{n(r.total)}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* A manager's actions: look, print, switch the QR — the waiters do the serving */}
        <div className="flex flex-wrap gap-2 border-t border-border/70 pt-4">
          <Link href={`/staff/restaurant/tables?table=${p.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted">{t("Open on the floor")}<ArrowUpRight className="size-3.5" /></Link>
          <Link href={`/staff/restaurant/tables?print=${p.id}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted"><Printer className="size-3.5" />{t("Print QR card")}</Link>
          {canManage && (asking ? (
            <span className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border bg-muted/50 pl-3 pr-1 text-sm">
              {p.qrActive ? t("Switch the QR off?") : t("Switch the QR on?")}
              <button type="button" disabled={pending} onClick={toggleQr} className={cn("inline-flex h-7 items-center gap-1 rounded-lg px-2.5 text-xs font-semibold text-white", p.qrActive ? "bg-rose-600 hover:bg-rose-500" : "bg-emerald-600 hover:bg-emerald-500")}>{pending && <Loader2 className="size-3 animate-spin" />}{t("Yes")}</button>
              <button type="button" onClick={() => setAsking(false)} className="h-7 rounded-lg px-2 text-xs text-muted-foreground hover:text-foreground">{t("No")}</button>
            </span>
          ) : (
            <button type="button" onClick={() => setAsking(true)} className={cn("inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-sm font-medium transition-colors", p.qrActive ? "border-border hover:bg-muted" : "border-emerald-500/40 text-emerald-700 hover:bg-emerald-500/10 dark:text-emerald-300")}>
              <QrCode className="size-3.5" />{p.qrActive ? t("Switch QR off") : t("Switch QR on")}
            </button>
          ))}
        </div>
        {canManage && <p className="-mt-2 text-[11px] text-muted-foreground">{t("With the QR off, a customer who scans is asked to call a waiter.")}</p>}
      </div>
    </>
  );
}

function Orders({ orders }: { orders: { id: string; number: string; status: string; total: number; items: number; customer?: string | null }[] }) {
  const t = useT();
  return (
    <ul className="mt-2.5 space-y-1">
      {orders.map((o) => (
        <li key={o.id}>
          <Link href={`/staff/restaurant/orders/${o.id}`} className="flex items-center gap-2.5 rounded-xl bg-card/70 px-2.5 py-1.5 text-xs transition-colors hover:bg-card">
            <Receipt className="size-3.5 shrink-0 text-muted-foreground" />
            <span className="min-w-0 flex-1 truncate"><span className="font-semibold">#{o.number.replace(/^ORD-\d{4}-0*/, "")}</span> · {t.plural(o.items, "{n} item", "{n} items")}{o.customer ? ` · ${o.customer}` : ""} · <span className="text-muted-foreground">{STATUS[o.status] ? t.ctx("order", STATUS[o.status]) : o.status.toLowerCase()}</span></span>
            <span className="shrink-0 font-semibold tabular-nums">{n(o.total)}</span>
          </Link>
        </li>
      ))}
    </ul>
  );
}
const STATUS: Record<string, string> = {
  PENDING: msg("new"), ACCEPTED: msg("accepted"), PREPARING: msg("preparing"), READY: msg("ready"), OUT_FOR_DELIVERY: msg("being served"), DELIVERED: msg("served"), COMPLETED: msg("done"), COLLECTED: msg("done"),
};

function Mini({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="min-w-0 rounded-xl bg-white/[0.06] px-3 py-2 ring-1 ring-white/10">
      <p className="truncate text-[10px] uppercase tracking-wider text-white/50">{label}</p>
      <p className={cn("truncate font-semibold tabular-nums", strong ? "text-lg text-emerald-300" : "text-base")}>{value}</p>
    </div>
  );
}

function Row({ icon: Icon, label, value }: { icon: LucideIcon; label: string; value: string }) {
  return (
    <p className="flex items-center justify-between gap-3">
      <span className="flex items-center gap-2 text-muted-foreground"><Icon className="size-3.5 shrink-0" />{label}</span>
      <span className="text-right font-medium tabular-nums">{value}</span>
    </p>
  );
}
