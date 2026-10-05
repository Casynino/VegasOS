import { cn } from "@/lib/utils";
import { typeScale } from "../kit/tokens";

/**
 * "What happens next" as a short ordered hairline list: a gold step number, a serif line and one
 * sentence each. For two to four steps — never a row of numbered cards.
 */
export function Steps({
  items,
  headingLevel = 3,
  className,
}: {
  items: { title: string; body: React.ReactNode }[];
  headingLevel?: 3 | 4;
  className?: string;
}) {
  const H = headingLevel === 3 ? "h3" : "h4";
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
