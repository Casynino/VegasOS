import Link from "next/link";
import { billMenu } from "@/server/services/restaurant";
import { recentChargeItems } from "@/server/services/payments";
import { discountLimit } from "@/lib/discounts";
import { AlertTriangle, ArrowRight, Banknote, BedDouble, BedSingle, CalendarPlus, Car, CheckCircle2, ChevronRight, Clock, ConciergeBell, Inbox, KeyRound, LogIn, LogOut, Luggage, NotebookTabs, Plane, QrCode, Receipt, Sunrise, Users, Wallet, Wrench } from "lucide-react";
import { REQUEST_TYPE_LABEL } from "@/lib/request-meta";
import { mobilePaymentsNeedingAttention } from "@/server/services/mobile-payments";
import { can, getMyOpenShift, requireUser } from "@/server/auth";
import { needsOwnShift } from "@/lib/permissions";
import { businessToday, getSettings } from "@/server/settings";
import { getArrivalsSummary, getFrontDeskSnapshot, getReceptionBoard } from "@/server/services/front-desk";
import { ArrivalsSummary } from "@/components/staff/reception/arrivals-summary";
import { TodayStrip, type TodayPart } from "@/components/staff/reception/today-strip";
import { GuestsOwing } from "@/components/staff/reception/guests-owing";
import { inHouseBalances } from "@/server/services/guest-balances";
import { getShiftOverview } from "@/server/services/shifts";
import { formatTZS } from "@/lib/format";
import { addDays, toDbDate } from "@/lib/time/business-date";
import { DepartureButton } from "@/components/staff/reception/arrival-card";
import { CheckOutButton } from "@/components/staff/reception/check-out-dialog";
import { ReceptionSearch } from "@/components/staff/reception/search";
import { cn } from "@/lib/utils";
import { ShiftControls } from "@/components/staff/shift-controls";
import { AttentionCards, BarList, HeroBanner, PairBars, Panel, PanelLink, Pill, QuickActions, SectionLabel, type AttentionItem } from "@/components/dashboard/kit";
import { Donut } from "@/components/dashboard/light-charts";
import { RoomGrid } from "@/components/staff/rooms/room-grid";
import { getRoomBoard } from "@/server/services/rooms";
import { listGroups } from "@/server/services/groups";
import { db } from "@/server/db";
import { accountOptions } from "@/server/services/payment-accounts";
import { buttonVariants } from "@/components/ui/button";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";

/**
 * Reception — the hotel's operational centre. Ordered by what the desk does
 * next: today's numbers, quick actions, arrivals (one-click ASSIGN & CHECK IN),
 * departures, who is in house, room issues. Checking in itself happens on /staff/check-in.
 */
const LOBBY = "/images/lobby/lobby-01.webp";

export async function FrontDeskToday() {
  const user = await requireUser();
  const t = await getT();
  const today = await businessToday();
  // A receptionist works under their own shift (the page gate sends them to "Start shift" without one).
  const worksShift = needsOwnShift(user.permissions);
  const [snap, board, shift, myShift] = await Promise.all([getFrontDeskSnapshot(today), getReceptionBoard(today), getShiftOverview(today), worksShift ? getMyOpenShift(user.id) : null]);
  const [arrivalsToday, balances, groupsToday] = await Promise.all([getArrivalsSummary(today), inHouseBalances(today), listGroups({ view: "today", today, take: 12 })]);
  // Two receptionists may work together: Start is locked only when both places are taken by others.
  const others = shift.openAll.filter((o) => o.userId !== user.id);
  const lockedBy = !myShift && shift.full ? others.map((o) => o.user.fullName.split(" ")[0]).join(" and ") : null;
  const colleague = myShift ? others[0] ?? null : null;
  // Guest rooms only: meeting room bookings are not guests in the hotel (see the Meeting room page).
  const stays = snap.inHouse.filter((r) => r.kind === "STAY");
  const guestsInHouse = stays.reduce((s, r) => s + r.rooms.filter((x) => x.status === "CHECKED_IN").reduce((a, x) => a + x.adults + x.children, 0), 0);
  const roomsInHouse = stays.reduce((s, r) => s + r.rooms.filter((x) => x.status === "CHECKED_IN").length, 0);
  const canCheckIn = can(user, "reservations.check_in");
  const todayDb = toDbDate(today);
  const now = new Date();
  const LIVE_STATUS = { notIn: ["CANCELLED", "NO_SHOW", "INQUIRY"] as ("CANCELLED" | "NO_SHOW" | "INQUIRY")[] };
  const from14 = toDbDate(addDays(today, -13));
  const [roomBoard, ins, outs, nights, methods] = await Promise.all([
    getRoomBoard(today),
    db.reservationRoom.groupBy({ by: ["arrivalDate"], where: { arrivalDate: { gte: from14, lte: todayDb }, status: LIVE_STATUS }, _count: true }),
    db.reservationRoom.groupBy({ by: ["departureDate"], where: { departureDate: { gte: from14, lte: todayDb }, status: LIVE_STATUS }, _count: true }),
    Promise.all(Array.from({ length: 7 }, (_, i) => {
      const d = toDbDate(addDays(today, i));
      return db.reservationRoom.count({ where: { arrivalDate: { lte: d }, departureDate: { gt: d }, status: { in: ["RESERVED", "CONFIRMED", "CHECKED_IN"] } } });
    })),
    accountOptions("payments"),
  ]);
  // Room cards: food & drinks from the menu and other extras go on a guest's bill right there.
  const [billForRooms, recentExtras] = await Promise.all([
    can(user, "restaurant.orders") ? billMenu() : null,
    can(user, "payments.record") ? recentChargeItems() : [],
  ]);
  const guestRooms = roomBoard.filter((r) => r.roomType.category === "GUEST_ROOM");
  // Check out right from "Leaving today": the guest's room on the board (its stay and the next guest due in it).
  const dLimit = discountLimit(user.permissions, await getSettings());
  const outPerms = { pay: can(user, "payments.record"), order: can(user, "restaurant.orders"), orderPayNow: can(user, "revenue.record"), discount: dLimit > 0, discountMax: dLimit };
  const boardStay = (reservationId: string) => roomBoard.find((x) => x.currentStay?.reservationId === reservationId) ?? null;
  const byState = (...st: string[]) => guestRooms.filter((r) => st.includes(r.displayStatus)).length;
  const sellable = guestRooms.length - byState("MAINTENANCE", "OUT_OF_SERVICE");
  // How far the day has got, for the band at the top.
  const [arrivedToday, leftToday] = await Promise.all([
    db.reservation.count({ where: { kind: "STAY", arrivalDate: todayDb, status: { in: ["CHECKED_IN", "CHECKED_OUT"] } } }),
    db.reservation.count({ where: { kind: "STAY", departureDate: todayDb, status: "CHECKED_OUT" } }),
  ]);
  const toClean = byState("DIRTY", "CLEANING"), blocked = byState("MAINTENANCE", "OUT_OF_SERVICE");
  // What the desk takes care of next: guests' open requests, the cars of the next 24 hours, and tomorrow.
  const tomorrowDb = toDbDate(addDays(today, 1));
  const OPEN_TRIP = ["REQUESTED", "CONFIRMED", "ASSIGNED", "EN_ROUTE", "PICKED_UP"] as ("REQUESTED" | "CONFIRMED" | "ASSIGNED" | "EN_ROUTE" | "PICKED_UP")[];
  const [openRequests, requestCount, trips, arrivingTomorrow, leavingTomorrow] = await Promise.all([
    can(user, "requests.view")
      ? db.serviceRequest.findMany({
        where: { status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS"] } }, orderBy: [{ createdAt: "asc" }], take: 8,
        select: { id: true, type: true, status: true, priority: true, source: true, description: true, createdAt: true, room: { select: { number: true } }, guest: { select: { fullName: true } }, assignedTo: { select: { fullName: true } } },
      })
      : [],
    can(user, "requests.view") ? db.serviceRequest.count({ where: { status: { in: ["NEW", "ASSIGNED", "IN_PROGRESS"] } } }) : 0,
    can(user, "transport.view") || can(user, "transport.request") || can(user, "transport.manage")
      ? db.transportTrip.findMany({
        where: { status: { in: OPEN_TRIP }, pickupAt: { gte: new Date(now.getTime() - 2 * 3_600_000), lt: new Date(now.getTime() + 24 * 3_600_000) } }, orderBy: { pickupAt: "asc" }, take: 8,
        select: { id: true, type: true, status: true, pickupAt: true, passengerName: true, pickupLocation: true, destination: true, flightNumber: true, driverName: true, driverId: true, roomNumber: true },
      })
      : null,
    db.reservation.findMany({
      where: { kind: "STAY", arrivalDate: tomorrowDb, status: { in: ["RESERVED", "CONFIRMED", "INQUIRY"] } }, orderBy: [{ eta: "asc" }, { createdAt: "asc" }], take: 30,
      select: { id: true, eta: true, balanceAmount: true, status: true, guest: { select: { fullName: true } }, rooms: { where: { status: { not: "CANCELLED" } }, select: { roomType: { select: { name: true } }, room: { select: { number: true } } } } },
    }),
    db.reservation.count({ where: { kind: "STAY", status: "CHECKED_IN", departureDate: tomorrowDb } }),
  ]);
  const tomorrowRooms = arrivingTomorrow.reduce((t, r) => t + r.rooms.length, 0);
  // Mobile money (nTZS) that came in but did not fit the bill — someone must deal with it.
  const mobileToCheck = can(user, "payments.record") ? (await mobilePaymentsNeedingAttention()).length : 0;
  // The Hotel QR today: bookings guests made from it (pay now and pay later), and those arriving today not paid yet.
  const [qrToday, qrToPay] = can(user, "reservations.view") ? await Promise.all([
    db.reservation.count({ where: { source: { code: "HOTEL_QR" }, businessDate: todayDb } }),
    db.reservation.count({ where: { source: { code: "HOTEL_QR" }, arrivalDate: todayDb, status: { in: ["RESERVED", "INQUIRY"] }, paidAmount: { lte: 0 } } }),
  ]) : [0, 0];
  const todayParts: TodayPart[] = [
    { label: t("Arrivals"), icon: <LogIn />, tone: "sky", href: "/staff/check-in", value: board.arrivals.length, unit: t("to check in"),
      done: arrivedToday, of: arrivedToday + board.arrivals.length, note: arrivedToday + board.arrivals.length ? t("{n} of {total} checked in", { n: arrivedToday, total: arrivedToday + board.arrivals.length }) : t("Nobody due today") },
    { label: t("Departures"), icon: <LogOut />, tone: "rose", href: "/staff/check-out", value: snap.departures.length, unit: t("to check out"),
      done: leftToday, of: leftToday + snap.departures.length, note: leftToday + snap.departures.length ? t("{n} of {total} checked out", { n: leftToday, total: leftToday + snap.departures.length }) : t("Nobody leaving today") },
    { label: t("In the hotel"), icon: <Users />, tone: "emerald", href: "/staff/reservations?view=inhouse", value: guestsInHouse, unit: guestsInHouse === 1 ? t("guest") : t("guests"),
      done: roomsInHouse, of: sellable, note: t("{n} of {total} rooms · {pct}% full", { n: roomsInHouse, total: sellable, pct: sellable ? Math.round((roomsInHouse / sellable) * 100) : 0 }) },
    { label: t("Free tonight"), icon: <BedSingle />, tone: "violet", href: "/staff/rooms", value: board.tonightFree ?? "—", unit: board.tonightFree === 1 ? t("room") : t("rooms"),
      done: board.tonightFree ?? 0, of: sellable, note: [toClean && t("{n} to clean", { n: toClean }), blocked && t("{n} under maintenance", { n: blocked })].filter(Boolean).join(" · ") || t("Ready to sell") },
  ];
  const days14 = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  // What each staying guest owes, as the Guests owing table counts it (a group pays its rooms; never below 0).
  const owedBy = new Map(balances.rows.map((x) => [x.reservationId, x.outstanding]));
  const owes = (r: { id: string; balanceAmount: number }) => owedBy.get(r.id) ?? Math.max(0, r.balanceAmount);
  const owing = snap.departures.filter((r) => owes(r) > 0);
  const overdue = snap.departures.filter((r) => r.rooms.some((x) => x.status === "CHECKED_IN" && x.endAt <= new Date()));
  // The area chips (group) are in the reader's language: the same words group the rows.
  const newRequests = openRequests.filter((q) => q.status === "NEW").length;
  const attention: AttentionItem[] = [
    overdue.length > 0 && { tone: "rose", icon: <Clock />, group: t("Check-out"), title: t.plural(overdue.length, "{n} checkout overdue", "{n} checkouts overdue"), detail: t("Past checkout time with no extension — check out or extend"), href: `/staff/check-out?id=${overdue[0].id}#workspace` },
    (worksShift ? !myShift : !shift.open) && { tone: "amber", icon: <AlertTriangle />, group: t("Shift"), title: worksShift ? t("You have no active shift") : t("No reception shift started"), detail: worksShift ? t("Start your shift before working the desk") : t("Nobody is on reception right now"), href: "#shift" },
    qrToPay > 0 && { tone: "gold", icon: <QrCode />, group: t("Bookings"), title: t.plural(qrToPay, "{n} Hotel QR booking arriving today not paid yet", "{n} Hotel QR bookings arriving today not paid yet"), detail: t("Not paid — the room is held only once paid. Take the payment at check-in (any free room)"), href: "/staff/hotel-qr?list=arriving#bookings" },
    board.requestsDue.length > 0 && { tone: "gold", icon: <Inbox />, group: t("Bookings"), title: t.plural(board.requestsDue.length, "{n} online request for today not confirmed", "{n} online requests for today not confirmed"), detail: t("Call the guest and confirm the booking"), href: "/staff/booking-requests" },
    owing.length > 0 && { tone: "rose", icon: <Wallet />, group: t("Money"), title: t.plural(owing.length, "{n} leaving today still owes money", "{n} leaving today still owe money"), detail: t("{amount} to collect before checkout", { amount: formatTZS(owing.reduce((s, r) => s + owes(r), 0)) }), href: "/staff/check-out" },
    snap.unpaidAfterCheckout.count > 0 && { tone: "rose", icon: <Receipt />, group: t("Money"), title: t("{n} unpaid after checkout", { n: snap.unpaidAfterCheckout.count }), detail: t("Past guests with an open balance"), href: "#unpaid" },
    snap.maintenance.length > 0 && { tone: "slate", icon: <Wrench />, group: t("Rooms"), title: t.plural(snap.maintenance.length, "{n} room under maintenance", "{n} rooms under maintenance"), detail: t("Not available to sell"), href: "/staff/rooms" },
    mobileToCheck > 0 && { tone: "rose", icon: <Wallet />, group: t("Money"), title: t.plural(mobileToCheck, "{n} mobile-money payment to check", "{n} mobile-money payments to check"), detail: t("Came in by nTZS but did not fit the bill — refund or apply it"), href: "/staff/collections#ntzs" },
    newRequests > 0 && { tone: "gold", icon: <ConciergeBell />, group: t.ctx("area", "Guests"), title: t.plural(newRequests, "{n} guest request waiting", "{n} guest requests waiting"), detail: t("Nobody has accepted yet — open it and tap Accept"), href: "#requests" },
  ].filter(Boolean) as AttentionItem[];
  const firstName = user.fullName.split(" ")[0];
  const dayPart = greeting();

  return (
    <div className="w-full space-y-6">
      <HeroBanner
        image={LOBBY}
        eyebrow={t("Front office · {role}", { role: t(user.roleName) })}
        title={dayPart === "morning" ? t("Good morning, {name}", { name: firstName }) : dayPart === "afternoon" ? t("Good afternoon, {name}", { name: firstName }) : t("Good evening, {name}", { name: firstName })}
        subtitle={t.rich("<b>{in}</b> to check in · <b>{out}</b> to check out today", { b: (c) => <strong className="font-semibold text-white">{c}</strong> }, { in: board.arrivals.length, out: snap.departures.length })}
      />
      <ReceptionSearch className="w-full md:hidden" />

      {/* The quick actions — and my shift as one small switch at the end (like the waiter's): "Since 16:19", tap to end. */}
      <div id="shift" className="flex scroll-mt-24 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 basis-full md:basis-0 md:flex-1">
      <QuickActions t={t} items={([
        { href: "/staff/reservations/new", label: t("New booking"), hint: t("Walk-in or reserve"), icon: <CalendarPlus />, tone: "gold", perm: "reservations.create" },
        { href: "/staff/reservations", label: t("Reservations"), hint: t("All bookings"), icon: <NotebookTabs />, tone: "amber", perm: "reservations.view" },
        { href: "/staff/hotel-qr", label: t("Hotel QR"), hint: qrToday ? t("{n} booked from the QR today", { n: qrToday }) : t("Show · print · QR bookings"), icon: <QrCode />, tone: "violet", perm: "reservations.view", badge: qrToday },
        { href: "/staff/check-in", label: t("Check in"), hint: board.arrivals.length ? t("{n} arriving today", { n: board.arrivals.length }) : t("Hand over the key"), icon: <KeyRound />, tone: "emerald", perm: "reservations.check_in", badge: board.arrivals.length },
        { href: "/staff/check-out", label: t("Check out"), hint: snap.departures.length ? t("{n} leaving today", { n: snap.departures.length }) : t("Settle the bill"), icon: <Luggage />, tone: "rose", perm: "reservations.check_out", badge: snap.departures.length },
        { href: "/staff/rooms", label: t("Rooms"), hint: t("Board & cleaning"), icon: <BedDouble />, tone: "sky", perm: "rooms.view" },
        { href: "/staff/requests", label: t("Guest request"), hint: t("Room service & needs"), icon: <ConciergeBell />, tone: "violet", perm: "requests.view" },
        { href: "/staff/expenses", label: t("Expense"), hint: t("Money paid out"), icon: <Banknote />, tone: "teal", perm: "expenses.record" },
      ] as const).filter((a) => can(user, a.perm as never)).map((a) => ({ href: a.href, label: a.label, hint: a.hint, icon: a.icon, tone: a.tone, badge: "badge" in a ? a.badge : undefined })).slice()} />
        </div>
        {worksShift ? (
          <span className="flex items-center gap-1.5">
            {colleague && <span className="hidden text-xs text-muted-foreground sm:inline">{t.ctx("shift", "with {name}", { name: colleague.user.fullName.split(" ")[0] })}</span>}
            <ShiftControls variant="switch" myShiftOpen={!!myShift} since={myShift ? t.time(myShift.startedAt) : null} otherOpenBy={lockedBy}
              scheduledName={shift.scheduledToday?.scheduledUser.fullName ?? null} isScheduled={shift.scheduledToday?.scheduledUserId === user.id} />
            {/* Her shift so far: what she did and collected in it */}
            {myShift && <Link href={`/staff/shifts/${myShift.id}`} className="inline-flex h-9 items-center gap-1 rounded-full border border-border px-3 text-sm font-medium hover:bg-muted">{t("My shift")}<ArrowRight className="size-3.5" /></Link>}
          </span>
        ) : (
          // Managers and the MD supervise: who is on reception now, in one small pill.
          <Link href="/staff/shifts" className={cn("inline-flex h-9 min-w-0 max-w-full items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors hover:bg-muted/50", shift.openAll.length ? "border-emerald-500/40" : "border-amber-500/40 text-amber-700 dark:text-amber-300")}>
            <span className={cn("size-2 shrink-0 rounded-full", shift.openAll.length ? "bg-emerald-500" : "bg-amber-500")} />
            {shift.openAll.length ? <><span className="hidden shrink-0 sm:inline">{t("On reception:")}</span> <strong className="min-w-0 truncate font-semibold">{shift.openAll.map((o) => `${o.user.fullName.split(" ")[0]} ${t.time(o.startedAt)}`).join(" · ")}</strong></> : t("Nobody on reception")}
          </Link>
        )}
      </div>

      <TodayStrip parts={todayParts} />

      <div>
        <SectionLabel title={t("Needs your attention")} count={attention.length} t={t} />
        <AttentionCards items={attention} emptyDetail={t("No unpaid departures, no unconfirmed requests, no room problems.")} t={t} />
      </div>

      <div>
        <SectionLabel title={t("Guests owing")} count={balances.summary.owingCount} href="/staff/shifts" linkLabel={t("Shift handover")} t={t} />
        <GuestsOwing b={balances} canPay={can(user, "payments.record")} show={3} methods={methods} />
      </div>

      {groupsToday.length > 0 && (
        <div>
          <SectionLabel title={t("Groups arriving today")} count={groupsToday.length} href="/staff/groups" linkLabel={t("All groups")} t={t} />
          <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {groupsToday.map((g) => (
              <li key={g.id}>
                <Link href={`/staff/groups/${g.id}`} className="block rounded-2xl border border-border/70 bg-card p-3.5 transition-colors hover:bg-muted/40">
                  <p className="flex items-center justify-between gap-2"><strong className="truncate">{g.name}</strong><span className="shrink-0 text-xs text-muted-foreground">{t.plural(g.rooms, "{n} room", "{n} rooms")}</span></p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{t("{done}/{rooms} checked in · {pending} pending · pays: {payer}", { done: g.checkedIn + g.checkedOut, rooms: g.rooms, pending: g.pending, payer: g.payer })}</p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${g.rooms ? Math.round(((g.checkedIn + g.checkedOut) / g.rooms) * 100) : 0}%` }} /></div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <SectionLabel title={t("Arrivals today")} href="/staff/check-in" linkLabel={t("Check in")} t={t} />
        <ArrivalsSummary s={arrivalsToday} today={today} canCheckIn={canCheckIn} />
      </div>


      {/* THE DESK, IN SHAPE */}
      <div>
        <SectionLabel title={t("The desk, in shape")} href="/staff/reports" linkLabel={t("Reports")} t={t} />
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title={t("Rooms right now")} subtitle={t("What every room is doing")}>
            <Donut format="count" center={{ label: t("rooms"), value: String(roomBoard.length) }}
              colors={["#10b981", "#0ea5e9", "#f59e0b", "#f97316", "#8b5cf6", "#f43f5e"]}
              data={[
                { name: t.ctx("room", "Available"), value: byState("AVAILABLE", "READY") }, { name: t("Occupied"), value: byState("OCCUPIED") },
                { name: t("Arriving today"), value: byState("RESERVED") }, { name: t("Needs cleaning"), value: byState("DIRTY") },
                { name: t("Being cleaned"), value: byState("CLEANING") }, { name: t("Maintenance"), value: byState("MAINTENANCE", "OUT_OF_SERVICE") },
              ]} />
          </Panel>
          <Panel title={t("Arrivals & departures")} subtitle={t("Rooms in and out, last 14 days")}>
            <PairBars a={{ name: t("Arrivals"), color: "#0ea5e9" }} b={{ name: t("Departures"), color: "#f43f5e" }}
              data={days14.map((d) => ({
                label: d.slice(8), today: d === today,
                a: ins.find((x) => x.arrivalDate.toISOString().slice(0, 10) === d)?._count ?? 0,
                b: outs.find((x) => x.departureDate.toISOString().slice(0, 10) === d)?._count ?? 0,
              }))} />
          </Panel>
          <Panel title={t("The next 7 nights")} subtitle={t("Rooms booked or occupied each night")}>
            <BarList rows={nights.map((n, i) => ({
              label: i === 0 ? t("Tonight") : i === 1 ? t("Tomorrow") : t.date(addDays(today, i)),
              value: n, max: sellable, highlight: i === 0,
            }))} />
          </Panel>
        </div>
      </div>

      {/* ROOM BOARD */}
      <Panel title={<span className="flex items-center gap-2"><BedDouble className="size-4 text-muted-foreground" />{t("Rooms")}</span>}
        subtitle={t("Every room at a glance — click a room for check in, check out, cleaning and more")} action={<PanelLink href="/staff/rooms">{t("Room board")}</PanelLink>}>
        <RoomGrid rooms={roomBoard} today={today} methods={methods} menu={billForRooms} recent={recentExtras}
          perms={{ transport: can(user, "transport.request") || can(user, "transport.manage"), order: can(user, "restaurant.orders"), orderPayNow: can(user, "revenue.record"), pay: can(user, "payments.record"), update: can(user, "rooms.status.update"), block: can(user, "rooms.block"), checkIn: canCheckIn, checkOut: can(user, "reservations.check_out"), book: can(user, "reservations.create"), discount: discountLimit(user.permissions, await getSettings()) > 0, discountMax: discountLimit(user.permissions, await getSettings()),
            move: can(user, "reservations.edit") }} />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* ARRIVING TODAY — compact; the full check-in happens on the Check-in page */}
        <Panel className="scroll-mt-20" title={<span id="arrivals" className="flex items-center gap-2"><LogIn className="size-4 text-sky-500" />{t("Arriving today")} <span className="text-sm font-normal text-muted-foreground">({board.arrivals.length})</span></span>}
          action={<PanelLink href="/staff/check-in">{t("Check-in desk")}</PanelLink>}>
          {board.arrivals.length === 0 ? <p className="text-sm text-muted-foreground">{t("Everyone due today is checked in.")}</p> : (
            <ul className={FIVE_ROWS}>
              {board.arrivals.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-3">
                  <RoomTile number={r.rooms.map((x) => x.current.number).join("·")} tone="amber" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{r.guest.fullName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{r.rooms.map((x) => `${t(x.roomTypeName)} · ${x.current.number}`).join(", ")}{r.eta ? ` · ${t("around {time}", { time: r.eta })}` : ""}</span>
                  </span>
                  {r.status === "INQUIRY" ? <Pill kind="OWES">{t("Not paid · room not held")}</Pill> : r.balanceAmount > 0 ? <Pill kind="OWES">{t("Owes {amount}", { amount: formatTZS(r.balanceAmount) })}</Pill> : <Pill kind="PAID">{t("Paid")}</Pill>}
                  {canCheckIn && <Link href={`/staff/check-in?id=${r.id}#workspace`} className={buttonVariants({ size: "sm" })}>{t("Check in")}</Link>}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* LEAVING TODAY */}
        <Panel className="scroll-mt-20" title={<span id="departures" className="flex items-center gap-2"><LogOut className="size-4 text-rose-500" />{t("Leaving today")} <span className="text-sm font-normal text-muted-foreground">({snap.departures.length})</span></span>}>
          {snap.departures.length === 0 ? <p className="text-sm text-muted-foreground">{t("No one left to check out today.")}</p> : (
            <ul className={FIVE_ROWS}>
              {snap.departures.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-3">
                  <RoomTile number={r.rooms.filter((x) => x.status === "CHECKED_IN").map((x) => x.room.number).join("·")} tone={overdue.includes(r) ? "rose" : "sky"} />
                  <Link href={`/staff/check-out?id=${r.id}#workspace`} className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{r.guest.fullName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {t("Room {room}", { room: r.rooms.filter((x) => x.status === "CHECKED_IN").map((x) => x.room.number).join(", ") })} · {overdue.includes(r) ? <span className="font-semibold text-rose-600 dark:text-rose-400">{t("overdue since {time}", { time: t.time(r.rooms.find((x) => x.status === "CHECKED_IN")?.endAt ?? new Date()) })}</span> : t("due {time}", { time: t.time(r.rooms.find((x) => x.status === "CHECKED_IN")?.endAt ?? new Date()) })}
                    </span>
                  </Link>
                  {owes(r) > 0 ? <Pill kind="OWES">{t("Owes {amount}", { amount: formatTZS(owes(r)) })}</Pill> : <Pill kind="PAID">{owedBy.get(r.id) === 0 && r.balanceAmount > 0 ? t("Billed to the group") : t("Paid")}</Pill>}
                  {can(user, "reservations.check_out") && (() => {
                    const b = boardStay(r.id);
                    return b?.currentStay
                      ? <CheckOutButton stay={b.currentStay} roomNumber={b.number} nextGuest={b.upcoming.find((u) => u.arrivalDate === today)?.guest.fullName ?? null} methods={methods} perms={outPerms} menu={billForRooms} recent={recentExtras} />
                      : <DepartureButton id={r.id} />;
                  })()}
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {/* IN THE HOTEL NOW */}
      <Panel className="scroll-mt-20" title={<span id="in-house" className="flex items-center gap-2"><Users className="size-4 text-emerald-500" />{t("In the hotel now")} <span className="text-sm font-normal text-muted-foreground">({snap.inHouse.length})</span></span>}
        action={<PanelLink href="/staff/reservations?view=inhouse">{t("All")}</PanelLink>}>
        {snap.inHouse.length === 0 ? <p className="text-sm text-muted-foreground">{t("No guests in the hotel.")}</p> : (
          <ul className="grid max-h-[22rem] gap-3 overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin] sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
            {snap.inHouse.map((r) => {
              const live = r.rooms.filter((x) => x.status === "CHECKED_IN");
              const out = live.reduce((m, x) => (x.endAt > m ? x.endAt : m), live[0]?.endAt ?? r.departureDate);
              const late = live.some((x) => x.endAt <= now);
              const leavingToday = r.departureDate <= todayDb;
              return (
                <li key={r.id}>
                  <Link href={`/staff/check-out?id=${r.id}#workspace`} className={cn("flex h-full items-center gap-3 rounded-2xl border p-3 transition-all hover:-translate-y-0.5 hover:shadow-[0_12px_24px_-18px_rgba(15,23,42,0.5)]",
                    late ? "border-rose-500/40 bg-rose-500/[0.05]" : leavingToday ? "border-amber-500/40 bg-amber-500/[0.05]" : "border-border/70 bg-card")}>
                    <RoomTile number={live.map((x) => x.room.number).join("·")} tone={late ? "rose" : leavingToday ? "amber" : "emerald"} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-semibold">{r.guest.fullName}</span>
                      <span className={cn("block truncate text-xs", late ? "font-semibold text-rose-600 dark:text-rose-400" : leavingToday ? "text-amber-700 dark:text-amber-400" : "text-muted-foreground")}>
                        {late ? t("Overdue since {time}", { time: t.time(out) }) : leavingToday ? t("Leaves today · {time}", { time: t.time(out) }) : t("Out {date}", { date: t.date(r.departureDate.toISOString().slice(0, 10)) })}
                      </span>
                    </span>
                    <span className={cn("shrink-0 text-xs font-semibold tabular-nums", owes(r) > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
                      {owes(r) > 0 ? formatTZS(owes(r)).replace("TZS ", "") : t("Paid")}
                    </span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </Panel>

      {/* WHAT COMES NEXT — guests' requests, the cars, tomorrow, and money still owed from past stays */}
      <div className="grid items-start gap-4 lg:grid-cols-2">
        {can(user, "requests.view") && (
          <Panel className="scroll-mt-20"
            title={<span id="requests" className="flex items-center gap-2"><ConciergeBell className="size-4 text-violet-500" />{t("Guest requests")}{requestCount > 0 && <span className="text-sm font-normal text-muted-foreground">({t("{n} open", { n: requestCount })})</span>}</span>}
            subtitle={requestCount > 0 ? t("Accept one and mark it done when it is handled") : undefined} action={<PanelLink href="/staff/requests">{t.ctx("nav", "Requests")}</PanelLink>}>
            {openRequests.length === 0 ? (
              <p className="flex items-center gap-2.5 rounded-2xl bg-emerald-500/[0.07] px-3.5 py-3 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-4 shrink-0" />{t("Nothing waiting — every guest request is handled.")}</p>
            ) : (
              <ul className={FIVE_ROWS}>
                {openRequests.map((q) => {
                  const who = q.assignedTo?.fullName.replace(/\s*\(.*\)/, "").split(" ")[0];
                  return (
                    <li key={q.id}>
                      <Link href="/staff/requests" className="flex items-center gap-3 py-2.5 transition-colors hover:text-foreground">
                        <RoomTile number={q.room?.number ?? ""} tone={q.status === "NEW" ? "amber" : "sky"} />
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className="block truncate text-sm font-semibold">{REQUEST_TYPE_LABEL[q.type] ? t(REQUEST_TYPE_LABEL[q.type]) : t("Request")}{(q.priority === "HIGH" || q.priority === "URGENT") && <span className="ml-1.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">{q.priority === "URGENT" ? t("Urgent") : t("High")}</span>}</span>
                          <span className="block truncate text-xs text-muted-foreground">{q.description}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">{q.guest?.fullName ?? (q.source === "STAFF" ? t("Logged at the desk") : t("From the guest's phone"))} · {ago(q.createdAt, now, t)}</span>
                        </span>
                        <Pill kind={q.status === "NEW" ? "OWES" : q.status === "IN_PROGRESS" ? "PAID" : "CONFIRMED"}>{q.status === "NEW" ? t.ctx("request", "New") : q.status === "IN_PROGRESS" ? (who ? t("{name} on it", { name: who }) : t("Someone on it")) : who ? t("For {name}", { name: who }) : t("For someone")}</Pill>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        )}

        {trips && (
          <Panel className="scroll-mt-20"
            title={<span id="transport" className="flex items-center gap-2"><Car className="size-4 text-orange-500" />{t("Transport · next 24 hours")}{trips.length > 0 && <span className="text-sm font-normal text-muted-foreground">({trips.length})</span>}</span>}
            action={<PanelLink href="/staff/transport">{t("Transport")}</PanelLink>}>
            {trips.length === 0 ? <p className="text-sm text-muted-foreground">{t("No pickup or drop-off in the next 24 hours.")}</p> : (
              <ul className={FIVE_ROWS}>
                {trips.map((trip) => {
                  const driver = trip.driverName || trip.driverId;
                  const late = trip.pickupAt < now && (trip.status === "REQUESTED" || trip.status === "CONFIRMED" || trip.status === "ASSIGNED");
                  return (
                    <li key={trip.id}>
                      <Link href="/staff/transport" className="flex items-center gap-3 py-2.5 transition-colors hover:text-foreground">
                        <span className={cn("grid h-11 min-w-14 shrink-0 place-items-center rounded-xl px-1.5 text-sm font-bold tabular-nums", late ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : "bg-orange-500/15 text-orange-700 dark:text-orange-300")}>{t.time(trip.pickupAt)}</span>
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className="flex items-center gap-1.5 truncate text-sm font-semibold">{trip.type.startsWith("AIRPORT") && <Plane className="size-3.5 shrink-0 text-muted-foreground" />}{trip.passengerName}{trip.roomNumber && <span className="text-xs font-normal text-muted-foreground">· {t("room {room}", { room: trip.roomNumber })}</span>}</span>
                          <span className="block truncate text-xs text-muted-foreground">{trip.pickupLocation} → {trip.destination}{trip.flightNumber ? ` · ${trip.flightNumber}` : ""}</span>
                        </span>
                        <Pill kind={driver ? "PAID" : "OWES"}>{trip.status === "EN_ROUTE" ? t("On the way") : trip.status === "PICKED_UP" ? t("Picked up") : driver ? t("Driver set") : t("No driver yet")}</Pill>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </Panel>
        )}

        {/* TOMORROW — who comes and who leaves, to get the rooms and bills ready */}
        <Panel className="scroll-mt-20"
          title={<span id="tomorrow" className="flex items-center gap-2"><Sunrise className="size-4 text-amber-500" />{t("Tomorrow · {date}", { date: t.date(addDays(today, 1)) })}</span>}
          action={<PanelLink href="/staff/reservations">{t("Reservations")}</PanelLink>}>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {([[msg("Arriving"), arrivingTomorrow.length, t.plural(tomorrowRooms, "{n} room", "{n} rooms"), "text-sky-600 dark:text-sky-300"], [msg("Leaving"), leavingTomorrow, t("to check out"), "text-rose-600 dark:text-rose-300"], [msg("Booked"), nights[1] ?? 0, t("of {n} rooms", { n: sellable }), "text-emerald-600 dark:text-emerald-300"]] as const).map(([label, value, sub, tone]) => (
              <div key={label} className="rounded-2xl bg-muted/40 px-3 py-2.5 ring-1 ring-inset ring-border/60">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t(label)}</p>
                <p className={cn("text-xl font-semibold tabular-nums", tone)}>{value}</p>
                <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
              </div>
            ))}
          </div>
          {arrivingTomorrow.length === 0 ? <p className="text-sm text-muted-foreground">{t("No arrival booked for tomorrow yet.")}</p> : (
            <ul className={FIVE_ROWS}>
              {arrivingTomorrow.map((r) => (
                <li key={r.id}>
                  <Link href={`/staff/reservations/${r.id}`} className="flex items-center gap-3 py-2.5 transition-colors hover:text-foreground">
                    <RoomTile number={r.rooms.map((x) => x.room?.number).filter(Boolean).join("·")} tone="sky" />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-sm font-semibold">{r.guest.fullName}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[...new Set(r.rooms.map((x) => x.roomType.name))].map((name) => t(name)).join(", ")}{r.eta ? ` · ${t("around {time}", { time: r.eta })}` : ""}{r.rooms.some((x) => !x.room) ? ` · ${t("room not given yet")}` : ""}</span>
                    </span>
                    {r.status === "INQUIRY" ? <Pill kind="OWES">{t("Not paid · room not held")}</Pill> : r.status === "RESERVED" ? <Pill kind="RESERVED">{t("Not confirmed")}</Pill> : r.balanceAmount > 0 ? <Pill kind="OWES">{t("Owes {amount}", { amount: formatTZS(r.balanceAmount) })}</Pill> : <Pill kind="PAID">{t("Paid")}</Pill>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* UNPAID AFTER CHECKOUT — one green line when all is settled */}
        <Panel className="scroll-mt-20"
          title={<span id="unpaid" className="flex items-center gap-2"><Receipt className="size-4 text-rose-500" />{t("Unpaid after checkout")}{snap.unpaidAfterCheckout.count > 0 && <span className="text-sm font-normal text-muted-foreground">({snap.unpaidAfterCheckout.count})</span>}</span>}
          subtitle={snap.unpaidAfterCheckout.count > 0 ? `${t("{amount} still to collect", { amount: formatTZS(snap.unpaidAfterCheckout.amount) })}${snap.unpaidAfterCheckout.count > snap.unpaidCheckedOut.length ? ` · ${t("the latest {n} shown", { n: snap.unpaidCheckedOut.length })}` : ""}` : undefined}>
          {snap.unpaidCheckedOut.length === 0 ? (
            <p className="flex items-center gap-2.5 rounded-2xl bg-emerald-500/[0.07] px-3.5 py-3 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-4 shrink-0" />{t("All settled — nobody owes from a past stay.")}</p>
          ) : (
            <ul className={FIVE_ROWS}>
              {snap.unpaidCheckedOut.map((r) => (
                <li key={r.id}>
                  <Link href={`/staff/reservations/${r.id}`} className="flex items-center gap-3 py-2.5 transition-colors hover:text-foreground">
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-sm font-semibold">{r.guest.fullName}</span>
                      <span className="block truncate text-xs text-muted-foreground">{t("Checked out")}{r.corporateCustomer ? ` · ${r.corporateCustomer.companyName}` : ""}</span>
                    </span>
                    <Pill kind="OWES">{formatTZS(r.balanceAmount)}</Pill>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>
      </div>

      {snap.awaitingApproval > 0 && can(user, "expenses.approve") && (
        <Link href="/staff/expenses?status=PENDING_APPROVAL" className="group flex items-center gap-3 rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] px-4 py-3 transition-colors hover:bg-amber-500/10">
          <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-amber-500/15 text-amber-600 dark:text-amber-300"><Banknote className="size-4" /></span>
          <span className="min-w-0 flex-1 leading-tight">
            <span className="block text-sm font-semibold">{t.plural(snap.awaitingApproval, "{n} expense waiting for your approval", "{n} expenses waiting for your approval")}</span>
            <span className="text-xs text-muted-foreground">{t("Check it, then approve or send it back")}</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}

    </div>
  );
}

/** Five rows show (with a peek of the sixth, so it is clear there is more); the rest scroll inside the panel. */
const FIVE_ROWS = "max-h-[23rem] divide-y divide-border overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]";

/** "5 min ago", "2 h ago", "yesterday" — in the reader's language. */
function ago(d: Date, now: Date, t: T) {
  const m = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60000));
  return m < 1 ? t("just now") : m < 60 ? t("{n} min ago", { n: m }) : m < 24 * 60 ? t("{n} h ago", { n: Math.floor(m / 60) }) : m < 48 * 60 ? t("yesterday") : t("{n} days ago", { n: Math.floor(m / 1440) });
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" }).format(new Date()));
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}


function RoomTile({ number, tone }: { number: string; tone: "amber" | "sky" | "rose" | "emerald" }) {
  const t = { amber: "bg-amber-500/15 text-amber-800 dark:text-amber-300", sky: "bg-sky-500/15 text-sky-700 dark:text-sky-300", rose: "bg-rose-500/15 text-rose-700 dark:text-rose-300", emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" }[tone];
  return <span className={cn("grid h-11 min-w-11 shrink-0 place-items-center rounded-xl px-1.5 text-sm font-bold tabular-nums", t)}>{number || "—"}</span>;
}

