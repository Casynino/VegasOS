import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth";
import { OwnerOverview } from "@/components/dashboard/owner-overview";

export const metadata: Metadata = { title: "Admin dashboard" };

export default async function AdminDashboard({ searchParams }: PageProps<"/admin/dashboard">) {
  await requirePagePermission("dashboard.admin");
  return <OwnerOverview searchParams={searchParams} roleLabel="Managing Director (MD)" basePath="/admin/dashboard" />;
}
