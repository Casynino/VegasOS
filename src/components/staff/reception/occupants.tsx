"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Loader2, Plus, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { addOccupantAction, removeOccupantAction } from "@/app/staff/(app)/groups/actions";

export type Occupant = { id: string; fullName: string; phone: string | null; idNumber: string | null; nationality: string | null };

/** Other people sharing this room (spouse, children, colleague) — the main guest stays the booking's guest. */
export function Occupants({ reservationId, occupants, canEdit }: { reservationId: string; occupants: Occupant[]; canEdit: boolean }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ fullName: "", phone: "", idNumber: "", nationality: "" });
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.value }));
  const add = () => start(async () => {
    const res = await addOccupantAction({ reservationId, ...f });
    if (res.ok) { toast.success(`${f.fullName} added to the room.`); setF({ fullName: "", phone: "", idNumber: "", nationality: "" }); setOpen(false); router.refresh(); }
    else toast.error(res.error);
  });
  const remove = (o: Occupant) => start(async () => {
    const res = await removeOccupantAction({ reservationId, guestId: o.id });
    if (res.ok) { toast.success(`${o.fullName} removed.`); router.refresh(); } else toast.error(res.error);
  });

  return (
    <div className="mt-4 space-y-2 border-t border-dashed border-border pt-4">
      <p className="flex items-center justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
        Also in the room{occupants.length ? ` · ${occupants.length}` : ""}
        {canEdit && !open && <button type="button" onClick={() => setOpen(true)} className="inline-flex items-center gap-1 normal-case tracking-normal text-foreground hover:underline"><UserPlus className="size-3.5" />Add guest</button>}
      </p>
      {occupants.length === 0 && !open && <p className="text-xs text-muted-foreground">Only the main guest.</p>}
      <ul className="space-y-1.5">
        {occupants.map((o) => (
          <li key={o.id} className="flex items-center gap-2 rounded-xl bg-muted/50 px-3 py-2 text-sm">
            <span className="min-w-0 flex-1 truncate font-medium">{o.fullName}</span>
            <span className="truncate text-xs text-muted-foreground">{[o.phone, o.idNumber, o.nationality].filter(Boolean).join(" · ")}</span>
            {canEdit && <button type="button" aria-label={`Remove ${o.fullName}`} disabled={pending} onClick={() => remove(o)} className="grid size-6 place-items-center rounded-md text-muted-foreground hover:bg-muted hover:text-rose-600"><X className="size-3.5" /></button>}
          </li>
        ))}
      </ul>
      {open && (
        <div className="grid gap-2 rounded-xl border border-border/70 p-3 sm:grid-cols-2">
          <Input aria-label="Full name" placeholder="Full name *" value={f.fullName} onChange={set("fullName")} autoFocus />
          <Input aria-label="Phone" placeholder="Phone (optional)" value={f.phone} onChange={set("phone")} inputMode="tel" />
          <Input aria-label="ID / passport" placeholder="ID / passport (optional)" value={f.idNumber} onChange={set("idNumber")} />
          <Input aria-label="Nationality" placeholder="Nationality (optional)" value={f.nationality} onChange={set("nationality")} />
          <div className="flex gap-2 sm:col-span-2">
            <Button size="sm" disabled={pending || f.fullName.trim().length < 2} onClick={add}>{pending ? <Loader2 className="animate-spin" /> : <Plus />}Add to room</Button>
            <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
          </div>
        </div>
      )}
    </div>
  );
}
