import { cn } from "@/lib/utils";
import { Actions } from "../kit/button";
import { MediaFrame } from "../kit/media-frame";
import { typeScale } from "../kit/tokens";
import { Eyebrow } from "../kit/typography";

/**
 * The lead story of a night section: one wide photograph with its words. Phones read it as a
 * photo, then the text below it (nothing crammed over a small image); from 1280px, where the
 * wide frame is tall enough for it, the text sits over the photo's darkened left side,
 * cinema-style. Put it in a night-tone section.
 */
export function FeatureMoment({
  image,
  focal,
  focalSm,
  eyebrow,
  title,
  body,
  actions,
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
  /** Heading id (aria-labelledby). */
  id?: string;
  className?: string;
}) {
  return (
    <article aria-labelledby={id} className={cn("relative", className)}>
      <MediaFrame
        src={image.src}
        alt={image.alt}
        ratio="4/3"
        ratioSm="16/10"
        ratioLg="21/9"
        focal={focal}
        focalSm={focalSm}
        corners
        sizes="(min-width: 1280px) 1216px, 100vw"
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 hidden bg-[linear-gradient(to_right,rgb(12_10_7/0.88)_0%,rgb(12_10_7/0.7)_50%,rgb(12_10_7/0)_85%)] xl:block"
        />
      </MediaFrame>
      <div className="mt-7 max-w-xl xl:pointer-events-none xl:absolute xl:inset-y-0 xl:left-0 xl:mt-0 xl:flex xl:flex-col xl:justify-end xl:p-16">
        <div className="xl:pointer-events-auto">
          <Eyebrow>{eyebrow}</Eyebrow>
          <h3 id={id} className={cn(typeScale.feature, "mt-4 text-pub-fg")}>
            {title}
          </h3>
          <p className={cn(typeScale.body, "mt-3 max-w-[30rem] text-pub-muted xl:line-clamp-4 xl:text-white/80")}>{body}</p>
          {actions && <Actions className="mt-7">{actions}</Actions>}
        </div>
      </div>
    </article>
  );
}
