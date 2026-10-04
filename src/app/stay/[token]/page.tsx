import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSettings } from "@/server/settings";
import { stayByToken } from "@/server/services/guest-comms";
import { StayPage } from "@/components/restaurant/stay-page";

export const metadata: Metadata = {
  title: "Your stay",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

/**
 * The guest's private stay page (the link in their booking / welcome message): the same page
 * the room QR opens — their stay, bill, Wi-Fi and reception, and the menu to order to the room.
 */
export default async function GuestStayPage({ params }: PageProps<"/stay/[token]">) {
  const { token } = await params;
  const [stay, s] = await Promise.all([stayByToken(token), getSettings()]);
  if (!stay) notFound();
  return <StayPage stay={stay} s={s} target={{ kind: "stay", token }} />;
}
