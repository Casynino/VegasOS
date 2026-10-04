import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCheck, CircleDashed, MessageCircle, Send } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import { formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { MAX_ATTEMPTS, sendingNow } from "@/server/services/report-delivery";
import { renderPersonPeriodText, type PersonPeriodData, type TeamPeriodData } from "@/server/services/staff-report";
import { PersonPeriodPaper, TeamPeriodPaper, type Hotel } from "@/components/staff/reports/staff-report-paper";
import { ReportActions } from "../../report-actions";
import { SendStaffReportButton } from "../buttons";

export const metadata: Metadata = { title: "Staff report" };
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
  const s = await getSettings();
  const hotel: Hotel = {
    name: s.hotelName, tagline: s.tagline,
    address: [s.postalAddress, s.addressLine, s.city, s.country].filter(Boolean).join(", "),
    contact: [s.phone, s.email, s.website].filter(Boolean).join("  ·  "),
  };
  const team = r.userId ? null : (r.data as unknown as TeamPeriodData);
  const person = r.userId ? (r.data as unknown as PersonPeriodData) : null;
  const what = r.kind === "WEEK" ? "Weekly report" : "Monthly report";
  const label = (team ?? person)!.label;
  const number = `${r.kind === "WEEK" ? "WR" : "MR"}-${r.fromDate.toISOString().slice(0, 10).replaceAll("-", "")}-${team ? "TEAM" : r.id.slice(-5).toUpperCase()}`;
  const fileName = `${s.hotelName}-${what}-${person ? person.person.name : "business-and-team"}-${label}`.replace(/[^\w]+/g, "-").toLowerCase();
  const plain = (t: string) => t.replace(/\*/g, "").replace(/^_(.*)_$/gm, "$1");
  const share = plain(manager ? r.summaryText : renderPersonPeriodText(person!, s.hotelName, null));

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
            <Link href="/staff/reports/staff" aria-label="Back to the reports" className="grid size-10 shrink-0 place-items-center rounded-xl border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><ArrowLeft className="size-4" /></Link>
            <div className="min-w-0 flex-1">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">{what}{team ? " · business & team" : ""}</p>
              <h1 className="text-xl font-semibold leading-tight tracking-tight">{person ? person.person.name : "The hotel & the team"}</h1>
              <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
                <span>{label} · made automatically {formatDateTime(r.generatedAt)}</span>
                {team && (
                  <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", status === "SENT" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : status === "FAILED" ? "bg-rose-500/15 text-rose-600 dark:text-rose-400" : status === "SENDING" ? "bg-sky-500/15 text-sky-600 dark:text-sky-400" : "bg-muted text-muted-foreground")}>
                    {status === "SENT" ? <CheckCheck className="size-3" /> : status === "FAILED" ? <AlertTriangle className="size-3" /> : <CircleDashed className={cn("size-3", status === "SENDING" && "animate-spin")} />}
                    {status === "SENT" ? `Sent to the Boss${sentNow[0]?.sentAt ? ` · ${formatDateTime(sentNow[0].sentAt)}` : ""}` : status === "FAILED" ? "Message failed" : status === "SENDING" ? "Sending…" : s.shiftReportEnabled ? "Not sent yet" : "Not sent — sending is off"}
                  </span>
                )}
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <ReportActions fileName={fileName} share={share} />
            {send && status !== "SENT" && status !== "SENDING" && <SendStaffReportButton reportId={r.id} label={status === "FAILED" ? "Retry send" : "Send to the Boss"} className="h-9 text-xs" />}
            {send && status === "SENT" && <SendStaffReportButton reportId={r.id} force label="Send again" className="h-9 text-xs" />}
          </div>
        </div>
      </section>

      {team ? (
        <TeamPeriodPaper d={team} hotel={hotel} number={number} preparedAt={formatDateTime(r.generatedAt)} personHref={(p) => `/staff/reports/staff/${p.reportId}`} />
      ) : (
        <PersonPeriodPaper d={person!} hotel={hotel} number={number} preparedAt={formatDateTime(r.generatedAt)} timezone={s.timezone}
          shiftHref={(shiftId, report) => (report ? `/staff/shifts/${shiftId}/report` : `/staff/shifts/${shiftId}`)} />
      )}

      {team && manager && (
        <div className="grid gap-4 print:hidden lg:grid-cols-[minmax(0,1fr)_340px]">
          <section className="rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><MessageCircle className="size-4 text-muted-foreground" />The message the Boss receives</h2>
            <div className="max-w-md rounded-2xl rounded-tl-sm bg-[#e7ffdb] p-4 text-[13px] leading-relaxed text-zinc-900 shadow-sm dark:bg-[#1f3a2c] dark:text-white">
              {r.summaryText.split("\n").map((line, i) => <p key={i} className={cn(line === "" && "h-3", "break-words")} dangerouslySetInnerHTML={{ __html: whatsapp(line) }} />)}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">The link opens this report without signing in. It is private (random, not guessable) and works until {formatDateTime(r.shareExpiresAt)}.</p>
          </section>
          <section className="rounded-3xl border border-border/70 bg-card p-4 sm:p-5">
            <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold"><Send className="size-4 text-muted-foreground" />Delivery</h2>
            {r.deliveries.length === 0 ? <p className="text-sm text-muted-foreground">{s.shiftReportEnabled ? "Not sent yet — it goes in the morning run, or send it now. Recipients are under Settings → Report recipients." : "Sending reports to the Boss is turned off in Settings."}</p> : (
              <ul className="space-y-2 text-sm">
                {r.deliveries.map((x) => (
                  <li key={x.id} className="rounded-2xl bg-muted/40 px-3 py-2.5">
                    <div className="flex items-center justify-between gap-2"><span className="truncate font-mono text-xs">{x.recipient}</span><span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", sendingNow(x) ? "bg-sky-500/15 text-sky-600" : x.status === "SENT" ? "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" : x.status === "FAILED" ? "bg-rose-500/15 text-rose-600 dark:text-rose-400" : "bg-muted text-muted-foreground")}>{sendingNow(x) ? "Sending…" : x.status === "SENT" ? "Sent" : x.status === "FAILED" ? "Failed" : "Waiting"}</span></div>
                    <p className="mt-0.5 text-[11px] text-muted-foreground">{x.channel === "WHATSAPP_CALLMEBOT" ? "WhatsApp (CallMeBot)" : x.channel.replace("_", " ").toLowerCase()} · {x.attempts} attempt{x.attempts === 1 ? "" : "s"}{x.sentAt && ` · ${formatDateTime(x.sentAt)}`}</p>
                    {x.lastError && <p className="mt-0.5 text-[11px] text-rose-600 dark:text-rose-400">{x.lastError}{x.attempts >= MAX_ATTEMPTS ? " · no more automatic tries" : ""}</p>}
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
