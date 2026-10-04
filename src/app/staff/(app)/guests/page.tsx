import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth";
import { GuestsList } from "./guests-list";

export const metadata: Metadata = { title: "Customers" };

export default async function GuestsPage({ searchParams }: PageProps<"/staff/guests">) {
  await requirePagePermission("guests.view");
  return <GuestsList sp={await searchParams} />;
}
