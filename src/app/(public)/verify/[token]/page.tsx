import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { BadgeCheck, Ban } from "lucide-react";
import { db } from "@/server/db";
import { getSettings } from "@/server/settings";
import { businessToday } from "@/server/settings";
import { fromDbDate } from "@/lib/time/business-date";
import { formatBusinessDate, formatNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { InfoList, PageIntro, PriceTag, Section, surface, typeScale } from "@/components/public/kit";
import { PayOnlineCard } from "@/components/public/pay-online-card";
import { invoicePayOnline } from "@/server/services/online-pay";
import { payInvoiceOnlineAction } from "./actions";

export const metadata: Metadata = {
  title: "Verify invoice",
  robots: { index: false, follow: false },
  referrer: "no-referrer",
};

/**
 * Scan-to-verify: anyone holding the invoice can check it is genuine and what
 * is still owed. Only the headline figures are shown — no guest or line details.
 * A short night band (the verdict), then the invoice as a quiet receipt with Pay now when something is owed.
 */
export default async function VerifyInvoicePage({ params }: PageProps<"/verify/[token]">) {
  const { token } = await params;
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(token)) notFound();
  const [inv, s, today, online] = await Promise.all([
    db.invoice.findUnique({ where: { verifyToken: token }, include: { corporateCustomer: { select: { companyName: true } }, guest: { select: { fullName: true } }, group: { select: { name: true } } } }),
    getSettings(),
    businessToday(),
    invoicePayOnline(token),
  ]);
  if (!inv || inv.status === "DRAFT") notFound();
  const dead = inv.status === "VOID" || inv.status === "CANCELLED";
  const due = inv.dueDate ? fromDbDate(inv.dueDate) : null;
  const overdue = !dead && inv.balanceAmount > 0 && due && due < today;
  // Tone-aware badges: readable on cream and on the dark theme alike.
  const state = dead ? { label: inv.status === "VOID" ? "Void — not payable" : "Cancelled — not payable", cls: "border-pub-line text-pub-muted" }
    : inv.balanceAmount <= 0 ? { label: "Paid in full", cls: "border-emerald-700/30 bg-emerald-600/10 text-emerald-800 pub-dark:text-emerald-300" }
      : overdue ? { label: "Overdue", cls: "border-pub-error/40 bg-pub-error/10 text-pub-error" }
        : inv.paidAmount > 0 ? { label: "Partly paid", cls: "border-amber-600/35 bg-amber-500/10 text-amber-800 pub-dark:text-amber-300" }
          : { label: "Unpaid", cls: "border-gold/50 bg-gold/10 text-pub-fg" };
  const who = inv.corporateCustomer?.companyName ?? inv.group?.name ?? inv.guest?.fullName ?? "—";
  const owed = dead ? 0 : Math.max(0, inv.balanceAmount);

  return (
    <>
      <PageIntro
        space="sm"
        align="center"
        id="verify-title"
        eyebrow={
          <span className="inline-flex items-center gap-2">
            {dead ? <Ban className="size-4" strokeWidth={1.6} aria-hidden="true" /> : <BadgeCheck className="size-4" strokeWidth={1.6} aria-hidden="true" />}
            Invoice check
          </span>
        }
        title={dead ? "This invoice is not valid for payment" : `Genuine ${s.hotelName} invoice`}
      />

      <Section space="sm" width="narrow" labelledBy="invoice-number" className="flex-1">
        <article className={cn(surface.panel, "mx-auto max-w-lg")}>
          <header className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <p className={cn(typeScale.eyebrow, "text-pub-eyebrow")}>Invoice</p>
              <h2 id="invoice-number" className="mt-2 font-mono text-xl font-semibold text-pub-fg [overflow-wrap:anywhere]">{inv.number}</h2>
            </div>
            <span className={cn("shrink-0 rounded-full border px-3 py-1.5 text-[12px] font-semibold", state.cls)}>{state.label}</span>
          </header>
          <InfoList
            variant="rows"
            className="mt-6"
            items={[
              { label: "For", value: <span className="font-medium [overflow-wrap:anywhere]">{who}</span> },
              { label: "Issued", value: inv.issueDate ? formatBusinessDate(fromDbDate(inv.issueDate)) : "—" },
              { label: "Due", value: <span className={cn(overdue && "font-semibold text-pub-error")}>{due ? formatBusinessDate(due) : "—"}</span> },
              { label: "Invoice total", value: <span className="tabular-nums">{s.currency} {formatNumber(inv.netAmount)}</span> },
              { label: "Paid", value: <span className="tabular-nums">{s.currency} {formatNumber(inv.paidAmount)}</span> },
            ]}
          />
          <div className={cn("mt-6 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-2", dead && "opacity-60")}>
            <p className={cn(typeScale.meta, "text-pub-muted")}>Still owed</p>
            <PriceTag amount={owed} currency={s.currency} unit={null} size="lg" />
          </div>
          {!dead && (online.offered || online.live) && (
            <div className="mt-6 border-t border-pub-line pt-6">
              <PayOnlineCard tone="inherit" flush due={online.due} phone="" live={online.live} action={payInvoiceOnlineAction.bind(null, token)} />
            </div>
          )}
        </article>
        <p className="mx-auto mt-6 max-w-lg text-center text-[13px] leading-relaxed text-pub-muted">
          Questions about this invoice? Call {s.phone ?? "the hotel"}{s.email ? ` or email ${s.email}` : ""}. Always quote {inv.number} with your payment.
        </p>
      </Section>
    </>
  );
}
