import { cn } from "@/lib/utils";
import { typeScale } from "../kit/tokens";
import s from "./dining.module.css";

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * The meals of the day as a fine HUD timeline: a hairline rail with gold nodes, the meal in the
 * serif and its number in mono; one soft light travels down the rail while it is on screen. The
 * meals come from the CMS (pages.restaurant.meals), any length; `two` splits long lists in two
 * columns from 640px.
 */
export function DayTimeline({ items, className }: { items: string[]; className?: string }) {
  if (items.length === 0) return null;
  const two = items.length > 4;
  const half = Math.ceil(items.length / 2);
  const cols = two ? [items.slice(0, half), items.slice(half)] : [items];
  return (
    <div className={cn("grid gap-x-10", two && "sm:grid-cols-2", className)}>
      {cols.map((list, c) => (
        <ol key={c} start={c * half + 1} className="relative">
          <span aria-hidden="true" data-live-watch="" suppressHydrationWarning className={s.rail} />
          {list.map((m, i) => (
            <li key={m} className="relative flex items-baseline gap-4 py-3 pl-8">
              <span aria-hidden="true" className={s.node} />
              <span className={cn(typeScale.item, "min-w-0 flex-1 text-pub-fg")}>{m}</span>
              <span aria-hidden="true" className="font-mono text-[10px] tracking-[0.18em] text-pub-faint">{pad(c * half + i + 1)}</span>
            </li>
          ))}
        </ol>
      ))}
    </div>
  );
}
