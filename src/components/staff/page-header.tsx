import type { ReactNode } from "react";
import { Inbox } from "lucide-react";

export function PageHeader({ title, description, actions, eyebrow }: { title: string; description?: ReactNode; actions?: ReactNode; eyebrow?: string }) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div className="min-w-0">
        {eyebrow && <p className="mb-1 text-[11px] font-semibold uppercase tracking-[0.18em] text-[oklch(0.55_0.1_75)]">{eyebrow}</p>}
        <h1 className="text-[clamp(1.4rem,2vw,1.75rem)] font-semibold tracking-tight">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{description}</p>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Designed empty state: explains the situation and offers the next action. */
export function EmptyState({ title, description, action, icon, compact }: {
  title: string; description?: string; action?: ReactNode; icon?: ReactNode; compact?: boolean;
}) {
  return (
    <div className={`flex flex-col items-center justify-center rounded-xl border border-dashed bg-card/50 text-center ${compact ? "px-4 py-6" : "px-6 py-14"}`}>
      <span className="mb-3 grid size-11 place-items-center rounded-full bg-muted text-muted-foreground [&_svg]:size-5">{icon ?? <Inbox />}</span>
      <p className="font-medium">{title}</p>
      {description && <p className="mt-1 max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-4">{action}</div>}
    </div>
  );
}
