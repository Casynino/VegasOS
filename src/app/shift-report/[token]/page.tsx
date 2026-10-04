import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Clock, LogIn } from "lucide-react";
import { getSettings } from "@/server/settings";
import { formatDateTime } from "@/lib/format";
import { shiftReportByToken, type ShiftReportData } from "@/server/services/shift-report";
import { ShiftReportPaper } from "@/components/staff/reports/staff-report-paper";
import { ReportActions } from "@/app/staff/(app)/reports/report-actions";

export const metadata: Metadata = {
  title: "Shift report",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};
export const dynamic = "force-dynamic";

/**
 * The boss's link to one shift report (sent by WhatsApp when the shift ended): opens the full report without signing
 * in — print it or save the PDF. The link is random (not guessable) and expires; after that the report opens in the
 * staff app (signed in).
 */
export default async function SharedShiftReportPage({ params }: PageProps<"/shift-report/[token]">) {
  const { token } = await params;
  const [r, s] = await Promise.all([shiftReportByToken(token), getSettings()]);
  if (!r) notFound();
  const shell = (children: React.ReactNode) => (
    <main className="min-h-svh bg-[#ece6da] px-3 py-5 text-[#1d1a16] sm:px-6 sm:py-8 print:bg-white print:p-0">
      <style>{"@media print { @page { size: A4; margin: 8mm; } html, body { background: #fff !important; } }"}</style>
      <div className="mx-auto max-w-[1100px] space-y-4">{children}</div>
    </main>
  );
  if (r.expired) {
    return shell(
      <section className="mx-auto mt-10 max-w-md rounded-3xl bg-white p-6 text-center shadow-sm">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#c9a24a]/15 text-[#8a6a25]"><Clock className="size-7" /></span>
        <h1 className="mt-3 font-display text-2xl font-semibold">This link has expired</h1>
        <p className="mt-1 text-sm text-[#6f665b]">For privacy, report links work for a limited time. The report is kept — open it in the staff app.</p>
        <Link href={`/staff/shifts/${r.shiftId}/report`} className="mt-4 inline-flex h-10 items-center gap-2 rounded-xl bg-[#15110c] px-4 text-sm font-semibold text-white"><LogIn className="size-4" />Open in the staff app</Link>
      </section>,
    );
  }
  const d = r.data as unknown as ShiftReportData;
  const hotel = {
    name: s.hotelName, tagline: s.tagline,
    address: [s.postalAddress, s.addressLine, s.city, s.country].filter(Boolean).join(", "),
    contact: [s.phone, s.email, s.website].filter(Boolean).join("  ·  "),
  };
  const date = d.shift.businessDate.replaceAll("-", "");
  const when = new Date(`${d.shift.businessDate}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
  return shell(
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-[#15110c] px-4 py-3 text-white print:hidden sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Image src="/brand/logo-192.png" alt="" width={36} height={36} className="rounded-xl" />
          <div className="min-w-0 leading-tight">
            <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#f0cf86]">{s.hotelName} · Shift report</p>
            <p className="truncate text-sm font-semibold">{d.person.name} · {when}</p>
          </div>
        </div>
      </header>
      {/* Print or save the PDF (on the light page, under the header) */}
      <div className="flex justify-end print:hidden">
        <ReportActions fileName={`${s.hotelName}-shift-report-${d.person.name}-${d.shift.businessDate}`.replace(/[^\w]+/g, "-").toLowerCase()} share={`Shift report — ${d.person.name} · ${when}`} />
      </div>
      <ShiftReportPaper d={d} hotel={hotel} number={`SR-${date}-${r.shiftId.slice(-5).toUpperCase()}-v${r.version}`} timezone={s.timezone}
        preparedBy={r.automatic ? "System · automatic shift report" : r.generatedBy} preparedAt={`${formatDateTime(r.generatedAt)}${r.version > 1 ? ` · version ${r.version}` : ""}`} />
      <p className="text-center text-[11px] text-[#8c8173] print:hidden">Private link · works until {formatDateTime(r.shareExpiresAt)}</p>
    </>,
  );
}
