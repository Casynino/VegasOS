"use client";

import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, BedDouble, Check, Gift, RotateCw, UtensilsCrossed, Volume2, VolumeX } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { formatTZS } from "@/lib/format";
import { WebsiteLine, WebsiteLink } from "@/components/ordering/website-link";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { useLocale, useT } from "@/i18n/client";
import type { T } from "@/i18n/translate";
import type { SpinEnd, SpinWhere } from "@/lib/spin";
import type { Segment, SpinBonus, SpinOutcome, SpinView, Won } from "@/server/services/spin";
import { beginSpinAction, sendGiftsAction, spinAction } from "@/app/spin/[token]/actions";

/**
 * Spin to Win on the guest's phone. Everything that matters is decided on the server: who may spin, how many spins
 * are left, and how each spin ends (a gift, "try again", or the bonus spin) — saved before the wheel moves. This page
 * only plays that answer back: the wheel turns to the segment the server chose. A reload, a second phone or a second
 * tap show the same truth. The gifts go to the restaurant once, together, when the guest has finished.
 */

type Open = Extract<SpinView, { open: true }>;
type Named = { name: string; nameI18n: Record<string, string> };
/** Where the game stands — from the page, or from the spin just played (until the page has caught up). */
type Standing = { spinsUsed: number; bonus: SpinBonus; spinsLeft: number; prizesWon: number; valueUsed: number; over: SpinEnd | null };

const mod = (x: number) => ((x % 360) + 360) % 360;
const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
/** A name for one press of the button: the server answers it once, and gives the same answer if it is asked again. */
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

const C = 160;
const INK = "#1d1712", INK_2 = "#2b2119", CREAM = "#f7ecd4", CREAM_2 = "#efdcb2", GOLD = "#d4a345", GOLD_2 = "#c08f36", GOLD_SOFT = "#f3d9a0";
/** How long the wheel turns, in seconds — and the easing it turns with. */
const TURN = 5.6;
const EASE = [0.13, 0.78, 0.12, 1] as const;
// Rounded, so the server and the phone draw the very same numbers.
const round = (x: number) => Math.round(x * 100) / 100;
const point = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [round(C + r * Math.sin(a)), round(C - r * Math.cos(a))] as const;
};

/** A wheel always looks like a wheel: a very short one is repeated around it, evenly. */
function around(wheel: Segment[]) {
  if (!wheel.length) return [];
  const times = wheel.length >= 6 ? 1 : Math.ceil(6 / wheel.length);
  return Array.from({ length: wheel.length * times }, (_, i) => wheel[i % wheel.length]);
}

/** A segment's words: two short lines at most. */
function lines(text: string, max: number) {
  const wide = /[⺀-￿]/.test(text);
  if (wide) {
    const per = Math.max(3, Math.floor(max * 0.55));
    const a = text.slice(0, per), b = text.slice(per);
    return [a, b.length > per ? `${b.slice(0, per - 1)}…` : b].filter(Boolean);
  }
  const out: string[] = [];
  for (const w of text.trim().split(/\s+/)) {
    const last = out[out.length - 1];
    if (last !== undefined && `${last} ${w}`.length <= max) out[out.length - 1] = `${last} ${w}`;
    else out.push(w);
  }
  if (out.length > 2) out.splice(1, out.length - 1, out.slice(1).join(" "));
  return out.map((l) => (l.length > max + 1 ? `${l.slice(0, max)}…` : l));
}

// ───────────────────────── Sound (only when the guest switches it on) ─────────────────────────

type Sound = { wake: () => void; now: () => number; tick: (at: number) => void; chime: (notes: number[]) => void; mute: (off: boolean) => void };

/** A few soft tones made by the phone itself — nothing is downloaded. Nothing at all where the phone cannot do it. */
function makeSound(): Sound | null {
  try {
    const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctx) return null;
    const ctx = new Ctx();
    // Every tone goes through one volume: switched off is silent at once, the clicks already timed included.
    const master = ctx.createGain();
    master.connect(ctx.destination);
    const tone = (freq: number, at: number, len: number, gain: number, type: OscillatorType) => {
      const osc = ctx.createOscillator(), g = ctx.createGain();
      osc.type = type;
      osc.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, at);
      g.gain.exponentialRampToValueAtTime(gain, at + 0.008);
      g.gain.exponentialRampToValueAtTime(0.0001, at + len);
      osc.connect(g).connect(master);
      osc.start(at);
      osc.stop(at + len + 0.02);
    };
    return {
      wake: () => { if (ctx.state === "suspended") void ctx.resume().catch(() => null); },
      now: () => ctx.currentTime,
      tick: (at) => tone(1250, at, 0.035, 0.05, "triangle"),
      chime: (notes) => notes.forEach((f, i) => tone(f, ctx.currentTime + i * 0.13, 0.5, 0.09, "sine")),
      mute: (off) => { master.gain.value = off ? 0 : 1; },
    };
  } catch {
    return null;
  }
}

/** When (0–1 of the time) the wheel, turning with its easing, has gone this far (0–1 of the way). */
function turnTime(x: number) {
  const b = (s: number, p1: number, p2: number) => 3 * (1 - s) * (1 - s) * s * p1 + 3 * (1 - s) * s * s * p2 + s * s * s;
  let lo = 0, hi = 1;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (b(mid, EASE[1], EASE[3]) < x) lo = mid; else hi = mid;
  }
  return b((lo + hi) / 2, EASE[0], EASE[2]);
}

// The guest's own choice of sound, remembered on this phone. Off until they say so.
const SOUND_KEY = "vegas-spin-sound";
let soundNow: boolean | null = null; // this visit's choice — also where the phone will not remember it
const soundHeard = new Set<() => void>();
const soundPref = {
  subscribe: (fn: () => void) => { soundHeard.add(fn); return () => { soundHeard.delete(fn); }; },
  get: () => {
    if (soundNow !== null) return soundNow;
    try { return window.localStorage.getItem(SOUND_KEY) === "1"; } catch { return false; }
  },
  set: (on: boolean) => {
    soundNow = on;
    try { window.localStorage.setItem(SOUND_KEY, on ? "1" : "0"); } catch { /* not remembered, that is all */ }
    soundHeard.forEach((fn) => fn());
  },
};

// ───────────────────────── The wheel ─────────────────────────

function Wheel({ segments, rot, phase, reduce, nameOf, label, onStop, onHub, hubOff, className }: {
  segments: Segment[]; rot: number; phase: "idle" | "asking" | "spinning"; reduce: boolean; nameOf: (g: Named) => string;
  label: string; onStop: () => void; onHub: () => void; hubOff: boolean; className?: string;
}) {
  const t = useT();
  const n = segments.length;
  const seg = n ? 360 / n : 360;
  const small = n > 8;
  return (
    <div className={cn("@container relative mx-auto aspect-square", className)}>
      <div aria-hidden className="absolute inset-[-5%] rounded-full bg-(--vr-gold)/20 blur-2xl motion-safe:animate-[vlh-glow_4s_ease-in-out_infinite]" />
      {/* The rim and its lights stay still. */}
      <svg aria-hidden viewBox="0 0 320 320" className="absolute inset-0 size-full drop-shadow-[0_18px_28px_rgba(0,0,0,0.5)]">
        <defs>
          <linearGradient id="spin-rim" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="#f6dc98" /><stop offset="0.5" stopColor={GOLD} /><stop offset="1" stopColor="#8a6420" />
          </linearGradient>
        </defs>
        <circle cx={C} cy={C} r={159} fill="url(#spin-rim)" />
        <circle cx={C} cy={C} r={146} fill={INK} />
        {Array.from({ length: 20 }, (_, i) => {
          const [x, y] = point(i * 18 + 9, 152.5);
          return <circle key={i} cx={x} cy={y} r={2.5} fill="#fffaf0" opacity={i % 2 ? 0.55 : 1} className="motion-safe:animate-pulse" style={{ animationDelay: `${(i % 2) * 1}s` }} />;
        })}
      </svg>
      {/* The wheel itself: it only ever turns to where the server said. Kept inside its circle — the corners of a turning square would make a phone's page wider than the screen. */}
      <div className="absolute inset-0 overflow-hidden rounded-full">
      <div
        className="absolute inset-0 will-change-transform"
        style={{
          transform: `rotate(${rot}deg)`,
          transition: reduce || phase === "idle" ? "none" : phase === "asking" ? "transform 0.38s cubic-bezier(0.3, 0, 0.4, 1)" : `transform ${TURN}s cubic-bezier(${EASE.join(", ")})`,
        }}
        onTransitionEnd={(e) => { if (e.target === e.currentTarget && e.propertyName === "transform" && phase === "spinning") onStop(); }}
      >
        <svg viewBox="0 0 320 320" className="size-full" role="img" aria-label={label}>
          <defs>
            <clipPath id="spin-pic"><circle cx={0} cy={0} r={10.5} /></clipPath>
          </defs>
          {segments.map((s, i) => {
            const [x0, y0] = point((i - 0.5) * seg, 143), [x1, y1] = point((i + 0.5) * seg, 143);
            // A gift is light, "try again" is dark, the bonus spin is gold — two shades of each, so neighbours never melt together.
            const tone = s.kind === "FREE_SPIN" ? (i % 2 ? GOLD_2 : GOLD) : s.kind === "TRY_AGAIN" ? (i % 2 ? INK_2 : INK) : i % 2 ? CREAM : CREAM_2;
            const ink = s.kind === "TRY_AGAIN" ? GOLD_SOFT : INK;
            const words = s.kind === "GIFT" ? nameOf(s) : s.kind === "FREE_SPIN" ? t("Bonus spin") : t("Try again");
            const text = lines(words, small ? 11 : 12);
            return (
              <g key={`${s.kind}:${s.id}:${i}`}>
                <path d={`M${C} ${C} L${x0} ${y0} A143 143 0 0 1 ${x1} ${y1} Z`} fill={tone} stroke={GOLD} strokeOpacity={0.55} strokeWidth={0.8} />
                {/* At the rim: the gift's picture (or a gift box), +1 for the bonus spin, a turning arrow for "try again". */}
                {!small && (
                  <g transform={`rotate(${round(i * seg)} ${C} ${C}) translate(${C} ${C - 124})`}>
                    {s.kind === "GIFT" && s.image ? (
                      <>
                        <image href={s.image} x={-10.5} y={-10.5} width={21} height={21} preserveAspectRatio="xMidYMid slice" clipPath="url(#spin-pic)" />
                        <circle r={10.5} fill="none" stroke={GOLD} strokeWidth={1.1} />
                      </>
                    ) : s.kind === "GIFT" ? (
                      <Gift x={-7.5} y={-7.5} width={15} height={15} color="#8a6420" strokeWidth={1.7} />
                    ) : s.kind === "FREE_SPIN" ? (
                      <>
                        <circle r={10.5} fill={INK} />
                        <text textAnchor="middle" y={3.8} fontSize={10.5} fontWeight={700} fill={GOLD_SOFT}>+1</text>
                      </>
                    ) : (
                      <RotateCw x={-7} y={-7} width={14} height={14} color={GOLD_SOFT} strokeWidth={1.8} opacity={0.75} />
                    )}
                  </g>
                )}
                <g transform={`rotate(${round(i * seg)} ${C} ${C}) translate(${C} ${C - (small ? 93 : 76)}) rotate(-90)`}>
                  <text textAnchor="middle" fontSize={small ? 9.2 : 10.2} fontWeight={s.kind === "GIFT" ? 600 : 700} fill={ink} opacity={s.kind === "TRY_AGAIN" ? 0.85 : 1} style={{ letterSpacing: "0.01em" }}>
                    {text.map((l, k) => <tspan key={k} x={0} y={round((k - (text.length - 1) / 2) * (small ? 11 : 12.2) + 3.6)}>{l}</tspan>)}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
      </div>
      </div>
      {/* The pointer. */}
      <svg aria-hidden viewBox="0 0 320 320" className="pointer-events-none absolute inset-0 size-full drop-shadow-[0_3px_4px_rgba(0,0,0,0.45)]">
        <path d="M160 36 L146.500 7 Q160 -1 173.500 7 Z" fill="url(#spin-rim)" stroke={INK} strokeWidth={1.4} strokeLinejoin="round" />
        <circle cx={160} cy={11} r={2.6} fill={INK} />
      </svg>
      <button
        type="button" onClick={onHub} disabled={hubOff} aria-label={t("Spin the wheel")}
        className="absolute left-1/2 top-1/2 grid size-[23%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-(--vr-dark) text-[clamp(8.5px,3.4cqw,13px)] font-bold uppercase tracking-[0.16em] text-(--vr-gold) shadow-[0_4px_14px_rgba(0,0,0,0.55)] ring-[3px] ring-(--vr-gold) transition active:scale-95 disabled:active:scale-100"
      >
        {t("Spin")}
      </button>
    </div>
  );
}

// ───────────────────────── The gifts ─────────────────────────

/** The gift's picture when the menu has one — else a gift box in gold on the dark of the page. */
function GiftMark({ image, className }: { image: string | null; className?: string }) {
  return (
    <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded-full bg-[radial-gradient(circle_at_30%_22%,#4d3c22,#231b13_72%)] text-(--vr-gold) ring-1 ring-(--vr-gold)/70", className)}>
      {image
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={image} alt="" className="size-full object-cover" />
        : <Gift className="size-[42%]" strokeWidth={1.4} />}
    </span>
  );
}

/** Won, and not yet sent to the restaurant (nor refused). */
const waits = (r: Won) => !r.declined && !r.orderNumber && !r.where;

/** Where a gift is, in the guest's words. */
function giftStatus(r: Won, t: T) {
  if (r.declined) return t("Not taken");
  if (waits(r)) return t("Yours — we send it when you finish");
  if (r.orderStatus === "CANCELLED") return t("Not available — please ask reception");
  const done = r.orderStatus === "DELIVERED" || r.orderStatus === "COMPLETED" || r.orderStatus === "COLLECTED";
  if (r.where === "RESTAURANT") return done ? t("Enjoyed at the restaurant") : t("Waiting for you at the restaurant");
  if (done) return t("Delivered to your room");
  return r.orderStatus === "READY" || r.orderStatus === "OUT_FOR_DELIVERY" ? t("On its way to your room") : t("Being prepared for your room");
}

function Gifts({ gifts, nameOf, className }: { gifts: Won[]; nameOf: (g: Named) => string; className?: string }) {
  const t = useT();
  return (
    <ul className={cn("divide-y divide-white/[0.08] rounded-2xl bg-white/[0.04] px-3.5 ring-1 ring-white/10", className)}>
      {gifts.map((r) => (
        <li key={r.id} className={cn("flex items-center gap-3 py-2.5", r.declined && "opacity-55")}>
          <GiftMark image={r.image} className={cn("size-9", r.declined && "grayscale")} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold">{nameOf(r)}</p>
            <p className="text-[12px] leading-snug text-white/55">{giftStatus(r, t)}</p>
          </div>
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-(--vr-gold)">{t("Gift {n}", { n: r.prizeNumber })}</span>
        </li>
      ))}
    </ul>
  );
}

/** The guest's game in a few lines: what they have won, what is still to play. */
function Rewards({ view, at, left, over, className }: { view: Open; at: Standing; left: number; over: boolean; className?: string }) {
  const t = useT();
  const rows: [string, string][] = [
    [t("Gifts won"), t("{n} of {total}", { n: Math.min(at.prizesWon, view.prizesAllowed), total: view.prizesAllowed })],
    [t("Spins left"), String(left)],
    // A bonus spin the game ended before: not shown as still to play.
    ...(at.bonus === "NONE" || (over && at.bonus === "AVAILABLE") ? [] : [[t("Bonus spin"), at.bonus === "AVAILABLE" ? t("Available") : t("Used")] as [string, string]]),
    [t("Gift value won"), formatTZS(at.valueUsed)],
    [t("Gift budget left"), formatTZS(Math.max(0, view.budget - at.valueUsed))],
  ];
  return (
    <div className={cn("rounded-2xl bg-white/[0.04] px-4 py-3.5 text-left ring-1 ring-white/10", className)}>
      <h2 className={capsGold}>{t("Your Vegas rewards")}</h2>
      <dl className="mt-2.5 grid gap-x-6 gap-y-1.5 text-[12.5px] sm:grid-cols-2">
        {rows.map(([k, v]) => (
          <div key={k} className="flex items-baseline justify-between gap-3">
            <dt className="text-white/55">{k}</dt>
            <dd className="font-semibold tabular-nums text-white">{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

// The one main button of a screen: as wide as its words, never the whole phone.
const gold = "inline-flex h-12 min-w-[12.5rem] items-center justify-center gap-2 rounded-full bg-[linear-gradient(180deg,#ebc97f,#d4a345_55%,#bd8c31)] px-8 text-[13px] font-bold uppercase tracking-[0.18em] text-(--vr-ink) shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_12px_26px_-14px_rgba(212,163,69,0.95)] transition hover:brightness-[1.06] active:scale-[0.98] disabled:opacity-50 disabled:shadow-none";
const goldSmall = "inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[linear-gradient(180deg,#ebc97f,#d4a345_55%,#bd8c31)] px-6 text-[12px] font-bold uppercase tracking-[0.14em] text-(--vr-ink) shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition hover:brightness-[1.06] active:scale-[0.98] disabled:opacity-50";
// A quiet action: plain words, no box.
const quiet = "inline-flex min-h-9 items-center px-2 text-[12.5px] text-white/55 underline-offset-4 transition hover:text-white/90 hover:underline disabled:opacity-50";
// Where to enjoy the gifts: two small tiles, side by side.
const tile = "flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-2xl bg-white/[0.05] px-2.5 py-3 text-[12.5px] font-semibold leading-tight text-balance text-white ring-1 ring-white/[0.14] transition hover:bg-(--vr-gold)/10 hover:ring-(--vr-gold)/60 active:scale-[0.98] disabled:opacity-50";
const tileOn = "bg-(--vr-gold)/[0.14] ring-(--vr-gold) hover:bg-(--vr-gold)/[0.14] hover:ring-(--vr-gold)";
const capsGold = "text-[10.5px] font-semibold uppercase tracking-[0.24em] text-(--vr-gold)";
const note = "rounded-2xl bg-white/[0.04] px-5 py-5 text-[13.5px] leading-relaxed text-white/80 ring-1 ring-white/10";

function Shell({ hotel, languages, children }: { hotel: string; languages?: readonly string[]; children: React.ReactNode }) {
  const t = useT();
  return (
    <main className="vr relative min-h-svh overflow-x-clip bg-(--vr-dark) text-white">
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -left-28 -top-32 size-96 rounded-full bg-(--vr-gold)/[0.12] blur-3xl" />
        <div className="absolute -bottom-40 -right-24 size-[28rem] rounded-full bg-(--vr-gold)/[0.07] blur-3xl" />
      </div>
      {/* A phone: one column. A computer: the words on the left, the wheel on the right, in the middle of the page. */}
      <div className="relative mx-auto flex min-h-svh w-full max-w-md flex-col px-5 pb-[max(1.5rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))] lg:max-w-[66rem] lg:px-10">
        <header className="flex items-center gap-3 py-2 lg:border-b lg:border-white/[0.08] lg:py-4">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-192.png" alt="" className="size-10 rounded-full ring-1 ring-(--vr-gold)/60" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate font-display text-lg font-semibold">{hotel}</p>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-(--vr-gold)">{t("Spin to Win")}</p>
          </div>
          <LanguageSwitch variant="toggle" languages={languages} />
          <WebsiteLink hotel={hotel} className="text-white/85 hover:text-white [&>svg]:text-(--vr-gold)" />
        </header>
        <div className="flex flex-1 flex-col lg:justify-center lg:py-10">{children}</div>
        <footer className="mt-10 lg:mt-0">
          <WebsiteLine hotel={hotel} className="text-white/85" link="text-(--vr-gold)" />
          <p className="mt-5 text-center text-[11px] leading-relaxed text-white/35">{t("Complimentary gifts for guests staying with us. No purchase, no payment.")}</p>
        </footer>
      </div>
    </main>
  );
}

export function SpinApp({ token, view: live, hotel, languages, staff }: { token: string; view: Open; hotel: string; languages?: readonly string[]; staff: boolean }) {
  // While the wheel turns the page stays as it was when the guest tapped: coming back to the page or changing the
  // language mid-spin must not show how the spin ended before the wheel has stopped.
  const [held, setHeld] = useState<Open | null>(null);
  const view = held ?? live;
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const reduce = !!useReducedMotion();
  const nameOf = (g: Named) => g.nameI18n[locale] ?? g.name;
  const name = view.firstName;

  const [started, setStarted] = useState(false);
  const [phase, setPhase] = useState<"idle" | "asking" | "spinning">("idle");
  const [rot, setRot] = useState(0);
  // The wheel as it was played — kept on screen until the guest has seen how the spin ended.
  const [spinWheel, setSpinWheel] = useState<Segment[] | null>(null);
  // The spin just played: what the page shows until the server's page has caught up with it.
  const [last, setLast] = useState<SpinOutcome | null>(null);
  const [reveal, setReveal] = useState<SpinOutcome | null>(null);
  // The guest chose to finish before the last spin.
  const [finishing, setFinishing] = useState(false);
  const [where, setWhere] = useState<SpinWhere | null>(null);
  const [skip, setSkip] = useState<ReadonlySet<string>>(() => new Set());
  const [sending, setSending] = useState(false);
  // Sent from this phone a moment ago — shown at once, before the page has caught up.
  const [sent, setSent] = useState<{ where: SpinWhere; skipped: ReadonlySet<string> } | null>(null);
  const soundOn = useSyncExternalStore(soundPref.subscribe, soundPref.get, () => false);
  // The tap being sent, and how many spins the page showed when it was made.
  const key = useRef<{ id: string; after: number } | null>(null);
  const turned = useRef(0);
  const playing = useRef<SpinOutcome | null>(null);
  const stopTimer = useRef<number | null>(null);
  const sound = useRef<Sound | null>(null);

  // Coming back to the page (the phone was locked, another tab): what the kitchen has done since.
  useEffect(() => {
    const again = () => { if (document.visibilityState === "visible") router.refresh(); };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [router]);
  useEffect(() => () => { if (stopTimer.current) window.clearTimeout(stopTimer.current); sound.current?.mute(true); }, []);

  // ── Where the game stands ──
  const ahead = last && last.spinNumber > view.played.length ? last : null;
  const at: Standing = ahead ?? view;
  const played = ahead ? ahead.spinNumber : view.played.length;
  const fresh = ahead?.gift && !view.gifts.some((g) => g.id === ahead.gift!.id) ? [ahead.gift] : [];
  const gifts: Won[] = [...view.gifts, ...fresh].map((g) => {
    if (!sent || !waits(g)) return g;
    return sent.skipped.has(g.id) ? { ...g, declined: true } : { ...g, where: sent.where, orderStatus: "PENDING" };
  });
  const pending = gifts.filter(waits);
  const taken = pending.filter((g) => !skip.has(g.id));
  const kept = gifts.filter((g) => !g.declined);
  // Sending the gifts ends the game, whatever was left to spin.
  const over: SpinEnd | null = at.over ?? (sent ? "GUEST" : null);
  const left = over ? 0 : at.spinsLeft;
  const both = view.allowRoom && view.allowRestaurant;
  const place: SpinWhere | null = both ? where : view.allowRoom ? "ROOM" : view.allowRestaurant ? "RESTAURANT" : null;

  const intro = !view.introSeen && !started && !view.paused && played === 0 && !over;
  // The end of the game — or the guest finishing early, or the wheel resting with gifts still to send.
  const ended = !intro && phase === "idle" && !reveal && (!!over || (pending.length > 0 && (finishing || view.paused)));
  const segments = around(spinWheel ?? view.wheel);
  const wheelOn = !ended && segments.length > 0;
  const canSpin = !staff && wheelOn && !over && left > 0 && !reveal && !view.paused;

  const turnTo = (deg: number) => { turned.current = deg; setRot(deg); };

  function toggleSound() {
    const on = !soundOn;
    if (on) {
      sound.current ??= makeSound();
      if (!sound.current) return; // this phone cannot play it
      sound.current.wake();
      sound.current.mute(false);
      sound.current.tick(sound.current.now());
    } else sound.current?.mute(true);
    soundPref.set(on);
  }

  /** The wheel has stopped where the server said. */
  function stop() {
    const out = playing.current;
    if (!out) return;
    playing.current = null;
    if (stopTimer.current) { window.clearTimeout(stopTimer.current); stopTimer.current = null; }
    setPhase("idle");
    setHeld(null);
    setLast(out);
    setReveal(out);
    if (soundOn && sound.current) {
      if (out.kind === "GIFT") sound.current.chime(out.prizesWon >= 2 ? [523, 659, 784, 1047] : [523, 659, 784]);
      else if (out.kind === "FREE_SPIN") sound.current.chime([659, 880]);
    }
    router.refresh();
  }

  /** The guest has seen how the spin ended: back to the wheel as it is now. */
  function closeReveal() {
    setReveal(null);
    setSpinWheel(null);
    turnTo(mod(turned.current));
  }

  async function spin() {
    if (phase !== "idle" || !canSpin) return;
    setPhase("asking");
    setHeld(view);
    if (soundOn) { sound.current ??= makeSound(); sound.current?.wake(); sound.current?.mute(false); }
    // An answer lost on the way, then the page caught up and shows that spin: this tap is a new spin, not that one again.
    if (key.current && view.played.length > key.current.after) key.current = null;
    const pressed = (key.current ??= { id: newKey(), after: view.played.length }).id;
    const from = turned.current;
    if (!reduce) turnTo(from - 16); // the pull back before the throw
    let res: Awaited<ReturnType<typeof spinAction>> | null = null;
    try { [res] = await Promise.all([spinAction({ token, clientKey: pressed }), sleep(reduce ? 0 : 400)]); } catch { res = null; }
    if (!res || !res.ok) {
      // No answer: the same key goes again, so a spin that did happen is the one shown — never a second one.
      if (res) key.current = null;
      setHeld(null);
      setPhase("idle");
      turnTo(from);
      setReveal(null);
      toast.error(res ? res.error : t("No connection — please tap again. Your spin is safe."));
      if (res) router.refresh();
      return;
    }
    key.current = null;
    const out = res.data;
    // The wheel the server played, and the segment it stopped on.
    const shown = around(out.wheel);
    const seg = 360 / shown.length;
    const copies = shown.length / out.wheel.length;
    const stopAt = out.index + out.wheel.length * Math.floor(Math.random() * copies);
    const want = mod(360 - stopAt * seg + (Math.random() - 0.5) * seg * 0.56);
    const to = turned.current + 360 * 6 + mod(want - mod(turned.current));
    playing.current = out;
    setSpinWheel(out.wheel);
    setPhase("spinning");
    if (soundOn && sound.current && !reduce) {
      // A soft click for each segment that passes the pointer — quick at first, then slower, as the wheel does.
      const start = sound.current.now(), total = to - turned.current;
      for (let d = mod(-turned.current + seg / 2) || seg; d < total; d += seg) sound.current.tick(start + TURN * turnTime(d / total));
    }
    turnTo(to);
    stopTimer.current = window.setTimeout(stop, reduce ? 350 : TURN * 1000 + 600);
  }

  /** All the gifts go to the restaurant together, as one order. */
  async function send() {
    if (sending || staff || !pending.length) return;
    if (taken.length > 0 && !place) return;
    const to = place ?? "RESTAURANT";
    setSending(true);
    const res = await sendGiftsAction({ token, where: to, skip: [...skip], seen: pending.map((g) => g.id) }).catch(() => null);
    setSending(false);
    if (!res) { toast.error(t("No connection — please tap again.")); return; }
    if (!res.ok) { toast.error(res.error); router.refresh(); return; }
    setSent({ where: to, skipped: skip });
    setFinishing(false);
    router.refresh();
  }

  const begin = () => { setStarted(true); void beginSpinAction({ token }).catch(() => null); };
  const toggleSkip = (id: string) => setSkip((s) => { const n = new Set(s); if (!n.delete(id)) n.add(id); return n; });

  const hello = view.dayPart === "morning" ? t("Good morning, {name}", { name }) : view.dayPart === "afternoon" ? t("Good afternoon, {name}", { name }) : t("Good evening, {name}", { name });
  const spinsLeftWords = t.plural(left, "{n} spin left", "{n} spins left", { n: left });
  const double = kept.length === 2 && at.prizesWon >= 2;
  const justSent = sent ? kept.filter((g) => g.where === sent.where).length : 0;

  return (
    <Shell hotel={hotel} languages={languages}>
      {ended ? (
        // ── The end of the game: what was won, and (once) where to enjoy it ──
        <section className="mx-auto w-full max-w-md pt-6 text-center motion-safe:animate-[vlh-fade_0.8s_ease-out_both] lg:pt-0">
          <p className={capsGold}>{t("{name} · Room {room}", { name, room: view.roomNumber })}</p>
          <h1 className="mt-3 font-display text-[32px] font-semibold leading-[1.08] text-balance lg:text-[42px]">
            {!kept.length ? t("Thanks for playing") : double ? t("Double win! You did it!") : t("Your Vegas surprises")}
          </h1>
          <p className="mx-auto mt-3 max-w-[21rem] text-[13.5px] leading-relaxed text-white/65">
            {!kept.length ? t("Thanks for playing Vegas Spin to Win. We hope you enjoy the rest of your stay with us.")
              : double ? t("You've unlocked both of your Vegas complimentary gifts. Enjoy every moment of your stay!")
              : kept.length === 1 ? t("You've won a complimentary gift during your stay. We hope you enjoy it!")
              : t("All of them are on us — nothing is added to your bill. Thank you for staying with us.")}
          </p>
          {over === "BUDGET" && kept.length > 0 && <p className="mx-auto mt-2 max-w-[21rem] text-[12.5px] leading-relaxed text-white/45">{t("This completes your Vegas rewards for this stay.")}</p>}
          {!over && view.paused && <p className="mx-auto mt-2 max-w-[21rem] text-[12.5px] leading-relaxed text-white/45">{t("Spin to Win is resting for now. The gifts you have won are still yours.")}</p>}

          {pending.length > 0 ? (
            <div className="mt-6 rounded-[24px] bg-white/[0.04] px-4 pb-5 pt-3 text-left ring-1 ring-(--vr-gold)/30">
              <ul className="divide-y divide-white/[0.08]">
                {pending.map((g) => {
                  const off = skip.has(g.id);
                  return (
                    <li key={g.id} className="flex items-center gap-3 py-2.5">
                      <GiftMark image={g.image} className={cn("size-10 transition", off && "opacity-50 grayscale")} />
                      <div className={cn("min-w-0 flex-1 transition", off && "opacity-50")}>
                        <p className="truncate text-[14px] font-semibold">{nameOf(g)}</p>
                        <p className="text-[12px] leading-snug text-white/55">{off ? t("Not taken") : t("Worth {amount} — on us", { amount: formatTZS(g.value) })}</p>
                      </div>
                      <button type="button" disabled={sending || staff} onClick={() => toggleSkip(g.id)} className={cn(quiet, "-mr-2 shrink-0")}>
                        {off ? t("I will take it") : t("No, thank you")}
                      </button>
                    </li>
                  );
                })}
              </ul>
              {taken.length > 0 && both && (
                <>
                  <p className="mt-3 text-center text-[13px] font-medium text-white/80">{t.plural(taken.length, "Where would you like to enjoy it?", "Where would you like to enjoy them?")}</p>
                  <div className="mt-2.5 grid grid-cols-2 gap-2.5" role="radiogroup">
                    <button type="button" role="radio" aria-checked={where === "ROOM"} disabled={sending || staff} onClick={() => setWhere("ROOM")} className={cn(tile, where === "ROOM" && tileOn)}>
                      <BedDouble className="size-5 text-(--vr-gold)" strokeWidth={1.6} />{t("Deliver to my room")}
                    </button>
                    <button type="button" role="radio" aria-checked={where === "RESTAURANT"} disabled={sending || staff} onClick={() => setWhere("RESTAURANT")} className={cn(tile, where === "RESTAURANT" && tileOn)}>
                      <UtensilsCrossed className="size-5 text-(--vr-gold)" strokeWidth={1.6} />{t("Enjoy at the restaurant")}
                    </button>
                  </div>
                </>
              )}
              {taken.length > 0 && !both && place && (
                <p className="mt-3 text-center text-[13px] text-white/75">
                  {place === "ROOM"
                    ? t.plural(taken.length, "We will bring it to room {room}.", "We will bring them to room {room}.", { room: view.roomNumber })
                    : t.plural(taken.length, "It will be waiting for you at the restaurant.", "They will be waiting for you at the restaurant.")}
                </p>
              )}
              <div className="mt-4 flex flex-col items-center gap-2">
                <button type="button" onClick={send} disabled={sending || staff || (taken.length > 0 && !place)} className={gold}>
                  {sending ? t("One moment…") : !taken.length ? t("Finish without a gift") : t.plural(taken.length, "Send my gift", "Send my gifts")}
                </button>
                <p className="max-w-[19rem] text-center text-[11.5px] leading-relaxed text-white/45">
                  {staff ? t("Staff preview — only the guest staying in the room can spin.")
                    : taken.length > 1 ? t("They go to the restaurant together, as one order. Nothing is added to your bill.")
                    : t("Nothing is added to your bill.")}
                </p>
                {!over && !view.paused && (
                  <>
                    <p className="max-w-[19rem] text-center text-[11.5px] leading-relaxed text-white/45">
                      {t.plural(left, "You still have {n} spin. Sending now ends your game — it will not be used.", "You still have {n} spins. Sending now ends your game — they will not be used.", { n: left })}
                    </p>
                    <button type="button" disabled={sending} onClick={() => setFinishing(false)} className={quiet}>{t("Keep spinning")}</button>
                  </>
                )}
              </div>
            </div>
          ) : gifts.length > 0 ? (
            <>
              {justSent > 0 && sent && (
                <p className="mx-auto mt-5 flex max-w-[21rem] items-start justify-center gap-2 text-left text-[13px] leading-snug text-white/85">
                  <Check className="mt-0.5 size-4 shrink-0 text-(--vr-gold)" strokeWidth={2.4} />
                  <span>
                    {sent.where === "ROOM"
                      ? t.plural(justSent, "We are preparing it now and will bring it to room {room}.", "We are preparing them now and will bring them to room {room}.", { room: view.roomNumber })
                      : t.plural(justSent, "It is waiting for you at the restaurant — just tell your waiter your room number.", "They are waiting for you at the restaurant — just tell your waiter your room number.")}
                  </span>
                </p>
              )}
              <Gifts gifts={gifts} nameOf={nameOf} className="mt-5 text-left" />
              {kept.length > 0 && <p className="mt-3 text-[12px] text-white/45">{t("Nothing is added to your bill.")}</p>}
            </>
          ) : null}
        </section>
      ) : (
        <section className={cn("grid grid-cols-1 gap-y-6 pt-5 text-center lg:pt-0", wheelOn ? "lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-x-16 lg:gap-y-7 lg:text-left" : "mx-auto w-full max-w-md")}>
          {/* The words above the wheel. */}
          <div className={cn(wheelOn && "lg:col-start-1 lg:row-start-1 lg:self-end")}>
            {intro ? (
              <div className="motion-safe:animate-[vlh-fade_0.8s_ease-out_both]">
                <p className={capsGold}>{t("Welcome to room {room}", { room: view.roomNumber })}</p>
                <h1 className="mt-3 font-display text-[36px] font-semibold leading-[1.05] text-balance lg:text-[54px]">{hello}</h1>
                <p className={cn("mx-auto mt-3 max-w-[19rem] font-display text-[20px] leading-snug text-(--vr-gold) lg:max-w-md lg:text-[25px]", wheelOn && "lg:mx-0")}>{t("Your stay comes with a little something extra.")}</p>
              </div>
            ) : (
              <>
                <p className={capsGold}>{t("{name} · Room {room}", { name, room: view.roomNumber })}</p>
                <h1 className="mt-2 font-display text-[32px] font-semibold leading-[1.05] lg:text-[50px]">{t("Spin & Win")}</h1>
                <div className={cn("mt-3 flex items-center justify-center gap-3", wheelOn && "lg:justify-start")}>
                  <span className="flex items-center gap-1.5" role="img" aria-label={spinsLeftWords}>
                    {Array.from({ length: view.spinsAllowed }, (_, i) => (
                      <span key={i} className={cn("size-2 rounded-full transition", over || i < at.spinsUsed ? "bg-white/15" : "bg-(--vr-gold) shadow-[0_0_8px_rgba(212,163,69,0.8)]")} />
                    ))}
                    {/* The bonus spin, once it is won: one more light, ringed. */}
                    {at.bonus !== "NONE" && <span className={cn("ml-1 size-2 rounded-full ring-1 ring-offset-2 ring-offset-(--vr-dark) transition", over || at.bonus === "USED" ? "bg-white/15 ring-white/25" : "bg-(--vr-gold) ring-(--vr-gold) shadow-[0_0_8px_rgba(212,163,69,0.8)]")} />}
                  </span>
                  <span className="text-[13px] font-medium text-white/75">{spinsLeftWords}</span>
                  {wheelOn && (
                    <button type="button" onClick={toggleSound} aria-pressed={soundOn} aria-label={soundOn ? t("Sound is on — switch it off") : t("Sound is off — switch it on")} className="-ml-1 grid size-8 place-items-center rounded-full text-white/45 transition hover:text-white/85">
                      {soundOn ? <Volume2 className="size-4" strokeWidth={1.7} /> : <VolumeX className="size-4" strokeWidth={1.7} />}
                    </button>
                  )}
                </div>
              </>
            )}
          </div>

          {/* The wheel: a small look at it with the welcome, then full size to play. */}
          {wheelOn && (
            <div className="lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-center">
              <Wheel
                segments={segments} rot={rot} phase={phase} reduce={reduce} nameOf={nameOf} label={t("The wheel of gifts")} onStop={stop}
                onHub={intro ? begin : spin} hubOff={intro ? false : !canSpin || phase !== "idle"}
                className={cn("transition-[width] duration-700 ease-out motion-reduce:transition-none lg:w-[min(38vw,26rem)]", intro ? "w-[min(58vw,14.5rem)]" : "w-[min(84vw,21rem)]")}
              />
            </div>
          )}

          {/* The button, and what comes with it. */}
          <div className={cn(wheelOn && "lg:col-start-1 lg:row-start-2 lg:self-start")}>
            {intro ? (
              <div className="flex flex-col motion-safe:animate-[vlh-fade_0.8s_ease-out_0.15s_both]">
                <p className={cn("mx-auto max-w-[20rem] text-[14px] leading-relaxed text-white/70 lg:max-w-md lg:text-[15px]", wheelOn && "lg:mx-0")}>
                  {t.plural(view.spinsAllowed, "You have {n} spin to win a complimentary treat from Vegas Restaurant.", "You have {n} spins to win up to two complimentary treats from Vegas Restaurant.", { n: view.spinsAllowed })}
                </p>
                {/* On a phone the button comes first; how it works sits just below it. */}
                <ol className={cn("order-3 mx-auto mt-7 max-w-[20rem] space-y-2.5 text-left text-[13px] leading-snug text-white/75 lg:order-none lg:mt-5 lg:max-w-md lg:text-[14px]", wheelOn && "lg:mx-0")}>
                  {[t("Spin the wheel — a gift, a bonus spin, or try again."), t("When you have finished, we send your gifts together — to your room, or at the restaurant."), t("It is on us. Nothing is added to your bill.")].map((line, i) => (
                    <li key={i} className="flex items-start gap-3">
                      <span className="grid size-5 shrink-0 place-items-center rounded-full text-[10.5px] font-bold text-(--vr-gold) ring-1 ring-(--vr-gold)/55">{i + 1}</span>
                      <span className="pt-px">{line}</span>
                    </li>
                  ))}
                </ol>
                <div className={cn("order-2 mt-6 flex flex-col items-center gap-3 lg:order-none lg:mt-7", wheelOn && "lg:flex-row lg:gap-5")}>
                  <button type="button" className={gold} onClick={begin}>{t("Let's spin")}<ArrowRight className="size-4" strokeWidth={2.4} /></button>
                  <p className="text-[11.5px] text-white/45 lg:hidden">{t("Free for our guests — nothing to buy, nothing to pay.")}</p>
                </div>
              </div>
            ) : (
              <>
                {view.paused ? (
                  <p className={note}>{t("Spin to Win is resting for now. The gifts you have won are still yours.")}</p>
                ) : view.noGift && !wheelOn ? (
                  <p className={note}>{t("Our gifts are being restocked — please try again a little later, or ask reception. None of your spins has been used.")}</p>
                ) : wheelOn ? (
                  <div className="flex flex-col items-center gap-3 lg:flex-row lg:gap-5">
                    <button type="button" onClick={spin} disabled={!canSpin || phase !== "idle"} className={gold}>
                      {phase !== "idle" ? t("Good luck…") : played === 0 ? t("Spin & Win") : t("Spin & see what's next")}
                    </button>
                    <p className="text-[12px] text-white/50">
                      {staff ? t("Staff preview — only the guest staying in the room can spin.")
                        : over ? null : at.prizesWon > 0 ? t("One more gift to win.") : t("Win up to two complimentary treats.")}
                    </p>
                  </div>
                ) : null}
                {played > 0 && <Rewards view={view} at={at} left={left} over={!!over} className="mt-7 lg:max-w-md" />}
                {gifts.length > 0 && (
                  <div className="mt-6 text-left lg:max-w-md">
                    <h2 className={capsGold}>{t("Your gifts")}</h2>
                    <Gifts gifts={gifts} nameOf={nameOf} className="mt-2.5" />
                    {/* The guest may stop here and have what they won — the spins left are then not used. */}
                    {pending.length > 0 && !staff && !over && phase === "idle" && (
                      <button type="button" onClick={() => setFinishing(true)} className={cn(quiet, "-ml-2 mt-1.5")}>
                        {t.plural(pending.length, "Finish now and send my gift", "Finish now and send my gifts")}
                      </button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {/* ── How the spin ended: a gift, the bonus spin, or "almost" ── */}
      <AnimatePresence>
        {reveal && (
          <motion.div
            key="reveal" role="dialog" aria-modal="true" aria-label={reveal.kind === "GIFT" ? t("Your gift") : reveal.kind === "FREE_SPIN" ? t("Bonus spin") : t("Try again")}
            initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0 }} transition={{ duration: 0.3 }}
            className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/75 px-5 pb-8 pt-20 backdrop-blur-md"
          >
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 20, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
              className={cn(
                "relative w-full max-w-[21.5rem] rounded-[28px] bg-[linear-gradient(180deg,#2c2319,#1d1712_62%)] px-5 pb-5 pt-[3.75rem] text-center shadow-[0_40px_90px_-30px_rgba(0,0,0,0.9)] ring-1",
                reveal.kind === "TRY_AGAIN" ? "ring-white/15" : "ring-(--vr-gold)/40",
              )}
            >
              <div className="absolute left-1/2 top-0 size-[5.5rem] -translate-x-1/2 -translate-y-1/2">
                {reveal.kind !== "TRY_AGAIN" && (
                  <span aria-hidden className={cn("absolute rounded-full blur-2xl", reveal.kind === "GIFT" && reveal.prizesWon >= 2 ? "inset-[-45%] bg-(--vr-gold)/40 motion-safe:animate-[vlh-glow_2.4s_ease-in-out_infinite]" : "inset-[-20%] bg-(--vr-gold)/25")} />
                )}
                {reveal.kind === "GIFT" && reveal.gift ? (
                  <GiftMark image={reveal.gift.image} className="relative size-full ring-2 ring-(--vr-gold) ring-offset-4 ring-offset-(--vr-dark)" />
                ) : reveal.kind === "FREE_SPIN" ? (
                  <span className="relative grid size-full place-items-center rounded-full bg-[linear-gradient(180deg,#ebc97f,#d4a345_55%,#bd8c31)] font-display text-[30px] font-semibold text-(--vr-ink) ring-2 ring-(--vr-gold) ring-offset-4 ring-offset-(--vr-dark)">+1</span>
                ) : (
                  <span className="relative grid size-full place-items-center rounded-full bg-[radial-gradient(circle_at_30%_22%,#3a2f24,#1d1712_72%)] text-white/60 ring-1 ring-white/25 ring-offset-4 ring-offset-(--vr-dark)"><RotateCw className="size-8" strokeWidth={1.4} /></span>
                )}
              </div>

              {reveal.kind === "GIFT" && reveal.gift && (
                <>
                  <p className={capsGold}>{t("Gift {n} of {total}", { n: reveal.gift.prizeNumber, total: Math.max(reveal.prizesAllowed, reveal.gift.prizeNumber) })} · {reveal.prizesWon >= 2 ? t("Double win") : t("You won")}</p>
                  <h2 className="mt-2 font-display text-[28px] font-semibold leading-[1.08] text-balance">{nameOf(reveal.gift)}</h2>
                  <p className="mt-1.5 text-[12.5px] text-white/55">{t("With our compliments, {name}.", { name })}</p>
                  <div aria-hidden className="mx-auto mt-4 h-px w-10 bg-(--vr-gold)/50" />
                  <p className="mx-auto mt-4 max-w-[17.5rem] text-[13.5px] leading-snug text-white/80">
                    {reveal.prizesWon >= 2 ? t("That is both of your gifts — you did it!")
                      : reveal.over ? t("It is yours — tell us where you would like to enjoy it.")
                      : t("It is yours. Keep spinning — there is one more gift to win.")}
                  </p>
                  <p className="mt-1.5 text-[12px] text-white/45">{t("Worth {amount} — on us", { amount: formatTZS(reveal.gift.value) })}</p>
                </>
              )}

              {reveal.kind === "FREE_SPIN" && (
                <>
                  <p className={capsGold}>{t("Bonus spin")}</p>
                  <h2 className="mt-2 font-display text-[27px] font-semibold leading-[1.1] text-balance">{t("Lucky you! Bonus spin unlocked!")}</h2>
                  <div aria-hidden className="mx-auto mt-4 h-px w-10 bg-(--vr-gold)/50" />
                  <p className="mx-auto mt-4 max-w-[17.5rem] text-[13.5px] leading-snug text-white/80">{t("You've earned one extra spin. Let's see what's waiting for you!")}</p>
                </>
              )}

              {reveal.kind === "TRY_AGAIN" && (
                <>
                  <p className="text-[10.5px] font-semibold uppercase tracking-[0.24em] text-white/50">{t("No gift this time")}</p>
                  <h2 className="mt-2 font-display text-[28px] font-semibold leading-[1.08]">{t("Almost!")}</h2>
                  <div aria-hidden className="mx-auto mt-4 h-px w-10 bg-white/20" />
                  <p className="mx-auto mt-4 max-w-[17.5rem] text-[13.5px] leading-snug text-white/80">
                    {reveal.over ? t("That was your last spin. Thank you for playing.") : t("Your next surprise could be just around the corner.")}
                  </p>
                </>
              )}

              <button type="button" className={cn(goldSmall, "mt-5")} onClick={closeReveal}>
                {!reveal.over ? t("Spin again · {n} left", { n: reveal.spinsLeft })
                  : gifts.length ? t.plural(gifts.length, "See my gift", "See my gifts")
                  : t("Finish")}
              </button>
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Shell>
  );
}
