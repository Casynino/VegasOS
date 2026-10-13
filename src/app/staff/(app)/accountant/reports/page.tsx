import type { Metadata } from "next";
import Link from "next/link";
import { Download } from "lucide-react";
import { requirePagePermission } from "@/server/auth";
import { businessToday } from "@/server/settings";
import { handoverList } from "@/server/services/cash-handover";
import { correctionsHistory, reconciliationByStaff } from "@/server/services/accountant-reports";
import { formatTZS } from "@/lib/format";
import { CASH_HANDOVER_ON, HANDOVER_STATUS_TEXT, HANDOVER_STATUS_TONE } from "@/lib/cash-handover";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { cn } from "@/lib/utils";
import { FinanceTabs, PeriodPicker, periodLabel, readPeriod } from "@/components/staff/finance/finance-nav";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Cash reports") };
}
export const dynamic = "force-dynamic";

const ALL_TABS = [
  { key: "staff", label: msg("Staff reconciliation") }, { key: "handovers", label: msg("Cash handovers") }, { key: "corrections", label: msg("Refunds and corrections") },
] as const;
// Without the digital handover there is nothing to reconcile: the page is refunds, reversals and corrections only.
const TABS = CASH_HANDOVER_ON ? ALL_TABS : ALL_TABS.filter((x) => x.key === "corrections");

/** Finance's cash reports: who took what and handed what over; every handover; refunds, reversals and corrections. */
export default async function AccountantReportsPage({ searchParams }: PageProps<"/staff/accountant/reports">) {
  await requirePagePermission("reports.view", "cash.handover.view");
  const t = await getT();
  const sp = await searchParams;
  const today = await businessToday();
  const p = readPeriod(sp, today, "month");
  const tab = TABS.find((x) => x.key === sp.tab)?.key ?? TABS[0].key;
  const keep = { tab };
  const range = p.key === "custom" ? `from=${p.from}&to=${p.to}` : `period=${p.key}`;
  return (
    <div className="w-full space-y-5">
      <FinanceTabs active="/staff/accountant/reports" />
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-[clamp(1.4rem,2vw,1.75rem)] font-semibold tracking-tight">{CASH_HANDOVER_ON ? t("Cash reports") : t("Refunds and corrections")}</h1>
          <p className="mt-0.5 text-sm text-muted-foreground">{periodLabel(p, t)}</p>
        </div>
        <PeriodPicker current={p.key} from={p.from} to={p.to} keep={keep} />
      </header>
      {TABS.length > 1 && <nav className="flex flex-wrap gap-1 rounded-xl bg-muted p-1" aria-label={t("Reports")}>
        {TABS.map((x) => <Link key={x.key} href={`?${range}&tab=${x.key}`} className={cn("rounded-lg px-3 py-1.5 text-xs font-medium", tab === x.key ? "bg-card shadow-sm" : "text-muted-foreground hover:text-foreground")}>{t(x.label)}</Link>)}
      </nav>}
      {CASH_HANDOVER_ON && tab === "staff" && <Staff from={p.from} to={p.to} />}
      {CASH_HANDOVER_ON && tab === "handovers" && <Handovers from={p.from} to={p.to} range={range} />}
      {tab === "corrections" && <Corrections from={p.from} to={p.to} />}
    </div>
  );
}

const Card = ({ title, note, children }: { title: string; note?: string; children: React.ReactNode }) => (
  <section className="rounded-3xl border border-border/70 bg-card">
    <header className="flex flex-wrap items-baseline justify-between gap-2 border-b border-border/60 px-4 py-2.5"><h2 className="text-sm font-semibold">{title}</h2>{note && <p className="text-xs text-muted-foreground">{note}</p>}</header>
    {children}
  </section>
);
const Th = ({ children, right }: { children: React.ReactNode; right?: boolean }) => <th className={cn("px-3 py-2 font-medium first:pl-4 last:pr-4", right && "text-right")}>{children}</th>;
const head = "border-b border-border/60 text-left text-[11px] uppercase tracking-wider text-muted-foreground";

async function Staff({ from, to }: { from: string; to: string }) {
  const t = await getT();
  const rows = await reconciliationByStaff(from, to);
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((s, r) => s + f(r), 0);
  return (
    <Card title={t("Cash taken and handed over, by person")} note={t("Cash only — what mobile money, bank and card took is in its own accounts.")}>
      {rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t("No cash was taken or handed over in this period.")}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[46rem] text-sm">
            <thead><tr className={head}><Th>{t("Person")}</Th><Th right>{t("Cash recorded")}</Th><Th right>{t("Handed over")}</Th><Th right>{t("Waiting for Finance")}</Th><Th right>{t("Received")}</Th><Th right>{t("Difference")}</Th></tr></thead>
            <tbody className="divide-y divide-border/50">
              {rows.map((r) => (
                <tr key={r.userId}>
                  <td className="px-3 py-2 pl-4"><span className="font-medium">{r.name}</span><span className="block text-[11px] text-muted-foreground">{t(r.role)} · {t.plural(r.handovers, "{n} handover", "{n} handovers")}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatTZS(r.recorded)}</td><td className="px-3 py-2 text-right tabular-nums">{formatTZS(r.declared)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{r.waiting ? formatTZS(r.waiting) : "—"}</td><td className="px-3 py-2 text-right tabular-nums">{formatTZS(r.received)}</td>
                  <td className={cn("px-3 py-2 pr-4 text-right tabular-nums", r.difference && "text-amber-700 dark:text-amber-300")}>{r.difference ? `${r.difference < 0 ? "−" : "+"}${formatTZS(Math.abs(r.difference))}` : "—"}</td>
                </tr>
              ))}
              <tr className="font-semibold"><td className="px-3 py-2 pl-4">{t("Total")}</td><td className="px-3 py-2 text-right tabular-nums">{formatTZS(sum((r) => r.recorded))}</td><td className="px-3 py-2 text-right tabular-nums">{formatTZS(sum((r) => r.declared))}</td><td className="px-3 py-2 text-right tabular-nums">{formatTZS(sum((r) => r.waiting))}</td><td className="px-3 py-2 text-right tabular-nums">{formatTZS(sum((r) => r.received))}</td><td className="px-3 py-2 pr-4 text-right tabular-nums">{formatTZS(sum((r) => r.difference))}</td></tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="border-t border-border/60 px-4 py-2 text-[11px] text-muted-foreground">{t("Cash recorded is what the person took in the period; handed over and received are the handovers sent in the same period. A handover can cover cash from an earlier day, so the two need not match day by day.")}</p>
    </Card>
  );
}

async function Handovers({ from, to, range }: { from: string; to: string; range: string }) {
  const t = await getT();
  const rows = await handoverList({ from, to, take: 300 });
  return (
    <Card title={t("Every cash handover")} note={t.plural(rows.length, "{n} handover", "{n} handovers")}>
      <div className="flex justify-end px-4 pt-3"><a href={`/api/accountant/handovers?${range}`} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border px-3 text-sm font-medium hover:bg-muted"><Download className="size-4" />{t("Export CSV")}</a></div>
      {rows.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t("No handovers in this period.")}</p> : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-sm">
            <thead><tr className={head}><Th>{t("Handover")}</Th><Th>{t("From")}</Th><Th right>{t("Expected")}</Th><Th right>{t("Handed over")}</Th><Th right>{t("Received")}</Th><Th right>{t("Status")}</Th></tr></thead>
            <tbody className="divide-y divide-border/50">
              {rows.map((h) => (
                <tr key={h.id}>
                  <td className="px-3 py-2 pl-4"><Link href={`/staff/accountant/handovers/${h.id}`} className="font-medium underline-offset-4 hover:underline">{h.number}</Link><span className="block text-[11px] text-muted-foreground">{t.dateTime(h.submittedAt)}</span></td>
                  <td className="px-3 py-2">{h.submittedBy.fullName}<span className="block text-[11px] text-muted-foreground">{h.department === "RESTAURANT" ? t("Restaurant Counter") : t("Front desk")}</span></td>
                  <td className="px-3 py-2 text-right tabular-nums">{formatTZS(h.expected)}</td><td className="px-3 py-2 text-right tabular-nums">{formatTZS(h.declared)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{h.received === null ? "—" : formatTZS(h.received)}{!!h.difference && <span className="block text-[11px] text-amber-700 dark:text-amber-300">{h.difference < 0 ? t("short") : t("over")} {formatTZS(Math.abs(h.difference))}</span>}</td>
                  <td className="px-3 py-2 pr-4 text-right"><span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", HANDOVER_STATUS_TONE[h.status])}>{t(HANDOVER_STATUS_TEXT[h.status])}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}

async function Corrections({ from, to }: { from: string; to: string }) {
  const t = await getT();
  const c = await correctionsHistory(from, to);
  return (
    <>
      <Card title={t("Refunds and reversed payments")} note={t.plural(c.refunds.length, "{n} line", "{n} lines")}>
        {c.refunds.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t("None in this period.")}</p> : (
          <ul className="divide-y divide-border/50 text-sm">
            {c.refunds.map((r) => (
              <li key={r.id} className="flex flex-wrap items-start justify-between gap-x-4 gap-y-0.5 px-4 py-2">
                <span className="min-w-0"><span className="font-medium">{r.kind === "REFUND" ? t("Refund") : t("Reversed payment")}</span> · {r.party ?? r.reference ?? ""}<span className="block text-xs text-muted-foreground">{t.dateTime(r.at)} · {t(r.account)} · {r.by}{r.reason && ` — ${r.reason}`}</span></span>
                <span className="shrink-0 font-medium tabular-nums">{formatTZS(r.amount)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <Card title={t("Payments moved to another method or account")} note={t("The amount never changes")}>
        {c.methodFixes.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t("None in this period.")}</p> : (
          <ul className="divide-y divide-border/50 text-sm">
            {c.methodFixes.map((m) => <li key={m.id} className="flex flex-wrap items-start justify-between gap-x-4 px-4 py-2"><span className="min-w-0">{m.reason}<span className="block text-xs text-muted-foreground">{t.dateTime(m.at)} · {m.by}</span></span><span className="shrink-0 tabular-nums">{formatTZS(m.amount)}</span></li>)}
          </ul>
        )}
      </Card>
      <Card title={t("Ledger corrections")} note={t("Adjustments written to the general ledger")}>
        {c.ledger.length === 0 ? <p className="p-4 text-sm text-muted-foreground">{t("None in this period.")}</p> : (
          <ul className="divide-y divide-border/50 text-sm">
            {c.ledger.map((e) => (
              <li key={e.id} className={cn("flex flex-wrap items-start justify-between gap-x-4 px-4 py-2", e.reversed && "text-muted-foreground line-through")}>
                <span className="min-w-0"><span className="font-medium">{e.number}</span> · {e.description}<span className="block text-xs text-muted-foreground">{t.dateTime(e.at)} · {t(e.account)} · {e.by}</span></span>
                <span className="shrink-0 tabular-nums">{e.amount < 0 ? "−" : "+"}{formatTZS(Math.abs(e.amount))}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <p className="text-xs text-muted-foreground">{t("Every one of these is also in Edit history, with the old and the new value.")}</p>
    </>
  );
}
