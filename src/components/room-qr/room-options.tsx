"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { ArrowLeftRight, Bath, CalendarPlus, Check, ChevronRight, Clock, Loader2, MessageCircle, SprayCan, Wrench } from "lucide-react";
import { askFromStayAction } from "@/app/stay/[token]/actions";
import { askFromRoomQrAction } from "@/app/r/[token]/actions";
import { GUEST_REQUEST_WORD } from "@/lib/request-meta";
import { addDays } from "@/lib/time/business-date";
import { cn } from "@/lib/utils";
import { darkButton, Stepper } from "@/components/hotel-qr/ui";
import { dayWeek, hotelClock, nightsText, tzs } from "@/components/hotel-qr/lib";
import { ROOM_ASKS, type RoomAsk, type RoomAskKey } from "./asks";
import { BottomSheet, card, SheetHead } from "./parts";

const ICON: Record<RoomAskKey, typeof Bath> = { MOVE: ArrowLeftRight, EXTEND: CalendarPlus, LATE: Clock, CLEANING: SprayCan, TOWELS: Bath, FIX: Wrench, OTHER: MessageCircle };
const STATUS_TONE: Record<string, string> = { NEW: "text-(--vr-muted)", ASSIGNED: "text-(--vr-muted)", IN_PROGRESS: "text-(--vr-gold-ink)", COMPLETED: "text-emerald-700", CANCELLED: "text-rose-700" };
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
/** "14:30" today, "Mon 14:30" before — the hotel's clock (server and phone print the same). */
const when = (iso: string) => {
  const [t, d] = hotelClock(iso).split(" · ");
  return d === hotelClock(new Date().toISOString()).split(" · ")[1] ? t : `${d.split(" ")[0]} ${t}`;
};
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export type RoomRequests = { id: string; label: string; status: string; at: string }[];
export type RoomAskTarget = { kind: "stay" | "room"; token: string };

/**
 * "Your room" — what a staying guest can ask for, as plain rows: change the room, stay longer, a late check-out,
 * cleaning, towels, a repair, anything else. Each is a guest request to reception through the one request system (the
 * same action as before — its checks and limits unchanged), then shows under "Your requests" as Received → On it → Done.
 */
export function RoomOptions({ ask, requests, departure, today, checkoutMinutes, lateFee, className }: {
  ask: RoomAskTarget; requests: RoomRequests;
  /** The booked check-out day, and the hotel's date today (a guest still in past the booked day counts from today). */
  departure: string; today: string;
  checkoutMinutes: number; lateFee: number; className?: string;
}) {
  const [open, setOpen] = useState<RoomAsk | null>(null);
  return (
    <section id="room" aria-labelledby="room-title" className={cn("scroll-mt-4", className)}>
      <h2 id="room-title" className="font-display text-[24px] font-semibold leading-none lg:text-[28px]">Your room</h2>
      <p className="mt-1.5 text-[13px] text-(--vr-muted)">Ask here and reception takes care of it.</p>
      <div className={cn(card, "mt-3 px-4 sm:px-5")}>
        <ul className="divide-y divide-(--vr-line)">
          {ROOM_ASKS.map((a) => {
            const Icon = ICON[a.key];
            const hint = a.key === "LATE" ? `Leave after ${hhmm(checkoutMinutes)}` : a.hint;
            return (
              <li key={a.key}>
                <button type="button" onClick={() => setOpen(a)} className="group -mx-1 flex min-h-[60px] w-[calc(100%+0.5rem)] items-center gap-3.5 rounded-xl px-1 py-2.5 text-left transition hover:bg-(--vr-bg)/60">
                  <Icon className="size-[19px] shrink-0 text-(--vr-gold-ink)" strokeWidth={1.75} />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="block truncate text-[15px] font-semibold">{a.label}</span>
                    <span className="mt-0.5 block truncate text-[12.5px] text-(--vr-muted)">{hint}</span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-(--vr-muted) transition group-hover:translate-x-0.5 group-hover:text-(--vr-gold-ink) motion-reduce:group-hover:translate-x-0" />
                </button>
              </li>
            );
          })}
        </ul>
        {requests.length > 0 && (
          <div className="border-t border-(--vr-line) pb-3 pt-3.5">
            <p className="text-[12px] font-semibold text-(--vr-muted)">Your requests</p>
            <ul className="mt-1">
              {requests.map((q) => (
                <li key={q.id} className="flex items-baseline justify-between gap-3 py-1.5 text-[13.5px]">
                  <span className="min-w-0 truncate"><span className="font-medium">{q.label}</span> <span className="text-(--vr-muted)">· {when(q.at)}</span></span>
                  <span className={cn("shrink-0 text-[12.5px] font-semibold", STATUS_TONE[q.status] ?? STATUS_TONE.NEW)}>{GUEST_REQUEST_WORD[q.status] ?? "Received"}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
      <BottomSheet open={!!open} onClose={() => setOpen(null)} label={open?.label ?? "Ask reception"}>
        {open && <AskForm key={open.key} a={open} ask={ask} departure={departure} today={today} checkoutMinutes={checkoutMinutes} lateFee={lateFee} onDone={() => setOpen(null)} />}
      </BottomSheet>
    </section>
  );
}

function AskForm({ a, ask, departure, today, checkoutMinutes, lateFee, onDone }: {
  a: RoomAsk; ask: RoomAskTarget; departure: string; today: string; checkoutMinutes: number; lateFee: number; onDone: () => void;
}) {
  const router = useRouter();
  const [note, setNote] = useState("");
  const [nights, setNights] = useState(1);
  const lateTimes = [60, 120, 180, 240, 300, 420].map((m) => checkoutMinutes + m).filter((m) => m <= 22 * 60);
  const [late, setLate] = useState(lateTimes[1] ?? lateTimes[0] ?? checkoutMinutes + 60);
  const [key] = useState(newKey);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);
  const [pending, start] = useTransition();

  // The day they leave: the booked check-out day — or today, for a guest still in after it (the extra nights are
  // charged at check-out), so reception never reads a date that has passed.
  const past = departure < today;
  const outDay = past ? today : departure;
  // What reception reads: what it is first ("Late check-out: …"), then the guest's own words.
  const more = nightsText(nights).replace(/^(\d+) /, "$1 more ");
  const what =
    a.key === "EXTEND"
      ? past
        ? `${more} from ${dayWeek(today)} — check-out ${dayWeek(addDays(today, nights))} (booked until ${dayWeek(departure)})`
        : `${more} — check-out ${dayWeek(addDays(departure, nights))} instead of ${dayWeek(departure)}`
    : a.key === "LATE" ? `until ${hhmm(late)} on ${dayWeek(outDay)} (check-out is ${hhmm(checkoutMinutes)})${past ? ` — booked until ${dayWeek(departure)}` : ""}`
    : "";
  const words = note.trim();
  const head = !a.prefix ? "" : what ? `${a.prefix}: ${what}` : `${a.prefix}:`;
  const description = (!head ? words : !words ? head : `${head}${what ? " — " : " "}${words}`).slice(0, 300);
  const ready = !a.needsNote || words.length >= 2;

  const send = () => start(async () => {
    setError(null);
    const input = { token: ask.token, type: a.type, description: description || undefined, clientKey: key };
    const r = await (ask.kind === "room" ? askFromRoomQrAction(input) : askFromStayAction(input)).catch(() => ({ ok: false as const, error: "No connection — please try again." }));
    if (!r.ok) { setError(r.error); return; }
    setSent(true);
    router.refresh();
  });

  if (sent) {
    return (
      <div className="pb-1 text-center sm:pt-2" role="status">
        <span className="mx-auto grid size-12 place-items-center rounded-full bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200"><Check className="size-5" strokeWidth={2.5} /></span>
        <h2 className="mt-3 font-display text-[24px] font-semibold leading-tight">Sent to reception</h2>
        <p className="mx-auto mt-1.5 max-w-xs text-[13.5px] leading-relaxed text-(--vr-muted)">
          {a.key === "MOVE" || a.key === "EXTEND" || a.key === "LATE" ? "Reception will check and get back to you soon." : "Reception has it and will be with you soon."} You can follow it under Your requests.
        </p>
        <button type="button" onClick={onDone} className={cn(darkButton, "mt-5 h-12 w-full text-[14.5px]")}>Done</button>
      </div>
    );
  }

  return (
    <>
      <SheetHead title={a.label} text={
        a.key === "MOVE" ? "Tell us why and reception will see what is free."
        : a.key === "EXTEND" ? `${past ? `Your booking ended ${dayWeek(departure)}` : `Your check-out is ${dayWeek(departure)}`}. Reception checks the room is free and confirms.`
        : a.key === "LATE" ? <>Check-out is by {hhmm(checkoutMinutes)}{past ? " today" : <> on {dayWeek(departure)}</>}. Reception confirms the time{lateFee > 0 ? <> — late check-out is <strong className="font-semibold text-(--vr-ink)">{tzs(lateFee)}</strong></> : null}.</>
        : a.key === "FIX" ? "Tell us what is wrong and we will send someone."
        : a.key === "OTHER" ? "Ask for anything — reception will help."
        : "Reception will send someone to your room."
      } />

      {a.key === "EXTEND" && (
        <div className="mt-4 border-y border-(--vr-line)">
          <Stepper label="More nights" hint={`New check-out ${dayWeek(addDays(outDay, nights))}`} value={nights} min={1} max={14} onChange={setNights} />
        </div>
      )}
      {a.key === "LATE" && (
        <fieldset className="mt-4">
          <legend className="text-[12.5px] font-medium text-(--vr-ink)/80">Leave by</legend>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {lateTimes.map((m) => (
              <button key={m} type="button" onClick={() => setLate(m)} aria-pressed={late === m}
                className={cn("h-11 rounded-2xl text-[14.5px] font-semibold tabular-nums ring-1 transition", late === m ? "bg-(--vr-dark) text-white ring-(--vr-dark)" : "bg-(--vr-card) ring-(--vr-line) hover:ring-(--vr-gold)")}>
                {hhmm(m)}
              </button>
            ))}
          </div>
        </fieldset>
      )}

      <label className="mt-4 block">
        <span className="sr-only">{a.needsNote ? "Your message" : "Anything to add"}</span>
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={a.needsNote ? 3 : 2} maxLength={200} autoFocus={a.needsNote}
          placeholder={a.placeholder}
          className="block w-full resize-none rounded-2xl border border-(--vr-line) bg-white px-4 py-3 text-[16px] leading-snug outline-none transition placeholder:text-(--vr-muted)/70 focus:border-(--vr-gold) focus:ring-4 focus:ring-(--vr-gold)/15 sm:text-[14.5px]" />
      </label>
      {error && <p role="alert" className="mt-2.5 rounded-xl bg-rose-50 px-3 py-2 text-[13px] text-rose-800 ring-1 ring-rose-200">{error}</p>}
      <button type="button" onClick={send} disabled={pending || !ready} className={cn(darkButton, "mt-4 h-12 w-full text-[14.5px]")}>
        {pending && <Loader2 className="size-4 animate-spin" />}Send to reception
      </button>
    </>
  );
}
