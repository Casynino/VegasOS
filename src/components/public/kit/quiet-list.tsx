import { BedDouble, Car, Clock, ConciergeBell, Coffee, Plane, Presentation, UtensilsCrossed, Wifi, Wine, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";

/** A fitting small icon for an offer line ("Free Wi-Fi" → Wi-Fi), or none. */
const ICONS: [RegExp, LucideIcon][] = [
  [/wi-?fi/i, Wifi],
  [/24|reception/i, Clock],
  [/breakfast|coffee/i, Coffee],
  [/room service|service/i, ConciergeBell],
  [/parking|car\b/i, Car],
  [/airport|pickup|transfer/i, Plane],
  [/meeting/i, Presentation],
  [/restaurant|dining|menu/i, UtensilsCrossed],
  [/\bbar\b|drinks?/i, Wine],
  [/room|suite/i, BedDouble],
];
const iconFor = (text: string) => ICONS.find(([re]) => re.test(text))?.[1] ?? null;

/**
 * What the hotel offers, said quietly (owner, 2026-10-05: the big sliding words were "too big" on phone and computer):
 * small words with a tiny gold icon, standing still — one neat line on computers, a tidy two-column grid on phones.
 * `icons={false}` for plain lists (dishes, drinks) — then small words with gold dots between them.
 */
export function QuietList({ items, icons = true, label, className }: { items: string[]; icons?: boolean; label?: string; className?: string }) {
  if (!items.length) return null;
  return (
    <ul aria-label={label}
      className={cn(
        icons
          ? "grid grid-cols-2 gap-x-4 gap-y-3 sm:flex sm:flex-wrap sm:justify-center sm:gap-x-8 sm:gap-y-3"
          : "flex flex-wrap justify-center gap-x-3 gap-y-2",
        "text-[13px] leading-snug text-pub-muted sm:text-[13.5px]",
        className,
      )}>
      {items.map((text, i) => {
        const Icon = icons ? iconFor(text) : null;
        return (
          <li key={text} className="flex min-w-0 items-center gap-2">
            {!icons && i > 0 && <span aria-hidden="true" className="size-1 shrink-0 rounded-full bg-gold/70" />}
            {Icon && <Icon className="size-4 shrink-0 text-gold" strokeWidth={1.6} aria-hidden="true" />}
            <span className="min-w-0">{text}</span>
          </li>
        );
      })}
    </ul>
  );
}
