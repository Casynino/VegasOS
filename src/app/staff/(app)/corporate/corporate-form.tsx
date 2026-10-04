"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { PAYMENT_TERMS } from "@/lib/billing";
import { cn } from "@/lib/utils";
import { saveCorporateAction } from "./actions";

export type CorporateDefaults = {
  id?: string; companyName: string; contactPerson: string; phone: string; email: string; address: string; billingAddress: string; taxId: string;
  vrn: string; registrationNo: string; creditLimit: number | ""; paymentTermDays: number; billingNotes: string; status: string;
  defaultBillTo: "COMPANY" | "SPLIT"; defaultCovers: string[]; consolidateInvoices: boolean;
};

export const EMPTY_COMPANY: CorporateDefaults = {
  companyName: "", contactPerson: "", phone: "", email: "", address: "", billingAddress: "", taxId: "", vrn: "", registrationNo: "", creditLimit: "",
  paymentTermDays: 30, billingNotes: "", status: "ACTIVE", defaultBillTo: "COMPANY", defaultCovers: ["ROOM"], consolidateInvoices: false,
};

const chip = (on: boolean) => cn("rounded-full border px-3 py-1 text-xs font-medium transition-colors", on ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted");

export function CorporateForm({ c, canEdit, onDone }: { c: CorporateDefaults; canEdit: boolean; onDone?: () => void }) {
  const router = useRouter();
  const [terms, setTerms] = useState(c.paymentTermDays);
  const [consolidate, setConsolidate] = useState(c.consolidateInvoices);
  return (
    <ActionForm action={saveCorporateAction} onSuccess={() => { onDone?.(); router.refresh(); }} className="space-y-5">
      {({ pending, fieldErrors: e }) => (
        <fieldset disabled={!canEdit} className="space-y-5">
          {c.id && <input type="hidden" name="id" value={c.id} />}
          <input type="hidden" name="paymentTermDays" value={terms} />
          <input type="hidden" name="defaultBillTo" value="COMPANY" />
          {consolidate && <input type="hidden" name="consolidateInvoices" value="on" />}

          <section className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1 sm:col-span-2"><Label htmlFor="companyName">Company name</Label><Input id="companyName" name="companyName" defaultValue={c.companyName} placeholder="ABC Company Ltd" /><FieldError message={e?.companyName} /></div>
            <div className="space-y-1"><Label htmlFor="contactPerson">Contact person</Label><Input id="contactPerson" name="contactPerson" defaultValue={c.contactPerson} /></div>
            <div className="space-y-1"><Label htmlFor="phone">Phone</Label><Input id="phone" name="phone" defaultValue={c.phone} /></div>
            <div className="space-y-1"><Label htmlFor="email">Email (invoices go here)</Label><Input id="email" name="email" defaultValue={c.email} /><FieldError message={e?.email} /></div>
            <div className="space-y-1"><Label htmlFor="address">Address</Label><Input id="address" name="address" defaultValue={c.address} /></div>
            <div className="space-y-1 sm:col-span-2"><Label htmlFor="billingAddress">Billing address on invoices <span className="font-normal text-muted-foreground">(one line each; empty = use the address)</span></Label>
              <Textarea id="billingAddress" name="billingAddress" rows={2} defaultValue={c.billingAddress} placeholder={"P.O. Box 1234\nDar es Salaam"} /></div>
            <div className="space-y-1"><Label htmlFor="taxId">TIN</Label><Input id="taxId" name="taxId" defaultValue={c.taxId} /></div>
            <div className="space-y-1"><Label htmlFor="vrn">VRN</Label><Input id="vrn" name="vrn" defaultValue={c.vrn} /></div>
            <div className="space-y-1"><Label htmlFor="registrationNo">Registration no. <span className="font-normal text-muted-foreground">(BRELA, optional)</span></Label><Input id="registrationNo" name="registrationNo" defaultValue={c.registrationNo} /></div>
          </section>

          <section className="space-y-3 rounded-2xl border border-border/70 p-4">
            <p className="text-sm font-semibold">How this company is billed</p>
            <p className="text-[11px] text-muted-foreground">An invoice is always for the whole bill — room, food, drinks and extras.</p>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Payment terms</Label>
              <div className="flex flex-wrap items-center gap-1.5">
                {PAYMENT_TERMS.map((d) => <button key={d} type="button" className={chip(terms === d)} onClick={() => setTerms(d)}>{d === 0 ? "Due immediately" : `${d} days`}</button>)}
                <Input aria-label="Other number of days" type="number" min={0} max={180} value={terms} onChange={(ev) => setTerms(Math.max(0, Math.min(180, Number(ev.target.value) || 0)))} className="h-8 w-20 text-xs" />
              </div>
            </div>
            <div className="space-y-1.5">
              <Label className="text-xs text-muted-foreground">Invoices</Label>
              <div className="flex flex-wrap gap-1.5">
                <button type="button" className={chip(!consolidate)} onClick={() => setConsolidate(false)}>One invoice per stay</button>
                <button type="button" className={chip(consolidate)} onClick={() => setConsolidate(true)}>Collect stays on one invoice (e.g. monthly)</button>
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="space-y-1"><Label htmlFor="creditLimit" className="text-xs text-muted-foreground">Credit limit (TZS) — empty = no limit</Label><Input id="creditLimit" name="creditLimit" type="number" min={0} step={100000} defaultValue={c.creditLimit} /></div>
              <div className="space-y-1"><Label htmlFor="status" className="text-xs text-muted-foreground">Account status</Label>
                <NativeSelect id="status" name="status" defaultValue={c.status}><option value="ACTIVE">Active</option><option value="ON_HOLD">Suspended — no new invoice bookings</option><option value="INACTIVE">Inactive</option></NativeSelect></div>
            </div>
          </section>

          <div className="space-y-1"><Label htmlFor="billingNotes">Notes</Label><Textarea id="billingNotes" name="billingNotes" rows={2} defaultValue={c.billingNotes} placeholder="e.g. Send invoices to accounts@…, LPO number required" /></div>
          {canEdit && <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Save company</Button>}
        </fieldset>
      )}
    </ActionForm>
  );
}
