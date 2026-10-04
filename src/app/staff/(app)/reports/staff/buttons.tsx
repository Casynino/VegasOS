"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { FileText, Loader2, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { makePeriodReportAction, sendStaffReportAction } from "./actions";

export function SendStaffReportButton({ reportId, force, label, className }: { reportId: string; force?: boolean; label: string; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant={force ? "outline" : "default"} disabled={pending} className={className} onClick={() => start(async () => {
      const r = await sendStaffReportAction({ reportId, force });
      if (r.ok) { toast.info(r.data.message, { duration: 8000 }); router.refresh(); } else toast.error(r.error);
    })}>{pending ? <Loader2 className="animate-spin" /> : <Send />}{label}</Button>
  );
}

/** The last full week / month has no report yet (it is made on Monday / the 1st): make it now. */
export function MakePeriodReportButton({ kind, label, className }: { kind: "WEEK" | "MONTH"; label: string; className?: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={pending} className={className} onClick={() => start(async () => {
      const r = await makePeriodReportAction({ kind });
      if (!r.ok) { toast.error(r.error); return; }
      if (r.data.id) { toast.success(r.data.message); router.push(`/staff/reports/staff/${r.data.id}`); } else toast.info(r.data.message);
    })}>{pending ? <Loader2 className="animate-spin" /> : <FileText />}{label}</Button>
  );
}
