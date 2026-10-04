"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Download, Loader2, Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { makeThankYouAction } from "./actions";

export function PrintNote({ label = "Print", pdf = false }: { label?: string; pdf?: boolean }) {
  return (
    <Button variant={pdf ? "outline" : "default"} onClick={() => window.print()} title={pdf ? "Choose “Save as PDF” in the print window" : undefined}>
      {pdf ? <Download /> : <Printer />}{label}
    </Button>
  );
}

/** First note for an older stay, or a new version after an authorized correction (reason kept). */
export function MakeNote({ reservationId, again }: { reservationId: string; again: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const go = () => start(async () => {
    const res = await makeThankYouAction({ reservationId, reason: again ? reason : undefined });
    if (res.ok) { toast.success(again ? `Version ${res.data.version} made — the earlier one is kept.` : "Thank-you note ready."); setOpen(false); setReason(""); router.replace(`/staff/reservations/${reservationId}/thank-you`); router.refresh(); }
    else toast.error(res.error, { duration: 8000 });
  });
  if (!again) return <Button onClick={go} disabled={pending}>{pending && <Loader2 className="animate-spin" />}Make the thank-you note</Button>;
  return (
    <>
      <Button variant="ghost" onClick={() => setOpen(true)}><RefreshCw />Make again</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<RefreshCw />} eyebrow="Thank-you note" tone="sky">
            <DialogTitle>Make the note again?</DialogTitle>
            <DialogDescription>Only after an authorized correction to the stay. A new version is made from the stay as it is now; the earlier version is kept in the history.</DialogDescription>
          </DialogHeader>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? e.g. bar charge corrected after check-out" />
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>Back</Button><Button disabled={pending || reason.trim().length < 3} onClick={go}>{pending && <Loader2 className="animate-spin" />}Make version</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
