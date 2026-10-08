"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, CalendarCheck2, CircleX, Eye, Loader2, MessageSquarePlus, Plus, RotateCcw, UserRoundCheck, UtensilsCrossed, X } from "lucide-react";
import type { BillMenu } from "@/server/services/restaurant";
import { MenuOrder, picksPayload, picksTotal, type MenuPick } from "@/components/staff/reception/menu-order";
import type { ActionResult } from "@/server/errors";
import { formatTZS } from "@/lib/format";
import { MANUAL_REQUEST_SOURCES } from "@/lib/booking-request-meta";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { useT } from "@/i18n/client";
import {
  assignRequestAction, convertRequestAction, logContactAction, logManualRequestAction, relinkCustomerAction, setRequestStatusAction,
} from "./actions";

function useRun() {
  const router = useRouter();
  const [pending, start] = useTransition();
  function run(fn: () => Promise<ActionResult<unknown>>, onOk?: () => void) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        if (res.message) toast.success(res.message);
        onOk?.();
        router.refresh();
      } else toast.error(res.error, { duration: 8000 });
    });
  }
  return { pending, run };
}

/** Log a request received on WhatsApp / phone so every lead sits in the same queue. */
export function LogManualRequestDialog({ types, today }: { types: { slug: string; name: string }[]; today: string }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button />}><Plus /> {t("Log WhatsApp / phone request")}</DialogTrigger>
      <DialogContent className="sm:max-w-xl">
        <DialogHeader icon={<MessageSquarePlus />} eyebrow={t("Booking request")} tone="sky">
          <DialogTitle>{t("Log a booking request")}</DialogTitle>
          <DialogDescription>{t("For customers who asked by WhatsApp, phone or Instagram. Availability and price are checked now; no room is held.")}</DialogDescription>
        </DialogHeader>
        <ActionForm
          action={logManualRequestAction}
          onSuccess={(d) => { setOpen(false); const id = (d as { id?: string } | null)?.id; if (id) router.push(`/staff/booking-requests/${id}`); else router.refresh(); }}
          className="grid gap-3 sm:grid-cols-2"
        >
          {({ pending, fieldErrors: e }) => (
            <>
              <div className="space-y-1"><Label htmlFor="m-src">{t("Received via")}</Label>
                <NativeSelect id="m-src" name="sourceCode" defaultValue="WHATSAPP">{MANUAL_REQUEST_SOURCES.map(([v, l]) => <option key={v} value={v}>{t(l)}</option>)}</NativeSelect></div>
              <div className="space-y-1"><Label htmlFor="m-name">{t("Customer name")}</Label><Input id="m-name" name="fullName" /><FieldError message={e?.fullName} /></div>
              <div className="space-y-1"><Label htmlFor="m-phone">{t("Phone / WhatsApp")}</Label><Input id="m-phone" name="phone" type="tel" placeholder="+255…" /><FieldError message={e?.phone} /></div>
              <div className="space-y-1"><Label htmlFor="m-email">{t("Email (optional)")}</Label><Input id="m-email" name="email" type="email" /><FieldError message={e?.email} /></div>
              <div className="space-y-1"><Label htmlFor="m-in">{t("Check-in")}</Label><input id="m-in" name="checkIn" type="date" min={today} defaultValue={today} className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" /><FieldError message={e?.checkIn} /></div>
              <div className="space-y-1"><Label htmlFor="m-out">{t("Check-out")}</Label><input id="m-out" name="checkOut" type="date" min={today} className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" /><FieldError message={e?.checkOut} /></div>
              <div className="space-y-1"><Label htmlFor="m-type">{t("Room type")}</Label>
                <NativeSelect id="m-type" name="typeSlug" defaultValue={types[0]?.slug}>{types.map((x) => <option key={x.slug} value={x.slug}>{t(x.name)}</option>)}</NativeSelect></div>
              <div className="grid grid-cols-3 gap-2">
                <div className="space-y-1"><Label htmlFor="m-rooms">{t("Rooms")}</Label><Input id="m-rooms" name="rooms" type="number" min={1} max={10} defaultValue={1} /></div>
                <div className="space-y-1"><Label htmlFor="m-ad">{t("Adults")}</Label><Input id="m-ad" name="adults" type="number" min={1} defaultValue={2} /></div>
                <div className="space-y-1"><Label htmlFor="m-ch">{t("Children")}</Label><Input id="m-ch" name="children" type="number" min={0} defaultValue={0} /></div>
              </div>
              <div className="space-y-1"><Label htmlFor="m-eta">{t("Expected arrival")}</Label><input id="m-eta" name="expectedArrivalTime" type="time" className="h-9 w-full rounded-md border bg-transparent px-3 text-sm" /><FieldError message={e?.expectedArrivalTime} /></div>
              <div className="space-y-1 sm:col-span-2"><Label htmlFor="m-sr">{t("Request / notes")}</Label><Textarea id="m-sr" name="specialRequests" rows={2} /></div>
              <DialogFooter className="sm:col-span-2"><Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{t("Log request")}</Button></DialogFooter>
            </>
          )}
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

/** Status buttons valid for the current state. Reject/cancel require a reason. */
export function StatusControls({ id, status }: { id: string; status: string }) {
  const t = useT();
  const { pending, run } = useRun();
  const [reasonFor, setReasonFor] = useState<null | "REJECTED" | "CANCELLED">(null);
  const [reason, setReason] = useState("");
  const open = ["NEW", "REVIEWING", "CONTACTED", "CONFIRMED"].includes(status);
  const set = (to: string, note?: string, done?: () => void) =>
    run(() => setRequestStatusAction({ id, to: to as Parameters<typeof setRequestStatusAction>[0]["to"], note }), done);

  return (
    <div className="flex flex-wrap gap-2">
      {status === "NEW" && <Button variant="outline" size="sm" disabled={pending} onClick={() => set("REVIEWING")}><Eye /> {t("Mark reviewing")}</Button>}
      {open && status !== "CONFIRMED" && (
        <Button variant="outline" size="sm" disabled={pending} onClick={() => set("CONFIRMED")} title={t("Customer agreed — create the reservation next")}>
          <UserRoundCheck /> {t("Customer agreed")}
        </Button>
      )}
      {open && <Button variant="outline" size="sm" disabled={pending} onClick={() => setReasonFor("REJECTED")}><Ban /> {t("Reject")}</Button>}
      {open && <Button variant="ghost" size="sm" disabled={pending} onClick={() => setReasonFor("CANCELLED")}><X /> {t("Cancel")}</Button>}
      {(status === "REJECTED" || status === "CANCELLED") && <Button variant="outline" size="sm" disabled={pending} onClick={() => set("REVIEWING")}><RotateCcw /> {t("Reopen")}</Button>}
      <Dialog open={!!reasonFor} onOpenChange={(o) => { if (!o) { setReasonFor(null); setReason(""); } }}>
        <DialogContent>
          <DialogHeader icon={reasonFor === "REJECTED" ? <Ban /> : <CircleX />} eyebrow={t("Booking request")} tone="rose">
            <DialogTitle>{reasonFor === "REJECTED" ? t("Reject this request") : t("Cancel this request")}</DialogTitle>
            <DialogDescription>{reasonFor === "REJECTED" ? t("e.g. fully booked for those dates. The customer may ask why.") : t("e.g. customer changed plans.")}</DialogDescription>
          </DialogHeader>
          <div className="space-y-1.5"><Label htmlFor="sr-reason">{t("Reason")}</Label><Textarea id="sr-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} autoFocus /></div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setReasonFor(null)}>{t("Back")}</Button>
            <Button variant="destructive" disabled={pending || !reason.trim()} onClick={() => set(reasonFor!, reason, () => { setReasonFor(null); setReason(""); })}>
              {pending && <Loader2 className="animate-spin" />}{reasonFor === "REJECTED" ? t("Reject") : t("Cancel request")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

function localNow() {
  const d = new Date();
  d.setMinutes(d.getMinutes() - d.getTimezoneOffset());
  return d.toISOString().slice(0, 16);
}

export function LogContactForm({ id }: { id: string }) {
  const t = useT();
  const router = useRouter();
  const [defaultAt] = useState(localNow);
  return (
    <ActionForm action={logContactAction} resetOnSuccess onSuccess={() => router.refresh()} className="space-y-2">
      {({ pending, fieldErrors: e }) => (
        <>
          <input type="hidden" name="id" value={id} />
          <div className="grid gap-2 sm:grid-cols-[1fr_auto]">
            <Textarea name="note" rows={2} placeholder={t("Called on WhatsApp — confirmed 2 nights, arriving 18:00…")} aria-label={t("Contact notes")} />
            <input name="contactedAt" type="datetime-local" defaultValue={defaultAt} aria-label={t("Contacted at")} className="h-9 rounded-md border bg-transparent px-2 text-sm" />
          </div>
          <FieldError message={e?.note} />
          <Button type="submit" size="sm" variant="outline" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <MessageSquarePlus />}{t("Log contact")}</Button>
        </>
      )}
    </ActionForm>
  );
}

export function AssignSelect({ id, assignedToId, staff }: { id: string; assignedToId: string; staff: { id: string; fullName: string }[] }) {
  const t = useT();
  const { pending, run } = useRun();
  return (
    <NativeSelect value={assignedToId} disabled={pending} aria-label={t("Assigned to")} className="h-8 text-sm"
      onChange={(e) => run(() => assignRequestAction({ id, userId: e.target.value || null }))}>
      <option value="">{t("Unassigned")}</option>
      {staff.map((s) => <option key={s.id} value={s.id}>{s.fullName}</option>)}
    </NativeSelect>
  );
}

export function RelinkCustomer({ id, currentGuestId, matches }: {
  id: string; currentGuestId: string | null; matches: { id: string; fullName: string; phone: string | null; email: string | null; stays: number }[];
}) {
  const t = useT();
  const { pending, run } = useRun();
  const [choice, setChoice] = useState(currentGuestId ?? "NEW");
  return (
    <div className="flex flex-wrap items-center gap-2">
      <NativeSelect value={choice} onChange={(e) => setChoice(e.target.value)} className="h-8 min-w-56 text-sm" aria-label={t("Customer profile")}>
        {matches.map((m) => <option key={m.id} value={m.id}>{m.fullName} · {m.phone ?? m.email} · {t.plural(m.stays, "{n} stay", "{n} stays")}</option>)}
        <option value="NEW">{t("+ Create a new customer profile")}</option>
      </NativeSelect>
      <Button size="sm" variant="outline" disabled={pending || choice === currentGuestId} onClick={() => run(() => relinkCustomerAction({ id, guestId: choice }))}>
        {pending && <Loader2 className="animate-spin" />}{t("Save")}
      </Button>
    </div>
  );
}

export interface TypeAvailability {
  id: string; name: string; baseRate: number; maxAdults: number; maxChildren: number;
  rooms: { id: string; number: string; status: string }[];
}

/** Confirm & create reservation. The reservation engine re-checks availability and price on submit. */
export function ConvertForm({ request, types, websiteDiscount, canDiscount, menu, stay = false }: {
  request: { id: string; checkIn: string; checkOut: string; roomTypeId: string; requestedRoomId: string | null; roomCount: number; adults: number; children: number };
  types: TypeAvailability[] | null;
  websiteDiscount: number;
  canDiscount: boolean;
  /** Restaurant & bar menu: food & drinks can go on the new booking's bill. */
  menu?: BillMenu | null;
  /** Opened in the list: stay on the list after confirming (not the new reservation's page). */
  stay?: boolean;
}) {
  const t = useT();
  const [picks, setPicks] = useState<MenuPick[]>([]);
  const [typeId, setTypeId] = useState(request.roomTypeId);
  const [count, setCount] = useState(request.roomCount);
  const [dates, setDates] = useState({ checkIn: request.checkIn, checkOut: request.checkOut });
  const datesChanged = dates.checkIn !== request.checkIn || dates.checkOut !== request.checkOut;
  const type = types?.find((x) => x.id === typeId);
  const free = type?.rooms.length ?? 0;

  return (
    <ActionForm action={convertRequestAction} className="space-y-3">
      {({ pending, fieldErrors: e }) => (
        <>
          <input type="hidden" name="id" value={request.id} />
          {stay && <input type="hidden" name="stay" value="1" />}
          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1"><Label htmlFor="c-in">{t("Check-in")}</Label>
              <input id="c-in" name="checkIn" type="date" value={dates.checkIn} onChange={(ev) => setDates({ ...dates, checkIn: ev.target.value })} className="h-9 w-full rounded-md border bg-transparent px-2 text-sm" /><FieldError message={e?.checkIn} /></div>
            <div className="space-y-1"><Label htmlFor="c-out">{t("Check-out")}</Label>
              <input id="c-out" name="checkOut" type="date" value={dates.checkOut} onChange={(ev) => setDates({ ...dates, checkOut: ev.target.value })} className="h-9 w-full rounded-md border bg-transparent px-2 text-sm" /><FieldError message={e?.checkOut} /></div>
          </div>
          <div className="space-y-1"><Label htmlFor="c-type">{t("Room type")}</Label>
            <NativeSelect id="c-type" name="roomTypeId" value={typeId} onChange={(ev) => setTypeId(ev.target.value)}>
              {(types ?? []).map((x) => <option key={x.id} value={x.id}>{t(x.name)} — {datesChanged ? t("recheck on confirm") : t("{n} free", { n: x.rooms.length })} · {formatTZS(x.baseRate)}</option>)}
            </NativeSelect>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <div className="space-y-1"><Label htmlFor="c-count">{t("Rooms")}</Label><Input id="c-count" name="roomCount" type="number" min={1} max={10} value={count} onChange={(ev) => setCount(Number(ev.target.value) || 1)} /></div>
            <div className="space-y-1"><Label htmlFor="c-ad">{t("Adults")}</Label><Input id="c-ad" name="adults" type="number" min={1} defaultValue={request.adults} /></div>
            <div className="space-y-1"><Label htmlFor="c-ch">{t("Children")}</Label><Input id="c-ch" name="children" type="number" min={0} defaultValue={request.children} /></div>
          </div>
          {count === 1 && !datesChanged && type && (
            <div className="space-y-1"><Label htmlFor="c-room">{t("Room")}</Label>
              <NativeSelect id="c-room" name="roomId" defaultValue={request.requestedRoomId && type.rooms.some((r) => r.id === request.requestedRoomId) ? request.requestedRoomId : ""}>
                <option value="">{t("Assign automatically")}</option>
                {type.rooms.map((r) => <option key={r.id} value={r.id}>{t("Room {number}", { number: r.number })}{r.status !== "AVAILABLE" && r.status !== "READY" ? ` (${t(r.status.toLowerCase())})` : ""}</option>)}
              </NativeSelect>
            </div>
          )}
          {!datesChanged && type && free < count && (
            <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{t.plural(free, "Only {n} {type} room free for these dates. Choose another type or dates.", "Only {n} {type} rooms free for these dates. Choose another type or dates.", { type: t(type.name) })}</p>
          )}
          {canDiscount && (
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1"><Label htmlFor="c-disc">{t("Discount / night (TZS)")}</Label><Input id="c-disc" name="discountPerNight" type="number" min={0} step={1000} placeholder={String(websiteDiscount)} /></div>
              <div className="space-y-1"><Label htmlFor="c-dr">{t("Discount reason")}</Label><Input id="c-dr" name="discountReason" placeholder={t("Only if changed")} /></div>
            </div>
          )}
          {menu && menu.categories.length > 0 && <FoodAndDrinks menu={menu} picks={picks} onChange={setPicks} />}
          <input type="hidden" name="menuItems" value={JSON.stringify(picksPayload(picks))} />
          <div className="space-y-1"><Label htmlFor="c-note">{t("Internal note (optional)")}</Label><Input id="c-note" name="note" /></div>
          <Button type="submit" className="w-full" disabled={pending}>
            {pending ? <Loader2 className="animate-spin" /> : <CalendarCheck2 />}{t("Confirm & create reservation")}{picks.length ? ` ${t("+ {amount} food & drinks", { amount: formatTZS(picksTotal(picks)) })}` : ""}
          </Button>
          <p className="text-xs text-muted-foreground">{t("Availability and price are checked again at this moment. The reservation is linked to this request and recorded under your name.")}</p>
        </>
      )}
    </ActionForm>
  );
}

/** Meeting room request → a meeting room booking at the asked-for time (change it afterwards on the booking if needed). */
export function ConvertMeetingForm({ request, free, menu, stay = false }: { request: { id: string; date: string; roomTypeId: string; attendees: number }; free: boolean; menu?: BillMenu | null; stay?: boolean }) {
  const t = useT();
  const [picks, setPicks] = useState<MenuPick[]>([]);
  return (
    <ActionForm action={convertRequestAction} className="space-y-3">
      {({ pending }) => (
        <>
          <input type="hidden" name="id" value={request.id} />
          {stay && <input type="hidden" name="stay" value="1" />}
          <input type="hidden" name="checkIn" value={request.date} />
          <input type="hidden" name="checkOut" value={request.date} />
          <input type="hidden" name="roomTypeId" value={request.roomTypeId} />
          <input type="hidden" name="roomCount" value="1" />
          <input type="hidden" name="adults" value={request.attendees} />
          <input type="hidden" name="children" value="0" />
          {!free && <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm text-destructive">{t("The meeting room is already booked for part of this time. Agree another time with the customer, then book it from New booking → Meeting room.")}</p>}
          {menu && menu.categories.length > 0 && <FoodAndDrinks menu={menu} picks={picks} onChange={setPicks} meeting />}
          <input type="hidden" name="menuItems" value={JSON.stringify(picksPayload(picks))} />
          <div className="space-y-1"><Label htmlFor="c-note">{t("Internal note (optional)")}</Label><Input id="c-note" name="note" /></div>
          <Button type="submit" className="w-full" disabled={pending || !free}>
            {pending ? <Loader2 className="animate-spin" /> : <CalendarCheck2 />}{t("Confirm & book the meeting room")}
          </Button>
          <p className="text-xs text-muted-foreground">{t("The time is checked again now. The booking is linked to this request, at today's meeting room price.")}</p>
        </>
      )}
    </ActionForm>
  );
}

/** "Add food & drinks" on a confirmation: the menu opens right here; the picks go on the bill as a pre-order. */
function FoodAndDrinks({ menu, picks, onChange, meeting }: { menu: BillMenu; picks: MenuPick[]; onChange: (p: MenuPick[]) => void; meeting?: boolean }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  if (!open && picks.length === 0) {
    return (
      <button type="button" onClick={() => setOpen(true)} className="flex w-full items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-left text-sm hover:bg-muted/50">
        <UtensilsCrossed className="size-4 text-muted-foreground" />
        <span><span className="font-medium">{t("Add food & drinks")}</span><span className="block text-xs text-muted-foreground">{meeting ? t("Lunch, tea break, drinks for the meeting…") : t("Restaurant & bar — dinner, drinks, breakfast…")}</span></span>
      </button>
    );
  }
  return (
    <div className="space-y-2 rounded-xl border border-border/70 p-3">
      <p className="flex items-center justify-between text-sm font-medium">
        <span className="inline-flex items-center gap-2"><UtensilsCrossed className="size-4" />{t("Food & drinks")}</span>
        {picks.length === 0 && <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted-foreground hover:underline">{t("Close")}</button>}
      </p>
      <MenuOrder menu={menu} picks={picks} onChange={onChange} />
      <p className="text-[11px] text-muted-foreground">{meeting ? t("Goes on the booking's bill as a pre-order at menu prices — tell the kitchen & bar when the meeting starts.") : t("Goes on the booking's bill as a pre-order at menu prices — tell the kitchen & bar when the guest arrives.")}</p>
    </div>
  );
}
