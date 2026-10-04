"use client";

import { Loader2 } from "lucide-react";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction } from "./actions";

export function ChangePasswordForm({ first }: { first: boolean }) {
  return (
    <ActionForm action={changePasswordAction} resetOnSuccess className="space-y-3">
      {({ pending, fieldErrors: e }) => (
        <>
          {first && <input type="hidden" name="first" value="1" />}
          {/* The first time: only the new password (they just signed in with the temporary one). */}
          {!first && (
            <div className="space-y-1.5">
              <Label htmlFor="currentPassword">Current password</Label>
              <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
              <FieldError message={e?.currentPassword} />
            </div>
          )}
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">New password</Label>
            <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required />
            <p className="text-xs text-muted-foreground">At least 10 characters with letters and numbers.</p>
            <FieldError message={e?.newPassword} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">Confirm new password</Label>
            <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
            <FieldError message={e?.confirmPassword} />
          </div>
          <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Change password</Button>
        </>
      )}
    </ActionForm>
  );
}
