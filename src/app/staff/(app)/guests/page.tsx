import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth";
import { getT } from "@/i18n/server";
import { GuestsList } from "./guests-list";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Customers") };
}

export default async function GuestsPage({ searchParams }: PageProps<"/staff/guests">) {
  await requirePagePermission("guests.view");
  return <GuestsList sp={await searchParams} />;
}
