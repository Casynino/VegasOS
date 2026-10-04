"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import {
  BedSingle, Car, ConciergeBell, GlassWater, Loader2, Minus, Plus, Receipt, Shirt, Trash2, UtensilsCrossed, Wine, X, type LucideIcon,
} from "lucide-react";
import { postRoomChargesAction, voidChargeAction } from "@/app/staff/(app)/reservations/actions";
import { createOrderAction } from "@/app/staff/(app)/restaurant/actions";
import type { BillMenu } from "@/server/services/restaurant";
import { MenuPicker } from "./menu-picker";
import { useWaiterPin } from "@/components/staff/waiter-pin";
import { CHARGE_LABELS, CHARGE_TYPES, type ChargeTypeCode } from "@/lib/charge-types";
import { formatBusinessDate, formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { AccountSelect } from "@/components/staff/finance/account-select";
import type { PayAccount } from "@/lib/pay-account";

const ICONS: Record<string, LucideIcon> = { UtensilsCrossed, ConciergeBell, Wine, GlassWater, Shirt, Car, BedSingle, Plus };
const TONE: Record<string, string> = {
  RESTAURANT: "bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300",
  ROOM_SERVICE: "bg-orange-100 text-orange-700 dark:bg-orange-500/15 dark:text-orange-300",
  BAR: "bg-violet-100 text-violet-700 dark:bg-violet-500/15 dark:text-violet-300",
  MINIBAR: "bg-fuchsia-100 text-fuchsia-700 dark:bg-fuchsia-500/15 dark:text-fuchsia-300",
  LAUNDRY: "bg-sky-100 text-sky-700 dark:bg-sky-500/15 dark:text-sky-300",
  TRANSPORT: "bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300",
  EXTRA_BED: "bg-rose-100 text-rose-700 dark:bg-rose-500/15 dark:text-rose-300",
  OTHER: "bg-muted text-muted-foreground",
};
const iconFor = (code: string) => ICONS[CHARGE_TYPES.find((t) => t.code === code)?.icon ?? "Plus"] ?? Plus;

export interface RecentItem { type: string; item: string; unitPrice: number }
type Line = { type: ChargeTypeCode; item: string; qty: number; unitPrice: number; menuItemId?: string; image?: string | null };

/** These are picked from the restaurant & bar menu (when the menu is given); the rest are typed in. */
const MENU_TYPES: ChargeTypeCode[] = ["RESTAURANT", "ROOM_SERVICE", "BAR"];

/**
 * Put items on a guest's room: tap a type, then pick from the MENU (restaurant,
 * room service, bar — photo, name and price, most-ordered first) or tap a recent
 * item / type one (laundry, transport…), adjust quantities, then POST TO ROOM.
 * Menu items become a restaurant order charged to the room (the kitchen sees it,
 * room service adds the delivery fee); everything is paid at checkout unless the
 * guest pays now.
 */
export function ChargeComposer({ reservationId, roomLabel, recent, methods, canPay = true, onPosted, menu = null, menuPayNow = false, startType, canType = true }: {
  reservationId: string; roomLabel: string; recent: RecentItem[]; methods: PayAccount[]; canPay?: boolean; onPosted?: () => void;
  /** The restaurant & bar menu — only for a guest staying now (orders need a checked-in guest). */
  menu?: BillMenu | null;
  /** May take payment for menu items on the spot (restaurant takings). */
  menuPayNow?: boolean;
  /** Which tile is open first (and switches when the host asks for another one). */
  startType?: ChargeTypeCode;
  /** May put typed extras (laundry, transport, minibar…) on the bill — false: menu only. */
  canType?: boolean;
}) {
  const router = useRouter();
  const [type, setType] = useState<ChargeTypeCode>(startType ?? "RESTAURANT");
  const [manual, setManual] = useState(false);
  const [lines, setLines] = useState<Line[]>([]);
  const [draft, setDraft] = useState({ item: "", qty: 1, price: "" });
  const [payNow, setPayNow] = useState(false);
  const [pay, setPay] = useState({ accountId: methods[0]?.id ?? "", reference: "" });
  const [pending, start] = useTransition();
  const askPin = useWaiterPin();
  // The host (e.g. the room card's "Room service" tile) can switch the open tile.
  const [seenStart, setSeenStart] = useState(startType);
  if (startType !== seenStart) { setSeenStart(startType); if (startType) { setType(startType); setManual(false); } }

  const types = canType ? CHARGE_TYPES : CHARGE_TYPES.filter((t) => MENU_TYPES.includes(t.code));
  const menuMode = !!menu && MENU_TYPES.includes(type) && (!manual || !canType);
  const quick = useMemo(() => recent.filter((r) => r.type === type).slice(0, 10), [recent, type]);
  // A typed item counts only while its row is on screen (never hidden behind the menu).
  const draftLine: Line | null = !menuMode && canType && draft.item.trim() && Number(draft.price) > 0 ? { type, item: draft.item.trim(), qty: draft.qty, unitPrice: Math.round(Number(draft.price)) } : null;
  const all = draftLine ? [...lines, draftLine] : lines;
  const fee = menu && lines.some((l) => l.menuItemId && l.type === "ROOM_SERVICE") ? menu.fee : 0;
  const total = all.reduce((s, l) => s + l.qty * l.unitPrice, 0) + fee;
  // What is actually paid now: typed items always; menu items only when restaurant payments may be taken here.
  const payable = all.filter((l) => !l.menuItemId).reduce((s, l) => s + l.qty * l.unitPrice, 0) + (menuPayNow ? all.filter((l) => l.menuItemId).reduce((s, l) => s + l.qty * l.unitPrice, 0) + fee : 0);
  const counts = useMemo(() => {
    const c: Record<string, number> = {};
    for (const l of lines) if (l.menuItemId && l.type === type) c[l.menuItemId] = (c[l.menuItemId] ?? 0) + l.qty;
    return c;
  }, [lines, type]);
  const hasMenuLines = lines.some((l) => l.menuItemId);

  function add(l: Line) {
    setLines((cur) => {
      const i = cur.findIndex((x) => x.type === l.type && x.menuItemId === l.menuItemId && x.item.toLowerCase() === l.item.toLowerCase() && x.unitPrice === l.unitPrice);
      if (i < 0) return [...cur, l];
      const next = [...cur]; next[i] = { ...next[i], qty: Math.min(99, next[i].qty + l.qty) }; return next;
    });
  }
  function addDraft() {
    if (!draftLine) return;
    add(draftLine);
    setDraft({ item: "", qty: 1, price: "" });
  }
  /** Leaving the typed row (other tile, or back to the menu): a finished item goes on the ticket under its own type, never lost or re-typed. */
  function keepDraft() {
    if (draftLine) add(draftLine);
    setDraft({ item: "", qty: 1, price: "" });
  }
  function pickType(code: ChargeTypeCode) { keepDraft(); setType(code); setManual(false); }

  async function post() {
    if (!all.length) return;
    const payMenu = payNow && canPay && menuPayNow;
    const menuLines = lines.filter((l) => l.menuItemId);
    const typed = all.filter((l) => !l.menuItemId);
    const name = (l: Line) => `${l.qty} × ${l.item}`;
    // Menu items paid now on the shared restaurant screen: the waiter taking the money says who they are (once for the ticket).
    const pin = payMenu && menuLines.length ? await askPin(`Receive the payment${roomLabel ? ` for Room ${roomLabel}` : ""}`) : undefined;
    if (pin === null) return;
    start(async () => {
      let billed = 0, paid = 0;
      const sent: string[] = [];
      const done: Line[] = [];
      /** A later step failed: say exactly what already went through and what still needs posting, so nothing is entered twice. */
      const failed = (error: string) => {
        const left = all.filter((l) => !done.includes(l));
        toast.error(error, {
          duration: 15000,
          description: done.length
            ? `Already ${payMenu ? "done" : "on the bill"}: ${sent.join(", ")} (${done.map(name).join(", ")}). Not posted yet: ${left.map(name).join(", ")} — add only these again.`
            : undefined,
        });
        if (done.length) router.refresh();
      };
      // Menu items: one order per kind (room service carries the delivery fee), priced by the server from the menu.
      const orders = [
        { type: "ROOM_SERVICE" as const, lines: menuLines.filter((l) => l.type === "ROOM_SERVICE") },
        { type: "DINE_IN" as const, lines: menuLines.filter((l) => l.type !== "ROOM_SERVICE") },
      ].filter((o) => o.lines.length);
      for (const o of orders) {
        // One order line per ticket line (each already ≤ 99) — nothing merged or cut.
        const res = await createOrderAction({
          type: o.type, settlement: payMenu ? "PAY_NOW" : "ROOM", reservationId, pin: payMenu ? pin : undefined,
          items: o.lines.map((l) => ({ menuItemId: l.menuItemId!, quantity: l.qty })),
          accountId: payMenu ? pay.accountId : null, reference: payMenu ? pay.reference || null : null,
        });
        if (!res.ok) { failed(res.error); return; }
        sent.push(res.data.number); done.push(...o.lines);
        if (payMenu) paid += res.data.total; else billed += res.data.total;
        setLines((cur) => cur.filter((l) => !o.lines.includes(l)));
      }
      // Typed items (laundry, transport, minibar…) go straight on the bill.
      if (typed.length) {
        const res = await postRoomChargesAction({ reservationId, lines: typed.map(({ type: t, item, qty, unitPrice }) => ({ type: t, item, qty, unitPrice })), pay: payNow && canPay ? { accountId: pay.accountId, reference: pay.reference || undefined } : null });
        if (!res.ok) { failed(res.error); return; }
        billed += res.data.total - res.data.paid; paid += res.data.paid;
      }
      const room = roomLabel ? `Room ${roomLabel}` : "the room";
      toast.success(billed > 0 ? `${formatTZS(billed)} added to ${room}'s bill.` : `${formatTZS(paid)} paid now.`, {
        description: [paid > 0 && billed > 0 ? `Paid now: ${formatTZS(paid)}` : billed > 0 ? "It will be paid at checkout." : null, sent.length ? `Sent to the kitchen & bar: ${sent.join(", ")}` : null].filter(Boolean).join(" · "),
      });
      setLines([]); setDraft({ item: "", qty: 1, price: "" }); setPayNow(false); setPay((p) => ({ ...p, reference: "" }));
      onPosted?.(); router.refresh();
    });
  }

  return (
    // Locked while posting, so nothing tapped mid-post is lost or sent twice.
    <fieldset disabled={pending} className="min-w-0 space-y-4 disabled:opacity-95">
      {/* Type tiles */}
      <div className={cn("grid gap-2", types.length > 4 ? "grid-cols-4" : "grid-cols-3")}>
        {types.map((t) => {
          const I = ICONS[t.icon];
          const on = t.code === type;
          return (
            <button key={t.code} type="button" onClick={() => pickType(t.code)} aria-pressed={on}
              className={cn("flex flex-col items-center gap-1.5 rounded-2xl border px-1 py-2.5 text-[11px] font-semibold transition-all",
                on ? "border-foreground/70 bg-card shadow-[0_8px_20px_-14px_rgba(15,23,42,0.6)]" : "border-border/70 bg-card/60 text-muted-foreground hover:bg-card")}>
              <span className={cn("grid size-9 place-items-center rounded-xl [&_svg]:size-[18px]", TONE[t.code])}><I /></span>
              {t.label}
            </button>
          );
        })}
      </div>

      {menuMode && menu ? (
        <div className="space-y-2">
          <MenuPicker key={type} menu={menu} drinksOnly={type === "BAR"} counts={counts}
            onAdd={(i) => add({ type, item: i.name, qty: 1, unitPrice: i.price, menuItemId: i.id, image: i.image })} />
          <p className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
            <span>Menu prices{type === "ROOM_SERVICE" ? ` · delivery ${formatTZS(menu.fee)} per order` : ""} · the kitchen &amp; bar see the order.</span>
            {canType && <button type="button" onClick={() => setManual(true)} className="font-medium text-foreground underline-offset-2 hover:underline">Not on the menu? Type it in</button>}
          </p>
        </div>
      ) : !canType ? (
        <p className="rounded-2xl border border-dashed border-border px-4 py-5 text-center text-sm text-muted-foreground">Only menu items can be added here, for a guest staying now.</p>
      ) : (
        <>
          {/* Recent items for this type */}
          {quick.length > 0 && (
            <div className="space-y-1.5">
              <p className="text-xs text-muted-foreground">Tap to add · recently used</p>
              <div className="flex flex-wrap gap-1.5">
                {quick.map((q) => (
                  <button key={`${q.item}-${q.unitPrice}`} type="button" onClick={() => add({ type: q.type as ChargeTypeCode, item: q.item, qty: 1, unitPrice: q.unitPrice })}
                    className="rounded-full border border-border bg-card px-3 py-1.5 text-xs font-medium transition-colors hover:border-foreground/40 hover:bg-muted">
                    {q.item} · <span className="tabular-nums text-muted-foreground">{q.unitPrice.toLocaleString("en-TZ")}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* New item */}
          <div className="grid grid-cols-[1fr_auto] gap-2 sm:grid-cols-[1fr_auto_8rem_auto]">
            <Input value={draft.item} onChange={(e) => setDraft({ ...draft, item: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addDraft()}
              placeholder={`${CHARGE_LABELS[type]} item, e.g. ${type === "LAUNDRY" ? "Shirts washed" : type === "TRANSPORT" ? "Airport drop" : type === "EXTRA_BED" ? "Extra bed" : type === "BAR" || type === "MINIBAR" ? "Soda" : "Breakfast"}`}
              aria-label="Item" className="h-10" />
            <div className="flex h-10 items-center rounded-xl border border-border">
              <button type="button" aria-label="Less" onClick={() => setDraft({ ...draft, qty: Math.max(1, draft.qty - 1) })} className="grid h-full w-8 place-items-center text-muted-foreground hover:text-foreground"><Minus className="size-3.5" /></button>
              <span className="w-6 text-center text-sm font-semibold tabular-nums">{draft.qty}</span>
              <button type="button" aria-label="More" onClick={() => setDraft({ ...draft, qty: Math.min(99, draft.qty + 1) })} className="grid h-full w-8 place-items-center text-muted-foreground hover:text-foreground"><Plus className="size-3.5" /></button>
            </div>
            <Input type="number" min={0} step={500} value={draft.price} onChange={(e) => setDraft({ ...draft, price: e.target.value })} onKeyDown={(e) => e.key === "Enter" && addDraft()}
              placeholder="Price each" aria-label="Price each (TZS)" className="h-10" />
            <Button type="button" variant="outline" className="h-10" disabled={!draftLine} onClick={addDraft}><Plus />Add</Button>
          </div>
          {menu && MENU_TYPES.includes(type) && (
            <button type="button" onClick={() => { keepDraft(); setManual(false); }} className="text-[11px] font-medium underline-offset-2 hover:underline">← Back to the menu</button>
          )}
        </>
      )}

      {/* Ticket */}
      {lines.length > 0 && (
        <ul className="divide-y divide-dashed divide-border rounded-2xl border border-border/70 bg-card">
          {lines.map((l, i) => {
            const I = iconFor(l.type);
            return (
              <li key={i} className="flex items-center gap-3 px-3 py-2 text-sm">
                {l.image
                  // eslint-disable-next-line @next/next/no-img-element
                  ? <img src={l.image} alt="" className="size-7 shrink-0 rounded-lg object-cover" />
                  : <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg [&_svg]:size-3.5", TONE[l.type])}><I /></span>}
                <span className="line-clamp-2 min-w-0 flex-1 leading-snug"><strong className="tabular-nums">{l.qty} ×</strong> {l.item} <span className="text-xs text-muted-foreground">@ {l.unitPrice.toLocaleString("en-TZ")}{l.menuItemId && l.type === "ROOM_SERVICE" ? " · room service" : ""}</span></span>
                <span className="flex items-center gap-0.5">
                  <button type="button" aria-label="Less" onClick={() => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Math.max(1, x.qty - 1) } : x)))} className="rounded p-1 text-muted-foreground hover:bg-muted"><Minus className="size-3" /></button>
                  <button type="button" aria-label="More" onClick={() => setLines(lines.map((x, j) => (j === i ? { ...x, qty: Math.min(99, x.qty + 1) } : x)))} className="rounded p-1 text-muted-foreground hover:bg-muted"><Plus className="size-3" /></button>
                </span>
                <span className="shrink-0 whitespace-nowrap text-right font-semibold tabular-nums">{formatTZS(l.qty * l.unitPrice)}</span>
                <button type="button" aria-label="Remove" onClick={() => setLines(lines.filter((_, j) => j !== i))} className="rounded p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600"><Trash2 className="size-3.5" /></button>
              </li>
            );
          })}
          {fee > 0 && (
            <li className="flex items-center gap-3 px-3 py-2 text-sm text-muted-foreground">
              <span className={cn("grid size-7 shrink-0 place-items-center rounded-lg [&_svg]:size-3.5", TONE.ROOM_SERVICE)}><ConciergeBell /></span>
              <span className="min-w-0 flex-1">Room service delivery</span>
              <span className="shrink-0 whitespace-nowrap text-right font-semibold tabular-nums">{formatTZS(fee)}</span>
              <span className="w-[22px] shrink-0" />
            </li>
          )}
        </ul>
      )}

      {/* Post */}
      <div className="space-y-3 rounded-2xl bg-muted/60 p-3">
        {canPay && (
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={payNow} onChange={(e) => setPayNow(e.target.checked)} />Guest is paying for this now</label>
        )}
        {payNow && (
          <>
            <div className="grid gap-2 sm:grid-cols-2">
              <AccountSelect accounts={methods} value={pay.accountId} onChange={(v) => setPay({ ...pay, accountId: v })} />
              <Input value={pay.reference} onChange={(e) => setPay({ ...pay, reference: e.target.value })} placeholder="Reference (M-Pesa code, receipt…)" className="h-10" />
            </div>
            {hasMenuLines && !menuPayNow && <p className="text-[11px] text-amber-700 dark:text-amber-400">Menu items still go on the bill — receiving restaurant payments needs the cashier.</p>}
          </>
        )}
        <Button className="h-11 w-full text-base font-semibold" disabled={pending || total <= 0} onClick={() => void post()}>
          {pending ? <Loader2 className="animate-spin" /> : <Receipt />}
          {total <= 0 ? "Add an item to post"
            : payNow && payable > 0 ? (payable === total ? `Post & receive payment · ${formatTZS(total)}` : `Post ${formatTZS(total)} · receive ${formatTZS(payable)} now`)
              : `Post to room ${roomLabel} · ${formatTZS(total)}`}
        </Button>
      </div>
    </fieldset>
  );
}

export interface TabCharge {
  id: string; day: string; at: string; type: string; description: string; amount: number; by: string | null;
  /** Menu photo for food & drinks picked from the menu. */
  photo?: string | null;
  /** The restaurant order it comes from ("#184", its table) — changed on the order, never removed here. */
  order?: { number: string; table: string | null; roomService: boolean } | null;
}

/** "From order #184 at Outside 3" — where a line from a restaurant order came from. */
const fromOrder = (o: NonNullable<TabCharge["order"]>) => (o.roomService ? `From room service order ${o.number}` : `From order ${o.number} at ${o.table ?? "the restaurant"}`);

/**
 * The guest's running tab: every extra charge, grouped by day, with who added it (managers can
 * void). A line from a restaurant order is not removed here — it says which order and table it
 * came from; who pays is changed on the order itself.
 */
export function GuestTab({ reservationId, charges, canVoid }: { reservationId: string; charges: TabCharge[]; canVoid: boolean }) {
  const router = useRouter();
  const [voiding, setVoiding] = useState<string | null>(null);
  const [reason, setReason] = useState("");
  const [pending, start] = useTransition();
  if (charges.length === 0) return <p className="rounded-2xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">No extra charges yet. Meals, drinks, laundry and other services appear here as they are added.</p>;
  const days = [...new Set(charges.map((c) => c.day))].sort().reverse();
  const time = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: "Africa/Dar_es_Salaam" }).format(new Date(iso));

  function doVoid(id: string) {
    start(async () => {
      const res = await voidChargeAction({ reservationId, chargeId: id, reason });
      if (res.ok) { toast.success("Charge removed from the bill."); setVoiding(null); setReason(""); router.refresh(); } else toast.error(res.error);
    });
  }

  return (
    <div className="space-y-4">
      {days.map((d) => {
        const list = charges.filter((c) => c.day === d);
        return (
          <div key={d}>
            <p className="mb-1.5 flex justify-between text-xs font-semibold uppercase tracking-wider text-muted-foreground">
              <span>{formatBusinessDate(d)}</span><span className="tabular-nums">{formatTZS(list.reduce((s, c) => s + c.amount, 0))}</span>
            </p>
            <ul className="divide-y divide-border rounded-2xl border border-border/70">
              {list.map((c) => {
                const I = iconFor(c.type);
                return (
                  <li key={c.id} className="px-3 py-2 text-sm">
                    <div className="flex items-center gap-3">
                      {c.photo ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={c.photo} alt="" loading="lazy" className="size-10 shrink-0 rounded-xl object-cover ring-1 ring-border/60" />
                      ) : (
                        <span className={cn("grid size-10 shrink-0 place-items-center rounded-xl [&_svg]:size-4", TONE[c.type] ?? TONE.OTHER)}><I /></span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate font-medium">{c.description}</span>
                        <span className="block text-[11px] text-muted-foreground">{c.order ? fromOrder(c.order) : CHARGE_LABELS[c.type] ?? "Other"} · {time(c.at)}{c.by ? ` · ${c.by}` : ""}</span>
                      </span>
                      <span className="font-semibold tabular-nums">{formatTZS(c.amount)}</span>
                      {canVoid && !c.order && c.type !== "BILL_DISCOUNT" && voiding !== c.id && <button type="button" aria-label="Remove charge" onClick={() => setVoiding(c.id)} className="rounded p-1 text-muted-foreground hover:bg-rose-500/10 hover:text-rose-600"><X className="size-3.5" /></button>}
                    </div>
                    {voiding === c.id && (
                      <div className="mt-2 flex gap-2">
                        <Input autoFocus value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Why remove it? e.g. added by mistake" className="h-8 text-xs" />
                        <Button size="sm" variant="destructive" disabled={pending || !reason.trim()} onClick={() => doVoid(c.id)}>Remove</Button>
                        <Button size="sm" variant="ghost" onClick={() => setVoiding(null)}>Cancel</Button>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
