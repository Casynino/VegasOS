import { cn } from "@/lib/utils";
import { containers } from "../kit/tokens";
import type { PhotoCredit } from "./menu-data";

/**
 * The credit line the free licences (CC BY / BY-SA) ask for, for every stock dish or drink
 * photo a page shows. Folded away by default; one quiet line on the page.
 */
export function PhotoCredits({ credits, className }: { credits: PhotoCredit[]; className?: string }) {
  if (credits.length === 0) return null;
  return (
    <section data-tone="paper" aria-label="Photo credits" className={cn("border-t border-pub-line bg-[var(--pub-paper)] py-6 text-pub-fg sm:py-8", className)}>
      <div className={containers.default}>
        <details className="group text-xs text-pub-muted">
          <summary className="flex min-h-11 cursor-pointer list-none items-center rounded-sm font-medium leading-relaxed text-pub-muted transition-colors duration-200 hover:text-pub-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none [&::-webkit-details-marker]:hidden">
            <span>
              Photos are illustrative — dishes and drinks are served the house way.{" "}
              <span className="underline decoration-pub-line underline-offset-4 group-open:decoration-gold">Photo credits</span>
            </span>
          </summary>
          <ul className="mt-4 grid gap-x-8 gap-y-1.5 sm:grid-cols-2 lg:grid-cols-3">
            {credits.map((c) => (
              <li key={c.sourcePage} className="min-w-0 break-words leading-relaxed">
                <span className="text-pub-fg/80">{c.item}</span> —{" "}
                <a href={c.sourcePage} target="_blank" rel="noopener nofollow" className="underline-offset-2 hover:text-pub-fg hover:underline">{c.creator}</a>,{" "}
                <a href={c.licenseUrl} target="_blank" rel="noopener nofollow" className="underline-offset-2 hover:text-pub-fg hover:underline">{c.license}</a>
              </li>
            ))}
          </ul>
        </details>
      </div>
    </section>
  );
}
