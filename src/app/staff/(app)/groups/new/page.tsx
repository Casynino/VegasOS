import type { Metadata } from "next";
import { requirePagePermission } from "@/server/auth";
import { db } from "@/server/db";
import { businessToday, getSettings } from "@/server/settings";
import { bookingCompanies } from "@/server/services/company-billing";
import { billMenu } from "@/server/services/restaurant";
import { PageHeader } from "@/components/staff/page-header";
import { GroupForm } from "./group-form";

export const metadata: Metadata = { title: "New group booking" };

export default async function NewGroupPage({ searchParams }: PageProps<"/staff/groups/new">) {
  await requirePagePermission("reservations.create");
  const sp = await searchParams;
  const today = await businessToday();
  const [sources, companies] = await Promise.all([
    // Hotel QR bookings are made by guests from the QR — never picked at the desk.
    db.bookingSource.findMany({ where: { isActive: true, code: { not: "HOTEL_QR" } }, orderBy: { sortOrder: "asc" }, select: { code: true, name: true } }),
    bookingCompanies(today),
  ]);
  return (
    <div className="w-full">
      <PageHeader title="New group booking" description="Several rooms for one company, family or event. Add the members, choose the group leader and put everyone in a room — the company or the leader gets one invoice with every room's bill." />
      <GroupForm today={today} sources={sources} companies={companies} preselectCompany={typeof sp.company === "string" ? sp.company : null} defaultTerms={(await getSettings()).invoiceDefaultDueDays} menu={await billMenu()} />
    </div>
  );
}
