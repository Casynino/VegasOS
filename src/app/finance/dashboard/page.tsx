import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth";
import { getT } from "@/i18n/server";
import { FinanceHome } from "@/components/dashboard/finance-home";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Finance dashboard") };
}

/** Finance's Home: what needs Finance, the money of the period against the one before, cash, accounts, purchases, bookings and the full analysis. */
export default async function FinanceDashboard({ searchParams }: PageProps<"/finance/dashboard">) {
  // Both rights: the Home shows the whole financial picture, so a role that only holds the dashboard right (a custom one) does not get it.
  await requirePagePermission("dashboard.finance");
  await requirePagePermission("finance.view");
  return <FinanceHome searchParams={searchParams} />;
}
