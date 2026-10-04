"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Power } from "lucide-react";
import { TransferDialog } from "@/components/staff/transfer-dialog";
import { cn } from "@/lib/utils";
import { startWaiterShiftAction } from "../waiter-actions";
import { CloseShiftDialog, type WorkLeft } from "./close-shift";
import type { TransferRequest } from "./shared";

/**
 * A waiter's shift on their Home (the Live board), as one small switch beside the Restaurant QR:
 * on — "Since 08:39" (tap to end it); off — tap to start. Ending it with orders or tables still
 * theirs asks them to hand those over first.
 */
export function WaiterShiftSwitch({ me, shift, left }: {
  me: string;
  shift: { id: string; since: string } | null;
  left: WorkLeft;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [closing, setClosing] = useState(false);
  const [transfer, setTransfer] = useState<TransferRequest | null>(null);
  const [transferOpen, setTransferOpen] = useState(false);

  const askTransfer = (req: TransferRequest) => { if (req.back) setClosing(false); setTransfer(req); setTransferOpen(true); };
  const transferShut = (o: boolean) => { setTransferOpen(o); if (!o && transfer?.back) setClosing(true); };
  const toggle = () => {
    if (shift) { setClosing(true); router.refresh(); return; }
    // A shift closed elsewhere while its dialog was open must not reopen it on the new shift.
    setClosing(false); setTransferOpen(false);
    start(async () => {
      const r = await startWaiterShiftAction();
      if (r.ok) { toast.success(r.message ?? "Your shift has started."); router.refresh(); } else toast.error(r.error, { duration: 8000 });
    });
  };
  const on = !!shift;

  return (
    <>
      <button type="button" role="switch" aria-checked={on} disabled={pending} onClick={toggle}
        aria-label={on ? `On shift since ${shift.since} — tap to end your shift` : "Start my shift"}
        className={cn("group inline-flex h-8 shrink-0 items-center gap-2 rounded-full border bg-card pl-1 pr-3 text-xs font-medium transition-colors disabled:opacity-70 sm:h-9 sm:pl-1.5 sm:pr-3.5 sm:text-sm",
          on ? "border-emerald-500/40 hover:bg-emerald-500/[0.07]" : "border-[oklch(0.75_0.12_80)]/50 hover:bg-[oklch(0.75_0.12_80)]/10")}>
        {/* The switch itself */}
        <span className={cn("relative h-6 w-10 shrink-0 rounded-full transition-colors", on ? "bg-emerald-500" : "bg-muted ring-1 ring-inset ring-border")}>
          <span className={cn("absolute top-0.5 grid size-5 place-items-center rounded-full bg-white shadow-sm transition-all", on ? "left-[1.125rem]" : "left-0.5")}>
            {pending ? <Loader2 className="size-3 animate-spin text-slate-500" /> : <Power className={cn("size-3", on ? "text-emerald-600" : "text-slate-400")} />}
          </span>
        </span>
        {on
          ? <span className="tabular-nums"><strong className="font-semibold text-emerald-700 dark:text-emerald-300">On shift</strong> · since <strong className="font-semibold text-foreground">{shift.since}</strong></span>
          : <span className="font-semibold text-foreground">Start my shift</span>}
      </button>

      {shift && <CloseShiftDialog open={closing && !!shift} onOpenChange={setClosing} left={left} onTransfer={askTransfer} />}
      <TransferDialog open={transferOpen} onOpenChange={transferShut} title={transfer?.title ?? ""} what={transfer?.what ?? ""} exceptId={me}
        onTransfer={(toWaiterId, reason) => transfer ? transfer.run(toWaiterId, reason) : Promise.resolve({ ok: false, error: "Nothing to transfer." })} onDone={() => router.refresh()} />
    </>
  );
}
