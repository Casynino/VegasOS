import type { Metadata } from "next";
import Link from "next/link";
import { BedDouble, CheckCircle2, Clock, Wallet } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { accountOptions } from "@/server/services/payment-accounts";
import { OPEN_TRIP, transportReport, transportServices, tripMoney } from "@/server/services/transport";
import { addDays, fromDbDate, toDbDate } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { TRIP_STATUS_META, TRIP_TYPE_LABEL, tripTone } from "@/lib/transport-meta";
import type { Prisma } from "@/generated/prisma/client";
import { PageHeader } from "@/components/staff/page-header";
import { PeriodPicker, periodLabel, readPeriod } from "@/components/staff/finance/finance-nav";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { ConfirmTripQuick, NewRequestButton, ServicePrices, TripIcon, TripRowButton, VehicleForm, type BookingOpt, type ServiceOpt, type TripView } from "./transport-forms";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Transport") };
}

const TABS = [
  { key: "today", label: msg("Today") }, { key: "pending", label: msg("Pending") }, { key: "confirmed", label: msg("Confirmed") }, { key: "active", label: msg("In progress") },
  { key: "upcoming", label: msg("Upcoming") }, { key: "completed", label: msg("Completed") }, { key: "closed", label: msg("Cancelled") },
] as const;
type ListTab = (typeof TABS)[number]["key"];
type Tab = ListTab | "report";

/**
 * Guest transport for reception: every request (website, phone, a guest in the hotel)
 * in one list — open one, confirm, arrange the driver, complete, then add it to the
 * room or record the payment. Managers see the money in "Report & prices".
 */
export default async function TransportPage({ searchParams }: PageProps<"/staff/transport">) {
  const user = await requirePagePermission("transport.view", "transport.manage");
  const t = await getT();
  const sp = await searchParams;
  const today = await businessToday();
  const t0 = toDbDate(today);
  const canReport = can(user, "transport.manage") || can(user, "reports.view");
  const where: Record<ListTab, Prisma.TransportTripWhereInput> = {
    today: { businessDate: t0, status: { notIn: ["CANCELLED"] } },
    pending: { status: "REQUESTED" },
    confirmed: { status: { in: ["CONFIRMED", "ASSIGNED"] } },
    active: { status: { in: ["EN_ROUTE", "PICKED_UP"] } },
    upcoming: { businessDate: { gt: t0 }, status: { in: OPEN_TRIP } },
    completed: { status: "COMPLETED", businessDate: { gte: toDbDate(addDays(today, -60)) } },
    closed: { status: { in: ["CANCELLED", "NO_SHOW"] }, businessDate: { gte: toDbDate(addDays(today, -60)) } },
  };
  const counts = Object.fromEntries(await Promise.all(TABS.map(async (x) => [x.key, await db.transportTrip.count({ where: where[x.key] })] as const))) as Record<ListTab, number>;
  const asked = (typeof sp.tab === "string" ? sp.tab : "") as Tab;
  const tab: Tab = asked === "report" && canReport ? "report" : TABS.some((x) => x.key === asked) ? asked : counts.pending ? "pending" : "today";

  const reservationId = typeof sp.reservation === "string" ? sp.reservation : null;
  const [trips, services, allServices, drivers, vehicles, accounts, stayingRes, arrivingRes] = await Promise.all([
    db.transportTrip.findMany({
      where: tab === "report" ? { id: "-" } : where[tab], orderBy: tab === "completed" || tab === "closed" ? { pickupAt: "desc" } : { pickupAt: "asc" }, take: 200,
      include: {
        reservation: { select: { id: true, reference: true } }, confirmedBy: { select: { fullName: true } }, priceAdjustedBy: { select: { fullName: true } },
        sales: { where: { isVoided: false }, select: { id: true, account: { select: { name: true } } } },
      },
    }),
    transportServices(),
    can(user, "transport.manage") || can(user, "settings.manage") ? transportServices({ includeInactive: true }) : Promise.resolve([]),
    db.user.findMany({ where: { isActive: true, role: { permissions: { some: { permission: { code: "transport.driver" } } } } }, select: { id: true, fullName: true, phone: true }, orderBy: { fullName: "asc" } }),
    db.vehicle.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, plateNumber: true, capacity: true } }),
    accountOptions("payments"),
    db.reservation.findMany({ where: { status: "CHECKED_IN" }, include: { guest: true, rooms: { where: { status: "CHECKED_IN" }, include: { room: { select: { number: true } } } } } }),
    db.reservation.findMany({ where: { status: { in: ["RESERVED", "CONFIRMED"] }, arrivalDate: { gte: toDbDate(addDays(today, -1)), lte: toDbDate(addDays(today, 30)) } }, include: { guest: true }, orderBy: { arrivalDate: "asc" }, take: 150 }),
  ]);
  const staying: BookingOpt[] = stayingRes
    .map((r) => ({ id: r.id, name: r.guest.fullName, phone: r.guest.phone, email: r.guest.email, label: `${t("Room {number}", { number: r.rooms.map((x) => x.room.number).join(", ") })} · ${t("in the hotel")}`, staying: true }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { numeric: true }));
  const bookings: BookingOpt[] = [
    ...staying,
    ...arrivingRes.map((r) => ({ id: r.id, name: r.guest.fullName, phone: r.guest.phone, email: r.guest.email, label: `${t("Arrives {date}", { date: t.date(fromDbDate(r.arrivalDate)) })} · ${r.reference}`, staying: false })),
  ];
  const view = (trip: (typeof trips)[number]): TripView => ({
    id: trip.id, reference: trip.reference, type: trip.type, status: trip.status, source: trip.source,
    passengerName: trip.passengerName, passengerPhone: trip.passengerPhone, passengerEmail: trip.passengerEmail,
    date: t.date(fromDbDate(trip.businessDate), true), time: t.time(trip.pickupAt), pickupLocation: trip.pickupLocation, destination: trip.destination,
    flightNumber: trip.flightNumber, passengers: trip.passengers, bags: trip.bags, notes: trip.notes,
    reservation: trip.reservation, reservationRef: trip.reservationRef, roomNumber: trip.roomNumber,
    driverName: trip.driverName, driverPhone: trip.driverPhone, vehicleName: trip.vehicleName, vehiclePlate: trip.vehiclePlate,
    price: trip.charge ?? 0, priceOption: trip.priceOption, standardPrice: trip.standardPrice, priceReason: trip.priceReason, priceAdjustedBy: trip.priceAdjustedBy?.fullName ?? null,
    confirmedBy: trip.confirmedBy?.fullName ?? null, cancelReason: trip.cancelReason,
    money: tripMoney(trip), paidInto: trip.sales[0]?.account.name ?? null,
  });
  const canConfirm = can(user, "transport.request") || can(user, "transport.manage");
  const ctx = { drivers, vehicles, accounts, staying, perms: { manage: can(user, "transport.manage"), pay: can(user, "payments.record") } };
  const groups: { day: string; list: typeof trips }[] = [];
  for (const trip of trips) {
    const day = fromDbDate(trip.businessDate);
    const last = groups[groups.length - 1];
    if (last?.day === day) last.list.push(trip); else groups.push({ day, list: [trip] });
  }
  const canCreate = can(user, "transport.request") || can(user, "transport.manage");
  const period = readPeriod(sp, today, "today");
  const report = tab === "report" ? await transportReport(period.from, period.to) : null;

  return (
    <div className="w-full space-y-5">
      <PageHeader eyebrow={t("Guest transport")} title={t("Transport")}
        description={t("Airport pickups & drop-offs, meeting and custom trips — from the website, a call or a guest at the desk. Open a request to confirm, arrange the driver, complete and bill it.")}
        actions={canCreate && services.length > 0 && <NewRequestButton services={services.map(serviceOpt)} bookings={bookings} today={today} prefill={reservationId ? { reservationId } : null} defaultOpen={!!reservationId} />} />

      <nav aria-label={t("Transport lists")} className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 [scrollbar-width:none]">
        {TABS.map((x) => (
          <Link key={x.key} href={`?tab=${x.key}`} aria-current={tab === x.key ? "page" : undefined}
            className={cn("inline-flex shrink-0 items-center gap-2 rounded-full border px-3.5 py-1.5 text-sm font-medium transition-colors",
              tab === x.key ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted")}>
            {t(x.label)}
            <span className={cn("min-w-5 rounded-full px-1.5 text-center text-xs tabular-nums", tab === x.key ? "bg-background/20" : x.key === "pending" && counts.pending ? "bg-amber-500 text-black" : "bg-muted text-muted-foreground")}>{counts[x.key]}</span>
          </Link>
        ))}
        {canReport && (
          <Link href="?tab=report" aria-current={tab === "report" ? "page" : undefined}
            className={cn("ml-auto inline-flex shrink-0 items-center rounded-full border px-3.5 py-1.5 text-sm font-medium", tab === "report" ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted")}>{t("Report & prices")}</Link>
        )}
      </nav>

      {tab !== "report" && (
        trips.length === 0 ? (
          <p className="rounded-3xl border border-dashed border-border px-6 py-14 text-center text-sm text-muted-foreground">
            {tab === "pending" ? t("No requests waiting — website and phone requests appear here.") : tab === "today" ? t("No trips today.") : t("Nothing here.")}
          </p>
        ) : (
          <div className="space-y-4">
            {groups.map((g) => (
              <section key={g.day} className="overflow-hidden rounded-3xl border border-border/70 bg-card">
                <h2 className="border-b border-border/60 bg-muted/30 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  {g.day === today ? t("Today") : g.day === addDays(today, 1) ? t("Tomorrow") : t.date(g.day, true)} · {g.list.length}
                </h2>
                <ul className="divide-y divide-border/60">
                  {g.list.map((trip) => {
                    const v = view(trip);
                    const meta = TRIP_STATUS_META[trip.status];
                    return (
                      <li key={trip.id} className="flex items-center">
                        <div className="min-w-0 flex-1">
                        <TripRowButton trip={v} {...ctx}>
                          <span className="grid gap-x-4 gap-y-1.5 px-4 py-3 transition-colors hover:bg-muted/40 md:grid-cols-[5.5rem_minmax(0,1.6fr)_minmax(0,1.6fr)_minmax(0,1fr)_9.5rem] md:items-center">
                            <span className="flex items-baseline gap-2 md:block">
                              <span className="block text-lg font-semibold leading-none tabular-nums">{t.time(trip.pickupAt)}</span>
                              <span className="font-mono text-[11px] text-muted-foreground">{trip.reference}</span>
                            </span>
                            <span className="flex min-w-0 items-center gap-3">
                              <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", tripTone(trip.type))}><TripIcon type={trip.type} className="size-4" /></span>
                              <span className="min-w-0 leading-tight">
                                <span className="block truncate font-semibold">{trip.passengerName}</span>
                                <span className="block truncate text-xs text-muted-foreground">{t(TRIP_TYPE_LABEL[trip.type])} · {trip.passengerPhone ?? t("no phone")}</span>
                              </span>
                            </span>
                            <span className="min-w-0 text-sm leading-tight">
                              <span className="block truncate">{trip.type === "AIRPORT_PICKUP" ? t("From {place}", { place: trip.pickupLocation }) : t("To {place}", { place: trip.destination })}</span>
                              <span className="block truncate text-xs text-muted-foreground">{trip.flightNumber ? `${t("Flight {number}", { number: trip.flightNumber })} · ` : ""}{t.plural(trip.passengers, "{n} guest", "{n} guests")} · {t.plural(trip.bags, "{n} bag", "{n} bags")}{trip.driverName ? ` · ${trip.driverName}` : ""}</span>
                            </span>
                            <span className="min-w-0 text-xs">
                              {trip.reservation ? <span className="inline-flex items-center gap-1 rounded-lg bg-muted px-2 py-1"><BedDouble className="size-3.5" />{trip.roomNumber ? t("Room {number}", { number: trip.roomNumber }) : trip.reservation.reference}</span>
                                : <span className="text-muted-foreground">{t("Outside guest")}</span>}
                              {trip.source === "WEBSITE" && <span className="ml-1.5 text-muted-foreground">· {t("website")}</span>}
                            </span>
                            <span className="flex items-center justify-between gap-2 md:flex-col md:items-end">
                              <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-semibold", meta.className)}>{t(meta.label)}</span>
                              <span className="text-sm font-semibold tabular-nums">
                                {trip.priceOption && <span className="mr-1 text-xs font-normal text-muted-foreground">{t(trip.priceOption)} ·</span>}{formatTZS(trip.charge ?? 0)}
                                {v.money === "ROOM" && <span className="ml-1 text-xs font-medium text-sky-700 dark:text-sky-300">· {t("on room")}</span>}
                                {v.money === "PAID" && <span className="ml-1 text-xs font-medium text-emerald-700 dark:text-emerald-400">· {t("paid")}</span>}
                                {v.money === "TO_BILL" && <span className="ml-1 text-xs font-medium text-amber-700 dark:text-amber-400">· {t("to bill")}</span>}
                              </span>
                            </span>
                          </span>
                        </TripRowButton>
                        </div>
                        {/* A waiting request: confirm it right here (the driver and the rest when the trip is opened). */}
                        {trip.status === "REQUESTED" && canConfirm && <ConfirmTripQuick tripId={trip.id} className="mr-4 shrink-0" />}
                      </li>
                    );
                  })}
                </ul>
              </section>
            ))}
          </div>
        )
      )}

      {tab === "report" && report && (
        <div className="space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-sm text-muted-foreground">{periodLabel(period, t)}</p>
            <PeriodPicker current={period.key} from={period.from} to={period.to} keep={{ tab: "report" }} />
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Stat label={t("Transport income")} value={formatTZS(report.revenue)} sub={`${t.plural(report.trips, "{n} trip", "{n} trips")} · ${t("{n} completed", { n: report.completed })}`} icon={<Wallet />} tone="bg-teal-500/12 text-teal-600 dark:text-teal-300" />
            <Stat label={t("Paid directly")} value={formatTZS(report.paidDirect)} sub={t("Into a hotel account")} icon={<CheckCircle2 />} tone="bg-emerald-500/12 text-emerald-600 dark:text-emerald-300" />
            <Stat label={t("On room bills")} value={formatTZS(report.onRooms)} sub={t("Collected at checkout")} icon={<BedDouble />} tone="bg-sky-500/12 text-sky-600 dark:text-sky-300" />
            <Stat label={t("Not billed yet")} value={formatTZS(report.toBill)} sub={t.plural(report.toBillCount, "{n} completed trip", "{n} completed trips")} icon={<Clock />} tone="bg-amber-500/12 text-amber-700 dark:text-amber-300" />
          </div>
          <p className="text-sm text-muted-foreground">{t("Trips in this period: {pending} pending · {active} confirmed or on the road · {completed} completed · {noShow} no-show · {cancelled} cancelled.", { pending: report.pending, active: report.active, completed: report.completed, noShow: report.noShow, cancelled: report.cancelled })}</p>

          <div className="grid gap-5 lg:grid-cols-2">
            {allServices.length > 0 && (
              <section className="rounded-3xl border border-border/70 bg-card p-5">
                <h2 className="font-semibold">{t("Services, packages & prices")}</h2>
                <p className="mb-3 text-sm text-muted-foreground">{t("Admin and managers can change these any time. New requests use them; a trip keeps the package and price it was made with.")}</p>
                <ServicePrices services={allServices.map(serviceOpt)} />
              </section>
            )}
            {can(user, "transport.manage") && (
              <section className="rounded-3xl border border-border/70 bg-card p-5">
                <h2 className="font-semibold">{t("Hotel vehicles")}</h2>
                <p className="mb-2 text-sm text-muted-foreground">{t("Optional — pick them when you record who drives.")}</p>
                <ul className="space-y-1 text-sm">
                  {vehicles.map((v) => <li key={v.id} className="flex justify-between"><span>{v.name}{v.plateNumber && <span className="ml-1 font-mono text-xs text-muted-foreground">{v.plateNumber}</span>}</span><span className="text-muted-foreground">{t("{n} seats", { n: v.capacity })}</span></li>)}
                  {vehicles.length === 0 && <li className="text-muted-foreground">{t("No vehicles yet.")}</li>}
                </ul>
                <VehicleForm />
              </section>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

const serviceOpt = (s: Awaited<ReturnType<typeof transportServices>>[number]): ServiceOpt => ({
  id: s.id, name: s.name, description: s.description, type: s.type, price: s.price, isActive: s.isActive, isPublic: s.isPublic,
  options: s.options.map((o) => ({ id: o.id, name: o.name, description: o.description, price: o.price, isActive: o.isActive })),
});

function Stat({ label, value, sub, icon, tone }: { label: string; value: string; sub: string; icon: React.ReactNode; tone: string }) {
  return (
    <div className="rounded-3xl border border-border/70 bg-card p-4">
      <div className="flex items-center gap-2">
        <span className={cn("grid size-8 place-items-center rounded-xl [&_svg]:size-4", tone)}>{icon}</span>
        <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{label}</span>
      </div>
      <p className="mt-3 text-2xl font-semibold tabular-nums">{value}</p>
      <p className="text-xs text-muted-foreground">{sub}</p>
    </div>
  );
}
