import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { NamedIcon } from "../icon";
import { typeScale } from "./tokens";

export type InfoItem = {
  /** Inline: the whole fact ("2 guests"). Rows/grid: the term ("Guests"). */
  label: React.ReactNode;
  /** Rows/grid: the value ("Up to 2 adults"). Ignored inline. */
  value?: React.ReactNode;
  /** Optional lucide icon name (see icon.tsx). Use sparingly. */
  icon?: string;
};

/**
 * Small, elegant facts — never a chip cloud.
 * - inline: one meta line with middots ("2 guests · King bed · 28 m²")
 * - rows: a hairline list, term left, value right (room facts, meeting room details)
 * - grid: terms over values in 2–3 columns
 */
export function InfoList({
  items,
  variant = "inline",
  cols = 3,
  className,
}: {
  items: InfoItem[];
  variant?: "inline" | "rows" | "grid";
  cols?: 2 | 3;
  className?: string;
}) {
  const list = items.filter((i) => i.label !== null && i.label !== undefined && i.label !== "");
  if (list.length === 0) return null;

  if (variant === "inline") {
    return (
      <ul className={cn(typeScale.meta, "flex flex-wrap items-center gap-x-2.5 gap-y-1 text-pub-muted", className)}>
        {list.map((item, i) => (
          <li key={i} className="inline-flex items-center gap-2.5">
            {i > 0 && (
              <span aria-hidden="true" className="text-pub-faint">
                ·
              </span>
            )}
            <span className="inline-flex items-center gap-1.5">
              {item.icon && <NamedIcon name={item.icon} className="size-3.5 text-pub-eyebrow" />}
              {item.label}
            </span>
          </li>
        ))}
      </ul>
    );
  }

  if (variant === "rows") {
    return (
      <dl className={cn("border-t border-pub-line", className)}>
        {list.map((item, i) => (
          <div key={i} className="flex items-baseline justify-between gap-6 border-b border-pub-line py-3.5">
            <dt className={cn(typeScale.meta, "flex shrink-0 items-center gap-2 text-pub-muted")}>
              {item.icon && <NamedIcon name={item.icon} className="size-4 text-pub-eyebrow" />}
              {item.label}
            </dt>
            <dd className="min-w-0 text-right text-[15px] text-pub-fg">{item.value}</dd>
          </div>
        ))}
      </dl>
    );
  }

  return (
    <dl className={cn("grid grid-cols-2 gap-x-6 gap-y-6", cols === 3 && "sm:grid-cols-3", className)}>
      {list.map((item, i) => (
        <div key={i} className="min-w-0 border-t border-pub-line pt-4">
          <dt className={cn(typeScale.meta, "flex items-center gap-2 text-pub-muted")}>
            {item.icon && <NamedIcon name={item.icon} className="size-4 text-pub-eyebrow" />}
            {item.label}
          </dt>
          <dd className="mt-2 font-display text-[1.375rem] leading-tight text-pub-fg lining-nums">{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export type FeatureItem = {
  title: React.ReactNode;
  body?: React.ReactNode;
  /** Optional lucide icon name (see icon.tsx). */
  icon?: string;
  /** Makes the whole row a link with an arrow. */
  href?: string;
};

/**
 * An editorial list instead of a grid of identical cards: hairline rows with a serif title,
 * one quiet line and an optional icon or link arrow (services, "what's included",
 * Restaurant · Room service · Drinks). 1–3 columns from 640px.
 */
export function FeatureList({
  items,
  cols = 2,
  headingLevel = 3,
  className,
}: {
  items: FeatureItem[];
  cols?: 1 | 2 | 3;
  headingLevel?: 3 | 4;
  className?: string;
}) {
  const H = headingLevel === 3 ? "h3" : "h4";
  return (
    <ul
      className={cn(
        "grid border-t border-pub-line",
        cols === 2 && "sm:grid-cols-2 sm:gap-x-10",
        cols === 3 && "sm:grid-cols-2 sm:gap-x-10 lg:grid-cols-3",
        className,
      )}
    >
      {items.map((item, i) => {
        const inner = (
          <div className="flex gap-4 py-5 sm:py-6">
            {item.icon && <NamedIcon name={item.icon} className="mt-1 size-5 shrink-0 text-pub-eyebrow" />}
            <div className="min-w-0 flex-1">
              <H className={cn(typeScale.item, "text-pub-fg")}>{item.title}</H>
              {item.body && <p className="mt-1.5 text-[15px] leading-relaxed text-pub-muted">{item.body}</p>}
            </div>
            {item.href && (
              <ArrowRight
                aria-hidden="true"
                strokeWidth={1.6}
                className="mt-1.5 size-4 shrink-0 text-pub-faint transition duration-300 ease-pub group-hover:translate-x-1 group-hover:text-pub-eyebrow motion-reduce:transition-none"
              />
            )}
          </div>
        );
        return (
          <li key={i} className="min-w-0 border-b border-pub-line">
            {item.href ? (
              <Link href={item.href} className="group block rounded-sm focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold">
                {inner}
              </Link>
            ) : (
              inner
            )}
          </li>
        );
      })}
    </ul>
  );
}
