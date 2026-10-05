import { ArrowUpRight, type LucideIcon } from "lucide-react";
import { cn } from "@/lib/utils";
import { typeScale } from "../kit/tokens";

export type Channel = {
  key: string;
  icon: LucideIcon;
  /** "Call", "WhatsApp", "Email". */
  label: string;
  /** What the guest sees: the number, the address, or a short line. */
  value: string;
  href: string;
  /** Opens in a new tab (WhatsApp). */
  external?: boolean;
};

/**
 * Ways to reach the hotel as hairline rows of links (phone, WhatsApp, email). "spread" (default)
 * stacks on phones and sits side by side from 640px; "stack" is always one column (a narrow
 * column beside a form). Each row is a full 44px+ target; only real settings appear.
 */
export function ChannelList({ channels, layout = "spread", className }: { channels: Channel[]; layout?: "spread" | "stack"; className?: string }) {
  if (channels.length === 0) return null;
  const spread = layout === "spread";
  return (
    <ul
      className={cn(
        "grid border-t border-pub-line",
        spread && "sm:gap-x-8",
        spread && channels.length > 1 && "sm:grid-cols-2",
        spread && channels.length > 2 && "lg:grid-cols-3",
        className,
      )}
    >
      {channels.map((c) => (
        <li key={c.key} className="min-w-0 border-b border-pub-line">
          <a
            href={c.href}
            {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            className="group flex min-h-[4.75rem] items-center gap-4 rounded-sm py-4 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold sm:py-5"
          >
            <c.icon className="size-5 shrink-0 text-pub-eyebrow" strokeWidth={1.4} aria-hidden="true" />
            <span className="min-w-0 flex-1">
              <span className={cn(typeScale.meta, "block text-pub-muted")}>{c.label}</span>
              <span className={cn("mt-1 block font-display text-[1.375rem] leading-tight text-pub-fg [overflow-wrap:anywhere]", spread && "sm:text-[1.25rem] xl:text-[1.375rem]")}>
                {c.value}
              </span>
            </span>
            <ArrowUpRight
              className="size-4 shrink-0 text-pub-faint transition duration-300 ease-pub group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-pub-eyebrow motion-reduce:transition-none"
              strokeWidth={1.6}
              aria-hidden="true"
            />
            {c.external && <span className="sr-only"> (opens in a new tab)</span>}
          </a>
        </li>
      ))}
    </ul>
  );
}
