"use client";

import { useMemo } from "react";
import { QrCode } from "lucide-react";
import { qrSvg } from "@/lib/qr-svg";
import { QrPreview, type Printable } from "@/components/staff/qr/qr-print-card";
import type { RoomQrInfo } from "@/components/staff/rooms/room-grid";
import { useT } from "@/i18n/client";

/** The room's own QR card on the room page: download, print, see what guests see. */
export function RoomQrSide({ roomId, number, meeting, qr }: { roomId: string; number: string; meeting: boolean; qr: RoomQrInfo }) {
  const t = useT();
  const token = qr.tokens[roomId];
  const card = useMemo<Printable | null>(() => {
    if (!token) return null;
    const url = `${qr.origin}/r/${token}`;
    return { id: `side-${roomId}`, kind: meeting ? "meeting" : "room", title: number, url, qr: qrSvg(url) };
  }, [token, qr.origin, roomId, number, meeting]);
  if (!card) return null;
  return (
    <section className="rounded-3xl border border-border/70 bg-card p-4">
      <p className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground"><QrCode className="size-3.5" />{t("This room's QR card")}</p>
      <QrPreview card={card} hotel={qr.hotel} phone={qr.phone} printHref={`/staff/rooms/qr?print=${roomId}`} fileName={`${meeting ? "Meeting-room" : "Room"}-${number}-QR`} />
    </section>
  );
}
