import { ChevronDown, CircleCheck, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";
import type { CheckResult } from "@/server/services/developer-checks";
import type { HealthItem } from "@/server/services/developer-health";
import { AttentionList, type AttentionRow } from "./attention-list";

/**
 * "NEEDS YOUR ATTENTION" — ONE panel, copied from the owner's ORA console (2026-10-18: "it should be exactly like that"):
 * a title with "Checked just now…" under it and the verdict at the right ("All clear" / "2 to fix now"); inside, either ONE quiet line
 * ("Nothing needs your attention") or the problems as a compact list (attention-list.tsx: one line each, a tap opens what it means, what to do and who does it); and under it a closed
 * row, "What was checked · 29 of 31 fine, 2 not checked yet", that opens to every check: what could not be checked first, then the fine
 * ones, each with its short result. A problem is written once (in the compact list), never again in the checks. Server component: a plain <details>.
 */

function Verdict({ t, fix, look }: { t: T; fix: number; look: number }) {
  const [text, tone] = fix > 0 ? [t("{n} to fix now", { n: fix }), "text-rose-500"] : look > 0 ? [t("{n} to look at", { n: look }), "text-amber-500"] : [t("All clear"), "text-emerald-500"];
  return <span className={cn("shrink-0 pt-0.5 text-sm font-medium", tone)}>{text}</span>;
}

function Row({ icon: Icon, iconTone, title, summary, hover, status }: {
  icon: typeof Info; iconTone: string; title: string; summary: string; hover?: string; status: { text: string; pill: boolean; tone?: string };
}) {
  return (
    <li title={hover} className="flex items-center gap-3 px-5 py-3 sm:px-6">
      <Icon className={cn("size-[18px] shrink-0", iconTone)} aria-hidden />
      <span className="min-w-0 flex-1 leading-snug">
        <span className="block text-sm text-foreground">{title}</span>
        <span className="block text-xs text-muted-foreground">{summary}</span>
      </span>
      <span className={cn("shrink-0 text-xs font-medium", status.pill ? "rounded-full bg-muted px-3 py-1 text-foreground/80" : status.tone)}>{status.text}</span>
    </li>
  );
}

export function AttentionPanel({ t, items, checks }: { t: T; items: HealthItem[]; checks: CheckResult[] }) {
  const need = items.filter((i) => i.severity !== "info");
  // The problems as plain rows for the list (translated here, on the server): the check's group tells which chip a row sits under.
  const groupOf = new Map(checks.map((c) => [c.id, t.ctx("check-group", c.group)]));
  const rows: AttentionRow[] = need.map((i) => ({
    id: i.id, severity: i.severity === "fix" ? "fix" : "look",
    title: t(i.title.key, i.title.vars), summary: t(i.summary.key, i.summary.vars), what: t(i.what.key, i.what.vars), todo: t(i.todo.key, i.todo.vars),
    who: i.who ? t(i.who.key, i.who.vars) : null, examples: i.examples ?? [],
    link: i.link ? { href: i.link.href, label: t(i.link.label.key, i.link.label.vars) } : null,
    group: groupOf.get(i.id) ?? t("System"),
  }));
  const fixN = need.filter((i) => i.severity === "fix").length;
  const lookN = need.length - fixN;
  // Good to know: facts that are not checks (the "could not be run" fact is the "not checked yet" rows below).
  const facts = items.filter((i) => i.severity === "info" && i.id !== "checks-unknown");
  // A check that did not apply here or only follows from another problem is NOT "fine": it is "not checked yet".
  const fine = checks.filter((c) => c.state === "ok" && !c.skipped);
  const notChecked = checks.filter((c) => c.state === "unknown" || (c.state === "ok" && c.skipped));
  const summary = [t("{ok} of {n} fine", { ok: fine.length, n: checks.length }), ...(notChecked.length > 0 ? [t("{n} not checked yet", { n: notChecked.length })] : [])].join(", ");

  return (
    <section aria-labelledby="attention-title" className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="flex items-start justify-between gap-4 px-5 py-4 sm:px-6">
        <div className="min-w-0">
          <h2 id="attention-title" className="text-base font-semibold">{t("Needs your attention")}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">{t("Checked just now. Tap a card to see what it means and what to do.")}</p>
        </div>
        <Verdict t={t} fix={fixN} look={lookN} />
      </header>

      {need.length === 0 ? (
        <div className="flex items-center gap-4 border-t border-border/60 px-5 py-4 sm:px-6">
          <span className="grid size-11 shrink-0 place-items-center rounded-full bg-emerald-500/12 text-emerald-600 dark:text-emerald-400"><CircleCheck className="size-5" aria-hidden /></span>
          <p className="leading-snug"><span className="block text-sm font-semibold">{t("Nothing needs your attention")}</span><span className="block text-sm text-muted-foreground">{t("Nothing is broken, and every required setting is in place.")}</span></p>
        </div>
      ) : (
        <AttentionList
          rows={rows}
          labels={{ all: t("All"), whatItMeans: t("What it means"), whatToDo: t("What to do"), whoFixes: t("Who fixes it"), whereToLook: t("Where to look"), scrollMore: t("scroll for {n} more", { n: "{n}" }) }}
        />
      )}

      {checks.length === 0 ? (
        <p className="border-t border-border/60 px-5 py-3 text-sm text-muted-foreground sm:px-6">{t("The checks could not be run just now.")}</p>
      ) : (
        <details id="problems" className="group border-t border-border/60">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3 text-sm marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold sm:px-6 [&::-webkit-details-marker]:hidden">
            <span className="min-w-0 flex-1">{t("What was checked")} · {summary}</span>
            <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul className="divide-y divide-border/60 border-t border-border/60">
            {notChecked.map((c) => (
              <Row key={c.id} icon={Info} iconTone="text-muted-foreground" title={t(c.title.key, c.title.vars)} summary={t(c.summary.key, c.summary.vars)} hover={t(c.what.key, c.what.vars)} status={{ text: t("Not checked yet"), pill: true }} />
            ))}
            {fine.map((c) => (
              <Row key={c.id} icon={CircleCheck} iconTone="text-emerald-600 dark:text-emerald-400" title={t(c.title.key, c.title.vars)} summary={t(c.summary.key, c.summary.vars)} hover={t(c.what.key, c.what.vars)} status={{ text: t("Fine"), pill: false, tone: "text-emerald-600 dark:text-emerald-400" }} />
            ))}
            {facts.map((i) => (
              <Row key={i.id} icon={Info} iconTone="text-sky-600 dark:text-sky-400" title={t(i.title.key, i.title.vars)} summary={t(i.summary.key, i.summary.vars)} hover={t(i.what.key, i.what.vars)} status={{ text: t.ctx("console", "Good to know"), pill: true }} />
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}

