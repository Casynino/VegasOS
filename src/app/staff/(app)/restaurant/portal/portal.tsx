"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { AnimatePresence, LayoutGroup } from "motion/react";
import { Banknote, BedDouble, BellRing, Bike, BookOpen, CheckCheck, HandCoins, Hotel, Receipt, Users, Globe, PackagePlus, Plus, QrCode, ShoppingBag, ChefHat, Flame, HandPlatter, Loader2, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { HeroBanner, QuickActions, SectionLabel } from "@/components/dashboard/kit";
import { RestaurantQrButton, type RestaurantQr } from "../restaurant-qr-button";
import { TodayStrip, type TodayPart } from "@/components/staff/reception/today-strip";
import type { PayAccount } from "@/lib/pay-account";
import { cn } from "@/lib/utils";
import { saveOrderSoundsAction, setOrderStatusAction } from "../actions";
import { ACCENT, allPrepared, clock, OrderCard, payBadgeFor, shortNo, TextCustomer, tileText } from "./order-card";
import { Assignments, NoWaiterYet } from "./assignments";
import { MainScreenStrip, OrdersBar, type MainScreenData } from "./main-screen";
import { MainBanner } from "./main-banner";
import { isMuted, playSound, SOUNDS, unlockAudio, useAudioReady, useLiveOrders, useOrderAlerts } from "@/components/staff/sounds";
import { useWaiterPin } from "@/components/staff/waiter-pin";
import { WaiterShiftSwitch } from "../waiter/shift-switch";
import type { WorkLeft } from "../waiter/close-shift";
import type { MoneySummary, PortalOrder, PortalPerms, PortalRole, Shortcut, SoundConfig } from "./types";

type ColKey = "new" | "preparing" | "ready" | "out" | "done" | "cancelled";
const COLS: Record<ColKey, { title: string; hint: string; statuses: string[]; icon: React.ReactNode; chip: string; badge: string; dot: string }> = {
  new: { title: "New", hint: "Waiting for the Mpishi", statuses: ["PENDING"], icon: <BellRing />, chip: "bg-sky-500/12 text-sky-600 dark:text-sky-300", badge: "bg-sky-500 text-white", dot: "bg-sky-400" },
  preparing: { title: "Preparing", hint: "Tick each item, then mark ready", statuses: ["ACCEPTED", "PREPARING"], icon: <Flame />, chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300", badge: "bg-amber-500 text-black", dot: "bg-amber-400" },
  ready: { title: "Ready to serve", hint: "Bring it to the table or the room", statuses: ["READY"], icon: <HandPlatter />, chip: "bg-emerald-500/12 text-emerald-600 dark:text-emerald-300", badge: "bg-emerald-500 text-white", dot: "bg-emerald-400" },
  out: { title: "Serving", hint: "Tap Served once the customer has it", statuses: ["OUT_FOR_DELIVERY", "DELIVERED"], icon: <Bike />, chip: "bg-violet-500/12 text-violet-600 dark:text-violet-300", badge: "bg-violet-500 text-white", dot: "bg-violet-400" },
  done: { title: "Done today", hint: "Served and settled", statuses: ["COMPLETED", "COLLECTED"], icon: <ChefHat />, chip: "bg-slate-500/12 text-slate-600 dark:text-slate-300", badge: "bg-slate-500 text-white", dot: "bg-slate-400" },
  cancelled: { title: "Cancelled today", hint: "With the reason", statuses: ["CANCELLED"], icon: <ChefHat />, chip: "bg-rose-500/12 text-rose-600 dark:text-rose-300", badge: "bg-rose-500 text-white", dot: "bg-rose-400" },
};
/** Each role sees its own work as the board; everything else as short lists underneath. */
/** Each role's own columns first; everything else in one slim column at the end of the board. */
const LAYOUT: Record<PortalRole, { board: ColKey[]; side: { title: string; groups: { title: string; cols: ColKey[] }[] } }> = {
  cook: { board: ["new", "preparing", "ready"], side: { title: "Handed over", groups: [{ title: "Serving", cols: ["out"] }, { title: "Completed", cols: ["done"] }, { title: "Cancelled", cols: ["cancelled"] }] } },
  waiter: { board: ["new", "preparing", "ready", "out"], side: { title: "Done today", groups: [{ title: "Completed", cols: ["done"] }, { title: "Cancelled", cols: ["cancelled"] }] } },
  desk: { board: ["new", "preparing", "ready", "out"], side: { title: "Done today", groups: [{ title: "Completed", cols: ["done"] }, { title: "Cancelled & declined", cols: ["cancelled"] }] } },
  manager: { board: ["new", "preparing", "ready", "out"], side: { title: "Done today", groups: [{ title: "Completed", cols: ["done"] }, { title: "Cancelled", cols: ["cancelled"] }] } },
};
/** Board grid: the role's columns, then the slimmer "done" column. */
const GRID: Record<PortalRole, string> = {
  cook: "md:grid-cols-2 xl:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,0.8fr)]",
  waiter: "md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,0.8fr)]",
  desk: "md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,0.8fr)]",
  manager: "md:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-[repeat(4,minmax(0,1fr))_minmax(0,0.8fr)]",
};
const SHORTCUT_ICON: Record<Shortcut["icon"], React.ReactNode> = { plus: <Plus />, menu: <BookOpen />, stock: <PackagePlus />, qr: <QrCode />, web: <Globe />, sale: <ShoppingBag /> };

/**
 * THE RESTAURANT PORTAL — one screen for every food and drink order, whoever placed it.
 * The Mpishi sees new orders first (accept → prepare → tick items → mark ready); waiters
 * see ready orders first (take → deliver → mark delivered); managers see everything.
 * Updates arrive within seconds, with sounds and an alert bar so nothing is missed.
 */
export function RestaurantPortal({ role, perms, meId, takesCharge, name, greeting, orders, sound, accounts, rooms, avgPrep, shortcuts, restaurantQr, money, activity, numbers, mainScreen, waiterShift }: {
  role: PortalRole; perms: PortalPerms; name: string; greeting: string; orders: PortalOrder[]; sound: SoundConfig;
  /** The signed-in account (on the shared screen: the screen's own). */
  meId: string;
  /** A waiter (or the shared screen, with the waiter's PIN) may take charge of an order nobody has. */
  takesCharge?: boolean;
  accounts: PayAccount[]; rooms: { id: string; label: string }[]; avgPrep: number | null;
  shortcuts: Shortcut[]; restaurantQr: RestaurantQr | null;
  /** Managers and the MD: the kitchen & bar, live (drawn on the server, refreshed with the board). */
  activity?: React.ReactNode;
  /** Managers: the day in numbers, drawn beside the live feed. */
  numbers?: React.ReactNode;
  money?: MoneySummary | null;
  /** The shared main-restaurant screen only (perms.device): today's money, the tables, who is on shift, the day so far. */
  mainScreen?: MainScreenData | null;
  /** A waiter's own phone: their shift switch (start / end) beside the Restaurant QR — this board is their Home. */
  waiterShift?: { shift: { id: string; since: string } | null; left: WorkLeft } | null;
}) {
  const router = useRouter();
  const refresh = useCallback(() => router.refresh(), [router]);
  useLiveOrders(refresh);
  const audio = useAudioReady();
  const [now, setNow] = useState(() => Date.now());
  const [dragging, setDragging] = useState<PortalOrder | null>(null);
  const [over, setOver] = useState<ColKey | null>(null);
  const [, start] = useTransition();
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(t); }, []);

  // A tap anywhere on the page allows sound (browsers need one).
  useEffect(() => {
    if (audio || !sound.enabled) return;
    const unlock = () => { void unlockAudio(); };
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    return () => { document.removeEventListener("pointerdown", unlock); document.removeEventListener("keydown", unlock); };
  }, [audio, sound.enabled]);

  const byId = new Map(orders.map((o) => [o.id, o]));
  const count = (k: ColKey) => orders.filter((o) => COLS[k].statuses.includes(o.status)).length;
  const items = (o: PortalOrder) => o.items.reduce((s, i) => s + i.quantity, 0);
  const describe = (id: string) => { const o = byId.get(id); return o ? `${shortNo(o.number)} ${o.place} · ${items(o)} item${items(o) === 1 ? "" : "s"}` : ""; };
  // What needs this person, oldest first: new orders (the Mpishi); ready orders and new orders (waiters — they can accept too).
  const drinksOnly = (o: PortalOrder) => o.items.length > 0 && o.items.every((i) => i.type === "DRINK");
  const canPrepare = (o: PortalOrder) => perms.cook || (drinksOnly(o) && perms.bar);
  const oldest = (xs: PortalOrder[]) => xs.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((o) => o.id);
  // (An order paid online still waiting for its payment check is not to accept yet.)
  const newOnes = role === "cook" || role === "waiter" ? oldest(orders.filter((o) => o.status === "PENDING" && canPrepare(o) && !o.awaitsPayment && !o.online)) : [];
  // A waiter hears their own ready orders and the ones nobody has yet; the shared screen hears them all.
  const readyOnes = role === "waiter" ? oldest(orders.filter((o) => o.status === "READY" && (perms.device || !o.assignedTo || o.assignedTo.id === meId))) : [];
  const attention = [...readyOnes, ...newOnes];
  const fresh = useOrderAlerts({
    attention, alertId: (id) => `${byId.get(id)?.status === "READY" ? "order_ready" : "order_new"}:${id}`, settings: sound, sound: role === "cook" ? sound.newSound : role === "waiter" ? (readyOnes.length ? sound.readySound : sound.newSound) : null,
    label: readyOnes.length ? "ORDER READY" : "NEW ORDER", describe,
  });
  // Money roles filter the board by payment: all, still to pay, paid, or waiting for reception to confirm.
  const [payFilter, setPayFilter] = useState<"all" | "unpaid" | "paid" | "confirm">("all");
  // On a phone one step at a time — it opens on what needs this person first (ready orders for waiters, new ones for the Mpishi).
  const [phoneStep, setPhoneStep] = useState<ColKey | "side">(() => {
    const first: ColKey[] = role === "cook" ? ["new", "preparing", "ready"] : ["ready", "new", "preparing", "out"];
    return first.find((k) => LAYOUT[role].board.includes(k) && orders.some((o) => COLS[k].statuses.includes(o.status))) ?? LAYOUT[role].board[0];
  });
  const seesMoney = role !== "cook" && orders.some((o) => o.total != null);
  // To confirm: a payment recorded but not confirmed, or an order paid online (LIPA) waiting for the money check.
  const pendingConfirm = (o: PortalOrder) => o.payments.some((p) => p.status === "POSTED" && !p.confirmedAt) || (o.awaitsPayment && o.status !== "CANCELLED");
  const payMatch = (o: PortalOrder) => payFilter === "all" ? true
    : payFilter === "unpaid" ? (o.due ?? 0) > 0
    : payFilter === "paid" ? o.settlement === "ROOM" || (o.total != null && (o.due ?? 0) === 0 && (o.paid ?? 0) > 0)
    : pendingConfirm(o);

  const summary = role === "cook"
    ? attention.length ? `${attention.length} new order${attention.length === 1 ? "" : "s"} waiting for you.` : "No new orders — all caught up."
    : role === "waiter"
      ? attention.length ? `${readyOnes.length} ready to serve · ${newOnes.length} new to accept.` : "Nothing waiting right now — new and ready orders appear here the moment they come in."
      : role === "desk"
        ? `${plural(orders.filter((o) => o.update && !o.told).length, "customer")} to update · ${plural(orders.filter((o) => (o.due ?? 0) > 0).length, "order")} to be paid · ${orders.filter(pendingConfirm).length ? `${plural(orders.filter(pendingConfirm).length, "payment")} to confirm · ` : ""}${orders.filter((o) => !["COMPLETED", "COLLECTED", "CANCELLED"].includes(o.status)).length} open.`
        : `${orders.filter((o) => !["COMPLETED", "COLLECTED", "CANCELLED"].includes(o.status)).length} open orders right now${avgPrep != null ? ` · average preparation ${avgPrep} min today` : ""}.`;

  // Dragging a card: only to the step that comes next for this person.
  const dropStatus = (o: PortalOrder, col: ColKey) => {
    const prep = role !== "desk" && canPrepare(o);
    if (col === "preparing" && o.status === "PENDING" && prep && !o.awaitsPayment && !o.online) return "PREPARING";
    if (col === "ready" && o.status === "PREPARING" && prep && allPrepared(o)) return "READY";
    if (col === "out" && o.status === "READY" && perms.serve && role !== "desk") return "OUT_FOR_DELIVERY";
    return null;
  };
  const canDrag = (o: PortalOrder) => (["preparing", "ready", "out"] as ColKey[]).some((c) => dropStatus(o, c));
  // Dragged on the restaurant screen, an order nobody has asks the waiter's PIN first — it becomes theirs.
  const askPin = useWaiterPin();
  const move = async (o: PortalOrder, status: string) => {
    const pin = perms.device && !o.assignedTo ? await askPin(`${shortNo(o.number)} · ${o.place}`) : undefined;
    if (pin === null) return;
    start(async () => {
      const res = await setOrderStatusAction({ id: o.id, status: status as never, pin });
      if (res.ok) router.refresh(); else toast.error(res.error);
    });
  };
  const sorted = (k: ColKey) => orders.filter((o) => COLS[k].statuses.includes(o.status) && payMatch(o))
    .sort((a, b) => (k === "done" || k === "cancelled" ? (b.doneAt ?? "").localeCompare(a.doneAt ?? "") : a.createdAt.localeCompare(b.createdAt)));

  const column = (k: ColKey, phoneHidden = false) => {
    const col = COLS[k];
    const list = sorted(k);
    const target = dragging ? dropStatus(dragging, k) : null;
    return (
      <section key={k}
        onDragOver={(e) => { if (target) { e.preventDefault(); setOver(k); } }}
        onDragLeave={() => setOver((x) => (x === k ? null : x))}
        onDrop={(e) => { e.preventDefault(); if (target && dragging) move(dragging, target); setDragging(null); setOver(null); }}
        className={cn("min-w-0 flex-col rounded-2xl border bg-muted/30 p-2 transition dark:bg-white/[0.02] lg:max-h-[calc(100svh-8rem)]", phoneHidden ? "hidden md:flex" : "flex",
          over === k ? "border-[oklch(0.75_0.12_80)] ring-2 ring-[oklch(0.75_0.12_80/0.3)]" : target ? "border-dashed border-[oklch(0.75_0.12_80/0.6)]" : "border-border/50")}>
        <header className="flex items-center gap-2 px-1.5 pb-2 pt-0.5" title={col.hint}>
          <span className={cn("size-2 shrink-0 rounded-full", col.dot)} />
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{col.title}</p>
          <span className={cn("min-w-6 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5 tabular-nums", list.length ? col.chip : "text-muted-foreground")}>{list.length}</span>
        </header>
        <div className="-mx-1 min-h-0 flex-1 space-y-2.5 overflow-y-auto px-1 pb-1 [scrollbar-width:thin]">
          <AnimatePresence initial={false}>
            {list.map((o) => (
              <OrderCard key={o.id} o={o} perms={perms} role={role} meId={meId} now={now} fresh={fresh.includes(o.id)} accounts={accounts} rooms={rooms}
                drag={canDrag(o) ? { onStart: () => setDragging(o), onEnd: () => { setDragging(null); setOver(null); } } : null} />
            ))}
          </AnimatePresence>
          {list.length === 0 && (
            <div className="grid place-items-center gap-1.5 rounded-2xl border border-dashed border-border/70 px-3 py-10 text-center text-xs text-muted-foreground [&_svg]:size-6 [&_svg]:opacity-40">
              {col.icon}{target ? "Drop here" : k === "new" ? "No new orders" : k === "ready" ? "Nothing ready yet" : "Nothing here"}
            </div>
          )}
        </div>
      </section>
    );
  };

  const layout = LAYOUT[role];
  // A link to one order (#order-… — the "Tap to open" cards, No waiter yet, alerts): on a phone, open the step it
  // is in (and show every payment) before scrolling to it — a hidden column would swallow the tap.
  const latest = useRef({ orders, layout, payMatch });
  useEffect(() => { latest.current = { orders, layout, payMatch }; });
  useEffect(() => {
    const open = (id: string | null) => {
      const { orders: all, layout: l, payMatch: shows } = latest.current;
      const o = id ? all.find((x) => x.id === id) : null;
      if (!o) return;
      setPhoneStep(l.board.find((k) => COLS[k].statuses.includes(o.status)) ?? "side");
      if (!shows(o)) setPayFilter("all");
      requestAnimationFrame(() => requestAnimationFrame(() => document.getElementById(`order-${o.id}`)?.scrollIntoView({ block: "center", behavior: "smooth" })));
    };
    const fromHash = (h: string) => (h.includes("#order-") ? h.slice(h.indexOf("#order-") + 7) : null);
    // Links go through the router (no hashchange): the tapped link says which order.
    const click = (e: MouseEvent) => { const a = (e.target as Element | null)?.closest?.('a[href*="#order-"]'); if (a) open(fromHash(a.getAttribute("href") ?? "")); };
    const hash = () => open(fromHash(window.location.hash));
    window.addEventListener("hashchange", hash);
    document.addEventListener("click", click);
    return () => { window.removeEventListener("hashchange", hash); document.removeEventListener("click", click); };
  }, []);
  const sideGroups = layout.side.groups.map((g) => ({ ...g, rows: g.cols.flatMap((k) => sorted(k)) }));
  const sideTotal = sideGroups.reduce((t, g) => t + g.rows.length, 0);
  const sideColumn = (phoneHidden = false) => {
    const groups = sideGroups;
    const total = sideTotal;
    return (
      <section key="side" className={cn("min-w-0 flex-col rounded-2xl border border-border/60 bg-muted/30 p-2 dark:bg-white/[0.02] lg:max-h-[calc(100svh-8rem)]", phoneHidden ? "hidden md:flex" : "flex")}>
        <header className="flex items-center gap-2 px-1.5 pb-2 pt-0.5" title="Today · tap one for its history">
          <span className="size-2 shrink-0 rounded-full bg-slate-400" />
          <p className="min-w-0 flex-1 truncate text-[13px] font-semibold">{layout.side.title}</p>
          <span className="min-w-6 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5 tabular-nums text-muted-foreground">{total}</span>
        </header>
        <div className="-mx-1 min-h-0 flex-1 space-y-3 overflow-y-auto px-1 pb-1 [scrollbar-width:thin]">
          {total === 0 && <div className="grid place-items-center gap-1.5 rounded-2xl border border-dashed border-border/70 px-3 py-10 text-center text-xs text-muted-foreground"><CheckCheck className="size-6 opacity-40" />Nothing yet today</div>}
          {groups.filter((g) => g.rows.length).map((g) => (
            <div key={g.title}>
              <p className="px-1 pb-1.5 text-[10px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/80">{g.title} · {g.rows.length}</p>
              <ul className="space-y-1.5">
                {g.rows.slice(0, 20).map((o) => {
                  const a = ACCENT[o.status] ?? ACCENT.PENDING;
                  const detail = o.status === "CANCELLED" ? o.cancelReason ?? "Cancelled" : o.status === "PREPARING" ? `${o.items.filter((i) => i.prepared).length} of ${o.items.length} done` : o.status === "PENDING" ? "New" : o.status === "ACCEPTED" ? "Accepted" : o.status === "OUT_FOR_DELIVERY" ? (o.assignedTo ? `Waiter · ${firstName(o.assignedTo.name)}` : o.takenBy ? `${firstName(o.takenBy)} is serving` : "No waiter yet") : payBadgeFor(o, perms, role).text;
                  return (
                    <li key={o.id} className="flex items-center gap-1.5">
                      <Link href={`/staff/restaurant/orders/${o.id}`} className="flex min-w-0 flex-1 items-center gap-2.5 rounded-xl border border-border/60 bg-card px-2 py-1.5 transition hover:-translate-y-px hover:shadow-[0_10px_22px_-16px_rgba(15,23,42,0.6)] dark:bg-white/[0.035]">
                        <span className={cn("grid h-7 min-w-7 shrink-0 place-items-center rounded-md px-1 text-[10px] font-bold tabular-nums [&_svg]:size-3.5", a.tile)}>{tileText(o)}</span>
                        <span className="min-w-0 flex-1 leading-tight">
                          <span className="block truncate text-xs font-semibold">{o.place} <span className="font-mono text-[10px] font-normal text-muted-foreground">{shortNo(o.number)}</span></span>
                          <span className="block truncate text-[10px] text-muted-foreground">{items(o)} item{items(o) === 1 ? "" : "s"} · {detail}</span>
                        </span>
                        <span suppressHydrationWarning className="shrink-0 text-[10px] tabular-nums text-muted-foreground">{clock(o.doneAt ?? o.createdAt)}</span>
                      </Link>
                      {role === "desk" && o.update && !o.told && <div className="w-24 shrink-0"><TextCustomer o={o} /></div>}
                      {o.status !== "CANCELLED" && (
                        <Link href={`/staff/restaurant-bill?order=${o.id}`} title="Print or download the receipt" aria-label={`Receipt for ${shortNo(o.number)}`}
                          className="grid size-9 shrink-0 place-items-center rounded-xl border border-border/60 bg-card text-[oklch(0.55_0.11_75)] transition hover:bg-muted dark:bg-white/[0.035] dark:text-[oklch(0.8_0.11_82)]"><Receipt className="size-3.5" /></Link>
                      )}
                    </li>
                  );
                })}
              </ul>
            </div>
          ))}
        </div>
      </section>
    );
  };

  // The day in one band, like the reception home: what is waiting, with a line that fills up as it gets done.
  const past = (k: ColKey[]) => orders.filter((o) => k.some((c) => COLS[c].statuses.includes(o.status))).length;
  const cooking = orders.filter((o) => COLS.preparing.statuses.includes(o.status));
  const itemsDone = cooking.reduce((t, o) => t + o.items.filter((i) => i.prepared).length, 0), itemsAll = cooking.reduce((t, o) => t + o.items.length, 0);
  const accepted = past(["preparing", "ready", "out", "done"]), takenOut = past(["out", "done"]), completed = count("done");
  const strip: TodayPart[] = [
    { label: "New orders", icon: <BellRing />, tone: "sky", href: newOnes.length ? `#order-${newOnes[0]}` : "#board", value: count("new"), unit: "to accept", done: accepted, of: accepted + count("new"),
      note: count("new") ? `${count("new")} waiting · ${accepted} accepted` : "Nothing waiting",
      alert: newOnes.length ? `${newOnes.slice(0, 2).map(describe).join(" · ")}${newOnes.length > 2 ? ` +${newOnes.length - 2} more` : ""}` : null },
    { label: "Preparing", icon: <Flame />, tone: "amber", href: "#board", value: count("preparing"), unit: count("preparing") === 1 ? "order" : "orders", done: itemsDone, of: itemsAll, note: itemsAll ? `${itemsDone} of ${itemsAll} items done` : "Nothing on the stove" },
    { label: "Ready", icon: <HandPlatter />, tone: "emerald", href: readyOnes.length ? `#order-${readyOnes[0]}` : "#board", value: count("ready"), unit: "to serve", done: takenOut, of: takenOut + count("ready"),
      note: count("ready") ? "Waiting for a waiter" : `${takenOut} served so far`,
      alert: readyOnes.length ? `${readyOnes.slice(0, 2).map(describe).join(" · ")}${readyOnes.length > 2 ? ` +${readyOnes.length - 2} more` : ""}` : null },
    { label: "Serving", icon: <Bike />, tone: "violet", href: "#board", value: count("out"), unit: "on the way", done: completed, of: completed + count("out"), note: `${completed} completed today` },
  ];

  // Managers and the shared screen: who serves what, under the live feed (beside the waiters' day).
  // (The main restaurant screen has its slim waiters bar instead.)
  const assignments = perms.watch ? <Assignments orders={orders} now={now} /> : null;
  const lead = activity && assignments ? <div className="flex min-w-0 flex-col gap-4">{activity}{assignments}</div> : activity ?? assignments;

  // The shared main-restaurant screen (perms.device): a small banner, the restaurant's money and tables in one band, small step cards.
  const main = perms.device && mainScreen ? mainScreen : null;
  // Reception, managers and admins: a slim live header (no photo banner) — the kitchen, a waiter's phone and the main screen keep theirs.
  const plain = role === "desk" || role === "manager";
  const flow = (["new", "preparing", "ready", "out", "done"] as const).map((k) => ({ k, n: count(k) }));
  const flowTotal = flow.reduce((t, f) => t + f.n, 0);
  const open = flowTotal - count("done");
  const header = (
    <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card">
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[oklch(0.78_0.12_80)]/70 to-transparent" />
      <div aria-hidden className="pointer-events-none absolute -left-16 -top-20 size-56 rounded-full bg-[oklch(0.75_0.12_80/0.10)] blur-3xl" />
      <div className="relative grid items-center gap-x-6 gap-y-4 px-4 py-4 sm:px-5 lg:grid-cols-[auto_minmax(0,1fr)_auto]">
        <div className="flex min-w-0 items-center gap-3.5">
          <span className="grid size-12 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-[oklch(0.84_0.11_85)] to-[oklch(0.62_0.12_65)] text-[#1b1611] shadow-[0_10px_24px_-12px_oklch(0.7_0.12_75)] [&_svg]:size-6"><ChefHat /></span>
          <div className="min-w-0">
            <p className="truncate text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">Restaurant & Bar · {name}</p>
            <h1 className="text-lg font-semibold leading-tight tracking-tight sm:text-xl">{role === "desk" ? "Hotel guests' orders" : "Restaurant & bar overview"}</h1>
            <p className="flex items-center gap-1.5 text-xs text-muted-foreground" suppressHydrationWarning>
              <span className="relative flex size-1.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-500 opacity-60" /><span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" /></span>
              Live · {clock(new Date(now).toISOString())}
            </p>
          </div>
        </div>

        {/* Where every order of the day stands, in one line */}
        <div className="min-w-0">
          <div className="flex items-baseline justify-between gap-3 text-xs">
            <span><strong className="text-base font-semibold tabular-nums text-foreground">{open}</strong> <span className="text-muted-foreground">open now</span></span>
            <span className="text-muted-foreground">{avgPrep != null ? <>preparation <strong className="font-semibold tabular-nums text-foreground">{avgPrep} min</strong> · </> : null}<strong className="font-semibold tabular-nums text-foreground">{count("done")}</strong> done today</span>
          </div>
          <div className="mt-2 flex h-2 gap-0.5 overflow-hidden rounded-full bg-muted">
            {flow.filter((f) => f.n > 0).map((f) => <span key={f.k} className={cn("h-full rounded-full", COLS[f.k].dot)} style={{ width: `${(f.n / flowTotal) * 100}%` }} title={`${COLS[f.k].title}: ${f.n}`} />)}
          </div>
          <ul className="mt-2 flex flex-wrap gap-x-3.5 gap-y-1 text-[11px] text-muted-foreground">
            {flow.map((f) => (
              <li key={f.k} className="inline-flex items-center gap-1.5"><span className={cn("size-1.5 rounded-full", COLS[f.k].dot)} />{f.k === "ready" ? "Ready" : f.k === "done" ? "Done" : COLS[f.k].title}<strong className="font-semibold tabular-nums text-foreground">{f.n}</strong></li>
            ))}
          </ul>
          {role === "desk" && <p className="mt-2 text-xs text-muted-foreground" suppressHydrationWarning>{summary}</p>}
        </div>

        {perms.manage && <div className="flex flex-wrap items-center gap-2 lg:justify-end"><SoundSettings sound={sound} /></div>}
      </div>
    </section>
  );

  return (
    <div className="w-full space-y-6">
      {main ? (
        // The main restaurant screen: "Vegas Restaurant & Bar", small, between the dining room and the bar.
        <MainBanner ready={readyOnes.length} fresh={count("new")} serving={count("out")} time={clock(new Date(now).toISOString())}
          aside={restaurantQr ? <RestaurantQrButton qr={restaurantQr} /> : undefined} />
      ) : plain ? header : <HeroBanner image="/images/illustrative/restaurant-lounge.webp"
        // One portal for the whole restaurant and bar — everyone signs in with their own account and sees what their role does.
        eyebrow={<>Restaurant & Bar</>}
        title={`${greeting}, ${name}`}
        subtitle={role === "cook"
          ? <><strong className="font-semibold text-white">{count("new")}</strong> new · <strong className="font-semibold text-white">{count("preparing")}</strong> preparing · <strong className="font-semibold text-white">{count("ready")}</strong> ready to serve</>
          : role === "waiter"
            ? <><strong className="font-semibold text-white">{readyOnes.length}</strong> ready to serve · <strong className="font-semibold text-white">{count("new")}</strong> new · <strong className="font-semibold text-white">{count("out")}</strong> on the way</>
            : <>{summary}</>}
        aside={perms.manage ? <SoundSettings sound={sound} /> : undefined}
      />}

      {main ? (
        // The main restaurant screen: the money and the tables in one band, then the steps — all small.
        <>
          <MainScreenStrip data={main} money={money ?? null} />
          <TodayStrip parts={strip} compact />
        </>
      ) : (
        <>
          {money && <MoneyStrip orders={orders} money={money} hotel={role === "desk"} />}

          {(shortcuts.length > 0 || restaurantQr || waiterShift) && (
            <div className="flex flex-wrap items-center gap-2">
              {restaurantQr && <RestaurantQrButton qr={restaurantQr} />}
              {waiterShift && <WaiterShiftSwitch me={meId} shift={waiterShift.shift} left={waiterShift.left} />}
              {shortcuts.length > 0 && <QuickActions items={shortcuts.map((x) => ({ ...x, icon: SHORTCUT_ICON[x.icon] }))} />}
            </div>
          )}
          <TodayStrip parts={strip} />
        </>
      )}
      {/* The main restaurant screen: waiters take charge on the order cards themselves — no separate list. */}
      {role !== "cook" && !main && <NoWaiterYet orders={orders} now={now} canTake={!!takesCharge && !perms.watch} watch={perms.watch} />}
      {main && <OrdersBar orders={orders} />}
      {lead && numbers ? (
        <div className="grid grid-cols-1 items-stretch gap-4 xl:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)]">{lead}{numbers}</div>
      ) : lead ?? numbers}

      <div id="board" className="scroll-mt-24">
        <SectionLabel title={role === "cook" ? "Your kitchen" : role === "waiter" && !perms.device ? "Your orders" : perms.watch ? "Every order, live" : "All orders"} href={perms.watch ? undefined : "/staff/restaurant/pos"} linkLabel="New order" />
        {seesMoney && (
          <div role="tablist" aria-label="Filter by payment" className="-mt-1 mb-3 flex flex-wrap gap-1.5">
            {([
              ["all", "All orders", orders.filter((o) => o.status !== "CANCELLED").length],
              ["unpaid", "Unpaid", orders.filter((o) => (o.due ?? 0) > 0).length],
              ["paid", "Paid & room bills", orders.filter((o) => o.status !== "CANCELLED" && (o.settlement === "ROOM" || ((o.due ?? 0) === 0 && (o.paid ?? 0) > 0))).length],
              ["confirm", "To confirm", orders.filter(pendingConfirm).length],
            ] as const).filter(([k, , n]) => k !== "confirm" || n > 0 || payFilter === k).map(([k, label, n]) => (
              <button key={k} type="button" role="tab" aria-selected={payFilter === k} onClick={() => setPayFilter(k)}
                className={cn("inline-flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition",
                  payFilter === k ? "border-[oklch(0.75_0.12_80)] bg-[oklch(0.72_0.12_80/0.14)] text-foreground" : "border-border/70 text-muted-foreground hover:bg-muted hover:text-foreground")}>
                {label}
                <span className={cn("min-w-5 rounded-full px-1.5 text-[10px] leading-4 tabular-nums", k === "confirm" && n ? "bg-amber-400 text-[#1b1611]" : k === "unpaid" && n ? "bg-rose-500/80 text-white" : "bg-muted text-muted-foreground")}>{n}</span>
              </button>
            ))}
          </div>
        )}
        {/* On a phone: one step at a time — tap New, Preparing, Ready to serve, Serving… (a computer shows them side by side) */}
        <div role="tablist" aria-label="Orders by step" className="mb-3 flex flex-wrap gap-1.5 md:hidden">
          {[...layout.board.map((k) => ({ k: k as ColKey | "side", label: COLS[k].title, n: sorted(k).length, dot: COLS[k].dot })), { k: "side" as const, label: layout.side.title, n: sideTotal, dot: "bg-slate-400" }].map((c) => (
            <button key={c.k} type="button" role="tab" aria-selected={phoneStep === c.k} onClick={() => setPhoneStep(c.k)}
              className={cn("inline-flex h-9 shrink-0 items-center gap-1.5 rounded-full border px-3 text-xs font-semibold transition",
                phoneStep === c.k ? "border-[oklch(0.75_0.12_80)] bg-[oklch(0.72_0.12_80/0.14)] text-foreground" : "border-border/70 text-muted-foreground")}>
              <span className={cn("size-1.5 rounded-full", c.dot)} />{c.label}
              <span className={cn("min-w-5 rounded-full px-1.5 text-[10px] leading-4 tabular-nums", c.n ? "bg-foreground/10 text-foreground" : "bg-muted text-muted-foreground")}>{c.n}</span>
            </button>
          ))}
        </div>
      <LayoutGroup>
        <div className={cn("grid items-start gap-3", GRID[role])}>
          {layout.board.map((k) => column(k, phoneStep !== k))}
          {sideColumn(phoneStep !== "side")}
        </div>
      </LayoutGroup>
      </div>
    </div>
  );
}

const tzs = (v: number) => `TZS ${v.toLocaleString("en-US")}`;
const firstName = (n: string) => n.replace(/\s*\(.*\)/, "").split(" ")[0];
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? "" : "s"}`;

/**
 * At the top, in one band: who the orders on the board are for (guests staying here vs
 * customers from outside) and where the money is — received, still to collect, on room bills.
 */
/** `hotel`: reception's view — only the hotel's orders (rooms, reception, staying guests). */
function MoneyStrip({ orders, money, hotel = false }: { orders: PortalOrder[]; money: MoneySummary; hotel?: boolean }) {
  const live = orders.filter((o) => o.status !== "CANCELLED");
  const rooms = live.filter((o) => o.type === "ROOM_SERVICE" || o.reservation);
  const outside = live.filter((o) => o.type !== "ROOM_SERVICE" && !o.reservation);
  const sum = (xs: PortalOrder[]) => xs.reduce((t, o) => t + (o.total ?? 0), 0);
  const roomShare = live.length ? Math.round((rooms.length / live.length) * 100) : 0;
  const cells: { label: string; icon: React.ReactNode; tone: string; value: string; unit?: string; sub: React.ReactNode }[] = [
    { label: hotel ? "Hotel orders" : "All orders", icon: <Receipt />, tone: "bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.84_0.11_82)]", value: String(live.length), unit: live.length === 1 ? "order" : "orders",
      sub: <span className="flex items-center gap-2"><span className="flex h-1.5 w-14 shrink-0 overflow-hidden rounded-full bg-sky-500/70"><span className="h-full bg-violet-500" style={{ width: `${roomShare}%` }} /></span>{tzs(sum(live))}</span> },
    { label: hotel ? "To the rooms" : "Room guests", icon: <BedDouble />, tone: "bg-violet-500/15 text-violet-300", value: String(rooms.length), unit: rooms.length === 1 ? "order" : "orders", sub: `${tzs(sum(rooms))} · ${hotel ? "room service & room bills" : "staying here"}` },
    { label: hotel ? "At the restaurant & desk" : "Outside customers", icon: <Users />, tone: "bg-sky-500/15 text-sky-300", value: String(outside.length), unit: outside.length === 1 ? "order" : "orders", sub: `${tzs(sum(outside))} · ${hotel ? "staying guests, sold at reception" : "walk-in & online"}` },
    { label: "Received today", icon: <Banknote />, tone: "bg-emerald-500/15 text-emerald-300", value: tzs(money.received),
      sub: money.toConfirm ? <span className="font-medium text-amber-300">{plural(money.toConfirm, "payment")} to confirm · {tzs(money.toConfirmAmount)}</span> : `${plural(money.receivedOrders, "order")} paid` },
    { label: "To collect", icon: <HandCoins />, tone: "bg-rose-500/15 text-rose-300", value: tzs(money.toCollect), sub: money.toCollectOrders ? `${plural(money.toCollectOrders, "order")} not paid yet` : "All paid" },
    { label: "On room bills", icon: <Hotel />, tone: "bg-amber-500/15 text-amber-300", value: tzs(money.onRooms), sub: `${plural(money.rooms, "room")} · paid at check-out` },
  ];
  return (
    <section aria-label="Orders and money" className="grid grid-cols-2 gap-px overflow-hidden rounded-3xl border border-border/70 bg-border/60 sm:grid-cols-3 2xl:grid-cols-6">
      {cells.map((c) => (
        <div key={c.label} className="min-w-0 bg-card px-4 py-3.5">
          <p className="flex items-center gap-2">
            <span className={cn("grid size-6 shrink-0 place-items-center rounded-md [&_svg]:size-3.5", c.tone)}>{c.icon}</span>
            <span className="truncate text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{c.label}</span>
          </p>
          <p className="mt-2 flex items-baseline gap-1.5 whitespace-nowrap">
            <span className={cn("font-semibold leading-none tracking-tight tabular-nums", c.unit ? "text-2xl" : "text-xl")}>{c.value}</span>
            {c.unit && <span className="text-xs text-muted-foreground">{c.unit}</span>}
          </p>
          <div className="mt-1.5 truncate text-xs text-muted-foreground">{c.sub}</div>
        </div>
      ))}
    </section>
  );
}

/** Manager / admin: the sounds every restaurant screen plays. */
function SoundSettings({ sound }: { sound: SoundConfig }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [v, setV] = useState(sound);
  const [pending, start] = useTransition();
  const save = () => start(async () => {
    const res = await saveOrderSoundsAction({
      orderSoundsEnabled: v.enabled, orderSoundVolume: v.volume, newOrderSound: v.newSound as never, readyOrderSound: v.readySound as never, orderPaymentConfirm: v.confirmPayments,
    });
    if (res.ok) { toast.success(res.message ?? "Saved."); setOpen(false); router.refresh(); } else toast.error(res.error);
  });
  const test = async (name: string) => {
    if (isMuted()) { toast("Your bell is off — tap the bell at the top to hear the sounds."); return; }
    await unlockAudio(); playSound(name, v.volume);
  };
  return (
    <>
      <button type="button" onClick={() => { setV(sound); setOpen(true); }} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-border/70 bg-card px-3 text-xs font-medium hover:bg-muted">
        <Settings2 className="size-3.5" />Portal settings
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<BellRing />} eyebrow="Portal settings" tone="violet"><DialogTitle>Restaurant sounds</DialogTitle><DialogDescription>For every restaurant screen: the Mpishi hears new orders; waiters hear new and ready orders.</DialogDescription></DialogHeader>
          <label className="flex items-center justify-between gap-3 rounded-xl border border-border px-3 py-2.5 text-sm font-medium">Order sounds
            <input type="checkbox" checked={v.enabled} onChange={(e) => setV({ ...v, enabled: e.target.checked })} className="size-5 accent-amber-500" />
          </label>
          <label className="block text-sm font-medium">Volume · {v.volume}%
            <input type="range" min={0} max={100} step={5} value={v.volume} onChange={(e) => setV({ ...v, volume: Number(e.target.value) })} className="mt-1 w-full accent-amber-500" />
          </label>
          {([["newSound", "New order (Mpishi)"], ["readySound", "Order ready (waiters)"]] as const).map(([key, label]) => (
            <div key={key}>
              <p className="mb-1 text-sm font-medium">{label}</p>
              <div className="grid grid-cols-2 gap-1.5">
                {Object.entries(SOUNDS).map(([id, name]) => (
                  <button key={id} type="button" onClick={() => { setV({ ...v, [key]: id }); void test(id); }}
                    className={cn("rounded-xl border px-3 py-2 text-left text-sm", v[key] === id ? "border-amber-500 bg-amber-500/10 font-semibold" : "border-border hover:bg-muted")}>{name}</button>
                ))}
              </div>
            </div>
          ))}
          <p className="rounded-xl bg-muted/60 px-3 py-2 text-xs text-muted-foreground">Each new order or notification rings twice — once, then again 5 seconds later — and stops. Anyone can silence their screens with the bell at the top.</p>
          <Button disabled={pending} onClick={save}>{pending && <Loader2 className="animate-spin" />}Save for all screens</Button>
        </DialogContent>
      </Dialog>
    </>
  );
}
