import type { Metadata } from "next";
import { getT } from "@/i18n/server";
import { requirePagePermission } from "@/server/auth";
import { businessToday } from "@/server/settings";
import { readPeriod } from "@/components/staff/finance/finance-nav";
import { StaffView } from "./staff-view";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Staff activity") };
}

export default async function StaffActivityPage({ searchParams }: PageProps<"/staff/finance/staff">) {
  await requirePagePermission("finance.view");
  return <StaffView p={readPeriod(await searchParams, await businessToday())} />;
}
