import Link from "next/link";
import { notFound } from "next/navigation";
import {
  Armchair, ArrowLeft, BedDouble, CalendarClock, CalendarPlus, CalendarX2, Car, ChefHat, ConciergeBell, Crown, LogIn, LogOut, Mail, MessageCircle, Pencil, Phone, Receipt, Smartphone, UserX, UtensilsCrossed,
} from "lucide-react";
import { can, type CurrentUser } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday } from "@/server/settings";
import { siteOrigin } from "@/server/site-origin";
import { ensureGuestToken, guestMessage, guestTimeline } from "@/server/services/guest-comms";
import { customerFootprint, customerHistory } from "@/server/services/guests";
import { customerOnlinePayments } from "@/server/services/online-payments-admin";
import { formatBusinessDate, formatDateTime, formatTime, formatTZS } from "@/lib/format";
import { fromDbDate, toDbDate } from "@/lib/time/business-date";
import { RESERVATION_STATUS_META } from "@/lib/reservation-status";
import { REQUEST_TYPE_LABEL } from "@/lib/request-meta";
import { TRIP_STATUS_META, TRIP_TYPE_LABEL } from "@/lib/transport-meta";
import { GUEST_MESSAGE_TYPES, internationalPhone, type GuestMessageType } from "@/lib/guest-messages";
import { buttonVariants } from "@/components/ui/button";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { DEFAULT_LOCALE } from "@/i18n/config";
import type { T } from "@/i18n/translate";
import { cn } from "@/lib/utils";
import { GuestMessenger, type GuestMessageOption } from "@/components/staff/reception/guest-messenger";
import { said } from "@/app/staff/(app)/collections/collection-lines";
import { GuestDetails, type DetailRow } from "./guest-details";
import { EverythingWithUs, shownName } from "./everything-with-us";

const OPEN_ORDER = ["PENDING", "ACCEPTED", "PREPARING", "READY", "OUT_FOR_DELIVERY"] as const;
const ORDER_STATUS: Record<string, string> = {
  PENDING: msg("New"), ACCEPTED: msg("Accepted"), PREPARING: msg("Preparing"), READY: msg("Ready to serve"), OUT_FOR_DELIVERY: msg("Serving"),
  DELIVERED: msg("Served"), COMPLETED: msg("Done"), COLLECTED: msg("Collected"),
};

const CHANNEL: Record<string, string> = { WHATSAPP: "WhatsApp", SMS: msg("SMS"), EMAIL: msg("Email"), COPY: msg("Copied"), CALL: msg("Call") };
const ID_WORD: Record<string, string> = { PASSPORT: msg("Passport"), NATIONAL_ID: msg("National ID"), DRIVING_LICENCE: msg("Driving licence"), VOTER_ID: msg("Voter ID"), OTHER: msg("ID") };
const shortNo = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;
/** Dates the reader's way: "5 Oct 2026" / "2026年10月5日" (and without the year). */
const dates = (t: T) => {
  const en = t.locale === DEFAULT_LOCALE;
  const full = new Intl.DateTimeFormat(t.intl, { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  const short = new Intl.DateTimeFormat(t.intl, { day: "numeric", month: "short", timeZone: "UTC" });
  const day = (d: Date) => (en ? formatBusinessDate(fromDbDate(d)).replace(/^\w+,?\s*/, "") : full.format(d));
  return {
    day,
    dayMonth: (d: Date) => (en ? day(d).replace(/\s\d{4}$/, "") : short.format(d)),
    dateTime: (d: Date) => (en ? formatDateTime(d) : t.dateTime(d)),
    time: (d: Date) => (en ? formatTime(d) : t.time(d)),
    business: (d: string) => (en ? formatBusinessDate(d) : t.date(d)),
  };
};

/**
 * One customer, everything in its place: who they are and one-tap contact at the top, their
 * numbers in one strip, what is happening right now (in a room, at a table — and both together:
 * "Room 305 · at Outside 3 now" — an order on the way, a booking coming), then their stays,
 * everything they had with us (hotel, restaurant, room service, payments, charges), history and
 * requests on the left — details (edit, remove) and every message sent on the right. Room money
 * (balances, room payments, charges) only for reception and managers — never for a waiter.
 */
export async function GuestProfile({ id, user }: { id: string; user: CurrentUser }) {
  const t = await getT();
  const { day, dayMonth, dateTime, time, business } = dates(t);
  const [g, today] = await Promise.all([
    db.guest.findUnique({
      where: { id },
      include: {
        corporateCustomer: { select: { id: true, companyName: true } },
        reservations: {
          orderBy: { arrivalDate: "desc" }, take: 100,
          include: { rooms: { where: { status: { not: "CANCELLED" } }, include: { room: { select: { number: true } }, roomType: { select: { name: true } } } }, source: { select: { name: true } }, group: { select: { id: true, name: true } } },
        },
      },
    }),
    businessToday(),
  ]);
  if (!g) notFound();
  const mine = { OR: [{ guestId: g.id }, { reservation: { guestId: g.id } }] };
  const ordered = { ...mine, status: { not: "CANCELLED" as const } };
  const canRemove = can(user, "guests.delete") && !g.deletedAt;
  const roomMoney = can(user, "reservations.view") || can(user, "reports.view");
  // Money is for reception and managers — never a waiter.
  const online = roomMoney ? await customerOnlinePayments(id) : [];
  const canStays = can(user, "reservations.view");
  const [{ events, messages }, orders, orderCount, orderMoney, table, tableBookings, footprint, requests, trips, h] = await Promise.all([
    guestTimeline(g.id),
    db.restaurantOrder.findMany({
      where: ordered, orderBy: { createdAt: "desc" }, take: 8,
      select: { id: true, number: true, status: true, total: true, createdAt: true, roomNumber: true, tableLabel: true, type: true, location: { select: { name: true } }, items: { select: { quantity: true } } },
    }),
    db.restaurantOrder.count({ where: ordered }),
    // Money in the restaurant (room-bill orders are counted with the stay).
    db.restaurantOrder.aggregate({ where: { ...ordered, settlement: { not: "ROOM" } }, _sum: { total: true, paidAmount: true } }),
    // At a table right now (their own, or someone else's they joined).
    db.diningSession.findFirst({
      where: { openAtId: { not: null }, OR: [{ guestId: g.id }, { members: { some: { guestId: g.id } } }] },
      select: { startedAt: true, guestCount: true, billRequestedAt: true, guestId: true, location: { select: { name: true } }, guest: { select: { fullName: true } }, orders: { where: { status: { not: "CANCELLED" } }, select: { total: true, paidAmount: true } } },
    }),
    db.tableReservation.findMany({
      where: { guestId: g.id, status: { in: ["BOOKED", "CONFIRMED"] }, date: { gte: toDbDate(today) } },
      orderBy: { reservedFor: "asc" }, take: 2, select: { id: true, reference: true, reservedFor: true, guestCount: true, location: { select: { name: true } } },
    }),
    canRemove ? customerFootprint(g.id) : Promise.resolve(null),
    db.serviceRequest.findMany({ where: mine, orderBy: { createdAt: "desc" }, take: 6, select: { id: true, type: true, status: true, description: true, createdAt: true } }),
    db.transportTrip.findMany({ where: mine, orderBy: { pickupAt: "desc" }, take: 6, select: { id: true, reference: true, type: true, status: true, pickupAt: true, destination: true } }),
    customerHistory(g.id, { roomMoney }),
  ]);

  const rs = g.reservations;
  const live = rs.filter((r) => r.status !== "CANCELLED" && r.status !== "NO_SHOW");
  const completed = rs.filter((r) => r.status === "CHECKED_OUT");
  const nightsOf = (r: (typeof rs)[number]) => r.rooms.reduce((m, x) => Math.max(m, x.isDayUse ? 0 : x.nights), 0);
  const nights = completed.reduce((n, r) => n + nightsOf(r), 0);
  const spent = completed.reduce((n, r) => n + r.netAmount, 0);
  const owed = live.filter((r) => r.billTo === "GUEST").reduce((n, r) => n + Math.max(0, r.balanceAmount), 0);
  const foodPaid = orderMoney._sum.paidAmount ?? 0;
  const foodDue = Math.max(0, (orderMoney._sum.total ?? 0) - foodPaid);
  const lastVisit = [...completed.map((r) => fromDbDate(r.departureDate)), ...(orders[0] ? [orders[0].createdAt.toISOString().slice(0, 10)] : [])].sort().at(-1) ?? null;
  const openOrders = orders.filter((o) => (OPEN_ORDER as readonly string[]).includes(o.status));
  const current = rs.find((r) => r.status === "CHECKED_IN") ?? null;
  const upcoming = rs.filter((r) => (r.status === "RESERVED" || r.status === "CONFIRMED") && fromDbDate(r.departureDate) >= today).sort((a, b) => +a.arrivalDate - +b.arrivalDate);
  const next = upcoming[0] ?? null;
  // Staying in a room someone else booked (they share it).
  const shared = current ? null : h.now.stays.find((x) => x.guestIds[0] !== g.id) ?? null;
  // In a room and at a table at once: "Room 305 · at Outside 3 now · TZS 45,000 on the room · TZS 20,000 to pay at the table".
  const both = h.now.stays.length && h.now.table ? [
    t("Room {room}", { room: h.now.stays.map((x) => x.rooms).filter(Boolean).join(", ") || "—" }), t("at {place} now", { place: t(h.now.table.name) }),
    h.now.table.onTheirRoom ? t("{amount} on the room", { amount: formatTZS(h.now.table.onTheirRoom) }) : null,
    h.now.table.money.due ? t("{amount} to pay at the table", { amount: formatTZS(h.now.table.money.due) }) : h.now.table.money.orders ? t("nothing to pay at the table") : null,
    h.now.stays.find((x) => x.foodPayer)?.foodPayer ?? null,
  ].filter(Boolean).join(" · ") : null;

  // Message the guest about their current (or next) booking.
  const focus = current ?? next;
  const origin = await siteOrigin();
  let options: GuestMessageOption[] = [];
  let link = "";
  // The booking messages carry the room balance and the guest's private stay link — for reception and managers only.
  if (canStays && focus && focus.kind === "STAY") {
    link = `${origin}/stay/${await ensureGuestToken(db, focus.id)}`;
    const [b, w] = await Promise.all([guestMessage(focus.id, "BOOKING_CREATED", origin), focus.status === "CHECKED_IN" ? guestMessage(focus.id, "WELCOME", origin) : null]);
    options = [
      { type: "BOOKING_CREATED", label: msg("Booking details"), text: b.text, subject: b.subject },
      ...(w ? [{ type: "WELCOME" as const, label: msg("Welcome & menu"), text: w.text, subject: w.subject }] : []),
    ];
  }

  const phone = internationalPhone(g.phone);
  const wa = phone ? `https://wa.me/${phone.replace(/\D/g, "")}` : null;
  const canEdit = can(user, "guests.manage");
  const rooms = (r: (typeof rs)[number]) => r.rooms.map((x) => x.room.number).join(", ");
  const details: DetailRow[] = [
    { label: t("Customer ID"), value: g.reference, mono: true },
    { label: t("Phone"), value: g.phone, warn: !g.phone },
    { label: t("Other phone"), value: g.altPhone },
    { label: t("Email"), value: g.email },
    { label: t("ID"), value: g.idNumber ? `${t(ID_WORD[g.idType ?? ""] ?? "ID")} · ${g.idNumber}` : t("No ID on file"), warn: !g.idNumber },
    { label: t("Nationality"), value: g.nationality },
    { label: t("Birthday"), value: g.dateOfBirth ? day(g.dateOfBirth) : null },
    { label: t("Address"), value: g.address },
    { label: t("Best way to reach"), value: g.preferredChannel ? t(CHANNEL[g.preferredChannel] ?? g.preferredChannel) : null },
    { label: t("Offers"), value: g.marketingConsent ? t("Agrees to offers") : t("No offers") },
    ...(g.tags.length ? [{ label: t("Tags"), value: g.tags.join(", ") }] : []),
    ...(g.preferences ? [{ label: t("Preferences"), value: g.preferences, long: true }] : []),
    ...(g.notes ? [{ label: t("Staff notes"), value: g.notes, long: true }] : []),
  ];

  return (
    <div className="w-full space-y-4">
      <Link href="/staff/guests" className="inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"><ArrowLeft className="size-4" />{t("Customers")}</Link>

      {g.deletedAt && (
        <p className="flex items-center gap-2 rounded-2xl border border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-700 dark:text-rose-200">
          <UserX className="size-4 shrink-0" />{t("This customer was removed on {date}. Their stays and orders stay in the books; their details were wiped.", { date: dateTime(g.deletedAt) })}
        </p>
      )}

      {/* ── Who ── */}
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="text-[clamp(1.5rem,2.4vw,2rem)] font-semibold tracking-tight">{shownName(t, g.fullName)}</h1>
            {g.vip && <span className="inline-flex items-center gap-1 rounded-full bg-[oklch(0.75_0.13_80)]/20 px-2 py-0.5 text-[11px] font-bold text-[oklch(0.5_0.12_75)] dark:text-[#f0cf86]"><Crown className="size-3" />VIP</span>}
          </div>
          <p className="mt-1 text-sm text-muted-foreground">
            <span className="font-mono">{g.reference}</span> · {t("customer since {date}", { date: g.createdAt.toLocaleDateString(t.intl, { day: "numeric", month: "short", year: "numeric" }) })}
            {g.corporateCustomer && <> · <Link href={`/staff/corporate/${g.corporateCustomer.id}`} className="hover:text-foreground hover:underline">{g.corporateCustomer.companyName}</Link></>}
          </p>
        </div>
        {!g.deletedAt && (
          <div className="flex flex-wrap gap-2">
            {g.phone && <a href={`tel:${phone ?? g.phone}`} className={buttonVariants({ variant: "outline" })}><Phone />{g.phone}</a>}
            {wa && <a href={wa} target="_blank" rel="noopener" className={buttonVariants({ variant: "outline" })}><MessageCircle className="text-emerald-500" />WhatsApp</a>}
            {can(user, "reservations.create") && !can(user, "dashboard.manager") && !can(user, "dashboard.owner") && !can(user, "dashboard.admin") && <Link href={`/staff/reservations/new?guest=${g.id}`} className={buttonVariants()}><CalendarPlus />{t("New booking")}</Link>}
          </div>
        )}
      </header>

      {/* ── Numbers ── */}
      <section className="grid grid-cols-2 overflow-hidden rounded-2xl border border-border/70 bg-card sm:grid-cols-5 [&>div]:border-border/70 [&>div]:p-4 max-sm:[&>div:nth-child(odd)]:border-r max-sm:[&>div:nth-child(n+3)]:border-t sm:[&>div:not(:last-child)]:border-r">
        <Figure label={t("Stays")} value={String(live.length)} sub={nights ? t.plural(nights, "{n} night", "{n} nights") : completed.length ? undefined : t("none yet")} />
        <Figure label={t("Orders")} value={String(orderCount)} sub={openOrders.length ? t("{n} on the way", { n: openOrders.length }) : undefined} />
        {roomMoney ? (
          <>
            <Figure label={t("Owes")} value={formatTZS(owed + foodDue)} tone={owed + foodDue > 0 ? "bad" : "good"} sub={owed && foodDue ? t("rooms {rooms} · food {food}", { rooms: formatTZS(owed), food: formatTZS(foodDue) }) : undefined} />
            <Figure label={t("Spent")} value={formatTZS(spent + foodPaid)} sub={spent && foodPaid ? t("rooms {rooms} · food {food}", { rooms: formatTZS(spent), food: formatTZS(foodPaid) }) : undefined} />
          </>
        ) : (
          <>
            <Figure label={t("Owes")} value={formatTZS(foodDue)} tone={foodDue > 0 ? "bad" : "good"} sub={t("at the restaurant")} />
            <Figure label={t("Spent")} value={formatTZS(foodPaid)} sub={t("at the restaurant")} />
          </>
        )}
        <Figure label={t("Last visit")} value={current || shared || table || openOrders.length ? t("Now") : lastVisit ? day(new Date(`${lastVisit}T00:00:00Z`)) : "—"} className="max-sm:col-span-2" />
      </section>

      {/* ── Right now ── */}
      {(current || shared || table || openOrders.length > 0 || next || tableBookings.length > 0) ? (
        <section className="overflow-hidden rounded-2xl border border-border/70 bg-card">
          <h2 className="px-4 pt-3 text-xs font-semibold uppercase tracking-[0.16em] text-muted-foreground">{t("Right now")}</h2>
          {both && (
            <p className="mx-4 mb-1 mt-2 flex items-center gap-2 rounded-xl bg-violet-500/10 px-3 py-2 text-sm font-medium text-violet-800 dark:text-violet-200">
              <BedDouble className="size-4 shrink-0" />{both}
            </p>
          )}
          <ul className="divide-y divide-border/50 text-sm">
            {current && (
              <NowRow icon={BedDouble} tone="text-emerald-500" title={t("In the hotel · room {room}", { room: rooms(current) || "—" })}
                sub={t("Since {from} · leaves {to}", { from: day(current.arrivalDate), to: day(current.departureDate) })}
                action={canStays ? <Link href={`/staff/reservations/${current.id}#money`} className={buttonVariants({ variant: "outline", size: "sm" })}><Receipt />{t("Current bill")}</Link> : undefined} />
            )}
            {shared && (
              <NowRow icon={BedDouble} tone="text-emerald-500" title={t("In the hotel · room {room}", { room: shared.rooms || "—" })}
                sub={t("Sharing — booked by {name} · {ref}", { name: shownName(t, shared.guestName), ref: shared.reference })}
                action={canStays ? <Link href={`/staff/reservations/${shared.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>{t("Open")}</Link> : undefined} />
            )}
            {table && (
              <NowRow icon={Armchair} tone="text-amber-500"
                title={table.guestId !== g.id ? t("At {place} with {name}", { place: t(table.location.name), name: shownName(t, table.guest.fullName) }) : t("At {place}", { place: t(table.location.name) })}
                sub={[
                  t("Since {time}", { time: time(table.startedAt) }), t.plural(table.guestCount, "{n} person", "{n} people"),
                  table.orders.length ? `${t.plural(table.orders.length, "{n} order", "{n} orders")} · ${formatTZS(table.orders.reduce((n, o) => n + o.total, 0))}` : t("no orders yet"),
                  table.billRequestedAt ? t("asked for the bill") : null,
                ].filter(Boolean).join(" · ")}
                action={<Link href="/staff/restaurant/tables" className={buttonVariants({ variant: "outline", size: "sm" })}>{t("Tables")}</Link>} />
            )}
            {openOrders.map((o) => (
              <NowRow key={o.id} icon={ChefHat} tone="text-rose-500" title={t("Order {no} · {status}", { no: shortNo(o.number), status: t(ORDER_STATUS[o.status] ?? o.status) })}
                sub={[
                  time(o.createdAt), t.plural(o.items.reduce((n, x) => n + x.quantity, 0), "{n} item", "{n} items"),
                  o.location?.name ? t(o.location.name) : o.tableLabel ?? (o.roomNumber ? t("room {room}", { room: o.roomNumber }) : o.type === "TAKEAWAY" ? t("delivery") : t("take out")),
                  formatTZS(o.total),
                ].join(" · ")}
                action={<Link href={`/staff/restaurant/orders/${o.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>{t("Open")}</Link>} />
            ))}
            {!current && next && (
              <NowRow icon={CalendarClock} tone="text-violet-500" title={fromDbDate(next.arrivalDate) === today ? t("Coming today") : t("Coming {date}", { date: day(next.arrivalDate) })}
                sub={[t.plural(nightsOf(next) || 1, "{n} night", "{n} nights"), rooms(next) ? t("room {room}", { room: rooms(next) }) : null, next.reference].filter(Boolean).join(" · ")}
                action={canStays ? <Link href={`/staff/reservations/${next.id}`} className={buttonVariants({ variant: "outline", size: "sm" })}>{t("Open")}</Link> : undefined} />
            )}
            {tableBookings.map((b) => (
              <NowRow key={b.id} icon={CalendarClock} tone="text-sky-500" title={t("Table booked · {place}", { place: t(b.location.name) })}
                sub={`${dateTime(b.reservedFor)} · ${t.plural(b.guestCount, "{n} person", "{n} people")} · ${b.reference}`}
                action={<Link href="/staff/restaurant/reservations" className={buttonVariants({ variant: "outline", size: "sm" })}>{t("Bookings")}</Link>} />
            ))}
          </ul>
        </section>
      ) : (
        <p className="rounded-2xl border border-border/70 bg-card px-4 py-3 text-sm text-muted-foreground">
          <b className="font-semibold text-foreground">{t("Nothing right now")}</b> — {lastVisit ? t("last seen {date}.", { date: business(lastVisit) }) : t("they have not visited yet.")}
        </p>
      )}

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_360px]">
        <div className="min-w-0 space-y-4">
          {/* Stays */}
          <Card title={t("Stays")} count={rs.length}>
            {rs.length === 0 ? <Empty>{t("No bookings yet.")}</Empty> : (
              <>
                <div className="hidden grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto_minmax(0,0.9fr)] gap-3 border-y border-border/70 bg-muted/30 px-4 py-2 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground md:grid">
                  <span>{t("Booking")}</span><span>{t("Dates")}</span><span>{t("Room")}</span><span>{t("Status")}</span><span className="text-right">{roomMoney ? t("Amount") : ""}</span>
                </div>
                <ul className="divide-y divide-border/60 border-t border-border/70 md:border-t-0">
                  {rs.map((r) => {
                    const meta = RESERVATION_STATUS_META[r.status];
                    const n = nightsOf(r);
                    const done = r.status === "CANCELLED" || r.status === "NO_SHOW";
                    return (
                      <li key={r.id} className="relative grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-1 px-4 py-3 transition-colors hover:bg-muted/40 md:grid-cols-[minmax(0,1fr)_minmax(0,1.3fr)_minmax(0,1fr)_auto_minmax(0,0.9fr)] md:items-center">
                        <div className="min-w-0 leading-tight">
                          {canStays ? <Link href={`/staff/reservations/${r.id}`} className="font-mono text-[13px] font-semibold after:absolute after:inset-0 after:content-['']">{r.reference}</Link> : <span className="font-mono text-[13px] font-semibold">{r.reference}</span>}
                          <p className="truncate text-xs text-muted-foreground">{[t(r.source.name), r.group ? t("Group {name}", { name: r.group.name }) : null].filter(Boolean).join(" · ")}</p>
                        </div>
                        <div className="min-w-0 leading-tight max-md:order-3 max-md:col-span-2">
                          <p className="truncate text-sm">{dayMonth(r.arrivalDate)} → {dayMonth(r.departureDate)}</p>
                          <p className="text-xs text-muted-foreground">{[n ? t.plural(n, "{n} night", "{n} nights") : r.kind === "MEETING" ? t("Meeting") : t("Short stay"), fromDbDate(r.arrivalDate).slice(0, 4)].join(" · ")}</p>
                        </div>
                        <p className="min-w-0 truncate text-sm text-muted-foreground max-md:hidden">{r.rooms.map((x) => `${x.room.number} · ${t(x.roomType.name)}`).join(", ") || "—"}</p>
                        <span className={cn("w-fit shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-semibold max-md:row-start-1 max-md:col-start-2 max-md:justify-self-end", meta.className)}>{t(meta.label)}</span>
                        <div className="text-right leading-tight max-md:order-4 max-md:col-span-2 max-md:text-left">
                          {roomMoney && <p className={cn("text-sm font-medium tabular-nums", done && "text-muted-foreground line-through")}>{formatTZS(r.netAmount)}</p>}
                          {roomMoney && !done && (r.billTo !== "GUEST" ? <p className="text-xs text-muted-foreground">{r.billTo === "GROUP" ? t("Group pays") : t("Company pays")}</p>
                            : r.balanceAmount > 0 ? <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{t("owes {amount}", { amount: formatTZS(r.balanceAmount) })}</p>
                            : r.netAmount > 0 ? <p className="text-xs text-emerald-600 dark:text-emerald-400">{t("paid")}</p> : null)}
                        </div>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
          </Card>

          {/* Everything with us: hotel, restaurant, room service, payments, charges */}
          <EverythingWithUs h={h} roomMoney={roomMoney} canStays={canStays} />

          {/* Online payments (nTZS) — what they paid online, and attempts that did not go through */}
          {online.length > 0 && (
            <Card title={t("Online payments")} count={online.length} sub={t("Paid by mobile money through NTZS — paid online by the customer, or a payment request sent by staff.")}>
              <ul className="divide-y divide-border/60">
                {online.map((m) => (
                  <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5 text-sm">
                    <span className="min-w-0 leading-tight">
                      {m.href ? <Link href={m.href} className="font-medium underline-offset-2 hover:underline">{said(t, m.what)}</Link> : <span className="font-medium">{said(t, m.what)}</span>}
                      <span className="block text-xs text-muted-foreground">{dateTime(m.at)} · {m.online ? t("paid online") : t("sent by staff")}{m.reference ? ` · ${t("ref {reference}", { reference: m.reference })}` : ""}</span>
                    </span>
                    <span className="text-right">
                      <span className="block font-semibold tabular-nums">{formatTZS(m.amount)}</span>
                      <span className={cn("text-[11px] font-semibold", m.status === "COMPLETED" ? "text-emerald-700 dark:text-emerald-300" : m.status === "PENDING" ? "text-sky-700 dark:text-sky-300" : "text-muted-foreground")}>
                        {m.status === "COMPLETED" ? t("Paid") : m.status === "PENDING" ? t("Waiting") : m.status === "FAILED" ? t("Failed") : m.status === "EXPIRED" ? t("Timed out") : t("Cancelled")}
                      </span>
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          )}

          {/* History */}
          <Card title={t("History")} sub={t("Everything that happened with this customer, newest first.")}>
            {events.length === 0 ? <Empty>{t("Nothing yet.")}</Empty> : (
              <ol className="relative ml-7 space-y-3.5 border-l border-border/70 py-4 pl-5 pr-4">
                {events.slice(0, 25).map((e, i) => {
                  const Icon = EVENT_ICON[e.kind];
                  const body = (
                    <>
                      <span className={cn("absolute -left-[2.05rem] top-0 grid size-6 place-items-center rounded-full ring-4 ring-card", EVENT_TONE[e.kind])}><Icon className="size-3" /></span>
                      <p className="text-sm font-medium">{t(e.title)}</p>
                      <p className="text-xs text-muted-foreground">{dateTime(e.at)}{e.detail ? ` · ${e.detail}` : ""}</p>
                    </>
                  );
                  return <li key={i} className="relative">{e.href ? <Link href={e.href} className="block hover:opacity-80">{body}</Link> : body}</li>;
                })}
              </ol>
            )}
          </Card>

          <Card title={t("Requests & trips")} icon={ConciergeBell}>
            {requests.length + trips.length === 0 ? <Empty>{t("Nothing asked yet.")}</Empty> : (
              <ul className="divide-y divide-border/60 border-t border-border/70">
                {[
                  ...requests.map((x) => ({
                    key: x.id, at: x.createdAt, icon: ConciergeBell, title: t(REQUEST_TYPE_LABEL[x.type] ?? x.type), sub: x.description,
                    status: x.status === "COMPLETED" ? t("Done") : x.status === "CANCELLED" ? t("Cancelled") : t.ctx("request", "Open"),
                    tone: x.status === "COMPLETED" ? "text-emerald-600 dark:text-emerald-400" : x.status === "CANCELLED" ? "text-muted-foreground" : "text-amber-600 dark:text-amber-400",
                  })),
                  ...trips.map((x) => ({ key: x.id, at: x.pickupAt, icon: Car, title: t(TRIP_TYPE_LABEL[x.type]), sub: t("{ref} · to {place}", { ref: x.reference, place: x.destination }), status: t(TRIP_STATUS_META[x.status].label), tone: "text-muted-foreground" })),
                ].sort((a, b) => +b.at - +a.at).slice(0, 6).map((x) => (
                  <li key={x.key} className="flex items-center gap-3 px-4 py-2.5 text-sm">
                    <x.icon className="size-4 shrink-0 text-muted-foreground" />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block font-medium">{x.title}</span>
                      <span className="block truncate text-xs text-muted-foreground">{dateTime(x.at)} · {x.sub}</span>
                    </span>
                    <span className={cn("shrink-0 text-xs font-medium", x.tone)}>{x.status}</span>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <aside className="space-y-4 xl:sticky xl:top-24 xl:self-start">
          <GuestDetails rows={details} canEdit={canEdit && !g.deletedAt} canVip={can(user, "reports.view")} canIdentity={canRemove} footprint={footprint} language={g.preferredLanguage} guest={{
            id: g.id, fullName: g.fullName, phone: g.phone ?? "", email: g.email ?? "", idType: g.idType ?? "",
            idNumber: g.idNumber ?? "", nationality: g.nationality ?? "", address: g.address ?? "", notes: g.notes ?? "",
            altPhone: g.altPhone ?? "", dateOfBirth: g.dateOfBirth ? fromDbDate(g.dateOfBirth) : "", preferredChannel: g.preferredChannel ?? "",
            marketingConsent: g.marketingConsent, vip: g.vip, tags: g.tags, preferences: g.preferences ?? "",
          }} />

          {!g.deletedAt && <Card title={t("Contact this customer")} sub={focus ? t("About booking {ref}", { ref: focus.reference }) : undefined}>
            <div className="border-t border-border/70 p-4">
              {options.length > 0 && focus ? (
                <GuestMessenger reservationId={focus.id} guest={{ name: g.fullName, phone: g.phone, email: g.email }} options={options} link={link} language={g.preferredLanguage}
                  sent={messages.filter((m) => m.reservationId === focus.id).map((m) => ({ type: m.type, channel: m.channel, at: m.createdAt.toISOString(), by: m.sentBy?.fullName ?? null }))} />
              ) : (
                <div className="flex flex-wrap gap-2">
                  {g.phone && <a href={`tel:${phone ?? g.phone}`} className={buttonVariants({ variant: "outline", size: "sm" })}><Phone />{t("Call")}</a>}
                  {wa && <a href={wa} target="_blank" rel="noopener" className={buttonVariants({ variant: "outline", size: "sm" })}><MessageCircle />WhatsApp</a>}
                  {phone && <a href={`sms:${phone}`} className={buttonVariants({ variant: "outline", size: "sm" })}><Smartphone />{t("SMS")}</a>}
                  {g.email && <a href={`mailto:${g.email}`} className={buttonVariants({ variant: "outline", size: "sm" })}><Mail />{t("Email")}</a>}
                  {!g.phone && !g.email && <p className="text-sm text-muted-foreground">{t("No phone or email yet — add one with Edit.")}</p>}
                </div>
              )}
            </div>
          </Card>}

          <Card title={t("Messages sent")} count={messages.length}>
            {messages.length === 0 ? <Empty>{t("No messages yet.")}</Empty> : (
              <ul className="divide-y divide-border/60 border-t border-border/70">
                {messages.slice(0, 12).map((m) => (
                  <li key={m.id}>
                    <details className="group px-4 py-2.5">
                      <summary className="flex cursor-pointer list-none items-center gap-2.5">
                        <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg", m.status === "FAILED" ? "bg-rose-500/12 text-rose-600" : "bg-emerald-500/12 text-emerald-600 dark:text-emerald-400")}>
                          {m.channel === "EMAIL" ? <Mail className="size-3.5" /> : m.channel === "SMS" ? <Smartphone className="size-3.5" /> : <MessageCircle className="size-3.5" />}
                        </span>
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className="block text-sm font-medium">{t(GUEST_MESSAGE_TYPES[m.type as GuestMessageType] ?? m.type)}</span>
                          <span className="block truncate text-xs text-muted-foreground">{t(CHANNEL[m.channel] ?? m.channel)} · {dateTime(m.createdAt)}{m.sentBy ? ` · ${m.sentBy.fullName}` : ""}</span>
                        </span>
                      </summary>
                      <p className="mt-2 whitespace-pre-line border-t border-dashed border-border pt-2 text-xs text-muted-foreground">{m.body}</p>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </aside>
      </div>
    </div>
  );
}

const EVENT_ICON = { booking: CalendarPlus, checkin: LogIn, checkout: LogOut, cancel: CalendarX2, message: MessageCircle, change: Pencil, order: UtensilsCrossed, billing: BedDouble } as const;
const EVENT_TONE = {
  booking: "bg-sky-500/15 text-sky-700 dark:text-sky-300", checkin: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300",
  checkout: "bg-violet-500/15 text-violet-700 dark:text-violet-300", cancel: "bg-rose-500/15 text-rose-700 dark:text-rose-300",
  message: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300", change: "bg-muted text-muted-foreground",
  order: "bg-amber-500/15 text-amber-700 dark:text-amber-300", billing: "bg-violet-500/15 text-violet-700 dark:text-violet-300",
} as const;

function NowRow({ icon: Icon, tone, title, sub, action }: { icon: typeof Phone; tone: string; title: string; sub: string; action?: React.ReactNode }) {
  return (
    <li className="flex items-center gap-3 px-4 py-3">
      <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl bg-muted/60", tone)}><Icon className="size-4" /></span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block font-medium">{title}</span>
        <span className="block truncate text-xs text-muted-foreground">{sub}</span>
      </span>
      {action}
    </li>
  );
}

function Card({ title, sub, count, icon: Icon, children }: { title: string; sub?: string; count?: number; icon?: typeof Phone; children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card">
      <div className="px-4 py-3">
        <h2 className="flex items-center gap-2 text-base font-semibold">{Icon && <Icon className="size-4 text-muted-foreground" />}{title}{count != null && <span className="font-normal text-muted-foreground">· {count}</span>}</h2>
        {sub && <p className="mt-0.5 text-sm text-muted-foreground">{sub}</p>}
      </div>
      {children}
    </section>
  );
}

const Empty = ({ children }: { children: React.ReactNode }) => <p className="border-t border-border/70 px-4 py-8 text-center text-sm text-muted-foreground">{children}</p>;

function Figure({ label, value, sub, tone, className }: { label: string; value: string; sub?: string; tone?: "good" | "bad"; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className={cn("mt-1 truncate text-xl font-semibold tabular-nums", tone === "good" && "text-emerald-600 dark:text-emerald-400", tone === "bad" && "text-rose-600 dark:text-rose-400")}>{value}</p>
      {sub && <p className="text-xs text-muted-foreground">{sub}</p>}
    </div>
  );
}
