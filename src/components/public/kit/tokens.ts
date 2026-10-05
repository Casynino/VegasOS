/**
 * Vegas public design system — the class recipes every kit component is built from.
 * Use the components first (Section, Heading, LinkButton, MediaFrame…); reach for these
 * recipes only when a component does not fit (e.g. heading style on a <Link>).
 *
 * Colours are tone-aware: inside a <Section tone="paper|deep|night"> (or any element with
 * data-tone) use text-pub-fg / text-pub-muted / text-pub-faint / border-pub-line /
 * text-pub-eyebrow and they follow the section and the visitor's light/dark choice.
 * text-pub-faint (about 3:1 on paper) is for separators, icons and arrows only — words use
 * text-pub-muted or stronger.
 */

/** Typography — Cormorant (display) for titles and prices, Inter for everything else. */
export const typeScale = {
  /** The one big moment: home hero, a closing "book" moment. Max one or two per page. */
  display: "font-display font-medium text-[clamp(2.75rem,1.6rem+5.2vw,6rem)] leading-[0.95] tracking-[-0.015em] text-balance",
  /** Page title (H1) of inner pages and page intros. */
  title: "font-display font-medium text-[clamp(2.25rem,1.5rem+3.4vw,4.25rem)] leading-[1.02] tracking-[-0.01em] text-balance",
  /** Section heading (H2). */
  heading: "font-display font-medium text-[clamp(1.875rem,1.3rem+2.2vw,3.25rem)] leading-[1.06] tracking-[-0.005em] text-balance",
  /** A featured item's name: the home's lead room, a /rooms row, a story over a photo. */
  feature: "font-display font-medium text-[clamp(1.75rem,1.25rem+1.6vw,2.625rem)] leading-[1.08] tracking-[-0.005em] text-balance",
  /** Item title (H3): a room type, a venue, a service. */
  subheading: "font-display font-medium text-[clamp(1.375rem,1.15rem+0.8vw,1.875rem)] leading-[1.15]",
  /** A name inside a list: a dish, a drinks shelf, a step, a service row, a choice. */
  item: "font-display font-medium text-[clamp(1.25rem,1.15rem+0.45vw,1.5rem)] leading-[1.2]",
  /** One or two sentences under a heading. */
  lede: "text-[clamp(1rem,0.95rem+0.25vw,1.125rem)] leading-[1.65] text-pretty",
  body: "text-[15px] leading-[1.7] text-pretty sm:text-base",
  small: "text-[13px] leading-[1.6] sm:text-sm",
  /** Small caps label above headings. */
  eyebrow: "text-[11px] font-medium uppercase leading-none tracking-[0.28em]",
  /** Facts line: "2 guests · King bed · Breakfast included". */
  meta: "text-[11px] font-medium uppercase leading-[1.5] tracking-[0.16em] sm:text-xs",
  /** Buttons and text links. */
  cta: "text-[13px] font-medium tracking-[0.01em] sm:text-sm",
  /** Amounts (pair with a size). */
  price: "font-display font-medium lining-nums tabular-nums",
} as const;

export type TypeStyle = keyof typeof typeScale;

/** Comfortable line lengths. */
export const measure = {
  lede: "max-w-[36rem]",
  body: "max-w-[34rem]",
  heading: "max-w-3xl",
} as const;

/** Page width. Phones always get 16px side gutters (px-4), tablets/desktop 32px. */
export const containers = {
  default: "mx-auto w-full max-w-7xl px-4 sm:px-8",
  wide: "mx-auto w-full max-w-[90rem] px-4 sm:px-8",
  narrow: "mx-auto w-full max-w-3xl px-4 sm:px-8",
} as const;

export type ContainerWidth = keyof typeof containers;

/** Vertical rhythm of sections: phone → tablet → desktop. Breathe, but never tall for nothing. */
export const sectionSpace = {
  none: "",
  sm: "py-12 sm:py-16 lg:py-20",
  md: "py-16 sm:py-20 lg:py-28",
  lg: "py-20 sm:py-28 lg:py-36",
} as const;

export type SectionSpace = keyof typeof sectionSpace;

/**
 * Top padding for the FIRST block of a page: clears the fixed header (var(--pub-header-h):
 * 4rem phones/tablets, 5rem lg+) plus breathing room. Same keys as sectionSpace.
 */
export const pageTop = {
  none: "pt-header",
  sm: "pt-[calc(var(--pub-header-h)+2rem)] sm:pt-[calc(var(--pub-header-h)+2.5rem)] lg:pt-[calc(var(--pub-header-h)+3rem)]",
  md: "pt-[calc(var(--pub-header-h)+2.5rem)] sm:pt-[calc(var(--pub-header-h)+3.5rem)] lg:pt-[calc(var(--pub-header-h)+4.5rem)]",
  lg: "pt-[calc(var(--pub-header-h)+3rem)] sm:pt-[calc(var(--pub-header-h)+4.5rem)] lg:pt-[calc(var(--pub-header-h)+6rem)]",
} as const;

/** Spacing between the parts of a block. */
export const rhythm = {
  afterEyebrow: "mt-4",
  afterHeading: "mt-4 sm:mt-5",
  beforeActions: "mt-7 sm:mt-8",
  /** Between a section intro and its content (list, rail, grid). */
  afterIntro: "mt-10 sm:mt-12 lg:mt-16",
  /** Grid / split gaps. */
  gap: "gap-8 sm:gap-10 lg:gap-14",
} as const;

/** Section tones. "night" stays dark in both themes; paper/deep follow light/dark. */
export const tones = {
  // Not `bg-paper`: that class has an older translucent dark-mode override; kit sections stay opaque.
  paper: "bg-[var(--pub-paper)] text-pub-fg",
  deep: "bg-[var(--pub-paper-deep)] text-pub-fg",
  night: "bg-night text-pub-fg",
  none: "text-pub-fg",
} as const;

export type Tone = keyof typeof tones;

/** Motion: fast and quiet. Every recipe switches off with prefers-reduced-motion. */
export const motionCls = {
  /** Colour/border changes on hover and focus. */
  hover: "transition-colors duration-200 ease-out motion-reduce:transition-none",
  /** Buttons, header, small moves. */
  base: "transition duration-300 ease-pub motion-reduce:transition-none",
  /** Photo zoom when its card (a `group` ancestor) or the frame is hovered. */
  imageZoom:
    "transition-transform duration-700 ease-pub group-hover:scale-[1.04] group-hover/media:scale-[1.04] motion-reduce:transition-none motion-reduce:group-hover:scale-100 motion-reduce:group-hover/media:scale-100",
  /** Hero photo settles from a gentle zoom once on load. */
  settle: "pub-settle",
} as const;

/**
 * Form fields that follow the section tone (white on paper, smoked on night, dark panels in
 * dark mode). Inputs are 48px tall and 16px text (no iOS zoom).
 */
export const field = {
  label: "mb-2 block text-[11px] font-medium uppercase tracking-[0.18em] text-pub-muted",
  input:
    "block h-12 w-full rounded-[0.625rem] border border-pub-line bg-pub-field px-4 text-base text-pub-fg placeholder:text-pub-faint transition-[border-color,box-shadow] duration-200 focus:border-pub-fg/45 focus:outline-none focus:ring-3 focus:ring-gold/30 aria-invalid:border-pub-error aria-invalid:ring-pub-error/20 disabled:opacity-60 motion-reduce:transition-none",
  textarea:
    "block min-h-28 w-full rounded-[0.625rem] border border-pub-line bg-pub-field px-4 py-3 text-base text-pub-fg placeholder:text-pub-faint transition-[border-color,box-shadow] duration-200 focus:border-pub-fg/45 focus:outline-none focus:ring-3 focus:ring-gold/30 aria-invalid:border-pub-error disabled:opacity-60 motion-reduce:transition-none",
  error: "mt-1.5 text-sm text-pub-error",
  hint: "mt-1.5 text-[13px] text-pub-muted",
} as const;

/**
 * Quiet surfaces for functional content only (forms, a booking summary, a receipt) — never
 * for marketing content, which sits directly on the section.
 */
export const surface = {
  panel: "rounded-[1rem] border border-pub-line bg-pub-raised p-5 sm:p-7",
  hairline: "border-t border-pub-line",
} as const;

/** Focus ring for custom interactive elements (buttons/links in the kit already have it). */
export const focusRing = "focus-visible:outline-2 focus-visible:outline-offset-[3px] focus-visible:outline-gold";
