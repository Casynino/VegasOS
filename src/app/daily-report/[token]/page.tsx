import type { Metadata } from "next";
import Image from "next/image";
import { notFound } from "next/navigation";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import { dailyReportByToken, dailyReportTextIn, type DailyReportData } from "@/server/services/daily-report";
import { buildDailyDocument } from "@/server/services/daily-document";
import { ReportDocument } from "@/app/staff/(app)/reports/report-document";
import { ReportActions } from "@/app/staff/(app)/reports/report-actions";
import type { Report } from "@/lib/report-types";
import { getT, guestLocale } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  await guestLocale();
  return { title: (await getT())("Daily business report"), robots: { index: false, follow: false }, referrer: "no-referrer" };
}
export const dynamic = "force-dynamic";

/**
 * The Boss's link to one day's business report (sent by WhatsApp): opens the full report without signing in —
 * download the PDF, print it or pass it on. The link is random (not guessable); only someone who was sent it can open it.
 */
export default async function SharedDailyReportPage({ params }: { params: Promise<{ token: string }> }) {
  await guestLocale();
  const { token } = await params;
  const [r, s, t] = await Promise.all([dailyReportByToken(token), getSettings(), getT()]);
  if (!r) notFound();
  const date = r.businessDate.toISOString().slice(0, 10);
  const d = r.data as unknown as DailyReportData;
  // A report made before the full document existed is shown in the same document (from its saved figures).
  let doc = r.document as unknown as Report | null;
  if (!doc && d?.money) {
    const methods = d.money.byMethod?.reduce((sum, m) => sum + m.amount, 0) ?? 0;
    doc = await buildDailyDocument(date, { ...d, money: { ...d.money, collected: d.money.collected || methods } }).catch(() => null);
  }
  const [text, rooms] = await Promise.all([
    t.locale === "en" ? r.summaryText : dailyReportTextIn(r, t.locale).catch(() => r.summaryText),
    db.roomReport.findUnique({ where: { businessDate: r.businessDate }, select: { shareToken: true, revokedAt: true } }),
  ]);
  const when = (x: Date) => t.dateTime(x, s.timezone);
  const weekday = new Date(`${date}T00:00:00Z`).toLocaleDateString(t.intl, { weekday: "long", timeZone: "UTC" });
  const hotel = {
    name: s.hotelName, tagline: s.tagline,
    address: [s.postalAddress, s.addressLine, s.city, s.country].filter(Boolean).join(", "),
    contact: [s.phone, s.email, s.website].filter(Boolean).join("  ·  "),
  };
  return (
    <main className="min-h-svh bg-[#ece6da] px-3 py-5 text-[#1d1a16] sm:px-6 sm:py-8 print:bg-white print:p-0">
      <style>{"@media print { @page { size: A4; margin: 8mm; } html, body { background: #fff !important; } }"}</style>
      <div className="mx-auto max-w-[1100px] space-y-4">
        <header className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-[#15110c] px-4 py-3 text-white print:hidden sm:px-5">
          <div className="flex min-w-0 items-center gap-3">
            <Image src="/brand/logo-192.png" alt="" width={36} height={36} className="rounded-xl" />
            <div className="min-w-0 leading-tight">
              <p className="text-[10px] font-semibold uppercase tracking-[0.22em] text-[#f0cf86]">{s.hotelName} · {t("Daily business report")}</p>
              <p className="truncate text-sm font-semibold">{weekday} · {t.shortDate(date)}</p>
            </div>
          </div>
          {doc && <ReportActions download fileName={`${s.hotelName.replace(/[^\w]+/g, "-")}-daily-report-${date}`.toLowerCase()} share={text.replace(/\*/g, "")} />}
        </header>
        {rooms && !rooms.revokedAt && (
          <p className="px-1 text-xs print:hidden">
            <a href={`/room-report/${rooms.shareToken}`} className="font-semibold text-[#8a6a25] underline underline-offset-2">{t("Daily Room Report for this day")} →</a>
          </p>
        )}
        {doc ? (
          <ReportDocument report={doc} hotel={hotel} number={`DR-${date.replaceAll("-", "")}-v${r.version}`}
            preparedBy={r.automatic ? t("System · automatic daily report") : r.generatedBy} preparedAt={`${when(r.generatedAt)}${r.version > 1 ? ` · ${t("version {n}", { n: r.version })}` : ""}`} />
        ) : (
          // Too old to lay out as a document: the report exactly as the Boss's message said it.
          <article className="rounded-3xl bg-white p-5 text-sm leading-relaxed shadow-sm sm:p-7">
            {text.replace(/\*/g, "").split("\n").map((line, i) => <p key={i} className={line === "" ? "h-3" : "break-words"}>{line}</p>)}
          </article>
        )}
        <p className="text-center text-[11px] text-[#8c8173] print:hidden">{t("Private link — anyone who has it can open this report without signing in.")}</p>
      </div>
    </main>
  );
}
