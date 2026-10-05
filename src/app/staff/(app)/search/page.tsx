import type { Metadata } from "next";
import Link from "next/link";
import { CalendarPlus, Inbox, SearchX, UserCheck } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { receptionSearch } from "@/server/services/reception-search";
import { businessToday } from "@/server/settings";
import { fromDbDate, toDbDate } from "@/lib/time/business-date";
import { formatBusinessDate, formatTZS } from "@/lib/format";
import { BOOKING_REQUEST_STATUS } from "@/lib/booking-request-meta";
import { cn } from "@/lib/utils";
import { MEETING_STATUS_LABEL, timeRange } from "@/lib/meeting";
import { EmptyState, PageHeader } from "@/components/staff/page-header";
import { ReceptionSearch } from "@/components/staff/reception/search";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Find guest" };

const STATUS_TONE: Record<string, string> = {
  CHECKED_IN: "bg-emerald-600/10 text-emerald-800 dark:text-emerald-300",
  CONFIRMED: "bg-sky-600/10 text-sky-800 dark:text-sky-300",
  RESERVED: "bg-sky-600/10 text-sky-800 dark:text-sky-300",
  INQUIRY: "bg-orange-500/10 text-orange-800 dark:text-orange-300",
  CHECKED_OUT: "bg-muted text-muted-foreground",
  CANCELLED: "bg-red-600/10 text-red-800 dark:text-red-300",
  NO_SHOW: "bg-red-600/10 text-red-800 dark:text-red-300",
};

export default async function SearchPage({ searchParams }: PageProps<"/staff/search">) {
  const user = await requirePagePermission("reservations.view");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q : "";
  const [res, today] = await Promise.all([receptionSearch(q), businessToday()]);
  const todayDb = toDbDate(today);
  const total = res ? res.reservations.length + res.guests.length + res.requests.length + res.groups.length : 0;

  return (
    <div className="w-full space-y-5">
      <PageHeader eyebrow="Reception" title="Find a guest" description="Search by guest name, phone number, booking reference, room number, group, company or invoice number." />
      <ReceptionSearch defaultValue={q} autoFocus className="max-w-xl" />

      {!res ? (
        <p className="text-sm text-muted-foreground">Type at least two characters — e.g. “John”, “0712”, “VLH-2048” or “204”.</p>
      ) : total === 0 ? (
        <EmptyState icon={<SearchX />} title={`Nothing found for “${res.q}”`} description="Try part of the name, or the last digits of the phone number."
          action={can(user, "reservations.create") ? <Link href="/staff/reservations/new" className={buttonVariants()}>New reservation</Link> : undefined} />
      ) : (
        <>
          {res.groups.length > 0 && (
            <section aria-labelledby="grp-title" className="space-y-2">
              <h2 id="grp-title" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Group bookings</h2>
              <ul className="space-y-2">
                {res.groups.map((g) => (
                  <li key={g.id}>
                    <Link href={`/staff/groups/${g.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 hover:bg-muted/40">
                      <span className="min-w-0">
                        <span className="block font-semibold">{g.name} <span className="font-mono text-xs font-normal text-muted-foreground">{g.reference}</span></span>
                        <span className="block text-sm text-muted-foreground">{g.rooms} room{g.rooms === 1 ? "" : "s"} · {g.guests} guest{g.guests === 1 ? "" : "s"} · {formatBusinessDate(g.arrival)} → {formatBusinessDate(g.departure)} · pays: {g.payer}</span>
                      </span>
                      <span className={cn("text-sm tabular-nums", g.outstanding > 0 ? "font-medium text-destructive" : "text-muted-foreground")}>{g.outstanding > 0 ? `Owes ${formatTZS(g.outstanding)}` : "Nothing owed"}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}
          {res.reservations.length > 0 && (
            <section aria-labelledby="res-title" className="space-y-2">
              <h2 id="res-title" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Reservations</h2>
              <ul className="space-y-2">
                {res.reservations.map((r) => {
                  const arrivingNow = (r.status === "RESERVED" || r.status === "CONFIRMED") && r.arrivalDate <= todayDb && r.departureDate > todayDb;
                  const leavingToday = r.status === "CHECKED_IN" && r.departureDate <= todayDb;
                  const meeting = r.kind === "MEETING";
                  return (
                    <li key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4">
                      <Link href={`/staff/reservations/${r.id}`} className="min-w-0 flex-1">
                        <p className="flex flex-wrap items-center gap-2 font-semibold">
                          {meeting && r.companyName ? r.companyName : r.guest.fullName}
                          {r.group && <span className="rounded-full bg-violet-500/12 px-2 py-0.5 text-[11px] font-medium text-violet-800 dark:text-violet-200">Group · {r.group.name}</span>}
                          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium capitalize", STATUS_TONE[r.status])}>{meeting ? MEETING_STATUS_LABEL[r.status].toLowerCase() : r.status === "INQUIRY" ? "not paid · room not held" : r.status.toLowerCase().replace("_", " ")}</span>
                        </p>
                        <p className="text-sm text-muted-foreground">
                          <span className="font-mono text-xs">{r.reference}</span> · {r.guest.phone ?? "no phone"} · {r.source.name}
                        </p>
                        <p className="text-sm">
                          {meeting
                            ? <>{r.rooms.map((x) => `Room ${x.room.number} — ${x.roomType.name}`).join(", ")} · {formatBusinessDate(fromDbDate(r.arrivalDate))} · {r.rooms[0] ? timeRange(r.rooms[0].startAt, r.rooms[0].endAt) : ""}</>
                            : <>{r.rooms.map((x) => `${x.roomType.name} — Room ${x.room.number}`).join(", ")} · {formatBusinessDate(fromDbDate(r.arrivalDate))} → {formatBusinessDate(fromDbDate(r.departureDate))}</>}
                        </p>
                      </Link>
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={cn("text-sm tabular-nums", r.balanceAmount > 0 ? "font-medium text-destructive" : "text-muted-foreground")}>
                          {r.balanceAmount > 0 ? `Balance ${formatTZS(r.balanceAmount)}` : "Paid"}
                        </span>
                        {arrivingNow && !meeting && can(user, "reservations.check_in") && <Link href="/reception/dashboard#arrivals" className={buttonVariants({ size: "sm" })}>Check in</Link>}
                        {r.status === "CHECKED_IN" && !meeting && can(user, "reservations.check_out") && (
                          <Link href={`/staff/check-out?id=${r.id}#workspace`} className={buttonVariants({ size: "sm", variant: leavingToday ? "default" : "outline" })}>Check out</Link>
                        )}
                        <Link href={`/staff/reservations/${r.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}>View</Link>
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          )}

          {res.requests.length > 0 && (
            <section aria-labelledby="req-title" className="space-y-2">
              <h2 id="req-title" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Open booking requests</h2>
              <ul className="space-y-2">
                {res.requests.map((r) => (
                  <li key={r.id}>
                    <Link href={`/staff/booking-requests/${r.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border bg-card p-4 hover:bg-muted">
                      <span>
                        <span className="flex items-center gap-2 font-semibold"><Inbox className="size-4" />{r.fullName}</span>
                        <span className="block text-sm text-muted-foreground">{r.reference} · {r.roomType.name} · {formatBusinessDate(fromDbDate(r.checkInDate))} → {formatBusinessDate(fromDbDate(r.checkOutDate))}</span>
                      </span>
                      <span className={cn("rounded-full px-2.5 py-0.5 text-xs font-medium", BOOKING_REQUEST_STATUS[r.status].className)}>{BOOKING_REQUEST_STATUS[r.status].label}</span>
                    </Link>
                  </li>
                ))}
              </ul>
            </section>
          )}

          {res.guests.length > 0 && (
            <section aria-labelledby="guest-title" className="space-y-2">
              <h2 id="guest-title" className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">Guest profiles</h2>
              <ul className="grid gap-2 sm:grid-cols-2">
                {res.guests.map((g) => (
                  <li key={g.id} className="flex items-center justify-between gap-3 rounded-xl border bg-card p-4">
                    <Link href={`/staff/guests/${g.id}`} className="min-w-0">
                      <p className="flex items-center gap-2 font-semibold">{g._count.reservations > 0 && <UserCheck className="size-4 text-emerald-700" />}{g.fullName}</p>
                      <p className="text-sm text-muted-foreground">{g.phone ?? g.email ?? "—"}</p>
                      <p className="text-xs text-muted-foreground">
                        {g._count.reservations > 0
                          ? `Previous guest · ${g._count.reservations} stay${g._count.reservations === 1 ? "" : "s"}${g.reservations[0] ? ` · last ${formatBusinessDate(fromDbDate(g.reservations[0].departureDate), true)}` : ""}`
                          : "No completed stays yet"}
                      </p>
                    </Link>
                    {can(user, "reservations.create") && (
                      <Link href={`/staff/reservations/new?guest=${g.id}`} className={buttonVariants({ size: "sm", variant: "outline" })}><CalendarPlus /> Book</Link>
                    )}
                  </li>
                ))}
              </ul>
            </section>
          )}
        </>
      )}
    </div>
  );
}
