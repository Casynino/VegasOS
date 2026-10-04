"use client";

import { useState } from "react";
import { KeyRound, Loader2, MonitorSmartphone, Pencil, UserPlus, UserRound } from "lucide-react";
import { ActionForm, FieldError } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeCheckbox, NativeSelect } from "@/components/ui/native-select";
import { Separator } from "@/components/ui/separator";
import { createUserAction, resetPasswordAction, signOutScreenSessionAction, updateUserAction } from "./actions";

/** `screen`: the shared restaurant screen's role — its account is the restaurant's login, not a person. */
type Role = { id: string; name: string; department: string; screen?: boolean };
/** Department first (Restaurant, Front office…), then the role in it (e.g. Restaurant → Mpishi or Waiter). */
function RoleSelect({ roles, defaultValue, disabled, onChange }: { roles: Role[]; defaultValue?: string; disabled?: boolean; onChange?: (role: Role | null) => void }) {
  const departments = [...new Set(roles.map((r) => r.department))];
  const [dept, setDept] = useState(roles.find((r) => r.id === defaultValue)?.department ?? "");
  const [role, setRole] = useState(defaultValue ?? "");
  const inDept = roles.filter((r) => r.department === dept);
  return (
    <div className="grid grid-cols-2 gap-2">
      <NativeSelect aria-label="Department" value={dept} disabled={disabled} required
        onChange={(e) => { const d = e.target.value; setDept(d); const only = roles.filter((r) => r.department === d); setRole(only.length === 1 ? only[0].id : ""); onChange?.(only.length === 1 ? only[0] : null); }}>
        <option value="" disabled>Department…</option>
        {departments.map((d) => <option key={d} value={d}>{d}</option>)}
      </NativeSelect>
      <NativeSelect id="roleId" name="roleId" value={role} onChange={(e) => { setRole(e.target.value); onChange?.(roles.find((r) => r.id === e.target.value) ?? null); }} disabled={disabled || !dept} required>
        <option value="" disabled>{dept ? "Role…" : "Choose a department"}</option>
        {inDept.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
      </NativeSelect>
    </div>
  );
}

export function CreateUserDialog({ roles, screenLogins = [] }: { roles: Role[]; /** The restaurant screen logins that already exist. */ screenLogins?: string[] }) {
  const [open, setOpen] = useState(false);
  // The restaurant's screen: one login for the whole restaurant (not a person) — waiters use their PIN on it.
  const [screen, setScreen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (!o) setScreen(false); }}>
      <DialogTrigger render={<Button />}><UserPlus /> Add staff</DialogTrigger>
      <DialogContent>
        <DialogHeader icon={screen ? <MonitorSmartphone /> : <UserPlus />} eyebrow={screen ? "Restaurant screen" : "Staff"} tone="violet">
          <DialogTitle>{screen ? "The main restaurant's login" : "Add staff member"}</DialogTitle>
          <DialogDescription>{screen ? "One login for the whole restaurant — not a person. Its password is the one you set here (keep it for managers); nothing more to change when you sign in." : "They will be asked to choose their own password at first sign-in."}</DialogDescription>
        </DialogHeader>
        <ActionForm action={createUserAction} onSuccess={() => { setOpen(false); setScreen(false); }} className="space-y-3">
          {({ pending, fieldErrors: e }) => (
            <>
              <div className="space-y-1.5"><Label htmlFor="roleId">Department & role</Label><RoleSelect roles={roles} onChange={(r) => setScreen(!!r?.screen)} /><FieldError message={e?.roleId} /></div>
              {screen && (
                <div className="flex gap-3 rounded-2xl border border-[oklch(0.72_0.12_80/0.35)] bg-[oklch(0.72_0.12_80/0.08)] px-3.5 py-3 text-xs leading-relaxed text-muted-foreground">
                  <MonitorSmartphone className="mt-0.5 size-4 shrink-0 text-[oklch(0.55_0.11_75)] dark:text-[#f2d28c]" />
                  <p>
                    Sign in with it once on the main restaurant computer or iPad — it stays signed in. Waiters keep their own accounts and never sign in there: on that screen they are picked from the list of waiters on shift.
                    {screenLogins.length > 0 && <span className="mt-1.5 block font-medium text-foreground">The restaurant already has its login: {screenLogins.join(", ")}. You only need one — the same login works on more than one screen.</span>}
                  </p>
                </div>
              )}
              <div className="space-y-1.5"><Label htmlFor="fullName">{screen ? "Name shown on the screen" : "Full name"}</Label>
                <Input key={screen ? "screen" : "person"} id="fullName" name="fullName" defaultValue={screen ? "Main Restaurant" : undefined} required /><FieldError message={e?.fullName} /></div>
              <div className="space-y-1.5"><Label htmlFor="email">{screen ? "The restaurant's login email" : "Email (used to sign in)"}</Label>
                <Input id="email" name="email" type="email" autoComplete="off" placeholder={screen ? "e.g. restaurant@yourhotel.com" : undefined} required /><FieldError message={e?.email} /></div>
              {!screen && <div className="space-y-1.5"><Label htmlFor="phone">Phone</Label><Input id="phone" name="phone" /></div>}
              <div className="space-y-1.5">
                <Label htmlFor="password">{screen ? "Password (for managers only)" : "Temporary password"}</Label>
                <Input id="password" name="password" type="text" autoComplete="off" required />
                <p className="text-xs text-muted-foreground">At least 10 characters with letters and numbers.</p>
                <FieldError message={e?.password} />
              </div>
              <DialogFooter>
                <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Create account</Button>
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
  const [open, setOpen] = useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger render={<Button variant="ghost" size="icon-sm" aria-label={`Edit ${user.fullName}`} />}><Pencil /></DialogTrigger>
      <DialogContent>
        <DialogHeader icon={screens ? <MonitorSmartphone /> : <UserRound />} eyebrow={screens ? "Restaurant screen" : "Staff"} tone="violet">
          <DialogTitle>{user.fullName}</DialogTitle>
          <DialogDescription>{user.email}</DialogDescription>
        </DialogHeader>
        <ActionForm action={updateUserAction} onSuccess={() => setOpen(false)} className="space-y-3">
          {({ pending, fieldErrors: e }) => (
            <>
              <input type="hidden" name="userId" value={user.id} />
              <div className="space-y-1.5"><Label htmlFor="fullName">Full name</Label><Input id="fullName" name="fullName" defaultValue={user.fullName} required /><FieldError message={e?.fullName} /></div>
              <div className="space-y-1.5"><Label htmlFor="phone">Phone</Label><Input id="phone" name="phone" defaultValue={user.phone} /></div>
              <div className="space-y-1.5">
                <Label htmlFor="roleId">Department & role</Label>
                <RoleSelect roles={roles} defaultValue={user.roleId} disabled={isSelf} />
                {isSelf && <input type="hidden" name="roleId" value={user.roleId} />}
              </div>
              {isSelf ? <input type="hidden" name="isActive" value="true" /> : (
                <NativeCheckbox name="isActive" defaultChecked={user.isActive} label="Account active (unticking signs them out immediately)" />
              )}
              <DialogFooter>
                <Button type="submit" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Save</Button>
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
                  <Label htmlFor="reset-password">Reset password</Label>
                  <div className="flex gap-2">
                    <Input id="reset-password" name="password" placeholder="New temporary password" autoComplete="off" />
                    <Button type="submit" variant="outline" disabled={pending}><KeyRound /> Reset</Button>
                  </div>
                  <FieldError message={e?.password} />
                </>
              )}
            </ActionForm>
          </>
        )}
        {screens && (
          <>
            <Separator />
            <div className="space-y-2">
              <Label className="flex items-center gap-1.5"><MonitorSmartphone className="size-3.5 text-muted-foreground" />Screens signed in with this login</Label>
              {screens.length === 0 ? <p className="text-xs text-muted-foreground">None right now — sign in once on the restaurant computer or iPad.</p> : (
                <ul className="divide-y divide-border/70 rounded-xl border border-border/70">
                  {screens.map((d) => (
                    <li key={d.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                      <span className="min-w-0 flex-1"><span className="block font-medium">{d.label}</span><span className="block text-xs text-muted-foreground">Last used {d.lastSeen}</span></span>
                      <ActionForm action={signOutScreenSessionAction}>
                        {({ pending }) => (
                          <>
                            <input type="hidden" name="sessionId" value={d.id} />
                            <Button type="submit" variant="ghost" size="sm" disabled={pending}>{pending && <Loader2 className="animate-spin" />}Sign out</Button>
                          </>
                        )}
                      </ActionForm>
                    </li>
                  ))}
                </ul>
              )}
              <p className="text-xs text-muted-foreground">A screen stays signed in while it is used. Sign one out here if it is lost or replaced — the others keep working.</p>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
