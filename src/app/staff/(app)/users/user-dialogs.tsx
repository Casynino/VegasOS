"use client";

import { useState } from "react";
import { KeyRound, Loader2, MonitorSmartphone, Pencil, Trash2, UserPlus, UserRound } from "lucide-react";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeCheckbox, NativeSelect } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { createUserAction, deleteUserAction, resetPasswordAction, signOutScreenSessionAction, updateUserAction } from "./actions";
import { useT } from "@/i18n/client";

/** `screen`: the shared restaurant screen's role — its account is the restaurant's login, not a person. */
type Role = { id: string; name: string; department: string; screen?: boolean };
/** Department first (Restaurant, Front office…), then the role in it (e.g. Restaurant → Mpishi or Waiter). */
function RoleSelect({ roles, defaultValue, disabled, onChange }: { roles: Role[]; defaultValue?: string; disabled?: boolean; onChange?: (role: Role | null) => void }) {
  const t = useT();
  const departments = [...new Set(roles.map((r) => r.department))];
  const [dept, setDept] = useState(roles.find((r) => r.id === defaultValue)?.department ?? "");
  const [role, setRole] = useState(defaultValue ?? "");
  const inDept = roles.filter((r) => r.department === dept);
  return (
    <div className="grid grid-cols-2 gap-2">
      <NativeSelect aria-label={t("Department")} value={dept} disabled={disabled} required
        onChange={(e) => { const d = e.target.value; setDept(d); const only = roles.filter((r) => r.department === d); setRole(only.length === 1 ? only[0].id : ""); onChange?.(only.length === 1 ? only[0] : null); }}>
        <option value="" disabled>{t("Department…")}</option>
        {departments.map((d) => <option key={d} value={d}>{t(d)}</option>)}
      </NativeSelect>
      <NativeSelect id="roleId" name="roleId" value={role} onChange={(e) => { setRole(e.target.value); onChange?.(roles.find((r) => r.id === e.target.value) ?? null); }} disabled={disabled || !dept} required>
        <option value="" disabled>{dept ? t("Role…") : t("Choose a department")}</option>
        {inDept.map((r) => <option key={r.id} value={r.id}>{t(r.name)}</option>)}
      </NativeSelect>
    </div>
  );
}

export function CreateUserDialog({ roles, screenLogins = [] }: { roles: Role[]; /** The restaurant screen logins that already exist. */ screenLogins?: string[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  // The restaurant's screen: one login for the whole restaurant (not a person) — waiters use their PIN on it.
  const [screen, setScreen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setScreen(false); }}>
      <DialogTrigger render={<Button />}><UserPlus /> {t("Add staff")}</DialogTrigger>
      <DialogContent>
        <DialogHeader icon={screen ? <MonitorSmartphone /> : <UserPlus />} eyebrow={screen ? t("Restaurant screen") : t("Staff")} tone="violet">
          <DialogTitle>{screen ? t("The main restaurant's login") : t("Add staff member")}</DialogTitle>
          <DialogDescription>{screen ? t("One login for the whole restaurant — not a person. Its password is the one you set here (keep it for managers); nothing more to change when you sign in.") : t("They will be asked to choose their own password at first sign-in.")}</DialogDescription>
        </DialogHeader>
        <ActionForm action={createUserAction} onSuccess={() => { setOpen(false); setScreen(false); }} className="space-y-3">
          {({ pending, fieldErrors: e }) => (
            <>
              <div className="space-y-1.5"><Label htmlFor="roleId">{t("Department & role")}</Label><RoleSelect roles={roles} onChange={(r) => setScreen(!!r?.screen)} /><FieldError message={e?.roleId} /></div>
              {screen && (
                <div className="flex gap-3 rounded-2xl border border-[oklch(0.72_0.12_80/0.35)] bg-[oklch(0.72_0.12_80/0.08)] px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
                  <MonitorSmartphone className="mt-0.5 size-4 shrink-0 text-[oklch(0.55_0.11_75)] dark:text-[#f2d28c]" />
                  <p>
                    {t("Sign in with it once on the main restaurant computer or iPad — it stays signed in. Waiters keep their own accounts and never sign in there: on that screen they are picked from the list of waiters on shift.")}
                    {screenLogins.length > 0 && <span className="mt-1.5 block font-medium text-foreground">{t("The restaurant already has its login: {logins}. You only need one — the same login works on more than one screen.", { logins: screenLogins.join(", ") })}</span>}
                  </p>
                </div>
              )}
              <div className="space-y-1.5"><Label htmlFor="fullName">{screen ? t("Name shown on the screen") : t("Full name")}</Label>
                <Input key={screen ? "screen" : "person"} id="fullName" name="fullName" defaultValue={screen ? "Main Restaurant" : undefined} required /><FieldError message={e?.fullName} /></div>
              <div className="space-y-1.5"><Label htmlFor="email">{screen ? t("The restaurant's login email") : t("Email (used to sign in)")}</Label>
                <Input id="email" name="email" type="email" autoComplete="off" placeholder={screen ? t("e.g. restaurant@yourhotel.com") : undefined} required /><FieldError message={e?.email} /></div>
              {!screen && <div className="space-y-1.5"><Label htmlFor="phone">{t("Phone")}</Label><Input id="phone" name="phone" /></div>}
              <div className="space-y-1.5">
                <Label htmlFor="password">{screen ? t("Password (for managers only)") : t("Temporary password")}</Label>
                <Input id="password" name="password" type="text" autoComplete="off" required />
                <p className="text-xs text-muted-foreground">{t("At least 10 characters with letters and numbers.")}</p>
                <FieldError message={e?.password} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{t("Create account")}</Button>
              </DialogFooter>
            </>
          )}
        </ActionForm>
      </DialogContent>
    </Dialog>
  );
}

export function EditUserDialog({ user, roles, isSelf, screens = null }: {
  user: { id: string; fullName: string; phone: string; roleId: string; isActive: boolean; email: string };
  roles: Role[];
  isSelf: boolean;
  /** The restaurant screen's login: where it is signed in now (null: not the screen's account). */
  screens?: { id: string; label: string; lastSeen: string }[] | null;
}) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setConfirmDelete(false); }}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={t("Edit {name}", { name: user.fullName })} />}><Pencil /></DialogTrigger>
      <DialogContent>
        <DialogHeader icon={screens ? <MonitorSmartphone /> : <UserRound />} eyebrow={screens ? t("Restaurant screen") : t("Staff")} tone="violet">
          <DialogTitle>{user.fullName}</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <ActionForm action={updateUserAction} onSuccess={() => setOpen(false)} className="space-y-3">
          {({ pending, fieldErrors: e }) => (
            <>
              <input type="hidden" name="userId" value={user.id} />
              <div className="space-y-1.5"><Label htmlFor="fullName">{t("Full name")}</Label><Input id="fullName" name="fullName" defaultValue={user.fullName} required /><FieldError message={e?.fullName} /></div>
              <div className="space-y-1.5"><Label htmlFor="email">{t("Email")}</Label><Input id="email" name="email" type="email" defaultValue={user.email} required /><FieldError message={e?.email} /></div>
              <div className="space-y-1.5"><Label htmlFor="phone">{t("Phone")}</Label><Input id="phone" name="phone" defaultValue={user.phone} /></div>
              <div className="space-y-1.5">
                <Label htmlFor="roleId">{t("Department & role")}</Label>
                <RoleSelect roles={roles} defaultValue={user.roleId} disabled={isSelf} />
                {isSelf && <input type="hidden" name="roleId" value={user.roleId} />}
              </div>
              {isSelf ? <input type="hidden" name="isActive" value="true" /> : (
                <NativeCheckbox name="isActive" defaultChecked={user.isActive} label={t("Account active (unticking signs them out immediately)")} />
              )}
              <DialogFooter>
                <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{t("Save")}</Button>
              </DialogFooter>
            </>
          )}
        </ActionForm>
        {!isSelf && (
          <>
            <Separator />
            <ActionForm action={resetPasswordAction} resetOnSuccess className="space-y-2">
              {({ pending, fieldErrors: e }) => (
                <>
                  <input type="hidden" name="userId" value={user.id} />
                  <Label htmlFor="reset-password">{t("Reset password")}</Label>
                  <div className="flex gap-2">
                    <Input id="reset-password" name="password" placeholder={t("New temporary password")} autoComplete="off" />
                    <Button type="submit" variant="outline" disabled={pending}><KeyRound /> {t("Reset")}</Button>
                  </div>
                  <FieldError message={e?.password} />
                </>
              )}
            </ActionForm>
            <Separator />
            {!confirmDelete ? (
              <button type="button" onClick={() => setConfirmDelete(true)} className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm text-rose-600 transition-colors hover:bg-rose-500/10 dark:text-rose-400">
                <Trash2 className="size-3.5 shrink-0" />{t("Remove this account")}
              </button>
            ) : (
              <ActionForm action={deleteUserAction} onSuccess={() => setOpen(false)} className="space-y-2">
                {({ pending }) => (
                  <>
                    <input type="hidden" name="userId" value={user.id} />
                    <p className="text-sm font-medium text-rose-600 dark:text-rose-400">{t("Remove {name}?", { name: user.fullName })}</p>
                    <p className="text-xs text-muted-foreground">{t("This cannot be undone. If they have records in the system the delete will be blocked — deactivate instead.")}</p>
                    <div className="flex gap-2">
                      <Button type="submit" variant="destructive" size="sm" disabled={pending}>{pending && <Loader2 className="animate-spin" />}<Trash2 />{t("Yes, remove")}</Button>
                      <Button type="button" variant="ghost" size="sm" onClick={() => setConfirmDelete(false)}>{t("Cancel")}</Button>
                    </div>
                  </>
                )}
              </ActionForm>
            )}
          </>
        )}
        {screens && (
          <>
            <Separator />
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><MonitorSmartphone className="size-3.5 text-muted-foreground" />{t("Screens signed in with this login")}</Label>
              {screens.length === 0 ? <p className="text-xs text-muted-foreground">{t("None right now — sign in once on the restaurant computer or iPad.")}</p> : (
                <ul className="divide-y divide-border/70 rounded-xl border border-border/70">
                  {screens.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1"><span className="block font-medium">{d.label}</span><span className="block text-xs text-muted-foreground">{t("Last used {time}", { time: d.lastSeen })}</span></span>
                      <ActionForm action={signOutScreenSessionAction}>
                        {({ pending }) => (
                          <>
                            <input type="hidden" name="sessionId" value={d.id} />
                            <Button type="submit" variant="ghost" size="sm" disabled={pending}>{pending && <Loader2 className="animate-spin" />}{t("Sign out")}</Button>
                          </>
                        )}
                      </ActionForm>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">{t("A screen stays signed in while it is used. Sign one out here if it is lost or replaced — the others keep working.")}</p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
