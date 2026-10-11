import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { Clock } from "lucide-react";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import type { RoomReportData } from "@/server/services/room-report-data";
import { RoomReportPaper } from "@/components/staff/reports/room-report-paper";
import { ReportActions } from "@/app/staff/(app)/reports/report-actions";

export const metadata: Metadata = { title: "Daily Room Report", robots: { index: false, follow: false }, referrer: "no-referrer" };
export const dynamic = "force-dynamic";

/** The Boss's secure link to the Daily Room Report (WhatsApp): opens without signing in; random token, can be revoked. */
export default async function SharedRoomReportPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const [r, s] = await Promise.all([db.roomReport.findUnique({ where: { shareToken: token } }), getSettings()]);
  if (!r) notFound();
  const shell = (children: React.ReactNode) => (
    <main className="min-h-svh bg-[#ece6da] px-3 py-5 text-[#1d1a16] sm:px-6 sm:py-8 print:bg-white print:p-0">
      <style>{"@media print { @page { size: A4; margin: 8mm; } html, body { background: #fff !important; } }"}</style>
      <div className="mx-auto max-w-[1000px] space-y-4">{children}</div>
    </main>
  );
  if (r.revokedAt) {
    return shell(
      <section className="mx-auto mt-10 max-w-md rounded-3xl bg-white p-6 text-center shadow-sm">
        <span className="mx-auto grid size-14 place-items-center rounded-2xl bg-[#c9a24a]/15 text-[#8a6a25]"><Clock className="size-7" /></span>
        <h1 className="mt-3 font-display text-2xl font-semibold">This link is no longer active</h1>
        <p className="mt-1 text-sm text-[#6f665b]">The report is kept. Ask the hotel to send it again.</p>
      </section>,
    );
  }
  const d = r.data as unknown as RoomReportData;
  const hotel = {
    name: s.hotelName, tagline: s.tagline,
    address: [s.postalAddress, s.addressLine, s.city, s.country].filter(Boolean).join(", "),
    contact: [s.phone, s.email, s.website].filter(Boolean).join("  ·  "),
  };
  const number = `RR-${d.date.replaceAll("-", "")}`;
  return shell(
    <>
      <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-[#15110c] px-4 py-3 text-white print:hidden sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <Image src="/brand/logo-192.png" alt="" width={36} height={36} className="rounded-xl" />
          <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#f0cf86]">{s.hotelName} · Daily Room Report</p>
        </div>
        <ReportActions fileName={`${s.hotelName}-room-report-${d.date}`.replace(/[^\w]+/g, "-").toLowerCase()} share={`${s.hotelName} — Daily Room Report ${d.date}`} />
      </header>
      <RoomReportPaper d={d} hotel={hotel} number={number} version={r.version} />
    </>,
  );
}
