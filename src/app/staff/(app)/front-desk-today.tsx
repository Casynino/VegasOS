import Link from "next/link";
import { billMenu } from "@/server/services/restaurant";
import { recentChargeItems } from "@/server/services/payments";
import { discountLimit } from "@/lib/discounts";
import { AlertTriangle, ArrowRight, Banknote, BedDouble, BedSingle, CalendarPlus, Car, CheckCircle2, ChevronRight, Clock, ConciergeBell, Inbox, KeyRound, LogIn, LogOut, Luggage, NotebookTabs, Plane, Receipt, Sunrise, Users, Wallet, Wrench } from "lucide-react";
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
import { formatBusinessDate, formatTime, formatTZS } from "@/lib/format";
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

/**
 * Reception — the hotel's operational centre. Ordered by what the desk does
 * next: today's numbers, quick actions, arrivals (one-click ASSIGN & CHECK IN),
 * departures, who is in house, room issues. Checking in itself happens on /staff/check-in.
 */
const LOBBY = "/images/lobby/lobby-01.webp";

export async function FrontDeskToday() {
  const user = await requireUser();
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
      where: { kind: "STAY", arrivalDate: tomorrowDb, status: { in: ["RESERVED", "CONFIRMED"] } }, orderBy: [{ eta: "asc" }, { createdAt: "asc" }], take: 30,
      select: { id: true, eta: true, balanceAmount: true, status: true, guest: { select: { fullName: true } }, rooms: { where: { status: { not: "CANCELLED" } }, select: { roomType: { select: { name: true } }, room: { select: { number: true } } } } },
    }),
    db.reservation.count({ where: { kind: "STAY", status: "CHECKED_IN", departureDate: tomorrowDb } }),
  ]);
  const tomorrowRooms = arrivingTomorrow.reduce((t, r) => t + r.rooms.length, 0);
  // Mobile money (nTZS) that came in but did not fit the bill — someone must deal with it.
  const mobileToCheck = can(user, "payments.record") ? (await mobilePaymentsNeedingAttention()).length : 0;
  const todayParts: TodayPart[] = [
    { label: "Arrivals", icon: <LogIn />, tone: "sky", href: "/staff/check-in", value: board.arrivals.length, unit: "to check in",
      done: arrivedToday, of: arrivedToday + board.arrivals.length, note: arrivedToday + board.arrivals.length ? `${arrivedToday} of ${arrivedToday + board.arrivals.length} checked in` : "Nobody due today" },
    { label: "Departures", icon: <LogOut />, tone: "rose", href: "/staff/check-out", value: snap.departures.length, unit: "to check out",
      done: leftToday, of: leftToday + snap.departures.length, note: leftToday + snap.departures.length ? `${leftToday} of ${leftToday + snap.departures.length} checked out` : "Nobody leaving today" },
    { label: "In the hotel", icon: <Users />, tone: "emerald", href: "/staff/reservations?view=inhouse", value: guestsInHouse, unit: guestsInHouse === 1 ? "guest" : "guests",
      done: roomsInHouse, of: sellable, note: `${roomsInHouse} of ${sellable} rooms · ${sellable ? Math.round((roomsInHouse / sellable) * 100) : 0}% full` },
    { label: "Free tonight", icon: <BedSingle />, tone: "violet", href: "/staff/rooms", value: board.tonightFree ?? "—", unit: board.tonightFree === 1 ? "room" : "rooms",
      done: board.tonightFree ?? 0, of: sellable, note: [toClean && `${toClean} to clean`, blocked && `${blocked} under maintenance`].filter(Boolean).join(" · ") || "Ready to sell" },
  ];
  const days14 = Array.from({ length: 14 }, (_, i) => addDays(today, i - 13));
  // What each staying guest owes, as the Guests owing table counts it (a group pays its rooms; never below 0).
  const owedBy = new Map(balances.rows.map((x) => [x.reservationId, x.outstanding]));
  const owes = (r: { id: string; balanceAmount: number }) => owedBy.get(r.id) ?? Math.max(0, r.balanceAmount);
  const owing = snap.departures.filter((r) => owes(r) > 0);
  const overdue = snap.departures.filter((r) => r.rooms.some((x) => x.status === "CHECKED_IN" && x.endAt <= new Date()));
  const attention: AttentionItem[] = [
    overdue.length > 0 && { tone: "rose", icon: <Clock />, group: "Check-out", title: `${overdue.length} checkout${overdue.length === 1 ? "" : "s"} overdue`, detail: "Past checkout time with no extension — check out or extend", href: `/staff/check-out?id=${overdue[0].id}#workspace` },
    (worksShift ? !myShift : !shift.open) && { tone: "amber", icon: <AlertTriangle />, group: "Shift", title: worksShift ? "You have no active shift" : "No reception shift started", detail: worksShift ? "Start your shift before working the desk" : "Nobody is on reception right now", href: "#shift" },
    board.requestsDue.length > 0 && { tone: "gold", icon: <Inbox />, group: "Bookings", title: `${board.requestsDue.length} online request${board.requestsDue.length === 1 ? "" : "s"} for today not confirmed`, detail: "Call the guest and confirm the booking", href: "/staff/booking-requests" },
    owing.length > 0 && { tone: "rose", icon: <Wallet />, group: "Money", title: `${owing.length} leaving today still owe${owing.length === 1 ? "s" : ""} money`, detail: `${formatTZS(owing.reduce((s, r) => s + owes(r), 0))} to collect before checkout`, href: "/staff/check-out" },
    snap.unpaidAfterCheckout.count > 0 && { tone: "rose", icon: <Receipt />, group: "Money", title: `${snap.unpaidAfterCheckout.count} unpaid after checkout`, detail: "Past guests with an open balance", href: "#unpaid" },
    snap.maintenance.length > 0 && { tone: "slate", icon: <Wrench />, group: "Rooms", title: `${snap.maintenance.length} room${snap.maintenance.length === 1 ? "" : "s"} under maintenance`, detail: "Not available to sell", href: "/staff/rooms" },
    mobileToCheck > 0 && { tone: "rose", icon: <Wallet />, group: "Money", title: `${mobileToCheck} mobile-money payment${mobileToCheck === 1 ? "" : "s"} to check`, detail: "Came in by nTZS but did not fit the bill — refund or apply it", href: "/staff/collections#ntzs" },
    openRequests.some((q) => q.status === "NEW") && { tone: "gold", icon: <ConciergeBell />, group: "Guests", title: `${openRequests.filter((q) => q.status === "NEW").length} guest request${openRequests.filter((q) => q.status === "NEW").length === 1 ? "" : "s"} waiting`, detail: "Nobody has accepted yet — open it and tap Accept", href: "#requests" },
  ].filter(Boolean) as AttentionItem[];

  return (
    <div className="w-full space-y-6">
      <HeroBanner
        image={LOBBY}
        eyebrow={`Front office · ${user.roleName}`}
        title={`Good ${greeting()}, ${user.fullName.split(" ")[0]}`}
        subtitle={<><strong className="font-semibold text-white">{board.arrivals.length}</strong> to check in · <strong className="font-semibold text-white">{snap.departures.length}</strong> to check out today</>}
      />
      <ReceptionSearch className="w-full md:hidden" />

      {/* The quick actions — and my shift as one small switch at the end (like the waiter's): "Since 16:19", tap to end. */}
      <div id="shift" className="flex scroll-mt-24 flex-wrap items-center gap-x-3 gap-y-2">
        <div className="min-w-0 basis-full md:basis-0 md:flex-1">
      <QuickActions items={([
        { href: "/staff/reservations/new", label: "New booking", hint: "Walk-in or reserve", icon: <CalendarPlus />, tone: "gold", perm: "reservations.create" },
        { href: "/staff/reservations", label: "Reservations", hint: "All bookings", icon: <NotebookTabs />, tone: "amber", perm: "reservations.view" },
        { href: "/staff/check-in", label: "Check in", hint: board.arrivals.length ? `${board.arrivals.length} arriving today` : "Hand over the key", icon: <KeyRound />, tone: "emerald", perm: "reservations.check_in", badge: board.arrivals.length },
        { href: "/staff/check-out", label: "Check out", hint: snap.departures.length ? `${snap.departures.length} leaving today` : "Settle the bill", icon: <Luggage />, tone: "rose", perm: "reservations.check_out", badge: snap.departures.length },
        { href: "/staff/rooms", label: "Rooms", hint: "Board & cleaning", icon: <BedDouble />, tone: "sky", perm: "rooms.view" },
        { href: "/staff/requests", label: "Guest request", hint: "Room service & needs", icon: <ConciergeBell />, tone: "violet", perm: "requests.view" },
        { href: "/staff/expenses", label: "Expense", hint: "Money paid out", icon: <Banknote />, tone: "teal", perm: "expenses.record" },
      ] as const).filter((a) => can(user, a.perm as never)).map((a) => ({ href: a.href, label: a.label, hint: a.hint, icon: a.icon, tone: a.tone, badge: "badge" in a ? a.badge : undefined })).slice()} />
        </div>
        {worksShift ? (
          <span className="flex items-center gap-1.5">
            {colleague && <span className="hidden text-xs text-muted-foreground sm:inline">with {colleague.user.fullName.split(" ")[0]}</span>}
            <ShiftControls variant="switch" myShiftOpen={!!myShift} since={myShift ? formatTime(myShift.startedAt) : null} otherOpenBy={lockedBy}
              scheduledName={shift.scheduledToday?.scheduledUser.fullName ?? null} isScheduled={shift.scheduledToday?.scheduledUserId === user.id} />
            {/* Her shift so far: what she did and collected in it */}
            {myShift && <Link href={`/staff/shifts/${myShift.id}`} className="inline-flex h-9 items-center gap-1 rounded-full border border-border px-3 text-sm font-medium hover:bg-muted">My shift<ArrowRight className="size-3.5" /></Link>}
          </span>
        ) : (
          // Managers and the MD supervise: who is on reception now, in one small pill.
          <Link href="/staff/shifts" className={cn("inline-flex h-9 min-w-0 max-w-full items-center gap-2 rounded-full border px-3.5 text-sm font-medium transition-colors hover:bg-muted/50", shift.openAll.length ? "border-emerald-500/40" : "border-amber-500/40 text-amber-700 dark:text-amber-300")}>
            <span className={cn("size-2 shrink-0 rounded-full", shift.openAll.length ? "bg-emerald-500" : "bg-amber-500")} />
            {shift.openAll.length ? <><span className="hidden shrink-0 sm:inline">On reception:</span> <strong className="min-w-0 truncate font-semibold">{shift.openAll.map((o) => `${o.user.fullName.split(" ")[0]} ${formatTime(o.startedAt)}`).join(" · ")}</strong></> : "Nobody on reception"}
          </Link>
        )}
      </div>

      <TodayStrip parts={todayParts} />

      <div>
        <SectionLabel title="Needs your attention" count={attention.length} />
        <AttentionCards items={attention} emptyDetail="No unpaid departures, no unconfirmed requests, no room problems." />
      </div>

      <div>
        <SectionLabel title="Guests owing" count={balances.summary.owingCount} href="/staff/shifts" linkLabel="Shift handover" />
        <GuestsOwing b={balances} canPay={can(user, "payments.record")} show={3} methods={methods} />
      </div>

      {groupsToday.length > 0 && (
        <div>
          <SectionLabel title="Groups arriving today" count={groupsToday.length} href="/staff/groups" linkLabel="All groups" />
          <ul className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
            {groupsToday.map((g) => (
              <li key={g.id}>
                <Link href={`/staff/groups/${g.id}`} className="block rounded-2xl border border-border/70 bg-card p-3.5 transition-colors hover:bg-muted/40">
                  <p className="flex items-center justify-between gap-2"><strong className="truncate">{g.name}</strong><span className="shrink-0 text-xs text-muted-foreground">{g.rooms} room{g.rooms === 1 ? "" : "s"}</span></p>
                  <p className="mt-0.5 text-xs text-muted-foreground">{g.checkedIn + g.checkedOut}/{g.rooms} checked in · {g.pending} pending · pays: {g.payer}</p>
                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-emerald-500" style={{ width: `${g.rooms ? Math.round(((g.checkedIn + g.checkedOut) / g.rooms) * 100) : 0}%` }} /></div>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div>
        <SectionLabel title="Arrivals today" href="/staff/check-in" linkLabel="Check in" />
        <ArrivalsSummary s={arrivalsToday} today={today} canCheckIn={canCheckIn} />
      </div>


      {/* THE DESK, IN SHAPE */}
      <div>
        <SectionLabel title="The desk, in shape" href="/staff/reports" linkLabel="Reports" />
        <div className="grid gap-4 lg:grid-cols-3">
          <Panel title="Rooms right now" subtitle="What every room is doing">
            <Donut format="count" center={{ label: "rooms", value: String(roomBoard.length) }}
              colors={["#10b981", "#0ea5e9", "#f59e0b", "#f97316", "#8b5cf6", "#f43f5e"]}
              data={[
                { name: "Available", value: byState("AVAILABLE", "READY") }, { name: "Occupied", value: byState("OCCUPIED") },
                { name: "Arriving today", value: byState("RESERVED") }, { name: "Needs cleaning", value: byState("DIRTY") },
                { name: "Being cleaned", value: byState("CLEANING") }, { name: "Maintenance", value: byState("MAINTENANCE", "OUT_OF_SERVICE") },
              ]} />
          </Panel>
          <Panel title="Arrivals & departures" subtitle="Rooms in and out, last 14 days">
            <PairBars a={{ name: "Arrivals", color: "#0ea5e9" }} b={{ name: "Departures", color: "#f43f5e" }}
              data={days14.map((d) => ({
                label: d.slice(8), today: d === today,
                a: ins.find((x) => x.arrivalDate.toISOString().slice(0, 10) === d)?._count ?? 0,
                b: outs.find((x) => x.departureDate.toISOString().slice(0, 10) === d)?._count ?? 0,
              }))} />
          </Panel>
          <Panel title="The next 7 nights" subtitle="Rooms booked or occupied each night">
            <BarList rows={nights.map((n, i) => ({
              label: i === 0 ? "Tonight" : i === 1 ? "Tomorrow" : formatBusinessDate(addDays(today, i)),
              value: n, max: sellable, highlight: i === 0,
            }))} />
          </Panel>
        </div>
      </div>

      {/* ROOM BOARD */}
      <Panel title={<span className="flex items-center gap-2"><BedDouble className="size-4 text-muted-foreground" />Rooms</span>}
        subtitle="Every room at a glance — click a room for check in, check out, cleaning and more" action={<PanelLink href="/staff/rooms">Room board</PanelLink>}>
        <RoomGrid rooms={roomBoard} today={today} methods={methods} menu={billForRooms} recent={recentExtras}
          perms={{ transport: can(user, "transport.request") || can(user, "transport.manage"), order: can(user, "restaurant.orders"), orderPayNow: can(user, "revenue.record"), pay: can(user, "payments.record"), update: can(user, "rooms.status.update"), block: can(user, "rooms.block"), checkIn: canCheckIn, checkOut: can(user, "reservations.check_out"), book: can(user, "reservations.create"), discount: discountLimit(user.permissions, await getSettings()) > 0, discountMax: discountLimit(user.permissions, await getSettings()),
            move: can(user, "reservations.edit") }} />
      </Panel>

      <div className="grid gap-4 xl:grid-cols-2">
        {/* ARRIVING TODAY — compact; the full check-in happens on the Check-in page */}
        <Panel className="scroll-mt-20" title={<span id="arrivals" className="flex items-center gap-2"><LogIn className="size-4 text-sky-500" />Arriving today <span className="text-sm font-normal text-muted-foreground">({board.arrivals.length})</span></span>}
          action={<PanelLink href="/staff/check-in">Check-in desk</PanelLink>}>
          {board.arrivals.length === 0 ? <p className="text-sm text-muted-foreground">Everyone due today is checked in.</p> : (
            <ul className={FIVE_ROWS}>
              {board.arrivals.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-3">
                  <RoomTile number={r.rooms.map((x) => x.current.number).join("·")} tone="amber" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{r.guest.fullName}</span>
                    <span className="block truncate text-xs text-muted-foreground">{r.rooms.map((x) => `${x.roomTypeName} · ${x.current.number}`).join(", ")}{r.eta ? ` · around ${r.eta}` : ""}</span>
                  </span>
                  {r.balanceAmount > 0 ? <Pill kind="OWES">Owes {formatTZS(r.balanceAmount)}</Pill> : <Pill kind="PAID">Paid</Pill>}
                  {canCheckIn && <Link href={`/staff/check-in?id=${r.id}#workspace`} className={buttonVariants({ size: "sm" })}>Check in</Link>}
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* LEAVING TODAY */}
        <Panel className="scroll-mt-20" title={<span id="departures" className="flex items-center gap-2"><LogOut className="size-4 text-rose-500" />Leaving today <span className="text-sm font-normal text-muted-foreground">({snap.departures.length})</span></span>}>
          {snap.departures.length === 0 ? <p className="text-sm text-muted-foreground">No one left to check out today.</p> : (
            <ul className={FIVE_ROWS}>
              {snap.departures.map((r) => (
                <li key={r.id} className="flex items-center gap-3 py-3">
                  <RoomTile number={r.rooms.filter((x) => x.status === "CHECKED_IN").map((x) => x.room.number).join("·")} tone={overdue.includes(r) ? "rose" : "sky"} />
                  <Link href={`/staff/check-out?id=${r.id}#workspace`} className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-semibold text-foreground">{r.guest.fullName}</span>
                    <span className="block truncate text-xs text-muted-foreground">
                      Room {r.rooms.filter((x) => x.status === "CHECKED_IN").map((x) => x.room.number).join(", ")} · {overdue.includes(r) ? <span className="font-semibold text-rose-600 dark:text-rose-400">overdue since {formatTime(r.rooms.find((x) => x.status === "CHECKED_IN")?.endAt ?? new Date())}</span> : `due ${formatTime(r.rooms.find((x) => x.status === "CHECKED_IN")?.endAt ?? new Date())}`}
                    </span>
                  </Link>
                  {owes(r) > 0 ? <Pill kind="OWES">Owes {formatTZS(owes(r))}</Pill> : <Pill kind="PAID">{owedBy.get(r.id) === 0 && r.balanceAmount > 0 ? "Billed to the group" : "Paid"}</Pill>}
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
      <Panel className="scroll-mt-20" title={<span id="in-house" className="flex items-center gap-2"><Users className="size-4 text-emerald-500" />In the hotel now <span className="text-sm font-normal text-muted-foreground">({snap.inHouse.length})</span></span>}
        action={<PanelLink href="/staff/reservations?view=inhouse">All</PanelLink>}>
        {snap.inHouse.length === 0 ? <p className="text-sm text-muted-foreground">No guests in the hotel.</p> : (
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
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
                        {late ? `Overdue since ${formatTime(out)}` : leavingToday ? `Leaves today · ${formatTime(out)}` : `Out ${formatBusinessDate(r.departureDate.toISOString().slice(0, 10))}`}
                      </span>
                    </span>
                    <span className={cn("shrink-0 text-xs font-semibold tabular-nums", owes(r) > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>
                      {owes(r) > 0 ? formatTZS(owes(r)).replace("TZS ", "") : "Paid"}
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
            title={<span id="requests" className="flex items-center gap-2"><ConciergeBell className="size-4 text-violet-500" />Guest requests{requestCount > 0 && <span className="text-sm font-normal text-muted-foreground">({requestCount} open)</span>}</span>}
            subtitle={requestCount > 0 ? "Accept one and mark it done when it is handled" : undefined} action={<PanelLink href="/staff/requests">Requests</PanelLink>}>
            {openRequests.length === 0 ? (
              <p className="flex items-center gap-2.5 rounded-2xl bg-emerald-500/[0.07] px-3.5 py-3 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-4 shrink-0" />Nothing waiting — every guest request is handled.</p>
            ) : (
              <ul className={FIVE_ROWS}>
                {openRequests.map((q) => {
                  const who = q.assignedTo?.fullName.replace(/\s*\(.*\)/, "").split(" ")[0];
                  return (
                    <li key={q.id}>
                      <Link href="/staff/requests" className="flex items-center gap-3 py-2.5 transition-colors hover:text-foreground">
                        <RoomTile number={q.room?.number ?? ""} tone={q.status === "NEW" ? "amber" : "sky"} />
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className="block truncate text-sm font-semibold">{REQUEST_TYPE_LABEL[q.type] ?? "Request"}{(q.priority === "HIGH" || q.priority === "URGENT") && <span className="ml-1.5 text-[11px] font-semibold text-rose-600 dark:text-rose-400">{q.priority === "URGENT" ? "Urgent" : "High"}</span>}</span>
                          <span className="block truncate text-xs text-muted-foreground">{q.description}</span>
                          <span className="block truncate text-[11px] text-muted-foreground">{q.guest?.fullName ?? (q.source === "STAFF" ? "Logged at the desk" : "From the guest's phone")} · {ago(q.createdAt, now)}</span>
                        </span>
                        <Pill kind={q.status === "NEW" ? "OWES" : q.status === "IN_PROGRESS" ? "PAID" : "CONFIRMED"}>{q.status === "NEW" ? "New" : q.status === "IN_PROGRESS" ? `${who ?? "Someone"} on it` : `For ${who ?? "someone"}`}</Pill>
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
            title={<span id="transport" className="flex items-center gap-2"><Car className="size-4 text-orange-500" />Transport · next 24 hours{trips.length > 0 && <span className="text-sm font-normal text-muted-foreground">({trips.length})</span>}</span>}
            action={<PanelLink href="/staff/transport">Transport</PanelLink>}>
            {trips.length === 0 ? <p className="text-sm text-muted-foreground">No pickup or drop-off in the next 24 hours.</p> : (
              <ul className={FIVE_ROWS}>
                {trips.map((t) => {
                  const driver = t.driverName || t.driverId;
                  const late = t.pickupAt < now && (t.status === "REQUESTED" || t.status === "CONFIRMED" || t.status === "ASSIGNED");
                  return (
                    <li key={t.id}>
                      <Link href="/staff/transport" className="flex items-center gap-3 py-2.5 transition-colors hover:text-foreground">
                        <span className={cn("grid h-11 min-w-14 shrink-0 place-items-center rounded-xl px-1.5 text-sm font-bold tabular-nums", late ? "bg-rose-500/15 text-rose-700 dark:text-rose-300" : "bg-orange-500/15 text-orange-700 dark:text-orange-300")}>{formatTime(t.pickupAt)}</span>
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className="flex items-center gap-1.5 truncate text-sm font-semibold">{t.type.startsWith("AIRPORT") && <Plane className="size-3.5 shrink-0 text-muted-foreground" />}{t.passengerName}{t.roomNumber && <span className="text-xs font-normal text-muted-foreground">· room {t.roomNumber}</span>}</span>
                          <span className="block truncate text-xs text-muted-foreground">{t.pickupLocation} → {t.destination}{t.flightNumber ? ` · ${t.flightNumber}` : ""}</span>
                        </span>
                        <Pill kind={driver ? "PAID" : "OWES"}>{t.status === "EN_ROUTE" ? "On the way" : t.status === "PICKED_UP" ? "Picked up" : driver ? "Driver set" : "No driver yet"}</Pill>
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
          title={<span id="tomorrow" className="flex items-center gap-2"><Sunrise className="size-4 text-amber-500" />Tomorrow · {formatBusinessDate(addDays(today, 1))}</span>}
          action={<PanelLink href="/staff/reservations">Reservations</PanelLink>}>
          <div className="mb-3 grid grid-cols-3 gap-2">
            {([["Arriving", arrivingTomorrow.length, `${tomorrowRooms} room${tomorrowRooms === 1 ? "" : "s"}`, "text-sky-600 dark:text-sky-300"], ["Leaving", leavingTomorrow, "to check out", "text-rose-600 dark:text-rose-300"], ["Booked", nights[1] ?? 0, `of ${sellable} rooms`, "text-emerald-600 dark:text-emerald-300"]] as const).map(([label, value, sub, tone]) => (
              <div key={label} className="rounded-2xl bg-muted/40 px-3 py-2.5 ring-1 ring-inset ring-border/60">
                <p className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p>
                <p className={cn("text-xl font-semibold tabular-nums", tone)}>{value}</p>
                <p className="truncate text-[11px] text-muted-foreground">{sub}</p>
              </div>
            ))}
          </div>
          {arrivingTomorrow.length === 0 ? <p className="text-sm text-muted-foreground">No arrival booked for tomorrow yet.</p> : (
            <ul className={FIVE_ROWS}>
              {arrivingTomorrow.map((r) => (
                <li key={r.id}>
                  <Link href={`/staff/reservations/${r.id}`} className="flex items-center gap-3 py-2.5 transition-colors hover:text-foreground">
                    <RoomTile number={r.rooms.map((x) => x.room?.number).filter(Boolean).join("·")} tone="sky" />
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-sm font-semibold">{r.guest.fullName}</span>
                      <span className="block truncate text-xs text-muted-foreground">{[...new Set(r.rooms.map((x) => x.roomType.name))].join(", ")}{r.eta ? ` · around ${r.eta}` : ""}{r.rooms.some((x) => !x.room) ? " · room not given yet" : ""}</span>
                    </span>
                    {r.status === "RESERVED" ? <Pill kind="RESERVED">Not confirmed</Pill> : r.balanceAmount > 0 ? <Pill kind="OWES">Owes {formatTZS(r.balanceAmount)}</Pill> : <Pill kind="PAID">Paid</Pill>}
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </Panel>

        {/* UNPAID AFTER CHECKOUT — one green line when all is settled */}
        <Panel className="scroll-mt-20"
          title={<span id="unpaid" className="flex items-center gap-2"><Receipt className="size-4 text-rose-500" />Unpaid after checkout{snap.unpaidAfterCheckout.count > 0 && <span className="text-sm font-normal text-muted-foreground">({snap.unpaidAfterCheckout.count})</span>}</span>}
          subtitle={snap.unpaidAfterCheckout.count > 0 ? `${formatTZS(snap.unpaidAfterCheckout.amount)} still to collect${snap.unpaidAfterCheckout.count > snap.unpaidCheckedOut.length ? ` · the latest ${snap.unpaidCheckedOut.length} shown` : ""}` : undefined}>
          {snap.unpaidCheckedOut.length === 0 ? (
            <p className="flex items-center gap-2.5 rounded-2xl bg-emerald-500/[0.07] px-3.5 py-3 text-sm text-emerald-700 dark:text-emerald-300"><CheckCircle2 className="size-4 shrink-0" />All settled — nobody owes from a past stay.</p>
          ) : (
            <ul className={FIVE_ROWS}>
              {snap.unpaidCheckedOut.map((r) => (
                <li key={r.id}>
                  <Link href={`/staff/reservations/${r.id}`} className="flex items-center gap-3 py-2.5 transition-colors hover:text-foreground">
                    <span className="min-w-0 flex-1 leading-tight">
                      <span className="block truncate text-sm font-semibold">{r.guest.fullName}</span>
                      <span className="block truncate text-xs text-muted-foreground">Checked out{r.corporateCustomer ? ` · ${r.corporateCustomer.companyName}` : ""}</span>
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
            <span className="block text-sm font-semibold">{snap.awaitingApproval} expense{snap.awaitingApproval === 1 ? "" : "s"} waiting for your approval</span>
            <span className="text-xs text-muted-foreground">Check it, then approve or send it back</span>
          </span>
          <ChevronRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
        </Link>
      )}

    </div>
  );
}

/** Five rows show (with a peek of the sixth, so it is clear there is more); the rest scroll inside the panel. */
const FIVE_ROWS = "max-h-[23rem] divide-y divide-border overflow-y-auto overscroll-contain pr-1 [scrollbar-width:thin]";

/** "5 min ago", "2 h ago", "yesterday". */
function ago(d: Date, now: Date) {
  const m = Math.max(0, Math.round((now.getTime() - d.getTime()) / 60000));
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : m < 24 * 60 ? `${Math.floor(m / 60)} h ago` : m < 48 * 60 ? "yesterday" : `${Math.floor(m / 1440)} days ago`;
}

function greeting() {
  const h = Number(new Intl.DateTimeFormat("en-GB", { hour: "numeric", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" }).format(new Date()));
  return h < 12 ? "morning" : h < 17 ? "afternoon" : "evening";
}


function RoomTile({ number, tone }: { number: string; tone: "amber" | "sky" | "rose" | "emerald" }) {
  const t = { amber: "bg-amber-500/15 text-amber-800 dark:text-amber-300", sky: "bg-sky-500/15 text-sky-700 dark:text-sky-300", rose: "bg-rose-500/15 text-rose-700 dark:text-rose-300", emerald: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-300" }[tone];
  return <span className={cn("grid h-11 min-w-11 shrink-0 place-items-center rounded-xl px-1.5 text-sm font-bold tabular-nums", t)}>{number || "—"}</span>;
}

