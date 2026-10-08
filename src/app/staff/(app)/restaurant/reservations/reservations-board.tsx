"use client";

import { useCallback, useState, useSyncExternalStore, useTransition } from "react";
import { useWaiterPin } from "@/components/staff/waiter-pin";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeft, BedDouble, CalendarClock, CalendarPlus, CalendarX, Check, ChevronLeft, ChevronRight, Loader2, Pencil, Phone, Search, Store, UserX, Users, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import type { ReservationRow } from "@/server/services/table-reservations";
import { seatReservationAction } from "../tables/actions";
import { useLiveOrders } from "@/components/staff/sounds";
import { moveReservationAction, setReservationStatusAction } from "./actions";
import { ReservationDialog, type HotelGuest, type ReservationDraft, type TableOption } from "./reservation-form";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";

type Row = ReservationRow & { clock: { date: string; time: string } };
/** A booking as shown: one table, or a party's tables together (the first row leads). */
type Group = Row & { party: Row[] };
function groupParties(rows: Row[]): Group[] {
  const out: Group[] = [];
  const byParty = new Map<string, Group>();
  for (const r of rows) {
    const g = r.partyId ? byParty.get(r.partyId) : undefined;
    if (g) { g.party.push(r); continue; }
    const lead: Group = { ...r, party: [r] };
    out.push(lead);
    if (r.partyId) byParty.set(r.partyId, lead);
  }
  return out;
}
/** "Table 2 — Inside" + "Table 3 — Inside" → "Tables 2, 3 — Inside". */
function tablesLabel(party: Row[], t: T) {
  if (party.length === 1) return t(party[0].table.name);
  const parts = party.map((x) => x.table.name.match(/^Table (\d+)(?: — (.+))?$/));
  if (parts.every((m) => m && m[2] === parts[0]![2])) return `${t("Tables {list}", { list: parts.map((m) => m![1]).join(", ") })}${parts[0]![2] ? ` — ${t(parts[0]![2])}` : ""}`;
  return party.map((x) => t(x.table.name)).join(" · ");
}

const STATUS: Record<string, { label: string; tone: string }> = {
  BOOKED: { label: msg("Booked"), tone: "bg-sky-500/15 text-sky-300" }, CONFIRMED: { label: msg("Confirmed"), tone: "bg-violet-500/15 text-violet-300" },
  SEATED: { label: msg("Seated"), tone: "bg-emerald-500/15 text-emerald-300" }, CANCELLED: { label: msg("Cancelled"), tone: "bg-muted text-muted-foreground" }, NO_SHOW: { label: msg("No-show"), tone: "bg-rose-500/15 text-rose-300" },
};
const addDay = (d: string, n: number) => { const x = new Date(`${d}T12:00:00Z`); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
/** "Monday 12 October" in the reader's language. */
const longDay = (d: string, t: T) => new Date(`${d}T12:00:00Z`).toLocaleDateString(t.intl, { weekday: "long", day: "numeric", month: "long", timeZone: "UTC" });
const dayTitle = (d: string, today: string, t: T) => d === today ? t("Today") : d === addDay(today, 1) ? t("Tomorrow") : longDay(d, t);
const people = (n: number, t: T) => t.plural(n, "{n} person", "{n} people");
const open = (r: Row) => r.status === "BOOKED" || r.status === "CONFIRMED";
const tick = (cb: () => void) => { const t = setInterval(cb, 30_000); return () => clearInterval(t); };

/** The reservations: by day or week, searchable, every action one tap away. */
export function ReservationsBoard({ day, today, week, q, tables, rows, hotelGuests = null, basePath = "/staff/restaurant/reservations" }: {
  day: string; today: string; week: boolean; q: string; tables: TableOption[]; rows: Row[];
  /** Reception: book only for these staying guests. */
  hotelGuests?: HotelGuest[] | null;
  /** The page it sits on. */
  basePath?: string;
}) {
  const router = useRouter();
  const t = useT();
  const refresh = useCallback(() => router.refresh(), [router]);
  useLiveOrders(refresh, 5000);
  const [search, setSearch] = useState(q);
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ReservationDraft | null>(null);
  const [moving, setMoving] = useState<Group | null>(null);
  const [cancelling, setCancelling] = useState<Row | null>(null);
  const nowMin = useSyncExternalStore(tick, () => Math.floor(Date.now() / 60000), () => 0);
  const go = (p: { day?: string; view?: string | null; q?: string | null }) => {
    const sp = new URLSearchParams();
    const d = p.day ?? day, v = p.view === undefined ? (week ? "week" : null) : p.view, qq = p.q === undefined ? q : p.q;
    if (d !== today) sp.set("day", d);
    if (v) sp.set("view", v);
    if (qq) sp.set("q", qq);
    router.push(`${basePath}${sp.size ? `?${sp}` : ""}`);
  };
  const days = [...new Set(rows.map((r) => r.date))].sort();
  const groups = groupParties(rows);
  const coming = groups.filter(open);

  const roomOf = new Map((hotelGuests ?? []).map((g) => [g.id, g.rooms]));
  const seated = rows.filter((r) => r.status === "SEATED").length;
  const gone = rows.filter((r) => r.status === "CANCELLED" || r.status === "NO_SHOW").length;
  const strip = Array.from({ length: 7 }, (_, i) => addDay(today, i));
  const label = week ? t("{day} + 6 days", { day: dayTitle(day, today, t) }) : dayTitle(day, today, t);

  return (
    <div className="w-full space-y-5">
      {/* The day at a glance */}
      <header className="relative overflow-hidden rounded-3xl bg-[#15110c] text-white ring-1 ring-white/10">
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-28 size-80 rounded-full bg-violet-500/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-32 left-1/3 size-72 rounded-full bg-[oklch(0.75_0.13_80)]/10 blur-3xl" />
        <div className="relative flex flex-wrap items-center gap-4 px-5 pb-4 pt-5 sm:px-6">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-violet-500/25 text-violet-100 ring-1 ring-violet-300/30"><CalendarClock className="size-6" /></span>
          <div className="min-w-[12rem] flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.24em] text-[#f0cf86]">{t("Restaurant")}{hotelGuests ? ` · ${t("Hotel guests")}` : ""}</p>
            <h1 className="font-display text-[28px] font-semibold leading-tight">{t("Table reservations")}</h1>
            <p className="mt-0.5 text-xs text-white/60">{q ? t("Found for “{q}”", { q }) : label} · {coming.length ? `${t("{n} coming", { n: coming.length })}, ${t("{n} people", { n: coming.reduce((sum, r) => sum + r.guests, 0) })}` : t("nobody coming yet")}</p>
          </div>
          <Button onClick={() => setCreating(true)} className="h-11 rounded-xl bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] px-5 text-[oklch(0.2_0.03_60)] shadow-[0_10px_24px_-12px_oklch(0.7_0.12_75)] hover:brightness-105"><CalendarPlus />{t("New reservation")}</Button>
        </div>
        <dl className="relative grid grid-cols-2 gap-px border-t border-white/10 bg-white/5 sm:grid-cols-4">
          {[
            { label: t("Coming"), value: coming.length, sub: t("booked or confirmed"), tone: "text-violet-200" },
            { label: t("People expected"), value: coming.reduce((sum, r) => sum + r.guests, 0), sub: t("at those tables"), tone: "text-white" },
            { label: t("Seated"), value: seated, sub: t("already at their table"), tone: "text-emerald-300" },
            { label: t("Cancelled · no-show"), value: gone, sub: t("kept on record"), tone: gone ? "text-rose-300" : "text-white/50" },
          ].map((x) => (
            <div key={x.label} className="bg-[#15110c] px-5 py-3">
              <dt className="text-[10.5px] font-semibold uppercase tracking-[0.14em] text-white/50">{x.label}</dt>
              <dd className={cn("mt-1 text-2xl font-semibold tabular-nums", x.tone)}>{x.value}</dd>
              <p className="text-[11px] text-white/40">{x.sub}</p>
            </div>
          ))}
        </dl>
      </header>

      {/* Which day: the next seven at a tap, any date, a week at once, or a search */}
      <div className="flex flex-wrap items-center gap-2 rounded-2xl border border-border/70 bg-card p-2">
        {q ? (
          <button type="button" onClick={() => { setSearch(""); go({ q: null }); }} className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-muted px-3 text-sm"><X className="size-3.5" />{t("Found for “{q}” — back to the days", { q })}</button>
        ) : (
          <>
            <div className="flex w-full min-w-0 items-center gap-1.5 lg:w-auto lg:flex-1">
            <button type="button" onClick={() => go({ day: addDay(day, week ? -7 : -1) })} aria-label={t("Earlier")} className="grid size-9 shrink-0 place-items-center rounded-xl border border-border hover:bg-muted"><ChevronLeft className="size-4" /></button>
            <div className="flex min-w-0 flex-1 gap-1 overflow-x-auto [scrollbar-width:none]">
              {strip.map((d) => {
                const on = !week && d === day;
                const dt = new Date(`${d}T12:00:00Z`);
                return (
                  <button key={d} type="button" onClick={() => go({ day: d, view: null })} aria-pressed={on}
                    className={cn("flex min-w-[3.25rem] flex-1 shrink-0 flex-col items-center rounded-xl px-2 py-1.5 transition lg:flex-none lg:px-2.5", on ? "bg-violet-500/20 text-foreground ring-1 ring-violet-400/50" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
                    <span className="text-[10px] font-semibold uppercase tracking-wider">{d === today ? t("Today") : d === addDay(today, 1) ? t("Tmrw") : dt.toLocaleDateString(t.intl, { weekday: "short", timeZone: "UTC" })}</span>
                    <span className="text-base font-semibold tabular-nums">{dt.getUTCDate()}</span>
                  </button>
                );
              })}
            </div>
            <button type="button" onClick={() => go({ day: addDay(day, week ? 7 : 1) })} aria-label={t("Later")} className="grid size-9 shrink-0 place-items-center rounded-xl border border-border hover:bg-muted"><ChevronRight className="size-4" /></button>
            </div>
            <input type="date" value={day} onChange={(e) => e.target.value && go({ day: e.target.value })} className="h-9 rounded-xl border border-border bg-transparent px-2 text-sm" aria-label={t("Any date")} />
            <span className="inline-flex rounded-xl bg-muted p-0.5 text-xs">
              {[[msg("Day"), null], [msg("7 days"), "week"]].map(([l, v]) => (
                <button key={l} type="button" onClick={() => go({ view: v })} className={cn("rounded-lg px-3 py-1.5 font-semibold", (v === "week") === week ? "bg-background shadow-sm" : "text-muted-foreground")}>{t(l ?? "")}</button>
              ))}
            </span>
          </>
        )}
        <form className="relative min-w-[12rem] flex-1 lg:w-72 lg:flex-none" onSubmit={(e) => { e.preventDefault(); go({ q: search.trim() || null }); }}>
          <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t("Name, phone or TR- reference")} className="h-9 rounded-xl pl-9" />
        </form>
      </div>

      {rows.length === 0 ? (
        <div className="grid place-items-center rounded-3xl border border-dashed border-border/80 bg-card/40 px-6 py-16 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-violet-500/12 text-violet-300"><CalendarClock className="size-7" /></span>
          <p className="mt-3 text-base font-semibold">{q ? t("Nothing found for “{q}”", { q }) : week ? t("No reservations these 7 days") : day === today ? t("No reservations today") : t("No reservations on {day}", { day: dayTitle(day, today, t) })}</p>
          <p className="mt-1 text-sm text-muted-foreground">{hotelGuests ? t("Reserve a table for a guest staying in the hotel.") : t("Reserve a table — it shows as Reserved around the time.")}</p>
          <Button className="mt-4" onClick={() => setCreating(true)}><CalendarPlus />{t("Reserve a table")}</Button>
        </div>
      ) : days.map((d) => {
        const list = groups.filter((r) => r.date === d);
        const ahead = list.filter(open), done = list.filter((r) => !open(r));
        return (
          <section key={d} className="space-y-2.5">
            <h2 className="flex flex-wrap items-baseline gap-x-2 px-1">
              <span className="text-base font-semibold">{dayTitle(d, today, t)}</span>
              {dayTitle(d, today, t) !== longDay(d, t) && <span className="text-sm text-muted-foreground">{longDay(d, t)}</span>}
              <span className="text-xs text-muted-foreground">· {t("{n} coming", { n: ahead.length })}{ahead.length ? `, ${t("{n} people", { n: ahead.reduce((sum, r) => sum + r.guests, 0) })}` : ""}</span>
            </h2>
            <ul className="space-y-2">
              {[...ahead, ...done].map((r) => (
                <ReservationItem key={r.id} r={r} nowMin={nowMin} room={roomOf.get(r.customer.id) ?? null}
                  onEdit={() => setEditing({ id: r.id, name: r.customer.name, phone: r.customer.phone ?? "", date: r.clock.date, time: r.clock.time, guests: r.guests, notes: r.notes, locationId: r.table.id, table: r.table.name })}
                  onMove={() => setMoving(r)} onCancel={() => setCancelling(r)} />
              ))}
            </ul>
          </section>
        );
      })}

      <ReservationDialog open={creating || !!editing} onClose={() => { setCreating(false); setEditing(null); }} tables={tables} today={today} edit={editing} hotelGuests={hotelGuests} />
      {moving && <MoveReservation r={moving} tables={tables} onClose={() => setMoving(null)} />}
      {cancelling && <CancelReservation r={cancelling} onClose={() => setCancelling(null)} />}
    </div>
  );
}

function ReservationItem({ r, nowMin, room, onEdit, onMove, onCancel }: { r: Group; nowMin: number; /** The guest's room when they are staying here. */ room: string | null; onEdit: () => void; onMove: () => void; onCancel: () => void }) {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  const [seatWarn, setSeatWarn] = useState<{ text: string; reserved: boolean } | null>(null);
  const st = STATUS[r.status];
  const late = open(r) && nowMin > 0 && new Date(r.at).getTime() < nowMin * 60000;
  const act = (fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) => start(async () => {
    const res = await fn();
    if (res.ok) { toast.success(res.message ?? t("Saved.")); router.refresh(); } else toast.error(res.error ?? t("Could not save."));
  });
  // On the shared restaurant screen the waiter seating them says who they are — asked before the
  // transition starts (the PIN window cannot open inside it), and again for "seat anyway".
  const askPin = useWaiterPin();
  const seat = async (override = false) => {
    const pin = await askPin(t("Seat {name}", { name: r.customer.name }));
    if (pin === null) return;
    start(async () => {
      const res = await seatReservationAction({ id: r.id, override, pin });
      if (res.ok) { toast.success(t("{name} seated at {tables}.", { name: r.customer.name, tables: tablesLabel(r.party, t) })); router.refresh(); return; }
      // The server answers in the reader's language: "Reserved" may arrive translated.
      if (res.fieldErrors?.locationId) { setSeatWarn({ text: res.error, reserved: res.fieldErrors.locationId === "Reserved" || res.fieldErrors.locationId === t("Reserved") }); return; }
      toast.error(res.error);
    });
  };
  const initials = r.customer.name.replace(/\s*\(.*\)/, "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
  return (
    <li className={cn("overflow-hidden rounded-2xl border bg-card transition", open(r) ? "border-border/70 hover:border-violet-500/40" : "border-border/40 bg-card/50")}>
      <div className="flex flex-wrap items-stretch">
        {/* The time */}
        <div className={cn("flex w-16 shrink-0 flex-col items-center justify-center gap-0.5 border-r py-3 sm:w-20", open(r) ? "border-violet-500/20 bg-violet-500/[0.08]" : "border-border/40 bg-muted/30")}>
          <span className={cn("text-lg font-semibold leading-none tabular-nums sm:text-xl", open(r) ? "text-violet-700 dark:text-violet-100" : "text-muted-foreground")}>{r.clock.time}</span>
          {late ? <span className="rounded-full bg-amber-500/20 px-1.5 text-[9.5px] font-bold uppercase tracking-wider text-amber-700 dark:text-amber-300">{t("Late")}</span>
            : <span className={cn("rounded-full px-1.5 text-[9.5px] font-semibold", st.tone)}>{t(st.label)}</span>}
        </div>
        {/* Who, how many, where */}
        <div className="flex min-w-0 flex-1 items-start gap-3 px-3 py-3 sm:px-3.5">
          <span className={cn("hidden size-10 shrink-0 place-items-center rounded-full text-xs font-bold sm:grid", open(r) ? "bg-violet-500/15 text-violet-700 dark:text-violet-200" : "bg-muted text-muted-foreground")}>{initials}</span>
          <div className="min-w-0 flex-1 leading-tight">
            <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="truncate text-[15px] font-semibold">{r.customer.name}</span>
              {room && <span className="inline-flex items-center gap-1 rounded-full bg-violet-500/15 px-2 py-0.5 text-[10.5px] font-semibold text-violet-700 dark:text-violet-200"><BedDouble className="size-3" />{t("Room {room}", { room })}</span>}
              <span className="font-mono text-[10.5px] text-muted-foreground">{r.reference}</span>
            </p>
            <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs">
              <span className="inline-flex items-center gap-1 rounded-lg bg-muted/60 px-2 py-1"><Users className="size-3 text-muted-foreground" />{people(r.guests, t)}</span>
              <span className="inline-flex items-center gap-1 rounded-lg bg-muted/60 px-2 py-1"><Store className="size-3 text-muted-foreground" />{tablesLabel(r.party, t)}{r.party.length > 1 && <span className="ml-0.5 rounded-full bg-violet-500/15 px-1.5 text-[10px] font-semibold text-violet-700 dark:text-violet-300">{t("{n} tables", { n: r.party.length })}</span>}</span>
              {r.customer.phone && <a href={`tel:${r.customer.phone}`} className="inline-flex items-center gap-1 rounded-lg bg-muted/60 px-2 py-1 tabular-nums hover:text-foreground"><Phone className="size-3 text-muted-foreground" />{r.customer.phone}</a>}
            </p>
            {r.notes && <p className="mt-2 rounded-lg border-l-2 border-violet-400/50 bg-violet-500/[0.05] px-2.5 py-1 text-xs text-foreground/85">{r.notes}</p>}
            {r.status === "CANCELLED" && r.cancelReason && <p className="mt-1.5 text-xs text-muted-foreground">{t("Cancelled — {reason}", { reason: r.cancelReason })}</p>}
            {r.session && <Link href="/staff/restaurant/tables" className="mt-1.5 inline-flex items-center gap-1 text-xs font-semibold text-emerald-700 hover:underline dark:text-emerald-300">{t("At the table · session #{no} →", { no: r.session.number.replace(/^TS-\d{4}-0*/, "") })}</Link>}
            {r.moves.length > 0 && <p className="mt-1 text-[11px] text-muted-foreground">{r.moves.map((m) => m.by ? t("Moved {from} → {to} by {name}", { from: t(m.from.replace(/ — .*/, "")), to: t(m.to), name: m.by }) : t("Moved {from} → {to}", { from: t(m.from.replace(/ — .*/, "")), to: t(m.to) })).join(" · ")}</p>}
          </div>
        </div>
        {/* What to do */}
        {open(r) && (
          <div className="flex w-full flex-wrap items-center gap-1.5 border-t border-border/50 px-3.5 py-2.5 sm:w-40 sm:flex-col sm:items-stretch sm:justify-center sm:border-l sm:border-t-0 sm:px-3">
            <Button size="sm" className="bg-emerald-600 text-white hover:bg-emerald-500" disabled={pending} onClick={() => seat()}><Users />{t("Seat them")}</Button>
            <div className="flex flex-wrap gap-1 sm:justify-center">
              {r.status === "BOOKED" && <Button size="icon-sm" variant="outline" title={t("Confirm")} aria-label={t("Confirm")} disabled={pending} onClick={() => act(() => setReservationStatusAction({ id: r.id, to: "CONFIRMED" }))}><Check /></Button>}
              <Button size="icon-sm" variant="outline" title={t("Edit")} aria-label={t("Edit")} onClick={onEdit}><Pencil /></Button>
              <Button size="icon-sm" variant="outline" title={t("Move to another table")} aria-label={t("Move to another table")} onClick={onMove}><ArrowRightLeft /></Button>
              {late ? <Button size="icon-sm" variant="ghost" title={t("No-show")} aria-label={t("No-show")} disabled={pending} onClick={() => act(() => setReservationStatusAction({ id: r.id, to: "NO_SHOW" }))}><UserX /></Button>
                : <Button size="icon-sm" variant="ghost" title={t("Cancel")} aria-label={t("Cancel")} className="text-rose-300 hover:text-rose-200" onClick={onCancel}><X /></Button>}
            </div>
          </div>
        )}
      </div>
      {seatWarn && (
        <div className="border-t border-amber-500/20 bg-amber-500/10 px-3.5 py-2 text-xs text-amber-900 dark:text-amber-100">
          <p>{seatWarn.text}</p>
          <div className="mt-2 flex gap-2">
            {seatWarn.reserved && <Button size="sm" variant="outline" disabled={pending} onClick={() => seat(true)}>{t("Seat anyway")}</Button>}
            <Button size="sm" variant="outline" onClick={onMove}><ArrowRightLeft />{t("Choose another table")}</Button>
          </div>
        </div>
      )}
    </li>
  );
}

function MoveReservation({ r: g, tables, onClose }: { r: Group; tables: TableOption[]; onClose: () => void }) {
  const router = useRouter();
  const t = useT();
  const [fromId, setFromId] = useState(g.party[0].id);
  const r = g.party.find((x) => x.id === fromId) ?? g.party[0];
  const [to, setTo] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const areas = [...new Set(tables.map((x) => x.area ?? ""))];
  const move = () => start(async () => {
    if (!to) return;
    const res = await moveReservationAction({ id: r.id, locationId: to, reason: reason.trim() || undefined });
    if (res.ok) { toast.success(t("Now at {table}.", { table: t(res.data.to) })); onClose(); router.refresh(); } else toast.error(res.error);
  });
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader icon={<ArrowRightLeft />} eyebrow={t(r.table.name)} tone="violet">
          <DialogTitle>{t("Move {name}'s reservation", { name: r.customer.name })}</DialogTitle>
          <DialogDescription>{r.reference} · {r.clock.time} · {people(r.guests, t)} · {t("now {table}. The same reservation — the change is kept.", { table: t(r.table.name) })}</DialogDescription>
        </DialogHeader>
        {g.party.length > 1 && (
          <div className="space-y-1.5">
            <p className="text-sm font-medium">{t("Which of their tables?")}</p>
            <div className="flex flex-wrap gap-1.5">
              {g.party.map((x) => (
                <button key={x.id} type="button" onClick={() => { setFromId(x.id); setTo(null); }} aria-pressed={x.id === fromId}
                  className={cn("rounded-full border px-3 py-1 text-xs font-medium", x.id === fromId ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>{t(x.table.name)}</button>
              ))}
            </div>
          </div>
        )}
        {areas.map((a) => (
          <div key={a} className="flex items-center gap-2">
            <span className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{a === "INSIDE" ? t("Inside") : a === "OUTSIDE" ? t("Outside") : t("Other")}</span>
            <div className="grid flex-1 grid-cols-6 gap-1.5">
              {tables.filter((x) => (x.area ?? "") === a).map((tb) => (
                <button key={tb.id} type="button" disabled={g.party.some((x) => x.table.id === tb.id)} onClick={() => setTo(tb.id)} aria-pressed={to === tb.id}
                  className={cn("h-9 rounded-lg border text-sm font-semibold transition disabled:opacity-35", to === tb.id ? "border-violet-400 bg-violet-500/20 ring-2 ring-violet-400/30" : "border-border hover:bg-muted")}>{tb.number}</button>
              ))}
            </div>
          </div>
        ))}
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={t("Why? (optional)")} />
        <div className="flex gap-2">
          <Button disabled={pending || !to} onClick={move}>{pending ? <Loader2 className="animate-spin" /> : <ArrowRightLeft />}{t("Move it")}</Button>
          <Button variant="ghost" onClick={onClose}>{t("Cancel")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function CancelReservation({ r, onClose }: { r: Row; onClose: () => void }) {
  const router = useRouter();
  const t = useT();
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const cancel = () => start(async () => {
    const res = await setReservationStatusAction({ id: r.id, to: "CANCELLED", reason });
    if (res.ok) { toast.success(t("Reservation cancelled.")); onClose(); router.refresh(); } else toast.error(res.error);
  });
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader icon={<CalendarX />} eyebrow={t(r.table.name)} tone="rose">
          <DialogTitle>{t("Cancel {name}'s reservation?", { name: r.customer.name })}</DialogTitle>
          <DialogDescription>{r.reference} · {r.clock.time} · {t("{table}. It stays on record as cancelled, with the reason.", { table: t(r.table.name) })}</DialogDescription>
        </DialogHeader>
        <div className="flex flex-wrap gap-1.5">
          {[msg("They called to cancel"), msg("Booked by mistake"), msg("Changed to another day")].map((x) => (
            <button key={x} type="button" onClick={() => setReason(x)} className={cn("rounded-full border px-3 py-1 text-xs font-medium", reason === x ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>{t(x)}</button>
          ))}
        </div>
        <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={t("Or write the reason")} />
        <div className="flex gap-2">
          <Button variant="destructive" disabled={pending || !reason.trim()} onClick={cancel}>{pending ? <Loader2 className="animate-spin" /> : <X />}{t("Cancel the reservation")}</Button>
          <Button variant="ghost" onClick={onClose}>{t("Keep it")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
