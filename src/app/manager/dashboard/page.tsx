import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth";
import { getT } from "@/i18n/server";
import { OwnerOverview } from "@/components/dashboard/owner-overview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Manager dashboard") };
}

export default async function ManagerDashboard({ searchParams }: PageProps<"/manager/dashboard">) {
  await requirePagePermission("dashboard.manager", "dashboard.owner", "dashboard.admin");
  return <OwnerOverview searchParams={searchParams} roleLabel="Manager" basePath="/manager/dashboard" />;
}
