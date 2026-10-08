"use client";

import { useEffect, useRef } from "react";
import { CircleCheck } from "lucide-react";
import { cn } from "@/lib/utils";
import { useT } from "@/i18n/client";
import { InfoList, type InfoItem } from "../kit/info-list";
import { HudLabel } from "../kit/hud";
import { typeScale } from "../kit/tokens";
import { Eyebrow } from "../kit/typography";
import fx from "./fx.module.css";

/**
 * What a guest sees once a request is in (meeting room, transport): a calm receipt on smoked glass —
 * the reference first, the details as hairline rows under a ticket perforation, then the next step.
 * It takes focus when it appears and scrolls itself into view under the fixed header (the long form it replaces is gone).
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
  const t = useT();
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
      data-tone="night"
      className={cn(fx.console, "mx-auto w-full max-w-xl scroll-mt-[calc(var(--pub-header-h)+1.5rem)] p-6 text-pub-fg outline-none sm:p-8", className)}
    >
      <div className="flex items-center justify-between gap-4">
        <div className="flex items-center gap-2.5">
          <CircleCheck className="size-5 shrink-0 text-pub-eyebrow" strokeWidth={1.6} aria-hidden="true" />
          <Eyebrow>{eyebrow}</Eyebrow>
        </div>
        <HudLabel tick={false} className="hidden sm:inline-flex">{t("Reference kept")}</HudLabel>
      </div>
      <h3 className={cn(typeScale.feature, "mt-4 text-pub-fg")}>{title}</h3>
      <p className={cn(typeScale.body, "mt-3 text-pub-muted")}>{line}</p>
      <div aria-hidden="true" className={cn(fx.perf, "mt-7 [--perf-pad:1.5rem] sm:[--perf-pad:2rem]")} />
      <InfoList variant="rows" items={rows} className="mt-7" />
      {note && <p className={cn(typeScale.small, "mt-4 text-pub-muted")}>{note}</p>}
      {actions && <div className="mt-7 flex flex-wrap items-center gap-x-7 gap-y-3">{actions}</div>}
    </div>
  );
}
