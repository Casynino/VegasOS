import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeCheck, Ban } from "lucide-react";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import { businessToday } from "@/server/settings";
import { fromDbDate } from "@/lib/time/business-date";
import { formatBusinessDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { container, cream, eyebrow } from "@/components/public/ui";

export const metadata: Metadata = {
  title: "Verify invoice",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Scan-to-verify: anyone holding the invoice can check it is genuine and what
 * is still owed. Only the headline figures are shown — no guest or line details.
 */
export default async function VerifyInvoicePage({ params }: PageProps<"/verify/[token]">) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) notFound();
  const [inv, s, today] = await Promise.all([
    db.invoice.findUnique({ where: { verifyToken: token }, include: { corporateCustomer: { select: { companyName: true } }, guest: { select: { fullName: true } }, group: { select: { name: true } } } }),
    getSettings(),
    businessToday(),
  ]);
  if (!inv || inv.status === "DRAFT") notFound();
  const dead = inv.status === "VOID" || inv.status === "CANCELLED";
  const due = inv.dueDate ? fromDbDate(inv.dueDate) : null;
  const overdue = !dead && inv.balanceAmount > 0 && due && due < today;
  const state = dead ? { label: inv.status === "VOID" ? "Void — not payable" : "Cancelled — not payable", cls: "bg-zinc-200 text-zinc-700" }
    : inv.balanceAmount <= 0 ? { label: "Paid in full", cls: "bg-emerald-600 text-white" }
      : overdue ? { label: "Overdue", cls: "bg-rose-600 text-white" }
        : inv.paidAmount > 0 ? { label: "Partly paid", cls: "bg-amber-500 text-black" } : { label: "Unpaid", cls: "bg-[#15110c] text-[#f0cf86]" };
  const who = inv.corporateCustomer?.companyName ?? inv.group?.name ?? inv.guest?.fullName ?? "—";

  return (
    <div className={cn(cream, "flex-1 pb-20")}>
      <section className="bg-[#15120e] pb-28 pt-32 text-white">
        <div className={cn(container, "text-center")}>
          <p className={cn(eyebrow, "inline-flex items-center gap-2 text-gold")}>{dead ? <Ban className="size-4" /> : <BadgeCheck className="size-4" />}Invoice check</p>
          <h1 className="mt-3 font-display text-4xl sm:text-5xl">{dead ? "This invoice is not valid for payment" : `Genuine ${s.hotelName} invoice`}</h1>
        </div>
      </section>
      <div className={cn(container, "-mt-16")}>
        <div className="mx-auto max-w-lg overflow-hidden rounded-3xl bg-white text-[#1d1a16] shadow-[0_30px_60px_-30px_rgba(0,0,0,0.5)]">
          <div className="flex items-center justify-between gap-3 border-b border-[#efe7da] px-6 py-5">
            <div>
              <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-[#9a7a35]">Invoice</p>
              <p className="font-mono text-xl font-semibold">{inv.number}</p>
            </div>
            <span className={cn("rounded-full px-3 py-1 text-xs font-semibold", state.cls)}>{state.label}</span>
          </div>
          <dl className="grid grid-cols-2 gap-x-4 gap-y-3 px-6 py-5 text-sm">
            <dt className="text-[#8a8177]">For</dt><dd className="text-right font-medium">{who}</dd>
            <dt className="text-[#8a8177]">Issued</dt><dd className="text-right">{inv.issueDate ? formatBusinessDate(fromDbDate(inv.issueDate)) : "—"}</dd>
            <dt className="text-[#8a8177]">Due</dt><dd className={cn("text-right", overdue && "font-semibold text-rose-600")}>{due ? formatBusinessDate(due) : "—"}</dd>
            <dt className="text-[#8a8177]">Invoice total</dt><dd className="text-right tabular-nums">{s.currency} {formatNumber(inv.netAmount)}</dd>
            <dt className="text-[#8a8177]">Paid</dt><dd className="text-right tabular-nums">{s.currency} {formatNumber(inv.paidAmount)}</dd>
          </dl>
          <div className={cn("flex items-end justify-between px-6 py-5", dead ? "bg-zinc-100 text-zinc-500" : "bg-[#15110c] text-white")}>
            <span className="text-[10px] font-semibold uppercase tracking-[0.2em] opacity-70">Still owed</span>
            <span className="text-3xl font-semibold tabular-nums"><span className="mr-1 text-sm opacity-60">{s.currency}</span>{formatNumber(dead ? 0 : Math.max(0, inv.balanceAmount))}</span>
          </div>
        </div>
        <p className="mx-auto mt-6 max-w-lg text-center text-sm text-[#6b6258]">
          Questions about this invoice? Call {s.phone ?? "the hotel"}{s.email ? ` or email ${s.email}` : ""}. Always quote {inv.number} with your payment.
        </p>
      </div>
    </div>
  );
}
