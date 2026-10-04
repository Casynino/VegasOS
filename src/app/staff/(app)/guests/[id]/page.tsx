import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth";
import { GuestProfile } from "./guest-profile";

export const metadata: Metadata = { title: "Customer" };

export default async function GuestPage({ params }: PageProps<"/staff/guests/[id]">) {
  const user = await requirePagePermission("guests.view");
  const { id } = await params;
  return <GuestProfile id={id} user={user} />;
}
