"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { BedDouble, Check, Loader2, Minus, Plus, Search, ShoppingBag, Store, UtensilsCrossed, Wine, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { formatTZS } from "@/lib/format";
import { accountDetail, type PayAccount } from "@/lib/pay-account";
import { cn } from "@/lib/utils";
import type { InHouseGuest, OrderingMenu } from "@/server/services/restaurant";
import { useWaiterPin } from "@/components/staff/waiter-pin";
import { createOrderAction } from "./actions";

type OrderType = "DINE_IN" | "TAKEAWAY" | "PICKUP" | "ROOM_SERVICE";
const TYPES: { v: OrderType; label: string; icon: typeof UtensilsCrossed }[] = [
  { v: "DINE_IN", label: "Dine in", icon: UtensilsCrossed },
  { v: "TAKEAWAY", label: "Takeaway", icon: ShoppingBag },
  { v: "PICKUP", label: "Pickup", icon: Store },
  { v: "ROOM_SERVICE", label: "Room service", icon: BedDouble },
];

/**
 * NEW ORDER — pick from the menu, choose where it goes (table, takeaway or a guest's
 * room) and how it is settled: paid now into a hotel account, or charged to the room.
 * The totals here are only a preview: the server prices every item from the menu.
 */
export function OrderComposer({ menu, guests, accounts, fee, canPay, startGuest }: {
  menu: OrderingMenu; guests: InHouseGuest[]; accounts: PayAccount[]; fee: number; canPay: boolean;
  /** Open for this guest (e.g. from the guest's booking). */
  startGuest?: string;
}) {
  const [open, setOpen] = useState(false);
  const [type, setType] = useState<OrderType>(startGuest ? "ROOM_SERVICE" : "DINE_IN");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [cat, setCat] = useState(menu[0]?.id ?? "");
  const [q, setQ] = useState("");
  const [guestId, setGuestId] = useState(startGuest ?? "");
  const [guestQ, setGuestQ] = useState("");
  const [table, setTable] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");
  const [settlement, setSettlement] = useState<"PAY_NOW" | "ROOM" | "UNPAID">(canPay && !startGuest ? "PAY_NOW" : "ROOM");
  const [phone, setPhone] = useState("");
  const [accountId, setAccountId] = useState(accounts[0]?.id ?? "");
  const [reference, setReference] = useState("");
  const [pending, start] = useTransition();
  const router = useRouter();
  const askPin = useWaiterPin();

  const all = useMemo(() => menu.flatMap((c) => c.items.map((i) => ({ ...i, category: c.name }))), [menu]);
  const needle = q.trim().toLowerCase();
  const shown = needle ? all.filter((i) => i.name.toLowerCase().includes(needle) || i.category.toLowerCase().includes(needle)) : (menu.find((c) => c.id === cat)?.items ?? []).map((i) => ({ ...i, category: "" }));
  const lines = Object.entries(cart).map(([id, qty]) => ({ item: all.find((i) => i.id === id)!, qty })).filter((l) => l.item && l.qty > 0);
  const food = lines.filter((l) => l.item.type === "FOOD").reduce((s, l) => s + l.item.price * l.qty, 0);
  const drinks = lines.filter((l) => l.item.type === "DRINK").reduce((s, l) => s + l.item.price * l.qty, 0);
  const serviceFee = type === "ROOM_SERVICE" ? fee : 0;
  const total = food + drinks + serviceFee;
  const guest = guests.find((g) => g.id === guestId) ?? null;
  const needsGuest = type === "ROOM_SERVICE" || settlement === "ROOM";
  const add = (id: string, d: number) => setCart((c) => ({ ...c, [id]: Math.max(0, Math.min(99, (c[id] ?? 0) + d)) }));
  const reset = () => { setCart({}); setQ(""); setNotes(""); setTable(""); setName(""); setPhone(""); setReference(""); if (!startGuest) setGuestId(""); };
  const ready = lines.length > 0 && (!needsGuest || !!guest) && (settlement !== "PAY_NOW" || !!accountId);
  const outside = type === "TAKEAWAY" || type === "PICKUP";
  const guestList = guests.filter((g) => !guestQ.trim() || `${g.rooms} ${g.name} ${g.reference}`.toLowerCase().includes(guestQ.trim().toLowerCase()));

  async function send() {
    // On the shared Restaurant Counter the waiter making the order says who they are (the order is theirs) —
    // paid now, the payment is the Counter's own record (the waiter is noted as the one who brought it).
    const pin = await askPin(settlement === "PAY_NOW" ? "New order — the payment is recorded at the Counter" : "New order");
    if (pin === null) return;
    start(async () => {
      const res = await createOrderAction({
        type, settlement, pin, items: lines.map((l) => ({ menuItemId: l.item.id, quantity: l.qty })),
        reservationId: guest?.id ?? null, tableLabel: type === "DINE_IN" ? table || null : null, customerName: outside ? name || null : null,
        customerPhone: outside && !guest ? phone || null : null,
        notes: notes || null, accountId: settlement === "PAY_NOW" ? accountId : null, reference: settlement === "PAY_NOW" ? reference || null : null,
      });
      if (res.ok) { toast.success(`${res.data.number} sent to the kitchen · ${formatTZS(res.data.total)}`); reset(); setOpen(false); router.refresh(); }
      else toast.error(res.error, { duration: 8000 });
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)} className="gap-1.5"><Plus />New order</Button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="flex max-h-[94svh] flex-col gap-0 overflow-hidden p-0 sm:max-w-6xl">
          {/* The band runs across both columns; the columns share the height left under it. */}
          <DialogHeader icon={<UtensilsCrossed />} eyebrow="Restaurant" tone="gold" className="mx-0 mt-0 shrink-0">
            <DialogTitle>New order</DialogTitle>
            <DialogDescription>Tap items to add them. Prices come from the menu.</DialogDescription>
          </DialogHeader>
          <div className="grid min-h-0 flex-1 lg:grid-cols-[minmax(0,1fr)_24rem]">
            {/* Menu */}
            <div className="flex min-h-0 flex-col border-b border-border/70 p-5 lg:border-b-0 lg:border-r">
              <div className="relative mb-3">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
                <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search the menu — biryani, Safari, Hennessy…" className="h-11 w-full rounded-2xl border border-border bg-muted/40 pl-10 pr-9 text-sm outline-none focus:border-foreground/30 focus:bg-background" />
                {q && <button type="button" onClick={() => setQ("")} aria-label="Clear" className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground"><X className="size-4" /></button>}
              </div>
              {!needle && (
                <div className="-mx-1 mb-3 flex gap-1.5 overflow-x-auto px-1 pb-1">
                  {menu.map((c) => (
                    <button key={c.id} type="button" onClick={() => setCat(c.id)} aria-pressed={cat === c.id}
                      className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3.5 py-1.5 text-xs font-medium transition", cat === c.id ? "border-foreground bg-foreground text-background" : "border-border hover:bg-muted")}>
                      {c.type === "DRINK" ? <Wine className="size-3.5" /> : <UtensilsCrossed className="size-3.5" />}{c.name}
                    </button>
                  ))}
                </div>
              )}
              <div className="grid min-h-0 flex-1 auto-rows-min grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3 xl:grid-cols-4">
                {shown.map((i) => {
                  const qty = cart[i.id] ?? 0;
                  return (
                    <button key={i.id} type="button" disabled={!i.isAvailable} onClick={() => add(i.id, 1)}
                      className={cn("relative flex min-h-24 flex-col justify-between overflow-hidden rounded-2xl border p-3 text-left transition",
                        !i.isAvailable ? "cursor-not-allowed border-dashed border-border opacity-50" : qty ? "border-emerald-500 bg-emerald-500/[0.07]" : "border-border/80 hover:-translate-y-0.5 hover:border-foreground/30")}>
                      {i.image && (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={i.image} alt="" loading="lazy" decoding="async" className="-mx-3 -mt-3 mb-2 aspect-[16/10] w-[calc(100%+1.5rem)] max-w-none object-cover" />
                      )}
                      <span className="line-clamp-2 text-sm font-medium leading-tight">{i.name}</span>
                      {i.category && <span className="text-[10px] text-muted-foreground">{i.category}</span>}
                      <span className="mt-2 flex items-end justify-between gap-1">
                        <span className="text-sm font-semibold tabular-nums">{i.isAvailable ? formatTZS(i.price) : "Not available"}</span>
                        {qty > 0 && <span className="grid size-6 place-items-center rounded-full bg-emerald-600 text-xs font-bold text-white">{qty}</span>}
                      </span>
                    </button>
                  );
                })}
                {shown.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted-foreground">Nothing matches “{q}”.</p>}
              </div>
            </div>

            {/* The order */}
            <div className="flex min-h-0 flex-col overflow-y-auto bg-muted/20 p-5">
              <div className="grid grid-cols-4 gap-1 rounded-2xl bg-muted/70 p-1">
                {TYPES.map((t) => (
                  <button key={t.v} type="button" onClick={() => { setType(t.v); if (t.v === "ROOM_SERVICE" && !canPay) setSettlement("ROOM"); }} aria-pressed={type === t.v}
                    className={cn("flex flex-col items-center gap-1 rounded-xl px-1 py-2 text-[11px] font-medium transition", type === t.v ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>
                    <t.icon className="size-4" />{t.label}
                  </button>
                ))}
              </div>

              <div className="mt-3 space-y-2">
                {type === "DINE_IN" && <input value={table} onChange={(e) => setTable(e.target.value)} placeholder="Table / seat (optional), e.g. Table 4" className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" />}
                {outside && (
                  <div className="grid grid-cols-2 gap-2">
                    <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Customer name" className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" />
                    <input value={phone} onChange={(e) => setPhone(e.target.value)} type="tel" placeholder="Phone (for updates)" className="h-10 w-full rounded-xl border border-border bg-background px-3 text-sm" />
                  </div>
                )}
                {(needsGuest || type === "DINE_IN") && (
                  <div className="rounded-2xl border border-border/80 bg-background p-2">
                    {guest ? (
                      <div className="flex items-center justify-between gap-2 px-1.5 py-1">
                        <span className="min-w-0 leading-tight"><span className="block truncate text-sm font-semibold">Room {guest.rooms} · {guest.name}</span><span className="text-[11px] text-muted-foreground">{guest.reference}{guest.balance ? ` · owes ${formatTZS(guest.balance)}` : ""}</span></span>
                        {!startGuest && <button type="button" onClick={() => setGuestId("")} className="text-xs font-medium underline-offset-2 hover:underline">change</button>}
                      </div>
                    ) : (
                      <>
                        <input value={guestQ} onChange={(e) => setGuestQ(e.target.value)} placeholder={needsGuest ? "Which room? Number or guest name" : "Guest staying here? (optional)"} className="h-9 w-full rounded-lg bg-transparent px-2 text-sm outline-none" />
                        <ul className="max-h-36 overflow-y-auto">
                          {guestList.map((g) => (
                            <li key={g.id}><button type="button" onClick={() => { setGuestId(g.id); setGuestQ(""); }} className="flex w-full items-center justify-between gap-2 rounded-lg px-2 py-1.5 text-left text-sm hover:bg-muted">
                              <span className="truncate"><span className="font-semibold">{g.rooms}</span> · {g.name}</span><span className="text-[11px] text-muted-foreground">{g.reference}</span>
                            </button></li>
                          ))}
                          {guestList.length === 0 && <li className="px-2 py-2 text-xs text-muted-foreground">No guest staying matches.</li>}
                        </ul>
                      </>
                    )}
                  </div>
                )}
              </div>

              <ul className="mt-3 min-h-16 flex-1 space-y-1.5">
                {lines.length === 0 && <li className="rounded-2xl border border-dashed border-border px-3 py-6 text-center text-sm text-muted-foreground">No items yet</li>}
                {lines.map((l) => (
                  <li key={l.item.id} className="flex items-center gap-2 rounded-xl bg-background px-2.5 py-2 text-sm">
                    <span className="min-w-0 flex-1 leading-tight"><span className="block truncate font-medium">{l.item.name}</span><span className="text-[11px] text-muted-foreground tabular-nums">{formatTZS(l.item.price)} each</span></span>
                    <span className="flex items-center gap-1">
                      <button type="button" onClick={() => add(l.item.id, -1)} aria-label="One less" className="grid size-7 place-items-center rounded-lg border border-border hover:bg-muted"><Minus className="size-3.5" /></button>
                      <span className="w-6 text-center font-semibold tabular-nums">{l.qty}</span>
                      <button type="button" onClick={() => add(l.item.id, 1)} aria-label="One more" className="grid size-7 place-items-center rounded-lg border border-border hover:bg-muted"><Plus className="size-3.5" /></button>
                    </span>
                    <span className="w-20 text-right font-semibold tabular-nums">{(l.item.price * l.qty).toLocaleString("en-US")}</span>
                  </li>
                ))}
              </ul>

              <dl className="mt-3 space-y-1 border-t border-dashed border-border pt-3 text-sm">
                {food > 0 && <div className="flex justify-between text-muted-foreground"><dt>Food</dt><dd className="tabular-nums">{formatTZS(food)}</dd></div>}
                {drinks > 0 && <div className="flex justify-between text-muted-foreground"><dt>Drinks</dt><dd className="tabular-nums">{formatTZS(drinks)}</dd></div>}
                {serviceFee > 0 && <div className="flex justify-between text-muted-foreground"><dt>Room service fee</dt><dd className="tabular-nums">{formatTZS(serviceFee)}</dd></div>}
                <div className="flex justify-between text-base font-semibold"><dt>Total</dt><dd className="tabular-nums">{formatTZS(total)}</dd></div>
              </dl>

              <div className={cn("mt-3 grid gap-1 rounded-2xl bg-muted/70 p-1", canPay ? "grid-cols-3" : "grid-cols-2")}>
                {canPay && <button type="button" onClick={() => setSettlement("PAY_NOW")} aria-pressed={settlement === "PAY_NOW"} className={cn("rounded-xl py-2 text-sm font-medium transition", settlement === "PAY_NOW" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>Pay now</button>}
                <button type="button" onClick={() => setSettlement("ROOM")} aria-pressed={settlement === "ROOM"} className={cn("rounded-xl py-2 text-sm font-medium transition", settlement === "ROOM" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>To room bill</button>
                <button type="button" onClick={() => setSettlement("UNPAID")} aria-pressed={settlement === "UNPAID"} className={cn("rounded-xl py-2 text-sm font-medium transition", settlement === "UNPAID" ? "bg-background shadow-sm" : "text-muted-foreground hover:text-foreground")}>Pay later</button>
              </div>
              {settlement === "PAY_NOW" ? (
                <div className="mt-2 space-y-2">
                  <div className="grid grid-cols-2 gap-1.5">
                    {accounts.map((a) => (
                      <button key={a.id} type="button" onClick={() => setAccountId(a.id)} aria-pressed={accountId === a.id}
                        className={cn("flex items-center justify-between rounded-xl border px-2.5 py-1.5 text-left text-xs leading-tight", accountId === a.id ? "border-emerald-500 bg-emerald-500/10" : "border-border hover:bg-muted")}>
                        <span className="min-w-0"><span className="block truncate font-medium">{a.name}</span><span className="font-mono text-[10px] text-muted-foreground">{a.number ?? "—"}</span></span>
                        {accountId === a.id && <Check className="size-3.5 shrink-0 text-emerald-600" />}
                      </button>
                    ))}
                  </div>
                  <p className="truncate text-[11px] text-muted-foreground">{accountDetail(accounts.find((a) => a.id === accountId))}</p>
                  <input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="Reference (M-Pesa code) — optional" className="h-9 w-full rounded-xl border border-border bg-background px-3 font-mono text-xs" />
                </div>
              ) : settlement === "UNPAID" ? (
                <p className="mt-2 text-[11px] text-muted-foreground">{canPay ? "Paid at the counter / on delivery — record the payment on the order card before it is closed." : "Paid at the counter / on delivery — the Restaurant Counter records the payment."}</p>
              ) : (
                <p className="mt-2 text-[11px] text-muted-foreground">{guest ? `Goes on Room ${guest.rooms}'s bill — no money now; it is collected at checkout.` : "Choose the guest's room above."}</p>
              )}
              <input value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Note for the kitchen (optional) — no onions, extra spicy…" className="mt-2 h-9 w-full rounded-xl border border-border bg-background px-3 text-xs" />
              <Button className="mt-3 h-12 rounded-2xl text-base" disabled={!ready || pending} onClick={() => void send()}>
                {pending && <Loader2 className="animate-spin" />}{lines.length ? `${settlement === "ROOM" ? "To room bill" : settlement === "UNPAID" ? "Pay later" : "Paid"} · send ${formatTZS(total)}` : "Add items"}
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </>
  );
}
