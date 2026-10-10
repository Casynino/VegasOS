import Image from "next/image";
import { cn } from "@/lib/utils";
import { getT } from "@/i18n/server";
import { blurFor } from "../blur-data";
import { HudLabel } from "../kit/hud";
import fx from "./fx.module.css";

/*
 * The hotel's street entrance (exterior-02, 3:2) traced by hand as an architect's elevation, in the
 * photograph's own coordinates (1000 × 666), so the drawing and the photograph line up exactly where
 * the scan line passes. Main lines first, then the finer ones (louvres, balusters, glazing).
 */
const MAIN = [
  // Building: glass stair core, façade edge, balconies
  "M372 0V222L470 241V0",
  "M490 0V332",
  "M0 88L100 107M107 107L340 147",
  "M0 170L100 186M100 184L340 212M0 200L92 210L340 236",
  "M200 0V128H292V0",
  // Left pillar and cap
  "M177 257H265V272H177Z",
  "M190 272V556H248V272",
  // Middle pillar and cap
  "M543 307H607V320H543Z",
  "M554 320V524H599V320",
  // Fences: top rails, the solid panel, the foot
  "M0 287L190 297M0 405H190M0 490H190M0 556H190",
  "M248 318L548 336M248 414L548 416M248 480L548 478M248 526L548 524",
  // The arch: the long diagonal leg, the crown, the inner line and the stair rail
  "M598 505L782 270C812 236 900 228 970 305",
  "M624 524L792 300C826 262 896 262 950 315",
  "M600 498L700 348",
  // Right gate: lintel, posts, the logo wall, the base
  "M760 312L970 318M760 330L970 336",
  "M778 330V498M802 330V498M882 270V492M906 270V492M968 318V490",
  "M655 520L978 490",
  // Street: the kerb and the pavement edge
  "M0 643L500 586L1000 513",
  "M0 560L1000 497",
];

const MINOR = [
  // Glazing grid of the stair core
  "M402 0V228M425 0V232M447 0V236M372 66L470 74M372 150L470 160",
  // Balcony balusters and the door on the left
  "M110 108V182M166 112V188M228 123V197M286 135V205M340 147V212M20 92V173M60 99V179",
  "M129 0V185M180 0V185",
  // Left fence louvres
  "M0 300L190 309M0 316L190 322M0 330L190 335M0 345L190 349M0 360L190 362M0 374L190 376M0 389L190 390",
  "M0 503H190M0 516H190M0 529H190M0 542H190M5 287V556",
  // Middle fence louvres and posts
  "M248 331L548 347M248 345L548 360M248 358L548 371M248 372L548 383M248 385L548 393M248 398L548 404",
  "M248 492L548 490M248 504L548 502M248 515L548 513M340 323V524M455 330V524",
  // Right gate louvres
  "M806 345H878M806 360H878M806 375H878M806 390H878M806 405H878M806 455H878M806 470H878",
  "M612 340H700M612 356H690M612 372H680",
  // The logo medallion on the wall
  "M932 372a18 22 0 1 0 0.1 0Z",
  // Background: the white building, the red roof, the poles
  "M525 248V197L620 190L740 217V300",
  "M490 245L625 248L725 310",
  "M685 222V345M978 125V480",
];

/** Architect's notes: centre lines through the pillars, a dimension run, the arch height, street level, a section mark. */
const NOTES = (
  <>
    <path className={fx.bpCenter} d="M219 214V610M576 268V600" />
    <path d="M177 250V222M607 300V222M177 232H607M170 239L184 225M600 239L614 225" />
    <path d="M984 241V490M977 241H991M977 490H991M978 248L990 234M978 497L990 483" />
    <path d="M20 556H150" />
    <path className={fx.bpSolid} d="M34 556L26 544H42Z" />
    <circle cx="870" cy="160" r="15" />
    <path d="M870 175V228M855 160H822" />
  </>
);

/**
 * "Drawn, then built" — the About page's signature moment. The street entrance is first a gold
 * architect's elevation on a drafting sheet; as the frame rises into view the pen draws it, then a
 * scan line wipes the real photograph in behind it (CSS scroll timelines, compositor-friendly).
 * Without scroll timelines, or with reduced motion, it rests as a still split: drawing | photograph.
 * Dimension lines, levels and centre lines stay over both, like an AR overlay. The labels are words,
 * never invented measurements.
 */
export async function BlueprintElevation({
  src,
  alt,
  label,
  coords,
  className,
}: {
  src: string;
  alt: string;
  label?: string;
  /** The hotel's coordinates (HOTEL_COORDS.label). */
  coords?: string;
  className?: string;
}) {
  const t = await getT();
  return (
    <figure className={cn("relative", className)}>
      <div className={fx.bp}>
        <div aria-hidden="true" className={fx.bpSheet} />
        <svg aria-hidden="true" className={cn(fx.bpSvg, fx.bpDraw)} viewBox="0 0 1000 666" preserveAspectRatio="xMidYMid slice">
          {MAIN.map((d) => (
            <path key={d} d={d} pathLength={1} />
          ))}
          {MINOR.map((d) => (
            <path key={d} d={d} pathLength={1} className={fx.bpMinor} />
          ))}
        </svg>

        <div className={fx.bpPhoto}>
          <Image src={src} alt={alt} fill sizes="(min-width: 1024px) 58vw, 100vw" {...blurFor(src)} className="pub-grade object-cover" />
        </div>
        <div aria-hidden="true" className={fx.bpScan} />

        {/* Notes over drawing and photograph: centre lines, a dimension run, the arch height, street level. */}
        <svg aria-hidden="true" className={cn(fx.bpSvg, fx.bpNotes, "z-[3]")} viewBox="0 0 1000 666" preserveAspectRatio="xMidYMid slice">
          {/* A soft dark underlay keeps the gold notes legible over the bright photograph. */}
          <g className={fx.bpUnder}>{NOTES}</g>
          <g>{NOTES}</g>
        </svg>

        {/* Sheet labels (words only), each on its own small dark chip so they read over the photograph. */}
        <span className="absolute left-3 top-3 z-[4] rounded-sm bg-[#0f0c09]/75 px-2 py-1.5 sm:left-4 sm:top-4">
          <HudLabel tick={false} className="text-[#f0d496]">{label ?? t("Elevation · Street entrance")}</HudLabel>
        </span>
        {coords && (
          <span className="absolute bottom-3 right-3 z-[4] rounded-sm bg-[#0f0c09]/75 px-2 py-1.5 sm:bottom-4 sm:right-4">
            <HudLabel tick={false} className="text-[#f3ece0]/80">{coords}</HudLabel>
          </span>
        )}
        <span aria-hidden="true" className="absolute bottom-3 left-3 z-[4] hidden rounded-sm bg-[#0f0c09]/75 px-2 py-1.5 sm:bottom-4 sm:left-4 sm:block">
          <HudLabel tick={false} className="text-[#f3ece0]/70">{t("Street level")}</HudLabel>
        </span>
      </div>
    </figure>
  );
}

/**
 * The drawing's title block: real facts about the hotel as an architect's ledger (hairline cells,
 * mono labels, serif values). Two columns on phones, four from 640px.
 */
export function TitleBlock({
  heading,
  aside,
  items,
  className,
}: {
  heading: React.ReactNode;
  aside?: React.ReactNode;
  items: { label: string; value: React.ReactNode }[];
  className?: string;
}) {
  return (
    <div className={cn("border border-pub-line", className)}>
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2 border-b border-pub-line px-4 py-3">
        <HudLabel>{heading}</HudLabel>
        {aside && <HudLabel tick={false}>{aside}</HudLabel>}
      </div>
      <dl className="grid grid-cols-2 sm:grid-cols-4">
        {items.map((it, i) => (
          <div
            key={it.label}
            className={cn(
              "min-w-0 border-pub-line px-4 py-3.5",
              i % 2 === 1 && "border-l",
              i >= 2 && "border-t",
              "sm:border-t-0 sm:border-l-0",
              i % 4 !== 0 && "sm:border-l",
              i >= 4 && "sm:border-t",
            )}
          >
            <dt className="font-mono text-[10px] font-medium uppercase leading-none tracking-[0.2em] text-pub-muted">{it.label}</dt>
            <dd className="mt-2 font-display text-[1.375rem] leading-none text-pub-fg lining-nums tabular-nums [overflow-wrap:anywhere]">{it.value}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
