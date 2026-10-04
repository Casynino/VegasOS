import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { can, requirePagePermission } from "@/server/auth";
import { businessToday } from "@/server/settings";
import { readPeriod } from "@/components/staff/finance/finance-nav";
import { FinanceOverview } from "./finance-overview";

export const metadata: Metadata = { title: "Finance" };

export default async function FinanceOverviewPage({ searchParams }: PageProps<"/staff/finance">) {
  const user = await requirePagePermission("ledger.view", "finance.view");
  // Front desk has no finance overview (no profit figures): they start at Accounts.
  if (!can(user, "finance.view")) redirect("/staff/finance/accounts");
  const today = await businessToday();
  return <FinanceOverview p={readPeriod(await searchParams, today)} today={today} />;
}
