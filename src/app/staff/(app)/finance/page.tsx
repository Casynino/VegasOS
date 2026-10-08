import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { redirect } from "next/navigation";
import { can, requirePagePermission } from "@/server/auth";
import { businessToday } from "@/server/settings";
import { readPeriod } from "@/components/staff/finance/finance-nav";
import { FinanceOverview } from "./finance-overview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Finance") };
}

export default async function FinanceOverviewPage({ searchParams }: PageProps<"/staff/finance">) {
  const user = await requirePagePermission("ledger.view", "finance.view");
  // Front desk has no finance overview (no profit figures): they start at Accounts.
  if (!can(user, "finance.view")) redirect("/staff/finance/accounts");
  const today = await businessToday();
  return <FinanceOverview p={readPeriod(await searchParams, today)} today={today} />;
}
