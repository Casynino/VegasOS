import type { Metadata } from "next";
import { discountLimit } from "@/lib/discounts";
import Link from "next/link";
import { Building2, DoorOpen, LogIn, Plane, Search } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { accountOptions } from "@/server/services/payment-accounts";
import { db } from "@/server/db";
import { billToLabel, termsLabel } from "@/lib/billing";
import { businessToday, getSettings } from "@/server/settings";
import { getCheckInBooking, getCheckInList, type CheckInArrival } from "@/server/services/front-desk";
import { addDays } from "@/lib/time/business-date";
import { formatBusinessDate, formatMinutesLabel, formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ArrivalCard, type ArrivalCardData } from "@/components/staff/reception/arrival-card";
import { Initials } from "@/components/dashboard/kit";
import { EmptyState, PageHeader } from "@/components/staff/page-header";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PaymentPanel } from "../reservations/[id]/panels";

export const metadata: Metadata = { title: "Check in" };

/** Does this booking match the search (name, phone, reference, ID or room number)? */
function matches(r: CheckInArrival, q: string) {
  if (!q) return true;
  const s = q.toLowerCase();
  const digits = q.replace(/\D/g, "");
  return [r.guest.fullName, r.reference, r.externalReference ?? "", r.guest.idNumber ?? "", r.guest.email ?? ""].some((v) => v.toLowerCase().includes(s))
    || (digits.length >= 4 && (r.guest.phone ?? "").includes(digits.slice(-9)))
    || r.rooms.some((x) => x.current.number === q.trim());
}

function toCard(r: CheckInArrival): ArrivalCardData {
  return {
    id: r.id, reference: r.reference, status: r.status, source: r.source.name, eta: r.eta,
    guest: { fullName: r.guest.fullName, phone: r.guest.phone, email: r.guest.email, idType: r.guest.idType, idNumber: r.guest.idNumber, nationality: r.guest.nationality, stays: r.guest._count.reservations },
    rooms: r.rooms, netAmount: r.netAmount, paidAmount: r.paidAmount, balanceAmount: r.balanceAmount,
    pickup: r.trips[0] ? `Airport pickup${r.trips[0].flightNumber ? ` · flight ${r.trips[0].flightNumber}` : ""}` : null,
    specialRequests: r.specialRequests, internalNotes: r.internalNotes,
  };
}

const firstArrival = (r: CheckInArrival) => r.rooms.reduce((m, x) => (x.arrival < m ? x.arrival : m), r.rooms[0]?.arrival ?? "");

/**
 * The check-in desk. Left: every guest with a booking (late, today, next 14
 * days) — pick anyone. Right: the chosen booking's workspace — dates, room,
 * details, payment and CHECK IN.
 */
export default async function CheckInPage({ searchParams }: PageProps<"/staff/check-in">) {
  const user = await requirePagePermission("reservations.check_in");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const today = await businessToday();
  const list = await getCheckInList(today);
  const due = list.due.filter((r) => matches(r, q));
  const upcoming = list.upcoming.filter((r) => matches(r, q));
  const late = due.filter((r) => firstArrival(r) < today);
  const todays = due.filter((r) => firstArrival(r) >= today);

  const wanted = typeof sp.id === "string" ? sp.id : (due[0] ?? upcoming[0])?.id;
  const [booking, methods, settings] = await Promise.all([
    wanted ? (list.due.find((r) => r.id === wanted) ?? getCheckInBooking(wanted, today)) : null,
    accountOptions("payments"),
    getSettings(),
  ]);

  // Company-invoice booking: say so plainly — checking in is not a payment.
  const corp = booking ? await db.reservation.findUnique({
    where: { id: booking.id },
    select: {
      billTo: true, paymentTermDays: true, companyBilledAmount: true, balanceAmount: true, netAmount: true, paidAmount: true,
      corporateCustomer: { select: { id: true, companyName: true, paymentTermDays: true, status: true } },
      invoiceItems: { where: { invoice: { reservationId: null } }, select: { invoice: { select: { id: true, number: true, status: true } } } },
    },
  }) : null;
  const companyNote = corp?.corporateCustomer && corp.billTo !== "GUEST" ? (() => {
    const c = corp.corporateCustomer!;
    const invoices = [...new Map(corp.invoiceItems.map((i) => [i.invoice.id, i.invoice])).values()];
    return (
      <div className="mb-3 space-y-2 rounded-2xl border border-[oklch(0.75_0.13_80)]/50 bg-[oklch(0.75_0.13_80)]/[0.08] p-3.5 text-sm">
        <p className="flex items-center gap-2 font-semibold"><Building2 className="size-4" />Company invoice — {c.companyName}</p>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-1 text-xs">
          <dt className="text-muted-foreground">Who pays</dt><dd>{billToLabel(corp.billTo)}</dd>
          <dt className="text-muted-foreground">Payment terms</dt><dd>{termsLabel(corp.paymentTermDays ?? c.paymentTermDays)}</dd>
          <dt className="text-muted-foreground">Invoice</dt><dd>{invoices.length ? invoices.map((i) => <Link key={i.id} href={`/staff/invoices/${i.id}`} className="mr-2 font-mono hover:underline">{i.number} · {i.status.replace("_", " ").toLowerCase()}</Link>) : "Made at checkout from the final bill"}</dd>
          <dt className="text-muted-foreground">Payment status</dt><dd className="font-semibold text-rose-600 dark:text-rose-400">{corp.paidAmount > 0 ? "Partly paid" : "Unpaid"} — checking in records no payment</dd>
          <dt className="text-muted-foreground">Bill so far</dt><dd className="tabular-nums">{formatTZS(corp.netAmount)}{corp.companyBilledAmount ? ` · on invoice ${formatTZS(corp.companyBilledAmount)}` : ""}</dd>
        </dl>
        {c.status !== "ACTIVE" && <p className="rounded-lg bg-rose-500/10 px-2.5 py-1.5 text-xs font-medium text-rose-700 dark:text-rose-300">{c.companyName} is {c.status === "ON_HOLD" ? "suspended" : "inactive"} — check with a manager before extending credit.</p>}
      </div>
    );
  })() : null;

  const href = (id: string) => `/staff/check-in?${new URLSearchParams({ ...(q && { q }), id })}#workspace`;
  const groups: { title: string; tone: string; rows: CheckInArrival[] }[] = [
    { title: "Late — still to arrive", tone: "text-amber-700 dark:text-amber-400", rows: late },
    { title: "Arriving today", tone: "text-emerald-700 dark:text-emerald-400", rows: todays },
    ...Array.from(new Set(upcoming.map(firstArrival))).map((d) => ({
      title: d === addDays(today, 1) ? `Tomorrow · ${formatBusinessDate(d)}` : formatBusinessDate(d),
      tone: "text-muted-foreground", rows: upcoming.filter((r) => firstArrival(r) === d),
    })),
  ].filter((g) => g.rows.length);

  return (
    <div className="w-full space-y-5">
      <PageHeader eyebrow="Front desk" title="Check in"
        description="Pick a guest with a booking, confirm the dates, room and details, then check in."
        actions={<Link href="/staff/reservations/new?mode=walkin" className={buttonVariants({ variant: "outline" })}><DoorOpen />Walk-in (no booking)</Link>} />

      <div className="grid items-start gap-5 lg:grid-cols-[20rem_minmax(0,1fr)] 2xl:grid-cols-[23rem_minmax(0,1fr)]">
        {/* Guest list */}
        <aside className="overflow-hidden rounded-3xl border border-border/70 bg-card lg:sticky lg:top-24">
          <form role="search" className="border-b border-border/70 p-3">
            <label className="relative block">
              <span className="sr-only">Find a booking</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="q" defaultValue={q} placeholder="Name, phone, reference, ID, room" className="h-10 rounded-xl pl-9" />
            </label>
          </form>
          <div className="max-h-[70vh] overflow-y-auto p-2 lg:max-h-[calc(100svh-15rem)]">
            {groups.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">{q ? `No booking matches “${q}”.` : "No bookings waiting in the next 14 days."}</p>
            ) : groups.map((g) => (
              <div key={g.title} className="mb-2">
                <p className={cn("px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em]", g.tone)}>{g.title} · {g.rows.length}</p>
                <ul>
                  {g.rows.map((r) => {
                    const active = r.id === booking?.id;
                    return (
                      <li key={r.id}>
                        <Link href={href(r.id)} scroll={false} aria-current={active ? "true" : undefined}
                          className={cn("flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors", active ? "bg-[oklch(0.95_0.045_85)] dark:bg-[oklch(0.72_0.12_80/0.16)]" : "hover:bg-muted")}>
                          <Initials name={r.guest.fullName} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-foreground">{r.guest.fullName}</span>
                            <span className="block truncate text-xs text-muted-foreground">{r.rooms.map((x) => `${x.roomTypeName} · ${x.current.number}`).join(", ")}</span>
                          </span>
                          <span className="shrink-0 text-right text-[11px] leading-tight">
                            {r.eta && <span className="block text-muted-foreground">{r.eta}</span>}
                            {r.trips.length > 0 && <Plane className="ml-auto size-3 text-sky-500" aria-label="Airport pickup" />}
                            <span className={cn("block font-semibold tabular-nums", r.balanceAmount > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
                              {r.balanceAmount > 0 ? formatTZS(r.balanceAmount).replace("TZS ", "") : "Paid"}
                            </span>
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </div>
        </aside>

        {/* Workspace */}
        {booking ? (
          <ArrivalCard key={`${booking.id}-${booking.netAmount}-${booking.paidAmount}`} a={toCard(booking)} today={today}
            canAssign={can(user, "reservations.edit")} canOverride={can(user, "reservations.checkin_override")} canEditDates={can(user, "reservations.edit")} canDiscount={discountLimit(user.permissions, await getSettings()) > 0} discountMax={discountLimit(user.permissions, await getSettings())} checkoutTime={formatMinutesLabel(settings.checkoutMinutes)}
            methods={can(user, "payments.record") ? methods : []}
            payment={<>{companyNote}{can(user, "payments.record") && <PaymentPanel reservationId={booking.id} balance={booking.balanceAmount} paid={booking.paidAmount} canRefund={false} methods={methods} phone={booking.guest.phone} who={booking.guest.fullName} />}</>} />
        ) : (
          <EmptyState icon={<LogIn />} title={wanted ? "This booking is no longer waiting to check in" : "Nobody to check in"}
            description={wanted ? "It may already be checked in, cancelled, or more than a year away. Pick another guest from the list." : "When guests book, they appear in the list on the left. Guests without a booking come in as a walk-in."}
            action={<Link href="/staff/reservations/new?mode=walkin" className={buttonVariants()}>Walk-in guest</Link>} />
        )}
      </div>
    </div>
  );
}
