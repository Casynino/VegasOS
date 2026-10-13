"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Ban, CheckCircle2, Loader2, RotateCcw } from "lucide-react";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ActionResult } from "@/server/errors";
import { formatTZS } from "@/lib/format";
import { useT } from "@/i18n/client";
import { receiveHandoverAction, rejectHandoverAction, returnHandoverAction } from "../../cash-handover/actions";

type CashAccount = { id: string; name: string };

/** The Accountant's three answers to a handover that is waiting: receive it (what really arrived), send it back, or refuse it. */
export function HandoverActions({ id, number, expected, declared, accountId, accounts, canAcceptDifference }: {
  id: string; number: string; expected: number; declared: number; accountId: string; accounts: CashAccount[]; canAcceptDifference: boolean;
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState<"receive" | "return" | "reject" | null>(null);
  const [received, setReceived] = useState(String(declared));
  const difference = received === "" ? null : Math.round(Number(received)) - expected;
  const done = () => { setOpen(null); router.refresh(); };
  return (
    <div className="flex flex-wrap gap-2">
      <Button onClick={() => { setReceived(String(declared)); setOpen("receive"); }}><CheckCircle2 />{t("Receive the cash")}</Button>
      <Button variant="outline" onClick={() => setOpen("return")}><RotateCcw />{t("Send back to correct")}</Button>
      <Button variant="outline" onClick={() => setOpen("reject")}><Ban />{t("Refuse")}</Button>

      <Dialog open={open === "receive"} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<CheckCircle2 />} eyebrow={number} tone="emerald">
            <DialogTitle>{t("Receive the cash")}</DialogTitle>
            <DialogDescription>{t("Count what was really handed to you. The amount you type is what is recorded.")}</DialogDescription>
          </DialogHeader>
          <ActionForm action={receiveHandoverAction} onSuccess={done} className="space-y-4">
            {({ pending, fieldErrors: e }) => (
              <>
                <input type="hidden" name="id" value={id} />
                <dl className="divide-y divide-border/50 rounded-2xl border border-border/60 text-sm">
                  <div className="flex justify-between gap-3 px-3 py-2"><dt className="text-muted-foreground">{t("Recorded as cash")}</dt><dd className="tabular-nums">{formatTZS(expected)}</dd></div>
                  <div className="flex justify-between gap-3 px-3 py-2"><dt className="text-muted-foreground">{t("Staff say they hand over")}</dt><dd className="tabular-nums">{formatTZS(declared)}</dd></div>
                </dl>
                <div className="space-y-1.5">
                  <Label htmlFor="rc-received">{t("Cash you received (TZS)")}</Label>
                  <Input id="rc-received" name="received" type="number" min={0} step={1} inputMode="numeric" value={received} onChange={(ev) => setReceived(ev.target.value)} className="h-11 text-lg tabular-nums" />
                  <FieldError message={e?.received} />
                  {difference !== null && difference !== 0 && (
                    <p className="text-xs font-medium text-amber-700 dark:text-amber-300">
                      {difference < 0 ? t("Short by {amount} compared with the cash recorded.", { amount: formatTZS(-difference) }) : t("Over by {amount} compared with the cash recorded.", { amount: formatTZS(difference) })}
                      {!canAcceptDifference && ` ${t("You may not accept a difference — send it back instead.")}`}
                    </p>
                  )}
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rc-to">{t("Put the cash into")}</Label>
                  <select id="rc-to" name="toAccountId" defaultValue={accountId} className="h-10 w-full rounded-xl border border-border bg-background px-2 text-sm">
                    {accounts.map((a) => <option key={a.id} value={a.id}>{t(a.name)}</option>)}
                  </select>
                  <p className="text-[11px] text-muted-foreground">{t("The same account is the usual answer. Choose another cash account and the move is written to the ledger as a transfer — never as income.")}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="rc-note">{difference ? t("Why is it different?") : t("Note (optional)")}</Label>
                  <Textarea id="rc-note" name="note" rows={3} maxLength={500} />
                  <FieldError message={e?.note} />
                </div>
                <Button type="submit" className="w-full" disabled={pending || received === ""}>{pending ? <Loader2 className="animate-spin" /> : <CheckCircle2 />}{t("Confirm — cash received")}</Button>
              </>
            )}
          </ActionForm>
        </DialogContent>
      </Dialog>

      <Reason open={open === "return"} onClose={() => setOpen(null)} onDone={done} id={id} number={number} action={returnHandoverAction}
        title={t("Send back to correct")} intro={t("Nothing was received. The person sees your reason and sends it again.")} label={t("What should they correct?")} button={t("Send back")} />
      <Reason open={open === "reject"} onClose={() => setOpen(null)} onDone={done} id={id} number={number} action={rejectHandoverAction}
        title={t("Refuse this handover")} intro={t("Use this for a handover made by mistake or twice. Its cash counts as not handed over again. Only a person's latest handover can be refused.")} label={t("Why is it refused?")} button={t("Refuse handover")} />
    </div>
  );
}

function Reason({ open, onClose, onDone, id, number, action, title, intro, label, button }: {
  open: boolean; onClose: () => void; onDone: () => void; id: string; number: string; title: string; intro: string; label: string; button: string;
  action: (prev: unknown, formData: FormData) => Promise<ActionResult<null>>;
}) {
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader icon={<RotateCcw />} eyebrow={number} tone="emerald"><DialogTitle>{title}</DialogTitle><DialogDescription>{intro}</DialogDescription></DialogHeader>
        <ActionForm action={action} onSuccess={onDone} className="space-y-4">
          {({ pending, fieldErrors: e }) => (
            <>
              <input type="hidden" name="id" value={id} />
              <div className="space-y-1.5"><Label htmlFor={`why-${button}`}>{label}</Label><Textarea id={`why-${button}`} name="reason" rows={3} maxLength={500} /><FieldError message={e?.reason} /></div>
              <Button type="submit" className="w-full" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{button}</Button>
            </>
          )}
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}
