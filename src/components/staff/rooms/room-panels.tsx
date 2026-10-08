"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Car, History, Loader2 } from "lucide-react";
import { formatTZS } from "@/lib/format";
import { ROOM_STATUS_META } from "@/lib/room-status";
import { RESERVATION_STATUS_META } from "@/lib/reservation-status";
import { MEETING_STATUS_LABEL, timeRange } from "@/lib/meeting";
import { cn } from "@/lib/utils";
import type { RoomStatus, ReservationStatus } from "@/generated/prisma/enums";
import { roomHistoryAction } from "@/app/staff/(app)/rooms/actions";
import { transportFormAction } from "@/app/staff/(app)/transport/actions";
import { RequestForm, type BookingOpt, type ServiceOpt } from "@/app/staff/(app)/transport/transport-forms";
import { useT } from "@/i18n/client";

type History = Extract<Awaited<ReturnType<typeof roomHistoryAction>>, { ok: true }>["data"];

/** The room's last bookings and status changes, right in its card. */
export function RoomHistoryInline({ roomId, roomNumber }: { roomId: string; roomNumber: string }) {
  const t = useT();
  const [data, setData] = useState<History | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    roomHistoryAction({ roomId }).then((r) => { if (alive) { if (r.ok) setData(r.data); else setError(r.error); } });
    return () => { alive = false; };
  }, [roomId]);
  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/30 p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold"><History className="size-4" />{t("Room {room} — history", { room: roomNumber })}</p>
      {error ? <p className="text-rose-600">{error}</p> : !data ? <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("Loading…")}</p> : (
        <>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Last bookings")}</p>
            {data.stays.length === 0 ? <p className="text-xs text-muted-foreground">{t("No bookings yet.")}</p> : (
              <ul className="divide-y divide-border/60 rounded-xl border border-border/60 bg-card">
                {data.stays.map((s) => (
                  <li key={s.id}>
                    <Link href={`/staff/reservations/${s.reservationId}`} className="flex items-center gap-3 px-3 py-2 hover:bg-muted/50">
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{s.guest}</span>
                        <span className="block text-[11px] text-muted-foreground">
                          {s.meeting ? `${t.date(s.from)} · ${timeRange(s.startAt, s.endAt)}` : s.isDayUse ? `${t.date(s.from)} · ${t("short time")}` : `${t.date(s.from)} → ${t.date(s.to)} · ${t.plural(s.nights, "{n} night", "{n} nights")}`} · <span className="font-mono">{s.reference}</span>
                        </span>
                      </span>
                      <span className="text-right text-xs">
                        <span className={cn("inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold", RESERVATION_STATUS_META[s.status as ReservationStatus].className)}>{s.meeting ? t(MEETING_STATUS_LABEL[s.status]) : t(RESERVATION_STATUS_META[s.status as ReservationStatus].label)}</span>
                        <span className="block tabular-nums text-muted-foreground">{formatTZS(s.net)}</span>
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">{t("Status changes")}</p>
            {data.statuses.length === 0 ? <p className="text-xs text-muted-foreground">{t("No changes recorded.")}</p> : (
              <ul className="space-y-1 text-xs">
                {data.statuses.map((h) => (
                  <li key={h.id} className="flex flex-wrap items-center gap-x-2">
                    <span className="text-muted-foreground tabular-nums">{t.dateTime(h.at)}</span>
                    <span>{h.from ? t(ROOM_STATUS_META[h.from as RoomStatus].label) : "—"} → <strong>{t(ROOM_STATUS_META[h.to as RoomStatus].label)}</strong></span>
                    {h.by && <span className="text-muted-foreground">· {h.by}</span>}
                    {h.note && <span className="basis-full truncate text-muted-foreground">{t(h.note)}</span>}
                  </li>
                ))}
              </ul>
            )}
          </div>
          <Link href={`/staff/rooms/${roomId}`} className="block text-center text-[11px] text-muted-foreground underline underline-offset-2">{t("Full history")}</Link>
        </>
      )}
    </div>
  );
}

/** Ask for transport for the guest in this room — the same form as the Transport page, right in the card. */
export function TransportInline({ reservationId, today, onDone }: { reservationId: string; today: string; onDone: () => void }) {
  const t = useT();
  const [data, setData] = useState<{ services: ServiceOpt[]; booking: BookingOpt } | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let alive = true;
    transportFormAction({ reservationId }).then((r) => { if (alive) { if (r.ok) setData(r.data); else setError(r.error); } });
    return () => { alive = false; };
  }, [reservationId]);
  return (
    <div className="space-y-3 rounded-2xl border border-border/70 bg-muted/30 p-4 text-sm">
      <p className="flex items-center gap-2 font-semibold"><Car className="size-4" />{t("Transport for this guest")}</p>
      {error ? <p className="text-rose-600">{error}</p> : !data ? <p className="flex items-center gap-2 text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("Loading…")}</p>
        : data.services.length === 0 ? <p className="text-muted-foreground">{t("No transport services are set up yet.")}</p>
          : <RequestForm services={data.services} bookings={[data.booking]} today={today} prefill={{ reservationId }} onDone={onDone} />}
    </div>
  );
}
