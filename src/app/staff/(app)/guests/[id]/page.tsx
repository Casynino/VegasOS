import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth";
import { getT } from "@/i18n/server";
import { GuestProfile } from "./guest-profile";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Customer") };
}

export default async function GuestPage({ params }: PageProps<"/staff/guests/[id]">) {
  const user = await requirePagePermission("guests.view");
  const { id } = await params;
  return <GuestProfile id={id} user={user} />;
}
