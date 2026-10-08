import { AlertCircle } from "lucide-react";
import { englishT, type T } from "@/i18n/translate";
import { cn } from "@/lib/utils";

/**
 * Small shared pieces of the booking screens (server- and client-safe, no hooks). The helpers take the person's
 * translator (`await getT()` on the server, `useT()` in the browser); without one they answer in English.
 */

/** "2026-10-10" → "Sat 10 Oct" / "10月10日周六" (business dates are plain calendar days). */
export function formatDay(date: string, t: T = englishT) {
  return t.dayMonth(date);
}

/** "2 adults, 1 child". */
export function guestsLabel(adults: number, children: number, t: T = englishT) {
  const a = t.plural(adults, "{n} adult", "{n} adults");
  return children ? t("{adults}, {children}", { adults: a, children: t.plural(children, "{n} child", "{n} children") }) : a;
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
