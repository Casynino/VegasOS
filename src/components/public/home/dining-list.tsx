import Image from "next/image";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { motionCls, typeScale } from "../kit";

export interface DiningLink {
  title: string;
  /** One short line. */
  body: string;
  href: string;
  /** Small square photo (a dish or a drink). */
  image: string;
  /** Opening hours from the hotel settings, when set. */
  hours?: string | null;
}

/**
 * Restaurant · Room service · Drinks — the home page's dining navigation: hairline rows with a
 * small photo, a serif name, one line and an arrow (the whole row is the link). Not cards.
 */
export function DiningList({ items, note, className }: { items: DiningLink[]; note?: string; className?: string }) {
  return (
    <div className={className}>
      <ul className="border-t border-pub-line">
        {items.map((it) => (
          <li key={it.href + it.title} className="border-b border-pub-line">
            <Link
              href={it.href}
              className="group flex items-center gap-4 py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:gap-5"
            >
              <span className="relative size-16 shrink-0 overflow-hidden bg-night-raised sm:size-[4.5rem]">
                <Image src={it.image} alt="" fill sizes="72px" className={cn("object-cover", motionCls.imageZoom)} />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn(typeScale.item, "block text-pub-fg transition-colors duration-200 group-hover:text-pub-eyebrow motion-reduce:transition-none")}>
                  {it.title}
                </span>
                <span className="mt-1 line-clamp-2 text-[14px] leading-snug text-pub-muted">{it.body}</span>
                {it.hours && <span className={cn(typeScale.meta, "mt-1.5 block text-pub-muted")}>{it.hours}</span>}
              </span>
              <ArrowRight
                aria-hidden="true"
                strokeWidth={1.6}
                className="size-4 shrink-0 text-pub-faint transition duration-300 ease-pub group-hover:translate-x-1 group-hover:text-pub-eyebrow motion-reduce:transition-none"
              />
            </Link>
          </li>
        ))}
      </ul>
      {note && <p className={cn(typeScale.meta, "mt-3 text-pub-muted")}>{note}</p>}
    </div>
  );
}
