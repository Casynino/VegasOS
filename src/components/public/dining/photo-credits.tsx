import { cn } from "@/lib/utils";
import { Atmosphere } from "../kit/atmosphere";
import { containers } from "../kit/tokens";
import type { PhotoCredit } from "./menu-data";

/**
 * The credit line the free licences (CC BY / BY-SA) ask for, for every stock dish or drink
 * photo a page shows. Folded away by default. As a band, it continues the tone of the band above
 * (default "deep", so it never adds a seam of its own before the footer); `bare` renders just the
 * line, for the foot of a page's last band (pass a backing for the open list over a photo).
 */
export function PhotoCredits({
  credits,
  tone = "deep",
  bare = false,
  className,
}: {
  credits: PhotoCredit[];
  tone?: "paper" | "deep";
  bare?: boolean;
  className?: string;
}) {
  if (credits.length === 0) return null;
  const line = (
    <details className={cn("group text-xs text-pub-muted", bare && className)}>
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
  );
  if (bare) return line;
  return (
    <section
      data-tone={tone}
      aria-label="Photo credits"
      className={cn("relative isolate overflow-hidden pb-6 pt-2 text-pub-fg sm:pb-8", tone === "deep" ? "bg-[var(--pub-paper-deep)]" : "bg-[var(--pub-paper)]", className)}
    >
      <Atmosphere tone={tone} atmosphere="calm" beam={false} pattern="none" />
      <div className={containers.default}>{line}</div>
    </section>
  );
}
