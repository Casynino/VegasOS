"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Loader2, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { makeShiftReportAction, regenerateShiftReportAction, sendShiftReportAction } from "./actions";
import { useT } from "@/i18n/client";

/** The report is not there yet: make it now (still only once). */
export function MakeShiftReportButton({ shiftId, className }: { shiftId: string; className?: string }) {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <Button disabled={pending} className={className} onClick={() => start(async () => {
      const r = await makeShiftReportAction({ shiftId });
      if (r.ok) { toast.success(r.message); router.refresh(); } else toast.error(r.error);
    })}>{pending ? <Loader2 className="animate-spin" /> : <FileText />}{t("Make the report now")}</Button>
  );
}

export function SendShiftReportButton({ reportId, force, label, className }: { reportId: string; force?: boolean; label: string; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant={force ? "outline" : "default"} disabled={pending} className={className} onClick={() => start(async () => {
      const r = await sendShiftReportAction({ reportId, force });
      if (r.ok) { toast.info(r.data.message, { duration: 8000 }); router.refresh(); } else toast.error(r.error);
    })}>{pending ? <Loader2 className="animate-spin" /> : <Send />}{label}</Button>
  );
}

/** MD / owner: rebuild the report from the records — asks why; the earlier version is kept. */
export function RegenerateShiftReportButton({ shiftId, className }: { shiftId: string; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const t = useT();
  const go = () => start(async () => {
    const r = await regenerateShiftReportAction({ shiftId, reason });
    if (r.ok) { toast.success(r.message); setOpen(false); setReason(""); router.refresh(); } else toast.error(r.error);
  });
  return (
    <>
      <Button variant="outline" className={className} onClick={() => setOpen(true)}><RefreshCw />{t("Regenerate")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<RefreshCw />} eyebrow={t("Shift report")} tone="violet">
            <DialogTitle>{t("Regenerate this shift report?")}</DialogTitle>
            <DialogDescription>{t("It is rebuilt from the records of the shift. The current version stays in the report's history with who replaced it and why.")}</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={t("Why? e.g. a payment in this shift was corrected")} />
          <Button disabled={pending || reason.trim().length < 5} onClick={go}>{pending && <Loader2 className="animate-spin" />}{t("Make a new version")}</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
