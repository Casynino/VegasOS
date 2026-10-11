import type { ReactNode } from "react";
import { formatTZS } from "@/lib/format";
import type { RoomReportData } from "@/server/services/room-report-data";
import { BILL_STATE_LABEL, type BillState } from "@/lib/payment-status";

type Hotel = { name: string; tagline?: string | null; address: string; contact: string };

const INK = "#1d1a16", MUTED = "#6f665b", GOLD = "#c9a24a", LINE = "#e6dfd2";
const stamp = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(iso));
const day = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const short = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const n = (v: number) => v.toLocaleString("en-US");
/** "14:05" and "9 Oct, 14:05" — a moment, on the hotel's clock. */
const clock = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(iso));
const moment = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(iso));

function Section({ no, title, note, children }: { no: number; title: string; note?: string; children: ReactNode }) {
  return (
    <section data-break className="mt-8">
      <div className="mb-3 flex items-baseline gap-3 border-b pb-2" style={{ borderColor: LINE }}>
        <span className="text-xs font-semibold tabular-nums" style={{ color: GOLD }}>{String(no).padStart(2, "0")}</span>
        <h2 className="font-display text-lg font-semibold" style={{ color: INK }}>{title}</h2>
      </div>
      {note && <p className="mb-3 text-xs leading-relaxed" style={{ color: MUTED }}>{note}</p>}
      {children}
    </section>
  );
}

/**
 * `wide` = a table of one line per stay or payment: it scrolls sideways on a phone and fits the paper when printed.
 * A long table can run over a page: the PDF is cut between its rows (never through one, never right under the heading).
 */
function Table({ head, rows, foot, empty, right = [], narrow, wide }: { head: string[]; rows: ReactNode[][]; foot?: ReactNode[]; empty: string; right?: number[]; narrow?: boolean; wide?: boolean }) {
  if (!rows.length) return <p className="rounded-xl bg-[#f6f2ea] px-4 py-3 text-sm" style={{ color: MUTED }}>{empty}</p>;
  const cell = (i: number) => `px-2.5 py-2 align-top ${right.includes(i) ? "text-right tabular-nums" : "text-left"}`;
  return (
    <div className="report-scroll overflow-x-auto rounded-xl border" style={{ borderColor: LINE }}>
      <table className={`w-full border-collapse text-[12.5px] ${narrow ? "" : wide ? "min-w-[780px] print:min-w-0" : "min-w-[640px]"}`}>
        <thead>
          <tr className="bg-[#f6f2ea]" style={{ color: MUTED }}>{head.map((h, i) => <th key={h} className={`${cell(i)} text-[10.5px] font-semibold uppercase tracking-wider`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => <tr key={ri} data-break={ri >= 2 ? "" : undefined} className="break-inside-avoid border-t" style={{ borderColor: LINE }}>{r.map((c, i) => <td key={i} className={cell(i)}>{c}</td>)}</tr>)}
        </tbody>
        {foot && <tfoot><tr className="border-t-2 bg-[#faf8f3] font-semibold" style={{ borderColor: LINE }}>{foot.map((c, i) => <td key={i} className={cell(i)}>{c}</td>)}</tr></tfoot>}
      </table>
    </div>
  );
}

/** Group rows by room type, in the order the types first appear (the Boss reads the type and which rooms they were). */
function groupByType<T extends { type: string }>(rows: T[]): [string, T[]][] {
  const m = new Map<string, T[]>();
  for (const r of rows) m.set(r.type, [...(m.get(r.type) ?? []), r]);
  return [...m.entries()];
}
const sumOf = <T,>(rows: T[], f: (r: T) => number) => rows.reduce((t, r) => t + f(r), 0);
/** "101, 102, 105" — the room numbers of a group, in order. */
const roomNos = (rows: { room: string }[]) => rows.map((x) => x.room).sort((a, b) => a.localeCompare(b, undefined, { numeric: true })).join(", ");

function Card({ label, value, sub, accent }: { label: string; value: string; sub?: string; accent?: boolean }) {
  return (
    <div className="rounded-2xl border p-3.5" style={{ borderColor: LINE, background: accent ? "#15110c" : "#fff", color: accent ? "#fff" : INK }}>
      <p className="text-[10px] font-semibold uppercase tracking-[0.14em]" style={{ color: accent ? "#f0cf86" : MUTED }}>{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums leading-tight">{value}</p>
      {sub && <p className="mt-0.5 text-[11px]" style={{ color: accent ? "#d8cdb8" : MUTED }}>{sub}</p>}
    </div>
  );
}

function Bars({ items, money }: { items: { label: string; value: number; color?: string; sub?: string }[]; money?: boolean }) {
  const max = Math.max(1, ...items.map((i) => i.value));
  return (
    <ul className="space-y-2.5">
      {items.map((i) => (
        <li key={i.label}>
          <div className="flex items-baseline justify-between gap-3 text-xs"><span style={{ color: INK }}>{i.label}</span><span className="font-semibold tabular-nums">{money ? formatTZS(i.value) : n(i.value)}{i.sub && <span className="ml-1.5 font-normal" style={{ color: MUTED }}>{i.sub}</span>}</span></div>
          <div className="mt-1 h-2.5 overflow-hidden rounded-full bg-[#efe9dd]"><div className="h-full rounded-full" style={{ width: `${Math.max(i.value > 0 ? 2 : 0, (i.value / max) * 100)}%`, background: i.color ?? GOLD }} /></div>
        </li>
      ))}
    </ul>
  );
}

const RED = "#be123c", GREEN = "#047857";
/** "− 20,000" for money that goes out; "0" when there is none. */
const less = (v: number) => (v ? `− ${n(v)}` : "0");
/** An amount that may be below zero, written the way a person reads it. */
const signed = (v: number) => (v < 0 ? `− ${formatTZS(-v)}` : formatTZS(v));

/** A cell of two lines: the figure, and a small line under it that says what it is. */
function Two({ a, b }: { a: ReactNode; b?: ReactNode }) {
  return <><span className="block">{a}</span>{b ? <span className="block text-[10.5px] font-normal leading-snug" style={{ color: MUTED }}>{b}</span> : null}</>;
}
const AMBER = "#b45309";
const STATE_COLOR: Record<BillState, string> = { UNPAID: RED, PART_PAID: AMBER, PAID: GREEN, COMPANY_INVOICE: "#6d28d9", GROUP_PAYS: "#6d28d9", CREDIT: "#0369a1", NOTHING_DUE: MUTED };
/** Unpaid · Part paid · Paid — worked out from the bill and the payments, never from a label. */
function State({ s }: { s: BillState }) {
  return <b className="whitespace-nowrap" style={{ color: STATE_COLOR[s] }}>{BILL_STATE_LABEL[s]}</b>;
}
/** What is still owed: red when there is something, a plain 0 when there is not. */
const owes = (v: number) => (v > 0 ? <b style={{ color: RED }}>{n(v)}</b> : "0");
/** How many guests who left earlier and still owe are listed one by one; the rest are one line (the total is always complete). */
const LEFT_SHOWN = 12;

const STATUS_COLOR: Record<string, string> = { READY: "#10b981", OCCUPIED: "#8b5cf6", RESERVED: "#0ea5e9", DIRTY: "#f59e0b", CLEANING: "#f97316", MAINTENANCE: "#64748b", OUT_OF_SERVICE: "#f43f5e" };

/** The Daily Room Report as a printable document (A4, PDF) — the same on the Boss's link and in the staff app. */
export function RoomReportPaper({ d, hotel, number, version }: { d: RoomReportData; hotel: Hotel; number: string; version: number }) {
  const tz = d.timezone;
  const p = d.perf, m = d.money, today = d.day, rm = d.rooms;
  // Sections are numbered as they come: a report made before the stay-by-stay tables were added has fewer.
  let section = 0;
  const no = () => ++section;
  const leftOwing = rm ? rm.owing.filter((x) => x.state === "LEFT") : [];
  const owingShown = rm ? [...rm.owing.filter((x) => x.state !== "LEFT"), ...leftOwing.slice(0, LEFT_SHOWN)] : [];
  const owingRest = leftOwing.slice(LEFT_SHOWN);
  /** Under a stay's price: the extras on its bill, and a discount given on a later day (off the price now, still owed that day). */
  const priceNote = (x: { extras: number; discountLater?: number }) =>
    [x.extras ? `+ ${n(x.extras)} extras on the bill` : null, x.discountLater ? `after ${n(x.discountLater)} discount given on a later day` : null].filter(Boolean).join(" · ") || undefined;
  const soldLabel = { TODAY: "today's sale", STAYING: "earlier sale · still in the hotel", LEFT: "earlier sale · guest checked out", ADVANCE: "paid before arriving" } as const;
  // Income by department — the big three always, the rest only when they earned something.
  const departments = today ? [
    { label: "Rooms", value: today.income.rooms }, { label: "Restaurant", value: today.income.restaurant }, { label: "Bar", value: today.income.bar },
    ...[{ label: "Room service", value: today.income.roomService }, { label: "Meeting room", value: today.income.meeting }, { label: "Transport", value: today.income.transport }, { label: "Other services", value: today.income.other }].filter((x) => x.value !== 0),
  ] : [];
  const salesNights = d.sales.reduce((t, s) => t + (s.dayUse ? 0 : s.nights), 0);
  const realTrend = d.trend.filter((t) => t.occupied > 0 || t.sold > 0).length >= 2;
  const trendMax = Math.max(1, ...d.trend.map((t) => Math.max(t.occupied, t.sold)));
  return (
    <article id="report" className="mx-auto w-full max-w-[1000px] rounded-3xl bg-white p-5 shadow-sm sm:p-9 print:rounded-none print:p-0 print:shadow-none" style={{ color: INK }}>
      {/* Letterhead */}
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 pb-5" style={{ borderColor: INK }}>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: GOLD }}>{hotel.name}</p>
          <h1 className="mt-1 font-display text-3xl font-semibold leading-tight">Daily Room Report</h1>
          <p className="mt-1 text-sm font-medium">{day(d.date)}</p>
        </div>
        <div className="text-right text-[11px] leading-relaxed" style={{ color: MUTED }}>
          <p className="font-semibold tabular-nums" style={{ color: INK }}>{number}{version > 1 ? ` · v${version}` : ""}</p>
          <p>Business day {stamp(d.periodStart, tz)}</p>
          <p>→ {stamp(d.periodEnd, tz)}</p>
          <p>Generated {stamp(d.generatedAt, tz)}</p>
        </div>
      </header>

      {/* 1 · Summary */}
      <Section no={no()} title="Summary" note="Occupied = every room that had a guest at any time in the period. New check-ins are the rooms sold (checked in) in the period — a guest staying several nights is counted once, on the check-in day only.">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <Card accent label="Occupied" value={`${p.occupied} / ${d.guestRooms}`} sub={`${p.occupancyPct}% occupancy`} />
          <Card label="New check-ins" value={n(p.newSales)} sub={rm && p.newSales ? `${rm.checkIns.walkIns} walk-in · ${rm.checkIns.reservations} with a reservation` : "rooms sold today"} />
          <Card label="Continuing stays" value={n(p.continuing)} sub="checked in before, still in house" />
          <Card label="Checked out" value={n(p.checkedOut)} />
          <Card label="Available now" value={n(p.available)} sub="ready for sale" />
          <Card label="Room nights sold" value={n(p.nightsSold)} sub="by the new check-ins" />
        </div>
        <div className="mt-2.5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {today ? (
            <>
              <Card label="Income today" value={formatTZS(today.income.total)} sub={`Rooms ${formatTZS(today.income.rooms)}`} />
              <Card label="Expenses" value={formatTZS(today.expenses.total)} sub="spent today" />
              <Card accent label="Net profit" value={signed(today.profit)} sub={today.profit < 0 ? "more was spent than earned" : "income − expenses"} />
              <Card label={rm ? "Money received — whole hotel" : "Money received"} value={formatTZS(today.received)} sub={rm ? "rooms, restaurant, bar and the rest" : `Still owed ${formatTZS(today.owed)}`} />
            </>
          ) : (
            <>
              <Card accent label="Room income today" value={formatTZS(m.recognized)} sub="tonight, every room with a guest" />
              <Card label="Money received" value={formatTZS(m.collected)} sub="from guests today" />
              <Card label="Still owed" value={formatTZS(m.outstanding)} sub="by these guests" />
            </>
          )}
        </div>
        {rm && (
          <div className="mt-4">
            <Table narrow empty="" head={["Room money today — five different figures", "Amount (TZS)"]} right={[1]}
              rows={[
                [<Two key="a" a={<b>Rooms sold today</b>} b={`${p.newSales} ${p.newSales === 1 ? "room" : "rooms"} checked in — the price of the whole stay, paid or not yet`} />, <b key="b">{n(m.expected)}</b>],
                [<Two key="a" a={<b>Room income today</b>} b="tonight's price of every room with a guest — new and continuing" />, <b key="b">{n(m.recognized)}</b>],
                [<Two key="a" a={<b>Paid by room guests today</b>} b="money actually received today, for any room" />, <b key="b">{n(rm.received.total)}</b>],
                [<Two key="a" a={<span className="pl-4">… of it, for rooms sold before today</span>} b={<span className="pl-4">guests paying for an earlier day&apos;s sale</span>} />, <span key="b" style={{ color: rm.received.earlier ? AMBER : INK }}>{n(rm.received.earlier)}</span>],
                ...(rm.received.advance ? [[<Two key="a" a={<span className="pl-4">… of it, paid ahead by guests who had not arrived</span>} />, n(rm.received.advance)]] : []),
                [<Two key="a" a={<b>Still owed by room guests</b>} b="as this business day closed" />, <span key="b">{owes(rm.owed)}</span>],
              ]} />
            <p className="mt-2 text-[11px] leading-relaxed" style={{ color: MUTED }}>These figures measure different things, so they are shown side by side and never added together. A room sold today may be paid tomorrow: it stays today&apos;s sale, and the money shows in tomorrow&apos;s report.</p>
          </div>
        )}
      </Section>

      {/* 2 · New room sales, by room type */}
      <Section no={no()} title="Rooms sold today" note="Rooms checked in during the period, by room type. The amounts are for the whole stay — all the nights the guest booked — at the price each night was sold for.">
        <Table empty="No room was checked in during this period."
          head={["Room type", "Rooms", "Rooms sold", "Nights", "Full price", "Discount", "Sold for", "Average per night"]} right={[2, 3, 4, 5, 6, 7]}
          rows={groupByType(d.sales).map(([type, rs]) => {
            const nights = sumOf(rs, (x) => x.nights), net = sumOf(rs, (x) => x.total);
            return [<b key="t">{type}</b>, roomNos(rs), rs.length, nights, n(sumOf(rs, (x) => x.gross)), n(sumOf(rs, (x) => x.discount)), n(net), nights ? n(Math.round(net / nights)) : "—"];
          })}
          foot={["Total", "", d.sales.length, salesNights, n(sumOf(d.sales, (x) => x.gross)), n(sumOf(d.sales, (x) => x.discount)), n(sumOf(d.sales, (x) => x.total)), salesNights ? n(Math.round(sumOf(d.sales, (x) => x.total) / salesNights)) : "—"]} />
        {d.unknownRates > 0 && <p className="mt-2 text-[11px]" style={{ color: "#b45309" }}>{d.unknownRates} stay(s) have no price per night on record — their totals are shown, their price is not guessed.</p>}
        {rm && rm.sold.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold">Each room sold today, and what has been paid for it</p>
            <Table wide empty=""
              head={["Room", "Guest", "Checked in", "Nights × price", "Sold for", "Paid", "Still owed", "Status"]} right={[4, 5, 6]}
              rows={rm.sold.map((x) => [
                <Two key="r" a={<b>{x.rooms}</b>} b={x.types} />,
                <Two key="g" a={x.guest} b={x.reference} />,
                <Two key="c" a={clock(x.checkedInAt, tz)} b={x.walkIn ? "Walk-in" : "Reservation"} />,
                <Two key="n" a={x.dayUse ? `Day use${x.rate !== null ? ` · ${n(x.rate)}` : ""}` : x.rate !== null ? `${x.nights} × ${n(x.rate)}${x.mixed ? " (average)" : ""}` : `${x.nights} ${x.nights === 1 ? "night" : "nights"}`}
                  b={x.discount > 0 ? `full price ${n(x.gross)}, discount ${n(x.discount)}` : undefined} />,
                <Two key="t" a={<b>{n(x.total)}</b>} b={priceNote(x)} />,
                <Two key="p" a={n(x.paid)} b={x.company ? `+ ${n(x.company)} on a company invoice` : undefined} />,
                <span key="o">{owes(x.owed)}</span>,
                <Two key="s" a={<State s={x.status} />} b={x.also ? `bill shared with room ${x.also}` : undefined} />,
              ])}
              foot={["Total", "", `${sumOf(rm.sold, (x) => x.rooms.split(", ").length)} rooms`, "", n(sumOf(rm.sold, (x) => x.total)), n(sumOf(rm.sold, (x) => x.paid)), n(sumOf(rm.sold, (x) => Math.max(0, x.owed))), ""]} />
            <p className="mt-2 text-[11px] leading-relaxed" style={{ color: MUTED }}>Paid and Still owed are the guest&apos;s whole bill as this business day closed. A guest who pays on a later day stays unpaid here — that payment appears in the report of the day it was received.</p>
          </div>
        )}
      </Section>

      {/* 3 · Rooms sold, by price per night */}
      <Section no={no()} title="Rooms sold by price per night" note="Grouped by the price of ONE night, not the whole stay: a 3-night stay at TZS 60,000 a night is three nights in the 60,000 group.">
        <Table empty="No new sales to group."
          head={["Price per night", "Stays", "Room nights", "Amount"]} right={[0, 1, 2, 3]}
          rows={d.rates.map((g) => [g.rate === 0 ? "Complimentary (0)" : n(g.rate), g.stays, g.nights, n(g.expected)])}
          foot={["Total", "", d.rates.reduce((t, g) => t + g.nights, 0), n(d.rates.reduce((t, g) => t + g.expected, 0))]} />
        {d.rates.length > 0 && <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: LINE }}><p className="mb-3 text-xs font-semibold">Room nights sold, by price per night</p><Bars items={d.rates.map((g) => ({ label: `TZS ${n(g.rate)}`, value: g.nights, sub: `${g.nights === 1 ? "night" : "nights"}` }))} /></div>}
      </Section>

      {/* 4 · Continuing stays, by room type */}
      <Section no={no()} title="Continuing stays — not new room sales" note="Guests who checked in before this period and are still in house at its end. They are not new sales; tonight's price of their room is part of today's room income.">
        <Table empty="No stay continued from before this period."
          head={["Room type", "Rooms", "How many", "Nights booked", "Nights used so far", "Nights remaining"]} right={[2, 3, 4, 5]}
          rows={groupByType(d.continuing).map(([type, rs]) => [<b key="t">{type}</b>, roomNos(rs), rs.length, sumOf(rs, (x) => x.nights), sumOf(rs, (x) => x.elapsed), sumOf(rs, (x) => x.remaining)])}
          foot={["Total", "", d.continuing.length, sumOf(d.continuing, (x) => x.nights), sumOf(d.continuing, (x) => x.elapsed), sumOf(d.continuing, (x) => x.remaining)]} />
        {rm && rm.staying.length > 0 && (
          <div className="mt-4">
            <p className="mb-2 text-xs font-semibold">Each continuing stay, and what has been paid for it</p>
            <Table wide empty=""
              head={["Room", "Guest", "Stay", "Tonight", "Whole stay", "Paid", "Still owed", "Status"]} right={[3, 4, 5, 6]}
              rows={rm.staying.map((x) => [
                <Two key="r" a={<b>{x.rooms}</b>} b={x.types} />,
                <Two key="g" a={x.guest} b={x.reference} />,
                <Two key="d" a={`${moment(x.checkedInAt, tz)} → ${short(x.departure)}`} b={`${x.nights} ${x.nights === 1 ? "night" : "nights"} booked`} />,
                x.tonight !== null ? n(x.tonight) : "—",
                <Two key="t" a={<b>{n(x.total)}</b>} b={priceNote(x)} />,
                <Two key="p" a={n(x.paid)} b={x.company ? `+ ${n(x.company)} on a company invoice` : undefined} />,
                <span key="o">{owes(x.owed)}</span>,
                <Two key="s" a={<State s={x.status} />} b={x.also ? `bill shared with room ${x.also}` : undefined} />,
              ])}
              foot={["Total", "", `${sumOf(rm.staying, (x) => x.rooms.split(", ").length)} rooms`, n(sumOf(rm.staying, (x) => x.tonight ?? 0)), n(sumOf(rm.staying, (x) => x.total)), n(sumOf(rm.staying, (x) => x.paid)), n(sumOf(rm.staying, (x) => Math.max(0, x.owed))), ""]} />
            <p className="mt-2 text-[11px] leading-relaxed" style={{ color: MUTED }}>Tonight is the price of this one night — the only part of a continuing stay that is today&apos;s room income. Whole stay is the price agreed for all its nights; it was counted as a sale on the day the guest checked in.</p>
          </div>
        )}
      </Section>

      {/* Payments received from room guests — each with the day its room was sold */}
      {rm && (
        <Section no={no()} title="Payments received from room guests" note="Every payment recorded today against a room, whenever that room was sold. A payment is counted on the day the money was received — it is never moved back to the day the room was sold.">
          <Table narrow empty="" head={["Paid today", "Amount (TZS)"]} right={[1]}
            rows={[
              ["For rooms sold today", n(rm.received.today)],
              [<span key="a" style={{ color: rm.received.staying ? AMBER : INK }}>For rooms sold on earlier days — guest still in the hotel</span>, n(rm.received.staying)],
              [<span key="a" style={{ color: rm.received.left ? AMBER : INK }}>For rooms sold on earlier days — guest has checked out</span>, n(rm.received.left)],
              ...(rm.received.advance ? [["Paid before arriving — guest not checked in yet", n(rm.received.advance)]] : []),
            ]}
            foot={["Total paid by room guests today", n(rm.received.total)]} />
          {(rm.received.refunds > 0 || m.reversed > 0) && (
            <p className="mt-2 text-[11px] leading-relaxed" style={{ color: MUTED }}>
              {rm.received.refunds > 0 && <>Money given back to guests today (refunds): TZS {n(rm.received.refunds)} — not taken off the total above. </>}
              {m.reversed > 0 && <>Payments cancelled today as recording mistakes: TZS {n(m.reversed)} — a cancelled payment is not counted on any day.</>}
            </p>
          )}
          <div className="mt-4">
            <Table wide empty="No payment was recorded against a room in this period."
              head={["Time", "Room", "Guest", "Room sold on", "Amount", "How", "Reference", "Recorded by"]} right={[4]}
              rows={rm.payments.map((x) => [
                clock(x.at, tz),
                <b key="r">{x.rooms}</b>,
                <Two key="g" a={x.guest} b={x.reference} />,
                <Two key="d" a={x.soldOn ? (x.group === "TODAY" ? short(x.soldOn) : <b style={{ color: AMBER }}>{short(x.soldOn)}</b>) : "Not checked in yet"} b={soldLabel[x.group]} />,
                x.reversed ? <Two key="a" a={<s>{n(x.amount)}</s>} b="cancelled — not counted" />
                  : x.refund ? <Two key="a" a={`− ${n(x.amount)}`} b="given back (refund) — not in the total" />
                  : <b key="a">{n(x.amount)}</b>,
                x.method === x.account ? x.method : <Two key="h" a={x.method} b={x.account} />,
                x.ref ?? "—",
                x.by,
              ])}
              foot={["Total", "", `${rm.payments.filter((x) => !x.reversed && !x.refund).length} payments`, "", n(rm.received.total), "", "", ""]} />
          </div>
        </Section>
      )}

      {/* Still owed by room guests, as the day closed */}
      {rm && (
        <Section no={no()} title="Still owed by room guests — as the day closed" note="What each room guest still owed when this business day ended: guests in the hotel, and guests who left without paying in full. A payment made after the day closed is not taken off here — it shows in the report of the day it was received.">
          <Table wide empty="No room guest owed anything when this day closed."
            head={["Room", "Guest", "Room sold on", "Bill", "Paid", "Still owed", "Status"]} right={[3, 4, 5]}
            rows={[
              ...owingShown.map((x) => [
                <b key="r">{x.rooms}</b>,
                <Two key="g" a={x.guest} b={x.reference} />,
                <Two key="d" a={short(x.soldOn)} b={x.state === "SOLD_TODAY" ? "sold today" : x.state === "STAYING" ? "still in the hotel" : x.leftOn ? `left ${short(x.leftOn)}` : "has left"} />,
                <Two key="t" a={n(x.total)} b={[x.discount ? `after a discount of ${n(x.discount)}` : null, x.company ? `${n(x.company)} on a company invoice` : null].filter(Boolean).join(" · ") || undefined} />,
                n(x.paid),
                <span key="o">{owes(x.owed)}</span>,
                <State key="s" s={x.status} />,
              ]),
              ...(owingRest.length ? [[
                <span key="r" style={{ color: MUTED }}>+ {owingRest.length} more</span>, <span key="g" style={{ color: MUTED }}>guests who left earlier</span>, "",
                n(sumOf(owingRest, (x) => x.total)), n(sumOf(owingRest, (x) => x.paid)), <span key="o">{owes(sumOf(owingRest, (x) => x.owed))}</span>, "",
              ]] : []),
            ]}
            foot={["Total still owed", "", `${rm.owing.length} ${rm.owing.length === 1 ? "booking" : "bookings"}`, n(sumOf(rm.owing, (x) => x.total)), n(sumOf(rm.owing, (x) => x.paid)), n(rm.owed), ""]} />
        </Section>
      )}

      {/* Check-outs + room status */}
      <Section no={no()} title="Check-outs & room status" note={rm ? "A check-out does not mean the bill was paid. Charges, payments and balance are for the whole booking as this day closed. A room that is checked out but dirty is not ready for sale. Room status is as at the time the report was generated." : "Charges, payments and balance are for the whole booking. A room that is checked out but dirty is not ready for sale. Room status is as at the time the report was generated."}>
        <Table empty="Nobody checked out in this period."
          head={["Room type", "Rooms", "Check-outs", "Final charges", "Paid", "Still owed"]} right={[2, 3, 4, 5]}
          rows={groupByType(d.checkouts).map(([type, rs]) => [<b key="t">{type}</b>, roomNos(rs), rs.length, n(sumOf(rs, (x) => x.charges)), n(sumOf(rs, (x) => x.paid)), sumOf(rs, (x) => x.outstanding) ? <b key="o" style={{ color: "#be123c" }}>{n(sumOf(rs, (x) => x.outstanding))}</b> : "0"])}
          foot={["Total", "", d.checkouts.length, n(sumOf(d.checkouts, (x) => x.charges)), n(sumOf(d.checkouts, (x) => x.paid)), n(sumOf(d.checkouts, (x) => x.outstanding))]} />
        <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: LINE }}>
          <p className="mb-3 text-xs font-semibold">Guest rooms by status ({d.guestRooms} rooms; the meeting room is not included)</p>
          <Bars items={d.status.map((s) => ({ label: s.label, value: s.count, color: STATUS_COLOR[s.key] }))} />
        </div>
      </Section>

      {/* 6 · Money today — income, expenses, net profit */}
      {today ? (
        <Section no={no()} title={rm ? "Money today — the whole hotel" : "Money today"} note="Income is what the hotel earned today. Expenses are what was spent today. Net profit is income minus expenses.">
          <Table narrow empty="" head={["Income", "Amount (TZS)"]} right={[1]}
            rows={[
              ...departments.map((x) => [x.label, n(x.value)]),
              ...(today.income.refunds ? [["Less money given back to guests (refunds)", less(today.income.refunds)]] : []),
              [<b key="a">Total income</b>, <b key="b">{n(today.income.total)}</b>],
              ["Expenses", less(today.expenses.total)],
            ]}
            foot={["Net profit", <span key="p" style={{ color: today.profit < 0 ? RED : GREEN }}>{today.profit < 0 ? `− ${n(-today.profit)}` : n(today.profit)}</span>]} />
          <p className="mt-2 text-[11px] leading-relaxed" style={{ color: MUTED }}>
            Room income is tonight&apos;s price of every room with a guest. A guest staying 3 nights is counted one night each day — never three nights at once.
            {rm && m.recognized > 0 && <> Today: TZS {n(rm.income.sold)} from the rooms sold today and TZS {n(rm.income.staying)} from continuing stays{rm.income.other ? <>, and TZS {n(rm.income.other)} from guests who checked in outside this day&apos;s hours (an early or late arrival)</> : null}.</>}
          </p>

          {today.expenses.byCategory.length > 0 && (
            <div className="mt-4">
              <Table narrow empty="" head={["Where the expenses went", "Amount (TZS)"]} right={[1]}
                rows={today.expenses.byCategory.map((c) => [c.name, n(c.amount)])}
                foot={["Total expenses", n(today.expenses.total)]} />
            </div>
          )}

          <div className="mt-4">
            <Table narrow empty="" head={["Money in hand", "Amount (TZS)"]} right={[1]}
              rows={[
                [rm ? "Money received today — rooms, restaurant, bar and the rest (cash, mobile money, bank, card)" : "Money received today — cash, mobile money, bank, card", n(today.received)],
                ...(rm ? [[<span key="a" className="pl-4">{rm.received.refunds > 0 ? `… of it, from room guests (payments less TZS ${n(rm.received.refunds)} given back)` : "… of it, paid by room guests"}</span>, n(rm.received.total - rm.received.refunds)]] : []),
                [rm ? "Still owed to the hotel — all guests, companies and unpaid orders, when this report was made" : "Still owed to the hotel — all guests and companies", today.owed ? <b key="o" style={{ color: RED }}>{n(today.owed)}</b> : "0"],
              ]} />
            <p className="mt-2 text-[11px] leading-relaxed" style={{ color: MUTED }}>Money received is not the same as income: a guest may pay today for other nights, or pay later.</p>
          </div>

          {departments.filter((x) => x.value > 0).length > 1 && (
            <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: LINE }}>
              <p className="mb-3 text-xs font-semibold">Where the income came from</p>
              <Bars money items={departments.filter((x) => x.value > 0)} />
            </div>
          )}
        </Section>
      ) : (
        <Section no={no()} title="Money today" note="Room money only.">
          <Table narrow empty="" head={["Rooms", "Amount (TZS)"]} right={[1]}
            rows={[
              ["Room income tonight — every room with a guest", n(m.recognized)],
              ["Money received from guests today", n(m.collected)],
              ["Money given back to guests (refunds)", less(m.refunds)],
              [<b key="c">Still owed by these guests</b>, <b key="d" style={{ color: m.outstanding ? RED : INK }}>{n(m.outstanding)}</b>],
            ]} />
        </Section>
      )}

      {/* 7 · Trend */}
      {realTrend && (
        <Section no={no()} title="Last 7 days" note="From the real nights and check-ins on record.">
          <div className="grid grid-cols-7 items-end gap-2 rounded-2xl border p-4" style={{ borderColor: LINE }}>
            {d.trend.map((t) => (
              <div key={t.date} className="text-center">
                <div className="flex h-28 items-end justify-center gap-1">
                  <div title={`${t.occupied} rooms occupied`} className="w-3.5 rounded-t" style={{ height: `${(t.occupied / trendMax) * 100}%`, background: "#8b5cf6" }} />
                  <div title={`${t.sold} new check-ins`} className="w-3.5 rounded-t" style={{ height: `${(t.sold / trendMax) * 100}%`, background: GOLD }} />
                </div>
                <p className="mt-1.5 text-[10.5px] tabular-nums" style={{ color: MUTED }}>{short(t.date)}</p>
                <p className="text-[10.5px] font-semibold tabular-nums">{t.occupied}/{t.sold}</p>
              </div>
            ))}
          </div>
          <p className="mt-2 text-[11px]" style={{ color: MUTED }}><span style={{ color: "#8b5cf6" }}>■</span> rooms occupied · <span style={{ color: GOLD }}>■</span> new check-ins</p>
        </Section>
      )}

      {/* 8 · Reception */}
      <Section no={no()} title="Reception summary" note="Each check-in, check-out and payment is credited to the person who recorded it — never to two people.">
        <Table empty="No reception activity was recorded."
          head={["Receptionist", "Shift", "Check-ins", "Walk-ins", "Check-outs", "Payments", "Money received"]} right={[2, 3, 4, 5, 6]}
          rows={d.staff.map((s, i) => [<a key="n" href={`?r=${i}`} className="font-bold underline decoration-dotted print:no-underline">{s.name.replace(/\s*\(.*\)/, "")}</a>, s.shift ?? "—", s.checkIns, s.walkIns, s.checkOuts, s.payments, n(s.collected)])} />
      </Section>

      {/* How the figures are counted, and anything in the records that needs a look */}
      {rm && (
        <Section no={no()} title="How these figures are counted">
          <ul className="space-y-1.5 text-[11.5px] leading-relaxed" style={{ color: MUTED }}>
            <li><b style={{ color: INK }}>Business day.</b> {stamp(d.periodStart, tz)} → {stamp(d.periodEnd, tz)}. Everything in this report happened inside these hours.</li>
            <li><b style={{ color: INK }}>Room sold.</b> Counted once, on the day the guest checked in, at the price of the whole stay. It stays on that day whenever it is paid.</li>
            <li><b style={{ color: INK }}>Room income.</b> Tonight&apos;s price of every room with a guest. A 3-night stay is one sale, and one night of income on each of its three days.</li>
            <li><b style={{ color: INK }}>Payment.</b> Counted on the day the money was received, against the booking it was paid for — one room can have a guest who left owing and a new guest on the same day; they are two separate stays.</li>
            <li><b style={{ color: INK }}>Still owed.</b> The guest&apos;s bill (room after discount, plus extras) less what had been paid when the day closed. A bill moved to a company invoice is not counted as paid.</li>
            <li><b style={{ color: INK }}>This report is kept as it was made.</b> A payment received later does not change it.</li>
          </ul>
          {rm.notes.length > 0 && (
            <div className="mt-3 rounded-xl border px-4 py-3 text-[11.5px] leading-relaxed" style={{ borderColor: "#f1d9a8", background: "#fdf7e8", color: AMBER }}>
              <p className="font-semibold">Records that need a look</p>
              <ul className="mt-1 list-disc space-y-1 pl-4">{rm.notes.map((x) => <li key={x}>{x}</li>)}</ul>
            </div>
          )}
        </Section>
      )}

      <footer className="mt-10 border-t pt-4 text-center text-[11px] leading-relaxed" style={{ borderColor: LINE, color: MUTED }}>
        <p className="font-semibold" style={{ color: INK }}>{hotel.name} · Automated Management Report</p>
        {hotel.address && <p>{hotel.address}</p>}
        {hotel.contact && <p>{hotel.contact}</p>}
        <p className="mt-1">Prepared automatically from the hotel&apos;s reservation, check-in and payment records.</p>
      </footer>
    </article>
  );
}

/** One receptionist's own report for the day — their check-ins, check-outs and money, and their share of the hotel's day. */
export function ReceptionistRoomReport({ d, index, hotel, number, version }: { d: RoomReportData; index: number; hotel: Hotel; number: string; version: number }) {
  const s = d.staff[index];
  const tz = d.timezone;
  const name = s.name.replace(/\s*\(.*\)/, "");
  const role = /\((.*)\)/.exec(s.name)?.[1];
  const total = d.staff.reduce((t, x) => ({ ci: t.ci + x.checkIns, co: t.co + x.checkOuts, pay: t.pay + x.payments, cash: t.cash + x.collected }), { ci: 0, co: 0, pay: 0, cash: 0 });
  const share = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");
  const card = (label: string, value: ReactNode, sub?: string) => (
    <div className="rounded-2xl border px-4 py-3" style={{ borderColor: LINE }}>
      <p className="text-[10.5px] font-semibold uppercase tracking-wider" style={{ color: MUTED }}>{label}</p>
      <p className="mt-1 font-display text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[11px]" style={{ color: MUTED }}>{sub}</p>}
    </div>
  );
  return (
    <article id="report" className="mx-auto w-full max-w-[1000px] rounded-3xl bg-white p-5 shadow-sm sm:p-9 print:rounded-none print:p-0 print:shadow-none" style={{ color: INK }}>
      <header className="flex flex-wrap items-start justify-between gap-4 border-b-2 pb-5" style={{ borderColor: INK }}>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.24em]" style={{ color: GOLD }}>{hotel.name}</p>
          <h1 className="mt-1 font-display text-3xl font-semibold leading-tight">Receptionist report</h1>
          <p className="mt-1 text-sm font-medium">{name}{role ? ` · ${role}` : ""} — {day(d.date)}</p>
          {s.shift && <p className="text-xs" style={{ color: MUTED }}>Shift {s.shift}</p>}
        </div>
        <div className="text-right text-[11px] leading-relaxed" style={{ color: MUTED }}>
          <p className="font-semibold tabular-nums" style={{ color: INK }}>{number}-R{index + 1}{version > 1 ? ` · v${version}` : ""}</p>
          <p>Business day {stamp(d.periodStart, tz)}</p>
          <p>→ {stamp(d.periodEnd, tz)}</p>
        </div>
      </header>
      <Section no={1} title="Their day" note="Each check-in, check-out and payment is credited to the person who recorded it — never to two people.">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          {card("Check-ins", s.checkIns, `${s.walkIns} walk-in${s.walkIns === 1 ? "" : "s"} · ${share(s.checkIns, total.ci)} of the hotel's`)}
          {card("Check-outs", s.checkOuts, `${share(s.checkOuts, total.co)} of the hotel's`)}
          {card("Payments recorded", s.payments, `${share(s.payments, total.pay)} of the hotel's`)}
          {card("Money received", `TZS ${n(s.collected)}`, `${share(s.collected, total.cash)} of the hotel's`)}
        </div>
      </Section>
      <Section no={2} title="The hotel that day">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {card("Occupancy", `${d.perf.occupancyPct}%`, `${d.perf.occupied} of ${d.guestRooms} rooms`)}
          {card("New check-ins", d.perf.newSales)}
          {card("Check-outs", d.perf.checkedOut)}
          {card("Money received", `TZS ${n(d.money.collected)}`, "from guests")}
        </div>
      </Section>
      <footer className="mt-10 border-t pt-4 text-center text-[11px] leading-relaxed" style={{ borderColor: LINE, color: MUTED }}>
        <p className="font-semibold" style={{ color: INK }}>{hotel.name} · Automated Management Report</p>
        <p className="mt-1">Prepared automatically from the hotel&apos;s reservation, check-in and payment records.</p>
      </footer>
    </article>
  );
}
