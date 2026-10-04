"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Building2, Loader2, Plus, UserPlus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ID_TYPES, type BookingCompany } from "@/lib/company-staff";
import { ACCOUNT_WORD, GROUP_TYPES } from "@/lib/group-types";
import { cn } from "@/lib/utils";

type Kind = BookingCompany["kind"];
import { quickAddCompanyAction } from "@/app/staff/(app)/corporate/actions";

export type PersonDraft = { fullName: string; phone: string; idType: string; idNumber: string };
export const BLANK_PERSON: PersonDraft = { fullName: "", phone: "", idType: "", idNumber: "" };

/** One person: name, phone and — optional — their ID. */
export function PersonRow({ p, onChange, onRemove, label, autoFocus }: {
  p: PersonDraft; onChange: (p: PersonDraft) => void; onRemove?: () => void; label: string; autoFocus?: boolean;
}) {
  return (
    <div className="grid grid-cols-[1fr_auto] gap-1.5 @[34rem]:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_7.5rem_minmax(0,1fr)_auto]">
      <Input autoFocus={autoFocus} value={p.fullName} onChange={(e) => onChange({ ...p, fullName: e.target.value })} placeholder="Full name" aria-label={`${label} — name`} className="h-10 rounded-xl" />
      <button type="button" aria-label={`Remove ${label}`} onClick={onRemove} disabled={!onRemove} className="grid size-10 place-items-center rounded-xl text-muted-foreground hover:bg-muted hover:text-rose-600 disabled:invisible @[34rem]:order-last"><X className="size-4" /></button>
      <div className="col-span-2 grid grid-cols-2 gap-1.5 @[24rem]:grid-cols-[minmax(0,1fr)_7.5rem_minmax(0,1fr)] @[34rem]:contents">
        <Input value={p.phone} onChange={(e) => onChange({ ...p, phone: e.target.value })} placeholder="Phone" inputMode="tel" aria-label={`${label} — phone`} className="col-span-2 h-10 rounded-xl @[24rem]:col-span-1" />
        <select value={p.idType} onChange={(e) => onChange({ ...p, idType: e.target.value })} aria-label={`${label} — ID type (optional)`}
          className="h-10 min-w-0 rounded-xl border border-input bg-transparent px-2 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50 dark:bg-input/30">
          <option value="">ID (optional)</option>
          {ID_TYPES.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <Input value={p.idNumber} onChange={(e) => onChange({ ...p, idNumber: e.target.value })} placeholder="ID number (optional)" aria-label={`${label} — ID number (optional)`} className="h-10 rounded-xl" />
      </div>
    </div>
  );
}

/**
 * Add a company in one simple step — name, contact and its people. Anyone who
 * books can do it; credit limits and suspending stay with managers on the company page.
 */
export function QuickCompanyForm({ onSaved, onCancel, initialName = "", kind: initialKind = "COMPANY", chooseKind = false }: {
  onSaved: (c: BookingCompany) => void; onCancel?: () => void; initialName?: string;
  /** Company, family, organization… — sets the words and where the account is offered. */
  kind?: Kind;
  /** Let staff pick the kind (Companies page); from a booking the kind is the group's. */
  chooseKind?: boolean;
}) {
  const [kind, setKind] = useState<Kind>(initialKind);
  const w = ACCOUNT_WORD[kind];
  const [f, setF] = useState({ companyName: initialName, contactPerson: "", phone: "", email: "", taxId: "", address: "", vrn: "", registrationNo: "" });
  const [people, setPeople] = useState<PersonDraft[]>([{ ...BLANK_PERSON }]);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const field = (k: keyof typeof f, label: string, extra?: React.ComponentProps<typeof Input>) => (
    <label className="space-y-1"><span className="text-xs font-medium">{label}</span>
      <Input value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="h-10 rounded-xl" {...extra} /></label>
  );
  const save = () => {
    if (f.companyName.trim().length < 2) return setError(`Enter the ${w.one} name.`);
    const half = people.find((p) => !p.fullName.trim() && (p.phone.trim() || p.idNumber.trim()));
    if (half) return setError("Every person needs a name (or remove the row).");
    setError(null);
    start(async () => {
      const res = await quickAddCompanyAction({
        ...f, email: f.email.trim(), kind,
        employees: people.filter((p) => p.fullName.trim()).map((p) => ({ fullName: p.fullName.trim(), phone: p.phone.trim() || undefined, idType: p.idType || undefined, idNumber: p.idNumber.trim() || undefined })),
      });
      if (res.ok) { toast.success(`${res.data.companyName} added${res.data.staff.length ? ` with ${res.data.staff.length} ${res.data.staff.length === 1 ? "person" : "people"}` : ""}.`); onSaved(res.data); }
      else setError(res.error);
    });
  };
  return (
    <div className="@container space-y-4">
      {chooseKind && (
        <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label="Kind of account">
          {GROUP_TYPES.map(({ v, label, icon: I }) => (
            <button key={v} type="button" role="radio" aria-checked={kind === v} onClick={() => setKind(v)}
              className={cn("inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium transition-colors", kind === v ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
              <I className="size-3.5" />{label}
            </button>
          ))}
        </div>
      )}
      <div className="grid gap-3 @[30rem]:grid-cols-2">
        <div className="@[30rem]:col-span-2">{field("companyName", `${w.title} name *`, { placeholder: w.placeholder, autoFocus: !initialName })}</div>
        {field("contactPerson", "Contact person", { placeholder: "Who we call" })}
        {field("phone", "Phone", { inputMode: "tel", placeholder: "07XX XXX XXX" })}
        {field("email", "Email (invoices go here)", { type: "email" })}
        {field("taxId", "TIN (optional)")}
      </div>
      <details className="rounded-2xl border border-border/70 px-3 py-2">
        <summary className="cursor-pointer text-xs font-medium">More billing details <span className="font-normal text-muted-foreground">— address, VRN, registration no. (printed on invoices)</span></summary>
        <div className="mt-2 grid gap-3 @[30rem]:grid-cols-3">
          <div className="@[30rem]:col-span-3">{field("address", "Address", { placeholder: "P.O. Box …, Dar es Salaam" })}</div>
          {field("vrn", "VRN")}
          {field("registrationNo", "Registration no.")}
        </div>
      </details>
      <div className="space-y-2 rounded-2xl border border-border/70 bg-muted/20 p-3">
        <p className="flex items-center gap-2 text-sm font-semibold"><UserPlus className="size-4" />{w.people} <span className="text-xs font-normal text-muted-foreground">— picked when you book; ID optional</span></p>
        {people.map((p, i) => (
          <PersonRow key={i} p={p} label={`Person ${i + 1}`} onChange={(np) => setPeople(people.map((x, k) => (k === i ? np : x)))}
            onRemove={people.length > 1 ? () => setPeople(people.filter((_, k) => k !== i)) : undefined} />
        ))}
        <button type="button" onClick={() => setPeople([...people, { ...BLANK_PERSON }])} className="inline-flex items-center gap-1 text-xs font-medium hover:underline"><Plus className="size-3.5" />Another person</button>
      </div>
      {error && <p className="text-sm text-destructive">{error}</p>}
      <div className="flex justify-end gap-2">
        {onCancel && <Button type="button" variant="outline" onClick={onCancel}>Back</Button>}
        <Button type="button" disabled={pending} onClick={save}>{pending ? <Loader2 className="animate-spin" /> : <Building2 />}Save {w.one}</Button>
      </div>
    </div>
  );
}

/** "Add company" as a pop-up (Companies page, booking forms). */
export function QuickCompanyDialog({ open, onOpenChange, onSaved, initialName, kind = "COMPANY", chooseKind = false }: {
  open: boolean; onOpenChange: (o: boolean) => void; onSaved?: (c: BookingCompany) => void; initialName?: string;
  kind?: Kind; chooseKind?: boolean;
}) {
  const router = useRouter();
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-2xl">
        <DialogHeader icon={<Building2 />} eyebrow="Booking account" tone="sky">
          <DialogTitle>{chooseKind ? "New account" : `New ${ACCOUNT_WORD[kind].one}`}</DialogTitle>
          <DialogDescription>Saved once, then picked when you book — its details go on the invoice and its people are offered as guests. Add people now or later.</DialogDescription>
        </DialogHeader>
        {open && <QuickCompanyForm initialName={initialName} kind={kind} chooseKind={chooseKind} onCancel={() => onOpenChange(false)} onSaved={(c) => { onOpenChange(false); router.refresh(); onSaved?.(c); }} />}
      </DialogContent>
    </Dialog>
  );
}
