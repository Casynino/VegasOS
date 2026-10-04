"use client";

import { useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowLeftRight, Loader2, MessageSquareWarning, UserRoundCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { assignOrderAction, logComplaintAction, waitersAction } from "@/app/staff/(app)/manager-actions";
import { changeOrderBillingAction } from "../actions";
import type { PortalOrder, RoomChoice } from "./types";

const firstName = (n: string) => n.replace(/\s*\(.*\)/, "").split(" ")[0];

/**
 * On an order, for managers, the MD and the owner: hand it to a particular waiter (it is late,
 * the waiter on that area is busy — moving it from one waiter to another needs the reason), log a
 * customer's complaint about it — kept in the order's history and followed on the Requests page —
 * and correct who pays it, with the reason.
 */
export function ManagerOrderTools({ o, done, rooms }: {
  o: PortalOrder; done: boolean;
  /** Every staying room (they check stays) — null when this person cannot. */
  rooms: RoomChoice[] | null;
}) {
  const router = useRouter();
  const [open, setOpen] = useState<"assign" | "complaint" | "bill" | null>(null);
  const [waiters, setWaiters] = useState<{ id: string; name: string; role: string }[] | null>(null);
  // The waiter chosen (null: any waiter) and why — required when it already has a waiter.
  const [pick, setPick] = useState<string | null | undefined>(undefined);
  const [why, setWhy] = useState("");
  const [text, setText] = useState("");
  const [priority, setPriority] = useState<"NORMAL" | "HIGH" | "URGENT">("HIGH");
  const [pending, start] = useTransition();
  useEffect(() => {
    if (open !== "assign" || waiters) return;
    waitersAction().then((r) => (r.ok ? setWaiters(r.data) : toast.error(r.error)));
  }, [open, waiters]);
  const from = o.assignedTo ? firstName(o.assignedTo.name) : null;
  const reassign = !!from;
  const toggle = (what: "assign" | "complaint" | "bill") => { setOpen(open === what ? null : what); setPick(undefined); setWhy(""); };
  const assign = () => start(async () => {
    if (pick === undefined) return;
    const r = await assignOrderAction({ orderId: o.id, waiterId: pick, reason: why.trim() || undefined });
    if (r.ok) { toast.success(r.data.to ? `${firstName(r.data.to)} is serving ${o.number.replace(/^ORD-\d{4}-0*/, "#")}.` : `${o.number} is free for any waiter.`); setOpen(null); setPick(undefined); setWhy(""); router.refresh(); } else toast.error(r.error, { duration: 8000 });
  });
  const chosen = pick ? waiters?.find((w) => w.id === pick) : null;
  const complain = () => start(async () => {
    const r = await logComplaintAction({ orderId: o.id, description: text, priority });
    if (r.ok) { toast.success(r.message ?? "Complaint logged."); setOpen(null); setText(""); router.refresh(); } else toast.error(r.error);
  });
  const btn = (on: boolean) => cn("inline-flex h-9 items-center gap-1.5 rounded-xl border px-3 text-xs font-semibold transition-colors", on ? "border-[oklch(0.75_0.12_80)] bg-[oklch(0.75_0.12_80/0.15)]" : "border-border hover:bg-muted");
  const canBill = !!rooms && billMovable(o, rooms);
  return (
    <div className="mt-4 space-y-2.5 rounded-2xl border border-[oklch(0.75_0.12_80/0.35)] bg-[oklch(0.75_0.12_80/0.05)] p-3">
      <p className="text-xs font-semibold">Your decisions <span className="font-normal text-muted-foreground">· recorded with your name</span></p>
      <div className="flex flex-wrap gap-2">
        {!done && <button type="button" onClick={() => toggle("assign")} className={btn(open === "assign")}><UserRoundCheck className="size-3.5" />{from ? `Waiter · ${from} · change` : "Give to a waiter"}</button>}
        <button type="button" onClick={() => toggle("complaint")} className={btn(open === "complaint")}><MessageSquareWarning className="size-3.5" />Customer complaint{o.complaints.total ? ` · ${o.complaints.open} open` : ""}</button>
        {canBill && <button type="button" onClick={() => toggle("bill")} className={btn(open === "bill")}><ArrowLeftRight className="size-3.5" />Change who pays · {o.settlement === "ROOM" ? `Room ${o.room ?? ""}`.trim() : "Restaurant"}</button>}
        {o.complaints.total > 0 && <Link href="/staff/requests" className="inline-flex h-9 items-center px-2 text-xs font-semibold text-[oklch(0.8_0.1_82)] hover:underline">Follow complaints →</Link>}
      </div>
      {open === "assign" && (
        !waiters ? <p className="flex items-center gap-2 text-xs text-muted-foreground"><Loader2 className="size-3.5 animate-spin" />Loading waiters…</p> : (
          <div className="space-y-2">
            <div className="flex flex-wrap gap-1.5">
              {waiters.map((w) => {
                const now = o.assignedTo?.id === w.id;
                return (
                  <button key={w.id} type="button" disabled={pending || now} onClick={() => setPick(w.id)} aria-pressed={pick === w.id}
                    className={cn("rounded-lg border px-2.5 py-1.5 text-xs font-medium transition-colors", now ? "cursor-default border-emerald-500/50 bg-emerald-500/10 text-emerald-700 dark:text-emerald-300"
                      : pick === w.id ? "border-[oklch(0.75_0.12_80)] bg-[oklch(0.75_0.12_80/0.15)]" : "border-border hover:bg-muted")}>{w.name.replace(/\s*\(.*\)/, "")}{now ? " · now" : ""}</button>
                );
              })}
              {o.assignedTo && (
                <button type="button" disabled={pending} onClick={() => setPick(null)} aria-pressed={pick === null}
                  className={cn("rounded-lg border px-2.5 py-1.5 text-xs transition-colors", pick === null ? "border-[oklch(0.75_0.12_80)] bg-[oklch(0.75_0.12_80/0.15)] font-medium" : "border-transparent text-muted-foreground hover:bg-muted")}>Any waiter</button>
              )}
              {waiters.length === 0 && <p className="text-xs text-muted-foreground">No waiters set up.</p>}
            </div>
            {pick !== undefined && (
              <>
                <div className="flex flex-wrap items-center gap-1.5">
                  <input value={why} onChange={(e) => setWhy(e.target.value)} aria-label="Why"
                    placeholder={from ? `Why? e.g. ${from} went on break · other section` : "Why? (optional) e.g. a regular — they ask for them"}
                    className="h-9 min-w-0 flex-1 rounded-xl border border-border/80 bg-background/60 px-3 text-sm outline-none focus:border-[oklch(0.78_0.12_80)]" />
                  <button type="button" disabled={pending || (reassign && why.trim().length < 3)} onClick={assign}
                    className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-500 disabled:opacity-50">
                    {pending && <Loader2 className="size-3.5 animate-spin" />}{pick === null ? "Free it for any waiter" : `Give it to ${chosen ? firstName(chosen.name) : "them"}`}
                  </button>
                </div>
                {from && <p className="text-[11px] text-muted-foreground">It moves from {from} — say why; the reason stays in the order&apos;s history.</p>}
              </>
            )}
          </div>
        )
      )}
      {open === "bill" && rooms && <ChangeWhoPays o={o} rooms={rooms} onDone={() => setOpen(null)} />}
      {open === "complaint" && (
        <div className="space-y-2">
          <textarea value={text} onChange={(e) => setText(e.target.value)} rows={2} placeholder="What is wrong? e.g. food came cold after 50 minutes"
            className="w-full rounded-xl border border-border/80 bg-background/60 px-3 py-2 text-sm outline-none focus:border-[oklch(0.78_0.12_80)]" />
          <div className="flex flex-wrap items-center gap-1.5">
            {(["NORMAL", "HIGH", "URGENT"] as const).map((p) => (
              <button key={p} type="button" onClick={() => setPriority(p)} className={cn("rounded-lg border px-2.5 py-1 text-[11px] font-semibold", priority === p ? "border-rose-500 bg-rose-500/15" : "border-border hover:bg-muted")}>{p === "NORMAL" ? "Normal" : p === "HIGH" ? "High" : "Urgent"}</button>
            ))}
            <button type="button" disabled={pending || text.trim().length < 5} onClick={complain}
              className="ml-auto inline-flex h-9 items-center gap-1.5 rounded-xl bg-rose-600 px-3 text-xs font-semibold text-white hover:bg-rose-500 disabled:opacity-50">{pending && <Loader2 className="size-3.5 animate-spin" />}Log complaint</button>
          </div>
        </div>
      )}
    </div>
  );
}

const RESTAURANT = "restaurant";
/** Who pays can still change: on a staying guest's room (back to the restaurant, or another room), or not paid at all yet and a room to put it on. */
const billMovable = (o: PortalOrder, rooms: RoomChoice[]) => o.status !== "CANCELLED" && o.total != null
  && (o.settlement === "ROOM" ? !!o.reservation?.staying : !o.paid && (o.stays.length > 0 || rooms.length > 0));

/**
 * Change who pays an order (managers, the MD, reception — always with the reason): off the room
 * and back to the restaurant bill (to pay there), or onto a room — the customer's own first, or
 * any staying room. Nothing is charged twice; the order's history says from where to where.
 */
export function ChangeWhoPays({ o, rooms, onDone }: { o: PortalOrder; rooms: RoomChoice[]; onDone?: () => void }) {
  const router = useRouter();
  const [to, setTo] = useState("");
  const [why, setWhy] = useState("");
  const [pending, start] = useTransition();
  const onRoom = o.settlement === "ROOM";
  const current = onRoom ? o.reservation?.id ?? null : null;
  const own = o.stays.filter((s) => s.id !== current);
  const others = rooms.filter((r) => r.id !== current && !own.some((s) => s.id === r.id));
  const change = () => start(async () => {
    const r = await changeOrderBillingAction({ id: o.id, to: to === RESTAURANT ? null : to, reason: why });
    if (r.ok) { toast.success(`${o.number.replace(/^ORD-\d{4}-0*/, "#")}: ${r.data.from} → ${r.data.to}.`); setTo(""); setWhy(""); onDone?.(); router.refresh(); } else toast.error(r.error, { duration: 8000 });
  });
  const chip = (on: boolean) => cn("rounded-lg border px-2.5 py-1.5 text-xs font-medium", on ? "border-violet-500 bg-violet-500/15" : "border-border hover:bg-muted");
  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">Now: <span className="font-semibold text-foreground">{onRoom ? `on Room ${o.room ?? ""}'s bill` : "the restaurant bill"}</span> · {o.total != null ? `TZS ${o.total.toLocaleString("en-US")}` : ""}</p>
      <div className="flex flex-wrap items-center gap-1.5">
        {onRoom && <button type="button" onClick={() => setTo(RESTAURANT)} className={chip(to === RESTAURANT)}>Back to the restaurant bill</button>}
        {own.map((s) => <button key={s.id} type="button" onClick={() => setTo(s.id)} className={chip(to === s.id)}>Room {s.rooms} · {s.guestName.split(" ")[0]}</button>)}
        {others.length > 0 && (
          <select value={others.some((r) => r.id === to) ? to : ""} onChange={(e) => setTo(e.target.value)} aria-label="Another staying room"
            className="h-8 min-w-0 flex-1 rounded-lg border border-border bg-background px-2 text-xs">
            <option value="">{own.length || onRoom ? "Another staying room…" : "Choose a staying room…"}</option>
            {others.map((r) => <option key={r.id} value={r.id}>{r.label}</option>)}
          </select>
        )}
      </div>
      {to && to !== RESTAURANT && !own.some((s) => s.id === to) && <p className="text-[11px] text-amber-700 dark:text-amber-300">Not this customer&apos;s room — say why it goes there.</p>}
      <div className="flex flex-wrap items-center gap-1.5">
        <input value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Why? e.g. the guest in 305 pays for their friend"
          className="h-9 min-w-0 flex-1 rounded-xl border border-border/80 bg-background/60 px-3 text-sm outline-none focus:border-[oklch(0.78_0.12_80)]" />
        <button type="button" disabled={pending || !to || why.trim().length < 3} onClick={change}
          className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-violet-600 px-3 text-xs font-semibold text-white hover:bg-violet-500 disabled:opacity-50">{pending && <Loader2 className="size-3.5 animate-spin" />}Move the bill</button>
      </div>
    </div>
  );
}
