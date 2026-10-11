"use client";

import type { ReactNode } from "react";
import { useT } from "@/i18n/client";
import type { T } from "@/i18n/translate";
import { ROOM_STATUS_META } from "@/lib/room-status";
import {
  HK_GROUPS, guestTotals, guestsIn, housekeepingTotals,
  type GuestList, type GuestRow, type HkGroup, type HkRow, type HousekeepingList, type OccupiedService,
} from "@/lib/daily-lists";

/**
 * The two sheets reception prints. Made for a pen and a black-and-white printer: full-ink lines, big room numbers,
 * empty boxes to tick, tall rows. One table per sheet so its headings repeat on every page.
 * Ticks made on paper change nothing in the system.
 */

export type ListHotel = { name: string; address: string; contact: string };
/** A printed copy carries its number and who printed it; the live preview has neither yet. */
export type ListStamp = { number: string | null; by: string | null };
export const LIST_PAPER_ID = "daily-list";

const INK = "#111111", MUTED = "#45413b", BAND = "#e9e7e2";
const cell = "border px-1.5 py-1 align-middle";
const line = { borderColor: INK } as const;

/** An empty box for a pen. */
const Box = ({ label }: { label?: string }) => (
  <span className="inline-flex items-center gap-1 whitespace-nowrap">
    <span aria-hidden className="inline-block size-[13px] shrink-0 border-[1.5px] bg-white" style={line} />{label}
  </span>
);
/** A label with a line to write on. */
const WriteLine = ({ label, className = "" }: { label: string; className?: string }) => (
  <div className={`flex items-end gap-1.5 ${className}`}>
    <span className="shrink-0 text-[10.5px] font-semibold">{label}</span>
    <span className="h-7 flex-1 border-b" style={line} />
  </div>
);

function Letterhead({ hotel, title, date, generatedAt, timezone, stamp, t }: {
  hotel: ListHotel; title: string; date: string; generatedAt: string; timezone: string; stamp: ListStamp; t: T;
}) {
  return (
    <header data-break className="flex items-start justify-between gap-4 border-b-2 pb-3" style={line}>
      <div className="flex min-w-0 items-center gap-3">
        {/* eslint-disable-next-line @next/next/no-img-element -- a plain picture prints and saves to PDF as it is */}
        <img src="/brand/logo-192.png" alt="" width={52} height={52} className="size-[52px] shrink-0" />
        <div className="min-w-0">
          <p className="text-[11px] font-semibold uppercase tracking-[0.2em]">{hotel.name}</p>
          <h1 className="font-display text-[26px] font-semibold leading-tight">{title}</h1>
          <p className="text-[13px] font-semibold">{t("Reporting date: {date}", { date: t.date(date, true) })}</p>
        </div>
      </div>
      <div className="shrink-0 text-right text-[11px] leading-relaxed">
        <p className="text-[12px] font-bold tabular-nums">{stamp.number ?? t("Preview — not printed yet")}</p>
        <p>{t("Generated: {when}", { when: t.dateTime(generatedAt, timezone) })}</p>
        {stamp.by && <p>{t("Printed by: {name}", { name: stamp.by })}</p>}
      </div>
    </header>
  );
}

function Totals({ items }: { items: { label: string; value: ReactNode; sub?: string }[] }) {
  return (
    <div data-break className="mt-3 grid border-l border-t text-center" style={{ ...line, gridTemplateColumns: `repeat(${items.length}, minmax(0, 1fr))` }}>
      {items.map((i) => (
        <div key={i.label} className="border-b border-r px-1.5 py-1.5" style={line}>
          <p className="text-[9.5px] font-semibold uppercase leading-tight tracking-wide">{i.label}</p>
          <p className="text-[22px] font-bold leading-tight tabular-nums">{i.value}</p>
          {i.sub && <p className="text-[9.5px] leading-tight" style={{ color: MUTED }}>{i.sub}</p>}
        </div>
      ))}
    </div>
  );
}

function Sheet({ landscape, children }: { landscape?: boolean; children: ReactNode }) {
  return (
    <div className="list-scroll overflow-x-auto print:overflow-visible">
      <article id={LIST_PAPER_ID} data-landscape={landscape ? "true" : undefined}
        className={`mx-auto w-full rounded-3xl bg-white p-5 text-[11.5px] leading-snug shadow-sm sm:p-8 print:max-w-none print:rounded-none print:p-0 print:shadow-none ${landscape ? "min-w-[1000px] max-w-[1120px]" : "min-w-[720px] max-w-[820px]"} print:min-w-0`}
        style={{ color: INK }}>
        {children}
      </article>
    </div>
  );
}

// ─────────────────────────── Daily Housekeeping Checklist ───────────────────────────

const HK_TITLE: Record<HkGroup, (t: T) => { title: string; note: string }> = {
  CHECKOUT: (t) => ({ title: t("Check-out cleaning"), note: t("Full clean. Rooms a guest arrives into today come first.") }),
  OCCUPIED: (t) => ({ title: t("Occupied rooms — the guest is staying on"), note: "" }),
  READY: (t) => ({ title: t("Already clean and ready"), note: t("No cleaning needed.") }),
  ATTENTION: (t) => ({ title: t("Other rooms needing attention"), note: t("Not ready for a guest. Do not prepare without reception.") }),
};

function hkRequired(r: HkRow, rule: OccupiedService, t: T): { text: string; yes: boolean } {
  if (r.group === "CHECKOUT") return { yes: true, text: r.status === "OCCUPIED" ? t("Yes — after the guest checks out") : t("Yes — full clean") };
  if (r.group === "OCCUPIED") {
    if (r.request) return { yes: true, text: t("Yes — the guest asked") };
    return rule === "DAILY" ? { yes: true, text: t("Yes — daily service") } : { yes: false, text: t("Only if the guest asks") };
  }
  if (r.group === "READY") return { yes: false, text: t("No") };
  return { yes: false, text: r.mismatch ? t("Check with reception first") : t("No — do not prepare") };
}

function HkStatus({ r, timezone, t }: { r: HkRow; timezone: string; t: T }) {
  const sub = r.stay === "OVERDUE" ? t("Check-out time passed: {when}", { when: t.dateTime(r.leavesAt!, timezone) })
    : r.stay === "DUE_TODAY" ? t("Leaves today, {time}", { time: t.time(r.leavesAt!, timezone) })
    : r.stay === "IN_HOUSE" ? t("Staying until {date}", { date: t.dayMonth(r.leavesOn!) })
    : null;
  return (
    <>
      <p className="font-semibold">{t(ROOM_STATUS_META[r.status].label)}</p>
      {sub && <p className="text-[10px]" style={{ color: MUTED }}>{sub}</p>}
    </>
  );
}

function HkProgress({ r, timezone, t }: { r: HkRow; timezone: string; t: T }) {
  if (r.group === "OCCUPIED") {
    return <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[10.5px]"><Box label={t("Serviced")} /><Box label={t("Do not disturb")} /><Box label={t("Guest declined")} /></div>;
  }
  if (r.group === "READY") return <p>{t("Clean and ready")}</p>;
  if (r.group === "CHECKOUT") {
    if (r.status === "OCCUPIED") return <p>{t("Guest still in the room")}</p>;
    return (
      <>
        <p className="font-semibold">{r.status === "CLEANING" ? t("Cleaning in progress") : t("Waiting to be cleaned")}</p>
        <p className="text-[10px]" style={{ color: MUTED }}>{t("since {when}", { when: t.dateTime(r.since, timezone) })}</p>
      </>
    );
  }
  if (r.mismatch === "NO_GUEST") return <p className="font-semibold">{t("Marked occupied, but no guest is checked in")}</p>;
  if (r.mismatch === "GUEST_IN") return <p className="font-semibold">{t("A guest is checked in, but the room is not marked occupied")}</p>;
  if (r.closure) return <p className="font-semibold">{r.closure === "MAINTENANCE" ? t("Closed today for maintenance") : t("Closed today — out of service")}</p>;
  return <p className="font-semibold">{r.status === "MAINTENANCE" ? t("Under maintenance") : t("Out of service")}</p>;
}

function HkNotes({ r, t }: { r: HkRow; t: T }) {
  const lines: ReactNode[] = [];
  if (r.arrivalToday) lines.push(<strong key="a">{r.group === "CHECKOUT" ? t("Guest arriving today — clean first") : t("Guest arriving today")}</strong>);
  if (r.request) lines.push(<span key="q">{t("Guest asked: {text}", { text: r.request })}</span>);
  if (r.reason) lines.push(<span key="r">{r.reason}</span>);
  if (r.closedUntil) lines.push(<span key="u">{t("Closed until {date}", { date: t.dayMonth(r.closedUntil) })}</span>);
  return <div className="space-y-0.5 break-words text-[10.5px]">{lines.map((l, i) => <p key={i}>{l}</p>)}</div>;
}

export function HousekeepingPaper({ list, hotel, stamp }: { list: HousekeepingList; hotel: ListHotel; stamp: ListStamp }) {
  const t = useT();
  const tz = list.timezone;
  const x = housekeepingTotals(list);
  const rule = list.occupiedService;
  const cols = [t("Room No."), t("Room type"), t("Current status"), t("Cleaning required?"), t("Cleaning status"), t("Staff tick / initials"), t("Notes")];
  return (
    <Sheet>
      <Letterhead hotel={hotel} title={t("Daily Housekeeping Checklist")} date={list.date} generatedAt={list.generatedAt} timezone={tz} stamp={stamp} t={t} />
      <Totals items={[
        { label: t("Rooms listed"), value: x.listed },
        { label: t("Requiring cleaning"), value: x.toClean, sub: t("{checkout} check-out · {occupied} occupied", { checkout: x.checkout, occupied: x.occupiedService }) },
        { label: t("Awaiting cleaning"), value: x.waiting, sub: x.inProgress ? t("{n} being cleaned now", { n: x.inProgress }) : undefined },
        { label: t("Already ready"), value: x.ready },
        { label: t("Requiring attention"), value: x.attention },
      ]} />
      <p data-break className="mt-1.5 text-[10px]" style={{ color: MUTED }}>
        {rule === "DAILY"
          ? t("Hotel rule for occupied rooms: daily service — a light service each day, not a full clean.")
          : t("Hotel rule for occupied rooms: on request — serviced only when the guest asks.")}
      </p>

      <table className="mt-2 w-full table-fixed border-collapse" style={line}>
        <colgroup><col style={{ width: "9%" }} /><col style={{ width: "14%" }} /><col style={{ width: "16%" }} /><col style={{ width: "15%" }} /><col style={{ width: "19%" }} /><col style={{ width: "10%" }} /><col style={{ width: "17%" }} /></colgroup>
        <thead>
          <tr style={{ background: BAND }}>
            {cols.map((c) => <th key={c} className="border border-b-2 px-1.5 py-1.5 text-left text-[9.5px] font-bold uppercase leading-tight tracking-wide" style={line}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {HK_GROUPS.map((g, gi) => {
            const rows = list.rows.filter((r) => r.group === g);
            const head = HK_TITLE[g](t);
            return [
              <tr key={g} data-break data-heading className="break-inside-avoid break-after-avoid">
                <td colSpan={7} className="border border-t-2 px-2 py-1.5" style={{ ...line, background: BAND }}>
                  <span className="text-[12.5px] font-bold uppercase tracking-wide">{gi + 1}. {head.title}</span>
                  <span className="float-right text-[12.5px] font-bold tabular-nums">{t.plural(rows.length, "{n} room", "{n} rooms")}</span>
                  {head.note && <span className="ml-2 text-[10px]" style={{ color: MUTED }}>{head.note}</span>}
                </td>
              </tr>,
              ...(rows.length ? rows.map((r) => {
                const need = hkRequired(r, rule, t);
                return (
                  <tr key={r.roomId} data-break className="h-10 break-inside-avoid">
                    <td className={`${cell} text-center text-[21px] font-extrabold leading-none tabular-nums`} style={line}>{r.room}</td>
                    <td className={cell} style={line}>{t(r.type)}</td>
                    <td className={cell} style={line}><HkStatus r={r} timezone={tz} t={t} /></td>
                    <td className={`${cell} ${need.yes ? "font-bold" : ""}`} style={line}>{need.text}</td>
                    <td className={cell} style={line}><HkProgress r={r} timezone={tz} t={t} /></td>
                    <td className={cell} style={line}>
                      {r.group === "CHECKOUT" || r.group === "OCCUPIED"
                        ? <span className="flex items-end gap-1.5"><Box /><span className="h-4 flex-1 border-b" style={line} /></span>
                        : <span className="block text-center" style={{ color: MUTED }}>—</span>}
                    </td>
                    <td className={cell} style={line}><HkNotes r={r} t={t} /></td>
                  </tr>
                );
              }) : [
                <tr key={`${g}-none`} data-break className="break-inside-avoid">
                  <td colSpan={7} className="border px-2 py-2 italic" style={{ ...line, color: MUTED }}>{t("No rooms here today.")}</td>
                </tr>,
              ]),
            ];
          })}
        </tbody>
      </table>

      <footer data-break className="mt-4 break-inside-avoid">
        <div className="grid grid-cols-4 gap-x-4 gap-y-1">
          <WriteLine label={t("Housekeeping staff")} className="col-span-2" />
          <WriteLine label={t("Start time")} />
          <WriteLine label={t("Completion time")} />
          <WriteLine label={t("Staff signature")} className="col-span-2" />
          <WriteLine label={t("Reception verification")} className="col-span-2" />
          <WriteLine label={t("Notes")} className="col-span-4" />
        </div>
        <p className="mt-2 text-[9.5px]" style={{ color: MUTED }}>{t("Ticks on this sheet do not change room statuses. Reception marks a room clean and ready in the system after checking it.")}</p>
      </footer>
    </Sheet>
  );
}

// ─────────────────────────── In-House Guest & Breakfast List ───────────────────────────

const peopleText = (r: Pick<GuestRow, "adults" | "children">, t: T) => {
  const a = t.plural(r.adults, "{n} adult", "{n} adults");
  return r.children ? t("{adults}, {children}", { adults: a, children: t.plural(r.children, "{n} child", "{n} children") }) : a;
};

function GuestName({ r, t }: { r: GuestRow; t: T }) {
  const org = r.group ? t("Group: {name}", { name: r.group }) : r.company;
  return (
    <>
      <p className="text-[13px] font-bold leading-tight">{r.name ?? t("Not recorded")}</p>
      {r.others.length > 0 && <p className="text-[10.5px]">{t("With: {names}", { names: r.others.join(", ") })}</p>}
      {r.bookingRooms > 1 && <p className="text-[10px]" style={{ color: MUTED }}>{t("One booking, {n} rooms", { n: r.bookingRooms })}</p>}
      {org && <p className="text-[10px]" style={{ color: MUTED }}>{org}</p>}
    </>
  );
}

export function GuestListPaper({ list, hotel, stamp }: { list: GuestList; hotel: ListHotel; stamp: ListStamp }) {
  const t = useT();
  const tz = list.timezone;
  const x = guestTotals(list.rows);
  const cols = [t("No."), t("Room No."), t("Guest name"), t("Registered guests"), t("Check-in date"), t("Expected check-out"), t("Breakfast status"), t("Breakfast tick"), t("Notes")];
  return (
    <Sheet landscape>
      <Letterhead hotel={hotel} title={t("In-House Guest & Breakfast List")} date={list.date} generatedAt={list.generatedAt} timezone={tz} stamp={stamp} t={t} />
      <Totals items={[
        { label: t("Occupied guest rooms"), value: x.rooms },
        { label: t("Registered in-house guests"), value: x.guests, sub: x.guests ? peopleText(x, t) : undefined },
        list.breakfastService
          ? { label: t("Guests with breakfast"), value: x.breakfastGuests, sub: t.plural(x.breakfastRooms, "{n} room", "{n} rooms") }
          : { label: t("Guests with breakfast"), value: "—", sub: t("Not recorded") },
        { label: t("Rooms with breakfast not recorded"), value: x.unknownRooms },
        { label: t("Rooms checking out today"), value: x.leaving },
      ]} />
      <p data-break className="mt-1.5 text-[10px]" style={{ color: MUTED }}>
        {list.breakfastService
          ? t("Breakfast comes with every night stay (Hotel services → Breakfast). Short-time stays have no breakfast.")
          : t("Breakfast is not set up in Hotel services, so the system does not know who has breakfast. Confirm with reception.")}
        {list.breakfastHours && ` ${t("Breakfast hours: {hours}", { hours: list.breakfastHours })}`}
      </p>

      <table className="mt-2 w-full table-fixed border-collapse" style={line}>
        <colgroup><col style={{ width: "4%" }} /><col style={{ width: "7%" }} /><col style={{ width: "18%" }} /><col style={{ width: "9%" }} /><col style={{ width: "9%" }} /><col style={{ width: "14%" }} /><col style={{ width: "9%" }} /><col style={{ width: "20%" }} /><col style={{ width: "10%" }} /></colgroup>
        <thead>
          <tr style={{ background: BAND }}>
            {cols.map((c) => <th key={c} className="border border-b-2 px-1.5 py-1.5 text-left text-[9.5px] font-bold uppercase leading-tight tracking-wide" style={line}>{c}</th>)}
          </tr>
        </thead>
        <tbody>
          {list.rows.length === 0 && (
            <tr data-break><td colSpan={9} className="border px-2 py-4 text-center italic" style={{ ...line, color: MUTED }}>{t("No guest is checked in right now.")}</td></tr>
          )}
          {list.rows.map((r, i) => (
            <tr key={`${r.room}-${i}`} data-break className="h-10 break-inside-avoid">
              <td className={`${cell} text-center tabular-nums`} style={line}>{i + 1}</td>
              <td className={`${cell} text-center text-[21px] font-extrabold leading-none tabular-nums`} style={line}>{r.room}</td>
              <td className={cell} style={line}><GuestName r={r} t={t} /></td>
              <td className={cell} style={line}>
                <span className="text-[17px] font-bold tabular-nums">{guestsIn(r)}</span>
                <span className="ml-1.5 text-[10px]" style={{ color: MUTED }}>{peopleText(r, t)}</span>
              </td>
              <td className={cell} style={line}>
                <p>{t.dayMonth(r.arrival)}</p>
                <p className="text-[10px]" style={{ color: MUTED }}>{r.shortTime ? t("Short time") : t.plural(r.nights, "{n} night", "{n} nights")}</p>
              </td>
              <td className={cell} style={line}>
                <p className={`whitespace-nowrap ${r.stay === "IN_HOUSE" ? "" : "font-bold"}`}>{t.dayMonth(r.leavesOn)} · {t.time(r.leavesAt, tz)}</p>
                {r.stay !== "IN_HOUSE" && <p className="text-[10px] font-bold">{r.stay === "OVERDUE" ? t("Check-out time passed") : t("Checking out today")}</p>}
              </td>
              <td className={`${cell} ${r.breakfast === "INCLUDED" ? "font-bold" : ""}`} style={line}>
                {r.breakfast === "INCLUDED" ? t("Included") : r.breakfast === "NONE_SHORT_TIME" ? t("No breakfast — short time") : t("Not recorded")}
              </td>
              <td className={cell} style={line}>
                {r.breakfast === "NONE_SHORT_TIME"
                  ? <span style={{ color: MUTED }}>{t("Not applicable")}</span>
                  : <div className="flex flex-wrap gap-x-2.5 gap-y-1 text-[10px]"><Box label={t("Served")} /><Box label={t("Not yet served")} /><Box label={t("N/A")} /></div>}
              </td>
              <td className={`${cell} break-words text-[10.5px]`} style={line}>{r.request}</td>
            </tr>
          ))}
        </tbody>
      </table>

      <footer data-break className="mt-4 break-inside-avoid">
        <div className="grid grid-cols-4 gap-x-4 gap-y-1">
          <WriteLine label={t("Breakfast team")} className="col-span-2" />
          <WriteLine label={t("Start time")} />
          <WriteLine label={t("Completion time")} />
          <WriteLine label={t("Staff signature")} className="col-span-2" />
          <WriteLine label={t("Reception verification")} className="col-span-2" />
          <WriteLine label={t("Notes")} className="col-span-4" />
        </div>
        <p className="mt-2 text-[9.5px]" style={{ color: MUTED }}>{t("Only guests checked in when this list was made are on it. Refresh and print again after new check-ins or check-outs.")}</p>
      </footer>
    </Sheet>
  );
}
