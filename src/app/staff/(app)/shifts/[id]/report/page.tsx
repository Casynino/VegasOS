import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCheck, CircleDashed, Clock, History, MessageCircle, Send } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import { cn } from "@/lib/utils";
import { renderShiftReportText, shiftDuration, shiftReportTextIn, type ShiftReportData } from "@/server/services/shift-report";
import { MAX_ATTEMPTS, recipientLang, sendingNow, type Recipient } from "@/server/services/report-delivery";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { LOCALE_META, type Locale } from "@/i18n/config";
import { ShiftReportPaper } from "@/components/staff/reports/staff-report-paper";
import { ReportActions } from "../../../reports/report-actions";
import { MakeShiftReportButton, RegenerateShiftReportButton, SendShiftReportButton } from "./report-buttons";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Shift report") };
}
export const dynamic = "force-dynamic";

const DELIVERY: Record<string, { label: string; cls: string }> = {
  SENDING: { label: msg("Sending…"), cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  OFF: { label: msg("Not sent"), cls: "bg-muted text-muted-foreground" },
  PENDING: { label: msg("Waiting"), cls: "bg-muted text-muted-foreground" },
  SENT: { label: msg("Sent"), cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  DELIVERED: { label: msg("Delivered"), cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  FAILED: { label: msg("Failed"), cls: "bg-rose-500/15 text-rose-600 dark:text-rose-400" },
};

/**
 * ONE SHIFT'S REPORT — made automatically when the shift ended, from what the person did in it: the same document as
 * the daily report (print, PDF, share), the message the boss received and its delivery, and earlier versions. The person
 * opens their own; managers, the MD and the owner open anyone's.
 */
export default async function ShiftReportPage({ params }: PageProps<"/staff/shifts/[id]/report">) {
  const user = await requirePagePermission("shifts.view", "restaurant.shift", "shifts.manage", "reports.view");
  const { id } = await params;
  const shift = await db.actualShift.findUnique({
    where: { id },
    include: {
      user: { select: { id: true, fullName: true, role: { select: { name: true } } } },
      report: { include: { deliveries: { orderBy: { createdAt: "asc" } }, versions: { orderBy: { version: "desc" } } } },
    },
  });
  if (!shift) notFound();
  const manager = can(user, "shifts.manage") || can(user, "reports.view");
  if (!manager && shift.userId !== user.id) redirect("/staff/forbidden");
  const [s, t] = await Promise.all([getSettings(), getT()]);
  const r = shift.report;
  const clock = (d: Date) => t.time(d, s.timezone);
  const when = (d: Date) => t.dateTime(d, s.timezone);
  const date = shift.businessDate.toISOString().slice(0, 10);
  const back = `/staff/shifts/${shift.id}`;

  const header = (extra?: React.ReactNode, chips?: React.ReactNode) => (
    <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card print:hidden">
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[oklch(0.78_0.12_80)]/70 to-transparent" />
      <div className="relative flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Link href={back} aria-label={t("Back to the shift")} className="grid size-10 shrink-0 place-items-center rounded-xl border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><ArrowLeft className="size-4" /></Link>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">{t("Shift report")} · {shift.department === "RESTAURANT" ? t("Restaurant") : t("Reception")}</p>
            <h1 className="text-xl font-semibold leading-tight tracking-tight">{shift.user.fullName}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{t(shift.user.role.name)} · {t.shortDate(date)} · {clock(shift.startedAt)} → {shift.endedAt ? `${shift.endedAt.getTime() - shift.startedAt.getTime() > 20 * 3_600_000 ? `${t.shortDate(shift.endedAt.toISOString().slice(0, 10))} ` : ""}${clock(shift.endedAt)}` : t("now")}{shift.endedAt ? ` · ${shiftDuration(Math.round((shift.endedAt.getTime() - shift.startedAt.getTime()) / 60000))}` : ""}</span>
              {chips}
            </p>
          </div>
        </div>
        {extra && <div className="flex flex-wrap items-center gap-2">{extra}</div>}
      </div>
    </section>
  );

  if (!shift.endedAt || !r) {
    return (
      <div className="w-full space-y-4">
        {header()}
        <section className="grid place-items-center rounded-3xl border border-dashed border-border/80 bg-card/40 px-6 py-14 text-center">
          <span className="grid size-14 place-items-center rounded-2xl bg-[oklch(0.75_0.12_80)]/15 text-[oklch(0.62_0.11_78)]"><Clock className="size-7" /></span>
          <p className="mt-3 text-base font-semibold">{shift.endedAt ? t("The report is being made") : t("The shift is still running")}</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{shift.endedAt ? t("It is made automatically right after the shift ends. If it does not appear in a moment, make it now — it is still made only once.") : t("The report is made automatically when the shift ends — from what was done in it.")}</p>
          {shift.endedAt && <MakeShiftReportButton shiftId={shift.id} className="mt-4" />}
        </section>
      </div>
    );
  }

  const data = r.data as unknown as ShiftReportData;
  const sentNow = r.deliveries.filter((x) => x.status === "SENT" && x.sentAt && x.sentAt >= r.generatedAt);
  const failed = r.deliveries.filter((x) => x.status === "FAILED");
  const sending = r.deliveries.some((x) => sendingNow(x));
  const status = sending ? "SENDING" : sentNow.length ? "SENT" : failed.length ? "FAILED" : r.sendSkipped && !r.deliveries.length ? "OFF" : "PENDING";
  // The boss's link is for the boss (and managers): staff share their report without it.
  const plain = (x: string) => x.replace(/\*/g, "").replace(/^_(.*)_$/gm, "$1");
  // The message in each recipient's language (the same figures); the reader shares it in their own.
  const recipients = (s.reportRecipients as unknown as Recipient[]) ?? [];
  const langOf = new Map(recipients.map((x) => [x.phone, recipientLang(x)]));
  const langs = [...new Set<Locale>(["en", ...recipients.map(recipientLang)])];
  const texts = new Map<Locale, string>(manager ? await Promise.all(langs.map(async (l) => [l, l === "en" ? r.summaryText : await shiftReportTextIn(data, r.shareToken, l).catch(() => r.summaryText)] as const)) : []);
  const shareText = plain(manager
    ? t.locale === "en" ? r.summaryText : await shiftReportTextIn(data, r.shareToken, t.locale).catch(() => r.summaryText)
    : renderShiftReportText(data, s.hotelName, s.timezone, null, t));
  const send = can(user, "shifts.manage") || can(user, "reports.daily.manage");
  const regenerate = can(user, "dashboard.admin") || can(user, "dashboard.owner");
  const number = `SR-${date.replaceAll("-", "")}-${shift.id.slice(-5).toUpperCase()}-v${r.version}`;
  const hotel = {
    name: s.hotelName, tagline: s.tagline,
    address: [s.postalAddress, s.addressLine, s.city, s.country].filter(Boolean).join(", "),
    contact: [s.phone, s.email, s.website].filter(Boolean).join("  ·  "),
  };
  const fileName = `${s.hotelName}-shift-report-${data.person.name}-${date}`.replace(/[^\w]+/g, "-").toLowerCase();

  return (
    <div className="w-full space-y-4">
      <style>{"@media print { @page { size: A4; margin: 8mm; } html, body, #staff-root { background: #fff !important; } }"}</style>
      {header(
        <>
          <ReportActions fileName={fileName} share={shareText} />
          {send && (status === "PENDING" || status === "FAILED" || status === "OFF") && <SendShiftReportButton reportId={r.id} label={status === "FAILED" ? t("Retry send") : t("Send to the Boss")} className="h-9 text-xs" />}
          {send && status === "SENT" && <SendShiftReportButton reportId={r.id} force label={t("Send again")} className="h-9 text-xs" />}
          {regenerate && <RegenerateShiftReportButton shiftId={shift.id} className="h-9 text-xs" />}
        </>,
        <>
          <span>{r.automatic ? t("Made automatically at {time}", { time: clock(r.generatedAt) }) : t("Made by {name} at {time}", { name: r.generatedBy, time: clock(r.generatedAt) })}</span>
          {r.version > 1 && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">{t("Version {n}", { n: r.version })}</span>}
          {manager && (
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", DELIVERY[status].cls)}>
              {status === "SENT" ? <CheckCheck className="size-3" /> : status === "FAILED" ? <AlertTriangle className="size-3" /> : <CircleDashed className={cn("size-3", status === "SENDING" && "animate-spin")} />}
              {status === "SENT" ? `${t("Sent to the Boss")}${sentNow[0]?.sentAt ? ` · ${when(sentNow[0].sentAt)}` : ""}` : status === "FAILED" ? t("Message failed") : status === "SENDING" ? t("Sending…") : status === "OFF" || !s.shiftReportEnabled ? t("Not sent — sending was off") : t("Not sent yet")}
            </span>
          )}
        </>,
      )}

      {manager && failed.length > 0 && status !== "SENT" && status !== "SENDING" && (
        <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-rose-500/30 bg-rose-500/[0.07] px-4 py-3 print:hidden">
          <AlertTriangle className="size-5 shrink-0 text-rose-500" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-rose-700 dark:text-rose-300">{t("The report was made, but the message to the Boss failed")}</p>
            <p className="truncate text-xs text-muted-foreground">{failed[0].lastError ?? t("No answer from the provider")} · {t.plural(failed[0].attempts, "{n} attempt", "{n} attempts")} · {failed[0].attempts < MAX_ATTEMPTS ? t("it is tried again automatically") : t("no more automatic tries — send it again by hand")}</p>
          </div>
          {send && <SendShiftReportButton reportId={r.id} label={t("Retry send")} className="h-9 text-xs" />}
        </section>
      )}

      <ShiftReportPaper d={data} hotel={hotel} number={number} timezone={s.timezone}
        preparedBy={r.automatic ? t("System · automatic shift report") : r.generatedBy} preparedAt={`${when(r.generatedAt)}${r.version > 1 ? ` · ${t("version {n}", { n: r.version })}` : ""}`} />

      {manager && (
        <div className="grid gap-4 print:hidden lg:grid-cols-[minmax(0,1fr)_340px]">
          <Panel icon={MessageCircle} title={t("The message the Boss receives")}>
            <div className="space-y-3">
              {[...texts.entries()].map(([l, text]) => (
                <div key={l}>
                  {texts.size > 1 && <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{LOCALE_META[l].label}</p>}
                  <div className="max-w-md rounded-2xl rounded-tl-sm bg-[#e7ffdb] p-4 text-[13px] leading-relaxed text-zinc-900 shadow-sm dark:bg-[#1f3a2c] dark:text-white">
                    {text.split("\n").map((line, i) => (
                      <p key={i} className={cn(line === "" && "h-3", "break-words")} dangerouslySetInnerHTML={{ __html: whatsapp(line) }} />
                    ))}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">{t("The link opens this report without signing in. It is private (random, not guessable) and works until {time}.", { time: when(r.shareExpiresAt) })}</p>
          </Panel>
          <div className="space-y-4">
            <Panel icon={Send} title={t("Delivery")}>
              {r.deliveries.length === 0 ? <p className="text-sm text-muted-foreground">{s.shiftReportEnabled ? t("Not sent yet. Add who receives it under Settings → Report recipients.") : t("Sending shift reports is turned off in Settings.")}</p> : (
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
            </Panel>
            <Panel icon={History} title={t("Versions")}>
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
            </Panel>
          </div>
        </div>
      )}
    </div>
  );
}

/** Escape HTML, then show WhatsApp *bold* and _italic_. */
function whatsapp(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\*([^*]+)\*/g, "<strong>$1</strong>").replace(/(^|\s)_([^_]+)_(?=\s|$)/g, "$1<em>$2</em>");
}

function Panel({ icon: Icon, title, children }: { icon: typeof Send; title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Icon className="size-4 text-muted-foreground" />{title}</h2>
      {children}
    </section>
  );
}
