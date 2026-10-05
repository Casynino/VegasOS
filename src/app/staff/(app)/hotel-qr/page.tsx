import type { Metadata } from "next";
import Link from "next/link";
import { Archive, CalendarCheck, Clock, History, LogIn, QrCode, Smartphone } from "lucide-react";
import { can, requestMeta, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { getSettings, stayConfig } from "@/server/settings";
import { bookingQrAnalytics, bookingQrCodes, hotelQrHistory, qrBookings, type QrBookingRow, type QrBookingsFilter } from "@/server/services/booking-qr";
import { hotelQrSetup } from "@/server/services/hotel-qr";
import { accountOptions } from "@/server/services/payment-accounts";
import { friendlyAction } from "@/lib/activity-words";
import { businessDateOf, businessRangeBounds } from "@/lib/time/business-date";
import { formatDateTime, formatTZS } from "@/lib/format";
import { Panel, StatTile } from "@/components/dashboard/kit";
import { PageHeader } from "@/components/staff/page-header";
import { PeriodPicker, periodLabel, readPeriod } from "@/components/staff/finance/finance-nav";
import { cn } from "@/lib/utils";
import { QrCodes, ShowToGuestButton, type QrCodeView } from "./qr-codes";
import { QrSwitches } from "./qr-switches";
import { QrBookings, QR_LISTS, type QrList } from "./qr-bookings";
import { QrNumbers } from "./qr-numbers";

export const metadata: Metadata = { title: "Hotel QR" };
export const dynamic = "force-dynamic";

const LIST_TAKE = 100;
/** The list's quick filters, as the service's filter ("paid online" is the paid ones the guest paid online). */
const LIST_FILTER: Record<QrList, (today: string) => QrBookingsFilter> = {
  all: () => ({ view: "all" }),
  today: (today) => ({ view: "all", from: today, to: today }),
  arriving: () => ({ view: "arriving" }),
  upcoming: () => ({ view: "upcoming" }),
  waiting: () => ({ view: "waiting" }),
  online: () => ({ view: "paid" }),
  cancelled: () => ({ view: "cancelled" }),
};
const paidOnline = (r: QrBookingRow) => (r.paymentStatus === "PAID" || r.paymentStatus === "PARTIALLY_PAID") && (r.payWay === "ONLINE" || !!r.ntzsReference);

const field = (j: unknown, k: string) => (j && typeof j === "object" && k in j ? (j as Record<string, unknown>)[k] : undefined);
function historyDetail(h: { action: string; before: unknown; after: unknown }) {
  if (h.action === "hotel_qr.settings") {
    const on = (v: unknown) => (v ? "on" : "off");
    return `Booking ${on(field(h.after, "bookingOn"))} · Pay at hotel ${on(field(h.after, "payAtHotel"))}`;
  }
  const before = field(h.before, "label"), after = field(h.after, "label");
  if (h.action === "hotel_qr.renamed" && before !== after) return `${String(before)} → ${String(after)}`;
  return typeof after === "string" ? after : typeof before === "string" ? before : "";
}

/**
 * HOTEL QR — "Scan to book your stay". Reception, managers and the Admin: the branded card (show it to a guest, print
 * it, download it, open the booking page), today's numbers and every booking made from it, with where the money stands
 * (PAID ONLINE with NTZS's reference). The Admin (hotel_qr.manage) also makes, renames, renews, switches off and
 * archives the codes and sets the two switches; managers see how the QR is doing over a period and what was changed.
 */
export default async function HotelQrPage({ searchParams }: PageProps<"/staff/hotel-qr">) {
  const user = await requirePagePermission("reservations.view", "hotel_qr.manage", "reports.view");
  const sp = await searchParams;
  const { ipAddress } = await requestMeta();
  const actor = { userId: user.id, label: user.fullName, ipAddress, permissions: user.permissions };
  const s = await getSettings();
  const now = new Date();
  const today = businessDateOf(now, stayConfig(s));
  const { start: dayStart, end: dayEnd } = businessRangeBounds(today, today, stayConfig(s));

  const list: QrList = QR_LISTS.find((l) => l.key === sp.list)?.key ?? "all";
  const q = typeof sp.q === "string" ? sp.q.trim().slice(0, 60) : "";
  const period = readPeriod(sp, today, "month");

  const setup = await hotelQrSetup(actor);
  const canHistory = setup.canManage || can(user, "staff.activity.view");
  const canPay = can(user, "payments.record");
  const [codes, archived, rows, madeToday, arriving, waiting, scansToday, numbers, history, methods] = await Promise.all([
    bookingQrCodes(actor),
    setup.canManage ? bookingQrCodes(actor, { archived: true }) : Promise.resolve([]),
    qrBookings(actor, { ...LIST_FILTER[list](today), q: q || null, take: list === "online" ? 300 : LIST_TAKE }),
    qrBookings(actor, { from: today, to: today, take: 300 }),
    qrBookings(actor, { view: "arriving", take: 300 }),
    qrBookings(actor, { view: "waiting", take: 300 }),
    db.bookingQrEvent.count({ where: { type: "SCAN", createdAt: { gte: dayStart, lt: dayEnd } } }),
    setup.canSeeNumbers ? bookingQrAnalytics(actor, { from: period.from, to: period.to }) : Promise.resolve(null),
    canHistory ? hotelQrHistory(actor, 12) : Promise.resolve([]),
    canPay ? accountOptions("payments") : Promise.resolve([]),
  ]);
  const shown = list === "online" ? rows.filter(paidOnline).slice(0, LIST_TAKE) : rows;
  const onlineToday = madeToday.filter(paidOnline);
  // Booked to pay later: not paid, no room held — whoever pays first gets it.
  const notHeld = waiting.filter((r) => !r.roomHeld).length;

  const views: QrCodeView[] = codes.map((c) => ({
    id: c.id, label: c.label, placement: c.placement, url: c.url, qr: c.qr, active: c.active, scans: c.scans,
    lastScan: c.lastScannedAt?.toISOString() ?? null, bookings: c.bookings, madeBy: c.madeBy,
    regeneratedAt: c.regeneratedAt?.toISOString() ?? null, createdAt: c.createdAt.toISOString(),
  }));
  const primary = views.find((c) => c.active) ?? null;
  const labels = new Map([...codes, ...archived].map((c) => [c.id, c.label]));
  // The list keeps the period (and the period keeps the list) when either changes.
  const periodKeep: Record<string, string> = period.key === "custom" ? { from: period.from, to: period.to } : { period: period.key };
  const listKeep: Record<string, string> = { ...(list !== "all" && { list }), ...(q && { q }) };

  const status = [
    { label: "Booking", on: setup.bookingOn },
    { label: "Pay online", on: setup.payOnline },
    { label: "Pay at hotel", on: setup.payAtHotel },
  ];

  return (
    <div className="w-full space-y-6">
      {/* A work page: a slim title with the switches' state, and the gold "Show to guest" at hand. */}
      <PageHeader eyebrow={`Hotel QR · ${user.roleName}`} title="Scan to book your stay"
        description={<>
          Guests scan the card, see our rooms, book and pay — each booking lands here and in Reservations, ready for check-in.
          <span className="mt-2.5 flex flex-wrap gap-1.5">
            {status.map((x) => (
              <span key={x.label} className="inline-flex items-center gap-1.5 rounded-full border border-border/70 bg-card px-2.5 py-1 text-xs text-muted-foreground">
                <span className={cn("size-1.5 rounded-full", x.on ? "bg-emerald-500" : "bg-muted-foreground/50")} /><strong className="font-semibold text-foreground">{x.label}</strong>{x.on ? "on" : "off"}
              </span>
            ))}
          </span>
        </>}
        actions={primary ? <ShowToGuestButton code={primary} hotel={s.hotelName} /> : undefined} />

      {/* Today — for everyone who follows the bookings (money of the day only; periods are for managers). Five tiles
          that fill their rows: 2 + 2 + 1 wide on phones, 3 + 2 on tablets, one row on wide screens (labels are never cut). */}
      <section aria-label="Today" className="-mt-2 grid grid-cols-2 gap-3 sm:grid-cols-6 2xl:grid-cols-5">
        <div className="sm:col-span-2 2xl:col-span-1"><StatTile label="Scans today" value={String(scansToday)} icon={<QrCode />} tone="violet" sub="Booking page opened" /></div>
        <div className="sm:col-span-2 2xl:col-span-1"><StatTile label="New bookings" value={String(madeToday.length)} icon={<CalendarCheck />} tone="gold" sub={madeToday.length ? formatTZS(madeToday.reduce((t, r) => t + r.amount, 0)) : "None yet today"} href="?list=today#bookings" /></div>
        <div className="sm:col-span-2 2xl:col-span-1"><StatTile label="Arriving today" value={String(arriving.length)} icon={<LogIn />} tone="sky" sub="Booked from the QR" href="?list=arriving#bookings" /></div>
        <div className="sm:col-span-3 2xl:col-span-1"><StatTile label="Waiting to pay" value={String(waiting.length)} icon={<Clock />} tone="amber" sub={notHeld ? `${notHeld} not paid · room not held` : "Held while the guest pays"} href="?list=waiting#bookings" /></div>
        <div className="col-span-2 sm:col-span-3 2xl:col-span-1"><StatTile label="Paid online today" value={String(onlineToday.length)} icon={<Smartphone />} tone="emerald" sub={onlineToday.length ? formatTZS(onlineToday.reduce((t, r) => t + r.paid, 0)) : "Secure payment by NTZS"} href="?list=online#bookings" /></div>
      </section>

      <div className={cn("grid items-start gap-6", (setup.canManage || setup.canSeeNumbers) && "2xl:grid-cols-[minmax(0,1fr)_26rem]")}>
        <QrCodes codes={views} hotel={s.hotelName} phone={s.phone} canManage={setup.canManage} bookingOn={setup.bookingOn} />
        {(setup.canManage || setup.canSeeNumbers) && (
          <Panel title="Switches" subtitle={setup.canManage ? "Saved as soon as you flip them" : "Set by the Admin"}>
            <QrSwitches canManage={setup.canManage} canOpenFinance={can(user, "finance.view")}
              setup={{ bookingOn: setup.bookingOn, payAtHotel: setup.payAtHotel, payOnline: setup.payOnline, onlinePaySwitchedOn: setup.onlinePaySwitchedOn, ntzsConnected: setup.ntzsConnected, onlineHoldMinutes: setup.onlineHoldMinutes }} />
          </Panel>
        )}
      </div>

      {numbers && (
        <Panel title="How the QR is doing" subtitle={`${periodLabel(period)} · from scan to payment`}
          action={<PeriodPicker current={period.key} from={period.from} to={period.to} keep={listKeep} />}>
          <QrNumbers a={numbers} />
        </Panel>
      )}

      <QrBookings rows={shown} list={list} q={q} newSince={dayStart} keep={periodKeep} take={LIST_TAKE} today={today}
        methods={canPay ? methods : null} canCheckIn={can(user, "reservations.check_in")} />

      {(history.length > 0 || archived.length > 0) && (
        <div className="grid items-start gap-4 lg:grid-cols-2">
          {history.length > 0 && (
            <Panel title="What was changed" subtitle="The latest changes to the codes and switches"
              action={can(user, "staff.activity.view") ? <Link href="/staff/activity?area=hotel_qr" className="shrink-0 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground transition-colors hover:bg-muted">All activity</Link> : undefined}>
              <ul className="space-y-1">
                {history.map((h) => {
                  const detail = historyDetail(h);
                  const place = h.qrId && h.action !== "hotel_qr.settings" ? labels.get(h.qrId) : null;
                  return (
                    <li key={h.id} className="flex items-start gap-2.5 rounded-xl px-2 py-1.5 text-xs">
                      <span className="mt-0.5 grid size-6 shrink-0 place-items-center rounded-lg bg-muted text-muted-foreground"><History className="size-3" /></span>
                      <span className="min-w-0 flex-1">
                        <span className="block"><strong className="font-semibold">{h.by.replace(/\s*\(.*\)/, "")}</strong> <span className="text-muted-foreground">{friendlyAction(h.action)}</span></span>
                        {(detail || place) && <span className="block truncate text-[11px] text-muted-foreground">{detail || place}</span>}
                      </span>
                      <span className="shrink-0 tabular-nums text-[11px] text-muted-foreground">{formatDateTime(h.at)}</span>
                    </li>
                  );
                })}
              </ul>
            </Panel>
          )}
          {archived.length > 0 && (
            <Panel title="Archived codes" subtitle="They no longer work; their bookings and numbers stay">
              <ul className="divide-y divide-border/60 text-sm">
                {archived.map((c) => (
                  <li key={c.id} className="flex items-center gap-2.5 py-2">
                    <Archive className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-medium">{c.label}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{c.scans} scans · {c.bookings} booking{c.bookings === 1 ? "" : "s"}{c.revokedAt ? ` · off ${formatDateTime(c.revokedAt)}` : ""}</span>
                  </li>
                ))}
              </ul>
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}
