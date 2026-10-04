import { cn } from "@/lib/utils";

/** Thin gold rule with a diamond — the site's recurring decorative motif. */
export function Ornament({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 160 12" className={cn("h-3 w-40 text-gold", className)} aria-hidden="true" fill="none">
      <path d="M0 6h68M92 6h68" stroke="currentColor" strokeWidth="0.75" />
      <path d="M80 1l5 5-5 5-5-5z" stroke="currentColor" strokeWidth="0.75" />
      <circle cx="80" cy="6" r="1.2" fill="currentColor" />
    </svg>
  );
}
