import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCheck, CircleDashed, MessageCircle, Send } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import { cn } from "@/lib/utils";
import { MAX_ATTEMPTS, recipientLang, sendingNow, type Recipient } from "@/server/services/report-delivery";
import { periodLabelOf, renderPersonPeriodText, staffReportTextIn, type PersonPeriodData, type TeamPeriodData } from "@/server/services/staff-report";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { LOCALE_META, type Locale } from "@/i18n/config";
import { PersonPeriodPaper, TeamPeriodPaper, type Hotel } from "@/components/staff/reports/staff-report-paper";
import { ReportActions } from "../../report-actions";
import { SendStaffReportButton } from "../buttons";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Staff report") };
}
export const dynamic = "force-dynamic";

/**
 * ONE WEEKLY OR MONTHLY REPORT — a person's (they open their own; managers anyone's) or the team's with the business
 * (managers, the MD and the owner): print, PDF, share, the message the boss received and its delivery.
 */
export default async function StaffReportPage({ params }: PageProps<"/staff/reports/staff/[id]">) {
  const user = await requirePagePermission("shifts.view", "restaurant.shift", "shifts.manage", "reports.view");
  const { id } = await params;
  const r = await db.staffReport.findUnique({ where: { id }, include: { deliveries: { orderBy: { createdAt: "asc" } } } });
  if (!r) notFound();
  const manager = can(user, "shifts.manage") || can(user, "reports.view");
  if (!manager && r.userId !== user.id) redirect("/staff/forbidden");
  const [s, t] = await Promise.all([getSettings(), getT()]);
  const when = (x: Date) => t.dateTime(x, s.timezone);
  const hotel: Hotel = {
    name: s.hotelName, tagline: s.tagline,
    address: [s.postalAddress, s.addressLine, s.city, s.country].filter(Boolean).join(", "),
    contact: [s.phone, s.email, s.website].filter(Boolean).join("  ·  "),
  };
  const team = r.userId ? null : (r.data as unknown as TeamPeriodData);
  const person = r.userId ? (r.data as unknown as PersonPeriodData) : null;
  const what = r.kind === "WEEK" ? msg("Weekly report") : msg("Monthly report");
  const label = (team ?? person)!.label;
  const shownLabel = periodLabelOf((team ?? person)!, t);
  const number = `${r.kind === "WEEK" ? "WR" : "MR"}-${r.fromDate.toISOString().slice(0, 10).replaceAll("-", "")}-${team ? "TEAM" : r.id.slice(-5).toUpperCase()}`;
  const fileName = `${s.hotelName}-${what}-${person ? person.person.name : "business-and-team"}-${label}`.replace(/[^\w]+/g, "-").toLowerCase();
  const plain = (t: string) => t.replace(/\*/g, "").replace(/^_(.*)_$/gm, "$1");
  // The message in each recipient's language (the same figures); the reader shares their own.
  const recipients = (s.reportRecipients as unknown as Recipient[]) ?? [];
  const langOf = new Map(recipients.map((x) => [x.phone, recipientLang(x)]));
  const langs = [...new Set<Locale>(["en", ...recipients.map(recipientLang)])];
  const texts = new Map<Locale, string>(team && manager ? await Promise.all(langs.map(async (l) => [l, l === "en" ? r.summaryText : await staffReportTextIn(r, l).catch(() => r.summaryText)] as const)) : []);
  const share = plain(manager
    ? t.locale === "en" ? r.summaryText : await staffReportTextIn(r, t.locale).catch(() => r.summaryText)
    : renderPersonPeriodText(person!, s.hotelName, null, t));

  // Delivery (team reports go to the boss).
  const sentNow = r.deliveries.filter((x) => x.status === "SENT" && x.sentAt && x.sentAt >= r.generatedAt);
  const failed = r.deliveries.filter((x) => x.status === "FAILED");
  const sending = r.deliveries.some((x) => sendingNow(x));
  const status = sending ? "SENDING" : sentNow.length ? "SENT" : failed.length ? "FAILED" : "PENDING";
  const send = !!team && (can(user, "shifts.manage") || can(user, "reports.daily.manage"));

  return (
    <div className="w-full space-y-4">
      <style>{"@media print { @page { size: A4; margin: 8mm; } html, body, #staff-root { background: #fff !important; } }"}</style>
      <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card print:hidden">
        <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[oklch(0.78_0.12_80)]/70 to-transparent" />
        <div className="relative flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <Link href="/staff/reports/staff" aria-label={t("Back to the reports")} className="grid size-10 shrink-0 place-items-center rounded-xl border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><ArrowLeft className="size-4" /></Link>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">{t(what)}{team ? ` · ${t("business & team")}` : ""}</p>
              <h1 className="text-xl font-semibold leading-tight tracking-tight">{person ? person.person.name : t("The hotel & the team")}</h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>{shownLabel} · {t("made automatically {time}", { time: when(r.generatedAt) })}</span>
                {team && (
                  <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", status === "SENT" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : status === "FAILED" ? "bg-rose-500/15 text-rose-600 dark:text-rose-400" : status === "SENDING" ? "bg-sky-500/15 text-sky-600 dark:text-sky-400" : "bg-muted text-muted-foreground")}>
                    {status === "SENT" ? <CheckCheck className="size-3" /> : status === "FAILED" ? <AlertTriangle className="size-3" /> : <CircleDashed className={cn("size-3", status === "SENDING" && "animate-spin")} />}
                    {status === "SENT" ? `${t("Sent to the Boss")}${sentNow[0]?.sentAt ? ` · ${when(sentNow[0].sentAt)}` : ""}` : status === "FAILED" ? t("Message failed") : status === "SENDING" ? t("Sending…") : s.shiftReportEnabled ? t("Not sent yet") : t("Not sent — sending is off")}
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ReportActions fileName={fileName} share={share} />
            {send && status !== "SENT" && status !== "SENDING" && <SendStaffReportButton reportId={r.id} label={status === "FAILED" ? t("Retry send") : t("Send to the Boss")} className="h-9 text-xs" />}
            {send && status === "SENT" && <SendStaffReportButton reportId={r.id} force label={t("Send again")} className="h-9 text-xs" />}
          </div>
        </div>
      </section>

      {team ? (
        <TeamPeriodPaper d={{ ...team, label: shownLabel }} hotel={hotel} number={number} preparedAt={when(r.generatedAt)} personHref={(p) => `/staff/reports/staff/${p.reportId}`} />
      ) : (
        <PersonPeriodPaper d={{ ...person!, label: shownLabel }} hotel={hotel} number={number} preparedAt={when(r.generatedAt)} timezone={s.timezone}
          shiftHref={(shiftId, report) => (report ? `/staff/shifts/${shiftId}/report` : `/staff/shifts/${shiftId}`)} />
      )}

      {team && manager && (
        <div className="grid gap-4 print:hidden lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><MessageCircle className="size-4 text-muted-foreground" />{t("The message the Boss receives")}</h2>
            <div className="space-y-3">
              {[...texts.entries()].map(([l, text]) => (
                <div key={l}>
                  {texts.size > 1 && <p className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{LOCALE_META[l].label}</p>}
                  <div className="max-w-md rounded-2xl rounded-tl-sm bg-[#e7ffdb] p-4 text-[13px] leading-relaxed text-zinc-900 shadow-sm dark:bg-[#1f3a2c] dark:text-white">
                    {text.split("\n").map((line, i) => <p key={i} className={cn(line === "" && "h-3", "break-words")} dangerouslySetInnerHTML={{ __html: whatsapp(line) }} />)}
                  </div>
                </div>
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">{t("The link opens this report without signing in. It is private (random, not guessable) and works until {time}.", { time: when(r.shareExpiresAt) })}</p>
          </section>
          <section className="rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Send className="size-4 text-muted-foreground" />{t("Delivery")}</h2>
            {r.deliveries.length === 0 ? <p className="text-sm text-muted-foreground">{s.shiftReportEnabled ? t("Not sent yet — it goes in the morning run, or send it now. Recipients are under Settings → Report recipients.") : t("Sending reports to the Boss is turned off in Settings.")}</p> : (
              <ul className="space-y-2 text-sm">
                {r.deliveries.map((x) => (
                  <li key={x.id} className="rounded-2xl bg-muted/40 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2"><span className="truncate font-mono text-xs">{x.recipient}</span><span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", sendingNow(x) ? "bg-sky-500/15 text-sky-600" : x.status === "SENT" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : x.status === "FAILED" ? "bg-rose-500/15 text-rose-600 dark:text-rose-400" : "bg-muted text-muted-foreground")}>{sendingNow(x) ? t("Sending…") : x.status === "SENT" ? t("Sent") : x.status === "FAILED" ? t("Failed") : t("Waiting")}</span></div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{x.channel === "WHATSAPP_CALLMEBOT" ? "WhatsApp (CallMeBot)" : x.channel.replace("_", " ").toLowerCase()} · {LOCALE_META[langOf.get(x.recipient) ?? "en"].label} · {t.plural(x.attempts, "{n} attempt", "{n} attempts")}{x.sentAt && ` · ${when(x.sentAt)}`}</p>
                    {x.lastError && <p className="mt-0.5 text-[11px] text-rose-600 dark:text-rose-400">{x.lastError}{x.attempts >= MAX_ATTEMPTS ? ` · ${t("no more automatic tries")}` : ""}</p>}
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

/** Escape HTML, then show WhatsApp *bold* and _italic_. */
function whatsapp(s: string) {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\*([^*]+)\*/g, "<strong>$1</strong>").replace(/(^|\s)_([^_]+)_(?=\s|$)/g, "$1<em>$2</em>");
}
