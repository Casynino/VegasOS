import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";
import { SCORE, type HealthReport } from "@/server/services/developer-health";
import { num } from "./console-ui";
import { MiniBars, Sparkline } from "./sparkline";

/**
 * THE HEALTH CARD (copied from the owner's Target console, 2026-10-18: "the same look exactly"): a ring with the score out of 100 and
 * "Health score" under it, a verdict in colour with one plain sentence and three chips, and four small cards — Database (six bars),
 * Signed in today, Actions today and Server errors (a small line each). The rule behind the score is the hover text of the ring and is the
 * same rule written in src/server/services/developer-health.ts.
 */

const RING = 52;
const CIRC = 2 * Math.PI * RING;

function Ring({ score, label, outOf }: { score: number; label: string; outOf: string }) {
  const colour = score >= 90 ? "#199e70" : score >= 70 ? "#e0a21b" : "#e0475b";
  return (
    <div className="relative size-28 shrink-0 sm:size-36" role="img" aria-label={`${score} ${outOf}`}>
      <svg viewBox="0 0 120 120" className="size-full -rotate-90" aria-hidden>
        <circle cx="60" cy="60" r={RING} fill="none" stroke="currentColor" strokeWidth="9" className="text-muted" />
        <circle cx="60" cy="60" r={RING} fill="none" stroke={colour} strokeWidth="9" strokeLinecap="round" strokeDasharray={`${(score / 100) * CIRC} ${CIRC}`} />
      </svg>
      <div className="absolute inset-0 grid place-items-center text-center" aria-hidden>
        <div>
          <p className="text-3xl font-semibold leading-none tracking-tight tabular-nums sm:text-4xl">{score}</p>
          <p className="mt-1 text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
        </div>
      </div>
    </div>
  );
}

/** One headline figure as its own small card: a term (dt) and its value, caption and small picture (dd) — inside the card's <dl>. */
function Figure({ label, value, caption, tone, children }: { label: string; value: string; caption: string; tone?: "ok" | "warn" | "bad"; children?: React.ReactNode }) {
  return (
    <div className="flex min-w-0 flex-col rounded-2xl border border-border/70 bg-background/40 p-4">
      <dt className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</dt>
      <dd className={cn("mt-1.5 text-3xl font-semibold leading-none tracking-tight tabular-nums", tone === "ok" && "text-emerald-600 dark:text-emerald-400", tone === "warn" && "text-amber-600 dark:text-amber-400", tone === "bad" && "text-rose-600 dark:text-rose-400")}>{value}</dd>
      <dd className="mt-1.5 text-sm text-muted-foreground">{caption}</dd>
      <dd className="mt-auto pt-3">{children ?? <span className="block h-10" aria-hidden />}</dd>
    </div>
  );
}

export function HealthCard({ t, h }: { t: T; h: HealthReport }) {
  const verdict = {
    offline: { title: t("The database is not answering"), line: t("Staff cannot work until it is back."), tone: "text-rose-600 dark:text-rose-400" },
    fix: { title: t("Needs attention now"), line: t.plural(h.counts.fix, "{n} thing to fix now.", "{n} things to fix now."), tone: "text-rose-600 dark:text-rose-400" },
    look: { title: t("Working, with a few things to look at"), line: t.plural(h.counts.look, "{n} thing worth a look. Nothing is broken.", "{n} things worth a look. Nothing is broken."), tone: "text-amber-600 dark:text-amber-400" },
    well: { title: t("Everything is healthy"), line: t("The database is fast, every required setting is in place and nothing has crashed."), tone: "text-emerald-600 dark:text-emerald-400" },
  }[h.verdict];
  const costFix = h.items.filter((i) => i.severity === "fix" && i.id !== "database").length * SCORE.fixNow;
  const costLook = h.items.filter((i) => i.severity === "look").length * SCORE.lookAt;
  const offline = !h.database.online;
  // How the score is worked out: the hover text of the ring (the rule, and the sum for right now).
  const rule = [
    t("The score starts at {n}.", { n: SCORE.start }),
    t("If the database does not answer, it loses {n}.", { n: SCORE.databaseOffline }),
    t("Each thing to fix now loses {n}.", { n: SCORE.fixNow }),
    t("Each thing to look at loses {n}.", { n: SCORE.lookAt }),
    t("Things for information cost nothing."),
    t("Only problems of the system count. The hotel's own work never does."),
    `${SCORE.start}${offline ? ` − ${SCORE.databaseOffline}` : ""}${costFix ? ` − ${costFix}` : ""}${costLook ? ` − ${costLook}` : ""} = ${h.score}`,
  ].join("\n");
  const tr = h.trend;

  return (
    <section aria-labelledby="health-title" className="rounded-3xl border border-border/70 bg-card p-5 shadow-[0_2px_4px_rgba(15,23,42,0.03),0_12px_32px_-18px_rgba(15,23,42,0.18)] sm:p-7">
      <div className="flex items-center gap-5 sm:gap-7">
        <div className="shrink-0 text-center" title={rule}>
          <Ring score={h.score} label={t("out of 100")} outOf={t("out of 100")} />
          <p className="mt-2 text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{t("Health score")}</p>
        </div>
        <div className="min-w-0">
          <h2 id="health-title" className={cn("text-xl font-semibold tracking-tight sm:text-2xl", verdict.tone)}>{verdict.title}</h2>
          <p className="mt-1.5 text-sm text-muted-foreground sm:text-base">{verdict.line}</p>
          <ul className="mt-4 flex flex-wrap gap-2 text-xs font-medium" aria-label={t("Summary")}>
            {([[h.counts.fix, t("{n} to fix now", { n: h.counts.fix }), "bg-rose-500"], [h.counts.look, t("{n} to look at", { n: h.counts.look }), "bg-amber-500"], [h.counts.info, t("{n} for information", { n: h.counts.info }), "bg-muted-foreground/50"]] as const).map(([n, text, dot]) => (
              <li key={text} className="inline-flex items-center gap-1.5 rounded-full bg-muted/60 px-3 py-1 text-foreground/80 ring-1 ring-inset ring-border">
                <span className={cn("size-1.5 rounded-full", n > 0 ? dot : "bg-muted-foreground/40")} aria-hidden />{text}
              </li>
            ))}
          </ul>
        </div>
      </div>

      <dl className="mt-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <Figure
          label={t("Database")} value={offline ? t("Offline") : t("Online")} tone={offline ? "bad" : "ok"}
          caption={offline ? t("did not answer") : h.database.ms !== null ? `${t("{ms} ms to answer", { ms: h.database.ms })}${h.databaseLink ? ` · ${h.databaseLink === "Pooled" ? t("pooled") : t("direct")}` : ""}` : t("answers")}
        >
          {!offline && tr.dbSamples && <MiniBars values={tr.dbSamples} label={t("Six quick answers of the database, in milliseconds: {list}", { list: tr.dbSamples.join(", ") })} />}
        </Figure>
        <Figure label={t("Signed in today")} value={num(t, h.signedInToday)} caption={t("different people")}>
          {tr.signIns && <Sparkline values={tr.signIns} label={t("Sign-ins per day, last {n} days", { n: tr.signIns.length })} />}
        </Figure>
        <Figure label={t("Actions today")} value={num(t, h.actionsToday)} caption={t("saved in 24 hours")}>
          {tr.actions && <Sparkline values={tr.actions} label={t("Actions per day, last {n} days", { n: tr.actions.length })} />}
        </Figure>
        <Figure
          label={t("Server errors (24 h)")} value={num(t, h.serverErrors24h)} tone={h.serverErrors24h ? "warn" : h.serverErrors24h === 0 ? "ok" : undefined}
          caption={h.serverErrors24h === 0 ? t("nothing broke") : t("different errors")}
        >
          {tr.errors && <Sparkline values={tr.errors} label={t("Server errors per day, last {n} days", { n: tr.errors.length })} />}
        </Figure>
      </dl>
    </section>
  );
}
