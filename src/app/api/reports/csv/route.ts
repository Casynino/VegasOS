import { getCurrentUser } from "@/server/auth";
import { occupancy, profitLoss } from "@/server/services/reporting";
import { buildReport } from "@/server/services/reports";
import { businessToday } from "@/server/settings";
import { isBusinessDate } from "@/lib/time/business-date";
import { REPORTS, type Cell, type Report, type ReportKey } from "@/lib/report-types";

const esc = (v: Cell | undefined) => {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replaceAll('"', '""')}"` : s;
};

/** One report as a spreadsheet: the figures, then every part (bars, charts, tables) with raw numbers. */
function reportCsv(r: Report) {
  const out: Cell[][] = [[r.title], [r.period], []];
  out.push(["Figure", "Value", "Note"]);
  for (const f of r.figures) out.push([f.label, f.raw ?? f.value, [f.sub, f.delta != null ? `${Math.round(f.delta)}% vs the period before` : null].filter(Boolean).join(" · ")]);
  for (const b of r.blocks) {
    if (b.kind === "note") continue;
    if (b.kind === "section") { out.push([], [b.title.toUpperCase()]); continue; }
    if (b.kind === "list") { out.push([], [b.title]); b.items.forEach((x) => out.push([x])); continue; }
    out.push([], [b.title]);
    if (b.kind === "bars") { out.push(["Item", "Value", "Note"]); b.items.forEach((x) => out.push([x.label, x.value, x.sub ?? ""])); }
    if (b.kind === "columns") { const names = b.points[0]?.parts.map((x) => x.name) ?? []; out.push(["", ...names]); b.points.forEach((p) => out.push([p.label, ...p.parts.map((x) => x.value)])); }
    if (b.kind === "statement") { b.rows.forEach((x) => out.push([x.label, x.value])); }
    if (b.kind === "highlights") { b.items.forEach((x) => out.push([x.label, x.value, x.sub ?? ""])); }
    if (b.kind === "table") { out.push(b.columns.map((c) => c.label)); b.rows.forEach((row) => out.push(row)); if (b.foot) out.push(b.foot); if (b.more) out.push([`(first ${b.rows.length} lines of ${b.rows.length + b.more})`]); }
  }
  return "\uFEFF" + out.map((row) => row.map(esc).join(",")).join("\n");
}

/** Daily financial & occupancy export for a date range (reports.view only). */
export async function GET(req: Request) {
  const user = await getCurrentUser();
  if (!user) return new Response("Unauthorized", { status: 401 });
  if (!user.permissions.has("reports.view")) return new Response("Forbidden", { status: 403 });
  const url = new URL(req.url);
  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (!isBusinessDate(from) || !isBusinessDate(to) || from > to) return new Response("Invalid range", { status: 400 });
  if ((Date.parse(to) - Date.parse(from)) / 86_400_000 > 366) return new Response("Range too long (max 1 year)", { status: 400 });

  // A report from the Reports page (?r=summary|daily|…): the same numbers as the document.
  const r = REPORTS.find((x) => x.key === url.searchParams.get("r"))?.key as ReportKey | undefined;
  if (r) {
    const report = await buildReport(r, { from, to }, await businessToday());
    return new Response(reportCsv(report), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="vegas-${r}-${from}${to !== from ? `-to-${to}` : ""}.csv"`,
        "Cache-Control": "private, no-store",
      },
    });
  }

  const [pl, occ] = await Promise.all([profitLoss({ from, to }), occupancy({ from, to })]);
  const lines = [
    ["business_date", "room_nights", "day_use", "sellable_rooms", "occupancy_pct", "room_net_revenue", "other_revenue", "total_net_revenue"].join(","),
    ...occ.series.map((d) => {
      const r = pl.revenue.daily.find((x) => x.date === d.date);
      return [d.date, d.roomNights, d.dayUse, d.sellable, d.occupancy.toFixed(1), r?.rooms ?? 0, r?.other ?? 0, r?.total ?? 0].join(",");
    }),
    "",
    `summary,gross_revenue,${pl.grossRevenue}`,
    `summary,discounts,${pl.discounts}`,
    `summary,refunds,${pl.refunds}`,
    `summary,net_revenue,${pl.netRevenue}`,
    `summary,expenses,${pl.expenses}`,
    `summary,estimated_profit_loss,${pl.estimatedProfit}`,
    `summary,payments_collected,${pl.revenue.paymentsCollected}`,
  ];
  return new Response(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="vegas-report-${from}-to-${to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
