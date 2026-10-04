import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth";
import { businessToday } from "@/server/settings";
import { readPeriod } from "@/components/staff/finance/finance-nav";
import { StaffView } from "./staff-view";

export const metadata: Metadata = { title: "Staff activity" };

export default async function StaffActivityPage({ searchParams }: PageProps<"/staff/finance/staff">) {
  await requirePagePermission("finance.view");
  return <StaffView p={readPeriod(await searchParams, await businessToday())} />;
}
