import { ChevronDown, CircleCheck, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";
import type { CheckResult } from "@/server/services/developer-checks";
import type { HealthItem } from "@/server/services/developer-health";
import { AttentionList, type AttentionRow } from "./attention-list";

/**
 * "NEEDS YOUR ATTENTION" — ONE panel, copied from the owner's ORA console (2026-10-18: "it should be exactly like that"):
 * (the slim form of Target, 2026-10-18: "copy this exactly"): a small label above with the verdict at the right ("All clear" / "2 to fix now"); in one card, either ONE quiet line
 * ("Nothing needs your attention") or the problems as a compact list (attention-list.tsx: one line each, a tap opens what it means, what to do and who does it); and under it a closed
 * row, "What was checked · 29 of 31 fine, 2 not checked yet", that opens to every check: what could not be checked first, then the fine
 * ones, each with its short result. A problem is written once (in the compact list), never again in the checks. Server component: a plain <details>.
 */

function Verdict({ t, fix, look }: { t: T; fix: number; look: number }) {
  const [text, tone] = fix > 0 ? [t("{n} to fix now", { n: fix }), "text-rose-500"] : look > 0 ? [t("{n} to look at", { n: look }), "text-amber-500"] : [t("All clear"), "text-emerald-500"];
  return <span className={cn("shrink-0 text-[13px] font-medium", tone)}>{text}</span>;
}

function Row({ icon: Icon, iconTone, title, summary, hover, status }: {
  icon: typeof Info; iconTone: string; title: string; summary: string; hover?: string; status: { text: string; pill: boolean; tone?: string };
}) {
  return (
    <li title={hover} className="flex items-center gap-3 px-4 py-2.5">
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
  // The problems as plain rows for the list (translated here, on the server).
  const rows: AttentionRow[] = need.map((i) => ({
    id: i.id, severity: i.severity === "fix" ? "fix" : "look",
    title: t(i.title.key, i.title.vars), summary: t(i.summary.key, i.summary.vars), what: t(i.what.key, i.what.vars), todo: t(i.todo.key, i.todo.vars),
    who: i.who ? t(i.who.key, i.who.vars) : null, examples: i.examples ?? [],
    link: i.link ? { href: i.link.href, label: t(i.link.label.key, i.link.label.vars) } : null,
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
    <section aria-labelledby="attention-title" className="space-y-2.5">
      <div className="flex items-center justify-between gap-4">
        <h2 id="attention-title" className="text-xs font-semibold uppercase tracking-[0.2em] text-muted-foreground">{t("Needs your attention")}</h2>
        <Verdict t={t} fix={fixN} look={lookN} />
      </div>
      <div className="overflow-hidden rounded-xl border border-border/70 bg-card">
        {need.length === 0 ? (
          <div className="flex items-center gap-3 px-4 py-3">
            <CircleCheck className="size-5 shrink-0 text-emerald-500" aria-hidden />
            <p className="min-w-0 text-sm leading-snug"><strong className="font-semibold text-foreground">{t("Nothing needs your attention.")}</strong> <span className="text-muted-foreground">{t("Nothing is broken, and every required setting is in place.")}</span></p>
          </div>
        ) : (
          <AttentionList
            rows={rows}
            labels={{ all: t("Needs your attention"), whatItMeans: t("What it means"), whatToDo: t("What to do"), whoFixes: t("Who fixes it"), whereToLook: t("Where to look"), scrollMore: t("scroll for {n} more", { n: "{n}" }) }}
          />
        )}

      {checks.length === 0 ? (
        <p className="border-t border-border/60 px-4 py-2.5 text-sm text-muted-foreground">{t("The checks could not be run just now.")}</p>
      ) : (
        <details id="problems" className="group border-t border-border/60">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-2 text-[13px] text-muted-foreground marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
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
      </div>
    </section>
  );
}

