import { cn } from "@/lib/utils";

export type HeadlinePart = { text: string; accent?: boolean };

/**
 * Headline whose words rise out of a mask one after another. Pure CSS (runs
 * from first paint, no JS) and disabled with prefers-reduced-motion.
 */
export function WordReveal({ parts, className, startDelay = 150 }: { parts: HeadlinePart[]; className?: string; startDelay?: number }) {
  let i = 0;
  return (
    <span className={className}>
      {parts.map((part, pi) =>
        part.text.split(/\s+/).filter(Boolean).map((word, wi) => {
          const delay = startDelay + i++ * 90;
          return (
            <span key={`${pi}-${wi}`} className="inline-block overflow-hidden pb-[0.08em] align-bottom">
              <span
                className={cn(
                  "inline-block motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-full motion-safe:fill-mode-both motion-safe:duration-1000 motion-safe:ease-out",
                  part.accent && "italic text-gold",
                )}
                style={{ animationDelay: `${delay}ms` }}
              >
                {word}
              </span>
              {" "}
            </span>
          );
        }),
      )}
    </span>
  );
}
