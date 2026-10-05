"use client";

import { useState, useTransition } from "react";
import { toast } from "sonner";
import { Loader2, MessageCircle } from "lucide-react";
import { GuestMessenger, type GuestMessageOption } from "@/components/staff/reception/guest-messenger";
import { qrBookingMessageAction } from "./actions";

type Loaded = {
  options: GuestMessageOption[]; link: string; guest: { name: string; phone: string | null; email: string | null };
  sent: { type: string; channel: string; at: string; by: string | null }[];
};

/**
 * "Send booking details", right on the QR booking's row: the hotel's booking message (made on the server when asked)
 * opens ready to send on WhatsApp, SMS or email from this device — the same window and log as on the booking itself.
 */
export function SendDetailsButton({ reservationId }: { reservationId: string }) {
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [opened, setOpened] = useState(0);
  const [pending, start] = useTransition();
  const open = () => start(async () => {
    const r = await qrBookingMessageAction({ reservationId }).catch(() => null);
    if (!r) { toast.error("No connection — please try again."); return; }
    if (!r.ok) { toast.error(r.error); return; }
    const d = r.data;
    setLoaded({ options: [{ type: "BOOKING_CREATED", label: "Booking details", text: d.text, subject: d.subject }], link: d.link, guest: d.guest, sent: d.sent });
    setOpened((n) => n + 1);
  });
  return (
    <>
      <button type="button" onClick={open} disabled={pending}
        className="inline-flex items-center gap-1 rounded-lg bg-[#25D366]/12 px-2.5 py-1 text-xs font-semibold text-[#128C7E] transition-colors hover:bg-[#25D366]/20 disabled:opacity-60 dark:text-[#5fe39a]">
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <MessageCircle className="size-3.5" />}Send booking details
      </button>
      {/* Only its window shows (the list of messages is on the booking itself); a new press opens it again. */}
      {loaded && (
        <div hidden>
          <GuestMessenger key={opened} reservationId={reservationId} guest={loaded.guest} options={loaded.options} link={loaded.link} sent={loaded.sent} autoOpen="BOOKING_CREATED" />
        </div>
      )}
    </>
  );
}
