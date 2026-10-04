"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CircleMinus, Loader2, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { removeOrderItemAction } from "@/app/staff/(app)/restaurant/actions";

const REASONS = ["Changed their mind", "Ordered by mistake", "Finished — not available", "Waited too long"];
const num = (v: number) => v.toLocaleString("en-US");
const shortNo = (n: string) => `#${n.replace(/^ORD-\d{4}-0*/, "")}`;

export type RemovableOrder = { id: string; number: string; customer: string | null; lines: number };
export type RemovableLine = { id: string; name: string; qty: number; /** Unit price (null when not shown). */ price: number | null; made: boolean };

/**
 * Take a line (or some of it) off an open order, with a reason — the bill goes down at once and the
 * reason stays in the order's history. The server decides who may (a made item: a manager; a paid one: never).
 */
export function RemoveItemDialog({ order, line, onClose }: { order: RemovableOrder; line: RemovableLine; onClose: () => void }) {
  const router = useRouter();
  const [n, setN] = useState(1);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const last = order.lines === 1 && n === line.qty;
  const submit = () => start(async () => {
    const res = await removeOrderItemAction({ orderId: order.id, itemId: line.id, quantity: n, reason });
    if (res.ok) { toast.success(`${n} × ${line.name} removed from ${shortNo(order.number)}.`); onClose(); router.refresh(); } else toast.error(res.error);
  });
  return (
    <Dialog open onOpenChange={(v) => { if (!v) onClose(); }}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader icon={<CircleMinus />} eyebrow={`Order ${shortNo(order.number)}`} tone="rose">
          <DialogTitle>Remove {line.name}?</DialogTitle>
          <DialogDescription>From {shortNo(order.number)} · {order.customer ?? "Customer"}. The bill goes down at once and the reason is kept in the order&apos;s history.{line.made ? " The kitchen already made it — this is recorded as a manager's decision." : ""}</DialogDescription>
        </DialogHeader>
        {line.qty > 1 && (
          <div className="flex items-center justify-between rounded-xl border border-border px-3 py-2">
            <span className="text-sm">How many? <span className="text-muted-foreground">(of {line.qty})</span></span>
            <span className="flex items-center gap-2">
              <Button size="icon" variant="outline" className="size-8" disabled={n <= 1} onClick={() => setN(n - 1)} aria-label="Fewer"><Minus /></Button>
              <span className="w-6 text-center font-semibold tabular-nums">{n}</span>
              <Button size="icon" variant="outline" className="size-8" disabled={n >= line.qty} onClick={() => setN(n + 1)} aria-label="More"><Plus /></Button>
            </span>
          </div>
        )}
        <div className="space-y-2">
          <p className="text-sm font-medium">Why?</p>
          <div className="flex flex-wrap gap-1.5">
            {REASONS.map((r) => (
              <button key={r} type="button" onClick={() => setReason(r)} className={cn("rounded-full border px-3 py-1 text-xs font-medium transition", reason === r ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>{r}</button>
            ))}
          </div>
          <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} placeholder="Or write the reason" />
        </div>
        {last && <p className="rounded-xl bg-amber-500/10 px-3 py-2 text-xs text-amber-200">That is everything on this order — decline or cancel the order instead.</p>}
        <div className="flex gap-2">
          <Button variant="destructive" disabled={pending || !reason.trim() || last} onClick={submit}>{pending ? <Loader2 className="animate-spin" /> : <CircleMinus />}Remove {n} × {line.name}{line.price ? ` (−${num(line.price * n)})` : ""}</Button>
          <Button variant="ghost" onClick={onClose}>Keep it</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
