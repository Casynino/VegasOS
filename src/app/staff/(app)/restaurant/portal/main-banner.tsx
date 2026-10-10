"use client";

import Image from "next/image";
import { useT } from "@/i18n/client";

const DISHES = [
  { src: "/images/menu/mi_local_favorites_nyama_choma_beef.webp", alt: "Nyama choma" },
  { src: "/images/menu/mi_local_favorites_samaki_choma_grilled_fish.webp", alt: "Samaki choma" },
  { src: "/images/menu/mi_main_courses_chicken_pilau_beef_pilau.webp", alt: "Pilau" },
];

/**
 * The main restaurant screen's banner — small, one line high on a laptop: the dining room on one side,
 * the bar on the other, "Vegas Restaurant & Bar" between them, what is happening now underneath, and
 * a few of the kitchen's dishes beside the restaurant's QR.
 */
export function MainBanner({ ready, fresh, serving, time, aside }: {
  ready: number; fresh: number; serving: number;
  /** "20:14" — the screen's live clock. */
  time: string;
  /** The restaurant's QR button. */
  aside?: React.ReactNode;
}) {
  const t = useT();
  const bold = (c: React.ReactNode) => <strong className="font-semibold text-white">{c}</strong>;
  const dot = (c: React.ReactNode) => <span className="mx-1.5 text-white/35">{c}</span>;
  return (
    <section aria-label={t("Vegas Restaurant & Bar")} className="relative isolate overflow-hidden rounded-[1.75rem] bg-[#15100c] text-white shadow-[0_24px_60px_-30px_rgba(40,25,5,0.75)]">
      {/* The dining room (left) and the bar (right), fading into the middle */}
      <div aria-hidden className="absolute inset-y-0 left-0 -z-10 w-[38%] sm:w-[34%]">
        <Image src="/images/illustrative/restaurant-warm.webp" alt="" fill sizes="(min-width: 640px) 34vw, 38vw" className="object-cover object-center opacity-70" priority />
        <div className="absolute inset-0 bg-linear-to-r from-[#15100c]/20 via-[#15100c]/55 to-[#15100c]" />
      </div>
      <div aria-hidden className="absolute inset-y-0 right-0 -z-10 w-[38%] sm:w-[34%]">
        <Image src="/images/illustrative/bar-pour.webp" alt="" fill sizes="(min-width: 640px) 34vw, 38vw" className="object-cover object-[center_35%] opacity-75" priority />
        <div className="absolute inset-0 bg-linear-to-l from-[#15100c]/10 via-[#15100c]/55 to-[#15100c]" />
      </div>
      <div aria-hidden className="absolute left-1/2 top-1/2 -z-10 h-56 w-[36rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-[radial-gradient(closest-side,oklch(0.78_0.13_80/0.22),transparent)]" />

      <div className="relative grid min-h-[8.5rem] grid-cols-1 items-center gap-3 px-5 py-4 sm:grid-cols-[1fr_auto_1fr] sm:px-7">
        {/* Live */}
        <p className="flex items-center gap-1.5 justify-self-center text-[11px] font-medium text-white/80 sm:justify-self-start sm:self-start" suppressHydrationWarning>
          <span className="relative flex size-1.5"><span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" /><span className="relative inline-flex size-1.5 rounded-full bg-emerald-400" /></span>
          {t("Live · {time}", { time })}
        </p>

        {/* The name, in the middle */}
        <div className="text-center">
          <div className="flex items-center justify-center gap-3">
            <span aria-hidden className="hidden h-px w-10 bg-linear-to-r from-transparent to-[oklch(0.82_0.11_82)] sm:block" />
            <h1 className="font-display text-[2.1rem] font-semibold leading-none tracking-[0.28em] text-[#f6e3b4] sm:text-[2.6rem]">VEGAS</h1>
            <span aria-hidden className="hidden h-px w-10 bg-linear-to-l from-transparent to-[oklch(0.82_0.11_82)] sm:block" />
          </div>
          <p className="mt-1.5 text-[11px] font-semibold uppercase tracking-[0.42em] text-[oklch(0.84_0.11_82)] sm:text-xs">{t("Restaurant & Bar")}</p>
          <p className="mt-2.5 text-[13px] text-white/80" suppressHydrationWarning>
            {t.rich("<b>{ready}</b> ready to serve<s>·</s><b>{fresh}</b> new<s>·</s><b>{serving}</b> serving", { b: bold, s: dot }, { ready, fresh, serving })}
          </p>
        </div>

        {/* A few of the kitchen's dishes, and the QR */}
        <div className="flex items-center justify-center gap-3 sm:justify-self-end">
          <div aria-hidden className="hidden -space-x-2.5 md:flex">
            {DISHES.map((d) => (
              <span key={d.src} className="relative size-11 overflow-hidden rounded-full ring-2 ring-[#15100c] shadow-[0_6px_16px_-6px_rgba(0,0,0,0.7)]">
                <Image src={d.src} alt="" fill sizes="44px" className="object-cover" />
              </span>
            ))}
          </div>
          {aside}
        </div>
      </div>
    </section>
  );
}
