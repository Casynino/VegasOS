"use client";

import { Bar, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

export type MoneyPoint = { key: string; label: string; income: number; expenses: number; received: number };

const INCOME = "#8b5cf6", EXPENSES = "#f43f5e", RECEIVED = "#0ea5e9";
const tzs = (v: number) => `TZS ${Math.round(v).toLocaleString("en-US")}`;
const EARNED = msg("Earned"), SPENT = msg("Spent"), RECEIVED_LABEL = msg("Received");
const compact = (v: number) => (Math.abs(v) >= 1_000_000 ? `${(v / 1_000_000).toFixed(1)}M` : Math.abs(v) >= 1000 ? `${Math.round(v / 1000)}k` : String(Math.round(v)));

function Tip({ active, payload, label }: { active?: boolean; payload?: { dataKey?: string | number; value?: number }[]; label?: string }) {
  const t = useT();
  if (!active || !payload?.length) return null;
  const v = (k: string) => payload.find((p) => p.dataKey === k)?.value ?? 0;
  const net = v("income") - v("expenses");
  return (
    <div className="min-w-44 rounded-xl border border-border bg-popover px-3 py-2 text-xs shadow-lg">
      <p className="mb-1 font-medium text-muted-foreground">{label}</p>
      {([[EARNED, "income", INCOME], [SPENT, "expenses", EXPENSES], [RECEIVED_LABEL, "received", RECEIVED]] as const).map(([name, k, c]) => (
        <p key={k} className="flex items-center justify-between gap-4"><span className="flex items-center gap-1.5"><span className="size-2 rounded-full" style={{ background: c }} />{t.ctx("finance", name)}</span><span className="font-semibold tabular-nums text-foreground">{tzs(v(k))}</span></p>
      ))}
      <p className="mt-1 flex justify-between gap-4 border-t border-border pt-1"><span>{t.ctx("finance", "Result")}</span><span className={net >= 0 ? "font-semibold tabular-nums text-emerald-600 dark:text-emerald-400" : "font-semibold tabular-nums text-rose-600 dark:text-rose-400"}>{tzs(net)}</span></p>
    </div>
  );
}

/** Earned and spent as bars, received as a line — one point per day (or per month for long periods). */
export function MoneyChart({ data, height = 260 }: { data: MoneyPoint[]; height?: number }) {
  const t = useT();
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
        {([[EARNED, INCOME], [SPENT, EXPENSES], [RECEIVED_LABEL, RECEIVED]] as const).map(([n, c]) => (
          <span key={n} className="flex items-center gap-1.5"><span className={n === "Received" ? "h-0.5 w-3 rounded-full" : "size-2 rounded-sm"} style={{ background: c }} />{t.ctx("finance", n)}</span>
        ))}
      </div>
      <div style={{ height }} aria-hidden>
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 6, right: 4, left: -10, bottom: 0 }} barGap={2} barCategoryGap="22%">
            <CartesianGrid stroke="var(--border)" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} minTickGap={16} />
            <YAxis tickFormatter={compact} tick={{ fontSize: 11, fill: "var(--muted-foreground)" }} tickLine={false} axisLine={false} width={44} />
            <Tooltip content={<Tip />} cursor={{ fill: "var(--muted)", opacity: 0.35 }} />
            <Bar dataKey="income" fill={INCOME} radius={[4, 4, 0, 0]} maxBarSize={16} />
            <Bar dataKey="expenses" fill={EXPENSES} radius={[4, 4, 0, 0]} maxBarSize={16} />
            <Line type="monotone" dataKey="received" stroke={RECEIVED} strokeWidth={2.25} dot={false} activeDot={{ r: 4, fill: "var(--card)", stroke: RECEIVED, strokeWidth: 2 }} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
      <div className="sr-only">
        <table><thead><tr><th>{t.ctx("date", "Day")}</th><th>{t("Earned")}</th><th>{t.ctx("finance", "Spent")}</th><th>{t("Received")}</th></tr></thead>
          <tbody>{data.map((d) => <tr key={d.key}><td>{d.label}</td><td>{tzs(d.income)}</td><td>{tzs(d.expenses)}</td><td>{tzs(d.received)}</td></tr>)}</tbody></table>
      </div>
    </div>
  );
}
