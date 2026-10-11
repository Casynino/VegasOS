"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, DoorOpen, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatTZS } from "@/lib/format";
import { Button } from "@/components/ui/button";
import { SendToPhone } from "@/components/staff/mobile-pay";
import { quickCheckInAction } from "@/app/staff/(app)/reservations/actions";
import { cancelPromptAction } from "@/app/staff/(app)/mobile-pay/actions";
import { useT } from "@/i18n/client";

/**
 * PAYMENT FIRST, CHECK-IN LAST (owner, 2026-10-11). The booking is saved and the guest is at the desk: step 1 is the
 * payment (recorded here, or confirmed on their phone), step 2 is the check-in — its own press, open only once the
 * money is in. The other way in is said out loud: the guest pays at check-out, and is checked in now.
 */
export function CheckInLast({ reservationId, reference, guestName, roomLabel, amount, phone, paid: paidAtDesk, prompt, promptError, onDone }: {
  reservationId: string; reference: string; guestName: string;
  /** "103" — or "103, 104" for a booking of several rooms. */
  roomLabel: string;
  amount: number; phone: string;
  /** Money was recorded at the desk as the booking was saved. */
  paid: boolean;
  /** The prompt sent to the guest's phone as the booking was saved (followed from the start). */
  prompt: { id: string; amount: number; phone: string } | null;
  promptError: string | null;
  onDone: (checkedIn: boolean) => void;
}) {
  const t = useT();
  const router = useRouter();
  const [paid, setPaid] = useState(paidAtDesk);
  const [live, setLive] = useState<{ id: string; status: string } | null>(prompt ? { id: prompt.id, status: "PENDING" } : null);
  const [pending, start] = useTransition();
  const first = guestName.trim().split(" ")[0];

  function checkIn(payLater = false) {
    start(async () => {
      // "Pays at check-out": nothing is left waiting on their phone (and if they had just paid, it is kept).
      if (payLater && live?.status === "PENDING") await cancelPromptAction({ id: live.id }).catch(() => null);
      // The desk already answered "same guest?" when the booking was saved.
      const res = await quickCheckInAction({ reservationId, sameGuest: true });
      if (!res.ok) { toast.error(res.error, { duration: 9000 }); return; }
      for (const w of res.data.warnings ?? []) toast.warning(w, { duration: 9000 });
      toast.success(`${t("Checked in to room {room}", { room: roomLabel })} — ${reference}`, {
        action: { label: t("Send on WhatsApp"), onClick: () => router.push(`/staff/reservations/${reservationId}?sent=welcome`) },
      });
      onDone(true);
    });
  }

  const step = (n: number, done: boolean, on: boolean) => (
    <span className={cn("grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold tabular-nums",
      done ? "bg-emerald-600 text-white" : on ? "bg-foreground text-background" : "bg-muted text-muted-foreground ring-1 ring-border")}>
      {done ? <CheckCircle2 className="size-3.5" /> : n}
    </span>
  );

  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/30 p-4 text-sm">
      <p className="font-semibold">{t("Room {room} is held for {name}", { room: roomLabel, name: first })} · <span className="font-normal text-muted-foreground">{reference}</span></p>

      {/* 1 · Payment */}
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-xs font-semibold">{step(1, paid, true)}{t("Payment")}</p>
        {paidAtDesk
          ? <p className="rounded-xl border border-emerald-500/40 bg-emerald-500/[0.07] px-3 py-2.5 font-semibold">{t("Payment recorded · {amount}", { amount: formatTZS(amount) })}</p>
          : (
            <>
              {promptError && <p className="rounded-xl bg-rose-500/10 px-3 py-2 text-xs text-rose-700 dark:text-rose-300">{t("The payment request was not sent: {error} Send it again below.", { error: promptError })}</p>}
              <SendToPhone target={{ kind: "stay", reservationId }} amount={amount} editableAmount phone={phone} who={guestName} resume={prompt} primary
                onPaid={() => setPaid(true)} onChange={setLive} />
            </>
          )}
      </div>

      {/* 2 · Check in — last */}
      <div className="space-y-2">
        <p className="flex items-center gap-2 text-xs font-semibold">{step(2, false, paid)}{t("Check in")}</p>
        <Button className="h-11 w-full" disabled={!paid || pending} onClick={() => checkIn()}>
          {pending && paid ? <Loader2 className="animate-spin" /> : <DoorOpen />}{t("Check in to room {room} now", { room: roomLabel })}
        </Button>
        {!paid && <p className="text-center text-[11px] text-muted-foreground">{t("Check-in opens as soon as the payment is confirmed.")}</p>}
      </div>

      {!paid && (
        <Button variant="outline" className="h-auto min-h-10 w-full whitespace-normal py-2" disabled={pending} onClick={() => checkIn(true)}>
          {pending ? <Loader2 className="animate-spin" /> : null}{t("The guest will pay at check-out — check in now")}
        </Button>
      )}
      <button type="button" disabled={pending} onClick={() => onDone(false)} className="block w-full text-center text-xs text-muted-foreground underline underline-offset-2 hover:text-foreground">
        {t("Close — the room stays held, check in from the room later")}
      </button>
    </div>
  );
}
