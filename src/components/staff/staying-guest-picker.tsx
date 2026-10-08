"use client";

import { useState } from "react";
import { BedDouble, Check, ChevronRight, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

/** A guest staying in the hotel now, as reception picks them: their room(s) and booking. */
export type StayingGuest = { id: string; name: string; rooms: string; reference?: string | null; phone?: string | null };

const initials = (n: string) => n.replace(/\s*\(.*\)/, "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
const firstRoom = (rooms: string) => rooms.split(",")[0]?.trim() ?? "";
const moreRooms = (rooms: string) => Math.max(0, rooms.split(",").filter((x) => x.trim()).length - 1);

/** The room as a tile: the number big, "+1" when the stay has more rooms. */
function RoomTile({ rooms, on = false }: { rooms: string; on?: boolean }) {
  const t = useT();
  const more = moreRooms(rooms);
  return (
    <span className={cn("relative grid size-11 shrink-0 place-items-center rounded-xl text-center ring-1 ring-inset transition",
      on ? "bg-linear-to-br from-violet-500 to-violet-700 text-white ring-white/15" : "bg-violet-500/12 text-violet-700 ring-violet-500/25 dark:text-violet-200")}>
      <span className="leading-none">
        <span className={cn("block text-[8px] font-semibold uppercase tracking-[0.14em]", on ? "text-white/70" : "text-violet-600/80 dark:text-violet-300/70")}>{t("Room")}</span>
        <span className="block text-[15px] font-bold tabular-nums">{firstRoom(rooms)}</span>
      </span>
      {more > 0 && <span className="absolute -right-1.5 -top-1.5 rounded-full bg-[oklch(0.75_0.12_80)] px-1 text-[9px] font-bold text-[oklch(0.2_0.03_60)]">+{more}</span>}
    </span>
  );
}

/**
 * Pick a guest STAYING in the hotel (reception's orders and table bookings are for them only): search by room
 * number, name or booking, tap one. Picked, it shows as one clear card with Change.
 */
export function StayingGuestPicker({ guests, value, onChange, ownIds, required = true, autoFocus = false, label = msg("Hotel guest") }: {
  guests: StayingGuest[];
  /** The picked guest's id ("" or null = none yet). */
  value: string | null;
  onChange: (id: string) => void;
  /** Ids to show first as "Their room" (the customer's own stays). */
  ownIds?: Set<string>;
  /** Required: the list shows at once; otherwise only once something is typed. */
  required?: boolean;
  autoFocus?: boolean;
  label?: string;
}) {
  const t = useT();
  const [q, setQ] = useState("");
  const picked = value ? guests.find((g) => g.id === value) ?? null : null;
  const needle = q.trim().toLowerCase();
  const list = guests
    .filter((g) => !needle || `${g.rooms} ${g.name} ${g.reference ?? ""}`.toLowerCase().includes(needle))
    .sort((a, b) => Number(!!ownIds?.has(b.id)) - Number(!!ownIds?.has(a.id)));

  if (picked) {
    return (
      <div className="flex items-center gap-3 rounded-2xl border border-violet-500/40 bg-linear-to-r from-violet-500/[0.12] to-transparent p-2.5 pr-3">
        <RoomTile rooms={picked.rooms} on />
        <span className="min-w-0 flex-1 leading-tight">
          <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-violet-700 dark:text-violet-300"><Check className="size-3" />{t(label)} · {t("staying now")}</span>
          <span className="mt-0.5 block truncate text-[15px] font-semibold">{picked.name}</span>
          <span className="block truncate text-[11px] text-muted-foreground">{t("Room {room}", { room: picked.rooms })}{picked.reference ? ` · ${picked.reference}` : ""}</span>
        </span>
        <button type="button" onClick={() => { onChange(""); setQ(""); }}
          className="shrink-0 rounded-full border border-border/80 px-3 py-1.5 text-xs font-semibold text-muted-foreground transition hover:border-violet-500/50 hover:text-foreground">{t("Change")}</button>
      </div>
    );
  }

  return (
    <div className="overflow-hidden rounded-2xl border border-border/80 bg-background">
      <label className="relative flex items-center gap-2 border-b border-border/60 px-3">
        <Search className="size-4 shrink-0 text-muted-foreground" />
        <span className="sr-only">{t("Find the guest's room")}</span>
        <input value={q} onChange={(e) => setQ(e.target.value)} autoFocus={autoFocus} autoComplete="off"
          placeholder={required ? t("Which room? Number, guest or booking") : t("Hotel guest? Find their room (optional)")}
          className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
        {q ? (
          <button type="button" aria-label={t("Clear")} onClick={() => setQ("")} className="grid size-7 place-items-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-3.5" /></button>
        ) : (
          <span className="flex shrink-0 items-center gap-1 rounded-full bg-violet-500/12 px-2 py-0.5 text-[10.5px] font-semibold text-violet-700 dark:text-violet-300"><BedDouble className="size-3" />{t("{n} staying", { n: guests.length })}</span>
        )}
      </label>
      {(required || needle) && (
        <ul className="max-h-64 space-y-0.5 overflow-y-auto overscroll-contain p-1.5 [scrollbar-width:thin]">
          {list.map((g) => {
            const own = !!ownIds?.has(g.id);
            return (
              <li key={g.id}>
                <button type="button" onClick={() => { onChange(g.id); setQ(""); }}
                  className="group flex w-full items-center gap-3 rounded-xl px-2 py-2 text-left transition hover:bg-violet-500/[0.08] focus-visible:bg-violet-500/[0.08] focus-visible:outline-none">
                  <RoomTile rooms={g.rooms} />
                  <span className="min-w-0 flex-1 leading-tight">
                    <span className="flex items-center gap-2">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full bg-muted text-[9px] font-bold text-muted-foreground">{initials(g.name)}</span>
                      <span className="truncate text-sm font-semibold">{g.name}</span>
                    </span>
                    <span className="mt-0.5 block truncate pl-7 text-[11px] text-muted-foreground">
                      {own ? <span className="font-semibold text-violet-700 dark:text-violet-300">{t("Their room")} · </span> : null}{t("Room {room}", { room: g.rooms })}{g.reference ? ` · ${g.reference}` : ""}
                    </span>
                  </span>
                  <ChevronRight className="size-4 shrink-0 text-muted-foreground/50 transition group-hover:translate-x-0.5 group-hover:text-violet-500" />
                </button>
              </li>
            );
          })}
          {list.length === 0 && <li className="px-3 py-4 text-center text-xs text-muted-foreground">{guests.length ? t("No guest staying matches.") : t("No guest is staying in the hotel right now.")}</li>}
        </ul>
      )}
    </div>
  );
}
