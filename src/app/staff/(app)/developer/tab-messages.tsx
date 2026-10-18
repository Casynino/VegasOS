import { FileText, MailWarning, Send } from "lucide-react";
import type { T } from "@/i18n/translate";
import { msg } from "@/i18n/msg";
import { Panel } from "@/components/dashboard/kit";
import { MESSAGE_ROWS, PURPOSE_WORDS, type MessagesData, type ReportKindRow, type ReportState } from "@/server/services/developer-messages";
import { BarChart, type BarColumn } from "./console-charts";
import { DataTable } from "./console-table";
import { dayLabel, num, Quiet, StatBlock, Tag, type TagTone } from "./console-ui";

/**
 * MESSAGES & REPORTS: is the Boss getting what he should. The text of a message is never shown — only what was sent, when, to
 * how many and how it went; a phone number shows its last three digits only; a failed delivery shows the KIND of trouble in plain
 * words, never the provider's own reply (it can echo the message).
 */

const SENT = "#199e70";
const FAILED = "#d95926";
const PENDING = "#c98500";
const dayTick = (i: number, count: number) => (count - 1 - i) % 2 === 0;

export const REPORT_STATE_WORDS: Record<ReportState, string> = {
  ok: msg("Sent"), failed: msg("Send failed"), unsent: msg("Made, not sent"), missing: msg("Not made"), waiting: msg("Not due yet"), off: msg("Switched off"), "before-live": msg("Before the clean start"),
};
/** The shorter word for the table: OK / Not sent / Not made. */
export const REPORT_CELL_WORDS: Record<ReportState, string> = {
  ok: msg("OK"), failed: msg("Not sent — failed"), unsent: msg("Not sent"), missing: msg("Not made"), waiting: msg("Not due yet"), off: msg("Switched off"), "before-live": msg("Before the clean start"),
};
const STATE_TONE: Record<ReportState, TagTone> = { ok: "emerald", failed: "rose", unsent: "amber", missing: "rose", waiting: "slate", off: "slate", "before-live": "slate" };

export function MessagesTab({ t, d, when }: { t: T; d: MessagesData; when: (x: Date) => string }) {
  const nothing = t("Nothing yet");
  const unread = <Quiet>{t("This could not be read just now.")}</Quiet>;
  const perDay: BarColumn[] | null = d.perDay
    ? d.perDay.map((r, i, all) => ({ key: r.date, tick: dayTick(i, all.length) ? dayLabel(t, r.date) : "", name: dayLabel(t, r.date), values: { sent: r.sent, failed: r.failed, pending: r.pending }, emphasise: r.date === d.today }))
    : null;
  // A chart with no delivery in it is not drawn (an empty box tells nothing): one quiet line says so instead.
  const hasDeliveries = !!d.perDay?.some((r) => r.sent + r.failed + r.pending > 0);
  const lc = d.lastClosed;
  const madeText = (k: ReportKindRow) => {
    if (k.madeAt === null) return t("Not made.");
    const parts = [t("Made {time}", { time: when(k.madeAt) }), t("version {n}", { n: k.version ?? 1 }), k.automatic ? t("automatic") : t("made by a person")];
    parts.push(k.sentAt ? t("sent {time}", { time: when(k.sentAt) }) : t("not sent"));
    return parts.join(" · ");
  };

  const chart = (
    <Panel title={t("Deliveries per day")} subtitle={t("Last 14 days, by how they went.")}>
      {perDay
        ? <BarChart t={t} columns={perDay} height={150} series={[{ key: "sent", label: t("Sent"), color: SENT }, { key: "failed", label: t("Failed"), color: FAILED }, { key: "pending", label: t("Waiting"), color: PENDING }]} caption={t("Deliveries per day")} empty={nothing} />
        : unread}
    </Panel>
  );
  // The Boss's other reports: when the newest of each kind went out and how the last 7 days went (the daily and room reports are in the table above).
  const others = (
    <Panel title={t("Shift, weekly and monthly reports")} subtitle={t("When the newest went out, and the last 7 days.")}>
      {d.otherReports
        ? <DataTable
            compact empty={nothing}
            cols={[{ label: t("Report") }, { label: t("Last sent") }, { label: t("Last 7 days") }, { label: t("Result") }]}
            rows={d.otherReports.map((r) => ({
              key: r.key,
              cells: [
                <span key="n" className="font-medium">{t(PURPOSE_WORDS[r.key])}</span>,
                r.lastSentAt ? <span key="l" className="whitespace-nowrap">{when(r.lastSentAt)}</span> : <span key="l" className="text-muted-foreground">{t("None yet")}</span>,
                <span key="w" className="text-muted-foreground">{[t("{n} sent", { n: r.sent7d }), ...(r.failed7d > 0 ? [t("{n} failed", { n: r.failed7d })] : []), ...(r.waiting7d > 0 ? [t("{n} waiting", { n: r.waiting7d })] : [])].join(" · ")}</span>,
                r.failed7d > 0 ? <Tag key="s" tone="rose">{t("Look at it")}</Tag> : r.sent7d > 0 || r.lastSentAt ? <Tag key="s" tone="emerald">{t("OK")}</Tag> : <Tag key="s" tone="slate">{t("None yet")}</Tag>,
              ],
            }))}
          />
        : unread}
    </Panel>
  );
  const reports = (
    <Panel
      title={t("The last closed days: reports")} subtitle={t("Did it reach the Boss? Last 7 closed days.")}
      action={d.recipients > 0
        ? <span className="shrink-0 text-xs text-muted-foreground">{t.plural(d.recipients, "Sent to {n} person", "Sent to {n} people")}</span>
        : <span className="shrink-0 text-xs font-medium text-amber-700 dark:text-amber-300">{t("Nobody is set to receive them")}</span>}
    >
      {d.reportDays
        ? <DataTable
            compact empty={nothing}
            cols={[{ label: t("Day") }, { label: t("Daily report") }, { label: t("Room report") }]}
            rows={d.reportDays.map((r) => ({
              key: r.date,
              cells: [
                <span key="d" className="whitespace-nowrap font-medium">{t.dayMonth(r.date)}</span>,
                <ReportCell key="a" t={t} k={r.daily} when={when} madeText={madeText} />,
                <ReportCell key="b" t={t} k={r.room} when={when} madeText={madeText} />,
              ],
            }))}
          />
        : unread}
    </Panel>
  );

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatBlock
          icon={Send} label={t("WhatsApp deliveries, 24 hours")} value={d.deliveries24h ? num(t, d.deliveries24h.sent) : "—"} caption={t("sent in the last 24 hours")} warn={!!d.deliveries24h?.failed}
          tag={d.deliveries24h ? (d.deliveries24h.failed > 0 ? t("{n} failed", { n: d.deliveries24h.failed }) : t("None failed")) : undefined} tagTone={d.deliveries24h?.failed ? "amber" : "emerald"}
          note={d.deliveries24h ? t("Reports and reminders sent by WhatsApp. Failed (last try in 24 hours): {failed}. Waiting to be sent (made in the last 7 days): {waiting}.", { failed: d.deliveries24h.failed, waiting: d.deliveries24h.waiting }) : undefined}
        />
        {([["daily", t("Daily report"), lc?.daily], ["room", t("Room report"), lc?.room]] as const).map(([key, label, k]) => (
          <StatBlock
            key={key} icon={FileText} label={label} value={k ? t(REPORT_STATE_WORDS[k.state]) : "—"} small caption={lc ? t("for {date}", { date: t.date(lc.date) }) : t("for the last closed day")}
            warn={!!k?.trouble}
            tag={k ? (k.state === "ok" ? t("OK") : k.state === "failed" || k.state === "unsent" || k.state === "missing" ? t("Look at it") : undefined) : undefined} tagTone={k ? STATE_TONE[k.state] : "slate"}
            note={k ? madeText(k) : undefined}
          />
        ))}
        <StatBlock
          icon={MailWarning} label={t("Failed deliveries, 7 days")} value={d.retry ? num(t, d.retry.underMax + d.retry.atMax) : "—"} caption={t("failed in the last 7 days")}
          tag={d.retry ? (d.retry.atMax > 0 ? t("{n} had all {max} tries", { n: d.retry.atMax, max: d.maxAttempts }) : t("None had all {max} tries", { max: d.maxAttempts })) : undefined} tagTone={d.retry?.atMax ? "amber" : "emerald"} warn={!!d.retry?.atMax}
          note={d.retry ? t("Fewer than {max} tries so far: {under} (a job may try again, but not every kind of message is tried again). All {max} tries used: {at} — no more automatic tries; only a person's 'send again' tries more.", { max: d.maxAttempts, under: d.retry.underMax, at: d.retry.atMax }) : undefined}
        />
      </div>

      {/* The closed days first (the owner: "this is more important for me"), then the other reports and how many went out each day. */}
      {reports}
      {perDay && !hasDeliveries ? (
        <>
          {others}
          <Quiet>{t("Deliveries per day: nothing in the last 14 days.")}</Quiet>
        </>
      ) : (
        <div className="grid gap-4 lg:grid-cols-2">
          {others}
          {chart}
        </div>
      )}

      {/* Drawn only when there is something to look at: the "Failed deliveries" card above already says when there is none. */}
      {d.problems === null && <Quiet>{t("Failed or waiting deliveries")}: {t("This could not be read just now.")}</Quiet>}
      {d.problems && d.problems.length > 0 && (
        <Panel title={t("Failed or waiting deliveries")} subtitle={t("The newest {n} deliveries that failed or are waiting. Only the kind of trouble is shown.", { n: MESSAGE_ROWS.problems })}>
          <DataTable
            compact empty={nothing} scroll={t("Failed or waiting deliveries")}
            cols={[{ label: t("Last tried") }, { label: t("For") }, { label: t("To") }, { label: t("Tries"), num: true }, { label: t("What happened") }]}
            rows={d.problems.map((p) => ({
              key: p.id,
              cells: [
                <span key="w" className="whitespace-nowrap">{when(p.at)}</span>,
                t(p.purpose),
                <span key="r" className="font-mono text-xs">{p.recipient}</span>,
                <span key="a">{num(t, p.attempts)}{p.status === "FAILED" && !p.reminder && <span className="ml-1.5 inline-block">{p.atMax ? <Tag tone="rose">{t("no more automatic tries")}</Tag> : <Tag tone="sky">{t("fewer than {max} tries", { max: d.maxAttempts })}</Tag>}</span>}</span>,
                t(p.kind),
              ],
            }))}
          />
        </Panel>
      )}
    </div>
  );
}

/** One report of one day on ONE line: the state, then when it was sent (muted). Who made it, which version and whether it was automatic are the hover text. */
function ReportCell({ t, k, when, madeText }: { t: T; k: ReportKindRow; when: (x: Date) => string; madeText: (k: ReportKindRow) => string }) {
  return (
    <span className="flex flex-wrap items-center gap-x-2 gap-y-0.5" title={k.madeAt ? madeText(k) : undefined}>
      <Tag tone={STATE_TONE[k.state]}>{t(REPORT_CELL_WORDS[k.state])}</Tag>
      {k.sentAt && <span className="whitespace-nowrap text-xs tabular-nums text-muted-foreground">{t("sent {time}", { time: when(k.sentAt) })}</span>}
    </span>
  );
}
