"use client";

import { useEffect, useState } from "react";
import { Loader2, Search, Trash2, UserCheck, UserX, Users } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n/client";
import { deleteCustomerAction, findCustomersAction, reactivateCustomerAction, suspendCustomerAction } from "./actions";

type Hit = { id: string; reference: string | null; fullName: string; phone: string | null; suspended: boolean };
type Ask = { kind: "suspend" | "reactivate" | "delete"; customer: Hit };

/**
 * CUSTOMERS on the Access page (owner, 2026-10-19: "we should be able to get customers as well, and suspend and delete them — for customers we must
 * search the name or the number"). A search box (name or phone number); the people found can be suspended (no booking or ordering through the public
 * pages), switched back on, or deleted — each with a plain confirm pop-up, nothing to type.
 */
export function CustomersPanel() {
  const t = useT();
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Hit[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [ask, setAsk] = useState<Ask | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const q = query.trim();
  const ready = q.length >= 2;

  const run = async (text: string) => {
    setSearching(true);
    const res = await findCustomersAction(text);
    setHits(res.ok ? res.data : []);
    setSearching(false);
  };
  useEffect(() => {
    if (!ready) return;
    const timer = setTimeout(() => { void run(q); }, 350);
    return () => clearTimeout(timer);
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
  const open_ = (kind: Ask["kind"], customer: Hit) => { setAsk({ kind, customer }); setError(null); setOpen(true); };
  const plain = { variant: "ghost", className: "h-9 gap-1.5 px-2.5 text-muted-foreground hover:text-foreground" } as const;

  return (
    <section className="space-y-3" aria-labelledby="customers-title">
      <div className="flex items-center gap-3">
        <span className="grid size-10 shrink-0 place-items-center rounded-2xl bg-muted text-muted-foreground"><Users className="size-5" aria-hidden="true" /></span>
        <div className="min-w-0">
          <h2 id="customers-title" className="text-base font-semibold leading-tight">{t("Customers")}</h2>
          <p className="text-sm text-muted-foreground">{t("Search a customer by name or phone number to suspend or delete them.")}</p>
        </div>
      </div>
      <div className="relative max-w-md">
        <Search className="pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
        <Input value={query} onChange={(e) => { setQuery(e.target.value); if (e.target.value.trim().length < 2) setHits(null); }} placeholder={t("Name or phone number")} aria-label={t("Search a customer by name or phone number")} className="pl-9" autoComplete="off" />
      </div>
      {searching && <p role="status" className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" aria-hidden="true" />{t("Loading…")}</p>}
      {!searching && ready && hits !== null && hits.length === 0 && <p role="status" className="text-sm text-muted-foreground">{t("No customer found.")}</p>}
      {hits && hits.length > 0 && (
        <ul className="divide-y divide-border/70 overflow-hidden rounded-3xl border border-border/70 bg-card">
          {hits.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center justify-between gap-x-4 gap-y-2 px-4 py-3 sm:px-5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2 text-sm font-semibold">
                  <span className="truncate">{c.fullName}</span>
                  {c.suspended && <span className="rounded-full bg-rose-500/12 px-2 py-0.5 text-xs font-medium text-rose-700 dark:text-rose-300">{t("Suspended")}</span>}
                </p>
                <p className="text-sm text-muted-foreground">{[c.phone, c.reference].filter(Boolean).join(" · ") || "—"}</p>
              </div>
              <div className="flex flex-wrap items-center gap-1">
                {c.suspended
                  ? <Button type="button" {...plain} onClick={() => open_("reactivate", c)} aria-label={t("Re-activate {name}", { name: c.fullName })}><UserCheck />{t("Re-activate")}</Button>
                  : <Button type="button" {...plain} onClick={() => open_("suspend", c)} aria-label={t("Suspend {name}", { name: c.fullName })}><UserX />{t("Suspend")}</Button>}
                <Button type="button" {...plain} onClick={() => open_("delete", c)} aria-label={t("Delete {name}", { name: c.fullName })}><Trash2 />{t("Delete")}</Button>
              </div>
            </li>
          ))}
        </ul>
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
    </section>
  );
}
