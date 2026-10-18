import Link from "next/link";
import { ArrowRight, ChevronDown, CircleAlert, CircleCheck, Info, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";
import type { HealthItem, Severity } from "@/server/services/developer-health";
import { Tag, type TagTone } from "./console-ui";

/**
 * "Needs your attention" and "Good to know": one card per fact, closed by default, opened with a tap (a plain <details> — no
 * script). Each card says what it is, what it means, what to do and who does it, and links to a page that helps only when this
 * Developer may open it. Nothing here is a guess: every card comes from a fact the server just found.
 */

const LOOK: Record<Severity, { card: string; chip: string; tag: TagTone; icon: typeof Info }> = {
  fix: { card: "border-rose-500/40 bg-rose-500/[0.06]", chip: "bg-rose-500/15 text-rose-700 dark:text-rose-300", tag: "rose", icon: CircleAlert },
  look: { card: "border-amber-500/40 bg-amber-500/[0.07]", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300", tag: "amber", icon: TriangleAlert },
  info: { card: "border-border/70 bg-card", chip: "bg-sky-500/12 text-sky-700 dark:text-sky-300", tag: "sky", icon: Info },
};

function Card({ t, item }: { t: T; item: HealthItem }) {
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
        {item.link && (
          <Link href={item.link.href} className="inline-flex items-center gap-1.5 text-sm font-medium text-[oklch(0.5_0.11_75)] underline-offset-4 hover:underline dark:text-[oklch(0.84_0.11_82)]">
            {t(item.link.label.key, item.link.label.vars)}<ArrowRight className="size-3.5" aria-hidden />
          </Link>
        )}
      </div>
    </details>
  );
}

export function AttentionSection({ t, items }: { t: T; items: HealthItem[] }) {
  const need = items.filter((i) => i.severity !== "info");
  const good = items.filter((i) => i.severity === "info");
  // Side by side when both lists exist (one column each), so the page has no empty half; one list alone uses the full width in two columns.
  const two = good.length > 0;
  const list = two ? "grid gap-3" : "grid items-start gap-3 lg:grid-cols-2";
  return (
    <div className={two ? "grid items-start gap-6 lg:grid-cols-2" : "space-y-6"}>
      <section aria-labelledby="attention-title">
        <h2 id="attention-title" className="flex items-center gap-2 text-base font-semibold">
          {t("Needs your attention")}
          <span className={cn("rounded-full px-2 py-0.5 text-xs font-medium tabular-nums", need.length ? "bg-amber-500/15 text-amber-800 dark:text-amber-300" : "bg-emerald-500/12 text-emerald-700 dark:text-emerald-300")}>{need.length}</span>
        </h2>
        <p className="mb-3 mt-0.5 text-sm text-muted-foreground">{t("Checked just now. Tap a card to see what it means and what to do.")}</p>
        {need.length === 0 ? (
          <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4">
            <span className="grid size-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"><CircleCheck className="size-[18px]" aria-hidden /></span>
            <p className="text-sm font-semibold">{t("Nothing needs your attention.")}</p>
          </div>
        ) : (
          <div className={list}>{need.map((i) => <Card key={i.id} t={t} item={i} />)}</div>
        )}
      </section>

      {good.length > 0 && (
        <section aria-labelledby="good-title">
          <h2 id="good-title" className="mb-3 flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
            {t.ctx("console", "Good to know")}<span className="rounded-full bg-muted px-2 py-0.5 text-[11px] tracking-normal tabular-nums">{good.length}</span>
          </h2>
          <div className={list}>{good.map((i) => <Card key={i.id} t={t} item={i} />)}</div>
        </section>
      )}
    </div>
  );
}
