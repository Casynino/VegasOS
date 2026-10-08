"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { toast } from "sonner";
import type { ActionResult } from "@/server/errors";
import type { QrLanding, QrQuote, QrRoomOffer, QrRoomType, QrSearchResult } from "@/server/services/hotel-qr";
import type { QrExplore } from "@/server/services/hotel-qr-explore";
import { qrBookAction, qrQuoteAction, qrSearchAction, recordQrEventAction } from "@/app/b/[token]/actions";
import { usePhoneLookup, useWho } from "@/components/restaurant/who";
import { identifyCustomerAction } from "@/app/order/actions";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";
import { StaySummary, useBackClose } from "./ui";
import { DatesSheet } from "./dates-sheet";
import { Landing } from "./landing";
import { bestOffer, ResultsView, type Shell, type TypeGroup } from "./results";
import { BookView } from "./book";
import { checkDetails, EXTRA_FIELDS, NO_DETAILS, type Details } from "./details";
import { BookedView, type PayWay } from "./pay";
import { TypeSheet } from "./type-sheet";
import { PhotoViewerProvider } from "./viewer";
import type { QrHero } from "./hero";
import {
  dayWeek, defaultStay, flowUrl, guestsText, historyDepth, newKey, nightsOf, nightsText, parseLastBooking, parseSavedGuest, payPhoneOk, readFlow,
  readLastBooking, readSavedGuest, saveGuest, saveLastBooking, stayFor, stayKey, subscribeLastBooking, subscribeSavedGuest, tzs, visitorId,
  type Flow, type StayQuery,
} from "./lib";

const noSubscribe = () => () => {};
const OFFLINE: Extract<ActionResult, { ok: false }> = { ok: false, error: msg("No connection — please check your internet and try again.") };
/** The server's "your booking is being made" answer (any language): pressing again must find that same booking. */
const BEING_MADE = msg("Your booking is being made — please wait a moment, then check your booking.");
/** Server field names that belong to the details step, and where each one is on the screen. */
const FIELD_ID: Record<string, string> = {
  fullName: "qr-name", phone: "qr-phone", email: "qr-email", arrivalTime: "qr-arrival", transportTime: "qr-landing", flightNumber: "qr-flight", payPhone: "qr-pay-phone",
};
const DETAIL_FIELDS = ["fullName", "phone", "email", "arrivalTime", "transportTime", "flightNumber"];

/**
 * THE HOTEL BOOKING QR APP (/b/<token>) — explore the hotel, then book in three steps:
 *   1. dates & guests (the booking bar — tonight → tomorrow already chosen — or a room's Book; the dates sheet to change),
 *   2. choose your room (the free rooms, priced; one tap on Book),
 *   3. your details & pay on one screen (one gold button) → the payment page or the confirmation.
 * The step, dates, guests and room live in the address, so the phone's Back goes back a step and a reload keeps the
 * place; a room's sheet and the photo viewer close with Back too. Everything is asked of the server (rooms free,
 * prices, the booking, the payment) through the QR's actions — nothing the page holds is trusted.
 */
export function HotelQrApp({ token, landing, explore, hero }: { token: string; landing: QrLanding; explore: QrExplore; hero: QrHero }) {
  return (
    <PhotoViewerProvider>
      <QrFlow token={token} landing={landing} explore={explore} hero={hero} />
    </PhotoViewerProvider>
  );
}

function QrFlow({ token, landing, explore, hero }: { token: string; landing: QrLanding; explore: QrExplore; hero: QrHero }) {
  const t = useT();
  const base = `/b/${token}`;
  const router = useRouter();
  const sp = useSearchParams();
  const flow = useMemo(() => readFlow(sp), [sp]);
  const reduce = useReducedMotion();
  const { hotel, roomTypes, booking, window: w } = landing;

  // Rooms with no photos yet show the hotel's own room photos.
  const roomPhotos = useMemo(() => hotel.photos.filter((p) => p.category === "rooms").map((p) => p.src).slice(0, 6), [hotel.photos]);
  const imagesOf = useCallback((x: { images: string[] }) => (x.images.length ? x.images : roomPhotos.length ? roomPhotos : [hotel.hero.src]), [roomPhotos, hotel.hero.src]);

  // ── Moving between steps (the address is the state; each entry knows how deep in the app it is) ──
  const sheetPushed = useRef(false);
  useEffect(() => {
    const pop = () => { sheetPushed.current = false; };
    window.addEventListener("popstate", pop);
    return () => window.removeEventListener("popstate", pop);
  }, []);
  const go = useCallback((patch: Partial<Flow>, how: "push" | "replace" = "push") => {
    const url = flowUrl(base, { ...flow, sheet: false, ...patch });
    if (how === "push") window.history.pushState({ vqr: historyDepth() + 1 }, "", url);
    else window.history.replaceState({ vqr: historyDepth() }, "", url);
  }, [base, flow]);
  /** Back: the step before (the phone's history); opened straight on a step, its parent step. */
  const back = (parent: Partial<Flow>) => { if (historyDepth() > 0) window.history.back(); else go(parent, "replace"); };

  const openSheet = () => { sheetPushed.current = true; go({ sheet: true }); };
  const closeSheet = () => {
    if (sheetPushed.current) { sheetPushed.current = false; window.history.back(); } else go({ sheet: false }, "replace");
  };

  // ── Which screen (older links: "rooms"/"type" open the hotel, "room"/"pay" the details & pay step) ──
  const step = flow.view === "rooms" || flow.view === "type" ? "home" : flow.view === "room" || flow.view === "pay" ? "details" : flow.view;

  // A new step starts at the top.
  const shownView = useRef(step);
  useEffect(() => {
    if (shownView.current === step) return;
    shownView.current = step;
    window.scrollTo({ top: 0, behavior: "instant" });
  }, [step]);

  // ── The scan: counted once per visit (this tab), by the page itself — link previews and bots do not count ──
  useEffect(() => {
    const k = `vegas-qr-scan:${token}`;
    try { if (sessionStorage.getItem(k)) return; sessionStorage.setItem(k, "1"); } catch { /* private mode: counted per load */ }
    recordQrEventAction(token, { type: "SCAN", visitor: visitorId() }).catch(() => null);
  }, [token]);

  // ── The booking made a moment ago in this tab (read once the page is running here — until then "booked" waits) ──
  const running = useSyncExternalStore(noSubscribe, () => true, () => false);
  const lastRaw = useSyncExternalStore(subscribeLastBooking, readLastBooking, () => null);
  const last = useMemo(() => parseLastBooking(lastRaw, token), [lastRaw, token]);

  // ── The stay the booking bar shows: the last one the guest chose (Back to the hotel keeps it), else tonight →
  //    tomorrow. A stay fitted to one room type ("Book" on a Single: 1 guest) does not change the bar. ──
  const [kept, setKept] = useState<StayQuery | null>(flow.roomType ? null : flow.stay);
  if (flow.stay && !flow.roomType && (!kept || stayKey(flow.stay) !== stayKey(kept))) setKept(flow.stay);
  const barStay = kept && kept.checkIn >= w.today ? kept : defaultStay(w);

  // ── 2. The rooms free for the stay in the address ──
  const sKey = flow.stay ? stayKey(flow.stay, flow.roomType ?? "") : null;
  const [search, setSearch] = useState<{ key: string; res: ActionResult<QrSearchResult> } | null>(null);
  const wantSearch = step === "results" && sKey !== null && search?.key !== sKey;
  useEffect(() => {
    if (!wantSearch || !flow.stay || !sKey) return;
    let live = true;
    qrSearchAction(token, { ...flow.stay, roomType: flow.roomType, visitor: visitorId() }).catch(() => OFFLINE).then((res) => {
      if (!live) return;
      setSearch({ key: sKey, res });
      if (!res.ok) { toast.error(t(res.error)); if (res.code === "NOT_FOUND") router.refresh(); }
    });
    return () => { live = false; };
  }, [wantSearch, sKey, flow.stay, flow.roomType, token, router, t]);
  const searched = search?.key === sKey ? search.res : null;
  const result = searched?.ok ? searched.data : null;

  // ── 3. The room picked: checked again and priced for the stay ──
  const needsRoom = step === "details";
  // Back from the payment page to the step of the room just booked: that booking, not the form (the room is theirs now).
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
      if (!res.ok) { toast.error(t(res.error)); if (res.code === "NOT_FOUND") router.refresh(); }
    });
    return () => { live = false; };
  }, [wantQuote, qKey, flow.stay, flow.room, token, router, t]);
  const quoted = quote?.key === qKey ? quote.res : null;
  const q = quoted?.ok ? quoted.data : null;
  const offer = result?.types.flatMap((g) => g.rooms).find((o) => o.number === flow.room) ?? null;
  const offerType = result?.types.find((g) => g.rooms.some((o) => o.number === flow.room))?.type ?? null;
  const roomType = q?.type ?? offerType;

  // ── The guest's details: remembered on this phone from a booking here (or from the restaurant, when they ordered) ──
  const [who] = useWho();
  const savedRaw = useSyncExternalStore(subscribeSavedGuest, readSavedGuest, () => null);
  const saved = useMemo(() => parseSavedGuest(savedRaw), [savedRaw]);
  const [typed, setTyped] = useState<Partial<Details>>({});
  const d: Details = {
    ...NO_DETAILS, fullName: saved?.name ?? (who && !who.known ? who.name : ""), phone: saved?.phone ?? who?.phone ?? "", email: who?.email ?? "", ...typed,
  };
  const remembered = !!saved && typed.fullName === undefined && typed.phone === undefined;
  // The number first (owner, 2026-10-05): someone we know is greeted by name and types nothing more about themselves.
  const lookup = useCallback(async (p: string) => {
    const r = await identifyCustomerAction({ phone: p });
    return r.ok ? r.data.name : null;
  }, []);
  const guest = usePhoneLookup(d.phone, lookup);
  const known = guest.step === "known";
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [extrasOpen, setExtrasOpen] = useState(false);
  const change = (patch: Partial<Details>) => {
    setTyped((x) => ({ ...x, ...patch }));
    setErrors((e) => {
      const n = { ...e };
      for (const k of Object.keys(patch)) delete n[k];
      if ("landingTime" in patch) delete n.transportTime;
      return n;
    });
  };
  const forget = () => { saveGuest(null); setTyped((x) => ({ ...x, fullName: "", phone: "" })); };
  /** "Not you?" on the greeting: a new guest on this number — and this phone forgets the last one. */
  const notMe = () => { guest.notMe(); saveGuest(null); setTyped((x) => ({ ...x, fullName: "" })); };
  /** Show the guest what to fix: open the extras when it is there, and bring the first field into view. */
  const showErrors = (e: Record<string, string>) => {
    setErrors(e);
    const first = Object.keys(e)[0];
    if (!first) return;
    if (Object.keys(e).some((k) => EXTRA_FIELDS.includes(k))) setExtrasOpen(true);
    toast.error(t(e[first]));
    requestAnimationFrame(() => {
      const el = document.getElementById(FIELD_ID[first] ?? "");
      el?.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
      el?.focus({ preventScroll: true });
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

  const book = () => startSending(async () => {
    const stay = flow.stay, room = flow.room;
    if (!stay || !room || !q) return;
    const e = checkDetails(d, { known });
    if (Object.keys(e).length) { showErrors(e); return; }
    if (payWay === "ONLINE" && !payPhoneOk(payNumber)) {
      setPayError(msg("Enter your mobile-money number, e.g. 0712 345 678."));
      if (payPhone === null) setPayPhone(d.phone);
      showErrors({ payPhone: msg("Enter your mobile-money number, e.g. 0712 345 678.") });
      return;
    }
    setPayError(null);
    // One key per press; kept only when the answer was lost (the same press again finds the same booking) — and only
    // while the guest books the same thing: changed after a lost answer, it is a new booking with a new key.
    const pressed = JSON.stringify([stay, room, payWay, d.phone.replace(/\D/g, "")]);
    if (key.current?.for !== pressed) key.current = { key: newKey(), for: pressed };
    const res = await qrBookAction(token, {
      checkIn: stay.checkIn, checkOut: stay.checkOut, adults: stay.adults, children: stay.children, roomNumber: room,
      guest: { fullName: known ? "" : d.fullName.trim(), phone: d.phone.trim(), email: d.email.trim() },
      arrivalTime: d.arrivalTime, specialRequest: d.specialRequest.trim() || null,
      transportRequest: d.pickup ? { flightNumber: d.flightNumber.trim() || null, arrivalTime: d.landingTime, note: d.pickupNote.trim() || "Airport pickup requested." } : null,
      pay: payWay, payPhone: payWay === "ONLINE" ? payNumber.trim() : null,
      clientKey: key.current.key, visitor: visitorId(), website: trap,
    }).catch(() => null);
    if (!res) { toast.error(t(OFFLINE.error)); return; }
    if (!res.ok) {
      // "Being made" keeps the key: pressing again returns that booking. Any other answer: a new key next time.
      if (!(res.code === "CONFLICT" && (/being made/i.test(res.error) || res.error === t(BEING_MADE)))) key.current = null;
      const fe = res.fieldErrors ?? {};
      const mine = Object.keys(fe).filter((k) => DETAIL_FIELDS.includes(k));
      if (fe.payPhone) { setPayError(res.error); if (payPhone === null) setPayPhone(d.phone); showErrors({ payPhone: res.error }); return; }
      if (mine.length) { showErrors(Object.fromEntries(mine.map((k) => [k, res.error]))); return; }
      toast.error(t(res.error));
      if (res.code === "UNAVAILABLE" || (res.code === "VALIDATION" && Object.keys(fe).some((k) => ["checkIn", "checkOut", "adults", "children", "roomNumber"].includes(k)))) {
        setSearch(null); setQuote(null); go({ view: "results", room: null });
      } else if (res.code === "NOT_FOUND" || res.code === "FORBIDDEN") router.refresh();
      return;
    }
    key.current = null;
    const b = res.data;
    // Remembered on this phone only, so the next booking here is two taps ("Not you?" forgets it).
    saveGuest({ name: known ? guest.knownName! : d.fullName.trim(), phone: d.phone.trim() });
    saveLastBooking({
      qr: token, reference: b.reference, confirmUrl: b.confirmUrl, payUrl: b.payUrl, payWay: b.payWay,
      room, typeName: q.type.name, checkIn: stay.checkIn, checkOut: stay.checkOut, total: q.total,
    });
    // Back from the payment page shows this booking, not the form again.
    window.history.replaceState({ vqr: historyDepth() }, "", flowUrl(base, { view: "booked", type: null, stay: null, roomType: null, room: null, sheet: false }));
    if (b.payUrl) router.push(b.payUrl);
    else {
      if (b.payWay === "ONLINE" && b.payError) toast.error(t(b.payError));
      router.push(b.confirmUrl);
    }
  });

  // ── A room type up close (a sheet; the phone's Back closes it) ──
  // (Closed, it keeps its room type a moment longer, so it slides away instead of vanishing.)
  const [typeSheet, setTypeSheet] = useState<{ slug: string; where: "home" | "results"; open: boolean } | null>(null);
  const hideType = useCallback(() => setTypeSheet((s) => s && { ...s, open: false }), []);
  const sheetHistory = useBackClose(hideType);
  const openType = (slug: string, where: "home" | "results") => { sheetHistory.opened(); setTypeSheet({ slug, where, open: true }); };
  const closeType = () => { sheetHistory.closed(); hideType(); };
  /** Leave the sheet for another step: its history entry becomes that step (Back returns to where it was opened). */
  const fromSheet = (patch: Partial<Flow>) => { go(patch, "replace"); hideType(); sheetHistory.closed(); };

  /** "Book" on a room type (the hotel page): its free rooms for the bar's dates, with guests it takes. */
  const bookType = (t: QrRoomType, how: "push" | "sheet" = "push") => {
    const patch: Partial<Flow> = { view: "results", stay: stayFor(barStay, t), roomType: t.slug, room: null };
    if (how === "sheet") fromSheet(patch); else go(patch);
  };
  /** "Book" on a room (step 2): straight to the details & pay step. */
  const bookRoom = (o: QrRoomOffer, how: "push" | "sheet" = "push") => {
    const patch: Partial<Flow> = { view: "details", room: o.number };
    if (how === "sheet") fromSheet(patch); else go(patch);
  };

  // ── What shows ──
  const view = step === "booked" && !last ? "home"
    : needsRoom && justBooked ? "booked"
    : needsRoom && (!flow.stay || !flow.room) ? (flow.stay ? "results" : "home")
    : step;
  const closed = booking.open ? null : booking.message ?? msg("Booking here is not available right now — please ask reception or call us.");
  const photo = roomType ? imagesOf(roomType)[0] ?? null : hotel.hero.src;
  const stay = flow.stay;
  const shell: Shell = {
    hotel: hotel.name, phone: hotel.phone, times: { checkIn: hotel.checkInTime, checkOut: hotel.checkoutTime },
    aside: (
      <StaySummary photo={needsRoom ? photo : explore.opening[0]?.wide.src ?? hotel.hero.src}
        title={needsRoom ? (roomType ? t(roomType.name) : t("Your room")) : hotel.name}
        sub={needsRoom && flow.room ? t("Room {number}", { number: flow.room }) : null}
        rows={stay ? [
          { label: t("Check-in"), value: `${dayWeek(stay.checkIn, t)} · ${hotel.checkInTime}` },
          { label: t("Check-out"), value: `${dayWeek(stay.checkOut, t)} · ${hotel.checkoutTime}` },
          { label: t("Stay"), value: `${nightsText(nightsOf(stay), t)} · ${guestsText(stay.adults, stay.children, t)}` },
        ] : []}
        total={needsRoom && q ? { label: t("Total"), value: tzs(q.total) } : null} />
    ),
  };
  const typeName = (s: string | null) => (s ? roomTypes.find((x) => x.slug === s)?.name ?? null : null);

  let content: React.ReactNode;
  if (view === "results") {
    content = <ResultsView shell={shell} stay={stay} typeFilter={flow.roomType ? { slug: flow.roomType, name: typeName(flow.roomType) ?? t("This room type") } : null}
      state={{ loading: wantSearch, result, error: searched && !searched.ok ? searched.error : null }} imagesOf={imagesOf}
      onBack={() => back({ view: "home", stay: null, roomType: null })} onEdit={openSheet} onClearType={() => go({ roomType: null }, "replace")}
      onBook={(o) => bookRoom(o)} onDetails={(g: TypeGroup) => openType(g.type.slug, "results")} onRetry={() => setSearch(null)} />;
  } else if (view === "details" && stay && flow.room) {
    content = <BookView shell={shell} stay={stay} number={flow.room} offer={offer} type={roomType} photo={photo}
      state={{ loading: wantQuote, quote: q, error: quoted && !quoted.ok ? { message: quoted.error, taken: quoted.code === "UNAVAILABLE" } : null }}
      pay={offered} d={d} errors={errors} onChange={change} remembered={remembered} onForget={forget} guest={{ step: guest.step, name: guest.knownName, notMe }} extrasOpen={extrasOpen} onExtras={setExtrasOpen}
      way={payWay} onWay={setWay} payPhone={payNumber} samePhone={payPhone === null}
      onPayPhone={(v) => { setPayPhone(v); setPayError(null); setErrors((e) => { const n = { ...e }; delete n.payPhone; return n; }); }} payError={payError}
      trap={trap} onTrap={setTrap} pending={sending} onBook={book} onBack={() => back({ view: "results", room: null })}
      onSeeRooms={() => { setSearch(null); setQuote(null); go({ view: "results", room: null }, "replace"); }} onRetry={() => setQuote(null)} />;
  } else if (view === "booked" && last) {
    content = <BookedView last={last} busy={sending} />;
  } else if (step === "booked" && !running) {
    content = <div className="min-h-svh" aria-busy="true" />;
  } else {
    content = <Landing landing={landing} explore={explore} hero={hero} imagesOf={imagesOf} last={last} stay={barStay}
      onDates={openSheet} onSee={() => go({ view: "results", stay: barStay, roomType: null, room: null })}
      onBookType={(x) => bookType(x)} onTypeDetails={(x) => openType(x.slug, "home")} />;
  }

  // The room type in the sheet: tonight's price on the hotel page; the stay's price (its best room) on step 2.
  const sheetType = typeSheet?.where === "home" ? roomTypes.find((x) => x.slug === typeSheet.slug) ?? null : null;
  const sheetGroup = typeSheet?.where === "results" ? result?.types.find((g) => g.type.slug === typeSheet.slug) ?? null : null;
  const sheetBest = sheetGroup ? bestOffer(sheetGroup.rooms) : null;

  return (
    <main className="vr relative min-h-svh overflow-x-clip bg-(--vr-bg) text-[14.5px] text-(--vr-ink)">
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={view} initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0 }}
          transition={{ duration: 0.18, ease: "easeOut" }}>
          {content}
        </motion.div>
      </AnimatePresence>
      <DatesSheet open={flow.sheet} onClose={closeSheet} window={w} types={roomTypes.map((x) => ({ slug: x.slug, name: x.name, maxAdults: x.maxAdults, maxChildren: x.maxChildren }))}
        initial={{ stay: stay ?? barStay, roomType: flow.roomType }} closed={closed} phone={hotel.phone}
        onSubmit={(next: StayQuery, rt: string | null) => {
          sheetPushed.current = false;
          setSearch(null);
          setKept(next);
          window.history.replaceState({ vqr: historyDepth() }, "", flowUrl(base, { ...flow, view: "results", stay: next, roomType: rt, room: null, sheet: false }));
        }} />
      <TypeSheet key={typeSheet ? `${typeSheet.where}-${typeSheet.slug}` : "none"} open={!!typeSheet?.open && !!(sheetType || sheetGroup)} onClose={closeType}
        t={sheetType ?? sheetGroup?.type ?? null} images={sheetType ? imagesOf(sheetType) : sheetGroup ? imagesOf(sheetGroup.type) : []}
        price={sheetType ? { perNight: sheetType.fromPerNight, base: sheetType.baseRate, offer: sheetType.fromPerNight < sheetType.baseRate ? sheetType.promoLabel ?? sheetType.promotion : null, from: true }
          : sheetBest ? { perNight: sheetBest.perNight, base: sheetBest.ratePerNight, offer: sheetBest.discount > 0 ? sheetBest.promotion ?? t("Offer") : null, total: sheetBest.total, nights: result?.stay.nights ?? null } : null}
        free={sheetType ? (sheetType.freeTonight > 0 ? t("{n} free tonight", { n: sheetType.freeTonight }) : t("Full tonight — other nights may be free")) : sheetGroup ? t("{n} free for your dates", { n: sheetGroup.available }) : null}
        cta={closed ? null : sheetType ? { label: t("Book"), onClick: () => bookType(sheetType, "sheet") } : sheetBest ? { label: t("Book"), onClick: () => bookRoom(sheetBest, "sheet") } : null} />
    </main>
  );
}
