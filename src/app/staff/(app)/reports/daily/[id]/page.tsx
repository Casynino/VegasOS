import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  AlertTriangle, ArrowLeft, Banknote, History, BedDouble, CalendarCheck, CheckCheck, CircleDashed, FileText, HandCoins, Hourglass, MessageCircle, Percent, Receipt, Scale, Send, TrendingUp, UsersRound, Wallet,
  type LucideIcon,
} from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { formatTZS } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MoneyCard } from "@/components/dashboard/money-card";
import { RegenerateReportButton, SendReportButton } from "../report-buttons";
import { ReportDocument } from "../../report-document";
import { ReportActions } from "../../report-actions";
import { getSettings } from "@/server/settings";
import type { Report } from "@/lib/report-types";
import { dailyReportTextIn, type DailyReportData } from "@/server/services/daily-report";
import { buildDailyDocument } from "@/server/services/daily-document";
import { recipientLang, sendingNow, type Recipient } from "@/server/services/report-delivery";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { LOCALE_META, type Locale } from "@/i18n/config";
import type { T } from "@/i18n/translate";
import { reportTr } from "@/lib/report-i18n";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Daily report") };
}

const DELIVERY: Record<string, { label: string; cls: string }> = {
  SENDING: { label: msg("Sending…"), cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  PENDING: { label: msg("Waiting"), cls: "bg-muted text-muted-foreground" },
  SENT: { label: msg("Sent"), cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  DELIVERED: { label: msg("Delivered"), cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  FAILED: { label: msg("Failed"), cls: "bg-rose-500/15 text-rose-600 dark:text-rose-400" },
};

/**
 * One day's boss report (made after the 04:00 close, sent by WhatsApp): what needs attention
 * first, the day's money in one card, then rooms, income, expenses, money received, arrivals and
 * changes, the staff — and the message exactly as sent, with its delivery.
 */
export default async function DailyReportPage({ params }: PageProps<"/staff/reports/daily/[id]">) {
  const user = await requirePagePermission("reports.view");
  const { id } = await params;
  const r = await db.dailyReport.findUnique({ where: { id }, include: { deliveries: { orderBy: { createdAt: "asc" } }, versions: { orderBy: { version: "desc" } } } });
  if (!r) notFound();
  const [s, t] = await Promise.all([getSettings(), getT()]);
  const date = r.businessDate.toISOString().slice(0, 10);
  const manage = can(user, "reports.daily.manage");
  const regenerate = can(user, "dashboard.admin") || can(user, "dashboard.owner");
  const d = r.data as unknown as DailyReportData;
  // Reports made before the full document existed are shown in the same document now (from their
  // saved figures; money received = what the methods add up to, as the new reports count it).
  let doc = r.document as unknown as Report | null;
  if (!doc && d?.money) {
    const methods = d.money.byMethod?.reduce((t, m) => t + m.amount, 0) ?? 0;
    const fixed: DailyReportData = { ...d, money: { ...d.money, collected: d.money.collected || methods } };
    doc = await buildDailyDocument(date, fixed).catch(() => null);
  }
  const sentNow = r.deliveries.filter((x) => x.status === "SENT" && x.sentAt && x.sentAt >= r.generatedAt);
  const failed = r.deliveries.filter((x) => x.status === "FAILED");
  // A send in progress (the 21:00 run, or a click a moment ago): "Sending…", no second button.
  const status = r.deliveries.some((x) => sendingNow(x)) ? "SENDING" : sentNow.length ? "SENT" : failed.length ? "FAILED" : "PENDING";
  const weekday = new Date(`${date}T00:00:00Z`).toLocaleDateString(t.intl, { weekday: "long", timeZone: "UTC" });
  const when = (x: Date) => t.dateTime(x, s.timezone);
  // The message in each recipient's language (the same figures), and the reader's own for sharing.
  const recipients = (s.reportRecipients as unknown as Recipient[]) ?? [];
  const langOf = new Map(recipients.map((x) => [x.phone, recipientLang(x)]));
  const langs = [...new Set<Locale>(["en", ...recipients.map(recipientLang), ...(t.locale === "en" ? [] : [t.locale])])];
  const texts = new Map<Locale, string>(await Promise.all(langs.map(async (l) => [l, l === "en" ? r.summaryText : await dailyReportTextIn(r, l).catch(() => r.summaryText)] as const)));
  const shownLangs = langs.filter((l) => l === "en" || recipients.some((x) => recipientLang(x) === l));
  const made = new Intl.DateTimeFormat(t.intl, { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: s.timezone }).format(r.generatedAt);
  const number = `DR-${date.replaceAll("-", "")}-v${r.version}`;
  const hotel = {
    name: s.hotelName, tagline: s.tagline,
    address: [s.postalAddress, s.addressLine, s.city, s.country].filter(Boolean).join(", "),
    contact: [s.phone, s.email, s.website].filter(Boolean).join("  ·  "),
  };

  return (
    <div className="w-full space-y-4">
      <style>{"@media print { @page { size: A4; margin: 8mm; } html, body, #staff-root { background: #fff !important; } }"}</style>
      {/* Slim header */}
      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card print:hidden">
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[oklch(0.78_0.12_80)]/70 to-transparent" />
        <div className="relative flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Link href="/staff/reports/daily" aria-label={t("All daily reports")} className="grid size-10 shrink-0 place-items-center rounded-xl border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><ArrowLeft className="size-4" /></Link>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">{t("Daily business report")} · {weekday}</p>
              <h1 className="text-xl font-semibold leading-tight tracking-tight tabular-nums">{t.shortDate(date)}</h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>{r.automatic ? t("Made automatically at {time}", { time: made }) : t("Made by {name} at {time}", { name: r.generatedBy, time: made })}</span>
                {r.version > 1 && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">{t("Version {n}", { n: r.version })}</span>}
                <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", DELIVERY[status].cls)}>
                  {status === "SENT" ? <CheckCheck className="size-3" /> : status === "FAILED" ? <AlertTriangle className="size-3" /> : <CircleDashed className={cn("size-3", status === "SENDING" && "animate-spin")} />}
                  {status === "SENT" ? `${t("Sent to the Boss")}${sentNow[0]?.sentAt ? ` · ${when(sentNow[0].sentAt)}` : ""}` : status === "FAILED" ? t("Message failed") : status === "SENDING" ? t("Sending…") : t("Not sent yet")}
                </span>
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {doc && <ReportActions fileName={`${s.hotelName.replace(/[^\w]+/g, "-")}-daily-report-${date}`.toLowerCase()} share={(texts.get(t.locale) ?? r.summaryText).replace(/\*/g, "")} />}
            {manage && (status === "PENDING" || status === "FAILED") && <SendReportButton reportId={r.id} label={status === "FAILED" ? t("Retry send") : t("Send now")} className="h-9 text-xs" />}
            {manage && status === "SENT" && <SendReportButton reportId={r.id} force label={t("Send again")} className="h-9 text-xs" />}
            {regenerate && <RegenerateReportButton date={date} className="h-9 text-xs" />}
          </div>
        </div>
      </section>

      {/* A failed message is visible — with the reason and a retry */}
      {failed.length > 0 && status !== "SENT" && status !== "SENDING" && (
        <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-rose-500/30 bg-rose-500/[0.07] px-4 py-3 print:hidden">
          <AlertTriangle className="size-5 shrink-0 text-rose-500" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-rose-700 dark:text-rose-300">{t("The report was made, but the message to the Boss failed")}</p>
            <p className="truncate text-xs text-muted-foreground">{failed[0].lastError ?? t("No answer from the provider")} · {t.plural(failed[0].attempts, "{n} attempt", "{n} attempts")}</p>
          </div>
          {manage && <SendReportButton reportId={r.id} label={t("Retry send")} className="h-9 text-xs" />}
        </section>
      )}

      {doc ? (
        <ReportDocument report={doc} hotel={hotel} number={number}
          preparedBy={r.automatic ? t("System · automatic daily report") : r.generatedBy} preparedAt={`${when(r.generatedAt)}${r.version > 1 ? ` · ${t("version {n}", { n: r.version })}` : ""}`} />
      ) : (
        <>
          <p className="rounded-2xl bg-muted/50 px-4 py-2.5 text-xs text-muted-foreground print:hidden">{t("This report was made before the full daily report existed — shown in its original form.")}</p>
          {d.attention.length > 0 && (
            <section className="rounded-3xl border border-amber-500/30 bg-amber-500/[0.06] p-4 sm:p-5">
              <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-amber-700 dark:text-amber-300"><AlertTriangle className="size-4" />{t("Needs attention")} · {d.attention.length}</h2>
              <ul className="space-y-1.5 text-sm">{d.attention.map((a) => <li key={a} className="flex gap-2"><span className="mt-2 size-1.5 shrink-0 rounded-full bg-amber-500" /><span>{reportTr(t, d.i18n)(a)}</span></li>)}</ul>
            </section>
          )}
          <ReportView d={d} t={t} />
        </>
      )}

      {/* The message the Boss gets, its delivery, and earlier versions */}
      <div className="grid gap-4 print:hidden lg:grid-cols-[minmax(0,1fr)_340px]">
        <Section icon={MessageCircle} title={t("The message the Boss receives")}>
          <div className="space-y-3">
            {shownLangs.map((l) => (
              <div key={l}>
                {shownLangs.length > 1 && <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{LOCALE_META[l].label}</p>}
                <div className="max-w-md rounded-2xl rounded-tl-sm bg-[#e7ffdb] p-4 text-[13px] leading-relaxed text-zinc-900 shadow-sm dark:bg-[#1f3a2c] dark:text-white">
                  {(texts.get(l) ?? r.summaryText).split("\n").map((line, i) => (
                    <p key={i} className={cn(line === "" && "h-3", "break-words")} dangerouslySetInnerHTML={{ __html: escapeBold(line) }} />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Section>
        <div className="space-y-4">
          <Section icon={Send} title={t("Delivery")}>
            {r.deliveries.length === 0 ? <p className="text-sm text-muted-foreground">{t("Not sent yet. Add who receives it under Settings → Report recipients.")}</p> : (
              <ul className="space-y-2 text-sm">
                {r.deliveries.map((x) => {
                  const look = sendingNow(x) ? DELIVERY.SENDING : DELIVERY[x.status] ?? DELIVERY.PENDING;
                  return (
                    <li key={x.id} className="rounded-2xl bg-muted/40 px-3 py-2.5">
                      <div className="flex items-center justify-between gap-2"><span className="truncate font-mono text-xs">{x.recipient}</span><span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", look.cls)}>{t(look.label)}</span></div>
                      <p className="mt-0.5 text-[11px] text-muted-foreground">{x.channel === "WHATSAPP_CALLMEBOT" ? "WhatsApp (CallMeBot)" : x.channel.replace("_", " ").toLowerCase()} · {LOCALE_META[langOf.get(x.recipient) ?? "en"].label} · {t.plural(x.attempts, "{n} attempt", "{n} attempts")}{x.sentAt && ` · ${when(x.sentAt)}`}</p>
                      {x.lastError && <p className="mt-0.5 text-[11px] text-rose-600 dark:text-rose-400">{x.lastError}</p>}
                    </li>
                  );
                })}
              </ul>
            )}
          </Section>
          <Section icon={History} title={t("Versions")}>
            <ul className="space-y-2 text-sm">
              <li className="rounded-2xl bg-muted/40 px-3 py-2.5">
                <p className="flex items-center justify-between gap-2"><span className="font-semibold">{t("Version {n} · current", { n: r.version })}</span><span className="text-[11px] text-muted-foreground">{when(r.generatedAt)}</span></p>
                <p className="text-[11px] text-muted-foreground">{r.automatic ? t("Automatic (system)") : r.generatedBy}{r.reason ? ` — ${r.reason}` : ""}</p>
              </li>
              {r.versions.map((v) => (
                <li key={v.id} className="rounded-2xl border border-dashed border-border px-3 py-2.5">
                  <p className="flex items-center justify-between gap-2"><span className="font-medium">{t("Version {n}", { n: v.version })}</span><span className="text-[11px] text-muted-foreground">{when(v.generatedAt)}</span></p>
                  <p className="text-[11px] text-muted-foreground">{v.automatic ? t("Automatic (system)") : v.generatedBy} · {t("replaced by {name} {when}", { name: v.replacedBy, when: when(v.replacedAt) })}</p>
                </li>
              ))}
            </ul>
          </Section>
        </div>
      </div>
    </div>
  );
}

/** Escape HTML, then render WhatsApp *bold* markers. */
function escapeBold(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\*([^*]+)\*/g, "<strong>$1</strong>");
}

function Section({ icon: Icon, title, className, children, href, linkLabel }: { icon: LucideIcon; title: string; className?: string; children: React.ReactNode; href?: string; linkLabel?: string }) {
  return (
    <section className={cn("min-w-0 rounded-3xl border border-border/70 bg-card p-4 sm:p-5", className)}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold"><span className="grid size-7 place-items-center rounded-lg bg-muted text-muted-foreground [&_svg]:size-3.5"><Icon /></span>{title}</h2>
        {href && <Link href={href} className="text-xs font-semibold text-[oklch(0.55_0.11_75)] hover:underline dark:text-[oklch(0.8_0.11_82)]">{linkLabel} →</Link>}
      </div>
      {children}
    </section>
  );
}

const amt = (v: number) => formatTZS(v).replace("TZS ", "");
function Row({ label, value, strong, tone }: { label: string; value: string; strong?: boolean; tone?: string }) {
  return (
    <div className={cn("flex items-baseline justify-between gap-3 py-1.5 text-[13px]", strong && "mt-1 border-t border-dashed border-border pt-2 font-semibold")}>
      <span className={cn("min-w-0", !strong && "text-muted-foreground")}>{label}</span>
      <span className={cn("shrink-0 tabular-nums", tone)}>{value}</span>
    </div>
  );
}

/** The report as a page: the same numbers as the message, laid out to read in one look. */
function ReportView({ d, t }: { d: DailyReportData; t: T }) {
  const other = (d.revenue.roomService ?? 0) + (d.revenue.transport ?? 0) + d.revenue.meeting + d.revenue.other;
  const result = d.profitLoss.estimated;
  return (
    <div className="space-y-4">
      <MoneyCard title={t("The day's money")} href={`/staff/reports?r=summary&from=${d.businessDate}&to=${d.businessDate}`} linkLabel={t("Full report")}
        headline={{ value: formatTZS(d.revenue.total), label: t("Income earned (net) — every department") }}
        split={[
          { label: t("Rooms"), value: d.revenue.roomNet, color: "#8b5cf6" },
          { label: t("Restaurant"), value: d.revenue.restaurant, color: "#f59e0b" },
          { label: t("Bar"), value: d.revenue.bar, color: "#0ea5e9" },
          { label: t("Other"), value: other, color: "#c9a24a" },
        ]}
        cells={[
          { label: t("Money received"), icon: <Banknote />, tint: "bg-emerald-500/15 text-emerald-500", value: formatTZS(d.money.collected), tone: "good", sub: t("all accounts") },
          { label: t("Expenses"), icon: <Receipt />, tint: "bg-rose-500/15 text-rose-400", value: formatTZS(d.expenses.total), sub: t.plural(d.expenses.byCategory.length, "{n} category", "{n} categories") },
          { label: result >= 0 ? t("Result") : t("Loss"), icon: <TrendingUp />, tint: "bg-[oklch(0.72_0.12_80/0.18)] text-[oklch(0.8_0.11_82)]", value: formatTZS(Math.abs(result)), tone: result >= 0 ? "good" : "bad", sub: t("income − expenses") },
          { label: t("Owed to the hotel"), icon: <Wallet />, tint: "bg-amber-500/15 text-amber-400", value: formatTZS(d.money.outstanding), tone: d.money.outstanding ? "warn" : undefined, sub: t("all dates") },
          { label: t("Occupancy"), icon: <Percent />, tint: "bg-violet-500/15 text-violet-400", value: `${d.hotel.occupancy}%`, sub: t.plural(d.hotel.roomsSold, "{n} room sold", "{n} rooms sold") },
          { label: t("Guests in · out"), icon: <UsersRound />, tint: "bg-sky-500/15 text-sky-400", value: `${d.guests.checkIns} · ${d.guests.checkOuts}`, sub: t("checked in · out") },
        ]} />

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        <Section icon={BedDouble} title={t("Rooms")}>
          {d.rooms && <Row label={t("Rooms in the hotel")} value={String(d.rooms.total)} />}
          <Row label={t("Rooms sold")} value={String(d.hotel.roomsSold)} />
          <Row label={t("Occupancy")} value={`${d.hotel.occupancy}%`} />
          {d.rooms && <Row label={t("Free · cleaning · repair")} value={`${d.rooms.available} · ${d.rooms.cleaning} · ${d.rooms.outOfOrder}`} />}
          {d.rooms && <Row label={t("Average room rate")} value={amt(d.rooms.adr)} />}
          {d.rooms && d.rooms.companyCredit > 0 && <Row label={t("Company credit · paid now")} value={`${amt(d.rooms.companyCredit)} · ${amt(d.rooms.direct)}`} />}
          {d.rateBreakdown && d.rateBreakdown.length > 0 && (
            <>
              <p className="mb-0.5 mt-2 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{t("Room rates")}</p>
              {d.rateBreakdown.map((rb) => (
                <Row key={rb.rate} label={`${amt(rb.rate)} × ${String(rb.rooms)}`} value={amt(rb.net)} />
              ))}
            </>
          )}
        </Section>

        <Section icon={TrendingUp} title={t("Income")}>
          <Row label={t("Rooms")} value={amt(d.revenue.roomNet)} />
          <Row label={t("Restaurant")} value={amt(d.revenue.restaurant)} />
          <Row label={t("Bar")} value={amt(d.revenue.bar)} />
          {!!d.revenue.roomService && <Row label={t("Room service fees")} value={amt(d.revenue.roomService)} />}
          {!!d.revenue.transport && <Row label={t("Transport")} value={amt(d.revenue.transport)} />}
          {!!d.revenue.meeting && <Row label={t("Meeting room")} value={amt(d.revenue.meeting)} />}
          {!!d.revenue.other && <Row label={t("Other services")} value={amt(d.revenue.other)} />}
          {d.revenue.roomDiscounts > 0 && <Row label={t("Discounts (in rooms)")} value={`− ${amt(d.revenue.roomDiscounts)}`} tone="text-rose-600 dark:text-rose-400" />}
          {d.revenue.refunds > 0 && <Row label={t("Refunds")} value={`− ${amt(d.revenue.refunds)}`} tone="text-rose-600 dark:text-rose-400" />}
          <Row label={t("Total income")} value={formatTZS(d.revenue.total)} strong />
        </Section>

        <Section icon={HandCoins} title={t("Money received")}>
          {(d.money.byMethod ?? []).map((m) => <Row key={m.method} label={t(m.method)} value={amt(m.amount)} />)}
          {!!d.money.companyPayments && <Row label={t("of which company invoices")} value={amt(d.money.companyPayments)} />}
          <Row label={t("Total received")} value={formatTZS(d.money.collected)} strong />
          {!!d.money.companyInvoiced && <Row label={t("Invoiced to companies (owed)")} value={amt(d.money.companyInvoiced)} />}
          {!!d.money.inHouseOutstanding && <Row label={t("Guests staying owe ({n})", { n: d.money.inHouseOwing ?? 0 })} value={amt(d.money.inHouseOutstanding)} tone="text-amber-600 dark:text-amber-300" />}
          <Row label={t("Owed to the hotel (all)")} value={amt(d.money.outstanding)} />
          {(d.cashDifferences ?? []).map((c) => <p key={c.account + c.by} className="mt-1 text-xs text-rose-600 dark:text-rose-400">{t("Cash count {account}: {difference} ({by})", { account: t(c.account), difference: `${c.difference > 0 ? "+" : "−"}${amt(Math.abs(c.difference))}`, by: c.by })}</p>)}
        </Section>

        <Section icon={Receipt} title={t("Expenses")}>
          {d.expenses.byCategory.length === 0 ? <p className="text-sm text-muted-foreground">{t("No expenses on this day.")}</p> : d.expenses.byCategory.map((c) => <Row key={c.name} label={t(c.name)} value={amt(c.amount)} />)}
          <Row label={t("Total expenses")} value={formatTZS(d.expenses.total)} strong />
        </Section>

        {(d.arrivals || d.changes) && (
          <Section icon={CalendarCheck} title={t("Arrivals & changes")} href={`/staff/finance/history?from=${d.businessDate}&to=${d.businessDate}`} linkLabel={t("Every change")}>
            {d.arrivals && <>
              <Row label={t("Arrivals expected")} value={String(d.arrivals.expected)} />
              <Row label={t("Checked in")} value={String(d.arrivals.checkedIn)} />
              {!!d.arrivals.late && <Row label={t("Late (guest called)")} value={String(d.arrivals.late)} />}
              <Row label={t("No-shows")} value={String(d.arrivals.noShow)} tone={d.arrivals.noShow ? "text-rose-600 dark:text-rose-400" : undefined} />
            </>}
            {d.changes && <>
              <Row label={t("Date changes")} value={String(d.changes.dates)} />
              <Row label={t("Room changes")} value={String(d.changes.rooms)} />
              {d.changes.roomMoves && d.changes.rooms > 0 && <>
                <Row label={t("· guest asked")} value={String(d.changes.roomMoves.customer)} />
                <Row label={t("· hotel problem")} value={`${d.changes.roomMoves.hotel} (${t("{n} free", { n: d.changes.roomMoves.freeHotel })}${d.changes.roomMoves.compensation ? `, ${amt(d.changes.roomMoves.compensation)}` : ""})`} />
                <Row label={t("· paid upgrades")} value={`${d.changes.roomMoves.paidUpgrades} · ${amt(d.changes.roomMoves.upgradeRevenue)}`} />
              </>}
              <Row label={t("Payment corrections")} value={String(d.changes.paymentCorrections)} />
              <Row label={t("Discounts given")} value={amt(d.changes.discounts)} />
            </>}
          </Section>
        )}

        <Section icon={UsersRound} title={t("Staff")} className="md:col-span-2 xl:col-span-1">
          {d.people?.length ? (
            <ul className="divide-y divide-border/60">
              {d.people.map((p) => (
                <li key={p.name} className="py-2 first:pt-0 last:pb-0">
                  <p className="flex items-baseline justify-between gap-2 text-[13px]"><span className="truncate font-medium">{p.name}</span><span className="shrink-0 font-semibold tabular-nums">{amt(p.payments)}</span></p>
                  <p className="mt-0.5 flex flex-wrap gap-x-3 text-[11px] text-muted-foreground">
                    <span className="inline-flex items-center gap-1"><Scale className="size-3" />{t("{in} in · {out} out", { in: p.checkIns, out: p.checkOuts })}</span>
                    <span className="inline-flex items-center gap-1"><FileText className="size-3" />{t.plural(p.bookings, "{n} booking", "{n} bookings")}</span>
                    {p.expenses > 0 && <span className="inline-flex items-center gap-1"><Hourglass className="size-3" />{t("expenses {amount}", { amount: amt(p.expenses) })}</span>}
                  </p>
                </li>
              ))}
            </ul>
          ) : <p className="text-sm text-muted-foreground">{t("Worked: {names}", { names: d.staff.actual.map((s) => s.name).join(", ") || t("none recorded") })}</p>}
        </Section>
      </div>
    </div>
  );
}
