"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { HandCoins, Loader2, RotateCcw, Send } from "lucide-react";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { HANDOVER_STATUS_TEXT as STATUS_TEXT, HANDOVER_STATUS_TONE as STATUS_TONE } from "@/lib/cash-handover";
import { resubmitHandoverAction, submitHandoverAction } from "./actions";

export type CardRecord = { id: string; at: string; amount: number; refund: boolean; counted: boolean; party: string | null; reference: string | null };
export type CardHandover = {
  id: string; number: string; status: "SUBMITTED" | "ACCEPTED" | "RETURNED" | "REJECTED"; declared: number; expected: number;
  received: number | null; difference: number | null; reviewNote: string | null; submittedAt: string;
};
export type CardData = { start: string; collected: number; refunds: number; expected: number; count: number; rows: CardRecord[]; open: CardHandover[]; recent: CardHandover[] };

/** What the person sees on their Collections page: the cash they have not handed over, and what happened to their earlier handovers. */
export function HandoverCard({ data }: { data: CardData }) {
  const t = useT();
  const returned = data.open.filter((h) => h.status === "RETURNED");
  const waiting = data.open.filter((h) => h.status === "SUBMITTED");
  return (
    <section className="space-y-3 rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]"><HandCoins className="size-3.5" />{t("Cash to hand over")}</p>
          <h2 className="mt-0.5 text-lg font-semibold tracking-tight tabular-nums">{formatTZS(data.expected)}</h2>
          <p className="text-xs text-muted-foreground">{t("Cash you recorded since your last handover — from {time}.", { time: t.dateTime(data.start) })}</p>
        </div>
        <DeclareDialog mode="submit" data={data} />
      </div>

      <dl className="grid grid-cols-3 gap-2 text-sm">
        <Stat label={t("Cash collected")} value={formatTZS(data.collected)} sub={t.plural(data.count, "{n} payment", "{n} payments")} />
        <Stat label={t("Cash refunded")} value={formatTZS(data.refunds)} />
        <Stat label={t("To hand over")} value={formatTZS(data.expected)} strong />
      </dl>

      {data.rows.length > 0 && (
        <details className="group rounded-2xl border border-border/60 bg-muted/20">
          <summary className="cursor-pointer list-none px-3 py-2 text-xs font-medium text-muted-foreground group-open:text-foreground">{t("Show the {n} cash records", { n: data.rows.length })}</summary>
          <ul className="divide-y divide-border/50 px-3 pb-1 text-xs">
            {data.rows.map((r) => (
              <li key={r.id} className={cn("flex items-center justify-between gap-3 py-1.5", !r.counted && "text-muted-foreground line-through")}>
                <span className="min-w-0 truncate"><span className="tabular-nums text-muted-foreground">{t.time(r.at)}</span> · {r.party ?? r.reference ?? t("Sale")}{r.reference && r.party ? ` · ${r.reference}` : ""}</span>
                <span className={cn("shrink-0 font-medium tabular-nums", r.refund && "text-rose-600 dark:text-rose-400")}>{r.refund ? "−" : ""}{formatTZS(r.amount)}</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {returned.map((h) => (
        <div key={h.id} className="space-y-2 rounded-2xl border border-rose-500/30 bg-rose-500/5 p-3 text-sm">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="font-medium">{h.number} · <span className="text-rose-700 dark:text-rose-300">{t(STATUS_TEXT.RETURNED)}</span></p>
            <DeclareDialog mode="resubmit" data={data} handover={h} />
          </div>
          {h.reviewNote && <p className="text-xs text-muted-foreground">{t("Finance says: {note}", { note: h.reviewNote })}</p>}
        </div>
      ))}
      {waiting.map((h) => (
        <p key={h.id} className="flex flex-wrap items-center justify-between gap-2 rounded-2xl border border-border/60 bg-muted/20 px-3 py-2 text-sm">
          <span className="font-medium">{h.number} · {formatTZS(h.declared)}</span>
          <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_TONE.SUBMITTED)}>{t(STATUS_TEXT.SUBMITTED)}</span>
        </p>
      ))}
      {data.recent.length > 0 && (
        <ul className="space-y-1 text-xs text-muted-foreground">
          {data.recent.map((h) => (
            <li key={h.id} className="flex flex-wrap items-center justify-between gap-2">
              <span>{h.number} · {t.dateTime(h.submittedAt)} · {formatTZS(h.status === "ACCEPTED" ? (h.received ?? h.declared) : h.declared)}{h.difference ? ` · ${h.difference < 0 ? t("short") : t("over")} ${formatTZS(Math.abs(h.difference))}` : ""}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium", STATUS_TONE[h.status])}>{t(STATUS_TEXT[h.status])}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function Stat({ label, value, sub, strong }: { label: string; value: string; sub?: string; strong?: boolean }) {
  return (
    <div className={cn("rounded-2xl border border-border/60 px-3 py-2", strong ? "bg-foreground/[0.04]" : "bg-muted/20")}>
      <dt className="text-[11px] text-muted-foreground">{label}</dt>
      <dd className={cn("tabular-nums", strong ? "font-semibold" : "font-medium")}>{value}</dd>
      {sub && <dd className="text-[11px] text-muted-foreground">{sub}</dd>}
    </div>
  );
}

/** Submit a handover (or correct and send again one that was sent back): the summary, what was counted, and why it differs. */
function DeclareDialog({ mode, data, handover }: { mode: "submit" | "resubmit"; data: CardData; handover?: CardHandover }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const expected = mode === "resubmit" && handover ? handover.expected : data.expected;
  const [declared, setDeclared] = useState(String(expected));
  const difference = declared === "" ? null : Math.round(Number(declared)) - expected;
  const action = mode === "submit" ? submitHandoverAction : resubmitHandoverAction;
  return (
    <>
      <Button size={mode === "submit" ? "default" : "sm"} variant={mode === "submit" ? "default" : "outline"} onClick={() => { setDeclared(String(expected)); setOpen(true); }} disabled={mode === "submit" && data.count === 0}>
        {mode === "submit" ? <Send /> : <RotateCcw />}{mode === "submit" ? t("Submit cash handover") : t("Correct and send again")}
      </Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<HandCoins />} eyebrow={t("Cash handover")} tone="emerald">
            <DialogTitle>{mode === "submit" ? t("Hand over your cash") : t("Send {number} again", { number: handover?.number ?? "" })}</DialogTitle>
            <DialogDescription>{t("Count the cash. Finance receives it and confirms the amount.")}</DialogDescription>
          </DialogHeader>
          <ActionForm action={action} onSuccess={() => { setOpen(false); router.refresh(); }} className="space-y-4">
            {({ pending, fieldErrors: e }) => (
              <>
                {handover && <input type="hidden" name="id" value={handover.id} />}
                <dl className="divide-y divide-border/50 rounded-2xl border border-border/60 text-sm">
                  {mode === "submit" && <Line label={t("Cash collected")} value={formatTZS(data.collected)} />}
                  {mode === "submit" && <Line label={t("Cash refunded")} value={`− ${formatTZS(data.refunds)}`} />}
                  <Line label={t("Cash expected")} value={formatTZS(expected)} strong />
                </dl>
                <div className="space-y-1.5">
                  <Label htmlFor="ch-declared">{t("Cash you counted and hand over (TZS)")}</Label>
                  <Input id="ch-declared" name="declared" type="number" min={0} step={1} inputMode="numeric" value={declared} onChange={(ev) => setDeclared(ev.target.value)} className="h-11 text-lg tabular-nums" />
                  <FieldError message={e?.declared} />
                  {difference !== null && difference !== 0 && (
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-300">{difference < 0 ? t("Short by {amount} — say why below.", { amount: formatTZS(-difference) }) : t("Over by {amount} — say why below.", { amount: formatTZS(difference) })}</p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ch-note">{difference ? t("Why is it different?") : t("Note (optional)")}</Label>
                  <Textarea id="ch-note" name="note" rows={3} maxLength={500} />
                  <FieldError message={e?.note} />
                </div>
                <Button type="submit" className="w-full" disabled={pending || declared === ""}>{pending ? <Loader2 className="animate-spin" /> : <Send />}{t("Send to Finance")}</Button>
              </>
            )}
          </ActionForm>
        </DialogContent>
      </Dialog>
    </>
  );
}

function Line({ label, value, strong }: { label: string; value: string; strong?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-3 px-3 py-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className={cn("tabular-nums", strong && "font-semibold")}>{value}</dd>
    </div>
  );
}
