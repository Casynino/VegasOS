"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Plus, X } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { CheckOutHere } from "@/components/staff/rooms/room-grid";
import { ChargeComposer, type RecentItem } from "@/components/staff/reception/room-charges";
import type { BillMenu } from "@/server/services/restaurant";
import { cn } from "@/lib/utils";
import type { PayAccount } from "@/lib/pay-account";
import type { RoomBoardRoom } from "@/server/services/rooms";
import { useT } from "@/i18n/client";

/**
 * CHECK OUT, right where the guest is listed: the exact final bill, the payment and the room freed in one press — the
 * same check-out as on the room card, in a small window. Something missing from the bill (a drink, laundry, the
 * minibar)? Add it right here first — the bill is worked out again. The full checkout screen is still one link away.
 */
export function CheckOutButton({ stay, roomNumber, nextGuest, methods, perms, menu = null, recent = [], className }: {
  stay: NonNullable<RoomBoardRoom["currentStay"]>; roomNumber: string; nextGuest: string | null; methods: PayAccount[];
  perms: { pay: boolean; order: boolean; orderPayNow?: boolean; discount: boolean; discountMax: number | null };
  /** The restaurant & bar menu and the extras added lately — to add what is missing to the bill. */
  menu?: BillMenu | null; recent?: RecentItem[]; className?: string;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  // Each thing added: the final bill is worked out again (a fresh check-out form).
  const [round, setRound] = useState(0);
  const canAdd = perms.pay || (perms.order && !!menu);
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className={cn(buttonVariants({ size: "sm" }), className)}>{t("Check out")}</button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader icon={<LogOut />} eyebrow={t("Check out")} tone="rose">
            <DialogTitle>{stay.guestName}</DialogTitle>
            <DialogDescription>{t("Room {room} · the final bill, the payment and the room freed in one press", { room: roomNumber })}</DialogDescription>
          </DialogHeader>
          {open && canAdd && (adding ? (
            <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/20 p-3">
              <div className="flex items-center justify-between gap-2">
                <p className="text-sm font-semibold">{t("Add to the bill")}</p>
                <button type="button" onClick={() => setAdding(false)} aria-label={t("Close")} className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-4" /></button>
              </div>
              <ChargeComposer reservationId={stay.reservationId} roomLabel={roomNumber} recent={recent} methods={methods} canPay={perms.pay} canType={perms.pay}
                menu={perms.order ? menu : null} menuPayNow={!!perms.orderPayNow} onPosted={() => { setAdding(false); setRound((n) => n + 1); router.refresh(); }} />
            </div>
          ) : (
            <button type="button" onClick={() => setAdding(true)} className="flex w-full items-center justify-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:border-foreground/30 hover:bg-muted/40 hover:text-foreground">
              <Plus className="size-4" />{t("Something missing? Add it to the bill")}
            </button>
          ))}
          {open && adding && <p className="text-center text-[11px] text-muted-foreground">{t("Add it to the bill (or close this) — then the final bill shows here to check out.")}</p>}
          {open && !adding && (
            <CheckOutHere key={round} stay={stay} roomNumber={roomNumber} methods={methods} canPay={perms.pay} canCharge={perms.order} canDiscount={perms.discount} discountMax={perms.discountMax}
              nextGuest={nextGuest} bare onDone={() => { setOpen(false); router.refresh(); }} />
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
