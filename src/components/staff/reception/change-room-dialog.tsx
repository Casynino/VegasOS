"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRight, Loader2, Repeat, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HOTEL_MOVE_REASONS, type HotelMoveReason, type MoveSource } from "@/lib/room-change";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { changeRoomAction, roomChangeOptionsAction } from "@/app/staff/(app)/reservations/actions";
import type { PayAccount } from "@/lib/pay-account";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

type Options = { inHouse: boolean; room: string; type: string; options: { id: string; number: string; type: string; status: string; ready: boolean; nights: number; newPrice: number; difference: number; perNight: number }[] };

const chip = (on: boolean, tone: "dark" | "amber" | "green" = "dark") => cn(
  "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
  on ? (tone === "amber" ? "border-amber-500 bg-amber-500 text-black" : tone === "green" ? "border-emerald-600 bg-emerald-600 text-white" : "border-foreground bg-foreground text-background") : "border-border hover:bg-muted",
);

/**
 * CHANGE ROOM — guest asked (they pay the difference; a cheaper room follows the
 * hotel's policy) or hotel problem (free move, reason required). Only rooms free
 * for the rest of the stay are offered, each priced by the system.
 */
export function ChangeRoomDialog({ reservationId, reservationRoomId, guest, methods, inHouse, onClose, hotelFirst, reasonCode }: {
  reservationId: string; reservationRoomId: string; guest: string; methods: PayAccount[];
  /** Checked-in guest: only a move for a room problem (free). */
  inHouse: boolean; onClose: () => void;
  /** A manager moving a booking: start on "Hotel problem" (free for the guest). */
  hotelFirst?: boolean;
  /** Start with this reason picked (e.g. the room is being closed for maintenance). */
  reasonCode?: HotelMoveReason | null;
}) {
  const t = useT();
  const router = useRouter();
  const [data, setData] = useState<Options | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<MoveSource>(inHouse || hotelFirst ? "HOTEL" : "CUSTOMER");
  const [reason, setReason] = useState<HotelMoveReason | null>(reasonCode ?? null);
  const [note, setNote] = useState("");
  const [roomId, setRoomId] = useState("");
  const [accountId, setAccountId] = useState(methods[0]?.id ?? "");
  const [reference, setReference] = useState("");
  const [oldStatus, setOldStatus] = useState<"DIRTY" | "MAINTENANCE" | "READY" | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    roomChangeOptionsAction({ reservationRoomId }).then((r) => (r.ok ? setData(r.data) : setError(r.error)));
  }, [reservationRoomId]);

  const hotel = source === "HOTEL";
  const pick = data?.options.find((o) => o.id === roomId) ?? null;
  const reasonMeta = HOTEL_MOVE_REASONS.find((r) => r.code === reason);
  const status = oldStatus ?? (reasonMeta?.maintenance ? "MAINTENANCE" : "DIRTY");
  const up = !hotel && !!pick && pick.difference > 0;
  const down = !hotel && !!pick && pick.difference < 0;
  const chargeNow = up;
  const ready = !!pick && (!hotel || (!!reason && (reason !== "OTHER" || !!note.trim()))) && (!chargeNow || !!accountId);

  function go() {
    if (!pick) return;
    start(async () => {
      const res = await changeRoomAction({
        reservationId, reservationRoomId, toRoomId: pick.id, source, reasonCode: hotel ? reason : null, note: note || undefined,
        payment: chargeNow ? { accountId, reference: reference || undefined } : null,
        oldRoomStatus: data?.inHouse || hotel ? status : null,
      });
      if (res.ok) {
        toast.success(t("{guest} moved: room {from} → {to}", { guest, from: res.data.from, to: res.data.to }), {
          description: res.data.charged > 0 ? t("Extra {amount} paid.", { amount: formatTZS(res.data.charged) }) : res.data.compensation ? t("Free move — value {amount} recorded as hotel compensation.", { amount: formatTZS(res.data.compensation) }) : t("The price stays the same."),
          duration: 8000,
        });
        onClose(); router.refresh();
      } else toast.error(res.error, { duration: 9000 });
    });
  }

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-xl">
        <DialogHeader icon={<Repeat />} eyebrow={t("Reception")} tone="sky">
          <DialogTitle>{t("Change room")}{data ? ` · ${data.room}` : ""}</DialogTitle>
          <DialogDescription>{guest}{data ? ` · ${t("now in {room} ({type})", { room: data.room, type: t(data.type) })} · ${data.inHouse ? t("in the hotel — the move closes this room and opens the new one") : t("not arrived yet")}` : ""}</DialogDescription>
        </DialogHeader>
        {error ? <p className="text-sm text-destructive">{error}</p> : !data ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("Finding free rooms…")}</p> : (
          <div className="space-y-4 text-sm">
            {/* Who asked */}
            {data.inHouse ? (
              <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
                {t.rich("The guest is checked in, so they cannot change room on request — they check out and make a new booking. A move here is only for a <b>problem in the room</b>, and it is free for the guest.", { b: (c) => <strong>{c}</strong> })}
              </p>
            ) : (
            <div className="grid grid-cols-2 gap-2">
              {([["CUSTOMER", msg("Guest asked"), msg("Guest pays any difference")], ["HOTEL", msg("Hotel problem"), msg("Free for the guest")]] as const).map(([v, label, hint]) => (
                <button key={v} type="button" onClick={() => setSource(v)} aria-pressed={source === v}
                  className={cn("rounded-xl border p-2.5 text-left leading-tight", source === v ? (v === "HOTEL" ? "border-amber-500 bg-amber-500/10" : "border-foreground bg-muted") : "border-border hover:bg-muted")}>
                  <span className="block font-semibold">{t(label)}</span><span className="text-xs text-muted-foreground">{t(hint)}</span>
                </button>
              ))}
            </div>
            )}
            {hotel && (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-1.5">
                  {HOTEL_MOVE_REASONS.map((r) => <button key={r.code} type="button" onClick={() => { setReason(r.code); setOldStatus(null); }} className={chip(reason === r.code, "amber")}>{t(r.label)}</button>)}
                </div>
                <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={reason === "OTHER" ? t("Describe the problem (required)") : t("Details (optional), e.g. AC stopped working, cannot be repaired today")} />
              </div>
            )}
            {!hotel && <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder={t("Note (optional), e.g. wants a bigger room")} />}

            {/* Rooms */}
            <div>
              <p className="mb-1.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">{data.inHouse ? t("Free rooms (ready now)") : t("Free rooms for these dates")}</p>
              {data.options.length === 0 ? <p className="rounded-xl border border-dashed border-border p-3 text-muted-foreground">{data.inHouse ? t("No other room is free and ready for this stay.") : t("No other room is free for this stay.")}</p> : (
                <div className="grid gap-1.5 sm:grid-cols-2">
                  {data.options.map((o) => (
                    <button key={o.id} type="button" onClick={() => setRoomId(o.id)} aria-pressed={roomId === o.id}
                      className={cn("flex items-center justify-between gap-2 rounded-xl border px-3 py-2 text-left", roomId === o.id ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
                      <span className="leading-tight">
                        <span className="block font-semibold">{t("Room {room}", { room: o.number })}</span>
                        {/* The room's own price, so staff see it before choosing. */}
                        <span className="text-[11px] opacity-70">{t(o.type)} · {formatTZS(o.nights ? Math.round(o.newPrice / o.nights) : o.newPrice).replace("TZS ", "")}{data.inHouse || o.nights ? t("/night") : ""}</span>
                      </span>
                      <span className="text-right text-xs font-semibold tabular-nums leading-tight">
                        {hotel || o.difference <= 0 ? <span className="text-emerald-600 dark:text-emerald-400">{hotel ? t("Free") : o.difference < 0 ? t("Keeps agreed price") : t("Same price")}</span> : `+${formatTZS(o.perNight).replace("TZS ", "")}${t("/night")}`}
                        {!hotel && o.difference > 0 && <span className="block text-[10px] font-normal opacity-70">{t("+{amount} total", { amount: formatTZS(o.difference) })}</span>}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Price */}
            {pick && (
              <div className="space-y-2 rounded-xl border border-border/70 p-3">
                <p className="flex items-center gap-2 font-semibold">{data.room} <ArrowRight className="size-3.5" /> {pick.number} <span className="font-normal text-muted-foreground">· {t.plural(pick.nights, "{n} night move", "{n} nights move")}</span></p>
                <dl className="space-y-1 text-xs">
                  <div className="flex justify-between"><dt className="text-muted-foreground">{t("Guest pays now for these nights")}</dt><dd className="tabular-nums">{formatTZS(pick.newPrice - pick.difference)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">{t("Room {room} normally ({type}, discount rules applied)", { room: pick.number, type: t(pick.type) })}</dt><dd className="tabular-nums">{formatTZS(pick.newPrice)}</dd></div>
                  <div className={cn("flex justify-between border-t border-dashed border-border pt-1 text-sm font-semibold", hotel ? "text-emerald-600 dark:text-emerald-400" : up ? "text-rose-600 dark:text-rose-400" : "")}>
                    <dt>{hotel || down ? t("Guest pays extra") : up ? t("Additional payment") : t("Difference")}</dt>
                    <dd className="tabular-nums">{hotel || down ? "TZS 0" : formatTZS(Math.abs(pick.difference))}</dd>
                  </div>
                  {hotel && pick.difference > 0 && <p className="text-[11px] text-muted-foreground">{t("Recorded as hotel compensation: {amount}. The manager is told.", { amount: formatTZS(pick.difference) })}</p>}
                </dl>
                {up && (
                  <div className="space-y-2 border-t border-dashed border-border pt-2">
                    <div className="flex flex-wrap gap-1.5">{methods.map((m) => <button key={m.id} type="button" onClick={() => setAccountId(m.id)} className={chip(accountId === m.id, "green")}>{t(m.name)}</button>)}</div>
                    <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder={t("Reference (M-Pesa code, bank ref) — optional")} className="h-9" />
                  </div>
                )}
                {down && <p className="border-t border-dashed border-border pt-2 text-xs text-muted-foreground">{t("Room {room} is cheaper — the price already agreed stays the same (no refund).", { room: pick.number })}</p>}
                {(data.inHouse || (hotel && reasonMeta?.maintenance)) && (
                  <div className="space-y-1.5 border-t border-dashed border-border pt-2">
                    <p className="flex items-center gap-1.5 text-xs font-medium"><Wrench className="size-3.5" />{t("Room {room} after the move", { room: data.room })}</p>
                    <div className="flex flex-wrap gap-1.5">
                      {data.inHouse && <button type="button" onClick={() => setOldStatus("DIRTY")} className={chip(status === "DIRTY")}>{t("Needs cleaning")}</button>}
                      <button type="button" onClick={() => setOldStatus("MAINTENANCE")} className={chip(status === "MAINTENANCE", "amber")}>{t("Maintenance required")}</button>
                      <button type="button" onClick={() => setOldStatus("READY")} className={chip(status === "READY", "green")}>{t("Already clean & fine")}</button>
                    </div>
                  </div>
                )}
              </div>
            )}
            <Button className="h-11 w-full" disabled={!ready || pending} onClick={go}>
              {pending && <Loader2 className="animate-spin" />}
              {!pick ? t("Choose a room")
                : data.inHouse
                  ? t("Confirm free room move {from} → {to}", { from: data.room, to: pick.number })
                  : hotel ? t("Confirm free room move") : up ? t("Pay {amount} & change room", { amount: formatTZS(pick.difference) }) : t("Change room")}
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
