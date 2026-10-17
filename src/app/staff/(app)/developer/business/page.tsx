import type { ReactNode } from "react";
import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Eye } from "lucide-react";
import { requestMeta, requirePagePermission, requireUser } from "@/server/auth";
import { getSettings } from "@/server/settings";
import {
  BUSINESS_TABS, businessCustomers, businessMoney, businessRestaurant, businessStays, businessStores, noteBusinessView, parseBusinessTab, type BusinessTab,
} from "@/server/services/developer-business";
import { staffHome } from "@/lib/staff-home";
import { getT } from "@/i18n/server";
import { msg } from "@/i18n/msg";
import { cn } from "@/lib/utils";
import { PageHeader } from "@/components/staff/page-header";
import { CustomersTable, ExpensesTable, LowStockTable, MovementsTable, OrdersTable, PaymentsTable, StaysTable } from "./business-tables";

export async function generateMetadata(): Promise<Metadata> {
  return { title: (await getT())("Business") };
}
export const dynamic = "force-dynamic";

const TAB_LABEL: Record<BusinessTab, string> = {
  stays: msg("Stays"), money: msg("Money"), restaurant: msg("Restaurant"), stores: msg("Stores"), customers: msg("Customers"),
};

/**
 * BUSINESS — look, don't touch. The Developer's plain, read-only tables of the hotel's data (the latest 30 of each). Nothing on this
 * page can change a record: there is no form, no button and no link to an editing page. Every service function re-checks that the
 * caller is the Developer; each visit to a tab is written to the audit trail (and so is the visit to the page itself).
 */
export default async function DeveloperBusinessPage({ searchParams }: PageProps<"/staff/developer/business">) {
  // The Developer's console and the "Work as" world are kept apart: while working as someone, this page is closed — to their own home.
  const me = await requireUser();
  if (me.workAs) redirect(staffHome(me.permissions));
  const user = await requirePagePermission("developer.access");

  const tab = parseBusinessTab((await searchParams).tab);
  const [t, { timezone }, { ipAddress }] = await Promise.all([getT(), getSettings(), requestMeta()]);
  await noteBusinessView(user, tab, { ipAddress });

  // Only the chosen tab is read (each table is its own bounded query, and the service checks the caller again).
  let content: ReactNode;
  if (tab === "stays") {
    content = <StaysTable rows={await businessStays(user)} t={t} />;
  } else if (tab === "money") {
    const { payments, expenses } = await businessMoney(user);
    content = (
      <div className="space-y-5">
        <PaymentsTable rows={payments} t={t} timezone={timezone} />
        <ExpensesTable rows={expenses} t={t} timezone={timezone} />
      </div>
    );
  } else if (tab === "restaurant") {
    content = <OrdersTable rows={await businessRestaurant(user)} t={t} timezone={timezone} />;
  } else if (tab === "stores") {
    const { movements, belowMinimum } = await businessStores(user);
    content = (
      <div className="space-y-5">
        <MovementsTable rows={movements} t={t} timezone={timezone} />
        <LowStockTable rows={belowMinimum} t={t} />
      </div>
    );
  } else {
    content = <CustomersTable rows={await businessCustomers(user)} t={t} />;
  }

  return (
    <div className="w-full space-y-5">
      <PageHeader
        title={t("Business")}
        description={t("A look at the business data — stays, money, restaurant, stores and customers — in plain tables.")}
      />

      <aside className="flex items-start gap-3 rounded-2xl border border-border/70 bg-card p-4 shadow-[0_2px_4px_rgba(15,23,42,0.03)]">
        <span className="grid size-9 shrink-0 place-items-center rounded-full bg-muted text-muted-foreground" aria-hidden="true"><Eye className="size-4" /></span>
        <div className="min-w-0">
          <h2 className="text-sm font-semibold">{t("Look, don't touch")}</h2>
          <p className="mt-0.5 text-sm text-muted-foreground">
            {t.rich("This page is read-only: nothing here can be edited, so you can check a number safely. If a record is wrong, the person who owns it fixes it — or you can use <work>Work as</work> to see their screen. Each visit to this page is recorded in the audit log.", {
              work: (chunks) => <Link href="/staff/developer/access" className="font-medium text-[oklch(0.5_0.1_75)] underline underline-offset-4 dark:text-gold">{chunks}</Link>,
            })}
          </p>
        </div>
      </aside>

      <nav aria-label={t("Business data")} className="flex flex-wrap gap-2">
        {BUSINESS_TABS.map((k) => (
          <Link
            key={k}
            href={`/staff/developer/business?tab=${k}`}
            aria-current={k === tab ? "page" : undefined}
            className={cn(
              "inline-flex h-8 items-center rounded-full border px-3.5 text-sm transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold",
              k === tab ? "border-gold bg-gold/15 font-medium text-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground",
            )}
          >
            {t(TAB_LABEL[k])}
          </Link>
        ))}
      </nav>

      {content}
    </div>
  );
}
