import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth";
import { getT } from "@/i18n/server";
import { FrontDeskToday } from "@/app/staff/(app)/front-desk-today";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Front desk today") };
}

export default async function ReceptionDashboard() {
  await requirePagePermission("dashboard.front_desk");
  return <FrontDeskToday />;
}
