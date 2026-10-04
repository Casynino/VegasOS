"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { SoundConfig } from "@/app/staff/(app)/restaurant/portal/types";
import { setAlertSoundAction } from "./sound-actions";

/**
 * Staff alert sounds, made in the browser (no audio files): a new order for the cook, a ready
 * order for waiters, a new booking or guest request for reception… Browsers only allow sound
 * after someone has tapped the page, so the first tap anywhere lets it ring. The bell in the top
 * bar is the person's on / off (green: on, amber: on but waiting for that tap, red: off).
 */

export const SOUNDS: Record<string, string> = { bell: "Bell", chime: "Chime", marimba: "Marimba", alarm: "Alarm (loud)" };
export type SoundSettings = SoundConfig;

let ctx: AudioContext | null = null;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((l) => l());

function context() {
  if (typeof window === "undefined") return null;
  if (!ctx) {
    try {
      ctx = new AudioContext();
      ctx.onstatechange = emit;
    } catch { return null; }
  }
  return ctx;
}

/** Try to allow sound (works inside a tap / click / key press). */
export async function unlockAudio() {
  const c = context();
  if (!c) return false;
  try { if (c.state !== "running") await c.resume(); } catch { /* still blocked */ }
  emit();
  return c.state === "running";
}

const subscribe = (cb: () => void) => { listeners.add(cb); return () => { listeners.delete(cb); }; };
/** Whether this screen may play sound right now. */
export function useAudioReady() {
  return useSyncExternalStore(subscribe, () => ctx?.state === "running", () => false);
}

// ── On / off (the top-bar bell) — off silences every alert for this person: in every tab at once, and
// in their other browsers / devices within seconds (it is kept on their account and comes with each check) ──
const MUTE_KEY = "vegas-staff-sound-off";
let mutedMemory = false; // private mode (no storage): remembered for this tab only
let muteEdits = 0; // bumps on every switch — an answer from the server asked for before it is stale
let lastEditAt = 0;
const playing = new Set<GainNode>();
const edited = () => { muteEdits++; lastEditAt = Date.now(); };
if (typeof window !== "undefined") {
  // Switched in another tab: follow it here too, straight away.
  window.addEventListener("storage", (e) => { if (e.key === MUTE_KEY) { edited(); if (isMuted()) silenceNow(); emit(); } });
}

/** Read fresh each time — so a switch in another tab counts at once. */
export function isMuted() {
  if (typeof window === "undefined") return false;
  try { return localStorage.getItem(MUTE_KEY) === "1"; } catch { return mutedMemory; }
}
function writeMuted(off: boolean) {
  mutedMemory = off;
  try { if (off) localStorage.setItem(MUTE_KEY, "1"); else localStorage.removeItem(MUTE_KEY); } catch { /* private mode */ }
  if (off) silenceNow();
  emit();
}
/** Off: cut the sound ringing right now, and the second ring still to come. */
function silenceNow() {
  if (secondRing) { clearTimeout(secondRing); secondRing = null; }
  playing.forEach((g) => { try { g.disconnect(); } catch { /* already done */ } });
  playing.clear();
}
/** The bell was tapped: quiet (or ringing) here at once, then saved on the account. Resolves false when it could not be saved. */
export async function setMuted(off: boolean) {
  edited();
  writeMuted(off);
  try { return (await setAlertSoundAction(off)).ok; } catch { return false; } finally { edited(); }
}
/** Take it before asking the server, and hand it to {@link syncMuted} with the answer. */
export const muteStamp = () => muteEdits;
/** The on / off saved on the account (switched on another screen) — unless switched here meanwhile. */
export function syncMuted(off: boolean, stamp: number) {
  if (stamp !== muteEdits || Date.now() - lastEditAt < 8000 || off === isMuted()) return;
  writeMuted(off);
}
/** Whether this person switched their sound off. */
export function useMuted(initial: boolean) {
  return useSyncExternalStore(subscribe, isMuted, () => initial);
}

type Note = { f: number; at: number; len: number; type?: OscillatorType; gain?: number };
const TUNES: Record<string, Note[]> = {
  bell: [
    { f: 1046, at: 0, len: 1.3 }, { f: 2093, at: 0, len: 0.8, gain: 0.35 },
    { f: 1046, at: 0.55, len: 1.3 }, { f: 2093, at: 0.55, len: 0.8, gain: 0.35 },
  ],
  chime: [{ f: 880, at: 0, len: 0.55 }, { f: 1318, at: 0.18, len: 0.8 }],
  marimba: [{ f: 523, at: 0, len: 0.35, type: "triangle" }, { f: 659, at: 0.12, len: 0.35, type: "triangle" }, { f: 784, at: 0.24, len: 0.35, type: "triangle" }, { f: 1046, at: 0.36, len: 0.6, type: "triangle" }],
  alarm: [0, 0.22, 0.44, 0.9, 1.12, 1.34].map((at) => ({ f: 988, at, len: 0.16, type: "square" as const, gain: 0.45 })),
};

/** The tune's length in seconds. */
const tuneLength = (name: string) => Math.max(...(TUNES[name] ?? TUNES.chime).map((n) => n.at + n.len));

/**
 * Play one of the sounds once, at a volume from 0 to 100 — loud and clear: a limiter lets it go
 * well above the old level without crackling. Silent while the bell is off.
 */
export function playSound(name: string, volume: number) {
  const c = context();
  if (!c || c.state !== "running" || volume <= 0 || isMuted()) return;
  const limiter = c.createDynamicsCompressor();
  limiter.threshold.value = -8; limiter.knee.value = 4; limiter.ratio.value = 12; limiter.attack.value = 0.002; limiter.release.value = 0.2;
  limiter.connect(c.destination);
  const master = c.createGain();
  master.gain.value = Math.min(1, volume / 100) * 2.2;
  master.connect(limiter);
  ring(c, master, name, c.currentTime + 0.02);
  playing.add(master);
  setTimeout(() => playing.delete(master), (tuneLength(name) + 0.5) * 1000);
}

// ── Alerts: every new notification rings twice — once now, once 5 seconds later — then stops.
// Nothing rings again while it waits for someone to act. ──
const SECOND_RING_MS = 5000;
let secondRing: ReturnType<typeof setTimeout> | null = null;
/** Ring for something new: now, and again in 5 seconds. Another alert meanwhile starts the pair again (never piles up). */
export function ringAlert(name: string, volume: number) {
  if (isMuted()) return;
  if (secondRing) clearTimeout(secondRing);
  playSound(name, volume);
  secondRing = setTimeout(() => { secondRing = null; playSound(name, volume); }, SECOND_RING_MS);
}

// Several tabs open: the first one to see a notification rings for it — the others stay quiet.
const RUNG_KEY = "vegas-staff-rung";
/** The notifications (ids) no other tab of this browser has rung for yet — now marked as rung. */
export function claimRing(ids: string[]) {
  if (!ids.length) return ids;
  try {
    const now = Date.now();
    const rung = Object.fromEntries(Object.entries(JSON.parse(localStorage.getItem(RUNG_KEY) ?? "{}") as Record<string, number>).filter(([, at]) => now - at < 6 * 3600_000));
    const fresh = ids.filter((id) => !(id in rung));
    fresh.forEach((id) => { rung[id] = now; });
    localStorage.setItem(RUNG_KEY, JSON.stringify(Object.fromEntries(Object.entries(rung).slice(-400))));
    return fresh;
  } catch { return ids; } // no storage (private mode): this tab rings
}

function ring(c: AudioContext, master: GainNode, name: string, t0: number) {
  for (const n of TUNES[name] ?? TUNES.chime) {
    const o = c.createOscillator(), g = c.createGain();
    o.type = n.type ?? "sine"; o.frequency.value = n.f;
    const peak = n.gain ?? 0.8;
    g.gain.setValueAtTime(0.0001, t0 + n.at);
    g.gain.exponentialRampToValueAtTime(peak, t0 + n.at + 0.015);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + n.at + n.len);
    o.connect(g).connect(master);
    o.start(t0 + n.at); o.stop(t0 + n.at + n.len + 0.05);
  }
}

/** Pop-up notifications from the browser (also when the portal is behind another window). */
export function useNotifyPermission() {
  const read = () => (typeof Notification === "undefined" ? "unsupported" : Notification.permission);
  const [perm, setPerm] = useState<string>("default");
  useEffect(() => { const t = setTimeout(() => setPerm(read()), 0); return () => clearTimeout(t); }, []);
  const ask = useCallback(async () => {
    if (typeof Notification === "undefined") return;
    try { setPerm(await Notification.requestPermission()); } catch { /* ignored */ }
  }, []);
  return { perm, ask };
}

/**
 * Watch the orders that need this person (new orders for the cook, ready ones for waiters):
 * when one arrives it rings twice (now and 5 seconds later), pops up and is highlighted; the
 * tab title flashes while something waits — but the sound does not repeat.
 */
export function useOrderAlerts({ attention, alertId, settings, sound, label, describe }: {
  /** Ids of the orders waiting for this person, oldest first. */
  attention: string[];
  /** The notification an order is right now ("order_new:…" / "order_ready:…" — as the top-bar bell names it): a new order that becomes ready is news again, and one tab rings for it, not every tab. */
  alertId: (id: string) => string;
  settings: SoundSettings;
  /** Which sound to play (new order / ready order); null = this screen stays quiet. */
  sound: string | null;
  label: string;
  describe: (id: string) => string;
}) {
  const seen = useRef<Set<string> | null>(null);
  const [fresh, setFresh] = useState<string[]>([]);
  const key = attention.join(",");
  const alerts = attention.map(alertId).join(",");
  const describeRef = useRef(describe);
  useEffect(() => { describeRef.current = describe; });

  // Something new arrived: sound, pop-up, highlight.
  useEffect(() => {
    const ids = key ? key.split(",") : [];
    const news = alerts ? alerts.split(",") : [];
    if (seen.current === null) { seen.current = new Set(news); return; }
    const arrived = ids.filter((_, i) => !seen.current!.has(news[i]));
    const arrivedNews = news.filter((n) => !seen.current!.has(n));
    news.forEach((n) => seen.current!.add(n));
    if (!arrived.length) return;
    if (sound && settings.enabled && claimRing(arrivedNews).length) ringAlert(sound, settings.volume);
    // A pop-up from the browser plays the computer's own sound — so none while the bell is off.
    if (sound && !isMuted() && typeof Notification !== "undefined" && Notification.permission === "granted") {
      try { new Notification(label, { body: arrived.map((id) => describeRef.current(id)).join("\n"), tag: `vegas-${label}`, requireInteraction: false }); } catch { /* ignored */ }
    }
    const t0 = setTimeout(() => setFresh((f) => [...new Set([...f, ...arrived])]), 0);
    const t = setTimeout(() => setFresh((f) => f.filter((id) => !arrived.includes(id))), 15000);
    return () => { clearTimeout(t0); clearTimeout(t); };
  }, [key, alerts, sound, settings.enabled, settings.volume, label]);

  // The tab title flashes while something is waiting.
  useEffect(() => {
    if (!key || !sound) return;
    const original = document.title;
    const n = key.split(",").length;
    let on = false;
    const t = setInterval(() => { on = !on; document.title = on ? `🔔 ${label} (${n})` : original; }, 1200);
    return () => { clearInterval(t); document.title = original; };
  }, [key, sound, label]);

  return fresh;
}

/**
 * Near-instant updates: ask the server "has anything changed?" every few seconds (a tiny
 * request) and reload the orders only when it has. A full reload every 30 s as a safety net.
 */
export function useLiveOrders(refresh: () => void, everyMs = 3000) {
  const last = useRef<string | null>(null);
  const [online, setOnline] = useState(true);
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      if (document.visibilityState !== "visible") return;
      try {
        const res = await fetch("/api/restaurant/pulse", { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const { v } = (await res.json()) as { v: string };
        if (stop) return;
        setOnline(true);
        if (last.current !== null && v !== last.current) refresh();
        last.current = v;
      } catch { if (!stop) setOnline(false); }
    };
    void tick();
    const t = setInterval(tick, everyMs);
    const full = setInterval(() => { if (document.visibilityState === "visible") refresh(); }, 30000);
    const onShow = () => { if (document.visibilityState === "visible") { void tick(); refresh(); } };
    document.addEventListener("visibilitychange", onShow);
    return () => { stop = true; clearInterval(t); clearInterval(full); document.removeEventListener("visibilitychange", onShow); };
  }, [refresh, everyMs]);
  return online;
}
