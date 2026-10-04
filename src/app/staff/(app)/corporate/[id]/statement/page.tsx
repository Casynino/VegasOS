import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday, getSettings } from "@/server/settings";
import { companyStatement } from "@/server/services/company-billing";
import { fromDbDate } from "@/lib/time/business-date";
import { formatBusinessDate, formatNumber } from "@/lib/format";
import { ReportActions } from "@/app/staff/(app)/reports/report-actions";
import { buttonVariants } from "@/components/ui/button";
import { PeriodPicker, periodLabel, readPeriod } from "@/components/staff/finance/finance-nav";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Account statement" };

/** Account statement: opening balance, invoices (+), payments (−), closing balance — printable for the company. */
export default async function StatementPage({ params, searchParams }: PageProps<"/staff/corporate/[id]/statement">) {
  await requirePagePermission("corporate.view");
  const { id } = await params;
  const sp = await searchParams;
  const today = await businessToday();
  const p = readPeriod(sp, today, "year");
  const [c, s, st, open] = await Promise.all([
    db.corporateCustomer.findUnique({ where: { id } }),
    getSettings(),
    companyStatement(id, p.from, p.to),
    db.invoice.findMany({ where: { corporateCustomerId: id, reservationId: null, status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] }, balanceAmount: { gt: 0 } }, select: { balanceAmount: true, dueDate: true } }),
  ]);
  if (!c) notFound();
  // Ageing of what is owed today.
  const age = { current: 0, d30: 0, d60: 0, d90: 0 };
  for (const i of open) {
    const late = i.dueDate ? Math.round((Date.parse(today) - Date.parse(fromDbDate(i.dueDate))) / 86_400_000) : 0;
    if (late <= 0) age.current += i.balanceAmount; else if (late <= 30) age.d30 += i.balanceAmount; else if (late <= 60) age.d60 += i.balanceAmount; else age.d90 += i.balanceAmount;
  }
  const n = (v: number) => formatNumber(v);

  return (
    <div className="w-full space-y-5 print:space-y-0">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <Link href={`/staff/corporate/${c.id}`} className={buttonVariants({ variant: "ghost", size: "sm" })}><ArrowLeft /> {c.companyName}</Link>
        <div className="flex flex-wrap items-center gap-2">
          <PeriodPicker current={p.key} from={p.from} to={p.to} />
          <ReportActions target="statement-doc" fileName={`${s.hotelName}-statement-${c.companyName}-${p.from}-${p.to}`.replace(/[^\w]+/g, "-").toLowerCase()} share={`Statement of account — ${c.companyName} · ${periodLabel(p)}`} />
        </div>
      </div>

      <article id="statement-doc" className="group/doc mx-auto w-full max-w-[880px] overflow-hidden rounded-[28px] bg-white text-[#1d1a16] shadow-[0_40px_80px_-40px_rgba(15,23,42,0.55)] print:max-w-none print:rounded-none print:shadow-none" style={{ printColorAdjust: "exact", WebkitPrintColorAdjust: "exact" }}>
        <header data-break className="relative overflow-hidden bg-[#15110c] px-8 py-7 text-white sm:px-10">
          <div className="pointer-events-none absolute -right-24 -top-32 size-80 rounded-full bg-[#c9a24a]/25 blur-3xl" />
          <div className="relative flex flex-wrap items-start justify-between gap-6">
            <div className="flex items-center gap-4">
              <Image src="/brand/logo-192.png" alt="" width={52} height={52} />
              <div>
                <p className="font-display text-2xl font-semibold">{s.hotelName}</p>
                <p className="text-[11px] text-white/55">{[s.phone, s.email].filter(Boolean).join("  ·  ")}</p>
              </div>
            </div>
            <div className="text-right">
              <p className="text-[11px] font-semibold uppercase tracking-[0.35em] text-[#f0cf86]">Statement of account</p>
              <p className="mt-1 text-xl font-semibold">{c.companyName}</p>
              <p className="text-[11px] text-white/55">{periodLabel(p)}</p>
            </div>
          </div>
        </header>
        <div className="h-1 bg-gradient-to-r from-[#8a6a25] via-[#f0cf86] to-[#8a6a25]" />

        <div className="space-y-7 px-8 py-8 sm:px-10">
          <section data-break className="grid grid-cols-2 gap-px overflow-hidden rounded-2xl bg-[#eadfca] sm:grid-cols-4 group-data-[paper=true]/doc:grid-cols-4">
            {[["Opening balance", st.opening], ["Invoiced", st.invoiced], ["Paid", st.paid], ["Closing balance", st.closing]].map(([k, v], i) => (
              <div key={k as string} className={cn("bg-[#fbf8f2] px-4 py-3", i === 3 && "bg-[#15110c] text-white")}>
                <p className={cn("text-[10px] uppercase tracking-[0.18em]", i === 3 ? "text-white/50" : "text-[#8a8177]")}>{k}</p>
                <p className={cn("mt-0.5 text-lg font-semibold tabular-nums", i === 3 && "text-[#f0cf86]")}>{s.currency} {n(v as number)}</p>
              </div>
            ))}
          </section>

          <table className="w-full text-sm">
            <thead><tr className="border-b-2 border-[#15110c] text-left text-[10px] uppercase tracking-[0.16em] text-[#8a8177]">
              <th className="py-2.5 font-semibold">Date</th><th className="py-2.5 font-semibold">Reference</th><th className="py-2.5 font-semibold">Details</th>
              <th className="w-24 py-2.5 pl-4 text-right font-semibold">Invoiced</th><th className="w-24 py-2.5 pl-4 text-right font-semibold">Paid</th><th className="w-28 py-2.5 pl-4 text-right font-semibold">Balance</th>
            </tr></thead>
            <tbody>
              <tr data-break className="border-b border-[#efe7da] bg-[#fbf8f2]"><td className="py-2.5 text-xs">{formatBusinessDate(p.from)}</td><td /><td className="py-2.5 font-medium">Opening balance</td><td /><td /><td className="py-2.5 text-right font-semibold tabular-nums">{n(st.opening)}</td></tr>
              {st.rows.map((r, i) => (
                <tr data-break key={i} className="border-b border-[#efe7da]">
                  <td className="py-2.5 text-xs">{formatBusinessDate(r.date)}</td>
                  <td className="whitespace-nowrap py-2.5 pr-4 font-mono text-xs">{r.href ? <Link href={r.href} className="hover:underline">{r.ref}</Link> : r.ref}</td>
                  <td className="py-2.5 text-[#5b534a]">{r.detail}</td>
                  <td className="py-2.5 pl-4 text-right tabular-nums">{r.debit ? n(r.debit) : ""}</td>
                  <td className="py-2.5 pl-4 text-right tabular-nums text-emerald-700">{r.credit ? n(r.credit) : ""}</td>
                  <td className="py-2.5 pl-4 text-right font-medium tabular-nums">{n(r.balance)}</td>
                </tr>
              ))}
              {st.rows.length === 0 && <tr><td colSpan={6} className="py-6 text-center text-[#8a8177]">No invoices or payments in this period.</td></tr>}
              <tr data-break className="bg-[#15110c] text-white"><td className="px-2 py-3 text-xs">{formatBusinessDate(p.to)}</td><td /><td className="py-3 font-semibold">Closing balance</td><td /><td /><td className="px-2 py-3 text-right text-base font-semibold tabular-nums text-[#f0cf86]">{n(st.closing)}</td></tr>
            </tbody>
          </table>

          <section>
            <p className="mb-2 text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9a7a35]">Owed today, by age</p>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 group-data-[paper=true]/doc:grid-cols-4">
              {[["Not yet due", age.current], ["1–30 days late", age.d30], ["31–60 days late", age.d60], ["Over 60 days", age.d90]].map(([k, v], i) => (
                <div key={k as string} className={cn("rounded-xl border px-3 py-2.5", i > 0 && (v as number) > 0 ? "border-rose-200 bg-rose-50" : "border-[#eadfca]")}>
                  <p className="text-[11px] text-[#8a8177]">{k}</p>
                  <p className={cn("font-semibold tabular-nums", i > 0 && (v as number) > 0 && "text-rose-700")}>{n(v as number)}</p>
                </div>
              ))}
            </div>
          </section>
          <p className="border-t border-[#efe7da] pt-5 text-xs text-[#8a8177]">Please quote the invoice numbers with your payments. Questions: {[s.phone, s.email].filter(Boolean).join(" · ")}. Printed {formatBusinessDate(today)}.</p>
        </div>
      </article>
    </div>
  );
}
