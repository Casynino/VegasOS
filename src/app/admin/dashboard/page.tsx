import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth";
import { getT } from "@/i18n/server";
import { OwnerOverview } from "@/components/dashboard/owner-overview";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Admin dashboard") };
}

export default async function AdminDashboard({ searchParams }: PageProps<"/admin/dashboard">) {
  await requirePagePermission("dashboard.admin");
  return <OwnerOverview searchParams={searchParams} roleLabel="Managing Director (MD)" basePath="/admin/dashboard" />;
}
