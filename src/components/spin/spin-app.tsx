"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRight, BedDouble, Check, Gift, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { WebsiteLine, WebsiteLink } from "@/components/ordering/website-link";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { useLocale, useT } from "@/i18n/client";
import type { T } from "@/i18n/translate";
import type { SpinWhere } from "@/lib/spin";
import type { Segment, SpinOutcome, SpinView, Won } from "@/server/services/spin";
import { beginSpinAction, claimGiftAction, declineGiftAction, spinAction } from "@/app/spin/[token]/actions";

/**
 * Spin to Win on the guest's phone. Everything that matters is decided on the server: who may spin, how many spins
 * are left, and which gift a spin wins — saved before the wheel moves. This page only plays that answer back: the
 * wheel turns to the segment the server chose. A reload, a second phone or a second tap show the same truth.
 */

type Open = Extract<SpinView, { open: true }>;
type Named = { name: string; nameI18n: Record<string, string> };
type Reveal = { won: Won; step: "choose" | "done" | "declined"; where?: SpinWhere | null };

const mod = (x: number) => ((x % 360) + 360) % 360;
const sleep = (ms: number) => new Promise((r) => window.setTimeout(r, ms));
/** A name for one press of the button: the server answers it once, and gives the same answer if it is asked again. */
const newKey = () => Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");

const C = 160;
const INK = "#1d1712", CREAM = "#f7ecd4", GOLD = "#d4a345";
// Rounded, so the server and the phone draw the very same numbers.
const round = (x: number) => Math.round(x * 100) / 100;
const point = (deg: number, r: number) => {
  const a = (deg * Math.PI) / 180;
  return [round(C + r * Math.sin(a)), round(C - r * Math.cos(a))] as const;
};

/** A wheel always looks like a wheel: a few gifts are repeated around it, evenly. */
function around(wheel: Segment[]) {
  if (!wheel.length) return [];
  const times = wheel.length >= 6 ? 1 : Math.ceil(6 / wheel.length);
  return Array.from({ length: wheel.length * times }, (_, i) => wheel[i % wheel.length]);
}

/** A gift's name on its segment: two short lines at most. */
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
      {/* The wheel itself: it only ever turns to where the server said. */}
      <div
        className="absolute inset-0 will-change-transform"
        style={{
          transform: `rotate(${rot}deg)`,
          transition: reduce || phase === "idle" ? "none" : phase === "asking" ? "transform 0.38s cubic-bezier(0.3, 0, 0.4, 1)" : "transform 5.6s cubic-bezier(0.13, 0.78, 0.12, 1)",
        }}
        onTransitionEnd={(e) => { if (e.propertyName === "transform" && phase === "spinning") onStop(); }}
      >
        <svg viewBox="0 0 320 320" className="size-full" role="img" aria-label={label}>
          {segments.map((s, i) => {
            const [x0, y0] = point((i - 0.5) * seg, 143), [x1, y1] = point((i + 0.5) * seg, 143);
            // Two tones around the wheel; with an odd number, the last one in gold so no two neighbours match.
            const tone = n % 2 && i === n - 1 ? GOLD : i % 2 ? CREAM : INK;
            const ink = tone === INK ? "#f3d9a0" : INK;
            const text = lines(nameOf(s), small ? 13 : 15);
            return (
              <g key={`${s.id}:${i}`}>
                <path d={`M${C} ${C} L${x0} ${y0} A143 143 0 0 1 ${x1} ${y1} Z`} fill={tone} stroke={GOLD} strokeOpacity={0.55} strokeWidth={0.8} />
                <g transform={`rotate(${i * seg} ${C} ${C}) translate(${C} ${C - 93}) rotate(-90)`}>
                  <text textAnchor="middle" fontSize={small ? 9.2 : 10.6} fontWeight={600} fill={ink} style={{ letterSpacing: "0.01em" }}>
                    {text.map((l, k) => <tspan key={k} x={0} y={(k - (text.length - 1) / 2) * (small ? 11 : 12.6) + 3.6}>{l}</tspan>)}
                  </text>
                </g>
              </g>
            );
          })}
        </svg>
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

/** Where a gift is, in the guest's words. */
function giftStatus(r: Won, t: T) {
  if (r.declined) return t("Not taken");
  if (!r.orderNumber) return t("Waiting for your choice");
  if (r.orderStatus === "CANCELLED") return t("Not available — please ask reception");
  const done = r.orderStatus === "DELIVERED" || r.orderStatus === "COMPLETED" || r.orderStatus === "COLLECTED";
  if (r.where === "RESTAURANT") return done ? t("Enjoyed at the restaurant") : t("Waiting for you at the restaurant");
  if (done) return t("Delivered to your room");
  return r.orderStatus === "READY" || r.orderStatus === "OUT_FOR_DELIVERY" ? t("On its way to your room") : t("Being prepared for your room");
}

function Gifts({ results, nameOf, className }: { results: Won[]; nameOf: (g: Named) => string; className?: string }) {
  const t = useT();
  return (
    <ul className={cn("divide-y divide-white/[0.08] rounded-2xl bg-white/[0.04] px-3.5 ring-1 ring-white/10", className)}>
      {results.map((r) => (
        <li key={r.id} className={cn("flex items-center gap-3 py-2.5", r.declined && "opacity-55")}>
          <GiftMark image={r.image} className={cn("size-9", r.declined && "grayscale")} />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[13.5px] font-semibold">{nameOf(r)}</p>
            <p className="truncate text-[12px] text-white/55">{giftStatus(r, t)}</p>
          </div>
          <span className="shrink-0 text-[10px] font-semibold uppercase tracking-[0.16em] text-(--vr-gold)">{t("Gift {n}", { n: r.spinNumber })}</span>
        </li>
      ))}
    </ul>
  );
}

// The one main button of a screen: as wide as its words, never the whole phone.
const gold = "inline-flex h-12 min-w-[12.5rem] items-center justify-center gap-2 rounded-full bg-[linear-gradient(180deg,#ebc97f,#d4a345_55%,#bd8c31)] px-8 text-[13px] font-bold uppercase tracking-[0.18em] text-(--vr-ink) shadow-[inset_0_1px_0_rgba(255,255,255,0.45),0_12px_26px_-14px_rgba(212,163,69,0.95)] transition hover:brightness-[1.06] active:scale-[0.98] disabled:opacity-50 disabled:shadow-none";
const goldSmall = "inline-flex h-10 items-center justify-center gap-2 rounded-full bg-[linear-gradient(180deg,#ebc97f,#d4a345_55%,#bd8c31)] px-6 text-[12px] font-bold uppercase tracking-[0.14em] text-(--vr-ink) shadow-[inset_0_1px_0_rgba(255,255,255,0.45)] transition hover:brightness-[1.06] active:scale-[0.98] disabled:opacity-50";
const quietSmall = "inline-flex h-10 items-center justify-center rounded-full px-5 text-[12px] font-semibold uppercase tracking-[0.14em] text-white/80 ring-1 ring-white/20 transition hover:bg-white/[0.06] hover:text-white active:scale-[0.98] disabled:opacity-50";
// Where to enjoy a gift: two small tiles, side by side.
const tile = "flex min-h-[4.5rem] flex-col items-center justify-center gap-1.5 rounded-2xl bg-white/[0.05] px-2.5 py-3 text-[12.5px] font-semibold leading-tight text-balance text-white ring-1 ring-white/[0.14] transition hover:bg-(--vr-gold)/10 hover:ring-(--vr-gold)/60 active:scale-[0.98] disabled:opacity-50 disabled:hover:bg-white/[0.05] disabled:hover:ring-white/[0.14]";
const capsGold = "text-[10.5px] font-semibold uppercase tracking-[0.24em] text-(--vr-gold)";
const note = "rounded-2xl bg-white/[0.04] px-5 py-5 text-[13.5px] leading-relaxed text-white/80 ring-1 ring-white/10";

function Shell({ hotel, languages, children }: { hotel: string; languages?: readonly string[]; children: React.ReactNode }) {
  const t = useT();
  return (
    <main className="vr relative min-h-svh overflow-hidden bg-(--vr-dark) text-white">
      <div aria-hidden className="pointer-events-none absolute -left-28 -top-32 size-96 rounded-full bg-(--vr-gold)/[0.12] blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 size-[28rem] rounded-full bg-(--vr-gold)/[0.07] blur-3xl" />
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

export function SpinApp({ token, view, hotel, languages, staff }: { token: string; view: Open; hotel: string; languages?: readonly string[]; staff: boolean }) {
  const t = useT();
  const locale = useLocale();
  const router = useRouter();
  const reduce = !!useReducedMotion();
  const nameOf = (g: Named) => g.nameI18n[locale] ?? g.name;
  const name = view.firstName;

  const [started, setStarted] = useState(false);
  const [phase, setPhase] = useState<"idle" | "asking" | "spinning">("idle");
  const [rot, setRot] = useState(0);
  const [spinWheel, setSpinWheel] = useState<Segment[] | null>(null);
  const [usedHere, setUsedHere] = useState(0);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  // Gifts answered on this phone (taken or refused) — so the question is not asked again before the page has caught up.
  const [answered, setAnswered] = useState<ReadonlySet<string>>(() => new Set());
  const [same, setSame] = useState(false);
  const [skipping, setSkipping] = useState(false);
  const [busy, setBusy] = useState<SpinWhere | "DECLINE" | null>(null);
  const key = useRef<string | null>(null);
  const turned = useRef(0);
  const playing = useRef<SpinOutcome | null>(null);
  const stopTimer = useRef<number | null>(null);

  // Coming back to the page (the phone was locked, another tab): what the kitchen has done since.
  useEffect(() => {
    const again = () => { if (document.visibilityState === "visible") router.refresh(); };
    document.addEventListener("visibilitychange", again);
    return () => document.removeEventListener("visibilitychange", again);
  }, [router]);
  useEffect(() => () => { if (stopTimer.current) window.clearTimeout(stopTimer.current); }, []);

  const used = Math.max(view.spinsUsed, usedHere);
  const left = Math.max(0, view.spinsAllowed - used);
  // A gift won and not yet answered (also after a reload): first, where would they like it — or not at all?
  const waiting = view.pending && !answered.has(view.pending.id) ? view.pending : null;
  const open: Reveal | null = reveal ?? (phase === "idle" && waiting ? { won: waiting, step: "choose" } : null);
  const segments = around(spinWheel ?? view.wheel);
  const canSpin = !staff && !view.paused && !view.noGift && left > 0 && !open && segments.length > 0;
  const both = view.allowRoom && view.allowRestaurant;

  const turnTo = (deg: number) => { turned.current = deg; setRot(deg); };

  /** The wheel has stopped on the gift the server chose. */
  function stop() {
    const out = playing.current;
    if (!out) return;
    playing.current = null;
    if (stopTimer.current) { window.clearTimeout(stopTimer.current); stopTimer.current = null; }
    setPhase("idle");
    setSpinWheel(null);
    setSkipping(false);
    setReveal({ won: out.result, step: out.result.declined ? "declined" : out.result.orderNumber ? "done" : "choose", where: out.result.where });
    router.refresh();
  }

  async function spin() {
    if (phase !== "idle" || !canSpin) return;
    setPhase("asking");
    const pressed = (key.current ??= newKey());
    const from = turned.current;
    if (!reduce) turnTo(from - 16); // the pull back before the throw
    let res: Awaited<ReturnType<typeof spinAction>> | null = null;
    try { [res] = await Promise.all([spinAction({ token, clientKey: pressed }), sleep(reduce ? 0 : 400)]); } catch { res = null; }
    if (!res || !res.ok) {
      // No answer: the same key goes again, so a spin that did happen is the one shown — never a second one.
      if (res) key.current = null;
      setPhase("idle");
      turnTo(from);
      toast.error(res ? res.error : t("No connection — please tap again. Your spin is safe."));
      if (res) router.refresh();
      return;
    }
    key.current = null;
    const out = res.data;
    const shown = around(out.wheel);
    const seg = 360 / shown.length;
    // The gift may be on the wheel more than once: any of its segments.
    const copies = shown.length / out.wheel.length;
    const at = out.index + out.wheel.length * Math.floor(Math.random() * copies);
    const want = mod(360 - at * seg + (Math.random() - 0.5) * seg * 0.56);
    playing.current = out;
    setSpinWheel(out.wheel);
    setUsedHere(out.spinsUsed);
    setPhase("spinning");
    turnTo(turned.current + 360 * 6 + mod(want - mod(turned.current)));
    stopTimer.current = window.setTimeout(stop, reduce ? 350 : 6200);
  }

  async function claim(won: Won, where: SpinWhere) {
    if (busy) return;
    setBusy(where);
    const res = await claimGiftAction({ token, resultId: won.id, where, sameForAll: same && left > 0 }).catch(() => null);
    setBusy(null);
    if (!res) { toast.error(t("No connection — please tap again.")); return; }
    if (!res.ok) { toast.error(res.error); router.refresh(); return; }
    setAnswered((c) => new Set(c).add(won.id));
    setReveal({ won, step: "done", where: res.data.where });
    router.refresh();
  }

  /** "No, thank you": nothing is ordered for this gift. */
  async function decline(won: Won) {
    if (busy) return;
    setBusy("DECLINE");
    const res = await declineGiftAction({ token, resultId: won.id }).catch(() => null);
    setBusy(null);
    if (!res) { toast.error(t("No connection — please tap again.")); return; }
    if (!res.ok) { toast.error(res.error); setSkipping(false); router.refresh(); return; }
    setAnswered((c) => new Set(c).add(won.id));
    setSkipping(false);
    setReveal({ won, step: "declined" });
    router.refresh();
  }

  const begin = () => { setStarted(true); void beginSpinAction({ token }).catch(() => null); };
  const close = () => { setReveal(null); setSkipping(false); };

  const intro = !view.introSeen && !started && !view.paused && used === 0;
  const finished = !intro && left === 0 && !open && phase === "idle";
  const wheelOn = !finished && !view.paused && !view.noGift && segments.length > 0;
  const hello = view.dayPart === "morning" ? t("Good morning, {name}", { name }) : view.dayPart === "afternoon" ? t("Good afternoon, {name}", { name }) : t("Good evening, {name}", { name });
  const spinsLeft = t.plural(left, "{n} spin left", "{n} spins left");
  const next = left > 0 ? t.plural(left, "Spin again · {n} left", "Spin again · {n} left") : t("See my gifts");

  return (
    <Shell hotel={hotel} languages={languages}>
      {finished ? (
        // ── After the last spin ──
        <section className="mx-auto w-full max-w-md pt-6 text-center motion-safe:animate-[vlh-fade_0.8s_ease-out_both] lg:pt-0">
          <p className={capsGold}>{t("{name} · Room {room}", { name, room: view.roomNumber })}</p>
          <h1 className="mt-3 font-display text-[32px] font-semibold leading-[1.08] text-balance lg:text-[42px]">
            {view.spinsAllowed === 5 ? t("Five spins. Five little surprises.") : t("{n} spins. {n} little surprises.", { n: view.spinsAllowed })}
          </h1>
          <p className="mx-auto mt-3 max-w-xs text-[13.5px] leading-relaxed text-white/65">{t("All of them are on us — nothing is added to your bill. Thank you for staying with us.")}</p>
          <Gifts results={view.results} nameOf={nameOf} className="mt-6 text-left" />
        </section>
      ) : (
        <section className={cn("grid gap-y-6 pt-5 text-center lg:pt-0", wheelOn ? "lg:grid-cols-[minmax(0,1fr)_auto] lg:items-center lg:gap-x-16 lg:gap-y-7 lg:text-left" : "mx-auto w-full max-w-md")}>
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
                  <span className="flex items-center gap-1.5" role="img" aria-label={spinsLeft}>
                    {Array.from({ length: view.spinsAllowed }, (_, i) => (
                      <span key={i} className={cn("size-2 rounded-full transition", i < used ? "bg-white/15" : "bg-(--vr-gold) shadow-[0_0_8px_rgba(212,163,69,0.8)]")} />
                    ))}
                  </span>
                  <span className="text-[13px] font-medium text-white/75">{spinsLeft}</span>
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
                  {t.plural(view.spinsAllowed, "You have {n} chance to win a complimentary treat from Vegas Restaurant.", "You have {n} chances to win complimentary treats from Vegas Restaurant.")}
                </p>
                {/* On a phone the button comes first; how it works sits just below it. */}
                <ol className={cn("order-3 mx-auto mt-7 max-w-[20rem] space-y-2.5 text-left text-[13px] leading-snug text-white/75 lg:order-none lg:mt-5 lg:max-w-md lg:text-[14px]", wheelOn && "lg:mx-0")}>
                  {[t("Spin the wheel — every spin wins a gift."), t("Choose: brought to your room, or enjoyed at the restaurant."), t("It is on us. Nothing is added to your bill.")].map((line, i) => (
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
                ) : view.noGift || !wheelOn ? (
                  <p className={note}>{t("Our gifts are being restocked — please try again a little later, or ask reception. None of your spins has been used.")}</p>
                ) : (
                  <div className="flex flex-col items-center gap-3 lg:flex-row lg:gap-5">
                    <button type="button" onClick={spin} disabled={!canSpin || phase !== "idle"} className={gold}>
                      {phase === "idle" ? t("Spin & Win") : t("Good luck…")}
                    </button>
                    <p className="text-[12px] text-white/50">
                      {staff ? t("Staff preview — only the guest staying in the room can spin.") : t("Every spin wins a complimentary treat.")}
                    </p>
                  </div>
                )}
                {view.results.length > 0 && (
                  <div className="mt-8 text-left lg:max-w-md">
                    <h2 className={capsGold}>{t("Your gifts")}</h2>
                    <Gifts results={view.results} nameOf={nameOf} className="mt-2.5" />
                  </div>
                )}
              </>
            )}
          </div>
        </section>
      )}

      {/* ── The gift: what was won, then where to enjoy it — or "no, thank you" ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="reveal" role="dialog" aria-modal="true" aria-label={t("Your gift")}
            initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0 }} transition={{ duration: 0.3 }}
            className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/75 px-5 pb-8 pt-20 backdrop-blur-md"
          >
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 20, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.5, ease: [0.2, 0.8, 0.2, 1] }}
              className="relative w-full max-w-[21.5rem] rounded-[28px] bg-[linear-gradient(180deg,#2c2319,#1d1712_62%)] px-5 pb-5 pt-[3.75rem] text-center shadow-[0_40px_90px_-30px_rgba(0,0,0,0.9)] ring-1 ring-(--vr-gold)/40"
            >
              <div className="absolute left-1/2 top-0 size-[5.5rem] -translate-x-1/2 -translate-y-1/2">
                <span aria-hidden className="absolute inset-[-20%] rounded-full bg-(--vr-gold)/25 blur-2xl" />
                <GiftMark image={open.won.image} className={cn("relative size-full ring-2 ring-(--vr-gold) ring-offset-4 ring-offset-(--vr-dark)", open.step === "declined" && "opacity-60 grayscale")} />
              </div>
              <p className={capsGold}>
                {t("Gift {n} of {total}", { n: open.won.spinNumber, total: view.spinsAllowed })} · {open.step === "declined" ? t("Not taken") : t("You won")}
              </p>
              <h2 className="mt-2 font-display text-[28px] font-semibold leading-[1.08] text-balance">{nameOf(open.won)}</h2>
              {open.step !== "declined" && <p className="mt-1.5 text-[12.5px] text-white/55">{t("With our compliments, {name}.", { name })}</p>}
              <div aria-hidden className="mx-auto mt-4 h-px w-10 bg-(--vr-gold)/50" />

              {open.step === "choose" && !skipping && (
                <>
                  <p className="mt-4 text-[13px] font-medium text-white/80">{t("Where would you like to enjoy it?")}</p>
                  <div className={cn("mt-3 grid gap-2.5", both && "grid-cols-2")}>
                    {view.allowRoom && (
                      <button type="button" disabled={!!busy || staff} onClick={() => claim(open.won, "ROOM")} className={tile}>
                        <BedDouble className="size-5 text-(--vr-gold)" strokeWidth={1.6} />{busy === "ROOM" ? t("One moment…") : t("Deliver to my room")}
                      </button>
                    )}
                    {view.allowRestaurant && (
                      <button type="button" disabled={!!busy || staff} onClick={() => claim(open.won, "RESTAURANT")} className={tile}>
                        <UtensilsCrossed className="size-5 text-(--vr-gold)" strokeWidth={1.6} />{busy === "RESTAURANT" ? t("One moment…") : t("Enjoy at the restaurant")}
                      </button>
                    )}
                  </div>
                  {left > 0 && both && (
                    <label className="mt-3 inline-flex min-h-8 cursor-pointer items-center gap-2 text-[12px] text-white/60">
                      <span className="relative grid size-4 shrink-0 place-items-center">
                        <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} className="peer absolute inset-0 cursor-pointer appearance-none rounded-[5px] ring-1 ring-white/35 transition checked:bg-(--vr-gold) checked:ring-(--vr-gold) focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-(--vr-gold)" />
                        <Check aria-hidden className="pointer-events-none relative size-3 text-(--vr-ink) opacity-0 peer-checked:opacity-100" strokeWidth={3.2} />
                      </span>
                      {t("The same for all my remaining gifts")}
                    </label>
                  )}
                  <div className="mt-3 border-t border-white/[0.08] pt-2">
                    <button type="button" disabled={!!busy || staff} onClick={() => setSkipping(true)} className="inline-flex min-h-9 items-center px-3 text-[12.5px] text-white/50 underline-offset-4 transition hover:text-white/85 hover:underline disabled:opacity-50">
                      {t("No, thank you — I will skip this gift")}
                    </button>
                  </div>
                </>
              )}

              {open.step === "choose" && skipping && (
                <>
                  <p className="mt-4 text-[15px] font-semibold">{t("Skip this gift?")}</p>
                  <p className="mx-auto mt-1.5 max-w-[16.5rem] text-[12.5px] leading-relaxed text-white/60">
                    {t("It will not be prepared, and it cannot be taken later.")}
                    {left > 0 && <> {t.plural(left, "You still have {n} spin.", "You still have {n} spins.")}</>}
                  </p>
                  <div className="mt-4 flex flex-wrap items-center justify-center gap-2.5">
                    <button type="button" disabled={!!busy} onClick={() => setSkipping(false)} className={goldSmall}>{t("Keep my gift")}</button>
                    <button type="button" disabled={!!busy} onClick={() => decline(open.won)} className={quietSmall}>{busy === "DECLINE" ? t("One moment…") : t("Yes, skip it")}</button>
                  </div>
                </>
              )}

              {open.step === "done" && (
                <>
                  <p className="mx-auto mt-4 flex max-w-[17.5rem] items-start gap-2.5 text-left text-[13.5px] leading-snug text-white/85">
                    <span className="mt-0.5 grid size-[18px] shrink-0 place-items-center rounded-full bg-(--vr-gold) text-(--vr-ink)"><Check className="size-3" strokeWidth={3} /></span>
                    <span>
                      {open.where === "RESTAURANT"
                        ? t("It is waiting for you at the restaurant — just tell your waiter your room number.")
                        : t("We are preparing it now and will bring it to room {room}.", { room: view.roomNumber })}
                      <span className="mt-1 block text-[12px] text-white/50">{t("Nothing is added to your bill.")}</span>
                    </span>
                  </p>
                  <button type="button" className={cn(goldSmall, "mt-5")} onClick={close}>{next}</button>
                </>
              )}

              {open.step === "declined" && (
                <>
                  <p className="mx-auto mt-4 max-w-[16.5rem] text-[13.5px] leading-snug text-white/75">{t("No problem — this gift was not ordered.")}</p>
                  <button type="button" className={cn(goldSmall, "mt-5")} onClick={close}>{next}</button>
                </>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Shell>
  );
}
