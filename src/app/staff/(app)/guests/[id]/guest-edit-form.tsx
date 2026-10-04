"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { IdPicker, NationalityPicker } from "@/components/staff/id-nationality";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { updateGuestAction } from "../actions";

export type EditableGuest = G;
type G = {
  id: string; fullName: string; phone: string; email: string; idType: string; idNumber: string; nationality: string; address: string; notes: string;
  altPhone?: string; dateOfBirth?: string; preferredChannel?: string; marketingConsent?: boolean; vip?: boolean; tags?: string[]; preferences?: string;
};

/**
 * Edit a customer. The short form (on a booking) has the basics; `full` (the
 * profile page) adds the second phone, birthday, how they like to be contacted,
 * offers consent, VIP (managers) and tags.
 */
export function GuestEditForm({ guest, canEdit, full = false, canVip = false, onSaved, lockIdentity = false }: {
  guest: G; canEdit: boolean; full?: boolean; canVip?: boolean; onSaved?: () => void;
  /** The name and number are who the customer is: only a manager or admin changes them (a missing number can still be added). */
  lockIdentity?: boolean;
}) {
  const [id, setId] = useState({ type: guest.idType, number: guest.idNumber });
  const [nationality, setNationality] = useState(guest.nationality);
  return (
    <ActionForm action={updateGuestAction} className="space-y-2.5" onSuccess={onSaved}>
      {({ pending, fieldErrors: e }) => (
        <fieldset disabled={!canEdit} className="space-y-3">
          <input type="hidden" name="id" value={guest.id} />
          {full && <input type="hidden" name="full" value="1" />}
          <div className="space-y-1"><Label htmlFor="fullName">Full name</Label><Input id="fullName" name="fullName" defaultValue={guest.fullName} readOnly={lockIdentity} className={lockIdentity ? "opacity-70" : undefined} /><FieldError message={e?.fullName} /></div>
          <div className={full ? "grid grid-cols-2 gap-2" : ""}>
            <div className="space-y-1"><Label htmlFor="phone">Phone</Label><Input id="phone" name="phone" type="tel" defaultValue={guest.phone} readOnly={lockIdentity && !!guest.phone} className={lockIdentity && guest.phone ? "opacity-70" : undefined} /><FieldError message={e?.phone} /></div>
            {full && <div className="space-y-1"><Label htmlFor="altPhone">Other phone</Label><Input id="altPhone" name="altPhone" type="tel" defaultValue={guest.altPhone ?? ""} readOnly={lockIdentity && !!guest.altPhone} className={lockIdentity && guest.altPhone ? "opacity-70" : undefined} /><FieldError message={e?.altPhone} /></div>}
          </div>
          <div className="space-y-1"><Label htmlFor="email">Email</Label><Input id="email" name="email" defaultValue={guest.email} /><FieldError message={e?.email} /></div>
          <div className="space-y-1"><Label htmlFor={`idNumber-${guest.id}`}>ID</Label>
            <input type="hidden" name="idType" value={id.type} /><input type="hidden" name="idNumber" value={id.number} />
            <IdPicker size="sm" numberId={`idNumber-${guest.id}`} type={id.type} number={id.number}
              onType={(v) => setId((x) => ({ ...x, type: v }))} onNumber={(v) => setId((x) => ({ ...x, number: v }))} /></div>
          <div className="space-y-1"><Label>Nationality</Label>
            <input type="hidden" name="nationality" value={nationality} />
            <NationalityPicker size="sm" value={nationality} onChange={setNationality} /></div>
          {full && <div className="space-y-1"><Label htmlFor="dateOfBirth">Birthday</Label><Input id="dateOfBirth" name="dateOfBirth" type="date" defaultValue={guest.dateOfBirth ?? ""} /></div>}
          <div className="space-y-1"><Label htmlFor="address">Address</Label><Input id="address" name="address" defaultValue={guest.address} /></div>
          {full && (
            <>
              <div className="space-y-1"><Label htmlFor="preferredChannel">Best way to reach them</Label>
                <NativeSelect id="preferredChannel" name="preferredChannel" defaultValue={guest.preferredChannel ?? ""}>
                  <option value="">—</option><option value="WHATSAPP">WhatsApp</option><option value="SMS">SMS</option><option value="CALL">Phone call</option><option value="EMAIL">Email</option>
                </NativeSelect></div>
              <div className="space-y-1"><Label htmlFor="preferences">Preferences</Label><Textarea id="preferences" name="preferences" rows={2} defaultValue={guest.preferences ?? ""} placeholder="Quiet room, extra pillows, no pork…" /></div>
              <div className="space-y-1"><Label htmlFor="tags">Tags</Label><Input id="tags" name="tags" defaultValue={(guest.tags ?? []).join(", ")} placeholder="Business, Regular, Family…" /></div>
              <label className="flex items-start gap-2.5 rounded-xl border border-border/70 p-2.5 text-sm">
                <input type="checkbox" name="marketingConsent" defaultChecked={guest.marketingConsent} className="mt-0.5 size-4 accent-[oklch(0.62_0.13_78)]" />
                <span className="leading-tight"><span className="font-medium">Agrees to offers &amp; promotions</span><span className="block text-xs text-muted-foreground">Booking messages are always sent — they are part of the stay.</span></span>
              </label>
              {canVip && (
                <label className="flex items-center gap-2.5 rounded-xl border border-[oklch(0.75_0.13_80)]/50 bg-[oklch(0.75_0.13_80)]/[0.07] p-2.5 text-sm">
                  <input type="checkbox" name="vip" defaultChecked={guest.vip} className="size-4 accent-[oklch(0.62_0.13_78)]" />
                  <span className="font-medium">VIP guest</span>
                </label>
              )}
            </>
          )}
          <div className="space-y-1"><Label htmlFor="notes">Staff notes</Label><Textarea id="notes" name="notes" rows={3} defaultValue={guest.notes} /></div>
          {lockIdentity && <p className="text-xs text-muted-foreground">Your role cannot change the name or phone number.</p>}
          {canEdit && <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Save</Button>}
        </fieldset>
      )}
    </ActionForm>
  );
}
