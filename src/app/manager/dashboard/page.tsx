import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth";
import { OwnerOverview } from "@/components/dashboard/owner-overview";

export const metadata: Metadata = { title: "Manager dashboard" };

export default async function ManagerDashboard({ searchParams }: PageProps<"/manager/dashboard">) {
  await requirePagePermission("dashboard.manager", "dashboard.owner", "dashboard.admin");
  return <OwnerOverview searchParams={searchParams} roleLabel="Manager" basePath="/manager/dashboard" />;
}
