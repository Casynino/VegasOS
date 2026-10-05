import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { typeScale } from "../kit/tokens";
import type { DrinkShelf } from "./menu-data";

/**
 * The bar's drinks, shelf by shelf, from the live menu: a hairline list (not cards) — the shelf in
 * the serif, its line, how many drinks and the lowest real price. Each row opens that section of
 * the menu (/menu#<slug>), where drinks are ordered.
 */
export function DrinkList({ shelves, className }: { shelves: DrinkShelf[]; className?: string }) {
  if (shelves.length === 0) return null;
  return (
    <ul className={cn("grid border-t border-pub-line sm:grid-cols-2 sm:gap-x-10 lg:gap-x-14", className)}>
      {shelves.map((s) => (
        <li key={s.slug} className="min-w-0 border-b border-pub-line">
          <Link
            href={`/menu#${s.slug}`}
            className="group flex items-start gap-5 rounded-sm py-6 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:py-7"
          >
            <span className="min-w-0 flex-1">
              <h3 className={cn(typeScale.item, "text-pub-fg transition-colors duration-200 group-hover:text-pub-eyebrow motion-reduce:transition-none")}>
                {s.name}
              </h3>
              {s.description && <p className="mt-1.5 text-[15px] leading-relaxed text-pub-muted">{s.description}</p>}
              <p className={cn(typeScale.meta, "mt-3 text-pub-muted")}>
                {s.count} {s.count === 1 ? "drink" : "drinks"}
                <span aria-hidden="true" className="px-2 text-pub-faint">·</span>
                From TZS <span className="text-pub-fg">{formatNumber(s.from)}</span>
              </p>
            </span>
            <ArrowRight
              aria-hidden="true"
              strokeWidth={1.6}
              className="mt-2 size-4 shrink-0 text-pub-faint transition duration-300 ease-pub group-hover:translate-x-1 group-hover:text-pub-eyebrow motion-reduce:transition-none"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
