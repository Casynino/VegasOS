import { MailWarning, Send } from "lucide-react";
import type { T } from "@/i18n/translate";
import { Panel } from "@/components/dashboard/kit";
import { MESSAGE_ROWS, type MessagesData } from "@/server/services/developer-messages";
import { BarChart, type BarColumn } from "./console-charts";
import { DataTable } from "./console-table";
import { dayLabel, num, Quiet, StatBlock, Tag } from "./console-ui";

/**
 * MESSAGES & REPORTS: is the Boss getting what he should. The text of a message is never shown — only what was sent, when, to
 * how many and how it went; a phone number shows its last three digits only; a failed delivery shows the KIND of trouble in plain
 * words, never the provider's own reply (it can echo the message).
 */

const SENT = "#199e70";
const FAILED = "#d95926";
const PENDING = "#c98500";
const dayTick = (i: number, count: number) => (count - 1 - i) % 2 === 0;

export function MessagesTab({ t, d, when }: { t: T; d: MessagesData; when: (x: Date) => string }) {
  const nothing = t("Nothing yet");
  const unread = <Quiet>{t("This could not be read just now.")}</Quiet>;
  const perDay: BarColumn[] | null = d.perDay
    ? d.perDay.map((r, i, all) => ({ key: r.date, tick: dayTick(i, all.length) ? dayLabel(t, r.date) : "", name: dayLabel(t, r.date), values: { sent: r.sent, failed: r.failed, pending: r.pending }, emphasise: r.date === d.today }))
    : null;
  // A chart with no delivery in it is not drawn (an empty box tells nothing): one quiet line says so instead.
  const hasDeliveries = !!d.perDay?.some((r) => r.sent + r.failed + r.pending > 0);
  const chart = (
    <Panel title={t("Deliveries per day")} subtitle={t("Last 14 days, by how they went.")}>
      {perDay
        ? <BarChart t={t} columns={perDay} height={150} series={[{ key: "sent", label: t("Sent"), color: SENT }, { key: "failed", label: t("Failed"), color: FAILED }, { key: "pending", label: t("Waiting"), color: PENDING }]} caption={t("Deliveries per day")} empty={nothing} />
        : unread}
    </Panel>
  );
  return (
    <div className="space-y-4">
      {/* The Boss's reports themselves are the panels right under "Needs your attention" (boss-reports.tsx); here is how the sending went. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <StatBlock
          icon={Send} label={t("WhatsApp deliveries, 24 hours")} value={d.deliveries24h ? num(t, d.deliveries24h.sent) : "—"} caption={t("sent in the last 24 hours")} warn={!!d.deliveries24h?.failed}
          tag={d.deliveries24h ? (d.deliveries24h.failed > 0 ? t("{n} failed", { n: d.deliveries24h.failed }) : t("None failed")) : undefined} tagTone={d.deliveries24h?.failed ? "amber" : "emerald"}
          note={d.deliveries24h ? t("Reports and reminders sent by WhatsApp. Failed (last try in 24 hours): {failed}. Waiting to be sent (made in the last 7 days): {waiting}.", { failed: d.deliveries24h.failed, waiting: d.deliveries24h.waiting }) : undefined}
        />
        <StatBlock
          icon={MailWarning} label={t("Failed deliveries, 7 days")} value={d.retry ? num(t, d.retry.underMax + d.retry.atMax) : "—"} caption={t("failed in the last 7 days")}
          tag={d.retry ? (d.retry.atMax > 0 ? t("{n} had all {max} tries", { n: d.retry.atMax, max: d.maxAttempts }) : t("None had all {max} tries", { max: d.maxAttempts })) : undefined} tagTone={d.retry?.atMax ? "amber" : "emerald"}
          note={d.retry ? t("Fewer than {max} tries so far: {under} (a job may try again, but not every kind of message is tried again). All {max} tries used: {at} — no more automatic tries; only a person's 'send again' tries more.", { max: d.maxAttempts, under: d.retry.underMax, at: d.retry.atMax }) : undefined}
        />
      </div>

      {perDay && !hasDeliveries ? <Quiet>{t("Deliveries per day: nothing in the last 14 days.")}</Quiet> : chart}

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
