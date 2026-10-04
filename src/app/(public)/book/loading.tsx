import { ResultsSkeleton } from "@/components/public/booking/results-skeleton";
import { container, cream } from "@/components/public/ui";
import { cn } from "@/lib/utils";

export default function BookLoading() {
  return (
    <div className={cn(cream, "flex-1")}>
      <div className="bg-[#15120e]">
        <div className={cn(container, "space-y-4 pb-16 pt-16")}>
          <div className="h-3 w-28 rounded bg-white/10" />
          <div className="h-12 w-72 max-w-full rounded-lg bg-white/10" />
        </div>
      </div>
      <div className={cn(container, "pb-20 pt-10")}>
        <div className="vlh-shimmer mb-8 h-20 rounded-3xl bg-panel" />
        <ResultsSkeleton />
      </div>
    </div>
  );
}
