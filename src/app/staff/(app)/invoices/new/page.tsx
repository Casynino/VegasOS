import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { PageHeader, EmptyState } from "@/components/staff/page-header";
import { getT } from "@/i18n/server";
import { ManualInvoiceForm } from "./manual-invoice-form";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("New invoice") };
}

export default async function NewInvoicePage({ searchParams }: PageProps<"/staff/invoices/new">) {
  await requirePagePermission("invoices.manage");
  const t = await getT();
  const sp = await searchParams;
  const companies = await db.corporateCustomer.findMany({ where: { status: { not: "INACTIVE" } }, orderBy: { companyName: "asc" }, select: { id: true, companyName: true } });
  return (
    <div className="w-full">
      <PageHeader title={t("New stand-alone invoice")} description={t("For corporate extras such as meeting-room use or services not on a room booking. Room stays are invoiced from the reservation.")} />
      {companies.length === 0 ? <EmptyState title={t("Add a corporate account first")} description={t("Stand-alone invoices are issued to corporate accounts.")} /> :
        <ManualInvoiceForm companies={companies} defaultCompanyId={typeof sp.company === "string" ? sp.company : ""} />}
    </div>
  );
}
