import type { T } from "@/i18n/translate";
import { msg } from "@/i18n/msg";
import { Panel } from "@/components/dashboard/kit";
import { MESSAGE_ROWS, PURPOSE_WORDS, type MessagesData, type ReportKindRow, type ReportState } from "@/server/services/developer-messages";
import { BarChart, RankBars, type BarColumn } from "./console-charts";
import { DataTable, Dash } from "./console-table";
import { dayLabel, num, Quiet, StatBlock, Tag, type TagTone } from "./console-ui";

/**
 * MESSAGES & REPORTS: is the Boss getting what he should. The text of a message is never shown — only what was sent, when, to
 * how many and how it went; a phone number shows its last three digits only; a failed delivery shows the KIND of trouble in plain
 * words, never the provider's own reply (it can echo the message).
 */

const SENT = "#199e70";
const FAILED = "#d95926";
const PENDING = "#c98500";
const PURPOSE = "#8466e0";
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
  const lc = d.lastClosed;
  const madeText = (k: ReportKindRow) => {
    if (k.madeAt === null) return t("Not made.");
    const parts = [t("Made {time}", { time: when(k.madeAt) }), t("version {n}", { n: k.version ?? 1 }), k.automatic ? t("automatic") : t("made by a person")];
    parts.push(k.sentAt ? t("sent {time}", { time: when(k.sentAt) }) : t("not sent"));
    return parts.join(" · ");
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("Is the Boss getting what he should. Read-only. The words of a message are never shown here — only what was sent, when and how it went. A phone number shows its last three digits only. A hotel day runs from {start} to {start} the next morning (hotel time).", { start: d.dayStart })}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatBlock
          label={t("WhatsApp deliveries, 24 hours")} value={d.deliveries24h ? num(t, d.deliveries24h.sent) : "—"} caption={t("sent in the last 24 hours")} warn={!!d.deliveries24h?.failed}
          tag={d.deliveries24h ? (d.deliveries24h.failed > 0 ? t("{n} failed", { n: d.deliveries24h.failed }) : t("None failed")) : undefined} tagTone={d.deliveries24h?.failed ? "amber" : "emerald"}
          note={d.deliveries24h ? t("Reports and reminders sent by WhatsApp. Failed (last try in 24 hours): {failed}. Waiting to be sent (made in the last 7 days): {waiting}.", { failed: d.deliveries24h.failed, waiting: d.deliveries24h.waiting }) : undefined}
        />
        {([["daily", t("Daily report"), lc?.daily], ["room", t("Room report"), lc?.room]] as const).map(([key, label, k]) => (
          <StatBlock
            key={key} label={label} value={k ? t(REPORT_STATE_WORDS[k.state]) : "—"} small caption={lc ? t("for {date}", { date: t.date(lc.date) }) : t("for the last closed day")}
            warn={!!k?.trouble}
            tag={k ? (k.state === "ok" ? t("OK") : k.state === "failed" || k.state === "unsent" || k.state === "missing" ? t("Look at it") : undefined) : undefined} tagTone={k ? STATE_TONE[k.state] : "slate"}
            note={k ? madeText(k) : undefined}
          />
        ))}
        <StatBlock
          label={t("Failed deliveries, 7 days")} value={d.retry ? num(t, d.retry.underMax + d.retry.atMax) : "—"} caption={t("failed in the last 7 days")}
          tag={d.retry ? (d.retry.atMax > 0 ? t("{n} had all {max} tries", { n: d.retry.atMax, max: d.maxAttempts }) : t("None had all {max} tries", { max: d.maxAttempts })) : undefined} tagTone={d.retry?.atMax ? "amber" : "emerald"} warn={!!d.retry?.atMax}
          note={d.retry ? t("Fewer than {max} tries so far: {under} (a job may try again, but not every kind of message is tried again). All {max} tries used: {at} — no more automatic tries; only a person's 'send again' tries more.", { max: d.maxAttempts, under: d.retry.underMax, at: d.retry.atMax }) : undefined}
        />
        <StatBlock
          label={t("Guest messages, 24 hours")} value={d.guestMessages24h ? num(t, d.guestMessages24h.sent) : "—"} caption={t("sent to guests in the last 24 hours")} warn={!!d.guestMessages24h?.failed}
          tag={d.guestMessages24h ? (d.guestMessages24h.failed > 0 ? t("{n} failed", { n: d.guestMessages24h.failed }) : t("None failed")) : undefined} tagTone={d.guestMessages24h?.failed ? "amber" : "emerald"}
          note={t("Booking, welcome, thank-you and other messages logged on a guest's profile. Short notices to the Boss are not written down, so they are not counted.")}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("Deliveries per day")} subtitle={t("WhatsApp deliveries made each hotel day, by how they went. Last 14 days. Hover a bar for exact numbers; the table below has them all.")}>
          {perDay
            ? <BarChart t={t} columns={perDay} series={[{ key: "sent", label: t("Sent"), color: SENT }, { key: "failed", label: t("Failed"), color: FAILED }, { key: "pending", label: t("Waiting"), color: PENDING }]} caption={t("Deliveries per day")} empty={nothing} />
            : unread}
        </Panel>
        <Panel title={t("Deliveries by purpose")} subtitle={t("What the last 7 days' messages were for, with how many failed. Guest messages include reminders and the messages logged on guests' profiles. Short notices to the Boss are not written down, so they are not counted.")}>
          {d.byPurpose
            ? <RankBars t={t} rows={d.byPurpose.map((r) => ({ key: r.key, label: t(PURPOSE_WORDS[r.key]), value: r.count, note: r.failed ? t("{n} failed", { n: r.failed }) : undefined }))} color={PURPOSE} caption={t("Deliveries by purpose")} empty={nothing} />
            : unread}
        </Panel>
      </div>

      <Panel title={t("The last closed days: reports")} subtitle={t("For each of the last 7 closed days: was the daily report and the room report made, by whom, and did it reach the Boss. OK = made and sent after it was made.")}>
        {d.reportDays
          ? <DataTable
              empty={nothing}
              cols={[{ label: t("Day") }, { label: t("Daily report") }, { label: t("Room report") }]}
              rows={d.reportDays.map((r) => ({
                key: r.date,
                cells: [
                  <span key="d" className="whitespace-nowrap font-medium">{t.date(r.date)}</span>,
                  <ReportCell key="a" t={t} k={r.daily} when={when} />,
                  <ReportCell key="b" t={t} k={r.room} when={when} />,
                ],
              }))}
            />
          : unread}
      </Panel>

      <Panel title={t("Failed or waiting deliveries")} subtitle={t("The newest {n} deliveries that failed or have not been sent. Only the kind of trouble is shown, never the provider's own words. A guest's arrival reminder is one line, however many times it failed.", { n: MESSAGE_ROWS.problems })}>
        {d.problems
          ? <DataTable
              empty={nothing}
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
          : unread}
      </Panel>

      <Panel title={t("When the automatic jobs run")} subtitle={t("Every day, at these times in hotel time. The times are read from the schedule file the hosting uses, not written twice. 'Last made' is the newest report the job itself made — the proof it ran; a report a person made by hand is shown apart.")}>
        {d.jobs
          ? <DataTable
              empty={nothing}
              cols={[{ label: t("Job") }, { label: t("Runs every day at") }, { label: t("Last made") }]}
              rows={d.jobs.map((j) => ({
                key: j.path,
                cells: [
                  <span key="j" className="block font-medium">{t(j.label)}<span className="block font-mono text-[11px] font-normal text-muted-foreground">{j.path}</span></span>,
                  <span key="t" className="tabular-nums">{[...j.times, ...j.other].join(" · ") || "—"}</span>,
                  <span key="l" className="block">
                    {j.lastMadeAt
                      ? <>{when(j.lastMadeAt)}<span className="block text-[11px] text-muted-foreground">{t("for {date}", { date: t.date(j.lastDate!) })} · {t("automatic")}</span></>
                      : t("Never made by the job")}
                    {j.lastByPerson && <span className="mt-1 block text-[11px] text-muted-foreground">{t("Last made by a person: {time} (for {date})", { time: when(j.lastByPerson.at), date: t.date(j.lastByPerson.date) })}</span>}
                  </span>,
                ],
              }))}
            />
          : unread}
      </Panel>
    </div>
  );
}

function ReportCell({ t, k, when }: { t: T; k: ReportKindRow; when: (x: Date) => string }) {
  return (
    <span className="block">
      <Tag tone={STATE_TONE[k.state]}>{t(REPORT_CELL_WORDS[k.state])}</Tag>
      {k.madeAt ? (
        <span className="mt-1 block text-[11px] leading-snug text-muted-foreground">
          {t("Made {time}", { time: when(k.madeAt) })} · {t("version {n}", { n: k.version ?? 1 })} · {k.automatic ? t("automatic") : t("made by a person")}
          {k.sentAt ? <> · {t("sent {time}", { time: when(k.sentAt) })}</> : null}
        </span>
      ) : <span className="mt-1 block text-[11px] text-muted-foreground"><Dash /></span>}
    </span>
  );
}
