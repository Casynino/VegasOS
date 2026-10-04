import { cn } from "@/lib/utils";

/**
 * Scroll reveals via CSS scroll-driven animations (see the public block in
 * globals.css). Pure CSS: content is always visible without JS, in browsers
 * without `animation-timeline`, and with prefers-reduced-motion.
 */
type Tag = "div" | "li" | "ul" | "ol" | "section" | "article";

export function Reveal({
  children,
  className,
  delay = 0,
  as: T = "div",
}: {
  children: React.ReactNode;
  className?: string;
  /** Kept for API compatibility; staggers the reveal range slightly. */
  delay?: number;
  as?: Tag;
}) {
  return (
    <T className={cn("vlh-reveal", className)} style={delay ? ({ "--vlh-i": Math.round(delay * 10) } as React.CSSProperties) : undefined}>
      {children}
    </T>
  );
}

export function Stagger({ children, className, as: T = "div" }: { children: React.ReactNode; className?: string; as?: Tag }) {
  return <T className={cn("vlh-stagger", className)}>{children}</T>;
}

export function StaggerItem({ children, className, as: T = "div", index = 0 }: { children: React.ReactNode; className?: string; as?: Tag; index?: number }) {
  return (
    <T className={cn("vlh-reveal", className)} style={{ "--vlh-i": index % 6 } as React.CSSProperties}>
      {children}
    </T>
  );
}
