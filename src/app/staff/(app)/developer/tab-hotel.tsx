import type { T } from "@/i18n/translate";
import { formatTZS } from "@/lib/format";
import { RESERVATION_STATUS_META } from "@/lib/reservation-status";
import { ROOM_STATUS_META } from "@/lib/room-status";
import { REQUEST_TYPE_LABEL } from "@/lib/request-meta";
import { SHIFT_OPEN_LIMIT_HOURS } from "@/server/services/developer-health";
import { ORDER_STATUS_WORDS, OPEN_LOOKBACK_DAYS, HOTEL_ROWS, type HotelData } from "@/server/services/developer-hotel";
import { Panel } from "@/components/dashboard/kit";
import { BarChart, type BarColumn } from "./console-charts";
import { DataTable, Dash } from "./console-table";
import { dayLabel, num, PALETTE, Quiet, StatBlock, Tag, waitText } from "./console-ui";

/**
 * HOTEL: what is really happening in the hotel — now (the cards), over the last 14 hotel days (the charts) and in detail (the tables).
 * Read-only. Occupancy, check-ins and check-outs are the Boss's own figures; every card says exactly what it counts.
 */

const OCCUPANCY = "#3987e5";
const CHECK_IN = "#199e70";
const CHECK_OUT = "#d95926";
const ORDERS = "#c98500";
const SALES = "#8466e0";
/** An order waiting this long without being served is worth a look. */
const SLOW_ORDER_MINUTES = 60;

/** Every other day is written under its bar (today always), so the labels never touch, even on a phone. */
const dayTick = (i: number, count: number) => (count - 1 - i) % 2 === 0;

export function HotelTab({ t, h, when }: { t: T; h: HotelData; when: (d: Date) => string }) {
  const c = h.cards;
  const dayColumns = <R extends { date: string }>(rows: R[] | null, values: (r: R) => Record<string, number>): BarColumn[] | null =>
    rows ? rows.map((r, i, all) => ({ key: r.date, tick: dayTick(i, all.length) ? dayLabel(t, r.date) : "", name: dayLabel(t, r.date), values: values(r), emphasise: r.date === h.today })) : null;

  const occupancyColumns = dayColumns(h.occupancyPerDay, (r) => ({ percent: r.percent }));
  const movementColumns = dayColumns(h.movementPerDay, (r) => ({ in: r.checkIns, out: r.checkOuts }));
  const orderColumns = dayColumns(h.ordersPerDay, (r) => ({ orders: r.orders }));
  const salesColumns = dayColumns(h.ordersPerDay, (r) => ({ total: r.total }));
  const sources = h.bookingsPerDay?.sources ?? [];
  const bookingColumns: BarColumn[] | null = h.bookingsPerDay
    ? h.bookingsPerDay.days.map((d, i, all) => ({ key: d.date, tick: dayTick(i, all.length) ? dayLabel(t, d.date) : "", name: dayLabel(t, d.date), values: d.bySource, emphasise: d.date === h.today }))
    : null;
  const nothing = t("Nothing yet");
  const unread = <Quiet>{t("This could not be read just now.")}</Quiet>;
  const longShift = c.shifts?.some((s) => s.long) ?? false;

  return (
    <div className="space-y-4">
      <p className="text-sm text-muted-foreground">
        {t("What is happening in the hotel, now and over the last 14 days. Read-only: nothing here can be changed. A hotel day runs from {start} to {start} the next morning (hotel time).", { start: h.dayStart })}
      </p>

      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
        <StatBlock
          label={t("Rooms with a guest")} value={c.rooms ? t("{n} of {total}", { n: c.rooms.occupied, total: c.rooms.total }) : "—"} caption={t("guest rooms with someone in them right now")}
          tag={c.rooms?.percent != null ? t("{percent}% full", { percent: c.rooms.percent }) : t("Not known")} tagTone="sky"
          note={c.bossOccupancy
            ? t("The Boss's occupancy for today so far is {percent}% ({nights} nights sold of {sellable} rooms to sell). It counts nights sold, so it is not the same as the rooms with a guest right now. The meeting room is never counted.", { percent: c.bossOccupancy.percent, nights: c.bossOccupancy.nights, sellable: c.bossOccupancy.sellable })
            : t("The meeting room is never counted.")}
        />
        <StatBlock
          label={t("Guests in the house")} value={c.inHouse ? num(t, c.inHouse.people) : "—"} caption={c.inHouse ? t("people staying now, in {n} bookings", { n: c.inHouse.bookings }) : t("people staying now")}
          tag={t.ctx("console", "Live")} tagTone="emerald" note={t("Adults and children in guest rooms that have checked in and not yet checked out.")}
        />
        <StatBlock
          label={t("Arrivals today")} value={c.arrivals ? num(t, c.arrivals.checkedIn) : "—"} caption={t("checked in today")}
          tag={c.arrivals ? (c.arrivals.expected > 0 ? t("{n} still expected", { n: c.arrivals.expected }) : t("Nobody waiting")) : undefined} tagTone={c.arrivals && c.arrivals.expected > 0 ? "amber" : "emerald"}
          note={t("Checked in = guest rooms checked in during the hotel day, the same count as the room report. Still expected = bookings due today or earlier that have not arrived.")}
        />
        <StatBlock
          label={t("Departures today")} value={c.departures ? num(t, c.departures.checkedOut) : "—"} caption={t("checked out today")}
          tag={c.departures ? (c.departures.expected > 0 ? t("{n} still to leave", { n: c.departures.expected }) : t("Nobody waiting")) : undefined} tagTone={c.departures && c.departures.expected > 0 ? "amber" : "emerald"}
          note={t("Checked out = guest rooms checked out during the hotel day, the same count as the room report. Still to leave = guests in the hotel whose check-out day is today or earlier.")}
        />
        <StatBlock
          label={t("Housekeeping")} value={c.housekeeping ? num(t, c.housekeeping.toClean) : "—"} caption={t("rooms to clean")}
          tag={c.housekeeping ? (c.housekeeping.outOfService > 0 ? t("{n} out of service", { n: c.housekeeping.outOfService }) : t("None out of service")) : undefined} tagTone={c.housekeeping && c.housekeeping.outOfService > 0 ? "amber" : "emerald"}
          note={t("To clean = rooms that are dirty or being cleaned. Out of service = rooms under maintenance or taken out of service.")}
        />
        <StatBlock
          label={t("Reception shift")} value={c.shifts ? num(t, c.shifts.length) : "—"} caption={t("receptionists on shift now")} warn={longShift}
          tag={c.shifts ? (longShift ? t("Open over {h} hours", { h: SHIFT_OPEN_LIMIT_HOURS }) : c.shifts.length ? t("On shift") : t("Nobody on shift")) : undefined} tagTone={longShift ? "amber" : c.shifts?.length ? "emerald" : "slate"}
          note={c.shifts?.length ? c.shifts.map((s) => t("{name} since {time}", { name: s.who, time: when(s.since) })).join(" · ") : t("A shift left open for more than {h} hours is probably forgotten.", { h: SHIFT_OPEN_LIMIT_HOURS })}
        />
        <StatBlock
          label={t("Restaurant orders open")} value={c.orders ? num(t, c.orders.open) : "—"} caption={t("not served yet")}
          warn={(c.orders?.oldestMinutes ?? 0) >= SLOW_ORDER_MINUTES}
          tag={c.orders ? (c.orders.oldestMinutes !== null ? t("Oldest waiting {wait}", { wait: waitText(t, c.orders.oldestMinutes) }) : t("Nothing waiting")) : undefined}
          tagTone={(c.orders?.oldestMinutes ?? 0) >= SLOW_ORDER_MINUTES ? "amber" : "sky"}
          note={t("Orders of the last {days} days that are new, accepted, being prepared, ready or being served. The wait is the time since the order was placed.", { days: OPEN_LOOKBACK_DAYS })}
        />
        <StatBlock
          label={t("Guest requests open")} value={c.requests ? num(t, c.requests.open) : "—"} caption={t("not finished yet")}
          tag={c.requests ? (c.requests.oldestMinutes !== null ? t("Oldest asked {wait} ago", { wait: waitText(t, c.requests.oldestMinutes) }) : t("Nothing waiting")) : undefined} tagTone="sky"
          note={t("Towels, cleaning, repairs and other things guests asked for that nobody has finished. The age is the time since the guest asked.")}
        />
        <StatBlock
          label={t("Online booking requests")} value={c.bookingRequests ? num(t, c.bookingRequests.open) : "—"} caption={t("waiting for a decision")}
          tag={c.bookingRequests ? (c.bookingRequests.fresh > 0 ? t("{n} new", { n: c.bookingRequests.fresh }) : t("None new")) : undefined} tagTone={c.bookingRequests && c.bookingRequests.fresh > 0 ? "amber" : "emerald"}
          note={t("Requests from the website and the Hotel QR that reception has not yet turned into a booking or closed.")}
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("Occupancy per day")} subtitle={t("The share of guest rooms sold on each hotel day (nights sold ÷ rooms to sell), the same figure as the Boss's reports. Last 14 days. Hover a bar for exact numbers; the table below has them all.")}>
          {occupancyColumns
            ? <BarChart t={t} columns={occupancyColumns} series={[{ key: "percent", label: t("Occupancy"), color: OCCUPANCY }]} caption={t("Occupancy per day")} empty={nothing} format={(v) => `${v}%`} top={100} />
            : unread}
        </Panel>
        <Panel title={t("Check-ins and check-outs per day")} subtitle={t("Guest rooms checked in and checked out on each hotel day, counted by the moment it really happened — the same count as the room report. Last 14 days.")}>
          {movementColumns
            ? <BarChart t={t} columns={movementColumns} grouped series={[{ key: "in", label: t("Checked in"), color: CHECK_IN }, { key: "out", label: t("Checked out"), color: CHECK_OUT }]} caption={t("Check-ins and check-outs per day")} empty={nothing} />
            : unread}
        </Panel>
        <Panel title={t("Restaurant and bar orders per day")} subtitle={t("Orders placed each hotel day, cancelled ones left out. Last 14 days.")}>
          {orderColumns
            ? <BarChart t={t} columns={orderColumns} series={[{ key: "orders", label: t("Orders"), color: ORDERS }]} caption={t("Restaurant and bar orders per day")} empty={nothing} />
            : unread}
        </Panel>
        <Panel title={t("Restaurant and bar orders: value per day")} subtitle={t("The value of the orders placed each hotel day, in TZS. It is what was sold, not money received (some orders are paid later or put on a room bill).")}>
          {salesColumns
            ? <BarChart t={t} columns={salesColumns} series={[{ key: "total", label: t("Order value"), color: SALES }]} caption={t("Restaurant and bar orders: value per day")} empty={nothing} format={formatTZS} axis={(v) => num(t, v)} />
            : unread}
        </Panel>
        <Panel className="lg:col-span-2" title={t("New bookings per day")} subtitle={t("Bookings made on each hotel day, by where they came from. Last 14 days. A booking is made on one day and the guest arrives later, so this is not the same as check-ins.")}>
          {bookingColumns
            ? <BarChart t={t} columns={bookingColumns} series={sources.map((s, i) => ({ key: s.id, label: t(s.name), color: PALETTE[i % PALETTE.length] }))} caption={t("New bookings per day")} empty={nothing} />
            : unread}
        </Panel>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Panel title={t("Today's arrivals")} subtitle={t("Every booking due today, with where it stands, and late ones that have not arrived. The first {n} are shown.", { n: HOTEL_ROWS.movement })}>
          {h.arrivals
            ? <DataTable
                empty={nothing} more={h.arrivals.total > h.arrivals.rows.length ? t("and {n} more", { n: h.arrivals.total - h.arrivals.rows.length }) : undefined}
                cols={[{ label: t("Guest") }, { label: t("Room") }, { label: t("Status") }]}
                rows={h.arrivals.rows.map((r) => ({
                  key: r.id,
                  cells: [
                    <span key="g" className="block"><span className="font-medium">{r.guest}</span><span className="block font-mono text-[11px] text-muted-foreground">{r.reference}</span></span>,
                    r.rooms.length ? r.rooms.join(", ") : <Dash key="r" />,
                    <span key="s" className="inline-flex flex-wrap items-center gap-1.5">{t(RESERVATION_STATUS_META[r.status].label)}{r.late && <Tag tone="amber">{t("Late")}</Tag>}</span>,
                  ],
                }))}
              />
            : unread}
        </Panel>
        <Panel title={t("Today's departures")} subtitle={t("Guests in the hotel whose check-out day is today or earlier, and guests who have left today. The first {n} are shown.", { n: HOTEL_ROWS.movement })}>
          {h.departures
            ? <DataTable
                empty={nothing} more={h.departures.total > h.departures.rows.length ? t("and {n} more", { n: h.departures.total - h.departures.rows.length }) : undefined}
                cols={[{ label: t("Guest") }, { label: t("Room") }, { label: t("Status") }]}
                rows={h.departures.rows.map((r) => ({
                  key: r.id,
                  cells: [
                    <span key="g" className="block"><span className="font-medium">{r.guest}</span><span className="block font-mono text-[11px] text-muted-foreground">{r.reference}</span></span>,
                    r.rooms.length ? r.rooms.join(", ") : <Dash key="r" />,
                    <span key="s" className="inline-flex flex-wrap items-center gap-1.5">{t(RESERVATION_STATUS_META[r.status].label)}{r.late && <Tag tone="amber">{t("Overdue")}</Tag>}</span>,
                  ],
                }))}
              />
            : unread}
        </Panel>
        <Panel title={t("Longest-open restaurant orders")} subtitle={t("The {n} orders that have waited longest without being served.", { n: HOTEL_ROWS.orders })}>
          {h.longestOrders
            ? <DataTable
                empty={nothing}
                cols={[{ label: t("Order") }, { label: t("Place") }, { label: t("Waiter") }, { label: t("Open for"), num: true }]}
                rows={h.longestOrders.map((o) => ({
                  key: o.id,
                  cells: [
                    <span key="o" className="block"><span className="font-mono text-xs">{o.number}</span><span className="block text-[11px] text-muted-foreground">{t(ORDER_STATUS_WORDS[o.status])}</span></span>,
                    o.table ?? (o.room ? t("Room {room}", { room: o.room }) : <Dash key="p" />),
                    o.waiter ?? <Dash key="w" />,
                    waitText(t, o.minutes),
                  ],
                }))}
              />
            : unread}
        </Panel>
        <Panel title={t("Open guest requests")} subtitle={t("The {n} requests that have waited longest.", { n: HOTEL_ROWS.requests })}>
          {h.openRequests
            ? <DataTable
                empty={nothing}
                cols={[{ label: t("Room or guest") }, { label: t("What") }, { label: t("Age"), num: true }]}
                rows={h.openRequests.map((r) => ({
                  key: r.id,
                  cells: [
                    r.room ? t("Room {room}", { room: r.room }) : r.guest ?? <Dash key="g" />,
                    t(REQUEST_TYPE_LABEL[r.type] ?? REQUEST_TYPE_LABEL.OTHER),
                    waitText(t, r.minutes),
                  ],
                }))}
              />
            : unread}
        </Panel>
        <Panel className="lg:col-span-2" title={t("Rooms by status")} subtitle={t("Every guest room counted once, by its status right now. The meeting room is not counted.")}>
          {h.roomsByStatus
            ? <DataTable
                empty={nothing}
                cols={[{ label: t("Status") }, { label: t("Rooms"), num: true }]}
                rows={h.roomsByStatus.map((r) => ({ key: r.status, cells: [t(ROOM_STATUS_META[r.status].label), num(t, r.count)] }))}
              />
            : unread}
        </Panel>
      </div>
    </div>
  );
}
