"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AlertCircle, ArrowLeft, ArrowRight, BedDouble, Check, Loader2, LogIn } from "lucide-react";
import { cn } from "@/lib/utils";
import { IdPicker, NationalityPicker } from "@/components/staff/id-nationality";
import { formatTZS } from "@/lib/format";
import { ROOM_STATUS_META } from "@/lib/room-status";
import type { RoomStatus } from "@/generated/prisma/enums";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { checkInWizardAction } from "../../actions";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

type Guest = { fullName: string; phone: string; email: string; idType: string; idNumber: string; nationality: string; address: string };
type Room = { number: string; type: string; roomStatus: string; nights: number; isDayUse: boolean; arrival: string; departure: string; endAt: string; rate: number; discount: number; net: number };
type Res = {
  id: string; reference: string; source: string; eta: string; specialRequests: string; internalNotes: string; adults: number; children: number;
  gross: number; discount: number; charges: number; net: number; paid: number; balance: number; hasTransport: boolean; rooms: Room[];
};

const CHECKLIST: { key: string; label: string; required?: boolean }[] = [
  { key: "guestVerified", label: msg("Guest ID verified"), required: true },
  { key: "roomReady", label: msg("Room is clean and ready") },
  { key: "keyIssued", label: msg("Room key issued") },
  { key: "wifiGiven", label: msg("Wi-Fi details given") },
  { key: "breakfastExplained", label: msg("Breakfast times explained") },
  { key: "facilitiesExplained", label: msg("Restaurant, bar & facilities explained") },
  { key: "requestsConfirmed", label: msg("Special requests confirmed") },
  { key: "transportConfirmed", label: msg("Transport confirmed") },
];

export function CheckInWizard({ reservation: r, guest: initial }: { reservation: Res; guest: Guest }) {
  const t = useT();
  const router = useRouter();
  const [step, setStep] = useState(1);
  const [guest, setGuest] = useState(initial);
  const [eta, setEta] = useState(r.eta);
  const [checks, setChecks] = useState<Record<string, boolean>>({
    roomReady: r.rooms.every((x) => ["AVAILABLE", "READY", "RESERVED"].includes(x.roomStatus)),
  });
  const [showMore, setShowMore] = useState(!initial.address);
  const [pending, start] = useTransition();
  const missing = (["phone", "idType", "idNumber", "nationality"] as const).filter((k) => !guest[k]);
  const roomNotReady = r.rooms.filter((x) => !["AVAILABLE", "READY", "RESERVED"].includes(x.roomStatus));
  const set = (k: keyof Guest) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setGuest({ ...guest, [k]: e.target.value });

  function submit() {
    start(async () => {
      const res = await checkInWizardAction({ reservationId: r.id, eta, guest, checklist: checks });
      if (res.ok) {
        toast.success(res.message);
        res.data.warnings.forEach((w) => toast.warning(t(w), { duration: 10000 }));
        router.push(`/staff/reservations/${r.id}/welcome`);
      } else toast.error(res.error, { duration: 8000 });
    });
  }

  return (
    <div className="w-full space-y-4">
      <Link href="/staff/check-in" className={buttonVariants({ variant: "ghost", size: "sm" })}><ArrowLeft /> {t("Find another booking")}</Link>
      <div>
        <p className="text-[11px] font-semibold uppercase tracking-[0.18em] text-[oklch(0.55_0.1_75)]">{t("Check in")} · {r.reference} · {t(r.source)}</p>
        <h1 className="text-2xl font-semibold">{guest.fullName}</h1>
      </div>

      <ol className="grid grid-cols-3 gap-2" aria-label={t("Check-in steps")}>
        {[msg("Guest details"), msg("Stay summary"), msg("Welcome & check in")].map((label, i) => (
          <li key={label}>
            <button type="button" onClick={() => setStep(i + 1)} className={cn("flex w-full items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm transition-colors",
              step === i + 1 ? "border-primary bg-primary text-primary-foreground" : step > i + 1 ? "bg-green-600/10 text-green-800" : "bg-card text-muted-foreground")}>
              <span className="grid size-6 shrink-0 place-items-center rounded-full bg-background/20 text-xs font-bold">{step > i + 1 ? <Check className="size-3.5" /> : i + 1}</span>
              <span className="truncate">{t(label)}</span>
            </button>
          </li>
        ))}
      </ol>

      {step === 1 && (
        <Card>
          <CardHeader><CardTitle>{t("Confirm guest details")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {missing.length > 0 && (
              <p className="flex items-center gap-2 rounded-lg bg-amber-500/10 px-3 py-2 text-sm text-amber-800"><AlertCircle className="size-4" />{t("Only the highlighted fields are missing.")}</p>
            )}
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label={msg("Full name")} value={guest.fullName} onChange={set("fullName")} span />
              <Field label={msg("Phone")} value={guest.phone} onChange={set("phone")} missing={!guest.phone} type="tel" />
              <Field label={msg("Email")} value={guest.email} onChange={set("email")} type="email" />
              <div className={cn("space-y-1.5 rounded-lg sm:col-span-2", (!guest.idType || !guest.idNumber) && "ring-2 ring-amber-400/60 ring-offset-2 ring-offset-card")}>
                <Label htmlFor="idNumber">{t("ID")}</Label>
                <IdPicker type={guest.idType} number={guest.idNumber} numberId="idNumber" size="sm"
                  onType={(v) => setGuest((g) => ({ ...g, idType: v }))} onNumber={(v) => setGuest((g) => ({ ...g, idNumber: v }))} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label>{t("Nationality")}</Label>
                <NationalityPicker size="sm" value={guest.nationality} invalid={!guest.nationality} onChange={(v) => setGuest((g) => ({ ...g, nationality: v }))} />
              </div>
              <Field label={msg("Expected arrival time (ETA)")} value={eta} onChange={(e) => setEta(e.target.value)} type="time" />
            </div>
            {showMore ? <Field label={msg("Address")} value={guest.address} onChange={set("address")} span /> :
              <button type="button" className="text-sm text-primary underline-offset-4 hover:underline" onClick={() => setShowMore(true)}>{t("+ More details")}</button>}
            <div className="flex justify-end"><Button onClick={() => setStep(2)}>{t("Next")} <ArrowRight /></Button></div>
          </CardContent>
        </Card>
      )}

      {step === 2 && (
        <Card>
          <CardHeader><CardTitle>{t("Stay summary")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {r.rooms.map((x) => (
              <div key={x.number} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border p-4">
                <div className="flex items-center gap-3">
                  <span className="grid size-12 place-items-center rounded-lg bg-ink text-lg font-bold text-gold">{x.number}</span>
                  <div>
                    <p className="font-semibold">{t(x.type)}</p>
                    <p className="text-sm text-muted-foreground">
                      {x.isDayUse ? t("Short time · {date}", { date: t.date(x.arrival) }) : `${t.date(x.arrival)} → ${t.date(x.departure)} · ${t.plural(x.nights, "{n} night", "{n} nights")}`}
                    </p>
                    <p className="text-xs text-muted-foreground">{t("Checkout {time}", { time: t.dateTime(x.endAt) })}</p>
                  </div>
                </div>
                <span className={cn("rounded-full px-2.5 py-1 text-xs font-medium", ROOM_STATUS_META[x.roomStatus as RoomStatus]?.className)}>
                  <BedDouble className="mr-1 inline size-3.5" />{t(ROOM_STATUS_META[x.roomStatus as RoomStatus]?.label ?? x.roomStatus)}
                </span>
              </div>
            ))}
            {roomNotReady.length > 0 && (
              <p className="rounded-lg bg-destructive/10 px-3 py-2 text-sm text-destructive">
                {t("Room {room} is not ready. Finish housekeeping or change the room on the reservation before check-in.", { room: roomNotReady.map((x) => x.number).join(", ") })}
              </p>
            )}
            <dl className="grid gap-1.5 rounded-xl bg-muted/40 p-4 text-sm">
              {r.rooms.map((x) => (
                <div key={x.number} className="flex justify-between"><dt className="text-muted-foreground">{t("Rate {room} ({detail})", { room: x.number, detail: x.isDayUse ? t("day") : `${x.nights} × ${x.rate.toLocaleString("en-TZ")}` })}</dt><dd className="tabular-nums">{formatTZS(x.rate * Math.max(1, x.nights))}</dd></div>
              ))}
              <div className="flex justify-between"><dt className="text-muted-foreground">{t("Discount")}</dt><dd className="tabular-nums">− {formatTZS(r.discount)}</dd></div>
              {r.charges > 0 && <div className="flex justify-between"><dt className="text-muted-foreground">{t("Other charges")}</dt><dd className="tabular-nums">{formatTZS(r.charges)}</dd></div>}
              <div className="flex justify-between border-t pt-1.5 font-semibold"><dt>{t("Net")}</dt><dd className="tabular-nums">{formatTZS(r.net)}</dd></div>
              <div className="flex justify-between"><dt className="text-muted-foreground">{t("Paid")}</dt><dd className="tabular-nums">{formatTZS(r.paid)}</dd></div>
              <div className={cn("flex justify-between text-base font-bold", r.balance > 0 ? "text-destructive" : "text-green-700")}><dt>{t("Balance")}</dt><dd className="tabular-nums">{formatTZS(r.balance)}</dd></div>
            </dl>
            {r.balance > 0 && <p className="text-sm text-muted-foreground">{t("You can receive payment now on the reservation page, or at checkout.")}</p>}
            {(r.specialRequests || r.internalNotes) && (
              <div className="space-y-1 rounded-lg border border-amber-500/40 bg-amber-500/10 p-3 text-sm">
                {r.specialRequests && <p><strong>{t("Guest request:")}</strong> {r.specialRequests}</p>}
                {r.internalNotes && <p><strong>{t("Staff note:")}</strong> {r.internalNotes}</p>}
              </div>
            )}
            <div className="flex justify-between">
              <Button variant="outline" onClick={() => setStep(1)}><ArrowLeft /> {t("Back")}</Button>
              <Button onClick={() => setStep(3)}>{t("Next")} <ArrowRight /></Button>
            </div>
          </CardContent>
        </Card>
      )}

      {step === 3 && (
        <Card>
          <CardHeader><CardTitle>{t("Welcome checklist")}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-2 sm:grid-cols-2">
              {CHECKLIST.filter((c) => c.key !== "transportConfirmed" || r.hasTransport).filter((c) => c.key !== "requestsConfirmed" || r.specialRequests).map((c) => (
                <label key={c.key} className={cn("flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm transition-colors", checks[c.key] ? "border-green-600/40 bg-green-600/5" : "hover:bg-muted/50")}>
                  <input type="checkbox" className="size-5 accent-[var(--primary)]" checked={!!checks[c.key]} onChange={(e) => setChecks({ ...checks, [c.key]: e.target.checked })} />
                  <span>{t(c.label)}{c.required && <span className="text-destructive"> *</span>}</span>
                </label>
              ))}
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 border-t pt-4">
              <Button variant="outline" onClick={() => setStep(2)}><ArrowLeft /> {t("Back")}</Button>
              <Button size="lg" className="h-12 px-6 text-base" disabled={pending || !checks.guestVerified || roomNotReady.length > 0} onClick={submit}>
                {pending ? <Loader2 className="animate-spin" /> : <LogIn />} {t("CHECK IN GUEST")}
              </Button>
            </div>
            {!checks.guestVerified && <p className="text-right text-xs text-muted-foreground">{t("Tick “Guest ID verified” to continue.")}</p>}
          </CardContent>
        </Card>
      )}
    </div>
  );
}

function Field({ label, value, onChange, missing, type = "text", span }: {
  label: string; value: string; onChange: (e: React.ChangeEvent<HTMLInputElement>) => void; missing?: boolean; type?: string; span?: boolean;
}) {
  const t = useT();
  // The English label makes the id (the same in every language).
  const id = label.toLowerCase().replace(/[^a-z]+/g, "-");
  return (
    <div className={cn("space-y-1.5", span && "sm:col-span-2")}>
      <Label htmlFor={id}>{t(label)}{missing && <span className="ml-1 text-xs font-normal text-amber-700">{t("missing")}</span>}</Label>
      <Input id={id} type={type} value={value} onChange={onChange} className={cn(missing && "border-amber-400 ring-2 ring-amber-400/40")} />
    </div>
  );
}
