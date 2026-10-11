import type { ReactNode } from "react";
import { formatTZS } from "@/lib/format";
import type { RoomReportData } from "@/server/services/room-report-data";

type Hotel = { name: string; tagline?: string | null; address: string; contact: string };

const INK = "#1d1a16", MUTED = "#6f665b", GOLD = "#c9a24a", LINE = "#e6dfd2";
const clock = (iso: string, tz: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: tz }).format(new Date(iso));
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

function Table({ head, rows, foot, empty, right = [] }: { head: string[]; rows: ReactNode[][]; foot?: ReactNode[]; empty: string; right?: number[] }) {
  if (!rows.length) return <p className="rounded-xl bg-[#f6f2ea] px-4 py-3 text-sm" style={{ color: MUTED }}>{empty}</p>;
  const cell = (i: number) => `px-2.5 py-2 ${right.includes(i) ? "text-right tabular-nums" : "text-left"}`;
  return (
    <div className="report-scroll overflow-x-auto rounded-xl border" style={{ borderColor: LINE }}>
      <table className="w-full min-w-[640px] border-collapse text-[12.5px]">
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

const STATUS_COLOR: Record<string, string> = { READY: "#10b981", OCCUPIED: "#8b5cf6", RESERVED: "#0ea5e9", DIRTY: "#f59e0b", CLEANING: "#f97316", MAINTENANCE: "#64748b", OUT_OF_SERVICE: "#f43f5e" };

/** The Daily Room Report as a printable document (A4, PDF) — the same on the Boss's link and in the staff app. */
export function RoomReportPaper({ d, hotel, number, version }: { d: RoomReportData; hotel: Hotel; number: string; version: number }) {
  const tz = d.timezone;
  const p = d.perf, m = d.money;
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

      {/* 1 · Executive summary */}
      <Section no={1} title="Executive summary" note="Occupied = every room that had a guest at any time in the period. New check-ins are the rooms actually sold (checked in) in the period — a multi-night stay is counted once, on its check-in day only.">
        <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Card accent label="Occupied" value={`${p.occupied} / ${d.guestRooms}`} sub={`${p.occupancyPct}% occupancy`} />
          <Card label="New check-ins" value={n(p.newSales)} sub="new room sales" />
          <Card label="Continuing stays" value={n(p.continuing)} sub="checked in before, still in house" />
          <Card label="Checked out" value={n(p.checkedOut)} />
          <Card label="Available now" value={n(p.available)} sub="ready for sale" />
          <Card label="Room nights sold" value={n(p.nightsSold)} sub="by the new check-ins" />
          <Card accent label="New room revenue" value={formatTZS(m.expected)} sub="expected, full stays" />
          <Card label="Collected today" value={formatTZS(m.collected)} sub={`Outstanding ${formatTZS(m.outstanding)}`} />
        </div>
      </Section>

      {/* 2 · New room sales */}
      <Section no={2} title="New room sales" note="Every room checked in during the period, priced with the nightly rates it was sold at (each night keeps its own price; later price changes never alter it).">
        <Table empty="No room was checked in during this period."
          head={["No.", "Room", "Room type", "Check-in", "Nights", "Rate / night", "Stay total", "Reference"]} right={[0, 4, 5, 6]}
          rows={d.sales.map((s, i) => [
            i + 1, <b key="r">{s.room}</b>, s.type, clock(s.checkedInAt, tz), s.dayUse ? "Short time" : s.nights,
            s.rate === null ? <span key="u" style={{ color: "#b45309" }}>Not recorded</span> : s.mixed ? `${n(s.rate)} avg*` : n(s.rate),
            n(s.total), <span key="f" className="font-mono text-[11px]">{s.reference}</span>,
          ])}
          foot={["", `${d.sales.length} rooms`, "", "", salesNights, "", n(d.sales.reduce((t, s) => t + s.total, 0)), ""]} />
        {d.sales.some((s) => s.mixed) && <p className="mt-2 text-[11px]" style={{ color: MUTED }}>* This stay was priced differently on different nights (weekend, season or discount); the average is shown and every night is counted at its own rate below.</p>}
        {d.unknownRates > 0 && <p className="mt-2 text-[11px]" style={{ color: "#b45309" }}>{d.unknownRates} stay(s) have no nightly price on record — their totals are shown, their rate is not guessed.</p>}
        {d.sales.length > 0 && <p className="mt-2 text-[11px]" style={{ color: MUTED }}>Reconciles to the new room revenue of {formatTZS(m.expected)} in the summary.</p>}
      </Section>

      {/* 3 · Revenue by nightly rate */}
      <Section no={3} title="Revenue by nightly rate" note="Grouped by the price of ONE night, not the whole stay: a 3-night stay at TZS 60,000 a night is three nights in the 60,000 group.">
        <Table empty="No new sales to group."
          head={["Rate per night", "Stays", "Room nights", "Expected revenue"]} right={[0, 1, 2, 3]}
          rows={d.rates.map((g) => [g.rate === 0 ? "Complimentary (0)" : n(g.rate), g.stays, g.nights, n(g.expected)])}
          foot={["Total", "", d.rates.reduce((t, g) => t + g.nights, 0), n(d.rates.reduce((t, g) => t + g.expected, 0))]} />
        {d.rates.length > 0 && <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: LINE }}><p className="mb-3 text-xs font-semibold">Room nights sold, by nightly rate</p><Bars items={d.rates.map((g) => ({ label: `TZS ${n(g.rate)}`, value: g.nights, sub: `${g.nights === 1 ? "night" : "nights"}` }))} /></div>}
      </Section>

      {/* 4 · Continuing stays */}
      <Section no={4} title="Continuing stays" note="Guests who checked in before this period and are still in house at its end. They are occupancy, not new sales — their revenue was counted when they checked in.">
        <Table empty="No stay continued from before this period."
          head={["Room", "Room type", "Checked in", "Check-out", "Nights booked", "Elapsed", "Remaining", "Status"]} right={[4, 5, 6]}
          rows={d.continuing.map((c) => [<b key="r">{c.room}</b>, c.type, short(c.arrival), short(c.departure), c.nights, c.elapsed, c.remaining, c.status])} />
      </Section>

      {/* 5 · Check-outs + room status */}
      <Section no={5} title="Check-outs & room status" note="Charges, payments and balance are for the whole booking. A room that is checked out but dirty is not ready for sale. Room status is as at the time the report was generated.">
        <Table empty="Nobody checked out in this period."
          head={["Room", "Time", "Reference", "Final charges", "Paid", "Outstanding", "Room now"]} right={[3, 4, 5]}
          rows={d.checkouts.map((c) => [<b key="r">{c.room}</b>, clock(c.at, tz), <span key="f" className="font-mono text-[11px]">{c.reference}</span>, n(c.charges), n(c.paid), c.outstanding ? <b key="o" style={{ color: "#be123c" }}>{n(c.outstanding)}</b> : "0", c.roomNow.replaceAll("_", " ").toLowerCase()])} />
        <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: LINE }}>
          <p className="mb-3 text-xs font-semibold">Guest rooms by status ({d.guestRooms} rooms; the meeting room is not included)</p>
          <Bars items={d.status.map((s) => ({ label: s.label, value: s.count, color: STATUS_COLOR[s.key] }))} />
        </div>
      </Section>

      {/* 6 · Reconciliation */}
      <Section no={6} title="Financial reconciliation" note="A multi-night booking is never counted again as new revenue: expected is the value of the stays sold today; recognized is the room income earned for this night; collected is cash and mobile money received today.">
        <Table empty="" head={["Line", "Amount (TZS)"]} right={[1]}
          rows={[
            ["Expected charges — new stays at full price", n(m.gross)],
            ["Less discounts & adjustments", m.discounts ? `− ${n(m.discounts)}` : "0"],
            [<b key="a">Expected room revenue — new sales</b>, <b key="b">{n(m.expected)}</b>],
            ["Room income recognized for this night (all in-house guests)", n(m.recognized)],
            ["Payments collected on guest bookings today", n(m.collected)],
            ["Refunds paid today", m.refunds ? `− ${n(m.refunds)}` : "0"],
            ["Payments reversed today", m.reversed ? `− ${n(m.reversed)}` : "0"],
            [<b key="c">Outstanding on these stays</b>, <b key="d" style={{ color: m.outstanding ? "#be123c" : INK }}>{n(m.outstanding)}</b>],
          ]} />
        <div className="mt-4 rounded-2xl border p-4" style={{ borderColor: LINE }}>
          <p className="mb-3 text-xs font-semibold">Expected vs recognized vs collected</p>
          <Bars money items={[{ label: "Expected (new sales)", value: m.expected, color: GOLD }, { label: "Recognized (this night)", value: m.recognized, color: "#8b5cf6" }, { label: "Collected (today)", value: m.collected, color: "#10b981" }]} />
        </div>
      </Section>

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
          head={["Receptionist", "Shift", "Check-ins", "Walk-ins", "Check-outs", "Payments", "Collected"]} right={[2, 3, 4, 5, 6]}
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
          {card("Money collected", `TZS ${n(s.collected)}`, `${share(s.collected, total.cash)} of the hotel's`)}
        </div>
      </Section>
      <Section no={2} title="The hotel that day">
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          {card("Occupancy", `${d.perf.occupancyPct}%`, `${d.perf.occupied} of ${d.guestRooms} rooms`)}
          {card("New check-ins", d.perf.newSales)}
          {card("Check-outs", d.perf.checkedOut)}
          {card("Collected", `TZS ${n(d.money.collected)}`)}
        </div>
      </Section>
      <footer className="mt-10 border-t pt-4 text-center text-[11px] leading-relaxed" style={{ borderColor: LINE, color: MUTED }}>
        <p className="font-semibold" style={{ color: INK }}>{hotel.name} · Automated Management Report</p>
        <p className="mt-1">Prepared automatically from the hotel&apos;s reservation, check-in and payment records.</p>
      </footer>
    </article>
  );
}
