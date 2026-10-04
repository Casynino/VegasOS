"use client";

import { useEffect, useState, useTransition, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, CalendarPlus, CalendarRange, Check, CheckCircle2, Clock, FileText, Loader2, Pencil, Play, ScrollText, LogIn, LogOut, MoreHorizontal, Percent, Repeat, Undo2, UserX } from "lucide-react";
import type { ActionResult } from "@/server/errors";
import { formatBusinessDate, formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button, buttonVariants } from "@/components/ui/button";
import Link from "next/link";
import { invoiceReservationAction } from "../../invoices/actions";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, type DialogTone } from "@/components/ui/dialog";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeCheckbox, NativeSelect } from "@/components/ui/native-select";
import {
  cancelAction, changeDatesAction, changeDiscountAction, confirmAction,
  noShowAction, recordPaymentAction, reversePaymentAction,
  previewExtensionAction, extendStayAction, lateCheckoutAction,
  previewDateChangeAction, lateArrivalAction, reinstateNoShowAction, releaseNoShowAction, correctPaymentAction,
  startMeetingAction, completeMeetingAction, changeMeetingAction,
} from "../actions";
import type { DateChangePreview, ExtensionPreview } from "@/server/services/reservations";
import { ChangeRoomDialog } from "@/components/staff/reception/change-room-dialog";
import { AccountSelect } from "@/components/staff/finance/account-select";
import type { PayAccount } from "@/lib/pay-account";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  function run<T>(fn: () => Promise<ActionResult<T>>, onOk?: (data: T) => void) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        if (res.message) toast.success(res.message);
        onOk?.(res.data);
        router.refresh();
      } else toast.error(res.error, { duration: 8000 });
    });
  }
  return { pending, run };
}

/** Small dialog asking for a reason / confirmation before an irreversible action. */
function ConfirmDialog({ open, onOpenChange, icon, eyebrow, tone, title, description, reasonLabel, confirmLabel, destructive, pending, onConfirm, children }: {
  open: boolean; onOpenChange: (o: boolean) => void;
  /** The header band: icon, small label above the title, colour (destructive: rose, else sky). */
  icon: ReactNode; eyebrow: string; tone?: DialogTone;
  title: string; description?: ReactNode; reasonLabel?: string;
  confirmLabel: string; destructive?: boolean; pending: boolean; onConfirm: (reason: string) => void; children?: ReactNode;
}) {
  const [reason, setReason] = useState("");
  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) setReason(""); }}>
      <DialogContent>
        <DialogHeader icon={icon} eyebrow={eyebrow} tone={tone ?? (destructive ? "rose" : "sky")}>
          <DialogTitle>{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>
        {children}
        {reasonLabel && (
          <div className="space-y-1.5">
            <Label htmlFor="reason">{reasonLabel}</Label>
            <Textarea id="reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus />
          </div>
        )}
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Back</Button>
          <Button variant={destructive ? "destructive" : "default"} disabled={pending || (!!reasonLabel && !reason.trim())} onClick={() => onConfirm(reason)}>
            {pending && <Loader2 className="animate-spin" />}{confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function ReservationActions(p: {
  reservationId: string; status: string; balance: number;
  /** Money paid so far (a cancelled paid booking: keep it, or owe a refund). */
  paid?: number; keepByDefault?: boolean;
  /** Pending booking and this user may confirm it without payment (manager). */
  canConfirmUnpaid?: boolean;
  /** May note that the guest is coming late (reservations.edit). */
  canLate?: boolean;
  canConfirm: boolean; canCheckIn: boolean; canCheckOut: boolean; canCancel: boolean; canNoShow: boolean;
  canInvoice?: boolean; invoiceId?: string | null;
  /** A meeting room booking: Start / Complete meeting instead of check-in / check-out. */
  meeting?: boolean; canOverrideBalance?: boolean;
}) {
  const { pending, run } = useRun();
  const [dialog, setDialog] = useState<null | "cancel" | "noshow">(null);
  const [keep, setKeep] = useState(p.keepByDefault ?? true);
  const [releaseNow, setReleaseNow] = useState(false);
  const [lateOpen, setLateOpen] = useState(false);
  const close = () => setDialog(null);

  return (
    <div className="flex flex-wrap gap-2">
      {p.meeting ? (
        <MeetingButtons reservationId={p.reservationId} status={p.status} balance={p.balance} canStart={p.canCheckIn} canComplete={p.canCheckOut} canOverrideBalance={p.canOverrideBalance} />
      ) : (
        <>
          {p.canCheckIn && <Link href={`/staff/check-in?id=${p.reservationId}#workspace`} className={buttonVariants()}><LogIn /> Check in</Link>}
          {p.canCheckOut && <Link href={`/staff/check-out?id=${p.reservationId}#workspace`} className={buttonVariants()}><LogOut /> Check out</Link>}
        </>
      )}
      {p.status === "CHECKED_IN" && !p.meeting && <Link href={`/staff/reservations/${p.reservationId}/welcome`} className={buttonVariants({ variant: "outline" })}><ScrollText /> Welcome card</Link>}
      {p.invoiceId ? (
        <Link href={`/staff/invoices/${p.invoiceId}`} className={buttonVariants({ variant: "outline" })}><FileText /> Invoice</Link>
      ) : p.canInvoice && (
        <Button variant="outline" disabled={pending} onClick={() => run(() => invoiceReservationAction({ reservationId: p.reservationId }))}><FileText /> Create invoice</Button>
      )}
      {p.canConfirm && p.status === "INQUIRY" && <Button variant="outline" disabled={pending} onClick={() => run(() => confirmAction({ reservationId: p.reservationId }))}><Check /> {p.canConfirmUnpaid ? "Confirm" : "Hold the room"}</Button>}
      {p.canConfirm && p.status === "RESERVED" && p.canConfirmUnpaid && <Button variant="outline" disabled={pending} onClick={() => run(() => confirmAction({ reservationId: p.reservationId }))}><Check /> Confirm without payment</Button>}
      {p.canLate && !p.meeting && ["RESERVED", "CONFIRMED"].includes(p.status) && <Button variant="outline" onClick={() => setLateOpen(true)}><Clock /> Coming late</Button>}
      {p.canNoShow && <Button variant="outline" disabled={pending} onClick={() => setDialog("noshow")}><UserX /> No-show</Button>}
      {p.canCancel && <Button variant="destructive" disabled={pending} onClick={() => setDialog("cancel")}><Ban /> Cancel</Button>}

      <ConfirmDialog open={dialog === "cancel"} onOpenChange={(o) => !o && close()} icon={<Ban />} eyebrow="Booking" title="Cancel this booking?"
        description="The rooms become available again. The booking stays in history." reasonLabel="Reason (required)"
        confirmLabel="Cancel booking" destructive pending={pending}
        onConfirm={(reason) => run(() => cancelAction({ reservationId: p.reservationId, reason, keepPayment: (p.paid ?? 0) > 0 ? keep : null }), close)}>
        {(p.paid ?? 0) > 0 && (
          <fieldset className="space-y-1.5 rounded-xl border border-border/70 p-3 text-sm">
            <legend className="px-1 text-xs font-semibold">The guest has paid {(p.paid ?? 0).toLocaleString("en-US")} TZS</legend>
            <label className="flex items-center gap-2"><input type="radio" checked={keep} onChange={() => setKeep(true)} />Keep the payment (non-refundable) — counted as income</label>
            <label className="flex items-center gap-2"><input type="radio" checked={!keep} onChange={() => setKeep(false)} />Refund due — give it back as a separate refund</label>
            <p className="text-[11px] text-muted-foreground">The payment always stays on record.</p>
          </fieldset>
        )}
      </ConfirmDialog>
      <ConfirmDialog open={dialog === "noshow"} onOpenChange={(o) => !o && close()} icon={<UserX />} eyebrow="Booking" title="Mark as no-show?"
        description={(p.paid ?? 0) > 0 ? "The guest did not arrive and did not tell us they are coming late. The booking stays on record as NO SHOW; the payment stays in the ledger." : "The guest did not arrive. Nothing was paid, so the room is released straight away."}
        confirmLabel="Mark no-show" destructive pending={pending}
        onConfirm={() => run(() => noShowAction({ reservationId: p.reservationId, release: releaseNow }), close)}>
        {(p.paid ?? 0) > 0 && (
          <label className="flex items-start gap-2 rounded-xl border border-border/70 p-3 text-sm">
            <input type="checkbox" className="mt-1" checked={releaseNow} onChange={(e) => setReleaseNow(e.target.checked)} />
            <span>Also <strong>release the room</strong> now so it can be sold again. {p.keepByDefault ?? true ? "The payment is kept (non-refundable)." : "The payment is shown as a refund due."}<span className="block text-xs text-muted-foreground">Leave unticked to hold the room in case the guest still comes.</span></span>
          </label>
        )}
      </ConfirmDialog>
      {lateOpen && <LateArrivalDialog reservationId={p.reservationId} onClose={() => setLateOpen(false)} />}
    </div>
  );
}

export function RoomRowActions({ reservationId, room, canEdit, canDiscount, move }: {
  reservationId: string;
  room: { id: string; number: string; status: string; isDayUse: boolean; meeting?: boolean; arrivalDate: string; departureDate: string; discountPerNight: number };
  canEdit: boolean; canDiscount: boolean;
  move: { guest: string; methods: PayAccount[] };
}) {
  const [dialog, setDialog] = useState<null | "move" | "dates" | "discount" | "extend" | "late">(null);
  const active = ["RESERVED", "CONFIRMED", "CHECKED_IN"].includes(room.status);
  const open = ["INQUIRY", "RESERVED", "CONFIRMED", "CHECKED_IN"].includes(room.status);
  if (!(canEdit && active) && !(canDiscount && open)) return null;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Actions for room ${room.number}`} />}><MoreHorizontal /></DropdownMenuTrigger>
        <DropdownMenuContent align="end">
          {canEdit && active && !room.isDayUse && <DropdownMenuItem onClick={() => setDialog("extend")}><CalendarPlus /> Extend stay</DropdownMenuItem>}
          {canEdit && room.status === "CHECKED_IN" && !room.isDayUse && <DropdownMenuItem onClick={() => setDialog("late")}><Clock /> Late checkout</DropdownMenuItem>}
          {canEdit && active && !room.meeting && <DropdownMenuItem onClick={() => setDialog("move")}><Repeat /> {room.status === "CHECKED_IN" ? "Room problem — move guest" : "Change room"}</DropdownMenuItem>}
          {canEdit && active && !room.isDayUse && <DropdownMenuItem onClick={() => setDialog("dates")}><CalendarRange /> Change dates</DropdownMenuItem>}
          {canDiscount && open && <DropdownMenuItem onClick={() => setDialog("discount")}><Percent /> Change discount</DropdownMenuItem>}
        </DropdownMenuContent>
      </DropdownMenu>
      {dialog === "move" && <ChangeRoomDialog reservationId={reservationId} reservationRoomId={room.id} guest={move.guest} methods={move.methods} inHouse={room.status === "CHECKED_IN"} onClose={() => setDialog(null)} />}
      {dialog === "dates" && <DatesDialog reservationId={reservationId} room={room} methods={move.methods} onClose={() => setDialog(null)} />}
      {dialog === "discount" && <DiscountDialog reservationId={reservationId} room={room} onClose={() => setDialog(null)} />}
      {dialog === "extend" && <ExtendDialog reservationId={reservationId} room={room} onClose={() => setDialog(null)} />}
      {dialog === "late" && <LateCheckoutDialog reservationId={reservationId} room={room} onClose={() => setDialog(null)} />}
    </>
  );
}

function DatesDialog({ reservationId, room, methods, onClose }: { reservationId: string; room: { id: string; number: string; status: string; arrivalDate: string; departureDate: string }; methods: PayAccount[]; onClose: () => void }) {
  const [accountId, setAccountId] = useState(methods[0]?.id ?? "");
  const [payRef, setPayRef] = useState("");
  const { pending, run } = useRun();
  const [arrival, setArrival] = useState(room.arrivalDate);
  const [departure, setDeparture] = useState(room.departureDate);
  const [roomId, setRoomId] = useState<string | null>(null);
  const [reason, setReason] = useState("Customer requested date change");
  const [result, setResult] = useState<{ key: string; preview: DateChangePreview | null; error: string | null } | null>(null);
  const [checking, startCheck] = useTransition();
  const inHouse = room.status === "CHECKED_IN";
  const changed = arrival !== room.arrivalDate || departure !== room.departureDate;
  // Check availability and the price for the new dates as soon as they change.
  useEffect(() => {
    if (!changed || departure <= arrival) return;
    const key = `${arrival}|${departure}|${roomId}`;
    const t = setTimeout(() => startCheck(async () => {
      const res = await previewDateChangeAction({ reservationRoomId: room.id, arrivalDate: arrival, departureDate: departure, roomId });
      setResult(res.ok ? { key, preview: res.data, error: null } : { key, preview: null, error: res.error });
    }), 250);
    return () => clearTimeout(t);
  }, [arrival, departure, roomId, changed, room.id]);
  // Only show the answer for the dates currently chosen.
  const current = changed && departure > arrival && result?.key === `${arrival}|${departure}|${roomId}` ? result : null;
  const preview = current?.preview ?? null;
  const error = current?.error ?? null;
  const target = roomId ? preview?.alternatives.find((a) => a.id === roomId) : null;
  const due = preview?.money.dueNow ?? 0;
  const canSave = !!preview && (preview.sameRoomFree || !!target) && !!reason.trim() && (due === 0 || !!accountId);
  const fmt = (d: string) => formatBusinessDate(d);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
        <DialogHeader icon={<CalendarRange />} eyebrow={`Room ${room.number}`} tone="sky"><DialogTitle>{inHouse ? "Extend or shorten stay" : "Change dates"}</DialogTitle>
          <DialogDescription>The system checks the room and works out the price. Payments already made stay on the booking.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1.5"><Label htmlFor="d-in">Check-in</Label><Input id="d-in" type="date" value={arrival} disabled={inHouse} onChange={(e) => { setArrival(e.target.value); setRoomId(null); }} /></div>
          <div className="space-y-1.5"><Label htmlFor="d-out">Check-out</Label><Input id="d-out" type="date" min={arrival} value={departure} onChange={(e) => { setDeparture(e.target.value); setRoomId(null); }} /></div>
        </div>
        {checking && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />Checking rooms…</p>}
        {error && <p className="text-sm text-destructive">{error}</p>}
        {preview && !checking && (
          <div className="space-y-3 text-sm">
            {preview.sameRoomFree && !roomId ? (
              <p className="rounded-xl bg-emerald-500/10 px-3 py-2 text-emerald-700 dark:text-emerald-300">Room {preview.room} is free for {fmt(arrival)} → {fmt(departure)}.</p>
            ) : !preview.sameRoomFree && !roomId ? (
              <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-rose-700 dark:text-rose-300">Room {preview.room} is not available for these dates{preview.alternatives.length ? " — choose a free room:" : ", and no other room is free."}</p>
            ) : null}
            {!inHouse && preview.alternatives.length > 0 && (!preview.sameRoomFree || roomId) && (
              <div className="flex flex-wrap gap-1.5">
                {preview.sameRoomFree && <button type="button" onClick={() => setRoomId(null)} className="rounded-lg border border-border px-2.5 py-1.5 text-xs hover:bg-muted">Keep room {preview.room}</button>}
                {preview.alternatives.map((a) => (
                  <button key={a.id} type="button" onClick={() => setRoomId(a.id)} aria-pressed={roomId === a.id}
                    className={cn("rounded-lg border px-2.5 py-1.5 text-left text-xs leading-tight", roomId === a.id ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
                    <span className="block font-semibold">Room {a.number}</span><span className="opacity-70">{a.type} · {formatTZS(a.net)}</span>
                  </button>
                ))}
              </div>
            )}
            {!inHouse && preview.sameRoomFree && !roomId && preview.alternatives.length > 0 && (
              <button type="button" className="text-xs text-muted-foreground underline" onClick={() => setRoomId(preview.alternatives[0].id)}>Move to another room instead</button>
            )}
            {(preview.sameRoomFree || target) && (
              <div className="space-y-2 rounded-xl border border-border/70 p-3">
                {/* Night by night: every night is priced by its own date's rules. */}
                <div className="grid grid-cols-2 gap-3 text-[11px]">
                  {([["Now", preview.currentNights], ["New dates", preview.newNights]] as const).map(([label, list]) => (
                    <div key={label}>
                      <p className="mb-1 font-semibold uppercase tracking-wider text-muted-foreground">{label}</p>
                      <ul className="space-y-0.5">
                        {list.map((n) => (
                          <li key={n.date} className="flex justify-between gap-2">
                            <span>{fmt(n.date)}{n.note && <span className="block text-[10px] text-muted-foreground">{n.note}</span>}</span>
                            <span className="text-right tabular-nums">{n.discount ? <span className="block text-[10px] text-muted-foreground line-through">{n.base.toLocaleString("en-US")}</span> : null}{n.net.toLocaleString("en-US")}</span>
                          </li>
                        ))}
                      </ul>
                    </div>
                  ))}
                </div>
                <dl className="space-y-1 border-t border-dashed border-border pt-2">
                  <div className="flex justify-between"><dt className="text-muted-foreground">Booking total now</dt><dd className="tabular-nums">{formatTZS(preview.current.total)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">New calculated total{target ? ` · room ${target.number}` : ""}</dt><dd className="font-semibold tabular-nums">{formatTZS(preview.proposed.total)}</dd></div>
                  <div className="flex justify-between"><dt className="text-muted-foreground">Already paid (stays on the booking)</dt><dd className="tabular-nums">{formatTZS(preview.current.paid)}</dd></div>
                </dl>
                {preview.money.dueNow > 0 ? (
                  <div className="space-y-2 rounded-lg bg-rose-500/10 p-2.5">
                    <p className="flex justify-between font-semibold text-rose-700 dark:text-rose-300"><span>Additional payment</span><span className="tabular-nums">{formatTZS(preview.money.dueNow)}</span></p>
                    <div className="flex flex-wrap gap-1.5">
                      {methods.map((m) => (
                        <button key={m.id} type="button" onClick={() => setAccountId(m.id)} aria-pressed={accountId === m.id}
                          className={cn("rounded-full border px-3 py-1 text-xs font-medium", accountId === m.id ? "border-emerald-600 bg-emerald-600 text-white" : "border-border bg-card hover:bg-muted")}>{m.name}</button>
                      ))}
                    </div>
                    <Input value={payRef} onChange={(e) => setPayRef(e.target.value)} placeholder="Reference (optional)" className="h-8 bg-card text-xs" />
                    {methods.length === 0 && <p className="text-xs text-rose-700">Someone who can receive payments must do this change.</p>}
                  </div>
                ) : preview.money.excess > 0 ? (
                  <p className="rounded-lg bg-amber-500/10 p-2.5 text-xs text-amber-800 dark:text-amber-300">
                    The new dates are worth {formatTZS(preview.money.excess)} less than what was paid.{" "}
                    {preview.money.policy === "NO_REFUND" ? "Hotel policy: the price stays as paid (no refund)." : "Hotel policy: it stays as a credit on the booking — a refund, if approved, is a separate payment."}
                  </p>
                ) : preview.money.additional > 0 ? (
                  <p className="rounded-lg bg-muted/60 p-2.5 text-xs">The new dates cost {formatTZS(preview.money.additional)} more — added to what the guest owes.</p>
                ) : (
                  <p className="rounded-lg bg-emerald-500/10 p-2.5 text-xs font-medium text-emerald-700 dark:text-emerald-300">No additional payment required.</p>
                )}
              </div>
            )}
            <div className="space-y-1.5"><Label htmlFor="d-why">Reason</Label><Input id="d-why" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
          </div>
        )}
        <DialogFooter>
          <Button disabled={pending || !canSave} onClick={() => run(() => changeDatesAction({ reservationId, reservationRoomId: room.id, arrivalDate: arrival, departureDate: departure, roomId, reason, payment: due > 0 ? { accountId, reference: payRef || undefined } : null }), onClose)}>
            {pending && <Loader2 className="animate-spin" />}{due > 0 ? `Receive ${formatTZS(due)} & confirm date change` : target ? `Move to room ${target.number} & change dates` : "Confirm date change"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DiscountDialog({ reservationId, room, onClose }: { reservationId: string; room: { id: string; number: string; discountPerNight: number }; onClose: () => void }) {
  const { pending, run } = useRun();
  const [amount, setAmount] = useState(String(room.discountPerNight));
  const [reason, setReason] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader icon={<Percent />} eyebrow="Booking" tone="sky"><DialogTitle>Discount for room {room.number}</DialogTitle>
          <DialogDescription>Per room, per night. Every change is recorded with your name and reason.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="disc">Discount per night (TZS)</Label><Input id="disc" type="number" min={0} step={1000} value={amount} onChange={(e) => setAmount(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="disc-reason">Reason (required)</Label><Input id="disc-reason" value={reason} onChange={(e) => setReason(e.target.value)} /></div>
        </div>
        <DialogFooter>
          <Button disabled={pending || !reason.trim()} onClick={() => run(() => changeDiscountAction({ reservationId, reservationRoomId: room.id, discountPerNight: Number(amount), reason }), onClose)}>
            {pending && <Loader2 className="animate-spin" />}Save discount
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function PaymentPanel({ reservationId, balance, paid, methods, canRefund }: {
  reservationId: string; balance: number; paid: number; methods: PayAccount[]; canRefund: boolean;
}) {
  const router = useRouter();
  const [refund, setRefund] = useState(false);
  if (balance <= 0 && !(canRefund && paid > 0)) return null;
  return (
    <ActionForm action={recordPaymentAction} resetOnSuccess onSuccess={() => { setRefund(false); router.refresh(); }} className="mt-3 space-y-2 border-t pt-3">
      {({ pending, fieldErrors: e }) => (
        <>
          <input type="hidden" name="reservationId" value={reservationId} />
          <input type="hidden" name="kind" value={refund ? "REFUND" : "PAYMENT"} />
          <p className="font-medium">{refund ? "Issue refund" : "Record payment"}</p>
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <Input name="amount" type="number" min={1} step={1000} key={`${balance}-${refund}`} defaultValue={refund ? "" : balance > 0 ? balance : ""} aria-label="Amount" placeholder="Amount" />
              <FieldError message={e?.amount} />
            </div>
            <AccountSelect name="accountId" accounts={methods} />
          </div>
          <Input name="reference" placeholder="Reference (M-Pesa code, receipt…)" />
          {canRefund && paid > 0 && <NativeCheckbox checked={refund} onChange={(ev) => setRefund(ev.target.checked)} label="This is a refund to the guest" />}
          <Button type="submit" className="w-full" variant={refund ? "destructive" : "default"} disabled={pending}>
            {pending && <Loader2 className="animate-spin" />}{refund ? "Record refund" : "Record payment"}
          </Button>
        </>
      )}
    </ActionForm>
  );
}

export function ReversePaymentButton({ reservationId, paymentId }: { reservationId: string; paymentId: string }) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button size="icon-xs" variant="ghost" aria-label="Reverse payment" onClick={() => setOpen(true)}><Undo2 /></Button>
      <ConfirmDialog open={open} onOpenChange={setOpen} icon={<Undo2 />} eyebrow="Payments" title="Reverse this payment?" description="The payment stays on record, marked as reversed."
        reasonLabel="Reason (required)" confirmLabel="Reverse" destructive pending={pending}
        onConfirm={(reason) => run(() => reversePaymentAction({ reservationId, paymentId, reason }), () => setOpen(false))} />
    </>
  );
}

function ExtendDialog({ reservationId, room, onClose }: { reservationId: string; room: { id: string; number: string; departureDate: string }; onClose: () => void }) {
  const { pending, run } = useRun();
  const [date, setDate] = useState(() => { const d = new Date(`${room.departureDate}T00:00:00Z`); d.setUTCDate(d.getUTCDate() + 1); return d.toISOString().slice(0, 10); });
  const [preview, setPreview] = useState<ExtensionPreview | null>(null);
  const [checking, startCheck] = useTransition();
  const [moveTo, setMoveTo] = useState("");
  useEffect(() => {
    if (date <= room.departureDate) return;
    startCheck(async () => {
      const r = await previewExtensionAction({ reservationRoomId: room.id, newDeparture: date });
      if (r.ok) { setPreview(r.data); setMoveTo(""); } else { setPreview(null); toast.error(r.error); }
    });
  }, [date, room.id, room.departureDate]);
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader icon={<CalendarPlus />} eyebrow="Booking" tone="sky"><DialogTitle>Extend stay — room {room.number}</DialogTitle>
          <DialogDescription>Current checkout: {room.departureDate}. Rate and discount stay as booked.</DialogDescription></DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1.5"><Label htmlFor="ext">New checkout date</Label>
            <Input id="ext" type="date" min={room.departureDate} value={date} onChange={(e) => setDate(e.target.value)} /></div>
          {checking && <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" /> Checking availability…</p>}
          {preview && !checking && (
            <div className="space-y-2 rounded-xl border p-3 text-sm">
              <div className="flex justify-between"><span>{preview.extraNights} extra night(s) × {formatTZS(preview.netPerNight)}</span><strong className="tabular-nums">{formatTZS(preview.extraAmount)}</strong></div>
              {preview.currentRoomAvailable ? (
                <p className="text-green-700">Room {preview.room} is free for these nights.</p>
              ) : (
                <div className="space-y-2">
                  <p className="text-destructive">Room {preview.room} is not available for the requested extension.</p>
                  {preview.alternatives.length ? (
                    <NativeSelect value={moveTo} onChange={(e) => setMoveTo(e.target.value)} aria-label="Move to room">
                      <option value="">Move the guest to…</option>
                      {preview.alternatives.map((a) => <option key={a.id} value={a.id}>{a.number} — {a.type}</option>)}
                    </NativeSelect>
                  ) : <p>No other rooms are free for the whole period.</p>}
                </div>
              )}
            </div>
          )}
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={onClose}>Cancel extension</Button>
          <Button disabled={pending || !preview || (!preview.currentRoomAvailable && !moveTo)}
            onClick={() => run(() => extendStayAction({ reservationId, reservationRoomId: room.id, newDeparture: date, moveToRoomId: moveTo || null }), onClose)}>
            {pending && <Loader2 className="animate-spin" />}{preview && !preview.currentRoomAvailable ? "Move & extend" : "Extend stay"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function LateCheckoutDialog({ reservationId, room, onClose }: { reservationId: string; room: { id: string; number: string }; onClose: () => void }) {
  const { pending, run } = useRun();
  const [until, setUntil] = useState("14:00");
  const [fee, setFee] = useState("");
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent>
        <DialogHeader icon={<Clock />} eyebrow="Booking" tone="sky"><DialogTitle>Late checkout — room {room.number}</DialogTitle>
          <DialogDescription>Leave the fee empty to use the hotel&apos;s configured late-checkout fee. Your name is recorded as approver.</DialogDescription></DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          <div className="space-y-1.5"><Label htmlFor="lu">Leave by</Label><Input id="lu" type="time" value={until} onChange={(e) => setUntil(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="lf">Fee (TZS)</Label><Input id="lf" type="number" min={0} step={1000} value={fee} onChange={(e) => setFee(e.target.value)} placeholder="default" /></div>
          <div className="space-y-1.5 sm:col-span-2"><Label htmlFor="ln">Notes</Label><Input id="ln" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. evening flight" /></div>
        </div>
        <DialogFooter><Button disabled={pending} onClick={() => run(() => lateCheckoutAction({ reservationId, reservationRoomId: room.id, until, fee: fee === "" ? null : Number(fee), note }), onClose)}>
          {pending && <Loader2 className="animate-spin" />}Approve late checkout</Button></DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** "I am coming late": keeps the room reserved past the no-show cut-off. */
function LateArrivalDialog({ reservationId, onClose }: { reservationId: string; onClose: () => void }) {
  const { pending, run } = useRun();
  const [eta, setEta] = useState("21:00");
  const [note, setNote] = useState("");
  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader icon={<Clock />} eyebrow="Booking" tone="sky"><DialogTitle>Guest is coming late</DialogTitle>
          <DialogDescription>The booking stays active and the room stays reserved — it will not become a no-show at the cut-off.</DialogDescription></DialogHeader>
        <div className="grid grid-cols-[8rem_1fr] gap-3">
          <div className="space-y-1.5"><Label htmlFor="la-eta">Arrives around</Label><Input id="la-eta" type="time" value={eta} onChange={(e) => setEta(e.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="la-note">What they said (optional)</Label><Input id="la-note" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. flight delayed, arriving at midnight" /></div>
        </div>
        <DialogFooter>
          <Button disabled={pending} onClick={() => run(() => lateArrivalAction({ reservationId, eta, note }), onClose)}>{pending && <Loader2 className="animate-spin" />}Keep the room</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** No-show that still holds its room: the guest called / arrived → reinstate; or a manager releases the room. */
export function NoShowPanel({ reservationId, released, releasedAt, canRelease, paid, keepPolicy }: {
  reservationId: string; released: boolean; releasedAt: string | null; canRelease: boolean; paid: number; keepPolicy: boolean;
}) {
  const { pending, run } = useRun();
  const [note, setNote] = useState("");
  const [asking, setAsking] = useState<null | "reinstate" | "release">(null);
  if (released) {
    return (
      <div className="border-t border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-800 sm:px-6 dark:text-rose-300">
        <strong>No-show · room released</strong>{releasedAt ? ` on ${releasedAt}` : ""}. The room may already belong to another guest. If this guest arrives now, a manager decides — check which rooms are free and make a new booking. {paid > 0 && (keepPolicy ? "The payment was kept (non-refundable)." : "The payment is shown as a refund due.")}
      </div>
    );
  }
  return (
    <div className="space-y-2 border-t border-rose-500/30 bg-rose-500/10 px-4 py-3 text-sm text-rose-800 sm:px-6 dark:text-rose-300">
      <p><strong>No-show — action required.</strong> The guest did not arrive by the cut-off. The room is still held for them.</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="outline" className="bg-card" onClick={() => setAsking("reinstate")}><Undo2 /> Guest confirmed — coming late / arrived</Button>
        {canRelease && <Button size="sm" variant="destructive" onClick={() => setAsking("release")}><Ban /> Release room</Button>}
      </div>
      <Dialog open={!!asking} onOpenChange={(o) => !o && setAsking(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={asking === "release" ? <Ban /> : <Undo2 />} eyebrow="No-show" tone={asking === "release" ? "rose" : "sky"}>
            <DialogTitle>{asking === "reinstate" ? "Keep the booking — late arrival" : "Release the room?"}</DialogTitle>
            <DialogDescription>{asking === "reinstate" ? "The booking becomes active again and you can check the guest in when they come." : `The room can be sold again. The booking stays as NO SHOW.${paid > 0 ? (keepPolicy ? " The payment is kept (non-refundable)." : " The payment becomes a refund due.") : ""}`}</DialogDescription>
          </DialogHeader>
          <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder={asking === "reinstate" ? "What did the guest say? e.g. arriving at midnight" : "Reason (optional)"} />
          <DialogFooter>
            <Button variant={asking === "release" ? "destructive" : "default"} disabled={pending || (asking === "reinstate" && !note.trim())}
              onClick={() => run(() => (asking === "reinstate" ? reinstateNoShowAction({ reservationId, note }) : releaseNoShowAction({ reservationId, reason: note })), () => { setAsking(null); setNote(""); })}>
              {pending && <Loader2 className="animate-spin" />}{asking === "reinstate" ? "Keep the booking" : "Release room"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/** Correct which account a payment went into (e.g. NMB → CRDB) or its reference. The amount is locked. */
export function CorrectPaymentButton({ reservationId, payment, methods, canReference }: {
  reservationId: string; payment: { id: string; amount: number; accountId: string; method: string; reference: string | null }; methods: PayAccount[];
  /** Manager: may also correct the reference. */
  canReference?: boolean;
}) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [accountId, setAccountId] = useState(payment.accountId);
  const [reference, setReference] = useState(payment.reference ?? "");
  const changed = accountId !== payment.accountId || reference.trim() !== (payment.reference ?? "");
  return (
    <>
      <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setOpen(true)}><Repeat className="size-3.5" />Correct account</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Repeat />} eyebrow="Payments" tone="emerald"><DialogTitle>Where did this payment go?</DialogTitle>
            <DialogDescription>Amount <strong>{formatTZS(payment.amount)}</strong> — it cannot change here. Recorded into <strong>{payment.method}</strong>.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="flex flex-wrap gap-1.5">
              {methods.map((m) => (
                <button key={m.id} type="button" onClick={() => setAccountId(m.id)} aria-pressed={accountId === m.id}
                  className={cn("rounded-full border px-3 py-1 text-xs font-medium", accountId === m.id ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>{m.name}</button>
              ))}
            </div>
            {canReference
              ? <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Reference (bank ref, M-Pesa code)" />
              : payment.reference && <p className="text-xs text-muted-foreground">Reference {payment.reference} (only a manager can change it)</p>}
            {accountId !== payment.accountId && <p className="text-xs text-muted-foreground">{payment.method} → {methods.find((m) => m.id === accountId)?.name} · {formatTZS(payment.amount)} · recorded with your name.</p>}
          </div>
          <DialogFooter>
            <Button disabled={pending || !changed} onClick={() => run(() => correctPaymentAction({ reservationId, paymentId: payment.id, accountId, reference }), () => setOpen(false))}>
              {pending && <Loader2 className="animate-spin" />}Save correction
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/**
 * Meeting room booking: Start meeting (→ In use, actual start + who) and Complete meeting
 * (actual end + who; the room is available again). The bill must be paid first — a
 * manager may complete with a balance, giving the reason.
 */
export function MeetingButtons({ reservationId, status, balance, canStart, canComplete, canOverrideBalance, size }: {
  reservationId: string; status: string; balance: number; canStart: boolean; canComplete: boolean; canOverrideBalance?: boolean; size?: "sm";
}) {
  const { pending, run } = useRun();
  const [owing, setOwing] = useState(false);
  if (canStart && (status === "RESERVED" || status === "CONFIRMED")) {
    return (
      <Button size={size} disabled={pending} onClick={() => run(() => startMeetingAction({ reservationId }))}>
        {pending ? <Loader2 className="animate-spin" /> : <Play />} Start meeting
      </Button>
    );
  }
  if (canComplete && status === "CHECKED_IN") {
    return (
      <>
        <Button size={size} disabled={pending} onClick={() => (balance > 0 && canOverrideBalance ? setOwing(true) : run(() => completeMeetingAction({ reservationId })))}>
          {pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />} Complete meeting
        </Button>
        <ConfirmDialog open={owing} onOpenChange={setOwing} icon={<CheckCircle2 />} eyebrow="Meeting" title="Complete with money still owed?"
          description={`The customer still owes ${formatTZS(balance)}. Receive the payment first, or give the reason for completing with a balance.`}
          reasonLabel="Reason (required)" confirmLabel="Complete meeting" pending={pending}
          onConfirm={(reason) => run(() => completeMeetingAction({ reservationId, allowBalance: true, overrideReason: reason }), () => setOwing(false))} />
      </>
    );
  }
  return null;
}

/** Change a meeting: date, start, end (re-checked for clashes), people, company, requirements, notes. */
export function EditMeetingButton(p: {
  reservationId: string; date: string; start: string; end: string; attendees: number; capacity: number; started: boolean;
  companyName: string | null; specialRequests: string | null; internalNotes: string | null;
}) {
  const { pending, run } = useRun();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ date: p.date, startTime: p.start, endTime: p.end, attendees: String(p.attendees), companyName: p.companyName ?? "", specialRequests: p.specialRequests ?? "", internalNotes: p.internalNotes ?? "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}><Pencil /> Edit meeting</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader icon={<Pencil />} eyebrow="Meeting" tone="sky">
            <DialogTitle>Change the meeting</DialogTitle>
            <DialogDescription>A new date or time is checked against other bookings first. The price stays as booked.</DialogDescription>
          </DialogHeader>
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="space-y-1.5"><Label htmlFor="em-date">Date</Label><Input id="em-date" type="date" value={f.date} onChange={set("date")} disabled={p.started} /></div>
            <div className="space-y-1.5"><Label htmlFor="em-start">Starts</Label><Input id="em-start" type="time" value={f.startTime} onChange={set("startTime")} disabled={p.started} /></div>
            <div className="space-y-1.5"><Label htmlFor="em-end">Ends</Label><Input id="em-end" type="time" value={f.endTime} onChange={set("endTime")} /></div>
          </div>
          <div className="grid gap-3 sm:grid-cols-[8rem_1fr]">
            <div className="space-y-1.5"><Label htmlFor="em-people">People</Label><Input id="em-people" type="number" min={1} max={p.capacity} value={f.attendees} onChange={set("attendees")} /></div>
            <div className="space-y-1.5"><Label htmlFor="em-company">Company</Label><Input id="em-company" value={f.companyName} onChange={set("companyName")} /></div>
          </div>
          <div className="space-y-1.5"><Label htmlFor="em-req">Special requirements</Label><Textarea id="em-req" rows={2} value={f.specialRequests} onChange={set("specialRequests")} /></div>
          <div className="space-y-1.5"><Label htmlFor="em-notes">Staff notes</Label><Textarea id="em-notes" rows={2} value={f.internalNotes} onChange={set("internalNotes")} /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Back</Button>
            <Button disabled={pending} onClick={() => run(() => changeMeetingAction({ reservationId: p.reservationId, ...f, attendees: Number(f.attendees) }), () => setOpen(false))}>
              {pending && <Loader2 className="animate-spin" />}Save changes
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
