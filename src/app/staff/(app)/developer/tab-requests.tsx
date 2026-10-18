import { CalendarClock, ConciergeBell, Inbox, Send } from "lucide-react";
import type { T } from "@/i18n/translate";
import type { RequestsGlance } from "@/server/services/developer-requests";
import { Panel } from "@/components/dashboard/kit";
import { BarChart, RankBars, type BarColumn } from "./console-charts";
import { dayLabel, num, Quiet, StatBlock } from "./console-ui";

/**
 * MESSAGES & REQUESTS (laid out like the owner's other console): what guests are told and what they ask for. Four figures, then
 * the messages per day and by kind, then the requests by state. Counts and plain words only — never a guest, a phone number, the
 * words of a message or of a request, or a room. It is reception's work, not the Developer's, so nothing here can be changed.
 */

const SENT = "#199e70";
const FAILED = "#d95926";
const KINDS = "#3987e5";
const GUEST_REQUESTS = "#c98500";
const BOOKING_REQUESTS = "#8466e0";

/** Every other day is written under its bar (today always), so the labels never touch, even on a phone. */
const dayTick = (i: number, count: number) => (count - 1 - i) % 2 === 0;

export function RequestsGlanceTab({ t, g }: { t: T; g: RequestsGlance; when: (d: Date) => string }) {
  const c = g.cards;
  const unread = <Quiet>{t("This could not be read just now.")}</Quiet>;
  const perDay: BarColumn[] | null = g.messagesPerDay
    ? g.messagesPerDay.map((d, i, all) => ({
      key: d.date, tick: dayTick(i, all.length) ? dayLabel(t, d.date) : "", name: dayLabel(t, d.date), values: { sent: d.sent, failed: d.failed }, emphasise: d.date === g.today,
    }))
    : null;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatBlock
          icon={Send} label={t("Messages sent (14 days)")} value={num(t, c.messages?.sent)} caption={c.messages ? t("to guests") : t("This could not be read just now.")}
          tag={c.messages ? t("Outbound") : undefined} tagTone="sky"
          note={t("Booking confirmed, welcome, reminders, thank-you and the rest, sent to guests by the system or by reception.")}
        />
        <StatBlock
          icon={Inbox} label={t("Waiting for staff")} value={num(t, c.waiting?.total)} caption={c.waiting ? t("nobody has taken them yet") : t("This could not be read just now.")}
          tag={c.waiting ? t("Inbox") : undefined} tagTone={c.waiting && c.waiting.total > 0 ? "amber" : "emerald"}
          note={t("Guest requests and booking requests that nobody has accepted yet. The staff bell rings for them. The bell keeps no read mark, so unread alerts cannot be counted.")}
        />
        <StatBlock
          icon={ConciergeBell} label={t("Guest requests")} value={num(t, c.guestRequests?.total)}
          caption={c.guestRequests ? t("{n} asked from the guest's phone", { n: num(t, c.guestRequests.fromPhone) }) : t("This could not be read just now.")}
          tag={c.guestRequests ? t("All time") : undefined} tagTone="gold"
          note={c.guestRequests ? t("Every request from a guest, asked from their phone or logged by reception. {n} are not finished yet.", { n: num(t, c.guestRequests.open) }) : undefined}
        />
        <StatBlock
          icon={CalendarClock} label={t("Booking requests")} value={num(t, c.bookingRequests?.total)}
          caption={c.bookingRequests ? t("{n} still open", { n: num(t, c.bookingRequests.open) }) : t("This could not be read just now.")}
          tag={c.bookingRequests ? t("All time") : undefined} tagTone="gold"
          note={t("People who asked to book from the website. Open means reception has not finished with the request.")}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("Messages to guests per day")} subtitle={t("Last 14 days, Tanzania time.")}>
          {perDay
            ? <BarChart t={t} columns={perDay} series={[{ key: "sent", label: t("Sent"), color: SENT }, { key: "failed", label: t("Failed"), color: FAILED }]} caption={t("Messages to guests per day")} empty={t("No messages sent in 14 days.")} />
            : unread}
        </Panel>
        <Panel title={t("What the messages were")} subtitle={t("By kind, last 30 days.")}>
          {g.messageKinds
            ? <RankBars t={t} rows={g.messageKinds.map((k) => ({ key: k.label, label: t(k.label), value: k.count, note: k.failed > 0 ? t("{n} failed", { n: num(t, k.failed) }) : undefined }))} color={KINDS} caption={t("What the messages were")} empty={t("No messages in 30 days.")} />
            : unread}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("Guest requests by status")} subtitle={t("Every request ever raised, by where it stands.")}>
          {g.guestRequestsByStatus
            ? <RankBars t={t} rows={g.guestRequestsByStatus.map((r) => ({ key: r.status, label: t(r.label), value: r.count }))} color={GUEST_REQUESTS} caption={t("Guest requests by status")} empty={t("No requests yet.")} />
            : unread}
        </Panel>
        <Panel title={t("Booking requests by status")} subtitle={t("People asking to book from the website, by where the request stands.")}>
          {g.bookingRequestsByStatus
            ? <RankBars t={t} rows={g.bookingRequestsByStatus.map((r) => ({ key: r.status, label: t(r.label), value: r.count }))} color={BOOKING_REQUESTS} caption={t("Booking requests by status")} empty={t("No requests yet.")} />
            : unread}
        </Panel>
      </div>
    </div>
  );
}
