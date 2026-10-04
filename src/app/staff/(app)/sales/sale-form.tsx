"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, X } from "lucide-react";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { recordSaleAction, voidSaleAction } from "./actions";

export function SaleForm({ categories, methods, rooms = [] }: { categories: { id: string; name: string }[]; methods: { id: string; name: string; number?: string | null }[]; rooms?: { id: string; label: string }[] }) {
  const router = useRouter();
  return (
    <ActionForm action={recordSaleAction} resetOnSuccess onSuccess={() => router.refresh()} className="space-y-3">
      {({ pending, fieldErrors: e }) => (
        <>
          <div className="space-y-1"><Label htmlFor="cat">Where</Label>
            <NativeSelect id="cat" name="categoryId" defaultValue={categories[0]?.id}>{categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</NativeSelect></div>
          <div className="space-y-1"><Label htmlFor="amt">Amount (TZS)</Label><Input id="amt" name="amount" type="number" inputMode="numeric" min={1} step={500} /><FieldError message={e?.amount} /></div>
          <div className="space-y-1"><Label htmlFor="pm">Received through</Label>
            <NativeSelect id="pm" name="accountId" defaultValue={methods[0]?.id}>
              <optgroup label="Paid now">{methods.map((m) => <option key={m.id} value={m.id}>{m.name}{m.number ? ` — ${m.number}` : ""}</option>)}</optgroup>
              {rooms.length > 0 && <optgroup label="Charge to a guest's room (pays at checkout)">{rooms.map((r) => <option key={r.id} value={`room:${r.id}`}>{r.label}</option>)}</optgroup>}
            </NativeSelect></div>
          <div className="space-y-1"><Label htmlFor="desc">Description</Label><Input id="desc" name="description" placeholder="e.g. Lunch service total / Table 4" /></div>
          <Button type="submit" className="w-full" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Record sale</Button>
        </>
      )}
    </ActionForm>
  );
}

export function VoidSaleButton({ id }: { id: string }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [asking, setAsking] = useState(false);
  if (!asking) return <Button size="icon-xs" variant="ghost" aria-label="Void sale" onClick={() => setAsking(true)}><X /></Button>;
  return (
    <form className="flex gap-1" onSubmit={(ev) => { ev.preventDefault(); const reason = String(new FormData(ev.currentTarget).get("reason") ?? ""); start(async () => {
      const r = await voidSaleAction({ id, reason }); if (r.ok) { toast.success(r.message); router.refresh(); } else toast.error(r.error); }); }}>
      <Input name="reason" placeholder="Reason" className="h-7 w-32" autoFocus />
      <Button size="xs" variant="destructive" disabled={pending}>Void</Button>
    </form>
  );
}
