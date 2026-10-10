import type { Metadata } from "next";
import { Car, MapPin, Phone, Plane, Users } from "lucide-react";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { addDays, toDbDate } from "@/lib/time/business-date";
import { TRIP_STATUS_META, TRIP_TYPE_LABEL } from "@/lib/transport-meta";
import { PageHeader, EmptyState } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DriverStepButton } from "./driver-step";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("My trips") };
}

/** Driver view — only what is needed to do the trip. No guest finances, no booking details. */
export default async function DriverPage() {
  const user = await requirePagePermission("transport.driver");
  const today = await businessToday();
  const t = await getT();
  const trips = await db.transportTrip.findMany({
    where: { driverId: user.id, status: { notIn: ["CANCELLED"] }, businessDate: { gte: toDbDate(addDays(today, -1)), lte: toDbDate(addDays(today, 7)) } },
    orderBy: { pickupAt: "asc" },
    select: {
      id: true, type: true, status: true, pickupAt: true, businessDate: true, passengerName: true, passengerPhone: true,
      pickupLocation: true, destination: true, flightNumber: true, passengers: true, notes: true, vehicle: { select: { name: true, plateNumber: true } },
    },
  });
  return (
    <div className="w-full space-y-3">
      <PageHeader title={t("My trips")} description={t("Hello {name} — your assigned trips for the coming week.", { name: user.fullName.split(" ")[0] })} />
      {trips.length === 0 ? <EmptyState icon={<Car />} title={t("No trips assigned")} description={t("New assignments from the manager will appear here.")} /> : trips.map((trip) => (
        <Card key={trip.id} className={trip.status === "COMPLETED" ? "opacity-60" : ""}>
          <CardContent className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-2xl font-bold tabular-nums">{t.time(trip.pickupAt)}</p>
                <p className="text-sm text-muted-foreground">{trip.businessDate.toISOString().slice(0, 10) === today ? t("Today") : t.date(trip.businessDate.toISOString().slice(0, 10))} · {t(TRIP_TYPE_LABEL[trip.type])}</p>
              </div>
              <Badge variant="outline" className={TRIP_STATUS_META[trip.status].className}>{t(TRIP_STATUS_META[trip.status].label)}</Badge>
            </div>
            <div className="space-y-1.5 text-sm">
              <p className="flex items-center gap-2"><Users className="size-4 text-muted-foreground" /><strong>{trip.passengerName}</strong> · {t("{n} passenger(s)", { n: trip.passengers })}</p>
              {trip.passengerPhone && <p className="flex items-center gap-2"><Phone className="size-4 text-muted-foreground" /><a className="underline-offset-4 hover:underline" href={`tel:${trip.passengerPhone}`}>{trip.passengerPhone}</a></p>}
              <p className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" />{trip.pickupLocation} → {trip.destination}</p>
              {trip.flightNumber && <p className="flex items-center gap-2"><Plane className="size-4 text-muted-foreground" />{t("Flight {flight}", { flight: trip.flightNumber })}</p>}
              {trip.vehicle && <p className="flex items-center gap-2"><Car className="size-4 text-muted-foreground" />{trip.vehicle.name}{trip.vehicle.plateNumber && ` · ${trip.vehicle.plateNumber}`}</p>}
              {trip.notes && <p className="rounded-md bg-muted p-2">{trip.notes}</p>}
            </div>
            <DriverStepButton tripId={trip.id} status={trip.status} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
