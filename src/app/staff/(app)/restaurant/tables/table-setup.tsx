"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Armchair, ArrowRightLeft, Ban, History, Loader2, Plus, Power, UserRoundCheck, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { addTableAction, assignTableWaiterAction, setTableBlockedAction, setTableInUseAction } from "./actions";
import { waitersAction } from "@/app/staff/(app)/manager-actions";

/**
 * Setting the floor up (managers, the MD): add a table inside or outside — numbered after the last,
 * with its own QR card — and switch tables back on.
 */
export function TableSetupButtons({ switchedOff }: { switchedOff: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState<"add" | "off" | null>(null);
  const [pending, start] = useTransition();
  const add = (area: "INSIDE" | "OUTSIDE") => start(async () => {
    const r = await addTableAction({ area });
    if (r.ok) { toast.success(`${r.data.name} added — print its QR card from the table.`); setOpen(null); router.refresh(); } else toast.error(r.error);
  });
  const on = (id: string) => start(async () => {
    const r = await setTableInUseAction({ id, active: true });
    if (r.ok) { toast.success(`${r.data.name} is back in use.`); router.refresh(); } else toast.error(r.error);
  });
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen("add")}><Plus />Add table</Button>
      {switchedOff.length > 0 && <Button size="sm" variant="outline" onClick={() => setOpen("off")}><Ban />Switched off · {switchedOff.length}</Button>}
      <Dialog open={open === "add"} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader icon={<Armchair />} eyebrow="Restaurant" tone="gold">
            <DialogTitle>Add a table</DialogTitle>
            <DialogDescription>It gets the next number in that area and its own QR card.</DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2">
            {(["INSIDE", "OUTSIDE"] as const).map((a) => (
              <Button key={a} className="h-14" variant="outline" disabled={pending} onClick={() => add(a)}>{pending ? <Loader2 className="animate-spin" /> : <Plus />}{a === "INSIDE" ? "Inside" : "Outside"}</Button>
            ))}
          </div>
        </DialogContent>
      </Dialog>
      <Dialog open={open === "off"} onOpenChange={(o) => !o && setOpen(null)}>
        <DialogContent className="sm:max-w-sm">
          <DialogHeader icon={<Power />} eyebrow="Restaurant" tone="gold">
            <DialogTitle>Tables switched off</DialogTitle>
            <DialogDescription>Nobody can sit or order at them. Switch one on to use it again.</DialogDescription>
          </DialogHeader>
          <ul className="divide-y divide-border/60">
            {switchedOff.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span>{t.name}</span>
                <Button size="sm" variant="outline" disabled={pending} onClick={() => on(t.id)}><Power />Switch on</Button>
              </li>
            ))}
          </ul>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** In a table's window: take the table out of use (it must be empty, with no reservation coming). */
export function TakeTableOut({ id, name, onDone }: { id: string; name: string; onDone: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  if (!open) return <Button size="sm" variant="ghost" className="w-full text-xs text-rose-300 hover:text-rose-200" onClick={() => setOpen(true)}><Ban />Switch this table off</Button>;
  return (
    <div className="space-y-2 rounded-xl border border-rose-500/30 bg-rose-500/[0.05] p-2.5">
      <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why? e.g. broken leg, used for an event" className="h-9" />
      <div className="grid grid-cols-2 gap-1.5">
        <Button size="sm" variant="ghost" onClick={() => setOpen(false)}>Back</Button>
        <Button size="sm" className="bg-rose-600 text-white hover:bg-rose-500" disabled={pending || reason.trim().length < 3} onClick={() => start(async () => {
          const r = await setTableInUseAction({ id, active: false, reason });
          if (r.ok) { toast.success(`${name} switched off.`); onDone(); router.refresh(); } else toast.error(r.error, { duration: 9000 });
        })}>{pending && <Loader2 className="animate-spin" />}Switch off</Button>
      </div>
    </div>
  );
}

const BLOCK_LABEL: Record<string, string> = { UNAVAILABLE: "Not available", MAINTENANCE: "Under maintenance" };
const at = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "");

/**
 * An empty table, for managers and the MD: block it for now (not available / under maintenance, with
 * the reason) — it stays on the floor, marked, and nobody can be seated or order from its QR — or
 * take it out of use altogether.
 */
export function TableAvailability({ id, name }: { id: string; name: string }) {
  const router = useRouter();
  const [as, setAs] = useState<"UNAVAILABLE" | "MAINTENANCE" | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const go = () => start(async () => {
    const r = await setTableBlockedAction({ id, as, reason });
    if (!r.ok) { toast.error(r.error, { duration: 9000 }); return; }
    toast.success(`${name}: ${as === "MAINTENANCE" ? "under maintenance" : "not available"}.`);
    if (r.data.reservationsComing) toast.warning(`${r.data.reservationsComing} reservation${r.data.reservationsComing === 1 ? " is" : "s are"} booked at ${name} — move ${r.data.reservationsComing === 1 ? "it" : "them"} to another table.`, { duration: 10000 });
    setAs(null); setReason(""); router.refresh();
  });
  return (
    <div className="space-y-1.5 border-t border-border/60 pt-2">
      {!as ? (
        <div className="grid grid-cols-2 gap-1.5">
          <Button size="sm" variant="ghost" className="text-xs text-amber-300 hover:text-amber-200" onClick={() => setAs("UNAVAILABLE")}><Ban />Not available</Button>
          <Button size="sm" variant="ghost" className="text-xs text-amber-300 hover:text-amber-200" onClick={() => setAs("MAINTENANCE")}><Wrench />Maintenance</Button>
        </div>
      ) : (
        <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/[0.05] p-2.5">
          <p className="text-[11px] font-semibold text-amber-200">{BLOCK_LABEL[as]} — why?</p>
          <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder={as === "MAINTENANCE" ? "e.g. broken leg, chair repair" : "e.g. kept for a group at 8"} className="h-9" />
          <div className="grid grid-cols-2 gap-1.5">
            <Button size="sm" variant="ghost" onClick={() => setAs(null)}>Back</Button>
            <Button size="sm" className="bg-amber-500 text-black hover:bg-amber-400" disabled={pending || reason.trim().length < 3} onClick={go}>{pending && <Loader2 className="animate-spin" />}Block table</Button>
          </div>
        </div>
      )}
      <TakeTableOut id={id} name={name} onDone={() => {}} />
    </div>
  );
}

/** A blocked table, opened: why, since when — and Reopen (managers, the MD). */
export function BlockedBody({ id, name, blocked, canReopen, onHistory }: { id: string; name: string; blocked: { as: string; reason: string | null; at: string | null }; canReopen: boolean; onHistory: () => void }) {
  const router = useRouter();
  const [pending, start] = useTransition();
  return (
    <div className="space-y-3 p-4 sm:p-5">
      <section className="rounded-2xl border border-amber-500/30 bg-amber-500/[0.06] p-4">
        <p className="flex items-center gap-2 text-sm font-semibold text-amber-200">{blocked.as === "MAINTENANCE" ? <Wrench className="size-4" /> : <Ban className="size-4" />}{BLOCK_LABEL[blocked.as] ?? "Blocked"}</p>
        {blocked.reason && <p className="mt-1 text-sm">{blocked.reason}</p>}
        <p className="mt-1 text-xs text-muted-foreground">Since {at(blocked.at)} · nobody can be seated here or order from its QR until it is reopened.</p>
      </section>
      <div className="flex flex-wrap gap-2">
        {canReopen && (
          <Button disabled={pending} onClick={() => start(async () => {
            const r = await setTableBlockedAction({ id, as: null });
            if (r.ok) { toast.success(`${name} is open again.`); router.refresh(); } else toast.error(r.error);
          })}>{pending ? <Loader2 className="animate-spin" /> : <Power />}Reopen {name.replace(/\s—.*/, "")}</Button>
        )}
        <Button variant="outline" onClick={onHistory}><History />Past customers</Button>
      </div>
    </div>
  );
}

/**
 * The waiter in charge of a table (managers, the MD): the customer there now and the next ones, and
 * their orders, go to them. Replacing a waiter needs the reason (it stays in the table's history);
 * `onTransfer` hands the customer there now to a colleague instead.
 */
export function TableWaiter({ locationId, waiter, free, onTransfer }: { locationId: string; waiter: { id: string; name: string } | null; free?: boolean; onTransfer?: () => void }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [waiters, setWaiters] = useState<{ id: string; name: string }[] | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const load = () => { setOpen(!open); if (!waiters) waitersAction().then((r) => (r.ok ? setWaiters(r.data) : toast.error(r.error))); };
  // Replacing the waiter there now: say why.
  const needsReason = !!waiter && reason.trim().length < 3;
  const pick = (id: string | null) => start(async () => {
    const r = await assignTableWaiterAction({ locationId, waiterId: id, reason: reason.trim() || undefined });
    if (r.ok) { toast.success(r.data.to ? `${r.data.to} is serving ${r.data.table}.` : `${r.data.table}: any waiter.`); setOpen(false); setReason(""); router.refresh(); } else toast.error(r.error);
  });
  const clean = (n: string) => n.replace(/\s*\(.*\)/, "");
  return (
    <section className="rounded-2xl border border-border/70 bg-muted/10 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="flex min-w-0 items-center gap-2 text-sm"><UserRoundCheck className="size-4 shrink-0 text-emerald-300" />{waiter ? <span>Waiter for this table: <strong>{clean(waiter.name)}</strong>{free && <span className="block text-xs text-muted-foreground">The next customer seated here goes to them.</span>}</span> : <span className="text-muted-foreground">{free ? "No waiter set — any waiter can serve it" : "No waiter yet — any waiter can serve it"}</span>}</p>
        <div className="flex gap-1.5">
          {waiter && onTransfer && <Button size="sm" variant="outline" onClick={onTransfer}><ArrowRightLeft />Transfer</Button>}
          <Button size="sm" variant="outline" onClick={load}>{waiter ? "Change" : "Choose a waiter"}</Button>
        </div>
      </div>
      {open && (
        !waiters ? <p className="mt-2 flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Loading waiters…</p> : (
          <div className="mt-2 space-y-2">
            {waiter && (
              <Input value={reason} onChange={(e) => setReason(e.target.value)} maxLength={200} className="h-9"
                placeholder={`Why replace ${clean(waiter.name).split(/\s+/)[0]}? e.g. went home, other section`} aria-label="Why you change the waiter" />
            )}
            <div className="flex flex-wrap gap-1.5">
              {waiters.map((w) => <Button key={w.id} size="sm" variant={waiter?.id === w.id ? "default" : "outline"} disabled={pending || waiter?.id === w.id || needsReason} onClick={() => pick(w.id)}>{clean(w.name)}</Button>)}
              {waiter && <Button size="sm" variant="ghost" disabled={pending || needsReason} onClick={() => pick(null)}>Any waiter</Button>}
              {waiters.length === 0 && <p className="text-xs text-muted-foreground">No waiters set up.</p>}
            </div>
            {waiter && needsReason && waiters.length > 0 && <p className="text-[11px] text-muted-foreground">Say why first — it stays in the table&apos;s history.</p>}
          </div>
        )
      )}
    </section>
  );
}
