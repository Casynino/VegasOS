import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { MediaFrame } from "../kit/media-frame";
import { typeScale } from "../kit/tokens";

/**
 * One experience in a rail ("More than a room"): a portrait photo, a serif name, one line, an
 * optional real fact (a price, a capacity) and where it leads. The name is the link and stretches
 * over the whole tile, so screen readers hear one short link and the photo zooms on hover.
 */
export function ExperienceTile({
  href,
  image,
  title,
  body,
  fact,
  cta,
  focal,
  headingLevel = 3,
}: {
  href: string;
  image: { src: string; alt: string };
  title: string;
  body: React.ReactNode;
  fact?: React.ReactNode;
  /** The visual call to action under the tile ("Visit the bar"). */
  cta: string;
  focal?: string;
  headingLevel?: 3 | 4;
}) {
  const H = headingLevel === 3 ? "h3" : "h4";
  return (
    <article className="group relative flex h-full flex-col">
      <MediaFrame
        src={image.src}
        alt={image.alt}
        ratio="4/5"
        focal={focal}
        zoom
        sizes="(min-width: 1024px) 22vw, (min-width: 640px) 44vw, 76vw"
      />
      <H className={cn(typeScale.item, "mt-5 text-pub-fg")}>
        <Link
          href={href}
          className="after:absolute after:inset-0 after:z-10 after:rounded-sm focus-visible:outline-none focus-visible:after:outline-2 focus-visible:after:outline-offset-4 focus-visible:after:outline-gold"
        >
          {title}
        </Link>
      </H>
      <p className="mt-2 text-[15px] leading-relaxed text-pub-muted">{body}</p>
      {fact && <p className={cn(typeScale.meta, "mt-3 text-pub-eyebrow")}>{fact}</p>}
      <span
        aria-hidden="true"
        className={cn(
          typeScale.cta,
          "mt-auto inline-flex items-center gap-2 pt-5 text-pub-fg transition-colors duration-200 group-hover:text-pub-eyebrow motion-reduce:transition-none",
        )}
      >
        {cta}
        <ArrowRight
          className="size-4 transition-transform duration-300 ease-pub group-hover:translate-x-0.5 motion-reduce:transition-none"
          strokeWidth={1.6}
        />
      </span>
    </article>
  );
}
