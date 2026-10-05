import Link from "next/link";
import { cn } from "@/lib/utils";
import { containers, typeScale } from "../kit/tokens";

const ITEMS = [
  { key: "restaurant", label: "Restaurant", note: "Breakfast to dinner", href: "/restaurant" },
  { key: "room-service", label: "Room service", note: "In your room", href: "/restaurant#room-service" },
  { key: "drinks", label: "Drinks", note: "At the bar", href: "/bar" },
] as const;

export type DiningPlace = (typeof ITEMS)[number]["key"];

/**
 * Restaurant · Room service · Drinks — the dining pages' own small navigation, a quiet band right
 * under the hero (not sticky: the site header is the only bar that follows the page).
 */
export function DiningNav({ active }: { active: DiningPlace }) {
  return (
    <nav aria-label="Dining" data-tone="night" className="relative bg-night text-pub-fg">
      <ul className={cn(containers.wide, "grid grid-cols-3")}>
        {ITEMS.map((item, i) => {
          const current = item.key === active;
          return (
            <li key={item.key} className={cn("min-w-0 border-t border-pub-line", i > 0 && "border-l")}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "group relative flex min-h-16 flex-col justify-center gap-1.5 px-2 py-4 text-center transition-colors duration-200 sm:min-h-20 sm:px-6 sm:text-left motion-reduce:transition-none",
                  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold",
                  // A gold rule on the top edge marks where you are (grows in on hover elsewhere).
                  "before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:origin-left before:bg-gold before:transition-transform before:duration-300 before:ease-pub motion-reduce:before:transition-none",
                  current ? "before:scale-x-100" : "before:scale-x-0 hover:before:scale-x-100",
                )}
              >
                <span className={cn("font-display text-[1.125rem] leading-none sm:text-[1.5rem]", current ? "text-gold" : "text-pub-fg group-hover:text-gold")}>
                  {item.label}
                </span>
                <span className={cn(typeScale.meta, "hidden text-pub-muted sm:block")}>{item.note}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
