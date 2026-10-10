"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CalendarClock, Loader2, Minus, Plus, Store } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { KnownCustomerNote, useKnownCustomer } from "@/components/staff/known-customer";
import { CustomerFinder } from "@/components/staff/customer-finder";
import { StayingGuestPicker } from "@/components/staff/staying-guest-picker";
import { createReservationAction, updateReservationAction } from "./actions";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

export type TableOption = { id: string; name: string; area: string | null; number: number | null };
export type ReservationDraft = { id: string; name: string; phone: string; date: string; time: string; guests: number; notes: string | null; locationId: string; table: string };

const AREA: Record<string, string> = { INSIDE: msg("Inside"), OUTSIDE: msg("Outside") };
const TIMES = Array.from({ length: 30 }, (_, i) => { const m = 9 * 60 + i * 30; return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`; }); // 09:00 → 23:30

/**
 * Reserve a table (or change a reservation): who (name + phone — found again by phone), when,
 * how many, which table and a note. A change of table is a separate "Move" (kept in history).
 */
/** A guest staying in the hotel now (reception books tables for them only). */
export type HotelGuest = { id: string; name: string; phone: string | null; rooms: string };

export function ReservationDialog({ open, onClose, tables, today, edit, table, hotelGuests = null }: {
  open: boolean; onClose: () => void; tables: TableOption[]; today: string;
  /** Editing this reservation. */
  edit?: ReservationDraft | null;
  /** New reservation for this table. */
  table?: string | null;
  /** Reception: only these staying guests can be booked for (anyone else books with the restaurant). */
  hotelGuests?: HotelGuest[] | null;
}) {
  return (
    <Dialog open={open} onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[92svh] gap-0 overflow-y-auto p-0 sm:max-w-lg">
        {open && <Form key={edit?.id ?? table ?? "new"} onClose={onClose} tables={tables} today={today} edit={edit ?? null} table={table ?? null} hotelGuests={hotelGuests} />}
      </DialogContent>
    </Dialog>
  );
}

function Form({ onClose, tables, today, edit, table, hotelGuests }: { onClose: () => void; tables: TableOption[]; today: string; edit: ReservationDraft | null; table: string | null; hotelGuests: HotelGuest[] | null }) {
  const router = useRouter();
  const t = useT();
  const [name, setName] = useState(edit?.name ?? "");
  const [phone, setPhone] = useState(edit?.phone ?? "");
  const [chosen, setChosen] = useState<{ id: string; name: string } | null>(null);
  // The number finds the customer: a known one's name fills itself in.
  const autoName = useRef("");
  const known = useKnownCustomer(edit ? "" : phone, (k) => { if (!name.trim() || name === autoName.current) { autoName.current = k.name; setName(k.name); } });
  const [date, setDate] = useState(edit?.date ?? today);
  const [time, setTime] = useState(edit?.time ?? "19:00");
  const [guests, setGuests] = useState(edit?.guests ?? 2);
  const [notes, setNotes] = useState(edit?.notes ?? "");
  // New: one table or several (a party). Editing: the table stays (it is moved on its own).
  const [picked, setPicked] = useState<string[]>(edit ? [edit.locationId] : table ? [table] : []);
  const toggle = (id: string) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length >= 8 ? p : [...p, id]));
  const [error, setError] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const areas = [...new Set(tables.map((x) => x.area ?? ""))];
  // Reception picks the staying guest (a new booking); the guest's own phone, or one typed in when none is on file.
  const hotelOnly = !!hotelGuests && !edit;
  const hotelGuest = hotelOnly && chosen ? hotelGuests!.find((g) => g.id === chosen.id) ?? null : null;
  const ready = name.trim().length >= 2 && phone.trim().length >= 9 && !!date && !!time && (edit || picked.length > 0) && (!hotelOnly || !!hotelGuest);

  const save = () => start(async () => {
    setError(null);
    const fields = { name, phone, date, time, guestCount: guests, notes: notes.trim() || undefined };
    const res = edit ? await updateReservationAction({ ...fields, id: edit.id }) : await createReservationAction({ ...fields, locationId: picked[0], locationIds: picked, guestId: chosen && name.trim() === chosen.name ? chosen.id : null });
    if (!res.ok) { setError(res.error); return; }
    toast.success(edit ? t("Reservation saved.") : res.data && "tables" in res.data && res.data.tables > 1 ? t("{n} tables reserved for {name}.", { n: res.data.tables, name: name.trim() }) : t("Table reserved — {reference}", { reference: res.data && "reference" in res.data ? res.data.reference : "" }).trim());
    onClose();
    router.refresh();
  });

  return (
    <>
      {/* The content has no padding (p-0): the band starts at the edge without the usual pull-out. */}
      <DialogHeader icon={<CalendarClock />} eyebrow={edit ? t(edit.table) : t("Restaurant")} tone="violet" className="mx-0 mt-0">
        <DialogTitle>{edit ? t("Change the reservation") : t("Reserve a table")}</DialogTitle>
        <DialogDescription>{t("The table shows as Reserved around the time — seat them when they come.")}</DialogDescription>
      </DialogHeader>

      <div className="space-y-4 p-5">
        {hotelOnly ? (
          <div className="space-y-2">
            <StayingGuestPicker guests={hotelGuests!} value={chosen?.id ?? null} autoFocus
              onChange={(id) => { const g = hotelGuests!.find((x) => x.id === id); setChosen(g ? { id: g.id, name: g.name } : null); setName(g?.name ?? ""); setPhone(g?.phone ?? ""); }} />
            <p className="text-[11px] text-muted-foreground">{t("Reception reserves tables for guests staying in the hotel — anyone else books with the restaurant.")}</p>
            {hotelGuest && !hotelGuest.phone && (
              <label className="block text-sm font-medium">{t("Their phone")}<Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" maxLength={30} placeholder="0712 345 678" className="mt-1 tabular-nums" /></label>
            )}
          </div>
        ) : hotelGuests && edit ? (
          // Reception changing a booking: it stays this staying guest's.
          <p className="rounded-xl border border-violet-500/30 bg-violet-500/[0.06] px-3 py-2 text-sm"><span className="font-semibold">{edit.name}</span><span className="text-muted-foreground"> · {edit.phone}</span></p>
        ) : (
        <>
        {!edit && <CustomerFinder onPick={(c) => { setChosen({ id: c.id, name: c.name }); if (c.phone) setPhone(c.phone); setName(c.name); }} />}
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="block text-sm font-medium">{t("Phone")}<Input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" inputMode="tel" maxLength={30} placeholder="0712 345 678" className="mt-1 tabular-nums" autoFocus={!edit} /></label>
          <label className="block text-sm font-medium">{t("Name")}<Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder={t("Customer's name")} className="mt-1" /></label>
          {!edit && <KnownCustomerNote phone={phone} lookup={known} className="sm:col-span-2" />}
        </div>
        </>
        )}
        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm font-medium">{t("Date")}<Input type="date" value={date} min={edit ? undefined : today} onChange={(e) => setDate(e.target.value)} className="mt-1" /></label>
          <label className="block text-sm font-medium">{t("Time")}
            <select value={time} onChange={(e) => setTime(e.target.value)} className="mt-1 h-9 w-full rounded-md border border-input bg-transparent px-2 text-sm tabular-nums">
              {[...new Set([time, ...TIMES])].sort().map((x) => <option key={x} value={x}>{x}</option>)}
            </select>
          </label>
        </div>
        <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
          <span className="text-sm font-medium">{t("People")}</span>
          <span className="flex items-center gap-2">
            <Button size="icon" variant="outline" className="size-8" disabled={guests <= 1} onClick={() => setGuests(guests - 1)} aria-label={t("Fewer")}><Minus /></Button>
            <span className="w-7 text-center text-lg font-semibold tabular-nums">{guests}</span>
            <Button size="icon" variant="outline" className="size-8" disabled={guests >= 60} onClick={() => setGuests(guests + 1)} aria-label={t("More")}><Plus /></Button>
          </span>
        </div>
        {!edit && (
          <div className="space-y-2">
            <p className="flex items-baseline justify-between text-sm font-medium">{t("Tables")}<span className="text-xs font-normal text-muted-foreground">{picked.length > 1 ? t("{n} tables — one party", { n: picked.length }) : t("Tap one, or several for a big group")}</span></p>
            {areas.map((a) => (
              <div key={a} className="flex items-center gap-2">
                <span className="w-16 shrink-0 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground">{AREA[a] ? t(AREA[a]) : t("Other")}</span>
                <div className="grid flex-1 grid-cols-6 gap-1.5">
                  {tables.filter((x) => (x.area ?? "") === a).map((x) => (
                    <button key={x.id} type="button" onClick={() => toggle(x.id)} aria-pressed={picked.includes(x.id)}
                      className={cn("h-9 rounded-lg border text-sm font-semibold transition", picked.includes(x.id) ? "border-violet-400 bg-violet-500/20 text-violet-100 ring-2 ring-violet-400/30" : "border-border hover:bg-muted")}>
                      {x.number ?? <Store className="mx-auto size-4" />}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        <label className="block text-sm font-medium">{t("Note")} <span className="font-normal text-muted-foreground">· {t("optional")}</span>
          <Input value={notes} onChange={(e) => setNotes(e.target.value)} maxLength={300} placeholder={t("Birthday, high chair, by the window…")} className="mt-1" />
        </label>
        {error && <p role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-200">{error}</p>}
        <div className="flex gap-2">
          <Button className="h-10 flex-1" disabled={pending || !ready} onClick={save}>{pending ? <Loader2 className="animate-spin" /> : <CalendarClock />}{edit ? t("Save changes") : picked.length > 1 ? t("Reserve {n} tables", { n: picked.length }) : t("Reserve the table")}</Button>
          <Button variant="ghost" className="h-10" onClick={onClose}>{t("Cancel")}</Button>
        </div>
      </div>
    </>
  );
}
