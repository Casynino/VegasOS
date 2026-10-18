import { ChevronDown, CircleAlert, CircleCheck, FileText, Minus } from "lucide-react";
import { cn } from "@/lib/utils";
import type { T } from "@/i18n/translate";
import { addDays } from "@/lib/time/business-date";
import { PURPOSE_WORDS, type MessagesData, type ReportDayRow, type ReportKindRow, type ReportState } from "@/server/services/developer-messages";
import { agoText } from "./console-ui";

/**
 * THE BOSS'S REPORTS, right under "Needs your attention" (owner, 2026-10-18: "this is more important for me, make it upper"; the look is
 * copied from his ORA console's "Daily report to …" panel): one panel for the daily report and one for the room report, each with a
 * title that names who gets it, a strip of bars for the last 7 closed days and "n of 7 sent", one line a day (the day, a pill saying
 * what happened, the time it went and how long ago), the older days closed behind one row, and a last row for the other reports of
 * that kind. Only what was sent, when and to how many — never a message's words, never a phone number. Server component: plain <details>.
 */

type Pill = { text: string; tone: "ok" | "bad" | "warn" | "quiet"; icon: typeof CircleCheck };
const PILL: Record<ReportState, (t: T) => Pill> = {
  ok: (t) => ({ text: t("Sent"), tone: "ok", icon: CircleCheck }),
  failed: (t) => ({ text: t("Not sent — failed"), tone: "bad", icon: CircleAlert }),
  unsent: (t) => ({ text: t("Not sent"), tone: "warn", icon: CircleAlert }),
  missing: (t) => ({ text: t("Not made"), tone: "bad", icon: CircleAlert }),
  waiting: (t) => ({ text: t("Not due yet"), tone: "quiet", icon: Minus }),
  off: (t) => ({ text: t("Switched off"), tone: "quiet", icon: Minus }),
  "before-live": (t) => ({ text: t("Before the clean start"), tone: "quiet", icon: Minus }),
};
const PILL_TONE: Record<Pill["tone"], string> = {
  ok: "border-emerald-500/40 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
  bad: "border-rose-500/40 bg-rose-500/10 text-rose-600 dark:text-rose-400",
  warn: "border-amber-500/40 bg-amber-500/10 text-amber-600 dark:text-amber-400",
  quiet: "border-border bg-muted/60 text-muted-foreground",
};
const BAR_TONE: Record<Pill["tone"], string> = { ok: "bg-emerald-500", bad: "bg-rose-500", warn: "bg-amber-500", quiet: "bg-muted-foreground/30" };

function StatePill({ t, state }: { t: T; state: ReportState }) {
  const p = PILL[state](t);
  const Icon = p.icon;
  return <span className={cn("inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold", PILL_TONE[p.tone])}><Icon className="size-3.5" aria-hidden />{p.text}</span>;
}

/** When it went: the time in bold and how long ago, muted; a report that was made but not sent says when it was made. */
function WhenCell({ t, k, now, timezone }: { t: T; k: ReportKindRow; now: Date; timezone: string }) {
  if (k.sentAt) return <span className="shrink-0 whitespace-nowrap text-right"><span className="font-semibold tabular-nums">{t.time(k.sentAt, timezone)}</span> <span className="text-sm text-muted-foreground">{agoText(t, k.sentAt, now)}</span></span>;
  if (k.madeAt) return <span className="shrink-0 whitespace-nowrap text-right text-sm text-muted-foreground">{t("made {time}", { time: t.time(k.madeAt, timezone) })}</span>;
  return <span className="shrink-0 text-muted-foreground" aria-hidden>—</span>;
}

function DayRow({ t, row, k, yesterday, now, timezone }: { t: T; row: ReportDayRow; k: ReportKindRow; yesterday: string; now: Date; timezone: string }) {
  const hover = k.madeAt ? [t("Made {time}", { time: t.dateTime(k.madeAt, timezone) }), t("version {n}", { n: k.version ?? 1 }), k.automatic ? t("automatic") : t("made by a person"), k.sentAt ? t("sent {time}", { time: t.dateTime(k.sentAt, timezone) }) : t("not sent")].join(" · ") : undefined;
  return (
    <li title={hover} className="flex items-center gap-3 border-t border-border/60 px-5 py-3 sm:px-6">
      <span className="min-w-0 flex-1 truncate text-sm font-medium">
        {t.dayMonth(row.date)}
        {row.date === yesterday && <span className="ml-2 rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.08em] text-muted-foreground">{t("Yesterday")}</span>}
      </span>
      <StatePill t={t} state={k.state} />
      <span className="w-[8.5rem] text-right"><WhenCell t={t} k={k} now={now} timezone={timezone} /></span>
    </li>
  );
}

function ReportPanel({ t, title, subtitle, rows, pick, yesterday, now, timezone, footer, nobody }: {
  t: T; title: string; subtitle: string; rows: ReportDayRow[]; pick: (r: ReportDayRow) => ReportKindRow; yesterday: string; now: Date; timezone: string;
  footer?: { label: string; sentAt: Date | null; failed: boolean };
  /** Nobody is set to receive the reports: said once, in amber, above the days. */
  nobody?: boolean;
}) {
  const kinds = rows.map(pick);
  const sent = kinds.filter((k) => k.state === "ok").length;
  const counted = kinds.filter((k) => k.state !== "before-live" && k.state !== "off").length;
  const shown = rows.slice(0, 3);
  const earlier = rows.slice(3);
  return (
    <section className="overflow-hidden rounded-2xl border border-border/70 bg-card shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <header className="flex items-center gap-3 px-5 py-4 sm:px-6">
        <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-[linear-gradient(135deg,#c084fc,#7c3aed)] text-white shadow-sm" aria-hidden><FileText className="size-5" /></span>
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-base font-semibold sm:text-lg">{title}</h2>
          <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
        </div>
        <div className="flex shrink-0 items-center gap-2.5" title={t("{n} of {m} sent", { n: sent, m: counted })}>
          <span className="flex items-end gap-[3px]" aria-hidden>
            {[...kinds].reverse().map((k, i) => <span key={i} className={cn("h-[18px] w-[5px] rounded-sm", BAR_TONE[PILL[k.state](t).tone])} />)}
          </span>
          <span className={cn("hidden text-sm font-medium sm:inline", counted > 0 && sent === counted ? "text-emerald-600 dark:text-emerald-400" : "text-muted-foreground")}>{counted > 0 ? t("{n} of {m} sent", { n: sent, m: counted }) : t("Switched off")}</span>
        </div>
      </header>
      {nobody && <p className="border-t border-border/60 bg-amber-500/10 px-5 py-2.5 text-sm font-medium text-amber-700 dark:text-amber-300 sm:px-6">{t("Nobody is set to receive them")}</p>}
      <ul>
        {shown.map((r) => <DayRow key={r.date} t={t} row={r} k={pick(r)} yesterday={yesterday} now={now} timezone={timezone} />)}
      </ul>
      {earlier.length > 0 && (
        <details className="group border-t border-border/60">
          <summary className="flex cursor-pointer list-none items-center gap-3 px-5 py-3 text-sm text-muted-foreground marker:content-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold sm:px-6 [&::-webkit-details-marker]:hidden">
            <span className="flex-1">{t("Earlier days")} · {earlier.length}</span>
            <ChevronDown className="size-4 shrink-0 transition-transform group-open:rotate-180" aria-hidden />
          </summary>
          <ul>{earlier.map((r) => <DayRow key={r.date} t={t} row={r} k={pick(r)} yesterday={yesterday} now={now} timezone={timezone} />)}</ul>
        </details>
      )}
      {footer && (
        <div className="flex items-center gap-3 border-t border-border/60 px-5 py-3 text-sm sm:px-6">
          <span className="min-w-0 flex-1 truncate text-muted-foreground">{footer.label}</span>
          {footer.sentAt
            ? <><span className={cn("text-sm font-medium", footer.failed ? "text-rose-600 dark:text-rose-400" : "text-emerald-600 dark:text-emerald-400")}>{footer.failed ? t("Look at it") : t("Sent")}</span><span className="whitespace-nowrap text-muted-foreground"><span className="tabular-nums">{t.time(footer.sentAt, timezone)}</span> · {agoText(t, footer.sentAt, now)}</span></>
            : <span className="text-muted-foreground">{t("None yet")}</span>}
        </div>
      )}
    </section>
  );
}

export function BossReports({ t, d, now, timezone }: { t: T; d: MessagesData; now: Date; timezone: string }) {
  if (!d.reportDays) return <p role="status" className="rounded-2xl border border-border/70 bg-card p-4 text-sm text-muted-foreground">{t("This could not be read just now.")}</p>;
  const who = d.recipientNames.length === 0 ? null : d.recipientNames.length === 1 ? d.recipientNames[0] : t("{name} and {n} more", { name: d.recipientNames[0], n: Math.max(1, d.recipients - 1) });
  const yesterday = addDays(d.today, -1);
  const other = (key: "SHIFT_REPORT" | "STAFF_REPORT") => {
    const r = d.otherReports?.find((x) => x.key === key);
    return { label: t(PURPOSE_WORDS[key]), sentAt: r?.lastSentAt ?? null, failed: !!r && r.failed7d > 0 };
  };
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <ReportPanel
        t={t} title={who ? t("Daily report to {name}", { name: who }) : t("Daily report")} subtitle={t("Made when the hotel day closes at {time}, sent on WhatsApp.", { time: d.dayStart })}
        rows={d.reportDays} pick={(r) => r.daily} yesterday={yesterday} now={now} timezone={timezone} footer={other("STAFF_REPORT")} nobody={d.recipients === 0}
      />
      <ReportPanel
        t={t} title={who ? t("Room report to {name}", { name: who }) : t("Room report")} subtitle={t("Made every morning, sent on WhatsApp.")}
        rows={d.reportDays} pick={(r) => r.room} yesterday={yesterday} now={now} timezone={timezone} footer={other("SHIFT_REPORT")} nobody={d.recipients === 0}
      />
    </div>
  );
}
