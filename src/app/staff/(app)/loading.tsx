/** Skeleton shown while a staff page loads — mirrors the common page layout. */
export default function Loading() {
  return (
    <div className="w-full animate-pulse space-y-5 motion-reduce:animate-none" aria-busy="true" aria-label="Loading">
      <div className="h-8 w-64 rounded-lg bg-muted" />
      <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => <div key={i} className="h-28 rounded-xl bg-muted" />)}
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        {Array.from({ length: 3 }, (_, i) => <div key={i} className="h-56 rounded-xl bg-muted" />)}
      </div>
    </div>
  );
}
