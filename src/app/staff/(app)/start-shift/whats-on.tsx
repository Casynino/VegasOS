import Link from "next/link";
import { ArrowRight, BedDouble, Car, ConciergeBell, DoorOpen, Inbox, LogOut } from "lucide-react";
import { db } from "@/server/db";
import { businessDayBounds, toDbDate, type BusinessDate, type BusinessDayConfig } from "@/lib/time/business-date";
import { REQUEST_TYPE_LABEL } from "@/lib/request-meta";
import { cn } from "@/lib/utils";

/**
 * WHAT'S GOING ON at the desk right now — read before starting a shift: who arrives, who leaves (and owes), what
 * guests asked for, rooms to clean or fix, online requests (and today's Hotel QR bookings) and today's transport.
 */
export async function whatsOn(today: BusinessDate, cfg: BusinessDayConfig) {
  const d = toDbDate(today);
  const { start, end } = businessDayBounds(today, cfg);
  const [arrivals, departures, requests, dirty, broken, online, trips, qr] = await Promise.all([
    db.reservation.findMany({
      where: { status: { in: ["RESERVED", "CONFIRMED"] }, arrivalDate: { lte: d }, OR: [{ departureDate: { gt: d } }, { departureDate: d, rooms: { some: { isDayUse: true } } }] }, orderBy: { arrivalDate: "asc" }, take: 30,
      select: { id: true, arrivalDate: true, kind: true, guest: { select: { fullName: true } }, rooms: { select: { room: { select: { number: true } } } }, trips: { where: { status: { notIn: ["CANCELLED", "COMPLETED", "NO_SHOW"] } }, select: { pickupAt: true } } },
    }),
    db.reservation.findMany({
      where: { status: "CHECKED_IN", departureDate: { lte: d }, kind: "STAY" }, orderBy: { departureDate: "asc" }, take: 30,
      select: { id: true, departureDate: true, balanceAmount: true, guest: { select: { fullName: true } }, rooms: { where: { status: "CHECKED_IN" }, select: { room: { select: { number: true } } } } },
    }),
    db.serviceRequest.findMany({ where: { status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS"] } }, orderBy: [{ createdAt: "asc" }], take: 30, select: { id: true, type: true, status: true, source: true, createdAt: true, room: { select: { number: true } }, assignedTo: { select: { fullName: true } } } }),
    db.room.findMany({ where: { isActive: true, status: { in: ["DIRTY", "CLEANING"] } }, select: { number: true }, orderBy: { number: "asc" } }),
    db.room.findMany({ where: { isActive: true, status: { in: ["MAINTENANCE", "OUT_OF_SERVICE"] } }, select: { number: true, statusNote: true }, orderBy: { number: "asc" } }),
    db.bookingRequest.count({ where: { status: "NEW" } }),
    db.transportTrip.findMany({ where: { pickupAt: { gte: start, lt: end }, status: { notIn: ["CANCELLED", "COMPLETED", "NO_SHOW"] } }, orderBy: { pickupAt: "asc" }, take: 6, select: { id: true, type: true, pickupAt: true, passengerName: true, destination: true } }),
    // Booked by guests from the Hotel QR today — real bookings already (pay later ones hold no room until paid).
    db.reservation.count({ where: { source: { code: "HOTEL_QR" }, createdAt: { gte: start, lt: end } } }),
  ]);
  return { today, arrivals, departures, requests, dirty, broken, online, trips, qr };
}
type On = Awaited<ReturnType<typeof whatsOn>>;

const first = (n: string) => n.replace(/\s*\(.*\)/, "").split(" ")[0];
const rooms = (r: { rooms: { room: { number: string } | null }[] }) => [...new Set(r.rooms.map((x) => x.room?.number).filter(Boolean))].join(", ");

function Card({ icon: Icon, tone, title, count, href, cta, children, empty }: {
  icon: typeof DoorOpen; tone: string; title: string; count: number; href: string; cta: string; children: React.ReactNode; empty: string;
}) {
  return (
    <section className="flex flex-col rounded-3xl border border-border/70 bg-card p-4">
      <div className="flex items-center gap-2.5">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", tone)}><Icon className="size-[18px]" /></span>
        <h3 className="min-w-0 flex-1 truncate text-sm font-semibold">{title}</h3>
        <span className={cn("rounded-full px-2 py-0.5 text-xs font-semibold tabular-nums", count ? "bg-foreground text-background" : "bg-muted text-muted-foreground")}>{count}</span>
      </div>
      <div className="mt-3 flex-1">{count ? children : <p className="rounded-2xl bg-muted/40 px-3 py-4 text-center text-xs text-muted-foreground">{empty}</p>}</div>
      <Link href={href} className="mt-3 inline-flex items-center gap-1 self-start text-xs font-semibold text-[oklch(0.55_0.11_75)] hover:underline dark:text-[oklch(0.8_0.1_82)]">{cta}<ArrowRight className="size-3.5" /></Link>
    </section>
  );
}

function Line({ lead, title, sub, tag, tagTone }: { lead?: string; title: string; sub?: string; tag?: string; tagTone?: string }) {
  return (
    <li className="flex items-center gap-2.5">
      {lead && <span className="grid h-8 min-w-11 shrink-0 place-items-center rounded-lg bg-muted px-1.5 text-xs font-bold tabular-nums">{lead}</span>}
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-sm font-medium">{title}</span>
        {sub && <span className="block truncate text-[11px] text-muted-foreground">{sub}</span>}
      </span>
      {tag && <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10.5px] font-semibold", tagTone)}>{tag}</span>}
    </li>
  );
}

/** The desk right now, in six small cards — each a short list and the page to act on it. */
export function WhatsOn({ on, timezone, now }: { on: On; timezone: string; now: Date }) {
  const clock = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(d);
  const mins = (d: Date) => Math.max(0, Math.round((now.getTime() - d.getTime()) / 60000));
  const ago = (d: Date) => { const m = mins(d); return m < 60 ? `${m} min ago` : m < 1440 ? `${Math.floor(m / 60)} h ago` : `${Math.floor(m / 1440)} d ago`; };
  const today = toDbDate(on.today).getTime();
  const owing = on.departures.filter((r) => r.balanceAmount > 0);
  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-end justify-between gap-2 px-1">
        <div>
          <h2 className="text-base font-semibold">What&apos;s going on</h2>
          <p className="text-xs text-muted-foreground">The desk right now — read it before you start.</p>
        </div>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3 md:grid-cols-2 xl:grid-cols-3">
        <Card icon={DoorOpen} tone="bg-sky-500/12 text-sky-600 dark:text-sky-300" title="Arriving" count={on.arrivals.length} href="/staff/check-in" cta="Check-in" empty="Nobody is waiting to check in.">
          <ul className="space-y-2">
            {on.arrivals.slice(0, 4).map((r) => {
              const late = r.arrivalDate.getTime() < today;
              const pickup = r.trips[0]?.pickupAt;
              return <Line key={r.id} lead={rooms(r) || "—"} title={r.guest.fullName} sub={pickup ? `Airport pickup ${clock(pickup)}` : r.kind === "MEETING" ? "Meeting room" : "Arrives today"} tag={late ? "Late" : undefined} tagTone="bg-amber-500/15 text-amber-700 dark:text-amber-300" />;
            })}
            {on.arrivals.length > 4 && <li className="text-[11px] text-muted-foreground">+{on.arrivals.length - 4} more</li>}
          </ul>
        </Card>
        <Card icon={LogOut} tone="bg-amber-500/12 text-amber-600 dark:text-amber-300" title="Leaving" count={on.departures.length} href="/staff/check-out" cta="Check-out" empty="Nobody is due to check out.">
          <ul className="space-y-2">
            {on.departures.slice(0, 4).map((r) => {
              const overdue = r.departureDate.getTime() < today;
              return <Line key={r.id} lead={rooms(r) || "—"} title={r.guest.fullName} sub={r.balanceAmount > 0 ? `Owes TZS ${r.balanceAmount.toLocaleString("en-US")}` : "Paid up"} tag={overdue ? "Overdue" : undefined} tagTone="bg-rose-500/15 text-rose-700 dark:text-rose-300" />;
            })}
            {on.departures.length > 4 && <li className="text-[11px] text-muted-foreground">+{on.departures.length - 4} more{owing.length ? ` · ${owing.length} owe money` : ""}</li>}
          </ul>
        </Card>
        <Card icon={ConciergeBell} tone="bg-violet-500/12 text-violet-600 dark:text-violet-300" title="Guest requests" count={on.requests.length} href="/staff/requests" cta="Requests" empty="No guest is waiting for anything.">
          <ul className="space-y-2">
            {on.requests.slice(0, 4).map((q) => (
              <Line key={q.id} lead={q.room?.number ?? "—"} title={REQUEST_TYPE_LABEL[q.type] ?? "Request"} sub={`${q.source === "STAFF" ? "Logged" : "From the guest"} · ${ago(q.createdAt)}`}
                tag={q.status === "IN_PROGRESS" ? `${first(q.assignedTo?.fullName ?? "Someone")} on it` : q.status === "ASSIGNED" ? `For ${first(q.assignedTo?.fullName ?? "")}` : "New"}
                tagTone={q.status === "IN_PROGRESS" ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-sky-500/15 text-sky-700 dark:text-sky-300"} />
            ))}
            {on.requests.length > 4 && <li className="text-[11px] text-muted-foreground">+{on.requests.length - 4} more</li>}
          </ul>
        </Card>
        <Card icon={BedDouble} tone="bg-teal-500/12 text-teal-600 dark:text-teal-300" title="Rooms" count={on.dirty.length + on.broken.length} href="/staff/rooms" cta="Rooms" empty="Every room is clean and working.">
          <div className="space-y-2.5 text-sm">
            {on.dirty.length > 0 && <p><span className="font-semibold">{on.dirty.length} to clean</span><span className="mt-0.5 block text-xs text-muted-foreground">{on.dirty.slice(0, 10).map((r) => r.number).join(" · ")}{on.dirty.length > 10 ? " …" : ""}</span></p>}
            {on.broken.length > 0 && <p><span className="font-semibold text-rose-600 dark:text-rose-400">{on.broken.length} under repair</span><span className="mt-0.5 block text-xs text-muted-foreground">{on.broken.slice(0, 4).map((r) => `${r.number}${r.statusNote ? ` — ${r.statusNote}` : ""}`).join(" · ")}</span></p>}
          </div>
        </Card>
        <Card icon={Car} tone="bg-orange-500/12 text-orange-600 dark:text-orange-300" title="Transport today" count={on.trips.length} href="/staff/transport" cta="Transport" empty="No pickup or drop-off today.">
          <ul className="space-y-2">
            {on.trips.map((t) => <Line key={t.id} lead={clock(t.pickupAt)} title={t.passengerName} sub={`${t.type.charAt(0)}${t.type.slice(1).toLowerCase().replace(/_/g, " ")} · ${t.destination}`} />)}
          </ul>
        </Card>
        <Card icon={Inbox} tone="bg-[oklch(0.75_0.12_80)]/15 text-[oklch(0.55_0.11_75)] dark:text-[#f0cf86]" title="Online bookings" count={on.online + on.qr}
          href={on.online || !on.qr ? "/staff/booking-requests" : "/staff/hotel-qr?list=today#bookings"} cta={on.online || !on.qr ? "Online requests" : "Hotel QR bookings"} empty="No new online booking request.">
          <ul className="space-y-2">
            {on.online > 0 && <Line lead={String(on.online)} title={`New online booking request${on.online === 1 ? "" : "s"}`} sub="From the website — call them back" tag="New" tagTone="bg-sky-500/15 text-sky-700 dark:text-sky-300" />}
            {on.qr > 0 && <Line lead={String(on.qr)} title={`Hotel QR booking${on.qr === 1 ? "" : "s"} today`} sub="Booked by the guest from the QR — already in Reservations" tag="QR" tagTone="bg-[oklch(0.75_0.12_80)]/15 text-[oklch(0.5_0.11_75)] dark:text-[#f0cf86]" />}
          </ul>
        </Card>
      </div>
    </section>
  );
}
