"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, Lock, Pencil, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { removeCustomerAction } from "../actions";
import { cn } from "@/lib/utils";
import { GuestEditForm, type EditableGuest } from "./guest-edit-form";

export type DetailRow = { label: string; value: string | null; warn?: boolean; mono?: boolean; long?: boolean };

export type Footprint = { stays: number; orders: number; tables: number; history: number };

/** The customer's details as a clean list — "Edit" opens the full form; managers can remove the customer. */
export function GuestDetails({ rows, guest, canEdit, canVip, canIdentity, footprint }: {
  rows: DetailRow[]; guest: EditableGuest; canEdit: boolean; canVip: boolean;
  /** Admin / manager: change the name and number, and remove the customer. */
  canIdentity: boolean; footprint: Footprint | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  return (
    <section className="rounded-2xl border border-border/70 bg-card">
      <div className="flex items-center justify-between gap-2 px-4 py-3">
        <h2 className="text-base font-semibold">Details</h2>
        <span className="flex gap-1.5">
          {canIdentity && footprint ? <RemoveCustomer id={guest.id} name={guest.fullName} footprint={footprint} />
            : canEdit && (
              <span title="Your role cannot remove customers or change the name and number" aria-label="Your role cannot remove customers"
                className="relative grid size-8 cursor-not-allowed place-items-center rounded-md text-muted-foreground/50">
                <Trash2 className="size-4" /><Lock className="absolute bottom-1 right-1 size-2.5" />
              </span>
            )}
          {canEdit && <Button size="sm" variant="outline" className="h-8" onClick={() => setOpen(true)}><Pencil />Edit</Button>}
        </span>
      </div>
      <dl className="divide-y divide-border/50 border-t border-border/70 text-sm">
        {rows.map((r) => (
          <div key={r.label} className={cn("gap-3 px-4 py-2.5", r.long ? "block" : "flex items-baseline justify-between")}>
            <dt className="shrink-0 text-muted-foreground">{r.label}</dt>
            <dd className={cn(r.long ? "mt-1 whitespace-pre-line" : "min-w-0 truncate text-right font-medium", r.mono && "font-mono text-[13px]",
              r.warn ? "text-amber-600 dark:text-amber-400" : !r.value && "text-muted-foreground/60")}>{r.value || "—"}</dd>
          </div>
        ))}
      </dl>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[92svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader icon={<Pencil />} eyebrow="Customer" tone="sky">
            <DialogTitle>Edit {guest.fullName}</DialogTitle>
            <DialogDescription>Changes show everywhere this customer appears.</DialogDescription>
          </DialogHeader>
          <GuestEditForm guest={guest} canEdit={canEdit} full canVip={canVip} lockIdentity={!canIdentity} onSaved={() => { setOpen(false); router.refresh(); }} />
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** Admin / manager: remove the customer — gone for good when nothing is on record, otherwise their details are wiped and the books stay. */
function RemoveCustomer({ id, name, footprint: f }: { id: string; name: string; footprint: Footprint }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const kept = [f.stays && `${f.stays} stay${f.stays === 1 ? "" : "s"}`, f.orders && `${f.orders} order${f.orders === 1 ? "" : "s"}`, f.tables && `${f.tables} table visit${f.tables === 1 ? "" : "s"}`].filter(Boolean).join(", ");
  const remove = () => start(async () => {
    const res = await removeCustomerAction(id);
    if (!res.ok) { toast.error(res.error); return; }
    toast.success(res.data.deleted ? `${name} deleted.` : `${name} removed — their records stay in the books.`);
    setOpen(false);
    router.push("/staff/guests");
  });
  return (
    <>
      <Button size="sm" variant="ghost" className="h-8 text-muted-foreground hover:text-rose-500" onClick={() => setOpen(true)} aria-label="Remove customer" title="Remove customer"><Trash2 /></Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Trash2 />} eyebrow="Customer" tone="rose">
            <DialogTitle>Remove {name}?</DialogTitle>
            <DialogDescription>
              {f.history === 0
                ? "Nothing is on record for this customer — they are deleted for good."
                : `They have ${kept || "records"} on record. Those stay in the books as "Removed customer", but the name, phone numbers and details are wiped and they leave every list. Their number becomes free for someone new.`}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>Keep</Button>
            <Button variant="destructive" disabled={pending} onClick={remove}>{pending ? <Loader2 className="animate-spin" /> : <Trash2 />}{f.history === 0 ? "Delete" : "Remove"}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
