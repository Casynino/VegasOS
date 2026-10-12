"use client";

import { useEffect, useSyncExternalStore } from "react";
import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { MessageSendPanel, useGuestMessages } from "./guest-messenger";
import type { CheckoutThanks } from "@/server/services/guest-comms";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

/**
 * AFTER A CHECK-OUT DONE IN PLACE (the room's window, the guest list): a clear window opens by itself — the guest is
 * out, what was received, the room to clean — with the thank-you message ready to send, the way the welcome comes
 * after a check-in (owner, 2026-10-12: not a small notification with a button). The window that did the check-out
 * closes as it finishes, so this one lives once in the staff shell and is opened from anywhere with
 * `showCheckoutThanks`.
 */
export type CheckoutDone = {
  reservationId: string; name: string;
  /** What happened, in the reader's words: "TZS 160,000 received. Room 406 now needs cleaning." */
  summary: string;
  thanks: CheckoutThanks;
};

let current: (CheckoutDone & { key: number }) | null = null;
let hosts = 0;
let opened = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());
const subscribe = (l: () => void) => { listeners.add(l); return () => { listeners.delete(l); }; };

/** Open the window. False when this page has none (the caller then says it the short way). */
export function showCheckoutThanks(done: CheckoutDone) {
  if (!hosts) return false;
  current = { ...done, key: ++opened };
  emit();
  return true;
}

export function CheckoutThanksHost() {
  const done = useSyncExternalStore(subscribe, () => current, () => null);
  useEffect(() => { hosts++; return () => { hosts--; }; }, []);
  return done ? <CheckoutThanksWindow key={done.key} done={done} onClose={() => { current = null; emit(); }} /> : null;
}

function CheckoutThanksWindow({ done, onClose }: { done: CheckoutDone; onClose: () => void }) {
  const t = useT();
  const { thanks } = done;
  const written = useGuestMessages(done.reservationId, { THANK_YOU: { text: thanks.text, subject: thanks.subject } }, thanks.locale);
  const note = `/staff/reservations/${done.reservationId}/thank-you`;
  const quiet = "font-medium text-muted-foreground underline-offset-4 hover:text-foreground hover:underline";
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader icon={<CheckCircle2 />} eyebrow={t("Check-out complete")} tone="emerald">
          <DialogTitle>{done.name}</DialogTitle>
          <DialogDescription>{done.summary}</DialogDescription>
        </DialogHeader>
        <div className="-mb-1 space-y-0.5">
          <p className="text-sm font-semibold">{t("Thank-you message for {name}", { name: thanks.guest.name.split(/\s+/)[0] })}</p>
          <p className="text-xs text-muted-foreground">
            {thanks.auto
              ? t("The hotel sends this message to the guest on WhatsApp by itself. You can also send it from here.")
              : t("Opens WhatsApp, SMS or email with the message ready — it is sent when you press send there.")}
          </p>
        </div>
        <MessageSendPanel reservationId={done.reservationId} type="THANK_YOU" label={msg("Check-out & thank you")} guest={thanks.guest} written={written}
          rows={9} boxClass="max-h-[38svh] overflow-y-auto" />
        <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 border-t border-border/60 pt-3">
          <div className="flex flex-wrap gap-x-4 gap-y-1 text-xs">
            {thanks.note && <Link href={note} target="_blank" className={quiet}>{t("View thank-you note")}</Link>}
            {thanks.note && <Link href={`${note}?print=1`} target="_blank" className={quiet}>{t("Print")}</Link>}
          </div>
          <Button variant="outline" onClick={onClose}>{t("Done")}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
