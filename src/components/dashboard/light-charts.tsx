"use client";

import { Area, AreaChart, CartesianGrid, Cell, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

/** Light-surface charts for the staff dashboards (soft gradients, hover tooltips, screen-reader tables). */
const shortDate = (d: string) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" });
const compact = (v: number) => (v >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : v >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));

function Tip({ active, payload, label, format }: { active?: boolean; payload?: { value?: number }[]; label?: string; format: (v: number) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="text-muted-foreground">{label && /^\d{4}-/.test(label) ? shortDate(label) : label}</p>
      <p className="text-sm font-semibold text-foreground">{format(payload[0].value ?? 0)}</p>
    </div>
  );
}

export function AreaTrend({ data, color = "#8b5cf6", unit = "money", height = 240 }: {
  data: { date: string; value: number }[]; color?: string; unit?: "money" | "percent" | "count"; height?: number;
}) {
  const format = (v: number) => (unit === "money" ? `TZS ${Math.round(v).toLocaleString("en-TZ")}` : unit === "percent" ? `${v.toFixed(1)}%` : String(Math.round(v)));
  const id = `g-${color.replace(/[^a-z0-9]/gi, "")}`;
  return (
    <div>
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 10, right: 6, left: -12, bottom: 0 }}>
            <defs>
              <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={color} stopOpacity={0.32} />
                <stop offset="100%" stopColor={color} stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="date" tickFormatter={shortDate} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} minTickGap={24} />
            <YAxis tickFormatter={(v) => (unit === "percent" ? `${v}%` : compact(v))} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={44}
              domain={unit === "percent" ? [0, 100] : [0, "auto"]} />
            <Tooltip content={<Tip format={format} />} cursor={{ stroke: color, strokeDasharray: "4 4" }} />
            <Area type="monotone" dataKey="value" stroke={color} strokeWidth={2.5} fill={`url(#${id})`} dot={false} activeDot={{ r: 5, fill: "var(--card)", stroke: color, strokeWidth: 2.5 }} />
          </AreaChart>
        </ResponsiveContainer>
      </div>
      <div className="sr-only"><table><tbody>{data.map((d) => <tr key={d.date}><td>{d.date}</td><td>{format(d.value)}</td></tr>)}</tbody></table></div>
    </div>
  );
}

export const DONUT = ["#8b5cf6", "#0ea5e9", "#10b981", "oklch(0.72 0.12 80)", "#f43f5e", "#94a3b8"];

export function Donut({ data, center, format = "money", colors = DONUT }: { data: { name: string; value: number }[]; center: { label: string; value: string }; format?: "money" | "count"; colors?: string[] }) {
  const total = data.reduce((s, d) => s + d.value, 0);
  const shown = data.filter((d) => d.value > 0);
  const fmt = (v: number) => (format === "money" ? `TZS ${Math.round(v).toLocaleString("en-TZ")}` : String(v));
  return (
    // Side by side only when its own card is wide enough (the card can be a narrow column on a laptop).
    <div className="@container"><div className="flex flex-col items-center gap-5 @sm:flex-row @sm:items-center">
      <div className="relative size-40 shrink-0" aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <PieChart>
            <Tooltip content={({ active, payload }) => active && payload?.length ? (
              <div className="rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-lg"><p className="text-muted-foreground">{payload[0].name}</p><p className="font-semibold">{fmt(Number(payload[0].value))}</p></div>
            ) : null} />
            <Pie data={shown.length ? shown : [{ name: "None", value: 1 }]} dataKey="value" nameKey="name" innerRadius="66%" outerRadius="100%" paddingAngle={shown.length > 1 ? 3 : 0} cornerRadius={6} stroke="none">
              {(shown.length ? shown : [{ name: "None" }]).map((d) => <Cell key={d.name} fill={shown.length ? colors[data.findIndex((x) => x.name === d.name) % colors.length] : "var(--muted)"} />)}
            </Pie>
          </PieChart>
        </ResponsiveContainer>
        <div className="absolute inset-0 grid place-items-center text-center">
          <div><p className="text-base font-bold text-foreground">{center.value}</p><p className="text-[10px] uppercase tracking-wider text-muted-foreground">{center.label}</p></div>
        </div>
      </div>
      <ul className="w-full min-w-0 space-y-2 text-sm">
        {data.map((d, i) => (
          <li key={d.name} className="flex items-center gap-2">
            <span className="size-2.5 rounded-full" style={{ background: colors[i % colors.length] }} />
            <span className="min-w-0 flex-1 truncate text-muted-foreground">{d.name}</span>
            <span className="font-medium tabular-nums text-foreground">{format === "money" ? `TZS ${Math.round(d.value).toLocaleString("en-TZ")}` : d.value}</span>
            <span className="w-9 text-right text-xs tabular-nums text-muted-foreground">{total ? Math.round((d.value / total) * 100) : 0}%</span>
          </li>
        ))}
      </ul>
    </div></div>
  );
}
