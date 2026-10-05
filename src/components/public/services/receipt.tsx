"use client";

import { useEffect, useRef } from "react";
import { CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { InfoList, type InfoItem } from "../kit/info-list";
import { surface, typeScale } from "../kit/tokens";
import { Eyebrow } from "../kit/typography";

/**
 * What a guest sees once a request is in (meeting room, transport): a calm receipt — the
 * reference first, the details as hairline rows, then the next step. It takes focus when it
 * appears and scrolls itself into view under the fixed header (the long form it replaces is gone).
 */
export function Receipt({
  eyebrow,
  title,
  line,
  rows,
  note,
  actions,
  className,
}: {
  eyebrow: string;
  title: React.ReactNode;
  line: React.ReactNode;
  rows: InfoItem[];
  note?: React.ReactNode;
  actions?: React.ReactNode;
  className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus({ preventScroll: true });
    const top = el.getBoundingClientRect().top;
    if (top < 64 || top > window.innerHeight * 0.6) {
      const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
      el.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "start" });
    }
  }, []);

  return (
    <div
      ref={ref}
      tabIndex={-1}
      role="status"
      className={cn(surface.panel, "mx-auto w-full max-w-xl scroll-mt-[calc(var(--pub-header-h)+1.5rem)] outline-none", className)}
    >
      <div className="flex items-center gap-2.5">
        <CircleCheck className="size-5 shrink-0 text-pub-eyebrow" strokeWidth={1.6} aria-hidden="true" />
        <Eyebrow>{eyebrow}</Eyebrow>
      </div>
      <h3 className={cn(typeScale.feature, "mt-4 text-pub-fg")}>{title}</h3>
      <p className={cn(typeScale.body, "mt-3 text-pub-muted")}>{line}</p>
      <InfoList variant="rows" items={rows} className="mt-7" />
      {note && <p className={cn(typeScale.small, "mt-4 text-pub-muted")}>{note}</p>}
      {actions && <div className="mt-7 flex flex-wrap items-center gap-x-7 gap-y-3">{actions}</div>}
    </div>
  );
}
