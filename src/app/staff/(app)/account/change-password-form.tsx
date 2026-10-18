"use client";

import { Loader2 } from "lucide-react";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { changePasswordAction } from "./actions";
import { useT } from "@/i18n/client";

/**
 * `developer`: this is the Developer's own account, whose password follows the stricter Developer rule on the server (src/lib/developer-password.ts) —
 * so the hint says that rule, in its words. Everyone else sees the staff rule, exactly as before.
 */
export function ChangePasswordForm({ developer = false }: { developer?: boolean }) {
  const t = useT();
  return (
    <ActionForm action={changePasswordAction} resetOnSuccess className="space-y-3">
      {({ pending, fieldErrors: e }) => (
        <>
          <div className="space-y-1.5">
            <Label htmlFor="currentPassword">{t("Current password")}</Label>
            <Input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" required />
            <FieldError message={e?.currentPassword} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="newPassword">{t("New password")}</Label>
            <Input id="newPassword" name="newPassword" type="password" autoComplete="new-password" required />
            <p className="text-xs text-muted-foreground">
              {developer
                ? t("The Developer password needs at least 14 characters, with a capital letter, a small letter, a number and a symbol. It must not be your email, contain the first part of it, or contain an easy word like 'password'.")
                : t("At least 10 characters with letters and numbers.")}
            </p>
            <FieldError message={e?.newPassword} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="confirmPassword">{t("Confirm new password")}</Label>
            <Input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" required />
            <FieldError message={e?.confirmPassword} />
          </div>
          <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{t("Change password")}</Button>
        </>
      )}
    </ActionForm>
  );
}
