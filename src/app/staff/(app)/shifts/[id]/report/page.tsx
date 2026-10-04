import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AlertTriangle, ArrowLeft, CheckCheck, CircleDashed, Clock, History, MessageCircle, Send } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import { formatDateTime, formatShortDate } from "@/lib/format";
import { cn } from "@/lib/utils";
import { renderShiftReportText, shiftDuration, type ShiftReportData } from "@/server/services/shift-report";
import { MAX_ATTEMPTS, sendingNow } from "@/server/services/report-delivery";
import { ShiftReportPaper } from "@/components/staff/reports/staff-report-paper";
import { ReportActions } from "../../../reports/report-actions";
import { MakeShiftReportButton, RegenerateShiftReportButton, SendShiftReportButton } from "./report-buttons";

export const metadata: Metadata = { title: "Shift report" };
export const dynamic = "force-dynamic";

const DELIVERY: Record<string, { label: string; cls: string }> = {
  SENDING: { label: "Sending…", cls: "bg-sky-500/15 text-sky-600 dark:text-sky-400" },
  OFF: { label: "Not sent", cls: "bg-muted text-muted-foreground" },
  PENDING: { label: "Waiting", cls: "bg-muted text-muted-foreground" },
  SENT: { label: "Sent", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  DELIVERED: { label: "Delivered", cls: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" },
  FAILED: { label: "Failed", cls: "bg-rose-500/15 text-rose-600 dark:text-rose-400" },
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
  const s = await getSettings();
  const r = shift.report;
  const clock = (d: Date) => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: s.timezone }).format(d);
  const date = shift.businessDate.toISOString().slice(0, 10);
  const back = `/staff/shifts/${shift.id}`;

  const header = (extra?: React.ReactNode, chips?: React.ReactNode) => (
    <section className="relative overflow-hidden rounded-3xl border border-border/70 bg-card print:hidden">
      <div aria-hidden className="absolute inset-x-0 top-0 h-px bg-linear-to-r from-transparent via-[oklch(0.78_0.12_80)]/70 to-transparent" />
      <div className="relative flex flex-col gap-3 px-4 py-4 sm:px-5 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex min-w-0 items-start gap-3">
          <Link href={back} aria-label="Back to the shift" className="grid size-10 shrink-0 place-items-center rounded-xl border border-border/70 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"><ArrowLeft className="size-4" /></Link>
          <div className="min-w-0 flex-1">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[oklch(0.62_0.11_78)] dark:text-[oklch(0.8_0.1_82)]">Shift report · {shift.department === "RESTAURANT" ? "Restaurant" : "Reception"}</p>
            <h1 className="text-xl font-semibold leading-tight tracking-tight">{shift.user.fullName}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
              <span>{shift.user.role.name} · {formatShortDate(date)} · {clock(shift.startedAt)} → {shift.endedAt ? `${shift.endedAt.getTime() - shift.startedAt.getTime() > 20 * 3_600_000 ? `${formatShortDate(shift.endedAt.toISOString().slice(0, 10))} ` : ""}${clock(shift.endedAt)}` : "now"}{shift.endedAt ? ` · ${shiftDuration(Math.round((shift.endedAt.getTime() - shift.startedAt.getTime()) / 60000))}` : ""}</span>
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
          <p className="mt-3 text-base font-semibold">{shift.endedAt ? "The report is being made" : "The shift is still running"}</p>
          <p className="mt-1 max-w-md text-sm text-muted-foreground">{shift.endedAt ? "It is made automatically right after the shift ends. If it does not appear in a moment, make it now — it is still made only once." : "The report is made automatically when the shift ends — from what was done in it."}</p>
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
  const plain = (t: string) => t.replace(/\*/g, "").replace(/^_(.*)_$/gm, "$1");
  const shareText = plain(manager ? r.summaryText : renderShiftReportText(r.data as unknown as ShiftReportData, s.hotelName, s.timezone, null));
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
          {send && (status === "PENDING" || status === "FAILED" || status === "OFF") && <SendShiftReportButton reportId={r.id} label={status === "FAILED" ? "Retry send" : "Send to the Boss"} className="h-9 text-xs" />}
          {send && status === "SENT" && <SendShiftReportButton reportId={r.id} force label="Send again" className="h-9 text-xs" />}
          {regenerate && <RegenerateShiftReportButton shiftId={shift.id} className="h-9 text-xs" />}
        </>,
        <>
          <span>{r.automatic ? `Made automatically at ${clock(r.generatedAt)}` : `Made by ${r.generatedBy} at ${clock(r.generatedAt)}`}</span>
          {r.version > 1 && <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-semibold">Version {r.version}</span>}
          {manager && (
            <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", DELIVERY[status].cls)}>
              {status === "SENT" ? <CheckCheck className="size-3" /> : status === "FAILED" ? <AlertTriangle className="size-3" /> : <CircleDashed className={cn("size-3", status === "SENDING" && "animate-spin")} />}
              {status === "SENT" ? `Sent to the Boss${sentNow[0]?.sentAt ? ` · ${formatDateTime(sentNow[0].sentAt)}` : ""}` : status === "FAILED" ? "Message failed" : status === "SENDING" ? "Sending…" : status === "OFF" || !s.shiftReportEnabled ? "Not sent — sending was off" : "Not sent yet"}
            </span>
          )}
        </>,
      )}

      {manager && failed.length > 0 && status !== "SENT" && status !== "SENDING" && (
        <section className="flex flex-wrap items-center gap-3 rounded-3xl border border-rose-500/30 bg-rose-500/[0.07] px-4 py-3 print:hidden">
          <AlertTriangle className="size-5 shrink-0 text-rose-500" />
          <div className="min-w-0 flex-1 text-sm">
            <p className="font-semibold text-rose-700 dark:text-rose-300">The report was made, but the message to the Boss failed</p>
            <p className="truncate text-xs text-muted-foreground">{failed[0].lastError ?? "No answer from the provider"} · {failed[0].attempts} attempt{failed[0].attempts === 1 ? "" : "s"} · {failed[0].attempts < MAX_ATTEMPTS ? "it is tried again automatically" : "no more automatic tries — send it again by hand"}</p>
          </div>
          {send && <SendShiftReportButton reportId={r.id} label="Retry send" className="h-9 text-xs" />}
        </section>
      )}

      <ShiftReportPaper d={data} hotel={hotel} number={number} timezone={s.timezone}
        preparedBy={r.automatic ? "System · automatic shift report" : r.generatedBy} preparedAt={`${formatDateTime(r.generatedAt)}${r.version > 1 ? ` · version ${r.version}` : ""}`} />

      {manager && (
        <div className="grid gap-4 print:hidden lg:grid-cols-[minmax(0,1fr)_340px]">
          <Panel icon={MessageCircle} title="The message the Boss receives">
            <div className="max-w-md rounded-2xl rounded-tl-sm bg-[#e7ffdb] p-4 text-[13px] leading-relaxed text-zinc-900 shadow-sm dark:bg-[#1f3a2c] dark:text-white">
              {r.summaryText.split("\n").map((line, i) => (
                <p key={i} className={cn(line === "" && "h-3", "break-words")} dangerouslySetInnerHTML={{ __html: whatsapp(line) }} />
              ))}
            </div>
            <p className="mt-2 text-[11px] text-muted-foreground">The link opens this report without signing in. It is private (random, not guessable) and works until {formatDateTime(r.shareExpiresAt)}.</p>
          </Panel>
          <div className="space-y-4">
            <Panel icon={Send} title="Delivery">
              {r.deliveries.length === 0 ? <p className="text-sm text-muted-foreground">{s.shiftReportEnabled ? "Not sent yet. Add who receives it under Settings → Report recipients." : "Sending shift reports is turned off in Settings."}</p> : (
                <ul className="space-y-2 text-sm">
                  {r.deliveries.map((x) => {
                    const look = sendingNow(x) ? DELIVERY.SENDING : DELIVERY[x.status] ?? DELIVERY.PENDING;
                    return (
                      <li key={x.id} className="rounded-2xl bg-muted/40 px-3 py-2.5">
                        <div className="flex items-center justify-between gap-2"><span className="truncate font-mono text-xs">{x.recipient}</span><span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", look.cls)}>{look.label}</span></div>
                        <p className="mt-0.5 text-[11px] text-muted-foreground">{x.channel === "WHATSAPP_CALLMEBOT" ? "WhatsApp (CallMeBot)" : x.channel.replace("_", " ").toLowerCase()} · {x.attempts} attempt{x.attempts === 1 ? "" : "s"}{x.sentAt && ` · ${formatDateTime(x.sentAt)}`}</p>
                        {x.lastError && <p className="mt-0.5 text-[11px] text-rose-600 dark:text-rose-400">{x.lastError}</p>}
                      </li>
                    );
                  })}
                </ul>
              )}
            </Panel>
            <Panel icon={History} title="Versions">
              <ul className="space-y-2 text-sm">
                <li className="rounded-2xl bg-muted/40 px-3 py-2.5">
                  <p className="flex items-center justify-between gap-2"><span className="font-semibold">Version {r.version} · current</span><span className="text-[11px] text-muted-foreground">{formatDateTime(r.generatedAt)}</span></p>
                  <p className="text-[11px] text-muted-foreground">{r.automatic ? "Automatic (system)" : r.generatedBy}{r.reason ? ` — ${r.reason}` : ""}</p>
                </li>
                {r.versions.map((v) => (
                  <li key={v.id} className="rounded-2xl border border-dashed border-border px-3 py-2.5">
                    <p className="flex items-center justify-between gap-2"><span className="font-medium">Version {v.version}</span><span className="text-[11px] text-muted-foreground">{formatDateTime(v.generatedAt)}</span></p>
                    <p className="text-[11px] text-muted-foreground">{v.automatic ? "Automatic (system)" : v.generatedBy} · replaced by {v.replacedBy} {formatDateTime(v.replacedAt)}</p>
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
