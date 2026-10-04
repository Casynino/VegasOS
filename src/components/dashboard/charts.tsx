"use client";

import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";

/**
 * Command-centre charts (dark surface). Palette = the validated dark
 * categorical order (blue, orange, aqua, yellow, magenta), applied in fixed
 * order; single-series charts use slot 1. Every chart ships a hover tooltip
 * and a screen-reader table.
 */
export const SERIES = ["#3987e5", "#d95926", "#199e70", "#c98500", "#d55181"] as const;
const GRID = "rgba(255,255,255,0.07)";
const AXIS = "rgba(255,255,255,0.45)";

const tzs = (v: number) => `TZS ${Math.round(v).toLocaleString("en-TZ")}`;
const compact = (v: number) =>
  v >= 1_000_000 ? `${(v / 1_000_000).toFixed(v >= 10_000_000 ? 0 : 1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(v);
const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });

function TooltipBox({ active, payload, label, money = true, percent = false }: {
  active?: boolean; payload?: { name?: string; value?: number; color?: string }[]; label?: string; money?: boolean; percent?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-white/15 bg-[#0b1020]/95 px-3 py-2 text-xs text-white shadow-xl backdrop-blur">
      {label && <p className="mb-1 font-medium text-white/70">{/^\d{4}-/.test(label) ? shortDate(label) : label}</p>}
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-2">
          <span className="size-2 rounded-full" style={{ background: p.color }} />
          <span className="text-white/70">{p.name}</span>
          <span className="ml-auto pl-3 font-semibold tabular-nums">{percent ? `${(p.value ?? 0).toFixed(1)}%` : money ? tzs(p.value ?? 0) : p.value}</span>
        </p>
      ))}
    </div>
  );
}

function SrTable({ caption, head, rows }: { caption: string; head: string[]; rows: (string | number)[][] }) {
  return (
    // Wrapped: a <table> ignores sr-only's 1px height and would stretch the page.
    <div className="sr-only">
      <table>
        <caption>{caption}</caption>
        <thead><tr>{head.map((h) => <th key={h}>{h}</th>)}</tr></thead>
        <tbody>{rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

export function RevenueTrend({ data }: { data: { date: string; rooms: number; other: number }[] }) {
  return (
    <div>
      <div className="mb-2 flex gap-4 text-xs text-white/70">
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: SERIES[0] }} />Rooms (net)</span>
        <span className="flex items-center gap-1.5"><span className="h-0.5 w-4 rounded" style={{ background: SERIES[1] }} />Restaurant, bar, meeting & other</span>
      </div>
      <div className="h-64" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <defs>
              {[0, 1].map((i) => (
                <linearGradient key={i} id={`rev-${i}`} x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={SERIES[i]} stopOpacity={0.35} />
                  <stop offset="100%" stopColor={SERIES[i]} stopOpacity={0} />
                </linearGradient>
              ))}
            </defs>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} stroke={AXIS} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis tickFormatter={compact} stroke={AXIS} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={44} />
            <Tooltip content={<TooltipBox />} cursor={{ stroke: "rgba(255,255,255,0.3)" }} />
            <Area type="monotone" dataKey="rooms" name="Rooms" stackId="1" stroke={SERIES[0]} strokeWidth={2} fill="url(#rev-0)" />
            <Area type="monotone" dataKey="other" name="Other streams" stackId="1" stroke={SERIES[1]} strokeWidth={2} fill="url(#rev-1)" />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <SrTable caption="Net revenue by day" head={["Date", "Rooms", "Other"]} rows={data.map((d) => [d.date, d.rooms, d.other])} />
    </div>
  );
}

export function OccupancyTrend({ data }: { data: { date: string; occupancy: number }[] }) {
  return (
    <div>
      <div className="h-56" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <LineChart data={data} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid stroke={GRID} vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} stroke={AXIS} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis domain={[0, 100]} tickFormatter={(v) => `${v}%`} stroke={AXIS} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} width={40} />
            <Tooltip content={<TooltipBox percent />} cursor={{ stroke: "rgba(255,255,255,0.3)" }} />
            <Line type="monotone" dataKey="occupancy" name="Occupancy" stroke={SERIES[2]} strokeWidth={2} dot={{ r: 3, fill: SERIES[2], stroke: "#0b1020", strokeWidth: 2 }} activeDot={{ r: 5 }} />
          </LineChart>
        </ResponsiveContainer>
      </div>
      <SrTable caption="Occupancy by day" head={["Date", "Occupancy %"]} rows={data.map((d) => [d.date, d.occupancy.toFixed(1)])} />
    </div>
  );
}

export function RevenueMix({ data }: { data: { name: string; value: number }[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const shown = data.filter((d) => d.value > 0);
  return (
    <div className="flex flex-col items-center gap-4">
      <div className="relative size-44 shrink-0" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={<TooltipBox />} />
            <Pie data={shown.length ? shown : [{ name: "No revenue", value: 1 }]} dataKey="value" nameKey="name" innerRadius="68%" outerRadius="100%" paddingAngle={shown.length > 1 ? 2 : 0} stroke="none">
              {(shown.length ? shown : [{ name: "none" }]).map((d) => (
                <Cell key={d.name} fill={shown.length ? SERIES[data.findIndex((x) => x.name === d.name) % SERIES.length] : "rgba(255,255,255,0.08)"} />
              ))}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div><p className="text-[10px] uppercase tracking-widest text-white/50">Total</p><p className="text-sm font-semibold tabular-nums text-white">{compact(total)}</p></div>
        </div>
      </div>
      <ul className="w-full space-y-1.5 text-sm">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2 text-white/80">
            <span className="size-2.5 rounded-sm" style={{ background: SERIES[i % SERIES.length] }} />
            <span className="min-w-0 truncate">{d.name}</span>
            <span className="ml-auto whitespace-nowrap tabular-nums text-white">{tzs(d.value)}</span>
            <span className="w-10 text-right text-xs tabular-nums text-white/50">{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export function HBars({ data, money = true, colorIndex = 0, emptyText }: { data: { name: string; value: number; hint?: string }[]; money?: boolean; colorIndex?: number; emptyText: string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  if (data.length === 0 || data.every((d) => d.value === 0)) return <p className="py-6 text-center text-sm text-white/50">{emptyText}</p>;
  return (
    <ul className="space-y-3">
      {data.map((d) => (
        <li key={d.name} className="group">
          <div className="mb-1 flex items-baseline justify-between gap-2 text-sm">
            <span className="text-white/85">{d.name}{d.hint && <span className="ml-1.5 text-xs text-white/45">{d.hint}</span>}</span>
            <span className="tabular-nums text-white">{money ? tzs(d.value) : d.value}</span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-white/[0.06]">
            <div className="h-full rounded-full transition-[width] duration-700 ease-out group-hover:brightness-125"
              style={{ width: `${(d.value / max) * 100}%`, background: SERIES[colorIndex] }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export function SourceBars({ data }: { data: { name: string; roomNights: number; net: number }[] }) {
  if (data.length === 0) return <p className="py-6 text-center text-sm text-white/50">No room sales in this period yet.</p>;
  return (
    <div className="h-56" aria-label="Revenue by booking source">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }} barCategoryGap={8}>
          <CartesianGrid stroke={GRID} horizontal={false} />
          <XAxis type="number" tickFormatter={compact} stroke={AXIS} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
          <YAxis type="category" dataKey="name" stroke={AXIS} tick={{ fontSize: 11, fill: "rgba(255,255,255,0.75)" }} tickLine={false} axisLine={false} width={90} />
          <Tooltip content={<TooltipBox />} cursor={{ fill: "rgba(255,255,255,0.04)" }} />
          <Bar dataKey="net" name="Net room revenue" fill={SERIES[0]} radius={[0, 4, 4, 0]} maxBarSize={18} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
