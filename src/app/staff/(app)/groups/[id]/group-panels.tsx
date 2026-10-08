"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, BedDouble, CheckCircle2, FileCheck2, FileStack, FileText, ListChecks, Loader2, LogIn, LogOut, Pencil, Plus, Printer, Wallet, XCircle } from "lucide-react";
import { GROUP_TYPES } from "@/lib/group-types";
import { cn } from "@/lib/utils";
import { formatTZS } from "@/lib/format";
import { RESERVATION_STATUS_META } from "@/lib/reservation-status";
import { INVOICE_STATUS_META } from "@/lib/invoice-status";
import { PAYMENT_TERMS, termsLabel } from "@/lib/billing";
import { useT } from "@/i18n/client";
import { msg } from "@/i18n/msg";
import type { GroupView, RoomResult } from "@/server/services/groups";
import type { PayAccount } from "@/lib/pay-account";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { NativeSelect } from "@/components/ui/native-select";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AccountSelect } from "@/components/staff/finance/account-select";
import { checkAvailabilityAction, type AvailabilityResult } from "../../reservations/actions";
import {
  addGroupRoomAction, cancelGroupAction, groupCheckInAction, groupCheckOutAction, groupInvoiceAction, groupPaymentAction, finalizeGroupAction, updateGroupAction,
} from "../actions";

type Perms = { checkIn: boolean; checkOut: boolean; override: boolean; invoice: boolean; pay: boolean; edit: boolean; book: boolean; cancel: boolean };

/**
 * The group's rooms with a tick box each, and the group actions on the ticked
 * rooms: check in (ready ones), check out, invoice together or one per room.
 * Results say room by room what happened — one room not ready never blocks the others.
 */
export function GroupRooms({ g, perms, today }: { g: GroupView; perms: Perms; today: string }) {
  const t = useT();
  const router = useRouter();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [pending, start] = useTransition();
  const [results, setResults] = useState<{ title: string; rows: RoomResult[] } | null>(null);
  const [out, setOut] = useState<{ early: string; reason: string; allow: boolean } | null>(null);
  const toggle = (id: string) => setPicked((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const ids = [...picked];
  const due = g.rooms.filter((r) => (r.status === "RESERVED" || r.status === "CONFIRMED") && r.arrival <= today);
  const ready = due.filter((r) => r.room && ["AVAILABLE", "READY", "RESERVED"].includes(r.room.status));
  const inHouse = g.rooms.filter((r) => r.status === "CHECKED_IN");
  const pickedIn = ids.filter((id) => inHouse.some((r) => r.id === id));
  // Rooms the group pays for that are still staying or to come; the last of them closes the group's stay.
  const openGroup = g.rooms.filter((r) => r.billTo === "GROUP" && ["RESERVED", "CONFIRMED", "CHECKED_IN"].includes(r.status));
  const remainingAfter = openGroup.filter((r) => !pickedIn.includes(r.id)).length;
  const finalOut = !g.finalizedAt && openGroup.length > 0 && remainingAfter === 0;

  function show(title: string, res: { ok: true; data: RoomResult[] } | { ok: false; error: string }) {
    if (!res.ok) { toast.error(res.error, { duration: 8000 }); return; }
    const done = res.data.filter((x) => x.ok).length;
    if (done && done === res.data.length) toast.success(t.plural(done, "{title}: {n} room done.", "{title}: {n} rooms done.", { title }));
    else setResults({ title, rows: res.data });
    setPicked(new Set());
    router.refresh();
  }
  const checkIn = (only?: string[]) => start(async () => show(t("Check-in"), await groupCheckInAction({ groupId: g.id, reservationIds: only })));
  const checkOut = () => start(async () => {
    const res = await groupCheckOutAction({ groupId: g.id, reservationIds: pickedIn, allowBalance: out?.allow, overrideReason: out?.reason, earlyReason: out?.early });
    setOut(null);
    // The last guests have left: confirm the final group invoice straight away.
    if (finalOut && res.ok && res.data.every((x) => x.ok)) { setPicked(new Set()); router.push(`/staff/groups/${g.id}?final=1`); router.refresh(); return; }
    show(t("Check-out"), res);
  });
  const invoice = (mode: "COMBINED" | "SEPARATE") => start(async () => {
    const res = await groupInvoiceAction({ groupId: g.id, reservationIds: ids, mode });
    if (res.ok) { toast.success(t.plural(res.data.length, "{n} invoice: {numbers}", "{n} invoices: {numbers}", { numbers: res.data.map((x) => x.number).join(", ") })); setPicked(new Set()); router.refresh(); }
    else toast.error(res.error, { duration: 8000 });
  });
  const allPicked = picked.size === g.rooms.length && g.rooms.length > 0;

  return (
    <section className="overflow-hidden rounded-3xl border border-border/70 bg-card">
      <div className="flex flex-wrap items-center gap-2 border-b border-border/70 px-4 py-3 sm:px-5">
        <h2 className="mr-auto text-base font-semibold">{t("Rooms · {n}", { n: g.totals.rooms })}</h2>
        {perms.checkIn && due.length > 0 && (
          <Button size="sm" disabled={pending || ready.length === 0} onClick={() => checkIn()} title={ready.length < due.length ? t("{n} room(s) due today are not ready yet", { n: due.length - ready.length }) : undefined}>
            {pending ? <Loader2 className="animate-spin" /> : <LogIn />}{ready.length < due.length ? t("Check in all ready rooms ({n} of {total})", { n: ready.length, total: due.length }) : t("Check in all ready rooms ({n})", { n: ready.length })}
          </Button>
        )}
        {perms.checkIn && picked.size > 0 && <Button size="sm" variant="outline" disabled={pending} onClick={() => checkIn(ids)}><LogIn />{t("Check in ticked")}</Button>}
        {perms.checkOut && pickedIn.length > 0 && <Button size="sm" variant="outline" disabled={pending} onClick={() => setOut({ early: "", reason: "", allow: false })}><LogOut />{t("Check out ticked ({n})", { n: pickedIn.length })}</Button>}
        {perms.invoice && picked.size > 0 && (
          <>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => invoice("COMBINED")}><FileStack />{t("One invoice for ticked")}</Button>
            <Button size="sm" variant="outline" disabled={pending} onClick={() => invoice("SEPARATE")}><FileText />{t("Invoice each ticked room")}</Button>
          </>
        )}
      </div>
      <div className="overflow-x-auto">
        <table data-stack className="w-full min-w-[56rem] text-sm">
          <thead className="bg-muted/40 text-xs text-muted-foreground">
            <tr>
              <th className="w-10 px-4 py-2 text-left"><input type="checkbox" aria-label={t("Tick all rooms")} checked={allPicked} onChange={() => setPicked(allPicked ? new Set() : new Set(g.rooms.map((r) => r.id)))} /></th>
              <th className="px-2 py-2 text-left font-medium">{t("Room")}</th>
              <th className="px-2 py-2 text-left font-medium">{t("Guests")}</th>
              <th className="px-2 py-2 text-left font-medium">{t("Stay")}</th>
              <th className="px-2 py-2 text-left font-medium">{t("Status")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("Room")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("Extras")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("Paid")}</th>
              <th className="px-2 py-2 text-right font-medium">{t("Owed")}</th>
              <th className="px-4 py-2 text-left font-medium">{t("Bill")}</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/60">
            {g.rooms.map((r) => {
              const meta = RESERVATION_STATUS_META[r.status];
              const ready = r.room && ["AVAILABLE", "READY", "RESERVED"].includes(r.room.status);
              return (
                <tr key={r.id} className={cn("align-top transition-colors hover:bg-muted/30", picked.has(r.id) && "bg-[oklch(0.75_0.13_80)]/[0.06]")}>
                  <td className="px-4 py-3"><input type="checkbox" aria-label={t("Tick room {room}", { room: r.room?.number })} checked={picked.has(r.id)} onChange={() => toggle(r.id)} /></td>
                  <td className="px-2 py-3">
                    <Link href={`/staff/reservations/${r.id}`} className="inline-flex items-center gap-2 font-semibold hover:underline">
                      <span className="grid size-9 place-items-center rounded-xl bg-[#17130e] text-sm font-bold tabular-nums text-[#f0cf86] dark:bg-gold dark:text-[#17130e]">{r.room?.number ?? "—"}</span>
                    </Link>
                    <p className="mt-1 text-[11px] text-muted-foreground">{r.room?.type ? t(r.room.type) : null}</p>
                  </td>
                  <td className="px-2 py-3">
                    <Link href={`/staff/reservations/${r.id}`} className="font-medium hover:underline">{r.guest.fullName}</Link>
                    {r.occupants.length > 0 && <p className="text-xs text-muted-foreground">+ {r.occupants.map((o) => o.fullName).join(", ")}</p>}
                    <p className="text-[11px] text-muted-foreground"><span className="font-mono">{r.reference}</span> · {t.plural(r.adults + r.children, "{n} guest", "{n} guests")}</p>
                  </td>
                  <td className="px-2 py-3 text-xs">
                    {t.date(r.arrival)} → {t.date(r.departure)}
                    <span className="block text-muted-foreground">{t.plural(r.nights, "{n} night", "{n} nights")} · {t("{price}/night", { price: formatTZS(r.rate - r.discount) })}</span>
                  </td>
                  <td className="px-2 py-3">
                    <span className={cn("inline-flex whitespace-nowrap rounded-full border px-2 py-0.5 text-[11px] font-semibold", meta.className)}>{t(meta.label)}</span>
                    {(r.status === "RESERVED" || r.status === "CONFIRMED") && r.arrival <= today && (
                      <span className={cn("mt-1 block text-[11px]", ready ? "text-emerald-600 dark:text-emerald-400" : "text-orange-600 dark:text-orange-400")}>{ready ? t("Room ready") : t("Room not ready")}</span>
                    )}
                  </td>
                  <td className="px-2 py-3 text-right tabular-nums">{formatTZS(r.roomCharge).replace("TZS ", "")}</td>
                  <td className="px-2 py-3 text-right tabular-nums">{r.extras ? formatTZS(r.extras).replace("TZS ", "") : "—"}</td>
                  <td className="px-2 py-3 text-right tabular-nums">{r.paid ? formatTZS(r.paid).replace("TZS ", "") : "—"}</td>
                  <td className={cn("px-2 py-3 text-right font-semibold tabular-nums", r.billTo !== "GROUP" && r.balance > 0 ? "text-rose-600 dark:text-rose-400" : "")}>
                    {r.balance > 0 ? formatTZS(r.balance).replace("TZS ", "") : "—"}
                    {r.billTo === "GROUP" && r.balance > 0 && <span className="block text-[10px] font-normal text-muted-foreground">{t("to the group bill")}</span>}
                  </td>
                  <td className="px-4 py-3 text-xs">
                    {r.billTo === "GROUP" ? <span className="font-medium text-violet-700 dark:text-violet-300">{t("Group pays")}</span> : <span className="font-medium text-amber-700 dark:text-amber-400">{t("Own bill")}</span>}
                    {r.invoices.map((i) => (
                      <Link key={i.id} href={`/staff/invoices/${i.id}`} className="mt-0.5 block font-mono text-[11px] text-muted-foreground hover:underline">{i.number} · {t(INVOICE_STATUS_META[i.status].label).toLowerCase()}</Link>
                    ))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      <Dialog open={!!out} onOpenChange={(o) => !o && setOut(null)}>
        <DialogContent>
          <DialogHeader icon={<LogOut />} eyebrow={t("Group booking")} tone="sky">
            <DialogTitle>{finalOut ? t("Final group check-out") : t.plural(pickedIn.length, "Check out {n} room", "Check out {n} rooms")}</DialogTitle>
            <DialogDescription>
              {finalOut
                ? t("These are the last active guests in this group. All room, restaurant, bar and service charges will then go on one final invoice — you confirm it next.")
                : t.plural(remainingAfter, "Group check-out in progress — {n} room will still be staying or to come. Their bills stay on the group's running bill; the final invoice waits for the last room.", "Group check-out in progress — {n} rooms will still be staying or to come. Their bills stay on the group's running bill; the final invoice waits for the last room.")}
            </DialogDescription>
          </DialogHeader>
          <ul className="space-y-1 text-sm">
            {g.rooms.filter((r) => pickedIn.includes(r.id)).map((r) => (
              <li key={r.id} className="flex justify-between gap-2 rounded-lg bg-muted/50 px-3 py-1.5">
                <span>{t("Room {room}", { room: r.room?.number })} · {r.guest.fullName}</span>
                <span className={cn("tabular-nums", r.billTo !== "GROUP" && r.balance > 0 && "font-semibold text-rose-600 dark:text-rose-400")}>{r.billTo === "GROUP" ? t("Group pays") : r.balance > 0 ? t("Owes {amount}", { amount: formatTZS(r.balance) }) : t("Paid")}</span>
              </li>
            ))}
          </ul>
          {g.rooms.some((r) => pickedIn.includes(r.id) && r.departure > today) && (
            <div className="space-y-1.5"><p className="text-xs font-medium">{t("Leaving before the booked date — reason")}</p><Input value={out?.early ?? ""} onChange={(e) => setOut((o) => o && { ...o, early: e.target.value })} placeholder={t("e.g. change of plans")} /></div>
          )}
          {perms.override && g.rooms.some((r) => pickedIn.includes(r.id) && r.billTo !== "GROUP" && r.balance > 0) && (
            <div className="space-y-1.5 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3">
              <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={!!out?.allow} onChange={(e) => setOut((o) => o && { ...o, allow: e.target.checked })} />{t("Let rooms leave owing (manager)")}</label>
              {out?.allow && <Textarea rows={2} value={out.reason} onChange={(e) => setOut((o) => o && { ...o, reason: e.target.value })} placeholder={t("Reason (required)")} />}
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOut(null)}>{t("Back")}</Button>
            <Button disabled={pending} onClick={checkOut}>{pending ? <Loader2 className="animate-spin" /> : <LogOut />}{finalOut ? t("Final check-out") : t("Check out")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={!!results} onOpenChange={(o) => !o && setResults(null)}>
        <DialogContent>
          <DialogHeader icon={<ListChecks />} eyebrow={t("Group booking")} tone="sky"><DialogTitle>{t("{title} — room by room", { title: results?.title ?? "" })}</DialogTitle></DialogHeader>
          <ul className="space-y-1.5 text-sm">
            {results?.rows.map((x) => (
              <li key={x.reservationId} className="flex items-start gap-2 rounded-lg bg-muted/50 px-3 py-2">
                {x.ok ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <XCircle className="mt-0.5 size-4 shrink-0 text-rose-600" />}
                <span className="min-w-0 flex-1"><strong>{t("Room {room}", { room: x.room })}</strong> · {x.guest}<span className="block text-xs text-muted-foreground">{t(x.message)}</span></span>
              </li>
            ))}
          </ul>
          <DialogFooter><Button onClick={() => setResults(null)}>{t("OK")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </section>
  );
}

/** The payer pays the group: one payment, spread over the group's issued invoices. */
export function GroupPayment({ groupId, owed, accounts, drafts }: { groupId: string; owed: number; accounts: PayAccount[]; drafts: { id: string; number: string; net: number }[] }) {
  const t = useT();
  const router = useRouter();
  const [pending, start] = useTransition();
  // The amount due is filled in — staff only change it for a part payment.
  const [amount, setAmount] = useState(owed ? String(owed) : "");
  const [account, setAccount] = useState(accounts[0]?.id ?? "");
  const [ref, setRef] = useState("");
  const pay = () => start(async () => {
    const res = await groupPaymentAction({ groupId, amount: Number(amount || owed), accountId: account, reference: ref || undefined });
    if (res.ok) { toast.success(t("Payment recorded on {invoices}.", { invoices: res.data.applied.map((a) => a.invoice).join(", ") })); setRef(""); router.refresh(); }
    else toast.error(res.error, { duration: 8000 });
  });
  return (
    <div className="space-y-3">
      {drafts.map((d) => (
        <p key={d.id} className="rounded-xl border border-dashed border-border p-2.5 text-xs">
          {t.rich("Running bill <b>{number}</b> · {amount} — rooms join it as they check out; it becomes the final invoice when the group is finalized.", { b: (c) => <strong className="font-mono">{c}</strong> }, { number: d.number, amount: formatTZS(d.net) })}
        </p>
      ))}
      {owed > 0 ? (
        <div className="grid gap-2">
          <label className="space-y-1"><span className="text-xs text-muted-foreground">{t("Amount received · due {amount}", { amount: formatTZS(owed) })}</span>
            <Input type="number" min={1} max={owed} step={1000} value={amount} onChange={(e) => setAmount(e.target.value)} aria-label={t("Amount received")} className="h-10 text-base font-semibold tabular-nums" /></label>
          <AccountSelect accounts={accounts} value={account} onChange={setAccount} />
          <Input value={ref} onChange={(e) => setRef(e.target.value)} placeholder={t("Reference (bank ref, M-Pesa code…)")} aria-label={t("Reference")} className="h-9" />
          <Button disabled={pending || !account || !(Number(amount) > 0)} onClick={pay}>{pending ? <Loader2 className="animate-spin" /> : <Wallet />}{Number(amount) > 0 && Number(amount) < owed ? t("Confirm payment (part)") : t("Confirm payment")}</Button>
        </div>
      ) : <p className="text-xs text-muted-foreground">{t("Nothing to pay on the group's issued invoices.")}</p>}
    </div>
  );
}

/** Add one more room to the group: pick a free room or type for the group's dates, name the guest. */
export function AddGroupRoom({ groupId, arrival, departure, source }: { groupId: string; arrival: string; departure: string; source: string }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [avail, setAvail] = useState<AvailabilityResult | null>(null);
  const [pending, start] = useTransition();
  const [f, setF] = useState({ typeId: "", roomId: "", guest: "", phone: "", adults: 1, children: 0, ownBill: false });
  const ty = useMemo(() => avail?.types.find((x) => x.id === f.typeId), [avail, f.typeId]);
  const openIt = () => {
    setOpen(true);
    start(async () => {
      const res = await checkAvailabilityAction({ stay: { kind: "overnight", arrivalDate: arrival, departureDate: departure }, sourceCode: source });
      if (res.ok) { setAvail(res.data); setF((x) => ({ ...x, typeId: res.data.types.find((y) => y.rooms.length)?.id ?? "" })); } else toast.error(res.error);
    });
  };
  const save = () => start(async () => {
    const res = await addGroupRoomAction({
      groupId, roomTypeId: f.typeId, roomId: f.roomId || null, adults: f.adults, children: f.children, ownBill: f.ownBill, occupants: [],
      guest: f.guest.trim() ? { fullName: f.guest.trim(), phone: f.phone.trim() || undefined } : null,
    });
    if (res.ok) { toast.success(t("Room added — {reference}", { reference: res.data.reference })); setOpen(false); router.refresh(); } else toast.error(res.error, { duration: 8000 });
  });
  return (
    <>
      <Button size="sm" variant="outline" onClick={openIt}><Plus />{t("Add room")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader icon={<BedDouble />} eyebrow={t("Group booking")} tone="sky"><DialogTitle>{t("Add a room to the group")}</DialogTitle><DialogDescription>{t.date(arrival)} → {t.date(departure)} · {t("availability is checked again when you save.")}</DialogDescription></DialogHeader>
          {!avail ? <p className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="size-4 animate-spin" />{t("Finding free rooms…")}</p> : (
            <div className="space-y-3">
              <NativeSelect aria-label={t("Room type")} value={f.typeId} onChange={(e) => setF({ ...f, typeId: e.target.value, roomId: "" })}>
                {avail.types.map((x) => <option key={x.id} value={x.id} disabled={!x.rooms.length}>{t(x.name)} — {t("{n} free", { n: x.rooms.length })} · {t("{price}/night", { price: formatTZS(x.netPerNight) })}</option>)}
              </NativeSelect>
              {ty && (
                <div className="flex flex-wrap gap-1.5">
                  <button type="button" onClick={() => setF({ ...f, roomId: "" })} className={cn("rounded-lg border px-2.5 py-1.5 text-xs", !f.roomId ? "border-foreground bg-foreground text-background" : "border-border")}>{t("Any")}</button>
                  {ty.rooms.map((r) => <button key={r.id} type="button" onClick={() => setF({ ...f, roomId: r.id })} className={cn("rounded-lg border px-2.5 py-1.5 text-xs font-semibold tabular-nums", f.roomId === r.id ? "border-foreground bg-foreground text-background" : "border-border")}>{r.number}</button>)}
                </div>
              )}
              <div className="grid grid-cols-[1fr_9rem] gap-2">
                <Input value={f.guest} onChange={(e) => setF({ ...f, guest: e.target.value })} placeholder={t("Guest in this room (blank = contact)")} aria-label={t("Guest")} />
                <Input value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} placeholder={t("Phone")} aria-label={t("Phone")} inputMode="tel" />
              </div>
              <div className="flex items-center gap-3 text-sm">
                <label className="flex items-center gap-1.5">{t("Adults")} <Input type="number" min={1} max={ty?.maxAdults ?? 2} value={f.adults} onChange={(e) => setF({ ...f, adults: Number(e.target.value) || 1 })} className="h-8 w-16" /></label>
                <label className="flex items-center gap-1.5">{t("Kids")} <Input type="number" min={0} max={ty?.maxChildren ?? 0} value={f.children} onChange={(e) => setF({ ...f, children: Number(e.target.value) || 0 })} className="h-8 w-16" /></label>
                <label className="ml-auto flex items-center gap-1.5 text-xs"><input type="checkbox" checked={f.ownBill} onChange={(e) => setF({ ...f, ownBill: e.target.checked })} />{t("Pays own bill")}</label>
              </div>
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => setOpen(false)}>{t("Back")}</Button>
            <Button disabled={pending || !f.typeId} onClick={save}>{pending ? <Loader2 className="animate-spin" /> : <BedDouble />}{t("Add room")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Name, how the group is invoiced, payment terms and notes. */
export function EditGroup({ g, companies, canApproveCredit }: { g: GroupView; companies: { id: string; companyName: string }[]; canApproveCredit: boolean }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [pending, start] = useTransition();
  const [f, setF] = useState({ name: g.name, type: g.type, billing: g.billing, terms: g.paymentTermDays, notes: g.notes ?? "", contactName: g.contact.fullName, contactPhone: g.contact.phone ?? "", companyId: g.company?.id ?? "", creditReason: "" });
  const [p, setP] = useState({
    address: g.profile.address ?? "", billingAddress: g.profile.billingAddress ?? "", taxId: g.profile.taxId ?? "", vrn: g.profile.vrn ?? "",
    registrationNo: g.profile.registrationNo ?? "", billingEmail: g.profile.billingEmail ?? "", billingNotes: g.profile.billingNotes ?? "",
  });
  const pf = (k: keyof typeof p, label: string, extra?: React.ComponentProps<typeof Input>) => (
    <label className="block space-y-1"><span className="text-xs text-muted-foreground">{label}</span><Input value={p[k]} onChange={(e) => setP({ ...p, [k]: e.target.value })} className="h-9" {...extra} /></label>
  );
  const company = companies.find((c) => c.id === f.companyId) ?? null;
  const save = () => start(async () => {
    const res = await updateGroupAction({
      groupId: g.id, name: f.name, type: f.type, billing: f.billing, paymentTermDays: f.terms, notes: f.notes, profile: p,
      contact: !company && (f.contactName.trim() !== g.contact.fullName || f.contactPhone.trim() !== (g.contact.phone ?? "")) && f.contactName.trim().length >= 2
        ? { fullName: f.contactName.trim(), phone: f.contactPhone.trim() || undefined } : null,
      corporateCustomerId: f.companyId !== (g.company?.id ?? "") ? f.companyId || null : undefined,
      creditReason: f.creditReason || null,
    });
    if (res.ok) { toast.success(t("Group updated.")); setOpen(false); router.refresh(); } else toast.error(res.error, { duration: 9000 });
  });
  return (
    <>
      <Button size="sm" variant="outline" onClick={() => setOpen(true)}><Pencil />{t("Edit")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader icon={<Pencil />} eyebrow={t("Group booking")} tone="sky"><DialogTitle>{t("Edit group")}</DialogTitle><DialogDescription>{g.reference} · {t.plural(g.rooms.length, "{n} room", "{n} rooms")}</DialogDescription></DialogHeader>
          <div className="space-y-4">
            <label className="block space-y-1"><span className="text-xs font-medium">{t("Group / company name")}</span><Input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
            <div className="flex flex-wrap gap-1.5" role="radiogroup" aria-label={t("Kind of group")}>
              {GROUP_TYPES.map(({ v, label, icon: TI }) => (
                <button key={v} type="button" role="radio" aria-checked={f.type === v} onClick={() => setF({ ...f, type: v })}
                  className={cn("inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium", f.type === v ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
                  <TI className="size-3.5" />{t(label)}
                </button>
              ))}
            </div>

            <div className="space-y-3 rounded-2xl border border-border/70 p-3">
              <p className="text-sm font-semibold">{t("Who pays")}</p>
              <label className="block space-y-1"><span className="text-xs text-muted-foreground">{t("Company account — gets the invoice")}</span>
                <NativeSelect value={f.companyId} onChange={(e) => setF({ ...f, companyId: e.target.value })}>
                  <option value="">{t("No account — invoice in the group's name")}</option>
                  {companies.map((c) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
                </NativeSelect>
              </label>
              {!company && (
                <div className="grid gap-2 sm:grid-cols-2">
                  <label className="block space-y-1"><span className="text-xs text-muted-foreground">{t("Contact person")}</span><Input value={f.contactName} onChange={(e) => setF({ ...f, contactName: e.target.value })} className="h-9" /></label>
                  <label className="block space-y-1"><span className="text-xs text-muted-foreground">{t("Contact phone")}</span><Input value={f.contactPhone} onChange={(e) => setF({ ...f, contactPhone: e.target.value })} inputMode="tel" className="h-9" /></label>
                </div>
              )}
              <p className="rounded-xl bg-muted/60 px-3 py-2 text-xs">
                {t.rich("Invoice to <b>{payer}</b> — every group room's whole bill, room by room.", { b: (c) => <strong>{c}</strong> }, { payer: company?.companyName ?? (f.name.trim() || g.name) })}{company ? ` ${t("The contact comes from the company account.")}` : ""}
                {f.companyId !== (g.company?.id ?? "") && ` ${t("If the group already has an invoice, void it first.")}`}
              </p>
              {!company && <details className="rounded-xl border border-border/70 px-3 py-2" open={!g.profile.address && !g.profile.taxId}>
                <summary className="cursor-pointer text-xs font-medium">{t("Billing details on the invoice")}</summary>
                <div className="mt-2 grid gap-2 sm:grid-cols-2">
                  <>
                    {pf("billingEmail", t("Invoice email"), { type: "email" })}
                    {pf("address", t("Address"))}
                    <label className="block space-y-1 sm:col-span-2"><span className="text-xs text-muted-foreground">{t("Billing address (one line each; empty = the address)")}</span><Textarea rows={2} value={p.billingAddress} onChange={(e) => setP({ ...p, billingAddress: e.target.value })} /></label>
                    {pf("taxId", t("TIN"))}
                    {pf("vrn", t("VRN"))}
                    {pf("registrationNo", t("Registration no."))}
                  </>
                </div>
              </details>}
              {canApproveCredit && company && f.companyId !== (g.company?.id ?? "") && (
                <Input value={f.creditReason} onChange={(e) => setF({ ...f, creditReason: e.target.value })} placeholder={t("If over its credit limit: why allow it? (manager)")} className="h-9 text-xs" />
              )}
            </div>

            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">{t("Invoices")}</p>
              <div className="grid grid-cols-2 gap-2">
                {([["COMBINED", msg("One invoice for the group")], ["SEPARATE", msg("One invoice per room")]] as const).map(([v, label]) => (
                  <button key={v} type="button" onClick={() => setF({ ...f, billing: v })} className={cn("rounded-xl border px-3 py-2 text-left text-xs font-medium", f.billing === v ? "border-foreground bg-foreground text-background" : "border-border")}>{t(label)}</button>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs text-muted-foreground">{t("Pay within")}</span>
              {PAYMENT_TERMS.map((d) => <button key={d} type="button" onClick={() => setF({ ...f, terms: d })} className={cn("rounded-full border px-2.5 py-0.5 text-xs", f.terms === d ? "border-foreground bg-foreground text-background" : "border-border")}>{d === 0 ? t.ctx("terms", "Now") : termsLabel(d, t)}</button>)}
            </div>
            <Textarea rows={3} value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} placeholder={t("Notes for staff")} aria-label={t("Notes")} />
          </div>
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{t("Back")}</Button><Button disabled={pending} onClick={save}>{pending && <Loader2 className="animate-spin" />}{t("Save")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

/** Everyone has left: review the group's figures, then make the final group invoice. */
export function FinalizeGroup({ groupId, payer, review, autoOpen = false }: {
  groupId: string; payer: string;
  /** Opened right after the last guest checked out ("final group check-out"). */
  autoOpen?: boolean;
  review: { rooms: { id: string; room: string; guest: string; total: number }[]; guests: number; gross: number; discount: number; net: number; earlier: number };
}) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(autoOpen);
  const [pending, start] = useTransition();
  const close = () => { setOpen(false); if (autoOpen) router.replace(`/staff/groups/${groupId}`, { scroll: false }); };
  const go = () => start(async () => {
    const res = await finalizeGroupAction({ groupId });
    if (!res.ok) { toast.error(res.error, { duration: 9000 }); return; }
    toast.success(res.data.finalInvoice ? t("Final group invoice {number} is ready.", { number: res.data.finalInvoice.number }) : t("Group bill finalized."));
    setOpen(false);
    if (res.data.finalInvoice) router.push(`/staff/invoices/${res.data.finalInvoice.id}`); else router.refresh();
  });
  const row = (k: string, v: string, strong?: boolean) => <div className={cn("flex justify-between gap-3", strong && "border-t border-border pt-1.5 text-base font-semibold")}><dt className={strong ? "" : "text-muted-foreground"}>{k}</dt><dd className="tabular-nums">{v}</dd></div>;
  return (
    <>
      <Button onClick={() => setOpen(true)}><FileCheck2 />{t("Finalize group bill")}</Button>
      <Dialog open={open} onOpenChange={(o) => (o ? setOpen(true) : close())}>
        <DialogContent className="max-h-[90svh] overflow-y-auto sm:max-w-lg">
          <DialogHeader icon={<FileCheck2 />} eyebrow={t("Group bill")} tone="emerald">
            <DialogTitle>{autoOpen ? t("Final group check-out — {payer}", { payer }) : t("Final review — {payer}", { payer })}</DialogTitle>
            <DialogDescription>
              {t("This is the final check-out for this group. Generate the final consolidated invoice for all rooms and services? It is issued with its due date, ready to print and send; each room keeps its own bill inside it.")}
            </DialogDescription>
          </DialogHeader>
          <div className="grid grid-cols-2 gap-2 text-center">
            <div className="rounded-2xl bg-muted/60 p-2.5"><p className="text-2xl font-bold tabular-nums">{review.rooms.length}</p><p className="text-[11px] text-muted-foreground">{t("rooms")}</p></div>
            <div className="rounded-2xl bg-muted/60 p-2.5"><p className="text-2xl font-bold tabular-nums">{review.guests}</p><p className="text-[11px] text-muted-foreground">{t("guests")}</p></div>
          </div>
          <ul className="max-h-48 divide-y divide-border/60 overflow-y-auto rounded-2xl border border-border/70 text-sm">
            {review.rooms.map((r) => (
              <li key={r.id} className="flex justify-between gap-3 px-3 py-1.5"><span className="truncate"><strong className="tabular-nums">{r.room}</strong> · {r.guest}</span><span className="tabular-nums">{formatTZS(r.total)}</span></li>
            ))}
          </ul>
          <dl className="space-y-1.5 text-sm">
            {row(t("Total charges"), formatTZS(review.gross))}
            {review.discount > 0 && row(t("Discount"), `− ${formatTZS(review.discount)}`)}
            {row(t("Final amount"), formatTZS(review.net), true)}
            {review.earlier > 0 && row(t("Already on earlier invoices"), `− ${formatTZS(review.earlier)}`)}
            {review.earlier > 0 && row(t("On the final invoice"), formatTZS(Math.max(0, review.net - review.earlier)), true)}
          </dl>
          <DialogFooter>
            <Button variant="outline" onClick={close}>{t("Cancel")}</Button>
            <Button disabled={pending} onClick={go}>{pending ? <Loader2 className="animate-spin" /> : <FileCheck2 />}{t("Generate final invoice")}</Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function CancelGroup({ groupId, rooms }: { groupId: string; rooms: number }) {
  const t = useT();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  const cancel = () => start(async () => {
    const res = await cancelGroupAction({ groupId, reason });
    if (res.ok) { toast.success(t("{n} room(s) cancelled.", { n: res.data.filter((x) => x.ok).length })); setOpen(false); router.refresh(); } else toast.error(res.error);
  });
  return (
    <>
      <Button size="sm" variant="ghost" className="text-rose-600" onClick={() => setOpen(true)}><Ban />{t("Cancel group")}</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent>
          <DialogHeader icon={<Ban />} eyebrow={t("Group booking")} tone="rose"><DialogTitle>{t("Cancel the rooms not yet arrived?")}</DialogTitle><DialogDescription>{t("{n} booked room(s) are cancelled; guests already in the hotel are not affected. Payments stay on record.", { n: rooms })}</DialogDescription></DialogHeader>
          <Textarea rows={2} value={reason} onChange={(e) => setReason(e.target.value)} placeholder={t("Reason (required)")} aria-label={t("Reason")} />
          <DialogFooter><Button variant="outline" onClick={() => setOpen(false)}>{t("Back")}</Button><Button variant="destructive" disabled={pending || !reason.trim()} onClick={cancel}>{pending && <Loader2 className="animate-spin" />}{t("Cancel rooms")}</Button></DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}

export function PrintButton() {
  const t = useT();
  return <Button size="sm" variant="outline" onClick={() => window.print()} className="print:hidden"><Printer />{t("Print summary")}</Button>;
}

