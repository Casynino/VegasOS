"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Bath, Car, Check, CheckCheck, ConciergeBell, Hand, Loader2, MessageSquare, MessageSquareWarning, Plus, Smartphone, SprayCan, UserRound, UtensilsCrossed, Wrench, X,
} from "lucide-react";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { cn } from "@/lib/utils";
import { acceptRequestAction, createRequestAction, updateRequestAction } from "./actions";
import { REQUEST_TYPE_LABEL } from "@/lib/request-meta";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";

type Staff = { id: string; fullName: string; role?: string };
const first = (n: string) => n.replace(/\s*\(.*\)/, "").split(/\s+/)[0] ?? n;

/** Each kind of request: its icon and colour. */
const KIND: Record<string, { icon: typeof Bath; tone: string }> = {
  TOWELS: { icon: Bath, tone: "bg-sky-500/15 text-sky-700 dark:text-sky-300" },
  CLEANING: { icon: SprayCan, tone: "bg-teal-500/15 text-teal-700 dark:text-teal-300" },
  MAINTENANCE: { icon: Wrench, tone: "bg-amber-500/15 text-amber-700 dark:text-amber-300" },
  RESTAURANT: { icon: UtensilsCrossed, tone: "bg-orange-500/15 text-orange-700 dark:text-orange-300" },
  TRANSPORT: { icon: Car, tone: "bg-violet-500/15 text-violet-700 dark:text-violet-300" },
  GENERAL: { icon: ConciergeBell, tone: "bg-[oklch(0.75_0.12_80)]/15 text-[oklch(0.5_0.1_75)] dark:text-[#f0cf86]" },
  OTHER: { icon: MessageSquare, tone: "bg-muted text-muted-foreground" },
  COMPLAINT: { icon: MessageSquareWarning, tone: "bg-rose-500/15 text-rose-700 dark:text-rose-300" },
};
const PRIORITY: Record<string, { label: string; tone: string } | undefined> = {
  URGENT: { label: msg("Urgent"), tone: "bg-rose-500 text-white" },
  HIGH: { label: msg("High"), tone: "bg-amber-500/20 text-amber-700 dark:text-amber-300" },
  LOW: { label: msg("Low"), tone: "bg-muted text-muted-foreground" },
};
const ago = (from: string, now: number, t: T) => {
  const m = Math.max(0, Math.round((now - new Date(from).getTime()) / 60000));
  return m < 1 ? t("just now") : m < 60 ? t("{n} min ago", { n: m }) : m < 24 * 60 ? (m % 60 ? t("{h} h {m} min ago", { h: Math.floor(m / 60), m: m % 60 }) : t("{h} h ago", { h: Math.floor(m / 60) })) : t("{n} d ago", { n: Math.floor(m / 1440) });
};
const took = (a: string, b: string, t: T) => {
  const m = Math.max(1, Math.round((new Date(b).getTime() - new Date(a).getTime()) / 60000));
  return m < 60 ? t("{n} min", { n: m }) : m % 60 ? t("{h} h {m} min", { h: Math.floor(m / 60), m: m % 60 }) : t("{h} h", { h: Math.floor(m / 60) });
};
const clock = (iso: string, t: T) => new Date(iso).toLocaleTimeString(t.intl, { hour: "2-digit", minute: "2-digit", timeZone: "Africa/Dar_es_Salaam" });

export function NewRequestDialog({ guests, staff, reservationId, compact, hero }: {
  guests: { reservationId: string; label: string }[]; staff: Staff[]; reservationId?: string; compact?: boolean;
  /** On the page's dark header: the gold button. */
  hero?: boolean;
}) {
  const router = useRouter();
  const t = useT();
  const [open, setOpen] = useState(false);
  const [type, setType] = useState("TOWELS");
  const [priority, setPriority] = useState("NORMAL");
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button size={compact ? "sm" : "default"} variant={compact ? "outline" : "default"}
        className={cn(hero && "h-11 rounded-xl bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] px-5 text-[oklch(0.2_0.03_60)] shadow-[0_10px_24px_-12px_oklch(0.7_0.12_75)] hover:brightness-105")} />}>
        <Plus /> {hero ? t("Log a request") : t("Guest request")}
      </DialogTrigger>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader icon={<ConciergeBell />} eyebrow={t("Guest care")} tone="sky"><DialogTitle>{t("Log a guest request")}</DialogTitle></DialogHeader>
        <ActionForm action={createRequestAction} onSuccess={() => { setOpen(false); router.refresh(); }} className="grid gap-3.5">
          {({ pending, fieldErrors: e }) => (
            <>
              {reservationId ? <input type="hidden" name="reservationId" value={reservationId} /> : (
                <div className="space-y-1"><Label htmlFor="rg">{t("Guest / room")}</Label>
                  <NativeSelect id="rg" name="reservationId" defaultValue=""><option value="">{t("Not linked to a guest")}</option>{guests.map((g) => <option key={g.reservationId} value={g.reservationId}>{g.label}</option>)}</NativeSelect></div>
              )}
              <div className="space-y-1.5">
                <Label>{t.ctx("request", "What is it?")}</Label>
                <input type="hidden" name="type" value={type} />
                <div className="grid grid-cols-2 gap-1.5 sm:grid-cols-4">
                  {Object.entries(REQUEST_TYPE_LABEL).map(([k, v]) => {
                    const K = KIND[k] ?? KIND.OTHER;
                    return (
                      <button key={k} type="button" onClick={() => setType(k)} aria-pressed={type === k}
                        className={cn("flex flex-col items-center gap-1 rounded-xl border px-2 py-2.5 text-center text-[11.5px] font-medium transition", type === k ? "border-sky-500/60 bg-sky-500/10 text-foreground" : "border-border/70 text-muted-foreground hover:border-border hover:text-foreground")}>
                        <span className={cn("grid size-7 place-items-center rounded-lg", K.tone)}><K.icon className="size-3.5" /></span>{t(v)}
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="space-y-1.5">
                <Label>{t("How urgent?")}</Label>
                <input type="hidden" name="priority" value={priority} />
                <div className="inline-flex w-full rounded-xl bg-muted p-0.5 text-xs">
                  {[["LOW", msg("Low")], ["NORMAL", msg("Normal")], ["HIGH", msg("High")], ["URGENT", msg("Urgent")]].map(([k, v]) => (
                    <button key={k} type="button" onClick={() => setPriority(k)} aria-pressed={priority === k}
                      className={cn("flex-1 rounded-lg py-1.5 font-semibold transition", priority === k ? (k === "URGENT" ? "bg-rose-500 text-white" : "bg-background shadow-sm") : "text-muted-foreground")}>{t(v)}</button>
                  ))}
                </div>
              </div>
              <div className="space-y-1"><Label htmlFor="rd">{t("Details")}</Label><Textarea id="rd" name="description" rows={2} placeholder={t("e.g. 2 extra towels and a pillow")} /><FieldError message={e?.description} /></div>
              <div className="space-y-1"><Label htmlFor="ra">{t("Give it to")}</Label>
                <NativeSelect id="ra" name="assignedToId" defaultValue="">
                  <option value="">{t("Nobody yet — whoever accepts it")}</option>
                  {staff.map((s) => <option key={s.id} value={s.id}>{s.fullName}{s.role ? ` · ${t(s.role)}` : ""}</option>)}
                </NativeSelect></div>
              <DialogFooter><Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{t.ctx("request", "Log request")}</Button></DialogFooter>
            </>
          )}
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export type RequestView = {
  id: string; type: string; priority: string; status: string; description: string; source: string; resolution: string | null;
  room: string | null; guest: string | null; reservationId: string | null; createdBy: string | null; assignedTo: { id: string; fullName: string } | null;
  createdAt: string; acceptedAt: string | null; completedAt: string | null;
};

/**
 * One request, like an order card: what, which room, how long it has waited — and the one next step: Accept (it becomes
 * yours, in progress), then Done. A manager gives it to a person instead; reception can hand it on too.
 */
export function RequestCard({ r, meId, now, staff, manage, boss }: { r: RequestView; meId: string; now: number; staff: Staff[]; manage: boolean; boss: boolean }) {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  const [resolving, setResolving] = useState(false);
  const [resolution, setResolution] = useState("");
  const [cancelling, setCancelling] = useState(false);
  const K = KIND[r.type] ?? KIND.OTHER;
  const pr = PRIORITY[r.priority];
  const mine = r.assignedTo?.id === meId;
  const waiting = r.status === "NEW" || r.status === "ASSIGNED";
  const done = r.status === "COMPLETED";
  const complaint = r.type === "COMPLAINT";
  const fromGuest = r.source !== "STAFF";
  // Reception does the work; managers give it to people (and close complaints themselves).
  // A request given to the manager themselves is theirs to accept and finish too.
  const acts = manage && (!boss || complaint || mine);
  const run = (fn: () => Promise<{ ok: boolean; error?: string }>) => start(async () => {
    const res = await fn();
    if (res.ok) router.refresh(); else toast.error(res.error ?? t("That did not work."));
  });
  const accept = () => run(() => acceptRequestAction({ id: r.id, reservationId: r.reservationId }));
  const update = (patch: Omit<Parameters<typeof updateRequestAction>[0], "id">) => run(() => updateRequestAction({ id: r.id, reservationId: r.reservationId, ...patch }));
  const waitedLong = waiting && now - new Date(r.createdAt).getTime() > 15 * 60_000;

  if (done) {
    return (
      <li className="flex items-start gap-3 rounded-2xl border border-border/50 bg-card/50 px-3 py-2.5">
        <span className={cn("grid size-8 shrink-0 place-items-center rounded-lg opacity-80", K.tone)}><K.icon className="size-4" /></span>
        <div className="min-w-0 flex-1 leading-tight">
          <p className="flex items-center gap-1.5 text-sm"><span className="truncate font-medium">{t(REQUEST_TYPE_LABEL[r.type])}</span>{r.room && <span className="shrink-0 text-xs text-muted-foreground">· {t("Room {room}", { room: r.room })}</span>}</p>
          <p className="mt-0.5 truncate text-[11.5px] text-muted-foreground">
            <CheckCheck className="mr-1 inline size-3 text-emerald-500" />{r.assignedTo ? (r.assignedTo.id === meId ? t("You") : first(r.assignedTo.fullName)) : t("Done")} · {clock(r.completedAt!, t)}{r.completedAt && ` · ${t("took {time}", { time: took(r.acceptedAt ?? r.createdAt, r.completedAt, t) })}`}
          </p>
          {r.resolution && <p className="mt-1 text-[11.5px] text-emerald-700 dark:text-emerald-400">{t("Resolved: {text}", { text: r.resolution })}</p>}
        </div>
      </li>
    );
  }

  return (
    <li className={cn("overflow-hidden rounded-2xl border bg-card transition",
      mine ? "border-violet-500/50 shadow-[0_0_0_1px_oklch(0.6_0.2_290/0.25)]" : r.priority === "URGENT" ? "border-rose-500/50" : "border-border/70")}>
      {mine && waiting && <p className="flex items-center gap-1.5 bg-violet-500/15 px-3.5 py-1 text-[11px] font-semibold text-violet-700 dark:text-violet-200"><Hand className="size-3" />{t("Given to you — accept it when you start")}</p>}
      <div className="flex items-start gap-3 p-3.5">
        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl", K.tone)}><K.icon className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[15px] font-semibold leading-tight">{t(REQUEST_TYPE_LABEL[r.type])}</span>
            {r.room && <span className="rounded-md bg-foreground/[0.07] px-1.5 py-0.5 text-[11px] font-bold tabular-nums">{t("Room {room}", { room: r.room })}</span>}
            {pr && <span className={cn("rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider", pr.tone)}>{t(pr.label)}</span>}
            <span className={cn("ml-auto text-[11px] tabular-nums", waitedLong ? "font-semibold text-amber-600 dark:text-amber-300" : "text-muted-foreground")}>{ago(r.createdAt, now, t)}</span>
          </div>
          <p className="mt-1 text-sm leading-snug text-foreground/90">{r.description}</p>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11.5px] text-muted-foreground">
            {r.guest && (r.reservationId
              ? <Link href={`/staff/reservations/${r.reservationId}`} className="inline-flex items-center gap-1 font-medium text-foreground/80 hover:underline"><UserRound className="size-3" />{r.guest}</Link>
              : <span className="inline-flex items-center gap-1"><UserRound className="size-3" />{r.guest}</span>)}
            {r.guest && <span aria-hidden>·</span>}
            {fromGuest
              ? <span className="inline-flex items-center gap-1 rounded-full bg-sky-500/12 px-1.5 py-px font-semibold text-sky-700 dark:text-sky-300"><Smartphone className="size-3" />{t("From the guest")}{r.source === "ROOM_QR" ? ` · ${t("room QR")}` : ""}</span>
              : <span>{t("Logged by {name}", { name: r.createdBy ? first(r.createdBy) : t("staff") })}</span>}
          </p>
          {r.status === "ASSIGNED" && r.assignedTo && !mine && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-violet-500/12 px-2 py-0.5 text-[11px] font-semibold text-violet-700 dark:text-violet-200"><Hand className="size-3" />{t("Given to {name} — not accepted yet", { name: first(r.assignedTo.fullName) })}</p>
          )}
          {r.status === "IN_PROGRESS" && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-amber-500/12 px-2 py-0.5 text-[11px] font-semibold text-amber-700 dark:text-amber-200">
              <span className="size-1.5 animate-pulse rounded-full bg-amber-500" />{mine ? t("You are on it") : t("{name} is on it", { name: r.assignedTo ? first(r.assignedTo.fullName) : t("Someone") })}{r.acceptedAt ? ` · ${t("since {time}", { time: clock(r.acceptedAt, t) })}` : ""}
            </p>
          )}
        </div>
      </div>

      {manage && (
        <div className="flex flex-wrap items-center gap-1.5 border-t border-border/50 bg-muted/20 px-3.5 py-2.5">
          {acts && waiting && (
            <Button size="sm" disabled={pending} onClick={accept} className="bg-emerald-600 text-white hover:bg-emerald-500">
              {pending ? <Loader2 className="animate-spin" /> : <Check />}{r.assignedTo && !mine ? t("Take it over") : t("Accept")}
            </Button>
          )}
          {acts && r.status === "IN_PROGRESS" && (mine || boss || complaint) && (
            <Button size="sm" disabled={pending} onClick={() => (complaint ? setResolving(true) : update({ status: "COMPLETED" }))} className="bg-emerald-600 text-white hover:bg-emerald-500">
              {pending ? <Loader2 className="animate-spin" /> : <CheckCheck />}{complaint ? t("Resolved") : t("Mark done")}
            </Button>
          )}
          {/* Give it to someone (a manager), or hand it on (reception). */}
          <NativeSelect value={r.assignedTo?.id ?? ""} disabled={pending} aria-label={boss ? t("Give it to") : t("Hand it to")}
            onChange={(e) => update({ assignedToId: e.target.value || null })} className={cn("h-8 text-xs", boss ? "w-44" : "w-36")}>
            <option value="">{boss ? t("Give it to…") : t("Hand it to…")}</option>
            {staff.map((s) => <option key={s.id} value={s.id}>{s.id === meId ? t("Me") : s.fullName}{s.role ? ` · ${t(s.role)}` : ""}</option>)}
          </NativeSelect>
          {cancelling ? (
            <span className="ml-auto inline-flex items-center gap-1 text-xs">
              {t("Cancel it?")}
              <Button size="xs" variant="destructive" disabled={pending} onClick={() => update({ status: "CANCELLED" })}>{t("Yes")}</Button>
              <Button size="xs" variant="ghost" onClick={() => setCancelling(false)}>{t("No")}</Button>
            </span>
          ) : (
            <Button size="icon-sm" variant="ghost" title={t("Cancel the request")} aria-label={t("Cancel the request")} className="ml-auto text-muted-foreground hover:text-rose-500" onClick={() => setCancelling(true)}><X /></Button>
          )}
          {resolving && (
            <div className="flex w-full gap-1.5 pt-1">
              <Input autoFocus value={resolution} onChange={(e) => setResolution(e.target.value)} placeholder={t("How was it resolved? e.g. meal replaced, 20% off")} className="h-8 text-xs" />
              <Button size="sm" disabled={pending || resolution.trim().length < 3} onClick={() => update({ status: "COMPLETED", resolution })}>{t("Save")}</Button>
            </div>
          )}
        </div>
      )}
    </li>
  );
}
