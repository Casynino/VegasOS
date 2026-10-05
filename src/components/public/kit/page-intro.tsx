import { cn } from "@/lib/utils";
import { HOTEL_COORDS, HudLabel } from "./hud";
import { Section, type SectionGlow } from "./section";
import { SectionIntro } from "./typography";

/**
 * Opening band for pages without a photo hero (booking, contact, utility pages): night tone,
 * clears the fixed header, H1 in the page-title size. Keep the lede to one or two sentences.
 * Rich night atmosphere with star dust; on desktop a HUD label (the hotel's coordinates by
 * default — `meta` to change, false to hide) sits top-right.
 */
export function PageIntro({
  eyebrow,
  title,
  lede,
  actions,
  align = "left",
  glow = "top",
  space = "md",
  meta,
  id,
  className,
  children,
}: {
  eyebrow?: React.ReactNode;
  title: React.ReactNode;
  lede?: React.ReactNode;
  actions?: React.ReactNode;
  align?: "left" | "center" | "split";
  glow?: SectionGlow;
  space?: "sm" | "md";
  /** HUD text top-right on desktop (default: the hotel's coordinates; false = none). */
  meta?: React.ReactNode | false;
  /** Heading id (aria-labelledby); defaults to none. */
  id?: string;
  className?: string;
  /** Extra content under the intro (e.g. a progress bar or a search form). */
  children?: React.ReactNode;
}) {
  return (
    <Section tone="night" first space={space} glow={glow} stars width="wide" labelledBy={id} className={cn(space === "sm" ? "pb-10 sm:pb-12 lg:pb-12" : "pb-12 sm:pb-16 lg:pb-20", className)}>
      <div className="relative">
        {meta !== false && (
          <HudLabel tick={false} className="absolute right-0 top-0 hidden lg:inline-flex">
            {meta ?? HOTEL_COORDS.label}
          </HudLabel>
        )}
        <SectionIntro as="h1" size="title" id={id} eyebrow={eyebrow} title={title} lede={lede} actions={actions} align={align} />
      </div>
      {children}
    </Section>
  );
}
