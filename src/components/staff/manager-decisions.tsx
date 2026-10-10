"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BadgePercent, CalendarX2, CheckCircle2, Clock, DoorOpen, Gift, HandCoins, Loader2, Lock, Repeat, SprayCan, UserRoundCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { ChangeRoomDialog } from "@/components/staff/reception/change-room-dialog";
import { billDiscountAction, roomServiceWaiterAction, stayBillDiscountAction, waitersAction, cancelClosureAction, freeLateCheckoutAction, freeNightsAction, leaveOwingAction, planClosureAction, roomDiscountAction, withdrawLeaveOwingAction } from "@/app/staff/(app)/manager-actions";
import { changeRoomStatusAction } from "@/app/staff/(app)/rooms/actions";
import { releaseNoShowAction } from "@/app/staff/(app)/reservations/actions";
import type { HotelMoveReason } from "@/lib/room-change";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

const n = (v: number) => v.toLocaleString("en-US");
const field = "h-10 w-full min-w-0 rounded-xl border border-border/80 bg-background/60 px-3 text-sm outline-none focus:border-[oklch(0.78_0.12_80)] focus:ring-4 focus:ring-[oklch(0.78_0.12_80/0.15)]";

function Shell({ title, sub, children }: { title: string; sub: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-[oklch(0.75_0.12_80/0.4)] bg-[oklch(0.75_0.12_80/0.06)] p-3.5">
      <p className="flex items-center gap-2 text-sm font-semibold">{title}</p>
      <p className="mb-3 text-[11px] text-muted-foreground">{sub}</p>
      {children}
    </section>
  );
}

function Chip({ on, onClick, children }: { on: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} aria-pressed={on}
      className={cn("inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors", on ? "border-[oklch(0.75_0.12_80)] bg-[oklch(0.75_0.12_80/0.18)] text-foreground" : "border-border/70 bg-card hover:bg-muted")}>
      {children}
    </button>
  );
}

/**
 * On a guest's stay, for managers, the MD and the owner: the decisions that are theirs —
 * extra nights on the house, a free late checkout, a discount per night, moving the guest to
 * another room (a problem in theirs: free, the old room goes to maintenance or cleaning, the
 * bill and history stay). Reception does the rest.
 */
export function StayDecisions({ stay, leavingToday, discountMax, move, owing }: {
  stay: { reservationRoomId: string; ratePerNight: number; discountPerNight: number; nights: number };
  leavingToday: boolean; discountMax: number;
  /** Set when this person may move the guest (reservations.edit). */
  move?: { reservationId: string; guest: string; room: string } | null;
  /** What the guest owes, and any approval to leave owing. */
  owing?: { reservationId: string; guest: string; balance: number; approved: { upTo: number; reason: string } | null } | null;
}) {
  const t = useT();
  const router = useRouter();
  const [mode, setMode] = useState<"nights" | "late" | "discount" | "owing" | null>(null);
  const [moving, setMoving] = useState(false);
  const pick = (m: typeof mode) => setMode(mode === m ? null : m);
  return (
    <Shell title={t("Your decisions")} sub={t("Reception runs the stay — these are yours to give, recorded with your name and reason.")}>
      {moving && move && (
        <ChangeRoomDialog reservationId={move.reservationId} reservationRoomId={stay.reservationRoomId} guest={move.guest} methods={[]} inHouse
          onClose={() => { setMoving(false); router.refresh(); }} />
      )}
      <div className="flex flex-wrap gap-2">
        {move && <Chip on={moving} onClick={() => { setMode(null); setMoving(true); }}><Repeat className="size-3.5" />{t("Move guest · room {room}", { room: move.room })}</Chip>}
        <Chip on={mode === "nights"} onClick={() => pick("nights")}><Gift className="size-3.5" />{t("Free nights")}</Chip>
        {leavingToday && <Chip on={mode === "late"} onClick={() => pick("late")}><Clock className="size-3.5" />{t("Free late checkout")}</Chip>}
        {(discountMax > 0 || (owing?.balance ?? 0) > 0) && <Chip on={mode === "discount"} onClick={() => pick("discount")}><BadgePercent className="size-3.5" />{t("Discount")}{stay.discountPerNight ? ` · ${t("{amount}/night", { amount: n(stay.discountPerNight) })}` : ""}</Chip>}
        {owing && (owing.balance > 0 || owing.approved) && <Chip on={mode === "owing"} onClick={() => pick("owing")}><HandCoins className="size-3.5" />{owing.approved ? t("May leave owing ✓") : t("Let leave owing")}</Chip>}
      </div>
      {mode === "owing" && owing && <OwingForm reservationId={owing.reservationId} guest={owing.guest} balance={owing.balance} approved={owing.approved} onDone={() => { setMode(null); router.refresh(); }} />}
      {mode === "discount" && (owing
        ? <DiscountPanel reservationId={owing.reservationId} toPay={owing.balance} stay={discountMax > 0 ? stay : null} discountMax={discountMax} onDone={() => { setMode(null); router.refresh(); }} />
        : <StayForm mode="discount" stay={stay} discountMax={discountMax} onDone={() => { setMode(null); router.refresh(); }} />)}
      {(mode === "nights" || mode === "late") && <StayForm key={mode} mode={mode} stay={stay} discountMax={discountMax} onDone={() => { setMode(null); router.refresh(); }} />}
    </Shell>
  );
}

/** On a table's (or an order's) bill, for managers, the MD and the owner: take something off. */
export function BillDiscount({ sessionId, orderIds, due }: { sessionId?: string | null; orderIds?: string[]; due: number }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [byPct, setByPct] = useState(false);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const v = Number(value) || 0;
  const off = byPct ? Math.round((due * Math.min(100, v)) / 100) : v;
  const go = () => start(async () => {
    const r = await billDiscountAction({ sessionId: sessionId ?? null, orderIds, amount: byPct ? null : v, percent: byPct ? v : null, reason });
    if (r.ok) { toast.success(t("TZS {amount} off the bill.", { amount: n(r.data.amount) })); setOpen(false); setValue(""); setReason(""); router.refresh(); } else toast.error(r.error);
  });
  if (due <= 0) return null;
  return (
    <Shell title={t("Your decisions")} sub={t("Waiters serve the orders and receive the money — a discount is yours to give.")}>
      {!open ? (
        <button type="button" onClick={() => setOpen(true)} className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-border/70 bg-card px-3 text-xs font-semibold hover:bg-muted"><BadgePercent className="size-3.5" />{t("Discount on this bill · TZS {amount} to pay", { amount: n(due) })}</button>
      ) : (
        <div className="space-y-2.5">
          <div className="flex gap-1.5">
            <Chip on={!byPct} onClick={() => setByPct(false)}>{t("TZS amount")}</Chip>
            <Chip on={byPct} onClick={() => setByPct(true)}>{t("Percent %")}</Chip>
            {byPct && [10, 20, 50].map((p) => <Chip key={p} on={v === p} onClick={() => setValue(String(p))}>{p}%</Chip>)}
          </div>
          <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))} placeholder={byPct ? t("e.g. 10") : t("e.g. 5000")} className={field} />
          <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Why? e.g. late food, regular customer")} className={field} />
          <button type="button" disabled={pending || off <= 0 || off > due || reason.trim().length < 3} onClick={go}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-sm font-semibold text-[oklch(0.2_0.03_60)] transition hover:brightness-105 disabled:opacity-50">
            {pending && <Loader2 className="size-4 animate-spin" />}{t("Give TZS {amount} off · leaves TZS {left}", { amount: n(off), left: n(Math.max(0, due - off)) })}
          </button>
        </div>
      )}
    </Shell>
  );
}

// ─────────────────────────────── The room: a manager's say over it ───────────────────────────────

/** What needs fixing — and the matching reason when the guest has to move for it. The label (English) is saved in the closure's reason; it is shown with t(). */
const FAULTS: { label: string; move: HotelMoveReason }[] = [
  { label: msg("AC / fan"), move: "AC_PROBLEM" }, { label: msg("Water / plumbing"), move: "PLUMBING" }, { label: msg("Electricity / lights"), move: "ELECTRICAL" },
  { label: msg("Bathroom"), move: "PLUMBING" }, { label: msg("TV"), move: "MAINTENANCE" }, { label: msg("Bed / furniture"), move: "ROOM_DAMAGE" },
  { label: msg("Painting / repairs"), move: "MAINTENANCE" }, { label: msg("Door / lock"), move: "ROOM_DAMAGE" }, { label: msg("Deep cleaning"), move: "MAINTENANCE" },
];

export type RoomDecisionsProps = {
  room: { id: string; number: string; status: string; meeting: boolean };
  /** Who is in the room now (a guest, or a meeting running). */
  stay: { reservationId: string; reservationRoomId: string; guestName: string; isDayUse: boolean; ratePerNight: number; discountPerNight: number; nights: number; endAt: string; balance: number; leaveOwing: { upTo: number; reason: string } | null } | null;
  leavingToday: boolean;
  /** Bookings coming to this room (moved elsewhere before a closure). */
  upcoming: { reservationId: string; reservationRoomId: string; name: string; when: string }[];
  heldNoShow: { reservationId: string; reference: string; guestName: string; arrivalDate: string; paid: number } | null;
  closures: { id: string; from: string; until: string; type: string; reason: string | null }[];
  can: { move: boolean; close: boolean; block: boolean; release: boolean; decide: { discountMax: number } | null };
  today: string;
  /** The waiter in charge of the room's room service (guest rooms). */
  serviceWaiter?: { id: string; name: string } | null;
};

type RoomMode = "nights" | "late" | "discount" | "owing" | "close" | "reopen" | "release" | "waiter" | null;

/**
 * The room's card, for managers, the MD and the owner — their decisions in one place: move the
 * guest, close the room (maintenance or out of service, now or for dates — the guest and the
 * bookings coming are moved first), open it again, release a room a no-show is holding, and the
 * stay decisions (free nights, free late checkout, a discount). Every one is recorded with the
 * person and the reason.
 */
export function RoomDecisions({ room, stay, leavingToday, upcoming, heldNoShow, closures, can, today, serviceWaiter = null }: RoomDecisionsProps) {
  const t = useT();
  const router = useRouter();
  const [mode, setMode] = useState<RoomMode>(null);
  const [moving, setMoving] = useState<{ reservationId: string; reservationRoomId: string; guest: string; inHouse: boolean; reason: HotelMoveReason | null } | null>(null);
  const [pending, start] = useTransition();
  const inRepair = room.status === "MAINTENANCE" || room.status === "OUT_OF_SERVICE";
  const stayChoices = !!stay && !!can.decide && !stay.isDayUse && !room.meeting;
  const pick = (m: RoomMode) => setMode(mode === m ? null : m);
  const done = (r: { ok: boolean; message?: string; error?: string }, text?: string) => {
    if (r.ok) { toast.success(text ?? r.message ?? t("Done.")); setMode(null); router.refresh(); } else toast.error(r.error);
  };
  const setStatus = (to: "READY" | "DIRTY", note?: string) => start(async () => {
    const r = await changeRoomStatusAction({ roomId: room.id, status: to, note });
    const vars = { room: room.number };
    done(r, inRepair ? (to === "READY" ? t("Room {room} is open again — ready to sell.", vars) : t("Room {room} is open again — housekeeping cleans it first.", vars))
      : to === "READY" ? t("Room {room} confirmed clean and ready.", vars) : t("Room {room} sent for cleaning — housekeeping sees it.", vars));
  });
  // Housekeeping: a manager can send a free room for cleaning, or confirm a cleaned one is ready.
  const dirty = room.status === "DIRTY" || room.status === "CLEANING";
  const freeClean = !stay && (room.status === "READY" || room.status === "AVAILABLE");
  const nothing = !stay && !heldNoShow && !can.close && !closures.length;
  if (nothing) return null;

  return (
    <Shell title={t("Your decisions")} sub={t("Reception runs the rooms — these are yours, recorded with your name and reason.")}>
      {moving && (
        <ChangeRoomDialog reservationId={moving.reservationId} reservationRoomId={moving.reservationRoomId} guest={moving.guest} methods={[]} inHouse={moving.inHouse} hotelFirst reasonCode={moving.reason}
          onClose={() => { setMoving(null); router.refresh(); }} />
      )}
      <div className="flex flex-wrap gap-2">
        {stay && can.move && !room.meeting && (
          <Chip on={false} onClick={() => { setMode(null); setMoving({ reservationId: stay.reservationId, reservationRoomId: stay.reservationRoomId, guest: stay.guestName, inHouse: true, reason: null }); }}>
            <Repeat className="size-3.5" />{t("Move guest · room {room}", { room: room.number })}
          </Chip>
        )}
        {stayChoices && <Chip on={mode === "nights"} onClick={() => pick("nights")}><Gift className="size-3.5" />{t("Free nights")}</Chip>}
        {stayChoices && leavingToday && <Chip on={mode === "late"} onClick={() => pick("late")}><Clock className="size-3.5" />{t("Free late checkout")}</Chip>}
        {stay && can.decide && (stay.balance > 0 || (stayChoices && can.decide.discountMax > 0)) && <Chip on={mode === "discount"} onClick={() => pick("discount")}><BadgePercent className="size-3.5" />{t("Discount")}{stay.discountPerNight ? ` · ${t("{amount}/night", { amount: n(stay.discountPerNight) })}` : ""}</Chip>}
        {stay && can.decide && (stay.balance > 0 || stay.leaveOwing) && (
          <Chip on={mode === "owing"} onClick={() => pick("owing")}><HandCoins className="size-3.5" />{stay.leaveOwing ? t("May leave owing ✓") : t("Let leave owing")}</Chip>
        )}
        {can.close && !inRepair && <Chip on={mode === "close"} onClick={() => pick("close")}><Lock className="size-3.5" />{t("Close room")}</Chip>}
        {can.close && inRepair && <Chip on={mode === "reopen"} onClick={() => pick("reopen")}><DoorOpen className="size-3.5" />{t("Open room again")}</Chip>}
        {can.close && !room.meeting && dirty && <Chip on={false} onClick={() => setStatus("READY")}>{pending ? <Loader2 className="size-3.5 animate-spin" /> : <CheckCircle2 className="size-3.5" />}{t("Confirm clean & ready")}</Chip>}
        {can.close && !room.meeting && freeClean && <Chip on={false} onClick={() => setStatus("DIRTY", "Sent for cleaning by the manager")}><SprayCan className="size-3.5" />{t("Send for cleaning")}</Chip>}
        {heldNoShow && can.release && <Chip on={mode === "release"} onClick={() => pick("release")}><DoorOpen className="size-3.5" />{t("Release room")}</Chip>}
        {!room.meeting && <Chip on={mode === "waiter"} onClick={() => pick("waiter")}><UserRoundCheck className="size-3.5" />{serviceWaiter ? t("Room service: {name}", { name: serviceWaiter.name.replace(/\s*\(.*\)/, "").split(" ")[0] }) : t("Room service waiter")}</Chip>}
      </div>

      {closures.length > 0 && (
        <ul className="mt-3 space-y-1.5">
          {closures.map((c) => <ClosureRow key={c.id} c={c} canCancel={can.block} today={today} />)}
        </ul>
      )}
      {heldNoShow && mode !== "release" && (
        <p className="mt-3 text-xs text-muted-foreground">{t("{guest} did not arrive ({date}) — the room is held for them and can't be sold until it is released.", { guest: heldNoShow.guestName, date: t.shortDate(heldNoShow.arrivalDate) })}</p>
      )}

      {stayChoices && (mode === "nights" || mode === "late") && (
        <StayForm key={mode} mode={mode} stay={stay!} discountMax={can.decide!.discountMax} onDone={() => { setMode(null); router.refresh(); }} />
      )}
      {mode === "discount" && stay && can.decide && (
        <DiscountPanel reservationId={stay.reservationId} toPay={stay.balance} stay={stayChoices && can.decide.discountMax > 0 ? stay : null} discountMax={can.decide.discountMax} onDone={() => { setMode(null); router.refresh(); }} />
      )}
      {mode === "owing" && stay && (
        <OwingForm reservationId={stay.reservationId} guest={stay.guestName} balance={stay.balance} approved={stay.leaveOwing} onDone={() => { setMode(null); router.refresh(); }} />
      )}
      {mode === "close" && (
        <CloseForm room={room} stay={stay} upcoming={upcoming} canBlock={can.block} canMove={can.move} today={today}
          onMove={(m) => setMoving(m)} onDone={() => { setMode(null); router.refresh(); }} />
      )}
      {mode === "reopen" && (
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button type="button" disabled={pending} onClick={() => setStatus("READY")} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl bg-emerald-600 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
            {pending ? <Loader2 className="size-4 animate-spin" /> : <CheckCircle2 className="size-4" />}{t("Fixed — ready now")}
          </button>
          <button type="button" disabled={pending} onClick={() => setStatus("DIRTY")} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-xl border border-border bg-card text-sm font-semibold hover:bg-muted disabled:opacity-50">
            <SprayCan className="size-4" />{t("Fixed — clean it first")}
          </button>
        </div>
      )}
      {mode === "waiter" && <RoomWaiterForm roomId={room.id} roomNumber={room.number} current={serviceWaiter} onDone={() => { setMode(null); router.refresh(); }} />}
      {mode === "release" && heldNoShow && <ReleaseForm held={heldNoShow} roomNumber={room.number} onDone={() => { setMode(null); router.refresh(); }} />}
    </Shell>
  );
}

/**
 * Let the guest check out still owing: reception can then check them out without a manager at the
 * desk (up to what they owe now). Or withdraw the approval.
 */
function OwingForm({ reservationId, guest, balance, approved, onDone }: { reservationId: string; guest: string; balance: number; approved: { upTo: number; reason: string } | null; onDone: () => void }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const first = guest.split(" ")[0];
  if (approved) return (
    <div className="mt-3 space-y-2.5">
      <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-xs text-emerald-800 dark:text-emerald-300">
        {t("{name} may leave owing up to TZS {amount} — {reason}. Reception can check them out; the rest stays on their account (Who owes us).", { name: first, amount: n(approved.upTo), reason: approved.reason })}
      </p>
      <GoldConfirm pending={pending} onClick={() => start(async () => { const r = await withdrawLeaveOwingAction({ reservationId }); if (r.ok) { toast.success(r.message ?? t("Approval withdrawn.")); onDone(); } else toast.error(r.error); })}>
        {t("Withdraw the approval — they pay first")}
      </GoldConfirm>
    </div>
  );
  return (
    <div className="mt-3 space-y-2.5">
      <p className="text-xs text-muted-foreground">{t("{name} owes TZS {amount}. Allowing it lets reception check them out without the full payment — the balance stays on their account.", { name: first, amount: n(balance) })}</p>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Why? e.g. company pays by transfer on Friday")} className={field} />
      <GoldConfirm pending={pending} disabled={reason.trim().length < 3} onClick={() => start(async () => {
        const r = await leaveOwingAction({ reservationId, reason });
        if (r.ok) { toast.success(r.message ?? t("Approved.")); onDone(); } else toast.error(r.error);
      })}>{t("Let {name} leave owing TZS {amount}", { name: first, amount: n(balance) })}</GoldConfirm>
    </div>
  );
}

/**
 * Discount: on the WHOLE bill (room nights and everything charged to the room — TZS or %, up to what
 * is still to pay) or on the room price per night.
 */
function DiscountPanel({ reservationId, toPay, stay, discountMax, onDone }: {
  reservationId: string; toPay: number; stay: { reservationRoomId: string; ratePerNight: number; discountPerNight: number } | null; discountMax: number; onDone: () => void;
}) {
  const t = useT();
  const [kind, setKind] = useState<"bill" | "night">(toPay > 0 ? "bill" : "night");
  return (
    <div className="mt-3 space-y-2.5">
      {toPay > 0 && stay && (
        <div className="flex gap-1.5">
          <Chip on={kind === "bill"} onClick={() => setKind("bill")}>{t("Whole bill")}</Chip>
          <Chip on={kind === "night"} onClick={() => setKind("night")}>{t("Room price per night")}</Chip>
        </div>
      )}
      {kind === "bill" && toPay > 0 ? <WholeBillForm reservationId={reservationId} toPay={toPay} onDone={onDone} />
        : stay ? <StayForm mode="discount" stay={stay} discountMax={discountMax} onDone={onDone} embedded />
        : <p className="text-xs text-muted-foreground">{t("Nothing is left to pay on this bill.")}</p>}
    </div>
  );
}

function WholeBillForm({ reservationId, toPay, onDone }: { reservationId: string; toPay: number; onDone: () => void }) {
  const t = useT();
  const [byPct, setByPct] = useState(false);
  const [value, setValue] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const v = Number(value) || 0;
  const off = byPct ? Math.round((toPay * Math.min(100, v)) / 100) : v;
  const go = () => start(async () => {
    const r = await stayBillDiscountAction({ reservationId, amount: byPct ? null : v, percent: byPct ? v : null, reason });
    if (r.ok) { toast.success(t("TZS {amount} off the whole bill — TZS {left} left to pay.", { amount: n(r.data.amount), left: n(r.data.toPay) })); onDone(); } else toast.error(r.error, { duration: 9000 });
  });
  return (
    <div className="space-y-2.5">
      <p className="text-xs text-muted-foreground">{t.rich("Room nights and everything on the room — food, drinks, room service, transport. Still to pay: <b>TZS {amount}</b>.", { b: (c) => <strong className="text-foreground">{c}</strong> }, { amount: n(toPay) })}</p>
      <div className="flex flex-wrap gap-1.5">
        <Chip on={!byPct} onClick={() => setByPct(false)}>{t("TZS amount")}</Chip>
        <Chip on={byPct} onClick={() => setByPct(true)}>{t("Percent %")}</Chip>
        {byPct && [5, 10, 20].map((p) => <Chip key={p} on={v === p} onClick={() => setValue(String(p))}>{p}%</Chip>)}
      </div>
      <input inputMode="numeric" value={value} onChange={(e) => setValue(e.target.value.replace(/[^\d]/g, ""))} placeholder={byPct ? t("e.g. 10") : t("e.g. 10000")} className={field} />
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Why? e.g. long stay, service problem, loyal customer")} className={field} />
      <GoldConfirm pending={pending} disabled={off <= 0 || off > toPay || reason.trim().length < 3} onClick={go}>
        {off > toPay ? t("Only TZS {amount} is left to pay", { amount: n(toPay) }) : t("Give TZS {amount} off the whole bill · leaves TZS {left}", { amount: n(off), left: n(Math.max(0, toPay - off)) })}
      </GoldConfirm>
      <p className="text-[11px] text-muted-foreground">{t("Split fairly over the room and each department, shown on the guest's bill, recorded with your name, role and reason.")}</p>
    </div>
  );
}

/** The stay decisions' forms (shared by the room card and the booking page). */
function StayForm({ mode, stay, discountMax, onDone, embedded }: { mode: "nights" | "late" | "discount"; stay: { reservationRoomId: string; ratePerNight: number; discountPerNight: number }; discountMax: number; onDone: () => void; embedded?: boolean }) {
  const t = useT();
  const [nights, setNights] = useState(1);
  const [until, setUntil] = useState("14:00");
  const [perNight, setPerNight] = useState(String(stay.discountPerNight || ""));
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const go = () => start(async () => {
    const r = mode === "nights" ? await freeNightsAction({ reservationRoomId: stay.reservationRoomId, nights, reason })
      : mode === "late" ? await freeLateCheckoutAction({ reservationRoomId: stay.reservationRoomId, until, reason })
      : await roomDiscountAction({ reservationRoomId: stay.reservationRoomId, perNight: Number(perNight) || 0, reason });
    if (r.ok) { toast.success(r.message ?? t("Done.")); onDone(); } else toast.error(r.error);
  });
  const confirm = mode === "nights" ? t.plural(nights, "Give {n} night free (worth about TZS {amount})", "Give {n} nights free (worth about TZS {amount})", { amount: n(nights * Math.max(0, stay.ratePerNight - stay.discountPerNight)) })
    : mode === "late" ? t("Let them stay until {time}, free", { time: until }) : t("Save TZS {amount} off each night", { amount: n(Number(perNight) || 0) });
  return (
    <div className={cn("space-y-2.5", !embedded && "mt-3")}>
      {mode === "nights" && <div className="flex flex-wrap gap-1.5">{[1, 2, 3, 5, 7].map((k) => <Chip key={k} on={nights === k} onClick={() => setNights(k)}>{t.plural(k, "+{n} night", "+{n} nights")}</Chip>)}</div>}
      {mode === "late" && <div className="flex flex-wrap gap-1.5">{["13:00", "14:00", "16:00", "18:00", "20:00"].map((h) => <Chip key={h} on={until === h} onClick={() => setUntil(h)}>{h}</Chip>)}</div>}
      {mode === "discount" && (
        <label className="block text-xs text-muted-foreground">{t("Off each night (the most is TZS {max}) · now TZS {rate} a night", { max: n(discountMax), rate: n(stay.ratePerNight) })}
          <input inputMode="numeric" value={perNight} onChange={(e) => setPerNight(e.target.value.replace(/\D/g, ""))} placeholder={t("e.g. 10000")} className={cn(field, "mt-1")} />
        </label>
      )}
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Why? e.g. VIP guest, noise complaint, loyal customer")} className={field} />
      <GoldConfirm pending={pending} disabled={reason.trim().length < 3 || (mode === "discount" && (Number(perNight) || 0) > discountMax)} onClick={go}>{confirm}</GoldConfirm>
    </div>
  );
}

function GoldConfirm({ pending, disabled, onClick, children, danger }: { pending: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode; danger?: boolean }) {
  return (
    <button type="button" disabled={pending || disabled} onClick={onClick}
      className={cn("inline-flex h-10 w-full items-center justify-center gap-2 rounded-xl text-sm font-semibold transition hover:brightness-105 disabled:opacity-50",
        danger ? "bg-rose-600 text-white" : "bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-[oklch(0.2_0.03_60)]")}>
      {pending && <Loader2 className="size-4 animate-spin" />}{children}
    </button>
  );
}

/** Close the room: now (maintenance / out of service) or for dates ahead. The guest and the bookings coming are moved first. */
function CloseForm({ room, stay, upcoming, canBlock, canMove, today, onMove, onDone }: {
  room: RoomDecisionsProps["room"]; stay: RoomDecisionsProps["stay"]; upcoming: RoomDecisionsProps["upcoming"]; canBlock: boolean; canMove: boolean; today: string;
  onMove: (m: { reservationId: string; reservationRoomId: string; guest: string; inHouse: boolean; reason: HotelMoveReason | null }) => void; onDone: () => void;
}) {
  const t = useT();
  const [when, setWhen] = useState<"now" | "dates">("now");
  const [kind, setKind] = useState<"MAINTENANCE" | "OUT_OF_SERVICE">("MAINTENANCE");
  const [fault, setFault] = useState<(typeof FAULTS)[number] | null>(null);
  const [note, setNote] = useState("");
  const [from, setFrom] = useState(today);
  const [to, setTo] = useState("");
  const [pending, start] = useTransition();
  const reason = [fault?.label, note.trim()].filter(Boolean).join(" — ");
  const moveReason = fault?.move ?? "MAINTENANCE";
  const occupied = when === "now" && !!stay;
  const toMove = when === "now" ? upcoming.filter((u) => u.when === "today") : upcoming;
  const go = () => start(async () => {
    const r = when === "now"
      ? await changeRoomStatusAction({ roomId: room.id, status: kind, note: reason })
      : await planClosureAction({ roomId: room.id, from, to, type: kind, reason });
    if (!r.ok) { toast.error(r.error, { duration: 9000 }); return; }
    toast.success(when === "now"
      ? (kind === "MAINTENANCE" ? t("Room {room} closed — under maintenance.", { room: room.number }) : t("Room {room} closed — out of service.", { room: room.number }))
      : t("Room {room} closed {from} → {to}.", { room: room.number, from: t.shortDate(from), to: t.shortDate(to) }));
    if (when === "now" && "warning" in (r.data ?? {}) && (r.data as { warning?: string }).warning) toast.warning((r.data as { warning?: string }).warning!, { duration: 10000 });
    onDone();
  });
  return (
    <div className="mt-3 space-y-3 rounded-xl border border-rose-500/25 bg-rose-500/[0.04] p-3">
      <div className="flex flex-wrap gap-1.5">
        <Chip on={when === "now"} onClick={() => setWhen("now")}>{t("Close now")}</Chip>
        {canBlock && <Chip on={when === "dates"} onClick={() => setWhen("dates")}><CalendarX2 className="size-3.5" />{t("Close for dates")}</Chip>}
        <span className="mx-1 w-px self-stretch bg-border" />
        <Chip on={kind === "MAINTENANCE"} onClick={() => setKind("MAINTENANCE")}>{t("Maintenance")}</Chip>
        {canBlock && <Chip on={kind === "OUT_OF_SERVICE"} onClick={() => setKind("OUT_OF_SERVICE")}>{t("Out of service")}</Chip>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        {FAULTS.map((f) => (
          <button key={f.label} type="button" aria-pressed={fault?.label === f.label} onClick={() => setFault(fault?.label === f.label ? null : f)}
            className={cn("rounded-lg border px-2.5 py-1 text-[11px] font-medium", fault?.label === f.label ? "border-rose-600 bg-rose-600 text-white" : "border-border bg-card hover:bg-muted")}>{t(f.label)}</button>
        ))}
      </div>
      <input value={note} onChange={(e) => setNote(e.target.value)} placeholder={fault ? t("Details (optional), e.g. technician coming Friday") : t("What is wrong? e.g. AC not cooling")} className={field} />
      {when === "dates" && (
        <div className="grid grid-cols-2 gap-2">
          <label className="text-xs text-muted-foreground">{t("Closed from")}<input type="date" min={today} value={from} onChange={(e) => setFrom(e.target.value)} className={cn(field, "mt-1")} /></label>
          <label className="text-xs text-muted-foreground">{t("Open again on")}<input type="date" min={from || today} value={to} onChange={(e) => setTo(e.target.value)} className={cn(field, "mt-1")} /></label>
        </div>
      )}

      {occupied && (
        <div className="rounded-xl bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
          {room.meeting
            ? t("A meeting is on until {time} — close the room after it ends, or close it for dates.", { time: t.time(stay!.endAt) })
            : fault
              ? t.rich("<b>{guest}</b> is in the room. Move them to another room first — the room is closed in the same step ({fault}).", { b: (c) => <strong>{c}</strong> }, { guest: stay!.guestName, fault: t(fault.label) })
              : t.rich("<b>{guest}</b> is in the room. Move them to another room first — the room is closed in the same step.", { b: (c) => <strong>{c}</strong> }, { guest: stay!.guestName })}
        </div>
      )}
      {!room.meeting && toMove.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-xs font-medium">{t.plural(toMove.length, "{n} booking coming to this room — move it first:", "{n} bookings coming to this room — move them first:")}</p>
          {toMove.map((u) => (
            <div key={u.reservationRoomId} className="flex items-center justify-between gap-2 rounded-lg bg-card px-2.5 py-1.5 text-xs">
              <span className="min-w-0 truncate"><strong>{u.name}</strong> · {u.when === "today" ? t("arrives today") : u.when}</span>
              {canMove && <button type="button" onClick={() => onMove({ reservationId: u.reservationId, reservationRoomId: u.reservationRoomId, guest: u.name, inHouse: false, reason: moveReason })} className="shrink-0 rounded-lg border border-border px-2 py-1 font-semibold hover:bg-muted">{t.ctx("room", "Move")}</button>}
            </div>
          ))}
        </div>
      )}

      {occupied && !room.meeting ? (
        canMove ? (
          <GoldConfirm pending={false} disabled={!reason} onClick={() => onMove({ reservationId: stay!.reservationId, reservationRoomId: stay!.reservationRoomId, guest: stay!.guestName, inHouse: true, reason: moveReason })}>
            <Repeat className="size-4" />{t("Move {name} & close room {room}", { name: stay!.guestName.split(" ")[0], room: room.number })}
          </GoldConfirm>
        ) : <p className="text-xs text-muted-foreground">{t("Ask someone who can move guests.")}</p>
      ) : (
        <GoldConfirm danger pending={pending} disabled={!reason || occupied || (when === "dates" && (!from || !to || to <= from))} onClick={go}>
          <Lock className="size-4" />{when === "now" ? t("Close room {room} now", { room: room.number }) : from && to ? t("Close room {room} {from} → {to}", { room: room.number, from: t.shortDate(from), to: t.shortDate(to) }) : t("Close room {room}", { room: room.number })}
        </GoldConfirm>
      )}
      <p className="text-center text-[11px] text-muted-foreground">{t("Nobody can book or check into the room while it is closed. Recorded with your name, the reason and the time.")}</p>
    </div>
  );
}

function ClosureRow({ c, canCancel, today }: { c: RoomDecisionsProps["closures"][number]; canCancel: boolean; today: string }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  const running = c.from <= today;
  return (
    <li className="flex items-center justify-between gap-2 rounded-lg bg-rose-500/[0.07] px-2.5 py-1.5 text-xs">
      <span className="min-w-0 truncate"><CalendarX2 className="mr-1 inline size-3.5 text-rose-500" /><strong>{running ? t("Closed") : t("Will close")}</strong> {t.shortDate(c.from)} → {t.shortDate(c.until)} · {c.type === "OUT_OF_SERVICE" ? t("out of service") : t("maintenance")}{c.reason ? ` · ${c.reason}` : ""}</span>
      {canCancel && (
        <button type="button" disabled={pending} aria-label={t("Cancel this closure")} title={t("Cancel this closure")}
          onClick={() => start(async () => { const r = await cancelClosureAction({ blockId: c.id }); if (r.ok) { toast.success(r.message ?? t("Closure cancelled.")); router.refresh(); } else toast.error(r.error); })}
          className="grid size-7 shrink-0 place-items-center rounded-lg hover:bg-muted">{pending ? <Loader2 className="size-3.5 animate-spin" /> : <X className="size-3.5" />}</button>
      )}
    </li>
  );
}

/** The waiter in charge of this room's room service — its food & drink orders go to them. */
function RoomWaiterForm({ roomId, roomNumber, current, onDone }: { roomId: string; roomNumber: string; current: { id: string; name: string } | null; onDone: () => void }) {
  const t = useT();
  const [waiters, setWaiters] = useState<{ id: string; name: string }[] | null>(null);
  const [pending, start] = useTransition();
  const [reason, setReason] = useState("");
  // Taking the room from its waiter needs the reason (kept in the history).
  const needsReason = !!current && reason.trim().length < 3;
  useEffect(() => { waitersAction().then((r) => (r.ok ? setWaiters(r.data) : toast.error(r.error))); }, []);
  const pick = (id: string | null) => start(async () => {
    const r = await roomServiceWaiterAction({ roomId, waiterId: id, reason: reason.trim() || undefined });
    if (r.ok) { toast.success(r.data.to ? t("{name} handles room {room}'s room service.", { name: r.data.to, room: roomNumber }) : t("Room {room}: any waiter.", { room: roomNumber })); onDone(); } else toast.error(r.error);
  });
  const clean = (n: string) => n.replace(/\s*\(.*\)/, "");
  return (
    <div className="mt-3 space-y-2">
      <p className="text-xs text-muted-foreground">{current ? t("Food and drinks ordered from room {room} go to this waiter — now {name}.", { room: roomNumber, name: clean(current.name) }) : t("Food and drinks ordered from room {room} go to this waiter.", { room: roomNumber })}</p>
      {current && <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Why it moves from {name}? e.g. other section", { name: clean(current.name) })} className={field} />}
      {!waiters ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{t("Loading waiters…")}</p> : (
        <div className={cn("flex flex-wrap gap-1.5", needsReason && "pointer-events-none opacity-50")} aria-disabled={needsReason}>
          {waiters.map((w) => <Chip key={w.id} on={current?.id === w.id} onClick={() => current?.id !== w.id && pick(w.id)}>{clean(w.name)}</Chip>)}
          {current && <Chip on={false} onClick={() => pick(null)}>{t("Any waiter")}</Chip>}
          {waiters.length === 0 && <p className="text-xs text-muted-foreground">{t("No waiters set up.")}</p>}
          {pending && <Loader2 className="size-4 animate-spin" />}
        </div>
      )}
    </div>
  );
}

function ReleaseForm({ held, roomNumber, onDone }: { held: NonNullable<RoomDecisionsProps["heldNoShow"]>; roomNumber: string; onDone: () => void }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  return (
    <div className="mt-3 space-y-2.5">
      <p className="text-xs text-muted-foreground">
        {t.rich("<b>{guest}</b> ({reference}) did not arrive on {date}. Releasing lets room {room} be sold again; the booking stays a no-show.", { b: (c) => <strong className="text-foreground">{c}</strong> }, { guest: held.guestName, reference: held.reference, date: t.shortDate(held.arrivalDate), room: roomNumber })}
        {held.paid > 0 ? ` ${t("They paid TZS {amount} — the hotel's no-show rule decides whether it is kept or refunded.", { amount: n(held.paid) })}` : ` ${t("Nothing was paid.")}`}
      </p>
      <input value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Why? e.g. no answer on the phone")} className={field} />
      <GoldConfirm pending={pending} disabled={reason.trim().length < 3} onClick={() => start(async () => {
        const r = await releaseNoShowAction({ reservationId: held.reservationId, reason });
        if (r.ok) { toast.success(r.message ?? t("Room released.")); onDone(); } else toast.error(r.error);
      })}>{t("Release room {room}", { room: roomNumber })}</GoldConfirm>
    </div>
  );
}
