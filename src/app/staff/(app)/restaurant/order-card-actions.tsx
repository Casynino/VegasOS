"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, BedDouble, Hotel, Loader2, MessageCircle, Utensils, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { AccountSelect } from "@/components/staff/finance/account-select";
import { BroughtBySelect } from "@/components/staff/brought-by-select";
import type { PayAccount } from "@/lib/pay-account";
import { logGuestMessageAction } from "@/app/staff/(app)/guests/actions";
import { cn } from "@/lib/utils";
import { cancelOrderAction, chargeOrderToRoomAction, recordOrderPaymentAction, setOrderStatusAction } from "./actions";
import { IconAction, WhatsAppGlyph } from "./portal/icon-action";
import type { PortalStay, RoomChoice } from "./portal/types";

const waDigits = (phone: string) => { const d = phone.replace(/\D/g, ""); return d.startsWith("0") ? `255${d.slice(1)}` : d; };

/** Where a pay-later order's bill can go besides the restaurant: the customer's own rooms — and, for reception and managers, every staying room. */
export type RoomBill = { stays: PortalStay[]; rooms: RoomChoice[] | null };

/**
 * An order's actions on the board: the next step (Accept → … → Delivered / Collected),
 * record the payment of a pay-later order, charge it to the customer's room, send the
 * customer an update on WhatsApp, and cancel (with a reason).
 */
export function OrderCardActions({ id, number, total, next, nextLabel, unpaid, canCancel, cancelNote, pay, room, update, labelled }: {
  id: string; number: string; total: string; next: string | null; nextLabel: string | null;
  /** Pay-later order still to be paid (it cannot be closed before). */
  unpaid: boolean; canCancel: boolean; cancelNote: string;
  /** Record the payment (the Restaurant Counter, reception) — waiterId: the order's waiter, prefilled as "Brought by" on the Counter. */
  pay: { accounts: PayAccount[]; waiterId?: string | null } | null;
  /** The rooms a pay-later order can go on (null: not now). A waiter gets only the customer's own. */
  room: RoomBill | null;
  /** The customer's update for this step (WhatsApp from this device). */
  update: { to: string; text: string; type: string } | null;
  /** Show words next to the icons (when there is room, e.g. an order opened large). */
  labelled?: boolean;
}) {
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<"cancel" | "pay" | "room" | null>(null);
  const [reason, setReason] = useState("");
  const [account, setAccount] = useState(pay?.accounts[0]?.id ?? "");
  const [reference, setReference] = useState("");
  const [broughtBy, setBroughtBy] = useState("");
  const router = useRouter();
  const done = (msg?: string) => { if (msg) toast.success(msg); setDialog(null); router.refresh(); };

  const go = () => start(async () => {
    const res = await setOrderStatusAction({ id, status: next as never });
    if (res.ok) router.refresh(); else toast.error(res.error);
  });
  const cancel = () => start(async () => {
    const res = await cancelOrderAction({ id, reason });
    if (res.ok) done(res.message ?? "Cancelled."); else toast.error(res.error, { duration: 8000 });
  });
  // The official payment: recorded by whoever is signed in (the Restaurant Counter, reception) — on the Counter
  // it may note the waiter who brought the money.
  const record = () => start(async () => {
    const res = await recordOrderPaymentAction({ id, accountId: account, reference: reference || undefined, handedOverById: broughtBy || null });
    if (res.ok) { setReference(""); setBroughtBy(""); done("Payment recorded."); } else toast.error(res.error);
  });
  const whatsapp = () => {
    if (!update) return;
    window.open(`https://wa.me/${waDigits(update.to)}?text=${encodeURIComponent(update.text)}`, "_blank", "noopener");
    void logGuestMessageAction({ restaurantOrderId: id, type: update.type as never, channel: "WHATSAPP", to: update.to, body: update.text });
  };

  // On the board: small round icons (their names on hover). Opened large: buttons with words.
  const icons = !labelled;
  // A room only when there is one to choose: the customer's own (waiters), or any staying room (reception).
  const roomOk = unpaid && !!room && (room.stays.length > 0 || !!room.rooms?.length);
  const roomWord = room?.stays.length === 1 ? `Charge to Room ${room.stays[0].rooms}` : "Charge to a room";

  return (
    <div className={icons ? "contents" : "space-y-1.5"}>
      {icons ? (
        <div className="flex shrink-0 items-center gap-1.5">
          {update && <IconAction tip={`WhatsApp the customer (${update.to})`} onClick={whatsapp}
            className="bg-[#25D366]/12 text-[#25D366] ring-1 ring-inset ring-[#25D366]/35 hover:bg-[#25D366]/20"><WhatsAppGlyph /></IconAction>}
          {roomOk && <IconAction tip={roomWord} onClick={() => setDialog("room")}
            className="bg-violet-500/12 text-violet-300 ring-1 ring-inset ring-violet-400/35 hover:bg-violet-500/20"><BedDouble /></IconAction>}
          {canCancel && <IconAction tip={`Cancel ${number}`} onClick={() => setDialog("cancel")}
            className="bg-muted text-muted-foreground ring-1 ring-inset ring-border hover:bg-rose-500/12 hover:text-rose-300"><Ban /></IconAction>}
          {unpaid && pay && <IconAction tip={`Record payment · ${total}`} onClick={() => setDialog("pay")}
            className="bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] text-[oklch(0.2_0.03_60)] shadow-[0_8px_18px_-10px_oklch(0.7_0.12_80)] ring-1 ring-inset ring-white/30 hover:brightness-105"><Wallet /></IconAction>}
          {next && <Button size="sm" className="h-8 rounded-lg text-xs" disabled={pending} onClick={go}>{pending && <Loader2 className="animate-spin" />}{nextLabel}</Button>}
        </div>
      ) : (
      <>
      <div className="flex gap-1.5">
        {unpaid && pay && <Button size="sm" className="h-8 flex-1 rounded-lg bg-emerald-600 text-xs hover:bg-emerald-700" onClick={() => setDialog("pay")}><Wallet className="size-3.5" />Record payment</Button>}
        {next && <Button size="sm" className="h-8 flex-1 rounded-lg text-xs" disabled={pending} onClick={go}>{pending && <Loader2 className="animate-spin" />}{nextLabel}</Button>}
        {update && <Button size="sm" variant="outline" className="h-8 rounded-lg px-2.5 text-xs" onClick={whatsapp} title={`Send the customer an update on WhatsApp (${update.to})`}><MessageCircle className="size-3.5 text-[#128C7E]" />{labelled && "Update customer"}</Button>}
        {canCancel && <Button size="sm" variant="outline" className="h-8 rounded-lg px-2.5 text-xs" onClick={() => setDialog("cancel")} aria-label={`Cancel ${number}`}><Ban className="size-3.5" />{labelled && "Cancel"}</Button>}
      </div>
      {roomOk && <button type="button" onClick={() => setDialog("room")} className="flex items-center gap-1 text-[11px] font-medium text-violet-700 hover:underline dark:text-violet-300"><BedDouble className="size-3" />{roomWord}</button>}
      </>
      )}

      <Dialog open={dialog === "cancel"} onOpenChange={(o) => setDialog(o ? "cancel" : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Ban />} eyebrow="Restaurant" tone="rose"><DialogTitle>Cancel {number}?</DialogTitle><DialogDescription>{cancelNote}</DialogDescription></DialogHeader>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? e.g. Guest changed their mind" autoFocus />
          <div className="flex gap-2">
            <Button variant="destructive" disabled={pending || !reason.trim()} onClick={cancel}>{pending && <Loader2 className="animate-spin" />}Cancel the order</Button>
            <Button variant="ghost" onClick={() => setDialog(null)}>Keep it</Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "pay"} onOpenChange={(o) => setDialog(o ? "pay" : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Wallet />} eyebrow="Payments" tone="emerald"><DialogTitle>Payment for {number}</DialogTitle><DialogDescription>{total} — recorded as restaurant, bar and room-service income into the account you choose.</DialogDescription></DialogHeader>
          {pay && <AccountSelect accounts={pay.accounts} value={account} onChange={setAccount} />}
          <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Reference (mobile money / card slip) — optional" />
          {dialog === "pay" && <BroughtBySelect value={broughtBy} onChange={setBroughtBy} prefill={pay?.waiterId} />}
          <Button disabled={pending || !account} onClick={record}>{pending && <Loader2 className="animate-spin" />}Record {total}</Button>
        </DialogContent>
      </Dialog>

      <Dialog open={dialog === "room"} onOpenChange={(o) => setDialog(o ? "room" : null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<BedDouble />} eyebrow="Room bill" tone="sky"><DialogTitle>Put {number} on a room bill</DialogTitle><DialogDescription>Only after you have confirmed with the customer — it is added to their stay and paid at check-out.</DialogDescription></DialogHeader>
          {room && <BillTo id={id} total={total} stays={room.stays} rooms={room.rooms} roomOnly onDone={() => done()} />}
        </DialogContent>
      </Dialog>
    </div>
  );
}

const OTHER = "other";

/**
 * BILL TO — pay at the restaurant, or charge it to the customer's own room: "Charge to Room 305"
 * (their stay, or the stay of someone at their table). A waiter gets nothing more — no stay, no
 * room bill, and never a list of rooms. Reception and managers may also pick another staying
 * guest's room, saying why. The server checks the room again either way.
 */
export function BillTo({ id, total, stays, rooms, roomOnly, onDone, children }: {
  id: string;
  /** The amount as shown ("TZS 45,000"). */
  total: string;
  stays: PortalStay[];
  /** Every staying room — only for reception and managers (null for waiters). */
  rooms: RoomChoice[] | null;
  /** Just the room side (the room button's window): no "Pay at the restaurant" choice. */
  roomOnly?: boolean;
  onDone: () => void;
  /** What "Pay at the restaurant" shows: the usual payment. */
  children?: React.ReactNode;
}) {
  const others = rooms?.filter((r) => !stays.some((s) => s.id === r.id)) ?? [];
  // Nothing is picked for the customer — except in the room window, their own room first.
  const [to, setTo] = useState(roomOnly ? stays[0]?.id ?? (others.length ? OTHER : "") : "");
  const [other, setOther] = useState("");
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  if (!stays.length && !others.length) return <>{children}</>;
  const stay = stays.find((s) => s.id === to) ?? null;
  const picked = to === OTHER ? others.find((r) => r.id === other) ?? null : null;
  const target = stay?.id ?? picked?.id ?? "";
  const place = stay ? `Room ${stay.rooms}` : picked ? picked.label.split(" — ")[0] : "the room";
  const why = reason.trim();
  const charge = () => start(async () => {
    const res = await chargeOrderToRoomAction({ id, reservationId: target, reason: picked ? why : undefined });
    if (res.ok) { toast.success(`On ${place}'s bill — ${total}.`); setReason(""); onDone(); } else toast.error(res.error, { duration: 8000 });
  });
  const choice = (key: string, on: boolean, icon: React.ReactNode, title: string, sub: string, room: boolean) => (
    <button key={key} type="button" onClick={() => setTo(key)} aria-pressed={on}
      className={cn("flex items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition",
        !on ? "border-border/80 bg-background/40 hover:bg-muted"
          : room ? "border-violet-400/70 bg-violet-500/12 shadow-[0_0_0_1px_rgba(139,92,246,0.35)]" : "border-[oklch(0.78_0.12_80)] bg-[oklch(0.72_0.12_80/0.14)] shadow-[0_0_0_1px_oklch(0.78_0.12_80/0.4)]")}>
      <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg [&_svg]:size-4", !on ? "bg-muted text-muted-foreground" : room ? "bg-violet-500 text-white" : "bg-[oklch(0.78_0.12_80)] text-[oklch(0.2_0.03_60)]")}>{icon}</span>
      <span className="min-w-0 flex-1 leading-tight">
        <span className="block truncate text-[13px] font-semibold">{title}</span>
        <span className="block truncate text-[10.5px] text-muted-foreground">{sub}</span>
      </span>
    </button>
  );

  return (
    <div>
      <p className="mb-1.5 text-xs font-semibold text-muted-foreground">Bill to</p>
      <div className="grid grid-cols-2 gap-2">
        {!roomOnly && choice("", to === "", <Utensils />, "Pay at the restaurant", "Paid here — now or later", false)}
        {stays.map((s) => choice(s.id, to === s.id, <BedDouble />, `Charge to Room ${s.rooms}`, s.guestName, true))}
        {others.length > 0 && choice(OTHER, to === OTHER, <Hotel />, "Another guest's room", "Check the stay · say why", true)}
      </div>
      {to === "" ? children : (
        <div className="mt-3 space-y-2.5 rounded-xl bg-violet-500/[0.08] p-3 ring-1 ring-inset ring-violet-500/20">
          {to === OTHER && (
            <NativeSelect value={other} onChange={(e) => setOther(e.target.value)} aria-label="The room">
              <option value="">Choose the room…</option>
              {others.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
            </NativeSelect>
          )}
          {stay && (
            <div className="leading-snug">
              <p className="text-sm font-semibold">Customer: {stay.guestName} · Room {stay.rooms}</p>
              {stay.foodPayer && <p className="text-xs text-violet-700 dark:text-violet-200/80">{stay.foodPayer} for food on this stay</p>}
            </div>
          )}
          {picked && (
            <>
              <p className="text-xs text-muted-foreground">{picked.label} — not this customer&apos;s room. Say why it goes there.</p>
              <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? e.g. the guest in this room pays for their friend" />
            </>
          )}
          <Button className="w-full" disabled={pending || !target || (!!picked && why.length < 3)} onClick={charge}>
            {pending ? <Loader2 className="animate-spin" /> : <BedDouble />}{target ? `Charge ${total} to ${place}` : "Choose the room"}
          </Button>
          {!roomOnly && <p className="text-[11px] text-muted-foreground">Only after the customer has agreed — it goes on the stay and is paid at check-out.</p>}
        </div>
      )}
    </div>
  );
}
