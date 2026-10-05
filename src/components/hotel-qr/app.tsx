"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import type { ActionResult } from "@/server/errors";
import type { QrLanding, QrQuote, QrSearchResult } from "@/server/services/hotel-qr";
import { qrBookAction, qrQuoteAction, qrSearchAction, recordQrEventAction } from "@/app/b/[token]/actions";
import { useWho } from "@/components/restaurant/who";
import { StaySummary } from "./ui";
import { DatesSheet } from "./dates-sheet";
import { Landing } from "./landing";
import { RoomsView, TypeView, type Shell } from "./rooms";
import { ResultsView } from "./results";
import { RoomView } from "./room";
import { checkDetails, DetailsView, NO_DETAILS, type Details } from "./details";
import { BookedView, PayView, type PayWay } from "./pay";
import {
  dayWeek, flowUrl, guestsText, newKey, nightsOf, nightsText, parseLastBooking, payPhoneOk, readFlow, readLastBooking, saveLastBooking, stayKey,
  subscribeLastBooking, tzs, visitorId, type Flow, type StayQuery,
} from "./lib";

const OFFLINE: Extract<ActionResult, { ok: false }> = { ok: false, error: "No connection — please check your internet and try again." };
/** Server field names that belong to the details step. */
const DETAIL_FIELDS = ["fullName", "phone", "email", "arrivalTime", "transportTime", "flightNumber"];

/**
 * THE HOTEL BOOKING QR APP (/b/<token>) — Scan → hotel → rooms → availability → room → details → pay → confirm.
 * Each step is its own screen with a back arrow and its button at the bottom; the step, dates, guests and room live in
 * the address, so the phone's Back goes back a step and a reload keeps the place. Everything is asked of the server
 * (rooms free, prices, the booking, the payment) through the QR's actions — nothing the page holds is trusted.
 */
export function HotelQrApp({ token, landing }: { token: string; landing: QrLanding }) {
  const base = `/b/${token}`;
  const router = useRouter();
  const sp = useSearchParams();
  const flow = useMemo(() => readFlow(sp), [sp]);
  const reduce = useReducedMotion();
  const { hotel, roomTypes, booking, window: w } = landing;

  // Rooms with no photos yet show the hotel's own room photos.
  const roomPhotos = useMemo(() => hotel.photos.filter((p) => p.category === "rooms").map((p) => p.src).slice(0, 6), [hotel.photos]);
  const imagesOf = useCallback((t: { images: string[] }) => (t.images.length ? t.images : roomPhotos.length ? roomPhotos : [hotel.hero.src]), [roomPhotos, hotel.hero.src]);

  // ── Moving between steps (the address is the state) ──
  const pushed = useRef(0);
  const sheetPushed = useRef(false);
  useEffect(() => {
    const pop = () => { pushed.current = Math.max(0, pushed.current - 1); sheetPushed.current = false; };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const go = useCallback((patch: Partial<Flow>, how: "push" | "replace" = "push") => {
    const url = flowUrl(base, { ...flow, sheet: false, ...patch });
    if (how === "push") { pushed.current += 1; window.history.pushState(null, "", url); } else window.history.replaceState(null, "", url);
  }, [base, flow]);
  /** Back: the step before (the phone's history); opened straight on a step, its parent step. */
  const back = (parent: Partial<Flow>) => { if (pushed.current > 0) window.history.back(); else go(parent, "replace"); };

  const openSheet = (roomType?: string | null) => {
    sheetPushed.current = true;
    go({ sheet: true, roomType: roomType === undefined ? flow.roomType : roomType });
  };
  const closeSheet = () => {
    if (sheetPushed.current) { sheetPushed.current = false; window.history.back(); } else go({ sheet: false }, "replace");
  };

  // A new step starts at the top.
  const shownView = useRef(flow.view);
  useEffect(() => {
    if (shownView.current === flow.view) return;
    shownView.current = flow.view;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [flow.view]);

  // ── The scan: counted once per visit (this tab), by the page itself — link previews and bots do not count ──
  useEffect(() => {
    const k = `vegas-qr-scan:${token}`;
    try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, "1"); } catch { /* private mode: counted per load */ }
    recordQrEventAction(token, { type: "SCAN", visitor: visitorId() }).catch(() => null);
  }, [token]);

  // ── The booking made a moment ago in this tab ──
  const lastRaw = useSyncExternalStore(subscribeLastBooking, readLastBooking, () => null);
  const last = useMemo(() => parseLastBooking(lastRaw, token), [lastRaw, token]);

  // ── Check availability: the rooms free for the stay in the address ──
  const sKey = flow.stay ? stayKey(flow.stay, flow.roomType ?? "") : null;
  const [search, setSearch] = useState<{ key: string; res: ActionResult<QrSearchResult> } | null>(null);
  const wantSearch = flow.view === "results" && sKey !== null && search?.key !== sKey;
  useEffect(() => {
    if (!wantSearch || !flow.stay || !sKey) return;
    let live = true;
    qrSearchAction(token, { ...flow.stay, roomType: flow.roomType, visitor: visitorId() }).catch(() => OFFLINE).then((res) => {
      if (!live) return;
      setSearch({ key: sKey, res });
      if (!res.ok) { toast.error(res.error); if (res.code === "NOT_FOUND") router.refresh(); }
    });
    return () => { live = false; };
  }, [wantSearch, sKey, flow.stay, flow.roomType, token, router]);
  const searched = search?.key === sKey ? search.res : null;
  const result = searched?.ok ? searched.data : null;

  // ── The room picked: checked again and priced for the stay ──
  const needsRoom = flow.view === "room" || flow.view === "details" || flow.view === "pay";
  // Back from the payment page to a step of the room just booked: that booking, not the form (the room is theirs now).
  const justBooked = !!last && !!flow.stay && last.room === flow.room && last.checkIn === flow.stay.checkIn && last.checkOut === flow.stay.checkOut;
  const qKey = flow.stay && flow.room ? stayKey(flow.stay, flow.room) : null;
  const [quote, setQuote] = useState<{ key: string; res: ActionResult<QrQuote> } | null>(null);
  const wantQuote = needsRoom && !justBooked && qKey !== null && quote?.key !== qKey;
  useEffect(() => {
    if (!wantQuote || !flow.stay || !flow.room || !qKey) return;
    let live = true;
    qrQuoteAction(token, { ...flow.stay, roomNumber: flow.room, visitor: visitorId() }).catch(() => OFFLINE).then((res) => {
      if (!live) return;
      setQuote({ key: qKey, res });
      if (!res.ok) { toast.error(res.error); if (res.code === "NOT_FOUND") router.refresh(); }
    });
    return () => { live = false; };
  }, [wantQuote, qKey, flow.stay, flow.room, token, router]);
  const quoted = quote?.key === qKey ? quote.res : null;
  const q = quoted?.ok ? quoted.data : null;
  const offer = result?.types.flatMap((g) => g.rooms).find((o) => o.number === flow.room) ?? null;
  const offerType = result?.types.find((g) => g.rooms.some((o) => o.number === flow.room))?.type ?? null;
  const roomType = q?.type ?? offerType;

  // ── The guest's details (remembered from the restaurant on this phone, when they ordered there) ──
  const [who] = useWho();
  const [typed, setTyped] = useState<Partial<Details>>({});
  const d: Details = { ...NO_DETAILS, fullName: who && !who.known ? who.name : "", phone: who?.phone ?? "", email: who?.email ?? "", ...typed };
  const [errors, setErrors] = useState<Record<string, string>>({});
  const change = (patch: Partial<Details>) => {
    setTyped((t) => ({ ...t, ...patch }));
    setErrors((e) => {
      const n = { ...e };
      for (const k of Object.keys(patch)) delete n[k];
      if ("landingTime" in patch) delete n.transportTime;
      return n;
    });
  };

  // ── Paying ──
  const offered = q?.pay ?? booking;
  const [way, setWay] = useState<PayWay | null>(null);
  const payWay: PayWay = way === "ONLINE" && offered.online ? "ONLINE" : way === "HOTEL" && offered.atHotel ? "HOTEL" : offered.online ? "ONLINE" : "HOTEL";
  const [payPhone, setPayPhone] = useState<string | null>(null);
  const payNumber = payPhone ?? d.phone;
  const [payError, setPayError] = useState<string | null>(null);
  const [trap, setTrap] = useState("");
  /** This press's key, with what it was pressed for — another room, stay, way to pay or phone is another press (a new key). */
  const key = useRef<{ key: string; for: string } | null>(null);
  const [sending, startSending] = useTransition();

  const toPay = () => {
    const e = checkDetails(d);
    setErrors(e);
    if (Object.keys(e).length) { toast.error(Object.values(e)[0]); return; }
    go({ view: "pay" });
  };

  const book = () => startSending(async () => {
    const stay = flow.stay, room = flow.room;
    if (!stay || !room || !q) return;
    const e = checkDetails(d);
    if (Object.keys(e).length) { setErrors(e); toast.error(Object.values(e)[0]); go({ view: "details" }); return; }
    if (payWay === "ONLINE" && !payPhoneOk(payNumber)) { setPayError("Enter your mobile-money number, e.g. 0712 345 678."); return; }
    setPayError(null);
    // One key per press; kept only when the answer was lost (the same press again finds the same booking) — and only
    // while the guest books the same thing: changed after a lost answer, it is a new booking with a new key.
    const pressed = JSON.stringify([stay, room, payWay, d.phone.replace(/\D/g, "")]);
    if (key.current?.for !== pressed) key.current = { key: newKey(), for: pressed };
    const res = await qrBookAction(token, {
      checkIn: stay.checkIn, checkOut: stay.checkOut, adults: stay.adults, children: stay.children, roomNumber: room,
      guest: { fullName: d.fullName.trim(), phone: d.phone.trim(), email: d.email.trim() },
      arrivalTime: d.arrivalTime, specialRequest: d.specialRequest.trim() || null,
      transportRequest: d.pickup ? { flightNumber: d.flightNumber.trim() || null, arrivalTime: d.landingTime, note: d.pickupNote.trim() || "Airport pickup requested." } : null,
      pay: payWay, payPhone: payWay === "ONLINE" ? payNumber.trim() : null,
      clientKey: key.current.key, visitor: visitorId(), website: trap,
    }).catch(() => null);
    if (!res) { toast.error(OFFLINE.error); return; }
    if (!res.ok) {
      // "Being made" keeps the key: pressing again returns that booking. Any other answer: a new key next time.
      if (!(res.code === "CONFLICT" && /being made/i.test(res.error))) key.current = null;
      const fe = res.fieldErrors ?? {};
      const mine = Object.keys(fe).filter((k) => DETAIL_FIELDS.includes(k));
      if (fe.payPhone) { setPayError(res.error); return; }
      if (mine.length) { setErrors(Object.fromEntries(mine.map((k) => [k, res.error]))); toast.error(res.error); go({ view: "details" }); return; }
      toast.error(res.error);
      if (res.code === "UNAVAILABLE" || (res.code === "VALIDATION" && Object.keys(fe).some((k) => ["checkIn", "checkOut", "adults", "children", "roomNumber"].includes(k)))) {
        setSearch(null); setQuote(null); go({ view: "results", room: null });
      } else if (res.code === "NOT_FOUND" || res.code === "FORBIDDEN") router.refresh();
      return;
    }
    key.current = null;
    const b = res.data;
    saveLastBooking({
      qr: token, reference: b.reference, confirmUrl: b.confirmUrl, payUrl: b.payUrl, payWay: b.payWay,
      room, typeName: q.type.name, checkIn: stay.checkIn, checkOut: stay.checkOut, total: q.total,
    });
    // Back from the payment page shows this booking, not the form again.
    window.history.replaceState(null, "", flowUrl(base, { view: "booked", type: null, stay: null, roomType: null, room: null, sheet: false }));
    if (b.payUrl) router.push(b.payUrl);
    else {
      if (b.payWay === "ONLINE" && b.payError) toast.error(b.payError);
      router.push(b.confirmUrl);
    }
  });

  // ── What shows ──
  const openType = flow.view === "type" ? roomTypes.find((t) => t.slug === flow.type) ?? null : null;
  const view = flow.view === "booked" && !last ? "home"
    : needsRoom && justBooked ? "booked"
    : flow.view === "type" && !openType ? "rooms"
    : needsRoom && (!flow.stay || !flow.room) ? (flow.stay ? "results" : "home")
    : flow.view;
  const closed = booking.open ? null : booking.message ?? "Booking here is not available right now — please ask reception or call us.";
  const photo = roomType ? imagesOf(roomType)[0] ?? null : hotel.hero.src;
  const stay = flow.stay;
  const shell: Shell = {
    hotel: hotel.name, phone: hotel.phone, times: { checkIn: hotel.checkInTime, checkOut: hotel.checkoutTime },
    aside: (
      <StaySummary photo={needsRoom ? photo : openType ? imagesOf(openType)[0] ?? null : hotel.hero.src}
        title={needsRoom && flow.room ? `Room ${flow.room}` : openType?.name ?? hotel.name}
        sub={needsRoom ? roomType?.name ?? null : stay ? null : "Choose your dates to see the rooms that are free."}
        rows={stay ? [
          { label: "Check-in", value: `${dayWeek(stay.checkIn)} · ${hotel.checkInTime}` },
          { label: "Check-out", value: `${dayWeek(stay.checkOut)} · ${hotel.checkoutTime}` },
          { label: "Stay", value: `${nightsText(nightsOf(stay))} · ${guestsText(stay.adults, stay.children)}` },
        ] : [
          { label: "Check-in", value: `from ${hotel.checkInTime}` },
          { label: "Check-out", value: `by ${hotel.checkoutTime}` },
        ]}
        total={needsRoom && q ? { label: "Total", value: tzs(q.total) } : null} />
    ),
  };
  const typeName = (s: string | null) => (s ? roomTypes.find((t) => t.slug === s)?.name ?? null : null);

  let content: React.ReactNode;
  if (view === "rooms") {
    content = <RoomsView shell={shell} types={roomTypes} imagesOf={imagesOf} stay={stay} onBack={() => back({ view: "home" })}
      onView={(slug) => go({ view: "type", type: slug })}
      onSelect={(slug) => (stay ? go({ view: "results", roomType: slug }) : openSheet(slug))}
      onCheck={() => (stay ? go({ view: "results" }) : openSheet())} />;
  } else if (view === "type" && openType) {
    content = <TypeView shell={shell} t={openType} images={imagesOf(openType)} stay={stay} onBack={() => back({ view: "rooms" })}
      onCheck={() => (stay ? go({ view: "results", roomType: openType.slug }) : openSheet(openType.slug))} />;
  } else if (view === "results") {
    content = <ResultsView shell={shell} stay={stay} typeFilter={flow.roomType ? { slug: flow.roomType, name: typeName(flow.roomType) ?? "This room type" } : null}
      state={{ loading: wantSearch, result, error: searched && !searched.ok ? searched.error : null }} imagesOf={imagesOf}
      onBack={() => back({ view: "home" })} onEdit={() => openSheet()} onClearType={() => go({ roomType: null }, "replace")}
      onSelect={(o) => go({ view: "room", room: o.number })} onRetry={() => setSearch(null)} />;
  } else if (view === "room" && stay && flow.room) {
    content = <RoomView shell={shell} stay={stay} number={flow.room} offer={offer} type={roomType}
      state={{ loading: wantQuote, quote: q, error: quoted && !quoted.ok ? { message: quoted.error, taken: quoted.code === "UNAVAILABLE" } : null }}
      images={roomType ? imagesOf(roomType) : roomPhotos.length ? roomPhotos : [hotel.hero.src]}
      onBack={() => back({ view: "results", room: null })} onContinue={() => go({ view: "details" })}
      onSeeRooms={() => { setSearch(null); setQuote(null); go({ view: "results", room: null }, "replace"); }} onRetry={() => setQuote(null)} />;
  } else if (view === "details" && stay && flow.room) {
    content = <DetailsView shell={shell} stay={stay} number={flow.room} typeName={roomType?.name ?? null} photo={photo} quote={q}
      d={d} errors={errors} onChange={change} onBack={() => back({ view: "room" })} onContinue={toPay} />;
  } else if (view === "pay" && stay && flow.room) {
    content = <PayView shell={shell} stay={stay} number={flow.room} typeName={roomType?.name ?? null} photo={photo} quote={q}
      way={payWay} onWay={setWay} payPhone={payNumber} onPayPhone={(v) => { setPayPhone(v); setPayError(null); }} payError={payError}
      trap={trap} onTrap={setTrap} pending={sending} onBook={book} onBack={() => back({ view: "details" })} />;
  } else if (view === "booked" && last) {
    content = <BookedView last={last} busy={sending} />;
  } else {
    content = <Landing landing={landing} imagesOf={imagesOf} last={last} onExplore={() => go({ view: "rooms" })} onCheck={() => openSheet()} onType={(slug) => go({ view: "type", type: slug })} />;
  }

  return (
    <main className="vr relative min-h-svh overflow-x-clip bg-(--vr-bg) text-[14.5px] text-(--vr-ink)">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={view} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}>
          {content}
        </motion.div>
      </AnimatePresence>
      <DatesSheet open={flow.sheet} onClose={closeSheet} window={w} types={roomTypes.map((t) => ({ slug: t.slug, name: t.name, maxAdults: t.maxAdults, maxChildren: t.maxChildren }))}
        initial={{ stay, roomType: flow.roomType }} closed={closed} phone={hotel.phone}
        onSubmit={(next: StayQuery, rt: string | null) => {
          sheetPushed.current = false;
          setSearch(null);
          window.history.replaceState(null, "", flowUrl(base, { ...flow, view: "results", stay: next, roomType: rt, room: null, sheet: false }));
        }} />
    </main>
  );
}
