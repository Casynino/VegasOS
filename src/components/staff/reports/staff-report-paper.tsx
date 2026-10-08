import Image from "next/image";
import Link from "next/link";
import {
  Armchair, Banknote, BedDouble, CalendarCheck, Car, Clock, ConciergeBell, DoorOpen, FileText, Hand, Landmark, LogOut, MessageSquare, Receipt, Scale, ShieldAlert, UtensilsCrossed, Users, Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { factLine, type ShiftFact, type ShiftRecordTable, type ShiftReportData } from "@/server/services/shift-report";
import type { BusinessPeriod, PersonPeriodData, TeamPeriodData } from "@/server/services/staff-report";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import type { T } from "@/i18n/translate";
import { reportTr } from "@/lib/report-i18n";

/** Says a report's data text in the reader's language (src/lib/report-i18n.ts). */
type Tr = ReturnType<typeof reportTr>;

/**
 * STAFF REPORTS ON PAPER — the shift, weekly, monthly and team reports in one look: the hotel's letterhead, who and
 * when, the big figures, charts, the detail, the money kept apart, the records and the timeline. Always light (it is
 * the page that prints and becomes the PDF). Facts only — never a score.
 */

export type Hotel = { name: string; tagline?: string | null; address: string; contact: string };
const tzs = (n: number) => `TZS ${Math.round(n).toLocaleString("en-US")}`;
const num = (n: number) => n.toLocaleString("en-US");
const dur = (m: number) => `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
const initials = (n: string) => n.replace(/\s*\(.*\)/, "").trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");

/** An icon that means something for each figure. */
function iconFor(label: string): LucideIcon {
  const l = label.toLowerCase();
  if (/hour|shift/.test(l) && !/order/.test(l)) return Clock;
  if (/checked in|walk-in|arriv/.test(l)) return DoorOpen;
  if (/checked out/.test(l)) return LogOut;
  if (/reservation|booking/.test(l)) return CalendarCheck;
  if (/cash|money|payment|recorded|paid|refund|owed/.test(l)) return /cash/.test(l) ? Banknote : Wallet;
  if (/request|complaint/.test(l)) return ConciergeBell;
  if (/transport|driver|trip/.test(l)) return Car;
  if (/table/.test(l)) return Armchair;
  if (/room/.test(l)) return BedDouble;
  if (/message/.test(l)) return MessageSquare;
  if (/hand/.test(l)) return Hand;
  if (/order|served/.test(l)) return UtensilsCrossed;
  return Receipt;
}
const TONES = ["bg-[#f6efe0] text-[#8a6a25]", "bg-[#e6f4ee] text-[#047857]", "bg-[#e8f1fb] text-[#0369a1]", "bg-[#f1ebfb] text-[#6d28d9]", "bg-[#fdf0e6] text-[#b45309]", "bg-[#fbe9ee] text-[#be123c]"];

/** The paper itself: letterhead, the report, the sign-off. */
export async function Paper({ hotel, eyebrow, title, period, number, preparedAt, signoff, children }: {
  hotel: Hotel; eyebrow: string; title: string; period: string; number: string; preparedAt: string; signoff: [string, string][]; children: React.ReactNode;
}) {
  const t = await getT();
  return (
    <article id="report" className="report-sheet relative w-full overflow-hidden rounded-[28px] bg-[#fbf9f5] text-[#1d1a16] shadow-[0_2px_6px_rgba(15,23,42,0.05),0_40px_80px_-40px_rgba(0,0,0,0.7)] print:rounded-none print:shadow-none"
      style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
      <header className="relative overflow-hidden bg-[#15110c] px-6 pb-6 pt-6 text-white sm:px-9" data-break>
        <div aria-hidden className="pointer-events-none absolute -right-24 -top-32 size-80 rounded-full bg-[#c9a24a]/25 blur-3xl" />
        <div aria-hidden className="pointer-events-none absolute -bottom-40 left-1/3 size-72 rounded-full bg-[#c9a24a]/10 blur-3xl" />
        <div className="relative flex flex-wrap items-start justify-between gap-5">
          <div className="flex min-w-0 items-center gap-3.5">
            <span className="grid size-14 shrink-0 place-items-center rounded-2xl bg-white/[0.06] ring-1 ring-white/10"><Image src="/brand/logo-192.png" alt="" width={44} height={44} /></span>
            <div className="min-w-0 leading-tight">
              <p className="font-display text-xl font-semibold tracking-tight sm:text-2xl">{hotel.name}</p>
              {hotel.tagline && <p className="mt-0.5 text-[10px] uppercase tracking-[0.22em] text-[#f0cf86]/80">{hotel.tagline}</p>}
              <p className="mt-1.5 max-w-sm text-[11px] leading-relaxed text-white/55">{hotel.address}<br />{hotel.contact}</p>
            </div>
          </div>
          <div className="text-left sm:text-right">
            <p className="text-[10px] font-semibold uppercase tracking-[0.32em] text-[#f0cf86]">{eyebrow}</p>
            <h2 className="mt-1 font-display text-2xl font-semibold tracking-tight sm:text-[1.75rem]">{title}</h2>
            <p className="mt-1 text-sm text-white/80">{period}</p>
            <p className="mt-1 font-mono text-[10px] text-white/45">{number} · {t("prepared {at}", { at: preparedAt })}</p>
          </div>
        </div>
      </header>
      <div className="h-1 bg-linear-to-r from-[#8a6a25] via-[#f0cf86] to-[#8a6a25]" />
      <div className="space-y-7 px-5 py-7 sm:px-9">{children}</div>
      <footer className="border-t border-[#eee4d2] bg-[#f6f1e7] px-5 py-6 sm:px-9" data-break>
        <div className="grid gap-6 sm:grid-cols-3">
          {signoff.map(([k, v]) => (
            <div key={k}>
              <p className="h-6 truncate text-sm font-medium">{v}</p>
              <div className="border-b border-dashed border-[#b8a88a]" />
              <p className="mt-1.5 text-[10px] uppercase tracking-[0.18em] text-[#8c8173]">{k} · {t("date & signature")}</p>
            </div>
          ))}
        </div>
        <p className="mt-5 text-center text-[10px] text-[#8c8173]">{hotel.name} · {title} · {period} · {number} · {t("an activity record from the hotel system — facts, not a score")}</p>
      </footer>
    </article>
  );
}

function SectionTitle({ title, sub }: { title: string; sub?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-[#eee4d2] pb-2">
      <h3 className="font-display text-xl font-semibold tracking-tight">{title}</h3>
      {sub && <p className="text-right text-[11px] text-[#8c8173]">{sub}</p>}
    </div>
  );
}

/** Who and when, at the top. */
function Who({ name, role, dept, lines, chips }: { name: string; role: string; dept: string; lines: [string, string][]; chips?: string[] }) {
  return (
    <section className="flex flex-wrap items-center gap-5 rounded-3xl bg-white p-5 ring-1 ring-[#eee4d2]" data-break>
      <span className="grid size-16 shrink-0 place-items-center rounded-2xl bg-linear-to-br from-[#f0cf86] to-[#b0863a] text-xl font-bold text-[#1b1611]">{initials(name)}</span>
      <div className="min-w-[12rem] flex-1">
        <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#8a6a25]">{dept}</p>
        <p className="font-display text-2xl font-semibold leading-tight">{name}</p>
        <p className="text-sm text-[#6f665b]">{role}</p>
        {chips && chips.length > 0 && <p className="mt-2 flex flex-wrap gap-1.5">{chips.map((c) => <span key={c} className="rounded-full bg-[#fdf0e6] px-2.5 py-0.5 text-[11px] font-semibold text-[#b45309]">{c}</span>)}</p>}
      </div>
      <dl className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm sm:grid-cols-3">
        {lines.map(([k, v]) => (
          <div key={k}><dt className="text-[10.5px] uppercase tracking-[0.14em] text-[#8c8173]">{k}</dt><dd className="font-semibold tabular-nums">{v}</dd></div>
        ))}
      </dl>
    </section>
  );
}

/** The big figures. */
function Kpis({ facts, compare, t, tr }: { facts: (ShiftFact & { prev?: number })[]; compare?: string; t: T; tr: Tr }) {
  if (!facts.length) return <p className="rounded-2xl bg-white px-4 py-6 text-center text-sm text-[#8c8173] ring-1 ring-[#eee4d2]">{t("No recorded activity in this time.")}</p>;
  return (
    <section className="flex flex-wrap gap-3" data-break style={{ "--cols": facts.length <= 4 ? facts.length : Math.min(4, Math.ceil(facts.length / 2)) } as React.CSSProperties}>
      {facts.map((f, i) => {
        const Icon = iconFor(f.label);
        const delta = f.prev !== undefined && f.prev !== f.value ? f.value - f.prev : null;
        return (
          <div key={f.label} className="min-w-0 grow basis-[calc(50%_-_0.75rem)] rounded-2xl bg-white p-4 ring-1 ring-[#eee4d2] sm:basis-[calc(33.34%_-_0.75rem)] lg:basis-[calc(100%/var(--cols)_-_0.75rem)]">
            <div className="flex items-center justify-between">
              <span className={cn("grid size-9 place-items-center rounded-xl", TONES[i % TONES.length])}><Icon className="size-[18px]" /></span>
              {delta !== null && <span className={cn("rounded-full px-2 py-0.5 text-[10.5px] font-semibold tabular-nums", delta > 0 ? "bg-[#e6f4ee] text-[#047857]" : "bg-[#f3efe8] text-[#6f665b]")}>{delta > 0 ? "+" : "−"}{f.money ? tzs(Math.abs(delta)) : num(Math.abs(Math.round(delta * 10) / 10))}</span>}
            </div>
            <p className="mt-3 text-[26px] font-semibold leading-none tracking-tight tabular-nums [overflow-wrap:anywhere]">{f.money ? tzs(f.value) : num(f.value)}</p>
            <p className="mt-1.5 text-[12px] leading-snug text-[#6f665b]">{tr(f.label)}</p>
            {f.sub && <p className="text-[11px] text-[#8c8173]">{tr(f.sub)}</p>}
          </div>
        );
      })}
      {compare && <p className="basis-full text-[11px] text-[#8c8173]">{compare}</p>}
    </section>
  );
}

/** A clean bar chart (prints and becomes the PDF as it is). */
function Bars({ title, sub, items, fmt = num, tone = "bg-[#c9a24a]", t }: { title: string; sub?: string; items: { label: string; value: number; mark?: boolean }[]; fmt?: (n: number) => string; tone?: string; t: T }) {
  const max = Math.max(1, ...items.map((x) => x.value));
  const best = items.reduce((b, x) => (x.value > b.value ? x : b), items[0] ?? { value: 0, label: "" });
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-[#eee4d2]" data-break>
      <p className="text-sm font-semibold">{title}{sub && <span className="ml-1.5 font-normal text-[#8c8173]">· {sub}</span>}</p>
      {items.every((x) => !x.value) ? <p className="mt-4 rounded-2xl bg-[#f6f1e7] px-4 py-8 text-center text-xs text-[#8c8173]">{t("Nothing in this time.")}</p> : (
        <div className="mt-4 flex h-44 items-end gap-1 pt-5">
          {items.map((x, i) => (
            <div key={`${x.label}-${i}`} className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-1">
              <div className="relative flex w-full flex-1 items-end">
                <div className={cn("relative w-full rounded-t-[4px]", x.value ? tone : "")} style={{ height: `${x.value ? Math.max(4, Math.round((x.value / max) * 100)) : 0}%` }}>
                  {x === best && x.value > 0 && <span className="absolute bottom-full left-1/2 mb-1 -translate-x-1/2 whitespace-nowrap text-[10.5px] font-semibold tabular-nums">{fmt(x.value)}</span>}
                </div>
              </div>
              <span className="h-px w-full bg-[#eee4d2]" />
              <span className={cn("w-full truncate text-center text-[9.5px] tabular-nums", x.mark ? "font-semibold text-[#8a6a25]" : "text-[#8c8173]")}>{x.label}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** Horizontal bars for a few named amounts (payment methods, people). */
function HBars({ items, fmt }: { items: { label: string; value: number; sub?: string }[]; fmt: (n: number) => string }) {
  const max = Math.max(1, ...items.map((x) => x.value));
  return (
    <ul className="space-y-2.5">
      {items.map((x, i) => (
        <li key={`${x.label}-${i}`}>
          <p className="flex justify-between gap-3 text-sm"><span className="truncate">{x.label}{x.sub && <span className="ml-1 text-[11px] text-[#8c8173]">{x.sub}</span>}</span><span className="font-semibold tabular-nums">{fmt(x.value)}</span></p>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#f3efe8]"><div className="h-full rounded-full bg-[#c9a24a]" style={{ width: `${Math.round((x.value / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function Groups({ groups, t, tr }: { groups: ShiftReportData["groups"]; t: T; tr: Tr }) {
  if (!groups.length) return null;
  return (
    <section className="space-y-3">
      <SectionTitle title={t("The work in detail")} sub={t("Every figure counted from their own records")} />
      <div className="grid gap-3 md:grid-cols-2">
        {groups.map((g) => (
          <div key={g.title} className="rounded-3xl bg-white p-5 ring-1 ring-[#eee4d2]" data-break>
            <p className="text-sm font-semibold">{tr(g.title)}</p>
            {g.subtitle && <p className="text-[11px] text-[#8c8173]">{tr(g.subtitle)}</p>}
            <ul className="mt-3 divide-y divide-[#f3efe8]">
              {g.facts.map((f) => (
                <li key={f.label} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                  <span className="min-w-0">{tr(f.label)}{f.sub && <span className="block truncate text-[11px] text-[#8c8173]">{tr(f.sub)}</span>}</span>
                  <span className="shrink-0 font-semibold tabular-nums">{f.money ? tzs(f.value) : num(f.value)}</span>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </section>
  );
}

function Money({ money, t, tr }: { money: ShiftReportData["money"]; t: T; tr: Tr }) {
  if (!money || !money.facts.length) return null;
  const main = money.facts.find((f) => f.money && f.value) ?? money.facts[0];
  return (
    <section className="space-y-3">
      <SectionTitle title={tr(money.title)} sub={tr(money.subtitle)} />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-3xl bg-[#15110c] p-5 text-white" data-break>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#f0cf86]">{tr(main.label)}</p>
          <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">{main.money ? tzs(main.value) : num(main.value)}</p>
          <ul className="mt-4 space-y-1.5 text-sm">
            {money.facts.filter((f) => f !== main).map((f) => (
              <li key={f.label} className="flex justify-between gap-3 border-t border-white/10 pt-1.5"><span className="text-white/70">{tr(f.label)}{f.sub && <span className="block text-[11px] text-white/45">{tr(f.sub)}</span>}</span><span className="font-semibold tabular-nums">{f.money ? tzs(f.value) : num(f.value)}</span></li>
            ))}
          </ul>
        </div>
        <div className="rounded-3xl bg-white p-5 ring-1 ring-[#eee4d2]" data-break>
          <p className="mb-3 text-sm font-semibold">{t("By how it was paid")}</p>
          {money.byKind.length ? <HBars items={money.byKind.map((k) => ({ label: tr(k.name), value: k.amount }))} fmt={tzs} /> : <p className="rounded-2xl bg-[#f6f1e7] px-4 py-8 text-center text-xs text-[#8c8173]">{t("No payment recorded.")}</p>}
        </div>
      </div>
    </section>
  );
}

function Records({ tables, clock, day, t, tr }: { tables: ShiftRecordTable[]; clock: (iso: string) => string; day: (iso: string) => string; t: T; tr: Tr }) {
  if (!tables.length) return null;
  return (
    <section className="space-y-3">
      <SectionTitle title={t("The records")} sub={t("Who, which room, how much — the lines behind the figures")} />
      {tables.map((tb) => (
        <div key={tb.title} className="overflow-hidden rounded-3xl bg-white ring-1 ring-[#eee4d2]" data-break>
          <div className="flex items-baseline justify-between gap-2 px-5 pt-4">
            <p className="text-sm font-semibold">{tr(tb.title)}</p>
            <p className="text-[11px] text-[#8c8173]">{t.plural(tb.rows.length + (tb.more ?? 0), "{n} line", "{n} lines")}{tb.subtitle ? ` · ${tr(tb.subtitle)}` : ""}</p>
          </div>
          <div className="report-scroll mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-y border-[#eee4d2] bg-[#faf6ef] text-left text-[10.5px] uppercase tracking-[0.12em] text-[#8c8173]">
                {tb.columns.map((c) => <th key={c.label} className={cn("px-5 py-2 font-semibold", c.align === "right" && "text-right")}>{tr(c.label)}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-[#f3efe8]">
                {tb.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((c, j) => {
                      const col = tb.columns[j];
                      const isTime = j === 0 && typeof c === "string" && /^\d{4}-\d{2}-\d{2}T/.test(c);
                      return <td key={j} className={cn("px-5 py-2 align-top", col?.align === "right" && "text-right tabular-nums", isTime && "whitespace-nowrap tabular-nums text-[#6f665b]")}>
                        {isTime ? (tb.columns[0].label === "When" ? `${day(c as string)} ${clock(c as string)}` : clock(c as string)) : col?.money && typeof c === "number" ? num(c) : typeof c === "string" ? tr(c) : c ?? "—"}
                      </td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!!tb.more && <p className="px-5 py-2 text-[11px] text-[#8c8173]">{tb.moreNote ? t("…and {n} more ({note}).", { n: num(tb.more), note: tr(tb.moreNote) }) : t("…and {n} more.", { n: num(tb.more) })}</p>}
        </div>
      ))}
    </section>
  );
}

const AREA_TONE: Record<string, string> = {
  Shift: "bg-[#1d1a16] text-white", "Front desk": "bg-[#e6f4ee] text-[#047857]", Bookings: "bg-[#e8f1fb] text-[#0369a1]", Money: "bg-[#f6efe0] text-[#8a6a25]",
  Restaurant: "bg-[#fdf0e6] text-[#b45309]", Orders: "bg-[#fdf0e6] text-[#b45309]", Requests: "bg-[#f1ebfb] text-[#6d28d9]", Transport: "bg-[#fbe9ee] text-[#be123c]",
};
function Timeline({ items, clock, more, t, tr }: { items: ShiftReportData["timeline"]; clock: (iso: string) => string; more?: number; t: T; tr: Tr }) {
  if (!items.length) return null;
  return (
    <section className="space-y-3">
      <SectionTitle title={t("Timeline")} sub={t("Everything done in the system during the shift, in order")} />
      <ol className="relative rounded-3xl bg-white p-5 ring-1 ring-[#eee4d2]">
        <span aria-hidden className="absolute bottom-6 left-[5.35rem] top-6 w-px bg-[#eee4d2]" />
        {items.map((x, i) => (
          <li key={i} className="relative flex items-start gap-4 py-1.5" data-break>
            <span className="w-14 shrink-0 pt-0.5 text-right text-xs font-semibold tabular-nums text-[#6f665b]">{clock(x.at)}</span>
            <span className={cn("relative z-10 mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-white", x.area === "Shift" ? "bg-[#1d1a16]" : "bg-[#c9a24a]")} />
            <span className="min-w-0 flex-1 text-sm leading-snug">{tr(x.text)}</span>
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", AREA_TONE[x.area] ?? "bg-[#f3efe8] text-[#6f665b]")}>{tr(x.area)}</span>
          </li>
        ))}
        {!!more && <li className="pl-[6.5rem] pt-2 text-[11px] text-[#8c8173]">{t("…and {n} more (a very long shift — the first part is shown).", { n: num(more) })}</li>}
      </ol>
    </section>
  );
}

// ───────────────────────── The three reports ─────────────────────────

export async function ShiftReportPaper({ d, hotel, number, preparedAt, preparedBy, timezone }: { d: ShiftReportData; hotel: Hotel; number: string; preparedAt: string; preparedBy: string; timezone: string }) {
  // In the reader's language — the same figures (the report itself is kept as it was made).
  const t = await getT();
  const tr = reportTr(t, d.i18n);
  const clock = (iso: string) => t.time(iso, timezone);
  const day = (iso: string) => new Intl.DateTimeFormat(t.intl, { day: "numeric", month: "short", timeZone: timezone }).format(new Date(iso));
  const date = t.date(d.shift.businessDate, true);
  const reception = d.shift.department === "RECEPTION";
  // A shift that ran past midnight shows the day it ended.
  const endsLater = day(d.shift.endedAt) !== day(d.shift.startedAt);
  const ended = endsLater ? `${day(d.shift.endedAt)} ${clock(d.shift.endedAt)}` : clock(d.shift.endedAt);
  return (
    <Paper hotel={hotel} eyebrow={t("Shift report")} title={d.person.name} period={`${date} · ${clock(d.shift.startedAt)} → ${ended}`} number={number} preparedAt={preparedAt}
      signoff={[[t("Prepared by"), preparedBy], [t("Staff member"), d.person.name], [t("Manager"), ""]]}>
      <Who name={d.person.name} role={tr(d.person.role)} dept={`${reception ? t("Reception") : t("Restaurant & bar")} · ${tr(d.shift.label)}`}
        lines={[[t("Started"), clock(d.shift.startedAt)], [t("Ended"), ended], [t("On shift"), dur(d.shift.minutes)], [t("Hotel day"), new Date(`${d.shift.businessDate}T12:00:00Z`).toLocaleDateString(t.intl, { day: "numeric", month: "short", timeZone: "UTC" })], [t("Closed"), d.shift.byManager ? t.ctx("closed", "by {name}", { name: d.shift.closedBy ?? t("a manager") }) : t("by themselves")], [t.ctx("report", "Actions"), num((d.timeline ?? []).filter((x) => x.area !== "Shift").length + (d.timelineLeft ?? 0))]]}
        chips={[d.shift.byManager && d.shift.closeReason ? t("Closed by a manager — {reason}", { reason: d.shift.closeReason }) : "", d.shift.replacement ? t("Covering — {reason}", { reason: d.shift.replacement }) : ""].filter(Boolean)} />
      <Kpis facts={d.headline ?? []} t={t} tr={tr} />
      {(d.handover?.length ?? 0) > 0 && (
        <section className="rounded-3xl bg-[#fdf6ea] p-5 ring-1 ring-[#f0dcb8]" data-break>
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b45309]"><ShieldAlert className="size-4" />{t("At the end of the shift")}</p>
          <ul className="mt-2 space-y-1.5 text-sm">{d.handover.map((h) => <li key={h} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#b45309]" />{tr(h)}</li>)}</ul>
        </section>
      )}
      {(d.hours?.length ?? 0) > 1 && <Bars title={t("How busy each hour was")} sub={t("actions in the system")} items={d.hours!.map((h) => ({ label: clock(h.at), value: h.count }))} t={t} />}
      <Groups groups={d.groups ?? []} t={t} tr={tr} />
      <Money money={d.money} t={t} tr={tr} />
      <Records tables={d.records ?? []} clock={clock} day={day} t={t} tr={tr} />
      <Timeline items={d.timeline ?? []} clock={clock} more={d.timelineLeft} t={t} tr={tr} />
    </Paper>
  );
}

export async function PersonPeriodPaper({ d, hotel, number, preparedAt, timezone, shiftHref }: { d: PersonPeriodData; hotel: Hotel; number: string; preparedAt: string; timezone: string; shiftHref?: (id: string, report: boolean) => string | null }) {
  // In the reader's language — the same figures (the report itself is kept as it was made).
  const t = await getT();
  const tr = reportTr(t, d.i18n);
  const clock = (iso: string) => t.time(iso, timezone);
  const day = (iso: string) => new Intl.DateTimeFormat(t.intl, { day: "numeric", month: "short", timeZone: timezone }).format(new Date(iso));
  const label = (date: string) => d.kind === "WEEK" ? new Date(`${date}T12:00:00Z`).toLocaleDateString(t.intl, { weekday: "short", day: "numeric", timeZone: "UTC" }) : String(Number(date.slice(8)));
  const what = d.kind === "WEEK" ? t("Weekly report") : t("Monthly report");
  return (
    <Paper hotel={hotel} eyebrow={d.live ? t("{period} · so far", { period: what }) : what} title={d.person.name} period={d.label} number={number} preparedAt={preparedAt}
      signoff={[[t("Prepared by"), t("System · automatic staff report")], [t("Staff member"), d.person.name], [t("Manager"), ""]]}>
      <Who name={d.person.name} role={tr(d.person.role)} dept={d.department === "RECEPTION" ? t("Reception") : t("Restaurant & bar")}
        lines={[[t("Shifts"), num(d.totals.shifts)], [t("On shift"), dur(d.totals.minutes)], [t("Days worked"), t("{n} of {total}", { n: d.totals.days, total: d.days.length })], [t("Average shift"), d.totals.shifts ? dur(Math.round(d.totals.minutes / d.totals.shifts)) : "—"]]}
        chips={d.live ? [t("So far — the full report is made when the period ends")] : []} />
      <Kpis facts={d.headline.slice(2)} t={t} tr={tr}
        compare={d.kind === "WEEK" ? t("Small figures next to each number: the change against the week before.") : t("Small figures next to each number: the change against the month before.")} />
      <div className="grid gap-3 lg:grid-cols-2">
        <Bars title={t("Hours on shift")} sub={t("per day")} items={d.days.map((x) => ({ label: label(x.date), value: Math.round(x.minutes / 6) / 10 }))} fmt={(n) => `${n}h`} t={t} />
        <Bars title={tr(d.series.a)} sub={t("per day")} items={d.days.map((x) => ({ label: label(x.date), value: x.a }))} tone="bg-[#10b981]" t={t} />
        <Bars title={tr(d.series.b)} sub={t("per day")} items={d.days.map((x) => ({ label: label(x.date), value: x.b }))} tone="bg-[#38bdf8]" t={t} />
        <Bars title={t("Money they recorded")} sub={t("TZS per day")} items={d.days.map((x) => ({ label: label(x.date), value: x.money }))} fmt={(n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : num(n))} tone="bg-[#a78bfa]" t={t} />
      </div>
      <Groups groups={d.groups} t={t} tr={tr} />
      <Money money={d.money} t={t} tr={tr} />
      {d.shifts.length > 0 && (
        <section className="space-y-3">
          <SectionTitle title={t("The shifts")} sub={t("Each shift and its report")} />
          <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-[#eee4d2]" data-break>
            <div className="report-scroll overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead><tr className="border-b border-[#eee4d2] bg-[#faf6ef] text-left text-[10.5px] uppercase tracking-[0.12em] text-[#8c8173]">
                  <th className="px-5 py-2 font-semibold">{t.ctx("report", "Day")}</th><th className="px-3 py-2 font-semibold">{t("Hours")}</th><th className="px-3 py-2 text-right font-semibold">{t("On shift")}</th><th className="px-3 py-2 font-semibold">{t("Highlights")}</th><th className="px-5 py-2" />
                </tr></thead>
                <tbody className="divide-y divide-[#f3efe8]">
                  {d.shifts.map((s) => {
                    const href = shiftHref?.(s.reportId ? s.id : s.id, !!s.reportId) ?? null;
                    return (
                      <tr key={s.id}>
                        <td className="whitespace-nowrap px-5 py-2 font-medium">{day(s.startedAt)}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[#6f665b]">{clock(s.startedAt)} → {s.endedAt ? clock(s.endedAt) : t("open")}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{dur(s.minutes)}</td>
                        <td className="px-3 py-2 text-[12px] text-[#6f665b]">{s.headline.length ? s.headline.map((f) => (f.money ? tzs(f.value) : t.locale === "en" ? `${num(f.value)} ${f.label.toLowerCase()}` : factLine(f, t))).join(" · ") : "—"}</td>
                        <td className="px-5 py-2 text-right">{href && <Link href={href} className="inline-flex items-center gap-1 rounded-lg bg-[#f6efe0] px-2 py-1 text-[11px] font-semibold text-[#8a6a25]"><FileText className="size-3" />{t("Report")}</Link>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
      <Records tables={d.records} clock={clock} day={day} t={t} tr={tr} />
    </Paper>
  );
}

/** "+12% vs last week" — the change against the period before (nothing without a base). */
function vs(cur: number, prev: number, kind: "WEEK" | "MONTH", t: T) {
  if (!(prev > 0) || cur === prev) return null;
  const change = `${cur > prev ? "+" : "−"}${Math.round((Math.abs(cur - prev) / prev) * 100)}%`;
  return kind === "WEEK" ? t("{change} vs last week", { change }) : t("{change} vs last month", { change });
}

/** The business over the week or month: income, money, rooms, the restaurant, guests, expenses. */
function BusinessSection({ b, kind, live = false, t }: { b: BusinessPeriod; kind: "WEEK" | "MONTH"; live?: boolean; t: T }) {
  const week = kind === "WEEK";
  const label = (date: string) => kind === "WEEK" ? new Date(`${date}T12:00:00Z`).toLocaleDateString(t.intl, { weekday: "short", day: "numeric", timeZone: "UTC" }) : String(Number(date.slice(8)));
  const k = (n: number) => (Math.abs(n) >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : Math.abs(n) >= 1000 ? `${Math.round(n / 1000)}k` : num(n));
  const figures: { icon: LucideIcon; label: string; value: string; note?: string | null }[] = [
    { icon: Landmark, label: t("Revenue (net)"), value: tzs(b.revenue.total), note: vs(b.revenue.total, b.revenue.prev, kind, t) },
    { icon: Wallet, label: t("Money received"), value: tzs(b.received), note: vs(b.received, b.prevReceived, kind, t) },
    { icon: Receipt, label: t("Expenses"), value: tzs(b.expenses), note: vs(b.expenses, b.prevExpenses, kind, t) },
    { icon: Scale, label: t("Net operating result"), value: `${b.result < 0 ? "−" : ""}${tzs(Math.abs(b.result))}`, note: t("revenue − expenses") },
    { icon: BedDouble, label: t("Occupancy"), value: `${b.rooms.occupancy}%`, note: b.rooms.prevOccupancy || b.rooms.occupancy ? (week ? t("{n}% last week", { n: b.rooms.prevOccupancy }) : t("{n}% last month", { n: b.rooms.prevOccupancy })) : null },
    { icon: UtensilsCrossed, label: t("Restaurant & bar orders"), value: num(b.restaurant.orders), note: vs(b.restaurant.orders, b.restaurant.prevOrders, kind, t) },
  ];
  const depts = ([
    [msg("Rooms"), b.revenue.rooms], [msg("Restaurant"), b.revenue.restaurant], [msg("Bar"), b.revenue.bar], [msg("Room service"), b.revenue.roomService],
    [msg("Meeting room"), b.revenue.meeting], [msg("Transport"), b.revenue.transport], [msg("Other"), b.revenue.other],
  ] as const).filter(([, v]) => v > 0).map(([label, value]) => ({ label: t(label), value }));
  const guests: [string, number][] = [[t("Checked in"), b.guests.checkIns], [t("Checked out"), b.guests.checkOuts], [t("New bookings"), b.guests.newBookings], [t("Cancelled"), b.guests.cancellations], [t("No-shows"), b.guests.noShows]];
  const sub = live
    ? week ? t("So far · compared with the same days last week (whole days — today is still running)") : t("So far · compared with the same days last month (whole days — today is still running)")
    : week ? t("The same figures as Finance and the daily report · compared with last week") : t("The same figures as Finance and the daily report · compared with last month");
  return (
    <section className="space-y-4">
      <SectionTitle title={t("The business")} sub={sub} />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3" data-break>
        {figures.map((f, i) => (
          <div key={f.label} className={cn("rounded-2xl p-4", i === 0 ? "bg-[#15110c] text-white" : "bg-white ring-1 ring-[#eee4d2]")}>
            <span className={cn("grid size-9 place-items-center rounded-xl", i === 0 ? "bg-[#c9a24a]/20 text-[#f0cf86]" : TONES[i % TONES.length])}><f.icon className="size-[18px]" /></span>
            <p className="mt-3 text-[22px] font-semibold leading-none tracking-tight tabular-nums [overflow-wrap:anywhere] sm:text-[26px]">{f.value}</p>
            <p className={cn("mt-1.5 text-[12px]", i === 0 ? "text-white/70" : "text-[#6f665b]")}>{f.label}</p>
            {f.note && <p className={cn("text-[11px] tabular-nums", i === 0 ? "text-[#f0cf86]/80" : "text-[#8c8173]")}>{f.note}</p>}
          </div>
        ))}
      </div>
      <div className="grid gap-3 lg:grid-cols-2">
        <Bars title={t("Revenue")} sub={t("TZS per day")} items={b.days.map((x) => ({ label: label(x.date), value: x.total }))} fmt={k} t={t} />
        <div className="rounded-3xl bg-white p-5 ring-1 ring-[#eee4d2]" data-break>
          <p className="mb-3 text-sm font-semibold">{t("Revenue by department")}</p>
          {depts.length ? <HBars items={depts} fmt={tzs} /> : <p className="rounded-2xl bg-[#f6f1e7] px-4 py-8 text-center text-xs text-[#8c8173]">{t("No revenue recorded.")}</p>}
          {(b.revenue.discounts > 0 || b.revenue.refunds > 0) && <p className="mt-3 text-[11px] text-[#8c8173]">{b.revenue.discounts > 0 && t("Room discounts given {amount}", { amount: tzs(b.revenue.discounts) })}{b.revenue.discounts > 0 && b.revenue.refunds > 0 && " · "}{b.revenue.refunds > 0 && t("refunds {amount}", { amount: tzs(b.revenue.refunds) })}</p>}
        </div>
        <Bars title={t("Occupancy")} sub={t("% of rooms, per night")} items={b.days.map((x) => ({ label: label(x.date), value: x.occupancy }))} fmt={(n) => `${n}%`} tone="bg-[#38bdf8]" t={t} />
        <Bars title={t("Money received")} sub={t("TZS per day")} items={b.days.map((x) => ({ label: label(x.date), value: x.received }))} fmt={k} tone="bg-[#10b981]" t={t} />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-3xl bg-white p-5 ring-1 ring-[#eee4d2]" data-break>
          <p className="text-sm font-semibold">{t("Rooms & guests")}</p>
          <p className="mt-1 text-[11px] text-[#8c8173]">{t("{n} room nights of {total}", { n: num(b.rooms.roomNights), total: num(b.rooms.sellable) })}{b.rooms.adr ? ` · ${t("average rate {amount}", { amount: tzs(b.rooms.adr) })}` : ""}</p>
          <ul className="mt-3 divide-y divide-[#f3efe8]">
            {guests.map(([l, v]) => <li key={l} className="flex justify-between py-1.5 text-sm"><span>{l}</span><span className="font-semibold tabular-nums">{num(v)}</span></li>)}
          </ul>
        </div>
        <div className="rounded-3xl bg-white p-5 ring-1 ring-[#eee4d2]" data-break>
          <p className="text-sm font-semibold">{t("Restaurant & bar")}</p>
          <p className="mt-1 text-[11px] text-[#8c8173]">{t("{n} orders", { n: num(b.restaurant.orders) })} · {tzs(b.restaurant.sales)}{b.restaurant.averageOrder ? ` · ${t("average {amount}", { amount: tzs(b.restaurant.averageOrder) })}` : ""}</p>
          {b.restaurant.best.length ? (
            <ol className="mt-3 space-y-1.5">
              {b.restaurant.best.map((x, i) => <li key={x.name} className="flex items-baseline gap-2 text-sm"><span className="w-4 shrink-0 text-[11px] font-semibold text-[#8c8173]">{i + 1}</span><span className="min-w-0 flex-1 truncate">{t(x.name)} <span className="text-[11px] text-[#8c8173]">×{num(x.quantity)}</span></span><span className="font-semibold tabular-nums">{num(x.amount)}</span></li>)}
            </ol>
          ) : <p className="mt-3 rounded-2xl bg-[#f6f1e7] px-4 py-6 text-center text-xs text-[#8c8173]">{t("No orders.")}</p>}
        </div>
        <div className="rounded-3xl bg-white p-5 ring-1 ring-[#eee4d2]" data-break>
          <p className="text-sm font-semibold">{t("Expenses")}</p>
          <p className="mt-1 text-[11px] text-[#8c8173]">{tzs(b.expenses)} · {t("owed to the hotel today {amount}", { amount: tzs(b.outstanding) })}</p>
          <div className="mt-3">{b.expensesByCategory.length ? <HBars items={b.expensesByCategory.map((c) => ({ label: t(c.name), value: c.amount }))} fmt={(n) => num(n)} /> : <p className="rounded-2xl bg-[#f6f1e7] px-4 py-6 text-center text-xs text-[#8c8173]">{t("No expenses.")}</p>}</div>
        </div>
      </div>
    </section>
  );
}

export async function TeamPeriodPaper({ d, hotel, number, preparedAt, personHref }: { d: TeamPeriodData; hotel: Hotel; number: string; preparedAt: string; personHref: (p: TeamPeriodData["people"][number]) => string }) {
  // In the reader's language — the same figures (the report itself is kept as it was made).
  const t = await getT();
  const tr = reportTr(t);
  const what = d.kind === "WEEK" ? t("Weekly report") : t("Monthly report");
  const dept = (k: "RECEPTION" | "RESTAURANT") => d.people.filter((p) => p.department === k);
  const hours = d.people.reduce((sum, p) => sum + p.minutes, 0);
  return (
    <Paper hotel={hotel} eyebrow={what} title={d.business ? t("Business & team") : t("The team")} period={d.label} number={number} preparedAt={preparedAt}
      signoff={[[t("Prepared by"), t("System · automatic report")], [t("Checked by"), ""], [t("Approved by (MD)"), ""]]}>
      {d.business && <BusinessSection b={d.business} kind={d.kind} live={d.live} t={t} />}
      {d.business && <SectionTitle title={t("The team")} sub={t("Who worked, and each person's own report")} />}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-break>
        {[[Users, t("People who worked"), num(d.people.length)], [Clock, t("Shifts"), num(d.people.reduce((sum, p) => sum + p.shifts, 0))], [Clock, t("Hours on shift"), dur(hours)], [CalendarCheck, t("Reception · Restaurant"), `${dept("RECEPTION").length} · ${dept("RESTAURANT").length}`]].map(([Icon, label, value], i) => {
          const I = Icon as LucideIcon;
          return (
            <div key={label as string} className="rounded-2xl bg-white p-4 ring-1 ring-[#eee4d2]">
              <span className={cn("grid size-9 place-items-center rounded-xl", TONES[i])}><I className="size-[18px]" /></span>
              <p className="mt-3 text-[26px] font-semibold leading-none tabular-nums">{value as string}</p>
              <p className="mt-1.5 text-[12px] text-[#6f665b]">{label as string}</p>
            </div>
          );
        })}
      </section>
      {d.people.length > 0 && (
        <div className="rounded-3xl bg-white p-5 ring-1 ring-[#eee4d2]" data-break>
          <p className="mb-3 text-sm font-semibold">{t("Hours on shift")} <span className="font-normal text-[#8c8173]">· {t("by person")}</span></p>
          <HBars items={d.people.map((p) => ({ label: p.name, value: Math.round(p.minutes / 6) / 10, sub: p.department === "RECEPTION" ? t("Reception") : t("Restaurant") }))} fmt={(n) => `${n}h`} />
        </div>
      )}
      {(["RECEPTION", "RESTAURANT"] as const).map((k) => dept(k).length > 0 && (
        <section key={k} className="space-y-3">
          <SectionTitle title={k === "RECEPTION" ? t("Reception") : t("Restaurant & bar")} sub={t("Each person's own report is one tap away")} />
          <div className="grid gap-3 md:grid-cols-2">
            {dept(k).map((p) => (
              <Link key={p.userId} href={personHref(p)} className="block rounded-3xl bg-white p-5 ring-1 ring-[#eee4d2] transition hover:ring-[#c9a24a]" data-break>
                <div className="flex items-center gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-linear-to-br from-[#f0cf86] to-[#b0863a] text-sm font-bold text-[#1b1611]">{initials(p.name)}</span>
                  <div className="min-w-0 flex-1 leading-tight"><p className="truncate font-semibold">{p.name}</p><p className="text-[11px] text-[#8c8173]">{tr(p.role)} · {t.plural(p.shifts, "{n} shift", "{n} shifts")} · {dur(p.minutes)}</p></div>
                  <span className="inline-flex items-center gap-1 rounded-lg bg-[#f6efe0] px-2 py-1 text-[11px] font-semibold text-[#8a6a25]"><FileText className="size-3" />{t("Report")}</span>
                </div>
                {p.headline.length > 0 && (
                  <ul className="mt-3 grid grid-cols-2 gap-2">
                    {p.headline.map((f) => <li key={f.label} className="rounded-xl bg-[#faf6ef] px-3 py-2"><p className="text-base font-semibold tabular-nums">{f.money ? tzs(f.value) : num(f.value)}</p><p className="text-[11px] leading-snug text-[#6f665b]">{tr(f.label)}</p></li>)}
                  </ul>
                )}
              </Link>
            ))}
          </div>
        </section>
      ))}
      {d.people.length === 0 && <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-[#8c8173] ring-1 ring-[#eee4d2]">{t("No shift was worked in this time.")}</p>}
    </Paper>
  );
}
