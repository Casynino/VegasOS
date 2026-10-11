"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { generateReportAction, regenerateRoomReportAction, revokeRoomReportAction, sendReportAction, sendRoomReportAction, sendRoomReportByDateAction, setRoomReportEnabledAction } from "./actions";
import { useT } from "@/i18n/client";

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
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <Button variant={force ? "outline" : "default"} disabled={pending} className={className} onClick={() => start(async () => {
      const r = await sendReportAction({ reportId, force });
      if (r.ok) { toast.info(r.data.message, { duration: 8000 }); router.refresh(); } else toast.error(r.error);
    })}>{pending ? <Loader2 className="animate-spin" /> : <Send />}{label ?? (force ? t("Send again") : t("Send / retry failed"))}</Button>
  );
}

export function SendRoomReportButton({ reportId, force, className }: { reportId: string; force?: boolean; className?: string }) {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={pending} className={className} onClick={() => start(async () => {
      const r = await sendRoomReportAction({ reportId, force });
      if (r.ok) { toast.info(r.data.message, { duration: 8000 }); router.refresh(); } else toast.error(r.error);
    })}>{pending ? <Loader2 className="animate-spin" /> : <Send />}{force ? t("Room report again") : t("Send room report")}</Button>
  );
}

export function SendRoomReportByDateButton({ date, force, className }: { date: string; force?: boolean; className?: string }) {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <Button variant="outline" disabled={pending} className={className} onClick={() => start(async () => {
      const r = await sendRoomReportByDateAction({ date, force });
      if (r.ok) { toast.info(r.data.message, { duration: 8000 }); router.refresh(); } else toast.error(r.error);
    })}>{pending ? <Loader2 className="animate-spin" /> : <Send />}{force ? t("Room report again") : t("Send room report")}</Button>
  );
}

/** Resend, regenerate (with a reason) and switch off the link — for one day's room report. */
export function RoomReportAdminButtons({ date, sent, revoked }: { date: string; sent: boolean; revoked: boolean }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const done = (r: { ok: true; data: unknown; message?: string } | { ok: false; error: string }, ok: string) => { if (r.ok) { toast.success(ok); router.refresh(); } else toast.error(r.error); };
  return (
    <>
      <SendRoomReportByDateButton date={date} force={sent} className="h-9 text-xs" />
      <Button variant="outline" className="h-9 text-xs" disabled={pending} onClick={() => setOpen(true)}><RefreshCw />Regenerate</Button>
      {!revoked && <Button variant="outline" className="h-9 text-xs" disabled={pending} onClick={() => start(async () => done(await revokeRoomReportAction({ date }), "Link switched off."))}>Switch link off</Button>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<RefreshCw />} eyebrow="Room report" tone="violet">
            <DialogTitle>Regenerate this room report?</DialogTitle>
            <DialogDescription>It is rebuilt from the records now. The current version is kept in its history and the link stays the same.</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder="Why? e.g. a late payment was recorded" />
          <Button disabled={pending || reason.trim().length < 5} onClick={() => start(async () => { const r = await regenerateRoomReportAction({ date, reason }); done(r, "New version made."); if (r.ok) { setOpen(false); setReason(""); } })}>{pending && <Loader2 className="animate-spin" />}Make a new version</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** MD / owner: regenerate a day's report — asks why; the earlier version is kept. */
export function RegenerateReportButton({ date, className }: { date: string; className?: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const t = useT();
  const go = () => start(async () => {
    const r = await generateReportAction({ date, reason });
    if (r.ok) { toast.success(t("New version made — the earlier one is kept.")); setOpen(false); setReason(""); router.refresh(); } else toast.error(r.error);
  });
  return (
    <>
      <Button variant="outline" className={className} onClick={() => setOpen(true)}><RefreshCw />{t("Regenerate")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<RefreshCw />} eyebrow={t("Daily report")} tone="violet">
            <DialogTitle>{t("Regenerate this report?")}</DialogTitle>
            <DialogDescription>{t("It is rebuilt from today's records. The current version stays in the report's history with who replaced it and why.")}</DialogDescription>
          </DialogHeader>
          <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} placeholder={t("Why? e.g. a payment was recorded late and corrected")} />
          <Button disabled={pending || reason.trim().length < 5} onClick={go}>{pending && <Loader2 className="animate-spin" />}{t("Make a new version")}</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function RoomReportSwitch({ enabled, canChange }: { enabled: boolean; canChange: boolean }) {
  const router = useRouter();
  const t = useT();
  const [pending, start] = useTransition();
  return (
    <Button variant={enabled ? "outline" : "default"} disabled={!canChange || pending} className="h-9 text-xs" onClick={() => start(async () => {
      const r = await setRoomReportEnabledAction({ enabled: !enabled });
      if (r.ok) { toast.info(!enabled ? t("Automatic room report is on.") : t("Automatic room report is off.")); router.refresh(); } else toast.error(r.error);
    })}>{pending ? <Loader2 className="animate-spin" /> : null}{enabled ? t("Switch automatic report off") : t("Switch automatic report on")}</Button>
  );
}
