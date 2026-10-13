import { Suspense } from "react";
import { BadgeCheck, BarChart3, Clock, LineChart, Landmark } from "lucide-react";
import type { PermissionCode } from "@/lib/permissions";
import type { BusinessDate } from "@/lib/time/business-date";
import { diffDays } from "@/lib/time/business-date";
import { buildInsights } from "@/lib/finance-insights";
import { getT } from "@/i18n/server";
import { getSettings, liveSinceDate } from "@/server/settings";
import { accountantOverview } from "@/server/services/accountant";
import { expenseSummary, onTheBooks, previousRange, profitLoss } from "@/server/services/reporting";
import { purchasesPanel } from "@/server/services/finance-home";
import { receivablesAging, recentSpend } from "@/server/services/finance-outlook";
import { periodLabel, type readPeriod } from "@/components/staff/finance/finance-nav";
import { PartHeading } from "./finance-panels";
import { InsightsPanel, OutlookView } from "./finance-analysis";
import { AccountsPart, insightFactsOf, PartSkeleton, TrendsSection, type HomeContext } from "./finance-sections";

/**
 * The money, analysed — for the Boss, the MD and the Manager: what stands out, where the money is, the cash outlook (what is owed to
 * the hotel and how late, what the hotel owes and when, how fast the money goes) and how the hotel is doing (key figures, six months,
 * occupancy, the best days, what moved against the period before). The same analysis Finance reads on its own Home, from the same
 * money services — so the Boss and Finance always see the same figures. Each part is shown only to those who may see its figures.
 */
export async function MoneyAnalysis({ perms, p, today }: { perms: ReadonlySet<string>; p: ReturnType<typeof readPeriod>; today: BusinessDate }) {
  const t = await getT();
  const has = (...codes: PermissionCode[]) => codes.some((c) => perms.has(c));
  const canSeeAccounts = has("ledger.view", "finance.view");
  const buying = has("purchases.authorize", "purchases.pay", "procurement.manage");
  const live = liveSinceDate(await getSettings());
  const range = { from: p.from, to: p.to };
  const prev = previousRange(range);
  const days = diffDays(p.from, p.to) + 1;
  // The records began on `live`: a period before that holds nothing, one that begins before it is only partly filled — no fair base for "up 50%".
  const straddles = Boolean(live && prev.from < live && prev.to >= live);
  const prevHasRecords = !live || prev.to >= live;

  const [ov, plPrev, spend, purchases, aging, pace, onBooks] = await Promise.all([
    accountantOverview(range, today),
    profitLoss(prev),
    expenseSummary(range),
    buying ? purchasesPanel(today) : null,
    has("finance.view", "corporate.view") ? receivablesAging(today) : null,
    has("finance.view") ? recentSpend(today, live) : null,
    onTheBooks(today, 14),
  ]);
  const comparable = (p.to < today || days >= 7) && !straddles;
  const insights = buildInsights(insightFactsOf({ ov, plPrev, spend, aging, pace, suppliers: purchases?.suppliers ?? null, canSeeAccounts, comparable }));
  const moneyTotal = ov.balances.reduce((s, b) => s + b.balance, 0);
  const ctx: HomeContext = { p, range, prev, days, today, live, straddles, prevHasRecords, has, ov, plPrev, spend };
  const href = (codes: PermissionCode[], to: string) => (has(...codes) ? to : undefined);
  const when = periodLabel(p, t);

  return (
    <div className="space-y-6">
      {insights.length > 0 && <div id="stands-out" className="scroll-mt-28"><InsightsPanel insights={insights} t={t} period={when} /></div>}

      <section className="space-y-4">
        <PartHeading id="accounts" tone="sky" icon={<Landmark />} title={t("Where the money is")} subtitle={t("What the hotel's own records add up to — check it against the bank")}
          action={undefined} />
        <AccountsPart t={t} ov={ov} canOpen={canSeeAccounts} canWithdraw={has("withdrawals.manage")} />
      </section>

      <section className="space-y-4">
        <PartHeading id="outlook" tone="amber" icon={<Clock />} title={t("Cash outlook")} subtitle={t("What is in the accounts, what is owed to the hotel and how late, what the hotel owes and when, how fast the money goes")} />
        <OutlookView t={t} money={moneyTotal} aging={aging} suppliers={purchases?.suppliers ?? null} pace={pace}
          pending={{ count: ov.expenses.pendingCount, amount: ov.expenses.pendingAmount }} booked={onBooks.next30}
          links={{
            receivables: href(["finance.view"], "/staff/finance/receivables"), procurement: href(["purchases.authorize", "purchases.pay", "procurement.manage"], "/staff/procurement?tab=invoices"),
            accounts: href(["ledger.view", "finance.view"], "/staff/finance/accounts"), expenses: href(["expenses.record", "expenses.view_all"], "/staff/expenses"),
          }} />
      </section>

      <section className="space-y-4">
        <PartHeading id="trends" tone="emerald" icon={<LineChart />} title={t("How the hotel is doing")} subtitle={`${when} · ${t("Occupancy, rates, six months, what moved against the period before, which days earn most")}`} />
        <Suspense fallback={<PartSkeleton label={t("Loading…")} height="h-96" />}><TrendsSection c={ctx} /></Suspense>
      </section>
    </div>
  );
}

/** The heading that opens the analysis on a dashboard. */
export async function MoneyAnalysisHeading({ p }: { p: ReturnType<typeof readPeriod> }) {
  const t = await getT();
  return <PartHeading id="analysis" tone="violet" icon={<BarChart3 />} title={t("The money, analysed")} subtitle={`${periodLabel(p, t)} · ${t("What stands out, where the money is, what is owed and when, how the hotel is doing")}`} />;
}

export const ANALYSIS_ICON = <BadgeCheck />;
