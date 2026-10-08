"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { NetworkMarks } from "@/components/payments/networks";
import {
  ArrowRight, BadgePercent, BedDouble, Building2, CalendarCheck, CalendarDays, Check, CheckCircle2, Circle, Clock, DoorOpen, Loader2, LogIn, LogOut, Minus, Plus, Presentation, Search, Smartphone, Trash2, UserCheck, Users, UsersRound, Wallet, X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTZS } from "@/lib/format";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { DiscountChips } from "@/components/staff/reception/discount-editor";
import { SHORT_TIME_MAX_HOURS } from "@/lib/short-time";
import { hoursBetween } from "@/lib/meeting";
import { CHARGE_TYPES, type ChargeTypeCode } from "@/lib/charge-types";
import { PAYMENT_TERMS, termsLabel, type BillTo } from "@/lib/billing";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { validPhone } from "@/lib/guest-messages";
import { IdPicker, NationalityPicker } from "@/components/staff/id-nationality";
import { checkAvailabilityAction, createReservationAction, searchGuestsAction, type AvailabilityResult } from "../actions";
import type { PayAccount } from "@/lib/pay-account";
import type { BillMenu } from "@/server/services/restaurant";
import { MenuOrder, picksPayload, picksTotal, type MenuPick } from "@/components/staff/reception/menu-order";
import { GroupForm } from "../../groups/new/group-form";
import { StayDatePicker } from "@/components/staff/date-picker";
import type { BookingCompany, CompanyStaff } from "@/lib/company-staff";
import { QuickCompanyDialog } from "@/components/staff/company/quick-company";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";

type Mode = "overnight" | "walkIn" | "dayUse" | "meeting" | "group";
type Guest = {
  id?: string | null; fullName: string; phone: string; email: string; idType: string; idNumber: string; nationality: string; address: string;
  /** Returning guest: completed stays and the last one. */
  stays?: number; lastStay?: string | null; reference?: string | null; vip?: boolean;
  /** Same phone as another customer, but staff confirmed it is someone else. */
  createNew?: boolean;
};
type Line = { key: number; roomTypeId: string; roomId: string; adults: number; children: number; discountPerNight: string; discountReason: string };

const LBL = "text-[10px] font-semibold uppercase tracking-[0.12em] text-muted-foreground";

const EMPTY_GUEST: Guest = { id: null, fullName: "", phone: "", email: "", idType: "", idNumber: "", nationality: "", address: "" };

/** The "Send to phone" choice among the payment methods (a mobile-money prompt, not a desk payment). */
const PROMPT = "__ntzs_prompt__";

/** A room's housekeeping state in the room list (English is the lowercase status). */
const ROOM_STATE: Record<string, string> = {
  DIRTY: msg("dirty"), CLEANING: msg("cleaning"), RESERVED: msg("reserved"), OCCUPIED: msg("occupied"), MAINTENANCE: msg("maintenance"),
};

export function BookingForm(props: {
  initialMode: Mode; today: string; tomorrow: string;
  sources: { code: string; name: string }[];
  corporates: (BookingCompany & { billTo: BillTo; covers: string[] })[];
  preselectCompany?: string | null;
  /** Manager: may approve a company booking that goes over its credit limit. */
  canApproveCredit?: boolean;
  /** Manager: may confirm a booking without payment. */
  canConfirmUnpaid?: boolean;
  /** How long an unpaid booking holds its room (0 = no automatic release). */
  holdHours?: number;
  /** Default invoice payment terms (days). */
  invoiceTerms?: number;
  /** Most this user may take off a room per night (null = no desk limit). */
  discountMax: number; canCheckIn: boolean;
  /** nTZS is set up and this person takes payments: "Send to phone" (a mobile-money prompt) is offered. */
  mobilePay?: boolean;
  /** Payment methods for taking money at the desk; empty when the user cannot record payments. */
  methods: PayAccount[];
  initialGuest?: Guest | null;
  /** Booking a specific room (from the room board): pre-selected, and checked against the dates. */
  initialRoom?: { id: string; number: string; typeId: string; typeName: string } | null;
  initialArrival?: string | null;
  /** The restaurant & bar menu: food & drinks picked while booking (with photos, menu prices). */
  menu?: BillMenu | null;
}) {
  const router = useRouter();
  const t = useT();
  const [mode, setMode] = useState<Mode>(props.initialMode);
  const plusDay = (d: string) => { const x = new Date(`${d}T00:00:00Z`); x.setUTCDate(x.getUTCDate() + 1); return x.toISOString().slice(0, 10); };
  const [arrival, setArrival] = useState(props.initialArrival ?? props.today);
  const [departure, setDeparture] = useState(props.initialArrival ? plusDay(props.initialArrival) : props.tomorrow);
  const [pinned, setPinned] = useState(props.initialRoom ?? null);
  const [nights, setNights] = useState(1);
  // Short time: starts now (guest at the desk) or at a chosen date & time; 1–7 hours.
  const [shortNow, setShortNow] = useState(true);
  const [dayUse, setDayUse] = useState(() => ({ ...darNow(), hours: 3 }));
  // Meeting room: a date, a start and an end (priced per booking).
  const [meet, setMeet] = useState(() => ({ date: props.initialArrival ?? props.today, start: "09:00", end: "13:00" }));
  const [companyName, setCompanyName] = useState("");
  const meetingMode = mode === "meeting";
  const [source, setSource] = useState(props.initialMode === "walkIn" ? "WALK_IN" : props.preselectCompany ? "CORPORATE" : "PHONE");
  const [avail, setAvail] = useState<AvailabilityResult | null>(null);
  const [availError, setAvailError] = useState<string | null>(null);
  const [checking, startChecking] = useTransition();
  const [lines, setLines] = useState<Line[]>([]);
  const [guest, setGuest] = useState<Guest>(props.initialGuest ?? EMPTY_GUEST);
  // Payment decides: paid now / company invoice → confirmed; not paid → pending (room held for a while).
  const [status, setStatus] = useState<"RESERVED" | "CONFIRMED" | "INQUIRY">("RESERVED");
  // Who pays: the guest, or a company — an invoice always means the company pays the whole bill.
  // Companies added from this form (before the page refreshes) are usable straight away.
  const [addedCompanies, setAddedCompanies] = useState<BookingCompany[]>([]);
  const corporates = [...addedCompanies.filter((a) => !props.corporates.some((c) => c.id === a.id)).map((c) => ({ ...c, billTo: "COMPANY" as BillTo, covers: [] as string[] })), ...props.corporates];
  const [newCompany, setNewCompany] = useState(false);
  const firstCompany = props.corporates.find((c) => c.id === props.preselectCompany) ?? null;
  const [corporateId, setCorporateId] = useState(firstCompany?.id ?? "");
  const [billTo, setBillTo] = useState<BillTo>(firstCompany ? "COMPANY" : "GUEST");
  const [terms, setTerms] = useState<number | null>(null);
  const [creditReason, setCreditReason] = useState("");
  const company = corporates.find((c) => c.id === corporateId) ?? null;
  function pickCompany(id: string) {
    setCorporateId(id);
    const c = corporates.find((x) => x.id === id);
    if (!c) { setBillTo("GUEST"); return; }
    setBillTo("COMPANY");
    setTerms(null);
  }
  const [externalRef, setExternalRef] = useState("");
  const [requests, setRequests] = useState("");
  const [notes, setNotes] = useState("");
  const [saving, startSaving] = useTransition();
  // Payment taken now (walk-in / short time, or a deposit). null method = not paying now.
  // Pay now is picked first (owner, 2026-10-05) — by mobile money when it is set up; "Pay later" is one tap away.
  const [payMethod, setPayMethod] = useState<string | null>(() => (props.methods.length > 0 ? (props.mobilePay ? PROMPT : props.methods[0]?.id ?? null) : null));
  const [payAmount, setPayAmount] = useState<string>("");
  const [payRef, setPayRef] = useState("");
  // "Send to phone": the number the mobile-money prompt goes to (the guest's own, unless changed).
  const [promptPhone, setPromptPhone] = useState<string | null>(null);
  // Room service & extras ordered at check-in / while booking.
  const [extras, setExtras] = useState<{ key: number; type: ChargeTypeCode; item: string; qty: number; unitPrice: string }[]>([]);
  // Food & drinks picked from the menu (priced by the server from the menu when saving).
  const [menuPicks, setMenuPicks] = useState<MenuPick[]>([]);
  const [roomService, setRoomService] = useState(false);
  const addExtra = (type: ChargeTypeCode) => setExtras((xs) => [...xs, { key: keyRef.current++, type, item: CHARGE_TYPES.find((c) => c.code === type)!.label, qty: 1, unitPrice: "" }]);
  const setExtra = (key: number, patch: Partial<(typeof extras)[number]>) => setExtras((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const keyRef = useRef(1);

  const stay = useMemo(() => {
    if (mode === "overnight") return { kind: "overnight" as const, arrivalDate: arrival, departureDate: departure };
    if (mode === "walkIn") return { kind: "walkIn" as const, nights };
    if (mode === "meeting") return { kind: "meeting" as const, date: meet.date, startTime: meet.start, endTime: meet.end };
    return { kind: "dayUse" as const, date: dayUse.date, startTime: dayUse.startTime, hours: dayUse.hours };
  }, [mode, arrival, departure, nights, dayUse, meet]);
  const checkInNow = mode === "walkIn" || (mode === "dayUse" && shortNow);

  // Re-check availability whenever the stay or source changes.
  useEffect(() => {
    if (mode === "group") return; // the group form checks its own rooms
    const handle = setTimeout(() => {
      startChecking(async () => {
        const res = await checkAvailabilityAction({ stay, sourceCode: source, checkInNow });
        if (res.ok) {
          setAvail(res.data);
          setAvailError(null);
        } else {
          setAvail(null);
          setAvailError(res.error);
        }
      });
    }, 250);
    return () => clearTimeout(handle);
  }, [stay, source, mode, checkInNow]);

  const typeById = useMemo(() => new Map(avail?.types.map((rt) => [rt.id, rt]) ?? []), [avail]);
  const pinnedFree = !!pinned && !!typeById.get(pinned.typeId)?.rooms.some((r) => r.id === pinned.id);

  // Booking a specific room: add it as soon as it is free for the chosen dates.
  useEffect(() => {
    if (!pinned || !pinnedFree || lines.some((l) => l.roomId === pinned.id)) return;
    const rt = typeById.get(pinned.typeId)!;
    setLines((ls) => [{ key: keyRef.current++, roomTypeId: pinned.typeId, roomId: pinned.id, adults: Math.min(meetingMode ? 10 : 2, rt.maxAdults), children: 0, discountPerNight: "0", discountReason: "" }, ...ls]);
  }, [pinned, pinnedFree, typeById, lines, meetingMode]);

  function addRoom(typeId: string) {
    const rt = typeById.get(typeId);
    if (!rt) return;
    const used = lines.filter((l) => l.roomTypeId === typeId).length;
    if (used >= rt.rooms.length) return toast.error(t("No more {type} rooms free for these dates.", { type: t(rt.name) }));
    setLines((ls) => [...ls, { key: keyRef.current++, roomTypeId: typeId, roomId: "", adults: Math.min(meetingMode ? 10 : 2, rt.maxAdults), children: 0, discountPerNight: "0", discountReason: "" }]);
  }

  const update = (key: number, patch: Partial<Line>) => setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));

  // Display-only estimate; the server recalculates everything on save.
  // A chosen room that is no longer free after a date change falls back to auto-assign.
  const validRoomId = (l: Line) => (typeById.get(l.roomTypeId)?.rooms.some((r) => r.id === l.roomId) ? l.roomId : "");
  // Display-only: one room's price for the stay — base − promotion (from the server) − manual discount.
  // The server prices everything again when saving; this mirrors the same rules.
  const lineQuote = (l: Line) => {
    const rt = typeById.get(l.roomTypeId);
    if (!rt || !avail) return null;
    const units = avail.stay.units;
    const room = rt.rooms.find((r) => r.id === validRoomId(l));
    const promoTotal = room?.promoTotal ?? rt.promoTotal;
    const promotion = room?.promotion ?? rt.promotion;
    const promoPerNight = Math.round(promoTotal / Math.max(1, units));
    const manual = avail.stay.isDayUse && !avail.meeting ? 0 : Math.min(Number(l.discountPerNight) || 0, Math.max(0, rt.baseRate - promoPerNight));
    // Nights can cost differently (weekend, holiday, season): the server adds up each night's own price.
    const gross = room?.grossTotal ?? rt.grossTotal ?? rt.baseRate * units;
    return { rt, units, gross, promotion, promoTotal, promoPerNight, manual, manualTotal: manual * units, net: gross - promoTotal - manual * units, perNight: rt.baseRate - promoPerNight - manual };
  };
  const rooms$ = lines.reduce((e, l) => {
    const q = lineQuote(l);
    if (!q) return e;
    return { gross: e.gross + q.gross, promo: e.promo + q.promoTotal, manual: e.manual + q.manualTotal, net: e.net + q.net, promotions: q.promotion ? [...new Set([...e.promotions, q.promotion.name])] : e.promotions };
  }, { gross: 0, promo: 0, manual: 0, net: 0, promotions: [] as string[] });
  const menuTotal = picksTotal(menuPicks);
  // Room service to a guest checking in now adds the delivery fee (one order).
  const menuFee = menuPicks.length && roomService && checkInNow ? props.menu?.fee ?? 0 : 0;
  const extrasTotal = extras.reduce((sum, x) => sum + x.qty * (Number(x.unitPrice) || 0), 0) + menuTotal + menuFee;
  const estimate = { ...rooms$, extras: extrasTotal, net: rooms$.net + extrasTotal };
  // Empty amount = the full total (it follows the total when rooms or nights change).
  // The company's part (never taken at the desk) and what is left for the guest.
  // Invoice: the company pays everything on the bill — room, food, drinks and extras.
  const companyPart = !company || billTo === "GUEST" ? 0 : estimate.net;
  const guestPart = estimate.net - companyPart;
  const overCredit = company?.available != null && companyPart > company.available;
  const payNow = payMethod ? (payAmount === "" ? guestPart : Math.round(Number(payAmount) || 0)) : 0;


  function submit() {
    if (!guest.fullName.trim()) return toast.error(t("Enter the guest's name."));
    if (!validPhone(guest.phone)) { document.getElementById("g-phone")?.focus(); return toast.error(t("Enter the guest's phone number — the booking details are sent to it.")); }
    if (lines.length === 0) return toast.error(t("Add at least one room."));
    if (payMethod === PROMPT && payNow > 0 && !validPhone((promptPhone ?? guest.phone).trim())) return toast.error(t("Enter the guest's phone number to send the payment request."));
    if (extras.some((x) => !x.item.trim() || !(Number(x.unitPrice) > 0))) return toast.error(t("Give each room-service item a name and a price."));
    if (pinned && !pinnedFree) return toast.error(t('Room {room} is not free for these dates. Change the dates, or choose "Any room".', { room: pinned.number }));
    if (overCredit && !props.canApproveCredit) return toast.error(t("{company} does not have enough credit left. Ask a manager to approve it.", { company: company!.companyName }));
    if (overCredit && creditReason.trim().length < 3) return toast.error(t("Say why the company may go over its credit limit."));
    startSaving(async () => {
      const res = await createReservationAction({
        sourceCode: source,
        externalReference: externalRef || undefined,
        status,
        checkInNow,
        // "Now" means the moment the button is pressed.
        stay: mode === "dayUse" && shortNow ? { ...stay, ...darNow() } : stay,
        guest: { ...guest, id: guest.id || null },
        corporateCustomerId: corporateId || null,
        billing: company ? { billTo: "COMPANY", covers: [], paymentTermDays: terms } : null,
        creditOverride: overCredit ? { reason: creditReason.trim() } : null,
        rooms: lines.map((l) => ({
          roomTypeId: l.roomTypeId, roomId: validRoomId(l) || null, adults: l.adults, children: l.children,
          discountPerNight: Number(l.discountPerNight) || 0,
          discountReason: l.discountReason || null,
        })),
        charges: extras.length ? extras.map((x) => ({ type: x.type, item: x.item.trim(), qty: x.qty, unitPrice: Math.round(Number(x.unitPrice)) })) : null,
        menuItems: menuPicks.length ? picksPayload(menuPicks) : null,
        menuRoomService: roomService && checkInNow,
        payment: payMethod && payMethod !== PROMPT && payNow > 0 ? { amount: payNow, accountId: payMethod, reference: payRef || undefined } : null,
        prompt: payMethod === PROMPT && payNow > 0 ? { amount: payNow, phone: (promptPhone ?? guest.phone).trim() } : null,
        specialRequests: requests || undefined,
        internalNotes: notes || undefined,
        companyName: meetingMode ? companyName.trim() || undefined : undefined,
      });
      if (res.ok) {
        toast.success(`${checkInNow ? t("Checked in") : t("Reserved")} — ${res.data.reference}${res.data.prompt ? ` · ${t("payment request sent to their phone")}` : ""}`);
        if (res.data.promptError) toast.error(t("The payment request was not sent: {error} Send it again from the booking.", { error: res.data.promptError }), { duration: 10000 });
        // Straight to the booking with the WhatsApp message ready (booking details, or the welcome for a walk-in) —
        // and, after "Send to phone", watching that payment until the guest approves it.
        const q = new URLSearchParams(meetingMode ? {} : { sent: checkInNow ? "welcome" : "new" });
        if (res.data.prompt) q.set("paying", res.data.prompt.id);
        router.push(`/staff/reservations/${res.data.id}${q.size ? `?${q}` : ""}`);
      } else {
        toast.error(res.error);
        if (res.code === "UNAVAILABLE") {
          // Availability changed while booking: refresh it and let staff re-pick.
          setLines([]);
          setAvail(null);
        }
      }
    });
  }

  const MODES = [
    { m: "walkIn" as const, label: t("Walk-in now"), hint: t("Guest is at the desk"), icon: DoorOpen },
    { m: "overnight" as const, label: t("Reserve for later"), hint: t("Hold a room for dates"), icon: CalendarDays },
    { m: "dayUse" as const, label: t("Short time"), hint: t("A few hours"), icon: Clock },
    { m: "meeting" as const, label: t("Meeting room"), hint: t("Start – end time"), icon: Presentation },
    { m: "group" as const, label: t("Group booking"), hint: t("Many rooms · one bill"), icon: UsersRound },
  ];
  // The kinds of booking — compact tiles that fit in one row on a wide screen.
  const tiles = (
    <div className="@container">
      <div className="grid grid-cols-2 gap-2 @[36rem]:grid-cols-3 @[46rem]:grid-cols-5" role="tablist" aria-label={t("Kind of booking")}>
        {MODES.map(({ m, label, hint, icon: I }) => {
          const on = mode === m;
          const off = m === "walkIn" && !props.canCheckIn;
          return (
            <button key={m} type="button" role="tab" aria-selected={on} disabled={off}
              onClick={() => { setMode(m); setLines([]); if (m === "walkIn") setSource("WALK_IN"); else if (source === "WALK_IN") setSource("PHONE"); }}
              // Five in a row: icon above the words while space is tight, beside them on a wide screen.
              className={cn("group flex items-center gap-2.5 rounded-2xl border bg-card px-3 py-2.5 text-left transition-all disabled:opacity-40 @[46rem]:flex-col @[46rem]:items-start @[46rem]:gap-2 @[70rem]:flex-row @[70rem]:items-center",
                on ? "border-[oklch(0.75_0.13_80)] bg-[oklch(0.75_0.13_80)]/[0.08] shadow-[0_10px_30px_-18px_oklch(0.75_0.13_80)]" : "border-border/70 hover:-translate-y-0.5 hover:border-foreground/20")}>
              <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl [&_svg]:size-[18px]", on ? "bg-[oklch(0.75_0.13_80)] text-black" : "bg-muted text-foreground/70")}><I /></span>
              <span className="min-w-0">
                <span className="block truncate text-[13px] font-semibold leading-tight">{label}</span>
                <span className="block truncate text-[11px] leading-tight text-muted-foreground">{hint}</span>
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
  const nightsNow = avail && !avail.stay.isDayUse ? avail.stay.nights : null;
  const setNightsFromArrival = (n: number) => setDeparture(addDaysIso(arrival, n));
  const totalFree = avail?.types.reduce((n, rt) => n + rt.rooms.length, 0) ?? 0;
  const totalRooms = avail?.types.reduce((n, rt) => n + rt.rooms.length + rt.busy.length, 0) ?? 0;
  const nextFree = avail?.types.flatMap((rt) => rt.busy.map((b) => b.freeFrom)).filter((d): d is string => !!d).sort()[0] ?? null;
  /** Move the booking to start on `date`, keeping the number of nights (and optionally book that exact room). */
  const jumpTo = (date: string, room: { id: string; number: string; typeId: string; typeName: string } | null) => {
    const n = Math.max(1, avail?.stay.nights ?? 1);
    setLines([]);
    setArrival(date); setDeparture(addDaysIso(date, n));
    if (room) setPinned(room);
    const moved = { from: t.date(date), to: t.date(addDaysIso(date, n)) };
    toast.success(room ? t("Moved to {from} → {to} · room {room}.", { ...moved, room: room.number }) : t("Moved to {from} → {to}.", moved));
  };
  const chosenIds = new Set(lines.map((l) => validRoomId(l)).filter(Boolean));
  const steps = [
    { label: mode === "dayUse" || meetingMode ? t("Time") : t("Dates"), done: !!avail },
    { label: t("Room"), done: lines.length > 0 },
    { label: t("Guest & phone"), done: !!guest.fullName.trim() && validPhone(guest.phone) },
  ];

  /** Tap a chosen room again to take it off the booking. */
  function removeRoom(roomId: string) {
    setLines((ls) => ls.filter((l) => validRoomId(l) !== roomId));
    if (pinned?.id === roomId) setPinned(null); // otherwise the pinned room is added straight back
  }

  function addSpecific(typeId: string, roomId: string) {
    const rt = typeById.get(typeId);
    if (!rt || chosenIds.has(roomId)) return;
    setLines((ls) => [...ls, { key: keyRef.current++, roomTypeId: typeId, roomId, adults: Math.min(meetingMode ? 10 : 2, rt.maxAdults), children: 0, discountPerNight: "0", discountReason: "" }]);
  }

  if (mode === "group") {
    return (
      <div className="space-y-4">
        {tiles}
        <GroupForm today={props.today} sources={props.sources} companies={corporates} preselectCompany={props.preselectCompany} defaultTerms={props.invoiceTerms} menu={props.menu ?? null} />
      </div>
    );
  }
  return (
    <div className="space-y-4">
    {tiles}
    <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_22rem]">
      <div className="min-w-0 space-y-4">

        {pinned && (
          <div className={cn("flex flex-wrap items-center gap-3 rounded-2xl border p-3.5", !avail ? "border-border" : pinnedFree ? "border-emerald-500/40 bg-emerald-500/[0.06]" : "border-rose-500/40 bg-rose-500/[0.06]")}>
            <RoomBadge number={pinned.number} />
            <div className="min-w-0 flex-1">
              <p className="text-sm font-semibold">{t("Room {room}", { room: pinned.number })} · {t(pinned.typeName)}</p>
              <p className={cn("text-xs", !avail ? "text-muted-foreground" : pinnedFree ? "text-emerald-700 dark:text-emerald-300" : "text-rose-700 dark:text-rose-300")}>
                {!avail ? t("Checking the dates…") : pinnedFree ? t("Free for these dates — already added below.") : t("Taken for these dates. Change the dates, or pick any free room.")}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => { setLines((ls) => ls.filter((l) => l.roomId !== pinned.id)); setPinned(null); }}>{t("Any room instead")}</Button>
          </div>
        )}

        {/* 1 — When */}
        <Step n={1} title={meetingMode ? t("Meeting time") : mode === "dayUse" ? t("Short time") : mode === "walkIn" ? t("How long") : t("Dates")} done={!!avail}
          aside={checking ? <Loader2 className="size-4 animate-spin text-muted-foreground" /> : null}>
          {mode === "overnight" && (
            <div className="space-y-3">
              <div className="@container"><div className="grid items-stretch gap-2 @[36rem]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                <StayDatePicker label={t("Check-in")} value={arrival} min={props.today} today={props.today} availability range={{ from: arrival, to: departure }} time={avail ? t.time(avail.stay.startAt) : undefined}
                  onChange={(v) => { setArrival(v); if (v >= departure) setDeparture(nextDay(v)); }} />
                <span className="flex items-center justify-center gap-1 px-1 text-center @[36rem]:flex-col">
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums">{t.plural(nightsNow ?? 0, "{n} night", "{n} nights", { n: nightsNow ?? "–" })}</span>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </span>
                <StayDatePicker label={t("Check-out")} value={departure} min={nextDay(arrival)} today={props.today} availability range={{ from: arrival, to: departure }} onChange={setDeparture} time={avail ? t.time(avail.stay.endAt) : undefined} />
              </div></div>
              <QuickNights value={nightsNow} onPick={setNightsFromArrival} />
            </div>
          )}
          {mode === "walkIn" && (
            <div className="space-y-3">
              <div className="@container"><div className="grid items-stretch gap-2 @[36rem]:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]">
                <StayDatePicker label={t("Check-in")} value={props.today} today={props.today} readOnly time={avail ? t.time(avail.stay.startAt) : undefined} hint={t("the guest is here now")} />
                <span className="flex items-center justify-center gap-1 px-1 text-center @[36rem]:flex-col">
                  <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-semibold tabular-nums">{t.plural(nights, "{n} night", "{n} nights")}</span>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </span>
                <StayDatePicker label={t("Check-out")} value={addDaysIso(props.today, nights)} min={nextDay(props.today)} max={addDaysIso(props.today, 90)} today={props.today}
                  availability range={{ from: props.today, to: addDaysIso(props.today, nights) }} time={avail ? t.time(avail.stay.endAt) : undefined}
                  onChange={(v) => setNights(Math.max(1, Math.round((Date.parse(v) - Date.parse(props.today)) / 86_400_000)))} />
              </div></div>
              <div className="flex flex-wrap items-center gap-3">
                <div className="w-36"><Stepper value={nights} min={1} max={90} onChange={setNights} /></div>
                <QuickNights value={nights} onPick={setNights} />
              </div>
            </div>
          )}
          {mode === "dayUse" && (
            <div className="space-y-3">
              <div className="flex flex-wrap gap-1.5">
                {props.canCheckIn && (
                  <button type="button" aria-pressed={shortNow} onClick={() => { setShortNow(true); setLines([]); setDayUse((d) => ({ ...d, ...darNow() })); }}
                    className={cn("rounded-xl border px-3.5 py-2 text-left text-xs transition-colors", shortNow ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
                    <span className="block font-semibold">{t("Guest is here — start now")}</span><span className="opacity-70">{t("Checked in straight away")}</span>
                  </button>
                )}
                <button type="button" aria-pressed={!shortNow || !props.canCheckIn} onClick={() => { setShortNow(false); setLines([]); }}
                  className={cn("rounded-xl border px-3.5 py-2 text-left text-xs transition-colors", !shortNow || !props.canCheckIn ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
                  <span className="block font-semibold">{t("Reserve a time")}</span><span className="opacity-70">{t("Later today, tonight or another day")}</span>
                </button>
              </div>
              {!(shortNow && props.canCheckIn) && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <StayDatePicker label={t("Date")} size="sm" value={dayUse.date} min={props.today} today={props.today} availability onChange={(v) => setDayUse({ ...dayUse, date: v })} />
                  <TimeBox id="du-from" label={t("Starts at")} value={dayUse.startTime} onChange={(v) => setDayUse({ ...dayUse, startTime: v })} />
                </div>
              )}
              <div className="space-y-1.5">
                <p className="text-xs font-medium text-muted-foreground">{t("How many hours?")} <span className="font-normal">({t("most {n}", { n: SHORT_TIME_MAX_HOURS })})</span></p>
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: SHORT_TIME_MAX_HOURS }, (_, i) => i + 1).map((h) => (
                    <button key={h} type="button" aria-pressed={dayUse.hours === h} onClick={() => setDayUse({ ...dayUse, hours: h })}
                      className={cn("h-10 min-w-12 rounded-xl border px-3 text-sm font-semibold tabular-nums transition-colors", dayUse.hours === h ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
                      {t("{h}h", { h })}
                    </button>
                  ))}
                </div>
              </div>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-dashed border-[oklch(0.75_0.13_80)]/50 bg-[oklch(0.75_0.13_80)]/[0.06] px-3 py-2 text-xs">
                <span className="font-semibold text-[oklch(0.5_0.11_76)] dark:text-[oklch(0.8_0.12_80)]">{t("Short-time price: 25% off the room")}</span>
                <span className="text-muted-foreground">{t("No overnight · no breakfast · no extra discount")}</span>
              </p>
            </div>
          )}

          {meetingMode && (
            <div className="space-y-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <StayDatePicker label={t("Date")} size="sm" value={meet.date} min={props.today} today={props.today} onChange={(v) => setMeet({ ...meet, date: v })} />
                <TimeBox id="mt-start" label={t("Starts at")} value={meet.start} onChange={(v) => setMeet({ ...meet, start: v })} />
                <TimeBox id="mt-end" label={t("Ends at")} value={meet.end} onChange={(v) => setMeet({ ...meet, end: v })} />
              </div>
              <div className="flex flex-wrap gap-1.5">
                {([[msg("Morning"), "08:00", "12:00"], [msg("Afternoon"), "13:00", "17:00"], [msg("Half day"), "09:00", "13:00"], [msg("Full day"), "08:00", "17:00"]] as const).map(([label, a, b]) => {
                  const on = meet.start === a && meet.end === b;
                  return (
                    <button key={label} type="button" aria-pressed={on} onClick={() => setMeet({ ...meet, start: a, end: b })}
                      className={cn("rounded-xl border px-3 py-1.5 text-left text-xs transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
                      <span className="block font-semibold">{t(label)}</span><span className="tabular-nums opacity-70">{a}–{b}</span>
                    </button>
                  );
                })}
              </div>
              <p className="flex flex-wrap items-center gap-x-3 gap-y-1 rounded-xl border border-dashed border-violet-500/40 bg-violet-500/[0.06] px-3 py-2 text-xs">
                <span className="font-semibold text-violet-700 dark:text-violet-300">{t("One price per booking")}</span>
                <span className="text-muted-foreground">{t("The room is free again from the end time · extras go on the same bill")}</span>
              </p>
            </div>
          )}

          {avail && !avail.stay.isDayUse && !avail.meeting && (
            <p className="mt-2 text-[11px] text-muted-foreground">
              {avail.stay.isLateArrival
                ? t("Came in after midnight, before 04:00 — this counts as last night, so checkout is 11:00 this morning.")
                : t("The hotel day starts at 04:00 — anyone arriving from 04:00 checks out at 11:00 after their last night.")}
            </p>
          )}
          {avail && (avail.stay.isDayUse || avail.meeting) && (
            <div className="mt-3 overflow-hidden rounded-2xl border border-border/70 bg-gradient-to-br from-muted/60 to-muted/20">
              <div className="grid items-center gap-3 px-4 py-4 sm:grid-cols-[1fr_auto_1fr]">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-emerald-500/12 text-emerald-700 dark:text-emerald-300"><LogIn className="size-5" /></span>
                  <div className="min-w-0 leading-tight">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{avail.meeting ? t("Starts") : t("Check-in")}</p>
                    <p className="text-base font-semibold">{relDay(avail.stay.startAt, t)} <span className="text-muted-foreground">·</span> {t.time(avail.stay.startAt)}</p>
                    <p className="truncate text-xs text-muted-foreground">{t.date(darDate(avail.stay.startAt), true)}</p>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-muted-foreground sm:flex-col sm:gap-1">
                  <span className="hidden h-px w-10 bg-border sm:block" />
                  <span className="rounded-full bg-background px-3 py-1 text-xs font-semibold text-foreground ring-1 ring-border/70 tabular-nums">
                    {avail.stay.isDayUse ? t("{n} hours", { n: Math.round((Date.parse(avail.stay.endAt) - Date.parse(avail.stay.startAt)) / 3_600_000) }) : t.plural(avail.stay.nights, "{n} night", "{n} nights")}
                  </span>
                  <ArrowRight className="size-4" />
                </div>
                <div className="flex items-center gap-3 sm:justify-end sm:text-right">
                  <div className="min-w-0 leading-tight sm:order-first">
                    <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{avail.meeting ? t("Ends") : avail.stay.isDayUse ? t("Leaves") : t("Check-out")}</p>
                    <p className="text-base font-semibold text-[oklch(0.5_0.11_76)] dark:text-[oklch(0.8_0.12_80)]">{relDay(avail.stay.endAt, t)} <span className="text-muted-foreground">·</span> {t.time(avail.stay.endAt)}</p>
                    <p className="truncate text-xs text-muted-foreground">{t.date(darDate(avail.stay.endAt), true)}</p>
                  </div>
                  <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-[oklch(0.75_0.13_80)]/15 text-[oklch(0.5_0.11_76)] dark:text-[#f0cf86]"><LogOut className="size-5" /></span>
                </div>
              </div>
              {!avail.stay.isDayUse && (
                <p className="border-t border-border/60 bg-background/40 px-4 py-2 text-[11px] text-muted-foreground">
                  {avail.stay.isLateArrival
                    ? t("Came in after midnight, before 04:00 — this counts as last night, so checkout is 11:00 this morning.")
                    : t("The hotel day starts at 04:00 — anyone arriving from 04:00 checks out at 11:00 after their last night.")}
                </p>
              )}
            </div>
          )}
          {availError && <p className="mt-3 text-sm text-destructive">{availError}</p>}

          <div className="mt-4 space-y-1.5">
            <p className="text-xs font-medium text-muted-foreground">{t("How did they book?")}</p>
            <div className="flex flex-wrap gap-1.5">
              {props.sources.map((s) => (
                <button key={s.code} type="button" onClick={() => setSource(s.code)} aria-pressed={source === s.code}
                  className={cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", source === s.code ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>{t(s.name)}</button>
              ))}
            </div>
          </div>
        </Step>

        {/* 2 — Room */}
        <Step n={2} title={meetingMode ? t("Meeting room") : t("Room")} done={lines.length > 0}
          aside={avail && (
            <span className="text-xs text-muted-foreground">
              {t.rich("<b>{free}</b> of {total} rooms free", { b: (c) => <strong className={cn(totalFree ? "text-emerald-600 dark:text-emerald-400" : "text-rose-600 dark:text-rose-400")}>{c}</strong> }, { free: totalFree, total: totalRooms })}
            </span>
          )}>
          {!avail && !availError && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("Finding free rooms…")}</p>}
          {avail && totalFree === 0 && (
            <p className="mb-3 rounded-xl border border-dashed border-rose-500/40 p-3 text-center text-sm text-rose-700 dark:text-rose-300">
              {meetingMode ? t("Already booked for part of that time — choose another time.") : t("Fully booked for these dates.")}{nextFree && mode === "overnight" ? <> {t.rich("The first room free again is on <b>{date}</b> — tap a grey room to move to its date.", { b: (c) => <strong>{c}</strong> }, { date: t.date(nextFree) })}</> : ""}
            </p>
          )}
          {avail && (
            <>
              <div className="mb-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-muted-foreground">
                <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded border-2 border-emerald-500/50 bg-emerald-500/10" />{t("Free — tap to choose")}</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-[oklch(0.75_0.13_80)]" />{t("Chosen")}</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-sky-500/30" />{t("Guest in")}</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-violet-500/30" />{t("Booked")}</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-orange-500/30" />{t("Needs cleaning")}</span>
                <span className="inline-flex items-center gap-1.5"><span className="size-3 rounded bg-zinc-500/30" />{t("Maintenance")}</span>
              </div>
              <div className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70">
                {avail.types.map((rt) => {
                  const left = rt.rooms.filter((r) => !chosenIds.has(r.id)).length - lines.filter((l) => l.roomTypeId === rt.id && !validRoomId(l)).length;
                  const full = rt.rooms.length === 0;
                  const typeNext = rt.busy.map((b) => b.freeFrom).filter((d): d is string => !!d).sort()[0] ?? null;
                  const all = [...rt.rooms.map((r) => ({ ...r, free: true as const })), ...rt.busy.map((b) => ({ ...b, free: false as const }))]
                    .sort((a, b) => a.number.localeCompare(b.number, undefined, { numeric: true }));
                  // Rooms grouped by floor (101 → floor 1): the way staff know the building.
                  const floors = [...all.reduce((m, r) => m.set(r.number.slice(0, -2) || "0", [...(m.get(r.number.slice(0, -2) || "0") ?? []), r]), new Map<string, typeof all>())];
                  const roomButton = (r: (typeof all)[number]) => {
                    if (r.free) {
                      const taken = chosenIds.has(r.id);
                      const notReady = r.status !== "AVAILABLE" && r.status !== "READY";
                      return (
                        <button key={r.id} type="button" aria-pressed={taken} onClick={() => (taken ? removeRoom(r.id) : addSpecific(rt.id, r.id))}
                          title={taken ? t("Room {room} chosen — tap again to remove", { room: r.number }) : notReady ? t("Room {room} — cleaned before the guest arrives", { room: r.number }) : t("Choose room {room}", { room: r.number })}
                          className={cn("flex h-12 w-[3.9rem] flex-col items-center justify-center rounded-xl border-2 text-[15px] font-bold leading-none tabular-nums transition-all active:scale-95",
                            taken ? "border-[oklch(0.75_0.13_80)] bg-[oklch(0.75_0.13_80)] text-black shadow-[0_6px_16px_-8px_oklch(0.75_0.13_80)]" : "border-emerald-500/35 bg-card hover:-translate-y-0.5 hover:border-[oklch(0.75_0.13_80)] hover:bg-[oklch(0.75_0.13_80)]/10")}>
                          {r.number}
                          <span className={cn("mt-1 text-[9px] font-semibold uppercase tracking-wide", taken ? "text-black/70" : "text-emerald-600 dark:text-emerald-400")}>{taken ? t("Chosen") : notReady ? t("Clean 1st") : t("Free")}</span>
                        </button>
                      );
                    }
                    const tone = r.reason === "IN_USE" ? "bg-sky-500/12 text-sky-800 dark:text-sky-200" : r.reason === "BOOKED" ? "bg-violet-500/12 text-violet-800 dark:text-violet-200"
                      : r.reason === "NOT_CLEAN" ? "bg-orange-500/12 text-orange-800 dark:text-orange-200" : "bg-zinc-500/15 text-zinc-600 dark:text-zinc-300";
                    const label = r.reason === "NOT_CLEAN" ? t("Cleaning") : r.reason === "OUT_OF_ORDER" ? t("Repair") : r.time ? r.time.split("–")[0] + "–" : r.freeFrom ? shortDate(r.freeFrom, t) : r.reason === "IN_USE" ? t("In use") : t("Booked");
                    const canJump = mode === "overnight" && !!r.freeFrom;
                    return (
                      <button key={r.id} type="button"
                        onClick={() => {
                          if (canJump) { jumpTo(r.freeFrom!, { id: r.id, number: r.number, typeId: rt.id, typeName: rt.name }); return; }
                          if (r.reason === "NOT_CLEAN") { toast.info(t("Room {room} needs cleaning. Mark it clean on the Rooms board, then check the guest in.", { room: r.number })); return; }
                          const what = r.reason === "OUT_OF_ORDER" ? t("Room {room} is under maintenance", { room: r.number })
                            : r.time ? t("Room {room} is booked {time}", { room: r.number, time: `${r.time}${r.guest ? ` (${r.guest})` : ""}` }) : t("Room {room} is taken", { room: r.number });
                          toast.info(r.freeFrom ? t("{what} — free again on {date}.", { what, date: t.date(r.freeFrom) }) : t("{what}.", { what }));
                        }}
                        title={[t("Room {room}", { room: r.number }), r.reason === "IN_USE" ? (r.time ? t("in use") : t("guest in")) : r.reason === "BOOKED" ? t("booked") : r.reason === "OUT_OF_ORDER" ? t("under maintenance") : t("needs cleaning"), r.time, r.guest, r.freeFrom ? t("free again {date}", { date: t.date(r.freeFrom) }) : null, canJump ? t("tap to book it from that date") : null].filter(Boolean).join(" · ")}
                        className={cn("flex h-12 w-[3.9rem] flex-col items-center justify-center rounded-xl text-[15px] font-bold leading-none tabular-nums opacity-75 transition-opacity hover:opacity-100", tone)}>
                        <span className="opacity-60">{r.number}</span>
                        <span className="mt-1 text-[9px] font-semibold uppercase tracking-wide">{label}</span>
                      </button>
                    );
                  };
                  return (
                    <div key={rt.id} className={cn("grid gap-3 p-3.5 md:grid-cols-[13.5rem_1fr] md:items-center", full && "bg-muted/20")}>
                      {/* Type */}
                      <div className="flex items-center gap-3">
                        <div className="relative size-16 shrink-0 overflow-hidden rounded-xl bg-[#17130e] ring-1 ring-border/70">
                          {rt.photo && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img src={rt.photo} alt="" className={cn("size-full object-cover", full && "opacity-50 grayscale")} />
                          )}
                        </div>
                        <div className="min-w-0 leading-tight">
                          <p className="truncate text-sm font-semibold">{t(rt.name)}</p>
                          <p className="text-xs">
                            {((avail.stay.isDayUse && !avail.meeting) || rt.promoPerNight > 0) && <span className="mr-1 text-muted-foreground line-through tabular-nums">{((avail.stay.isDayUse ? rt.fullRate : rt.baseRate) / 1000).toLocaleString("en-US")}k</span>}
                            {rt.datePrices.length > 0 && !avail.stay.isDayUse ? (
                              <><strong className="tabular-nums">{formatTZS(Math.round(rt.totalNet / Math.max(1, avail.stay.units)))}</strong><span className="text-muted-foreground">{t("/night avg")}</span>
                                <span className="ml-1.5 inline-block rounded-full bg-violet-500/12 px-1.5 py-px text-[10px] font-semibold text-violet-700 dark:text-violet-300" title={t("Some nights have a date price")}>{rt.datePrices.map((x) => t(x)).join(", ")}</span></>
                            ) : (
                              <><strong className="tabular-nums">{formatTZS(rt.baseRate - rt.promoPerNight)}</strong><span className="text-muted-foreground">{avail.meeting ? ` ${t("per booking")}` : avail.stay.isDayUse ? ` ${t("short time")}` : t("/night")}</span></>
                            )}
                            {rt.promotion && <span className="ml-1.5 inline-block rounded-full bg-rose-500/12 px-1.5 py-px text-[10px] font-semibold text-rose-700 dark:text-rose-300" title={rt.promotion.name}>{rt.promotion.label}</span>}
                          </p>
                          <p className="mt-0.5 text-[11px] text-muted-foreground">
                            <span className={cn("font-semibold", full ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>{full ? t("Full") : t("{left} of {total} free", { left: Math.max(0, left), total: all.length })}</span>
                            {" · "}<Users className="inline size-3 align-[-2px]" /> {avail.meeting ? t("up to {n} people", { n: rt.maxAdults }) : `${rt.maxAdults}${rt.maxChildren ? `+${rt.maxChildren}` : ""}`}
                          </p>
                          {avail.meeting && rt.schedule && rt.schedule.length > 0 && (
                            <ul className="mt-1.5 space-y-0.5 text-[11px]">
                              <li className="font-semibold text-muted-foreground">{t("Booked that day")}</li>
                              {rt.schedule.map((b) => (
                                <li key={`${b.number}-${b.time}`} className="flex items-center gap-1.5 tabular-nums">
                                  <span className={cn("size-1.5 rounded-full", b.inUse ? "bg-sky-500" : "bg-violet-500")} />
                                  <span className="font-medium">{b.time}</span><span className="truncate text-muted-foreground">{b.who}</span>
                                </li>
                              ))}
                            </ul>
                          )}
                          {full ? (
                            typeNext && (mode === "overnight"
                              ? <button type="button" onClick={() => jumpTo(typeNext, null)} className="mt-1 text-[11px] font-medium text-[oklch(0.55_0.11_76)] hover:underline dark:text-[oklch(0.8_0.12_80)]">{t("Free {date} →", { date: shortDate(typeNext, t) })}</button>
                              : <p className="mt-1 text-[11px] text-muted-foreground">{t("Free {date}", { date: shortDate(typeNext, t) })}</p>)
                          ) : (
                            !avail.meeting && <button type="button" disabled={left <= 0} onClick={() => addRoom(rt.id)} className="mt-1 text-[11px] font-medium text-[oklch(0.55_0.11_76)] hover:underline disabled:opacity-40 dark:text-[oklch(0.8_0.12_80)]">{t("+ Any {type} room", { type: t.locale === "en" ? rt.name.split(" ")[0].toLowerCase() : t(rt.name) })}</button>
                          )}
                        </div>
                      </div>
                      {/* Rooms, floor by floor */}
                      <div className="flex min-w-0 flex-wrap gap-2">
                        {floors.map(([floor, rooms]) => (
                          <div key={floor} className="rounded-2xl bg-muted/40 p-1.5">
                            <p className="px-1 pb-1 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">{floorName(floor, t)}</p>
                            <div className="flex flex-wrap gap-1.5">{rooms.map(roomButton)}</div>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
              </div>
            </>
          )}

          {lines.length > 0 && (
            <div className="mt-4 space-y-2.5">
              <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{lines.length === 1 ? t("Chosen room") : t("Chosen rooms ({n})", { n: lines.length })}</p>
              {lines.length > 1 && !meetingMode && (
                <p className="rounded-xl border border-dashed border-violet-500/40 bg-violet-500/[0.06] px-3 py-2 text-xs">
                  {t.rich("A different guest in each room (a team, a family)? <link>Make it a group booking →</link> — each room its own guest and booking, one bill for the group.", {
                    link: (c) => <button type="button" onClick={() => { setMode("group"); setLines([]); }} className="font-semibold text-violet-700 underline-offset-2 hover:underline dark:text-violet-300">{c}</button>,
                  })}
                </p>
              )}
              {lines.map((l) => {
                const rt = typeById.get(l.roomTypeId);
                if (!rt) return null;
                const rid = validRoomId(l);
                const number = rt.rooms.find((r) => r.id === rid)?.number ?? null;
                const takenByOthers = new Set(lines.filter((o) => o.key !== l.key && o.roomId).map((o) => o.roomId));
                const d = avail?.stay.isDayUse && !avail.meeting ? 0 : Number(l.discountPerNight) || 0;
                const lq = lineQuote(l)!;
                const units = avail?.stay.units ?? 1;
                return (
                  <div key={l.key} className="rounded-2xl border border-border/70 bg-muted/30 p-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <RoomBadge number={number} />
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-semibold">{t(rt.name)}</p>
                        <div className="mt-0.5 w-44 max-w-full">
                        <NativeSelect value={rid} onChange={(e) => update(l.key, { roomId: e.target.value })} aria-label={t("Room number")} className="h-7 w-full text-xs">
                          <option value="">{t("Any free room (auto)")}</option>
                          {rt.rooms.filter((r) => !takenByOthers.has(r.id)).map((r) => (
                            <option key={r.id} value={r.id}>{t("Room {room}", { room: r.number })}{r.status !== "AVAILABLE" && r.status !== "READY" ? ` (${ROOM_STATE[r.status] ? t(ROOM_STATE[r.status]) : r.status.toLowerCase()})` : ""}</option>
                          ))}
                        </NativeSelect>
                        </div>
                      </div>
                      <div className="flex items-center gap-2">
                        {avail?.meeting ? (
                          <MiniStepper label={t("Attendees")} value={l.adults} min={1} max={rt.maxAdults} onChange={(v) => update(l.key, { adults: v })} />
                        ) : (
                          <>
                            <MiniStepper label={t("Adults")} value={l.adults} min={1} max={rt.maxAdults} onChange={(v) => update(l.key, { adults: v })} />
                            <MiniStepper label={t("Kids")} value={l.children} min={0} max={rt.maxChildren} onChange={(v) => update(l.key, { children: v })} />
                          </>
                        )}
                      </div>
                      <div className="text-right">
                        <p className="text-sm font-semibold tabular-nums">{formatTZS(lq.net)}</p>
                        <p className="text-[11px] text-muted-foreground tabular-nums">{formatTZS(lq.perNight)}{avail?.meeting ? ` ${t("per booking")}` : avail?.stay.isDayUse ? "" : ` × ${units}`}</p>
                      </div>
                      <button type="button" aria-label={t("Remove room")} onClick={() => setLines((ls) => ls.filter((x) => x.key !== l.key))} className="grid size-8 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-rose-600"><Trash2 className="size-4" /></button>
                    </div>
                    {lq.promotion && (
                      <p className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 rounded-lg bg-rose-500/[0.07] px-2.5 py-1.5 text-xs">
                        <span className="font-semibold text-rose-700 dark:text-rose-300">{t("Promotion: {name} · {label}", { name: lq.promotion.name, label: lq.promotion.label })}</span>
                        <span className="text-muted-foreground tabular-nums">{t("{base} − {promo} = {net}/night · set by Admin", { base: formatTZS(rt.baseRate), promo: formatTZS(lq.promoPerNight), net: formatTZS(rt.baseRate - lq.promoPerNight) })}</span>
                      </p>
                    )}
                    {(!avail?.stay.isDayUse || avail.meeting) && props.discountMax > 0 && <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-dashed border-border pt-2.5">
                      <span className="inline-flex items-center gap-1 text-xs font-medium"><BadgePercent className="size-3.5 text-emerald-600" />{t("Discount")}</span>
                      <div className="min-w-0 flex-1">
                        <DiscountChips value={d} rate={rt.baseRate - lq.promoPerNight} max={props.discountMax}
                          onChange={(v) => update(l.key, { discountPerNight: String(v) })} />
                      </div>
                    </div>}
                  </div>
                );
              })}
            </div>
          )}
        </Step>

        {lines.length === 0 && !props.initialGuest ? (
          <div className="flex items-center gap-3 rounded-2xl border border-dashed border-border px-4 py-4 text-sm text-muted-foreground">
            <span className="grid size-8 shrink-0 place-items-center rounded-full bg-muted text-xs font-semibold">3</span>
            {meetingMode ? t("Pick the meeting room above — then enter who is booking.") : t("Pick a room above — then enter who is staying.")}
          </div>
        ) : (
          <>
            <GuestCard guest={guest} setGuest={setGuest} meeting={meetingMode ? { company: companyName, setCompany: setCompanyName } : null}
              staff={company && company.staff.length ? { company: company.companyName, people: company.staff } : null} />

            <Step n={4} title={meetingMode ? t("Food, drinks & extras") : t("Room service & extras")} done={extras.length + menuPicks.length > 0} optional>
              {props.menu && props.menu.categories.length > 0 && (
                <div className="mb-5 space-y-3">
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{t("Food & drinks from the menu")}</p>
                  <MenuOrder menu={props.menu} picks={menuPicks} onChange={setMenuPicks} extraLine={menuFee > 0 ? { label: t("Room service delivery"), amount: menuFee } : null} />
                  {menuPicks.length > 0 && (checkInNow ? (
                    <label className="flex items-center gap-2 text-xs">
                      <input type="checkbox" checked={roomService} onChange={(e) => setRoomService(e.target.checked)} />
                      {props.menu.fee ? t("Deliver to the room (room service · + {fee}) — otherwise served in the restaurant / bar", { fee: formatTZS(props.menu.fee) }) : t("Deliver to the room (room service) — otherwise served in the restaurant / bar")}
                    </label>
                  ) : (
                    <p className="text-[11px] text-muted-foreground">{t("The guest arrives later: these go on the bill now as a pre-order at menu prices — tell the kitchen when they arrive.")}</p>
                  ))}
                  {menuPicks.length > 0 && checkInNow && <p className="text-[11px] text-muted-foreground">{t("Saved with the booking: the kitchen & bar get the order, and it goes on the room's bill.")}</p>}
                </div>
              )}
              <div className="mb-5 space-y-3">
                <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{props.menu ? t("Not on the menu? Type it in") : t("Add an item")}</p>
                <div className="flex flex-wrap gap-1.5">
                  {CHARGE_TYPES.map((c) => (
                    <button key={c.code} type="button" onClick={() => addExtra(c.code)}
                      className="inline-flex items-center gap-1 rounded-full border border-border px-3 py-1.5 text-xs font-medium transition-colors hover:border-[oklch(0.75_0.13_80)]/70 hover:bg-[oklch(0.75_0.13_80)]/10">
                      <Plus className="size-3" />{t(c.label)}
                    </button>
                  ))}
                </div>
                {extras.length > 0 && (
                  <ul className="space-y-2">
                    {extras.map((x) => (
                      <li key={x.key} className="grid grid-cols-[1fr_auto_7.5rem_auto] items-end gap-2 rounded-xl bg-muted/40 p-2.5">
                        <div className="space-y-1">
                          <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{t(CHARGE_TYPES.find((c) => c.code === x.type)?.label ?? "")}</p>
                          <Input value={x.item} onChange={(e) => setExtra(x.key, { item: e.target.value })} placeholder={t("e.g. Dinner, 2 sodas")} className="h-9" aria-label={t("Item")} />
                        </div>
                        <MiniStepper label={t("Qty")} value={x.qty} min={1} max={99} onChange={(v) => setExtra(x.key, { qty: v })} />
                        <div className="space-y-1">
                          <p className="text-[10px] text-muted-foreground">{t("Price each (TZS)")}</p>
                          <Input type="number" min={0} step={500} value={x.unitPrice} onChange={(e) => setExtra(x.key, { unitPrice: e.target.value })} className="h-9 tabular-nums" aria-label={t("Price each")} autoFocus={!x.unitPrice} />
                        </div>
                        <button type="button" aria-label={t("Remove item")} onClick={() => setExtras((xs) => xs.filter((y) => y.key !== x.key))} className="grid size-9 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-rose-600"><Trash2 className="size-4" /></button>
                      </li>
                    ))}
                  </ul>
                )}
                {extrasTotal > 0 && <p className="flex justify-between px-1 text-sm"><span className="text-muted-foreground">{t("Food, drinks & extras")}</span><strong className="tabular-nums">{formatTZS(extrasTotal)}</strong></p>}
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                {mode !== "walkIn" && !checkInNow && (
                  <div className="space-y-1.5 sm:col-span-2">
                    <Label className="text-xs">{t("If the guest does not pay now")}</Label>
                    <div className="flex flex-wrap gap-1.5">
                      {([
                        ["RESERVED", props.holdHours ? t("Hold the room {h} h, then release it", { h: props.holdHours }) : t("Hold the room until they pay")],
                        ["INQUIRY", t("Enquiry only · does not hold the room")],
                        ...(props.canConfirmUnpaid ? [["CONFIRMED", t("Confirm without payment (manager)")] as const] : []),
                      ] as const).map(([v, label]) => (
                        <button key={v} type="button" onClick={() => setStatus(v)} aria-pressed={status === v}
                          className={cn("rounded-full border px-3 py-1 text-xs font-medium", status === v ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>{label}</button>
                      ))}
                    </div>
                    <p className="text-[11px] text-muted-foreground">{t("A payment now (even a deposit) or a company invoice confirms the booking straight away.")}</p>
                  </div>
                )}
                <div className="space-y-1.5"><Label htmlFor="extref" className="text-xs">{t("Their reference (e.g. Booking.com no.)")}</Label><Input id="extref" value={externalRef} onChange={(e) => setExternalRef(e.target.value)} /></div>
                <div className="space-y-1.5"><Label htmlFor="requests" className="text-xs">{meetingMode ? t("Special requirements") : t("Guest requests")}</Label><Textarea id="requests" rows={2} value={requests} onChange={(e) => setRequests(e.target.value)} placeholder={meetingMode ? t("e.g. projector, U-shape seating, tea break at 10:30") : t("e.g. airport pickup, extra pillow")} /></div>
                <div className="space-y-1.5"><Label htmlFor="notes" className="text-xs">{t("Staff notes")}</Label><Textarea id="notes" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder={t("Only staff see this")} /></div>
              </div>
            </Step>
          </>
        )}
      </div>

      {/* The ticket */}
      <aside className="lg:sticky lg:top-20 lg:self-start">
        <div className="overflow-hidden rounded-3xl border border-border/70 bg-card shadow-[0_2px_4px_rgba(15,23,42,0.03),0_22px_48px_-24px_rgba(15,23,42,0.45)]">
          {/* Dates */}
          <div className="relative overflow-hidden bg-[#15110c] px-5 pb-5 pt-4 text-white">
            <div className="pointer-events-none absolute -right-16 -top-20 size-56 rounded-full bg-[oklch(0.75_0.13_80)]/25 blur-3xl" />
            <div className="relative flex items-center justify-between">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#f0cf86]">{MODES.find((x) => x.m === mode)!.label}</p>
              <span className="text-[10px] font-medium uppercase tracking-[0.18em] text-white/40">Vegas Luxury</span>
            </div>
            {avail ? (
              <div className="relative mt-4 grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                <TicketDate label={avail.meeting ? t("Starts") : t("Check-in")} date={darDate(avail.stay.startAt)} time={t.time(avail.stay.startAt)} />
                <div className="flex flex-col items-center gap-1 px-1">
                  <span className="whitespace-nowrap rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold ring-1 ring-white/15">
                    {avail.meeting ? t("{n} h", { n: hoursBetween(avail.stay.startAt, avail.stay.endAt) }) : avail.stay.isDayUse ? t.plural(dayUse.hours, "{n} hour", "{n} hours") : t.plural(avail.stay.nights, "{n} night", "{n} nights")}
                  </span>
                  <span className="flex w-16 items-center gap-1 text-white/30"><span className="h-px flex-1 border-t border-dashed border-white/30" /><ArrowRight className="size-3" /></span>
                </div>
                <TicketDate label={avail.meeting ? t("Ends") : t("Check-out")} date={darDate(avail.stay.endAt)} time={t.time(avail.stay.endAt)} right />
              </div>
            ) : <p className="relative mt-4 text-sm text-white/60">{t("Choose the dates…")}</p>}
          </div>
          {/* Tear line */}
          <div className="relative h-0 border-t-2 border-dashed border-border">
            <span className="absolute -left-3.5 -top-3.5 size-7 rounded-full border border-border/70 bg-canvas" />
            <span className="absolute -right-3.5 -top-3.5 size-7 rounded-full border border-border/70 bg-canvas" />
          </div>

          <div className="space-y-4 p-5 text-sm">
            {/* The booking: room(s) and who stays */}
            <div className="overflow-hidden rounded-2xl border border-border/70 bg-muted/25">
              {lines.length === 0 ? (
                <div className="flex items-center gap-3 px-3.5 py-3 text-muted-foreground">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl border border-dashed border-border"><BedDouble className="size-4" /></span>
                  <span className="text-xs">{t("No room yet — tap a room number.")}</span>
                </div>
              ) : (
                <ul className="divide-y divide-border/60">
                  {lines.map((l) => {
                    const rt = typeById.get(l.roomTypeId);
                    if (!rt) return null;
                    const number = rt.rooms.find((r) => r.id === validRoomId(l))?.number;
                    const tq = lineQuote(l)!;
                    return (
                      <li key={l.key} className="flex items-center gap-3 px-3.5 py-3">
                        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[oklch(0.75_0.13_80)] text-[15px] font-bold tabular-nums text-black shadow-[0_6px_14px_-8px_oklch(0.75_0.13_80)]">
                          {number ?? <BedDouble className="size-4" />}
                        </span>
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className="block truncate text-[15px] font-semibold">{number ? t("Room {room}", { room: number }) : t("Any free room")}</span>
                          <span className="mt-0.5 flex items-center gap-1.5 truncate text-[11px] text-muted-foreground">
                            {avail?.meeting ? `${t(rt.name)} · ${t.plural(l.adults, "{n} attendee", "{n} attendees")}` : <>{t(rt.name)}<span className="text-border">|</span><Users className="size-3" />{l.adults + l.children}</>}
                          </span>
                        </span>
                        <span className="text-right leading-tight">
                          <span className="block text-[15px] font-semibold tabular-nums">{formatTZS(tq.net).replace("TZS ", "")}</span>
                          {tq.promoPerNight + tq.manual > 0
                            ? <span className="block text-[10px] font-medium text-emerald-600 dark:text-emerald-400">−{((tq.promoPerNight + tq.manual) / 1000).toLocaleString("en-US")}k{avail?.meeting ? "" : ` ${t("a night")}`}</span>
                            : <span className="block text-[10px] text-muted-foreground">TZS</span>}
                        </span>
                      </li>
                    );
                  })}
                </ul>
              )}
              <div className="flex items-center gap-3 border-t border-border/60 bg-background/40 px-3.5 py-3">
                <span className={cn("grid size-11 shrink-0 place-items-center rounded-full text-sm font-bold", guest.fullName.trim() ? "bg-sky-500/15 text-sky-700 ring-1 ring-sky-500/30 dark:text-sky-300" : "border border-dashed border-border text-muted-foreground")}>
                  {guest.fullName.trim() ? guest.fullName.trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w)).map((x) => x[0]).slice(0, 2).join("").toUpperCase() : <UserCheck className="size-4" />}
                </span>
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{meetingMode ? t("Customer") : t("Guest")}</span>
                  <span className={cn("block truncate", guest.fullName.trim() ? "text-[15px] font-semibold" : "text-sm text-muted-foreground")}>{guest.fullName.trim() || t("Enter the name below")}{meetingMode && companyName.trim() ? ` · ${companyName.trim()}` : ""}</span>
                  {(guest.phone || guest.id) && <span className="block truncate text-[11px] text-muted-foreground">{[guest.phone, guest.id ? t("Returning guest") : null].filter(Boolean).join(" · ")}</span>}
                </span>
                {guest.id && <span className="shrink-0 rounded-full bg-emerald-500/12 px-2 py-0.5 text-[10px] font-semibold text-emerald-700 dark:text-emerald-300">{t("On file")}</span>}
              </div>
            </div>

            {/* Money */}
            <div className="rounded-2xl border border-border/70 p-3.5">
              <dl className="space-y-1.5 text-xs">
                <Row label={meetingMode ? t("Meeting room") : t("Room price")} value={formatTZS(estimate.gross)} />
                {estimate.promo > 0 && <Row label={`${t("Promotion")}${estimate.promotions.length ? ` · ${estimate.promotions.join(", ")}` : ""}`} value={`− ${formatTZS(estimate.promo)}`} green />}
                {estimate.manual > 0 && <Row label={t("Discount")} value={`− ${formatTZS(estimate.manual)}`} green />}
                {estimate.extras > 0 && <Row label={t("Room service & extras")} value={`+ ${formatTZS(estimate.extras)}`} />}
              </dl>
              <div className="mt-2.5 flex items-baseline justify-between gap-2 border-t border-dashed border-border pt-2.5">
                <span className="text-xs font-medium text-muted-foreground">{companyPart > 0 ? t("Total") : t("To pay")}</span>
                <span className="whitespace-nowrap text-[1.7rem] font-semibold leading-none tracking-tight tabular-nums"><span className="mr-1 text-sm font-medium text-muted-foreground">TZS</span>{estimate.net.toLocaleString("en-US")}</span>
              </div>
              {companyPart > 0 && (
                <dl className="mt-2 space-y-1 text-xs">
                  <Row label={`${company!.companyName} · ${t("invoice")}`} value={formatTZS(companyPart)} />
                </dl>
              )}
            </div>

            <QuickCompanyDialog open={newCompany} onOpenChange={setNewCompany} onSaved={(c) => { setAddedCompanies((a) => [c, ...a]); setCorporateId(c.id); setBillTo("COMPANY"); setTerms(null); }} />
            {/* Payment type: pay now · pay at the hotel · company invoice */}
            {lines.length > 0 && (
              <WhoPays
                canPay={props.methods.length > 0} payingNow={!!payMethod} checkInNow={checkInNow}
                onPayNow={() => { pickCompany(""); setPayMethod(props.mobilePay ? PROMPT : props.methods[0]?.id ?? null); }}
                onPayAtHotel={() => { pickCompany(""); setPayMethod(null); }}
                companies={corporates} company={company} terms={terms ?? company?.terms ?? 0} onNewCompany={() => setNewCompany(true)}
                companyPart={companyPart} overCredit={overCredit} canApprove={!!props.canApproveCredit} creditReason={creditReason}
                onCompany={pickCompany} onTerms={setTerms} onCreditReason={setCreditReason}
              />
            )}

            {/* Payment now */}
            {props.methods.length > 0 && lines.length > 0 && guestPart > 0 && (payMethod || company) && (
              <div className="space-y-2.5 rounded-2xl border border-border/70 p-3.5">
                <p className="flex items-center justify-between text-xs font-semibold">
                  <span className="inline-flex items-center gap-1.5"><Wallet className="size-3.5" />{checkInNow ? t("Payment") : t("Deposit")}</span>
                  {!checkInNow && <span className="font-normal text-muted-foreground">{t("Optional")}</span>}
                </p>
                {/* The main way: a payment request to the guest's phone (nTZS) — they pay there, it is recorded automatically */}
                {props.mobilePay && (
                  <div className={cn("rounded-xl border p-2.5 transition", payMethod === PROMPT ? "border-sky-500/60 bg-sky-500/[0.09]" : "border-border hover:bg-muted")}>
                    <button type="button" aria-pressed={payMethod === PROMPT} onClick={() => setPayMethod(PROMPT)} className="flex w-full items-center gap-2.5 text-left">
                      <span className={cn("grid size-9 shrink-0 place-items-center rounded-lg", payMethod === PROMPT ? "bg-sky-600 text-white" : "bg-sky-500/12 text-sky-600 dark:text-sky-300")}><Smartphone className="size-4" /></span>
                      <span className="min-w-0 flex-1 leading-tight"><span className="block text-sm font-semibold">{t("Mobile money")}</span><NetworkMarks label={null} compact className="mt-1" /></span>
                      {payMethod === PROMPT && <CheckCircle2 className="size-4 shrink-0 text-sky-600 dark:text-sky-300" />}
                    </button>
                    {payMethod === PROMPT && (
                      <Input aria-label={t("Guest's phone number")} type="tel" inputMode="tel" value={promptPhone ?? guest.phone} onChange={(e) => setPromptPhone(e.target.value)} placeholder={t("Phone number, e.g. 0712 345 678")} className="mt-2.5 h-10 text-sm tabular-nums" />
                    )}
                  </div>
                )}
                {props.mobilePay && <p className="pt-0.5 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("Other payment methods")}</p>}
                <div className="flex flex-wrap gap-1.5">
                  {company && <button type="button" aria-pressed={!payMethod} onClick={() => setPayMethod(null)} title={t("No payment now")}
                    className={cn("rounded-lg border px-2.5 py-1.5 text-xs font-medium", !payMethod ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>{checkInNow ? t("Pay at check-out") : t("Pay later")}</button>}
                  {props.methods.map((m) => (
                    <button key={m.id} type="button" aria-pressed={payMethod === m.id}
                      onClick={() => setPayMethod(m.id)}
                      className={cn("rounded-lg border px-2.5 py-1.5 text-xs font-medium", payMethod === m.id ? "border-emerald-600 bg-emerald-600 text-white" : "border-border hover:bg-muted")}>{t(m.name)}</button>
                  ))}
                </div>
                {payMethod && (
                  <>
                    <div className="grid grid-cols-[1fr_auto] gap-2">
                      <Input aria-label={payMethod === PROMPT ? t("Amount to request") : t("Amount received")} type="number" min={1} step={1000} value={payAmount === "" ? String(guestPart) : payAmount} onChange={(e) => setPayAmount(e.target.value)} className="h-10 text-base font-semibold tabular-nums" />
                      <button type="button" onClick={() => setPayAmount("")} className={cn("rounded-lg border px-2.5 text-xs font-medium", payAmount === "" ? "border-emerald-600 text-emerald-700 dark:text-emerald-300" : "border-border hover:bg-muted")}>{/* "Full" here is the full amount (elsewhere "Full" means fully booked). */}{t.locale === "en" ? "Full" : t("Full amount")}</button>
                    </div>
                    {payMethod !== PROMPT && <Input aria-label={t("Reference")} value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder={t("M-Pesa / bank ref (optional)")} className="h-9 text-xs" />}
                    {(() => {
                      const paid = payNow;
                      // A prompt is not money yet: say what will be asked for.
                      if (payMethod === PROMPT && paid <= guestPart) return <p className="text-xs font-medium text-sky-700 dark:text-sky-300">{paid < guestPart ? t("Requests {amount} — {rest} still to pay after", { amount: formatTZS(paid), rest: formatTZS(guestPart - paid) }) : t("Requests the full {amount}", { amount: formatTZS(paid) })}</p>;
                      if (paid > guestPart) return <p className="text-xs font-medium text-rose-600 dark:text-rose-400">{companyPart > 0 ? t("More than the guest's part ({amount}).", { amount: formatTZS(guestPart) }) : t("More than the total ({amount}).", { amount: formatTZS(guestPart) })}</p>;
                      if (paid === guestPart) return <p className="flex items-center gap-1 text-xs font-semibold text-emerald-600 dark:text-emerald-400"><CheckCircle2 className="size-3.5" />{t("Fully paid")}</p>;
                      return <p className="text-xs text-amber-700 dark:text-amber-400">{t("Still owes {amount}", { amount: formatTZS(guestPart - paid) })}</p>;
                    })()}
                  </>
                )}
              </div>
            )}

            {/* What is still missing (nothing shown once everything is filled in) */}
            {steps.some((st) => !st.done) && (
              <p className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
                <span>{t("Still to do:")}</span>
                {steps.filter((st) => !st.done).map((st) => (
                  <span key={st.label} className="inline-flex items-center gap-1 rounded-full bg-amber-500/12 px-2 py-0.5 font-medium text-amber-800 dark:text-amber-300"><Circle className="size-2.5" />{st.label}</span>
                ))}
              </p>
            )}

            <Button className="h-12 w-full rounded-2xl text-sm font-semibold" onClick={submit} disabled={saving || lines.length === 0 || payNow > guestPart || (overCredit && !props.canApproveCredit)}>
              {saving ? <Loader2 className="animate-spin" /> : checkInNow ? <LogIn /> : <CalendarCheck />}
              {payNow > 0 && payMethod === PROMPT
                ? (checkInNow ? t("Check in & request {amount}", { amount: formatTZS(payNow) }) : t("Save & request {amount}", { amount: formatTZS(payNow) }))
                : payNow > 0
                ? (checkInNow ? t("Receive {amount} & check in", { amount: formatTZS(payNow) }) : t("Receive {amount} & save", { amount: formatTZS(payNow) }))
                : checkInNow ? t("Check in now") : t("Save reservation")}
            </Button>
            <p className="text-center text-[11px] text-muted-foreground">
              {payMethod === PROMPT ? (checkInNow ? t("The guest gets a payment request on their phone and confirms it with their PIN. Once paid, it is recorded automatically.") : t("The guest gets a payment request on their phone and confirms it with their PIN. Once paid, it is recorded automatically and the booking is confirmed."))
                : payMethod ? t("Booking and payment are saved together — the booking is confirmed.")
                : checkInNow ? t("You can also receive the payment later on the stay screen.")
                  : companyPart > 0 ? t("Billed to the company — the booking is confirmed.")
                    : status === "RESERVED" ? (props.holdHours ? t("Not paid: pending — the room is held {h} hours, then released. A payment confirms it.", { h: props.holdHours }) : t("Not paid: pending. A payment confirms it."))
                      : status === "INQUIRY" ? t("Enquiry: the room is not held.") : t("Confirmed without payment (manager).")}
            </p>
          </div>
        </div>
      </aside>
    </div>
    </div>
  );
}

function floorName(f: string, t: T) {
  const n = Number(f);
  if (!n) return t("Ground floor");
  // "1st floor" in English; other languages number the floor their own way ("1楼").
  return t("{ordinal} floor", { ordinal: t.locale === "en" ? `${n}${n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th"}` : n });
}

/** The current date and time at the hotel (Dar es Salaam), e.g. { date: "2026-09-25", startTime: "14:05" }. */
function darNow() {
  const parts = Object.fromEntries(new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" })
    .formatToParts(new Date()).map((p) => [p.type, p.value]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, startTime: `${parts.hour}:${parts.minute}` };
}

/** Calendar date at the hotel for an instant (ISO string). */
function darDate(iso: string) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Africa/Dar_es_Salaam", year: "numeric", month: "2-digit", day: "2-digit" }).format(new Date(iso));
}

/** "Today" / "Tomorrow" / "Sat 27 Sept" for an instant, from the hotel's point of view. */
function relDay(iso: string, t: T) {
  const d = darDate(iso);
  const today = darNow().date;
  if (d === today) return t("Today");
  const next = new Date(`${today}T00:00:00Z`); next.setUTCDate(next.getUTCDate() + 1);
  if (d === next.toISOString().slice(0, 10)) return t("Tomorrow");
  return new Date(`${d}T00:00:00Z`).toLocaleDateString(t.intl, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
}

function shortDate(d: string, t: T) {
  return new Date(`${d}T00:00:00Z`).toLocaleDateString(t.intl, { day: "numeric", month: "short", timeZone: "UTC" });
}

function TicketDate({ label, date, time, right }: { label: string; date: string; time: string; right?: boolean }) {
  const t = useT();
  const d = new Date(`${date}T00:00:00Z`);
  const month = d.toLocaleDateString(t.intl, { month: "short", timeZone: "UTC" });
  return (
    <div className={cn("min-w-0 leading-tight", right && "text-right")}>
      <p className="text-[10px] uppercase tracking-wider text-white/45">{label}</p>
      {/* "12 Oct" — Chinese reads month first: "10月12日". */}
      {t.locale === "zh-CN"
        ? <p className="mt-1 text-2xl font-semibold tabular-nums"><span className="text-base font-medium text-white/80">{month}</span>{d.getUTCDate()}<span className="text-base font-medium text-white/80">日</span></p>
        : <p className="mt-1 text-2xl font-semibold tabular-nums">{d.getUTCDate()} <span className="text-base font-medium text-white/80">{month}</span></p>}
      <p className="text-[11px] text-white/55">{d.toLocaleDateString(t.intl, { weekday: "short", timeZone: "UTC" })} · {time}</p>
    </div>
  );
}

function Step({ n, title, done, optional, aside, children }: { n: number; title: string; done: boolean; optional?: boolean; aside?: React.ReactNode; children: React.ReactNode }) {
  const t = useT();
  return (
    <section className="rounded-3xl border border-border/70 bg-card p-4 shadow-[0_2px_4px_rgba(15,23,42,0.03)] sm:p-5">
      <div className="mb-4 flex items-center gap-2.5">
        <span className={cn("grid size-7 place-items-center rounded-full text-xs font-bold", done ? "bg-emerald-500 text-white" : "bg-foreground text-background")}>{done ? <Check className="size-3.5" /> : n}</span>
        <h2 className="text-base font-semibold">{title}</h2>
        {optional && <span className="text-xs text-muted-foreground">{t("optional")}</span>}
        <span className="ml-auto">{aside}</span>
      </div>
      {children}
    </section>
  );
}

function RoomBadge({ number }: { number: string | null }) {
  return (
    <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[#17130e] text-sm font-bold tabular-nums text-[#f0cf86] dark:bg-[oklch(0.75_0.13_80)] dark:text-[#17130e]">
      {number ?? <BedDouble className="size-4" />}
    </span>
  );
}

function TimeBox({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (v: string) => void }) {
  return (
    <label htmlFor={id} className="block rounded-2xl border border-border/70 bg-muted/30 px-3 py-2">
      <span className="block text-[11px] font-medium text-muted-foreground">{label}</span>
      <input id={id} type="time" value={value} onChange={(e) => onChange(e.target.value)} className="w-full bg-transparent text-sm font-semibold outline-none" />
    </label>
  );
}

function QuickNights({ value, onPick }: { value: number | null; onPick: (n: number) => void }) {
  const t = useT();
  return (
    <div className="flex flex-wrap gap-1.5">
      {[1, 2, 3, 5, 7, 14, 21, 30].map((n) => (
        <button key={n} type="button" onClick={() => onPick(n)} aria-pressed={value === n}
          className={cn("rounded-full border px-3 py-1 text-xs font-medium tabular-nums transition-colors", value === n ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
          {n === 30 ? t("30 nights · 1 month") : t.plural(n, "{n} night", "{n} nights")}
        </button>
      ))}
    </div>
  );
}

function MiniStepper({ label, value, min, max, onChange }: { label: string; value: number; min: number; max: number; onChange: (v: number) => void }) {
  const t = useT();
  return (
    <div className="text-center">
      <p className="text-[10px] text-muted-foreground">{label}</p>
      <div className="flex h-7 items-center rounded-lg border border-border bg-card">
        <button type="button" className="px-1.5 disabled:opacity-30" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={t("Fewer {what}", { what: label.toLowerCase() })}><Minus className="size-3" /></button>
        <span className="w-4 text-center text-xs font-semibold tabular-nums">{value}</span>
        <button type="button" className="px-1.5 disabled:opacity-30" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={t("More {what}", { what: label.toLowerCase() })}><Plus className="size-3" /></button>
      </div>
    </div>
  );
}

function addDaysIso(d: string, n: number) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + n);
  return x.toISOString().slice(0, 10);
}

function nextDay(d: string) {
  const x = new Date(`${d}T00:00:00Z`);
  x.setUTCDate(x.getUTCDate() + 1);
  return x.toISOString().slice(0, 10);
}

function Row({ label, value, strong, green }: { label: string; value: string; strong?: boolean; green?: boolean }) {
  return (
    <div className={cn("flex justify-between text-muted-foreground", strong && "text-base font-semibold", green && "text-emerald-600 dark:text-emerald-400")}>
      <dt>{label}</dt><dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function Stepper({ value, min, max, onChange, big }: { value: number; min: number; max: number; onChange: (v: number) => void; big?: boolean }) {
  const t = useT();
  return (
    <div className={cn("flex items-center rounded-xl border", big ? "h-12 text-lg font-semibold" : "h-9")}>
      <button type="button" className="px-2.5 disabled:opacity-30" disabled={value <= min} onClick={() => onChange(value - 1)} aria-label={t("Decrease")}><Minus className="size-4" /></button>
      <span className="flex-1 text-center tabular-nums">{value}</span>
      <button type="button" className="px-2.5 disabled:opacity-30" disabled={value >= max} onClick={() => onChange(value + 1)} aria-label={t("Increase")}><Plus className="size-4" /></button>
    </div>
  );
}

type FoundGuest = {
  id: string; reference: string | null; vip: boolean; fullName: string; phone: string | null; email: string | null; idType: string | null; idNumber: string | null;
  nationality: string | null; address: string | null; stays: number; lastStay: string | null;
};
function toGuest(g: FoundGuest): Guest {
  return {
    id: g.id, fullName: g.fullName, phone: g.phone ?? "", email: g.email ?? "", idType: g.idType ?? "", idNumber: g.idNumber ?? "",
    nationality: g.nationality ?? "", address: g.address ?? "", stays: g.stays, lastStay: g.lastStay, reference: g.reference, vip: g.vip,
  };
}

function GuestCard({ guest, setGuest, meeting, staff }: {
  guest: Guest; setGuest: (g: Guest) => void; meeting?: { company: string; setCompany: (v: string) => void } | null;
  /** Booking on a company: its people, one tap to book one of them. */
  staff?: { company: string; people: CompanyStaff[] } | null;
}) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Guest[]>([]);
  const [searching, startSearch] = useTransition();

  useEffect(() => {
    if (query.trim().length < 2) return;
    const h = setTimeout(() => startSearch(async () => {
      const res = await searchGuestsAction(query);
      if (res.ok) setResults(res.data.map(toGuest));
    }), 250);
    return () => clearTimeout(h);
  }, [query]);

  // Typing a phone number that belongs to a previous guest offers their details instead of a duplicate profile.
  const [phoneMatch, setPhoneMatch] = useState<Guest | null>(null);
  const phoneDigits = guest.phone.replace(/\D/g, "");
  useEffect(() => {
    if (guest.id || guest.createNew || phoneDigits.length < 9) return;
    const h = setTimeout(async () => {
      const res = await searchGuestsAction(phoneDigits);
      const hit = res.ok ? res.data.find((g) => (g.phone ?? "").replace(/\D/g, "").endsWith(phoneDigits.slice(-9))) : undefined;
      setPhoneMatch(hit ? toGuest(hit) : null);
    }, 400);
    return () => clearTimeout(h);
  }, [guest.id, guest.createNew, phoneDigits]);

  const set = (k: keyof Guest) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setGuest({ ...guest, [k]: e.target.value });

  return (
    <Step n={3} title={meeting ? t("Customer") : t("Guest")} done={!!guest.fullName.trim()}>
      <div className="space-y-3">
        {guest.id ? (
          <div className="flex items-center justify-between rounded-lg border border-green-600/30 bg-green-600/5 px-3 py-2 text-sm">
            <span className="flex flex-wrap items-center gap-x-2"><UserCheck className="size-4 text-green-700" /> {t("Previous guest:")} <strong>{guest.fullName}</strong>
              {guest.stays != null && <span className="text-muted-foreground">· {t.plural(guest.stays, "{n} previous stay", "{n} previous stays")}{guest.lastStay && ` · ${t("last {date}", { date: t.date(guest.lastStay, true) })}`}</span>}
            </span>
            <Button size="xs" variant="ghost" onClick={() => setGuest(EMPTY_GUEST)}><X /> {t("Clear")}</Button>
          </div>
        ) : (
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-2.5 size-4 text-muted-foreground" />
            <Input className="h-11 rounded-xl pl-8" placeholder={t("Been here before? Find by name, phone, ID or G-reference…")} value={query} onChange={(e) => { setQuery(e.target.value); if (e.target.value.trim().length < 2) setResults([]); }} aria-label={t("Search guests")} />
            {searching && <Loader2 className="absolute right-2.5 top-2.5 size-4 animate-spin" />}
            {results.length > 0 && (
              <ul className="absolute z-20 mt-1 w-full overflow-hidden rounded-lg border bg-popover shadow-lg">
                {results.map((g) => (
                  <li key={g.id}>
                    <button type="button" className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                      onClick={() => { setGuest(g); setQuery(""); setResults([]); }}>
                      <span className="grid size-8 shrink-0 place-items-center rounded-full bg-sky-500/12 text-[11px] font-bold text-sky-700 dark:text-sky-300">{initials(g.fullName)}</span>
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="flex items-center gap-1.5 font-medium">{g.fullName}{g.vip && <span className="rounded-full bg-[oklch(0.75_0.13_80)]/20 px-1.5 text-[9px] font-bold text-[oklch(0.5_0.12_75)] dark:text-[#f0cf86]">VIP</span>}</span>
                        <span className="block truncate text-xs text-muted-foreground">{[g.reference, g.phone, g.idNumber].filter(Boolean).join(" · ")}</span>
                      </span>
                      <span className="shrink-0 text-[11px] text-muted-foreground">{g.stays ? t.plural(g.stays, "{n} stay", "{n} stays") : t("New")}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
        {staff && (
          <div className="space-y-1.5 rounded-xl border border-[oklch(0.75_0.13_80)]/40 bg-[oklch(0.75_0.13_80)]/[0.06] p-2.5">
            <p className="text-xs font-medium">{t("People from {company}", { company: staff.company })} <span className="font-normal text-muted-foreground">{t("— tap to book one")}</span></p>
            <div className="flex flex-wrap gap-1.5">
              {staff.people.map((s) => (
                <button key={s.id} type="button" aria-pressed={guest.id === s.id}
                  onClick={() => setGuest({ ...EMPTY_GUEST, id: s.id, fullName: s.fullName, phone: s.phone ?? "", idType: s.idType ?? "", idNumber: s.idNumber ?? "" })}
                  className={cn("inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors", guest.id === s.id ? "border-foreground bg-foreground text-background" : "border-border bg-card hover:bg-muted")}>
                  {guest.id === s.id ? <Check className="size-3" /> : <UserCheck className="size-3" />}{s.fullName}
                </button>
              ))}
            </div>
            <p className="text-[11px] text-muted-foreground">{t("Someone new? Type their name below — they are added to {company}'s people.", { company: staff.company })}</p>
          </div>
        )}
        {!guest.id && !guest.createNew && phoneMatch && validPhone(guest.phone) && (
          <ExistingCustomer found={phoneMatch}
            onUse={() => { setGuest({ ...phoneMatch, phone: phoneMatch.phone || guest.phone }); setPhoneMatch(null); }}
            onNew={() => { setGuest({ ...guest, createNew: true }); setPhoneMatch(null); }} />
        )}
        {!guest.id && guest.createNew && (
          <p className="flex items-center justify-between gap-2 rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
            <span>{t("A new customer will be saved with this phone.")}</span>
            <button type="button" className="font-medium text-foreground underline underline-offset-2" onClick={() => setGuest({ ...guest, createNew: false })}>{t("Undo")}</button>
          </p>
        )}
        <div className="@container rounded-2xl border border-border/70 bg-muted/20 p-3 sm:p-4">
          <div className="grid gap-x-4 gap-y-3.5 @[36rem]:grid-cols-2">
            <label className="block space-y-1.5"><span className={LBL}>{t("Full name")} <span className="text-rose-500">*</span></span>
              <Input id="g-name" value={guest.fullName} onChange={set("fullName")} placeholder={meeting ? t("Person booking / contact") : t("As on their ID")} className="h-11 rounded-xl bg-card text-base font-medium" /></label>
            <label className="block space-y-1.5"><span className={LBL}>{t("Phone")} <span className="text-rose-500">*</span> <span className="font-normal normal-case tracking-normal">· WhatsApp</span></span>
              <Input id="g-phone" type="tel" inputMode="tel" value={guest.phone} onChange={(e) => setGuest({ ...guest, phone: e.target.value, createNew: false })} placeholder={t("07XX XXX XXX or +44…")} required
                aria-invalid={guest.phone.replace(/\D/g, "").length >= 9 && !validPhone(guest.phone)} className="h-11 rounded-xl bg-card text-base" /></label>
            {meeting ? (
              <>
                <label className="block space-y-1.5"><span className={LBL}>{t("Company")} <span className="font-normal normal-case tracking-normal">{t("(optional)")}</span></span>
                  <Input id="g-company" value={meeting.company} onChange={(e) => meeting.setCompany(e.target.value)} placeholder={t("e.g. ABC Company")} className="h-11 rounded-xl bg-card" /></label>
                <label className="block space-y-1.5"><span className={LBL}>{t("Email")} <span className="font-normal normal-case tracking-normal">{t("(optional)")}</span></span>
                  <Input id="g-email-m" type="email" value={guest.email} onChange={set("email")} className="h-11 rounded-xl bg-card" /></label>
              </>
            ) : (
              <>
                <div className="space-y-2 @[36rem]:col-span-2"><span className={LBL}>{t("ID")} <span className="font-normal normal-case tracking-normal">{t("(optional until check-in)")}</span></span>
                  <IdPicker type={guest.idType} number={guest.idNumber} numberId="g-idno"
                    onType={(v) => setGuest({ ...guest, idType: v })} onNumber={(v) => setGuest({ ...guest, idNumber: v })} />
                </div>
                <div className="space-y-2 @[36rem]:col-span-2"><span className={LBL}>{t("Nationality")}</span>
                  <NationalityPicker value={guest.nationality} onChange={(v) => setGuest({ ...guest, nationality: v })} />
                </div>
                <label className="block space-y-1.5"><span className={LBL}>{t("Email")} <span className="font-normal normal-case tracking-normal">{t("(optional)")}</span></span>
                  <Input id="g-email" type="email" value={guest.email} onChange={set("email")} placeholder="name@example.com" className="h-11 rounded-xl bg-card" /></label>
                <label className="block space-y-1.5"><span className={LBL}>{t("Address")} <span className="font-normal normal-case tracking-normal">{t("(optional)")}</span></span>
                  <Input id="g-addr" value={guest.address} onChange={set("address")} placeholder={t("City, country")} className="h-11 rounded-xl bg-card" /></label>
              </>
            )}
          </div>
        </div>
      </div>
    </Step>
  );
}

/** Guest pays (now or later), or the company is invoiced for the whole bill. */
function WhoPays(p: {
  canPay: boolean; payingNow: boolean; onPayNow: () => void; onPayAtHotel: () => void;
  /** Checked in now: paying later means paying at check-out. */
  checkInNow?: boolean;
  companies: { id: string; companyName: string; terms: number; available: number | null }[];
  company: { id: string; companyName: string; available: number | null } | null;
  onNewCompany: () => void;
  terms: number; companyPart: number; overCredit: boolean; canApprove: boolean; creditReason: string;
  onCompany: (id: string) => void; onTerms: (n: number) => void; onCreditReason: (s: string) => void;
}) {
  const t = useT();
  const chip = (on: boolean, tone: "dark" | "gold" = "dark") => cn(
    "h-9 rounded-lg text-xs font-semibold transition-all",
    on ? (tone === "gold" ? "bg-[oklch(0.75_0.13_80)] text-black shadow-sm" : "bg-card text-foreground shadow-sm ring-1 ring-border") : "text-muted-foreground hover:text-foreground",
  );
  return (
    <div className="space-y-2.5 rounded-2xl border border-border/70 p-3.5">
      <p className="flex items-center justify-between text-xs font-semibold">
        <span className="inline-flex items-center gap-1.5"><Building2 className="size-3.5" />{t("Payment type")}</span>
        {p.company && <span className="font-normal text-muted-foreground">{termsLabel(p.terms, t)}</span>}
      </p>
      <div className={cn("grid gap-1 rounded-xl bg-muted/70 p-1", p.canPay ? "grid-cols-3" : "grid-cols-2")}>
        {p.canPay && <button type="button" aria-pressed={!p.company && p.payingNow} onClick={p.onPayNow} className={chip(!p.company && p.payingNow)}>{t("Pay now")}</button>}
        <button type="button" aria-pressed={!p.company && !p.payingNow} onClick={p.onPayAtHotel} className={cn(chip(!p.company && !p.payingNow), "whitespace-nowrap")}>{p.checkInNow ? t("At check-out") : t("Pay later")}</button>
        <button type="button" aria-pressed={!!p.company} onClick={() => !p.company && (p.companies.length ? p.onCompany(p.companies[0].id) : p.onNewCompany())} className={chip(!!p.company, "gold")}>{t("Invoice")}</button>
      </div>
      {!p.company && !p.payingNow && <p className="text-[11px] text-muted-foreground">{p.checkInNow ? t("Checked in now — the bill is paid at check-out.") : t("No money now — the room is held as a pending booking until it is paid.")}</p>}
      {p.company && (
        <>
          <div className="flex gap-1.5">
            <NativeSelect aria-label={t("Company")} value={p.company.id} onChange={(e) => (e.target.value === "__new" ? p.onNewCompany() : p.onCompany(e.target.value))} className="h-9 flex-1 text-xs">
              {p.companies.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              <option value="__new">{t("+ New company…")}</option>
            </NativeSelect>
            <button type="button" onClick={p.onNewCompany} aria-label={t("New company")} title={t("New company")} className="grid size-9 shrink-0 place-items-center rounded-lg border border-border hover:bg-muted"><Plus className="size-4" /></button>
          </div>
          <div className="flex flex-wrap items-center gap-1">
            <span className="mr-1 text-[11px] text-muted-foreground">{t("Pay within")}</span>
            {PAYMENT_TERMS.map((d) => (
              <button key={d} type="button" aria-pressed={p.terms === d} onClick={() => p.onTerms(d)}
                className={cn("rounded-full border px-2 py-0.5 text-[11px] font-medium", p.terms === d ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
                {d === 0 ? t("Now") : t("{days} days", { days: d })}
              </button>
            ))}
          </div>
          {p.company.available != null && (
            <p className={cn("text-[11px]", p.overCredit ? "font-semibold text-rose-600 dark:text-rose-400" : "text-muted-foreground")}>
              {t("Credit left {amount}", { amount: formatTZS(Math.max(0, p.company.available)) })}{p.overCredit && ` — ${t("this booking puts {amount} on the account", { amount: formatTZS(p.companyPart) })}`}
            </p>
          )}
          {p.overCredit && (p.canApprove ? (
            <Input value={p.creditReason} onChange={(e) => p.onCreditReason(e.target.value)} placeholder={t("Manager approval: why allow it?")} className="h-9 text-xs" />
          ) : (
            <p className="rounded-lg bg-rose-500/10 px-2.5 py-2 text-[11px] text-rose-700 dark:text-rose-300">{t("Over the company's credit limit — a manager must approve this booking.")}</p>
          ))}
          <p className="text-[11px] text-muted-foreground">{t("The company pays the whole bill — room, food, drinks and extras all go on its invoice. The guest pays nothing.")}</p>
        </>
      )}
    </div>
  );
}

const initials = (name: string) => name.trim().split(/\s+/).filter((w) => /^\p{L}/u.test(w)).map((x) => x[0]).slice(0, 2).join("").toUpperCase();

/** The phone typed belongs to a saved customer: use them (no duplicate), look at their profile, or save a new person. */
function ExistingCustomer({ found, onUse, onNew }: { found: Guest; onUse: () => void; onNew: () => void }) {
  const t = useT();
  return (
    <div className="overflow-hidden rounded-2xl border border-sky-500/35 bg-sky-500/[0.06] animate-in fade-in-0 slide-in-from-top-1">
      <p className="border-b border-sky-500/20 px-3.5 py-1.5 text-[11px] font-semibold uppercase tracking-wider text-sky-700 dark:text-sky-300">{t("Existing customer found")}</p>
      <div className="flex flex-wrap items-center gap-3 px-3.5 py-3">
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-sky-500/15 text-sm font-bold text-sky-700 ring-1 ring-sky-500/30 dark:text-sky-300">{initials(found.fullName)}</span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="flex items-center gap-1.5 font-semibold">{found.fullName}{found.vip && <span className="rounded-full bg-[oklch(0.75_0.13_80)]/20 px-1.5 text-[9px] font-bold text-[oklch(0.5_0.12_75)] dark:text-[#f0cf86]">VIP</span>}</p>
          <p className="truncate text-xs text-muted-foreground">{[found.reference, found.phone, found.email].filter(Boolean).join(" · ")}</p>
          <p className="text-xs text-muted-foreground">{found.stays ? `${t.plural(found.stays, "{n} previous stay", "{n} previous stays")}${found.lastStay ? ` · ${t("last {date}", { date: t.date(found.lastStay, true) })}` : ""}` : t("No completed stay yet")}</p>
        </div>
        <div className="flex w-full flex-wrap gap-1.5 sm:w-auto">
          <Button size="sm" onClick={onUse}><UserCheck />{t("Use this customer")}</Button>
          <a href={`/staff/guests/${found.id}`} target="_blank" rel="noopener" className={buttonVariants({ size: "sm", variant: "outline" })}>{t("View profile")}</a>
          <Button size="sm" variant="ghost" onClick={onNew}>{t("Someone else")}</Button>
        </div>
      </div>
    </div>
  );
}
