import Link from "next/link";
import { ArrowRight, ChevronDown, CircleAlert, CircleCheck, CircleHelp, TriangleAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";
import type { CheckGroup, CheckResult } from "@/server/services/developer-checks";
import { Quiet, Tag, type TagTone } from "./console-ui";

/**
 * PROBLEMS (owner, 2026-10-18): the first tab of the Developer console. The Developer does not do the hotel's work; his job is to make sure
 * the SYSTEM works and everything is OK. Every card here is a problem of the system — data that contradicts itself, a job or an integration
 * that fails, a key or a setting that is wrong, an error the server threw — and each one says what it means, what to fix, and who fixes it.
 * What was checked and found fine is listed too (collapsed), so the Developer sees what WAS looked at. Read-only; every word comes from
 * the checks in developer-checks.ts.
 */

const LOOK = {
  fix: { card: "border-rose-500/40 bg-rose-500/[0.06]", chip: "bg-rose-500/15 text-rose-700 dark:text-rose-300", tag: "rose" as TagTone, icon: CircleAlert },
  look: { card: "border-amber-500/40 bg-amber-500/[0.07]", chip: "bg-amber-500/15 text-amber-700 dark:text-amber-300", tag: "amber" as TagTone, icon: TriangleAlert },
} as const;

/** The plain word for a group (its own context, so the same English elsewhere keeps its own meaning). */
const groupWord = (t: T, group: CheckGroup) => t.ctx("check-group", group);

function Problem({ t, c }: { t: T; c: CheckResult }) {
  const l = LOOK[c.state === "fix" ? "fix" : "look"];
  const Icon = l.icon;
  return (
    <article className={cn("min-w-0 rounded-2xl border p-4 shadow-[0_1px_2px_rgba(15,23,42,0.03)] sm:p-5", l.card)}>
      <div className="flex items-start gap-3">
        <span className={cn("grid size-9 shrink-0 place-items-center rounded-xl", l.chip)}><Icon className="size-[18px]" aria-hidden /></span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <h3 className="text-sm font-semibold leading-snug text-foreground">{t(c.title.key, c.title.vars)}</h3>
            <Tag tone={l.tag}>{c.state === "fix" ? t("Fix now") : t("Look at it")}</Tag>
            <Tag tone="slate">{groupWord(t, c.group)}</Tag>
          </div>
          <p className="mt-1 text-sm text-foreground/90">
            <span className="mr-1.5 inline-block min-w-6 rounded-md bg-background/70 px-1.5 text-center font-semibold tabular-nums" aria-label={t("Found: {n}", { n: c.count })}>{c.count.toLocaleString(t.intl)}</span>
            {t(c.summary.key, c.summary.vars)}
          </p>
        </div>
      </div>
      <dl className="mt-3 space-y-3 border-t border-border/60 pt-3 text-sm">
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("What it means")}</dt>
          <dd className="mt-1 leading-relaxed text-foreground/90">{t(c.what.key, c.what.vars)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("What to fix")}</dt>
          <dd className="mt-1 leading-relaxed text-foreground/90">{t(c.todo.key, c.todo.vars)}</dd>
        </div>
        <div>
          <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("Who fixes it")}</dt>
          <dd className="mt-1 leading-relaxed text-foreground/90">{t(c.who.key, c.who.vars)}</dd>
        </div>
        {c.examples && c.examples.length > 0 && (
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("Where to look")}</dt>
            <dd className="mt-1 break-words font-mono text-xs text-foreground/90">{c.examples.join(" · ")}</dd>
          </div>
        )}
      </dl>
      {c.link && (
        <Link href={c.link.href} className="mt-3 inline-flex items-center gap-1.5 text-sm font-medium text-[oklch(0.5_0.11_75)] underline-offset-4 hover:underline dark:text-[oklch(0.84_0.11_82)]">
          {t(c.link.label.key, c.link.label.vars)}<ArrowRight className="size-3.5" aria-hidden />
        </Link>
      )}
    </article>
  );
}

function Section({ id, title, count, hint, children }: { id: string; title: string; count: number; hint?: string; children: React.ReactNode }) {
  return (
    <section aria-labelledby={id}>
      <h2 id={id} className="flex items-center gap-2 text-base font-semibold">
        {title}
        <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{count}</span>
      </h2>
      {hint && <p className="mb-3 mt-0.5 text-sm text-muted-foreground">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </section>
  );
}

export function ProblemsTab({ t, checks }: { t: T; checks: CheckResult[] }) {
  const fix = checks.filter((c) => c.state === "fix");
  const look = checks.filter((c) => c.state === "look");
  // A check that did not apply here (reports switched off, not the live site) or follows from another problem is NOT "fine": it is listed with what could not be checked.
  const ok = checks.filter((c) => c.state === "ok" && !c.skipped);
  const unknown = checks.filter((c) => c.state === "unknown" || (c.state === "ok" && c.skipped));

  return (
    <div className="space-y-6">
      <div className="rounded-3xl border border-border/70 bg-card p-5 shadow-[0_2px_4px_rgba(15,23,42,0.03)] sm:p-6">
        {checks.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t("The checks could not be run just now.")}</p>
        ) : (
          <>
            <p className="text-base font-semibold leading-snug">
              {t("We checked {n} things just now: {a} need fixing, {b} to look at, {c} are fine.", { n: checks.length, a: fix.length, b: look.length, c: ok.length })}
              {unknown.length > 0 && <span className="font-normal text-muted-foreground"> {t("{n} could not be checked.", { n: unknown.length })}</span>}
            </p>
            <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
              {t("These are problems of the system, not of the hotel's work. The hotel's own work (shifts, orders, guests' bills, requests, stock, cleaning) is for Reception, the managers, Finance and the kitchen, and whether the money is right is for the Finance team and the reports: none of that is checked here.")}
            </p>
          </>
        )}
      </div>

      {checks.length > 0 && (
        <>
          <Section id="problems-fix" title={t("Needs fixing")} count={fix.length} hint={t("The system is broken here, or its data contradicts itself.")}>
            {fix.length === 0
              ? <div className="flex items-center gap-3 rounded-2xl border border-emerald-500/30 bg-emerald-500/[0.06] p-4"><span className="grid size-9 place-items-center rounded-xl bg-emerald-500/15 text-emerald-700 dark:text-emerald-300"><CircleCheck className="size-[18px]" aria-hidden /></span><p className="text-sm font-semibold">{t("Nothing needs fixing.")}</p></div>
              : <div className="grid items-start gap-3 lg:grid-cols-2">{fix.map((c) => <Problem key={c.id} t={t} c={c} />)}</div>}
          </Section>

          <Section id="problems-look" title={t("Look at")} count={look.length} hint={t("Not broken, but worth a look.")}>
            {look.length === 0
              ? <Quiet>{t("Nothing to look at.")}</Quiet>
              : <div className="grid items-start gap-3 lg:grid-cols-2">{look.map((c) => <Problem key={c.id} t={t} c={c} />)}</div>}
          </Section>

          <section aria-labelledby="problems-ok">
            <details className="group rounded-2xl border border-border/70 bg-card">
              <summary className="flex cursor-pointer list-none items-center gap-2 rounded-2xl px-4 py-3 marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold sm:px-5 [&::-webkit-details-marker]:hidden">
                <CircleCheck className="size-[18px] text-emerald-600 dark:text-emerald-400" aria-hidden />
                <h2 id="problems-ok" className="text-base font-semibold">{t("All good")}</h2>
                <span className="rounded-full bg-muted px-2 py-0.5 text-xs font-medium tabular-nums text-muted-foreground">{ok.length}</span>
                <span className="ml-auto text-xs text-muted-foreground group-open:hidden">{t("Show what was checked")}</span>
                <ChevronDown className="size-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180" aria-hidden />
              </summary>
              {ok.length === 0 ? (
                <p className="border-t border-border/60 px-4 py-3 text-sm text-muted-foreground sm:px-5">{t("Nothing was found fine yet.")}</p>
              ) : (
                <ul className="divide-y divide-border/60 border-t border-border/60">
                  {ok.map((c) => (
                    <li key={c.id} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5 px-4 py-2.5 text-sm sm:px-5">
                      <span className="font-medium text-foreground">{t(c.title.key, c.title.vars)}</span>
                      <Tag tone="slate">{groupWord(t, c.group)}</Tag>
                      <span className="min-w-0 text-muted-foreground">{t(c.summary.key, c.summary.vars)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </details>
          </section>

          {unknown.length > 0 && (
            <Section id="problems-unknown" title={t("Could not be checked")} count={unknown.length} hint={t("Not a problem found: these could not be looked at just now, so nothing is known about them.")}>
              <ul className="divide-y divide-border/60 rounded-2xl border border-border/70 bg-card">
                {unknown.map((c) => (
                  <li key={c.id} className="flex items-start gap-3 px-4 py-3 text-sm sm:px-5">
                    <CircleHelp className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden />
                    <div className="min-w-0">
                      <p className="font-medium text-foreground">{t(c.title.key, c.title.vars)} <Tag tone="slate" className="ml-1 align-middle">{groupWord(t, c.group)}</Tag></p>
                      <p className="mt-0.5 text-muted-foreground">{t(c.summary.key, c.summary.vars)}</p>
                    </div>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </>
      )}
    </div>
  );
}
