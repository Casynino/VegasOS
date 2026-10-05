import Link from "next/link";
import { ArrowUpRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { NamedIcon } from "../icon";
import { typeScale } from "../kit/tokens";
import fx from "./fx.module.css";

export type MatrixItem = { icon?: string | null; title: string; body?: React.ReactNode; href?: string };

/**
 * The hotel's services as a drafting-sheet index (About #services): hairline rows and columns —
 * no boxes — each with a mono index, the icon in a fine ring with a dashed orbit, a serif name and
 * one line. Services with a page of their own are links (the whole cell), lit by the cursor on
 * desktop. One column on phones, two from 640px, three from 1024px.
 */
export function ServiceMatrix({ items, className }: { items: MatrixItem[]; className?: string }) {
  return (
    <ul className={cn(fx.matrix, className)}>
      {items.map((it, i) => {
        // Phones: the icon beside the words (a compact row); from 640px the icon sits above them.
        const inner = (
          <span className="grid grid-cols-[2.75rem_minmax(0,1fr)] gap-x-4 sm:block">
            <span className="flex items-start justify-between gap-4">
              <span className={fx.orbit}>
                <NamedIcon name={it.icon} className="size-[18px]" />
              </span>
              <span className="hidden pt-1 font-mono text-[10px] font-medium tracking-[0.2em] text-pub-muted sm:inline">
                {String(i + 1).padStart(2, "0")}
              </span>
            </span>
            <span className="block min-w-0">
              <span className={cn(typeScale.item, "flex items-center gap-2 pt-2 text-pub-fg sm:mt-5 sm:pt-0")}>
                {it.title}
                {it.href && (
                  <ArrowUpRight
                    aria-hidden="true"
                    strokeWidth={1.6}
                    className="size-4 shrink-0 text-pub-faint transition duration-300 ease-pub group-hover:-translate-y-0.5 group-hover:translate-x-0.5 group-hover:text-pub-eyebrow motion-reduce:transition-none"
                  />
                )}
              </span>
              {it.body && <span className="mt-1.5 block text-[14px] leading-relaxed text-pub-muted sm:mt-2 sm:text-[15px]">{it.body}</span>}
            </span>
          </span>
        );
        const pad = "block h-full px-1 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8";
        return (
          <li key={`${it.title}-${i}`} className={cn(fx.cell, "min-w-0")}>
            {it.href ? (
              <Link
                href={it.href}
                data-spotlight=""
                className={cn(
                  pad,
                  "group rounded-[2px] transition-colors duration-300 hover:bg-pub-fg/[0.025] focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-gold motion-reduce:transition-none",
                )}
              >
                {inner}
              </Link>
            ) : (
              <div className={pad}>{inner}</div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
