import type { Metadata } from "next";
import { Car, MapPin, Phone, Plane, Users } from "lucide-react";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { addDays, toDbDate } from "@/lib/time/business-date";
import { formatBusinessDate, formatTime } from "@/lib/format";
import { TRIP_STATUS_META, TRIP_TYPE_LABEL } from "@/lib/transport-meta";
import { PageHeader, EmptyState } from "@/components/staff/page-header";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent } from "@/components/ui/card";
import { DriverStepButton } from "./driver-step";

export const metadata: Metadata = { title: "My trips" };

/** Driver view — only what is needed to do the trip. No guest finances, no booking details. */
export default async function DriverPage() {
  const user = await requirePagePermission("transport.driver");
  const today = await businessToday();
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
      <PageHeader title="My trips" description={`Hello ${user.fullName.split(" ")[0]} — your assigned trips for the coming week.`} />
      {trips.length === 0 ? <EmptyState icon={<Car />} title="No trips assigned" description="New assignments from the manager will appear here." /> : trips.map((t) => (
        <Card key={t.id} className={t.status === "COMPLETED" ? "opacity-60" : ""}>
          <CardContent className="space-y-3">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="text-2xl font-bold tabular-nums">{formatTime(t.pickupAt)}</p>
                <p className="text-sm text-muted-foreground">{t.businessDate.toISOString().slice(0, 10) === today ? "Today" : formatBusinessDate(t.businessDate.toISOString().slice(0, 10))} · {TRIP_TYPE_LABEL[t.type]}</p>
              </div>
              <Badge variant="outline" className={TRIP_STATUS_META[t.status].className}>{TRIP_STATUS_META[t.status].label}</Badge>
            </div>
            <div className="space-y-1.5 text-sm">
              <p className="flex items-center gap-2"><Users className="size-4 text-muted-foreground" /><strong>{t.passengerName}</strong> · {t.passengers} passenger(s)</p>
              {t.passengerPhone && <p className="flex items-center gap-2"><Phone className="size-4 text-muted-foreground" /><a className="underline-offset-4 hover:underline" href={`tel:${t.passengerPhone}`}>{t.passengerPhone}</a></p>}
              <p className="flex items-center gap-2"><MapPin className="size-4 text-muted-foreground" />{t.pickupLocation} → {t.destination}</p>
              {t.flightNumber && <p className="flex items-center gap-2"><Plane className="size-4 text-muted-foreground" />Flight {t.flightNumber}</p>}
              {t.vehicle && <p className="flex items-center gap-2"><Car className="size-4 text-muted-foreground" />{t.vehicle.name}{t.vehicle.plateNumber && ` · ${t.vehicle.plateNumber}`}</p>}
              {t.notes && <p className="rounded-md bg-muted p-2">{t.notes}</p>}
            </div>
            <DriverStepButton tripId={t.id} status={t.status} />
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
