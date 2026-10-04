"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BedDouble, Loader2, Utensils } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { SessionOrder, SessionView, TableStay } from "@/server/services/dining-sessions";
import { changeOrderBillingAction } from "../actions";
import { chargeSessionToRoomAction, staysForBillingAction } from "./actions";

/** A staying guest to choose ("Room 305 — Nino"), for reception and managers only. */
type Pickable = { id: string; label: string };

const shortNo = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;
/** "Room 305 — Nino" → the room, and whose it is. */
const splitLabel = (label: string) => { const [room, ...name] = label.split(" — "); return { room, name: name.join(" — ") || null }; };

/** The rooms of the people at a table: "305", or "305, 306". */
export const stayRooms = (stays: TableStay[]) => [...new Set(stays.flatMap((x) => x.rooms.split(/,\s*/)).filter(Boolean))].join(", ");

/** The rooms a table's orders went on ("305", "305, 306") — null when none (or not known). */
export function roomsOnBill(orders: SessionOrder[]) {
  const rooms = orders.filter((o) => o.onRoom && o.status !== "CANCELLED").flatMap((o) => o.onRoom!.split(/,\s*/)).filter((r) => r && r !== "a room");
  return rooms.length ? [...new Set(rooms)].join(", ") : null;
}

/** "Room 305's bill" · "the room bill (305, 306)" · "the room bill". */
export const roomBill = (rooms: string | null) => (!rooms || rooms === "a room" ? "the room bill" : rooms.includes(",") ? `the room bill (${rooms})` : `Room ${rooms}'s bill`);

/** "On Room 305's bill". */
export const onRoomBill = (rooms: string | null) => `On ${roomBill(rooms)}`;

/** Every staying guest (reception and managers only) — to put a bill on another guest's room. */
function useOtherStays(on: boolean, skip: (x: Pickable) => boolean) {
  const [list, setList] = useState<Pickable[] | null>(null);
  useEffect(() => {
    if (!on || list) return;
    let live = true;
    void staysForBillingAction().then((r) => {
      if (!live) return;
      if (r.ok) setList(r.data); else { toast.error(r.error); setList([]); }
    });
    return () => { live = false; };
  }, [on, list]);
  return list?.filter((x) => !skip(x)) ?? null;
}

/**
 * BILL TO a room — the whole table at once: everything still to pay goes on the room bill of
 * someone at the table (paid when they check out; it stays restaurant income). Reception and
 * managers may choose another guest's room instead, always saying why.
 */
export function ChargeTableToRoom({ s, another, canCheck, onClose }: { s: SessionView; another: boolean; canCheck: boolean; onClose: () => void }) {
  const router = useRouter();
  const [other, setOther] = useState(canCheck && (another || !s.stays.length));
  const [stayId, setStayId] = useState<string | null>(s.stays.length === 1 ? s.stays[0].id : null);
  const [otherId, setOtherId] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const list = useOtherStays(other, (x) => s.stays.some((y) => y.id === x.id));
  const stay = s.stays.find((x) => x.id === stayId) ?? null;
  const picked = other ? list?.find((x) => x.id === otherId) ?? null : null;
  const room = other ? (picked ? splitLabel(picked.label).room : null) : stay ? `Room ${stay.rooms}` : null;
  const owner = other ? (picked ? splitLabel(picked.label).name : null) : stay?.guestName ?? null;
  const ready = other ? !!picked && reason.trim().length >= 3 : !!stay;
  const go = () => start(async () => {
    const reservationId = other ? otherId : stayId;
    if (!reservationId) return;
    const r = await chargeSessionToRoomAction({ sessionId: s.id, reservationId, reason: other ? reason.trim() : undefined });
    if (!r.ok) { toast.error(r.error, { duration: 9000 }); return; }
    toast.success(`${formatTZS(r.data.total)} on Room ${r.data.room}'s bill — ${r.data.orders} order${r.data.orders === 1 ? "" : "s"} from ${s.table}.`);
    onClose(); router.refresh();
  });
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-md">
        <DialogHeader icon={<BedDouble />} eyebrow={s.table} tone="sky">
          <DialogTitle>{other ? "Another guest's room" : room ? `Charge to ${room}?` : "Charge to which room?"}</DialogTitle>
          <DialogDescription>
            {other ? `Everything still to pay on ${s.table} goes on the room you choose — only when that guest agreed to pay it. Say why; it is kept in the history.`
              : `Everything still to pay on ${s.table} goes on the room bill — the guest pays it when they check out.`}
          </DialogDescription>
        </DialogHeader>

        {/* Several rooms at the table: pick one first */}
        {!other && s.stays.length > 1 && (
          <div className="grid gap-1.5">
            {s.stays.map((x) => (
              <button key={x.id} type="button" onClick={() => setStayId(x.id)} aria-pressed={stayId === x.id}
                className={cn("flex items-center gap-2.5 rounded-xl border px-3 py-2 text-left text-sm transition", stayId === x.id ? "border-violet-400/60 bg-violet-500/12 ring-2 ring-violet-400/25" : "border-border hover:bg-muted/50")}>
                <BedDouble className="size-4 shrink-0 text-violet-300" />
                <span className="min-w-0 flex-1 leading-tight">
                  <span className="block font-semibold">Room {x.rooms}</span>
                  <span className="text-xs text-muted-foreground">{x.guestName}{x.foodPayer ? ` · ${x.foodPayer} food` : ""}</span>
                </span>
              </button>
            ))}
          </div>
        )}

        {/* Another guest's room: choose it, and why */}
        {other && (list === null ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Loading the rooms…</p>
          : list.length === 0 ? <p className="rounded-xl border border-dashed border-border px-3 py-4 text-center text-sm text-muted-foreground">Nobody else is staying right now.</p>
          : (
            <NativeSelect value={otherId} onChange={(e) => setOtherId(e.target.value)} aria-label="The room">
              <option value="">Choose the room…</option>
              {list.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
            </NativeSelect>
          ))}
        {other && <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Why? e.g. the guest in that room pays for them" />}

        {room && (
          <div className="rounded-xl border border-violet-500/30 bg-violet-500/[0.07] px-3 py-2.5 text-sm">
            <p className="flex items-start gap-2">
              <BedDouble className="mt-0.5 size-4 shrink-0 text-violet-300" />
              <span>Customer: <b>{s.customer.name}</b> · {room} · <b className="tabular-nums">{formatTZS(s.money.due)}</b> on the room bill</span>
            </p>
            {owner && owner !== s.customer.name && <p className="mt-1 pl-6 text-xs text-muted-foreground">The room is in {owner}&apos;s name.</p>}
            {!other && stay?.foodPayer && <p className="mt-1 pl-6 text-xs text-violet-200">{stay.foodPayer} food for this room.</p>}
          </div>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <Button className="bg-violet-600 text-white hover:bg-violet-500" disabled={pending || !ready} onClick={go}>{pending ? <Loader2 className="animate-spin" /> : <BedDouble />}{room ? `Charge to ${room}` : "Charge to the room"}</Button>
          <Button variant="ghost" onClick={onClose}>Back</Button>
          {canCheck && s.stays.length > 0 && (
            <button type="button" onClick={() => setOther(!other)} className="ml-auto text-xs text-muted-foreground hover:text-foreground">
              {other ? `${s.customer.name.split(/\s+/)[0]}'s own room` : "Another guest's room…"}
            </button>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

/**
 * Change who pays one order (reception, managers, the MD) — always with the reason: off the room,
 * back to the restaurant bill (to pay there); onto the room of someone at the table; or another
 * guest's room. Nothing is charged twice — the order's history says from where to where.
 */
export function ChangeWhoPays({ o, stays, onClose }: { o: SessionOrder; stays: TableStay[]; onClose: () => void }) {
  const router = useRouter();
  const own = stays.filter((x) => x.rooms !== o.onRoom);
  const [to, setTo] = useState<string | null | undefined>(o.onRoom ? null : own.length === 1 ? own[0].id : undefined);
  const [other, setOther] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const list = useOtherStays(other, (x) => own.some((y) => y.id === x.id) || (!!o.onRoom && splitLabel(x.label).room === `Room ${o.onRoom}`));
  const picked = other ? list?.find((x) => x.id === to) ?? null : null;
  const ownPick = other ? null : own.find((x) => x.id === to) ?? null;
  const target = to === null ? "Back to the restaurant bill"
    : picked ? `Put on ${splitLabel(picked.label).room}` : ownPick ? `Put on Room ${ownPick.rooms}` : null;
  const save = () => start(async () => {
    if (to === undefined) return;
    const r = await changeOrderBillingAction({ id: o.id, to, reason: reason.trim() });
    if (!r.ok) { toast.error(r.error, { duration: 9000 }); return; }
    toast.success(r.data.to === "Restaurant" ? `${shortNo(o.number)} is back on the restaurant bill — to pay here.` : `${shortNo(o.number)} is now on ${r.data.to}'s bill.`);
    onClose(); router.refresh();
  });
  const choice = (sel: boolean) => cn("inline-flex h-8 items-center gap-1.5 rounded-lg border px-2.5 text-xs font-medium transition [&_svg]:size-3.5",
    sel ? "border-violet-400/60 bg-violet-500/15 text-violet-100" : "border-border hover:bg-muted");
  return (
    <div className="space-y-2 border-t border-violet-500/25 bg-violet-500/[0.05] p-3">
      <p className="text-[11px] font-semibold text-violet-200">Who pays {shortNo(o.number)} · {formatTZS(o.total)} — now {o.onRoom ? roomBill(o.onRoom) : "the restaurant bill"}</p>
      <div className="flex flex-wrap gap-1.5">
        {o.onRoom && <button type="button" onClick={() => { setOther(false); setTo(null); }} className={choice(!other && to === null)}><Utensils />Back to the restaurant bill</button>}
        {own.map((x) => <button key={x.id} type="button" onClick={() => { setOther(false); setTo(x.id); }} className={choice(!other && to === x.id)}><BedDouble />Put on Room {x.rooms}</button>)}
        <button type="button" onClick={() => { setOther(true); setTo(undefined); }} className={choice(other)}><BedDouble />Another room…</button>
      </div>
      {other && (list === null ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Loading the rooms…</p>
        : list.length === 0 ? <p className="text-xs text-muted-foreground">No other room is staying right now.</p>
        : (
          <NativeSelect value={to ?? ""} onChange={(e) => setTo(e.target.value || undefined)} aria-label="The room">
            <option value="">Choose the room…</option>
            {list.map((x) => <option key={x.id} value={x.id}>{x.label}</option>)}
          </NativeSelect>
        ))}
      <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder={o.onRoom ? "Why? e.g. the guest will pay at the restaurant" : "Why? e.g. the guest asked to put it on their room"} className="h-9" />
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="sm" variant="ghost" onClick={onClose}>Back</Button>
        <Button size="sm" className="bg-violet-600 text-white hover:bg-violet-500" disabled={pending || !target || reason.trim().length < 3} onClick={save}>
          {pending && <Loader2 className="animate-spin" />}<span className="truncate">{target ?? "Choose who pays"}</span>
        </Button>
      </div>
    </div>
  );
}
