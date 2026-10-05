/**
 * Vegas public design system — import everything from "@/components/public/kit".
 *
 *   <Section tone="paper|deep|night" space="sm|md|lg" glow="top|sky" first? id labelledBy>
 *     <SectionIntro eyebrow title lede actions align="left|center|split" id />
 *     <EditorialSplit media={<MediaFrame … />}>…</EditorialSplit>
 *     <Rail label="Room types" size="lg" desktop="grid">{items}</Rail>
 *   </Section>
 *
 * Header contract: the site header is FIXED and overlays the page. Its height at the top of the
 * page is var(--pub-header-h) = 4rem (<1024px) / 5rem (≥1024px); it is 4rem whenever the page is
 * scrolled. First block: <Section first> / <PageIntro> / pt-[calc(var(--pub-header-h)+…)].
 * Sticky bars under the header: top-16. Anchors: scroll-mt-header (Section with id does it).
 *
 * Atmosphere: every Section/PageIntro/PageHero/footer paints a living background by itself (light,
 * line work, grain, beam, dissolve). HUD + glass: HudLabel, SectionIndex, HudFrame, GlassPanel,
 * Spotlight. Motion: MaskReveal, ParallaxMedia / MediaFrame parallax+reveal, Marquee.
 *
 * Full guide (scale, rhythm, do/don't): see the design-system doc handed to page builders.
 */
export * from "./tokens";
export { Section, Container, toneAttr, type SectionGlow, type SectionMarker } from "./section";
export { Atmosphere, type AtmosphereLevel, type AtmospherePattern, type AtmosphereOptions } from "./atmosphere";
export { HudLabel, SectionIndex, HudFrame, GlassPanel, Spotlight, HOTEL_COORDS } from "./hud";
export { Marquee } from "./marquee";
export { QuietList } from "./quiet-list";
export { ParallaxLayer } from "./parallax";
export { Eyebrow, Heading, Display, Accent, Lede, SectionIntro } from "./typography";
export { LinkButton, Button, TextLink, Actions, buttonClass, type ButtonVariant, type ButtonSize } from "./button";
export { PriceTag } from "./price-tag";
export { MediaFrame, ParallaxMedia, IllustrativeTag, type MediaOverlay } from "./media-frame";
export { Rail } from "./rail";
export { EditorialSplit } from "./editorial-split";
export { InfoList, FeatureList, type InfoItem, type FeatureItem } from "./info-list";
export { PageIntro } from "./page-intro";
export { Reveal, Stagger, StaggerItem, MaskReveal } from "../reveal";
