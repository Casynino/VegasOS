"use client";

import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signOutOtherDevicesAction, updateProfileAction } from "./actions";

/** Name, email and phone. The password field appears only when the email (the login) changes. */
export function ProfileForm({ fullName, email, phone }: { fullName: string; email: string; phone: string | null }) {
  const [newEmail, setNewEmail] = useState(email);
  const emailChanged = newEmail.trim().toLowerCase() !== email.toLowerCase();
  return (
    <ActionForm action={updateProfileAction} className="space-y-4">
      {({ pending, fieldErrors: e }) => (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="fullName">Full name</Label>
            <Input id="fullName" name="fullName" defaultValue={fullName} autoComplete="name" required />
            <FieldError message={e?.fullName} />
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="email">Email (used to sign in)</Label>
              <Input id="email" name="email" type="email" value={newEmail} onChange={(ev) => setNewEmail(ev.target.value)} autoComplete="email" required />
              <FieldError message={e?.email} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="phone">Phone number</Label>
              <Input id="phone" name="phone" type="tel" defaultValue={phone ?? ""} placeholder="0712 345 678" autoComplete="tel" />
              <FieldError message={e?.phone} />
            </div>
          </div>
          {emailChanged && (
            <div className="space-y-1.5 rounded-2xl border border-amber-500/30 bg-amber-500/10 p-3">
              <Label htmlFor="profilePassword">Your password</Label>
              <Input id="profilePassword" name="currentPassword" type="password" autoComplete="current-password" required />
              <p className="text-xs text-muted-foreground">You are changing the email you sign in with, so confirm it&apos;s you. Next time, sign in with the new email.</p>
              <FieldError message={e?.currentPassword} />
            </div>
          )}
          <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Save changes</Button>
        </>
      )}
    </ActionForm>
  );
}

export function SignOutOthersButton({ disabled }: { disabled: boolean }) {
  return (
    <ActionForm action={signOutOtherDevicesAction}>
      {({ pending }) => (
        <Button type="submit" variant="outline" disabled={pending || disabled}>
          {pending ? <Loader2 className="animate-spin" /> : <LogOut />}Sign out other devices
        </Button>
      )}
    </ActionForm>
  );
}
