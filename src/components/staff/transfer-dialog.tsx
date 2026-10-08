"use client";

import { useEffect, useState, useTransition } from "react";
import { ArrowRight, ArrowRightLeft, Check, Loader2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Initials } from "@/components/dashboard/kit";
import { cn } from "@/lib/utils";
import { colleaguesAction } from "@/app/staff/(app)/restaurant/waiter-actions";
import { useIsRestaurantDevice } from "./waiter-pin";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";

type Colleague = { id: string; name: string; number?: string | null; onShiftSince: string | null };
const first = (n: string) => n.replace(/\s*\(.*\)/, "").trim().split(/\s+/)[0];

/**
 * Hand work to a colleague: pick who (waiters on shift first — a manager may pick anyone) and say
 * why. `onTransfer` runs the action (with the PIN on the restaurant screen) and returns its result.
 *
 *   <TransferDialog open={open} onOpenChange={setOpen} title="Transfer order #12" what="Order #12 · Table 4"
 *     anyone={isManager} exceptId={currentWaiterId}
 *     onTransfer={(toWaiterId, reason) => transferOrderAction({ orderId, toWaiterId, reason, pin })} />
 */
export function TransferDialog(props: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string;
  /** One line: what moves (e.g. "Table 4 — Nino and 2 open orders"). */
  what: string;
  /** The waiter who has it now (not offered). */
  exceptId?: string | null;
  /** A manager hands to anyone, on shift or not. */
  anyone?: boolean;
  onTransfer: (toWaiterId: string, reason: string) => Promise<{ ok: true; message?: string } | { ok: false; error: string }>;
  /**
   * Runs before each try, outside the transition — e.g. ask the waiter's PIN on the restaurant screen
   * (the PIN window cannot open inside a running transition). Resolve false to stop.
   */
  beforeTransfer?: () => Promise<boolean>;
  onDone?: () => void;
}) {
  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent className="gap-0 overflow-hidden p-0 sm:max-w-md">
        {/* Mounted only while open: every transfer starts fresh. */}
        {props.open && <TransferBody {...props} />}
      </DialogContent>
    </Dialog>
  );
}

function TransferBody({ onOpenChange, title, what, exceptId, anyone = false, onTransfer, beforeTransfer, onDone }: Parameters<typeof TransferDialog>[0]) {
  const t = useT();
  const [list, setList] = useState<Colleague[] | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();

  useEffect(() => {
    let live = true;
    colleaguesAction().then((r) => { if (!live) return; if (r.ok) setList(r.data); else toast.error(r.error); });
    return () => { live = false; };
  }, []);

  const choices = (list ?? []).filter((w) => w.id !== exceptId);
  const onShift = choices.filter((w) => w.onShiftSince);
  const off = anyone ? choices.filter((w) => !w.onShiftSince) : [];
  const chosen = choices.find((w) => w.id === to);
  // Who has it now: from the list (the Counter, a manager) — or "You" on the waiter's own phone (the list leaves them out).
  const device = useIsRestaurantDevice();
  const from = exceptId ? (list?.find((w) => w.id === exceptId)?.name ?? (list && !device ? "You" : null)) : null;
  const ready = !!to && reason.trim().length >= 3;

  const submit = async () => {
    if (!ready) return;
    if (beforeTransfer && !(await beforeTransfer())) return;
    start(async () => {
      const r = await onTransfer(to!, reason.trim());
      if (r.ok) { toast.success(r.message ?? t("Transferred to {name}.", { name: first(chosen?.name ?? "") })); onOpenChange(false); onDone?.(); }
      else toast.error(r.error, { duration: 8000 });
    });
  };

  return (
    <>
      {/* The content has no padding (p-0): the band starts at the edge without the usual pull-out. */}
      <DialogHeader icon={<ArrowRightLeft />} eyebrow={t("Restaurant")} tone="gold" className="mx-0 mt-0">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription className="truncate">{what}</DialogDescription>
        {/* From → to, at a glance */}
        <div className="mt-2.5 flex items-center gap-2 rounded-2xl bg-white/10 p-2 ring-1 ring-inset ring-white/15">
          <Who name={from} label={t("Now")} />
          <ArrowRight className="size-4 shrink-0 text-[oklch(0.8_0.11_82)]" />
          <Who name={chosen?.name ?? null} label={t("To")} placeholder={t("Pick a waiter")} />
        </div>
      </DialogHeader>

      <div className="max-h-[52vh] space-y-3 overflow-y-auto px-3 py-3">
        {!list ? (
          <div className="grid h-28 place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
        ) : !onShift.length && !off.length ? (
          <p className="mx-2 rounded-2xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">
            {anyone ? t("No other waiter is on shift. A colleague starts their shift first.") : t("No other waiter is on shift. A colleague starts their shift first — or ask a manager.")}
          </p>
        ) : (
          [{ label: msg("On shift"), rows: onShift }, { label: msg("Not on shift"), rows: off }].filter((g) => g.rows.length).map((g) => (
            <div key={g.label}>
              <p className="mb-1 px-2 text-[10.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t(g.label)}</p>
              <ul role="radiogroup" aria-label={t(g.label)} className="space-y-1">
                {g.rows.map((w) => {
                  const on = to === w.id;
                  return (
                    <li key={w.id}>
                      <button type="button" role="radio" aria-checked={on} onClick={() => setTo(w.id)}
                        className={cn("group flex w-full items-center gap-3 rounded-2xl border px-3 py-2.5 text-left transition active:scale-[0.99]",
                          on ? "border-[oklch(0.75_0.12_80/0.65)] bg-[oklch(0.72_0.12_80/0.1)]" : "border-transparent hover:border-border hover:bg-muted/50")}>
                        <span className="relative shrink-0">
                          <Initials name={w.name} className="size-10 text-xs" />
                          {w.onShiftSince && <span className="absolute -bottom-0.5 -right-0.5 size-3 rounded-full border-2 border-popover bg-emerald-500" aria-label={t("On shift")} />}
                        </span>
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className="flex min-w-0 items-baseline gap-2"><span className="truncate text-[15px] font-semibold">{first(w.name)}</span>{w.number && <span className="shrink-0 font-mono text-[11px] text-muted-foreground">{w.number}</span>}</span>
                          <span className="mt-0.5 block truncate text-xs text-muted-foreground">{w.onShiftSince ? t("On shift · since {time}", { time: t.time(w.onShiftSince) }) : t("Not on shift")}</span>
                        </span>
                        <span className={cn("grid size-6 shrink-0 place-items-center rounded-full border-2 transition",
                          on ? "border-[oklch(0.8_0.11_82)] bg-[oklch(0.8_0.11_82)] text-[oklch(0.2_0.03_60)]" : "border-border text-transparent")}><Check className="size-3.5" strokeWidth={3} /></span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </div>
          ))
        )}
      </div>

      <div className="space-y-2.5 border-t border-border/60 px-5 pb-5 pt-4">
        <p className="text-sm font-medium">{t("Why?")}</p>
        <div className="flex flex-wrap gap-1.5">
          {REASONS.map((r) => (
            <button key={r} type="button" onClick={() => setReason(r)}
              className={cn("rounded-full border px-3 py-1 text-xs font-medium transition",
                reason === r ? "border-[oklch(0.75_0.12_80/0.7)] bg-[oklch(0.72_0.12_80/0.14)] text-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground")}>{t(r)}</button>
          ))}
        </div>
        <Textarea id="transfer-reason" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Or say why…")} className="resize-none" />
        <button type="button" disabled={pending || !ready} onClick={submit}
          className="flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-linear-to-b from-[oklch(0.87_0.085_86)] to-[oklch(0.7_0.12_76)] px-4 text-sm font-semibold text-[oklch(0.2_0.03_60)] shadow-[0_10px_24px_-14px_oklch(0.7_0.12_80)] ring-1 ring-inset ring-white/30 transition hover:brightness-105 disabled:opacity-50 disabled:hover:brightness-100">
          {pending ? <Loader2 className="size-4 animate-spin" /> : <ArrowRightLeft className="size-4" />}
          {chosen ? t("Transfer to {name}", { name: first(chosen.name) }) : t("Pick who takes it")}
        </button>
        <p className="text-center text-[11px] text-muted-foreground">{t("The new waiter sees it at once; the reason stays in the history.")}</p>
      </div>
    </>
  );
}

// The reason is saved as written (English) — each chip is shown in the reader's words.
const REASONS = [msg("Going on break"), msg("End of my shift"), msg("Other section"), msg("Too busy right now")];

/** One side of "Now → To" (on the dark header band): the waiter's initials and first name (or a dashed place to pick one). */
function Who({ name, label, placeholder }: { name: string | null; label: string; placeholder?: string }) {
  const t = useT();
  return (
    <span className="flex min-w-0 flex-1 items-center gap-2 rounded-xl px-1.5 py-1">
      {name
        ? <Initials name={name} className="size-8 text-[11px]" />
        : <span className="size-8 shrink-0 rounded-full border-2 border-dashed border-white/30" />}
      <span className="min-w-0 leading-tight">
        <span className="block text-[10px] font-semibold uppercase tracking-[0.14em] text-white/60">{label}</span>
        <span className={cn("block truncate text-sm font-semibold", !name && "font-medium text-white/60")}>{name ? (name === "You" ? t("You") : first(name)) : placeholder ?? "—"}</span>
      </span>
    </span>
  );
}
