/**
 * Shared class recipes for the public website: warm espresso + gold, cream
 * contrast bands, glass panels, rounded cards and pill buttons.
 *
 * Older recipes, kept for the forms and pages that use them (booking, menu ordering,
 * payments). New work uses the design system in ./kit (Section, Heading, LinkButton,
 * MediaFrame…); the type scale below now comes from it, so every page shares one scale.
 */
import { containers, typeScale } from "./kit/tokens";

export const container = containers.default;

/** Warm dark background (espresso) and its raised surface. */
export const espresso = "bg-[#15120e]";
export const espressoRaised = "bg-[#1f1a14]";
/** Cream contrast band. */
export const cream = "bg-paper";
/** Deep gold that passes WCAG AA as text on cream/white. */
export const goldText = "text-accent-ink";

export const glass = "border border-white/15 bg-white/[0.07] backdrop-blur-xl shadow-[0_8px_40px_rgba(0,0,0,0.35)]";

const pillBase =
  "group/pill relative inline-flex items-center justify-center gap-3 overflow-hidden rounded-full text-sm font-medium tracking-wide transition-all duration-300 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-60 " +
  // shine sweep on hover
  "before:pointer-events-none before:absolute before:inset-y-0 before:-left-[60%] before:w-[40%] before:skew-x-[-20deg] before:bg-white/35 before:opacity-0 before:transition-[left,opacity] before:duration-700 hover:before:left-[130%] hover:before:opacity-100 motion-reduce:before:hidden";

export const pillGold = `${pillBase} bg-gold text-[#1a140c] shadow-[0_10px_30px_-10px_oklch(0.72_0.12_80/0.7)] hover:shadow-[0_14px_40px_-8px_oklch(0.72_0.12_80/0.85)] focus-visible:ring-offset-[#15120e]`;
export const pillGlass = `${pillBase} border border-white/25 bg-white/10 text-white backdrop-blur-md hover:border-gold/70 hover:bg-white/15 focus-visible:ring-offset-[#15120e]`;
export const pillDark = `${pillBase} bg-tone text-paper hover:opacity-90 focus-visible:ring-offset-paper`;
export const pillOutline = `${pillBase} border border-tone/25 text-tone hover:border-tone hover:bg-[#15120e] hover:text-white focus-visible:ring-offset-white`;

/** Sizes: text-only pill vs pill with a circular arrow badge. */
export const pillPad = "px-6 py-3";
export const pillPadIcon = "py-1.5 pl-6 pr-1.5";

export const eyebrow = typeScale.eyebrow;

export const fieldLabel = "mb-1.5 block text-[11px] font-medium uppercase tracking-[0.18em] text-tone/70";
export const fieldInput =
  "block h-12 w-full rounded-xl border border-tone/15 bg-panel px-4 text-base text-tone placeholder:text-tone/40 transition-colors focus:border-tone/60 focus:outline-none focus:ring-3 focus:ring-gold/40 aria-invalid:border-red-700 aria-invalid:ring-red-700/15";
export const fieldTextarea =
  "block min-h-28 w-full rounded-xl border border-tone/15 bg-panel px-4 py-3 text-base text-tone placeholder:text-tone/40 transition-colors focus:border-tone/60 focus:outline-none focus:ring-3 focus:ring-gold/40 aria-invalid:border-red-700";
export const fieldError = "mt-1.5 text-sm text-red-700";

/** Fluid type scale — aliases of the kit scale (kit/tokens.ts typeScale), the single source. */
export const type = {
  display: typeScale.display,
  h1: typeScale.title,
  h2: typeScale.heading,
  h3: typeScale.subheading,
  lead: typeScale.lede,
  body: typeScale.body,
} as const;
