"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BedDouble, CircleCheck, ConciergeBell, DoorOpen, Loader2, Lock, LogIn, LogOut, Power, ShieldAlert, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { closeShiftAsManagerAction, endShiftAction, myShiftWorkAction, startShiftAction } from "@/app/staff/(app)/shifts/actions";
import { useT } from "@/i18n/client";

type Work = Extract<Awaited<ReturnType<typeof myShiftWorkAction>>, { ok: true }>["data"];

/** What is still open as the shift ends — shown before it closes, so nothing is left silently. */
function OpenWork({ work, failed }: { work: Work | null; failed: boolean }) {
  const t = useT();
  if (failed && !work) return <p className="rounded-xl bg-amber-500/10 px-3 py-2.5 text-xs text-amber-800 dark:text-amber-200">{t("Could not check what is still open — you can still end your shift; the handover lists who owes.")}</p>;
  if (!work) return <p className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2.5 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />{t("Checking what is still open…")}</p>;
  const tzs = (n: number) => `TZS ${n.toLocaleString("en-US")}`;
  const items = [
    work.requests.length > 0 && { icon: ConciergeBell, tone: "text-sky-600 dark:text-sky-300", text: t.plural(work.requests.length, "{n} guest request with you — {list}", "{n} guest requests with you — {list}", { list: work.requests.map((r) => r.what).join(t.locale === "en" ? ", " : "、") }), sub: t("They go back to New for the next shift (the bell rings for them).") },
    work.arrivals > 0 && { icon: DoorOpen, tone: "text-amber-600 dark:text-amber-300", text: t.plural(work.arrivals, "{n} arrival not checked in yet", "{n} arrivals not checked in yet"), sub: t("Still open at the desk — mention them in your note if needed.") },
    work.departures > 0 && { icon: BedDouble, tone: "text-amber-600 dark:text-amber-300", text: t.plural(work.departures, "{n} departure not checked out yet", "{n} departures not checked out yet"), sub: t("Due today or earlier — still in their rooms.") },
    work.owing.count > 0 && { icon: Wallet, tone: "text-rose-600 dark:text-rose-300", text: t.plural(work.owing.count, "{n} guest owe {amount}", "{n} guests owe {amount}", { amount: tzs(work.owing.total) }), sub: t("Shown live on the Shifts page and in your shift report.") },
  ].filter(Boolean) as { icon: typeof Wallet; tone: string; text: string; sub: string }[];
  if (!items.length) return <p className="flex items-center gap-2 rounded-xl bg-emerald-500/10 px-3 py-2.5 text-xs font-medium text-emerald-700 dark:text-emerald-300"><CircleCheck className="size-4" />{t("Nothing left open — a clean handover.")}</p>;
  return (
    <div className="rounded-xl border border-border/70 bg-muted/30 p-3">
      <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("Still open")}</p>
      <ul className="space-y-2">
        {items.map((x) => (
          <li key={x.text} className="flex gap-2.5 text-sm">
            <x.icon className={cn("mt-0.5 size-4 shrink-0", x.tone)} />
            <span className="leading-tight"><span className="font-medium">{x.text}</span><span className="mt-0.5 block text-[11.5px] text-muted-foreground">{x.sub}</span></span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/**
 * Start / close my reception shift. Never someone else's: while a shift is open under another
 * receptionist, Start is locked with who has it — they close it, or a manager does.
 */
/** The shift as one small on/off switch (like the waiter's): on — "On shift · since 08:39" (tap to end); off — "Start my shift"; locked — "Desk full". */
function ShiftSwitch({ on, since, locked, pending, onClick }: { on: boolean; since?: string | null; locked?: string | null; pending: boolean; onClick: () => void }) {
  const t = useT();
  return (
    <button type="button" role="switch" aria-checked={on} disabled={pending || !!locked} onClick={onClick}
      title={locked ? t("Desk full — {names} on shift. Ask one of them to end their shift, or the Manager.", { names: locked }) : undefined}
      aria-label={on ? t("On shift since {time} — tap to end your shift", { time: String(since) }) : locked ? t("Desk full") : t("Off shift — tap to start your shift")}
      className={cn("group inline-flex h-9 shrink-0 items-center gap-2 rounded-full border bg-card pl-1.5 pr-3.5 text-sm font-medium transition-colors disabled:cursor-not-allowed",
        on ? "border-emerald-500/40 hover:bg-emerald-500/[0.07]" : locked ? "border-amber-500/40 text-amber-700 dark:text-amber-300" : "border-[oklch(0.75_0.12_80)]/50 hover:bg-[oklch(0.75_0.12_80)]/10")}>
      <span className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors", on ? "bg-emerald-500" : "bg-muted ring-1 ring-inset ring-border")}>
        <span className={cn("absolute top-0.5 grid size-5 place-items-center rounded-full bg-white shadow-sm transition-all", on ? "left-[1.125rem]" : "left-0.5")}>
          {pending ? <Loader2 className="size-3 animate-spin text-slate-500" /> : locked ? <Lock className="size-3 text-amber-600" /> : <Power className={cn("size-3", on ? "text-emerald-600" : "text-slate-400")} />}
        </span>
      </span>
      {on
        ? <span className="tabular-nums">{t.rich("<on>On shift</on> · since <b>{time}</b>", { on: (c) => <strong className="font-semibold text-emerald-700 dark:text-emerald-300">{c}</strong>, b: (c) => <strong className="font-semibold text-foreground">{c}</strong> }, { time: since ?? "" })}</span>
        : <span className={cn(!locked && "font-semibold text-foreground")}>{locked ? t("Desk full") : t("Start my shift")}</span>}
    </button>
  );
}

export function ShiftControls({ myShiftOpen, otherOpenBy, scheduledName, isScheduled, onDark = false, big = false, variant = "button", since = null }: {
  myShiftOpen: boolean;
  /** "switch": one small on/off switch (the waiter's look) instead of buttons. */
  variant?: "button" | "switch";
  /** For the switch: when my shift started ("08:39"). */
  since?: string | null;
  /** Who fills the reception desk when nobody else can start (both places taken) — null = Start is open. */
  otherOpenBy: string | null; scheduledName: string | null; isScheduled: boolean;
  /** Styled for the dark photo banner. */
  onDark?: boolean;
  /** The big gold Start button (the Start-shift page). */
  big?: boolean;
}) {
  const darkPrimary = "h-7 gap-1.5 rounded-lg border-0 bg-linear-to-r from-[#f2d28c] to-[#d9a646] px-2.5 text-[11px] font-semibold text-[#1b1611] hover:opacity-95 [&_svg]:size-3.5";
  const darkOutline = "h-7 gap-1.5 rounded-lg border border-white/25 bg-white/10 px-2.5 text-[11px] font-semibold text-white hover:bg-white/15 hover:text-white [&_svg]:size-3.5";
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  const [dialog, setDialog] = useState<null | "start" | "end">(null);
  const [text, setText] = useState("");
  const [work, setWork] = useState<Work | null>(null);
  const [failed, setFailed] = useState(false);
  const needsReason = !!scheduledName && !isScheduled;
  // Opening "End my shift": see what is still open first.
  useEffect(() => {
    if (dialog !== "end") return;
    let live = true;
    myShiftWorkAction().then((r) => { if (!live) return; if (r.ok) setWork(r.data); else setFailed(true); }).catch(() => { if (live) setFailed(true); });
    return () => { live = false; setWork(null); setFailed(false); };
  }, [dialog]);

  function run(fn: () => Promise<{ ok: boolean; error?: string; message?: string }>) {
    start(async () => {
      const res = await fn();
      if (res.ok) { toast.success(res.message); setDialog(null); setText(""); router.refresh(); }
      else toast.error(res.error, { duration: 8000 });
    });
  }

  const startIt = () => (needsReason ? setDialog("start") : run(() => startShiftAction({})));
  const toggle = variant === "switch" ? <ShiftSwitch on={myShiftOpen} since={since} locked={!myShiftOpen ? otherOpenBy : null} pending={pending} onClick={() => (myShiftOpen ? setDialog("end") : startIt())} /> : null;

  if (myShiftOpen) {
    return (
      <>
        {toggle ?? <Button variant="outline" className={onDark ? darkOutline : undefined} onClick={() => setDialog("end")}><LogOut /> {t("End my shift")}</Button>}
        <Dialog open={dialog === "end"} onOpenChange={(o) => !o && setDialog(null)}>
          <DialogContent>
            <DialogHeader icon={<LogOut />} eyebrow={t("Your shift")} tone="gold"><DialogTitle>{t("End your shift?")}</DialogTitle>
              <DialogDescription>{t("Your shift report is made automatically from what you did, and sent to the Boss. Write anything the next receptionist must know.")}</DialogDescription></DialogHeader>
            <OpenWork work={work} failed={failed} />
            <Textarea rows={4} maxLength={1000} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("Handover note — e.g. Room 204 asked for late checkout 13:00 (approved by manager). Cash float TZS 150,000 in drawer.")} />
            <DialogFooter><Button disabled={pending} onClick={() => run(() => endShiftAction({ closingNote: text }))}>{pending && <Loader2 className="animate-spin" />}{t("End my shift")}</Button></DialogFooter>
          </DialogContent>
        </Dialog>
      </>
    );
  }

  if (otherOpenBy) {
    if (toggle) return toggle;
    return (
      <span className={cn("inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium", onDark ? "bg-white/10 text-white/85" : "bg-amber-500/12 text-amber-800 dark:text-amber-200")}>
        <Lock className="size-3.5 shrink-0" />{otherOpenBy.includes(" and ") ? t("Desk full — {names} are on shift", { names: otherOpenBy }) : t("Desk full — {names} is on shift", { names: otherOpenBy })}
      </span>
    );
  }

  return (
    <>
      {toggle ?? (
        <Button className={big ? "h-12 gap-2 rounded-2xl border-0 bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] px-7 text-base font-semibold text-[oklch(0.2_0.03_60)] shadow-[0_14px_32px_-14px_oklch(0.7_0.12_75)] hover:brightness-105 [&_svg]:size-5" : onDark ? darkPrimary : undefined}
          onClick={startIt} disabled={pending}>
          {pending ? <Loader2 className="animate-spin" /> : <LogIn />} {t("Start my shift")}
        </Button>
      )}
      <Dialog open={dialog === "start"} onOpenChange={(o) => !o && setDialog(null)}>
        <DialogContent>
          <DialogHeader icon={<LogIn />} eyebrow={t("Your shift")} tone="gold"><DialogTitle>{t("Start shift")}</DialogTitle>
            <DialogDescription>{t("{name} is scheduled today. Say why you are working instead.", { name: scheduledName })}</DialogDescription></DialogHeader>
          <div className="space-y-1.5"><Label htmlFor="rr">{t("Reason")}</Label>
            <Textarea id="rr" rows={2} value={text} onChange={(e) => setText(e.target.value)} placeholder={t("e.g. Covering for Neema (sick)")} /></div>
          <DialogFooter>
            <Button disabled={pending || !text.trim()} onClick={() => run(() => startShiftAction({ replacementReason: text }))}>
              {pending && <Loader2 className="animate-spin" />}{t("Start shift")}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** A manager closes someone's open shift (they forgot, left, or someone must start) — always saying why. */
export function ManagerCloseShift({ shiftId, name, onDark = false, compact = false }: { shiftId: string; name: string; onDark?: boolean; /** Icon only (in a small card). */ compact?: boolean }) {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  return (
    <>
      {compact
        ? <Button variant="ghost" size="icon-sm" title={t("Close {name}'s shift", { name })} aria-label={t("Close {name}'s shift", { name })} className="text-muted-foreground hover:text-rose-500" onClick={() => setOpen(true)}><ShieldAlert /></Button>
        : <Button variant="outline" size="sm" className={onDark ? "border-white/25 bg-white/10 text-white hover:bg-white/15 hover:text-white" : undefined} onClick={() => setOpen(true)}><ShieldAlert />{t("Close this shift")}</Button>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader icon={<ShieldAlert />} eyebrow={t("Reception shift")} tone="gold"><DialogTitle>{t("Close {name}'s shift?", { name })}</DialogTitle>
            <DialogDescription>{t("Only when they cannot close it themselves. Your reason is kept on the shift and in the history; the handover lists what they collected and who still owes.")}</DialogDescription></DialogHeader>
          <div className="space-y-1.5"><Label htmlFor="mr">{t("Why?")}</Label>
            <Textarea id="mr" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("e.g. Left at 15:00 without closing the shift")} autoFocus /></div>
          <DialogFooter>
            <Button disabled={pending || reason.trim().length < 5} onClick={() => start(async () => {
              const r = await closeShiftAsManagerAction({ shiftId, reason });
              if (r.ok) { toast.success(t("{name}'s shift is closed.", { name: r.data.name })); setOpen(false); setReason(""); router.refresh(); } else toast.error(r.error, { duration: 8000 });
            })}>{pending && <Loader2 className="animate-spin" />}{t("Close the shift")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
