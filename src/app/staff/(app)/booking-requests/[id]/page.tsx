import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth";
import { BookingRequestView } from "./request-view";

export const metadata: Metadata = { title: "Booking request" };

export default async function BookingRequestPage({ params }: PageProps<"/staff/booking-requests/[id]">) {
  const user = await requirePagePermission("booking_requests.view");
  const { id } = await params;
  return <BookingRequestView id={id} user={user} />;
}
