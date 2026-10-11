import type { ReactNode } from "react";
import { formatTZS } from "@/lib/format";
import type { RoomReportData } from "@/server/services/room-report-data";

type Hotel = { name: string; tagline?: string | null; address: string; contact: string };

const INK = "#1d1a16", MUTED = "#6f665b", GOLD = "#c9a24a", LINE = "#e6dfd2";
const stamp = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(iso));
const day = (d: string) => new Intl.DateTimeFormat("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const short = (d: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: "UTC" }).format(new Date(`${d}T00:00:00Z`));
const n = (v: number) => v.toLocaleString("en-US");

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

function Table({ head, rows, foot, empty, right = [], narrow }: { head: string[]; rows: ReactNode[][]; foot?: ReactNode[]; empty: string; right?: number[]; narrow?: boolean }) {
  if (!rows.length) return <p className="rounded-xl bg-[#f6f2ea] px-4 py-3 text-sm" style={{ color: MUTED }}>{empty}</p>;
  const cell = (i: number) => `px-2.5 py-2 ${right.includes(i) ? "text-right tabular-nums" : "text-left"}`;
  return (
    <div className="report-scroll overflow-x-auto rounded-xl border" style={{ borderColor: LINE }}>
      <table className={`w-full border-collapse text-[12.5px] ${narrow ? "" : "min-w-[640px]"}`}>
        <thead>
          <tr className="bg-[#f6f2ea]" style={{ color: MUTED }}>{head.map((h, i) => <th key={h} className={`${cell(i)} text-[10.5px] font-semibold uppercase tracking-wider`}>{h}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((r, ri) => <tr key={ri} className="border-t" style={{ borderColor: LINE }}>{r.map((c, i) => <td key={i} className={cell(i)}>{c}</td>)}</tr>)}
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

const STATUS_COLOR: Record<string, string> = { READY: "#10b981", OCCUPIED: "#8b5cf6", RESERVED: "#0ea5e9", DIRTY: "#f59e0b", CLEANING: "#f97316", MAINTENANCE: "#64748b", OUT_OF_SERVICE: "#f43f5e" };

/** The Daily Room Report as a printable document (A4, PDF) — the same on the Boss's link and in the staff app. */
export function RoomReportPaper({ d, hotel, number, version }: { d: RoomReportData; hotel: Hotel; number: string; version: number }) {
  const tz = d.timezone;
  const p = d.perf, m = d.money, today = d.day;
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
      <Section no={1} title="Summary" note="Occupied = every room that had a guest at any time in the period. New check-ins are the rooms sold (checked in) in the period — a guest staying several nights is counted once, on the check-in day only.">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-3">
          <Card accent label="Occupied" value={`${p.occupied} / ${d.guestRooms}`} sub={`${p.occupancyPct}% occupancy`} />
          <Card label="New check-ins" value={n(p.newSales)} sub="rooms sold today" />
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
              <Card label="Money received" value={formatTZS(today.received)} sub={`Still owed ${formatTZS(today.owed)}`} />
            </>
          ) : (
            <>
              <Card accent label="Room income today" value={formatTZS(m.recognized)} sub="tonight, every room with a guest" />
              <Card label="Money received" value={formatTZS(m.collected)} sub="from guests today" />
              <Card label="Still owed" value={formatTZS(m.outstanding)} sub="by these guests" />
            </>
          )}
        </div>
      </Section>

      {/* 2 · New room sales, by room type */}
      <Section no={2} title="Rooms sold today — by room type" note="Rooms checked in during the period, by room type. The amounts are for the whole stay — all the nights the guest booked — at the price each night was sold for.">
        <Table empty="No room was checked in during this period."
          head={["Room type", "Rooms", "Rooms sold", "Nights", "Full price", "Discount", "Sold for", "Average per night"]} right={[2, 3, 4, 5, 6, 7]}
          rows={groupByType(d.sales).map(([type, rs]) => {
            const nights = sumOf(rs, (x) => x.nights), net = sumOf(rs, (x) => x.total);
            return [<b key="t">{type}</b>, roomNos(rs), rs.length, nights, n(sumOf(rs, (x) => x.gross)), n(sumOf(rs, (x) => x.discount)), n(net), nights ? n(Math.round(net / nights)) : "—"];
          })}
          foot={["Total", "", d.sales.length, salesNights, n(sumOf(d.sales, (x) => x.gross)), n(sumOf(d.sales, (x) => x.discount)), n(sumOf(d.sales, (x) => x.total)), salesNights ? n(Math.round(sumOf(d.sales, (x) => x.total) / salesNights)) : "—"]} />
        {d.unknownRates > 0 && <p className="mt-2 text-[11px]" style={{ color: "#b45309" }}>{d.unknownRates} stay(s) have no price per night on record — their totals are shown, their price is not guessed.</p>}
      </Section>

      {/* 3 · Rooms sold, by price per night */}
      <Section no={3} title="Rooms sold by price per night" note="Grouped by the price of ONE night, not the whole stay: a 3-night stay at TZS 60,000 a night is three nights in the 60,000 group.">
        <Table empty="No new sales to group."
          head={["Price per night", "Stays", "Room nights", "Amount"]} right={[0, 1, 2, 3]}
          rows={d.rates.map((g) => [g.rate === 0 ? "Complimentary (0)" : n(g.rate), g.stays, g.nights, n(g.expected)])}
          foot={["Total", "", d.rates.reduce((t, g) => t + g.nights, 0), n(d.rates.reduce((t, g) => t + g.expected, 0))]} />
        {d.rates.length > 0 && <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: LINE }}><p className="mb-3 text-xs font-semibold">Room nights sold, by price per night</p><Bars items={d.rates.map((g) => ({ label: `TZS ${n(g.rate)}`, value: g.nights, sub: `${g.nights === 1 ? "night" : "nights"}` }))} /></div>}
      </Section>

      {/* 4 · Continuing stays, by room type */}
      <Section no={4} title="Continuing stays — by room type" note="Guests who checked in before this period and are still in house at its end. They are not new sales; tonight's price of their room is part of today's room income.">
        <Table empty="No stay continued from before this period."
          head={["Room type", "Rooms", "How many", "Nights booked", "Nights used so far", "Nights remaining"]} right={[2, 3, 4, 5]}
          rows={groupByType(d.continuing).map(([type, rs]) => [<b key="t">{type}</b>, roomNos(rs), rs.length, sumOf(rs, (x) => x.nights), sumOf(rs, (x) => x.elapsed), sumOf(rs, (x) => x.remaining)])}
          foot={["Total", "", d.continuing.length, sumOf(d.continuing, (x) => x.nights), sumOf(d.continuing, (x) => x.elapsed), sumOf(d.continuing, (x) => x.remaining)]} />
      </Section>

      {/* 5 · Check-outs + room status */}
      <Section no={5} title="Check-outs & room status" note="Charges, payments and balance are for the whole booking. A room that is checked out but dirty is not ready for sale. Room status is as at the time the report was generated.">
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
        <Section no={6} title="Money today" note="Income is what the hotel earned today. Expenses are what was spent today. Net profit is income minus expenses.">
          <Table narrow empty="" head={["Income", "Amount (TZS)"]} right={[1]}
            rows={[
              ...departments.map((x) => [x.label, n(x.value)]),
              ...(today.income.refunds ? [["Less money given back to guests (refunds)", less(today.income.refunds)]] : []),
              [<b key="a">Total income</b>, <b key="b">{n(today.income.total)}</b>],
              ["Expenses", less(today.expenses.total)],
            ]}
            foot={["Net profit", <span key="p" style={{ color: today.profit < 0 ? RED : GREEN }}>{today.profit < 0 ? `− ${n(-today.profit)}` : n(today.profit)}</span>]} />
          <p className="mt-2 text-[11px] leading-relaxed" style={{ color: MUTED }}>Room income is tonight&apos;s price of every room with a guest. A guest staying 3 nights is counted one night each day — never three nights at once.</p>

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
                ["Money received today — cash, mobile money, bank, card", n(today.received)],
                ["Still owed to the hotel — all guests and companies", today.owed ? <b key="o" style={{ color: RED }}>{n(today.owed)}</b> : "0"],
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
        <Section no={6} title="Money today" note="Room money only.">
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
        <Section no={7} title="Last 7 days" note="From the real nights and check-ins on record.">
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
      <Section no={realTrend ? 8 : 7} title="Reception summary" note="Each check-in, check-out and payment is credited to the person who recorded it — never to two people.">
        <Table empty="No reception activity was recorded."
          head={["Receptionist", "Shift", "Check-ins", "Walk-ins", "Check-outs", "Payments", "Money received"]} right={[2, 3, 4, 5, 6]}
          rows={d.staff.map((s, i) => [<a key="n" href={`?r=${i}`} className="font-bold underline decoration-dotted print:no-underline">{s.name.replace(/\s*\(.*\)/, "")}</a>, s.shift ?? "—", s.checkIns, s.walkIns, s.checkOuts, s.payments, n(s.collected)])} />
      </Section>

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
