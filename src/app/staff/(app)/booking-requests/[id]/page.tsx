import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth";
import { getT } from "@/i18n/server";
import { BookingRequestView } from "./request-view";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Booking request") };
}

export default async function BookingRequestPage({ params }: PageProps<"/staff/booking-requests/[id]">) {
  const user = await requirePagePermission("booking_requests.view");
  const { id } = await params;
  return <BookingRequestView id={id} user={user} />;
}
