import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth";
import { businessToday } from "@/server/settings";
import { readPeriod } from "@/components/staff/finance/finance-nav";
import { RoomPerformance } from "./room-performance";

export const metadata: Metadata = { title: "Room performance" };

export default async function RoomPerformancePage({ searchParams }: PageProps<"/staff/finance/rooms">) {
  await requirePagePermission("finance.view");
  return <RoomPerformance p={readPeriod(await searchParams, await businessToday())} />;
}
