import type { Metadata } from "next";
import { timeRange } from "@/lib/meeting";
import Link from "next/link";
import { Ban, Banknote, CalendarCheck, ChevronDown, ChevronRight, ExternalLink, Globe, Hourglass, Inbox, MessageCircle, Plane, QrCode, Timer } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { listRequests, REQUEST_TABS, requestStats } from "@/server/services/booking-requests";
import { PAY_LATER_WHERE } from "@/server/services/booking-holds";
import { fromDbDate, toDbDate } from "@/lib/time/business-date";
import { formatTZS } from "@/lib/format";
import { BOOKING_REQUEST_STATUS } from "@/lib/booking-request-meta";
import { cn } from "@/lib/utils";
import { EmptyState } from "@/components/staff/page-header";
import { Initials } from "@/components/dashboard/kit";
import { LogManualRequestDialog } from "./forms";
import { BookingRequestView } from "./[id]/request-view";
import type { BookingRequestStatus } from "@/generated/prisma/enums";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Online bookings") };
}

type Tab = BookingRequestStatus | "OPEN" | "ALL";
const TAB_LABEL: Record<Tab, string> = { OPEN: msg("Open"), NEW: msg("New"), REVIEWING: msg("Reviewing"), CONTACTED: msg("Contacted"), CONFIRMED: msg("Confirmed"), CONVERTED: msg("Converted"), REJECTED: msg("Rejected"), CANCELLED: msg("Cancelled"), ALL: msg("All") };
const TABS: Tab[] = ["OPEN", ...REQUEST_TABS, "ALL"];

export default async function BookingRequestsPage({ searchParams }: PageProps<"/staff/booking-requests">) {
  const user = await requirePagePermission("booking_requests.view");
  const t = await getT();
  const sp = await searchParams;
  const raw = typeof sp.status === "string" ? sp.status.toUpperCase() : "OPEN";
  const tab: Tab = (TABS as string[]).includes(raw) ? (raw as Tab) : "OPEN";
  // A request opens right in the list (confirm, reserve, change, assign, log a call) — tap it again to close.
  const openId = typeof sp.open === "string" && /^[a-z0-9]{10,40}$/i.test(sp.open) ? sp.open : null;
  const hrefFor = (id: string | null) => { const q = new URLSearchParams(); if (tab !== "OPEN") q.set("status", tab.toLowerCase()); if (id) q.set("open", id); const qs = q.toString(); return `/staff/booking-requests${qs ? `?${qs}` : ""}`; };
  // Managers and the MD follow the online bookings; reception answers them.
  const watching = can(user, "dashboard.manager") || can(user, "dashboard.owner") || can(user, "dashboard.admin");
  const today = await businessToday();
  const monthStart = `${today.slice(0, 8)}01`;
  const [{ rows, counts }, types, stats, answered, booked, payLater] = await Promise.all([
    listRequests(tab),
    db.roomType.findMany({ where: { isActive: true }, orderBy: { sortOrder: "asc" }, select: { slug: true, name: true } }),
    requestStats(monthStart, today),
    db.bookingRequest.findMany({ where: { businessDate: { gte: toDbDate(monthStart), lte: toDbDate(today) }, handledAt: { not: null } }, select: { createdAt: true, handledAt: true } }),
    db.bookingRequest.aggregate({ where: { businessDate: { gte: toDbDate(monthStart), lte: toDbDate(today) }, status: "CONVERTED" }, _sum: { estimatedNet: true } }),
    // Booked online to pay later (the website, the Hotel QR): real bookings, but no room is held until they are paid.
    can(user, "reservations.view") ? db.reservation.findMany({
      where: { status: "INQUIRY", arrivalDate: { gte: toDbDate(today) }, source: { code: { in: ["WEBSITE", "HOTEL_QR"] } }, ...PAY_LATER_WHERE },
      orderBy: { createdAt: "desc" }, take: 30,
      select: {
        id: true, reference: true, createdAt: true, arrivalDate: true, departureDate: true, adults: true, children: true, netAmount: true,
        guest: { select: { fullName: true, phone: true } }, source: { select: { code: true, name: true } },
        rooms: { where: { status: "INQUIRY" }, select: { room: { select: { number: true } }, roomType: { select: { name: true } } } },
      },
    }) : [],
  ]);
  const openCount = (counts.NEW ?? 0) + (counts.REVIEWING ?? 0) + (counts.CONTACTED ?? 0) + (counts.CONFIRMED ?? 0);
  const countFor = (k: Tab) => (k === "OPEN" ? openCount : k === "ALL" ? Object.values(counts).reduce((a, b) => a + (b ?? 0), 0) : counts[k] ?? 0);
  const avgMinutes = answered.length ? Math.round(answered.reduce((sum, x) => sum + (x.handledAt!.getTime() - x.createdAt.getTime()), 0) / answered.length / 60000) : null;
  const now = new Date();
  const ago = (d: Date) => { const m = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60000)); return m < 60 ? t("{n} min", { n: m }) : m < 1440 ? t("{n} h", { n: Math.floor(m / 60) }) : t("{n} d", { n: Math.round(m / 1440) }); };
  const monthName = new Date(`${today}T00:00:00Z`).toLocaleDateString(t.intl, { month: "long", timeZone: "UTC" });
  const maxSource = Math.max(1, ...stats.bySource.map((x) => x.count));

  return (
    <div className="w-full space-y-4">
      {/* Slim header */}
      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card">
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[oklch(0.78_0.12_80)]/70 to-transparent" />
        <div className="relative flex flex-wrap items-center justify-between gap-3 px-4 py-4 sm:px-5">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-sky-400 to-indigo-600 text-white shadow-[0_10px_24px_-12px_rgb(14_165_233)]"><Inbox className="size-6" /></span>
            <div className="min-w-0">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">{t("Online bookings")} · {t(user.roleName)}</p>
              <h1 className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">{t("Online bookings")}</h1>
              <p className="text-xs text-muted-foreground">{watching ? t("Requests from the website and WhatsApp — how fast reception answers them and how many become bookings.") : t("Requests from the website and WhatsApp. Nothing here holds a room — call the customer, then confirm to make the booking.")}</p>
            </div>
          </div>
          {!watching && can(user, "booking_requests.manage") && <LogManualRequestDialog types={types} today={today} />}
        </div>
      </section>

      {/* The month at a glance */}
      <div className="grid gap-4 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
        <section className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-border/70 bg-border/60 sm:grid-cols-3">
          {[
            { label: t("Received · {month}", { month: monthName }), value: String(stats.total), sub: t("{n} new right now", { n: stats.new }), icon: Inbox, tint: "bg-sky-500/15 text-sky-400" },
            { label: t("Became bookings"), value: String(stats.converted), sub: stats.conversionRate != null ? t("{pct}% of requests", { pct: Math.round(stats.conversionRate) }) : t("none yet"), icon: CalendarCheck, tint: "bg-emerald-500/15 text-emerald-500", tone: "text-emerald-600 dark:text-emerald-400" },
            { label: t("Waiting for an answer"), value: String(stats.openNow), sub: t("open, any month"), icon: Hourglass, tint: "bg-amber-500/15 text-amber-400", tone: stats.openNow ? "text-amber-600 dark:text-amber-300" : undefined },
            { label: t("Average answer time"), value: avgMinutes == null ? "—" : avgMinutes < 60 ? t("{n} min", { n: avgMinutes }) : t("{n} h", { n: Math.round(avgMinutes / 6) / 10 }), sub: t("{n} answered", { n: answered.length }), icon: Timer, tint: "bg-violet-500/15 text-violet-400" },
            { label: t("Value booked"), value: formatTZS(booked._sum.estimatedNet ?? 0), sub: t("estimated, from requests"), icon: Banknote, tint: "bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.8_0.11_82)]" },
            { label: t("Turned down · cancelled"), value: `${stats.rejected} · ${stats.cancelled}`, sub: t("this month"), icon: Ban, tint: "bg-rose-500/15 text-rose-400" },
          ].map((c) => (
            <div key={c.label} className="min-w-0 bg-card px-4 py-3.5">
              <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground"><span className={cn("grid size-5 shrink-0 place-items-center rounded-md [&_svg]:size-3", c.tint)}><c.icon /></span><span className="truncate">{c.label}</span></p>
              <p className={cn("mt-1 truncate text-lg font-semibold tabular-nums", c.tone)}>{c.value}</p>
              <p className="truncate text-[11px] text-muted-foreground">{c.sub}</p>
            </div>
          ))}
        </section>
        <section className="grid gap-4 rounded-3xl border border-border/70 bg-card p-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("Where they come from")}</p>
            {stats.bySource.length === 0 ? <p className="text-xs text-muted-foreground">{t("No requests this month.")}</p> : (
              <ul className="space-y-2">
                {[...stats.bySource].sort((a, b) => b.count - a.count).map((x) => (
                  <li key={x.name} className="text-xs">
                    <p className="flex justify-between gap-2"><span className="truncate">{t(x.name)}</span><span className="font-semibold tabular-nums">{x.count}</span></p>
                    <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-muted"><span className="block h-full rounded-full bg-sky-500" style={{ width: `${(x.count / maxSource) * 100}%` }} /></span>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("Who answered")}</p>
            {stats.byHandler.length === 0 ? <p className="text-xs text-muted-foreground">{t("Nobody has answered one yet this month.")}</p> : (
              <ul className="space-y-1.5">
                {stats.byHandler.map((x) => (
                  <li key={x.name} className="flex items-center gap-2 text-xs"><Initials name={x.name} className="size-6 text-[9px]" /><span className="min-w-0 flex-1 truncate">{x.name.replace(/\s*\(.*\)/, "")}</span><span className="font-semibold tabular-nums">{x.count}</span></li>
                ))}
              </ul>
            )}
          </div>
        </section>
      </div>

      {payLater.length > 0 && (
        <section aria-labelledby="pay-later-title" className="space-y-2">
          <div className="flex flex-wrap items-end justify-between gap-2 px-1">
            <div>
              <h2 id="pay-later-title" className="text-sm font-semibold">{t("Booked online — not paid yet")}</h2>
              <p className="text-xs text-muted-foreground">{t("The room is not held until it is paid: whoever pays first gets it. The guest can pay online from their booking, or here at check-in.")}</p>
            </div>
          </div>
          <ul className="divide-y divide-border/60 overflow-hidden rounded-3xl border border-border/70 bg-card">
            {payLater.map((b) => {
              const Src = b.source.code === "HOTEL_QR" ? QrCode : Globe;
              return (
                <li key={b.id}>
                  <Link href={`/staff/reservations/${b.id}`} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1.5 px-4 py-3 transition-colors hover:bg-muted/40 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,1fr)_auto] sm:px-5">
                    <div className="min-w-0">
                      <p className="truncate font-medium">{b.guest.fullName}</p>
                      <p className="truncate text-xs text-muted-foreground">{b.guest.phone}</p>
                    </div>
                    <div className="flex items-center gap-3 sm:order-last">
                      <div className="flex flex-col items-end gap-1">
                        <span className="rounded-full bg-orange-500/12 px-2.5 py-0.5 text-[11px] font-semibold text-orange-800 dark:text-orange-300">{t("Not paid · room not held")}</span>
                        <span className="text-xs font-semibold tabular-nums">{formatTZS(b.netAmount)}</span>
                      </div>
                      <ChevronRight className="size-4 shrink-0 text-muted-foreground" />
                    </div>
                    <div className="col-span-2 min-w-0 text-xs sm:col-span-1">
                      <p className="font-medium tabular-nums">{t.shortDate(fromDbDate(b.arrivalDate))} → {t.shortDate(fromDbDate(b.departureDate))}</p>
                      <p className="truncate text-muted-foreground">{b.rooms.map((x) => `${t(x.roomType.name)} (${x.room.number})`).join(", ")} · {t.plural(b.adults + b.children, "{n} guest", "{n} guests")}</p>
                    </div>
                    <div className="col-span-2 min-w-0 text-xs text-muted-foreground sm:col-span-1">
                      <p className="flex items-center gap-1.5 truncate"><Src className="size-3.5 shrink-0" aria-hidden="true" />{t(b.source.name)} · <span className="font-mono">{b.reference}</span></p>
                      <p className="truncate">{t.dateTime(b.createdAt)}</p>
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}

      {/* Status — one bar that slides on phones */}
      <nav aria-label={t("Filter by status")} className="-mx-1 overflow-x-auto px-1 [scrollbar-width:none]">
        <div className="flex w-max gap-1 rounded-2xl border border-border/70 bg-card p-1">
          {TABS.map((k) => (
            <Link key={k} href={k === "OPEN" ? "/staff/booking-requests" : `/staff/booking-requests?status=${k.toLowerCase()}`} aria-current={k === tab ? "page" : undefined}
              className={cn("inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-semibold transition-colors", k === tab ? "bg-foreground text-background" : "text-muted-foreground hover:bg-muted hover:text-foreground")}>
              {t(TAB_LABEL[k])}
              <span className={cn("min-w-5 rounded-full px-1.5 text-center text-[10px] tabular-nums", k === "NEW" && countFor(k) > 0 ? "bg-[oklch(0.8_0.14_80)] text-[oklch(0.25_0.05_70)]" : k === tab ? "bg-background/20" : "bg-muted")}>{countFor(k)}</span>
            </Link>
          ))}
        </div>
      </nav>

      {rows.length === 0 ? (
        <EmptyState icon={<Inbox />} title={tab === "NEW" || tab === "OPEN" ? t("No requests waiting") : t("No {status} requests", { status: t(TAB_LABEL[tab]).toLowerCase() })} description={t("New website requests appear here instantly.")} />
      ) : (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-3xl border border-border/70 bg-card">
          {rows.map((r) => {
            const meta = BOOKING_REQUEST_STATUS[r.status];
            const isNew = r.status === "NEW";
            const Src = r.source.name === "Website" ? Globe : MessageCircle;
            const inD = fromDbDate(r.checkInDate), outD = fromDbDate(r.checkOutDate);
            const opened = r.id === openId;
            return (
              <li key={r.id} id={`req-${r.id}`} className="scroll-mt-24">
                <Link href={hrefFor(opened ? null : r.id)} scroll={false} aria-expanded={opened}
                  className={cn("grid grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-2 px-4 py-3.5 transition-colors hover:bg-muted/40 sm:grid-cols-[minmax(0,1.2fr)_minmax(0,1.1fr)_minmax(0,1fr)_auto] sm:px-5", isNew && "bg-[oklch(0.75_0.13_80/0.07)]", opened && "bg-muted/50")}>
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 font-medium">
                      {isNew && <span className="size-2 shrink-0 animate-pulse rounded-full bg-[oklch(0.7_0.16_70)]" aria-hidden="true" />}
                      <span className="truncate">{r.companyName ?? r.fullName}</span>
                    </p>
                    <p className="truncate text-xs text-muted-foreground">{r.companyName ? `${r.fullName} · ` : ""}{r.phone}</p>
                  </div>
                  <div className="flex items-center gap-3 sm:order-last">
                    <div className="flex flex-col items-end gap-1">
                      <span className={cn("rounded-full px-2.5 py-0.5 text-[11px] font-semibold", meta.className)}>{t(meta.label)}</span>
                      {r.estimatedNet != null && <span className="text-xs font-semibold tabular-nums">{formatTZS(r.estimatedNet)}</span>}
                    </div>
                    <ChevronDown className={cn("size-4 shrink-0 text-muted-foreground transition-transform", opened && "rotate-180")} />
                  </div>
                  <div className="col-span-2 min-w-0 text-xs sm:col-span-1">
                    <p className="font-medium tabular-nums">{r.meetingStartAt && r.meetingEndAt ? t("{date} · meeting {time}", { date: t.shortDate(inD), time: timeRange(r.meetingStartAt, r.meetingEndAt) }) : `${t.shortDate(inD)} → ${t.shortDate(outD)}`}</p>
                    <p className="truncate text-muted-foreground">
                      {r.roomCount > 1 ? `${r.roomCount} × ` : ""}{t(r.roomType.name)} · {t.plural(r.adults + r.children, "{n} guest", "{n} guests")}
                      {r.transportRequested && <Plane className="ml-1.5 inline size-3.5" aria-label={t("Airport pickup requested")} />}
                    </p>
                  </div>
                  <div className="col-span-2 min-w-0 text-xs text-muted-foreground sm:col-span-1">
                    <p className="flex items-center gap-1.5 truncate"><Src className="size-3.5 shrink-0" aria-hidden="true" />{t(r.source.name)} · <span className="font-mono">{r.reference}</span></p>
                    <p className="truncate">{isNew ? <span className="font-semibold text-amber-600 dark:text-amber-300">{t("waiting {time}", { time: ago(r.createdAt) })}</span> : t.dateTime(r.createdAt)}{r.assignedTo && ` · ${r.assignedTo.fullName.replace(/\s*\(.*\)/, "")}`}</p>
                  </div>
                </Link>
                {opened && (
                  <div className="border-t border-border/60 bg-muted/20 px-3 py-4 sm:px-5 sm:py-5">
                    <div className="mb-3 flex justify-end">
                      <Link href={`/staff/booking-requests/${r.id}`} className="inline-flex items-center gap-1.5 rounded-full border border-border px-3 py-1 text-xs font-medium text-muted-foreground hover:bg-muted hover:text-foreground"><ExternalLink className="size-3.5" />{t("Open on its own page")}</Link>
                    </div>
                    <BookingRequestView id={r.id} user={user} inline />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
