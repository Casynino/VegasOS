import { cn } from "@/lib/utils";

/** A quiet shimmer block that follows the tone (and is softer in the dark theme). */
export const shimmer = "vlh-shimmer bg-pub-fg/[0.07] after:opacity-60 pub-dark:after:opacity-15";

/** Shimmer placeholder while live availability is loading — the shape of the result rows. */
export function ResultsSkeleton({ rows = 3 }: { rows?: number }) {
  return (
    <div role="status" aria-live="polite" className="border-t border-pub-line">
      <span className="sr-only">Checking live availability…</span>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="grid gap-5 border-b border-pub-line py-7 sm:gap-6 sm:py-8 md:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] md:gap-10 lg:py-10">
          <div className={cn(shimmer, "aspect-[16/9] sm:aspect-[3/2] lg:aspect-[4/3]")} />
          <div className="flex flex-col gap-4">
            <div className={cn(shimmer, "h-8 w-1/2 rounded-sm")} />
            <div className={cn(shimmer, "h-3 w-2/3 rounded-sm")} />
            <div className={cn(shimmer, "h-4 w-5/6 rounded-sm")} />
            <div className="mt-auto flex items-end justify-between gap-4 border-t border-pub-line pt-5">
              <div className={cn(shimmer, "h-9 w-36 rounded-sm")} />
              <div className={cn(shimmer, "h-12 w-40 rounded-full")} />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
