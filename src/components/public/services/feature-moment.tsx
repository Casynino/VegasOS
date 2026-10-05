import { cn } from "@/lib/utils";
import { Actions } from "../kit/button";
import { HudFrame, HudLabel } from "../kit/hud";
import { MediaFrame } from "../kit/media-frame";
import { typeScale } from "../kit/tokens";
import { Eyebrow } from "../kit/typography";
import fx from "./fx.module.css";

/**
 * The lead story of a night section: one wide photograph with its words. Phones read it as a
 * photo, then the text below it (nothing crammed over a small image); from 1280px the words float
 * over the photograph in a smoked-glass panel — the band's one cinematic device. The photo wipes
 * open as it enters, inside thin HUD brackets. Put it in a night-tone section.
 */
export function FeatureMoment({
  image,
  focal,
  focalSm,
  eyebrow,
  title,
  body,
  actions,
  hud,
  id,
  className,
}: {
  image: { src: string; alt: string };
  focal?: string;
  focalSm?: string;
  eyebrow: string;
  title: React.ReactNode;
  body: React.ReactNode;
  actions?: React.ReactNode;
  /** A short HUD line in the glass panel (desktop; real data only). */
  hud?: React.ReactNode;
  /** Heading id (aria-labelledby). */
  id?: string;
  className?: string;
}) {
  return (
    <article aria-labelledby={id} className={cn("relative", className)}>
      <HudFrame offset="sm" size="lg">
        <MediaFrame
          src={image.src}
          alt={image.alt}
          ratio="4/3"
          ratioSm="16/10"
          ratioLg="21/9"
          focal={focal}
          focalSm={focalSm}
          reveal="left"
          tagClassName="left-auto right-3 sm:right-4 sm:top-4"
          sizes="(min-width: 1280px) 1216px, 100vw"
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 hidden bg-[linear-gradient(to_right,rgb(12_10_7/0.6)_0%,rgb(12_10_7/0.25)_42%,rgb(12_10_7/0)_68%)] xl:block"
          />
        </MediaFrame>
      </HudFrame>
      <div className="mt-8 max-w-xl xl:pointer-events-none xl:absolute xl:inset-y-0 xl:left-0 xl:mt-0 xl:flex xl:max-w-[35rem] xl:flex-col xl:justify-end xl:p-10">
        <div className={cn(fx.floatGlass, "xl:pointer-events-auto")}>
          {hud && <HudLabel className="mb-5 hidden xl:inline-flex">{hud}</HudLabel>}
          <Eyebrow>{eyebrow}</Eyebrow>
          <h3 id={id} className={cn(typeScale.feature, "mt-4 text-pub-fg")}>
            {title}
          </h3>
          <p className={cn(typeScale.body, "mt-3 max-w-[30rem] text-pub-muted xl:line-clamp-4 xl:text-pub-fg/80")}>{body}</p>
          {actions && <Actions className="mt-7">{actions}</Actions>}
        </div>
      </div>
    </article>
  );
}
