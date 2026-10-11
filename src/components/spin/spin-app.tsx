"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { BedDouble, Check, Gift, UtensilsCrossed } from "lucide-react";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { WebsiteLine, WebsiteLink } from "@/components/ordering/website-link";
import { LanguageSwitch } from "@/components/i18n/language-switch";
import { useLocale, useT } from "@/i18n/client";
import type { T } from "@/i18n/translate";
import type { SpinWhere } from "@/lib/spin";
import type { Segment, SpinOutcome, SpinView, Won } from "@/server/services/spin";
import { beginSpinAction, claimGiftAction, spinAction } from "@/app/spin/[token]/actions";

/**
 * Spin to Win on the guest's phone. Everything that matters is decided on the server: who may spin, how many spins
 * are left, and which gift a spin wins — saved before the wheel moves. This page only plays that answer back: the
 * wheel turns to the segment the server chose. A reload, a second phone or a second tap show the same truth.
 */

type Open = Extract<SpinView, { open: true }>;
type Named = { name: string; nameI18n: Record<string, string> };
type Reveal = { won: Won; step: "choose" | "done"; where?: SpinWhere | null };

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

function Wheel({ segments, rot, phase, reduce, nameOf, label, onStop, onHub, hubOff }: {
  segments: Segment[]; rot: number; phase: "idle" | "asking" | "spinning"; reduce: boolean; nameOf: (g: Named) => string;
  label: string; onStop: () => void; onHub: () => void; hubOff: boolean;
}) {
  const t = useT();
  const n = segments.length;
  const seg = n ? 360 / n : 360;
  const small = n > 8;
  return (
    <div className="relative mx-auto aspect-square w-[min(88vw,23rem)]">
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
        className="absolute left-1/2 top-1/2 grid size-[23%] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full bg-(--vr-dark) text-[12px] font-bold uppercase tracking-[0.16em] text-(--vr-gold) shadow-[0_4px_14px_rgba(0,0,0,0.55)] ring-[3px] ring-(--vr-gold) transition active:scale-95 disabled:active:scale-100"
      >
        {t("Spin")}
      </button>
    </div>
  );
}

/** The gift's picture when the menu has one — else a gift box in gold. */
function GiftMark({ image, className }: { image: string | null; className?: string }) {
  return (
    <span className={cn("grid shrink-0 place-items-center overflow-hidden rounded-full bg-(--vr-gold-soft) text-(--vr-gold-ink) ring-2 ring-(--vr-gold)", className)}>
      {image
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={image} alt="" className="size-full object-cover" />
        : <Gift className="size-[44%]" strokeWidth={1.6} />}
    </span>
  );
}

/** Where a gift is, in the guest's words. */
function giftStatus(r: Won, t: T) {
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
    <ul className={cn("divide-y divide-white/10 rounded-3xl bg-white/[0.05] px-4 ring-1 ring-white/10", className)}>
      {results.map((r) => (
        <li key={r.id} className="flex items-center gap-3 py-3">
          <GiftMark image={r.image} className="size-10" />
          <div className="min-w-0 flex-1">
            <p className="truncate text-[14px] font-semibold">{nameOf(r)}</p>
            <p className="truncate text-[12px] text-white/60">{giftStatus(r, t)}</p>
          </div>
          <span className="shrink-0 text-[10.5px] font-semibold uppercase tracking-[0.16em] text-(--vr-gold)">{t("Gift {n}", { n: r.spinNumber })}</span>
        </li>
      ))}
    </ul>
  );
}

const gold = "inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-(--vr-gold) px-6 text-[15px] font-bold uppercase tracking-[0.14em] text-(--vr-ink) shadow-[0_10px_30px_-8px_rgba(212,163,69,0.7)] transition active:scale-[0.98] disabled:opacity-50 disabled:shadow-none";
const quiet = "inline-flex h-14 w-full items-center justify-center gap-2.5 rounded-full bg-white/[0.08] px-6 text-[14px] font-semibold uppercase tracking-[0.12em] text-white ring-1 ring-white/20 transition active:scale-[0.98] disabled:opacity-50";
const capsGold = "text-[10.5px] font-semibold uppercase tracking-[0.24em] text-(--vr-gold)";

function Shell({ hotel, languages, children }: { hotel: string; languages?: readonly string[]; children: React.ReactNode }) {
  const t = useT();
  return (
    <main className="vr relative min-h-svh overflow-hidden bg-(--vr-dark) px-4 pb-[max(2.5rem,env(safe-area-inset-bottom))] pt-[max(1rem,env(safe-area-inset-top))] text-white">
      <div aria-hidden className="pointer-events-none absolute -left-28 -top-32 size-96 rounded-full bg-(--vr-gold)/[0.12] blur-3xl" />
      <div aria-hidden className="pointer-events-none absolute -bottom-40 -right-24 size-[28rem] rounded-full bg-(--vr-gold)/[0.07] blur-3xl" />
      <div className="relative mx-auto max-w-md">
        <header className="flex items-center gap-3 py-2">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src="/brand/logo-192.png" alt="" className="size-10 rounded-full ring-1 ring-(--vr-gold)/60" />
          <div className="min-w-0 flex-1 leading-tight">
            <p className="truncate font-display text-lg font-semibold">{hotel}</p>
            <p className="text-[10.5px] font-semibold uppercase tracking-[0.22em] text-(--vr-gold)">{t("Spin to Win")}</p>
          </div>
          <LanguageSwitch variant="toggle" languages={languages} />
          <WebsiteLink hotel={hotel} className="text-white/85 hover:text-white [&>svg]:text-(--vr-gold)" />
        </header>
        {children}
        <WebsiteLine hotel={hotel} className="mt-10 text-white/85" link="text-(--vr-gold)" />
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

  const [started, setStarted] = useState(false);
  const [phase, setPhase] = useState<"idle" | "asking" | "spinning">("idle");
  const [rot, setRot] = useState(0);
  const [spinWheel, setSpinWheel] = useState<Segment[] | null>(null);
  const [usedHere, setUsedHere] = useState(0);
  const [reveal, setReveal] = useState<Reveal | null>(null);
  const [claimed, setClaimed] = useState<ReadonlySet<string>>(() => new Set());
  const [same, setSame] = useState(false);
  const [busy, setBusy] = useState<SpinWhere | null>(null);
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
  // A gift won and not yet asked for (also after a reload): first, where would they like it?
  const waiting = view.pending && !claimed.has(view.pending.id) ? view.pending : null;
  const open: Reveal | null = reveal ?? (phase === "idle" && waiting ? { won: waiting, step: "choose" } : null);
  const segments = around(spinWheel ?? view.wheel);
  const canSpin = !staff && !view.paused && !view.noGift && left > 0 && !open && segments.length > 0;

  const turnTo = (deg: number) => { turned.current = deg; setRot(deg); };

  /** The wheel has stopped on the gift the server chose. */
  function stop() {
    const out = playing.current;
    if (!out) return;
    playing.current = null;
    if (stopTimer.current) { window.clearTimeout(stopTimer.current); stopTimer.current = null; }
    setPhase("idle");
    setSpinWheel(null);
    setReveal({ won: out.result, step: out.result.orderNumber ? "done" : "choose", where: out.result.where });
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
    setClaimed((c) => new Set(c).add(won.id));
    setReveal({ won, step: "done", where: res.data.where });
    router.refresh();
  }

  // ── The welcome, once ──
  if (!view.introSeen && !started && !view.paused && used === 0) {
    return (
      <Shell hotel={hotel} languages={languages}>
        <section className="pt-8 text-center motion-safe:animate-[vlh-fade_0.8s_ease-out_both]">
          <GiftMark image={null} className="mx-auto size-20 motion-safe:animate-[vlh-float_5s_ease-in-out_infinite]" />
          <p className={cn(capsGold, "mt-7")}>{t("Room {room}", { room: view.roomNumber })}</p>
          <h1 className="mt-3 font-display text-[38px] font-semibold uppercase leading-[1.02] tracking-[0.02em]">{t("Welcome to Vegas Spin to Win")}</h1>
          <p className="mx-auto mt-4 max-w-xs font-display text-[21px] leading-snug text-(--vr-gold)">{t("Your stay comes with a little something extra.")}</p>
          <p className="mx-auto mt-3 max-w-xs text-[14.5px] leading-relaxed text-white/75">
            {t.plural(view.spinsAllowed, "You have {n} chance to win a complimentary treat from Vegas Restaurant.", "You have {n} chances to win complimentary treats from Vegas Restaurant.")}
          </p>
          <ol className="mx-auto mt-7 max-w-xs space-y-3 text-left text-[13.5px] leading-snug text-white/80">
            {[t("Spin the wheel — every spin wins a gift."), t("Choose: brought to your room, or enjoyed at the restaurant."), t("It is on us. Nothing is added to your bill.")].map((line, i) => (
              <li key={i} className="flex items-start gap-3">
                <span className="grid size-6 shrink-0 place-items-center rounded-full text-[11px] font-bold text-(--vr-gold) ring-1 ring-(--vr-gold)/60">{i + 1}</span>
                <span className="pt-0.5">{line}</span>
              </li>
            ))}
          </ol>
          <button type="button" className={cn(gold, "mt-9")} onClick={() => { setStarted(true); void beginSpinAction({ token }).catch(() => null); }}>
            {t("Let's spin")}
          </button>
          <p className="mt-4 text-[11.5px] text-white/45">{t("Free for our guests — nothing to buy, nothing to pay.")}</p>
        </section>
      </Shell>
    );
  }

  const finished = left === 0 && !open && phase === "idle";

  return (
    <Shell hotel={hotel} languages={languages}>
      {finished ? (
        // ── After the last spin ──
        <section className="pt-8 text-center motion-safe:animate-[vlh-fade_0.8s_ease-out_both]">
          <p className={capsGold}>{t("{name} · Room {room}", { name: view.firstName, room: view.roomNumber })}</p>
          <h1 className="mt-3 font-display text-[34px] font-semibold uppercase leading-[1.04] tracking-[0.02em]">
            {view.spinsAllowed === 5 ? t("Five spins. Five little surprises.") : t("{n} spins. {n} little surprises.", { n: view.spinsAllowed })}
          </h1>
          <p className="mx-auto mt-3 max-w-xs text-[14px] leading-relaxed text-white/70">{t("All of them are on us — nothing is added to your bill. Thank you for staying with us.")}</p>
          <Gifts results={view.results} nameOf={nameOf} className="mt-7 text-left" />
        </section>
      ) : (
        <section className="pt-4 text-center">
          <p className={capsGold}>{t("{name} · Room {room}", { name: view.firstName, room: view.roomNumber })}</p>
          <h1 className="mt-2 font-display text-[30px] font-semibold uppercase leading-[1.05] tracking-[0.03em]">{t("Spin & Win")}</h1>
          <div className="mt-3 flex items-center justify-center gap-2" role="img" aria-label={t.plural(left, "{n} spin left", "{n} spins left")}>
            {Array.from({ length: view.spinsAllowed }, (_, i) => (
              <span key={i} className={cn("size-2.5 rounded-full transition", i < used ? "bg-white/15" : "bg-(--vr-gold) shadow-[0_0_10px_rgba(212,163,69,0.8)]")} />
            ))}
          </div>
          <p className="mt-2 text-[13px] font-medium text-white/75">{t.plural(left, "{n} spin left", "{n} spins left")}</p>

          {view.paused ? (
            <p className="mx-auto mt-8 max-w-xs rounded-3xl bg-white/[0.05] px-5 py-6 text-[14px] leading-relaxed text-white/80 ring-1 ring-white/10">{t("Spin to Win is resting for now. The gifts you have won are still yours.")}</p>
          ) : view.noGift ? (
            <p className="mx-auto mt-8 max-w-xs rounded-3xl bg-white/[0.05] px-5 py-6 text-[14px] leading-relaxed text-white/80 ring-1 ring-white/10">{t("Our gifts are being restocked — please try again a little later, or ask reception. None of your spins has been used.")}</p>
          ) : (
            <>
              <div className="mt-6">
                <Wheel segments={segments} rot={rot} phase={phase} reduce={reduce} nameOf={nameOf} label={t("The wheel of gifts")} onStop={stop} onHub={spin} hubOff={!canSpin || phase !== "idle"} />
              </div>
              <button type="button" onClick={spin} disabled={!canSpin || phase !== "idle"} className={cn(gold, "mt-8")}>
                {phase === "idle" ? t("Spin & Win") : t("Good luck…")}
              </button>
              <p className="mt-3 text-[12px] text-white/50">
                {staff ? t("Staff preview — only the guest staying in the room can spin.") : t("Every spin wins a complimentary treat.")}
              </p>
            </>
          )}

          {view.results.length > 0 && (
            <div className="mt-9 text-left">
              <h2 className="font-display text-[22px] font-semibold">{t("Your gifts")}</h2>
              <Gifts results={view.results} nameOf={nameOf} className="mt-3" />
            </div>
          )}
        </section>
      )}
      <p className="mt-8 text-center text-[11.5px] leading-relaxed text-white/40">{t("Complimentary gifts for guests staying with us. No purchase, no payment.")}</p>

      {/* ── The gift: what was won, then where to enjoy it ── */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="reveal" role="dialog" aria-modal="true" aria-label={t("Your gift")}
            initial={reduce ? false : { opacity: 0 }} animate={{ opacity: 1 }} exit={reduce ? undefined : { opacity: 0 }} transition={{ duration: 0.3 }}
            className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-(--vr-dark)/[0.97] px-5 py-8 backdrop-blur-sm"
          >
            <motion.div
              initial={reduce ? false : { opacity: 0, y: 24, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.55, ease: [0.2, 0.8, 0.2, 1] }}
              className="w-full max-w-sm text-center"
            >
              <div className="relative mx-auto size-32">
                <span aria-hidden className="absolute inset-0 rounded-full ring-1 ring-(--vr-gold)/50 motion-safe:animate-ping [animation-duration:2.6s]" />
                <span aria-hidden className="absolute inset-[-14%] rounded-full bg-(--vr-gold)/25 blur-2xl" />
                <GiftMark image={open.won.image} className="relative size-32" />
              </div>
              <p className={cn(capsGold, "mt-6")}>{t("Gift {n} of {total}", { n: open.won.spinNumber, total: view.spinsAllowed })} · {t("You won")}</p>
              <h2 className="mt-2 font-display text-[36px] font-semibold leading-[1.04]">{nameOf(open.won)}</h2>
              <p className="mt-2 text-[13px] text-white/60">{t("Complimentary — with our compliments.")}</p>

              {open.step === "choose" ? (
                <div className="mt-8">
                  <p className="text-[14.5px] font-medium text-white/85">{t("Where would you like to enjoy it?")}</p>
                  <div className="mt-4 grid gap-3">
                    {view.allowRoom && (
                      <button type="button" disabled={!!busy || staff} onClick={() => claim(open.won, "ROOM")} className={gold}>
                        <BedDouble className="size-[18px]" />{busy === "ROOM" ? t("One moment…") : t("Deliver to my room")}
                      </button>
                    )}
                    {view.allowRestaurant && (
                      <button type="button" disabled={!!busy || staff} onClick={() => claim(open.won, "RESTAURANT")} className={view.allowRoom ? quiet : gold}>
                        <UtensilsCrossed className={cn("size-[18px]", view.allowRoom && "text-(--vr-gold)")} />{busy === "RESTAURANT" ? t("One moment…") : t("Enjoy at the restaurant")}
                      </button>
                    )}
                  </div>
                  {left > 0 && view.allowRoom && view.allowRestaurant && (
                    <label className="mt-5 inline-flex min-h-11 cursor-pointer items-center gap-2.5 text-[13px] text-white/75">
                      <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} className="size-[18px] accent-(--vr-gold)" />
                      {t("The same for all my remaining gifts")}
                    </label>
                  )}
                </div>
              ) : (
                <div className="mt-8">
                  <p className="mx-auto flex max-w-xs items-start justify-center gap-2.5 text-left text-[14.5px] leading-snug text-white/85">
                    <span className="mt-0.5 grid size-5 shrink-0 place-items-center rounded-full bg-(--vr-gold) text-(--vr-ink)"><Check className="size-3.5" strokeWidth={3} /></span>
                    <span>
                      {open.where === "RESTAURANT"
                        ? t("It is waiting for you at the restaurant — just tell your waiter your room number.")
                        : t("We are preparing it now and will bring it to room {room}.", { room: view.roomNumber })}
                      <span className="mt-1 block text-[12.5px] text-white/55">{t("Nothing is added to your bill.")}</span>
                    </span>
                  </p>
                  <button type="button" className={cn(gold, "mt-7")} onClick={() => setReveal(null)}>
                    {left > 0 ? t.plural(left, "Spin again · {n} left", "Spin again · {n} left") : t("See my gifts")}
                  </button>
                </div>
              )}
            </motion.div>
          </motion.div>
        )}
      </AnimatePresence>
    </Shell>
  );
}
