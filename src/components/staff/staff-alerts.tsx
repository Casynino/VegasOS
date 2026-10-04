"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { toast } from "sonner";
import { Bell, BellOff, CalendarCheck, ChefHat, ClipboardList, ConciergeBell, HandPlatter, Receipt, Wallet, type LucideIcon } from "lucide-react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import type { StaffAlert, StaffAlertKind } from "@/server/services/staff-alerts";
import { claimRing, isMuted, muteStamp, ringAlert, setMuted, syncMuted, unlockAudio, useAudioReady, useMuted } from "./sounds";

export type AlertSound = { enabled: boolean; volume: number; newSound: string; readySound: string };

const KIND: Record<StaffAlertKind, { icon: LucideIcon; tone: string; title: string }> = {
  booking: { icon: CalendarCheck, tone: "bg-sky-500/15 text-sky-300", title: "New booking" },
  request: { icon: ConciergeBell, tone: "bg-violet-500/15 text-violet-300", title: "Guest request" },
  payment: { icon: Wallet, tone: "bg-emerald-500/15 text-emerald-300", title: "Payment to confirm" },
  bill: { icon: Receipt, tone: "bg-amber-500/15 text-amber-300", title: "Bill asked" },
  order_new: { icon: ChefHat, tone: "bg-rose-500/15 text-rose-300", title: "New order" },
  order_ready: { icon: HandPlatter, tone: "bg-teal-500/15 text-teal-300", title: "Order ready" },
  stock: { icon: ClipboardList, tone: "bg-orange-500/15 text-orange-300", title: "Stock request" },
};
/** Ready orders and bills are for the waiter: the "ready" sound; everything new: the "new" sound. */
const soundFor = (k: StaffAlertKind, s: AlertSound) => (k === "order_ready" || k === "bill" ? s.readySound : s.newSound);
const EVERY_MS = 5000;

/**
 * THE BELL — the only one, on every staff page, for everyone: it asks every few seconds what is
 * waiting for this person (reception: new bookings, guest requests, payments to confirm;
 * waiters: ready orders, tables asking for the bill; the kitchen: new orders; managers: stock
 * requests to review and purchases to approve). Something new
 * rings twice — now, and again 5 seconds later — then stops (it never keeps ringing while it
 * waits), pops up, and the page refreshes itself. Tap the bell: off (red dot, silent at once) —
 * tap again: on (green dot). Off is this person's choice, kept on their account: silent in every
 * tab, browser and device they use, until they tap it on again. Amber: on, but the browser still
 * wants one tap on the page before it may ring. The red number lists what is waiting. On the
 * restaurant portal the orders ring there (the same on / off).
 */
export function StaffAlerts({ sound, soundOff }: { sound: AlertSound; soundOff: boolean }) {
  const router = useRouter();
  const pathname = usePathname();
  const audio = useAudioReady();
  const muted = useMuted(soundOff);
  const [items, setItems] = useState<StaffAlert[]>([]);
  const [online, setOnline] = useState(true);
  const seen = useRef<Set<string> | null>(null);
  const last = useRef<string | null>(null);
  const soundRef = useRef(sound);
  useEffect(() => { soundRef.current = sound; });
  // The restaurant portal rings for its own orders (with its own highlights) — the bell does the rest there.
  const onPortal = pathname === "/staff/restaurant";
  const mine = useCallback((xs: StaffAlert[]) => (onPortal ? xs.filter((x) => !x.kind.startsWith("order_")) : xs), [onPortal]);

  // Off on the account (e.g. switched on another computer): off here too.
  const firstOff = useRef(soundOff);
  useEffect(() => { syncMuted(firstOff.current, muteStamp()); }, []);

  // The first tap anywhere lets the browser play sound (browsers need one) — it never switches the bell on or off.
  useEffect(() => {
    if (audio) return;
    const unlock = () => { void unlockAudio(); };
    document.addEventListener("pointerdown", unlock, { once: true });
    document.addEventListener("keydown", unlock, { once: true });
    return () => { document.removeEventListener("pointerdown", unlock); document.removeEventListener("keydown", unlock); };
  }, [audio]);

  // Ask what is waiting; ring for what is new.
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const stamp = muteStamp();
        const res = await fetch("/api/staff/alerts", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const { items: all, soundOff: off } = (await res.json()) as { items: StaffAlert[]; soundOff: boolean };
        if (stop) return;
        setOnline(true);
        syncMuted(off, stamp);
        setItems(all);
        const key = all.map((x) => x.id).join(",");
        if (last.current !== null && key !== last.current) router.refresh();
        last.current = key;
        if (seen.current === null) { seen.current = new Set(all.map((x) => x.id)); return; }
        const arrived = mine(all).filter((x) => !seen.current!.has(x.id));
        all.forEach((x) => seen.current!.add(x.id));
        if (!arrived.length) return;
        const s = soundRef.current;
        // Rings for each new notification — once per browser, even with several tabs open.
        if (s.enabled && claimRing(arrived.map((a) => a.id)).length) ringAlert(soundFor(arrived[0].kind, s), s.volume);
        for (const a of arrived.slice(0, 3)) toast(KIND[a.kind].title, { description: a.text, action: { label: "Open", onClick: () => router.push(a.href) }, duration: 10_000 });
        // A browser pop-up plays the computer's own sound — so none while the bell is off.
        if (document.hidden && !isMuted() && typeof Notification !== "undefined" && Notification.permission === "granted") {
          try { new Notification(KIND[arrived[0].kind].title, { body: arrived.map((a) => a.text).join("\n"), tag: "vegas-staff" }); } catch { /* ignored */ }
        }
      } catch { if (!stop) setOnline(false); }
    };
    void tick();
    const t = setInterval(tick, EVERY_MS);
    const onShow = () => { if (document.visibilityState === "visible") void tick(); };
    document.addEventListener("visibilitychange", onShow);
    return () => { stop = true; clearInterval(t); document.removeEventListener("visibilitychange", onShow); };
  }, [router, mine]);

  const waiting = mine(items);

  // The bell shows only this person's choice — never whether the browser has allowed sound yet.
  const on = sound.enabled && !muted;
  const tone: DotTone = !on ? "off" : audio && online ? "on" : "wait";
  const toggle = async () => {
    if (!sound.enabled) { toast("Sounds are switched off in the manager's sound settings."); return; }
    if (on) {
      toast("Sound off — no ringing on any of your screens.");
      if (!(await setMuted(true))) toast.error("Could not save that — check the connection, then tap the bell again.");
      return;
    }
    const unlocked = unlockAudio(); // inside the tap, so the browser allows it
    const saved = setMuted(false);
    // No test ring: sound comes only with a new notification.
    toast(await unlocked ? "Sound on — each new notification rings twice." : "Sound on — tap anywhere on the page once so the browser lets it ring.");
    if (!(await saved)) toast.error("Could not save that — check the connection, then tap the bell again.");
    if (typeof Notification !== "undefined" && Notification.permission === "default") { try { await Notification.requestPermission(); } catch { /* ignored */ } }
  };
  const status = !sound.enabled ? "Sounds are off (manager's setting)"
    : !on ? "Sound off — tap to turn on"
    : !online ? "Sound on · reconnecting… — tap to turn off"
    : !audio ? "Sound on — tap anywhere on the page so the browser lets it ring · tap the bell to turn off"
    : "Sound on — tap to turn off";

  return (
    <div className="relative shrink-0">
      <button type="button" onClick={toggle} aria-pressed={on} aria-label={status} title={status}
        className={cn("relative grid size-10 place-items-center rounded-full border transition-colors hover:bg-muted", on ? "border-emerald-500/35 text-foreground" : "border-border text-muted-foreground")}>
        {on ? <Bell className="size-4" /> : <BellOff className="size-4" />}
        <StatusDot tone={tone} />
      </button>
      {waiting.length > 0 && (
        <Popover>
          <PopoverTrigger render={<button type="button" aria-label={`${waiting.length} waiting for you — see them`} title="What is waiting for you"
            className="absolute -right-1.5 -top-1.5 grid h-5 min-w-5 place-items-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-card transition hover:scale-110" />}>
            {waiting.length > 99 ? "99+" : waiting.length}
          </PopoverTrigger>
          <PopoverContent align="end" className="w-80 gap-0 rounded-2xl p-0">
            <p className="border-b border-border/70 px-3.5 py-2.5 text-xs font-semibold">Waiting for you · {waiting.length}</p>
            <ul className="max-h-80 divide-y divide-border/50 overflow-y-auto">
              {waiting.slice(0, 12).map((x) => {
                const k = KIND[x.kind];
                return (
                  <li key={x.id}>
                    <Link href={x.href} className="flex items-center gap-2.5 px-3.5 py-2.5 transition-colors hover:bg-muted/60">
                      <span className={cn("grid size-8 shrink-0 place-items-center rounded-full", k.tone)}><k.icon className="size-4" /></span>
                      <span className="min-w-0 flex-1 leading-tight">
                        <span className="block text-[11px] font-semibold text-muted-foreground">{k.title}</span>
                        <span className="block truncate text-[13px]">{x.text.replace(/^[^—]+— /, "")}</span>
                      </span>
                    </Link>
                  </li>
                );
              })}
            </ul>
          </PopoverContent>
        </Popover>
      )}
    </div>
  );
}

export type DotTone = "on" | "wait" | "off";
/** Green: sound on and ringing. Amber: on, waiting for the browser (a tap) or the connection. Red: off. */
export function StatusDot({ tone, className }: { tone: DotTone; className?: string }) {
  return (
    <span className={cn("absolute -bottom-0.5 -right-0.5 flex size-3 items-center justify-center rounded-full bg-card", className)}>
      {tone === "on" && <span className="absolute inline-flex size-2 animate-ping rounded-full bg-emerald-400 opacity-60" />}
      <span className={cn("relative inline-flex size-2 rounded-full", tone === "on" ? "bg-emerald-400" : tone === "wait" ? "bg-amber-400" : "bg-rose-500")} />
    </span>
  );
}
