"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { generateReportAction, sendReportAction } from "./actions";

export function GenerateReportButton({ date, label, variant = "default", className }: { date: string; label: string; variant?: "default" | "outline"; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant={variant} disabled={pending} className={className} onClick={() => start(async () => {
      const r = await generateReportAction({ date });
      if (r.ok) { toast.success(r.message); router.push(`/staff/reports/daily/${r.data.id}`); router.refresh(); } else toast.error(r.error);
    })}>{pending ? <Loader2 className="animate-spin" /> : <RefreshCw />}{label}</Button>
  );
}

export function SendReportButton({ reportId, force, label, className }: { reportId: string; force?: boolean; label?: string; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant={force ? "outline" : "default"} disabled={pending} className={className} onClick={() => start(async () => {
      const r = await sendReportAction({ reportId, force });
      if (r.ok) { toast.info(r.data.message, { duration: 8000 }); router.refresh(); } else toast.error(r.error);
    })}>{pending ? <Loader2 className="animate-spin" /> : <Send />}{label ?? (force ? "Send again" : "Send / retry failed")}</Button>
  );
}

/** MD / owner: regenerate a day's report — asks why; the earlier version is kept. */
export function RegenerateReportButton({ date, className }: { date: string; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const go = () => start(async () => {
    const r = await generateReportAction({ date, reason });
    if (r.ok) { toast.success("New version made — the earlier one is kept."); setOpen(false); setReason(""); router.refresh(); } else toast.error(r.error);
  });
  return (
    <>
      <Button variant="outline" className={className} onClick={() => setOpen(true)}><RefreshCw />Regenerate</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<RefreshCw />} eyebrow="Daily report" tone="violet">
            <DialogTitle>Regenerate this report?</DialogTitle>
            <DialogDescription>It is rebuilt from today&apos;s records. The current version stays in the report&apos;s history with who replaced it and why.</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why? e.g. a payment was recorded late and corrected" />
          <Button disabled={pending || reason.trim().length < 5} onClick={go}>{pending && <Loader2 className="animate-spin" />}Make a new version</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
