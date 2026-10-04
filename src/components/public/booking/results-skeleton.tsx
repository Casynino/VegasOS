/** Shimmer placeholder while live availability is loading. */
export function ResultsSkeleton() {
  return (
    <div role="status" aria-live="polite" className="space-y-5">
      <span className="sr-only">Checking live availability…</span>
      {[0, 1, 2].map((i) => (
        <div key={i} className="grid overflow-hidden rounded-3xl bg-panel ring-1 ring-tone/[0.06] md:grid-cols-[18rem_1fr]">
          <div className="vlh-shimmer aspect-[16/10] bg-paper-deep md:aspect-auto md:min-h-56" />
          <div className="space-y-4 p-6">
            <div className="vlh-shimmer h-8 w-1/2 rounded-lg bg-paper-deep" />
            <div className="vlh-shimmer h-4 w-3/4 rounded bg-paper-deep" />
            <div className="vlh-shimmer h-4 w-2/3 rounded bg-paper-deep" />
            <div className="flex justify-between gap-4 pt-4">
              <div className="vlh-shimmer h-10 w-40 rounded-lg bg-paper-deep" />
              <div className="vlh-shimmer h-12 w-44 rounded-full bg-paper-deep" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
