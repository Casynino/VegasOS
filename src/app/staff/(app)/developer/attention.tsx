import Link from "next/link";
import { ArrowRight, ChevronDown, CircleAlert, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";
import type { HealthItem, Severity } from "@/server/services/developer-health";
import { Tag, type TagTone } from "./console-ui";

/**
 * One card per problem for the "Needs your attention" panel (attention-panel.tsx), closed by default, opened with a tap (a plain <details> — no
 * script). Each card says what it is, what it means, what to do and who does it, and links to a page that helps only when this
 * Developer may open it. Nothing here is a guess: every card comes from a fact the server just found.
 */

const LOOK: Record<Severity, { card: string; chip: string; tag: TagTone; icon: typeof Info }> = {
  fix: { card: "border-rose-500/40 bg-rose-500/[0.06]", chip: "bg-rose-500/15 text-rose-700 dark:text-rose-300", tag: "rose", icon: CircleAlert },
  look: { card: "border-amber-500/40 bg-amber-500/[0.07]", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300", tag: "amber", icon: TriangleAlert },
  info: { card: "border-border/70 bg-card", chip: "bg-sky-500/12 text-sky-700 dark:text-sky-300", tag: "sky", icon: Info },
};

export function Card({ t, item }: { t: T; item: HealthItem }) {
  const l = LOOK[item.severity];
  const Icon = l.icon;
  const word = item.severity === "fix" ? t("Fix now") : item.severity === "look" ? t("Look at it") : t.ctx("console", "Good to know");
  return (
    <details className={cn("group min-w-0 rounded-2xl border shadow-[0_1px_2px_rgba(15,23,42,0.03)]", l.card)}>
      <summary className="flex cursor-pointer list-none items-center gap-3 rounded-2xl p-3.5 marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:p-4 [&::-webkit-details-marker]:hidden">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", l.chip)}><Icon className="size-[18px]" aria-hidden /></span>
        <span className="min-w-0 flex-1 leading-snug">
          <span className="block text-sm font-semibold text-foreground">{t(item.title.key, item.title.vars)}</span>
          <span className="mt-0.5 block text-xs text-muted-foreground">{t(item.summary.key, item.summary.vars)}</span>
        </span>
        <Tag tone={l.tag} className="hidden sm:inline-flex">{word}</Tag>
        <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
      </summary>
      <div className="space-y-3 border-t border-border/60 px-4 pb-4 pt-3 text-sm">
        <Tag tone={l.tag} className="sm:hidden">{word}</Tag>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("What it means")}</p>
          <p className="mt-1 leading-relaxed text-foreground/90">{t(item.what.key, item.what.vars)}</p>
        </div>
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("What to do")}</p>
          <p className="mt-1 leading-relaxed text-foreground/90">{t(item.todo.key, item.todo.vars)}</p>
        </div>
        {item.who && (
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("Who fixes it")}</p>
            <p className="mt-1 leading-relaxed text-foreground/90">{t(item.who.key, item.who.vars)}</p>
          </div>
        )}
        {item.examples && item.examples.length > 0 && (
          <p className="text-xs text-muted-foreground">{t("Where to look")}: <span className="break-words font-mono">{item.examples.join(" · ")}</span></p>
        )}
        {item.link && (
          <Link href={item.link.href} className="inline-flex items-center gap-1.5 text-sm font-medium text-[oklch(0.5_0.11_75)] underline-offset-4 hover:underline dark:text-[oklch(0.84_0.11_82)]">
            {t(item.link.label.key, item.link.label.vars)}<ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>
    </details>
  );
}
