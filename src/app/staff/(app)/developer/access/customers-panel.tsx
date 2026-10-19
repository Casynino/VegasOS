"use client";

import { useEffect, useState } from "react";
import { Loader2, Trash2, UserCheck, UserX, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useT } from "@/i18n/client";
import { deleteCustomerAction, findCustomersAction, reactivateCustomerAction, suspendCustomerAction } from "./actions";

type Hit = { id: string; reference: string | null; fullName: string; phone: string | null; suspended: boolean };
type Ask = { kind: "suspend" | "reactivate" | "delete"; customer: Hit };

/**
 * CUSTOMERS under the Access page's one search box (owner, 2026-10-19: "when I search by name or phone number I need to see the customers like this").
 * The same box that filters the accounts also looks for customers once it holds 2+ characters; they are listed in a "Customers · n" group in the style of
 * the accounts, each with Suspend / Re-activate and Delete (a plain confirm pop-up, nothing to type). Nothing is listed while the box is empty (there are
 * too many customers). `onCount` tells the page how many were found, so it can say "no one matches" only when nothing at all matches.
 */
export function CustomerResults({ query, onCount }: { query: string; onCount?: (count: number) => void }) {
  const t = useT();
  const q = query.trim();
  const ready = q.length >= 2;
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const run = async (text: string) => {
    setSearching(true);
    const res = await findCustomersAction(text);
    const list = res.ok ? res.data : [];
    setHits(list);
    onCount?.(list.length);
    setSearching(false);
  };
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => { void run(q); }, 300);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q, ready]);

  const confirm = async () => {
    if (!ask) return;
    setBusy(true); setError(null);
    const res = ask.kind === "suspend" ? await suspendCustomerAction(ask.customer.id) : ask.kind === "reactivate" ? await reactivateCustomerAction(ask.customer.id) : await deleteCustomerAction(ask.customer.id);
    setBusy(false);
    if (!res.ok) { setError(res.error); return; }
    toast.success(res.message ?? "");
    setOpen(false);
    await run(q);
  };
  const choose = (kind: Ask["kind"], customer: Hit) => { setAsk({ kind, customer }); setError(null); setOpen(true); };
  const plain = { variant: "ghost", className: "h-9 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground" } as const;

  if (!ready) return null;
  const shown = hits;
  return (
    <>
      {searching && !shown && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />{t("Loading…")}</p>}
      {shown && shown.length > 0 && (
        <section aria-labelledby="customers-title" className="space-y-3">
          <div className="flex items-start gap-3">
            <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-muted text-muted-foreground"><Users className="size-5" aria-hidden="true" /></span>
            <h2 id="customers-title" className="pt-2 text-base font-semibold">{t("Customers")} <span className="font-normal text-muted-foreground">· {shown.length}</span></h2>
          </div>
          <ul className="divide-y divide-border/70 overflow-hidden rounded-3xl border border-border/70 bg-card">
            {shown.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                    <span className="truncate">{c.fullName}</span>
                    <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">{t("Customer")}</span>
                    {c.suspended && <span className="rounded-full bg-rose-500/12 px-2 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-300">{t("Suspended")}</span>}
                  </p>
                  <p className="text-sm text-muted-foreground">{[c.phone, c.reference].filter(Boolean).join(" · ") || "—"}</p>
                </div>
                <div className="flex flex-wrap items-center gap-1">
                  {c.suspended
                    ? <Button type="button" {...plain} onClick={() => choose("reactivate", c)} aria-label={t("Re-activate {name}", { name: c.fullName })}><UserCheck />{t("Re-activate")}</Button>
                    : <Button type="button" {...plain} onClick={() => choose("suspend", c)} aria-label={t("Suspend {name}", { name: c.fullName })}><UserX />{t("Suspend")}</Button>}
                  <Button type="button" {...plain} onClick={() => choose("delete", c)} aria-label={t("Delete {name}", { name: c.fullName })}><Trash2 />{t("Delete")}</Button>
                </div>
              </li>
            ))}
          </ul>
          {shown.length >= 20 && <p className="text-xs text-muted-foreground">{t("Showing the first 20 — type more of the name or number to narrow it.")}</p>}
        </section>
      )}

      <Dialog open={open} onOpenChange={setOpen}>
        {ask && (
          <DialogContent>
            <DialogHeader icon={ask.kind === "delete" ? <Trash2 /> : ask.kind === "suspend" ? <UserX /> : <UserCheck />} eyebrow={t("Customers")} tone="amber">
              <DialogTitle>{ask.kind === "delete" ? t("Delete {name}?", { name: ask.customer.fullName }) : ask.kind === "suspend" ? t("Suspend {name}?", { name: ask.customer.fullName }) : t("Re-activate {name}?", { name: ask.customer.fullName })}</DialogTitle>
              <DialogDescription>{ask.customer.phone ?? ask.customer.reference ?? ""}</DialogDescription>
            </DialogHeader>
            <p className="text-sm text-muted-foreground">
              {ask.kind === "delete" ? t("{name}'s personal details are removed. Stays, orders and payments on record stay in the books.", { name: ask.customer.fullName })
                : ask.kind === "suspend" ? t("{name} can no longer book or order through the website or the QR pages. The hotel desk can still serve them.", { name: ask.customer.fullName })
                  : t("{name} can book and order through the website and the QR pages again.", { name: ask.customer.fullName })}
            </p>
            {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
            <DialogFooter>
              <Button type="button" variant="outline" onClick={() => setOpen(false)} disabled={busy}>{t("Cancel")}</Button>
              <Button type="button" variant={ask.kind === "reactivate" ? "default" : "destructive"} onClick={() => void confirm()} disabled={busy}>
                {busy ? <Loader2 className="animate-spin" /> : ask.kind === "delete" ? <Trash2 /> : ask.kind === "suspend" ? <UserX /> : <UserCheck />}
                {ask.kind === "delete" ? t("Delete") : ask.kind === "suspend" ? t("Suspend") : t("Re-activate")}
              </Button>
            </DialogFooter>
          </DialogContent>
        )}
      </Dialog>
    </>
  );
}
