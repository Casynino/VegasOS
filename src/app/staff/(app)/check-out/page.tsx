import type { Metadata } from "next";
import { billMenu } from "@/server/services/restaurant";
import { discountLimit } from "@/lib/discounts";
import Link from "next/link";
import { ArrowRight, BedDouble, CheckCircle2, Download, Eye, Printer, Search } from "lucide-react";
import { siteOrigin } from "@/server/site-origin";
import { SendDocument } from "@/components/staff/invoices/send-document";
import { reservationMessage } from "@/server/services/guest-message-data";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { accountOptions } from "@/server/services/payment-accounts";
import { businessToday, getSettings } from "@/server/settings";
import { getInHouse, getStay, type InHouseStay } from "@/server/services/stays";
import { recentChargeItems } from "@/server/services/payments";
import { addDays, fromDbDate } from "@/lib/time/business-date";
import { formatBusinessDate, formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { StayWorkspace, type StayWorkspaceData } from "@/components/staff/reception/stay-workspace";
import { EmptyState, PageHeader } from "@/components/staff/page-header";
import { Input } from "@/components/ui/input";
import { buttonVariants } from "@/components/ui/button";

export const metadata: Metadata = { title: "Check out" };

const TZ = "Africa/Dar_es_Salaam";
const hhmm = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(d);

function matches(r: InHouseStay, q: string) {
  if (!q) return true;
  const s = q.toLowerCase();
  const digits = q.replace(/\D/g, "");
  return r.guest.fullName.toLowerCase().includes(s) || r.reference.toLowerCase().includes(s)
    || (digits.length >= 4 && (r.guest.phone ?? "").includes(digits.slice(-9)))
    || r.rooms.some((x) => x.room.number === q.trim());
}

/**
 * The check-out desk: every occupied room (overdue first, then leaving today,
 * then staying on) — pick one to open that guest's stay: account, extend,
 * payments and the one-button checkout.
 */
export default async function CheckOutPage({ searchParams }: PageProps<"/staff/check-out">) {
  const user = await requirePagePermission("reservations.check_out");
  const sp = await searchParams;
  const q = typeof sp.q === "string" ? sp.q.trim() : "";
  const now = new Date();
  const today = await businessToday(now);
  const all = (await getInHouse(today, now)).filter((r) => matches(r, q));

  const overdue = all.filter((r) => r.state === "OVERDUE");
  const dueToday = all.filter((r) => r.state === "DUE_TODAY");
  const staying = all.filter((r) => r.state === "IN_HOUSE");
  const groups = [
    { title: "Checkout overdue", tone: "text-rose-600 dark:text-rose-400", rows: overdue },
    { title: "Leaving today", tone: "text-amber-700 dark:text-amber-400", rows: dueToday },
    ...Array.from(new Set(staying.map((r) => r.checkoutDate))).map((d) => ({
      title: `Leaving ${d === addDays(today, 1) ? "tomorrow" : formatBusinessDate(d)}`, tone: "text-muted-foreground", rows: staying.filter((r) => r.checkoutDate === d),
    })),
  ].filter((g) => g.rows.length);

  const doneId = typeof sp.done === "string" ? sp.done : null;
  const done = doneId ? await db.reservation.findUnique({
    where: { id: doneId },
    select: {
      id: true, reference: true, balanceAmount: true, guest: { select: { fullName: true, phone: true, email: true } },
      rooms: { where: { status: "CHECKED_OUT" }, select: { room: { select: { number: true } } } },
      thankYouNotes: { orderBy: { version: "desc" }, take: 1, select: { token: true, version: true } },
    },
  }) : null;
  const note = done?.thankYouNotes[0] ?? null;
  const settings = await getSettings();
  const noteLink = note ? `${await siteOrigin()}/thanks/${note.token}` : null;
  // The departure summary sent to the guest: the stay, the final bill from the folio, the payment and the note's link.
  const checkoutMsg = done && note ? await reservationMessage(done.id, "CHECKOUT", await siteOrigin(), { thanksUrl: noteLink }) : null;
  const wanted = doneId ? undefined : typeof sp.id === "string" ? sp.id : (overdue[0] ?? dueToday[0] ?? all[0])?.id;
  const [stay, methods, recent, menu] = await Promise.all([
    wanted ? getStay(wanted, today, now) : null,
    accountOptions("payments"),
    recentChargeItems(),
    // The menu, so food & drinks can be picked straight onto the guest's bill.
    wanted && can(user, "restaurant.orders") && can(user, "payments.record") ? billMenu() : null,
  ]);
  const href = (id: string) => `/staff/check-out?${new URLSearchParams({ ...(q && { q }), id })}#workspace`;

  const data: StayWorkspaceData | null = stay && stay.live.length && stay.state && stay.checkoutAt ? {
    id: stay.id, reference: stay.reference, guest: stay.guest.fullName, phone: stay.guest.phone, company: stay.corporateCustomer?.companyName ?? null,
    source: stay.source.name, state: stay.state, checkoutAt: stay.checkoutAt.toISOString(), today,
    rooms: stay.live.map((r) => ({
      id: r.id, number: r.room.number, type: r.roomType.name, checkedInAt: r.checkedInAt?.toISOString() ?? null, checkedInBy: r.checkedInBy?.fullName ?? null,
      endAt: r.endAt.toISOString(), arrival: fromDbDate(r.arrivalDate), departure: fromDbDate(r.departureDate), nights: r.nights, gross: r.grossAmount, net: r.netAmount, ratePerNight: r.ratePerNight, discountPerNight: r.discountPerNight,
    })),
    folio: stay.folio, gross: stay.grossAmount, discount: stay.discountAmount, total: stay.netAmount, paid: stay.paidAmount, balance: stay.balanceAmount,
    payments: stay.payments.map((p) => ({ id: p.id, amount: p.amount, refund: p.kind === "REFUND", method: p.method.name, at: p.receivedAt.toISOString(), by: p.recordedBy.fullName, reference: p.reference })),
    tab: stay.tab,
    leaveOwing: stay.leaveOwingAt && stay.leaveOwingUpTo != null
      ? { upTo: stay.leaveOwingUpTo, reason: stay.leaveOwingReason ?? "", by: (await db.user.findUnique({ where: { id: stay.leaveOwingById ?? "" }, select: { fullName: true } }))?.fullName ?? "A manager" }
      : null,
  } : null;

  return (
    <div className="w-full space-y-5">
      <PageHeader eyebrow="Front desk" title="Check out" description="Pick the room. See the account, extend the stay, receive payment and check the guest out — all in one place." />

      <div className="grid items-start gap-5 lg:grid-cols-[20rem_minmax(0,1fr)] 2xl:grid-cols-[23rem_minmax(0,1fr)]">
        <aside className="overflow-hidden rounded-3xl border border-border/70 bg-card lg:sticky lg:top-24">
          <form role="search" className="border-b border-border/70 p-3">
            <label className="relative block">
              <span className="sr-only">Find a guest in the hotel</span>
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input name="q" defaultValue={q} placeholder="Room, name, phone or reference" className="h-10 rounded-xl pl-9" />
            </label>
          </form>
          <div className="max-h-[70vh] overflow-y-auto p-2 lg:max-h-[calc(100svh-15rem)]">
            {groups.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-foreground">{q ? `No guest in the hotel matches “${q}”.` : "No guests in the hotel right now."}</p>
            ) : groups.map((g) => (
              <div key={g.title} className="mb-2">
                <p className={cn("px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-[0.14em]", g.tone)}>{g.title} · {g.rows.length}</p>
                <ul>
                  {g.rows.map((r) => {
                    const active = r.id === stay?.id;
                    return (
                      <li key={r.id}>
                        <Link href={href(r.id)} scroll={false} aria-current={active ? "true" : undefined}
                          className={cn("flex items-center gap-3 rounded-2xl px-3 py-2.5 transition-colors", active ? "bg-[oklch(0.95_0.045_85)] dark:bg-[oklch(0.72_0.12_80/0.16)]" : "hover:bg-muted")}>
                          <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl text-sm font-bold tabular-nums",
                            r.state === "OVERDUE" ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : r.state === "DUE_TODAY" ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : "bg-muted text-foreground")}>
                            {r.rooms.map((x) => x.room.number).join("·")}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-sm font-semibold text-foreground">{r.guest.fullName}</span>
                            <span className="block truncate text-xs text-muted-foreground">{r.rooms[0].roomType.name} · {r.state === "OVERDUE" ? `was due ${hhmm(r.checkoutAt)}` : `out ${r.state === "DUE_TODAY" ? "today" : formatBusinessDate(r.checkoutDate)} ${hhmm(r.checkoutAt)}`}</span>
                          </span>
                          <span className="shrink-0 text-right leading-tight">
                            <span className={cn("block text-[11px] font-semibold tabular-nums", r.balanceAmount > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
                              {r.balanceAmount > 0 ? formatTZS(r.balanceAmount).replace("TZS ", "") : "Paid"}
                            </span>
                            {/* Past checkout: those nights go on the bill at check-out too. */}
                            {r.state === "OVERDUE" && r.checkoutDate < today && (
                              <span className="block text-[10px] font-semibold text-rose-600/80 dark:text-rose-300/80">+{Math.round((Date.parse(today) - Date.parse(r.checkoutDate)) / 86_400_000)} night{Math.round((Date.parse(today) - Date.parse(r.checkoutDate)) / 86_400_000) === 1 ? "" : "s"}</span>
                            )}
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

        {done ? (
          <article className="overflow-hidden rounded-3xl border border-border/70 bg-card">
            <div className="relative overflow-hidden bg-[#15110c] px-6 py-10 text-center text-white sm:py-12">
              <div className="pointer-events-none absolute -right-20 -top-28 size-72 rounded-full bg-[#c9a24a]/25 blur-3xl" />
              <span className="relative mx-auto grid size-14 place-items-center rounded-full bg-[#f0cf86] text-[#15110c] shadow-[0_12px_28px_-10px_#c9a24a] motion-safe:animate-in motion-safe:zoom-in-50 motion-safe:duration-500"><CheckCircle2 className="size-7" /></span>
              <p className="relative mt-4 text-[11px] font-semibold uppercase tracking-[0.35em] text-[#f0cf86]">Check-out complete</p>
              <h2 className="relative mt-2 font-display text-3xl font-semibold">Thank you for staying with {settings.hotelName}.</h2>
              <p className="relative mt-2 text-sm text-white/70">
                {done.guest.fullName} · room {done.rooms.map((r) => r.room.number).join(", ")} is now waiting for cleaning.
                {done.balanceAmount > 0 && ` The unpaid ${formatTZS(done.balanceAmount)} is on the follow-up list.`}
              </p>
            </div>
            <div className="space-y-4 p-5 sm:p-6">
              {note ? (
                <>
                  <p className="text-center text-sm text-muted-foreground">The guest&apos;s thank-you note is ready — print it, save it as PDF or send it to them.</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <Link href={`/staff/reservations/${done.id}/thank-you`} className={buttonVariants()}><Eye />View thank-you note</Link>
                    <Link href={`/staff/reservations/${done.id}/thank-you?print=1`} className={buttonVariants({ variant: "outline" })}><Printer />Print</Link>
                    <Link href={`/staff/reservations/${done.id}/thank-you?print=1`} className={buttonVariants({ variant: "outline" })} title="Choose “Save as PDF” in the print window"><Download />Download PDF</Link>
                    <SendDocument
                      entity={{ type: "Reservation", id: done.id }} what={`thank-you note (v${note.version})`} label="Send to guest"
                      to={{ name: done.guest.fullName, phone: done.guest.phone, email: done.guest.email }}
                      subject={`Thank you for staying at ${settings.hotelName}`}
                      text={checkoutMsg?.text ?? ""}
                    />
                  </div>
                </>
              ) : (
                <p className="text-center text-sm text-muted-foreground">
                  <Link href={`/staff/reservations/${done.id}/thank-you`} className="font-medium text-foreground underline underline-offset-2">Open the thank-you note</Link>
                </p>
              )}
              <div className="flex flex-wrap justify-center gap-2 border-t border-dashed border-border pt-4">
                {all[0] && <Link href={href((overdue[0] ?? dueToday[0] ?? all[0]).id)} className={buttonVariants({ variant: "outline" })}>Next guest <ArrowRight /></Link>}
                <Link href="/staff/check-out" className={buttonVariants({ variant: "ghost" })}>Done</Link>
              </div>
            </div>
          </article>
        ) : data ? (
          <StayWorkspace key={`${data.id}-${data.total}-${data.paid}-${data.checkoutAt}`} s={data} methods={methods} recent={recent} menu={menu} menuPayNow={can(user, "revenue.record")}
            perms={{ pay: can(user, "payments.record"), extend: can(user, "reservations.edit"), override: can(user, "reservations.checkout_override"), discount: discountLimit(user.permissions, await getSettings()) > 0, discountMax: discountLimit(user.permissions, await getSettings()), void: can(user, "payments.reverse"),
              // Putting a guest's open restaurant order on the room is reception's work (managers watch).
              order: can(user, "restaurant.orders") && !(can(user, "dashboard.manager") || can(user, "dashboard.owner") || can(user, "dashboard.admin")) }} />
        ) : (
          <EmptyState icon={<BedDouble />} title={wanted ? "This guest is no longer in the hotel" : "No guests in the hotel"}
            description={wanted ? "They may already be checked out. Pick another room from the list." : "Checked-in guests appear here, soonest checkout first."} />
        )}
      </div>
    </div>
  );
}
