import { ChevronDown, CircleAlert, CircleCheck, CircleHelp, ListChecks, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";
import type { CheckGroup, CheckResult } from "@/server/services/developer-checks";
import { Quiet, StatBlock, Tag } from "./console-ui";

/**
 * SYSTEM CHECKS (owner, 2026-10-18): what the system looked at just now, in one place and easy to scan. The Developer does not do the
 * hotel's work; every row here is a problem or a fact of the SYSTEM — data that contradicts itself, a job or an integration that fails, a key or
 * a setting that is wrong, an error the server threw. Four figures on top, then one row for each check: the ones that need fixing first.
 * The full explanation of a problem (what it means, what to fix, who) is on its card at the top of the page and in the row's hover text;
 * it is not printed twice. Read-only; every word comes from the checks in developer-checks.ts.
 */

const ROW = {
  fix: { icon: CircleAlert, tone: "text-rose-600 dark:text-rose-400" },
  look: { icon: TriangleAlert, tone: "text-amber-600 dark:text-amber-400" },
  ok: { icon: CircleCheck, tone: "text-emerald-600 dark:text-emerald-400" },
  unknown: { icon: CircleHelp, tone: "text-muted-foreground" },
} as const;

/** The plain word for a group (its own context, so the same English elsewhere keeps its own meaning). */
const groupWord = (t: T, group: CheckGroup) => t.ctx("check-group", group);

function Row({ t, c }: { t: T; c: CheckResult }) {
  const kind = c.state === "ok" && c.skipped ? "unknown" : c.state;
  const { icon: Icon, tone } = ROW[kind];
  return (
    <li title={t(c.what.key, c.what.vars)} className="flex items-center gap-3 px-4 py-3 sm:px-5">
      <Icon className={cn("size-[18px] shrink-0", tone)} aria-hidden />
      <span className="min-w-0 flex-1 text-sm leading-snug">
        <span className="block font-medium text-foreground">{t(c.title.key, c.title.vars)}</span>
        <span className="block text-xs text-muted-foreground">{t(c.summary.key, c.summary.vars)}</span>
      </span>
      {c.state === "fix" && <Tag tone="rose">{t("Fix now")}</Tag>}
      {c.state === "look" && <Tag tone="amber">{t("Look at it")}</Tag>}
      <Tag tone="slate" className="hidden sm:inline-flex">{groupWord(t, c.group)}</Tag>
    </li>
  );
}

export function ProblemsTab({ t, checks }: { t: T; checks: CheckResult[] }) {
  if (checks.length === 0) return <Quiet>{t("The checks could not be run just now.")}</Quiet>;
  const fix = checks.filter((c) => c.state === "fix");
  const look = checks.filter((c) => c.state === "look");
  // A check that did not apply here (reports switched off, not the live site) or only follows from another problem is NOT "fine": it is listed with what could not be checked.
  const fine = checks.filter((c) => c.state === "ok" && !c.skipped);
  const unknown = checks.filter((c) => c.state === "unknown" || (c.state === "ok" && c.skipped));
  const open = [...fix, ...look, ...unknown];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatBlock
          icon={ListChecks} label={t("Checks fine")} value={t("{ok} of {n}", { ok: fine.length, n: checks.length })} caption={t("system checks just now")}
          tag={fix.length + look.length === 0 ? t("All good") : undefined} tagTone="emerald"
          note={t("These are problems of the system, not of the hotel's work. The hotel's own work is for Reception, the managers, Finance and the kitchen: none of it is checked here.")}
        />
        <StatBlock icon={CircleAlert} label={t("Needs fixing")} value={fix.length.toLocaleString(t.intl)} caption={t("the system is broken here")} warn={fix.length > 0} tag={fix.length > 0 ? t("Fix now") : t("Quiet")} tagTone={fix.length > 0 ? "rose" : "emerald"} />
        <StatBlock icon={TriangleAlert} label={t("Look at")} value={look.length.toLocaleString(t.intl)} caption={t("not broken, but worth a look")} warn={look.length > 0} tag={look.length > 0 ? t("Look at it") : t("Quiet")} tagTone={look.length > 0 ? "amber" : "emerald"} />
        <StatBlock
          icon={CircleHelp} label={t("Could not be checked")} value={unknown.length.toLocaleString(t.intl)} caption={t("nothing is known about them")} tag={unknown.length > 0 ? t("Not a problem found") : t("None")} tagTone="slate"
          note={t("Not a problem found: these could not be looked at just now, or do not apply here, so nothing is known about them.")}
        />
      </div>
      {open.length > 0 && (
        <ul className="divide-y divide-border/60 overflow-hidden rounded-2xl border border-border/70 bg-card" aria-label={t("System checks")}>
          {open.map((c) => <Row key={c.id} t={t} c={c} />)}
        </ul>
      )}
      <details className="group overflow-hidden rounded-2xl border border-border/70 bg-card">
        <summary className="flex cursor-pointer list-none items-center gap-3 px-4 py-3 marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:px-5 [&::-webkit-details-marker]:hidden">
          <CircleCheck className="size-[18px] shrink-0 text-emerald-600 dark:text-emerald-400" aria-hidden />
          <span className="flex-1 text-sm font-medium">{t("All good")} <span className="ml-1 rounded-full bg-muted px-2 py-0.5 text-xs tabular-nums text-muted-foreground">{fine.length}</span></span>
          <span className="text-xs text-muted-foreground group-open:hidden">{t("Show what was checked")}</span>
          <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
        </summary>
        <ul className="divide-y divide-border/60 border-t border-border/60">
          {fine.map((c) => <Row key={c.id} t={t} c={c} />)}
        </ul>
      </details>
    </div>
  );
}
