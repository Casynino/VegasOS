import Image from "next/image";
import Link from "next/link";
import {
  Armchair, Banknote, BedDouble, CalendarCheck, Car, Clock, ConciergeBell, DoorOpen, FileText, Hand, Landmark, LogOut, MessageSquare, Receipt, Scale, ShieldAlert, UtensilsCrossed, Users, Wallet,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { ShiftFact, ShiftRecordTable, ShiftReportData } from "@/server/services/shift-report";
import type { BusinessPeriod, PersonPeriodData, TeamPeriodData } from "@/server/services/staff-report";

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
export function Paper({ hotel, eyebrow, title, period, number, preparedAt, signoff, children }: {
  hotel: Hotel; eyebrow: string; title: string; period: string; number: string; preparedAt: string; signoff: [string, string][]; children: React.ReactNode;
}) {
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
            <p className="mt-1 font-mono text-[10px] text-white/45">{number} · prepared {preparedAt}</p>
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
              <p className="mt-1.5 text-[10px] uppercase tracking-[0.18em] text-[#8c8173]">{k} · date & signature</p>
            </div>
          ))}
        </div>
        <p className="mt-5 text-center text-[10px] text-[#8c8173]">{hotel.name} · {title} · {period} · {number} · an activity record from the hotel system — facts, not a score</p>
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
function Kpis({ facts, compare }: { facts: (ShiftFact & { prev?: number })[]; compare?: string }) {
  if (!facts.length) return <p className="rounded-2xl bg-white px-4 py-6 text-center text-sm text-[#8c8173] ring-1 ring-[#eee4d2]">No recorded activity in this time.</p>;
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
            <p className="mt-1.5 text-[12px] leading-snug text-[#6f665b]">{f.label}</p>
            {f.sub && <p className="text-[11px] text-[#8c8173]">{f.sub}</p>}
          </div>
        );
      })}
      {compare && <p className="basis-full text-[11px] text-[#8c8173]">{compare}</p>}
    </section>
  );
}

/** A clean bar chart (prints and becomes the PDF as it is). */
function Bars({ title, sub, items, fmt = num, tone = "bg-[#c9a24a]" }: { title: string; sub?: string; items: { label: string; value: number; mark?: boolean }[]; fmt?: (n: number) => string; tone?: string }) {
  const max = Math.max(1, ...items.map((x) => x.value));
  const best = items.reduce((b, x) => (x.value > b.value ? x : b), items[0] ?? { value: 0, label: "" });
  return (
    <div className="rounded-3xl bg-white p-5 ring-1 ring-[#eee4d2]" data-break>
      <p className="text-sm font-semibold">{title}{sub && <span className="ml-1.5 font-normal text-[#8c8173]">· {sub}</span>}</p>
      {items.every((x) => !x.value) ? <p className="mt-4 rounded-2xl bg-[#f6f1e7] px-4 py-8 text-center text-xs text-[#8c8173]">Nothing in this time.</p> : (
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
      {items.map((x) => (
        <li key={x.label}>
          <p className="flex justify-between gap-3 text-sm"><span className="truncate">{x.label}{x.sub && <span className="ml-1 text-[11px] text-[#8c8173]">{x.sub}</span>}</span><span className="font-semibold tabular-nums">{fmt(x.value)}</span></p>
          <div className="mt-1 h-2 overflow-hidden rounded-full bg-[#f3efe8]"><div className="h-full rounded-full bg-[#c9a24a]" style={{ width: `${Math.round((x.value / max) * 100)}%` }} /></div>
        </li>
      ))}
    </ul>
  );
}

function Groups({ groups }: { groups: ShiftReportData["groups"] }) {
  if (!groups.length) return null;
  return (
    <section className="space-y-3">
      <SectionTitle title="The work in detail" sub="Every figure counted from their own records" />
      <div className="grid gap-3 md:grid-cols-2">
        {groups.map((g) => (
          <div key={g.title} className="rounded-3xl bg-white p-5 ring-1 ring-[#eee4d2]" data-break>
            <p className="text-sm font-semibold">{g.title}</p>
            {g.subtitle && <p className="text-[11px] text-[#8c8173]">{g.subtitle}</p>}
            <ul className="mt-3 divide-y divide-[#f3efe8]">
              {g.facts.map((f) => (
                <li key={f.label} className="flex items-baseline justify-between gap-3 py-1.5 text-sm">
                  <span className="min-w-0">{f.label}{f.sub && <span className="block truncate text-[11px] text-[#8c8173]">{f.sub}</span>}</span>
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

function Money({ money }: { money: ShiftReportData["money"] }) {
  if (!money || !money.facts.length) return null;
  const main = money.facts.find((f) => f.money && f.value) ?? money.facts[0];
  return (
    <section className="space-y-3">
      <SectionTitle title={money.title} sub={money.subtitle} />
      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="rounded-3xl bg-[#15110c] p-5 text-white" data-break>
          <p className="text-[10.5px] font-semibold uppercase tracking-[0.18em] text-[#f0cf86]">{main.label}</p>
          <p className="mt-2 text-4xl font-semibold tracking-tight tabular-nums">{main.money ? tzs(main.value) : num(main.value)}</p>
          <ul className="mt-4 space-y-1.5 text-sm">
            {money.facts.filter((f) => f !== main).map((f) => (
              <li key={f.label} className="flex justify-between gap-3 border-t border-white/10 pt-1.5"><span className="text-white/70">{f.label}{f.sub && <span className="block text-[11px] text-white/45">{f.sub}</span>}</span><span className="font-semibold tabular-nums">{f.money ? tzs(f.value) : num(f.value)}</span></li>
            ))}
          </ul>
        </div>
        <div className="rounded-3xl bg-white p-5 ring-1 ring-[#eee4d2]" data-break>
          <p className="mb-3 text-sm font-semibold">By how it was paid</p>
          {money.byKind.length ? <HBars items={money.byKind.map((k) => ({ label: k.name, value: k.amount }))} fmt={tzs} /> : <p className="rounded-2xl bg-[#f6f1e7] px-4 py-8 text-center text-xs text-[#8c8173]">No payment recorded.</p>}
        </div>
      </div>
    </section>
  );
}

function Records({ tables, clock, day }: { tables: ShiftRecordTable[]; clock: (iso: string) => string; day: (iso: string) => string }) {
  if (!tables.length) return null;
  return (
    <section className="space-y-3">
      <SectionTitle title="The records" sub="Who, which room, how much — the lines behind the figures" />
      {tables.map((t) => (
        <div key={t.title} className="overflow-hidden rounded-3xl bg-white ring-1 ring-[#eee4d2]" data-break>
          <div className="flex items-baseline justify-between gap-2 px-5 pt-4">
            <p className="text-sm font-semibold">{t.title}</p>
            <p className="text-[11px] text-[#8c8173]">{t.rows.length + (t.more ?? 0)} line{t.rows.length + (t.more ?? 0) === 1 ? "" : "s"}{t.subtitle ? ` · ${t.subtitle}` : ""}</p>
          </div>
          <div className="report-scroll mt-2 overflow-x-auto">
            <table className="w-full min-w-[560px] text-sm">
              <thead><tr className="border-y border-[#eee4d2] bg-[#faf6ef] text-left text-[10.5px] uppercase tracking-[0.12em] text-[#8c8173]">
                {t.columns.map((c) => <th key={c.label} className={cn("px-5 py-2 font-semibold", c.align === "right" && "text-right")}>{c.label}</th>)}
              </tr></thead>
              <tbody className="divide-y divide-[#f3efe8]">
                {t.rows.map((row, i) => (
                  <tr key={i}>
                    {row.map((c, j) => {
                      const col = t.columns[j];
                      const isTime = j === 0 && typeof c === "string" && /^\d{4}-\d{2}-\d{2}T/.test(c);
                      return <td key={j} className={cn("px-5 py-2 align-top", col?.align === "right" && "text-right tabular-nums", isTime && "whitespace-nowrap tabular-nums text-[#6f665b]")}>
                        {isTime ? (t.columns[0].label === "When" ? `${day(c as string)} ${clock(c as string)}` : clock(c as string)) : col?.money && typeof c === "number" ? num(c) : c ?? "—"}
                      </td>;
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!!t.more && <p className="px-5 py-2 text-[11px] text-[#8c8173]">…and {num(t.more)} more{t.moreNote ? ` (${t.moreNote})` : ""}.</p>}
        </div>
      ))}
    </section>
  );
}

const AREA_TONE: Record<string, string> = {
  Shift: "bg-[#1d1a16] text-white", "Front desk": "bg-[#e6f4ee] text-[#047857]", Bookings: "bg-[#e8f1fb] text-[#0369a1]", Money: "bg-[#f6efe0] text-[#8a6a25]",
  Restaurant: "bg-[#fdf0e6] text-[#b45309]", Orders: "bg-[#fdf0e6] text-[#b45309]", Requests: "bg-[#f1ebfb] text-[#6d28d9]", Transport: "bg-[#fbe9ee] text-[#be123c]",
};
function Timeline({ items, clock, more }: { items: ShiftReportData["timeline"]; clock: (iso: string) => string; more?: number }) {
  if (!items.length) return null;
  return (
    <section className="space-y-3">
      <SectionTitle title="Timeline" sub="Everything done in the system during the shift, in order" />
      <ol className="relative rounded-3xl bg-white p-5 ring-1 ring-[#eee4d2]">
        <span aria-hidden className="absolute bottom-6 left-[5.35rem] top-6 w-px bg-[#eee4d2]" />
        {items.map((t, i) => (
          <li key={i} className="relative flex items-start gap-4 py-1.5" data-break>
            <span className="w-14 shrink-0 pt-0.5 text-right text-xs font-semibold tabular-nums text-[#6f665b]">{clock(t.at)}</span>
            <span className={cn("relative z-10 mt-1.5 size-2.5 shrink-0 rounded-full ring-4 ring-white", t.area === "Shift" ? "bg-[#1d1a16]" : "bg-[#c9a24a]")} />
            <span className="min-w-0 flex-1 text-sm leading-snug">{t.text}</span>
            <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[10px] font-semibold", AREA_TONE[t.area] ?? "bg-[#f3efe8] text-[#6f665b]")}>{t.area}</span>
          </li>
        ))}
        {!!more && <li className="pl-[6.5rem] pt-2 text-[11px] text-[#8c8173]">…and {num(more)} more (a very long shift — the first part is shown).</li>}
      </ol>
    </section>
  );
}

// ───────────────────────── The three reports ─────────────────────────

export function ShiftReportPaper({ d, hotel, number, preparedAt, preparedBy, timezone }: { d: ShiftReportData; hotel: Hotel; number: string; preparedAt: string; preparedBy: string; timezone: string }) {
  const clock = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(new Date(iso));
  const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: timezone }).format(new Date(iso));
  const date = new Date(`${d.shift.businessDate}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric", timeZone: "UTC" });
  const reception = d.shift.department === "RECEPTION";
  // A shift that ran past midnight shows the day it ended.
  const endsLater = day(d.shift.endedAt) !== day(d.shift.startedAt);
  const ended = endsLater ? `${day(d.shift.endedAt)} ${clock(d.shift.endedAt)}` : clock(d.shift.endedAt);
  return (
    <Paper hotel={hotel} eyebrow="Shift report" title={d.person.name} period={`${date} · ${clock(d.shift.startedAt)} → ${ended}`} number={number} preparedAt={preparedAt}
      signoff={[["Prepared by", preparedBy], ["Staff member", d.person.name], ["Manager", ""]]}>
      <Who name={d.person.name} role={d.person.role} dept={`${reception ? "Reception" : "Restaurant & bar"} · ${d.shift.label}`}
        lines={[["Started", clock(d.shift.startedAt)], ["Ended", ended], ["On shift", dur(d.shift.minutes)], ["Hotel day", new Date(`${d.shift.businessDate}T12:00:00Z`).toLocaleDateString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })], ["Closed", d.shift.byManager ? `by ${d.shift.closedBy ?? "a manager"}` : "by themselves"], ["Actions", num((d.timeline ?? []).filter((t) => t.area !== "Shift").length + (d.timelineLeft ?? 0))]]}
        chips={[d.shift.byManager && d.shift.closeReason ? `Closed by a manager — ${d.shift.closeReason}` : "", d.shift.replacement ? `Covering — ${d.shift.replacement}` : ""].filter(Boolean)} />
      <Kpis facts={d.headline ?? []} />
      {(d.handover?.length ?? 0) > 0 && (
        <section className="rounded-3xl bg-[#fdf6ea] p-5 ring-1 ring-[#f0dcb8]" data-break>
          <p className="flex items-center gap-2 text-[11px] font-semibold uppercase tracking-[0.18em] text-[#b45309]"><ShieldAlert className="size-4" />At the end of the shift</p>
          <ul className="mt-2 space-y-1.5 text-sm">{d.handover.map((h) => <li key={h} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-[#b45309]" />{h}</li>)}</ul>
        </section>
      )}
      {(d.hours?.length ?? 0) > 1 && <Bars title="How busy each hour was" sub="actions in the system" items={d.hours!.map((h) => ({ label: clock(h.at), value: h.count }))} />}
      <Groups groups={d.groups ?? []} />
      <Money money={d.money} />
      <Records tables={d.records ?? []} clock={clock} day={day} />
      <Timeline items={d.timeline ?? []} clock={clock} more={d.timelineLeft} />
    </Paper>
  );
}

export function PersonPeriodPaper({ d, hotel, number, preparedAt, timezone, shiftHref }: { d: PersonPeriodData; hotel: Hotel; number: string; preparedAt: string; timezone: string; shiftHref?: (id: string, report: boolean) => string | null }) {
  const clock = (iso: string) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: timezone }).format(new Date(iso));
  const day = (iso: string) => new Intl.DateTimeFormat("en-GB", { day: "numeric", month: "short", timeZone: timezone }).format(new Date(iso));
  const label = (date: string) => d.kind === "WEEK" ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" }) : String(Number(date.slice(8)));
  const what = d.kind === "WEEK" ? "Weekly report" : "Monthly report";
  return (
    <Paper hotel={hotel} eyebrow={`${what}${d.live ? " · so far" : ""}`} title={d.person.name} period={d.label} number={number} preparedAt={preparedAt}
      signoff={[["Prepared by", "System · automatic staff report"], ["Staff member", d.person.name], ["Manager", ""]]}>
      <Who name={d.person.name} role={d.person.role} dept={d.department === "RECEPTION" ? "Reception" : "Restaurant & bar"}
        lines={[["Shifts", num(d.totals.shifts)], ["On shift", dur(d.totals.minutes)], ["Days worked", `${d.totals.days} of ${d.days.length}`], ["Average shift", d.totals.shifts ? dur(Math.round(d.totals.minutes / d.totals.shifts)) : "—"]]}
        chips={d.live ? ["So far — the full report is made when the period ends"] : []} />
      <Kpis facts={d.headline.slice(2)} compare={`Small figures next to each number: the change against the ${d.kind === "WEEK" ? "week" : "month"} before.`} />
      <div className="grid gap-3 lg:grid-cols-2">
        <Bars title="Hours on shift" sub="per day" items={d.days.map((x) => ({ label: label(x.date), value: Math.round(x.minutes / 6) / 10 }))} fmt={(n) => `${n}h`} />
        <Bars title={d.series.a} sub="per day" items={d.days.map((x) => ({ label: label(x.date), value: x.a }))} tone="bg-[#10b981]" />
        <Bars title={d.series.b} sub="per day" items={d.days.map((x) => ({ label: label(x.date), value: x.b }))} tone="bg-[#38bdf8]" />
        <Bars title="Money they recorded" sub="TZS per day" items={d.days.map((x) => ({ label: label(x.date), value: x.money }))} fmt={(n) => (n >= 1000 ? `${Math.round(n / 1000)}k` : num(n))} tone="bg-[#a78bfa]" />
      </div>
      <Groups groups={d.groups} />
      <Money money={d.money} />
      {d.shifts.length > 0 && (
        <section className="space-y-3">
          <SectionTitle title="The shifts" sub="Each shift and its report" />
          <div className="overflow-hidden rounded-3xl bg-white ring-1 ring-[#eee4d2]" data-break>
            <div className="report-scroll overflow-x-auto">
              <table className="w-full min-w-[620px] text-sm">
                <thead><tr className="border-b border-[#eee4d2] bg-[#faf6ef] text-left text-[10.5px] uppercase tracking-[0.12em] text-[#8c8173]">
                  <th className="px-5 py-2 font-semibold">Day</th><th className="px-3 py-2 font-semibold">Hours</th><th className="px-3 py-2 text-right font-semibold">On shift</th><th className="px-3 py-2 font-semibold">Highlights</th><th className="px-5 py-2" />
                </tr></thead>
                <tbody className="divide-y divide-[#f3efe8]">
                  {d.shifts.map((s) => {
                    const href = shiftHref?.(s.reportId ? s.id : s.id, !!s.reportId) ?? null;
                    return (
                      <tr key={s.id}>
                        <td className="whitespace-nowrap px-5 py-2 font-medium">{day(s.startedAt)}</td>
                        <td className="whitespace-nowrap px-3 py-2 tabular-nums text-[#6f665b]">{clock(s.startedAt)} → {s.endedAt ? clock(s.endedAt) : "open"}</td>
                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{dur(s.minutes)}</td>
                        <td className="px-3 py-2 text-[12px] text-[#6f665b]">{s.headline.length ? s.headline.map((f) => (f.money ? tzs(f.value) : `${num(f.value)} ${f.label.toLowerCase()}`)).join(" · ") : "—"}</td>
                        <td className="px-5 py-2 text-right">{href && <Link href={href} className="inline-flex items-center gap-1 rounded-lg bg-[#f6efe0] px-2 py-1 text-[11px] font-semibold text-[#8a6a25]"><FileText className="size-3" />Report</Link>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}
      <Records tables={d.records} clock={clock} day={day} />
    </Paper>
  );
}

/** "+12% vs last week" — the change against the period before (nothing without a base). */
function vs(cur: number, prev: number, what: string) {
  if (!(prev > 0) || cur === prev) return null;
  return `${cur > prev ? "+" : "−"}${Math.round((Math.abs(cur - prev) / prev) * 100)}% vs ${what}`;
}

/** The business over the week or month: income, money, rooms, the restaurant, guests, expenses. */
function BusinessSection({ b, kind, live = false }: { b: BusinessPeriod; kind: "WEEK" | "MONTH"; live?: boolean }) {
  const before = kind === "WEEK" ? "last week" : "last month";
  const label = (date: string) => kind === "WEEK" ? new Date(`${date}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", timeZone: "UTC" }) : String(Number(date.slice(8)));
  const k = (n: number) => (Math.abs(n) >= 1_000_000 ? `${Math.round(n / 100_000) / 10}M` : Math.abs(n) >= 1000 ? `${Math.round(n / 1000)}k` : num(n));
  const figures: { icon: LucideIcon; label: string; value: string; note?: string | null }[] = [
    { icon: Landmark, label: "Revenue (net)", value: tzs(b.revenue.total), note: vs(b.revenue.total, b.revenue.prev, before) },
    { icon: Wallet, label: "Money received", value: tzs(b.received), note: vs(b.received, b.prevReceived, before) },
    { icon: Receipt, label: "Expenses", value: tzs(b.expenses), note: vs(b.expenses, b.prevExpenses, before) },
    { icon: Scale, label: "Net operating result", value: `${b.result < 0 ? "−" : ""}${tzs(Math.abs(b.result))}`, note: "revenue − expenses" },
    { icon: BedDouble, label: "Occupancy", value: `${b.rooms.occupancy}%`, note: b.rooms.prevOccupancy || b.rooms.occupancy ? `${b.rooms.prevOccupancy}% ${before}` : null },
    { icon: UtensilsCrossed, label: "Restaurant & bar orders", value: num(b.restaurant.orders), note: vs(b.restaurant.orders, b.restaurant.prevOrders, before) },
  ];
  const depts = ([
    ["Rooms", b.revenue.rooms], ["Restaurant", b.revenue.restaurant], ["Bar", b.revenue.bar], ["Room service", b.revenue.roomService],
    ["Meeting room", b.revenue.meeting], ["Transport", b.revenue.transport], ["Other", b.revenue.other],
  ] as const).filter(([, v]) => v > 0).map(([label, value]) => ({ label, value }));
  const guests: [string, number][] = [["Checked in", b.guests.checkIns], ["Checked out", b.guests.checkOuts], ["New bookings", b.guests.newBookings], ["Cancelled", b.guests.cancellations], ["No-shows", b.guests.noShows]];
  return (
    <section className="space-y-4">
      <SectionTitle title="The business" sub={live ? `So far · compared with the same days ${before} (whole days — today is still running)` : `The same figures as Finance and the daily report · compared with ${before}`} />
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
        <Bars title="Revenue" sub="TZS per day" items={b.days.map((x) => ({ label: label(x.date), value: x.total }))} fmt={k} />
        <div className="rounded-3xl bg-white p-5 ring-1 ring-[#eee4d2]" data-break>
          <p className="mb-3 text-sm font-semibold">Revenue by department</p>
          {depts.length ? <HBars items={depts} fmt={tzs} /> : <p className="rounded-2xl bg-[#f6f1e7] px-4 py-8 text-center text-xs text-[#8c8173]">No revenue recorded.</p>}
          {(b.revenue.discounts > 0 || b.revenue.refunds > 0) && <p className="mt-3 text-[11px] text-[#8c8173]">{b.revenue.discounts > 0 && `Room discounts given ${tzs(b.revenue.discounts)}`}{b.revenue.discounts > 0 && b.revenue.refunds > 0 && " · "}{b.revenue.refunds > 0 && `refunds ${tzs(b.revenue.refunds)}`}</p>}
        </div>
        <Bars title="Occupancy" sub="% of rooms, per night" items={b.days.map((x) => ({ label: label(x.date), value: x.occupancy }))} fmt={(n) => `${n}%`} tone="bg-[#38bdf8]" />
        <Bars title="Money received" sub="TZS per day" items={b.days.map((x) => ({ label: label(x.date), value: x.received }))} fmt={k} tone="bg-[#10b981]" />
      </div>
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="rounded-3xl bg-white p-5 ring-1 ring-[#eee4d2]" data-break>
          <p className="text-sm font-semibold">Rooms & guests</p>
          <p className="mt-1 text-[11px] text-[#8c8173]">{num(b.rooms.roomNights)} room nights of {num(b.rooms.sellable)}{b.rooms.adr ? ` · average rate ${tzs(b.rooms.adr)}` : ""}</p>
          <ul className="mt-3 divide-y divide-[#f3efe8]">
            {guests.map(([l, v]) => <li key={l} className="flex justify-between py-1.5 text-sm"><span>{l}</span><span className="font-semibold tabular-nums">{num(v)}</span></li>)}
          </ul>
        </div>
        <div className="rounded-3xl bg-white p-5 ring-1 ring-[#eee4d2]" data-break>
          <p className="text-sm font-semibold">Restaurant & bar</p>
          <p className="mt-1 text-[11px] text-[#8c8173]">{num(b.restaurant.orders)} orders · {tzs(b.restaurant.sales)}{b.restaurant.averageOrder ? ` · average ${tzs(b.restaurant.averageOrder)}` : ""}</p>
          {b.restaurant.best.length ? (
            <ol className="mt-3 space-y-1.5">
              {b.restaurant.best.map((x, i) => <li key={x.name} className="flex items-baseline gap-2 text-sm"><span className="w-4 shrink-0 text-[11px] font-semibold text-[#8c8173]">{i + 1}</span><span className="min-w-0 flex-1 truncate">{x.name} <span className="text-[11px] text-[#8c8173]">×{num(x.quantity)}</span></span><span className="font-semibold tabular-nums">{num(x.amount)}</span></li>)}
            </ol>
          ) : <p className="mt-3 rounded-2xl bg-[#f6f1e7] px-4 py-6 text-center text-xs text-[#8c8173]">No orders.</p>}
        </div>
        <div className="rounded-3xl bg-white p-5 ring-1 ring-[#eee4d2]" data-break>
          <p className="text-sm font-semibold">Expenses</p>
          <p className="mt-1 text-[11px] text-[#8c8173]">{tzs(b.expenses)} · owed to the hotel today {tzs(b.outstanding)}</p>
          <div className="mt-3">{b.expensesByCategory.length ? <HBars items={b.expensesByCategory.map((c) => ({ label: c.name, value: c.amount }))} fmt={(n) => num(n)} /> : <p className="rounded-2xl bg-[#f6f1e7] px-4 py-6 text-center text-xs text-[#8c8173]">No expenses.</p>}</div>
        </div>
      </div>
    </section>
  );
}

export function TeamPeriodPaper({ d, hotel, number, preparedAt, personHref }: { d: TeamPeriodData; hotel: Hotel; number: string; preparedAt: string; personHref: (p: TeamPeriodData["people"][number]) => string }) {
  const what = d.kind === "WEEK" ? "Weekly report" : "Monthly report";
  const dept = (k: "RECEPTION" | "RESTAURANT") => d.people.filter((p) => p.department === k);
  const hours = d.people.reduce((t, p) => t + p.minutes, 0);
  return (
    <Paper hotel={hotel} eyebrow={what} title={d.business ? "Business & team" : "The team"} period={d.label} number={number} preparedAt={preparedAt}
      signoff={[["Prepared by", "System · automatic report"], ["Checked by", ""], ["Approved by (MD)", ""]]}>
      {d.business && <BusinessSection b={d.business} kind={d.kind} live={d.live} />}
      {d.business && <SectionTitle title="The team" sub="Who worked, and each person's own report" />}
      <section className="grid grid-cols-2 gap-3 sm:grid-cols-4" data-break>
        {[[Users, "People who worked", num(d.people.length)], [Clock, "Shifts", num(d.people.reduce((t, p) => t + p.shifts, 0))], [Clock, "Hours on shift", dur(hours)], [CalendarCheck, "Reception · Restaurant", `${dept("RECEPTION").length} · ${dept("RESTAURANT").length}`]].map(([Icon, label, value], i) => {
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
          <p className="mb-3 text-sm font-semibold">Hours on shift <span className="font-normal text-[#8c8173]">· by person</span></p>
          <HBars items={d.people.map((p) => ({ label: p.name, value: Math.round(p.minutes / 6) / 10, sub: p.department === "RECEPTION" ? "Reception" : "Restaurant" }))} fmt={(n) => `${n}h`} />
        </div>
      )}
      {(["RECEPTION", "RESTAURANT"] as const).map((k) => dept(k).length > 0 && (
        <section key={k} className="space-y-3">
          <SectionTitle title={k === "RECEPTION" ? "Reception" : "Restaurant & bar"} sub="Each person's own report is one tap away" />
          <div className="grid gap-3 md:grid-cols-2">
            {dept(k).map((p) => (
              <Link key={p.userId} href={personHref(p)} className="block rounded-3xl bg-white p-5 ring-1 ring-[#eee4d2] transition hover:ring-[#c9a24a]" data-break>
                <div className="flex items-center gap-3">
                  <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-linear-to-br from-[#f0cf86] to-[#b0863a] text-sm font-bold text-[#1b1611]">{initials(p.name)}</span>
                  <div className="min-w-0 flex-1 leading-tight"><p className="truncate font-semibold">{p.name}</p><p className="text-[11px] text-[#8c8173]">{p.role} · {p.shifts} shift{p.shifts === 1 ? "" : "s"} · {dur(p.minutes)}</p></div>
                  <span className="inline-flex items-center gap-1 rounded-lg bg-[#f6efe0] px-2 py-1 text-[11px] font-semibold text-[#8a6a25]"><FileText className="size-3" />Report</span>
                </div>
                {p.headline.length > 0 && (
                  <ul className="mt-3 grid grid-cols-2 gap-2">
                    {p.headline.map((f) => <li key={f.label} className="rounded-xl bg-[#faf6ef] px-3 py-2"><p className="text-base font-semibold tabular-nums">{f.money ? tzs(f.value) : num(f.value)}</p><p className="text-[11px] leading-snug text-[#6f665b]">{f.label}</p></li>)}
                  </ul>
                )}
              </Link>
            ))}
          </div>
        </section>
      ))}
      {d.people.length === 0 && <p className="rounded-2xl bg-white px-4 py-8 text-center text-sm text-[#8c8173] ring-1 ring-[#eee4d2]">No shift was worked in this time.</p>}
    </Paper>
  );
}
