import type { Metadata } from "next";
import Link from "next/link";
import { Ban, CalendarPlus, Clock, Hourglass, Presentation, Tag, Timer, Users, Wallet } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { change, meetingRoomStats } from "@/server/services/reporting";
import { businessToday } from "@/server/settings";
import { addDays, eachDate, toDbDate } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { MEETING_ROOM_STATUS_LABEL, MEETING_STATUS_LABEL, timeRange } from "@/lib/meeting";
import { ROOM_STATUS_META } from "@/lib/room-status";
import { RESERVATION_STATUS_META } from "@/lib/reservation-status";
import { EmptyState } from "@/components/staff/page-header";
import { MoneyCard } from "@/components/dashboard/money-card";
import { buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { MeetingButtons } from "../reservations/[id]/panels";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getT();
  return { title: t("Meeting room") };
}

const BOX = "rounded-3xl border border-border/70 bg-card p-4 sm:p-5";
const hours = (b: { startAt: Date; endAt: Date }) => Math.max(0, (b.endAt.getTime() - b.startAt.getTime()) / 3_600_000);

/**
 * Meeting room — its bookings are ordinary reservations of a meeting-room type (Room 102). Reception
 * books and runs them (Start / Complete); managers and the MD watch: the month's money and use, what
 * is on now and next, the last 14 days and every meeting with what it paid or owes. Never part of
 * guest-room occupancy.
 */
export default async function MeetingRoomPage() {
  const user = await requirePagePermission("meeting.view", "reservations.view");
  const t = await getT();
  const today = await businessToday();
  const monthStart = `${today.slice(0, 8)}01`;
  const lastMonthStart = `${addDays(monthStart, -1).slice(0, 8)}01`;
  const watching = can(user, "dashboard.manager") || can(user, "dashboard.owner") || can(user, "dashboard.admin");
  const [rooms, bookings, stats, prev, owedNow] = await Promise.all([
    db.room.findMany({ where: { isActive: true, roomType: { category: "MEETING_ROOM" } }, include: { roomType: true }, orderBy: { number: "asc" } }),
    db.reservationRoom.findMany({
      where: { roomType: { category: "MEETING_ROOM" }, OR: [{ arrivalDate: { gte: toDbDate(addDays(today, -31)), lte: toDbDate(addDays(today, 60)) } }, { status: "CHECKED_IN" }] },
      include: { room: true, roomType: true, reservation: { select: { id: true, reference: true, status: true, companyName: true, adults: true, balanceAmount: true, netAmount: true, paidAmount: true, guest: { select: { fullName: true, phone: true } } } } },
      orderBy: { startAt: "asc" },
    }),
    meetingRoomStats({ from: monthStart, to: today }),
    meetingRoomStats({ from: lastMonthStart, to: addDays(monthStart, -1) }),
    db.reservation.aggregate({ where: { kind: "MEETING", balanceAmount: { gt: 0 }, status: { in: ["CHECKED_IN", "CHECKED_OUT"] } }, _sum: { balanceAmount: true }, _count: true }),
  ]);
  const perms = {
    book: !watching && can(user, "reservations.create"),
    start: !watching && (can(user, "reservations.check_in") || can(user, "meeting.manage")),
    complete: !watching && (can(user, "reservations.check_out") || can(user, "meeting.manage")),
    override: can(user, "reservations.checkout_override"),
  };
  const day = (b: (typeof bookings)[number]) => b.arrivalDate.toISOString().slice(0, 10);
  const active = (b: (typeof bookings)[number]) => ["RESERVED", "CONFIRMED", "CHECKED_IN", "INQUIRY"].includes(b.status);
  // Today: meetings on today's date, and one still in use from before.
  const todays = bookings.filter((b) => (day(b) === today && b.status !== "CANCELLED") || (b.status === "CHECKED_IN" && day(b) < today));
  const upcoming = bookings.filter((b) => day(b) > today && active(b));
  const recent = bookings.filter((b) => day(b) < today && day(b) >= addDays(today, -14) && b.status !== "CHECKED_IN").reverse();
  const byDay = [...upcoming.reduce((m, b) => m.set(day(b), [...(m.get(day(b)) ?? []), b]), new Map<string, typeof upcoming>())];
  const month = bookings.filter((b) => day(b) >= monthStart && day(b) <= today && b.status !== "CANCELLED");
  const paidMonth = month.reduce((n, b) => n + Math.min(b.reservation.paidAmount, b.reservation.netAmount), 0);
  const owedMonth = month.reduce((n, b) => n + (b.status === "NO_SHOW" ? 0 : b.reservation.balanceAmount), 0);
  const last14 = eachDate(addDays(today, -13), addDays(today, 1)).map((d) => ({ d, h: bookings.filter((b) => day(b) === d && !["CANCELLED", "NO_SHOW"].includes(b.status)).reduce((n, b) => n + hours(b), 0) }));
  const maxH = Math.max(1, ...last14.map((x) => x.h));
  const now = new Date();
  const monthName = new Date(`${today}T00:00:00Z`).toLocaleDateString(t.intl, { month: "long", timeZone: "UTC" });

  const Row = ({ b, actions }: { b: (typeof bookings)[number]; actions?: boolean }) => {
    const r = b.reservation;
    const meta = RESERVATION_STATUS_META[b.status];
    const owes = r.balanceAmount > 0 && !["CANCELLED", "NO_SHOW"].includes(b.status);
    const [from, to] = timeRange(b.startAt, b.endAt).split("–");
    return (
      <li className="grid grid-cols-[4rem_minmax(0,1fr)_auto] items-center gap-x-3 gap-y-2 py-3 sm:grid-cols-[4.5rem_minmax(0,1fr)_auto_auto]">
        <span className="rounded-xl bg-muted/60 px-2 py-1.5 text-center text-xs font-semibold leading-tight tabular-nums">{from}<span className="block text-[10px] font-normal text-muted-foreground">{t("to {time}", { time: to })}</span></span>
        <div className="min-w-0">
          <Link href={`/staff/reservations/${r.id}`} className="block truncate font-medium hover:underline">{r.companyName ?? r.guest.fullName}</Link>
          <p className="truncate text-xs text-muted-foreground">
            <span className="font-mono">{r.reference}</span> · {t.plural(r.adults, "{n} person", "{n} people")} · {t("{h} h", { h: hours(b).toFixed(1).replace(/\.0$/, "") })}{r.companyName && ` · ${r.guest.fullName}`}
          </p>
        </div>
        <span className="text-right text-sm tabular-nums">
          {formatTZS(r.netAmount)}
          <span className={cn("block text-[11px]", owes ? "font-semibold text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
            {owes ? t("owes {amount}", { amount: formatTZS(r.balanceAmount) }) : b.status === "CANCELLED" ? t("cancelled") : b.status === "NO_SHOW" ? t("no-show") : t("paid")}
          </span>
        </span>
        <div className="col-span-3 flex flex-wrap items-center gap-2 sm:col-span-1 sm:justify-end">
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", meta.className)}>{t(MEETING_STATUS_LABEL[b.status])}</span>
          {actions && (perms.start || perms.complete) && (
            <MeetingButtons reservationId={r.id} status={b.status} balance={r.balanceAmount} size="sm"
              canStart={perms.start} canComplete={perms.complete} canOverrideBalance={perms.override} />
          )}
        </div>
      </li>
    );
  };

  return (
    <div className="w-full space-y-4">
      {/* Slim header */}
      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card">
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[oklch(0.78_0.12_80)]/70 to-transparent" />
        <div className="relative flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-emerald-400 to-teal-600 text-white shadow-[0_10px_24px_-12px_rgb(16_185_129)]"><Presentation className="size-6" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">{t("Meeting room · {role}", { role: t(user.roleName) })}</p>
              <h1 className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">{t("Meeting room")}</h1>
              <p className="text-xs text-muted-foreground">{t("Booked by time · kept apart from guest-room occupancy")}</p>
            </div>
          </div>
          {perms.book && <Link href="/staff/reservations/new?mode=meeting" className={buttonVariants({ size: "sm" })}><CalendarPlus /> {t("New meeting booking")}</Link>}
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.5fr)_minmax(0,1fr)]">
        {/* The month's money and use */}
        <MoneyCard title={t("Meeting room · {month}", { month: monthName })}
          headline={{ value: formatTZS(stats.revenue), label: t.plural(stats.bookings, "Room-hire income this month · {n} booking · bills below include extras", "Room-hire income this month · {n} bookings · bills below include extras"), delta: change(stats.revenue, prev.revenue), deltaLabel: t("vs last month") }}
          split={[
            { label: t("Bills paid"), value: paidMonth, color: "#10b981" },
            { label: t("Bills still owed"), value: owedMonth, color: "#f43f5e" },
          ]}
          cells={[
            { label: t("Hours used"), icon: <Hourglass />, tint: "bg-emerald-500/15 text-emerald-500", value: t("{h} h", { h: stats.bookedHours }), sub: t("of {h} open hours", { h: stats.openHours }) },
            { label: t("Utilisation"), icon: <Timer />, tint: "bg-sky-500/15 text-sky-400", value: `${Math.round(stats.utilisation)}%`, bar: stats.utilisation, sub: t("08:00–20:00 days") },
            { label: t("Average booking"), icon: <Tag />, tint: "bg-violet-500/15 text-violet-400", value: stats.bookings ? formatTZS(Math.round(stats.revenue / stats.bookings)) : t("None yet"), sub: t("income per booking") },
            { label: t("Completed"), icon: <Users />, tint: "bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.8_0.11_82)]", value: t("{done} of {total}", { done: stats.completed, total: stats.bookings }), sub: t("{n} still to come", { n: stats.upcoming }) },
            { label: t("Cancelled · no-shows"), icon: <Ban />, tint: "bg-rose-500/15 text-rose-400", value: `${stats.cancelled} · ${stats.noShows}`, sub: t("this month") },
            { label: t("Owed now"), icon: <Wallet />, tint: "bg-amber-500/15 text-amber-400", value: formatTZS(owedNow._sum.balanceAmount ?? 0), tone: owedNow._count ? "warn" : undefined, sub: t.plural(owedNow._count, "{n} meeting · all dates", "{n} meetings · all dates") },
          ]} />

        {/* Now, next, and the last 14 days */}
        <div className="space-y-4">
          {rooms.map((room) => {
            const mine = bookings.filter((b) => b.roomId === room.id);
            const current = mine.find((b) => b.status === "CHECKED_IN");
            const next = mine.find((b) => (b.status === "RESERVED" || b.status === "CONFIRMED") && b.endAt > now);
            const status = current ? "OCCUPIED" : room.status;
            return (
              <section key={room.id} className={BOX}>
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="font-semibold">{t("Room {room} — {type}", { room: room.number, type: t(room.roomType.name) })}</p>
                    <p className="text-xs text-muted-foreground">{t("{amount} per booking · up to {n} people", { amount: formatTZS(room.roomType.baseRate), n: room.roomType.maxAdults })}</p>
                  </div>
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-semibold ring-1 ring-inset", ROOM_STATUS_META[status].className)}>
                    {current && <span className="relative flex size-1.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" /><span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" /></span>}
                    {t(MEETING_ROOM_STATUS_LABEL[status])}
                  </span>
                </div>
                <dl className="mt-3 grid grid-cols-2 gap-2 text-sm">
                  <div className={cn("rounded-2xl p-3", current ? "bg-emerald-500/10" : "bg-muted/50")}>
                    <dt className="text-[11px] text-muted-foreground">{t("In use now")}</dt>
                    <dd className="mt-0.5 font-medium leading-tight">{current ? <><span className="block truncate">{current.reservation.companyName ?? current.reservation.guest.fullName}</span><span className="text-xs text-muted-foreground tabular-nums">{timeRange(current.startAt, current.endAt)}</span></> : <span className="text-muted-foreground">{t.ctx("meeting", "Free")}</span>}</dd>
                  </div>
                  <div className="rounded-2xl bg-muted/50 p-3">
                    <dt className="text-[11px] text-muted-foreground">{t.ctx("meeting", "Next")}</dt>
                    <dd className="mt-0.5 font-medium leading-tight">{next ? <><span className="block truncate">{next.reservation.companyName ?? next.reservation.guest.fullName}</span><span className="text-xs text-muted-foreground tabular-nums">{day(next) === today ? t("Today") : t.shortDate(day(next))} · {timeRange(next.startAt, next.endAt)}</span></> : <span className="text-muted-foreground">{t("Nothing booked")}</span>}</dd>
                  </div>
                </dl>
              </section>
            );
          })}
          <section className={BOX}>
            <p className="mb-2 flex items-center justify-between text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">
              <span className="flex items-center gap-1.5"><Clock className="size-3.5" />{t("Last 14 days · hours booked")}</span>
              <span className="normal-case tracking-normal tabular-nums">{t("{h} h", { h: Math.round(last14.reduce((n, x) => n + x.h, 0) * 10) / 10 })}</span>
            </p>
            {last14.every((x) => x.h === 0) ? <p className="rounded-2xl bg-muted/50 px-3 py-3 text-center text-xs text-muted-foreground">{t("No meeting in the last 14 days.")}</p> : (
              <div className="grid h-20 items-end gap-1" style={{ gridTemplateColumns: "repeat(14, minmax(0, 1fr))" }}>
                {last14.map((x, i) => (
                  <div key={x.d} className="flex h-full flex-col items-center justify-end gap-1" title={`${t.shortDate(x.d)} · ${x.h ? t("{h} h", { h: x.h.toFixed(1) }) : t("free")}`}>
                    <span className={cn("w-full rounded-[4px]", x.h ? "bg-emerald-500" : "bg-muted", x.h && i !== last14.length - 1 && "opacity-60")} style={{ height: x.h ? `${Math.max(12, (x.h / maxH) * 100)}%` : "6%" }} />
                    <span className={cn("text-[9px] text-muted-foreground", i === last14.length - 1 && "font-semibold text-foreground")}>{new Date(`${x.d}T00:00:00Z`).toLocaleDateString(t.intl, { weekday: "short", timeZone: "UTC" }).slice(0, 2)}</span>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      </div>

      <section className={BOX}>
        <h2 className="text-base font-semibold">{t("Today")} <span className="font-normal text-muted-foreground">· {t.date(today)}</span></h2>
        {todays.length === 0
          ? <EmptyState compact icon={<Presentation />} title={t("No meetings today")} description={watching ? t("Nothing is booked in the meeting room today.") : t("Book the meeting room for workshops, board meetings and interviews.")} />
          : <ul className="divide-y divide-border/60">{todays.map((b) => <Row key={b.id} b={b} actions />)}</ul>}
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        <section className={BOX}>
          <h2 className="text-base font-semibold">{t("Coming up")}</h2>
          {byDay.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{t("Nothing booked yet.")}</p> : byDay.map(([d, list]) => (
            <div key={d} className="mt-3">
              <h3 className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t.date(d)}</h3>
              <ul className="divide-y divide-border/60">{list.map((b) => <Row key={b.id} b={b} />)}</ul>
            </div>
          ))}
        </section>
        <section className={BOX}>
          <h2 className="text-base font-semibold">{t("Last 14 days")}</h2>
          {recent.length === 0 ? <p className="mt-2 text-sm text-muted-foreground">{t("No meetings in the last 14 days.")}</p> : (
            <ul className="divide-y divide-border/60">{recent.map((b) => <Row key={b.id} b={b} actions />)}</ul>
          )}
        </section>
      </div>
    </div>
  );
}
