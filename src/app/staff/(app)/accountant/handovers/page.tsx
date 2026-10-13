import type { Metadata } from "next";
import Link from "next/link";
import { requirePagePermission } from "@/server/auth";
import { businessToday } from "@/server/settings";
import { handoverList, handoverTotals } from "@/server/services/cash-handover";
import { formatTZS } from "@/lib/format";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { cn } from "@/lib/utils";
import { FinanceTabs, PeriodPicker, periodLabel, readPeriod } from "@/components/staff/finance/finance-nav";
import { HANDOVER_STATUS_TEXT as STATUS_TEXT, HANDOVER_STATUS_TONE as TONE } from "@/lib/cash-handover";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Cash handovers") };
}
export const dynamic = "force-dynamic";

const TABS = [
  { key: "SUBMITTED", label: msg("Waiting for you") }, { key: "RETURNED", label: msg("Sent back") }, { key: "ACCEPTED", label: msg("Received") },
  { key: "REJECTED", label: msg("Refused") }, { key: "", label: msg("All") },
] as const;

/** Every cash handover: what waits for Finance, what was sent back, what was received (and any difference), what was refused. */
export default async function HandoversPage({ searchParams }: PageProps<"/staff/accountant/handovers">) {
  await requirePagePermission("cash.handover.view", "cash.handover.review");
  const t = await getT();
  const sp = await searchParams;
  const today = await businessToday();
  const p = readPeriod(sp, today, "all", { allTime: true });
  // No choice yet: what waits for Finance. "All" is an explicit choice (?status=).
  const asked = typeof sp.status === "string" ? sp.status : "SUBMITTED";
  const status = (TABS.find((x) => x.key === asked)?.key ?? "SUBMITTED") as "SUBMITTED" | "RETURNED" | "ACCEPTED" | "REJECTED" | "";
  const [rows, totals] = await Promise.all([
    handoverList({ status: status || null, ...(status === "SUBMITTED" || status === "RETURNED" ? {} : { from: p.from, to: p.to }) }),
    handoverTotals(p.from, p.to),
  ]);
  const keep = { status };
  return (
    <div className="w-full space-y-4">
      <FinanceTabs active="/staff/accountant/handovers" />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.4rem,2vw,1.75rem)] font-semibold tracking-tight">{t("Cash handovers")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("Cash that reception and the Restaurant Counter hand to Finance. It was already counted as received when it was recorded — a handover only confirms who holds it.")}</p>
        </div>
        {status !== "SUBMITTED" && status !== "RETURNED" && <PeriodPicker allTime current={p.key} from={p.from} to={p.to} keep={keep} />}
      </header>

      <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Tile label={t("Waiting for you")} value={formatTZS(totals.waitingExpected)} sub={t.plural(totals.waitingCount, "{n} handover", "{n} handovers")} />
        <Tile label={t("Sent back")} value={String(totals.returned)} sub={t("not corrected yet")} />
        <Tile label={t("Received")} value={formatTZS(totals.received)} sub={`${t.plural(totals.receivedCount, "{n} handover", "{n} handovers")} · ${periodLabel(p, t)}`} />
        <Tile label={t("Differences")} value={totals.withDifference ? `${formatTZS(totals.short)} / ${formatTZS(totals.over)}` : "—"} sub={totals.withDifference ? t("short / over") : t("none")} />
      </dl>

      <nav aria-label={t("Show")} className="flex flex-wrap gap-1 rounded-xl bg-muted p-1 text-sm">
        {TABS.map((x) => (
          <Link key={x.key} href={`?status=${x.key}`} className={cn("rounded-lg px-3 py-1.5 text-xs font-medium", status === x.key ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>{t(x.label)}</Link>
        ))}
      </nav>

      {rows.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-border/70 p-8 text-center text-sm text-muted-foreground">{t("No handovers here.")}</p>
      ) : (
        <div className="overflow-x-auto rounded-3xl border border-border/70 bg-card">
          <table className="w-full min-w-[44rem] text-sm">
            <thead>
              <tr className="border-b border-border/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground">
                <th className="px-4 py-2.5 font-medium">{t("Handover")}</th><th className="px-2 py-2.5 font-medium">{t("From")}</th>
                <th className="px-2 py-2.5 text-right font-medium">{t("Expected")}</th><th className="px-2 py-2.5 text-right font-medium">{t("Handed over")}</th>
                <th className="px-2 py-2.5 text-right font-medium">{t("Received")}</th><th className="px-4 py-2.5 text-right font-medium">{t("Status")}</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {rows.map((h) => (
                <tr key={h.id} className="hover:bg-muted/30">
                  <td className="px-4 py-2.5"><Link href={`/staff/accountant/handovers/${h.id}`} className="font-medium underline-offset-4 hover:underline">{h.number}</Link><span className="block text-[11px] text-muted-foreground">{t.dateTime(h.submittedAt)}</span></td>
                  <td className="px-2 py-2.5">{h.submittedBy.fullName}<span className="block text-[11px] text-muted-foreground">{h.department === "RESTAURANT" ? t("Restaurant Counter") : t("Front desk")}</span></td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{formatTZS(h.expected)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{formatTZS(h.declared)}</td>
                  <td className="px-2 py-2.5 text-right tabular-nums">{h.received === null ? "—" : formatTZS(h.received)}{!!h.difference && <span className="block text-[11px] text-amber-700 dark:text-amber-300">{h.difference < 0 ? t("short") : t("over")} {formatTZS(Math.abs(h.difference))}</span>}</td>
                  <td className="px-4 py-2.5 text-right"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", TONE[h.status])}>{t(STATUS_TEXT[h.status])}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Tile({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="rounded-2xl border border-border/70 bg-card px-3 py-2.5">
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className="text-base font-semibold tabular-nums">{value}</dd>
      {sub && <dd className="text-[11px] text-muted-foreground">{sub}</dd>}
    </div>
  );
}
