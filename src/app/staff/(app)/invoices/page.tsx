import type { Metadata } from "next";
import Link from "next/link";
import { FilePlus2, FileText } from "lucide-react";
import { can, requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { refreshOverdueInvoices } from "@/server/services/invoices";
import { formatTZS } from "@/lib/format";
import { INVOICE_STATUS_META } from "@/lib/invoice-status";
import type { InvoiceStatus } from "@/generated/prisma/enums";
import { cn } from "@/lib/utils";
import { FinanceTabs } from "@/components/staff/finance/finance-nav";
import { PageHeader, EmptyState } from "@/components/staff/page-header";
import { StatCard } from "@/components/staff/stat-card";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { getT } from "@/i18n/server";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Invoices") };
}

export default async function InvoicesPage({ searchParams }: PageProps<"/staff/invoices">) {
  const user = await requirePagePermission("invoices.view");
  const t = await getT();
  await refreshOverdueInvoices();
  const sp = await searchParams;
  const status = (Object.keys(INVOICE_STATUS_META).includes(String(sp.status)) ? sp.status : undefined) as InvoiceStatus | undefined;
  const [rows, open, overdue] = await Promise.all([
    db.invoice.findMany({
      where: status ? { status } : {}, orderBy: { createdAt: "desc" }, take: 100,
      include: { corporateCustomer: { select: { companyName: true } }, guest: { select: { fullName: true } }, group: { select: { name: true } }, reservation: { select: { reference: true } } },
    }),
    db.invoice.aggregate({ where: { status: { in: ["ISSUED", "PARTIALLY_PAID", "OVERDUE"] } }, _sum: { balanceAmount: true }, _count: true }),
    db.invoice.aggregate({ where: { status: "OVERDUE" }, _sum: { balanceAmount: true }, _count: true }),
  ]);

  return (
    <div className="w-full space-y-4">
      {/* The finance bar is this page's title; staff without finance see the heading instead */}
      {can(user, "finance.view") || can(user, "ledger.view")
        ? <FinanceTabs active="/staff/invoices" limited={!can(user, "finance.view")} actions={can(user, "invoices.manage") && <Link href="/staff/invoices/new" className={buttonVariants()}><FilePlus2 /> {t("New invoice")}</Link>} />
        : <PageHeader title={t("Invoices")} description={t("Room invoices follow their booking automatically; stand-alone invoices receive payments directly.")} actions={can(user, "invoices.manage") && <Link href="/staff/invoices/new" className={buttonVariants()}><FilePlus2 /> {t("New invoice")}</Link>} />}
      <div className="grid gap-3 sm:grid-cols-2">
        <StatCard variant="feature" label={t("Open invoices")} value={formatTZS(open._sum.balanceAmount ?? 0)} sub={t("{n} unpaid", { n: open._count })} icon={<FileText />} href="/staff/invoices?status=ISSUED" />
        <StatCard label={t("Overdue")} value={formatTZS(overdue._sum.balanceAmount ?? 0)} sub={t("{n} past due", { n: overdue._count })} icon={<FileText />} tone="red" href="/staff/invoices?status=OVERDUE" />
      </div>
      <nav className="flex flex-wrap gap-1">
        <Link href="?" className={cn("rounded-full border px-3 py-1 text-sm", !status ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>{t("All")}</Link>
        {Object.entries(INVOICE_STATUS_META).map(([k, v]) => (
          <Link key={k} href={`?status=${k}`} className={cn("rounded-full border px-3 py-1 text-sm", status === k ? "bg-primary text-primary-foreground" : "bg-card hover:bg-muted")}>{t(v.label)}</Link>
        ))}
      </nav>
      {rows.length === 0 ? (
        <EmptyState icon={<FileText />} title={t("No invoices here")} description={t("Create one from a reservation (Invoice button) or as a stand-alone corporate invoice.")} />
      ) : (
        <Card><CardContent className="p-0">
          <Table data-stack>
            <TableHeader><TableRow><TableHead>{t("Number")}</TableHead><TableHead>{t("Customer")}</TableHead><TableHead className="hidden md:table-cell">{t("Due")}</TableHead><TableHead>{t("Status")}</TableHead><TableHead className="text-right">{t("Net")}</TableHead><TableHead className="text-right">{t("Balance")}</TableHead></TableRow></TableHeader>
            <TableBody>
              {rows.map((i) => (
                <TableRow key={i.id} className="relative">
                  <TableCell><Link href={`/staff/invoices/${i.id}`} className="font-mono text-sm font-medium after:absolute after:inset-0">{i.number}</Link>
                    {i.reservation && <span className="block font-mono text-xs text-muted-foreground">{i.reservation.reference}</span>}</TableCell>
                  <TableCell>{i.corporateCustomer?.companyName ?? i.group?.name ?? i.guest?.fullName ?? "—"}</TableCell>
                  <TableCell className="hidden md:table-cell text-sm">{i.dueDate ? t.date(i.dueDate.toISOString().slice(0, 10)) : "—"}</TableCell>
                  <TableCell><Badge variant="outline" className={INVOICE_STATUS_META[i.status].className}>{t(INVOICE_STATUS_META[i.status].label)}</Badge></TableCell>
                  <TableCell className="text-right tabular-nums">{formatTZS(i.netAmount)}</TableCell>
                  <TableCell className={cn("text-right tabular-nums", i.balanceAmount > 0 && i.status !== "DRAFT" && "font-medium text-destructive")}>{formatTZS(i.balanceAmount)}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent></Card>
      )}
    </div>
  );
}
