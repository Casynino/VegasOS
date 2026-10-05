import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Channel } from "./channel-list";

/**
 * Ways to reach the hotel as glass cards floating over the photograph (Contact hero): call,
 * WhatsApp, email — only what is set in Settings. Compact rows on phones (the whole card is the
 * 44px+ target), three across from 768px. The cursor lights each card's edge on desktop.
 */
export function ChannelCards({ channels, className }: { channels: Channel[]; className?: string }) {
  if (channels.length === 0) return null;
  return (
    <ul
      className={cn(
        "grid gap-2.5 sm:gap-3",
        channels.length > 1 && "md:grid-cols-2",
        channels.length > 2 && "lg:grid-cols-3",
        className,
      )}
    >
      {channels.map((c) => (
        <li key={c.key} className="min-w-0">
          <a
            href={c.href}
            {...(c.external ? { target: "_blank", rel: "noopener noreferrer" } : {})}
            data-spotlight="border"
            className="pub-glass group flex min-h-16 items-center gap-4 rounded-[0.875rem] px-4 py-3 text-pub-fg transition-[translate,background-color] duration-300 ease-pub hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-3 focus-visible:outline-gold motion-reduce:transition-none motion-reduce:hover:translate-y-0 sm:px-5 sm:py-4"
          >
            <span aria-hidden="true" className="grid size-10 shrink-0 place-items-center rounded-full border border-gold/45 text-gold shadow-[0_0_20px_-6px_rgb(227_189_106/0.6)]">
              <c.icon className="size-[18px]" strokeWidth={1.5} />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block font-mono text-[10px] font-medium uppercase leading-none tracking-[0.2em] text-white/65">{c.label}</span>
              <span className="mt-1.5 block font-display text-[1.25rem] leading-tight text-white [overflow-wrap:break-word] sm:text-[1.375rem]">
                {/* An email address may wrap after the "@", never mid-word. */}
                {c.value.includes("@") ? (
                  <>
                    {c.value.slice(0, c.value.indexOf("@") + 1)}
                    <wbr />
                    {c.value.slice(c.value.indexOf("@") + 1)}
                  </>
                ) : (
                  c.value
                )}
              </span>
            </span>
            <ArrowUpRight
              aria-hidden="true"
              strokeWidth={1.6}
              className="size-4 shrink-0 text-white/50 transition duration-300 ease-pub group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-gold motion-reduce:transition-none"
            />
            {c.external && <span className="sr-only"> (opens in a new tab)</span>}
          </a>
        </li>
      ))}
    </ul>
  );
}
