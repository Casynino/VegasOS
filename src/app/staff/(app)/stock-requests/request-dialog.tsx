"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  Ban, Check, ChevronDown, ClipboardList, CornerUpLeft, Flame, History, Hourglass, Loader2, Paperclip, Pencil, Printer, ShoppingBasket, StickyNote, Target, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { formatTZS } from "@/lib/format";
import {
  eventVerb, num, person, simpleStatusMeta, statusMeta, toBuyQty, when, type PurchaseOptionsView, type StockEventView, type StockReqView, type Viewer,
} from "@/lib/stock-requests";
import { cancelStockRequestAction, reviewStockRequestAction } from "./actions";
import { DeliveryReport } from "../procurement/workspace-actions";
import { DeptIcon, ReasonBox, StatusChip, type Tile, type TileGroup } from "./parts";
import { StockSheet, SheetTools } from "./sheet";
import { LinesTable } from "./lines-table";
import { EditRequest } from "./edit-request";
import { PurchaseForm } from "./purchase-form";
import { CompletedSummary, FinalCheck, PurchaseFacts } from "./final-check";
import { useT } from "@/i18n/client";

type Mode = "view" | "edit" | "resend" | "buy";
type Asking = null | "send-back" | "reject" | "cancel";

const DOT: Record<string, string> = {
  SUBMITTED: "bg-sky-400", SENT_BACK: "bg-orange-400", APPROVED: "bg-amber-400", PURCHASING: "bg-violet-400",
  PENDING_APPROVAL: "bg-fuchsia-400", AWAITING_AUTHORIZATION: "bg-fuchsia-400", ORDERED: "bg-indigo-400", PART_DELIVERED: "bg-violet-400", DELIVERED: "bg-teal-400", COMPLETED: "bg-emerald-400", REJECTED: "bg-rose-400", CANCELLED: "bg-muted-foreground/50",
};

/** A coloured note in the dialog: the manager's note, a correction, a rejection. */
function Notice({ tone, icon: I, title, children }: { tone: "rose" | "orange" | "sky" | "muted"; icon: React.ElementType; title: string; children?: React.ReactNode }) {
  const c = {
    rose: "border-rose-500/40 bg-rose-500/[0.08] [&_svg]:text-rose-500 [&_b]:text-rose-700 dark:[&_b]:text-rose-300",
    orange: "border-orange-500/40 bg-orange-500/[0.08] [&_svg]:text-orange-500 [&_b]:text-orange-700 dark:[&_b]:text-orange-300",
    sky: "border-sky-500/30 bg-sky-500/[0.06] [&_svg]:text-sky-500 [&_b]:text-sky-700 dark:[&_b]:text-sky-300",
    muted: "border-border/70 bg-muted/30 [&_svg]:text-muted-foreground",
  }[tone];
  return (
    <div className={cn("flex gap-3 rounded-2xl border px-4 py-3 text-sm", c)}>
      <I className="mt-0.5 size-4 shrink-0" />
      <p><b className="font-semibold">{title}</b>{children && <> {children}</>}</p>
    </div>
  );
}

/** Who did what, in what role, from which step to which, why — and when. */
function Timeline({ events, simple }: { events: StockEventView[]; simple?: boolean }) {
  const meta = simple ? simpleStatusMeta : statusMeta;
  const t = useT();
  if (!events.length) return null;
  return (
    <section>
      <h3 className="flex items-center gap-2 text-sm font-semibold"><History className="size-4 text-amber-500" />{t("History")}</h3>
      <ol className="mt-2 space-y-2.5 border-l border-border/70 pl-4">
        {events.map((e) => (
          <li key={e.id} className="relative">
            <span aria-hidden className={cn("absolute -left-[21.5px] top-1.5 size-2.5 rounded-full ring-4 ring-popover", DOT[e.to ?? ""] ?? "bg-muted-foreground/50")} />
            <div className="flex items-baseline justify-between gap-3">
              <p className="min-w-0 text-[13px] leading-snug">
                <span className="font-semibold">{e.by ? person(e.by) : t("Someone")}</span>
                {e.role && <span className="text-muted-foreground"> ({t(e.role)})</span>} {t(eventVerb(e))}
                {e.from && e.to && e.from !== e.to && <span className="text-[11.5px] text-muted-foreground"> · {t(meta(e.from).label)} → {t(meta(e.to).label)}</span>}
              </p>
              <time className="shrink-0 text-[11px] tabular-nums text-muted-foreground">{when(e.at, t)}</time>
            </div>
            {e.reason && <p className="mt-0.5 text-xs italic text-foreground/80">“{e.reason}”</p>}
            {e.detail.map((d, i) => <p key={i} className="text-[11.5px] text-muted-foreground">{d}</p>)}
          </li>
        ))}
      </ol>
    </section>
  );
}

/**
 * One request: what was asked and why, the lines (asked · approved · bought, and the money for
 * buyers and approvers), its history, and the next step for whoever is looking — review it,
 * change it, record the purchase, give the final approval.
 */
export function RequestDialog({ r, me, groups, pics, hotel, today, options, onClose }: {
  r: StockReqView; me: Viewer; groups: TileGroup[]; pics: Map<string, Tile>; hotel: string; today: string; options: PurchaseOptionsView | null; onClose: () => void;
}) {
  const t = useT();
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("view");
  const [asking, setAsking] = useState<Asking>(null);
  const [paper, setPaper] = useState(false);
  // Finance's approved budget: the person's estimate unless Finance says otherwise.
  const [budget, setBudget] = useState(r.estimatedTotal != null ? String(r.estimatedTotal) : "");
  const [pending, start] = useTransition();
  const money = me.reviewer || me.buyer;
  const mine = r.byId === me.id;
  const done = (close: boolean) => { router.refresh(); if (close) onClose(); else { setMode("view"); setAsking(null); } };

  const review = (decision: "APPROVE" | "SEND_BACK" | "REJECT", note?: string) => start(async () => {
    const res = await reviewStockRequestAction({ id: r.id, decision, note, approvedBudget: decision === "APPROVE" && budget.trim() ? Math.round(Number(budget)) : null });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(decision === "APPROVE" ? t("{number} approved for purchase.", { number: r.number }) : res.message ?? t("Saved."));
    done(true);
  });
  const cancel = (reason: string) => start(async () => {
    const res = await cancelStockRequestAction({ id: r.id, reason: reason || undefined });
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(res.message ?? t("Request cancelled."));
    done(true);
  });

  const cancelReason = [...r.events].reverse().find((e) => e.to === "CANCELLED")?.reason ?? null;
  const finalCheck = r.status === "PENDING_APPROVAL" && me.reviewer && !!options;
  const canBuy = me.buyer && !!options && (r.status === "APPROVED" || r.status === "PURCHASING");
  const sheetLines = r.lines.map((l) => ({ name: l.name, quantity: toBuyQty(l), unit: l.unit }));

  // What the person looking can do at this step.
  const actions: React.ReactNode[] = [];
  if (r.status === "SUBMITTED" && me.reviewer) {
    actions.push(
      <Button key="ok" className="h-11" disabled={pending} onClick={() => review("APPROVE")}>{pending ? <Loader2 className="animate-spin" /> : <Check />}{t("Approve for purchase")}</Button>,
      <Button key="edit" variant="outline" className="h-11" disabled={pending} onClick={() => setMode("edit")}><Pencil />{t.ctx("stock", "Change")}</Button>,
      <Button key="back" variant="outline" className="h-11" disabled={pending} onClick={() => setAsking("send-back")}><CornerUpLeft />{t("Send back")}</Button>,
    );
  }
  if (r.status === "SENT_BACK" && mine) {
    actions.push(<Button key="resend" className="h-11" disabled={pending} onClick={() => setMode("resend")}><Pencil />{t("Change and send again")}</Button>);
  }
  if (canBuy) {
    actions.push(<Button key="buy" className="h-11" disabled={pending} onClick={() => setMode("buy")}><ShoppingBasket />{r.status === "PURCHASING" ? t("Continue the purchase") : t("Record the purchase")}</Button>);
  }
  if (r.status === "APPROVED" && me.reviewer) {
    actions.push(<Button key="edit" variant="outline" className="h-11" disabled={pending} onClick={() => setMode("edit")}><Pencil />{t.ctx("stock", "Change")}</Button>);
  }
  if (["SUBMITTED", "SENT_BACK", "APPROVED"].includes(r.status) && me.reviewer) {
    actions.push(<Button key="reject" variant="ghost" className="ml-auto h-11 text-rose-600 hover:text-rose-500 dark:text-rose-400 dark:hover:text-rose-300" disabled={pending} onClick={() => setAsking("reject")}><X />{t("Reject")}</Button>);
  }
  if (["SUBMITTED", "SENT_BACK"].includes(r.status) && mine) {
    actions.push(<Button key="cancel" variant="ghost" className={cn("h-11 text-muted-foreground", !me.reviewer && "ml-auto")} disabled={pending} onClick={() => setAsking("cancel")}><Ban />{t("Cancel request")}</Button>);
  }

  // Where it stands, in words, when there is nothing for this person to do.
  const waiting =
    r.status === "SUBMITTED" && !me.reviewer ? t("Waiting for Finance to review it.")
    : r.status === "SENT_BACK" && !mine ? t("Waiting for {name} to change it and send it again.", { name: person(r.by) })
    : r.status === "APPROVED" && !canBuy ? t("Approved by Finance — the Accountant is getting quotations from suppliers.")
    : r.status === "AWAITING_AUTHORIZATION" ? t("The price is above the approved budget — waiting for Finance to authorize it.")
    : r.status === "ORDERED" ? t("Ordered from the supplier — waiting for the delivery.")
    : r.status === "PART_DELIVERED" ? t("Part of the order has arrived — the rest is still to come.")
    : r.status === "DELIVERED" ? t("Everything arrived — the supplier's invoice and payment are being finished.")
    : r.status === "PURCHASING" && !canBuy ? (r.boughtBy ? t("Being bought by {name}.", { name: person(r.boughtBy) }) : t("Being bought."))
    : r.status === "PENDING_APPROVAL" && !finalCheck ? t("Bought — waiting for the manager's final approval.")
    : null;

  // The history and the paper copy — below the lines (and above the final check's buttons).
  const extras = (
    <>
      <Timeline events={r.events} simple={!me.reviewer && !me.buyer} />
      <div>
        <button type="button" onClick={() => setPaper((v) => !v)} aria-expanded={paper}
          className="inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground hover:text-foreground">
          <Printer className="size-4" />{t("Print or save the list")}<ChevronDown className={cn("size-4 transition", paper && "rotate-180")} />
        </button>
        {paper && (
          <div className="mt-2 space-y-2 rounded-2xl bg-muted/30 p-3 sm:p-4">
            <StockSheet id={`stock-sheet-${r.id}`} hotel={hotel} number={r.number} deptName={r.departmentName} by={r.by} at={r.at} urgent={r.urgent}
              reason={r.reason} note={r.note} lines={sheetLines} pics={pics} status={r.status} />
            <SheetTools target={`stock-sheet-${r.id}`} fileName={r.number} />
          </div>
        )}
      </div>
    </>
  );

  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="max-h-[92svh] gap-0 overflow-y-auto p-0 sm:max-w-3xl">
        {/* The content has no padding (p-0): the band starts at the edge without the usual pull-out; mb-4 keeps the body off it. */}
        <DialogHeader icon={<ClipboardList />} eyebrow={t("Purchase request")} tone="amber" className="mx-0 mt-0 mb-4">
          {/* `dark`: on the dark band the status and urgent chips take their night-mode colours. */}
          <DialogTitle className="dark flex flex-wrap items-center gap-2">
            <span className="font-mono">{r.number}</span><StatusChip status={r.status} simple={!me.reviewer && !me.buyer} />
            {(r.urgent || r.priority === "HIGH") && <span className="inline-flex items-center gap-0.5 rounded-full bg-rose-500/12 px-2 py-0.5 text-[11px] font-semibold text-rose-600 dark:text-rose-300"><Flame className="size-3" />{r.urgent ? t("Urgent") : t("High")}</span>}
          </DialogTitle>
          <DialogDescription className="flex flex-wrap items-center gap-x-1.5">
            <DeptIcon code={r.department} className="size-3.5" />{t(r.departmentName)} · {t("asked by {name}", { name: person(r.by) })} · {when(r.at, t)}
            {r.neededBy && <> · {t("needed by {date}", { date: t.date(r.neededBy) })}</>}
          </DialogDescription>
        </DialogHeader>

        {mode === "edit" || mode === "resend" ? (
          <EditRequest r={r} mode={mode === "edit" ? "review" : "resend"} groups={groups} pics={pics}
            onDone={() => done(mode === "resend")} onCancel={() => setMode("view")} />
        ) : mode === "buy" && options ? (
          <PurchaseForm r={r} options={options} today={today} onDone={() => done(false)} onCancel={() => setMode("view")} />
        ) : (
          <>
            <div className="space-y-4 px-5 pb-5">
              {(r.title || r.estimatedTotal != null || r.approvedBudget != null || r.attachments.length > 0) && (
                <div className="space-y-1.5 rounded-xl bg-muted/40 px-3 py-2.5 text-sm">
                  {r.title && <p className="font-medium">{r.title}</p>}
                  <p className="flex flex-wrap gap-x-4 gap-y-0.5 text-muted-foreground">
                    {r.estimatedTotal != null && <span>{t("Estimated cost: {amount} (a guess, not approved)", { amount: formatTZS(r.estimatedTotal) })}</span>}
                    {r.approvedBudget != null && <span className="font-medium text-foreground">{t("Budget approved by Finance: {amount}", { amount: formatTZS(r.approvedBudget) })}</span>}
                  </p>
                  {r.attachments.map((a) => (
                    <a key={a.id} href={`/api/files/${a.id}`} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium underline-offset-4 hover:underline">
                      <Paperclip className="size-3.5" />{a.isPdf ? t("The document") : t("The photo")}
                    </a>
                  ))}
                </div>
              )}
              {r.status === "SUBMITTED" && me.reviewer && (
                <label className="grid gap-1 rounded-xl border border-border/70 px-3 py-2.5 text-xs text-muted-foreground">{t("Approved budget (TZS) — the most it may cost; a quotation above it comes back to you")}
                  <input value={budget} onChange={(e) => setBudget(e.target.value.replace(/[^\d]/g, ""))} inputMode="numeric" placeholder={t("leave empty for no limit set")} className="h-10 rounded-lg border border-border bg-background px-2.5 text-base tabular-nums text-foreground sm:text-sm" />
                </label>
              )}
              {(r.reason || r.note) && (
                <div className="grid gap-2 sm:grid-cols-2">
                  {r.reason && <p className="flex gap-2 rounded-xl bg-muted/40 px-3 py-2 text-sm"><Target className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span><span className="text-muted-foreground">{t("For:")} </span>{r.reason}</span></p>}
                  {r.note && <p className="flex gap-2 rounded-xl bg-muted/40 px-3 py-2 text-sm"><StickyNote className="mt-0.5 size-4 shrink-0 text-muted-foreground" /><span>{r.note}</span></p>}
                </div>
              )}

              {r.status === "SENT_BACK" && (
                <Notice tone="orange" icon={CornerUpLeft} title={mine ? t("Sent back to you — please answer or change it:") : t("Sent back to change:")}>
                  {r.decisionNote ?? "—"}{r.decidedBy && <span className="text-muted-foreground"> — {person(r.decidedBy)}</span>}
                </Notice>
              )}
              {r.status === "PURCHASING" && r.purchase?.correctionNote && (
                <Notice tone="rose" icon={CornerUpLeft} title={t("Sent back for correction:")}>{r.purchase.correctionNote}</Notice>
              )}
              {r.status === "REJECTED" && (
                <Notice tone="rose" icon={X} title={r.decidedBy ? t("Rejected by {name}:", { name: person(r.decidedBy) }) : t("Rejected:")}>{r.decisionNote ?? t("No reason given.")}</Notice>
              )}
              {r.status === "CANCELLED" && (
                <Notice tone="muted" icon={Ban} title={t("Cancelled by {name}.", { name: person(r.by) })}>{cancelReason ?? ""}</Notice>
              )}
              {r.status === "COMPLETED" && <CompletedSummary r={r} money={money} />}
              {waiting && <Notice tone="sky" icon={Hourglass} title={waiting} />}

              {finalCheck && options ? (
                <FinalCheck r={r} options={options} me={me} onDone={() => done(true)} extra={extras} />
              ) : (
                <>
                  <LinesTable lines={r.lines} money={money} />
                  {r.order && (
                    <section className="space-y-2 rounded-2xl border border-border/70 px-4 py-3 text-sm">
                      <h3 className="font-semibold">{t("The order")}</h3>
                      <p className="text-muted-foreground">
                        {r.order.number}{r.order.expectedOn && ` · ${t("expected {date}", { date: t.date(r.order.expectedOn) })}`}{r.order.total != null && ` · ${formatTZS(r.order.total)}`}
                      </p>
                      <ul className="space-y-0.5">
                        {r.lines.filter((l) => l.orderedQty != null).map((l) => (
                          <li key={l.id} className="flex flex-wrap justify-between gap-2"><span>{t(l.name)}</span><span className="tabular-nums text-muted-foreground">{t("{got} of {ordered} {unit} arrived", { got: num(l.receivedQty), ordered: num(l.orderedQty ?? 0), unit: t(l.unit) })}</span></li>
                        ))}
                      </ul>
                      {mine && ["ORDERED", "PART_DELIVERED", "DELIVERED"].includes(r.status) && (
                        <div className="border-t border-border/60 pt-3"><p className="mb-2 font-medium">{t("Is what arrived right?")}</p><DeliveryReport id={r.id} /></div>
                      )}
                    </section>
                  )}
                  {money && (r.status === "PURCHASING" || r.status === "PENDING_APPROVAL" || r.status === "COMPLETED") && <PurchaseFacts r={r} />}
                  {extras}
                </>
              )}
            </div>

            {(actions.length > 0 || asking) && !finalCheck && (
              <div className="sticky bottom-0 border-t border-border/70 bg-popover/95 px-5 py-4 backdrop-blur">
                {asking === "send-back" ? (
                  <ReasonBox placeholder={t("What should they change? e.g. Say how many kg")} action={t("Send back")} tone="default" pending={pending}
                    onConfirm={(why) => review("SEND_BACK", why)} onCancel={() => setAsking(null)} />
                ) : asking === "reject" ? (
                  <ReasonBox placeholder={t("Why? e.g. We still have enough in the store")} action={t("Reject")} pending={pending}
                    onConfirm={(why) => review("REJECT", why)} onCancel={() => setAsking(null)} />
                ) : asking === "cancel" ? (
                  <ReasonBox placeholder={t("Why? (optional) e.g. No longer needed")} action={t("Cancel request")} optional pending={pending}
                    onConfirm={cancel} onCancel={() => setAsking(null)} />
                ) : (
                  <div className="flex flex-wrap gap-2">{actions}</div>
                )}
              </div>
            )}
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
