"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Pencil, Plus, Tag } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FREQUENCY_LABEL, type ExpenseFrequency } from "@/lib/expense-catalog";
import { cn } from "@/lib/utils";
import { saveExpenseItemAction } from "@/app/staff/(app)/expenses/actions";

type Data = { id?: string; name: string; categoryId: string; frequency: ExpenseFrequency; defaultPayee: string; defaultAmount: number | ""; isActive: boolean };

export function ExpenseTypeButton({ groups, initial, label }: { groups: { id: string; name: string }[]; initial?: Data; label?: string }) {
  const [open, setOpen] = useState(false);
  const [d, setD] = useState<Data>(initial ?? { name: "", categoryId: groups[0]?.id ?? "", frequency: "OCCASIONAL", defaultPayee: "", defaultAmount: "", isActive: true });
  const [pending, start] = useTransition();
  const router = useRouter();
  const set = <K extends keyof Data>(k: K, v: Data[K]) => setD((x) => ({ ...x, [k]: v }));
  const chip = (on: boolean) => cn("rounded-full border px-3 py-1 text-xs font-medium", on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted");
  function save() {
    start(async () => {
      const res = await saveExpenseItemAction({ ...d });
      if (res.ok) { toast.success(res.message ?? "Saved."); setOpen(false); router.refresh(); } else toast.error(res.error, { duration: 8000 });
    });
  }
  return (
    <>
      {label === "Edit" ? <Button size="sm" variant="ghost" className="h-7 px-2 text-xs" onClick={() => setOpen(true)}><Pencil className="size-3" />Edit</Button>
        : <Button size={label ? "sm" : "default"} variant={label ? "outline" : "default"} onClick={() => setOpen(true)}><Plus />{label ?? "New expense type"}</Button>}
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Tag />} eyebrow="Expense settings" tone="amber"><DialogTitle>{d.id ? "Edit expense type" : "New expense type"}</DialogTitle><DialogDescription>Staff pick it when recording an expense.</DialogDescription></DialogHeader>
          <div className="space-y-3">
            <div className="space-y-1.5"><Label htmlFor="et-name">Name</Label><Input id="et-name" value={d.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Swimming pool chemicals" /></div>
            <div className="space-y-1.5"><Label htmlFor="et-group">Group</Label>
              <NativeSelect id="et-group" value={d.categoryId} onChange={(e) => set("categoryId", e.target.value)}>{groups.map((g) => <option key={g.id} value={g.id}>{g.name}</option>)}</NativeSelect></div>
            <div className="space-y-1.5"><Label>How often</Label>
              <div className="flex flex-wrap gap-1.5">{(["DAILY", "MONTHLY", "OCCASIONAL"] as const).map((f) => <button key={f} type="button" className={chip(d.frequency === f)} onClick={() => set("frequency", f)}>{FREQUENCY_LABEL[f]}</button>)}</div>
              <p className="text-[11px] text-muted-foreground">“Monthly bill” types show on the monthly bills checklist.</p></div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><Label htmlFor="et-payee">Usually paid to</Label><Input id="et-payee" value={d.defaultPayee} onChange={(e) => set("defaultPayee", e.target.value)} /></div>
              <div className="space-y-1.5"><Label htmlFor="et-amount">Usual amount</Label><Input id="et-amount" type="number" min={0} step={1000} value={d.defaultAmount} onChange={(e) => set("defaultAmount", e.target.value === "" ? "" : Math.max(0, Math.round(Number(e.target.value))))} /></div>
            </div>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={d.isActive} onChange={(e) => set("isActive", e.target.checked)} />Show in the list</label>
            <Button className="w-full" disabled={pending || d.name.trim().length < 2} onClick={save}>{pending && <Loader2 className="animate-spin" />}Save</Button>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
