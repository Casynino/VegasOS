"use client";

import { useState } from "react";
import { Check, Copy, Eye, EyeOff, Loader2, RefreshCw, UserPlus } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n/client";
import { cn } from "@/lib/utils";
import { AccessForm, FormProblem } from "./access-form";
import { addAccountAction } from "./actions";

export interface RoleChoice { id: string; name: string }

// A readable alphabet: no 0 / O, no 1 / l / I.
const UPPER = "ABCDEFGHJKLMNPQRSTUVWXYZ";
const LOWER = "abcdefghijkmnpqrstuvwxyz";
const DIGITS = "23456789";

/** A fair random number below n from the browser's secure source. */
function randomBelow(n: number): number {
  const one = new Uint32Array(1);
  const limit = Math.floor(0x100000000 / n) * n;
  do crypto.getRandomValues(one); while (one[0] >= limit);
  return one[0] % n;
}

/** A temporary password: 12 readable characters with a capital, a small letter and a number (it passes the staff rule). */
export function makeTemporaryPassword(): string {
  const all = UPPER + LOWER + DIGITS;
  for (;;) {
    const made = Array.from({ length: 12 }, () => all[randomBelow(all.length)]).join("");
    if (/[A-Z]/.test(made) && /[a-z]/.test(made) && /[0-9]/.test(made)) return made;
  }
}

/** "Add an account" — a button for the page's heading and the dialog it opens. */
export function AddAccountButton({ roles }: { roles: RoleChoice[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  if (!roles.length) return null;
  return (
    <>
      <Button onClick={() => { setRound((n) => n + 1); setOpen(true); }}><UserPlus />{t("Add an account")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <AddAccountForm key={round} roles={roles} close={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function AddAccountForm({ roles, close }: { roles: RoleChoice[]; close: () => void }) {
  const t = useT();
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [roleId, setRoleId] = useState("");
  const [password, setPassword] = useState(() => makeTemporaryPassword());
  const [show, setShow] = useState(false);
  const [made, setMade] = useState<{ fullName: string; email: string; password: string } | null>(null);
  const [copied, setCopied] = useState(false);

  if (made) {
    const text = `${t("Email")}: ${made.email}\n${t("Temporary password")}: ${made.password}`;
    return (
      <>
        <DialogHeader icon={<Check />} eyebrow={t("Access")} tone="violet">
          <DialogTitle>{t("Account created")}</DialogTitle>
          <DialogDescription>{t("Give {name} this email and password. They should change the password after their first sign-in.", { name: made.fullName })}</DialogDescription>
        </DialogHeader>
        <dl className="space-y-2 rounded-xl border border-border bg-muted/40 p-3 text-sm">
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">{t("Email")}</dt><dd className="min-w-0 truncate font-medium">{made.email}</dd></div>
          <div className="flex items-baseline justify-between gap-3"><dt className="text-muted-foreground">{t("Temporary password")}</dt><dd className="font-mono text-base font-semibold tracking-wide">{made.password}</dd></div>
        </dl>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={async () => {
            try { await navigator.clipboard.writeText(text); setCopied(true); toast.success(t("Copied")); } catch { toast.error(t("Could not copy. Select the text and copy it.")); }
          }}>{copied ? <Check /> : <Copy />}{t("Copy")}</Button>
          <Button type="button" onClick={close}>{t("Done")}</Button>
        </DialogFooter>
      </>
    );
  }

  const ready = fullName.trim().length >= 2 && email.includes("@") && !!roleId && password.length >= 10;
  return (
    <>
      <DialogHeader icon={<UserPlus />} eyebrow={t("Access")} tone="violet">
        <DialogTitle>{t("Add an account")}</DialogTitle>
      </DialogHeader>
      <AccessForm action={addAccountAction} onSuccess={() => setMade({ fullName: fullName.trim(), email: email.trim().toLowerCase(), password })} className="space-y-3">
        {({ pending, error, fieldErrors: e }) => (
          <>
            <div className="space-y-1.5">
              <Label htmlFor="add-fullName">{t("Full name")}</Label>
              <Input id="add-fullName" name="fullName" value={fullName} onChange={(ev) => setFullName(ev.target.value)} maxLength={100} autoComplete="off" placeholder={t("e.g. Asha Juma")} aria-invalid={!!e?.fullName} />
              {e?.fullName && <p className="text-xs text-destructive">{e.fullName}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-email">{t("Email")}</Label>
              <Input id="add-email" name="email" type="email" value={email} onChange={(ev) => setEmail(ev.target.value)} autoComplete="off" placeholder="name@company.com" aria-invalid={!!e?.email} />
              {e?.email && <p className="text-xs text-destructive">{e.email}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-phone">{t("Phone (optional)")}</Label>
              <Input id="add-phone" name="phone" value={phone} onChange={(ev) => setPhone(ev.target.value)} maxLength={30} autoComplete="off" placeholder="+255..." />
            </div>
            <div className="space-y-1.5">
              <Label id="add-role-label">{t("Role")}</Label>
              <div role="radiogroup" aria-labelledby="add-role-label" className="flex flex-wrap gap-2">
                {roles.map((r) => (
                  <label key={r.id} className="cursor-pointer">
                    <input type="radio" name="roleId" value={r.id} checked={roleId === r.id} onChange={() => setRoleId(r.id)} className="peer sr-only" />
                    <span className={cn("inline-flex h-9 items-center rounded-full border border-border px-3.5 text-sm transition-colors", "hover:bg-muted peer-checked:border-transparent peer-checked:bg-primary peer-checked:text-primary-foreground peer-focus-visible:ring-2 peer-focus-visible:ring-ring")}>{t(r.name)}</span>
                  </label>
                ))}
              </div>
              {e?.roleId && <p className="text-xs text-destructive">{e.roleId}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="add-password">{t("Temporary password")}</Label>
              <div className="flex gap-2">
                <Input id="add-password" name="password" type={show ? "text" : "password"} value={password} onChange={(ev) => setPassword(ev.target.value)} autoComplete="off" spellCheck={false} className="font-mono" aria-invalid={!!e?.password} />
                <Button type="button" variant="outline" size="icon" onClick={() => setShow((v) => !v)} aria-label={show ? t("Hide password") : t("Show password")}>{show ? <EyeOff /> : <Eye />}</Button>
                <Button type="button" variant="outline" size="icon" onClick={() => setPassword(makeTemporaryPassword())} aria-label={t("Make another password")}><RefreshCw /></Button>
              </div>
              <p className="text-xs text-muted-foreground">{t("Made for you. They should change it after their first sign-in.")}</p>
              {e?.password && <p className="text-xs text-destructive">{e.password}</p>}
            </div>
            <FormProblem message={error && !e ? error : undefined} />
            <DialogFooter>
              <Button type="button" variant="outline" onClick={close} disabled={pending}>{t("Cancel")}</Button>
              <Button type="submit" disabled={pending || !ready}>{pending ? <Loader2 className="animate-spin" /> : <UserPlus />}{t("Create account")}</Button>
            </DialogFooter>
          </>
        )}
      </AccessForm>
    </>
  );
}
