import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth";
import { FrontDeskToday } from "@/app/staff/(app)/front-desk-today";

export const metadata: Metadata = { title: "Front desk today" };

export default async function ReceptionDashboard() {
  await requirePagePermission("dashboard.front_desk");
  return <FrontDeskToday />;
}
