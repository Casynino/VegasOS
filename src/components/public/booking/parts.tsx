import { AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Small shared pieces of the booking screens (server- and client-safe, no hooks).
 */

const shortDate = new Intl.DateTimeFormat("en-GB", { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });

/** "2026-10-10" → "Sat 10 Oct" (business dates are plain calendar days). */
export function formatDay(date: string) {
  return shortDate.format(new Date(`${date}T00:00:00Z`));
}

/** "2 adults, 1 child". */
export function guestsLabel(adults: number, children: number) {
  return `${adults} adult${adults === 1 ? "" : "s"}${children ? `, ${children} child${children === 1 ? "" : "ren"}` : ""}`;
}

/**
 * A calm notice for problems in a form or a flow: a hairline frame tinted with the error
 * colour, an icon, one line of title and the detail. Follows the surrounding tone.
 */
export function Notice({ title, children, className, alert = true }: { title?: React.ReactNode; children?: React.ReactNode; className?: string; alert?: boolean }) {
  return (
    <div
      role={alert ? "alert" : undefined}
      className={cn("flex gap-3 rounded-[0.75rem] border border-pub-error/35 bg-pub-error/[0.06] p-4 text-[14px] leading-relaxed text-pub-fg", className)}
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0 text-pub-error" strokeWidth={1.8} aria-hidden="true" />
      <div className="min-w-0">
        {title && <p className="font-medium">{title}</p>}
        {children && <div className={cn(title && "mt-1", "text-pub-muted")}>{children}</div>}
      </div>
    </div>
  );
}
