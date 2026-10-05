import { cn } from "@/lib/utils";
import { typeScale } from "../kit/tokens";

/**
 * "What happens next" as a short ordered hairline list: a step number, a serif line and one
 * sentence each. For two to four steps — never a row of numbered cards.
 * layout "list" (default): stacked hairline rows. "track": a HUD process track — from 768px the
 * steps sit side by side on one gold line with a node at each step (stacked on phones, with the
 * line running down the left).
 */
export function Steps({
  items,
  headingLevel = 3,
  layout = "list",
  className,
}: {
  items: { title: string; body: React.ReactNode }[];
  headingLevel?: 3 | 4;
  layout?: "list" | "track";
  className?: string;
}) {
  const H = headingLevel === 3 ? "h3" : "h4";
  if (layout === "track") {
    return (
      <ol className={cn("relative grid gap-8 md:gap-10", items.length === 3 ? "md:grid-cols-3" : "md:grid-cols-2 lg:grid-cols-4", className)}>
        {/* The line: down the left on phones, across the top from 768px. */}
        <span aria-hidden="true" className="absolute bottom-2 left-[0.6875rem] top-2 w-px bg-linear-to-b from-pub-eyebrow/70 via-pub-line to-transparent md:hidden" />
        <span aria-hidden="true" className="absolute left-0 right-0 top-[0.6875rem] hidden h-px bg-linear-to-r from-pub-eyebrow/70 via-pub-line to-transparent md:block" />
        {items.map((s, i) => (
          <li key={s.title} className="relative grid grid-cols-[1.375rem_minmax(0,1fr)] gap-x-4 md:block">
            <span aria-hidden="true" className="relative z-[1] grid size-[1.375rem] place-items-center rounded-full border border-pub-eyebrow/60 bg-night shadow-[0_0_16px_-4px_rgb(227_189_106/0.7)]">
              <span className="size-1.5 rounded-full bg-gold" />
            </span>
            <div className="min-w-0 md:mt-6 md:pr-6">
              <p aria-hidden="true" className="font-mono text-[10px] font-medium tracking-[0.2em] text-pub-eyebrow">
                STEP {String(i + 1).padStart(2, "0")}
              </p>
              <H className={cn(typeScale.item, "mt-2 text-pub-fg")}>{s.title}</H>
              <p className="mt-2 text-[15px] leading-relaxed text-pub-muted">{s.body}</p>
            </div>
          </li>
        ))}
      </ol>
    );
  }
  return (
    <ol className={cn("border-t border-pub-line", className)}>
      {items.map((s, i) => (
        <li key={s.title} className="grid grid-cols-[1.75rem_minmax(0,1fr)] gap-x-3 border-b border-pub-line py-5">
          <span aria-hidden="true" className="font-display text-[1.375rem] leading-none text-pub-eyebrow lining-nums">
            {i + 1}
          </span>
          <div className="min-w-0">
            <H className={cn(typeScale.item, "text-pub-fg")}>{s.title}</H>
            <p className="mt-1.5 text-[15px] leading-relaxed text-pub-muted">{s.body}</p>
          </div>
        </li>
      ))}
    </ol>
  );
}
