"use client";

import { Fragment, useEffect, useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgePercent, BedDouble, History, Repeat, CalendarClock, CalendarPlus, DoorOpen, CheckCircle2, FileText, Loader2, LogIn, LogOut, QrCode, Receipt, BrushCleaning, SprayCan, Wallet, Wrench, UtensilsCrossed, Car } from "lucide-react";
import { changeRoomStatusAction } from "@/app/staff/(app)/rooms/actions";
import { checkInHereAction, previewCheckOutAction, recordPaymentAction, settleCheckOutAction } from "@/app/staff/(app)/reservations/actions";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { ExtendStay, OpenOrdersNote } from "@/components/staff/reception/stay-workspace";
import { DiscountEditor } from "@/components/staff/reception/discount-editor";
import { CompanyBillBox } from "@/components/staff/reception/company-bill-box";
import { ChangeRoomDialog } from "@/components/staff/reception/change-room-dialog";
import { DESK_DISCOUNT_MAX } from "@/lib/discounts";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { IdPicker, NationalityPicker } from "@/components/staff/id-nationality";
import { formatTZS } from "@/lib/format";
import { MANUAL_TRANSITIONS, ROOM_STATUS_META, BLOCKED_STATUSES } from "@/lib/room-status";
import type { RoomBoardRoom } from "@/server/services/rooms";
import type { CheckOutPreview } from "@/server/services/reservations";
import type { RoomStatus } from "@/generated/prisma/enums";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { CARD_META, FLOOR_ITEM, RoomFlow, RoomTile, type CardState } from "./room-card";
import { AccountSelect } from "@/components/staff/finance/account-select";
import type { PayAccount } from "@/lib/pay-account";
import { ChargeComposer, type RecentItem } from "@/components/staff/reception/room-charges";
import type { BillMenu } from "@/server/services/restaurant";
import { MeetingButtons } from "@/app/staff/(app)/reservations/[id]/panels";
import { QuickBook } from "./quick-book";
import { OtherWays, SendToPhone } from "@/components/staff/mobile-pay";
import { RoomHistoryInline, TransportInline } from "./room-panels";
import { InsightHeader, InsightHistory, InsightRows, MeetingInsightBody, MeetingInsightHeader, useMeetingInsight, useRoomInsight } from "./room-insight";
import { RoomDecisions } from "@/components/staff/manager-decisions";
import { MEETING_ROOM_STATUS_LABEL, MEETING_STATUS_LABEL, timeRange } from "@/lib/meeting";
import { qrSvg } from "@/lib/qr-svg";
import { QrPreview, type Printable } from "@/components/staff/qr/qr-print-card";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";

/** The room window's title: a dialog title in the pop-up, a plain heading on the room page. */
function Title({ onPage, className, children }: { onPage: boolean; className?: string; children: React.ReactNode }) {
  return onPage ? <h1 className={className}>{children}</h1> : <DialogTitle className={className}>{children}</DialogTitle>;
}
function Desc({ onPage, className, children }: { onPage: boolean; className?: string; children: React.ReactNode }) {
  return onPage ? <p className={className}>{children}</p> : <DialogDescription className={className}>{children}</DialogDescription>;
}

/** Every room's QR card, so reception can download / print it from the room's window. */
export interface RoomQrInfo { origin: string; hotel: string; phone: string | null; tokens: Record<string, string> }

/** The room's QR card (made in the browser, only when it is opened). */
function RoomQrBox({ room, qr }: { room: RoomBoardRoom; qr: RoomQrInfo }) {
  const t = useT();
  const token = qr.tokens[room.id];
  const meeting = room.roomType.category === "MEETING_ROOM";
  const card = useMemo<Printable | null>(() => {
    if (!token) return null;
    const url = `${qr.origin}/r/${token}`;
    return { id: `pop-${room.id}`, kind: meeting ? "meeting" : "room", title: room.number, url, qr: qrSvg(url) };
  }, [token, qr.origin, room.id, room.number, meeting]);
  if (!card) return <p className="rounded-2xl border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">{t("This room has no QR yet — open Room QR codes once to make it.")}</p>;
  return (
    <div className="rounded-2xl border border-border/70 bg-muted/30 p-4">
      <QrPreview card={card} hotel={qr.hotel} phone={qr.phone} printHref={`/staff/rooms/qr?print=${room.id}`} fileName={`${meeting ? "Meeting-room" : "Room"}-${room.number}-QR`} />
    </div>
  );
}

export interface RoomGridPerms {
  update: boolean; block: boolean; checkIn: boolean; checkOut: boolean; book: boolean; pay?: boolean; discount?: boolean; discountMax?: number | null;
  /** Managers, the MD, the owner: their decisions on a stay (free nights, free late checkout, a discount up to this much a night). */
  decide?: { discountMax: number } | null;
  /** May take restaurant & bar orders for a guest staying (room service / charge to room). */
  order?: boolean;
  /** May take payment for restaurant & bar orders on the spot (restaurant takings). */
  orderPayNow?: boolean;
  /** May request guest transport (airport drop-off, trips). */
  transport?: boolean;
  /** Change room (move the guest) — and what the move screen may offer. */
  move?: boolean;
  /** Managers and the MD: they watch the rooms and only look after maintenance (off sale / fixed) — cleaning is housekeeping's. */
  maintenanceOnly?: boolean;
  /** May release a room a no-show is holding. */
  release?: boolean;
}

/** Quick reasons (saved as the room's note in English; shown in the reader's language — a note someone typed shows as written). */
const REPAIRS: string[] = [msg("AC / fan"), msg("Water / plumbing"), msg("Electricity / lights"), msg("Bathroom"), msg("TV"), msg("Bed / furniture"), msg("Painting / repairs"), msg("Door / lock")];

const FILTERS: { key: CardState; label: string }[] = [
  { key: "AVAILABLE", label: msg("Available") }, { key: "OCCUPIED", label: msg("Occupied") }, { key: "ARRIVING", label: msg("Arriving today") },
  { key: "DIRTY", label: msg("Needs cleaning") }, { key: "CLEANING", label: msg("Being cleaned") }, { key: "MAINTENANCE", label: msg("Maintenance") },
];

const TZ = "Africa/Dar_es_Salaam";
const hhmm = (d: Date | string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: TZ }).format(new Date(d));
/** "25 min" / "3 h" / "4 days" — how long a room has been waiting. */
const span = (mins: number, t: T) => mins < 60 ? t("{n} min", { n: mins }) : mins < 2880 ? t("{n} h", { n: Math.round(mins / 60) }) : t("{n} days", { n: Math.round(mins / 1440) });

function view(r: RoomBoardRoom, now: Date, today: string, t: T) {
  const st = r.displayStatus;
  const state: CardState = st === "RESERVED" ? "ARRIVING" : st === "READY" ? "AVAILABLE" : st === "OUT_OF_SERVICE" ? "MAINTENANCE" : st;
  const stay = r.currentStay;
  if (r.roomType.category === "MEETING_ROOM") {
    // Meeting room: by time — "In use till 13:00", "Meeting 14:00–17:00", never nights.
    const next = r.upcoming.find((u) => u.arrivalDate === today && u.status !== "CHECKED_IN");
    const overdue = !!stay && new Date(stay.endAt) <= now;
    const detail = stay ? (overdue ? t("Running over · {time}", { time: hhmm(stay.endAt) }) : t("In use till {time}", { time: hhmm(stay.endAt) }))
      : st === "MAINTENANCE" || st === "OUT_OF_SERVICE" ? (r.statusNote ? t(r.statusNote) : r.statusNote)
      : next ? t("Meeting {time}", { time: timeRange(next.startAt, next.endAt) }) : t("No meetings today");
    return { state, overdue, detail, guest: stay?.guestName ?? (next ? next.company ?? next.guest.fullName : null) };
  }
  const overdue = !!stay && new Date(stay.endAt) <= now;
  const mins = Math.round((now.getTime() - new Date(r.statusChangedAt).getTime()) / 60000);
  const since = span(mins, t);
  const detail = stay ? (overdue ? t("Overdue · {time}", { time: hhmm(stay.endAt) }) : stay.departureDate === today ? t("Out today {time}", { time: hhmm(stay.endAt) }) : t("Out {date} {time}", { date: t.date(stay.departureDate), time: hhmm(stay.endAt) }))
    : r.arrivalToday && (st === "DIRTY" || st === "CLEANING") ? t("Guest due — clean first")
    : r.arrivalToday ? t("Arrives today") : st === "DIRTY" || st === "CLEANING" ? t("Waiting {since}", { since }) : st === "MAINTENANCE" || st === "OUT_OF_SERVICE" ? (r.statusNote ? t(r.statusNote) : r.statusNote)
    : r.upcoming[0] ? t("Free until {date}", { date: t.date(r.upcoming[0].arrivalDate) }) : t("Free — no bookings");
  return { state, overdue, detail, guest: stay?.guestName ?? r.arrivalToday?.guestName ?? null };
}

/**
 * The room board shared by the Front desk and the Rooms page: filter chips,
 * floors of compact tiles, and a side panel per room with every next step
 * (check in / out, open the stay, room service, cleaning, status changes).
 */
export function RoomGrid({ rooms, perms, today, methods = [], menu = null, recent = [], qr = null }: {
  rooms: RoomBoardRoom[]; perms: RoomGridPerms; today: string; methods?: PayAccount[];
  /** Each room's QR card (download / print from the room's window). */
  qr?: RoomQrInfo | null;
  /** The restaurant & bar menu and recent extras — food, drinks and extras go on a guest's bill right from the room card. */
  menu?: BillMenu | null; recent?: RecentItem[];
}) {
  const t = useT();
  const [now] = useState(() => new Date());
  const [filter, setFilter] = useState<CardState | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selected = rooms.find((r) => r.id === selectedId) ?? null;
  const views = useMemo(() => new Map(rooms.map((r) => [r.id, view(r, now, today, t)])), [rooms, now, today, t]);
  const counts = useMemo(() => Object.fromEntries(FILTERS.map((f) => [f.key, rooms.filter((r) => views.get(r.id)!.state === f.key).length])) as Record<CardState, number>, [rooms, views]);
  const shown = filter ? rooms.filter((r) => views.get(r.id)!.state === filter) : rooms;
  const overdue = rooms.filter((r) => views.get(r.id)!.overdue).length;

  return (
    <>
      {/* One neat bar of groups (empty ones hidden) — and the overdue checkouts, if any, on the right */}
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <div role="group" aria-label={t("Filter rooms")} className="-mx-1 flex max-w-full gap-0.5 overflow-x-auto rounded-2xl border border-border/70 bg-muted/30 p-1 [scrollbar-width:none]">
          <button type="button" onClick={() => setFilter(null)} aria-pressed={!filter}
            className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors", !filter ? "bg-foreground text-background shadow-sm" : "text-muted-foreground hover:bg-card hover:text-foreground")}>
            {t("All")}<span className={cn("rounded-full px-1.5 text-[10px] tabular-nums", !filter ? "bg-background/20" : "bg-card")}>{rooms.length}</span>
          </button>
          {FILTERS.filter((f) => counts[f.key] || filter === f.key).map((f) => (
            <button key={f.key} type="button" onClick={() => setFilter(filter === f.key ? null : f.key)} aria-pressed={filter === f.key}
              className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-xl px-3 py-1.5 text-xs font-medium transition-colors",
                filter === f.key ? "bg-card text-foreground shadow-sm ring-1 ring-border" : "text-muted-foreground hover:bg-card hover:text-foreground")}>
              <span className={cn("size-2 rounded-full", CARD_META[f.key].dot)} />{t(f.label)}<span className="rounded-full bg-card px-1.5 text-[10px] tabular-nums">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        {overdue > 0 && (
          <span className="ml-auto inline-flex items-center gap-1.5 rounded-full border border-rose-500/30 bg-rose-500/10 px-3 py-1.5 text-xs font-semibold text-rose-600 dark:text-rose-300">
            <span className="relative flex size-2"><span className="absolute inline-flex size-full animate-ping rounded-full bg-rose-500 opacity-50" /><span className="relative inline-flex size-2 rounded-full bg-rose-500" /></span>
            {t.plural(overdue, "{n} overdue checkout", "{n} overdue checkouts")}
          </span>
        )}
      </div>

      <RoomFlow>
        {[...shown].sort((x, y) => x.number.localeCompare(y.number, undefined, { numeric: true })).map((r) => {
          const v = views.get(r.id)!;
          return (
            <li key={r.id} className={FLOOR_ITEM}>
              <RoomTile number={r.number} type={r.roomType.category === "MEETING_ROOM" ? t("Meeting room") : t(r.roomType.name)} state={v.state} guest={v.guest} detail={v.detail} overdue={v.overdue} onClick={() => setSelectedId(r.id)} />
            </li>
          );
        })}
      </RoomFlow>
      {shown.length === 0 && <p className="py-10 text-center text-sm text-muted-foreground">{t("No rooms in this group right now.")}</p>}

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelectedId(null)}>
        <DialogContent showCloseButton={false} className="max-h-[calc(100svh-2rem)] gap-0 overflow-y-auto p-0 sm:max-w-xl">
          {selected && selected.roomType.category === "MEETING_ROOM" && <MeetingRoomPanel key={selected.id} room={selected} perms={perms} today={today} methods={methods} menu={menu} recent={recent} qr={qr} />}
          {selected && selected.roomType.category !== "MEETING_ROOM" && <RoomPanel key={selected.id} room={selected} perms={perms} overdue={views.get(selected.id)!.overdue} onDone={() => setSelectedId(null)} today={today} methods={methods} menu={menu} recent={recent} qr={qr} />}
        </DialogContent>
      </Dialog>
    </>
  );
}

function RoomPanel({ room, perms, overdue, onDone, today, methods, menu, recent, qr, onPage = false }: {
  room: RoomBoardRoom; perms: RoomGridPerms; overdue: boolean; onDone: () => void; today: string; methods: PayAccount[]; menu: BillMenu | null; recent: RecentItem[];
  qr: RoomQrInfo | null;
  /** Shown on the room's own page (no "open room page" link). */
  onPage?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [target, setTarget] = useState<RoomStatus | null>(null);
  const [note, setNote] = useState("");
  const [now] = useState(() => new Date());
  const meta = ROOM_STATUS_META[room.displayStatus];
  // Managers and the MD watch the rooms: their card leads with how the room performs (like the table card).
  const watching = !!perms.maintenanceOnly && !onPage;
  const insight = useRoomInsight(room.id, watching);
  const transitions = MANUAL_TRANSITIONS[room.status].filter((s) => perms.block || s !== "OUT_OF_SERVICE");
  const inRepair = room.status === "MAINTENANCE" || room.status === "OUT_OF_SERVICE";
  const stay = room.currentStay;
  const arrival = room.arrivalToday;
  const guest = stay ?? arrival;
  const free = room.displayStatus === "AVAILABLE" || room.displayStatus === "READY";
  const dirty = room.status === "DIRTY" || room.status === "CLEANING";
  const mins = Math.max(0, Math.round((now.getTime() - new Date(room.statusChangedAt).getTime()) / 60000));
  const since = mins < 1 ? t("just now") : span(mins, t);
  const progress = stay ? Math.min(1, Math.max(0.03, (now.getTime() - new Date(stay.startAt).getTime()) / Math.max(1, new Date(stay.endAt).getTime() - new Date(stay.startAt).getTime()))) : null;

  function submit(to: RoomStatus) {
    if (BLOCKED_STATUSES.includes(to) && !note.trim()) { setTarget(to); toast.error(t("Add a reason first.")); return; }
    startTransition(async () => {
      const res = await changeRoomStatusAction({ roomId: room.id, status: to as never, note: note || undefined });
      if (res.ok) {
        toast.success(t("Room {room}: {status}.", { room: room.number, status: t(ROOM_STATUS_META[to].label).toLowerCase() }));
        if (res.data.warning) toast.warning(res.data.warning, { duration: 10000 });
        // Cleaning steps keep the card open so the next step (check in, walk-in) is right there.
        if (!["READY", "CLEANING", "DIRTY", "MAINTENANCE"].includes(to)) onDone();
        setTarget(null); router.refresh();
      } else toast.error(res.error);
    });
  }

  const [panel, setPanel] = useState<"out" | "nights" | "pay" | "discount" | "repair" | "bill" | "transport" | "history" | "walkin" | "reserve" | "qr" | null>(null);
  const toggle = (p: NonNullable<typeof panel>) => setPanel(panel === p ? null : p);
  // One bill panel for both tiles: switching Restaurant order ⇄ Room service keeps the ticket.
  const [billStart, setBillStart] = useState<"RESTAURANT" | "ROOM_SERVICE">("RESTAURANT");
  const openBill = (start: "RESTAURANT" | "ROOM_SERVICE") => {
    if (panel === "bill" && billStart === start) setPanel(null);
    else { setBillStart(start); setPanel("bill"); }
  };
  const [moving, setMoving] = useState(false);
  // A manager moving a booking that is coming to this room (before it arrives).
  const [movingBooking, setMovingBooking] = useState<Upcoming | null>(null);
  const [checkingIn, setCheckingIn] = useState<string | null>(null);
  const todayArrival = room.upcoming.find((u) => u.arrivalDate === today) ?? null;
  const actions: React.ReactNode[] = [];
  if (stay && perms.checkOut) actions.push(<ActionTile key="out" icon={<LogOut />} tone={overdue ? "danger" : "primary"} label={overdue ? t("Check out now") : t("Check out")} hint={stay.balance > 0 ? t("Settle {amount} & free the room", { amount: formatTZS(stay.balance) }) : t("Bill is paid — free the room")} active={panel === "out"} onClick={() => setPanel(panel === "out" ? null : "out")} />);
  if (todayArrival && perms.checkIn) actions.push(<ActionTile key="in" icon={<LogIn />} tone={stay ? "plain" : "primary"} label={t("Check in {name}", { name: todayArrival.guest.fullName })}
    hint={stay ? t("After {name} checks out & it's cleaned", { name: stay.guestName.split(" ")[0] }) : dirty ? t("Clean the room, then one press") : t("Details are filled in — just confirm")}
    active={checkingIn === todayArrival.reservationRoomId} onClick={() => setCheckingIn(checkingIn === todayArrival.reservationRoomId ? null : todayArrival.reservationRoomId)} />);
  if (stay && perms.checkOut && !stay.isDayUse) actions.push(<ActionTile key="nights" icon={<CalendarPlus />} label={t("Add nights")} hint={t("Guest is staying longer")} active={panel === "nights"} onClick={() => setPanel(panel === "nights" ? null : "nights")} />);
  if (stay && perms.pay && stay.balance > 0 && methods.length) actions.push(<ActionTile key="pay" icon={<Wallet />} label={t("Receive payment")} hint={t("Owes {amount}", { amount: formatTZS(stay.balance) })} active={panel === "pay"} onClick={() => setPanel(panel === "pay" ? null : "pay")} />);
  if (stay) actions.push(<ActionTile key="roombill" href={`/staff/stay-bill?reservation=${stay.reservationId}`} icon={<FileText />} label={t("Room bill")} hint={stay.balance > 0 ? t("View, print or download · owes {amount}", { amount: formatTZS(stay.balance) }) : t("View, print or download")} />);
  // Food & drinks from the menu, and other extras, go on the bill right here — no other page.
  const canBill = !!perms.pay || (!!perms.order && !!menu);
  if (stay && perms.order && menu) actions.push(<ActionTile key="order" icon={<UtensilsCrossed />} label={t("Restaurant order")} hint={t("Pick from the menu · on the bill")} active={panel === "bill" && billStart === "RESTAURANT"} onClick={() => openBill("RESTAURANT")} />);
  if (stay && perms.discount && !stay.isDayUse) actions.push(<ActionTile key="disc" icon={<BadgePercent />} label={stay.discountPerNight ? t("Change discount") : t("Give discount")}
    hint={stay.discountPerNight ? t("{amount} off each night", { amount: formatTZS(stay.discountPerNight) }) : t("{amount} a night now", { amount: formatTZS(stay.ratePerNight) })} active={panel === "discount"} onClick={() => setPanel(panel === "discount" ? null : "discount")} />);
  if (stay && !perms.maintenanceOnly) actions.push(canBill
    ? <ActionTile key="extras" icon={<Receipt />} label={t("Room service")} hint={perms.pay ? t("Meals, drinks, laundry…") : t("Meals & drinks to the room")} active={panel === "bill" && billStart === "ROOM_SERVICE"} onClick={() => openBill("ROOM_SERVICE")} />
    : <ActionTile key="extras" href={`/staff/reservations/${stay.reservationId}#extras`} icon={<Receipt />} label={t("Room service")} hint={t("Meals, drinks, laundry…")} />);
  if (stay && perms.transport) actions.push(<ActionTile key="transport" icon={<Car />} label={t("Transport")} hint={t("Airport drop-off, a trip in town…")} active={panel === "transport"} onClick={() => toggle("transport")} />);
  actions.push(<ActionTile key="history" icon={<History />} label={t("Room history")} hint={t("Stays, moves, problems")} active={panel === "history"} onClick={() => toggle("history")} />);
  if (qr) actions.push(<ActionTile key="qr" icon={<QrCode />} label={t("Room QR code")} hint={t("Download or print the room's card")} active={panel === "qr"} onClick={() => toggle("qr")} />);
  if (stay && perms.move && !(perms.decide && !stay.isDayUse)) actions.push(<ActionTile key="move" icon={<Repeat />} label={t("Change room")} hint={t("Guest asks (pays the difference) or room problem")} active={moving} onClick={() => setMoving(true)} />);
  const nextBooked = room.upcoming[0]?.arrivalDate ?? null;
  if (free && perms.checkIn) actions.push(<ActionTile key="walkin" icon={<DoorOpen />} tone="primary" label={t("Walk-in guest")} hint={t("Check someone in to this room now")} active={panel === "walkin"} onClick={() => toggle("walkin")} />);
  if (perms.book && room.displayStatus !== "MAINTENANCE" && room.displayStatus !== "OUT_OF_SERVICE") {
    actions.push(<ActionTile key="book" icon={<CalendarPlus />} tone={free && !perms.checkIn ? "primary" : "plain"} active={panel === "reserve"} onClick={() => toggle("reserve")}
      label={stay || arrival ? t("Reserve for later dates") : t("Reserve this room")}
      hint={stay ? t("Free from {date}", { date: t.date(stay.departureDate) }) : nextBooked ? t("Free until {date}", { date: t.date(nextBooked) }) : dirty ? t("Cleaned before the guest arrives") : t("No bookings coming")} />);
  }
  if (perms.update && inRepair && !perms.decide) {
    actions.push(<ActionTile key="fixed-ready" icon={pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} tone="primary" label={t("Fixed — ready now")} hint={t("Room can be sold again")} disabled={pending} onClick={() => { setNote(""); submit("READY"); }} />);
    actions.push(<ActionTile key="fixed-dirty" icon={<SprayCan />} label={t("Fixed — needs cleaning")} hint={t("Send housekeeping first")} disabled={pending} onClick={() => { setNote(""); submit("DIRTY"); }} />);
  }
  if (perms.update && !perms.decide && !stay && !inRepair && MANUAL_TRANSITIONS[room.status].includes("MAINTENANCE")) {
    actions.push(<ActionTile key="repair" icon={<Wrench />} label={t("Under maintenance")} hint={t("Off sale while it's fixed")} active={panel === "repair"} onClick={() => setPanel(panel === "repair" ? null : "repair")} />);
  }
  if (perms.update && !perms.maintenanceOnly && room.status === "DIRTY") actions.push(<ActionTile key="clean" icon={<BrushCleaning />} label={t("Start cleaning")} hint={t("Housekeeping is going in")} disabled={pending} onClick={() => submit("CLEANING")} />);
  if (perms.update && !perms.maintenanceOnly && dirty) actions.push(<ActionTile key="ready" icon={pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} tone="primary" wide={room.status === "CLEANING"} label={t("Mark clean & ready")} hint={t("Room can be sold again")} disabled={pending} onClick={() => submit("READY")} />);

  return (
    <>
      {moving && stay && perms.move && (
        <ChangeRoomDialog reservationId={stay.reservationId} reservationRoomId={stay.reservationRoomId} guest={stay.guestName} methods={perms.pay ? methods : []}
          inHouse onClose={() => { setMoving(false); onDone(); }} />
      )}
      {movingBooking && (
        <ChangeRoomDialog reservationId={movingBooking.reservationId} reservationRoomId={movingBooking.reservationRoomId} guest={movingBooking.guest.fullName} methods={[]}
          inHouse={false} hotelFirst onClose={() => { setMovingBooking(null); router.refresh(); }} />
      )}
      {watching && <InsightHeader room={room} overdue={overdue} data={insight} />}
      {/* Photo header (the room page shows its own) */}
      {!onPage && !watching && (
      <div className="relative h-44 overflow-hidden bg-[#17130e] sm:h-52">
        {room.roomType.photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={room.roomType.photo} alt="" className="absolute inset-0 size-full object-cover opacity-80" />
        )}
        <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/35 to-black/10" />
        {!onPage && (
          <DialogClose render={<button type="button" aria-label={t("Close")} className="absolute right-3 top-3 grid size-8 place-items-center rounded-full bg-black/40 text-white backdrop-blur transition-colors hover:bg-black/60" />}>
            <span aria-hidden className="text-lg leading-none">×</span>
          </DialogClose>
        )}
        <span className={cn("absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/35 px-2.5 py-1 text-xs font-medium text-white backdrop-blur",
          overdue && "border-rose-400/60")}>
          <span className={cn("size-2 rounded-full", overdue ? "bg-rose-500" : meta.dot)} />{overdue ? t("Checkout overdue") : t(meta.label)}
        </span>
        <div className="absolute inset-x-0 bottom-0 p-5 text-white">
          <Title onPage={onPage} className="text-4xl font-semibold leading-none tracking-tight tabular-nums text-white">{t("Room {room}", { room: room.number })}</Title>
          <Desc onPage={onPage} className="mt-1.5 text-sm text-white/75">
            {t(room.roomType.name)} · {t("{amount} / night", { amount: formatTZS(room.roomType.baseRate) })}
          </Desc>
        </div>
      </div>

      )}
      <div className="space-y-5 p-5">
        {watching && <InsightRows data={insight} />}
        {/* Who is here (the room page shows its own guest card) */}
        {onPage ? null : guest ? (
          <div className="space-y-3">
            <div className="flex items-center gap-3">
              <span className={cn("grid size-11 shrink-0 place-items-center rounded-full text-sm font-semibold text-white", overdue ? "bg-rose-500" : stay ? "bg-sky-500" : "bg-amber-500")}>
                {guest.guestName.replace(/\(.*\)/, "").trim().split(/\s+/).map((x) => x[0]).slice(0, 2).join("").toUpperCase()}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-base font-semibold">{guest.guestName}</p>
                <p className="truncate text-xs text-muted-foreground">
                  {stay ? t("In the room") : t("Arriving today")} · <span className="font-mono">{guest.reference}</span>
                  {guest.guestPhone && <> · <a href={`tel:${guest.guestPhone}`} className="underline-offset-2 hover:underline">{guest.guestPhone}</a></>}
                </p>
                {/* The same customer at a restaurant table right now, and their restaurant on this room's bill. */}
                {stay && (stay.table || stay.restaurantOnRoom > 0) && (
                  <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-xs">
                    {stay.table && <span className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 font-semibold text-amber-800 dark:text-amber-300"><UtensilsCrossed className="size-3" />{t("At {table} now", { table: stay.table })}</span>}
                    {stay.restaurantOnRoom > 0 && <span className="text-muted-foreground">{t("Food & drinks on the bill")} · <span className="tabular-nums">{formatTZS(stay.restaurantOnRoom)}</span></span>}
                  </p>
                )}
              </div>
            </div>
            <dl className="grid grid-cols-3 gap-2 text-center">
              <div className="rounded-xl bg-muted/70 px-2 py-2.5"><dt className="text-[11px] text-muted-foreground">{t("Check-in")}</dt><dd className="mt-0.5 text-sm font-semibold">{t.date(guest.arrivalDate)}<span className="block text-xs font-normal text-muted-foreground">{hhmm(guest.startAt)}</span></dd></div>
              <div className={cn("rounded-xl px-2 py-2.5", overdue ? "bg-rose-500/10" : "bg-muted/70")}><dt className="text-[11px] text-muted-foreground">{t("Checkout")}</dt><dd className={cn("mt-0.5 text-sm font-semibold", overdue && "text-rose-600 dark:text-rose-400")}>{t.date(guest.departureDate)}<span className="block text-xs font-normal">{hhmm(guest.endAt)}</span></dd></div>
              <div className={cn("rounded-xl px-2 py-2.5", guest.balance > 0 ? "bg-rose-500/10" : "bg-emerald-500/10")}><dt className="text-[11px] text-muted-foreground">{t("Balance")}</dt><dd className={cn("mt-0.5 text-sm font-semibold tabular-nums", guest.balance > 0 ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>{guest.balance > 0 ? formatTZS(guest.balance).replace("TZS ", "") : t("Paid")}</dd></div>
            </dl>
            {progress != null && (
              <div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className={cn("h-full rounded-full", overdue ? "bg-rose-500" : "bg-sky-500")} style={{ width: `${Math.round(progress * 100)}%` }} /></div>
                <p className="mt-1 text-[11px] text-muted-foreground">{overdue ? t("Past checkout time — check out or add nights") : t("{pct}% of the stay done", { pct: Math.round(progress * 100) })}</p>
              </div>
            )}
          </div>
        ) : (
          <div className="flex items-center gap-3 rounded-2xl bg-muted/60 p-4">
            <span className={cn("grid size-11 shrink-0 place-items-center rounded-full", dirty ? "bg-orange-500/15 text-orange-600 dark:text-orange-300" : inRepair ? "bg-rose-500/15 text-rose-600 dark:text-rose-300" : "bg-emerald-500/15 text-emerald-600 dark:text-emerald-300")}>
              {dirty ? <SprayCan className="size-5" /> : inRepair ? <Wrench className="size-5" /> : <BedDouble className="size-5" />}
            </span>
            <div>
              <p className="font-semibold">{free ? t("Empty and ready for a guest") : dirty ? (room.status === "CLEANING" ? t("Housekeeping is cleaning") : t("Needs cleaning")) : room.status === "MAINTENANCE" ? `${t("Under maintenance")}${room.statusNote ? ` — ${t(room.statusNote)}` : ""}` : `${t("Out of service")}${room.statusNote ? ` — ${t(room.statusNote)}` : ""}`}</p>
              <p className="text-xs text-muted-foreground">{dirty ? t("Waiting {since}", { since }) : inRepair ? (mins < 1 ? t("Off sale {since} · since {when}", { since, when: t.dateTime(room.statusChangedAt) }) : t("Off sale for {since} · since {when}", { since, when: t.dateTime(room.statusChangedAt) })) : t("Since {when}", { when: t.dateTime(room.statusChangedAt) })}</p>
            </div>
          </div>
        )}

        {room.statusNote && !stay && !inRepair && <p className="rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted-foreground">{t("Note: {note}", { note: t(room.statusNote) })}</p>}

        {perms.decide && (
          <RoomDecisions key={`${room.id}-${stay?.reservationRoomId ?? "free"}`} today={today} leavingToday={!!stay && stay.departureDate <= today}
            room={{ id: room.id, number: room.number, status: room.status, meeting: false }}
            stay={stay ? { reservationId: stay.reservationId, reservationRoomId: stay.reservationRoomId, guestName: stay.guestName, isDayUse: stay.isDayUse, ratePerNight: stay.ratePerNight, discountPerNight: stay.discountPerNight, nights: stay.nights, endAt: new Date(stay.endAt).toISOString(), balance: stay.balance, leaveOwing: stay.leaveOwing } : null}
            upcoming={room.upcoming.map((u) => ({ reservationId: u.reservationId, reservationRoomId: u.reservationRoomId, name: u.company ?? u.guest.fullName, when: u.arrivalDate === today ? "today" : t.shortDate(u.arrivalDate) }))}
            heldNoShow={room.heldNoShow} closures={room.closures} serviceWaiter={room.serviceWaiter}
            can={{ move: !!perms.move, close: perms.update, block: perms.block, release: !!perms.release, decide: perms.decide }} />
        )}
        {watching && <InsightHistory data={insight} room={room} />}

        {actions.length > 0 && <div className="grid grid-cols-2 gap-2">{actions}</div>}

        {stay && panel === "out" && (
          <CheckOutHere key={stay.reservationId} stay={stay} roomNumber={room.number} methods={methods} canPay={!!perms.pay} canCharge={!!perms.order} canDiscount={!!perms.discount} discountMax={(perms.discountMax === undefined ? DESK_DISCOUNT_MAX : perms.discountMax)}
            nextGuest={todayArrival?.guest.fullName ?? null}
            onDone={() => { setPanel(null); if (todayArrival) setCheckingIn(todayArrival.reservationRoomId); router.refresh(); }} />
        )}
        {stay && panel === "bill" && (
          <div className="rounded-2xl border border-border/70 bg-muted/20 p-3 sm:p-4">
            <ChargeComposer reservationId={stay.reservationId} roomLabel={room.number} recent={recent} methods={methods} canPay={!!perms.pay} canType={!!perms.pay}
              menu={perms.order ? menu : null} menuPayNow={!!perms.orderPayNow} startType={billStart}
              onPosted={() => setPanel(null)} />
          </div>
        )}
        {stay && panel === "discount" && (
          <DiscountEditor key={stay.reservationRoomId} reservationId={stay.reservationId} canEdit defaultOpen max={(perms.discountMax === undefined ? DESK_DISCOUNT_MAX : perms.discountMax)} onSaved={() => setPanel(null)}
            room={{ id: stay.reservationRoomId, number: room.number, ratePerNight: stay.ratePerNight, discountPerNight: stay.discountPerNight, nights: stay.nights }} />
        )}
        {stay && panel === "nights" && (
          <div className="rounded-2xl border border-border/70 bg-muted/30 p-4">
            <ExtendStay reservationId={stay.reservationId} today={today} canDiscount={!!perms.discount} discountMax={(perms.discountMax === undefined ? DESK_DISCOUNT_MAX : perms.discountMax)}
              room={{ id: stay.reservationRoomId, number: room.number, departure: stay.departureDate, endAt: new Date(stay.endAt).toISOString(), ratePerNight: stay.ratePerNight, discountPerNight: stay.discountPerNight, nights: stay.nights }} />
          </div>
        )}
        {panel === "repair" && (
          <div className="space-y-3 rounded-2xl border border-rose-500/30 bg-rose-500/[0.05] p-4">
            <p className="flex items-center gap-2 text-sm font-semibold"><Wrench className="size-4 text-rose-600" />{t("Put room {room} under maintenance", { room: room.number })}</p>
            <div className="flex flex-wrap gap-1.5">
              {REPAIRS.map((r) => (
                <button key={r} type="button" aria-pressed={note === r} onClick={() => setNote(note === r ? "" : r)}
                  className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", note === r ? "border-rose-600 bg-rose-600 text-white" : "border-border bg-card hover:bg-muted")}>{t(r)}</button>
              ))}
            </div>
            <Input value={REPAIRS.includes(note) ? "" : note} onChange={(e) => setNote(e.target.value)} placeholder={t("Or write what is wrong…")} className="h-9 bg-card" />
            {room.upcoming.length > 0 && (
              <p className="text-xs text-amber-700 dark:text-amber-400">{t.plural(room.upcoming.length, "{n} booking is coming to this room — move it to another room after.", "{n} bookings are coming to this room — move them to another room after.")}</p>
            )}
            <Button className="w-full bg-rose-600 text-white hover:bg-rose-500" disabled={pending || !note.trim()} onClick={() => { submit("MAINTENANCE"); setPanel(null); }}>
              {pending ? <Loader2 className="animate-spin" /> : <Wrench />}{t("Put under maintenance")}
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">{t("The room can't be reserved or checked into until you mark it fixed.")}</p>
          </div>
        )}
        {stay && panel === "pay" && !stay.isDayUse && perms.discount && (perms.discountMax ?? 0) > 0 && (
          <DiscountEditor key={`pay-${stay.discountPerNight}`} reservationId={stay.reservationId} canEdit max={perms.discountMax ?? DESK_DISCOUNT_MAX}
            room={{ id: stay.reservationRoomId, number: room.number, ratePerNight: stay.ratePerNight, discountPerNight: stay.discountPerNight, nights: stay.nights }} />
        )}
        {stay && panel === "pay" && <PayHere reservationId={stay.reservationId} balance={stay.balance} methods={methods} phone={stay.guestPhone} who={stay.guestName} onDone={() => setPanel(null)} />}

        {panel === "history" && <RoomHistoryInline roomId={room.id} roomNumber={room.number} />}
        {panel === "qr" && qr && <RoomQrBox room={room} qr={qr} />}
        {stay && panel === "transport" && <TransportInline reservationId={stay.reservationId} today={today} onDone={() => setPanel(null)} />}
        {panel === "walkin" && (
          <QuickBook room={{ id: room.id, number: room.number, typeId: room.roomType.id, typeName: room.roomType.name }} mode="walkIn" today={today}
            methods={methods} canPay={!!perms.pay} onDone={() => { setPanel(null); onDone(); }} />
        )}
        {panel === "reserve" && (
          <QuickBook room={{ id: room.id, number: room.number, typeId: room.roomType.id, typeName: room.roomType.name }} mode="reserve" today={today}
            from={stay ? stay.departureDate : null} methods={methods} canPay={!!perms.pay} onDone={() => setPanel(null)} />
        )}

        {room.upcoming.length > 0 && (
          <div>
            <p className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground"><CalendarClock className="size-3.5" />{t("Coming up in this room")}</p>
            <ul className="divide-y divide-border rounded-2xl border border-border/70">
              {room.upcoming.map((u) => {
                const open = checkingIn === u.reservationRoomId;
                return (
                  <li key={u.reservationRoomId}>
                    <button type="button" onClick={() => setCheckingIn(open ? null : u.reservationRoomId)} aria-expanded={open}
                      className={cn("flex w-full items-center gap-3 px-3 py-2.5 text-left text-sm transition-colors hover:bg-muted/60", open && "bg-muted/60")}>
                      <span className={cn("grid w-12 shrink-0 place-items-center rounded-lg py-1 text-center leading-tight", u.arrivalDate === today ? "bg-amber-500/15 text-amber-700 dark:text-amber-300" : "bg-muted")}>
                        <span className="text-[10px] uppercase opacity-70">{u.arrivalDate === today ? t("Today") : new Date(`${u.arrivalDate}T00:00:00Z`).toLocaleDateString(t.intl, { month: "short", timeZone: "UTC" })}</span>
                        <span className="text-base font-semibold tabular-nums">{Number(u.arrivalDate.slice(8))}</span>
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{u.guest.fullName}</span>
                        <span className="block truncate text-xs text-muted-foreground">{t.date(u.arrivalDate)} → {t.date(u.departureDate)} · {t.plural(u.nights, "{n} night", "{n} nights")}{u.eta ? ` · ~${u.eta}` : ""}</span>
                      </span>
                      {perms.checkIn && <span className="shrink-0 rounded-lg border border-border px-2 py-1 text-[11px] font-medium">{open ? t("Close") : t("Check in")}</span>}
                    </button>
                    {perms.decide && perms.move && (
                      <div className="flex justify-end px-3 pb-2">
                        <button type="button" onClick={() => setMovingBooking(u)} className="inline-flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-[11px] font-semibold hover:bg-muted"><Repeat className="size-3" />{t("Move to another room")}</button>
                      </div>
                    )}
                    {open && perms.checkIn && (
                      <CheckInHere booking={u} room={room} today={today} occupiedBy={stay} canEditDates={perms.checkOut} canClean={perms.update}
                        onMarkReady={() => submit("READY")} cleaning={pending} onDone={() => { setCheckingIn(null); onDone(); router.refresh(); }} />
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        )}

        {perms.update && !perms.maintenanceOnly && transitions.length > 0 && (
          <details className="group rounded-2xl border border-border/70 p-3">
            <summary className="cursor-pointer list-none text-sm font-medium">{t("Change housekeeping status")} <span className="text-xs font-normal text-muted-foreground group-open:hidden">{t("— maintenance, out of service…")}</span></summary>
            <div className="mt-3 space-y-3">
              {(perms.block || target) && (
                <div className="space-y-1.5">
                  <Label htmlFor="room-note">{target && BLOCKED_STATUSES.includes(target) ? t("Note (required)") : t("Note (optional)")}</Label>
                  <Textarea id="room-note" rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("e.g. AC not cooling, plumber called")} />
                </div>
              )}
              <div className="grid grid-cols-2 gap-2">
                {transitions.map((s) => (
                  <Button key={s} variant="outline" disabled={pending} onClick={() => submit(s)} className="justify-start">
                    <span className={cn("size-2 rounded-full", ROOM_STATUS_META[s].dot)} />{t(ROOM_STATUS_META[s].label)}
                  </Button>
                ))}
              </div>
            </div>
          </details>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3 text-xs text-muted-foreground">
          {guest ? <Link href={`/staff/reservations/${guest.reservationId}`} className="font-medium text-[oklch(0.55_0.11_76)] underline-offset-4 hover:underline dark:text-gold">{t("Open booking {ref} →", { ref: guest.reference })}</Link> : <span />}
          {onPage ? (room.roomType.photo && <span>{t("Photo: a {type} room", { type: t(room.roomType.name) })}</span>) : <Link href={`/staff/rooms/${room.id}`} className="font-medium underline-offset-4 hover:underline">{t("Open room page →")}</Link>}
        </div>
      </div>
    </>
  );
}

/**
 * Check the guest out from the room card: the exact final bill (same engine as
 * the checkout screen), take the payment and free the room in one press — both
 * happen or neither. The room then goes to cleaning; the next guest can be
 * checked in once it is marked clean.
 */
export function CheckOutHere({ stay, roomNumber, methods, canPay, canCharge, canDiscount, discountMax, nextGuest, onDone, bare = false }: {
  stay: NonNullable<RoomBoardRoom["currentStay"]>; roomNumber: string; methods: PayAccount[]; canPay: boolean; canDiscount: boolean; discountMax: number | null; nextGuest: string | null; onDone: () => void;
  /** In a window that already names the guest: no title of its own, no frame. */
  bare?: boolean;
  /** May put the guest's open restaurant orders on this room. */
  canCharge: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [bill, setBill] = useState<CheckOutPreview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [amount, setAmount] = useState("");
  const [accountId, setAccountId] = useState(methods[0]?.id ?? "");
  const [reference, setReference] = useState("");
  const [reason, setReason] = useState("");
  const [invoiceMode, setInvoiceMode] = useState<"ISSUE" | "OPEN" | null>(null);
  const [pending, start] = useTransition();
  useEffect(() => {
    let alive = true;
    previewCheckOutAction({ reservationId: stay.reservationId }).then((r) => {
      if (!alive) return;
      if (r.ok) { setBill(r.data); setAmount(r.data.balance > 0 ? String(r.data.balance) : ""); } else setError(r.error);
    });
    return () => { alive = false; };
  }, [stay.reservationId, stay.balance]); // a discount or payment changes the balance → recompute the bill

  const first = stay.guestName.split(" ")[0];
  const owes = (bill?.balance ?? 0) > 0;
  const paying = Number(amount) || 0;
  const short = owes && paying < bill!.balance;
  // A manager allowed the guest to leave owing: check out without the full payment (any payment taken is recorded).
  const approvedOwing = owes && !!stay.leaveOwing && bill!.balance <= stay.leaveOwing.upTo;
  const ready = !!bill && (!owes || approvedOwing || (canPay && !short && !!accountId)) && (!bill.early || !!reason.trim());

  function go() {
    if (!bill) return;
    start(async () => {
      const res = await settleCheckOutAction({
        reservationId: stay.reservationId, chargeOverstay: true, earlyReason: bill.early ? reason : undefined,
        payment: owes && (!approvedOwing || (paying > 0 && accountId)) ? { amount: approvedOwing ? Math.min(paying, bill.balance) : bill.balance, accountId, reference: reference || undefined } : null,
        ...(approvedOwing && { allowBalance: true }),
        invoiceMode: bill.company && !bill.group ? invoiceMode ?? (bill.company.consolidate ? "OPEN" : "ISSUE") : null,
      });
      if (res.ok && bill.group?.last) {
        // The last room of its group: the receptionist confirms the final group invoice next.
        toast.success(t("{name} checked out — the last room of {group}.", { name: stay.guestName, group: bill.group.name }));
        router.push(`/staff/groups/${bill.group.id}?final=1`);
        return;
      }
      if (res.ok) {
        const inv = res.data.invoice;
        const invoiced = inv ? `${inv.issued ? t("{amount} invoiced to the company · {number}.", { amount: formatTZS(inv.amount), number: inv.number }) : t("{amount} added to the company's open invoice {number}.", { amount: formatTZS(inv.amount), number: inv.number })} ` : "";
        toast.success(owes ? t("{name} checked out · {amount} received.", { name: stay.guestName, amount: formatTZS(bill.balance) }) : t("{name} checked out.", { name: stay.guestName }), {
          description: `${invoiced}${nextGuest ? t("Room {room} now needs cleaning — then check in {name}.", { room: roomNumber, name: nextGuest }) : t("Room {room} now needs cleaning.", { room: roomNumber })}`,
          duration: 9000,
          // The guest's thank-you note is made at check-out: print or send it from here.
          action: { label: t("Thank-you note"), onClick: () => router.push(`/staff/reservations/${stay.reservationId}/thank-you`) },
        });
        onDone();
      } else toast.error(res.error, { duration: 9000 });
    });
  }

  const line = (label: string, v: number, cls?: string) => (
    <div className={cn("flex justify-between gap-3", cls)}><span>{label}</span><span className="tabular-nums">{v < 0 ? `− ${formatTZS(-v)}` : formatTZS(v)}</span></div>
  );
  return (
    <div className={cn("space-y-3 text-sm", !bare && "rounded-2xl border border-border/70 bg-muted/30 p-4")}>
      {!bare && <p className="flex items-center gap-2 font-semibold"><LogOut className="size-4" />{t("Check out {name}", { name: stay.guestName })}</p>}
      {error ? <p className="text-rose-600 dark:text-rose-400">{error}</p> : !bill ? (
        <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("Working out the final bill…")}</p>
      ) : (
        <>
          <div className="space-y-1 text-xs text-muted-foreground">
            {line(t("Room charges"), bill.gross - bill.overstayAmount)}
            {bill.discount > 0 && line(t("Discount"), -bill.discount, "text-emerald-600 dark:text-emerald-400")}
            {bill.chargesByKind.restaurant !== 0 && line(t("Restaurant"), bill.chargesByKind.restaurant)}
            {/* Each table's order on the bill: "Restaurant — Outside 3 · #184". */}
            {bill.orders.filter((o) => !o.roomService).map((o) => <Fragment key={o.id}>{line(o.label, o.amount, "pl-3 text-[11px]")}</Fragment>)}
            {bill.chargesByKind.roomService !== 0 && line(t("Room service"), bill.chargesByKind.roomService)}
            {bill.chargesByKind.bar !== 0 && line(t("Bar & minibar"), bill.chargesByKind.bar)}
            {bill.chargesByKind.transport !== 0 && line(t("Transport"), bill.chargesByKind.transport)}
            {bill.chargesByKind.other !== 0 && line(t("Other charges"), bill.chargesByKind.other)}
            {bill.chargesByKind.discount !== 0 && line(t("Discount on the bill"), bill.chargesByKind.discount)}
            {bill.overstayNights > 0 && line(t.plural(bill.overstayNights, "Stayed past checkout · {n} extra night", "Stayed past checkout · {n} extra nights"), bill.overstayAmount, "text-rose-600 dark:text-rose-400")}
            {bill.paid > 0 && line(t("Paid so far"), -bill.paid)}
            {bill.company && bill.company.billedBefore > 0 && line(t("Already on {company}'s invoice", { company: bill.company.name }), -bill.company.billedBefore)}
            {bill.company && bill.company.billedNow !== 0 && line(t("{company} · invoice", { company: bill.company.name }), -bill.company.billedNow, "font-medium text-[oklch(0.5_0.12_75)] dark:text-[#f0cf86]")}
            <div className="flex justify-between border-t border-dashed border-border pt-1.5 text-sm font-semibold text-foreground">
              <span>{owes ? (bill.company ? t("Guest pays now") : t("Outstanding — pay to check out")) : bill.balance < 0 ? t("Credit to return") : t("Ready to check out")}</span>
              <span className={cn("tabular-nums", owes ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>{owes ? formatTZS(bill.balance) : bill.balance < 0 ? formatTZS(-bill.balance) : t("Paid in full")}</span>
            </div>
          </div>
          <OpenOrdersNote reservationId={stay.reservationId} room={roomNumber} orders={bill.openOrders} canCharge={canCharge} />
          {canDiscount && !stay.isDayUse && (
            <DiscountEditor key={stay.discountPerNight} reservationId={stay.reservationId} canEdit max={discountMax}
              room={{ id: stay.reservationRoomId, number: roomNumber, ratePerNight: stay.ratePerNight, discountPerNight: stay.discountPerNight, nights: stay.nights }} />
          )}
          {bill.overstayNights > 0 && <p className="text-[11px] text-muted-foreground">{t.rich("To waive the extra night, use the <link>full checkout screen</link> (manager).", { link: (c) => <Link href={`/staff/check-out?id=${stay.reservationId}#workspace`} className="underline">{c}</Link> })}</p>}

          {bill.group ? (
            <p className={cn("rounded-xl border p-2.5 text-xs", bill.group.last ? "border-violet-500/40 bg-violet-500/[0.08]" : "border-border/70 bg-muted/40")}>
              <strong>{bill.group.last ? t("Final group check-out") : t("Group check-out in progress")}</strong> · {t("{group} — the bill goes to {payer}.", { group: bill.group.name, payer: bill.group.payer })}{" "}
              {bill.group.finalized ? t("The final invoice is already made; this shows as an adjustment.") : bill.group.last ? t("This is the last active guest: you'll confirm the final invoice next.") : t.plural(bill.group.remaining, "{n} other room still staying or to come.", "{n} other rooms still staying or to come.")}
            </p>
          ) : bill.company && bill.company.billedNow !== 0 && (
            <CompanyBillBox company={bill.company} mode={invoiceMode ?? (bill.company.consolidate ? "OPEN" : "ISSUE")} onMode={setInvoiceMode} />
          )}

          {bill.early && (
            <div className="space-y-1"><Label htmlFor="co-why" className="text-xs">{t("Leaving early — why?")}</Label>
              <Input id="co-why" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("e.g. change of plans")} className="h-9" /></div>
          )}

          {owes && (canPay && methods.length ? (
            <div className="space-y-2">
              {/* The guest pays by mobile money from their phone: once recorded, the bill above updates — then check out. */}
              {stay.balance > 0 && <SendToPhone target={{ kind: "stay", reservationId: stay.reservationId }} amount={Math.min(bill.balance, stay.balance)} editableAmount phone={stay.guestPhone} who={stay.guestName} primary />}
              {stay.balance > 0 && bill.balance > stay.balance && <p className="text-[11px] text-muted-foreground">{t.plural(bill.overstayNights, "The mobile money request covers up to {amount} — the extra night ({extra}) are received at check-out.", "The mobile money request covers up to {amount} — the extra nights ({extra}) are received at check-out.", { amount: formatTZS(stay.balance), extra: formatTZS(bill.balance - stay.balance) })}</p>}
              <OtherWays label={t("Or receive cash, LIPA or bank")} fold={stay.balance > 0}>
              <div className="flex flex-wrap gap-1.5">
                {methods.map((m) => (
                  <button key={m.id} type="button" onClick={() => setAccountId(m.id)} aria-pressed={accountId === m.id}
                    className={cn("rounded-lg border px-2.5 py-1 text-xs font-medium", accountId === m.id ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted")}>{t(m.name)}</button>
                ))}
              </div>
              <div className="grid grid-cols-2 gap-2">
                <Input aria-label={t("Amount received")} type="number" min={0} step={1000} value={amount} onChange={(e) => setAmount(e.target.value)} className="h-9" />
                <Input aria-label={t("Reference")} value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("M-Pesa code, receipt…")} className="h-9" />
              </div>
              </OtherWays>
              {approvedOwing && <p className="rounded-lg bg-emerald-500/10 px-2.5 py-1.5 text-[11px] text-emerald-800 dark:text-emerald-300">{t("A manager allowed {name} to leave owing — {reason}. Receive what they can pay (or nothing); the rest stays on their account.", { name: first, reason: stay.leaveOwing!.reason })}</p>}
              {short && !approvedOwing && <p className="text-[11px] text-amber-700 dark:text-amber-400">{t.rich("Receive the full {amount} to check out here. Company bills or leaving a balance: use the <link>full checkout screen</link>.", { link: (c) => <Link href={`/staff/check-out?id=${stay.reservationId}#workspace`} className="underline">{c}</Link> }, { amount: formatTZS(bill.balance) })}</p>}
            </div>
          ) : <p className="text-xs text-amber-700 dark:text-amber-400">{t("The guest still owes {amount} — someone who can receive payments must settle it first.", { amount: formatTZS(bill.balance) })}</p>)}

          <Button type="button" className="h-10 w-full" disabled={!ready || pending} onClick={go}>
            {pending ? <Loader2 className="animate-spin" /> : owes ? <Wallet /> : bill.company?.billedNow ? <FileText /> : <LogOut />}
            {owes && approvedOwing ? t("Check out {name} · leaves owing {amount}", { name: first, amount: formatTZS(Math.max(0, bill.balance - (accountId ? paying : 0))) }) : owes ? t("Receive {amount} & check out {name}", { amount: formatTZS(bill.balance), name: first }) : bill.group ? (bill.group.last ? t("Final group check-out") : t("Check out {name} · bill to group", { name: first })) : bill.company?.billedNow ? ((invoiceMode ?? (bill.company.consolidate ? "OPEN" : "ISSUE")) === "ISSUE" ? t("Check out & issue invoice") : t("Check out & bill company")) : t("Check out {name}", { name: first })}
          </Button>
          <p className="text-center text-[11px] text-muted-foreground">{nextGuest ? t("Room {room} goes to cleaning; then check in {name} here.", { room: roomNumber, name: nextGuest }) : t("Room {room} goes to cleaning.", { room: roomNumber })}</p>
        </>
      )}
    </div>
  );
}

/** A compact action: small icon, label and a short hint. Link or button. */
function ActionTile({ href, onClick, icon, label, hint, tone = "plain", active, disabled }: {
  href?: string; onClick?: () => void; icon: React.ReactNode; label: string; hint?: string; tone?: "plain" | "primary" | "danger"; wide?: boolean; active?: boolean; disabled?: boolean;
}) {
  const cls = cn("flex min-w-0 items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left transition-colors disabled:pointer-events-none disabled:opacity-60",
    tone === "primary" ? "border-transparent bg-foreground text-background hover:opacity-90"
      : tone === "danger" ? "border-transparent bg-rose-600 text-white hover:bg-rose-500"
      : cn("border-border bg-card hover:bg-muted", active && "border-foreground/40 bg-muted"));
  const body = (
    <>
      <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg [&_svg]:size-4", tone === "plain" ? "bg-muted text-foreground/80" : "bg-white/15 dark:bg-black/10")}>{icon}</span>
      <span className="min-w-0 leading-tight">
        <span className="block truncate text-[13px] font-medium">{label}</span>
        {hint && <span className={cn("block truncate text-[11px]", tone === "plain" ? "text-muted-foreground" : "opacity-70")}>{hint}</span>}
      </span>
    </>
  );
  return href ? <Link href={href} className={cls}>{body}</Link> : <button type="button" onClick={onClick} disabled={disabled} aria-pressed={active} className={cls}>{body}</button>;
}

type Upcoming = RoomBoardRoom["upcoming"][number];

/**
 * Check a booked guest in without leaving the room card: details come from the
 * booking (editable), an early arrival moves to today, and anything that
 * blocks the check-in (guest still in the room, room not clean) is shown with
 * its one-click fix.
 */
function CheckInHere({ booking, room, today, occupiedBy, canEditDates, canClean, onMarkReady, cleaning, onDone }: {
  booking: Upcoming; room: RoomBoardRoom; today: string; occupiedBy: RoomBoardRoom["currentStay"]; canEditDates: boolean; canClean: boolean;
  onMarkReady: () => void; cleaning: boolean; onDone: () => void;
}) {
  const t = useT();
  const [g, setG] = useState({
    fullName: booking.guest.fullName, phone: booking.guest.phone ?? "", idType: booking.guest.idType ?? "",
    idNumber: booking.guest.idNumber ?? "", nationality: booking.guest.nationality ?? "",
  });
  const router = useRouter();
  const [pending, start] = useTransition();
  const early = booking.arrivalDate > today;
  const notClean = room.status === "DIRTY" || room.status === "CLEANING";
  const cleanAndIn = notClean && canClean && !occupiedBy;
  const blocked = !!occupiedBy || (notClean && !canClean) || (early && !canEditDates) || room.status === "MAINTENANCE" || room.status === "OUT_OF_SERVICE";
  const missing = !g.fullName.trim() || !g.idNumber.trim();
  const set = (k: keyof typeof g) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setG({ ...g, [k]: e.target.value });

  function go() {
    start(async () => {
      const res = await checkInHereAction({ reservationId: booking.reservationId, reservationRoomId: booking.reservationRoomId, moveArrivalToToday: early, markReady: cleanAndIn, guest: g });
      if (res.ok) {
        toast.success(t("{name} checked in to room {room}.", { name: g.fullName, room: room.number }), {
          description: t("Checkout {date} at 11:00", { date: t.date(booking.departureDate) }), duration: 12000,
          action: { label: t("Send welcome"), onClick: () => router.push(`/staff/reservations/${booking.reservationId}?sent=welcome#message`) },
        });
        onDone();
      }
      else toast.error(res.error, { duration: 9000 });
    });
  }

  return (
    <div className="space-y-3 border-t border-border/70 bg-muted/30 p-3">
      {occupiedBy && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-rose-500/30 bg-rose-500/10 p-2.5 text-xs text-rose-700 dark:text-rose-300">
          <span className="min-w-0 flex-1">{t.rich("<b>{name}</b> is still in room {room}. Check them out first — two guests can't share the room.", { b: (c) => <strong>{c}</strong> }, { name: occupiedBy.guestName, room: room.number })}</span>
          <Link href={`/staff/check-out?id=${occupiedBy.reservationId}#workspace`} className="shrink-0 rounded-lg bg-rose-600 px-2.5 py-1 font-semibold text-white hover:bg-rose-500">{t("Check out {name}", { name: occupiedBy.guestName.split(" ")[0] })}</Link>
        </div>
      )}
      {!occupiedBy && notClean && (
        <div className="flex flex-wrap items-center gap-2 rounded-xl border border-orange-500/30 bg-orange-500/10 p-2.5 text-xs text-orange-800 dark:text-orange-200">
          <span className="min-w-0 flex-1">
            {room.status === "CLEANING" ? t("Housekeeping is cleaning the room.") : t("The room still needs cleaning.")}{" "}
            {canClean ? t("When it's done, press the button below — the room is marked clean and the guest checked in, in one step.") : t("Ask housekeeping to mark it clean first.")}
          </span>
          {canClean && <button type="button" disabled={cleaning} onClick={onMarkReady} className="shrink-0 rounded-lg border border-orange-500/40 px-2.5 py-1 font-medium">{t("Only mark clean")}</button>}
        </div>
      )}
      {early && (
        <p className="rounded-xl border border-dashed border-border px-2.5 py-2 text-xs text-muted-foreground">
          {t.rich("Booked from <b>{date}</b>. Checking in now moves the arrival to today — the extra night is added to the bill.", { b: (c) => <strong className="text-foreground">{c}</strong> }, { date: t.date(booking.arrivalDate) })}
          {!canEditDates && ` ${t("Ask a supervisor to change the dates.")}`}
        </p>
      )}
      <div className="grid grid-cols-2 gap-2">
        <div className="col-span-2 space-y-1"><Label className="text-[11px]">{t("Full name *")}</Label><Input value={g.fullName} onChange={set("fullName")} className="h-9" /></div>
        <div className="col-span-2 space-y-1"><Label className="text-[11px]">{t("Phone")}</Label><Input value={g.phone} onChange={set("phone")} className="h-9" /></div>
        <div className="col-span-2 space-y-1"><Label className="text-[11px]">{t("ID *")}</Label>
          <IdPicker size="sm" type={g.idType} number={g.idNumber} invalid={!g.idNumber.trim()}
            onType={(v) => setG((x) => ({ ...x, idType: v }))} onNumber={(v) => setG((x) => ({ ...x, idNumber: v }))} /></div>
        <div className="col-span-2 space-y-1"><Label className="text-[11px]">{t("Nationality")}</Label>
          <NationalityPicker size="sm" value={g.nationality} onChange={(v) => setG((x) => ({ ...x, nationality: v }))} /></div>
      </div>
      <Button className="h-10 w-full" disabled={pending || blocked || missing} onClick={go}>
        {pending ? <Loader2 className="animate-spin" /> : cleanAndIn ? <BrushCleaning /> : <LogIn />}
        {cleanAndIn ? (early ? t("Room is clean — check in early now") : t("Room is clean — check in now")) : early ? t("Check in early — now") : t("Check in now")}
      </Button>
      {missing && !blocked && <p className="text-center text-[11px] text-amber-700 dark:text-amber-400">{t("Add the ID number to check in.")}</p>}
    </div>
  );
}

/**
 * Room board card for a meeting room (e.g. Room 102): today's meetings with Start /
 * Complete, and links to the booking, a new meeting booking and the meeting room page.
 * Food, drinks and payments are taken on the booking (same folio as a guest's).
 */
function MeetingRoomPanel({ room, perms, today, methods, menu, recent, qr, onPage = false }: {
  room: RoomBoardRoom; perms: RoomGridPerms; today: string; methods: PayAccount[]; menu: BillMenu | null; recent: RecentItem[];
  qr: RoomQrInfo | null; onPage?: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [panel, setPanel] = useState<"book" | "extras" | "pay" | "history" | "qr" | null>(null);
  const toggle = (p: NonNullable<typeof panel>) => setPanel(panel === p ? null : p);
  const stay = room.currentStay;
  const status = stay ? "OCCUPIED" : room.status;
  const inRepair = room.status === "MAINTENANCE" || room.status === "OUT_OF_SERVICE";
  const todays = room.upcoming.filter((u) => u.arrivalDate === today);
  const later = room.upcoming.filter((u) => u.arrivalDate > today).slice(0, 3);
  // Managers and the MD: the meeting room's card leads with how it performs (like the rooms and tables).
  const watching = !!perms.maintenanceOnly && !onPage;
  const insight = useMeetingInsight(room.id, watching);
  function setStatus(to: RoomStatus, note?: string) {
    startTransition(async () => {
      const res = await changeRoomStatusAction({ roomId: room.id, status: to as never, note });
      if (res.ok) { toast.success(t("Room {room}: {status}.", { room: room.number, status: t(MEETING_ROOM_STATUS_LABEL[to]).toLowerCase() })); router.refresh(); } else toast.error(res.error);
    });
  }
  const meetingRow = ({ id, reservationId, who, time, st, balance }: { id: string; reservationId: string; who: string; time: string; st: string; balance: number }) => (
    <li key={id} className="flex flex-wrap items-center gap-3 px-3 py-2.5 text-sm">
      <span className="w-24 shrink-0 font-semibold tabular-nums">{time}</span>
      <Link href={`/staff/reservations/${reservationId}`} className="min-w-0 flex-1 truncate font-medium hover:underline">{who}</Link>
      <span className="text-xs text-muted-foreground">{t(MEETING_STATUS_LABEL[st])}</span>
      <MeetingButtons reservationId={reservationId} status={st} balance={balance} size="sm" canStart={perms.checkIn} canComplete={perms.checkOut} />
    </li>
  );
  return (
    <>
      {watching && <MeetingInsightHeader room={room} status={status} data={insight} />}
      {!onPage && !watching && (
      <div className="relative h-40 overflow-hidden bg-[#17130e]">
        {room.roomType.photo && (
          // eslint-disable-next-line @next/next/no-img-element
          <img src={room.roomType.photo} alt="" className="absolute inset-0 size-full object-cover opacity-75" />
        )}
        <div className="absolute inset-0 bg-linear-to-t from-black/85 via-black/35 to-black/10" />
        {!onPage && (
          <DialogClose render={<button type="button" aria-label={t("Close")} className="absolute right-3 top-3 grid size-8 place-items-center rounded-full bg-black/40 text-white backdrop-blur transition-colors hover:bg-black/60" />}>
            <span aria-hidden className="text-lg leading-none">×</span>
          </DialogClose>
        )}
        <span className="absolute left-4 top-4 inline-flex items-center gap-1.5 rounded-full border border-white/20 bg-black/35 px-2.5 py-1 text-xs font-medium text-white backdrop-blur">
          <span className={cn("size-2 rounded-full", ROOM_STATUS_META[status].dot)} />{t(MEETING_ROOM_STATUS_LABEL[status])}
        </span>
        <div className="absolute inset-x-0 bottom-0 p-5 text-white">
          <Title onPage={onPage} className="text-3xl font-semibold leading-none tracking-tight text-white">{t("Room {number} — {name}", { number: room.number, name: t(room.roomType.name) })}</Title>
          <Desc onPage={onPage} className="mt-1.5 text-sm text-white/75">{t("{amount} per booking · booked by time", { amount: formatTZS(room.roomType.baseRate) })}</Desc>
        </div>
      </div>
      )}
      <div className="space-y-4 p-5">
        <div>
          <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("Today")}</p>
          {stay || todays.length ? (
            <ul className="divide-y divide-border rounded-2xl border border-border/70">
              {stay && meetingRow({ id: stay.reservationRoomId, reservationId: stay.reservationId, who: stay.guestName, time: timeRange(stay.startAt, stay.endAt), st: "CHECKED_IN", balance: stay.balance })}
              {todays.map((u) => meetingRow({ id: u.reservationRoomId, reservationId: u.reservationId, who: u.company ?? u.guest.fullName, time: timeRange(u.startAt, u.endAt), st: u.status, balance: u.balance }))}
            </ul>
          ) : <p className="rounded-2xl bg-muted/60 p-3 text-sm text-muted-foreground">{t("No meetings today.")}</p>}
        </div>
        {later.length > 0 && (
          <div>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("Coming up")}</p>
            <ul className="divide-y divide-border rounded-2xl border border-border/70 text-sm">
              {later.map((u) => (
                <li key={u.reservationRoomId} className="flex items-center gap-3 px-3 py-2">
                  <span className="w-24 shrink-0 text-xs text-muted-foreground">{t.date(u.arrivalDate)}</span>
                  <Link href={`/staff/reservations/${u.reservationId}`} className="min-w-0 flex-1 truncate hover:underline">{u.company ?? u.guest.fullName}</Link>
                  <span className="tabular-nums text-xs">{timeRange(u.startAt, u.endAt)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
        {perms.decide && (
          <RoomDecisions key={`${room.id}-${stay?.reservationRoomId ?? "free"}`} today={today} leavingToday={false}
            room={{ id: room.id, number: room.number, status: room.status, meeting: true }}
            stay={stay ? { reservationId: stay.reservationId, reservationRoomId: stay.reservationRoomId, guestName: stay.guestName, isDayUse: true, ratePerNight: stay.ratePerNight, discountPerNight: stay.discountPerNight, nights: stay.nights, endAt: new Date(stay.endAt).toISOString(), balance: stay.balance, leaveOwing: stay.leaveOwing } : null}
            upcoming={[]} heldNoShow={null} closures={room.closures}
            can={{ move: false, close: perms.update, block: perms.block, release: false, decide: null }} />
        )}
        {watching && <MeetingInsightBody data={insight} room={room} />}
        <div className="grid grid-cols-2 gap-2">
          {perms.book && !inRepair && <ActionTile icon={<CalendarPlus />} tone="primary" label={t("Book a meeting")} hint={t("Date, start and end time")} active={panel === "book"} onClick={() => toggle("book")} />}
          {stay && (perms.pay || (perms.order && menu)) && <ActionTile icon={<UtensilsCrossed />} label={t("Food & extras")} hint={t("Pick from the menu · on the bill")} active={panel === "extras"} onClick={() => toggle("extras")} />}
          {stay && perms.pay && stay.balance > 0 && methods.length > 0 && <ActionTile icon={<Wallet />} label={t("Receive payment")} hint={t("Owes {amount}", { amount: formatTZS(stay.balance) })} active={panel === "pay"} onClick={() => toggle("pay")} />}
          {stay && <ActionTile icon={<FileText />} label={t("Meeting bill")} hint={t("View, print or download")} href={`/staff/stay-bill?reservation=${stay.reservationId}`} />}
          <ActionTile icon={<History />} label={t("Room history")} hint={t("Bookings and changes")} active={panel === "history"} onClick={() => toggle("history")} />
          {qr && <ActionTile icon={<QrCode />} label={t("Room QR code")} hint={t("Download or print the card")} active={panel === "qr"} onClick={() => toggle("qr")} />}
          {perms.update && !perms.decide && !stay && !inRepair && <ActionTile icon={<Wrench />} label={t("Under maintenance")} hint={t("No bookings while it's fixed")} disabled={pending} onClick={() => setStatus("MAINTENANCE", "Maintenance")} />}
          {perms.update && !perms.decide && inRepair && <ActionTile icon={pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} tone="primary" label={t("Fixed — available")} hint={t("Can be booked again")} disabled={pending} onClick={() => setStatus("READY")} />}
          {perms.update && (room.status === "DIRTY" || room.status === "CLEANING") && <ActionTile icon={<CheckCircle2 />} tone="primary" label={t("Ready")} hint={t("Tidied — available")} disabled={pending} onClick={() => setStatus("READY")} />}
        </div>
        {panel === "book" && (
          <QuickBook room={{ id: room.id, number: room.number, typeId: room.roomType.id, typeName: room.roomType.name }} mode="meeting" today={today}
            methods={methods} canPay={!!perms.pay} onDone={() => setPanel(null)} />
        )}
        {stay && panel === "extras" && (
          <div className="rounded-2xl border border-border/70 bg-muted/30 p-4">
            <ChargeComposer key={stay.reservationId} reservationId={stay.reservationId} roomLabel={room.number} recent={recent} methods={methods} canPay={!!perms.pay} canType={!!perms.pay}
              menu={perms.order ? menu : null} menuPayNow={!!perms.orderPayNow} onPosted={() => setPanel(null)} />
          </div>
        )}
        {stay && panel === "pay" && <PayHere reservationId={stay.reservationId} balance={stay.balance} methods={methods} phone={stay.guestPhone} who={stay.guestName} onDone={() => setPanel(null)} />}
        {panel === "history" && <RoomHistoryInline roomId={room.id} roomNumber={room.number} />}
        {panel === "qr" && qr && <RoomQrBox room={room} qr={qr} />}
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border/70 pt-3 text-xs text-muted-foreground">
          {stay ? <Link href={`/staff/reservations/${stay.reservationId}`} className="font-medium text-[oklch(0.55_0.11_76)] underline-offset-4 hover:underline dark:text-gold">{t("Open the meeting {ref} →", { ref: stay.reference })}</Link> : <span />}
          <span className="flex gap-3">{!onPage && <Link href={`/staff/rooms/${room.id}`} className="font-medium underline-offset-4 hover:underline">{t("Open room page →")}</Link>}<Link href="/staff/meeting-room" className="underline-offset-4 hover:underline">{t("Meeting room page →")}</Link></span>
        </div>
      </div>
    </>
  );
}

/** Take a payment for this stay or meeting, right in the card. */
function PayHere({ reservationId, balance, methods, phone = null, who = null, onDone }: { reservationId: string; balance: number; methods: PayAccount[]; phone?: string | null; who?: string | null; onDone: () => void }) {
  const t = useT();
  const router = useRouter();
  return (
    <div className="space-y-2">
    {/* The main way: a prompt to the guest's phone (nTZS) — recorded by itself when they approve. */}
    {balance > 0 && <SendToPhone target={{ kind: "stay", reservationId }} amount={balance} editableAmount phone={phone} who={who} onPaid={onDone} primary />}
    <OtherWays fold={balance > 0}>
    {/* Re-mounts when the balance changes (e.g. after a discount) so the amount is always the full balance. */}
    <ActionForm key={balance} action={recordPaymentAction} resetOnSuccess onSuccess={() => { onDone(); router.refresh(); }} className="space-y-3 rounded-2xl border border-border/70 bg-muted/30 p-4">
      {({ pending: saving, fieldErrors: e }) => (
        <>
          <input type="hidden" name="reservationId" value={reservationId} />
          <div className="grid gap-2 sm:grid-cols-[1fr_1fr]">
            <div className="space-y-1"><Label htmlFor="pay-amt" className="text-xs">{t("Amount (TZS)")}</Label>
              <Input id="pay-amt" name="amount" type="number" min={1} step={1000} defaultValue={balance} className="h-10" /><FieldError message={e?.amount} /></div>
            <div className="space-y-1"><Label htmlFor="pay-m" className="text-xs">{t("Received through")}</Label>
              <AccountSelect id="pay-m" name="accountId" accounts={methods} /></div>
          </div>
          <Input name="reference" placeholder={t("Reference (M-Pesa code, receipt…)")} className="h-10" />
          <Button type="submit" className="h-10 w-full" disabled={saving}>{saving ? <Loader2 className="animate-spin" /> : <Wallet />}{t("Save payment")}</Button>
        </>
      )}
    </ActionForm>
    </OtherWays>
    </div>
  );
}

/**
 * The same room window (every shortcut: check in / out, bill, cleaning, maintenance, QR…)
 * on the room's own page.
 */
export function RoomActionsCard({ room, perms, today, methods = [], menu = null, recent = [], qr = null }: {
  room: RoomBoardRoom; perms: RoomGridPerms; today: string; methods?: PayAccount[]; menu?: BillMenu | null; recent?: RecentItem[]; qr?: RoomQrInfo | null;
}) {
  const t = useT();
  const router = useRouter();
  const [now] = useState(() => new Date());
  const overdue = view(room, now, today, t).overdue;
  return (
    <div className="overflow-hidden rounded-3xl border border-border/70 bg-card">
      {room.roomType.category === "MEETING_ROOM"
        ? <MeetingRoomPanel room={room} perms={perms} today={today} methods={methods} menu={menu} recent={recent} qr={qr} onPage />
        : <RoomPanel room={room} perms={perms} overdue={overdue} onDone={() => router.refresh()} today={today} methods={methods} menu={menu} recent={recent} qr={qr} onPage />}
    </div>
  );
}
