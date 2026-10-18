"use client";

import { useMemo, useState, type ReactNode } from "react";
import Link from "next/link";
import { ArrowRight, Loader2, LogIn, Search, UserPlus } from "lucide-react";
import { ActionForm } from "@/components/staff/action-form";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/client";
import { startWorkAsAction } from "./access/actions";
import { AddAccountForm, type RoleChoice } from "./access/add-account-dialog";
import { TILE, TILE_ICON } from "./tile-style";

/** The two shortcut cards on the Developer Home that open a popup: "Work as someone" and "Add an account". */
export interface PersonChoice { id: string; fullName: string; roleName: string }

function CardBody({ icon, title, text }: { icon: ReactNode; title: string; text: string }) {
  return (
    <>
      <span className={TILE_ICON}>{icon}</span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold text-foreground">{title}</span>
        <span className="mt-0.5 block truncate text-xs text-muted-foreground">{text}</span>
      </span>
      <ArrowRight className="size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" aria-hidden />
    </>
  );
}

/** "Work as": a tile that opens a popup with the people (name and role) — one press on a name and you are working as them. */
export function WorkAsCard({ people }: { people: PersonChoice[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return people;
    return people.filter((p) => `${p.fullName} ${p.roleName} ${t(p.roleName)}`.toLowerCase().includes(q));
  }, [people, query, t]);
  return (
    <>
      <button type="button" className={TILE} onClick={() => { setQuery(""); setOpen(true); }}>
        <CardBody icon={<LogIn className="size-5" aria-hidden />} title={t("Work as")} text={t("Open someone's dashboard")} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader icon={<LogIn />} eyebrow={t("Developer console")} tone="violet">
            <DialogTitle>{t("Work as")}</DialogTitle>
            <DialogDescription>{t("Pick a person. You will see their dashboard exactly as they see it.")}</DialogDescription>
          </DialogHeader>
          <div className="relative">
            <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <Input value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" placeholder={t("Search by name or role")} aria-label={t("Search by name or role")} autoComplete="off" />
          </div>
          <ul className="-mx-1 max-h-[55vh] space-y-1 overflow-y-auto px-1">
            {shown.map((p) => (
              <li key={p.id}>
                <ActionForm action={startWorkAsAction}>
                  {({ pending }) => (
                    <>
                      <input type="hidden" name="userId" value={p.id} />
                      <button type="submit" disabled={pending} aria-label={t("Work as {name}", { name: p.fullName })}
                        className="flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left transition-colors hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold disabled:opacity-60">
                        <span aria-hidden="true" className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-sm font-semibold uppercase">{p.fullName.trim().charAt(0)}</span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-sm font-medium">{p.fullName}</span>
                          <span className="block truncate text-xs text-muted-foreground">{t(p.roleName)}</span>
                        </span>
                        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ArrowRight className="size-4 text-muted-foreground" aria-hidden />}
                      </button>
                    </>
                  )}
                </ActionForm>
              </li>
            ))}
            {!shown.length && <li className="px-2.5 py-6 text-center text-sm text-muted-foreground">{t("No one found.")}</li>}
          </ul>
          <p className="text-xs text-muted-foreground">
            {t("To suspend someone or sign them out, open the")} <Link href="/staff/developer/access" className="underline underline-offset-2">{t("Access page")}</Link>.
          </p>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** "Add an account": a card that opens the same dialog as the Access page's button. */
export function AddAccountCard({ roles }: { roles: RoleChoice[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [round, setRound] = useState(0);
  if (!roles.length) return null;
  return (
    <>
      <button type="button" className={TILE} onClick={() => { setRound((n) => n + 1); setOpen(true); }}>
        <CardBody icon={<UserPlus className="size-5" aria-hidden />} title={t("Add an account")} text={t("Create a login")} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <AddAccountForm key={round} roles={roles} close={() => setOpen(false)} />
        </DialogContent>
      </Dialog>
    </>
  );
}

export { Button };
