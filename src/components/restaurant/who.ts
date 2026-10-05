"use client";

import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react";
import { validPhone } from "@/lib/guest-messages";

/**
 * Who is ordering — asked once, before the first item goes in the order (tables, the counter,
 * the main restaurant QR and the public menu / website; a room already knows its guest).
 * Remembered on this phone. `known`: the name came from our records (first name and initials
 * only) — the order is then sent without a name and the server uses the one it has.
 */
export type Who = { name: string; phone: string; email?: string; known?: boolean; /** Last take-out delivery address. */ address?: string };

const KEY = "vegas-order-customer";
const EVENT = "vegas-who";
let memory: string | null = null; // private mode: remembered for this visit only

const read = () => { try { return localStorage.getItem(KEY) ?? memory; } catch { return memory; } };
const subscribe = (cb: () => void) => {
  window.addEventListener("storage", cb);
  window.addEventListener(EVENT, cb);
  return () => { window.removeEventListener("storage", cb); window.removeEventListener(EVENT, cb); };
};

function parse(raw: string | null): Who | null {
  try {
    const w = JSON.parse(raw ?? "null") as Partial<Who> | null;
    if (!w || typeof w.name !== "string" || w.name.trim().length < 2 || typeof w.phone !== "string" || !validPhone(w.phone)) return null;
    return {
      name: w.name.trim(), phone: w.phone.trim(), email: typeof w.email === "string" && w.email.trim() ? w.email.trim() : undefined, known: w.known === true,
      address: typeof w.address === "string" && w.address.trim() ? w.address.trim() : undefined,
    };
  } catch { return null; }
}

export function useWho() {
  const raw = useSyncExternalStore(subscribe, read, () => null);
  const who = useMemo(() => parse(raw), [raw]);
  const setWho = useCallback((w: Who | null) => {
    memory = w ? JSON.stringify(w) : null;
    try { if (memory) localStorage.setItem(KEY, memory); else localStorage.removeItem(KEY); } catch { /* private mode */ }
    window.dispatchEvent(new Event(EVENT));
  }, []);
  return [who, setWho] as const;
}

/** Remember the take-out address on this phone for next time. */
export function rememberAddress(address: string) {
  const w = parse(read());
  if (!w) return;
  memory = JSON.stringify({ ...w, address: address.trim() });
  try { localStorage.setItem(KEY, memory); } catch { /* private mode */ }
  window.dispatchEvent(new Event(EVENT));
}

/** What the order is sent with: no name for a known customer (the server has it), the typed one otherwise. */
export const whoForOrder = (w: Who) => ({ name: w.known ? "" : w.name, phone: w.phone, email: w.email ?? "" });

/** "0712345678" → "0712 345 678"; anything else as typed. */
export const phoneLabel = (p: string) => {
  const d = p.replace(/\D/g, "");
  return /^0\d{9}$/.test(d) ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : p;
};

/**
 * The "who is ordering" form: the phone first — once it is a real number we look it up;
 * someone we know is greeted by name, someone new types their name.
 */
export function useWhoForm(initial: Who | null, lookup: (phone: string) => Promise<string | null>) {
  const [phone, setPhoneIn] = useState(initial?.phone ?? "");
  const [name, setName] = useState(initial && !initial.known ? initial.name : "");
  const [found, setFound] = useState<{ phone: string; name: string | null } | null>(initial ? { phone: initial.phone, name: initial.known ? initial.name : null } : null);
  const [notMe, setNotMe] = useState(false);
  const ok = validPhone(phone);

  useEffect(() => {
    if (!ok || found?.phone === phone) return;
    let live = true;
    const t = setTimeout(() => {
      lookup(phone).catch(() => null).then((n) => { if (live) setFound({ phone, name: n }); });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [ok, phone, found?.phone, lookup]);

  const checked = ok && found?.phone === phone;
  const knownName = checked && !notMe ? found.name : null;
  const step: "phone" | "checking" | "known" | "new" = !ok ? "phone" : !checked ? "checking" : knownName ? "known" : "new";
  const email = initial?.phone === phone ? initial.email : undefined;
  const address = initial?.phone === phone ? initial.address : undefined;
  const result: Who | null = step === "known" ? { name: knownName!, phone: phone.trim(), email, known: true, address }
    : step === "new" && name.trim().length >= 2 ? { name: name.trim(), phone: phone.trim(), email, known: false, address } : null;

  return {
    phone, setPhone: (v: string) => { setPhoneIn(v); setNotMe(false); },
    name, setName, step, knownName, notMe: () => setNotMe(true), result,
  };
}

/**
 * A booking form's phone, looked up once it is a real number (owner, 2026-10-05: "my number should already be in — get
 * the number first, like the restaurant"): someone we know is greeted by name (first name and initials only) and sends
 * no name — the server uses the one it has; someone new types theirs. `notMe` turns a greeting back into a new guest.
 */
export function usePhoneLookup(phone: string, lookup: (phone: string) => Promise<string | null>) {
  const ok = validPhone(phone);
  const [found, setFound] = useState<{ phone: string; name: string | null } | null>(null);
  const [notMeFor, setNotMeFor] = useState<string | null>(null);
  useEffect(() => {
    if (!ok || found?.phone === phone) return;
    let live = true;
    const t = setTimeout(() => {
      lookup(phone).catch(() => null).then((n) => { if (live) setFound({ phone, name: n }); });
    }, 350);
    return () => { live = false; clearTimeout(t); };
  }, [ok, phone, found?.phone, lookup]);
  const checked = ok && found?.phone === phone;
  const knownName = checked && notMeFor !== phone ? found.name : null;
  const step: "phone" | "checking" | "known" | "new" = !ok ? "phone" : !checked ? "checking" : knownName ? "known" : "new";
  return { step, knownName, notMe: () => setNotMeFor(phone) };
}
