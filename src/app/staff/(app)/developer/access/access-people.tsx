"use client";

import { useMemo, useState } from "react";
import { Crown, Loader2, Lock, LogIn, LogOut, Search, Trash2, UserCheck, UserX, Users } from "lucide-react";
import { ActionForm } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useT } from "@/i18n/client";
import { AccessForm, FormProblem } from "./access-form";
import { CustomerResults } from "./customers-panel";
import { ago, filterGroups } from "./access-helpers";
import { deleteAccountAction, reactivateAction, signOutEverywhereAction, startWorkAsAction, suspendAction } from "./actions";

/** One account, as the page draws it (plain values: dates are ISO text so the page can be sent to the browser as it is). */
export interface AccessPersonView {
  id: string;
  fullName: string;
  email: string;
  roleName: string;
  isActive: boolean;
  lastSignedInAt: string | null;
  canWorkAs: boolean;
  canSuspend: boolean;
  canReactivate: boolean;
  canSignOut: boolean;
  canDelete: boolean;
  /** Why a button is missing, in English (e.g. "Can't be suspended or signed out here"). */
  note: string | null;
}
export interface AccessGroupView {
  roleCode: string;
  roleName: string;
  roleDescription: string;
  people: AccessPersonView[];
}

type DialogKind = "suspend" | "reactivate" | "signout" | "delete";

/**
 * Everyone the Developer can work as, grouped by role, with a search box and the buttons. "Work as" is a form posting the person to the
 * server; Suspend, Re-activate and Sign out each open a small dialog (a reason and the word CONFIRM, a reason, a plain confirm).
 * What each button is allowed to do is decided on the server — a button that is not offered here is also refused there.
 */
export function AccessPeople({ groups, nowIso, timezone }: { groups: AccessGroupView[]; nowIso: string; timezone: string }) {
  const t = useT();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [customerCount, setCustomerCount] = useState<number | null>(null);
  const [target, setTarget] = useState<{ kind: DialogKind; person: AccessPersonView } | null>(null);
  const now = useMemo(() => new Date(nowIso), [nowIso]);

  const q = query.trim();
  const shown = useMemo(() => filterGroups(groups, q, t), [groups, q, t]);

  const ask = (kind: DialogKind, person: AccessPersonView) => { setTarget({ kind, person }); setOpen(true); };

  return (
    <div className="space-y-6">
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input
          type="search" value={query} onChange={(e) => setQuery(e.target.value)} autoComplete="off" spellCheck={false}
          placeholder={t("Search by name, phone number, email or role")} aria-label={t("Search by name, phone number, email or role")} className="h-10 pl-9"
        />
      </div>

      {shown.length === 0 && (!q || q.length < 2 || customerCount === 0) && (
        <p className="rounded-2xl border border-dashed border-border bg-card/50 px-4 py-8 text-center text-sm text-muted-foreground">
          {q ? t("No one matches “{query}”.", { query: q }) : t("There are no accounts to show.")}
        </p>
      )}

      {shown.map((g) => (
        <section key={g.roleCode} aria-labelledby={`role-${g.roleCode}`} className="space-y-3">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-[oklch(0.72_0.12_80/0.14)] text-[oklch(0.5_0.11_75)] dark:text-[#f0cf86] [&_svg]:size-5">
              {g.roleCode === "OWNER" ? <Crown aria-hidden="true" /> : <Users aria-hidden="true" />}
            </span>
            <div className="min-w-0">
              <h2 id={`role-${g.roleCode}`} className="text-base font-semibold">
                {t(g.roleName)} <span className="font-normal text-muted-foreground">· {g.people.length}</span>
              </h2>
              {g.roleDescription && <p className="text-sm text-muted-foreground">{t(g.roleDescription)}</p>}
            </div>
          </div>
          <ul className="divide-y divide-border/70 overflow-hidden rounded-3xl border border-border/70 bg-card">
            {g.people.map((p) => <PersonRow key={p.id} p={p} now={now} timezone={timezone} ask={ask} />)}
          </ul>
        </section>
      ))}

      <CustomerResults query={q} onCount={setCustomerCount} />

      <Dialog open={open} onOpenChange={setOpen}>
        {target && (
          <DialogContent>
            {target.kind === "suspend" && <SuspendDialog key={target.person.id} person={target.person} close={() => setOpen(false)} />}
            {target.kind === "reactivate" && <ReactivateDialog key={target.person.id} person={target.person} close={() => setOpen(false)} />}
            {target.kind === "signout" && <SignOutDialog key={target.person.id} person={target.person} close={() => setOpen(false)} />}
            {target.kind === "delete" && <DeleteDialog key={target.person.id} person={target.person} close={() => setOpen(false)} />}
          </DialogContent>
        )}
      </Dialog>
    </div>
  );
}

function PersonRow({ p, now, timezone, ask }: { p: AccessPersonView; now: Date; timezone: string; ask: (kind: DialogKind, person: AccessPersonView) => void }) {
  const t = useT();
  const last = p.lastSignedInAt ? new Date(p.lastSignedInAt) : null;
  const plain = { variant: "ghost", className: "h-9 gap-1.5 px-2.5" } as const;
  return (
    <li className="flex flex-col gap-3 p-4 sm:flex-row sm:items-center sm:justify-between sm:gap-4 sm:px-5">
      <div className="flex min-w-0 items-start gap-3">
        <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold uppercase">{[...p.fullName.trim()][0] ?? "?"}</span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="font-semibold break-words">{p.fullName}</span>
            {p.isActive
              ? <span className="text-xs font-medium text-emerald-600 dark:text-emerald-400">{t.ctx("account", "Active")}</span>
              : <span className="rounded-full bg-rose-500/12 px-2 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-300">{t.ctx("account", "Suspended")}</span>}
            <span className="rounded-full bg-[oklch(0.72_0.12_80/0.14)] px-2 py-0.5 text-xs font-medium text-[oklch(0.45_0.1_75)] dark:text-[#f0cf86]">{t(p.roleName)}</span>
          </p>
          <p className="text-sm break-all text-muted-foreground">{p.email}</p>
          <p className="text-xs text-muted-foreground" title={last ? t.dateTime(last, timezone) : undefined}>
            {last ? t("Last signed in {when}", { when: ago(last, now, t) }) : t("Never signed in")}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 sm:shrink-0 sm:justify-end">
        {p.canWorkAs && (
          <ActionForm action={startWorkAsAction}>
            {({ pending }) => (
              <>
                <input type="hidden" name="userId" value={p.id} />
                <Button type="submit" className="h-9 gap-1.5 px-3" disabled={pending} aria-label={t("Work as {name}", { name: p.fullName })}>
                  {pending ? <Loader2 className="animate-spin" /> : <LogIn />}{t("Work as")}
                </Button>
              </>
            )}
          </ActionForm>
        )}
        {p.canSuspend ? (
          <Button type="button" {...plain} onClick={() => ask("suspend", p)} aria-label={t("Suspend {name}", { name: p.fullName })}><UserX />{t("Suspend")}</Button>
        ) : p.canReactivate ? (
          <Button type="button" {...plain} onClick={() => ask("reactivate", p)} aria-label={t("Re-activate {name}", { name: p.fullName })}><UserCheck />{t("Re-activate")}</Button>
        ) : p.note ? (
          <span className="inline-flex items-center gap-1.5 px-2 text-sm text-muted-foreground">
            <Lock className="size-3.5 shrink-0" aria-hidden="true" />
            {t(p.note)}
          </span>
        ) : null}
        {p.canSignOut && (
          <Button type="button" {...plain} onClick={() => ask("signout", p)} aria-label={t("Sign {name} out everywhere", { name: p.fullName })}><LogOut />{t("Sign out")}</Button>
        )}
        {p.canDelete && (
          <Button type="button" {...plain} onClick={() => ask("delete", p)} aria-label={t("Delete {name}", { name: p.fullName })}><Trash2 />{t("Delete")}</Button>
        )}
      </div>
    </li>
  );
}

// ───────────────────────────────────────────── the three dialogs ─────────────────────────────────────────────
function Cancel({ close, pending }: { close: () => void; pending: boolean }) {
  const t = useT();
  return <Button type="button" variant="outline" onClick={close} disabled={pending}>{t("Cancel")}</Button>;
}

function SuspendDialog({ person, close }: { person: AccessPersonView; close: () => void }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const [confirm, setConfirm] = useState("");
  const ready = reason.trim().length >= 5 && confirm === "CONFIRM";
  return (
    <>
      <DialogHeader icon={<UserX />} eyebrow={t("Access")} tone="amber">
        <DialogTitle>{t("Suspend {name}?", { name: person.fullName })}</DialogTitle>
        <DialogDescription>{person.email}</DialogDescription>
      </DialogHeader>
      <AccessForm action={suspendAction} onSuccess={close} className="space-y-3">
        {({ pending, error, fieldErrors: e }) => (
          <>
            <input type="hidden" name="userId" value={person.id} />
            <p className="rounded-xl border border-amber-500/40 bg-amber-500/[0.08] px-3 py-2 text-sm text-amber-900 dark:text-amber-200">
              {t("{name} is signed out of every phone and computer at once and cannot sign in until the account is re-activated. You can only re-activate an account you suspended yourself.", { name: person.fullName })}
            </p>
            <div className="space-y-1.5">
              <Label htmlFor="suspend-reason">{t("Reason (written in the audit trail)")}</Label>
              <Input id="suspend-reason" name="reason" value={reason} onChange={(ev) => setReason(ev.target.value)} maxLength={500} autoComplete="off" placeholder={t("At least 5 characters")} aria-invalid={!!e?.reason} />
              {e?.reason && <p className="text-xs text-destructive">{e.reason}</p>}
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="suspend-confirm">{t("Type CONFIRM to go on")}</Label>
              <Input id="suspend-confirm" name="confirm" value={confirm} onChange={(ev) => setConfirm(ev.target.value)} autoComplete="off" autoCapitalize="characters" spellCheck={false} placeholder="CONFIRM" aria-invalid={!!e?.confirm} />
              {e?.confirm && <p className="text-xs text-destructive">{e.confirm}</p>}
            </div>
            <FormProblem message={error && !e ? error : undefined} />
            <DialogFooter>
              <Cancel close={close} pending={pending} />
              <Button type="submit" variant="destructive" disabled={pending || !ready}>{pending ? <Loader2 className="animate-spin" /> : <UserX />}{t("Suspend")}</Button>
            </DialogFooter>
          </>
        )}
      </AccessForm>
    </>
  );
}

function DeleteDialog({ person, close }: { person: AccessPersonView; close: () => void }) {
  const t = useT();
  return (
    <>
      <DialogHeader icon={<Trash2 />} eyebrow={t("Access")} tone="amber">
        <DialogTitle>{t("Delete {name}?", { name: person.fullName })}</DialogTitle>
        <DialogDescription>{person.email}</DialogDescription>
      </DialogHeader>
      <AccessForm action={deleteAccountAction} onSuccess={close} className="space-y-3">
        {({ pending, error }) => (
          <>
            <input type="hidden" name="userId" value={person.id} />
            <p className="text-sm text-muted-foreground">
              {t("{name} loses all access and is removed from the system. Everything {name} did stays recorded under their name.", { name: person.fullName })}
            </p>
            <FormProblem message={error} />
            <DialogFooter>
              <Cancel close={close} pending={pending} />
              <Button type="submit" variant="destructive" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <Trash2 />}{t("Delete")}</Button>
            </DialogFooter>
          </>
        )}
      </AccessForm>
    </>
  );
}

function ReactivateDialog({ person, close }: { person: AccessPersonView; close: () => void }) {
  const t = useT();
  const [reason, setReason] = useState("");
  const ready = reason.trim().length >= 5;
  return (
    <>
      <DialogHeader icon={<UserCheck />} eyebrow={t("Access")} tone="emerald">
        <DialogTitle>{t("Re-activate {name}?", { name: person.fullName })}</DialogTitle>
        <DialogDescription>{person.email}</DialogDescription>
      </DialogHeader>
      <AccessForm action={reactivateAction} onSuccess={close} className="space-y-3">
        {({ pending, error, fieldErrors: e }) => (
          <>
            <input type="hidden" name="userId" value={person.id} />
            <p className="text-sm text-muted-foreground">{t("{name} can sign in again with the same email and password.", { name: person.fullName })}</p>
            <div className="space-y-1.5">
              <Label htmlFor="reactivate-reason">{t("Reason (written in the audit trail)")}</Label>
              <Input id="reactivate-reason" name="reason" value={reason} onChange={(ev) => setReason(ev.target.value)} maxLength={500} autoComplete="off" placeholder={t("At least 5 characters")} aria-invalid={!!e?.reason} />
              {e?.reason && <p className="text-xs text-destructive">{e.reason}</p>}
            </div>
            <FormProblem message={error && !e ? error : undefined} />
            <DialogFooter>
              <Cancel close={close} pending={pending} />
              <Button type="submit" disabled={pending || !ready}>{pending ? <Loader2 className="animate-spin" /> : <UserCheck />}{t("Re-activate")}</Button>
            </DialogFooter>
          </>
        )}
      </AccessForm>
    </>
  );
}

function SignOutDialog({ person, close }: { person: AccessPersonView; close: () => void }) {
  const t = useT();
  return (
    <>
      <DialogHeader icon={<LogOut />} eyebrow={t("Access")} tone="sky">
        <DialogTitle>{t("Sign {name} out everywhere?", { name: person.fullName })}</DialogTitle>
        <DialogDescription>{person.email}</DialogDescription>
      </DialogHeader>
      <AccessForm action={signOutEverywhereAction} onSuccess={close} className="space-y-3">
        {({ pending, error }) => (
          <>
            <input type="hidden" name="userId" value={person.id} />
            <p className="text-sm text-muted-foreground">{t("Ends every open session on every phone and computer. The person can sign straight back in.")}</p>
            <FormProblem message={error} />
            <DialogFooter>
              <Cancel close={close} pending={pending} />
              <Button type="submit" disabled={pending}>{pending ? <Loader2 className="animate-spin" /> : <LogOut />}{t("Sign out everywhere")}</Button>
            </DialogFooter>
          </>
        )}
      </AccessForm>
    </>
  );
}
