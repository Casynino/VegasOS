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
 * Restaurant · Room service · Drinks — the dining pages' own small navigation, a smoked-glass strip
 * on the foot of the hero photograph (pass it to DiningHero `nav`). Not sticky: the site header is
 * the only bar that follows the page. Numbered like a HUD index; a gold rule marks where you are.
 */
export function DiningNav({ active }: { active: DiningPlace }) {
  return (
    <nav
      aria-label="Dining"
      className="relative border-t border-white/12 bg-[linear-gradient(to_bottom,rgb(14_11_8/0.42),rgb(14_11_8/0.78))] backdrop-blur-md"
    >
      <span aria-hidden="true" className="absolute inset-x-0 -top-px h-px bg-linear-to-r from-transparent via-gold/55 to-transparent" />
      <ul className={cn(containers.wide, "grid grid-cols-3")}>
        {ITEMS.map((item, i) => {
          const current = item.key === active;
          return (
            <li key={item.key} className={cn("min-w-0", i > 0 && "border-l border-white/12")}>
              <Link
                href={item.href}
                aria-current={current ? "page" : undefined}
                className={cn(
                  "group relative flex min-h-16 flex-col justify-center gap-1.5 px-2 py-3.5 text-center transition-colors duration-200 sm:min-h-20 sm:px-6 sm:text-left motion-reduce:transition-none",
                  "focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold",
                  // A gold rule on the top edge marks where you are (grows in on hover elsewhere).
                  "before:absolute before:inset-x-0 before:-top-px before:h-0.5 before:origin-left before:bg-gold before:shadow-[0_0_14px_rgb(227_189_106/0.7)] before:transition-transform before:duration-300 before:ease-pub motion-reduce:before:transition-none",
                  current ? "before:scale-x-100" : "before:scale-x-0 hover:before:scale-x-100",
                )}
              >
                <span className="flex items-baseline justify-center gap-2.5 sm:justify-start">
                  <span aria-hidden="true" className={cn("hidden font-mono text-[10px] tracking-[0.16em] sm:inline", current ? "text-gold" : "text-white/45")}>
                    {String(i + 1).padStart(2, "0")}
                  </span>
                  <span className={cn("font-display text-[1.125rem] leading-none sm:text-[1.5rem]", current ? "text-gold" : "text-pub-fg group-hover:text-gold")}>
                    {item.label}
                  </span>
                </span>
                <span className={cn(typeScale.meta, "hidden text-white/60 sm:block sm:pl-[1.6rem]")}>{item.note}</span>
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}
