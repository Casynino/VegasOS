"use client";

import { useEffect, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeft, Loader2, LogOut, ShieldAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Initials } from "@/components/dashboard/kit";
import { cn } from "@/lib/utils";
import { closeWaiterShiftAction, colleaguesAction } from "@/app/staff/(app)/restaurant/waiter-actions";

type Colleague = { id: string; name: string; number?: string | null; onShiftSince: string | null };
const first = (n: string) => n.replace(/\s*\(.*\)/, "").trim().split(/\s+/)[0];
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * A manager closes a waiter's open shift, saying why. When the waiter still has open orders or
 * customers at tables, the manager picks who takes them over — handed on as a transfer, in the history.
 */
export function CloseWaiterShift({ shiftId, name, waiterId, left }: {
  shiftId: string; name: string; waiterId: string;
  /** What the waiter still has (null: nothing — the shift just closes). */
  left: string | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  // Shown at once when work is left — or when the server says some is (it changed meanwhile).
  const [picker, setPicker] = useState(!!left);
  const [leftNow, setLeftNow] = useState(left);
  const [list, setList] = useState<Colleague[] | null>(null);
  const [to, setTo] = useState<string | null>(null);
  const [pending, start] = useTransition();

  useEffect(() => {
    if (!open || !picker || list) return;
    let live = true;
    colleaguesAction().then((r) => { if (!live) return; if (r.ok) setList(r.data); else toast.error(r.error); });
    return () => { live = false; };
  }, [open, picker, list]);

  const choices = (list ?? []).filter((w) => w.id !== waiterId);
  const chosen = choices.find((w) => w.id === to);
  const who = first(name);

  const close = () => start(async () => {
    const r = await closeWaiterShiftAction({ shiftId, reason: reason.trim(), toWaiterId: picker ? to : null });
    if (r.ok) {
      const h = r.data.handed;
      toast.success(`${first(r.data.name)}'s shift is closed.`, {
        description: h ? `Transferred to ${first(h.to)}: ${[h.orders && plural(h.orders, "order"), h.tables && plural(h.tables, "table"), h.rooms && plural(h.rooms, "room")].filter(Boolean).join(", ") || "their work"}.` : undefined,
      });
      setOpen(false); setReason(""); setTo(null);
      router.refresh();
    } else if (/choose the waiter/i.test(r.error)) {
      setPicker(true); setLeftNow(r.error);
    } else toast.error(r.error, { duration: 8000 });
  });

  return (
    <>
      <Button variant="outline" size="sm" onClick={() => setOpen(true)}><ShieldAlert />Close this shift</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<LogOut />} eyebrow="Waiter shift" tone="gold">
            <DialogTitle>Close {who}&apos;s shift?</DialogTitle>
            <DialogDescription>Only when they cannot close it themselves. Your reason is kept on the shift and in the history.</DialogDescription>
          </DialogHeader>

          {picker && (
            <div className="space-y-2.5">
              <p className="flex gap-2 rounded-xl bg-amber-500/12 px-3 py-2 text-xs text-amber-900 dark:text-amber-100">
                <ArrowRightLeft className="mt-0.5 size-3.5 shrink-0" />
                <span>{leftNow && leftNow !== left ? leftNow : `${who} still has ${left ?? "work open"}. Choose the waiter who carries on with it — it is recorded as a transfer, with your reason.`}</span>
              </p>
              {!list ? (
                <div className="grid h-20 place-items-center text-muted-foreground"><Loader2 className="size-5 animate-spin" /></div>
              ) : !choices.length ? (
                <p className="rounded-xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">No other waiter to hand the work to yet.</p>
              ) : (
                [{ label: "On shift", rows: choices.filter((w) => w.onShiftSince) }, { label: "Not on shift", rows: choices.filter((w) => !w.onShiftSince) }].filter((g) => g.rows.length).map((g) => (
                  <div key={g.label}>
                    <p className="mb-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{g.label}</p>
                    <div className="grid grid-cols-2 gap-2">
                      {g.rows.map((w) => (
                        <button key={w.id} type="button" onClick={() => setTo(w.id)} aria-pressed={to === w.id}
                          className={cn("flex items-center gap-2 rounded-xl border px-2.5 py-2 text-left text-sm transition",
                            to === w.id ? "border-primary bg-primary/10 ring-1 ring-primary/40" : "border-border bg-card hover:bg-muted")}>
                          <Initials name={w.name} className="size-7 text-[10px]" />
                          <span className="min-w-0 flex-1 truncate font-medium">{first(w.name)}{w.number && <span className="ml-1.5 font-mono text-[10.5px] font-normal text-muted-foreground">{w.number}</span>}</span>
                          {w.onShiftSince && <span className="size-2 shrink-0 rounded-full bg-emerald-500" aria-label="On shift" />}
                        </button>
                      ))}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <Label htmlFor="wr">Why?</Label>
            <Textarea id="wr" rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Went home at 15:00 without closing the shift" />
          </div>
          <DialogFooter>
            <Button disabled={pending || reason.trim().length < 5 || (picker && !to)} onClick={close}>
              {pending && <Loader2 className="animate-spin" />}Close the shift{picker && chosen ? ` · hand to ${first(chosen.name)}` : ""}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
