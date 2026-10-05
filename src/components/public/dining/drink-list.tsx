import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { typeScale } from "../kit/tokens";
import type { DrinkShelf } from "./menu-data";

/**
 * The bar's drinks, shelf by shelf, from the live menu: a HUD index (not cards) — the shelf number
 * in mono, the shelf in the serif, its line, how many drinks and the lowest real price. A cursor
 * light follows on desktop and a gold rule draws under the row on hover. Each row opens that
 * section of the menu (/menu#<slug>), where drinks are ordered.
 */
export function DrinkList({ shelves, className }: { shelves: DrinkShelf[]; className?: string }) {
  if (shelves.length === 0) return null;
  return (
    <ul className={cn("grid border-t border-pub-line sm:grid-cols-2 sm:gap-x-10 lg:gap-x-14", className)}>
      {shelves.map((s, i) => (
        <li key={s.slug} className="min-w-0 border-b border-pub-line">
          <Link
            href={`/menu#${s.slug}`}
            data-spotlight=""
            className="group relative flex items-start gap-4 rounded-sm py-6 [--spot-r:14rem] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:gap-5 sm:py-7"
          >
            <span aria-hidden="true" className="w-6 shrink-0 pt-2 font-mono text-[11px] tracking-[0.16em] text-pub-eyebrow">
              {String(i + 1).padStart(2, "0")}
            </span>
            <span className="min-w-0 flex-1">
              <h3 className={cn(typeScale.subheading, "text-pub-fg transition-colors duration-200 group-hover:text-pub-eyebrow motion-reduce:transition-none")}>
                {s.name}
              </h3>
              {s.description && <p className="mt-1.5 text-[15px] leading-relaxed text-pub-muted">{s.description}</p>}
              <p className="mt-3 flex flex-wrap items-center gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.14em] text-pub-muted">
                <span>
                  <span className="text-pub-fg">{String(s.count).padStart(2, "0")}</span> {s.count === 1 ? "drink" : "drinks"}
                </span>
                <span aria-hidden="true" className="h-px w-4 bg-pub-line" />
                <span>
                  From TZS <span className="text-pub-fg">{formatNumber(s.from)}</span>
                </span>
              </p>
            </span>
            <span
              aria-hidden="true"
              className="mt-1 grid size-10 shrink-0 place-items-center rounded-full border border-pub-line text-pub-faint transition duration-300 ease-pub group-hover:border-gold group-hover:text-pub-eyebrow motion-reduce:transition-none"
            >
              <ArrowRight strokeWidth={1.6} className="size-4 transition-transform duration-300 ease-pub group-hover:translate-x-0.5 motion-reduce:transition-none" />
            </span>
            <span
              aria-hidden="true"
              className="absolute inset-x-0 -bottom-px h-px origin-left scale-x-0 bg-linear-to-r from-gold via-gold/60 to-transparent transition-transform duration-500 ease-pub group-hover:scale-x-100 motion-reduce:transition-none"
            />
          </Link>
        </li>
      ))}
    </ul>
  );
}
