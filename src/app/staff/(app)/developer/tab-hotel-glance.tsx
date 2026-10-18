import { BedDouble, CalendarPlus, ClipboardList, Contact } from "lucide-react";
import type { T } from "@/i18n/translate";
import { BOOKING_STAGE_WORDS, ROOMS_SHOWN, type HotelGlance } from "@/server/services/developer-hotel-glance";
import type { ReservationStatus } from "@/generated/prisma/enums";
import { Panel } from "@/components/dashboard/kit";
import { BarChart, RankBars, type BarColumn } from "./console-charts";
import { DataTable, Dash } from "./console-table";
import { dayLabel, num, PALETTE, Quiet, StatBlock, Tag, type TagTone } from "./console-ui";

/**
 * HOTEL (the Cargo analogue of the owner's other console): what is in the system and where it is. Read-only, counts and plain words only —
 * never a guest's name or phone, never an amount. Four stat cards, then the bookings per day and where they come from, the stages and the
 * latest bookings, and the rooms as they are this minute.
 */

const STAGES = "#3987e5";
const SOURCES = "#c98500";
const ROOMS = "#199e70";

const STAGE_TONE: Record<ReservationStatus, TagTone> = {
  INQUIRY: "slate", RESERVED: "amber", CONFIRMED: "sky", CHECKED_IN: "emerald", CHECKED_OUT: "slate", CANCELLED: "rose", NO_SHOW: "amber",
};

/** Every other day is written under its bar (today always), so the labels never touch, even on a phone. */
const dayTick = (i: number, count: number) => (count - 1 - i) % 2 === 0;

export function HotelGlanceTab({ t, g, when }: { t: T; g: HotelGlance; when: (d: Date) => string }) {
  const c = g.cards;
  const unread = <Quiet>{t("This could not be read just now.")}</Quiet>;
  const columns: BarColumn[] | null = g.addedPerDay
    ? g.addedPerDay.days.map((d, i, all) => ({ key: d.date, tick: dayTick(i, all.length) ? dayLabel(t, d.date) : "", name: dayLabel(t, d.date), values: d.bySource, emphasise: d.date === g.today }))
    : null;
  const roomsLabel = (r: { rooms: string[]; roomCount: number }) => (r.rooms.length ? `${r.rooms.join(", ")}${r.roomCount > ROOMS_SHOWN ? ` +${r.roomCount - ROOMS_SHOWN}` : ""}` : null);
  const mv = g.movement;

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatBlock
          icon={ClipboardList} label={t("Bookings in the system")} value={num(t, c.bookings?.alive)}
          caption={c.bookings ? t("{n} ever", { n: num(t, c.bookings.ever) }) : t("This could not be read just now.")}
          tag={t("Active")} tagTone="emerald"
          note={t("Bookings that are still to come or in the hotel now, out of all bookings ever made.")}
        />
        <StatBlock
          icon={CalendarPlus} label={t("Bookings added (7 days)")} value={num(t, c.added?.count)}
          caption={c.added ? t("reception, online and the hotel QR together") : t("This could not be read just now.")}
          tag={t("Intake")} tagTone="sky"
          note={t("Bookings made in the last 7 hotel days, the same count as the Boss's new bookings. A hotel day runs from {start} to {start} the next morning.", { start: g.dayStart })}
        />
        <StatBlock
          icon={BedDouble} label={t("Rooms with a guest")} value={c.rooms ? t("{n} of {total}", { n: c.rooms.occupied, total: c.rooms.total }) : "—"}
          caption={c.rooms ? t("guest rooms with someone in them now") : t("This could not be read just now.")}
          tag={c.rooms ? (c.rooms.percent !== null ? t("{percent}% full", { percent: c.rooms.percent }) : t("Not known")) : undefined} tagTone="gold"
          note={t("Guest rooms that have a guest checked in right now. The meeting room is never counted.")}
        />
        <StatBlock
          icon={Contact} label={t("Guests on the books")} value={num(t, c.guests?.total)}
          caption={c.guests ? t("{n} new in 30 days", { n: num(t, c.guests.added) }) : t("This could not be read just now.")}
          tag={t("On the books")} tagTone="slate"
          note={t("The people in the customer database. Only the number is shown here, never a name or a phone number.")}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("Bookings added per day")} subtitle={t("Last 14 days, Tanzania time.")}>
          {columns && g.addedPerDay
            ? <BarChart
                t={t} columns={columns} series={g.addedPerDay.sources.map((s, i) => ({ key: s.id, label: t(s.name), color: PALETTE[i % PALETTE.length] }))}
                caption={t("Bookings added per day")} empty={t("No bookings were added in these 14 days.")}
              />
            : unread}
        </Panel>
        <Panel title={t("Where bookings come from")} subtitle={t("How the bookings reached the system, last 30 days.")}>
          {g.sources
            ? <RankBars t={t} rows={g.sources.map((s) => ({ key: s.id, label: t(s.name), value: s.count }))} color={SOURCES} caption={t("Where bookings come from")} empty={t("No bookings were added in the last 30 days.")} />
            : unread}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("Bookings by stage")} subtitle={t("Where every booking is right now.")}>
          {g.stages
            ? <RankBars t={t} rows={g.stages.map((s) => ({ key: s.status, label: t(BOOKING_STAGE_WORDS[s.status]), value: s.count }))} color={STAGES} caption={t("Bookings by stage")} empty={t("There are no bookings yet.")} />
            : unread}
        </Panel>
        <Panel
          title={t("Latest bookings")}
          subtitle={mv ? t("{arriving} arriving today · {inHouse} in the hotel · {leaving} leaving today", { arriving: mv.arriving, inHouse: mv.inHouse, leaving: mv.leaving }) : t("The newest bookings and where each one stands.")}
        >
          {g.latest
            ? <DataTable
                empty={t("There are no bookings yet.")}
                cols={[{ label: t("Reference") }, { label: t("Stage") }, { label: t("Rooms") }, { label: t("Arrives") }, { label: t("Leaves") }]}
                rows={g.latest.map((r) => ({
                  key: r.id,
                  cells: [
                    <span key="r" className="font-mono text-xs">{r.reference}</span>,
                    <Tag key="s" tone={STAGE_TONE[r.status]}>{t(BOOKING_STAGE_WORDS[r.status])}</Tag>,
                    roomsLabel(r) ?? <Dash key="m" />,
                    <span key="a" className="whitespace-nowrap">{dayLabel(t, r.arrives)}</span>,
                    <span key="l" className="whitespace-nowrap">{dayLabel(t, r.leaves)}</span>,
                  ],
                }))}
              />
            : unread}
        </Panel>
      </div>

      <Panel
        title={t("Rooms right now")} subtitle={t("Every guest room, as it is this minute.")}
        action={<span className="shrink-0 text-xs text-muted-foreground">{t("as of {time}", { time: when(g.readAt) })}</span>}
      >
        {g.roomStates
          ? <RankBars
              t={t} color={ROOMS} caption={t("Rooms right now")} empty={t("There are no guest rooms yet.")}
              rows={g.roomStates.total === 0 ? [] : [
                { key: "occupied", label: t("Occupied"), value: g.roomStates.occupied },
                { key: "ready", label: t("Ready"), value: g.roomStates.ready },
                { key: "cleaning", label: t("Dirty / being cleaned"), value: g.roomStates.cleaning },
                { key: "out", label: t("Out of service"), value: g.roomStates.outOfService },
              ]}
            />
          : unread}
      </Panel>
    </div>
  );
}
