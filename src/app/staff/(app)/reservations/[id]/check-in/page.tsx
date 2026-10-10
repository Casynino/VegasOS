import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { CheckInWizard } from "./wizard";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Check in") };
}

export default async function CheckInPage({ params }: PageProps<"/staff/reservations/[id]/check-in">) {
  await requirePagePermission("reservations.check_in");
  const { id } = await params;
  const r = await db.reservation.findUnique({
    where: { id },
    include: { guest: true, source: true, rooms: { include: { room: true, roomType: true } }, trips: { where: { status: { not: "CANCELLED" } } }, charges: { where: { isVoided: false } } },
  });
  if (!r) notFound();
  if (!r.rooms.some((x) => x.status === "RESERVED" || x.status === "CONFIRMED")) redirect(`/staff/reservations/${r.id}`);
  const rooms = r.rooms.filter((x) => x.status === "RESERVED" || x.status === "CONFIRMED");
  return (
    <CheckInWizard
      reservation={{
        id: r.id, reference: r.reference, source: r.source.name, eta: r.eta ?? "", specialRequests: r.specialRequests ?? "", internalNotes: r.internalNotes ?? "",
        adults: r.adults, children: r.children, gross: r.grossAmount, discount: r.discountAmount, charges: r.chargesAmount, net: r.netAmount, paid: r.paidAmount, balance: r.balanceAmount,
        hasTransport: r.trips.length > 0,
        rooms: rooms.map((x) => ({
          number: x.room.number, type: x.roomType.name, roomStatus: x.room.status, nights: x.nights, isDayUse: x.isDayUse,
          arrival: x.arrivalDate.toISOString().slice(0, 10), departure: x.departureDate.toISOString().slice(0, 10), endAt: x.endAt.toISOString(),
          rate: x.ratePerNight, discount: x.discountPerNight, net: x.netAmount,
        })),
      }}
      guest={{
        fullName: r.guest.fullName, phone: r.guest.phone ?? "", email: r.guest.email ?? "", idType: r.guest.idType ?? "",
        idNumber: r.guest.idNumber ?? "", nationality: r.guest.nationality ?? "", address: r.guest.address ?? "",
      }}
    />
  );
}
