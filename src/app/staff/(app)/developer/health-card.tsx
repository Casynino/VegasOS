import { Info } from "lucide-react";
import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";
import { SCORE, type HealthReport } from "@/server/services/developer-health";
import { num } from "./console-ui";

/**
 * THE HEALTH CARD: a ring with the score out of 100, one plain sentence, three chips, and four numbers. The rule behind the score
 * is explained in the card itself ("How is this worked out?") and is the same rule written in src/server/services/developer-health.ts.
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

function Figure({ label, value, caption, tone, hint }: { label: string; value: string; caption: string; tone?: "ok" | "warn" | "bad"; hint?: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className={cn("mt-1 text-2xl font-semibold leading-none tracking-tight tabular-nums", tone === "ok" && "text-emerald-600 dark:text-emerald-400", tone === "warn" && "text-amber-600 dark:text-amber-400", tone === "bad" && "text-rose-600 dark:text-rose-400")}>{value}</p>
      <p className="mt-1.5 text-sm text-muted-foreground">{caption}</p>
      {hint && <p className="mt-0.5 text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

export function HealthCard({ t, h }: { t: T; h: HealthReport }) {
  const verdict = {
    offline: { title: t("The database is not answering"), line: t("Staff cannot work until it is back.") },
    fix: { title: t("Needs attention now"), line: t.plural(h.counts.fix, "{n} thing to fix now.", "{n} things to fix now.") },
    look: { title: t("Working, with a few things to look at"), line: t.plural(h.counts.look, "{n} thing worth a look. Nothing is broken.", "{n} things worth a look. Nothing is broken.") },
    well: { title: t("Working well"), line: t("Nothing needs your attention.") },
  }[h.verdict];
  const costFix = h.items.filter((i) => i.severity === "fix" && i.id !== "database").length * SCORE.fixNow;
  const costLook = h.items.filter((i) => i.severity === "look").length * SCORE.lookAt;
  const offline = !h.database.online;

  return (
    <section aria-labelledby="health-title" className="rounded-3xl border border-border/70 bg-card p-5 shadow-[0_2px_4px_rgba(15,23,42,0.03),0_12px_32px_-18px_rgba(15,23,42,0.18)] sm:p-6">
      <div className="grid gap-6 lg:grid-cols-[minmax(0,1.15fr)_minmax(0,1fr)] lg:gap-8">
        <div className="flex items-center gap-4 sm:gap-5">
          <Ring score={h.score} label={t("out of 100")} outOf={t("out of 100")} />
          <div className="min-w-0">
            <h2 id="health-title" className="text-xl font-semibold tracking-tight sm:text-[1.4rem]">{verdict.title}</h2>
            <p className="mt-1 text-sm text-muted-foreground">{verdict.line}</p>
            <ul className="mt-3 flex flex-wrap gap-2 text-xs font-medium" aria-label={t("Summary")}>
              <li className={cn("rounded-full px-3 py-1 ring-1 ring-inset", h.counts.fix > 0 ? "bg-rose-500/12 text-rose-700 ring-rose-500/30 dark:text-rose-300" : "bg-muted text-foreground/80 ring-border")}>{t("{n} to fix now", { n: h.counts.fix })}</li>
              <li className={cn("rounded-full px-3 py-1 ring-1 ring-inset", h.counts.look > 0 ? "bg-amber-500/14 text-amber-800 ring-amber-500/35 dark:text-amber-300" : "bg-muted text-foreground/80 ring-border")}>{t("{n} to look at", { n: h.counts.look })}</li>
              <li className="rounded-full bg-muted px-3 py-1 text-foreground/80 ring-1 ring-inset ring-border">{t("{n} for information", { n: h.counts.info })}</li>
            </ul>
          </div>
        </div>

        <dl className="grid grid-cols-2 gap-x-5 gap-y-5 border-t border-border/60 pt-5 lg:border-l lg:border-t-0 lg:pl-8 lg:pt-0">
          <Figure
            label={t("Database")} value={offline ? t("Offline") : t("Online")} tone={offline ? "bad" : "ok"}
            caption={offline ? t("did not answer") : h.database.ms !== null ? t("{ms} ms to answer", { ms: h.database.ms }) : t("answers")}
          />
          <Figure label={t("Signed in today")} value={num(t, h.signedInToday)} caption={t("different people")} />
          <Figure label={t("Actions today")} value={num(t, h.actionsToday)} caption={t("saved in 24 hours")} />
          <Figure
            label={t("Alerts waiting")} value={num(t, h.alerts?.total)} tone={h.alerts && h.alerts.total > 0 ? "warn" : undefined}
            caption={t("over a day")}
            hint={h.alerts ? t("Guest requests: {guests}. Stock requests: {stock}.", { guests: h.alerts.guestRequests, stock: h.alerts.stockRequests }) : undefined}
          />
        </dl>
      </div>

      <details className="group mt-5 border-t border-border/60 pt-4 text-sm">
        <summary className="flex cursor-pointer list-none items-center gap-2 font-medium text-foreground/90 marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold [&::-webkit-details-marker]:hidden">
          <Info className="size-4 text-muted-foreground" aria-hidden />{t("How is this worked out?")}
          <span className="text-xs font-normal text-muted-foreground group-open:hidden">{t("Show")}</span>
        </summary>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <ol className="space-y-1.5 text-muted-foreground">
            <li>{t("The score starts at {n}.", { n: SCORE.start })}</li>
            <li>{t("If the database does not answer, it loses {n}.", { n: SCORE.databaseOffline })}</li>
            <li>{t("Each thing to fix now loses {n}.", { n: SCORE.fixNow })}</li>
            <li>{t("Each thing to look at loses {n}.", { n: SCORE.lookAt })}</li>
            <li>{t("Things for information cost nothing.")}</li>
            <li>{t("It never goes below 0.")}</li>
          </ol>
          <div className="rounded-2xl bg-muted/40 px-4 py-3">
            <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">{t("Right now")}</p>
            <p className="mt-1 tabular-nums">
              {SCORE.start}{offline ? ` − ${SCORE.databaseOffline}` : ""}{costFix ? ` − ${costFix}` : ""}{costLook ? ` − ${costLook}` : ""} = <strong>{h.score}</strong>
            </p>
            <p className="mt-1.5 text-xs leading-relaxed text-muted-foreground">{t("Only facts count: a report that did not go, a payment that needs a person, a missing setting. A guess never does.")}</p>
          </div>
        </div>
      </details>
    </section>
  );
}
